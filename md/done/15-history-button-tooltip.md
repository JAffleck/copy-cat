# Plan 15: popup History button — label + icon only, shortcut in the tooltip (IMPLEMENTED 2026-11-21)

## Request
"Rather than show the hotkey for history, just show History + the icon, and have hovering show the
hotkey for it: Ctrl+Shift+H - Toggle copy history panel"

## Changes
- `popup.html`: button shows "📋 History" only (the `<kbd>` is removed); tooltip
  "Ctrl+Shift+H - Toggle copy history panel".
- `popup.js`: the tooltip uses the shortcut the browser actually assigned; if none, "No shortcut set -
  Toggle copy history panel (set one in Extensions → Keyboard shortcuts)". The "Any time" list keeps
  its Ctrl+Shift+H row.
- Test: `e2e14` checks the button text and tooltip.
