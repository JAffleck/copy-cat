// Unit tests for groups-core.js field removal (run: node tests/groups-core.test.mjs)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx = vm.createContext({ Date, Math, Promise, chrome: {} });
vm.runInContext(readFileSync(new URL('../history-core.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(readFileSync(new URL('../groups-core.js', import.meta.url), 'utf8'), ctx);
const { groupsRemoveField, groupFieldFingerprint } = ctx;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS ', name); };
const f = (label, value) => ({ tag: 'INPUT', type: 'text', label, value });
const groups = () => [{ id: 'g', fields: [f('Street', '123'), f('City', '7'), f('Zip', '8')] }, { id: 'h', fields: [f('Street', '123')] }];

t('removes the field at the index when it still matches', () => {
  const out = groupsRemoveField(groups(), 'g', 1, groupFieldFingerprint(f('City', '7')));
  assert.deepEqual(out[0].fields.map(x => x.label), ['Street', 'Zip']);
  assert.equal(out[1].fields.length, 1);          // other group untouched
});
t('index out of date (list changed): removes the matching field instead', () => {
  const out = groupsRemoveField(groups(), 'g', 0, groupFieldFingerprint(f('Zip', '8')));
  assert.deepEqual(out[0].fields.map(x => x.label), ['Street', 'City']);
});
t('no match: nothing removed (e.g. double click after it was already removed)', () => {
  const once = groupsRemoveField(groups(), 'g', 1, groupFieldFingerprint(f('City', '7')));
  const twice = groupsRemoveField(once, 'g', 1, groupFieldFingerprint(f('City', '7')));
  assert.deepEqual(twice[0].fields.map(x => x.label), ['Street', 'Zip']);
});
t('removing the last field keeps the (empty) group', () => {
  const out = groupsRemoveField(groups(), 'h', 0, groupFieldFingerprint(f('Street', '123')));
  assert.equal(out.length, 2); assert.equal(out[1].fields.length, 0);
});
console.log(`\n${n} passed`);
