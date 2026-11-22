import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1800 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  const store = { clipHistory: [], formGroups: [] };
  window.__store = store;
  window.chrome = {
    storage: { local: {
      get: (d, cb) => { const r = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k in store ? JSON.parse(JSON.stringify(store[k])) : v]));
        if (cb) { cb(r); return; } return Promise.resolve(r); },
      set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); if (cb) cb(); return Promise.resolve(); } } },
    runtime: { id: 'test',
      sendMessage: (msg) => {
        if (msg.type === 'HISTORY_RECORD') store.clipHistory = window.historyAdd(store.clipHistory, msg.texts, msg);
        if (msg.type === 'GROUP_SAVE') store.formGroups = window.groupsAdd(store.formGroups, msg.group);
        return Promise.resolve({ ok: true });
      },
      onMessage: { addListener() {} } } };
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() } });
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (o) { return orig.call(this, Object.assign({}, o, { mode: 'open' })); };
});
await page.goto('file://' + ROOT + '/tests/forms.html', { waitUntil: 'networkidle2', timeout: 60000 });
for (const f of ['history-core.js', 'groups-core.js']) await page.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });
const m = JSON.parse(readFileSync(ROOT + '/manifest.json', 'utf8'));
for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });
await page.addScriptTag({ content: readFileSync(new URL('./hook.js', import.meta.url), 'utf8') });

let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const center = (id) => page.evaluate((id) => { const el = document.getElementById(id); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }; }, id);
const vals = (ids) => page.evaluate((ids) => Object.fromEntries(ids.map(id => { const el = document.getElementById(id); return [id, el.type === 'checkbox' ? el.checked : el.value]; })), ids);

// 1. user fills the shipping form
await page.evaluate(async () => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('s-name', 'Ada Lovelace'); set('s-line1', '12 Analytical St'); set('s-line2', 'Unit 3'); set('s-tel', '555-0100');
  set('s-country', 'CA'); await new Promise(r => setTimeout(r, 600)); set('s-state', 'ON');
  set('s-postal', 'M5V 2T6'); await new Promise(r => setTimeout(r, 300)); set('s-city', 'Toronto');
  document.getElementById('s-same').checked = true;
  document.querySelector('input[name=delivery][value=express]').checked = true;
  set('s-pw', 'hunter2'); set('s-cc', '4111111111111111');
});
// 2. select the shipping form and press S
const p = await center('s-name');
await page.mouse.move(p.x, p.y);
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y);
await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame();
let cur = '';
for (let i = 0; i < 6 && !cur.startsWith('<FORM'); i++) { await page.mouse.wheel({ deltaY: 100 }); await frame(); cur = await page.evaluate(() => window.__cc().cur); }
check('wheel-out reaches the <FORM#ship>', cur.startsWith('<FORM#ship'), cur);
await page.keyboard.press('KeyS'); await new Promise(r => setTimeout(r, 1800));
const g = await page.evaluate(() => window.__store.formGroups[0]);
check('group saved', !!g, g);
check('group gets the default name Group 1', g && g.name === 'Group 1', g && g.name);
const savedStr = JSON.stringify(g);
check('password and card fields not saved', !savedStr.includes('hunter2') && !savedStr.includes('4111'), g && g.fields.map(f => f.id));
check('saves checkbox + both radios (express checked)', g && g.fields.some(f => f.type === 'checkbox' && f.checked) && g.fields.some(f => f.type === 'radio' && f.value === 'express' && f.checked), g && g.fields.filter(f => f.type !== 'text'));

// 3. fill into the billing form via Alt+click → Saved groups → preview → Enter
async function fillVia(fieldId) {
  const q = await center(fieldId);
  await page.keyboard.down('Alt'); await page.mouse.click(q.x, q.y); await page.keyboard.up('Alt'); await frame();
  const picker = await page.evaluate(() => { const h = document.getElementById('copy-cat-picker'); const pn = h && h.shadowRoot.querySelector('.panel'); return pn ? pn.innerText.replace(/\s+/g, ' ') : null; });
  await page.keyboard.press('Enter'); await frame();
  const preview = await page.evaluate(() => { const h = document.getElementById('copy-cat-picker'); const pn = h && h.shadowRoot.querySelector('.panel.preview'); return pn ? pn.innerText.replace(/\s+/g, ' ') : null; });
  // responsiveness probe: largest gap between 10ms ticks while filling
  await page.evaluate(() => { window.__gap = 0; let last = performance.now(); window.__tick = setInterval(() => { const n = performance.now(); window.__gap = Math.max(window.__gap, n - last); last = n; }, 10); });
  await page.evaluate(() => { window.__toasts = []; window.__toastPoll = setInterval(() => { const h = document.getElementById('copy-cat-picker');
    const t = h && h.shadowRoot.querySelector('.toast'); if (t && window.__toasts.at(-1) !== t.textContent) window.__toasts.push(t.textContent); }, 50); });
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 4500));
  const gap = await page.evaluate(() => { clearInterval(window.__tick); return window.__gap; });
  const toast = await page.evaluate(() => { clearInterval(window.__toastPoll); return window.__toasts.at(-1) || null; });
  return { picker, preview, gap, toast };
}
let r = await fillVia('b-name');
check('picker shows "Saved groups" above history', r.picker && /saved groups/i.test(r.picker) && r.picker.includes('Group 1'), r.picker);
check('preview lists mapping', r.preview && r.preview.includes('Country') && r.preview.includes('Canada') && r.preview.includes('Province / State'), r.preview);
let v = await vals(['b-name', 'b-line1', 'b-line2', 'b-city', 'b-country', 'b-state', 'b-postal', 'b-tel', 'b-same']);
const express = await page.evaluate(() => document.querySelector('input[name=delivery_b][value=express]').checked);
check('billing filled (autocomplete match, shipping → billing)', v['b-name'] === 'Ada Lovelace' && v['b-line1'] === '12 Analytical St' && v['b-line2'] === 'Unit 3' && v['b-postal'] === 'M5V 2T6' && v['b-tel'] === '555-0100', v);
check('country then state after async reload (CA → ON)', v['b-country'] === 'CA' && v['b-state'] === 'ON', v);
check('final pass restores city overwritten by postcode lookup', v['b-city'] === 'Toronto', v);
check('checkbox + radio (label match across different radio names)', v['b-same'] === true && express === true, [v['b-same'], express]);
check(`page stayed responsive during fill (max gap ${Math.round(r.gap)} ms < 250)`, r.gap < 250, r.gap);
check('result toast', r.toast && /Filled \d+ of \d+/.test(r.toast), r.toast);

// 4. labels-only form
r = await fillVia('x1');
v = await vals(['x1', 'x2', 'x3', 'x4', 'x5', 'x6']);
check('labels-only form filled by label text', v.x1 === 'Ada Lovelace' && v.x2 === '12 Analytical St' && v.x3 === 'Toronto' && v.x4 === 'CA' && v.x5 === 'ON' && v.x6 === 'M5V 2T6', v);

// 5. React form
r = await fillVia('r-name');
await frame();
const reactOut = await page.evaluate(() => document.getElementById('react-out').textContent);
v = await vals(['r-name', 'r-city']);
check('React form: values + React state', v['r-name'] === 'Ada Lovelace' && v['r-city'] === 'Toronto' && reactOut === 'Ada Lovelace|Toronto', [v, reactOut]);

// 6. Esc on the preview cancels
await page.evaluate(() => { document.getElementById('x1').value = ''; });
const q = await center('x1');
await page.keyboard.down('Alt'); await page.mouse.click(q.x, q.y); await page.keyboard.up('Alt'); await frame();
await page.keyboard.press('Enter'); await frame(); await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 300));
check('Esc on preview cancels the fill', (await vals(['x1'])).x1 === '', await vals(['x1']));

check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
