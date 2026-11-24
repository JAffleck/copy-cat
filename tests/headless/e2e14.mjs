// Plan 14: group names + rename/delete icons, history delete icon, panel toggle route, popup labels · plan 31: popup tabs + start button
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, pipe: true, enableExtensions: [ROOT], args: ['--no-sandbox'] });
const swT = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
const sw = await swT.worker(); const sw0 = sw; const extId = new URL(swT.url()).host;
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
check('popup: no current-style row at the top', !(await pp.$('#mode-display')), null);
check('popup: no Single/Multi-snip mode row (Shift+Space is in the hotkeys)', !(await pp.$('input[name=trackingMode]')), null);
const icons = await pp.$$eval('#style-info [data-style-icon] svg', els => els.length);
check('popup legend uses SVG style icons (7) + 6 quote variants, inside the style-info popover', icons === 7 && (await pp.$$eval('#style-info #quote-variants svg', els => els.length)) === 6, icons);
// Tabs: Copier (default: swatches + start button) / Hotkeys
const tabState = () => pp.evaluate(() => [...document.querySelectorAll('[role=tab]')].map(t => [t.textContent.trim(), t.getAttribute('aria-selected'),
  document.getElementById(t.getAttribute('aria-controls')).hidden]));
check('tabs: Copier (selected, shown) and Hotkeys (hidden)', JSON.stringify(await tabState()) === JSON.stringify([['Copier', 'true', false], ['Hotkeys', 'false', true]]), await tabState());
const startImg = await pp.$eval('#panel-copier #start-selecting img', i => ({ ok: i.complete && i.naturalWidth > 0 && i.getAttribute('src') === '128.png', w: Math.round(i.getBoundingClientRect().width),
  radius: getComputedStyle(i.parentElement).borderRadius }));
check('Copier: big start button with the cat icon (128.png, loaded, 120px, rounded corners)', startImg.ok && startImg.w === 120 && startImg.radius === '16px', startImg);
check('Copier: highlight swatches are in the Copier tab', (await pp.$$('#panel-copier #highlight-swatches')).length === 1, null);
check('no Styles section', !(await pp.$('section.styles')), null);
await pp.screenshot({ path: OUT + 'popup-copier.png', fullPage: true });
const swatches = await pp.$$eval('#highlight-swatches .swatch', els => els.map(e => [e.title, e.getAttribute('aria-checked')]));
check('highlight swatches: red, green, blue (default, checked), yellow, cyan, magenta', JSON.stringify(swatches) === JSON.stringify([['Red', 'false'], ['Green', 'false'], ['Blue', 'true'], ['Yellow', 'false'], ['Cyan', 'false'], ['Magenta', 'false']]), swatches);
await pp.click('#highlight-swatches .swatch[title=Yellow]'); await sleep(300);
const saved = await sw0.evaluate(async () => (await chrome.storage.local.get('highlightColor')).highlightColor);
check('clicking a swatch saves the highlight color', saved === '#FFFF00', saved);
await sw0.evaluate(() => chrome.storage.local.set({ highlightColor: '#0000FF' }));
await pp.reload(); await sleep(400);
const btn = await pp.$eval('#open-history', b => ({ text: b.textContent.trim(), title: b.title }));
check('History button: label + icon only, shortcut in the tooltip', btn.text === '📋 History' && /^(Ctrl\+Shift\+H|No shortcut set) - Toggle copy history panel/.test(btn.title), btn);

await pp.click('#tab-hotkeys'); await sleep(150);
check('clicking Hotkeys shows the Hotkeys tab', JSON.stringify(await tabState()) === JSON.stringify([['Copier', 'false', true], ['Hotkeys', 'true', false]]), await tabState());
await pp.focus('#tab-hotkeys'); await pp.keyboard.press('ArrowLeft'); await sleep(100);
check('← on the tabs goes back to Copier', (await tabState())[0][1] === 'true', await tabState());
await pp.click('#tab-hotkeys'); await sleep(150);
const titles = await pp.$$eval('#panel-hotkeys .section-title', els => els.map(e => e.textContent.trim()));
check('Hotkeys tab: Start / While selecting / Any time', JSON.stringify(titles) === JSON.stringify(['Start', 'While selecting', 'Any time']), titles);
const rows = await pp.$$eval('#panel-hotkeys dl.keys:not(.quote-keys) dt', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
const ti = rows.indexOf('Tab / Shift+Tab');
check('Tab / Shift+Tab row directly above Right-click, then Shift+Space', ti > 0 && rows[ti + 1] === 'Right-click' && rows[ti + 2] === 'Shift+Space', rows);
const keys = await pp.$$eval('#panel-hotkeys dl.keys dd', els => els.map(e => e.textContent.trim()));
check('Tab row says "Cycle styles" with an (i) button', keys.some(k => /^Cycle styles/.test(k)) && !!(await pp.$('#panel-hotkeys .info-button')), keys);
const infoOpen = () => pp.$eval('#style-info', e => e.matches(':popover-open') && e.getBoundingClientRect().height > 0);
check('style-info popover hidden at first', !(await infoOpen()), null);
await pp.click('#panel-hotkeys .info-button'); await sleep(200);
check('clicking (i) opens the style-info popover', await infoOpen(), null);
const fits = await pp.$eval('#style-info', e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
check('popover fits inside the popup (below or above the row)', fits, null);
const qRow = await pp.$eval('#style-info .quote-keys dt', e => e.textContent.replace(/\s+/g, ' ').trim());
check('popover has the Q / Shift+Q hotkey row', qRow === 'Q / Shift+Q', qRow);
await pp.screenshot({ path: OUT + 'popup-style-info.png' });
await pp.keyboard.press('Escape'); await sleep(200);
check('Esc closes the style-info popover', !(await infoOpen()), null);
const dagger = await pp.$$eval('#style-info .footnote', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
check('† on Quotes and Quotes + commas; † note explains Q', (await pp.$$eval('.style-grid li', els => els.filter(e => e.textContent.trim().endsWith('†')).length)) === 2
  && dagger.some(t => t.startsWith('†Quote styles: Q / Shift+Q picks the quote')), dagger);
await pp.screenshot({ path: OUT + 'popup.png', fullPage: true });

// Start button route: START_SELECTION puts the page into selection mode (same as Ctrl+Shift+Click)
await page.bringToFront(); await page.goto(BASE + '/tests/forms.html', { waitUntil: 'networkidle2', timeout: 60000 });
const pageTabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
const startRes = await pp.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'START_SELECTION', tabId }), pageTabId);
await sleep(300);
check('START_SELECTION → ok and the page is in selection mode (preview host present)', startRes && startRes.ok && await page.evaluate(() => !!document.getElementById('copy-cat-host')), startRes);
const hl = await page.evaluate(() => { const el = document.querySelector('label, h1, h2, p'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; });
await page.mouse.move(hl.x, hl.y); await page.mouse.move(hl.x + 4, hl.y); await sleep(300);
await page.screenshot({ path: OUT + 'start-button-selecting.png' });
await page.keyboard.press('Escape'); await sleep(800);   // exits after the 500ms "Copy Cancelled" toast
check('Esc leaves selection mode started from the button', !(await page.evaluate(() => !!document.getElementById('copy-cat-host'))), null);

// in-page preview with the SVG style icon (screenshot for review)
await sw.evaluate(() => chrome.storage.local.set({ outputFormat: 'SPLIT', lineDecoration: 'QUOTED_COMMA', quoteIndex: 0, trackingMode: 'SINGLE_SNIP' }));
await page.bringToFront(); await page.reload({ waitUntil: 'networkidle2' });
const pc = await page.evaluate(() => { const el = document.getElementById('s-name'); el.scrollIntoView({ block: 'center' }); const r = el.closest('form').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 60 }; });
await page.mouse.move(pc.x, pc.y);
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(pc.x, pc.y);
await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await sleep(400);
await page.screenshot({ path: OUT + 'preview.png' });
await page.keyboard.press('Escape');

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); server.close();
