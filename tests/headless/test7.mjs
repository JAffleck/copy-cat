import { puppeteer, OUT } from './pptr.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1300 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
// Fake extension APIs: storage + a background that applies history-core (loaded into the page)
await page.evaluateOnNewDocument(() => {
  const store = { clipHistory: [] };
  window.__store = store;
  window.chrome = {
    storage: { local: {
      get: (d, cb) => { const r = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k in store ? JSON.parse(JSON.stringify(store[k])) : v]));
        if (cb) { cb(r); return; } return Promise.resolve(r); },
      set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); if (cb) cb(); return Promise.resolve(); } } },
    runtime: { id: 'test',
      sendMessage: (msg) => {
        if (msg.type === 'HISTORY_RECORD') store.clipHistory = window.historyAdd(store.clipHistory, msg.texts, msg);
        return Promise.resolve({ ok: true });
      },
      onMessage: { addListener() {} } } };
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (o) { return orig.call(this, Object.assign({}, o, { mode: 'open' })); };
});
await page.goto('file://' + ROOT + '/tests/fields.html', { waitUntil: 'networkidle2', timeout: 60000 });
await page.addScriptTag({ content: readFileSync(ROOT + '/history-core.js', 'utf8') });
const m = JSON.parse(readFileSync(ROOT + '/manifest.json', 'utf8'));
for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });

let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const center = (id) => page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }; }, id);
const val = (id) => page.evaluate((id) => { const el = document.getElementById(id); return el.isContentEditable ? el.innerText : el.value; }, id);
const panel = () => page.evaluate(() => { const h = document.getElementById('copy-cat-picker'); const p = h && h.shadowRoot.querySelector('.panel'); return p ? p.innerText.replace(/\s+/g, ' ') : null; });
const altClick = async (id) => { const p = await center(id); await page.keyboard.down('Alt'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Alt'); await frame(); };
const copyWith = async (id) => {   // Ctrl+Shift+click → click copies
  const p = await center(id); await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame();
  await page.mouse.move(p.x + 1, p.y); await frame(); await page.mouse.click(p.x + 1, p.y); await new Promise(r => setTimeout(r, 1000)); };
const hist = () => page.evaluate(() => window.__store.clipHistory.map(e => e.text));

// recording
await copyWith('source');
check('copy is recorded in history', (await hist())[0] === 'Ada Lovelace', await hist());
await page.evaluate(() => { window.__store.clipHistory = historyAdd(window.__store.clipHistory, ['second entry', 'CA', '42', 'x@y.com']); });

// paste into fields: pick "Ada Lovelace" (filter "ada", Enter)
async function pasteVia(id, keys) {
  await altClick(id);
  const opened = await panel();
  for (const k of keys) await page.keyboard.press(k);
  await frame();
  return opened;
}
let opened = await pasteVia('plain', ['KeyA', 'KeyD', 'KeyA', 'Enter']);
check('Alt+click field opens picker listing history', opened && opened.includes('Ada Lovelace') && opened.includes('Paste into field'), opened);
check('typed filter + Enter pastes into plain input', (await val('plain')) === 'Ada Lovelace', await val('plain'));
check('typed filter keys did not go into the field', !(await val('plain')).includes('ada'), await val('plain'));

await pasteVia('prefilled', ['KeyA', 'KeyD', 'KeyA', 'Enter']);
check('pastes at caret (end) of prefilled input', (await val('prefilled')) === 'Hello Ada Lovelace', await val('prefilled'));

await pasteVia('email', ['KeyX', 'Shift', 'Enter']);   // filter "x" → x@y.com
check('email input', (await val('email')) === 'x@y.com', await val('email'));
await page.evaluate(() => { document.getElementById('number').value = ''; });
const order = await hist();
const row42 = order.indexOf('42') + 1;
await altClick('number'); await page.keyboard.press('Digit' + row42); await frame();
check(`1-9 with empty filter picks that row (row ${row42} = "42") into a number input`, (await val('number')) === '42', [await val('number'), order]);
await altClick('number'); await page.keyboard.press('ArrowDown'); await frame();
await page.keyboard.press('Escape'); await frame();
check('Esc closes picker without pasting', (await panel()) === null && (await val('number')) === '42', [await panel(), await val('number')]);
// iframe: the content scripts run there too (all_frames); simulate by loading them into the frame
const fr = page.frames().find(f => f !== page.mainFrame());
await fr.addScriptTag({ content: readFileSync(ROOT + '/history-core.js', 'utf8') });
await fr.evaluate(() => { window.chrome = window.parent.chrome; });   // share storage like the real extension
for (const f of m.content_scripts[0].js) await fr.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });
const ib = await page.evaluate(() => { const f = document.getElementById('frame').getBoundingClientRect(); return { x: f.left, y: f.top }; });
const ir = await fr.evaluate(() => { const r = document.getElementById('inner').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; });
await page.keyboard.down('Alt'); await page.mouse.click(ib.x + ir.x, ib.y + ir.y); await page.keyboard.up('Alt');
await new Promise(r => setTimeout(r, 100));
const framePanel = await fr.evaluate(() => { const h = document.getElementById('copy-cat-picker'); const p = h && h.shadowRoot.querySelector('.panel'); return p ? p.innerText.replace(/\s+/g, ' ') : null; });
check('iframe: picker opens inside the frame with history', !!framePanel && framePanel.includes('Ada Lovelace'), framePanel);
for (const k of ['KeyA', 'KeyD', 'KeyA', 'Enter']) await page.keyboard.press(k);
await new Promise(r => setTimeout(r, 100));
check('iframe field: Alt+click → paste', (await fr.evaluate(() => document.getElementById('inner').value)) === 'Ada Lovelace', await fr.evaluate(() => document.getElementById('inner').value));

await pasteVia('notes', ['KeyS', 'KeyE', 'KeyC', 'Enter']);
check('textarea', (await val('notes')) === 'second entry', await val('notes'));

await pasteVia('country', ['KeyC', 'KeyA', 'Enter']);
check('select picks option by value/text ("CA" → Canada)', (await val('country')) === 'CA', await val('country'));

await pasteVia('ce', ['KeyA', 'KeyD', 'KeyA', 'Enter']);
check('contenteditable', (await val('ce')).trim() === 'Ada Lovelace', await val('ce'));

const t0 = Date.now();
await pasteVia('react', ['KeyA', 'KeyD', 'KeyA', 'Enter']);
await frame();
const reactState = await page.evaluate(() => document.getElementById('react-out').textContent);
check('React controlled input: value + React state updated', (await val('react')) === 'Ada Lovelace' && reactState === 'Ada Lovelace', [await val('react'), reactState]);
await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
check('React value survives re-render', (await val('react')) === 'Ada Lovelace', await val('react'));
await pasteVia('vue', ['KeyA', 'KeyD', 'KeyA', 'Enter']);
await frame();
const vueOut = await page.evaluate(() => document.getElementById('vue-out').textContent);
check('Vue v-model: value + model updated', (await val('vue')) === 'Ada Lovelace' && vueOut === 'Ada Lovelace', [await val('vue'), vueOut]);
const insertCost = await page.evaluate(() => { const el = document.getElementById('plain'); el.value = ''; const t = performance.now(); insertIntoField(el, 'timing'); return performance.now() - t; });
check(`insert cost ${insertCost.toFixed(2)} ms < 50 ms`, insertCost < 50, insertCost);

// undo works for execCommand path
await page.evaluate(() => { const el = document.getElementById('plain'); el.value = ''; el.focus(); });
await pasteVia('plain', ['KeyA', 'KeyD', 'KeyA', 'Enter']);
await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control'); await frame();
check('Ctrl+Z undoes the paste', (await val('plain')) === '', await val('plain'));

// password field refuses
await altClick('pw');
check('Alt+click password field: no picker', (await panel()) === null, await panel());

// link: no picker (Chrome keeps its download)
await altClick('link');
check('Alt+click link: no picker', (await panel()) === null, await panel());

// copy mode on plain text
await altClick('source');
opened = await panel();
await page.keyboard.press('Digit2'); await new Promise(r => setTimeout(r, 300));
check('Alt+click text opens copy-mode picker; 2 copies row 2', opened && opened.includes('Copy to clipboard') && (await page.evaluate(() => window.__copied.at(-1))) === (await hist())[1], [opened, await page.evaluate(() => window.__copied.at(-1))]);

// not during selection mode
const p = await center('source');
await page.mouse.move(p.x, p.y); await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y);
await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame();
await page.keyboard.down('Alt'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Alt'); await frame();
check('Alt+click ignored during selection mode', (await panel()) === null, await panel());
await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 700));

// password copy not recorded
await page.evaluate(() => { document.getElementById('pw').value = 'hunter2'; });
await copyWith('pw');
check('copy from password field not recorded', !(await hist()).includes('hunter2'), await hist());

check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
