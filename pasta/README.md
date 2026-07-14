# Pasta 🍝

Clipboard history in the menu bar — plain JavaScript, zero dependencies.
Text, **images**, **copied files**, and **colors**, not just `pbpaste`.

Copy things all day; press **⌘⇧V** anywhere (or click the tray icon) and a
frameless translucent palette drops in: type to search, ↑↓ to pick, **⏎** to
put a clip back on the clipboard — *as whatever it was*: files paste back as
files, images as images, colors as colors, rich text keeps its formatting.
⏎ and esc also hand focus straight back to the app you were in (the palette
remembers who was frontmost when it opened and re-activates them), so
⌘⇧V → ⏎ → ⌘V is one uninterrupted motion.
Screenshots show a thumbnail, Finder copies show their filenames, colors show
a swatch, and every clip says which app it came from — for text copied in a
Chromium browser, also which *page* (**⌘O** reopens it).

More keys: **⌥⏎** copies *and pastes straight into the app you came from*
(grant Accessibility + Automation the first time it asks); **⇧⏎** copies as
plain text, rich flavour stripped; **⌘P** pins a clip — pinned clips sort
first and survive both pruning and Clear History; ⌘⌫ deletes; esc dismisses;
click-out hides it like a real menu.

One small app, six tinyjs techniques:

1. **The real clipboard via JXA** — `pbpaste` only speaks text. Pasta polls
   NSPasteboard through `osascript -l JavaScript` (one `tjs.spawn` a second):
   `changeCount` makes the idle poll a no-op, and on change one call
   classifies copied files → image → color → text, grabs the html flavour of
   rich text plus the `org.chromium.source-url` a browser copy carries, and
   notes the frontmost app for attribution. Clips marked
   `org.nspasteboard.ConcealedType` (password managers) are never recorded.
   Paste-direct is one more osascript (System Events types ⌘V after the
   palette hides); when the permission is missing it degrades to a
   notification pointing at System Settings instead of failing silently.
2. **SQLite history** — txiki's built-in `tjs:sqlite`: search, dedupe
   (`ON CONFLICT … DO UPDATE`), and pruning are one query each. Images dedupe
   by content hash; an old text-only `history.db` migrates in place with
   `ALTER TABLE` in a try/catch.
3. **Images on disk, thumbnails over the bridge** — a copied image lands in
   Application Support as png, `sips` makes the list thumbnail, and only the
   thumbnail crosses to the page as a `data:` URI. Full payloads never leave
   the backend until you copy them back.
4. **Global hotkey** — `app.hotkey.register('palette', 'cmd+shift+v')` +
   `onHotkey` summons the palette from any app.
5. **Frameless vibrancy palette** — `"chrome": { "frame": false, "vibrancy":
   "menu" }`, launched as a menu-bar agent (`"activation": "accessory"`),
   dismissed on focus loss.
6. **`tiny.store`** — the Pause Capturing flag survives relaunches.

The page only ever sees previews and builds all DOM with `textContent`
(clipboard content must never become markup — the page holds an RPC channel
with full system access).

> Two pasteboard gotchas preserved in `src/main.js`: payloads travel to the
> JXA scripts through scratch files, never stdin or argv (txiki 26.6.0's
> `WritableStream` promises for a spawned process's stdin never settle, and
> argv has hard size limits) — and copied files are written back as one
> `NSFilenamesPboardType` plist, because `writeObjects()` of several NSURLs
> from a short-lived process flushes per-item and can lose the tail
> (observed ~1-in-10).

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Pasta.app
```

History lives in `~/Library/Application Support/com.example.pasta/`
(`history.db` + `images/`, newest 500 clips).
