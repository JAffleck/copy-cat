// TEST HOOK (debug only): exposes internal state; loaded after the content scripts
window.__cc = () => {
  const d = (t) => !t ? String(t) : (t instanceof Range ? `Range("${t.toString().slice(0, 30)}")`
    : t.nodeType === 3 ? `#text("${t.nodeValue.trim().slice(0, 30)}")`
    : `<${t.tagName}${t.id ? '#' + t.id : ''}${t.className && typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : ''}>`);
  return { cur: d(currentTargetElement), hist: zoomHistory.map(d), mouse: [lastMouseX, lastMouseY], mode: zoomMode, frozen: frozenRanges.map(d), tracking: settings.trackingMode };
};
