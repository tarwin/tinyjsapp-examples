// Pasta — clipboard history in the menu bar. Copy things all day; summon the
// palette with ⌘⇧V (or the tray icon), arrow to a clip, hit ⏎ to copy it back.
//
// One app, six tinyjs techniques:
//
//   1. Clipboard poller   — NSPasteboard via JXA (osascript -l JavaScript)
//                           every second through tjs.spawn. changeCount makes
//                           the idle poll a no-op; on change one call
//                           classifies copied-files / image / color / text.
//   2. SQLite history     — txiki's built-in `tjs:sqlite`, no dependencies.
//                           Search, dedupe, and pruning are all one query each.
//   3. Images on disk     — a copied image is written to Application Support
//                           as png; sips makes the list thumbnail. Only the
//                           thumbnail ever crosses the bridge.
//   4. Global hotkey      — app.hotkey.register('palette', 'cmd+shift+v')
//                           summons the palette from anywhere.
//   5. Frameless vibrancy — the window is a floating translucent palette
//                           (tinyjs.json "chrome"), dismissed on focus loss.
//   6. tiny.store         — the paused flag survives relaunches.
//
// The page never touches the system: it lists/searches over the api, and
// re-copying goes backend-side — the same kind that was captured (files copy
// back as files, images as images, rich text keeps its formatting).

import { Database } from 'tjs:sqlite';

const POLL_MS = 1000;        // how often we peek at the clipboard
const MAX_LEN = 100_000;     // ignore monster text clipboards
const MAX_HTML = 200_000;    // rich-text flavour kept up to this size
const MAX_ITEMS = 500;       // keep the newest N clips
const PREVIEW = 400;         // chars of each clip the list view gets
const THUMB_PX = '280';      // list thumbnail bounding box

const dec = new TextDecoder();
const enc = new TextEncoder();

const SUPPORT_DIR = tjs.env.HOME + '/Library/Application Support/com.example.pasta';
const IMG_DIR = SUPPORT_DIR + '/images';

let db = null;
let paused = false;
let lastChange = '';         // NSPasteboard.changeCount we last acted on
let open = false;            // is the palette showing?
let lastBlurHide = 0;        // ms timestamp of the last click-out dismiss
let prevAppPid = null;       // whoever was frontmost when the palette opened

// ------------------------------------------------------------------ spawning

async function readOut(cmd) {
  const proc = tjs.spawn(cmd, { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
  let out = '';
  const reader = proc.stdout.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out += dec.decode(value);
    }
  } catch { /* stream closes with the process */ }
  await proc.wait();
  return out;
}

async function run(cmd) {
  const proc = tjs.spawn(cmd, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  await proc.wait();
}

// --------------------------------------------------------- the pasteboard

// pbpaste/pbcopy only speak text. The real clipboard is NSPasteboard, and JXA
// (osascript -l JavaScript + the ObjC bridge) gets all of it: a changeCount
// for cheap change detection, file URLs from a Finder ⌘C, raw image data,
// the html flavour of rich text, and which app was frontmost when it landed.
// Each script is one spawn; JSON comes back on stdout.

// Snapshot: argv = [lastChangeCount, imageCapturePath]. Fast no-op when the
// changeCount hasn't moved; otherwise classify files → image → color → text.
// Clips marked Concealed/Transient (password managers do this) are skipped —
// a clipboard manager that records secrets is malware with good intentions.
const JXA_SNAPSHOT = `
ObjC.import('AppKit');
function run(argv) {
  const pb = $.NSPasteboard.generalPasteboard;
  const c = pb.changeCount + '';
  if (c === argv[0]) return JSON.stringify({ c });

  const out = { c };
  const fm = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!fm.isNil()) out.app = ObjC.unwrap(fm.localizedName);

  const types = [];
  const t = pb.types;
  if (!t.isNil()) for (let i = 0; i < t.count; i++) types.push(ObjC.unwrap(t.objectAtIndex(i)));

  if (types.includes('org.nspasteboard.ConcealedType') ||
      types.includes('org.nspasteboard.TransientType')) {
    out.kind = 'skip';
    return JSON.stringify(out);
  }

  if (types.includes('public.file-url')) {
    const urls = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL.class), $());
    const paths = [];
    if (!urls.isNil()) for (let i = 0; i < urls.count; i++) {
      const u = urls.objectAtIndex(i);
      if (u.isFileURL) paths.push(ObjC.unwrap(u.path));
    }
    if (paths.length) { out.kind = 'files'; out.paths = paths; return JSON.stringify(out); }
  }

  for (const type of ['public.png', 'public.tiff']) {
    if (!types.includes(type)) continue;
    let data = pb.dataForType(type);
    if (data.isNil()) continue;
    if (type === 'public.tiff') {                 // normalize to png
      const rep = $.NSBitmapImageRep.imageRepWithData(data);
      if (rep.isNil()) continue;
      data = rep.representationUsingTypeProperties(4 /* png */, $({}));
      if (data.isNil()) continue;
    }
    if (data.length > 20 * 1024 * 1024) { out.kind = 'skip'; return JSON.stringify(out); }
    // FNV-1a over the base64 — a dedupe key, not a checksum
    const b64 = ObjC.unwrap(data.base64EncodedStringWithOptions(0));
    let h = 0x811c9dc5;
    for (let i = 0; i < b64.length; i++) { h ^= b64.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    data.writeToFileAtomically(argv[1], true);
    const rep = $.NSBitmapImageRep.imageRepWithData(data);
    out.kind = 'image';
    out.hash = h.toString(36) + '-' + data.length;
    out.bytes = Number(data.length + '');       // ObjC numbers bridge as strings
    if (!rep.isNil()) { out.w = Number(rep.pixelsWide + ''); out.h = Number(rep.pixelsHigh + ''); }
    return JSON.stringify(out);
  }

  if (types.includes('com.apple.cocoa.pasteboard.color')) {
    const cols = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSColor.class), $());
    if (!cols.isNil() && cols.count > 0) {
      const cc = cols.objectAtIndex(0).colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);
      if (!cc.isNil()) {
        const b = (v) => Math.round(Number(v + '') * 255).toString(16).padStart(2, '0').toUpperCase();
        out.kind = 'color';
        out.hex = '#' + b(cc.redComponent) + b(cc.greenComponent) + b(cc.blueComponent);
        const a = Number(cc.alphaComponent + '');
        if (a < 1) out.alpha = Math.round(a * 100) / 100;
        return JSON.stringify(out);
      }
    }
  }

  const s = pb.stringForType('public.utf8-plain-text');
  if (!s.isNil()) {
    out.kind = 'text';
    out.text = ObjC.unwrap(s).slice(0, ${MAX_LEN});
    const html = pb.stringForType('public.html');
    if (!html.isNil()) {
      const hs = ObjC.unwrap(html);
      if (hs.length <= ${MAX_HTML}) out.html = hs;
    }
    // Chromium browsers attach the page a copy came from
    const su = pb.stringForType('org.chromium.source-url');
    if (!su.isNil()) out.src = ObjC.unwrap(su);
  }
  return JSON.stringify(out);
}`;

// Copy-back: argv = [kind, payload...]. Payloads travel as files, never argv
// text — same reason as the old pbcopy scratch-file trick (txiki 26.6.0's
// WritableStream promises for process stdin never settle, so piping is out,
// and argv has hard size limits). Returns the new changeCount so the poller
// can ignore the copy it just made.
const JXA_COPYBACK = `
ObjC.import('AppKit');
function run(argv) {
  const pb = $.NSPasteboard.generalPasteboard;
  const kind = argv[0];
  pb.clearContents;
  if (kind === 'files') {
    // the legacy single-item flavour, on purpose: writeObjects() of several
    // NSURLs flushes per-item and a short-lived process can exit before the
    // last item lands (observed ~1-in-10). One NSFilenamesPboardType plist
    // is atomic, and the pasteboard server translates it to public.file-url
    // for modern readers (Finder pastes it fine).
    const list = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(argv[1], 4, $()));
    const paths = list.split('\\n').filter((p) => p);
    pb.declareTypesOwner($.NSArray.arrayWithObject('NSFilenamesPboardType'), $());
    pb.setPropertyListForType($(paths), 'NSFilenamesPboardType');
  } else if (kind === 'image') {
    pb.setDataForType($.NSData.dataWithContentsOfFile(argv[1]), 'public.png');
  } else if (kind === 'color') {
    const hex = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(argv[1], 4, $())).trim();
    const n = parseInt(hex.slice(1), 16);
    const c = $.NSColor.colorWithSRGBRedGreenBlueAlpha(
      ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1);
    pb.writeObjects($.NSArray.arrayWithObject(c));
    pb.setStringForType(hex, 'public.utf8-plain-text');   // apps that want text get the hex
  } else {
    const text = $.NSString.stringWithContentsOfFileEncodingError(argv[1], 4, $());
    pb.setStringForType(text, 'public.utf8-plain-text');
    if (argv[2]) {
      const html = $.NSString.stringWithContentsOfFileEncodingError(argv[2], 4, $());
      pb.setStringForType(html, 'public.html');
    }
  }
  return pb.changeCount + '';
}`;

// Who's frontmost right now / bring a pid back to the front. Captured before
// the palette shows, restored when it closes — so ⌘⇧V → ⏎ lands you exactly
// where you were. Activating another app needs no permissions.
const JXA_FRONTMOST = `
ObjC.import('AppKit');
const fm = $.NSWorkspace.sharedWorkspace.frontmostApplication;
fm.isNil() ? '' : fm.processIdentifier + '';`;

const JXA_ACTIVATE = `
ObjC.import('AppKit');
function run(argv) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]));
  if (!app.isNil()) app.activateWithOptions(2 /* ignoring other apps */);
  return '';
}`;

const jxa = (src, ...args) => ['osascript', '-l', 'JavaScript', '-e', src, ...args];

async function snapshot() {
  const raw = await readOut(jxa(JXA_SNAPSHOT, lastChange, SUPPORT_DIR + '/.capture.png'));
  try { return JSON.parse(raw); } catch { return null; }
}

// Put a clip back on the clipboard, matching the kind it came in as.
// `plain` strips the rich flavour from a text clip (paste as plain text).
async function copyBack(row, plain = false) {
  const scratch = SUPPORT_DIR + '/.copyback.tmp';
  let out;
  if (row.kind === 'image') {
    out = await readOut(jxa(JXA_COPYBACK, 'image', row.file));
  } else if (row.kind === 'files') {
    await tjs.writeFile(scratch, enc.encode(row.text));      // text = the paths
    out = await readOut(jxa(JXA_COPYBACK, 'files', scratch));
  } else if (row.kind === 'color') {
    await tjs.writeFile(scratch, enc.encode(row.text));      // text = the hex
    out = await readOut(jxa(JXA_COPYBACK, 'color', scratch));
  } else {
    await tjs.writeFile(scratch, enc.encode(row.text));
    if (row.html && !plain) {
      const hscratch = SUPPORT_DIR + '/.copyback.html';
      await tjs.writeFile(hscratch, enc.encode(row.html));
      out = await readOut(jxa(JXA_COPYBACK, 'text', scratch, hscratch));
      await run(['rm', '-f', hscratch]);
    } else {
      out = await readOut(jxa(JXA_COPYBACK, 'text', scratch));
    }
  }
  await run(['rm', '-f', scratch]);
  lastChange = out.trim() || lastChange;   // don't re-record our own copy
}

// Type ⌘V into whatever app the palette gave focus back to. Needs the
// Automation (System Events) + Accessibility permissions — when they're
// missing the osascript fails with a readable error and we point the user
// at System Settings instead of failing silently.
async function pasteInto(app) {
  await new Promise((r) => setTimeout(r, 300));    // let focus land back
  const out = await readOut(['/bin/sh', '-c',
    `osascript -e 'tell application "System Events" to keystroke "v" using command down' 2>&1`]);
  if (/error|not allowed|not authorized/i.test(out)) {
    app.notify({
      title: 'Pasta copied — but couldn’t paste',
      body: 'To paste directly, allow Pasta under System Settings → ' +
        'Privacy & Security → Accessibility (and Automation → System Events).',
    });
  }
}

// ------------------------------------------------------------------- storage

async function openDb() {
  await run(['mkdir', '-p', IMG_DIR]);
  db = new Database(SUPPORT_DIR + '/history.db');
  db.exec(`CREATE TABLE IF NOT EXISTS clips (
    id       INTEGER PRIMARY KEY,
    text     TEXT NOT NULL UNIQUE,
    kind     TEXT NOT NULL DEFAULT 'text',
    meta     TEXT,
    file     TEXT,
    html     TEXT,
    pinned   INTEGER NOT NULL DEFAULT 0,
    first_at INTEGER NOT NULL,
    last_at  INTEGER NOT NULL,
    times    INTEGER NOT NULL DEFAULT 1
  )`);
  // pre-image history.db: add the new columns in place
  for (const col of ["kind TEXT NOT NULL DEFAULT 'text'", 'meta TEXT', 'file TEXT', 'html TEXT',
    'pinned INTEGER NOT NULL DEFAULT 0']) {
    try { db.exec(`ALTER TABLE clips ADD COLUMN ${col}`); } catch { /* already there */ }
  }
}

function rowByText(text) {
  const stmt = db.prepare('SELECT id, file FROM clips WHERE text = ?');
  const row = stmt.all(text)[0];
  stmt.finalize();
  return row;
}

// One upsert keeps the history deduped — the same content just bumps to the
// top and counts another copy. `text` is the unique key for every kind:
// the content itself, the newline-joined paths, or an image's label+hash.
function record({ kind, text, meta, html }) {
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO clips (text, kind, meta, html, first_at, last_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(text) DO UPDATE SET last_at = excluded.last_at, times = times + 1`,
  );
  stmt.run(text, kind, meta ? JSON.stringify(meta) : null, html || null, now, now);
  stmt.finalize();
  pruneOld();
  return rowByText(text);
}

// Pinned clips are exempt: only the newest MAX_ITEMS *unpinned* clips stay.
function pruneOld() {
  const keep = `SELECT id FROM clips WHERE pinned = 0 ORDER BY last_at DESC LIMIT ${MAX_ITEMS}`;
  const doomed = db.prepare(
    `SELECT file FROM clips WHERE file IS NOT NULL AND pinned = 0 AND id NOT IN (${keep})`,
  );
  for (const row of doomed.all()) removeImageFiles(row.file);
  doomed.finalize();
  const prune = db.prepare(`DELETE FROM clips WHERE pinned = 0 AND id NOT IN (${keep})`);
  prune.run();
  prune.finalize();
}

function removeImageFiles(file) {
  return file ? run(['rm', '-f', file, thumbOf(file)]) : Promise.resolve();
}

const thumbOf = (file) => file.replace(/\.png$/, '.thumb.png');

// A new image capture: adopt .capture.png into images/<id>.png + a sips
// thumbnail; a re-copy of a known image just drops the duplicate capture.
async function adoptImage(snap) {
  const label = `Image ${snap.w || '?'}×${snap.h || '?'} · ${snap.hash}`;
  const meta = { app: snap.app, w: snap.w, h: snap.h, bytes: snap.bytes };
  const existing = rowByText(label);
  const row = record({ kind: 'image', text: label, meta });
  const cap = SUPPORT_DIR + '/.capture.png';
  if (existing && existing.file) { await run(['rm', '-f', cap]); return; }
  const file = `${IMG_DIR}/${row.id}.png`;
  await tjs.rename(cap, file);
  if (snap.w && Math.max(snap.w, snap.h) <= Number(THUMB_PX)) {
    await run(['cp', file, thumbOf(file)]);        // sips -Z would upscale
  } else {
    await run(['sips', '-Z', THUMB_PX, file, '--out', thumbOf(file)]);
  }
  const stmt = db.prepare('UPDATE clips SET file = ? WHERE id = ?');
  stmt.run(file, row.id);
  stmt.finalize();
}

// ------------------------------------------------------------------- poller

let polling = false;
async function poll(app) {
  if (paused || polling || !db) return;
  polling = true;
  try {
    const snap = await snapshot();
    if (!snap || snap.c === lastChange) return;
    lastChange = snap.c;
    if (snap.kind === 'text' && snap.text && snap.text.trim()) {
      record({ kind: 'text', text: snap.text, meta: { app: snap.app, src: snap.src }, html: snap.html });
    } else if (snap.kind === 'files') {
      record({
        kind: 'files',
        text: snap.paths.join('\n'),
        meta: { app: snap.app, count: snap.paths.length },
      });
    } else if (snap.kind === 'image') {
      await adoptImage(snap);
    } else if (snap.kind === 'color') {
      record({ kind: 'color', text: snap.hex, meta: { app: snap.app, alpha: snap.alpha } });
    } else {
      return;                          // skipped (concealed) or empty — no repaint
    }
    if (open) app.push('changed');     // palette is up — refresh it live
  } finally {
    polling = false;
  }
}

// ------------------------------------------------------------------- palette

async function openPalette(app) {
  prevAppPid = (await readOut(jxa(JXA_FRONTMOST))).trim() || null;
  app.center();
  app.show();
  open = true;
  app.push('opened', { paused });      // page resets search, refetches, focuses
}

// refocus: hand focus back to the app the palette interrupted. True for
// deliberate dismissals (⏎, esc, hotkey toggle); false when the user's own
// click already put focus somewhere else (blur), or when we're about to
// open something (a browser) that should keep it.
function closePalette(app, refocus = false) {
  app.hide();
  open = false;
  if (refocus && prevAppPid) run(jxa(JXA_ACTIVATE, prevAppPid));
}

async function togglePalette(app) {
  if (open) { closePalette(app, true); return; }
  // If the palette just dismissed itself because this very click stole its
  // focus, swallow the click instead of immediately reopening.
  if (Date.now() - lastBlurHide < 300) { lastBlurHide = 0; return; }
  await openPalette(app);
}

// ---------------------------------------------------------------------- tray

function paintTray(app) {
  app.tray.set({
    icon: 'sf:doc.on.clipboard',
    tooltip: 'Pasta — clipboard history (⌘⇧V)',
    primaryAction: true,               // left-click toggles; menu on right-click
    menu: [
      { id: 'title', label: 'Pasta — Clipboard History', enabled: false },
      { separator: true },
      { id: 'open', label: 'Show History  ⌘⇧V' },
      { id: 'pause', label: 'Pause Capturing', checked: paused },
      { separator: true },
      { id: 'clear', label: 'Clear History…' },
      { id: 'quit', label: 'Quit Pasta', key: 'q' },
    ],
  });
}

function setPaused(app, v) {
  paused = v;
  app.store.set('paused', paused);
  paintTray(app);                      // flip the ✓ in the tray menu
  if (open) app.push('model', { paused });
}

// ----------------------------------------------------------------------- api

const thumbCache = new Map();          // clip id -> data URI

async function thumbUri(id, file) {
  if (thumbCache.has(id)) return thumbCache.get(id);
  let uri = null;
  try {
    const bytes = await tjs.readFile(thumbOf(file));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    uri = 'data:image/png;base64,' + btoa(bin);
  } catch { /* thumb missing — the row renders a glyph */ }
  thumbCache.set(id, uri);
  return uri;
}

export const api = {
  // Search + list, newest first. Only a preview of each clip crosses the
  // bridge (for images, the thumbnail); full payloads stay in SQLite / on
  // disk until someone copies them.
  list: async ({ query } = {}) => {
    const q = String(query || '').trim().toLowerCase();
    const cols = `id, kind, meta, substr(text, 1, ${PREVIEW}) AS preview,
                  length(text) AS len, file, pinned, last_at, times`;
    const order = 'ORDER BY pinned DESC, last_at DESC LIMIT 200';
    const stmt = q
      ? db.prepare(`SELECT ${cols} FROM clips WHERE instr(lower(text), ?) > 0 ${order}`)
      : db.prepare(`SELECT ${cols} FROM clips ${order}`);
    const rows = q ? stmt.all(q) : stmt.all();
    stmt.finalize();
    for (const row of rows) {
      row.meta = row.meta ? JSON.parse(row.meta) : {};
      if (row.kind === 'image' && row.file) row.thumb = await thumbUri(row.id, row.file);
      delete row.file;                 // paths of ours; the page doesn't need them
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM clips');
    const total = count.all()[0].n;
    count.finalize();
    return { rows, total, paused };
  },

  // Put a clip back on the clipboard — as whatever it was: files paste as
  // files, images as images, colors as colors, text with its rich flavour
  // when we kept one (`plain: true` strips it). `paste: true` then types ⌘V
  // into the app that gets focus back. Recording it ourselves bumps it to
  // the top instantly, and syncing lastChange stops the poller from
  // counting the same copy twice.
  copy: async ({ id, plain, paste }, app) => {
    const stmt = db.prepare('SELECT kind, text, meta, file, html FROM clips WHERE id = ?');
    const row = stmt.all(id)[0];
    stmt.finalize();
    if (!row) throw new Error('clip is gone');
    await copyBack(row, !!plain);
    record({ kind: row.kind, text: row.text, meta: row.meta ? JSON.parse(row.meta) : null, html: row.html });
    closePalette(app, true);           // back to the app you were in
    if (paste) await pasteInto(app);
    return true;
  },

  // 📌 — pinned clips sort first and survive pruning and Clear History.
  pin: ({ id }) => {
    const stmt = db.prepare('UPDATE clips SET pinned = 1 - pinned WHERE id = ?');
    stmt.run(id);
    stmt.finalize();
    const get = db.prepare('SELECT pinned FROM clips WHERE id = ?');
    const row = get.all(id)[0];
    get.finalize();
    return row ? !!row.pinned : false;
  },

  // A text clip copied in a Chromium browser knows the page it came from.
  openSource: ({ id }, app) => {
    const stmt = db.prepare('SELECT meta FROM clips WHERE id = ?');
    const row = stmt.all(id)[0];
    stmt.finalize();
    const src = row && row.meta && JSON.parse(row.meta).src;
    if (!src || !/^https?:\/\//i.test(src)) return false;
    run(['open', src]);
    closePalette(app);
    return true;
  },

  remove: async ({ id }) => {
    const stmt = db.prepare('SELECT file FROM clips WHERE id = ?');
    const row = stmt.all(id)[0];
    stmt.finalize();
    if (row) await removeImageFiles(row.file);
    thumbCache.delete(id);
    const del = db.prepare('DELETE FROM clips WHERE id = ?');
    del.run(id);
    del.finalize();
    return true;
  },

  // Clear everything except pins. lastChange stays — whatever is on the
  // clipboard right now doesn't sneak straight back into the emptied history.
  clear: async () => {
    const doomed = db.prepare('SELECT file FROM clips WHERE pinned = 0 AND file IS NOT NULL');
    for (const row of doomed.all()) await removeImageFiles(row.file);
    doomed.finalize();
    db.exec('DELETE FROM clips WHERE pinned = 0');
    thumbCache.clear();
    return true;
  },

  setPaused: ({ paused: v }, app) => (setPaused(app, !!v), true),

  // The page lost focus (a click landed outside it) — dismiss like a menu.
  blurHide: (_p, app) => {
    if (open) { closePalette(app); lastBlurHide = Date.now(); }
    return true;
  },

  hide: (_p, app) => (closePalette(app, true), true),   // esc — go back too
};

// --------------------------------------------------------------- entrypoints

export function onHotkey(id, app) {
  if (id === 'palette') togglePalette(app);
}

export function onTray(id, app) {
  if (id === null) return togglePalette(app);      // bare left-click
  if (id === 'open') return openPalette(app);
  if (id === 'pause') return setPaused(app, !paused);
  if (id === 'clear') return openPalette(app).then(() => app.push('confirm-clear'));
  if (id === 'quit') return app.quit();
}

export function init(app) {
  // "activation": "accessory" — no Dock icon, window starts hidden. The tray
  // and the hotkey are the app; the palette appears on demand and hides
  // (never quits) when dismissed.
  app.setHideOnClose(true);
  app.setResizable(false);

  app.store.get('paused').then((v) => {
    if (typeof v === 'boolean') paused = v;
    paintTray(app);
  });

  app.hotkey.register('palette', 'cmd+shift+v');

  paintTray(app);
  openDb().then(() => setInterval(() => poll(app), POLL_MS));
}
