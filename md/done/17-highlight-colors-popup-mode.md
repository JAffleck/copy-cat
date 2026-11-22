# Plan 17: highlight follows the picked color, the recording palette's colors, no mode row in the popup (IMPLEMENTED 2026-11-22)

## Reports
1. "Why isn't the highlight color following the color selected?"
2. "Why aren't there more highlight colors? Aren't there more in the separate window recording?"
3. "You didn't remove the mode at the top, I still see single-snip and multi-snip."

## Findings / decisions
- bug-reporter's recording annotations use `COLORS` in `src/js/videoTelemetry.js`:
  `#FF0000 #00FF00 #0000FF #FFFF00 #00FFFF #FF00FF #000000 #FFFFFF`. Use its six colors:
  red, green, blue (default), yellow, **cyan**, **magenta** (black/white left out: no visible highlight).
- Color not followed: reproduce with the real extension (`tests/headless/e2e17.mjs`): pick in the popup,
  start selecting, read the highlight's real background through CDP; also after Tab (the page saves its
  settings) and when the color changes while selecting. Fix whatever it shows.

## Changes
- Popup: remove the Snipping (Single/Multi-snip) row and its hint; Shift+Space stays in the hotkeys.
  Highlight swatches: 6 colors.
- `content/overlay.js`: allowed colors = the 6.
- Color fix: per the repro.

## Testing
`e2e17.mjs` (real extension) + `e2e14` popup checks updated; all suites.

## Outcome
- Real-extension repro (`e2e17.mjs`): picking a color then selecting already worked, so the user most
  likely saw a tab not refreshed after the update (old script, colors by style). Two real bugs found
  and fixed in `content/lifecycle.js`:
  1. A color changed in the popup while a page was selecting didn't apply until the next activation
     → the page listens to `chrome.storage.onChanged` and redraws.
  2. Tab / Q / Shift+Space while selecting saved *all* settings, putting back the color loaded at
     the start (undoing the popup choice) → the page never writes popup-owned settings
     (`highlightColor`).
- Colors: bug-reporter's recording palette (`videoTelemetry.js` `COLORS`) without black/white: red,
  green, blue (default), yellow, cyan, magenta.
- Popup: removed the Single/Multi-snip row (and its now-dead status/mode code in `popup.js`); per a
  follow-up request, † on Quotes and Quotes + commas, a † note "Press Q / Shift+Q to cycle between
  quote, parenthesis and bracket styles" with the six variants, and the Q / Shift+Q hotkey row removed.
- Tests: `e2e17` 6/6 (popup pick → highlight color; kept after Tab; live change while selecting; not
  overwritten), `e2e14` 18/18; all 17 suites pass.
