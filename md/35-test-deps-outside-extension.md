# Plan 35: Keep test tooling (Puppeteer) and test screenshots out of the extension folder

## Request
The 31 MB `tests/headless/node_modules` (Puppeteer, test-only) sits inside the extension folder, so
Chrome reads it every time the unpacked extension loads (17–30 s loads seen today) and it would be
packaged if the folder were zipped. Move it outside the extension folder (option 1).

## Where things go
- Puppeteer: `~/.cache/copycat-debug/test-deps/node_modules` (next to the test browsers and
  libraries already in `~/.cache/copycat-debug/`).
- Test screenshots (`tests/headless/out/`, ~1 MB): `~/.cache/copycat-debug/out/`.
- Kept in the repo (small text files): the test scripts, `package.json` / `package-lock.json`
  (they list the test dependency), the test pages in `tests/*.html`.

## Changes
- New `tests/headless/pptr.mjs`: loads Puppeteer from `~/.cache/copycat-debug/test-deps` (Node
  only finds packages in parent folders of the script, so the tests can't import it by name from
  there) and exports `OUT`, the screenshot folder (created if missing). Clear error if Puppeteer
  isn't installed yet, naming the setup command.
- Every test script: `import puppeteer from 'puppeteer'` → `import { puppeteer, OUT } from './pptr.mjs'`;
  screenshot paths `new URL('./out/…', import.meta.url)` / local `OUT` → the shared `OUT`.
- `tests/headless/setup.sh` (new): installs the dependency into the cache folder
  (`npm ci --ignore-scripts --prefix ~/.cache/copycat-debug/test-deps`, using the repo's
  package.json / lock). `run-all.sh` runs it automatically when Puppeteer isn't there yet.
- `tests/headless/README.md`: setup and screenshot location updated.
- `tests/headless/.gitignore`: entries kept (harmless if someone installs locally by mistake).
- After the tests pass from the new location: delete `tests/headless/node_modules` and
  `tests/headless/out` from the extension folder.

## Testing
- Install into the cache folder, run the full `run-all.sh`; all suites pass, including the
  end-to-end ones, with the extension loading from the repo folder.
- Check the extension folder has no `node_modules` / `out` afterward, and its size
  (`du -sh`, excluding `.git`).
