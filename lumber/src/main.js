// Lumber — a log-tailing HUD. Open or drop a .log file and it live-follows
// the tail in an always-on-top translucent panel that floats over your editor.
//
// The whole trick is three txiki.js primitives:
//
//   1. tjs.watch(path, cb)     — kernel file events; a write to the log wakes
//                                us instantly, no polling.
//   2. offset reads            — tjs.open(path, 'r') + fh.read(buf, offset):
//                                we remember how far we've read and fetch only
//                                the new bytes, so a 2 GB log costs nothing.
//   3. streaming TextDecoder   — appends can split a UTF-8 char or a line in
//                                half; decode({stream: true}) + a carry string
//                                make the seams invisible.
//
// Everything else is chrome: "hud" vibrancy (tinyjs.json), always-on-top by
// default, and a built-in demo log writer so the app works the moment you
// open it, no log file required.

const TAIL_BYTES = 256 * 1024;   // how much of an existing file to show at open
const CHUNK = 64 * 1024;         // read buffer
const SUPPORT_DIR = tjs.env.HOME + '/Library/Application Support/art.tarwin.lumber';

let path = null;        // the file we're tailing
let offset = 0;         // bytes of it we've already delivered
let watcher = null;
let dec = null;         // streaming decoder for the current file
let carry = '';         // trailing partial line waiting for its newline
let reading = false;    // re-entrancy guard: watch events can pile up
let again = false;      // ...and one flag remembers "more arrived while busy"
let onTop = true;

// ------------------------------------------------------------------ tailing

async function readNew(app) {
  if (!path) return;
  if (reading) { again = true; return; }
  reading = true;
  try {
    do {
      again = false;
      let st;
      try { st = await tjs.stat(path); }
      catch { app.push('gone', { path }); return; }

      if (st.size < offset) {
        // Truncated or rotated-in-place: start over from the top.
        offset = 0; carry = ''; dec = new TextDecoder();
        app.push('lines', { reset: true, note: 'file truncated — reloaded', lines: [] });
      }
      if (st.size === offset) continue;

      const fh = await tjs.open(path, 'r');
      const buf = new Uint8Array(CHUNK);
      const lines = [];
      try {
        while (offset < st.size) {
          const n = await fh.read(buf, offset);
          if (!n) break;
          offset += n;
          carry += dec.decode(buf.subarray(0, n), { stream: true });
          const parts = carry.split('\n');
          carry = parts.pop();           // keep the unfinished line for later
          lines.push(...parts);
        }
      } finally {
        await fh.close();
      }
      if (lines.length) app.push('lines', { lines });
    } while (again);
  } finally {
    reading = false;
  }
}

function stopWatching() {
  if (watcher) { watcher.close(); watcher = null; }
  path = null;
}

async function openLog(p, app) {
  if (p !== demoPath()) stopDemo();
  stopWatching();

  const st = await tjs.stat(p);          // throws → the api call rejects
  if (!st.isFile) throw new Error('not a file: ' + p);

  path = p;
  dec = new TextDecoder();
  carry = '';

  // Big file? Start TAIL_BYTES from the end and drop the first partial line.
  offset = Math.max(0, st.size - TAIL_BYTES);
  const skippedTail = offset > 0;

  app.push('file', { path: p, name: p.split('/').pop(), size: st.size });
  app.push('lines', { reset: true, lines: [], note: skippedTail ? 'showing last 256 KB' : null });
  await readNew(app);
  if (skippedTail) app.push('trim-first', {});   // that first "line" was a fragment

  // 'change' = new bytes; 'rename' = the file was rotated away — re-arm on
  // whatever takes its place at the same path.
  watcher = tjs.watch(p, (_f, event) => {
    if (event === 'rename') return rewatch(app);
    readNew(app);
  });

  app.store.set('last', p);
}

// After a rotation the inode we watched is gone. Poll briefly for a new file
// at the same path (logrotate recreates it almost immediately) and re-open.
function rewatch(app, tries = 0) {
  const p = path;
  stopWatching();
  path = p;                              // still "our" file, just re-arming
  setTimeout(async () => {
    try {
      await tjs.stat(p);
      await openLog(p, app);
    } catch {
      if (tries < 20) rewatch(app, tries + 1);
      else { path = null; app.push('gone', { path: p }); }
    }
  }, 250);
}

// --------------------------------------------------------------- demo writer
// A fake service that logs forever, so the HUD demos itself. It's a real file
// on disk being really appended to — Lumber tails it like any other log.

const demoPath = () => SUPPORT_DIR + '/demo.log';
let demoTimer = null;
let demoFh = null;
let demoN = 0;

const DEMO = [
  ['INFO ', 'http    GET /api/planks 200 · #ms#ms'],
  ['INFO ', 'http    GET /api/forests/#n# 200 · #ms#ms'],
  ['INFO ', 'http    POST /api/orders 201 · #ms#ms'],
  ['DEBUG', 'cache   hit key=plank:#n#'],
  ['DEBUG', 'pool    checkout conn=#n# idle=4'],
  ['INFO ', 'saw     cut #n# planks from log #n#'],
  ['WARN ', 'saw     blade temperature high (#n#°C), throttling'],
  ['WARN ', 'http    slow request GET /api/inventory · #ms#0ms'],
  ['ERROR', 'db      connection reset by peer, retrying (attempt #d#)'],
  ['ERROR', 'saw     jam detected on line #d# — operator paged'],
  ['INFO ', 'worker  #d# heartbeat ok'],
];
const rnd = (n) => Math.floor(Math.random() * n);

function demoLine() {
  // Mostly quiet INFO/DEBUG traffic with the occasional WARN/ERROR spike.
  const roll = rnd(20);
  const pool = roll < 1 ? DEMO.filter((d) => d[0] === 'ERROR')
    : roll < 3 ? DEMO.filter((d) => d[0] === 'WARN ')
    : DEMO.filter((d) => d[0] === 'INFO ' || d[0] === 'DEBUG');
  const [level, tpl] = pool[rnd(pool.length)];
  const msg = tpl
    .replaceAll('#n#', String(100 + rnd(900)))
    .replaceAll('#ms#', String(2 + rnd(40)))
    .replaceAll('#d#', String(1 + rnd(8)));
  return new Date().toISOString() + ' ' + level + ' ' + msg + '\n';
}

async function startDemo(app) {
  stopDemo();
  const proc = tjs.spawn(['mkdir', '-p', SUPPORT_DIR], { stdout: 'ignore', stderr: 'ignore' });
  await proc.wait();
  await tjs.writeFile(demoPath(), new TextEncoder().encode(
    new Date().toISOString() + ' INFO  sawmill demo service starting up\n'));
  demoFh = await tjs.open(demoPath(), 'a');
  demoN = 0;
  const tickDemo = async () => {
    if (!demoFh) return;
    let burst = 1 + rnd(3);
    let out = '';
    while (burst--) out += demoLine();
    demoN += 1;
    try { await demoFh.write(new TextEncoder().encode(out)); } catch { stopDemo(); }
    demoTimer = setTimeout(tickDemo, 250 + rnd(900));
  };
  demoTimer = setTimeout(tickDemo, 300);
  await openLog(demoPath(), app);
}

function stopDemo() {
  if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
  if (demoFh) { demoFh.close(); demoFh = null; }
}

// ---------------------------------------------------------------------- app

function contextMenu() {
  return [
    { id: 'ontop', label: 'Always on Top', checked: onTop },
    { id: 'reveal', label: 'Reveal in Finder', enabled: !!path },
    { separator: true },
    { id: 'quit', label: 'Quit Lumber' },
  ];
}

function setOnTop(app, v) {
  onTop = !!v;
  app.setAlwaysOnTop(onTop);
  app.setContextMenu(contextMenu());
  app.push('ontop', { onTop });
}

export const api = {
  open: async ({ path: p }, app) => (await openLog(p, app), true),
  demo: async (_p, app) => (await startDemo(app), true),
  setOnTop: (({ v }, app) => (setOnTop(app, v), onTop)),
  reveal: () => { if (path) tjs.spawn(['open', '-R', path], { stdout: 'ignore', stderr: 'ignore' }); return true; },

  // Called by the page once its listeners are up (so the initial 'file' +
  // 'lines' pushes can't race the page load): reopen the last tailed file.
  boot: async (_p, app) => {
    const p = path || await app.store.get('last');
    if (typeof p === 'string' && p) {
      try { await openLog(p, app); } catch { /* it moved — empty state */ }
    }
    return { onTop };
  },
};

export function onContextMenu(id, app) {
  if (id === 'ontop') return setOnTop(app, !onTop);
  if (id === 'reveal') return api.reveal();
  if (id === 'quit') return app.quit();
}

export function init(app) {
  app.setMenu([{ title: 'Help', items: [{ id: 'check-updates', label: 'Check for Updates…' }] }]);
  app.setAlwaysOnTop(true);              // it's a HUD — float by default
  app.setContextMenu(contextMenu());
  // The page calls api.boot when it's ready — that reopens the last file.
}


export function onMenu(id, app) {
  if (id === 'check-updates') checkForUpdates(app);
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
