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
    RAW:          { icon: '🔵', label: 'Split + Raw' },
    QUOTED:       { icon: '🟦', label: 'Split + Quotes' },
    QUOTED_COMMA: { icon: '🟩', label: 'Split + Quotes + Commas' },
    CSV:          { icon: '📊', label: 'Split + CSV' },
    NUMBERED:     { icon: '#️⃣', label: 'Split + Numbers' },
    BULLETED:     { icon: '⏺️', label: 'Split + Bullets' }
  };
  const COMBINED_STATUS = { icon: '🔴', label: 'Combined + Quotes' };

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
         { icon: '🔵', label: `Split + ${settings.lineDecoration}` });
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
