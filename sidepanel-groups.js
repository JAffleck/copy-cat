// Copy Cat side panel: saved form groups (Fill into the form you last clicked in / Rename / Delete).
(function () {
  const section = document.getElementById('groups-section');
  const listEl = document.getElementById('groups');
  const statusEl = document.getElementById('status');

  function status(msg) { statusEl.textContent = msg; setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, 4000); }
  function send(msg) { return chrome.runtime.sendMessage(msg).catch(err => ({ ok: false, reason: String(err) })); }
  function button(label, title, onClick) {
    const b = document.createElement('button');
    b.textContent = label; b.title = title; b.addEventListener('click', onClick);
    return b;
  }

  function render(groups) {
    section.hidden = groups.length === 0;
    listEl.textContent = '';
    for (const g of groups) {
      const li = document.createElement('li');
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = '🧾 ' + g.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${g.fields.length} fields · ${g.site || ''}`;
      meta.title = g.fields.map(f => `${f.label || f.name || f.type}: ${f.tag === 'SELECT' ? (f.text || f.value) : f.type === 'checkbox' || f.type === 'radio' ? (f.checked ? 'checked' : 'unchecked') : f.value}`).join('\n');
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(
        button('Fill', 'Fill the form you last clicked in, in the current tab', async () => {
          status('Filling…');
          const res = await send({ type: 'FILL_GROUP_ENTRY', id: g.id });
          status(res && res.ok ? `Filled ${res.filled} of ${res.total}${res.problems && res.problems.length ? ' (some skipped)' : ''}` : (res && res.reason) || 'Could not fill');
        }),
        button('Rename', 'Rename this group', () => {
          const name = prompt('Group name', g.name);
          if (name && name.trim()) send({ type: 'GROUP_RENAME', id: g.id, name: name.trim() });
        }),
        button('Delete', 'Delete this group', () => send({ type: 'GROUP_DELETE', id: g.id }))
      );
      li.append(text, meta, actions);
      listEl.appendChild(li);
    }
  }

  window.copyCatPanelSections = window.copyCatPanelSections || [];
  window.copyCatPanelSections.push({ load() { chrome.storage.local.get({ formGroups: [] }, r => render(r.formGroups || [])); } });
  document.addEventListener('DOMContentLoaded', () => chrome.storage.local.get({ formGroups: [] }, r => render(r.formGroups || [])));
})();
