// Copy Cat content script: Lifecycle: settings load/save, start/exit selection mode, Ctrl+Shift+click activation.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

  // --- LIFECYCLE ---
  // Load persisted settings from chrome.storage.local, normalizing legacy tracking mode values
  function loadSettings(cb) {
    try {
      chrome.storage.local.get(settings, (res) => {
        if (res) Object.assign(settings, res);
        // Normalize legacy trackingMode values from older popup versions
        if (settings.trackingMode === 'Multi-snip') settings.trackingMode = 'MULTI_SNIP';
        if (settings.trackingMode === 'Single-snip') settings.trackingMode = 'SINGLE_SNIP';
        if (cb) cb();
      });
    } catch (e) { if (cb) cb(); }
  }

  // Persist current settings to chrome.storage.local and notify the popup
  function saveSettings() {
    try {
      chrome.storage.local.set(settings);
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', data: settings }).catch(() => {});
    } catch (e) {}
  }

  const captureEvents = ['mousedown', 'mouseup', 'click', 'contextmenu', 'mousemove', 'keydown', 'wheel'];
  
  // Activate selection mode: inject shadow DOM, register capture listeners, evaluate initial position
  function startSelectionMode(x, y) {
    isSelectionMode = true;
    identifyMode = false;
	zoomMode = 'ELEMENT_ZOOM';
    failedZoomInAttempt = false;
    failedZoomOutAttempt = false;
    excludeDelimiters = false;
    savedUntrimmedRange = null;
    pendingInnerRange = null;
    frozenRanges = [];
    currentTargetElement = null;
    zoomHistory = [];
    bookendScanCache = null;
    zoomLocked = false;
    lastMouseX = x;           // so the first zoom targets the word under the mouse, not 0,0
    lastMouseY = y;
    initShadowDOM();

    captureEvents.forEach(evt => window.addEventListener(evt, handleGlobalCapture, { capture: true, passive: false }));
    loadSettings(() => evaluateMouseCoords(x, y));
  }

  // Deactivate selection mode: remove listeners, destroy shadow DOM, restore page state
  function exitSelectionMode() {
    isSelectionMode = false;
    identifyMode = false;
    if (rafPending) { cancelAnimationFrame(rafPending); rafPending = 0; }
    bookendScanCache = null;
    zoomLocked = false;
    captureEvents.forEach(evt => window.removeEventListener(evt, handleGlobalCapture, { capture: true, passive: false }));
    destroyShadowDOM();
  }

  window.addEventListener('mousedown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !isSelectionMode && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      startSelectionMode(e.clientX, e.clientY);
    }
  }, { capture: true });
