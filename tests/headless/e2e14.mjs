// Plan 14: group names + rename/delete icons, history delete icon, panel toggle route, popup labels
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const OUT = new URL('./out/', import.meta.url).pathname;
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(readFileSync(p));
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, pipe: true, enableExtensions: [ROOT], args: ['--no-sandbox'] });
const swT = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
const sw = await swT.worker(); const extId = new URL(swT.url()).host;
const groups = () => sw.evaluate(async () => (await chrome.storage.local.get({ formGroups: [] })).formGroups);

// 1. saving two groups → "Group 1", "Group 2"
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1600 });
await page.goto(BASE + '/tests/forms.html', { waitUntil: 'networkidle2', timeout: 60000 }); await page.bringToFront();
async function saveForm(fieldId) {
  await page.evaluate((id) => { const el = document.getElementById(id); el.value = 'Val ' + id; }, fieldId);
  const c = await page.evaluate((id) => { const el = document.getElementById(id); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; }, fieldId);
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(c.x, c.y);
  await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await sleep(200);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel({ deltaY: 100 }); await sleep(150); }
  await page.keyboard.press('KeyS'); await sleep(1800);
}
await saveForm('s-name'); await saveForm('b-name');
let g = await groups();
check('default names Group 1, Group 2', JSON.stringify(g.map(x => x.name).sort()) === JSON.stringify(['Group 1', 'Group 2']), g.map(x => x.name));

// 2. side panel: rename via edit icon, Esc cancels, Enter saves; delete icons
await sw.evaluate(() => chrome.storage.local.set({ clipHistory: [{ id: 'h1', text: 'Ada Lovelace', time: Date.now(), title: 'T', url: '', pinned: false },
  { id: 'h2', text: 'Delete me', time: Date.now(), title: 'T', url: '', pinned: false }] }));
const sp = await browser.newPage(); await sp.setViewport({ width: 380, height: 560 });
await sp.goto(`chrome-extension://${extId}/sidepanel.html`); await sp.bringToFront(); await sleep(500);
const names = () => sp.$$eval('#groups .gname', els => els.map(e => e.textContent));
const clickIcon = (idx, title) => sp.evaluate((idx, title) => document.querySelectorAll('#groups li')[idx].querySelector(`.ghead button[title="${title}"]`).click(), idx, title);
check('meta line shows count, site and first values', (await sp.$eval('#groups li .meta', e => e.textContent)).match(/^\d+ fields · localhost · Val /) !== null, await sp.$eval('#groups li .meta', e => e.textContent));
await clickIcon(0, 'Rename this group'); await sleep(100);
await sp.keyboard.type('XYZ'); await sp.keyboard.press('Escape'); await sleep(300);
check('rename: Esc cancels', !(await names()).some(n => n.includes('XYZ')) && (await groups()).every(x => !x.name.includes('XYZ')), await names());
await clickIcon(0, 'Rename this group'); await sleep(100);
await sp.keyboard.down('Control'); await sp.keyboard.press('KeyA'); await sp.keyboard.up('Control');
await sp.keyboard.type('Shipping test address'); await sp.keyboard.press('Enter'); await sleep(500);
check('rename: Enter saves (storage + panel)', (await groups()).some(x => x.name === 'Shipping test address') && (await names()).some(n => n.includes('Shipping test address')), [await names()]);
await sp.screenshot({ path: OUT + 'sidepanel-groups.png' });
const before = (await groups()).length;
await clickIcon(1, 'Delete this group'); await sleep(500);
check('group delete icon', (await groups()).length === before - 1, (await groups()).map(x => x.name));
await sp.evaluate(() => [...document.querySelectorAll('#list li')].find(li => li.querySelector('.text').textContent === 'Delete me').querySelector('button[title="Delete this entry"]').click());
await sleep(500);
const hist = await sw.evaluate(async () => (await chrome.storage.local.get({ clipHistory: [] })).clipHistory.map(e => e.text));
check('history delete icon', JSON.stringify(hist) === JSON.stringify(['Ada Lovelace']), hist);

// 3. panel toggle route: the panel registers its window; CLOSE_PANEL closes it
const winId = await sp.evaluate(() => new Promise(r => chrome.windows.getCurrent(w => r(w.id))));
const registered = await sw.evaluate((w) => openPanels.has(w), winId);
check('open panel registers its window with the background', registered, registered);
const closed = new Promise(r => sp.once('close', () => r(true)));
await sw.evaluate((w) => { lastToggle = 0; return togglePanel(w); }, winId);
check('toggle on an open panel closes it', await Promise.race([closed, sleep(2000).then(() => false)]), false);
await sleep(300);
check('closed panel unregisters', !(await sw.evaluate((w) => openPanels.has(w), winId)), null);
const cmds = await sw.evaluate(() => chrome.commands.getAll());
check('Ctrl+Shift+H command registered', cmds.some(c => c.name === 'toggle-history-panel'), cmds.map(c => c.name + ':' + c.shortcut));

// 4. popup: labels + screenshot
const pp = await browser.newPage(); await pp.setViewport({ width: 372, height: 900 });
await sw.evaluate(() => chrome.storage.local.set({ outputFormat: 'SPLIT', lineDecoration: 'QUOTED_COMMA', trackingMode: 'MULTI_SNIP' }));
await pp.goto(`chrome-extension://${extId}/popup.html`); await sleep(400);
const status = await pp.$eval('#mode-display', e => e.textContent);
check('popup status uses the new label', status === '🟩 Quotes + commas · split', status);
const multi = await pp.$eval('input[value=MULTI_SNIP]', e => e.checked);
check('popup snipping toggle reflects Multi-snip', multi === true, multi);
await sw.evaluate(() => chrome.storage.local.set({ outputFormat: 'COMBINED' }));
await pp.reload(); await sleep(400);
check('popup status for Combined', (await pp.$eval('#mode-display', e => e.textContent)) === '🔴 Combined', await pp.$eval('#mode-display', e => e.textContent));
await sw.evaluate(() => chrome.storage.local.set({ outputFormat: 'SPLIT', lineDecoration: 'RAW', trackingMode: 'SINGLE_SNIP' }));
await pp.reload(); await sleep(400);
await pp.screenshot({ path: OUT + 'popup.png', fullPage: true });

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); server.close();
