# Examples on Windows — known rough edges

All 24 apps run on Windows; this tracks the *partially working* bits parked
for a later cross-platform polish pass. Add findings from manual sweeps
here.

## kitchen-sink
- Several panels exercise macOS-only APIs and degrade on Windows (by
  design they report 'unsupported' rather than crash): Quick Look,
  AppleScript, OCR, Spotlight, dock badge/bounce, haptics, say/voices
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

## coo3d
- Flock capped to 8 pigeons on Windows/Linux (WebGL context pressure —
  Chromium evicts contexts past ~16 per process; macOS keeps 20).
