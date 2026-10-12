// Builds the Quick Settings panel and the Advanced Settings window from one definition,
// so every control exists in both places and stays in sync.
import * as S from './settings.js';
import * as T from './thumbs.js';
import * as Backup from './backup.js';
import { $, el } from './util.js';

const controls = new Map();   // key -> [inputs]
const read = (i) => (i.type === 'checkbox' ? i.checked : i.type === 'range' ? Number(i.value) : i.value);
function write(i, v) {
  if (i.type === 'checkbox') i.checked = !!v; else i.value = v;
  const o = i.closest('label')?.querySelector('output');
  if (o) o.textContent = i.value + (i.dataset.unit || '');
}
const extraRefresh = [];
const refreshAll = () => {
  controls.forEach((arr, k) => arr.forEach((i) => write(i, S.get()[k])));
  extraRefresh.forEach((f) => f());
};

const MAXCOLS = [...[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => [String(n), String(n)]), ['0', 'Unlimited']];
const rng = (label, min, max, unit = 'px', step = 1) => ({ type: 'range', label, min, max, step, unit });
const sw = (label) => ({ type: 'switch', label });
const DEF = {
  bgType: { type: 'select', label: 'Page Background', options: [['color', 'Color'], ['url', 'URL'], ['image', 'Image']] },
  pageBg: { type: 'color', label: 'Background Color', bg: 'color' },
  bgImage: { type: 'bgimage' },
  tileWidth: rng('Thumbnail Size', 120, 420, 'px', 2),
  tileRadius: rng('Dial Corner Radius', 0, 32, 'px'),
  ratio: rng('Speed Dial Ratio (W:H)', 1, 1.5, '', 0.01),
  maxColumns: { type: 'select', label: 'Maximum Columns', options: MAXCOLS },
  iconSize: rng('Icon Size in Thumbnail', 15, 80, '%'),
  gapX: rng('Horizontal Gap', 0, 80),
  gapY: rng('Vertical Gap', 0, 80),
  thumbBg: { type: 'color', label: 'Tile Background Color' },
  searchSuggest: sw('Search suggestions'),
  hiResIcons: sw('Fetch hi-res icons & previews'),
  showAdd: sw('Show Add Button'),
  showSearch: sw('Show Search Field'),
  showTitles: sw('Speed Dial Title'),
  showDelete: sw('Show Delete Button'),
  showLongTitle: sw('Show long title caption'),
  animDelete: sw('Tile deletion (shatter)'),
  animGroups: sw('Group switching (swipe)'),
  animFolders: sw('Folder transitions'),
  groupsMaxPx: rng('Group Bar Max Width', 300, 3000, 'px', 10),
  groupsMaxPct: rng('Group Bar Max Width (% of window)', 30, 100, '%'),
  source: { type: 'select', label: 'Source', options: [['speeddial', 'Speed Dial'], ['bookmarks', 'Bookmarks']], after: () => hooks.onSource?.() },
  groupsTop: rng('Groups Bar Top Offset', 0, 200),
  searchTop: rng('Search Top Offset', 0, 300),
  gridTop: rng('Speed Dial Top Offset', 0, 300),
  addAnchor: { type: 'select', label: '+ Shortcut Anchor', options: [['bottom', 'Bottom of page'], ['top', 'Below tiles']] },
  addOffset: rng('+ Shortcut Offset', 0, 300),
  folderSize: rng('Folder Window Size', 40, 100, '%'),
  animMs: rng('Folder Animation', 150, 900, 'ms', 10),
};

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
  const icon = (origin) => { const i = new Image(); i.alt = ''; i.draggable = false; T.setSiteIcon(i, origin, 32); return i; };
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
function build(key) {
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
  const lab = el('label', 'row' + (d.type === 'range' ? ' col' : ''));
  if (d.bg) lab.dataset.bg = d.bg;
  const span = el('span');
  span.textContent = d.label;
  lab.append(span);
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
  write(inp, S.get()[key]);
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

export function setStorageText(t) { document.querySelectorAll('.storage-note').forEach((n) => (n.textContent = t)); }

export const syncControls = () => refreshAll();

export function init({ engines, onEngine, onRefreshIcons, onSource, onPickRoot }) {
  hooks = { onEngine, onRefreshIcons, onSource, onPickRoot };
  engineMap = engines;
  const quick = $('#quick-body'), adv = $('#adv-body');

  quick.append(
    section('Start Page', ['bgType', 'pageBg', 'bgUrl', 'bgImage', 'thumbBg', 'engine', 'searchSuggest']),
    section('Speed Dials', ['tileWidth', 'ratio', 'maxColumns', 'iconSize']),
  );
  const more = el('div', 'row');
  const advBtn = el('button', 'pill', 'Advanced Settings…');
  more.append(advBtn);
  quick.append(more);

  const dialSource = el('section');
  const pickRow = el('div', 'row');
  const pickBtn = el('button', 'pill sm', 'Choose root folder…');
  pickBtn.onclick = () => hooks.onPickRoot?.();
  pickRow.append(pickBtn);
  extraRefresh.push(() => { pickRow.hidden = S.get().source !== 'bookmarks'; });
  pickRow.hidden = S.get().source !== 'bookmarks';
  dialSource.append(el('h4', null, 'Dial Source'), build('source'), pickRow, el('p', 'note storage-note'));
  const col1 = el('div', 'advcol'), col2 = el('div', 'advcol');
  col1.append(
    dialSource,
    section('Start Page', ['bgType', 'pageBg', 'bgUrl', 'bgImage', 'engine', 'searchSuggest']),
    section('Groups Bar', ['groupsMaxPx', 'groupsMaxPct']),
    section('Speed Dials', ['tileWidth', 'ratio', 'maxColumns', 'iconSize', 'tileRadius', 'gapX', 'gapY', 'thumbBg', 'hiResIcons', 'refreshIcons']),
  );
  col2.append(
    section('Folder Window', ['folderSize', 'animMs']),    
    section('Show / Hide', ['showAdd', 'showSearch', 'showTitles', 'showDelete', 'showLongTitle']),
    section('Layout Offsets', ['groupsTop', 'searchTop', 'gridTop', 'addAnchor', 'addOffset']),
    section('Animation', ['animDelete', 'animGroups', 'animFolders']),
  );
  adv.append(col1, col2);
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
  // Export / Import
  const status = $('#backup-status'), fileIn = $('#imp-file');
  $('#exp-btn').onclick = async () => {
    try { const r = await Backup.exportAll(); status.textContent = `Exported ${r.links} shortcuts`; }
    catch (e) { status.textContent = 'Export failed: ' + e.message; }
  };
  $('#imp-btn').onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      status.textContent = 'Importing…';
      const r = await Backup.importFile(f);
      if (!r) { status.textContent = ''; return; }
      status.textContent = 'Imported, reloading…';
      setTimeout(() => location.reload(), 400);
    } catch (e) { status.textContent = 'Import failed: ' + e.message; }
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dlg.open && !$('#picker').open) dlg.close(); });
  // a press outside the window closes it (pressing inside and releasing outside, e.g. a slider drag, does not)
  document.addEventListener('pointerdown', (e) => {
    if (dlg.open && !e.composedPath().includes(dlg) && !$('#picker').open) dlg.close();
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
