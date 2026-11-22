# Plan 20: clearer preview header with keycaps; Space re-selects immediately (IMPLEMENTED 2026-11-22)

## Requests
1. Make the preview window a little clearer; show a keycap-style display in the top row for the type:
   the closing pair or single delimiter for each quote/bracket type, and with commas "+ `,`" (comma also
   as a keycap).
2. Space (element ↔ bracket/quote zoom) doesn't update until the mouse moves; redraw the new selection
   right away.

## Cause of 2
The Space handler only flips the mode: going back to element zoom keeps the old bracket/quote
selection; going to bracket/quote zoom with no pair under the mouse keeps the old element. Tracking
only re-runs on the next mouse move. (A second Space branch further down in `events.js` never runs —
the first one always returns.)

## Changes
- `content/events.js`: after Space toggles the mode, re-select at the current mouse position like a
  mouse move would: element zoom → the element under the mouse; bracket/quote zoom → the enclosing
  pair, or nothing (same as hovering). Remove the unreachable duplicate Space branch.
- `content/overlay.js` header: style icon + name (brighter, 13px) + keycaps, mode on the right (muted):
  Quotes `"` / `'` / `` ` `` / `)` / `]` / `}` (closing char); Quotes + commas: closing char + `,`;
  CSV `,`; Bullets / Numbers: the current bullet / number character; Combined: its closing quote.
  Keycap style like the popup's `<kbd>`. Preview text slightly brighter.

## Testing
Headless: header keycaps for every style and quote pair; Space → element/bracket selection changes
without any mouse move (both directions, and with no pair under the mouse). Screenshot of the header.

## Outcome
- Implemented as planned (`reselectAtMouse()` in `content/events.js`; unreachable second Space branch
  removed; `styleKeycaps()` + keycap styles in `content/overlay.js`).
- Tests: `tests/headless/test20.mjs` 19/19 (Space both ways and with no pair, no mouse move; keycaps for
  every style/quote pair incl. Combined); screenshot `out/preview-keycaps.png`. All 18 suites pass.
