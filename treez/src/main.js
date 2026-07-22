// Magik Treez™ — a family of car air fresheners for your desktop. Each one
// hangs from the top of the screen on a little string, sways in a breeze
// that's never quite the same for any two of them, and can be grabbed and
// dragged along the top edge… gently. Pull one DOWN too far and the string
// snaps: the tree tumbles off the bottom of the screen and it's gone. Hang
// a fresh one from the tray (they come out of the pack at random).
//
// The techniques on show:
//
//   1. Hover-only click-through — every hanger window is click-through by
//      DEFAULT, but the backend watches the global cursor over FFI and
//      flips setClickThrough(false) only while you're actually over the
//      cardboard. You can grab a tree, yet the (mostly empty) transparent
//      window around it never eats a click meant for the app behind it.
//      A snapped tree goes click-through for good — nothing falling ever
//      steals a click. And every window sets acceptsFirstMouse, so the
//      click that lands on a tree grabs it even when another app is
//      focused — no dead activating click.
//   2. Split-brain physics — the page owns the pendulum (60 fps rAF: sway,
//      string bend, stretch, snap detection) AND the fall: each hanger is a
//      full-screen-height strip, so a snapped tree is just canvas animation
//      tumbling down a window that never moves — no 25 fps setPosition
//      shudder. The backend owns the window only while you DRAG (easing
//      along the top edge); when the page says 'fell', the window hides.
//      One broadcast per two ticks carries the shared gust plus the cursor,
//      so mouse speed is a breeze every tree feels by its own distance.
//   3. The usual satellite-window kit (see coo3d): a slot pool re-dressed
//      via push instead of reopened, chrome riding along with openWindow
//      so nothing flashes white, and show({ activate: false }) everywhere
//      so hanging ornaments never steal your keyboard.

import { Lib, CFunction, StructType, types } from 'tjs:ffi';

// ------------------------------------------------- cursor, per-platform
//
// macOS reads the global cursor straight from CoreGraphics via FFI —
// synchronous, no permission, top-left origin (the space win.setPosition and
// setClickThrough's grab zone speak). Windows has no CoreGraphics, so there
// treez asks the framework instead: app.mousePosition() answers in those same
// top-left coordinates. It's async, so boot() polls it into `winCursor` every
// brain tick and cursor() returns that cached value — the 25 fps brain stays
// synchronous and every line below is untouched. (Only `new Lib('/System/…')`
// breaks on Windows; importing tjs:ffi itself is fine on both platforms.)

const IS_WIN = tjs.env.OS === 'Windows_NT';

let cursor;                        // () => { x, y } in setPosition coordinates
let winCursor = { x: 0, y: 0 };    // Windows: last value polled from the backend

if (IS_WIN) {
  cursor = () => winCursor;
} else {
  const CoreGraphics = new Lib('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const CoreFoundation = new Lib('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const CGPoint = new StructType([['x', types.double], ['y', types.double]], 'CGPoint');
  const CGEventCreate = new CFunction(CoreGraphics.symbol('CGEventCreate'), types.pointer, [types.pointer]);
  const CGEventGetLocation = new CFunction(CoreGraphics.symbol('CGEventGetLocation'), CGPoint, [types.pointer]);
  const CFRelease = new CFunction(CoreFoundation.symbol('CFRelease'), types.void, [types.pointer]);
  cursor = () => {
    const ev = CGEventCreate.call(null);
    const loc = CGEventGetLocation.call(ev);   // struct return — { x, y } doubles
    CFRelease.call(ev);
    return loc;
  };
}

// ------------------------------------------------------------------- state

const TICK = 40;               // 25 fps brain
const W = 260;                 // every hanger is a W-wide, FULL-height strip:
                               // the fall happens inside it, the window never
                               // moves or resizes — it just hides at the end
const SLOTS = ['main', ...Array.from({ length: 9 }, (_, i) => 't' + (i + 1))];
// frameless + transparent must ride ALONG with openWindow — chrome applied
// after the first paint flashes a white default window; acceptsFirstMouse so
// the click that lands on a tree grabs it even from another app (0.22.5)
const CHROME = { frame: false, trafficLights: false, transparent: true, acceptsFirstMouse: true };

// The catalogue. `design` indexes the frontend's shape table; the names are
// what a gas-station spinner rack would call them.
const SCENTS = [
  { design: 0, name: 'Forest Fresh' },     // the classic green pine
  { design: 1, name: 'Vanillaroma' },      // chubby yellow
  { design: 2, name: 'Cherry Blast' },     // red starburst
  { design: 3, name: 'Grape Ape' },        // purple berry cluster
  { design: 4, name: 'Bubblegum' },        // pink scalloped pine
  { design: 5, name: 'Ocean Mist' },       // blue spiky fuzz
  { design: 6, name: 'New Car Smell' },    // squat amber pine, somehow
];

let screen = { w: 1440, h: 900 };
let opts = { sound: true };    // persisted; everything else is a fresh pack
let t = 0;
let timer = null;
let restock = false;           // fresh pack: once the floor clears, hang one
const ready = new Set();       // windows whose pages have booted
const opened = new Set();      // satellite windows that have been openWindow'd

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// Ten hooks along the top of the screen; a slot outlives its tree. When a
// tree falls, the window just hides — hanging a new one re-dresses the same
// page with a fresh cfg over push (no reopen, no flash).
const slots = SLOTS.map((winId) => ({
  winId,
  active: false,
  cfg: null,        // { design, name, scale, L, jit, phase }
  x: 0, y: 0,       // window top-left, live
  dragging: false,
  dragSX: 0,        // cursor screen-x the drag wants the hanger under
  falling: null,    // { until } while the PAGE animates the tumble
  ct: undefined,    // current click-through state, so we only flip on change
}));

const twin = (app, s) => (s.winId === 'main' ? app : app.window(s.winId));
const actives = () => slots.filter((s) => s.active);

// Every tree off the rack is its own: a design, a size, a hue nudge (so two
// Forest Fresh are never the same green), a string length ("not too far in"
// — they hang near the top), and a private sway phase.
function makeCfg() {
  const sc = SCENTS[Math.floor(Math.random() * SCENTS.length)];
  return {
    design: sc.design,
    name: sc.name,
    scale: +rnd(0.6, 1.25).toFixed(2),
    L: Math.round(rnd(70, 150)),
    jit: Math.round(rnd(-14, 14)),
    phase: +rnd(0, 6.28).toFixed(2),
  };
}

// A spot on the rail with some elbow room, if the rail has any left.
function pickX() {
  const taken = actives().map((s) => s.x);
  for (let i = 0; i < 24; i++) {
    const x = Math.round(rnd(6, screen.w - W - 6));
    if (taken.every((o) => Math.abs(o - x) > 165)) return x;
  }
  return Math.round(rnd(6, screen.w - W - 6));
}

// We ask for y=0, but macOS parks a floating window just below the menu bar
// (34 on a notched screen) — the string still reads as "from the top", it
// just emerges from under the bar. Read back where the window REALLY is so
// the grab zone, the fall, and the page's breeze math all share the truth.
function syncPos(app, s) {
  const q = s.winId === 'main' ? app.getWinState() : twin(app, s).getState();
  q.then((st) => {
    if (!Number.isFinite(st.y) || s.falling) return;
    s.x = st.x;
    s.y = st.y;
    app.push('wpos', { who: s.winId, x: Math.round(s.x), y: Math.round(s.y) });
  }).catch(() => {});
}

// ----------------------------------------------------------- click-through

function setCT(app, s, on) {
  if (s.ct === on) return;
  s.ct = on;
  try { twin(app, s).setClickThrough(on); } catch (e) {}
}

// Is the cursor over the cardboard (roughly)? The zone is the tree's swing
// box: knot to bottom tip, plus sway margin. Inside it the window takes the
// mouse; everywhere else the window is a ghost.
function overTree(s, m) {
  const c = s.cfg;
  const ax = s.x + W / 2;
  return (
    m.x > ax - (80 * c.scale + 38) && m.x < ax + (80 * c.scale + 38) &&
    m.y > s.y + c.L * 0.3 && m.y < s.y + c.L + 172 * c.scale
  );
}

// -------------------------------------------------------------------- tray

let lastTray = '';
function trayUpdate(app, force) {
  const n = actives().length;
  const sig = n + ':' + opts.sound;
  if (!force && sig === lastTray) return;   // tray.set repaints — only on change
  lastTray = sig;
  const tick = (on) => (on ? '✓ ' : '   ');
  app.tray.set({
    title: '🌲',
    menu: [
      { id: 'hang', label: '🌲 Hang another Treez  ⌃⌥T', enabled: n < SLOTS.length },
      { id: 'stock', label: `${n} of ${SLOTS.length} hanging`, enabled: false },
      { separator: true },
      { id: 'fresh', label: '📦 Fresh pack (cut them all down, hang one)' },
      { id: 'sound', label: tick(opts.sound) + '🔊 Sound effects' },
      { separator: true },
      { id: 'check-updates', label: 'Check for Updates…' },
      { id: 'quit', label: 'Quit Magik Treez' },
    ],
  });
}

// ------------------------------------------------------------------- hooks

function hang(app) {
  const s = slots.find((o) => !o.active);
  if (!s) return;
  s.active = true;
  s.cfg = makeCfg();
  s.x = pickX();
  s.y = 0;
  s.dragging = false;
  s.falling = null;
  if (s.winId !== 'main' && !opened.has(s.winId)) {
    opened.add(s.winId);
    app.openWindow(s.winId, {
      page: 'index.html', title: s.cfg.name, size: `${W}x${screen.h}`,
      chrome: CHROME, x: s.x, y: s.y,
    });
    // its boot call shows it and takes the cfg home
  } else {
    try {
      const w = twin(app, s);
      w.setPosition(s.x, s.y);
      w.show({ activate: false });
    } catch (e) {}
    app.push('tree', { who: s.winId, cfg: s.cfg, x: s.x, y: s.y });
    syncPos(app, s);
  }
  trayUpdate(app, true);
}

// The tree hit the pavement (well, left the screen). The window goes back in
// the drawer; the slot is free for the next one out of the pack.
function gone(app, s) {
  s.active = false;
  s.falling = null;
  s.dragging = false;
  // hide() on the MAIN window is NSApp hide — it would take every other
  // tree down with it (and freeze their rAF mid-fall). An empty strip is
  // transparent + click-through = already invisible, so the main window
  // just stays up as a ghost; satellites really hide.
  if (s.winId !== 'main') { try { twin(app, s).hide(); } catch (e) {} }
  setCT(app, s, true);
  trayUpdate(app, true);
  if (restock && actives().length === 0) {
    restock = false;
    hang(app);
  }
}

// Scissors across every string at once — the whole family drops. Pages get
// 'cut', animate their own tumble, and report 'fell'; here we just make each
// one a ghost (a falling tree must never eat a click) and hold a backstop.
function cutAll(app) {
  for (const s of actives()) {
    if (s.falling) continue;
    s.dragging = false;
    s.falling = { until: t + 250 };   // ~10 s backstop if 'fell' never comes
    setCT(app, s, true);
    app.push('cut', { who: s.winId });
  }
  restock = true;
  trayUpdate(app, true);
}

// ------------------------------------------------------------------- brain

let lastM = { x: 0, y: 0 };

function tick(app) {
  t++;
  const m = cursor();
  const mvx = m.x - lastM.x;   // cursor horizontal speed, px per tick — wind
  lastM = m;

  for (const s of actives()) {
    if (!ready.has(s.winId)) continue;

    if (s.falling) {
      // the PAGE owns the fall (60 fps canvas inside its full-height,
      // never-moving window) — we only hold a backstop in case its
      // 'fell' report never arrives
      if (t >= s.falling.until) gone(app, s);
      continue;
    }

    if (s.dragging) {
      // carry the whole hanger after the cursor with a lag — the page turns
      // that lag into string tilt. wpos rides along so the page can keep
      // mapping the (global) cursor into its own moving window.
      const targetX = clamp(s.dragSX - W / 2, 0, screen.w - W);
      s.x += (targetX - s.x) * 0.2;
      try { twin(app, s).setPosition(Math.round(s.x), Math.round(s.y)); } catch (e) {}
      app.push('wpos', { who: s.winId, x: Math.round(s.x), y: Math.round(s.y) });
      setCT(app, s, false);
    } else {
      setCT(app, s, !overTree(s, m));
    }
  }

  // One broadcast for the weather: a slow shared gust (every tree modulates
  // it with its own phase — similar, never identical) plus where the cursor
  // is and how fast it's going, so each page brews its own local breeze.
  if (t % 2 === 0) {
    const g = Math.sin(t * 0.011) * 0.5 + Math.sin(t * 0.0043 + 1.7) * 0.5;
    app.push('wind', {
      g: +g.toFixed(3),
      mx: Math.round(m.x), my: Math.round(m.y),
      vx: +mvx.toFixed(1),
    });
  }

  // Screens change (lids close, displays plug in) — re-measure now and then.
  if (t % 250 === 0) {
    app.getWinState().then((st) => {
      screen = { w: st.screen.width, h: st.screen.height };
    }).catch(() => {});
  }
}

// --------------------------------------------------------------------- api

export const api = {
  boot: async (_p, app, meta) => {
    const id = meta.window;

    if (id === 'main' && !ready.has('main')) {
      if (IS_WIN && !timer) {
        // No FFI cursor on Windows — poll the backend into winCursor. Seed it
        // once before lastM = cursor() below, then refresh it every brain tick.
        const pollCursor = async () => {
          try { const p = await app.mousePosition(); if (p) winCursor = { x: p.x, y: p.y }; }
          catch { /* transient — keep the last known position */ }
        };
        await pollCursor();
        setInterval(pollCursor, TICK);
      }
      opts = Object.assign(opts, (await app.store.get('opts')) || {});
      const st = await app.getWinState();
      screen = { w: st.screen.width, h: st.screen.height };
      lastM = cursor();
      // out of the pack: exactly one tree to start with
      const s = slots[0];
      s.active = true;
      s.cfg = makeCfg();
      s.x = pickX();
      s.y = 0;
      app.setSize(W, screen.h);   // full-height strip — the fall lives inside
      app.setPosition(s.x, s.y);
      app.setAlwaysOnTop(true);
      app.setLevel('floating');
      app.setResizable(false);
      app.show({ activate: false });    // accessory apps start hidden — position first
      app.setContextMenu([
        { id: 'hang', label: '🌲 Hang another Treez' },
        { separator: true },
        { id: 'quit', label: 'Quit Magik Treez' },
      ]);
      try { app.hotkey.register('hang', 'ctrl+alt+t'); } catch { /* taken — the menu still works */ }
      trayUpdate(app, true);
      if (!timer) {
        timer = setInterval(() => {
          try { tick(app); } catch (e) { console.log('treez tick:', e); }
        }, TICK);
      }
    }

    // chrome and position already rode along with openWindow (setting them
    // after the first paint flashes a white default window)
    if (id !== 'main' && !ready.has(id)) {
      const s = slots.find((o) => o.winId === id);
      const w = app.window(id);
      w.setAlwaysOnTop(true);
      w.setLevel('floating');
      w.setResizable(false);
      w.setPosition(Math.round(s.x), Math.round(s.y));
      w.show({ activate: false });
    }

    ready.add(id);
    const s = slots.find((o) => o.winId === id);
    setCT(app, s, true);          // ghost until the cursor is on the cardboard
    syncPos(app, s);              // macOS may have parked us below the menu bar
    return { cfg: s.cfg, x: s.x, y: s.y, sound: opts.sound, active: s.active };
  },

  // The page reports the grab; the backend carries the hanger. sx is the
  // cursor's global screen-x — the page reads it off the MouseEvent.
  drag: (p, app, meta) => {
    const s = slots.find((o) => o.winId === meta.window);
    if (!s || !s.active || s.falling) return false;
    if (p.phase === 'start') {
      s.dragging = true;
      s.dragSX = p.sx;
      setCT(app, s, false);
    } else if (p.phase === 'move') {
      s.dragSX = p.sx;
    } else {
      s.dragging = false;
    }
    return true;
  },

  // The page felt the string give way. It animates the tumble itself; from
  // here the window is a ghost (click-through) until 'fell' hides it.
  snap: (_p, app, meta) => {
    const s = slots.find((o) => o.winId === meta.window);
    if (!s || !s.active || s.falling) return false;
    s.dragging = false;
    s.falling = { until: t + 250 };   // ~10 s backstop if 'fell' never comes
    setCT(app, s, true);
    trayUpdate(app, true);
    return true;
  },

  // The tree cleared the bottom of the screen — put the window away.
  fell: (_p, app, meta) => {
    const s = slots.find((o) => o.winId === meta.window);
    if (s && s.active && s.falling) gone(app, s);
    return true;
  },
};

function onCommand(id, app) {
  if (id === 'hang') hang(app);
  else if (id === 'fresh') cutAll(app);
  else if (id === 'sound') {
    opts.sound = !opts.sound;
    app.store.set('opts', opts);
    app.push('opts', { sound: opts.sound });
    trayUpdate(app, true);
  } else if (id === 'quit') app.quit();
}

export function onTray(id, app) {
  if (id === 'check-updates') return checkForUpdates(app); onCommand(id, app); }
export function onContextMenu(id, app) { onCommand(id, app); }
export function onHotkey(id, app) { if (id === 'hang') hang(app); }

export function init() {
  // Everything starts in api.boot, once the page's listeners are up.
}



// ── self-update (uniform across the examples) ──────────────────────────────
// The runtime does the real work (sha256 + signature verified, swap +
// relaunch). "Check for Updates…" runs this; the daily background check
// just taps you on the shoulder via a notification.
async function checkForUpdates(app) {
  try {
    const r = await app.update.check();
    if (r && r.available) {
      app.notify('Updating…', 'v' + r.latest + ' is downloading — the app will relaunch.');
      await app.update.install();
    } else {
      app.notify("You're up to date", 'v' + ((r && r.current) || '') + ' is the latest.');
    }
  } catch (e) {
    app.notify('Update check failed', String((e && e.message) || e));
  }
}

export function onUpdateAvailable(info, app) {
  app.notify('Update available', 'v' + info.latest + ' is ready — use "Check for Updates…" to install.');
}
