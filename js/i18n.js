// Interface language. The English text of the interface is the KEY: every language has its own file lang/<code>.js with the translations of the
// English texts (a text and its translation; for a number a list of forms); a text that is not in the file stays as it is (English).
//   t('Delete', vars)            one text; {name} in the text is replaced by vars.name
//   tn(n, 'one {n}', 'many {n}') a text with a number: the form is chosen by the rules of the language
// The ready markup of the interface (dialogs, settings, menus) is translated by watch(): it looks at the texts and the title / placeholder /
// aria-label attributes that appear in the parts of the page listed in AREA and translates the ones that equal a key. The tiles, groups, folder
// names and everything the user typed are outside AREA (or inside a [data-nt] element), so they are never touched.

export const CODES = ['en', 'de', 'es', 'fr', 'ru', 'uk', 'pt', 'pl', 'it', 'tr', 'ja', 'zh', 'ko'];
// [value of the setting, name]: the names of the languages are written in the language itself and are not translated
export const LANGUAGES = [['auto', 'Auto (browser language)'], ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['ru', 'Русский'], ['uk', 'Українська'],
  ['pt', 'Português (Brasil)'], ['pl', 'Polski'], ['it', 'Italiano'], ['tr', 'Türkçe'], ['ja', '日本語'], ['zh', '简体中文'], ['ko', '한국어']];

const AREA = '#settings, #adv, #dlg, #picker, #reset-dlg, #mode-dlg, #bk-dlg, #selbar, #ctx, #foot, #search, #settings-btn, .undo-toast, #folder-layer header';
const NO = '[data-nt], .ac, .ptree, #folder-layer h2';
// which form of a number a language uses (index into the list of forms of a text)
const slavic = (n) => (n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2);
const PLURAL = {
  en: (n) => (n === 1 ? 0 : 1), de: (n) => (n === 1 ? 0 : 1), es: (n) => (n === 1 ? 0 : 1), it: (n) => (n === 1 ? 0 : 1),
  fr: (n) => (n === 0 || n === 1 ? 0 : 1), pt: (n) => (n === 0 || n === 1 ? 0 : 1),
  ru: slavic, uk: slavic,
  pl: (n) => (n === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 1 : 2),
  tr: () => 0, ja: () => 0, zh: () => 0, ko: () => 0,                  // no forms of a number
};
let code = 'en';
const dict = new Map();
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s);

// the language to use: the setting, or (Auto) the language of the browser when it is one of ours, else English
export function detect(pref) {
  if (CODES.includes(pref)) return pref;
  let l = '';
  try { l = (chrome.i18n.getUILanguage() || '').toLowerCase(); } catch { /* no chrome.i18n */ }
  if (!l) l = (navigator.language || 'en').toLowerCase();
  const base = l.split(/[-_]/)[0];
  return CODES.includes(base) ? base : 'en';
}
export const lang = () => code;

export async function init(pref) {
  code = detect(pref);
  dict.clear();
  if (code !== 'en') {                                     // only the file of the language in use is read: English has nothing to translate
    const mod = await import(`./lang/${code}.js`);
    for (const [k, v] of Object.entries(mod.default)) if (v !== '') dict.set(k, v);
  }
  document.documentElement.lang = code;
}

export const t = (s, vars) => {
  const v = dict.get(s);
  return fill(typeof v === 'string' ? v : s, vars);
};
// n and the English texts for 1 and for the other numbers; the table is looked up by the second one
export function tn(n, one, many, vars) {
  const all = { n, ...vars };
  const v = dict.get(many);
  if (Array.isArray(v)) return fill(v[Math.min(PLURAL[code](n), v.length - 1)], all);
  if (typeof v === 'string') return fill(v, all);                      // the same text for every number
  return fill(code === 'en' && n === 1 ? one : many, all);
}

// ----- the translation of the ready markup -----
const lookup = (s) => {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  const key = norm(m[2]);
  if (!key) return null;
  const v = dict.get(key);
  return typeof v === 'string' && v !== key ? m[1] + v + m[3] : null;
};
const inArea = (el) => !!el && !!el.closest(AREA) && !el.closest(NO);
const ATTRS = ['title', 'placeholder', 'aria-label'];
const SKIP = /^(SCRIPT|STYLE)$/;
function attrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v) continue;
    const r = lookup(v);
    if (r !== null) el.setAttribute(a, r);
  }
}
const text = (n) => { if (n.parentElement?.tagName === 'TEXTAREA') return; const r = lookup(n.nodeValue); if (r !== null) n.nodeValue = r; };
// root is inside AREA: its texts and attributes (the parts under NO are skipped)
function walk(root) {
  if (root.closest(NO)) return;
  attrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) { if (!n.parentElement.closest(NO)) text(n); }
    else if (!SKIP.test(n.tagName) && !n.closest(NO)) attrs(n);
  }
}
function tree(node) {
  if (node.nodeType === 3) { if (inArea(node.parentElement)) text(node); return; }
  if (node.nodeType !== 1 || SKIP.test(node.tagName)) return;
  if (node.closest(AREA)) walk(node);
  else node.querySelectorAll(AREA).forEach(walk);                  // a new piece of the page that contains areas (e.g. the folder window)
}
// translates what is in the page now and everything that appears (or changes) later; with English there is nothing to do
export function watch() {
  if (code === 'en') return;
  document.title = t('New Tab');
  tree(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(tree);
      else if (m.type === 'characterData') tree(m.target);
      else if (m.type === 'attributes' && inArea(m.target)) attrs(m.target);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
