# Plan 26: Move the Multi-snip hotkeys to the end of "While selecting" (IMPLEMENTED 2026-11-23)

## Request
In the popup help, move the Right-click and Shift+Space rows to the end of the "While selecting" list,
just above ANY TIME, since they are the Multi-snip ones.

## Change
- `popup.html`: in the "While selecting" `dl.keys`, move these two rows from after Click to after Esc
  (order kept: Right-click, then Shift+Space):
  - `Right-click` — Multi-snip: freeze it and add another
  - `Shift+Space` — Switch between single-snip or multi-snip modes

New order: Click, Wheel ↑ ↓, ← →, Space, X, N, S, Esc, Right-click, Shift+Space.
No wording, CSS or JS changes.

## Testing
- Run `tests/headless/e2e14.mjs` (popup checks; the Shift+Space row is matched by text, not position).
- Screenshot the popup to check the order.
