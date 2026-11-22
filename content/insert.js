// Copy Cat content script: put text into form fields the way a paste would, so page frameworks
// (React, Vue, Angular) see a normal input event. Used by the history picker and form groups.
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

  const INSERTABLE_INPUT_TYPES = ['', 'text', 'search', 'email', 'tel', 'url', 'number', 'password',
    'date', 'datetime-local', 'month', 'week', 'time'];

  function isSecretField(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    return el.type === 'password' ||
      /^(cc-|current-password|new-password|one-time-code)/.test(el.getAttribute('autocomplete') || '');
  }

  // The editable field for a clicked/focused node, or null
  function editableFrom(node) {
    let el = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    if (!el) return null;
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT') return INSERTABLE_INPUT_TYPES.includes(el.type) && !el.disabled && !el.readOnly ? el : null;
    if (tag === 'TEXTAREA') return !el.disabled && !el.readOnly ? el : null;
    if (tag === 'SELECT') return !el.disabled ? el : null;
    if (el.isContentEditable) {
      while (el.parentElement && el.parentElement.isContentEditable) el = el.parentElement;
      return el;
    }
    const combo = el.closest('[role="combobox"]');
    if (combo) {
      const input = combo.tagName === 'INPUT' ? combo : combo.querySelector('input');
      if (input) return editableFrom(input);
    }
    return null;
  }

  function fireInputEvents(el, text) {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Select the <option> whose text or value matches; returns true if one did
  function selectOptionByText(select, text) {
    const want = String(text).trim().toLowerCase();
    const opts = Array.from(select.options);
    let idx = opts.findIndex(o => o.value.trim().toLowerCase() === want || o.text.trim().toLowerCase() === want);
    if (idx === -1 && want) idx = opts.findIndex(o => o.text.trim().toLowerCase().startsWith(want));
    if (idx === -1) return false;
    if (select.selectedIndex !== idx) {
      select.selectedIndex = idx;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  // Native value setter: bypasses framework wrappers (React tracks value through it)
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, value);
  }

  // Insert text at the caret (replacing any selection). Returns { ok, method } or { ok:false, reason }.
  function insertIntoField(el, text) {
    if (!el) return { ok: false, reason: 'No field' };
    const tag = el.tagName.toUpperCase();
    if (tag === 'SELECT') {
      return selectOptionByText(el, text) ? { ok: true, method: 'select' } : { ok: false, reason: 'No matching option' };
    }
    el.focus();

    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const before = el.value;
      let start = null, end = null;
      try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { /* type without selection API */ }
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
      if (ok && (el.value !== before || text === '')) return { ok: true, method: 'execCommand' };
      // Fallback: compute the new value ourselves
      const next = start === null ? text : before.slice(0, start) + text + before.slice(end);
      setNativeValue(el, next);
      try { if (start !== null) el.setSelectionRange(start + text.length, start + text.length); } catch (e) {}
      fireInputEvents(el, text);
      return el.value === next ? { ok: true, method: 'setter' } : { ok: false, reason: 'Field rejected the value' };
    }

    if (el.isContentEditable) {
      const before = el.innerText;
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
      if (ok && el.innerText !== before) return { ok: true, method: 'execCommand' };
      const sel = window.getSelection();
      if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        r.insertNode(document.createTextNode(text));
        r.collapse(false);
      } else {
        el.appendChild(document.createTextNode(text));
      }
      fireInputEvents(el, text);
      return { ok: true, method: 'dom' };
    }
    return { ok: false, reason: 'Not an editable field' };
  }

  // Put the caret at the end of a field that wasn't focused yet
  function focusAtEnd(el) {
    if (document.activeElement === el) return;
    el.focus();
    try {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const n = el.value.length;
        el.setSelectionRange(n, n);
      } else if (el.isContentEditable) {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } catch (e) { /* types without selection API (email, number) */ }
  }
