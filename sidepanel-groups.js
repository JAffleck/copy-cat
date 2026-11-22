// Copy Cat side panel: saved form groups. Header: name + rename (edit icon) + delete icon.
// Actions: Fill (into the form you last clicked in), Edit fields (copy one value / remove a field).
(function () {
  const expanded = new Set();        // group ids with the field editor open (kept across redraws)
  let renaming = null;               // group id being renamed
  const section = document.getElementById('groups-section');
  const listEl = document.getElementById('groups');
  const statusEl = document.getElementById('status');
  let lastGroups = [];

  function status(msg) { statusEl.textContent = msg; setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, 4000); }
  function send(msg) { return chrome.runtime.sendMessage(msg).catch(err => ({ ok: false, reason: String(err) })); }
  function button(label, title, onClick) {
    const b = document.createElement('button');
    b.textContent = label; b.title = title; b.addEventListener('click', onClick);
    return b;
  }

  // Same as groupFieldFingerprint in groups-core.js (background side)
  function fingerprint(f) {
    return [f.label || f.name || f.autocomplete || f.type, f.value, f.text || '', f.checked ? '1' : '0'].join('\u0001');
  }
  function fieldLabel(f) { return f.label || f.name || f.autocomplete || f.type; }
  // Text shown and copied for a saved field
  function fieldValue(f) {
    if (f.tag === 'SELECT') return f.text || f.value;
    if (f.type === 'checkbox' || f.type === 'radio') return f.checked ? 'checked' : 'unchecked';
    return f.value;
  }
  // First filled text values, for the card's subtitle
  function preview(g) {
    return g.fields.filter(f => f.tag !== 'SELECT' && f.type !== 'checkbox' && f.type !== 'radio' && (f.value || '').trim())
      .slice(0, 3).map(f => f.value.trim()).join(', ');
  }

  function fieldRows(g) {
    const box = document.createElement('div');
    box.className = 'fields';
    if (!g.fields.length) {
      box.innerHTML = '<div class="nofields">No fields left — rename or delete this group</div>';
      return box;
    }
    g.fields.forEach((f, index) => {
      const row = document.createElement('div');
      row.className = 'field';
      if (f.type === 'radio' && !f.checked) { row.classList.add('inactive'); row.title = 'Unselected choice — not filled'; }
      const lab = document.createElement('span');
      lab.className = 'flabel';
      lab.textContent = fieldLabel(f);
      lab.title = fieldLabel(f);
      const val = document.createElement('span');
      val.className = 'fvalue';
      const v = fieldValue(f);
      val.textContent = v === '' ? '(empty)' : (f.type === 'radio' ? `${f.value} (${v})` : v);
      val.title = f.tag === 'SELECT' ? `${f.text} — value: ${f.value}` : v;
      row.append(lab, val,
        button('Copy', 'Copy this value', async () => {
          try { await navigator.clipboard.writeText(f.type === 'radio' ? f.value : v); status(`Copied: ${fieldLabel(f)}`); }
          catch (err) { status('Clipboard error'); }
        }),
        iconButton('delete', 'Remove this field from the group (it will not be filled)', () => {
          send({ type: 'GROUP_REMOVE_FIELD', id: g.id, index, fingerprint: fingerprint(f) })
            .then(() => status(`Removed: ${fieldLabel(f)}`));
        }, 'danger'));
      box.appendChild(row);
    });
    return box;
  }

  function nameEditor(g) {
    const input = document.createElement('input');
    input.value = g.name;
    input.setAttribute('aria-label', 'Group name');
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      renaming = null;
      const name = input.value.trim();
      if (save && name && name !== g.name) send({ type: 'GROUP_RENAME', id: g.id, name });
      else render(lastGroups);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return input;
  }

  function render(groups) {
    lastGroups = groups;
    section.hidden = groups.length === 0;
    listEl.textContent = '';
    for (const g of groups) {
      const li = document.createElement('li');
      const head = document.createElement('div');
      head.className = 'ghead';
      if (renaming === g.id) {
        head.appendChild(nameEditor(g));
      } else {
        const name = document.createElement('span');
        name.className = 'gname text';
        name.textContent = '🧾 ' + g.name;
        name.title = g.name;
        head.appendChild(name);
        head.append(
          iconButton('edit', 'Rename this group', () => { renaming = g.id; render(lastGroups); }),
          iconButton('delete', 'Delete this group', () => send({ type: 'GROUP_DELETE', id: g.id }), 'danger'));
      }
      const meta = document.createElement('div');
      meta.className = 'meta';
      const pv = preview(g);
      meta.textContent = `${g.fields.length} fields · ${g.site || ''}${pv ? ' · ' + pv : ''}`;
      meta.title = g.fields.map(f => `${fieldLabel(f)}: ${fieldValue(f)}`).join('\n');
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(
        button('Fill', 'Fill the form you last clicked in, in the current tab', async () => {
          status('Filling…');
          const res = await send({ type: 'FILL_GROUP_ENTRY', id: g.id });
          status(res && res.ok ? `Filled ${res.filled} of ${res.total}${res.problems && res.problems.length ? ' (some skipped)' : ''}` : (res && res.reason) || 'Could not fill');
        }),
        button(expanded.has(g.id) ? 'Done' : 'Edit fields', 'Show the saved fields: copy one value or remove a field', () => {
          if (expanded.has(g.id)) expanded.delete(g.id); else expanded.add(g.id);
          render(lastGroups);
        })
      );
      li.append(head, meta, actions);
      if (expanded.has(g.id)) li.appendChild(fieldRows(g));
      listEl.appendChild(li);
    }
  }

  const load = () => { if (!renaming) chrome.storage.local.get({ formGroups: [] }, r => render(r.formGroups || [])); };
  window.copyCatPanelSections = window.copyCatPanelSections || [];
  window.copyCatPanelSections.push({ load });
  document.addEventListener('DOMContentLoaded', load);
})();
