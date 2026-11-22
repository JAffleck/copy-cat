// Copy Cat content script: Bookend Zoom: bracket/quote pair snapping (nearest, inner, outer) and trimming.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

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
          // lastIndexOf(c, -1) treats -1 as 0, so stop at index 0 (else endless loop when the
          // text starts with this opening char and that pair doesn't enclose the cursor)
          open = open > 0 ? fullText.lastIndexOf(char, open - 1) : -1;
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
