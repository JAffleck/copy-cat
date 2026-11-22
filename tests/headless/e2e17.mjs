// Plan 17: the highlight follows the color picked in the popup (real extension)
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(readFileSync(p));
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, pipe: true, enableExtensions: [ROOT], args: ['--no-sandbox'], protocolTimeout: 15000 });
const swT = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
const sw = await swT.worker(); const extId = new URL(swT.url()).host;

const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 900 });
await page.goto(BASE + '/tests/fields.html', { waitUntil: 'networkidle2', timeout: 60000 });
const cdp = await page.createCDPSession();
// background colors of the highlight boxes inside the (closed) overlay shadow root
async function highlightColors() {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let container = null;
  (function walk(n) { if (n.attributes) { const i = n.attributes.indexOf('id'); if (i >= 0 && n.attributes[i + 1] === 'overlays-container') container = n; }
    for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c); })(root);
  if (!container) return null;
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: container.backendNodeId });
  const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
    functionDeclaration: 'function () { return [...this.children].map(b => b.style.backgroundColor); }' });
  return result.value;
}
async function selectSource() {
  const c = await page.evaluate(() => { const r = document.getElementById('source').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(c.x, c.y);
  await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await sleep(400);
}
const pp = await browser.newPage();
async function pick(title) {
  await pp.bringToFront(); await pp.goto(`chrome-extension://${extId}/popup.html`); await sleep(300);
  await pp.click(`#highlight-swatches .swatch[title=${title}]`); await sleep(300);
}

// pick a color in the popup, then start selecting in the page (tab already open)
for (const [title, rgb] of [['Yellow', '255, 255, 0'], ['Red', '255, 0, 0']]) {
  await pick(title);
  await page.bringToFront();
  await selectSource();
  const c = await highlightColors();
  check(`popup ${title} → highlight rgba(${rgb}, 0.2)`, !!c && c.length > 0 && c.every(x => x === `rgba(${rgb}, 0.2)`), c);
  // change a style while selecting (Tab saves settings) and re-check the color is kept
  await page.keyboard.press('Tab'); await sleep(200); console.log('  step: read color after Tab');
  const c2 = await highlightColors();
  check(`${title} kept after Tab (style change)`, !!c2 && c2.every(x => x === `rgba(${rgb}, 0.2)`), c2);
  await page.keyboard.press('Escape'); await sleep(800);
}
// changing the color in the popup WHILE the page is in selection mode
await page.bringToFront(); await selectSource();
await pick('Green'); await page.bringToFront(); await sleep(300);
const live = await highlightColors();
// and pressing Tab now (the page saves its settings) must not put the old color back
await page.keyboard.press('Tab'); await sleep(300);
check('color changed in the popup while selecting applies right away', !!live && live.length > 0 && live.every(x => x === 'rgba(0, 255, 0, 0.2)'), live);
const stored = await sw.evaluate(async () => (await chrome.storage.local.get('highlightColor')).highlightColor);
check('stored color is the last pick (Tab in the page did not overwrite it)', stored === '#00FF00', stored);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); server.close();
