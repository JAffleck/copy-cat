# Plan 11: keep the headless test suites in the repo (IMPLEMENTED 2026-11-21; plan written after the fact)

User: keep the test tooling (`~/.cache/copycat-debug`, `~/.cache/copycat-preview`,
`~/.cache/copycat-commit-backup`, user-site Pillow) and keep the test scripts.

## Done
- Copied the reusable suites from `~/.cache/copycat-debug` to `tests/headless/`: `test4`, `shots6`,
  `copytest`, `synth10`, `test5`, `test7`, `test8`, `e2e7`, `e2e8`, `movecost` (+ `hook.js`).
  One-off debugging scripts (bisect, probes, repros, xhang) stay in the cache only.
- Paths: each script finds the repo from its own location (`new URL('../..', import.meta.url)`);
  `synth10` builds the content bundle from `manifest.json` itself; screenshots go to `out/`.
- `package.json` (puppeteer, installed with `--ignore-scripts`), `.gitignore` (`node_modules/`,
  `out/`), `run-all.sh` (finds browsers/libraries under `~/.cache/copycat-debug`, overridable with
  `CHROME_SHELL` / `CHROME_FULL`), `README.md` (setup, run, what each suite checks).
- Cache folders and Pillow kept as requested.

## Result
`bash tests/headless/run-all.sh` from the repo: all 11 suites pass (unit 7, jitter 10, highlighter,
copy path, bookend freeze 27/27, Identify 23, picker 24, form groups 17, move cost, end-to-end 11 + 5).
