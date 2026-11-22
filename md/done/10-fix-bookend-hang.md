# Plan 10: fix the page freeze in the bookend search (IMPLEMENTED 2026-11-21, not yet committed)

## Bug (real freeze, reproduced)
On es.wikipedia.org/wiki/Quote_Unquote: Ctrl+Shift+click "rotación" → wheel in (word) → press `x`
→ the page hangs forever (main thread stuck; headless Chrome's key event never returns). Same in
every version tested: `12afde0` (before any recent changes), `HEAD`, and today's code.

**Cause:** `snapToNearestBookend` (`content/bookends.js:147-158`) walks backward through opening
characters for asymmetric pairs:
```js
open = fullText.lastIndexOf(char, open - 1);
```
When `open` is 0, `lastIndexOf(char, -1)` treats −1 as 0 and returns 0 again, so if the text starts
with that opening char and that pair doesn't enclose the cursor, `open` stays 0 forever. The
paragraph here starts with `«Quote Unquote»`. Any paragraph starting with `(`, `[`, `{`, `«`, `“`,
`‘` or `⟨` can trigger it, via `x`, Space (Bookend Zoom), or Bookend hover.

## Fix (`content/bookends.js`, one line)
```js
open = open > 0 ? fullText.lastIndexOf(char, open - 1) : -1;
```

## Testing (headless)
1. The repro above: `x` returns promptly (< 100 ms) and the copied text is the expected result.
2. Same with Space (Bookend Zoom) on that paragraph, and Bookend hover across it.
3. Regression: plan-4 suite (10/10), plan-6 highlighter/freeze checks, copy-path test
   (text run / word / word+x / paragraph+Tab) all pass; no errors.
4. A small synthetic page with paragraphs starting with each opening char.

## Noted, not changed here
`snapToOuterBookend` (Bookend zoom-out) has no size cap: it rebuilds a per-character map for each
ancestor up to `<body>`, so on very long pages it can be slow (not endless). Candidate for a later
plan (apply the same 5,000-char cap / cache as `snapToNearestBookend`).

## Files
- `content/bookends.js`

## Outcome
- Fixed in `content/bookends.js` (the `lastIndexOf` step now stops at index 0), with a comment.
- Repro (Quote_Unquote, wheel-in then `x`): was an endless hang, now returns in 6 ms.
- Synthetic page, paragraphs starting with each of `( [ { « “ ‘ ⟨ " \``: old code hangs on the first
  one for `x`, Space and Bookend hover; fixed code passes all 9 × 3.
- Regressions: plan-4 suite 10/10; plan-6 highlighter/freeze identical; copy path (text run, word,
  word + `x`, paragraph + Tab) correct; no errors.
