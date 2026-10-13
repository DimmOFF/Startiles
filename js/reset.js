// "Reset to Default": settings, themes and/or the Speed Dials. The user's own bookmarks are never touched:
// Speed Dials = only the "Startiles Speed Dial" folder. The previews are separate options:
//   userThumbs = what the user chose for tiles (custom images, picked icons, Pageview), cache = everything fetched automatically
//   (page screenshots, site icons, page previews).
import * as S from './settings.js';
import * as M from './model.js';
import * as T from './thumbs.js';
import * as Icons from './icons.js';

export async function dialsInfo() {
  return { sdPath: await M.sdPath(), bookmarksPath: await M.bookmarksPath(S.get()) };
}

export async function resetSelected({ settings, themes, dials, userThumbs, cache }) {
  if (dials) {
    const { node } = await M.ensureSd();
    if (![M.ROOT_TITLE, ...M.LEGACY_TITLES].includes(node.title)) throw new Error('unexpected folder, nothing was changed');   // safety: only our own folder
    const sd = (await chrome.bookmarks.getSubTree(node.id))[0];
    for (const c of sd.children || []) await M.remove(c);
    await M.addFolder(node.id, 'General');
  }
  if (userThumbs) await T.replaceAll({});
  if (cache) {
    await Icons.clear();
    await chrome.storage.local.remove('shots');
  }
  if (settings || themes) {
    const { bgSrc, ...next } = S.get();
    if (settings) {
      for (const k of Object.keys(S.DEFAULTS)) if (!['theme', 'customThemes', 'v'].includes(k)) next[k] = S.DEFAULTS[k];
      next.activeGroup = null;
      await chrome.storage.local.remove('bgSrc');            // the page background image belongs to the settings
    }
    if (themes) { next.theme = S.DEFAULTS.theme; next.customThemes = []; }
    await chrome.storage.local.set({ settings: next });
    try { localStorage.removeItem('msd-theme'); } catch { /* ignore */ }   // the colours cached for the next start
  }
}
