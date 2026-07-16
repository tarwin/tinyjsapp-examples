# Presto 🎩

<img src="icon.png" alt="presto icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/presto.webp" alt="presto screenshot" width="640">

**⬇ Download:** [presto-0.1.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/presto-0.1.0.dmg) **(4.3 MB)** — prebuilt, signed & notarized; open and drag to Applications.

Drop a file — ✨ it's converted. Plain JavaScript, zero dependencies.

A dropzone for images and video: drop files on the window **or on the Dock
icon**, pick a target format, and outputs land next to the source (never
overwriting anything — `photo.png` → `photo.jpg`, then `photo-2.jpg`, …).
When a job finishes you get a notification; **clicking it reveals the file
in Finder**.

The techniques on show:

1. **Real-path drag & drop** — `tiny.win.onDrop` hands the page actual
   filesystem paths, not sandboxed blobs. No upload dance, no `FileReader`.
2. **Dock & "Open With" drops** — `"fileExtensions"` in `tinyjs.json` +
   `tiny.app.onOpenFiles` (buffered, so it works cold-start too).
3. **Spawn + live progress** — images go through macOS's built-in `sips`
   (instant); video goes through `ffmpeg`, with `time=` parsed off its
   stderr into a progress bar pushed to the page per percent.
4. **Click-to-reveal notification** — `app.notify({ id })` when a job lands,
   `onNotificationClick` runs `open -R` on the output.

Targets: images → PNG / JPEG / HEIC / TIFF (always available), video →
MP4 / GIF / M4A-audio (needs `brew install ffmpeg` — Presto checks
homebrew's paths directly, since a Finder-launched app doesn't inherit your
shell PATH). The GIF target uses ffmpeg's palettegen/paletteuse filter, so
dropped screen recordings come out as genuinely nice GIFs.

Jobs run one at a time (parallel ffmpeg runs would just fight over cores);
the queue, per-job progress, and errors all live in the backend, and the
page just repaints the latest `jobs` snapshot it's pushed.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Presto.app — drop files on its Dock icon!
```
