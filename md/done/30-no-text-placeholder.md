# Plan 30: Preview shows "[div No text]" instead of "..." when the selection has no text (IMPLEMENTED 2026-11-23)

## Request
If the hovered element has no text, the preview shows `...`, which is unclear. Show
`[{element type} No text]` instead.

## Change (`content/overlay.js`, `updateUI`)
- When `compileOutput()` is empty and something is selected, the preview body shows
  `[{tag} No text]`, e.g. `[div No text]`, `[img No text]`, `[center No text]`, with the tag
  name in lowercase (the element itself, or the parent element for a text node / range).
  Shown in the muted grey (`#a1a1aa`), italic, so it doesn't read as copied text.
- Nothing selected at all (no target, no frozen items): keep `...`.
- Display only: clicking still copies nothing (and exits, as today); Multi-snip frozen items with text
  still show their text as before.
- Helper `noTextLabel()` next to `updateUI`; uses the existing `elementOf()` and `escapeHtml()`.

## Tests (`tests/headless/test27.mjs`, extended)
- Hover the `#code` div (only `<style>`/`<script>`) in selection mode: the preview's `<pre>` reads
  `[div No text]`.
- Hover an element with text: the preview shows its text (no placeholder).
- Full `run-all.sh`.
