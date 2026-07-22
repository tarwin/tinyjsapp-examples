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

// ------------------------------------------------- cursor, per-platform
//
// macOS reads the global cursor straight from CoreGraphics via FFI —
// synchronous, no permission, top-left origin (the space win.setPosition
// speaks). Windows has no CoreGraphics, so there the flock asks the framework
// instead: app.mousePosition() answers in those same top-left coordinates.
// It's async, so boot() polls it into `winCursor` every brain tick and
// cursor() returns that cached value — the brain stays synchronous and every
// line below is untouched. (Only `new Lib('/System/…')` breaks on Windows;
// importing tjs:ffi itself is fine on both platforms.)

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

const TICK = 40;              // 25 fps brain
const WIN = 200;              // pigeon window size — bird sits centered
const HALF = WIN / 2;
const TOP = 26;               // stay out of the menu bar
const FLOOR = 50;             // grounded birds may hang this far below the
                              // bottom edge — puts their FEET on the floor

const PIGS = ['main', ...Array.from({ length: 19 }, (_, i) => 'p' + (i + 1))];
// Chromium starts evicting WebGL contexts past ~16 per process, so the full
// twenty-bird roster is a macOS luxury — Windows/Linux get a polite eight.
const MAX_PIGS = IS_WIN ? 8 : PIGS.length;
const NAMES = ['Waddles', 'Bert', 'Mildred', 'Gerald', 'Pidge',
               'Nigel', 'Doreen', 'Elvis', 'Beryl', 'Crumb',
               'Pepper', 'Squab', 'Marge', 'Colin', 'Dot',
               'Rocco', 'Fern', 'Stan', 'Peanut', 'Val'];
// frameless + transparent must ride ALONG with openWindow — chrome applied
// after the first paint flashes a white default window
const CHROME = { frame: false, trafficLights: false, transparent: true };
const CRUMB_POOL = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];   // up to six piles out at once
const POOP_POOL = ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'];

let screen = { w: 1440, h: 900 };
let opts = {                  // persisted tray toggles
  desk: false,                // live ON the desktop (behind windows) vs float above
  volume: 'medium',           // how loud the coo is: off | low | medium | high
  shhh: false,                // library mode — only the occasional sound slips out
  grounded: false,            // ground business stays near the screen bottom
  count: 3,                   // pigeons in the flock, 2..20
};
const VOLS = { off: 0, low: 0.25, medium: 0.6, high: 1 };
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
    walkTo: null, flyTo: null, flyVia: null,
    scared: false,    // this flight is a getaway, not a commute
    offstage: false,  // still outside the screen, flying in — no wall clamp yet
    exiting: false,   // current flight leaves the screen entirely
    away: 0,          // ticks left off-screen before flying back in
    loafAfter: false, // this flight ends in a long sit, not an idle
    loafT: 0,
    noticeIn: 0,      // reaction ticks before fresh crumbs register
    fedGlow: 0,       // recently fed — brave (for a pigeon)
    cooCool: 0, replyIn: 0, crowdCool: 0,
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
  const sig = mood() + anyCrumbs() + anyPoop() + opts.desk + opts.volume + opts.shhh + opts.grounded + opts.count;
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
      { id: 'more', label: `➕ One more pigeon (${opts.count})`, enabled: opts.count < MAX_PIGS },
      { id: 'fewer', label: `➖ One fewer pigeon`, enabled: opts.count > 2 },
      { id: 'pandemonium', label: `🌪️ Pandemonium (all ${MAX_PIGS === 20 ? 'twenty' : MAX_PIGS}, at once)`, enabled: opts.count < MAX_PIGS },
      { id: 'reset', label: '🧼 Fresh start (two pigeons, clean floor)' },
      { separator: true },
      { id: 'desk', label: tick(opts.desk) + '🖥️ Live on the desktop' },
      { id: 'grounded', label: tick(opts.grounded) + '🌱 Grounded (keep to the bottom)' },
      { id: 'vol', label: '🔊 Coo volume', submenu: [
        { id: 'vol-off', label: 'Off', checked: opts.volume === 'off' },
        { id: 'vol-low', label: 'Low', checked: opts.volume === 'low' },
        { id: 'vol-medium', label: 'Medium', checked: opts.volume === 'medium' },
        { id: 'vol-high', label: 'High', checked: opts.volume === 'high' },
        { separator: true },
        { id: 'shhh', label: '🤫 Shhhhh (only the odd coo)', checked: opts.shhh },
      ]},
      { separator: true },
      { id: 'check-updates', label: 'Check for Updates…' },
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
  opts.grounded ? clamp(y, screen.h - WIN - 70, screen.h - WIN + FLOOR) : y;

// A grounded bird stranded high up (a scare took the sky) — its next move
// should be a flight down, never a hike down the screen on foot.
const highUp = (b) => opts.grounded && b.pos.y < screen.h - WIN - 180;

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

// What a sound actually plays at: the tray volume scales it, and Shhhhh mode
// swallows most of them whole — a pigeon with library manners. 0 means silent.
function sayVol(base) {
  const f = VOLS[opts.volume] || 0;
  if (!f) return 0;
  if (opts.shhh && Math.random() > 0.12) return 0;
  return +(base * f).toFixed(2);
}

// Every audible moment goes out as a kind + pan + vol; the main window's
// page owns the actual recordings and does the mixing.
// kinds: coo | coolong (the courtship number) | call (alarm) |
//        takeoff (casual wings) | scatter (panicked wings) | distant
function say(app, b, kind, loud) {
  const v = sayVol(rnd(loud ? 0.55 : 0.3, loud ? 0.9 : 0.7));
  if (!v) return;
  app.push('say', { who: b.winId, kind, pan: cooPan(b), vol: v });
}

// Too close, too fast! One pigeon's panic is everyone's panic — birds near
// the spooked one go up too. Very pigeon.
function spook(app, b, m, chain = true) {
  b.scared = true;
  b.loafAfter = false;
  b.pile = null;
  dissolvePair(b);
  if (opts.grounded) {
    // panic still gets the whole sky — but only as a WAYPOINT: soar up and
    // away from the cursor first, then come back down and land on the ground
    const awayX = b.pos.x + (b.pos.x + HALF < m.x ? -1 : 1) * rnd(220, 520);
    b.flyVia = { x: clamp(awayX, 0, screen.w - WIN), y: rnd(TOP + 20, screen.h * 0.45) };
    b.flyTo = farSpot(m);            // grounded ⇒ a spot on the strip
  } else {
    b.flyVia = null;
    b.flyTo = farSpot(m);
  }
  say(app, b, 'call', true);
  setState(app, b, 'fly');
  if (!chain) return;
  for (const o of flock()) {
    if (o === b || o.state === 'fly' || o.away > 0 || !ready.has(o.winId)) continue;
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
  const near = flock().filter((o) => o !== b && o.cooCool === 0 && !o.away &&
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
    o !== b && o.buddy < 0 && o.loafT === 0 && !o.away &&
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
  // A fresh throw lands wherever bread lands. Six piles can be out at
  // once; a seventh throw replaces the stalest one. Both y ranges keep the
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

// Any number of pigeons crowd a pile, each on its own bearing — but they
// stand BESIDE the crumbs, not on them: in profile a pigeon's beak reaches
// ~45px ahead of its center, so parking the body ~50px to the side (the eat
// state faces the pile) puts the pecking HEAD over the pile instead of the
// whole bird. Feet sit ~50px below window center, hence the y - 45.
function pileSpot(b, win) {
  const p = piles[win];
  const ang = b.i * 2.4 + p.x * 0.013;
  const side = Math.cos(ang) >= 0 ? 1 : -1;
  return {
    x: p.x + side * (46 + Math.abs(Math.sin(ang)) * 12),
    y: p.y - 45 + Math.sin(ang) * 10,
  };
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
  // Off the screen entirely, being a pigeon somewhere else for a while.
  if (b.away > 0) {
    if (--b.away === 0) flyBackIn(app, b);
    return;
  }
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
    } else if (d < fleeRadius(b) * 1.9 && mv > 5 && b.waddleCool === 0 && !highUp(b) &&
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

  // Personal space: pigeons like company at wing's length, not in the face.
  // Another bird right on top of this one usually makes it step aside —
  // usually: sometimes it just doesn't care (they're pigeons), and nobody
  // minds a crowd around food.
  if (b.crowdCool > 0) b.crowdCool--;
  else if ((b.state === 'idle' || b.state === 'walk' || b.state === 'peck') &&
           !b.pile && !(b.noticeIn === 0 && nearestPile(b))) {
    const near = flock().find((o) => o !== b && !o.away && o.state !== 'fly' &&
      Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y) < 85);
    if (near) {
      b.crowdCool = Math.round(rnd(150, 350));
      if (Math.random() < 0.7) {
        const ang = Math.atan2(b.pos.y - near.pos.y, b.pos.x - near.pos.x) + rnd(-0.6, 0.6);
        b.walkTo = {
          x: clamp(b.pos.x + Math.cos(ang) * rnd(90, 150), 0, screen.w - WIN),
          y: groundY(clamp(b.pos.y + Math.sin(ang) * rnd(50, 90), TOP, screen.h - WIN)),
        };
        b.loafT = 0;
        setState(app, b, 'walk');
      }
    }
  }

  let tvx = 0, tvy = 0, smooth = 0.16, focus = null;

  if (b.state === 'fly') {
    // A leaving bird is gone the moment it's fully past the edge: hide the
    // window, start the elsewhere-timer, and fly back in when it runs out.
    if (b.exiting && (b.pos.x <= -WIN || b.pos.x >= screen.w)) {
      b.exiting = false;
      b.away = Math.round(rnd(400, 1800));       // 16–72 s of elsewhere
      try { bwin(app, b).hide(); } catch (e) {}
      b.state = 'idle';                          // quietly — the page is hidden
      return;
    }
    // A grounded scare climbs via its sky waypoint before heading for the
    // actual (on-the-ground) landing spot.
    if (b.scared && b.flyVia &&
        Math.hypot(b.flyVia.x - b.pos.x, b.flyVia.y - b.pos.y) < 44) b.flyVia = null;
    const aim = (b.scared && b.flyVia) ? b.flyVia : b.flyTo;
    const fx = aim.x - b.pos.x, fy = aim.y - b.pos.y;
    const fd = Math.hypot(fx, fy) || 1;
    if (fd < 26 && !b.exiting && aim === b.flyTo) {
      b.scared = false;
      b.flyVia = null;
      setState(app, b, 'land');
    } else {
      const sp = (b.scared ? 12 : 8.5) * b.speed;
      tvx = (fx / fd) * sp * Math.min(1, fd / 60);
      tvy = (fy / fd) * sp * Math.min(1, fd / 60) + Math.sin(t * 0.2 + b.i * 2.1) * 1.4;
      smooth = 0.13;
      focus = { x: aim.x + HALF, y: aim.y + HALF };
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
      const ux = (s0.x - cx) / sd, uy = (s0.y - cy) / sd;
      // weave a personal line to the food (fading out on final approach) —
      // a flock converging on identical rails reads as one bird, copy-pasted
      const w = Math.sin(t * 0.09 + b.i * 2.1) * Math.min(1, sd / 110) * 1.1;
      tvx = ux * s - uy * w;
      tvy = uy * s + ux * w;
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
        const ux = wx / wd, uy = wy / wd;
        const w = Math.sin(t * 0.07 + b.i * 1.7) * Math.min(1, wd / 90) * 0.6;
        tvx = ux * 2.0 * b.speed - uy * w;
        tvy = uy * 2.0 * b.speed + ux * w;
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
      if (highUp(b)) {
        // perched high in grounded mode — take the wing back to the strip
        b.loafAfter = false;
        b.flyTo = farSpot({ x: cx, y: cy });
        setState(app, b, 'fly');
      } else if (r < 0.2) { setState(app, b, 'peck'); b.dur = rnd(40, 80); }
      else if (r < 0.3 && b.cooCool === 0) startCoo(app, b, false);
      else if (r < 0.38 && o && od < 300) {
        // the courtship number: puff up, strut a little circle at them,
        // and give it the full long coo
        setState(app, b, 'circle');
        b.dur = 90;
        if (b.cooCool === 0) { b.cooCool = 300; say(app, b, 'coolong', false); }
      } else if (r < 0.48) {
        // bored — up and away. Some of these flights end in a long loaf on
        // the screen edge; once in a while a pigeon leaves the screen
        // ENTIRELY and is just… gone for a bit (they have lives out there).
        // The main window can't do that — hiding it NSApp-hides the whole
        // flock — so Waddles, alone, always stays. In grounded mode a few
        // flights still take the open sky and drift back down later.
        dissolvePair(b);
        if (b.i > 0 && Math.random() < 0.15) {
          b.loafAfter = false;
          b.exiting = true;
          const left = b.pos.x + HALF < screen.w / 2;
          // departures may climb — grounded only restricts landing and walking
          b.flyTo = {
            x: left ? -WIN - 60 : screen.w + 60,
            y: clamp(b.pos.y + rnd(-320, 40), TOP, screen.h - WIN),
          };
        } else {
          b.loafAfter = Math.random() < 0.4;
          b.flyTo = b.loafAfter ? loafSpot() : farSpot({ x: cx, y: cy });
        }
        setState(app, b, 'fly');
      } else if (r < 0.56 && b.buddy < 0 && tryPair(b)) {
        // sidle over to the new acquaintance — to wing's length on your OWN
        // side, never onto their head
        const n = birds[b.buddy];
        const ang = Math.atan2(b.pos.y - n.pos.y, b.pos.x - n.pos.x) + rnd(-0.5, 0.5);
        const rad = rnd(90, 160);
        b.walkTo = {
          x: clamp(n.pos.x + Math.cos(ang) * rad, 0, screen.w - WIN),
          y: groundY(clamp(n.pos.y + Math.sin(ang) * rad * 0.7, TOP, screen.h - WIN)),
        };
        setState(app, b, 'walk');
      } else {
        // Stroll; a paired bird potters along near its buddy — again keeping
        // to its own side of the friendship, a body-length back.
        if (o && od > 220) {
          const ang = Math.atan2(b.pos.y - o.pos.y, b.pos.x - o.pos.x) + rnd(-0.7, 0.7);
          const rad = rnd(100, 180);
          b.walkTo = {
            x: clamp(o.pos.x + Math.cos(ang) * rad, 0, screen.w - WIN),
            y: groundY(clamp(o.pos.y + Math.sin(ang) * rad * 0.7, TOP, screen.h - WIN)),
          };
        } else {
          b.walkTo = {
            x: clamp(b.pos.x + rnd(-240, 240), 0, screen.w - WIN),
            y: groundY(clamp(b.pos.y + rnd(-140, 140), TOP, screen.h - WIN)),
          };
        }
        setState(app, b, 'walk');
      }
    }
  }

  // Integrate, clamp to the screen; a flight pinned to an edge just retargets.
  // A bird still offstage (flying in from beyond the edge) skips the side
  // walls until it has actually arrived — clamping would teleport it on.
  b.vel.x += (tvx - b.vel.x) * smooth;
  b.vel.y += (tvy - b.vel.y) * smooth;
  const wantX = b.pos.x + b.vel.x, wantY = b.pos.y + b.vel.y;
  if (b.offstage && wantX >= 0 && wantX <= screen.w - WIN) b.offstage = false;
  const free = b.offstage || b.exiting;          // allowed beyond the side walls
  const nx = free ? wantX : clamp(wantX, 0, screen.w - WIN);
  const ny = clamp(wantY, TOP, screen.h - WIN + (opts.grounded ? FLOOR : 0));
  if (!free && b.state === 'fly' && (Math.abs(nx - wantX) > 0.5 || Math.abs(ny - wantY) > 0.5)) {
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
    .filter((b) => ready.has(b.winId) && !b.away)   // show() would unhide an away bird
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
  for (let i = departing.length - 1; i >= 0; i--) {
    if (departTick(app, departing[i])) departing.splice(i, 1);
  }
  if (t % 6 === 0) raiseFlock(app);
  if (t % 25 === 0) trayUpdate(app);
  // ambience: while somebody's loafing on an edge, the city coos back —
  // faint, far away, every couple of minutes
  if (--distantIn <= 0) {
    const loafer = flock().find((b) => b.state === 'loaf');
    if (loafer && VOLS[opts.volume] > 0) {
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

// Back from wherever pigeons go: pop in past a side edge and wing in.
function flyBackIn(app, b, target) {
  b.away = 0;
  b.exiting = false;
  b.scared = false;
  b.loafAfter = false;
  b.pos = { x: Math.random() < 0.5 ? -WIN - 40 : screen.w + 40, y: rnd(TOP, screen.h / 2) };
  b.offstage = true;
  b.flyTo = target || farSpot(cursor());   // grounded lands it on the strip
  try {
    const h = bwin(app, b);
    h.setPosition(Math.round(b.pos.x), Math.round(b.pos.y));
    h.show({ activate: false });
  } catch (e) {}
  setState(app, b, 'fly');
}

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
  if (opts.count >= MAX_PIGS) return;
  const b = birds[opts.count];
  opts.count++;
  const di = departing.indexOf(b);
  if (di >= 0) {
    // caught mid-departure — turn around and rejoin, from wherever it got to
    departing.splice(di, 1);
    b.offstage = b.pos.x < 0 || b.pos.x > screen.w - WIN;
  } else {
    // the new arrival starts fully OFF the screen and wings in — at any
    // height (grounded only restricts landing/walking; farSpot grounds the
    // destination, so the approach is a descent)
    b.pos = { x: Math.random() < 0.5 ? -WIN - 40 : screen.w + 40, y: rnd(TOP, screen.h / 2) };
    b.offstage = true;
  }
  b.away = 0;
  b.exiting = false;
  b.flyTo = farSpot(cursor());
  b.state = 'fly';
  b.stateT = 0;
  b.scared = false;
  openPigeon(app, b);
  applyOpts(app);
  lastTray = '';
  trayUpdate(app);
}

const departing = [];   // removed birds still flying off — steered by departTick

function removePigeon(app) {
  if (opts.count <= 2) return;
  opts.count--;
  const b = birds[opts.count];
  dissolvePair(b);
  b.pile = null;
  b.scared = false;
  b.loafAfter = false;
  b.loafT = 0;
  // out, but with dignity: fly for the nearest side edge — departTick closes
  // the window only once the bird is actually off the screen
  const off = b.pos.x + HALF < screen.w / 2 ? -WIN - 60 : screen.w + 60;
  b.flyTo = { x: off, y: clamp(b.pos.y + rnd(-140, 60), TOP, screen.h - WIN) };
  setState(app, b, 'fly');
  if (!departing.includes(b)) departing.push(b);
  applyOpts(app);
  lastTray = '';
  trayUpdate(app);
}

// A departing bird is out of the flock (tickBird no longer runs it), so its
// exit flight is steered here: straight for the offstage target, no wall
// clamps, hide on arrival. Returns true when done.
function departTick(app, b) {
  const fx = b.flyTo.x - b.pos.x, fy = b.flyTo.y - b.pos.y;
  const fd = Math.hypot(fx, fy) || 1;
  const sp = 10 * b.speed;
  b.vel.x += ((fx / fd) * sp - b.vel.x) * 0.13;
  b.vel.y += ((fy / fd) * sp + Math.sin(t * 0.2 + b.i * 2.1) * 1.4 - b.vel.y) * 0.13;
  b.pos.x += b.vel.x;
  b.pos.y += b.vel.y;
  bwin(app, b).setPosition(Math.round(b.pos.x), Math.round(b.pos.y));
  if ((t + b.i) % 3 === 0) {
    app.push('look', {
      who: b.winId, x: +(fx / fd).toFixed(2), y: +(fy / fd).toFixed(2),
      dir: fx >= 0 ? 1 : -1, moving: true, fast: false,
      wx: Math.round(b.pos.x), wy: Math.round(b.pos.y),
    });
  }
  if (b.pos.x <= -WIN || b.pos.x >= screen.w || fd < 24) {
    // gone for real: CLOSE the window rather than hide it — a hidden window
    // re-shown later can flash at its stale position before it repositions.
    // A re-add just openWindows a fresh one (and re-boots its page).
    try { app.window(b.winId).close(); } catch (e) {}
    opened.delete(b.winId);
    ready.delete(b.winId);
    return true;
  }
  return false;
}

// --------------------------------------------------------------------- api

export const api = {
  boot: async (_p, app, meta) => {
    const id = meta.window;

    if (id === 'main' && !ready.has('main')) {
      if (IS_WIN) {
        // No FFI cursor on Windows — poll the backend into winCursor. Seed it
        // once before farSpot(cursor()) scatters the flock below, then refresh
        // it every brain tick so cursor() (used all over the sync brain) stays
        // current.
        const pollCursor = async () => {
          try { const m = await app.mousePosition(); if (m) winCursor = { x: m.x, y: m.y }; }
          catch { /* transient — keep the last known position */ }
        };
        await pollCursor();
        setInterval(pollCursor, TICK);
      }
      opts = Object.assign(opts, (await app.store.get('opts')) || {});
      // stores from before volume levels have a boolean `sound`
      if ('sound' in opts) { opts.volume = opts.sound ? 'medium' : 'off'; delete opts.sound; }
      if (!(opts.volume in VOLS)) opts.volume = 'medium';
      opts.count = clamp(opts.count, 2, MAX_PIGS);
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
  if (id.startsWith('vol-')) {
    opts.volume = id.slice(4);
    applyOpts(app);
    lastTray = '';
    trayUpdate(app);
  } else if (id === 'desk' || id === 'shhh' || id === 'grounded') {
    opts[id] = !opts[id];
    applyOpts(app);
    lastTray = '';
    trayUpdate(app);
    if (id === 'grounded' && opts.grounded) {
      // just grounded — any bird up in the air heads for the bottom now
      for (const b of flock()) {
        if (b.away) continue;              // it'll obey when it's back
        b.scared = false;
        b.loafAfter = false;
        b.exiting = false;
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
      b.loafT = 0;
      b.fedGlow = 0;
      b.pile = null;
      if (b.away) { flyBackIn(app, b, farSpot(m)); continue; }
      b.scared = false;
      b.loafAfter = false;
      b.exiting = false;
      b.flyTo = farSpot(m);
      setState(app, b, 'fly');
    }
    lastTray = '';
    trayUpdate(app);
  }
  else if (id === 'more') addPigeon(app);
  else if (id === 'fewer') removePigeon(app);
  else if (id === 'pandemonium') {
    // the whole roster at once, each flying in from its own edge
    while (opts.count < MAX_PIGS) addPigeon(app);
  }
  else if (id === 'find') {
    // Call the flock — everyone flies in to loiter around mid-screen,
    // including anyone currently off having a life elsewhere.
    flock().forEach((b, k) => {
      const to = {
        x: clamp(screen.w / 2 - HALF + (k - (opts.count - 1) / 2) * 150, 0, screen.w - WIN),
        y: groundY(screen.h / 2 - HALF + rnd(-60, 60)),
      };
      if (b.away) return flyBackIn(app, b, to);
      b.scared = false;
      b.loafAfter = false;
      b.exiting = false;
      b.flyTo = to;
      setState(app, b, 'fly');
    });
  } else if (id === 'quit') app.quit();
}

export function onTray(id, app) {
  if (id === 'check-updates') return checkForUpdates(app); onCommand(id, app); }
export function onContextMenu(id, app) { onCommand(id, app); }
export function onHotkey(id, app) {
  // The hotkey always throws a fresh handful.
  if (id === 'crumbs') dropCrumbs(app);
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
