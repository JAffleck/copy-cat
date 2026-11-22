# Plan 12: make side-panel Insert and the Alt+V shortcut work in real browsers (IMPLEMENTED 2026-11-21)

## Report
User (Brave, designsystem.digital.gov address form): "I thought this was supposed to work when
clicking Insert, or Alt+V".

## Likely causes (none covered by the plan-7 tests)
1. The shortcut is Alt+Shift+V via `chrome.commands`; browsers only assign a suggested key when it
   doesn't clash, and often not when an unpacked extension is reloaded → pressing it does nothing.
   Alt+V (what the user pressed) was never bound.
2. Tabs open before the extension was reloaded keep orphaned content scripts → Insert gets "no
   receiving end" and fails.
3. Clicking Insert puts focus in the side panel, so the page isn't focused; the plan-7 e2e tests always
   had the page focused. Also, if the field was focused before the scripts loaded, `lastFocusedField`
   is empty.

## Changes
1. `content/picker.js`: handle **Alt+V** and **Alt+Shift+V** directly in the page (capture-phase
   keydown; not in selection mode; ignores AltGr = Ctrl+Alt) → opens the picker for the focused field
   (copy mode if none). The `chrome.commands` shortcut stays as an extra path (and as the way to
   rebind); duplicate opens are ignored.
2. `content/picker.js` INSERT_TEXT: target = last focused field, else `document.activeElement` if
   editable; clear "Click into a field first" message otherwise.
3. `background.js` INSERT_ENTRY / FILL_GROUP_ENTRY: if the tab has no live content script, inject the
   manifest's content scripts (all frames) with `chrome.scripting.executeScript`, then retry (frame 0
   + `activeElement` fallback). Needs the `scripting` permission. Browser pages (chrome://, Web Store)
   still report "not available on this page".
4. Popup: show the shortcut actually assigned (`chrome.commands.getAll`); if none, say so and link to
   the browser's shortcuts page.

## Testing (end-to-end, real extension in Chrome for Testing)
- Alt+V and Alt+Shift+V keypresses in the page open the picker; Enter pastes.
- Insert with the page NOT focused (focus emulation off, another page in front) still pastes.
- Field focused before scripts loaded → Insert uses `activeElement`.
- Orphaned scripts (extension reloaded, tab not refreshed) → Insert injects and succeeds.
- Re-run all suites (`tests/headless/run-all.sh`).

## Files
`content/picker.js`, `background.js`, `manifest.json`, `popup.html`, `popup.js`,
`tests/headless/e2e12.mjs` (new)

## Outcome
- Second report while working: "After Alt+V, selecting a group, nothing gets filled in" (preview
  showed 6/6 matches). Reproduced on the real USWDS form: keyboard (Enter, Enter) and choosing the
  group row by mouse both filled correctly, but **the preview could only be confirmed with Enter —
  clicking it did nothing**. Added **Fill (Enter)** and **Cancel (Esc)** buttons to the preview.
- Also clarified for the user: Ctrl+Shift+click copies text (Insert pastes that one entry into one
  field); filling several fields is form groups (`S` to save, then fill).
- Implemented changes 1–4 as planned, plus: `extensionAlive()` guard so orphaned scripts (left in tabs
  across an extension reload) don't grab Alt+click / Alt+V / Ctrl+Shift+click from the fresh copy;
  `routeToPage()` extracted in `background.js`; `targetFieldForPanel()` shared by Insert and Fill.
- Tests: new `tests/headless/e2e12.mjs` 6/6 (Alt+V, Alt+Shift+V, Insert into an unfocused page, Insert
  into a tab opened before the extension was installed → scripts injected, Alt+V there afterwards,
  preview Fill button). Real site `uswds-address.mjs`: shortcut, row click and Fill button all fill
  all 6 fields. `run-all.sh`: all 12 suites pass (stubs given `runtime.id` for the liveness guard).
- Needs a manual check in Brave: whether it assigns Alt+Shift+V (the popup now shows the assigned
  shortcut; Alt+V works regardless).
