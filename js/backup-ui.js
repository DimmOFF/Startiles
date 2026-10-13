// Export / Import window: check boxes choose what is exported / imported (same look as Reset to Default).
// Import additionally offers Add / Replace for Themes and Speed Dials (the previews follow the Speed Dials choice).
import * as Backup from './backup.js';
import { $, el } from './util.js';

const ITEMS = [
  { k: 'settings', t: 'Settings', d: 'All options except themes, including the page background image.' },
  { k: 'themes', t: 'Themes', d: 'Custom themes and the selected theme.', mode: true },
  { k: 'dials', t: 'Speed Dials', d: 'Groups, folders and tiles of the Modern Speed Dial folder.', mode: true },
  { k: 'userThumbs', t: 'User previews', d: 'Images, icons and Pageview choices you set for tiles.', sub: true },
  { k: 'cache', t: 'Cached previews', d: 'Automatically fetched icons, page previews and screenshots.', sub: true },
];

export function init({ status }) {
  const dlg = $('#bk-dlg'), form = $('#bk-form'), box = $('#bk-items'), ok = $('#bk-ok'), note = $('#bk-note');
  const title = $('#bk-title'), lead = $('#bk-lead'), fileIn = $('#imp-file');
  let kind = 'export', file = null;
  const chk = (k) => form.querySelector(`[data-k="${k}"]`);
  const sel = (k) => form.querySelector(`[data-mode="${k}"]`);
  const KEYS = ITEMS.map((i) => i.k);

  function build(avail) {
    box.replaceChildren();
    for (const it of ITEMS) {
      const lab = el('label', 'rchk' + (it.sub ? ' sub' : ''));
      const inp = el('input'); inp.type = 'checkbox'; inp.dataset.k = it.k;
      const b = el('b'), sm = el('small');
      b.textContent = it.t; sm.textContent = it.d;
      lab.append(inp, b, sm);
      if (kind === 'import' && it.mode) {
        const s = el('select', 'rmode', '<option value="add">Add</option><option value="replace">Replace</option>');
        s.dataset.mode = it.k;
        lab.append(s);
      }
      const here = !avail || avail[it.k];
      inp.checked = here; inp.disabled = !here;
      if (!here) { lab.classList.add('na'); sm.textContent += ' Not in this file.'; }
      box.append(lab);
    }
  }
  function refresh() {
    ok.disabled = !KEYS.some((k) => chk(k).checked);
    const rep = kind === 'import' && ['themes', 'dials'].filter((k) => chk(k).checked && sel(k).value === 'replace');
    note.hidden = !rep || !rep.length;
    if (rep && rep.length) note.textContent = 'Replace deletes the current ' + rep.map((k) => (k === 'themes' ? 'custom themes' : 'groups and tiles')).join(' and ') + ' before importing.';
  }
  form.addEventListener('change', (e) => {
    if (e.target === chk('dials')) ['userThumbs', 'cache'].forEach((k) => { if (!chk(k).disabled) chk(k).checked = chk('dials').checked; });   // previews go with the Speed Dials
    refresh();
  });

  function open(k, avail) {
    kind = k;
    title.textContent = k === 'export' ? 'Export' : 'Import';
    ok.textContent = k === 'export' ? 'Export' : 'Import';
    build(avail);
    refresh();
    dlg.showModal();
  }
  $('#exp-btn').onclick = () => {
    lead.textContent = 'Choose what to put into the backup file:';
    open('export', null);
  };
  $('#imp-btn').onclick = () => fileIn.click();
  let loaded = null;
  fileIn.onchange = async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      loaded = await Backup.readFile(f);
      file = f;
      const i = loaded.info, parts = [];
      if (loaded.avail.dials) parts.push(`${i.links} shortcuts in ${i.groups} groups`);
      if (loaded.avail.themes) parts.push(`${i.themes} custom themes`);
      lead.textContent = `${f.name}: ${parts.join(', ') || 'settings and previews'}. Choose what to import:`;
      open('import', loaded.avail);
    } catch (e) { status.textContent = 'Import failed: ' + e.message; }
  };
  $('#bk-cancel').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const on = (k) => chk(k).checked;
    ok.disabled = true;
    try {
      if (kind === 'export') {
        const r = await Backup.exportSelected({ settings: on('settings'), themes: on('themes'), dials: on('dials'), userThumbs: on('userThumbs'), cache: on('cache') });
        dlg.close();
        status.textContent = r.links != null ? `Exported ${r.links} shortcuts` : 'Exported';
      } else {
        status.textContent = 'Importing…';
        const mode = (k) => sel(k).value;
        const o = { settings: on('settings'), themes: { on: on('themes'), mode: mode('themes') }, dials: { on: on('dials'), mode: mode('dials') }, userThumbs: on('userThumbs'), cache: on('cache') };
        dlg.close();
        await Backup.importSelected(loaded.data, o);
        status.textContent = 'Imported, reloading…';
        setTimeout(() => location.reload(), 500);
      }
    } catch (err) { dlg.close(); status.textContent = (kind === 'export' ? 'Export failed: ' : 'Import failed: ') + err.message; }
  };
}
