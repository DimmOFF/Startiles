// Two data sources:
//  - Speed Dial: root = "Modern Speed Dial" folder (bookmarks root, falling back to "Other bookmarks")
//  - Bookmarks:  root = the folder chosen by the user (settings.bookmarksRootId), Bookmarks bar by default
// In both cases: top-level folders of the root = groups, everything inside = tiles / (nested) folders.
export const ROOT_TITLE = 'Modern Speed Dial';
export let rootId = null;   // folder currently shown
export let sdId = null;     // the "Modern Speed Dial" folder (used by Export / Import)
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
      if (c.title === ROOT_TITLE) mine.push({ c, d });
      walk(c, d + 1);
    });
  })(tree[0], 0);
  mine.sort((a, b) => a.d - b.d);

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
  sdId = node.id;
  return { node, note };
}

export async function ensureRoot(cfg = {}) {
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
  const { node, note } = await ensureSd();
  info.note = note;
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
