# Magik Treez™ 🌲

Car air fresheners for your desktop. Off the gas-station spinner rack and
onto your screen: each Treez hangs from the top edge on a little string,
sways in a breeze that's never quite the same for any two of them, and
smells (we assume) fantastic. It starts with one; hang up to ten from the
🌲 menu-bar item (or **⌃⌥T**) — every one out of the pack is a random
design, size, and shade.

You can grab one and drag it along the top of the screen — the string bends
and trails as you carry it. But pull DOWN too far and the string *snaps*:
the tree tumbles off the bottom of the screen and it's gone forever. That's
the whole lifecycle. **📦 Fresh pack** cuts every string at once and hangs a
single new one in the wreckage's place.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Magik Treez.app
```

Or skip the toolchain: **[treez-0.1.0.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/treez-0.1.0.dmg)** (4.2 MB) is
a prebuilt, signed & notarized copy — open and drag to Applications.

The rack: **Forest Fresh** (the classic pine), **Vanillaroma**, **Cherry
Blast**, **Grape Ape**, **Bubblegum**, **Ocean Mist**, and **New Car Smell**
— all drawn as chunky outlined canvas shapes, hue-nudged per tree so two of
the same scent are never the same color.

## Hover-only click-through

Everything hanging is a tall transparent window, and a window you can grab
is a window that eats clicks — normally. The trick here: every hanger is
**click-through by default**, and the backend (which watches the global
cursor over FFI anyway) flips `setClickThrough(false)` only while the
cursor is actually over the cardboard, then back the moment it leaves. You
can always grab a tree, yet the empty air around it never steals a click
from the app behind it. (While a drag is live the window stays interactive
regardless of where the cursor wanders.)

## Split-brain physics

The page owns the string: a damped pendulum stepped at 60 fps — gravity,
per-tree flutter, a shared gust everybody modulates with their own phase
(so the family sways *together but not in step*), and the breeze your
cursor stirs up: the backend broadcasts cursor position + speed each tick,
and every tree feels it by its own distance. The cardboard has a lagging
second hinge, so it flexes a beat behind the swing.

The backend owns the window: while you drag, it eases the whole hanger
after your hand (the lag is what bends the string), and after a snap it
takes over with gravity — the page just spins the tree and lets the two
ends of the broken string do their brief drama. Snapping is the page's
call: past ~1.5× the string's length, pulled downward, a few frames of
grace for sideways yanks… *snip*.

The windows are a slot pool (up to ten): a fallen tree's window hides, and
the next one out of the pack re-dresses the same page over a push — no
reopen, no white flash (chrome rides along with `app.openWindow`, a lesson
from [coo3d](../coo3d/README.md)). Sound effects are all synthesized in
place with WebAudio — the drop-in boing, strain creaks that quicken as you
pull, and the snap (a snip of filtered noise plus a sad descending pluck).

One macOS note: ask for `y=0` and a floating window is parked just below
the menu bar (34 px on a notched screen). The backend reads back the real
frame after showing, so the grab zone, the fall, and the page's breeze math
all agree with what's on screen — the string simply emerges from under the
menu bar, which looks right anyway.

Not affiliated with any actual pine-scented product. No refunds.
