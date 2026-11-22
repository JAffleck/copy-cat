// Plan 21: soft hyphens / invisible characters / non-Latin letters don't split words; never copied
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 700 });
page.on('pageerror', e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  window.chrome = { storage: { local: { get: (d, cb) => { const r = Object.assign({}, d, { outputFormat: 'SPLIT', lineDecoration: 'RAW' }); if (cb) { cb(r); return; } return Promise.resolve(r); },
      set: (o, cb) => { if (cb) cb(); return Promise.resolve(); } }, onChanged: { addListener() {} } },
    runtime: { id: 'test', sendMessage: () => Promise.resolve({ ok: true }), onMessage: { addListener() {} } } };
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
});
await page.goto('about:blank');
// the reported page's markup: soft hyphens inside words
await page.setContent(`<!doctype html><body style="font:22px serif;padding:30px;width:900px">
  <p id="shy">No hy&shy;phen is nec&shy;es&shy;sary in phrasal ad&shy;jec&shy;tives that be&shy;gin with an ad&shy;verb</p>
  <p id="zw">join‍ed word and zero​width space and Ελληνικά and Привет and naïve</p>
  <p id="punct">alpha,beta (gamma) "delta" epsilon/zeta</p></body>`);
const m = JSON.parse(readFileSync(ROOT + '/manifest.json', 'utf8'));
for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });

const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
// point inside the n-th character of a word as it appears in the DOM text (with invisible chars)
const at = (id, word, k = 1) => page.evaluate((id, word, k) => { const n = document.getElementById(id).firstChild; const i = n.nodeValue.indexOf(word);
  const r = document.createRange(); r.setStart(n, i + k); r.setEnd(n, i + k + 1); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, id, word, k);
// select the word under the point (start, wheel in once) and copy it
async function wordAt(id, word, k) {
  const p = await at(id, word, k);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame();
  for (let i = 0; i < 2; i++) { await page.mouse.wheel({ deltaY: -100 }); await frame(); }   // paragraph → text → word
  await page.mouse.click(p.x, p.y); await new Promise(r => setTimeout(r, 900));
  return page.evaluate(() => window.__copied.at(-1));
}
check('soft hyphens: "nec&shy;es&shy;sary" (pointing at "es") selects the whole word', (await wordAt('shy', 'es­sary', 1)) === 'necessary', await page.evaluate(() => window.__copied.at(-1)));
check('soft hyphens: "ad&shy;jec&shy;tives" → "adjectives" (no soft hyphens copied)', (await wordAt('shy', 'jec', 1)) === 'adjectives', await page.evaluate(() => window.__copied.at(-1)));
check('zero-width joiner stays inside the word (copied without it)', (await wordAt('zw', 'join', 1)) === 'joined', await page.evaluate(() => window.__copied.at(-1)));
check('zero-width space still separates words', (await wordAt('zw', 'width', 2)) === 'width', await page.evaluate(() => window.__copied.at(-1)));
check('Greek word selected whole', (await wordAt('zw', 'Ελληνικά', 3)) === 'Ελληνικά', await page.evaluate(() => window.__copied.at(-1)));
check('Cyrillic word selected whole', (await wordAt('zw', 'Привет', 3)) === 'Привет', await page.evaluate(() => window.__copied.at(-1)));
check('accented Latin word selected whole', (await wordAt('zw', 'naïve', 2)) === 'naïve', await page.evaluate(() => window.__copied.at(-1)));
check('comma still splits', (await wordAt('punct', 'beta', 1)) === 'beta', await page.evaluate(() => window.__copied.at(-1)));
check('slash still splits', (await wordAt('punct', 'zeta', 1)) === 'zeta', await page.evaluate(() => window.__copied.at(-1)));

// whole paragraph copy: no invisible characters in the output
const p = await at('shy', 'hy', 0);
await page.mouse.move(p.x, p.y);
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y);
await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame();
await page.mouse.click(p.x, p.y); await new Promise(r => setTimeout(r, 900));
const para = await page.evaluate(() => window.__copied.at(-1));
check('paragraph copy contains no soft hyphens', !/[­​-‍⁠﻿]/.test(para) && para.includes('necessary') && para.includes('adjectives'), para);
check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
