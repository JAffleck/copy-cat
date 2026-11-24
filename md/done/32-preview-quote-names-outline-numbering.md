# Plan 32: Preview: named quote styles, counting letters / roman numerals, Q hint, keycap hints (IMPLEMENTED 2026-11-23)

## Requests
1. In the preview header keycap, name the quote style instead of the generic "Quotes":
   Double quotes, Single quote, Backticks, Parenthesis, Square brackets, Curly braces; with commas:
   "{name} + commas" (e.g. "Parenthesis + commas"). The icon in front stays (it already shows the
   current marks).
2. Numbers: letters and roman numerals count up like `1.` does (A. B. C. …, a. b. c. …,
   i. ii. iii. iv. …), roman numerals correct into the thousands.
3. When the current style changes with Q, show a line under the Space hint:
   `Q / Shift+Q  Change output style`.
4. Keys in the preview's hint lines are shown as keycaps, not `[Space]`.

## Preview (after)
```
[ () Parenthesis + commas ]                 Multi-Snip
"Search",
"Results"
 Space  Zoom into surrounding brackets/quotes
 Q / Shift+Q  Change output style
Name from aria-label ·  N  all names
```

## Changes
- `content/overlay.js`
  - Header name: `QUOTE_NAMES = ['Double quotes', 'Single quote', 'Backticks', 'Parenthesis',
    'Square brackets', 'Curly braces']` indexed by `settings.quoteIndex`; QUOTED → the name,
    QUOTED_COMMA → name + " + commas". Combined, Raw, CSV, Numbers, Bullets unchanged.
  - Hints use a small keycap (`.kc.kc-sm`: 10.5px, 15px line height):
    `Space` Zoom into surrounding brackets/quotes / `Space` Back to element zoom;
    `N` all names; Identify view: `1`–`9` Copy · `Click` Copy 1 · `N` / `Esc` Back.
  - New Q line (grey, under the Space line) when the style has Q variants: Combined, Quotes,
    Quotes + commas, Bullets, Numbers (the same set the Q key acts on in `events.js`).
- `content/output.js`: NUMBERED uses `outlineMarker(oChar, n)`:
  - `1.` → `n.`; `A.` / `a.` → A…Z, then AA, AB… (spreadsheet style) / lowercase;
  - `i.` → lowercase roman numerals (i, ii, iii, iv, … ix, x, xl, xc, cd, cm, m…), correct up to
    3999 (mmmcmxcix); past 3999, falls back to the number.
  - Counting per item as today (restarts per Multi-snip block, as `1.` does now).
- Popup style-info is unchanged ("Quotes", "Quotes + commas" there describe the style family).

## Tests
- `tests/headless/test20.mjs`: header names per quote index (Double quotes, Square brackets,
  Double quotes + commas, Parenthesis + commas…); Space / Q / N hints are keycaps (no `[Space]`
  text); Q line shown for Combined / Quotes / Quotes + commas / Bullets / Numbers, not for Raw / CSV.
- `tests/headless/test27.mjs` (or new `test32.mjs`): `outlineMarker` for A. (1→A, 26→Z, 27→AA,
  28→AB, 52→AZ, 53→BA, 702→ZZ, 703→AAA), a. lowercase, i. (1→i, 4→iv, 9→ix, 14→xiv, 40→xl,
  90→xc, 400→cd, 900→cm, 1994→mcmxciv, 3999→mmmcmxcix, 4000→4000); compileOutput with
  Numbers/A. over a 3-item list → `A. …\nB. …\nC. …`.
- Full `run-all.sh`; screenshot of the preview.
