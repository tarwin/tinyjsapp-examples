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
//   2. Split-brain physics — the page owns the pendulum (60 fps rAF: sway,
//      string bend, stretch, snap detection); the backend owns the WINDOW
//      (drag easing along the top, then gravity when a snapped tree falls).
//      One broadcast per two ticks carries the shared gust plus the cursor,
//      so mouse speed is a breeze every tree feels by its own distance.
//   3. The usual satellite-window kit (see coo3d): a slot pool re-dressed
//      via push instead of reopened, chrome riding along with openWindow
//      so nothing flashes white, and show({ activate: false }) everywhere
//      so hanging ornaments never steal your keyboard.

import { Lib, CFunction, StructType, types } from 'tjs:ffi';

// ------------------------------------------------- cursor, via CoreGraphics

const CoreGraphics = new Lib('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
const CoreFoundation = new Lib('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
const CGPoint = new StructType([['x', types.double], ['y', types.double]], 'CGPoint');
const CGEventCreate = new CFunction(CoreGraphics.symbol('CGEventCreate'), types.pointer, [types.pointer]);
const CGEventGetLocation = new CFunction(CoreGraphics.symbol('CGEventGetLocation'), CGPoint, [types.pointer]);
const CFRelease = new CFunction(CoreFoundation.symbol('CFRelease'), types.void, [types.pointer]);

function cursor() {
  const ev = CGEventCreate.call(null);
  const loc = CGEventGetLocation.call(ev);   // struct return — { x, y } doubles
  CFRelease.call(ev);
  return loc;
}

// ------------------------------------------------------------------- state

const TICK = 40;               // 25 fps brain
const W = 260, H = 420;        // every hanger window is the same tall strip
const SLOTS = ['main', ...Array.from({ length: 9 }, (_, i) => 't' + (i + 1))];
// frameless + transparent must ride ALONG with openWindow — chrome applied
// after the first paint flashes a white default window
const CHROME = { frame: false, trafficLights: false, transparent: true };

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
  x: 0, y: 0,       // window top-left, live (y only moves when falling)
  dragging: false,
  dragSX: 0,        // cursor screen-x the drag wants the hanger under
  falling: null,    // { vx, vy } while tumbling off the screen
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
      page: 'index.html', title: s.cfg.name, size: `${W}x${H}`,
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
  try { twin(app, s).hide(); } catch (e) {}
  setCT(app, s, true);
  trayUpdate(app, true);
  if (restock && actives().length === 0) {
    restock = false;
    hang(app);
  }
}

// Scissors across every string at once — the whole family drops. Pages get
// 'cut' so they draw the snapped stub and tumble; the windows fall here.
function cutAll(app) {
  for (const s of actives()) {
    if (s.falling) continue;
    s.dragging = false;
    s.falling = { vx: rnd(-3, 3), vy: rnd(1, 4) };
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
      // gravity belongs to the backend: the WINDOW is what falls
      s.falling.vy += 2.4;
      s.falling.vx *= 0.99;
      s.x += s.falling.vx;
      s.y += s.falling.vy;
      try { twin(app, s).setPosition(Math.round(s.x), Math.round(s.y)); } catch (e) {}
      if (s.y > screen.h + 60) gone(app, s);
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

  // The page felt the string give way. From here the window is a brick.
  snap: (p, app, meta) => {
    const s = slots.find((o) => o.winId === meta.window);
    if (!s || !s.active || s.falling) return false;
    s.dragging = false;
    s.falling = { vx: clamp((p && p.vx) || 0, -16, 16), vy: 3 };
    trayUpdate(app, true);
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

export function onTray(id, app) { onCommand(id, app); }
export function onContextMenu(id, app) { onCommand(id, app); }
export function onHotkey(id, app) { if (id === 'hang') hang(app); }

export function init() {
  // Everything starts in api.boot, once the page's listeners are up.
}

