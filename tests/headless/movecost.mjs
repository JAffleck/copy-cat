import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
import { readFileSync } from 'node:fs';
const root = (process.argv[2] || ROOT);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.evaluateOnNewDocument(() => {
  window.chrome = { storage: { local: { get: (d, cb) => cb(Object.assign({}, d)), set: (o, cb) => cb && cb() } },
                    runtime: { id: 'test', sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } } };
});
await page.goto('https://es.wikipedia.org/wiki/Quote_Unquote', { waitUntil: 'networkidle2', timeout: 90000 });
const m = JSON.parse(readFileSync(root + '/manifest.json', 'utf8'));
for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(root + '/' + f, 'utf8') });
await page.mouse.move(400, 420);
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.mouse.click(400, 420);
await page.keyboard.up('Shift'); await page.keyboard.up('Control');
await new Promise(r => setTimeout(r, 300));
const r = await page.evaluate(() => {
  const times = [];
  for (let i = 0; i < 200; i++) {
    const x = 60 + (i * 37) % 1150, y = 120 + (i * 53) % 740;
    const t0 = performance.now(); evaluateMouseCoords(x, y); times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { median: times[100].toFixed(2), p95: times[190].toFixed(2), max: times[199].toFixed(2) };
});
console.log((process.argv[3] || 'now').padEnd(8), JSON.stringify(r));
await browser.close();
