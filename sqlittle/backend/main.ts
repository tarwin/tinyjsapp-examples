// sqlittle backend — opens SQLite files with txiki's built-in tjs:sqlite.
import { Database } from 'tjs:sqlite';

let db: any = null;
let dbPath: string | null = null;

function mustDb() {
  if (!db) throw new Error('No database open');
  return db;
}

// quote an identifier for safe interpolation into SQL
function ident(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// blobs and bigints don't survive the JSON bridge — stringify them
function jsonRows(rows: any[]): any[] {
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v instanceof Uint8Array) o[k] = `⟨blob ${v.byteLength} B⟩`;
      else if (typeof v === 'bigint') o[k] = v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER ? Number(v) : String(v);
      else o[k] = v;
    }
    return o;
  });
}

interface TableInfo {
  name: string;
  type: string; // 'table' | 'view'
  rows: number | null;
}

function listTables(): TableInfo[] {
  const d = mustDb();
  const stmt = d.prepare(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') " +
    "AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
  const tables: { name: string; type: string }[] = stmt.all();
  stmt.finalize();
  return tables.map((t) => {
    let rows: number | null = null;
    try {
      const c = d.prepare(`SELECT COUNT(*) AS n FROM ${ident(t.name)}`);
      rows = c.all()[0]?.n ?? null;
      c.finalize();
    } catch { /* views over missing tables etc. */ }
    return { ...t, rows };
  });
}

export const api: Record<string, TinyApiHandler> = {
  open: async ({ path }: { path: string }) => {
    const st = await tjs.stat(path); // throws if missing
    if (!st.isFile) throw new Error('Not a file: ' + path);
    if (db) { try { db.close(); } catch { /* already closed */ } }
    db = new Database(path);
    dbPath = path;
    return { path, tables: listTables() };
  },

  current: async () => (dbPath ? { path: dbPath, tables: listTables() } : null),

  tables: async () => listTables(),

  columns: async ({ table }: { table: string }) => {
    const d = mustDb();
    const stmt = d.prepare(`PRAGMA table_info(${ident(table)})`);
    const cols = stmt.all();
    stmt.finalize();
    return cols; // { cid, name, type, notnull, dflt_value, pk }
  },

  rows: async ({ table, limit = 100, offset = 0 }:
    { table: string; limit?: number; offset?: number }) => {
    const d = mustDb();
    const stmt = d.prepare(
      `SELECT rowid AS _rowid_, * FROM ${ident(table)} LIMIT ? OFFSET ?`,
    );
    let rows: any[];
    try {
      rows = stmt.all(Math.min(+limit || 100, 1000), +offset || 0);
    } catch {
      // WITHOUT ROWID tables / views have no rowid — retry without it
      stmt.finalize();
      const plain = d.prepare(`SELECT * FROM ${ident(table)} LIMIT ? OFFSET ?`);
      rows = plain.all(Math.min(+limit || 100, 1000), +offset || 0);
      plain.finalize();
      return jsonRows(rows);
    }
    stmt.finalize();
    return jsonRows(rows);
  },

  query: async ({ sql }: { sql: string }) => {
    const d = mustDb();
    const started = performance.now();
    const stmt = d.prepare(sql);
    try {
      const rows = stmt.all();
      return { rows: jsonRows(rows), ms: Math.round((performance.now() - started) * 10) / 10 };
    } finally {
      stmt.finalize();
    }
  },

  close: async () => {
    if (db) { try { db.close(); } catch { /* already closed */ } }
    db = null; dbPath = null;
    return true;
  },
};

export function init(_app: TinyApp) {
  (_app as any).setMenu([{ title: 'Help', items: [{ id: 'check-updates', label: 'Check for Updates…' }] }]);
}


export function onMenu(id: string, app: any) {
  if (id === 'check-updates') checkForUpdates(app);
}


// ── self-update (uniform across the examples) ──────────────────────────────
// The runtime does the real work (sha256 + signature verified, swap +
// relaunch). "Check for Updates…" runs this; the daily background check
// just taps you on the shoulder via a notification.
async function checkForUpdates(app: any) {
  try {
    const r = await app.update.check();
    if (r && r.available) {
      app.notify('Updating…', 'v' + r.latest + ' is downloading — the app will relaunch.');
      await app.update.install();
    } else {
      app.notify("You're up to date", 'v' + ((r && r.current) || '') + ' is the latest.');
    }
  } catch (e) {
    app.notify('Update check failed', String((e && e.message) || e));
  }
}

export function onUpdateAvailable(info: any, app: any) {
  app.notify('Update available', 'v' + info.latest + ' is ready — use "Check for Updates…" to install.');
}
