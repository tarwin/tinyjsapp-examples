// Tiny Deck — backend. Runs on txiki.js with full system access.
//
// Every function in `api` is callable from the page:
//   const result = await api.call('name', { ...params });
// Each handler receives (params, app) — `app` has push/setTitle/setSize/quit.

import { Database } from 'tjs:sqlite';
import { Lib, CFunction, types, errno, strerror } from 'tjs:ffi';

const dec = new TextDecoder();
const enc = new TextEncoder();

const dirname = (p) => String(p).replace(/[\\/][^\\/]*$/, '');

// ---------------------------------------------------------------- notes db

const DB_PATH = tjs.homeDir + '/.tiny-deck.sqlite';
let db = null;
function notesDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec(`CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  }
  return db;
}

// ----------------------------------------------------------------- ffi
// dlopen a system library and call C symbols directly through libffi — no
// bindings, no compile step. Every OS ships enormous amounts of already-
// compiled code; FFI is how you borrow it.
//
// Each platform gets a call that actually MEANS something there, rather than
// one lowest-common-denominator demo:
//   macOS    sysctlbyname()      — query any kernel value by name
//   Linux    sysinfo()           — uptime, load averages and RAM in one struct
//   Windows  GetTickCount64() +  — uptime, and RAM via a struct you have to
//            GlobalMemoryStatusEx  size yourself before the call
// zlib rides along on macOS and Linux, which both ship it; Windows doesn't.

const IS_WIN = tjs.env.OS === 'Windows_NT';
const IS_LINUX = !IS_WIN && /linux/i.test(globalThis.navigator?.platform ?? '');
const FFI_OS = IS_WIN ? 'windows' : IS_LINUX ? 'linux' : 'macos';

let ffi = null;
function ffiLibs() {
  if (ffi) return ffi;
  if (FFI_OS === 'macos') {
    const libc = new Lib('/usr/lib/libSystem.B.dylib');
    const libz = new Lib('/usr/lib/libz.dylib');
    ffi = {
      os: 'macos', libc: '/usr/lib/libSystem.B.dylib', libzName: '/usr/lib/libz.dylib',
      sysctl: new CFunction(libc.symbol('sysctlbyname'), types.sint,
        [types.string, types.buffer, types.buffer, types.pointer, types.size]),
      getpid: new CFunction(libc.symbol('getpid'), types.sint, []),
      getppid: new CFunction(libc.symbol('getppid'), types.sint, []),
      ...zlibFns(libz),
    };
  } else if (FFI_OS === 'linux') {
    // glibc and zlib are on effectively every desktop Linux; the soname is
    // the stable thing to dlopen (the bare .so is a -dev symlink).
    const libc = new Lib('libc.so.6');
    ffi = {
      os: 'linux', libc: 'libc.so.6', libzName: 'libz.so.1',
      sysinfo: new CFunction(libc.symbol('sysinfo'), types.sint, [types.buffer]),
      gethostname: new CFunction(libc.symbol('gethostname'), types.sint,
        [types.buffer, types.size]),
      getpid: new CFunction(libc.symbol('getpid'), types.sint, []),
      getppid: new CFunction(libc.symbol('getppid'), types.sint, []),
    };
    try { Object.assign(ffi, zlibFns(new Lib('libz.so.1'))); } catch { /* optional */ }
  } else {
    const k32 = new Lib('kernel32.dll');
    ffi = {
      os: 'windows', libc: 'kernel32.dll', libzName: null,
      tickCount: new CFunction(k32.symbol('GetTickCount64'), types.uint64, []),
      memStatus: new CFunction(k32.symbol('GlobalMemoryStatusEx'), types.sint, [types.buffer]),
      getpid: new CFunction(k32.symbol('GetCurrentProcessId'), types.uint, []),
    };
  }
  return ffi;
}

function zlibFns(libz) {
  return {
    zlibVersion: new CFunction(libz.symbol('zlibVersion'), types.string, []),
    compress2: new CFunction(libz.symbol('compress2'), types.sint,
      [types.buffer, types.buffer, types.buffer, types.ulong, types.sint]),
    uncompress: new CFunction(libz.symbol('uncompress'), types.sint,
      [types.buffer, types.buffer, types.buffer, types.ulong]),
  };
}

function sysctlRaw(name) {
  const buf = new Uint8Array(1024);
  const len = new BigUint64Array([1024n]);
  const rc = ffiLibs().sysctl.call(name, buf, new Uint8Array(len.buffer), null, 0);
  if (rc !== 0) throw new Error(name + ': ' + strerror(errno()));
  return buf.subarray(0, Number(len[0]));
}

// struct sysinfo (linux, 64-bit) — uptime, 3 load averages, then memory in
// units of mem_unit bytes. Offsets are the ABI, not a guess.
function linuxSysinfo() {
  const buf = new Uint8Array(128);
  const rc = ffiLibs().sysinfo.call(buf);
  if (rc !== 0) throw new Error('sysinfo: ' + strerror(errno()));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const unit = dv.getUint32(104, true) || 1;
  return {
    uptime: Number(dv.getBigInt64(0, true)),
    load1: dv.getBigUint64(8, true),
    totalram: Number(dv.getBigUint64(32, true)) * unit,
    freeram: Number(dv.getBigUint64(40, true)) * unit,
    procs: dv.getUint16(80, true),
  };
}

// MEMORYSTATUSEX — 64 bytes, and dwLength MUST be set before the call or the
// API rejects it. A nice demo of a struct you have to size yourself.
function winMemory() {
  const buf = new Uint8Array(64);
  new DataView(buf.buffer).setUint32(0, 64, true);
  const rc = ffiLibs().memStatus.call(buf);
  if (rc === 0) throw new Error('GlobalMemoryStatusEx failed');
  const dv = new DataView(buf.buffer);
  return {
    load: dv.getUint32(4, true),
    totalPhys: Number(dv.getBigUint64(8, true)),
    availPhys: Number(dv.getBigUint64(16, true)),
  };
}

function sysctlValue(name) {
  const raw = sysctlRaw(name);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0) end--;
  const text = raw.subarray(0, end);
  const printable = end > 0 && text.every((b) => b === 9 || b === 10 || (b >= 32 && b < 127));
  // Test for a string FIRST: sysctl strings are NUL-terminated, so a value
  // that is printable text plus a trailing NUL is text no matter its length.
  // Checking width first turned hw.model ("Mac15,9\0", exactly 8 bytes) into
  // the int64 16092680645992781.
  if (printable && end < raw.length) return { kind: 'string', value: dec.decode(text) };
  if (raw.length === 4) return { kind: 'int32', value: String(dv.getInt32(0, true)) };
  if (raw.length === 8) return { kind: 'int64', value: String(dv.getBigInt64(0, true)) };
  if (printable) return { kind: 'string', value: dec.decode(text) };
  return {
    kind: raw.length + '-byte struct',
    value: [...raw].map((b) => b.toString(16).padStart(2, '0')).join(' '),
  };
}

// ------------------------------------------------------------ cpu sampling

function cpuTimes() {
  let busy = 0, total = 0;
  for (const c of tjs.system.cpus) {
    const t = c.times;
    busy += t.user + t.nice + t.sys + t.irq;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { busy, total };
}

// ------------------------------------------------------- running processes

const procs = new Map(); // id -> process

async function pump(id, stream, name, app) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      app.push('run:out', { id, stream: name, chunk: dec.decode(value) });
    }
  } catch { /* stream closed with the process */ }
}

// ------------------------------------------------------------- fs watching

let watcher = null;

// ------------------------------------------------------------ video export

let vidParts = [];

// ---------------------------------------------------------------------- api

// Confetti over the whole screen, in its own window: full-screen,
// transparent, always on top and CLICK-THROUGH, so it decorates the display
// without taking it hostage. It closes itself when the animation ends (see
// party.html) — nothing here has to tidy up.
//
// Guarded, because "party" is a word a model will reach for more than once
// and forty overlapping confetti windows is not a feature.
async function openParty(app) {
  if ((await app.windows()).includes('party')) return;
  const screens = await app.screens();
  const scr = screens.find((s) => s.primary) ?? screens[0];
  app.openWindow('party', {
    page: 'party.html',
    title: 'Party',
    size: `${scr.visible.width}x${scr.visible.height}`,
    x: scr.visible.x,
    y: scr.visible.y,
    chrome: { frame: false, transparent: true, windowControls: false },
  });
}

export const api = {
  async sysinfo() {
    const cpus = tjs.system.cpus;
    let ram = 'n/a';
    try {
      ram = (Number(BigInt(sysctlValue('hw.memsize').value)) / 2 ** 30) + ' GB (via ffi sysctl)';
    } catch { /* ffi is a bonus here, not load-bearing */ }
    return {
      ram,
      runtime: 'txiki.js ' + tjs.version,
      quickjs: tjs.engine.versions.quickjs,
      libuv: tjs.engine.versions.uv,
      webkit: navigator?.userAgent ?? 'n/a',
      host: tjs.hostName,
      user: tjs.system.userInfo.userName,
      cpu: cpus[0].model + ' × ' + cpus.length,
      pid: tjs.pid,
      exe: tjs.exePath,
      cwd: tjs.cwd,
      home: tjs.homeDir,
      tmp: tjs.tmpDir,
      db: DB_PATH,
      bootedDays: (tjs.system.uptime / 86400).toFixed(1),
    };
  },

  // The app's own icon.png, for the fileURL demo. Packaged and dev layouts put
  // it in different places, so probe rather than assume — and say so if it
  // isn't there, instead of handing the page a path that 404s in an <img>.
  async iconPath() {
    for (const c of [tjs.cwd + '/icon.png',
                     tjs.cwd + '/../Resources/icon.png',
                     dirname(tjs.exePath) + '/../Resources/icon.png']) {
      try { await tjs.stat(c); return { path: await tjs.realPath(c) }; } catch { /* next */ }
    }
    return { path: null };
  },

  // ---- files ----

  async listDir({ path }) {
    const entries = [];
    const iter = await tjs.readDir(path);
    for await (const e of iter) {
      entries.push({ name: e.name, isDir: !!e.isDirectory });
      if (entries.length >= 800) break;
    }
    entries.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    return { path, entries };
  },

  async readFile({ path }) {
    const st = await tjs.stat(path);
    const data = await tjs.readFile(path);
    const slice = data.subarray(0, 128 * 1024);
    // crude binary sniff: NUL byte in the first 8k means "don't render as text"
    const head = slice.subarray(0, 8192);
    let binary = false;
    for (let i = 0; i < head.length; i++) if (head[i] === 0) { binary = true; break; }
    return {
      path,
      size: st.size,
      mtime: st.mtim,
      binary,
      truncated: data.length > slice.length,
      text: binary ? null : dec.decode(slice),
    };
  },

  async writeFile({ path, text }) {
    await tjs.writeFile(path, enc.encode(text));
    const st = await tjs.stat(path);
    return { path, size: st.size };
  },

  async watchDir({ path }, app) {
    if (watcher) { watcher.close(); watcher = null; }
    if (!path) return { watching: null };
    watcher = tjs.watch(path, (file, event) => {
      app.push('fs:event', { dir: path, file, event, time: new Date().toLocaleTimeString() });
    });
    return { watching: path };
  },

  // ---- shell ----

  async run({ id, cmd }, app) {
    const proc = tjs.spawn(['/bin/sh', '-lc', cmd], {
      stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
    });
    procs.set(id, proc);
    const started = Date.now();
    try {
      const [, , status] = await Promise.all([
        pump(id, proc.stdout, 'stdout', app),
        pump(id, proc.stderr, 'stderr', app),
        proc.wait(),
      ]);
      app.push('run:exit', {
        id,
        code: status.exit_status,
        signal: status.term_signal,
        ms: Date.now() - started,
      });
    } finally {
      procs.delete(id);
    }
    return { pid: proc.pid };
  },

  async kill({ id }) {
    const proc = procs.get(id);
    if (proc) proc.kill();
    return { killed: !!proc };
  },

  // ---- video export (page renders + records, backend writes the file) ----
  // The mp4 arrives as base64 pieces (kept under ~1 MB per bridge message),
  // is assembled here, and written wherever the native save dialog pointed.

  async videoBegin() { vidParts = []; return true; },

  async videoAppend({ b64 }) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    vidParts.push(u8);
    return true;
  },

  async videoEnd({ path }) {
    const total = vidParts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of vidParts) { out.set(p, off); off += p.length; }
    vidParts = [];
    await tjs.writeFile(path, out);
    return { path, size: total };
  },

  // ---- store location (for display; tiny.store itself lives in the bridge) ----
  // Mirrors the bridge's makeStore()/appDataDir(): ~/Library/Application
  // Support/<id> (macOS), %APPDATA%\\<id> (Windows), $XDG_DATA_HOME/<id>
  // (Linux). The id comes from tinyjs.json (read here from the project cwd).

  async storeInfo() {
    let id = 'tinyjs-app';
    try {
      const cfg = JSON.parse(dec.decode(await tjs.readFile(tjs.cwd + '/tinyjs.json')));
      id = cfg.id || (cfg.name ? 'com.example.' + cfg.name : id);
    } catch { /* built app may not have tinyjs.json in cwd */ }
    const dir = IS_WIN
      ? (tjs.env.APPDATA || tjs.homeDir + '/AppData/Roaming') + '/' + id
      : IS_LINUX
        ? (tjs.env.XDG_DATA_HOME || tjs.homeDir + '/.local/share') + '/' + id
        : tjs.homeDir + '/Library/Application Support/' + id;
    return { id, dir };
  },

  // Same fib benchmark the page runs, but inside txiki.js — so the two
  // engines can be compared directly. The page hands over the module bytes
  // it already has; nothing is duplicated here.
  async fibBench({ bytes, n = 30, runs = 7 }) {
    const { instance } = await WebAssembly.instantiate(new Uint8Array(bytes));
    const jsFib = (k) => (k < 2 ? k : jsFib(k - 1) + jsFib(k - 2));
    const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
    const time = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };
    const js = [], wa = [];
    let result = 0;
    for (let i = 0; i < runs; i++) {
      js.push(time(() => jsFib(n)));
      wa.push(time(() => { result = instance.exports.fib(n); }));
    }
    return { js: med(js), wasm: med(wa), result, n, runtime: 'txiki.js' };
  },

  // Real Notification Center banners need a bundle: UNUserNotificationCenter
  // refuses without one, so `tinyjs dev` falls back to osascript — which
  // shows the Script Editor icon and drops any action buttons. Worth telling
  // the user BEFORE they press a button that can't work here.
  async isPackaged() {
    const exe = tjs.exePath || '';
    const packaged = exe.includes('.app/Contents/MacOS/') ||
                     (!exe.endsWith('/tjs') && !exe.endsWith('\\tjs.exe'));
    return { packaged, exe };
  },

  // A tray icon drawn this second: the page hands over a canvas as base64,
  // we drop it in temp, and tray.set points at the file. Same trick the app
  // icon card uses — the OS wants a path, the page has pixels.
  async trayIconPng({ b64 }) {
    const path = tjs.env.TMPDIR + 'tiny-deck-tray-' + Date.now() + '.png';
    await tjs.writeFile(path, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    return { path };
  },

  // Place a window under the tray icon. Positioning is a window op, and the
  // page can only move its OWN window — so the backend does it by id.
  async placeUnderTray({ id, x, y, w }, app) {
    app.window(id).setPosition(Math.round(x - w / 2), Math.round(y + 4));
    return true;
  },

  // ---- wasm in the BACKEND ----
  // The page hands over the same module bytes it runs itself; txiki.js has
  // WebAssembly too, so the runtime can do per-pixel work off the webview's
  // thread entirely. Returns a checksum so the page can confirm the backend
  // produced the same field, not just that it ran.
  async wasmNoise({ bytes, w = 256, h = 256, oct = 4 }) {
    const mod = new Uint8Array(bytes);
    const { instance } = await WebAssembly.instantiate(mod);
    const mem = new Uint8Array(instance.exports.mem.buffer);
    const t0 = performance.now();
    instance.exports.fill(0, w, h, oct);
    const ms = performance.now() - t0;
    let checksum = 0;
    for (let i = 0; i < w * h; i++) checksum = (checksum + mem[i] * (i % 7 + 1)) >>> 0;
    return { ms, w, h, oct, checksum };
  },

  // ---- ffi (tjs:ffi → system dylibs) ----

  async ffiInfo() {
    const f = ffiLibs();
    const gb = (n) => (n / 2 ** 30).toFixed(1) + ' GB';
    const rows = [];
    if (f.os === 'macos') {
      rows.push(
        ['cpu', 'sysctlbyname("machdep.cpu.brand_string")', sysctlValue('machdep.cpu.brand_string').value],
        ['model', 'sysctlbyname("hw.model")', sysctlValue('hw.model').value],
        ['ram', 'sysctlbyname("hw.memsize")', gb(Number(BigInt(sysctlValue('hw.memsize').value)))],
        ['cores', 'sysctlbyname("hw.ncpu")', sysctlValue('hw.ncpu').value],
        ['macos', 'sysctlbyname("kern.osproductversion")', sysctlValue('kern.osproductversion').value],
      );
    } else if (f.os === 'linux') {
      const si = linuxSysinfo();
      const host = new Uint8Array(256);
      f.gethostname.call(host, host.length);
      let end = host.indexOf(0);
      rows.push(
        ['host', 'gethostname()', dec.decode(host.subarray(0, end < 0 ? host.length : end))],
        ['uptime', 'sysinfo().uptime', (si.uptime / 3600).toFixed(1) + ' h'],
        ['ram', 'sysinfo().totalram × mem_unit', gb(si.totalram)],
        ['free', 'sysinfo().freeram × mem_unit', gb(si.freeram)],
        ['procs', 'sysinfo().procs', String(si.procs)],
      );
    } else {
      const m = winMemory();
      rows.push(
        ['uptime', 'GetTickCount64()', (Number(f.tickCount.call()) / 3600000).toFixed(1) + ' h'],
        ['ram', 'GlobalMemoryStatusEx().ullTotalPhys', gb(m.totalPhys)],
        ['free', 'GlobalMemoryStatusEx().ullAvailPhys', gb(m.availPhys)],
        ['in use', 'GlobalMemoryStatusEx().dwMemoryLoad', m.load + '%'],
      );
    }
    rows.push(['pid', f.os === 'windows' ? 'GetCurrentProcessId()' : 'getpid()',
      f.getpid.call() + (Number(f.getpid.call()) === tjs.pid ? ' — matches tjs.pid ✓' : '')]);
    if (f.getppid) rows.push(['parent', 'getppid()', String(f.getppid.call())]);
    rows.push(['library', 'dlopen', f.libc]);
    if (f.zlibVersion) rows.push(['zlib', 'zlibVersion()', f.zlibVersion.call() + ' — ' + f.libzName]);
    else rows.push(['zlib', '—', 'not shipped with Windows; the demo below is macOS/Linux only']);
    return rows.map(([label, call, value]) => ({ label, call, value }));
  },

  async ffiSysctl({ name }) {
    if (FFI_OS !== 'macos') {
      throw new Error('sysctlbyname() is a BSD/macOS API — Linux exposes the ' +
        'same values through /proc and sysconf(), Windows through its own ' +
        'APIs, and neither takes a free-form name like this');
    }
    return { name, ...sysctlValue(name) };
  },

  async zlibRoundtrip({ text, level }) {
    const f = ffiLibs();
    if (!f.compress2) {
      throw new Error('zlib is not shipped with Windows — macOS has ' +
        'libz.dylib and Linux libz.so.1, so this demo runs there');
    }
    const src = enc.encode(text);
    const dest = new Uint8Array(src.length + 1024);
    const dlen = new BigUint64Array([BigInt(dest.length)]);
    const now = globalThis.performance ? () => performance.now() : () => Date.now();
    const t0 = now();
    let rc = f.compress2.call(dest, new Uint8Array(dlen.buffer), src, src.length, level);
    const ms = now() - t0;
    if (rc !== 0) throw new Error('compress2 rc=' + rc);
    const packed = dest.subarray(0, Number(dlen[0]));
    const back = new Uint8Array(src.length + 16);
    const blen = new BigUint64Array([BigInt(back.length)]);
    rc = f.uncompress.call(back, new Uint8Array(blen.buffer), packed, packed.length);
    const roundtrip = rc === 0 && dec.decode(back.subarray(0, Number(blen[0]))) === text;
    return {
      inBytes: src.length,
      outBytes: packed.length,
      level,
      ms,
      roundtrip,
      hexHead: [...packed.subarray(0, 48)].map((b) => b.toString(16).padStart(2, '0')).join(' '),
    };
  },

  // ---- multiple windows (0.8.0) ----
  // Any handler can take a third arg, `meta`, whose `window` field is the id of
  // the window whose page made the call — so one backend can tell its windows
  // apart. app.windows() lists every live window id.
  // meta.window is who called: 'main', or the id of whichever satellite window
  // made the call. app.windows() is async — returning it unawaited serialised
  // the Promise as {} and took the inspector's button down with it.
  async whoami(_params, app, meta) {
    return { caller: meta?.window ?? 'main', open: await app.windows() };
  },

  // ---- notes (sqlite) ----

  async notesList() {
    return notesDb().prepare('SELECT * FROM notes ORDER BY id DESC').all();
  },

  async notesAdd({ text }) {
    notesDb().prepare('INSERT INTO notes (text, created_at) VALUES (?, ?)')
      .run(text, new Date().toISOString());
    return api.notesList();
  },

  // A query the key/value store can't answer without loading everything first
  // — the reason the deck ships both.
  async notesCount() {
    return notesDb().prepare('SELECT COUNT(*) AS n FROM notes').all()[0]?.n ?? 0;
  },

  async notesDelete({ id }) {
    notesDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
    return api.notesList();
  },

  // ---- desktop tab helpers (0.13–0.15) ----

  // A file for the shell/Quick Look/share cards to act on. app.paths is a
  // plain object in the backend (no await) — temp is per-app and ours.
  async makeDemoFile(_params, app) {
    const path = app.paths.temp + '/tiny-deck-demo.txt';
    await tjs.writeFile(path, enc.encode(
      'Hello from Tiny Deck 👋\n\n' +
      'This file was written into app.paths.temp so the Desktop tab has\n' +
      'something real to reveal, Quick Look, share, and trash.\n\n' +
      'made at ' + new Date().toISOString() + '\n'));
    return { path };
  },

  // The Latest tab's app-icon card: app.icon wants a png PATH, so the
  // page's canvas comes over as base64, lands in app.paths.temp, and becomes
  // the live Dock tile in the same call.
  async appIconPng({ b64 }, app) {
    const path = app.paths.temp + '/tiny-deck-dock.png';
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    await tjs.writeFile(path, u8);
    app.icon(path);
    return { path };
  },

  // captureScreen() leaves a png in the temp dir — thumbnail it for the page.
  async readShot({ path }, app) {
    if (typeof path !== 'string' || !path.endsWith('.png') ||
        !(path.startsWith(app.paths.temp) || path.startsWith('/var/folders/') || path.startsWith('/tmp/'))) {
      throw new Error('bad path');
    }
    const bytes = await tjs.readFile(path);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { uri: 'data:image/png;base64,' + btoa(bin), bytes: bytes.length };
  },

  // The OCR and thumbnail cards need a real FILE on disk to point at, and
  // both want one that's the same every run so the demo is repeatable. The
  // page draws it on a canvas; this puts it where the OS can see it.
  // Deliberately not a screenshot: captureScreen needs the Screen Recording
  // permission, and a demo that can't run until you've granted something is
  // a demo nobody sees.
  async scratchPng({ b64, name }, app) {
    const safe = String(name ?? 'scratch').replace(/[^a-z0-9-]/gi, '') || 'scratch';
    const path = `${app.paths.temp}/tiny-deck-${safe}.png`;
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    await tjs.writeFile(path, u8);
    const st = await tjs.stat(path);
    return { path, bytes: st.size };
  },

  // Tool calling: the model is handed real functions and decides which to
  // call. They're declared HERE, on the backend, because a tool's run() is a
  // real function and can't cross the bridge from a page.
  //
  // Every tool is reversible and visible — moving a window and badging an icon
  // are things you can watch happen and undo. Nothing here writes a file or
  // touches another app, because "let a language model call your functions"
  // deserves a demo you can run without reading the source first.
  async aiDrive({ prompt, spoken = false }, app) {
    const win = app.window('main');
    const before = await win.getState();
    const tools = [
      {
        name: 'moveWindow',
        description: 'Move this application window to an absolute position on screen.',
        parameters: { x: { type: 'integer', description: 'x in points from the left of the screen' },
                      y: { type: 'integer', description: 'y in points from the top of the screen' } },
        run: ({ x, y }) => { win.setPosition(x | 0, y | 0); return `window moved to ${x | 0}, ${y | 0}`; },
      },
      {
        name: 'resizeWindow',
        description: 'Resize this application window.',
        parameters: { width: { type: 'integer', description: 'width in points' },
                      height: { type: 'integer', description: 'height in points' } },
        run: ({ width, height }) => {
          // Clamp: a model that asks for a 20x20 window leaves the deck
          // unusable, and "the AI broke my app" is a bad demo.
          const w = Math.max(600, Math.min(2000, width | 0));
          const h = Math.max(400, Math.min(1400, height | 0));
          win.setSize(w, h);
          return `window resized to ${w} x ${h}`;
        },
      },
      {
        name: 'showBadge',
        description: 'Show a small number badge on the app icon in the Dock.',
        parameters: { count: { type: 'integer', description: 'the number to show' } },
        run: ({ count }) => { app.badge(String(count | 0)); return `badge set to ${count | 0}`; },
      },
      {
        name: 'clearBadge',
        description: 'Remove the number badge from the app icon.',
        parameters: {},
        run: () => { app.badge(''); return 'badge cleared'; },
      },
      {
        name: 'partyTime',
        description: 'Celebrate. Throws confetti across the whole screen for a few seconds. ' +
          'Use this when the user is pleased, is celebrating, says party, or asks for confetti.',
        parameters: {},
        run: () => { openParty(app); return 'confetti thrown across the screen'; },
      },
    ];
    const screens = await app.screens();
    const scr = screens.find((s) => s.primary) ?? screens[0];
    const r = await app.macos.ai.generate(prompt, {
      instructions: `You control a desktop app window on a ${scr.width}x${scr.height} screen. ` +
        'Use the tools to do exactly what is asked. Then say briefly what you did.' +
        // Spoken answers are read out by app.say(), and a bulleted list read
        // aloud is unlistenable.
        (spoken ? ' Reply in one short sentence, plain prose, no lists or markdown.' : ''),
      tools,
    });
    return { text: r.text, calls: r.calls, offered: tools.map((t) => t.name), before };
  },

  // The spoken loop's version: same tools, but the instructions ask for an
  // answer meant to be HEARD — no lists, no markdown, short. Same handler
  // otherwise, so a spoken "party time" does exactly what a typed one does.
  async aiTalkDrive({ prompt }, app) {
    return api.aiDrive({ prompt, spoken: true }, app);
  },

  // Put the window back where it was — the tools card moves it for real, and a
  // demo that leaves your window somewhere odd is one you run once.
  async aiRestore({ x, y, width, height }, app) {
    const win = app.window('main');
    win.setSize(width, height);
    win.setPosition(x, y);
    app.badge('');
    return { ok: true };
  },

  // What a thumbnail actually cost, and proof the file exists at all —
  // thumbnail() returning a path says nothing about what landed there.
  async fileFacts({ path }) {
    try {
      const st = await tjs.stat(path);
      return { exists: true, bytes: st.size, dir: (st.mode & 0o170000) === 0o040000 };
    } catch (e) {
      return { exists: false, error: e.message };
    }
  },

};

// Multiple windows (0.8.0): fires when any secondary window closes ('main'
// closing quits the app). We rebroadcast a friendly note so every remaining
// page can update its window list; app.push reaches all live windows.
export function onWindowClosed(id, app) {
  app.push('win-closed', { id, time: new Date().toLocaleTimeString() });
}

// Called once the window is up. Pushes live instrument readings every second.
export function init(app) {
  const startedAt = Date.now();
  let prev = cpuTimes();
  setInterval(() => {
    const now = cpuTimes();
    const dTotal = now.total - prev.total;
    const cpu = dTotal > 0 ? (now.busy - prev.busy) / dTotal : 0;
    prev = now;
    app.push('tick', {
      time: new Date().toLocaleTimeString(),
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      cpu: Math.max(0, Math.min(1, cpu)),
      load: tjs.system.loadAvg,
    });
  }, 1000);
}
