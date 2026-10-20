// Site icon resolver.
//  - resolve(pageUrl):   best icon for a tile (cached per origin)
//  - preview(pageUrl):   og:image for the "Pageview" thumbnail
//  - candidates(url,cb): every usable icon variant, streamed progressively to the icon picker
//  - wide(pageUrl):      a wide (rectangular) logo for the "Logo" thumbnail; wideCandidates(url,cb) feeds its picker
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
export const preload = load;                                  // the icon cache is read once at start, so peek() can answer at once
// The best icon already known for the site of pageUrl, or null: synchronous (only the in-memory cache), so a tile can start with it
export function peek(pageUrl) {
  if (!cache) return null;
  try { return cache[new URL(pageUrl).origin]?.src || null; } catch { return null; }
}
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => chrome.storage.local.set({ [KEY]: cache }), 500); };
export async function clear() { cache = {}; inflight.clear(); candCache.clear(); wideCache.clear(); webCache.clear(); previewFail.clear(); await chrome.storage.local.set({ [KEY]: {} }); }
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
// Pictures a page may offer for itself, best first: og:image, twitter:image, itemprop, <meta name=thumbnail>,
// <link rel=image_src>, JSON-LD "image", apple-touch-startup-image.
function ldImages(html) {
  const out = [];
  const take = (x) => {
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) x.forEach(take);
    else if (x && typeof x === 'object' && typeof x.url === 'string') out.push(x.url);
  };
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    take(v.image); take(v.thumbnailUrl);
    Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) { try { walk(JSON.parse(m[1].trim()), 0); } catch { /* not valid JSON */ } }
  return out;
}
function previewHrefs(html) {
  const metas = tags(html, 'meta'), links = tags(html, 'link');
  const pick = (keys, attr) => {
    for (const k of keys) {
      const x = metas.find((m) => (m[attr] || '').toLowerCase() === k && m.content);
      if (x) return x.content;
    }
    return null;
  };
  const rel = (name) => links.find((l) => new RegExp('(^|\\s)' + name + '(\\s|$)', 'i').test(l.rel || '') && l.href)?.href;
  const og = ['og:image', 'og:image:url', 'og:image:secure_url'], tw = ['twitter:image', 'twitter:image:src'];
  return [...new Set([
    pick(og, 'property') || pick(og, 'name'),
    pick(tw, 'name') || pick(tw, 'property'),
    pick(['image'], 'itemprop'),
    pick(['thumbnail'], 'name'),
    rel('image_src'),
    ...ldImages(html),
    rel('apple-touch-startup-image'),
  ].filter(Boolean))];
}
// PWA manifest "screenshots": big pictures of the app, used when the page has no picture of its own
async function manifestShots(html, base) {
  const href = tags(html, 'link').find((l) => /(^|\s)manifest(\s|$)/i.test(l.rel || '') && l.href)?.href;
  if (!href) return [];
  try {
    const m = await fetchText(new URL(href, base).href, 3000);
    return (JSON.parse(m.text).screenshots || []).map((x) => { try { return new URL(x.src, m.url).href; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// YouTube: the id of the video a link points to (watch?v=, youtu.be/, /shorts/, /embed/, /live/), or null for any other address
export function ytVideoId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.replace(/^(www|m|music)\./i, '').toLowerCase();
  let id = null;
  if (h === 'youtu.be') id = u.pathname.split('/')[1];
  else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/); if (m) id = m[1]; }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

const previewFail = new Map();                               // pk -> time until which an unreachable page is not asked again (this session)

// ---- item covers: a video, movie, book, product, album, game... shows ITS OWN picture ------------------------------
// coverKind(url): what the ADDRESS alone says the page is (a known site), or null. The kind of any other page is found in its markup.
// Kinds: video, movie, book, product, music, game, wiki.
export function coverKind(url) {
  if (ytVideoId(url)) return 'video';
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.replace(/^(www|m)\./i, '').toLowerCase();
  if (h === 'vimeo.com' && /^\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/)?\d+/.test(u.pathname)) return 'video';
  if (h === 'store.steampowered.com' && /^\/app\/\d+/.test(u.pathname)) return 'game';
  if (/^[a-z-]+\.wikipedia\.org$/.test(h) && /^\/wiki\/(?!(?:Special|File|Category|Talk|Help|Wikipedia|Template|Portal|User):)[^/]+$/.test(u.pathname)) return 'wiki';
  return null;
}
const fetchJson = async (url, ms = 4000) => {
  const r = await fetchText(url, ms);
  try { return r ? JSON.parse(r.text) : null; } catch { return null; }
};
// Pictures of a known site, straight from its own service (no page parsing).
async function siteCover(pageUrl) {
  const vid = ytVideoId(pageUrl);
  if (vid) {                                                 // YouTube: the cover of the video (16:9, no black bars)
    for (const name of ['maxresdefault', 'hq720', 'mqdefault']) {
      const abs = 'https://i.ytimg.com/vi/' + vid + '/' + name + '.jpg';
      const w = await loadImg(abs, 6000);
      if (w && w >= 160) return abs;
    }
    return null;
  }
  const k = coverKind(pageUrl);
  if (!k) return null;
  const u = new URL(pageUrl), ok = async (abs) => { const w = await loadImg(abs, 8000); return w && w >= 160 ? abs : null; };
  if (k === 'video') {                                       // Vimeo (oEmbed)
    const j = await fetchJson('https://vimeo.com/api/oembed.json?width=1280&url=' + encodeURIComponent(pageUrl));
    return j?.thumbnail_url ? ok(j.thumbnail_url) : null;
  }
  if (k === 'game') {                                        // Steam: the store header of the game
    const id = u.pathname.match(/^\/app\/(\d+)/)[1];
    return (await ok('https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/header.jpg')) || null;
  }
  if (k === 'wiki') {                                        // Wikipedia: the lead image of the article
    const j = await fetchJson('https://' + u.hostname + '/api/rest_v1/page/summary/' + u.pathname.slice(6));
    const th = j?.thumbnail?.source, big = th && th.replace(/\/\d+px-/, '/800px-');
    for (const c of [big, j?.originalimage?.source, th]) { if (c && (await ok(c))) return c; }
  }
  return null;
}
// Markup of an ordinary page: what it stands for (og:type, JSON-LD) and the pictures of THAT item.
function ldNodes(html) {
  const out = [];
  const walk = (v, d) => {
    if (!v || typeof v !== 'object' || d > 6) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, d + 1)); return; }
    if (v['@type']) out.push(v);
    Object.values(v).forEach((x) => walk(x, d + 1));
  };
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) { try { walk(JSON.parse(m[1].trim()), 0); } catch { /* not valid JSON */ } }
  return out;
}
const LD_KIND = { Movie: 'movie', TVSeries: 'movie', TVEpisode: 'movie', VideoObject: 'video', Book: 'book', Product: 'product', ProductGroup: 'product',
  IndividualProduct: 'product', MusicAlbum: 'music', MusicRecording: 'music', MusicPlaylist: 'music', VideoGame: 'game', Game: 'game' };
const ldKindOf = (n) => [].concat(n['@type']).map((t) => LD_KIND[String(t).replace(/^.*[/#]/, '')]).find(Boolean) || null;
function addImgs(x, out) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => addImgs(y, out));
  else if (x && typeof x === 'object' && typeof x.url === 'string') out.push(x.url);
}
function pageKind(html) {
  const metas = tags(html, 'meta');
  const meta = (k) => metas.find((m) => (m.property || m.name || m.itemprop || '').toLowerCase() === k)?.content || '';
  const og = meta('og:type').toLowerCase().trim(), nodes = ldNodes(html);
  let kind = null, fromLd = false;
  if (/^video\.(movie|tv_show|episode)/.test(og)) kind = 'movie';
  else if (og.startsWith('video')) kind = 'video';
  else if (og === 'book') kind = 'book';
  else if (/^(og:)?product/.test(og)) kind = 'product';
  else if (og.startsWith('music.')) kind = 'music';
  else if (og === 'game') kind = 'game';
  if (!kind) { kind = nodes.map(ldKindOf).find(Boolean) || null; fromLd = !!kind; }
  const own = nodes.filter((n) => ldKindOf(n) === kind);
  if (fromLd && own.length > 3) kind = null;                // a listing of many items is not ONE item
  const imgs = [];
  if (kind && own.length <= 3) own.forEach((n) => { addImgs(n.image, imgs); if (kind === 'video') addImgs(n.thumbnailUrl, imgs); });
  const isbn = String(own.map((n) => n.isbn).find(Boolean) || meta('book:isbn') || '').replace(/[^0-9Xx]/g, '');
  return { kind, imgs, isbn: isbn.length === 10 || isbn.length === 13 ? isbn : '' };
}

// noItem: Pageview - the page's own preview image (og:image...) or a screenshot; otherwise the Card mode: the picture of the ITEM itself.
async function fetchPreview(pageUrl, noItem = false) {
  const pk = (noItem ? 'p:' : 'pc:') + pageUrl;               // 'p:' = Pageview, 'pc:' = Card
  let transient = false, kind = coverKind(pageUrl);          // transient: the page itself could not be loaded: do not remember the failure for long
  const src = await schedule(async () => {
    if (!noItem) { const s = await siteCover(pageUrl); if (s) return s; }
    const page = await fetchHead(pageUrl);
    if (!page) { transient = true; return null; }
    const seen = new Set();
    const firstLarge = async (hrefs) => {                    // first candidate that really loads as a large enough image
      for (const href of hrefs) {
        let abs;
        try { abs = new URL(href, page.url).href; } catch { continue; }
        if (seen.has(abs)) continue;
        seen.add(abs);
        const w = await loadImg(abs, 8000);
        if (w && w >= 160) return abs;
      }
      return null;
    };
    const pg = pageKind(page.text);
    kind = kind || pg.kind;
    if (!noItem) {
      const em = tags(page.text, 'link').find((l) => /json\+oembed/i.test(l.type || '') && l.href);   // the page's own oEmbed description
      if (em) {
        let j = null;
        try { j = await fetchJson(new URL(em.href, page.url).href); } catch { /* ignore */ }
        const th = j && (j.thumbnail_url || (j.type === 'photo' && j.url));
        if (th) { const r = await firstLarge([th]); if (r) return r; }
      }
      const r = await firstLarge(pg.imgs);                   // the picture of the item itself (JSON-LD Product / Movie / Book ...)
      if (r) return r;
    }
    const r2 = (await firstLarge(previewHrefs(page.text))) || (noItem ? await firstLarge(await manifestShots(page.text, page.url)) : null);   // a Card is never a screenshot
    if (r2) return r2;
    if (!noItem && pg.kind === 'book' && pg.isbn) return firstLarge(['https://covers.openlibrary.org/b/isbn/' + pg.isbn + '-L.jpg?default=false']);
    return null;
  });
  if (transient) { previewFail.set(pk, Date.now() + 10 * 60e3); return { src: cache[pk]?.src || null, kind: cache[pk]?.kind || kind || null }; }
  cache[pk] = { src: src || cache[pk]?.src || null, w: 0, ts: Date.now(), kind: kind || null };   // a failed refresh keeps the old preview
  save();
  return { src: cache[pk].src, kind: cache[pk].kind };
}
// Optional online screenshot service for Pageview tiles that have no picture of their own (off by default: the address of the page
// is sent to the service). A template contains {url} (the address as it is) or {urlenc} (URL-encoded).
const PV_PRESETS = {
  thumio: 'https://image.thum.io/get/width/800/crop/600/noanimate/{url}',
  microlink: 'https://api.microlink.io/?url={urlenc}&screenshot=true&meta=false&embed=screenshot.url',
};
export function shotServiceUrl(pageUrl) {
  const s = S.get();
  const tpl = s.pvService === 'custom' ? (s.pvServiceUrl || '').trim() : PV_PRESETS[s.pvService];
  if (!tpl || !/^https:\/\//i.test(tpl) || !/\{url(enc)?\}/.test(tpl) || !/^https?:\/\//i.test(pageUrl)) return null;
  return tpl.replace('{urlenc}', encodeURIComponent(pageUrl)).replace('{url}', pageUrl);
}
export const previewMaxAge = () => ttlOk();                  // how long a stored preview / screenshot is considered fresh

// What a page's preview is: { src, kind }. opts.item: the Card mode (the item's own picture), otherwise Pageview; opts.needKind: refresh an entry stored without a kind
export async function previewInfo(pageUrl, opts = {}) {
  await load();
  const noItem = !opts.item, pk = (noItem ? 'p:' : 'pc:') + pageUrl;
  const out = (c) => ({ src: c.src, kind: c.kind || coverKind(pageUrl) || null });
  const c = cache[pk];
  if (c && c.kind === undefined && opts.needKind && !coverKind(pageUrl)) return fetchPreview(pageUrl, noItem);   // stored before kinds existed
  if (c && Date.now() - c.ts < (c.src ? ttlOk() : TTL_FAIL)) return out(c);
  if (c?.src) { fetchPreview(pageUrl, noItem).catch(() => {}); return out(c); }         // stale: show it, refresh in the background
  if ((previewFail.get(pk) || 0) > Date.now()) return { src: null, kind: coverKind(pageUrl) || null };   // could not be reached a moment ago
  return fetchPreview(pageUrl, noItem);
}
export const preview = async (pageUrl, opts) => (await previewInfo(pageUrl, opts)).src;

// Names of a page for the Title field: the name of its SITE and the title of the ITEM itself (product / video / movie / book / article).
const ent = (v) => decode(v).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d));
function pageTitles(html) {
  const metas = tags(html, 'meta'), nodes = ldNodes(html), pg = pageKind(html);
  const meta = (...keys) => {
    for (const k of keys) {
      const x = metas.find((m) => (m.property || m.name || m.itemprop || '').toLowerCase() === k && (m.content || '').trim());
      if (x) return ent(x.content).replace(/\s+/g, ' ').trim();
    }
    return '';
  };
  const named = (pred) => nodes.find((n) => pred(n) && typeof n.name === 'string' && n.name.trim())?.name.replace(/\s+/g, ' ').trim() || '';
  const types = (n) => [].concat(n['@type']).map((t) => String(t).replace(/^.*[/#]/, ''));
  const site = meta('og:site_name', 'application-name', 'apple-mobile-web-app-title') || named((n) => types(n).some((t) => t === 'WebSite' || t === 'Organization'));
  const tt = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  let item = (pg.kind && named((n) => ldKindOf(n) === pg.kind)) || meta('og:title', 'twitter:title') || (tt ? ent(tt).replace(/\s+/g, ' ').trim() : '');
  if (site) {                                                // "Item - Site" -> "Item"
    const esc = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    item = item.replace(new RegExp('\\s*[|\\-\u2013\u2014\u00b7:\u2022]\\s*' + esc + '\\s*$', 'i'), '').trim() || item;
  }
  return { site, item, kind: pg.kind };
}
const namesCache = new Map();
export function pageNames(pageUrl) {
  if (namesCache.has(pageUrl)) return namesCache.get(pageUrl);
  const p = schedule(async () => {
    const page = await fetchHead(pageUrl);
    return page ? pageTitles(page.text) : null;
  });
  namesCache.set(pageUrl, p);
  p.then((r) => { if (!r) namesCache.delete(pageUrl); });   // an unreachable page is asked again next time
  return p;
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

// ---------------------------------------------------------------------------------------------------------------------
// Online search for wide logos - only on an explicit request ("Search online" in the Add / Edit dialog), never automatically.
// Wikidata knows the logo (P154) and the official website (P856) of many companies and sites; an item whose official website
// is the site itself is the best match. Wikimedia Commons file search adds more candidates. No API key is needed.
// What is sent: the site name (title / domain label) to wikidata.org and commons.wikimedia.org.
// ---------------------------------------------------------------------------------------------------------------------
const WD_API = 'https://www.wikidata.org/w/api.php', COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
// a Commons file as a PNG of at most 640px (SVG logos are rendered): light to download and always measurable
const commonsUrl = (file) => 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file.replace(/^File:/i, '').replace(/ /g, '_')) + '?width=640';
async function apiJson(base, params) {
  const r = await fetchText(base + '?' + new URLSearchParams({ format: 'json', origin: '*', ...params }), 7000);
  try { return r ? JSON.parse(r.text) : null; } catch { return null; }
}
const bareHost = (h) => h.toLowerCase().replace(/^www\./, '');
const sameSite = (url, host) => {                                                // the official website belongs to this site (or its parent domain)
  try { const h = bareHost(new URL(url).hostname); return h === host || h.endsWith('.' + host) || host.endsWith('.' + h); } catch { return false; }
};
const webCache = new Map();
export async function webLogos(names, pageUrl, onUpdate) {
  let host;
  try { host = bareHost(new URL(pageUrl).hostname); } catch { return []; }
  names = [...new Set(names.map((n) => (n || '').trim()).filter((n) => n.length >= 2))].slice(0, 2);
  if (!names.length) return [];
  const key = host + '|' + names.join('|').toLowerCase();
  const hit = webCache.get(key);
  if (hit) { onUpdate?.(hit); return hit; }
  const cands = new Map();                                                       // url -> { d, label }
  const add = (url, d, label) => { const c = cands.get(url); if (!c || c.d < d) cands.set(url, { d, label }); };

  // 1. Wikidata: items with these names, their logo images
  const ids = [];
  await Promise.all(names.map(async (name) => {
    const j = await apiJson(WD_API, { action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: '6' });
    (j?.search || []).forEach((x) => { if (!ids.includes(x.id)) ids.push(x.id); });
  }));
  if (ids.length) {
    const j = await apiJson(WD_API, { action: 'wbgetentities', ids: ids.slice(0, 12).join('|'), props: 'claims|labels', languages: 'en' });
    for (const e of Object.values(j?.entities || {})) {
      const claims = e.claims || {}, label = e.labels?.en?.value || '';
      const siteMatch = (claims.P856 || []).some((c) => sameSite(c.mainsnak?.datavalue?.value || '', host));
      const exact = names.some((n) => n.toLowerCase() === label.toLowerCase());
      const d = siteMatch ? 100 : exact ? 40 : 0;
      if (!d) continue;                                                          // neither the site nor the name: noise
      const all = (claims.P154 || []).filter((c) => c.rank !== 'deprecated');
      const current = all.filter((c) => !c.qualifiers?.P582);                   // P582 = end time: an old logo
      (current.length ? current : all).sort((a, b) => (b.rank === 'preferred') - (a.rank === 'preferred')).slice(0, 3).forEach((c, i) => {
        const f = c.mainsnak?.datavalue?.value;
        if (typeof f === 'string') add(commonsUrl(f), d - i, label || 'Wikidata');
      });
    }
  }
  // 2. Wikimedia Commons: files whose name says "logo"
  await Promise.all(names.map(async (name) => {
    const j = await apiJson(COMMONS_API, { action: 'query', list: 'search', srsearch: name + ' logo', srnamespace: '6', srlimit: '8' });
    (j?.query?.search || []).forEach((x, i) => {
      if (/logo|wordmark/i.test(x.title) && !/icon|favicon|\.(ogg|oga|webm|pdf|tiff?|gif)$/i.test(x.title)) add(commonsUrl(x.title), 20 - i, 'Wikimedia Commons');
    });
  }));
  // 3. download and measure: only wide images count
  const out = [], seen = new Set();
  await Promise.all([...cands].sort((a, b) => b[1].d - a[1].d).slice(0, 14).map(([src, c]) => probe(src, 9000).then((r) => {
    if (!wideOk(r) || seen.has(r.hash)) return;
    seen.add(r.hash);
    out.push({ src, d: c.d, label: c.label, o: true, ...r });
    onUpdate?.(byRank(out));
  })));
  const list = byRank(out);
  if (list.length) webCache.set(key, list);                                      // an empty result is not remembered: the next try asks again
  return list;
}

