document.addEventListener('DOMContentLoaded', () => {
  const modeDisplay = document.getElementById('mode-display');
  const toggleCheckbox = document.getElementById('trackingModeToggle');

  // Must match the defaults and value names used by content/state.js
  const DEFAULTS = {
    trackingMode: 'SINGLE_SNIP',
    outputFormat: 'SPLIT',
    lineDecoration: 'RAW'
  };

  // Icon + label per line decoration (Split mode); keys are content/state.js values. Matches the legend.
  const DECORATION_STATUS = {
    RAW:          { icon: '🔵', label: 'Raw · split' },
    QUOTED:       { icon: '🟦', label: 'Quotes · split' },
    QUOTED_COMMA: { icon: '🟩', label: 'Quotes + commas · split' },
    CSV:          { icon: '📊', label: 'CSV · split' },
    NUMBERED:     { icon: '#️⃣', label: 'Numbers · split' },
    BULLETED:     { icon: '⏺️', label: 'Bullets · split' }
  };
  const COMBINED_STATUS = { icon: '🔴', label: 'Combined' };

  // Fill in missing values and convert legacy names from older popup versions
  function normalize(settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    if (s.trackingMode === 'Multi-snip') s.trackingMode = 'MULTI_SNIP';
    if (s.trackingMode === 'Single-snip') s.trackingMode = 'SINGLE_SNIP';
    return s;
  }

  function renderStatus(rawSettings) {
    const settings = normalize(rawSettings);

    const status = settings.outputFormat === 'COMBINED'
      ? COMBINED_STATUS
      : (DECORATION_STATUS[settings.lineDecoration] ||
         { icon: '🔵', label: `${settings.lineDecoration} · split` });
    if (modeDisplay) {
      modeDisplay.innerText = `${status.icon} ${status.label}`;
    }

    // Sync the radio buttons and the Multi-snip switch
    const currentRadio = document.querySelector(`input[name="trackingMode"][value="${settings.trackingMode}"]`);
    if (currentRadio) currentRadio.checked = true;
    if (toggleCheckbox) {
      toggleCheckbox.checked = (settings.trackingMode === 'MULTI_SNIP');
    }
  }

  function refresh() {
    chrome.storage.local.get(DEFAULTS, renderStatus);
  }

  // 1. Initial render
  refresh();

  // Style icons (shared with the in-page preview)
  document.querySelectorAll('[data-style-icon]').forEach(el => {
    el.innerHTML = styleIconSvg(el.dataset.styleIcon, 0, 16);
  });
  const variants = document.getElementById('quote-variants');
  if (variants) {
    variants.innerHTML = QUOTE_PAIRS.map((pair, i) => `<span title="${pair.join(' ')}">${styleIconSvg('QUOTED', i, 16)}</span>`).join('');
  }

  // Highlight color: one color for every style (the in-page highlight), saved for the content scripts
  const HIGHLIGHT_COLORS = [['#FF0000', 'Red'], ['#00FF00', 'Green'], ['#0000FF', 'Blue'], ['#FFFF00', 'Yellow']];
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

  // 2. Save when a radio button is clicked
  document.querySelectorAll('input[name="trackingMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      chrome.storage.local.set({ trackingMode: e.target.value }, refresh);
    });
  });

  // 3. Save when the Multi-snip switch is used
  if (toggleCheckbox) {
    toggleCheckbox.addEventListener('change', (e) => {
      const mode = e.target.checked ? 'MULTI_SNIP' : 'SINGLE_SNIP';
      chrome.storage.local.set({ trackingMode: mode }, refresh);
    });
  }

  // 4. Live update when settings change via hotkeys while the popup is open
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'SETTINGS_UPDATED') {
      renderStatus(request.data);
    }
  });
});
