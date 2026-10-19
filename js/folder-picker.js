// Modal window with the bookmarks tree: the user picks the folder that will be used as the extension's root.
// Resolves with the chosen folder id, or null when cancelled.
import { $, el, svg, ICON, closeOnBackdrop } from './util.js';

export async function pickFolder({ currentId = null, title = 'Choose the root bookmarks folder' } = {}) {
  const dlg = $('#picker');
  const tree = await chrome.bookmarks.getTree();
  const roots = tree[0].children || [];
  const nodes = new Map();          // id -> { data, path, row, kids, caret }
  let selected = null, result = null;

  dlg.innerHTML = `<div class="dform pk">
    <h3></h3>
    <p class="note pk-hint">Subfolders of the chosen folder become groups, everything inside them becomes shortcuts.</p>
    <div class="ptree" role="tree"></div>
    <p class="note pk-path"></p>
    <div class="btns"><span class="sp"></span>
      <button type="button" id="pk-cancel">Cancel</button>
      <button type="button" id="pk-ok" class="primary" disabled>Select</button>
    </div></div>`;
  $('h3', dlg).textContent = title;
  const box = $('.ptree', dlg), pathEl = $('.pk-path', dlg), ok = $('#pk-ok', dlg);

  const select = (id) => {
    selected = id;
    nodes.forEach((n, k) => n.row.classList.toggle('on', k === id));
    ok.disabled = !id;
    pathEl.textContent = id ? 'Selected: ' + nodes.get(id).path : '';
  };
  const setOpen = (n, open) => {
    n.kids.hidden = !open;
    n.caret.textContent = open ? '▾' : '▸';
  };

  function build(data, parentPath, depth) {
    const wrap = el('div', 'pnode');
    const name = data.title || '(untitled)';
    const path = parentPath ? parentPath + '\\' + name : name;
    const subs = (data.children || []).filter((c) => !c.url);
    const links = (data.children || []).length - subs.length;

    const row = el('div', 'prow');
    row.style.paddingLeft = 8 + depth * 18 + 'px';
    row.setAttribute('role', 'treeitem');
    const caret = el('span', 'pcaret', subs.length ? '▸' : '');
    const ico = el('span', 'pico', svg(ICON.folder, 16));
    const label = el('span', 'plabel');
    label.textContent = name;
    const cnt = el('span', 'pcount');
    cnt.textContent = links ? String(links) : '';
    row.append(caret, ico, label, cnt);

    const kids = el('div', 'pkids');
    kids.hidden = true;
    subs.forEach((s) => kids.append(build(s, path, depth + 1)));
    wrap.append(row, kids);

    const n = { data, path, row, kids, caret };
    nodes.set(data.id, n);
    caret.onclick = (e) => { e.stopPropagation(); if (subs.length) setOpen(n, kids.hidden); };
    row.onclick = () => select(data.id);
    row.ondblclick = () => { if (subs.length) setOpen(n, kids.hidden); };
    return wrap;
  }
  roots.forEach((r) => box.append(build(r, '', 0)));
  roots.forEach((r) => setOpen(nodes.get(r.id), true));      // top-level bookmark folders are shown expanded

  // reveal and pre-select the folder that is used right now
  if (currentId && nodes.has(currentId)) {
    const byParent = new Map();
    nodes.forEach((n, id) => (n.data.children || []).forEach((c) => { if (!c.url) byParent.set(c.id, id); }));
    for (let p = byParent.get(currentId); p; p = byParent.get(p)) setOpen(nodes.get(p), true);
    select(currentId);
    nodes.get(currentId).row.scrollIntoView({ block: 'center' });
  }

  return new Promise((resolve) => {
    $('#pk-cancel', dlg).onclick = () => dlg.close();
    ok.onclick = () => { result = selected; dlg.close(); };
    closeOnBackdrop(dlg);
    dlg.addEventListener('close', () => { dlg.replaceChildren(); resolve(result); }, { once: true });
    dlg.showModal();
  });
}
