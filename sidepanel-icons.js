// Copy Cat side panel: Material icons (Apache 2.0, see THIRD_PARTY_NOTICES.md) and an icon button helper.
const PANEL_ICONS = {
  edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  delete: '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  close: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>'
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
