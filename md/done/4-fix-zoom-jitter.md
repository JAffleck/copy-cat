# Plan 4: stop 1px mouse jitter from undoing wheel/arrow zoom (IMPLEMENTED 2026-11-21, not yet committed)

## Problem (reproduced in headless Chrome on es.wikipedia.org/wiki/Quote_Unquote)
1. **Zoom is undone by tiny mouse moves.** `evaluateMouseCoords` (`content.js:836`) re-targets on
   every mouse move. After wheel-out selects the paragraph (`<P#mwCA>`), the next 1px move snaps the
   selection back to the text node under the mouse; wheel-in to a deeper level (segment) is likewise
   reset to the word level. Since a hand can't hold a mouse perfectly still, zoom looks stuck.
   Present before any recent changes (same in commit `12afde0`).
2. **First wheel-in after activation picks the wrong word.** `startSelectionMode(x, y)`
   (`content.js:1799`) doesn't set `lastMouseX`/`lastMouseY` (they stay 0,0 until the first move),
   so zoom-in's caret lookup fails and falls back to the middle of the text node ("incluye" instead
   of "rotación" under the mouse).

No hang was reproduced; in-page cost per wheel event is a few ms in all versions.

## Changes (`content.js` only)
1. **Record the mouse position on start:** in `startSelectionMode(x, y)` set
   `lastMouseX = x; lastMouseY = y;`.
2. **Zoom lock:** new state `let zoomLocked = false;`.
   - Set `zoomLocked = true` whenever `handleZoom` (wheel / ArrowUp / ArrowDown) changes the
     selection, in both Element Zoom and Bookend Zoom.
   - At the top of `evaluateMouseCoords`, after the hit-test: if `zoomLocked` and the mouse is still
     inside the current selection (any rect from `getTargetRects(currentTargetElement)`, with a 2px
     tolerance), return without re-targeting. If the mouse has left it, clear `zoomLocked` and track
     normally (existing behavior, including the plan-3 history rebuild).
   - Clear `zoomLocked` in `startSelectionMode`, `exitSelectionMode`, and when Space toggles
     Element/Bookend Zoom.
   - Normal hover (no zoom used yet) is unchanged: without the lock, tracking still picks the
     tightest element under the mouse as today.
3. No change to `x`, click/copy, right-click freeze, or the popup.

## Testing
Automated (headless repro in `~/.cache/copycat-debug`, same article):
1. Activate on "rotación", wheel in → selects "rotación" (not "incluye").
2. Wheel out → paragraph; 1px jitter ×10 → stays on the paragraph; further wheel-out keeps widening.
3. Wheel in to a word, 1px jitter → stays on that word.
4. Move the mouse to a different paragraph → selection follows to the new spot (lock released);
   wheel-out from there zooms out from the new spot (plan-3 behavior).
5. Per-event cost stays in the few-ms range; no console errors.

Manual (your Chrome, after reloading the extension and refreshing the tab):
6. Same steps with a real wheel on that article; tab stays responsive; Esc cancels.

## Files
- `content.js`

## Outcome
- Implemented as planned. `handleZoom` is now a small wrapper around the original logic (renamed
  `handleZoomInner`) that sets `zoomLocked` when the selection changed; `isPointInTarget` helper
  added next to `rangeContains`.
- Headless test (`~/.cache/copycat-debug/test4.mjs`, es.wikipedia Quote_Unquote): 10/10 pass.
  Control run on the pre-plan-4 code: 5/10 fail (first wheel-in picks "incluye"; jitter undoes
  every zoom-out), confirming the tests detect the bug.
- In-page wheel handler cost: max ~4.6 ms per event. No hang reproduced in any version.
- Still to do: manual check with a real wheel in Chrome (Testing step 6).
