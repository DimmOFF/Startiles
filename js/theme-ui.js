// Theme picker (also used in Quick Settings) and the custom theme editor (Advanced Settings > Appearance > Theme):
// editor() returns { head: name + actions, rows: one colour row per key } and settings-ui.js places them.
import * as S from './settings.js';
import { el } from './util.js';
import { COLOR_KEYS, PRESETS, resolve, newId } from './themes.js';

const customs = () => S.get().customThemes || [];
const current = () => customs().find((t) => t.id === S.get().theme) || null;   // the selected custom theme; null for Auto / Light / Dark
const update = (id, patch) => S.set({ customThemes: customs().map((t) => (t.id === id ? { ...t, ...patch } : t)) });
function nextName() {
  const names = new Set(customs().map((t) => t.name));
  let n = customs().length + 1;
  while (names.has('Custom ' + n)) n++;
  return 'Custom ' + n;
}

export function picker(reg, refreshAll) {
  const lab = el('label', 'row', '<span>Theme</span>');
  const sel = el('select', 'theme-sel');
  const fill = () => {
    const opts = [['auto', 'Auto (follow browser)'], ...Object.entries(PRESETS).map(([id, p]) => [id, p.name]), ...customs().map((t) => [t.id, t.name])];
    sel.replaceChildren(...opts.map(([v, t]) => new Option(t, v)));
    sel.value = opts.some(([v]) => v === S.get().theme) ? S.get().theme : 'auto';
  };
  sel.onchange = () => { S.set({ theme: sel.value }); refreshAll(); };
  reg(fill);
  fill();
  lab.append(sel);
  return lab;
}

export function editor(reg, refreshAll) {
  const head = el('div', 'theme-editor');
  const note = el('p', 'note', 'Built-in themes cannot be edited. Create a custom theme to change the colors.');
  const nameRow = el('label', 'row', '<span>Theme name</span>');
  const name = el('input', 'theme-name'); name.type = 'text'; name.maxLength = 40;
  nameRow.append(name);
  const rows = {}, inputs = {};                              // one row (label + colour) per colour key; the page arranges them
  let follow = null;
  COLOR_KEYS.forEach(([k, label]) => {
    const r = el('label', 'row crow'), sp = el('span'), i = el('input'), w = el('span', 'cwrap');
    sp.textContent = label; i.type = 'color'; inputs[k] = i;
    i.oninput = () => { const t = current(); if (t) { update(t.id, { colors: { ...t.colors, [k]: i.value } }); refresh(); } };
    if (k === 'folderBg') {                                  // by default the folder window uses the page background
      follow = el('button', 'pill sm', 'Auto'); follow.type = 'button';
      follow.title = 'Follow the page background';
      follow.onclick = (e) => {
        e.preventDefault();
        const t = current();
        if (!t) return;
        const { folderBg, ...rest } = t.colors;
        update(t.id, { colors: rest }); refresh();
      };
      w.append(follow);
    }
    w.append(i); r.append(sp, w); rows[k] = r;
  });
  const btns = el('div', 'theme-btns');
  const mk = (txt, fn) => { const b = el('button', 'pill sm', txt); b.type = 'button'; b.onclick = fn; return b; };
  const clone = (nm) => {
    const colors = { ...resolve(S.get()).colors };
    delete colors.folderBg;                                  // keep following the page background
    const t = { id: newId(), name: nm, colors };
    S.set({ customThemes: [...customs(), t], theme: t.id });
    refreshAll();
  };
  const create = mk('Create custom theme from this', () => clone(nextName()));
  const dup = mk('Duplicate', () => clone((current()?.name || 'Theme') + ' copy'));
  const del = mk('Delete theme', () => {
    const t = current();
    if (!t || !confirm(`Delete theme "${t.name}"?`)) return;
    S.set({ customThemes: customs().filter((x) => x.id !== t.id), theme: 'auto' });
    refreshAll();
  });
  btns.append(create, dup, del);
  name.onchange = () => {
    const t = current(), v = name.value.trim();
    if (!t) return;
    if (v) update(t.id, { name: v });
    refreshAll();
  };
  const refresh = () => {
    const t = current(), res = resolve(S.get());
    if (follow) follow.hidden = !t || !t.colors.folderBg;
    note.hidden = !!t; nameRow.hidden = !t; dup.hidden = del.hidden = !t; create.hidden = !!t;
    if (t && document.activeElement !== name) name.value = t.name;
    COLOR_KEYS.forEach(([k]) => {
      inputs[k].disabled = !t;
      if (inputs[k].value.toLowerCase() !== res.colors[k].toLowerCase()) inputs[k].value = res.colors[k];
    });
  };
  reg(refresh);
  refresh();
  head.append(note, nameRow, btns);                          // the name and the actions sit right under the theme choice
  return { head, rows };
}
