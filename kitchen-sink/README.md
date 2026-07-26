# Tiny Deck 🎛

<img src="icon.png" alt="kitchen-sink icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/kitchen-sink.webp" alt="kitchen-sink screenshot" width="640">

**⬇ Download:** [kitchen-sink-0.15.2.dmg](https://github.com/tarwin/tinyjsapp-examples/releases/download/kitchen-sink-v0.15.4/kitchen-sink-0.15.2.dmg) **(4.5 MB)** — prebuilt, signed & notarized; open and drag to Applications.

The kitchen sink: one app that shows off the whole tinyjs API surface as a
deck of live demo cards.

Ten tabs, ordered the way you reach for them while building an app:

- **Overview (⌘1)** — live system readouts pushed from the backend, plus the
  native dialogs answered by the launcher.
- **App (⌘2)** — what the app *is*: window ops and `getState`, frameless
  chrome and window controls, a second native window sharing this backend,
  the tray, the app icon (badge / progress / attention), notifications with
  action buttons, and update checks.
- **Storage (⌘3)** — where the data goes. A file browser with an editable
  text view and a `tjs.watch` change feed; notes in the built-in **SQLite**
  (`tjs:sqlite`, no native module to build); and `tiny.store` — with a card
  on which of the two to reach for, since picking wrong is something you
  only notice later.
- **Desktop (⌘4)** — `app.shell` open/reveal/trash + Quick Look, Spotlight
  search, the native **share sheet** anchored at the click, `win.printToPDF`,
  the system eyedropper, and `screens()` + `captureScreen` (with its
  permission-reject story).
- **System (⌘5)** — `tiny.system` os/arch/capabilities/requirements, live
  `battery()` / `wifi()`, global hotkeys, a custom right-click menu, native
  theme following, print.
- **Media (⌘6)** — `beep` / `playSound` (four portable names vs this
  platform's own), Force Touch `haptic` patterns, and **native audio
  filters**: a real EQ applied below the browser, with an honest read-out of
  whether the chain is actually engaged.
- **Power (⌘7)** — `power.preventSleep`, a live `idleTime` / `frontmostApp`
  readout, `launchAtLogin`, and the `app.paths` directory map.
- **GPU (⌘8)** — the WebKit window is a real browser: WebGL2 and WebGPU
  shaders side by side, including a compute demo that finds how many
  particles it can hold at 60 fps.
- **WASM (⌘9)** — a hand-assembled module with no toolchain, a JS-vs-WASM
  benchmark that runs on either side of the bridge, and animated fractal
  noise you can switch between implementations live.
- **Misc (⌘0)** — the escape hatches: shell commands streamed to the page as
  they print, `fetch` from the backend, and `tjs:ffi` dlopening system
  libraries to call C directly (`sysctlbyname`, a zlib roundtrip with
  timings).

Every panel is searchable (**⌘F**), and the **call log** in the header records
every `tiny.*` call the deck makes as you click — so the deck doubles as its
own reference: play with a control, read the call you'd have to write.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Tiny Deck.app
```

It also registers a `tinydeck://` URL scheme and claims `.txt`/`.md`/`.log`
files, so `open -a "Tiny Deck" ~/Desktop/notes.txt` (or a Finder double-click)
lands in the Files tab.
