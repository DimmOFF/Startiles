# Modern Speed Dial

Install: `chrome://extensions` → Developer mode → Load unpacked → select this folder.
(Same in Edge `edge://extensions`, Brave, Vivaldi, Opera.)

## Storage
- Tiles: Bookmarks → Other bookmarks → **Modern Speed Dial** → `<group>` → link or `<folder>` → links.
- Thumbnail metadata (auto / image URL / local file) is keyed by tile URL in `chrome.storage.local` (no cloud sync).

## Site icons
Automatic thumbnails try to find the largest icon of a site (apple-touch-icon, manifest icons, SVG) and cache it per origin.
This needs the "read all sites" permission (page HTML is fetched only to find the icon). Turn it off in settings → "High-res site icons".

## Pageview thumbnails
Edit → Automatic → **Pageview**: shows a screenshot taken when you visit the page (background.js, only for tiles set to Pageview;
refreshed at most every 6 h, stored locally, not synced), otherwise the page's og:image, otherwise the logo.

## Address autocomplete
Add dialog suggests sites from bookmarks, history and a built-in list of popular sites (uses the `history` permission).

## Icon picker
In Add/Edit → Automatic → Logo: if the site offers several icons (favicon, apple-touch-icon, manifest icons, SVG),
they appear as a row of choices with their pixel size. "Auto" keeps the best-available behaviour.

## Storage location
Tiles live in `root\Modern Speed Dial`. Chromium usually refuses extension writes to the bookmarks root; then the folder is
kept in `Other bookmarks`. The actual path is shown in Settings → Storage.

## Settings
Quick Settings (gear icon) has the essentials; "Advanced Settings…" opens a window with every option
(background colour/image, show/hide elements, sizes, offsets, folder window).
