// Pasta — clipboard history in the menu bar. Copy things all day; summon the
// palette with ⌘⇧V (or the tray icon), arrow to a clip, hit ⏎ to copy it back.
//
// One app, six tinyjs techniques (0.11.0 core edition):
//
//   1. Native clipboard   — app.clipboard.read()/write()/changeCount():
//                           NSPasteboard in the launcher process. No pbpaste,
//                           no osascript polling, no scratch files, and
//                           multi-file writes never lose the tail.
//   2. SQLite history     — txiki's built-in `tjs:sqlite`, no dependencies.
//                           Search, dedupe, and pruning are all one query each.
//   3. Images on disk     — a copied image is written to Application Support
//                           as png; sips makes the list thumbnail. Only the
//                           thumbnail ever crosses the bridge. Image and file
//                           clips drag OUT of the palette (win.startDrag).
//   4. Paste for real     — app.paste() posts a native ⌘V (one Accessibility
//                           permission, prompted via app.permissions). hide()
//                           deactivates the app, so focus is already back
//                           where the user was.
//   5. Global hotkey      — app.hotkey.register('palette', 'cmd+shift+v')
//                           summons the frameless vibrancy palette anywhere.
//   6. tiny.store         — the paused flag survives relaunches.
//
// One JXA probe remains — per clipboard *change*, not per second: core
// read() doesn't (yet) report the Concealed flag, the frontmost app, or a
// browser copy's source url, so a single osascript fetches those three.
//
// (0.11.0 wart: exporting onClipboardChange should push changes to us, but
// the generated entry doesn't forward it — so we poll changeCount() once a
// second instead. That's an in-process launcher query: still zero spawns.)

import { Database } from 'tjs:sqlite';

const POLL_MS = 1000;        // how often we probe changeCount (launcher query)
const MAX_LEN = 100_000;     // ignore monster text clipboards
const MAX_HTML = 200_000;    // rich-text flavour kept up to this size
const MAX_IMG = 20 * 1024 * 1024;  // skip images beyond this
const MAX_ITEMS = 500;       // keep the newest N unpinned clips
const PREVIEW = 400;         // chars of each clip the list view gets
const THUMB_PX = '280';      // list thumbnail bounding box

const dec = new TextDecoder();

const SUPPORT_DIR = tjs.env.HOME + '/Library/Application Support/com.example.pasta';
const IMG_DIR = SUPPORT_DIR + '/images';

let db = null;
let paused = false;
let lastChange = -1;         // clipboard changeCount we last acted on
let open = false;            // is the palette showing?
let lastBlurHide = 0;        // ms timestamp of the last click-out dismiss

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

// ---------------------------------------------------------- metadata probe

// The one thing core clipboard.read() doesn't tell us (yet): whether the
// clip is marked Concealed/Transient (password managers — a clipboard
// manager that records secrets is malware with good intentions), which app
// was frontmost when it landed, and the page a Chromium copy came from.
// One osascript per clipboard change — the idle path costs nothing.
const JXA_META = `
ObjC.import('AppKit');
const pb = $.NSPasteboard.generalPasteboard;
const out = {};
const fm = $.NSWorkspace.sharedWorkspace.frontmostApplication;
if (!fm.isNil()) out.app = ObjC.unwrap(fm.localizedName);
const types = [];
const t = pb.types;
if (!t.isNil()) for (let i = 0; i < t.count; i++) types.push(ObjC.unwrap(t.objectAtIndex(i)));
out.concealed = types.includes('org.nspasteboard.ConcealedType') ||
                types.includes('org.nspasteboard.TransientType');
const su = pb.stringForType('org.chromium.source-url');
if (!su.isNil()) out.src = ObjC.unwrap(su);
JSON.stringify(out);`;

async function pbMeta() {
  const raw = await readOut(['osascript', '-l', 'JavaScript', '-e', JXA_META]);
  try { return JSON.parse(raw); } catch { return {}; }
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
  // older history.db files: add the new columns in place
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

// A new image capture. clip.image is a launcher temp file that only lives
// until the next clipboard change, so adopt it immediately: hash for dedupe,
// sips for dimensions + the list thumbnail, bytes into images/<id>.png.
async function adoptImage(clip, meta) {
  let bytes;
  try { bytes = await tjs.readFile(clip.image); } catch { return; }
  if (!bytes.length || bytes.length > MAX_IMG) return;

  let h = 0x811c9dc5;                    // FNV-1a — a dedupe key, not a checksum
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  const hash = h.toString(36) + '-' + bytes.length;

  const dims = await readOut(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', clip.image]);
  const w = Number((dims.match(/pixelWidth: (\d+)/) || [])[1]) || null;
  const hh = Number((dims.match(/pixelHeight: (\d+)/) || [])[1]) || null;

  const label = `Image ${w || '?'}×${hh || '?'} · ${hash}`;
  const existing = rowByText(label);
  const row = record({ kind: 'image', text: label,
    meta: { app: meta.app, w, h: hh, bytes: bytes.length } });
  if (existing && existing.file) return;           // seen before — just bumped

  const file = `${IMG_DIR}/${row.id}.png`;
  await tjs.writeFile(file, bytes);
  if (w && Math.max(w, hh) <= Number(THUMB_PX)) {
    await run(['cp', file, thumbOf(file)]);        // sips -Z would upscale
  } else {
    await run(['sips', '-Z', THUMB_PX, file, '--out', thumbOf(file)]);
  }
  const stmt = db.prepare('UPDATE clips SET file = ? WHERE id = ?');
  stmt.run(file, row.id);
  stmt.finalize();
}

// ------------------------------------------------------------------- capture

let polling = false;
async function poll(app) {
  if (paused || polling || !db) return;
  polling = true;
  try {
    const count = await app.clipboard.changeCount();
    if (count === lastChange) return;
    const [clip, meta] = await Promise.all([app.clipboard.read(), pbMeta()]);
    lastChange = clip.changeCount;       // read() is authoritative if it moved again
    if (meta.concealed) return;          // password managers: never record

    if (clip.kind === 'text' && clip.text && clip.text.trim()) {
      record({
        kind: 'text',
        text: clip.text.slice(0, MAX_LEN),
        meta: { app: meta.app, src: meta.src },
        html: clip.html && clip.html.length <= MAX_HTML ? clip.html : null,
      });
    } else if (clip.kind === 'files' && clip.paths.length) {
      record({
        kind: 'files',
        text: clip.paths.join('\n'),
        meta: { app: meta.app, count: clip.paths.length },
      });
    } else if (clip.kind === 'image' && clip.image) {
      await adoptImage(clip, meta);
    } else if (clip.kind === 'color' && clip.color) {
      const hex = clip.color.toUpperCase();
      const alpha = hex.length === 9 ? Math.round(parseInt(hex.slice(7), 16) / 2.55) / 100 : null;
      record({ kind: 'color', text: hex, meta: { app: meta.app, alpha } });
    } else {
      return;                            // empty — nothing to show
    }
    if (open) app.push('changed');       // palette is up — refresh it live
  } finally {
    polling = false;
  }
}

// Put a clip back on the clipboard, matching the kind it came in as.
// `plain` strips the rich flavour from a text clip (paste as plain text).
// Syncing lastChange right after stops the poller from re-recording our own
// write (the CLIPWRITE message and the changeCount query share an ordered
// pipe, so the count we read includes it).
async function copyBack(app, row, plain = false) {
  if (row.kind === 'image') {
    app.clipboard.write({ image: row.file });
  } else if (row.kind === 'files') {
    app.clipboard.write({ paths: row.text.split('\n') });
  } else if (row.kind === 'color') {
    app.clipboard.write({ color: row.text, text: row.text });
  } else {
    app.clipboard.write({ text: row.text, html: (row.html && !plain) ? row.html : undefined });
  }
  lastChange = await app.clipboard.changeCount();
}

// Native ⌘V into whatever app got focus back when the palette hid. Needs
// Accessibility; when it's missing, explain + open System Settings at the
// right pane instead of failing silently.
async function pasteInto(app) {
  await new Promise((r) => setTimeout(r, 250));    // let focus land back
  const res = await app.paste();
  if (!res.trusted) {
    app.notify({
      title: 'Pasta copied — but couldn’t paste',
      body: 'Allow Pasta under System Settings → Privacy & Security → Accessibility to paste directly.',
    });
    app.permissions.request('accessibility');
  }
}

// ------------------------------------------------------------------- palette

async function openPalette(app) {
  app.center();
  app.show();
  open = true;
  app.push('opened', { paused });      // page resets search, refetches, focuses
}

// app.hide() deactivates the app (0.11.0), so macOS hands focus back to
// whoever had it before the palette — ⌘⇧V → ⏎ is one uninterrupted motion,
// no frontmost-pid bookkeeping.
function closePalette(app) {
  app.hide();
  open = false;
}

async function togglePalette(app) {
  if (open) { closePalette(app); return; }
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
  // Search + list, newest first (pinned lead). Only a preview of each clip
  // crosses the bridge (for images, the thumbnail); full payloads stay in
  // SQLite / on disk until someone copies them. Image and files rows also
  // get `drag`: real paths for tiny.win.startDrag — drag a clip straight
  // into Finder, Slack, anywhere.
  list: async ({ query } = {}) => {
    const q = String(query || '').trim().toLowerCase();
    const cols = `id, kind, meta, substr(text, 1, ${PREVIEW}) AS preview,
                  length(text) AS len, file, pinned, last_at, times,
                  CASE WHEN kind = 'files' THEN text END AS ftext`;
    const order = 'ORDER BY pinned DESC, last_at DESC LIMIT 200';
    const stmt = q
      ? db.prepare(`SELECT ${cols} FROM clips WHERE instr(lower(text), ?) > 0 ${order}`)
      : db.prepare(`SELECT ${cols} FROM clips ${order}`);
    const rows = q ? stmt.all(q) : stmt.all();
    stmt.finalize();
    for (const row of rows) {
      row.meta = row.meta ? JSON.parse(row.meta) : {};
      if (row.kind === 'image' && row.file) {
        row.thumb = await thumbUri(row.id, row.file);
        row.drag = [row.file];
      } else if (row.kind === 'files') {
        row.drag = row.ftext.split('\n');
      }
      delete row.file;
      delete row.ftext;
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM clips');
    const total = count.all()[0].n;
    count.finalize();
    return { rows, total, paused };
  },

  // Put a clip back on the clipboard — as whatever it was: files paste as
  // files, images as images, colors as colors, text with its rich flavour
  // when we kept one (`plain: true` strips it). `paste: true` then types a
  // native ⌘V into the app that got focus back.
  copy: async ({ id, plain, paste }, app) => {
    const stmt = db.prepare('SELECT kind, text, meta, file, html FROM clips WHERE id = ?');
    const row = stmt.all(id)[0];
    stmt.finalize();
    if (!row) throw new Error('clip is gone');
    await copyBack(app, row, !!plain);
    record({ kind: row.kind, text: row.text, meta: row.meta ? JSON.parse(row.meta) : null, html: row.html });
    closePalette(app);                 // hide() hands focus back by itself
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
  // The user's click already focused something else, so hide()'s deactivate
  // is a natural no-op here: focus stays where they put it.
  blurHide: (_p, app) => {
    if (open) { closePalette(app); lastBlurHide = Date.now(); }
    return true;
  },

  hide: (_p, app) => (closePalette(app), true),
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
