# Modern Speed Dial

A Vivaldi-style Speed Dial for Chromium browsers (Chrome, Edge, Brave, Vivaldi, Opera): a new-tab page with groups,
thumbnail tiles, folders (also nested), drag & drop, search and a lot of settings. Your dials are stored as ordinary
bookmarks.

## Install
`chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder
(`edge://extensions`, `brave://extensions`, … work the same way). After updating the files press **Reload** on the extension card.

## What it does
- **Groups bar** on top: switch groups (all tiles swipe left/right depending on the direction), drag to re-order,
  right-click / double-click to rename or delete, `+` to add. Many groups wrap into several rows; the maximum width is configurable.
- **Search field** with a selectable engine (Google, Bing, DuckDuckGo, Yandex, Brave, Ecosia, Yahoo, Startpage) and optional
  search-query suggestions. Typing an address opens it directly.
- **Tiles**: link tiles and folders. Folder thumbnail = 2×2 grid of its first four tiles. Hover a tile for the edit (✎) and delete (✕) buttons.
- **Drag & drop**: reorder tiles; drop a tile on another one to create a folder, drop on a folder to move it inside, drop on a group tab to move it to that group.
- **Folders** open as an animated window that grows from the tile and collapses back. Folders can contain folders:
  enter with a click / `Enter`, leave with the back arrow, `Backspace`, the mouse Back button or the browser Back.
  Close with a click outside, `Esc` or ×. Dragging a tile onto the dimmed area moves it out to the current group.
- **Add / Edit dialog**: address with autocomplete (bookmarks, history, popular sites), title, and the thumbnail:
  - *Automatic → Logo*: the site icon on a coloured background. If the site has several icons they appear as a picker with pixel sizes.
  - *Automatic → Pageview*: a screenshot taken when you visit the page, otherwise the page's `og:image`, otherwise the logo.
  - *Image URL* or *Local file* (with Fill / Fit).
- **Long titles**: a caption with the full title appears when a title does not fit into the tile (can be switched off).
- **Tile deletion** plays a "shattering" animation.

## Keyboard
**Tab order** (cyclic): Group bar → Search field → Dials → + Shortcut → Settings → Group bar. `Shift+Tab` goes the other way.
After opening a new tab the focus is in the address bar; the first `Tab` moves it to the Group bar. Empty or hidden parts are skipped.
While a folder is open, `Tab` cycles inside its window: back arrow → tiles → + Shortcut → ×.

| Where | Key | Action |
|---|---|---|
| Group bar | `←` `→` | Previous / next group (selects it, the tiles swipe); `Home` / `End` – first / last |
| Group bar | `↑` `↓` | Row above / below when the groups wrap into several rows |
| Group bar | `Enter` / `Space` on `+` | Create a group |
| Dials | `←` `→` `↑` `↓` | Move the highlight over the tiles (of the page, or of the open folder) |
| Dials | `Home` / `End` | First / last tile |
| Dials | `Enter` / `Space` | Open the highlighted folder or follow the highlighted link (`Ctrl`/`Cmd`/`Shift` + `Enter`/`Space` behave like clicking with that key) |
| Folder | `Backspace` | Leave the inner folder (one level back) |
| Folder | `Esc` | Close the folder |
| Settings | `Enter` / `Space` | Open Quick Settings (the focus moves into it); `Esc` closes it and returns to the gear |

The highlighted group, field and buttons get a focus ring, the highlighted tile an accent frame. Using the mouse hides the tile
highlight; arrow keys do nothing while you type in a field or a dialog is open.

## Settings
**Quick Settings** (gear icon): page background, tile background colour, search engine and suggestions,
thumbnail size, ratio, maximum columns, icon size, and the **Advanced Settings…** button.

**Advanced Settings** (movable window, closes on a click outside or `Esc`):

| Category | Options |
|---|---|
| Dial Source | Speed Dial / Bookmarks; **Choose root folder…** (Bookmarks mode); path of the root folder |
| Start Page | Page background: Color / URL / Image; search engine; search suggestions |
| Groups Bar | Max width in px and in % of the window |
| Speed Dials | Thumbnail size, W:H ratio (1–1.5), max columns, icon size in %, gaps, tile background colour, fetch hi-res icons & previews, refresh site icons |
| Folder Window | Size in % of the page, animation duration |
| Show / Hide | + Shortcut button, search field, tile titles, delete button, long-title caption |
| Layout Offsets | Groups bar, search and tiles top offsets; + Shortcut anchor (bottom of page / below tiles) and offset |
| Animation | Switch off: tile deletion, group switching, folder transitions |

The footer has **Export**, **Import** and **Donate**.

## Where the data lives
- **Speed Dial** source: bookmarks folder `root\Modern Speed Dial`. Chromium usually does not let extensions write to the
  bookmarks root; then the folder is kept in `Other bookmarks`. The real path is shown in Advanced Settings → Dial Source.
- **Bookmarks** source: a bookmarks folder you choose (the Bookmarks bar by default). Its sub-folders are the groups, what is
  inside them are tiles and folders. Renaming, deleting and moving change your real bookmarks.
- Structure: `<root folder>` → `<group>` → link or `<folder>` → (links, nested folders…).
- Settings, thumbnail choices (keyed by the tile URL), custom images, background image, page screenshots and the icon cache
  are kept in `chrome.storage.local` of the extension.
- No cloud sync. (The earlier Google Drive sync was removed; use Export / Import to move data between browsers.)

## Export / Import
Advanced Settings → **Export** writes one JSON file: settings (incl. the background image), the dial tree (groups, folders,
shortcuts, order), thumbnail settings and custom images, page screenshots and the icon cache.
**Import** replaces the current settings, groups and shortcuts with the file (asks for confirmation) and reloads the page.
Export / Import always covers the *Modern Speed Dial* folder, even when the Bookmarks source is shown.

## Permissions and network use
| Permission | Why |
|---|---|
| `bookmarks` | the dials are bookmarks |
| `storage`, `unlimitedStorage` | settings, thumbnails, screenshots, cache |
| `favicon` | the browser's own favicon cache |
| `history` | address autocomplete in the Add dialog |
| `tabs` + all sites (`<all_urls>`) | Pageview screenshots (background.js, only for tiles set to Pageview, at most every 6 h); reading the `<head>` of pages to find the best icon and `og:image`; search suggestions |

Requests made by the page: icon services (Google favicon service, DuckDuckGo icons) for icons of search engines and sites;
the selected search engine's public suggest endpoint while you type (switch **Search suggestions** off to stop this);
the tiles' own sites for icons and previews (switch **Fetch hi-res icons & previews** off to stop this).

## Files
`newtab.html/css` – page · `background.js` – screenshots · `js/app.js` – page logic · `js/model.js` – bookmarks storage ·
`js/settings*.js` – settings and their UI · `js/thumbs.js`, `js/icons.js` – thumbnails and icon search ·
`js/suggest.js`, `js/search-suggest.js` – address / search suggestions · `js/folder-picker.js` – root folder picker ·
`js/backup.js` – export / import · `js/shatter.js` – deletion animation.

## License
MIT, see `LICENSE`.
