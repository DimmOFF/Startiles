# Startiles: Chrome Web Store listing kit

Texts are checked against the repository README of version **1.0.30**; the screenshots were taken from the interface of version 1.0.26. Every image is in this folder.

## 1. Basics

| Field | Value |
|---|---|
| Name (manifest `name`) | Startiles - Speed Dial X Bookmarks Tile |
| Summary (manifest `description`, max 132 characters) | see section 2 |
| Category | Productivity (the closest sub-category, e.g. Tools; check what the dashboard offers) |
| Default language | English; add Russian (and Ukrainian if you like) as a localized listing |
| Store icon 128x128 | `icons/icon128-alt.png` from the extension (already in the manifest) |
| Screenshots | 5 files, 1280x800, PNG |
| Small promo tile | `promo-small-440x280.png` (required) |
| Marquee promo | `promo-marquee-1400x560.png` (optional, only used if the item is featured) |

## 2. Summary (shown in search results and on the listing header, max 132 characters)

The current manifest text (128 characters):

> A fast, customizable new tab with speed dial tiles for your bookmarks: groups, folders, drag & drop, themes and built-in search.

Recommended, because it puts the bookmarks feature into the first line people read (121 characters):

> Speed dial new tab that turns your bookmarks into visual tiles, with instant bookmark search, groups, folders and themes.

Alternative (116 characters):

> Visual speed dial and bookmark manager for your new tab: tiles, groups, folders, instant bookmark search and themes.

The recommended one is applied in the delivered `manifest.json` (version 1.0.31, based on the repository's 1.0.30). Copy that file into the repository.

## 3. Detailed description, English (paste as plain text)

```
Turn your Chrome bookmarks into a customizable visual dashboard. Switch between Speed Dial and your existing bookmarks, search across folders by title or URL, organize links into groups, and personalize tiles with icons, previews, and custom images.

No account. No ads. No proprietary bookmark storage. Your bookmarks stay in Chrome.

Perfect for users who want a fast, customizable new tab page without rebuilding their existing bookmark collection.

TWO MODES, ONE CLICK TO SWITCH
• Speed Dial mode: your favorite sites live as tiles in a dedicated "Startiles Speed Dial" bookmarks folder, arranged in groups.
• Bookmarks mode: show your own bookmarks (the Bookmarks bar or any folder you choose) as a visual tile board. Top-level folders become groups, nested folders open as smooth animated windows, and nothing is copied or locked inside the extension. Renaming, moving or deleting a tile here changes your real bookmark, while Speed Dial mode leaves your own bookmarks untouched.

FIND ANY BOOKMARK INSTANTLY
Pick "Bookmarks" as the search engine and the tiles of all groups and folders are filtered while you type, by title or by address. Press Enter to open the first match, Esc to clear. Prefer the web? Use your favorite search engines directly from the new tab, with optional suggestions.

EVERYTHING YOU NEED
• Groups bar, folders and nested folders
• Drag & drop: reorder tiles, drop one tile on another to make a folder, drop on a group tab to move it
• Tile thumbnails your way: site logos (choose between the available icons), live page previews, or your own image or file
• Themes: Light, Dark, Midnight, Sand, automatic (follows your browser) or create your own
• Full layout control: tile size, ratio, corner size, gaps, columns, offsets, settings icon position
• Smooth animations, including 7 tile-delete effects
• Full keyboard navigation
• Export and import a backup of your settings, themes and tiles

YOUR DATA STAYS YOURS
Tiles are ordinary browser bookmarks, so they follow your browser's own bookmark sync if you use it. No account, no ads. Startiles has no servers of its own and sends no analytics; it only contacts the icon services and the search engine you choose, when needed. You can switch off icon and preview lookups and search suggestions in Advanced Settings.

GET STARTED
Open a new tab. On the first start Startiles asks how you want to work: Speed Dials (its own folder, your bookmarks stay untouched) or Bookmarks (pick any bookmarks folder, and the search is set to Bookmarks right away). You can change this at any time in Advanced Settings. Click "+ Shortcut" to add a site.


----------------------
Why it is written this way: the first sentence says what the extension is in the words people search for (new tab, speed dial, bookmark manager). The bookmarks mode has its own block and is repeated in "Find any bookmark instantly" and "Get started". Keywords are used naturally and not repeated in lists, because the store treats repetitive or irrelevant keywords as a violation that can get an item suspended.

## 5. Screenshots (upload in this order; the first one is the most visible)

| # | File | What it shows |
|---|---|---|
| 1 | screenshot-1-speed-dial.png | Speed Dial mode on the Light theme: groups bar, search, tiles, folder previews |
| 2 | screenshot-2-dark-theme.png | The same board on the Dark theme |
| 3 | screenshot-3-folders.png | A folder opened as a window over the dimmed board |
| 4 | screenshot-4-themes.png | Advanced Settings > Appearance > Theme: built-in themes, a custom theme, colours |
| 5 | screenshot-5-layout.png | Advanced Settings > Appearance > Layout: tile size, ratio, corners, offsets |

These are real captures of the running extension, placed in a browser window frame (light chrome for the light theme, dark chrome for the dark theme) at 1280x800, with no captions drawn on them. The bare UI crops are in `_gen/shots/`, the uncropped originals in `Real/`. There is no real capture of Bookmarks mode or of the search filtering yet; if you take one, put it first, it is the feature the listing sells hardest.

## 6. Privacy practices tab (the dashboard asks for these)

**Single purpose:** Replace the new tab page with a visual speed dial and bookmark board with groups, folders and search.

**Permission justifications** (paste one per field):

- `bookmarks`: Tiles, groups and folders are stored as ordinary browser bookmarks (the "Startiles Speed Dial" folder, or the folder the user chooses in Bookmarks mode). The extension reads, creates, moves and deletes only those bookmarks when the user edits tiles.
- `storage` and `unlimitedStorage`: Settings, themes, per-tile thumbnail choices and user images are saved locally. Page previews and user images can exceed the default quota.
- `favicon`: Shows the site icon on tiles and next to tile titles.
- `history`: Used only for address suggestions in the Add / Edit dialog (bookmarks, visited sites and popular sites matching what the user types).
- `tabs`: For tiles set to "Pageview", the extension notices when the active tab finishes loading and takes a screenshot of that page for the tile, at most every 6 hours per page. The toolbar button opens the new tab page.
- Host permissions (`<all_urls>`): Needed to read the head of the user's own bookmarked sites to find their logos and preview images, to capture the visible tab for Pageview tiles, and to request search suggestions from the search engine the user selected. No page content is read or modified.

**Remote code:** none. All scripts are packaged in the extension.

**Data usage disclosure** (what to tick and explain):

- The extension handles web history (address suggestions, processed locally) and bookmarks (the user's own, processed locally). Nothing is sold, transferred to third parties for unrelated purposes or used for creditworthiness or lending.
- Network requests that include data: icon lookups send the domain of a bookmarked site to public icon services (Google favicon services and DuckDuckGo icons), and search suggestions send the text typed in the search field to the search engine the user selected. Both can be switched off in Advanced Settings ("Try to fetch hi-res icons & previews", "Search suggestions"). There are no developer servers and no analytics.

**Privacy policy:** the dashboard requires a link. A short page is enough: what is stored locally, the two kinds of requests above, no analytics, no accounts, a contact email. I can write it if you want.

**Review note:** `<all_urls>`, `tabs` and `history` together are broad permissions, which usually means a longer manual review. The justifications above should be pasted exactly, and they match what the code does today.

## 7. Before you submit

1. Zip the extension folder contents (the zip root must contain `manifest.json`). Exclude `README.md` and `LICENSE` if you prefer, they are harmless.
2. Create a developer account in the Chrome Web Store dashboard (a one-time registration fee applies, check the current amount there).
3. Upload the zip, fill the listing from sections 1 to 5, and the Privacy practices tab from section 6.
4. Add the support contact (email or site) and the privacy policy link.
5. Submit for review. Promo images are approved together with the item.
6. For the Russian listing, add a localized version in the dashboard and paste section 4. Screenshots can be reused.

## 8. Things to avoid on the listing

- Claims like "number one" or "editor's choice"; the store asks developers not to misrepresent their status.
- Names of other browsers or products as keywords (for example "like Vivaldi").
- Repeating keywords in long lists.
