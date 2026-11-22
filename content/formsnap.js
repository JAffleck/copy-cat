// Copy Cat content script: form groups. S (in selection mode) saves the fields inside the selection
// as a named group; Alt+click a field → "Saved groups" → preview → Enter fills the form one field
// at a time (country before state, waits for dependent option lists, final re-check pass).
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

  const FORM_SKIP_TYPES = ['hidden', 'submit', 'button', 'reset', 'file', 'image'];
  const AUTOCOMPLETE_QUALIFIERS = /^(section-.*|shipping|billing|home|work|mobile|fax|pager)$/;
  const OPTION_WAIT_MS = 3000;
  let groupPreview = null;        // { group, plan, field } while the preview panel is open

  // --- field description ---

  function autocompleteToken(el) {
    const tokens = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/)
      .filter(t => t && !AUTOCOMPLETE_QUALIFIERS.test(t));
    const t = tokens.pop() || '';
    return t === 'on' || t === 'off' ? '' : t;
  }

  function normLabel(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, '');
  }

  function fieldLabel(el) {
    const names = getElementNames(el);
    const pick = ['label', 'aria-label', 'labelled by', 'placeholder', 'title'];
    for (const src of pick) {
      const n = names.find(x => x.source === src);
      if (n) return n.text;
    }
    return '';
  }

  function isFillableField(el) {
    if (!el || el.disabled) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT') {
      if (FORM_SKIP_TYPES.includes(el.type) || isSecretField(el)) return false;
    } else if (tag !== 'TEXTAREA' && tag !== 'SELECT') {
      return false;
    }
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
    return true;
  }

  function fieldsIn(container) {
    if (!container || !container.querySelectorAll) return [];
    const own = isFillableField(container) ? [container] : [];
    return own.concat(Array.from(container.querySelectorAll('input, textarea, select')).filter(isFillableField));
  }

  function describeField(el, index) {
    const tag = el.tagName.toUpperCase();
    const d = {
      tag, type: tag === 'INPUT' ? el.type : tag.toLowerCase(),
      autocomplete: autocompleteToken(el), name: el.getAttribute('name') || '', id: el.id || '',
      label: fieldLabel(el), index
    };
    if (tag === 'SELECT') {
      const o = el.options[el.selectedIndex];
      d.value = o ? o.value : ''; d.text = o ? o.text : '';
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      d.checked = el.checked; d.value = el.value;
    } else {
      d.value = el.value;
    }
    return d;
  }

  function isCountry(d) {
    return d.autocomplete === 'country' || d.autocomplete === 'country-name' || /country/i.test(d.name + ' ' + d.id + ' ' + d.label);
  }
  function isRegion(d) {
    return d.autocomplete === 'address-level1' || /\b(state|province|region)\b/i.test(d.name + ' ' + d.id + ' ' + d.label);
  }
  function isStreet1(d) {
    return d.autocomplete === 'address-line1' || d.autocomplete === 'street-address' ||
      /address[-_ ]?(line)?[-_ ]?1|street/i.test(d.name + ' ' + d.id + ' ' + d.label);
  }

  // --- saving (S in selection mode) ---

  function saveFormGroup(target) {
    let container = elementOf(target);
    if (container && isFillableField(container)) container = container.form || container.closest('fieldset') || container.parentElement;
    const els = fieldsIn(container);
    if (!els.length) { updateUI('No form fields in the selection'); setTimeout(() => updateUI(), 1500); return; }
    const fields = els.map(describeField);
    // Default name "Group N" (rename in the side panel); N = highest existing "Group N" + 1
    loadGroups(groups => {
      const n = groups.reduce((max, g) => { const m = /^Group (\d+)$/.exec(g.name || ''); return m ? Math.max(max, +m[1]) : max; }, 0) + 1;
      const group = { name: `Group ${n}`, site: location.hostname, url: location.href, fields };
      try { chrome.runtime.sendMessage({ type: 'GROUP_SAVE', group }).catch(() => {}); } catch (e) {}
      updateUI(`💾 Saved ${escapeHtml(group.name)} — ${fields.length} fields (rename it in the history panel)`);
      setTimeout(exitSelectionMode, 1500);
    });
  }

  // --- matching ---

  // Fields of the form around the clicked field (its <form>, else the nearest ancestor with ≥2 fields)
  function formScopeFor(field) {
    if (field && field.form) return field.form;
    let anc = field ? field.parentElement : null;
    while (anc && anc !== document.body) {
      if (fieldsIn(anc).length >= 2) return anc;
      anc = anc.parentElement;
    }
    return document.body;
  }

  function matchField(saved, targets, used) {
    const free = targets.filter(t => !used.has(t.el));
    if (saved.type === 'radio') {
      return free.find(t => t.d.type === 'radio' && t.d.value === saved.value &&
        ((saved.name && t.d.name === saved.name) || (saved.label && normLabel(t.d.label) === normLabel(saved.label))));
    }
    const sameKind = t => (t.d.tag === 'SELECT') === (saved.tag === 'SELECT') && (t.d.type === 'checkbox') === (saved.type === 'checkbox');
    const tests = [
      t => saved.autocomplete && t.d.autocomplete === saved.autocomplete,
      t => saved.name && t.d.name === saved.name,
      t => saved.id && t.d.id === saved.id,
      t => saved.label && normLabel(t.d.label) === normLabel(saved.label),
    ];
    for (const test of tests) {
      const hit = free.find(t => sameKind(t) && test(t));
      if (hit) return hit;
    }
    return null;
  }

  // Last resort: same position among same-type fields, but only for anonymous targets (no label,
  // name or autocomplete) — a field with its own hints is never taken by position
  function matchByPosition(saved, targets, used) {
    const sameType = targets.filter(t => t.d.type === saved.type);
    const t = sameType[saved.typeIndex];
    if (!t || used.has(t.el)) return null;
    return !t.d.label && !t.d.name && !t.d.autocomplete ? t : null;
  }

  // Pair each saved field with a field in the target form; returns ordered steps + unmatched
  function planFill(group, field) {
    const scope = formScopeFor(field);
    const targets = fieldsIn(scope).map((el, i) => ({ el, d: describeField(el, i) }));
    const typeCount = {};
    const saved = group.fields.map(f => Object.assign({}, f, { typeIndex: (typeCount[f.type] = (typeCount[f.type] || 0) + 1) - 1 }));
    const used = new Set();
    const steps = [], unmatched = [];
    const wanted = saved.filter(s => !(s.type === 'radio' && !s.checked));   // only the chosen radio matters
    // Pass 1: strong keys for every field first, so no field is claimed by position too early
    const pending = [];
    for (const s of wanted) {
      const hit = matchField(s, targets, used);
      if (!hit) { pending.push(s); continue; }
      used.add(hit.el);
      steps.push({ saved: s, el: hit.el, order: targets.indexOf(hit) });
    }
    // Pass 2: position fallback for anonymous fields only
    for (const s of pending) {
      const hit = matchByPosition(s, targets, used);
      if (!hit) { unmatched.push(s); continue; }
      used.add(hit.el);
      steps.push({ saved: s, el: hit.el, order: targets.indexOf(hit) });
    }
    const rank = st => (isCountry(st.saved) ? 0 : isRegion(st.saved) ? 1 : 2);
    steps.sort((a, b) => rank(a) - rank(b) || a.order - b.order);
    return { scope, steps, unmatched };
  }

  // --- filling ---

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

  function displayValue(s) {
    if (s.tag === 'SELECT') return s.text || s.value;
    if (s.type === 'checkbox') return s.checked ? '☑ checked' : '☐ unchecked';
    if (s.type === 'radio') return '◉ ' + (s.label || s.value);
    return s.value === '' ? '(empty)' : s.value;
  }

  function fieldMatchesSaved(el, s) {
    if (s.tag === 'SELECT') { const o = el.options[el.selectedIndex]; return !!o && (o.value === s.value || o.text === s.text); }
    if (s.type === 'checkbox' || s.type === 'radio') return el.checked === !!s.checked;
    return el.value === s.value;
  }

  async function waitForOption(select, s) {
    const has = () => Array.from(select.options).some(o => (s.value && o.value === s.value) || (s.text && o.text === s.text));
    const t0 = Date.now();
    while (!has() && Date.now() - t0 < OPTION_WAIT_MS) await sleep(100);
    return has();
  }

  async function setOne(el, s) {
    if (s.tag === 'SELECT') {
      if (!(await waitForOption(el, s))) return 'option not found';
      if (!selectOptionByText(el, s.value) && !selectOptionByText(el, s.text)) return 'option not found';
      return '';
    }
    if (s.type === 'checkbox' || s.type === 'radio') {
      if (el.checked !== !!s.checked) el.click();
      return '';
    }
    el.focus();
    try { el.select(); } catch (e) {}
    if (s.value === '') {
      setNativeValue(el, '');
      fireInputEvents(el, '');
    } else {
      const res = insertIntoField(el, s.value);
      if (!res.ok) return res.reason;
    }
    if (isStreet1(s)) {       // close address-autocomplete suggestion popups
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }
    el.blur();
    return '';
  }

  // Re-find a step's field if the page re-rendered it
  function liveElement(step, group) {
    if (step.el.isConnected) return step.el;
    const again = planFill({ fields: [step.saved] }, null);
    return again.steps[0] ? again.steps[0].el : null;
  }

  async function fillGroup(group, field) {
    const plan = planFill(group, field);
    const problems = plan.unmatched.map(s => `${s.label || s.name || s.autocomplete || s.type}: no matching field`);
    let filled = 0;
    for (const step of plan.steps) {
      const el = liveElement(step, group);
      if (!el) { problems.push(`${step.saved.label || step.saved.name}: field disappeared`); continue; }
      const err = await setOne(el, step.saved);
      if (err) problems.push(`${step.saved.label || step.saved.name}: ${err}`); else filled++;
      await nextFrame();
      await sleep(50);
    }
    // Final pass: the page may have overwritten something (e.g. a postcode lookup filling the city)
    await sleep(150);
    for (const step of plan.steps) {
      const el = liveElement(step, group);
      if (el && !fieldMatchesSaved(el, step.saved)) { await setOne(el, step.saved); await nextFrame(); }
    }
    return { filled, total: plan.steps.length + plan.unmatched.length, problems };
  }

  // --- preview panel (inside the picker host) ---

  function openGroupPreview(group, field) {
    ensurePickerHost();
    closeGroupPreview();
    const plan = planFill(group, field);
    groupPreview = { group, field };
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const rows = plan.steps.map(st => `<div class="row"><span class="txt">${esc(st.saved.label || st.saved.name || st.saved.autocomplete || st.saved.type)}</span>` +
      `<span class="meta">← ${esc(displayValue(st.saved))}</span></div>`).join('') +
      plan.unmatched.map(s => `<div class="row"><span class="txt" style="color:#f87171">${esc(s.label || s.name || s.type)}</span>` +
      `<span class="meta">no match — skipped</span></div>`).join('');
    const panel = document.createElement('div');
    panel.className = 'panel preview';
    panel.innerHTML = `<div class="head"><span>🧾 Fill “${esc(group.name)}”</span><span>${plan.steps.length}/${plan.steps.length + plan.unmatched.length}</span></div>` +
      `<div style="max-height:260px; overflow:auto">${rows || '<div class="empty">No matching fields in this form</div>'}</div>` +
      `<div class="foot actions"><button class="btn primary" data-act="fill">Fill (Enter)</button>` +
      `<button class="btn" data-act="cancel">Cancel (Esc)</button></div>`;
    panel.addEventListener('mousedown', e => {
      e.preventDefault();             // keep focus in the field
      e.stopPropagation();
      const btn = e.composedPath().find(n => n.dataset && n.dataset.act);
      if (!btn || !groupPreview) return;
      const { group: g, field: f } = groupPreview;
      closeGroupPreview();
      if (btn.dataset.act === 'fill') runFill(g, f);
    });
    pickerRoot.appendChild(panel);
    const r = field ? field.getBoundingClientRect() : { left: innerWidth / 2 - 170, bottom: innerHeight / 3 };
    panel.style.left = Math.max(8, Math.min(r.left, innerWidth - panel.offsetWidth - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - panel.offsetHeight - 8)) + 'px';
  }

  function closeGroupPreview() {
    groupPreview = null;
    if (pickerRoot) pickerRoot.querySelectorAll('.panel.preview').forEach(n => n.remove());
  }

  async function runFill(group, field) {
    const at = field ? field.getBoundingClientRect() : { left: 24, bottom: 24 };
    pickerToast('⏳ Filling…', at.left, at.bottom + 4);
    const res = await fillGroup(group, field);
    const msg = `✅ Filled ${res.filled} of ${res.total} fields` + (res.problems.length ? ` — skipped: ${res.problems.slice(0, 3).join('; ')}` : '');
    pickerToast(msg, at.left, at.bottom + 4, 5000);
    return res;
  }

  window.addEventListener('keydown', (e) => {
    if (!groupPreview) return;
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const { group, field } = groupPreview;
      closeGroupPreview();
      if (e.key === 'Enter') runFill(group, field);
    }
  }, { capture: true });

  window.addEventListener('mousedown', (e) => {
    if (groupPreview && !e.composedPath().includes(pickerHost)) closeGroupPreview();
  }, { capture: true });

  function loadGroups(cb) {
    try { chrome.storage.local.get({ formGroups: [] }, r => cb((r && r.formGroups) || [])); } catch (e) { cb([]); }
  }

  // Picker section: saved groups (this site's first), only when Alt+clicking a field
  pickerSections.push({
    title: 'Saved groups',
    load(mode, field, cb) {
      if (mode !== 'insert' || !field) return cb([]);
      loadGroups(groups => {
        const host = location.hostname;
        const sorted = groups.filter(g => g.site === host).concat(groups.filter(g => g.site !== host));
        cb(sorted.map(g => ({ label: '🧾 ' + g.name, meta: g.fields.length + ' fields', group: g })));
      });
    },
    choose(item, p) { openGroupPreview(item.group, p.field); }
  });

  // Side panel "Fill" → background → here (fills without a preview; reports the result)
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== 'FILL_GROUP') return;
      const field = targetFieldForPanel();
      if (!field) { sendResponse({ ok: false, reason: 'Click into a field of the form first' }); return; }
      loadGroups(groups => {
        const group = groups.find(g => g.id === msg.id);
        if (!group) { sendResponse({ ok: false, reason: 'Group not found' }); return; }
        runFill(group, field).then(res => sendResponse(Object.assign({ ok: true }, res)));
      });
      return true;   // async response
    });
  } catch (e) { /* not running as an extension (tests) */ }
