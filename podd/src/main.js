// podd — a 2003 iPod as a floating desktop widget.
//
// The backend is platter's record shop with the sleeves torn off: scan a
// music folder into albums/tracks (folder shapes + ID3/FLAC/M4A text tags),
// no artwork anywhere — the third-generation iPod's LCD was monochrome and
// proud of it. The page streams tracks straight off disk via file://
// (readAccess); nothing heavy crosses the bridge.
//
// First run borrows platter's music folder if platter is set up — the two
// apps are siblings in the same listening room.

const HOME = tjs.env.HOME;
const PLATTER_STORE = HOME + '/Library/Application Support/art.tarwin.platter/store.json';

const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|oga|aiff?)$/i;
const SKIPDIR = /^(\.|__|node_modules$)/;
const DISC_RE = /^(cd|disc|disk|dvd|vol(ume)?)[\s._-]*\d+$/i;
const YEAR_RE = /^(\((19|20)\d\d\)|\[(19|20)\d\d\]|(19|20)\d\d)[\s._-]+/;

let musicDir = null;
let store = null;

const natCmp = (a, b) => {
  const ax = a.match(/\d+/), bx = b.match(/\d+/);
  if (ax && bx && ax.index === bx.index) {
    const d = parseInt(ax[0], 10) - parseInt(bx[0], 10);
    if (d) return d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};
const deYear = (s) => s.replace(YEAR_RE, '').trim() || s;
const trackName = (f) => f.replace(AUDIO, '').replace(/^\d+[\s._-]+/, '');

async function readFolder(dir) {
  const f = { tracks: [], subdirs: [] };
  try {
    for await (const e of await tjs.readDir(dir)) {
      if (SKIPDIR.test(e.name)) continue;
      if (e.isDirectory) f.subdirs.push(e.name);
      else if (AUDIO.test(e.name)) f.tracks.push(e.name);
    }
  } catch (e) { return null; }
  f.tracks.sort(natCmp);
  return f;
}

// ── text tags (same parsers as platter, artist/album only) ─────────────────

async function readHead(path, bytes) {
  const fh = await tjs.open(path, 'r');
  const buf = new Uint8Array(bytes);
  let got = 0;
  while (got < buf.length) {
    const n = await fh.read(buf.subarray(got), got);
    if (!n) break;
    got += n;
  }
  await fh.close();
  return buf.subarray(0, got);
}

function id3Str(payload) {
  const enc = payload[0], b = payload.subarray(1);
  let s = '';
  try {
    if (enc === 3) s = new TextDecoder().decode(b);
    else if (enc === 1 || enc === 2) {
      let le = enc === 1, o = 0;
      if (b[0] === 0xff && b[1] === 0xfe) { le = true; o = 2; }
      else if (b[0] === 0xfe && b[1] === 0xff) { le = false; o = 2; }
      for (; o + 1 < b.length; o += 2)
        s += String.fromCharCode(le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
    } else for (const c of b) s += String.fromCharCode(c);
  } catch (e) { return ''; }
  return s.replace(/\0+$/g, '').trim();
}

function id3Tags(buf) {
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null;
  const ver = buf[3];
  const ss = (o) => ((buf[o] & 0x7f) << 21) | ((buf[o + 1] & 0x7f) << 14) | ((buf[o + 2] & 0x7f) << 7) | (buf[o + 3] & 0x7f);
  const tagEnd = Math.min(ss(6) + 10, buf.length);
  let o = 10;
  if (buf[5] & 0x40) o += ver === 4 ? ss(10) : (((buf[10] << 24) | (buf[11] << 16) | (buf[12] << 8) | buf[13]) >>> 0) + 4;
  const got = {};
  while (o + 10 < tagEnd) {
    let id, size, hdr;
    if (ver === 2) {
      id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2]);
      if (!/^[A-Z0-9]{3}$/.test(id)) break;
      size = (buf[o + 3] << 16) | (buf[o + 4] << 8) | buf[o + 5];
      hdr = 6;
    } else {
      id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      size = ver === 4 ? ss(o + 4) : (((buf[o + 4] << 24) | (buf[o + 5] << 16) | (buf[o + 6] << 8) | buf[o + 7]) >>> 0);
      hdr = 10;
    }
    if (size <= 0 || o + hdr + size > buf.length) break;
    if (['TPE1', 'TPE2', 'TALB', 'TP1', 'TP2', 'TAL'].includes(id))
      got[id] = id3Str(buf.subarray(o + hdr, o + hdr + size));
    o += hdr + size;
  }
  const artist = got.TPE2 || got.TP2 || got.TPE1 || got.TP1;
  const album = got.TALB || got.TAL;
  return artist || album ? { artist, album } : null;
}

function flacTags(buf) {
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'fLaC') return null;
  let o = 4;
  while (o + 4 <= buf.length) {
    const last = buf[o] & 0x80, type = buf[o] & 0x7f;
    const size = (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
    o += 4;
    if (type === 4) {
      let p = o;
      const u32le = () => { const v = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0; p += 4; return v; };
      const vlen = u32le(); p += vlen;
      const count = u32le();
      const got = {};
      const dec = new TextDecoder('utf-8');
      for (let i = 0; i < count && p + 4 <= o + size; i++) {
        const len = u32le();
        if (p + len > buf.length) break;
        const s = dec.decode(buf.subarray(p, p + len)); p += len;
        const eq = s.indexOf('=');
        if (eq > 0) got[s.slice(0, eq).toUpperCase()] = s.slice(eq + 1).trim();
      }
      const artist = got.ALBUMARTIST || got['ALBUM ARTIST'] || got.ARTIST;
      return artist || got.ALBUM ? { artist, album: got.ALBUM } : null;
    }
    o += size;
    if (last) break;
  }
  return null;
}

function m4aTags(buf) {
  const atom = (o, end, want) => {
    while (o + 8 <= end) {
      const size = ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
      const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
      if (size < 8 || o + size > end) return null;
      if (type === want) return [o + 8, o + size];
      o += size;
    }
    return null;
  };
  let span = [0, buf.length];
  for (const name of ['moov', 'udta', 'meta', 'ilst']) {
    span = atom(span[0], span[1], name);
    if (!span) return null;
    if (name === 'meta') span = [span[0] + 4, span[1]];
  }
  const dec = new TextDecoder('utf-8');
  const text = (name) => {
    const box = atom(span[0], span[1], name);
    if (!box) return undefined;
    const d = atom(box[0], box[1], 'data');
    if (!d || d[1] - d[0] <= 8) return undefined;
    return dec.decode(buf.subarray(d[0] + 8, d[1])).trim();
  };
  const artist = text('aART') || text('©ART');
  const album = text('©alb');
  return artist || album ? { artist, album } : null;
}

async function readTags(track) {
  try {
    const b = await readHead(track, 4 * 1024 * 1024);
    const lower = track.toLowerCase();
    if (lower.endsWith('.flac')) return flacTags(b);
    if (/\.(m4a|aac|mp4)$/.test(lower)) return m4aTags(b) || id3Tags(b);
    return id3Tags(b) || flacTags(b);
  } catch (e) { return null; }
}

// ── the scan (platter's layout heuristics, art-free) ───────────────────────

async function albumMeta(dir, root, tracks, hasAlbumSubdirs) {
  const base = dir.split('/').pop();
  const parent = dir.slice(0, dir.lastIndexOf('/'));
  if (dir === root) return { artist: '', title: 'Loose Songs' };
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m && !/^(19|20)\d\d$/.test(m[1])) return { artist: m[1], title: deYear(m[2]) };
  if (parent.length > root.length) return { artist: parent.split('/').pop(), title: deYear(base) };
  const tags = (await readTags(tracks[0].path)) || {};
  if (hasAlbumSubdirs) return { artist: base, title: tags.album || 'Singles' };
  return { artist: tags.artist || '', title: tags.album || deYear(base) };
}

async function walk(dir, root, out, depth) {
  if (depth > 4 || out.length >= 500) return;
  const f = await readFolder(dir);
  if (!f) return;
  const discDirs = f.subdirs.filter((n) => DISC_RE.test(n)).sort(natCmp);
  const albumDirs = f.subdirs.filter((n) => !DISC_RE.test(n));
  let tracks = f.tracks.map((n) => ({ path: dir + '/' + n, name: trackName(n) }));
  for (const d of discDirs) {
    const sub = await readFolder(dir + '/' + d);
    if (!sub) continue;
    tracks = tracks.concat(sub.tracks.map((n) => ({ path: dir + '/' + d + '/' + n, name: trackName(n) })));
  }
  if (tracks.length) {
    const meta = await albumMeta(dir, root, tracks, albumDirs.length > 0);
    if (meta.artist) {
      const pref = meta.artist.toLowerCase();
      for (const t of tracks) {
        if (t.name.toLowerCase().startsWith(pref) && t.name.length > meta.artist.length + 2) {
          const rest = t.name.slice(meta.artist.length).replace(/^\s*[-–—]\s*/, '');
          if (rest) t.name = rest;
        }
      }
    }
    out.push({ artist: meta.artist, title: meta.title, tracks });
  }
  for (const d of albumDirs) await walk(dir + '/' + d, root, out, depth + 1);
}

async function scan(dir) {
  const out = [];
  await walk(dir, dir, out, 0);
  out.sort((a, b) => natCmp((a.artist + ' ' + a.title).toLowerCase(), (b.artist + ' ' + b.title).toLowerCase()));
  return { dir, albums: out };
}

// ── api ────────────────────────────────────────────────────────────────────

// where podd appears: the Dock, the menu bar, or both — set from the
// device's own Settings menu OR the tray menu. Left-click the ♪ toggles the
// widget; right-click gets the full menu.
let presence = 'both';
let loginOn = false;
let trayState = { playing: false, track: null };

function trayMenu() {
  return [
    { id: 'toggle', label: 'Show / Hide iPod' },
    { separator: true },
    ...(trayState.track ? [{ id: 'nowline', label: trayState.track, enabled: false }] : []),
    { id: 'playpause', label: trayState.playing ? 'Pause' : 'Play' },
    { id: 'prev', label: 'Previous Track' },
    { id: 'next', label: 'Next Track' },
    { separator: true },
    { id: 'choose', label: 'Choose Music Folder…' },
    { id: 'rescan', label: 'Rescan Library' },
    { separator: true },
    { id: 'pres:both', label: 'Show in Dock & Menu Bar', checked: presence === 'both' },
    { id: 'pres:dock', label: 'Dock Only', checked: presence === 'dock' },
    { id: 'pres:menubar', label: 'Menu Bar Only', checked: presence === 'menubar' },
    { id: 'login', label: 'Open at Login', checked: loginOn },
    { separator: true },
    { id: 'updates', label: 'Check for Updates…' },
    { id: 'quit', label: 'Quit podd' },
  ];
}

function applyPresence(app) {
  app.setDockVisible(presence !== 'menubar');
  if (presence === 'dock') { try { app.tray.remove(); } catch (e) {} }
  else app.tray.set({ icon: 'sf:music.note', tooltip: 'podd', menu: trayMenu() });
}

export const api = {
  setLibrary: async ({ dir }) => {
    musicDir = dir;
    try { await store.set('musicDir', dir); } catch (e) {}
    return scan(dir);
  },
  getLibrary: async () => {
    if (!musicDir) return { dir: null, albums: [] };
    return scan(musicDir);
  },
  uiGet: async (_p, app) => {
    let login = 'unsupported';
    try { login = await app.launchAtLogin.get(); } catch (e) {}
    return { presence, login, dir: musicDir };
  },
  uiSetPresence: async ({ mode }, app) => {
    presence = ['dock', 'menubar', 'both'].includes(mode) ? mode : 'both';
    try { await store.set('presence', presence); } catch (e) {}
    applyPresence(app);
    return presence;
  },
  uiSetLogin: async ({ on }, app) => {
    try {
      const st = await app.launchAtLogin.set(!!on);
      loginOn = st === 'enabled';
      applyPresence(app);
      return st;
    } catch (e) { return 'unsupported'; }
  },
  // the page keeps the tray menu honest about what's playing
  uiTraySync: async ({ playing, track }, app) => {
    trayState = { playing: !!playing, track: track || null };
    applyPresence(app);
    return true;
  },
};

export function onTray(id, app) {
  if (id === 'updates') return checkForUpdates(app);
  if (id === 'toggle') return app.push('tray', {});
  if (id === 'quit') return app.quit();
  if (id === 'choose' || id === 'rescan') return app.push('menu', { id });
  if (id === 'playpause' || id === 'next' || id === 'prev') return app.push('trayCmd', { cmd: id });
  if (id && id.startsWith('pres:')) {
    presence = id.slice(5);
    store.set('presence', presence).catch(() => {});
    applyPresence(app);
    return;
  }
  if (id === 'login') {
    (async () => {
      try {
        const st = await app.launchAtLogin.set(!loginOn);
        loginOn = st === 'enabled';
      } catch (e) {}
      applyPresence(app);
    })();
  }
}

let onTop = true;
function setMenuBar(app) {
  app.setMenu([{
    title: 'iPod',
    items: [
      { id: 'choose', label: 'Choose Music Folder…', key: 'o' },
      { id: 'rescan', label: 'Rescan', key: 'r' },
      { id: 'updates', label: 'Check for Updates…' },
      { separator: true },
      { id: 'ontop', label: 'Float Above Windows', checked: onTop },
    ],
  }]);
}

export function init(app) {
  store = app.store;
  setMenuBar(app);
  app.setLevel('floating');
  app.setResizable(false);             // it's a panel — an iPod has one size
  (async () => {
    try { presence = (await store.get('presence')) || 'both'; } catch (e) {}
    try { loginOn = (await app.launchAtLogin.get()) === 'enabled'; } catch (e) {}
    applyPresence(app);
    try { musicDir = (await store.get('musicDir')) || null; } catch (e) {}
    if (!musicDir) {
      // borrow platter's crate, if the sibling is set up
      try {
        const j = JSON.parse(new TextDecoder().decode(await tjs.readFile(PLATTER_STORE)));
        if (j.musicDir) { musicDir = j.musicDir; await store.set('musicDir', musicDir); }
      } catch (e) {}
    }
    app.push('boot', { dir: musicDir });
  })();
}

export function onMenu(id, app) {
  if (id === 'updates') return checkForUpdates(app);
  if (id === 'ontop') {
    onTop = !onTop;
    app.setLevel(onTop ? 'floating' : 'normal');
    setMenuBar(app);
    return;
  }
  app.push('menu', { id });
}


// ── self-update (uniform across the examples) ──────────────────────────────
// The runtime does the real work (sha256 + signature verified, swap +
// relaunch). "Check for Updates…" runs this; the daily background check
// just taps you on the shoulder via a notification.
async function checkForUpdates(app) {
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

export function onUpdateAvailable(info, app) {
  app.notify('Update available', 'v' + info.latest + ' is ready — use "Check for Updates…" to install.');
}
