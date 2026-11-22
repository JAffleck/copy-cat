# Plan 6: highlighter-style selection overlay (IMPLEMENTED 2026-11-21, not yet committed)

## Goal
Replace the dashed boxes with a highlighter look: solid fill on the text, mode color at 20%
opacity, no border.

## Today (`updateUI`, `content.js:598-643`)
- Text selections (Range / Text node): 2px dashed border in the mode color, no fill.
- Element selections: mode color fill at 30% + 2px dashed border; block elements use their whole
  bounding box (`getTargetRects`, `content.js:487`), not just their text.
- Frozen (Multi-snip): green fill at 20% + 2px dashed green border.

## Changes (`content.js` only)
1. **New `getHighlightRects(target)`** (drawing only; `getTargetRects` stays as-is because the
   plan-4 zoom lock uses it for hit-testing):
   - Range / Text node: their client rects (as today).
   - Element with visible text: client rects of a Range over its contents
     (`selectNodeContents`), so the color sits on the text lines, not the padding/margins.
   - Element without text (img, input, svg, icon button): its bounding box.
   - Rects merged per line with the existing `mergeRects` (no doubled opacity where inline
     fragments overlap).
2. **Style:** every highlight block (active and frozen) is
   `background-color: <color> at 20%; border: none; border-radius: 2px;` — active uses the mode
   color (`getActiveThemeColor()`), frozen keeps green (`#10b981`) so they stay distinguishable.
   Small vertical padding (1px) so it covers ascenders/descenders like a marker.
3. Remove the dashed-border styles and the `isSmall` split (one style for all).

## Notes
- 20% on light pages reads like a marker; on dark pages the same color still shows but is
  subtler. If it's too faint we can tune per mode later (one constant: `HIGHLIGHT_ALPHA = 0.2`).
- No blend modes (e.g. `multiply`), since those disappear on dark backgrounds.

## Testing
Headless screenshots on es.wikipedia Quote_Unquote and a dark-theme page: word, text run,
paragraph, list item, link with external icon, image; plus a frozen + active pair in Multi-snip.
Check: no borders, fill only on text lines for paragraphs, box for image, frozen green vs active
mode color, no visual doubling on line overlaps. Manual check in Chrome after reload.

## Files
- `content.js`

## Outcome
- Implemented as planned: `getHighlightRects`, `makeHighlightBox`, `HIGHLIGHT_ALPHA = 0.2`,
  `FROZEN_COLOR`; all dashed borders removed from `updateUI`.
- Headless screenshots (es.wikipedia Quote_Unquote, light + Wikipedia dark theme): text run, word,
  paragraph (painted per text line), frozen + active, image. Measured fills: active blue on white
  (216,230,253); frozen green on white (207,241,230) = green at exactly 20%; dark (15,53,45).
- **Found and fixed a plan-4 regression:** right-click freeze in Multi-snip left the just-frozen
  selection active (the zoom lock returned early, so no redraw and no move off the frozen
  selection). The `contextmenu` handler now clears `zoomLocked` before re-evaluating.
- Plan-4 tests re-run: 10/10 pass. No page errors.
- Small icons (e.g. the 16px Wikidata icon) get a box, but 20% tint on them is subtle.
