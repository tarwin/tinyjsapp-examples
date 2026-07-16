# Geiss HDR — vendored for amp

This directory is a vendored copy of **[Geiss HDR](https://www.geisswerks.com/geiss_hdr/)**,
Ryan Geiss's realtime music visualizer (the modern WebGPU rewrite of the 1998
[Geiss screensaver / Winamp plug-in](https://www.geisswerks.com/geiss/)).
amp embeds it as one of its visualizer engines.

- **Copyright** © 2026 Ryan Geiss — [geisswerks.com/geiss_hdr](https://www.geisswerks.com/geiss_hdr/)
- **License:** Apache-2.0 — [LICENSE.txt](LICENSE.txt)
- **Attribution / naming notice:** [NOTICE.txt](NOTICE.txt) (retained per its terms;
  also reproduced in the bundle banner)
- **Output imagery permissions:** [OUTPUTS.txt](OUTPUTS.txt)

The sources were fetched from `https://www.geisswerks.com/geiss_hdr/*.js`
on 2026-07-16 (the deployed ES modules are the published source — the
[geissomatik/geiss](https://github.com/geissomatik/geiss) repo holds the 1998
C++ original, not this web rewrite).

## Modifications (per Apache-2.0 §4b)

Files changed for amp, every change marked with an `[amp]` comment:

- **main.js** — external-audio mode behind `window.GeissAmpConfig` (amp feeds
  a WebAudio source node; the mic/tab/mp3 source-select flow is bypassed);
  HDR gated on the host's runtime probe instead of UA sniffing (WKWebView's
  UA has no "Safari" token, and older WebKit *accepted* `rgba16float` but
  presented black — amp's viz.js configures/renders/reads back before setting
  `GeissAmpConfig.allowHdr`); HTTPS-requirement check skipped; top-level
  awaits removed; input/drag-drop handlers gated while the engine is inactive
  or where they collide with amp's transport keys (space, F, ⌘L).
- **audio_input.js** — added `startExternal(ctx, srcNode)`: analyser-only
  connection to a host-owned source node (inaudible; amp owns playback).
- **engine.js** — background worker created via `amp_worker_shim.js` instead
  of a relative URL (the tinyjs build inlines the whole frontend into one
  HTML file, so `./background_worker.js` could never resolve).

New files (amp's, not from the original): `amp_worker_shim.js`, `build.sh`,
`banner.txt`, this README.

## Rebuilding the bundle

```sh
sh build.sh    # writes ../frontend/geiss-hdr.bundle.js (and worker.bundle.txt)
```

`build.sh` uses esbuild: first it bundles `background_worker.js` (plus its
imports) to `worker.bundle.txt`, then bundles `main.js` into a single minified
classic script with the worker text inlined and the license banner prepended.

## HDR in WKWebView

The author's compatibility notes (preserved in main.js, from early 2026) say
Safari's WebGPU failed silently when the canvas was configured as
`rgba16float` — black screen. WebKit has since fixed this (WebGPU shipped in
Safari 26.0; HDR canvas landed during the 26.x cycle): verified working on
macOS 26.5, where `rgba16float` + `toneMapping: { mode: "extended" }`
configures *and presents*. Because the failure mode was silent, amp doesn't
trust `configure()` — viz.js renders a probe frame and reads pixels back
before allowing the HDR path; on an SDR display or older WebKit it falls back
to SDR. Ctrl+H (while Geiss is active) toggles HDR/SDR live.
