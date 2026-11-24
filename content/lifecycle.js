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
  // Settings the popup owns: the page never writes them (it would put back the value it loaded
  // when selection started, undoing a change made in the popup meanwhile)
  const POPUP_OWNED_SETTINGS = ['highlightColor'];

  function saveSettings() {
    try {
      const own = Object.assign({}, settings);
      POPUP_OWNED_SETTINGS.forEach(k => delete own[k]);
      chrome.storage.local.set(own);
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', data: own }).catch(() => {});
    } catch (e) {}
  }

  // A color picked in the popup while this page is selecting applies right away
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !extensionAlive()) return;
      let changed = false;
      for (const k of POPUP_OWNED_SETTINGS) {
        if (changes[k]) { settings[k] = changes[k].newValue; changed = true; }
      }
      if (changed && isSelectionMode) updateUI();
    });
  } catch (e) { /* not running as an extension (tests) */ }

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
    keyboardAnchor = null;
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
    keyboardAnchor = null;
    captureEvents.forEach(evt => window.removeEventListener(evt, handleGlobalCapture, { capture: true, passive: false }));
    destroyShadowDOM();
  }

  // Popup's start button (via the background, top frame only): start with no mouse position, so
  // nothing is highlighted until the mouse moves over the page
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== 'START_SELECTION') return;
      if (!isSelectionMode) startSelectionMode(-1, -1);
      sendResponse({ ok: true });
    });
  } catch (e) { /* not running as an extension (tests) */ }

  window.addEventListener('mousedown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !isSelectionMode && e.button === 0 && extensionAlive()) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      startSelectionMode(e.clientX, e.clientY);
    }
  }, { capture: true });
