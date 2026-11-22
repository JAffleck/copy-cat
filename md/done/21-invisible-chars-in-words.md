# Plan 21: invisible characters (soft hyphens etc.) and non-Latin letters don't split words (IMPLEMENTED 2026-11-22)

## Report
Hovering text with `&shy;` in it (e.g. `nec&shy;es&shy;sary`, `ad&shy;jec&shy;tives`) breaks the
selection up, though these aren't characters the user chose to split on (quotes, brackets…).

## Cause
`getWordRange` (`content/text-zoom.js:67`) treats anything outside `[\w\-\u00C0-\u017F]` as a word
boundary. The soft hyphen U+00AD isn't in that set, so `nec|es|sary` are three words. The same rule
splits on zero-width spaces/joiners and on every letter of non-Latin scripts (Greek, Cyrillic, …).

## Changes (`content/text-zoom.js`, `content/text-metrics.js`, `content/output.js`)
1. Word characters: any Unicode letter, mark or number (`\p{L}\p{M}\p{N}`), `_`, `-`, plus invisible
   characters that live inside words: soft hyphen U+00AD, zero-width non-joiner/joiner U+200C–U+200D,
   word joiner U+2060, BOM U+FEFF. The zero-width *space* U+200B still separates words (Thai, Khmer…
   use it between words) but is dropped from copies. Quotes, brackets and other punctuation still split
   as before.
2. Copied text drops those invisible characters, so "necessary" is copied without hidden soft hyphens
   (preview and clipboard), wherever the text came from (word, element, Range, Identify name).

## Testing
Headless: hover/zoom to a word with soft hyphens → selects the whole word, copies "necessary";
zero-width joiner inside a word joins, zero-width space separates but is not copied; Greek/Cyrillic words select whole; quotes/brackets/apostrophe-free
punctuation still split; element copy of a paragraph with `&shy;` has none in the output. All suites.

## Outcome
- Implemented as planned (`wordBoundaries` now Unicode-aware with in-word invisible characters;
  `stripInvisible()` in `content/text-zoom.js`, applied to compiled output, Multi-snip history items and
  `commitText`). Zero-width space kept as a word separator (Thai/Khmer) but never copied.
- Tests: `tests/headless/test21.mjs` 11/11 on the reported markup (`nec&shy;es&shy;sary`,
  `ad&shy;jec&shy;tives`), ZWJ/ZWSP, Greek, Cyrillic, accented Latin, punctuation still splitting,
  paragraph copy without soft hyphens. Control run on the old code: 6 failures, reproducing the report
  ("es" / "jec" selected; soft hyphens copied). All 19 suites pass; mouse-move cost unchanged.
