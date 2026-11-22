# Plan 23: ← / → move the selection to the previous / next word or item (while selecting) (IMPLEMENTED 2026-11-22)

## Request
A hotkey that moves the selection a word / item left or right. bug-reporter has no such key (its
Alt+[ / ] change text size), so the user chose **← / →** (pairs with ↑ / ↓ zoom), only while selecting.

## Behavior
- Zoomed in to text (a word, segment or bracket/quote range): ← / → selects the previous / next word in
  document order, continuing across inline formatting (`<b>`, `<phrase>`…) and into the next block;
  hidden text (display:none, script/style) and Copy Cat's own UI are skipped. Words follow the plan-21
  rule (soft hyphens etc. stay inside words).
- Element level (an element or a text node): the previous / next sibling that has visible text or a name
  (plan 5), e.g. list item → list item, `", not "` → the next `<phrase>`.
- Nothing further at that level: the selection stays and the preview briefly says "No more items".
- The new selection scrolls into view if it's off-screen.
- Mouse: small jitter (< 12px from where the key was pressed) keeps the keyboard selection; a real mouse
  move goes back to following the mouse. Space, zoom, start/exit reset this.
- Zoom history is rebuilt for the new spot (word: element → text node → word; element: empty, so
  zoom-out walks up the parents), and stale x-toggle state is cleared.
- Multi-snip: items that collide with a frozen selection are skipped.

## Changes
- New `content/navigate.js`: `moveSelection(dir)` (word stepping with a TreeWalker over visible text
  nodes; sibling stepping for elements/text nodes).
- `content/events.js`: ArrowLeft / ArrowRight → `moveSelection(-1 / +1)`.
- `content/selection.js`: keyboard anchor check in `evaluateMouseCoords`; `content/state.js`:
  `keyboardAnchor`; reset in `reselectAtMouse`, `handleZoom`, start/exit.
- `manifest.json`: add `content/navigate.js`. Popup: "← / → Previous / next word or item" row.

## Testing
Headless: word → next/prev word; across an inline element; across paragraphs; soft-hyphen word; first /
last word stays; 1px jitter keeps the keyboard selection, a big move re-tracks; list item → next item;
text beside a phrase → the phrase; copy after moving copies the moved word; hidden text skipped. All suites.

## Outcome
- Implemented as planned (`content/navigate.js`; ArrowLeft/Right in `content/events.js`; keyboard anchor
  in `content/selection.js`; popup row). Zooming in after a keyboard move is still mouse-based (it
  zooms toward what's under the mouse), as before.
- Tests: `tests/headless/test23.mjs` 18/18. All 21 suites pass; mouse-move cost unchanged.
