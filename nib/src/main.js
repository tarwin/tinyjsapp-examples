// Nib — a tiny Markdown editor. The main window is a small Welcome screen
// (recent files and folders, a dropzone); documents live in native windows of
// their own (tinyjs multi-window) running doc.html. A window holds a STACK of
// documents: files opened from inside one — its file tree, Open Quickly, a
// link — become tabs there, while Finder, the Dock and the Welcome screen get
// a window each. `sheets` and `wins` below are that whole model.
//
// The Welcome screen steps aside the moment a document window exists and comes
// back when the last one closes, so the app is never two windows deep in
// furniture. Everything it offers is in the File menu too — Open Recent lists
// the same folders and files — which is why that menu is REBUILT rather than
// patched, and why menuState below remembers every tick setMenu would drop.
//
// The interesting dance is CLOSING. macOS gives us no veto on the red ✗ —
// onWindowClosed fires after the window is gone — so Nib makes closing
// lossless instead: every edit is synced to the backend, and a window that
// dies dirty leaves a draft in tiny.store for EVERY tab it held. Reopen the
// file and the draft is restored, banner and all. ⌘W (one tab) gets the
// civilised version: an in-page sheet with Save / Don't Save / Cancel.
//
// Printing is the page's own job (⌘P → print.css hides the chrome →
// tiny.win.print()); Save as PDF flips that same sheet on and captures with
// tiny.win.printToPDF; and Export as HTML writes a standalone themed file
// wherever you point tiny.dialog.saveFile().

import { EXAMPLE_MD, EXAMPLE_SVG, EXAMPLE_NAME, EXAMPLE_IMAGE } from './example.js';

const dec = new TextDecoder();
const enc = new TextEncoder();

const THEMES = [['paper', 'Paper'], ['ink', 'Ink'], ['typewriter', 'Typewriter'], ['night', 'Night']];
const VIEWS = [['edit', 'Editor Only', '1'], ['split', 'Split', '2'], ['preview', 'Preview Only', '3']];
const APPEARANCES = [['system', 'Match System'], ['light', 'Light'], ['dark', 'Dark']];
// How the rendered page reads: line length, and what a picture does. All
// app-wide (one store entry, pushed to every window), all applied by the page
// as a class or a custom property — see the note in doc.js.
const WIDTHS = [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide'], ['full', 'Full Width']];
const PREF_DEFAULTS = {
  width: 'normal', captions: false, center: false, zoom: false, linkTabs: false,
};
// Where a pasted, dropped or picked picture lands, what it's called, and
// whether it's re-encoded on the way in. Same scope rule as the reading
// preferences: a project answers for itself, the app answers otherwise — but
// unlike those there's no menu of ticks, because the same dialog that sets
// them is the one a folder shows you the first time you paste into it.
const IMAGE_DEFAULTS = {
  dest: 'beside',        // beside | sub (a folder next to the doc) | root (project/<folder>)
  folder: 'images',
  naming: 'heading',     // heading | doc | stamp
  optimize: 'off',       // off | webp | same (re-encode in the page; see doc.js)
  maxWidth: 2000,        // 0 = don't scale
  quality: 82,
  // What a leading `/` means, which is not the same question for a picture as
  // for a link: a site whose sources live in src/ may write /index.md meaning
  // src/index.md and /images/logo.png meaning src/assets/images/logo.png. Both
  // are relative to the open folder, and empty means the folder itself.
  imageRoot: '',
  linkRoot: '',
};
const DESTS = new Set(['beside', 'sub', 'root']);
const NAMINGS = new Set(['heading', 'doc', 'stamp']);
const OPTIMIZE = new Set(['off', 'webp', 'same']);
const OPENABLE = new Set(['md', 'markdown', 'mdown', 'txt']);
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic', 'tiff']);
const RECENT_MAX = 8;
const FOLDER_MAX = 5;

const HELP_WIN = 'help';  // the Markdown reference window (one, shared)
let helpOpen = false;

let seq = 1;              // doc window ids: doc1, doc2, …
let untitled = 0;         // Untitled, Untitled 2, …
let opened = 0;           // cascade slot counter
let screen = { width: 1440, height: 900 };
// A window holds a STACK of open documents — one visible, the rest tabs. The
// two maps are the whole model: a sheet is a document (its text, what's on
// disk, whether it died dirty), a win is which sheets it holds and which one
// is showing. Files opened from inside a window join that window; Finder, the
// Dock and the Welcome screen still get a window of their own.
const sheets = new Map();  // sheetId -> { id, win, path, name, savedText, liveText, restored, closing }
const wins = new Map();    // winId -> { active, order: [sheetId] }
let sheetSeq = 1;
// The document window a menu-driven open should land in. Pages ping the
// backend when they take focus (setView & co carry meta.window), so this is
// the last window that had the keyboard — which is the one an Open Recent
// pick belongs in, as a tab, exactly like a click in the file tree.
let lastDocWin = null;

const sheetsOf = (winId) => (wins.get(winId)?.order || []).map((s) => sheets.get(s)).filter(Boolean);
const activeSheet = (winId) => sheets.get(wins.get(winId)?.active);
const sheetFor = (meta, id) => sheets.get(id) || activeSheet(meta && meta.window);
const findSheetByPath = (path) => [...sheets.values()].find((s) => s.path === path);

// What the page draws in its tab strip.
const tabsPayload = (winId) => {
  const w = wins.get(winId);
  if (!w) return null;
  return {
    active: w.active,
    tabs: sheetsOf(winId).map((s) => ({
      id: s.id, name: s.name, path: s.path, kind: s.kind, preview: !!s.preview,
      dirty: s.kind === 'doc' && s.liveText !== s.savedText,
    })),
  };
};
const pushTabs = (app, winId) => {
  const t = tabsPayload(winId);
  if (t) app.window(winId).push('tabs', t);
};

// The whole document, for a page that is about to show it.
const sheetPayload = (s) => ({
  id: s.id, path: s.path, name: s.name, kind: s.kind, preview: !!s.preview,
  text: s.liveText, savedText: s.savedText, restored: s.restored,
});

const base = (p) => p.split('/').pop();
const ext = (p) => (p.split('.').pop() || '').toLowerCase();
const draftKey = (d) => 'draft:' + (d.path || 'untitled');

// A path as the app should keep it. Everything inside Nib compares paths by
// prefix — `startsWith(project.root + '/')` decides what's in the project, what
// a rename touches, what a relative link resolves against — so a path has to
// arrive in one canonical shape. `nib .` from a terminal doesn't: tinyjs
// resolves argv against the cwd but leaves the dot on, and a root of
// `/work/notes/.` matches none of its own files. Separators are normalised
// too, since Windows hands back backslashes and the rest of this file cuts
// paths on '/'.
function tidyPath(p) {
  if (!p) return p;
  const s = String(p).replace(/\\/g, '/');
  const abs = s.startsWith('/');
  const segs = [];
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..' && segs.length && segs[segs.length - 1] !== '..') { segs.pop(); continue; }
    segs.push(seg);
  }
  return (abs ? '/' : '') + segs.join('/') || (abs ? '/' : '.');
}

const readText = async (path) => dec.decode(await tjs.readFile(path));
const writeText = (path, text) => tjs.writeFile(path, enc.encode(text));
const exists = async (path) => { try { await tjs.stat(path); return true; } catch { return false; } };

// ---------------------------------------------------------------- documents

// Where a new document window goes. Opened from another document — the file
// tree, Open Quickly, a link — it stacks just off that one, which is what
// makes a project feel like a single workspace instead of windows landing
// wherever the counter had got to. Opened cold (Finder, the Welcome screen) it
// takes the next cascade slot.
//
// The position goes IN with the open request. Setting it afterwards, from the
// page's boot call, is what made a window paint in one place and jump to
// another — tinyjs applies x/y before the first paint precisely so it doesn't.
async function placeWindow(app, from, slot, w, h) {
  if (from && wins.has(from)) {
    try {
      const st = await app.window(from).getState();
      if (st && typeof st.x === 'number') {
        const x = st.x + 34, y = st.y + 30;
        if (x + w < screen.width - 20 && y + h < screen.height - 40) return { x, y };
        return { x: 70, y: 70 };             // off the bottom-right: start again
      }
    } catch { /* that window is gone; fall through */ }
  }
  return slot ? { x: 96 + slot * 34, y: 78 + slot * 30 } : {};
}

// The Welcome screen is a launcher, not a document: it belongs on screen only
// while there is nothing else to look at. hide({ app: false }) is the whole
// reason this works — a plain hide() on the main window is NSApp hide, which
// would take the document windows' app down with it (tinyjs 0.30.0).
function syncWelcome(app) {
  if (wins.size) app.window('main').hide({ app: false });
  else app.show();
}

// Read a document off disk (or start an empty one), with the draft a window
// that died dirty may have left behind. A picture is a sheet too — same tab,
// same rename, no text: the page shows a viewer instead of the two panes.
async function makeSheet(app, path, draftText) {
  let savedText = '', liveText = draftText ?? '', restored = draftText != null, name;
  const kind = path && IMAGES.has(ext(path)) ? 'image' : 'doc';
  if (path) {
    if (kind === 'doc') {
      savedText = await readText(path);       // throws -> caller reports
      liveText = savedText;
      const draft = await app.store.get('draft:' + path);
      if (draft && typeof draft.text === 'string' && draft.text !== savedText) {
        liveText = draft.text;                // a window died dirty here before
        restored = true;
      }
    } else {
      await tjs.stat(path);                   // same contract: missing -> throw
    }
    name = base(path);
  } else {
    name = 'Untitled' + (++untitled > 1 ? ' ' + untitled : '');
  }
  const id = 'sh' + sheetSeq++;
  const s = { id, win: null, path, name, kind, preview: false, savedText, liveText, restored };
  sheets.set(id, s);
  return s;
}

// The size a new window opens at: whatever the last one was left at, so the
// app stops insisting on its own idea of a good size. Clamped to the screen in
// case the last window came from a bigger display.
async function windowSize(app) {
  const saved = await app.store.get('winSize');
  const w = Math.min(saved?.width || 1180, screen.width - 40);
  const h = Math.min(saved?.height || Math.round(screen.height * 0.86), screen.height - 60);
  return { w: Math.max(560, Math.round(w)), h: Math.max(420, Math.round(h)) };
}

// Opening a file, in every sense the app has: focus it if it's already up,
// add it to the window you asked from, or give it a window.
//
// `preview` is the VS Code idea: a single click puts the file up WITHOUT
// committing a tab to it. The next preview takes the same slot, so browsing a
// folder leaves one tab behind instead of thirty. Anything that says you mean
// it — typing, a double-click, ⌘⏎ — promotes the sheet and the next preview
// opens beside it. A preview sheet is therefore never dirty, which is what
// makes replacing one always safe.
// Opens of the SAME path are queued, because two of them can be in the air at
// once: a double-click in the tree fires click (preview) and then dblclick
// (keep) while the first is still reading the file, and both would sail past
// the "already open?" check below and make two tabs of one document.
const opening = new Map();               // path -> the open in flight

async function openDoc(app, path, opts = {}) {
  if (!path) return openDocNow(app, path, opts);
  const queued = (opening.get(path) || Promise.resolve())
    .catch(() => {})
    .then(() => openDocNow(app, path, opts));
  opening.set(path, queued);
  try { return await queued; }
  finally { if (opening.get(path) === queued) opening.delete(path); }
}

async function openDocNow(app, path, { draftText, from, forceWindow, preview } = {}) {
  if (path) {
    const open = findSheetByPath(path);
    if (open) {                              // already open — go to it, don't fork
      const w = wins.get(open.win);
      if (w) w.active = open.id;
      if (!preview) open.preview = false;    // ⌘⏎ on a previewing file keeps it
      const win = app.window(open.win);
      win.restore();
      win.show();
      win.push('show-sheet', sheetPayload(open));
      pushTabs(app, open.win);
      lastDocWin = open.win;
      syncWelcome(app);                      // Welcome may have been called up
      return open.win;
    }
  }

  const s = await makeSheet(app, path, draftText);
  s.preview = !!preview && !!path;           // an untitled draft is never a preview

  // Opened from a document window: it becomes a tab there.
  if (!forceWindow && from && wins.has(from)) {
    s.win = from;
    const w = wins.get(from);
    // A preview replaces the previewing tab, in its place — that slot is the
    // whole point of the mode.
    const old = sheetsOf(from).find((x) => x.preview);
    if (s.preview && old) {
      w.order.splice(w.order.indexOf(old.id), 1, s.id);
      sheets.delete(old.id);
    } else {
      w.order.push(s.id);
    }
    w.active = s.id;
    const win = app.window(from);
    win.restore();
    win.show();
    win.push('show-sheet', sheetPayload(s));
    pushTabs(app, from);
    lastDocWin = from;
    syncWelcome(app);
    if (path) bumpRecent(app, path);
    return from;
  }

  const id = 'doc' + seq++;
  s.win = id;
  wins.set(id, { active: s.id, order: [s.id] });
  const { w, h } = await windowSize(app);
  const slot = opened++ % 7;
  const at = await placeWindow(app, from, slot, w, h);
  app.openWindow(id, { page: 'doc.html', title: s.name, size: `${w}x${h}`, ...at });
  lastDocWin = id;
  syncWelcome(app);
  if (path) bumpRecent(app, path);
  return id;
}

async function bumpRecent(app, path) {
  const list = (await app.store.get('recents')) || [];
  const next = [{ path, at: Date.now() }, ...list.filter((r) => r.path !== path)].slice(0, RECENT_MAX);
  await app.store.set('recents', next);
  paintWelcome(app);
}

// Folders get their own short list — in project mode it's the folder you
// reopen, not the file, and a folder is one click to a whole tree.
async function bumpRecentFolder(app, path) {
  const list = (await app.store.get('folders')) || [];
  const next = [{ path, at: Date.now() }, ...list.filter((r) => r.path !== path)].slice(0, FOLDER_MAX);
  await app.store.set('folders', next);
  paintWelcome(app);
}

async function recentFolders(app) {
  const list = (await app.store.get('folders')) || [];
  const out = [];
  for (const r of list) {
    out.push({ ...r, exists: await exists(r.path), open: !!project && project.root === r.path });
  }
  return out;
}

// The welcome page repaints from this push (recents get a liveness check so
// deleted files show up grayed out instead of erroring on click) — and the
// File menu's Open Recent is the same two lists, so it is rebuilt here too.
async function paintWelcome(app) {
  const list = (await app.store.get('recents')) || [];
  const recents = [];
  for (const r of list) recents.push({ ...r, exists: await exists(r.path) });
  const draft = await app.store.get('draft:untitled');
  app.push('welcome', {
    recents, folders: await recentFolders(app),
    untitledDraft: draft ? { at: draft.at } : null,
  });
  await refreshMenu(app);
}


// What a fresh setMenu would otherwise forget. Every tick in the menu bar has
// a live value somewhere — some app-wide, some belonging to whichever window
// has focus — so the ones that aren't derivable are mirrored here and the
// sync* functions below keep them honest as they patch.
const menuState = {
  theme: 'paper', view: 'split', appearance: 'system',
  outline: false, editable: false, editableOk: true, files: false,
  recents: [], folders: [],
};

function syncViewMenu(app, view) {
  menuState.view = view;
  for (const [v] of VIEWS) app.updateMenuItem('view:' + v, { checked: v === view });
}
function syncThemeMenu(app, theme) {
  menuState.theme = theme;
  for (const [t] of THEMES) app.updateMenuItem('theme:' + t, { checked: t === theme });
}
function syncAppearanceMenu(app, appearance) {
  menuState.appearance = appearance;
  for (const [a] of APPEARANCES) app.updateMenuItem('appear:' + a, { checked: a === appearance });
}
function syncPrefsMenu(app, p) {
  for (const [w] of WIDTHS) app.updateMenuItem('pw:' + w, { checked: w === p.width });
  app.updateMenuItem('opt:captions', { checked: !!p.captions });
  app.updateMenuItem('opt:center', { checked: !!p.center });
  app.updateMenuItem('opt:zoom', { checked: !!p.zoom });
  app.updateMenuItem('opt:linkTabs', { checked: !!p.linkTabs });
}

// The live copy — read once in init(), so a menu toggle knows what it's
// toggling without a round trip to the store.
let prefs = { ...PREF_DEFAULTS };
const loadPrefs = async (app) => ({ ...PREF_DEFAULTS, ...((await app.store.get('prefs')) || {}) });
let images = { ...IMAGE_DEFAULTS };

// Anything the page sends back is a settings object from a form, so it's
// clamped rather than trusted — `folder` especially, which becomes a directory
// name: one segment, no dots to climb out with.
function cleanImages(s) {
  const o = { ...IMAGE_DEFAULTS, ...(s || {}) };
  if (!DESTS.has(o.dest)) o.dest = IMAGE_DEFAULTS.dest;
  if (!NAMINGS.has(o.naming)) o.naming = IMAGE_DEFAULTS.naming;
  if (!OPTIMIZE.has(o.optimize)) o.optimize = IMAGE_DEFAULTS.optimize;
  // one segment, and no way to climb out of it: separators become dashes, runs
  // of dots collapse, and what's left can't start with either
  o.folder = String(o.folder || '')
    .replace(/[^\w .-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.\s]+/, '')
    .replace(/[\s.]+$/, '').slice(0, 40) || IMAGE_DEFAULTS.folder;
  o.maxWidth = Math.max(0, Math.min(8000, Math.round(+o.maxWidth || 0)));
  o.quality = Math.max(30, Math.min(100, Math.round(+o.quality || IMAGE_DEFAULTS.quality)));
  o.imageRoot = cleanRoot(o.imageRoot);
  o.linkRoot = cleanRoot(o.linkRoot);
  return o;
}

// A root is a path INSIDE the open folder: segments only, no climbing out, no
// leading or trailing slashes to have to think about later.
const cleanRoot = (v) => String(v || '').replace(/\\/g, '/').split('/')
  .filter((s) => s && s !== '.' && s !== '..').join('/').slice(0, 120);

// ------------------------------------------------------------------ projects
//
// File ▸ Open Folder… puts a project behind the windows: one folder at a time,
// app-wide, with its file tree in every document window's sidebar. The folder
// keeps its own settings in `.nib/settings.json` — theme, view mode and the
// reading options — so a project can look the way that project should look
// without redecorating the app. Nothing else is written there, and closing the
// folder hands the app-wide settings back.

const IGNORE = new Set([
  '.git', '.svn', '.hg', 'node_modules', '.DS_Store', 'dist', 'build',
  '.next', '.cache', 'target', 'vendor', '__pycache__', '.venv', 'venv',
]);
const TREE_MAX = 4000;             // entries, not depth — a runaway walk helps nobody
const PROJECT_KEYS = ['theme', 'view', 'prefs', 'images'];

let project = null;   // { root, name, settings, tree, files }

// File ▸ Save Settings in Folder. On (the default), a project's look lives in
// its own `.nib/settings.json`; off, Nib never reads or writes anything inside
// the folder you opened and the app-wide settings keep applying. Either way
// the directory is only ever created when a setting actually changes — opening
// a folder writes nothing.
let useProjectSettings = true;
const projectOwns = () => !!project && useProjectSettings;

const relOf = (root, p) => (p.startsWith(root + '/') ? p.slice(root.length + 1) : p);

// One walk, breadth-ish, skipping the usual noise. Returns the nested tree for
// the sidebar and a flat list of files for the palettes.
async function walkTree(root) {
  let count = 0;
  const files = [];

  async function dir(path, depth) {
    const kids = [];
    const all = [];
    try {
      for await (const e of await tjs.readDir(path)) {
        all.push({ name: e.name, isDir: !!e.isDirectory });
      }
    } catch { return kids; }
    all.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of all) {
      if (count >= TREE_MAX) break;
      if (e.name.startsWith('.') || IGNORE.has(e.name)) continue;
      const full = path + '/' + e.name;
      count++;
      const isDir = e.isDir;
      if (isDir) {
        kids.push({ name: e.name, path: full, dir: true, kids: depth < 8 ? await dir(full, depth + 1) : [] });
      } else {
        const e2 = ext(e.name);
        const kind = OPENABLE.has(e2) ? 'doc' : IMAGES.has(e2) ? 'image' : 'other';
        kids.push({ name: e.name, path: full, kind });
        files.push({ name: e.name, path: full, rel: relOf(root, full), kind });
      }
    }
    // folders first, then files — both already alphabetical
    return kids.sort((a, b) => (a.dir === b.dir ? 0 : a.dir ? -1 : 1));
  }

  const tree = await dir(root, 0);
  return { tree, files, truncated: count >= TREE_MAX };
}

const settingsPath = (root) => root + '/.nib/settings.json';

async function readProjectSettings(root) {
  if (!useProjectSettings) return {};
  try {
    const raw = JSON.parse(await readText(settingsPath(root)));
    const out = {};
    for (const k of PROJECT_KEYS) if (raw[k] !== undefined) out[k] = raw[k];
    if (out.prefs) out.prefs = { ...PREF_DEFAULTS, ...out.prefs };
    if (out.images) out.images = cleanImages(out.images);
    return out;
  } catch { return {}; }
}

async function writeProjectSettings(app) {
  if (!projectOwns()) return;
  // makeDir, not mkdir — txiki has no `mkdir`, and the call was failing
  // silently into the catch below until the write hit ENOENT.
  try { await tjs.makeDir(project.root + '/.nib', { recursive: true }); } catch { /* there */ }
  await writeText(settingsPath(project.root), JSON.stringify(project.settings, null, 2) + '\n');
}

// What the windows should actually use: the project's answer when it has one,
// the app-wide answer otherwise.
const effTheme = async (app) =>
  (projectOwns() && project.settings.theme) || (await app.store.get('theme')) || 'paper';
const effView = async (app) =>
  (projectOwns() && project.settings.view) || (await app.store.get('view')) || 'split';
const effPrefs = () => (projectOwns() && project.settings.prefs) || prefs;
const effImages = () => cleanImages((projectOwns() && project.settings.images) || images);

// Everything that only means something with a folder open. View ▸ Files is
// NOT in the list: with no folder the panel is how you pick one.
function syncProjectMenu(app) {
  const on = !!project;
  for (const id of ['closefolder', 'quickopen', 'insertlink', 'renamefile', 'refreshfolder',
                    'find:folder']) {
    app.updateMenuItem(id, { enabled: on });
  }
}

function projectPayload() {
  if (!project) return null;
  return {
    root: project.root, name: project.name,
    tree: project.tree, files: project.files, truncated: project.truncated,
  };
}

async function loadProject(app, root) {
  const settings = await readProjectSettings(root);
  const { tree, files, truncated } = await walkTree(root);
  project = { root, name: base(root), settings, tree, files, truncated };
  app.push('project', projectPayload());
  syncProjectMenu(app);
  await pushEffective(app);
  return projectPayload();
}

// Theme / view / reading options all switch together when a project opens or
// closes, so every window is told once, from one place.
async function pushEffective(app) {
  const theme = await effTheme(app);
  const view = await effView(app);
  const p = effPrefs();
  syncThemeMenu(app, theme);
  syncPrefsMenu(app, p);
  syncViewMenu(app, view);
  app.push('doc-theme', { theme });
  app.push('doc-prefs', p);
  app.push('doc-view', { view });
}

// ------------------------------------------------------------ links to files
//
// A rename is only half a rename: every document that pointed at the old name
// is now pointing at nothing. This is the other half — find the links that
// RESOLVED to the renamed path and re-aim them, for pictures as much as for
// documents (`![alt](shot.png)` is the same syntax with a bang in front).
//
// Resolved, not matched as text: comparing strings would miss
// `../notes/todo.md` and cheerfully rewrite an unrelated `todo.md` two folders
// away. So every target is resolved against its own document's directory —
// the way the preview resolves it — and compared as an absolute path.
//
// Two forms carry a target: the inline `](target)` and the reference
// definition `[id]: target`. Both are matched a line at a time, which keeps
// fenced code out of it and costs nothing: neither form spans a newline.

const LINKS = new Set(['md', 'markdown', 'mdown']);
// group 2 is the target in both, so one rewrite serves them — and it may be
// wrapped in <angle brackets>, which is how a path with spaces or parentheses
// has to be written: `![](</assets/image (14).png>)`
const INLINE_RE = /(!?\[(?:[^\][\\\n]|\\.)*\]\(\s*)(<[^<>\n]*>|[^()\s]*)((?:\s+"[^"\n]*")?\s*\))/g;
const DEFN_RE = /^([ ]{0,3}\[(?:[^\][\\\n]|\\.)+\]:[ \t]*)(<[^<>\n]*>|\S+)/;

const external = (t) => !t || t.startsWith('#') || t.startsWith('//') || /^[a-z][\w+.-]*:/i.test(t);
const decodeTarget = (t) => { try { return decodeURI(t); } catch { return t; } };
// only what would break the inline form — re-encoding the whole path would
// rewrite perfectly good names that merely contain a % or an accent
const encodeTarget = (t) => t.replace(/[ ()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function normPath(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return '/' + out.join('/');
}

// /a/b/c.md seen from /a/x -> ../b/c.md   (the backend's relativeTo; files.js
// has the page's copy, which answers the same question for inserted links)
function relFrom(dir, target) {
  const a = dir.split('/').filter(Boolean), b = target.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return '../'.repeat(a.length - i) + b.slice(i).join('/');
}

// What a leading `/` points at. `![](/images/logo.png)` and `[x](/index.md)`
// are both root-relative, but a project can mean different roots by them — a
// site with its sources in src/ and its pictures under src/assets writes both
// forms and expects both to work. Empty means the open folder itself, and with
// no folder open a `/` is what it has always been: a path on the disk.
const rootsOf = () => (project ? { root: project.root, ...effImages() } : null);
const rootBase = (o, kind) =>
  normPath(o.root + '/' + ((kind === 'image' ? o.imageRoot : o.linkRoot) || ''));

// Both readings of a target, best first. A document that genuinely holds a
// filesystem path keeps working: the mapped answer is tried, then the literal
// one — so the mapping adds a meaning rather than taking one away.
function resolveTarget(target, dir, kind, roots) {
  if (!target.startsWith('/')) return [normPath(dir + '/' + target)];
  const lit = normPath(target);
  if (!roots) return [lit];
  const mapped = normPath(rootBase(roots, kind) + '/' + target);
  return mapped === lit ? [lit] : [mapped, lit];
}

// Every link in `text` that pointed at `from` (or at anything inside it, so a
// renamed FOLDER carries its whole subtree), re-aimed at `to`.
function rewriteLinks(text, docDir, from, to, roots) {
  let count = 0;
  const aim = (whole, head, written, tail = '') => {
    // <angle brackets> are a wrapper, not part of the path — and one the
    // rewrite has to put back, or a name with a space in it breaks on write
    const wrapped = written.startsWith('<') && written.endsWith('>');
    const target = wrapped ? written.slice(1, -1) : written;
    if (external(target)) return whole;
    const hash = target.indexOf('#');
    const raw = hash < 0 ? target : target.slice(0, hash);
    const frag = hash < 0 ? '' : target.slice(hash);
    if (!raw) return whole;
    const dec = decodeTarget(raw);
    // `![…](…)` resolves against the image root, `[…](…)` against the link one
    const kind = head.includes('![') ? 'image' : 'link';
    const tries = resolveTarget(dec, docDir, kind, roots);

    let abs = null, next = null;
    for (const cand of tries) {
      if (cand === from) { abs = cand; next = to; break; }
      if (cand.startsWith(from + '/')) { abs = cand; next = to + cand.slice(from.length); break; }
    }
    if (!next) return whole;
    count++;

    // Written back in the form it was written in: a root-relative link stays
    // root-relative (re-derived, in case the file moved within the root), a
    // filesystem path stays one, and a relative path is recomputed — which is
    // what makes a rename ACROSS folders come out with the right ../
    let out;
    if (!dec.startsWith('/')) out = relFrom(docDir, next);
    else if (roots && abs === tries[0] && tries.length > 1) {
      const base = rootBase(roots, kind);
      out = next === base || next.startsWith(base + '/') ? '/' + relFrom(base, next)
        : relFrom(docDir, next);       // moved out from under the root entirely
    } else out = next;
    // inside brackets a space is legal and %20 is not what was written; bare,
    // the few characters that would break the form are escaped
    return head + (wrapped ? '<' + out + frag + '>' : encodeTarget(out) + frag) + tail;
  };

  const lines = text.split('\n');
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    lines[i] = lines[i]
      .replace(INLINE_RE, (w, h, t, tl) => aim(w, h, t, tl))
      .replace(DEFN_RE, (w, h, t) => aim(w, h, t));
  }
  return { text: lines.join('\n'), count };
}

// The same walk as the folder search, over Markdown only: count the links that
// need re-aiming, and (with `write`) re-aim them. A document someone has open
// is read from its LIVE buffer rather than from disk, so the count is what
// they can see — and written back the same way: an unsaved buffer is edited in
// place and left dirty, never written under them, which is the one thing
// Replace in Folder can't do because it has no idea what its regex means.
async function refsWalk(app, from, to, write) {
  const files = project.files.filter((f) => LINKS.has(ext(f.name)));
  const roots = rootsOf();
  const hits = [];
  let total = 0, changed = 0, next = 0;

  async function worker() {
    while (next < files.length) {
      const f = files[next++];
      const open = findSheetByPath(f.path);
      let text;
      if (open && open.kind === 'doc') text = open.liveText;
      else {
        try {
          if ((await tjs.stat(f.path)).size > SEARCH_MAX_BYTES) continue;
          text = await readText(f.path);
        } catch { continue; }
      }
      const dir = f.path.slice(0, f.path.lastIndexOf('/'));
      const r = rewriteLinks(text, dir, from, to, roots);
      if (!r.count) continue;
      const dirty = !!open && open.liveText !== open.savedText;
      total += r.count;
      hits.push({ rel: f.rel, path: f.path, name: f.name, count: r.count, dirty });
      if (!write) continue;
      if (open) {
        open.liveText = r.text;
        if (!dirty) { await writeText(f.path, r.text); open.savedText = r.text; }
        app.window(open.win).push('sheet-text', { id: open.id, text: r.text, saved: !dirty });
        pushTabs(app, open.win);
      } else {
        await writeText(f.path, r.text);
      }
      changed++;
    }
  }

  await Promise.all(Array.from({ length: 8 }, worker));
  hits.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files: hits, total, changed };
}

// -------------------------------------------------------------------- search
//
// Find in Folder. There is no index, and there doesn't need to be one — VS
// Code doesn't keep one either, it shells out to ripgrep. This reads the
// project's text files and scans them, which for a folder of documents is
// milliseconds; the reads run in a small pool so the disk is never waiting on
// one file at a time. The PAGE compiles the pattern (see findRe in doc.js) and
// sends it as source + flags, so the in-file bar and the folder search can't
// drift into meaning different things by the same query.
//
// The regex itself is the user's, and a pathological one can wedge this loop —
// the same trap VS Code avoids by using Rust's linear-time engine. Files are
// capped by size, and a scan stops at HITS_MAX, but a runaway pattern on one
// large file is still possible.

const TEXTY = new Set([...OPENABLE, 'json', 'yml', 'yaml', 'csv', 'html', 'css', 'js', 'ts']);
const SEARCH_MAX_BYTES = 2 * 1024 * 1024;
const HITS_MAX = 2000;                 // across the whole search
const HITS_PER_FILE = 200;
const LINE_MAX = 400;                  // of context per hit, so a minified line can't flood the panel

function buildRe(pattern, flags) {
  if (!pattern) return null;
  try { return new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'); }
  catch { return null; }
}

// Every match in one string, with the line it fell on and that line's text.
// The line number is carried forward rather than recomputed, so a file with a
// thousand hits still costs one pass.
function scanText(text, re) {
  const hits = [];
  re.lastIndex = 0;
  let line = 0, counted = 0, m;
  while ((m = re.exec(text))) {
    const i = m.index;
    for (let k = counted; k < i; k++) if (text.charCodeAt(k) === 10) line++;
    counted = i;
    const from = text.lastIndexOf('\n', i - 1) + 1;
    let to = text.indexOf('\n', i);
    if (to < 0) to = text.length;
    hits.push({
      line, col: i - from, len: m[0].length,
      text: text.slice(from, Math.min(to, from + LINE_MAX)),
    });
    if (!m[0].length) re.lastIndex++;   // a pattern that can match nothing
    if (hits.length >= HITS_PER_FILE) break;
  }
  return hits;
}

// One walk of the project's text files. `replace` turns it into the write —
// same scan, same pattern, so what you replace is exactly what you were shown.
async function searchProject(app, re, replace) {
  const files = project.files.filter((f) => TEXTY.has(ext(f.name)));
  const found = [];
  const skipped = [];
  let total = 0, changed = 0, truncated = false, next = 0;

  async function worker() {
    while (next < files.length && !truncated) {
      const f = files[next++];
      let text;
      try {
        if ((await tjs.stat(f.path)).size > SEARCH_MAX_BYTES) continue;
        text = await readText(f.path);
      } catch { continue; }
      if (text.includes('\0')) continue;                 // not text after all
      const hits = scanText(text, re);
      if (!hits.length) continue;
      total += hits.length;
      found.push({ path: f.path, rel: f.rel, name: f.name, hits });
      // stop LISTING at the cap, but never stop REPLACING at it — a replace
      // that quietly did most of the folder would be the worst of both
      if (total >= HITS_MAX && replace == null) truncated = true;
      if (replace == null) continue;

      // A file someone is editing is not ours to rewrite underneath them.
      const open = findSheetByPath(f.path);
      if (open && open.liveText !== open.savedText) { skipped.push(f.rel); continue; }
      re.lastIndex = 0;
      const out = text.replace(re, replace);
      if (out === text) continue;
      await writeText(f.path, out);
      changed++;
      if (open) {
        open.savedText = out;
        open.liveText = out;
        app.window(open.win).push('sheet-text', { id: open.id, text: out });
      }
    }
  }

  await Promise.all(Array.from({ length: 8 }, worker));
  found.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files: found, total, truncated, changed, skipped };
}

// ----------------------------------------------------------------------- api

export const api = {
  // Every window boots here; meta.window says which one is asking.
  boot: async (_p, app, meta) => {
    const theme = await effTheme(app);
    const view = await effView(app);
    const appearance = (await app.store.get('appearance')) || 'system';
    const outline = (await app.store.get('outline')) || false;
    const editable = (await app.store.get('editable')) || false;

    if (meta.window === HELP_WIN) return { kind: 'help', appearance, theme };

    const d = activeSheet(meta.window);
    if (!d) {                                // the welcome window
      const list = (await app.store.get('recents')) || [];
      const recents = [];
      for (const r of list) recents.push({ ...r, exists: await exists(r.path) });
      const draft = await app.store.get('draft:untitled');
      return {
        kind: 'welcome', appearance, recents, folders: await recentFolders(app),
        untitledDraft: draft ? { at: draft.at } : null,
      };
    }

    return {
      kind: 'doc', theme, view, appearance, outline, editable,
      prefs: effPrefs(), project: projectPayload(),
      sheet: sheetPayload(d), tabs: tabsPayload(meta.window),
    };
  },

  // ---------------------------------------------------------------- projects

  // The page owns the folder picker (dialogs are page-side), so it either
  // hands us a path or asks us to remember the last one on launch.
  openFolder: async ({ path: given, quiet }, app) => {
    const path = tidyPath(given);
    if (!path) return null;
    try { if (!(await tjs.stat(path)).isDirectory) return null; } catch { return null; }
    await app.store.set('project', path);
    const p = await loadProject(app, path);
    await bumpRecentFolder(app, path);
    // A folder with no window to show it in is an invisible folder: open the
    // README (or the first Markdown file at the root) so the tree has a home.
    if (!quiet && !wins.size) {
      const top = project.files.filter((f) => f.kind === 'doc' && !f.rel.includes('/'));
      const pick = top.find((f) => /^readme\.(md|markdown)$/i.test(f.name)) || top[0];
      if (pick) await openDoc(app, pick.path);
      else app.push('toast', { text: p.name + ' — no Markdown files at the top level' });
    }
    return p;
  },

  closeFolder: async (_p, app) => {
    project = null;
    await app.store.delete('project');
    app.push('project', null);
    syncProjectMenu(app);
    paintWelcome(app);
    await pushEffective(app);
    return true;
  },

  // Whether a project may keep its own settings. Turning it off doesn't delete
  // an existing .nib — it just stops Nib reading or writing one, and the
  // app-wide settings take over again immediately.
  setProjectSettings: async ({ on }, app) => {
    useProjectSettings = !!on;
    await app.store.set('useProjectSettings', useProjectSettings);
    app.updateMenuItem('projsettings', { checked: useProjectSettings });
    if (project) {
      project.settings = await readProjectSettings(project.root);
      await pushEffective(app);
    }
    return true;
  },

  // Find in Folder. The page sends a compiled pattern (source + flags) so the
  // bar and the folder agree on what the query means; we answer with the hits,
  // grouped by file, and how much we had to leave out.
  findInFolder: async ({ pattern, flags }, app) => {
    if (!project) return { error: 'No folder is open.' };
    const re = buildRe(pattern, flags || 'g');
    if (!re) return { error: 'That isn’t a valid pattern.' };
    const t = Date.now();
    const r = await searchProject(app, re, null);
    return { ...r, root: project.root, ms: Date.now() - t };
  },

  // The same search, writing. Files with unsaved changes are left alone and
  // named back — replacing under a buffer you're editing would lose the edit.
  replaceInFolder: async ({ pattern, flags, replace }, app) => {
    if (!project) return { error: 'No folder is open.' };
    const re = buildRe(pattern, flags || 'g');
    if (!re) return { error: 'That isn’t a valid pattern.' };
    const r = await searchProject(app, re, String(replace ?? ''));
    return { changed: r.changed, total: r.total, skipped: r.skipped };
  },

  // Open a file AT a place — a search hit. The window it lands in gets a
  // 'goto' once the sheet is showing, which is what selects the match.
  openAt: async ({ path, line, col, len, preview }, app, meta) => {
    if (!path) return false;
    const win = await openDoc(app, path, { from: meta && meta.window, preview });
    if (win) app.window(win).push('goto', { path, line, col, len });
    return true;
  },

  // A tree that's gone stale (files added outside Nib) — same walk, no reopen.
  refreshFolder: async (_p, app) => {
    if (!project) return null;
    const { tree, files, truncated } = await walkTree(project.root);
    Object.assign(project, { tree, files, truncated });
    app.push('project', projectPayload());
    return projectPayload();
  },

  // Rename a file or folder in the tree. The rename itself is one call; the
  // work is everything that was pointing at the old name — open sheets (a
  // whole subtree of them if you renamed a folder), their drafts, the recent
  // lists, the tree. Links inside documents are the page's next move: it takes
  // the { from, to } below to scanRefs, asks, and calls updateRefs.
  renameEntry: async ({ path, name }, app) => {
    if (!project) return { error: 'No folder is open.' };
    if (!path || !path.startsWith(project.root + '/')) return { error: 'That isn’t in this folder.' };
    const clean = String(name || '').trim();
    if (!clean || clean === '.' || clean === '..' || /[/\\]/.test(clean)) {
      return { error: 'A name can’t be empty or contain a slash.' };
    }
    const dir = path.slice(0, path.lastIndexOf('/'));
    const next = dir + '/' + clean;
    if (next === path) return { ok: true, path, name: clean };
    if (await exists(next)) return { error: '“' + clean + '” already exists here.' };
    try { await tjs.rename(path, next); } catch { return { error: 'Couldn’t rename that.' }; }

    const moved = (p) => (p === path || p.startsWith(path + '/') ? next + p.slice(path.length) : p);

    const touched = new Set();
    for (const s of sheets.values()) {
      if (!s.path || moved(s.path) === s.path) continue;
      s.path = moved(s.path);
      s.name = base(s.path);
      touched.add(s.win);
      app.window(s.win).push('sheet-path', { id: s.id, path: s.path, name: s.name });
    }
    for (const w of touched) pushTabs(app, w);

    // drafts are keyed by path, so they'd be orphaned by the rename
    const all = await app.store.all();
    for (const k of Object.keys(all || {})) {
      if (!k.startsWith('draft:')) continue;
      const p = k.slice(6);
      if (moved(p) === p) continue;
      await app.store.set('draft:' + moved(p), all[k]);
      await app.store.delete(k);
    }

    const fix = async (key) => {
      const list = (await app.store.get(key)) || [];
      await app.store.set(key, list.map((r) => ({ ...r, path: moved(r.path) })));
    };
    await fix('recents');
    await fix('folders');

    await api.refreshFolder(null, app);
    paintWelcome(app);
    return { ok: true, path: next, name: clean, from: path };
  },

  // What that rename left dangling, and the offer to fix it. Two calls rather
  // than one so the page can ask first — the whole point is that a rename
  // doesn't quietly rewrite six other documents.
  scanRefs: async ({ from, to }, app) => {
    if (!project || !from || !to || from === to) return { total: 0, files: [] };
    const r = await refsWalk(app, from, to, false);
    return { total: r.total, files: r.files };
  },

  updateRefs: async ({ from, to }, app) => {
    if (!project || !from || !to || from === to) return { total: 0, changed: 0 };
    const r = await refsWalk(app, from, to, true);
    return { total: r.total, changed: r.changed, files: r.files };
  },

  // Debounced buffer sync — this is what makes red-✗ closes lossless.
  sync: ({ id, text }, app, meta) => {
    const d = sheetFor(meta, id);
    if (!d || d.kind === 'image' || typeof text !== 'string') return true;
    const was = d.liveText !== d.savedText;
    d.liveText = text;
    if (was !== (d.liveText !== d.savedText)) pushTabs(app, d.win);   // dot on/off
    return true;
  },

  // Save. The page owns the native Save panel (dialogs are page-side), so an
  // untitled doc gets { needsPath: true } back and calls again with the pick.
  saveDoc: async ({ id, text, path }, app, meta) => {
    const d = sheetFor(meta, id);
    if (!d) throw new Error('not a document window');
    if (d.kind === 'image') return { ok: true, id: d.id, path: d.path, name: d.name };
    if (path) {
      if (!/\.[A-Za-z0-9]+$/.test(path)) path += '.md';
      d.path = path;
      d.name = base(path);
    }
    if (!d.path) return { needsPath: true };
    await writeText(d.path, text);
    d.savedText = text;
    d.liveText = text;
    d.restored = false;
    await app.store.delete(draftKey(d));
    bumpRecent(app, d.path);
    pushTabs(app, d.win);
    return { ok: true, id: d.id, path: d.path, name: d.name };
  },

  // Throw away the draft and go back to what's on disk.
  revert: async ({ id } = {}, app, meta) => {
    const d = sheetFor(meta, id);
    if (!d || !d.path) throw new Error('nothing to revert to');
    const text = await readText(d.path);
    d.savedText = text;
    d.liveText = text;
    d.restored = false;
    await app.store.delete(draftKey(d));
    pushTabs(app, d.win);
    return { text };
  },

  // ------------------------------------------------------------------- tabs

  // Show another of this window's documents. The page has already flushed the
  // one it was showing, so liveText here is current.
  showSheet: ({ id }, app, meta) => {
    const w = wins.get(meta.window);
    const d = sheets.get(id);
    if (!w || !d || d.win !== meta.window) return null;
    w.active = id;
    pushTabs(app, meta.window);
    return sheetPayload(d);
  },

  // Close one tab. The page has done the dirty dance already (saved, or chose
  // Don't Save); closing the last tab closes the window with it.
  closeSheet: async ({ id, discard }, app, meta) => {
    const w = wins.get(meta.window);
    const d = sheets.get(id) || activeSheet(meta.window);
    if (!w || !d) return { closed: false };
    if (discard) await app.store.delete(draftKey(d));
    const idx = w.order.indexOf(d.id);
    sheets.delete(d.id);
    w.order = w.order.filter((s) => s !== d.id);

    if (!w.order.length) {                   // that was the last one
      w.closing = true;
      app.window(meta.window).close();
      return { closed: true, window: true };
    }
    // the neighbour on the right, or the new last one
    if (w.active === d.id) w.active = w.order[Math.min(idx, w.order.length - 1)];
    const next = sheets.get(w.active);
    pushTabs(app, meta.window);
    return { closed: true, sheet: next ? sheetPayload(next) : null };
  },

  // Close the whole window. Dirty tabs are not argued over: they become drafts
  // exactly as they would if you'd used the red ✗, and the Welcome screen
  // offers them back. That promise is the reason this app can be casual here.
  closeWindow: (_p, app, meta) => {
    app.window(meta.window).close();
    return true;
  },

  // Drag-reorder in the tab strip.
  reorderSheets: ({ order }, app, meta) => {
    const w = wins.get(meta.window);
    if (!w || !Array.isArray(order)) return false;
    const keep = order.filter((id) => w.order.includes(id));
    if (keep.length !== w.order.length) return false;
    w.order = keep;
    pushTabs(app, meta.window);
    return true;
  },

  // The window was resized — remember it, so the next one opens like this one.
  rememberSize: async ({ width, height }, app) => {
    if (!(width > 300) || !(height > 200)) return false;
    await app.store.set('winSize', { width: Math.round(width), height: Math.round(height) });
    return true;
  },

  // The Welcome screen keeps its own size — it's a different kind of window,
  // and inheriting a document window's 1180×900 would be absurd for it.
  rememberWelcomeSize: async ({ width, height }, app) => {
    if (!(width > 300) || !(height > 200)) return false;
    await app.store.set('welcomeSize', { width: Math.round(width), height: Math.round(height) });
    return true;
  },

  // ⌘N: a new document joins the window you're in, like an opened file does.
  // File ▸ New Window is the way to get a window of its own.
  newDoc: async (_p, app, meta) => (await openDoc(app, null, { from: meta && meta.window }), true),
  newWindow: async (_p, app) => (await openDoc(app, null, { forceWindow: true }), true),

  // Files from anywhere — Open panel, window drops, recents clicks.
  // meta.window is whoever asked — a document window opening a file from its
  // tree, its palette or one of its links, so the new one can stack off it.
  // `preview` is the single-click, not-committed-to-it open (see openDoc).
  // Everything that opens something arrives here: the Open panel, drops on a
  // window or the Dock icon, a click in the recents, Finder, and — since
  // tinyjs 0.30 hands argv to onOpenFiles — `nib notes.md` from a terminal.
  //
  // A FOLDER is a different verb. `nib .` and dropping a directory both mean
  // "make this the project", not "open a document", so a directory in the list
  // opens the folder and the last one wins; files still open as documents.
  openPaths: async ({ paths, preview }, app, meta) => {
    let ok = 0, skipped = 0, folder = null;
    for (const raw of paths || []) {
      const p = tidyPath(raw);
      let dir = false;
      try { dir = !!(await tjs.stat(p)).isDirectory; } catch { /* gone, or a name we can't stat */ }
      if (dir) { folder = p; continue; }
      if (!OPENABLE.has(ext(p)) && !IMAGES.has(ext(p))) { skipped++; continue; }
      try { await openDoc(app, p, { from: meta && meta.window, preview }); ok++; }
      catch { skipped++; app.push('toast', { text: 'Couldn’t open ' + base(p) }); }
    }
    // after the files, so a `nib . README.md` lands with the tree already up
    if (folder) {
      const p = await api.openFolder({ path: folder, quiet: ok > 0 }, app);
      if (p) ok++; else skipped++;
    }
    return { opened: ok, skipped, folder };
  },

  // "I mean it" — the preview tab becomes a real one. Typing in the document
  // does this, and so do a double-click and ⌘⏎ in the tree.
  promoteSheet: ({ id }, app, meta) => {
    const d = sheetFor(meta, id);
    if (!d || !d.preview) return false;
    d.preview = false;
    pushTabs(app, d.win);
    return true;
  },

  removeRecentFolder: async ({ path }, app) => {
    const list = (await app.store.get('folders')) || [];
    await app.store.set('folders', list.filter((r) => r.path !== path));
    paintWelcome(app);
    return true;
  },

  removeRecent: async ({ path }, app) => {
    const list = (await app.store.get('recents')) || [];
    await app.store.set('recents', list.filter((r) => r.path !== path));
    paintWelcome(app);
    return true;
  },

  // The welcome card for a draft that died with no file behind it.
  restoreUntitled: async (_p, app) => {
    const draft = await app.store.get('draft:untitled');
    if (!draft) return false;
    await app.store.delete('draft:untitled');
    await openDoc(app, null, { draftText: draft.text });
    paintWelcome(app);
    return true;
  },

  // Theme is app-wide — unless a folder is open, in which case it belongs to
  // that folder and lands in its .nib/settings.json. Same rule for the view
  // mode and the reading options below: the project answers when there is one.
  setTheme: async ({ theme }, app) => {
    if (!THEMES.some(([t]) => t === theme)) return false;
    if (projectOwns()) {
      project.settings.theme = theme;
      await writeProjectSettings(app);
    } else {
      await app.store.set('theme', theme);
    }
    syncThemeMenu(app, theme);
    app.push('doc-theme', { theme });
    return true;
  },

  // Appearance is the app's own chrome (Light / Dark / Match System) — the
  // preview theme is a separate axis. Pages resolve 'system' themselves.
  setAppearance: async ({ appearance }, app) => {
    if (!APPEARANCES.some(([a]) => a === appearance)) return false;
    await app.store.set('appearance', appearance);
    syncAppearanceMenu(app, appearance);
    app.push('appearance', { appearance });
    return true;
  },

  // Reading preferences (page width, captions, centring, zoom, linked tabs) —
  // one set, same shape as the theme: persist, retick, tell the windows.
  setPref: async ({ key, value }, app) => {
    if (!(key in PREF_DEFAULTS)) return false;
    if (key === 'width' && !WIDTHS.some(([w]) => w === value)) return false;
    const next = { ...effPrefs(), [key]: key === 'width' ? value : !!value };
    if (projectOwns()) {
      project.settings.prefs = next;
      await writeProjectSettings(app);
    } else {
      prefs = next;
      await app.store.set('prefs', prefs);
    }
    syncPrefsMenu(app, next);
    app.push('doc-prefs', next);
    return true;
  },

  // View mode is per-window; the menu's ticks follow the focused window
  // (pages re-assert on focus so the radio never drifts — which is also how
  // the backend learns which window has the keyboard).
  setView: async ({ view, persist }, app, meta) => {
    if (!VIEWS.some(([v]) => v === view)) return false;
    if (meta && wins.has(meta.window)) lastDocWin = meta.window;
    if (persist) {
      if (projectOwns()) {
        project.settings.view = view;
        await writeProjectSettings(app);
      } else {
        await app.store.set('view', view);
      }
    }
    syncViewMenu(app, view);
    return true;
  },

  // The file tree is per-window too; its menu tick follows the focused one.
  // Never disabled: with no folder open the panel is how you choose one.
  setFilesPanel: ({ on }, app) => {
    menuState.files = !!on;
    app.updateMenuItem('files', { checked: !!on, enabled: true });
    return true;
  },

  // Same deal for the outline sidebar: per-window, with a remembered default.
  setOutline: async ({ on, persist }, app) => {
    if (persist) await app.store.set('outline', !!on);
    menuState.outline = !!on;
    app.updateMenuItem('outline', { checked: !!on });
    return true;
  },

  // "Editable" — type into the rendered preview. Only means anything when
  // the preview is on screen, so the menu item grays out in Editor Only.
  setEditable: async ({ on, enabled, persist }, app) => {
    if (persist) await app.store.set('editable', !!on);
    menuState.editable = !!on;
    menuState.editableOk = enabled !== false;
    app.updateMenuItem('editable', { checked: !!on, enabled: enabled !== false });
    return true;
  },

  // The image settings in force here, and whether this folder has ever been
  // asked about them. `ask` is what makes the first paste into a folder a
  // question and every one after it silent.
  imageOptions: async (_p, app, meta) => {
    const d = activeSheet(meta && meta.window);
    const scope = project ? project.root
      : (d && d.path ? d.path.slice(0, d.path.lastIndexOf('/')) : null);
    const asked = (await app.store.get('imgAsked')) || [];
    return {
      settings: effImages(), scope, project: !!project,
      root: project ? project.root : null,
      inFolder: useProjectSettings,     // File ▸ Save Settings in Folder
      ask: !!scope && !asked.includes(scope),
    };
  },

  // Same scope rule as the theme: a project keeps its own answer, the app
  // keeps the answer for everywhere else. `scope` only marks the folder as
  // asked — cancelling the dialog sends it without settings, so a folder never
  // asks twice whatever you did with the question.
  setImageOptions: async ({ settings, scope }, app) => {
    if (settings) {
      const s = cleanImages(settings);
      if (projectOwns()) {
        project.settings.images = s;
        await writeProjectSettings(app);
      } else {
        images = s;
        await app.store.set('images', s);
      }
    }
    if (scope) {
      const asked = (await app.store.get('imgAsked')) || [];
      if (!asked.includes(scope)) await app.store.set('imgAsked', [...asked, scope].slice(-60));
    }
    return { settings: effImages() };
  },

  // Put an image next to the document — or in the folder the settings name —
  // and hand back the relative path to link. Used by paste (a clipboard temp
  // png), by drops, and by Insert Image…; `data` instead of `src` is the page
  // handing over bytes it re-encoded itself (see optimizeImage in doc.js).
  //
  // The destination is computed HERE from the settings, never taken from the
  // page: `dest` is one of three shapes and `folder` is one cleaned segment,
  // so a document can't be talked into writing outside its own project.
  saveImage: async ({ id, src, data, format, stem, number }, app, meta) => {
    const d = sheetFor(meta, id);
    if (!d) throw new Error('not a document window');
    if (!d.path) return { needsPath: true };
    const e = String(format || ext(src || '')).toLowerCase();
    if (!IMAGES.has(e)) throw new Error('not an image');

    const s = effImages();
    const docDir = d.path.slice(0, d.path.lastIndexOf('/'));
    let dir = docDir;
    if (s.dest === 'sub') dir = docDir + '/' + s.folder;
    else if (s.dest === 'root' && project && d.path.startsWith(project.root + '/')) {
      // under the IMAGE root when the project has one, so a picture lands
      // where that project's own `/images/…` links already point
      dir = normPath(rootBase(rootsOf(), 'image') + '/' + s.folder);
    }
    if (dir !== docDir) {
      try { await tjs.makeDir(dir, { recursive: true }); } catch { /* already there */ }
    }
    // a file already sitting where it belongs keeps the name it came with
    if (!data && src && src.slice(0, src.lastIndexOf('/')) === dir) {
      return { name: base(src), path: src, rel: relFrom(docDir, src) };
    }

    const head = String(stem || base(src || '').replace(/\.[^.]*$/, '') || 'image')
      .replace(/[/\\:]+/g, '-').replace(/^\.+/, '').slice(0, 60) || 'image';
    let name, n = number ? 1 : 0;
    for (;;) {
      name = n ? `${head}-${n}.${e}` : `${head}.${e}`;
      if (!(await exists(dir + '/' + name))) break;
      n = n ? n + 1 : 2;
    }
    await tjs.writeFile(dir + '/' + name, data ? fromB64(data) : await tjs.readFile(src));
    if (project && dir.startsWith(project.root)) await api.refreshFolder(null, app);
    return { name, path: dir + '/' + name, rel: relFrom(docDir, dir + '/' + name) };
  },

  // The guided tour. It's written into the app's own data folder (with the
  // one image it references) so it opens as an ordinary, editable document —
  // and rewritten fresh each time, unless a window already has it open.
  openExample: async (_p, app) => {
    const dir = app.paths.data;
    try { await tjs.makeDir(dir, { recursive: true }); } catch { /* already there */ }
    const path = dir + '/' + EXAMPLE_NAME;
    if (!findSheetByPath(path)) {
      await writeText(dir + '/' + EXAMPLE_IMAGE, EXAMPLE_SVG);
      await writeText(path, EXAMPLE_MD);
      await app.store.delete('draft:' + path);       // a fresh copy, every time
    }
    await openDoc(app, path);
    return { ok: true, path };
  },

  // Markdown reference — one shared window, focused if it's already up.
  openHelp: (_p, app) => {
    if (helpOpen) {
      const w = app.window(HELP_WIN);
      w.restore();
      w.show();
      return true;
    }
    helpOpen = true;
    app.openWindow(HELP_WIN, {
      page: 'help.html', title: 'Markdown in Nib', size: '760x720',
    });
    return true;
  },

  // The page wrote a file itself (tiny.win.printToPDF) — announce it the same
  // way exports are announced, so the banner reveals it in Finder.
  announce: ({ path, title }, app) => {
    if (!path) return false;
    app.notify({ id: 'reveal:' + path, title: title || 'Nib', body: base(path), sound: false });
    return true;
  },

  // The page hands us a finished standalone HTML document (theme inlined,
  // images already data:-URIs); we just put it where the Save panel said.
  exportHtml: async ({ path, html }, app) => {
    if (!path || typeof html !== 'string') throw new Error('bad export');
    if (!/\.html?$/i.test(path)) path += '.html';
    await writeText(path, html);
    app.notify({
      id: 'reveal:' + path,
      title: 'Nib — exported HTML',
      body: base(path),
      sound: false,
    });
    return { ok: true, path, name: base(path) };
  },

  // Backend as asset server: the preview asks for images referenced by the
  // markdown (relative paths resolved against the doc's folder) and gets a
  // data: URI back — WebKit never has to be allowed near file:// itself.
  imageData: async ({ src, dir }) => {
    if (!src) return null;
    let raw = src;
    try { raw = decodeURI(src); } catch { /* as written */ }
    if (!raw.startsWith('/') && !dir) return null;
    const mime = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
    }[ext(raw)];
    if (!mime) return null;
    // A leading / goes through the project's image root first (see
    // resolveTarget); a plain path resolves against the document as always.
    for (const p of resolveTarget(raw.replace(/^\.\//, ''), dir || '/', 'image', rootsOf())) {
      let bytes;
      try { bytes = await tjs.readFile(p); } catch { continue; }
      if (bytes.length > 8 * 1024 * 1024) return null;
      return { data: `data:${mime};base64,${toB64(bytes)}`, path: p };
    }
    return null;
  },

  // What the image viewer puts under the picture (its own size is measured
  // from the loaded image; the file's isn't knowable in the page).
  fileInfo: async ({ path }) => {
    try {
      const st = await tjs.stat(path);
      return { bytes: Number(st.size) || 0 };
    } catch { return null; }
  },

  // Preview links open in the default browser, never inside the app window.
  openExternal: ({ url }, app) => {
    if (!/^(https?:|mailto:)/i.test(String(url))) return false;
    app.shell.open(url);                   // not `open`: that's macOS only
    return true;
  },

  // A link that points at a FILE, followed. Markdown and pictures are things
  // Nib can show, so they open as a tab in the window that asked; everything
  // else — a PDF, a spreadsheet, a folder — is the system's business, which is
  // the honest answer for an editor that only knows one format.
  //
  // The page hands over the target as WRITTEN plus the document's folder, and
  // resolution happens here: only the backend knows the project and what its
  // settings say a leading `/` means.
  openLink: async ({ href, dir }, app, meta) => {
    const raw = String(href || '').trim();
    if (!raw) return { error: 'That link isn’t a file.' };
    if (!raw.startsWith('/') && !dir) return { error: 'Save the document first.' };
    let target = raw;
    try { target = decodeURI(raw); } catch { /* as written */ }
    const roots = rootsOf();
    // A link is a link — but one pointing at a picture may well have been
    // written against the picture root, so that reading is tried too.
    const kinds = IMAGES.has(ext(target)) ? ['image', 'link'] : ['link'];
    const tries = [...new Set(kinds.flatMap((k) => resolveTarget(target, dir || '/', k, roots)))];
    for (const path of tries) {
      let st;
      try { st = await tjs.stat(path); } catch { continue; }
      const e = ext(path);
      if (!st.isDirectory && (OPENABLE.has(e) || IMAGES.has(e))) {
        const win = await openDoc(app, path, { from: meta && meta.window });
        return { opened: win ? 'nib' : 'system', path };
      }
      app.shell.open(path);
      return { opened: 'system', path };
    }
    return { missing: true, tried: tries };
  },
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[n >> 18] + B64[(n >> 12) & 63]
         + (b === undefined ? '=' : B64[(n >> 6) & 63])
         + (c === undefined ? '=' : B64[n & 63]);
  }
  return out;
}

// …and back, for an image the page re-encoded and handed us as base64.
function fromB64(s) {
  const clean = String(s).replace(/^data:[^,]*,/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, acc = 0, bits = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
  }
  return out.subarray(0, o);
}

// -------------------------------------------------------------------- events

// A window is gone (red ✗ or programmatic). No veto exists — so this is
// where dying dirty becomes a draft instead of a loss.
export function onWindowClosed(id, app) {
  if (id === HELP_WIN) { helpOpen = false; return; }
  const w = wins.get(id);
  if (!w) return;                            // 'main' just hides (hideOnClose)
  // EVERY tab in it, not just the one that was showing — a window closed with
  // six documents open owes you six drafts.
  let drafted = false;
  for (const d of sheetsOf(id)) {
    if (typeof d.liveText === 'string' && d.liveText !== d.savedText) {
      app.store.set(draftKey(d), { text: d.liveText, at: Date.now(), path: d.path });
      drafted = true;
    }
    sheets.delete(d.id);
  }
  wins.delete(id);
  if (lastDocWin === id) lastDocWin = [...wins.keys()].pop() || null;
  if (drafted) paintWelcome(app);
  syncWelcome(app);                          // last window gone -> Welcome returns
}

// Finder: double-click, "Open With", Dock drop. Works cold-start too.
export function onOpenFiles(paths, app) {
  api.openPaths({ paths }, app);
}

// 'Welcome' needs no page state, so it's handled backend-side; everything
// else lands in whichever page has focus (they gate on document.hasFocus()).
export function onMenu(id, app) {
  if (id === 'welcome') app.show();
  if (id === 'help:markdown') api.openHelp(null, app);
  if (id === 'help:example') api.openExample(null, app);
  if (id.startsWith('appear:')) api.setAppearance({ appearance: id.slice(7) }, app);
  if (id.startsWith('pw:')) api.setPref({ key: 'width', value: id.slice(3) }, app);
  if (id === 'opt:captions') api.setPref({ key: 'captions', value: !effPrefs().captions }, app);
  if (id === 'opt:center') api.setPref({ key: 'center', value: !effPrefs().center }, app);
  if (id === 'opt:zoom') api.setPref({ key: 'zoom', value: !effPrefs().zoom }, app);
  if (id === 'opt:linkTabs') api.setPref({ key: 'linkTabs', value: !effPrefs().linkTabs }, app);
  // New Window is answered here and ONLY here: a blank document in a window of
  // its own, whatever is open elsewhere. The pages used to answer it too,
  // which meant a focused document window opened two.
  if (id === 'newwindow') api.newWindow(null, app);
  if (id === 'closefolder') api.closeFolder(null, app);
  if (id === 'projsettings') api.setProjectSettings({ on: !useProjectSettings }, app);
  if (id === 'refreshfolder') api.refreshFolder(null, app);

  // Open Recent. A file joins the window that had the keyboard, as a tab —
  // the same thing clicking it in the file tree does.
  if (id.startsWith('rf:')) api.openFolder({ path: id.slice(3) }, app);
  if (id.startsWith('rd:')) openDoc(app, id.slice(3), { from: lastDocWin }).catch(() => {
    app.push('toast', { text: 'Couldn’t open ' + base(id.slice(3)) });
  });
  if (id === 'recent:clear') clearRecents(app);
  // 'default-md' is answered by the focused PAGE (makeDefaultUI in
  // updates.js) — the answer is a dialog either way, and dialogs are page-side.
}

async function clearRecents(app) {
  await app.store.set('recents', []);
  await app.store.set('folders', []);
  paintWelcome(app);
}

// ------------------------------------------------------------------ updates
//
// "Check for Updates…" is answered in a dialog by whichever window has focus
// (updates.js) — the backend only handles the unsolicited daily check, which
// gets a notification precisely because nobody asked for it.

export function onUpdateAvailable(info, app) {
  app.notify('Update available', 'v' + info.latest + ' is ready — use "Check for Updates…" to install.');
}

// A notification banner was clicked — reveal the file it announced.
export function onNotificationClick(id, app) {
  if (id.startsWith('reveal:')) {
    tjs.spawn(['open', '-R', id.slice(7)], { stdout: 'ignore', stderr: 'ignore' });
  }
}

// ------------------------------------------------------------------- menus
//
// The menu is REBUILT, not patched, whenever the recent lists change — tinyjs
// can patch an item but not add one, and Open Recent is a list. That makes
// setMenu the only writer of the whole bar, so everything it declares has to
// come from somewhere durable: menuState for the ticks, `project` and `prefs`
// for the rest.
//
// One bar, every window. macOS has always worked that way; on Windows and
// Linux tinyjs draws a copy of this menu inside each window, which is what
// the DOCUMENT windows need — they're the ones with something to Save. The
// Welcome screen is `main`, and it has none of that, so tinyjs.json turns its
// bar off there ("chrome": { "menu": false }, under windows/linux). Its four
// buttons already say everything a File menu would, and the accelerators keep
// working with no bar showing. macOS ignores the flag: a bar-less mac app
// isn't a thing.

// A name is enough for one file, but two READMEs from different folders are
// the normal case, so those get their parent folder's name after them.
function recentLabel(list, r) {
  const name = base(r.path);
  if (list.filter((x) => base(x.path) === name).length < 2) return name;
  const parent = base(r.path.slice(0, r.path.lastIndexOf('/'))) || '/';
  return name + ' — ' + parent;
}

// File ▸ Open Recent — the Welcome screen's two lists, for when it isn't on
// screen (which is whenever you have a document open).
function recentMenu() {
  const items = [];
  for (const r of menuState.folders) {
    items.push({ id: 'rf:' + r.path, label: recentLabel(menuState.folders, r) });
  }
  if (items.length && menuState.recents.length) items.push({ separator: true });
  for (const r of menuState.recents) {
    items.push({ id: 'rd:' + r.path, label: recentLabel(menuState.recents, r) });
  }
  if (!items.length) return [{ id: 'recent:none', label: 'Nothing Yet', enabled: false }];
  items.push({ separator: true }, { id: 'recent:clear', label: 'Clear Menu' });
  return items;
}

// Accelerators are AppKit keyEquivalents, so a lone letter is ⌘ and an
// UPPERCASE letter is ⌘⇧. A 'shift+x' string is passed through verbatim and
// silently does nothing, and punctuation ('?') doesn't bind either — both
// verified by keystroke, and both worth fixing upstream.
//
// { role: 'edit' } is the standard Edit menu (tinyjs 0.30.1). macOS installs
// it whether or not you ask — the webview needs its key equivalents — so
// naming the slot is how File gets to come first.
function menuSpec() {
  const p = effPrefs();
  const m = menuState;
  return [
    { title: 'File', items: [
      { id: 'new', label: 'New', key: 'n' },
      { id: 'newwindow', label: 'New Window', key: 'N' },
      { id: 'open', label: 'Open…', key: 'o' },
      { id: 'recent', label: 'Open Recent', submenu: recentMenu() },
      { separator: true },
      // ⌥⌘O, because ⌘⇧F is Find in Folder everywhere else in the world and
      // muscle memory beats mnemonics
      { id: 'openfolder', label: 'Open Folder…', key: 'alt+o' },
      { id: 'closefolder', label: 'Close Folder', enabled: !!project },
      { id: 'projsettings', label: 'Save Settings in Folder', checked: useProjectSettings },
      { separator: true },
      { id: 'default-md', label: 'Open .md Files with Nib…' },
      { separator: true },
      { id: 'save', label: 'Save', key: 's' },
      { id: 'saveas', label: 'Save As…', key: 'S' },
      { separator: true },
      { id: 'export', label: 'Export as HTML…', key: 'E' },
      // ⌘P belongs to Open Quickly in a project editor; printing a Markdown
      // file is the rarer act. Save as PDF wants ⌘⌥P, which tinyjs's menu
      // accelerators can't spell yet, so it goes without.
      { id: 'print', label: 'Print…', key: 'P' },
      { id: 'pdf', label: 'Save as PDF…' },
      { separator: true },
      { id: 'closetab', label: 'Close Tab', key: 'w' },
      { id: 'closewin', label: 'Close Window', key: 'W' },
    ]},
    { role: 'edit' },
    { title: 'Find', items: [
      { id: 'find', label: 'Find…', key: 'f' },
      { id: 'find:next', label: 'Find Next', key: 'g' },
      { id: 'find:prev', label: 'Find Previous', key: 'G' },
      { id: 'find:replace', label: 'Replace…', key: 'alt+f' },
      { separator: true },
      { id: 'find:folder', label: 'Find in Folder…', key: 'F', enabled: !!project },
    ]},
    { title: 'Format', items: [
      { id: 'fmt:bold', label: 'Bold', key: 'b' },
      { id: 'fmt:italic', label: 'Italic', key: 'i' },
      { id: 'fmt:code', label: 'Code', key: 'e' },
      { id: 'fmt:link', label: 'Link…', key: 'k' },
      { separator: true },
      { id: 'fmt:image', label: 'Insert Image…', key: 'I' },
      { id: 'fmt:imgopts', label: 'Image & Path Settings…' },
      { id: 'fmt:emoji', label: 'Insert Emoji…', key: 'J' },
    ]},
    { title: 'View', items: [
      ...VIEWS.map(([v, label, key]) => ({ id: 'view:' + v, label, key, checked: v === m.view })),
      { separator: true },
      { id: 'files', label: 'Files', key: 'B', checked: m.files },
      { id: 'outline', label: 'Outline', key: 'O', checked: m.outline },
      { id: 'editable', label: 'Edit in Preview', key: 'L',
        checked: m.editable, enabled: m.editableOk },
      { separator: true },
      { id: 'themes', label: 'Preview Theme', submenu:
        THEMES.map(([t, label]) => ({ id: 'theme:' + t, label, checked: t === m.theme })) },
      { id: 'pagewidth', label: 'Page Width', submenu:
        WIDTHS.map(([w, label]) => ({ id: 'pw:' + w, label, checked: w === p.width })) },
      { id: 'opt:captions', label: 'Image Captions', checked: p.captions },
      { id: 'opt:center', label: 'Center Images', checked: p.center },
      { id: 'opt:zoom', label: 'Click Image to Zoom', checked: p.zoom },
      { id: 'opt:linkTabs', label: 'Link Tabs', checked: p.linkTabs },
      { separator: true },
      { id: 'appearance', label: 'Appearance', submenu:
        APPEARANCES.map(([a, label]) => ({ id: 'appear:' + a, label, checked: a === m.appearance })) },
    ]},
    { title: 'Go', items: [
      { id: 'quickopen', label: 'Open Quickly…', key: 'p', enabled: !!project },
      { id: 'insertlink', label: 'Link to a File…', key: 'U', enabled: !!project },
      { id: 'renamefile', label: 'Rename File…', enabled: !!project },
      { separator: true },
      { id: 'refreshfolder', label: 'Refresh File Tree', key: 'R', enabled: !!project },
    ]},
    { title: 'Window', items: [
      { id: 'tab:next', label: 'Next Tab' },
      { id: 'tab:prev', label: 'Previous Tab' },
      { separator: true },
      { id: 'welcome', label: 'Welcome to Nib', key: '0' },
    ]},
    { title: 'Help', items: [
      { id: 'help:markdown', label: 'Markdown in Nib', key: 'H' },
      { id: 'help:example', label: 'Open Example Document' },
      { separator: true },
      { id: 'check-updates', label: 'Check for Updates…' },
    ]},
  ];
}

// Rebuilt only when the lists actually differ — saving a file bumps its
// recent entry on every ⌘S, and redeclaring the whole bar for a list that
// hasn't moved would be a lot of wire traffic for no visible change.
let menuSig = null;
async function refreshMenu(app) {
  menuState.recents = (await app.store.get('recents')) || [];
  menuState.folders = (await app.store.get('folders')) || [];
  const sig = JSON.stringify([menuState.folders, menuState.recents].map((l) => l.map((r) => r.path)));
  if (sig === menuSig) return;
  menuSig = sig;
  app.setMenu(menuSpec());
}

export async function init(app) {
  app.setHideOnClose(true);                  // red ✗ on Welcome hides, not quits
  // The Welcome screen is a real window: a long recents list is worth being
  // able to make room for, and the size it's left at is the size it reopens
  // at. The floor is the point below which the four buttons would wrap.
  app.setResizable(true);
  app.window('main').setMinSize(460, 380);
  const wel = await app.store.get('welcomeSize');
  if (wel && wel.width > 300 && wel.height > 200) app.setSize(wel.width, wel.height);

  const st = await app.getWinState();
  screen = st.screen;

  const appearance = (await app.store.get('appearance')) || 'system';
  const outline = (await app.store.get('outline')) || false;
  const editable = (await app.store.get('editable')) || false;
  prefs = await loadPrefs(app);
  images = cleanImages(await app.store.get('images'));
  const savedFlag = await app.store.get('useProjectSettings');
  useProjectSettings = savedFlag === null || savedFlag === undefined ? true : !!savedFlag;

  // A folder stays open between launches; if it has moved or gone, forget it.
  const lastFolder = await app.store.get('project');
  if (lastFolder && (await exists(lastFolder))) {
    const settings = await readProjectSettings(lastFolder);
    const walked = await walkTree(lastFolder);
    project = { root: lastFolder, name: base(lastFolder), settings, ...walked };
  } else if (lastFolder) {
    await app.store.delete('project');
  }

  // Seed the ticks before the bar is built — a restored project answers for
  // theme and view, so those come from the effective pair, not the store.
  menuState.theme = await effTheme(app);
  menuState.view = await effView(app);
  menuState.appearance = appearance;
  menuState.outline = outline;
  menuState.editable = editable;
  await refreshMenu(app);
}
