# Plan 31: Popup tabs (Copier / Hotkeys) and a big "start selecting" icon button (IMPLEMENTED 2026-11-23)

## Request
- Remove the Styles section; move its `Tab` / `Shift+Tab` Cycle styles (i) row to just above the
  Right-click hotkey.
- Move all the hotkey info (everything below the Highlight line) into its own tab, "Hotkeys".
- A "Copier" tab has the Highlight color boxes and a large icon button (Copy Cat's large icon,
  rounded corners) that starts selecting, the same as Ctrl+Shift+Click, for people who'd rather
  not use hotkeys.

## Popup layout (after)
```
[cat] Copy Cat                     [History]
[ Copier ] [ Hotkeys ]
─────────────────────────────────────────── Copier tab (default)
Highlight  ■ ■ ■ ■ ■ ■
        ┌──────────────┐
        │  (cat icon)  │   ← 120×120 button, rounded corners (16px)
        └──────────────┘
         Start selecting
─────────────────────────────────────────── Hotkeys tab
START
  Ctrl+Shift+Click  Start selecting (again to stop)
WHILE SELECTING
  Click            Copy the selection
  Wheel ↑ ↓ / ← → / Space / X / N / S / Esc   (unchanged)
  Tab / Shift+Tab  Cycle styles (i)        ← moved here
  Right-click      Multi-snip: freeze it and add another
  Shift+Space      Switch between single-snip or multi-snip modes
ANY TIME
  (unchanged) + the shortcut note
```
The Tab row uses that list's layout (keys right-aligned like the rows around it). The (i) still opens
the style-info popover (Combined, the 6 split styles, Q / Shift+Q). Because the row is now lower in
the popup, the popover opens above the row when there isn't room below.

## Changes
- `popup.html`: tab bar (`role="tablist"`, "Copier" and "Hotkeys" `role="tab"` buttons) + two
  `role="tabpanel"`s. Copier: the Highlight row and the start button
  (`<button id="start-selecting">` with `<img src="icon-1024-cropped.png">`, caption
  "Start selecting", tooltip "Start selecting on this page (same as Ctrl+Shift+Click)").
  Hotkeys: the current Start / While selecting / Any time sections, with the Tab row moved above
  Right-click. The Styles section is removed; the `#style-info` popover stays (in the Hotkeys panel).
- `popup.css`: tab bar (selected tab underlined in blue), hidden inactive panel, start button
  (rounded 16px, image 120px, hover/focus ring, pressed state), caption.
- `popup.js`: tab switching (click, ← / → between tabs; Copier by default). Popover placement:
  below the row, or above it if it would run past the bottom. Start button: get the active tab,
  send `{ type: 'START_SELECTION', tabId }` to the background; on success close the popup; on
  failure show the reason under the button (e.g. browser pages can't be used).
- `background.js`: `START_SELECTION` → send to the tab's top frame; if no content script is
  there yet (tab opened before install/reload), inject the content scripts and retry (same as
  the existing `routeToPage` fallback, but always frame 0).
- `content/lifecycle.js`: on `START_SELECTION`, if not already selecting, `startSelectionMode()`
  with no mouse position, so nothing is highlighted until the mouse moves over the page (the
  popup has just closed); responds `{ ok: true }`.

## Tests
- `tests/headless/e2e14.mjs` popup checks: tabs "Copier" (selected by default, with the swatches
  and the start button; its image loads) and "Hotkeys" (the sections); no Styles section; Tab row
  directly above Right-click; (i) popover still opens with the 7 icons + 6 quote variants +
  Q / Shift+Q row; Esc closes it. Screenshots of both tabs.
- New e2e check: open a page tab, send `START_SELECTION` with its tabId from the extension; the
  page is in selection mode (preview host present; moving the mouse highlights; Esc exits). Also
  on a tab opened before the extension loaded (injection path).
- Full `run-all.sh`.
