// Storage model: <root>\Modern Speed Dial \ <group> \ (<link> | <folder> \ <link>)
// The folder is placed in the bookmarks root; if the browser refuses, "Other bookmarks" is used.
export const ROOT_TITLE = 'Modern Speed Dial';
export let rootId = null;
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

export async function ensureRoot() {
  const tree = await chrome.bookmarks.getTree();
  const top = tree[0].children;
  const other = top.find((n) => n.folderType === 'other') || top[1] || top[top.length - 1];
  info.note = '';

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
    catch { info.note = NOTE; }
  }
  if (!node) {
    try { node = await chrome.bookmarks.create({ parentId: tree[0].id, title: ROOT_TITLE }); }
    catch {
      info.note = NOTE;
      node = await chrome.bookmarks.create({ parentId: other.id, title: ROOT_TITLE });
    }
  }
  rootId = node.id;
  const sub = await getRoot();
  if (!(sub.children || []).some((c) => !c.url)) await chrome.bookmarks.create({ parentId: rootId, title: 'General' });
  info.path = await pathOf(rootId);
  return getRoot();
}
export const getRoot = async () => (await chrome.bookmarks.getSubTree(rootId))[0];

export const addLink = (parentId, url, title) => chrome.bookmarks.create({ parentId, title, url });
export const addFolder = (parentId, title, index) =>
  chrome.bookmarks.create(index == null ? { parentId, title } : { parentId, title, index });
export const update = (id, changes) => chrome.bookmarks.update(id, changes);
export const remove = (n) => (n.url ? chrome.bookmarks.remove(n.id) : chrome.bookmarks.removeTree(n.id));
// index = "insert before this position in the list as it was before the move" (Chrome semantics)
export const move = (id, parentId, index) =>
  chrome.bookmarks.move(id, index == null ? { parentId } : { parentId, index });
