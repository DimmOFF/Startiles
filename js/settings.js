export const DEFAULTS = {
  tileWidth: 220, iconSize: 36, gapX: 28, gapY: 28,
  showTitles: true, showDelete: true, showAdd: true, showSearch: true,
  engine: 'google', hiResIcons: true, thumbBg: '#ffffff', pageBg: '#2b2b30',
  groupsTop: 12, searchTop: 60, folderSize: 90, animMs: 420,
  activeGroup: null, driveClientId: '', driveAuto: false,
};
let cache = { ...DEFAULTS };

export async function load() {
  const r = await chrome.storage.local.get('settings');
  cache = { ...DEFAULTS, ...(r.settings || {}) };
  return cache;
}
export const get = () => cache;
export async function set(patch) {
  Object.assign(cache, patch);
  applyCss();
  await chrome.storage.local.set({ settings: cache });
}
export function applyCss() {
  const s = cache, st = document.documentElement.style;
  st.setProperty('--tile-w', s.tileWidth + 'px');
  st.setProperty('--icon-size', s.iconSize + '%');
  st.setProperty('--gap-x', s.gapX + 'px');
  st.setProperty('--gap-y', s.gapY + 'px');
  st.setProperty('--thumb-bg', s.thumbBg);
  st.setProperty('--page-bg', s.pageBg);
  st.setProperty('--groups-top', s.groupsTop + 'px');
  st.setProperty('--search-top', s.searchTop + 'px');
  st.setProperty('--folder-size', s.folderSize);
  const b = document.body.classList;
  b.toggle('hide-titles', !s.showTitles);
  b.toggle('hide-del', !s.showDelete);
  b.toggle('hide-add', !s.showAdd);
  b.toggle('hide-search', !s.showSearch);
}
