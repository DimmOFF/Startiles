// Site icon resolver.
//  - resolve(pageUrl):   best icon for a tile (cached per origin)
//  - preview(pageUrl):   og:image for the "Pageview" thumbnail
//  - candidates(url,cb): every usable icon variant, streamed progressively to the icon picker
//  - wide(pageUrl):      a wide (rectangular) logo for the "Wide icon" thumbnail; wideCandidates(url,cb) feeds its picker
import * as S from './settings.js';
import { netCall } from './net.js';
const KEY = 'iconCache', TTL_FAIL = 3 * 864e5;
const EVERY = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5, year: 365 * 864e5 };
// how long a found icon / preview stays valid: the chosen interval, forever when auto-refresh is off
const ttlOk = () => (S.get().iconAutoRefresh ? EVERY[S.get().iconRefreshEvery] || EVERY.month : Infinity);
let cache = null, saveT;
const queue = [], inflight = new Map();
let active = 0;

const load = async () => { if (!cache) cache = (await chrome.storage.local.get(KEY))[KEY] || {}; };
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => chrome.storage.local.set({ [KEY]: cache }), 500); };
export async function clear() { cache = {}; inflight.clear(); candCache.clear(); wideCache.clear(); await chrome.storage.local.set({ [KEY]: {} }); }
// Import: replace the cache or merge an imported one into it (existing entries win)
export async function merge(obj, replace) {
  await load();
  cache = replace ? { ...obj } : { ...obj, ...cache };
  inflight.clear(); candCache.clear(); wideCache.clear();
  await chrome.storage.local.set({ [KEY]: cache });
}

const sizeOf = (s) => {
  if (!s) return 0;
  if (/any/i.test(s)) return 1024;
  return Math.max(0, ...[...s.matchAll(/(\d+)x(\d+)/gi)].map((m) => +m[1]));
};
// All requests to sites go through a Web Worker (js/networker.js, see js/net.js).
// Pixel width of the image at src (SVG: 1024), or null when it is not a loadable image.
const loadImg = (src, ms = 4000) => netCall('imgWidth', src, ms);
// Downloads an icon, returns its real pixel width and a content hash (to detect duplicates).
const probe = (src, ms = 4500) => netCall('probe', src, ms);   // -> { w, h, v (vector), hash } | null
const fetchText = (url, ms = 4000) => netCall('fetchText', url, ms);
// Reads only the <head> of a page.
const fetchHead = (url, ms = 4000) => netCall('fetchHead', url, ms);
// The first ~150 KB of a page (to look for the logo in the page header).
const fetchTop = (url, ms = 5000) => netCall('fetchTop', url, ms);

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
// Minimal tag reader: extracts attributes of <link> / <meta> straight from the HTML text.
// (A DOM parser would also create the page's <script> elements and the browser would log CSP errors for them.)
const decode = (v) => v.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
function tags(html, name) {
  const out = [];
  const re = new RegExp('<' + name + '\\b((?:"[^"]*"|\'[^\']*\'|[^>"\'])*)>', 'gi');
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const ar = /([^\s=\/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = ar.exec(m[1]))) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    out.push(attrs);
  }
  return out;
}

// Candidates declared by the page: <link rel=icon|apple-touch-icon> and web manifest icons.
async function pageCands(pageUrl, add, pre) {
  const page = pre || await fetchHead(pageUrl);
  if (!page) return;
  const links = tags(page.text, 'link');
  for (const a of links) {
    const rel = (a.rel || '').toLowerCase();
    if (!a.href) continue;
    let abs;
    try { abs = new URL(a.href, page.url).href; } catch { continue; }
    const sz = sizeOf(a.sizes);
    if (rel.includes('apple-touch-icon')) add(abs, sz || 180);
    else if (/(^|\s)(shortcut\s+)?icon(\s|$)/.test(rel)) add(abs, sz || (/\.svg(\?|$)/i.test(abs) ? 1024 : 32));
  }
  const mf = links.find((a) => /(^|\s)manifest(\s|$)/i.test(a.rel || '') && a.href)?.href;
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

// Cache keys: <origin> = best icon of a site, 'u:<page url>' = when THIS bookmark was last checked, 'p:<page url>' = its page preview.
// A bookmark is re-checked when its own time is older than the auto-refresh interval; the icon already known is shown
// meanwhile (the tile does not flicker) and the new one is used the next time.
const refreshing = new Map();
function refreshIcon(pageUrl, origin) {
  if (refreshing.has(origin)) return refreshing.get(origin);
  const p = (async () => {
    const r = await schedule(() => discover(pageUrl));
    const old = cache[origin], now = Date.now();
    cache[origin] = { src: r?.src || old?.src || null, w: r ? r.w : old?.w || 0, ts: now };   // a failed check keeps the old icon
    save();
    return cache[origin].src;
  })().finally(() => refreshing.delete(origin));
  refreshing.set(origin, p);
  return p;
}
export function resolve(pageUrl) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return Promise.resolve(null); }
  if (!/^https?:/.test(origin)) return Promise.resolve(null);
  if (inflight.has(pageUrl)) return inflight.get(pageUrl);
  const p = (async () => {
    await load();
    const uk = 'u:' + pageUrl, now = Date.now(), oc = cache[origin];
    const ttl = oc?.src ? ttlOk() : TTL_FAIL, seen = cache[uk]?.ts ?? oc?.ts ?? 0;
    if (oc && now - seen < ttl) return oc.src;                                   // this bookmark was checked recently
    if (oc && now - oc.ts < ttl) { cache[uk] = { ts: now }; save(); return oc.src; }   // another bookmark of the site has just refreshed it
    const job = refreshIcon(pageUrl, origin).then((src) => { cache[uk] = { ts: Date.now() }; save(); return src; });
    if (oc?.src) { job.catch(() => {}); return oc.src; }                          // known icon: show it now, update in the background
    return job;
  })();
  inflight.set(pageUrl, p);
  return p;
}

// Page preview image (og:image / twitter:image) for the "Pageview" automatic thumbnail.
async function fetchPreview(pageUrl) {
  const pk = 'p:' + pageUrl;
  let transient = false;                                     // the page itself could not be loaded: do not remember the failure
  const src = await schedule(async () => {
    const page = await fetchHead(pageUrl);
    if (!page) { transient = true; return null; }
    const metas = tags(page.text, 'meta');
    const pick = (keys, attr) => {
      for (const k of keys) {
        const e = metas.find((x) => (x[attr] || '').toLowerCase() === k && x.content);
        if (e) return e.content;
      }
      return null;
    };
    const cands = [
      pick(['og:image', 'og:image:url', 'og:image:secure_url'], 'property') || pick(['og:image', 'og:image:url', 'og:image:secure_url'], 'name'),
      pick(['twitter:image', 'twitter:image:src'], 'name') || pick(['twitter:image', 'twitter:image:src'], 'property'),
      pick(['image'], 'itemprop'),
      tags(page.text, 'link').find((l) => /(^|\s)image_src(\s|$)/i.test(l.rel || '') && l.href)?.href,
    ].filter(Boolean);
    for (const href of cands) {                              // first candidate that really loads as a large enough image
      let abs;
      try { abs = new URL(href, page.url).href; } catch { continue; }
      const w = await loadImg(abs, 6000);
      if (w && w >= 160) return abs;
    }
    return null;
  });
  if (transient) return cache[pk]?.src || null;
  cache[pk] = { src: src || cache[pk]?.src || null, w: 0, ts: Date.now() };   // a failed refresh keeps the old preview
  save();
  return cache[pk].src;
}
export async function preview(pageUrl) {
  await load();
  const c = cache['p:' + pageUrl];
  if (c && Date.now() - c.ts < (c.src ? ttlOk() : TTL_FAIL)) return c.src;
  if (c?.src) { fetchPreview(pageUrl).catch(() => {}); return c.src; }                 // stale: show it, refresh in the background
  return fetchPreview(pageUrl);
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

// ---------------------------------------------------------------------------------------------------------------------
// Wide icons. Besides the square icons many sites have a rectangular (wide) logo. It is looked for in these places
// (the number is the priority, a higher one wins), and every candidate is downloaded and measured: only images that are
// really wide (width / height >= 1.5) count.
//   300  <meta name="msapplication-wide310x150logo">          the wide Windows tile
//   290  browserconfig.xml  <wide310x150logo src="...">
//   280  JSON-LD  "logo"                                       (Organization / WebSite markup)
//   270  <meta property="og:logo">, itemprop="logo", <link rel="logo">
//   200  <img> with "logo" in its src / alt / class / id near the top of the page (the first three)
//   0-10 the icons the page declares (<link rel=icon>, apple-touch-icon, web manifest) - some of them are wide
// ---------------------------------------------------------------------------------------------------------------------
const WIDE_AR = 1.5;
export const isWide = (r) => !!r && !!r.h && r.w / r.h >= WIDE_AR;
const wideOk = (r) => isWide(r) && (r.v || r.w >= 120);                       // not a tiny strip

function logosIn(node, out = [], depth = 0) {                                 // "logo" values of a JSON-LD document
  if (!node || depth > 5) return out;
  if (Array.isArray(node)) { node.forEach((n) => logosIn(n, out, depth + 1)); return out; }
  if (typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'logo') {
      for (const x of [].concat(v)) { const u = typeof x === 'string' ? x : x?.url || x?.contentUrl; if (typeof u === 'string') out.push(u); }
    } else if (typeof v === 'object') logosIn(v, out, depth + 1);
  }
  return out;
}
async function wideCands(page, add) {
  const rel = (h, base = page.url) => { try { return new URL(h, base).href; } catch { return null; } };
  const metas = tags(page.text, 'meta'), links = tags(page.text, 'link');
  const meta = (k) => metas.find((m) => (m.name || m.property || m.itemprop || '').toLowerCase() === k && m.content)?.content;
  const w = meta('msapplication-wide310x150logo');
  if (w) add(rel(w), 300);
  const og = meta('og:logo') || meta('logo');
  if (og) add(rel(og), 270);
  const lk = links.find((l) => /(^|\s)logo(\s|$)/i.test(l.rel || '') && l.href);
  if (lk) add(rel(lk.href), 270);
  for (const m of page.text.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { logosIn(JSON.parse(m[1].trim())).forEach((u) => add(rel(u), 280)); } catch { /* not valid JSON */ }
  }
  await Promise.all([
    (async () => {                                                            // browserconfig.xml
      const cfg = meta('msapplication-config');
      if (cfg && /^none$/i.test(cfg.trim())) return;
      const c = await fetchText(rel(cfg || '/browserconfig.xml'), 3000);
      const m = c && /<wide310x150logo\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(c.text);
      if (m) add(rel(m[1], c.url), 290);
    })(),
    (async () => {                                                            // the logo image in the page header
      const top = await fetchTop(page.url);
      if (!top) return;
      let n = 0;
      for (const a of tags(top.text, 'img')) {
        const src = a.src || a['data-src'] || a['data-lazy-src'];
        if (!src || /^data:/i.test(src)) continue;
        const hay = [a.src, a.alt, a.class, a.id].join(' ');
        if (!/logo/i.test(hay) || /partner|client|sponsor|customer|footer|social|payment|award|testimonial/i.test(hay)) continue;
        add(rel(src, top.url), 200 - n);
        if (++n >= 3) break;
      }
    })(),
  ]);
}
const byRank = (list) => [...list].sort((a, b) => b.d - a.d || b.w - a.w);

// Finds, downloads and measures the candidates; onUpdate(list) is called whenever another wide image is verified.
async function wideSearch(pageUrl, onUpdate) {
  const page = await fetchHead(pageUrl);
  if (!page) return [];
  const cands = new Map();
  const add = (href, d) => { if (href && /^https?:/i.test(href) && (cands.get(href) ?? -1) < d) cands.set(href, d); };
  await Promise.all([pageCands(pageUrl, (h, s) => add(h, Math.min(s, 1024) / 100), page), wideCands(page, add)]);
  const out = [], seen = new Set();
  await Promise.all([...cands].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([src, d]) => probe(src).then((r) => {
    if (!wideOk(r) || seen.has(r.hash)) return;
    seen.add(r.hash);
    out.push({ src, d, ...r });
    onUpdate?.(byRank(out));
  })));
  return byRank(out);
}

// The best wide logo of the site for a tile ('' when the site has none); cached per site like the other icons.
const wideRefreshing = new Map();
function refreshWide(pageUrl, origin) {
  if (wideRefreshing.has(origin)) return wideRefreshing.get(origin);
  const k = 'w:' + origin;
  const p = (async () => {
    const list = await schedule(() => wideSearch(pageUrl));
    cache[k] = { src: list?.[0]?.src || '', w: list?.[0]?.w || 0, ts: Date.now() };   // '' = checked, the site has none
    save();
    return cache[k].src;
  })().finally(() => wideRefreshing.delete(origin));
  wideRefreshing.set(origin, p);
  return p;
}
export async function wide(pageUrl) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return null; }
  if (!/^https?:/.test(origin)) return null;
  await load();
  const c = cache['w:' + origin];
  if (c && Date.now() - c.ts < (c.src ? ttlOk() : TTL_FAIL)) return c.src || null;
  if (c?.src) { refreshWide(pageUrl, origin).catch(() => {}); return c.src; }            // stale: show it, check again in the background
  return (await refreshWide(pageUrl, origin)) || null;
}

// Picker of the wide variants (Add / Edit dialog), streamed like candidates().
const wideCache = new Map();
export async function wideCandidates(pageUrl, onUpdate) {
  let u;
  try { u = new URL(pageUrl); } catch { return []; }
  if (!/^https?:$/.test(u.protocol)) return [];
  const hit = wideCache.get(u.origin);
  if (hit) { onUpdate?.(hit); return hit; }
  const out = await wideSearch(pageUrl, onUpdate);
  wideCache.set(u.origin, out);
  return out;
}
