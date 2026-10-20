// Network helpers for icons and previews. They run in a Web Worker ON PURPOSE.
//
// When a page of the extension downloads a site URL (fetch(), <img>, createImageBitmap()), Chrome also processes the
// "Link: <...>; rel=preload; as=script" headers of that response inside the page. Sites such as notion.site send them for
// EVERY path (even for /favicon.ico), so the extension page logged a CSP error for each script of each such site.
// A worker has no document, so nothing is preloaded and nothing is logged. Only plain data goes back to the page.

const timeout = (ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
};
const isSvgText = (buf) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(new TextDecoder().decode(buf.slice(0, 600)));

// Pages are asked like a browser asks for a page. Amazon and eBay answer a bare request (Accept: */*) with a bot check instead of the page.
const PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': (navigator.languages && navigator.languages.length ? navigator.languages.join(',') : 'en-US,en') + ';q=0.9',
};
// Sites that block anonymous requests but show the real page to a browser that has its cookies: those are asked a second time WITH the
// cookies of the user's own browser (only after the anonymous request was refused or got a bot check, and only for these sites).
const COOKIE_RETRY = /(^|\.)(amazon|ebay)\.[a-z.]{2,6}$/i;
// A bot check / captcha page (it can come with status 200): it is not the page, so it must not be mistaken for a page without a picture.
const BOT_CHECK = /Pardon Our Interruption|splashui\/challenge|validateCaptcha|Enter the characters you see below|Type the characters you see in this image|api-services-support@amazon\.com|Checking your browser/i;
// GET of a page: { r, text } or null. `read(r, type)` reads the body.
async function getPage(url, ms, read) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return null; }
  const strict = COOKIE_RETRY.test(host);                      // only Amazon / eBay get the browser headers, the bot-check test and the cookie retry; any other site is asked as it always was
  for (const credentials of strict ? ['omit', 'include'] : ['omit']) {
    const t = timeout(ms);
    try {
      const r = await fetch(url, strict ? { credentials, headers: PAGE_HEADERS, signal: t.signal } : { credentials, signal: t.signal });
      if (!r.ok) continue;
      const type = r.headers.get('content-type') || '';
      if (type && !/html/i.test(type)) return null;
      const text = await read(r, type);
      if (strict && BOT_CHECK.test(text.slice(0, 20000)) && !/<meta[^>]+og:image/i.test(text)) continue;   // a bot check: try again with cookies, else give up (null)
      return { text, url: r.url, type };
    } catch { /* timeout / network: next attempt */ } finally { t.done(); }
  }
  return null;
}

// Reads the BODY of a page progressively and stops as soon as find(text) returns something (up to `limit` bytes). Same attempts as getPage.
async function scanPage(url, ms, limit, find) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return null; }
  for (const credentials of COOKIE_RETRY.test(host) ? ['omit', 'include'] : ['omit']) {
    const t = timeout(ms);
    try {
      const r = await fetch(url, { credentials, headers: PAGE_HEADERS, signal: t.signal });
      if (!r.ok) continue;
      const type = r.headers.get('content-type') || '';
      if (type && !/html/i.test(type)) return null;
      const reader = r.body.getReader(), dec = new TextDecoder('utf-8');
      let buf = '', n = 0, from = 0, hit = null;
      while (n < limit) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length; buf += dec.decode(value, { stream: true });
        hit = find(buf.slice(Math.max(0, from - 600)));        // only the new part (+ overlap, so a match cut by a chunk border is not lost)
        from = buf.length;
        if (hit) break;
      }
      reader.cancel().catch(() => {});
      if (hit) return hit;
      if (BOT_CHECK.test(buf.slice(0, 20000))) continue;      // a bot check, not the page: again with cookies
      return null;
    } catch { /* timeout / network: next attempt */ } finally { t.done(); }
  }
  return null;
}
const IMG_URL = /^https:\/\/[^\s"'<>]+\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?$/i;
const unesc = (v) => v.replace(/\\\//g, '/').replace(/&amp;/g, '&');
// The main picture of an Amazon product page: colorImages "hiRes" / "large", data-old-hires, the landingImage, og:image
const AMZ_PATS = [/"hiRes"\s*:\s*"(https:[^"]+)"/i, /\bdata-old-hires\s*=\s*"(https:[^"]+)"/i, /\bdata-a-dynamic-image\s*=\s*["']\{(?:&quot;|")(https:[^"&]+)/i,
  /"large"\s*:\s*"(https:[^"]+)"/i, /\bid="landingImage"[^>]*?\ssrc="(https:[^"]+)"/i, /<meta[^>]+property="og:image"[^>]+content="(https:[^"]+)"/i];
function amazonFind(text) {
  for (const re of AMZ_PATS) { const m = re.exec(text); if (m && IMG_URL.test(unesc(m[1]))) return unesc(m[1]); }
  return null;
}
// The ids of the first photos (i.ebayimg.com/images/g/<id>/s-l*.jpg) on an eBay page, in page order: the gallery of an item, the first listings of
// a brand / category / search page. Several, because the first one is often the og:image, which may be an old catalogue picture that no longer loads.
const EBAY_IMG = /https:\\?\/\\?\/i\.ebayimg\.com\\?\/(?:thumbs\\?\/)?images\\?\/g\\?\/([\w~-]+)\\?\/s-l\d+\.(?:jpg|webp|png)/gi;
const amazonPage = (url, ms = 15000) => scanPage(url, ms, 2.5e6, amazonFind);
async function ebayListing(url, ms = 15000) {
  const ids = new Set();
  await scanPage(url, ms, 1.5e6, (text) => {
    for (const m of text.matchAll(EBAY_IMG)) if (ids.size < 8) ids.add(m[1]);
    return ids.size >= 8 ? true : null;
  });
  return [...ids];
}

// Text of a page in ITS encoding: the charset of the Content-Type header, else <meta charset> / <meta http-equiv=Content-Type> in the first
// bytes, else UTF-8 (many sites still send windows-1251, Shift_JIS, GBK...). Reads at most `limit` bytes; stopAtHead: stops after </head>.
async function readPage(r, type, limit, stopAtHead) {
  const reader = r.body.getReader(), probe = new TextDecoder('latin1'), chunks = [];
  let n = 0, tail = '';
  while (n < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length;
    if (stopAtHead) {
      const t = tail + probe.decode(value);                  // ASCII-compatible view, enough to find the tag
      if (/<\/head>/i.test(t)) break;
      tail = t.slice(-8);
    }
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  let m = /charset\s*=\s*["']?([\w:.-]+)/i.exec(type || '');
  if (!m) m = /<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i.exec(probe.decode(all.subarray(0, 8000)));
  try { return new TextDecoder(m ? m[1] : 'utf-8').decode(all); } catch { return new TextDecoder().decode(all); }   // unknown label: UTF-8
}

// A page as text (used for <link rel=manifest> files and the like).
async function fetchText(url, ms = 4000) {
  const t = timeout(ms);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: t.signal });
    if (!r.ok) return null;
    return { text: await r.text(), url: r.url, type: r.headers.get('content-type') || '' };
  } catch { return null; } finally { t.done(); }
}

// Reads only the <head> of a page (stops at </head> or 600 KB) - much faster than downloading everything.
async function fetchHead(url, ms = 4000) {
  return getPage(url, ms, (r, type) => readPage(r, type, 600000, true));
}

// Size of an SVG from its markup: the viewBox, else width / height in px. The width is reported as 1024 (a vector has no real size),
// the height keeps the aspect ratio.
function svgSize(buf) {
  const tag = /<svg\b[^>]*>/i.exec(new TextDecoder().decode(buf.slice(0, 4000)))?.[0] || '';
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  const num = (n) => { const m = new RegExp('\\b' + n + '\\s*=\\s*["\']\\s*([\\d.]+)\\s*(?:px)?\\s*["\']', 'i').exec(tag); return m ? +m[1] : 0; };
  const w = vb ? +vb[1] : num('width'), h = vb ? +vb[2] : num('height');
  return w > 0 && h > 0 ? { w: 1024, h: Math.max(1, Math.round((1024 * h) / w)) } : { w: 1024, h: 1024 };
}
// Downloads an image and returns its real pixel size (SVG: width 1024, v: true) and a content hash; null when it is not an image.
async function probe(src, ms = 4500) {
  const t = timeout(ms);
  try {
    const r = await fetch(src, { credentials: 'omit', signal: t.signal });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) return null;
    const type = r.headers.get('content-type') || '';
    let w = 0, h = 0, isSvg = false;
    try { const bmp = await createImageBitmap(new Blob([buf], { type })); w = bmp.width; h = bmp.height; bmp.close(); }
    catch {
      isSvg = (/svg/i.test(type) || /\.svg(\?|$)/i.test(src)) && isSvgText(buf);   // SVG cannot be decoded here, check the markup
      if (!isSvg) return null;
    }
    if (!w && !isSvg) return null;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (isSvg) ({ w, h } = svgSize(buf));
    return { w, h, v: isSvg, hash };
  } catch { return null; } finally { t.done(); }
}
const imgWidth = async (src, ms = 4000) => (await probe(src, ms))?.w || null;

// The beginning of a page (up to 150 KB, enough for the header): to find the logo image shown at the top of the page.
async function fetchTop(url, ms = 5000) {
  return getPage(url, ms, (r, type) => readPage(r, type, 150000, false));
}

// An image for the tile image cache: bytes + type (the page scales it and stores it).
async function fetchImage(url, ms = 8000) {
  const t = timeout(ms);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: t.signal });
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!/^image\//.test(blob.type) || blob.size > 6e6) return null;
    return { type: blob.type, buf: await blob.arrayBuffer() };
  } catch { return null; } finally { t.done(); }
}

const OPS = { fetchText, fetchHead, fetchTop, probe, imgWidth, fetchImage, amazonPage, ebayListing };
onmessage = async (e) => {
  const { id, op, url, ms } = e.data;
  let result = null;
  try { result = await OPS[op](url, ms); } catch { result = null; }
  const transfer = result?.buf instanceof ArrayBuffer ? [result.buf] : [];
  postMessage({ id, result }, transfer);
};
