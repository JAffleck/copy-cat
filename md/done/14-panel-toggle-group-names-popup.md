# Plan 14: hide/show the history panel, default group names with rename/delete icons, icon license, popup cleanup (IMPLEMENTED 2026-11-21)

## Requests
1. A way to hide the Copy Cat history panel; Ctrl+Shift+H to toggle it.
2. Groups get a default name (Group 1, Group 2…); an edit icon on the right renames; delete uses a
   delete icon. Icons: the Material "edit" and "delete" icons used in `../bug-reporter`
   (`src/ui/icons.js`).
3. Add the Google Material icons license, stating some icons are used and some modified.
4. Make the popup look better and make more sense: legend shouldn't repeat "Split +" for every style
   (footnote instead); Combined doesn't need "+ Quotes".

## Changes
### 1. Panel toggle (`background.js`, `sidepanel.js`, `manifest.json`, `content/picker.js`)
- Command `toggle-history-panel`, suggested key **Ctrl+Shift+H** (Cmd+Shift+H on Mac).
- The panel connects a port to the background with its window id; the background knows which windows
  have it open. Toggle: open → ask that panel to close itself (`window.close()`); closed →
  `chrome.sidePanel.open({ windowId })` (called directly in the command handler so it counts as a user
  action). The panel reconnects if the background restarts.
- Fallback when the browser didn't assign the shortcut: the page sends Ctrl+Shift+H to the background,
  which toggles only if the command has no shortcut (no double toggle). Closing always works this way;
  opening may be refused by the browser without a real shortcut — then a toast points to the toolbar.
- A close button (✕) in the panel header.

### 2. Group names and icons (`content/formsnap.js`, `sidepanel-groups.js`, `sidepanel.css`)
- New groups are named **Group N** (N = highest existing "Group N" + 1). The first saved values move to
  the meta line ("6 fields · site · 123, 456"). Existing groups keep their names.
- Group card header: name on the left; **edit icon** (rename in place: Enter saves, Esc cancels, blur
  saves) and **delete icon** on the right. Actions row: Fill, Edit fields.
- Delete icon also used for history entries and for removing a field in the field editor.
- Icons: inline SVG paths copied from bug-reporter (`edit`, `delete`), `fill: currentColor`.

### 3. License (`THIRD_PARTY_NOTICES.md`, `licenses/Apache-2.0.txt`)
- Material Icons by Google, Apache License 2.0; lists icons used (edit, delete) and notes that some
  icons are used as-is and some modified (size/color via CSS, inline). Full license text copied from an
  on-disk pristine Apache-2.0 LICENSE (chromium-bidi package; placeholder copyright line intact).

### 4. Popup (`popup.html`, `popup.css`, `popup.js`)
- Header: icon + title, **History** button with its shortcut.
- Status: current style as a pill (e.g. "🟩 Quotes + Commas · split", "🔴 Combined").
- Snipping: Single-snip / Multi-snip as a segmented toggle (Shift+Space); remove the duplicate
  Multi-snip checkbox at the bottom.
- Styles: "🔴 Combined — one line"; "Split into lines*" with Raw, Quotes, Quotes + commas, CSV,
  Numbers, Bullets in a compact grid; footnote "*Lists, elements and multiple selections (Multi-snip)
  are split into lines before the style is applied. Tab / Shift+Tab to change; Q for quote/bullet/number
  style."
- Hotkeys grouped correctly: **Start** (Ctrl+Shift+Click), **While selecting** (Click, Right-click,
  Esc, Wheel/↑↓, Space, Tab, Q, X, N, S), **Any time** (Alt+Click a field, Alt+Click, Alt+V,
  Ctrl+Shift+H). Fixes Space/zoom listed under Copy History and the stray spacing in the Alt+V line.
- Status labels in `popup.js` match the new names.

## Testing
- e2e: Ctrl+Shift+H command path (background toggle) opens/closes; panel ✕ closes; port tracking.
  (Real browser shortcut press is manual.)
- e2e: saving two groups → "Group 1", "Group 2"; rename via edit icon (Enter / Esc); delete icon; history
  delete icon; field remove icon.
- Popup screenshot for review; status labels per mode.
- Fix `e2e8` (its Delete click now targets the icon), re-run all suites.

## Outcome
- All four parts implemented as planned. Also aligned the in-page preview labels with the popup
  (Quotes, Quotes + commas, Numbers, Bullets). Icons: `sidepanel-icons.js` (edit, delete, close).
- License: `THIRD_PARTY_NOTICES.md` + `licenses/Apache-2.0.txt` (pristine Apache-2.0 text from the
  chromium-bidi package; bug-reporter had no license file, only README links to Google's icon pages).
- Tests: `tests/headless/e2e14.mjs` 13/13 (Group 1/Group 2, meta line, rename Esc/Enter, group and
  history delete icons, panel registers/closes/unregisters via the toggle, command registered, popup
  labels incl. Combined, snipping toggle); screenshots `out/popup.png`, `out/sidepanel-groups.png`.
  Older suites updated for the new names/buttons (`test8`, `e2e8`, `e2e13`); all 15 suites pass.
- Manual in the real browser: pressing Ctrl+Shift+H (opening needs the real shortcut; the in-page
  fallback can close but the browser may refuse to open without it — the popup shows whether the
  shortcut is assigned).
