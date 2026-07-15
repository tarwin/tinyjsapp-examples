// amp — a Winamp-style player where each pane is a REAL native window.
//
// tinyjs multi-window gives every html file in the frontend its own OS window
// (app.openWindow / tiny.win.open), each running the full bridge. So the
// player, playlist, equalizer, and Milkdrop visualizer aren't faked <div>s
// like the web Winamp — they're four independent windows you drag, snap, and
// (the viz) send fullscreen.
//
// Windows can't talk to each other directly, so this backend is the hub:
//   • main (the audio host / brain) → publish(state) → we broadcast 'state'
//   • playlist/eq/viz → action(a)   → we push it to main
//   • any new window                → hello() / windowReady() for its state
// It also owns everything cross-window: dragging a docked group in lockstep,
// the global always-on-top flag, docked-edge highlighting, and persisting the
// whole layout (which panels are open, positions, shade state) across launches.
// The pages load audio straight off disk (tinyjs.json "readAccess": true), so
// no audio bytes ever cross the bridge.

const CHROME = { frame: false, trafficLights: false, squareCorners: true };
// The visualizer must be able to enter NATIVE fullscreen, which macOS only
// allows on a titled window — squareCorners makes a window truly borderless
// (no fullscreen), so viz keeps plain frameless chrome.
const VIZ_CHROME = { frame: false, trafficLights: false };
const SATELLITES = {
  playlist: { page: 'playlist.html', title: 'amp — playlist', size: '320x260', chrome: CHROME },
  eq:       { page: 'eq.html',       title: 'amp — equalizer', size: '320x180', chrome: CHROME },
  viz:      { page: 'viz.html',      title: 'amp — visualizer', size: '640x430', chrome: VIZ_CHROME },
};

let latest = null;                 // last state main published (for new windows)
const shown = { playlist: false, eq: false, viz: false };
let alwaysOnTop = false;
let store = null;

const setP = (k, v) => { try { store.set(k, v); } catch (e) {} };
function persist() {
  if (!latest) return;
  setP('playlist', (latest.tracks || []).map((t) => ({ path: t.path, name: t.name })));
  setP('meta', { volume: latest.volume, balance: latest.balance, eq: latest.eq, idx: latest.idx });
}

export const api = {
  hello: () => latest,

  publish: (state, app) => {
    latest = state;
    app.push('state', state);   // main ignores its own 'state' events
    persist();
    updateTray(app);
    return true;
  },

  // playlist/eq/viz → main. Routed because windows can't reach each other.
  action: (a, app) => { app.window('main').push('action', a); return true; },

  fileSize: async ({ path }) => { try { return (await tjs.stat(path)).size; } catch (e) { return 0; } },

  // Expand dropped paths: a directory becomes its immediate audio files (one
  // level, no recursion into subfolders); plain files pass straight through.
  resolveDrop: async ({ paths }) => {
    const AUDIO = /\.(mp3|m4a|aac|mp4|flac|wav|aif|aiff|caf|oga|ogg|opus)$/i;
    const out = [];
    for (const p of paths) {
      let isDir = false;
      try { isDir = !!(await tjs.stat(p)).isDirectory; } catch (e) { continue; }
      if (!isDir) { out.push(p); continue; }
      try {
        const names = [];
        for await (const e of await tjs.readDir(p)) if (!e.isDirectory && AUDIO.test(e.name)) names.push(e.name);
        names.sort((a, b) => a.localeCompare(b));
        for (const n of names) out.push(p.replace(/\/+$/, '') + '/' + n);
      } catch (e) {}
    }
    return out;
  },

  // A window (any) reports it's up and asks for its per-window restore bits.
  windowReady: async ({ id }) => {
    let shade = false;
    try { shade = !!(await store.get('shade:' + id)); } catch (e) {}
    return { shade, onTop: alwaysOnTop };
  },

  // Show/hide a satellite window (close button hides so positions survive).
  toggleWindow: async ({ id }, app) => {
    const cfg = SATELLITES[id];
    if (!cfg) return false;
    const wins = await app.windows();
    if (!wins.includes(id)) {
      const pos = await computePos(app, id);
      app.openWindow(id, { ...cfg, ...(pos || {}) });
      shown[id] = true;
      if (alwaysOnTop) setTimeout(() => { try { app.window(id).setAlwaysOnTop(true); } catch (e) {} }, 50);
    } else if (shown[id]) {
      app.window(id).hide();
      shown[id] = false;
    } else {
      app.window(id).show({ activate: false });
      shown[id] = true;
    }
    setP('panels', { ...shown });
    app.push('windows', { ...shown });
    setTimeout(() => refreshDocking(app), 120);
    return shown[id];
  },

  setShown: ({ id, value }, app) => {
    shown[id] = value; setP('panels', { ...shown });
    app.push('windows', { ...shown });
    return true;
  },

  windowState: () => ({ ...shown }),

  // ── snapping + group drag ─────────────────────────────────────────────────
  rects: async (_p, app) => {
    const out = {};
    for (const id of await app.windows()) {
      if (id !== 'main' && !shown[id]) continue;     // skip hidden satellites
      try { const s = await app.window(id).getState(); out[id] = { x: s.x, y: s.y, width: s.width, height: s.height }; }
      catch (e) {}
    }
    return out;
  },
  screens: (_p, app) => app.screens ? app.screens() : [],
  // Move a whole docked group in ONE call so main and its satellites stay in
  // lockstep (per-window round-trips lag and look broken).
  moveGroup: ({ moves }, app) => {
    for (const m of moves || []) { try { app.window(m.id).setPosition(m.x, m.y); } catch (e) {} }
    return true;
  },
  savePos: ({ id, x, y }) => { setP('pos:' + id, { x, y }); return true; },
  refreshDock: (_p, app) => { refreshDocking(app); return true; },   // called live while dragging

  // Click any amp window → bring the whole set to the front (keeps them
  // together in z-order, like Winamp), the clicked one raised last so it stays
  // on top. show({ activate: false }) reorders without stealing its focus.
  raiseAll: async ({ except }, app) => {
    for (const id of await app.windows()) {
      if (id === except || (id !== 'main' && !shown[id])) continue;
      try { app.window(id).show({ activate: false }); } catch (e) {}
    }
    try { app.window(except).show({ activate: false }); } catch (e) {}
    return true;
  },

  // ── global always-on-top (all windows at once) ────────────────────────────
  setOnTop: ({ value }, app) => { setOnTop(app, !!value); return alwaysOnTop; },

  // ── windowshade persistence ───────────────────────────────────────────────
  setShade: ({ id, value }, app) => { setP('shade:' + id, !!value); setTimeout(() => refreshDocking(app), 60); return true; },

  // A window changed height by `dh` (shade/unshade). Slide the windows docked
  // BELOW it — and the ones docked below those — by `dh` so they stay attached.
  reflow: async ({ id, dh, x0, x1, oldBottom }, app) => {
    const rects = {};
    for (const wid of await app.windows()) {
      if (wid === id || (wid !== 'main' && !shown[wid])) continue;
      try { const s = await app.window(wid).getState(); rects[wid] = { x: s.x, y: s.y, w: s.width, h: s.height }; } catch (e) {}
    }
    const seen = new Set(), toMove = [];
    let frontier = [{ x0, x1, bottom: oldBottom }];
    while (frontier.length) {
      const f = frontier.shift();
      for (const wid in rects) {
        if (seen.has(wid)) continue;
        const w = rects[wid];
        if (w.x < f.x1 + 4 && f.x0 < w.x + w.w + 4 && Math.abs(w.y - f.bottom) <= 6) {
          seen.add(wid); toMove.push(wid);
          frontier.push({ x0: w.x, x1: w.x + w.w, bottom: w.y + w.h });
        }
      }
    }
    for (const wid of toMove) { const w = rects[wid]; try { app.window(wid).setPosition(w.x, w.y + dh); } catch (e) {} }
    setTimeout(() => refreshDocking(app), 40);
    return true;
  },
};

async function setOnTop(app, value) {
  alwaysOnTop = value;
  setP('ontop', value);
  for (const id of await app.windows()) { try { app.window(id).setAlwaysOnTop(value); } catch (e) {} }
  app.push('ontop', value);   // update every window's context-menu checkmark
  updateTray(app);
}

// Which edges of each window are flush against another → push so the page can
// highlight the "attached" edge.
async function refreshDocking(app) {
  const rects = {};
  for (const id of await app.windows()) {
    if (id !== 'main' && !shown[id]) continue;
    try { const s = await app.window(id).getState(); rects[id] = { x: s.x, y: s.y, w: s.width, h: s.height }; } catch (e) {}
  }
  const ids = Object.keys(rects), T = 6;
  const ov = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
  for (const id of ids) {
    const a = rects[id], e = { t: false, b: false, l: false, r: false };
    for (const j of ids) {
      if (j === id) continue;
      const b = rects[j];
      const vov = ov(a.y, a.y + a.h, b.y, b.y + b.h), hov = ov(a.x, a.x + a.w, b.x, b.x + b.w);
      if (vov && Math.abs((a.x + a.w) - b.x) <= T) e.r = true;
      if (vov && Math.abs(a.x - (b.x + b.w)) <= T) e.l = true;
      if (hov && Math.abs((a.y + a.h) - b.y) <= T) e.b = true;
      if (hov && Math.abs(a.y - (b.y + b.h)) <= T) e.t = true;
    }
    try { app.window(id).push('docked', e); } catch (err) {}
  }
}

function screenOf(screens, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2;
  for (const s of screens || []) { const v = s.visible || s; if (cx >= v.x && cx < v.x + v.width && cy >= v.y && cy < v.y + v.height) return v; }
  const s0 = screens && screens[0]; return s0 ? (s0.visible || s0) : null;
}
async function computePos(app, id) {
  let saved = null;
  try { saved = await store.get('pos:' + id); } catch (e) {}
  if (saved && Number.isFinite(saved.x)) return { x: saved.x, y: saved.y };
  try {
    const m = await app.window('main').getState();
    if (id === 'playlist') return { x: m.x, y: m.y + m.height };
    if (id === 'eq') return { x: m.x, y: m.y + m.height + 260 };
    // viz: to the right of main — but flip to the left if it would run off-screen
    const vizW = 640;
    const scr = screenOf(await app.screens(), m.x, m.y, m.width, m.height);
    const right = m.x + m.width + 8;
    if (scr && right + vizW > scr.x + scr.width) return { x: Math.max(scr.x, m.x - vizW - 8), y: m.y };
    return { x: right, y: m.y };
  } catch (e) { return null; }
}

// ── menu-bar item: a play/pause indicator you can click ────────────────────
let trayKey = '';
function updateTray(app) {
  const playing = !!(latest && latest.playing);
  const title = latest && latest.title;
  const key = playing + '|' + (title || '') + '|' + alwaysOnTop;
  if (key === trayKey) return;
  trayKey = key;
  app.tray.set({
    icon: playing ? 'sf:pause.fill' : 'sf:play.fill',
    tooltip: title ? (playing ? '▶ ' : '⏸ ') + title : 'amp',
    primaryAction: true,               // left-click toggles; right-click = menu
    menu: [
      { id: 'playpause', label: playing ? 'Pause' : 'Play' },
      { id: 'next', label: 'Next' },
      { id: 'prev', label: 'Previous' },
      { separator: true },
      { id: 'ontop', label: 'Always on Top', checked: alwaysOnTop },
      { id: 'show', label: 'Show Player' },
      { id: 'quit', label: 'Quit amp' },
    ],
  });
}

export function onTray(id, app) {
  const send = (type) => app.window('main').push('action', { type });
  if (id === null || id === 'playpause') send('toggle');
  else if (id === 'next') send('next');
  else if (id === 'prev') send('prev');
  else if (id === 'ontop') setOnTop(app, !alwaysOnTop);
  else if (id === 'show') { app.show(); app.window('main').show(); }
  else if (id === 'quit') app.quit();
}

export function onWindowClosed(id, app) {
  if (id in shown) { shown[id] = false; setP('panels', { ...shown }); app.push('windows', { ...shown }); }
}

export function init(app) {
  store = app.store;
  updateTray(app);
  (async () => {
    try {
      const [tracks, meta, panels, ontop, mainPos] = await Promise.all([
        store.get('playlist'), store.get('meta'), store.get('panels'),
        store.get('ontop'), store.get('pos:main'),
      ]);
      alwaysOnTop = !!ontop;
      latest = { tracks: tracks || [], idx: -1, playing: false, elapsed: 0, duration: 0,
                 volume: meta?.volume ?? 0.8, balance: meta?.balance ?? 0,
                 eq: meta?.eq ?? null, wantIdx: meta?.idx ?? -1, restored: true };
      // restore main window: position + always-on-top
      if (mainPos && Number.isFinite(mainPos.x)) app.setPosition(mainPos.x, mainPos.y);
      if (alwaysOnTop) app.setAlwaysOnTop(true);
      // reopen the panels that were open last time
      for (const id of ['playlist', 'eq', 'viz']) {
        if (panels && panels[id]) {
          const pos = await computePos(app, id);
          app.openWindow(id, { ...SATELLITES[id], ...(pos || {}) });
          shown[id] = true;
          if (alwaysOnTop) setTimeout(() => { try { app.window(id).setAlwaysOnTop(true); } catch (e) {} }, 80);
        }
      }
      app.push('windows', { ...shown });
      setTimeout(() => refreshDocking(app), 400);
    } catch (e) {}
  })();
}
