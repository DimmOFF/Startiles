// High-resolution site icon resolver.
// Reads the page's <link rel="icon|apple-touch-icon">, web manifest icons and common default paths,
// loads the best candidates and keeps the one with the largest real size. Result is cached per origin.
const KEY = 'iconCache', TTL_OK = 30 * 864e5, TTL_FAIL = 3 * 864e5;
let cache = null, saveT;
const queue = [], inflight = new Map();
let active = 0;

const load = async () => { if (!cache) cache = (await chrome.storage.local.get(KEY))[KEY] || {}; };
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => chrome.storage.local.set({ [KEY]: cache }), 500); };
export async function clear() { cache = {}; inflight.clear(); await chrome.storage.local.set({ [KEY]: {} }); }

const sizeOf = (s) => {
  if (!s) return 0;
  if (/any/i.test(s)) return 1024;
  return Math.max(0, ...[...s.matchAll(/(\d+)x(\d+)/gi)].map((m) => +m[1]));
};
function loadImg(src, ms = 4000) {
  return new Promise((res) => {
    const i = new Image();
    let done = false;
    const fin = (v) => { if (!done) { done = true; clearTimeout(t); res(v); } };
    const t = setTimeout(() => fin(null), ms);
    i.onload = () => fin(i.naturalWidth || (/\.svg(\?|$)/i.test(src) ? 1024 : 0));
    i.onerror = () => fin(null);
    i.src = src;
  });
}
async function fetchText(url, ms = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: c.signal });
    if (!r.ok) return null;
    return { text: await r.text(), url: r.url, type: r.headers.get('content-type') || '' };
  } catch { return null; } finally { clearTimeout(t); }
}

async function discover(pageUrl) {
  const u = new URL(pageUrl);
  const cands = new Map();
  const add = (href, size) => { if (href && (cands.get(href) ?? -1) < size) cands.set(href, size); };
  const page = await fetchText(pageUrl);
  if (page && /html/i.test(page.type || 'html')) {
    const doc = new DOMParser().parseFromString(page.text, 'text/html');
    doc.querySelectorAll('link[rel][href]').forEach((l) => {
      const rel = l.getAttribute('rel').toLowerCase();
      let abs;
      try { abs = new URL(l.getAttribute('href'), page.url).href; } catch { return; }
      const sz = sizeOf(l.getAttribute('sizes'));
      if (rel.includes('apple-touch-icon')) add(abs, sz || 180);
      else if (/(^|\s)(shortcut\s+)?icon(\s|$)/.test(rel)) add(abs, sz || (/\.svg(\?|$)/i.test(abs) ? 1024 : 32));
    });
    const mf = doc.querySelector('link[rel=manifest][href]')?.getAttribute('href');
    if (mf) {
      try {
        const m = await fetchText(new URL(mf, page.url).href);
        (JSON.parse(m.text).icons || []).forEach((ic) => add(new URL(ic.src, m.url).href, sizeOf(ic.sizes) || 64));
      } catch { /* ignore */ }
    }
  }
  add(u.origin + '/apple-touch-icon.png', 150);
  add(u.origin + '/favicon.ico', 16);
  const top = [...cands].sort((a, b) => b[1] - a[1]).slice(0, 5);
  let best = null, bw = 0;
  for (const [src] of top) {
    const w = await loadImg(src);
    if (w && w > bw) { best = src; bw = w; if (bw >= 128) break; }
  }
  return best ? { src: best, w: bw } : null;
}

function pump() {
  while (active < 4 && queue.length) { active++; queue.shift()(); }
}
const schedule = (fn) => new Promise((res) => {
  queue.push(() => fn().then(res, () => res(null)).finally(() => { active--; pump(); }));
  pump();
});

export function resolve(pageUrl) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return Promise.resolve(null); }
  if (!/^https?:/.test(origin)) return Promise.resolve(null);
  if (inflight.has(origin)) return inflight.get(origin);
  const p = (async () => {
    await load();
    const c = cache[origin];
    if (c && Date.now() - c.ts < (c.src ? TTL_OK : TTL_FAIL)) return c.src;
    const r = await schedule(() => discover(pageUrl));
    cache[origin] = { src: r?.src || null, w: r?.w || 0, ts: Date.now() };
    save();
    return cache[origin].src;
  })();
  inflight.set(origin, p);
  return p;
}

// Page preview image (og:image / twitter:image) for the "Pageview" automatic thumbnail.
export async function preview(pageUrl) {
  await load();
  const pk = 'p:' + pageUrl, c = cache[pk];
  if (c && Date.now() - c.ts < (c.src ? TTL_OK : TTL_FAIL)) return c.src;
  const src = await schedule(async () => {
    const page = await fetchText(pageUrl);
    if (!page) return null;
    const doc = new DOMParser().parseFromString(page.text, 'text/html');
    let href = null;
    for (const m of ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
      const e = doc.querySelector(`meta[property="${m}"],meta[name="${m}"]`);
      if (e?.content) { href = e.content; break; }
    }
    if (!href) return null;
    let abs;
    try { abs = new URL(href, page.url).href; } catch { return null; }
    const w = await loadImg(abs, 6000);
    return w && w >= 200 ? abs : null;
  });
  cache[pk] = { src: src || null, w: 0, ts: Date.now() };
  save();
  return src || null;
}
