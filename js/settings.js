import * as Themes from './themes.js';

export const DEFAULTS = {
  theme: 'auto', customThemes: [], animMode: 'auto',   // animMode: auto (follow hardware acceleration) | on | off
  tileWidth: 228, iconSize: 50, maxColumns: '6', gridTop: 80, addAnchor: 'bottom', addOffset: 44, v: 3, gapX: 38, gapY: 36,
  showTitles: true, showDelete: true, showAdd: true, showSearch: true,
  showBmGroup: true,                                         // Bookmarks mode: show the default "Bookmarks" group (links lying directly in the root folder)
  engine: 'google', searchSuggest: true, bgType: 'color', bgUrl: '', ratio: 1.34, tileRadius: 10, source: 'speeddial', bookmarksRootId: null, showLongTitle: true, groupsMaxPx: 1000, groupsMaxPct: 95, animDelete: true, deleteAnim: 'dust', animReflow: true, animGroups: true, animFolders: true, hiResIcons: true,
  groupsTop: 42, groupsSticky: true, searchTop: 70, folderSize: 70, animMs: 280,
  gearAnchor: 'top', gearSize: 50, gearOffset: 12, gearAutoHide: false, gearRadius: 150,      // settings icon: the same offset from the right edge and from the top / bottom edge
  iconAutoRefresh: true, iconRefreshEvery: 'month', pvService: 'off', pvServiceUrl: '',          // re-check site icons / page previews once a day | week | month | year
  activeGroup: null,
  engineByMode: { speeddial: 'google', bookmarks: 'bookmarks' },   // the search engine of each mode: switching the mode brings its own back
  modeChosen: false,                                         // the first-run question "Speed Dials or Bookmarks?" has been answered (asked again after Reset > Settings)
  lastFit: 'cover',                                          // last used Fit of an own thumbnail image (cover | contain | icon | wide): preselected for new ones
};
let cache = { ...DEFAULTS };

export async function load() {
  const r = await chrome.storage.local.get(['settings', 'bgSrc']);
  const st = r.settings || {};
  if ((st.v || 0) < 2) {           // migration: new defaults for animation / icon size, drop removed keys
    ['animMs', 'iconSize', 'speedDialType', 'rootLocation', 'vivaldiFolderId', 'vivaldiFolderName'].forEach((k) => delete st[k]);
  }
  if ((st.v || 0) < 6) {                                       // old defaults of the settings icon (32px, 14px) become the new ones (48px, 24px)
    if (st.gearSize === 32) delete st.gearSize;
    if (st.gearOffset === 14) delete st.gearOffset;
  }
  if ((st.v || 0) < 5 && st.folderSize === 90) delete st.folderSize;   // the old default (90%) becomes the new one (70%); a value you set yourself is kept
  if (r.settings && st.theme === undefined) {                // before themes: dark only, colours were separate settings
    const d = Themes.PRESETS.dark.colors;
    if ((st.pageBg && st.pageBg !== d.pageBg) || (st.thumbBg && st.thumbBg.toLowerCase() !== d.thumbBg)) {
      const id = Themes.newId();
      st.customThemes = [{ id, name: 'My theme', colors: { ...d, pageBg: st.pageBg || d.pageBg, thumbBg: st.thumbBg || d.thumbBg } }];
      st.theme = id;
    } else st.theme = 'dark';
  }
  delete st.pageBg; delete st.thumbBg;
  delete st.gearLeft;                                          // the separate left offset was replaced by one symmetric offset
  if (st.gearSize != null) st.gearSize = Math.max(32, st.gearSize);   // the minimum size of the settings icon is 32px
  ['driveClientId', 'driveAuto'].forEach((k) => delete st[k]);   // Google Drive sync was removed
  chrome.storage.local.remove('driveAuth');
  if ((st.v || 0) < 7) {                                       // new defaults: a value still equal to the old default becomes the new one; a value you set yourself is kept
    const OLD = { maxColumns: '0', tileWidth: 220, ratio: 1.22, gapX: 28, gapY: 28, gearSize: 48, gearOffset: 24, groupsTop: 12, searchTop: 60, gridTop: 70, addOffset: 16 };
    for (const k in OLD) if (st[k] === OLD[k]) delete st[k];
  }
  if (r.settings && st.modeChosen === undefined) st.modeChosen = true;   // an existing installation already works in some mode: do not ask
  if ((st.v || 0) < 8 && st.groupsSticky === false) delete st.groupsSticky;   // the pinned groups bar is now on by default (the old value was only the former default)
  if ('noAnim' in st) { if (st.noAnim === true) st.animMode = 'off'; delete st.noAnim; }   // 'Disable all animations' became the Animations list: Auto / ON / OFF
  st.engineByMode = { ...DEFAULTS.engineByMode, ...(st.engineByMode || {}) };
  if (st.engine) st.engineByMode[st.source === 'bookmarks' ? 'bookmarks' : 'speeddial'] = st.engine;   // the engine in use belongs to the mode in use
  cache = { ...DEFAULTS, ...st, v: 9, bgSrc: r.bgSrc || '' };
  if (cache.bgSrc && !cache.bgSrc.startsWith('data:')) {      // older versions kept a URL in bgSrc
    cache.bgUrl = cache.bgSrc; cache.bgSrc = '';
    if (cache.bgType === 'image') cache.bgType = 'url';
    chrome.storage.local.remove('bgSrc');
    const { bgSrc, ...rest } = cache;
    chrome.storage.local.set({ settings: rest });
  }
  scheduleHwProbe();
  return cache;
}
export const get = () => cache;
export async function set(patch) {
  patch = { ...patch };
  const modeOf = (s) => (s === 'bookmarks' ? 'bookmarks' : 'speeddial');
  const from = modeOf(cache.source), to = 'source' in patch ? modeOf(patch.source) : from;
  if ('engine' in patch) {                                       // an engine chosen now is remembered for the mode it is chosen in
    patch.engineByMode = { ...cache.engineByMode, [to]: patch.engine };
  } else if (to !== from) {                                      // another mode: its own engine comes back
    const m = { ...cache.engineByMode, [from]: cache.engine };
    patch.engineByMode = m;
    patch.engine = m[to] || DEFAULTS.engineByMode[to];
  }
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
  Themes.apply(s);
  st.setProperty('--groups-top', s.groupsTop + 'px');
  st.setProperty('--search-top', s.searchTop + 'px');
  st.setProperty('--folder-size', s.folderSize);
  st.setProperty('--grid-top', s.gridTop + 'px');
  st.setProperty('--ratio', s.ratio);
  st.setProperty('--tile-radius', s.tileRadius + 'px');
  st.setProperty('--groups-max-px', s.groupsMaxPx + 'px');
  st.setProperty('--groups-max-pct', s.groupsMaxPct);
  st.setProperty('--add-offset', s.addOffset + 'px');
  st.setProperty('--gear-size', s.gearSize + 'px');
  st.setProperty('--gear-off', s.gearOffset + 'px');
  st.setProperty('--gear-right', s.gearOffset + 'px');
  const n = Number(s.maxColumns) || 0;
  st.setProperty('--grid-max', n ? `calc(${n} * var(--tile-w) + ${n - 1} * var(--gap-x) + 80px)` : 'none');
  const b = document.body.classList;
  b.toggle('no-anim', !animOn());
  b.toggle('hide-titles', !s.showTitles);
  b.toggle('hide-del', !s.showDelete);
  b.toggle('hide-add', !s.showAdd);
  b.toggle('hide-search', !s.showSearch);
  b.toggle('groups-sticky', !!s.groupsSticky);
  b.toggle('add-top', s.addAnchor === 'top');
  const gb = s.gearAnchor === 'bottom';
  if (b.contains('gear-bottom') !== gb) {                      // the closed Quick Settings panel must not animate between its two hidden places (it flashed)
    b.add('gear-switch');
    b.toggle('gear-bottom', gb);
    requestAnimationFrame(() => requestAnimationFrame(() => b.remove('gear-switch')));
  }
  b.toggle('gear-autohide', !!s.gearAutoHide);
  const src = s.bgType === 'url' ? s.bgUrl : s.bgType === 'image' ? s.bgSrc : '';
  b.toggle('bg-image', !!src);
  st.setProperty('--bg-image', src ? `url("${String(src).replace(/"/g, '%22')}")` : 'none');
  document.querySelectorAll('[data-bg]').forEach((x) => (x.hidden = x.dataset.bg !== s.bgType));
}

// ---- hardware acceleration ----
// Without it (switched off in the browser, or a blocklisted GPU) the page is drawn by the CPU and animations stutter.
// A WebGL context that refuses to be created on a software renderer tells it. The probe runs once, when the browser is idle;
// its last result is remembered, so the very first paint already knows it.
let hw = true, hwInfo = null;
try { hw = localStorage.getItem('msd-hw') !== '0'; } catch { /* keep the default */ }
const FAIL = { failIfMajorPerformanceCaveat: true };
const SOFT = /swiftshader|llvmpipe|softpipe|software|basic render/i;
async function detectHw() {
  const info = { webgl: 'unavailable', renderer: '', webgpu: 'not supported', result: false };
  let ok = false;
  try {                                                         // WebGL: refused on a software renderer, and the renderer's name says it too
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', FAIL) || c.getContext('webgl', FAIL);
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      info.renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      ok = !SOFT.test(info.renderer);
      info.webgl = ok ? 'ok' : 'software renderer';
    }
  } catch { info.webgl = 'error'; }
  try {                                                         // WebGPU: a "fallback" adapter is the software one
    if (navigator.gpu) {
      const ad = await navigator.gpu.requestAdapter();
      if (!ad) info.webgpu = 'no adapter';
      else if (ad.isFallbackAdapter ?? ad.info?.isFallbackAdapter) { info.webgpu = 'fallback (software) adapter'; ok = false; }
      else info.webgpu = 'hardware adapter';
    }
  } catch { info.webgpu = 'error'; }
  info.result = ok;
  return info;
}
function scheduleHwProbe() {
  const run = async () => {
    hwInfo = await detectHw();
    console.info('[Startiles] hardware acceleration probe', hwInfo);
    try { localStorage.setItem('msd-hw', hwInfo.result ? '1' : '0'); } catch { /* ignore */ }
    if (hwInfo.result !== hw) { hw = hwInfo.result; applyCss(); }
    document.dispatchEvent(new Event('msd-hw'));                // the settings page shows the result
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 }); else setTimeout(run, 300);
}
export const hwAccel = () => hw;
// What the probe saw (shown as a tooltip on the hint in the settings): for finding out why a browser is judged the way it is.
export const hwDetails = () => (hwInfo ? `WebGL: ${hwInfo.webgl}${hwInfo.renderer ? ' (' + hwInfo.renderer + ')' : ''}. WebGPU: ${hwInfo.webgpu}.` : 'The check has not finished yet.');
// Are animations available at all? ON: yes, OFF: no, Auto: when hardware acceleration is on.
export const animOn = () => cache.animMode === 'on' || (cache.animMode !== 'off' && hw);
// Is the animation `key` (animDelete, animReflow, animGroups, animFolders) on? It needs its own switch and animOn().
export const anim = (key) => animOn() && !!cache[key];
