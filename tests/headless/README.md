# Copy Cat headless tests

Browser tests for the extension. Some suites load live es.wikipedia.org pages; the forms/fields
pages load React/Vue from a CDN, so a network connection is needed.

## Setup (once)
```sh
cd tests/headless
npm install --ignore-scripts          # puppeteer only; browsers are installed separately below
npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/copycat-debug/browsers
npx @puppeteer/browsers install chrome@stable --path ~/.cache/copycat-debug/browsers   # end-to-end
```
On WSL/Linux without the browser libraries (libnss3, libnspr4, libatk…), extract them without sudo
into `~/.cache/copycat-debug/libroot` (`apt-get download <pkg>` + `dpkg-deb -x`); `run-all.sh`
adds that folder to `LD_LIBRARY_PATH` automatically.

## Run
```sh
bash run-all.sh            # or: npm test
```
Override browsers with `CHROME_SHELL=/path/to/chrome-headless-shell` and
`CHROME_FULL=/path/to/chrome` (Chrome for Testing; end-to-end suites load the unpacked extension).

## Suites
| Script | What it checks |
|---|---|
| `test4.mjs` | Zoom lock vs 1px jitter, first zoom targets the word under the mouse (plan 4) |
| `shots6.mjs` | Highlighter fill colors, Multi-snip freeze; screenshots in `out/` (plan 6) |
| `copytest.mjs` | Copied text for text run / word / word+x / paragraph+Tab |
| `synth10.mjs` | No hang for x / Space / Bookend hover with every opening bracket/quote (plan 10) |
| `test5.mjs` | Identify names for every source, hover/copy by name (plan 5) |
| `test7.mjs` | History picker: paste into every field type incl. React/Vue/iframe (plan 7) |
| `test8.mjs` | Form groups: save, match, async state, overwrite re-check (plan 8) |
| `test16.mjs` | Wrap styles incl. ( ) [ ] { }, Q cycle, one highlight color (frozen 40%), SVG style icon in the preview (plan 16) |
| `test20.mjs` | Space re-selects without a mouse move (both ways, no pair); preview keycaps per style (plan 20) |
| `test21.mjs` | Soft hyphens / zero-width joiners / Greek, Cyrillic, accented words select whole; invisible chars never copied (plan 21) |
| `test22.mjs` | Text beside a line-wrapped inline element (the reported "not") is selectable; the phrase itself still is (plan 22) |
| `movecost.mjs` | Mouse-move evaluation cost (median/p95/max ms) |
| `e2e7.mjs`, `e2e8.mjs` | Real unpacked extension: background worker, storage, side panel routes |
| `uswds-address.mjs` | Real site (designsystem.digital.gov address form): save a group, fill it via shortcut / row click / Fill button (run by hand) |
| `e2e13.mjs` | Real extension: side-panel group editor (Edit, Copy one value, Remove one field, fill after edit) |
| `e2e14.mjs` | Real extension: Group N names, rename/delete icons, history delete icon, panel toggle route, popup labels; screenshots `out/popup.png`, `out/preview.png` (plan 16 popup checks too) |
| `e2e17.mjs` | Real extension: highlight follows the popup color, incl. changes while selecting; the page never overwrites it (plan 17) |
| `e2e12.mjs` | Real extension: Alt+V / Alt+Shift+V, Insert into an unfocused page and into a tab opened before install, preview Fill button |

`hook.js` is a test-only helper that exposes internal selection state (`window.__cc()`).
Unit tests: `node ../history-core.test.mjs`, `node ../groups-core.test.mjs`.
