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

// acceptsFirstMouse (0.22.5): the click that focuses a window ALSO lands on
// what it hit — without it, WKWebView eats the activating click and every
// cross-window action needs two (click playlist, then click play = 2 clicks).
// Winamp-style panels are exactly what click-through is for.
const CHROME = { frame: false, trafficLights: false, squareCorners: true, acceptsFirstMouse: true };
// The visualizer must be able to enter NATIVE fullscreen, which macOS only
// allows on a titled window — squareCorners makes a window truly borderless
// (no fullscreen), so viz keeps plain frameless chrome.
const VIZ_CHROME = { frame: false, trafficLights: false, acceptsFirstMouse: true };
const SATELLITES = {
  playlist: { page: 'playlist.html', title: 'amp — playlist', size: '320x260', chrome: CHROME },
  eq:       { page: 'eq.html',       title: 'amp — equalizer', size: '320x206', chrome: CHROME },
  viz:      { page: 'viz.html',      title: 'amp — visualizer', size: '640x430', chrome: VIZ_CHROME },
  // BIG SCREEN: the whole hi-fi as one fullscreen page (rack.js fullscreens
  // itself on load — needs viz-style chrome, squareCorners can't fullscreen)
  rack:     { page: 'rack.html',     title: 'amp — big screen', size: '1100x760', chrome: VIZ_CHROME },
};

let latest = null;                 // last state main published (for new windows)
const shown = { playlist: false, eq: false, viz: false, rack: false };
let alwaysOnTop = false;
let theme = 'system';              // 'system' | 'light' | 'dark' — pages paint it
let presence = 'both';             // 'both' | 'menubar' | 'dock' — where amp appears
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
    syncDockAnim(app);
    return true;
  },

  // The player renders the Dock-icon animation frames on a canvas (the
  // backend has none) and hands them over as base64 PNGs, once at launch.
  dockFrames: async ({ frames }, app) => {
    const dir = (tjs.env.TMPDIR || '/tmp').replace(/\/$/, '');
    const paths = [];
    for (let i = 0; i < (frames || []).length; i++) {
      const p = dir + '/amp-dock-' + i + '.png';
      await tjs.writeFile(p, Uint8Array.from(atob(frames[i]), (c) => c.charCodeAt(0)));
      paths.push(p);
    }
    dockFramePaths = paths;
    syncDockAnim(app);
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
    return { shade, onTop: alwaysOnTop, theme, presence, dockAnim };
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
      // never float the rack — macOS refuses fullscreen on a floating-level
      // window, so an always-on-top rack would silently stay windowed
      if (alwaysOnTop && !shown.rack && id !== 'rack') setTimeout(() => { try { app.window(id).setAlwaysOnTop(true); } catch (e) {} }, 50);
    } else if (shown[id]) {
      app.window(id).hide();
      shown[id] = false;
    } else {
      app.window(id).show({ activate: false });
      shown[id] = true;
      // a re-shown rack comes back windowed — tell it to go fullscreen again
      // (and strip any floating level it may have caught, or fullscreen fails)
      if (id === 'rack') {
        try { app.window('rack').setAlwaysOnTop(false); } catch (e) {}
        try { app.window('rack').push('enterFullscreen', {}); } catch (e) {}
      }
    }
    setP('panels', { ...shown });
    app.push('windows', { ...shown });
    if (id === 'rack') applyOnTopLevels(app);   // BIG suspends floating; exit restores it
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
      if (id === 'rack') continue;                   // fullscreen big-screen: no snapping
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
      // never show() the rack from here — raising a window that lives in its
      // own fullscreen Space would yank the user out of their current Space
      if (id === except || id === 'rack' || (id !== 'main' && !shown[id])) continue;
      try { app.window(id).show({ activate: false }); } catch (e) {}
    }
    try { app.window(except).show({ activate: false }); } catch (e) {}
    return true;
  },

  // ── global always-on-top (all windows at once) ────────────────────────────
  setOnTop: ({ value }, app) => { setOnTop(app, !!value); return alwaysOnTop; },

  // ── animated Dock icon on/off (context menus; tray menu calls it directly) ─
  setDockAnim: ({ value }, app) => { setDockAnim(app, !!value); return dockAnim; },

  // ── theme: system-following by default, manual override for every window ──
  setTheme: ({ value }, app) => {
    theme = ['light', 'dark'].includes(value) ? value : 'system';
    setP('theme', theme);
    app.push('theme', theme);      // every page repaints + updates its menu
    return theme;
  },

  // ── where amp appears: Dock & menu bar (default), or just one of them ─────
  setPresence: ({ value }, app) => { applyPresence(app, value); return presence; },

  // ── visualizer engine choice (milk = butterchurn, geiss = Geiss HDR,
  //    speakers = the big screen's CSS speaker stacks; viz.js shows milk for it)
  getVizEngine: async () => { try { return (await store.get('vizEngine')) || 'milk'; } catch (e) { return 'milk'; } },
  setVizEngine: ({ value }) => { setP('vizEngine', ['geiss', 'speakers'].includes(value) ? value : 'milk'); return true; },

  // ── track titles inside the visuals (the bar's T toggle; on by default) ───
  getVizTitles: async () => { try { const v = await store.get('vizTitles'); return v == null ? true : !!v; } catch (e) { return true; } },
  setVizTitles: ({ value }) => { setP('vizTitles', !!value); return true; },

  // Credits links open in the default browser, never inside an amp window.
  openExternal: ({ url }) => {
    if (!/^https:\/\//i.test(String(url))) return false;
    tjs.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
    return true;
  },

  // ── windowshade persistence ───────────────────────────────────────────────
  setShade: ({ id, value }, app) => { setP('shade:' + id, !!value); setTimeout(() => refreshDocking(app), 60); return true; },

  // A window changed height by `dh` (shade/unshade). Slide the windows docked
  // BELOW it — and the ones docked below those — by `dh` so they stay attached.
  reflow: async ({ id, dh, x0, x1, oldBottom }, app) => {
    const rects = {};
    for (const wid of await app.windows()) {
      if (wid === id || wid === 'rack' || (wid !== 'main' && !shown[wid])) continue;
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

// Dock and/or menu bar. The Dock side is a live NSApp activation-policy flip
// (app.setDockVisible); the menu-bar side adds/removes the tray item. The
// context menu never offers "neither", so amp always stays reachable.
function applyPresence(app, value) {
  presence = ['menubar', 'dock'].includes(value) ? value : 'both';
  setP('presence', presence);
  try { app.setDockVisible(presence !== 'menubar'); } catch (e) {}
  if (presence === 'dock') { try { app.tray.remove(); } catch (e) {} trayKey = ''; }
  else { trayKey = ''; updateTray(app); }
  syncDockAnim(app);                // menu-bar-only mode has no Dock icon to animate
  app.push('presence', presence);   // update every window's context-menu checkmarks
}

async function setOnTop(app, value) {
  alwaysOnTop = value;
  setP('ontop', value);
  await applyOnTopLevels(app);
  app.push('ontop', value);   // update every window's context-menu checkmark
  updateTray(app);
}

// The rack is exempt from floating: a floating-level window can't enter
// native fullscreen. And while the rack is UP, everyone else's floating is
// SUSPENDED too — floating windows hover over fullscreen Spaces, so an
// on-top playlist would photobomb the big screen. The preference itself
// (alwaysOnTop, menus, store) is untouched; levels are restored on exit.
async function applyOnTopLevels(app) {
  const effective = alwaysOnTop && !shown.rack;
  for (const id of await app.windows()) {
    if (id === 'rack') continue;
    try { app.window(id).setAlwaysOnTop(effective); } catch (e) {}
  }
}

// Which edges of each window are flush against another → push so the page can
// highlight the "attached" edge.
async function refreshDocking(app) {
  const rects = {};
  for (const id of await app.windows()) {
    if (id === 'rack') continue;
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
  if (id === 'rack') return null;   // it fullscreens itself; spawn position is moot
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

// ── tray "pill": rasterize the split menu-bar item to a PNG ourselves ──────
// till's recipe: the tray is ONE NSStatusItem — no two-item split, and a text
// title's width shifts every second. So draw the whole widget (a glyph chip +
// a time chip, like Harvest's) into an RGBA buffer at a FIXED size and
// hand-encode a PNG (@2x, 144 dpi pHYs → retina-crisp). The click "split" is
// geometry, resolved in onTray. Idle shows the AMP wordmark; with a track
// loaded the chip is the elapsed time, amber while playing.
const TS = 2;                                  // render scale (2 = retina)
const TW = 68 * TS, TH = 22 * TS;              // fixed item size in px
const FONT = {                                 // 3×5 bitmap font, MSB = left px
  '0': [0b111, 0b101, 0b101, 0b101, 0b111], '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111], '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001], '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111], '7': [0b111, 0b001, 0b010, 0b100, 0b100],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111], '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  ':': [0b000, 0b010, 0b000, 0b010, 0b000], '-': [0b000, 0b000, 0b111, 0b000, 0b000],
  'A': [0b010, 0b101, 0b111, 0b101, 0b101], 'M': [0b101, 0b111, 0b111, 0b101, 0b101],
  'P': [0b110, 0b101, 0b110, 0b100, 0b100], ' ': [0, 0, 0, 0, 0],
};
function blend(buf, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= TW || y >= TH || a <= 0) return;
  const i = (y * TW + x) * 4, ia = a / 255, ib = 1 - ia;
  buf[i] = r * ia + buf[i] * ib; buf[i + 1] = g * ia + buf[i + 1] * ib;
  buf[i + 2] = b * ia + buf[i + 2] * ib;
  buf[i + 3] = Math.min(255, a + buf[i + 3] * ib);   // src-over: αo = αs + αd(1−αs)
}
function fillRR(buf, x0, y0, x1, y1, rad, r, g, b, a) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    let dx = 0, dy = 0;
    if (x < x0 + rad) dx = x0 + rad - x; else if (x >= x1 - rad) dx = x - (x1 - rad - 1);
    if (y < y0 + rad) dy = y0 + rad - y; else if (y >= y1 - rad) dy = y - (y1 - rad - 1);
    if (dx && dy && dx * dx + dy * dy > rad * rad) continue;
    blend(buf, x, y, r, g, b, a);
  }
}
function drawGlyph(buf, playing, cx, cy, sz, r, g, b, a) {
  if (playing) {                       // pause: two bars
    const bw = Math.max(2, Math.round(sz * 0.30)), h = Math.round(sz / 2);
    for (let xx = 0; xx < bw; xx++) for (let yy = -h; yy <= h; yy++) {
      blend(buf, cx + xx, cy + yy, r, g, b, a);
      blend(buf, cx + sz - bw + xx, cy + yy, r, g, b, a);
    }
  } else {                             // play: right-pointing triangle
    for (let xx = 0; xx < sz; xx++) {
      const half = Math.round((sz / 2) * (1 - xx / sz));
      for (let yy = -half; yy <= half; yy++) blend(buf, cx + xx, cy + yy, r, g, b, a);
    }
  }
}
function drawText(buf, x, y, str, sc, r, g, b, a) {
  let cx = x;
  for (const ch of str) {
    const gl = FONT[ch] || FONT[' '];
    const narrow = ch === ':' || ch === '-';        // tighter advance for punctuation
    for (let ry = 0; ry < 5; ry++) for (let rx = 0; rx < 3; rx++)
      if (gl[ry] & (1 << (2 - rx)))
        for (let yy = 0; yy < sc; yy++) for (let xx = 0; xx < sc; xx++)
          blend(buf, cx + rx * sc + xx, y + ry * sc + yy, r, g, b, a);
    cx += (narrow ? 2 : 3) * sc + sc;               // glyph width + 1px gap
  }
}
function textWidth(str, sc) {          // mirror of drawText's advances
  let w = 0;
  for (const ch of str) w += ((ch === ':' || ch === '-') ? 2 : 3) * sc + sc;
  return w - sc;                       // no trailing gap
}
// hand-rolled PNG (RGBA, uncompressed/stored zlib) — no image lib in txiki
let _crc;
function crc32(b) {
  if (!_crc) { _crc = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); _crc[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = _crc[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
function adler32(b) { let a = 1, s = 0; for (let i = 0; i < b.length; i++) { a = (a + b[i]) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; }
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function chunk(type, data) {
  const body = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3), ...data];
  return [...u32(data.length), ...body, ...u32(crc32(Uint8Array.from(body)))];
}
function encodePNG(rgba, w, h) {
  const raw = [];
  for (let y = 0; y < h; y++) { raw.push(0); for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; raw.push(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]); } }
  const z = [0x78, 0x01]; let p = 0;                 // stored deflate
  while (p < raw.length) { const len = Math.min(65535, raw.length - p), last = (p + len >= raw.length) ? 1 : 0;
    z.push(last, len & 255, (len >> 8) & 255, (~len) & 255, ((~len) >> 8) & 255);
    for (let i = 0; i < len; i++) z.push(raw[p + i]); p += len; }
  z.push(...u32(adler32(Uint8Array.from(raw))));
  const ppm = 5669;                                  // 144 dpi → retina point size
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', [...u32(w), ...u32(h), 8, 6, 0, 0, 0]),
    ...chunk('pHYs', [...u32(ppm), ...u32(ppm), 1]),
    ...chunk('IDAT', z), ...chunk('IEND', [])]);
}
function renderTrayPNG(playing, text) {
  const buf = new Uint8Array(TW * TH * 4);
  const cy = Math.round(TH / 2), rad = 4 * TS;
  const glyphW = 20 * TS, gap = 3 * TS;              // glyph chip 20pt + 3pt gap
  // glyph chip: amp amber while playing (dark glyph), gray idle (white glyph)
  if (playing) fillRR(buf, 0, TS, glyphW, TH - TS, rad, 255, 180, 55, 255);
  else fillRR(buf, 0, TS, glyphW, TH - TS, rad, 118, 120, 126, 255);
  // text chip: dark, LED-style amber digits while playing
  fillRR(buf, glyphW + gap, TS, TW, TH - TS, rad, 62, 63, 68, 255);
  const gsz = 9 * TS;
  if (playing) drawGlyph(buf, true, Math.round((glyphW - gsz) / 2), cy, gsz, 30, 22, 6, 255);
  else drawGlyph(buf, false, Math.round((glyphW - gsz) / 2) + TS, cy, gsz, 255, 255, 255, 255);
  const sc = 2 * TS;
  const tx = glyphW + gap + Math.round((TW - glyphW - gap - textWidth(text, sc)) / 2);
  if (playing) drawText(buf, tx, cy - Math.round(2.5 * sc), text, sc, 255, 180, 55, 255);
  else drawText(buf, tx, cy - Math.round(2.5 * sc), text, sc, 235, 237, 242, 190);
  return encodePNG(buf, TW, TH);
}
let trayN = 0;
const trayPath = () => (tjs.env.TMPDIR || '/tmp').replace(/\/$/, '') + '/amp-tray-' + (trayN ^= 1) + '.png';
const fmtMS = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ── menu-bar item: split pill — ▶/⏸ chip toggles, time chip opens the player
let trayKey = '';
function updateTray(app) {
  if (presence === 'dock') return;   // Dock-only mode: no tray item at all
  const playing = !!(latest && latest.playing);
  const title = latest && latest.title;
  const text = title ? fmtMS(latest.elapsed) : 'AMP';
  const key = playing + '|' + text + '|' + alwaysOnTop + '|' + presence + '|' + dockAnim;
  if (key === trayKey) return;
  trayKey = key;
  const menu = [
    { id: 'playpause', label: playing ? 'Pause' : 'Play' },
    { id: 'next', label: 'Next' },
    { id: 'prev', label: 'Previous' },
    { separator: true },
    { id: 'ontop', label: 'Always on Top', checked: alwaysOnTop },
    { id: 'dockanim', label: 'Animated Dock Icon', checked: dockAnim },
    { label: 'Appear In', submenu: [
      { id: 'presence:both', label: 'Dock & Menu Bar', checked: presence === 'both' },
      { id: 'presence:menubar', label: 'Menu Bar Only', checked: presence === 'menubar' },
      { id: 'presence:dock', label: 'Dock Only', checked: presence === 'dock' },
    ] },
    { id: 'show', label: 'Show Player' },
    { id: 'quit', label: 'Quit amp' },
  ];
  const tooltip = title ? (playing ? '▶ ' : '⏸ ') + title : 'amp — ▶ plays · the time opens the player';
  // draw the fixed-width pill; fall back to the old SF symbol if anything trips
  (async () => {
    const spec = { tooltip, primaryAction: true, menu };
    try {
      const path = trayPath();
      await tjs.writeFile(path, renderTrayPNG(playing, text));
      app.tray.set({ ...spec, title: '', icon: path, template: false });
    } catch (e) {
      app.tray.set({ ...spec, icon: playing ? 'sf:pause.fill' : 'sf:play.fill' });
    }
  })();
}

export function onTray(id, app) {
  const send = (type) => app.window('main').push('action', { type });
  if (id === null) {
    // the "split": one NSStatusItem, two zones by geometry — compare the click
    // position against the item rect (till's trick; the cursor read right
    // after the click is close enough to where it landed)
    (async () => {
      try {
        const [spot, mouse] = await Promise.all([app.tray.position(), app.mousePosition()]);
        if (mouse.x < spot.x + 26) send('toggle');               // the ▶/⏸ chip
        else { app.show(); app.window('main').show(); }          // the time chip
      } catch (e) { send('toggle'); }
    })();
  }
  else if (id === 'playpause') send('toggle');
  else if (id === 'next') send('next');
  else if (id === 'prev') send('prev');
  else if (id === 'ontop') setOnTop(app, !alwaysOnTop);
  else if (id === 'dockanim') setDockAnim(app, !dockAnim);
  else if (id && id.startsWith('presence:')) applyPresence(app, id.slice(9));
  else if (id === 'show') { app.show(); app.window('main').show(); }
  else if (id === 'quit') app.quit();
}

// ── animated Dock icon: the page renders spectrum-bar frames of the icon,
// we flip through them while music plays (app.dockIcon; '' = bundle icon) ──
let dockAnim = true;               // persisted; toggle in tray + context menus
let dockFramePaths = [], dockTimer = 0, dockN = 0;
function syncDockAnim(app) {
  const want = dockAnim && presence !== 'menubar' && dockFramePaths.length &&
    !!(latest && latest.playing);
  if (want && !dockTimer) {
    dockTimer = setInterval(() => {
      try { app.dockIcon(dockFramePaths[dockN++ % dockFramePaths.length]); } catch (e) {}
    }, 320);
  } else if (!want && dockTimer) {
    clearInterval(dockTimer); dockTimer = 0;
    try { app.dockIcon(''); } catch (e) {}
  }
}
function setDockAnim(app, value) {
  dockAnim = !!value;
  setP('dockAnim', dockAnim);
  trayKey = ''; updateTray(app);     // refresh the menu checkmark
  app.push('dockanim', dockAnim);    // update every window's context menu
  syncDockAnim(app);
}

export function onWindowClosed(id, app) {
  if (id in shown) { shown[id] = false; setP('panels', { ...shown }); app.push('windows', { ...shown }); }
  if (id === 'rack') applyOnTopLevels(app);   // rack gone → floating comes back
}

export function init(app) {
  store = app.store;
  (async () => {
    try {
      const [tracks, meta, panels, ontop, mainPos, savedTheme, savedPresence, savedDockAnim] = await Promise.all([
        store.get('playlist'), store.get('meta'), store.get('panels'),
        store.get('ontop'), store.get('pos:main'),
        store.get('theme'), store.get('presence'), store.get('dockAnim'),
      ]);
      alwaysOnTop = !!ontop;
      dockAnim = savedDockAnim == null ? true : !!savedDockAnim;
      theme = ['light', 'dark'].includes(savedTheme) ? savedTheme : 'system';
      // tray is created here (not before the store read) so Dock-only mode
      // never flashes a tray item at launch
      applyPresence(app, savedPresence);
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
    } catch (e) {
      applyPresence(app, presence);   // store failed → still get the default tray up
    }
  })();
}
