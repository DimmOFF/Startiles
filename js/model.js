// Two data sources:
//  - Speed Dial: root = "Startiles Speed Dial" folder (bookmarks root, falling back to "Other bookmarks")
//  - Bookmarks:  root = the folder chosen by the user (settings.bookmarksRootId), Bookmarks bar by default
// In both cases: top-level folders of the root = groups, everything inside = tiles / (nested) folders.
export const ROOT_TITLE = 'Startiles Speed Dial';
export const LEGACY_TITLES = ['Modern Speed Dial'];   // the folder of earlier versions: found and renamed, nothing is lost
export let rootId = null;   // folder currently shown
export let mode = 'speeddial';   // what is shown now: Speed Dials own folder, or the user's Bookmarks
export let sdId = null;     // the "Startiles Speed Dial" folder (used by Export / Import)
export const info = { path: '', note: '' };

const NOTE = 'The bookmarks root could not be used (browsers usually do not let extensions write there), so "Other bookmarks" is used.';

async function pathOf(id) {
  const parts = [];
  let cur = id;
  while (cur) {
    const [n] = await chrome.bookmarks.get(cur);
    if (!n.parentId) { parts.unshift('root'); break; }
    parts.unshift(n.title);
    cur = n.parentId;
  }
  return parts.join('\\');
}

export async function ensureSd() {
  const tree = await chrome.bookmarks.getTree();
  const top = tree[0].children;
  const other = top.find((n) => n.folderType === 'other') || top[1] || top[top.length - 1];
  let note = '';
  const mine = [];
  (function walk(n, d) {
    (n.children || []).forEach((c) => {
      if (c.url) return;
      if (c.title === ROOT_TITLE || LEGACY_TITLES.includes(c.title)) mine.push({ c, d, old: c.title !== ROOT_TITLE });
      walk(c, d + 1);
    });
  })(tree[0], 0);
  mine.sort((a, b) => a.old - b.old || a.d - b.d);               // a folder with the current name wins, then the shallowest

  let node = mine[0]?.c;
  if (node && node.parentId !== tree[0].id) {
    try { await chrome.bookmarks.move(node.id, { parentId: tree[0].id }); }   // try to bring it to the root
    catch { note = NOTE; }
  }
  if (!node) {
    try { node = await chrome.bookmarks.create({ parentId: tree[0].id, title: ROOT_TITLE }); }
    catch {
      note = NOTE;
      node = await chrome.bookmarks.create({ parentId: other.id, title: ROOT_TITLE });
    }
  }
  if (node.title !== ROOT_TITLE) {                              // an earlier version's folder: give it the new name
    try { node = await chrome.bookmarks.update(node.id, { title: ROOT_TITLE }); } catch { /* keep working with the old name */ }
  }
  sdId = node.id;
  return { node, note };
}

export async function ensureRoot(cfg = {}) {
  mode = cfg.source === 'bookmarks' ? 'bookmarks' : 'speeddial';
  info.note = '';
  if (cfg.source === 'bookmarks') {
    let node = null;
    if (cfg.bookmarksRootId) {                 // the folder chosen by the user
      try {
        [node] = await chrome.bookmarks.get(cfg.bookmarksRootId);
        if (node.url || !node.parentId) node = null;
      } catch { node = null; }
      if (!node) info.note = 'The chosen bookmarks folder no longer exists, so the Bookmarks bar is used. Choose another one in Advanced Settings.';
    }
    if (!node) {
      const tree = await chrome.bookmarks.getTree();
      const top = tree[0].children;
      node = top.find((n) => n.folderType === 'bookmarks-bar') || top[0];
    }
    rootId = node.id;
    info.path = await pathOf(rootId);
    return getRoot();
  }
  const { node } = await ensureSd();
  info.note = '';                                            // (the "root could not be used" remark is no longer shown)
  rootId = node.id;
  const sub = await getRoot();
  if (!(sub.children || []).some((c) => !c.url)) await chrome.bookmarks.create({ parentId: rootId, title: 'General' });
  info.path = await pathOf(rootId);
  return getRoot();
}
export async function isFolder(id) {
  if (!id) return false;
  try { const [n] = await chrome.bookmarks.get(id); return !n.url && !!n.parentId; } catch { return false; }
}
export const getRoot = async () => (await chrome.bookmarks.getSubTree(rootId))[0];
export const getSd = async () => { const { node } = await ensureSd(); return (await chrome.bookmarks.getSubTree(node.id))[0]; };

export const addLink = (parentId, url, title) => chrome.bookmarks.create({ parentId, title, url });
export const addFolder = (parentId, title, index) =>
  chrome.bookmarks.create(index == null ? { parentId, title } : { parentId, title, index });
export const update = (id, changes) => chrome.bookmarks.update(id, changes);
export const remove = (n) => (n.url ? chrome.bookmarks.remove(n.id) : chrome.bookmarks.removeTree(n.id));
// index = "insert before this position in the list as it was before the move" (Chrome semantics)
export const move = (id, parentId, index) =>
  chrome.bookmarks.move(id, index == null ? { parentId } : { parentId, index });

// Paths shown in the Reset dialog.
export async function sdPath() { const { node } = await ensureSd(); return pathOf(node.id); }
// The folder the "Bookmarks" source shows (the chosen folder, or the Bookmarks bar) = the user's own bookmarks.
export async function bookmarksPath(cfg = {}) {
  let node = null;
  if (cfg.bookmarksRootId) {
    try { [node] = await chrome.bookmarks.get(cfg.bookmarksRootId); if (node.url || !node.parentId) node = null; } catch { node = null; }
  }
  if (!node) {
    const tree = await chrome.bookmarks.getTree();
    const top = tree[0].children;
    node = top.find((n) => n.folderType === 'bookmarks-bar') || top[0];
  }
  return pathOf(node.id);
}

// ---- Speed Dials mode: the title of a link tile may be a JSON string {"name":"...","icon_url":"...","fit_mode":"..."}
// (icon_url/fit_mode only when the tile has an icon taken from a URL). It travels with the bookmark, so the icon syncs between devices.
const FITS = ['cover', 'contain', 'icon'];
export function parseTitle(title) {
  if (typeof title !== 'string' || title.charCodeAt(0) !== 123) return null;     // fast: JSON starts with "{"
  try {
    const o = JSON.parse(title);
    if (!o || typeof o !== 'object' || typeof o.name !== 'string') return null;
    return { name: o.name, icon_url: typeof o.icon_url === 'string' ? o.icon_url : '', fit_mode: FITS.includes(o.fit_mode) ? o.fit_mode : 'cover' };
  } catch { return null; }
}
// { name, icon_url, fit_mode, json } of a node; in Bookmarks mode (your own bookmarks) titles are never interpreted
export function metaOf(n) {
  const p = mode === 'speeddial' && n.url ? parseTitle(n.title) : null;
  return p ? { ...p, json: true } : { name: n.title || '', icon_url: '', fit_mode: '', json: false };
}
export const nameOf = (n) => metaOf(n).name;
export const buildTitle = (name, iconUrl, fit) =>
  iconUrl ? JSON.stringify({ name, icon_url: iconUrl, fit_mode: FITS.includes(fit) ? fit : 'cover' }) : name;
export const titleFor = (name, iconUrl, fit) => (mode === 'speeddial' ? buildTitle(name, iconUrl, fit) : name);
