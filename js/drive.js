// Google Drive sync of thumbnail metadata, stored in the hidden appDataFolder.
// Uses OAuth implicit flow through chrome.identity.launchWebAuthFlow (works in Chrome, Edge, Brave, Vivaldi...).
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE = 'msd-thumbs.json';
let token = null, exp = 0;

export const redirectUri = () => chrome.identity.getRedirectURL();

async function getToken(clientId, interactive) {
  if (token && Date.now() < exp - 30000) return token;
  if (!clientId) throw new Error('Set the OAuth Client ID first');
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: clientId, response_type: 'token', redirect_uri: redirectUri(), scope: SCOPE,
  }).toString();
  const res = await chrome.identity.launchWebAuthFlow({ url: u.href, interactive });
  const p = new URLSearchParams(new URL(res).hash.slice(1));
  token = p.get('access_token');
  if (!token) throw new Error(p.get('error') || 'Authorization failed');
  exp = Date.now() + Number(p.get('expires_in') || 3600) * 1000;
  return token;
}

async function api(url, opts, tok) {
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + tok, ...(opts?.headers || {}) } });
  if (!r.ok) {
    if (r.status === 401) token = null;
    throw new Error(`Drive ${r.status}`);
  }
  return r;
}
async function findFile(tok) {
  const q = encodeURIComponent(`name='${FILE}'`);
  const r = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`, {}, tok);
  return (await r.json()).files?.[0]?.id || null;
}

export async function download(clientId, interactive = true) {
  const tok = await getToken(clientId, interactive);
  const id = await findFile(tok);
  if (!id) return null;
  return (await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {}, tok)).json();
}

export async function upload(clientId, data, interactive = true) {
  const tok = await getToken(clientId, interactive);
  const id = await findFile(tok);
  const meta = { name: FILE, ...(id ? {} : { parents: ['appDataFolder'] }) };
  const b = 'msd' + Date.now();
  const body =
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${b}--`;
  const url = id
    ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  await api(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body }, tok);
}
