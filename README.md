# Modern Speed Dial

Install: `chrome://extensions` → Developer mode → Load unpacked → select this folder.
(Same in Edge `edge://extensions`, Brave, Vivaldi, Opera.)

## Storage
- Tiles: Bookmarks → Other bookmarks → **Modern Speed Dial** → `<group>` → link or `<folder>` → links.
- Thumbnail metadata (auto / image URL / local file) is keyed by tile URL in `chrome.storage.local`.

## Google Drive sync
1. Google Cloud Console → enable **Google Drive API**.
2. OAuth consent screen → add scope `.../auth/drive.appdata`.
3. Credentials → Create OAuth client ID → **Web application**.
   Authorized redirect URI = the value shown in Settings → Google Drive Sync.
4. Paste the Client ID in settings, press **Sync now**.
Data goes to the hidden app data folder of your Drive (`msd-thumbs.json`).

Note: unpacked extensions get a path-based ID. To keep the redirect URI stable, add a `"key"` field to manifest.json.

## Site icons
Automatic thumbnails try to find the largest icon of a site (apple-touch-icon, manifest icons, SVG) and cache it per origin.
This needs the "read all sites" permission (page HTML is fetched only to find the icon). Turn it off in settings → "High-res site icons".
