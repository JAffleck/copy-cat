# Plan 22: hovering text next to a line-wrapped inline element selects the wrong element (IMPLEMENTED 2026-11-22)

## Report
"I can't zoom to the word 'not'" in
`… (<phrase>habeas corpus appeal on the Third Circuit docket</phrase>, not <phrase>habeas-corpus …</phrase>).`

## Cause (reproduced headless with the given HTML)
Hovering the second "not" (text node `, not ` between two `<phrase>`s) selected the `<phrase>` instead of
the text, so zoom-in did nothing (zoom-in only works inside the current selection, and the mouse isn't
inside that phrase). `getTightestTextElement` (`content/text-metrics.js`) picks the child whose
`getBoundingClientRect()` contains the mouse; a phrase that wraps onto two lines has one bounding box
covering both lines in full, including where `, not ` sits.

## Change
`getTightestTextElement`: a child contains the mouse only if one of its line boxes
(`getClientRects()`) does (block elements have one box, so they behave as before).

## Testing
Headless with the reported HTML: both "not"s zoom to the word; hovering inside each phrase still selects
that phrase; regressions (all suites, incl. Wikipedia jitter/copy and mouse-move cost).

## Outcome
- Implemented as planned (`getTightestTextElement` tests `getClientRects()`).
- Tests: `tests/headless/test22.mjs` 6/6 with the reported HTML (both "not"s start on their own text and
  zoom to the word; hovering inside the wrapped phrases still selects them). All 20 suites pass;
  mouse-move cost unchanged.
