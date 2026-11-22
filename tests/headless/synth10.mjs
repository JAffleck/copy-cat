import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
import { readFileSync } from 'node:fs';
const tag = process.argv[2] || 'now';
const m = JSON.parse(readFileSync(ROOT + '/manifest.json', 'utf8'));
const bundle = m.content_scripts[0].js.map(f => readFileSync(ROOT + '/' + f, 'utf8')).join('\n');
const pairs = [['(', ')'], ['[', ']'], ['{', '}'], ['«', '»'], ['“', '”'], ['‘', '’'], ['⟨', '⟩'], ['"', '"'], ['`', '`']];
const html = '<!doctype html><meta charset=utf-8><body style="font:18px sans-serif;width:700px">' +
  pairs.map(([o, c], i) => `<p id=p${i}>${o}Start${i}${c} some words then target${i} word and more text here.</p>`).join('') + '</body>';
let results = [];
for (const action of ['x', 'space', 'hover']) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox'], protocolTimeout: 8000 });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    window.chrome = { storage: { local: { get: (d, cb) => cb(Object.assign({}, d, { trackingMode: 'SINGLE_SNIP' })), set: (o, cb) => cb && cb() } },
                      runtime: { id: 'test', sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } } };
  });
  await page.setContent(html);
  await page.addScriptTag({ content: bundle });
  let line = `${tag.padEnd(6)} ${action.padEnd(6)}`;
  for (let i = 0; i < pairs.length; i++) {
    const pt = await page.evaluate((i) => {
      const n = document.getElementById('p' + i).firstChild; const k = n.nodeValue.indexOf('target' + i);
      const r = document.createRange(); r.setStart(n, k + 2); r.setEnd(n, k + 3); const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, i);
    const t0 = Date.now();
    try {
      await page.mouse.move(pt.x, pt.y);
      await page.keyboard.down('Control'); await page.keyboard.down('Shift');
      await page.mouse.click(pt.x, pt.y);
      await page.keyboard.up('Shift'); await page.keyboard.up('Control');
      await page.mouse.move(pt.x + 1, pt.y);
      if (action === 'x') { await page.mouse.wheel({ deltaY: -100 }); await page.keyboard.press('KeyX'); }
      if (action === 'space') await page.keyboard.press('Space');
      if (action === 'hover') { await page.keyboard.press('Space'); for (let k = 0; k < 6; k++) await page.mouse.move(pt.x + k * 3, pt.y); }
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
      await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 600));
      line += ` ${pairs[i][0]}:ok(${Date.now() - t0}ms)`;
    } catch (e) { line += ` ${pairs[i][0]}:HANG`; break; }
  }
  console.log(line);
  await browser.close().catch(() => {});
}
process.exit(0);
