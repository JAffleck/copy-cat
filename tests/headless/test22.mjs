// Plan 22: text beside a line-wrapped inline element is selectable (hit-test by line boxes)
import { puppeteer, OUT } from './pptr.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });
page.on('pageerror', e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  window.chrome = { storage: { local: { get: (d, cb) => { const r = Object.assign({}, d); if (cb) { cb(r); return; } return Promise.resolve(r); }, set: (o, cb) => { if (cb) cb(); return Promise.resolve(); } }, onChanged: { addListener() {} } },
    runtime: { id: 'test', sendMessage: () => Promise.resolve({ ok: true }), onMessage: { addListener() {} } } };
});
await page.goto('about:blank');
// the reported markup; the narrow width makes the <phrase>s wrap across lines
await page.setContent(`<!doctype html><body style="font:20px serif;padding:30px;width:420px"><aside><p>No hyphen is necessary in phrasal adjectives that begin with an adverb ending in <phrase><span>‑ly</span></phrase> (it’s a <phrase>closely held company</phrase>, not a <phrase>closely-held company</phrase>). Nor is a hyphen necessary in multipart foreign terms or proper names used as adjectives (<phrase>habeas corpus appeal on the Third Circuit docket</phrase>, not <phrase>habeas-corpus appeal on the Third-Circuit docket</phrase>).</p></aside></body>`);
const m = JSON.parse(readFileSync(ROOT + '/manifest.json', 'utf8'));
for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });
await page.addScriptTag({ content: readFileSync(new URL('./hook.js', import.meta.url), 'utf8') });
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const cur = () => page.evaluate(() => window.__cc().cur);
// point at the k-th occurrence of `word` (inside its 2nd character)
const at = (word, nth) => page.evaluate((word, nth) => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n, k = 0;
  while ((n = w.nextNode())) { let i = -1; while ((i = n.nodeValue.indexOf(word, i + 1)) >= 0) { if (k++ === nth) {
    const r = document.createRange(); r.setStart(n, i + 1); r.setEnd(n, i + 2); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } } } }, word, nth);
async function start(p) { await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame(); }
const wrapped = await page.evaluate(() => [...document.querySelectorAll('phrase')].filter(p => p.getClientRects().length > 1).length);
check(`setup: some <phrase>s wrap across lines (${wrapped})`, wrapped >= 1, wrapped);
for (const nth of [0, 1]) {
  await start(await at('not', nth));
  const s = await cur();
  await page.mouse.wheel({ deltaY: -100 }); await frame();
  const z = await cur();
  check(`"not" #${nth + 1}: starts on its own text (not a phrase) and zooms to the word`, s.startsWith('#text(", not') && z === 'Range("not")', [s, z]);
  await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 700));
}
for (const word of ['habeas corpus', 'Third-Circuit']) {
  await start(await at(word, 0));
  const s = await cur();
  check(`hovering inside the wrapped phrase ("${word}") still selects it`, s.startsWith('<PHRASE') || s.startsWith('#text("habeas'), s);
  await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 700));
}
check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
