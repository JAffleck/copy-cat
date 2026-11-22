// Unit tests for history-core.js (run: node tests/history-core.test.mjs)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const store = {};
const chrome = { storage: { local: {
  get: async (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k in store ? structuredClone(store[k]) : v])),
  set: async (o) => { await new Promise(r => setTimeout(r, Math.random() * 5)); Object.assign(store, structuredClone(o)); }
} } };
const ctx = vm.createContext({ chrome, Date, Math, Promise, setTimeout, structuredClone });
vm.runInContext(readFileSync(new URL('../history-core.js', import.meta.url), 'utf8'), ctx);
const { historyAdd, historySetPinned, historyDelete, historyClear, historySorted, historyMutate } = ctx;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS ', name); };

t('adds newest first; last text ends on top', () => {
  const l = historyAdd([], ['a', 'b', 'combined'], { title: 'T', url: 'U' });
  assert.deepEqual(l.map(e => e.text), ['combined', 'b', 'a']);
  assert.equal(l[0].title, 'T');
});
t('re-adding moves to top, keeps id and pin', () => {
  let l = historyAdd([], ['a', 'b']);
  l = historySetPinned(l, l.find(e => e.text === 'a').id, true);
  const id = l.find(e => e.text === 'a').id;
  l = historyAdd(l, ['a']);
  assert.equal(l[0].text, 'a'); assert.equal(l[0].id, id); assert.equal(l[0].pinned, true); assert.equal(l.length, 2);
});
t('ignores empty/whitespace/non-strings', () => {
  assert.equal(historyAdd([], ['', '  ', null, 5]).length, 0);
});
t('keeps 50 unpinned, pinned never dropped', () => {
  let l = historyAdd([], ['keep']);
  l = historySetPinned(l, l[0].id, true);
  l = historyAdd(l, Array.from({ length: 60 }, (_, i) => 'x' + i));
  assert.equal(l.filter(e => !e.pinned).length, 50);
  assert.ok(l.some(e => e.text === 'keep' && e.pinned));
  assert.equal(l[0].text, 'x59');
});
t('caps very long text', () => {
  assert.equal(historyAdd([], ['y'.repeat(200000)])[0].text.length, 100000);
});
t('delete, clear keeps pinned, sorted pins first', () => {
  let l = historyAdd([], ['a', 'b', 'c']);
  l = historySetPinned(l, l.find(e => e.text === 'a').id, true);
  assert.deepEqual(historySorted(l).map(e => e.text), ['a', 'c', 'b']);
  assert.deepEqual(historyDelete(l, l.find(e => e.text === 'b').id).map(e => e.text), ['c', 'a']);
  assert.deepEqual(historyClear(l).map(e => e.text), ['a']);
});
// serialized writes: 20 concurrent records must all land
await Promise.all(Array.from({ length: 20 }, (_, i) => historyMutate(l => historyAdd(l, ['m' + i]))));
assert.equal(store.clipHistory.length, 20); n++; console.log('PASS  20 concurrent records all kept (serialized)');
console.log(`\n${n} passed`);
