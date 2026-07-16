# amp 🎵

A Winamp for the desktop — plain JavaScript, zero dependencies, and each pane
is a **real native window**.

The web [Webamp](https://webamp.org) recreates Winamp beautifully, but its
"separate windows" are draggable `<div>`s inside one browser page. tinyjs 0.20
added **multiple windows** — any html file in your frontend can be its own OS
window — so amp does the honest version: the **player**, **playlist**,
**equalizer**, and **Milkdrop visualizer** are four independent windows you
drag around, snap together, and (the visualizer) send fullscreen.

Drop audio on any window (or hit **⏏ / + Add**), and press play. In the
playlist, **double-click plays a track now**; a **single click queues it to
play next** (a `»` marker — click again to unqueue). Space and **⌘←/⌘→** are
play/pause and prev/next from *any* amp window. Windows drag
by their titlebars and **snap** magnetically to screen edges and to each other;
dock the satellites to the main window and they travel with it. **Double-click**
a titlebar to collapse it to a **windowshade** strip; **right-click** (or
**⌘A** in any window) for an Always-on-Top toggle; and a **menu-bar**
play/pause button is always there. The
equalizer is a real 10-band filter bank, the media keys and Control Center
work, and the visualizer is the actual Milkdrop engine running fullscreen.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/amp.app
```

Or skip the toolchain: **[amp-0.1.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/amp-0.1.0.dmg)** (4.2 MB) is a
prebuilt, signed & notarized copy — open and drag to Applications.

## Four windows, one backend

Windows each run the full `tiny.*` bridge but **can't talk to each other**, so
`src/main.js` is the hub:

- the **player** (`index.html`) is the audio host and brain; when its state
  changes it calls `api publish(state)`, which the backend broadcasts as a
  `state` event to everyone else;
- the **playlist / eq / viz** send user intent as `api action(a)`, which the
  backend pushes to the player as an `action` event;
- a freshly opened window asks `api hello()` for the current state.

The player's **EQ / PL / VIZ** buttons call `toggleWindow`, which
`app.openWindow`s a satellite the first time and hides/shows it after (so its
position survives) — `app.window(id).hide()/show({ activate: false })`.

## The techniques

1. **Multiple windows (0.20)** — `app.openWindow(id, { page, size })` and
   `tiny.win.open`; `app.window(id)` drives each one (`setPosition`,
   `getState`, `push`, `hide`, `fullscreen`), and `app.push` broadcasts to all.
   `meta.window` on an api handler says who called.
2. **Magnetic dragging** (`drag.js`, shared by every window) — frameless
   windows have no titlebar, so we drag them from a pointer's **global**
   `screenX/screenY` (true displacement even as the window moves under the
   cursor) and snap the result to screen edges and sibling rects (which only
   the backend can see — `api rects`). Dragging the **main** window carries its
   whole docked cluster in one batched `moveGroup` call so they travel in
   lockstep, and a docked edge lights up so you can see what's attached.
3. **Web Audio in the page** — the player builds
   `MediaElementSource → preamp → 10× BiquadFilter (peaking) → StereoPanner →
   AnalyserNode → destination`. The equalizer window's sliders set the filter
   gains; the analyser drives the little canvas spectrum.
4. **Now Playing + media keys** — `tiny.app.nowPlaying.set({ title, artist,
   duration, elapsed, playing })` puts amp in Control Center and the lock
   screen, and `tiny.app.onMediaKey` routes the F7/F8/F9 keys (and AirPods) to
   play / pause / next / previous / seek.
5. **Milkdrop, for real** — the visualizer window embeds
   [butterchurn](https://github.com/jberg/butterchurn) (the Milkdrop engine the
   Webamp family uses, MIT) on a WebGL canvas, with true `tiny.win.fullscreen`.
   A covering window throttles the player's timers, so the visualizer runs its
   **own silent twin** of the track — a second `<audio>` whose
   `MediaElementSource` feeds only butterchurn, never the speakers — kept in
   step with the broadcast `state`. Its render loop is this window's own rAF,
   so it stays smooth even full-screen.
6. **Reading audio off disk** — a WebKit page can't load `file://` media
   outside its own directory by default, so `tinyjs.json` sets
   **`"readAccess": true`** (widen the read root to the home dir) and each
   `<audio>` loads the track straight off disk — no bytes ever cross the bridge.
   The backend only stats the file for the bitrate readout.
7. **Session persistence** — `tiny.store` remembers the whole layout: playlist,
   volume/balance, EQ curve, which panels are open, every window's position,
   each window's shade state, and the always-on-top flag — so relaunching puts
   it all back exactly where you left it.
8. **Menu bar, windowshade, docking, always-on-top** — a tray item
   (`app.tray.set`, an SF Symbol flipping play/pause) toggles playback and
   carries a transport menu (`onTray`). Double-click a titlebar to collapse it
   to a **shade** strip that still works: the main bar keeps transport + time,
   the playlist shows the current track, the equalizer shows draggable
   volume/balance (it keeps its top-left corner on collapse). Right-click is a
   single **Always on Top** toggle (`tiny.menu.setContext`, which also replaces
   WebKit's default menu → no *Inspect Element*) that the backend applies to
   **every** window at once — global, not per-window. **⌘A** in any window is
   the same toggle (drag.js rides along in all four, so the shortcut does too).

The classic look is **CSS, not ripped skin bitmaps** — a homage, so there's no
trademark or copyright baggage — and every track name reaches the DOM through
`textContent` (the page holds an RPC channel with full system access, so a
filename must never become markup).

Bundled: `butterchurn.min.js` + a curated `presets.min.js`
([butterchurn-presets](https://github.com/jberg/butterchurn-presets), MIT),
inlined into the visualizer window at build time.

Settings live in `~/Library/Application Support/com.example.amp/`.
