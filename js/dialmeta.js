// Keeps the local thumbnail settings (chrome.storage) and the JSON titles of the bookmarks in step (Speed Dials mode).
//   JSON title -> local thumbnails: hydrate()   on every refresh: a tile that has icon_url in its title shows that image,
//                                               also on a device that has never seen it (no icon search needed)
//   local thumbnails -> JSON title: migrate()   once after the update, and after an Import
//   strip()                                     removes icon_url from the titles (Reset > User previews)
import * as M from './model.js';
import * as T from './thumbs.js';

const FLAG = 'titleMetaDone';
const FITS = ['cover', 'contain', 'icon', 'wide'];
const fitOf = (m) => (FITS.includes(m) ? m : 'cover');
let held = 0;
export const hold = () => { held++; };                              // while the edit dialog saves: do not hydrate from half-written data
export const release = () => { held = Math.max(0, held - 1); };

// the title-side description of a local thumbnail entry, or null when the thumbnail does not come from a URL
export function metaOfThumb(t) {
  if (!t) return null;
  if (t.mode === 'url' && t.url) return { icon_url: t.url, fit_mode: fitOf(t.fit) };
  if (t.mode === 'auto' && t.auto !== 'pageview' && t.icon) return { icon_url: t.icon, fit_mode: t.auto === 'wide' ? 'wide' : 'icon' };   // a picked site icon is shown like an "Icon size" (or wide icon) image
  return null;
}
function links(root) {
  const out = [];
  (function walk(n) { for (const c of n.children || []) { if (c.url) out.push(c); else walk(c); } })(root);
  return out;
}

export async function hydrate(root) {
  if (M.mode !== 'speeddial' || held) return false;
  const want = {};
  for (const n of links(root)) {
    const m = M.metaOf(n);
    if (!m.json || !m.icon_url) continue;
    const cur = metaOfThumb(T.all()[n.url]);
    if (cur && cur.icon_url === m.icon_url && cur.fit_mode === m.fit_mode) continue;
    want[n.url] = { mode: 'url', url: m.icon_url, fit: fitOf(m.fit_mode) };
  }
  if (!Object.keys(want).length) return false;
  await T.applyMany(want);
  return true;
}

export async function migrate(root, { force = false } = {}) {
  if (!force) {
    if (M.mode !== 'speeddial') return 0;
    if ((await chrome.storage.local.get(FLAG))[FLAG]) return 0;
  }
  let n = 0;
  for (const node of links(root)) {
    const p = M.parseTitle(node.title);
    if (p && p.icon_url) continue;                                   // already has its icon in the title
    const m = metaOfThumb(T.all()[node.url]);
    if (!m) continue;
    await M.update(node.id, { title: M.buildTitle(p ? p.name : node.title || '', m.icon_url, m.fit_mode) });
    n++;
  }
  if (!force) await chrome.storage.local.set({ [FLAG]: true });
  return n;
}

export async function strip(root) {
  for (const node of links(root)) {
    const p = M.parseTitle(node.title);
    if (p) await M.update(node.id, { title: p.name });
  }
}
