// Pasta — clipboard history in the menu bar. Copy things all day; summon the
// palette with ⌘⇧V (or the tray icon), arrow to a clip, hit ⏎ to copy it back.
//
// One app, five tinyjs techniques:
//
//   1. Clipboard poller   — pbpaste every second via tjs.spawn; a change gets
//                           upserted into SQLite (same text = bump to top).
//   2. SQLite history     — txiki's built-in `tjs:sqlite`, no dependencies.
//                           Search, dedupe, and pruning are all one query each.
//   3. Global hotkey      — app.hotkey.register('palette', 'cmd+shift+v')
//                           summons the palette from anywhere.
//   4. Frameless vibrancy — the window is a floating translucent palette
//                           (tinyjs.json "chrome"), dismissed on focus loss.
//   5. tiny.store         — the paused flag survives relaunches.
//
// The page never touches the system: it lists/searches over the api, and
// re-copying goes backend-side through pbcopy.

import { Database } from 'tjs:sqlite';

const POLL_MS = 1000;        // how often we peek at the clipboard
const MAX_LEN = 100_000;     // ignore monster clipboards (images paste as text-less anyway)
const MAX_ITEMS = 500;       // keep the newest N clips
const PREVIEW = 400;         // chars of each clip the list view gets

const dec = new TextDecoder();
const enc = new TextEncoder();

const SUPPORT_DIR = tjs.env.HOME + '/Library/Application Support/com.example.pasta';

let db = null;
let paused = false;
let lastSeen = null;         // last clipboard text we acted on (change detector)
let open = false;            // is the palette showing?
let lastBlurHide = 0;        // ms timestamp of the last click-out dismiss

// ---------------------------------------------------------------- pb helpers

async function pbpaste() {
  const proc = tjs.spawn(['pbpaste'], { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
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

// Feed pbcopy through a scratch file rather than a stdin pipe: txiki's
// WritableStream write()/close() promises never settle for process stdin
// (txiki.js 26.6.0), so an awaited pipe write would hang the api call. The
// scratch file lives next to history.db (same disk exposure) and is removed
// by the same shell line.
async function pbcopy(text) {
  const tmp = SUPPORT_DIR + '/.pbcopy.tmp';
  await tjs.writeFile(tmp, enc.encode(text));
  const proc = tjs.spawn(['/bin/sh', '-c', 'pbcopy < "$0"; rm -f "$0"', tmp],
    { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  await proc.wait();
}

// ------------------------------------------------------------------- storage

async function openDb() {
  const proc = tjs.spawn(['mkdir', '-p', SUPPORT_DIR], { stdout: 'ignore', stderr: 'ignore' });
  await proc.wait();
  db = new Database(SUPPORT_DIR + '/history.db');
  db.exec(`CREATE TABLE IF NOT EXISTS clips (
    id       INTEGER PRIMARY KEY,
    text     TEXT NOT NULL UNIQUE,
    first_at INTEGER NOT NULL,
    last_at  INTEGER NOT NULL,
    times    INTEGER NOT NULL DEFAULT 1
  )`);
}

// New clipboard text (or an old clip copied again): one upsert keeps the
// history deduped — same text just bumps to the top and counts another copy.
function record(text) {
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO clips (text, first_at, last_at) VALUES (?, ?, ?)
     ON CONFLICT(text) DO UPDATE SET last_at = excluded.last_at, times = times + 1`,
  );
  stmt.run(text, now, now);
  stmt.finalize();
  const prune = db.prepare(
    `DELETE FROM clips WHERE id NOT IN
     (SELECT id FROM clips ORDER BY last_at DESC LIMIT ${MAX_ITEMS})`,
  );
  prune.run();
  prune.finalize();
}

// ------------------------------------------------------------------- poller

let polling = false;
async function poll(app) {
  if (paused || polling || !db) return;
  polling = true;
  try {
    const text = await pbpaste();
    if (text && text.trim() && text.length <= MAX_LEN && text !== lastSeen) {
      lastSeen = text;
      record(text);
      if (open) app.push('changed');   // palette is up — refresh it live
    }
  } finally {
    polling = false;
  }
}

// ------------------------------------------------------------------- palette

async function openPalette(app) {
  app.center();
  app.show();
  open = true;
  app.push('opened', { paused });      // page resets search, refetches, focuses
}

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

export const api = {
  // Search + list, newest first. Only a preview of each clip crosses the
  // bridge; the full text stays in SQLite until someone copies it.
  list: ({ query } = {}) => {
    const q = String(query || '').trim().toLowerCase();
    const stmt = q
      ? db.prepare(
          `SELECT id, substr(text, 1, ${PREVIEW}) AS preview, length(text) AS len,
                  last_at, times FROM clips
           WHERE instr(lower(text), ?) > 0 ORDER BY last_at DESC LIMIT 200`,
        )
      : db.prepare(
          `SELECT id, substr(text, 1, ${PREVIEW}) AS preview, length(text) AS len,
                  last_at, times FROM clips ORDER BY last_at DESC LIMIT 200`,
        );
    const rows = q ? stmt.all(q) : stmt.all();
    stmt.finalize();
    const count = db.prepare('SELECT COUNT(*) AS n FROM clips');
    const total = count.all()[0].n;
    count.finalize();
    return { rows, total, paused };
  },

  // Put a clip back on the clipboard. Recording it ourselves (rather than
  // letting the poller notice) bumps it to the top instantly, and setting
  // lastSeen stops the poller from counting the same copy twice.
  copy: async ({ id }, app) => {
    const stmt = db.prepare('SELECT text FROM clips WHERE id = ?');
    const row = stmt.all(id)[0];
    stmt.finalize();
    if (!row) throw new Error('clip is gone');
    await pbcopy(row.text);
    lastSeen = row.text;
    record(row.text);
    closePalette(app);
    return true;
  },

  remove: ({ id }) => {
    const stmt = db.prepare('DELETE FROM clips WHERE id = ?');
    stmt.run(id);
    stmt.finalize();
    return true;
  },

  clear: () => {
    db.exec('DELETE FROM clips');
    // lastSeen stays — whatever is on the clipboard right now doesn't sneak
    // straight back into the emptied history.
    return true;
  },

  setPaused: ({ paused: v }, app) => (setPaused(app, !!v), true),

  // The page lost focus (a click landed outside it) — dismiss like a menu.
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
