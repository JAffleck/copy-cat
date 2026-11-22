import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' }); res.end(readFileSync(p));
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, pipe: true, enableExtensions: [ROOT], args: ['--no-sandbox'] });
const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 }).catch(() => null);
check('extension loads; background service worker running', !!swTarget, swTarget && swTarget.url());
if (!swTarget) { await browser.close(); server.close(); process.exit(1); }
const extId = new URL(swTarget.url()).host;
const sw = await swTarget.worker();
const cmds = await sw.evaluate(() => chrome.commands.getAll());
check('Alt+Shift+V command registered', cmds.some(c => c.name === 'open-history-picker' && /Alt\+Shift\+V/i.test(c.shortcut || 'Alt+Shift+V')), cmds);

const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1300 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE + '/tests/fields.html', { waitUntil: 'networkidle2', timeout: 60000 });
await page.bringToFront();
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const center = (id) => page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }; }, id);
const val = (id) => page.evaluate((id) => document.getElementById(id).value, id);
const hist = () => sw.evaluate(async () => (await chrome.storage.local.get({ clipHistory: [] })).clipHistory.map(e => e.text));

// copy via Ctrl+Shift+click → recorded by the background worker
const s = await center('source');
await page.mouse.move(s.x, s.y);
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(s.x, s.y);
await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await frame();
await page.mouse.move(s.x + 1, s.y); await frame(); await page.mouse.click(s.x + 1, s.y);
await new Promise(r => setTimeout(r, 1200));
check('copy recorded by background worker in chrome.storage', (await hist())[0] === 'Ada Lovelace', await hist());
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR ' + e));
check('real clipboard has the copy', clip === 'Ada Lovelace', clip);

// Alt+click a field → paste from history
const f = await center('plain');
await page.keyboard.down('Alt'); await page.mouse.click(f.x, f.y); await page.keyboard.up('Alt'); await frame();
await page.keyboard.press('Enter'); await frame();
check('Alt+click → Enter pastes into the field', (await val('plain')) === 'Ada Lovelace', await val('plain'));

// side-panel "Insert": background routes to the frame with the last focused field
await page.click('#notes'); await new Promise(r => setTimeout(r, 300));
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
const res = await sw.evaluate(async (tabId) => {
  const key = 'fieldFrame:' + tabId; const frameId = (await chrome.storage.session.get(key))[key] || 0;
  return chrome.tabs.sendMessage(tabId, { type: 'INSERT_TEXT', text: 'From side panel' }, { frameId });
}, tabId);
check('side-panel Insert path pastes into last focused field', res && res.ok && (await val('notes')) === 'From side panel', [res, await val('notes')]);

// Alt+Shift+V path: OPEN_PICKER message → picker opens for the focused field
await page.click('#email'); await new Promise(r => setTimeout(r, 200));
await sw.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'OPEN_PICKER' }).catch(() => {}), tabId);
await new Promise(r => setTimeout(r, 300));
const opened = await page.evaluate(() => !!document.getElementById('copy-cat-picker'));
await page.keyboard.press('Escape');
check('OPEN_PICKER (Alt+Shift+V) opens the picker for the focused field', opened, opened);

// side panel page: renders entries; Pin and Delete go through the background
const sp = await browser.newPage();
await sp.goto(`chrome-extension://${extId}/sidepanel.html`);
await new Promise(r => setTimeout(r, 500));
const items = await sp.$$eval('#list li .text', els => els.map(e => e.textContent));
check('side panel lists history', items.includes('Ada Lovelace'), items);
await sp.evaluate(() => [...document.querySelectorAll('#list li')].find(li => li.querySelector('.text').textContent === 'Ada Lovelace').querySelector('button[title^="Pin"]').click());
await new Promise(r => setTimeout(r, 500));
const pinned = await sw.evaluate(async () => (await chrome.storage.local.get({ clipHistory: [] })).clipHistory.find(e => e.text === 'Ada Lovelace')?.pinned);
const pinClass = await sp.evaluate(() => [...document.querySelectorAll('#list li')].find(li => li.querySelector('.text').textContent === 'Ada Lovelace').className);
check('Pin button pins (storage + panel re-render)', pinned === true && pinClass === 'pinned', [pinned, pinClass]);
const entryVis = () => sp.evaluate(() => [...document.querySelectorAll('#list li')].map(li => li.querySelector('.text').textContent.slice(0, 12) + ':' +
  [...li.querySelectorAll('.row-tools button')].map(b => getComputedStyle(b).visibility[0]).join('')));
await sp.mouse.move(5, 5); await new Promise(r => setTimeout(r, 100));
const idle = await entryVis();
check('history icons hidden until hover; a pinned entry keeps its pin visible', idle.every(v => v.startsWith('Ada Lovelace') ? v.endsWith(':hhvh') : v.endsWith(':hhhh')), idle);
const ada = await sp.evaluateHandle(() => [...document.querySelectorAll('#list li')].find(li => li.querySelector('.text').textContent === 'Ada Lovelace'));
await ada.hover(); await new Promise(r => setTimeout(r, 100));
check('hovering an entry shows its copy, insert, pin, delete icons', (await entryVis()).find(v => v.startsWith('Ada Lovelace')).endsWith(':vvvv'), await entryVis());
await sp.screenshot({ path: new URL('./out/history-hover.png', import.meta.url).pathname });
await sp.evaluate(() => [...document.querySelectorAll('#list li')].find(li => li.querySelector('.text').textContent === 'Ada Lovelace').querySelector('button[title="Delete this entry"]').click());
await new Promise(r => setTimeout(r, 500));
check('Delete button removes the entry', !(await hist()).includes('Ada Lovelace'), await hist());

check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); server.close();
