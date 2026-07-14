// Trolley backend — boards in SQLite, a quick-add palette on a global
// hotkey, due-date notifications, a menu-bar tally, and auto-update.
//
// The page is the view; this process owns the data. Boards live wherever
// the user pointed us on first run (the folder is remembered in tiny.store),
// so the same file can sit in Documents, iCloud Drive, a synced folder…

import * as db from './db';

const HOTKEY = 'ctrl+alt+t';
const HOTKEY_LABEL = '⌃⌥T';
const SWEEP_MS = 30_000;
const MAX_BG_BYTES = 12 * 1024 * 1024;
const BG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

// ---- storage location ----------------------------------------------------

function suggestedPath() {
  return tjs.env.HOME + '/Documents/Trolley';
}

let opening: Promise<void> | null = null; // init() and the page's boot both call this

function openStorage(app: TinyApp, folder: string) {
  opening ??= (async () => {
    try {
      await db.open(folder);
      if (db.isEmpty()) db.seed();
      await app.store.set('storagePath', folder);
      sweep(app); // due badge straight away
    } finally {
      opening = null;
    }
  })();
  return opening;
}

async function state(app: TinyApp) {
  return {
    path: db.storageDir(),
    boards: db.boardsIndex(),
    lastBoard: (await app.store.get('lastBoard')) ?? null,
    hotkey: HOTKEY_LABEL,
    version: app.info.version,
  };
}

// ---- board background images ---------------------------------------------

const bgCache = new Map<number, string | null>();

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

async function backgroundDataUri(boardId: number): Promise<string | null> {
  if (bgCache.has(boardId)) return bgCache.get(boardId)!;
  const file = db.backgroundImage(boardId);
  let uri: string | null = null;
  if (file && !file.includes('/') && !file.includes('..')) {
    try {
      const bytes = await tjs.readFile(db.backgroundsDir() + '/' + file);
      const ext = file.split('.').pop()!.toLowerCase();
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      if (bytes.length <= MAX_BG_BYTES) uri = `data:image/${mime};base64,` + b64(bytes);
    } catch { /* file gone — fall back to the preset color */ }
  }
  bgCache.set(boardId, uri);
  return uri;
}

async function removeBgFile(filename: string | null) {
  if (!filename || filename.includes('/') || filename.includes('..')) return;
  const p = tjs.spawn(['rm', '-f', db.backgroundsDir() + '/' + filename], { stdout: 'ignore', stderr: 'ignore' });
  await p.wait();
}

// ---- due-date sweep: notifications + tray tally ---------------------------

let lastTray = '';

function trayMenu(): TinyMenuItem[] {
  return [
    { id: 'tray:open', label: 'Open Trolley' },
    { id: 'tray:quickadd', label: `Quick Add… (${HOTKEY_LABEL})` },
    { separator: true },
    { id: 'tray:quit', label: 'Quit Trolley' },
  ];
}

function sweep(app: TinyApp) {
  if (!db.isOpen()) return;
  const now = Date.now();
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);

  const due = db.dueCards();
  for (const c of due) {
    if (c.due <= now && !c.notified) {
      app.notify({
        id: 'card:' + c.id,
        title: c.title,
        body: `Due now — ${c.board} ▸ ${c.list}`,
        sound: true,
      });
      db.markNotified(c.id);
    }
  }

  // the menu-bar tally: overdue + due-today cards
  const count = due.filter((c) => c.due <= endOfToday.getTime()).length;
  const title = count > 0 ? `🛒 ${count}` : '🛒';
  if (title !== lastTray) {
    lastTray = title;
    app.tray.set({ title, tooltip: 'Trolley — cards due today', menu: trayMenu() });
  }
  app.push('due-badge', { count });
}

// ---- quick-add palette window ---------------------------------------------

function openPalette(app: TinyApp) {
  if (!db.isOpen()) { app.show(); return; }
  app.openWindow('palette', { page: 'palette.html', title: 'Quick Add', size: '560x120' });
  app.window('palette').push('palette-show', {});
}

// ---- api -------------------------------------------------------------------

export const api: Record<string, TinyApiHandler> = {
  boot: async (_p, app) => {
    const saved = await app.store.get('storagePath');
    if (!db.isOpen() && saved) {
      try { await openStorage(app, saved); } catch { /* moved? fall through to setup */ }
    }
    if (!db.isOpen()) return { needsSetup: true, suggestedPath: suggestedPath() };
    return state(app);
  },

  // first run (or Settings ▸ Change…): put the data folder wherever you like
  setup: async ({ path }: { path: string }, app) => {
    if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('Need an absolute folder path');
    await openStorage(app, path);
    return state(app);
  },

  moveStorage: async ({ path }: { path: string }, app) => {
    if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('Need an absolute folder path');
    const from = db.storageDir()!;
    if (path === from) return state(app);
    db.close();
    // paths travel as argv ($0/$1), never spliced into the script
    const cp = tjs.spawn(['/bin/sh', '-c',
      `mkdir -p "$1" && cp "$0/${db.DB_FILE}" "$1/" && { cp -R "$0/backgrounds" "$1/" 2>/dev/null || true; }`,
      from, path], { stdout: 'ignore', stderr: 'ignore' });
    await cp.wait();
    await openStorage(app, path);
    return state(app);
  },

  revealStorage: async () => {
    tjs.spawn(['open', '-R', db.dbPath()!], { stdout: 'ignore', stderr: 'ignore' });
    return true;
  },

  state: async (_p, app) => state(app),

  board: async ({ id }: { id: number }, app) => {
    const board = db.getBoard(id);
    if (board) await app.store.set('lastBoard', id);
    return board;
  },

  background: async ({ id }: { id: number }) => backgroundDataUri(id),

  addBoard: async ({ title, background }: { title: string; background?: string }, app) => {
    const id = db.addBoard(title, background);
    app.push('boards-changed', { boards: db.boardsIndex() });
    return db.getBoard(id);
  },
  renameBoard: async ({ id, title }: { id: number; title: string }, app) => {
    db.renameBoard(id, title);
    app.push('boards-changed', { boards: db.boardsIndex() });
    return true;
  },
  deleteBoard: async ({ id }: { id: number }, app) => {
    await removeBgFile(db.deleteBoard(id));
    bgCache.delete(id);
    app.push('boards-changed', { boards: db.boardsIndex() });
    sweep(app);
    return db.boardsIndex();
  },

  setBackground: async ({ id, background }: { id: number; background: string }, app) => {
    await removeBgFile(db.setBackground(id, background));
    bgCache.delete(id);
    app.push('boards-changed', { boards: db.boardsIndex() });
    return true;
  },

  // copy the picked image into <storage>/backgrounds/ and point the board at it
  setBackgroundImage: async ({ id, path }: { id: number; path: string }, app) => {
    const ext = (path.split('.').pop() ?? '').toLowerCase();
    if (!BG_EXT.has(ext)) throw new Error('Not an image I can use (.' + ext + ')');
    const bytes = await tjs.readFile(path);
    if (bytes.length > MAX_BG_BYTES) throw new Error('Image is too big (12 MB max)');
    const filename = `board-${id}-${Date.now()}.${ext}`;
    await tjs.writeFile(db.backgroundsDir() + '/' + filename, bytes);
    await removeBgFile(db.setBackgroundImage(id, filename));
    bgCache.delete(id);
    app.push('boards-changed', { boards: db.boardsIndex() });
    return backgroundDataUri(id);
  },

  setLabelName: async ({ boardId, color, name }: { boardId: number; color: string; name: string }) => {
    db.setLabelName(boardId, color, name);
    return true;
  },

  addList: async ({ boardId, title }: { boardId: number; title: string }) => db.addList(boardId, title),
  renameList: async ({ id, title }: { id: number; title: string }) => (db.renameList(id, title), true),
  deleteList: async ({ id }: { id: number }, app) => (db.deleteList(id), sweep(app), true),
  moveList: async ({ id, index }: { id: number; index: number }) => (db.moveList(id, index), true),

  addCard: async ({ listId, title }: { listId: number; title: string }, app) => {
    const card = db.addCard(listId, title);
    sweep(app);
    return card;
  },
  updateCard: async ({ id, patch }: { id: number; patch: Record<string, unknown> }, app) => {
    const card = db.updateCard(id, patch);
    sweep(app);
    return card;
  },
  deleteCard: async ({ id }: { id: number }, app) => (db.deleteCard(id), sweep(app), true),
  moveCard: async ({ id, listId, index }: { id: number; listId: number; index: number }) =>
    (db.moveCard(id, listId, index), true),

  // ---- quick-add palette ----
  paletteInfo: async (_p, app) => ({
    boards: db.paletteIndex(),
    target: (await app.store.get('lastTarget')) ?? null,
  }),
  quickAdd: async ({ listId, title }: { listId: number; title: string }, app) => {
    const card = db.addCard(listId, title);
    const ctx = db.cardContext(card.id)!;
    await app.store.set('lastTarget', listId);
    app.push('card-added', { boardId: ctx.boardId, listId, card });
    sweep(app);
    return { board: ctx.board, list: ctx.list };
  },
};

// ---- app wiring ------------------------------------------------------------

export function init(app: TinyApp) {
  app.setMenu([
    { title: 'File', items: [
      { id: 'card:new', label: 'New Card', key: 'n' },
      { id: 'list:new', label: 'New List', key: 'l' },
      { id: 'board:new', label: 'New Board…', key: 'shift+n' },
      { separator: true },
      { id: 'quickadd', label: `Quick Add… (${HOTKEY_LABEL} anywhere)` },
      { separator: true },
      { id: 'updates', label: 'Check for Updates…' },
      { id: 'settings', label: 'Settings…', key: ',' },
    ]},
    { title: 'Board', items: [
      { id: 'board:rename', label: 'Rename Board…' },
      { id: 'board:background', label: 'Change Background…', key: 'b' },
      { separator: true },
      { id: 'card:filter', label: 'Filter Cards', key: 'f' },
      { separator: true },
      { id: 'board:delete', label: 'Delete Board…' },
    ]},
  ]);

  app.hotkey.register('quickadd', HOTKEY);
  app.tray.set({ title: '🛒', tooltip: 'Trolley', menu: trayMenu() });

  // reopen storage before the page asks — notifications shouldn't wait for a UI
  (async () => {
    const saved = await app.store.get('storagePath');
    if (saved) { try { await openStorage(app, saved); } catch { /* setup will ask again */ } }
  })();

  setInterval(() => sweep(app), SWEEP_MS);
}

export function onHotkey(id: string, app: TinyApp) {
  if (id === 'quickadd') openPalette(app);
}

export function onMenu(id: string, app: TinyApp) {
  // pages handle the rest (broadcast; the focused window acts)
  if (id === 'quickadd') openPalette(app);
}

export function onTray(id: string, app: TinyApp) {
  if (id === 'tray:open') app.show();
  else if (id === 'tray:quickadd') openPalette(app);
  else if (id === 'tray:quit') app.quit();
}

export function onNotificationClick(id: string, app: TinyApp) {
  if (!id?.startsWith('card:')) return;
  const ctx = db.isOpen() ? db.cardContext(Number(id.slice(5))) : null;
  app.show();
  if (ctx) app.push('reveal-card', { boardId: ctx.boardId, listId: ctx.listId, cardId: ctx.id });
}
