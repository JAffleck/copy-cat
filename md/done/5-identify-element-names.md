# Plan 5: "Identify" view — copy an element's names (alt, aria-label, label, placeholder, icon…) (IMPLEMENTED 2026-11-21)

## Goal
Let the user see and copy the identifying text of things that have little or no visible text:
placeholder, form label, aria-label, title, image alt, SVG/icon names, test ids.

## Today
`getInteractiveElementText` (`content.js:692`) only covers SELECT (selected option), INPUT/TEXTAREA
(value, else placeholder) and contenteditable (text, else placeholder). No alt/aria/title/label/icon
support. Images, SVGs and icon-only buttons are hard to select: tracking prefers elements with
visible text (`getTightestTextElement` / `getVisibleTextLength`), and they have none.

## Decisions (user: "Sure do that" → defaults)
- Key: `N` toggles Identify view (unused today).
- Full scope in this plan (all sources below).
- Normal preview shows a fallback name for text-less elements.

## Changes (`content.js`, plus popup hotkey list)
1. **`getElementNames(target)`** → ordered list of `{ source, text }`, deduped, empty values dropped.
   Target is the selected element (for a Range/Text node: its parent element). Sources:
   - any element: `aria-label`; `aria-labelledby` (text of each referenced id, joined);
     `title`; `id`; `data-testid` / `data-test` / `data-cy` / `data-qa`
   - form fields (INPUT/TEXTAREA/SELECT/contenteditable): value; `placeholder`; label (`<label for=id>`,
     wrapping `<label>`); `aria-describedby` text; `name`
   - IMG / `input[type=image]` / `<area>`: `alt`; `<figcaption>` of an enclosing `<figure>`;
     file name from `src` (last path segment, no query)
   - SVG (the element or nearest `svg` ancestor): `<title>` child; `<use href="#icon-x">` →
     `icon-x`
   - icon fonts: class names matching common icon prefixes (`fa-`, `bi-`, `icon-`, `glyphicon-`,
     `material-icons`, `mdi-`, `ti-`, `ri-`, `codicon-`), minus generic ones (`fa`, `fas`, `far`,
     `fa-solid`, `fa-lg`…); Material ligature text (`<span class="material-icons">delete</span>`) is
     already visible text
   - CSS icons: file name from computed `background-image` / `mask-image` / `-webkit-mask-image`
     (`url(...)`) on the element and its `::before`/`::after` (e.g.
     `link-external-small-ltr-progressive.svg`)
   - icon-only buttons/links: own names first; if none, names of the first icon inside them
   - plus the element's tag as a header line (`<button>`, `<img>`), not copyable
2. **Identify view (`N`):** the preview panel shows the numbered list (up to 9 rows, `source`
   column + text, long values truncated with "…"). `1`–`9` copies that row (same copy/feedback path
   as a click, honoring Single/Multi-snip). Left-click copies row 1. `N` or `Esc` returns to normal
   view (Esc then no longer cancels the whole copy in this view). If the element has no names:
   "No names found" row. The list follows the selection when the mouse moves.
3. **Hover can select text-less named things:** in element tracking, if the element under the mouse
   is an IMG, SVG (or inside one), INPUT/SELECT/TEXTAREA, or a BUTTON/A/`[role=button]` with no visible
   text, and `getElementNames` finds at least one name, select it instead of skipping to a text
   ancestor. Zoom in/out from there works as today.
4. **Fallback name in the normal preview:** when the selected element has no visible text, the
   preview shows its best name with a tag, e.g. `[alt] Album cover` / `[aria-label] Close`, and a
   normal click copies that text (without the tag). Elements with text are unchanged.
5. **Popup:** add `N` to the hotkey list ("Identify: list names (alt, label, aria…) · 1–9 copy").

## Notes / limits
- Chrome has no stable JS API for the browser's computed accessible name, so this is a simplified
  lookup; it covers common cases, not every screen-reader edge case.
- Values are read only; nothing on the page is changed. Cross-origin iframes aren't inspected.

## Testing
Headless (`~/.cache/copycat-debug`) on a local test page (`test.html` additions, not shipped to
sites) with: input with placeholder + `<label for>`, wrapped label, aria-label button with an SVG
icon, `aria-labelledby`, img with alt inside `<figure>`, Font Awesome-style `<i class="fa-solid
fa-trash">`, `<svg><use href="#icon-gear">`, CSS background icon link, element with data-testid.
For each: hover selects it; `N` lists the expected rows in order; `1`–`9` copy the right text
(check clipboard stub); fallback name shows in normal preview; no errors. Plus Wikipedia: the
external-link icon reports its SVG file name.
Manual: same in Chrome after reload.

## Files
- `content.js`, `popup.html` (hotkey line), `test.html` (test cases)

## Outcome
- New `content/names.js` (`getElementNames`, `getBestName`, `isNameCandidate`, `getNamedTarget`);
  wired into `selection.js` (hover selects text-less named things, using the raw hit-test element),
  `text-metrics.js` (`getCleanText` falls back to the best name for text-less elements and empty
  fields), `overlay.js` (Identify list; "Name from …" hint in the normal preview), `events.js`
  (`N`, `1`–`9`, Esc, click in Identify), `output.js` (`commitText` helper), `state.js`,
  `lifecycle.js`, manifest, popup hotkey line. Links also list their `href`.
- Simplification vs plan: `1`–`9` copy just that name (no Multi-snip combining).
- Fixed during testing: a container's look-alike class (`icon-btn`) was read as an icon name and
  stopped the button borrowing its inner `fa-gear` icon's name; icon classes now count only on
  icon-like leaves, and controls without a human-readable name borrow the inner icon's names.
- Tests: `tests/names.html` + headless `test5.mjs`: 23/23 (name lists for every source, password
  value never listed, hover image/icon button/empty field, N list, digit copy, click copy, Esc,
  normal text copy unchanged). Regressions: jitter 10/10, highlighter/freeze identical, copy path
  correct, bookend-freeze synthetic 27/27. Mouse-move cost unchanged (median 0.7 ms, p95 ~3 ms).
