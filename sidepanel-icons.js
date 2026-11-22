// Copy Cat side panel: Material icons (Apache 2.0, see THIRD_PARTY_NOTICES.md) and an icon button helper.
const PANEL_ICONS = {
  edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  delete: '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  close: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
  x: '<path d="M6.4,19L5,17.6L10.6,12L5,6.4L6.4,5L12,10.6L17.6,5L19,6.4L13.4,12L19,17.6L17.6,19L12,13.4L6.4,19Z"/>',
  // content_copy, modified: diagonal joins from the front sheet's top-left and bottom-right corners to
  // the nearest ends of the back sheet's "L", so the two read as one stacked sheet
  copy: '<path d="M9,18q-0.82,0-1.41-0.59T7,16V4Q7,3.17 7.59,2.59T9,2h9q0.82,0 1.41,0.59T20,4V16q0,0.82-0.59,1.41T18,18H9Zm0-2h9V4H9V16ZM5,22q-0.83,0-1.41-0.59T3,20V6H5V20H16v2H5Zm4-6V4V16Z"/>' +
    '<path d="M4,6 L8,3 M16,21 L19,17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
};

function iconButton(name, title, onClick, extraClass = '') {
  const b = document.createElement('button');
  b.className = ('icon-btn ' + extraClass).trim();
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${PANEL_ICONS[name]}</svg>`;
  b.addEventListener('click', onClick);
  return b;
}
