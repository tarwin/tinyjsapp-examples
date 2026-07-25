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

### Linux (per arch — run once per architecture)

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
   catalog and push. Always pass `--release` — the no-flag raw-url mode is a
   leftover from before the history purge and would emit urls that 404.

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
