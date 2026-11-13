#!/usr/bin/env bash
# Codex lanes (routine, complex, pr_review) through the OpenAI Codex CLI.
#
#   codex-lane.sh routine|complex|pr_review  < input
#
# input is an optional header, a line "---", then the spec (or review goal):
#
#   WORKDIR: /path/to/repo      (default: current directory)
#   BASE: origin/main           (pr_review only)
#   EFFORT: high                (optional override)
#   ---
#   <spec or goal>
#
# Header values arrive on stdin inside the caller's quoted heredoc, so nothing in
# them, a path with quotes or spaces included, is ever parsed as shell. The flags
# --workdir, --base and --effort do the same job for scripted callers.
#
# The calling agent passes a lane and that input. Everything else happens here: the model and default effort come from lane
# configuration, an effort override is checked against the catalog, the prompt is
# built, the sandbox is fixed per lane, a watchdog caps the run, and the result is
# checked. Nothing the agent types is ever evaluated as shell.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LANE=${1:-}
[ "$#" -gt 0 ] && shift
EFFORT_OVERRIDE='' BASE='' WORKDIR=$PWD WORKDIR_SET='' BASE_SET='' EFFORT_SET=''
case "$LANE" in
  routine) AGENT=luna-implementer SANDBOX=workspace-write ;;
  complex) AGENT=sol-implementer SANDBOX=workspace-write ;;
  pr_review) AGENT=astra-reviewer SANDBOX=read-only ;;
  *) AGENT=codex-lane SANDBOX='' ;;
esac
MODEL=unresolved EFFORT=unresolved LABEL=unresolved SOURCE=config
RUN=''

redact() {
  sed -E 's/[Bb][Ee][Aa][Rr][Ee][Rr] [^[:space:]]+/Bearer <REDACTED>/g; s/(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})/<REDACTED>/g'
}
header() {
  printf 'CODEX LANE RUN\nLANE: %s · %s (%s) · effort %s (%s)\nSTATUS: %s\nREASON: %s\n' "$AGENT" "$LABEL" "$MODEL" "$EFFORT" "$SOURCE" "$1" "$2"
}
fail() {
  { header "$1" "$2"; [ -z "$RUN" ] || [ ! -s "$RUN/stderr" ] || { printf 'DIAGNOSTICS:\n'; tail -n 15 "$RUN/stderr"; }; } | redact
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --effort) [ "$#" -ge 2 ] || fail unavailable 'Missing value for --effort'; EFFORT_OVERRIDE=$2 EFFORT_SET=1; shift 2 ;;
    --base) [ "$#" -ge 2 ] || fail failed 'Missing value for --base'; BASE=$2 BASE_SET=1; shift 2 ;;
    --workdir) [ "$#" -ge 2 ] || fail unavailable 'Missing value for --workdir'; WORKDIR=$2 WORKDIR_SET=1; shift 2 ;;
    *) fail unavailable "Unknown argument: $1" ;;
  esac
done
[ -n "$SANDBOX" ] || fail unavailable 'Usage: codex-lane.sh routine|complex|pr_review [--base REF] [--effort RUNG] [--workdir DIR] < spec'
# A review that cannot run is "failed"; an implementation lane that cannot start is "unavailable".
CANNOT=unavailable; [ "$LANE" = pr_review ] && CANNOT=failed

command -v codex >/dev/null 2>&1 || fail unavailable 'codex not found on PATH (npm i -g @openai/codex && codex login)'
VERSION=$(codex --version 2>&1) || fail unavailable "codex --version failed: $VERSION"
command -v node >/dev/null 2>&1 || fail unavailable 'Node.js is required to resolve lane configuration'

RUN=$(mktemp -d "${TMPDIR:-/tmp}/fable-codex.XXXXXX") || { RUN=''; fail "$CANNOT" 'Cannot allocate a temporary run directory'; }
trap 'rm -rf "$RUN"' EXIT
cat > "$RUN/raw" || fail "$CANNOT" 'Cannot read input from stdin'
# Optional header: KEY: value lines up to a line "---". Values are data, never shell.
if head -n 1 "$RUN/raw" | grep -Eq '^(WORKDIR|BASE|EFFORT):'; then
  HEADER_DONE=''
  exec 3< "$RUN/raw"
  while IFS= read -r line <&3; do
    case "$line" in
      ---) HEADER_DONE=1; break ;;
      WORKDIR:*) [ -n "$WORKDIR_SET" ] || { WORKDIR=${line#WORKDIR:}; WORKDIR=${WORKDIR# }; WORKDIR_SET=1; } ;;
      BASE:*) [ -n "$BASE_SET" ] || { BASE=${line#BASE:}; BASE=${BASE# }; BASE_SET=1; } ;;
      EFFORT:*) [ -n "$EFFORT_SET" ] || { EFFORT_OVERRIDE=${line#EFFORT:}; EFFORT_OVERRIDE=${EFFORT_OVERRIDE# }; EFFORT_SET=1; } ;;
      *) fail "$CANNOT" 'Unknown header line before ---; allowed keys are WORKDIR, BASE and EFFORT' ;;
    esac
  done
  [ -n "$HEADER_DONE" ] || fail "$CANNOT" 'Header has no closing --- line'
  cat <&3 > "$RUN/input" || fail "$CANNOT" 'Cannot read the spec after the header'
  exec 3<&-
else
  mv "$RUN/raw" "$RUN/input" || fail "$CANNOT" 'Cannot read the spec from stdin'
fi
# stderr stays separate so runtime warnings can never leak into the model or effort.
LINE=$(node "$HERE/lane-model.mjs" "$LANE" "$EFFORT_OVERRIDE" 2> "$RUN/lane-error") || fail unavailable "$(tail -n 3 "$RUN/lane-error")"
IFS=$'\t' read -r MODEL EFFORT LABEL SOURCE <<<"$LINE"

[ -d "$WORKDIR" ] || fail "$CANNOT" 'Working directory does not exist'
WORKDIR=$(cd "$WORKDIR" && pwd) || fail "$CANNOT" 'Cannot enter working directory'
git -C "$WORKDIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$CANNOT" 'Working directory must be a Git repository'
[ -s "$RUN/input" ] || fail "$CANNOT" 'Empty spec on stdin'

PREAMBLE='Scope of this run: one task, already planned and delegated by an orchestrating
session. Do it directly in this run. I explicitly opt out of starting an orchestration
or delegation workflow for it. The model and reasoning effort for this run are the ones
set on the command line.'

if [ "$LANE" = pr_review ]; then
  if [ -z "$BASE" ]; then
    BASE=$(git -C "$WORKDIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null) || BASE=main
  fi
  REF=''
  for candidate in "$BASE" "origin/$BASE"; do
    case "$candidate" in -*) continue ;; esac
    if git -C "$WORKDIR" rev-parse --verify --quiet "$candidate^{commit}" >/dev/null; then REF=$candidate; break; fi
  done
  [ -n "$REF" ] || fail failed "Base ref does not resolve: $BASE"
  BASE_SHA=$(git -C "$WORKDIR" rev-parse --verify "$REF^{commit}") || fail failed 'Cannot resolve the base commit'
  HEAD_SHA=$(git -C "$WORKDIR" rev-parse --verify 'HEAD^{commit}') || fail failed 'Cannot resolve HEAD'
  COMMITS=$(git -C "$WORKDIR" rev-list --count "$BASE_SHA..$HEAD_SHA") || fail failed 'Cannot count commits in range'
  git -C "$WORKDIR" status --porcelain --untracked-files=all > "$RUN/uncommitted" 2>/dev/null || : > "$RUN/uncommitted"
  if [ "$COMMITS" -eq 0 ]; then
    { header nothing-to-review "No commits in $REF..$HEAD_SHA"; printf 'RANGE: %s (%s)...%s\nREVIEWED: %s\n' "$REF" "$BASE_SHA" "$HEAD_SHA" "$HEAD_SHA"; } | redact
    exit 1
  fi
  # Only SHAs go into the prompt; a ref name could carry text codex would treat as a command.
  {
    printf '%s Do not modify any files.\n\n' "$PREAMBLE"
    printf 'Review the changes in `git diff %s...%s` (run `git log %s..%s` and\n' "$BASE_SHA" "$HEAD_SHA" "$BASE_SHA" "$HEAD_SHA"
    printf '`git diff %s...%s` yourself, and read surrounding code where it matters).\n' "$BASE_SHA" "$HEAD_SHA"
    printf 'Stated goal of the change:\n\n'
    cat "$RUN/input"
    printf '\nLook for: correctness bugs, behaviour that contradicts the goal, security issues,\n'
    printf 'data loss, broken error handling, missing or tautological tests for the changed\n'
    printf 'behaviour, and anything asked for that is missing. Skip style nits.\n\n'
    printf 'Report findings ordered by severity (blocker / major / minor). For each: file:line,\n'
    printf 'the defect in one sentence, and a concrete failure scenario. If there are none, say so.\n'
    printf 'End with exactly one line: VERDICT: pass | fix-first. fix-first if and only if there\n'
    printf 'is at least one blocker or major finding; minors alone are pass.\n'
  } > "$RUN/prompt" || fail failed 'Cannot write the review prompt'
else
  {
    printf '%s\n\n' "$PREAMBLE"
    cat "$RUN/input"
    printf '\n\nRun the verification command and include its actual output in your final message.\n'
  } > "$RUN/prompt" || fail unavailable 'Cannot write the spec prompt'
fi

(cd "$WORKDIR" && node "$HERE/worktree-manifest.mjs") > "$RUN/before" 2>/dev/null || fail "$CANNOT" 'Cannot inspect the worktree before the run'

SECONDS_CAP=${FABLE_CODEX_TIMEOUT:-580}
case "$SECONDS_CAP" in ''|*[!0-9]*) fail "$CANNOT" 'FABLE_CODEX_TIMEOUT must be a whole number of seconds' ;; esac
ARGS=(exec --model "$MODEL" -c "model_reasoning_effort=\"$EFFORT\"" --sandbox "$SANDBOX" --skip-git-repo-check --cd "$WORKDIR" --output-last-message "$RUN/final" -)
# Built-in watchdog: no dependency on timeout/gtimeout, and it stays inside the Bash
# tool's 10-minute ceiling (cap + 5s grace before SIGKILL). codex runs in its own
# process group (set -m) so the kill reaches anything it started. The watchdog's
# output goes to /dev/null so it can never hold the caller's stdout open.
set -m
codex "${ARGS[@]}" < "$RUN/prompt" > "$RUN/stdout" 2> "$RUN/stderr" &
PID=$!
set +m
(
  waited=0
  while kill -0 "$PID" 2>/dev/null; do
    if [ "$waited" -ge "$SECONDS_CAP" ]; then
      : > "$RUN/timed-out"
      kill -TERM -- "-$PID" 2>/dev/null; sleep 5; kill -KILL -- "-$PID" 2>/dev/null
      break
    fi
    sleep 1; waited=$((waited + 1))
  done
) > /dev/null 2>&1 &
WATCH=$!
wait "$PID" 2>/dev/null; RC=$?
wait "$WATCH" 2>/dev/null
# Anything codex started and left behind goes with it, including processes that ignore
# SIGTERM: they get a short grace period, then SIGKILL, before the worktree is inspected.
if kill -0 -- "-$PID" 2>/dev/null; then
  kill -TERM -- "-$PID" 2>/dev/null; sleep 2; kill -KILL -- "-$PID" 2>/dev/null
fi
[ ! -f "$RUN/timed-out" ] || RC=124

(cd "$WORKDIR" && node "$HERE/worktree-manifest.mjs") > "$RUN/after" 2>/dev/null || fail "$CANNOT" 'Cannot inspect the worktree after the run'
FINAL_TEXT=''; [ ! -f "$RUN/final" ] || FINAL_TEXT=$(cat "$RUN/final")
ACCESS='not logged in|login required|unauthori[sz]ed|unauthenticated|authentication (failed|required|error)|invalid api key|not have access|access denied|403 forbidden|401 unauthorized|usage limit|quota exceeded|rate limit exceeded|unknown model|model[^[:cntrl:]]*(not found|not available|not supported|does not exist|is unavailable)'

if [ "$RC" -eq 124 ]; then
  STATUS=timeout REASON="codex exceeded the ${SECONDS_CAP}-second limit"
elif [ "$RC" -ne 0 ] && grep -Eiq "$ACCESS" "$RUN/stderr" "$RUN/stdout" 2>/dev/null; then
  STATUS=unavailable REASON="codex could not run this model for this account (exit $RC); see diagnostics"
elif [ "$LANE" = pr_review ]; then
  # Only an exact verdict on the last non-empty line counts; an echoed template does not.
  LAST=$(printf '%s\n' "$FINAL_TEXT" | awk 'NF { last = $0 } END { sub(/\r$/, "", last); print last }')
  case "$LAST" in 'VERDICT: pass') VERDICT=pass ;; 'VERDICT: fix-first') VERDICT=fix-first ;; *) VERDICT='' ;; esac
  if [ "$RC" -ne 0 ]; then STATUS=failed REASON="codex exited $RC"
  elif ! cmp -s "$RUN/before" "$RUN/after"; then STATUS=failed REASON='The review changed files in the worktree'
  elif [ -z "$VERDICT" ]; then STATUS=failed REASON='The review does not end with an exact VERDICT: pass or VERDICT: fix-first line'
  else STATUS=complete REASON="VERDICT: $VERDICT"
  fi
else
  if [ "$RC" -ne 0 ]; then STATUS=partial REASON="codex exited $RC"
  elif cmp -s "$RUN/before" "$RUN/after"; then STATUS=refused REASON='codex exited 0 but changed no reviewable files'
  else STATUS=complete REASON='codex finished with a diff; verification still has to be re-run by the lane'
  fi
fi

{
  header "$STATUS" "$REASON"
  if [ "$LANE" = pr_review ]; then
    printf 'REPO: %s\nRANGE: %s (%s)...%s (%s commits)\nREVIEWED: %s\n' "$WORKDIR" "$REF" "$BASE_SHA" "$HEAD_SHA" "$COMMITS" "$HEAD_SHA"
    if [ -s "$RUN/uncommitted" ]; then printf 'UNCOMMITTED (not part of the review):\n'; cat "$RUN/uncommitted"; fi
  else
    printf 'CHANGED FILES:\n'
    (diff -u "$RUN/before" "$RUN/after" || true) | sed -n '/^[+-][^+-]/ { s/^[+-]//; p; }' | cut -f1 | sort -u
  fi
  printf -- '--- codex final message\n%s\n' "$FINAL_TEXT"
  [ ! -s "$RUN/stderr" ] || { printf -- '--- diagnostics (tail)\n'; tail -n 15 "$RUN/stderr"; }
} | redact
[ "$STATUS" = complete ]
