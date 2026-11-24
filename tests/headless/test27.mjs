// Plan 27: element-level copies keep line breaks between blocks / list items; inline spans stay joined;
// script/style code is never copied
import { puppeteer, OUT } from './pptr.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
let pass = 0, fail = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage();
page.on('pageerror', e => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  window.chrome = { storage: { local: { get: (d, cb) => { const r = Object.assign({}, typeof d === 'object' && d ? d : {}); if (cb) { cb(r); return; } return Promise.resolve(r); },
    set: (o, cb) => { if (cb) cb(); return Promise.resolve(); } }, onChanged: { addListener() {} } },
    runtime: { id: 'test', sendMessage: () => Promise.resolve({ ok: true }), onMessage: { addListener() {} } } };
});
await page.goto('about:blank');
await page.setContent(`<!doctype html><body style="font:16px sans-serif">
  <div id="google" style="position:relative;height:60px"><div class="gbqfba" role="presentation" style="overflow:hidden;height:34px;position:absolute;left:10px;top:10px;width:109px"><div style="left:0;position:absolute;right:0;white-space:nowrap;top:-102px"><div role="presentation" style="line-height:34px"><span>I'm Feeling Curious</span></div><div role="presentation" style="line-height:34px"><span>I'm Feeling Hungry</span></div><div role="presentation" style="line-height:34px"><span>I'm Feeling Trendy</span></div></div></div></div>
  <ul id="ul"><li>One</li><li>Two</li></ul>
  <div id="divs"><div>A</div><div>B</div></div>
  <p id="br">Line one<br>Line two</p>
  <p id="inline">Some <span style="color:red">red</span> text and <b>bold</b>.</p>
  <div id="spans"><span>one</span><span>two</span> <span>three</span></div>
  <div id="mixed">Before <span>styled</span> after<div>Own block</div></div>
  <div id="code"><style>.I5vV9{text-align:center}</style><script>(function(){var apx=false})()</script></div>
  <div id="code2"><style>.x{color:red}</style>Visible text<script>var y=1</script></div>
  <div id="sel"><div>Name: Ann</div><div>Color: <select><option>Red</option><option selected>Green</option></select></div><div>Done</div></div>
  <div id="gbtns" class="FPdoLc">   <center> <input value="Google Search" aria-label="Google Search" name="btnK" role="button" type="submit">   <input id="gbqfbb" value="I'm Feeling Lucky" aria-label="I'm Feeling Lucky" name="btnI" role="button" type="submit"><div role="presentation" style="display: none; position: absolute"><div><div role="presentation"><span>I'm Feeling Curious</span></div><div role="presentation"><span>I'm Feeling Hungry</span></div></div></div>  </center>  </div>
  <div id="defaults"><input type="button"> <input type="reset"> <input type="submit"></div>
  <div id="field">Name: <input value="Ann"> (first)</div>
  <div id="pw">User <input value="bob"> pass <input type="password" value="hunter2"> <input autocomplete="one-time-code" value="123456"></div>
  <div id="empty">Search: <input placeholder="type here"></div>
  <div id="img"><input type="image" alt="Go" src="data:,"><input type="hidden" value="secret-token"><input type="checkbox" checked value="on"></div>
  <div id="ta">Note:<textarea>Hello there</textarea></div>
  <div id="hiddenbtn"><span>Visible</span><input type="submit" value="Hidden" style="display:none"></div>
  <style>.gb_ea { display: inline-block } .inl > div { display: inline } .iflex > div { display: inline-flex }</style>
  <div id="gmail" class="gb_R"><div class="gb_ea"><a aria-label="Gmail " href="#">Gmail</a></div><div class="gb_ea"><a aria-label="Search for Images " href="#">Images</a></div></div>
  <div id="inl" class="inl"><div>Alpha</div><div>Beta</div></div>
  <div id="iflex" class="iflex"><div>Gamma</div><div>Delta</div></div>
  <p id="badge">Some <span style="display:inline-block">badge</span> text</p>
  <div id="inlsel" class="inl"><div>Size</div><div><select><option>S</option><option selected>M</option></select></div></div>
  <ul id="abc"><li>First</li><li>Second</li><li>Third</li></ul>
</body>`);
const m = JSON.parse(readFileSync(ROOT + '/manifest.json', 'utf8'));
for (const f of m.content_scripts[0].js) await page.addScriptTag({ content: readFileSync(ROOT + '/' + f, 'utf8') });

const text = (sel) => page.evaluate((sel) => getCleanText(document.querySelector(sel)), sel);
const cases = [
  ['Google hover box: one line per div item', '.gbqfba', "I'm Feeling Curious\nI'm Feeling Hungry\nI'm Feeling Trendy"],
  ['<ul> of <li> → lines', '#ul', 'One\nTwo'],
  ['nested divs → lines', '#divs', 'A\nB'],
  ['<br> → two lines', '#br', 'Line one\nLine two'],
  ['inline spans next to text stay one line, spaces kept', '#inline', 'Some red text and bold.'],
  ['spans next to spans in one parent stay joined (as rendered)', '#spans', 'onetwo three'],
  ['text + span joined; a child div is its own line', '#mixed', 'Before styled after\nOwn block'],
  ['only <style>/<script> inside → no code copied', '#code', ''],
  ['<style>/<script> next to text → only the text', '#code2', 'Visible text'],
  ['<select> inside: chosen option, blocks still on separate lines', '#sel', 'Name: Ann\nColor: Green\nDone'],
  ['Google buttons: each submit value its own line; hidden hover box skipped', '#gbtns', "Google Search\nI'm Feeling Lucky"],
  ['button with no value → nothing; reset/submit → browser default text', '#defaults', 'Reset\nSubmit'],
  ['text field value inline with the text around it', '#field', 'Name: Ann (first)'],
  ['password / one-time-code values never copied', '#pw', 'User bob pass'],
  ['empty field adds nothing (placeholder not copied)', '#empty', 'Search:'],
  ['image input → alt; hidden input and checkbox → nothing', '#img', 'Go'],
  ['textarea value inline', '#ta', 'Note:Hello there'],
  ['a display:none submit input is not copied', '#hiddenbtn', 'Visible'],
  ['plan 33: side-by-side inline-block divs (Gmail / Images) → separate lines', '#gmail', 'Gmail\nImages'],
  ['plan 33: display:inline divs → separate lines', '#inl', 'Alpha\nBeta'],
  ['plan 33: inline-flex divs → separate lines', '#iflex', 'Gamma\nDelta'],
  ['plan 33: inline-block span inside a sentence stays inline', '#badge', 'Some badge text'],
  ['plan 33: inline divs + a <select> → both rules apply', '#inlsel', 'Size\nM'],
];
for (const [name, sel, want] of cases) {
  const got = await text(sel);
  check(name, got === want, got);
}
const kids = await page.evaluate(() => document.body.children.length);
await text('#sel'); await text('#gbtns');
const kidsAfter = await page.evaluate(() => document.body.children.length);
check('no leftover clone in the page after reading controls', kids === kidsAfter, [kids, kidsAfter]);

// Split styles apply per item: Bullets on the Google box
const bullets = await page.evaluate(() => {
  settings.outputFormat = 'SPLIT'; settings.lineDecoration = 'BULLETED'; settings.bulletIndex = 0;
  frozenRanges.length = 0; currentTargetElement = document.querySelector('.gbqfba');
  return compileOutput();
});
check('Bullets: each Google item bulleted on its own line', bullets === "• I'm Feeling Curious\n• I'm Feeling Hungry\n• I'm Feeling Trendy", bullets);

// Plan 30: preview shows "[div No text]" for a selection with no text, "..." with nothing selected
// the shadow root is closed: reopen it as open so the test can read the preview
await page.evaluate(() => { destroyShadowDOM(); const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (o) { return orig.call(this, Object.assign({}, o, { mode: 'open' })); }; });
const pre = (sel) => page.evaluate((sel) => {
  initShadowDOM(); frozenRanges.length = 0; currentTargetElement = sel ? document.querySelector(sel) : null; updateUI();
  const p = document.getElementById('copy-cat-host').shadowRoot.querySelector('#preview-toast pre');
  return { text: p.textContent.trim(), muted: !!p.querySelector('.no-text') };
}, sel);
let got = await pre('#code');
check('no-text element → "[div No text]" (muted)', got.text === '[div No text]' && got.muted, got);
got = await pre('#ul');
check('element with text → its text (Bullets still set), no placeholder', got.text === '• One\n• Two' && !got.muted, got);
got = await pre(null);
check('nothing selected → "..."', got.text === '...' && !got.muted, got);

// Plan 33: Bullets on the Gmail / Images bar
const gmailBullets = await page.evaluate(() => {
  settings.outputFormat = 'SPLIT'; settings.lineDecoration = 'BULLETED'; settings.bulletIndex = 0;
  frozenRanges.length = 0; currentTargetElement = document.getElementById('gmail'); return compileOutput();
});
check('plan 33: Bullets → "• Gmail" / "• Images"', gmailBullets === '• Gmail\n• Images', gmailBullets);

// Plan 32: numbering markers count up for letters and roman numerals
const markers = await page.evaluate(() => {
  const m = (st, ns) => ns.map(n => outlineMarker(st, n)).join(' ');
  return { A: m('A.', [1, 26, 27, 28, 52, 53, 702, 703]), a: m('a.', [1, 2, 27]), one: m('1.', [1, 12]),
    i: m('i.', [1, 2, 3, 4, 9, 14, 40, 90, 400, 900, 1994, 3999, 4000]) };
});
check('A.: A Z AA AB AZ BA ZZ AAA', markers.A === 'A. Z. AA. AB. AZ. BA. ZZ. AAA.', markers.A);
check('a.: a b aa', markers.a === 'a. b. aa.', markers.a);
check('1.: unchanged', markers.one === '1. 12.', markers.one);
check('i.: roman numerals to 3999, then the number', markers.i === 'i. ii. iii. iv. ix. xiv. xl. xc. cd. cm. mcmxciv. mmmcmxcix. 4000.', markers.i);
const numbered = await page.evaluate(() => {
  settings.outputFormat = 'SPLIT'; settings.lineDecoration = 'NUMBERED';
  frozenRanges.length = 0; currentTargetElement = document.getElementById('abc');
  const out = {};
  for (const [i, k] of [[2, 'A'], [3, 'a'], [1, 'i']]) { settings.outlineIndex = i; out[k] = compileOutput(); }
  return out;
});
check('Numbers A. over a 3-item list → A. B. C.', numbered.A === 'A. First\nB. Second\nC. Third', numbered.A);
check('Numbers a. → a. b. c.', numbered.a === 'a. First\nb. Second\nc. Third', numbered.a);
check('Numbers i. → i. ii. iii.', numbered.i === 'i. First\nii. Second\niii. Third', numbered.i);
await page.evaluate(() => { settings.lineDecoration = 'BULLETED'; settings.bulletIndex = 0; });

check('no page errors', errors.length === 0, errors);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
