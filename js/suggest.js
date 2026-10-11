// Address autocomplete: bookmarks + browsing history + built-in popular sites.
const POPULAR = [
  ['google.com','Google'],['youtube.com','YouTube'],['music.youtube.com','YouTube Music'],['gmail.com','Gmail'],
  ['mail.google.com','Gmail'],['drive.google.com','Google Drive'],['docs.google.com','Google Docs'],['maps.google.com','Google Maps'],
  ['translate.google.com','Google Translate'],['photos.google.com','Google Photos'],['gemini.google.com','Gemini'],
  ['facebook.com','Facebook'],['instagram.com','Instagram'],['x.com','X'],['twitter.com','Twitter'],['reddit.com','Reddit'],
  ['linkedin.com','LinkedIn'],['twitch.tv','Twitch'],['discord.com','Discord'],['web.telegram.org','Telegram'],
  ['web.whatsapp.com','WhatsApp'],['tiktok.com','TikTok'],['pinterest.com','Pinterest'],['spotify.com','Spotify'],
  ['netflix.com','Netflix'],['wikipedia.org','Wikipedia'],['amazon.com','Amazon'],['ebay.com','eBay'],
  ['aliexpress.com','AliExpress'],['github.com','GitHub'],['stackoverflow.com','Stack Overflow'],['claude.ai','Claude'],
  ['chatgpt.com','ChatGPT'],['notion.so','Notion'],['figma.com','Figma'],['medium.com','Medium'],['bing.com','Bing'],
  ['duckduckgo.com','DuckDuckGo'],['yahoo.com','Yahoo'],['microsoft.com','Microsoft'],['apple.com','Apple'],
  ['dropbox.com','Dropbox'],['trello.com','Trello'],['slack.com','Slack'],['zoom.us','Zoom'],['tradingview.com','TradingView'],
  ['binance.com','Binance'],['bybit.com','Bybit'],['coinmarketcap.com','CoinMarketCap'],['coingecko.com','CoinGecko'],
  ['ukr.net','UKR.NET'],['rozetka.com.ua','Rozetka'],['olx.ua','OLX'],['novaposhta.ua','Nova Poshta'],['ukrposhta.ua','Ukrposhta'],
  ['privat24.ua','Privat24'],['monobank.ua','monobank'],['fiverr.com','Fiverr'],['upwork.com','Upwork'],
];
const strip = (s) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');

export async function suggest(raw) {
  const q = strip(raw.trim());
  if (!q) return [];
  const deep = q.includes('/');
  const out = new Map();
  const add = (url, title, base) => {
    let u;
    try { u = new URL(url); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    const href = deep ? u.href.split('#')[0] : u.origin;
    const host = u.hostname.replace(/^www\./, '');
    const key = host + (deep ? u.pathname + u.search : '');
    const hay = (host + u.pathname + ' ' + (title || '')).toLowerCase();
    if (!hay.includes(q)) return;
    const score = base + (host.startsWith(q) ? 1000 : host.includes(q) ? 500 : 0);
    const e = out.get(key);
    if (!e || e.score < score) out.set(key, { url: href, title: title || host, score });
  };
  try {
    (await chrome.bookmarks.search(q)).slice(0, 40).forEach((b) => b.url && add(b.url, deep ? b.title : '', 300));
  } catch { /* ignore */ }
  try {
    if (chrome.history?.search) {
      const hist = await chrome.history.search({ text: q, maxResults: 120, startTime: 0 });
      hist.forEach((h) => {
        let isRoot = false;
        try { isRoot = new URL(h.url).pathname === '/'; } catch { /* ignore */ }
        add(h.url, deep || isRoot ? h.title : '', 100 + (h.visitCount || 0) + (h.typedCount || 0) * 5);
      });
    }
  } catch { /* ignore */ }
  POPULAR.forEach(([d, t]) => add('https://' + d, t, 50));
  return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 7);
}
