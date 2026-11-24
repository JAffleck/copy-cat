# Plan 28: Preview header style as one keycap; cat-colored cat in the copied icon (IMPLEMENTED 2026-11-23)

## Requests
1. In the copy preview's header line, show the style as the first item (its icon, e.g. the set of
   quotes) plus the text description, all inside one keycap, and remove the keycaps that follow it
   (closing quote/bracket, `+ ,`, the bullet or number character).
2. "Text Copied" icon: the cat inside it uses the cat's main color from the extension icon
   (orange), while the sheets (rectangle paths) and text stay blue.

## 1. Header keycap
```
before:  “” Quotes ["]                        Multi-Snip
         “”, Quotes + commas ["] + [,]        Multi-Snip
after:   [ “” Quotes ]                        Multi-Snip
         [ “”, Quotes + commas ]              Multi-Snip
```
The icon already shows the current variant (quote, parenthesis, bracket… via Q) and the bullet /
number style, so the trailing keycaps aren't needed. The mode text on the right is unchanged.
- `content/overlay.js`, `updateUI`: the header becomes
  `<span class="kc style-kc">{icon}<span class="style-name">{name}</span></span>` + the mode text.
  Remove `styleKeycaps()` and the `.kc-plus` CSS (only used there).
- CSS `.style-kc`: `display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px;
  font: 600 12px system-ui, sans-serif` (keeps `.kc`'s dark fill, border and thick bottom edge;
  the name in the UI font, not monospace).
- `tests/headless/test20.mjs`: the keycap checks become: exactly one keycap in the header, holding
  the style icon (`svg.style-icon`) and the style's name; no `.kc-plus`.

## 2. Cat color
- Main color of the cat in `128.png` (most common orange pixel): **#e8b57c**.
- `style-icons.js`, `copyCatIconSvg`: the cat-head path gets `fill="#e8b57c"` instead of
  `currentColor`. The eyes stay cut out (background shows through). Sheets keep `currentColor`
  (blue in both toasts).

## Testing
- `tests/headless/test20.mjs`, then the full `run-all.sh`.
- Screenshots of the preview header and both copied toasts.
