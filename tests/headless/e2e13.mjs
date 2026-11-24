// Plan 13: side-panel group editor — Edit expands fields, Copy one value, Remove one field
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
const sw = await swT.worker(); const extId = new URL(swT.url()).host;
const fields = [
  { tag: 'INPUT', type: 'text', label: 'Full name', value: 'Grace Hopper', index: 0 },
  { tag: 'INPUT', type: 'text', label: 'City', value: 'Arlington', index: 1 },
  { tag: 'SELECT', type: 'select', label: 'Country', value: 'US', text: 'United States', index: 2 },
  { tag: 'INPUT', type: 'text', label: 'Postal / ZIP code', value: '22201', index: 3 },
  { tag: 'INPUT', type: 'radio', label: 'Standard', name: 'delivery', value: 'standard', checked: false, index: 4 },
];
await sw.evaluate((fields) => chrome.storage.local.set({ formGroups: [{ id: 'g1', name: 'Test group', site: 'localhost', time: Date.now(), fields }] }), fields);

const sp = await browser.newPage();
await browser.defaultBrowserContext().overridePermissions(`chrome-extension://${extId}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
await sp.goto(`chrome-extension://${extId}/sidepanel.html`); await sp.bringToFront(); await sleep(400);
const clickButton = (scope, label) => sp.evaluate((scope, label) => {
  const b = [...document.querySelectorAll(scope + ' button')].find(x => x.textContent === label); if (b) b.click(); return !!b; }, scope, label);
const rows = () => sp.$$eval('#groups .field', els => els.map(e => e.querySelector('.flabel').textContent + '=' + e.querySelector('.fvalue').textContent + (e.classList.contains('inactive') ? ' (inactive)' : '')));

check('fields hidden until Edit', (await rows()).length === 0, await rows());
await clickButton('#groups li .actions', 'Edit fields'); await sleep(200);
let r = await rows();
check('Edit expands one row per field', r.length === 5 && r.includes('Full name=Grace Hopper') && r.includes('Country=United States'), r);
check('unselected radio shown greyed', r.some(x => x.startsWith('Standard=') && x.endsWith('(inactive)')), r);
check('button now says Done', await sp.evaluate(() => [...document.querySelectorAll('#groups li .actions button')].some(b => b.textContent === 'Done')), null);

// Row icons: copy + red X, hidden until the row is hovered
const vis = (label) => sp.evaluate((label) => getComputedStyle([...document.querySelectorAll('#groups .field')].find(e => e.querySelector('.flabel').textContent === label).querySelector('.row-tools')).visibility, label);
const titles = await sp.evaluate(() => [...document.querySelectorAll('#groups .field')][0].querySelectorAll('.row-tools button').length + ':' + [...[...document.querySelectorAll('#groups .field')][0].querySelectorAll('.row-tools button')].map(b => b.title + '|' + b.className).join(' ; '));
check('row has a copy icon and a red X (no text buttons)', /^2:Copy this value\|icon-btn ; Remove this field.*\|icon-btn danger-x$/.test(titles), titles);
check('row icons hidden when not hovered', (await vis('City')) === 'hidden', await vis('City'));
const cityRow = await sp.evaluateHandle(() => [...document.querySelectorAll('#groups .field')].find(e => e.querySelector('.flabel').textContent === 'City'));
await cityRow.hover(); await sleep(100);
check('row icons shown while hovered', (await vis('City')) === 'visible' && (await vis('Full name')) === 'hidden', [await vis('City'), await vis('Full name')]);
const xColor = await sp.evaluate(() => getComputedStyle([...document.querySelectorAll('#groups .field')].find(e => e.querySelector('.flabel').textContent === 'City').querySelector('.danger-x')).color);
check('the X is red', xColor === 'rgb(248, 113, 113)', xColor);
await sp.screenshot({ path: OUT + 'field-row-hover.png' });

// Copy one value (the City row)
await sp.evaluate(() => [...document.querySelectorAll('#groups .field')].find(e => e.querySelector('.flabel').textContent === 'City').querySelector('button[title="Copy this value"]').click());
await sleep(300);
const clip = await sp.evaluate(() => navigator.clipboard.readText());
check('Copy puts the single value on the clipboard', clip === 'Arlington', clip);
await sp.evaluate(() => [...document.querySelectorAll('#groups .field')].find(e => e.querySelector('.flabel').textContent === 'Country').querySelector('button[title="Copy this value"]').click());
await sleep(300);
check('Copy on a select copies its visible text', (await sp.evaluate(() => navigator.clipboard.readText())) === 'United States', await sp.evaluate(() => navigator.clipboard.readText()));

// Remove the City field
await sp.evaluate(() => [...document.querySelectorAll('#groups .field')].find(e => e.querySelector('.flabel').textContent === 'City').querySelector('button.danger-x').click());
await sleep(500);
const stored = await sw.evaluate(async () => (await chrome.storage.local.get({ formGroups: [] })).formGroups[0].fields.map(f => f.label));
r = await rows();
check('Remove drops the field from storage', JSON.stringify(stored) === JSON.stringify(['Full name', 'Country', 'Postal / ZIP code', 'Standard']), stored);
check('editor stays open after the redraw, row gone', r.length === 4 && !r.some(x => x.startsWith('City=')), r);
check('meta shows the new field count', (await sp.$eval('#groups li .meta', e => e.textContent)).startsWith('4 fields'), await sp.$eval('#groups li .meta', e => e.textContent));

// Filling the edited group leaves the removed field alone
const page = await browser.newPage();
await page.goto(BASE + '/tests/forms.html', { waitUntil: 'networkidle2', timeout: 60000 }); await page.bringToFront();
await page.evaluate(() => { document.getElementById('x3').value = 'unchanged'; });
await page.click('#x1'); await sleep(300);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
const res = await sw.evaluate((tabId) => routeToPage({ type: 'FILL_GROUP', id: 'g1' }, { id: tabId }), tabId);
const v = await page.evaluate(() => ['x1', 'x3', 'x4', 'x6'].map(id => document.getElementById(id).value));
check('fill uses the edited group (removed City not filled)', res && res.ok && JSON.stringify(v) === JSON.stringify(['Grace Hopper', 'unchanged', 'US', '22201']), [res, v]);

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); server.close();
