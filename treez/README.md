# Magik Treez™ 🌲

<img src="icon.png" alt="treez icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/treez.webp" alt="treez screenshot" width="640">

**⬇ Download:** [treez-0.1.1.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/treez-0.1.1.dmg) **(4.2 MB)** — prebuilt, signed & notarized; open and drag to Applications.

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
regardless of where the cursor wanders; the moment a string snaps the
window goes click-through for good — a falling tree can't eat a click.)

Two finishing touches: every window sets `chrome: { acceptsFirstMouse:
true }` (tinyjs 0.22.5), so the click that lands on a tree grabs it even
when some other app is focused — no dead "activating" click first. And the
zone only *arms* the grab; the page still does an honest rotated hit test
against the cardboard before a mousedown counts.

## Split-brain physics

The page owns the string: a damped pendulum stepped at 60 fps — gravity,
per-tree flutter, a shared gust everybody modulates with their own phase
(so the family sways *together but not in step*), and the breeze your
cursor stirs up: the backend broadcasts cursor position + speed each tick,
and every tree feels it by its own distance. The cardboard has a lagging
second hinge, so it flexes a beat behind the swing.

The backend owns the window only while you **drag**: it eases the whole
hanger after your hand, and the lag is what bends the string. Snapping is
the page's call: past ~1.5× the string's length, pulled downward, a few
frames of grace for sideways yanks… *snip*.

The **fall** never moves the window at all. Every hanger is a strip running
the *full height of the screen* — all that transparent air below the tree
is click-through, so it costs nothing — and a snapped tree is just canvas
animation: 60 fps gravity tumbling down a window that stays exactly where
it is (moving the window itself from the backend's 25 fps brain looked like
a shudder). When the tree clears the bottom edge the page reports `fell`
and the backend puts the window away.

The windows are a slot pool (up to ten): a fallen tree's window hides, and
the next one out of the pack re-dresses the same page over a push — no
reopen, no white flash (chrome rides along with `app.openWindow`, a lesson
from [coo3d](../coo3d/README.md)). One trap in that drawer: `hide()` on the
**main** window is *NSApp hide* — it hides the whole app, every tree at
once (and stalls their rAF mid-fall). So a spent main window isn't hidden
at all: a transparent, click-through, empty strip is already invisible, and
it just waits as a ghost until the pack re-dresses it. Sound effects are
all synthesized in place with WebAudio — the drop-in boing, strain creaks
that quicken as you pull, and the snap (a snip of filtered noise plus a sad
descending pluck).

One macOS note: ask for `y=0` and a floating window is parked just below
the menu bar (34 px on a notched screen). The backend reads back the real
frame after showing, so the grab zone, the fall, and the page's breeze math
all agree with what's on screen — the string simply emerges from under the
menu bar, which looks right anyway.

Not affiliated with any actual pine-scented product. No refunds.
