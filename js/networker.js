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

// Reads only the <head> of a page (stops at </head> or 600 KB) - much faster than downloading everything.
async function fetchHead(url, ms = 4000) {
  const t = timeout(ms);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: t.signal });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || '';
    if (type && !/html/i.test(type)) return null;
    const reader = r.body.getReader(), dec = new TextDecoder();
    let text = '';
    while (text.length < 600000) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(text)) break;
    }
    reader.cancel().catch(() => {});
    return { text, url: r.url, type };
  } catch { return null; } finally { t.done(); }
}

// Downloads an image and returns its real pixel width (SVG counts as 1024) and a content hash; null when it is not an image.
async function probe(src, ms = 4500) {
  const t = timeout(ms);
  try {
    const r = await fetch(src, { credentials: 'omit', signal: t.signal });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) return null;
    const type = r.headers.get('content-type') || '';
    let w = 0, isSvg = false;
    try { const bmp = await createImageBitmap(new Blob([buf], { type })); w = bmp.width; bmp.close(); }
    catch {
      isSvg = (/svg/i.test(type) || /\.svg(\?|$)/i.test(src)) && isSvgText(buf);   // SVG cannot be decoded here, check the markup
      if (!isSvg) return null;
    }
    if (!w && !isSvg) return null;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return { w: isSvg ? 1024 : w, hash };
  } catch { return null; } finally { t.done(); }
}
const imgWidth = async (src, ms = 4000) => (await probe(src, ms))?.w || null;

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

const OPS = { fetchText, fetchHead, probe, imgWidth, fetchImage };
onmessage = async (e) => {
  const { id, op, url, ms } = e.data;
  let result = null;
  try { result = await OPS[op](url, ms); } catch { result = null; }
  const transfer = result?.buf instanceof ArrayBuffer ? [result.buf] : [];
  postMessage({ id, result }, transfer);
};
