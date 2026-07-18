# worldclock 🌏

<img src="icon.png" alt="worldclock icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/worldclock.webp" alt="worldclock screenshot" width="640">

**⬇ Download:** [worldclock-0.2.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/worldclock-0.2.0.dmg) **(4.7 MB)** — prebuilt, signed & notarized; open and drag to Applications.

A menu-bar world clock.

The tray shows your **home city as an emoji** — "🌉 4:45p" — updated every
second (`tray.set` each tick), and a left-click drops a small **vibrancy
panel** (`"chrome": { "vibrancy": "popover" }`) just under the menu bar
listing every city's live time, day offset, and a day/night dot. It
**dismisses itself on focus loss** like a real popover (the page's `window`
blur). Turn on **cycling** (▶ in the panel, or the tray menu) and the menu
bar rotates through every city — "🗼 4:45p" → "🎡 8:45p" → …

The city list is **yours to edit**: ＋ opens a little form — pick any IANA
time zone (autocompleted from `Intl.supportedValuesOf`), give it a label and
its own emoji — and a hover ✕ removes any row. The table persists in the
backend store.

One neat wrinkle: txiki.js has no `Intl`, so the WebKit page computes each
zone's DST-correct UTC offset and hands the backend a table — the frontend
knows the zones, the backend owns the tick.

Launches as a menu-bar agent (`"activation": "accessory"`).

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/worldclock.app
```
