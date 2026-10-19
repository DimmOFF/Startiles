// Builds the Quick Settings panel and the Advanced Settings window from one definition,
// so every control exists in both places and stays in sync.
import * as S from './settings.js';
import * as T from './thumbs.js';
import * as BackupUI from './backup-ui.js';
import * as Reset from './reset.js';
import { $, el, svg, ICON, closeOnBackdrop } from './util.js';
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
  bgType: { type: 'select', label: 'Page background', options: [['color', 'Color'], ['url', 'URL'], ['image', 'Image']] },
  bgImage: { type: 'bgimage' },
  tileWidth: rng('Tile Size', 120, 420, 'px', 2),
  tileRadius: rng('Tile Corner Size', 0, 32, 'px'),
  ratio: rng('Tile Ratio (W:H)', 1, 1.8, '', 0.01),
  maxColumns: { type: 'select', label: 'Maximum Columns', options: MAXCOLS },
  iconSize: rng('Icon Size in Thumbnail', 15, 80, '%'),
  gapX: rng('Horizontal Gap', 0, 80),
  gapY: rng('Vertical Gap', 0, 80),
  searchSuggest: sw('Search suggestions'),
  hiResIcons: sw('Try to fetch hi-res icons & previews'),
  iconAutoRefresh: { ...sw('Auto-refresh icons & previews'), after: () => refreshAll() },
  pvService: { type: 'select', label: 'Online screenshots (Pageview)', options: [['off', 'Off'], ['thumio', 'thum.io'], ['microlink', 'Microlink'], ['custom', 'Custom URL']], after: () => refreshAll() },
  iconRefreshEvery: { type: 'select', label: 'Refresh once a', options: [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']] },
  showBmGroup: { ...sw('Show default "Bookmarks" group'), after: () => hooks.onGroups?.() },
  showAdd: sw('Show Add Button'),
  showSearch: sw('Show Search Field'),
  showTitles: sw('Speed Dial Title'),
  showDelete: sw('Show Delete Button'),
  showLongTitle: sw('Show long title caption'),
  animMode: { type: 'select', label: 'Animations', options: [['auto', 'Auto'], ['on', 'ON'], ['off', 'OFF']], after: () => refreshAll() },
  animDelete: sw('Tile deletion animation'),
  animReflow: sw('Tile shift (after delete / move)'),
  animGroups: sw('Group switching (swipe)'),
  animFolders: sw('Folder transitions'),
  groupsMaxPx: rng('Group Bar Max Width', 300, 3000, 'px', 10),
  groupsMaxPct: rng('Group Bar Max Width (% of window)', 30, 100, '%'),
  source: { type: 'select', label: 'Mode', options: [['speeddial', 'Speed Dials'], ['bookmarks', 'Bookmarks']], after: () => { refreshAll(); hooks.onSource?.(); } },
  groupsTop: rng('Groups Bar Top Offset', 0, 200),
  groupsSticky: sw('Pin Groups Bar to the top'),
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
const ANIM_DEP = ['animDelete', 'animReflow', 'animGroups', 'animFolders', 'animMs'];   // greyed out while animations are not available (OFF, or Auto without hardware acceleration)
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
// Custom screenshot service: a template with {url} or {urlenc}; shown only for "Custom URL"
function buildPvServiceUrl() {
  const lab = el('label', 'row col', '<span>Service URL ({url} or {urlenc})</span>');
  const inp = el('input');
  inp.type = 'text';
  inp.placeholder = 'https://example.com/shot?u={urlenc}';
  inp.value = S.get().pvServiceUrl || '';
  inp.onchange = () => S.set({ pvServiceUrl: inp.value.trim() });
  lab.append(inp);
  const show = () => { lab.hidden = S.get().pvService !== 'custom'; };
  extraRefresh.push(show); show();
  return lab;
}
function build(key) {
  if (key === 'pvServiceUrl') return buildPvServiceUrl();
  if (key === 'pvNote') return el('p', 'note', 'Off by default. When on, the address of a Pageview tile that has no picture of its own is sent to this service to get a screenshot.');
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
  keys.forEach((k) => s.append(typeof k === 'string' ? build(k) : k));   // a key of a row, or a ready-made row element
  return s;
}

// ----- About tab: icon, version, project links, support -----
const REPO = 'https://github.com/dimmoff/Startiles', SITE = 'https://dimmoff.github.io/Startiles';
const ABOUT_ICON = {        // 24x24 line icons
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  bug: '<path d="M8 2l1.9 1.9M14.1 3.9L16 2M9 7.1v-1a3 3 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M21 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
};
const aboutIcon = (n) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ABOUT_ICON[n]}</svg>`;
function aboutCard(cls, icon, title, sub, href) {
  const a = el('a', 'about-card ' + cls, `<span class="ac-ico">${aboutIcon(icon)}</span><span class="ac-txt"><b></b><small></small></span>`);
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.querySelector('b').textContent = title;
  a.querySelector('small').textContent = sub;
  return a;
}
function buildAbout() {
  const m = chrome.runtime.getManifest();
  const box = el('div', 'about');
  const hero = el('div', 'about-hero');
  const logo = new Image();
  logo.src = chrome.runtime.getURL('icons/icon128-alt.png'); logo.alt = ''; logo.draggable = false;
  const name = el('h2'), tag = el('p', 'about-tag'), ver = el('span', 'about-ver');
  name.textContent = 'Startiles';
  tag.textContent = 'Speed Dial X Bookmarks Tile';
  ver.textContent = 'Version ' + m.version;
  hero.append(logo, name, tag, ver);

  const links = el('div', 'about-links');
  links.append(
    aboutCard('', 'github', 'GitHub', 'Source code, star the project', REPO),
    aboutCard('', 'tag', 'What\'s new', 'Releases and changelog', REPO + '/releases'),
    aboutCard('', 'bug', 'Report a problem', 'Bugs and ideas: open an issue', REPO + '/issues'),
    aboutCard('', 'shield', 'Privacy', 'Your data stays local', SITE + '/privacy/'),
    aboutCard('donate', 'heart', 'Support Startiles', 'Free and open source. Card or cryptocurrency: every bit helps', SITE + '/donate/'),
  );

  const foot = el('div', 'about-foot');
  const who = el('span'); who.textContent = 'Made by DimmOFF · MIT License';
  const copy = el('button', 'pill sm', 'Copy debug info'); copy.type = 'button';
  copy.title = 'Version, browser and mode: handy to attach to a bug report';
  copy.onclick = async () => {
    const text = `Startiles ${m.version}\n${navigator.userAgent}\nMode: ${S.get().source}, theme: ${S.get().theme}`;
    try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied ✓'; } catch { copy.textContent = 'Copy failed'; }
    setTimeout(() => { copy.textContent = 'Copy debug info'; }, 1600);
  };
  foot.append(who, copy);
  box.append(hero, links, foot);
  return box;
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

export function init({ engines, onEngine, onRefreshIcons, onSource, onPickRoot, onGroups }) {
  hooks = { onEngine, onRefreshIcons, onSource, onPickRoot, onGroups };
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
  const bmGroupRow = build('showBmGroup');                      // only meaningful in the Bookmarks mode
  extraRefresh.push(() => { bmGroupRow.hidden = S.get().source !== 'bookmarks'; });
  bmGroupRow.hidden = S.get().source !== 'bookmarks';
  dialSource.append(el('h4', null, 'Mode'), build('source'), pickRow, bmGroupRow, el('p', 'note storage-note'));

  const general = pane(grid(
    [dialSource, section('Search', ['engine', 'searchSuggest'])],
    [section('Icons & Previews', ['hiResIcons', 'iconAutoRefresh', 'iconRefreshEvery', 'pvService', 'pvServiceUrl', 'pvNote', 'refreshIcons'])],
  ));

  // Layout: left column = the page from top to bottom (each element with its own switch, position and size),
  // right column = how a tile looks, then the windows and the settings icon.
  const layout = grid(
    [section('Groups Bar', ['groupsTop', 'groupsMaxPx', 'groupsMaxPct', 'groupsSticky']),
     section('Search Field', ['showSearch', 'searchTop']),
     section('Speed Dial Grid', ['gridTop', 'maxColumns', 'gapX', 'gapY']),
     section('+ Shortcut Button', ['showAdd', 'addAnchor', 'addOffset'])],
    [section('Tiles', ['tileWidth', 'ratio', 'tileRadius', 'iconSize', 'showTitles', 'showLongTitle', 'showDelete']),
     section('Folder Window', ['folderSize']),
     section('Settings Icon', ['gearAutoHide', 'gearRadius', 'gearAnchor', 'gearSize', 'gearOffset'])],
  );
  // Theme: the choice of theme with its actions on top, then the colours grouped by what they paint.
  const ed = ThemeUI.editor((f) => extraRefresh.push(f), refreshAll);
  const themeSec = el('section');
  themeSec.append(ThemeUI.picker((f) => extraRefresh.push(f), refreshAll), ed.head);
  const theme = el('div');
  theme.append(themeSec, grid(
    [section('Page', ['bgType', 'bgUrl', 'bgImage', ed.rows.pageBg, ed.rows.folderBg]),
     section('Tiles', [ed.rows.thumbBg, ed.rows.label])],
    [section('Text & Accent', [ed.rows.text, ed.rows.muted, ed.rows.icon, ed.rows.accent]),
     section('Panels & Controls', [ed.rows.surface, ed.rows.field])],
  ));
  const subNav = el('div', 'subtabs'), subPanes = [['layout', 'Layout', layout], ['theme', 'Theme', theme]];
  const appearance = pane(subNav, ...subPanes.map(([, , p]) => p));
  appearance.querySelectorAll(':scope > div:not(.subtabs)').forEach((p) => { p.hidden = true; p.style.marginTop = '4px'; });
  makeTabs(subNav, subPanes, 'msd-adv-subtab');

  // Animations: Auto / ON / OFF on top; with Auto a line says what the browser's hardware acceleration decided
  const animHint = el('div', 'note anim-note');
  extraRefresh.push(() => {
    const auto = S.get().animMode !== 'on' && S.get().animMode !== 'off', on = S.hwAccel();
    animHint.hidden = !auto;
    const word = el('b', on ? 'on' : 'off', on ? 'ON' : 'OFF');
    word.title = S.hwDetails();                                  // what the check saw: shown only over ON / OFF
    animHint.replaceChildren('Hardware acceleration is ', word, on ? ', animations are working.' : ', animations are disabled.');
  });
  const animSec = el('section');
  const animRow = build('animMode');
  animRow.classList.add('strong');                           // the label is bold, like the group headings
  animSec.append(animRow, animHint);
  const behavior = pane(grid(
    [animSec, section('Tiles', ['animDelete', 'deleteAnim', 'animReflow'])],     // the list sits in the left column
    [section('Transitions', ['animGroups', 'animFolders', 'animMs'])],
  ));
  document.addEventListener('msd-hw', () => refreshAll());     // the hardware probe finished (it runs when the browser is idle)
  extraRefresh.push(() => document.querySelectorAll('.anim-dep').forEach((n) => n.classList.toggle('dim', !S.animOn())));
  extraRefresh.push(() => document.querySelectorAll('.icon-dep').forEach((n) => n.classList.toggle('dim', !S.get().iconAutoRefresh)));

  const about = pane(buildAbout());
  adv.append(general, appearance, behavior, about);
  makeTabs($('#adv-tabs'), [['general', 'General', general], ['appearance', 'Appearance', appearance], ['behavior', 'Behavior', behavior], ['about', 'About', about]], 'msd-adv-tab');
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
      rnote.textContent = `Only the "Startiles Speed Dial" folder (${i.sdPath}) is emptied. Your own bookmarks in ${i.bookmarksPath} will not be affected.`;
    } catch { /* the generic text stays */ }
  };
  rform.addEventListener('change', (e) => {
    if (e.target === chk('dials')) ['userThumbs', 'cache'].forEach((k) => { chk(k).checked = chk('dials').checked; });   // the previews go with the Speed Dials
    refreshReset(); showNote();
  });
  $('#reset-btn').onclick = () => { rform.reset(); refreshReset(); showNote(); rdlg.showModal(); };
  $('#reset-cancel').onclick = () => rdlg.close();
  closeOnBackdrop(rdlg);
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
