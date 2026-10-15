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
export function ensure(url) {
  if (cache[url] || pending.has(url) || (failed.get(url) || 0) > Date.now()) return;
  const p = fetchOne(url)
    .then((d) => { if (d) { cache[url] = { d, t: Date.now() }; persist(); } else failed.set(url, Date.now() + 10 * 60e3); })
    .catch(() => failed.set(url, Date.now() + 10 * 60e3))
    .finally(() => pending.delete(url));
  pending.set(url, p);
}

const readUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
async function fetchOne(url) {
  const got = await netCall('fetchImage', url, 8000);      // downloaded in the worker (see networker.js)
  if (!got) return null;
  const blob = new Blob([got.buf], { type: got.type });
  if (/svg/.test(blob.type)) return blob.size < 200000 ? readUrl(blob) : null;       // vector: kept as it is
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bmp.width * k));
  cv.height = Math.max(1, Math.round(bmp.height * k));
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/webp', 0.85);
}
