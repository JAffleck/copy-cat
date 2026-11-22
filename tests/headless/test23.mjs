// Plan 23: ← / → move to the previous / next word or item while selecting
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 700 });
page.on('pageerror', e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  window.chrome = { storage: { local: { get: (d, cb) => { const r = Object.assign({}, d, { trackingMode: 'SINGLE_SNIP' }); if (cb) { cb(r); return; } return Promise.resolve(r); }, set: (o, cb) => { if (cb) cb(); return Promise.resolve(); } }, onChanged: { addListener() {} } },
    runtime: { id: 'test', sendMessage: () => Promise.resolve({ ok: true }), onMessage: { addListener() {} } } };
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
});
await page.goto('about:blank');
await page.setContent(`<!doctype html><body style="font:20px serif;padding:30px;width:700px">
  <p id="p1">The quick <b>brown</b> fox jumps<span style="display:none"> hidden</span></p>
  <p id="p2">Next nec&shy;es&shy;sary words.</p>
  <ul id="list"><li id="l1">first item</li><li id="l2">second item</li><li id="l3">third item</li></ul>
  <p id="p3">a <phrase>closely held company</phrase>, not a <phrase>widely held one</phrase>.</p></body>`);
const m = JSON.parse(readFileSync(ROOT + '/manifest.json', 'utf8'));
for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });
await page.addScriptTag({ content: readFileSync(new URL('./hook.js', import.meta.url), 'utf8') });
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const cur = () => page.evaluate(() => window.__cc().cur);
const at = (word) => page.evaluate((word) => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(word); if (i >= 0) { const r = document.createRange(); r.setStart(n, i + 1); r.setEnd(n, i + 2);
    const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } } }, word);
let mouse = null;
async function startOn(word, wheels) {
  await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 650));
  mouse = await at(word); await page.mouse.move(mouse.x, mouse.y);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(mouse.x, mouse.y);
  await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame();
  for (let i = 0; i < wheels; i++) { await page.mouse.wheel({ deltaY: -100 }); await frame(); }
}
const press = async (k) => { await page.keyboard.press(k); await frame(); return cur(); };

// words
await startOn('quick', 2);
check('start: zoomed to the word "quick"', (await cur()) === 'Range("quick")', await cur());
check('→ next word "brown" (inside <b>)', (await press('ArrowRight')) === 'Range("brown")', await cur());
check('→ "fox"', (await press('ArrowRight')) === 'Range("fox")', await cur());
check('→ "jumps"', (await press('ArrowRight')) === 'Range("jumps")', await cur());
check('→ skips hidden text, continues into the next paragraph: "Next"', (await press('ArrowRight')) === 'Range("Next")', await cur());
check('→ soft-hyphen word whole', /^Range\("nec­es­sary"\)$/.test(await press('ArrowRight')), await cur());
check('← back to "Next"', (await press('ArrowLeft')) === 'Range("Next")', await cur());
await page.mouse.move(mouse.x + 1, mouse.y); await frame();
check('1px mouse jitter keeps the keyboard selection', (await cur()) === 'Range("Next")', await cur());
await page.mouse.click(mouse.x + 1, mouse.y); await new Promise(r => setTimeout(r, 800));
check('click copies the moved-to word', (await page.evaluate(() => window.__copied.at(-1))) === 'Next', await page.evaluate(() => window.__copied.at(-1)));

await startOn('The', 2);
check('← on the first word stays', (await press('ArrowLeft')) === 'Range("The")', await cur());
const far = await at('third'); await page.mouse.move(far.x, far.y, { steps: 4 }); await frame();
check('a real mouse move goes back to following the mouse', !(await cur()).includes('"The"'), await cur());

// elements / items
await startOn('second', 0);
check('start on a list item', (await cur()).startsWith('<LI#l2'), await cur());
check('→ next list item', (await press('ArrowRight')).startsWith('<LI#l3'), await cur());
const last = await press('ArrowRight');
check('→ on the last item stays (No more items)', last.startsWith('<LI#l3'), last);
check('← ← back to the first item', (await press('ArrowLeft')).startsWith('<LI#l2') && (await press('ArrowLeft')).startsWith('<LI#l1'), await cur());

await startOn('not a', 0);
const s0 = await cur();
check('start on the text beside the phrases', s0.startsWith('#text(", not a'), s0);
check('→ the next <phrase>', (await press('ArrowRight')).startsWith('<PHRASE'), await cur());
check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
