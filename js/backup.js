// Export / Import. The user picks what goes into the file (or is taken from it):
//   settings     all options except themes, plus the page background image
//   themes       custom themes and the selected theme              (import: Add or Replace)
//   dials        the Startiles Speed Dial bookmark tree               (import: Add = merge, Replace)
//   userThumbs   what the user chose for tiles: custom images, picked icons, Pageview
//   cache        automatically fetched data: page screenshots, site icons, page previews
// Previews follow the Add / Replace choice of the Speed Dials.
import * as S from './settings.js';
import * as T from './thumbs.js';
import * as M from './model.js';
import * as Icons from './icons.js';
import { PRESETS } from './themes.js';

const FORMAT = 'startiles-backup';
const LEGACY_FORMATS = ['modern-speed-dial-backup'];   // backups made by earlier versions can still be imported
const THEME_KEYS = ['theme', 'customThemes'];
const strip = (n) => (n.url ? { title: n.title, url: n.url } : { title: n.title, children: (n.children || []).map(strip) });
const countLinks = (nodes) => nodes.reduce((a, n) => a + (n.url ? 1 : countLinks(n.children || [])), 0);
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const size = (o) => (isObj(o) ? Object.keys(o).length : 0);
const HEX = /^#[0-9a-f]{6}$/i;

export async function exportSelected(o) {
  const data = { format: FORMAT, version: 2, exportedAt: new Date().toISOString() };
  const cur = S.get();
  const res = {};
  if (o.settings) {
    const { bgSrc, ...settings } = cur;
    [...THEME_KEYS, 'activeGroup', 'modeChosen'].forEach((k) => delete settings[k]);
    data.settings = settings;
    data.bgSrc = bgSrc || '';
  }
  if (o.themes) { data.themes = { theme: cur.theme, customThemes: cur.customThemes || [] }; res.themes = (cur.customThemes || []).length; }
  if (o.dials) {
    const root = await M.getSd();
    data.tree = (root.children || []).map(strip);
    res.links = countLinks(data.tree); res.groups = data.tree.filter((n) => !n.url).length;
  }
  if (o.userThumbs) data.thumbs = T.all();
  if (o.cache) {
    const st = await chrome.storage.local.get(['shots', 'iconCache']);
    data.shots = st.shots || {}; data.iconCache = st.iconCache || {};
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `startiles-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return res;
}

// Reads a backup file (this version or the first one, where everything sat in `settings`).
// -> { data, avail: what the file contains, info: counts }
export async function readFile(file) {
  let raw;
  try { raw = JSON.parse(await file.text()); } catch { throw new Error('not a valid JSON file'); }
  if (!isObj(raw) || ![FORMAT, ...LEGACY_FORMATS].includes(raw.format)) throw new Error('this is not a Startiles backup');
  const old = isObj(raw.settings) ? raw.settings : null;
  const themes = isObj(raw.themes) ? raw.themes
    : old && (Array.isArray(old.customThemes) || typeof old.theme === 'string') ? { theme: old.theme, customThemes: old.customThemes || [] } : null;
  const settings = old && Object.fromEntries(Object.entries(old).filter(([k]) => k in S.DEFAULTS && !THEME_KEYS.includes(k) && k !== 'activeGroup' && k !== 'modeChosen'));
  const data = {
    settings, bgSrc: typeof raw.bgSrc === 'string' ? raw.bgSrc : '',
    themes: themes && { theme: typeof themes.theme === 'string' ? themes.theme : 'auto', customThemes: cleanThemes(themes.customThemes) },
    tree: Array.isArray(raw.tree) ? raw.tree : null,
    thumbs: isObj(raw.thumbs) ? raw.thumbs : null,
    shots: isObj(raw.shots) ? raw.shots : null,
    iconCache: isObj(raw.iconCache) ? raw.iconCache : null,
  };
  const avail = {
    settings: !!settings, themes: !!data.themes, dials: !!data.tree,
    userThumbs: size(data.thumbs) > 0, cache: size(data.shots) + size(data.iconCache) > 0,
  };
  if (!Object.values(avail).some(Boolean)) throw new Error('the file contains nothing to import');
  return {
    data, avail,
    info: { links: data.tree ? countLinks(data.tree) : 0, groups: data.tree ? data.tree.filter((n) => isObj(n) && !n.url).length : 0, themes: data.themes?.customThemes.length || 0 },
  };
}

function cleanThemes(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!isObj(t) || typeof t.id !== 'string' || !isObj(t.colors)) continue;
    const colors = Object.fromEntries(Object.entries(t.colors).filter(([, v]) => typeof v === 'string' && HEX.test(v)));
    out.push({ id: t.id, name: String(t.name || 'Theme').slice(0, 40), colors });
  }
  return out;
}

// Adds the imported nodes into `parentId` (whose current children are `existing`):
// folders with the same title are merged, links with the same address are skipped.
async function mergeInto(parentId, existing, nodes) {
  for (const n of nodes) {
    if (!isObj(n)) continue;
    if (typeof n.url === 'string') {
      if (!existing.some((c) => c.url === n.url)) await M.addLink(parentId, n.url, String(n.title ?? ''));
    } else {
      const title = String(n.title || 'Folder'), same = existing.find((c) => !c.url && c.title === title);
      if (same) await mergeInto(same.id, same.children || [], n.children || []);
      else { const f = await M.addFolder(parentId, title); await mergeInto(f.id, [], n.children || []); }
    }
  }
}

// o = { settings, themes: {on, mode}, dials: {on, mode}, userThumbs, cache }, mode = 'add' | 'replace'.
// The caller reloads the page afterwards.
export async function importSelected(data, o) {
  const { bgSrc: _bg, ...cur } = S.get();
  let next = { ...cur }, touched = false;

  if (o.settings && data.settings) {
    for (const k of Object.keys(S.DEFAULTS)) {
      if (THEME_KEYS.includes(k) || k === 'v' || k === 'activeGroup' || k === 'modeChosen') continue;
      next[k] = k in data.settings ? data.settings[k] : S.DEFAULTS[k];
    }
    if (data.bgSrc) await chrome.storage.local.set({ bgSrc: data.bgSrc }); else await chrome.storage.local.remove('bgSrc');
    touched = true;
  }
  if (o.themes.on && data.themes) {
    const imported = data.themes.customThemes, have = next.customThemes || [];
    if (o.themes.mode === 'replace') {
      next.customThemes = imported;
      const ok = ['auto', ...Object.keys(PRESETS)].includes(data.themes.theme) || imported.some((t) => t.id === data.themes.theme);
      next.theme = ok ? data.themes.theme : 'auto';
    } else {
      const ids = new Set(have.map((t) => t.id)), names = new Set(have.map((t) => t.name)), add = [];
      for (const t of imported) {
        const same = have.find((h) => h.id === t.id);
        if (same && JSON.stringify(same.colors) === JSON.stringify(t.colors)) continue;      // already there
        let { id, name } = t;
        if (ids.has(id)) id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        if (names.has(name)) { let n = 2; while (names.has(`${t.name} (${n})`)) n++; name = `${t.name} (${n})`; }
        ids.add(id); names.add(name); add.push({ ...t, id, name });
      }
      next.customThemes = [...have, ...add];
    }
    touched = true;
  }
  if (touched) {
    await chrome.storage.local.set({ settings: next });
    try { localStorage.removeItem('msd-theme'); } catch { /* ignore */ }
  }

  const replace = o.dials.mode === 'replace';
  if (o.dials.on && data.tree) {
    const root = await M.getSd();
    if (replace) {
      for (const c of root.children || []) await M.remove(c);
      await mergeInto(M.sdId, [], data.tree);
    } else await mergeInto(M.sdId, root.children || [], data.tree);
    const after = await M.getSd();
    if (!(after.children || []).some((c) => !c.url)) await M.addFolder(M.sdId, 'General');
  }
  if (o.userThumbs && data.thumbs) await T.replaceAll(replace ? data.thumbs : { ...data.thumbs, ...T.all() });
  if (o.cache) {
    const st = await chrome.storage.local.get(['shots']);
    if (data.shots) await chrome.storage.local.set({ shots: replace ? data.shots : { ...data.shots, ...(st.shots || {}) } });
    if (data.iconCache) await Icons.merge(data.iconCache, replace);
  }
}
