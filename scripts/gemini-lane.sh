#!/usr/bin/env bash
# Gemini broad lane through Antigravity CLI and the user's signed-in account.
# Filename retained for compatibility; never falls back to gemini CLI or API keys.
set -u
SPEC_SOURCE=${1:-}
MODEL=${FABLE_GEMINI_MODEL-gemini-3.8-flash-medium}
ROOT=${FABLE_WORKDIR:-$PWD}
HERE=$(cd "$(dirname "$0")" && pwd)
redact() {
  sed -E 's/[Bb][Ee][Aa][Rr][Ee][Rr] [^[:space:]]+/Bearer <REDACTED>/g; s/(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})/<REDACTED>/g'
}
fail() {
  printf 'GEMINI REPORT\nLANE: gemini-implementer · Gemini 3.8 Flash (%s) · Antigravity CLI\nSTATUS: %s\nREASON: %s\n' "$MODEL" "$1" "$2" | redact
  exit 1
}
command -v agy >/dev/null 2>&1 || fail unavailable 'agy not found on PATH; install Antigravity CLI and sign in interactively'
VERSION=$(agy --version 2>&1) || fail unavailable "agy --version failed: $VERSION"
command -v node >/dev/null 2>&1 || fail unavailable 'Node.js is required for Antigravity stream handling'
if [ "${FABLE_GEMINI_MODEL+x}" != x ]; then
  LANES=$(node "$HERE/resolve-lanes.mjs") || fail unavailable 'Invalid lane configuration; no model substituted'
  MODEL=$(printf '%s' "$LANES" | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).broad.model))') || fail unavailable 'Cannot resolve broad model'
fi
[ -n "$MODEL" ] || fail unavailable 'An explicit model override must not be empty'
[ "$MODEL" != gemini-3.8-flash ] || fail unavailable 'Legacy Gemini CLI model slug: run setup and explicitly choose an agy models slug such as gemini-3.8-flash-medium'
[ -f "$SPEC_SOURCE" ] && [ "${2:-}" = -- ] && [ "$#" -ge 3 ] && [ -d "$ROOT" ] || fail partial 'Usage: gemini-lane.sh SPEC_FILE -- APPROVED_COMMAND [ARG ...] (FABLE_WORKDIR optional)'
shift 2
VERIFY=("$@")
CHECK=$(node "$HERE/antigravity-io.mjs" preflight) || fail "$(printf '%s\n' "$CHECK" | head -n 1)" "$(printf '%s\n' "$CHECK" | sed -n '2p')"
# Resolve the spec before changing directories.
SPEC_SOURCE=$(cd "$(dirname "$SPEC_SOURCE")" && pwd)/$(basename "$SPEC_SOURCE")
cd "$ROOT" || fail partial 'Cannot enter working directory'
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail partial 'Working directory must be a Git repository for independent diff inspection'
RUN=$(mktemp -d "${TMPDIR:-/tmp}/fable-agy.XXXXXX") || fail partial 'Cannot allocate temporary run directory'
trap 'rm -rf "$RUN"' EXIT
SPEC_FILE="$RUN/spec.txt"
cp "$SPEC_SOURCE" "$SPEC_FILE" || fail partial 'Cannot copy full specification'
node "$HERE/antigravity-io.mjs" encode "$SPEC_FILE" > "$RUN/input.ndjson" || fail partial 'Cannot encode full specification'
node "$HERE/worktree-manifest.mjs" > "$RUN/files-before" || fail partial 'Cannot safely inspect the worktree before implementation'
T=$(command -v gtimeout || command -v timeout || true)
ARGS=(--model "$MODEL" --sandbox --mode accept-edits --print-timeout 20m --input-format stream-json --output-format stream-json)
if [ -n "$T" ]; then
  "$T" 1200 agy "${ARGS[@]}" < "$RUN/input.ndjson" > "$RUN/output.ndjson" 2> "$RUN/diagnostics"
  RC=$?
else
  agy "${ARGS[@]}" < "$RUN/input.ndjson" > "$RUN/output.ndjson" 2> "$RUN/diagnostics"
  RC=$?
fi
node "$HERE/worktree-manifest.mjs" > "$RUN/files-after" || fail partial 'Cannot safely inspect the worktree after implementation'
node "$HERE/antigravity-io.mjs" decode "$RUN/output.ndjson" "$RUN/diagnostics" "$MODEL" > "$RUN/summary" || fail partial 'Cannot validate Antigravity result'
STATUS=$(head -n 1 "$RUN/summary")
REASON=$(sed -n '2p' "$RUN/summary")
VERIFICATION='not independently run'
CHANGES_MANIFEST="$RUN/files-after"
if [ "$RC" -eq 124 ]; then
  STATUS=timeout; REASON='Antigravity exceeded the 1200-second wall-clock limit'
elif [ "$STATUS" = ready ]; then
  if [ "$RC" -ne 0 ]; then
    STATUS=partial; REASON="Antigravity exited $RC despite its success event"
  elif cmp -s "$RUN/files-before" "$RUN/files-after"; then
    STATUS=refused; REASON='No reviewable diff in tracked or non-ignored files; ignored-only edits require architect inspection'
  else
    # Caller-approved argv only: never evaluate a shell string from the spec/model.
    "${VERIFY[@]}" > "$RUN/verification" 2>&1
    VERIFY_RC=$?
    if [ "$VERIFY_RC" -eq 0 ]; then
      STATUS=complete; REASON='Independent verification passed'; VERIFICATION='independently executed; exit 0'
    else
      VERIFICATION="independent verification attempted; exit $VERIFY_RC"
      node "$HERE/antigravity-io.mjs" verification "$RUN/verification" "$VERIFY_RC" > "$RUN/verification-summary" || fail partial 'Cannot classify verification failure'
      STATUS=$(head -n 1 "$RUN/verification-summary")
      REASON=$(sed -n '2p' "$RUN/verification-summary")
    fi
    # Tests may format, generate, or remove files. Report the final state, but
    # never assume those mutations were verified or automatically retry them.
    if node "$HERE/worktree-manifest.mjs" > "$RUN/files-final"; then
      CHANGES_MANIFEST="$RUN/files-final"
      if ! cmp -s "$RUN/files-after" "$RUN/files-final"; then
        [ "$STATUS" != complete ] || STATUS=partial
        REASON="$REASON; verifier changed reviewable files; architect inspection and re-verification required"
      fi
    else
      CHANGES_MANIFEST=''
      [ "$STATUS" = blocked ] || STATUS=partial
      REASON="$REASON; cannot safely inspect the worktree after verification"
    fi
  fi
fi
{
printf 'GEMINI REPORT\nLANE: gemini-implementer · Gemini 3.8 Flash (%s) · Antigravity CLI\nSTATUS: %s\nOBJECTIVE: %s\nCHANGES:\n' "$MODEL" "$STATUS" "$(grep -m1 '^OBJECTIVE:' "$SPEC_FILE" | sed 's/^OBJECTIVE:[[:space:]]*//' || true)"
if [ -n "$CHANGES_MANIFEST" ]; then
  (diff -u "$RUN/files-before" "$CHANGES_MANIFEST" || true) | sed -n '/^[+-][^+-]/ { s/^[+-]//; p; }' | cut -f1 | sort -u
else
  printf 'Unavailable: final worktree inspection failed\n'
fi
printf 'VERIFIED: approved verifier argv withheld; %s\n' "$VERIFICATION"
[ ! -f "$RUN/verification" ] || tail -n 30 "$RUN/verification"
printf 'GEMINI SAID:\n'; sed '1,2d' "$RUN/summary" | tail -n 30
printf 'DIAGNOSTICS:\n'; tail -n 15 "$RUN/diagnostics"
printf 'GAPS: %s\n' "$REASON"
} | redact
[ "$STATUS" = complete ]
