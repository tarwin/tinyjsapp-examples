# Pasta 🍝

<img src="icon.png" alt="pasta icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/pasta.webp" alt="pasta screenshot" width="640">

**⬇ Download:** [pasta-0.5.2.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/pasta-0.5.2.dmg) **(4.6 MB)** — prebuilt, signed & notarized; open and drag to Applications.

Clipboard history in the menu bar — plain JavaScript, zero dependencies.
Text, **images**, **copied files**, and **colors**, not just `pbpaste`.

Copy things all day; press **⌘⇧V** anywhere (or click the tray icon) and a
frameless translucent palette drops in: type to search, ↑↓ to pick, **⏎** to
put a clip back on the clipboard — *as whatever it was*: files paste back as
files, images as images, colors as colors, rich text keeps its formatting.
⏎ and esc hand focus straight back to the app you were in (tinyjs `hide()`
deactivates the app), so ⌘⇧V → ⏎ → ⌘V is one uninterrupted motion.
Screenshots show a thumbnail, colors show a swatch, and every clip says which
app it came from — for text copied in a Chromium browser, also which *page*
(**⌘O** reopens it). File clips get a real **Quick Look preview** of the first
file — PDF, video, PSD, whatever the OS can render, not just a folder glyph.
Image and file clips **drag out of the palette** — grab the thumbnail / the 🗂
and drop real files into Finder, Slack, anywhere. Click an image clip to
**preview it full-size**, with a **← Back** bar pinned on top (⏎ or Copy puts
it back on the clipboard; esc/Back returns to the list).

Three macOS touches from tinyjs 0.16: click the **🎨 eyedropper** (or the tray
menu) to pick any colour on screen straight into history and the clipboard;
hover a screenshot and hit **OCR** to lift its text out as a new text clip; and
those file previews above are Quick Look thumbnails.

More keys: **⌥⏎** copies *and pastes straight into the app you came from*
(one Accessibility grant, prompted on first use); **⇧⏎** copies as plain
text, rich flavour stripped; **⌘P** pins a clip — pinned clips sort first and
survive both pruning and Clear History; ⌘⌫ deletes; esc dismisses; click-out
hides it like a real menu.

The tray menu also has **Open at Login** (`app.launchAtLogin`). Its checkmark
reflects what macOS actually took, not a local flag — the status can come back
`requires-approval`, in which case a notification points at System Settings →
Login Items. In dev mode it reads `unsupported` (no bundle identity until
`tinyjs build`), so the item shows disabled there.

One small app, seven tinyjs techniques (a 0.12 core, plus three 0.16 macOS
extras — the app never shells out for the clipboard at all):

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
7. **0.16 macOS extras** — the system **eyedropper** is `app.pickColor()` (no
   screen-recording permission; the picked hex lands on the clipboard and in
   history); **OCR** is `app.ocr(png)`, on-device Vision that returns the text
   plus per-block boxes, so a screenshot of a paragraph becomes a text clip;
   and file rows preview with `app.thumbnail(path, size)` — a Quick Look
   render of *any* file type, cached per path, temp png read and deleted.

The page only ever sees previews and builds all DOM with `textContent`
(clipboard content must never become markup — the page holds an RPC channel
with full system access).

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Pasta.app
```

History lives in `~/Library/Application Support/art.tarwin.pasta/`
(`history.db` + `images/`, newest 500 clips).
