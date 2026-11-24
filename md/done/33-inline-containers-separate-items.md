# Plan 33: Side-by-side container divs are separate items ("Gmail" / "Images", not "GmailImages") (IMPLEMENTED 2026-11-23)

## Request
Google's top bar: `div.gb_R` holds two `div.gb_ea` (each an `<a>`: Gmail, Images). Zoomed out to
`gb_R`, the preview shows `GmailImages`; each should be its own item, like the list items from
plan 27.

## Cause
The divs are displayed side by side (`display: inline-block` or similar), so the browser's rendered
text (`innerText`) treats them as one line and adds nothing between them; there is no whitespace
in the HTML. Plan 27 relies on `innerText`, which only breaks lines at block-level boxes.

## Rule (from the user's earlier answer)
- Elements that are containers by tag (div, p, li, ul, ol, dl, dt, dd, section, article, aside,
  nav, header, footer, main, figure, figcaption, blockquote, form, fieldset, table, tr, h1–h6,
  pre, address, details, summary) are separate items even when CSS shows them side by side
  (inline, inline-block, inline-flex, inline-grid, inline-table).
- Inline text elements (span, a, b, i, em, strong, code, label, …) next to text or each other stay
  joined, as today (`<span>one</span><span>two</span>` → `onetwo`).

## Change (`content/text-metrics.js`, `renderedTextWithControls`)
- Before reading, find container-tag descendants whose computed `display` starts with `inline`.
  If there are none (the usual case) nothing changes: live `innerText` (or the controls clone).
- If there are some, use the clone path (already used for form controls): in the clone, the matching
  elements get `display: block !important`, so `innerText` breaks lines around them; then read it
  while briefly attached off-screen and remove it (as today). Controls are swapped as today.
- Limit: the scan is skipped for elements with more than 3000 descendants (whole-page zoom), so
  mouse moves stay fast; those fall back to plain `innerText`.

## Tests (`tests/headless/test27.mjs`)
- Gmail/Images markup with `.gb_ea { display: inline-block }` → `Gmail\nImages`; with Bullets →
  `• Gmail\n• Images`.
- Same with `display: inline` divs and with `inline-flex` divs → separate lines.
- Spans side by side stay joined (`onetwo three`), an `inline-block` span inside a sentence stays
  inline (`Some badge text`).
- Inline divs plus a `<select>` inside one: both rules apply together.
- No leftover clone; existing cases unchanged. `movecost.mjs` (mouse-move cost) still within its
  usual range. Full `run-all.sh`.
