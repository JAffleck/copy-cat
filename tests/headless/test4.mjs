import { puppeteer, OUT } from './pptr.mjs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
import { readFileSync, statSync } from 'node:fs';
async function injectContent(page, target) {
  if (statSync(target).isDirectory()) {
    const m = JSON.parse(readFileSync(target + '/manifest.json', 'utf8'));
    for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(target + '/' + f, 'utf8') });
    await page.addScriptTag({ content: readFileSync(new URL('./hook.js', import.meta.url), 'utf8') });
  } else {
    await page.addScriptTag({ content: readFileSync(target, 'utf8') });
  }
}
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  window.chrome = { storage: { local: { get: (d, cb) => cb(Object.assign({}, d, { trackingMode: 'MULTI_SNIP' })), set: (o, cb) => cb && cb() } },
                    runtime: { id: 'test', sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } } };
});
await page.goto('https://es.wikipedia.org/wiki/Quote_Unquote', { waitUntil: 'networkidle2', timeout: 90000 });
await injectContent(page, (process.argv[2] || ROOT));
const wordAt = (w) => page.evaluate((w) => {
  const t = document.createTreeWalker(document.querySelector('#mw-content-text'), NodeFilter.SHOW_TEXT); let n;
  while ((n = t.nextNode())) { const i = n.nodeValue.indexOf(w); if (i >= 0) {
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length); const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } }
}, w);
const st = () => page.evaluate(() => window.__cc());
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const wheel = async (dy) => { await page.mouse.wheel({ deltaY: dy }); await frame(); };
const jitter = async (p, k = 10) => { for (let i = 0; i < k; i++) { await page.mouse.move(p.x + (i % 2 ? 1 : -1), p.y); await frame(); } };

const a = await wordAt('rotación');
await page.mouse.move(a.x, a.y);
await page.keyboard.down('Control'); await page.keyboard.down('Shift');
await page.mouse.click(a.x, a.y);
await page.keyboard.up('Shift'); await page.keyboard.up('Control');
await frame();
// 1. first wheel-in targets the word under the mouse
await wheel(-100); let s = await st();
check('1 first wheel-in selects "rotación"', s.cur.includes('rotación') && s.cur.startsWith('Range'), s);
// 3. zoom-in survives jitter
await jitter(a); s = await st();
check('3 word survives 10x 1px jitter', s.cur.startsWith('Range("rotación'), s);
// 2. wheel out to paragraph; survives jitter; further wheel-out widens
await wheel(100); await wheel(100); s = await st();
const outSel = s.cur;
await jitter(a); s = await st();
check(`2a zoom-out (${outSel}) survives jitter`, s.cur === outSel, s);
await wheel(100); s = await st();
check('2b further wheel-out widens', s.cur !== outSel && !s.cur.startsWith('#text') && !s.cur.startsWith('Range'), s);
const wider = s.cur;
await jitter(a); s = await st();
check(`2c wider (${wider}) survives jitter`, s.cur === wider, s);
// 4. inside the locked section the lock holds; leaving it releases the lock
const b = await wordAt('Travolta');
await page.mouse.move(b.x, b.y, { steps: 5 }); await frame();
s = await st();
check(`4a still inside ${wider}: lock holds`, s.cur === wider, s);
const outside = await page.evaluate((sel) => {
  const sec = document.getElementById('mwAQ');
  const h = [...document.querySelectorAll('#mw-content-text h2')].find(e => !sec.contains(e));
  h.scrollIntoView({ block: 'center' });
  const r = h.getBoundingClientRect();
  return { x: r.left + 20, y: r.top + r.height / 2, text: h.textContent.trim().slice(0, 30) };
}, wider);
await frame();
await page.mouse.move(outside.x, outside.y, { steps: 5 }); await frame();
s = await st();
check(`4b moved outside to heading "${outside.text}": selection follows`, s.cur !== wider, s);
await wheel(100); s = await st();
check(`4c zoom-out from the new spot (${s.cur}) is not the old section`, s.cur !== wider || false, s);
// 5. cost: in-page wheel handler time
const cost = await page.evaluate(({ x, y }) => {
  const t = (dy) => { const s0 = performance.now(); window.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: x, clientY: y, cancelable: true })); return performance.now() - s0; };
  const v = []; for (let i = 0; i < 20; i++) v.push(t(100)); for (let i = 0; i < 20; i++) v.push(t(-100));
  return Math.max(...v);
}, outside);
check(`5 max in-page wheel cost ${cost.toFixed(1)}ms < 20ms`, cost < 20, cost);
check('5 no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
