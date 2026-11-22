// Copy Cat: saved form groups store. Loaded by background.js (importScripts), the only writer.

const GROUPS_KEY = 'formGroups';
const GROUPS_MAX = 100;

function groupsAdd(list, group) {
  const g = Object.assign({}, group, { id: group.id || historyNewId(), time: Date.now() });
  return [g].concat(list.filter(x => x.id !== g.id)).slice(0, GROUPS_MAX);
}

function groupsRename(list, id, name) {
  return list.map(g => (g.id === id ? Object.assign({}, g, { name: String(name).slice(0, 120) }) : g));
}

// What identifies a saved field for removal (its label/name + value)
function groupFieldFingerprint(f) {
  return [f.label || f.name || f.autocomplete || f.type, f.value, f.text || '', f.checked ? '1' : '0'].join('\u0001');
}

// Remove one field from a group. Uses the index, but only if that field still matches the
// fingerprint (the list may have changed since the panel was drawn); else the first match.
function groupsRemoveField(list, id, index, fingerprint) {
  return list.map(g => {
    if (g.id !== id) return g;
    let i = g.fields[index] && groupFieldFingerprint(g.fields[index]) === fingerprint ? index
      : g.fields.findIndex(f => groupFieldFingerprint(f) === fingerprint);
    if (i < 0) return g;
    return Object.assign({}, g, { fields: g.fields.filter((_, k) => k !== i) });
  });
}

function groupsDelete(list, id) {
  return list.filter(g => g.id !== id);
}

let groupsQueue = Promise.resolve();

function groupsMutate(fn) {
  const run = groupsQueue.then(async () => {
    const got = await chrome.storage.local.get({ [GROUPS_KEY]: [] });
    const next = fn(got[GROUPS_KEY] || []);
    await chrome.storage.local.set({ [GROUPS_KEY]: next });
    return next;
  });
  groupsQueue = run.catch(() => {});
  return run;
}
