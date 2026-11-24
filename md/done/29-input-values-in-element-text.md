# Plan 29: Containers include their input buttons' labels (and field values) in the copied text (IMPLEMENTED 2026-11-23)

## Request
Selecting Google's `div.FPdoLc` (a `<center>` with the "Google Search" and "I'm Feeling Lucky"
`<input type="submit">` buttons) doesn't capture the buttons.

## Cause (verified in headless Chrome)
- The user's output (`I'm Feeling CuriousI'm Feeling Hungry…`) is the pre-plan-27 behavior: the
  extension hadn't been reloaded. With the current code the hidden hover box is skipped, but the div
  copies as `""`.
- Element text comes from `innerText`, which never includes an `<input>`'s value; an input button's
  displayed text exists only in its `value` attribute. Only `<select>`s inside a container are swapped for their text today.

## Fix (`content/text-metrics.js`, `renderedTextWithSelects` → `renderedTextWithControls`)
Use the existing clone path (clone, swap controls, read `innerText` while briefly attached
off-screen) whenever the element contains any of these, each swapped in the clone for its text:
- `<select>`: chosen option text (as today).
- `<input type="submit|button|reset">`: its `value` attribute (what the button shows; not a
  `<label>` or `aria-label`). With no `value`: the browser's default text, as shown on the page
  ("Submit" / "Reset"; a `type=button` with no value shows nothing, so nothing is copied).
  `<input type="image">`: its `alt`. Buttons become **block** items (`<div>`), so each button is its
  own line / list item, e.g. `Google Search` / `I'm Feeling Lucky` (Split styles → each quoted,
  bulleted, comma-separated…). (`<button>` elements already work: their text is in `innerText`.)
- Text fields (`<input>` text/search/email/url/tel/number/date…, `<textarea>`): their typed value,
  **inline** (a text node), so "Name: [Ann]" reads `Name: Ann`. Empty fields add nothing.
- Never copied: password fields (`isSecretField`), `type=hidden`, checkbox/radio/file/range/color,
  and controls that aren't rendered (`checkVisibility()` false on the original), e.g. the
  `display:none` hover box's contents stay out.
With no such controls inside, the live `innerText` path is unchanged.

## Tests (`tests/headless/test27.mjs`, extended)
- Google markup (both submit inputs + the `display:none` hover box) → `Google Search\nI'm Feeling Lucky`.
- `<input type=button>` without a value → nothing; `type=reset` without value → `Reset`.
- `Name: <input value="Ann">` → `Name: Ann`; a password field's value is not copied; empty field → nothing.
- `<input type=image alt="Go">` → `Go`; hidden input → nothing.
- Existing `<select>` case unchanged; no leftover clone.
- Full `run-all.sh`.
