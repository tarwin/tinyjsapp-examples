// TinySlaq — a Slack-style chat, tinyjs backend (txiki.js).
//
// Workspaces / channels / members are static config below. The actual
// messages live in SQLite (tjs:sqlite) so anything you type survives a
// relaunch. Direct-message channels get a canned auto-reply from the other
// person, pushed to the page over the bridge — so it feels alive without a
// server. Not affiliated with Slack; it just borrows the shape.

import { Database } from 'tjs:sqlite';

const DB_PATH = tjs.homeDir + '/.tinyslaq.sqlite';
let db = null;
function store() {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace TEXT NOT NULL,
      channel   TEXT NOT NULL,
      member    TEXT NOT NULL,
      text      TEXT NOT NULL,
      ts        TEXT NOT NULL
    )`);
  }
  return db;
}

// ---------------------------------------------------------------- config
// Each workspace carries its own accent palette (the rail + sidebar recolor
// when you switch, just like Slack), its members (each a distinct avatar
// color), its channels, and which members show up under Direct messages.

const WORKSPACES = [
  {
    id: 'tinyverse',
    name: 'Tinyverse',
    square: 'Tv',
    theme: { rail: '#2b1838', side: '#3d2150', active: '#6b3f8c', hover: '#4d2c63' },
    members: [
      { id: 'tarwin', name: 'tarwin',   color: '#6b5bd6', role: 'you',     presence: 'active' },
      { id: 'ada',    name: 'Ada Lin',  color: '#d6478c', role: 'design',  presence: 'active' },
      { id: 'bram',   name: 'Bram O.',  color: '#3b82d9', role: 'backend', presence: 'active' },
      { id: 'cleo',   name: 'Cleo Ray', color: '#2f9e6b', role: 'product', presence: 'away' },
      { id: 'devi',   name: 'Devi K.',  color: '#e0803a', role: 'ios',     presence: 'away' },
    ],
    channels: [
      { id: 'general',     name: 'general',     topic: 'Company-wide chatter and hellos' },
      { id: 'engineering', name: 'engineering', topic: 'Ship it 🚀 — builds, bugs, brags' },
      { id: 'design',      name: 'design',      topic: 'Pixels, icons and vibes' },
      { id: 'random',      name: 'random',      topic: 'Non-work banter' },
    ],
    dms: ['ada', 'bram', 'cleo', 'devi'],
  },
  {
    id: 'makers',
    name: 'Makers Guild',
    square: 'Mg',
    theme: { rail: '#0f342e', side: '#164039', active: '#2f7a6a', hover: '#1f544b' },
    members: [
      { id: 'tarwin', name: 'tarwin',  color: '#6b5bd6', role: 'you',      presence: 'active' },
      { id: 'nils',   name: 'Nils P.', color: '#c65b5b', role: 'hardware', presence: 'active' },
      { id: 'suki',   name: 'Suki M.', color: '#3fa3a3', role: 'founder',  presence: 'away' },
    ],
    channels: [
      { id: 'general',  name: 'general',  topic: 'The guild hall' },
      { id: 'showcase', name: 'showcase', topic: 'Show us what you made' },
    ],
    dms: ['nils', 'suki'],
  },
  {
    id: 'owls',
    name: 'Night Owls',
    square: 'No',
    theme: { rail: '#161a3a', side: '#20244d', active: '#414a94', hover: '#2c3266' },
    members: [
      { id: 'tarwin', name: 'tarwin', color: '#6b5bd6', role: 'you',     presence: 'active' },
      { id: 'ren',    name: 'Ren V.', color: '#8a6bd6', role: 'gremlin', presence: 'active' },
      { id: 'mox',    name: 'Mox',    color: '#d1a53a', role: 'owl',     presence: 'active' },
    ],
    channels: [
      { id: 'lounge',  name: 'lounge',  topic: 'For the 2am crowd 🌙' },
      { id: 'deploys', name: 'deploys', topic: 'Please deploy responsibly' },
    ],
    dms: ['ren', 'mox'],
  },
];

const wsOf = (id) => WORKSPACES.find((w) => w.id === id);
const memberOf = (wsId, mId) => wsOf(wsId)?.members.find((m) => m.id === mId);

// ------------------------------------------------------------- messages

function record(workspace, channel, member, text) {
  const ts = new Date().toISOString();
  store().prepare(
    'INSERT INTO messages (workspace, channel, member, text, ts) VALUES (?, ?, ?, ?, ?)'
  ).run(workspace, channel, member, text, ts);
  return { workspace, channel, member, text, ts };
}

// Canned replies the DM partner fires back with, so a one-sided chat answers.
const REPLIES = [
  'haha nice', 'oh interesting 👀', 'on it', 'give me a sec',
  'sounds good to me', 'wait really?', 'lol', '+1', 'shipping it now',
  'can you drop a link?', 'yeah that works', 'looking now', 'brb coffee ☕',
  'love that', 'good call', 'let me check and get back to you',
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function maybeAutoReply(workspace, channel, sender, app) {
  if (!channel.startsWith('dm:')) return;         // only DMs answer back
  const partner = channel.slice(3);
  if (partner === sender || !memberOf(workspace, partner)) return;
  const delay = 1100 + Math.floor(Math.random() * 1900);
  setTimeout(() => {
    const row = record(workspace, channel, partner, pick(REPLIES));
    app.push('message', row);
  }, delay);
}

// --------------------------------------------------------------- seed
// Only runs the first time (empty db) — a little lived-in history so the app
// doesn't open to a blank slate.

const SEED = [
  ['tinyverse', 'general', 'cleo', 'Welcome to Tinyverse 👋 grab a coffee and say hi'],
  ['tinyverse', 'general', 'ada',  'hi! excited to be here'],
  ['tinyverse', 'general', 'tarwin', 'shipped the kitchen sink example last night 🎉'],
  ['tinyverse', 'engineering', 'bram', 'the txiki backend + a native webkit window in ~6MB is wild'],
  ['tinyverse', 'engineering', 'tarwin', 'and no HTTP server — just a unix socket between them'],
  ['tinyverse', 'engineering', 'bram', 'sqlite is built into the runtime too, using it for these very messages'],
  ['tinyverse', 'engineering', 'ada', 'does hot reload keep backend state?'],
  ['tinyverse', 'engineering', 'tarwin', 'frontend edits swap in place; backend edits restart the process'],
  ['tinyverse', 'engineering', 'cleo', 'posted about it on HN yet?'],
  ['tinyverse', 'engineering', 'tarwin', 'not yet — still adding examples 😄 this chat app is one of them'],
  ['tinyverse', 'design', 'ada', 'new avatar colors are in Figma, feedback welcome'],
  ['tinyverse', 'design', 'devi', 'the rounded workspace squares look great'],
  ['tinyverse', 'random', 'devi', 'friday standup but make it a huddle 🎧'],
  ['tinyverse', 'dm:ada', 'ada', 'hey — can you review the sidebar colors when you get a sec?'],
  ['tinyverse', 'dm:ada', 'tarwin', 'yep just looked, ship it 🚀'],
  ['makers', 'general', 'suki', 'makers guild, assemble 🔨'],
  ['makers', 'showcase', 'nils', 'built a keyboard from scratch this weekend'],
  ['owls', 'lounge', 'ren', 'anyone else up? 🌙'],
  ['owls', 'deploys', 'mox', 'deploy freeze lifted, go go go'],
];

function seedIfEmpty() {
  const n = store().prepare('SELECT COUNT(*) AS n FROM messages').all()[0].n;
  if (n > 0) return;
  // Space the seed timestamps a few minutes apart so the order reads naturally.
  let t = Date.now() - SEED.length * 4 * 60 * 1000;
  const ins = store().prepare(
    'INSERT INTO messages (workspace, channel, member, text, ts) VALUES (?, ?, ?, ?, ?)');
  for (const [ws, ch, m, text] of SEED) {
    ins.run(ws, ch, m, text, new Date(t).toISOString());
    t += 4 * 60 * 1000;
  }
}

// ----------------------------------------------------------------- api

export const api = {
  // Everything the page needs to draw the shell (messages come per-channel
  // from history()).
  async config() {
    return { workspaces: WORKSPACES };
  },

  async history({ workspace, channel }) {
    return store().prepare(
      'SELECT member, text, ts FROM messages WHERE workspace = ? AND channel = ? ORDER BY id ASC'
    ).all(workspace, channel);
  },

  async send({ workspace, channel, member, text }, app) {
    const clean = String(text).slice(0, 4000);
    const row = record(workspace, channel, member, clean);
    maybeAutoReply(workspace, channel, member, app);
    return row;
  },
};

export function init() {
  seedIfEmpty();
}
