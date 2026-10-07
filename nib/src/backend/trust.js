// Trust — which of a FOLDER's actions you have said yes to, and to what
// exactly. Nib's own actions.json needs none of this; a `.nib/actions.json`
// that arrived with a `git clone` needs all of it, because the honest reading
// of "a folder can carry buttons that run commands" is "a stranger can put a
// command in your editor".
//
// So the grant is per action, and pinned to a HASH of what that action does
// (actions.js decides what goes into it — the command, not the label). Edit
// the command and the grant no longer matches: the prompt comes back, and it
// says the action changed. Nothing here is a blanket "trust this folder",
// because that is the switch people flip once and never think about again.
//
// It lives in SQLite (txiki ships it) rather than tiny.store, because this is
// exactly what a keyed table is for and it will grow a management sheet —
// "what have I approved?" — that wants rows, not a JSON blob.

import { Database } from 'tjs:sqlite';

let db = null;
let fallback = null;                       // a Map, if the file won't open

async function open(app) {
  if (db || fallback) return;
  try {
    await tjs.makeDir(app.paths.data, { recursive: true });
    db = new Database(app.paths.data + '/nib.db');
    db.exec(`CREATE TABLE IF NOT EXISTS action_trust (
      key TEXT PRIMARY KEY, scope TEXT, root TEXT, id TEXT,
      hash TEXT, label TEXT, summary TEXT, at INTEGER)`);
  } catch (e) {
    // A read-only home, a corrupt file, an OS that said no: the feature still
    // works, it just forgets when the app quits. Better than refusing to run.
    fallback = new Map();
    db = null;
  }
}

const keyOf = (a) => [a.scope, a.root || '', a.id].join('\n');

function row(a) {
  if (fallback) return fallback.get(keyOf(a)) || null;
  const st = db.prepare('SELECT * FROM action_trust WHERE key = ?');
  try { return st.all(keyOf(a))[0] || null; } finally { st.finalize(); }
}

// 'trusted' — approved, and it is still the thing that was approved
// 'changed' — approved once, but the command has been edited since
// 'new'     — never approved
export async function trustState(app, a) {
  if (a.trusted) return 'trusted';         // the global file is yours by definition
  await open(app);
  const r = row(a);
  if (!r) return 'new';
  return r.hash === a.hash ? 'trusted' : 'changed';
}

export async function grantTrust(app, a, summary) {
  await open(app);
  const rec = {
    key: keyOf(a), scope: a.scope, root: a.root || '', id: a.id,
    hash: a.hash, label: a.label, summary: summary || '', at: Date.now(),
  };
  if (fallback) { fallback.set(rec.key, rec); return true; }
  const st = db.prepare(`INSERT OR REPLACE INTO action_trust
    (key, scope, root, id, hash, label, summary, at) VALUES (?,?,?,?,?,?,?,?)`);
  try { st.run(rec.key, rec.scope, rec.root, rec.id, rec.hash, rec.label, rec.summary, rec.at); }
  finally { st.finalize(); }
  return true;
}

export async function revokeTrust(app, key) {
  await open(app);
  if (fallback) return fallback.delete(key);
  const st = db.prepare('DELETE FROM action_trust WHERE key = ?');
  try { st.run(key); } finally { st.finalize(); }
  return true;
}

// Everything approved, newest first — for the sheet that answers "what have I
// said yes to?", and for revoking it.
export async function listTrust(app, root) {
  await open(app);
  if (fallback) {
    return [...fallback.values()].filter((r) => !root || r.root === root)
      .sort((x, y) => y.at - x.at);
  }
  const sql = root
    ? 'SELECT * FROM action_trust WHERE root = ? ORDER BY at DESC'
    : 'SELECT * FROM action_trust ORDER BY at DESC';
  const st = db.prepare(sql);
  try { return root ? st.all(root) : st.all(); } finally { st.finalize(); }
}
