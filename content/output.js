// Copy Cat content script: Formatting the copied output and writing it to the clipboard.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

  // --- FORMATTING COMPILER ---
  // Compile frozen + active selections into formatted clipboard output respecting line decorations
  function compileOutput() {
    let elements = [...frozenRanges];
    if (currentTargetElement && !elements.includes(currentTargetElement)) {
      elements.push(currentTargetElement);
    }
  
    const isZoomedIn = zoomHistory.length > 0;
    const [qOpen, qClose] = QUOTE_PAIRS[settings.quoteIndex] || QUOTE_PAIRS[0];
    // Escape the quote char inside symmetric quotes ("a \"b\" c"); brackets are left alone
    const escQ = (t) => qOpen === qClose ? t.split(qOpen).join('\\' + qOpen) : t;
    const bChar = STYLE_BULLETS[settings.bulletIndex];
    const oChar = STYLE_OUTLINES[settings.outlineIndex];
  
    let rawBlocks = elements.map(el => {
      const isSelect = el.tagName && el.tagName.toUpperCase() === 'SELECT';
      const shouldShowList = isZoomedIn && isSelect && el === currentTargetElement;
      
      if (isZoomedIn && isSelect && el !== currentTargetElement && currentTargetElement && currentTargetElement.tagName === 'SELECT') {
        return ""; 
      }
      
      return stripInvisible(getCleanText(el, shouldShowList)).trim();
    }).filter(Boolean);
  
    let formattedLines = [];
  
    rawBlocks.forEach((blockText, bIndex) => {
      let lines = blockText.split('\n').map(l => l.trim()).filter(Boolean);
  
      if (settings.outputFormat === 'COMBINED') {
        let flat = lines.join(' ').replace(/\s+/g, ' ');
        formattedLines.push(`${qOpen}${escQ(flat)}${qClose}`);
      } else {
        let blockResult = lines.map((line, lIndex) => {
          const escaped = escQ(line);
          const isLastItem = (bIndex === rawBlocks.length - 1 && lIndex === lines.length - 1);
  
          switch (settings.lineDecoration) {
            case 'QUOTED': return `${qOpen}${escaped}${qClose}`;
            case 'QUOTED_COMMA': return `${qOpen}${escaped}${qClose}${isLastItem ? '' : ','}`;
            case 'CSV': return `${line}${isLastItem ? '' : ','}`;
            case 'NUMBERED': return `${outlineMarker(oChar, lIndex + 1)} ${line}`;
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

  // Numbering marker for item n (1-based): "1." → "n.", "A." / "a." → A…Z, AA, AB… (lowercase for
  // "a."), "i." → lowercase roman numerals (correct up to 3999; past that, the number)
  function outlineMarker(style, n) {
    if (style === 'A.' || style === 'a.') {
      let s = '';
      for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + (k - 1) % 26) + s;
      return (style === 'a.' ? s.toLowerCase() : s) + '.';
    }
    if (style === 'i.' || style === 'I.') {
      if (n < 1 || n > 3999) return n + '.';
      const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
        [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
      let s = '';
      for (const [v, r] of table) while (n >= v) { s += r; n -= v; }
      return (style === 'i.' ? s.toLowerCase() : s) + '.';
    }
    return n + '.';
  }

  // Copy compiled output to clipboard and exit selection mode with a confirmation toast.
  // History: in Multi-snip each item is recorded too (then the combined copy, which ends on top);
  // nothing is recorded if any part came from a password/card field.
  function commitCopy() {
    const elements = [...frozenRanges];
    if (currentTargetElement && !elements.includes(currentTargetElement)) elements.push(currentTargetElement);
    const secret = elements.some(el => isSecretField(elementOf(el)));
    const items = elements.length > 1 ? elements.map(el => stripInvisible(getCleanText(el)).trim()).filter(Boolean) : [];
    commitText(compileOutput(), { items, record: !secret });
  }

  // Copy the given text to the clipboard and exit selection mode with a confirmation toast
  function commitText(text, opts = {}) {
    text = stripInvisible(text || '');
    if (!text) return exitSelectionMode();

    navigator.clipboard.writeText(text).then(() => {
      if (opts.record !== false) recordHistory([...(opts.items || []), text]);
      updateUI(copyCatIconSvg(18) + '<span>Text Copied!</span>');
      setTimeout(exitSelectionMode, 800);
    }).catch(err => {
      updateUI("❌ Clipboard Error ❌");
      setTimeout(exitSelectionMode, 1500);
    });
  }
