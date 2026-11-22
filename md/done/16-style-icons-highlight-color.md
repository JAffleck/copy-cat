# Plan 16: SVG style icons, one highlight color (chosen in the popup), popup hotkey fixes (IMPLEMENTED 2026-11-22)

## Requests
1. Replace the emoji style icons with SVG icons in the popup and the in-page preview:
   Combined (given), Raw/multiline (given), Numbers (given), Bullets (given); quote marks drawn as
   curly/smart quotes — a pair for double quotes, a single one for single quotes, a backquote, and
   parentheses, brackets and curly braces; Quotes + commas = the quote marks then `,`; CSV = the
   multiline icon with lines ~10% shorter and `,` after each line except the last.
2. Highlight color no longer follows the style; the style only shows in the preview window. The color
   is chosen from the highlighter colors (not red and green), blue by default, only in the popup.
3. Popup: don't show the current style at the top; add hotkey rows
   `Shift+Space` Switch between single-snip or multi-snip modes, and
   `Q / Shift+Q` Cycle style between quote, bullet or number (its own line).

## Decisions
- bug-reporter has no highlighter-only palette: its highlighter uses the shared color flyout
  (`#D93025 #188038 #FF0000 #00FF00 #0000FF #FFFF00 #000000 #FFFFFF`) at 35% opacity. Without the
  red/green preset shades: **`#FF0000 #00FF00 #0000FF #FFFF00`** (black/white left out: they don't work
  as highlights). **Default `#0000FF` (blue).** Active selection 20%, frozen (Multi-snip) 40%.
- Quote styles: Q cycles `"` `'` `` ` `` `( )` `[ ]` `{ }` (adds the three bracket pairs; each line is
  wrapped with the open/close pair; only symmetric quotes are escaped inside).

## Changes
- New `style-icons.js` (shared by the popup and the content scripts): SVG markup for every style;
  quote marks drawn as paths (opening = closing mark rotated 180°), fill `currentColor`.
- `content/state.js`: `QUOTE_PAIRS` replaces `STYLE_QUOTES`; `settings.highlightColor` (default blue).
- `content/output.js`: wrap with open/close; escape only symmetric quotes.
- `content/overlay.js`: highlight uses `settings.highlightColor`; preview header shows the style's SVG
  icon + label (+ the bullet/number character).
- `popup.html/css/js`: remove the Style row; legend with the SVG icons (+ the six quote variants);
  Highlight color swatches (saved to `chrome.storage.local.highlightColor`); hotkey rows for
  Shift+Space and Q / Shift+Q.
- `manifest.json`: load `style-icons.js` first among the content scripts.

## Testing
- Headless: output for each quote style incl. `(x)`, `[x]`, `{x}`; highlight color independent of style;
  frozen at 40%; preview header shows the SVG per style.
- e2e: popup has no Style row; swatches save the color; hotkey rows present; screenshots of the popup
  and the preview for review. Re-run all suites.

## Outcome
- Implemented as planned: `style-icons.js` (loaded first by the content scripts and by the popup),
  `QUOTE_PAIRS` (Q cycles `"` `'` `` ` `` `( )` `[ ]` `{ }`), one highlight color from the popup
  (default blue, frozen 40%), preview header = style icon + name + snipping mode, popup without the
  Style row, with Highlight swatches, SVG legend + quote variants, Shift+Space and Q / Shift+Q rows.
  Notices updated for the Material style icons.
- Highlight colors: the user rejected the first proposal (bug-reporter's preset red/green). bug-reporter
  has no highlighter-only palette (its highlighter uses the shared flyout at 35%), so the colors are
  that list's `#FF0000 #00FF00 #0000FF #FFFF00`, blue default.
- Tests: `tests/headless/test16.mjs` 14/14; `e2e14` updated (no Style row, legend icons, hotkey rows,
  swatches save) 17/17; screenshots `out/popup.png`, `out/preview.png`, `out/icons.png`. All 16 suites
  pass.
- **Found, not fixed (separate):** `getCleanText` reads `innerText` from a detached clone, which the
  browser treats as unrendered, so list items only split into lines when the page's HTML has line
  breaks between them. Minified pages (common in React apps) copy a list as one line.
