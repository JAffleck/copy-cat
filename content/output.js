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
    commitText(compileOutput());
  }

  // Copy the given text to the clipboard and exit selection mode with a confirmation toast
  function commitText(text) {
    if (!text) return exitSelectionMode();

    navigator.clipboard.writeText(text).then(() => {
      updateUI("😸 Text Copied! 😸");
      setTimeout(exitSelectionMode, 800);
    }).catch(err => {
      updateUI("❌ Clipboard Error ❌");
      setTimeout(exitSelectionMode, 1500);
    });
  }
