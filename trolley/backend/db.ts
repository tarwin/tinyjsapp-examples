// Trolley's storage layer — one SQLite file (tjs:sqlite, built into txiki)
// living in a folder the user picks on first run, next to a backgrounds/
// directory for board images.
//
// Ordering uses fractional positions: new rows go GAP after the last one,
// moves land halfway between their new neighbours, and when a gap gets too
// tight the whole column is renumbered.

import { Database } from 'tjs:sqlite';

export const DB_FILE = 'trolley.db';
const GAP = 1024;

let db: any = null;
let dir: string | null = null;

export const isOpen = () => db != null;
export const storageDir = () => dir;
export const dbPath = () => (dir ? dir + '/' + DB_FILE : null);
export const backgroundsDir = () => (dir ? dir + '/backgrounds' : null);

// tjs:sqlite hands back bigints for INTEGER columns — flatten for the bridge
function fix(row: any) {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    o[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return o;
}

function all(sql: string, ...args: unknown[]): any[] {
  const s = db.prepare(sql);
  try { return s.all(...args).map(fix); } finally { s.finalize(); }
}
function one(sql: string, ...args: unknown[]): any | null {
  return all(sql, ...args)[0] ?? null;
}
function run(sql: string, ...args: unknown[]) {
  const s = db.prepare(sql);
  try { s.run(...args); } finally { s.finalize(); }
}
function lastId(): number {
  return one('SELECT last_insert_rowid() AS id').id;
}

async function ensureDir(path: string) {
  const p = tjs.spawn(['mkdir', '-p', path], { stdout: 'ignore', stderr: 'ignore' });
  await p.wait();
}

export async function open(folder: string) {
  close();
  await ensureDir(folder);
  await ensureDir(folder + '/backgrounds');
  db = new Database(folder + '/' + DB_FILE);
  dir = folder;
  all('PRAGMA journal_mode = WAL');
  all('PRAGMA foreign_keys = ON');
  run(`CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    background TEXT NOT NULL DEFAULT 'sky',
    bg_image TEXT,
    labels TEXT NOT NULL DEFAULT '{}',
    pos REAL NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  run(`CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    pos REAL NOT NULL
  )`);
  run(`CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    labels TEXT NOT NULL DEFAULT '[]',
    checklist TEXT NOT NULL DEFAULT '[]',
    due INTEGER,
    done INTEGER NOT NULL DEFAULT 0,
    notified INTEGER NOT NULL DEFAULT 0,
    pos REAL NOT NULL,
    created_at INTEGER NOT NULL
  )`);
}

export function close() {
  if (db) { try { db.close(); } catch { /* already closed */ } }
  db = null;
  dir = null;
}

// ---- positions ----------------------------------------------------------

function nextPos(table: string, parentCol: string, parentId: number): number {
  const r = one(`SELECT MAX(pos) AS m FROM ${table} WHERE ${parentCol} = ?`, parentId);
  return (r?.m ?? 0) + GAP;
}

function renumber(table: string, parentCol: string, parentId: number) {
  const rows = all(`SELECT id FROM ${table} WHERE ${parentCol} = ? ORDER BY pos`, parentId);
  rows.forEach((r, i) => run(`UPDATE ${table} SET pos = ? WHERE id = ?`, (i + 1) * GAP, r.id));
}

// position for dropping `id` at `index` among its (new) siblings
function posAt(table: string, parentCol: string, parentId: number, id: number, index: number): number {
  const rows = all(
    `SELECT id, pos FROM ${table} WHERE ${parentCol} = ? AND id != ? ORDER BY pos`,
    parentId, id,
  );
  const i = Math.max(0, Math.min(index, rows.length));
  const before = rows[i - 1], after = rows[i];
  if (!before && !after) return GAP;
  if (!before) return after.pos / 2;
  if (!after) return before.pos + GAP;
  if (after.pos - before.pos < 1e-6) {
    renumber(table, parentCol, parentId);
    return posAt(table, parentCol, parentId, id, index);
  }
  return (before.pos + after.pos) / 2;
}

// ---- boards --------------------------------------------------------------

const parseCard = (c: any) => ({
  ...c,
  labels: JSON.parse(c.labels),
  checklist: JSON.parse(c.checklist),
  done: !!c.done,
});

export function boardsIndex() {
  return all(
    `SELECT id, title, background, bg_image IS NOT NULL AS hasImage FROM boards ORDER BY pos`,
  ).map((b) => ({ ...b, hasImage: !!b.hasImage }));
}

export function getBoard(id: number) {
  const board = one('SELECT * FROM boards WHERE id = ?', id);
  if (!board) return null;
  const lists = all('SELECT * FROM lists WHERE board_id = ? ORDER BY pos', id);
  const cards = all(
    `SELECT c.* FROM cards c JOIN lists l ON l.id = c.list_id WHERE l.board_id = ? ORDER BY c.pos`,
    id,
  ).map(parseCard);
  return {
    id: board.id,
    title: board.title,
    background: board.background,
    hasImage: board.bg_image != null,
    labels: JSON.parse(board.labels),
    lists: lists.map((l) => ({
      id: l.id, title: l.title,
      cards: cards.filter((c) => c.list_id === l.id),
    })),
  };
}

export function addBoard(title: string, background = 'sky'): number {
  run(
    'INSERT INTO boards (title, background, labels, pos, created_at) VALUES (?, ?, ?, ?, ?)',
    title, background, '{}', nextPos('boards', '1', 1), Date.now(),
  );
  return lastId();
}

export function renameBoard(id: number, title: string) {
  run('UPDATE boards SET title = ? WHERE id = ?', title, id);
}

export function deleteBoard(id: number) {
  const b = one('SELECT bg_image FROM boards WHERE id = ?', id);
  run('DELETE FROM boards WHERE id = ?', id);
  return b?.bg_image ?? null; // caller removes the image file
}

export function setBackground(id: number, background: string) {
  const old = one('SELECT bg_image FROM boards WHERE id = ?', id);
  run('UPDATE boards SET background = ?, bg_image = NULL WHERE id = ?', background, id);
  return old?.bg_image ?? null;
}

export function setBackgroundImage(id: number, filename: string) {
  const old = one('SELECT bg_image FROM boards WHERE id = ?', id);
  run("UPDATE boards SET background = 'image', bg_image = ? WHERE id = ?", filename, id);
  return old?.bg_image ?? null;
}

export function backgroundImage(id: number): string | null {
  return one('SELECT bg_image FROM boards WHERE id = ?', id)?.bg_image ?? null;
}

export function setLabelName(boardId: number, color: string, name: string) {
  const b = one('SELECT labels FROM boards WHERE id = ?', boardId);
  if (!b) return;
  const labels = JSON.parse(b.labels);
  if (name) labels[color] = name; else delete labels[color];
  run('UPDATE boards SET labels = ? WHERE id = ?', JSON.stringify(labels), boardId);
}

// ---- lists ---------------------------------------------------------------

export function addList(boardId: number, title: string) {
  run(
    'INSERT INTO lists (board_id, title, pos) VALUES (?, ?, ?)',
    boardId, title, nextPos('lists', 'board_id', boardId),
  );
  return { id: lastId(), title, cards: [] };
}

export function renameList(id: number, title: string) {
  run('UPDATE lists SET title = ? WHERE id = ?', title, id);
}

export function deleteList(id: number) {
  run('DELETE FROM lists WHERE id = ?', id);
}

export function moveList(id: number, index: number) {
  const l = one('SELECT board_id FROM lists WHERE id = ?', id);
  if (!l) return;
  run('UPDATE lists SET pos = ? WHERE id = ?', posAt('lists', 'board_id', l.board_id, id, index), id);
}

// ---- cards ---------------------------------------------------------------

export function addCard(listId: number, title: string, due: number | null = null) {
  run(
    'INSERT INTO cards (list_id, title, due, pos, created_at) VALUES (?, ?, ?, ?, ?)',
    listId, title, due, nextPos('cards', 'list_id', listId), Date.now(),
  );
  return parseCard(one('SELECT * FROM cards WHERE id = ?', lastId()));
}

const CARD_FIELDS = new Set(['title', 'notes', 'labels', 'checklist', 'due', 'done']);

export function updateCard(id: number, patch: Record<string, unknown>) {
  for (const key of Object.keys(patch)) {
    if (!CARD_FIELDS.has(key)) continue;
    let v = patch[key];
    if (key === 'labels' || key === 'checklist') v = JSON.stringify(v);
    if (key === 'done') v = v ? 1 : 0;
    run(`UPDATE cards SET ${key} = ? WHERE id = ?`, v, id);
  }
  // a new due date (or an un-done) should notify again when it arrives
  if ('due' in patch || 'done' in patch) run('UPDATE cards SET notified = 0 WHERE id = ?', id);
  return parseCard(one('SELECT * FROM cards WHERE id = ?', id));
}

export function deleteCard(id: number) {
  run('DELETE FROM cards WHERE id = ?', id);
}

export function moveCard(id: number, listId: number, index: number) {
  run(
    'UPDATE cards SET list_id = ?, pos = ? WHERE id = ?',
    listId, posAt('cards', 'list_id', listId, id, index), id,
  );
}

export function cardContext(id: number) {
  return one(
    `SELECT c.id, c.title, c.due, c.done, c.notified, l.id AS listId, l.title AS list,
            b.id AS boardId, b.title AS board
     FROM cards c JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id
     WHERE c.id = ?`, id,
  );
}

// every not-done card with a due date, for the notification sweep + tray badge
export function dueCards() {
  return all(
    `SELECT c.id, c.title, c.due, c.notified, l.title AS list, b.title AS board
     FROM cards c JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id
     WHERE c.done = 0 AND c.due IS NOT NULL`,
  );
}

export function markNotified(id: number) {
  run('UPDATE cards SET notified = 1 WHERE id = ?', id);
}

// boards + their lists, for the quick-add palette's picker
export function paletteIndex() {
  const boards = all('SELECT id, title FROM boards ORDER BY pos');
  const lists = all('SELECT id, title, board_id FROM lists ORDER BY pos');
  return boards.map((b) => ({
    ...b,
    lists: lists.filter((l) => l.board_id === b.id).map((l) => ({ id: l.id, title: l.title })),
  }));
}

// ---- first-run seed ------------------------------------------------------

export function isEmpty(): boolean {
  return one('SELECT COUNT(*) AS n FROM boards').n === 0;
}

export function seed() {
  const tomorrow9 = new Date();
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);

  const boardId = addBoard('Welcome to Trolley', 'sky');
  setLabelName(boardId, 'red', 'Urgent');
  setLabelName(boardId, 'green', 'Nice to have');

  const todo = addList(boardId, 'To do');
  const doing = addList(boardId, 'Doing');
  const done = addList(boardId, 'Done');

  let c = addCard(todo.id, 'Drag me to another list 👉');
  updateCard(c.id, { labels: ['yellow'] });

  c = addCard(todo.id, 'Open me — I have a checklist');
  updateCard(c.id, {
    notes: 'Cards hold notes, labels, a due date and a checklist. Click anything here to edit it.',
    checklist: [
      { text: 'Click a checkbox', done: true },
      { text: 'Add an item below', done: false },
      { text: 'Drag cards around', done: false },
    ],
  });

  c = addCard(todo.id, 'Give me a due date ⏰');
  updateCard(c.id, {
    notes: 'Due cards show a badge, count into the menu-bar tally, and pop a notification when the time comes.',
    labels: ['red'], due: tomorrow9.getTime(),
  });

  c = addCard(doing.id, 'Press ⌃⌥T in any app');
  updateCard(c.id, {
    notes: 'The global hotkey opens the Quick Add palette — jot a card without switching to Trolley.',
    labels: ['green'],
  });

  c = addCard(done.id, 'Make a board of your own');
  updateCard(c.id, { notes: 'Boards live in the sidebar. Each one gets its own background — try View ▸ Change Background.', done: true });
}
