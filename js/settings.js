export const DEFAULTS = {
  tileWidth: 220, iconSize: 50, maxColumns: '0', gridTop: 70, addAnchor: 'bottom', addOffset: 16, v: 3, gapX: 28, gapY: 28,
  showTitles: true, showDelete: true, showAdd: true, showSearch: true,
  engine: 'google', bgType: 'color', hiResIcons: true, thumbBg: '#ffffff', pageBg: '#2b2b30',
  groupsTop: 12, searchTop: 60, folderSize: 90, animMs: 280,
  activeGroup: null,
};
let cache = { ...DEFAULTS };

export async function load() {
  const r = await chrome.storage.local.get(['settings', 'bgSrc']);
  const st = r.settings || {};
  if ((st.v || 0) < 2) {           // migration: new defaults for animation / icon size, drop removed keys
    ['animMs', 'iconSize', 'speedDialType', 'rootLocation', 'vivaldiFolderId', 'vivaldiFolderName'].forEach((k) => delete st[k]);
  }
  ['driveClientId', 'driveAuto'].forEach((k) => delete st[k]);   // Google Drive sync was removed
  chrome.storage.local.remove('driveAuth');
  cache = { ...DEFAULTS, ...st, v: 3, bgSrc: r.bgSrc || '' };
  return cache;
}
export const get = () => cache;
export async function set(patch) {
  Object.assign(cache, patch);
  applyCss();
  const { bgSrc, ...rest } = cache;                              // the big background image is stored separately
  await chrome.storage.local.set({ settings: rest });
}
export async function setBg(src) {
  cache.bgSrc = src || '';
  if (src) await chrome.storage.local.set({ bgSrc: src }); else await chrome.storage.local.remove('bgSrc');
  applyCss();
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
  st.setProperty('--grid-top', s.gridTop + 'px');
  st.setProperty('--add-offset', s.addOffset + 'px');
  const n = Number(s.maxColumns) || 0;
  st.setProperty('--grid-max', n ? `calc(${n} * var(--tile-w) + ${n - 1} * var(--gap-x) + 80px)` : 'none');
  const b = document.body.classList;
  b.toggle('hide-titles', !s.showTitles);
  b.toggle('hide-del', !s.showDelete);
  b.toggle('hide-add', !s.showAdd);
  b.toggle('hide-search', !s.showSearch);
  b.toggle('add-top', s.addAnchor === 'top');
  const img = s.bgType === 'image' && s.bgSrc;
  b.toggle('bg-image', !!img);
  st.setProperty('--bg-image', img ? `url("${s.bgSrc.replace(/"/g, '%22')}")` : 'none');
  document.querySelectorAll('[data-bg]').forEach((x) => (x.hidden = x.dataset.bg !== s.bgType));
}
