// Plan 20: Space re-selects without a mouse move; keycaps in the preview header
import { puppeteer, OUT } from './pptr.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
async function setup(stored) {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument((stored) => {
    const store = Object.assign({}, stored);
    window.chrome = { storage: { local: {
        get: (d, cb) => { const r = Object.assign({}, typeof d === 'object' && d ? d : {}, store); if (cb) { cb(r); return; } return Promise.resolve(r); },
        set: (o, cb) => { Object.assign(store, o); if (cb) cb(); return Promise.resolve(); } }, onChanged: { addListener() {} } },
      runtime: { id: 'test', sendMessage: () => Promise.resolve({ ok: true }), onMessage: { addListener() {} } } };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() } });
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (o) { return orig.call(this, Object.assign({}, o, { mode: 'open' })); };
  }, stored);
  await page.goto('about:blank');
  await page.setContent(`<!doctype html><body style="font:20px sans-serif;padding:30px">
    <p id="p1">Before the bracket (inside words here) and after.</p>
    <p id="p2">No pairs in this sentence at all.</p></body>`);
  const m = JSON.parse(readFileSync(ROOT + '/manifest.json', 'utf8'));
  for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });
  await page.addScriptTag({ content: readFileSync(new URL('./hook.js', import.meta.url), 'utf8') });
  return page;
}
const frame = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const wordAt = (page, w) => page.evaluate((w) => { const t = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = t.nextNode())) { const i = n.nodeValue.indexOf(w); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length);
    const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } } }, w);
const cur = (page) => page.evaluate(() => window.__cc().cur);
const pre = (page) => page.evaluate(() => document.getElementById('copy-cat-host').shadowRoot.querySelector('#preview-toast pre').textContent);
async function start(page, w) { const p = await wordAt(page, w); await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame(page); }

// 1. Space both ways with no mouse movement
{
  const page = await setup({});
  await start(page, 'inside');
  const before = await cur(page);
  await page.keyboard.press('Space'); await frame(page);
  const inBookend = await pre(page);
  check('Space → bracket zoom selects "(inside words here)" with no mouse move', /inside words here/.test(inBookend) && !/Before/.test(inBookend), [before, inBookend]);
  await page.keyboard.press('Space'); await frame(page);
  const back = await pre(page);
  check('Space again → back to the element under the mouse (not the bracket pair)', /Before the bracket/.test(back) || (await cur(page)) !== '', [back, await cur(page)]);
  check('...and the preview no longer shows just the bracket text', back !== inBookend, back);
  // no pair under the mouse: bracket zoom selects nothing, right away
  await page.mouse.move((await wordAt(page, 'sentence')).x, (await wordAt(page, 'sentence')).y); await frame(page);
  await page.keyboard.press('Space'); await frame(page);
  check('Space over text with no pair → nothing selected right away', (await cur(page)) === 'null', await cur(page));
  await page.keyboard.press('Space'); await frame(page);
  check('Space back → the element under the mouse right away', /No pairs/.test(await pre(page)), await pre(page));
  await page.close();
}

// 2. header: one keycap holding the style icon + name (plan 28; no trailing keycaps)
const caps = (page) => page.evaluate(() => {
  const head = document.getElementById('copy-cat-host').shadowRoot.querySelector('.legend-icon');
  const kcs = [...head.querySelectorAll('.kc')];
  const toast = head.parentElement;
  const hints = [...toast.querySelectorAll('.hint')].map(h => h.textContent.replace(/\s+/g, ' ').trim());
  return { hints, hintKeys: [...toast.querySelectorAll('.hint .kc-sm')].map(k => k.textContent), n: kcs.length, icon: !!(kcs[0] && kcs[0].querySelector('svg.style-icon')), text: kcs.map(k => k.textContent.trim()).join('|'),
    plus: head.querySelectorAll('.kc-plus').length };
});
const cases = [
  [{ lineDecoration: 'RAW' }, 'Raw'],
  [{ lineDecoration: 'QUOTED', quoteIndex: 0 }, 'Double quotes'], [{ lineDecoration: 'QUOTED', quoteIndex: 1 }, 'Single quote'],
  [{ lineDecoration: 'QUOTED', quoteIndex: 2 }, 'Backticks'], [{ lineDecoration: 'QUOTED', quoteIndex: 3 }, 'Parenthesis'],
  [{ lineDecoration: 'QUOTED', quoteIndex: 4 }, 'Square brackets'], [{ lineDecoration: 'QUOTED', quoteIndex: 5 }, 'Curly braces'],
  [{ lineDecoration: 'QUOTED_COMMA', quoteIndex: 0 }, 'Double quotes + commas'], [{ lineDecoration: 'QUOTED_COMMA', quoteIndex: 3 }, 'Parenthesis + commas'],
  [{ lineDecoration: 'CSV' }, 'CSV'], [{ lineDecoration: 'BULLETED', bulletIndex: 0 }, 'Bullets'], [{ lineDecoration: 'NUMBERED', outlineIndex: 2 }, 'Numbers'],
  [{ outputFormat: 'COMBINED', quoteIndex: 4 }, 'Combined'],
];
for (const [s, want] of cases) {
  const page = await setup(Object.assign({ outputFormat: 'SPLIT' }, s));
  await start(page, 'inside');
  const got = await caps(page);
  check(`header keycap ${JSON.stringify(s)} → [icon ${want}]`, got.n === 1 && got.icon && got.text === want && got.plus === 0, got);
  // plan 32: Space hint as a keycap; Q line only for styles with Q variants
  const hasQ = s.outputFormat === 'COMBINED' || ['QUOTED', 'QUOTED_COMMA', 'BULLETED', 'NUMBERED'].includes(s.lineDecoration);
  const qLine = got.hints.includes('Q / Shift+Q Change output style');
  check(`  hints: Space keycap${hasQ ? ' + Q / Shift+Q line' : ', no Q line'}`, got.hintKeys[0] === 'Space' && !got.hints.some(h => h.includes('[')) && qLine === hasQ
    && (!hasQ || (got.hintKeys.includes('Q') && got.hintKeys.includes('Shift+Q'))), got.hints);
  if (s.lineDecoration === 'QUOTED_COMMA' && s.quoteIndex === 0) {
    const box = await page.evaluate(() => { const r = document.getElementById('copy-cat-host').shadowRoot.getElementById('preview-toast').getBoundingClientRect(); return { x: r.left - 8, y: r.top - 8, width: r.width + 16, height: r.height + 16 }; });
    await page.screenshot({ path: OUT + 'preview-keycaps.png', clip: box });
  }
  await page.close();
}
check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
