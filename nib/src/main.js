// Nib — a tiny Markdown editor. One window per document: the main window is
// a small Welcome screen (recents + dropzone), and every .md file you open
// gets its own native window (tinyjs 0.8.0 multi-window) running doc.html.
// Double-click a .md in Finder or drop it on the Dock icon and it lands here
// ("fileExtensions" + onOpenFiles).
//
// The interesting dance is CLOSING. macOS gives us no veto on the red ✗ —
// onWindowClosed fires after the window is gone — so Nib makes closing
// lossless instead: every edit is synced to the backend, and a window that
// dies dirty leaves a draft in tiny.store. Reopen the file and the draft is
// restored, banner and all. ⌘W gets the civilised version: an in-page sheet
// with Save / Don't Save / Cancel.
//
// Printing is the page's own job (⌘P → print CSS hides the chrome →
// tiny.win.print() → the native panel's "Save as PDF" does the rest), and
// Export as HTML writes a standalone themed file wherever you point
// tiny.win.saveFile().

const dec = new TextDecoder();
const enc = new TextEncoder();

const THEMES = [['paper', 'Paper'], ['ink', 'Ink'], ['typewriter', 'Typewriter'], ['night', 'Night']];
const VIEWS = [['edit', 'Editor Only', '1'], ['split', 'Split', '2'], ['preview', 'Preview Only', '3']];
const OPENABLE = new Set(['md', 'markdown', 'mdown', 'txt']);
const RECENT_MAX = 8;

let seq = 1;              // doc window ids: doc1, doc2, …
let untitled = 0;         // Untitled, Untitled 2, …
let opened = 0;           // cascade slot counter
let screen = { width: 1440, height: 900 };
const docs = new Map();   // winId -> { path, name, savedText, liveText, restored, slot, closing }

const base = (p) => p.split('/').pop();
const ext = (p) => (p.split('.').pop() || '').toLowerCase();
const draftKey = (d) => 'draft:' + (d.path || 'untitled');

const readText = async (path) => dec.decode(await tjs.readFile(path));
const writeText = (path, text) => tjs.writeFile(path, enc.encode(text));
const exists = async (path) => { try { await tjs.stat(path); return true; } catch { return false; } };

// ---------------------------------------------------------------- documents

async function openDoc(app, path, draftText) {
  if (path) {
    for (const [id, d] of docs) {
      if (d.path === path) {                 // already open — focus, don't fork
        const w = app.window(id);
        w.restore();
        w.show();
        return id;
      }
    }
  }

  let savedText = '', liveText = draftText ?? '', restored = draftText != null, name;
  if (path) {
    savedText = await readText(path);        // throws -> caller reports
    liveText = savedText;
    const draft = await app.store.get('draft:' + path);
    if (draft && typeof draft.text === 'string' && draft.text !== savedText) {
      liveText = draft.text;                 // a window died dirty here before
      restored = true;
    }
    name = base(path);
  } else {
    name = 'Untitled' + (++untitled > 1 ? ' ' + untitled : '');
  }

  const id = 'doc' + seq++;
  const w = Math.min(1020, screen.width - 120);
  const h = Math.min(700, screen.height - 140);
  docs.set(id, { path, name, savedText, liveText, restored, slot: opened++ % 7 });
  app.openWindow(id, { page: 'doc.html', title: name, size: `${w}x${h}` });
  if (path) bumpRecent(app, path);
  return id;
}

async function bumpRecent(app, path) {
  const list = (await app.store.get('recents')) || [];
  const next = [{ path, at: Date.now() }, ...list.filter((r) => r.path !== path)].slice(0, RECENT_MAX);
  await app.store.set('recents', next);
  paintWelcome(app);
}

// The welcome page repaints from this push (recents get a liveness check so
// deleted files show up grayed out instead of erroring on click).
async function paintWelcome(app) {
  const list = (await app.store.get('recents')) || [];
  const recents = [];
  for (const r of list) recents.push({ ...r, exists: await exists(r.path) });
  const draft = await app.store.get('draft:untitled');
  app.push('welcome', { recents, untitledDraft: draft ? { at: draft.at } : null });
}

function syncViewMenu(app, view) {
  for (const [v] of VIEWS) app.updateMenuItem('view:' + v, { checked: v === view });
}
function syncThemeMenu(app, theme) {
  for (const [t] of THEMES) app.updateMenuItem('theme:' + t, { checked: t === theme });
}

// ----------------------------------------------------------------------- api

export const api = {
  // Every window boots here; meta.window says which one is asking.
  boot: async (_p, app, meta) => {
    const theme = (await app.store.get('theme')) || 'paper';
    const view = (await app.store.get('view')) || 'split';

    const d = docs.get(meta.window);
    if (!d) {                                // the welcome window
      const list = (await app.store.get('recents')) || [];
      const recents = [];
      for (const r of list) recents.push({ ...r, exists: await exists(r.path) });
      const draft = await app.store.get('draft:untitled');
      return { kind: 'welcome', recents, untitledDraft: draft ? { at: draft.at } : null };
    }

    const w = app.window(meta.window);       // cascade so stacks don't hide each other
    if (d.slot) w.setPosition(96 + d.slot * 34, 78 + d.slot * 30);
    return {
      kind: 'doc', path: d.path, name: d.name, theme, view,
      text: d.liveText, savedText: d.savedText, restored: d.restored,
    };
  },

  // Debounced buffer sync — this is what makes red-✗ closes lossless.
  sync: ({ text }, _app, meta) => {
    const d = docs.get(meta.window);
    if (d && typeof text === 'string') d.liveText = text;
    return true;
  },

  // Save. The page owns the native Save panel (dialogs are page-side), so an
  // untitled doc gets { needsPath: true } back and calls again with the pick.
  saveDoc: async ({ text, path }, app, meta) => {
    const d = docs.get(meta.window);
    if (!d) throw new Error('not a document window');
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
    return { ok: true, path: d.path, name: d.name };
  },

  // Throw away the draft and go back to what's on disk.
  revert: async (_p, app, meta) => {
    const d = docs.get(meta.window);
    if (!d || !d.path) throw new Error('nothing to revert to');
    const text = await readText(d.path);
    d.savedText = text;
    d.liveText = text;
    d.restored = false;
    await app.store.delete(draftKey(d));
    return { text };
  },

  // The page finished its close dance (saved, or chose Don't Save) — mark the
  // window as deliberately closing so onWindowClosed doesn't draft it.
  closeDoc: async ({ discard }, app, meta) => {
    const d = docs.get(meta.window);
    if (!d) return true;
    d.closing = true;
    if (discard) await app.store.delete(draftKey(d));
    app.window(meta.window).close();
    return true;
  },

  newDoc: async (_p, app) => (await openDoc(app, null), true),

  // Files from anywhere — Open panel, window drops, recents clicks.
  openPaths: async ({ paths }, app) => {
    let ok = 0, skipped = 0;
    for (const p of paths || []) {
      if (!OPENABLE.has(ext(p))) { skipped++; continue; }
      try { await openDoc(app, p); ok++; }
      catch { skipped++; app.push('toast', { text: 'Couldn’t open ' + base(p) }); }
    }
    return { opened: ok, skipped };
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
    await openDoc(app, null, draft.text);
    paintWelcome(app);
    return true;
  },

  // Theme is app-wide: persist, retick the menu, tell every open doc.
  setTheme: async ({ theme }, app) => {
    if (!THEMES.some(([t]) => t === theme)) return false;
    await app.store.set('theme', theme);
    syncThemeMenu(app, theme);
    app.push('doc-theme', { theme });
    return true;
  },

  // View mode is per-window; the menu's ticks follow the focused window
  // (pages re-assert on focus so the radio never drifts).
  setView: async ({ view, persist }, app) => {
    if (!VIEWS.some(([v]) => v === view)) return false;
    if (persist) await app.store.set('view', view);
    syncViewMenu(app, view);
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
    let p = src;
    if (!p.startsWith('/')) {
      if (!dir) return null;
      p = dir.replace(/\/+$/, '') + '/' + p.replace(/^\.\//, '');
    }
    const mime = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
    }[ext(p)];
    if (!mime) return null;
    let bytes;
    try { bytes = await tjs.readFile(p); } catch { return null; }
    if (bytes.length > 8 * 1024 * 1024) return null;
    return { data: `data:${mime};base64,${toB64(bytes)}` };
  },

  // Preview links open in the default browser, never inside the app window.
  openExternal: ({ url }) => {
    if (!/^(https?:|mailto:)/i.test(String(url))) return false;
    tjs.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
    return true;
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

// -------------------------------------------------------------------- events

// A window is gone (red ✗ or programmatic). No veto exists — so this is
// where dying dirty becomes a draft instead of a loss.
export function onWindowClosed(id, app) {
  const d = docs.get(id);
  if (!d) return;                            // 'main' just hides (hideOnClose)
  docs.delete(id);
  if (!d.closing && typeof d.liveText === 'string' && d.liveText !== d.savedText) {
    app.store.set(draftKey(d), { text: d.liveText, at: Date.now(), path: d.path });
    paintWelcome(app);
  }
  if (docs.size === 0) app.show();           // last doc gone -> welcome returns
}

// Finder: double-click, "Open With", Dock drop. Works cold-start too.
export function onOpenFiles(paths, app) {
  api.openPaths({ paths }, app);
}

// 'Welcome' needs no page state, so it's handled backend-side; everything
// else lands in whichever page has focus (they gate on document.hasFocus()).
export function onMenu(id, app) {
  if (id === 'welcome') app.show();
}

// A notification banner was clicked — reveal the file it announced.
export function onNotificationClick(id, app) {
  if (id.startsWith('reveal:')) {
    tjs.spawn(['open', '-R', id.slice(7)], { stdout: 'ignore', stderr: 'ignore' });
  }
}

export async function init(app) {
  app.setHideOnClose(true);                  // red ✗ on Welcome hides, not quits
  app.setResizable(false);

  const st = await app.getWinState();
  screen = st.screen;

  const theme = (await app.store.get('theme')) || 'paper';
  const view = (await app.store.get('view')) || 'split';

  app.setMenu([
    { title: 'File', items: [
      { id: 'new', label: 'New', key: 'n' },
      { id: 'open', label: 'Open…', key: 'o' },
      { separator: true },
      { id: 'save', label: 'Save', key: 's' },
      { id: 'saveas', label: 'Save As…', key: 'shift+s' },
      { separator: true },
      { id: 'export', label: 'Export as HTML…', key: 'shift+e' },
      { id: 'print', label: 'Print / Save as PDF…', key: 'p' },
      { separator: true },
      { id: 'close', label: 'Close Window', key: 'w' },
    ]},
    { title: 'Format', items: [
      { id: 'fmt:bold', label: 'Bold', key: 'b' },
      { id: 'fmt:italic', label: 'Italic', key: 'i' },
      { id: 'fmt:code', label: 'Code', key: 'e' },
      { id: 'fmt:link', label: 'Link…', key: 'k' },
    ]},
    { title: 'View', items: [
      ...VIEWS.map(([v, label, key]) => ({ id: 'view:' + v, label, key, checked: v === view })),
      { separator: true },
      { id: 'themes', label: 'Theme', submenu:
        THEMES.map(([t, label]) => ({ id: 'theme:' + t, label, checked: t === theme })) },
    ]},
    { title: 'Window', items: [
      { id: 'welcome', label: 'Welcome to Nib', key: '0' },
    ]},
  ]);
}

