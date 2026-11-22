#!/usr/bin/env bash
# Runs every Copy Cat test suite. Browsers default to the ones under ~/.cache/copycat-debug;
# override with CHROME_SHELL (chrome-headless-shell) and CHROME_FULL (Chrome for Testing, for the
# end-to-end tests that load the real extension).
set -u
cd "$(dirname "$0")"
CACHE=~/.cache/copycat-debug
if [ -d "$CACHE/libroot" ]; then
  export LD_LIBRARY_PATH="$(find "$CACHE/libroot" -name '*.so*' -printf '%h\n' | sort -u | paste -sd:)${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
SHELL_EXE="${CHROME_SHELL:-$(ls -d $CACHE/browsers/chrome-headless-shell/linux-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | tail -1)}"
FULL_EXE="${CHROME_FULL:-$(ls -d $CACHE/browsers/chrome/linux-*/chrome-linux64/chrome 2>/dev/null | tail -1)}"
fails=0
run() {   # run <label> <exe> <script> [args...]
  local label=$1 exe=$2; shift 2
  printf '%-34s ' "$label"
  local out; out=$(CHROME_EXE="$exe" timeout 400 node "$@" 2>&1)
  local summary; summary=$(printf '%s\n' "$out" | grep -E 'passed,|errors:|HANG|^now ' | tail -1)
  printf '%s\n' "${summary:-$(printf '%s\n' "$out" | tail -1)}"
  if printf '%s\n' "$out" | grep -qE 'FAIL|HANG|Error'; then fails=$((fails + 1)); printf '%s\n' "$out" | grep -E 'FAIL|HANG|Error' | head -5; fi
}
node ../history-core.test.mjs | tail -1 | sed 's/^/history-core unit tests            /'
node ../groups-core.test.mjs | tail -1 | sed 's/^/groups-core unit tests             /'
run 'zoom jitter (Wikipedia)'          "$SHELL_EXE" test4.mjs
run 'highlighter + freeze (Wikipedia)' "$SHELL_EXE" shots6.mjs
run 'copy path (Wikipedia)'            "$SHELL_EXE" copytest.mjs
run 'bookend freeze (synthetic)'       "$SHELL_EXE" synth10.mjs
run 'Identify names (tests/names.html)' "$SHELL_EXE" test5.mjs
run 'history picker (tests/fields.html)' "$SHELL_EXE" test7.mjs
run 'form groups (tests/forms.html)'   "$SHELL_EXE" test8.mjs
run 'wrap styles + highlight color (16)' "$SHELL_EXE" test16.mjs
run 'Space redraw + keycaps (20)'      "$SHELL_EXE" test20.mjs
run 'invisible chars in words (21)'    "$SHELL_EXE" test21.mjs
run 'wrapped inline hit test (22)'     "$SHELL_EXE" test22.mjs
run 'arrow ← / → move (23)'            "$SHELL_EXE" test23.mjs
run 'mouse-move cost (Wikipedia)'      "$SHELL_EXE" movecost.mjs
if [ -n "$FULL_EXE" ]; then
  run 'end-to-end history (real ext)'  "$FULL_EXE" e2e7.mjs
  run 'end-to-end groups (real ext)'   "$FULL_EXE" e2e8.mjs
  run 'end-to-end Insert/Alt+V (plan 12)' "$FULL_EXE" e2e12.mjs
  run 'end-to-end group editor (plan 13)' "$FULL_EXE" e2e13.mjs
  run 'end-to-end names/icons/panel/popup (14)' "$FULL_EXE" e2e14.mjs
  run 'end-to-end highlight color (17)'   "$FULL_EXE" e2e17.mjs
else
  echo 'end-to-end: skipped (no Chrome for Testing; set CHROME_FULL)'
fi
echo; [ "$fails" -eq 0 ] && echo 'ALL SUITES OK' || echo "$fails suite(s) with failures"
exit "$fails"
