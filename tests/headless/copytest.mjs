import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
import { readFileSync, statSync } from 'node:fs';
const target = (process.argv[2] || ROOT);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  window.chrome = { storage: { local: { get: (d, cb) => cb(Object.assign({}, d, { trackingMode: 'SINGLE_SNIP' })), set: (o, cb) => cb && cb() } },
                    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } } };
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
});
await page.goto('https://es.wikipedia.org/wiki/Quote_Unquote', { waitUntil: 'networkidle2', timeout: 90000 });
if (statSync(target).isDirectory()) {
  const m = JSON.parse(readFileSync(target + '/manifest.json', 'utf8'));
  for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(target + '/' + f, 'utf8') });
} else await page.addScriptTag({ content: readFileSync(target, 'utf8') });
const a = await page.evaluate(() => {
  const t = document.createTreeWalker(document.querySelector('#mw-content-text'), NodeFilter.SHOW_TEXT); let n;
  while ((n = t.nextNode())) { const i = n.nodeValue.indexOf('rotación'); if (i >= 0) {
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 8); const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } }
});
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
const run = async (label, steps) => {
  await page.mouse.move(a.x, a.y);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame();
  for (const s of steps) { await s(); await frame(); }
  await page.mouse.click(a.x, a.y); await new Promise(r => setTimeout(r, 1000));
  const c = await page.evaluate(() => window.__copied.at(-1));
  console.log(label.padEnd(22), JSON.stringify((c || '').slice(0, 70)));
};
await run('text run', []);
await run('word (wheel in)', [() => page.mouse.wheel({ deltaY: -100 })]);
await run('word + x (quotes)', [() => page.mouse.wheel({ deltaY: -100 }), () => page.keyboard.press('KeyX')]);
await run('paragraph, Tab style', [() => page.mouse.wheel({ deltaY: 100 }), () => page.keyboard.press('Tab')]);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
