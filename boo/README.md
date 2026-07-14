# Boo 👻

A shy little ghost that lives on your desktop. Plain JavaScript, zero
dependencies.

The transparent, frameless window **is** the pet: boo wanders the screen by
moving its own window, so the rest of your desktop stays completely normal.
Get your cursor too close and it runs away; corner it against a screen edge
and it *poofs* — vanishes and reappears somewhere safer. Ignore it long
enough and it falls asleep.

To make friends, hold out a cookie (the 👻 menu-bar item, right-click on
boo, or **⌃⌥C** anywhere): your cursor becomes the treat, and boo creeps
over in nervous little bursts — scurry, freeze, scurry — to eat it. A fed
ghost follows your cursor around like a puppy for a while and lets you pet
it (slow strokes, hearts). Every cookie also grows a persistent **trust**
stat (★☆☆☆☆ in the menu), which permanently shrinks its flee radius: boo
gets braver the longer you live together.

The techniques on show:

1. **FFI** — the global cursor position comes straight from CoreGraphics
   (`tjs:ffi` → `CGEventGetLocation`), so boo knows where your mouse is
   without any helper process or Accessibility permission — and the
   coordinates are top-left origin, the same space `win.setPosition` speaks.
2. **A window that moves itself** — the backend runs a 25 fps brain tick
   and calls `app.setPosition` when boo walks; the page never changes, the
   *window* is the sprite. The page is just the costume: a CSS/SVG ghost
   whose pupils ease toward whatever the backend says boo is looking at.
3. **Menu-bar pet** — `"activation": "accessory"` (no Dock icon), a tray
   title that is boo's live mood (👻 🍪 ❤️ 💤), a global hotkey, and
   `tiny.store` keeping trust across launches.

The brain is a tiny state machine — idle / wander / flee / creep / eat /
happy / sleep / poof — and it's fully testable without the window: the repo
pattern of a page-driven `api.boot` means you can import `main.js` under
plain `tjs` with a stub `app`, warp the real cursor around with
`CGWarpMouseCursorPosition`, and watch the states fire.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/Boo.app — a ghost in 6 MB
```
