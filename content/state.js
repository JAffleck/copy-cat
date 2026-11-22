// Copy Cat content script: State, settings and constants shared by all content scripts.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

  // --- STATE MANAGEMENT ---
  let isSelectionMode = false;
  let identifyMode = false;        // N: show the selected element's names (alt, aria-label, label…)
  let currentTargetElement = null;
  let frozenRanges = [];
  let shadowHost = null;
  let shadowRoot = null;
  let zoomMode = 'ELEMENT_ZOOM'; // 'ELEMENT_ZOOM' | 'BOOKEND_ZOOM'
  let failedZoomInAttempt = false;
  let failedZoomOutAttempt = false;
  let excludeDelimiters = false;   // X toggles — auto-trim bookend chars after every snap
  let savedUntrimmedRange = null;   // Saved original Range for X toggle restore
  let pendingInnerRange = null;     // Inner range to trim back to after a zoom-out-to-container include
  
  // Track global mouse position for smart-zooming
  let lastMouseX = 0;
  let lastMouseY = 0;
  let rafPending = 0; // requestAnimationFrame id while a mousemove evaluation is queued
  let zoomLocked = false; // set after wheel/arrow zoom: hold the selection while the mouse stays in it

  // Bookend Zoom hover-scan limits and cache (see snapToNearestBookend)
  const MAX_BOOKEND_SCAN_CHARS = 5000;
  let bookendScanCache = null; // { container, textLength, fullText, map }

  // Zoom history traversal stack
  let zoomHistory = [];
  let cachedSplitDecoration = 'RAW';

  // Persisted state via chrome.storage.local
  let settings = {
    trackingMode: 'SINGLE_SNIP',
    outputFormat: 'SPLIT',
    lineDecoration: 'RAW',
    quoteIndex: 0,
    bulletIndex: 0,
    outlineIndex: 0
  };

  // Constants
  const DECORATIONS = ['RAW', 'QUOTED', 'QUOTED_COMMA', 'CSV', 'NUMBERED', 'BULLETED'];
  const STYLE_QUOTES = ['"', "'", "`"];
  const STYLE_BULLETS = ['•', '-', '*'];
  const STYLE_OUTLINES = ['1.', 'i.', 'A.', 'a.'];
  const TAG_PRIORITY = ['A', 'SPAN', 'I', 'B', 'U', 'STRONG', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'P', 'LI', 'TD', 'TH', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
