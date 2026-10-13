// Builds the Quick Settings panel and the Advanced Settings window from one definition,
// so every control exists in both places and stays in sync.
import * as S from './settings.js';
import * as T from './thumbs.js';
import * as BackupUI from './backup-ui.js';
import * as Reset from './reset.js';
import { $, el, svg, ICON } from './util.js';
import { DELETE_ANIMS, DEFAULT_ANIM, startDelete } from './delete-anims.js';
import * as ThemeUI from './theme-ui.js';

const controls = new Map();   // key -> [inputs]
const val = (k) => S.get()[k];
const read = (i) => (i.type === 'checkbox' ? i.checked : i.type === 'range' ? Number(i.value) : i.value);
function write(i, v) {
  if (i.type === 'checkbox') i.checked = !!v; else i.value = v;
  const o = i.closest('label')?.querySelector('output');
  if (o) o.textContent = i.value + (i.dataset.unit || '');
}
const extraRefresh = [];
const refreshAll = () => {
  controls.forEach((arr, k) => arr.forEach((i) => write(i, val(k))));
  extraRefresh.forEach((f) => f());
};

const MAXCOLS = [...[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => [String(n), String(n)]), ['0', 'Unlimited']];
const rng = (label, min, max, unit = 'px', step = 1) => ({ type: 'range', label, min, max, step, unit });
const sw = (label) => ({ type: 'switch', label });
const DEF = {
  bgType: { type: 'select', label: 'Page Background', options: [['color', 'Color'], ['url', 'URL'], ['image', 'Image']] },
  bgImage: { type: 'bgimage' },
  tileWidth: rng('Tile Size', 120, 420, 'px', 2),
  tileRadius: rng('Tile Corner Size', 0, 32, 'px'),
  ratio: rng('Tile Ratio (W:H)', 1, 1.7, '', 0.01),
  maxColumns: { type: 'select', label: 'Maximum Columns', options: MAXCOLS },
  iconSize: rng('Icon Size in Thumbnail', 15, 80, '%'),
  gapX: rng('Horizontal Gap', 0, 80),
  gapY: rng('Vertical Gap', 0, 80),
  searchSuggest: sw('Search suggestions'),
  hiResIcons: sw('Try to fetch hi-res icons & previews'),
  iconAutoRefresh: { ...sw('Auto-refresh icons & previews'), after: () => refreshAll() },
  iconRefreshEvery: { type: 'select', label: 'Refresh once a', options: [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']] },
  showAdd: sw('Show Add Button'),
  showSearch: sw('Show Search Field'),
  showTitles: sw('Speed Dial Title'),
  showDelete: sw('Show Delete Button'),
  showLongTitle: sw('Show long title caption'),
  noAnim: { type: 'switch', label: 'Disable all animations', after: () => refreshAll() },
  animDelete: sw('Tile deletion animation'),
  animReflow: sw('Tile shift (after delete / move)'),
  animGroups: sw('Group switching (swipe)'),
  animFolders: sw('Folder transitions'),
  groupsMaxPx: rng('Group Bar Max Width', 300, 3000, 'px', 10),
  groupsMaxPct: rng('Group Bar Max Width (% of window)', 30, 100, '%'),
  source: { type: 'select', label: 'Source', options: [['speeddial', 'Speed Dial'], ['bookmarks', 'Bookmarks']], after: () => { refreshAll(); hooks.onSource?.(); } },
  groupsTop: rng('Groups Bar Top Offset', 0, 200),
  searchTop: rng('Search Top Offset', 0, 300),
  gridTop: rng('Speed Dial Top Offset', 0, 300),
  addAnchor: { type: 'select', label: '+ Shortcut Anchor', options: [['bottom', 'Bottom of page'], ['top', 'Below tiles']] },
  addOffset: rng('+ Shortcut Offset', 0, 300),
  folderSize: rng('Folder Window Size', 40, 100, '%'),
  gearAnchor: { type: 'select', label: 'Anchor', options: [['top', 'Top'], ['bottom', 'Bottom']], after: () => refreshAll() },
  gearSize: { ...rng('Size', 32, 64, 'px'), after: () => refreshAll() },
  gearAutoHide: sw('Auto hide'),
  gearRadius: rng('Appearance distance', 50, 600, 'px'),
  gearOffset: { ...rng('', 0, 300, 'px'), label: () => 'Offset (' + (S.get().gearAnchor === 'bottom' ? 'bottom' : 'top') + ' and right edge)' },
  animMs: rng('Transition duration (groups, folders)', 150, 900, 'ms', 10),
};

const ICON_DEP = ['iconRefreshEvery'];                       // greyed out while auto-refresh is off
const ANIM_DEP = ['animDelete', 'animReflow', 'animGroups', 'animFolders', 'animMs'];   // greyed out while 'Disable all animations' is on
const syncBg = () => document.querySelectorAll('.bg-url').forEach((i) => { i.value = S.get().bgUrl || ''; });
const syncBgState = () => document.querySelectorAll('.bg-state').forEach((n) => {
  n.textContent = S.get().bgSrc ? 'Local image is in use' : 'No image selected';
});

// Page Background = URL: a link to an image
function buildBgUrl() {
  const box = el('div');
  box.dataset.bg = 'url';
  const lab = el('label', 'row col', '<span>Image URL</span>');
  const url = el('input', 'bg-url');
  url.type = 'text';
  url.placeholder = 'https://…/wallpaper.jpg';
  url.value = S.get().bgUrl || '';
  url.onchange = async () => { await S.set({ bgUrl: url.value.trim() }); syncBg(); };
  lab.append(url);
  box.append(lab);
  return box;
}
// Page Background = Image: a file from this computer
function buildBgImage() {
  const box = el('div');
  box.dataset.bg = 'image';
  const r = el('div', 'row');
  const choose = el('button', 'pill sm', 'Choose file…'), clear = el('button', 'pill sm', 'Remove');
  const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
  choose.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0];
    if (f) { await S.setBg(await T.fileToDataUrl(f, 2560)); syncBgState(); }
    file.value = '';
  };
  clear.onclick = async () => { await S.setBg(''); syncBgState(); };
  r.append(choose, clear, file);
  box.append(r, el('p', 'note bg-state'));
  return box;
}

let hooks = {}, engineMap = {};

// Search engine picker: a custom dropdown, because native <select> cannot show icons.
function buildEngine() {
  const row = el('div', 'row', '<span>Search Engine</span>');
  const dd = el('div', 'dd');
  const btn = el('button', 'dd-btn'); btn.type = 'button';
  const list = el('div', 'dd-list'); list.hidden = true;
  const icon = (origin) => {
    if (!origin) return el('span', 'bm-ico', svg(ICON.bookmark, 16));      // Bookmarks has no site icon
    const i = new Image(); i.alt = ''; i.draggable = false; T.setSiteIcon(i, origin, 32); return i;
  };
  const label = (t) => { const s = el('span'); s.textContent = t; return s; };
  const items = [];
  const paint = () => {
    const cur = S.get().engine in engineMap ? S.get().engine : 'google';
    const [name, , origin] = engineMap[cur];
    btn.replaceChildren(icon(origin), label(name), el('span', 'caret', '▾'));
    items.forEach(([k, it]) => it.classList.toggle('on', k === cur));
  };
  Object.entries(engineMap).forEach(([k, [name, , origin]]) => {
    const it = el('button', 'dd-item'); it.type = 'button';
    it.append(icon(origin), label(name));
    it.onclick = () => { S.set({ engine: k }); list.hidden = true; refreshAll(); hooks.onEngine(); };
    items.push([k, it]);
    list.append(it);
  });
  btn.onclick = (e) => { e.stopPropagation(); list.hidden = !list.hidden; };
  document.addEventListener('click', () => { list.hidden = true; });
  extraRefresh.push(paint);
  paint();
  dd.append(btn, list);
  row.append(dd);
  return row;
}
// Deletion animation picker: a dropdown plus a live preview on a sample tile (plays on change, on click and on the button).
function buildDeleteAnim() {
  const box = el('div', 'anim-pick');
  const lab = el('label', 'row', '<span>Deletion animation</span>');
  const sel = el('select');
  DELETE_ANIMS.forEach(([v, t]) => sel.append(new Option(t, v)));
  lab.append(sel);
  const stage = el('div', 'anim-stage');
  stage.title = 'Click to replay';
  const tile = el('div', 'pv-tile', '<b>G</b><i>example.com</i>');
  stage.append(tile);
  const foot = el('div', 'row');
  const replay = el('button', 'pill sm', '▶ Preview'); replay.type = 'button';
  foot.append(el('span', 'note', 'The tile comes back after the preview.'), replay);
  let busy = false;
  const play = async () => {
    if (busy) return;
    busy = true;
    try {
      await startDelete(sel.value, tile, stage).done;
      tile.style.visibility = 'hidden';
      tile.getAnimations().forEach((a) => a.cancel());
      await new Promise((r) => setTimeout(r, 350));
      tile.style.visibility = '';
      tile.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
    } finally { busy = false; }
  };
  const cur = () => (DELETE_ANIMS.some(([v]) => v === S.get().deleteAnim) ? S.get().deleteAnim : DEFAULT_ANIM);
  sel.value = cur();
  sel.onchange = () => { S.set({ deleteAnim: sel.value }); play(); };
  stage.onclick = replay.onclick = play;
  extraRefresh.push(() => { sel.value = cur(); });
  box.classList.add('anim-dep');
  box.append(lab, stage, foot);
  return box;
}
function build(key) {
  if (key === 'deleteAnim') return buildDeleteAnim();
  if (key === 'theme') return ThemeUI.picker((f) => extraRefresh.push(f), refreshAll);
  if (key === 'bgImage') return buildBgImage();
  if (key === 'bgUrl') return buildBgUrl();
  if (key === 'engine') return buildEngine();
  if (key === 'refreshIcons') {
    const r = el('div', 'row');
    const b = el('button', 'pill sm', 'Refresh site icons');
    b.onclick = () => hooks.onRefreshIcons();
    r.append(b);
    return r;
  }
  const d = DEF[key];
  const lab = el('label', 'row' + (d.type === 'range' ? ' col' : '') + (ANIM_DEP.includes(key) ? ' anim-dep' : '') + (ICON_DEP.includes(key) ? ' icon-dep' : ''));
  if (d.bg) lab.dataset.bg = d.bg;
  const span = el('span');
  const labelOf = () => (typeof d.label === 'function' ? d.label() : d.label);   // some labels depend on another setting
  span.textContent = labelOf();
  lab.append(span);
  if (typeof d.label === 'function') extraRefresh.push(() => { span.firstChild.nodeValue = labelOf(); });
  let inp;
  if (d.type === 'switch') { inp = el('input', 'switch'); inp.type = 'checkbox'; }
  else if (d.type === 'select') { inp = el('select'); d.options.forEach(([v, t]) => inp.append(new Option(t, v))); }
  else if (d.type === 'range') {
    inp = el('input'); inp.type = 'range'; inp.min = d.min; inp.max = d.max; inp.step = d.step || 1;
    span.append(' ', el('output'));
  } else { inp = el('input'); inp.type = 'color'; }
  inp.dataset.unit = d.unit || '';
  lab.append(inp);
  const arr = controls.get(key) || [];
  arr.push(inp);
  controls.set(key, arr);
  write(inp, val(key));
  inp.addEventListener('input', () => {
    const v = read(inp);
    S.set({ [key]: v });
    controls.get(key).forEach((o) => { if (o !== inp) write(o, v); else write(o, v); });
    d.after?.();
  });
  return lab;
}
function section(title, keys) {
  const s = el('section');
  s.append(el('h4', null, title));
  keys.forEach((k) => s.append(build(k)));
  return s;
}

// Tab strip: nav gets one button per [id, label, pane]; the choice is remembered in localStorage under `key`.
function makeTabs(nav, items, key) {
  const btns = [];
  const show = (id) => {
    btns.forEach(([i, b]) => b.classList.toggle('on', i === id));
    items.forEach(([i, , p]) => { p.hidden = i !== id; });
    try { localStorage.setItem(key, id); } catch {}
  };
  items.forEach(([id, label]) => {
    const b = el('button', null, label); b.type = 'button'; b.onclick = () => show(id);
    nav.append(b); btns.push([id, b]);
  });
  let saved = null;
  try { saved = localStorage.getItem(key); } catch {}
  show(items.some(([i]) => i === saved) ? saved : items[0][0]);
}

export function setStorageText(t) { document.querySelectorAll('.storage-note').forEach((n) => (n.textContent = t)); }

export const syncControls = () => refreshAll();

export function init({ engines, onEngine, onRefreshIcons, onSource, onPickRoot }) {
  hooks = { onEngine, onRefreshIcons, onSource, onPickRoot };
  engineMap = engines;
  const quick = $('#quick-body'), adv = $('#adv-body');

  quick.append(
    section('Start Page', ['theme', 'engine']),
    section('Speed Dials', ['tileWidth', 'ratio', 'maxColumns', 'iconSize']),
  );
  const more = el('div', 'row');
  const advBtn = el('button', 'pill', 'Advanced Settings…');
  more.append(advBtn);
  quick.append(more);

  // ----- Advanced Settings: General | Appearance (Layout, Theme) | Behavior -----
  const grid = (...cols) => { const g = el('div', 'advgrid'); cols.forEach((c) => { const d = el('div', 'advcol'); d.append(...c); g.append(d); }); return g; };
  const pane = (...kids) => { const p = el('div', 'tabpane'); p.hidden = true; p.append(...kids); return p; };

  const dialSource = el('section');
  const pickRow = el('div', 'row');
  const pickBtn = el('button', 'pill sm', 'Choose root folder…');
  pickBtn.onclick = () => hooks.onPickRoot?.();
  pickRow.append(pickBtn);
  extraRefresh.push(() => { pickRow.hidden = S.get().source !== 'bookmarks'; });
  pickRow.hidden = S.get().source !== 'bookmarks';
  dialSource.append(el('h4', null, 'Dial Source'), build('source'), pickRow, el('p', 'note storage-note'));

  const general = pane(grid(
    [dialSource, section('Search', ['engine', 'searchSuggest'])],
    [section('Icons & Previews', ['hiResIcons', 'iconAutoRefresh', 'iconRefreshEvery', 'refreshIcons'])],
  ));

  const layout = grid(
    [section('Speed Dials', ['tileWidth', 'ratio', 'maxColumns', 'iconSize', 'tileRadius', 'gapX', 'gapY']),
     section('Folder Window', ['folderSize']),
     section('Settings Icon', ['gearAutoHide', 'gearRadius', 'gearAnchor', 'gearSize', 'gearOffset'])],
    [section('Groups Bar', ['groupsMaxPx', 'groupsMaxPct', 'groupsTop']),
     section('Layout Offsets', ['searchTop', 'gridTop', 'addAnchor', 'addOffset']),
     section('Show / Hide', ['showAdd', 'showSearch', 'showTitles', 'showDelete', 'showLongTitle'])],
  );
  const themeSec = el('section');
  themeSec.append(el('h4', null, 'Theme'),
    ThemeUI.picker((f) => extraRefresh.push(f), refreshAll),
    ThemeUI.editor((f) => extraRefresh.push(f), refreshAll));
  const theme = el('div');
  theme.append(themeSec, section('Background', ['bgType', 'bgUrl', 'bgImage']));
  const subNav = el('div', 'subtabs'), subPanes = [['layout', 'Layout', layout], ['theme', 'Theme', theme]];
  const appearance = pane(subNav, ...subPanes.map(([, , p]) => p));
  appearance.querySelectorAll(':scope > div:not(.subtabs)').forEach((p) => { p.hidden = true; p.style.marginTop = '4px'; });
  makeTabs(subNav, subPanes, 'msd-adv-subtab');

  const behavior = pane(grid(
    [section('Animation', ['noAnim']), section('Tiles', ['animDelete', 'deleteAnim', 'animReflow'])],
    [section('Transitions', ['animGroups', 'animFolders', 'animMs'])],
  ));
  extraRefresh.push(() => document.querySelectorAll('.anim-dep').forEach((n) => n.classList.toggle('dim', !!S.get().noAnim)));
  extraRefresh.push(() => document.querySelectorAll('.icon-dep').forEach((n) => n.classList.toggle('dim', !S.get().iconAutoRefresh)));

  adv.append(general, appearance, behavior);
  makeTabs($('#adv-tabs'), [['general', 'General', general], ['appearance', 'Appearance', appearance], ['behavior', 'Behavior', behavior]], 'msd-adv-tab');
  refreshAll();
  syncBg();
  syncBgState();

  const panel = $('#settings'), dlg = $('#adv');
  $('#settings-btn').onclick = (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
    if (e.detail === 0 && panel.classList.contains('open')) {   // opened with Enter / Space
      setTimeout(() => panel.querySelector('select, input, button')?.focus({ preventScroll: true }), 60);
    }
  };
  $('#settings-close').onclick = () => panel.classList.remove('open');
  document.addEventListener('click', (e) => { if (!panel.contains(e.target) && !e.target.closest('#picker')) panel.classList.remove('open'); });
  // Export / Import (a window with check boxes, see backup-ui.js)
  const status = $('#backup-status');
  BackupUI.init({ status });

  // Reset to Default
  const rdlg = $('#reset-dlg'), rform = $('#reset-form'), rok = $('#reset-ok'), rnote = $('#reset-note');
  const chk = (k) => rform.querySelector(`[data-k="${k}"]`);
  const RK = ['settings', 'themes', 'dials', 'userThumbs', 'cache'];
  const refreshReset = () => { rok.disabled = !RK.some((k) => chk(k).checked); };
  const showNote = async () => {
    rnote.hidden = !chk('dials').checked;
    if (rnote.hidden) return;
    rnote.textContent = 'Your own bookmarks will not be affected.';
    try {
      const i = await Reset.dialsInfo();
      rnote.textContent = `Only the "Modern Speed Dial" folder (${i.sdPath}) is emptied. Your own bookmarks in ${i.bookmarksPath} will not be affected.`;
    } catch { /* the generic text stays */ }
  };
  rform.addEventListener('change', (e) => {
    if (e.target === chk('dials')) ['userThumbs', 'cache'].forEach((k) => { chk(k).checked = chk('dials').checked; });   // the previews go with the Speed Dials
    refreshReset(); showNote();
  });
  $('#reset-btn').onclick = () => { rform.reset(); refreshReset(); showNote(); rdlg.showModal(); };
  $('#reset-cancel').onclick = () => rdlg.close();
  rdlg.addEventListener('click', (e) => { if (e.target === rdlg) rdlg.close(); });
  rform.onsubmit = async (e) => {
    e.preventDefault();
    const o = Object.fromEntries(RK.map((k) => [k, chk(k).checked]));
    if (!RK.some((k) => o[k])) return;
    rok.disabled = true;
    try {
      await Reset.resetSelected(o);
      rdlg.close();
      status.textContent = 'Reset done, reloading…';
      setTimeout(() => location.reload(), 300);
    } catch (err) { rdlg.close(); status.textContent = 'Reset failed: ' + err.message; }
  };

  // Advanced window: non-modal (no dimming), freely movable by its title bar
  let pos = null;
  const place = () => {
    pos.x = Math.min(Math.max(pos.x, 0), innerWidth - 80);
    pos.y = Math.min(Math.max(pos.y, 0), innerHeight - 40);
    dlg.style.left = pos.x + 'px';
    dlg.style.top = pos.y + 'px';
  };
  const openAdv = () => {
    if (dlg.open) return;
    dlg.show();
    if (!pos) {
      const r = dlg.getBoundingClientRect();
      pos = { x: Math.max(12, (innerWidth - r.width) / 2), y: Math.max(12, (innerHeight - r.height) / 2) };
    }
    place();
  };
  advBtn.onclick = () => { panel.classList.remove('open'); openAdv(); };
  $('#adv-close').onclick = () => dlg.close();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dlg.open && !$('#picker').open && !rdlg.open && !$('#bk-dlg').open) dlg.close(); });
  // a press outside the window closes it (pressing inside and releasing outside, e.g. a slider drag, does not)
  document.addEventListener('pointerdown', (e) => {
    if (dlg.open && !e.composedPath().includes(dlg) && !$('#picker').open && !rdlg.open && !$('#bk-dlg').open) dlg.close();
  });
  window.addEventListener('resize', () => { if (pos && dlg.open) place(); });
  const head = dlg.querySelector('header');
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || !pos) return;
    head.setPointerCapture(e.pointerId);
    head.classList.add('dragging');
    const dx = e.clientX - pos.x, dy = e.clientY - pos.y;
    const move = (ev) => { pos.x = ev.clientX - dx; pos.y = ev.clientY - dy; place(); };
    const up = () => {
      head.classList.remove('dragging');
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  S.applyCss();
}
