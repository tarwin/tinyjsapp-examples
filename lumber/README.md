# Lumber 🪵

A log-tailing HUD — plain JavaScript, zero dependencies.

Open (or drop) a log file and Lumber live-follows it in an **always-on-top
translucent panel** that floats over your editor while you work. Filter box,
error/warn colorizing and counters, stick-to-bottom follow that gets out of
the way when you scroll up. No file handy? **Tail the demo log** — a built-in
fake sawmill service that logs forever, so the app demos itself.

The whole trick is three txiki.js primitives (see `src/main.js`):

1. **`tjs.watch(path, cb)`** — kernel file events; a write to the log wakes
   the backend instantly. No polling.
2. **Offset reads** — `tjs.open(path, 'r')` + `fh.read(buf, offset)`: the
   backend remembers how far it has read and fetches only the new bytes, so
   tailing a 2 GB log costs nothing (opening one shows just the last 256 KB).
3. **Streaming `TextDecoder`** — appends can split a UTF-8 character or a
   line in half; `decode({ stream: true })` plus a carry string make the
   seams invisible.

Edge cases handled the way `tail -f` users expect: **truncation** (file
shrank → reload from the top, with a marker line) and **rotation** (the
inode vanishes → briefly poll the path and re-arm on whatever logrotate
puts there).

Also along for the ride: `"chrome": { "vibrancy": "hud" }` frameless window
with a `data-tiny-drag` header, `setAlwaysOnTop` (📌 in the header and a
right-click context menu), `"fileExtensions": ["log"]` so Finder can Open
With → Lumber, and `tiny.store` remembering the last tailed file.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Lumber.app
```

Keys: type anywhere to filter · **⌘F** focus filter · **esc** clear ·
click **err/warn** in the footer to show only those lines.
