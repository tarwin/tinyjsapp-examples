# Nib 🖋

<img src="icon.png" alt="nib icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/nib.webp" alt="nib screenshot" width="640">

**⬇ Download:** [nib-0.1.2.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/nib-0.1.2.dmg) **(4.3 MB)** — prebuilt, signed & notarized; open and drag to Applications.

A tiny Markdown editor — one native window per document. Plain JavaScript,
zero dependencies, including the Markdown renderer.

The main window is a little Welcome screen (recent files, a dropzone, a
draft-recovery card); every `.md` you open gets its own window with an
editor/preview split (**⌘1 / ⌘2 / ⌘3**, draggable divider, synced scrolling).
Open files however you like: **⌘O**, drop them on any Nib window, or — thanks
to `"fileExtensions": ["md", "markdown"]` — double-click them in Finder or
drop them on the Dock icon. Preview themes (**View ▸ Theme**: Paper, Ink,
Typewriter, Night) follow the document everywhere it goes: the live preview,
**⌘P** (where the print panel's *Save as PDF* is the PDF exporter), and
**Export as HTML**, which writes a standalone themed file. Task-list
checkboxes are clickable in the preview and edit the source line.

The interesting part is **closing**. macOS gives an app no veto over the red
✗ — tinyjs's `onWindowClosed` fires *after* the window is gone — so instead
of pleading, Nib makes closing lossless: every edit is debounce-synced to the
backend, and a window that dies dirty leaves a draft in `tiny.store`. Reopen
the file and your changes are restored, banner and all. **⌘W** gets the
civilised three-button sheet (Save / Don't Save / Cancel), and an untitled
window that closes dirty comes back via the Welcome screen's draft card.

The techniques on show:

1. **One window per document** — the backend opens `doc.html` per file with
   `app.openWindow`, tells windows apart in api handlers via `meta.window`,
   and routes per-window control through `app.window(id)`. Menu events
   broadcast to every page; only the one with `document.hasFocus()` acts, and
   it re-asserts the View menu's checkmarks on focus so the radios follow the
   active window. The Welcome window never dies — `setHideOnClose` — and
   re-shows itself when the last document closes.
2. **The dirty-state dance** — `api.sync` + `onWindowClosed` + `tiny.store`
   drafts, as above. `Save` is a two-step with the page (dialogs are
   page-side: `tiny.win.saveFile()` picks the path, the backend writes it).
3. **A safe hand-rolled renderer** — `md.js` covers the everyday Markdown set
   in ~250 lines, escapes *everything* (raw HTML is shown, never executed —
   the page holds an RPC channel with full system access), and vets URL
   schemes. Images with relative paths are served by the backend as `data:`
   URIs (`api.imageData`), so WebKit never touches `file://`; links open in
   your browser, except relative `.md` links, which open in Nib.

```sh
tinyjs dev      # run with hot reload — then open sample.md for the tour
tinyjs build    # package dist/Nib.app
```
