// Captures a screenshot of a page when you visit it, but only for tiles set to "Pageview".
const keyOf = (u) => {
  try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search; }
  catch { return u; }
};
const MAX_W = 640, TTL = 6 * 3600e3, VISIT_TTL = 30 * 60e3, VISIT_MS = 90e3;

// After the extension is removed, the browser opens this page (a static page on GitHub Pages, see /uninstall/ there): a goodbye and an optional feedback link.
// Only the version number and the language code of the interface (the setting, or the browser's when it is Auto) are added to the address, so the page opens in
// that language; nothing else is sent anywhere.
const SITE_LANGS = ['en', 'de', 'es', 'fr', 'ru', 'uk', 'pt', 'pl', 'it', 'tr', 'ja', 'zh', 'ko'];
async function setUninstallUrl() {
  let pref = 'auto';
  try { pref = ((await chrome.storage.local.get('settings')).settings || {}).language || 'auto'; } catch { /* no storage */ }
  let l = SITE_LANGS.includes(pref) ? pref : '';
  if (!l) { try { l = String(chrome.i18n.getUILanguage() || navigator.language || '').toLowerCase().split(/[-_]/)[0]; } catch { /* ignore */ } }
  if (!SITE_LANGS.includes(l)) l = 'en';
  try { chrome.runtime.setUninstallURL('https://dimmoff.github.io/Startiles/uninstall/?v=' + encodeURIComponent(chrome.runtime.getManifest().version) + '&lang=' + l); } catch { /* not supported here */ }
}
setUninstallUrl();
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings) setUninstallUrl(); });

// A tile of the new-tab page tells us which tile it opens in its tab (js/app.js): the page that loads in that tab is the
// tile's page even when the address redirects (/ -> /en, http -> https, a login page...), so it is matched by the tab, not by the URL.
const visits = new Map();
const sess = chrome.storage.session;                            // survives the worker being stopped; falls back to memory
async function getVisit(tabId) {
  let v = visits.get(tabId);
  if (!v) { try { const k = 'visit:' + tabId; v = (await sess?.get(k))?.[k]; } catch { /* no session storage */ } }
  return v && Date.now() - v.ts < VISIT_MS ? v : null;
}
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.msd === 'visit' && sender.tab && typeof msg.url === 'string') {
    const v = { url: msg.url, ts: Date.now() };
    visits.set(sender.tab.id, v);
    try { sess?.set({ ['visit:' + sender.tab.id]: v }); } catch { /* ignore */ }
  }
  return false;
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.active || !/^https?:/.test(tab.url || '')) return;
  const v = await getVisit(tabId);
  setTimeout(() => capture(tabId), v ? 2000 : 1200);            // a page opened from a tile gets a little longer to paint
  setTimeout(() => capture(tabId, true), 6000);                  // second try: single-page apps often paint late
});
// a page that finished loading in a background tab is captured when you switch to it
chrome.tabs.onActivated.addListener(({ tabId }) => setTimeout(() => capture(tabId), 900));

// nearly one colour (a blank white page while it is still loading) -> not worth keeping
function lumaSpread(data) {
  let lo = 255, hi = 0;
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return hi - lo;
}

async function capture(tabId, late = false) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || tab.status !== 'complete' || !/^https?:/.test(tab.url || '')) return;
    const { thumbs = {}, shots = {} } = await chrome.storage.local.get(['thumbs', 'shots']);
    const isPv = (u) => thumbs[u] && thumbs[u].mode === 'auto' && thumbs[u].auto === 'pageview';
    const visit = await getVisit(tabId);
    let match = visit && isPv(visit.url) ? visit.url : null, ttl = VISIT_TTL;
    if (!match) {                                               // visited some other way: match by address
      const k = keyOf(tab.url);
      match = Object.keys(thumbs).find((u) => isPv(u) && keyOf(u) === k);
      ttl = TTL;
    }
    if (!match) return;
    const age = shots[match] ? Date.now() - shots[match].ts : Infinity;
    if (age < ttl && !(late && age < 20e3)) return;               // fresh enough (the second try may replace the first shot of this visit)
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const probe = new OffscreenCanvas(24, 24).getContext('2d');
    probe.drawImage(bmp, 0, 0, 24, 24);
    if (lumaSpread(probe.getImageData(0, 0, 24, 24).data) < 10) return;     // blank so far: try again on the next load / visit
    const s = Math.min(1, MAX_W / bmp.width), w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = await c.convertToBlob({ type: 'image/webp', quality: 0.8 });
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(out); });
    const cur = (await chrome.storage.local.get('shots')).shots || {};
    cur[match] = { dataUrl: url, ts: Date.now() };
    await chrome.storage.local.set({ shots: cur });
    if (visit && late) { visits.delete(tabId); try { sess?.remove('visit:' + tabId); } catch { /* ignore */ } }
  } catch { /* tab not capturable */ }
}

// Left click on the toolbar button opens the new-tab page (the Speed Dial) in a new tab of the current window.
// Opera has no usable chrome://newtab/ for an extension: its own new tab page is opened by address instead ("OPR/" is in its user agent)
const isOpera = () => /\bOPR\//.test(navigator.userAgent);
const OPERA_NEWTAB = chrome.runtime.getURL('newtab.html');
async function openNewTab() {
  if (isOpera()) { await chrome.tabs.create({ url: OPERA_NEWTAB }); return; }
  try { await chrome.tabs.create({ url: 'chrome://newtab/' }); }
  catch { await chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') }); }
}
chrome.action.onClicked.addListener(openNewTab);
// Keyboard shortcuts (the keys are set by the user in the browser, see Settings > General > Shortcuts)
chrome.commands.onCommand.addListener((cmd) => { if (cmd === 'open-newtab') openNewTab(); });

// Opera blocks chrome_url_overrides: a new tab always opens its own start page (chrome://startpage/).
// So here every tab that lands on that page is redirected to this extension's new-tab page.
const isOperaStart = (u) => !!u && /^(chrome|opera):\/\/startpage/i.test(u);
const toNewTab = (tabId) => { chrome.tabs.update(tabId, { url: OPERA_NEWTAB }).catch(() => { /* tab already gone */ }); };
if (isOpera()) {
  chrome.tabs.onCreated.addListener((tab) => {
    if (isOperaStart(tab.pendingUrl) || isOperaStart(tab.url)) toNewTab(tab.id);
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (isOperaStart(info.url)) toNewTab(tabId);
  });
}
