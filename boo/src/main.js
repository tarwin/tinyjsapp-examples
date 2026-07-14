// Boo — a shy little ghost that lives on your desktop. The transparent
// window IS the pet: it wanders around by moving itself, runs away when
// your cursor gets too close, and poofs to safety when you corner it.
// Win it over with a cookie (menu bar 👻, or ⌃⌥C): your cursor becomes
// the treat, and boo creeps over in nervous little bursts to eat it.
// A fed ghost is a friend — for a while it follows the cursor around and
// lets you pet it. Every cookie also grows a persisted `trust` stat, so
// boo gets a little braver every day you live together.
//
// The techniques on show:
//
//   1. FFI — the global cursor position comes straight from CoreGraphics
//      (`tjs:ffi` → CGEventGetLocation), so boo knows where your mouse is
//      even though it never touches boo's window. No helper process, no
//      Accessibility permission — and the coordinates are top-left origin,
//      the same space win.setPosition speaks.
//   2. A window that moves itself — app.setPosition every brain tick.
//      The page never changes size; the WINDOW is the sprite.
//   3. Menu-bar pet — "activation": "accessory" (no Dock icon), a tray
//      title that is boo's live mood (👻 🍪 ❤️ 💤), a global hotkey, and
//      tiny.store keeping `trust` across launches.

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
const WIN = 150;              // window size (tinyjs.json) — ghost sits centered
const HALF = WIN / 2;
const TOP = 26;               // stay out of the menu bar

let screen = { w: 1440, h: 900 };
let pos = { x: 400, y: 300 };            // window top-left, live
let vel = { x: 0, y: 0 };
let dir = 1;                             // 1 facing right, -1 left

let state = 'idle';           // idle | wander | flee | creep | eat | happy | sleep | poof
let stateT = 0;               // ticks in the current state
let t = 0;
let tame = 0;                 // 0..5, persisted — cookies eaten, capped
let cookie = false;           // the cursor is currently holding a treat
let happyLeft = 0;            // ticks of friendship remaining
let quiet = 0;                // calm ticks in a row → eventually a nap
let poofCool = 0;
let cornered = 0;
let wanderTo = null;
let idleFor = 100;
let timer = null;

const fleeRadius = () => Math.max(70, 170 - tame * 20);
const friendTicks = () => (20 + tame * 8) * (1000 / TICK);
const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------- moods

function setState(s, app) {
  if (state === s) return;
  state = s;
  stateT = 0;
  app.push('pet', { state, tame, cookie });
  trayUpdate(app);
}

const mood = () =>
  cookie ? '🍪' : state === 'sleep' ? '💤' : happyLeft > 0 ? '❤️' : '👻';

let lastTray = '';
function trayUpdate(app) {
  const sig = mood() + cookie + tame;
  if (sig === lastTray) return;            // tray.set repaints — only on change
  lastTray = sig;
  app.tray.set({
    title: mood(),
    menu: [
      { id: 'cookie', label: cookie ? 'Put the cookie away' : '🍪 Hold out a cookie  ⌃⌥C' },
      { id: 'find', label: '👋 Where’s boo?' },
      { separator: true },
      { id: 'trust', label: 'trust  ' + '★'.repeat(tame) + '☆'.repeat(5 - tame), enabled: false },
      { separator: true },
      { id: 'quit', label: 'Quit Boo' },
    ],
  });
}

// ------------------------------------------------------------------- moves

function farSpot(m) {
  for (let i = 0; i < 24; i++) {
    const p = { x: rnd(0, screen.w - WIN), y: rnd(TOP, screen.h - WIN) };
    if (Math.hypot(m.x - p.x - HALF, m.y - p.y - HALF) > 320) return p;
  }
  return { x: screen.w / 2 - HALF, y: screen.h / 2 - HALF };
}

// Ghosts don't get cornered — they vanish and reappear somewhere safer.
function poof(app) {
  setState('poof', app);
  vel = { x: 0, y: 0 };
  cornered = 0;
  poofCool = 100;
  app.push('poof', {});
  setTimeout(() => {
    pos = farSpot(cursor());
    app.setPosition(Math.round(pos.x), Math.round(pos.y));
    app.push('appear', {});
    setState('idle', app);
    idleFor = 60;
  }, 420);
}

function finishCookie(app) {
  cookie = false;
  tame = Math.min(5, tame + 1);
  app.store.set('tame', tame);
  happyLeft = friendTicks();
  setState('happy', app);
  app.push('hearts', { n: 5 });
}

// ------------------------------------------------------------------- brain

function tick(app) {
  t++; stateT++;
  if (poofCool > 0) poofCool--;
  if (state === 'poof') return;                       // mid-vanish
  if (state === 'sleep' && t % 5) return;             // dozing at 5 fps

  const m = cursor();
  const dx = m.x - (pos.x + HALF), dy = m.y - (pos.y + HALF);
  const d = Math.hypot(dx, dy) || 1;
  const flee = fleeRadius();

  let tvx = 0, tvy = 0, smooth = 0.18, focus = null;

  if (state === 'eat') {
    focus = m;
    if (stateT > 40) finishCookie(app);               // 1.6 s of nom
  } else if (cookie) {
    // Creep toward the treat in nervous little bursts: scurry, freeze, scurry.
    quiet = 0;
    focus = m;
    if (d < 34) {
      if (state !== 'eat') { setState('eat', app); app.push('eat', {}); }
    } else {
      if (state !== 'creep') setState('creep', app);
      const go = stateT % 34 < 22;
      const s = go ? (d > 350 ? 6.2 : 3.4) : 0;   // hurry over, tiptoe the last bit
      tvx = (dx / d) * s; tvy = (dy / d) * s;
      smooth = 0.3;
    }
  } else if (happyLeft > 0) {
    // Friendship: tag along ~110 px behind the cursor, like a puppy.
    quiet = 0;
    focus = m;
    if (--happyLeft === 0) {
      setState('idle', app); idleFor = 100; lastTray = ''; trayUpdate(app);
    } else {
      if (state !== 'happy') setState('happy', app);
      if (d > 160) { tvx = (dx / d) * 4.5; tvy = (dy / d) * 4.5; }
      else if (d < 60) { tvx = -(dx / d) * 2.2; tvy = -(dy / d) * 2.2; }
      smooth = 0.15;
    }
  } else if (d < flee) {
    // Too close! Run away (with a wobble of panic).
    quiet = 0;
    focus = m;
    if (state === 'sleep') app.push('say', { text: '!' });   // rude awakening
    if (state !== 'flee') setState('flee', app);
    const s = 11, wig = Math.sin(t * 0.7) * 2.2;
    tvx = -(dx / d) * s + (-dy / d) * wig;
    tvy = -(dy / d) * s + (dx / d) * wig;
    smooth = 0.35;
  } else {
    // Nobody's bothering us. Bob, wander, nap.
    quiet++;
    if (d < flee * 1.8) focus = m;                    // …but keep an eye on you
    if (state === 'flee' && stateT < 20) {
      smooth = 0.2;                                   // coast out of the scare
    } else if (state === 'sleep') {
      // zzz
    } else if (quiet > 1100) {
      setState('sleep', app);
    } else if (state === 'wander' && wanderTo) {
      const wx = wanderTo.x - pos.x, wy = wanderTo.y - pos.y;
      const wd = Math.hypot(wx, wy);
      if (wd < 8) { setState('idle', app); idleFor = rnd(75, 280); wanderTo = null; }
      else {
        tvx = (wx / wd) * 1.7; tvy = (wy / wd) * 1.7; smooth = 0.1;
        if (!focus) focus = { x: wanderTo.x + HALF, y: wanderTo.y + HALF };
      }
    } else {
      if (state !== 'idle') setState('idle', app);
      if (--idleFor <= 0) {
        wanderTo = { x: rnd(0, screen.w - WIN), y: rnd(TOP, screen.h - WIN) };
        setState('wander', app);
      } else if (Math.random() < 0.0015) {
        app.push('say', { text: ['…', '♪', 'boo!'][Math.floor(Math.random() * 3)] });
      }
    }
  }

  // Integrate, clamp to the screen, notice when we're pinned to an edge.
  vel.x += (tvx - vel.x) * smooth;
  vel.y += (tvy - vel.y) * smooth;
  const wantX = pos.x + vel.x, wantY = pos.y + vel.y;
  const nx = Math.min(Math.max(wantX, 0), screen.w - WIN);
  const ny = Math.min(Math.max(wantY, TOP), screen.h - WIN);
  const blocked = Math.abs(nx - wantX) > 0.5 || Math.abs(ny - wantY) > 0.5;

  if (state === 'flee' && blocked && d < flee) {
    if (++cornered > 10 && poofCool === 0) return poof(app);
  } else cornered = 0;

  if (Math.abs(nx - pos.x) >= 0.5 || Math.abs(ny - pos.y) >= 0.5) {
    pos.x = nx; pos.y = ny;
    app.setPosition(Math.round(nx), Math.round(ny));
  }

  if (Math.abs(vel.x) > 0.6) dir = vel.x > 0 ? 1 : -1;

  // Where boo is looking, at ~8 Hz — the page eases the pupils over.
  if (t % 3 === 0) {
    let lx = 0, ly = 0;
    if (focus) {
      const fx = focus.x - (pos.x + HALF), fy = focus.y - (pos.y + HALF);
      const fd = Math.hypot(fx, fy) || 1;
      lx = fx / fd; ly = fy / fd;
    }
    app.push('look', {
      x: +lx.toFixed(2), y: +ly.toFixed(2), dir,
      moving: Math.hypot(vel.x, vel.y) > 0.7,
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

function toggleCookie(app) {
  cookie = !cookie;
  if (!cookie && (state === 'creep' || state === 'eat')) setState('idle', app);
  if (cookie && state === 'sleep') { quiet = 0; setState('idle', app); }
  app.push('pet', { state, tame, cookie });
  lastTray = '';                           // label text changes — force repaint
  trayUpdate(app);
}

export const api = {
  boot: async (_p, app) => {
    if (!timer) {
      tame = (await app.store.get('tame')) || 0;
      const st = await app.getWinState();
      screen = { w: st.screen.width, h: st.screen.height };
      pos = farSpot(cursor());             // materialize away from the cursor
      app.setPosition(Math.round(pos.x), Math.round(pos.y));
      app.setAlwaysOnTop(true);
      app.setResizable(false);
      app.show();                          // accessory apps start hidden — position first, then appear
      app.setContextMenu([
        { id: 'cookie', label: '🍪 Hold out a cookie' },
        { separator: true },
        { id: 'quit', label: 'Quit Boo' },
      ]);
      try { app.hotkey.register('cookie', 'ctrl+alt+c'); } catch { /* taken — the menu still works */ }
      trayUpdate(app);
      timer = setInterval(() => {
        try { tick(app); } catch (e) { console.log('boo tick:', e); }
      }, TICK);
    }
    return { state, tame, cookie };
  },

  // The ghost got clicked. A friend enjoys it; anyone else is startled.
  poke: (_p, app) => {
    if (happyLeft > 0) { happyLeft += 50; app.push('hearts', { n: 1 }); }
    else if (state !== 'eat' && state !== 'poof') {
      app.push('say', { text: state === 'sleep' ? '!!' : 'boo!' });
      quiet = 0;
      poof(app);
    }
    return true;
  },

  // Slow mouse strokes over a happy ghost = petting.
  petted: (_p, app) => {
    if (happyLeft > 0) {
      happyLeft = Math.min(happyLeft + 40, friendTicks());
      app.push('hearts', { n: 1 });
    }
    return true;
  },
};

function onCommand(id, app) {
  if (id === 'cookie') toggleCookie(app);
  else if (id === 'find') poof(app);       // peekaboo — reappears somewhere fresh
  else if (id === 'quit') app.quit();
}

export function onTray(id, app) { onCommand(id, app); }
export function onContextMenu(id, app) { onCommand(id, app); }
export function onHotkey(id, app) { if (id === 'cookie') toggleCookie(app); }

export function init() {
  // Everything starts in api.boot, once the page's listeners are up.
}
