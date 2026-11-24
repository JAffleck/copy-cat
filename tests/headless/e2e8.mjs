import { puppeteer, OUT } from './pptr.mjs';
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
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, pipe: true, enableExtensions: [ROOT], args: ['--no-sandbox'] });
const swT = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
const sw = await swT.worker(); const extId = new URL(swT.url()).host;
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1800 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE + '/tests/forms.html', { waitUntil: 'networkidle2', timeout: 60000 });
await page.bringToFront();
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
await page.evaluate(async () => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('s-name', 'Grace Hopper'); set('s-line1', '1 Compiler Way'); set('s-country', 'US');
  await new Promise(r => setTimeout(r, 600)); set('s-state', 'NY'); set('s-postal', '10001');
  await new Promise(r => setTimeout(r, 300)); set('s-city', 'New York');
});
const c = await page.evaluate(() => { const r = document.getElementById('s-name').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
await page.mouse.move(c.x, c.y);
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(c.x, c.y);
await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame();
for (let i = 0; i < 3; i++) { await page.mouse.wheel({ deltaY: 100 }); await frame(); }
await page.keyboard.press('KeyS'); await new Promise(r => setTimeout(r, 1800));
const groups = await sw.evaluate(async () => (await chrome.storage.local.get({ formGroups: [] })).formGroups);
check('S saves the group through the background into chrome.storage', groups.length === 1 && groups[0].name === 'Group 1' && groups[0].site === 'localhost', groups.map(g => g.name));

// background Fill route → content FILL_GROUP → fills the form last clicked in
await page.click('#b-name'); await new Promise(r => setTimeout(r, 300));
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
const res = await sw.evaluate(async (tabId, id) => {
  const key = 'fieldFrame:' + tabId; const frameId = (await chrome.storage.session.get(key))[key] || 0;
  return chrome.tabs.sendMessage(tabId, { type: 'FILL_GROUP', id }, { frameId });
}, tabId, groups[0].id);
const v = await page.evaluate(() => ['b-name', 'b-line1', 'b-city', 'b-country', 'b-state', 'b-postal'].map(id => document.getElementById(id).value));
check('side-panel Fill route fills the billing form', res && res.ok && JSON.stringify(v) === JSON.stringify(['Grace Hopper', '1 Compiler Way', 'New York', 'US', 'NY', '10001']), [res, v]);

const sp = await browser.newPage();
await sp.goto(`chrome-extension://${extId}/sidepanel.html`); await new Promise(r => setTimeout(r, 500));
const listed = await sp.$$eval('#groups li .gname', els => els.map(e => e.textContent));
const metaLine = await sp.$eval('#groups li .meta', e => e.textContent);
check('side panel lists saved groups (name + first values in meta)', listed.length === 1 && listed[0].includes('Group 1') && metaLine.includes('Grace Hopper'), [listed, metaLine]);
await sp.evaluate(() => document.querySelector('#groups li button[title="Delete this group"]').click());
await new Promise(r => setTimeout(r, 500));
const after = await sw.evaluate(async () => (await chrome.storage.local.get({ formGroups: [] })).formGroups.length);
const hidden = await sp.evaluate(() => document.getElementById('groups-section').hidden);
check('side panel Delete removes the group (section hides)', after === 0 && hidden === true, [after, hidden]);
check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); server.close();
