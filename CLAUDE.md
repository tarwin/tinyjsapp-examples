# tinyjsapp-examples — working notes

The example fleet for tinyjs (../tinyjsapp or github.com/tarwin/tinyjsapp).
Each app is a folder with `tinyjs.json`; `tinyjs dev` inside it runs it.

## Releasing Linux builds (per arch — run once per architecture)

Payload lives on GitHub Releases (tag `<dir>-v<version>` per app); only the
small stuff (manifests, catalog) is committed. Tarballs from before this
scheme stay tracked in `_builds/` forever — wild catalogs/manifests point at
their raw urls.

1. Bump `version` in each changed app's `tinyjs.json`.
2. `tinyjs publish` in each app dir → `dist/publish/<name>-<ver>-linux-<arch>.tar.gz`.
3. `cp` each tarball to `_builds/<dir>/` — the local staging area the tools
   hash from (new ones are gitignored, NOT committed).
4. `bash shelf/upload-releases-linux.sh` — creates/updates the per-app
   releases and uploads both arches' tarballs. Must run before steps 5–6.
5. `node shelf/merge-manifest-linux.js --release` — merges the linux block
   into the committed manifest WITHOUT clobbering mac/win, urls pointing at
   the release assets. Never copy a published manifest over
   `_builds/<dir>/manifest.json` wholesale: the top level is the MAC entry,
   and each platform's updater reads its own block (`linux.<arch>.version`).
6. `node shelf/gen-catalog-linux.js --release` — adds/updates per-arch
   download blocks in catalog.json + shelf's catalog.js. Per-arch by design:
   an x86_64 pass adds blocks beside the arm64 ones.
7. Verify a couple of urls resolve (`curl -fsSLI …`), then commit manifests +
   catalog and push. Without `--release` both tools still emit the old
   raw-url flavor (then you must commit the tarballs too).

x86_64 pass: see ../tinyjsapp/TODO-linux.md ("x86_64 builds") — an Ubuntu
ARM VM with Parallels Rosetta builds x86_64 inside an amd64 container.

## Linux platform lessons already baked into these apps (don't regress)

- NO Web Audio to ctx.destination on Linux — it crackles (WebKitGTK renders
  the graph on a normal-priority thread). Play elements directly; analysis
  via tiny.audioTap; EQ/balance via tiny.audio.filters. See amp/player.js
  and platter/src/frontend/audio.js for the two reference patterns.
- `sips` is macOS-only. Gate with CAN_SIPS (see platter/src/main.js).
- WebKitGTK: no WebGPU (feature-detect, see amp viz.js), no native HLS
  (amp vendors hls.js), no writing-mode on range inputs (probe + legacy
  -webkit-appearance fallback, see amp eq.js/style.css).
- Frameless windows on Linux get resize grips from tinyjs — declare
  `minSize` on satellites or content gets resized out of view.
