// Plan 16: wrap styles incl. brackets, Q cycle, one highlight color (frozen 40%), SVG style icon in the preview
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const errors = [];
async function setup(stored) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument((stored) => {
    const store = Object.assign({ clipHistory: [] }, stored);
    window.chrome = { storage: { local: {
        get: (d, cb) => { const r = Object.assign({}, typeof d === 'object' && d ? d : {}, store); if (cb) { cb(r); return; } return Promise.resolve(r); },
        set: (o, cb) => { Object.assign(store, o); if (cb) cb(); return Promise.resolve(); } } },
      runtime: { id: 'test', sendMessage: () => Promise.resolve({ ok: true }), onMessage: { addListener() {} } } };
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (o) { return orig.call(this, Object.assign({}, o, { mode: 'open' })); };
  }, stored);
  await page.goto('about:blank');   // a fresh document, so the stubs above are installed
  await page.setContent('<!doctype html><body style="font:18px sans-serif"><ul id="list">\n  <li id="a">alpha "one"</li>\n  <li id="b">beta</li>\n</ul><p id="p">Plain paragraph text here.</p></body>');
  const m = JSON.parse(readFileSync(ROOT + '/manifest.json', 'utf8'));
  for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });
  return page;
}
const frame = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const center = (page, id) => page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; }, id);
async function start(page, id) {
  const p = await center(page, id); await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame(page);
}
const toast = (page) => page.evaluate(() => { const h = document.getElementById('copy-cat-host'); return h.shadowRoot.getElementById('preview-toast'); });
const header = (page) => page.evaluate(() => document.getElementById('copy-cat-host').shadowRoot.querySelector('#preview-toast .legend-icon').innerHTML);
const preview = (page) => page.evaluate(() => document.getElementById('copy-cat-host').shadowRoot.querySelector('#preview-toast pre').textContent);
const boxes = (page) => page.evaluate(() => [...document.getElementById('copy-cat-host').shadowRoot.getElementById('overlays-container').children].map(b => b.style.backgroundColor));

// 1. wrap styles: each quote pair wraps each line; symmetric quotes escaped, brackets not
const want = ['"alpha \\"one\\""\n"beta"', "'alpha \"one\"'\n'beta'", '`alpha "one"`\n`beta`', '(alpha "one")\n(beta)', '[alpha "one"]\n[beta]', '{alpha "one"}\n{beta}'];
for (let qi = 0; qi < 6; qi++) {
  const page = await setup({ outputFormat: 'SPLIT', lineDecoration: 'QUOTED', quoteIndex: qi });
  await start(page, 'b');
  let cur = '';
  for (let i = 0; i < 4 && !cur.includes('alpha'); i++) { await page.mouse.wheel({ deltaY: 100 }); await frame(page); cur = await preview(page); }
  check(`quote style ${qi} wraps each line: ${JSON.stringify(want[qi])}`, cur === want[qi], cur);
  if (qi === 3) check('preview header shows the SVG style icon (no emoji)', /<svg class="style-icon"/.test(await header(page)) && !/[🔵🟦🟩📊🔴]/u.test(await header(page)), await header(page));
  await page.close();
}

// 2. Q cycles through all six and wraps around
{
  const page = await setup({ outputFormat: 'SPLIT', lineDecoration: 'QUOTED', quoteIndex: 0 });
  await start(page, 'b');
  const seen = [];
  for (let i = 0; i < 7; i++) { seen.push((await preview(page)).trim()); await page.keyboard.press('KeyQ'); await frame(page); }
  check('Q cycles " \' ` ( [ { and back to "', JSON.stringify(seen) === JSON.stringify(['"beta"', "'beta'", '`beta`', '(beta)', '[beta]', '{beta}', '"beta"']), seen);
  await page.close();
}

// 3. highlight color: chosen color for every style; frozen at 40%
for (const [style, fmt] of [['RAW', 'SPLIT'], ['QUOTED_COMMA', 'SPLIT'], ['RAW', 'COMBINED']]) {
  const page = await setup({ outputFormat: fmt, lineDecoration: style, highlightColor: '#FFFF00', trackingMode: 'MULTI_SNIP' });
  await start(page, 'p');
  const b = await boxes(page);
  check(`highlight is the chosen yellow at 20% (${fmt}/${style})`, b.length > 0 && b.every(c => c === 'rgba(255, 255, 0, 0.2)'), b);
  if (style === 'RAW' && fmt === 'SPLIT') {
    const p = await center(page, 'p'); await page.mouse.click(p.x, p.y, { button: 'right' }); await frame(page);
    const a = await center(page, 'a'); await page.mouse.move(a.x, a.y, { steps: 3 }); await frame(page);
    const b2 = await boxes(page);
    check('frozen selection: same color at 40%, active at 20%', b2.includes('rgba(255, 255, 0, 0.4)') && b2.includes('rgba(255, 255, 0, 0.2)'), b2);
  }
  await page.close();
}
{
  const page = await setup({ highlightColor: 'not-a-color' });
  await start(page, 'p');
  const b = await boxes(page);
  check('missing/invalid color falls back to blue', b.length > 0 && b.every(c => c === 'rgba(0, 0, 255, 0.2)'), b);
  await page.close();
}
check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
