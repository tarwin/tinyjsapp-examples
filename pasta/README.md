# Pasta 🍝

Clipboard history in the menu bar — plain JavaScript, zero dependencies.
Text, **images**, **copied files**, and **colors**, not just `pbpaste`.

Copy things all day; press **⌘⇧V** anywhere (or click the tray icon) and a
frameless translucent palette drops in: type to search, ↑↓ to pick, **⏎** to
put a clip back on the clipboard — *as whatever it was*: files paste back as
files, images as images, colors as colors, rich text keeps its formatting.
⏎ and esc hand focus straight back to the app you were in (tinyjs `hide()`
deactivates the app), so ⌘⇧V → ⏎ → ⌘V is one uninterrupted motion.
Screenshots show a thumbnail, Finder copies show their filenames, colors show
a swatch, and every clip says which app it came from — for text copied in a
Chromium browser, also which *page* (**⌘O** reopens it). Image and file clips
**drag out of the palette** — grab the thumbnail / the 🗂 and drop real files
into Finder, Slack, anywhere.

More keys: **⌥⏎** copies *and pastes straight into the app you came from*
(one Accessibility grant, prompted on first use); **⇧⏎** copies as plain
text, rich flavour stripped; **⌘P** pins a clip — pinned clips sort first and
survive both pruning and Clear History; ⌘⌫ deletes; esc dismisses; click-out
hides it like a real menu.

One small app, six tinyjs techniques (0.12 — the app never shells out for
the clipboard at all):

1. **Clipboard events** — `export function onClipboardChange({ self }, app)`
   and the launcher watches NSPasteboard for you. No polling loop in the
   app, and `self` marks changes caused by our own `write()`, so a copy-back
   is never re-recorded.
2. **Native clipboard** — one `app.clipboard.read()` per change classifies
   files → image → color → text and carries everything this app needs: the
   html flavour of rich text, image pixel dimensions, the **Concealed flag**
   (password managers — those clips are never recorded), the **source app**
   for attribution, and the **page URL** a Chromium copy came from.
   `write()` restores any kind, and multi-file writes never lose the tail.
3. **Native paste + permissions** — ⌥⏎ is `app.paste()`, a real CGEvent ⌘V
   from the launcher. When Accessibility isn't granted it explains via
   `app.notify` and opens System Settings with
   `app.permissions.request('accessibility')` instead of failing silently.
4. **Drag out** — `tiny.win.startDrag({ files })` from a `mousedown` turns an
   image or files clip into a real native drag.
5. **SQLite history** — txiki's built-in `tjs:sqlite`: search, dedupe
   (`ON CONFLICT … DO UPDATE`), and pruning are one query each. Images dedupe
   by content hash; an old `history.db` migrates in place with `ALTER TABLE`
   in a try/catch. Images live on disk in Application Support with `sips`
   thumbnails — only the thumbnail ever crosses the bridge.
6. **Global hotkey + frameless vibrancy + `tiny.store`** — the classic
   palette chassis: `hotkey.register('palette', 'cmd+shift+v')`, `"chrome":
   { "frame": false, "vibrancy": "menu" }` as a menu-bar agent
   (`"activation": "accessory"`), dismissed on focus loss, Pause flag
   persisted.

The page only ever sees previews and builds all DOM with `textContent`
(clipboard content must never become markup — the page holds an RPC channel
with full system access).

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Pasta.app
```

History lives in `~/Library/Application Support/com.example.pasta/`
(`history.db` + `images/`, newest 500 clips).
