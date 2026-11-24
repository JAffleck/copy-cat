// Copy Cat content script: clipboard history picker. Alt+click a field → pick an entry → it's pasted
// into the field; Alt+click elsewhere → pick → copied to the clipboard. Alt+Shift+V (background
// command) opens it for the focused field. Works without Ctrl+Shift+click selection mode.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

  let pickerHost = null;
  let pickerRoot = null;
  let picker = null;          // { mode: 'insert'|'copy', field, x, y, entries, filter, index }
  let swallowClickUntil = 0;  // swallow the mouseup/click that follow our Alt+mousedown
  let lastFocusedField = null;
  const PICKER_ROWS = 8;

  // Extra picker sections (plan 8 adds saved form groups). Each: { title, load(cb), choose(item) }
  const pickerSections = [];

  function relativeAge(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  }

  // Ask the background worker (single writer) to add texts to the history
  function recordHistory(texts) {
    try {
      chrome.runtime.sendMessage({ type: 'HISTORY_RECORD', texts, title: document.title, url: location.href })
        .catch(() => {});
    } catch (e) { /* extension reloaded; page needs a refresh */ }
  }

  function loadHistory(cb) {
    try {
      chrome.storage.local.get({ clipHistory: [] }, r => {
        const list = (r && r.clipHistory) || [];
        cb(list.filter(e => e.pinned).concat(list.filter(e => !e.pinned)));
      });
    } catch (e) { cb([]); }
  }

  function ensurePickerHost() {
    if (pickerHost && pickerHost.isConnected) return;
    pickerHost = document.createElement('div');
    pickerHost.id = 'copy-cat-picker';
    pickerHost.style.cssText = 'position:fixed; inset:0; pointer-events:none; z-index:2147483647;';
    pickerRoot = pickerHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .panel { position: fixed; width: 340px; max-width: calc(100vw - 16px); background: #18181b; color: #e4e4e7;
        border: 1px solid #3f3f46; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,.5);
        font: 13px system-ui, sans-serif; pointer-events: auto; overflow: hidden; }
      .head { display: flex; justify-content: space-between; gap: 8px; padding: 6px 10px; font-size: 12px;
        border-bottom: 1px solid #3f3f46; color: #a1a1aa; }
      .filter { color: #fbbf24; }
      .sec { padding: 4px 10px 2px; font-size: 11px; color: #a1a1aa; text-transform: uppercase; letter-spacing: .04em; }
      .row { display: flex; gap: 8px; align-items: baseline; padding: 5px 10px; cursor: pointer; }
      .row.on { background: #27272a; }
      .num { color: #71717a; width: 12px; flex-shrink: 0; }
      .txt { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .meta { color: #71717a; font-size: 11px; flex-shrink: 0; max-width: 110px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pin { color: #fbbf24; }
      .empty { padding: 10px; color: #a1a1aa; }
      .foot { padding: 5px 10px; font-size: 11px; color: #60a5fa; border-top: 1px solid #3f3f46; }
      .foot.actions { display: flex; gap: 8px; justify-content: flex-end; padding: 8px 10px; }
      .btn { font: 12px system-ui, sans-serif; color: #e4e4e7; background: #27272a; border: 1px solid #3f3f46;
        border-radius: 5px; padding: 4px 10px; cursor: pointer; }
      .btn:hover { background: #3f3f46; }
      .btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
      .btn.primary:hover { background: #1d4ed8; }
      .toast { position: fixed; background: #18181b; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 6px;
        padding: 6px 12px; font: 13px system-ui, sans-serif; pointer-events: none; box-shadow: 0 6px 16px rgba(0,0,0,.4);
        display: flex; align-items: center; gap: 6px; }
      .toast .copy-cat-icon { flex-shrink: 0; color: #60a5fa; }
    `;
    pickerRoot.appendChild(style);
    (document.body || document.documentElement).appendChild(pickerHost);
  }

  // iconSvg (optional): trusted icon markup shown before the message; the message stays plain text
  function pickerToast(message, x, y, ms = 1400, iconSvg = '') {
    ensurePickerHost();
    const t = document.createElement('div');
    t.className = 'toast';
    if (iconSvg) {
      t.innerHTML = iconSvg;
      t.append(message);
    } else {
      t.textContent = message;
    }
    t.style.left = Math.max(8, Math.min(x, innerWidth - 260)) + 'px';
    t.style.top = Math.max(8, Math.min(y, innerHeight - 40)) + 'px';
    pickerRoot.querySelectorAll('.toast').forEach(n => n.remove());   // one at a time
    pickerRoot.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // Visible items: extra sections first (e.g. form groups), then history, filtered
  function pickerItems() {
    const f = picker.filter.toLowerCase();
    const match = s => !f || s.toLowerCase().includes(f);
    const items = [];
    for (const sec of picker.sections) {
      sec.items.filter(it => match(it.label)).forEach(it => items.push({ kind: 'section', sec, it }));
    }
    picker.entries.filter(e => match(e.text)).forEach(e => items.push({ kind: 'history', e }));
    return items;
  }

  function renderPicker() {
    if (!picker) return;
    ensurePickerHost();
    pickerRoot.querySelectorAll('.panel').forEach(n => n.remove());
    const panel = document.createElement('div');
    panel.className = 'panel';
    const items = pickerItems();
    picker.index = Math.max(0, Math.min(picker.index, items.length - 1));
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let html = `<div class="head"><span>📋 ${picker.mode === 'insert' ? 'Paste into field' : 'Copy to clipboard'}</span>` +
      `<span class="filter">${picker.filter ? '🔎 ' + esc(picker.filter) : ''}</span></div>`;
    const start = Math.max(0, Math.min(picker.index - PICKER_ROWS + 1, items.length - PICKER_ROWS));
    let lastSec = null;
    items.slice(start, start + PICKER_ROWS).forEach((item, k) => {
      const i = start + k;
      const secTitle = item.kind === 'section' ? item.sec.title : 'History';
      if (secTitle !== lastSec && (picker.sections.length || item.kind === 'section')) {
        html += `<div class="sec">${esc(secTitle)}</div>`;
      }
      lastSec = secTitle;
      const label = item.kind === 'section' ? item.it.label : item.e.text.replace(/\s+/g, ' ');
      const meta = item.kind === 'section' ? (item.it.meta || '') :
        `${item.e.pinned ? '<span class="pin">★</span> ' : ''}${esc(relativeAge(item.e.time))}`;
      html += `<div class="row${i === picker.index ? ' on' : ''}" data-i="${i}">` +
        `<span class="num">${i < 9 ? i + 1 : ''}</span><span class="txt" title="${esc(label)}">${esc(label)}</span>` +
        `<span class="meta">${item.kind === 'section' ? esc(meta) : meta}</span></div>`;
    });
    if (!items.length) html += `<div class="empty">${picker.filter ? 'No matches' : 'Nothing copied yet — copy something with Ctrl+Shift+click'}</div>`;
    html += `<div class="foot">↑↓ Enter · 1–9 · type to filter · Esc</div>`;
    panel.innerHTML = html;
    panel.addEventListener('mousedown', ev => {
      ev.preventDefault();          // keep focus in the field
      ev.stopPropagation();
      const row = ev.composedPath().find(n => n.classList && n.classList.contains('row'));
      if (row) choosePickerItem(Number(row.dataset.i));
    });
    pickerRoot.appendChild(panel);
    // position: under the field (insert) or at the mouse (copy), kept on screen
    const w = panel.offsetWidth, h = panel.offsetHeight;
    let x = picker.x, y = picker.y;
    if (picker.field) {
      const r = picker.field.getBoundingClientRect();
      x = r.left; y = r.bottom + 4;
      if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 4);
    }
    panel.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
  }

  function openPicker(mode, field, x, y) {
    closePicker();
    picker = { mode, field, x, y, entries: [], sections: [], filter: '', index: 0 };
    let pending = 1 + pickerSections.length;
    const done = () => { if (--pending === 0 && picker) renderPicker(); };
    loadHistory(list => { if (picker) picker.entries = list; done(); });
    for (const sec of pickerSections) {
      sec.load(mode, field, items => {
        if (picker && items && items.length) picker.sections.push({ title: sec.title, items, choose: sec.choose });
        done();
      });
    }
  }

  function closePicker() {
    picker = null;
    if (pickerRoot) pickerRoot.querySelectorAll('.panel').forEach(n => n.remove());
  }

  function choosePickerItem(i) {
    const p = picker;
    const item = pickerItems()[i];
    if (!item) return;
    closePicker();
    if (item.kind === 'section') { item.sec.choose(item.it, p); return; }
    deliverText(item.e.text, p);
  }

  // Paste into the field (insert mode) or copy to the clipboard (copy mode)
  function deliverText(text, p) {
    const at = p.field ? p.field.getBoundingClientRect() : { left: p.x, bottom: p.y };
    if (p.mode === 'insert' && p.field) {
      const res = insertIntoField(p.field, text);
      pickerToast(res.ok ? '✅ Pasted' : '❌ ' + res.reason, at.left, at.bottom + 4);
    } else {
      navigator.clipboard.writeText(text).then(
        () => pickerToast('Copied — paste with Ctrl+V', at.left, at.bottom + 4, 1400, copyCatIconSvg(16)),
        () => pickerToast('❌ Clipboard error', at.left, at.bottom + 4));
    }
  }

  // --- keyboard while the picker is open (the field keeps focus; we take the keys) ---
  window.addEventListener('keydown', (e) => {
    if (!picker) return;
    const k = e.key;
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.ctrlKey || e.metaKey || e.altKey) { if (k !== 'Alt' && k !== 'Shift') closePicker(); return; }
    const count = pickerItems().length;
    if (k === 'Escape') { take(); closePicker(); }
    else if (k === 'ArrowDown') { take(); picker.index = Math.min(picker.index + 1, count - 1); renderPicker(); }
    else if (k === 'ArrowUp') { take(); picker.index = Math.max(picker.index - 1, 0); renderPicker(); }
    else if (k === 'Enter') { take(); choosePickerItem(picker.index); }
    else if (/^[1-9]$/.test(k) && !picker.filter) { take(); choosePickerItem(Number(k) - 1); }
    else if (k === 'Backspace') { take(); picker.filter = picker.filter.slice(0, -1); picker.index = 0; renderPicker(); }
    else if (k.length === 1) { take(); picker.filter += k; picker.index = 0; renderPicker(); }
    else if (k === 'Tab') { closePicker(); }
  }, { capture: true });

  // --- Alt+click ---
  window.addEventListener('mousedown', (e) => {
    if (picker) {
      // click outside the panel closes it (and is otherwise left alone)
      if (!e.composedPath().includes(pickerHost)) closePicker();
    }
    if (e.button !== 0 || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
    if (!extensionAlive()) return;
    if (typeof isSelectionMode !== 'undefined' && isSelectionMode) return;
    const path = e.composedPath();
    const target = path[0];
    if (path.some(n => n.id === 'copy-cat-host' || n.id === 'copy-cat-picker')) return;
    const field = editableFrom(target);
    if (!field && target.closest && target.closest('a[href]')) return;   // keep Chrome's Alt+click download
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowClickUntil = Date.now() + 1000;
    if (field) {
      if (isSecretField(field)) { pickerToast('🔒 Not for password fields', e.clientX, e.clientY + 12); return; }
      focusAtEnd(field);
      openPicker('insert', field, e.clientX, e.clientY);
    } else {
      openPicker('copy', null, e.clientX, e.clientY + 12);
    }
  }, { capture: true });

  for (const type of ['mouseup', 'click']) {
    window.addEventListener(type, (e) => {
      if (Date.now() < swallowClickUntil && e.button === 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (type === 'click') swallowClickUntil = 0;
      }
    }, { capture: true });
  }

  // Alt+V / Alt+Shift+V in the page: open the picker for the focused field (works even when the
  // browser didn't assign the extension shortcut). Ctrl+Alt (AltGr) and selection mode are ignored.
  let lastPickerOpen = 0;
  function openPickerForFocus() {
    if (Date.now() - lastPickerOpen < 300) return;      // shortcut + in-page key both fired
    lastPickerOpen = Date.now();
    const field = editableFrom(document.activeElement);
    if (field && !isSecretField(field)) {
      const r = field.getBoundingClientRect();
      openPicker('insert', field, r.left, r.bottom);
    } else {
      openPicker('copy', null, innerWidth / 2 - 170, innerHeight / 3);
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV' || !e.altKey || e.ctrlKey || e.metaKey || picker || !extensionAlive()) return;
    if (typeof isSelectionMode !== 'undefined' && isSelectionMode) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openPickerForFocus();
  }, { capture: true });

  // Ctrl+Shift+H in the page: show/hide the history panel. The background ignores this when the
  // browser shortcut is assigned (that one fires too), so it only matters as a fallback.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyH' || !e.ctrlKey || !e.shiftKey || e.altKey || !extensionAlive()) return;
    try {
      chrome.runtime.sendMessage({ type: 'TOGGLE_PANEL' }).then(res => {
        if (res && res.ok === false && res.reason) {
          pickerToast('Open the history from the Copy Cat toolbar button (no browser shortcut set)', 24, 24, 3500);
        }
      }).catch(() => {});
    } catch (err) {}
  }, { capture: true });

  window.addEventListener('resize', closePicker);
  window.addEventListener('scroll', () => { if (picker && !picker.field) closePicker(); else if (picker) renderPicker(); }, { capture: true, passive: true });

  // --- remember the last focused field (side-panel "Insert" goes there) ---
  document.addEventListener('focusin', (e) => {
    const field = editableFrom(e.composedPath()[0]);
    if (!field || field === lastFocusedField || isSecretField(field)) return;
    lastFocusedField = field;
    try { chrome.runtime.sendMessage({ type: 'FIELD_FOCUS' }).catch(() => {}); } catch (err) {}
  }, true);

  // Field for side-panel Insert/Fill: the last focused one, else whatever has focus in the page
  // (e.g. the field was focused before these scripts were injected)
  function targetFieldForPanel() {
    if (lastFocusedField && lastFocusedField.isConnected) return lastFocusedField;
    const f = editableFrom(document.activeElement);
    return f && !isSecretField(f) ? f : null;
  }

  // --- messages from the background worker ---
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return;
      if (msg.type === 'OPEN_PICKER') {
        if (!document.hasFocus()) return;           // only the focused frame answers
        openPickerForFocus();
      } else if (msg.type === 'INSERT_TEXT') {
        const field = targetFieldForPanel();
        if (!field) { sendResponse({ ok: false, reason: 'Click into a field on the page first' }); return; }
        sendResponse(insertIntoField(field, msg.text));
      }
    });
  } catch (e) { /* not running as an extension (tests) */ }
