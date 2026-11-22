# Plan 7: clipboard history + Alt+click picker + paste into fields (IMPLEMENTED 2026-11-21)

## Behavior (works on any page, without Ctrl+Shift+click)
| Action | Result |
|---|---|
| Copy anything with Copy Cat | Saved to history (shared by all tabs/windows) |
| Alt+click a form field | Picker opens under the field; choosing an entry pastes it into the field |
| Alt+click anything else (not a link) | Picker opens at the mouse; choosing an entry copies it to the clipboard |
| Alt+click a link | Ignored by Copy Cat (Chrome's download-link behavior kept) |
| Alt+Shift+V | Same as Alt+click on the field that has the cursor (else copy mode at page center) |
| Side panel (popup button "Open history") | Full history beside the page: Copy / Insert (into last focused field in the current tab) / Pin / Delete / Clear |
| During Ctrl+Shift+click selection mode | Alt+click does nothing (finish or Esc the copy first) |

## Decisions (user: "Sounds good. Build it." → recommended defaults)
1. Links exempt from Alt+click. 2. Picker + side panel + Alt+Shift+V. 3. Record every copy, and in
Multi-snip each item separately plus the combined copy. 4. Keep 50 unpinned entries, pinning
unlimited. 5. Support forms in iframes (`all_frames: true`).

## Recording (`content/output.js`)
- In `commitCopy` (`content/output.js`), after a successful clipboard write, call
  `CopyCat.history.record(items, combined)`: items = clean text of each frozen selection + the
  active one (Multi-snip), combined = the compiled output. Single-snip: just the one text.
- Never record text from `input[type=password]` or fields with `autocomplete` `cc-*` /
  `current-password` / `new-password` / `one-time-code`.

## Storage (`chrome.storage.local`)
- `clipHistory`: array of `{ id, text, time, title, url, pinned }`, newest first.
- Recording an existing text moves it to the top (no duplicates). Trim to 50 unpinned.

## New files
- `content/history.js` (content script, loaded after `content/lifecycle.js`, same isolated world): shared
  `CopyCat` namespace (storage helpers, `record`), Alt+click handling, picker UI (own closed shadow
  root), field insertion, Alt+Shift+V handler, focus tracking for the side panel.
- `background.js` (service worker): forwards the Alt+Shift+V command to the active tab; tracks the
  tab/frame with the most recently focused field (`FOCUS` messages) so side-panel "Insert" goes to
  the right frame; opens the side panel from the popup.
- `sidepanel.html` / `sidepanel.js` / `sidepanel.css`: history list (and, in plan 8, saved groups).

## Alt+click details (`history.js`)
- Capture-phase `mousedown` on `window`: left button, Alt only (no Ctrl/Shift/Meta), Copy Cat
  selection mode not active, target not inside `a[href]` (unless the target itself is a field).
- `preventDefault` + stop propagation for that mousedown and the matching mouseup/click, so the
  page's click handlers don't run.
- Field = editable target: `input` (text-like types), `textarea`, `select`, contenteditable, or the
  input of a `[role=combobox]`. Field → insert mode (focus it; caret kept if already focused, else
  at end). Otherwise → copy mode.

## Picker (`history.js`)
- Small panel under the field (or at the mouse), max ~8 rows visible, scrollable: pinned first, then
  newest. Row = text (one line, truncated) + page title + age.
- Keys while open (captured; the field keeps focus and its selection): ↑/↓, Enter, 1–9, typing
  filters, Backspace edits filter, Esc closes. Click a row to choose. Click outside closes.

## Inserting into a field (`history.js`)
1. Focus field; `document.execCommand('insertText', false, text)` (replaces the selection; undoable;
   frameworks see a normal input event).
2. If refused or the value didn't change: native value setter (`HTMLInputElement.prototype` /
   `HTMLTextAreaElement.prototype` `value` descriptor) + bubbling `input` + `change` events
   (works with React-controlled inputs and Vue `v-model`).
3. `select`: choose the option whose text or value matches (case-insensitive, trimmed), fire
   `input` + `change`. No match → toast "No matching option".
4. Copy mode: `navigator.clipboard.writeText` + toast.

## Manifest
- `permissions`: add `sidePanel`. `background.service_worker`: `background.js`.
- `side_panel.default_path`: `sidepanel.html`.
- `commands`: `open-history-picker`, suggested key `Alt+Shift+V` (changeable in
  `chrome://extensions/shortcuts`).
- `content_scripts`: append `content/history.js` after the plan-9 files; `all_frames: true`.
- Popup: "Open history" button (side panel) and hotkey lines for Alt+click / Alt+Shift+V.

## Testing (headless, `~/.cache/copycat-debug`; test pages in `tests/`)
- `tests/fields.html`: plain input, textarea, select, contenteditable, React controlled input and
  Vue `v-model` (UMD builds from a CDN), input inside a same-origin iframe, a link.
- Record: copies (single + Multi-snip) appear in `clipHistory`, deduped, capped; password text never.
- Alt+click field → picker → Enter: value appears, survives the framework's next render (React
  state shows it), undo works for execCommand path; insert time < 50 ms; no errors.
- Alt+click link → no picker. Alt+click blank area → copy mode writes clipboard.
- Alt+click ignored during selection mode.
- Manual in Chrome: Windows Alt-menu focus after Alt+click; side panel Copy/Insert; Alt+Shift+V.

## Files
- New: `content/history.js`, `background.js`, `sidepanel.html`, `sidepanel.js`, `sidepanel.css`,
  `tests/fields.html`
- Edited: `manifest.json`, `content/output.js` (record hook in `commitCopy`), `content/lifecycle.js` (small `CopyCat` hooks:
  selection-mode flag), `popup.html`, `popup.js`

## Outcome
- Implemented as planned, split into: `history-core.js` (store logic, serialized writes),
  `background.js` (single writer, Alt+Shift+V relay, side-panel Insert routing via session storage),
  `content/insert.js` (paste helpers, reused by plan 8), `content/picker.js` (Alt+click, picker,
  focus tracking, messages), `sidepanel.html/js/css`; `content/output.js` records each copy
  (Multi-snip items + combined; never from password/card fields). Popup: "Open copy history"
  button + hotkey help. Manifest: `sidePanel`, background, side panel, command, `all_frames`.
- Picker extension point `pickerSections` (and `copyCatPanelSections` in the side panel) for plan 8.
- Tests:
  - `tests/history-core.test.mjs` (node): 7/7, incl. 20 concurrent records all kept.
  - Headless with stubbed extension APIs (`tests/fields.html`): 24/24 — plain/prefilled/email/
    number/textarea/select/contenteditable/React controlled/Vue v-model/iframe; filter keys don't
    reach the field; undo works; insert ~0.9 ms; password and links refused; copy mode; ignored
    during selection mode; password copies not recorded.
  - End-to-end with the real unpacked extension (Chrome for Testing): 11/11 — loads, command
    registered, copy reaches real clipboard + history, Alt+click paste, side-panel Insert route,
    OPEN_PICKER route, side panel list/Pin/Delete.
  - Regressions all pass; mouse-move cost unchanged.
- Not testable headless (manual): the real Alt+Shift+V keypress, opening the side panel from the
  popup button, and the Windows Alt-menu focus after Alt+click.
