# matcha 🍵

A menu-bar app that keeps your Mac awake — the canonical tinyjs *tray app*
recipe.

<img src="../_images/matcha.webp" alt="matcha screenshot" width="640">

It toggles macOS `caffeinate` on and off. **Left-click** the cup toggles;
**right-click** opens a stateful menu with live status and an "Activate for"
duration submenu that auto-stops when the time is up.

The recipe parts:

- Launches as a **menu-bar agent** — `"activation": "accessory"` in
  tinyjs.json means no Dock icon and no window flash at startup; the SF Symbol
  cup in the menu bar *is* the app.
- Opens two fixed-size windows on demand (multi-window): a little **About**
  popover and a tabbed **Settings** window (General / Duration / Battery /
  Advanced / Updates / About) persisted with `tiny.store`.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/matcha.app
```

Or skip the toolchain: **[matcha-0.1.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/matcha-0.1.0.dmg)** (4.5 MB)
is a prebuilt, signed & notarized copy — open and drag to Applications.
