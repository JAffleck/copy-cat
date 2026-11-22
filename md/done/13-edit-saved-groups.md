# Plan 13: Edit a saved form group in the side panel (expand fields, copy one value, remove one) (IMPLEMENTED 2026-11-21)

## Request
"In Copy Cat history, create an Edit too, that expands all of the fields, and allows a copy of a
single value, or removing a value from filled values."

## Behavior
- Each saved group gets an **Edit** button (toggles to **Done**). It expands the group into one row
  per field: label (or name/type), the saved value, and two buttons:
  - **Copy**: copies that single value (select → its visible text, e.g. "GU - Guam"; checkbox/radio →
    "checked"/"unchecked").
  - **Remove**: removes that field from the group, so it's no longer filled (the rest still are).
- Unchecked radio buttons (saved only to know the group's choices; never filled) are listed greyed.
- Expanded groups stay expanded when the panel redraws after a change.
- A group whose last field is removed stays (0 fields) so it can be deleted or renamed deliberately.

## Changes
- `groups-core.js`: `groupsRemoveField(list, id, index, fingerprint)` — removes `fields[index]` only if
  its label+value still match (else the first field that matches), so quick repeated clicks can't
  remove the wrong one.
- `background.js`: `GROUP_REMOVE_FIELD` message.
- `sidepanel-groups.js`: Edit/Done toggle, field rows with Copy/Remove, expanded state kept.
- `sidepanel.css`: field-row styles.

## Testing
- Node unit test for `groupsRemoveField` (index, fingerprint mismatch, last field).
- End-to-end (real extension): Edit expands N rows; Copy puts the single value on the clipboard;
  Remove drops the field from storage and the row, editor stays open; filling the edited group skips
  the removed field. Re-run all suites.

## Files
`groups-core.js`, `background.js`, `sidepanel-groups.js`, `sidepanel.css`,
`tests/groups-core.test.mjs` (new), `tests/headless/e2e13.mjs` (new)

## Outcome
- Implemented as planned (`groupsRemoveField` with fingerprint check, `GROUP_REMOVE_FIELD`, Edit/Done
  field editor that stays open across redraws). Plan 14 then renamed the button to **Edit fields**
  (the edit icon is now rename) and turned Remove into the delete icon.
- Tests: `tests/groups-core.test.mjs` 4/4; `tests/headless/e2e13.mjs` 10/10 (expand, copy single value
  incl. select text, remove from storage + panel, fill skips the removed field).
- Found while running everything: plan 13 shifted the side-panel buttons, so `e2e8`'s position-based
  Delete click hit Rename (a blocking `prompt()`); fixed in plan 14 by clicking the icon by title.
