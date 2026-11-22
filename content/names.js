// Copy Cat content script: element names for Identify view and text-less fallbacks
// (aria-label, label, placeholder, alt, title, SVG/icon names, CSS icon files, test ids).
// Loaded in order with the other content/*.js files (see manifest.json); they share one
// isolated-world scope, so top-level names here are visible to the others (not to the page).

  const NAME_ROLES = ['button', 'link', 'img', 'checkbox', 'switch', 'tab', 'menuitem', 'radio', 'option'];
  const NAMEABLE_TAGS = ['IMG', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'AREA', 'VIDEO', 'CANVAS', 'I'];
  const ICON_PREFIX_RE = /^(fa|bi|icon|glyphicon|mdi|ti|ri|codicon|ion|la|feather|octicon)-(.+)$/;
  const ICON_GENERIC_RE = /^(fa|bi|mdi|ti|ri|codicon|ion|la|feather|octicon)-(solid|regular|light|thin|duotone|brands|sharp|xs|sm|lg|xl|2xs|2xl|[1-9]x|fw|spin|pulse|border|inverse|stack|stack-[12]x|flip.*|rotate.*|ul|li|beat|fade|bounce|shake)$/;
  const TEST_ID_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
  const SELECTION_FIELD_TYPES = ['text', 'search', 'email', 'tel', 'url', 'number', 'password', 'date',
    'datetime-local', 'month', 'week', 'time', 'color'];

  function elementOf(target) {
    if (!target) return null;
    if (target instanceof Range) {
      const n = target.commonAncestorContainer;
      return n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement;
    }
    return target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
  }

  function visibleTextOf(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return '';
    return (el.innerText || '').trim();
  }

  function textOfIdRefs(ids) {
    return (ids || '').split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id))
      .filter(Boolean)
      .map(n => (n.innerText || n.textContent || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  function fileNameFromUrl(url) {
    if (!url) return '';
    if (/^data:/i.test(url)) return '';
    try {
      const path = new URL(url, location.href).pathname;
      return decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
    } catch (e) { return ''; }
  }

  function cssUrls(value) {
    const out = [];
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
    let m;
    while ((m = re.exec(value || '')) !== null) out.push(m[2]);
    return out;
  }

  // Icon names from classes like fa-trash / bi-gear. Only on icon-like leaves (<i>, <span>, <svg>, or
  // no child elements): containers often have look-alike classes (e.g. a button's "icon-btn").
  function iconNamesFromClasses(el) {
    const names = [];
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    if (!['I', 'SPAN', 'SVG'].includes(tag) && el.children && el.children.length > 0) return names;
    for (const c of el.classList || []) {
      if (ICON_GENERIC_RE.test(c)) continue;
      const m = c.match(ICON_PREFIX_RE);
      if (m) names.push(m[2]);
    }
    return names;
  }

  function isFormField(el) {
    const tag = el.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  // Ordered, de-duplicated list of { source, text } describing the element
  function getElementNames(target) {
    const el = elementOf(target);
    if (!el) return [];
    const tag = el.tagName.toUpperCase();
    const out = [];
    const seen = new Set();
    const add = (source, text) => {
      text = (text == null ? '' : String(text)).replace(/\s+/g, ' ').trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      out.push({ source, text });
    };

    const vis = visibleTextOf(el);
    if (vis) add('text', vis);

    if (isFormField(el)) {
      const isSecret = tag === 'INPUT' && (el.type === 'password' ||
        /^(cc-|current-password|new-password|one-time-code)/.test(el.getAttribute('autocomplete') || ''));
      if (tag === 'SELECT') add('value', el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '');
      else if (el.isContentEditable && tag !== 'INPUT' && tag !== 'TEXTAREA') { /* text already added */ }
      else if (!isSecret && (tag === 'TEXTAREA' || SELECTION_FIELD_TYPES.includes(el.type))) add('value', el.value);
      add('placeholder', el.getAttribute('placeholder'));
      const labels = el.labels ? Array.from(el.labels) : [];
      if (!labels.length && el.closest('label')) labels.push(el.closest('label'));
      add('label', labels.map(l => (l.innerText || '').trim()).filter(Boolean).join(' '));
      add('hint', textOfIdRefs(el.getAttribute('aria-describedby')));
      add('name', el.getAttribute('name'));
    }

    if (tag === 'IMG' || tag === 'AREA' || (tag === 'INPUT' && el.type === 'image')) {
      add('alt', el.getAttribute('alt'));
      const fig = el.closest('figure');
      if (fig) { const cap = fig.querySelector('figcaption'); if (cap) add('caption', cap.innerText); }
      add('file', fileNameFromUrl(el.currentSrc || el.getAttribute('src')));
    }

    const svg = tag === 'SVG' ? el : (el.closest ? el.closest('svg') : null);
    if (svg) {
      const title = svg.querySelector('title');
      if (title) add('svg title', title.textContent);
      const use = svg.querySelector('use');
      if (use) {
        const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
        add('svg icon', href.split('#').pop());
      }
    }

    add('aria-label', el.getAttribute('aria-label'));
    add('labelled by', textOfIdRefs(el.getAttribute('aria-labelledby')));
    add('title', el.getAttribute('title'));
    if (tag === 'A' && el.getAttribute('href')) add('href', el.href);

    iconNamesFromClasses(el).forEach(n => add('icon', n));
    for (const pseudo of [null, '::before', '::after']) {
      let cs;
      try { cs = getComputedStyle(el, pseudo); } catch (e) { continue; }
      for (const prop of ['background-image', 'mask-image', '-webkit-mask-image']) {
        cssUrls(cs.getPropertyValue(prop)).forEach(u => add('css icon', fileNameFromUrl(u)));
      }
    }

    // Icon-only controls without a human-readable name of their own: borrow the first icon's names
    const HUMAN = ['label', 'placeholder', 'alt', 'caption', 'svg title', 'aria-label', 'labelled by', 'title'];
    if (!vis && !out.some(n => HUMAN.includes(n.source))) {
      const icon = el.querySelector && el.querySelector('img, svg, i, [class*="icon"], [class^="fa"], [class*=" fa-"]');
      if (icon && icon !== el) {
        getElementNames(icon).forEach(n => add('icon ' + n.source, n.text));
      }
    }

    add('id', el.id);
    TEST_ID_ATTRS.forEach(a => add(a, el.getAttribute(a)));
    return out;
  }

  // Best human-readable name for an element with no visible text ('' if none)
  function getBestName(target) {
    const skip = ['text', 'id', 'name', 'href', ...TEST_ID_ATTRS];
    const n = getElementNames(target).find(x => !skip.includes(x.source));
    return n || null;
  }

  // Elements that may be selected/copied by name even though they have no visible text
  function isNameCandidate(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName.toUpperCase();
    if (NAMEABLE_TAGS.includes(tag)) return true;
    const role = el.getAttribute('role');
    if (role && NAME_ROLES.includes(role)) return true;
    return iconNamesFromClasses(el).length > 0;
  }

  // For the element under the mouse: the text-less named thing to select, or null
  function getNamedTarget(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    let t = el.closest('svg') || el;
    // an icon inside an icon-only button/link: select the control
    const control = t.closest('button, a[href], [role="button"], [role="link"]');
    if (control && control !== t && !visibleTextOf(control)) t = control;
    if (!isNameCandidate(t) || visibleTextOf(t)) return null;
    return getBestName(t) ? t : null;
  }
