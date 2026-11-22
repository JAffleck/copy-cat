# Plan 9: split content.js (1,869 lines) into files under 1,000 lines (IMPLEMENTED 2026-11-21, not yet committed)

Standing rule: hard stop at 1,000 lines per source file.

## Approach (behavior-neutral)
- Content scripts listed together in `manifest.json` run in order in one shared isolated world, and
  top-level `let`/`const`/`function` declarations in classic scripts share that scope. So: remove
  the outer `(function () { ... })();` wrapper and cut the body into ordered files. Every function,
  variable and constant keeps its name and code; only its file changes.
- Still invisible to the web page (isolated world), as today.
- No logic edits in this plan. Comments that just repeat section titles become each file's header.

## New layout (`content/` folder, in load order)
| File | Contents (current `content.js` lines) | ~lines |
|---|---|---|
| `content/state.js` | state variables, `settings`, constants (`DECORATIONS`, `STYLE_*`, `TAG_PRIORITY`, `MAX_BOOKEND_SCAN_CHARS`) (1–45) | 45 |
| `content/text-zoom.js` | `getDeepElementFromPoint`, word/segment/bracket ranges, `getNextZoomRange` (46–162) | 120 |
| `content/bookends.js` | `BOOKEND_PAIRS`, `snapToNearestBookend`, `elementToRange`, `findEnclosingPair`, `includeBookendTarget`, `snapToInnerBookend`, `snapToOuterBookend`, `maybeTrim`, `trimSurroundingBookends` (163–409, 975–1241) | 510 |
| `content/overlay.js` | shadow DOM init/destroy, rect helpers, highlighter boxes, theme colors, `updateUI`, `escapeHtml` (410–578, 600–690) | 260 |
| `content/text-metrics.js` | `getInteractiveElementText`, `getVisibleTextLength`, `getTightestTextElement`, `sameSelection`, `getCleanText` (691–834, 1425–1494) | 215 |
| `content/selection.js` | `isCollidingWithFrozen`, `evaluateMouseCoords`, `getElementTargetAt`, `isPointInTarget`, `rangeContains`, `clearToggleState`, `handleZoom`, `handleZoomInner` (579–599, 835–974, 1242–1424) | 345 |
| `content/output.js` | `compileOutput`, `commitCopy` (1495–1563) | 70 |
| `content/events.js` | `handleGlobalCapture` (all hotkeys incl. `x`) (1564–1804) | 240 |
| `content/lifecycle.js` | `loadSettings`, `saveSettings`, `captureEvents`, `startSelectionMode`, `exitSelectionMode`, Ctrl+Shift+click activation listener (1805–1869) | 65 |

Largest file ~510 lines. `content.js` is deleted (it's in git history).

## Manifest
`content_scripts.js`: the nine files above in that order (replaces `"content.js"`). Plans 7/8 will
add their new files to `content/` after `lifecycle.js`.

## Verification
1. `node --check` on every file.
2. **Line-for-line check:** the multiset of non-blank code lines across the nine files equals the
   original `content.js` body (minus the two wrapper lines). Proves nothing was added, lost or
   altered, only moved.
3. **No duplicate top-level names** across files (script greps declarations).
4. **Headless regression:** concatenate the files in manifest order (as Chrome loads them) and rerun
   the existing suites on es.wikipedia Quote_Unquote: plan-4 jitter tests (10/10), plan-6
   highlighter screenshots + freeze check, wheel cost per event. Same results as before the split.
5. Manual: reload the extension in Chrome, refresh a tab, quick copy / zoom / `x` / Multi-snip.

## Docs
- Update plans 7 and 8: new files go in `content/`; `content.js` references point to the new file
  (`commitCopy` → `content/output.js`, `S` key → `content/events.js`).

## Files
- New: `content/*.js` (9 files). Deleted: `content.js`. Edited: `manifest.json`,
  `7-clipboard-history.md`, `8-form-snapshots.md`.

## Outcome
- Split done: 9 files in `content/` (largest `bookends.js` 516 lines; total 1,896 incl. headers).
  `content.js` deleted; manifest lists the files in order; popup comments and plans 7/8 repointed.
- Verification: `node --check` all files; the 1,686 non-blank code lines match the original exactly
  (same multiset, nothing added/lost/changed); 72 top-level names, no duplicates.
- Headless (files injected separately in manifest order, like Chrome): plan-4 suite 10/10, wheel
  cost max 5.2 ms; plan-6 highlighter + freeze identical (frozen (207,241,230), active (216,230,253));
  no errors.
- **Found while testing the copy path (pre-existing, present since before commit 12afde0):** pressing
  `x` after zooming to a word hangs the page forever on es.wikipedia Quote_Unquote — endless loop in
  `snapToNearestBookend` (`content/bookends.js:156`) when an opening bracket/quote sits at index 0 of
  the scanned text. Fix tracked as plan 10.
