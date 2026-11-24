# Plan 25: Styles section — Tab hotkey row + (i) style-info popup (IMPLEMENTED 2026-11-23)

## Request
In the popup's Styles section, put Tab / Shift+Tab on its own line, styled like the other hotkey
rows and left-aligned: `Tab` / `Shift+Tab`  Cycle styles  (i). The (i) opens a popup with the style
info (Combined, the 6 Split styles) and the Q / Shift+Q hotkey, to save space.

## Popup layout (after)
```
STYLES
Tab / Shift+Tab   Cycle styles (i)

START
Ctrl+Shift+Click  Start selecting (again to stop)
...
```
Clicking (i) (or focusing it and pressing Enter / Space) opens a floating panel just below the row:
```
┌───────────────────────────────────────────┐
│ ▤ Combined — everything on one line       │
│ Split into lines*                         │
│  ≡ Raw              " Quotes†             │
│  ", Quotes + commas ≡, CSV                │
│  1. Numbers         • Bullets             │
│ Q / Shift+Q  Cycle quote & bracket styles │
│              " ' ` ( [ {                  │
│ *Lists, elements and multiple selections  │
│  (Multi-snip) are split into lines before │
│  the style is applied.                    │
│ †Quote styles: Q / Shift+Q picks the mark.│
└───────────────────────────────────────────┘
```
It closes on Esc, a click outside it, or another click on (i).

## Changes
- `popup.html`: the Styles section becomes a `dl.keys` row with Tab / Shift+Tab and "Cycle styles",
  plus an (i) `<button popovertarget="style-info">`. The current legend (Combined row, Split grid,
  footnotes) moves into `<div id="style-info" popover>`, with a Q / Shift+Q hotkey row and the 6
  quote variant icons. The "Tab / Shift+Tab to change" aside in the section title is removed.
- `popup.css`: `dl.keys.left dt { text-align: left }` for the left-aligned Tab row; styles for the
  (i) button (small round outline, blue on hover/open) and the popover panel (dark card, border,
  shadow, positioned under the row at the popup's width).
- `popup.js`: no logic change (icons are still filled by `[data-style-icon]` / `#quote-variants`).
- `tests/headless/e2e14.mjs`: update the popup checks: Tab row present with "Cycle styles"; the
  legend icons (7) and quote variants (6) are inside `#style-info`; the popover is hidden at first
  and shows after clicking (i); the Q / Shift+Q row is in the popover.

The native `popover` attribute gives Esc / click-outside closing and keyboard access with no JS.

## Testing
- Run `tests/headless/run-all.sh` (e2e14 covers the popup).
- Screenshot the popup closed and with the popover open.
