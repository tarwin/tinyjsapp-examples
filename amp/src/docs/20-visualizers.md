# Writing a visualizer for amp

A visualizer plugin is a folder with two files, `viz.json` and `index.js`. It
turns up in the viz window's ☰ picker beside Milkdrop and the rest, with the
same ⇄ ‹ 🎲 › controls.

## Three ways to add one

**From a URL.** ☰ → Add from URL…, then paste a link to a plugin's `viz.json`.
amp fetches that file and the entry file beside it, installs both, and switches
to it. Nothing you download runs during the install. It lands on disk and only
runs later, inside the sandbox, like every other plugin. amp remembers the URL
so it can re-fetch to update.

**By hand.** ☰ → Add a visualizer…, which opens the folder amp loads from.

```
~/Library/Application Support/art.tarwin.amp/viz/     macOS
$XDG_DATA_HOME/art.tarwin.amp/viz/                    Linux
%APPDATA%/art.tarwin.amp/viz/                         Windows
```

Drop a folder in and it shows up. No restart.

**Write one.** Start from a template in the viz lab below, or copy one of the
five that ship with amp. `src/viz/pulse` is Canvas 2D and the one to copy first.
`src/viz/lattice` runs WebGPU and WebGL2 off one shared sim. `src/viz/ballroom`
is the three.js one — the worked example of `// amp:uses`, of getting a
photographic look out of an environment map, and of SSGI. It declares
`"backends": ["webgpu"]` alone, because its post chain does not survive three's
WebGL2 fallback: better to be absent from the picker on a machine that cannot
run it than to paint a quietly wrong picture.
`src/viz/ribbon` is a game, and the example for `input()` and `amp.save()`.
`src/viz/signal` draws every input you get, labelled, and is worth keeping open
in a second window while you write your own.

## Reloading while you work

amp watches the folder. Save `index.js` and amp tears the running plugin down
and rebuilds it from the new source, in place. No restart, no re-picking it from
the menu. Editing `viz.json` re-reads the manifest too, so a renamed plugin
renames itself in the picker.

That is the whole edit loop. Your editor on one side, amp's viz window on the
other.

## The viz lab

amp has a window for writing these. Open it from the viz picker, ☰ → Viz Lab…,
or right-click the deck and pick Viz Lab.

A canvas on the left, your source on the right, and a log pane that catches the
errors that would otherwise leave you staring at a black rectangle. It runs
amp's real sandbox, the same `vizhost.js` the viz window uses and the same
runtime the backend hands out, so what you see in the lab is what amp will show.

- Audio… picks any track on disk to react to, and the lab plays it out loud.
- Follow amp reacts to whatever the deck is playing right now. The lab keeps a
  silent copy of the same file and mirrors the deck's position, so amp makes the
  sound and the lab does the listening. This is the same trick amp's viz window
  uses, since a page cannot reach another window's audio graph.
- Templates gives you two starters written against the bare canvas, one Canvas
  2D and one WebGPU with a WebGL2 fallback; then one each for p5 and q5 (see
  Sketch libraries below); then the two visualizers amp ships. There is no
  three.js starter on purpose — see "Writing one in a project" below. Those last two load from disk, so what you get
  is the real Pulse and the real Lattice rather than a copy that drifts. Save
  stays off for them until you Install… the result somewhere of your own, since
  writing over a shipped visualizer helps nobody.
- Open… loads a plugin's `index.js`, Save writes it back, ⌘S works. A dot beside
  the filename means unsaved changes, and anything about to replace the editor
  asks first.
- Watch re-runs the plugin every time the file changes on disk, so you can edit
  in your own editor and leave the lab open beside it.
- Install… copies what is in the editor into amp's visualizer folder with a
  `viz.json` beside it, which turns it into a real plugin in the picker.
- Run, or ⌘↵. The title bar shows the backend you got and a live fps counter.

Dropping a `.js` file or an audio file onto the window does the obvious thing
with it. The editor colours JavaScript as you type, and the two gutters, one
between the canvas and the code and one above the log, drag to whatever split
suits what you are doing. amp remembers where you left them.

---

## Where a plugin runs

Three windows, one sandbox. The visualizer window, the **big screen** (BIG), and
the viz lab all load the same `vizhost.js` and the same shared glue, so a plugin
appears in the ⇄ cycle and the ☰ picker of all three and behaves identically in
each.

Two differences worth knowing. The big screen is full-bleed, so `resize()` will
hand you a much larger canvas there than in a pane — size off what you are
given rather than assuming. And when the big screen is up and covering the
visualizer window, that window stands its plugin down: one worker rather than
two holding a GPU device each. On a second monitor, where the small window is
still visible, it keeps running.

---

## What a plugin can and cannot do

Your code runs in a worker, not in amp's page. It gets an `OffscreenCanvas` and
a stream of audio, and that is all it gets. Measured, in amp, on WKWebView under
macOS 26.5:

| | |
|---|---|
| `tiny`, `window`, `document`, `parent`, `webkit` | `undefined` |
| `localStorage` | `undefined` |
| `eval`, `new Function` | `EvalError`, since the sandbox CSP has no `unsafe-eval` |
| `fetch`, `XMLHttpRequest`, loopback fetch | blocked |
| `WebSocket` | `SecurityError` |
| `importScripts` of a remote URL | `NetworkError` |
| `navigator.sendBeacon` | throws, and nothing reaches a listening socket |
| WebGPU, WebGL2, Canvas 2D, WebAssembly | **available** |
| frame rate | **60 fps**, same as amp's built-in engines |

So a visualizer cannot read your files, call amp's backend, phone home, or
record you. amp does the listening and hands over numbers. Installing one is a
question of taste rather than trust.

It also runs on its own thread. A plugin stuck in an infinite loop cannot freeze
amp. It stops acking frames, and after four seconds amp terminates it and falls
back to Milkdrop. That thread is the reason the sandbox is a worker instead of
an iframe. See "Why a worker" at the bottom.

The cost of that isolation is the DOM. No HTML, no CSS, no SVG, no `<img>`, no
web fonts, no `document.createElement`. Canvas 2D text works through
`ctx.fillText`, and system fonts are available to it. But if your idea is
fundamentally a styled DOM tree, it cannot be a plugin today.

(One exception, below: a plugin that asks for p5 or q5 gets a small fake
`document` alongside it, because those two libraries will not start without one.
It is four stubs, not a DOM — nothing renders through it.)

---

## Sketch libraries

Three libraries ship inside amp, and a plugin can ask for one with a comment:

```js
// amp:uses three
```

That line has to be the first thing you write, and it has to be a comment. amp
reads it before your worker exists — the library must already be in the blob by
the time any of your code runs, which is too early for `amp.register()` to have
said anything.

| | | |
|---|---|---|
| `three` | `THREE` | three.js — the **webgpu** build, so `WebGPURenderer` plus node materials and `THREE.TSL` |
| `p5` | `p5` | p5 2.x, without its page-facing modules |
| `q5` | `Q5`, `q5` | q5.js, a smaller and quicker p5-compatible sketch library |

The lab has a starter for each — Templates ▾, second group — and loading one
tells you the exact version this build of amp carries.

The three.js starter is deliberately the *small* end of three: one file, one
lit shape, about as much as fits comfortably in a textarea. It runs as it
stands. When you want your own modules, npm packages, or an editor that knows
what a `Matrix4` is, that is the point to stop typing in the lab and take
**Templates ▾ → Start a plugin project…** instead — see "Writing one in a
project" below. p5 and q5 have no such ceiling; a sketch is a sketch.

**Node materials.** If you want to write TSL — your own `colorNode`,
`emissiveNode`, a distance field, a procedural surface — you need
`MeshPhysicalNodeMaterial`, not `MeshPhysicalMaterial`. They are separate
classes and the classic one simply has no node slots: assigning to
`material.colorNode` on it is silent and does nothing. The node version carries
every physical property the classic one does, so it is a drop-in.
`src/viz/ballroom` uses it for all fourteen of its styles.

**three.js runs on both.** amp ships `three/webgpu`, not the classic build, so
there is one renderer rather than two: `WebGPURenderer` uses WebGPU where the
machine has it (macOS, Windows) and falls back to WebGL2 where it does not
(Linux/WebKitGTK). Declare `"backends": ["webgpu", "webgl2"]`, pass the
`backend` amp hands `create()` through as `forceWebGL: backend !== 'webgpu'`,
and the same code covers both. Note there is **no `WebGLRenderer`** in this
build — that is the trade for the fallback being automatic.

**What actually happens.** amp pastes its own copy of the library in front of
your source and mints the worker from the result. Nothing is downloaded, at
install time or ever; the sandbox is exactly the sandbox described above, with
the same CSP and the same lack of network. Your file stays your file — the
library is not in it, so a plugin that uses three.js is still the few kilobytes
you wrote, still readable, still one file somebody can audit before installing.

A plugin that asks for nothing gets nothing. This costs the other visualizers
not one byte and not one millisecond.

**What it costs the one that asks.** The library is compiled when the worker is
minted, which is when you pick the visualizer. Measured on WKWebView, macOS
26.5, from a cold mint to a first frame: about 10 ms with no library, ~190 ms
with three.js, ~90 ms with p5 or q5. You see that once, when you switch to it,
not per frame — every one of them then runs at amp's usual 60.

**Versions.** A plugin cannot pin one. `// amp:uses three` means "whatever three
amp ships", so the version is amp's to choose and amp's to keep stable. The
current set is in the lab's log and in `src/vizlib/index.json`. amp will bump
these on non-breaking releases only; a major bump silently rewrites what
existing plugins mean, so it is a release-note change, not a routine one.

**p5, and why it is the awkward one.** p5's whole design assumes a page — the
1.x build cannot run in the cage at all: it blocks the worker thread and never
reaches your `setup()`. What ships here is p5 **2.x**, whose modular build lets
amp leave out `dom`, `io`, `events` and `accessibility`, plus a fake `document`
installed *after* the library loads (give p5 one before it loads and it wedges
on the way up). So there is no `createButton`, no `loadJSON`, no `mousePressed`,
no `loadImage` from a URL — amp gives you `input()` and the audio instead.
Drawing, colour, maths, images, text and `WEBGL` mode are all there.

If you only want to draw, prefer **q5**: same API, a third of the size, starts
quicker, and it needs far less pretending to be a browser. Reach for p5 when you
want something q5 has not got.

Two things to know about both:

- **Let amp drive the frames.** Call `noLoop()` in `setup()` and draw from
  `frame()`. p5 and q5 both want to run their own loop off
  `requestAnimationFrame`, which the worker does not really have, and two loops
  over one canvas stutters. The starters show the shape.
- **They draw on their own canvas.** Blit it onto amp's in `frame()` with
  `ctx.drawImage(s.canvas, 0, 0)`. One copy per frame, and it does not show up
  in a profile.

three.js needs none of that: hand `WebGLRenderer` the canvas amp gave you and it
behaves exactly as it does in a page, minus the loaders that read from one.

**Rebuilding them.** `node tools/build-vizlibs.mjs` pulls the pinned versions
from npm, bundles them, and rewrites `src/vizlib/`. The pins live at the top of
that file.

---

## Writing one in a project

Everything above assumes you are typing into the viz lab, which is the right
way to start and the right way to work on anything you can hold in one file.
p5 and q5 suit that: you hammer at a sketch and watch it move.

three.js outgrows it. There is a single-file three starter in the lab and it is
a real visualizer, but a three sketch of any size wants modules, npm and an
editor that knows what a `Matrix4` is, and none of that fits in a textarea. So
amp hands you a project as well.

**☰ → Start a plugin project…** writes one out and opens it:

```
viz-project/
  package.json  build.mjs  jsconfig.json
  types/amp-viz.d.ts        the whole plugin API, typed
  src/spectrum2d/           Canvas 2D, no library      → 3.5 KB built
  src/spheres3d/            three.js                   → 7.6 KB built
```

Then `npm install`, `npm run build`, and in the lab Open… the built
`dist/<name>/index.js` and press Watch. `npm run watch` in one window and the
lab in the other is the edit loop.

It never overwrites: run it twice and you get `viz-project 2`. The same files
live in the repo at `src/examples/viz-build/` if you would rather start there.

The packaging rule does not change — a plugin still arrives as one classic
script, because the worker is minted from a blob and there is no module loader
at the far end. A bundler is simply how you get there from a project. Two
details `examples/viz-build/build.mjs` handles that a default esbuild config
would not: `format: 'iife'` rather than `esm`, and re-emitting the
`// amp:uses` line as a **banner**, since amp reads it off the built file and a
minifier would otherwise drop the comment.

**Types.** `types/amp-viz.d.ts` declares `amp`, the audio snapshot and
everything `create()` may return, plus:

```ts
declare const THREE: typeof import('three/webgpu') & { TSL: typeof import('three/tsl') };
```

So you get full completion on a library you never import — three is a
devDependency of your project, present for `@types/three`, absent from your
output. Point a `jsconfig.json` at the file, or drop a
`/// <reference path="…/amp-viz.d.ts" />` at the top of your entry.

**The edit loop stays the lab.** `npm run watch` in one window, and in the lab
Open… the built `dist/<name>/index.js` and press Watch. The lab re-runs it on
every rebuild, with real audio, in the real sandbox.

---

## `viz.json`

```json
{
  "id": "starfield",
  "name": "Starfield",
  "author": "you",
  "version": "1.0.0",
  "description": "One line, shown in the picker and the credits.",
  "license": "MIT",
  "url": "https://your-site.example",
  "backends": ["webgpu", "webgl2"],
  "hdr": "optional",
  "presets": ["night", "dawn"],
  "libs": ["three"],
  "entry": "index.js"
}
```

- `backends` is required. `"webgpu"`, `"webgl2"`, `"2d"`, best first. amp picks
  the first one this machine has and tells `create()` which it chose. A plugin
  listing only `"webgpu"` stays hidden on machines without it rather than
  painting a black rectangle, and today that means every WebKitGTK build on
  Linux. List a fallback if you want Linux users.
- `hdr` is `true`, `"optional"`, or absent. See HDR below.
- `presets` is a list of names. A non-empty list makes amp show ‹ › and route
  them to your `preset()`. Omit it and only 🎲 appears.
- `libs` is a note for the picker, not the switch. What amp actually injects is
  read from the `// amp:uses` line in your source, so an unsaved buffer in the
  lab behaves the same as an installed folder. Install… writes this field for
  you from that line.
- `entry` defaults to `index.js`. One file, no imports — a library comes from
  amp, never from a second file of yours.
- `name`, `author`, `description` and `url` appear in the viz window's credits
  (the ☺ button), under amp's own engines, with the author linked to the url.
  The url must be https; anything else is dropped. All of it renders as plain
  text, so there is no point putting markup in a manifest.

A malformed manifest means amp skips that folder rather than breaking the
picker.

---

## `index.js`

One file. The sandbox has no module loader, so `import` and `require` do not
work. Bundle to a single file if you need dependencies. Talk to amp through the
`amp` global.

```js
amp.register({
  name: 'Starfield',
  backends: ['2d'],
  presets: ['night', 'dawn'],

  // Called once. Return an object with at least frame().
  // May be async. amp waits.
  create({ canvas, backend, hdr, width, height, dpr, state }) {
    const ctx = canvas.getContext('2d');
    return {
      frame({ audio, t, dt, width, height }) { /* draw one frame */ },
      resize(w, h) {},               // canvas is already resized
      randomize() { return 'dawn'; },// 🎲, return a name and amp shows it
      preset(n) {},                  // ‹ › give -1 / +1; the picker gives a name
      control(id, value) {},         // reserved for declared controls
      track(info) {},                // a different track is playing
      transport(ev) {},              // play / pause / ended / seek
      active(on) {},                 // your viz was shown or hidden
      get backend() { return 'webgl2 · fallback'; },  // optional, shown in the OSD
    };
  },
});
```

### The `amp` global

| | |
|---|---|
| `amp.register(def)` | required, once, at top level |
| `amp.hdr` | is this canvas HDR? |
| `amp.backend` | the backend amp picked |
| `amp.osd(text)` | flash a line in the corner of the viz window |
| `amp.presets(list)` | replace your preset list at runtime |
| `amp.log(...)` | goes to amp's console, prefixed with your id |
| `amp.save(v)` | remember a string, or a JSON-able value, between sessions |
| `amp.load()` | Promise for that string. Rarely needed, see `create({ state })` |

### `audio`, what amp hands you each frame

amp does the analysis once, for every plugin, so nobody has to write a bad beat
detector twice. It is the standard real-time recipe: spectral flux from an
unsmoothed analyser for onsets, each bin whitened against its own recent peak
so quiet tracks keep triggering, and tempo from autocorrelating the onset
envelope, the same scheme librosa uses. `tools/test-beat.js` drives it in plain
node against synthesized drums, from quarter-volume kicks to a sloppy human
drummer, if you want to see it hold.

| field | |
|---|---|
| `fft` | `Uint8Array(256)`, frequency bins, 0 to 255 |
| `wave` | `Uint8Array(1024)`, time domain, where 128 is silence |
| `bass` `mid` `treb` | 0 to 1, band averages |
| `level` `peak` | 0 to 1, RMS and peak of this frame |
| `punch` | how far the low end just rose above its own recent norm. An ordinary kick reads about 0.2, a real accent 0.4 and up |
| `beat` | `true` on the single frame an onset lands. The threshold adapts, so a quiet mix keeps beating |
| `beatIndex` | onsets since the window opened |
| `bpm` | tempo from autocorrelating the onset envelope, weighted toward 120. Reported in 60 to 200, so a 50 BPM dirge reads as 100. 0 until it settles |
| `confidence` | 0 to 1, how periodic the recent onsets actually are. Gate your bpm tricks on it |
| `kick` `snare` `hat` | `true` on the frame an onset lands in that band alone: lows to ~250 Hz, 250 to 4 k, 4 k up. The MilkDrop tradition of separate bass, mid and treble beats |
| `beatPhase` | 0 to 1, where you are between beats on the PREDICTED grid. 0 is a beat. Only moves while `bpm` holds |
| `since` | seconds since the last beat |
| `loudness` | 0 to 1, hearing-weighted level. A bass-only mix reads quieter than a full one, the way it sounds |
| `playing` `elapsed` `duration` | transport |

`punch` is the one to reach for. `bass` tells you how loud the low end is.
`punch` tells you something just happened, which is usually what you want to
draw. The arrays are amp's own buffers, so read them and don't keep them.

The three beat streams do different jobs, so pick by job. `beat` says
something, anything, just hit. `kick`, `snare` and `hat` say what hit, which is
what you want when the drums each drive their own element. `beatPhase` is the
odd one out because it looks FORWARD: a phase-locked loop rides the detected
tempo and each onset nudges it into line, so you can swell toward a beat and
land a flash exactly on it instead of twenty milliseconds after. React with
`beat`, anticipate with `beatPhase`.

```js
frame({ audio }) {
  if (audio.kick) this.thump();
  if (audio.hat) this.sparkle();
  const swell = 1 - audio.beatPhase;          // rises INTO the beat
  this.glow = audio.confidence > 0.4 ? swell : audio.level;
}
```

If you want to see what any of this actually does to your music before you
decide what it should do to your picture, run **Signal**. It draws all of it,
labelled with the field names used here, including the three hooks that are
otherwise invisible until they misfire: what `track()` last said, what
`transport()` last reported, and which keys reached `input()`.

### Knowing what the player is doing

amp pushes its whole state about once a second. You don't get that. The host
diffs it and calls you only when something changed.

**`track(info)`.** A different track or station is now playing. `info` is
`{ id, title, artist, album, isRadio, playing, elapsed, duration }`. It fires on
a real change rather than once a second, and `id` is what amp diffs on. `title`
is empty when the viz window's T toggle is off, so respect that rather than
caching the last one you saw.

**`transport(ev)`.** `ev.type` is one of:

| | |
|---|---|
| `play` | playback started or resumed |
| `pause` | stopped part-way through |
| `ended` | stopped within 1.5 s of the end of the track, rather than paused |
| `seek` | the clock jumped further than wall time explains |

Each carries `elapsed` and `duration`. `seek` also carries `from`.

`audio.playing`, `audio.elapsed` and `audio.duration` are in every frame too, if
you would rather poll than react.

```js
track(info) { this.name = info.title; },
transport(ev) {
  if (ev.type === 'ended') this.fireworks();
  if (ev.type === 'seek') this.reset();
},
```

### Taking keys

A visualizer can be something you play. Declare the keys you want in
`viz.json`, by `KeyboardEvent.key`, and amp routes those to your `input()` hook:

```json
"input": ["ArrowUp", "ArrowDown", "z", "x", "r"]
```

```js
input(ev) {                 // ev.type is 'down' or 'up', ev.key is the key
  if (ev.type === 'down' && ev.key === 'ArrowUp') this.jump();
  if (ev.type === 'up' && ev.key === 'ArrowDown') this.ducking = false;
}
```

You get the keys you named and nothing else, so a visualizer cannot quietly
swallow the keyboard. amp never hands over Escape, F, or anything with ⌘ or
Ctrl held, because it needs a way out of fullscreen and a way to reach the
transport. `ev.repeat` is there if you care about held keys.

The viz lab forwards the arrows, Z, X, C and space while the caret is not in
the editor, so you can test a game without installing it first.

Ribbon, which ships with amp, is the worked example. It gets four moves out of
those two keys: up jumps, up again in the air is a double jump, down is a duck,
down twice is a slide. Nothing is held. Each of its four obstacles has exactly
one answer, wears a chevron saying which (∧ up, ∧∧ up twice, ∨ down, ∨∨ down
twice), and no move is simply a better version of another. The double jump is
not a free upgrade, since a block carries a ceiling you crack your head on if
you go up twice. The duck and the slide differ on two axes at once: the duck
gets you lowest but lasts a third of a second, the slide lasts twice as long
but does not get as low.

You have three hearts. A hit costs one, and losing all three wipes the score to
zero. Bests are banked live, one per track plus an all-time best, both through
`amp.save`, so a wipe never takes a record with it — the corner readout showing
them again after a restart is the proof the saving works. When a track drones
the same obstacle three times running, the fourth swaps to its opposite-axis
twin, so a monotone song still asks more than one question. Each skin carries
its own scenery: a starfield that fires shooting stars on the beat, an fft
skyline that glows into each beat off `beatPhase`, and a paper sky whose clouds
puff on it. The ground itself carries a few pixels of live waveform.

### Testing a visualizer without amp

A plugin is one file, with no imports and no DOM, so it runs in plain node
against a stub canvas. That makes even a game testable:

```sh
node tools/test-ribbon.js src/viz/ribbon/index.js
```

That script drives Ribbon's real physics and collision code, plays every move
against every obstacle, plays a whole course correctly, and checks that a
machine-gun beat still comes out playable. It caught two things eyeballing had
missed: a slide shorter than the tunnel it was meant to clear, and a double-tap
detector reading wall-clock time while the rest of the game read the frame
clock.

### Remembering things

A plugin has no storage. No `localStorage`, no disk, no network. So amp keeps
one string for it, and that string is the whole API.

```js
create({ canvas, state }) {          // `state` is what you saved last time, or null
  const save = state ? JSON.parse(state) : { highScore: 0 };
  ...
  amp.save(JSON.stringify(save));    // whenever it changes
}
```

- `create({ state })` hands you the string at start-up, so most plugins never
  need to ask for it.
- `amp.save(value)` takes a string, or anything JSON-serialisable, which amp
  stringifies for you. amp debounces the writes, so calling it every frame is
  wasteful but harmless, and a pending save gets flushed if you switch away.
- `amp.load()` returns a `Promise` for the current stored string, for the rare
  case you want it after start-up.
- 64 KB cap. One slot per plugin, and a plugin can only reach its own.

So a visualizer can be a game that remembers your high score. That strikes me as
a perfectly good reason to want any of this.

---

## Two backends off one simulation

Here is the rule that keeps a fallback alive. Put every piece of state and every
audio reaction in a renderer-agnostic sim, and hang thin renderers off it. Never
fork the sim per backend. That is how the WebGL2 path rots while you develop
against WebGPU. `lattice/index.js` does exactly this, and it is small enough to
read in one sitting.

```js
create({ canvas, backend, hdr }) {
  const sim = createSim();                     // all the state; no GPU calls
  const rend = backend === 'webgpu' ? await createGPU(canvas, sim, hdr)
                                    : createGL2(canvas, sim);
  return { frame({ audio, dt, t }) { sim.step(audio, dt, t); rend.frame(); } };
}
```

Two WebGL2 traps worth knowing, both of which bit amp's own engines. GL renders
bottom-up, so an image you sample from a texture you rendered needs
`vec2(uv.x, 1.0 - uv.y)`, while a CPU-uploaded one does not. And WebGL2 has no
`firstInstance`, so a second instanced draw needs its own VAO with the offsets
baked in.

## HDR

`create()` gets `hdr: true` when amp has probed this display and found a real
HDR canvas. amp configures a canvas and reads the pixels back rather than
trusting a capability string, because WebKit has accepted an `rgba16float`
canvas and then presented black.

```js
if (hdr) ctx.configure({ device, format: 'rgba16float', alphaMode: 'opaque',
                         toneMapping: { mode: 'extended' } });
else     ctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(),
                         alphaMode: 'opaque' });
```

**On three.js you cannot do that**, because three owns the canvas and configures
it for you. Ask for it through the renderer instead — hand the WebGPU backend
`HalfFloatType` and it configures the canvas with `toneMappingMode: 'extended'`,
which is the same thing by a different door:

```js
const renderer = new THREE.WebGPURenderer(
  hdr ? { canvas, antialias: false, outputType: THREE.HalfFloatType }
      : { canvas, antialias: false });
```

Then leave three's own tone mapping OFF on HDR and roll off yourself at the end
of the chain, or you crush the highlights and present the crushed result as
extended. `src/viz/ballroom` keeps ACES for the SDR path — so that image is
exactly what it always was — and on HDR uses a gentler curve with room above
white.

The SDR image is the deliverable and HDR is a bonus. Always apply a roll-off
when you are not on an HDR canvas. amp's engines use `c / (1 + c * 0.4)`. That
way the two read as the same visualizer instead of one washed-out one. Verified:
an HDR canvas configures and presents inside the sandbox, the same as it does in
amp's own window.

---

## Errors, and what happens when you get it wrong

amp catches everything and reports it rather than leaving you a black screen.

- a throw in `frame()` gets reported and that frame skipped. Twelve of them and
  amp shuts the plugin down and says so
- a throw in `create()`, a syntax error, or a missing `amp.register()` shows as
  a message in the viz window
- four seconds without a frame and amp terminates the worker and falls back
- `amp.log()` reaches amp's console with your plugin's id

---

## Why a worker, and not an iframe

An iframe was the obvious answer and it does not work, for a reason worth
recording. Measured on WKWebView, driving one counter per frame:

| | frame rate | can reach `parent.tiny`? |
|---|---|---|
| same-origin iframe, meaning a `file://` child or `srcdoc` with `allow-same-origin` | 60 fps | **yes, full backend access** |
| sandboxed `srcdoc`, opaque origin | 22 fps | no |
| `http://127.0.0.1` iframe | 20 fps | no |
| custom-scheme `tiny-media://` iframe | 22 fps | no |
| **worker + OffscreenCanvas** | **60 fps** | **no** |

Every cross-origin frame is rAF-throttled to about a third of the display rate,
whatever scheme or sandbox flags you use. The only frames that run at 60 are the
ones that can reach into amp. A runaway iframe also freezes the host window
outright, measured at 1 host frame during a 2.5 s guest spin, because WebKit
runs same-process iframes. A watchdog cannot even fire. A worker is the only
place that is both isolated and fast, and it passes that same freeze test with
150 host frames.

This needs one piece of machinery. A worker inherits the CSP of whatever minted
it, and amp's viz window has to stay unrestricted, since it streams radio and
paints data-URI art. So amp keeps a hidden one-pixel same-origin iframe whose
only job is to carry the strict policy and mint plugin workers. That is
`src/frontend/vizhost.js`, it is where `connect-src 'none'` comes from, and it
is what makes every "blocked" in the table at the top true.
