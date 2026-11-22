# Third-party notices

## Material Icons (Google)

Some icons in Copy Cat come from Google's Material Icons / Material Symbols:
https://fonts.google.com/icons · https://github.com/google/material-design-icons

Copyright Google LLC. Licensed under the Apache License, Version 2.0 (the "License"); you may not use
these files except in compliance with the License. A copy of the License is in
[`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt), and at
http://www.apache.org/licenses/LICENSE-2.0. Distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied.

Some icons are used as-is and some are modified. Copy Cat uses the SVG path data inline
(`content`/side panel code), sized and colored with CSS.

| Icon | Where | Changes |
|---|---|---|
| `edit` | Side panel: rename a saved group | Path unchanged; drawn at 16px in the text color |
| `delete` | Side panel: delete a group, a history entry, or a field from a group | Path unchanged; drawn at 16px in the text color, red on hover |
| `close` | Side panel: close button | Path unchanged; drawn at 16px in the text color |
| Combined (article-style box with lines) | Popup legend, in-page preview: Combined style | Path unchanged; `currentColor` |
| Raw (three lines) | Popup legend, in-page preview: Raw style | Path unchanged; `currentColor` |
| CSV | Popup legend, in-page preview: CSV style | **Modified**: the Raw lines shortened ~10%, with commas added |
| Numbered list | Popup legend, in-page preview: Numbers style | Path unchanged; `currentColor` |
| Bulleted list | Popup legend, in-page preview: Bullets style | Path unchanged; `currentColor` |

The quote / bracket marks (curly quotes, backquote, parentheses, brackets, braces) and the commas in
the Quotes + commas and CSV icons are drawn by Copy Cat (`style-icons.js`), not taken from Material.

The `edit` and `delete` paths were taken from the Material icon set as used in the `bug-reporter`
extension (`src/ui/icons.js`).
