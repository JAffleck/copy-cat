// Copy Cat side panel: full clipboard history beside the page (Copy / Insert / Pin / Delete).
// Reads chrome.storage.local directly; changes go through the background worker (single writer).
document.addEventListener('DOMContentLoaded', () => {
  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const searchEl = document.getElementById('search');
  const statusEl = document.getElementById('status');
  let entries = [];
  let statusTimer = 0;

  // Extra sections (plan 8: saved form groups) register renderers here
  window.copyCatPanelSections = window.copyCatPanelSections || [];

  function status(msg) {
    statusEl.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }

  function age(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function send(msg) {
    return chrome.runtime.sendMessage(msg).catch(err => ({ ok: false, reason: String(err) }));
  }

  function button(label, title, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    const f = searchEl.value.trim().toLowerCase();
    const sorted = entries.filter(e => e.pinned).concat(entries.filter(e => !e.pinned));
    const shown = sorted.filter(e => !f || e.text.toLowerCase().includes(f));
    listEl.textContent = '';
    for (const e of shown) {
      const li = document.createElement('li');
      if (e.pinned) li.className = 'pinned';
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = e.text;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${e.pinned ? '★ ' : ''}${age(e.time)}${e.title ? ' · ' + e.title : ''}`;
      meta.title = e.url || '';
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.className = 'actions row-tools';     // shown while the entry is hovered
      actions.append(
        iconButton('copy', 'Copy to the clipboard', async () => {
          try { await navigator.clipboard.writeText(e.text); status('Copied'); }
          catch (err) { status('Clipboard error'); }
        }),
        iconButton('paste', 'Insert: paste into the field you last clicked in the current tab', async () => {
          const res = await send({ type: 'INSERT_ENTRY', text: e.text });
          status(res && res.ok ? 'Pasted into the page' : (res && res.reason) || 'Could not paste');
        }),
        iconButton(e.pinned ? 'pinFilled' : 'pin', e.pinned ? 'Unpin (let it expire normally)' : 'Pin (keep it at the top, never expires)',
          () => send({ type: 'HISTORY_PIN', id: e.id, pinned: !e.pinned }), e.pinned ? 'pinned' : ''),
        iconButton('delete', 'Delete this entry', () => send({ type: 'HISTORY_DELETE', id: e.id }), 'danger')
      );
      li.append(text, meta, actions);
      listEl.appendChild(li);
    }
    emptyEl.hidden = shown.length > 0;
    if (!shown.length && f) emptyEl.textContent = 'No matches.';
    else emptyEl.textContent = 'Nothing copied yet. Copy something with Ctrl+Shift+click.';
  }

  function load() {
    chrome.storage.local.get({ clipHistory: [] }, r => {
      entries = r.clipHistory || [];
      render();
    });
    for (const sec of window.copyCatPanelSections) sec.load();
  }

  document.getElementById('clear').addEventListener('click', () => {
    send({ type: 'HISTORY_CLEAR' }).then(() => status('Cleared (pinned kept)'));
  });
  searchEl.addEventListener('input', render);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') load();
  });
  setInterval(render, 30000);   // refresh "x ago"
  load();

  // Close button + Ctrl+Shift+H toggle: tell the background this window has the panel open; it asks
  // us to close when the shortcut is pressed again. Reconnect if the background restarts.
  document.getElementById('close-slot').appendChild(
    iconButton('close', 'Hide history (Ctrl+Shift+H)', () => window.close()));
  function connectPanel() {
    chrome.windows.getCurrent(w => {
      const port = chrome.runtime.connect({ name: 'sidepanel' });
      port.postMessage({ type: 'PANEL_HELLO', windowId: w.id });
      port.onMessage.addListener(m => { if (m && m.type === 'CLOSE_PANEL') window.close(); });
      port.onDisconnect.addListener(() => setTimeout(connectPanel, 1000));
    });
  }
  connectPanel();
});
