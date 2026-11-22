# Plan 18: field editor rows — copy icon and red ✕, shown on hover (IMPLEMENTED 2026-11-22)

## Request
In a saved group's field editor: remove a field with a red ✕ (given Material "close" path) instead of
the trash can; copy a value with a copy icon (given Material "content_copy" path), fixed so the
rectangle's top-left and bottom-right corners connect to the nearest corners of the "L" (top and bottom
right); show these only while the mouse is over that row.

## Changes
- `sidepanel-icons.js`: `x` (given path) and `copy` (given path + two diagonal joins: rectangle
  top-left → top of the L, rectangle bottom-right → bottom-right end of the L).
- `sidepanel-groups.js`: field rows use `iconButton('copy', …)` and `iconButton('x', …, 'danger-x')`.
- `sidepanel.css`: `.danger-x` always red; row icons hidden until the row is hovered (also shown when
  a row button has keyboard focus, so they stay reachable without a mouse).
- `THIRD_PARTY_NOTICES.md`: add the X and copy icons (copy marked modified).

## Testing
Render the icons large for review; `e2e13` updated (copy/remove by icon titles, hidden until hover);
all suites.

## Outcome
- Implemented as planned. The copy icon's joins are stroke lines on the outlines' centre lines
  (L top (4,6) → front sheet top-left (8,3); L bottom-right end (16,21) → front sheet bottom-right
  (19,17)); reviewed at 96px and 16px (`tests/headless/out/copyicon.png`).
- Tests: `e2e13` 14/14 (copy icon + red X, hidden until hover, shown only on the hovered row, X is red,
  copy/remove still work; screenshot `out/field-row-hover.png`); e2e7 11/11, e2e8 5/5, e2e14 18/18.
