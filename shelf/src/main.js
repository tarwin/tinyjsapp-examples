// shelf — an app store for the tinyjs examples fleet.
// Catalog comes from GitHub (raw catalog.json) with a bundled fallback;
// install = download dmg → hdiutil attach → ditto to /Applications → detach.

const CATALOG_URL = 'https://raw.githubusercontent.com/tarwin/tinyjsapp-examples/main/catalog.json';
const APPS = '/Applications';
const SELF_ID = 'art.tarwin.shelf';

const TMP = (tjs.env.TMPDIR || '/tmp').replace(/\/$/, '');

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

async function installedInfo(entry) {
  const appPath = `${APPS}/${entry.app}`;
  if (!(await exists(appPath))) return { installed: false };
  const id = await bundleId(appPath);
  if (id !== entry.id) return { installed: false, foreign: true };
  const v = await run(['plutil', '-extract', 'CFBundleVersion', 'raw', '-o', '-',
    `${appPath}/Contents/Info.plist`]);
  const running = (await run(['pgrep', '-f', `${appPath}/Contents/MacOS`])).code === 0;
  return { installed: true, version: v.code === 0 ? v.out : '?', running };
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
  for (const a of watchList) out[a.dir] = await installedInfo(a);
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
    // dir-level kqueue: fires when anything in /Applications appears/disappears
    watcher = tjs.watch(APPS, () => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(rescanPush, 600);
    });
  } catch {}
}

async function checkUpdates() {
  const cat = await api.fetchCatalog();
  if (!cat || !Array.isArray(cat.apps) || !cat.apps.length || !appRef) return false;
  watchList = cat.apps.map(({ dir, app, id, title, version }) => ({ dir, app, id, title, version }));
  appRef.push('catalog', cat);
  const map = await scanAll();
  lastScan = JSON.stringify(map);
  appRef.push('installed', map);
  const ups = cat.apps.filter((a) => {
    const st = map[a.dir];
    return st && st.installed && vcmp(a.version, st.version) > 0 && !notified.has(a.dir + a.version);
  });
  if (ups.length) {
    for (const a of ups) notified.add(a.dir + a.version);
    appRef.notify({
      title: 'Shelf',
      body: ups.length === 1
        ? `${ups[0].title} ${ups[0].version} is available — open Shelf to update`
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

  // the header's ⟳ — same routine as the 15-minute timer, on demand.
  // False means GitHub was unreachable (the page keeps what it has).
  refresh: async () => checkUpdates(),

  // frontend hands over its catalog app-list; backend scans, arms the
  // /Applications watcher, and owns pushes from here on
  watchApps: async ({ apps }) => {
    watchList = apps;
    armWatch();
    const map = await scanAll();
    lastScan = JSON.stringify(map);
    return map;
  },

  install: async ({ dir, url, app: appName, id }, app) => {
    vet({ dir, app: appName, id });
    if (!/^https:\/\/(github\.com|raw\.githubusercontent\.com)\/tarwin\//.test(url))
      throw new Error('refusing non-repo URL');
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

  uninstall: async ({ app: appName, id, removeSettings }) => {
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

  openApp: async ({ app: appName }) => { vet({ app: appName }); await run(['open', '-a', `${APPS}/${appName}`]); },
  reveal: async ({ app: appName }) => { vet({ app: appName }); await run(['open', '-R', `${APPS}/${appName}`]); },
  openURL: async ({ url }) => {
    if (!/^https:\/\/(github\.com|tinyjs\.app)\//.test(url)) throw new Error('nope');
    await run(['open', url]);
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
