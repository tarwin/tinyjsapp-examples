// Till — a local, offline clone of the Harvest menu-bar time tracker.
//
// One transparent, frameless popover window that hangs off a menu-bar (tray)
// item, exactly like the real thing. The BACKEND is the source of truth for
// time: a 1-second ticker folds the running entry's elapsed seconds and keeps
// the tray title live even while the popover is hidden (a hidden WebKit window
// is throttled to near-zero, so the page can't be trusted to keep time). The
// page is a thin renderer — it calls api methods, gets a fresh state snapshot
// back, and paints it.

// ── seed data: clients → projects → tasks ──────────────────────────────────
// Harvest's "New Time Entry" picks a project (grouped under its client) then a
// task within it. We ship a little demo book so the app is useful on first run.
const CLIENTS = [
  { name: 'Acme Corp', color: '#3f9d8f', projects: [
    { id: 'p_web', name: 'Website Redesign', tasks: ['Design', 'Development', 'Content', 'QA'] },
    { id: 'p_app', name: 'Mobile App', tasks: ['Design', 'Development', 'QA', 'Meetings'] },
  ] },
  { name: 'Northwind', color: '#6f7bf0', projects: [
    { id: 'p_brand', name: 'Brand Refresh', tasks: ['Strategy', 'Design', 'Rollout'] },
  ] },
  { name: 'Internal', color: '#b0568f', projects: [
    { id: 'p_admin', name: 'Admin', tasks: ['Email', 'Planning', 'Invoicing'] },
    { id: 'p_mkt', name: 'Marketing', tasks: ['Content', 'Social', 'Newsletter'] },
  ] },
];

// flat project index: id → { id, name, client, color, tasks }
const PROJECTS = {};
for (const c of CLIENTS) for (const p of c.projects) PROJECTS[p.id] = { ...p, client: c.name, color: c.color };

const QUOTES = [
  ['It always seems impossible until it’s done.', 'Nelson Mandela'],
  ['The way to get started is to quit talking and begin doing.', 'Walt Disney'],
  ['Either you run the day or the day runs you.', 'Jim Rohn'],
  ['Focus on being productive instead of busy.', 'Tim Ferriss'],
  ['You may delay, but time will not.', 'Benjamin Franklin'],
  ['Lost time is never found again.', 'Benjamin Franklin'],
  ['Do the hard jobs first. The easy jobs take care of themselves.', 'Dale Carnegie'],
];

// ── in-memory state (mirrored into app.store) ──────────────────────────────
let store;
let entries = [];          // { id, date:'YYYY-MM-DD', projectId, task, notes, seconds, running, startedAt }
let favorites = [];        // { projectId, task }
let seq = 1;
let ticker = null;
let popShown = false;
let lastTrayKey = '';
let entryOpen = false;         // is the New/Edit-entry window up?
let pendingEdit = null;        // entry id being edited (null = new)
let prefsOpen = false;         // is the Preferences window up?
let lastMainPos = { x: 40, y: 32, w: 380, h: 496 };

// Torn-off state (Harvest lets you drag the popover off the menu bar into a
// real window: traffic lights, resizable, survives losing focus). The page
// drives the drag; we own the mode + the remembered rect.
let detached = false;
let detRect = null;            // { x, y, w, h } while detached

// user preferences (Preferences window) — persisted under 'prefs'
let prefs = { dock: false, idleEnabled: true, idleMinutes: 10, logLevel: 'error', shortcuts: {} };
const SC_IDS = ['sc_new', 'sc_toggle', 'sc_summary', 'sc_favs'];   // global hotkey slots
let idleTick = 0;              // ticker divider for idle polling

// the New/Edit-entry window — a small transparent floating dialog
const ENTRY = { page: 'entry.html', title: 'Time Entry', size: '360x300',
                chrome: { frame: false, trafficLights: false, transparent: true } };
// the Preferences window — a normal titled window (native traffic lights)
const PREFS = { page: 'prefs.html', title: 'Preferences', size: '520x610' };

const pad = (n) => String(n).padStart(2, '0');
const two = (n) => (n < 10 ? '0' + n : '' + n);
const uid = () => 'e' + (seq++) + '_' + Math.floor(Date.now() % 1e6).toString(36);

// local YYYY-MM-DD for a Date (NOT toISOString, which is UTC and can be a day off)
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayStr() { return ymd(new Date()); }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

// live seconds for an entry (folds the running stretch since startedAt)
function liveSeconds(e) {
  let s = e.seconds || 0;
  if (e.running && e.startedAt) s += Math.max(0, Math.floor((Date.now() - e.startedAt) / 1000));
  return s;
}
function fmtHM(sec) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h + ':' + two(m); }
function fmtHMS(sec) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h + ':' + two(m) + ':' + two(s); }

function runningEntry() { return entries.find((e) => e.running) || null; }

// the seven dates (Mon→Sun) of the week containing `dateStr`
function weekDates(dateStr) {
  const d = parseYmd(dateStr);
  const dow = (d.getDay() + 6) % 7;         // 0 = Monday
  const mon = new Date(d); mon.setDate(d.getDate() - dow);
  const out = [];
  for (let i = 0; i < 7; i++) { const x = new Date(mon); x.setDate(mon.getDate() + i); out.push(ymd(x)); }
  return out;
}
function dayTotal(dateStr) {
  return entries.filter((e) => e.date === dateStr).reduce((a, e) => a + liveSeconds(e), 0);
}
function rangeTotal(fromStr, toStr) {
  return entries.filter((e) => e.date >= fromStr && e.date <= toStr).reduce((a, e) => a + liveSeconds(e), 0);
}

function projInfo(id) {
  const p = PROJECTS[id];
  return p ? { id: p.id, name: p.name, client: p.client, color: p.color, tasks: p.tasks }
           : { id, name: id, client: '', color: '#888', tasks: [] };
}

// the payload the page renders — everything it needs for a given selected day
function snapshot(selDate) {
  const sel = selDate || todayStr();
  const week = weekDates(sel);
  const today = todayStr();
  const yst = ymd(new Date(Date.now() - 864e5));
  const monthPrefix = today.slice(0, 7);
  const run = runningEntry();
  const dayEntries = entries
    .filter((e) => e.date === sel)
    .map((e) => {
      const p = projInfo(e.projectId);
      return { id: e.id, projectId: e.projectId, task: e.task, notes: e.notes || '',
               client: p.client, project: p.name, color: p.color,
               seconds: liveSeconds(e), running: !!e.running };
    });
  const q = QUOTES[(parseYmd(sel).getDay() + parseYmd(sel).getDate()) % QUOTES.length];
  return {
    selDate: sel,
    today,
    week: week.map((d) => ({ date: d, total: dayTotal(d) })),
    entries: dayEntries,
    running: run ? { id: run.id, seconds: liveSeconds(run), date: run.date } : null,
    summary: {
      today: dayTotal(today),
      yesterday: dayTotal(yst),
      week: rangeTotal(weekDates(today)[0], weekDates(today)[6]),
      month: entries.filter((e) => e.date.startsWith(monthPrefix)).reduce((a, e) => a + liveSeconds(e), 0),
    },
    favorites: favorites.map((f) => { const p = projInfo(f.projectId); return { ...f, client: p.client, project: p.name, color: p.color }; }),
    quote: { text: q[0], author: q[1] },
    catalog: CLIENTS.map((c) => ({ client: c.name, color: c.color, projects: c.projects.map((p) => ({ id: p.id, name: p.name, tasks: p.tasks })) })),
  };
}

// ── persistence ────────────────────────────────────────────────────────────
async function persist() {
  try { await store.set('entries', entries); await store.set('favorites', favorites); } catch (e) {}
}

// ── tray "pill": rasterize the menu-bar item to a PNG ourselves ─────────────
// The tray API only takes an SF-symbol/PNG icon + a text title, and the title's
// width shifts between play/pause/idle. To match Harvest's rounded pill AND keep
// a rock-steady width, we draw the whole widget (pill + glyph + H:MM) into an
// RGBA buffer and hand-encode a PNG — the backend has no canvas. Rendered @2x
// and tagged 144 dpi so it's retina-crisp; the pixel size is FIXED, so the item
// never resizes. Regenerated only when the H:MM text changes (~once a minute).
const TS = 2;                                  // render scale (2 = retina)
const TW = 64 * TS, TH = 22 * TS;              // fixed item size in px (content fills it)
const FONT = {                                 // 3×5 bitmap font, MSB = left px
  '0': [0b111, 0b101, 0b101, 0b101, 0b111], '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111], '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001], '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111], '7': [0b111, 0b001, 0b010, 0b100, 0b100],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111], '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  ':': [0b000, 0b010, 0b000, 0b010, 0b000], '-': [0b000, 0b000, 0b111, 0b000, 0b000], ' ': [0, 0, 0, 0, 0],
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
function drawGlyph(buf, running, cx, cy, sz, r, g, b, a) {
  if (running) {                       // pause: two bars
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
function textWidth(str, sc) {          // mirror of drawText's advances
  let w = 0;
  for (const ch of str) w += ((ch === ':' || ch === '-') ? 2 : 3) * sc + sc;
  return w - sc;                       // no trailing gap
}
function renderTrayPNG(running, text) {
  // Harvest's widget is TWO chips: a brighter button holding the glyph, a small
  // gap, then a darker chip holding the time. Solid colors — the old faint
  // single pill read as "almost clear" in a real menu bar.
  const buf = new Uint8Array(TW * TH * 4);
  const cy = Math.round(TH / 2), rad = 4 * TS;
  const glyphW = 20 * TS, gap = 3 * TS;                     // glyph chip 20pt + 3pt gap
  // glyph chip: gray when idle, Harvest orange while tracking
  if (running) fillRR(buf, 0, TS, glyphW, TH - TS, rad, 232, 122, 32, 255);
  else fillRR(buf, 0, TS, glyphW, TH - TS, rad, 118, 120, 126, 255);
  // time chip: darker gray
  fillRR(buf, glyphW + gap, TS, TW, TH - TS, rad, 62, 63, 68, 255);
  // glyph, centered in its chip (play nudged right — triangles sit better off-center)
  const gsz = 9 * TS;
  drawGlyph(buf, running, Math.round((glyphW - gsz) / 2) + (running ? 0 : TS), cy, gsz, 255, 255, 255, 255);
  // time, centered in its chip
  const sc = 2 * TS;
  const tx = glyphW + gap + Math.round((TW - glyphW - gap - textWidth(text, sc)) / 2);
  drawText(buf, tx, cy - Math.round(2.5 * sc), text, sc, 235, 237, 242, running ? 255 : 190);
  return encodePNG(buf, TW, TH);
}
let trayN = 0;
const trayPath = () => (tjs.env.TMPDIR || '/tmp').replace(/\/$/, '') + '/till-tray-' + (trayN ^= 1) + '.png';

// ── tray (menu bar) ─────────────────────────────────────────────────────────
function updateTray(app) {
  const run = runningEntry();
  const text = run ? fmtHM(liveSeconds(run)) : '-:--';
  const key = (run ? 'run' : 'idle') + '|' + text;
  if (key === lastTrayKey) return;       // avoid redundant redraws each tick
  lastTrayKey = key;
  const p = run ? projInfo(run.projectId) : null;
  const menu = [
    { id: 'show', label: 'Open Till' },
    { id: 'new', label: 'New Time Entry…' },
    { separator: true },
    run ? { id: 'stop', label: `Stop “${p.project}”` } : { id: 'resume', label: 'Start last timer' },
    { separator: true },
    { id: 'prefs', label: 'Preferences…' },
    { id: 'quit', label: 'Quit Till' },
  ];
  const tooltip = run ? `Tracking · ${p.project} — ${run.task}` : 'Till — click ▶ to start, or the time to open';
  // Draw our own fixed-width pill PNG; fall back to an SF symbol if anything trips.
  (async () => {
    const spec = { tooltip, primaryAction: true, menu };  // left-click = start/pause; right-click = menu
    try {
      const path = trayPath();
      await tjs.writeFile(path, renderTrayPNG(!!run, text));
      app.tray.set({ ...spec, title: '', icon: path, template: false });
    } catch (e) {
      app.tray.set({ ...spec, title: text, icon: run ? 'sf:pause.fill' : 'sf:play.fill' });
    }
  })();
}

function startTicker(app) {
  if (ticker) return;
  ticker = setInterval(() => {
    const run = runningEntry();
    updateTray(app);
    if (run && popShown) app.push('tick', { id: run.id, seconds: liveSeconds(run), text: fmtHMS(liveSeconds(run)) });
    if (++idleTick >= 15) { idleTick = 0; checkIdle(app); }   // poll idle every 15 s
  }, 1000);
}

// ── popover positioning: anchor the card under the tray icon ────────────────
// Where the ATTACHED popover belongs right now (tray icon may move as other
// status items come and go). The page also needs this while DETACHED: its
// header drag compares against it to offer the snap-back.
async function anchorRect(app) {
  const W = 380;
  let x = 40, y = 32, pointer = W - 60;
  try {
    const spot = await app.tray.position();          // tray icon rect (top-left coords)
    const screens = await app.screens();
    const scr = (screens && (screens[0].visible || screens[0])) || { x: 0, y: 0, width: 1440, height: 900 };
    if (spot) {
      const cx = spot.x + spot.width / 2;
      y = spot.y + spot.height + 6;
      x = Math.round(cx - (W - 46));                 // pointer sits ~46px from the card's right edge
      x = Math.max(scr.x + 8, Math.min(x, scr.x + scr.width - W - 8));
      pointer = Math.round(Math.max(24, Math.min(W - 24, cx - x)));
    }
  } catch (e) {}
  return { x, y, pointer };
}

async function showPopover(app, opts) {
  if (detached && detRect) {                         // torn off: restore as a plain window
    try {
      // clamp to the display the rect is actually on (not screens[0] — with
      // multiple displays that could yank the window to another monitor)
      const screens = await app.screens();
      const rects = (screens || []).map((s) => s.visible || s);
      const cx = detRect.x + detRect.w / 2, cy = detRect.y + 20;
      const scr = rects.find((s) => cx >= s.x && cx < s.x + s.width && cy >= s.y && cy < s.y + s.height)
                || rects[0] || { x: 0, y: 0, width: 1440, height: 900 };
      detRect.x = Math.max(scr.x, Math.min(detRect.x, scr.x + scr.width - detRect.w));
      detRect.y = Math.max(scr.y, Math.min(detRect.y, scr.y + scr.height - 80));
    } catch (e) {}
    lastMainPos = { x: detRect.x, y: detRect.y, w: detRect.w, h: detRect.h };
    try { app.setResizable(true); } catch (e) {}
    app.setLevel && app.setLevel('normal');          // behaves like its own window
    try { app.setSize(detRect.w, detRect.h); } catch (e) {}
    app.show();
    // position AFTER show — resizing a hidden window re-centers it on macOS,
    // which silently overwrote the remembered spot
    try { app.setPosition(detRect.x, detRect.y); } catch (e) {}
    popShown = true;
    app.push('mode', { detached: true });
    app.push('anchor', await anchorRect(app));       // so the drag can offer snap-back
    if (opts && opts.view) app.push('open-view', opts.view);
    updateTray(app);
    return;
  }
  const a = await anchorRect(app);
  lastMainPos = { x: a.x, y: a.y, w: 380, h: 496 };
  try { app.setResizable(false); app.setSize(380, 496); } catch (e) {}
  try { app.setPosition(a.x, a.y); } catch (e) {}
  app.setLevel && app.setLevel('floating');
  app.show();
  popShown = true;
  app.push('mode', { detached: false });
  app.push('anchor', a);
  if (opts && opts.view) app.push('open-view', opts.view);
  updateTray(app);
}
// don't tuck the popover away while the entry dialog or Preferences is up:
// they steal focus (which would fire the page's blur → hide), and app.hide()
// is NSApp-WIDE — it would take those windows down with the popover. (Even
// app.window('main').hide() maps to the app-wide hide; the launcher special-
// cases main. Same pattern as the entry window: guard + level juggling.)
function hidePopover(app) {
  if (entryOpen || prefsOpen) return;
  popShown = false;
  try { app.hide(); } catch (e) {}
}
// tray/menu/hotkey toggle — trust the launcher over our flag (a native-close
// path could hide the window without us hearing about it)
async function togglePopover(app) {
  let visible = popShown;
  try { const st = await app.getWinState(); if (st && typeof st.visible === 'boolean') visible = st.visible; } catch (e) {}
  if (visible) hidePopover(app); else await showPopover(app);
}

// ── New/Edit-entry window ────────────────────────────────────────────────────
async function openEntryWindow(app, editId) {
  pendingEdit = editId || null;
  const eW = 360, eH = 300;
  let x = lastMainPos.x + Math.round((lastMainPos.w - eW) / 2);
  let y = lastMainPos.y + 150;
  try {
    const screens = await app.screens();
    const scr = (screens && (screens[0].visible || screens[0])) || { x: 0, y: 0, width: 1440, height: 900 };
    x = Math.max(scr.x + 8, Math.min(x, scr.x + scr.width - eW - 8));
    y = Math.max(scr.y + 8, Math.min(y, scr.y + scr.height - eH - 8));
  } catch (e) {}
  entryOpen = true;
  try { app.setLevel('normal'); } catch (e) {}          // drop the popover so the dialog sits above it
  app.openWindow('entry', { ...ENTRY, x, y });
  try { app.window('entry').setLevel('floating'); } catch (e) {}
}
function closeEntryWindow(app) {
  entryOpen = false;
  try { app.window('entry').close(); } catch (e) {}
  // restore the popover's float — unless it's torn off (detached lives at normal level)
  if (popShown && !detached) { try { app.setLevel('floating'); } catch (e) {} }
}

// ── Preferences window ───────────────────────────────────────────────────────
function openPrefs(app) {
  if (prefsOpen) { try { app.window('prefs').show(); } catch (e) {} return; }
  prefsOpen = true;
  // an attached popover floats — drop it to normal so Preferences sits above
  if (popShown && !detached) { try { app.setLevel('normal'); } catch (e) {} }
  app.openWindow('prefs', PREFS);
  // accessory apps don't auto-order new windows front when inactive (e.g.
  // opened from the tray menu) — surface it explicitly
  try { app.window('prefs').show(); } catch (e) {}
}

// ── tear-off / re-attach (the page's header drag decides, we apply) ─────────
async function setDetached(app, on, rect) {
  const was = detached;
  detached = !!on;
  if (detached) {
    detRect = { x: Math.round(rect.x) || 0, y: Math.round(rect.y) || 0,
                w: Math.round(rect.w) || 380, h: Math.round(rect.h) || 496 };
    lastMainPos = { ...detRect };
    if (!was) {
      try { app.setResizable(true); } catch (e) {}
      try { app.setLevel('normal'); } catch (e) {}
    }
    app.push('mode', { detached: true });
  } else {
    detRect = null;
    await showPopover(app);            // snaps under the tray, restores size/level/anchor
  }
  try { await store.set('win', { detached, rect: detRect }); } catch (e) {}
}

// ── idle detection (Preferences → "Detect idle time after N minutes") ───────
// app.idleTime() = seconds since the user's last input, system-wide. If a timer
// is running and the user walked away, stop it and roll the idle stretch back
// out of the entry — the clock stops when they did, not when we noticed.
async function checkIdle(app) {
  if (!prefs.idleEnabled) return;
  const run = runningEntry(); if (!run) return;
  try {
    const idle = Math.floor(await app.idleTime());
    const limit = Math.max(1, prefs.idleMinutes) * 60;
    if (!(idle >= limit)) return;
    run.seconds = Math.max(0, liveSeconds(run) - idle);
    run.running = false; run.startedAt = 0;
    await persist(); updateTray(app);
    const p = projInfo(run.projectId);
    try { app.notify({ title: 'Timer stopped', body: `Idle for ${Math.round(idle / 60)} min — “${p.name}” stopped at ${fmtHM(run.seconds)}.` }); } catch (e) {}
    if (popShown) app.push('refresh', {});
  } catch (e) {}
}

// register/unregister one global-hotkey slot and remember the combo
async function applyShortcut(app, id, combo) {
  if (!SC_IDS.includes(id)) return false;
  try { app.hotkey.unregister(id); } catch (e) {}
  if (combo) {
    try { app.hotkey.register(id, combo); } catch (e) { return false; }
    prefs.shortcuts[id] = combo;
  } else delete prefs.shortcuts[id];
  try { await store.set('prefs', prefs); } catch (e) {}
  return true;
}

// shared timer transitions (only one entry runs at a time)
function beginTimer(app, e) {
  for (const x of entries) if (x.running && x !== e) endTimer(x);
  e.running = true; e.startedAt = Date.now();
}
function endTimer(e) {
  e.seconds = liveSeconds(e); e.running = false; e.startedAt = 0;
}

// ── api (callable from the page) ────────────────────────────────────────────
export const api = {
  state: async ({ date } = {}) => snapshot(date),

  addEntry: async ({ projectId, task, notes, seconds, date, start }, app) => {
    const e = { id: uid(), date: date || todayStr(), projectId, task: task || '',
                notes: notes || '', seconds: Math.max(0, seconds || 0), running: false, startedAt: 0 };
    entries.unshift(e);
    if (start) beginTimer(app, e);
    await persist(); updateTray(app);
    return snapshot(e.date);
  },

  updateEntry: async ({ id, projectId, task, notes, seconds }, app) => {
    const e = entries.find((x) => x.id === id); if (!e) return snapshot();
    if (projectId) e.projectId = projectId;
    if (task != null) e.task = task;
    if (notes != null) e.notes = notes;
    if (seconds != null) {                    // manual edit: rebase, keep running from now
      e.seconds = Math.max(0, Math.floor(seconds));
      if (e.running) e.startedAt = Date.now();
    }
    await persist(); updateTray(app);
    return snapshot(e.date);
  },

  startTimer: async ({ id }, app) => {
    const e = entries.find((x) => x.id === id); if (!e) return snapshot();
    beginTimer(app, e);
    await persist(); updateTray(app);
    return snapshot(e.date);
  },

  stopTimer: async ({ id }, app) => {
    const e = id ? entries.find((x) => x.id === id) : runningEntry();
    if (e) endTimer(e);
    await persist(); updateTray(app);
    return snapshot(e ? e.date : undefined);
  },

  deleteEntry: async ({ id }, app) => {
    const e = entries.find((x) => x.id === id);
    entries = entries.filter((x) => x.id !== id);
    await persist(); updateTray(app);
    return snapshot(e ? e.date : undefined);
  },

  toggleFavorite: async ({ projectId, task }) => {
    const i = favorites.findIndex((f) => f.projectId === projectId && f.task === task);
    if (i >= 0) favorites.splice(i, 1); else favorites.push({ projectId, task });
    await persist();
    return snapshot();
  },
  isFavorite: async ({ projectId, task }) => favorites.some((f) => f.projectId === projectId && f.task === task),

  resetDemo: async ({}, app) => {
    entries = []; favorites = []; await persist(); updateTray(app);
    return snapshot();
  },

  hidePopover: async ({}, app) => { hidePopover(app); return true; },
  quit: async ({}, app) => { app.quit(); },

  // ── tear-off plumbing (page's header drag reports where it let go) ──────
  setDetached: async ({ detached: on, x, y, w, h } = {}, app) => {
    await setDetached(app, on, { x, y, w, h });
    return { detached };
  },
  // while detached: remember moves/resizes so reopen + relaunch restore them
  saveWinRect: async ({ x, y, w, h }, app) => {
    if (!detached) return false;
    detRect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    lastMainPos = { ...detRect };
    try { await store.set('win', { detached, rect: detRect }); } catch (e) {}
    return true;
  },

  // ── Preferences plumbing ─────────────────────────────────────────────────
  openPrefs: async ({}, app) => { openPrefs(app); return true; },
  getPrefs: async ({}, app) => {
    let autostart = 'unsupported';
    try { autostart = await app.launchAtLogin.get(); } catch (e) {}
    return { prefs, autostart };
  },
  setPrefs: async (patch, app) => {
    const dockWas = prefs.dock;
    for (const k of ['dock', 'idleEnabled', 'idleMinutes', 'logLevel'])
      if (patch[k] !== undefined) prefs[k] = patch[k];
    prefs.idleMinutes = Math.min(240, Math.max(1, Math.round(prefs.idleMinutes) || 10));
    if (prefs.dock !== dockWas) { try { app.setDockVisible(!!prefs.dock); } catch (e) {} }
    try { await store.set('prefs', prefs); } catch (e) {}
    return prefs;
  },
  setAutostart: async ({ enabled }, app) => {
    try { await app.launchAtLogin.set(!!enabled); } catch (e) {}
    try { return await app.launchAtLogin.get(); } catch (e) { return 'unsupported'; }
  },
  setShortcut: async ({ id, combo }, app) => {
    const ok = await applyShortcut(app, id, combo || null);
    return { ok, shortcuts: prefs.shortcuts };
  },
  clearShortcuts: async ({}, app) => {
    for (const id of SC_IDS) await applyShortcut(app, id, null);
    return { ok: true, shortcuts: prefs.shortcuts };
  },
  manageNotifications: async ({}, app) => {
    try { app.shell.open('x-apple.systempreferences:com.apple.preference.notifications'); } catch (e) {}
    return true;
  },
  revealData: async ({}, app) => {
    try { app.shell.reveal((app.paths && app.paths.data) || ''); } catch (e) {}
    return true;
  },

  // ── entry-window plumbing ──────────────────────────────────────────────
  openEntryWindow: async ({ editId } = {}, app) => { await openEntryWindow(app, editId); return true; },
  closeEntryWindow: async ({}, app) => { closeEntryWindow(app); return true; },

  // what the entry window asks for on load: the catalog, favorites, and (when
  // editing) the row being edited
  entryInit: async () => {
    const edit = pendingEdit ? entries.find((e) => e.id === pendingEdit) : null;
    return {
      mode: pendingEdit ? 'edit' : 'new',
      catalog: CLIENTS.map((c) => ({ client: c.name, color: c.color, projects: c.projects.map((p) => ({ id: p.id, name: p.name, tasks: p.tasks })) })),
      favorites: favorites.map((f) => ({ projectId: f.projectId, task: f.task })),
      edit: edit ? { id: edit.id, projectId: edit.projectId, task: edit.task, notes: edit.notes || '', seconds: liveSeconds(edit) } : null,
    };
  },

  // the entry window's Start/Save: create or update, refresh the popover, close
  submitEntry: async ({ editId, projectId, task, notes, seconds, start }, app) => {
    if (editId) {
      const e = entries.find((x) => x.id === editId);
      if (e) {
        e.projectId = projectId; e.task = task || ''; e.notes = notes || '';
        e.seconds = Math.max(0, Math.floor(seconds || 0));
        if (e.running) e.startedAt = Date.now();
      }
    } else {
      const e = { id: uid(), date: todayStr(), projectId, task: task || '', notes: notes || '',
                  seconds: Math.max(0, Math.floor(seconds || 0)), running: false, startedAt: 0 };
      entries.unshift(e);
      if (start) beginTimer(app, e);
    }
    await persist(); updateTray(app);
    closeEntryWindow(app);
    app.push('refresh', {});
    return true;
  },
};

// left-click the tray = start/pause the timer (the play/pause "button").
// With nothing to toggle yet, fall back to opening the popover so first-run
// isn't a dead click.
function toggleTimer(app) {
  const r = runningEntry();
  if (r) { endTimer(r); }
  else if (entries[0]) { beginTimer(app, entries[0]); }
  else { showPopover(app); return; }
  persist(); updateTray(app);
  if (popShown) app.push('refresh', {});
}

// Harvest's menu-bar widget has two zones — a play/pause button on the left and
// a time readout on the right that opens the popover. tinyjs's status item is a
// single click target, but we can still split it: `tray.position()` gives the
// item's rect and `mousePosition()` gives the cursor at click time, so we know
// which half was hit. Left ~40% (the glyph) → start/pause; right (the time) →
// toggle the popover. Just what you'd guess Harvest is doing.
async function onTrayClick(app) {
  try {
    const [spot, mouse] = await Promise.all([app.tray.position(), app.mousePosition()]);
    if (spot && mouse && typeof mouse.x === 'number') {
      // The pill renders 18pt tall × (18·58/22)≈47.5pt wide (0.22.1 preserves
      // aspect); the glyph→time seam sits ~30% into the image, ≈34% of the
      // whole item once the status bar's side padding is added.
      const splitX = spot.x + spot.width * 0.34;
      if (mouse.x >= splitX) { togglePopover(app); return; }
    }
  } catch (e) {}
  toggleTimer(app);   // glyph side (or if we couldn't read the geometry)
}

// ── tray clicks (backend side) ──────────────────────────────────────────────
export function onTray(id, app) {
  if (id === null) { onTrayClick(app); return; }         // left-click: split by cursor position
  if (id === 'show') { togglePopover(app); return; }
  if (id === 'quit') { app.quit(); return; }
  if (id === 'prefs') { openPrefs(app); return; }
  if (id === 'new') { showPopover(app); openEntryWindow(app, null); return; }
  if (id === 'stop') { const r = runningEntry(); if (r) { endTimer(r); persist(); updateTray(app); if (popShown) app.push('refresh', {}); } return; }
  if (id === 'resume') { const last = entries[0]; if (last) { beginTimer(app, last); persist(); updateTray(app); if (popShown) app.push('refresh', {}); } return; }
}

// ── global hotkeys (Preferences → Shortcuts) ────────────────────────────────
export function onHotkey(id, app) {
  if (id === 'sc_new') { openEntryWindow(app, null); return; }
  if (id === 'sc_toggle') { togglePopover(app); return; }
  if (id === 'sc_summary') { showPopover(app, { view: 'summary' }); return; }
  if (id === 'sc_favs') { showPopover(app, { view: 'favorites' }); return; }
}

// Preferences has a native close button, so its lifecycle DOES flow through
// here. The entry window doesn't: it's frameless and only ever closes through
// closeEntryWindow(), which updates entryOpen synchronously — we deliberately
// don't touch entryOpen/pendingEdit here, because this handler fires
// asynchronously and would clobber a fresh reopen (close-then-reopen).
export function onWindowClosed(id, app) {
  if (id === 'prefs') {
    prefsOpen = false;
    if (popShown && !detached) { try { app.setLevel('floating'); } catch (e) {} }
  }
}

// ── boot ─────────────────────────────────────────────────────────────────────
export function init(app) {
  store = app.store;
  updateTray(app);
  startTicker(app);
  app.setHideOnClose && app.setHideOnClose(true);   // clicking away / closing hides, never quits
  (async () => {
    try {
      const [savedE, savedF, savedP, savedW] = await Promise.all([
        store.get('entries'), store.get('favorites'), store.get('prefs'), store.get('win')]);
      if (Array.isArray(savedE)) entries = savedE;
      if (Array.isArray(savedF)) favorites = savedF;
      if (savedP && typeof savedP === 'object') prefs = { ...prefs, ...savedP, shortcuts: { ...(savedP.shortcuts || {}) } };
      if (savedW && savedW.detached && savedW.rect) { detached = true; detRect = savedW.rect; }
      if (prefs.dock) { try { app.setDockVisible(true); } catch (e) {} }
      for (const id of SC_IDS) if (prefs.shortcuts[id]) { try { app.hotkey.register(id, prefs.shortcuts[id]); } catch (e) {} }
      updateTray(app);
      if (popShown) app.push('refresh', {});
    } catch (e) {}
  })();
}
