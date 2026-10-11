import { $, el, hostOf, normalizeUrl, svg, ICON } from './util.js';
import * as S from './settings.js';
import * as T from './thumbs.js';
import * as M from './model.js';
import * as D from './drive.js';
import * as Icons from './icons.js';
import * as Suggest from './suggest.js';

const ENGINES = {
  google:     ['Google',      'https://www.google.com/search?q=%s',       'https://www.google.com'],
  bing:       ['Bing',        'https://www.bing.com/search?q=%s',         'https://www.bing.com'],
  duckduckgo: ['DuckDuckGo',  'https://duckduckgo.com/?q=%s',             'https://duckduckgo.com'],
  yandex:     ['Yandex',      'https://yandex.com/search/?text=%s',       'https://yandex.com'],
  brave:      ['Brave',       'https://search.brave.com/search?q=%s',     'https://search.brave.com'],
  ecosia:     ['Ecosia',      'https://www.ecosia.org/search?q=%s',       'https://www.ecosia.org'],
  yahoo:      ['Yahoo',       'https://search.yahoo.com/search?p=%s',     'https://search.yahoo.com'],
  startpage:  ['Startpage',   'https://www.startpage.com/do/search?q=%s', 'https://www.startpage.com'],
};

const gridEl = $('#grid'), layer = $('#folder-layer'), nav = $('#groups'), dlg = $('#dlg'), ctx = $('#ctx');
let root = null, byId = new Map(), openId = null, dragId = null, dropState = null, closing = false;

/* ---------- data refresh ---------- */
let rt;
const scheduleRefresh = () => {
  clearTimeout(rt);
  rt = setTimeout(() => (dragId ? scheduleRefresh() : refresh()), 60);
};
async function refresh() {
  root = await M.getRoot();
  byId = new Map();
  (function walk(n) { byId.set(n.id, n); (n.children || []).forEach(walk); })(root);
  renderGroups();
  renderGrid();
  if (openId) byId.has(openId) ? renderFolderGrid() : hideFolderNow();
}
function activeGroup() {
  const gs = root.children.filter((c) => !c.url);
  return gs.find((g) => g.id === S.get().activeGroup) || gs[0];
}

/* ---------- groups ---------- */
function renderGroups() {
  const gs = root.children.filter((c) => !c.url), act = activeGroup();
  nav.replaceChildren();
  gs.forEach((g) => {
    const b = el('button', 'group' + (g.id === act.id ? ' active' : ''));
    b.textContent = g.title;
    b.onclick = () => { S.set({ activeGroup: g.id }); renderGroups(); renderGrid(); };
    b.ondblclick = () => renameGroup(g);
    b.oncontextmenu = (e) => {
      e.preventDefault();
      showCtx(e.clientX, e.clientY, [['Rename', () => renameGroup(g)], ['Delete', () => deleteGroup(g)]]);
    };
    b.ondragover = (e) => { if (dragId) { e.preventDefault(); b.classList.add('drop'); } };
    b.ondragleave = () => b.classList.remove('drop');
    b.ondrop = async (e) => {
      e.preventDefault(); b.classList.remove('drop');
      const id = dragId; cleanDrag();
      if (id) { await M.move(id, g.id); scheduleRefresh(); }
    };
    nav.append(b);
  });
  const add = el('button', 'group', '+');
  add.title = 'New group';
  add.onclick = async () => {
    const name = await promptText('New group');
    if (!name) return;
    const g = await M.addFolder(M.rootId, name);
    await S.set({ activeGroup: g.id });
    scheduleRefresh();
  };
  nav.append(add);
}
async function renameGroup(g) {
  const name = await promptText('Rename group', g.title);
  if (name) { await M.update(g.id, { title: name }); scheduleRefresh(); }
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
function tileEl(n) {
  const isF = !n.url;
  const t = el('div', 'tile' + (isF ? ' is-folder' : ''));
  t.dataset.id = n.id;
  t.draggable = true;
  const card = el(isF ? 'div' : 'a', 'card');
  if (!isF) { card.href = n.url; card.draggable = false; }
  const label = el('div', 'label');
  if (isF) label.innerHTML = svg(ICON.folder, 15) + '<span></span>';
  else {
    const i = new Image();
    i.className = 'ico'; i.draggable = false; i.alt = ''; i.src = T.faviconUrl(n.url, 32);
    label.append(i, el('span'));
  }
  label.querySelector('span').textContent = n.title || (n.url ? hostOf(n.url) : 'Folder');
  card.append(isF ? folderThumb(n) : T.renderThumb(n.url), label);
  const tools = el('div', 'tools',
    `<button class="edit" title="Edit">${svg(ICON.pencil, 14)}</button><button class="del" title="Delete">${svg(ICON.x, 14)}</button>`);
  t.append(card, tools);
  return t;
}
function fillGrid(g, node, emptyText) {
  const kids = node.children || [];
  if (!kids.length) g.replaceChildren(el('p', 'empty', emptyText));
  else g.replaceChildren(...kids.map(tileEl));
}
const renderGrid = () => fillGrid(gridEl, activeGroup(), 'No shortcuts yet. Click “+ Shortcut” to add one.');
const renderFolderGrid = () => {
  const n = byId.get(openId);
  $('h2', layer).textContent = n.title;
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
    if (!node.url) return openFolder(node.id, tile);
    if (inFolder) closeFolder(false);
  });
  g.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    dragId = t.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    requestAnimationFrame(() => t.classList.add('dragging'));
  });
  g.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    let t = e.target.closest('.tile'), mode = null;
    const D_ = byId.get(dragId);
    if (!t) {
      const last = [...g.querySelectorAll('.tile')].filter((x) => x.dataset.id !== dragId).pop();
      if (!last || e.target !== g) return;
      const r = last.getBoundingClientRect();
      if (e.clientY > r.bottom || (e.clientY >= r.top && e.clientX > r.right)) { t = last; mode = 'after'; } else return;
    }
    if (t.dataset.id === dragId) return;
    if (!mode) {
      const r = t.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      const canMerge = g.dataset.merge === '1' && D_ && D_.url;
      mode = canMerge && x > 0.28 && x < 0.72 ? 'into' : x < 0.5 ? 'before' : 'after';
    }
    setDrop(t, mode);
  });
  g.addEventListener('drop', (e) => { if (dragId) { e.preventDefault(); applyDrop(); } });
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
  dragId = null;
}
async function applyDrop() {
  const st = dropState, id = dragId;
  cleanDrag();
  if (!st || !id) return;
  const d = byId.get(id), t = byId.get(st.targetId);
  if (!d || !t) return;
  if (st.mode === 'into') {
    if (!t.url) await M.move(d.id, t.id);
    else {
      const f = await M.addFolder(t.parentId, 'Folder', t.index);
      await M.move(t.id, f.id);
      await M.move(d.id, f.id);
    }
  } else {
    const ins = t.index + (st.mode === 'after' ? 1 : 0);
    if (d.parentId === t.parentId && (ins === d.index || ins === d.index + 1)) return;
    await M.move(d.id, t.parentId, ins);
  }
  scheduleRefresh();
}
document.addEventListener('dragend', cleanDrag);

async function deleteNode(n) {
  if (!n.url && n.children?.length && !confirm(`Delete folder "${n.title}" with ${n.children.length} item(s)?`)) return;
  await M.remove(n);
  scheduleRefresh();
}

/* ---------- folder modal ---------- */
function openFolder(id, tileEl_) {
  if (openId) { openId = id; renderFolderGrid(); return; }
  openId = id;
  document.body.style.overflow = 'hidden';
  layer.hidden = false;
  layer.innerHTML = `<div class="fback"></div><section class="fpanel">
    <header><h2></h2><div class="fbtns"><button class="pill sm" id="f-add">+ Shortcut</button>
    <button class="icon-btn" id="f-close" title="Close">&times;</button></div></header>
    <div class="grid fgrid" data-merge="0"></div></section>`;
  bindGrid($('.fgrid', layer), true);
  renderFolderGrid();
  animateOpen(tileEl_.querySelector('.thumb') || tileEl_);
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
  layer.getAnimations().forEach((a) => a.cancel());
  layer.hidden = true; layer.innerHTML = ''; openId = null; closing = false;
  document.body.style.overflow = '';
}
async function closeFolder(animated) {
  if (!openId || closing) return;
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
  if (e.target.closest('#f-add')) return openItemDialog({ parentId: openId });
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
  const id = dragId; cleanDrag();
  await M.move(id, activeGroup().id);
  scheduleRefresh();
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
  const st = { mode: t0.mode, url: t0.url || '', dataUrl: t0.dataUrl || '', fit: t0.fit || 'cover', auto: t0.auto || 'logo' };
  dlg.innerHTML = `<form class="dform">
    <h3>${isNew ? 'Add' : 'Edit'}</h3>
    ${isNew ? '<div class="seg"><button type="button" data-kind="link" class="on">Shortcut</button><button type="button" data-kind="folder">Folder</button></div>' : ''}
    <label class="f" data-only="link"><span>Address</span><input name="addr" placeholder="https://example.com"><div class="ac" hidden></div></label>
    <label class="f"><span>Title</span><input name="ttl"></label>
    <div class="thumbsec" data-only="link">
      <div class="prev"></div>
      <div class="opts">
        <label class="r"><input type="radio" name="mode" value="auto"> Automatic</label>
        <div class="seg sm" id="ak"><button type="button" data-ak="logo">Logo</button><button type="button" data-ak="pageview">Pageview</button></div>
        <label class="r"><input type="radio" name="mode" value="url"> Image URL</label>
        <input name="imgurl" placeholder="https://…/image.png">
        <label class="r"><input type="radio" name="mode" value="file"> Local file</label>
        <input type="file" name="file" accept="image/*">
        <label class="r">Fit <select name="fit"><option value="cover">Fill</option><option value="contain">Fit inside</option></select></label>
      </div>
    </div>
    <div class="btns">${isNew ? '' : '<button type="button" class="danger" id="d-del">Delete</button>'}<span class="sp"></span>
      <button type="button" id="d-cancel">Cancel</button><button type="submit" class="primary">Save</button></div>
  </form>`;
  const f = $('form', dlg), E = f.elements, prev = $('.prev', dlg);
  E.addr.value = node?.url || '';
  E.ttl.value = node?.title || '';
  E.imgurl.value = st.url;
  E.fit.value = st.fit;
  f.querySelectorAll('input[name=mode]').forEach((r) => (r.checked = r.value === st.mode));

  const showKind = () => f.querySelectorAll('[data-only=link]').forEach((x) => (x.hidden = kind !== 'link'));
  let pt;
  const upd = () => {
    clearTimeout(pt);
    pt = setTimeout(() => {
      const url = normalizeUrl(E.addr.value) || 'https://example.com';
      prev.replaceChildren(T.renderThumbFrom(url, st));
    }, 150);
  };
  const ak = $('#ak', dlg);
  const syncAk = () => {
    ak.hidden = st.mode !== 'auto';
    ak.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.ak === st.auto));
  };
  ak.querySelectorAll('button').forEach((b) => (b.onclick = () => { st.auto = b.dataset.ak; syncAk(); upd(); }));
  const setMode = (m) => { st.mode = m; syncAk(); f.querySelectorAll('input[name=mode]').forEach((r) => (r.checked = r.value === m)); upd(); };

  f.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => {
    kind = b.dataset.kind;
    f.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
    showKind();
  }));
  f.querySelectorAll('input[name=mode]').forEach((r) => (r.onchange = () => setMode(r.value)));
  // address autocomplete
  const ac = $('.ac', dlg);
  let items = [], sel = -1, acT;
  const closeAc = () => { ac.hidden = true; items = []; sel = -1; };
  const renderAc = () => {
    ac.replaceChildren();
    items.forEach((s, i) => {
      const b = el('button', i === sel ? 'on' : '');
      b.type = 'button';
      const im = new Image(); im.src = T.faviconUrl(s.url, 32); im.draggable = false; im.alt = '';
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
    closeAc(); upd();
  };
  E.addr.oninput = () => {
    upd();
    clearTimeout(acT);
    acT = setTimeout(async () => {
      const q = E.addr.value;
      const r = await Suggest.suggest(q);
      if (E.addr.value !== q) return;
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
  E.imgurl.oninput = () => { st.url = E.imgurl.value.trim(); setMode(st.url ? 'url' : 'auto'); };
  E.fit.onchange = () => { st.fit = E.fit.value; upd(); };
  E.file.onchange = async () => {
    const file = E.file.files[0];
    if (!file) return;
    st.dataUrl = await T.fileToDataUrl(file);
    setMode('file');
  };
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
      if (!url) { E.addr.focus(); return; }
      const ttl = title || hostOf(url);
      if (isNew) await M.addLink(parentId || activeGroup().id, url, ttl);
      else {
        await M.update(node.id, { title: ttl, url });
        if (url !== node.url) await T.rekey(node.url, url);
      }
      const useImg = (st.mode === 'url' && st.url) || (st.mode === 'file' && st.dataUrl);
      await T.setT(url, useImg ? { mode: st.mode, url: st.url, dataUrl: st.mode === 'file' ? st.dataUrl : '', fit: st.fit } : { mode: 'auto', auto: st.auto });
    }
    dlg.close();
    scheduleRefresh();
  };
  showKind(); syncAk(); upd();
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
const q = $('#q');
function updateSearch() {
  const [name, , origin] = ENGINES[S.get().engine] || ENGINES.google;
  q.placeholder = 'Search ' + name;
  $('#engine-ico').src = T.faviconUrl(origin, 32);
}
$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = q.value.trim();
  if (!v) return;
  const looksUrl = /^(https?:\/\/|chrome:\/\/)\S+$/i.test(v) || /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(v);
  const tpl = (ENGINES[S.get().engine] || ENGINES.google)[1];
  location.href = looksUrl ? normalizeUrl(v) : tpl.replace('%s', encodeURIComponent(v));
});

/* ---------- settings UI + Drive sync ---------- */
function bindSettingsUI() {
  const sel = $('select[data-key=engine]');
  Object.entries(ENGINES).forEach(([k, v]) => sel.append(new Option(v[0], k)));
  const panel = $('#settings');
  document.querySelectorAll('[data-key]').forEach((inp) => {
    const k = inp.dataset.key, out = inp.closest('label')?.querySelector('output');
    if (inp.type === 'checkbox') inp.checked = !!S.get()[k]; else inp.value = S.get()[k];
    const show = () => { if (out) out.textContent = inp.value + (inp.dataset.unit || ''); };
    show();
    inp.addEventListener('input', () => {
      const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : inp.value;
      S.set({ [k]: v }); show();
      if (k === 'engine') updateSearch();
    });
  });
  $('#redirect-uri').value = D.redirectUri();
  $('#settings-btn').onclick = (e) => { e.stopPropagation(); panel.classList.toggle('open'); };
  $('#settings-close').onclick = () => panel.classList.remove('open');
  document.addEventListener('click', (e) => { if (!panel.contains(e.target)) panel.classList.remove('open'); });
  $('#refresh-icons').onclick = async () => { await Icons.clear(); scheduleRefresh(); };
  $('#sync-btn').onclick = async () => {
    const s = $('#sync-status');
    s.textContent = 'Syncing…';
    try { await syncNow(true); s.textContent = 'Synced ' + new Date().toLocaleTimeString(); }
    catch (err) { s.textContent = 'Error: ' + err.message; }
  };
}
async function syncNow(interactive) {
  const id = S.get().driveClientId;
  const remote = await D.download(id, interactive);
  const local = T.all(), merged = { ...(remote?.thumbs || {}) };
  for (const k in local) if (!merged[k] || (merged[k].ts || 0) < (local[k].ts || 0)) merged[k] = local[k];
  await T.replaceAll(merged);
  await D.upload(id, { version: 1, updatedAt: Date.now(), thumbs: merged }, interactive);
  scheduleRefresh();
}
let syncT;
T.onChange(() => {
  const s = S.get();
  if (!s.driveAuto || !s.driveClientId) return;
  clearTimeout(syncT);
  syncT = setTimeout(() => syncNow(false).catch(() => {}), 3000);
});

/* ---------- misc ---------- */
$('#add-btn').onclick = () => openItemDialog({ parentId: activeGroup().id });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openId && !dlg.open) closeFolder(true);
});

(async function init() {
  await S.load(); await T.load();
  S.applyCss();
  bindSettingsUI();
  updateSearch();
  bindGrid(gridEl, false);
  await M.ensureRoot();
  await refresh();
  const bm = chrome.bookmarks;
  [bm.onCreated, bm.onRemoved, bm.onChanged, bm.onMoved, bm.onChildrenReordered, bm.onImportEnded]
    .forEach((ev) => ev.addListener(scheduleRefresh));
})();
