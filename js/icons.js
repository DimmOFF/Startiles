// Site icon resolver.
//  - resolve(pageUrl):   best icon for a tile (cached per origin)
//  - preview(pageUrl):   og:image for the "Pageview" thumbnail
//  - candidates(url,cb): every usable icon variant, streamed progressively to the icon picker
const KEY = 'iconCache', TTL_OK = 30 * 864e5, TTL_FAIL = 3 * 864e5;
let cache = null, saveT;
const queue = [], inflight = new Map();
let active = 0;

const load = async () => { if (!cache) cache = (await chrome.storage.local.get(KEY))[KEY] || {}; };
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => chrome.storage.local.set({ [KEY]: cache }), 500); };
export async function clear() { cache = {}; inflight.clear(); candCache.clear(); await chrome.storage.local.set({ [KEY]: {} }); }

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
// Downloads an icon, returns its real pixel width and a content hash (to detect duplicates).
async function probe(src, ms = 4500) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(src, { credentials: 'omit', signal: c.signal });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) return null;
    const type = r.headers.get('content-type') || '';
    const blob = new Blob([buf], { type });
    const isSvg = /svg/i.test(type) || /\.svg(\?|$)/i.test(src);
    let w = 0;
    try { w = (await createImageBitmap(blob)).width; }
    catch {
      const u = URL.createObjectURL(blob);
      try { w = (await loadImg(u, 3000)) || (isSvg ? 1024 : 0); } finally { URL.revokeObjectURL(u); }
    }
    if (!w) return null;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return { w: isSvg ? 1024 : w, hash };
  } catch { return null; } finally { clearTimeout(t); }
}
async function fetchText(url, ms = 4000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: c.signal });
    if (!r.ok) return null;
    return { text: await r.text(), url: r.url, type: r.headers.get('content-type') || '' };
  } catch { return null; } finally { clearTimeout(t); }
}
// Reads only the <head> of a page (stops at </head> or 250 KB) - much faster than downloading everything.
async function fetchHead(url, ms = 4000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: c.signal });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || '';
    if (type && !/html/i.test(type)) return null;
    const reader = r.body.getReader(), dec = new TextDecoder();
    let text = '';
    while (text.length < 250000) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(text)) break;
    }
    reader.cancel().catch(() => {});
    return { text, url: r.url, type };
  } catch { return null; } finally { clearTimeout(t); }
}

// Candidates that do not need the page HTML (so they can start immediately).
function staticCands(u) {
  const list = [
    [u.origin + '/apple-touch-icon.png', 150],
    [u.origin + '/favicon.ico', 16],
    // icon services often know larger icons than the page declares (e.g. google.com only declares 32px)
    [`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&nfrp=2&url=${encodeURIComponent(u.origin)}&size=256`, 120],
    [`https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=256`, 110],
    [`https://icons.duckduckgo.com/ip3/${u.hostname}.ico`, 20],
  ];
  if (/^(www\.)?google\.com$/.test(u.hostname)) {
    list.push(['https://www.gstatic.com/images/branding/googleg/2x/googleg_standard_color_128dp.png', 210]);
    list.push(['https://www.gstatic.com/images/branding/googleg/1x/googleg_standard_color_128dp.png', 200]);
  }
  return list;
}
// Candidates declared by the page: <link rel=icon|apple-touch-icon> and web manifest icons.
async function pageCands(pageUrl, add) {
  const page = await fetchHead(pageUrl);
  if (!page) return;
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
      const m = await fetchText(new URL(mf, page.url).href, 3000);
      (JSON.parse(m.text).icons || []).forEach((ic) => add(new URL(ic.src, m.url).href, sizeOf(ic.sizes) || 64));
    } catch { /* ignore */ }
  }
}

async function collect(pageUrl) {
  const u = new URL(pageUrl);
  const cands = new Map();
  const add = (href, size) => { if (href && (cands.get(href) ?? -1) < size) cands.set(href, size); };
  staticCands(u).forEach(([s, d]) => add(s, d));
  await pageCands(pageUrl, add);
  return cands;
}

async function discover(pageUrl) {
  const cands = await collect(pageUrl);
  const top = [...cands].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const ws = await Promise.all(top.map(([src]) => loadImg(src)));   // all in parallel
  let best = null, bw = 0;
  for (let i = 0; i < top.length; i++) {
    const w = ws[i];
    if (!w) continue;
    if (w >= 128) { best = top[i][0]; bw = w; break; }
    if (w > bw) { best = top[i][0]; bw = w; }
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
    const page = await fetchHead(pageUrl);
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

// Icon picker: all variants, verified by downloading. Everything starts at once (no shared queue) and
// results are streamed through onUpdate(list) as soon as each icon is verified.
const candCache = new Map();
export async function candidates(pageUrl, onUpdate) {
  let u;
  try { u = new URL(pageUrl); } catch { return []; }
  if (!/^https?:$/.test(u.protocol)) return [];
  const hit = candCache.get(u.origin);
  if (hit) { onUpdate?.(hit); return hit; }
  const results = [], seen = new Set(), started = new Set(), tasks = [];
  const view = () => {
    let out = [...results].sort((a, b) => b.w - a.w || b.d - a.d);
    if (out.some((r) => r.w >= 48)) out = out.filter((r) => r.w >= 24);   // drop tiny placeholders
    return out;
  };
  const add = (src, d) => {
    if (!src || started.has(src)) return;
    started.add(src);
    tasks.push(probe(src).then((r) => {
      if (!r || seen.has(r.hash)) return;                                   // identical images listed once
      seen.add(r.hash);
      results.push({ src, d, ...r });
      onUpdate?.(view());
    }));
  };
  staticCands(u).forEach(([s, d]) => add(s, d));
  await pageCands(pageUrl, add);
  await Promise.all(tasks);
  const out = view();
  candCache.set(u.origin, out);
  return out;
}
