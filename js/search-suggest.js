// Search-query suggestions for the start page search field.
// Each engine is asked through its public suggest endpoint (JSON, OpenSearch "suggestions" format);
// if the chosen engine fails or has nothing, Google's endpoint is used as a fallback.
const E = encodeURIComponent;
const ENDPOINTS = {
  google:     (q) => `https://suggestqueries.google.com/complete/search?client=firefox&q=${E(q)}`,
  bing:       (q) => `https://api.bing.com/osjson.aspx?query=${E(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/ac/?q=${E(q)}&type=list`,
  yandex:     (q) => `https://suggest.yandex.com/suggest-ff.cgi?part=${E(q)}`,
  brave:      (q) => `https://search.brave.com/api/suggest?q=${E(q)}`,
  ecosia:     (q) => `https://ac.ecosia.org/autocomplete?q=${E(q)}&type=list`,
  yahoo:      (q) => `https://search.yahoo.com/sugg/gossip/gossip-us-ff/?command=${E(q)}&output=fxjson`,
  startpage:  (q) => `https://www.startpage.com/suggestions?q=${E(q)}&format=opensearch&segment=startpage.defaultffx`,
};

async function ask(url, signal, ms = 2500) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  const onAbort = () => c.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: c.signal });
    if (!r.ok) return [];
    const j = await r.json();
    const list = Array.isArray(j) ? (Array.isArray(j[1]) ? j[1] : j) : [];
    return list.map((x) => (typeof x === 'string' ? x : x?.phrase || x?.value || '')).filter(Boolean);
  } catch { return []; }
  finally { clearTimeout(t); signal?.removeEventListener('abort', onAbort); }
}

export async function queries(engine, q, signal) {
  q = q.trim();
  if (!q) return [];
  let list = await ask((ENDPOINTS[engine] || ENDPOINTS.google)(q), signal);
  if (!list.length && engine !== 'google' && !signal?.aborted) list = await ask(ENDPOINTS.google(q), signal);
  const seen = new Set([q.toLowerCase()]);
  return list.filter((s) => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
}
