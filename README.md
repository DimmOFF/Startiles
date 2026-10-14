# Startiles - Speed Dial X Bookmarks Tile

A Speed Dial new tab for Chromium browsers (Chrome, Edge, Brave, Vivaldi, Opera): a new-tab page with groups,
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
  The **Bookmarks** engine is not a web search: while you type, the tiles of all groups (and their folders) are filtered by
  title and address. `Enter` opens the first match, `Esc` clears the field, a click on a group tab leaves the results.
- **Tiles**: link tiles and folders. Folder thumbnail = 2×2 grid of its first four tiles. Hover a tile for the edit (✎) and delete (trash can) buttons.
- **Drag & drop**: reorder tiles; drop a tile on another one to create a folder, drop on a folder to move it inside, drop on a group tab to move it to that group.
- **Folders** open as an animated window that grows from the tile and collapses back. Folders can contain folders:
  enter with a click / `Enter`, leave with the back arrow, `Backspace`, the mouse Back button or the browser Back.
  Close with a click outside, `Esc` or ×. Dragging a tile onto the dimmed area moves it out to the current group.
- **Add / Edit dialog**: address with autocomplete (bookmarks, history, popular sites), title, and the thumbnail:
  - *Automatic → Logo*: the site icon on a coloured background. If the site has several icons they appear as a picker with pixel sizes.
  - *Automatic → Pageview*: a screenshot taken when you visit the page, otherwise the page's `og:image`, otherwise the logo.
  - *Image URL* or *Local file* (Fit: Fill / Fit inside / Icon size - the image is shown at the same size as site icons, following the Icon Size setting). The Fit you used last is preselected next time.
- **Long titles**: a caption with the full title appears when a title does not fit into the tile (can be switched off).
- **Tile deletion** plays an animation of your choice (Settings > Animation: Fade and shrink, Pop, Dissolve, TV off, Shatter, Disintegrate, Poof; default Disintegrate) with a live preview.
- **Themes**: Auto (follows the browser's light / dark mode), Light, Dark, Midnight (deep navy, cyan accent), Sand (warm paper, terracotta accent) and your own custom themes (Settings > Appearance > Theme; the colours are grouped as Page, Tiles, Text & Accent, Panels & Controls). A theme also has a folder window colour that follows the page colour by default.
- **Tile shift**: after a deletion or after moving a tile (drag & drop) the other tiles slide smoothly into their new places.

- **First run**: on the very first start (and again after *Reset to Default → Settings*) a window asks for the mode: **Speed Dials** (own folder, your bookmarks untouched) or **Bookmarks** (you choose the root folder of your bookmarks; the search engine is set to *Bookmarks*). The window cannot be dismissed; nothing is created in the bookmarks before the answer.
- **Toolbar button**: a left click on the extension icon opens the Speed Dial in a new tab of the current window.

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
**Quick Settings** (gear icon): theme, search engine,
tile size, ratio, maximum columns, icon size, and the **Advanced Settings…** button.

**Advanced Settings** (movable window, closes on a click outside or `Esc`):

| Category | Options |
|---|---|
| Mode | Speed Dials / Bookmarks; **Choose root folder…** (Bookmarks mode); path of the root folder. Switching to Bookmarks also sets the search engine to *Bookmarks* (it can be changed back at any time) |
| Start Page | Theme; search engine (incl. Bookmarks); search suggestions; page background Color / URL / Image |
| Icons & Previews | Try to fetch hi-res icons & previews; **Auto-refresh** icons & previews once a day / week / month (default) / year, refresh site icons now |
| Groups Bar | Top offset; max width in px and in % of the window |
| Search Field | Show / hide; top offset |
| Speed Dial Grid | Top offset, max columns, horizontal and vertical gaps |
| + Shortcut Button | Show / hide; anchor (bottom of page / below tiles); offset |
| Tiles | Tile size, W:H ratio (1-1.7), tile corner size, icon size in %, tile titles, long-title caption, delete button |
| Folder Window | Size in % of the page |
| Settings Icon | **Auto hide** (hide the icon until the mouse comes within the **Appearance distance**, default 150 px), anchor (top / bottom), size (default 50, min 32), one offset (default 12; the same distance from the right edge and from the top or bottom edge); Quick Settings opens from the bottom-right corner when the icon is anchored to the bottom |
| Behavior > Animation | Disable all animations, or switch off: tile deletion, tile shift (after delete / move), group switching, folder transitions |

The footer has **Export**, **Import**, **Reset to Default** and **Donate**.

## Reset to Default
Advanced Settings → **Reset to Default** opens a window with check boxes: **Settings** (all options except themes, incl. the
background image), **Themes** (custom themes deleted, theme = Auto) and **Speed Dials** (the *Startiles Speed Dial* folder is emptied and
gets one empty group). Under Speed Dials two more check boxes: **User previews** (images, icons and Pageview choices you set for
tiles) and **Cached previews** (automatically fetched icons, page previews and screenshots). Ticking *Speed Dials* ticks both;
they can also be reset on their own. Nothing happens until you press **Confirm**. Your own bookmarks are never
touched; when *Speed Dials* is ticked the window shows the path of the folder that is reset and the path of your bookmarks that is not.

## Where the data lives
- **Speed Dial** source: bookmarks folder `root\Startiles Speed Dial` (a folder named *Modern Speed Dial* from earlier versions is found and renamed automatically). Chromium usually does not let extensions write to the
  bookmarks root; then the folder is kept in `Other bookmarks`. The real path is shown in Advanced Settings → Mode.
- **Bookmarks** source: a bookmarks folder you choose (the Bookmarks bar by default). Its sub-folders are the groups, what is
  inside them are tiles and folders. Renaming, deleting and moving change your real bookmarks.
- Structure: `<root folder>` → `<group>` → link or `<folder>` → (links, nested folders…).
- Custom tile preview images you upload are scaled down so that their shorter side is at most 420 px (smaller ones are kept as they are).
- Settings, thumbnail choices (keyed by the tile URL), custom images, background image, page screenshots and the icon cache
  (incl. the time each bookmark's icon was last checked) are kept in `chrome.storage.local` of the extension.
- No cloud sync. (The earlier Google Drive sync was removed; use Export / Import to move data between browsers.)

## Tile titles in Speed Dials mode (icon sync)
In the **Speed Dials** mode a link tile whose icon comes from a web address (an image URL, or an icon picked in the Add / Edit window)
is stored with a JSON title: `{"name":"...","icon_url":"...","fit_mode":"cover|contain|icon"}`. The title travels with the bookmark, so
the browser's own bookmark sync carries the icon to your other devices, which show it straight from `icon_url` - no icon search is
needed. The tile shows only `name`. The image is downloaded once and cached by its URL (in the extension, a few hundred images at most).
Tiles without an icon URL keep a plain-text title; local images, Pageview and the automatic site icon are not stored in titles.
In the **Bookmarks** mode titles are never changed or interpreted. Icons chosen before this feature are written into the titles
once after the update. *Reset to Default → User previews* removes the icon URLs from the titles; *Cached previews* clears the image cache.

## Export / Import
**Export** and **Import** open a window with check boxes (like Reset): **Settings** (incl. the background image), **Themes**,
**Speed Dials** (groups, folders, shortcuts, order) and, under it, **User previews** and **Cached previews**. Export writes one JSON file
with what is ticked. Import reads the file, greys out what it does not contain, and offers **Add** or **Replace** for Themes and for
Speed Dials (the previews follow the Speed Dials choice; Settings are always replaced). *Add* merges: themes are appended (renamed on
a name clash), groups and folders with the same name are merged and links with the same address are skipped, existing previews win.
*Replace* deletes the current themes / groups and tiles first. The page reloads afterwards. Backups from older versions can still be imported.
Export / Import always covers the *Startiles Speed Dial* folder, even when the Bookmarks source is shown.

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
the tiles' own sites for icons and previews (switch **Try to fetch hi-res icons & previews** off to stop this; **Auto-refresh** controls how often they are re-checked).

## Files
`newtab.html/css` – page · `background.js` – screenshots · `js/app.js` – page logic · `js/model.js` – bookmarks storage ·
`js/settings*.js` – settings and their UI · `js/thumbs.js`, `js/icons.js` – thumbnails and icon search ·
`js/suggest.js`, `js/search-suggest.js` – address / search suggestions · `js/folder-picker.js` – root folder picker ·
`js/backup.js` – export / import · `js/themes.js`, `js/theme-ui.js` – colour themes · `js/backup-ui.js` – Export / Import window · `js/delete-anims.js` – deletion animations (Fade, Pop, Dissolve, TV off, Shatter, Disintegrate, Poof) · `js/shatter.js` – the shatter effect · `docs/` – the project site (GitHub Pages): donation page and privacy policy.

## Support

Startiles is free and open source. If it is useful to you, you can support its development: **<https://dimmoff.github.io/Startiles/donate/>**
(card and cryptocurrency). Starring the repository, reporting bugs and sharing the extension help just as much.

## Privacy

The developer collects no data; everything stays in your browser. Details: <https://dimmoff.github.io/Startiles/privacy/>

## License
MIT, see `LICENSE`.
