document.addEventListener('DOMContentLoaded', () => {
  // The popup is help + settings: highlight color, history button, shortcuts. The copy style and
  // Single/Multi-snip mode are shown in the in-page preview while selecting (Tab, Q, Shift+Space).

  // Style icons (shared with the in-page preview)
  document.querySelectorAll('[data-style-icon]').forEach(el => {
    el.innerHTML = styleIconSvg(el.dataset.styleIcon, 0, 16);
  });
  const variants = document.getElementById('quote-variants');
  if (variants) {
    variants.innerHTML = QUOTE_PAIRS.map((pair, i) => `<span title="${pair.join(' ')}">${styleIconSvg('QUOTED', i, 16)}</span>`).join('');
  }

  // Highlight color: one color for every style (the in-page highlight), saved for the content scripts
  // bug-reporter's recording palette (videoTelemetry.js COLORS) without black and white
  const HIGHLIGHT_COLORS = [['#FF0000', 'Red'], ['#00FF00', 'Green'], ['#0000FF', 'Blue'], ['#FFFF00', 'Yellow'],
    ['#00FFFF', 'Cyan'], ['#FF00FF', 'Magenta']];
  const swatchBox = document.getElementById('highlight-swatches');
  function renderSwatches(current) {
    if (!swatchBox) return;
    swatchBox.textContent = '';
    for (const [hex, name] of HIGHLIGHT_COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = hex;
      b.title = name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-checked', String(hex === current));
      b.addEventListener('click', () => chrome.storage.local.set({ highlightColor: hex }, () => renderSwatches(hex)));
      swatchBox.appendChild(b);
    }
  }
  chrome.storage.local.get({ highlightColor: '#0000FF' }, r => renderSwatches(String(r.highlightColor).toUpperCase()));

  // Show the browser-assigned panel shortcut (browsers skip a suggested key that clashes)
  if (chrome.commands) {
    chrome.commands.getAll(cmds => {
      const c = (cmds || []).find(x => x.name === 'toggle-history-panel');
      const key = c && c.shortcut;
      const btn = document.getElementById('open-history');
      if (btn) btn.title = key ? `${key} - Toggle copy history panel`
        : 'No shortcut set - Toggle copy history panel (set one in Extensions → Keyboard shortcuts)';
      const row = document.getElementById('panel-shortcut-2');
      if (row) row.textContent = key || 'not set';
      const note = document.getElementById('shortcut-note');
      if (note && !key) note.textContent = 'The browser did not assign Ctrl+Shift+H (it may clash). Set it under Extensions → Keyboard shortcuts.';
    });
  }

  // Open the history side panel. Chrome requires the call to happen directly in the click, so the
  // window id is looked up in advance.
  let windowId = null;
  chrome.windows.getCurrent(w => { windowId = w && w.id; });
  const historyBtn = document.getElementById('open-history');
  if (historyBtn) {
    historyBtn.addEventListener('click', () => {
      if (windowId == null) return;
      chrome.sidePanel.open({ windowId }).then(() => window.close()).catch(() => {});
    });
  }
});
