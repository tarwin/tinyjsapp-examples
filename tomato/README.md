# tomato 🍅

A silly, tomato-shaped Pomodoro timer — the canonical *transparent window* +
live-tray recipe.

<img src="../_images/tomato.webp" alt="tomato screenshot" width="640">

The window is **transparent and frameless**, so what floats on your desktop is
just a round googly-eyed tomato — no square edges anywhere. The countdown
ticks live in the **menu-bar title** (`tray.set` every second), and pausing
swaps Pause↔Resume **in place** (`menu.update` — no full menu repaint). When a
phase ends, a **notification** fires, and clicking it pops the tomato back up
(`onNotificationClick`).

Launches as a menu-bar agent (`"activation": "accessory"` — no Dock icon, the
tray is the app).

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/tomato.app
```

Or skip the toolchain: **[tomato-0.1.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/tomato-0.1.0.dmg)** (4.5 MB)
is a prebuilt, signed & notarized copy — open and drag to Applications.
