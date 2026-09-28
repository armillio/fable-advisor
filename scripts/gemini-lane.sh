#!/usr/bin/env bash
# Gemini broad lane through Antigravity CLI and the user's signed-in account.
# Filename retained for compatibility; never falls back to gemini CLI or API keys.
set -u
SPEC_SOURCE=${1:-}
VERIFY=${2:-}
MODEL=${FABLE_GEMINI_MODEL:-gemini-3.8-flash-medium}
ROOT=${FABLE_WORKDIR:-$PWD}
HERE=$(cd "$(dirname "$0")" && pwd)
fail() {
  printf 'GEMINI REPORT\nLANE: gemini-implementer · Gemini 3.8 Flash (%s) · Antigravity CLI\nSTATUS: %s\nREASON: %s\n' "$MODEL" "$1" "$2"
  exit 1
}
command -v agy >/dev/null 2>&1 || fail unavailable 'agy not found on PATH; install Antigravity CLI and sign in interactively'
VERSION=$(agy --version 2>&1) || fail unavailable "agy --version failed: $VERSION"
command -v node >/dev/null 2>&1 || fail unavailable 'Node.js is required for Antigravity stream handling'
[ "$MODEL" != gemini-3.8-flash ] || fail unavailable 'Legacy Gemini CLI model slug: run setup and explicitly choose an agy models slug such as gemini-3.8-flash-medium'
[ -f "$SPEC_SOURCE" ] && [ -n "$VERIFY" ] && [ -d "$ROOT" ] || fail partial 'Usage: gemini-lane.sh SPEC_FILE VERIFICATION_COMMAND (FABLE_WORKDIR optional)'
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
snapshot() {
  git diff --no-ext-diff --binary HEAD 2>/dev/null
  git ls-files --others --exclude-standard -z | while IFS= read -r -d '' file; do
    printf 'UNTRACKED %s\n' "$file"
    cksum "$file" 2>/dev/null || true
  done
}
file_manifest() {
  git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' file; do
    if [ -f "$file" ]; then printf '%s\t%s\n' "$file" "$(cksum < "$file")";
    else printf '%s\tMISSING\n' "$file"; fi
  done
}
redact() {
  sed -E 's/Bearer [^[:space:]]+/Bearer <REDACTED>/g; s/sk-[A-Za-z0-9_-]{12,}/<REDACTED>/g; s/AIza[A-Za-z0-9_-]{12,}/<REDACTED>/g'
}
snapshot > "$RUN/before"
file_manifest > "$RUN/files-before"
T=$(command -v gtimeout || command -v timeout || true)
ARGS=(--model "$MODEL" --sandbox --mode accept-edits --print-timeout 20m --input-format stream-json --output-format stream-json)
if [ -n "$T" ]; then
  "$T" 1200 agy "${ARGS[@]}" < "$RUN/input.ndjson" > "$RUN/output.ndjson" 2> "$RUN/diagnostics"
  RC=$?
else
  agy "${ARGS[@]}" < "$RUN/input.ndjson" > "$RUN/output.ndjson" 2> "$RUN/diagnostics"
  RC=$?
fi
snapshot > "$RUN/after"
file_manifest > "$RUN/files-after"
node "$HERE/antigravity-io.mjs" decode "$RUN/output.ndjson" "$RUN/diagnostics" "$MODEL" > "$RUN/summary" || fail partial 'Cannot validate Antigravity result'
STATUS=$(head -n 1 "$RUN/summary")
REASON=$(sed -n '2p' "$RUN/summary")
VERIFICATION='not independently run'
if [ "$RC" -eq 124 ]; then
  STATUS=timeout; REASON='Antigravity exceeded the 1200-second wall-clock limit'
elif [ "$STATUS" = ready ]; then
  if [ "$RC" -ne 0 ]; then
    STATUS=partial; REASON="Antigravity exited $RC despite its success event"
  elif cmp -s "$RUN/before" "$RUN/after"; then
    STATUS=refused; REASON='No implementation diff was produced'
  elif bash -c "$VERIFY" > "$RUN/verification" 2>&1; then
    STATUS=complete; REASON='Independent verification passed'; VERIFICATION='independently executed; exit 0'
  else
    STATUS=partial; REASON='Independent verification failed'; VERIFICATION='independently executed; nonzero exit'
  fi
fi
printf 'GEMINI REPORT\nLANE: gemini-implementer · Gemini 3.8 Flash (%s) · Antigravity CLI\nSTATUS: %s\nOBJECTIVE: %s\nCHANGES:\n' "$MODEL" "$STATUS" "$(grep -m1 '^OBJECTIVE:' "$SPEC_FILE" | sed 's/^OBJECTIVE:[[:space:]]*//' || true)"
(diff -u "$RUN/files-before" "$RUN/files-after" || true) | sed -n '/^[+-][^+-]/ { s/^[+-]//; p; }' | cut -f1 | sort -u
printf 'VERIFIED: %s\n%s\n' "$VERIFY" "$VERIFICATION"
[ ! -f "$RUN/verification" ] || tail -n 30 "$RUN/verification" | redact
printf 'GEMINI SAID:\n'; sed '1,2d' "$RUN/summary" | tail -n 30 | redact
printf 'DIAGNOSTICS:\n'; tail -n 15 "$RUN/diagnostics" | redact
printf 'GAPS: %s\n' "$REASON"
[ "$STATUS" = complete ]
