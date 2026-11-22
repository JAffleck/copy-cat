// Copy Cat background service worker: single writer for the clipboard history, relays the
// Alt+Shift+V command and side-panel inserts to the right tab/frame.
importScripts('history-core.js', 'groups-core.js');

// Which frame of each tab last had a focused form field (for side-panel "Insert").
// Kept in session storage because the service worker can be stopped at any time.
async function setLastFieldFrame(tabId, frameId) {
  await chrome.storage.session.set({ ['fieldFrame:' + tabId]: frameId });
}
async function getLastFieldFrame(tabId) {
  const key = 'fieldFrame:' + tabId;
  const got = await chrome.storage.session.get(key);
  return got[key];
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// Send a side-panel action to the frame of the active tab that last had a focused field
async function routeToPage(out, tab) {
  tab = tab || await activeTab();
  if (!tab) return { ok: false, reason: 'No active tab' };
  const frameId = (await getLastFieldFrame(tab.id)) || 0;
  try {
    return await chrome.tabs.sendMessage(tab.id, out, { frameId });
  } catch (e) {
    // No live content script: the tab was open before the extension was (re)loaded. Inject the
    // content scripts now and retry in the top frame (they fall back to the page's focused field).
    try {
      const files = chrome.runtime.getManifest().content_scripts[0].js;
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files });
      return await chrome.tabs.sendMessage(tab.id, out, { frameId: 0 });
    } catch (e2) {
      return { ok: false, reason: 'Copy Cat can\'t run on this page (browser pages and the Web Store are off-limits)' };
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'HISTORY_RECORD':
        await historyMutate(list => historyAdd(list, msg.texts || [], { title: msg.title, url: msg.url }));
        return { ok: true };
      case 'HISTORY_PIN':
        await historyMutate(list => historySetPinned(list, msg.id, msg.pinned));
        return { ok: true };
      case 'HISTORY_DELETE':
        await historyMutate(list => historyDelete(list, msg.id));
        return { ok: true };
      case 'HISTORY_CLEAR':
        await historyMutate(historyClear);
        return { ok: true };
      case 'GROUP_SAVE':
        await groupsMutate(list => groupsAdd(list, msg.group));
        return { ok: true };
      case 'GROUP_RENAME':
        await groupsMutate(list => groupsRename(list, msg.id, msg.name));
        return { ok: true };
      case 'GROUP_DELETE':
        await groupsMutate(list => groupsDelete(list, msg.id));
        return { ok: true };
      case 'FIELD_FOCUS':
        if (sender.tab) await setLastFieldFrame(sender.tab.id, sender.frameId || 0);
        return { ok: true };
      case 'INSERT_ENTRY':
        return routeToPage({ type: 'INSERT_TEXT', text: msg.text });
      case 'FILL_GROUP_ENTRY':
        return routeToPage({ type: 'FILL_GROUP', id: msg.id });
      default:
        return undefined;
    }
  })().then(sendResponse, err => sendResponse({ ok: false, reason: String(err) }));
  return true;   // async response
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-history-picker') return;
  const tab = await activeTab();
  if (!tab) return;
  // Every frame gets it; only the frame that has focus opens the picker
  chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PICKER' }).catch(() => {});
});
