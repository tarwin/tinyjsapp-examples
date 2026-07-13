// Tiny Deck — backend. Runs on txiki.js with full system access.
//
// Every function in `api` is callable from the page:
//   const result = await api.call('name', { ...params });
// Each handler receives (params, app) — `app` has push/setTitle/setSize/quit.

import { Database } from 'tjs:sqlite';
import { Lib, CFunction, types, errno, strerror } from 'tjs:ffi';

const dec = new TextDecoder();
const enc = new TextEncoder();

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
// dlopen system dylibs and call C symbols directly through libffi.

let ffi = null;
function ffiLibs() {
  if (!ffi) {
    const libc = new Lib('/usr/lib/libSystem.B.dylib');
    const libz = new Lib('/usr/lib/libz.dylib');
    ffi = {
      sysctl: new CFunction(libc.symbol('sysctlbyname'), types.sint,
        [types.string, types.buffer, types.buffer, types.pointer, types.size]),
      getpid: new CFunction(libc.symbol('getpid'), types.sint, []),
      getppid: new CFunction(libc.symbol('getppid'), types.sint, []),
      zlibVersion: new CFunction(libz.symbol('zlibVersion'), types.string, []),
      compress2: new CFunction(libz.symbol('compress2'), types.sint,
        [types.buffer, types.buffer, types.buffer, types.ulong, types.sint]),
      uncompress: new CFunction(libz.symbol('uncompress'), types.sint,
        [types.buffer, types.buffer, types.buffer, types.ulong]),
    };
  }
  return ffi;
}

function sysctlRaw(name) {
  const buf = new Uint8Array(1024);
  const len = new BigUint64Array([1024n]);
  const rc = ffiLibs().sysctl.call(name, buf, new Uint8Array(len.buffer), null, 0);
  if (rc !== 0) throw new Error(name + ': ' + strerror(errno()));
  return buf.subarray(0, Number(len[0]));
}

function sysctlValue(name) {
  const raw = sysctlRaw(name);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.length === 4) return { kind: 'int32', value: String(dv.getInt32(0, true)) };
  if (raw.length === 8) return { kind: 'int64', value: String(dv.getBigInt64(0, true)) };
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0) end--;
  const text = raw.subarray(0, end);
  const printable = end > 0 && text.every((b) => b === 9 || b === 10 || (b >= 32 && b < 127));
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

  // ---- http ----

  async httpFetch({ url, method = 'GET' }) {
    const started = Date.now();
    const res = await fetch(url, { method });
    const headers = {};
    for (const [k, v] of res.headers.entries()) headers[k] = v;
    let body = await res.text();
    const truncated = body.length > 256 * 1024;
    if (truncated) body = body.slice(0, 256 * 1024);
    return { status: res.status, statusText: res.statusText, headers, body, truncated, ms: Date.now() - started };
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
  // Mirrors the bridge's makeStore(): ~/Library/Application Support/<app id>/,
  // where the id comes from tinyjs.json (read here from the project cwd).

  async storeInfo() {
    let id = 'tinyjs-app';
    try {
      const cfg = JSON.parse(dec.decode(await tjs.readFile(tjs.cwd + '/tinyjs.json')));
      id = cfg.id || (cfg.name ? 'com.example.' + cfg.name : id);
    } catch { /* built app may not have tinyjs.json in cwd */ }
    return { id, dir: tjs.homeDir + '/Library/Application Support/' + id };
  },

  // ---- ffi (tjs:ffi → system dylibs) ----

  async ffiInfo() {
    const f = ffiLibs();
    const rows = [
      ['cpu', 'sysctlbyname("machdep.cpu.brand_string")', sysctlValue('machdep.cpu.brand_string').value],
      ['model', 'sysctlbyname("hw.model")', sysctlValue('hw.model').value],
      ['ram', 'sysctlbyname("hw.memsize")', (Number(BigInt(sysctlValue('hw.memsize').value)) / 2 ** 30) + ' GB'],
      ['cores', 'sysctlbyname("hw.ncpu")', sysctlValue('hw.ncpu').value],
      ['macos', 'sysctlbyname("kern.osproductversion")', sysctlValue('kern.osproductversion').value],
      ['pid', 'getpid()', f.getpid.call() + (f.getpid.call() === tjs.pid ? ' — matches tjs.pid ✓' : '')],
      ['parent', 'getppid()', String(f.getppid.call())],
      ['zlib', 'zlibVersion()', f.zlibVersion.call()],
    ];
    return rows.map(([label, call, value]) => ({ label, call, value }));
  },

  async ffiSysctl({ name }) {
    return { name, ...sysctlValue(name) };
  },

  async zlibRoundtrip({ text, level }) {
    const f = ffiLibs();
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

  // ---- notes (sqlite) ----

  async notesList() {
    return notesDb().prepare('SELECT * FROM notes ORDER BY id DESC').all();
  },

  async notesAdd({ text }) {
    notesDb().prepare('INSERT INTO notes (text, created_at) VALUES (?, ?)')
      .run(text, new Date().toISOString());
    return api.notesList();
  },

  async notesDelete({ id }) {
    notesDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
    return api.notesList();
  },
};

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
