# Plan: user-select override + container-rect fallback for unrenderable bookends

> **Status: IMPLEMENTED** in commit `12afde0`. Kept for reference. Note: Change 2's premise
> (MediaWiki `[ ]` are `display:none`) turned out to be wrong; the brackets are real, visible
> text nodes in `.mw-editsection-bracket` spans. See the follow-up plan at the bottom.

## Change 1 — Inject `user-select: text !important` during selection mode

**Why:** Some sites set `user-select: none`, blocking selection/measurement. Overriding it is
safe: it affects only selectability, not layout, the DOM tree, or SPA state. (We will NOT touch
`display`/`visibility`/`opacity` — those would reveal hidden content and can double CSS-generated
glyphs or break layouts.)

**Where:** `content.js`, in `initShadowDOM()` (or wherever selection mode starts) and teardown.

- On enter selection mode: create a `<style id="copycat-userselect">` appended to
  `document.documentElement` with:
  ```css
  *, *::before, *::after { user-select: text !important; -webkit-user-select: text !important; }
  ```
- On exit selection mode (`destroyShadowDOM` / teardown): remove that `<style>` element.

This is a CSS override (not DOM mutation), fully reverted on exit.

## Change 2 — On X-include, expand selection to container when bookends are unrenderable

**Why:** Some bookend chars are `display:none` (e.g. MediaWiki `.mw-editsection` `[ ]`, rendered
via CSS). They have no box, so a range over them can't be drawn or measured. But the bookend
*container* element (`_bookendContainer`, e.g. `.mw-editsection`) DOES render the visible brackets
and is exactly what initial element zoom selected/drew correctly. So instead of a render-time rect
hack, change the actual selection — "zoom out" to the container's full text — so both the rectangle
AND the preview stay consistent through the normal path.

**Where:** `content.js`, the `x` key handler, INCLUDE branch (when `findEnclosingPair()` result
is used as the full/untrimmed selection).

Logic after obtaining the enclosing pair range `foundRange` for the include state:
1. Measure the first selected char (1-char range at `foundRange` start). If width > 0, the
   bookend chars are renderable → use `foundRange` as-is (current behavior; real quotes etc).
2. If width is 0 (unrenderable boundary char, e.g. display:none bracket):
   - Find the nearest ancestor whose trimmed `textContent` equals the bookend pair text
     (start from `_bookendContainer`; walk up if needed). This element actually renders the
     visible bookends.
   - Set `currentTargetElement` to that ancestor ELEMENT (not the range). Element selection
     already renders correctly via the existing `getTargetRects` element path, and the preview
     uses the element's text. (Typically equals the container's entire text.)
   - Keep `savedUntrimmedRange = foundRange` so the next X (exclude) trims back to inner text.
3. Exclude path unchanged: trimmed range over inner text (e.g. `edit`), renderable + measured.

**Resulting behavior:**
- `[edit]` (brackets display:none): include → selects `.mw-editsection` element → rect and
  preview show `[edit]`. Exclude → trimmed range `edit`.
- `"After Alan"` (real quote chars): first char `"` measurable → uses `foundRange` →
  `getClientRects()` covers quotes, excludes the external-link icon (unchanged).
- Plain trimmed/word selections: unchanged.

**Note:** `getTargetRects` needs no container fallback under this approach — the selection becomes
a normal element, keeping `getTargetRects` simple.

## Files
- `content.js` only.

## Risk
Low. Change 1 is a reversible CSS override. Change 2 adds a narrow fallback gated on
(a) full bookend range, (b) zero-width first char, (c) container tightly wraps the selection.

---

# Follow-up plan: mousemove performance + cleanups (IMPLEMENTED, not yet committed)

**Goal:** Stop Copy-Cat from stuttering or hanging large pages (long Wikipedia articles, big
React apps) during selection mode, and remove a redundant/conflicting style line and wrong
comments. No change to selection behavior.

**Decisions so far:**
- Change A: a one-frame lag before a click is acceptable (users wait for the highlight to
  settle before clicking). No extra flush before click or key actions.
- Change B: keep the 5000-character limit and return `null` when it is hit.
- Approved: A, B, C, D (2026-11-21).

**Implementation steps:**
1. A: add `let rafPending = 0;` next to `lastMouseX`/`lastMouseY` (`content.js:16-17`); in the
   mousemove branch (`content.js:1525-1530`) update coords, then schedule one
   `evaluateMouseCoords` per animation frame. Leave the `contextmenu` call (`content.js:1546`)
   direct.
2. A cleanup + B cleanup: in `exitSelectionMode`, cancel any pending frame and clear the
   bookend cache; also clear the cache in `startSelectionMode`.
3. B: in `snapToNearestBookend` (`content.js:190-224`), stop the ancestor walk at
   `MAX_BOOKEND_SCAN_CHARS = 5000` (return `null` if no pair found within it), and reuse a
   cached `{ container, textLength, fullText, map }` when the container is unchanged.
4. C: delete the body `user-select` lines in `startSelectionMode` and `exitSelectionMode`
   (`content.js:1748-1749`, `1758-1759`).
5. D: reword the comments at `content.js:362-363` (`includeBookendTarget`) and
   `content.js:447-450` (`getTargetRects`).
6. Check syntax with `node --check content.js` and review the diff.
7. Move `plan.md` to `md/done/`.

## Change A: Throttle mouse handling to once per animation frame

**Why:** `handleGlobalCapture` calls `evaluateMouseCoords` on every `mousemove` event
(`content.js:1525-1530`). Mice can fire 100 to 1000+ events per second, and each call does
hit-testing, layout reads, and possibly a full bookend scan.

**Where:** `content.js`, `handleGlobalCapture` mousemove branch, plus `exitSelectionMode`.

- Add state: `let rafPending = 0;`
- In the mousemove branch: keep updating `lastMouseX`/`lastMouseY` immediately, but instead of
  calling `evaluateMouseCoords` directly, schedule it once:
  ```js
  if (!rafPending) {
    rafPending = requestAnimationFrame(() => {
      rafPending = 0;
      if (isSelectionMode) evaluateMouseCoords(lastMouseX, lastMouseY);
    });
  }
  ```
- In `exitSelectionMode`: `if (rafPending) { cancelAnimationFrame(rafPending); rafPending = 0; }`
- The `contextmenu` path still calls `evaluateMouseCoords` directly (one-off, keeps freeze
  behavior instant).

## Change B: Bound and cache the bookend scan in `snapToNearestBookend`

**Why:** In Bookend Zoom, every mouse move walks up ancestors reading `textContent` until it
finds a bracket/quote pair, then builds one JS object per character of that container
(`content.js:190-224`). On a long article the container can be most of the page, i.e. tens of
thousands of objects per mouse move.

**Where:** `content.js`, `snapToNearestBookend()`.

1. **Cap the ancestor walk.** Add `const MAX_BOOKEND_SCAN_CHARS = 5000;`. While walking up,
   if an ancestor's `textContent.length` exceeds the cap, stop and do not use it. If no
   pair was found within the cap, return `null` (same as "no bookend here" today).
2. **Cache the character map.** Keep a module-level cache
   `{ container, textLength, fullText, map }`. Reuse it when the chosen container is the same
   element, still `isConnected`, and its `textContent.length` is unchanged (cheap native check
   that catches React re-renders). Otherwise rebuild.
3. Clear the cache in `startSelectionMode` and `exitSelectionMode`.

**Trade-off:** pairs that span more than 5000 characters (e.g. a huge parenthetical across
many paragraphs) will no longer be found by the hover snap. `snapToOuterBookend` (zoom-out) is
untouched, so wider pairs remain reachable by zooming out.

## Change C: Remove redundant body `user-select` toggle

**Why:** `startSelectionMode` sets `document.body.style.userSelect = 'none'`
(`content.js:1748-1749`), but the injected `*, *::before, *::after { user-select: text
!important }` rule overrides it, so it has no effect. Removing it means one fewer mutation of
`<body>`, which some React apps observe.

**Where:** `content.js`
- Delete lines 1748-1749 (`document.body.style.userSelect/webkitUserSelect = 'none'`).
- Delete lines 1758-1759 (the matching resets in `exitSelectionMode`).

Native drag-selection stays blocked because `mousedown` is already `preventDefault`ed in
`handleGlobalCapture`.

## Change D: Fix inaccurate comments

**Where:** `content.js`
- `getTargetRects` comment (`content.js:446-450`): remove the claim that MediaWiki `[ ]` are
  `display:none` / CSS-rendered. They are real text in `.mw-editsection-bracket` spans.
- `includeBookendTarget` comment (`content.js:360-364`): change the example from MediaWiki
  brackets to a generic "bookend char with no layout box (e.g. `display:none`)".

## Out of scope (considered, not changing)

- **`shadowHost.style.visibility` toggle per move** (`content.js:819-821`, `178-180`,
  `1205-1207`): forces a style/layout flush each call. Needed so hit-testing skips the toast
  (which has `pointer-events: auto`). With Change A it runs at most once per frame, which
  should be acceptable. Revisit only if profiling still shows jank.

## Files
- `content.js` only.

## Testing (manual, in Chrome with the unpacked extension reloaded)
1. https://en.wikipedia.org/wiki/Bracket: Ctrl+Shift+click "edit" next to Chemistry, press `x`
   → `[edit]`; press `x` again → `edit`. Press Space → snaps to `[edit]`.
2. Same page: press Space (Bookend Zoom), move the mouse quickly across long paragraphs
   for several seconds. No stutter; DevTools Performance shows no long tasks from `content.js`.
3. A large React app page (e.g. GitHub PR files view): enter selection mode, move around,
   exit. No freezes or console errors; page stays interactive after exit.
4. Quoted text such as `"After Alan"` still selects with quotes included/excluded via `x`.

## Risk
Low. A and C don't change what gets selected. B can only make the hover snap find fewer
very-wide pairs. D is comments only.
