(function () {
  // --- STATE MANAGEMENT ---
  let isSelectionMode = false;
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

  // --- DRILL-THROUGH HELPER ---
  // Get the deepest element at a point, preferring the parent of the text node at caret
  function getDeepElementFromPoint(x, y) {
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
        return range.startContainer.parentElement;
      }
    }
    return document.elementFromPoint(x, y);
  }

  // --- GRANULAR TEXT ZOOM HELPER ---
  // Zoom hierarchy (Element Zoom):
  //   Element → Text node → Bookend phrase (level 2) → Nested bookend → Word (level 1) → Segment (level 2)
  //   Zoom-out reverses via zoomHistory stack.
  //   level 0 = text node, level 1 = word, level 2+ = delimiter-enclosed phrase
  // --- GRANULAR TEXT ZOOM HELPERS ---
  // Zoom hierarchy: Bookend phrase → Word (including snake_case) → Segment (split on _/-)
  // Each zoom-in tries the next step in order; zoom-out pops zoomHistory.

  // Step 1: Find nearest enclosing paired delimiter within [boundStart, boundEnd)
  // Find the nearest enclosing pair of delimiters (quotes, brackets, etc.) around an offset within bounds
  function getBookendRange(textNode, offset, boundStart, boundEnd) {
    const text = textNode.nodeValue || "";
    const PAIRS = {
      '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{',
      '"': '"', "'": "'",
      '\u201C': '\u201D', '\u201D': '\u201C',
      '\u2018': '\u2019', '\u2019': '\u2018',
      '\u00AB': '\u00BB', '\u00BB': '\u00AB'
    };
    let start = boundStart, end = boundEnd, leftChar = '';
    for (let i = offset - 1; i >= boundStart; i--) {
      if (PAIRS[text[i]] !== undefined) { start = i + 1; leftChar = text[i]; break; }
    }
    if (!leftChar) return null;
    const matchChar = PAIRS[leftChar];
    let found = false;
    for (let i = offset; i < boundEnd; i++) {
      if (text[i] === matchChar) { end = i; found = true; break; }
    }
    if (!found) return null;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start >= end) return null;
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    range.textZoomLevel = 1;
    // Store open/close character positions for X-toggle rect calculation
    range._openNode = textNode;
    range._openOffset = start - 1;  // position of the opening delimiter
    range._closeNode = textNode;
    range._closeOffset = end;       // position of the closing delimiter
    return range;
  }

  // Step 2: Find word within [boundStart, boundEnd)
  // Find a word boundary around an offset within bounds (includes accented chars, hyphens)
  function getWordRange(textNode, offset, boundStart, boundEnd) {
    const text = textNode.nodeValue || "";
    const wordBoundaries = /[^\w\-\u00C0-\u017F]/;
    let start = offset, end = offset;
    while (start > boundStart && !wordBoundaries.test(text[start - 1])) start--;
    while (end < boundEnd && !wordBoundaries.test(text[end])) end++;
    const match = text.substring(start, end).replace(/^[-]+|[-]+$/g, '');
    if (!match) return null;
    const actualStart = start + text.substring(start, end).indexOf(match);
    const range = document.createRange();
    range.setStart(textNode, actualStart);
    range.setEnd(textNode, actualStart + match.length);
    range.textZoomLevel = 2;
    return range;
  }

  // Step 3: Split snake_case or kebab-case within [boundStart, boundEnd)
  // Split a snake_case or kebab-case identifier into a segment at cursor position
  function getSegmentRange(textNode, offset, boundStart, boundEnd) {
    const text = textNode.nodeValue || "";
    const splitters = ['_', '-'];
    let start = boundStart, end = boundEnd;
    let hasSplitter = false;
    for (let i = offset - 1; i >= boundStart; i--) {
      if (splitters.includes(text[i])) { start = i + 1; hasSplitter = true; break; }
    }
    for (let i = offset; i < boundEnd; i++) {
      if (splitters.includes(text[i])) { end = i; hasSplitter = true; break; }
    }
    if (!hasSplitter) return null;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start >= end) return null;
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    range.textZoomLevel = 3;
    return range;
  }

  // Try next zoom step: bookend → word → segment (first narrower contained result wins)
  // Try each zoom-in step (bookend → word → segment); return the first narrower match
  function getNextZoomRange(textNode, offset, currentRange) {
    const curLen = currentRange ? currentRange.toString().length : textNode.nodeValue.length;
    const bStart = currentRange ? currentRange.startOffset : 0;
    const bEnd = currentRange ? currentRange.endOffset : textNode.nodeValue.length;
    const steps = [getBookendRange, getWordRange, getSegmentRange];
    for (let fn of steps) {
      const newRange = fn(textNode, offset, bStart, bEnd);
      if (newRange && newRange.toString().length < curLen) {
        if (!currentRange || (newRange.compareBoundaryPoints(Range.START_TO_START, currentRange) >= 0 &&
            newRange.compareBoundaryPoints(Range.END_TO_END, currentRange) <= 0)) {
          return newRange;
        }
      }
    }
    return null;
  }
  // Bookend pairs for snap-to-nearest — structural, multi-element capable
  // Bookend Zoom hierarchy:
  //   Widest enclosing pair → Nested pair (snapToInnerBookend) → Word (zoom-in falls back to element zoom)
  //   Zoom-out via snapToOuterBookend walks ancestor chain for wider enclosing pairs.
  const BOOKEND_PAIRS = {
    '"': '"',
    '“': '”',   // “” smart double quotes
    '‘': '’',   // ‘’ smart single quotes
    '«': '»',   // «» French guillemets
    '`': '`',
    '(': ')',
    '[': ']',
    '{': '}',
    '⟨': '⟩'    // ⟨⟩ mathematical angle brackets
  };

  // Find the widest bookend pair enclosing the cursor, walking up ancestors for multi-element pairs
  function snapToNearestBookend() {
    // Identify the structural container — start from element under mouse cursor
    let container;
    if (shadowHost) shadowHost.style.visibility = 'hidden';
    const elUnderMouse = getDeepElementFromPoint(lastMouseX, lastMouseY);
    if (shadowHost) shadowHost.style.visibility = 'visible';
    if (elUnderMouse) {
      container = elUnderMouse.nodeType === Node.ELEMENT_NODE ? elUnderMouse : elUnderMouse.parentElement;
    } else if (currentTargetElement) {
      let node = currentTargetElement instanceof Range ? currentTargetElement.startContainer : currentTargetElement;
      container = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    } else {
      return null;
    }
    
    // Walk up to find an ancestor that contains bookend pairs (handles multi-element mw-editsection).
    // Stop at MAX_BOOKEND_SCAN_CHARS so a hover never maps most of a long page; pairs wider than
    // that are still reachable via snapToOuterBookend (zoom out).
    let searchContainer = container;
    let exceededCap = false;
    while (searchContainer && searchContainer !== document.body) {
      const text = searchContainer.textContent || '';
      if (text.length > MAX_BOOKEND_SCAN_CHARS) { exceededCap = true; break; }
      let hasPair = false;
      for (let char in BOOKEND_PAIRS) {
        const closeChar = BOOKEND_PAIRS[char];
        if (char === closeChar) {
          if (text.indexOf(char) !== text.lastIndexOf(char)) { hasPair = true; break; }
        } else {
          if (text.includes(char) && text.includes(closeChar)) { hasPair = true; break; }
        }
      }
      if (hasPair) break;
      searchContainer = searchContainer.parentElement;
    }
    if (exceededCap) return null; // no pair within the scan limit
    container = (searchContainer && searchContainer !== document.body) ? searchContainer : container;

    // 2. Map all text nodes to a flat array to handle multi-node selections.
    // Reuse the cached map while the container is unchanged (same element, still attached, same
    // text length — a cheap check that catches most React re-renders).
    let fullText;
    let map;
    const containerTextLength = (container.textContent || '').length;
    if (bookendScanCache && bookendScanCache.container === container &&
        container.isConnected && bookendScanCache.textLength === containerTextLength) {
      fullText = bookendScanCache.fullText;
      map = bookendScanCache.map;
    } else {
      fullText = "";
      map = [];
      const collect = (node) => {
          if (node.nodeType === Node.TEXT_NODE) {
              for (let i = 0; i < node.nodeValue.length; i++) {
                  map.push({ node: node, offset: i });
                  fullText += node.nodeValue[i];
              }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
              for (let child of node.childNodes) {
                  collect(child);
              }
          }
      };
      collect(container);
      bookendScanCache = { container, textLength: containerTextLength, fullText, map };
    }

    // 3. Find current cursor index in our flat map — prefer mouse position
    let cursorIdx = -1;

    // Try caretRangeFromPoint first (most accurate)
    if (document.caretRangeFromPoint) {
      const caret = document.caretRangeFromPoint(lastMouseX, lastMouseY);
      if (caret && caret.startContainer && caret.startContainer.nodeType === Node.TEXT_NODE) {
        for (let i = 0; i < map.length; i++) {
          if (map[i].node === caret.startContainer && map[i].offset === caret.startOffset) {
            cursorIdx = i;
            break;
          }
        }
      }
    }

    // Fallback: use the current element's position in the map
    if (cursorIdx === -1) {
      const targetNode =
        currentTargetElement instanceof Range
          ? currentTargetElement.startContainer
          : currentTargetElement;

      const targetOffset =
        currentTargetElement instanceof Range
          ? currentTargetElement.startOffset
          : 0;

      for (let i = 0; i < map.length; i++) {
        if (map[i].node === targetNode && map[i].offset === targetOffset) {
          cursorIdx = i;
          break;
        }
      }
    }

    // Last fallback if we couldn't map the cursor exactly
    if (cursorIdx === -1) {
      cursorIdx = Math.floor(fullText.length / 2);
    }

    // 4. Search for all enclosing pairs, pick the widest (tiebreaker: earliest open char)
    let bestRange = null;
    let bestOpenIdx = Infinity;

    for (let char in BOOKEND_PAIRS) {
      let open, close;
      const closeChar = BOOKEND_PAIRS[char];

      if (char === closeChar) {
        // Symmetric bookends (" and `)
        open = fullText.lastIndexOf(char, cursorIdx - 1);
        close = fullText.indexOf(char, cursorIdx + 1);
      } else {
        // Asymmetric pair: walk backward through open chars, find matching close with nesting,
        // until we find a pair whose close is at or after the cursor (actually encloses it)
        open = fullText.lastIndexOf(char, cursorIdx);
        close = -1;
        while (open !== -1) {
          let depth = 1;
          close = -1;
          for (let i = open + 1; i < fullText.length; i++) {
            if (fullText[i] === char) depth++;
            else if (fullText[i] === closeChar) depth--;
            if (depth === 0) { close = i; break; }
          }
          if (close !== -1 && close >= cursorIdx) break;
          open = fullText.lastIndexOf(char, open - 1);
          close = -1;
        }
      }

      if (open !== -1 && close !== -1 && open <= cursorIdx && close >= cursorIdx) {
        // Tiebreaker: pick the pair with the earliest (leftmost) open character
        if (open < bestOpenIdx) {
          bestOpenIdx = open;
          const start = map[open];
          const end = map[close];
          if (start && end) {
            const range = document.createRange();
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset + 1); // +1 to capture closing bookend
            range.textZoomLevel = 99;
            // Store open/close indices and container for zoom-in/out navigation
            range._bookendOpenIdx = open;
            range._bookendCloseIdx = close;
            range._bookendContainer = container;
            range._openNode = start.node;
            range._openOffset = start.offset;
            range._closeNode = end.node;
            range._closeOffset = end.offset;
            bestRange = range;
          }
        }
      }
    }

    return bestRange;
  }
  // Create a Range spanning all text nodes within an element (first char to last char)
  function elementToRange(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const first = walker.firstChild();
    walker.currentNode = el;
    const last = walker.lastChild();
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.nodeValue.length);
    return range;
  }

  // Find the enclosing bookend pair at cursor position — tries single-text-node first, then full map
  function findEnclosingPair() {
    // Try lightweight: search for bookend pair in the text node at cursor
    if (document.caretRangeFromPoint) {
      const caret = document.caretRangeFromPoint(lastMouseX, lastMouseY);
      if (caret && caret.startContainer && caret.startContainer.nodeType === Node.TEXT_NODE) {
        const range = getBookendRange(caret.startContainer, caret.startOffset, 0, caret.startContainer.nodeValue.length);
        if (range && range._openNode === caret.startContainer) {
          range.setStart(range._openNode, range._openOffset);
          range.setEnd(range._closeNode, range._closeOffset + 1);
          range.textZoomLevel = 99;
          range._bookendContainer = caret.startContainer.parentElement;
          range._bookendEl = caret.startContainer.parentElement;
          return range;
        }
      }
    }
    // Fall back to full snapToNearestBookend (handles multi-element pairs)
    return snapToNearestBookend();
  }

  // Given an enclosing-pair range for the INCLUDE state, return what to select:
  // - normally the range itself (renderable bookend chars, e.g. real quotes)
  // - if the opening bookend char has no layout box (e.g. a display:none bracket),
  //   the ancestor element whose text equals the pair (renders the visible bookends). In that
  //   case sets pendingInnerRange so the next exclude can trim back to the inner text.
  function includeBookendTarget(foundRange) {
    pendingInnerRange = null;
    let unrenderable = false;
    try {
      const r = document.createRange();
      r.setStart(foundRange._openNode, foundRange._openOffset);
      r.setEnd(foundRange._openNode, foundRange._openOffset + 1);
      unrenderable = r.getBoundingClientRect().width === 0;
    } catch (e) {}
    if (!unrenderable) return foundRange;
    const pairText = foundRange.toString().trim();
    let anc = foundRange._bookendContainer ||
      (foundRange._openNode && foundRange._openNode.parentElement);
    while (anc && anc !== document.body && (anc.textContent || '').trim() !== pairText) {
      anc = anc.parentElement;
    }
    if (anc && anc !== document.body && (anc.textContent || '').trim() === pairText) {
      pendingInnerRange = foundRange;
      return anc;
    }
    return foundRange;
  }

  // --- SHADOW DOM INITIALIZATION ---
  // Create the shadow DOM host, overlay container, and preview toast; inject into the page
  function initShadowDOM() {
    if (shadowHost) return;
    
    shadowHost = document.createElement('div');
    shadowHost.id = 'copy-cat-host';
    shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483647;';
    
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      #preview-toast { position: absolute; bottom: 24px; right: 24px; width: 340px; background: #18181b; color: #e4e4e7; padding: 16px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); font-family: system-ui, sans-serif; font-size: 13px; border: 1px solid #3f3f46; pointer-events: auto; transition: padding 0.1s ease; }
      .toast-msg { font-size: 15px; font-weight: bold; text-align: center; color: #3b82f6; white-space: nowrap; }
      .legend-icon { font-size: 12px; margin-bottom: 8px; display: block; }
      pre { margin: 0; white-space: pre-wrap; font-family: monospace; color: #a1a1aa; max-height: 200px; overflow-y: auto; }
    `;
    shadowRoot.appendChild(style);

    const overlays = document.createElement('div');
    overlays.id = 'overlays-container';
    shadowRoot.appendChild(overlays);

    const toast = document.createElement('div');
    toast.id = 'preview-toast';
    toast.style.display = 'none';
    shadowRoot.appendChild(toast);

    document.documentElement.appendChild(shadowHost);

    // Override user-select:none site-wide so blocked text can be selected/measured during
    // selection mode. CSS-only override (no DOM mutation); removed on teardown.
    if (!document.getElementById('copycat-userselect')) {
      const us = document.createElement('style');
      us.id = 'copycat-userselect';
      us.textContent = `*, *::before, *::after { user-select: text !important; -webkit-user-select: text !important; }`;
      document.documentElement.appendChild(us);
    }
  }

  // Remove the shadow DOM host from the page and null out references
  function destroyShadowDOM() {
    if (shadowHost) {
      shadowHost.remove();
      shadowHost = null;
      shadowRoot = null;
    }
    const us = document.getElementById('copycat-userselect');
    if (us) us.remove();
  }

  // --- GEOMETRIC MAPPING PROTOCOL ---
  // Get client rects for a target (Element, Text node, or Range); handles inline multi-line wrapping
  function getTargetRects(target) {
    if (!target) return [];
    
    if (target instanceof Range) {
      // getClientRects() is tight to the range's actual selectable boundaries and excludes
      // ::after generated content (e.g. .external link icons). Note: a bookend char with no
      // layout box (e.g. display:none) can't be drawn around, so include/exclude then look the
      // same, which is correct since there is nothing visible to enclose.
      return Array.from(target.getClientRects());
    }
    
    if (target.nodeType === Node.TEXT_NODE) {
      const range = document.createRange();
      range.selectNode(target);
      return Array.from(range.getClientRects());
    }
    
    if (target.nodeType === Node.ELEMENT_NODE) {
      const inlineTags = ['A', 'SPAN', 'EM', 'STRONG', 'B', 'I', 'U', 'LABEL', 'BUTTON'];
      const tagName = target.tagName.toUpperCase();
      if (inlineTags.includes(tagName)) {
        return Array.from(target.getClientRects());
      } else {
        return [target.getBoundingClientRect()];
      }
    }
    
    return [];
  }

  // Merge rects on the same line to prevent stacked opacity from overlapping inline segments
  // Merge rects that share the same vertical line to avoid doubled opacity on overlapping inline fragments
  function mergeRects(rects) {
    if (rects.length <= 1) return rects;
    const merged = [];
    const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
    let current = { top: sorted[0].top, left: sorted[0].left, right: sorted[0].right, bottom: sorted[0].bottom };
    for (let i = 1; i < sorted.length; i++) {
      const r = sorted[i];
      // Merge rects that overlap vertically (same visual line), regardless of horizontal gap
      if (r.top < current.bottom && r.bottom > current.top) {
        // Same line — expand to the union (must update left/top too, not just right/bottom,
        // since rects can sort out of left order when vertical-align differs)
        current.left = Math.min(current.left, r.left);
        current.top = Math.min(current.top, r.top);
        current.right = Math.max(current.right, r.right);
        current.bottom = Math.max(current.bottom, r.bottom);
      } else {
        merged.push({ top: current.top, left: current.left, width: current.right - current.left, height: current.bottom - current.top });
        current = { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
      }
    }
    merged.push({ top: current.top, left: current.left, width: current.right - current.left, height: current.bottom - current.top });
    return merged;
  }

  // --- DYNAMIC MODE THEME COLORS ---
  // Return the hex color matching the current output format / line decoration mode
  function getActiveThemeColor() {
    if (settings.outputFormat === 'COMBINED') {
      return '#ef4444'; // 🔴 Red
    }
    switch (settings.lineDecoration) {
      case 'RAW': return '#3b82f6';          // 🔵 Blue
      case 'QUOTED': return '#1d4ed8';       // 🟦 Royal Blue
      case 'QUOTED_COMMA': return '#10b981'; // 🟩 Green
      case 'CSV': return '#f59e0b';          // 📊 Amber
      case 'NUMBERED': return '#6b7280';     // #️⃣ Gray
      case 'BULLETED': return '#8b5cf6';     // ⏺️ Purple
      default: return '#3b82f6';
    }
  }

  // Convert a hex color string and alpha value to an rgba() CSS string
  function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // --- MULTI-SELECT COLLISION MONITOR ---
  // Check whether a target element/range overlaps with any frozen selection in multi-snip mode
  function isCollidingWithFrozen(target) {
    if (!target) return false;
    let targetNode = target instanceof Range ? target.commonAncestorContainer : target;
    
    for (let frozen of frozenRanges) {
      let frozenNode = frozen instanceof Range ? frozen.commonAncestorContainer : frozen;
      if (targetNode.nodeType === Node.ELEMENT_NODE && frozenNode.nodeType === Node.ELEMENT_NODE) {
        if (targetNode.contains(frozenNode) || frozenNode.contains(targetNode) || targetNode === frozenNode) {
          return true;
        }
      } else {
        if (targetNode === frozenNode) return true;
        if (targetNode.nodeType === Node.ELEMENT_NODE && targetNode.contains(frozenNode)) return true;
        if (frozenNode.nodeType === Node.ELEMENT_NODE && frozenNode.contains(targetNode)) return true;
      }
    }
    return false;
  }
  
  // --- RENDERING UI ---
  // Render all overlay boxes (frozen + active) and update the preview toast with compiled output
  function updateUI(toastMessage = null) {
    if (!shadowRoot) return;
    const overlayContainer = shadowRoot.getElementById('overlays-container');
    const toast = shadowRoot.getElementById('preview-toast');
    
    while (overlayContainer.firstChild) overlayContainer.removeChild(overlayContainer.firstChild);

    if (toastMessage) {
      toast.style.display = 'block';
      toast.style.width = 'max-content'; 
      toast.style.minWidth = 'none';      
      toast.style.padding = '8px 16px';   
      toast.innerHTML = `<div class="toast-msg">${toastMessage}</div>`;
      return;
    } else {
      toast.style.width = '340px';        
      toast.style.minWidth = '';
      toast.style.padding = '';           
    }

    let hint = "";
    if (zoomMode === 'ELEMENT_ZOOM') {
        hint = `<div style="font-size: 11px; color: #60a5fa; margin-top: 4px;">[Space] Zoom into surrounding brackets/quotes</div>`;
    } else {
        hint = `<div style="font-size: 11px; color: #f59e0b; margin-top: 4px;">[Space] Back to element zoom</div>`;
    }

    const themeColor = getActiveThemeColor();

    frozenRanges.forEach(el => {
      let rects = mergeRects(getTargetRects(el));
      Array.from(rects).forEach(rect => {
        if (rect.width === 0 || rect.height === 0) return;
          const box = document.createElement('div');
          box.className = 'highlight-active';
          box.style.cssText = `top: ${rect.top}px; left: ${rect.left}px; width: ${rect.width}px; height: ${rect.height}px; background-color: ${hexToRgba('#10b981', 0.2)}; border: 2px dashed #10b981; position: absolute; pointer-events: none;`;
          overlayContainer.appendChild(box);
      });
    });

    if (currentTargetElement) {
      let rects = getTargetRects(currentTargetElement);
      rects = mergeRects(rects);
      const isSmall = currentTargetElement instanceof Range || currentTargetElement.nodeType === Node.TEXT_NODE;
      rects.forEach(rect => {
        if (rect.width === 0 || rect.height === 0) return;
        const box = document.createElement('div');
        box.style.cssText = isSmall ? `
          position: absolute;
          top: ${rect.top}px;
          left: ${rect.left}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          border-top: 2px dashed ${themeColor};
          border-bottom: 2px dashed ${themeColor};
          border-left: 2px dashed ${themeColor};
          border-right: 2px dashed ${themeColor};
          pointer-events: none;
          transition: all 0.05s ease-out;
        ` : `
          position: absolute;
          top: ${rect.top}px;
          left: ${rect.left}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          background-color: ${hexToRgba(themeColor, 0.3)};
          border: 2px dashed ${themeColor};
          border-radius: 4px;
          box-sizing: border-box;
          pointer-events: none;
          transition: all 0.05s ease-out;
        `;
        overlayContainer.appendChild(box);
      });
    }

    let primaryIcon = '🔵';
    if (settings.outputFormat === 'COMBINED') {
      primaryIcon = '🔴';
    } else {
      switch (settings.lineDecoration) {
        case 'RAW': primaryIcon = '🔵'; break;
        case 'QUOTED': primaryIcon = '🟦'; break;
        case 'QUOTED_COMMA': primaryIcon = '🟩'; break;
        case 'NUMBERED': primaryIcon = '#️⃣'; break;
        case 'BULLETED': primaryIcon = '⏺️'; break;
        case 'CSV': primaryIcon = '📊'; break;
      }
    }

    const decorationLabels = {
      'RAW': 'Raw', 'QUOTED': 'Quoted', 'QUOTED_COMMA': 'Quoted With Comma',
      'CSV': 'CSV', 'NUMBERED': 'Numbered', 'BULLETED': 'Bulleted'
    };

    const modeLabels = {
      'SINGLE_SNIP': 'Single-Snip', 
      'MULTI_SNIP': 'Multi-Snip'
    };
    
    const modeDisplay = modeLabels[settings.trackingMode] || 'Unknown';

    let styleOption = '';
    if (settings.lineDecoration === 'QUOTED') styleOption = STYLE_QUOTES[settings.quoteIndex];
    else if (settings.lineDecoration === 'BULLETED') styleOption = STYLE_BULLETS[settings.bulletIndex];
    else if (settings.lineDecoration === 'NUMBERED') styleOption = STYLE_OUTLINES[settings.outlineIndex];

    toast.style.display = 'block';
    toast.innerHTML = `
      <div class="legend-icon" style="font-size: 12px; margin-bottom: 8px; border-bottom: 1px solid #3f3f46; padding-bottom: 4px;">
        <strong>${primaryIcon}</strong> 
        ${modeDisplay}${zoomMode === 'BOOKEND_ZOOM' ? ' — Bookend' : ''}  
        ${settings.outputFormat === 'COMBINED' ? 'Combined' : decorationLabels[settings.lineDecoration]} ${styleOption ? `${styleOption}` : ''}
      </div>
      <pre>${escapeHtml(compileOutput()) || '...'}</pre>
      ${hint}
    `;
  }

  // Escape HTML special characters for safe rendering in the preview toast
  function escapeHtml(str) { return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // Get visible text from interactive elements (SELECT, INPUT, TEXTAREA, contenteditable)
  function getInteractiveElementText(element) {
    if (!element) return "";
    const tagName = element.tagName && element.tagName.toUpperCase();

    if (tagName === 'SELECT') {
      if (element.selectedIndex !== -1) {
        return element.options[element.selectedIndex].text;
      }
      return "";
    }

    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      return element.value.trim() || element.placeholder || "";
    }
    
    if (element.hasAttribute && (element.hasAttribute('contenteditable') || element.isContentEditable)) {
      const text = element.innerText || "";
      return text.trim() || element.getAttribute('placeholder') || "";
    }

    return null;
  }

  // --- PERFORMANCE TUNED METRICS ENGINE ---
  // Calculate total visible text length within an element, skipping hidden/script/style nodes
  function getVisibleTextLength(rootElement) {
    if (!rootElement) return 0;

    const interactiveText = getInteractiveElementText(rootElement);
    if (interactiveText !== null) {
      return interactiveText.trim().length;
    }

    const filter = {
	  acceptNode: function(node) {
	    const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tagName = parent.tagName.toUpperCase();
        if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT' || tagName === 'OPTION') {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.style.display === 'none' || parent.style.visibility === 'hidden' || parent.style.opacity === '0') {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    };

    const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT, filter, false);

    let totalLength = 0;
    let node;
    while ((node = walker.nextNode())) {
      totalLength += node.nodeValue.trim().length;
    }

    const subInputs = rootElement.querySelectorAll && rootElement.querySelectorAll('input, textarea, [contenteditable], select') || [];
    subInputs.forEach(input => {
      const parent = input.parentElement;
      if (parent && (parent.style.display === 'none' || parent.style.visibility === 'hidden' || parent.style.opacity === '0')) return;
      const text = getInteractiveElementText(input);
      if (text) totalLength += text.trim().length;
    });

    return totalLength;
  }

  // Drill down from an element to the tightest child element or text node under the cursor
  function getTightestTextElement(element, x, y) {
    if (!element) return null;
  
    if (element.tagName && element.tagName.toUpperCase() === 'SELECT') {
        return element;
    }
  
    // 1. Keep Leaf Node check
    const childNodes = Array.from(element.childNodes || []);
    const textNodes = childNodes.filter(n => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim().length > 0);
    if (textNodes.length === 1 && (!element.children || element.children.length === 0)) return element; 
  
    // 2. Traversal
    let current = element;
    let narrowed = true;
  
    while (narrowed) {
      narrowed = false;
      const children = Array.from(current.children || []);
      
      let bestChild = null;
      let maxLen = -1;
  
      for (let child of children) {
        // Intersection Filter
        if (x !== undefined && y !== undefined) {
            const rect = child.getBoundingClientRect();
            if (!(x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) continue;
        }
  
        const len = getVisibleTextLength(child);
        if (len > maxLen) {
          maxLen = len;
          bestChild = child;
        }
      }
  
      if (bestChild) {
        current = bestChild;
        narrowed = true;
      }
    }
    // 3. Fallback: check text node children (element-only loop skips them)
    // This catches text directly inside an element that has no containing element child
    if (current.nodeType === Node.ELEMENT_NODE && x !== undefined && y !== undefined) {
      const directTextNodes = Array.from(current.childNodes || []).filter(
        n => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim().length > 0
      );
      for (let tn of directTextNodes) {
        const range = document.createRange();
        range.selectNodeContents(tn);
        const rects = range.getClientRects();
        for (let rect of rects) {
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return tn;
          }
        }
      }
    }
    return current;
  }
  
  // Safe range/selection equality check — handles both Range and Element types
  function sameSelection(a, b) {
    if (!a || !b) return a === b;
    if (a instanceof Range && b instanceof Range) {
      return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 &&
             a.compareBoundaryPoints(Range.END_TO_END, b) === 0;
    }
    return a === b;
  }

  // --- SELECTION & ZOOM LOGIC ---
  // Evaluate mouse coordinates: update currentTargetElement based on zoom mode and tracking mode
  function evaluateMouseCoords(clientX, clientY) {
    if (!shadowHost) return;
    
    shadowHost.style.visibility = 'hidden'; 
    const el = getDeepElementFromPoint(clientX, clientY);
    shadowHost.style.visibility = 'visible';

    if (!el) return;

    // Bookend Zoom: follow mouse, re-snap to nearest bookend pair at cursor
    if (zoomMode === 'BOOKEND_ZOOM') {
        const snapped = snapToNearestBookend();
        if (snapped) {
            if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(snapped)) {
                if (currentTargetElement !== null) { currentTargetElement = null; updateUI(); }
                return;
            }
            if (!sameSelection(currentTargetElement, snapped)) {
                currentTargetElement = maybeTrim(snapped);
                failedZoomInAttempt = false;
                failedZoomOutAttempt = false;
                updateUI();
            }
        } else {
            if (currentTargetElement !== null) {
                currentTargetElement = null;
                updateUI();
            }
        }
        return;
    }

    // Element Zoom granular tracking: re-evaluate at current mouse position
    if (currentTargetElement instanceof Range) {
        let targetNode = null;
        let offset = -1;
        if (document.caretRangeFromPoint) {
            const caret = document.caretRangeFromPoint(clientX, clientY);
            if (caret && caret.startContainer && caret.startContainer.nodeType === Node.TEXT_NODE) {
                targetNode = caret.startContainer;
                offset = caret.startOffset;
            }
        }
        if (targetNode && offset !== -1) {
            let newRange = getNextZoomRange(targetNode, offset, null);
            if (newRange) {
                if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(newRange)) return;
                if (!sameSelection(currentTargetElement, newRange)) {
                    currentTargetElement = newRange;
                    updateUI();
                }
                return;
            }
        }
    }

    let current = el;
    while (current && current !== document.body && !TAG_PRIORITY.includes(current.tagName && current.tagName.toUpperCase())) {
      current = current.parentElement;
    }
    
    current = (current && current !== document.body) ? current : el;
    current = getTightestTextElement(current, clientX, clientY);

    if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(current)) {
      if (currentTargetElement !== null) {
        currentTargetElement = null;
        updateUI();
      }
      return;
    }
    
    if (currentTargetElement !== current) {
      // Preserve zoom history when in granular text zoom within same container
      const keepHistory = currentTargetElement instanceof Range &&
        (current === currentTargetElement.commonAncestorContainer ||
         (current.contains && current.contains(currentTargetElement.commonAncestorContainer)));
      if (!keepHistory) {
        zoomHistory = [];
      }
      currentTargetElement = current;
      updateUI();
    }
  }

  // Bookend Zoom: snap to narrower pair within current range
  // Bookend zoom-in: find the narrowest bookend pair inside the current selection that encloses the cursor
  function snapToInnerBookend() {
    if (!currentTargetElement || !(currentTargetElement instanceof Range)) return null;
    if (!currentTargetElement._bookendOpenIdx && currentTargetElement._bookendOpenIdx !== 0) return null;
    
    const innerStart = currentTargetElement._bookendOpenIdx + 1;
    const innerEnd = currentTargetElement._bookendCloseIdx - 1;
    if (innerStart >= innerEnd) return null;

    const container = currentTargetElement._bookendContainer;
    if (!container) return null;

    // Collect text and map from the container
    let fullText = "";
    let map = [];
    (function collect(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        for (let i = 0; i < node.nodeValue.length; i++) {
          map.push({ node: node, offset: i });
          fullText += node.nodeValue[i];
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        for (let child of node.childNodes) collect(child);
      }
    })(container);

    // Find cursor position relative to the full text
    let cursorIdx = -1;
    if (document.caretRangeFromPoint) {
      const caret = document.caretRangeFromPoint(lastMouseX, lastMouseY);
      if (caret && caret.startContainer && caret.startContainer.nodeType === Node.TEXT_NODE) {
        for (let i = 0; i < map.length; i++) {
          if (map[i].node === caret.startContainer && map[i].offset === caret.startOffset) {
            cursorIdx = i;
            break;
          }
        }
      }
    }
    // Fallback: try the current range's midpoint
    if (cursorIdx === -1) {
      cursorIdx = Math.floor((innerStart + innerEnd) / 2);
    }
    // If midpoint is outside any inner pair, scan from innerStart forward
    // to find a position that falls within at least one bookend pair
    if (cursorIdx !== -1) {
      let foundAny = false;
      for (let char in BOOKEND_PAIRS) {
        const closeChar = BOOKEND_PAIRS[char];
        let o, c;
        if (char === closeChar) {
          o = fullText.lastIndexOf(char, cursorIdx - 1);
          c = fullText.indexOf(char, cursorIdx + 1);
        } else {
          o = fullText.lastIndexOf(char, cursorIdx);
          c = fullText.indexOf(closeChar, cursorIdx);
        }
        if (o !== -1 && c !== -1 && o > innerStart && c < innerEnd && o <= cursorIdx && c >= cursorIdx) {
          foundAny = true;
          break;
        }
      }
      if (!foundAny) {
        // Scan forward from innerStart to find first position inside a pair
        for (let pos = innerStart + 1; pos < innerEnd; pos++) {
          for (let char in BOOKEND_PAIRS) {
            const closeChar = BOOKEND_PAIRS[char];
            let o, c;
            if (char === closeChar) {
              o = fullText.lastIndexOf(char, pos - 1);
              c = fullText.indexOf(char, pos + 1);
            } else {
              o = fullText.lastIndexOf(char, pos);
              c = fullText.indexOf(closeChar, pos);
            }
            if (o !== -1 && c !== -1 && o > innerStart && c < innerEnd && o <= pos && c >= pos) {
              cursorIdx = pos;
              foundAny = true;
              break;
            }
          }
          if (foundAny) break;
        }
      }
    }

    // Find narrowest enclosing pair within [innerStart, innerEnd]
    let bestRange = null;
    let bestSpan = Infinity;
    let bestOpenIdx = Infinity;

    for (let char in BOOKEND_PAIRS) {
      const closeChar = BOOKEND_PAIRS[char];
      let open, close;

      if (char === closeChar) {
        open = fullText.lastIndexOf(char, cursorIdx - 1);
        close = fullText.indexOf(char, cursorIdx + 1);
      } else {
        open = fullText.lastIndexOf(char, cursorIdx);
        close = fullText.indexOf(closeChar, cursorIdx);
      }

      if (open !== -1 && close !== -1 && open > innerStart && close < innerEnd && open <= cursorIdx && close >= cursorIdx) {
        const span = close - open;
        // Pick narrowest; tiebreaker: earliest open
        if (span < bestSpan || (span === bestSpan && open < bestOpenIdx)) {
          bestSpan = span;
          bestOpenIdx = open;
          const start = map[open];
          const end = map[close];
          if (start && end) {
            const range = document.createRange();
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset + 1);
            range.textZoomLevel = 99;
            range._bookendOpenIdx = open;
            range._bookendCloseIdx = close;
            range._bookendContainer = container;
            range._openNode = start.node;
            range._openOffset = start.offset;
            range._closeNode = end.node;
            range._closeOffset = end.offset;
            bestRange = range;
          }
        }
      }
    }
    return bestRange;
  }

  // Bookend Zoom: snap to wider enclosing pair in ancestor chain
  // Bookend zoom-out: walk ancestor chain to find the narrowest pair that fully encloses the current one
  function snapToOuterBookend() {
    if (!currentTargetElement || !(currentTargetElement instanceof Range)) return null;

    let ancestor = currentTargetElement._bookendContainer || currentTargetElement.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentElement;

    while (ancestor && ancestor !== document.body) {
      // Collect text and map from this ancestor
      let fullText = "";
      let map = [];
      (function collect(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          for (let i = 0; i < node.nodeValue.length; i++) {
            map.push({ node: node, offset: i });
            fullText += node.nodeValue[i];
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          for (let child of node.childNodes) collect(child);
        }
      })(ancestor);

      // Find narrowest pair that encloses current range (DOM-based)
      let bestRange = null;
      let bestSpan = Infinity;

      for (let char in BOOKEND_PAIRS) {
        const closeChar = BOOKEND_PAIRS[char];
        let searchFrom = 0;
        while (true) {
          let open = fullText.indexOf(char, searchFrom);
          if (open === -1) break;
          let close;
          if (char === closeChar) {
            // Symmetric pair: next occurrence is the close
            close = fullText.indexOf(char, open + 1);
          } else {
            // Asymmetric pair: find matching close with nesting (handles (a (b) c))
            close = -1;
            let depth = 1;
            for (let i = open + 1; i < fullText.length; i++) {
              if (fullText[i] === char) depth++;
              else if (fullText[i] === closeChar) depth--;
              if (depth === 0) { close = i; break; }
            }
          }
          if (close === -1) { searchFrom = open + 1; continue; }

          const start = map[open];
          const end = map[close];
          if (start && end) {
            // Build candidate range and check if it DOM-encloses currentTargetElement
            const candidate = document.createRange();
            candidate.setStart(start.node, start.offset);
            candidate.setEnd(end.node, end.offset + 1);
            if (candidate.compareBoundaryPoints(Range.START_TO_START, currentTargetElement) <= 0 &&
                candidate.compareBoundaryPoints(Range.END_TO_END, currentTargetElement) >= 0) {
              const span = close - open;
              if (span < bestSpan) {
                bestSpan = span;
                const newRange = document.createRange();
                newRange.setStart(start.node, start.offset);
                newRange.setEnd(end.node, end.offset + 1);
                newRange.textZoomLevel = 99;
                newRange._bookendOpenIdx = open;
                newRange._bookendCloseIdx = close;
                newRange._bookendContainer = ancestor;
                bestRange = newRange;
              }
            }
          }
          searchFrom = open + 1;
        }
      }

      if (bestRange) return bestRange;
      ancestor = ancestor.parentElement;
    }
    return null;
  }

  // Auto-trim helper: returns trimmed range if excludeDelimiters is on and range has matching bookends
  // If excludeDelimiters is on, trim the outer bookend characters from a snapped range
  function maybeTrim(range) {
    if (!excludeDelimiters || !(range instanceof Range)) return range;
    const text = range.toString();
    if (text.length < 2) return range;
    const first = text[0];
    const last = text[text.length - 1];
    const closeChar = BOOKEND_PAIRS[first];
    if (!closeChar || closeChar !== last) return range;
    const trimmed = document.createRange();
    trimmed.setStart(range.startContainer, range.startOffset + 1);
    trimmed.setEnd(range.endContainer, range.endOffset - 1);
    trimmed.textZoomLevel = range.textZoomLevel;
    trimmed._bookendOpenIdx = range._bookendOpenIdx;
    trimmed._bookendCloseIdx = range._bookendCloseIdx;
    trimmed._bookendContainer = range._bookendContainer;
    trimmed._openNode = range._openNode;
    trimmed._openOffset = range._openOffset;
    trimmed._closeNode = range._closeNode;
    trimmed._closeOffset = range._closeOffset;
    trimmed._trimmed = true;
    return trimmed;
  }

  // Trim surrounding bookend delimiters from the current selection
  // Trim surrounding bookend delimiters from the current range and push to zoom history
  function trimSurroundingBookends() {
    if (!currentTargetElement || !(currentTargetElement instanceof Range)) return;
    const text = currentTargetElement.toString();
    if (text.length < 2) return;

    const first = text[0];
    const last = text[text.length - 1];
    const closeChar = BOOKEND_PAIRS[first];
    if (!closeChar || closeChar !== last) return;

    // Trim the bookend characters
    const newRange = document.createRange();
    newRange.setStart(currentTargetElement.startContainer, currentTargetElement.startOffset + 1);
    newRange.setEnd(currentTargetElement.endContainer, currentTargetElement.endOffset - 1);
    newRange.textZoomLevel = currentTargetElement.textZoomLevel;
    newRange._bookendOpenIdx = currentTargetElement._bookendOpenIdx;
    newRange._bookendCloseIdx = currentTargetElement._bookendCloseIdx;
    newRange._bookendContainer = currentTargetElement._bookendContainer;

    zoomHistory.push(currentTargetElement);
    currentTargetElement = newRange;
    failedZoomInAttempt = false;
    failedZoomOutAttempt = false;
    updateUI();
  }

  // Handle zoom in/out: element zoom walks the DOM tree; bookend zoom snaps inner/outer pairs
  function handleZoom(direction) {
    if (!currentTargetElement) return;

    // Bookend Zoom: bypass element zoom, operate on bookend pairs
    if (zoomMode === 'BOOKEND_ZOOM') {
      if (direction === 'in') {
        if (failedZoomInAttempt) return;
        const inner = snapToInnerBookend();
        if (inner) {
          if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(inner)) return;
          zoomHistory.push(currentTargetElement);
          currentTargetElement = maybeTrim(inner);
          failedZoomInAttempt = false;
          failedZoomOutAttempt = false;
          updateUI();
        } else {
          failedZoomInAttempt = true;
        }
      } else { // zoom out
        if (failedZoomOutAttempt) return;
        const outer = snapToOuterBookend();
        if (outer) {
          if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(outer)) return;
          // Pop the current from history if we're going to a parent pair
          if (zoomHistory.length > 0) zoomHistory.pop();
          currentTargetElement = maybeTrim(outer);
          failedZoomInAttempt = false;
          failedZoomOutAttempt = false;
          updateUI();
        } else {
          failedZoomOutAttempt = true;
        }
      }
      return;
    }

    shadowHost.style.visibility = 'hidden';
    const mouseEl = getDeepElementFromPoint(lastMouseX, lastMouseY);
    shadowHost.style.visibility = 'visible';

    if (direction === 'out') {
      if (zoomHistory.length > 0) {
        let prev = zoomHistory.pop();
        if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(prev)) {
          // Block macro enclosure of elements wrapping active frozen zones
        } else {
          currentTargetElement = prev;
          updateUI();
          return;
        }
      }

      // Zoom out from granular range: just pop zoomHistory
      if (currentTargetElement instanceof Range) {
        if (zoomHistory.length > 0) {
          let prev = zoomHistory.pop();
          if (!(settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(prev))) {
            currentTargetElement = prev;
          }
        } else {
          currentTargetElement = currentTargetElement.commonAncestorContainer;
        }
        updateUI();
        return;
      }

      let parent = currentTargetElement.parentElement || currentTargetElement.parentNode;
      const currentLen = getVisibleTextLength(currentTargetElement);

      while (parent && parent !== document.body) {
        if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(parent)) break;

        const parentLen = getVisibleTextLength(parent);
        if (parentLen > currentLen) {
          // FIX: Assign parent directly instead of drilling back down to the target leaf via getTightestTextElement
          currentTargetElement = parent;
          updateUI();
          return;
        }
        parent = parent.parentElement;
      }
    } else { // zoom in
      // --- THE FIX: Safe SELECT targeting ---
      let target = getDeepElementFromPoint(lastMouseX, lastMouseY);
      let selectTarget = target;
      
      while (selectTarget && selectTarget !== document.body && selectTarget.tagName !== 'SELECT') {
          selectTarget = selectTarget.parentElement;
      }

      if (selectTarget && selectTarget.tagName === 'SELECT') {
          if (!zoomHistory.includes(currentTargetElement)) {
              zoomHistory.push(currentTargetElement);
          }
          currentTargetElement = selectTarget;
          updateUI();
          return;
      }
      // --- END FIX ---

      if (currentTargetElement.nodeType === Node.TEXT_NODE || currentTargetElement instanceof Range) {
        let targetNode = currentTargetElement instanceof Range ? currentTargetElement.commonAncestorContainer : currentTargetElement;
        let offset = -1;
        if (document.caretRangeFromPoint) {
            const caret = document.caretRangeFromPoint(lastMouseX, lastMouseY);
            if (caret && caret.startContainer.nodeType === Node.TEXT_NODE) {
                if (caret.startContainer === targetNode || (targetNode.contains && targetNode.contains(caret.startContainer))) {
                    targetNode = caret.startContainer;
                    offset = caret.startOffset;
                }
            }
        }
        if (offset === -1 && currentTargetElement.nodeType === Node.TEXT_NODE) {
            targetNode = currentTargetElement;
            offset = Math.floor(currentTargetElement.nodeValue.length / 2);
        }
        if (offset !== -1) {
            const curRange = currentTargetElement instanceof Range ? currentTargetElement : null;
            const newRange = getNextZoomRange(targetNode, offset, curRange);
            if (newRange) {
                zoomHistory.push(currentTargetElement);
                currentTargetElement = newRange;
                updateUI();
                return;
            }
        }
        return;
      }

      if (!mouseEl || (currentTargetElement.contains && !currentTargetElement.contains(mouseEl))) return;

      if (currentTargetElement.nodeType === Node.ELEMENT_NODE) {
        const textNodes = Array.from(currentTargetElement.childNodes).filter(n => 
          n.nodeType === Node.TEXT_NODE && n.nodeValue.trim().length > 0
        );

        for (let tn of textNodes) {
          const range = document.createRange();
          range.selectNode(tn);
          const rects = range.getClientRects();
          for (let rect of rects) {
            if (lastMouseX >= rect.left && lastMouseX <= rect.right && 
                lastMouseY >= rect.top && lastMouseY <= rect.bottom) {
              
              if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(tn)) return;
              
              zoomHistory.push(currentTargetElement);
              currentTargetElement = tn;
              updateUI();
              return;
            }
          }
        }
      }

      let curr = mouseEl;
      while (curr && curr.parentElement !== currentTargetElement) {
        curr = curr.parentElement;
      }
      let targetChild = curr;

      if (targetChild && targetChild !== currentTargetElement) {
        if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(targetChild)) return;

        const currentLen = getVisibleTextLength(currentTargetElement);
        const childLen = getVisibleTextLength(targetChild);

        if (childLen > 0 && childLen <= currentLen) {
          zoomHistory.push(currentTargetElement);
          currentTargetElement = getTightestTextElement(targetChild, lastMouseX, lastMouseY);
          updateUI();
        }
      }
    }
  }
  
  // Extract normalized text from an element, text node, or range (handles SELECT, INPUT, cloning)
  function getCleanText(element, showFullList = false) {
    if (!element) return "";
  
    if (element instanceof Range) return element.toString().trim();
    if (element.nodeType === Node.TEXT_NODE) return element.nodeValue.trim();
  
    const tagName = element.tagName && element.tagName.toUpperCase();
  
    // 2. SELECT Handling
    if (tagName === 'SELECT') {
      if (showFullList) {
        let output = [];
        function walk(node) {
          for (let child of node.children) {
            if (child.tagName === 'OPTGROUP') {
              output.push(`-- ${child.label} --`);
              walk(child); 
            } else if (child.tagName === 'OPTION') {
              output.push(child.text.trim());
            }
          }
        }
        walk(element);
        return output.join('\n');
      }
      return element.options[element.selectedIndex]?.text.trim() || "";
    }
  
    if (tagName === 'OPTION') return element.text.trim();
    if (tagName === 'OPTGROUP') return element.label.trim();
  
    // 4. Container Guard
    if (tagName === 'DIV' || tagName === 'LABEL') {
      const selectChild = element.querySelector('select');
      if (selectChild && showFullList) {
        return getCleanText(selectChild, true);
      }
    }
  
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility()) {
      return "";
    }
  
    const interactiveText = getInteractiveElementText(element);
    if (interactiveText !== null) {
      return interactiveText.split('\n').map(line => line.trim()).join('\n').trim();
    }
  
    // 6. Default Fallback
    // Clone node and replace internal SELECT trees with text nodes of their intended value
    // to safeguard native innerText against leaking unintended nested options
    let clone = element.cloneNode(true);
    const originalSelects = element.querySelectorAll ? element.querySelectorAll('select') : [];
    const clonedSelects = clone.querySelectorAll ? clone.querySelectorAll('select') : [];
    
    clonedSelects.forEach((clonedSel, idx) => {
        const originalSel = originalSelects[idx];
        if (originalSel) {
            const textContent = getCleanText(originalSel, showFullList);
            const textNode = document.createTextNode(textContent);
            if (clonedSel.parentNode) {
                clonedSel.parentNode.replaceChild(textNode, clonedSel);
            }
        }
    });
  
    let text = clone.innerText || "";
    return text.split('\n').map(line => line.trim()).join('\n').trim();
  }

  // --- FORMATTING COMPILER ---
  // Compile frozen + active selections into formatted clipboard output respecting line decorations
  function compileOutput() {
    let elements = [...frozenRanges];
    if (currentTargetElement && !elements.includes(currentTargetElement)) {
      elements.push(currentTargetElement);
    }
  
    const isZoomedIn = zoomHistory.length > 0;
    const qChar = STYLE_QUOTES[settings.quoteIndex];
    const bChar = STYLE_BULLETS[settings.bulletIndex];
    const oChar = STYLE_OUTLINES[settings.outlineIndex];
  
    let rawBlocks = elements.map(el => {
      const isSelect = el.tagName && el.tagName.toUpperCase() === 'SELECT';
      const shouldShowList = isZoomedIn && isSelect && el === currentTargetElement;
      
      if (isZoomedIn && isSelect && el !== currentTargetElement && currentTargetElement && currentTargetElement.tagName === 'SELECT') {
        return ""; 
      }
      
      return getCleanText(el, shouldShowList).trim();
    }).filter(Boolean);
  
    let formattedLines = [];
  
    rawBlocks.forEach((blockText, bIndex) => {
      let lines = blockText.split('\n').map(l => l.trim()).filter(Boolean);
  
      if (settings.outputFormat === 'COMBINED') {
        let flat = lines.join(' ').replace(/\s+/g, ' ');
        let escaped = flat.replace(new RegExp(qChar, 'g'), '\\' + qChar);
        formattedLines.push(`${qChar}${escaped}${qChar}`);
      } else {
        let blockResult = lines.map((line, lIndex) => {
          let escaped = line.replace(new RegExp(qChar, 'g'), '\\' + qChar);
          const isLastItem = (bIndex === rawBlocks.length - 1 && lIndex === lines.length - 1);
  
          switch (settings.lineDecoration) {
            case 'QUOTED': return `${qChar}${escaped}${qChar}`;
            case 'QUOTED_COMMA': return `${qChar}${escaped}${qChar}${isLastItem ? '' : ','}`;
            case 'CSV': return `${line}${isLastItem ? '' : ','}`;
            case 'NUMBERED': return `${oChar === '1.' ? (lIndex + 1) + '.' : oChar} ${line}`;
            case 'BULLETED': return `${bChar} ${line}`;
            case 'RAW':
            default: return line;
          }
        });
        formattedLines.push(blockResult.join('\n'));
      }
    });
  
    return formattedLines.join(settings.outputFormat === 'COMBINED' ? ' ' : '\n');
  }

  // Copy compiled output to clipboard and exit selection mode with a confirmation toast
  function commitCopy() {
    const text = compileOutput();
    if (!text) return exitSelectionMode();
    
    navigator.clipboard.writeText(text).then(() => {
      updateUI("😸 Text Copied! 😸");
      setTimeout(exitSelectionMode, 800);
    }).catch(err => {
      updateUI("❌ Clipboard Error ❌");
      setTimeout(exitSelectionMode, 1500);
    });
  }

  // --- EVENT PIPELINE ---
  // Global capture-phase event handler: dispatches all mouse, keyboard, and wheel events during selection
  function handleGlobalCapture(e) {
    if (!isSelectionMode) return;

    const passKeys = ['PageUp', 'PageDown', 'End', 'Home'];
    if (e.type === 'keydown' && passKeys.includes(e.key)) return;

    if (e.type === 'keydown' && e.key === ' ') {
        e.preventDefault(); 
        
        if (e.shiftKey) {
            settings.trackingMode = settings.trackingMode === 'SINGLE_SNIP' ? 'MULTI_SNIP' : 'SINGLE_SNIP';
            if (settings.trackingMode === 'SINGLE_SNIP') frozenRanges = [];
            saveSettings();
            updateUI(`Mode switched to: ${settings.trackingMode === 'SINGLE_SNIP' ? 'Single-Snip' : 'Multi-Snip'}`);
            setTimeout(() => updateUI(), 2000);
            return;
        } 
        
        zoomMode = (zoomMode === 'ELEMENT_ZOOM') ? 'BOOKEND_ZOOM' : 'ELEMENT_ZOOM';
        if (zoomMode === 'BOOKEND_ZOOM') {
            excludeDelimiters = false;
            savedUntrimmedRange = null;
            const snapped = snapToNearestBookend();
            if (snapped) {
                if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(snapped)) return;
                zoomHistory.push(currentTargetElement);
                currentTargetElement = maybeTrim(snapped);
                failedZoomInAttempt = false;
                failedZoomOutAttempt = false;
            }
        } else {
            failedZoomInAttempt = false;
            failedZoomOutAttempt = false;
        }
        updateUI();
        return;
    }

    if (e.type === 'mousemove') {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        // Evaluate at most once per frame; mice can fire hundreds of moves per second
        if (!rafPending) {
          rafPending = requestAnimationFrame(() => {
            rafPending = 0;
            if (isSelectionMode) evaluateMouseCoords(lastMouseX, lastMouseY);
          });
        }
        return;
    }

    if (e.composedPath && e.composedPath().some(el => el.id === 'copy-cat-host')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.type === 'wheel') {
      handleZoom(e.deltaY < 0 ? 'in' : 'out');
    } else if (e.type === 'mousedown') {
      if (e.button === 0) commitCopy();
    } else if (e.type === 'contextmenu') {
      if (settings.trackingMode === 'MULTI_SNIP') {
        if (currentTargetElement && !frozenRanges.includes(currentTargetElement)) {
          frozenRanges.push(currentTargetElement);
        }
        evaluateMouseCoords(e.clientX, e.clientY);
      }
    } else if (e.type === 'keydown') {
      const key = e.key;
	  if (key === ' ') {
        e.preventDefault();
        if (e.shiftKey) {
          settings.trackingMode = settings.trackingMode === 'SINGLE_SNIP' ? 'MULTI_SNIP' : 'SINGLE_SNIP';
          if (settings.trackingMode === 'SINGLE_SNIP') frozenRanges = [];
          saveSettings(); 
          updateUI();
        } else {
          zoomMode = (zoomMode === 'ELEMENT_ZOOM') ? 'BOOKEND_ZOOM' : 'ELEMENT_ZOOM';
          if (zoomMode === 'BOOKEND_ZOOM') {
            excludeDelimiters = false;
            savedUntrimmedRange = null;
            const snapped = snapToNearestBookend();
            if (snapped) {
              if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(snapped)) return;
              zoomHistory.push(currentTargetElement);
              currentTargetElement = maybeTrim(snapped);
              failedZoomInAttempt = false;
              failedZoomOutAttempt = false;
            }
          } else {
            failedZoomInAttempt = false;
            failedZoomOutAttempt = false;
          }
          updateUI();
        }
      } else if (['Escape', 'Backspace', 'Delete'].includes(key)) {
        updateUI("❌ Copy Cancelled ❌");
        setTimeout(exitSelectionMode, 500);
      } else if (key === 'ArrowUp') { 
        handleZoom('in'); 
      } else if (key === 'ArrowDown') { 
        handleZoom('out'); 
      } else if (key === 'Tab') {
        if (e.shiftKey) {
          if (settings.outputFormat === 'SPLIT') {
            cachedSplitDecoration = settings.lineDecoration;
            settings.outputFormat = 'COMBINED';
            settings.lineDecoration = 'QUOTED';
          } else {
            settings.outputFormat = 'SPLIT';
            settings.lineDecoration = cachedSplitDecoration;
          }
        } else if (settings.outputFormat === 'SPLIT') {
          let idx = (DECORATIONS.indexOf(settings.lineDecoration) + 1) % DECORATIONS.length;
          settings.lineDecoration = DECORATIONS[idx];
        }
        saveSettings(); 
        updateUI();
      } else if (key.toLowerCase() === 'q') {
          let step = e.shiftKey ? -1 : 1;
          if (settings.outputFormat === 'COMBINED' || ['QUOTED', 'QUOTED_COMMA'].includes(settings.lineDecoration)) {
            settings.quoteIndex = (settings.quoteIndex + step + STYLE_QUOTES.length) % STYLE_QUOTES.length;
          } else if (settings.lineDecoration === 'BULLETED') {
            settings.bulletIndex = (settings.bulletIndex + step + STYLE_BULLETS.length) % STYLE_BULLETS.length;
          } else if (settings.lineDecoration === 'NUMBERED') {
            settings.outlineIndex = (settings.outlineIndex + step + STYLE_OUTLINES.length) % STYLE_OUTLINES.length;
          }
          saveSettings(); 
          updateUI();
      } else if (key.toLowerCase() === 'x') {
          excludeDelimiters = !excludeDelimiters;
          if (currentTargetElement instanceof Range) {
            if (excludeDelimiters) {
              savedUntrimmedRange = currentTargetElement;
              const trimmed = maybeTrim(currentTargetElement);
              if (trimmed === currentTargetElement) {
                // No bookends to trim — expand to enclosing pair then trim it
                const expanded = findEnclosingPair();
                if (expanded) {
                  savedUntrimmedRange = expanded.cloneRange();
                  savedUntrimmedRange.textZoomLevel = 99;
                  if (expanded._openNode) {
                    savedUntrimmedRange._openNode = expanded._openNode;
                    savedUntrimmedRange._openOffset = expanded._openOffset;
                    savedUntrimmedRange._closeNode = expanded._closeNode;
                    savedUntrimmedRange._closeOffset = expanded._closeOffset;
                  }
                  currentTargetElement = maybeTrim(expanded);
                }
              } else {
                currentTargetElement = trimmed;
              }
            } else {
              if (savedUntrimmedRange) {
                currentTargetElement = savedUntrimmedRange;
                savedUntrimmedRange = null;
              } else {
                const restored = findEnclosingPair();
                if (restored && !(settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(restored))) {
                  // Zoom out to container when bookends are unrenderable (e.g. [edit])
                  currentTargetElement = includeBookendTarget(restored);
                }
              }
            }
          } else if (currentTargetElement && excludeDelimiters && pendingInnerRange &&
                     currentTargetElement.nodeType === Node.ELEMENT_NODE &&
                     (currentTargetElement.textContent || '').trim() === pendingInnerRange.toString().trim()) {
            // We zoomed out to a container element to show unrenderable bookends (e.g. [edit]).
            // This x press trims back to the inner text held in pendingInnerRange.
            const innerSrc = pendingInnerRange;
            pendingInnerRange = null;
            currentTargetElement = maybeTrim(innerSrc);
          } else if (currentTargetElement && (currentTargetElement.nodeType === Node.ELEMENT_NODE || currentTargetElement.nodeType === Node.TEXT_NODE)) {
            // From a bare element or text node: search for the enclosing bookend pair at cursor
            const foundRange = findEnclosingPair();
            if (foundRange && foundRange._openNode && foundRange._closeNode) {
              zoomHistory.push(currentTargetElement);
              // Coming from a bare element, the bookend chars are currently excluded, so the
              // first x press should INCLUDE them (show the full pair). Force include here.
              excludeDelimiters = false;
              savedUntrimmedRange = null;
              currentTargetElement = includeBookendTarget(foundRange);
            } else {
              // Fallback: walk up ancestors for elements fully wrapped in bookends (e.g. [edit] span)
              let bookendEl = currentTargetElement;
              while (bookendEl && bookendEl !== document.body) {
                const text = (bookendEl.textContent || '').trim();
                const first = text[0];
                const last = text[text.length - 1];
                const closeChar = BOOKEND_PAIRS[first];
                if (closeChar && closeChar === last && text.length > 2) {
                  const range = elementToRange(bookendEl);
                  if (range) {
                    range._bookendOpenIdx = 0;
                    range._bookendCloseIdx = text.length - 1;
                    range._bookendContainer = bookendEl;
                    range.textZoomLevel = 99;
                    range._bookendEl = bookendEl;
                    range._openNode = range.startContainer;
                    range._openOffset = range.startOffset;
                    range._closeNode = range.endContainer;
                    range._closeOffset = range.endOffset - 1;
                    zoomHistory.push(bookendEl);
                    if (excludeDelimiters) {
                      savedUntrimmedRange = range.cloneRange();
                      savedUntrimmedRange.textZoomLevel = 99;
                      savedUntrimmedRange._openNode = range._openNode;
                      savedUntrimmedRange._openOffset = range._openOffset;
                      savedUntrimmedRange._closeNode = range._closeNode;
                      savedUntrimmedRange._closeOffset = range._closeOffset;
                      savedUntrimmedRange._bookendOpenIdx = range._bookendOpenIdx;
                      savedUntrimmedRange._bookendCloseIdx = range._bookendCloseIdx;
                      savedUntrimmedRange._bookendContainer = range._bookendContainer;
                      savedUntrimmedRange._bookendEl = range._bookendEl;
                      range._trimmed = true;
                    }
                    currentTargetElement = range;
                  }
                  break;
                }
                bookendEl = bookendEl.parentElement;
              }
            }
          }
          updateUI();
      }
    }
  }

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
    initShadowDOM();

    captureEvents.forEach(evt => window.addEventListener(evt, handleGlobalCapture, { capture: true, passive: false }));
    loadSettings(() => evaluateMouseCoords(x, y));
  }

  // Deactivate selection mode: remove listeners, destroy shadow DOM, restore page state
  function exitSelectionMode() {
    isSelectionMode = false;
    if (rafPending) { cancelAnimationFrame(rafPending); rafPending = 0; }
    bookendScanCache = null;
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

})();