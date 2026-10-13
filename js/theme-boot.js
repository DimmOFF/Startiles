// Runs before the page is painted: applies the colours saved by the last visit so there is no flash of the wrong theme.
try {
  const t = JSON.parse(localStorage.getItem('msd-theme') || 'null');
  if (t) {
    const r = document.documentElement;
    for (const k in t.vars) r.style.setProperty(k, t.vars[k]);
    r.style.colorScheme = t.scheme;
    r.dataset.scheme = t.scheme;
  }
} catch {}
