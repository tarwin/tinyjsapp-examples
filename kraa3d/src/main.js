// Kraa 3D — kraa's two ravens, reincarnated as skinned, animated 3D crows.
// The brain in this file is kraa's, nearly line for line: each bird IS a
// frameless transparent window that walks itself around the screen, pecks,
// preens, caws at its mate, and takes wing when crowded or bored. Scatter
// seed (menu bar 🐦‍⬛, or ⌃⌥S) and the flock flies in; finished piles grow a
// persisted `trust` stat, and trusted crows start following your cursor.
// What changed is entirely in the frontend: the SVG puppet is now a rigged
// GLB rendered by three.js, with real flap/glide/walk/preen clips.
//
// The techniques on show:
//
//   1. Three windows, one brain — the main window is Huginn, `app.openWindow`
//      makes Muninn (same index.html) and the seed pile (seed.html). One
//      25 fps backend tick steers all of them: per-window setPosition via
//      app.window(id), broadcast pushes tagged with `who` so each page only
//      wears its own state.
//   2. FFI — the global cursor position comes straight from CoreGraphics
//      (`tjs:ffi` → CGEventGetLocation), so the ravens can keep an eye on
//      your mouse without touching any window. Same trick as boo.
//   3. A tiny flock — the birds are the same state machine with different
//      constants (Muninn is bolder and quicker on the wing), plus a little
//      cohesion: strays wander back toward their mate, and one raven's
//      "kraa!" often gets an answer.

import { Lib, CFunction, StructType, types } from 'tjs:ffi';

// ------------------------------------------------- cursor, per-platform
//
// macOS reads the global cursor straight from CoreGraphics via FFI —
// synchronous, no permission, top-left origin (the space setPosition speaks).
// Windows and Linux have no CoreGraphics, so there kraa asks the framework instead:
// app.mousePosition() answers in those same top-left, logical CSS-pixel
// coordinates. It's async, so boot() polls it into `winCursor` every brain
// tick and cursor() returns that cached value — the brain stays synchronous
// and every line below is untouched. (Only `new Lib('/System/…')` breaks off
// macOS; importing tjs:ffi itself is fine on all three.)

const IS_WIN = tjs.env.OS === 'Windows_NT';
// The CoreGraphics cursor below is macOS-only, so Linux takes the same
// polled-backend path Windows does. (X11 reports a real pointer position;
// Wayland hides the global pointer and answers 0,0.)
const IS_MAC = !IS_WIN && !/linux/i.test(globalThis.navigator?.platform ?? '');

let cursor;                        // () => { x, y } in setPosition coordinates
let winCursor = { x: 0, y: 0 };    // Windows: last value polled from the backend

if (!IS_MAC) {
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

const TICK = 40;              // 25 fps brain
const WIN = 200;              // crow window size — bird sits centered
const HALF = WIN / 2;
const PET_R = 64;             // cursor within this of a bird's center → its
                             // window turns solid so a poke can land; anywhere
                             // else the bird stays click-through and clicks
                             // fall to whatever is behind it (the crow fills
                             // only the middle of its 200px window — the
                             // transparent margin must never eat clicks)
const TOP = 26;               // stay out of the menu bar
const SEEDS = 10;             // pecks in a pile

let screen = { w: 1440, h: 900 };
let trust = 0;                // 0..5, persisted — seed piles finished, capped
let opts = {                  // persisted tray toggles
  ghost: false,               // click-through: mouse events pass through the birds
  desk: false,                // live ON the desktop (behind windows) vs float above
  volume: 'medium',           // how loud the kraa is: off | low | medium | high
  shhh: false,                // library mode — only the occasional sound slips out
  grounded: false,            // ground business stays near the screen bottom
};
const VOLS = { off: 0, low: 0.25, medium: 0.6, high: 1 };
let seeds = null;             // { x, y, count } — pile position, screen coords
let t = 0;
let timer = null;
const ready = new Set();      // windows whose pages have booted

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// Two of the same bird, different dials. Muninn is the bold one.
function makeBird(i, winId) {
  return {
    i, winId,
    pos: { x: 260 + i * 420, y: 520 },       // window top-left, live
    vel: { x: 0, y: 0 },
    dir: i ? -1 : 1,                         // 1 facing right, -1 left
    state: 'idle',    // idle | walk | hop | peck | preen | caw | fly | land | eat
    stateT: 0,
    dur: 0,           // how long the current peck/preen/caw runs
    idleFor: rnd(40, 160),
    walkTo: null, flyTo: null, hopTo: null,
    scared: false,    // this flight is a getaway, not a commute
    noticeIn: 0,      // reaction ticks before a fresh pile registers
    followLeft: 0,    // ticks of tagging along with the cursor
    fedGlow: 0,       // recently fed — brave and friendly
    cawCool: 0, replyIn: 0,
    through: true,    // window currently passes clicks through (see setThrough)
    speed: i ? 1.12 : 1,
    bold: i ? 1.3 : 1,
  };
}
const birds = [makeBird(0, 'main'), makeBird(1, 'r2')];

const bwin = (app, b) => (b.winId === 'main' ? app : app.window(b.winId));

// Wild animals keep their distance — less so as trust grows, much less so
// when there's food involved.
function fleeRadius(b) {
  let r = Math.max(55, 180 - trust * 24) / b.bold;
  if (b.state === 'eat' || b.fedGlow > 0) r *= 0.55;
  else if (seeds && b.noticeIn === 0) r *= 0.75;
  return r;
}

// ------------------------------------------------------------------- moods

function setState(app, b, s) {
  if (b.state === s) return;
  b.state = s;
  b.stateT = 0;
  app.push('bird', { who: b.winId, state: s });
}

// Per-bird click-through, flipped only on a real change — setClickThrough is a
// bridge round-trip, so don't re-send the same state every 40 ms tick.
function setThrough(app, b, want) {
  if (b.through === want) return;
  b.through = want;
  try { bwin(app, b).setClickThrough(want); } catch (e) {}
}

const mood = () =>
  seeds ? '🌾' : birds.some((b) => b.followLeft > 0) ? '❤️' : '🐦‍⬛';

let lastTray = '';
function trayUpdate(app) {
  const sig = mood() + !!seeds + trust + opts.ghost + opts.desk + opts.volume + opts.shhh + opts.grounded;
  if (sig === lastTray) return;            // tray.set repaints — only on change
  lastTray = sig;
  const tick = (on) => (on ? '✓ ' : '   ');
  app.tray.set({
    title: mood(),
    menu: [
      { id: 'seed', label: seeds ? '🧹 Sweep up the seed' : '🌾 Scatter some seed  ⌃⌥S' },
      { id: 'find', label: '👋 Where are the crows?' },
      { separator: true },
      { id: 'ghost', label: tick(opts.ghost) + '👻 Click-through (pokes pass through)' },
      { id: 'desk', label: tick(opts.desk) + '🖥️ Live on the desktop' },
      { id: 'grounded', label: tick(opts.grounded) + '🌱 Grounded (keep to the bottom)' },
      { id: 'vol', label: '🔊 Kraa volume', submenu: [
        { id: 'vol-off', label: 'Off', checked: opts.volume === 'off' },
        { id: 'vol-low', label: 'Low', checked: opts.volume === 'low' },
        { id: 'vol-medium', label: 'Medium', checked: opts.volume === 'medium' },
        { id: 'vol-high', label: 'High', checked: opts.volume === 'high' },
        { separator: true },
        { id: 'shhh', label: '🤫 Shhhhh (only the odd kraa)', checked: opts.shhh },
      ]},
      { separator: true },
      { id: 'trust', label: 'trust  ' + '★'.repeat(trust) + '☆'.repeat(5 - trust), enabled: false },
      { separator: true },
      { id: 'check-updates', label: 'Check for Updates…' },
      { id: 'quit', label: 'Quit Kraa 3D' },
    ],
  });
}

// Window level, applied to the whole flock. Click-through starts ON for every
// window: the seed pile is ALWAYS click-through (food should never eat your
// clicks) and the birds pass clicks through too — the brain (setThrough) makes
// a bird solid only for the instant the cursor is on its body, so a poke can
// land, then lets clicks fall through again. Otherwise the two roaming 200px
// windows would swallow clicks in their big transparent margins as they wander
// under the cursor ("randomly steals cursors"). Ghost mode keeps a bird
// click-through even on its body, so pokes fall through too (tray = way back).
function applyOpts(app) {
  for (const id of ['main', 'r2', 'seed']) {
    const w = id === 'main' ? app : app.window(id);
    try { w.setClickThrough(true); } catch (e) {}
    try {
      if (opts.desk) { w.setAlwaysOnTop(false); w.setLevel('desktop'); }
      else { w.setLevel('floating'); w.setAlwaysOnTop(true); }
    } catch (e) {}
  }
  for (const b of birds) b.through = true;   // let the next tick re-evaluate
  app.store.set('opts', opts);
}

// ------------------------------------------------------------------- moves

// Grounded mode: anything that stands, walks, hops, or lands does it in a
// strip along the bottom of the screen — the sky stays open for flying.
const groundY = (y) =>
  opts.grounded ? clamp(y, screen.h - WIN - 70, screen.h - WIN) : y;

function farSpot(m) {
  for (let i = 0; i < 24; i++) {
    const p = { x: rnd(0, screen.w - WIN), y: groundY(rnd(TOP, screen.h - WIN)) };
    if (Math.hypot(m.x - p.x - HALF, m.y - p.y - HALF) > 340) return p;
  }
  return { x: screen.w / 2 - HALF, y: groundY(screen.h / 2 - HALF) };
}

// Where a bird sits left-to-right on the screen, as a stereo pan.
const cawPan = (b) => +(((b.pos.x + HALF) / screen.w) * 2 - 1).toFixed(2);

// What a sound actually plays at: the tray volume scales it, and Shhhhh mode
// swallows most of them whole — a raven with library manners. 0 means silent.
function sayVol(base) {
  const f = VOLS[opts.volume] || 0;
  if (!f) return 0;
  if (opts.shhh && Math.random() > 0.12) return 0;
  return +(base * f).toFixed(2);
}

// One sun for the whole flock: parked way above the screen, up and to the
// right. Every page lights its bird from here relative to its own window,
// so the shading shifts as the birds move around.
const sunSpot = () => ({ x: Math.round(screen.w * 0.68), y: -520 });
const envInfo = () => ({ sun: sunSpot(), screen: { w: screen.w, h: screen.h } });

// Too close! Ravens don't poof — they take wing.
function spook(app, b, m) {
  b.followLeft = 0;
  b.scared = true;
  b.flyTo = farSpot(m);
  const v = sayVol(rnd(0.7, 1));
  app.push('say', { who: b.winId, text: '!', ...(v && { pan: cawPan(b), vol: v }) });
  setState(app, b, 'fly');
}

function startCaw(app, b, reply) {
  setState(app, b, 'caw');
  b.dur = 22;
  b.cawCool = 350;
  const v = sayVol(rnd(0.5, 1));
  app.push('say', { who: b.winId, text: 'kraa!', ...(v && { pan: cawPan(b), vol: v }) });
  if (!reply) {
    const buddy = birds[1 - b.i];
    if (buddy.cawCool === 0 && Math.random() < 0.7) buddy.replyIn = Math.round(rnd(12, 26));
  }
}

// ------------------------------------------------------------------- seed

function dropSeed(app) {
  // Grain lands wherever grain lands — somewhere out on the screen (near the
  // bottom when the flock is grounded). Both ranges keep the pile where a
  // standing bird can actually plant its feet: the window clamps at the
  // screen edges, so a pile too near the very top or bottom is unreachable.
  seeds = {
    x: rnd(80, screen.w - 80),
    y: opts.grounded ? rnd(screen.h - 115, screen.h - 60) : rnd(TOP + 180, screen.h - 60),
    count: SEEDS,
  };
  // Corvids clock a food source fast — but each bird has its own reaction time.
  for (const b of birds) b.noticeIn = Math.round(rnd(12, 70) / b.bold);
  const h = app.window('seed');
  h.setPosition(Math.round(seeds.x - 60), Math.round(seeds.y - 50));
  h.show({ activate: false });
  // showing the pile raised its window — put the birds back on top of it
  try { app.window('r2').show({ activate: false }); } catch (e) {}
  app.show({ activate: false });
  app.push('seeds', { count: seeds.count });
  lastTray = '';
  trayUpdate(app);
}

function sweepSeed(app) {
  seeds = null;
  app.window('seed').hide();
  for (const b of birds) {
    if (b.state === 'eat') { setState(app, b, 'idle'); b.idleFor = rnd(40, 120); }
  }
  lastTray = '';
  trayUpdate(app);
}

// The pile is gone and somebody's crop is full. Trust grows.
function finishPile(app) {
  seeds = null;
  app.window('seed').hide();
  trust = Math.min(5, trust + 1);
  app.store.set('trust', trust);
  for (const b of birds) {
    if (b.state !== 'eat') continue;
    b.fedGlow = Math.round(45 * (1000 / TICK));   // ~45 s of bravery
    app.push('hearts', { who: b.winId, n: 3 });
    startCaw(app, b, true);                        // a pleased rattle
  }
  lastTray = '';
  trayUpdate(app);
}

// ------------------------------------------------------------------- brain

function tickBird(app, b, m) {
  b.stateT++;
  if (b.noticeIn > 0) b.noticeIn--;
  if (b.fedGlow > 0) b.fedGlow--;
  if (b.cawCool > 0) b.cawCool--;
  if (b.replyIn > 0 && --b.replyIn === 0 && b.cawCool === 0 &&
      (b.state === 'idle' || b.state === 'walk' || b.state === 'peck')) {
    startCaw(app, b, true);
  }

  const cx = b.pos.x + HALF, cy = b.pos.y + HALF;
  const dx = m.x - cx, dy = m.y - cy;
  const d = Math.hypot(dx, dy) || 1;

  // Be a solid, clickable window ONLY while the cursor is actually on this
  // bird's body; pass clicks through everywhere else. Recomputed live from the
  // current cursor and the bird's current window centre, so there's no stale
  // hit-box and no state that can miss the re-enable — the moment the cursor
  // leaves, the next tick turns click-through back on. Ghost mode = always
  // through (even a poke falls through).
  setThrough(app, b, opts.ghost || d >= PET_R);

  // Fear first: a grounded raven that lets you too close takes off.
  if (b.state !== 'fly' && d < fleeRadius(b)) spook(app, b, m);

  let tvx = 0, tvy = 0, smooth = 0.16, focus = null;

  if (b.state === 'fly') {
    // A following bird chases the cursor THROUGH the air, retargeting live.
    // When grounded, a cursor high above the walking strip means: don't try
    // to walk under it — circle it up there, and only settle once it (or
    // the friendship) comes back down.
    let hoverHigh = false;
    if (b.followLeft > 0 && !b.scared) {
      b.followLeft--;
      const gx = m.x + (b.i ? 130 : -130) - HALF;
      const rawY = m.y + 46 - HALF;
      hoverHigh = opts.grounded && rawY < screen.h - WIN - 90;
      b.flyTo = hoverHigh
        ? { x: gx + Math.sin(t * 0.05 + b.i * 2.6) * 70, y: rawY + Math.cos(t * 0.04 + b.i) * 36 }
        : { x: gx, y: groundY(rawY) };
      if (b.followLeft === 0) b.flyTo = farSpot(m);  // done tagging along — pick a legal perch
    }
    const fx = b.flyTo.x - b.pos.x, fy = b.flyTo.y - b.pos.y;
    const fd = Math.hypot(fx, fy) || 1;
    if (fd < 26 && !hoverHigh) {
      b.scared = false;
      setState(app, b, 'land');
    } else {
      const sp = (b.scared ? 12.5 : 9) * b.speed;
      tvx = (fx / fd) * sp * Math.min(1, fd / 60);   // ease off circling a hover point
      tvy = (fy / fd) * sp * Math.min(1, fd / 60) + Math.sin(t * 0.2 + b.i * 2.1) * 1.5;
      smooth = 0.13;
      focus = { x: b.flyTo.x + HALF, y: b.flyTo.y + HALF };
    }
  } else if (b.state === 'land') {
    smooth = 0.3;                                    // kill the drift and be DOWN
    if (b.stateT > 3) { setState(app, b, 'idle'); b.idleFor = rnd(30, 120); }
  } else if (b.state === 'eat') {
    if (!seeds) {
      setState(app, b, 'idle');
      b.idleFor = rnd(40, 120);
    } else {
      focus = seeds;
      b.dir = seeds.x >= cx ? 1 : -1;
      if (b.stateT > 0 && b.stateT % 24 === 0) {
        seeds.count--;
        app.push('seeds', { count: seeds.count });
        if (seeds.count <= 0) return finishPile(app);
      }
    }
  } else if (seeds && b.noticeIn === 0) {
    // Seed on the ground beats everything else. Each bird takes a side of
    // the pile; a long way off they fly in, the last stretch is on foot.
    // The 3D crow's feet sit ~50px below its window center, so the bird
    // stands with its CENTER above the pile — feet (and pecks) land on it.
    const sx = seeds.x + (b.i ? 52 : -52), sy = seeds.y - 45;
    const sd = Math.hypot(sx - cx, sy - cy) || 1;
    focus = seeds;
    if (sd < 16) {
      setState(app, b, 'eat');
    } else if (sd > 420) {
      b.flyTo = { x: sx - HALF, y: sy - HALF };
      setState(app, b, 'fly');
    } else {
      if (b.state !== 'walk') setState(app, b, 'walk');
      const s = (sd > 120 ? 2.6 : 1.7) * b.speed;
      tvx = ((sx - cx) / sd) * s;
      tvy = ((sy - cy) / sd) * s;
      smooth = 0.18;
    }
  } else if (b.followLeft > 0) {
    // Friendship: potter along near your cursor, each bird on its own side —
    // but drift off task now and then. They're ravens, not retrievers.
    b.followLeft--;
    focus = m;
    // (gy is a bird-center coord; groundY clamps window tops — convert around it)
    const gx = m.x + (b.i ? 130 : -130);
    const gy = groundY(m.y + 46 - HALF) + HALF;
    const gd = Math.hypot(gx - cx, gy - cy) || 1;
    // grounded + cursor above the walking strip = walking under it is silly;
    // take wing and follow up there (the fly branch keeps chasing live)
    const cursorHigh = opts.grounded && m.y + 46 - HALF < screen.h - WIN - 90;
    if (cursorHigh || gd > 460) {
      b.flyTo = { x: gx - HALF, y: cursorHigh ? m.y + 46 - HALF : gy - HALF };
      setState(app, b, 'fly');
    } else if (gd > 46) {
      if (b.state !== 'walk') setState(app, b, 'walk');
      const s = (gd > 200 ? 3 : 1.9) * b.speed;
      tvx = ((gx - cx) / gd) * s;
      tvy = ((gy - cy) / gd) * s;
    } else if (b.state === 'walk') {
      setState(app, b, 'idle');
    } else if (b.state === 'peck' && b.stateT > b.dur) {
      setState(app, b, 'idle');
    } else if (b.state === 'idle' && Math.random() < 0.006) {
      setState(app, b, 'peck');
      b.dur = rnd(24, 40);
    }
    if (b.followLeft === 0) { setState(app, b, 'idle'); b.idleFor = rnd(60, 200); }
  } else if (b.state === 'walk') {
    if (!b.walkTo) { setState(app, b, 'idle'); b.idleFor = rnd(40, 160); }
    else {
      const wx = b.walkTo.x - b.pos.x, wy = b.walkTo.y - b.pos.y;
      const wd = Math.hypot(wx, wy);
      if (wd < 8) { setState(app, b, 'idle'); b.idleFor = rnd(60, 240); b.walkTo = null; }
      else {
        tvx = (wx / wd) * 2.1 * b.speed;
        tvy = (wy / wd) * 2.1 * b.speed;
        smooth = 0.12;
        focus = { x: b.walkTo.x + HALF, y: b.walkTo.y + HALF };
      }
    }
  } else if (b.state === 'hop') {
    const hx = b.hopTo.x - b.pos.x, hy = b.hopTo.y - b.pos.y;
    const hd = Math.hypot(hx, hy) || 1;
    if (b.stateT > 9 || hd < 6) { setState(app, b, 'idle'); b.idleFor = rnd(30, 140); }
    else { tvx = (hx / hd) * 4.4; tvy = (hy / hd) * 4.4; smooth = 0.3; }
  } else if (b.state === 'peck' || b.state === 'preen' || b.state === 'caw') {
    if (d < 340) focus = m;
    if (b.stateT > b.dur) { setState(app, b, 'idle'); b.idleFor = rnd(40, 180); }
  } else {
    // Idle. Keep an eye on the cursor, and every so often pick a new hobby.
    if (d < fleeRadius(b) * 2.4) { focus = m; b.dir = dx >= 0 ? 1 : -1; }
    if (trust >= 2 && Math.random() < 0.0008 * trust * (b.fedGlow > 0 ? 8 : 1)) {
      // You've fed them enough times that you're worth tagging along with.
      b.followLeft = Math.round((10 + trust * 6) * (1000 / TICK));
      lastTray = '';
      trayUpdate(app);
    } else if (--b.idleFor <= 0) {
      const r = Math.random();
      const buddy = birds[1 - b.i];
      const bd = Math.hypot(buddy.pos.x - b.pos.x, buddy.pos.y - b.pos.y);
      if (r < 0.28) { setState(app, b, 'peck'); b.dur = rnd(26, 60); }
      else if (r < 0.40) { setState(app, b, 'preen'); b.dur = rnd(55, 110); }
      else if (r < 0.48 && b.cawCool === 0) startCaw(app, b, false);
      else if (r < 0.56) {
        b.hopTo = {
          x: clamp(b.pos.x + rnd(-70, 70), 0, screen.w - WIN),
          y: groundY(clamp(b.pos.y + rnd(-40, 40), TOP, screen.h - WIN)),
        };
        setState(app, b, 'hop');
      } else if (r < 0.64) {
        b.flyTo = farSpot({ x: cx, y: cy });        // bored — up and away
        setState(app, b, 'fly');
      } else {
        // Stroll; strays drift back toward their mate.
        b.walkTo = bd > 520 && r < 0.85
          ? {
              x: clamp(buddy.pos.x + rnd(-140, 140), 0, screen.w - WIN),
              y: groundY(clamp(buddy.pos.y + rnd(-90, 90), TOP, screen.h - WIN)),
            }
          : {
              x: clamp(b.pos.x + rnd(-240, 240), 0, screen.w - WIN),
              y: groundY(clamp(b.pos.y + rnd(-140, 140), TOP, screen.h - WIN)),
            };
        setState(app, b, 'walk');
      }
    }
  }

  // Integrate, clamp to the screen; a flight pinned to an edge just retargets.
  b.vel.x += (tvx - b.vel.x) * smooth;
  b.vel.y += (tvy - b.vel.y) * smooth;
  const wantX = b.pos.x + b.vel.x, wantY = b.pos.y + b.vel.y;
  const nx = clamp(wantX, 0, screen.w - WIN);
  const ny = clamp(wantY, TOP, screen.h - WIN);
  if (b.state === 'fly' && (Math.abs(nx - wantX) > 0.5 || Math.abs(ny - wantY) > 0.5)) {
    b.flyTo = {
      x: clamp(b.flyTo.x, 40, screen.w - WIN - 40),
      y: clamp(b.flyTo.y, TOP + 30, screen.h - WIN - 30),
    };
  }
  if (Math.abs(nx - b.pos.x) >= 0.5 || Math.abs(ny - b.pos.y) >= 0.5) {
    b.pos.x = nx;
    b.pos.y = ny;
    bwin(app, b).setPosition(Math.round(nx), Math.round(ny));
  }
  if (b.state !== 'eat' && Math.abs(b.vel.x) > 0.5) b.dir = b.vel.x > 0 ? 1 : -1;

  // Where this bird is looking, at ~8 Hz — the page eases the eye over.
  // Window position rides along so the page can light itself from the sun.
  if ((t + b.i) % 3 === 0) {
    let lx = 0, ly = 0;
    if (focus) {
      const fx = focus.x - cx, fy = focus.y - cy;
      const fd = Math.hypot(fx, fy) || 1;
      lx = fx / fd; ly = fy / fd;
    }
    app.push('look', {
      who: b.winId,
      x: +lx.toFixed(2), y: +ly.toFixed(2), dir: b.dir,
      moving: Math.hypot(b.vel.x, b.vel.y) > 0.6,
      fast: b.scared,
      wx: Math.round(b.pos.x), wy: Math.round(b.pos.y),
    });
  }
}

// Pseudo-depth: the bird lower on the screen is nearer the viewer, so it
// should draw in front. Re-raise on order flips only (with a little
// hysteresis so two birds at the same height don't fight over it).
let frontWin = '';
function zOrder(app) {
  if (Math.abs(birds[0].pos.y - birds[1].pos.y) < 14) return;
  const front = birds[0].pos.y > birds[1].pos.y ? 'main' : 'r2';
  if (front === frontWin) return;
  frontWin = front;
  try { (front === 'main' ? app : app.window('r2')).show({ activate: false }); } catch (e) {}
}

function tick(app) {
  t++;
  const m = cursor();
  for (const b of birds) tickBird(app, b, m);
  if (t % 5 === 0) zOrder(app);
  if (t % 25 === 0) trayUpdate(app);
  // Screens change (lids close, displays plug in) — re-measure now and then.
  if (t % 250 === 0) {
    app.getWinState().then((st) => {
      if (st.screen.width !== screen.w || st.screen.height !== screen.h) {
        screen = { w: st.screen.width, h: st.screen.height };
        app.push('env', envInfo());       // the sun moved with the screen
      }
    }).catch(() => {});
  }
}

// --------------------------------------------------------------------- api

export const api = {
  boot: async (_p, app, meta) => {
    const id = meta.window;

    if (id === 'main' && !ready.has('main')) {
      if (!IS_MAC) {
        // No FFI cursor off macOS — poll the backend into winCursor. Seed it
        // once before cursor() is first read below, then refresh every tick.
        const pollCursor = async () => {
          try { const p = await app.mousePosition(); if (p) winCursor = { x: p.x, y: p.y }; }
          catch { /* transient — keep the last known position */ }
        };
        await pollCursor();
        setInterval(pollCursor, TICK);
      }
      trust = (await app.store.get('trust')) || 0;
      opts = Object.assign(opts, (await app.store.get('opts')) || {});
      // stores from before volume levels have a boolean `sound`
      if ('sound' in opts) { opts.volume = opts.sound ? 'medium' : 'off'; delete opts.sound; }
      if (!(opts.volume in VOLS)) opts.volume = 'medium';
      const st = await app.getWinState();
      screen = { w: st.screen.width, h: st.screen.height };
      const m = cursor();
      birds[0].pos = farSpot(m);
      do { birds[1].pos = farSpot(m); }                      // land apart
      while (Math.hypot(birds[1].pos.x - birds[0].pos.x, birds[1].pos.y - birds[0].pos.y) < 260);
      app.setPosition(Math.round(birds[0].pos.x), Math.round(birds[0].pos.y));
      app.setAlwaysOnTop(true);
      app.setResizable(false);
      app.show({ activate: false });                // accessory apps start hidden — position first
      app.setContextMenu([
        { id: 'seed', label: '🌾 Scatter some seed' },
        { separator: true },
        { id: 'quit', label: 'Quit Kraa 3D' },
      ]);
      try { app.hotkey.register('seed', 'ctrl+alt+s'); } catch { /* taken — the menu still works */ }
      trayUpdate(app);
      // The rest of the flock: same page for Muninn, seed.html for the pile.
      app.openWindow('r2', { page: 'index.html', title: 'Muninn', size: `${WIN}x${WIN}` });
      app.openWindow('seed', { page: 'seed.html', title: 'Seed', size: '120x100' });
    }

    if (id === 'r2' && !ready.has('r2')) {
      const h = app.window('r2');
      h.setChrome({ frame: false, trafficLights: false, transparent: true });
      h.setAlwaysOnTop(true);
      h.setResizable(false);
      h.setPosition(Math.round(birds[1].pos.x), Math.round(birds[1].pos.y));
      h.show({ activate: false });
    }

    if (id === 'seed' && !ready.has('seed')) {
      const h = app.window('seed');
      h.setChrome({ frame: false, trafficLights: false, transparent: true });
      h.setAlwaysOnTop(true);
      h.setResizable(false);
      h.hide();                  // stays hidden until somebody scatters seed
    }

    ready.add(id);
    applyOpts(app);              // stragglers pick up click-through/level too
    if (ready.has('main') && ready.has('r2') && !timer) {
      timer = setInterval(() => {
        try { tick(app); } catch (e) { console.log('kraa tick:', e); }
      }, TICK);
    }

    if (id === 'seed') return { count: seeds ? seeds.count : 0 };
    const b = birds[id === 'r2' ? 1 : 0];
    return { state: b.state, trust, env: envInfo() };
  },


  // A raven got clicked. A trusted, fed bird takes it as a compliment;
  // a wild one takes it as an ambush.
  poke: (_p, app, meta) => {
    if (meta.window === 'seed') return true;
    const b = birds[meta.window === 'r2' ? 1 : 0];
    if (b.fedGlow > 0 || b.followLeft > 0) {
      app.push('hearts', { who: b.winId, n: 1 });
      if (b.cawCool === 0) startCaw(app, b, true);
    } else {
      spook(app, b, cursor());
    }
    return true;
  },
};






function onCommand(id, app) {
  if (id.startsWith('vol-')) {
    opts.volume = id.slice(4);
    applyOpts(app);
    lastTray = '';
    trayUpdate(app);
  } else if (id === 'ghost' || id === 'desk' || id === 'shhh' || id === 'grounded') {
    opts[id] = !opts[id];
    applyOpts(app);
    lastTray = '';
    trayUpdate(app);
    if (id === 'grounded' && opts.grounded) {
      // just grounded — any bird up in the air heads for the bottom now
      for (const b of birds) {
        b.scared = false;
        b.flyTo = farSpot(cursor());
        setState(app, b, 'fly');
      }
    }
  } else if (id === 'seed') seeds ? sweepSeed(app) : dropSeed(app);
  else if (id === 'find') {
    // Call the flock — both birds fly in to the middle of the screen.
    for (const b of birds) {
      b.scared = false;
      b.flyTo = {
        x: screen.w / 2 - HALF + (b.i ? 150 : -150),
        y: groundY(screen.h / 2 - HALF + rnd(-60, 60)),
      };
      setState(app, b, 'fly');
    }
  } else if (id === 'quit') app.quit();
}

export function onTray(id, app) {
  if (id === 'check-updates') return checkForUpdates(app); onCommand(id, app); }
export function onContextMenu(id, app) { onCommand(id, app); }
export function onHotkey(id, app) {
  // The hotkey always scatters a fresh pile (or moves the existing one).
  if (id === 'seed') dropSeed(app);
}

export function init() {
  // Everything starts in api.boot, once each page's listeners are up.
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
