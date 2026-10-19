import { $, el, hostOf, normalizeUrl, svg, ICON } from './util.js';
import * as S from './settings.js';
import * as T from './thumbs.js';
import * as M from './model.js';
import * as DialMeta from './dialmeta.js';
import * as SettingsUI from './settings-ui.js';
import { pickFolder } from './folder-picker.js';
import * as Icons from './icons.js';
import * as Suggest from './suggest.js';
import * as SearchSuggest from './search-suggest.js';
import { playDelete } from './delete-anims.js';

const ENGINES = {
  google:     ['Google',      'https://www.google.com/search?q=%s',       'https://www.google.com'],
  bing:       ['Bing',        'https://www.bing.com/search?q=%s',         'https://www.bing.com'],
  duckduckgo: ['DuckDuckGo',  'https://duckduckgo.com/?q=%s',             'https://duckduckgo.com'],
  yandex:     ['Yandex',      'https://yandex.com/search/?text=%s',       'https://yandex.com'],
  brave:      ['Brave',       'https://search.brave.com/search?q=%s',     'https://search.brave.com'],
  ecosia:     ['Ecosia',      'https://www.ecosia.org/search?q=%s',       'https://www.ecosia.org'],
  yahoo:      ['Yahoo',       'https://search.yahoo.com/search?p=%s',     'https://search.yahoo.com'],
  startpage:  ['Startpage',   'https://www.startpage.com/do/search?q=%s', 'https://www.startpage.com'],
  bookmarks:  ['Bookmarks',   null,                                       null],   // not a web search: filters the bookmarks of all groups
};

const gridEl = $('#grid'), layer = $('#folder-layer'), nav = $('#groups'), dlg = $('#dlg'), ctx = $('#ctx');
let root = null, byId = new Map(), openId = null, curId = null, navStack = [], navBusy = false, dragId = null, dragIds = [], groupDragId = null, dropState = null, closing = false;

/* ---------- data refresh ---------- */
let rt;
const scheduleRefresh = () => {
  clearTimeout(rt);
  rt = setTimeout(() => (dragId || groupDragId ? scheduleRefresh() : refresh()), 60);
};
async function refresh() {
  root = await M.getRoot();
  await DialMeta.hydrate(root);                                 // icons stored in the bookmark titles -> thumbnails
  byId = new Map();
  (function walk(n) { byId.set(n.id, n); (n.children || []).forEach(walk); })(root);
  renderGroups();
  renderGrid();
  if (openId) {
    if (!byId.has(openId)) hideFolderNow();
    else {
      if (!byId.has(curId)) { curId = openId; navStack = []; }
      navStack = navStack.filter((x) => byId.has(x));
      renderFolderGrid();
    }
  }
}
// Bookmarks mode: links lying directly in the chosen root folder have no group of their own, so they get a virtual
// first group "Bookmarks". Its id is the id of the root folder itself, so adding / moving / reordering tiles in it works
// on the real bookmarks without any special case. Folders of the root are the other groups and are not shown in it;
// a folder created or dropped here lands in the root, i.e. it becomes a new group.
const BM_GROUP_TITLE = 'Bookmarks';
const bmGroupOn = () => M.mode === 'bookmarks' && S.get().showBmGroup !== false;
function groupList() {
  const gs = root.children.filter((c) => !c.url);
  if (bmGroupOn()) gs.unshift({ id: root.id, title: BM_GROUP_TITLE, virtual: true, parentId: root.parentId, children: root.children.filter((c) => c.url) });
  return gs;
}
function activeGroup() {
  const gs = groupList();
  return gs.find((g) => g.id === S.get().activeGroup) || gs[0];
}

/* ---------- groups ---------- */
function renderGroups() {
  const gs = groupList(), act = activeGroup();
  const hadFocus = nav.contains(document.activeElement);       // keep the keyboard focus across the re-render
  const focusKey = hadFocus ? (document.activeElement.dataset.id || (document.activeElement.classList.contains('add-group') ? 'add' : '')) : '';
  nav.replaceChildren();
  gs.forEach((g) => {
    const b = el('button', 'group' + (g.id === act?.id ? ' active' : ''));
    b.dataset.id = g.id;
    b.tabIndex = g.id === act?.id ? 0 : -1;                    // roving tabindex: Tab visits only the active group
    b.textContent = g.title;
    b.onclick = () => { clearBmFilter(); switchGroup(g); };
    if (!g.virtual) b.ondblclick = () => renameGroup(g);
    b.oncontextmenu = (e) => {
      e.preventDefault();
      showCtx(e.clientX, e.clientY, g.virtual
        ? [['Hide', hideBmGroup]]                          // the default group cannot be renamed or deleted, only hidden
        : [['Rename', () => renameGroup(g)], ['Delete', () => deleteGroup(g)]]);
    };
    b.draggable = !g.virtual;                             // groups can be re-ordered by dragging (the default group stays first)
    b.ondragstart = (e) => {
      groupDragId = g.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', g.id);
      requestAnimationFrame(() => b.classList.add('gdrag'));
    };
    b.ondragover = (e) => {
      if (dragId) {
        e.preventDefault(); b.classList.add('drop'); return;
      }
      if (!groupDragId || groupDragId === g.id) return;
      e.preventDefault();
      const r = b.getBoundingClientRect(), after = g.virtual || e.clientX > r.left + r.width / 2;   // nothing can go before the default group
      nav.querySelectorAll('.gdrop-before,.gdrop-after').forEach((x) => x.classList.remove('gdrop-before', 'gdrop-after'));
      b.classList.add(after ? 'gdrop-after' : 'gdrop-before');
    };
    b.ondragleave = () => b.classList.remove('drop', 'gdrop-before', 'gdrop-after');
    b.ondrop = async (e) => {
      e.preventDefault();
      if (groupDragId) {
        const id = groupDragId, after = b.classList.contains('gdrop-after');
        cleanDrag();
        const d = byId.get(id);
        if (d && d.id !== g.id) {
          const first = g.virtual ? root.children.find((c) => !c.url) : null;   // dropped on the default group = become the first real group
          if (g.virtual && !first) return;
          const ins = g.virtual ? first.index : g.index + (after ? 1 : 0);
          if (!(ins === d.index || ins === d.index + 1)) { await M.move(d.id, M.rootId, ins); scheduleRefresh(); }
        }
        return;
      }
      b.classList.remove('drop');
      const ids = dragList().slice(); cleanDrag();
      if (ids.length) { flipBegin(); for (const id of ids) await M.move(id, g.id); flipReady(); scheduleRefresh(); if (ids.length > 1) selExit(); }
    };
    nav.append(b);
  });
  const add = el('button', 'group add-group', '+');
  add.tabIndex = -1;
  add.title = 'New group';
  add.onclick = async () => {
    const name = await promptText('New group');
    if (!name) return;
    const g = await M.addFolder(M.rootId, name);
    await S.set({ activeGroup: g.id });
    scheduleRefresh();
  };
  nav.append(add);
  if (hadFocus) {
    const t = focusKey === 'add' ? add : (focusKey && nav.querySelector(`.group[data-id="${focusKey}"]`)) || nav.querySelector('.group.active');
    t?.focus({ preventScroll: true });
  }
}
// swipe all tiles away / in: towards the left when the target group is to the right, and vice versa
let switchTok = 0;
async function switchGroup(g) {
  const gs = groupList(), cur = activeGroup();
  if (!cur || g.id === cur.id) return;
  const dir = gs.indexOf(g) > gs.indexOf(cur) ? 1 : -1;      // +1: the new group is on the right
  const tok = ++switchTok;
  gridEl.getAnimations().forEach((a) => a.cancel());
  S.set({ activeGroup: g.id });
  renderGroups();
  if (!S.anim('animGroups')) { renderGrid(); return; }
  const ms = S.get().animMs, dist = Math.min(innerWidth * 0.12, 140);
  try {
    await gridEl.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * dist}px)`, opacity: 0 }],
      { duration: ms * 0.5, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' }).finished;
  } catch { return; }                                        // interrupted by a newer switch
  if (tok !== switchTok) return;
  renderGrid();
  gridEl.getAnimations().forEach((a) => a.cancel());
  gridEl.animate([{ transform: `translateX(${dir * dist}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: ms * 0.9, easing: 'cubic-bezier(.22,1,.36,1)' });
}
async function renameGroup(g) {
  const name = await promptText('Rename group', g.title);
  if (name) { await M.update(g.id, { title: name }); scheduleRefresh(); }
}
async function hideBmGroup() {
  await S.set({ showBmGroup: false });                        // it comes back with the check box in Advanced Settings > Mode
  SettingsUI.syncControls();
  clearBmFilter();
  renderGroups();
  renderGrid();
}
async function deleteGroup(g) {
  if (root.children.filter((c) => !c.url).length <= 1) return alert('At least one group is required.');
  if (!confirm(`Delete group "${g.title}" and everything in it?`)) return;
  await M.remove(g);
  scheduleRefresh();
}

/* ---------- tiles ---------- */
function folderThumb(n) {
  const f = el('div', 'thumb folder-thumb');
  const kids = n.children || [];
  for (let i = 0; i < 4; i++) {
    const c = el('div', 'cell'), k = kids[i];
    if (k && k.url) c.append(T.renderThumb(k.url));
    else c.innerHTML = `<div class="ph">${svg(k ? ICON.folder : ICON.bookmark, 26)}</div>`;
    f.append(c);
  }
  return f;
}
function tileEl(n, reuse) {
  const isF = !n.url;
  const t = el('div', 'tile' + (isF ? ' is-folder' : ''));
  t.dataset.id = n.id;
  t.draggable = true;
  const card = el(isF ? 'div' : 'a', 'card');
  if (!isF) { card.href = n.url; card.draggable = false; card.tabIndex = -1; }
  const label = el('div', 'label');
  if (isF) label.innerHTML = svg(ICON.folder, 15) + '<span></span>';
  else {
    const i = reuse?.ico || new Image();
    i.className = 'ico'; i.draggable = false; i.alt = '';
    if (!reuse?.ico) i.src = T.faviconUrl(n.url, 32);
    label.append(i, el('span'));
  }
  label.querySelector('span').textContent = M.nameOf(n) || (n.url ? hostOf(n.url) : 'Folder');   // only the name, never the JSON
  if (!isF) t.dataset.sig = T.sigOf(n.url);
  card.append(isF ? folderThumb(n) : reuse?.thumb || T.renderThumb(n.url), label);
  t.append(el('span', 'sel-box'));
  if (selMode && sel.has(n.id)) t.classList.add('selected');
  const tools = el('div', 'tools',
    `<button class="edit" title="Edit">${svg(ICON.pencil, 14)}</button><button class="del" title="Delete">${svg(ICON.trash, 14)}</button>`);
  t.append(card, tools);
  return t;
}
function fillGrid(g, node, emptyText) {
  const kids = node.children || [];
  const fl = flip && flip.ready ? flip : null;           // a deletion / move has just been applied
  // tiles whose thumbnail did not change keep their thumbnail element: nothing is fetched or redrawn, icons do not flash
  const keep = new Map();
  g.querySelectorAll(':scope > .tile[data-sig]').forEach((t) => {
    const thumb = t.querySelector('.thumb'), ico = t.querySelector('.label .ico');
    if (thumb && ico) keep.set(t.dataset.id, { sig: t.dataset.sig, thumb, ico });
  });
  const mk = (n) => { const k = n.url && keep.get(n.id); return tileEl(n, k && k.sig === T.sigOf(n.url) ? k : null); };
  if (!kids.length) g.replaceChildren(el('p', 'empty', emptyText));
  else g.replaceChildren(...kids.map(mk));

  kbApply();
  if (selMode) selPaint();
  if (fl && playFlip(g, fl.rects)) {                      // the same refresh may fill several grids, so close the window a bit later
    clearTimeout(flipTimer); flipTimer = setTimeout(() => { if (flip === fl) flip = null; }, 150);
  }
}

/* ---------- smooth shift of the tiles after a deletion or a move (FLIP) ---------- */
// flipBegin() right before the bookmark tree changes, flipReady() right after; the next render then slides every
// tile that survived from its old place to the new one.
let flip = null, flipTimer;
function flipBegin() {
  if (!S.anim('animReflow') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rects = new Map();
  document.querySelectorAll('.tile').forEach((t) => {
    const r = t.getBoundingClientRect();
    if (r.width) rects.set(t.dataset.id, { x: r.left, y: r.top });
  });
  flip = { rects, ready: false };
  clearTimeout(flipTimer); flipTimer = setTimeout(() => { flip = null; }, 2500);
}
const flipReady = () => { if (flip) flip.ready = true; };
function playFlip(grid, rects) {
  let n = 0;
  grid.querySelectorAll('.tile').forEach((t) => {
    const from = rects.get(t.dataset.id);
    if (!from) return;
    const r = t.getBoundingClientRect(), dx = from.x - r.left, dy = from.y - r.top;
    if (!dx && !dy) return;
    n++;
    t.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }],
      { duration: 520, easing: 'cubic-bezier(.65,0,.35,1)' });
  });
  return n;
}
const renderGrid = () => {
  if (bmFilterOn()) { renderResults(); return; }
  gridEl.classList.remove('search-results');
  nav.classList.remove('searching');
  const g = activeGroup();
  fillGrid(gridEl, g || { children: [] },
    g ? 'No shortcuts yet. Click “+ Shortcut” to add one.' : 'No folders found here. Click + above to create a group.');
};
const renderFolderGrid = () => {
  const n = byId.get(curId);
  if (!n) return;
  $('h2', layer).textContent = n.title;
  $('#f-back', layer).hidden = !navStack.length;
  fillGrid($('.fgrid', layer), n, 'This folder is empty. Drag shortcuts here or add one.');
};

function bindGrid(g, inFolder) {
  g.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const node = byId.get(tile.dataset.id);
    if (!node) return;
    if (e.target.closest('.edit')) return openItemDialog({ node });
    if (e.target.closest('.del')) return deleteNode(node);
    if (!node.url) return inFolder ? enterFolder(node.id) : openFolder(node.id, tile);
    { const th = T.getT(node.url); if (th.mode === 'auto' && th.auto === 'pageview') chrome.runtime.sendMessage({ msd: 'visit', url: node.url }).catch(() => {}); }   // the background screenshots the page that opens in this tab
    if (inFolder) {
      // The link opens now. Do not call history.back() for the folder's history entry here: while the target page
      // is still loading it would cancel the navigation, so the entry is simply left behind.
      sentinel = false;
      closeFolder(false);
    }
  });
  g.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    if (g.classList.contains('search-results')) { e.preventDefault(); return; }
    dragId = t.dataset.id;
    dragIds = selMode && sel.has(dragId) ? selIds() : [dragId];   // a selected tile drags the whole selection
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    if (dragIds.length > 1) { const b = el('div', 'drag-badge', dragIds.length + ' items'); document.body.append(b); e.dataTransfer.setDragImage(b, 14, 14); setTimeout(() => b.remove(), 0); }
    requestAnimationFrame(() => dragIds.forEach((i) => document.querySelector(`.tile[data-id="${i}"]`)?.classList.add('dragging')));
  });
  g.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    let t = e.target.closest('.tile'), mode = null;
    const Ds = dragList().map((i) => byId.get(i)).filter(Boolean);
    if (!t) {
      const last = [...g.querySelectorAll('.tile')].filter((x) => x.dataset.id !== dragId).pop();
      if (!last || e.target !== g) return;
      const r = last.getBoundingClientRect();
      if (e.clientY > r.bottom || (e.clientY >= r.top && e.clientX > r.right)) { t = last; mode = 'after'; } else return;
    }
    if (dragList().includes(t.dataset.id)) return;
    if (!mode) {
      const r = t.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      const Tn = byId.get(t.dataset.id);
      const canMerge = g.dataset.merge === '1' && Tn && Ds.length && Ds.every((d) => d.url || (!Tn.url && !isInside(Tn.id, d.id)));
      mode = canMerge && x > 0.28 && x < 0.72 ? 'into' : x < 0.5 ? 'before' : 'after';
    }
    setDrop(t, mode);
  });
  g.addEventListener('drop', (e) => { if (dragId) { e.preventDefault(); applyDrop(); } });
}
function isInside(id, ancestorId) {
  for (let n = byId.get(id); n; n = byId.get(n.parentId)) if (n.id === ancestorId) return true;
  return false;
}
function setDrop(t, mode) {
  if (dropState && (dropState.el !== t || dropState.mode !== mode)) clearDropMarks();
  t.classList.add('drop-' + mode);
  dropState = { el: t, targetId: t.dataset.id, mode };
}
function clearDropMarks() {
  document.querySelectorAll('.drop-into,.drop-before,.drop-after').forEach((x) =>
    x.classList.remove('drop-into', 'drop-before', 'drop-after'));
  dropState = null;
}
function cleanDrag() {
  clearDropMarks();
  document.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
  document.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
  layer.classList.remove('out-drop');
  document.querySelectorAll('.gdrag,.gdrop-before,.gdrop-after').forEach((x) => x.classList.remove('gdrag', 'gdrop-before', 'gdrop-after'));
  dragId = null; dragIds = []; groupDragId = null;
}
const dragList = () => (dragIds.length ? dragIds : dragId ? [dragId] : []);
async function applyDrop() {
  const st = dropState, ids = dragList();
  cleanDrag();
  if (!st || !ids.length) return;
  const t = byId.get(st.targetId);
  const ds = ids.map((i) => byId.get(i)).filter((d) => d && t && d.id !== t.id);
  if (!t || !ds.length) return;
  if (ds.length > 1) { await dropMany(ds, t, st.mode); return; }
  const d = ds[0];
  if (st.mode === 'into' && !t.url && isInside(t.id, d.id)) return;   // never move a folder into itself
  const ins = t.index + (st.mode === 'after' ? 1 : 0);
  if (st.mode !== 'into' && d.parentId === t.parentId && (ins === d.index || ins === d.index + 1)) return;   // nothing changes
  flipBegin();
  if (st.mode === 'into') {
    if (!t.url) await M.move(d.id, t.id);
    else {
      const f = await M.addFolder(t.parentId, 'Folder', t.index);
      await M.move(t.id, f.id);
      await M.move(d.id, f.id);
    }
  } else {
    await M.move(d.id, t.parentId, ins);
  }
  flipReady();
  scheduleRefresh();
}
document.addEventListener('dragend', cleanDrag);

async function deleteNode(n) {
  if (!n.url && n.children?.length && !confirm(`Delete folder "${n.title}" with ${n.children.length} item(s)?`)) return;
  const tile = document.querySelector(`.tile[data-id="${n.id}"]`);
  if (tile && S.anim('animDelete')) await playDelete(S.get().deleteAnim, tile);   // the effect chosen in Settings > Animation
  if (tile) flipBegin();                                 // remember where the tiles are, the others slide after the re-render
  await M.remove(n);
  flipReady();
  scheduleRefresh();
}

/* ---------- browser "Back" while a folder is open ---------- */
// A history entry is pushed while a folder is open, so the browser's Back (mouse side button, Alt+Left, swipe)
// raises 'popstate' inside the page instead of leaving it; we then step back inside the folder.
let sentinel = false, popping = false;
const pushSentinel = () => { if (!sentinel) { history.pushState({ msdFolder: 1 }, ''); sentinel = true; } };
const dropSentinel = () => { if (sentinel) { sentinel = false; popping = true; history.back(); } };
window.addEventListener('popstate', () => {
  if (popping) { popping = false; return; }                  // our own cleanup, not the user's Back
  if (!sentinel) return;
  sentinel = false;                                          // the browser has consumed the entry
  if (!openId) return;
  if (navStack.length) { goBack(); pushSentinel(); } else closeFolder(true);
});

/* ---------- folder modal ---------- */
function openFolder(id, tileEl_) {
  if (openId) return;
  openId = id; curId = id; navStack = [];
  pushSentinel();
  document.body.style.overflow = 'hidden';
  layer.hidden = false;
  layer.innerHTML = `<div class="fback"></div><section class="fpanel">
    <header><div class="fl"><button class="icon-btn" id="f-back" title="Back (Backspace / mouse Back button)" hidden>${svg(ICON.back, 20)}</button><h2></h2></div><div class="fbtns"><button class="pill sm" id="f-add">+ Shortcut</button>
    <button class="icon-btn" id="f-close" title="Close">&times;</button></div></header>
    <div class="grid fgrid" data-merge="1" tabindex="-1"></div></section>`;
  bindGrid($('.fgrid', layer), true);
  renderFolderGrid();
  if (S.anim('animFolders')) animateOpen(tileEl_.querySelector('.thumb') || tileEl_);
}
// nested folders: slide "deeper" / back with a zoom transition
function enterFolder(id) {
  if (navBusy) return;
  navStack.push(curId);
  navigate(id, 1);
}
function goBack() {
  if (navBusy || !navStack.length) return;
  navigate(navStack.pop(), -1);
}
async function navigate(toId, dir) {
  if (!S.anim('animFolders')) { if (dir < 0) kbNext = curId; curId = toId; renderFolderGrid(); return; }
  navBusy = true;
  const grid = $('.fgrid', layer), ms = S.get().animMs;
  try {
    await grid.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: dir > 0 ? 'scale(1.06)' : 'scale(.94)' }],
      { duration: ms * 0.35, easing: 'ease-in', fill: 'forwards' }).finished;
    if (!openId) return;
    if (dir < 0) kbNext = curId;
    curId = toId;
    renderFolderGrid();
    grid.getAnimations().forEach((a) => a.cancel());
    grid.animate([{ opacity: 0, transform: dir > 0 ? 'scale(.94)' : 'scale(1.06)' }, { opacity: 1, transform: 'none' }],
      { duration: ms * 0.55, easing: 'cubic-bezier(.22,1,.36,1)' });
  } catch { /* folder window was closed meanwhile */ }
  finally { navBusy = false; }
}
function transformFrom(a, b) {
  const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
  return `translate(${dx}px,${dy}px) scale(${a.width / b.width},${a.height / b.height})`;
}
function animateOpen(from) {
  const panel = $('.fpanel', layer), back = $('.fback', layer), ms = S.get().animMs;
  const ease = 'cubic-bezier(.22,1,.36,1)';
  back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms * 0.8, easing: 'ease-out' });
  panel.animate([{ transform: transformFrom(from.getBoundingClientRect(), panel.getBoundingClientRect()), opacity: 0.4 },
                 { transform: 'none', opacity: 1 }], { duration: ms, easing: ease });
  [$('header', panel), ...panel.querySelectorAll('.fgrid .tile')].forEach((n, i) =>
    n.animate([{ opacity: 0, transform: 'translateY(12px) scale(.9)' }, { opacity: 1, transform: 'none' }],
      { duration: ms * 0.7, delay: ms * 0.35 + i * 30, easing: ease, fill: 'backwards' }));
}
function hideFolderNow() {
  const wasOpen = openId;
  layer.getAnimations().forEach((a) => a.cancel());
  layer.hidden = true; layer.innerHTML = ''; openId = null; curId = null; navStack = []; navBusy = false; closing = false;
  document.body.style.overflow = '';
  dropSentinel();
  if (kbActive && wasOpen) kbId = wasOpen;
  kbApply();
}
async function closeFolder(animated) {
  if (!openId || closing) return;
  if (!S.anim('animFolders')) { hideFolderNow(); return; }
  closing = true;
  const panel = $('.fpanel', layer), back = $('.fback', layer), ms = S.get().animMs;
  const src = gridEl.querySelector(`.tile[data-id="${openId}"] .thumb`);
  try {
    if (animated && src) {
      const b = panel.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const nodes = [$('header', panel), ...panel.querySelectorAll('.fgrid .tile')];
      const rects = nodes.map((n) => n.getBoundingClientRect());
      // the window shrinks into its tile while the content is gathered toward the centre, both at once
      const dur = ms * 0.8;
      nodes.forEach((n, i) => n.animate(
        [{ opacity: 1, transform: 'none' },
         { opacity: 0, transform: `translate(${cx - (rects[i].left + rects[i].width / 2)}px,${cy - (rects[i].top + rects[i].height / 2)}px) scale(.3)` }],
        { duration: dur * 0.8, delay: Math.min(i, 10) * 14, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' }));
      back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
      await panel.animate(
        [{ transform: 'none', opacity: 1 },
         { opacity: 1, offset: 0.65 },
         { transform: transformFrom(src.getBoundingClientRect(), b), opacity: 0 }],
        { duration: dur, easing: 'cubic-bezier(.4,0,.15,1)', fill: 'forwards' }).finished;
    } else {
      await layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).finished;
    }
  } finally { hideFolderNow(); }
}
layer.addEventListener('click', (e) => {
  if (e.target.closest('#f-close')) return closeFolder(true);
  if (e.target.closest('#f-back')) return goBack();
  if (e.target.closest('#f-add')) return openItemDialog({ parentId: curId });
  if (!e.target.closest('.fpanel')) closeFolder(true);
});
// dragging a tile out of the folder: drop it on the dimmed area -> moves to the current group
layer.addEventListener('dragover', (e) => {
  if (!dragId || e.target.closest('.fpanel')) return;
  e.preventDefault(); layer.classList.add('out-drop');
});
layer.addEventListener('drop', async (e) => {
  if (!dragId || e.target.closest('.fpanel')) return;
  e.preventDefault();
  const ids = dragList().slice(); cleanDrag();
  const g = activeGroup();
  if (g) { flipBegin(); for (const id of ids) await M.move(id, g.id); flipReady(); }
  scheduleRefresh();
  if (ids.length > 1) selExit();
});

/* ---------- dialogs ---------- */
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
function promptText(title, value = '') {
  return new Promise((res) => {
    let out = null;
    dlg.innerHTML = `<form class="dform"><h3></h3><label class="f"><input name="v"></label>
      <div class="btns"><span class="sp"></span><button type="button" id="c">Cancel</button><button class="primary">OK</button></div></form>`;
    $('h3', dlg).textContent = title;
    const f = $('form', dlg), inp = f.elements.v;
    inp.value = value;
    $('#c', dlg).onclick = () => dlg.close();
    f.onsubmit = (e) => { e.preventDefault(); out = inp.value.trim(); dlg.close(); };
    dlg.addEventListener('close', () => res(out), { once: true });
    dlg.showModal(); inp.select();
  });
}

function openItemDialog({ node = null, parentId = null }) {
  const isNew = !node;
  let kind = isNew ? 'link' : node.url ? 'link' : 'folder';
  const t0 = node?.url ? T.getT(node.url) : { mode: 'auto' };
  const st = { mode: t0.mode, url: t0.url || '', dataUrl: t0.dataUrl || '', fit: t0.fit || (['cover', 'contain', 'icon', 'wide'].includes(S.get().lastFit) ? S.get().lastFit : 'cover'), auto: t0.auto || 'logo', icon: t0.auto === 'wide' ? '' : t0.icon || '', wideIcon: t0.auto === 'wide' ? t0.icon || '' : '', fname: '' };
  dlg.innerHTML = `<form class="dform">
    <h3>${isNew ? 'Add' : 'Edit'}</h3>
    ${isNew ? '<div class="seg"><button type="button" data-kind="link" class="on">Shortcut</button><button type="button" data-kind="folder">Folder</button></div>' : ''}
    <label class="f" data-only="link"><span>Address</span><input name="addr" placeholder="https://example.com" autocomplete="off" spellcheck="false"><div class="ac" hidden></div></label>
    <label class="f"><span>Title</span><input name="ttl" autocomplete="off"></label>
    <section class="tcat" data-only="link">
      <h4>Thumbnail</h4>
      <div class="thumbsec">
        <div class="lcol"><div class="prev"></div><div class="icons" id="icopick" hidden></div></div>
        <div class="opts">
          <div class="modes">
            <label class="r"><input type="radio" name="mode" value="auto"> Automatic</label>
            <label class="r"><input type="radio" name="mode" value="url"> Image URL</label>
            <label class="r"><input type="radio" name="mode" value="file"> Local file</label>
          </div>
          <div class="pane" data-modes="auto">
            <div class="seg sm" id="ak"><button type="button" data-ak="logo">Icon</button><button type="button" data-ak="wide" title="A wide (rectangular) logo of the site">Logo</button><button type="button" data-ak="pageview">Pageview</button></div>
            <p class="note" id="aknote" hidden>Uses the site's preview image, or a screenshot taken when you visit the page.</p>
            <div class="widetools" id="widetools" hidden>
              <div class="wt-row">
                <button type="button" class="pill sm" id="wt-online" title="Looks for logos on Wikidata and Wikimedia Commons. The site name is sent to those services.">Search online</button>
                <button type="button" class="pill sm" id="wt-google" title="Opens Google Images (wide, transparent) in a new tab. Copy an image there and press Ctrl+V in this window.">Google Images ↗</button>
              </div>
              <p class="note" id="wt-note">Nothing suitable? Search online, or find an image on Google Images, copy it and press <b>Ctrl+V</b> in this window.</p>
            </div>
          </div>
          <div class="pane" data-modes="url"><input name="imgurl" placeholder="https://…/image.png" autocomplete="off" spellcheck="false"><p class="note err-note" id="imgerr" hidden>This image could not be loaded.</p></div>
          <div class="pane" data-modes="file">
            <input type="file" name="file" accept="image/*" hidden>
            <div class="filepick"><button type="button" class="pill sm" id="pickfile">Choose image…</button><button type="button" class="pill sm" id="clearfile" hidden>Remove</button><span class="note fname" id="fname"></span></div>
            <p class="note">You can also drop or paste an image.</p>
          </div>
          <div class="pane" data-modes="url file">
            <label class="r">Fit <select name="fit"><option value="cover">Fill</option><option value="contain">Fit inside</option><option value="icon">Icon size</option><option value="wide">Logo size</option></select></label>
          </div>
        </div>
      </div>
    </section>
    <div class="btns">${isNew ? '' : '<button type="button" class="danger" id="d-del">Delete</button>'}<span class="sp"></span>
      <button type="button" id="d-cancel">Cancel</button><button type="submit" class="primary">Save</button></div>
  </form>`;
  const f = $('form', dlg), E = f.elements, prev = $('.prev', dlg);
  E.addr.value = node?.url || '';
  E.ttl.value = node ? M.nameOf(node) : '';
  E.imgurl.value = st.url;
  E.fit.value = st.fit;
  f.querySelectorAll('input[name=mode]').forEach((r) => (r.checked = r.value === st.mode));

  const showKind = () => f.querySelectorAll('[data-only=link]').forEach((x) => (x.hidden = kind !== 'link'));
  let pt, updTok = 0;
  const NOTES = {
    found: "Uses the site's preview image, or a screenshot taken when you visit the page.",
    loading: 'Looking for a preview image…',
    none: 'No preview image found for this site. A screenshot will be taken after you visit it.',
    off: 'Turn on “Try to fetch hi-res icons & previews” in Advanced Settings to look up preview images.',
  };
  const WNOTES = {
    found: 'Uses a wide logo of the site.',
    loading: 'Looking for a logo…',
    none: 'No wide logo found for this site. The regular icon is used.',
    off: 'Turn on “Try to fetch hi-res icons & previews” in Advanced Settings to look for logos.',
  };
  const setNote = (s) => { const N = st.auto === 'wide' ? WNOTES : NOTES; $('#aknote', dlg).textContent = N[s] || N.found; };
  const renderPrev = () => {
    const tok = ++updTok;
    const addr = normalizeUrl(E.addr.value);
    const custom = (st.mode === 'url' && st.url) || (st.mode === 'file' && st.dataUrl);
    setNote('found');
    // the logo (wide icon) picked in the picker lives in st.wideIcon: the thumbnail reads it as `icon`
    const t = st.mode === 'auto' && st.auto === 'wide' ? { ...st, icon: st.wideIcon } : st;
    prev.replaceChildren(addr || custom
      ? T.renderThumbFrom(addr || 'https://example.com', t, (s) => { if (tok === updTok) setNote(s); })
      : T.placeholderThumb());
  };
  // now = true: draw immediately (used for the first render, so the window never changes height after opening)
  const upd = (now) => { clearTimeout(pt); if (now) renderPrev(); else pt = setTimeout(renderPrev, 150); };
  const ak = $('#ak', dlg);
  // icon picker: shown when the site offers several icon variants
  const icp = $('#icopick', dlg);
  let cands = [], lastUrl = null, ct, searching = false;
  let wcands = [], wlast = null, wt, wsearching = false;          // the same for the logos (wide icons)
  let ocands = [], osearching = false, otok = 0;                  // wide logos found online (Wikidata / Wikimedia Commons) on request
  const shown = new Set();
  const syncAk = () => {
    f.querySelectorAll('.pane').forEach((p) => (p.hidden = !p.dataset.modes.split(' ').includes(st.mode)));
    $('#aknote', dlg).hidden = !(st.mode === 'auto' && (st.auto === 'pageview' || st.auto === 'wide'));
    ak.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.ak === st.auto));
    // the picker area stays put (icons, skeleton or a note) as long as it is relevant, so the window height never jumps
    icp.classList.toggle('wide', st.auto === 'wide');
    icp.hidden = !(st.mode === 'auto' && (st.auto === 'logo' || st.auto === 'wide') && E.addr.value.trim()
      && (st.auto === 'wide' ? wlast !== null || st.wideIcon || ocands.length || osearching : lastUrl !== null || st.icon));
    $('#widetools', dlg).hidden = !(st.mode === 'auto' && st.auto === 'wide');
  };
  const renderIcons = () => {
    const wide = st.auto === 'wide';
    const sel = wide ? st.wideIcon : st.icon, busy = wide ? wsearching : searching;
    icp.replaceChildren();
    const list = wide ? [...wcands, ...ocands] : cands.filter((c) => !Icons.isWide(c));   // square icons here, wide logos in their own picker
    let divider = false;
    if (sel && !list.some((c) => c.src === sel)) list.unshift({ src: sel, w: 0 });
    const auto = el('button', 'ic auto' + (sel ? '' : ' on'), 'Auto');
    auto.type = 'button'; auto.title = wide ? 'Best logo' : 'Best available icon';
    auto.onclick = () => { if (wide) st.wideIcon = ''; else st.icon = ''; renderIcons(); upd(); };
    icp.append(auto);
    list.forEach((c) => {
      if (c.o && !divider) { divider = true; icp.append(el('small', 'sk-note', 'From Wikimedia')); }
      const b = el('button', 'ic' + (sel === c.src ? ' on' : ''));
      if (!shown.has(c.src)) { shown.add(c.src); b.classList.add('pop'); }
      b.type = 'button';
      const vec = c.v ?? c.w >= 1024, dim = vec ? 'svg' : wide && c.h ? c.w + '×' + c.h : c.w;
      b.title = (c.w ? (vec ? 'vector' : dim + 'px') + ' · ' : '') + (c.label ? c.label + ' · ' : '') + c.src;
      const im = new Image(); im.src = c.src; im.alt = ''; im.draggable = false;
      b.append(im);
      if (c.w) { const s = el('small'); s.textContent = dim; b.append(s); }
      b.onclick = () => { if (wide) st.wideIcon = c.src; else st.icon = c.src; renderIcons(); upd(); };
      icp.append(b);
    });
    if (busy || (wide && osearching)) {
      for (let i = 0; i < 2; i++) icp.append(el('div', 'ic sk'));
      icp.append(el('small', 'sk-note', wide ? (osearching ? 'Searching online…' : 'Searching logos…') : 'Searching icons…'));
    } else if (list.length < (wide ? 1 : 2) && !sel) {
      icp.replaceChildren(el('small', 'sk-note', wide ? 'No logos found for this site. Try “Search online”.' : 'No other icons found for this site.'));
    }
  };
  const loadCands = (delay = 250) => {
    clearTimeout(ct);
    const run = () => {
      const url = normalizeUrl(E.addr.value);
      if (!S.get().hiResIcons || !/^https?:/i.test(url) || url === lastUrl) return;
      if (lastUrl !== null) { st.icon = ''; upd(); }
      lastUrl = url; cands = []; searching = true; shown.clear();
      renderIcons(); syncAk();
      Icons.candidates(url, (list) => { if (lastUrl === url) { cands = list; renderIcons(); syncAk(); } })
        .then((list) => { if (lastUrl === url) { cands = list; searching = false; renderIcons(); syncAk(); } });
    };
    if (delay) ct = setTimeout(run, delay); else run();   // delay 0: run now, before the window is shown
  };
  const loadWide = (delay = 250) => {
    clearTimeout(wt);
    const run = () => {
      const url = normalizeUrl(E.addr.value);
      if (st.mode !== 'auto' || st.auto !== 'wide' || !S.get().hiResIcons || !/^https?:/i.test(url) || url === wlast) return;
      if (wlast !== null) { st.wideIcon = ''; upd(); }
      wlast = url; wcands = []; ocands = []; otok++; osearching = false; wsearching = true; shown.clear();
      renderIcons(); syncAk();
      Icons.wideCandidates(url, (list) => { if (wlast === url) { wcands = list; renderIcons(); syncAk(); } })
        .then((list) => { if (wlast === url) { wcands = list; wsearching = false; renderIcons(); syncAk(); } });
    };
    if (delay) wt = setTimeout(run, delay); else run();
  };
  // names a site is known by: the title typed in the dialog and the domain's main label (github.com -> github)
  const siteNames = (url) => {
    const host = hostOf(url).replace(/^www\./, ''), parts = host.split('.');
    const n = parts.length > 2 && parts[parts.length - 1].length === 2 && ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'].includes(parts[parts.length - 2]) ? 3 : 2;
    return [E.ttl.value.trim(), parts.length >= n ? parts[parts.length - n] : parts[0]].filter(Boolean);
  };
  const wtNote = $('#wt-note', dlg);
  $('#wt-online', dlg).onclick = async () => {
    const url = normalizeUrl(E.addr.value);
    if (!/^https?:/i.test(url)) { wtNote.textContent = 'Enter the address of the site first.'; return; }
    const tok = ++otok;
    ocands = []; osearching = true; shown.clear();
    wtNote.textContent = 'Searching Wikidata and Wikimedia Commons…';
    renderIcons(); syncAk();
    const done = (list) => { if (tok !== otok) return false; ocands = list; return true; };
    const list = await Icons.webLogos(siteNames(url), url, (l) => { if (done(l)) renderIcons(); });
    if (!done(list)) return;
    osearching = false;
    wtNote.textContent = list.length ? 'Pick one of the wide logos found online.' : 'Nothing found online. Try Google Images: copy an image there and press Ctrl+V in this window.';
    renderIcons(); syncAk();
  };
  $('#wt-google', dlg).onclick = () => {
    const name = siteNames(normalizeUrl(E.addr.value))[0] || hostOf(normalizeUrl(E.addr.value)) || '';
    window.open('https://www.google.com/search?tbm=isch&tbs=' + encodeURIComponent('ic:trans,iar:w') + '&q=' + encodeURIComponent((name + ' logo').trim()), '_blank', 'noopener');
    wtNote.innerHTML = 'Copy the image you like (right-click → Copy image) and press <b>Ctrl+V</b> in this window.';
  };
  ak.querySelectorAll('button').forEach((b) => (b.onclick = () => { st.auto = b.dataset.ak; renderIcons(); syncAk(); upd(); loadWide(0); }));
  const setMode = (m) => { st.mode = m; syncAk(); loadWide(0); f.querySelectorAll('input[name=mode]').forEach((r) => (r.checked = r.value === m)); upd(); };

  f.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => {
    kind = b.dataset.kind;
    f.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
    showKind();
  }));
  f.querySelectorAll('input[name=mode]').forEach((r) => (r.onchange = () => setMode(r.value)));
  // the Title field shows the site name that will be used when it is left empty
  const titlePh = () => { E.ttl.placeholder = hostOf(normalizeUrl(E.addr.value)) || 'Title'; };
  titlePh();
  // local image: choose / drop / paste
  const fname = $('#fname', dlg), clearBtn = $('#clearfile', dlg);
  const syncFile = () => {
    fname.textContent = st.dataUrl ? (st.fname || 'Current image') : 'No image selected';
    clearBtn.hidden = !st.dataUrl;
  };
  const setFile = async (file) => {
    if (!file || !/^image\//.test(file.type)) return;
    const fromWide = st.mode === 'auto' && st.auto === 'wide';        // pasted / dropped while "Logo" is selected
    st.dataUrl = await T.previewDataUrl(file);   // shorter side -> 420px
    st.fname = file.name || 'Pasted image';
    if (fromWide) { st.fit = 'wide'; E.fit.value = 'wide'; fitTouched = true; }
    syncFile(); setMode('file');
  };
  syncFile();
  $('#pickfile', dlg).onclick = () => E.file.click();
  clearBtn.onclick = () => { st.dataUrl = ''; st.fname = ''; E.file.value = ''; syncFile(); upd(); };
  const drop = $('.thumbsec', dlg);
  drop.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); drop.classList.add('dragover'); } });
  drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('dragover'); });
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('dragover'); setFile(e.dataTransfer.files[0]); });
  f.addEventListener('paste', (e) => {
    const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (it) { e.preventDefault(); setFile(it.getAsFile()); return; }
    // "Copy image address" from Google Images: an address pasted outside the text fields is taken as the image address
    const text = (e.clipboardData?.getData('text') || '').trim();
    if (st.mode === 'auto' && st.auto === 'wide' && /^https?:\/\/\S+$/i.test(text) && !e.target.closest?.('input, textarea')) {
      e.preventDefault();
      st.url = text; E.imgurl.value = text; st.fit = 'wide'; E.fit.value = 'wide'; fitTouched = true;
      setMode('url'); checkImg();
    }
  });
  // Image URL: tell the user when the link does not give an image
  const imgerr = $('#imgerr', dlg);
  let imgT, imgTok = 0;
  const checkImg = () => {
    clearTimeout(imgT);
    imgerr.hidden = true;
    if (!st.url) return;
    const tok = ++imgTok;
    imgT = setTimeout(() => {
      const im = new Image();
      im.onerror = () => { if (tok === imgTok) imgerr.hidden = false; };
      im.src = st.url;
    }, 400);
  };
  // address autocomplete
  const ac = $('.ac', dlg);
  let items = [], sel = -1, acT;
  const closeAc = () => { ac.hidden = true; items = []; sel = -1; };
  const renderAc = () => {
    ac.replaceChildren();
    items.forEach((s, i) => {
      const b = el('button', i === sel ? 'on' : '');
      b.type = 'button';
      const im = new Image(); im.draggable = false; im.alt = ''; T.setSiteIcon(im, s.url, 32);
      const t = el('b'); t.textContent = s.title;
      const h = el('small'); h.textContent = s.url.replace(/^https?:\/\//, '');
      b.append(im, t, h);
      b.onmousedown = (e) => { e.preventDefault(); pick(i); };
      ac.append(b);
    });
    ac.hidden = !items.length;
  };
  const pick = (i) => {
    const s = items[i];
    if (!s) return;
    E.addr.value = s.url;
    if (!E.ttl.value.trim()) E.ttl.value = s.title;
    closeAc(); upd(); loadCands(0); loadWide(0); titlePh(); E.addr.classList.remove('err');
  };
  E.addr.oninput = () => {
    E.addr.classList.remove('err');
    titlePh(); upd(); loadCands(); loadWide();
    clearTimeout(acT);
    acT = setTimeout(async () => {
      const q = E.addr.value;
      const r = await Suggest.suggest(q);
      if (E.addr.value !== q || document.activeElement !== E.addr) return;   // stale result or the field lost focus
      items = r; sel = -1; renderAc();
    }, 90);
  };
  E.addr.onkeydown = (e) => {
    if (ac.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      renderAc();
    } else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAc(); }
  };
  E.addr.onblur = closeAc;
  E.imgurl.oninput = () => { st.url = E.imgurl.value.trim(); checkImg(); upd(); };   // the mode is chosen with the radio buttons
  let fitTouched = false;                                    // Fit was changed by hand in this window
  E.fit.onchange = () => { st.fit = E.fit.value; fitTouched = true; upd(); };
  E.file.onchange = () => { setFile(E.file.files[0]); E.file.value = ''; };
  $('#d-cancel', dlg).onclick = () => dlg.close();
  const del = $('#d-del', dlg);
  if (del) del.onclick = async () => { dlg.close(); await deleteNode(node); };

  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const title = E.ttl.value.trim();
    if (kind === 'folder') {
      if (isNew) await M.addFolder(parentId, title || 'Folder');
      else await M.update(node.id, { title: title || node.title });
    } else {
      const url = normalizeUrl(E.addr.value);
      if (!url) {
        E.addr.classList.add('err');
        E.addr.placeholder = 'Enter a website address';
        E.addr.focus();
        return;
      }
      const ttl = title || hostOf(url);
      const useImg = (st.mode === 'url' && st.url) || (st.mode === 'file' && st.dataUrl);
      // Speed Dials mode: an icon that comes from a URL travels in the bookmark title as JSON, so it syncs with the bookmarks
      const pick = st.mode === 'auto' ? (st.auto === 'logo' ? st.icon : st.auto === 'wide' ? st.wideIcon : '') : '';   // the icon picked in a picker
      const iconUrl = st.mode === 'url' && st.url ? st.url : pick;
      const bmTitle = M.titleFor(ttl, iconUrl, st.mode === 'url' ? st.fit : st.auto === 'wide' ? 'wide' : 'icon');
      DialMeta.hold();                                            // a refresh must not restore the old icon while we save
      try {
        if (isNew) await M.addLink(parentId || activeGroup()?.id, url, bmTitle);
        else {
          await M.update(node.id, { title: bmTitle, url });
          if (url !== node.url) await T.rekey(node.url, url);
        }
        await T.setT(url, useImg ? { mode: st.mode, url: st.url, dataUrl: st.mode === 'file' ? st.dataUrl : '', fit: st.fit } : { mode: 'auto', auto: st.auto, ...(st.auto === 'logo' && st.icon ? { icon: st.icon } : {}), ...(st.auto === 'wide' && st.wideIcon ? { icon: st.wideIcon } : {}) });
        if (useImg && (isNew || fitTouched)) await S.set({ lastFit: st.fit });   // the next own image starts with this Fit
      } finally { DialMeta.release(); }
    }
    dlg.close();
    scheduleRefresh();
  };
  showKind(); renderIcons(); syncAk(); upd(true); loadCands(0); loadWide(0);
  dlg.showModal();
  (isNew ? E.addr : E.ttl).focus();
}

/* ---------- context menu ---------- */
function showCtx(x, y, items) {
  ctx.innerHTML = '';
  items.forEach(([label, fn]) => {
    const b = el('button', null, label);
    b.onclick = () => { hideCtx(); fn(); };
    ctx.append(b);
  });
  ctx.hidden = false;
  ctx.style.left = Math.min(x, innerWidth - 170) + 'px';
  ctx.style.top = y + 'px';
}
const hideCtx = () => (ctx.hidden = true);
document.addEventListener('click', hideCtx);
window.addEventListener('blur', hideCtx);

/* ---------- search ---------- */
const q = $('#q'), qClear = $('#q-clear');
const bmMode = () => S.get().engine === 'bookmarks';
const bmFilterOn = () => bmMode() && q.value.trim() !== '';
function updateSearch() {
  const [name, , origin] = ENGINES[S.get().engine] || ENGINES.google;
  q.placeholder = 'Search ' + name;
  const img = $('#engine-ico');
  let bm = $('#engine-bm');
  if (!origin) {                                              // Bookmarks: a drawn icon instead of a site icon
    if (!bm) { bm = el('span', null, svg(ICON.bookmark, 18)); bm.id = 'engine-bm'; img.after(bm); }
    img.hidden = true; bm.hidden = false;
    sgClose();
  } else {
    img.hidden = false; if (bm) bm.hidden = true;
    T.setSiteIcon(img, origin, 32);
  }
  syncClear();
  if (root && (bmFilterOn() || gridEl.classList.contains('search-results'))) renderGrid();   // apply / drop the filter right away
}
// the clear button exists only for the Bookmarks engine and only while the field is not empty
function syncClear() { qClear.hidden = !(bmMode() && q.value !== ''); }
qClear.onclick = () => { q.value = ''; syncClear(); renderGrid(); q.focus(); };

/* Bookmarks "engine": filter the bookmarks of ALL groups (and their folders) by title and address while typing */
const BM_MAX = 100;
function bmMatches() {
  const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  (function walk(n) {
    for (const c of n.children || []) {
      if (c.url) { const hay = (M.nameOf(c) + ' ' + c.url).toLowerCase(); if (words.every((w) => hay.includes(w))) out.push(c); }
      else walk(c);
    }
  })(root);
  return out;
}
function renderResults() {
  const list = bmMatches();
  gridEl.classList.add('search-results');
  nav.classList.add('searching');
  if (!list.length) {
    const p = el('p', 'empty');
    p.textContent = `No bookmarks match “${q.value.trim()}”.`;
    gridEl.replaceChildren(p);
  } else {
    gridEl.replaceChildren(...list.slice(0, BM_MAX).map((n) => { const t = tileEl(n); t.draggable = false; return t; }));
    if (list.length > BM_MAX) { const p = el('p', 'empty'); p.textContent = `Showing the first ${BM_MAX} of ${list.length} matches. Type more to narrow it down.`; gridEl.append(p); }
  }
  kbApply();
}
function clearBmFilter() {
  if (!bmFilterOn()) return;
  q.value = '';
  syncClear();
  renderGrid();
}
let bmTimer;
q.addEventListener('input', () => { syncClear(); if (bmMode()) { clearTimeout(bmTimer); bmTimer = setTimeout(renderGrid, 60); } });
q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bmMode() && q.value) { e.preventDefault(); q.value = ''; syncClear(); renderGrid(); } });

const goSearch = (v) => {
  v = v.trim();
  if (!v) return;
  if (bmMode()) { const m = bmMatches()[0]; if (m) location.href = m.url; return; }   // Enter opens the first match
  const looksUrl = /^(https?:\/\/|chrome:\/\/)\S+$/i.test(v) || /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(v);
  const tpl = (ENGINES[S.get().engine] || ENGINES.google)[1];
  location.href = looksUrl ? normalizeUrl(v) : tpl.replace('%s', encodeURIComponent(v));
};

/* search autocomplete: engine query suggestions + matching bookmarks / history sites */
const sgBox = el('div', 'sg');
sgBox.hidden = true;
$('#search').append(sgBox);
let sgItems = [], sgSel = -1, sgTyped = '', sgTok = 0, sgAbort = null, sgTimer;
const sgClose = () => { sgBox.hidden = true; sgItems = []; sgSel = -1; sgTok++; sgAbort?.abort(); };
function sgRender() {
  sgBox.replaceChildren();
  const typed = sgTyped.toLowerCase();
  sgItems.forEach((it, i) => {
    const b = el('button', 'sg-item' + (i === sgSel ? ' on' : ''));
    b.type = 'button';
    if (it.url) {
      const im = new Image(); im.className = 'sg-ico'; im.alt = ''; im.draggable = false; T.setSiteIcon(im, it.url, 32);
      const t = el('span', 'sg-t'); t.textContent = it.title;
      const h = el('small'); h.textContent = it.url.replace(/^https?:\/\//, '');
      b.append(im, t, h);
    } else {
      b.append(el('span', 'sg-ico sg-mag', svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 15)));
      const t = el('span', 'sg-t');
      const low = it.text.toLowerCase();
      if (typed && low.startsWith(typed)) {
        t.append(document.createTextNode(it.text.slice(0, typed.length)));
        const r = el('b'); r.textContent = it.text.slice(typed.length); t.append(r);
      } else t.textContent = it.text;
      b.append(t);
    }
    b.onmousedown = (e) => e.preventDefault();             // keep focus in the field
    b.onclick = () => sgPick(i);
    sgBox.append(b);
  });
  sgBox.hidden = !sgItems.length;
}
const sgPick = (i) => {
  const it = sgItems[i];
  if (!it) return;
  if (it.url) location.href = it.url; else { q.value = it.text; goSearch(it.text); }
};
async function sgFetch() {
  const v = q.value.trim();
  sgTyped = q.value;
  if (!v || !S.get().searchSuggest || bmMode()) { sgClose(); return; }
  const tok = ++sgTok;
  sgAbort?.abort();
  sgAbort = new AbortController();
  const [web, sites] = await Promise.all([
    SearchSuggest.queries(S.get().engine, v, sgAbort.signal),
    Suggest.suggest(v).catch(() => []),
  ]);
  if (tok !== sgTok) return;                                // a newer keystroke superseded this one
  const looksUrl = /[./]/.test(v);
  const siteItems = sites.slice(0, looksUrl ? 4 : 2).map((s) => ({ url: s.url, title: s.title }));
  const webItems = web.slice(0, looksUrl ? 4 : 6).map((text) => ({ text }));
  sgItems = looksUrl ? [...siteItems, ...webItems] : [...webItems, ...siteItems];
  sgSel = -1;
  sgRender();
}
q.addEventListener('input', () => { clearTimeout(sgTimer); sgTimer = setTimeout(sgFetch, 110); });
q.addEventListener('focus', () => { if (q.value.trim() && !sgItems.length) sgFetch(); });
q.addEventListener('blur', () => setTimeout(sgClose, 120));
q.addEventListener('keydown', (e) => {
  if (sgBox.hidden || !sgItems.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = sgItems.length;
    sgSel = e.key === 'ArrowDown' ? (sgSel + 1 >= n ? -1 : sgSel + 1) : (sgSel - 1 < -1 ? n - 1 : sgSel - 1);
    const it = sgItems[sgSel];
    q.value = it ? (it.text || it.url) : sgTyped;          // preview the choice in the field
    sgRender();
  } else if (e.key === 'Enter' && sgSel >= 0) {
    e.preventDefault();
    sgPick(sgSel);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (sgSel >= 0) q.value = sgTyped;
    sgClose();
  }
});
$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  sgClose();
  goSearch(q.value);
});

/* ---------- settings UI ---------- */
function bindSettingsUI() {
  SettingsUI.init({
    engines: ENGINES,
    onEngine: updateSearch,
    onRefreshIcons: async () => { await Icons.clear(); T.bump(); scheduleRefresh(); },
    onSource: changeSource,
    onPickRoot: pickRoot,
    onGroups: () => { renderGroups(); renderGrid(); },
  });
}

/* ---------- storage label ---------- */
function updateStorageUI() {
  SettingsUI.setStorageText((M.info.path ? 'Root folder: ' + M.info.path : '') + (M.info.note ? '\n' + M.info.note : ''));
}

/* ---------- keyboard navigation ---------- */
// Arrow keys / Home / End move a highlight over the tiles of the visible grid (main grid or open folder),
// Enter or Space opens the highlighted folder or follows the highlighted link (Ctrl/Cmd/Shift+Enter = like Ctrl/Cmd/Shift+click).
let kbActive = false, kbId = null, kbNext = null;
const kbGrid = () => (openId ? $('.fgrid', layer) : gridEl);
const kbTiles = () => [...(kbGrid()?.querySelectorAll('.tile') || [])];
function kbApply() {
  document.querySelectorAll('.tile.kb-sel').forEach((x) => x.classList.remove('kb-sel'));
  if (!kbActive) return;
  const tiles = kbTiles();
  const t = (kbNext && tiles.find((x) => x.dataset.id === kbNext)) || tiles.find((x) => x.dataset.id === kbId) || tiles[0];
  kbNext = null;
  if (!t) return;
  kbId = t.dataset.id;
  t.classList.add('kb-sel');
}
function kbSet(t) {
  kbActive = true;
  kbId = t.dataset.id;
  kbApply();
  t.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
const kbOff = () => { if (kbActive) { kbActive = false; kbApply(); } };
document.addEventListener('pointerdown', kbOff, true);          // using the mouse hides the highlight

function kbMove(key) {
  const tiles = kbTiles();
  if (!tiles.length) return false;
  if (!kbActive && selMode && selLast && tiles.some((x) => x.dataset.id === selLast)) { kbId = selLast; kbActive = true; }   // selection started with the mouse: go on from the tile ticked last
  const i = tiles.findIndex((x) => x.dataset.id === kbId);
  if (!kbActive || i < 0) { kbSet(tiles[i >= 0 ? i : 0]); return true; }   // the first key press only shows the highlight
  const top0 = tiles[0].getBoundingClientRect().top;
  const cols = Math.max(1, tiles.filter((x) => Math.abs(x.getBoundingClientRect().top - top0) < 6).length);
  const last = tiles.length - 1;
  let j = i;
  if (key === 'ArrowLeft') j = Math.max(0, i - 1);
  else if (key === 'ArrowRight') j = Math.min(last, i + 1);
  else if (key === 'ArrowUp') j = i - cols >= 0 ? i - cols : i;
  else if (key === 'ArrowDown') j = i + cols <= last ? i + cols : (Math.floor(i / cols) < Math.floor(last / cols) ? last : i);
  else if (key === 'Home') j = 0;
  else if (key === 'End') j = last;
  if (j !== i) kbSet(tiles[j]);
  return true;
}
// Shift + arrow on a highlighted tile: starts selection mode with that tile and ticks the tiles up to the new one;
// in selection mode the highlight keeps moving and the range follows it (going back shrinks it).
// Ctrl + arrow (op 'del', selection mode only): the tiles passed over are unticked instead.
function kbShiftMove(key, op = 'add') {
  const tiles = kbTiles();
  if (!tiles.length) return false;
  if (!selMode) {
    if (op === 'del') return false;
    const id = kbActive && tiles.some((x) => x.dataset.id === kbId) ? kbId : null;
    if (!id) return false;                                       // no highlight yet: a plain move shows it first
    selEnter(id);
    kbActive = true; kbId = id; kbApply();                       // selEnter hides the highlight (mouse start); here it stays
  } else if (!kbActive && selLast && tiles.some((x) => x.dataset.id === selLast)) { kbId = selLast; kbActive = true; }   // the mouse started it: go on from the tile ticked last
  if (selBase && selBaseOp !== op) selBase = null;               // Shift and Ctrl alternate: each starts its own sequence
  if (!selBase) selAnchor = kbId;                                // a new sequence starts at the highlighted tile
  selBaseOp = op;
  kbMove(key);
  selExtend(kbId, op);
  return true;
}
function kbEnter(e) {
  const t = kbTiles().find((x) => x.dataset.id === kbId), node = byId.get(kbId);
  if (!t || !node) return false;
  const card = t.querySelector('.card');
  if (!node.url) card.click();                                  // folder: same path as a mouse click
  else card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey }));
  return true;
}
const KB_MOVE = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.altKey || !root) return;
  const tg = e.target;
  if (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) return;
  if (dlg.open || $('#picker').open || $('#reset-dlg').open || $('#bk-dlg').open || $('#mode-dlg').open || tg.closest?.('#adv') || tg.closest?.('#groups') || closing || navBusy) return;
  const mod = e.shiftKey && !e.ctrlKey && !e.metaKey ? 'add' : e.ctrlKey && !e.shiftKey && !e.metaKey ? 'del' : null;   // Meta stays with the browser (Cmd+arrows)
  if (KB_MOVE.has(e.key) && mod && !tg.closest?.('#selbar') && kbShiftMove(e.key, mod)) {
    e.preventDefault();
    if (tg.matches?.('button')) tg.blur();
  } else if (KB_MOVE.has(e.key) && !e.ctrlKey && !e.metaKey) {
    if (kbMove(e.key)) {
      e.preventDefault();
      if (tg.matches?.('button')) tg.blur();                    // so that Enter acts on the tile, not on the last clicked button
    }
  } else if ((e.key === 'Enter' || e.key === ' ') && kbActive && !tg.closest?.('button, a, summary')) {
    if (kbEnter(e)) e.preventDefault();
  } else if (e.key === 'Escape' && kbActive && !openId) kbOff();
});

/* ---------- Tab order: Group bar -> Search field -> Dials -> + Shortcut -> Settings (cyclic) ---------- */
gridEl.tabIndex = -1;
const shown = (x) => !!x && !x.hidden && x.getClientRects().length > 0;
function zones() {
  const dials = {
    name: 'dials',
    has: (x) => { const g = kbGrid(); return !!g && (x === g || g.contains(x)); },
    enter: () => {
      const tiles = kbTiles();
      if (!tiles.length) return false;                          // an empty grid is skipped
      kbGrid().focus({ preventScroll: true });
      kbSet(tiles.find((t) => t.dataset.id === kbId) || tiles[0]);
      return true;
    },
  };
  const btn = (name, getEl) => ({ name, has: (x) => x === getEl(), enter: () => { const b = getEl(); if (!shown(b)) return false; b.focus(); return true; } });
  // the multi-select bar (only while selecting) is one Tab stop; the arrow keys move between its buttons
  const bar = { name: 'selbar', has: (x) => selBar.contains(x),
    enter: () => { const bs = selBtns(); if (!bs.length) return false; bs[0].focus(); return true; } };
  if (openId) return [btn('fback', () => $('#f-back', layer)), dials, ...(selMode ? [bar] : []), btn('fadd', () => $('#f-add', layer)), btn('fclose', () => $('#f-close', layer))];
  return [
    { name: 'groups', has: (x) => nav.contains(x),
      enter: () => { const b = nav.querySelector('.group.active') || nav.querySelector('.group'); if (!b) return false; b.focus(); return true; } },
    { name: 'search', has: (x) => x === q, enter: () => { if (!shown(q)) return false; q.focus(); return true; } },
    dials,
    selMode ? bar : btn('add', () => $('#add-btn')),             // "+ Shortcut" is hidden while selecting
    btn('settings', () => $('#settings-btn')),
  ];
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  if (dlg.open || $('#picker').open || $('#reset-dlg').open || $('#bk-dlg').open || $('#mode-dlg').open || closing || navBusy || !root) return;
  const act = document.activeElement, list = zones();
  let cur = list.findIndex((z) => z.has(act));
  // an arrow key shows the tile highlight but drops the focus to <body> (e.g. from the + Shortcut button):
  // the highlighted tile is then the current position, so Shift+Tab goes to the Search field and Tab to + Shortcut
  if (cur < 0 && (kbActive || selMode) && (act === document.body || act === document.documentElement)) cur = list.findIndex((z) => z.name === 'dials');   // while selecting, Tab from nowhere goes to the selection bar
  if (cur < 0 && act && act !== document.body && act !== document.documentElement) return;   // focus is in the settings panel / Advanced window: native Tab
  const dir = e.shiftKey ? -1 : 1;
  if (cur >= 0 && list[cur].name === 'dials') kbOff();
  let k = cur < 0 ? (dir > 0 ? -1 : 0) : cur;                 // from nowhere: Tab -> first zone, Shift+Tab -> last zone
  for (let n = 0; n < list.length; n++) {
    k = (k + dir + list.length) % list.length;
    if (list[k].enter(dir)) { e.preventDefault(); return; }
  }
});
// Esc closes the Quick Settings panel opened from the keyboard and returns the focus to the gear
document.addEventListener('keydown', (e) => {
  const p = $('#settings');
  if (e.key === 'Escape' && !e.defaultPrevented && p.classList.contains('open') && (p.contains(e.target) || e.target.id === 'settings-btn')) {
    p.classList.remove('open');
    $('#settings-btn').focus();
    e.preventDefault();
  }
});
// Group bar: arrows move between groups and select them ("+" only takes the focus); Up/Down jump between wrapped rows
nav.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const btns = [...nav.querySelectorAll('.group')];
  const i = btns.indexOf(document.activeElement);
  if (i < 0) return;
  const mid = (b) => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  let j = i;
  if (e.key === 'ArrowRight') j = Math.min(btns.length - 1, i + 1);
  else if (e.key === 'ArrowLeft') j = Math.max(0, i - 1);
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = btns.length - 1;
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const [cx, cy] = mid(btns[i]), down = e.key === 'ArrowDown';
    const cand = btns.map((b, n) => { const [x, y] = mid(b); return { n, x, y }; }).filter((o) => (down ? o.y > cy + 4 : o.y < cy - 4));
    if (!cand.length) return;                                   // single row: nothing above / below
    const ny = down ? Math.min(...cand.map((o) => o.y)) : Math.max(...cand.map((o) => o.y));
    j = cand.filter((o) => Math.abs(o.y - ny) < 4).sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx))[0].n;
  } else return;
  e.preventDefault();
  if (j === i) return;
  const b = btns[j];
  b.focus();
  const g = groupList().find((x) => x.id === b.dataset.id);
  if (g) switchGroup(g);
});

/* ---------- settings icon: shown only when the mouse is near (optional) ---------- */
const gearBtn = $('#settings-btn');
document.addEventListener('pointermove', (e) => {
  const s = S.get();
  if (!s.gearAutoHide) return;
  const r = gearBtn.getBoundingClientRect();
  const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right), dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
  document.body.classList.toggle('gear-near', Math.hypot(dx, dy) <= s.gearRadius);   // distance to the button itself
}, { passive: true });
document.documentElement.addEventListener('mouseleave', () => document.body.classList.remove('gear-near'));

/* ---------- multi-select ---------- */
// Long press (left button) on a tile starts selection mode. A click or Space ticks / unticks a tile, Enter opens the
// ticked tiles in new tabs, Esc leaves the mode. Several ticked tiles can be dragged onto a group tab, a folder or a
// place between tiles, or moved with "Move to…". Only the tiles of the grid in front count (the folder window's or the page's).
let selBase = null, selBaseOp = 'add';                        // the selection before the current Shift / Ctrl+arrow sequence (so that going back shrinks the range) and what the sequence does
let selLast = null, selAnchor = null;                        // the tile ticked last (where the arrow keys start from) / the start of a Shift range
let selMode = false, selSuppress = false, lpTimer = 0, lpX = 0, lpY = 0, mouseX = 0, mouseY = 0;
const sel = new Set();
const selBar = $('#selbar');
const selTiles = () => [...(kbGrid()?.querySelectorAll('.tile') || [])];
const selBtns = () => [...selBar.querySelectorAll('button:not(:disabled)')];
const selIds = () => selTiles().filter((t) => sel.has(t.dataset.id)).map((t) => t.dataset.id);   // visible ones, in grid order
function selPaint() {
  document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('selected', selMode && sel.has(t.dataset.id)));
  const n = selIds().length;
  $('#sel-count').textContent = n === 1 ? '1 selected' : n + ' selected';
  selBar.querySelectorAll('[data-sel="none"],[data-sel="move"],[data-sel="open"],[data-sel="delete"]').forEach((b) => (b.disabled = !n));
  if (selBar.contains(document.activeElement) && document.activeElement.disabled) selBar.querySelector('[data-sel="all"]').focus();   // e.g. after Clear: don't lose the keyboard focus
}
function selEnter(id) {
  selMode = true; document.body.classList.add('selecting'); selBar.hidden = false;
  kbOff(); hideTip();
  selBase = null;
  if (id) { sel.add(id); selLast = selAnchor = id; }
  selPaint();
}
function selExit() {
  selMode = false; selLast = selAnchor = selBase = null; sel.clear(); document.body.classList.remove('selecting'); selBar.hidden = true;
  hideCtx(); selPaint();
}
const selToggle = (id) => { if (sel.has(id)) sel.delete(id); else sel.add(id); selLast = selAnchor = id; selBase = null; selPaint(); };
// Shift+click / Shift+Space: ticks every tile between the anchor (the tile ticked last without Shift) and this one, both included
function selRange(id) {
  selBase = null;
  const tiles = selTiles(), a = tiles.findIndex((t) => t.dataset.id === selAnchor), b = tiles.findIndex((t) => t.dataset.id === id);
  if (a < 0 || b < 0) { selToggle(id); return; }                                   // no anchor in this grid yet: behaves like a plain click
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(tiles[i].dataset.id);
  selLast = id;
  selPaint();
}
// Shift+arrow: the selection is what it was before the sequence plus every tile from the anchor to the highlighted one;
// Ctrl+arrow (op 'del'): the same tiles are taken out of it instead
function selExtend(id, op = 'add') {
  const tiles = selTiles(), a = tiles.findIndex((t) => t.dataset.id === selAnchor), b = tiles.findIndex((t) => t.dataset.id === id);
  if (a < 0 || b < 0) return;
  if (!selBase) selBase = new Set(sel);
  sel.clear(); selBase.forEach((x) => sel.add(x));
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) { if (op === 'del') sel.delete(tiles[i].dataset.id); else sel.add(tiles[i].dataset.id); }
  selLast = id;
  selPaint();
}
const selAll = () => { selBase = null; selTiles().forEach((t) => sel.add(t.dataset.id)); selPaint(); };
window.addEventListener('keyup', (e) => { if (e.key === 'Shift' || e.key === 'Control') selBase = null; }, true);   // releasing Shift / Ctrl ends the sequence
window.addEventListener('blur', () => { selBase = null; });
function selOpen() {
  const urls = selIds().map((id) => byId.get(id)?.url).filter(Boolean);   // folders have nothing to open
  if (!urls.length) return;
  urls.forEach((url, i) => chrome.tabs.create({ url, active: i === 0 }));
  selExit();
}
async function selDelete() {
  const ids = selIds();
  if (!ids.length) return;
  const nodes = ids.map((id) => byId.get(id)).filter(Boolean);
  const folders = nodes.filter((n) => !n.url && n.children?.length).length;
  if (!confirm(`Delete ${nodes.length} selected item${nodes.length === 1 ? '' : 's'}?` + (folders ? '\n\nFolders are deleted together with everything in them.' : ''))) return;
  const tiles = ids.map((id) => document.querySelector(`.tile[data-id="${id}"]`)).filter(Boolean);
  if (tiles.length && S.anim('animDelete')) await Promise.all(tiles.map((t) => playDelete(S.get().deleteAnim, t)));
  if (tiles.length) flipBegin();
  for (const n of nodes) await M.remove(n);
  flipReady();
  scheduleRefresh();
  selExit();
}
async function selMoveTo(dest) {
  const ids = selIds();
  if (!ids.length) return;
  flipBegin();
  for (const id of ids) await M.move(id, dest);
  flipReady();
  scheduleRefresh();
  selExit();
}
function selMoveMenu(btn) {
  const ids = selIds();
  if (!ids.length) return;
  const parents = new Set(ids.map((id) => byId.get(id)?.parentId));
  const items = [];
  const banned = (id) => ids.some((x) => id === x || isInside(id, x));           // never into itself or its own sub-folders
  const add = (label, id) => { if (!(parents.size === 1 && parents.has(id))) items.push([label, () => selMoveTo(id)]); };
  const walk = (n, depth) => (n.children || []).filter((c) => !c.url && !banned(c.id)).forEach((c) => {
    add('\u00a0\u00a0'.repeat(depth) + '↳ ' + (M.nameOf(c) || c.title), c.id); walk(c, depth + 1);
  });
  groupList().forEach((g) => {
    if (!g.virtual && banned(g.id)) return;
    add(g.title, g.id);
    if (!g.virtual) walk(byId.get(g.id) || g, 1);
  });
  if (!items.length) return;
  const r = btn.getBoundingClientRect();
  showCtx(r.left, r.top, items);
  ctx.style.top = Math.max(8, r.top - ctx.offsetHeight - 8) + 'px';              // the bar is at the bottom: open upwards
}
// the dragged tiles (two or more) dropped on a tile or between tiles
async function dropMany(ds, t, mode) {
  flipBegin();
  if (mode === 'into') {
    const list = t.url ? ds : ds.filter((d) => !isInside(t.id, d.id));            // a folder never goes into itself
    if (!list.length) { flip = null; return; }
    let dest = t.id;
    if (t.url) { const f = await M.addFolder(t.parentId, 'Folder', t.index); await M.move(t.id, f.id); dest = f.id; }   // a link: both go into a new folder
    for (const d of list) await M.move(d.id, dest);
  } else {
    await reorderTo(ds, t, mode === 'after');
  }
  flipReady();
  scheduleRefresh();
  selExit();
}
// Puts the tiles (in their grid order) next to the target, moving only the dragged ones.
async function reorderTo(ds, t, after) {
  const parentId = t.parentId, sibs = (byId.get(parentId)?.children || []).map((c) => c.id);
  if (sibs.length && ds.every((d) => d.parentId === parentId)) {
    const ordered = sibs.filter((i) => ds.some((d) => d.id === i));
    const others = sibs.filter((i) => !ordered.includes(i));
    const k = others.indexOf(t.id) + (after ? 1 : 0);
    const final = [...others.slice(0, k), ...ordered, ...others.slice(k)];
    let list = sibs.slice();
    for (const id of ordered) {                                                    // each one goes right after its predecessor in `final`
      const fi = final.indexOf(id), li = list.indexOf(id), without = list.filter((i) => i !== id);
      const tpos = fi > 0 ? without.indexOf(final[fi - 1]) + 1 : 0;
      if (tpos === li) continue;
      await M.move(id, parentId, tpos <= li ? tpos : tpos + 1);                    // "insert before the position as it was before the move"
      without.splice(tpos, 0, id); list = without;
    }
  } else {
    let ins = t.index + (after ? 1 : 0);
    for (const d of ds) await M.move(d.id, parentId, ins++);
  }
}
document.addEventListener('pointerdown', (e) => {
  selSuppress = false; clearTimeout(lpTimer); lpTimer = 0;
  if (selMode || e.button !== 0 || e.pointerType === 'touch' || dlg.open) return;
  const tile = e.target.closest?.('.tile');
  if (!tile || e.target.closest('.tools') || !kbGrid()?.contains(tile)) return;
  lpX = e.clientX; lpY = e.clientY;
  lpTimer = setTimeout(() => { lpTimer = 0; selSuppress = true; selEnter(tile.dataset.id); }, 500);   // the click that ends the press must not open the tile
}, true);
document.addEventListener('pointermove', (e) => {
  mouseX = e.clientX; mouseY = e.clientY;
  if (lpTimer && Math.hypot(e.clientX - lpX, e.clientY - lpY) > 6) { clearTimeout(lpTimer); lpTimer = 0; }
}, true);
['pointerup', 'pointercancel', 'dragstart'].forEach((ev) => document.addEventListener(ev, () => {
  clearTimeout(lpTimer); lpTimer = 0;
  if (selSuppress) setTimeout(() => (selSuppress = false), 60);                    // after the click that follows the release
}, true));
document.addEventListener('mousedown', (e) => {                                    // Shift+click must not select page text
  if (selMode && e.shiftKey && e.target.closest?.('.tile')) e.preventDefault();
}, true);
document.addEventListener('click', (e) => {
  if (selSuppress) { selSuppress = false; e.preventDefault(); e.stopPropagation(); return; }
  if (!selMode) return;
  const tile = e.target.closest?.('.tile');
  if (!tile || !kbGrid()?.contains(tile)) return;
  e.preventDefault(); e.stopPropagation();                                         // in selection mode a click only ticks
  if (e.shiftKey) selRange(tile.dataset.id); else selToggle(tile.dataset.id);
}, true);
window.addEventListener('keydown', (e) => {
  if (!selMode || e.altKey) return;
  const tg = e.target;
  if (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) return;
  if (dlg.open || $('#picker').open || $('#reset-dlg').open || $('#bk-dlg').open || $('#mode-dlg').open || tg.closest?.('#adv') || $('#settings').classList.contains('open')) return;
  const own = tg.closest?.('#groups, #selbar, #settings, #settings-btn, #add-btn, #f-back, #f-add, #f-close');   // these keep their own Space / Enter
  const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  if (e.key === 'Escape') { stop(); if (!ctx.hidden) hideCtx(); else selExit(); }
  else if (e.key === ' ' && !own && !e.ctrlKey && !e.metaKey) {
    stop();
    if (e.repeat) return;                                                          // a held Space (after a long press) ticks only once
    const hover = document.elementFromPoint(mouseX, mouseY)?.closest?.('.tile');
    const t = (kbActive && selTiles().find((x) => x.dataset.id === kbId)) || (hover && kbGrid()?.contains(hover) ? hover : null);   // the highlighted tile, else the one under the mouse
    if (t) { if (e.shiftKey) selRange(t.dataset.id); else selToggle(t.dataset.id); }
  } else if (e.key === 'Enter' && !own) { stop(); selOpen(); }
  else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && !own) { stop(); selAll(); }
}, true);
// Long press of Space starts selection mode on the highlighted tile (or the one under the mouse), like a long mouse press.
// A short press keeps its old meaning (opens the highlighted tile), but now on key release, so that the two can be told apart.
let spTimer = 0, spTile = null, spShort = null;
const spCancel = () => { clearTimeout(spTimer); spTimer = 0; spTile = null; spShort = null; };
window.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || selMode || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || !root) return;
  const tg = e.target;
  if (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.closest?.('button, a, summary, #groups, #selbar, #settings, #adv')) return;
  if (dlg.open || $('#picker').open || $('#reset-dlg').open || $('#bk-dlg').open || $('#mode-dlg').open || closing || navBusy) return;
  if (spTimer || spTile) { if (spTile) { e.preventDefault(); e.stopImmediatePropagation(); } return; }   // key auto-repeat
  const hl = kbActive && kbTiles().find((x) => x.dataset.id === kbId);
  const hover = document.elementFromPoint(mouseX, mouseY)?.closest?.('.tile');
  const t = hl || (hover && kbGrid()?.contains(hover) ? hover : null);
  if (!t) return;
  spTile = t.dataset.id;
  if (hl) { spShort = e; e.preventDefault(); e.stopImmediatePropagation(); }       // the highlighted tile is opened on release
  spTimer = setTimeout(() => { spTimer = 0; spShort = null; selSuppress = false; selEnter(spTile); }, 500);
}, true);
window.addEventListener('keyup', (e) => {
  if (e.key !== ' ' || !spTile) return;
  const short = spTimer ? spShort : null;                                          // released before 500 ms
  const wasLong = !spTimer;
  spCancel();
  if (wasLong) { e.preventDefault(); return; }
  if (short && !selMode) { e.preventDefault(); kbEnter(short); }
}, true);
window.addEventListener('blur', spCancel);
selBar.addEventListener('mousedown', (e) => e.preventDefault());                   // the bar never takes the keyboard focus
selBar.addEventListener('keydown', (e) => {                                        // Left / Right / Home / End walk over the buttons
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const bs = selBtns(), i = bs.indexOf(document.activeElement);
  if (i < 0) return;
  const j = e.key === 'ArrowRight' ? Math.min(bs.length - 1, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : -1;
  if (j < 0) return;
  e.preventDefault();
  bs[j].focus();
});
selBar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sel]');
  if (!b) return;
  e.stopPropagation();
  const a = b.dataset.sel;
  if (a === 'all') selAll();
  else if (a === 'none') { sel.clear(); selPaint(); }
  else if (a === 'exit') selExit();
  else if (a === 'open') selOpen();
  else if (a === 'delete') selDelete();
  else if (a === 'move') selMoveMenu(b);
});

/* ---------- misc ---------- */
$('#add-btn').onclick = () => { const g = activeGroup(); if (g) openItemDialog({ parentId: g.id }); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openId && !dlg.open) closeFolder(true);
  if (e.key === 'Backspace' && openId && navStack.length && !dlg.open && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
    e.preventDefault();
    goBack();                                  // leave the inner folder
  }
});

// Mode = Bookmarks: let the user choose which bookmarks folder is the root
async function pickRoot() {
  const id = await pickFolder({ currentId: S.get().bookmarksRootId });
  if (!id) return false;
  await S.set({ bookmarksRootId: id });
  await reinit();
  return true;
}
// Mouse "Back" side button: one step back inside an open folder, or close the folder from its top level.
// Only handled while a folder is open (and no dialog is shown); otherwise the browser keeps its default behaviour.
const mouseBackActive = (e) => e.button === 3 && openId && !dlg.open;
['mousedown', 'pointerdown', 'auxclick'].forEach((t) =>
  window.addEventListener(t, (e) => { if (mouseBackActive(e)) e.preventDefault(); }, true));
window.addEventListener('mouseup', (e) => {
  if (!mouseBackActive(e)) return;
  e.preventDefault();                                        // stops the browser from navigating back
  if (navStack.length) goBack(); else closeFolder(true);
}, true);

// Bookmarks mode: the search field searches the bookmarks. It is only a default - the engine can be changed back afterwards.
async function useBookmarksEngine() {
  if (S.get().engine === 'bookmarks') return;
  await S.set({ engine: 'bookmarks' });
  updateSearch();
  SettingsUI.syncControls();
}
// switching Speed Dials <-> Bookmarks
async function changeSource() {
  if (S.get().source === 'bookmarks') {
    const had = await M.isFolder(S.get().bookmarksRootId);
    const ok = await pickRoot();
    if (ok) { await useBookmarksEngine(); return; }
    if (!had) {                                  // cancelled and nothing chosen before: stay on Speed Dials
      await S.set({ source: 'speeddial' });
      SettingsUI.syncControls();
    } else await useBookmarksEngine();
  }
  await reinit();
}

/* ---------- first run: Speed Dials or Bookmarks? ---------- */
// Asked on the first start and again after Reset to Default > Settings. Nothing is created in the bookmarks before the answer.
function chooseMode() {
  const d = $('#mode-dlg'), form = $('#mode-form'), rootRow = $('#mode-root'), path = $('#mode-path'), ok = $('#mode-ok');
  let folderId = null, answered = false;
  const mode = () => form.querySelector('input[name=mode]:checked').value;
  const sync = () => {
    rootRow.hidden = mode() !== 'bookmarks';
    ok.disabled = mode() === 'bookmarks' && !folderId;      // Bookmarks mode needs a root folder
  };
  form.addEventListener('change', sync);
  $('#mode-pick').onclick = async () => {
    const id = await pickFolder({ currentId: folderId });
    if (!id) return;
    folderId = id;
    path.textContent = await M.bookmarksPath({ bookmarksRootId: id });
    path.classList.add('set');
    sync();
  };
  d.addEventListener('cancel', (e) => e.preventDefault());   // Esc does not close it: an answer is required
  d.addEventListener('close', () => { if (!answered) d.showModal(); });   // (the browser may close it anyway: open it again)
  sync();
  return new Promise((resolve) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const bm = mode() === 'bookmarks';
      answered = true;
      await S.set({ source: bm ? 'bookmarks' : 'speeddial', modeChosen: true, ...(bm ? { bookmarksRootId: folderId, engine: 'bookmarks' } : {}) });
      d.close();
      resolve();
    };
    d.showModal();
  });
}
async function reinit() {
  if (openId) hideFolderNow();
  await M.ensureRoot(S.get());
  await refresh();
  updateStorageUI();
  DialMeta.migrate(root).catch(() => {});
}

// caption with the full title when it does not fit into the tile
const tip = $('#tip');
let tipT;
const hideTip = () => { clearTimeout(tipT); tip.hidden = true; };
document.addEventListener('mouseover', (e) => {
  const sp = e.target.closest?.('.tile .label span');
  if (!sp) { hideTip(); return; }
  if (!S.get().showLongTitle) return;
  clearTimeout(tipT);
  tipT = setTimeout(() => {
    if (sp.scrollWidth <= sp.clientWidth + 1) return;
    tip.textContent = sp.textContent;
    tip.hidden = false;
    const r = sp.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    tip.style.top = (r.bottom + 6 + h > innerHeight ? r.top - 6 - h : r.bottom + 6) + 'px';
  }, 350);
});
document.addEventListener('mouseout', (e) => { if (e.target.closest?.('.tile .label span')) hideTip(); });
document.addEventListener('dragstart', hideTip);
document.addEventListener('scroll', hideTip, true);

(async function init() {
  await S.load(); await T.load();
  S.applyCss();
  bindSettingsUI();
  updateSearch();
  bindGrid(gridEl, false);
  if (!S.get().modeChosen) { await chooseMode(); updateSearch(); SettingsUI.syncControls(); }
  await M.ensureRoot(S.get());
  await refresh();
  updateStorageUI();
  DialMeta.migrate(root).catch(() => {});       // one time: icons chosen before this version are written into the titles
  T.onChange(scheduleRefresh);                 // e.g. a Pageview screenshot has just been captured
  const bm = chrome.bookmarks;
  [bm.onCreated, bm.onRemoved, bm.onChanged, bm.onMoved, bm.onChildrenReordered, bm.onImportEnded]
    .forEach((ev) => ev.addListener(scheduleRefresh));
})();
