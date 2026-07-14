# Pasta 🍝

Clipboard history in the menu bar — plain JavaScript, zero dependencies.

Copy things all day; press **⌘⇧V** anywhere (or click the tray icon) and a
frameless translucent palette drops in: type to search, ↑↓ to pick, **⏎** to
put a clip back on the clipboard, ⌘⌫ to delete one, esc to dismiss. Click
outside and it hides itself like a real menu.

One small app, five tinyjs techniques:

1. **Clipboard poller** — `pbpaste` every second via `tjs.spawn`; a change is
   upserted into SQLite (the same text again just bumps to the top and counts
   another copy).
2. **SQLite history** — txiki's built-in `tjs:sqlite`: search, dedupe
   (`ON CONFLICT … DO UPDATE`), and pruning are one query each.
3. **Global hotkey** — `app.hotkey.register('palette', 'cmd+shift+v')` +
   `onHotkey` summons the palette from any app.
4. **Frameless vibrancy palette** — `"chrome": { "frame": false, "vibrancy":
   "menu" }`, launched as a menu-bar agent (`"activation": "accessory"`),
   dismissed on focus loss.
5. **`tiny.store`** — the Pause Capturing flag survives relaunches.

Re-copying goes backend-side through `pbcopy`; the page only ever sees
previews and builds all DOM with `textContent` (clipboard text must never
become markup).

> Gotcha preserved in `src/main.js`: txiki 26.6.0's `WritableStream` promises
> for a spawned process's stdin never settle, so piping into `pbcopy` and
> awaiting would hang the api call — Pasta feeds it through a self-deleting
> scratch file instead.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Pasta.app
```

History lives in `~/Library/Application Support/com.example.pasta/history.db`
(newest 500 clips).
