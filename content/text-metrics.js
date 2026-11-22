// Copy Cat content script: Text measuring and extraction: visible length, tightest element, clean text.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

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
      const t = interactiveText.split('\n').map(line => line.trim()).join('\n').trim();
      if (t) return t;
      const named = getBestName(element);       // empty field: fall back to its label/aria-label
      return named ? named.text : '';
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
    text = text.split('\n').map(line => line.trim()).join('\n').trim();
    if (!text && isNameCandidate(element)) {      // image, SVG, icon button: copy its best name
      const named = getBestName(element);
      if (named) return named.text;
    }
    return text;
  }
