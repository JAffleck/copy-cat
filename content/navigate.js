// Copy Cat content script: ← / → while selecting — move the selection to the previous / next word
// (when zoomed into text) or to the previous / next item at the same level (elements, text nodes).
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

  // Same word characters as getWordRange (plan 21); invisible in-word characters don't start a word
  const NAV_WORD_CHAR = /[\p{L}\p{M}\p{N}_\-]/u;
  const KEYBOARD_JITTER_PX = 12;

  function navTextVisible(textNode) {
    const p = textNode.parentElement;
    if (!p) return false;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'OPTION'].includes(p.tagName)) return false;
    if (p.closest('#copy-cat-host, #copy-cat-picker')) return false;
    return typeof p.checkVisibility !== 'function' || p.checkVisibility();
  }

  // Text position (node, offset) at a Range boundary; for element boundaries, the nearest text node
  // in the direction of travel
  function boundaryText(container, offset, dir) {
    if (container.nodeType === Node.TEXT_NODE) return { node: container, offset };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const child = container.childNodes[offset] || null;
    if (dir > 0) {
      walker.currentNode = child || container;
      let n = child && child.nodeType === Node.TEXT_NODE ? child : walker.nextNode();
      return n ? { node: n, offset: 0 } : null;
    }
    walker.currentNode = child || container;
    const n = walker.previousNode();
    return n ? { node: n, offset: n.nodeValue.length } : null;
  }

  // The previous / next word starting from a text position (document order, visible text only)
  function adjacentWordRange(node, offset, dir) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    walker.currentNode = node;
    let n = node;
    let i = offset;
    while (n) {
      if (navTextVisible(n)) {
        const t = n.nodeValue;
        if (dir > 0) {
          for (; i < t.length; i++) if (NAV_WORD_CHAR.test(t[i])) return getWordRange(n, i, 0, t.length);
        } else {
          for (i = Math.min(i, t.length) - 1; i >= 0; i--) if (NAV_WORD_CHAR.test(t[i])) return getWordRange(n, i, 0, t.length);
        }
      }
      n = dir > 0 ? walker.nextNode() : walker.previousNode();
      i = dir > 0 ? 0 : (n ? n.nodeValue.length : 0);
    }
    return null;
  }

  // Worth landing on: visible text, or a text-less thing with a name (image, icon button…)
  function navMeaningful(node) {
    if (node.nodeType === Node.TEXT_NODE) return !!node.nodeValue.trim() && navTextVisible(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.id === 'copy-cat-host' || node.id === 'copy-cat-picker') return false;
    if (typeof node.checkVisibility === 'function' && !node.checkVisibility()) return false;
    return !!visibleTextOf(node) || (isNameCandidate(node) && !!getBestName(node));
  }

  function adjacentSibling(node, dir) {
    let s = dir > 0 ? node.nextSibling : node.previousSibling;
    while (s) {
      if (navMeaningful(s) && !(settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(s))) return s;
      s = dir > 0 ? s.nextSibling : s.previousSibling;
    }
    return null;
  }

  function scrollSelectionIntoView(target) {
    const el = target instanceof Range ? elementOf(target) : (target.nodeType === Node.TEXT_NODE ? target.parentElement : target);
    if (!el) return;
    const r = (target instanceof Range ? target : el).getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }

  function moveSelection(dir) {
    const cur = currentTargetElement;
    if (!cur) return;
    let next = null;
    if (cur instanceof Range) {
      let pos = dir > 0 ? boundaryText(cur.endContainer, cur.endOffset, dir) : boundaryText(cur.startContainer, cur.startOffset, dir);
      while (pos) {
        next = adjacentWordRange(pos.node, pos.offset, dir);
        if (!next || !(settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(next))) break;
        pos = dir > 0 ? { node: next.endContainer, offset: next.endOffset } : { node: next.startContainer, offset: next.startOffset };
        next = null;
      }
    } else {
      next = adjacentSibling(cur, dir);
    }
    if (!next) {
      updateUI(dir > 0 ? 'No more items →' : '← No more items');
      setTimeout(() => { if (isSelectionMode) updateUI(); }, 900);
      return;
    }
    // Rebuild zoom history for the new spot (as plan 3 does for mouse moves), drop stale x-toggle state
    if (next instanceof Range) {
      const text = next.startContainer;
      zoomHistory = [];
      if (text.parentElement) zoomHistory.push(text.parentElement);
      zoomHistory.push(text);
    } else {
      zoomHistory = [];
    }
    currentTargetElement = next instanceof Range ? maybeTrim(next) : next;
    clearToggleState();
    zoomLocked = false;
    keyboardAnchor = { x: lastMouseX, y: lastMouseY };
    scrollSelectionIntoView(currentTargetElement);
    updateUI();
  }

  // Mouse jitter near where an arrow key was pressed keeps the keyboard selection
  function keyboardHoldsSelection(x, y) {
    if (!keyboardAnchor) return false;
    if (Math.hypot(x - keyboardAnchor.x, y - keyboardAnchor.y) < KEYBOARD_JITTER_PX) return true;
    keyboardAnchor = null;
    return false;
  }
