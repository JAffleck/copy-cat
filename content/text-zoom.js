// Copy Cat content script: Granular text zoom steps: bracket phrase, word, snake/kebab segment.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

  // --- DRILL-THROUGH HELPER ---
  // Get the deepest element at a point, preferring the parent of the text node at caret
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
  // Zoom hierarchy (Element Zoom):
  //   Element → Text node → Bookend phrase (level 2) → Nested bookend → Word (level 1) → Segment (level 2)
  //   Zoom-out reverses via zoomHistory stack.
  //   level 0 = text node, level 1 = word, level 2+ = delimiter-enclosed phrase
  // --- GRANULAR TEXT ZOOM HELPERS ---
  // Zoom hierarchy: Bookend phrase → Word (including snake_case) → Segment (split on _/-)
  // Each zoom-in tries the next step in order; zoom-out pops zoomHistory.

  // Step 1: Find nearest enclosing paired delimiter within [boundStart, boundEnd)
  // Find the nearest enclosing pair of delimiters (quotes, brackets, etc.) around an offset within bounds
  function getBookendRange(textNode, offset, boundStart, boundEnd) {
    const text = textNode.nodeValue || "";
    const PAIRS = {
      '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{',
      '"': '"', "'": "'",
      '\u201C': '\u201D', '\u201D': '\u201C',
      '\u2018': '\u2019', '\u2019': '\u2018',
      '\u00AB': '\u00BB', '\u00BB': '\u00AB'
    };
    let start = boundStart, end = boundEnd, leftChar = '';
    for (let i = offset - 1; i >= boundStart; i--) {
      if (PAIRS[text[i]] !== undefined) { start = i + 1; leftChar = text[i]; break; }
    }
    if (!leftChar) return null;
    const matchChar = PAIRS[leftChar];
    let found = false;
    for (let i = offset; i < boundEnd; i++) {
      if (text[i] === matchChar) { end = i; found = true; break; }
    }
    if (!found) return null;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start >= end) return null;
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    range.textZoomLevel = 1;
    // Store open/close character positions for X-toggle rect calculation
    range._openNode = textNode;
    range._openOffset = start - 1;  // position of the opening delimiter
    range._closeNode = textNode;
    range._closeOffset = end;       // position of the closing delimiter
    return range;
  }

  // Step 2: Find word within [boundStart, boundEnd)
  // Find a word boundary around an offset within bounds (includes accented chars, hyphens)
  function getWordRange(textNode, offset, boundStart, boundEnd) {
    const text = textNode.nodeValue || "";
    const wordBoundaries = /[^\w\-\u00C0-\u017F]/;
    let start = offset, end = offset;
    while (start > boundStart && !wordBoundaries.test(text[start - 1])) start--;
    while (end < boundEnd && !wordBoundaries.test(text[end])) end++;
    const match = text.substring(start, end).replace(/^[-]+|[-]+$/g, '');
    if (!match) return null;
    const actualStart = start + text.substring(start, end).indexOf(match);
    const range = document.createRange();
    range.setStart(textNode, actualStart);
    range.setEnd(textNode, actualStart + match.length);
    range.textZoomLevel = 2;
    return range;
  }

  // Step 3: Split snake_case or kebab-case within [boundStart, boundEnd)
  // Split a snake_case or kebab-case identifier into a segment at cursor position
  function getSegmentRange(textNode, offset, boundStart, boundEnd) {
    const text = textNode.nodeValue || "";
    const splitters = ['_', '-'];
    let start = boundStart, end = boundEnd;
    let hasSplitter = false;
    for (let i = offset - 1; i >= boundStart; i--) {
      if (splitters.includes(text[i])) { start = i + 1; hasSplitter = true; break; }
    }
    for (let i = offset; i < boundEnd; i++) {
      if (splitters.includes(text[i])) { end = i; hasSplitter = true; break; }
    }
    if (!hasSplitter) return null;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start >= end) return null;
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    range.textZoomLevel = 3;
    return range;
  }

  // Try next zoom step: bookend → word → segment (first narrower contained result wins)
  // Try each zoom-in step (bookend → word → segment); return the first narrower match
  function getNextZoomRange(textNode, offset, currentRange) {
    const curLen = currentRange ? currentRange.toString().length : textNode.nodeValue.length;
    const bStart = currentRange ? currentRange.startOffset : 0;
    const bEnd = currentRange ? currentRange.endOffset : textNode.nodeValue.length;
    const steps = [getBookendRange, getWordRange, getSegmentRange];
    for (let fn of steps) {
      const newRange = fn(textNode, offset, bStart, bEnd);
      if (newRange && newRange.toString().length < curLen) {
        if (!currentRange || (newRange.compareBoundaryPoints(Range.START_TO_START, currentRange) >= 0 &&
            newRange.compareBoundaryPoints(Range.END_TO_END, currentRange) <= 0)) {
          return newRange;
        }
      }
    }
    return null;
  }
