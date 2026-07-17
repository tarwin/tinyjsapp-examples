// Beam — a Raycast-lite launcher. Press ⌥Space anywhere and a frameless
// translucent palette drops in: fuzzy-launch any app, find files with
// Spotlight's index, or just type math.
//
// One app, five tinyjs techniques:
//
//   1. Global hotkey        — app.hotkey.register('palette', 'alt+space')
//                             summons the palette over any app.
//   2. Frameless vibrancy   — tinyjs.json "chrome" makes the window a
//                             floating translucent panel; it hides (never
//                             quits) on Esc or focus loss, like a real menu.
//   3. tjs.readDir          — the app index is a plain directory scan of
//                             /Applications & friends; no Spotlight needed.
//   4. tjs.spawn pipelines  — real app icons (plutil reads Info.plist,
//                             sips converts the .icns, cached to disk),
//                             file search via mdfind, launching via open.
//   5. tiny.store           — per-app launch counts persist, so the things
//                             you actually use float to the top.
//
// The page never touches the system: it fuzzy-scores and parses math
// locally, and everything else goes through the api.

const HOTKEY = 'alt+space';
const HOTKEY_LABEL = '⌥Space';
const INDEX_TTL = 60_000;          // rescan /Applications at most once a minute
const ICON_PX = '64';              // cached icon size (retina 32pt)
const FILE_LIMIT = 12;             // mdfind rows the page gets

const SUPPORT_DIR = tjs.env.HOME + '/Library/Application Support/art.tarwin.beam';
const ICON_DIR = SUPPORT_DIR + '/icons';

const dec = new TextDecoder();

let open = false;                  // is the palette showing?
let lastBlurHide = 0;              // ms timestamp of the last click-out dismiss
let uses = {};                     // app path -> launch count (tiny.store)

// --------------------------------------------------------------- spawn helpers

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

// ------------------------------------------------------------------ app index

const APP_ROOTS = [
  '/Applications',
  '/System/Applications',
  tjs.env.HOME + '/Applications',
];

let apps = [];                     // [{ name, path }]
let scannedAt = 0;
let scanning = null;

async function scanDir(dir, depth, out) {
  let iter;
  try { iter = await tjs.readDir(dir); } catch { return; }
  for await (const e of iter) {
    if (e.name.startsWith('.')) continue;
    if (e.name.endsWith('.app')) {
      out.push({ name: e.name.slice(0, -4), path: dir + '/' + e.name });
    } else if (depth > 0 && e.isDirectory) {
      // one level deep catches /Applications/Utilities, vendor folders…
      await scanDir(dir + '/' + e.name, depth - 1, out);
    }
  }
}

function scanApps(force = false) {
  if (!force && Date.now() - scannedAt < INDEX_TTL) return Promise.resolve(apps);
  scanning ??= (async () => {
    const out = [{ name: 'Finder', path: '/System/Library/CoreServices/Finder.app' }];
    for (const root of APP_ROOTS) await scanDir(root, 1, out);
    const seen = new Set();
    apps = out.filter((a) => !seen.has(a.path) && seen.add(a.path))
      .sort((a, b) => a.name.localeCompare(b.name));
    scannedAt = Date.now();
    scanning = null;
    return apps;
  })();
  return scanning;
}

// ------------------------------------------------------------------ app icons
// Real icons, lazily: plutil reads the bundle's Info.plist to find the .icns,
// sips converts it to a small png cached on disk, and the page gets data URIs
// (the WebKit page can't load file:// — everything it shows crosses the bridge).

const iconMem = new Map();         // app path -> data URI | null

const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

function cacheName(path) {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '.png';
}

async function findIcns(appPath) {
  const res = appPath + '/Contents/Resources';
  try {
    const json = await readOut(['plutil', '-convert', 'json', '-o', '-', appPath + '/Contents/Info.plist']);
    let f = JSON.parse(json).CFBundleIconFile;
    if (f) return res + '/' + (f.endsWith('.icns') ? f : f + '.icns');
  } catch { /* no plist / not json-able — fall through */ }
  try {
    const iter = await tjs.readDir(res);
    for await (const e of iter) if (e.name.endsWith('.icns')) return res + '/' + e.name;
  } catch { /* no Resources dir */ }
  return null;
}

async function appIcon(appPath) {
  if (iconMem.has(appPath)) return iconMem.get(appPath);
  const cached = ICON_DIR + '/' + cacheName(appPath);
  let uri = null;
  try {
    uri = 'data:image/png;base64,' + b64(await tjs.readFile(cached));
  } catch {
    const icns = await findIcns(appPath);
    if (icns) {
      await run(['sips', '-s', 'format', 'png', '-Z', ICON_PX, icns, '--out', cached]);
      try { uri = 'data:image/png;base64,' + b64(await tjs.readFile(cached)); } catch { /* sips balked */ }
    }
  }
  iconMem.set(appPath, uri);
  return uri;
}

// ----------------------------------------------------------------- file search

const FILE_SKIP = /\.app$|\.app\/|\/Library\/|\/node_modules\//;

async function findFiles(query) {
  // Spotlight does the walking; the query travels as $0, never spliced in.
  const out = await readOut(['/bin/sh', '-c', 'mdfind -name "$0" 2>/dev/null | head -n 60', query]);
  const rows = [];
  for (const path of out.split('\n')) {
    if (!path || FILE_SKIP.test(path)) continue;
    let dir = false;
    try { dir = !!(await tjs.stat(path)).isDirectory; } catch { continue; }
    rows.push({ name: path.slice(path.lastIndexOf('/') + 1), path, dir });
    if (rows.length >= FILE_LIMIT) break;
  }
  return rows;
}

// -------------------------------------------------------------------- palette

function openPalette(app) {
  app.center();
  app.show();
  open = true;
  app.push('opened', {});          // page resets, refetches the index, focuses
}

function closePalette(app) {
  app.hide();
  open = false;
}

function togglePalette(app) {
  if (open) { closePalette(app); return; }
  // If the palette just dismissed itself because this very click stole its
  // focus, swallow the click instead of immediately reopening.
  if (Date.now() - lastBlurHide < 300) { lastBlurHide = 0; return; }
  openPalette(app);
}

// ------------------------------------------------------------------------ tray

function paintTray(app) {
  app.tray.set({
    icon: 'sf:bolt.fill',
    tooltip: `Beam — launcher (${HOTKEY_LABEL})`,
    primaryAction: true,           // left-click toggles; menu on right-click
    menu: [
      { id: 'title', label: 'Beam — Launcher', enabled: false },
      { separator: true },
      { id: 'open', label: `Open Beam  ${HOTKEY_LABEL}` },
      { id: 'rescan', label: 'Rebuild App Index' },
      { separator: true },
      { id: 'quit', label: 'Quit Beam', key: 'q' },
    ],
  });
}

// ------------------------------------------------------------------------- api

export const api = {
  // The whole index in one call; the page fuzzy-scores locally on every
  // keystroke (zero bridge chatter while typing).
  apps: async () => {
    await scanApps();
    return { apps: apps.map((a) => ({ ...a, uses: uses[a.path] || 0 })), hotkey: HOTKEY_LABEL };
  },

  icons: async ({ paths }) => {
    const out = {};
    for (const p of (paths || []).slice(0, 24)) out[p] = await appIcon(p);
    return out;
  },

  files: async ({ query }) => {
    const q = String(query || '').trim();
    return q.length >= 3 ? findFiles(q) : [];
  },

  launch: async ({ path }, app) => {
    uses[path] = (uses[path] || 0) + 1;
    app.store.set('uses', uses);
    closePalette(app);
    await run(['open', path]);
    return true;
  },

  openFile: async ({ path }, app) => {
    closePalette(app);
    await run(['open', path]);
    return true;
  },

  reveal: async ({ path }, app) => {
    closePalette(app);
    await run(['open', '-R', path]);
    return true;
  },

  // Calculator ⏎ — the result goes on the clipboard (native NSPasteboard;
  // 0.11.0 replaced the pbcopy-through-a-scratch-file workaround).
  copy: ({ text }, app) => {
    app.clipboard.write({ text: String(text) });
    closePalette(app);
    return true;
  },

  // The page lost focus (a click landed outside it) — dismiss like a menu.
  blurHide: (_p, app) => {
    if (open) { closePalette(app); lastBlurHide = Date.now(); }
    return true;
  },

  hide: (_p, app) => (closePalette(app), true),
};

// ---------------------------------------------------------------- entrypoints

export function onHotkey(id, app) {
  if (id === 'palette') togglePalette(app);
}

export function onTray(id, app) {
  if (id === null) return togglePalette(app);   // bare left-click
  if (id === 'open') return openPalette(app);
  if (id === 'rescan') { scannedAt = 0; return scanApps(true); }
  if (id === 'quit') return app.quit();
}

export function init(app) {
  // "activation": "accessory" — no Dock icon, window starts hidden. The tray
  // and the hotkey are the app; the palette appears on demand.
  app.setHideOnClose(true);
  app.setResizable(false);

  app.hotkey.register('palette', HOTKEY);
  paintTray(app);

  run(['mkdir', '-p', ICON_DIR]);
  app.store.get('uses').then((v) => { if (v && typeof v === 'object') uses = v; });
  scanApps();                      // warm the index before the first summon
}
