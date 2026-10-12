// Captures a screenshot of a page when you visit it, but only for tiles set to "Pageview".
const keyOf = (u) => {
  try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search; }
  catch { return u; }
};
const MAX_W = 640, TTL = 6 * 3600e3;

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.active || !/^https?:/.test(tab.url || '')) return;
  setTimeout(() => capture(tabId), 1200);
});

async function capture(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || !/^https?:/.test(tab.url || '')) return;
    const { thumbs = {}, shots = {} } = await chrome.storage.local.get(['thumbs', 'shots']);
    const k = keyOf(tab.url);
    const match = Object.keys(thumbs).find((u) => thumbs[u].mode === 'auto' && thumbs[u].auto === 'pageview' && keyOf(u) === k);
    if (!match) return;
    if (shots[match] && Date.now() - shots[match].ts < TTL) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const s = Math.min(1, MAX_W / bmp.width), w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = await c.convertToBlob({ type: 'image/webp', quality: 0.8 });
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(out); });
    const cur = (await chrome.storage.local.get('shots')).shots || {};
    cur[match] = { dataUrl: url, ts: Date.now() };
    await chrome.storage.local.set({ shots: cur });
  } catch { /* tab not capturable */ }
}

// Left click on the toolbar button opens the new-tab page (the Speed Dial) in a new tab of the current window.
chrome.action.onClicked.addListener(async () => {
  try { await chrome.tabs.create({ url: 'chrome://newtab/' }); }
  catch { await chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') }); }
});
