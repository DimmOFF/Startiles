// Calls to the network worker (js/networker.js).
// Requests to sites are made in a Web Worker ON PURPOSE: if the extension page itself fetches a site URL, Chrome also processes
// the site's "Link: rel=preload" headers there and logs a CSP error for each script (see the note in networker.js).
let worker;
const pendingCalls = new Map();
let callSeq = 0;
export function netCall(op, url, ms) {
  return new Promise((res) => {
    try {
      if (!worker) {
        worker = new Worker(new URL('./networker.js', import.meta.url));
        worker.onmessage = (e) => { const f = pendingCalls.get(e.data.id); if (f) { pendingCalls.delete(e.data.id); f(e.data.result); } };
        worker.onerror = () => { pendingCalls.forEach((f) => f(null)); pendingCalls.clear(); };
      }
      const id = ++callSeq;
      const guard = setTimeout(() => { if (pendingCalls.delete(id)) res(null); }, (ms || 5000) + 3000);   // never wait forever
      pendingCalls.set(id, (v) => { clearTimeout(guard); res(v); });
      worker.postMessage({ id, op, url, ms });
    } catch { res(null); }
  });
}
