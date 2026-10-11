// Export / Import of everything the extension owns:
//  settings (+ background image), the Modern Speed Dial bookmark tree (groups, folders, links, order),
//  thumbnail metadata (auto / url / file / pageview), cached page screenshots and the icon cache.
import * as S from './settings.js';
import * as T from './thumbs.js';
import * as M from './model.js';

const FORMAT = 'modern-speed-dial-backup';
const strip = (n) => (n.url ? { title: n.title, url: n.url } : { title: n.title, children: (n.children || []).map(strip) });
const countLinks = (nodes) => nodes.reduce((a, n) => a + (n.url ? 1 : countLinks(n.children || [])), 0);
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

export async function exportAll() {
  const root = await M.getRoot();
  const tree = (root.children || []).map(strip);
  const st = await chrome.storage.local.get(['shots', 'iconCache']);
  const { bgSrc, ...settings } = S.get();
  delete settings.activeGroup;
  const data = {
    format: FORMAT, version: 1, exportedAt: new Date().toISOString(),
    settings, bgSrc: bgSrc || '', tree,
    thumbs: T.all(), shots: st.shots || {}, iconCache: st.iconCache || {},
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `modern-speed-dial-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return { links: countLinks(tree), groups: tree.filter((n) => !n.url).length };
}

// Returns null if the user cancelled. The caller reloads the page afterwards.
export async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('not a valid JSON file'); }
  if (!isObj(data) || data.format !== FORMAT || !Array.isArray(data.tree)) throw new Error('this is not a Modern Speed Dial backup');

  const root = await M.getRoot();
  const now = countLinks((root.children || []).map(strip));
  if (!confirm(
    `Import this backup?\n\nIt REPLACES the current settings, groups and shortcuts (${now} shortcuts now) ` +
    `with the backup (${countLinks(data.tree)} shortcuts, ${data.tree.filter((n) => !n.url).length} groups).`)) return null;

  for (const c of root.children || []) await M.remove(c);
  const build = async (parentId, nodes) => {
    for (const n of nodes) {
      if (!isObj(n)) continue;
      if (typeof n.url === 'string') await M.addLink(parentId, n.url, String(n.title ?? ''));
      else { const f = await M.addFolder(parentId, String(n.title || 'Folder')); await build(f.id, n.children || []); }
    }
  };
  await build(M.rootId, data.tree);
  if (!data.tree.some((n) => isObj(n) && typeof n.url !== 'string')) await M.addFolder(M.rootId, 'General');

  const settings = Object.fromEntries(Object.entries(isObj(data.settings) ? data.settings : {}).filter(([k]) => k in S.DEFAULTS));
  delete settings.activeGroup;
  await chrome.storage.local.set({
    settings,
    thumbs: isObj(data.thumbs) ? data.thumbs : {},
    shots: isObj(data.shots) ? data.shots : {},
    iconCache: isObj(data.iconCache) ? data.iconCache : {},
  });
  if (typeof data.bgSrc === 'string' && data.bgSrc) await chrome.storage.local.set({ bgSrc: data.bgSrc });
  else await chrome.storage.local.remove('bgSrc');
  return { links: countLinks(data.tree) };
}
