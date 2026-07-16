# Trolley 🛒

A tiny Trello — boards, lists and cards, all local. **Vue 3 + radix-vue +
Atlassian's Pragmatic drag and drop** on the page, **SQLite** (txiki's
built-in `tjs:sqlite`) in the backend.

Cards drag between lists, lists drag along the board, and everything lands in
one SQLite file in a folder *you* pick on first run — Documents, iCloud Drive,
a synced folder — movable later from Settings. Cards hold notes, six nameable
labels, a checklist, and a due date; due cards badge themselves, count into a
**menu-bar tally** (`🛒 3`), and pop a **notification** when the time comes —
click it and Trolley opens that card. Boards get preset gradient backgrounds
or any image you pick (View ▸ Change Background). **⌃⌥T in any app** summons
a frameless quick-add palette: type, Enter, it's filed to the list you used
last, and the board window updates live over the push channel.

```sh
npm install
tinyjs dev      # the real app: native window + vite HMR
npm run dev     # UI-only hacking: plain browser + an in-memory mock backend
tinyjs build    # dist/Trolley.app
```

Or skip the toolchain: **[trolley-0.1.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/trolley-0.1.0.dmg)** (4.6 MB) is
a prebuilt, signed & notarized copy — open and drag to Applications.

## Techniques on show

1. **A real dependency stack in a tinyjs window.** The vue-ts template is
   create-vite underneath, so radix-vue (dialogs, popovers, dropdown menus)
   and `@atlaskit/pragmatic-drag-and-drop` (element adapter + closest-edge
   hitboxes + auto-scroll) just work. The board is optimistic: mutations
   apply to the local store instantly, then the api call persists them.
2. **Two windows from one Vite app.** `palette.html` is a second rollup
   input; the backend opens it with `app.openWindow('palette', { page:
   'palette.html' })` — served by the dev server in dev, from the bundled
   `dist/` in the .app. The page dresses its own window (`setChrome`
   frameless + HUD vibrancy, always-on-top) and closes itself on Esc/blur.
   A global hotkey (`hotkey.register` + `onHotkey`), the tray menu, and a
   File menu item all funnel into the same `openPalette`.
3. **The backend owns the data.** `backend/db.ts` is the whole storage
   story: three tables, fractional positions for ordering (renumber when a
   gap closes), JSON columns for labels/checklists. A 30-second sweep drives
   notifications (`notified` flag per card, re-armed when the due date
   changes) and the tray tally. Background images are copied into the data
   folder and served back as `data:` URIs — WebKit never touches `file://`.
4. **A mock bridge for browser dev** (`src/devmock.ts`): if the page loads
   without the injected `tiny` global, a faithful in-memory fake steps in —
   JSON-serializing both directions like the real bridge — so `npm run dev`
   in Chrome is enough to hack on the UI. Tree-shaken out of builds.

## Shipping it: auto-update with `tinyjs publish`

This example is wired for real distribution. `tinyjs.json` points at an
update manifest:

```json
"update": { "url": "http://127.0.0.1:8787/manifest.json" }
```

Each release is three commands:

```sh
# 1. bump "version" in tinyjs.json (say 0.1.1), then
tinyjs publish        # → dist/publish/trolley-0.1.1.zip + manifest.json
# 2. upload both files to the directory update.url points at — any static
#    host works: GitHub Releases, S3, nginx…
```

In the app, File ▸ **Check for Updates…** (also checked quietly at launch)
calls the built-in `update.check`; if the manifest's version is newer,
Settings offers **Install & Relaunch** → `update.install` downloads the zip,
verifies the sha256 *and* the code signature, swaps the .app in place, and
relaunches. Rollback on failure.

Try the whole loop locally — the `127.0.0.1` URL above is allowed exactly for
this (real hosting must be https):

```sh
tinyjs build && cp -R dist/Trolley.app /Applications   # install 0.1.0
# bump version to 0.1.1 in tinyjs.json, then:
tinyjs publish
python3 -m http.server 8787 -d dist/publish            # host the release
open /Applications/Trolley.app                          # File ▸ Check for Updates…
```

For the real thing: set `update.url` to your https host, sign with a
Developer ID (`signIdentity` in tinyjs.json), `tinyjs notarize`, and upload
`dist/publish/` on every release.
