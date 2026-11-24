// Test tooling lives outside the extension folder (plan 35): Chrome reads every file in an unpacked
// extension's folder when loading it, so Puppeteer (~30 MB) and the test screenshots are kept in
// ~/.cache/copycat-debug next to the test browsers. Node only finds packages in parent folders of
// the importing script, so Puppeteer is loaded from there by path. Setup: bash setup.sh
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CACHE = path.join(os.homedir(), '.cache', 'copycat-debug');
export const DEPS = path.join(CACHE, 'test-deps');
export const OUT = path.join(CACHE, 'out') + path.sep;     // screenshots
mkdirSync(OUT, { recursive: true });

let entry;
try {
  entry = createRequire(path.join(DEPS, 'package.json')).resolve('puppeteer');
} catch (e) {
  console.error(`Puppeteer isn't installed in ${DEPS}.\nRun: bash tests/headless/setup.sh`);
  process.exit(1);
}
const mod = await import(pathToFileURL(entry).href);
export const puppeteer = mod.default && mod.default.launch ? mod.default : (mod.default && mod.default.default) || mod;
