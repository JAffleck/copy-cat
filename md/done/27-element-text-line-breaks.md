# Plan 27: Zoomed-out element copies keep line breaks between blocks / list items (IMPLEMENTED 2026-11-23)

## Request
On Google search, zooming out to the "I'm Feeling …" container shows the `div > span` items run
together with no spacing ("I'm Feeling CuriousI'm Feeling Hungry…"). Separate divs should be treated
as separate items (lines), like a list.

## Cause (verified in headless Chrome)
`getCleanText` (`content/text-metrics.js`, "6. Default Fallback") clones the element, replaces
`<select>`s in the clone with their chosen text, then reads `clone.innerText`. A detached clone has
no layout, so `innerText` falls back to `textContent`: no line breaks between block elements.
It affects every element copied at element level, not just Google:
- `<ul><li>One</li><li>Two</li></ul>` → `OneTwo` (live `innerText`: `One\nTwo`)
- `<div><div>A</div><div>B</div></div>` → `AB`
- Google's hover box → `I'm Feeling CuriousI'm Feeling HungryI'm Feeling Trendy`

## Fix (`content/text-metrics.js`, `getCleanText`)
- No `<select>` inside the element (the usual case): read `element.innerText` from the live element,
  which follows the rendered layout (block elements, `<br>`, list items → separate lines; hidden
  elements skipped).
- With `<select>`s inside: keep the clone + replace step, but read the clone's `innerText` while it is
  briefly attached to the page: inserted right after the element (so the page's CSS still applies),
  positioned off-screen (`position:absolute; left:-99999px; top:0`, `aria-hidden`), and removed
  again in the same synchronous step (`try/finally`), so nothing is painted. If attaching fails, it
  falls back to the current detached read.
- The existing per-line trimming, the name fallback for text-less elements, and everything
  downstream (Split styles: one line per item → Quotes, Bullets, CSV… per item) are unchanged.

## Tests
- New `tests/headless/test27.mjs` (added to `run-all.sh`), with the content scripts on a test page:
  - the Google markup (absolute box, nowrap, `div[role=presentation] > span` items) → one line per
    item; with Bullets, each line bulleted
  - `<ul>` of `<li>` → `One\nTwo`; nested divs → `A\nB`; `<p>…<br>…</p>` → two lines
  - inline-only content (`<p>a <b>bold</b> word</p>`) stays one line, spaces kept
  - a div with a `<select>` among block children → the chosen option's text, on its own line,
    and the other blocks still on separate lines; the page DOM has no leftover clone afterward
- Run the full `run-all.sh` (copytest / e2e copy paths).
