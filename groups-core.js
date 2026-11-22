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
