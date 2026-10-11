// Storage model: Bookmarks / Other bookmarks / "Modern Speed Dial" / <group> / (<link> | <folder> / <link>)
export const ROOT_TITLE = 'Modern Speed Dial';
export let rootId = null;

export async function ensureRoot() {
  const tree = await chrome.bookmarks.getTree();
  const top = tree[0].children;
  const other = top.find((n) => n.folderType === 'other') || top[1] || top[top.length - 1];
  let root = (other.children || []).find((n) => !n.url && n.title === ROOT_TITLE);
  if (!root) root = await chrome.bookmarks.create({ parentId: other.id, title: ROOT_TITLE });
  rootId = root.id;
  const sub = await getRoot();
  if (!(sub.children || []).some((c) => !c.url)) {
    await chrome.bookmarks.create({ parentId: rootId, title: 'General' });
  }
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
