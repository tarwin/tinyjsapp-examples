# worldclock 🌏

A menu-bar world clock.

<img src="../_images/worldclock.webp" alt="worldclock screenshot" width="640">

The tray title **cycles through your cities** every few seconds (`tray.set`
each tick — "Tokyo 4:45p" → "London 8:45p" → …), and a left-click drops a
small **vibrancy panel** (`"chrome": { "vibrancy": "popover" }`) just under
the menu bar listing every city's live time, day offset, and a day/night dot.
It **dismisses itself on focus loss** like a real popover (the page's `window`
blur).

One neat wrinkle: txiki.js has no `Intl`, so the WebKit page computes each
zone's DST-correct UTC offset and hands the backend a table — the frontend
knows the zones, the backend owns the tick.

Launches as a menu-bar agent (`"activation": "accessory"`).

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/worldclock.app
```

Or skip the toolchain: **[worldclock-0.1.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/worldclock-0.1.0.dmg)** (4.6 MB)
is a prebuilt, signed & notarized copy — open and drag to Applications.
