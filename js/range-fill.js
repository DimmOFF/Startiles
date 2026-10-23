// Fills the left part of every <input type=range> with the accent colour (the CSS reads --p, a number from 0 to 1).
(() => {
  const isRange = (el) => el instanceof HTMLInputElement && el.type === 'range';
  const sync = (el) => {
    const min = el.min === '' ? 0 : +el.min;
    const max = el.max === '' ? 100 : +el.max;
    const v = el.valueAsNumber;
    const p = max > min && !Number.isNaN(v) ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;
    el.style.setProperty('--p', p);
  };
  const syncAll = (root) => root.querySelectorAll && root.querySelectorAll('input[type=range]').forEach(sync);

  // value set from code (when a settings panel is filled in) does not fire "input", so the setter is wrapped
  const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (d && d.get && d.set) {
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      configurable: true, enumerable: d.enumerable,
      get() { return d.get.call(this); },
      set(v) { d.set.call(this, v); if (isRange(this)) sync(this); }
    });
  }
  const onEvent = (e) => { if (isRange(e.target)) sync(e.target); };
  document.addEventListener('input', onEvent, true);
  document.addEventListener('change', onEvent, true);

  const start = () => {
    syncAll(document);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes') { if (isRange(m.target)) sync(m.target); continue; }
        m.addedNodes.forEach((n) => { if (isRange(n)) sync(n); else if (n.nodeType === 1) syncAll(n); });
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['min', 'max', 'value'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
