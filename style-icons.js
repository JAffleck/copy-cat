// Copy Cat: SVG icons for the copy styles, shared by the popup and the in-page preview (content
// script). Combined, Raw, Numbers and Bullets are Material Symbols paths (Apache 2.0, see
// THIRD_PARTY_NOTICES.md); the quote/bracket marks are drawn here. All icons use currentColor.

// Wrap styles cycled with Q: [open, close]
const QUOTE_PAIRS = [['"', '"'], ["'", "'"], ['`', '`'], ['(', ')'], ['[', ']'], ['{', '}']];

const STYLE_ICON_PATHS = {
  combined: 'M7,17h7V15H7v2Zm0-4H17V11H7v2ZM7,9H17V7H7V9ZM5,21q-0.83,0-1.41-0.59T3,19V5Q3,4.17 3.59,3.59T5,3H19q0.83,0 1.41,0.59T21,5V19q0,0.82-0.59,1.41T19,21H5Zm0-2H19V5H5V19ZM5,5V19V5Z',
  raw: 'M3,18V16H21v2H3Zm0-5V11H21v2H3ZM3,8V6H21V8H3Z',
  csvLines: 'M3,18V16H19.2v2H3Zm0-5V11H19.2v2H3ZM3,8V6H19.2V8H3Z',   // raw lines, 10% shorter
  numbers: 'M3,22V20.5H5.5V19.75H4v-1.5H5.5V17.5H3V16H6q0.43,0 0.71,0.29T7,17v1q0,0.43-0.29,0.71T6,19q0.43,0 0.71,0.29T7,20v1q0,0.43-0.29,0.71T6,22H3Zm0-7V12.25q0-0.43 0.29-0.71T4,11.25H5.5V10.5H3V9H6Q6.43,9 6.71,9.29T7,10v1.75q0,0.42-0.29,0.71T6,12.75H4.5V13.5H7V15H3ZM4.5,8V3.5H3V2H6V8H4.5ZM9,19V17H21v2H9Zm0-6V11H21v2H9ZM9,7V5H21V7H9Z',
  bullets: 'M9,19V17H21v2H9Zm0-6V11H21v2H9ZM9,7V5H21V7H9ZM5,20q-0.83,0-1.41-0.59T3,18t0.59-1.41T5,16t1.41,0.59Q7,17.18 7,18T6.41,19.41T5,20Zm0-6q-0.83,0-1.41-0.59T3,12t0.59-1.41T5,10t1.41,0.59Q7,11.18 7,12T6.41,13.41T5,14ZM3.59,7.41Q3,6.82 3,6T3.59,4.59T5,4T6.41,4.59Q7,5.18 7,6T6.41,7.41T5,8T3.59,7.41Z'
};

// A curly closing quote mark (”, a "9" shape) around (0,0); the opening mark (“) is it rotated 180°
const QUOTE_MARK_PATH = 'M2.2,0C2.2,2.8 0.8,4.6 -1.4,5.4L-1.9,4.5C-0.6,3.8 0.2,3 0.3,2.1A2.2,2.2 0 1,1 2.2,0Z';

function quoteMark(x, y, opening, scale = 1) {
  return `<path transform="translate(${x} ${y}) rotate(${opening ? 180 : 0}) scale(${scale})" d="${QUOTE_MARK_PATH}"/>`;
}

function strokePath(d) {
  return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Glyphs for each wrap style (index into QUOTE_PAIRS)
function wrapGlyph(quoteIndex) {
  switch (quoteIndex) {
    case 1:  // single quotes: one mark each side
      return quoteMark(5.5, 12.5, true) + quoteMark(18.5, 9.3, false);
    case 2:  // backquote: a grave accent each side
      return strokePath('M5.5,7.5 L8.5,12') + strokePath('M15.5,7.5 L18.5,12');
    case 3:  // parentheses
      return strokePath('M9,4 Q4.5,12 9,20') + strokePath('M15,4 Q19.5,12 15,20');
    case 4:  // brackets
      return strokePath('M9,4 H5.5 V20 H9') + strokePath('M15,4 H18.5 V20 H15');
    case 5:  // curly braces
      return strokePath('M9.5,4 Q7,4 7,6.5 V9.5 Q7,12 4.5,12 Q7,12 7,14.5 V17.5 Q7,20 9.5,20') +
             strokePath('M14.5,4 Q17,4 17,6.5 V9.5 Q17,12 19.5,12 Q17,12 17,14.5 V17.5 Q17,20 14.5,20');
    default: // double quotes: a pair each side
      return quoteMark(3.4, 12.5, true) + quoteMark(8, 12.5, true) +
             quoteMark(16, 9.3, false) + quoteMark(20.6, 9.3, false);
  }
}

// Inner SVG markup for a style. kind: COMBINED | RAW | QUOTED | QUOTED_COMMA | CSV | NUMBERED | BULLETED
function styleIconInner(kind, quoteIndex = 0) {
  const p = d => `<path d="${d}"/>`;
  switch (kind) {
    case 'COMBINED': return p(STYLE_ICON_PATHS.combined);
    case 'QUOTED': return wrapGlyph(quoteIndex);
    case 'QUOTED_COMMA':  // the quote marks, then a comma
      return `<g transform="translate(-1.2 -1) scale(0.86)">${wrapGlyph(quoteIndex)}</g>` + quoteMark(21, 17.4, false, 0.72);
    case 'CSV':           // shorter lines, a comma after each line but the last
      return p(STYLE_ICON_PATHS.csvLines) + quoteMark(21.3, 7.3, false, 0.55) + quoteMark(21.3, 12.3, false, 0.55);
    case 'NUMBERED': return p(STYLE_ICON_PATHS.numbers);
    case 'BULLETED': return p(STYLE_ICON_PATHS.bullets);
    default: return p(STYLE_ICON_PATHS.raw);
  }
}

function styleIconSvg(kind, quoteIndex = 0, size = 16) {
  return `<svg class="style-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${styleIconInner(kind, quoteIndex)}</svg>`;
}

// Icon kind for the current settings (Combined overrides the line style)
function styleKindFor(settings) {
  return settings.outputFormat === 'COMBINED' ? 'COMBINED' : (settings.lineDecoration || 'RAW');
}

// Copy Cat's "copied" icon: a copy-file icon (back sheet + front sheet) with a cat face on the front
// sheet; eyes are cut out (even-odd). Used in place of the 😸 emoji in the copied toasts.
// The sheets use currentColor; the cat is the main color of the cat in the extension icon.
const COPY_CAT_COLOR = '#e8b57c';
function copyCatIconSvg(size = 18) {
  return `<svg class="copy-cat-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    '<path d="M4.5,7.5 V19.5 A1.5,1.5 0 0 0 6,21 H15.5"/>' +
    '<rect x="8" y="2.5" width="12" height="16" rx="1.5"/>' +
    `<path stroke="none" fill="${COPY_CAT_COLOR}" fill-rule="evenodd" d="M10.8,14 V7.6 L12.7,9.4 H15.3 L17.2,7.6 V14 Q17.2,16.2 14,16.2 Q10.8,16.2 10.8,14 Z` +
    ' M12.8,12.3 m-0.7,0 a0.7,0.7 0 1,0 1.4,0 a0.7,0.7 0 1,0 -1.4,0 Z M15.2,12.3 m-0.7,0 a0.7,0.7 0 1,0 1.4,0 a0.7,0.7 0 1,0 -1.4,0 Z"/>' +
    '</svg>';
}
