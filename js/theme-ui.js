// Theme picker (a drop-down, used in Quick Settings) and the Theme tab of Advanced Settings > Appearance:
// themeTab() returns { gallerySec, sideSec }: a gallery of theme cards on the left ("+ New theme" copies the theme in use; a custom card has a
// pencil to rename it and a trash can to delete it, both shown on hover); on the right the colours of the selected custom theme,
// or a "Customize" offer for a built-in one.
import * as S from './settings.js';
import * as I from './i18n.js';
import { el, svg, ICON } from './util.js';
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

// ---------- Theme tab ----------
const HINTS = {
  pageBg: 'Behind everything on the start page', folderBg: 'Background of an opened folder', text: 'Main text and titles',
  muted: 'Hints, captions and secondary text', icon: 'Icons on tiles and on the settings button', accent: 'Highlights, switches and the active item',
  surface: 'Settings panel, menus and dialogs', field: 'Search box, input fields and bars', label: 'The strip with the title under a tile', thumbBg: 'Behind the picture of a tile',
};
const GROUPS = [['Page', ['pageBg', 'folderBg']], ['Tiles', ['thumbBg', 'label']], ['Text & icons', ['text', 'muted', 'icon', 'accent']], ['Panels & controls', ['surface', 'field']]];
const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
const toHex = (v) => {
  const m = HEX.exec((v || '').trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return '#' + h;
};
const colorsOf = (id) => resolve({ theme: id, customThemes: customs() }).colors;
const selectedId = () => {
  const t = S.get().theme;
  return t === 'auto' || PRESETS[t] || customs().some((c) => c.id === t) ? t : 'auto';
};
const nameOfTheme = (id) => (id === 'auto' ? 'Auto' : PRESETS[id]?.name || customs().find((t) => t.id === id)?.name || 'Theme');

// the little picture on a theme card
function mini(c) {
  const m = el('span', 'tc-mini', '<span class="tt"><b></b><b></b><b></b></span><u></u>');
  m.style.cssText = `--m-bg:${c.pageBg};--m-tile:${c.thumbBg};--m-acc:${c.accent};--m-fg:${c.text}`;
  return m;
}

export function themeTab(reg, refreshAll) {
  const sec = (title, ...kids) => { const s = el('section'); s.append(el('h4', null, title), ...kids); return s; };

  // ----- gallery -----
  const gallery = el('div', 'tgallery');
  let editing = false;                                      // a card name is being edited: the gallery must not be rebuilt under the cursor
  const make = (nm) => {                                    // a new custom theme: a copy of the theme in use
    const colors = { ...resolve(S.get()).colors };
    delete colors.folderBg;                                 // keeps following the page background unless it was set
    const cur = current();
    if (cur?.colors.folderBg) colors.folderBg = cur.colors.folderBg;
    const t = { id: newId(), name: nm, colors };
    S.set({ customThemes: [...customs(), t], theme: t.id });
    refreshAll();
  };
  const copyName = () => (selectedId() === 'auto' ? nextName() : nameOfTheme(selectedId()) + ' copy');
  const remove = (t) => {
    if (!confirm(I.t('Delete theme "{name}"?', { name: t.name }))) return;
    S.set({ customThemes: customs().filter((x) => x.id !== t.id), theme: S.get().theme === t.id ? 'auto' : S.get().theme });
    refreshAll();
  };
  const act = (title, icon, fn, cls = '') => {
    const b = el('button', 'tc-act ' + cls, svg(icon, 14)); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.onclick = (e) => { e.stopPropagation(); fn(b); };
    return b;
  };
  const card = (id, name, t) => {
    const b = el('div', 'tcard'), prev = el('span', 'tc-prev'), row = el('span', 'tc-name'), txt = el('span', 'tc-txt');
    b.tabIndex = 0; b.setAttribute('role', 'button');
    if (id === 'auto') { prev.classList.add('auto'); prev.append(mini(colorsOf('light')), mini(colorsOf('dark'))); }
    else prev.append(mini(colorsOf(id)));
    txt.textContent = name;
    row.append(txt);
    if (t) {
      const rename = () => {                                // the name becomes an input: Enter / leaving the field saves, Esc cancels
        if (editing) return;
        editing = true;
        const inp = el('input', 'tc-edit'); inp.type = 'text'; inp.maxLength = 40; inp.value = t.name; inp.setAttribute('aria-label', 'Theme name');
        let done = false;
        const finish = (save) => {
          if (done) return;
          done = true; editing = false;
          const v = inp.value.trim();
          if (save && v && v !== t.name) update(t.id, { name: v });
          refreshAll();
        };
        inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); };
        inp.onblur = () => finish(true);
        inp.onclick = (e) => e.stopPropagation();
        txt.replaceChildren(inp);
        row.classList.add('editing');
        inp.focus(); inp.select();
      };
      row.append(el('span', 'tc-acts'));
      row.lastChild.append(act('Rename', ICON.pencil, rename), act('Delete theme', ICON.trash, () => remove(t), 'del'));
    }
    b.append(prev, row);
    b.title = name;
    const on = selectedId() === id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    const choose = () => { if (selectedId() !== id) { S.set({ theme: id }); refreshAll(); } };
    b.onclick = choose;
    b.onkeydown = (e) => { if (e.target === b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(); } };
    return b;
  };
  const renderGallery = () => {
    if (editing) return;
    const add = el('button', 'tcard add', '<span class="tc-plus">+</span><span class="tc-name">New theme</span>');
    add.type = 'button'; add.title = 'Make a copy of the theme in use';
    add.onclick = () => make(copyName());
    gallery.replaceChildren(
      card('auto', 'Auto', null),
      ...Object.entries(PRESETS).map(([id, p]) => card(id, p.name, null)),
      ...customs().map((t) => card(t.id, t.name, t)),
      add,
    );
  };

  // ----- offer for a built-in theme -----
  const cta = el('div', 'tcta');
  const ctaTitle = el('h5'), ctaText = el('p', 'note');
  const ctaBtn = el('button', 'pill sm accent', 'Customize this theme'); ctaBtn.type = 'button';
  ctaBtn.onclick = () => make(copyName());
  cta.append(ctaTitle, ctaText, ctaBtn);

  // ----- colours of the selected custom theme -----
  const ed = el('div', 'teditor');
  const swatches = {}, hexes = {}, hints = {}, rows = {};
  let follow = null;
  const setColor = (k, v) => {
    const t = current();
    if (!t) return;
    update(t.id, { colors: { ...t.colors, [k]: v } });
    refresh();
  };
  COLOR_KEYS.forEach(([k, label]) => {
    const r = el('div', 'trow'), sw = el('input', 'tsw'), txt = el('span', 'trow-txt', '<b></b><small></small>'), hx = el('input', 'thex');
    sw.type = 'color'; sw.setAttribute('aria-label', label);
    txt.firstChild.textContent = label; hints[k] = txt.lastChild; hints[k].textContent = HINTS[k];
    hx.type = 'text'; hx.maxLength = 7; hx.spellcheck = false; hx.setAttribute('aria-label', I.t(label) + ' (hex)');
    sw.oninput = () => setColor(k, sw.value);
    hx.onchange = () => { const v = toHex(hx.value); if (v) setColor(k, v); else refresh(); };
    r.append(sw, txt);
    if (k === 'folderBg') {                                 // by default the folder window uses the page background
      follow = el('button', 'pill sm', 'Same as page'); follow.type = 'button';
      follow.title = 'Make the folder window follow the page background again';
      follow.onclick = () => {
        const t = current();
        if (!t) return;
        const { folderBg, ...rest } = t.colors;
        update(t.id, { colors: rest }); refresh();
      };
      r.append(follow);
    }
    r.append(hx);
    swatches[k] = sw; hexes[k] = hx; rows[k] = r;
  });
  const groupsEl = el('div', 'tgroups');
  GROUPS.forEach(([title, keys]) => { const g = el('div', 'tgroup'); g.append(el('h5', null, title), ...keys.map((k) => rows[k])); groupsEl.append(g); });
  ed.append(groupsEl);

  const refresh = () => {
    const t = current(), res = resolve(S.get()), id = selectedId();
    cta.hidden = !!t; ed.hidden = !t;
    if (!t) {
      ctaTitle.textContent = I.t('{name} is a built-in theme', { name: I.t(nameOfTheme(id)) });
      ctaText.textContent = (id === 'auto' ? I.t('Auto switches between Light and Dark together with your browser.') + ' ' : '') + I.t('Built-in themes cannot be edited: make your own copy to change any color.');
    }
    COLOR_KEYS.forEach(([k]) => {
      const v = res.colors[k].toLowerCase();
      if (swatches[k].value.toLowerCase() !== v) swatches[k].value = v;
      if (document.activeElement !== hexes[k]) hexes[k].value = v;
    });
    follow.hidden = !t || !t.colors.folderBg;
    hints.folderBg.textContent = I.t(t && !t.colors.folderBg ? 'Background of an opened folder (now the same as the page)' : HINTS.folderBg);
    renderGallery();
  };
  reg(refresh);
  refresh();

  return { gallerySec: sec('Themes', gallery), sideSec: sec('Colors', cta, ed) };
}
