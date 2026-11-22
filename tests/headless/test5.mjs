import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1400 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  window.chrome = { storage: { local: { get: (d, cb) => cb(Object.assign({}, d, { trackingMode: 'SINGLE_SNIP' })), set: (o, cb) => cb && cb() } },
                    runtime: { id: 'test', sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } } };
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (o) { return orig.call(this, Object.assign({}, o, { mode: 'open' })); };
});
await page.goto('file://' + ROOT + '/tests/names.html', { waitUntil: 'load' });
const m = JSON.parse(readFileSync(ROOT + '/manifest.json', 'utf8'));
for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });
await page.addScriptTag({ content: readFileSync(new URL('./hook.js', import.meta.url), 'utf8') });

let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };

// 1. name lists
const names = await page.evaluate(() => Object.fromEntries(['email', 'full', 'search', 'pw', 'del', 'fabtn', 'gear', 'cover', 'ext', 'plain']
  .map(id => [id, getElementNames(document.getElementById(id)).map(n => `${n.source}=${n.text}`)])));
const has = (id, ...want) => check(`names ${id}: ${want.join(', ')}`, want.every(w => names[id].includes(w)), names[id]);
has('email', 'placeholder=you@example.com', 'label=Email address', 'hint=We never share it', 'name=email');
has('full', 'label=Full name', 'name=fullname');
has('search', 'labelled by=Search the site');
check('names pw: no value (password never listed)', !names.pw.some(n => n.includes('hunter2')) && names.pw.includes('placeholder=Password'), names.pw);
has('del', 'aria-label=Delete item', 'title=Remove row', 'data-testid=row-delete');
check('names del: aria-label is first', names.del[0] === 'aria-label=Delete item', names.del);
has('fabtn', 'icon icon=gear');
check('names fabtn: no generic fa-solid/fa-lg', !names.fabtn.some(n => /=(solid|lg)$/.test(n)), names.fabtn);
has('gear', 'svg title=Settings', 'svg icon=icon-gear');
has('cover', 'alt=Album cover', 'caption=Quote Unquote cover', 'file=cover-art.png');
has('ext', 'text=Example site', 'href=https://example.com/page', 'css icon=link-external-small.svg');
has('plain', 'text=Just some text in a box', 'data-testid=plain-box');

// 2. interaction: hover named things, preview fallback, N list, digit copy, click copy
const center = (id) => page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const toast = () => page.evaluate(() => { const h = document.getElementById('copy-cat-host'); return h && h.shadowRoot ? h.shadowRoot.getElementById('preview-toast').innerText.replace(/\s+/g, ' ') : ''; });
const start = async (id) => { const p = await center(id);
  await page.mouse.move(p.x, p.y); await page.keyboard.down('Control'); await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y); await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame(); };
const hover = async (id) => { const p = await center(id); await page.mouse.move(p.x + 1, p.y, { steps: 3 }); await frame(); };
const lastCopy = () => page.evaluate(() => window.__copied.at(-1));

await start('para');
await hover('cover');
let st = await page.evaluate(() => window.__cc().cur);
check('hover image selects <IMG>', st.startsWith('<IMG'), st);
let t = await toast();
check('preview shows alt as fallback + source hint', t.includes('Album cover') && t.includes('Name from alt'), t);
await page.keyboard.press('KeyN'); await frame(); t = await toast();
check('N shows Identify list with alt, caption, file', t.includes('Identify') && t.includes('Album cover') && t.includes('Quote Unquote cover') && t.includes('cover-art.png'), t);
await page.keyboard.press('Digit2'); await new Promise(r => setTimeout(r, 1000));
check('2 copies row 2 (caption)', (await lastCopy()) === 'Quote Unquote cover', await lastCopy());

await start('para'); await hover('del');
st = await page.evaluate(() => window.__cc().cur);
check('hover icon-only button selects <BUTTON> (not the svg)', st.startsWith('<BUTTON#del'), st);
await page.mouse.click((await center('del')).x + 1, (await center('del')).y); await new Promise(r => setTimeout(r, 1000));
check('click copies best name "Delete item"', (await lastCopy()) === 'Delete item', await lastCopy());

await start('para'); await hover('fabtn'); await page.keyboard.press('KeyN'); await frame();
t = await toast();
check('icon-font button lists "gear"', t.includes('gear'), t);
await page.keyboard.press('Escape'); await frame(); t = await toast();
check('Esc leaves Identify but stays in selection mode', !t.includes('Identify') && (await page.evaluate(() => !!document.getElementById('copy-cat-host'))), t);
await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 700));

await start('para'); await hover('full');
await page.mouse.click((await center('full')).x + 1, (await center('full')).y); await new Promise(r => setTimeout(r, 1000));
check('click empty field copies its label "Full name"', (await lastCopy()) === 'Full name', await lastCopy());

await start('para'); await hover('para');
await page.mouse.click((await center('para')).x + 1, (await center('para')).y); await new Promise(r => setTimeout(r, 1000));
check('normal text copy unchanged', (await lastCopy()) === 'A normal paragraph with words to start selection mode on.', await lastCopy());

check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
