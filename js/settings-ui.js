// Builds the Quick Settings panel and the Advanced Settings window from one definition,
// so every control exists in both places and stays in sync.
import * as S from './settings.js';
import * as T from './thumbs.js';
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
  bgType: { type: 'select', label: 'Page Background', options: [['color', 'Color'], ['image', 'Image']] },
  pageBg: { type: 'color', label: 'Background Color', bg: 'color' },
  bgImage: { type: 'bgimage' },
  tileWidth: rng('Thumbnail Size', 120, 420, 'px', 2),
  maxColumns: { type: 'select', label: 'Maximum Columns', options: MAXCOLS },
  iconSize: rng('Icon Size in Thumbnail', 15, 80, '%'),
  gapX: rng('Horizontal Gap', 0, 80),
  gapY: rng('Vertical Gap', 0, 80),
  thumbBg: { type: 'color', label: 'Tile Background Color' },
  hiResIcons: sw('Fetch hi-res icons & previews'),
  showAdd: sw('Show Add Button'),
  showSearch: sw('Show Search Field'),
  showTitles: sw('Speed Dial Title'),
  showDelete: sw('Show Delete Button'),
  groupsTop: rng('Groups Bar Top Offset', 0, 200),
  searchTop: rng('Search Top Offset', 0, 300),
  gridTop: rng('Speed Dial Top Offset', 0, 300),
  addAnchor: { type: 'select', label: '+ Shortcut Anchor', options: [['bottom', 'Bottom of page'], ['top', 'Below tiles']] },
  addOffset: rng('+ Shortcut Offset', 0, 300),
  folderSize: rng('Folder Window Size', 40, 100, '%'),
  animMs: rng('Folder Animation', 150, 900, 'ms', 10),
};

const syncBg = () => document.querySelectorAll('.bg-url').forEach((i) => {
  const v = S.get().bgSrc || '';
  i.value = v.startsWith('data:') ? '' : v;
  i.placeholder = v.startsWith('data:') ? '(local file in use)' : 'https://…/wallpaper.jpg';
});
async function applyBg(src) {
  await S.setBg(src);
  if (src) await S.set({ bgType: 'image' });
  refreshAll(); syncBg();
}
function buildBgImage() {
  const box = el('div');
  box.dataset.bg = 'image';
  const lab = el('label', 'row col', '<span>Image URL</span>');
  const url = el('input', 'bg-url');
  url.type = 'text';
  lab.append(url);
  const r = el('div', 'row');
  const choose = el('button', 'pill sm', 'Choose file…'), clear = el('button', 'pill sm', 'Remove');
  const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
  choose.onclick = () => file.click();
  file.onchange = async () => { const f = file.files[0]; if (f) await applyBg(await T.fileToDataUrl(f, 2560)); file.value = ''; };
  url.onchange = () => applyBg(url.value.trim());
  clear.onclick = () => applyBg('');
  r.append(choose, clear, file);
  box.append(lab, r);
  return box;
}

let hooks = {}, engineMap = {};

// Search engine picker: a custom dropdown, because native <select> cannot show icons.
function buildEngine() {
  const row = el('div', 'row', '<span>Search Engine</span>');
  const dd = el('div', 'dd');
  const btn = el('button', 'dd-btn'); btn.type = 'button';
  const list = el('div', 'dd-list'); list.hidden = true;
  const icon = (origin) => { const i = new Image(); i.src = T.faviconUrl(origin, 32); i.alt = ''; i.draggable = false; return i; };
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

export function init({ engines, onEngine, onRefreshIcons }) {
  hooks = { onEngine, onRefreshIcons };
  engineMap = engines;
  const quick = $('#quick-body'), adv = $('#adv-body');

  quick.append(
    section('Start Page', ['bgType', 'pageBg', 'thumbBg', 'bgImage', 'engine']),
    section('Speed Dials', ['tileWidth', 'maxColumns', 'iconSize']),
  );
  const more = el('div', 'row');
  const advBtn = el('button', 'pill', 'Advanced Settings…');
  more.append(advBtn);
  quick.append(more);

  const storage = el('section');
  storage.append(el('h4', null, 'Storage'), el('p', 'note storage-note'));
  adv.append(
    section('Start Page', ['bgType', 'pageBg', 'bgImage', 'engine']),
    section('Show / Hide', ['showAdd', 'showSearch', 'showTitles', 'showDelete']),
    section('Speed Dials', ['tileWidth', 'maxColumns', 'iconSize', 'gapX', 'gapY', 'thumbBg', 'hiResIcons', 'refreshIcons']),
    section('Layout Offsets', ['groupsTop', 'searchTop', 'gridTop', 'addAnchor', 'addOffset']),
    section('Folder Window', ['folderSize', 'animMs']),
    storage,
  );
  syncBg();

  const panel = $('#settings'), dlg = $('#adv');
  $('#settings-btn').onclick = (e) => { e.stopPropagation(); panel.classList.toggle('open'); };
  $('#settings-close').onclick = () => panel.classList.remove('open');
  document.addEventListener('click', (e) => { if (!panel.contains(e.target)) panel.classList.remove('open'); });
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dlg.open) dlg.close(); });
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
