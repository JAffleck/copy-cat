import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
import { readFileSync, statSync } from 'node:fs';
async function injectContent(page, target) {
  if (statSync(target).isDirectory()) {
    const m = JSON.parse(readFileSync(target + '/manifest.json', 'utf8'));
    for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(target + '/' + f, 'utf8') });
    await page.addScriptTag({ content: readFileSync(new URL('./hook.js', import.meta.url), 'utf8') });
  } else {
    await page.addScriptTag({ content: readFileSync(target, 'utf8') });
  }
}
const file = ROOT;
const dark = process.argv.includes('dark');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  window.chrome = { storage: { local: { get: (d, cb) => cb(Object.assign({}, d, { trackingMode: 'MULTI_SNIP' })), set: (o, cb) => cb && cb() } },
                    runtime: { id: 'test', sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } } };
});
await page.goto('https://es.wikipedia.org/wiki/Quote_Unquote', { waitUntil: 'networkidle2', timeout: 90000 });
if (dark) await page.evaluate(() => { document.documentElement.classList.remove('skin-theme-clientpref-day', 'skin-theme-clientpref-os'); document.documentElement.classList.add('skin-theme-clientpref-night'); });
await injectContent(page, file);
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const wordAt = (w) => page.evaluate((w) => {
  const t = document.createTreeWalker(document.querySelector('#mw-content-text'), NodeFilter.SHOW_TEXT); let n;
  while ((n = t.nextNode())) { const i = n.nodeValue.indexOf(w); if (i >= 0) {
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length); const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } }
}, w);
const clip = { x: 0, y: 250, width: 1280, height: 330 };
const tag = dark ? 'dark' : 'light';
const a = await wordAt('rotación');
await page.mouse.move(a.x, a.y);
await page.keyboard.down('Control'); await page.keyboard.down('Shift');
await page.mouse.click(a.x, a.y);
await page.keyboard.up('Shift'); await page.keyboard.up('Control');
await frame(); await page.screenshot({ path: new URL(`./out/s6_${tag}_1_textrun.png`, import.meta.url).pathname, clip });
await page.mouse.wheel({ deltaY: -100 }); await frame(); await page.screenshot({ path: new URL(`./out/s6_${tag}_2_word.png`, import.meta.url).pathname, clip });
await page.mouse.wheel({ deltaY: 100 }); await page.mouse.wheel({ deltaY: 100 }); await frame();
await page.screenshot({ path: new URL(`./out/s6_${tag}_3_paragraph.png`, import.meta.url).pathname, clip });
console.log(tag, 'before freeze', JSON.stringify(await page.evaluate(() => window.__cc())));
await page.mouse.click(a.x, a.y, { button: 'right' }); await frame();           // freeze (Multi-snip)
console.log(tag, 'after freeze', JSON.stringify(await page.evaluate(() => window.__cc())));
const b = await wordAt('Travolta');
await page.mouse.move(b.x, b.y, { steps: 4 }); await frame();
console.log(tag, 'after move', JSON.stringify(await page.evaluate(() => window.__cc())));
await page.screenshot({ path: new URL(`./out/s6_${tag}_4_frozen_active.png`, import.meta.url).pathname, clip });
const img = await page.evaluate(() => { const i = document.querySelector('#mw-content-text img'); if (!i) return null;
  i.scrollIntoView({ block: 'center' }); const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, sy: scrollY }; });
if (img) { await frame(); await page.mouse.move(img.x, img.y, { steps: 4 }); await frame();
  await page.screenshot({ path: new URL(`./out/s6_${tag}_5_image.png`, import.meta.url).pathname, clip: { x: Math.max(0, img.x - 250), y: Math.max(0, img.y + img.sy - 200), width: 500, height: 400 } });
  console.log(tag, 'image state', await page.evaluate(() => window.__cc().cur)); }
const borders = await page.evaluate(() => { const h = document.getElementById('copy-cat-host');
  return h ? 'overlay present' : 'no overlay'; });
console.log(tag, borders, 'errors:', errors.length ? errors : 'none');
await browser.close();
