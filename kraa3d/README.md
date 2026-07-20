# Kraa 3D 🐦‍⬛

<img src="icon.png" alt="kraa3d icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/kraa3d.webp" alt="kraa3d screenshot" width="640">

**⬇ Download:** [kraa3d-0.2.1.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/kraa3d-0.2.1.dmg) **(5.1 MB)** — prebuilt, signed & notarized; open and drag to Applications.

[kraa](../kraa/)'s two ravens, reincarnated as **skinned, animated 3D crows**
rendered by three.js — same brain, new body. Huginn and Muninn still strut,
peck, preen, caw at each other, flee your cursor, and empty seed piles for
trust; the backend state machine is kraa's nearly line for line. Everything
that changed lives in the frontend, where the hand-drawn SVG puppet became a
rigged GLB with real motion-captured-feeling clips.

Animated crow from [AnimalMesh3D](https://www.patreon.com/cw/AnimalMesh3D)

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Kraa 3D.app — a 3D flock in ~6.5 MB
```

Same field guide as kraa, with one twist: scattering seed (the 🐦‍⬛ menu-bar
item, or **⌃⌥S** anywhere) drops the pile at a *random spot on the screen* —
then watch the flock spot it and fly in. Right-click a crow for the context
menu; click a bird to poke it — a fed, trusting crow takes it as a
compliment; a wild one takes it as an ambush. And they *kraa* out loud now.

The tray menu has four persisted settings:

- **👻 Click-through** — `setClickThrough(true)` on the bird windows, so
  every mouse event passes straight through the crows to whatever's under
  them (pokes included — the tray is the way back).
- **🖥️ Live on the desktop** — `setLevel('desktop')` drops the flock behind
  every window, walking around on the wallpaper itself like part of the
  desktop; off restores floating-above-everything.
- **🌱 Grounded** — everything that stands, walks, hops, or lands keeps to
  a strip along the bottom of the screen, like there's actual ground down
  there; the sky above stays open for flying (and seed lands low, too).
  Toggling it on sends any airborne loiterers down to the bottom.
- **🔊 Kraa volume** — off / low / medium / high (starts at medium), plus a
  **🤫 Shhhhh** toggle for library manners: the speech bubbles keep coming,
  but only about one kraa in eight is actually audible. The voice itself is
  below.

## The 3D part

1. **The asset needed rescuing.** The model (from a stylized-animals asset
   bundle) ships a `.gltf` that references a missing `Crow.bin` and carries
   zero animations — the good stuff is in the `.blend`. A headless Blender
   run (`blender -b Crow.blend -P export.py`) exports a self-contained GLB
   with all seven actions (`look`, `walk`, `run jump`, `eat`, `clearing`,
   `fly`, `glide`), textures downsized 2048→512 and re-encoded as webp
   inside the GLB. Result: 932 KB for geometry, rig, clips, and skins.

2. **No CDN, no modules, no fetch.** three.js + GLTFLoader are bundled with
   esbuild into one classic script (`three.bundle.js`), and the GLB rides
   along as base64 in `crow-model.js`, decoded and `GLTFLoader.parse`d at
   boot — the tinyjs build inlines every script into a single HTML file, so
   the packaged app stays fully offline.

3. **Clip casting.** The backend pushes the same states kraa had; the page
   maps them: idle → `look`, walk → `walk`, hop → the airborne middle of
   `run jump` (an `AnimationUtils.subclip`), peck/eat → `eat`, preen →
   `clearing`, with `crossFadeFrom` blends. A **cruising** flier alternates
   flap bursts (`fly`) with `glide` stretches like the real thing; a
   **scared** one hammers the flap at 1.7×. Source clips carry root motion
   (`run jump` covers ground) but here the *window* is what moves, so every
   root bone's horizontal translation is pinned to its first keyframe —
   keeping the vertical bob, dropping the slide.

4. **The caw is procedural.** There's no caw clip, so after `mixer.update`
   poses the skeleton each frame, the page nudges bones on top: the head
   and neck throw back and the jaw bone hinges the beak open on a two-beat
   envelope. Two rig facts found empirically (screenshot grids of every
   axis): this ActorCore-style skeleton hinges on **local Z** — X is pure
   bone twist — and the jaw opens with *negative* Z. The same post-mix trick
   tips the head toward whatever the backend says the bird is watching.

5. **Turning and banking.** The bird yaws *into its direction of travel*:
   the backend's 8 Hz look vector is its screen-space heading, screen-down
   is treated as toward-the-camera, so a crow walking down-right angles
   toward you and one climbing away shows you its back — something the 2D
   kraa could never do. Yaw eases along the shortest arc, so a flip sweeps
   the crow *through* facing-the-camera instead of mirroring. The
   toward-camera component is capped and the rig scales down a few percent
   as it turns off-profile — fully sideways, a mid-flap wingspan would
   overflow the 200px window. Banking in flight rotates an outer wrapper
   group around the screen axis (rotating the already-yawed model would
   roll it instead).

6. **WebGL over the wallpaper.** The renderer runs `alpha: true` on a
   transparent frameless window — the desktop shows through around the
   crow. Clicks raycast against the mesh, so only clicks that actually land
   on the bird poke it. The CSS layer keeps the soft contact shadow (it
   floats away mid-flight), the speech bubble, and the hearts.

7. **One sun, and pseudo-depth.** A single virtual sun sits at a fixed
   screen spot way above the display; the backend sends each page the sun
   *and* its own window position (riding on the 8 Hz look push), and the
   page aims its key light from sun-relative-to-me — so a crow's shading
   genuinely shifts as it crosses the screen instead of being glued to it.
   Depth follows the same worldview: the bird lower on the screen is
   nearer, so the backend re-raises whichever window should be in front
   whenever their vertical order flips (with hysteresis). On a dark-mode
   desktop the lights step up a notch (`prefers-color-scheme`) so the black
   bird still reads.

8. **The voice.** `kraa.mp3` rides along as base64 (like the model) and is
   decoded once into a WebAudio buffer — verified running without any user
   gesture. Every caw plays through a fresh gain + `StereoPannerNode`: the
   backend supplies a **pan from the bird's x position on the screen** and
   a random volume, the page adds a little playback-rate jitter, and a
   startled "!" is sharper and higher-pitched than a proper kraa.

The backend (three windows one brain, FFI cursor tracking, the trust
economy) is documented in [kraa's README](../kraa/README.md) — it applies
here unchanged.

Not affiliated with anyone; the crow model is from a purchased asset bundle
and ships here re-encoded for size.
