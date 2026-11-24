# Plan 24: Copy-cat icon (cat inside a "copy file" icon) replaces the 😸 emoji (IMPLEMENTED 2026-11-23)

## Request
Copy Preview: make a new icon, a cat inside the file-copy icon, and use it instead of the 😸
character.

## Where 😸 appears today
- `content/output.js:79`: the copy preview toast says `😸 Text Copied! 😸` (set with innerHTML).
- `content/picker.js:187`: the history picker toast says `😸 Copied — paste with Ctrl+V` (set with
  textContent).

## Icon design (24×24, currentColor, same style as the style icons)
- Back sheet: an L-shaped outline below and to the left, like Material "content_copy"
  (stroke 2, round caps).
- Front sheet: a rounded rectangle outline (x 8–20, y 2.5–18.5, stroke 2).
- Inside the front sheet: a filled cat head (two pointed ears, rounded chin) with two eyes cut
  out (even-odd fill), so it reads as a cat at 16px.

```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4.5,7.5 V19.5 A1.5,1.5 0 0 0 6,21 H15.5"/>
  <rect x="8" y="2.5" width="12" height="16" rx="1.5"/>
  <path stroke="none" fill="currentColor" fill-rule="evenodd"
        d="M10.8,14 V7.6 L12.7,9.4 H15.3 L17.2,7.6 V14 Q17.2,16.2 14,16.2 Q10.8,16.2 10.8,14 Z
           M12.8,12.3 m-0.7,0 a0.7,0.7 0 1,0 1.4,0 a0.7,0.7 0 1,0 -1.4,0 Z
           M15.2,12.3 m-0.7,0 a0.7,0.7 0 1,0 1.4,0 a0.7,0.7 0 1,0 -1.4,0 Z"/>
</svg>
```

## Changes
- `style-icons.js` (already loaded by the popup and the content scripts): add
  `copyCatIconSvg(size)` that returns the SVG above (`vertical-align: middle`, `aria-hidden`).
- `content/output.js`: `updateUI(copyCatIconSvg(18) + ' Text Copied!')`, so the icon appears once,
  before the text, instead of a 😸 on each side. `.toast-msg` in `content/overlay.js` gets
  `display: inline-flex; align-items: center; gap: 6px` so the icon and text line up.
- `content/picker.js`: `pickerToast` takes an optional icon: when given, the toast is built as an
  icon span plus a text node (the message stays textContent, nothing user-supplied goes through
  innerHTML). The copied toast becomes icon + `Copied — paste with Ctrl+V`. `.toast` gets the same
  inline-flex alignment.
- Other emoji (✅, ❌, 🔒, 📋, 🧾…) are not changed.

## Testing
- Render the icon at 16, 18 and 48px in headless Chrome and check it reads as a cat on a copy icon.
- Copy something in the copy preview: the toast shows the icon + "Text Copied!", in the toast's blue.
- History picker in copy mode: the toast shows the icon + "Copied — paste with Ctrl+V".
- Run the existing headless tests (`tests/headless`).
