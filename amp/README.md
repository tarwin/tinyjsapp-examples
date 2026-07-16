# amp 🎵

<img src="icon.png" alt="amp icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/amp.webp" alt="amp screenshot" width="640">

**⬇ Download:** [amp-0.2.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/amp-0.2.0.dmg) **(4.5 MB)** — prebuilt, signed & notarized; open and drag to Applications.

A Winamp for the desktop — plain JavaScript, zero dependencies, and each pane
is a **real native window**.

The web [Webamp](https://webamp.org) recreates Winamp beautifully, but its
"separate windows" are draggable `<div>`s inside one browser page. tinyjs 0.20
added **multiple windows** — any html file in your frontend can be its own OS
window — so amp does the honest version: the **player**, **playlist**,
**equalizer**, and **visualizer** are four independent windows you drag
around, snap together, and (the visualizer) send fullscreen. And when four
windows is three too many: **BIG** (or **B**) swaps the whole thing for one
fullscreen 80s hi-fi stack — wood cheeks, VU needles, LED spectrum bridge,
rotary volume knob — floating over a full-bleed run of either visualizer. Or
neither: the ⇄ cycles to a third "engine", **speakers**, which centers the
stack between two giant floor speakers whose woofers, mids, and tweeters pump
along to the music (wildly out of proportion, as is right). And if your Mac is
in light mode, the whole rig is **brushed silver** — 1979's finest aluminum;
the displays stay dark, they're screens. **STANDBY** (or Esc) puts it back on
the desk.

The visualizer has **two real engines** you switch between with the ⇄ button
(choice persisted): **Milkdrop** via
[butterchurn](https://github.com/jberg/butterchurn) (WebGL), and **Geiss HDR**
— [Ryan Geiss's modern WebGPU rewrite](https://www.geisswerks.com/geiss_hdr/)
of the 1998 Geiss screensaver — vendored under Apache-2.0 with an
external-audio adapter (see [src/geiss-hdr/](src/geiss-hdr/README.md)).

Drop audio on any window (or hit **⏏ / + Add**), and press play. In the
playlist, **double-click plays a track now**; a **single click queues it to
play next** (a `»` marker — click again to unqueue); **drag a row to
reorder** (the playing track and the queued `»` follow their songs, not their
row numbers). Space and **⌘←/⌘→** are
play/pause and prev/next from *any* amp window. Windows drag
by their titlebars and **snap** magnetically to screen edges and to each other;
dock the satellites to the main window and they travel with it. **Double-click**
a titlebar to collapse it to a **windowshade** strip; **right-click** (or
**⌘A** in any window) for an Always-on-Top toggle; and a **menu-bar**
play/pause button is there by default. The
equalizer is a real 10-band filter bank with **AutoEq headphone correction**
(pick your headphones, they get neutralized), the media keys and Control Center
work, and the visualizer is the actual Milkdrop engine — or the actual Geiss
engine — running fullscreen.

The right-click menu also holds two app-wide preferences (both persisted):
**Theme** — follows the system appearance by default, with Light/Dark
overrides (the brushed-metal chassis swaps; the green phosphor LCDs stay dark,
they're *screens*) — and **Appear In** — Dock & menu bar (default), menu bar
only (the Dock icon drops away via a live activation-policy flip), or Dock
only (the tray item is removed; it's in the tray's menu too).

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/amp.app
```

## Four windows, one backend

Windows each run the full `tiny.*` bridge but **can't talk to each other**, so
`src/main.js` is the hub:

- the **player** (`index.html`) is the audio host and brain; when its state
  changes it calls `api publish(state)`, which the backend broadcasts as a
  `state` event to everyone else;
- the **playlist / eq / viz / rack** send user intent as `api action(a)`,
  which the backend pushes to the player as an `action` event;
- a freshly opened window asks `api hello()` for the current state.

The player's **EQ / PL / VIZ / BIG** buttons call `toggleWindow`, which
`app.openWindow`s a satellite the first time and hides/shows it after (so its
position survives) — `app.window(id).hide()/show({ activate: false })`.

## The techniques

1. **Multiple windows (0.20)** — `app.openWindow(id, { page, size })` and
   `tiny.win.open`; `app.window(id)` drives each one (`setPosition`,
   `getState`, `push`, `hide`, `fullscreen`), and `app.push` broadcasts to all.
   `meta.window` on an api handler says who called.
2. **One-click across windows** — every window sets `chrome:
   { acceptsFirstMouse: true }` (0.22.5), so the click that *focuses* a window
   also lands on whatever it hit. Without it, WKWebView eats the activating
   click and every cross-window action costs two clicks (click a playlist row,
   then click ▶ in the player — nothing happens until you click again).
   Winamp-style control panels are exactly what macOS click-through is for.
3. **Magnetic dragging** (`drag.js`, shared by every window) — frameless
   windows have no titlebar, so we drag them from a pointer's **global**
   `screenX/screenY` (true displacement even as the window moves under the
   cursor) and snap the result to screen edges and sibling rects (which only
   the backend can see — `api rects`). Dragging the **main** window carries its
   whole docked cluster in one batched `moveGroup` call so they travel in
   lockstep, and a docked edge lights up so you can see what's attached.
4. **Web Audio in the page** — the player builds
   `MediaElementSource → preamp → 10× BiquadFilter (peaking) → headphone
   correction (own preamp + 10× parametric BiquadFilter) → StereoPanner →
   AnalyserNode → destination`. The equalizer window's sliders set the graphic
   filter gains; the analyser drives the little canvas spectrum. The 🎧 menu
   below the sliders loads an **[AutoEq](https://github.com/jaakkopasanen/AutoEq)
   correction profile** for your actual headphones — 59 popular models baked
   into [autoeq.js](src/frontend/autoeq.js) — retuning the second chain's
   filters (`LSC`/`PK`/`HSC` → lowshelf/peaking/highshelf) and preamp.
   Correction is deliberately independent of the **ON** switch: ON gates the
   tone curve you drew by hand; the profile neutralizes the headphone
   underneath it, and the two stack. (One knowing simplification: WebAudio
   shelf filters have a fixed slope and ignore Q — AutoEq's shelves are Q 0.7,
   close enough to WebKit's default that the difference is inaudible.)
5. **Now Playing + media keys** — `tiny.app.nowPlaying.set({ title, artist,
   duration, elapsed, playing })` puts amp in Control Center and the lock
   screen, and `tiny.app.onMediaKey` routes the F7/F8/F9 keys (and AirPods) to
   play / pause / next / previous / seek.
6. **Milkdrop and Geiss, for real** — the visualizer window embeds
   [butterchurn](https://github.com/jberg/butterchurn) (the Milkdrop engine the
   Webamp family uses, MIT) on a WebGL canvas, **and**
   [Geiss HDR](https://www.geisswerks.com/geiss_hdr/) (© Ryan Geiss,
   Apache-2.0) on a **WebGPU** canvas — yes, WebGPU works in a tinyjs
   WKWebView, **HDR included**: before starting Geiss, viz.js probes the real
   failure mode (older WebKit *accepted* an `rgba16float` canvas but presented
   black — configure, render a clear, read pixels back), and on an HDR display
   with a passing probe Geiss runs its full HDR path with extended tone
   mapping (Ctrl+H toggles HDR/SDR to compare); anything less falls back to
   SDR. The ⇄ button swaps
   engines; the parked one keeps its rAF loop alive but does zero work. A
   covering window throttles the player's timers, so the visualizer runs its
   **own silent twin** of the track — a second `<audio>` whose
   `MediaElementSource` fans out to both engines' analysers, never the
   speakers — kept in step with the broadcast `state`. While Geiss is up,
   press **H** for its whole keyboard (randomize, locks, brightness, motion
   speed…); ←/→/🎲 randomize the visuals. On a track change each engine shows
   the title its own way — Milkdrop swirls it through the preset
   (`launchSongTitleAnim`), Geiss paints it into the image (its embed-title
   path; its T key repaints on demand) — and the bar's **T** toggle turns
   titles off entirely (persisted). The ☺ button credits both projects
   with links (opened in your browser, not the app).
7. **Reading audio off disk** — a WebKit page can't load `file://` media
   outside its own directory by default, so `tinyjs.json` sets
   **`"readAccess": true`** (widen the read root to the home dir) and each
   `<audio>` loads the track straight off disk — no bytes ever cross the bridge.
   The backend only stats the file for the bitrate readout.
8. **Session persistence** — `tiny.store` remembers the whole layout: playlist,
   volume/balance, EQ curve, which panels are open, every window's position,
   each window's shade state, the always-on-top flag, the theme override, the
   Dock/menu-bar choice, and which visualizer engine you left up — so
   relaunching puts it all back exactly where you left it.
9. **Menu bar, windowshade, docking, always-on-top** — the menu-bar item is a
   **split pill**, Harvest-style ([till](../till/README.md)'s recipe): the
   tray is one NSStatusItem, so the widget — a ▶/⏸ chip (amber while
   playing) plus a dark chip showing the elapsed time, or the **AMP**
   wordmark when idle — is rasterized to a fixed-width PNG by the backend
   itself (RGBA buffer, 3×5 bitmap font, hand-encoded PNG @2x with a 144 dpi
   `pHYs`), and the two click zones are resolved by geometry: on left-click,
   compare `app.mousePosition()` against `app.tray.position()` — glyph side
   toggles playback, time side opens the player. Right-click keeps the
   transport menu (`onTray`). And while music plays the **Dock icon dances**:
   the player page draws 6 frames of the icon (chassis + green LCD + phase-
   shifted spectrum bars) on a canvas, ships them to the backend once as
   base64 PNGs, and `app.dockIcon()` flips through them every 320 ms —
   `''` restores the bundle icon on pause (toggleable: "Animated Dock Icon"
   in the tray and right-click menus, persisted). Double-click a titlebar to collapse it
   to a **shade** strip that still works: the main bar keeps transport + time,
   the playlist shows the current track, the equalizer shows draggable
   volume/balance (it keeps its top-left corner on collapse). Right-click is a
   single **Always on Top** toggle (`tiny.menu.setContext`, which also replaces
   WebKit's default menu → no *Inspect Element*) that the backend applies to
   **every** window at once — global, not per-window. **⌘A** in any window is
   the same toggle (drag.js rides along in all four, so the shortcut does too).

10. **BIG SCREEN — the rack** (`rack.html` / `rack.js` / `rack.css`) — the
    whole hi-fi as one more satellite window that fullscreens itself on open
    (viz-style chrome; a `squareCorners` window can't enter native
    fullscreen). It's a floor-standing stack drawn in CSS — wood cheeks, rack
    screws, a receiver with cream-dial **VU meters** (needle ballistics:
    fast attack, lazy decay, latching peak LED), drag-to-turn rotary
    **volume/balance knobs**, an EQ unit with a 10-column **LED spectrum
    bridge** over long-throw faders (plus the same AutoEq 🎧 menu), and a
    green-LCD **program deck**, plus a little clock in the bottom strip (on
    the rack, not floating — everything's diegetic) — all over a full-bleed
    run of either viz engine. A third "engine" on the ⇄, **speakers**, drops
    the shaders entirely: the stack centers and two giant CSS speaker
    cabinets flank it — wired to the rack with drooping red/black SVG pairs
    laid from the live element rects — their cones scaled per-frame from
    three spectrum bands via CSS custom properties (woofer ↤ bass, mid,
    tweeter ↤ treble — deliberately over-responding, though the cabinets
    themselves hold still). The rack is also the one window with its own
    **light mode**: brushed-silver faceplates, knobs, and cabinets via a
    `data-theme` palette swap (it mirrors drag.js's system-theme logic since
    it doesn't load drag.js) — every display stays dark either way. Same
    satellite contract as every panel (broadcast `state` in, `action`s out),
    and the visualizer's **silent-twin audio** trick powers everything that
    must stay smooth — both engines, the needles, the LEDs, the time/seek
    readouts — because a covered main window's timers throttle to a crawl.
    The backend keeps the rack out of every snapping / raise / reflow loop:
    `show()` on a window living in its own fullscreen Space would yank the
    user out of whatever Space they're in. It's also exempt from
    **Always-on-Top** — a floating-level window can't enter native fullscreen
    at all (it silently stays windowed) — and while the rack is up the OTHER
    windows' floating is suspended too, since floating windows hover over
    fullscreen Spaces and an on-top playlist would photobomb the big screen
    (the preference itself is untouched; levels come back on exit).
    **STANDBY** (or Esc) un-fullscreens,
    waits out the animation, then hides it.

The classic look is **CSS, not ripped skin bitmaps** — a homage, so there's no
trademark or copyright baggage — and every track name reaches the DOM through
`textContent` (the page holds an RPC channel with full system access, so a
filename must never become markup).

## Credits & licenses

amp's visualizers are real third-party engines, gratefully vendored, and the
equalizer's headphone profiles come from a real measurement project:

- **[AutoEq](https://github.com/jaakkopasanen/AutoEq)** by Jaakko Pasanen
  (MIT) — frequency-response corrections that EQ headphones toward the Harman
  target. amp bakes 59 popular models' parametric results into
  [autoeq.js](src/frontend/autoeq.js), converted verbatim from the repo's
  `ParametricEQ.txt` files (fetched 2026-07-16). All 59 come from a single
  measurement source — **[oratory1990](https://www.reddit.com/r/oratory1990/)**'s
  GRAS rig measurements, whose data remains the property of its author — so
  profiles are mutually comparable. The full database (thousands of models,
  more sources) lives at [autoeq.app](https://autoeq.app); results there are
  usable in amp's terms too, they just aren't bundled. Not affiliated with or
  endorsed by AutoEq, oratory1990, or any headphone manufacturer — model names
  identify which headphone a profile corrects, nothing more.

- **[butterchurn](https://github.com/jberg/butterchurn)** +
  [butterchurn-presets](https://github.com/jberg/butterchurn-presets) (MIT) —
  jberg's WebGL port of MilkDrop 2. Bundled as `butterchurn.min.js` + a
  curated `presets.min.js`, inlined into the visualizer window at build time.
- **[Geiss HDR](https://www.geisswerks.com/geiss_hdr/)** © 2026 Ryan Geiss
  (Apache-2.0) — the modern rewrite of the 1998
  [Geiss screensaver & Winamp plug-in](https://www.geisswerks.com/geiss/).
  Vendored in [src/geiss-hdr/](src/geiss-hdr/README.md) with its LICENSE,
  NOTICE, and OUTPUTS files and every amp modification marked; rebuilt into
  `geiss-hdr.bundle.js` by `src/geiss-hdr/build.sh`. Not affiliated with or
  endorsed by the original project — "Geiss HDR" names its origin only.

Settings live in `~/Library/Application Support/com.example.amp/`.
