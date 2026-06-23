(function () {
  // --- STATE MANAGEMENT ---
  let isSelectionMode = false;
  let currentTargetElement = null;
  let frozenRanges = [];
  let shadowHost = null;
  let shadowRoot = null;
  let isPivotMode = false; 
  
  // Track global mouse position for smart-zooming
  let lastMouseX = 0;
  let lastMouseY = 0;

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
  function getGranularRange(textNode, offset, level) {
    const text = textNode.nodeValue || "";
    const wordBoundaries = /[^\w\-\u00C0-\u017F]/;

    if (level === 1) {
        let start = offset, end = offset;
        while (start > 0 && !wordBoundaries.test(text[start - 1])) start--;
        while (end < text.length && !wordBoundaries.test(text[end])) end++;
        
        const match = text.substring(start, end).replace(/^[-]+|[-]+$/g, '');
        const actualStart = start + text.substring(start, end).indexOf(match);
        const range = document.createRange();
        range.setStart(textNode, actualStart);
        range.setEnd(textNode, actualStart + match.length);
        range.textZoomLevel = level;
        return range;
    } else if (level >= 2) {
        // Deeper zoom: split by delimiters
        const bookends = ['-', ',', ';', '(', ')', '[', ']', '{', '}'];
        let start = 0, end = text.length;
        let hasBookend = false;
        
        for (let i = offset - 1; i >= 0; i--) {
            if (bookends.includes(text[i])) { start = i + 1; hasBookend = true; break; }
        }
        for (let i = offset; i < text.length; i++) {
            if (bookends.includes(text[i])) { end = i; hasBookend = true; break; }
        }

        // FIX: If no bookends constrain this phrase, do not blow up to full node text length
        if (!hasBookend) return null;

        // Trim whitespace
        while (start < end && /\s/.test(text[start])) start++;
        while (end > start && /\s/.test(text[end - 1])) end--;
        
        if (start >= end) return null;

        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
        range.textZoomLevel = level;
        return range;
    }
    return null;
  }
  // --- PIVOT MODE HELPER ---
  function snapToNearestBookend() {
    if (!currentTargetElement) return;

    // 1. Identify the structural container
    let node = currentTargetElement instanceof Range ? currentTargetElement.startContainer : currentTargetElement;
    let container = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    
    // 2. Map all text nodes to a flat array to handle multi-node selections
    let fullText = "";
    let map = [];

    function collect(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            for (let i = 0; i < node.nodeValue.length; i++) {
                map.push({ node: node, offset: i });
                fullText += node.nodeValue[i];
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Include text from spans/anchors so [edit] is seen as a whole string
            for (let child of node.childNodes) {
                collect(child);
            }
        }
    }
    collect(container);

	// 3. Find current cursor index in our flat map
	let cursorIdx = -1;

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

	// Fallback if we couldn't map the cursor exactly
	if (cursorIdx === -1) {
		cursorIdx = Math.floor(fullText.length / 2);
	}

	// 4. Search for the widest surrounding pair
	const pairs = {
		'"': '"',
		'`': '`',
		'(': ')',
		'[': ']',
		'{': '}',
		'⟨': '⟩'
	};

	let bestRange = null;

	for (let char in pairs) {
		let open, close;

		// Symmetric bookends (" and `)
		if (char === pairs[char]) {
			open = fullText.lastIndexOf(char, cursorIdx - 1);
			close = fullText.indexOf(char, cursorIdx + 1);
		} else {
			open = fullText.lastIndexOf(char, cursorIdx);
			close = fullText.indexOf(pairs[char], cursorIdx);
		}

		if (open !== -1 && close !== -1 &&
			open <= cursorIdx && close >= cursorIdx) {

			const start = map[open];
			const end = map[close];

			if (!start || !end) continue;

			const range = document.createRange();
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset + 1); // +1 to capture closing bookend
			range.textZoomLevel = 99; // Pivot level

			bestRange = range;
		}
	}

    if (bestRange) {
        zoomHistory.push(currentTargetElement);
        currentTargetElement = bestRange;
        updateUI();
    }
  }
  // --- SHADOW DOM INITIALIZATION ---
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
  }

  function destroyShadowDOM() {
    if (shadowHost) {
      shadowHost.remove();
      shadowHost = null;
      shadowRoot = null;
    }
  }

  // --- GEOMETRIC MAPPING PROTOCOL ---
  function getTargetRects(target) {
    if (!target) return [];
    
    if (target instanceof Range) {
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

  // --- DYNAMIC MODE THEME COLORS ---
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

  function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // --- MULTI-SELECT COLLISION MONITOR ---
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
    
    function getContextualHint(element) {
        const text = getCleanText(element);
        const bookends = {
            '(': 'Parentheses',
            '[': 'Brackets',
            '{': 'Braces',
            '"': 'Quotes',
            "'": 'Quotes'
        };
        for (let char in bookends) {
            if (text.includes(char)) return `[Space] Select inside ${bookends[char]}`;
        }
        return null;
    }

    let hint = "";
    if (!isPivotMode) {
        let hintStr = getContextualHint(currentTargetElement);
        if (hintStr) {
            hint = `<div style="font-size: 11px; color: #60a5fa; margin-top: 4px;">${hintStr}</div>`;
        }
    } else {
        hint = `<div style="font-size: 11px; color: #f59e0b; margin-top: 4px;">[Space] Back to regular zoom</div>`;
    }

    const themeColor = getActiveThemeColor();

    frozenRanges.forEach(el => {
      let rects = el.getClientRects(); 
      Array.from(rects).forEach(rect => {
          const box = document.createElement('div');
          box.className = 'highlight-active';
          box.style.cssText = `top: ${rect.top + window.scrollY}px; left: ${rect.left + window.scrollX}px; width: ${rect.width}px; height: ${rect.height}px; background-color: ${hexToRgba('#10b981', 0.2)}; border: 2px dashed #10b981; position: absolute; pointer-events: none;`;
          overlayContainer.appendChild(box);
      });
    });

    if (currentTargetElement) {
      let rects = getTargetRects(currentTargetElement);
      rects.forEach(rect => {
        if (rect.width === 0 || rect.height === 0) return;
        const box = document.createElement('div');
        box.style.cssText = `
          position: absolute;
          top: ${rect.top}px;
          left: ${rect.left}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          background-color: ${hexToRgba(themeColor, 0.3)};
          border: 2px solid ${themeColor};
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
        ${modeDisplay}  
        ${settings.outputFormat === 'COMBINED' ? 'Combined' : decorationLabels[settings.lineDecoration]} ${styleOption ? `${styleOption}` : ''}
      </div>
      <pre>${escapeHtml(compileOutput()) || '...'}</pre>
      ${hint}
    `;
  }

  function escapeHtml(str) { return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

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
    return current;
  }
  
  // --- SELECTION & ZOOM LOGIC ---
  function evaluateMouseCoords(clientX, clientY) {
    if (!shadowHost) return;
    
    shadowHost.style.visibility = 'hidden'; 
    const el = getDeepElementFromPoint(clientX, clientY);
    shadowHost.style.visibility = 'visible';

    if (!el) return;

    let currentZoomLevel = (currentTargetElement instanceof Range) ? currentTargetElement.textZoomLevel : 0;
    if (currentZoomLevel > 0) {
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
            let newRange = getGranularRange(targetNode, offset, currentZoomLevel);
            // FIX: Gracefully fallback to level 1 word-tracking if level 2 bookends aren't present
            if (!newRange && currentZoomLevel === 2) {
                newRange = getGranularRange(targetNode, offset, 1);
            }
            if (newRange) {
                if (settings.trackingMode === 'MULTI_SNIP' && isCollidingWithFrozen(newRange)) return;

                if (!currentTargetElement || currentTargetElement.toString() !== newRange.toString()) {
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
      zoomHistory = []; 
      currentTargetElement = current;
      updateUI();
    }
  }

  function handleZoom(direction) {
    if (!currentTargetElement) return;

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

      if (currentTargetElement instanceof Range) {
        let level = currentTargetElement.textZoomLevel;
        if (level >= 2) {
            let offset = currentTargetElement.startOffset;
            currentTargetElement = getGranularRange(currentTargetElement.commonAncestorContainer, offset, level - 1) || currentTargetElement.commonAncestorContainer;
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
        let currentLevel = currentTargetElement instanceof Range ? currentTargetElement.textZoomLevel : 0;

        if (currentLevel < 2) {
            let offset = -1;
            if (document.caretRangeFromPoint) {
                const caret = document.caretRangeFromPoint(lastMouseX, lastMouseY);
                if (caret && caret.startContainer === targetNode) {
                    offset = caret.startOffset;
                } else if (caret && caret.startContainer.nodeType === Node.TEXT_NODE && targetNode.contains && targetNode.contains(caret.startContainer)) {
                    targetNode = caret.startContainer;
                    offset = caret.startOffset;
                }
            }
            if (offset !== -1) {
                const newRange = getGranularRange(targetNode, offset, currentLevel + 1);
                if (newRange) {
                    zoomHistory.push(currentTargetElement);
                    currentTargetElement = newRange;
                    updateUI();
                    return;
                }
            } else if (currentTargetElement.nodeType === Node.TEXT_NODE) {
                const newRange = getGranularRange(targetNode, Math.floor(targetNode.nodeValue.length / 2), currentLevel + 1);
                if (newRange) {
                   zoomHistory.push(currentTargetElement);
                   currentTargetElement = newRange;
                   updateUI();
                   return;
                }
            }
        }
        // FIX: Prevent falling through to macro child node scanning if already maxed out at granular ranges
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
        
        isPivotMode = !isPivotMode;
        if (isPivotMode) snapToNearestBookend();
        updateUI();
        return;
    }

    if (e.type === 'mousemove') {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        evaluateMouseCoords(e.clientX, e.clientY);
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
      else if (e.button === 2 && settings.trackingMode === 'MULTI_SNIP') {
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
          isPivotMode = !isPivotMode;
          if (isPivotMode) snapToNearestBookend();
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
      }
    }
  }

  // --- LIFECYCLE ---
  function loadSettings(cb) {
    try {
      chrome.storage.local.get(settings, (res) => {
        if (res) Object.assign(settings, res);
        if (cb) cb();
      });
    } catch (e) { if (cb) cb(); }
  }

  function saveSettings() {
    try {
      chrome.storage.local.set(settings);
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', data: settings }).catch(() => {});
    } catch (e) {}
  }

  const captureEvents = ['mousedown', 'mouseup', 'click', 'contextmenu', 'mousemove', 'keydown', 'wheel'];
  
  function startSelectionMode(x, y) {
    isSelectionMode = true;
	isPivotMode = false;
    frozenRanges = [];
    currentTargetElement = null;
    zoomHistory = [];
    initShadowDOM();
    
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    
    captureEvents.forEach(evt => window.addEventListener(evt, handleGlobalCapture, { capture: true, passive: false }));
    loadSettings(() => evaluateMouseCoords(x, y));
  }

  function exitSelectionMode() {
    isSelectionMode = false;
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
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