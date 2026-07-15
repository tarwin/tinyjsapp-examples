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

One small app, six tinyjs techniques (0.11.0):

1. **Native clipboard** — `app.clipboard.read()/write()/changeCount()`:
   NSPasteboard lives in the launcher process, so there's no `pbpaste`, no
   polling spawns, no scratch files, and multi-file writes never lose the
   tail. One capture call classifies files → image → color → text with the
   html flavour of rich text. The idle poll is a `changeCount()` query —
   in-process, effectively free.
2. **One JXA probe for what core doesn't expose (yet)** — per clipboard
   *change*, a single `osascript -l JavaScript` fetches the three things
   `read()` omits: the `org.nspasteboard.ConcealedType` flag (password
   managers — those clips are never recorded), the frontmost app for
   attribution, and the `org.chromium.source-url` a browser copy carries.
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

> 0.11.0 note: exporting `onClipboardChange` is supposed to push changes to
> the backend, but the generated entry doesn't forward it yet — so Pasta
> polls `changeCount()` once a second instead. Same behaviour, still zero
> spawns; switch to the event when the wiring lands.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Pasta.app
```

History lives in `~/Library/Application Support/com.example.pasta/`
(`history.db` + `images/`, newest 500 clips).
