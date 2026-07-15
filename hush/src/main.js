// hush — a tiny secret keeper, gated behind Touch ID (tinyjs 0.16).
//
// The point of the app is the split between what's secret and what isn't:
//
//   • Secret values live ONLY in the macOS Keychain via app.secrets — the
//     keytar / Electron-safeStorage role. They never touch tiny.store, never
//     hit disk in the clear, and survive a reinstall (the Keychain outlives
//     the app bundle).
//   • The list of names (plus a note and a timestamp — none of it sensitive)
//     lives in tiny.store, because app.secrets only does get/set/delete: it
//     has no "list my keys", so the app has to remember which names exist.
//
// Everything that could expose a value — reveal, copy, add, delete — is gated
// on app.authenticate(): Touch ID (or the account-password sheet). Unlock is
// an in-memory session flag, so it evaporates the moment the app quits.
//
// tinyjs techniques on show:
//   1. app.secrets.get/set/delete  — Keychain-backed secrets
//   2. app.authenticate(reason)    — Touch ID gate
//   3. app.clipboard read + write  — copy a value, then auto-clear it after
//                                    30s (only if it's still ours)
//   4. tiny.store                  — the non-secret name index

let unlocked = false;      // in-memory session flag — dies with the app
let clearTimer = null;     // pending clipboard auto-clear

const NAMES_KEY = 'names';

// The name is the Keychain account under our app id; we prefix it so the
// index and any future keys can't collide.
const kc = (name) => 'secret:' + name;

async function loadNames(app) {
  const list = await app.store.get(NAMES_KEY);
  return Array.isArray(list) ? list : [];
}
const saveNames = (app, list) => app.store.set(NAMES_KEY, list);

// Public (non-secret) view of an entry — never the value.
const publicEntry = (e) => ({ name: e.name, note: e.note || null, at: e.at });

function requireUnlocked() {
  if (!unlocked) throw new Error('locked');
}

export const api = {
  // What the page renders: the lock state and the name index (no values).
  state: async (_p, app) => ({
    unlocked,
    entries: (await loadNames(app)).map(publicEntry),
  }),

  // Touch ID (or the password sheet). false covers a cancel or a Mac with no
  // biometrics enrolled — the page stays locked and says so.
  unlock: async (_p, app) => {
    unlocked = await app.authenticate('Unlock hush to use your secrets');
    return unlocked;
  },

  lock: () => { unlocked = false; return false; },

  // Store (or overwrite) a secret: value into the Keychain, name into the
  // index. Only the name/note/timestamp are ever persisted by us.
  add: async ({ name, value, note }, app) => {
    requireUnlocked();
    name = String(name || '').trim();
    value = String(value == null ? '' : value);
    if (!name) throw new Error('a name is required');
    if (!value) throw new Error('a secret value is required');

    const ok = await app.secrets.set(kc(name), value);
    if (!ok) throw new Error('the Keychain refused the write');

    const list = await loadNames(app);
    const entry = { name, note: String(note || '').trim() || null, at: Date.now() };
    const i = list.findIndex((e) => e.name === name);
    if (i >= 0) list[i] = entry; else list.push(entry);
    list.sort((a, b) => a.name.localeCompare(b.name));
    await saveNames(app, list);
    return publicEntry(entry);
  },

  // Hand the value back to the page (kept there only long enough to show, then
  // re-masked). string | null.
  reveal: async ({ name }, app) => {
    requireUnlocked();
    return await app.secrets.get(kc(name));
  },

  // Copy the value to the clipboard, then wipe it after 30s — but only if it's
  // still the thing we copied (read-before-write, so we never clobber whatever
  // the user copied next).
  copy: async ({ name }, app) => {
    requireUnlocked();
    const value = await app.secrets.get(kc(name));
    if (value == null) return false;
    app.clipboard.write({ text: value });
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(async () => {
      clearTimer = null;
      try {
        const cur = await app.clipboard.read();
        if (cur.kind === 'text' && cur.text === value) app.clipboard.write({ text: '' });
      } catch { /* clipboard busy — leave it */ }
    }, 30_000);
    return true;
  },

  remove: async ({ name }, app) => {
    requireUnlocked();
    await app.secrets.delete(kc(name));
    const list = (await loadNames(app)).filter((e) => e.name !== name);
    await saveNames(app, list);
    return true;
  },
};

export function init(app) {
  // Always start locked — an unlock never survives a relaunch.
  unlocked = false;
  app.setResizable(false);
}
