# Beam ⚡️

<img src="icon.png" alt="beam icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/beam.webp" alt="beam screenshot" width="640">

**⬇ Download:** [beam-0.1.2.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/beam-0.1.2.dmg) **(4.5 MB)** — prebuilt, signed & notarized; open and drag to Applications.

A Raycast-lite launcher — plain JavaScript, zero dependencies.

Press **⌥Space** in any app and a frameless translucent palette drops in:

- **Launch apps** — fuzzy search over everything in `/Applications`,
  `/System/Applications` and `~/Applications`, with real app icons and the
  things you actually open floating to the top.
- **Find files** — three letters or more also queries Spotlight (`mdfind`);
  ⏎ opens, **⌘⏎** reveals in Finder.
- **Do math** — `sqrt(9)+2^10` shows `1,027` as you type; ⏎ puts the result
  on the clipboard.

↑↓ to pick, ⏎ to go, esc (or clicking anywhere else) dismisses it like a
menu. No Dock icon — just the ⚡ in the menu bar and the hotkey.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Beam.app
```

One small app, five tinyjs techniques:

1. **Global hotkey** — `app.hotkey.register('palette', 'alt+space')` +
   `onHotkey` summons the palette over whatever you're doing.
2. **Frameless vibrancy palette** — `"chrome": { "frame": false, "vibrancy":
   "menu" }`, launched as a menu-bar agent (`"activation": "accessory"`),
   hidden (never quit) on Esc or focus loss.
3. **The app index is just `tjs.readDir`** — a one-level scan of the app
   folders, re-run at most once a minute. The page pulls the whole index in
   one call and fuzzy-scores locally, so typing costs zero bridge traffic.
4. **Real icons via a `tjs.spawn` pipeline** — `plutil` reads each bundle's
   `Info.plist` to find the `.icns`, `sips` converts it to a small png cached
   in Application Support, and the page gets `data:` URIs, lazily, only for
   the rows on screen. File search is one `mdfind` per (debounced) keystroke;
   launching is `open`.
5. **`tiny.store` frecency** — per-app launch counts persist, and feed the
   fuzzy score.

Two page-side details worth stealing: the fuzzy matcher picks the *best*
alignment by dynamic programming (a greedy scan would highlight "Vi**s**ual"
when `vsc` should hit the word starts in "Visual Studio Code"), and the
calculator is a real tokenizer + recursive-descent parser — never `eval()`,
because the page holds an RPC channel with full system access. Both live in
`src/frontend/logic.js` as pure functions.
