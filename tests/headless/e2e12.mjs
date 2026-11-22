// Plan 12: side-panel Insert and Alt+V in realistic conditions (real extension, Chrome for Testing)
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

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, pipe: true, enableExtensions: true, args: ['--no-sandbox'] });
// A tab that is open BEFORE the extension is installed has no content scripts (like a tab left open
// across an extension reload)
const stale = await browser.newPage();
await stale.goto(BASE + '/tests/fields.html', { waitUntil: 'networkidle2', timeout: 60000 });
await stale.evaluate(() => document.getElementById('email').focus());
await browser.installExtension(ROOT);
let swTarget = null;
const getSW = async (not) => {
  swTarget = await browser.waitForTarget(t => t !== not && t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  return swTarget.worker();
};
let sw = await getSW();
await sw.evaluate(() => chrome.storage.local.set({ clipHistory: [{ id: 'a1', text: 'Ada Lovelace', time: Date.now(), title: '', url: '', pinned: false }] }));

const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1000 });
await page.goto(BASE + '/tests/fields.html', { waitUntil: 'networkidle2', timeout: 60000 });
await page.bringToFront();
const val = (id) => page.evaluate((id) => document.getElementById(id).value, id);
const panelOpen = async () => true;   // closed shadow root; the pasted value proves the picker opened
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);

// 1. Alt+V and Alt+Shift+V pressed in the page open the picker; Enter pastes
for (const [label, shift] of [['Alt+V', false], ['Alt+Shift+V', true]]) {
  await page.evaluate(() => { const el = document.getElementById('plain'); el.value = ''; el.focus(); });
  await page.keyboard.down('Alt'); if (shift) await page.keyboard.down('Shift');
  await page.keyboard.press('KeyV');
  if (shift) await page.keyboard.up('Shift'); await page.keyboard.up('Alt');
  await sleep(200);
  const open = await panelOpen();
  if (open) { await page.keyboard.press('Enter'); await sleep(100); }
  check(`${label} in the page opens the picker and Enter pastes`, open && (await val('plain')) === 'Ada Lovelace', [open, await val('plain')]);
}

// 2. Insert while the page is NOT focused (focus is in the side panel in real use)
await page.click('#notes'); await sleep(200);
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
const other = await browser.newPage(); await other.bringToFront(); await sleep(300);
const focused = await page.evaluate(() => document.hasFocus());
let res = await sw.evaluate((tabId) => routeToPage({ type: 'INSERT_TEXT', text: 'Unfocused insert' }, { id: tabId }), tabId);
check(`Insert into a page that isn't focused (hasFocus=${focused})`, res && res.ok && (await val('notes')) === 'Unfocused insert', [res, await val('notes')]);
await other.close(); await page.bringToFront();

// 3. Tab opened before the extension was installed (no content scripts), field already focused
await stale.bringToFront(); await sleep(300);
const staleId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
res = await sw.evaluate((tabId) => routeToPage({ type: 'INSERT_TEXT', text: 'x@y.com' }, { id: tabId }), staleId);
check('Insert into a tab with no content scripts injects them and pastes into the focused field', res && res.ok && (await stale.evaluate(() => document.getElementById('email').value)) === 'x@y.com', [res, await stale.evaluate(() => document.getElementById('email').value)]);

// 4. after that, Alt+V works in the same (not refreshed) tab too
await stale.evaluate(() => { const el = document.getElementById('plain'); el.value = ''; el.focus(); });
await stale.keyboard.down('Alt'); await stale.keyboard.press('KeyV'); await stale.keyboard.up('Alt'); await sleep(300);
await stale.keyboard.press('Enter'); await sleep(200);
check('Alt+V works in that tab after the injection', (await stale.evaluate(() => document.getElementById('plain').value)) === 'Ada Lovelace', await stale.evaluate(() => document.getElementById('plain').value));
await page.bringToFront();

// 5. Form group preview: clicking the Fill button fills the form (clicking used to do nothing)
await page.goto(BASE + '/tests/forms.html', { waitUntil: 'networkidle2', timeout: 60000 });
await sw.evaluate(() => chrome.storage.local.set({ formGroups: [{ id: 'g1', name: 'Test group', site: 'localhost', time: Date.now(), fields: [
  { tag: 'INPUT', type: 'text', autocomplete: '', name: '', id: '', label: 'Full name', index: 0, value: 'Grace Hopper' },
  { tag: 'INPUT', type: 'text', autocomplete: '', name: '', id: '', label: 'City', index: 1, value: 'Arlington' }] }] }));
const x1 = await page.evaluate(() => { const el = document.getElementById('x1'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
await page.keyboard.down('Alt'); await page.mouse.click(x1.x, x1.y); await page.keyboard.up('Alt'); await sleep(300);
await page.keyboard.press('Enter'); await sleep(300);           // choose the group → preview
const cdp2 = await page.createCDPSession();
const { root } = await cdp2.send('DOM.getDocument', { depth: -1, pierce: true });
let fillBtn = null;
(function walk(n) { if (n.attributes) { const i = n.attributes.indexOf('data-act'); if (i >= 0 && n.attributes[i + 1] === 'fill') fillBtn = n; }
  for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c); })(root);
if (fillBtn) { const { model } = await cdp2.send('DOM.getBoxModel', { backendNodeId: fillBtn.backendNodeId }); const q = model.content;
  await page.mouse.click((q[0] + q[2]) / 2, (q[1] + q[5]) / 2); }
await sleep(1500);
const got5 = await page.evaluate(() => [document.getElementById('x1').value, document.getElementById('x3').value]);
check('preview Fill button fills the form', !!fillBtn && got5[0] === 'Grace Hopper' && got5[1] === 'Arlington', [!!fillBtn, got5]);

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); server.close();
