# Plan 3: popup fixes, header icon, bigger toolbar cat, 128 store icon, zoom-out and x after mouse moves (IMPLEMENTED 2026-11-21)

## Cause
`popup.js` re-reads settings with `chrome.storage.local.get(null, renderStatus)` after a radio
button or the Multi-snip switch changes (`popup.js:52`, `popup.js:62`). `null` means "no defaults",
so if `content.js` has never saved settings (e.g. selection mode not used yet since install),
`outputFormat` and `lineDecoration` are `undefined` → status shows `undefined + undefined`.

## Related mismatches (same file, same root: popup uses old value names)
`content.js` saves `SPLIT`/`COMBINED`, `RAW`/`QUOTED`/`QUOTED_COMMA`/`CSV`/`NUMBERED`/`BULLETED`,
and `SINGLE_SNIP`/`MULTI_SNIP`. `popup.js` checks old names (`'Combined'`, `'Quotes'`,
`'Multi-snip'`, ...), so:
- The status icon is always 🔵 and the text shows raw values like `SPLIT + QUOTED`.
- The Multi-snip switch writes `'Multi-snip'` and checks `=== 'Multi-snip'`, so it never shows
  as on when the radio says Multi-snip. (`content.js` converts the old name on load, so the
  setting itself still works.)

## Changes: `popup.js` only (rewrite `renderStatus` + storage calls)
1. One `DEFAULTS` object matching `content.js`: `trackingMode: 'SINGLE_SNIP'`,
   `outputFormat: 'SPLIT'`, `lineDecoration: 'RAW'`. Use it in **every**
   `chrome.storage.local.get` call (replaces both `get(null, ...)` calls).
2. `normalize(settings)`: convert legacy `'Multi-snip'`/`'Single-snip'` to
   `MULTI_SNIP`/`SINGLE_SNIP` (same as `content.js` `loadSettings`) and fall back to defaults for
   any missing value. Applied to storage reads and to `SETTINGS_UPDATED` messages.
3. Label and icon tables keyed by the `content.js` values, matching the popup legend:
   - `COMBINED` → 🔴 `Combined + Quotes`
   - `RAW` → 🔵 `Split + Raw`, `QUOTED` → 🟦 `Split + Quotes`,
     `QUOTED_COMMA` → 🟩 `Split + Quotes + Commas`, `CSV` → 📊 `Split + CSV`,
     `NUMBERED` → #️⃣ `Split + Numbers`, `BULLETED` → ⏺️ `Split + Bullets`
   - unknown value → 🔵 with the raw value shown (never `undefined`).
4. Multi-snip switch writes and checks `MULTI_SNIP` / `SINGLE_SNIP`.

## Small fix: `popup.html` legend
- CSV line: icon 🟩 → 📊 (🟩 is already Quotes + Commas; `popup.js` uses 📊 for CSV) and text
  `CSV (Comma-Separated-Values)` → `Split + CSV`, matching the other legend lines.
- Remove the stray extra `</li>` on that line.

## Header icon: use the extension's cat icon instead of the 🐈 emoji
- `popup.html`: `<h3>🐈 Copy Cat</h3>` →
  `<h3><img class="title-icon" src="32.png" alt=""> Copy Cat</h3>`
  (`32.png` shown at 16x16 CSS px: exactly 2x on high-DPI screens, clean downscale on normal ones;
  `alt=""` because the text already says "Copy Cat").
- `popup.css`: add
  `.title-icon { width: 16px; height: 16px; vertical-align: -2px; margin-right: 4px; }`
  (fine-tune `vertical-align` after seeing it in the popup).

## Bigger cat in the toolbar button: crop margin before shrinking
- Source: the full-size master `icon-1024.png` (not the already-shrunk files).
- Head bounds (columns/rows with real content, ignoring thin whiskers): x 82–960, y 120–949
  (878 x 829). Crop a square 878 x 878 around it: x 82–960, y 96–974 (head centered vertically,
  transparent rows above/below). Whisker tips past the cheeks are trimmed.
- Shrink that square (premultiplied Lanczos, as before) to `16.png`, `32.png`, `48.png`.
  Cat goes from ~86% to 100% of the icon width (~17% larger). `128.png` (scene) unchanged.
- Keep the uncropped master; save the cropped square as `icon-1024-cropped.png` (source for
  future resizes).
- The gray button around it is Chrome's; its size/padding can't be changed by the extension.

## 128 icon: photocopier scene cut out, 96x96 artwork + 16px transparent padding (option B)
Chrome Web Store guidance: 128x128 PNG, artwork 96x96, 16px transparent padding per side, works on
light and dark backgrounds.
1. Source: full-size `icon-scene-1024.png` (watermark already removed). Never resize from an
   already-shrunk file.
2. Cut out the cat + photocopier (incl. the printed page): remove walls, window, plant, table,
   floor → transparent. Flood from the image border through background colors, stopped by the
   dark outlines of the cat/copier/page; soften the outline edge as for the head (no halo).
3. Crop tight to the cutout, center it in a square (transparent fill), then resize in one step
   (premultiplied Lanczos) so the longer side is 96px; place centered on a transparent 128x128.
4. Save the full-size cutout as `icon-scene-cutout-1024.png`.
5. **Preview first** on dark and light backgrounds at 128px and zoomed; show it before
   overwriting `128.png`. If the cutout isn't clean, fall back to option A: the whole scene
   resized 1024 → 96 in one step, centered with 16px transparent padding.

## Bug: zoom-out after moving the mouse jumps back to the originally zoomed word
**Cause:** zooming into text pushes each step onto `zoomHistory` (`content.js:1309`). While zoomed
in, mouse moves retarget the word under the cursor (`content.js:869-888`) but return early without
touching `zoomHistory`, and also skip the history reset at `content.js:913-915`. Zoom-out then pops
the stale history (`content.js:1230-1237`) → back to where you first zoomed in.

**Fix (`content.js`):**
1. Extract the element-picking lines (`content.js:892-898`: walk up to a `TAG_PRIORITY` tag, then
   `getTightestTextElement`) into `getElementTargetAt(el, x, y)`; use it in
   `evaluateMouseCoords` (no behavior change).
2. In the granular tracking branch, when the mouse lands on a different range (the existing
   `!sameSelection` case), rebuild `zoomHistory` for the new spot as a fresh zoom-in would:
   `[elementAtMouse, textNode]` (dedupe if they're the same node), then set the new range.
3. Result: zoom-out steps new word → its text node → its element → parents, from the mouse
   position. Zoom-in from there and frozen-range checks are unchanged.

**Same bug with `x` (exclude/include delimiters):** pressing `x` saves the untrimmed selection in
`savedUntrimmedRange` (`content.js:1640-1646`) so the next `x` can restore it, and the `[edit]`
case keeps `pendingInnerRange`. Mouse tracking moves the selection but never clears either (they're
only reset on start/exit and on Space), so the next `x` restores the selection from before the
move.
4. In `evaluateMouseCoords`, whenever tracking changes `currentTargetElement` (Bookend Zoom snap,
   granular word tracking, element tracking, and the "nothing here" null cases), also clear
   `savedUntrimmedRange` and `pendingInnerRange`. `x` then falls back to `findEnclosingPair()`,
   which already searches at the mouse position (`content.js:363-364`). The `excludeDelimiters`
   on/off mode itself is kept (it's meant to persist across snaps).
5. Guard in the `x` include branch: only restore `savedUntrimmedRange` if it still contains the
   current selection; otherwise discard it and use `findEnclosingPair()`.

## Testing (manual)
1. Clear storage (DevTools on the popup → `chrome.storage.local.clear()`), open the popup:
   shows `🔵 Split + Raw`. Click Multi-snip radio → still `🔵 Split + Raw`, switch turns on.
   Toggle the switch off → radio moves to Single-snip.
2. On a page, start selection mode, press Tab / Shift+Tab with the popup open, or reopen it:
   status follows (e.g. `🟦 Split + Quotes`, `🔴 Combined + Quotes`).

3. Header shows the cat icon, vertically centered with "Copy Cat", sharp (not blurry).

4. Reload the extension: toolbar cat fills more of the button; compare with the old 16/32/48
   (backups in `md/originals/` are the uncropped 1024px originals).

5. 128 icon: check `chrome://extensions` (shows the 128) in light and dark mode.
6. Zoom bug: on a text-heavy page, Ctrl+Shift+click a paragraph, ArrowUp until a word is
   selected, move the mouse to a word in a different paragraph (selection follows), press
   ArrowDown → selection becomes that word's text/element, not the first word's. Repeat within
   the same paragraph. Also check zoom-in → zoom-out without moving still retraces exactly.
7. `x` bug: hover `"After Alan"`-style quoted text, press `x` (quotes excluded), move to a
   different quoted/bracketed phrase (selection follows), press `x` → quotes of the NEW phrase
   are included, not a jump back to the first. Also `[edit]` on Wikipedia: `x`, `x` without moving
   still toggles `[edit]` ↔ `edit`.

## Files
- `popup.js`, `popup.html`, `popup.css`, `content.js`
- `128.png` (regenerated), new `icon-scene-cutout-1024.png`
- `16.png`, `32.png`, `48.png` (regenerated), new `icon-1024-cropped.png`

## Outcome
- Popup: status uses content-script value names with defaults (no more `undefined + undefined`);
  Multi-snip switch synced; CSV legend 📊; header shows `32.png` instead of 🐈.
- Toolbar icons 16/32/48 regenerated from a square crop around the head (`icon-1024-cropped.png`):
  cat ~17% larger.
- 128: photocopier scene cut out (room removed), 1024 → 96 in one step, centered on transparent
  128x128 (16px padding verified). Full-size cutout: `icon-scene-cutout-1024.png`.
- Zoom-out and `x` after moving the mouse now act on the word under the mouse (history rebuilt;
  stale `x` state cleared).
- Follow-ups found later: plan 4 (jitter undid zoom; first wheel-in picked the middle word),
  plan 10 (endless loop in the bookend search — the real freeze).
