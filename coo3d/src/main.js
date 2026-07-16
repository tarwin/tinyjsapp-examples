// Coo 3D — a flock of city pigeons living on your screen, each one a
// frameless transparent window wearing a rigged, animated GLB (three.js).
// The skeleton of this file is kraa3d's, but the SOCIETY is different:
// pigeons don't do trust. They wander alone or drift into pairs that never
// quite stick, strut circles at each other, fly off to loaf on the edge of
// the screen, mob thrown crumbs (several piles can be out at once), and —
// being pigeons — they poop, and the poop stays (sweep from the tray).
// Every window is click-through, always: the flock can never trap a click.
//
// The techniques on show:
//
//   1. A pool of windows, one brain — up to TEN pigeon windows (add and
//      remove them live from the tray), three crumb-pile windows, and eight
//      poop splats: all `app.openWindow` satellites steered by one 25 fps
//      backend tick. Broadcast pushes carry `who`/`win` tags so every page
//      only wears its own state.
//   2. FFI — the global cursor position comes from CoreGraphics
//      (`tjs:ffi` → CGEventGetLocation). Pigeons also track cursor SPEED:
//      an ambling mouse makes them waddle aside; a fast one scatters the
//      whole nearby flock (one spook is contagious).
//   3. Pigeon society — temporary pairs (walk together, coo at each other,
//      circle-strut; 40% of struts are unimpressive and end the pair),
//      loafing (fly to the screen edge and just sit), and a shared table:
//      any number of birds crowd a crumb pile, each on its own bearing.

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

const TICK = 40;              // 25 fps brain
const WIN = 200;              // pigeon window size — bird sits centered
const HALF = WIN / 2;
const TOP = 26;               // stay out of the menu bar

const PIGS = ['main', ...Array.from({ length: 19 }, (_, i) => 'p' + (i + 1))];
const NAMES = ['Waddles', 'Bert', 'Mildred', 'Gerald', 'Pidge',
               'Nigel', 'Doreen', 'Elvis', 'Beryl', 'Crumb',
               'Pepper', 'Squab', 'Marge', 'Colin', 'Dot',
               'Rocco', 'Fern', 'Stan', 'Peanut', 'Val'];
// frameless + transparent must ride ALONG with openWindow — chrome applied
// after the first paint flashes a white default window
const CHROME = { frame: false, trafficLights: false, transparent: true };
const CRUMB_POOL = ['c0', 'c1', 'c2'];       // up to three piles out at once
const POOP_POOL = ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'];

let screen = { w: 1440, h: 900 };
let opts = {                  // persisted tray toggles
  desk: false,                // live ON the desktop (behind windows) vs float above
  sound: true,                // the coo is audible (once there's a coo to play)
  grounded: false,            // ground business stays near the screen bottom
  count: 3,                   // pigeons in the flock, 2..20
};
let t = 0;
let timer = null;
const ready = new Set();      // windows whose pages have booted
const opened = new Set();     // windows that have ever been openWindow'd

const piles = {};             // crumb win id -> { x, y, count } | null
let pileNext = 0;             // replacement rotation when all slots are full
const poops = {};             // poop win id -> { at } | null — poop is forever
                              // (well, until swept, or its slot gets re-pooped)
let poopNext = 0;

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// Twenty of the same bird, each with its own dials — nobody waddles alike.
function makePigeon(i) {
  return {
    i, winId: PIGS[i], name: NAMES[i],
    pos: { x: 260 + i * 200, y: 520 },       // window top-left, live
    vel: { x: 0, y: 0 },
    dir: i % 2 ? -1 : 1,                     // 1 facing right, -1 left
    state: 'idle',   // idle | walk | peck | coo | circle | poop | fly | land | eat | loaf
    stateT: 0,
    dur: 0,           // how long the current peck/coo/circle/poop runs
    idleFor: rnd(40, 160),
    walkTo: null, flyTo: null,
    scared: false,    // this flight is a getaway, not a commute
    loafAfter: false, // this flight ends in a long sit, not an idle
    loafT: 0,
    noticeIn: 0,      // reaction ticks before fresh crumbs register
    fedGlow: 0,       // recently fed — brave (for a pigeon)
    cooCool: 0, replyIn: 0,
    buddy: -1,        // index of the current walking partner, -1 alone
    pairT: 0,         // ticks left before the pair drifts apart
    poopIn: Math.round(rnd(700, 2000)),
    waddleCool: 0,
    pile: null,       // crumb win id this bird is eating from
    speed: rnd(0.92, 1.15),
    shy: rnd(0.85, 1.2),
  };
}
const birds = PIGS.map((_, i) => makePigeon(i));

// Every launch, each bird rolls for a SPECIAL coat — shiny-Pokémon rules,
// so most flocks are all gray and then one day there's a gold one. Rolled
// once for all ten up front, so a pigeon added later can be special too.
function rollShine() {
  const r = Math.random();
  if (r < 0.004) return 'rainbow';
  if (r < 0.012) return 'gold';
  if (r < 0.020) return 'red';
  if (r < 0.030) return 'blue';
  if (r < 0.042) return 'silver';
  if (r < 0.056) return 'bronze';
  return null;
}
for (const b of birds) b.shine = rollShine();

const bwin = (app, b) => (b.winId === 'main' ? app : app.window(b.winId));
const flock = () => birds.slice(0, opts.count);
const anyCrumbs = () => CRUMB_POOL.some((w) => piles[w] && piles[w].count > 0);
const anyPoop = () => POOP_POOL.some((w) => poops[w]);

// ------------------------------------------------------------------- moods

function setState(app, b, s) {
  if (b.state === s) return;
  b.state = s;
  b.stateT = 0;
  app.push('bird', { who: b.winId, state: s });
  // wings make noise — a getaway sounds more urgent than a commute
  if (s === 'fly') say(app, b, b.scared ? 'scatter' : 'takeoff', b.scared);
}

const mood = () => (anyCrumbs() ? '🍞' : '🕊️');

let lastTray = '';
function trayUpdate(app) {
  const sig = mood() + anyCrumbs() + anyPoop() + opts.desk + opts.sound + opts.grounded + opts.count;
  if (sig === lastTray) return;            // tray.set repaints — only on change
  lastTray = sig;
  const tick = (on) => (on ? '✓ ' : '   ');
  app.tray.set({
    title: mood(),
    menu: [
      { id: 'crumbs', label: '🍞 Throw some crumbs  ⌃⌥C' },
      { id: 'sweep', label: '🧹 Sweep up (crumbs & poop)', enabled: anyCrumbs() || anyPoop() },
      { id: 'find', label: '👋 Where are the pigeons?' },
      { separator: true },
      { id: 'more', label: `➕ One more pigeon (${opts.count})`, enabled: opts.count < PIGS.length },
      { id: 'fewer', label: `➖ One fewer pigeon`, enabled: opts.count > 2 },
      { id: 'reset', label: '🧼 Fresh start (two pigeons, clean floor)' },
      { separator: true },
      { id: 'desk', label: tick(opts.desk) + '🖥️ Live on the desktop' },
      { id: 'grounded', label: tick(opts.grounded) + '🌱 Grounded (keep to the bottom)' },
      { id: 'sound', label: tick(opts.sound) + '🔊 Coo out loud' },
      { separator: true },
      { id: 'quit', label: 'Quit Coo 3D' },
    ],
  });
}

// Window level, applied to everything — and EVERYTHING is click-through,
// always: birds, crumbs, poop. The flock lives on your screen but can never
// trap your mouse; the tray is the whole interface.
function applyOpts(app) {
  for (const id of [...PIGS, ...CRUMB_POOL, ...POOP_POOL]) {
    if (id !== 'main' && !opened.has(id)) continue;
    const w = id === 'main' ? app : app.window(id);
    try { w.setClickThrough(true); } catch (e) {}
    try {
      if (opts.desk) { w.setAlwaysOnTop(false); w.setLevel('desktop'); }
      else { w.setLevel('floating'); w.setAlwaysOnTop(true); }
    } catch (e) {}
  }
  app.store.set('opts', opts);
}

// ------------------------------------------------------------------- moves

// Grounded mode: anything that stands, walks, or lands does it in a strip
// along the bottom of the screen — the sky stays open for flying.
const groundY = (y) =>
  opts.grounded ? clamp(y, screen.h - WIN - 70, screen.h - WIN) : y;

function farSpot(m) {
  for (let i = 0; i < 24; i++) {
    const p = { x: rnd(0, screen.w - WIN), y: groundY(rnd(TOP, screen.h - WIN)) };
    if (Math.hypot(m.x - p.x - HALF, m.y - p.y - HALF) > 320) return p;
  }
  return { x: screen.w / 2 - HALF, y: groundY(screen.h / 2 - HALF) };
}

// Loafing spot: pigeons like an edge — a ledge feeling. Left or right side,
// any height (bottom strip when grounded).
function loafSpot() {
  const left = Math.random() < 0.5;
  return {
    x: left ? rnd(0, 50) : rnd(screen.w - WIN - 50, screen.w - WIN),
    y: groundY(rnd(TOP, screen.h - WIN)),
  };
}

// Where a bird sits left-to-right on the screen, as a stereo pan.
const cooPan = (b) => +(((b.pos.x + HALF) / screen.w) * 2 - 1).toFixed(2);

// One sun for the whole flock: parked way above the screen, up and to the
// right. Every page lights its bird from here relative to its own window.
const sunSpot = () => ({ x: Math.round(screen.w * 0.68), y: -520 });
const envInfo = () => ({ sun: sunSpot(), screen: { w: screen.w, h: screen.h } });

// Every audible moment goes out as a kind + pan + vol; the main window's
// page owns the actual recordings and does the mixing.
// kinds: coo | coolong (the courtship number) | call (alarm) |
//        takeoff (casual wings) | scatter (panicked wings) | distant
function say(app, b, kind, loud) {
  if (!opts.sound) return;
  app.push('say', {
    who: b.winId, kind,
    pan: cooPan(b),
    vol: +rnd(loud ? 0.55 : 0.3, loud ? 0.9 : 0.7).toFixed(2),
  });
}

// Too close, too fast! One pigeon's panic is everyone's panic — birds near
// the spooked one go up too. Very pigeon.
function spook(app, b, m, chain = true) {
  b.scared = true;
  b.loafAfter = false;
  b.pile = null;
  dissolvePair(b);
  b.flyTo = farSpot(m);
  say(app, b, 'call', true);
  setState(app, b, 'fly');
  if (!chain) return;
  for (const o of flock()) {
    if (o === b || o.state === 'fly' || !ready.has(o.winId)) continue;
    if (Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y) < 260 && Math.random() < 0.75) {
      spook(app, o, m, false);
    }
  }
}

function startCoo(app, b, reply) {
  setState(app, b, 'coo');
  b.dur = 30;
  b.cooCool = 300;
  say(app, b, 'coo', false);
  if (reply) return;
  // somebody nearby (the buddy, ideally) often answers
  const near = flock().filter((o) => o !== b && o.cooCool === 0 &&
    Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y) < 520);
  const who = near.find((o) => o.i === b.buddy) || near[0];
  if (who && Math.random() < 0.6) who.replyIn = Math.round(rnd(14, 30));
}

// ------------------------------------------------------------------- pairs

function dissolvePair(b) {
  if (b.buddy < 0) return;
  const o = birds[b.buddy];
  b.buddy = -1; b.pairT = 0;
  if (o && o.buddy === b.i) { o.buddy = -1; o.pairT = 0; }
}

function tryPair(b) {
  const free = flock().filter((o) =>
    o !== b && o.buddy < 0 && o.loafT === 0 &&
    (o.state === 'idle' || o.state === 'walk' || o.state === 'peck'));
  if (!free.length) return false;
  free.sort((a, c) =>
    Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) -
    Math.hypot(c.pos.x - b.pos.x, c.pos.y - b.pos.y));
  const o = free[0];
  b.buddy = o.i; o.buddy = b.i;
  b.pairT = o.pairT = Math.round(rnd(500, 1500));   // 20–60 s, then it's over
  return true;
}

// ------------------------------------------------------------------ crumbs

function dropCrumbs(app) {
  // A fresh throw lands wherever bread lands. Three piles can be out at
  // once; a fourth throw replaces the stalest one. Both y ranges keep the
  // pile where a standing bird's feet can actually reach it.
  let win = CRUMB_POOL.find((w) => !piles[w]);
  if (!win) { win = CRUMB_POOL[pileNext % CRUMB_POOL.length]; pileNext++; }
  piles[win] = {
    x: rnd(90, screen.w - 90),
    y: opts.grounded ? rnd(screen.h - 115, screen.h - 60) : rnd(TOP + 180, screen.h - 60),
    count: Math.round(rnd(8, 14)),
  };
  const h = app.window(win);
  h.setPosition(Math.round(piles[win].x - 75), Math.round(piles[win].y - 55));
  h.show({ activate: false });
  app.push('crumbs', { win, count: piles[win].count, fresh: true });
  // pigeons clock bread FAST — but each bird has its own reaction time,
  // and everyone drops what they were doing socially
  for (const b of flock()) {
    if (b.noticeIn === 0 || !piles[b.pile]) b.noticeIn = Math.round(rnd(6, 45));
  }
  raiseFlock(app);               // showing the pile raised it above the birds
  lastTray = '';
  trayUpdate(app);
}

function finishPile(app, win) {
  piles[win] = null;
  try { app.window(win).hide(); } catch (e) {}
  for (const b of flock()) {
    if (b.pile !== win) continue;
    b.pile = null;
    if (b.state === 'eat') {
      b.fedGlow = Math.round(30 * (1000 / TICK));   // ~30 s of full-crop calm
      setState(app, b, 'idle');
      b.idleFor = rnd(30, 100);
      if (b.cooCool === 0) startCoo(app, b, true);   // a contented burble
    }
  }
  lastTray = '';
  trayUpdate(app);
}

function sweep(app) {
  for (const w of CRUMB_POOL) {
    if (piles[w]) { piles[w] = null; try { app.window(w).hide(); } catch (e) {} }
  }
  for (const w of POOP_POOL) hidePoop(app, w);
  for (const b of flock()) {
    b.pile = null;
    if (b.state === 'eat') { setState(app, b, 'idle'); b.idleFor = rnd(40, 120); }
  }
  lastTray = '';
  trayUpdate(app);
}

// The nearest pile with anything left in it.
function nearestPile(b) {
  let best = null, bd = Infinity;
  for (const w of CRUMB_POOL) {
    const p = piles[w];
    if (!p || p.count <= 0) continue;
    const d = Math.hypot(p.x - b.pos.x - HALF, p.y - b.pos.y - HALF);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}

// Any number of pigeons crowd a pile, each on its own bearing around it.
// The bird's feet sit ~50px below its window center, so it stands with its
// CENTER a touch above the crumbs — pecks land on them.
function pileSpot(b, win) {
  const p = piles[win];
  const ang = b.i * 2.4 + p.x * 0.013;
  return { x: p.x + Math.cos(ang) * 28, y: p.y - 45 + Math.sin(ang) * 12 };
}

// -------------------------------------------------------------------- poop

function spawnPoop(app, b) {
  const win = POOP_POOL[poopNext % POOP_POOL.length];
  poopNext++;
  poops[win] = { at: t };      // permanent — until swept, or the slot recycles
  const h = app.window(win);
  h.setPosition(
    Math.round(b.pos.x + HALF - 23 + rnd(-8, 8)),
    Math.round(b.pos.y + HALF + 30),
  );
  h.show({ activate: false });
  app.push('splat', { win });
  raiseFlock(app);               // the splat is UNDER the birds, always
  lastTray = '';
  trayUpdate(app);
}

function hidePoop(app, win) {
  if (!poops[win]) return;
  poops[win] = null;
  app.push('fade', { win });     // the page fades out, then we hide it
  setTimeout(() => { try { app.window(win).hide(); } catch (e) {} }, 700);
}

// ------------------------------------------------------------------- brain

// Wild-ish animals keep their distance; a feeding pigeon barely cares.
function fleeRadius(b) {
  let r = 95 * b.shy;
  if (b.state === 'eat' || b.fedGlow > 0) r *= 0.55;
  return r;
}

function tickBird(app, b, m, mv) {
  b.stateT++;
  if (b.noticeIn > 0) b.noticeIn--;
  if (b.fedGlow > 0) b.fedGlow--;
  if (b.cooCool > 0) b.cooCool--;
  if (b.waddleCool > 0) b.waddleCool--;
  if (b.poopIn > 0) b.poopIn -= b.state === 'eat' ? 2 : 1;   // digestion works
  if (b.pairT > 0 && --b.pairT === 0) {
    // pairs never really stick — drift apart; sometimes one flies off to
    // go loaf about it alone
    dissolvePair(b);
    if (Math.random() < 0.35 && b.state !== 'fly') {
      b.loafAfter = true;
      b.flyTo = loafSpot();
      setState(app, b, 'fly');
    }
  }
  if (b.replyIn > 0 && --b.replyIn === 0 && b.cooCool === 0 &&
      (b.state === 'idle' || b.state === 'walk' || b.state === 'peck' || b.state === 'loaf')) {
    startCoo(app, b, true);
  }

  const cx = b.pos.x + HALF, cy = b.pos.y + HALF;
  const dx = m.x - cx, dy = m.y - cy;
  const d = Math.hypot(dx, dy) || 1;

  // Fear first. A fast-moving cursor scatters from further away; a slow one
  // just makes a grounded pigeon waddle aside. Panic is contagious.
  if (b.state !== 'fly') {
    if (d < fleeRadius(b) || (d < fleeRadius(b) * 2.2 && mv > 24)) {
      spook(app, b, m);
    } else if (d < fleeRadius(b) * 1.9 && mv > 5 && b.waddleCool === 0 &&
               (b.state === 'idle' || b.state === 'walk' || b.state === 'peck' || b.state === 'loaf')) {
      const away = Math.atan2(-dy, -dx) + rnd(-0.5, 0.5);
      b.walkTo = {
        x: clamp(cx + Math.cos(away) * rnd(120, 190) - HALF, 0, screen.w - WIN),
        y: groundY(clamp(cy + Math.sin(away) * rnd(60, 120) - HALF, TOP, screen.h - WIN)),
      };
      b.waddleCool = 70;
      b.loafT = 0;
      setState(app, b, 'walk');
    }
  }

  let tvx = 0, tvy = 0, smooth = 0.16, focus = null;

  if (b.state === 'fly') {
    const fx = b.flyTo.x - b.pos.x, fy = b.flyTo.y - b.pos.y;
    const fd = Math.hypot(fx, fy) || 1;
    if (fd < 26) {
      b.scared = false;
      setState(app, b, 'land');
    } else {
      const sp = (b.scared ? 12 : 8.5) * b.speed;
      tvx = (fx / fd) * sp * Math.min(1, fd / 60);
      tvy = (fy / fd) * sp * Math.min(1, fd / 60) + Math.sin(t * 0.2 + b.i * 2.1) * 1.4;
      smooth = 0.13;
      focus = { x: b.flyTo.x + HALF, y: b.flyTo.y + HALF };
    }
  } else if (b.state === 'land') {
    smooth = 0.3;                                    // kill the drift and be DOWN
    // the page plays a real wings-out Land clip — give it a beat to brake
    if (b.stateT > 14) {
      if (b.loafAfter) {
        b.loafAfter = false;
        b.loafT = Math.round(rnd(750, 2000));        // 30–80 s of sitting there
        setState(app, b, 'loaf');
      } else {
        setState(app, b, 'idle');
        b.idleFor = rnd(30, 120);
      }
    }
  } else if (b.state === 'eat') {
    const p = piles[b.pile];
    if (!p || p.count <= 0) {
      b.pile = null;
      setState(app, b, 'idle');
      b.idleFor = rnd(40, 120);
    } else {
      focus = p;
      b.dir = p.x >= cx ? 1 : -1;
      if (b.stateT > 0 && b.stateT % 20 === 0) {
        p.count--;
        app.push('crumbs', { win: b.pile, count: p.count });
        if (p.count <= 0) return finishPile(app, b.pile);
      }
    }
  } else if (b.state === 'poop') {
    // hold still, lift the tail (the page does the acting)… and there it is
    if (b.stateT === 14) spawnPoop(app, b);
    if (b.stateT > b.dur) { setState(app, b, 'idle'); b.idleFor = rnd(30, 140); }
  } else if (b.noticeIn === 0 && nearestPile(b) && b.state !== 'coo' && b.state !== 'circle') {
    // Bread on the ground beats everything social. Trot over — fly if far.
    const win = nearestPile(b);
    const s0 = pileSpot(b, win);
    const sd = Math.hypot(s0.x - cx, s0.y - cy) || 1;
    focus = piles[win];
    if (sd < 16) {
      b.pile = win;
      setState(app, b, 'eat');
    } else if (sd > 480) {
      b.flyTo = { x: s0.x - HALF, y: s0.y - HALF };
      b.loafAfter = false;
      b.loafT = 0;
      setState(app, b, 'fly');
    } else {
      b.loafT = 0;
      if (b.state !== 'walk') setState(app, b, 'walk');
      const s = (sd > 120 ? 2.9 : 1.9) * b.speed;
      tvx = ((s0.x - cx) / sd) * s;
      tvy = ((s0.y - cy) / sd) * s;
      smooth = 0.18;
    }
  } else if (b.state === 'loaf') {
    // parked on the edge, watching the world. Long sits, slow blinks.
    if (d < 420) { focus = m; b.dir = dx >= 0 ? 1 : -1; }
    if (--b.loafT <= 0) { setState(app, b, 'idle'); b.idleFor = rnd(40, 160); }
  } else if (b.state === 'walk') {
    if (!b.walkTo) { setState(app, b, 'idle'); b.idleFor = rnd(40, 160); }
    else {
      const wx = b.walkTo.x - b.pos.x, wy = b.walkTo.y - b.pos.y;
      const wd = Math.hypot(wx, wy);
      if (wd < 8) { setState(app, b, 'idle'); b.idleFor = rnd(60, 240); b.walkTo = null; }
      else {
        tvx = (wx / wd) * 2.0 * b.speed;
        tvy = (wy / wd) * 2.0 * b.speed;
        smooth = 0.12;
        focus = { x: b.walkTo.x + HALF, y: b.walkTo.y + HALF };
      }
    }
  } else if (b.state === 'peck' || b.state === 'coo' || b.state === 'circle') {
    if (d < 340) focus = m;
    if (b.stateT > b.dur) {
      // a circle-strut wants a verdict: does the audience walk away?
      if (b.state === 'circle' && b.buddy >= 0) {
        const o = birds[b.buddy];
        if (Math.random() < 0.4) {
          // not impressed. The pair is over; the audience leaves.
          dissolvePair(b);
          o.walkTo = {
            x: clamp(o.pos.x + rnd(-260, 260), 0, screen.w - WIN),
            y: groundY(clamp(o.pos.y + rnd(-140, 140), TOP, screen.h - WIN)),
          };
          setState(app, o, 'walk');
        } else if (o.cooCool === 0) {
          o.replyIn = Math.round(rnd(8, 20));
        }
      }
      setState(app, b, 'idle');
      b.idleFor = rnd(40, 180);
    }
  } else {
    // Idle. Keep an eye on the cursor, and every so often pick a new hobby.
    if (d < fleeRadius(b) * 2.4) { focus = m; b.dir = dx >= 0 ? 1 : -1; }
    if (b.poopIn <= 0) {
      b.poopIn = Math.round(rnd(1100, 2600));        // 44–104 s till next
      b.dur = 24;
      setState(app, b, 'poop');
    } else if (--b.idleFor <= 0) {
      const r = Math.random();
      const o = b.buddy >= 0 ? birds[b.buddy] : null;
      const od = o ? Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y) : Infinity;
      if (r < 0.2) { setState(app, b, 'peck'); b.dur = rnd(40, 80); }
      else if (r < 0.3 && b.cooCool === 0) startCoo(app, b, false);
      else if (r < 0.38 && o && od < 300) {
        // the courtship number: puff up, strut a little circle at them,
        // and give it the full long coo
        setState(app, b, 'circle');
        b.dur = 90;
        if (b.cooCool === 0) { b.cooCool = 300; say(app, b, 'coolong', false); }
      } else if (r < 0.48) {
        // bored — up and away. Some of these flights end in a long loaf
        // somewhere on the edge of the screen, alone.
        dissolvePair(b);
        b.loafAfter = Math.random() < 0.4;
        b.flyTo = b.loafAfter ? loafSpot() : farSpot({ x: cx, y: cy });
        setState(app, b, 'fly');
      } else if (r < 0.56 && b.buddy < 0 && tryPair(b)) {
        // sidle over to the new acquaintance
        const n = birds[b.buddy];
        b.walkTo = {
          x: clamp(n.pos.x + rnd(-120, 120), 0, screen.w - WIN),
          y: groundY(clamp(n.pos.y + rnd(-70, 70), TOP, screen.h - WIN)),
        };
        setState(app, b, 'walk');
      } else {
        // Stroll; a paired bird potters along near its buddy.
        b.walkTo = o && od > 220
          ? {
              x: clamp(o.pos.x + rnd(-140, 140), 0, screen.w - WIN),
              y: groundY(clamp(o.pos.y + rnd(-80, 80), TOP, screen.h - WIN)),
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
// draws in front. Re-raise back-to-front when the order changes (y is
// bucketed so two birds at the same height don't fight over it). This is
// also what keeps every pigeon above the crumbs and the poop.
let lastOrder = '';
function raiseFlock(app, force) {
  const order = flock()
    .filter((b) => ready.has(b.winId))
    .sort((a, c) => a.pos.y - c.pos.y);
  const sig = order.map((b) => b.winId + Math.round(b.pos.y / 18)).join('|');
  if (!force && sig === lastOrder) return;
  lastOrder = sig;
  for (const b of order) {
    try { bwin(app, b).show({ activate: false }); } catch (e) {}
  }
}

function tick(app) {
  t++;
  const m = cursor();
  const mv = Math.hypot(m.x - lastM.x, m.y - lastM.y);   // cursor px per tick
  lastM = m;
  for (const b of flock()) {
    if (ready.has(b.winId)) tickBird(app, b, m, mv);
  }
  if (t % 6 === 0) raiseFlock(app);
  if (t % 25 === 0) trayUpdate(app);
  // ambience: while somebody's loafing on an edge, the city coos back —
  // faint, far away, every couple of minutes
  if (--distantIn <= 0) {
    const loafer = flock().find((b) => b.state === 'loaf');
    if (loafer && opts.sound) {
      say(app, loafer, 'distant', false);
      distantIn = Math.round(rnd(2500, 6000));   // 100–240 s
    } else {
      distantIn = 400;                           // check back in ~16 s
    }
  }
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
let lastM = { x: 0, y: 0 };
let distantIn = 1200;         // first chance of ambience ~48 s in

// ------------------------------------------------------------------- flock

function openPigeon(app, b) {
  if (opened.has(b.winId)) {
    try {
      const h = app.window(b.winId);
      h.setPosition(Math.round(b.pos.x), Math.round(b.pos.y));
      h.show({ activate: false });
    } catch (e) {}
    return;
  }
  opened.add(b.winId);
  app.openWindow(b.winId, {
    page: 'index.html', title: b.name, size: `${WIN}x${WIN}`,
    chrome: CHROME, x: Math.round(b.pos.x), y: Math.round(b.pos.y),
  });
}

function addPigeon(app) {
  if (opts.count >= PIGS.length) return;
  const b = birds[opts.count];
  opts.count++;
  // the new arrival flies in from a screen edge
  b.pos = { x: Math.random() < 0.5 ? 0 : screen.w - WIN, y: groundY(rnd(TOP, screen.h / 2)) };
  b.flyTo = farSpot(cursor());
  b.state = 'fly';
  b.stateT = 0;
  b.scared = false;
  openPigeon(app, b);
  applyOpts(app);
  lastTray = '';
  trayUpdate(app);
}

function removePigeon(app) {
  if (opts.count <= 2) return;
  opts.count--;
  const b = birds[opts.count];   // page stays alive and ready, just hidden
  dissolvePair(b);
  b.pile = null;
  try { app.window(b.winId).hide(); } catch (e) {}
  applyOpts(app);
  lastTray = '';
  trayUpdate(app);
}

// --------------------------------------------------------------------- api

export const api = {
  boot: async (_p, app, meta) => {
    const id = meta.window;

    if (id === 'main' && !ready.has('main')) {
      opts = Object.assign(opts, (await app.store.get('opts')) || {});
      opts.count = clamp(opts.count, 2, PIGS.length);
      const st = await app.getWinState();
      screen = { w: st.screen.width, h: st.screen.height };
      const m = cursor();
      lastM = m;
      // scatter the flock, everyone a respectable distance from everyone
      const placed = [];
      for (const b of flock()) {
        let tries = 0;
        do { b.pos = farSpot(m); tries++; }
        while (tries < 20 && placed.some((p) =>
          Math.hypot(p.x - b.pos.x, p.y - b.pos.y) < 240));
        placed.push(b.pos);
      }
      app.setPosition(Math.round(birds[0].pos.x), Math.round(birds[0].pos.y));
      app.setAlwaysOnTop(true);
      app.setResizable(false);
      app.show({ activate: false });                // accessory apps start hidden — position first
      app.setContextMenu([
        { id: 'crumbs', label: '🍞 Throw some crumbs' },
        { separator: true },
        { id: 'quit', label: 'Quit Coo 3D' },
      ]);
      try { app.hotkey.register('crumbs', 'ctrl+alt+c'); } catch { /* taken — the menu still works */ }
      trayUpdate(app);
      // The rest of the flock, plus the crumb piles and… the other windows.
      for (let i = 1; i < opts.count; i++) openPigeon(app, birds[i]);
      for (const w of CRUMB_POOL) {
        opened.add(w);
        app.openWindow(w, { page: 'crumbs.html', title: 'Crumbs', size: '150x110', chrome: CHROME });
      }
      for (const w of POOP_POOL) {
        opened.add(w);
        app.openWindow(w, { page: 'poop.html', title: 'Oops', size: '46x36', chrome: CHROME });
      }
    }

    // chrome and position already rode along with openWindow (setting them
    // after the first paint flashes a white default window)
    if (PIGS.includes(id) && id !== 'main' && !ready.has(id)) {
      const b = birds[PIGS.indexOf(id)];
      const h = app.window(id);
      h.setAlwaysOnTop(true);
      h.setResizable(false);
      h.setPosition(Math.round(b.pos.x), Math.round(b.pos.y));
      h.show({ activate: false });
    }

    if ((CRUMB_POOL.includes(id) || POOP_POOL.includes(id)) && !ready.has(id)) {
      const h = app.window(id);
      h.setAlwaysOnTop(true);
      h.setResizable(false);
      h.hide();                  // stays hidden until somebody needs it
    }

    ready.add(id);
    applyOpts(app);              // stragglers pick up click-through/level too
    if (ready.has('main') && !timer) {
      timer = setInterval(() => {
        try { tick(app); } catch (e) { console.log('coo tick:', e); }
      }, TICK);
    }

    if (CRUMB_POOL.includes(id)) {
      return { count: piles[id] ? piles[id].count : 0, fresh: true };
    }
    if (POOP_POOL.includes(id)) return { on: !!poops[id] };
    const b = birds[PIGS.indexOf(id)];
    return { state: b.state, env: envInfo(), shine: b.shine };
  },
};

function onCommand(id, app) {
  if (id === 'desk' || id === 'sound' || id === 'grounded') {
    opts[id] = !opts[id];
    applyOpts(app);
    lastTray = '';
    trayUpdate(app);
    if (id === 'grounded' && opts.grounded) {
      // just grounded — any bird up in the air heads for the bottom now
      for (const b of flock()) {
        b.scared = false;
        b.loafAfter = false;
        b.flyTo = farSpot(cursor());
        setState(app, b, 'fly');
      }
    }
  } else if (id === 'crumbs') dropCrumbs(app);
  else if (id === 'sweep') sweep(app);
  else if (id === 'reset') {
    // Back to square one: clean floor, two pigeons, everyone starts over.
    sweep(app);
    while (opts.count > 2) removePigeon(app);
    const m = cursor();
    for (const b of flock()) {
      dissolvePair(b);
      b.scared = false;
      b.loafAfter = false;
      b.loafT = 0;
      b.fedGlow = 0;
      b.pile = null;
      b.flyTo = farSpot(m);
      setState(app, b, 'fly');
    }
    lastTray = '';
    trayUpdate(app);
  }
  else if (id === 'more') addPigeon(app);
  else if (id === 'fewer') removePigeon(app);
  else if (id === 'find') {
    // Call the flock — everyone flies in to loiter around mid-screen.
    flock().forEach((b, k) => {
      b.scared = false;
      b.loafAfter = false;
      b.flyTo = {
        x: clamp(screen.w / 2 - HALF + (k - (opts.count - 1) / 2) * 150, 0, screen.w - WIN),
        y: groundY(screen.h / 2 - HALF + rnd(-60, 60)),
      };
      setState(app, b, 'fly');
    });
  } else if (id === 'quit') app.quit();
}

export function onTray(id, app) { onCommand(id, app); }
export function onContextMenu(id, app) { onCommand(id, app); }
export function onHotkey(id, app) {
  // The hotkey always throws a fresh handful.
  if (id === 'crumbs') dropCrumbs(app);
}

export function init() {
  // Everything starts in api.boot, once each page's listeners are up.
}
