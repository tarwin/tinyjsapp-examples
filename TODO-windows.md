# Examples on Windows — known rough edges

All 24 apps run on Windows; this tracks the *partially working* bits parked
for a later cross-platform polish pass. Add findings from manual sweeps
here.

## kitchen-sink
- Several panels exercise macOS-only APIs and degrade on Windows (by
  design they report 'unsupported' rather than crash): Quick Look,
  AppleScript, OCR, Spotlight, dock badge/bounce, say/voices
  (works but SAPI voices differ), pickColor, recorder. A pass to hide or
  re-label those panels per-platform would polish it.
- (User sweep 2026-07-21: "a bunch of things kinda break" — enumerate
  specifics here on the next pass before fixing.)

## general patterns for the polish pass
- Panels/buttons for mac-only APIs should feature-detect (call answers
  'unsupported') and hide or annotate instead of showing dead controls.
- NEVER declare a top-level `chrome` identifier (function OR const/let) —
  `window.chrome` is a browser global on WebView2; a const collides at
  PARSE time and kills the whole script (bit amp and kitchen-sink).
- Use `tiny.fileURL(path)` for all file URLs; never hand-roll.
- Cross-platform basename: split on both separators `[\\/]`.
- Per-OS data dirs via `app.paths`, never `~/Library`.

## amp
- MIDI + tracker playback (.mid via SpessaSynth, .mod/.s3m/.xm/.it via
  libopenmpt wasm) rebuilt 2026-07-30 as the zero-socket pipeline
  (render.js): the PAGE fetches the soundfont/module off disk via
  `fetch(tiny.fileURL(...))`, renders in a module worker, plays an
  in-memory blob; the big screen renders its own copy. Verified end-to-end
  on macOS only (headless: s3m 429 ms, midi 1.1 s, 0 socket bytes).
  Unverified on Windows/Linux: **fetch(file://) from a page** under
  WebView2 and WebKitGTK (if walled off, render.js silently falls back to
  base64 chunks via the 'fileChunk' api — works but slow, so CHECK which
  path actually runs), module workers + wasm instantiation under both, and
  the blob-src audio element. A New Frontend (s3m) + Greensleeves (mid)
  samples are the 1-click tests.

## coo3d
- Flock capped to 8 pigeons on Windows/Linux (WebGL context pressure —
  Chromium evicts contexts past ~16 per process; macOS keeps 20).
