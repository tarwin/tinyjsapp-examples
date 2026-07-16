# Tiny Deck 🎛

The kitchen sink: one app that shows off the whole tinyjs API surface as a
deck of live demo cards.

<img src="../_images/kitchen-sink.webp" alt="Tiny Deck screenshot" width="640">

Thirteen tabs, each a themed batch of the API:

- **Overview / Files / Run / HTTP / Notes** — the txiki.js backend at work:
  live system readouts, a file browser with an editable text view and
  `tjs.watch` change feed, shell commands streamed to the page as they print,
  `fetch` from the backend, and notes persisted in the built-in SQLite
  (`tjs:sqlite`).
- **GPU / WASM** — the WebKit window is a real browser: WebGL2 + WebGPU
  shaders, and a hand-assembled WebAssembly module, all offline.
- **FFI (⌘8)** — `tjs:ffi` dlopens system dylibs and calls C directly:
  `sysctlbyname`, `getpid`, and a zlib compress/uncompress roundtrip with
  timings.
- **App (⌘9)** — window ops, native menus with live checkmarks, tray mode,
  notifications, file dialogs, frameless chrome, a second native window (the
  Inspector) sharing this backend, and update checks.
- **System (⌘0)** — `tiny.store`, global hotkeys, a custom right-click menu,
  native theme following, print.
- **Desktop (⌘D)** — `app.shell` open/reveal/trash + Quick Look on a demo
  file, the native **share sheet** anchored at the click, and `screens()` +
  `captureScreen` (with its permission-reject story).
- **Power (⌘E)** — Dock badge & bounce, `beep`/`playSound`, a live
  `idleTime` / `frontmostApp` readout, `power.preventSleep`, `launchAtLogin`,
  and the `app.paths` directory map.
- **Latest (⌘L)** — the 0.22 batch: live `battery()` / `wifi()` readouts,
  Force Touch `haptic` patterns (a slider that taps the trackpad at every
  detent), a canvas rendered straight onto the Dock tile with `app.dockIcon`,
  `app.spotlight` search with reveal-in-Finder, and the page itself printed
  to a vector PDF via `win.printToPDF`.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Tiny Deck.app
```

Or skip the toolchain: **[kitchen-sink-0.15.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/kitchen-sink-0.15.0.dmg)** (4.4 MB)
is a prebuilt, signed & notarized copy — open and drag to Applications.

It also registers a `tinydeck://` URL scheme and claims `.txt`/`.md`/`.log`
files, so `open -a "Tiny Deck" ~/Desktop/notes.txt` (or a Finder double-click)
lands in the Files tab.
