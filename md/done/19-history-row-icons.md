# Plan 19: history entries — icon buttons (Copy, Insert, Pin, Delete), shown on hover (IMPLEMENTED 2026-11-22)

## Request
"Yes" — switch the history entries' text buttons (Copy / Insert / Pin) to icons, like the field rows.

## Changes
- `sidepanel-icons.js`: `paste` (Material `content_paste` from `../bug-reporter/svg/material`, scaled
  from its 960-unit viewBox), `pin` (Material `push_pin`, outlined) and `pinFilled` (filled).
- `sidepanel.js`: history actions = copy icon (Copy), paste icon (Insert into the page), pin icon
  (Pin / Unpin), delete icon; titles keep the old wording.
- `sidepanel.css`: history actions hidden until the entry is hovered (or a button has keyboard focus);
  a pinned entry always shows its pin, filled and amber.
- `THIRD_PARTY_NOTICES.md`: add `content_paste` and `push_pin`.

## Testing
Render the icons for review; `e2e7` (history panel) clicks by title, checks hover-reveal and that a
pinned entry's pin stays visible; screenshot; side-panel suites.

## Outcome
- Implemented as planned (`copy`, `paste`, `pin`/`pinFilled`, `delete`); icons reviewed at 48px and 16px
  (`tests/headless/out/histicons.png`).
- Tests: `e2e7` 13/13 (Pin/Delete by title; icons hidden until hover, a pinned entry keeps its amber pin
  visible, hover shows all four; screenshot `out/history-hover.png`); e2e13 and e2e14 still pass.
