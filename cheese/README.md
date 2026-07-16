# Cheese 🧀

A photo booth — plain JavaScript, zero dependencies, and the tinyjs 0.12
**camera & microphone** recipe.

Live mirrored preview, a **3-2-1 countdown** with beeps and a flash, and four
filters (Normal / Noir / Sepia / Pop) that show on the preview as CSS and get
**baked into the pixels** of every snap (WebKit has no `ctx.filter`, so the
canvas is filtered by hand). Hit **⏺** and it records a **video clip with
sound** — up to a minute, with a live mic level meter so you can see the
audio flowing. Space snaps, R records.

Snaps and clips land in `~/Pictures/Cheese` as real files, show up on the
shelf along the bottom, and **drag straight out of the app** — grab a tile
and drop it in Finder, Slack, anywhere. Hover a tile to reveal (↗) or
delete (✕).

The interesting parts:

1. **getUserMedia, for real** — the camera and mic are captured in the
   WebKit page with the standard web APIs. The launcher answers WebKit's
   per-origin media prompt for you, so users only ever see the one system
   dialog naming this app.
2. **Permission onboarding** — `app.permissions.check('camera')` drives the
   gate screen: `undetermined` gets a friendly Enable button (the system
   prompt appears on the first `getUserMedia`), `denied` gets a button that
   deep-links to the Camera pane of System Settings — and the gate polls
   `check()` so it dismisses itself the moment the switch flips. The mic is
   requested lazily, at the first recording, when the ask makes sense.
3. **Packaged permissions** — the `"permissions"` block in `tinyjs.json`
   becomes the Info.plist usage strings (`NSCameraUsageDescription`, …), so
   the built Cheese.app survives TCC. Without them, macOS kills a bundled
   app the moment it touches the camera.
4. **MediaRecorder, detected not assumed** — WebKit records `video/mp4`
   (H.264/AAC), Chromium records webm; the app feature-detects with
   `isTypeSupported`. Clips cross the bridge in base64 chunks
   (begin/chunk/end), each sliced on a 4-char boundary so every chunk
   decodes independently; the clip's shelf thumbnail is a canvas grab from
   the moment recording started (`sips` can't thumbnail video).

The page renders everything with `textContent`, and the backend guards every
path it's handed to inside `~/Pictures/Cheese`.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Cheese.app
```

Or skip the toolchain: **[cheese-0.1.0.dmg](../_builds/cheese-0.1.0.dmg)** is
a prebuilt, signed & notarized copy — open and drag to Applications.
