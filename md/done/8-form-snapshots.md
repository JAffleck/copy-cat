# Plan 8: form snapshots — save a group of field values, fill them back (IMPLEMENTED 2026-11-21)

Depends on plan 7 (picker, insertion helpers, side panel, `CopyCat` namespace).

## Behavior
**Save (once):** fill a form → Ctrl+Shift+click inside it → zoom out until the highlight covers the
fields → press `S`. Toast: "Saved group: 123 Main St, Toronto (shop.example.com) — 8 fields".
Auto-named from the first two non-empty values + site; rename/delete in the side panel (no prompt
dialog, which would block the page).

**Fill (any time, any site):** Alt+click a field in the target form → picker shows **Saved groups**
above the history → choose one → preview list ("Postal code ← M5V 2T6", unmatched marked) → Enter
fills, Esc cancels. Toast at the end: "Filled 7 of 8 fields" + names of skipped ones.

## Capture (`content/formsnap.js`, triggered by `S` in selection mode via `content/events.js`)
- Fields inside the selected element: `input` (text-like, email, tel, number, date…, plus
  checkbox/radio state), `textarea`, `select`. Skip hidden, disabled, submit/button/file, password,
  and `autocomplete` `cc-*` / `*-password` / `one-time-code`.
- Per field store: `value` (select: value + option text; checkbox/radio: checked), and keys:
  `autocomplete` token, `name`, `id`, label text (`<label for>`, wrapping label, `aria-label`,
  `aria-labelledby`, `placeholder`), `type`, index within the group.
- Storage: `formGroups` in `chrome.storage.local`: `{ id, name, site, time, fields: [...] }`.
- `S` with nothing fillable selected → toast "No form fields in selection".

## Matching (target form)
- Scope: the clicked field's `<form>`, else the nearest ancestor containing ≥ 2 fields.
- For each saved field, best unused target field by: same `autocomplete` token → same `name` →
  same `id` → same normalized label text → same type at the same index. Ambiguous/no match →
  "unmatched" (shown in preview, skipped).

## Filling (async, one field at a time, page stays responsive)
- Order: `country` → `address-level1` (state/province) → remaining fields in page order.
- Per field: focus → set value (plan-7 insert path; `select` by value then text; checkbox/radio via
  `click()` only if the state differs) → `input` + `change` → blur → wait one frame + 50 ms.
- Dependent selects: if the matching option isn't present yet (e.g. state list reloading after
  country), wait up to 3 s (MutationObserver + timeout), then set or mark "option not found".
- Address-autocomplete popups: after filling `address-line1`/street, send Escape to that field.
- Pages that re-render: look each target field up again (by the match keys) right before setting.
- Final pass: re-check every filled field; if the page changed one (e.g. postcode lookup overwrote
  city), set it once more. No loops beyond that.
- All waits use timers/observers with time limits — no busy loops. Cancel with Esc.

## Files
- New: `content/formsnap.js` (content script, after `content/history.js`), `tests/forms.html`
- Edited: `content/events.js` (`S` key → `CopyCat.forms.saveFrom(currentTargetElement)`), `content/history.js`
  (groups section + preview in picker), `sidepanel.*` (groups list: rename, delete, fill into
  last focused form), `manifest.json` (add `formsnap.js`), `popup.html` (hotkey line for `S`)

## Limits (later plan)
Custom dropdowns (react-select, MUI Autocomplete, etc.) aren't real `<select>`s; they're matched
and preview-listed but marked "custom dropdown — set manually" for now.

## Testing (headless)
`tests/forms.html`: shipping + billing address forms with autocomplete attributes; a form without
them (labels only); country `<select>` whose change loads states asynchronously (setTimeout 500 ms);
postcode field whose change overwrites city; React-controlled form; checkbox "billing same as
shipping"; password + card fields (must not be captured).
Checks: save captures expected fields only; fill into the same form, the other form, and a
labels-only form gives the expected values; state set after async load; final pass restores the
overwritten city; React state matches; no errors; page responsive (long-task check) during fill.
Manual: a real checkout/address form in Chrome.

## Outcome
- Implemented as planned: `content/formsnap.js` (capture, two-pass matching, async fill with
  country → state ordering, option waiting, Escape after street line 1, re-find on re-render, final
  re-check pass, preview panel, picker "Saved groups" section, side-panel FILL_GROUP handler),
  `groups-core.js` + background messages (save/rename/delete, FILL_GROUP_ENTRY routing),
  `sidepanel-groups.js` (Fill / Rename / Delete), `S` key in `content/events.js`, popup help.
- Fixed during testing:
  - Matching: a saved field with no strong match could claim another field by position before that
    field was matched (labels-only and React forms got "Unit 3"/"12 Analytical St" in City). Now all
    strong keys first; position fallback only for anonymous targets.
  - Labels: a `<label>` wrapping a `<select>` included the option texts ("Province / State -- Ontario
    Quebec"), so labels didn't match once the list changed. `names.js` now reads label text without
    the wrapped field (also improves Identify).
  - Result toast now stays 5 s (it can list skipped fields); one toast at a time.
- Tests (`tests/forms.html`): headless 17/17 — save from wheel-selected form, password/card not
  saved, checkbox + radio, fill shipping → billing via autocomplete, async state list, city restored
  after postcode overwrite, labels-only form, React form + state, Esc cancels, page responsive
  (max 14 ms gap). End-to-end with the real extension 5/5 (save via background, Fill route, side
  panel list/Delete). All earlier suites still pass; mouse-move cost unchanged (within noise).
- Later plan: custom dropdowns (react-select, MUI Autocomplete) are matched but not set.
