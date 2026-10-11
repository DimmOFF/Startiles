// Thumbnail metadata lives in chrome.storage.local, keyed by bookmark URL:
//   { mode: 'url'|'file', url?, dataUrl?, fit: 'cover'|'contain', ts }
// 'auto' = no entry (site icon on a coloured background).
import { hostOf } from './util.js';
import * as Icons from './icons.js';
import * as S from './settings.js';

let thumbs = {};
const listeners = [];

export async function load() { thumbs = (await chrome.storage.local.get('thumbs')).thumbs || {}; }
export const all = () => thumbs;
export const getT = (url) => thumbs[url] || { mode: 'auto' };
export const onChange = (f) => listeners.push(f);
const persist = () => chrome.storage.local.set({ thumbs });

export async function setT(url, t) {
  if (!t || t.mode === 'auto') delete thumbs[url];
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

export const faviconUrl = (pageUrl, size = 64) =>
  `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;

export function renderThumbFrom(pageUrl, t) {
  const box = document.createElement('div');
  box.className = 'thumb';
  const auto = () => {
    box.replaceChildren();
    const img = new Image();
    img.className = 'fav'; img.draggable = false; img.alt = '';
    img.src = faviconUrl(pageUrl, 128);
    img.onerror = () => {
      const l = document.createElement('div');
      l.className = 'letter';
      l.textContent = (hostOf(pageUrl)[0] || '?').toUpperCase();
      img.replaceWith(l);
    };
    box.append(img);
    if (S.get().hiResIcons && /^https?:/i.test(pageUrl)) {
      Icons.resolve(pageUrl).then((hi) => {
        if (!hi) return;
        const big = new Image();
        big.onload = () => {
          big.className = 'fav'; big.draggable = false; big.alt = '';
          box.firstElementChild?.replaceWith(big);
        };
        big.src = hi;
      });
    }
  };
  const src = t.mode === 'file' ? t.dataUrl : t.mode === 'url' ? t.url : null;
  if (!src) { auto(); return box; }
  const img = new Image();
  img.className = t.fit === 'contain' ? 'cov contain' : 'cov';
  img.draggable = false; img.alt = ''; img.src = src;
  img.onerror = auto;
  box.append(img);
  return box;
}
export const renderThumb = (url) => renderThumbFrom(url, getT(url));

export async function fileToDataUrl(file, max = 640) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
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
