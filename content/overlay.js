// Copy Cat content script: Overlay UI: shadow DOM, highlight rects/boxes, theme colors, updateUI preview.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

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

  // Rects to paint for a target (drawing only; hit-testing keeps using getTargetRects).
  // Elements with visible text are painted on their text lines, not their whole box, so the
  // highlight sits on the characters like a marker. Text-less elements (img, input, svg) use
  // their box.
  function getHighlightRects(target) {
    if (!target) return [];
    if (target instanceof Range || target.nodeType === Node.TEXT_NODE) return getTargetRects(target);
    if (target.nodeType === Node.ELEMENT_NODE) {
      const tag = target.tagName.toUpperCase();
      if (!['INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'SVG', 'VIDEO', 'CANVAS'].includes(tag) &&
          (target.textContent || '').trim()) {
        const range = document.createRange();
        range.selectNodeContents(target);
        const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
        if (rects.length) return rects;
      }
    }
    return getTargetRects(target);
  }

  const HIGHLIGHT_ALPHA = 0.2;     // highlighter fill opacity for all selections
  const FROZEN_COLOR = '#10b981';  // Multi-snip frozen selections (green)

  // Build one highlighter block (no border, translucent fill, 1px vertical bleed like a marker)
  function makeHighlightBox(rect, color) {
    const box = document.createElement('div');
    box.style.cssText = `position: absolute; top: ${rect.top - 1}px; left: ${rect.left}px; ` +
      `width: ${rect.width}px; height: ${rect.height + 2}px; ` +
      `background-color: ${hexToRgba(color, HIGHLIGHT_ALPHA)}; border: none; border-radius: 2px; ` +
      `pointer-events: none; transition: all 0.05s ease-out;`;
    return box;
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

    if (identifyMode) { renderIdentify(toast); return; }

    let hint = "";
    if (zoomMode === 'ELEMENT_ZOOM') {
        hint = `<div style="font-size: 11px; color: #60a5fa; margin-top: 4px;">[Space] Zoom into surrounding brackets/quotes</div>`;
    } else {
        hint = `<div style="font-size: 11px; color: #f59e0b; margin-top: 4px;">[Space] Back to element zoom</div>`;
    }

    // Text-less selection copied by name (image, icon, empty field): say where the name came from
    const selEl = currentTargetElement && !(currentTargetElement instanceof Range) &&
      currentTargetElement.nodeType === Node.ELEMENT_NODE ? currentTargetElement : null;
    if (selEl && !visibleTextOf(selEl) && isNameCandidate(selEl)) {
      const named = getBestName(selEl);
      if (named) hint += `<div style="font-size: 11px; color: #a1a1aa; margin-top: 2px;">Name from ${escapeHtml(named.source)} · [N] all names</div>`;
    }

    const themeColor = getActiveThemeColor();

    frozenRanges.forEach(el => {
      mergeRects(getHighlightRects(el)).forEach(rect => {
        if (rect.width === 0 || rect.height === 0) return;
        overlayContainer.appendChild(makeHighlightBox(rect, FROZEN_COLOR));
      });
    });

    if (currentTargetElement) {
      mergeRects(getHighlightRects(currentTargetElement)).forEach(rect => {
        if (rect.width === 0 || rect.height === 0) return;
        overlayContainer.appendChild(makeHighlightBox(rect, themeColor));
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
      'RAW': 'Raw', 'QUOTED': 'Quotes', 'QUOTED_COMMA': 'Quotes + commas',
      'CSV': 'CSV', 'NUMBERED': 'Numbers', 'BULLETED': 'Bullets'
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

  // Identify view: numbered list of the selected element's names (1–9 copy, N/Esc back)
  function renderIdentify(toast) {
    const el = currentTargetElement ? elementOf(currentTargetElement) : null;
    const names = el ? getElementNames(currentTargetElement).slice(0, 9) : [];
    const tag = el ? `&lt;${el.tagName.toLowerCase()}&gt;` : '';
    const rows = names.length
      ? names.map((n, i) => `<div style="display:flex; gap:8px; padding:2px 0; border-bottom:1px solid #27272a;">
          <span style="color:#a1a1aa; width:14px; flex-shrink:0;">${i + 1}</span>
          <span style="color:#60a5fa; width:86px; flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(n.source)}</span>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(n.text)}">${escapeHtml(n.text)}</span>
        </div>`).join('')
      : `<div style="color:#a1a1aa; padding:4px 0;">${el ? 'No names found' : 'Nothing selected'}</div>`;
    toast.style.display = 'block';
    toast.innerHTML = `
      <div style="font-size: 12px; margin-bottom: 8px; border-bottom: 1px solid #3f3f46; padding-bottom: 4px;">
        <strong>🔍 Identify</strong> ${tag}
      </div>
      <div style="font-size: 12px;">${rows}</div>
      <div style="font-size: 11px; color: #60a5fa; margin-top: 6px;">[1–9] Copy · [Click] Copy 1 · [N / Esc] Back</div>
    `;
  }

  // Escape HTML special characters for safe rendering in the preview toast
  function escapeHtml(str) { return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
