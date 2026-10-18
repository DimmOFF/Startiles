// Cache of tile images by their URL (icons / images that a tile takes from a web address).
// The image is downloaded once, scaled down and kept as a data URL: later it is shown from here, without a network
// request and without looking for an icon again - which also makes a new device fast after the bookmarks have synced.
import { netCall } from './net.js';
const KEY = 'imgCache', MAX = 400, SIDE = 640;
let cache = {}, saveT;
const pending = new Map(), failed = new Map();

export async function load() { cache = (await chrome.storage.local.get(KEY))[KEY] || {}; }
export const all = () => cache;
export async function clear() { cache = {}; pending.clear(); failed.clear(); await chrome.storage.local.remove(KEY); }
export async function merge(obj, replace) {
  cache = replace ? { ...obj } : { ...obj, ...cache };
  await chrome.storage.local.set({ [KEY]: cache });
}
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const keys = Object.keys(cache);
    if (keys.length > MAX) keys.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0)).slice(0, keys.length - MAX).forEach((k) => delete cache[k]);
    chrome.storage.local.set({ [KEY]: cache });
  }, 800);
}

// What to put into <img src>: the cached copy if there is one, otherwise the URL itself (and the copy is fetched in the background)
export function use(url) {
  if (!url || !/^https?:/i.test(url)) return url;
  const c = cache[url];
  if (c) { c.t = Date.now(); return c.d; }
  ensure(url);
  return url;
}
// Like use(), but waits for the download: the cached data URL, or null when the image could not be fetched.
//   opts.maxAge  an older copy is downloaded again (the old copy stays when that fails)
//   opts.shot    a screenshot from an online service: slow (up to 25 s), checked (not a GIF placeholder, not tiny, not blank)
export async function get(url, opts = {}) {
  if (!url || !/^https?:/i.test(url)) return null;
  const c = cache[url];
  if (c && (!opts.maxAge || Date.now() - (c.ts || c.t || 0) < opts.maxAge)) { c.t = Date.now(); return c.d; }
  ensure(url, { ...opts, force: !!c });
  await pending.get(url);
  return cache[url]?.d || null;
}
export function ensure(url, opts = {}) {
  if ((cache[url] && !opts.force) || pending.has(url) || (failed.get(url) || 0) > Date.now()) return;
  const p = (opts.shot ? shotSlot(() => fetchOne(url, opts)) : fetchOne(url, opts))
    .then((d) => { if (d) { cache[url] = { d, t: Date.now(), ts: Date.now() }; persist(); } else failed.set(url, Date.now() + 10 * 60e3); })
    .catch(() => failed.set(url, Date.now() + 10 * 60e3))
    .finally(() => pending.delete(url));
  pending.set(url, p);
}

// online screenshot services are slow and rate limited: two requests at a time
let shotBusy = 0;
const shotWait = [];
function shotSlot(fn) {
  return new Promise((res, rej) => {
    const run = () => { shotBusy++; fn().then(res, rej).finally(() => { shotBusy--; shotWait.shift()?.(); }); };
    shotBusy < 2 ? run() : shotWait.push(run);
  });
}
const lumaSpread = (data) => {
  let lo = 255, hi = 0;
  for (let i = 0; i < data.length; i += 4) { const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; if (y < lo) lo = y; if (y > hi) hi = y; }
  return hi - lo;
};

const readUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
async function fetchOne(url, opts = {}) {
  const got = await netCall('fetchImage', url, opts.shot ? 25000 : 8000);      // downloaded in the worker (see networker.js)
  if (!got) return null;
  if (opts.shot && /gif/i.test(got.type)) return null;                          // "generating preview" placeholders are GIFs
  const blob = new Blob([got.buf], { type: got.type });
  if (/svg/.test(blob.type)) return blob.size < 200000 ? readUrl(blob) : null;       // vector: kept as it is
  const bmp = await createImageBitmap(blob);
  if (opts.shot) {
    if (bmp.width < 300) return null;
    const pc = document.createElement('canvas'); pc.width = pc.height = 24;
    const px = pc.getContext('2d'); px.drawImage(bmp, 0, 0, 24, 24);
    if (lumaSpread(px.getImageData(0, 0, 24, 24).data) < 10) return null;        // blank page
  }
  const k = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bmp.width * k));
  cv.height = Math.max(1, Math.round(bmp.height * k));
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/webp', 0.85);
}
