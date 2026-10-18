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

// A page as text (used for <link rel=manifest> files and the like).
async function fetchText(url, ms = 4000) {
  const t = timeout(ms);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: t.signal });
    if (!r.ok) return null;
    return { text: await r.text(), url: r.url, type: r.headers.get('content-type') || '' };
  } catch { return null; } finally { t.done(); }
}

// Reads only the <head> of a page (stops at </head> or 250 KB) - much faster than downloading everything.
async function fetchHead(url, ms = 4000) {
  const t = timeout(ms);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: t.signal });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || '';
    if (type && !/html/i.test(type)) return null;
    const reader = r.body.getReader(), dec = new TextDecoder();
    let text = '';
    while (text.length < 250000) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(text)) break;
    }
    reader.cancel().catch(() => {});
    return { text, url: r.url, type };
  } catch { return null; } finally { t.done(); }
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
  const t = timeout(ms);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: t.signal });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || '';
    if (type && !/html/i.test(type)) return null;
    const reader = r.body.getReader(), dec = new TextDecoder();
    let text = '';
    while (text.length < 150000) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    return { text, url: r.url, type };
  } catch { return null; } finally { t.done(); }
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

const OPS = { fetchText, fetchHead, fetchTop, probe, imgWidth, fetchImage };
onmessage = async (e) => {
  const { id, op, url, ms } = e.data;
  let result = null;
  try { result = await OPS[op](url, ms); } catch { result = null; }
  const transfer = result?.buf instanceof ArrayBuffer ? [result.buf] : [];
  postMessage({ id, result }, transfer);
};
