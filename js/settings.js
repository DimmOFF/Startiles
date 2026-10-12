export const DEFAULTS = {
  tileWidth: 220, iconSize: 50, maxColumns: '0', gridTop: 70, addAnchor: 'bottom', addOffset: 16, v: 3, gapX: 28, gapY: 28,
  showTitles: true, showDelete: true, showAdd: true, showSearch: true,
  engine: 'google', searchSuggest: true, bgType: 'color', bgUrl: '', ratio: 1.22, tileRadius: 10, source: 'speeddial', bookmarksRootId: null, showLongTitle: true, groupsMaxPx: 1000, groupsMaxPct: 95, animDelete: true, animGroups: true, animFolders: true, hiResIcons: true, thumbBg: '#ffffff', pageBg: '#2b2b30',
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
  if (cache.bgSrc && !cache.bgSrc.startsWith('data:')) {      // older versions kept a URL in bgSrc
    cache.bgUrl = cache.bgSrc; cache.bgSrc = '';
    if (cache.bgType === 'image') cache.bgType = 'url';
    chrome.storage.local.remove('bgSrc');
    const { bgSrc, ...rest } = cache;
    chrome.storage.local.set({ settings: rest });
  }
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
  st.setProperty('--ratio', s.ratio);
  st.setProperty('--tile-radius', s.tileRadius + 'px');
  st.setProperty('--groups-max-px', s.groupsMaxPx + 'px');
  st.setProperty('--groups-max-pct', s.groupsMaxPct);
  st.setProperty('--add-offset', s.addOffset + 'px');
  const n = Number(s.maxColumns) || 0;
  st.setProperty('--grid-max', n ? `calc(${n} * var(--tile-w) + ${n - 1} * var(--gap-x) + 80px)` : 'none');
  const b = document.body.classList;
  b.toggle('hide-titles', !s.showTitles);
  b.toggle('hide-del', !s.showDelete);
  b.toggle('hide-add', !s.showAdd);
  b.toggle('hide-search', !s.showSearch);
  b.toggle('add-top', s.addAnchor === 'top');
  const src = s.bgType === 'url' ? s.bgUrl : s.bgType === 'image' ? s.bgSrc : '';
  b.toggle('bg-image', !!src);
  st.setProperty('--bg-image', src ? `url("${String(src).replace(/"/g, '%22')}")` : 'none');
  document.querySelectorAll('[data-bg]').forEach((x) => (x.hidden = x.dataset.bg !== s.bgType));
}
