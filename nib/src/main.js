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

import { EXAMPLE_MD, EXAMPLE_SVG, EXAMPLE_NAME, EXAMPLE_IMAGE, EXAMPLE_STRIP } from './example.js';
import {
  loadActions, availability, startRun, cancelRun, summarize, whichBin,
  globalActionsPath, projectActionsPath, STARTER_GLOBAL, STARTER_PROJECT,
  appendActionText, checkJsSyntax,
} from './actions.js';
import { trustState, grantTrust, revokeTrust, listTrust } from './trust.js';
import { oembedGet } from './oembed.js';
import {
  LAYER_NAMES, readPath, writePath, clearPath, effective, resolveAll,
} from './layers.js';
import {
  aiConfig, setAiConfig, aiStatus, setKey, deleteKey, listModels, providerState,
} from './ai.js';

const dec = new TextDecoder();
const enc = new TextEncoder();

// Which machine this is. Used for the one menu that differs: macOS keeps
// Settings… in the application menu, where the platform puts it.
const IS_MAC = tjs.env.OS !== 'Windows_NT'
  && !/linux/i.test(globalThis.navigator?.platform ?? '');

const THEMES = [['paper', 'Paper'], ['ink', 'Ink'], ['typewriter', 'Typewriter'], ['night', 'Night']];
const VIEWS = [['edit', 'Editor Only', '1'], ['split', 'Split', '2'], ['preview', 'Preview Only', '3']];
const APPEARANCES = [['system', 'Match System'], ['light', 'Light'], ['dark', 'Dark']];
// How the rendered page reads: line length, and what a picture does. All
// app-wide (one store entry, pushed to every window), all applied by the page
// as a class or a custom property — see the note in doc.js.
const WIDTHS = [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide'], ['full', 'Full Width'],
                ['a4', 'A4'], ['letter', 'US Letter']];
const PREF_DEFAULTS = {
  width: 'normal', captions: false, center: false, zoom: false, linkTabs: false,
  edWidth: false,                // Page Width narrows the editor column too
  hrBreaks: false,               // `---` renders as a page break, not a rule
  allFiles: false,               // tree + ⌘P list files Nib can't open, too
  paged: false,                  // preview as sheets of paper on a desk
  // Preview ▸ Markdown Flavor — the extras over CommonMark. All on by default
  // (the GitHub set); the presets below flip them as a group.
  alerts: true,                  // > [!NOTE] callouts
  emojiCodes: true,              // :smile: shortcodes
  footnotes: true,               // [^1] references
  math: true,                    // $x$, $$…$$, ```math via Temml → MathML
  mermaid: true,                 // ```mermaid diagrams, themed to match
  // …and the ::: blocks — carousel, a download / pagelink card, oEmbed
  carousel: true, download: true, embed: true, pagelink: true,
  findColor: 'default',          // Find ▸ Find Highlight — see FIND_HI
  hc: false,                     // View ▸ High Contrast
  linkPath: false,               // Format ▸ Link Options — heading links carry
  linkSep: 'chev',               //   their trail (H1 › H2 › SMS), joined by this
  linkFrom: 'rel',               // …and how paths are written: rel | root | pin
};
const LINK_FROM = new Set(['rel', 'root', 'pin']);
const FIND_HI = [['default', 'Default'], ['yellow', 'Marker Yellow'],
                 ['green', 'Green'], ['pink', 'Pink'], ['orange', 'Orange']];
// Format ▸ Link Options separators — the id the pref stores, the glyph the
// label shows. The page owns the actual join strings (sepOf in doc.js).
const LINK_SEPS = [['chev', '›'], ['gt', '>'], ['slash', '/'],
                   ['dash', '—'], ['colon', ':']];
// What each preset means. GitHub is also the default; CommonMark renders
// nothing your plainest target won't; Nib is everything, page breaks
// included. hrBreaks rides along only where stated.
// The ::: blocks (carousel, download, embed, pagelink) ride with GitHub's
// set even though GitHub shows ::: as literal text — Nib has always rendered
// ::: containers regardless of flavor, and a preset that hid the new ones
// while note/tabs stayed up would be a stranger rule than this one.
const FLAVORS = {
  github: { alerts: true, emojiCodes: true, footnotes: true, math: true, mermaid: true,
    carousel: true, download: true, embed: true, pagelink: true },
  commonmark: { alerts: false, emojiCodes: false, footnotes: false, math: false, mermaid: false,
    carousel: false, download: false, embed: false, pagelink: false },
  nib: { alerts: true, emojiCodes: true, footnotes: true, math: true, mermaid: true,
    carousel: true, download: true, embed: true, pagelink: true },
};
// Where a pasted, dropped or picked picture lands, what it's called, and
// whether it's re-encoded on the way in. Same scope rule as the reading
// preferences: a project answers for itself, the app answers otherwise — but
// unlike those there's no menu of ticks, because the same dialog that sets
// them is the one a folder shows you the first time you paste into it.
const IMAGE_DEFAULTS = {
  dest: 'beside',        // beside | sub (a folder next to the doc) | root (project/<folder>)
  folder: 'images',
  naming: 'heading',     // heading | doc | stamp | custom (the template below)
  template: '',          // {doc}-{heading} and friends — expanded in the page
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
const NAMINGS = new Set(['heading', 'doc', 'stamp', 'custom']);
const OPTIMIZE = new Set(['off', 'webp', 'same']);
// Markdown under every name it has worn (mkd/mdwn/mdtxt are pure dialect
// spellings), the markdown-with-extras crowd (mdx/qmd/rmd/mdc render fine,
// their extras showing as literal text), and AsciiDoc — which renders
// through adoc.js's read-only mapping, never the editable preview.
// json opens too — as plain source with a code-block preview, which is what
// makes .nib/settings.json editable in place (File ▸ Edit Folder Settings…)
const OPENABLE = new Set(['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'mdwn', 'mdtxt', 'mdtext',
  'mdx', 'qmd', 'rmd', 'mdc', 'adoc', 'asciidoc', 'txt', 'json']);
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic', 'tiff']);
const RECENT_MAX = 8;
const FOLDER_MAX = 5;

const HELP_WIN = 'help';  // the Markdown reference window (one, shared)
const SET_WIN = 'settings';  // Settings — one, shared, and its own window
let helpOpen = false;
let settingsOpen = false;
let speechOk = false;   // does this build's webview have a speech recogniser?

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
// Windows that opted out of the app-wide folder (File ▸ New Window). They
// boot without the project and every project push skips them — until the
// window itself opens a folder, which takes it off the list.
const bareWins = new Set();
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

// Per-folder session memory — which files were open, in which windows, which
// was showing, and the sidebar widths. LOCAL store only, never
// .nib/settings.json: what travels with a folder is how it renders; whose
// tabs were open is this machine's business. Snapshots are taken on the
// positive events (open, close-tab, select, reorder) and deliberately NOT
// when a window closes — so quitting, or shutting the window, leaves the
// last working set behind for the next visit.
const fstateKey = (root) => 'fstate:' + root;
let restoringFolder = false;
async function saveFolderState(app) {
  if (!project || restoringFolder) return;
  try {
    const windows = [];
    for (const [id, w] of wins) {
      if (bareWins.has(id) || w.closing) continue;
      const files = sheetsOf(id).filter((s) => s.path && !s.preview).map((s) => s.path);
      if (!files.length) continue;
      const act = sheets.get(w.active);
      windows.push({ files, active: (act && act.path) || files[0] });
    }
    const k = fstateKey(project.root);
    const cur = (await app.store.get(k)) || {};
    await app.store.set(k, { ...cur, windows });
  } catch { /* a missed snapshot is just a slightly staler memory */ }
}

// Search pins — folders that scope what search can see (⌘P, the @-picker,
// Find in Folder). A pin is 'all' | 'docs' | 'images' — what kind of file it
// covers. When the project keeps its own settings, the pins live in
// .nib/settings.json (root-relative, so they travel with the folder); with
// Save Settings in Folder off they fall back to the LOCAL folder state, next
// to the open tabs. `pinsOn` is the master switch and is ALWAYS local — off,
// the pins stay set but scope nothing, so a shared arrangement can be parked
// on this machine without unpinning it for everyone.
const PIN_KINDS = new Set(['all', 'docs', 'images']);
async function readPinState(app, root, tree, settings) {
  let saved = {};
  try { saved = (await app.store.get(fstateKey(root))) || {}; } catch { /* none */ }
  const fromNib = folderOwns(root) && settings && settings.pins;
  const raw = fromNib
    ? Object.fromEntries(Object.entries(settings.pins).map(([d, k]) =>
        [d.startsWith('/') ? d : root + '/' + d, k]))
    : (saved.pins || {});
  const dirs = new Set();
  (function walk(ns) {
    for (const n of ns) if (n.dir) { dirs.add(n.path); walk(n.kids); }
  })(tree);
  const pins = {};
  for (const [d, k] of Object.entries(raw)) {
    if (dirs.has(d) && PIN_KINDS.has(k)) pins[d] = k;  // moved or gone: unpinned
  }
  return { pins, pinsOn: saved.pinsOn !== false };
}

// Recheck the pins against a fresh tree or fresh settings — a refresh, a
// settings toggle, or the settings file itself being edited in a tab.
async function reloadPins(app) {
  if (!project) return;
  const { pins, pinsOn } = await readPinState(app, project.root, project.tree, project.settings);
  project.pins = pins;
  project.pinsOn = pinsOn;
}

// Which directories a search made from `docPath` may see, for files of `kind`
// ('docs' or 'images'). The closest pin above the document wins — pin two
// nested folders and the inner one answers for its own files. A document
// under no pin sees every pinned folder of that kind together, so pinning
// assets/ for pictures works from anywhere. No pins at all: the whole
// project (null).
function pinScope(kind, docPath) {
  if (!project || !project.pinsOn) return null;
  const dirs = Object.keys(project.pins || {})
    .filter((d) => project.pins[d] === 'all' || project.pins[d] === kind);
  if (!dirs.length) return null;
  const above = dirs.filter((d) => docPath && docPath.startsWith(d + '/'));
  if (above.length) return [above.sort((a, b) => b.length - a.length)[0]];
  return dirs;
}
const inScope = (scope, p) => !scope || scope.some((d) => p.startsWith(d + '/'));

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
  config: configKind(s.path),
});

// Is this file one of NIB'S OWN? The page treats those differently — it lays
// them out again on save and refuses to write a broken one — and it has no
// business working out where the data directory is to find out.
let dataDir = null;                      // filled in by init()
function configKind(path) {
  if (!path) return null;
  if (dataDir && path === dataDir + '/actions.json') return 'actions';
  if (/\/\.nib\/actions\.json$/.test(path)) return 'actions';
  if (/\/\.nib\/settings\.json$/.test(path)) return 'settings';
  return null;
}

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

async function openDocNow(app, path, { draftText, from, forceWindow, preview, bare, withFolder } = {}) {
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
      saveFolderState(app);
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
    saveFolderState(app);
    return from;
  }

  const id = 'doc' + seq++;
  s.win = id;
  wins.set(id, { active: s.id, order: [s.id] });
  // Before openWindow — the page's boot asks about it straight away. A window
  // opened FOR a single file is bare, folder or no folder: you asked for that
  // file, not a workspace (Welcome picks, Finder opens, the CLI). So is a new
  // blank one — ⌘N means "a document", and a window that arrives wearing a
  // folder you didn't ask it to open is the folder following you around.
  // Only the callers that say `withFolder` get the tree: Open Folder's own
  // README window and File ▸ New Window (Same Folder), which is what that item
  // is FOR. A tab joining an existing window above never gets here, so ⌘N
  // inside a project window is still a tab in the project.
  if (bare || !withFolder) bareWins.add(id);
  const { w, h } = await windowSize(app);
  const slot = opened++ % 7;
  const at = await placeWindow(app, from, slot, w, h);
  app.openWindow(id, { page: 'doc.html', title: s.name, size: `${w}x${h}`, ...at });
  lastDocWin = id;
  syncWelcome(app);
  if (path) bumpRecent(app, path);
  saveFolderState(app);
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
  // a JSON sheet locks the window to Editor Only and turns Format JSON on
  viewLock: false, jsonSheet: false,
  // …and whether the focused window has opted out of the folder (a bare
  // window): the menu bar is app-wide, the folder is not. True until a
  // folder window says otherwise — the Welcome screen has no folder even
  // when one is remembered from last launch.
  bare: true,
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
  app.updateMenuItem('opt:edWidth', { checked: !!p.edWidth });
  app.updateMenuItem('opt:captions', { checked: !!p.captions });
  app.updateMenuItem('opt:center', { checked: !!p.center });
  app.updateMenuItem('opt:zoom', { checked: !!p.zoom });
  app.updateMenuItem('opt:linkTabs', { checked: !!p.linkTabs });
  app.updateMenuItem('opt:hrBreaks', { checked: !!p.hrBreaks });
  app.updateMenuItem('opt:allFiles', { checked: !!p.allFiles });
  app.updateMenuItem('opt:math', { checked: !!p.math });
  app.updateMenuItem('opt:mermaid', { checked: !!p.mermaid });
  for (const k of ['carousel', 'download', 'embed', 'pagelink']) {
    app.updateMenuItem('opt:' + k, { checked: !!p[k] });
  }
  app.updateMenuItem('opt:alerts', { checked: !!p.alerts });
  app.updateMenuItem('opt:emojiCodes', { checked: !!p.emojiCodes });
  app.updateMenuItem('opt:footnotes', { checked: !!p.footnotes });
  app.updateMenuItem('opt:hc', { checked: !!p.hc });
  for (const [v] of FIND_HI) app.updateMenuItem('fh:' + v, { checked: v === p.findColor });
  app.updateMenuItem('opt:paged', { checked: !!p.paged });
  app.updateMenuItem('opt:linkPath', { checked: !!p.linkPath });
  for (const [v] of LINK_SEPS) app.updateMenuItem('ls:' + v, { checked: v === p.linkSep });
  for (const v of LINK_FROM) app.updateMenuItem('lf:' + v, { checked: v === p.linkFrom });
}

// The live copy — read once in init(), so a menu toggle knows what it's
// toggling without a round trip to the store.
// The app-wide layer, held in memory so resolution is synchronous: it is read
// on every menu build and every settings answer, and an await per key turned
// a simple merge into a fan of promises.
let myTheme = 'paper';
let myView = 'split';
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
  // the template becomes a filename after the page expands it, so path
  // characters can't survive it — the page slugs the variables, this catches
  // what was typed between them
  o.template = String(o.template || '').replace(/[/\\:]+/g, '-').trim().slice(0, 80);
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
// How big the whole interface is drawn — every window, one number, remembered.
// The page applies it as CSS `zoom` on the root (zoom.js); the backend owns the
// value so the documents, the Welcome screen and the help window agree.
const ZOOM_STEPS = [0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];
let uiZoom = 1;
// Which settings are the PROJECT'S — and which are simply yours. The test:
// does it change the bytes written into committed files, or mirror what the
// project's target platform renders? Then it belongs to the folder and may
// live in `.nib` — markdown flavour (a vitepress site and a GitHub wiki
// render different things), how links are written, where images land, pins.
// Everything else — appearance, theme, view, widths, contrast — is how the
// EDITOR feels, which is personal: those keys are never read from a folder
// and never written into one. A `.nib` from the old everything-is-layerable
// format may still hold them; they are ignored, not errors.
const PROJECT_PREFS = ['alerts', 'emojiCodes', 'footnotes', 'math', 'mermaid',
  'carousel', 'download', 'embed', 'pagelink',
  'hrBreaks', 'linkPath', 'linkSep', 'linkFrom'];
const isProjectPath = (path) => path === 'images' || path.startsWith('images.')
  || (path.startsWith('prefs.') && PROJECT_PREFS.includes(path.slice(6)));

let project = null;   // { root, name, settings, tree, files }

// File ▸ Save Settings in Folder. On (the default), a project's look lives in
// its own `.nib/settings.json`; off, Nib never reads or writes anything inside
// the folder you opened and the app-wide settings keep applying. Either way
// the directory is only ever created when a setting actually changes — opening
// a folder writes nothing.
// File ▸ Save Settings in Folder, now remembered PER FOLDER rather than once
// for all of them. `useProjectSettings` survives as the answer for a folder
// that has never been asked — so an install that had it off keeps it off, and
// ticking it for one repo no longer quietly opts in every other.
let useProjectSettings = true;
let folderFlags = {};                 // root -> bool, in the app's own store
const folderOwns = (root) =>
  (root && folderFlags[root] !== undefined ? !!folderFlags[root] : useProjectSettings);
const projectOwns = () => !!project && folderOwns(project.root);

// This folder's LOCAL layer: its settings on this machine only, never written
// inside the folder. Loaded with the project, kept beside it.
let localSettings = {};
const localKey = (root) => 'local:' + root;

// Only the keys a map actually defines, so a layer can't smuggle in a key the
// app doesn't know or a default it was never given.
const onlyKnown = (obj, defaults) => {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (k in defaults && v !== undefined) out[k] = v;
  return out;
};

// cleanImages fills every default, which is right for the RESOLVED settings
// and wrong for a layer — see readProjectSettings. This validates the keys
// that are present and keeps the rest absent.
const cleanPartialImages = (obj) => {
  const present = onlyKnown(obj, IMAGE_DEFAULTS);
  const full = cleanImages({ ...IMAGE_DEFAULTS, ...present });
  const out = {};
  for (const k of Object.keys(present)) out[k] = full[k];
  return out;
};

// A folder-shaped layer (the `.nib` file, or its this-machine-only twin in
// the store) may only carry PROJECT settings. Personal keys found there —
// old files from when everything was layerable, or hand-edits — are dropped
// here, once, so nothing downstream has to ask.
function onlyProjectSettings(raw) {
  const out = {};
  if (raw && raw.prefs) {
    const known = onlyKnown(raw.prefs, PREF_DEFAULTS);
    const kept = {};
    for (const k of PROJECT_PREFS) if (known[k] !== undefined) kept[k] = known[k];
    if (Object.keys(kept).length) out.prefs = kept;
  }
  if (raw && raw.images) {
    const im = cleanPartialImages(raw.images);
    if (Object.keys(im).length) out.images = im;
  }
  return out;
}

// The layers in play, low to high. A window with no folder gets one; a folder
// that isn't keeping its own settings gets two, since the local layer is
// exactly how you give such a folder different settings anyway.
function layerStack(bare) {
  const mine = { theme: myTheme, view: myView, prefs, images };
  if (!project || bare) return [{ name: 'mine', data: mine }];
  return [
    { name: 'mine', data: mine },
    { name: 'folder', data: projectOwns() ? (project.settings || {}) : {} },
    { name: 'local', data: localSettings || {} },
  ];
}

const resolved = (bare) => resolveAll(layerStack(bare),
  { prefDefaults: PREF_DEFAULTS, imageDefaults: IMAGE_DEFAULTS });

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
      // Dot-directories are noise — except this folder's own `.nib`, which is
      // Nib's half of the conversation: the settings and the actions that
      // travel with the folder. Hiding the two files the app tells you to edit
      // is the kind of tidiness that just makes people hunt.
      const ours = depth === 0 && e.name === '.nib' && e.isDir;
      if ((e.name.startsWith('.') && !ours) || IGNORE.has(e.name)) continue;
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

// ------------------------------------------------------------- heading index
//
// What the @-picker knows about the INSIDES of documents: the title a file
// answers to (frontmatter `title:`, else its first largest heading) and every
// heading with the anchor slug the renderer will give it. Built in the
// background when a folder opens — the same pooled read Find in Folder does
// per keystroke, so "index" is a grand word for milliseconds of work held in
// memory — then patched file-by-file on save and rebuilt on refresh/rename.
// Slugs mirror md.js's slugger exactly; a drifted slug is a link that opens
// the file but doesn't scroll.

const HEADS_EXTS = new Set(['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'mdwn', 'mdtxt',
  'mdtext', 'mdx', 'qmd', 'rmd', 'mdc']);
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;   // md.js's HEADING, verbatim

function extractHeads(text) {
  const lines = text.split('\n');
  const heads = [];
  let title = null;
  let i = 0;
  // frontmatter: only a fence on line one counts, like everywhere else
  if (lines[0] === '---') {
    for (let j = 1; j < Math.min(lines.length, 200); j++) {
      if (lines[j] === '---' || lines[j] === '...') {
        for (let k = 1; k < j; k++) {
          const m = /^title\s*:\s*(.+?)\s*$/i.exec(lines[k]);
          if (m) title = m[1].replace(/^(["'])(.*)\1$/, '$2');
        }
        i = j + 1;
        break;
      }
    }
  }
  const used = new Set();
  let fence = null;
  for (; i < lines.length; i++) {
    const l = lines[i];
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;   // the closer, loosely
      continue;
    }
    if (fence) continue;
    const m = HEADING_RE.exec(l);
    if (!m) continue;
    // the slugger, verbatim (md.js) — including the -2, -3 dedupe
    let s = m[2].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
    let slug = s, n = 2;
    while (used.has(slug)) slug = s + '-' + n++;
    used.add(slug);
    heads.push({ level: m[1].length, text: m[2], slug, line: i });
  }
  return { title, heads };
}

let headGen = 0;
async function buildHeadIndex(app) {
  if (!project) return;
  const gen = ++headGen;
  const root = project.root;
  const files = project.files.filter((f) => HEADS_EXTS.has(ext(f.name)));
  const out = {};
  let next = 0;
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
      const hx = extractHeads(text);
      if (hx.title || hx.heads.length) out[f.rel] = hx;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  if (!project || project.root !== root || gen !== headGen) return;  // a newer build won
  project.heads = out;
  pushHeads(app);
}

function pushHeads(app) {
  for (const id of wins.keys()) {
    if (!bareWins.has(id)) app.window(id).push('project-heads', project.heads);
  }
}

const settingsPath = (root) => root + '/.nib/settings.json';

async function readProjectSettings(root) {
  if (!folderOwns(root)) return {};
  try {
    const raw = JSON.parse(await readText(settingsPath(root)));
    // Deliberately NOT filled in with the defaults. This used to be
    // `{ ...PREF_DEFAULTS, ...out.prefs }`, which turned "the folder sets the
    // theme" into "the folder sets everything" — every key present, every key
    // overriding. A layer holds only what it was actually given (layers.js).
    // …and only the PROJECT'S keys: a theme or view in an old `.nib` file is
    // read past, because those are personal now (see PROJECT_PREFS).
    const out = onlyProjectSettings(raw);
    if (raw.pins !== undefined) out.pins = raw.pins;
    // pins are root-relative in the file (the file travels with the folder);
    // anything hand-written sloppily — trailing slash, unknown kind — is tidied
    // or dropped rather than let loose on the scoping
    if (out.pins && typeof out.pins === 'object' && !Array.isArray(out.pins)) {
      const pins = {};
      for (const [d, k] of Object.entries(out.pins)) {
        if (typeof d === 'string' && d && PIN_KINDS.has(k)) pins[d.replace(/\/+$/, '')] = k;
      }
      out.pins = pins;
    } else delete out.pins;
    return out;
  } catch { return {}; }
}

async function writeProjectSettings(app) {
  if (!projectOwns()) return;
  // makeDir, not mkdir — txiki has no `mkdir`, and the call was failing
  // silently into the catch below until the write hit ENOENT.
  try { await tjs.makeDir(project.root + '/.nib', { recursive: true }); } catch { /* there */ }
  await writeText(settingsPath(project.root), JSON.stringify(project.settings, null, 2) + '\n');
  refreshSettingsSheet(app);
}

// The settings file can be OPEN IN A TAB while a setting changes elsewhere —
// a pin from the tree, a theme from the menu. A clean tab catches up with the
// disk; a dirty one keeps the user's edit, which wins when they save.
function refreshSettingsSheet(app) {
  if (!project) return;
  const open = findSheetByPath(settingsPath(project.root));
  if (!open || open.kind !== 'doc' || open.liveText !== open.savedText) return;
  readText(open.path).then((text) => {
    if (text === open.savedText) return;
    open.savedText = text;
    open.liveText = text;
    app.window(open.win).push('sheet-text', { id: open.id, text });
    pushTabs(app, open.win);
  }).catch(() => { /* not written yet */ });
}

// What a window should actually use: the layers resolved, key by key
// (layers.js) — for a SCOPE. No argument means the folder answers (project
// payloads, roots); pass `bare` when the answer is for a window or the menu
// bar, because a bare window resolves to Mine alone. Forgetting the argument
// here was exactly how bare windows ended up wearing the folder's theme.
const effPrefs = (bare) => resolved(bare).prefs;
const effImages = (bare) => cleanImages(resolved(bare).images);

// Everything that only means something with a folder open. View ▸ Files is
// NOT in the list: with no folder the panel is how you pick one.
// The menu bar belongs to the app, the folder belongs to the window — so when
// the keyboard moves between a folder window and a bare one, the Actions menu
// is rebuilt for whichever is now in charge. Pages announce themselves through
// setView (on focus, and on every sheet they show), which is the one signal
// that reliably means "this window is the one now".
// Whether the folder is in charge RIGHT NOW, app-wide. One rule, used by the
// menu bar, the Settings window, and every write that has to pick a layer:
// the folder answers only while the window with the keyboard is IN it. Only
// the Welcome screen showing? Bare. The example document in front? Bare —
// its own sidebar says "No folder is open", and everything else must agree
// with that window rather than with a folder remembered in the store.
const appScopeBare = () =>
  !lastDocWin || !wins.has(lastDocWin) || bareWins.has(lastDocWin);

async function syncFocusScope(app) {
  const bare = appScopeBare();
  if (bare === menuState.bare) return;
  menuState.bare = bare;
  syncProjectMenu(app);     // the tree-driven items grey out with the tree
  // The ticks re-answer for the new scope. The windows are NOT re-pushed —
  // their values never depended on who has the keyboard, and a doc-view push
  // here would yank back a view mode someone toggled without persisting it.
  const scoped = resolved(bare);
  syncThemeMenu(app, scoped.theme);
  syncPrefsMenu(app, scoped.prefs);
  refreshMenu(app);         // …and a rebuild (menuSpec) agrees with them
  // the Settings window shows the layers of whatever scope is now in front
  if (settingsOpen) app.window(SET_WIN).push('settings-refresh', {});
}

// Two kinds of "needs a folder", and they are not the same question.
//
// APP-WIDE: Close Folder, Save Settings in Folder, New Window (Same Folder) —
// these are about the folder Nib has open, whichever window you happen to be
// looking at. A loose file's window can still close the folder, or ask for a
// window that has it.
//
// PER-WINDOW: everything that acts through the file TREE — Open Quickly, Link
// to a File…, Rename File…, Refresh File Tree, Find in Folder, and the
// folder's own settings file. A bare window has no tree (its panel says "No
// folder is open"), so those do nothing there and say so by greying out.
const FOLDER_APP = ['closefolder', 'newwindowsame'];
// quickopen is NOT here any more: it opens folder or no folder (the palette
// says "no folder" itself, and > commands work regardless)
const FOLDER_WINDOW = ['insertlink', 'renamefile', 'refreshfolder', 'find:folder'];

function syncProjectMenu(app) {
  const on = !!project;
  const here = on && !menuState.bare;
  for (const id of FOLDER_APP) app.updateMenuItem(id, { enabled: on });
  for (const id of FOLDER_WINDOW) app.updateMenuItem(id, { enabled: here });
  // the settings file is only Nib's to touch while the folder keeps settings —
  // and only from a window that is in that folder, like its actions file
  app.updateMenuItem('editsettings', { enabled: here && projectOwns() });
  // (the folder's actions item is added and removed with the folder itself —
  // see menuSpec — so there is nothing to enable here)
}

function projectPayload() {
  if (!project) return null;
  return {
    root: project.root, name: project.name,
    tree: project.tree, files: project.files, truncated: project.truncated,
    pins: project.pins, pinsOn: project.pinsOn, heads: project.heads,
    // what a leading / means here — the page writes root-mode links against it
    roots: { link: effImages().linkRoot || '', image: effImages().imageRoot || '' },
  };
}

// The folder is app-wide, but not every window wants it: bare windows get
// null where the rest get the payload. Only doc windows listen for 'project'.
function pushProject(app) {
  const payload = projectPayload();
  for (const id of wins.keys()) {
    app.window(id).push('project', bareWins.has(id) ? null : payload);
  }
}

async function loadProject(app, root) {
  const settings = await readProjectSettings(root);
  // same filter as the file: the local twin is folder-shaped too
  localSettings = onlyProjectSettings(await app.store.get(localKey(root)));
  const { tree, files, truncated } = await walkTree(root);
  const { pins, pinsOn } = await readPinState(app, root, tree, settings);
  project = { root, name: base(root), settings, tree, files, truncated, pins, pinsOn,
    heads: null };
  buildHeadIndex(app);        // in the background; 'project-heads' follows
  pushProject(app);
  syncProjectMenu(app);
  await pushEffective(app);
  await reloadActions(app);   // a folder brings its own buttons with it
  return projectPayload();
}

// Theme / view / reading options all switch together when a project opens or
// closes, so every window is told once, from one place.
// ------------------------------------------------------------- writing a layer
//
// One door for every setter, so "where does this go?" is answered once instead
// of in six copies of the same if/else.

// Where a change goes when the caller didn't say — which is every menu tick.
// It goes to the layer that currently PROVIDES the value, so a menu toggle
// always visibly changes what you are looking at. (Write "mine" while the
// folder overrides it and the tick would appear to do nothing, which is the
// worst possible answer.) Nothing set it yet: the folder if it keeps its own
// settings, else yours.
function defaultLayerFor(path) {
  // A personal setting has exactly one home, whatever is open.
  if (!isProjectPath(path)) return 'mine';
  // …a project one goes to the layer providing it, within the focused scope:
  // a tick made from a bare window is about YOUR settings and lands in
  // `mine`, never in a folder that window isn't in. Nothing set it yet: the
  // folder's own storage — the file when it keeps settings, the this-Mac
  // twin when it doesn't.
  const bare = appScopeBare();
  const from = effective(layerStack(bare), path).from;
  if (from) return from;
  if (bare || !project) return 'mine';
  return projectOwns() ? 'folder' : 'local';
}

async function persistMine(app, head) {
  if (head === 'theme') await app.store.set('theme', myTheme);
  else if (head === 'view') await app.store.set('view', myView);
  else if (head === 'prefs') await app.store.set('prefs', prefs);
  else if (head === 'images') await app.store.set('images', images);
}

async function writeSetting(app, layer, path, value) {
  const target = layer || defaultLayerFor(path);
  // a personal key in a folder-shaped layer would just be dropped on the
  // next load (onlyProjectSettings), so refuse it at the door instead
  if (target !== 'mine' && !isProjectPath(path)) return false;
  const head = path.split('.')[0];
  if (target === 'mine') {
    if (head === 'theme') myTheme = value;
    else if (head === 'view') myView = value;
    else writePath({ prefs, images }, path, value);   // the maps are shared, so this lands
    await persistMine(app, head);
  } else if (target === 'folder') {
    if (!projectOwns()) return false;
    writePath(project.settings, path, value);
    await writeProjectSettings(app);
  } else {
    if (!project) return false;
    writePath(localSettings, path, value);
    await app.store.set(localKey(project.root), localSettings);
  }
  return true;
}

// "Reset to inherited". Clearing `mine` puts the built-in default back, since
// there is nothing underneath it to fall through to.
async function clearSetting(app, layer, path) {
  const head = path.split('.')[0];
  if (layer === 'mine') {
    if (head === 'theme') myTheme = 'paper';
    else if (head === 'view') myView = 'split';
    else clearPath({ prefs, images }, path);
    await persistMine(app, head);
  } else if (layer === 'folder') {
    if (!project) return false;
    clearPath(project.settings, path);
    await writeProjectSettings(app);
  } else {
    if (!project) return false;
    clearPath(localSettings, path);
    await app.store.set(localKey(project.root), localSettings);
  }
  return true;
}

async function pushEffective(app) {
  // The menu ticks answer for the focused scope; each WINDOW keeps its own —
  // a bare window resolves to Mine alone, its folder siblings to all three
  // layers. One broadcast used to send the folder's answer everywhere, which
  // dressed the example document in the folder's theme while its own sidebar
  // said no folder was open.
  const scoped = resolved(appScopeBare());
  syncThemeMenu(app, scoped.theme);
  syncPrefsMenu(app, scoped.prefs);
  syncViewMenu(app, scoped.view);
  for (const id of wins.keys()) {
    const r = resolved(bareWins.has(id));
    const w = app.window(id);
    w.push('doc-theme', { theme: r.theme });
    w.push('doc-prefs', r.prefs);
    w.push('doc-view', { view: r.view });
  }
  // …and the Settings window re-reads the world rather than being sent it
  if (settingsOpen) app.window(SET_WIN).push('settings-refresh', {});
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

const LINKS = new Set(['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'mdwn', 'mdtxt', 'mdtext',
  'mdx', 'qmd', 'rmd', 'mdc', 'adoc', 'asciidoc']);
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
  const out = [];
  // A document under a PINNED folder may write /x meaning "from the pin"
  // (Format ▸ Link Options ▸ Paths from the Pinned Folder) — the language-
  // site pattern, where en/sms/index.md is /sms/index.md to everything in
  // en/. The closest pin's reading goes first; the configured root and the
  // literal path keep their meanings as fallbacks, so the mapping still only
  // adds a reading rather than taking one away. Pins count here even while
  // the search master-switch has them parked — where a link points shouldn't
  // change because search is momentarily unscoped.
  if (project && dir) {
    const above = Object.keys(project.pins || {})
      .filter((d) => dir === d || dir.startsWith(d + '/'))
      .sort((a, b) => b.length - a.length);
    for (const d of above) out.push(normPath(d + '/' + target));
  }
  if (roots) out.push(normPath(rootBase(roots, kind) + '/' + target));
  out.push(lit);
  return [...new Set(out)];
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
async function searchProject(app, re, replace, within) {
  const files = project.files.filter((f) => TEXTY.has(ext(f.name)) && inScope(within, f.path));
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

// ------------------------------------------------------------------ actions
//
// Two files, one list (actions.js loads them): yours, and the folder's. The
// set is rebuilt whenever either could have changed — a folder opening or
// closing, the "keep settings in the folder" switch, saving one of the files
// itself, or Actions ▸ Reload. Availability is worked out per REQUEST rather
// than cached, because it depends on what the asking window is showing: the
// same action is live in one window and greyed in the next.
let actions = { list: [], problems: [] };

async function reloadActions(app) {
  actions = await loadActions(app, project && project.root, projectOwns());
  warmActionIcons(app);
  await refreshMenu(app);
  app.push('actions', { count: actions.list.length, problems: actions.problems });
}

const findAction = (scope, id) =>
  actions.list.find((a) => a.scope === scope && a.id === id);

// ------------------------------------------------------------- ai approvals
//
// A tool asks mid-run, and the answer has to come from a person — which means
// the page, because that is where dialogs are. So the request goes out as a
// push and the promise waits here for `aiApprove` to come back. The decision
// is never made in the page's favour by default: a window that goes away, or
// a person who walks off, both end in "no" rather than in a hung run.
const aiAsks = new Map();
let askSeq = 0;
const ASK_PATIENCE = 5 * 60 * 1000;

function aiHostFor(app, win) {
  const target = () => (win && wins.has(win) ? app.window(win) : app);
  // One shape for every mid-run question: push the sheet, park on the
  // registry, and resolve `fallback` if nobody answers inside the patience
  // window — a sheet that outlives its reader must not hang the run.
  const askPage = (name, req, fallback) => new Promise((resolve) => {
    const askId = 'k' + (++askSeq);
    let done = false;
    const answer = (v) => { if (!done) { done = true; aiAsks.delete(askId); resolve(v); } };
    aiAsks.set(askId, answer);
    setTimeout(() => answer(fallback), ASK_PATIENCE);
    target().push(name, { askId, ...req });
  });
  return {
    ask: (req) => askPage('ai-approve', req, false),

    // ctx.prompt / ctx.confirm / ctx.alert — a js action talking to the
    // person mid-run (actions.js jsApi). An unanswered prompt is a cancel,
    // an unanswered confirm is a no, an unread alert just lets the run go on.
    promptUser: (req) => askPage('action-prompt', req, null),
    confirmUser: (req) => askPage('action-confirm', req, false),
    alertUser: (req) => askPage('action-alert', req, true),
    pickUser: (req) => askPage('action-pick', req, null),

    // Through the page, deliberately: applyText() is what output:"replace"
    // already uses, so the change is one ⌘Z away like everything else. A
    // model rewriting your document must not be the one edit undo can't see.
    applyDoc: async (text) => {
      if (!win || !wins.has(win)) throw new Error('no document window to write into');
      app.window(win).push('ai-apply', { text });
      const d = activeSheet(win);
      if (d) d.liveText = text;
      return true;
    },

    // create_action writes into YOUR file, as text, so its comments live.
    addAction: async (action) => {
      const path = globalActionsPath(app);
      let text = null;
      try { text = await readText(path); } catch { /* first one */ }
      const next = appendActionText(text, action);
      if (next === null) {
        throw new Error('your actions file isn’t in a shape I can add to — '
          + 'open Actions ▸ Manage Actions… and add it there');
      }
      await tjs.makeDir(path.replace(/\/[^/]*$/, ''), { recursive: true });
      await writeText(path, next);
      await reloadActions(app);
      return true;
    },
  };
}

// The window's own context, filled in with what only the backend knows: the
// folder, and the pinned folder that answers for this document (which is where
// a command runs unless the action says otherwise).
//
// A BARE window (File ▸ New Window, a file opened from Finder, the example
// document) has opted out of the app-wide folder — its tree says "No folder is
// open" — so for that window there is no folder here either. Anything else and
// the menu would offer a folder's actions to a window that is deliberately not
// in it.
function actionCtx(given = {}, bare) {
  const file = given.file ? tidyPath(given.file) : null;
  const root = project && !bare ? project.root : null;
  const scope = file && !bare ? pinScope('docs', file) : null;
  return {
    ...given, file, root,
    pin: (scope && scope.length === 1 ? scope[0] : null) || root || null,
  };
}

// Which window is asking, and has it opted out of the folder?
const isBare = (meta) => !!(meta && meta.window && bareWins.has(meta.window));

// The actions a given window may see: a bare window sees only your own.
const visibleActions = (bare) =>
  actions.list.filter((a) => !(bare && a.scope === 'project'));

// ------------------------------------------------------------ action icons
//
// An action's `icon` is a string in its file: usually an emoji, optionally an
// Iconify name like "mdi:rocket" (picked in Manage Actions ▸ the search
// button). The NAME is what travels — a folder's actions.json stays a couple
// of readable lines — and the drawing is fetched once from
// api.iconify.design, kept in the store, and handed to pages as inline SVG
// (window.nibActIcon draws it). Offline, an unfetched name renders as no
// icon at all, exactly as if the action hadn't picked one — never as the raw
// "mdi:rocket" text.
//
// Two caches on purpose: the store-backed one holds only icons an action
// actually USES (promoted on the next actions listing), the in-memory one
// holds search previews — so browsing sixty rockets doesn't write sixty
// bodies into the store for the one you picked.
const ICONIFY_API = 'https://api.iconify.design';
const isIconName = (s) => typeof s === 'string' && /^[a-z0-9-]+:[a-z0-9-]+$/.test(s);
let iconStore = null;                  // store-backed, mirrors 'iconcache'
const iconMem = {};                    // this run only — search previews
const iconMisses = new Set();          // failed once this run: don't re-ask
async function iconCacheLoad(app) {
  if (!iconStore) iconStore = (await app.store.get('iconcache')) || {};
  return iconStore;
}
const iconSync = (n) => (iconStore && iconStore[n]) || iconMem[n] || null;
// A body is trusted as far as a picture. Iconify serves plain path markup;
// anything that could script, load, or link out is refused whole rather
// than cleaned — these strings end up innerHTML'd into pages.
const iconSafe = (body) => typeof body === 'string' && body.length < 20000
  && !/<\s*(script|foreignObject|image|use|animate)\b|\bhref\s*=|\bon[a-z]+\s*=|javascript:/i
    .test(body);

// Resolve names to {body,width,height}, fetching what neither cache has.
// `persist` says these names are in USE (an actions file references them) —
// they land in the store; previews stay in memory.
async function iconResolve(app, names, persist) {
  const st = await iconCacheLoad(app);
  const uniq = [...new Set([].concat(names || []).filter(isIconName))];
  let dirty = false;
  if (persist) {
    for (const n of uniq) {
      if (!st[n] && iconMem[n]) { st[n] = iconMem[n]; dirty = true; }
    }
  }
  const need = uniq.filter((n) => !st[n] && !iconMem[n] && !iconMisses.has(n));
  const byPrefix = new Map();
  for (const n of need) {
    const [prefix, name] = n.split(':');
    byPrefix.set(prefix, [...(byPrefix.get(prefix) || []), name]);
  }
  let fetched = false;
  for (const [prefix, wants] of byPrefix) {
    try {
      const r = await fetch(ICONIFY_API + '/' + prefix + '.json?icons=' + wants.join(','));
      const j = await r.json();
      for (const name of wants) {
        const full = prefix + ':' + name;
        const ic = j && j.icons && j.icons[name];
        if (ic && iconSafe(ic.body)) {
          const rec = { body: ic.body,
            width: ic.width || j.width || 16, height: ic.height || j.height || 16 };
          if (persist) { st[full] = rec; dirty = true; } else iconMem[full] = rec;
          fetched = true;
        } else iconMisses.add(full);
      }
    } catch { for (const name of wants) iconMisses.add(prefix + ':' + name); }
  }
  if (dirty) await app.store.set('iconcache', st);
  const icons = {};
  for (const n of uniq) { const rec = iconSync(n); if (rec) icons[n] = rec; }
  return { icons, fetched };
}

// Fire-and-forget: make sure every icon the current actions use is cached,
// and tell the pages if anything new arrived — they re-ask actionsList and
// the icons appear. Never awaited from a listing, so a dead network can't
// hold a menu open.
function warmActionIcons(app) {
  const names = actions.list.map((a) => a.icon).filter(isIconName);
  if (!names.length) return;
  iconResolve(app, names, true)
    .then((r) => { if (r.fetched) app.push('actions', { count: actions.list.length }); })
    .catch(() => {});
}

async function actionRow(app, a, ctx, aiWhy) {
  const why = availability(a, ctx);
  const trust = await trustState(app, a);
  // Only worth a stat storm when the button would otherwise work
  let missing = false;
  if (!why && a.type === 'cli' && !a.shell) missing = !(await whichBin(a.run[0], a.path || []));
  return {
    scope: a.scope, id: a.id, label: a.label, type: a.type, needs: a.needs,
    output: a.output, stdin: a.stdin, save: a.save, confirm: a.confirm, trust,
    icon: a.icon, iconSvg: isIconName(a.icon) ? iconSync(a.icon) : null,
    description: a.description,
    toolbar: a.toolbar, selection: a.selection, asks: !!a.ask,
    key: keyOf('act:' + a.scope + ':' + a.id) || null,
    // is this action ABOUT a file? — what the file tree's right-click offers
    fileScoped: a.needs === 'file' || !!a.match,
    why: why || (missing ? a.run[0] + ' — not found' : null)
      || (a.type === 'ai' ? aiWhy : null),
    missing,
  };
}

// Why an AI action can't run right now, in the same one-line voice as "pandoc
// — not found". Asked ONCE per menu, not once per action: for the Apple
// provider it is a round trip to the launcher, and a folder with six prompts
// in it shouldn't make six of them.
async function aiUnavailable(app) {
  const c = await aiConfig(app);
  if (!c.enabled) return 'AI is off — Actions ▸ AI Settings…';
  const st = await providerState(app, c.provider);
  return st.ok ? null : (st.why || 'no AI provider is ready');
}

export const api = {
  // Every window boots here; meta.window says which one is asking.
  boot: async (_p, app, meta) => {
    const appearance = (await app.store.get('appearance')) || 'system';
    const outline = (await app.store.get('outline')) || false;
    const editable = (await app.store.get('editable')) || false;

    if (meta.window === HELP_WIN) {
      return { kind: 'help', appearance, theme: resolved(appScopeBare()).theme, zoom: uiZoom };
    }
    if (meta.window === SET_WIN) return { kind: 'settings', appearance, zoom: uiZoom };

    const d = activeSheet(meta.window);
    if (!d) {                                // the welcome window
      const list = (await app.store.get('recents')) || [];
      const recents = [];
      for (const r of list) recents.push({ ...r, exists: await exists(r.path) });
      const draft = await app.store.get('draft:untitled');
      return {
        kind: 'welcome', appearance, zoom: uiZoom, recents, folders: await recentFolders(app),
        untitledDraft: draft ? { at: draft.at } : null,
        // the one-time Introduction banner: gone for good once dismissed
        introSeen: !!(await app.store.get('introSeen')),
      };
    }

    // sidebar widths: the app-wide pair, with this folder's own on top
    const paneW = (await app.store.get('paneW')) || {};
    if (project && !bareWins.has(meta.window)) {
      const st = await app.store.get(fstateKey(project.root));
      if (st && st.paneW) Object.assign(paneW, st.paneW);
    }

    // A window resolves for ITSELF: bare means Mine alone, whatever folder
    // the rest of the app has open.
    const r = resolved(bareWins.has(meta.window));
    return {
      kind: 'doc', theme: r.theme, view: r.view, appearance, outline, editable,
      paneW, zoom: uiZoom,
      prefs: r.prefs, project: bareWins.has(meta.window) ? null : projectPayload(),
      sheet: sheetPayload(d), tabs: tabsPayload(meta.window),
    };
  },

  // ---------------------------------------------------------------- projects

  // The page owns the folder picker (dialogs are page-side), so it either
  // hands us a path or asks us to remember the last one on launch.
  openFolder: async ({ path: given, quiet }, app, meta) => {
    const path = tidyPath(given);
    if (!path) return null;
    try { if (!(await tjs.stat(path)).isDirectory) return null; } catch { return null; }
    // a bare window that opens a folder has changed its mind
    if (meta && meta.window) bareWins.delete(meta.window);
    await app.store.set('project', path);
    const p = await loadProject(app, path);
    await bumpRecentFolder(app, path);
    // A folder with no window to show it in is an invisible folder. If this
    // machine has been in it before, put back what was open — the remembered
    // windows, their tabs, the tab that was showing. Otherwise open the
    // README (or the first Markdown file at the root) so the tree has a home.
    if (!quiet && !wins.size) {
      let restored = false;
      const st = await app.store.get(fstateKey(path));
      if (st && Array.isArray(st.windows)) {
        restoringFolder = true;
        try {
          for (const wst of st.windows) {
            let win = null;
            for (const f of wst.files || []) {
              if (!(await exists(f))) continue;      // moved or gone: skipped
              win = await openDoc(app, f, win
                ? { from: win } : { forceWindow: true, withFolder: true });
              restored = true;
            }
            const act = win && wst.active && findSheetByPath(wst.active);
            if (act && act.win === win) {
              wins.get(win).active = act.id;
              app.window(win).push('show-sheet', sheetPayload(act));
              pushTabs(app, win);
            }
          }
        } finally { restoringFolder = false; }
      }
      if (!restored) {
        const top = project.files.filter((f) => f.kind === 'doc' && !f.rel.includes('/'));
        const pick = top.find((f) => /^readme\.(md|markdown|mdown|mkdn)$/i.test(f.name)) || top[0];
        if (pick) await openDoc(app, pick.path, { withFolder: true });
        else app.push('toast', { text: p.name + ' — no Markdown files at the top level' });
      }
    }
    // The scope may have just changed hands — a bare window that opened a
    // folder, or the folder's first window arriving — without any focus event
    // to say so. Re-answer the ticks and the Settings window now.
    await syncFocusScope(app);
    return p;
  },

  // ----------------------------------------------------------------- actions

  // What this window may run right now, in menu order: yours first, then the
  // folder's. Everything unavailable comes back too, with the reason — the ⚡
  // menu greys those rather than hiding them.
  actionsList: async ({ ctx } = {}, app, meta) => {
    const bare = isBare(meta);
    const c = actionCtx(ctx, bare);
    const seen = visibleActions(bare);
    warmActionIcons(app);        // icons land as a later 'actions' push
    const aiWhy = seen.some((a) => a.type === 'ai') ? await aiUnavailable(app) : null;
    const rows = [];
    for (const a of seen) rows.push(await actionRow(app, a, c, aiWhy));
    return {
      list: rows, problems: bare ? [] : actions.problems, root: c.root,
      // why the folder's own actions file might not be editable right now
      folderSettingsOff: !projectOwns(),
    };
  },

  // ::: embed — the page asking for a URL's oEmbed answer (oembed.js).
  oembedGet: async ({ url }) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { error: 'not a URL' };
    return oembedGet(url);
  },

  // Manage Actions vetting a js action's script before it saves: does it
  // parse? Nothing is executed — see checkJsSyntax.
  actionCheckJs: async ({ script }) => {
    const bad = checkJsSyntax(String(script ?? ''));
    return bad ? { error: bad.message, line: bad.line } : {};
  },

  // Manage Actions ▸ the icon search. Iconify's search wants a word, gives
  // back names; the bodies come along resolved so the grid can draw them.
  // Previews stay in the in-memory cache — see iconResolve.
  iconSearch: async ({ query }, app) => {
    const q = String(query || '').trim();
    if (!q) return { icons: [] };
    try {
      const r = await fetch(ICONIFY_API + '/search?query=' + encodeURIComponent(q)
        + '&limit=64');
      const j = await r.json();
      const names = ((j && j.icons) || []).filter(isIconName).slice(0, 60);
      const got = await iconResolve(app, names, false);
      return { icons: names.filter((n) => got.icons[n])
        .map((n) => ({ name: n, ...got.icons[n] })) };
    } catch {
      return { error: 'couldn’t reach api.iconify.design — is the network up?' };
    }
  },

  // Names to bodies, for the editor sheet's previews (the row list, the
  // field's swatch). Preview-grade: nothing is persisted here.
  iconGet: async ({ names }, app) => {
    const r = await iconResolve(app, [].concat(names || []).slice(0, 100), false);
    return { icons: r.icons };
  },

  // Start one. Returns a handle, not a result: output arrives as pushes, so a
  // long build and a fast formatter are the same shape (see startRun).
  //
  // Trust is answered HERE rather than in the page, because a page that could
  // decide it was trusted would be the whole hole this is meant to close. An
  // unapproved action comes back with what it would do, and the page asks.
  actionRun: async ({ scope, id, ctx, trust, confirmed, inputs }, app, meta) => {
    const bare = isBare(meta);
    const a = findAction(scope, id);
    if (!a || (bare && a.scope === 'project')) {
      return { error: bare && a ? 'this window has no folder open' : 'that action is gone — reload actions' };
    }
    const c = actionCtx(ctx, bare);
    const why = availability(a, c);
    if (why) return { error: why };

    // The form comes BEFORE the approval sheet, deliberately: the sheet's whole
    // job is to show the command that will actually run, and it can't do that
    // while half of it is still {branch}.
    if (a.ask && !inputs) {
      return { needsInput: { label: a.label, icon: a.icon,
        iconSvg: isIconName(a.icon) ? iconSync(a.icon) : null, ask: a.ask } };
    }
    if (inputs) c.inputs = inputs;

    const state = await trustState(app, a);
    const summary = summarize(a, c);
    if (state !== 'trusted' && trust !== 'once' && trust !== 'always') {
      return { needsTrust: { state, label: a.label, scope: a.scope, id: a.id, ...summary } };
    }
    if (trust === 'always') await grantTrust(app, a, summary.body);
    if (a.confirm && !confirmed) {
      return { needsConfirm: { label: a.label, ...summary } };
    }

    const win = meta && meta.window;
    const send = (name, payload) => {
      if (win && wins.has(win)) app.window(win).push(name, payload);
      else app.push(name, payload);
    };
    const started = await startRun(app, a, c, {
      onChunk: (p) => send('action-out', p),
      onDone: (p) => send('action-done', { ...p, label: a.label, output_mode: a.output }),
      aiHost: aiHostFor(app, win),
    });
    return { ...started, label: a.label, mode: a.output };
  },

  actionCancel: async ({ runId }) => cancelRun(runId),

  // ---------------------------------------------------------------- the ai
  //
  // Everything about AI lives in the app's own settings — never in a folder.
  // ai.js explains why at length; the short version is that a folder's
  // actions travel with a git clone, so an endpoint a folder could set would
  // be an endpoint a stranger could set.

  aiStatus: async (_p, app) => aiStatus(app),

  // Only a page knows whether its engine has a speech recogniser, and the
  // Settings window is a different page from the one that can answer. So the
  // document window reports it and the backend remembers.
  speechPossible: async ({ yes }) => { speechOk = !!yes; return true; },

  aiSet: async (patch, app) => {
    const c = await setAiConfig(app, patch || {});
    await refreshMenu(app);
    app.push('ai-config', { enabled: c.enabled, speech: c.speech });
    return aiStatus(app);
  },

  // The key never comes back out. It goes to the Keychain (or the store, when
  // the Keychain won't have it — the panel is told which, and says so).
  aiSetKey: async ({ provider, key }, app) => {
    const r = await setKey(app, provider, key);
    return { ...r, status: await aiStatus(app) };
  },
  aiForgetKey: async ({ provider }, app) => {
    await deleteKey(app, provider);
    return { ok: true, status: await aiStatus(app) };
  },

  aiModels: async ({ provider }, app) => listModels(app, provider),

  // "Does this actually work?" — the question every settings panel with a key
  // field in it should be able to answer without you writing a document to
  // find out.
  aiTest: async ({ provider }, app) => {
    try {
      const { generate } = await import('./ai.js');
      const r = await generate(app, {
        provider, prompt: 'Reply with exactly: ok', maxTokens: 32, tools: [],
      });
      return { ok: true, text: (r.text || '').trim().slice(0, 200), model: r.model };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  },

  // The page answering an approval sheet. The request was made by a tool
  // mid-run, so the answer arrives here and unblocks the promise it is waiting
  // on — the decision is the person's, and it is made where dialogs live.
  aiApprove: async ({ askId, ok }) => {
    const resolve = aiAsks.get(askId);
    if (!resolve) return false;
    aiAsks.delete(askId);
    resolve(!!ok);
    return true;
  },

  // …and answering a ctx.prompt / ctx.confirm / ctx.alert, where the answer
  // is a value rather than a yes. Absent means cancelled.
  actionAnswer: async ({ askId, value }) => {
    const resolve = aiAsks.get(askId);
    if (!resolve) return false;
    aiAsks.delete(askId);
    resolve(value === undefined ? null : value);
    return true;
  },

  // ⌘+ / ⌘− / ⌥⌘0 from any window, and View ▸ Zoom. dir 0 is "back to normal".
  zoomStep: async ({ dir }, app) => {
    const near = ZOOM_STEPS.reduce((best, z) =>
      (Math.abs(z - uiZoom) < Math.abs(best - uiZoom) ? z : best), ZOOM_STEPS[0]);
    const i = ZOOM_STEPS.indexOf(near);
    const next = dir === 0 ? 1
      : ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + (dir > 0 ? 1 : -1)))];
    if (next === uiZoom) return uiZoom;
    uiZoom = next;
    await app.store.set('zoom', uiZoom);
    app.push('ui-zoom', { zoom: uiZoom });     // every window, help included
    return uiZoom;
  },

  // The Settings window names a zoom rather than stepping to it; ⌘+ and ⌘−
  // still go through zoomStep, and both end in the same push.
  setZoom: async ({ zoom }, app) => {
    const next = Math.max(0.5, Math.min(3, +zoom || 1));
    if (next === uiZoom) return uiZoom;
    uiZoom = next;
    await app.store.set('zoom', uiZoom);
    app.push('ui-zoom', { zoom: uiZoom });
    return uiZoom;
  },

  // File ▸ Edit Folder Settings…, reachable from the Settings window too.
  editFolderSettings: async (_p, app) => (openSettingsFile(app), true),

  // output: "doc" — what the command printed, as a new untitled document.
  // Written as a fresh tab plus a text push rather than through makeSheet's
  // draft path, which would fly the "restored draft" banner over output that
  // was never a draft.
  newDocWith: async ({ text }, app, meta) => {
    const win = await openDoc(app, null, { from: meta && meta.window });
    const d = activeSheet(win);
    if (!d) return false;
    d.liveText = String(text || '');
    app.window(win).push('sheet-text', { id: d.id, text: d.liveText, saved: false });
    pushTabs(app, win);
    return true;
  },

  actionsReload: async (_p, app) => {
    await reloadActions(app);
    return { count: actions.list.length, problems: actions.problems };
  },

  // Editing actions is opening a file — this IS a text editor. The starter is
  // written the first time so the format is in front of you, not in a README.
  actionsEdit: async ({ scope }, app, meta) => {
    const p = scope === 'project'
      ? (projectOwns() && !isBare(meta) ? projectActionsPath(project.root) : null)
      : globalActionsPath(app);
    if (!p) return { error: 'no folder is open, or it isn’t keeping settings' };
    if (!(await exists(p))) {
      await tjs.makeDir(p.replace(/\/[^/]*$/, ''), { recursive: true });
      await writeText(p, scope === 'project' ? STARTER_PROJECT : STARTER_GLOBAL);
      if (scope === 'project') await api.refreshFolder(null, app);   // it's in the tree now
    }
    await openDoc(app, p, { from: lastDocWin });
    return { path: p };
  },

  // The editor sheet works on the FILE, not on a normalized copy of it: it
  // reads the text, edits the tree the page parsed, and writes the text back
  // (json.js keeps the comments through that round trip). So these two are
  // deliberately dumb — read bytes, write bytes — and everything clever about
  // the format stays in one place.
  actionsFile: async ({ scope }, app, meta) => {
    const path = scope === 'project'
      ? (projectOwns() && !isBare(meta) ? projectActionsPath(project.root) : null)
      : globalActionsPath(app);
    if (!path) return { error: 'no folder is open, or it isn’t keeping settings' };
    let text = null;
    try { text = await readText(path); } catch { /* not written yet */ }
    return {
      path, text, exists: text !== null, scope,
      starter: scope === 'project' ? STARTER_PROJECT : STARTER_GLOBAL,
      name: scope === 'project' ? (project ? base(project.root) : 'This Folder') : 'My Actions',
    };
  },

  actionsWrite: async ({ scope, text }, app, meta) => {
    const path = scope === 'project'
      ? (projectOwns() && !isBare(meta) ? projectActionsPath(project.root) : null)
      : globalActionsPath(app);
    if (!path || typeof text !== 'string') return { error: 'nowhere to write that' };
    const fresh = !(await exists(path));
    await tjs.makeDir(path.replace(/\/[^/]*$/, ''), { recursive: true });
    await writeText(path, text);
    // the file may be open in a tab — that tab is looking at what we just
    // replaced, so it catches up the same way the settings file does
    const open = findSheetByPath(path);
    if (open && open.liveText === open.savedText) {
      open.savedText = text;
      open.liveText = text;
      app.window(open.win).push('sheet-text', { id: open.id, text });
      pushTabs(app, open.win);
    }
    await reloadActions(app);
    if (fresh && scope === 'project') await api.refreshFolder(null, app);
    return { ok: true, path, problems: actions.problems };
  },

  // What has been approved, and taking it back.
  actionsTrusted: async (_p, app) => listTrust(app, project ? project.root : null),
  actionRevoke: async ({ key }, app) => {
    await revokeTrust(app, key);
    await reloadActions(app);
    return true;
  },

  closeFolder: async (_p, app) => {
    project = null;
    localSettings = {};
    await app.store.delete('project');
    pushProject(app);       // open tabs stay — only the tree and search go
    syncProjectMenu(app);
    paintWelcome(app);
    await pushEffective(app);
    await reloadActions(app);
    return true;
  },

  // Whether a project may keep its own settings. Turning it off doesn't delete
  // an existing .nib — it just stops Nib reading or writing one, and the
  // app-wide settings take over again immediately.
  // Per FOLDER now: ticking it for one repo no longer opts in every other one
  // you open. The old app-wide flag stays as the answer for a folder that has
  // never been asked, so nobody's existing setting changes meaning.
  setProjectSettings: async ({ on }, app) => {
    if (!project) {
      useProjectSettings = !!on;
      await app.store.set('useProjectSettings', useProjectSettings);
      app.updateMenuItem('projsettings', { checked: useProjectSettings });
      return true;
    }
    folderFlags[project.root] = !!on;
    await app.store.set('folderFlags', folderFlags);
    app.updateMenuItem('projsettings', { checked: !!on });
    if (project) {
      project.settings = await readProjectSettings(project.root);
      await reloadPins(app);              // .nib pins vs the local set
      await pushEffective(app);
      pushProject(app);
      syncProjectMenu(app);
    }
    // …and the folder's own actions go with it: off means Nib doesn't read
    // anything inside your folder, which includes its buttons
    await reloadActions(app);
    return true;
  },

  // Pin a folder for search, change what the pin covers, or take it off
  // (state null). The tree's badge and the context menu both land here.
  setPin: async ({ path, state }, app) => {
    if (!project || !path || (state && !PIN_KINDS.has(state))) return false;
    if (state) project.pins[path] = state;
    else delete project.pins[path];
    // touching a pin means you mean to use it — the master switch comes back on
    if (state) project.pinsOn = true;
    // the local copy is written either way — it's the fallback the moment
    // Save Settings in Folder goes off
    try {
      const k = fstateKey(project.root);
      const cur = (await app.store.get(k)) || {};
      await app.store.set(k, { ...cur, pins: project.pins, pinsOn: project.pinsOn });
    } catch { /* the pin still holds for this run */ }
    // …and when the project owns its settings, the pins go with the folder
    if (projectOwns()) {
      project.settings.pins = Object.fromEntries(
        Object.entries(project.pins).map(([d, s]) => [relOf(project.root, d), s]));
      await writeProjectSettings(app);
    }
    pushProject(app);
    return true;
  },

  // The master switch above the tree: pins keep their places, scope nothing.
  setPinsOn: async ({ on }, app) => {
    if (!project) return false;
    project.pinsOn = !!on;
    try {
      const k = fstateKey(project.root);
      const cur = (await app.store.get(k)) || {};
      await app.store.set(k, { ...cur, pinsOn: project.pinsOn });
    } catch { /* holds for this run */ }
    pushProject(app);
    return true;
  },

  // Find in Folder. The page sends a compiled pattern (source + flags) so the
  // bar and the folder agree on what the query means; we answer with the hits,
  // grouped by file, and how much we had to leave out.
  findInFolder: async ({ pattern, flags }, app, meta) => {
    if (!project) return { error: 'No folder is open.' };
    const re = buildRe(pattern, flags || 'g');
    if (!re) return { error: 'That isn’t a valid pattern.' };
    const t = Date.now();
    // pinned folders narrow this too — the panel names the scope it searched
    const scope = pinScope('docs', (activeSheet(meta && meta.window) || {}).path);
    const r = await searchProject(app, re, null, scope);
    return { ...r, root: project.root, ms: Date.now() - t,
      pinned: scope ? scope.map((d) => d.slice(project.root.length + 1) + '/') : null };
  },

  // The same search, writing. Files with unsaved changes are left alone and
  // named back — replacing under a buffer you're editing would lose the edit.
  replaceInFolder: async ({ pattern, flags, replace }, app, meta) => {
    if (!project) return { error: 'No folder is open.' };
    const re = buildRe(pattern, flags || 'g');
    if (!re) return { error: 'That isn’t a valid pattern.' };
    // the same scope the search showed — a replace must never reach further
    // than the results the confirm dialog counted
    const scope = pinScope('docs', (activeSheet(meta && meta.window) || {}).path);
    const r = await searchProject(app, re, String(replace ?? ''), scope);
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
    await reloadPins(app);                // a pinned folder may have gone
    buildHeadIndex(app);                  // …and files may have come
    pushProject(app);
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
    // the heading index follows the save — one file, not a rebuild
    if (project && project.heads && d.path.startsWith(project.root + '/')
        && HEADS_EXTS.has(ext(d.path))) {
      const rel = relOf(project.root, d.path);
      const hx = extractHeads(text);
      if (hx.title || hx.heads.length) project.heads[rel] = hx;
      else delete project.heads[rel];
      pushHeads(app);
    }
    // saving THE SETTINGS FILE is changing the settings — the folder takes
    // the edit the moment it lands, same as any change made from a menu
    if (projectOwns() && d.path === settingsPath(project.root)) {
      project.settings = await readProjectSettings(project.root);
      await reloadPins(app);
      await pushEffective(app);
      pushProject(app);
    }
    // …and the same for either actions file: edit a button, save, press it.
    // Whatever couldn't be made sense of goes back to the page as warnings —
    // the JSON parsed, so this is the other half: an entry with no `run`, an
    // unknown type, two actions claiming one id.
    let actionProblems = null;
    if (d.path === globalActionsPath(app)
      || (project && d.path === projectActionsPath(project.root))) {
      await reloadActions(app);
      actionProblems = actions.problems;
    }
    return { ok: true, id: d.id, path: d.path, name: d.name, actionProblems };
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
    saveFolderState(app);
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
      // A window outlives its last document: closing the file leaves a fresh
      // Untitled behind — with a folder open the window is where the tree
      // lives, and losing it because you closed a file would be rude. Only a
      // ⌘W on that empty untitled (no path, nothing typed) closes the window.
      if (d.path || String(d.liveText || '').trim()) {
        const s = await makeSheet(app, null);
        s.win = meta.window;
        w.order.push(s.id);
        w.active = s.id;
        pushTabs(app, meta.window);
        saveFolderState(app);
        return { closed: true, sheet: sheetPayload(s) };
      }
      // closing the WINDOW is not a snapshot trigger: the folder remembers
      // what was open in it, and reopening the folder brings it back
      w.closing = true;
      app.window(meta.window).close();
      return { closed: true, window: true };
    }
    // the neighbour on the right, or the new last one
    if (w.active === d.id) w.active = w.order[Math.min(idx, w.order.length - 1)];
    const next = sheets.get(w.active);
    pushTabs(app, meta.window);
    saveFolderState(app);
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
    saveFolderState(app);
    return true;
  },

  // The window was resized — remember it, so the next one opens like this
  // one. Measured HERE, not in the page: the page's innerWidth/innerHeight
  // are CSS pixels, which UI zoom divides — a zoomed window that saved its
  // own numbers and had them restored as content units came back smaller by
  // the zoom factor every launch. getState and setSize speak the same
  // content units, so this round-trips exactly.
  rememberSize: async (_p, app, meta) => {
    const st = await app.window((meta && meta.window) || 'main').getState();
    if (!st || st.fullscreen || st.minimized || !(st.width > 300) || !(st.height > 200)) return false;
    await app.store.set('winSize', { width: Math.round(st.width), height: Math.round(st.height) });
    return true;
  },

  // The Welcome screen keeps its own size — it's a different kind of window,
  // and inheriting a document window's 1180×900 would be absurd for it.
  rememberWelcomeSize: async (_p, app) => {
    const st = await app.getWinState();
    if (!st || st.fullscreen || st.minimized || !(st.width > 300) || !(st.height > 200)) return false;
    await app.store.set('welcomeSize', { width: Math.round(st.width), height: Math.round(st.height) });
    return true;
  },

  // ⌘N: a new document joins the window you're in, like an opened file does.
  // File ▸ New Window is the way to get a window of its own.
  newDoc: async (_p, app, meta) => (await openDoc(app, null, { from: meta && meta.window }), true),
  // New Window is a clean slate — no folder, whatever is open elsewhere.
  // The (Same Folder) variant inherits the open one; the menu only offers it
  // while there is one.
  newWindow: async (_p, app) => (await openDoc(app, null, { forceWindow: true, bare: true }), true),
  // The one new window that DOES bring the folder — that is the whole item
  newWindowSame: async (_p, app) =>
    (await openDoc(app, null, { forceWindow: true, withFolder: true }), true),

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

  // Theme is PERSONAL — yours, everywhere (defaultLayerFor sends it to
  // `mine` whatever is open). The reading options below split: the flavour
  // and link-writing keys are the project's and follow PROJECT_PREFS; the
  // rest are yours like the theme.
  setTheme: async ({ theme, layer }, app) => {
    if (!THEMES.some(([t]) => t === theme)) return false;
    await writeSetting(app, layer, 'theme', theme);
    await pushEffective(app);
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
  setPref: async ({ key, value, layer }, app) => {
    if (!(key in PREF_DEFAULTS)) return false;
    if (key === 'width' && !WIDTHS.some(([w]) => w === value)) return false;
    if (key === 'findColor' && !FIND_HI.some(([v]) => v === value)) return false;
    if (key === 'linkSep' && !LINK_SEPS.some(([v]) => v === value)) return false;
    if (key === 'linkFrom' && !LINK_FROM.has(value)) return false;
    const stringy = key === 'width' || key === 'findColor' || key === 'linkSep'
      || key === 'linkFrom';
    await writeSetting(app, layer, 'prefs.' + key, stringy ? value : !!value);
    await pushEffective(app);        // per-window: bare stays Mine's answer
    return true;
  },

  // A flavor preset is just several setPrefs at once, saved the same way
  // (project-owned when the folder keeps its settings, app-wide otherwise).
  setFlavor: async ({ flavor, layer }, app) => {
    const set = FLAVORS[flavor];
    if (!set) return false;
    // A preset is several setPrefs at once, and they must all land in the SAME
    // layer — resolving the target per key would scatter one click across
    // three of them.
    const target = layer || defaultLayerFor('prefs.math');
    for (const [k, v] of Object.entries(set)) await writeSetting(app, target, 'prefs.' + k, v);
    await pushEffective(app);
    return true;
  },

  // View mode is per-window; the menu's ticks follow the focused window
  // (pages re-assert on focus so the radio never drifts — which is also how
  // the backend learns which window has the keyboard).
  setView: async ({ view, persist, layer }, app, meta) => {
    if (!VIEWS.some(([v]) => v === view)) return false;
    if (meta && wins.has(meta.window)) lastDocWin = meta.window;
    await syncFocusScope(app);
    if (persist) await writeSetting(app, layer, 'view', view);
    syncViewMenu(app, view);
    // a persisted change moves a layer's contents, and Settings shows those
    if (persist && settingsOpen) app.window(SET_WIN).push('settings-refresh', {});
    return true;
  },

  // A JSON sheet has no preview worth switching to (the "preview" was the
  // source again, inside a code block), so the focused window says so and the
  // View menu's other two modes grey out with the buttons. Same channel
  // carries whether Format ▸ Format JSON is live.
  setViewLock: ({ on, json }, app) => {
    menuState.viewLock = !!on;
    menuState.jsonSheet = !!json;
    for (const [v] of VIEWS) {
      app.updateMenuItem('view:' + v, { enabled: !on || v === 'edit' });
    }
    app.updateMenuItem('fmt:json', { enabled: !!json });
    return true;
  },

  // The file tree is per-window too; its menu tick follows the focused one.
  // Never disabled: with no folder open the panel is how you choose one.
  setFilesPanel: ({ on }, app) => {
    menuState.files = !!on;
    app.updateMenuItem('files', { checked: !!on, enabled: true });
    return true;
  },

  // Sidebar widths are app-wide — drag one window's file tree and the next
  // window opens at that width — and remembered per folder on top, so each
  // project keeps its own. Existing windows keep theirs until reopened.
  setPaneWidth: async ({ pane, w }, app) => {
    if (pane !== 'files' && pane !== 'outline') return false;
    const n = Math.round(+w);
    if (!(n >= 120 && n <= 600)) return false;
    const cur = (await app.store.get('paneW')) || {};
    cur[pane] = n;
    await app.store.set('paneW', cur);
    if (project) {
      const k = fstateKey(project.root);
      const st = (await app.store.get(k)) || {};
      st.paneW = { ...st.paneW, [pane]: n };
      await app.store.set(k, st);
    }
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
  // ---------------------------------------------------------- the settings
  //
  // Everything the Settings window shows, in one answer. It is a VIEW over the
  // settings that already existed — the menu ticks, the image sheet, the
  // folder switch — rather than a second copy of them: every control in that
  // window calls the same api the menu item does, and the menu redraws because
  // the backend pushed. So the two can never disagree, and neither is the
  // "real" one.
  settingsAll: async (_p, app, meta) => {
    const d = activeSheet(meta && meta.window);
    // A BARE window (File ▸ New Window, a file from Finder, the example
    // document) has opted out of the app-wide folder — its tree says "No
    // folder is open" and the Actions menu drops the folder's buttons. The
    // folder section has to agree, or Settings is the one place in the app
    // still claiming a folder the window in front of you says it isn't in.
    // Settings is its own window now, so it asks the same question the menu
    // bar does: is the folder in charge of the window that WAS in front? A
    // launch that lands on Welcome, or an example document alone, answers no
    // even though last session's folder is still remembered in the store.
    const bare = meta && meta.window === SET_WIN ? appScopeBare() : isBare(meta);
    const stack = layerStack(bare);
    const r = resolved(bare);

    // Where every value came from, in one pass, so the window can label each
    // row without asking per row. `paths` is every setting the window draws.
    const paths = ['theme', 'view',
      ...Object.keys(PREF_DEFAULTS).map((k) => 'prefs.' + k),
      ...Object.keys(IMAGE_DEFAULTS).map((k) => 'images.' + k)];
    const from = {};
    for (const path of paths) {
      const e = effective(stack, path);
      if (e.from || e.set.length) from[path] = { from: e.from, set: e.set };
    }

    // The built-in defaults, so the window can tell "you changed this" from
    // "this happens to be written down". `mine` is the base layer and has no
    // layer under it, so every key it has ever been given is "set" there —
    // which made all twenty rows claim an override and meant nothing. On that
    // tab the honest question is whether the value differs from the default.
    const defaults = { theme: 'paper', view: 'split' };
    for (const [k, v] of Object.entries(PREF_DEFAULTS)) defaults['prefs.' + k] = v;
    for (const [k, v] of Object.entries(IMAGE_DEFAULTS)) defaults['images.' + k] = v;

    return {
      appearance: (await app.store.get('appearance')) || 'system',
      theme: r.theme,
      view: r.view,
      zoom: uiZoom,
      prefs: r.prefs,
      images: cleanImages(r.images),
      // which layers exist right now, and what each one actually holds
      layers: stack.map((l) => l.name),
      // …and which paths are the PROJECT's — the folder tab shows exactly
      // these; everything else only ever lives in `mine`
      projectKeys: [...PROJECT_PREFS.map((k) => 'prefs.' + k),
        ...Object.keys(IMAGE_DEFAULTS).map((k) => 'images.' + k)],
      // Mine's OWN answers, folder influence removed — what the Mine tab's
      // controls show and edit. Showing the folder's value in a control that
      // writes to Mine would be lying about what a change does.
      mine: (() => {
        const m = resolveAll(stack.filter((l) => l.name === 'mine'),
          { prefDefaults: PREF_DEFAULTS, imageDefaults: IMAGE_DEFAULTS });
        return { theme: m.theme, view: m.view, prefs: m.prefs,
          images: cleanImages(m.images) };
      })(),
      speechPossible: speechOk,
      defaults,
      from,
      ai: await aiStatus(app),
      // Which of the two files the answers are going into. A folder that owns
      // its settings is the difference between "my editor" and "this project",
      // and the window says which, at the top, always.
      folder: (project && !bare) ? {
        root: project.root, name: base(project.root),
        owns: projectOwns(), inFolder: projectOwns(),
        pinsOn: project.pinsOn !== false,
      } : null,
      doc: d ? { path: d.path || null, json: !!(d.path && /\.json$/i.test(d.path)) } : null,
    };
  },

  // Setting one value in one named layer, and taking it back out again —
  // what the Settings window's tabs and its ↺ reset control call. Everything
  // validating a value lives in the setters above, so this routes through
  // them rather than writing whatever the page sent.
  settingsSet: async ({ layer, path, value }, app) => {
    if (!LAYER_NAMES.includes(layer)) return { error: 'unknown layer' };
    // …and only a layer that exists right now: the folder tabs are gone from
    // the window when the scope is bare, so a write naming them is a stray.
    if (!layerStack(appScopeBare()).some((l) => l.name === layer)) {
      return { error: 'no folder is open' };
    }
    if (layer !== 'mine' && !isProjectPath(path)) {
      return { error: 'personal setting — it lives in Mine' };
    }
    if (path === 'theme') return api.setTheme({ theme: value, layer }, app);
    if (path === 'view') return api.setView({ view: value, persist: true, layer }, app);
    if (path.startsWith('prefs.')) {
      return api.setPref({ key: path.slice(6), value, layer }, app);
    }
    if (path.startsWith('images.')) {
      // ONE key into one layer. Building the whole object from the resolved
      // settings and diffing it back was how changing `dest` on the Mine tab
      // quietly copied the folder's other image answers into Mine.
      const k = path.slice(7);
      if (!(k in IMAGE_DEFAULTS)) return { error: 'unknown setting' };
      const v = cleanPartialImages({ [k]: value })[k];
      if (v === undefined) return { error: 'bad value' };
      await writeSetting(app, layer, path, v);
      pushProject(app);              // the payload carries the / roots
      if (settingsOpen) app.window(SET_WIN).push('settings-refresh', {});
      return true;
    }
    return { error: 'unknown setting' };
  },

  // Clear a whole layer. Worth its own door because every settings file
  // written before layers existed holds all twenty keys — they were filled in
  // with the defaults on load and saved back — so a folder that only ever
  // chose a theme now honestly reports that it overrides everything. This is
  // how you say "actually, just the theme" without hand-editing JSON.
  settingsClearLayer: async ({ layer }, app) => {
    if (!LAYER_NAMES.includes(layer)) return { error: 'unknown layer' };
    if (!layerStack(appScopeBare()).some((l) => l.name === layer)) {
      return { error: 'no folder is open' };
    }
    const paths = ['theme', 'view',
      ...Object.keys(PREF_DEFAULTS).map((k) => 'prefs.' + k),
      ...Object.keys(IMAGE_DEFAULTS).map((k) => 'images.' + k)];
    for (const path of paths) await clearSetting(app, layer, path);
    await pushEffective(app);
    pushProject(app);
    return true;
  },

  settingsClear: async ({ layer, path }, app) => {
    if (!LAYER_NAMES.includes(layer)) return { error: 'unknown layer' };
    if (!layerStack(appScopeBare()).some((l) => l.name === layer)) {
      return { error: 'no folder is open' };
    }
    await clearSetting(app, layer, path);
    await pushEffective(app);
    pushProject(app);
    return true;
  },

  imageOptions: async (_p, app, meta) => {
    const d = activeSheet(meta && meta.window);
    // A bare window is not in the folder, however close their paths are: its
    // images follow Mine's answers and its scope is its own directory.
    const inProject = !!project && !isBare(meta);
    const scope = inProject ? project.root
      : (d && d.path ? d.path.slice(0, d.path.lastIndexOf('/')) : null);
    const asked = (await app.store.get('imgAsked')) || [];
    return {
      settings: effImages(isBare(meta)), scope, project: inProject,
      root: inProject ? project.root : null,
      inFolder: inProject && projectOwns(),   // File ▸ Save Settings in Folder
      ask: !!scope && !asked.includes(scope),
    };
  },

  // Same scope rule as the theme: a project keeps its own answer, the app
  // keeps the answer for everywhere else. `scope` only marks the folder as
  // asked — cancelling the dialog sends it without settings, so a folder never
  // asks twice whatever you did with the question.
  setImageOptions: async ({ settings, scope, layer }, app, meta) => {
    const bare = isBare(meta);
    if (settings) {
      // The sheet hands back a whole settings object, so only the keys that
      // actually DIFFER from what is inherited are written — otherwise saving
      // the sheet once would pin all ten of them to one layer, which is the
      // wholesale-replacement bug this refactor exists to remove.
      const s = cleanImages(settings);
      const target = layer || defaultLayerFor('images.dest');
      const base = resolveAll(layerStack(bare).filter((l) =>
        LAYER_NAMES.indexOf(l.name) < LAYER_NAMES.indexOf(target)),
      { prefDefaults: PREF_DEFAULTS, imageDefaults: IMAGE_DEFAULTS }).images;
      for (const k of Object.keys(IMAGE_DEFAULTS)) {
        if (s[k] === base[k]) await clearSetting(app, target, 'images.' + k);
        else await writeSetting(app, target, 'images.' + k, s[k]);
      }
      pushProject(app);          // the payload carries the / roots
    }
    if (scope) {
      const asked = (await app.store.get('imgAsked')) || [];
      if (!asked.includes(scope)) await app.store.set('imgAsked', [...asked, scope].slice(-60));
    }
    return { settings: effImages(bare) };
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

    const s = effImages(isBare(meta));
    const docDir = d.path.slice(0, d.path.lastIndexOf('/'));
    let dir = docDir;
    if (s.dest === 'sub') dir = docDir + '/' + s.folder;
    else if (s.dest === 'root' && !isBare(meta) && project
      && d.path.startsWith(project.root + '/')) {
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

  // Overwrite a picture with the bytes the page re-encoded (the tree's
  // Optimize Picture…, single or batch). Same trust boundary as saveImage:
  // the page hands over bytes, the destination is checked HERE — only a file
  // that's already an image inside the open folder can be replaced. A format
  // change renames the file (shot.png → shot.webp), and everything a rename
  // drags along — open sheets, links in other documents — follows the same
  // paths a tree rename does: sheets are patched here, links are the page's
  // scanRefs/updateRefs question with the { from } handed back.
  optimizeWrite: async ({ path, data, format }, app) => {
    if (!project || !path || !path.startsWith(project.root + '/')) {
      return { error: 'That isn’t in this folder.' };
    }
    const e = String(format || '').toLowerCase();
    if (!data || !IMAGES.has(e) || !IMAGES.has(ext(path))) return { error: 'Not an image.' };
    if (!(await exists(path))) return { error: 'That file is gone.' };

    let next = path;
    if (e !== ext(path)) {
      const stem = path.replace(/\.[^.]*$/, '');
      next = stem + '.' + e;
      for (let n = 2; await exists(next); n++) next = stem + '-' + n + '.' + e;
    }
    await tjs.writeFile(next, fromB64(data));
    if (next !== path) {
      await tjs.remove(path).catch(() => {});
      const touched = new Set();
      for (const s of sheets.values()) {
        if (s.path !== path) continue;
        s.path = next;
        s.name = base(next);
        touched.add(s.win);
        app.window(s.win).push('sheet-path', { id: s.id, path: s.path, name: s.name });
      }
      for (const w of touched) pushTabs(app, w);
    }
    await api.refreshFolder(null, app);
    return { ok: true, path: next, from: next !== path ? path : null };
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
      for (const [name, svg] of EXAMPLE_STRIP) await writeText(dir + '/' + name, svg);
      await writeText(path, EXAMPLE_MD);
      await app.store.delete('draft:' + path);       // a fresh copy, every time
    }
    // Joins the window that has the keyboard, like Open Recent — a fresh
    // window for a document about trying things out just splits attention.
    await openDoc(app, path, { from: lastDocWin });
    return { ok: true, path };
  },

  // The Welcome banner's ✕ (and its Read It — either way it has been seen).
  dismissIntro: async (_p, app) => {
    await app.store.set('introSeen', true);
    return true;
  },

  // ------------------------------------------------- palette and shortcuts

  // What > in the palette lists. Enabled items only: the palette runs
  // things, and a row that can't run is the menu's job to explain.
  commands: async () => commandList(false),

  // A palette pick, run EXACTLY like the menu click it stands for: the page
  // handles its half itself (same switch as tiny.menu.on) and this is the
  // backend's half — onMenu, verbatim.
  runCommand: async ({ id }, app) => {
    if (typeof id !== 'string') return false;
    onMenu(id, app);
    return true;
  },

  // Settings ▸ Shortcuts. Everything remappable with its current answer —
  // disabled items included, since a binding outlives the moment.
  keymapAll: async () => ({
    preset: keymapConf.preset,
    presets: KEYMAP_PRESETS,
    // non-zero is what the preset picker shows as "Custom" — edited keys make
    // the map yours, until choosing a preset starts it fresh
    // …counting only the MENU's keys: an action binding isn't a change to
    // any preset, so it doesn't push the picker into "Custom"
    customCount: Object.keys(keymapConf.custom || {})
      .filter((id) => !isActionCommand(id)).length,
    commands: commandList(true)
      .filter((c) => Object.prototype.hasOwnProperty.call(DEFAULT_KEYS, c.id)
        || isActionCommand(c.id))
      .map((c) => {
        const p = KEY_PRESETS[keymapConf.preset] || {};
        return {
          ...c, key: keyOf(c.id) || null,
          // the factory answer under the current preset — what ↺ goes back to
          def: (Object.prototype.hasOwnProperty.call(p, c.id)
            ? p[c.id] : DEFAULT_KEYS[c.id]) || null,
          // …and Nib's own answer, so the pane can say what a preset changes
          base: DEFAULT_KEYS[c.id] || null,
          custom: Object.prototype.hasOwnProperty.call(keymapConf.custom, c.id),
        };
      }),
  }),

  keymapSet: async ({ id, key }, app) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_KEYS, id) && !isActionCommand(id)) {
      return { error: 'unknown command' };
    }
    const k = key ? String(key) : null;
    // what AppKit accelerators can spell: ⌘x, ⌘⇧X (uppercase), ⌥⌘x, ⌘, —
    // anything else silently wouldn't bind, so it is refused out loud
    if (k !== null && !/^(alt\+)?[a-zA-Z0-9]$|^,$/.test(k)) {
      return { error: 'unsupported key' };
    }
    const p = KEY_PRESETS[keymapConf.preset] || {};
    const eff = Object.prototype.hasOwnProperty.call(p, id) ? p[id] : DEFAULT_KEYS[id];
    // choosing the factory answer back is FORGETTING the override, not
    // pinning it — so a later preset switch moves this key with the rest
    if ((k || null) === (eff || null)) delete keymapConf.custom[id];
    else keymapConf.custom[id] = k;
    await app.store.set('keymap', keymapConf);
    await refreshMenu(app);
    if (settingsOpen) app.window(SET_WIN).push('settings-refresh', {});
    return true;
  },

  keymapPreset: async ({ preset }, app) => {
    if (!Object.prototype.hasOwnProperty.call(KEY_PRESETS, preset)) {
      return { error: 'unknown preset' };
    }
    // A preset is a fresh start for the MENU's keys. Action bindings aren't
    // any preset's to give or take, so they ride across.
    const kept = Object.fromEntries(Object.entries(keymapConf.custom || {})
      .filter(([id]) => isActionCommand(id)));
    keymapConf = { preset, custom: kept };
    await app.store.set('keymap', keymapConf);
    await refreshMenu(app);
    if (settingsOpen) app.window(SET_WIN).push('settings-refresh', {});
    return true;
  },

  // Settings — one shared window, focused if it is already up. Deliberately
  // not a sheet: it opens from a document, from the Welcome screen, or from
  // nothing at all, and all three have to work.
  openSettings: (p, app) => {
    const section = (p && p.section) || 'general';
    if (settingsOpen) {
      const w = app.window(SET_WIN);
      w.restore();
      w.show();
      w.push('settings-section', { section });
      return true;
    }
    settingsOpen = true;
    app.openWindow(SET_WIN, {
      page: 'settings.html', title: 'Settings', size: '760x600',
    });
    // a fresh window is still booting; the page asks for its own state on
    // load, so this only has to steer it once it is listening
    setTimeout(() => {
      if (settingsOpen) app.window(SET_WIN).push('settings-section', { section });
    }, 500);
    return true;
  },

  // Manage Actions is a sheet in a DOCUMENT window (it edits the file the way
  // the editor does), so the Settings window asks for it rather than trying
  // to draw it itself.
  openActionEditor: async (_p, app) => {
    if (lastDocWin && wins.has(lastDocWin)) {
      app.window(lastDocWin).restore();
      app.window(lastDocWin).show();
      app.window(lastDocWin).push('manage-actions', {});
      return true;
    }
    const w = await openDoc(app, null, { forceWindow: true });
    app.window(w).push('manage-actions', {});
    return true;
  },

  // Markdown reference — one shared window, focused if it's already up.
  openHelp: (p, app) => {
    const at = p && p.at;
    if (helpOpen) {
      const w = app.window(HELP_WIN);
      w.restore();
      w.show();
      if (at) w.push('help-jump', { id: at });
      return true;
    }
    helpOpen = true;
    app.openWindow(HELP_WIN, {
      page: 'help.html', title: 'About Nib', size: '900x720',
    });
    // a fresh window is still booting; the page replays the last jump it
    // hears, so a short grace covers the race
    if (at) setTimeout(() => app.window(HELP_WIN).push('help-jump', { id: at }), 700);
    return true;
  },

  // File ▸ Install 'nib' Shell Command… — the `code .` gesture. Writes a tiny
  // shim named `nib` onto PATH; from then on `nib .` makes the terminal's
  // folder the project and `nib notes.md` opens the file (argv reaches
  // onOpenFiles → openPaths, which already speaks both verbs). What the shim
  // runs is per-platform:
  //
  //   macOS   `exec open -a <bundle>` — LaunchServices hands the paths to the
  //           RUNNING copy; exec'ing the bare backend would boot a second Nib
  //           (tinyjs's instance pipe is Windows/Linux-only).
  //   Windows nib.cmd runs the exe directly — it's GUI-subsystem, so the
  //           terminal gets its prompt back at once, and the instance pipe
  //           forwards to a running copy. The .cmd lands in <data>\bin, which
  //           is appended to the user PATH (new terminals see it).
  //   Linux   the exe under nohup/& — same pipe, and a cold-started app
  //           outlives the terminal that typed it. ~/.local/bin.
  //
  // The page owns the dialog (installCliUI in updates.js); this only computes
  // and writes, answering { status: 'ok' | 'dev' | 'cancelled', path?, note? }.
  installCli: async (_p, app) => {
    const exe = tjs.exePath;
    const win = tjs.env.OS === 'Windows_NT';
    const linux = !win && /linux/i.test(globalThis.navigator?.platform ?? '');
    const lead = '#!/bin/sh\n# Nib — `nib .` opens the folder as a project, `nib doc.md` the file.\n';

    if (!win && !linux) {
      const i = exe.indexOf('.app/Contents/MacOS/');
      let bundle = i < 0 ? null : exe.slice(0, i + 4);
      // dev runs from source and has no bundle — point the shim at the
      // installed copy instead of refusing outright
      if (!bundle && (await exists('/Applications/Nib.app'))) bundle = '/Applications/Nib.app';
      if (!bundle) return { status: 'dev' };
      const body = lead + 'exec open -a "' + bundle + '" "$@"\n';
      // Homebrew's bin is user-writable where it exists; /usr/local/bin is
      // the traditional spot but often belongs to root. Try in that order —
      // the failed write IS the writability probe.
      for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
        if (!(await exists(dir))) continue;
        try {
          await tjs.writeFile(dir + '/nib', enc.encode(body));
          await tjs.chmod(dir + '/nib', 0o755);
          return { status: 'ok', path: dir + '/nib' };
        } catch { /* not ours to write — try the next, or ask for an admin */ }
      }
      // no writable bin dir: stage the shim, then one authorization prompt
      // does the mkdir + install (the VS Code recipe)
      await tjs.makeDir(app.paths.data, { recursive: true });
      const tmp = app.paths.data + '/nib-cli';
      await tjs.writeFile(tmp, enc.encode(body));
      const sh = "mkdir -p /usr/local/bin && install -m 0755 '"
        + tmp.replace(/'/g, "'\\''") + "' /usr/local/bin/nib";
      const st = await tjs.spawn(['osascript', '-e',
        'do shell script "' + sh.replace(/[\\"]/g, '\\$&') + '" with administrator privileges'],
        { stdout: 'ignore', stderr: 'ignore' }).wait().catch(() => null);
      if (!st || st.exit_status !== 0 || st.term_signal) return { status: 'cancelled' };
      return { status: 'ok', path: '/usr/local/bin/nib' };
    }

    // Windows/Linux: a built app is the exe next to its launcher; anything
    // else (tinyjs dev runs the bare tjs runtime) has no stable target.
    const exeDir = exe.replace(/[\\/][^\\/]*$/, '');
    const bare = exe.slice(exeDir.length + 1).toLowerCase();
    if (bare === (win ? 'tjs.exe' : 'tjs')
      || !(await exists(exeDir + (win ? '/launcher.exe' : '/launcher')))) return { status: 'dev' };

    if (win) {
      const dir = app.paths.data + '\\bin';
      await tjs.makeDir(dir, { recursive: true });
      await tjs.writeFile(dir + '\\nib.cmd', enc.encode('@echo off\r\n"' + exe + '" %*\r\n'));
      // Already on PATH? The merged PATH this process inherited is good
      // enough to ask — a stale no just repeats an idempotent append.
      const have = (tjs.env.Path || tjs.env.PATH || '').toLowerCase()
        .split(';').includes(dir.toLowerCase());
      if (!have) {
        // Append to the USER Path, preserving what's there. Raw registry
        // access on purpose: setx truncates at 1024 chars, and
        // [Environment]::GetEnvironmentVariable expands %VAR% entries on
        // read and would write them back flattened. The throwaway variable
        // at the end is only for its WM_SETTINGCHANGE broadcast (registry
        // writes don't send one), so new terminals see the change. Routed
        // through `launcher --run` so the console tool doesn't flash a
        // window.
        const ps = "$d='" + dir.replace(/'/g, "''") + "';"
          + "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true);"
          + "$p=[string]$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);"
          + "if(($p -split ';') -notcontains $d){"
          + "$k.SetValue('Path',((@($p,$d)|Where-Object{$_}) -join ';'),[Microsoft.Win32.RegistryValueKind]::ExpandString);"
          + "[Environment]::SetEnvironmentVariable('NIB_CLI','1','User');"
          + "[Environment]::SetEnvironmentVariable('NIB_CLI',$null,'User')};"
          + "$k.Close()";
        const st = await tjs.spawn([exeDir + '/launcher.exe', '--run',
          'powershell', '-NoProfile', '-NonInteractive', '-Command', ps],
          { stdout: 'ignore', stderr: 'ignore' }).wait().catch(() => null);
        if (!st || st.exit_status !== 0 || st.term_signal)
          return { status: 'failed', error: 'Couldn’t add ' + dir + ' to your PATH.' };
      }
      return { status: 'ok', path: dir + '\\nib.cmd', note: 'new-terminal' };
    }

    const dir = tjs.homeDir + '/.local/bin';
    await tjs.makeDir(dir, { recursive: true });
    // nohup + & — the prompt comes back at once and closing the terminal
    // doesn't take a cold-started Nib with it; a running copy just gets the
    // paths over the instance pipe and this process exits by itself.
    await tjs.writeFile(dir + '/nib', enc.encode(lead + 'nohup "' + exe + '" "$@" >/dev/null 2>&1 &\n'));
    await tjs.chmod(dir + '/nib', 0o755);
    const onPath = (tjs.env.PATH || '').split(':').includes(dir);
    return { status: 'ok', path: dir + '/nib', note: onPath ? null : 'add-path' };
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
  openLink: async ({ href, dir, frag }, app, meta) => {
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
        // the #fragment survives the trip: once the sheet is up, the page
        // scrolls to the heading it names (goto-anchor waits for the load)
        if (win && frag) app.window(win).push('goto-anchor', { path, frag });
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
  if (id === SET_WIN) { settingsOpen = false; return; }
  bareWins.delete(id);
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
  // Closing the last folder window hands the scope back to Mine — the menu
  // bar and the Settings window stop answering for a folder no window shows.
  syncFocusScope(app).catch(() => {});
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
  if (id === 'help:about') api.openHelp({ at: 'about' }, app);
  // the macOS app menu's own About Nib ("about": "menu" in tinyjs.json)
  if (id === 'about') api.openHelp({ at: 'about' }, app);
  if (id === 'help:example') api.openExample(null, app);
  if (id.startsWith('appear:')) api.setAppearance({ appearance: id.slice(7) }, app);
  if (id.startsWith('pw:')) api.setPref({ key: 'width', value: id.slice(3) }, app);
  if (id === 'opt:edWidth') api.setPref({ key: 'edWidth', value: !effPrefs(appScopeBare()).edWidth }, app);
  if (id === 'opt:captions') api.setPref({ key: 'captions', value: !effPrefs(appScopeBare()).captions }, app);
  if (id === 'opt:center') api.setPref({ key: 'center', value: !effPrefs(appScopeBare()).center }, app);
  if (id === 'opt:zoom') api.setPref({ key: 'zoom', value: !effPrefs(appScopeBare()).zoom }, app);
  if (id === 'opt:linkTabs') api.setPref({ key: 'linkTabs', value: !effPrefs(appScopeBare()).linkTabs }, app);
  if (id === 'opt:hrBreaks') api.setPref({ key: 'hrBreaks', value: !effPrefs(appScopeBare()).hrBreaks }, app);
  if (id === 'opt:allFiles') api.setPref({ key: 'allFiles', value: !effPrefs(appScopeBare()).allFiles }, app);
  if (id === 'opt:paged') api.setPref({ key: 'paged', value: !effPrefs(appScopeBare()).paged }, app);
  if (id.startsWith('flavor:')) api.setFlavor({ flavor: id.slice(7) }, app);
  if (id.startsWith('fh:')) api.setPref({ key: 'findColor', value: id.slice(3) }, app);
  if (id === 'opt:hc') api.setPref({ key: 'hc', value: !effPrefs(appScopeBare()).hc }, app);
  if (id === 'opt:linkPath') api.setPref({ key: 'linkPath', value: !effPrefs(appScopeBare()).linkPath }, app);
  if (id.startsWith('ls:')) api.setPref({ key: 'linkSep', value: id.slice(3) }, app);
  if (id.startsWith('lf:')) api.setPref({ key: 'linkFrom', value: id.slice(3) }, app);
  for (const k of ['math', 'mermaid', 'alerts', 'emojiCodes', 'footnotes',
    'carousel', 'download', 'embed', 'pagelink']) {
    if (id === 'opt:' + k) api.setPref({ key: k, value: !effPrefs(appScopeBare())[k] }, app);
  }
  // New Window is answered here and ONLY here: a blank document in a window of
  // its own, whatever is open elsewhere. The pages used to answer it too,
  // which meant a focused document window opened two.
  if (id === 'newwindow') api.newWindow(null, app);
  if (id === 'newwindowsame') api.newWindowSame(null, app);
  if (id === 'closefolder') api.closeFolder(null, app);
  if (id === 'projsettings') {
    api.setProjectSettings({ on: !(project ? folderOwns(project.root) : useProjectSettings) }, app);
  }
  if (id === 'editsettings') openSettingsFile(app);
  if (id === 'refreshfolder') api.refreshFolder(null, app);

  // Open Recent. A file joins the window that had the keyboard, as a tab —
  // the same thing clicking it in the file tree does.
  if (id.startsWith('rf:')) {
    bareWins.delete(lastDocWin);        // the window receiving it changed its mind
    api.openFolder({ path: id.slice(3) }, app);
  }
  if (id.startsWith('rd:')) openDoc(app, id.slice(3), { from: lastDocWin }).catch(() => {
    app.push('toast', { text: 'Couldn’t open ' + base(id.slice(3)) });
  });
  if (id === 'recent:clear') clearRecents(app);

  // Actions. A pick from the menu is handed to the window that had the
  // keyboard — it knows which file is showing and what is selected, and it
  // owns the approval prompt and the output drawer. With no document window
  // up (the Welcome screen alone), it runs here with nothing but the folder,
  // which is exactly enough for a build.
  if (id === 'zoom:in') api.zoomStep({ dir: 1 }, app);
  if (id === 'zoom:out') api.zoomStep({ dir: -1 }, app);
  if (id === 'zoom:reset') api.zoomStep({ dir: 0 }, app);
  if (id === 'act:reload') reloadActions(app);
  // the editor is a page-side sheet, so the focused window opens it
  if (id === 'act:manage') {
    if (lastDocWin && wins.has(lastDocWin)) app.window(lastDocWin).push('manage-actions', {});
    else openDoc(app, null, { forceWindow: true }).then((w) =>
      app.window(w).push('manage-actions', {}));
  }
  // Settings is its OWN window: it has to open from the Welcome screen and
  // from no window at all, and hanging it off a document meant conjuring an
  // empty one to hold it — which is what it used to do, and which was wrong.
  const openSettings = (section) => api.openSettings({ section }, app);
  if (id === 'settings') openSettings('general');
  if (id === 'act:ai') openSettings('ai');
  if (id.startsWith('act:')
      && id !== 'act:reload' && id !== 'act:none' && id !== 'act:manage') {
    const cut = id.indexOf(':', 4);
    const scope = id.slice(4, cut);
    const key = id.slice(cut + 1);
    if (lastDocWin && wins.has(lastDocWin)) {
      app.window(lastDocWin).push('run-action', { scope, id: key });
    } else {
      api.actionRun({ scope, id: key, ctx: {} }, app, {}).then((r) => {
        if (r && r.needsTrust) {
          app.push('toast', { text: 'Open a document to approve “' + r.label + '”' });
        } else if (r && r.error) app.push('toast', { text: r.error });
      });
    }
  }
  // 'default-md' is answered by the focused PAGE (makeDefaultUI in
  // updates.js) — the answer is a dialog either way, and dialogs are page-side.
}

// File ▸ Edit Folder Settings… — the settings file as an ordinary tab,
// created from the current settings if the folder hasn't one yet. Saving it
// applies it (see saveDoc), and changes made from menus flow back into a
// clean open tab (refreshSettingsSheet) — the file and the app can't drift.
async function openSettingsFile(app) {
  if (!projectOwns()) return;
  const p = settingsPath(project.root);
  if (!(await exists(p))) await writeProjectSettings(app);
  openDoc(app, p, { from: lastDocWin }).catch(() => {
    app.push('toast', { text: 'Couldn’t open ' + base(p) });
  });
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

// ------------------------------------------------------------- the keymap
//
// Every accelerator the menu declares, in one table, so it can be REMAPPED:
// Settings ▸ Shortcuts (Mine only — a folder has no business rebinding your
// keys) lets you change any of them, and a preset gives you another editor's
// muscle memory as the starting point. menuSpec reads keyOf(id) instead of
// carrying literals, so a remap is just a menu rebuild away. null means
// unbound — which is also Print's factory state: ⌘P belongs to Open Quickly
// and ⌘⇧P to the Command Palette; printing a Markdown file is the rarer act
// and lives in the File menu without a key.
const DEFAULT_KEYS = {
  settings: ',', new: 'n', newwindow: 'N', open: 'o', openfolder: 'alt+o',
  save: 's', saveas: 'S', export: 'E', print: null,
  closetab: 'w', closewin: 'W',
  find: 'f', 'find:next': 'g', 'find:prev': 'G', 'find:replace': 'alt+f',
  'find:folder': 'F',
  'fmt:bold': 'b', 'fmt:italic': 'i', 'fmt:code': 'e', 'fmt:link': 'k',
  'fmt:image': 'I', 'fmt:emoji': 'J',
  'view:edit': '1', 'view:split': '2', 'view:preview': '3',
  files: 'B', outline: 'O', editable: 'L',
  quickopen: 'p', palette: 'P',
  insertlink: 'U', refreshfolder: 'R',
  'act:manage': 'alt+a', welcome: '0', 'help:markdown': 'H',
};
// What each preset CHANGES from the defaults — only bindings the editor
// really has, translated Ctrl→⌘ where it comes from Windows, and only where
// AppKit can spell the result (⌘x, ⇧⌘X, ⌥⌘x; no ⌃ chords, no function keys,
// no two-stroke sequences like VS Code's ⌘K ⌘B). Nib's own defaults already
// follow the VS Code / Sublime / Atom consensus (⌘P files, ⇧⌘P commands,
// ⇧⌘F find in folder), so the presets are honest diffs, not rewrites:
//  - vscode: ⇧⌘V Markdown preview, ⇧⌘E the file explorer — which costs
//    Export its ⇧⌘E, exactly the trade a VS Code hand expects.
//  - sublime / atom: ⌘R is Goto Symbol in both — the outline.
//  - notepad++: ⌘P prints (Ctrl+P, the Windows way); Open Quickly moves to
//    ⇧⌘P, where typing > still reaches the commands, so nothing is lost.
//  - textmate: ⌘T Go to File, ⇧⌘T Go to Symbol. (The project drawer was
//    ⌃⌥⌘D — unspellable here, so Files keeps ⇧⌘B.)
//  - eclipse: ⇧⌘R Open Resource (Refresh gives its key up for it).
//  - vim: navigation lives on ⌃ chords and modes AppKit accelerators can't
//    spell, so it keeps the defaults — the preset exists to say so.
const KEY_PRESETS = {
  nib: {},
  vscode: { 'view:preview': 'V', files: 'E', export: null },
  sublime: { outline: 'r' },
  atom: { outline: 'r' },
  'notepad++': { print: 'p', quickopen: 'P', palette: null },
  vim: {},
  textmate: { quickopen: 't', outline: 'T' },
  eclipse: { quickopen: 'R', refreshfolder: null },
};
const KEYMAP_PRESETS = [['nib', 'Nib'], ['vscode', 'VS Code'],
  ['sublime', 'Sublime Text'], ['atom', 'Atom'], ['notepad++', 'Notepad++'],
  ['textmate', 'TextMate'], ['vim', 'Vim'], ['eclipse', 'Eclipse']];
let keymapConf = { preset: 'nib', custom: {} };
// An action's command id — the one kind of row the keymap accepts beyond
// DEFAULT_KEYS. Yours or a folder's: either way the BINDING is yours alone,
// stored in your keymap. An actions file never carries a key — a repo has no
// more business rebinding your keyboard than a preset has unbinding it.
const isActionCommand = (id) => /^act:(global|project):./.test(id);
function keyOf(id) {
  const c = keymapConf.custom || {};
  if (Object.prototype.hasOwnProperty.call(c, id)) return c[id] || undefined;
  const p = KEY_PRESETS[keymapConf.preset] || {};
  if (Object.prototype.hasOwnProperty.call(p, id)) return p[id] || undefined;
  return DEFAULT_KEYS[id] || undefined;
}

function menuSpec() {
  const p = effPrefs(appScopeBare());
  const m = menuState;
  const mine = visibleActions(m.bare);
  // "there is a folder AND this window is in it" — see syncProjectMenu
  const inFolder = !!project && !m.bare;
  return [
    // macOS keeps Settings… beside About, which is the one slot in the bar
    // that setMenu could not reach until tinyjs grew `role: 'app'`. Off-macOS
    // the role is unknown and its items are dropped, so those platforms get
    // the same item in File instead — see below.
    ...(IS_MAC ? [{ role: 'app', items: [
      { id: 'settings', label: 'Settings…', key: keyOf('settings') },
    ] }] : []),
    { title: 'File', items: [
      { id: 'new', label: 'New', key: keyOf('new') },
      { id: 'newwindow', label: 'New Window', key: keyOf('newwindow') },
      { id: 'newwindowsame', label: 'New Window (Same Folder)', enabled: !!project },
      { id: 'open', label: 'Open…', key: keyOf('open') },
      { id: 'recent', label: 'Open Recent', submenu: recentMenu() },
      // Windows and Linux have no application menu to put this in, so it
      // lives here — and on macOS it is already up beside About, which is why
      // this one is conditional rather than a duplicate.
      ...(IS_MAC ? [] : [{ separator: true },
        { id: 'settings', label: 'Settings…', key: keyOf('settings') }]),
      { separator: true },
      // ⌥⌘O, because ⌘⇧F is Find in Folder everywhere else in the world and
      // muscle memory beats mnemonics
      { id: 'openfolder', label: 'Open Folder…', key: keyOf('openfolder') },
      { id: 'closefolder', label: 'Close Folder', enabled: !!project },
      { id: 'projsettings', label: 'Save Settings in Folder',
        checked: project ? folderOwns(project.root) : useProjectSettings },
      { id: 'editsettings', label: 'Edit Folder Settings…',
        enabled: inFolder && projectOwns() },
      { separator: true },
      { id: 'default-md', label: 'Open .md Files with Nib…' },
      { id: 'install-cli', label: 'Install ‘nib’ Shell Command…' },
      { separator: true },
      { id: 'save', label: 'Save', key: keyOf('save') },
      { id: 'saveas', label: 'Save As…', key: keyOf('saveas') },
      { separator: true },
      { id: 'export', label: 'Export as HTML…', key: keyOf('export') },
      // Unbound by default: ⌘P is Open Quickly and ⌘⇧P the Command Palette;
      // printing a Markdown file is the rarer act. Rebindable in Settings ▸
      // Shortcuts. Save as PDF wants ⌘⌥P, which tinyjs's menu accelerators
      // can't spell yet, so it goes without.
      { id: 'print', label: 'Print…', key: keyOf('print') },
      { id: 'pdf', label: 'Save as PDF…' },
      { separator: true },
      { id: 'closetab', label: 'Close Tab', key: keyOf('closetab') },
      { id: 'closewin', label: 'Close Window', key: keyOf('closewin') },
    ]},
    { role: 'edit' },
    { title: 'Find', items: [
      { id: 'find', label: 'Find…', key: keyOf('find') },
      { id: 'find:next', label: 'Find Next', key: keyOf('find:next') },
      { id: 'find:prev', label: 'Find Previous', key: keyOf('find:prev') },
      { id: 'find:replace', label: 'Replace…', key: keyOf('find:replace') },
      { separator: true },
      { id: 'find:folder', label: 'Find in Folder…', key: keyOf('find:folder'), enabled: inFolder },
      { separator: true },
      { id: 'findhi', label: 'Find Highlight', submenu:
        FIND_HI.map(([v, label]) => ({ id: 'fh:' + v, label, checked: v === p.findColor })) },
    ]},
    { title: 'Format', items: [
      { id: 'fmt:bold', label: 'Bold', key: keyOf('fmt:bold') },
      { id: 'fmt:italic', label: 'Italic', key: keyOf('fmt:italic') },
      { id: 'fmt:code', label: 'Code', key: keyOf('fmt:code') },
      { id: 'fmt:link', label: 'Link…', key: keyOf('fmt:link') },
      { separator: true },
      { id: 'fmt:image', label: 'Insert Image…', key: keyOf('fmt:image') },
      { id: 'fmt:imgopts', label: 'Image & Path Settings…' },   // → Settings ▸ Images
      { id: 'fmt:emoji', label: 'Insert Emoji…', key: keyOf('fmt:emoji') },
      { separator: true },
      // enabled by the focused window (setViewLock) — it knows what it's showing
      { id: 'fmt:json', label: 'Format JSON', enabled: m.jsonSheet },
      { separator: true },
      // what a picked heading is called in the link it makes: the heading
      // alone, or the trail of headings above it — and what joins the trail
      { id: 'linkopts', label: 'Link Options', submenu: [
        { id: 'opt:linkPath', label: 'Heading Links Carry Their Path', checked: p.linkPath },
        { separator: true },
        ...LINK_SEPS.map(([v, s]) =>
          ({ id: 'ls:' + v, label: 'Heading ' + s + ' Subheading', checked: v === p.linkSep })),
        { separator: true },
        // how a picked file's path is written — a /pin path falls back to
        // relative when the document or the target sits outside the pin
        { id: 'lf:rel', label: 'Paths Relative to the Document', checked: p.linkFrom === 'rel' },
        { id: 'lf:root', label: 'Paths from the Folder Root (/…)', checked: p.linkFrom === 'root' },
        { id: 'lf:pin', label: 'Paths from the Pinned Folder (/…)', checked: p.linkFrom === 'pin' },
      ]},
    ]},
    // View is the window — which panes and panels are up, and the app-wide
    // look. Preview (next menu) is the document — how the Markdown renders.
    // The split is what keeps either menu readable; the ids are unchanged, so
    // every handler and every saved pref is oblivious to it.
    { title: 'View', items: [
      ...VIEWS.map(([v, label]) => ({ id: 'view:' + v, label, key: keyOf('view:' + v),
        checked: v === (m.viewLock ? 'edit' : m.view),
        enabled: !m.viewLock || v === 'edit' })),
      { separator: true },
      { id: 'files', label: 'Files', key: keyOf('files'), checked: m.files },
      { id: 'outline', label: 'Outline', key: keyOf('outline'), checked: m.outline },
      { id: 'opt:allFiles', label: 'Show All Files in Folder', checked: p.allFiles },
      { separator: true },
      { id: 'editable', label: 'Edit in Preview', key: keyOf('editable'),
        checked: m.editable, enabled: m.editableOk },
      { separator: true },
      // No accelerators: tinyjs' are AppKit key equivalents and punctuation
      // doesn't bind, so ⌘+ / ⌘− / ⌥⌘0 are caught by the pages (zoom.js).
      { id: 'zoom:in', label: 'Zoom In  ⌘+' },
      { id: 'zoom:out', label: 'Zoom Out  ⌘−' },
      { id: 'zoom:reset', label: 'Actual Size  ⌥⌘0', enabled: true },
      { separator: true },
      { id: 'appearance', label: 'Appearance', submenu:
        APPEARANCES.map(([a, label]) => ({ id: 'appear:' + a, label, checked: a === m.appearance })) },
      { id: 'opt:hc', label: 'High Contrast', checked: p.hc },
    ]},
    { title: 'Preview', items: [
      // "Theme", not "Preview Theme" — the menu title already says it
      { id: 'themes', label: 'Theme', submenu:
        THEMES.map(([t, label]) => ({ id: 'theme:' + t, label, checked: t === m.theme })) },
      { id: 'pagewidth', label: 'Page Width', submenu: [
        ...WIDTHS.map(([w, label]) => ({ id: 'pw:' + w, label, checked: w === p.width })),
        { separator: true },
        { id: 'opt:edWidth', label: 'Apply to Editor', checked: p.edWidth },
      ] },
      { id: 'opt:paged', label: 'Page View', checked: p.paged },
      { separator: true },
      { id: 'flavor', label: 'Markdown Flavor', submenu: [
        { id: 'flavor:github', label: 'GitHub' },
        { id: 'flavor:commonmark', label: 'CommonMark (plain)' },
        { id: 'flavor:nib', label: 'Everything' },
        { separator: true },
        { id: 'opt:math', label: 'Math ($x$, ```math)', checked: p.math },
        { id: 'opt:mermaid', label: 'Mermaid Diagrams', checked: p.mermaid },
        { id: 'opt:alerts', label: 'Alerts (> [!NOTE])', checked: p.alerts },
        { id: 'opt:emojiCodes', label: 'Emoji Shortcodes (:tada:)', checked: p.emojiCodes },
        { id: 'opt:footnotes', label: 'Footnotes ([^1])', checked: p.footnotes },
        { separator: true },
        { id: 'opt:carousel', label: 'Carousels (::: carousel)', checked: p.carousel },
        { id: 'opt:download', label: 'Download Cards (::: download)', checked: p.download },
        { id: 'opt:embed', label: 'Embeds (::: embed)', checked: p.embed },
        { id: 'opt:pagelink', label: 'Page Links (::: pagelink)', checked: p.pagelink },
      ] },
      { separator: true },
      // what was the Rendering submenu, flattened — "Rendering" inside
      // "Preview" would just be the menu's name twice
      { id: 'opt:captions', label: 'Image Captions', checked: p.captions },
      { id: 'opt:center', label: 'Center Images', checked: p.center },
      { id: 'opt:zoom', label: 'Click Image to Zoom', checked: p.zoom },
      { id: 'opt:linkTabs', label: 'Link Tabs', checked: p.linkTabs },
      { id: 'opt:hrBreaks', label: '"---" as Page Break', checked: p.hrBreaks },
    ]},
    { title: 'Go', items: [
      // Open Quickly works folder or no folder now — with none there are no
      // files to find, and the palette says so; > switches it to commands,
      // which is exactly what the next item opens straight into.
      { id: 'quickopen', label: 'Open Quickly…', key: keyOf('quickopen') },
      { id: 'palette', label: 'Command Palette…', key: keyOf('palette') },
      { id: 'insertlink', label: 'Link to a File…', key: keyOf('insertlink'), enabled: inFolder },
      { id: 'renamefile', label: 'Rename File…', enabled: inFolder },
      { separator: true },
      { id: 'refreshfolder', label: 'Refresh File Tree', key: keyOf('refreshfolder'), enabled: inFolder },
    ]},
    // Built from the two actions files. A menu item can't know what the
    // focused window is showing, so nothing is greyed here — picking one asks
    // the window to run it, and THAT is where "needs a saved file" is
    // answered, with the window's own context.
    // Built from the two actions files, THROUGH THE FOCUSED WINDOW: a bare
    // window (New Window, a file from Finder, the example document) says "No
    // folder is open" in its tree, so the folder's actions and its file are
    // not on offer here either while it has the keyboard.
    { title: 'Actions', items: [
      ...(mine.length
        ? mine.map((a) => ({ id: 'act:' + a.scope + ':' + a.id,
          label: a.label + (a.scope === 'project' ? ' ⟨folder⟩' : ''),
          key: keyOf('act:' + a.scope + ':' + a.id) }))
        : [{ id: 'act:none', label: 'No Actions Yet', enabled: false }]),
      { separator: true },
      // Just the one door. Editing the file by hand is still there — it is a
      // click inside the sheet ("Edit as JSON…"), where you are already
      // standing when you want it — but two more items up here spelling out
      // which FILE you meant was noise on the way past.
      { id: 'act:manage', label: 'Manage Actions…', key: keyOf('act:manage') },
      { id: 'act:reload', label: 'Reload Actions' },
      { separator: true },
      { id: 'act:ai', label: 'AI Settings…' },                  // → Settings ▸ AI
    ]},
    { title: 'Window', items: [
      { id: 'tab:next', label: 'Next Tab' },
      { id: 'tab:prev', label: 'Previous Tab' },
      { separator: true },
      { id: 'welcome', label: 'Welcome to Nib', key: keyOf('welcome') },
    ]},
    { title: 'Help', items: [
      { id: 'help:markdown', label: 'Introduction to Nib', key: keyOf('help:markdown') },
      { id: 'help:example', label: 'Open Example Document' },
      { separator: true },
      { id: 'help:about', label: 'About Nib' },
      { id: 'check-updates', label: 'Check for Updates…' },
    ]},
  ];
}

// ------------------------------------------------------- the command list
//
// Every runnable menu item, flattened for the palette's > mode. The MENU is
// the command registry — there is no second list to fall out of sync with
// it: a new menu item is a new command, an action in the Actions menu is a
// command wearing its own icon, and whatever the keymap says is the key the
// row shows. Dynamic rows (recents) and placeholders are skipped.
const SKIP_COMMANDS = new Set(['recent:none', 'recent:clear', 'act:none']);
function commandList(includeDisabled) {
  const icons = new Map();
  const svgs = new Map();
  for (const a of visibleActions(menuState.bare)) {
    if (!a.icon) continue;
    const id = 'act:' + a.scope + ':' + a.id;
    icons.set(id, a.icon);
    // sync read only — commandList builds menus; whatever the cache holds.
    // (warmActionIcons fills it the first time the actions are listed.)
    if (isIconName(a.icon)) svgs.set(id, iconSync(a.icon));
  }
  const out = [];
  const seen = new Set();
  const walk = (items, path) => {
    for (const it of items || []) {
      if (!it || it.separator) continue;
      if (it.submenu) { walk(it.submenu, path + ' ▸ ' + it.label); continue; }
      if (!it.id || SKIP_COMMANDS.has(it.id) || seen.has(it.id)) continue;
      if (it.id.startsWith('rf:') || it.id.startsWith('rd:')) continue;
      if (!includeDisabled && it.enabled === false) continue;
      seen.add(it.id);
      out.push({
        id: it.id,
        // 'Zoom In  ⌘+' carries its key in the label (punctuation can't be an
        // accelerator) — the palette shows keys in their own column
        label: String(it.label).replace(/\s\s+.*$/, ''),
        path, key: it.key || null,
        checked: it.checked === true,
        icon: icons.get(it.id) || null,
        iconSvg: svgs.get(it.id) || null,
      });
    }
  };
  for (const m of menuSpec()) {
    if (m.role) { if (m.role === 'app') walk(m.items, 'Nib'); continue; }
    walk(m.items, m.title);
  }
  return out;
}

// Rebuilt only when the lists actually differ — saving a file bumps its
// recent entry on every ⌘S, and redeclaring the whole bar for a list that
// hasn't moved would be a lot of wire traffic for no visible change.
let menuSig = null;
async function refreshMenu(app) {
  menuState.recents = (await app.store.get('recents')) || [];
  menuState.folders = (await app.store.get('folders')) || [];
  const sig = JSON.stringify([[...menuState.folders, ...menuState.recents].map((r) => r.path),
    actions.list.map((a) => a.scope + ':' + a.id + ':' + a.label),
    !!project && projectOwns(), menuState.bare,
    // the keymap is part of what the bar says — a remap must redeclare it
    // (ticks go through updateMenuItem, but keys have no patch call)
    keymapConf.preset, keymapConf.custom]);
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
  dataDir = app.paths.data;                  // configKind needs it before any sheet
  uiZoom = (await app.store.get('zoom')) || 1;
  const savedFlag = await app.store.get('useProjectSettings');
  useProjectSettings = savedFlag === null || savedFlag === undefined ? true : !!savedFlag;
  folderFlags = (await app.store.get('folderFlags')) || {};
  // The app-wide layer, cached so resolution can be synchronous.
  myTheme = (await app.store.get('theme')) || 'paper';
  myView = (await app.store.get('view')) || 'split';
  // your keys (Settings ▸ Shortcuts) — before the first menu build
  const km = await app.store.get('keymap');
  if (km && Object.prototype.hasOwnProperty.call(KEY_PRESETS, km.preset)) {
    keymapConf = { preset: km.preset, custom: km.custom || {} };
  }

  // A folder stays open between launches; if it has moved or gone, forget it.
  const lastFolder = await app.store.get('project');
  if (lastFolder && (await exists(lastFolder))) {
    const settings = await readProjectSettings(lastFolder);
    // …and its this-Mac answers (the 📌 pins in Settings), which loadProject
    // reads but this restore path forgot — they vanished on every relaunch
    localSettings = onlyProjectSettings(await app.store.get(localKey(lastFolder)));
    const walked = await walkTree(lastFolder);
    project = { root: lastFolder, name: base(lastFolder), settings, ...walked };
  } else if (lastFolder) {
    await app.store.delete('project');
  }

  // Seed the ticks before the bar is built. The app comes up on the Welcome
  // screen — no doc window has the keyboard yet, so the scope is bare and the
  // ticks answer for Mine, restored folder or not. The first folder window to
  // announce itself (setView on boot) flips the scope and re-answers them.
  menuState.bare = appScopeBare();
  const seeded = resolved(menuState.bare);
  menuState.theme = seeded.theme;
  menuState.view = seeded.view;
  menuState.appearance = appearance;
  menuState.outline = outline;
  menuState.editable = editable;
  // before the bar is built, so the Actions menu is there on the first draw
  actions = await loadActions(app, project && project.root, projectOwns());
  warmActionIcons(app);          // never awaited — boot doesn't wait on a CDN
  await refreshMenu(app);
}

