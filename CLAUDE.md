# tinyjsapp-examples — working notes

The example fleet for tinyjs (../tinyjsapp or github.com/tarwin/tinyjsapp).
Each app is a folder with `tinyjs.json`; `tinyjs dev` inside it runs it.

## Releasing builds

ALL payload (mac dmg + update zip, win zip, linux tarballs) lives on GitHub
Releases — one release per app, tag `<dir>-v<version>` (version-agnostic per
release event: platforms at different versions share the tag). Only the
small stuff (manifests, catalog, README) is committed. Payloads were PURGED
from git history 2026-07-25 — never commit one again; `_builds/` is a local
staging area, gitignored except `_builds/<dir>/manifest.json`, which shipped
apps poll by raw url — never remove or purge the manifests.

⚠ History was force-rewritten for that purge (683 MB → 20 MB). Any clone
from before 2026-07-25 must `git fetch && git reset --hard origin/main &&
git fetch --tags --force` — never pull/merge across the rewrite, that
resurrects the old 683 MB history.

How auto-update works: each shipped app polls its baked-in raw url
`_builds/<dir>/manifest.json`, reads its own platform block (top level =
mac, `win`, `linux.<arch>`), and downloads that block's `url` verifying
`sha256`. The manifest is the mutable pointer; release assets are the
static payload. So a release = upload assets to the tag, then push updated
manifest/catalog urls. Uploading needs `gh` authed with repo scope.

### macOS / Windows

1. Bump `version` in `tinyjs.json`, build + publish as usual, stage the
   artifacts where they always went: `_builds/<name>-<ver>.dmg` (mac
   human download), `_builds/<dir>/<name>-<ver>.zip` (mac update payload),
   `_builds/<dir>/<name>-<ver>-win.zip`. They stay local (gitignored).
2. `gh release create <dir>-v<ver> -R tarwin/tinyjsapp-examples` if the tag
   is new, then `gh release upload <dir>-v<ver> <files> --clobber`.
3. Edit `_builds/<dir>/manifest.json` — ONLY your platform's block (top
   level for mac, `win` for windows): version, sha256, notes, and url =
   `https://github.com/tarwin/tinyjsapp-examples/releases/download/<tag>/<file>`.
   Never copy a published manifest over it wholesale (kills other platforms).
4. Mac only: `node shelf/gen-catalog.js` (mac-only: sips; `EXAMPLES_ROOT`
   env overrides its hard-coded repo path). It rebuilds mac entries and
   carries win/linux/platforms blocks over from the existing catalog.json;
   apps without a staged dmg for the current version keep their old entry.
   Windows: no gen tool exists — edit the catalog `win` blocks in
   catalog.json AND shelf/src/frontend/catalog.js by hand (keep in sync),
   or model a merge tool on merge-manifest-linux.js.
5. Update the download line in README.md (+ the app's own README for mac).
6. Verify urls (`curl -fsSLI`), commit manifests + catalog + README, push.

### Linux (containerized — the 2026-07-31 flow; both arches from this VM)

⚠ NEVER `tinyjs publish` for Linux on the host. The linker bakes the build
userspace's glibc floor into tjs + launcher, and this VM is Ubuntu 24.04 —
tarballs packaged here demand GLIBC_2.38 and refuse to load on Ubuntu 22.04
/ Debian 12 / Mint 21 (`version GLIBC_2.38 not found`). That is exactly how
amp 0.8.0–0.10.0 and the whole 2026-07 fleet shipped broken. Everything
builds inside `ubuntu:22.04` containers; Rosetta (enabled on this VM,
`/proc/sys/fs/binfmt_misc/RosettaLinux`) runs the amd64 one.

1. Bump `version` in each changed app's `tinyjs.json`.
2. Run `shelf/pkg-linux-container.sh` once per arch (usage in its header:
   two `docker run` lines, `-e TINYJS_TAG=<tinyjs release>`). It builds the
   toolchain from the tagged tinyjs release inside 22.04, publishes each
   app, reinstalls `node_modules` per-platform for apps with a
   `package.json` (host-copied modules carry the host arch's native
   bindings — broke the x86_64 pass once), and floor-checks the binaries
   INSIDE every finished tarball. Output: `<scratch>/out/<app>/` per arch.
3. Stage: per app, `cp` both arches' tarballs to `_builds/<dir>/`; clear
   stale `*-linux-*.tar.gz` from `<app>/dist/publish/` and put the fresh
   x86_64 tarball + `manifest-x86_64.json` (renamed `manifest.json`) there.
4. `bash shelf/upload-releases-linux.sh` — creates/updates the per-app
   releases and uploads both arches' tarballs. Must run before steps 5–6.
5. `node shelf/merge-manifest-linux.js --release` — merges the linux block
   into the committed manifest WITHOUT clobbering mac/win, urls pointing at
   the release assets. Run once with x86_64 manifests in `dist/publish/`,
   then swap in each app's `manifest-arm64.json` and run again — each pass
   merges the arch blocks it sees. Never copy a published manifest over
   `_builds/<dir>/manifest.json` wholesale: the top level is the MAC entry,
   and each platform's updater reads its own block (`linux.<arch>.version`).
   No node on this host — run the shelf/*.js tools via
   `docker run --rm -v $PWD:/repo -w /repo node:20-slim node shelf/<tool>`.
6. `node shelf/gen-catalog-linux.js --release` — adds/updates per-arch
   download blocks in catalog.json + shelf's catalog.js (one run covers
   both arches once both tarballs are staged in `_builds/`).
7. Update the version-pinned Linux links: this README's per-app download
   lines AND ../tinyjsapp/docs/index.html (shelf hero + app cards) — the
   Linux segment only; mac/win links keep their own versions.
8. Verify a few urls resolve (`curl -fsSLI …`), ideally loader-test one
   published tarball on a bare `ubuntu:22.04` container (`ldd` both
   binaries), then commit manifests + catalog + README and push. Always
   pass `--release` — the no-flag raw-url mode is a leftover from before
   the history purge and would emit urls that 404.

Background on the floor rule + CI's side of it (verify step, gcc-12,
txiki pragma strip): ../tinyjsapp/TODO-linux.md ("x86_64 builds") and the
comments in ../tinyjsapp/.github/workflows/release.yml.

## Linux platform lessons already baked into these apps (don't regress)

- NO Web Audio to ctx.destination on Linux — it crackles (WebKitGTK renders
  the graph on a normal-priority thread). Play elements directly; analysis
  via tiny.audioTap; EQ/balance via tiny.audio.filters. See amp/player.js
  and platter/src/frontend/audio.js for the two reference patterns.
- `sips` is macOS-only. Gate with CAN_SIPS (see platter/src/main.js).
- Data dirs: never hardcode `~/Library/Application Support` on Linux — use
  `$XDG_DATA_HOME || ~/.local/share` (what the bridge's app.paths.data /
  store.json already use; shelf's Linux uninstall removes that dir too).
  No migration from the old mac-shaped path — alpha software, old dirs are
  simply orphaned.
- Camera/mic (getUserMedia): works, but the launcher only grants what
  tinyjs.json's "permissions" block declares (no OS prompt exists on Linux —
  the manifest IS the gate). Undeclared = NotAllowedError. WebKitGTK's
  MediaRecorder records video/mp4 like macOS (measured, webkit 2.52).
- WebKitGTK: no WebGPU (feature-detect, see amp viz.js), no native HLS
  (amp vendors hls.js), no writing-mode on range inputs (probe + legacy
  -webkit-appearance fallback, see amp eq.js/style.css).
- Dual-renderer viz engines (amp lagoon/murmur/permutations): keep the whole
  simulation in a renderer-agnostic `createSim()` and hang a WebGPU and a
  WebGL2 renderer off it — never fork the sim. GL renders bottom-up, so
  sampling a texture YOU rendered needs `vec2(uv.x, 1.0 - uv.y)`, while a
  CPU-uploaded one (texSubImage2D, row 0 first) is sampled with plain uv.
  WebGL2 has no firstInstance: give the second draw its own VAO with the
  attribute offsets baked in. Engines NOT in viz.js/rack.js `NEEDS_GPU` are
  the ones with a real WebGL2 path.
- Frameless windows on Linux get resize grips from tinyjs — declare
  `minSize` on satellites or content gets resized out of view.
