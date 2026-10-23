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
  simpleBatchDelete: sw('Simplified animation for group deletion (Dissolve)'),
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
  undoShow: sw('Show Undo bar'),
  undoAnchor: { type: 'select', label: 'Position', options: [['right', 'Bottom right'], ['center', 'Bottom center']], after: () => refreshAll() },
  undoSec: rng('Display time', 2, 20, 's'),
  undoOffset: { ...rng('', 0, 300, 'px'), label: () => (S.get().undoAnchor === 'center' ? 'Bottom offset' : 'Right and bottom offset') },
  folderSize: rng('Folder Window Size', 40, 100, '%'),
  gearAnchor: { type: 'select', label: 'Anchor', options: [['top', 'Top'], ['bottom', 'Bottom']], after: () => refreshAll() },
  gearSize: { ...rng('Size', 32, 64, 'px'), after: () => refreshAll() },
  gearAutoHide: sw('Auto hide'),
  gearRadius: rng('Appearance distance', 50, 600, 'px'),
  gearOffset: { ...rng('', 0, 300, 'px'), label: () => 'Offset (' + (S.get().gearAnchor === 'bottom' ? 'bottom' : 'top') + ' and right edge)' },
  animMs: rng('Transition duration (groups, folders)', 150, 900, 'ms', 10),
};

const ICON_DEP = ['iconRefreshEvery'];                       // greyed out while auto-refresh is off
const ANIM_DEP = ['animDelete', 'simpleBatchDelete', 'animReflow', 'animGroups', 'animFolders', 'animMs'];   // greyed out while animations are not available (OFF, or Auto without hardware acceleration)
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
// Deletion animation picker: the effects as chips (a click chooses one and plays it). The sample tile (it replays on click) is made too and is
// returned as box.stageCol: the page puts it BESIDE the card, not inside it.
function buildDeleteAnim() {
  const chips = el('div', 'fx');
  const box = chips;
  const btns = DELETE_ANIMS.map(([v, t]) => {
    const b = el('button', 'fxc'); b.type = 'button'; b.textContent = t; b.dataset.v = v;
    chips.append(b);
    return b;
  });
  const col = el('div', 'astage-col');
  const stage = el('div', 'anim-stage');
  stage.title = 'Click to replay';
  const tile = el('div', 'pv-tile', '<b>G</b><i>example.com</i>');
  stage.append(tile);
  col.append(stage);
  box.stageCol = col;
  let busy = false;
  const cur = () => (DELETE_ANIMS.some(([v]) => v === S.get().deleteAnim) ? S.get().deleteAnim : DEFAULT_ANIM);
  const play = async () => {
    if (busy) return;
    busy = true;
    try {
      await startDelete(cur(), tile, stage).done;
      tile.style.visibility = 'hidden';
      tile.getAnimations().forEach((a) => a.cancel());
      await new Promise((r) => setTimeout(r, 350));                // the tile comes back after the preview
      tile.style.visibility = '';
      tile.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
    } finally { busy = false; }
  };
  const paint = () => btns.forEach((b) => { const on = b.dataset.v === cur(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  btns.forEach((b) => { b.onclick = () => { S.set({ deleteAnim: b.dataset.v }); paint(); play(); }; });
  stage.onclick = play;
  extraRefresh.push(paint);
  paint();
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
// ----- Shortcuts: the browser keeps the keys of an extension's commands, so this shows the current key and opens the browser's own page to change it -----
const SC_SCHEME = /\bOPR\//.test(navigator.userAgent) ? 'opera' : /\bEdg\//.test(navigator.userAgent) ? 'edge' : navigator.brave ? 'brave' : 'chrome';
const SC_URL = SC_SCHEME + '://extensions/shortcuts';
const SC_COMMANDS = [['open-newtab', 'Open Startiles in a new tab']];
function buildShortcuts() {
  const box = el('div', 'afields');
  const keys = new Map();
  SC_COMMANDS.forEach(([id, label]) => {
    const r = el('div', 'row'), span = el('span'), k = el('kbd', 'sc-key');
    span.textContent = label;
    r.append(span, k);
    keys.set(id, k);
    box.append(r);
  });
  const paint = async () => {
    let all = [];
    try { all = await chrome.commands.getAll(); } catch { /* not available */ }
    keys.forEach((k, id) => {
      const c = all.find((x) => x.name === id), s = c && c.shortcut;
      k.textContent = s || 'Not set';
      k.classList.toggle('unset', !s);
    });
  };
  const btnRow = el('div', 'row'), b = el('button', 'pill sm', 'Change shortcuts…');
  const note = el('p', 'note');
  note.hidden = true;
  b.onclick = async () => {
    try { await chrome.tabs.create({ url: SC_URL }); }
    catch {                                                       // some browsers do not let an extension open that page: show the address instead
      note.textContent = 'Open this address in the browser: ' + SC_URL;
      note.hidden = false;
      try { await navigator.clipboard.writeText(SC_URL); note.textContent += ' (copied)'; } catch { /* no clipboard */ }
    }
  };
  btnRow.append(b);
  box.append(btnRow, note);
  extraRefresh.push(paint);
  window.addEventListener('focus', paint);                        // back from the browser's shortcuts page
  paint();
  return box;
}
function build(key, asSlider = false) {
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
  if (asSlider && d.type === 'select') {                         // a sliding switch instead of the dropdown (the select stays as the hidden value holder)
    inp.hidden = true;
    const n = d.options.length;
    const track = el('div', 'tslider');
    track.style.setProperty('--n', n);
    track.append(el('span', 'tthumb'));
    const btns = d.options.map(([v, t]) => {
      const b = el('button', 'topt'); b.type = 'button'; b.textContent = t; b.dataset.v = v;
      b.onclick = () => { if (inp.value === v) return; inp.value = v; inp.dispatchEvent(new Event('input')); };
      track.append(b);
      return b;
    });
    const paintSlider = () => {
      const i = Math.max(0, d.options.findIndex(([v]) => v === inp.value));
      track.style.setProperty('--i', i);
      btns.forEach((b, k) => b.classList.toggle('on', k === i));
    };
    inp.addEventListener('input', paintSlider);
    extraRefresh.push(paintSlider);
    lab.classList.add('slider-row');
    lab.append(track);
    requestAnimationFrame(paintSlider);
  }
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
// 24x24 line icons in front of the group headings of Appearance > Layout (the gear is the one of the settings button)
const SECTION_ICON = {
  groups: '<rect x="3" y="4" width="8" height="5" rx="1.5"/><rect x="13" y="4" width="8" height="5" rx="1.5"/><rect x="3" y="12" width="18" height="8" rx="2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  grid: '<rect x="3" y="3" width="5" height="5" rx="1.2"/><rect x="9.5" y="3" width="5" height="5" rx="1.2"/><rect x="16" y="3" width="5" height="5" rx="1.2"/><rect x="3" y="9.5" width="5" height="5" rx="1.2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2"/><rect x="16" y="9.5" width="5" height="5" rx="1.2"/><rect x="3" y="16" width="5" height="5" rx="1.2"/><rect x="9.5" y="16" width="5" height="5" rx="1.2"/><rect x="16" y="16" width="5" height="5" rx="1.2"/>',
  add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  tile: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 15h16"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
};
function section(title, keys, icon) {                          // icon: optional, a SECTION_ICON drawing shown before the heading
  const s = el('section'), h = el('h4', icon ? 'with-ico' : null, (icon ? `<svg class="hico" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` : '') + '<span></span>');
  h.lastChild.textContent = title;
  s.append(h);
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

// 24x24 line icons of the tabs (same drawing style as the About icons)
const TAB_ICON = {
  general: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  appearance: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.5-1.9-.3-1 .4-2.1 1.5-2.1H17a4 4 0 0 0 4-4c0-5-4-10-9-10z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15.5" cy="8" r="1"/>',
  animations: '<path d="M10 3l1.8 4.7 4.7 1.8-4.7 1.8L10 16l-1.8-4.7L3.5 9.5l4.7-1.8z"/><path d="M18 14v5M15.5 16.5h5"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
  layout: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
};

// Tab strip: nav gets one button per [id, label, pane, icon]; the choice is remembered in localStorage under `key`.
function makeTabs(nav, items, key) {
  const btns = [];
  const show = (id) => {
    btns.forEach(([i, b]) => b.classList.toggle('on', i === id));
    items.forEach(([i, , p]) => { p.hidden = i !== id; });
    try { localStorage.setItem(key, id); } catch {}
  };
  items.forEach(([id, label, , icon]) => {
    const b = el('button', null, (icon ? `<svg class="tabico" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` : '') + '<span></span>');
    b.lastChild.textContent = label; b.type = 'button'; b.onclick = () => show(id);
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
    section('Start Page', [build('source', true), 'theme', 'engine']),     // Mode first (the root folder button is only in Advanced Settings)
    section('Speed Dials', ['tileWidth', 'ratio', 'maxColumns', 'iconSize']),
  );
  const more = el('div', 'row');
  const advBtn = el('button', 'pill', 'Advanced Settings…');
  more.append(advBtn);
  quick.append(more);

  // ----- Advanced Settings: General | Appearance (Layout, Theme) | Animations | About -----
  const grid = (...cols) => { const g = el('div', 'advgrid'); cols.forEach((c) => { const d = el('div', 'advcol'); d.append(...c); g.append(d); }); return g; };
  const pane = (...kids) => { const p = el('div', 'tabpane'); p.hidden = true; p.append(...kids); return p; };

  // General and Layout are columns of cards (as Animations): icon, title and a line of explanation, an optional switch in the header,
  // and the settings below in two columns. A part whose own switch is off is only faded (it can still be set).
  const swOf = (key) => build(key).querySelector('input');         // the switch alone: it keeps its link with the setting
  const card = (ico, title, desc, head, ...body) => {
    const c = el('div', 'acard'), h = el('div', 'acard-h', `<svg class="aico" viewBox="0 0 24 24" aria-hidden="true">${ico}</svg><span class="acard-t"><b></b><small></small></span>`);
    h.querySelector('b').textContent = title; h.querySelector('small').textContent = desc;
    if (head) { head.setAttribute('aria-label', head.getAttribute('aria-label') || title); h.append(head); }
    c.append(h, ...body);
    return c;
  };
  const fields = (...rows) => { const d = el('div', 'afields'); d.append(...rows.map((r) => (typeof r === 'string' ? build(r) : r))); return d; };
  const dep = (key) => { const r = build(key); r.classList.add('dep'); return r; };   // a setting that belongs to the one above it: indented under it
  const subHead = (t) => { const h = el('h5', 'asub-h'); h.textContent = t; return h; };
  const cols = (left, right) => { const g = el('div', 'acols'); [left, right].forEach((k) => { const c = el('div', 'acol'); c.append(...k); g.append(c); }); return g; };
  const CARD_ICON = {
    mode: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/>',
    ...SECTION_ICON,
  };

  // ----- General: Mode and Search on the left, the icons on the right -----
  const pickRow = el('div', 'row');
  const pickBtn = el('button', 'pill sm', 'Choose root folder…');
  pickBtn.onclick = () => hooks.onPickRoot?.();
  pickRow.append(pickBtn);
  extraRefresh.push(() => { pickRow.hidden = S.get().source !== 'bookmarks'; });
  pickRow.hidden = S.get().source !== 'bookmarks';
  const bmGroupRow = build('showBmGroup');                      // only meaningful in the Bookmarks mode
  extraRefresh.push(() => { bmGroupRow.hidden = S.get().source !== 'bookmarks'; });
  bmGroupRow.hidden = S.get().source !== 'bookmarks';
  const modeCard = card(CARD_ICON.mode, 'Mode', 'Where your tiles come from.', null, fields(build('source', true), pickRow, bmGroupRow), el('p', 'note storage-note'));
  const searchCard = card(CARD_ICON.search, 'Search', 'The search engine and its suggestions.', null, fields('engine', 'searchSuggest'));
  const iconsCard = card(CARD_ICON.image, 'Icons & Previews', 'Site icons and page previews on the tiles.', null,
    fields('hiResIcons', 'iconAutoRefresh', dep('iconRefreshEvery'), 'pvService', 'pvServiceUrl', 'refreshIcons'), build('pvNote'));
  const keysCard = card('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>', 'Shortcuts', 'Keyboard shortcuts that work in any tab of the browser.', null, buildShortcuts());
  const general = pane(cols([modeCard, searchCard], [iconsCard, keysCard]));

  // ----- Layout: the page from top to bottom on the left; the tile, the windows and the settings icon on the right -----
  const searchFields = fields('searchTop');
  const addFields = fields('addAnchor', 'addOffset');
  const undoFields = fields('undoAnchor', 'undoSec', 'undoOffset');
  const radiusRow = dep('gearRadius');
  const gearFields = fields('gearAutoHide', radiusRow, 'gearAnchor', 'gearSize', 'gearOffset');
  const longRow = dep('showLongTitle');
  extraRefresh.push(() => {
    searchFields.classList.toggle('sub-off', !S.get().showSearch);
    addFields.classList.toggle('sub-off', !S.get().showAdd);
    undoFields.classList.toggle('sub-off', !S.get().undoShow);
    radiusRow.classList.toggle('sub-off', !S.get().gearAutoHide);
    longRow.classList.toggle('sub-off', !S.get().showTitles);
  });
  const tilesCard = card(CARD_ICON.tile, 'Tiles', 'Size, shape and captions of a tile.', null,
    subHead('Size & shape'), fields('tileWidth', 'ratio', 'tileRadius', 'iconSize'),
    subHead('Shown on each tile'), fields('showTitles', longRow, 'showDelete'));
  const layout = el('div');
  layout.append(cols(
    [card(CARD_ICON.groups, 'Groups Bar', 'Tabs for switching between groups.', null, fields('groupsTop', 'groupsMaxPx', 'groupsMaxPct', 'groupsSticky')),
     card(CARD_ICON.search, 'Search Field', 'The search box above the tiles.', swOf('showSearch'), searchFields),
     card(CARD_ICON.grid, 'Speed Dial Grid', 'Where the tiles start, columns and spacing.', null, fields('gridTop', 'maxColumns', 'gapX', 'gapY')),
     card(CARD_ICON.add, '+ Shortcut Button', 'The button that adds a new tile.', swOf('showAdd'), addFields),
     card('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', 'Undo Bar', 'The bar that offers to bring back a deleted tile (Ctrl+Z works too).', swOf('undoShow'), undoFields)],
    [tilesCard,
     card(CARD_ICON.folder, 'Folder Window', 'The size of an opened folder.', null, fields('folderSize')),
     card(CARD_ICON.gear, 'Settings Icon', 'The gear that opens Quick Settings.', null, gearFields)],
  ));
  // Theme: the left column = a gallery of themes (pick one, or start a new one) and the page background;
  // the right column = a live preview (click a part of it to change its colour), then the editor of the selected custom theme.
  const tt = ThemeUI.themeTab((f) => extraRefresh.push(f), refreshAll);
  const theme = el('div');
  theme.append(grid(
    [tt.gallerySec, section('Background', ['bgType', 'bgUrl', 'bgImage'])],
    [tt.sideSec],
  ));
  const subNav = el('div', 'subtabs'), subPanes = [['layout', 'Layout', layout, TAB_ICON.layout], ['theme', 'Theme', theme, TAB_ICON.theme]];
  const appearance = pane(subNav, ...subPanes.map(([, , p]) => p));
  appearance.querySelectorAll(':scope > div:not(.subtabs)').forEach((p) => { p.hidden = true; p.style.marginTop = '4px'; });
  makeTabs(subNav, subPanes, 'msd-adv-subtab');

  // Animations: Auto / ON / OFF on top; with Auto a line says what the browser's hardware acceleration decided
  const animHint = el('div', 'note anim-note');
  extraRefresh.push(() => {
    const auto = S.get().animMode !== 'on' && S.get().animMode !== 'off', on = S.hwAccel();
    animHint.hidden = !auto;
    if (S.reducedMotion()) { animHint.replaceChildren('Your system asks to reduce motion, so animations are disabled. Choose ON to use them anyway.'); return; }
    const word = el('b', on ? 'on' : 'off', on ? 'ON' : 'OFF');
    word.title = S.hwDetails();                                  // what the check saw: shown only over ON / OFF
    animHint.replaceChildren('Hardware acceleration is ', word, on ? ', animations are working.' : ', animations are disabled.');
  });
  // The page is a column of cards: the master switch, then one card per animation with its own switch in the header.
  const AICO = {
    del: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    shift: '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="13" width="7" height="7" rx="1.5"/><path d="M13 7h6M16.5 4.5L19 7l-2.5 2.5"/>',
    groups: '<path d="M4 8h12M12 4l4 4-4 4M20 16H8M12 12l-4 4 4 4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    speed: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 3h6"/>',
  };
  const animCard = (...a) => { const c = card(...a); c.classList.add('anim-dep'); return c; };
  const master = el('div', 'acard master');
  const animRow = build('animMode', true);                  // Auto | ON | OFF as a sliding switch
  animRow.classList.add('strong');
  master.append(animRow, animHint);

  const delBox = build('deleteAnim');
  const batchRow = build('simpleBatchDelete'); batchRow.classList.remove('anim-dep'); batchRow.classList.add('asub');
  const delStage = delBox.stageCol;
  const delCard = animCard(AICO.del, 'Deleting a tile', 'Click an effect to choose it and see it play.', swOf('animDelete'), delBox, batchRow);
  const delRow = el('div', 'adel-row');            // the card on the left, the sample tile beside it on the right
  delRow.append(delCard, delStage);
  const speedRow = build('animMs'); speedRow.classList.remove('anim-dep');
  const grp = animCard(AICO.groups, 'Switching groups', 'Swipe between groups.', swOf('animGroups'));
  const fld = animCard(AICO.folder, 'Folders', 'Smooth opening and closing of folders.', swOf('animFolders'));
  const spd = animCard(AICO.speed, 'Transition speed', 'How long group and folder transitions take.', null, speedRow);
  const shf = animCard(AICO.shift, 'Tile shift', 'Tiles slide into the gap after a delete or a move.', swOf('animReflow'));
  const agrid = el('div', 'agrid');
  agrid.append(delRow, shf, grp, fld, spd);
  // a part whose own switch is off is dimmed (while animations are available at all: otherwise the whole card is already dimmed)
  extraRefresh.push(() => {
    const on = S.animOn(), g = S.get();
    [delBox, batchRow].forEach((n) => n.classList.toggle('dim', on && !g.animDelete));
    delStage.classList.toggle('dim', !on || !g.animDelete);
    speedRow.classList.toggle('dim', on && !g.animGroups && !g.animFolders);
  });
  const behavior = pane(master, agrid);
  document.addEventListener('msd-hw', () => refreshAll());     // the hardware probe finished (it runs when the browser is idle)
  extraRefresh.push(() => document.querySelectorAll('.anim-dep').forEach((n) => n.classList.toggle('dim', !S.animOn())));
  extraRefresh.push(() => document.querySelectorAll('.icon-dep').forEach((n) => n.classList.toggle('dim', !S.get().iconAutoRefresh)));

  const about = pane(buildAbout());
  adv.append(general, appearance, behavior, about);
  makeTabs($('#adv-tabs'), [['general', 'General', general, TAB_ICON.general], ['appearance', 'Appearance', appearance, TAB_ICON.appearance], ['behavior', 'Animations', behavior, TAB_ICON.animations], ['about', 'About', about, TAB_ICON.about]], 'msd-adv-tab');   // the id 'behavior' stays: it is what a remembered tab is stored as
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
