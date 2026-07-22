// shelf — an app store for the tinyjs examples fleet.
// Catalog comes from GitHub (raw catalog.json) with a bundled fallback;
// install = download dmg → hdiutil attach → ditto to /Applications → detach.

// TINYJS_SHELF_CATALOG overrides the catalog source (local testing). Download
// URLs from an overridden catalog's own origin are trusted too, so a test
// catalog can serve its zips from the same local server it lives on.
const CATALOG_OVERRIDE = tjs.env.TINYJS_SHELF_CATALOG || null;
const CATALOG_URL = CATALOG_OVERRIDE
  || 'https://raw.githubusercontent.com/tarwin/tinyjsapp-examples/main/catalog.json';
const trustedURL = (url) =>
  /^https:\/\/(github\.com|raw\.githubusercontent\.com)\/tarwin\//.test(url)
  || (CATALOG_OVERRIDE && String(url).startsWith(new URL(CATALOG_OVERRIDE).origin + '/'));
const APPS = '/Applications';
const SELF_ID = 'art.tarwin.shelf';

const TMP = (tjs.env.TMPDIR || '/tmp').replace(/\/$/, '');

const IS_WIN = tjs.env.OS === 'Windows_NT';
// Windows install root — our own private tree under %LOCALAPPDATA%. Only
// folders we put here are ever created/removed. Made on demand.
const WIN_ROOT = IS_WIN
  ? `${(tjs.env.LOCALAPPDATA || tjs.env.APPDATA || '.').replace(/[\\/]+$/, '')}\\tinyjs-apps`
  : null;
const WIN_TMP = IS_WIN
  ? String(tjs.tmpDir || tjs.env.TEMP || tjs.env.TMP || '.').replace(/[\\/]+$/, '')
  : null;
// per-install marker so a scan can report a version an exe can't be asked for
const MARKER = '.tinyjs-shelf.json';

async function run(args) {
  const p = tjs.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
  let out = '';
  const dec = new TextDecoder();
  const reader = p.stdout.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  const st = await p.wait();
  return { code: st.exit_status, out: out.trim() };
}

async function exists(path) {
  try { await tjs.stat(path); return true; } catch { return false; }
}

// every /Applications mutation is scoped to our own fleet: ids must be
// art.tarwin.*, names/dirs must be plain (no separators, no expansions)
function vet({ dir, app: appName, id }) {
  if (dir !== undefined && !/^[a-z0-9-]+$/.test(dir)) throw new Error('bad dir');
  if (appName !== undefined && !/^[A-Za-z0-9 ._-]+\.app$/.test(appName)) throw new Error('bad app name');
  if (id !== undefined && !/^art\.tarwin\.[a-z0-9-]+$/.test(id)) throw new Error('bad bundle id');
}

// installed .app must be ours (bundle id matches) before we ever touch it
async function bundleId(appPath) {
  const r = await run(['plutil', '-extract', 'CFBundleIdentifier', 'raw', '-o', '-',
    `${appPath}/Contents/Info.plist`]);
  return r.code === 0 ? r.out : null;
}

async function installedInfo(entry, runSet) {
  if (IS_WIN) return installedInfoWin(entry, runSet);
  const appPath = `${APPS}/${entry.app}`;
  if (!(await exists(appPath))) return { installed: false };
  const id = await bundleId(appPath);
  if (id !== entry.id) return { installed: false, foreign: true };
  const v = await run(['plutil', '-extract', 'CFBundleVersion', 'raw', '-o', '-',
    `${appPath}/Contents/Info.plist`]);
  const running = (await run(['pgrep', '-f', `${appPath}/Contents/MacOS`])).code === 0;
  return { installed: true, version: v.code === 0 ? v.out : '?', running };
}

// ── Windows: twin of the macOS install/scan/uninstall paths ─────────────────
// A "win block" on a catalog entry (win.folder / win.exe / win.version /
// win.url / win.sha256) is what makes it installable here; an entry without one
// is simply never installed. Everything lives under WIN_ROOT\<folder>\.

// Windows fleet scoping: folder/exe come from our own catalog's win block —
// forbid anything that could escape the install root or reach a shell.
function vetWin({ dir, folder, exe } = {}) {
  if (dir !== undefined && !/^[a-z0-9-]+$/.test(dir)) throw new Error('bad dir');
  if (folder !== undefined && (!/^[A-Za-z0-9._-]+$/.test(folder) || folder.includes('..')))
    throw new Error('bad folder');
  if (exe !== undefined && !/^[A-Za-z0-9 ._-]+\.exe$/i.test(exe)) throw new Error('bad exe');
}

// the marker we drop at install time: { version, folder, exe, shelf:true }
async function winMarker(folder) {
  try {
    const data = await tjs.readFile(`${WIN_ROOT}\\${folder}\\${MARKER}`);
    return JSON.parse(new TextDecoder().decode(data));
  } catch { return null; }
}

// one tasklist per scan tick — the running-process image names, lowercased
async function winRunningSet() {
  try {
    const r = await run(['tasklist', '/fo', 'csv', '/nh']);
    if (r.code !== 0) return new Set();
    const set = new Set();
    for (const line of r.out.split(/\r?\n/)) {
      const m = /^"([^"]+)"/.exec(line);
      if (m) set.add(m[1].toLowerCase());
    }
    return set;
  } catch { return new Set(); }
}

// installed ⇔ WIN_ROOT\<folder>\<exe> exists; version from the marker ('?' if
// the folder predates markers). `running` is the batched set from the tick.
async function installedInfoWin(entry, running) {
  const { folder, exe } = entry;
  if (!folder || !exe) return { installed: false };
  if (!(await exists(`${WIN_ROOT}\\${folder}\\${exe}`))) return { installed: false };
  const mk = await winMarker(folder);
  return {
    installed: true,
    version: mk && mk.version ? String(mk.version) : '?',
    running: running ? running.has(exe.toLowerCase()) : false,
  };
}

// download win.url → verify win.sha256 → bsdtar-extract into WIN_ROOT → marker.
// Reuses the mac install's 'progress'/'done' pushes so the page is unchanged.
async function installWin({ dir, folder, exe, url, sha256, version }, app) {
  vetWin({ dir, folder, exe });
  if (!folder || !exe || !url) throw new Error('this app has no Windows build');
  if (!trustedURL(url)) throw new Error('refusing non-repo URL');
  await tjs.makeDir(WIN_ROOT, { recursive: true }).catch(() => {});
  const zip = `${WIN_TMP}\\shelf-${dir}.zip`;
  const dst = `${WIN_ROOT}\\${folder}`;
  const push = (phase, pct) => app.push('progress', { dir, phase, pct });

  push('download', 0);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0, lastPct = -1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== lastPct) { lastPct = pct; push('download', pct / 100); }
  }
  const data = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { data.set(c, off); off += c.length; }
  await tjs.writeFile(zip, data);

  try {
    // verify before we touch the install root — refuse on mismatch/missing
    if (!sha256) throw new Error('no sha256 in catalog — refusing to install');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    if (digest.toLowerCase() !== String(sha256).toLowerCase())
      throw new Error('checksum mismatch — refusing to install');

    push('install', 0);
    // replacing an existing install: it lives under our private root and its
    // folder name matches this catalog entry (membership = ours), so it's safe
    // to remove. Kill a running copy first so its files unlock.
    if (await exists(dst)) {
      await run(['taskkill', '/IM', exe, '/F']).catch(() => {});
      await tjs.remove(dst, { recursive: true }).catch(() => {});
    }
    push('install', 0.5);
    // bsdtar ships with Windows 10+ and reads zips; -C extracts into the root,
    // yielding WIN_ROOT\<folder>\ with <exe> inside.
    const ex = await run(['tar', '-xf', zip, '-C', WIN_ROOT]);
    if (ex.code !== 0) throw new Error('extract failed');
    if (!(await exists(`${dst}\\${exe}`)))
      throw new Error(`zip did not contain ${folder}\\${exe}`);
    await tjs.writeFile(`${dst}\\${MARKER}`, new TextEncoder().encode(
      JSON.stringify({ version: String(version || '?'), folder, exe, shelf: true })));
  } finally {
    try { await tjs.remove(zip); } catch {}
  }
  push('done', 1);
  const st = await installedInfoWin({ folder, exe });
  rescanPush();
  return st;
}

// kill (best-effort) → remove WIN_ROOT\<folder>. Guard: only ever a vetted
// folder directly under our root, and it must look like ours (our marker, or at
// least the expected exe present).
async function uninstallWin({ dir, folder, exe, id }) {
  vetWin({ dir, folder, exe });
  if (id === SELF_ID) throw new Error('not uninstalling myself');
  const dst = `${WIN_ROOT}\\${folder}`;
  if (!(await exists(dst))) return { installed: false };
  const mk = await winMarker(folder);
  if (!(mk && mk.shelf) && !(exe && await exists(`${dst}\\${exe}`)))
    throw new Error(`${folder} doesn't look like ours — not touching it`);
  if (exe) await run(['taskkill', '/IM', exe, '/F']).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  await tjs.remove(dst, { recursive: true }).catch(() => {});
  rescanPush();
  return { installed: false };
}

function vcmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// --- live installed-state: kernel events on /Applications + periodic catalog re-check ---
let appRef = null;       // the app handle, once init runs
let watchList = [];      // [{dir, app, id, title, version}] — what to scan for
let watcher = null;
let scanTimer = null;
let lastScan = '';       // JSON of the last pushed scan, to skip no-op pushes
const notified = new Set();  // dir+version already announced this run

async function scanAll() {
  const out = {};
  const running = IS_WIN ? await winRunningSet() : null;  // one tasklist per tick
  for (const a of watchList) out[a.dir] = await installedInfo(a, running);
  return out;
}

async function rescanPush() {
  if (!appRef || !watchList.length) return;
  const map = await scanAll();
  const j = JSON.stringify(map);
  if (j === lastScan) return;
  lastScan = j;
  appRef.push('installed', map);
}

function armWatch() {
  if (watcher) return;
  try {
    // dir-level watch: fires when anything in the install root appears/vanishes
    // (/Applications on macOS, WIN_ROOT on Windows)
    watcher = tjs.watch(IS_WIN ? WIN_ROOT : APPS, () => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(rescanPush, 600);
    });
  } catch {}
}

// the catalog version that applies where we're running (win.version on Windows)
const catVer = (a) => (IS_WIN ? (a.win && a.win.version) : a.version);
// project a raw catalog entry to the identity+version the scanner needs per-OS
const entryFor = (a) => (IS_WIN
  ? { dir: a.dir, id: a.id, title: a.title, folder: a.win && a.win.folder, exe: a.win && a.win.exe, version: catVer(a) }
  : { dir: a.dir, app: a.app, id: a.id, title: a.title, version: a.version });

async function checkUpdates() {
  const cat = await api.fetchCatalog();
  if (!cat || !Array.isArray(cat.apps) || !cat.apps.length || !appRef) return false;
  watchList = cat.apps.map(entryFor);
  appRef.push('catalog', cat);
  const map = await scanAll();
  lastScan = JSON.stringify(map);
  appRef.push('installed', map);
  const ups = cat.apps.filter((a) => {
    const st = map[a.dir];
    const v = catVer(a);
    return st && st.installed && v && vcmp(v, st.version) > 0 && !notified.has(a.dir + v);
  });
  if (ups.length) {
    for (const a of ups) notified.add(a.dir + catVer(a));
    appRef.notify({
      title: 'Shelf',
      body: ups.length === 1
        ? `${ups[0].title} ${catVer(ups[0])} is available — open Shelf to update`
        : `${ups.length} updates available: ${ups.map((a) => a.title).join(', ')}`,
    });
  }
  return true;
}

export const api = {
  fetchCatalog: async () => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(CATALOG_URL, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  selfId: async () => SELF_ID,

  // which platform the store is running on — the page filters the catalog to
  // apps whose "platforms" list (default ["macos"]) includes this
  platform: async () => (tjs.env.OS === 'Windows_NT' ? 'windows' : 'macos'),

  // the header's ⟳ — same routine as the 15-minute timer, on demand.
  // False means GitHub was unreachable (the page keeps what it has).
  refresh: async () => checkUpdates(),

  // frontend hands over its catalog app-list; backend scans, arms the
  // /Applications watcher, and owns pushes from here on
  watchApps: async ({ apps }) => {
    watchList = apps;
    if (IS_WIN) await tjs.makeDir(WIN_ROOT, { recursive: true }).catch(() => {});
    armWatch();
    const map = await scanAll();
    lastScan = JSON.stringify(map);
    return map;
  },

  install: async (payload, app) => {
    if (IS_WIN) return installWin(payload, app);
    const { dir, url, app: appName, id } = payload;
    vet({ dir, app: appName, id });
    if (!trustedURL(url)) throw new Error('refusing non-repo URL');
    const dmg = `${TMP}/shelf-${dir}.dmg`;
    const mnt = `${TMP}/shelf-mnt-${dir}`;
    const push = (phase, pct) => app.push('progress', { dir, phase, pct });

    push('download', 0);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
    const total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0, lastPct = -1;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== lastPct) { lastPct = pct; push('download', pct / 100); }
    }
    const data = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { data.set(c, off); off += c.length; }
    await tjs.writeFile(dmg, data);

    push('install', 0);
    try {
      await run(['hdiutil', 'detach', mnt, '-force']); // stale mount from a failed run
      const at = await run(['hdiutil', 'attach', dmg, '-nobrowse', '-readonly', '-noautoopen',
        '-mountpoint', mnt]);
      if (at.code !== 0) throw new Error('could not mount dmg');
      try {
        let src = null;
        for await (const e of await tjs.readDir(mnt))
          if (e.name.endsWith('.app')) { src = `${mnt}/${e.name}`; break; }
        if (!src) throw new Error('no .app in dmg');
        const dst = `${APPS}/${appName}`;
        if (await exists(dst)) {
          if ((await bundleId(dst)) !== id) throw new Error(`${appName} exists and isn't ours`);
          await run(['rm', '-rf', dst]);
        }
        push('install', 0.5);
        const cp = await run(['ditto', src, dst]);
        if (cp.code !== 0) throw new Error('copy to /Applications failed');
      } finally {
        await run(['hdiutil', 'detach', mnt]);
      }
    } finally {
      try { await tjs.remove(dmg); } catch {}
    }
    push('done', 1);
    const st = await installedInfo({ app: appName, id });
    rescanPush();
    return st;
  },

  // self-update finale: hand off to the freshly installed copy and bow out.
  // The .app name comes from OUR catalog entry (never the page), and reaches
  // sh as a positional parameter — no data is ever parsed as shell.
  relaunch: async (_p, app) => {
    const self = watchList.find((a) => a.id === SELF_ID);
    if (!self || !/^[A-Za-z0-9 ._-]+\.app$/.test(self.app)) throw new Error('no self catalog entry');
    tjs.spawn(['sh', '-c', 'sleep 1; exec open "$1"', 'sh', `${APPS}/${self.app}`],
      { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    setTimeout(() => app.quit(), 300);
  },

  uninstall: async (payload) => {
    if (IS_WIN) return uninstallWin(payload);
    const { app: appName, id, removeSettings } = payload;
    vet({ app: appName, id });
    if (id === SELF_ID) throw new Error('not uninstalling myself');
    const dst = `${APPS}/${appName}`;
    if (!(await exists(dst))) return { installed: false };
    if ((await bundleId(dst)) !== id) throw new Error(`${appName} isn't ours — not touching it`);
    await run(['osascript', '-e', `tell application id "${id}" to quit`]);
    // give it a moment to exit, then make sure
    await new Promise((r) => setTimeout(r, 800));
    await run(['pkill', '-f', `${dst}/Contents/MacOS`]);
    await run(['rm', '-rf', dst]);
    if (removeSettings) {
      const support = `${tjs.env.HOME}/Library/Application Support/${id}`;
      if (await exists(support)) await run(['rm', '-rf', support]);
    }
    rescanPush();
    return { installed: false };
  },

  openApp: async ({ app: appName, folder, exe }) => {
    if (IS_WIN) {
      vetWin({ folder, exe });
      // detached-ish: ignore its stdio so it outlives the store cleanly
      tjs.spawn([`${WIN_ROOT}\\${folder}\\${exe}`], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
      return;
    }
    vet({ app: appName }); await run(['open', '-a', `${APPS}/${appName}`]);
  },
  reveal: async ({ app: appName, folder }) => {
    if (IS_WIN) { vetWin({ folder }); await run(['explorer', `${WIN_ROOT}\\${folder}`]); return; }
    vet({ app: appName }); await run(['open', '-R', `${APPS}/${appName}`]);
  },
  openURL: async ({ url }) => {
    if (!/^https:\/\/(github\.com|tinyjs\.app)\//.test(url)) throw new Error('nope');
    await run(IS_WIN ? ['explorer', url] : ['open', url]);
  },

};

export function init(app) {
  appRef = app;
  // one live catalog refresh shortly after launch (frontend boots on the
  // bundled copy), then every 15 min while we're running — new releases and
  // new apps appear without relaunching
  setTimeout(checkUpdates, 4000);
  setInterval(checkUpdates, 15 * 60 * 1000);
}
