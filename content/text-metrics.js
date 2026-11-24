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
        // Intersection Filter: test the child's line boxes, not its bounding box. An inline element
        // that wraps onto two lines has one bounding box covering both lines in full, which would
        // swallow the text beside it (e.g. ", not " after a wrapped <phrase>).
        if (x !== undefined && y !== undefined) {
            const boxes = child.getClientRects();
            let inside = false;
            for (const r of boxes) {
              if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { inside = true; break; }
            }
            if (!inside) continue;
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
  
    // 6. Default Fallback: the rendered text (innerText) of the live element, so block elements,
    // list items and <br> give separate lines, inline spans stay joined, and hidden content
    // (script/style, display:none) is skipped. innerText of a detached node has no layout and falls
    // back to textContent (no line breaks, script/style code included), so never read it detached.
    let text = renderedTextWithControls(element, showFullList);
    text = text.split('\n').map(line => line.trim()).join('\n').trim();
    if (!text && isNameCandidate(element)) {      // image, SVG, icon button: copy its best name
      const named = getBestName(element);
      if (named) return named.text;
    }
    return text;
  }

  // Text a form control inside a container contributes: { text, block } or null (nothing).
  // Selects: the chosen option. Input buttons: their value (what the button shows; the browser's
  // default "Submit"/"Reset" without one), each its own line. Text fields: the typed value, inline.
  // Never: passwords/secrets, hidden, checkbox/radio/file/range/color, or controls not rendered.
  const TEXT_FIELD_TYPES = ['text', 'search', 'email', 'url', 'tel', 'number', 'date', 'time',
    'datetime-local', 'month', 'week'];
  function controlText(ctrl, showFullList) {
    if (typeof ctrl.checkVisibility === 'function' && !ctrl.checkVisibility()) return null;
    const tag = ctrl.tagName.toUpperCase();
    if (tag === 'SELECT') return { text: getCleanText(ctrl, showFullList), block: false };
    if (tag === 'TEXTAREA') return ctrl.value.trim() ? { text: ctrl.value.trim(), block: false } : null;
    if (isSecretField(ctrl)) return null;
    const type = ctrl.type;
    if (type === 'submit' || type === 'reset' || type === 'button') {
      const v = ctrl.hasAttribute('value') ? ctrl.value : (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '');
      return v.trim() ? { text: v.trim(), block: true } : null;
    }
    if (type === 'image') return ctrl.alt && ctrl.alt.trim() ? { text: ctrl.alt.trim(), block: true } : null;
    if (TEXT_FIELD_TYPES.includes(type)) return ctrl.value.trim() ? { text: ctrl.value.trim(), block: false } : null;
    return null;
  }

  // Container tags: separate items even when CSS shows them side by side (plan 33). Inline text
  // tags (span, a, b, code…) are not listed: next to text or each other they stay joined.
  const CONTAINER_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'SECTION', 'ARTICLE', 'ASIDE',
    'NAV', 'HEADER', 'FOOTER', 'MAIN', 'FIGURE', 'FIGCAPTION', 'BLOCKQUOTE', 'FORM', 'FIELDSET', 'TABLE', 'TR',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'ADDRESS', 'DETAILS', 'SUMMARY']);
  const MAX_SCAN = 3000;   // whole-page zoom: skip the scan so mouse moves stay fast

  // Indexes (in querySelectorAll('*') order) of container-tag descendants shown inline / inline-block…
  function inlineContainerIndexes(all) {
    if (all.length > MAX_SCAN) return [];
    const out = [];
    for (let i = 0; i < all.length; i++) {
      if (!CONTAINER_TAGS.has(all[i].tagName)) continue;
      if (getComputedStyle(all[i]).display.startsWith('inline')) out.push(i);
    }
    return out;
  }

  // innerText of the element. A clone is read instead (briefly attached right after the element,
  // so page CSS still applies; off-screen; removed in the same synchronous step) when:
  // - form controls are inside (select, input, textarea): they aren't in innerText (a select lists
  //   every option), so each is replaced by its text (controlText);
  // - container tags are shown side by side (inline-block divs…): innerText would run them together
  //   ("GmailImages"), so in the clone they are made display:block, one item per line.
  function renderedTextWithControls(element, showFullList) {
    if (!element.querySelectorAll) return element.innerText || '';
    const CONTROLS = 'select, input, textarea';
    const controls = element.querySelectorAll(CONTROLS);
    const all = element.querySelectorAll('*');
    const inlineIdx = inlineContainerIndexes(all);
    if (!controls.length && !inlineIdx.length) return element.innerText || '';

    const clone = element.cloneNode(true);
    if (inlineIdx.length) {                       // before the controls swap changes the order
      const cloneAll = clone.querySelectorAll('*');
      for (const i of inlineIdx) if (cloneAll[i]) cloneAll[i].style.setProperty('display', 'block', 'important');
    }
    clone.querySelectorAll(CONTROLS).forEach((clonedCtrl, idx) => {
      const original = controls[idx];
      if (!clonedCtrl.parentNode) return;
      const t = original ? controlText(original, showFullList) : null;
      let replacement;
      if (!t) replacement = document.createTextNode('');
      else if (t.block) { replacement = document.createElement('div'); replacement.textContent = t.text; }
      else replacement = document.createTextNode(t.text);
      clonedCtrl.parentNode.replaceChild(replacement, clonedCtrl);
    });
    clone.removeAttribute('id');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.setProperty('position', 'absolute', 'important');
    clone.style.setProperty('left', '-99999px', 'important');
    clone.style.setProperty('top', '0', 'important');
    clone.style.setProperty('pointer-events', 'none', 'important');
    const parent = element.parentNode;
    if (!parent) return clone.innerText || '';
    try {
      parent.insertBefore(clone, element.nextSibling);
      return clone.innerText || '';
    } catch (e) {
      return clone.innerText || '';
    } finally {
      clone.remove();
    }
  }
