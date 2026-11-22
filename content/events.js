// Copy Cat content script: Event pipeline: capture-phase handler for all selection-mode mouse/keyboard input.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

  // After Space switches element ↔ bracket/quote zoom: select what's under the mouse now, the same way
  // a mouse move would, so the change shows without moving the mouse
  function reselectAtMouse() {
    clearToggleState();
    keyboardAnchor = null;
    if (zoomMode === 'BOOKEND_ZOOM') {
      excludeDelimiters = false;
      const snapped = snapToNearestBookend();
      if (snapped && !(settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(snapped))) {
        if (currentTargetElement) zoomHistory.push(currentTargetElement);
        currentTargetElement = maybeTrim(snapped);
      } else {
        currentTargetElement = null;            // no pair under the mouse (as when hovering)
      }
      updateUI();
    } else {
      currentTargetElement = null;
      zoomHistory = [];
      evaluateMouseCoords(lastMouseX, lastMouseY);
      updateUI();
    }
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
        zoomLocked = false;
        failedZoomInAttempt = false;
        failedZoomOutAttempt = false;
        reselectAtMouse();
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
      if (e.button === 0) {
        if (identifyMode) {
          const first = currentTargetElement ? getElementNames(currentTargetElement)[0] : null;
          if (first) commitText(first.text);
        } else {
          commitCopy();
        }
      }
    } else if (e.type === 'contextmenu') {
      if (settings.trackingMode === 'MULTI_SNIP') {
        if (currentTargetElement && !frozenRanges.includes(currentTargetElement)) {
          frozenRanges.push(currentTargetElement);
        }
        // The locked selection was just frozen; release the zoom lock so re-evaluation can move
        // the active selection off it (and redraw)
        zoomLocked = false;
        evaluateMouseCoords(e.clientX, e.clientY);
      }
    } else if (e.type === 'keydown') {
      const key = e.key;
      // Identify view keys: 1–9 copy a name, N / Esc go back to the normal preview
      if (identifyMode) {
        if (/^[1-9]$/.test(key)) {
          const names = currentTargetElement ? getElementNames(currentTargetElement) : [];
          const pick = names[Number(key) - 1];
          if (pick) commitText(pick.text);
          return;
        }
        if (key === 'Escape' || key.toLowerCase() === 'n') {
          identifyMode = false;
          updateUI();
          return;
        }
      } else if (key.toLowerCase() === 'n' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        identifyMode = true;
        updateUI();
        return;
      }
      if (['Escape', 'Backspace', 'Delete'].includes(key)) {
        updateUI("❌ Copy Cancelled ❌");
        setTimeout(exitSelectionMode, 500);
      } else if (key === 'ArrowUp') { 
        handleZoom('in'); 
      } else if (key === 'ArrowDown') { 
        handleZoom('out'); 
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        // previous / next word (zoomed into text) or item at the same level
        moveSelection(key === 'ArrowLeft' ? -1 : 1);
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
      } else if (key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // Save the form fields inside the selection as a named group (plan 8)
          saveFormGroup(currentTargetElement);
      } else if (key.toLowerCase() === 'q') {
          let step = e.shiftKey ? -1 : 1;
          if (settings.outputFormat === 'COMBINED' || ['QUOTED', 'QUOTED_COMMA'].includes(settings.lineDecoration)) {
            settings.quoteIndex = (settings.quoteIndex + step + QUOTE_PAIRS.length) % QUOTE_PAIRS.length;
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
              // Only restore the saved untrimmed range if it still encloses the current selection
              // (it may be stale if the selection moved since it was saved)
              if (savedUntrimmedRange && !rangeContains(savedUntrimmedRange, currentTargetElement)) {
                savedUntrimmedRange = null;
              }
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
