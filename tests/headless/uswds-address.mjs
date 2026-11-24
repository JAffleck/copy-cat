// Real site: USWDS address form — save a group with S, clear, Alt+click → group → Enter → fill
import { puppeteer, OUT } from './pptr.mjs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, pipe: true, enableExtensions: [ROOT], args: ['--no-sandbox'], protocolTimeout: 20000 });
const sw = await (await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().endsWith('/background.js'))).worker();
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1000 });
const logs = []; page.on('console', m => logs.push(m.type() + ': ' + m.text())); page.on('pageerror', e => logs.push('pageerror: ' + e.message));
await page.goto('https://designsystem.digital.gov/templates/form-templates/address-form/', { waitUntil: 'networkidle2', timeout: 60000 });
await page.bringToFront();
const ids = ['mailing-address-1', 'mailing-address-2', 'city', 'state', 'zip', 'urbanization'];
const vals = () => page.evaluate((ids) => ids.map(id => document.getElementById(id).value), ids);
// user types values
for (const [id, v] of [['mailing-address-1', '123'], ['mailing-address-2', '456'], ['city', '7'], ['zip', '8'], ['urbanization', '11']]) { await page.click('#' + id); await page.keyboard.type(v); }
await page.select('#state', 'GU');
// select the form and press S
const c = await page.evaluate(() => { const el = document.getElementById('mailing-address-1'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
await page.mouse.move(c.x, c.y);
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(c.x, c.y);
await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await sleep(200);
for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: 100 }); await sleep(150); }
await page.keyboard.press('KeyS'); await sleep(1800);
const groups = await sw.evaluate(async () => (await chrome.storage.local.get({ formGroups: [] })).formGroups);
console.log('saved groups:', groups.map(g => g.name + ' / ' + g.fields.length + ' fields'));
// clear the form
await page.evaluate((ids) => ids.forEach(id => { const el = document.getElementById(id); el.value = ''; }), ids);
console.log('cleared:', await vals());
const clear = () => page.evaluate((ids) => ids.forEach(id => { const el = document.getElementById(id); el.value = ''; }), ids);
// find elements inside the closed shadow root via CDP (DevTools sees closed roots)
const cdp = await page.createCDPSession();
async function rowCenter(className) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const found = [];
  (function walk(n) {
    if (n.attributes) {
      const i = n.attributes.indexOf('class'); if (i >= 0 && n.attributes[i + 1].split(' ').includes(className)) found.push(n);
      const a = n.attributes.indexOf('data-act'); if (a >= 0 && n.attributes[a + 1] === className) found.push(n);
    }
    for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c);
  })(root);
  if (!found.length) return null;
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: found[0].backendNodeId });
  const q = model.content; return { x: (q[0] + q[2]) / 2, y: (q[1] + q[5]) / 2, n: found.length };
}
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
const street = await page.evaluate(() => { const r = document.getElementById('mailing-address-1').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });

// (a) shortcut path: focus Street address, OPEN_PICKER, Enter (group), Enter (fill)
await clear(); await page.click('#mailing-address-1');
await sw.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'OPEN_PICKER' }).catch(e => String(e)), tabId); await sleep(400);
await page.keyboard.press('Enter'); await sleep(300); await page.keyboard.press('Enter'); await sleep(4000);
console.log('(a) shortcut + Enter + Enter:', await vals());

// (b) Alt+click, mouse-click the group row, Enter
await clear();
await page.keyboard.down('Alt'); await page.mouse.click(street.x, street.y); await page.keyboard.up('Alt'); await sleep(300);
let rc = await rowCenter('row'); console.log('    row at', rc);
if (rc) await page.mouse.click(rc.x, rc.y); await sleep(300);
await page.keyboard.press('Enter'); await sleep(4000);
console.log('(b) Alt+click + click row + Enter:', await vals());

// (c) Alt+click, Enter, then CLICK the preview instead of Enter
await clear();
await page.keyboard.down('Alt'); await page.mouse.click(street.x, street.y); await page.keyboard.up('Alt'); await sleep(300);
await page.keyboard.press('Enter'); await sleep(300);
rc = await rowCenter('fill'); console.log('    Fill button at', rc); if (rc) await page.mouse.click(rc.x, rc.y); await sleep(4000);
console.log('(c) preview Fill button clicked:', await vals());
console.log('logs:', logs.filter(l => !/favicon|Failed to load resource/.test(l)).slice(-10));
await browser.close();
