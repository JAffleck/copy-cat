// Copy Cat content script: Selection tracking and zoom: mouse evaluation, zoom lock, frozen collisions, zoom in/out.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

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

  // --- SELECTION & ZOOM LOGIC ---
  // Evaluate mouse coordinates: update currentTargetElement based on zoom mode and tracking mode
  function evaluateMouseCoords(clientX, clientY) {
    if (!shadowHost) return;
    
    shadowHost.style.visibility = 'hidden'; 
    const el = getDeepElementFromPoint(clientX, clientY);
    const rawEl = document.elementFromPoint(clientX, clientY);
    shadowHost.style.visibility = 'visible';
    // Text-less things with a name (image, SVG/icon, icon-only button, empty field) can be selected
    // directly; the caret-based lookup above would otherwise jump to nearby text
    const namedEl = getNamedTarget(rawEl);

    if (!el) return;

    // After an explicit zoom, keep the selection (and its zoom level) while the mouse stays inside
    // it, so tiny hand jitter doesn't undo the zoom. Leaving it releases the lock.
    if (zoomLocked) {
      if (currentTargetElement && isPointInTarget(currentTargetElement, clientX, clientY, 2)) return;
      zoomLocked = false;
    }

    // Bookend Zoom: follow mouse, re-snap to nearest bookend pair at cursor
    if (zoomMode === 'BOOKEND_ZOOM') {
        const snapped = snapToNearestBookend();
        if (snapped) {
            if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(snapped)) {
                if (currentTargetElement !== null) { currentTargetElement = null; clearToggleState(); updateUI(); }
                return;
            }
            if (!sameSelection(currentTargetElement, snapped)) {
                currentTargetElement = maybeTrim(snapped);
                clearToggleState();
                failedZoomInAttempt = false;
                failedZoomOutAttempt = false;
                updateUI();
            }
        } else {
            if (currentTargetElement !== null) {
                currentTargetElement = null;
                clearToggleState();
                updateUI();
            }
        }
        return;
    }

    // Element Zoom granular tracking: re-evaluate at current mouse position
    if (currentTargetElement instanceof Range && !namedEl) {
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
                    // The selection moved to a new spot: rebuild zoom history as a fresh zoom-in
                    // here would (element → text node → range), so zoom-out starts from the word
                    // under the mouse instead of the word originally zoomed into.
                    const elementAtMouse = getElementTargetAt(el, clientX, clientY);
                    zoomHistory = [];
                    if (elementAtMouse && elementAtMouse !== targetNode) zoomHistory.push(elementAtMouse);
                    zoomHistory.push(targetNode);
                    currentTargetElement = newRange;
                    clearToggleState();
                    updateUI();
                }
                return;
            }
        }
    }

    const current = namedEl || getElementTargetAt(el, clientX, clientY);

    if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(current)) {
      if (currentTargetElement !== null) {
        currentTargetElement = null;
        clearToggleState();
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
      clearToggleState();
      updateUI();
    }
  }

  // Element that tracking selects for the element under the mouse: nearest TAG_PRIORITY ancestor,
  // then narrowed to the tightest text element at the cursor
  function getElementTargetAt(el, clientX, clientY) {
    let current = el;
    while (current && current !== document.body && !TAG_PRIORITY.includes(current.tagName && current.tagName.toUpperCase())) {
      current = current.parentElement;
    }
    current = (current && current !== document.body) ? current : el;
    return getTightestTextElement(current, clientX, clientY);
  }

  // True if (x, y) is within `tolerance` px of any rect of the target (Element, Text node, Range)
  function isPointInTarget(target, x, y, tolerance) {
    let rects;
    try { rects = getTargetRects(target); } catch (e) { return false; }
    for (const r of rects) {
      if (x >= r.left - tolerance && x <= r.right + tolerance &&
          y >= r.top - tolerance && y <= r.bottom + tolerance) return true;
    }
    return false;
  }

  // True if Range `outer` fully contains Range `inner` (false on detached/foreign nodes)
  function rangeContains(outer, inner) {
    try {
      return outer.compareBoundaryPoints(Range.START_TO_START, inner) <= 0 &&
             outer.compareBoundaryPoints(Range.END_TO_END, inner) >= 0;
    } catch (e) {
      return false;
    }
  }

  // X-toggle state belongs to one selection; drop it when tracking moves the selection elsewhere
  function clearToggleState() {
    savedUntrimmedRange = null;
    pendingInnerRange = null;
  }

  // Handle zoom in/out: element zoom walks the DOM tree; bookend zoom snaps inner/outer pairs
  // Zoom in/out (wheel, ArrowUp/ArrowDown); locks the result against mouse jitter if it changed
  function handleZoom(direction) {
    const before = currentTargetElement;
    handleZoomInner(direction);
    if (currentTargetElement && currentTargetElement !== before) zoomLocked = true;
  }

  function handleZoomInner(direction) {
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
