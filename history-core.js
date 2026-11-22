// Copy Cat: clipboard history store. Loaded by background.js (importScripts), which is the only
// writer, so updates from many tabs are applied one at a time. Pure list logic is separate from
// storage so it can be tested on its own.

const HISTORY_KEY = 'clipHistory';
const HISTORY_MAX_UNPINNED = 50;
const HISTORY_MAX_TEXT = 100000;   // characters kept per entry

// --- pure list operations (newest first) ---

function historyNewId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Add texts in order (the last one ends up on top). Re-adding an existing text moves it to the top
// and keeps its pin. Unpinned entries beyond the limit are dropped (pinned ones never are).
function historyAdd(list, texts, meta = {}) {
  let out = list.slice();
  const now = Date.now();
  for (let text of texts) {
    if (typeof text !== 'string') continue;
    text = text.length > HISTORY_MAX_TEXT ? text.slice(0, HISTORY_MAX_TEXT) : text;
    if (!text.trim()) continue;
    const existing = out.find(e => e.text === text);
    out = out.filter(e => e.text !== text);
    out.unshift({
      id: existing ? existing.id : historyNewId(),
      text,
      time: now,
      title: meta.title || '',
      url: meta.url || '',
      pinned: existing ? !!existing.pinned : false
    });
  }
  let unpinned = 0;
  return out.filter(e => e.pinned || ++unpinned <= HISTORY_MAX_UNPINNED);
}

function historySetPinned(list, id, pinned) {
  return list.map(e => (e.id === id ? Object.assign({}, e, { pinned: !!pinned }) : e));
}

function historyDelete(list, id) {
  return list.filter(e => e.id !== id);
}

// Clear keeps pinned entries
function historyClear(list) {
  return list.filter(e => e.pinned);
}

// Display order: pinned first, then newest
function historySorted(list) {
  return list.filter(e => e.pinned).concat(list.filter(e => !e.pinned));
}

// --- storage (serialized) ---

let historyQueue = Promise.resolve();

function historyMutate(fn) {
  const run = historyQueue.then(async () => {
    const got = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
    const next = fn(got[HISTORY_KEY] || []);
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
    return next;
  });
  historyQueue = run.catch(() => {});
  return run;
}
