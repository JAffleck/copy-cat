document.addEventListener('DOMContentLoaded', () => {
  const modeDisplay = document.getElementById('mode-display');
  const toggleCheckbox = document.getElementById('trackingModeToggle');

  function renderStatus(settings) {
    let icon = '🔵';
    if (settings.outputFormat === 'Combined') {
      icon = '🔴';
    } else {
      switch (settings.lineDecoration) {
        case 'Raw': icon = '🔵'; break;
        case 'Quotes': icon = '🟦'; break;
        case 'Quotes + Comma': icon = '🟩'; break;
        case 'CSV (Comma-Separated-Values': icon = '📊'; break;
        case 'Numbers': icon = '#️⃣'; break;
        case 'Bullets': icon = '⏺️'; break;
      }
    }
    
    // Update the text status display using the new Title Case names
    const decorationText = settings.outputFormat === 'Combined' ? 'Quotes' : settings.lineDecoration;
    if (modeDisplay) {
      modeDisplay.innerText = `${icon} ${settings.outputFormat} + ${decorationText}`;
    }

    // Dynamically sync the radio buttons
    if (settings.trackingMode) {
      const currentRadio = document.querySelector(`input[name="trackingMode"][value="${settings.trackingMode}"]`);
      if (currentRadio) currentRadio.checked = true;
      
      // Keep the checkbox switch in sync with the radio buttons
      if (toggleCheckbox) {
        toggleCheckbox.checked = (settings.trackingMode === 'Multi-snip');
      }
    }
  }

  // 1. Load initial storage preferences using the updated default values
  chrome.storage.local.get({ 
    trackingMode: 'Multi-snip',
    outputFormat: 'Split',
    lineDecoration: 'Raw'
  }, (items) => {
    renderStatus(items);
  });
  
  // 2. Save preference states when a radio button is clicked
  document.querySelectorAll('input[name="trackingMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      chrome.storage.local.set({ trackingMode: e.target.value }, () => {
        // Refresh UI state locally after setting
        chrome.storage.local.get(null, renderStatus);
      });
    });
  });

  // 3. Save preference state when the checkbox toggle is used
  if (toggleCheckbox) {
    toggleCheckbox.addEventListener('change', (e) => {
      const mode = e.target.checked ? 'Multi-snip' : 'Single-snip';
      chrome.storage.local.set({ trackingMode: mode }, () => {
        chrome.storage.local.get(null, renderStatus);
      });
    });
  }

  // 4. Auto-update if user changes state via hotkeys while popup is open
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'SETTINGS_UPDATED') {
      renderStatus(request.data);
    }
  });
});