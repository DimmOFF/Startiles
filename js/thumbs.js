// Thumbnail metadata lives in chrome.storage.local, keyed by bookmark URL:
//   { mode: 'url'|'file', url?, dataUrl?, fit, ts }      custom image
//   { mode: 'auto', auto: 'logo', icon: <chosen icon url>, ts }   automatic logo with a user-picked icon
//   { mode: 'auto', auto: 'pageview' | 'card', cfit? }    automatic: page preview / the picture of the item itself (default 'logo' = no entry)
// Page screenshots captured by background.js live in storage 'shots' (local only, not synced).
import { hostOf } from './util.js';
import * as Icons from './icons.js';
import * as S from './settings.js';
import * as ImgCache from './imgcache.js';

let thumbs = {}, shots = {};
const listeners = [];

export async function load() {
  const r = await chrome.storage.local.get(['thumbs', 'shots', 'cardMig']);
  thumbs = r.thumbs || {};
  shots = r.shots || {};
  if (r.cardMig !== 1) {       // once: the "Use the item's cover" flags of versions 1.0.53-1.0.57 became the Card mode
    for (const [u, t] of Object.entries(thumbs)) {
      if (t?.mode !== 'auto' || t.auto !== 'pageview') continue;
      if (t.cover !== false && t.ytcover !== false && Icons.coverKind(u)) t.auto = 'card';   // a video / game / article of a known site
      delete t.cover; delete t.ytcover;
    }
    await chrome.storage.local.set({ thumbs, cardMig: 1 });
  }
  await ImgCache.load();
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.shots) { shots = ch.shots.newValue || {}; listeners.forEach((f) => f()); }   // a new page screenshot: redraw tiles
});

// Signature of everything a tile thumbnail depends on. A tile whose signature did not change keeps its thumbnail element
// when the grid is rebuilt (e.g. after a deletion), so icons do not flash. bump() forces a rebuild (refresh icons).
let gen = 0;
export const bump = () => { gen++; };
export const sigOf = (url) => [gen, url, S.get().hiResIcons ? 1 : 0, JSON.stringify(thumbs[url] || null), shots[url]?.dataUrl?.length || 0].join('|');
export const all = () => thumbs;
export const getT = (url) => thumbs[url] || { mode: 'auto', auto: 'logo' };
export const onChange = (f) => listeners.push(f);
const persist = () => chrome.storage.local.set({ thumbs });

export async function setT(url, t) {
  if (!t || (t.mode === 'auto' && (t.auto === 'logo' || !t.auto) && !t.icon)) delete thumbs[url];
  else thumbs[url] = { ...t, ts: Date.now() };
  await persist();
  listeners.forEach((f) => f());
}
export async function rekey(oldUrl, newUrl) {
  if (thumbs[oldUrl] && oldUrl !== newUrl) {
    thumbs[newUrl] = thumbs[oldUrl];
    delete thumbs[oldUrl];
    await persist();
  }
}
export async function replaceAll(obj) { thumbs = obj; await persist(); }
// entries taken from the bookmark titles (see dialmeta.js)
export async function applyMany(map) {
  const now = Date.now();
  for (const [u, t] of Object.entries(map)) thumbs[u] = { ...t, ts: now };
  await persist();
}

export const faviconUrl = (pageUrl, size = 64) =>
  `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;

// Icon for an arbitrary site (search engines, suggestions): the browser's favicon cache only knows visited sites,
// so ask an icon service first and fall back to the local cache.
export function setSiteIcon(img, pageUrl, size = 32) {
  let origin = pageUrl;
  try { origin = new URL(pageUrl).origin; } catch { /* keep as is */ }
  const srcs = [
    `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&nfrp=2&url=${encodeURIComponent(origin)}&size=${size}`,
    faviconUrl(pageUrl, size),
  ];
  let k = 0;
  img.style.visibility = '';
  img.onerror = () => { if (++k < srcs.length) img.src = srcs[k]; else img.style.visibility = 'hidden'; };
  img.src = srcs[0];
}

// A badge drawn over the cover of a video, centred, 20% of the tile width (see .yt-badge in newtab.css):
// the YouTube logo for YouTube, a plain play button for any other video.
const BADGES = {
  yt: ['', '<svg viewBox="0 0 68 48" aria-hidden="true"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24S67.94 13.05 66.52 7.74z" fill="#f00"/><path d="M45 24 27 14v20z" fill="#fff"/></svg>'],
  play: [' play', '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="rgba(0,0,0,.62)"/><path d="M26 20 46 32 26 44z" fill="#fff"/></svg>'],
};
const makeBadge = (kind) => {
  const d = document.createElement('div');
  d.className = 'yt-badge' + BADGES[kind][0];
  d.innerHTML = BADGES[kind][1];
  return d;
};
// How a pageview picture sits in the tile: auto | fill | top | inside | blur (inside, on a blurred copy of itself).
// Auto: a screenshot from the top, a poster / book cover / product picture whose shape differs from the tile "inside + blur", the rest fills.
const COVER_FITS = { fill: 'cov', top: 'cov top', inside: 'cov contain', blur: 'cov contain' };
const BLUR_KINDS = ['movie', 'book', 'product', 'music', 'game', 'wiki'];
function coverFit(mode, kind, im, isShot) {
  if (COVER_FITS[mode]) return { cls: COVER_FITS[mode], blur: mode === 'blur' };
  if (isShot) return { cls: 'cov top' };
  if (BLUR_KINDS.includes(kind)) {
    const tile = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ratio')) || 1.34;
    const r = im.naturalWidth / (im.naturalHeight || 1);
    if (Math.abs(Math.log(r / tile)) > Math.log(1.25)) return { cls: 'cov contain', blur: true };
  }
  return { cls: 'cov' };
}

// onState (optional) reports the Pageview / Logo lookup: 'loading' | 'found' | 'none' | 'off'
export function renderThumbFrom(pageUrl, t, onState) {
  const box = document.createElement('div');
  box.className = 'thumb';
  const web = /^https?:/i.test(pageUrl);

  const logo = () => {
    box.replaceChildren();
    const img = new Image();
    img.className = 'fav'; img.draggable = false; img.alt = '';
    img.src = t.mode === 'auto' && t.auto !== 'wide' && t.icon ? ImgCache.use(t.icon) : faviconUrl(pageUrl, 128);
    img.onerror = () => {
      const l = document.createElement('div');
      l.className = 'letter';
      l.textContent = (hostOf(pageUrl)[0] || '?').toUpperCase();
      img.replaceWith(l);
    };
    box.append(img);
  };
  const upgradeLogo = () => {
    if (!S.get().hiResIcons || !web) return;
    Icons.resolve(pageUrl).then((hi) => {
      if (!hi) return;
      const big = new Image();
      big.onload = () => {
        const first = box.firstElementChild;
        if (first && first.classList.contains('cov')) return;
        big.className = 'fav'; big.draggable = false; big.alt = '';
        first ? first.replaceWith(big) : box.append(big);
      };
      big.src = hi;
    });
  };
  // o.fit: the Cover fit chosen for the tile (pageview pictures); o.kind / o.shot: what the picture is; o.badge: 'yt' | 'play'
  const showCover = (src, cls, onFail, o = {}) => {
    const im = new Image();
    im.className = cls; im.draggable = false; im.alt = '';
    im.onload = () => {
      let blur = false;
      if (o.fit) ({ cls: im.className, blur } = coverFit(o.fit, o.kind, im, o.shot));
      if (blur) { const bg = new Image(); bg.className = 'cov-bg'; bg.draggable = false; bg.alt = ''; bg.src = src; box.replaceChildren(bg, im); }
      else box.replaceChildren(im);
      if (o.badge) box.append(makeBadge(o.badge));
    };
    im.onerror = onFail || (() => {});
    im.src = src;
  };

  if (t.mode === 'auto') {
    logo();
    if (t.auto === 'pageview' || t.auto === 'card') {
      // Pageview: the page's preview image or a screenshot. Card: the picture of the ITEM itself (video cover, movie poster, book cover,
      // product photo - see Icons.previewInfo), never a screenshot, with a play badge on a video
      const card = t.auto === 'card', hi = S.get().hiResIcons, fit = t.cfit || 'auto';
      const shot = card ? null : shots[pageUrl]?.dataUrl;
      if (shot) { onState?.('found'); showCover(shot, 'cov top', upgradeLogo, { fit, shot: true }); }
      else if (web && (hi || (!card && Icons.shotServiceUrl(pageUrl)))) {
        onState?.('loading');
        (async () => {
          const info = hi ? await Icons.previewInfo(pageUrl, { item: card, needKind: !!onState }) : null;
          const src = info?.src, kind = info?.kind || null;
          if (src) {
            // the worker downloads the picture (no Referer, so hotlink protection does not block it) and the tile shows the copy;
            // a direct <img> is only the last resort
            const copy = await ImgCache.get(src);
            onState?.('found', kind);
            const badge = card && kind === 'video' ? (Icons.ytVideoId(pageUrl) ? 'yt' : 'play') : null;
            showCover(copy || src, 'cov', () => { onState?.('none', kind); upgradeLogo(); }, { fit, kind: card ? kind : null, badge });
            return;
          }
          const su = card ? null : Icons.shotServiceUrl(pageUrl);   // optional online screenshot (Settings > Icons & Previews)
          const shotCopy = su ? await ImgCache.get(su, { shot: true, maxAge: Icons.previewMaxAge() }) : null;
          if (shotCopy) { onState?.('found', kind); showCover(shotCopy, 'cov top', () => { onState?.('none', kind); upgradeLogo(); }, { fit, shot: true }); return; }
          onState?.('none', kind);
          upgradeLogo();
        })();
      } else { onState?.('off'); upgradeLogo(); }
    } else if (t.auto === 'wide') {
      // a wide (rectangular) logo of the site; until it is found - and when the site has none - the usual icon is shown
      const showWide = (src) => showCover(ImgCache.use(src), 'wide', upgradeLogo);
      if (t.icon) { onState?.('found'); showWide(t.icon); }
      else if (S.get().hiResIcons && web) {
        onState?.('loading');
        Icons.wide(pageUrl).then((src) => {
          onState?.(src ? 'found' : 'none');
          if (src) showWide(src); else upgradeLogo();
        });
      } else { onState?.('off'); upgradeLogo(); }
    } else if (!t.icon) upgradeLogo();
    return box;
  }
  const src = t.mode === 'file' ? t.dataUrl : ImgCache.use(t.url || '');
  if (!src) { logo(); upgradeLogo(); return box; }
  // fit: 'cover' = fill the tile, 'contain' = whole image inside, 'icon' = like a site icon (the Icon Size setting),
  // 'wide' = like a wide site logo
  showCover(src, t.fit === 'contain' ? 'cov contain' : t.fit === 'icon' ? 'fav' : t.fit === 'wide' ? 'wide' : 'cov', () => { logo(); upgradeLogo(); });
  return box;
}
// Vector placeholder for an empty thumbnail (no address yet): a browser window with a globe, crisp at any size.
// spin: the globe turns (two meridians sweep across it) - shown while the page is being checked
export function placeholderThumb(spin = false) {
  const box = document.createElement('div');
  box.className = 'thumb thumb-ph' + (spin ? ' spin' : '');
  box.innerHTML = `<svg viewBox="0 0 120 98" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="16" y="14" width="88" height="70" rx="9"/>
    <path d="M16 31h88"/>
    <circle cx="27" cy="22.5" r="1.9" fill="currentColor" stroke="none"/>
    <circle cx="34.5" cy="22.5" r="1.9" fill="currentColor" stroke="none"/>
    <circle cx="42" cy="22.5" r="1.9" fill="currentColor" stroke="none"/>
    <circle cx="60" cy="58" r="16"/>
    ${spin ? '<ellipse class="mer" cx="60" cy="58" rx="16" ry="16"/><ellipse class="mer b" cx="60" cy="58" rx="16" ry="16"/>' : '<ellipse cx="60" cy="58" rx="6.5" ry="16"/>'}
    <path d="M44 58h32M47 49.5h26M47 66.5h26"/>
  </svg>`;
  return box;
}
export const renderThumb = (url) => renderThumbFrom(url, getT(url));

// Scales an image file down (never up) and returns it as a data URL; scaleFor(w, h) is the wanted scale factor.
async function toDataUrl(file, scaleFor) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, scaleFor(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', 0.85);
  } catch {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
}
// Page background image: the longest side is limited to `max`.
export const fileToDataUrl = (file, max = 2560) => toDataUrl(file, (w, h) => max / Math.max(w, h));
// Custom tile preview: the SHORTER side is scaled down to 420px (smaller images are kept as they are);
// the longest side is capped at 4096px so that extremely narrow images still fit into a canvas.
export const previewDataUrl = (file, side = 420) => toDataUrl(file, (w, h) => Math.min(side / Math.min(w, h), 4096 / Math.max(w, h)));
