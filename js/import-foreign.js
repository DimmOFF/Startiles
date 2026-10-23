// Import of shortcuts made by OTHER programs, turned into the tree Startiles imports: [{ title, children: [{ title, url }, ...] }, ...]
// (top level = groups, a folder inside a group = a folder tile).
//   fromHtml(text)  bookmarks exported as HTML ("Netscape bookmark file": Chrome, Edge, Firefox, Opera, Safari, Brave...)
//   fromJson(raw)   a JSON export of a speed dial extension or of a browser:
//                     - groups and dials as two lists, a dial pointing to its group (FVD Speed Dial and similar)
//                     - nested folders with links (Speed Dial 2, Group Speed Dial, Chrome "Bookmarks" file, Firefox backup, ...)
//                   The keys are recognised by their meaning (url / uri / href..., title / name..., children / dials / items...),
//                   because the exact files of the different extensions are not documented.
// Both return { tree, links, source } or null when the file holds no shortcuts. Only the address and the name are taken: pictures are made again by Startiles.
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const okUrl = (u) => typeof u === 'string' && /^(https?|ftp|file):/i.test(u.trim());
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', laquo: '\u00ab', raquo: '\u00bb', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d' };
const decode = (s) => (s.includes('&')
  ? s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, h, n) => {
      if (n) return NAMED[n.toLowerCase()] ?? m;
      try { return String.fromCodePoint(d ? +d : parseInt(h, 16)); } catch { return m; }
    })
  : s).replace(/\s+/g, ' ').trim();

// ---- the shape of the result ----
const CONTAINER = /^(bookmarks?[ _-]?(bar|toolbar|menu)|other[ _-]?bookmarks|mobile[ _-]?bookmarks|synced[ _-]?bookmarks|favou?rites([ _-]?bar)?|bookmark_bar|other|synced|unfiled[ _-]?bookmarks|\u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435|\u043f\u0430\u043d\u0435\u043b\u044c \u0437\u0430\u043a\u043b\u0430\u0434\u043e\u043a|\u0434\u0440\u0443\u0433\u0438\u0435 \u0437\u0430\u043a\u043b\u0430\u0434\u043a\u0438|\u043c\u0435\u043d\u044e \u0437\u0430\u043a\u043b\u0430\u0434\u043e\u043a|\u043f\u0430\u043d\u0435\u043b\u044c \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432 \u0437\u0430\u043a\u043b\u0430\u0434\u043e\u043a)$/i;
const countLinks = (nodes) => nodes.reduce((a, n) => a + (n.url ? 1 : countLinks(n.children)), 0);
// folders without any link are dropped
const prune = (nodes) => nodes.map((n) => (n.url ? n : { ...n, children: prune(n.children) })).filter((n) => n.url || n.children.length);

// Top level of Startiles = groups. Folders of the browser ("Bookmarks bar", "Other bookmarks"...) and nameless wrappers are opened,
// their folders become groups and their loose links make a group of their own; loose links of the top level go to the group "Imported".
function toGroups(nodes) {
  const out = [], loose = [];
  const take = (list) => {
    for (const n of list) {
      if (n.url) loose.push(n);
      else if (n.anon) take(n.children);
      else if (n.container || CONTAINER.test(n.title.trim())) {
        const own = [], folders = [];
        for (const c of n.children) (c.url ? own : folders).push(c);
        if (own.length) out.push({ title: n.title, children: own });      // the loose links of the folder first, then its folders
        out.push(...folders);
      } else out.push(n);
    }
  };
  take(nodes);
  if (loose.length) out.push({ title: 'Imported', children: loose });
  // the same address twice in one folder is kept once (sponsored dials of some extensions point to one site many times)
  const uniq = (list) => { const seen = new Set(); return list.filter((n) => n.url ? !seen.has(n.url) && seen.add(n.url) : true); };
  const clean = (n) => (n.url ? { title: n.title, url: n.url } : { title: n.title, children: uniq(n.children).map(clean) });
  const tree = prune(out).map(clean);
  return { tree, links: countLinks(tree) };
}
const finish = (nodes, source) => {
  const { tree, links } = toGroups(nodes);
  return links ? { tree, links, source } : null;
};

// ---- bookmarks HTML ----
// A tokenizer instead of a DOM: the old "Netscape" format has unclosed <DT> / <p>, and browsers nest them in surprising ways.
export function fromHtml(text) {
  if (typeof text !== 'string' || !/<a\b/i.test(text)) return null;
  const root = { children: [] }, stack = [root];
  let pending = null;
  const re = /<h3\b([^>]*)>([\s\S]*?)<\/h3>|<a\b([^>]*)>([\s\S]*?)<\/a>|<(\/?)dl\b[^>]*>/gi;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) {
      pending = { title: decode(m[2].replace(/<[^>]*>/g, '')) || 'Folder', children: [], container: /(PERSONAL_TOOLBAR_FOLDER|UNFILED_BOOKMARKS_FOLDER)\s*=\s*"?true/i.test(m[1]) };
    } else if (m[3] !== undefined) {
      const h = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3]);
      const url = h ? decode(h[1] ?? h[2] ?? h[3] ?? '') : '';
      if (okUrl(url)) stack[stack.length - 1].children.push({ title: decode(m[4].replace(/<[^>]*>/g, '')) || host(url), url });
    } else if (m[5] === '/') {
      if (stack.length > 1) stack.pop();
    } else if (pending) {
      stack[stack.length - 1].children.push(pending);
      stack.push(pending);
      pending = null;
    } else stack.push(stack[stack.length - 1]);                 // the DL of the root (or an unnamed one)
  }
  return finish(root.children, 'bookmarks HTML file');
}

// ---- JSON ----
const lc = (o) => { const r = {}; for (const k of Object.keys(o)) r[k.toLowerCase()] = o[k]; return r; };
const URL_KEYS = ['url', 'uri', 'href', 'link', 'address', 'location', 'site'];
const TITLE_KEYS = ['title', 'name', 'label', 'caption', 'text'];
const KID_KEYS = ['children', 'items', 'dials', 'bookmarks', 'links', 'sites', 'entries', 'nodes', 'tiles', 'contents', 'folders', 'groups', 'sub', 'subdials'];
const GROUP_REF = ['group_id', 'groupid', 'idgroup', 'id_group', 'gid', 'group', 'folder_id', 'folderid', 'folder', 'parent_id', 'parentid', 'parent', 'category_id', 'categoryid', 'category'];
const PARENT_REF = ['parentfolderid', 'parent_folder_id', 'parent_id', 'parentid', 'idparent', 'parent'];   // a group inside another group
const ORDER = ['sort', 'sort_order', 'position', 'pos', 'order', 'index', 'weight'];
const str = (o, keys) => { for (const k of keys) if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim(); return ''; };
// FVD Speed Dial keeps a plain address in display_url when `url` is a tracking / sponsor redirect
const urlOf = (o) => { const d = typeof o.display_url === 'string' ? o.display_url.trim() : ''; if (okUrl(d)) return d; const u = str(o, URL_KEYS); return okUrl(u) ? u : ''; };
const first = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
const ord = (o) => { const v = Number(first(o, ORDER)); return Number.isFinite(v) ? v : null; };
const byOrder = (list) => list.map((x, i) => [x, i]).sort((a, b) => (ord(a[0]) ?? 1e9) - (ord(b[0]) ?? 1e9) || a[1] - b[1]).map((p) => p[0]);

// Two lists: groups (an id and a name) and dials (an address and the id of the group), anywhere not deeper than 3 levels.
function findFlat(raw, depth = 0) {
  if (!isObj(raw) || depth > 3) return null;
  const lists = Object.entries(raw).filter(([, v]) => Array.isArray(v) && v.length && v.every(isObj)).map(([k, v]) => [k, v.map(lc)]);
  const dials = lists.find(([, v]) => v.filter(urlOf).length >= v.length * 0.6 && v.some((x) => first(x, GROUP_REF) !== undefined));
  const groups = lists.find(([k, v]) => k !== dials?.[0] && v.every((x) => !urlOf(x)) && v.some((x) => str(x, TITLE_KEYS)) && v.some((x) => first(x, ['id', 'gid', 'group_id', '_id']) !== undefined));
  if (dials && groups) return { dials: dials[1], groups: groups[1] };
  for (const v of Object.values(raw)) { const f = findFlat(v, depth + 1); if (f) return f; }
  return null;
}
function fromFlat({ dials, groups }) {
  const byId = new Map(), pairs = [];
  for (const g of byOrder(groups)) {
    const id = String(first(g, ['id', 'gid', 'group_id', '_id']));
    const node = { title: str(g, TITLE_KEYS) || 'Group', children: [], _o: ord(g) };
    byId.set(id, node); pairs.push([id, g, node]);
  }
  // groups inside groups (a parent id); a loop of parents is cut: such a group goes to the top
  const parentOf = new Map();
  for (const [id, g] of pairs) { const p = first(g, PARENT_REF); if (p !== undefined && String(p) !== id && byId.has(String(p))) parentOf.set(id, String(p)); }
  const loops = (id) => { let cur = id; for (let i = 0; i < 60 && cur !== undefined; i++) { cur = parentOf.get(cur); if (cur === id) return true; } return false; };
  const top = [];
  for (const [id, , node] of pairs) (parentOf.has(id) && !loops(id) ? byId.get(parentOf.get(id)).children : top).push(node);
  const loose = [];
  for (const d of byOrder(dials)) {
    const url = urlOf(d);
    if (!url) continue;
    const link = { title: str(d, TITLE_KEYS) || host(url), url, _o: ord(d) };
    const g = byId.get(String(first(d, GROUP_REF)));
    (g ? g.children : loose).push(link);
  }
  // inside a group the links and the folders go by their own position numbers (stable: equal / missing numbers keep the order of the file)
  const order = (list) => list.map((n, i) => [n, i]).sort((a, b) => (a[0]._o ?? 1e9) - (b[0]._o ?? 1e9) || a[1] - b[1]).map(([n]) => { if (!n.url) n.children = order(n.children); return n; });
  const out = order(top);
  if (loose.length) out.push({ title: 'Imported', children: loose });
  return out;
}

// Nested folders and links, in any wrapping.
function walk(v, depth = 0) {
  if (depth > 14) return [];
  if (Array.isArray(v)) return v.flatMap((x) => walk(x, depth + 1));
  if (!isObj(v)) return [];
  const o = lc(v), u = urlOf(o);
  if (u) return [{ title: str(o, TITLE_KEYS) || host(u), url: u }];
  const has = KID_KEYS.filter((k) => Array.isArray(o[k]));
  if (has.length) {
    const title = str(o, TITLE_KEYS);
    return [{ title: title || 'Folder', anon: !title, children: has.flatMap((k) => walk(o[k], depth + 1)) }];
  }
  return Object.values(v).flatMap((x) => walk(x, depth + 1));     // a wrapper ("roots", "data"...): look inside
}

// What the file is, as far as its shape tells (shown in the Import window)
function nameOf(raw) {
  if (!isObj(raw)) return 'JSON export';
  if (isObj(raw.yasd)) return 'YASD export';
  if (isObj(raw.db) && Array.isArray(raw.db.dials) && isObj(raw.prefs)) return 'FVD Speed Dial export';
  if (Array.isArray(raw.dials) && Array.isArray(raw.groups) && isObj(raw.preferences)) return 'Speed Dial 2 export';
  if (Array.isArray(raw.links) && Array.isArray(raw.categories)) return 'speed dial export (.spd)';
  return null;
}
export function fromJson(raw) {
  if (!isObj(raw) && !Array.isArray(raw)) return null;
  const flat = findFlat(raw);
  if (flat) { const r = finish(fromFlat(flat), nameOf(raw) || 'speed dial export'); if (r) return r; }
  return finish(walk(raw), nameOf(raw) || 'JSON export');
}
