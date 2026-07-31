// amp — a Winamp-style player where each pane is a REAL native window.
//
// tinyjs multi-window gives every html file in the frontend its own OS window
// (app.openWindow / tiny.win.open), each running the full bridge. So the
// player, playlist, equalizer, and Milkdrop visualizer aren't faked <div>s
// like the web Winamp — they're four independent windows you drag, snap, and
// (the viz) send fullscreen.
//
// Windows can't talk to each other directly, so this backend is the hub:
//   • main (the audio host / brain) → publish(state) → we broadcast 'state'
//   • playlist/eq/viz → action(a)   → we push it to main
//   • any new window                → hello() / windowReady() for its state
// It also owns everything cross-window: dragging a docked group in lockstep,
// the global always-on-top flag, docked-edge highlighting, and persisting the
// whole layout (which panels are open, positions, shade state) across launches.
// The pages load audio straight off disk (tinyjs.json "readAccess": true), so
// no audio bytes ever cross the bridge.

// acceptsFirstMouse (0.22.5): the click that focuses a window ALSO lands on
// what it hit — without it, WKWebView eats the activating click and every
// cross-window action needs two (click playlist, then click play = 2 clicks).
// Winamp-style panels are exactly what click-through is for.
import * as meta from './meta.js';
import * as lookup from './lookup.js';
import * as icy from './icy.js';

// Only ever sent as the User-Agent MusicBrainz asks callers to identify
// themselves with (see lookup.js) — nothing branches on it.
const APP_VERSION = '0.9.1';

const CHROME = { frame: false, windowControls: false, squareCorners: true, acceptsFirstMouse: true };
// The visualizer must be able to enter NATIVE fullscreen, which macOS only
// allows on a titled window — squareCorners makes a window truly borderless
// (no fullscreen), so viz keeps plain frameless chrome.
const VIZ_CHROME = { frame: false, windowControls: false, acceptsFirstMouse: true };
// One height for all three platforms now (it used to be 206 on macOS, 240 on
// Linux and Windows). tinyjs 0.30 made a window's size mean the PAGE's box
// everywhere; before that, a frameless window was quietly handed the title
// bar's points ON TOP of the size it asked for (+32 on macOS), and the 206
// here was leaning on that gift — the page was really getting 238. The day it
// stopped, the headphone row fell 17px off the bottom.
// Measured on macOS at 0.30: the columns stop shrinking at a 146px row area,
// which puts this window's true content floor at 232. Linux and Windows draw
// the vertical sliders and the headphone <select> as chunkier native controls
// and were measured on hardware needing 240 — which clears the macOS floor
// too, so the platform split has nothing left to say.
const EQ_SIZE = '320x240';

// minSize: satellites are user-resizable (Linux grew edge grips), and each
// layout has a floor below which content falls off — the equalizer's headphone
// row was the first casualty. The eq window's min IS its design size: its
// columns don't reflow.
const SATELLITES = {
  playlist: { page: 'playlist.html', title: 'amp — playlist', size: '320x260', minSize: '240x160', chrome: CHROME },
  eq:       { page: 'eq.html',       title: 'amp — equalizer', size: EQ_SIZE, minSize: EQ_SIZE, chrome: CHROME },
  radio:    { page: 'radio.html',    title: 'amp — radio', size: '320x216', minSize: '260x180', chrome: CHROME },
  podcast:  { page: 'podcast.html',  title: 'amp — podcasts', size: '340x420', minSize: '260x220', chrome: CHROME },
  info:     { page: 'info.html',     title: 'amp — track info', size: '320x300', minSize: '260x200', chrome: CHROME },
  about:    { page: 'about.html',    title: 'amp — about', size: '340x500', minSize: '280x240', chrome: CHROME },
  viz:      { page: 'viz.html',      title: 'amp — visualizer', size: '640x430', minSize: '320x240', chrome: VIZ_CHROME },
  // BIG SCREEN: the whole hi-fi as one fullscreen page (rack.js fullscreens
  // itself on load — needs viz-style chrome, squareCorners can't fullscreen)
  rack:     { page: 'rack.html',     title: 'amp — big screen', size: '1100x760', chrome: VIZ_CHROME },
};

// A windowshaded satellite is ~22px of titlebar — far under its design floor,
// so while it's shaded the floor has to come down with it, or the first edge
// grab clamps it straight back open (and drag.js's guard then snaps it shut,
// which reads as the window fighting the mouse). drag.js moves the floor with
// the shade; the same numbers live here because setScale re-applies floors too.
const SHADE_MIN = '80x20';

// podcast download machinery (apis below): episodes land here for offline
const IS_WIN = tjs.env.OS === 'Windows_NT';
const IS_LINUX = !IS_WIN && /linux/i.test(globalThis.navigator?.platform ?? '');
const SUPPORT_DIR = IS_WIN
  ? (tjs.env.APPDATA || tjs.homeDir + '/AppData/Roaming') + '/art.tarwin.amp'
  : IS_LINUX
    ? (tjs.env.XDG_DATA_HOME || tjs.env.HOME + '/.local/share') + '/art.tarwin.amp'
    : tjs.env.HOME + '/Library/Application Support/art.tarwin.amp';
const POD_DIR = SUPPORT_DIR + '/podcasts';
// looked-up sleeves + the negative cache live beside the downloaded episodes
const ART_DIR = SUPPORT_DIR + '/artcache';

// MIDI: downloaded SoundFont banks. GeneralUser GS by S. Christian Collins
// (SF3-compressed, the bank the SpessaSynth project itself ships — the url
// pins their commit so it can't drift); MuseScore General is the big
// MIT-licensed FluidR3 descendant on MuseScore's own osuosl mirror. Neither
// is bundled: the first .mid play fetches the small one (~8 MB). The banks
// are the ONLY thing this backend keeps for the render pipeline — the pages
// read them (and the .mid/module files) straight off disk and render in
// their own workers; no audio bytes ever ride the socket (see render.js).
const SF_DIR = SUPPORT_DIR + '/soundfonts';
const MIDI_CACHE_DIR = SUPPORT_DIR + '/midicache';   // legacy — swept at boot
const SOUNDFONTS = [
  { id: 'gugs', name: 'GeneralUser GS', mb: 8, file: 'GeneralUserGS.sf3',
    url: 'https://raw.githubusercontent.com/spessasus/SpessaSynth/6f7505087eba09bdbf345c97f5cf573fc547412e/soundfonts/GeneralUserGS.sf3' },
  // same bank, lossless samples, from the author's own repo (pinned commit)
  { id: 'gugsfull', name: 'GeneralUser GS (full quality)', mb: 31, file: 'GeneralUser-GS.sf2',
    url: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/97049183643d5fc5a9322a69c5b09efb667c6c3a/GeneralUser-GS.sf2' },
  { id: 'msgen', name: 'MuseScore General', mb: 38, file: 'MuseScore_General.sf3',
    url: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3' },
];
let sfActive = 'gugs';             // which bank renders (persisted)
let sfDlBusy = null;               // in-flight bank download (id) — no doubles

const fileExists = async (p) => { try { await tjs.stat(p); return true; } catch (e) { return false; } };

// base64 of a file slice — loop-built binary string (a spread this size
// would blow the stack)
async function readChunkB64(path, off, len) {
  const f = await tjs.open(path, 'r');
  try {
    const buf = new Uint8Array(len);
    const n = await f.read(buf, off);
    if (!n || n <= 0) return { b64: '', eof: true };
    let bin = '';
    for (let i = 0; i < n; i += 32768) bin += String.fromCharCode(...buf.subarray(i, Math.min(i + 32768, n)));
    return { b64: btoa(bin), eof: n < len };
  } finally { await f.close(); }
}

// bank download, podDownload's shape: streamed to disk, progress as 'sf-dl'.
// A second caller mid-download (menu pick + a .mid play) joins the same one.
function sfDownload(s, app) {
  if (sfDlBusy && sfDlBusy.id === s.id) return sfDlBusy.promise;
  const promise = sfDownloadRun(s, app).finally(() => { sfDlBusy = null; });
  sfDlBusy = { id: s.id, promise };
  return promise;
}
async function sfDownloadRun(s, app) {
  const push = (pct, done, error) => app.push('sf-dl', { id: s.id, name: s.name, pct, done: !!done, error: error || null });
  try {
    await tjs.makeDir(SF_DIR, { recursive: true }).catch(() => {});
    const res = await fetch(s.url, { headers: { 'user-agent': 'amp midi player' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = +res.headers.get('content-length') || s.mb * 1048576;
    const reader = res.body.getReader();
    const tmp = SF_DIR + '/.' + s.file + '.part';
    const f = await tjs.open(tmp, 'w');
    let got = 0, lastPct = -1;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await f.write(value);
        got += value.length;
        const pct = Math.min(99, Math.floor((got / total) * 100));
        if (pct !== lastPct) { lastPct = pct; push(pct); }
      }
    } finally { await f.close(); }
    await tjs.rename(tmp, SF_DIR + '/' + s.file);
    push(100, true);
  } catch (e) {
    push(-1, false, String(e && e.message || e));
    throw e;
  }
}

const dlActive = new Set();
const hashStr = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
// synthesized formats: never ask a music database about these — a guess built
// from "kj_jose_-_a_new_frontend.s3m" only finds someone else's record
const NO_NET_META = /\.(mid|midi|mod|s3m|xm|it|mptm)$/i;
async function run(args) {
  const p = tjs.spawn(args, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  return p.wait();
}

let latest = null;                 // last state main published (for new windows)
let inspectPending = null;         // { idx } parked for a just-created info window (see api.inspect)
let openPendingFiles = null;       // { paths, t } parked for a cold-start deck (see onOpenFiles)
const shown = { playlist: false, eq: false, radio: false, podcast: false, viz: false, rack: false };
let alwaysOnTop = false;
let theme = 'system';              // 'system' | 'light' | 'dark' — pages paint it
let lcd = 'green';                 // display color: green | amber | blue | red
// Off by default, and deliberately so: a local music player that phones a
// music database about every file you open is not what anyone signed up for.
// The tray and right-click menus turn it on; the Info panel's "Look Up" button
// is the one-off that works either way.
let artLookup = false;
let presence = 'both';             // 'both' | 'menubar' | 'dock' — where amp appears
let scale = 1;                     // 1 | 1.5 | 2 — Winamp's "double size" (+ a half step: 2× can be a lot)
// the big screen is fullscreen and the visualizer is resolution-independent —
// scaling either would just waste pixels
const SCALE_EXCLUDE = new Set(['viz', 'rack']);
const scaled = (sz, f) => {
  const [w, h] = String(sz).split('x').map(Number);
  return Math.round(w * f) + 'x' + Math.round(h * f);
};
let store = null;

const setP = (k, v) => { try { store.set(k, v); } catch (e) {} };

// ── the bundled greeter tracks ──────────────────────────────────────────────
// The bundled examples ship inside the app (src/media/, copied into the .app by
// `tinyjs build`). They seed the playlist on first launch and stay reachable
// forever — even after you remove them — via the right-click menu's "Load
// Example Tracks" and the empty-playlist link. Listed in playing order, which
// is the order they're added in. Each carries its own tags and cover art, so
// the names here only matter until the deck reads the file.
// The absolute path is resolved off import.meta.url, so it's correct in dev AND
// packaged (same trick entry.js uses for the frontend dir).
const mediaPath = (file) => {
  // URL.pathname renders C:\… as /C:/… — strip it or backend file reads
  // (art extraction, stat) silently fail on Windows
  let p = decodeURIComponent(new URL('media/' + file, import.meta.url).pathname);
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
  return p;
};
const SAMPLES = [
  { file: 'TinyJS kicks the mammoths ass.mp3', name: 'TinyJS kicks the mammoths ass' },
  { file: 'Swine Island Trailer Soundtrack.opus', name: 'Swine Island Trailer Soundtrack' },
  { file: 'Power Surge.opus', name: 'Power Surge' },
  // a tracker module and a .mid on purpose: the first play walks each render
  // path (module: instant; midi: bank download → render → cache) with
  // something guaranteed to be present
  { file: 'kj_jose_-_a_new_frontend.s3m', name: 'A New Frontend' },
  { file: 'GreensleevesAcc.mid', name: 'Greensleeves' },
].map((s) => ({ path: mediaPath(s.file), name: s.name }));
const SAMPLE_PATHS = SAMPLES.map((s) => s.path);
const SAMPLE_TRACKS = () => SAMPLES.map((s) => ({ path: s.path, name: s.name }));

// ── embedded cover art, extracted lazily and cached ─────────────────────────
// The sleeve, the visualizer's album-art mode, and the Info panel all ask for a
// track's art; we parse it once (meta.js reads the file head) and hand back a
// data: URI. Cache holds null too — a track with no art shouldn't be re-parsed
// on every state broadcast. artJobs coalesces bursts hitting the same file.
//
// Keyed by size+mtime, NOT by path alone: re-tagging a file amp has already
// looked at — adding cover art to a track that had none, or replacing the
// picture — otherwise served the stale bytes forever, and a cached `null` meant
// newly-added art never appeared at all. Nothing here ever invalidated, so the
// only cure was quitting the app.
const artCache = new Map();        // path → { key, art }   art = { uri, source } | null
const artJobs = new Map();         // path → { key, job }
const tagCache = new Map();        // path → { key, tags }
const tagJobs = new Map();
async function fileKey(path) {
  try { const s = await tjs.stat(path); return (s.size ?? 0) + ':' + (s.mtim ?? ''); }
  catch (e) { return '?'; }        // unstattable: parse it and don't trust the cache
}

// The file's own tags, parsed once. Everything that wants to know what a track
// IS — the marquee, the Info panel, the artwork search below — comes through
// here, so meta.js reads each file exactly once per (size, mtime).
async function getTags(path) {
  const key = await fileKey(path);
  const hit = tagCache.get(path);
  if (hit && hit.key === key) return hit.tags;
  const running = tagJobs.get(path);
  if (running && running.key === key) return running.job;
  const job = (async () => {
    let t = {};
    try { t = (await meta.readMeta(path)) || {}; } catch (e) {}
    tagCache.set(path, { key, tags: t });
    if (tagJobs.get(path)?.job === job) tagJobs.delete(path);
    return t;
  })();
  tagJobs.set(path, { key, job });
  return job;
}

// Embedded art wins, always. Only when the file carries none — and only when
// the user has switched lookups on — do we go asking the internet; lookup.js
// caches the answer to disk either way, so the second play of a track never
// repeats the trip. `force` is the Info panel's manual "Look Up" button: it
// ignores both the preference and a previously cached miss.
// Returns { uri, source } or null; source is 'embedded' for the file's own
// picture, otherwise where it was found ('caa' | 'itunes' | 'deezer' | 'cache').
async function getArt(path, opts = {}) {
  const key = await fileKey(path);
  const hit = artCache.get(path);
  if (hit && hit.key === key && !opts.force) return hit.art;
  const running = artJobs.get(path);
  if (running && running.key === key && !opts.force) return running.job;
  const job = (async () => {
    let art = null;
    try {
      const bytes = await meta.readArt(path);
      if (bytes && bytes.length) art = { uri: meta.toDataURI(bytes), source: 'embedded' };
    } catch (e) {}
    if (!art && (artLookup || opts.force) && !NO_NET_META.test(path)) {
      try {
        const desc = lookup.describe(path, await getTags(path));
        const got = desc && await lookup.findArt(desc, { force: opts.force });
        if (got) art = { uri: got.uri, source: got.source };
      } catch (e) {}
    }
    artCache.set(path, { key, art });
    if (artJobs.get(path)?.job === job) artJobs.delete(path);
    return art;
  })();
  artJobs.set(path, { key, job });
  return job;
}

function persist() {
  if (!latest) return;
  // `display` rides along so a relaunch shows "Artist — Title" immediately
  // rather than a flash of filenames while the tags are re-read
  // `url` + `pod` too: a streamed episode without them restored as a dead row
  // (no source at all), and a downloaded one came back stripped of its show,
  // feed art and listened-tracking
  setP('playlist', (latest.tracks || []).map((t) => ({ path: t.path, url: t.url, name: t.name, display: t.display, pod: t.pod })));
  setP('meta', { volume: latest.volume, balance: latest.balance, eq: latest.eq, idx: latest.idx });
}

export const api = {
  hello: () => latest,

  publish: (state, app) => {
    latest = state;
    app.push('state', state);   // main ignores its own 'state' events
    persist();
    updateTray(app);
    syncDockAnim(app);
    return true;
  },

  // The player renders the Dock-icon animation frames on a canvas (the
  // backend has none) and hands them over as base64 PNGs, once at launch.
  dockFrames: async ({ frames }, app) => {
    const dir = (tjs.env.TMPDIR || '/tmp').replace(/\/$/, '');
    const paths = [];
    for (let i = 0; i < (frames || []).length; i++) {
      const p = dir + '/amp-dock-' + i + '.png';
      await tjs.writeFile(p, Uint8Array.from(atob(frames[i]), (c) => c.charCodeAt(0)));
      paths.push(p);
    }
    dockFramePaths = paths;
    syncDockAnim(app);
    return true;
  },

  // playlist/eq/viz → main. Routed because windows can't reach each other.
  action: (a, app) => { app.window('main').push('action', a); return true; },

  // Re-add the bundled examples to the playlist (right-click menu / empty-list
  // link). The backend owns the paths, so callers never need to know them —
  // they just ask, and the player adds them like any dropped files.
  addSample: (_, app) => {
    app.window('main').push('action',
      { type: 'add', paths: SAMPLE_PATHS, names: SAMPLES.map((s) => s.name) });
    return true;
  },

  fileSize: async ({ path }) => { try { return (await tjs.stat(path)).size; } catch (e) { return 0; } },

  // Cover art for a local file: { uri, source } or null. The sleeve on the big
  // screen and the visualizer's album-art mode both draw from here, and both
  // show the source, so a looked-up sleeve is never passed off as the file's own.
  trackArt: async ({ path, force }) => (path ? await getArt(path, { force }) : null),

  // The playlist's tags, in one call. Asked for the whole list at once when
  // tracks are added or restored: the marquee, the playlist rows and the Now
  // Playing session all want "Artist — Title" rather than a filename, and one
  // round trip for N files beats N round trips. Embedded tags only — no
  // network, whatever the preference says.
  trackTags: async ({ paths }) => {
    const out = {};
    await Promise.all((paths || []).slice(0, 500).map(async (p) => {
      if (!p) return;
      try {
        const t = await getTags(p);
        if (t && (t.title || t.artist || t.album)) out[p] = { title: t.title, artist: t.artist, album: t.album, date: t.date };
      } catch (e) {}
    }));
    return out;
  },

  // Everything the Info panel shows: embedded tags + the YouTube-style link +
  // file stats + art. Duration is merged in by the page (it knows it from state).
  // When the file carries no tags at all, the same chain that finds artwork can
  // name the track too — flagged as `tagSource` so the panel can show it as a
  // guess from the internet rather than as something the file said.
  trackInfo: async ({ path, force }) => {
    if (!path) return null;
    let size = 0; try { size = (await tjs.stat(path)).size; } catch (e) {}
    const m = (await getTags(path)) || {};
    const art = await getArt(path, { force });
    const info = { path, name: path.split(/[\\/]/).pop(),
                   ext: (path.split('.').pop() || '').toLowerCase(), size, ...m,
                   art: art ? art.uri : null, artSource: art ? art.source : null };
    if (!m.title && !m.artist && !m.album && (artLookup || force) && !NO_NET_META.test(path)) {
      try {
        const guess = lookup.guessFromPath(path);
        const found = guess && await lookup.findTags(guess, { force });
        if (found) {
          info.title = info.title || found.title;
          info.artist = info.artist || found.artist;
          info.album = info.album || found.album;
          info.date = info.date || found.date;
          info.tagSource = found.source;
        }
      } catch (e) {}
    }
    return info;
  },

  // Artwork for something with no file behind it — a radio station's current
  // track. Same cache and same chain; the caller supplies the words.
  artFor: async ({ artist, album, title, force }) => {
    if (!artLookup && !force) return null;
    if (!artist && !album && !title) return null;
    try { return await lookup.findArt({ artist, album, title }, { force }); }
    catch (e) { return null; }
  },

  artLookupEnabled: () => artLookup,
  setArtLookup: ({ value }, app) => { setArtLookup(app, !!value); return artLookup; },

  // What's on the air right now: one short-lived ICY connection to the station,
  // separate from the one playing the music. null whenever the station doesn't
  // speak it, which is common and not an error.
  radioNowPlaying: async ({ url }) => {
    if (!url) return null;
    try { return await icy.nowPlaying(url); } catch (e) { return null; }
  },

  // Expand dropped paths: a directory becomes its immediate audio files (one
  // level, no recursion into subfolders); plain files pass straight through.
  resolveDrop: async ({ paths }) => {
    const AUDIO = /\.(mp3|m4a|aac|mp4|flac|wav|aif|aiff|caf|oga|ogg|opus|mid|midi|mod|s3m|xm|it|mptm)$/i;
    const out = [];
    for (const p of paths) {
      let isDir = false;
      try { isDir = !!(await tjs.stat(p)).isDirectory; } catch (e) { continue; }
      if (!isDir) { out.push(p); continue; }
      try {
        const names = [];
        for await (const e of await tjs.readDir(p)) if (!e.isDirectory && AUDIO.test(e.name)) names.push(e.name);
        names.sort((a, b) => a.localeCompare(b));
        for (const n of names) out.push(p.replace(/\/+$/, '') + '/' + n);
      } catch (e) {}
    }
    return out;
  },

  // A window (any) reports it's up and asks for its per-window restore bits.
  windowReady: async ({ id }) => {
    let shade = false;
    try { shade = !!(await store.get('shade:' + id)); } catch (e) {}
    // minSize: the design floor, unscaled — drag.js drops it to SHADE_MIN while
    // shaded and puts this back on expand, so it needs to know the real one.
    const minSize = (SATELLITES[id] && SATELLITES[id].minSize) || null;
    return { shade, minSize, onTop: alwaysOnTop, theme, lcd, presence, dockAnim, scale };
  },

  // Show/hide a satellite window (close button hides so positions survive).
  toggleWindow: async ({ id }, app) => {
    const cfg = SATELLITES[id];
    if (!cfg) return false;
    const wins = await app.windows();
    if (!wins.includes(id)) {
      await openSatellite(app, id);
      shown[id] = true;
      // never float the rack — macOS refuses fullscreen on a floating-level
      // window, so an always-on-top rack would silently stay windowed
      if (alwaysOnTop && !shown.rack && id !== 'rack') setTimeout(() => { try { app.window(id).setAlwaysOnTop(true); } catch (e) {} }, 50);
    } else if (shown[id]) {
      app.window(id).hide();
      shown[id] = false;
    } else {
      app.window(id).show({ activate: false });
      shown[id] = true;
      // a re-shown rack comes back windowed — tell it to go fullscreen again
      // (and strip any floating level it may have caught, or fullscreen fails)
      if (id === 'rack') {
        try { app.window('rack').setAlwaysOnTop(false); } catch (e) {}
        try { app.window('rack').push('enterFullscreen', {}); } catch (e) {}
      }
    }
    setP('panels', { ...shown });
    app.push('windows', { ...shown });
    if (id === 'rack') applyOnTopLevels(app);   // BIG suspends floating; exit restores it
    setTimeout(() => refreshDocking(app), 120);
    return shown[id];
  },

  // Surface the Info panel. With an idx (a right-clicked playlist row) it pins
  // that track; with no idx ("Current Track Info…") it flips the panel back to
  // the playing track. Either way the window is raised — show() on a visible
  // window is orderFrontRegardless, which is exactly "bring it to me" without
  // stealing focus. The pin/tab state itself lives in the info page. A freshly
  // created window's page isn't listening yet, so the index is parked for its
  // boot-time inspectTarget call instead of being pushed into the void.
  inspect: async ({ idx }, app) => {
    const wins = await app.windows();
    if (!wins.includes('info')) {
      inspectPending = idx == null ? null : { idx };
      await openSatellite(app, 'info');
      shown.info = true;
      if (alwaysOnTop && !shown.rack) setTimeout(() => { try { app.window('info').setAlwaysOnTop(true); } catch (e) {} }, 50);
    } else {
      app.window('info').show({ activate: false });
      shown.info = true;
      app.window('info').push('inspect', { idx: idx == null ? null : idx });
    }
    setP('panels', { ...shown });
    app.push('windows', { ...shown });
    setTimeout(() => refreshDocking(app), 120);
    return true;
  },

  // consumed once by the info page as it boots (see inspect above)
  inspectTarget: () => { const v = inspectPending; inspectPending = null; return v; },

  // consumed once by the deck as it boots — a double-click that LAUNCHED amp
  // fires onOpenFiles before the page listens, so the paths wait here. The
  // age gate keeps a dev-reload from replaying an old open.
  openPending: () => {
    const v = openPendingFiles; openPendingFiles = null;
    return v && Date.now() - v.t < 15000 ? v.paths : null;
  },

  setShown: ({ id, value }, app) => {
    shown[id] = value; setP('panels', { ...shown });
    app.push('windows', { ...shown });
    return true;
  },

  // The viz asks for these around native fullscreen: macOS refuses fullscreen
  // on a floating-level window (same trap as the rack), so it sheds its level
  // going in and takes it back on the way out.
  unfloat: ({ id }, app) => {
    try { app.window(id || 'viz').setAlwaysOnTop(false); } catch (e) {}
    return true;
  },
  refloat: async (_p, app) => (await applyOnTopLevels(app), true),

  // ── podcasts ──────────────────────────────────────────────────────────────
  // The page can't fetch feeds itself (CORS); the backend can. It hands the
  // raw XML back — WKWebView has DOMParser, txiki doesn't.
  // NOTE: relies on the runtime's fetch repair shim (bridge.js) for feeds on
  // hosts txiki's own fetch can't reach — root-path CloudFront urls and
  // TLS 1.2-only hosts (art19, anchor.fm). No fallback needed here.
  podFetchFeed: async ({ url }) => {
    if (!/^https?:\/\//.test(String(url))) return { ok: false, error: 'not an http(s) url' };
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'amp podcast client' } });
      clearTimeout(t);
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let xml = '';
      while (xml.length < 10 * 1048576) {
        const { done, value } = await reader.read();
        if (done) break;
        xml += dec.decode(value, { stream: true });
      }
      return { ok: true, xml };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  },

  // Download an episode for offline: streamed straight to disk (episodes run
  // 50–100 MB — never buffer one in RAM), progress pushed as 'pod-dl'.
  podDownload: async ({ guid, url, title, show }, app) => {
    if (!/^https?:\/\//.test(String(url))) throw new Error('not an http(s) url');
    const idx = (await store.get('podDl')) || {};
    if (idx[guid]) return idx[guid];
    if (dlActive.has(guid)) return null;
    dlActive.add(guid);
    const push = (pct, done, error) => app.push('pod-dl', { guid, pct, done: !!done, error: error || null });
    try {
      await tjs.makeDir(POD_DIR, { recursive: true }).catch(() => {});
      const ext = (String(url).match(/\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i) || [, 'mp3'])[1];
      const path = POD_DIR + '/' + hashStr(guid) + '.' + ext;
      const res = await fetch(url, { headers: { 'user-agent': 'amp podcast client' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = +res.headers.get('content-length') || 0;
      const reader = res.body.getReader();
      const f = await tjs.open(path, 'w');
      let got = 0, lastPct = -1;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await f.write(value);
          got += value.length;
          const pct = total ? Math.floor((got / total) * 100) : -1;
          if (pct !== lastPct) { lastPct = pct; push(pct); }
        }
      } finally {
        await f.close();
      }
      const entry = { path, bytes: got, title: title || '', show: show || '' };
      const idx2 = (await store.get('podDl')) || {};
      idx2[guid] = entry;
      await store.set('podDl', idx2);
      push(100, true);
      return entry;
    } catch (e) {
      push(-1, false, String(e && e.message || e));
      throw e;
    } finally {
      dlActive.delete(guid);
    }
  },

  podDlIndex: async () => (await store.get('podDl')) || {},

  podDelete: async ({ guid }) => {
    const idx = (await store.get('podDl')) || {};
    const e = idx[guid];
    if (e) {
      try { await tjs.remove(e.path); } catch (err) {}
      delete idx[guid];
      await store.set('podDl', idx);
    }
    return idx;
  },

  // album sleeves + the miss index (lookup.js) — the podcast window's other
  // CLR button; artwork re-fetches on demand if lookups are on
  artClearCache: () => lookup.clearCache(),

  podClearCache: async () => {
    const idx = (await store.get('podDl')) || {};
    let freed = 0;
    for (const g of Object.keys(idx)) {
      freed += idx[g].bytes || 0;
      try { await tjs.remove(idx[g].path); } catch (e) {}
    }
    await store.set('podDl', {});
    return { freed };
  },

  // ── MIDI soundfonts ───────────────────────────────────────────────────────
  // A .mid isn't audio — each window renders it with a SoundFont bank
  // (SpessaSynth in that window's worker; render.js reads the bank straight
  // off disk) and plays its own in-memory blob. Banks are megabytes, so none
  // ship in the app: the first .mid play downloads the small one, nicer ones
  // live in the right-click menu, and whichever is active gets used for
  // every render. The backend's whole part is download-once + hand out the
  // path — no bytes, no wav cache, nothing else to manage.

  // list for the menu: which banks exist on disk, which is active
  sfList: async () => ({
    active: sfActive,
    banks: await Promise.all(SOUNDFONTS.map(async (s) => ({
      id: s.id, name: s.name, mb: s.mb,
      downloaded: await fileExists(SF_DIR + '/' + s.file),
    }))),
  }),

  // pick a bank (menu click) — downloads it first if it's not here yet
  sfSet: async ({ id }, app) => {
    const s = SOUNDFONTS.find((x) => x.id === id);
    if (!s) return false;
    if (!(await fileExists(SF_DIR + '/' + s.file))) await sfDownload(s, app);
    sfActive = s.id;
    setP('soundfont', s.id);
    app.push('soundfont', await api.sfList());
    return true;
  },

  // a page, about to render: make sure the active bank is on disk and say
  // where (first-ever .mid play downloads it here, progress pushed 'sf-dl');
  // the page reads the file itself — see render.js
  sfEnsure: async (_p, app) => {
    const s = SOUNDFONTS.find((x) => x.id === sfActive) || SOUNDFONTS[0];
    const path = SF_DIR + '/' + s.file;
    if (!(await fileExists(path))) await sfDownload(s, app);
    const st = await tjs.stat(path);
    return { id: s.id, name: s.name, size: st.size, path };
  },

  // fallback file reader for a platform where the page's fetch(file://) is
  // walled off — slow (base64 over the socket), but never wrong
  fileChunk: async ({ path, off, len }) =>
    readChunkB64(path, off, Math.min(len || 0, 1048576)),

  windowState: () => ({ ...shown }),

  // ── Arrange (right-click → Arrange) ───────────────────────────────────────
  // Tidies whatever is open into the classic docked cluster: the Winamp
  // stack — main with EQ and playlist flush beneath it — and everything else
  // in flush columns to its right, wrapped when a column would run off the
  // bottom. Anchored where main already sits, clamped into its screen's work
  // area. Flush edges mean the docking logic adopts the cluster whole, so an
  // arranged rig drags as one. `all` opens every panel first.
  arrange: async ({ all }, app) => {
    if (all) {
      for (const id of ['playlist', 'eq', 'radio', 'podcast', 'viz']) {
        if (!shown[id]) await api.toggleWindow({ id }, app);
      }
    }
    // a just-opened window answers getState a beat later — poll briefly
    const state = async (id) => {
      for (let i = 0; i < 20; i++) {
        try {
          const s = await app.window(id).getState();
          if (s && s.width) return s;
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    };
    const main = await state('main');
    if (!main) return false;
    // the screen main lives on — the cluster must fit its visible area
    let vis = null;
    try {
      const screens = (await app.screens()) || [];
      const cx = main.x + main.width / 2, cy = main.y + main.height / 2;
      for (const s of screens) {
        const v = s.visible || s;
        if (cx >= v.x && cx < v.x + v.width && cy >= v.y && cy < v.y + v.height) { vis = v; break; }
      }
      if (!vis && screens[0]) vis = screens[0].visible || screens[0];
    } catch (e) {}
    if (!vis) vis = { x: 0, y: 0, width: 1440, height: 860 };
    const stackIds = ['eq', 'playlist'].filter((id) => shown[id]);
    const sideIds = ['viz', 'radio', 'podcast', 'info'].filter((id) => shown[id]);
    const sizes = { main };
    for (const id of [...stackIds, ...sideIds]) sizes[id] = await state(id);
    const stack = ['main', ...stackIds.filter((id) => sizes[id])];
    const side = sideIds.filter((id) => sizes[id]);
    // relative layout first, then one clamped anchor for the whole cluster
    const pos = {};
    let y = 0;
    for (const id of stack) { pos[id] = { x: 0, y }; y += sizes[id].height; }
    const stackW = Math.max(...stack.map((id) => sizes[id].width));
    let colX = stackW, colY = 0, colW = 0;
    for (const id of side) {
      const s = sizes[id];
      if (colY > 0 && colY + s.height > vis.height) { colX += colW; colY = 0; colW = 0; }
      pos[id] = { x: colX, y: colY };
      colY += s.height; colW = Math.max(colW, s.width);
    }
    const bw = Math.max(stackW, colX + colW);
    const bh = Math.max(y, ...side.map((id) => pos[id].y + sizes[id].height));
    const ax = Math.max(vis.x, Math.min(main.x, vis.x + vis.width - bw));
    const ay = Math.max(vis.y, Math.min(main.y, vis.y + vis.height - bh));
    for (const id of Object.keys(pos)) {
      const p = { x: Math.round(ax + pos[id].x), y: Math.round(ay + pos[id].y) };
      try { app.window(id).setPosition(p.x, p.y); } catch (e) {}
      setP('pos:' + id, p);
    }
    setTimeout(() => refreshDocking(app), 150);
    return true;
  },

  // ── snapping + group drag ─────────────────────────────────────────────────
  rects: async (_p, app) => {
    const out = {};
    for (const id of await app.windows()) {
      if (id === 'rack') continue;                   // fullscreen big-screen: no snapping
      if (id !== 'main' && !shown[id]) continue;     // skip hidden satellites
      try { const s = await app.window(id).getState(); out[id] = { x: s.x, y: s.y, width: s.width, height: s.height }; }
      catch (e) {}
    }
    return out;
  },
  screens: (_p, app) => app.screens ? app.screens() : [],

  // A .pls/.m3u "stream" URL is a playlist wrapper around the real stream —
  // the page can't fetch it (CORS), so unwrap it here: first File<N>= line
  // (.pls) or first bare http line (.m3u) wins.
  resolveStream: async ({ url }) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return null;
    try {
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ac ? setTimeout(() => ac.abort(), 8000) : 0;
      const res = await fetch(url, { headers: { 'user-agent': 'amp radio' }, signal: ac ? ac.signal : undefined });
      clearTimeout(t);
      const text = await res.text();
      for (const line of text.split(/\r?\n/)) {
        const l = line.trim();
        const m = l.match(/^File\d+\s*=\s*(\S+)/i);
        if (m) return { url: m[1] };
        if (/^https?:\/\//i.test(l)) return { url: l };
      }
    } catch (e) {}
    return null;
  },
  // Move a whole docked group in ONE call so main and its satellites stay in
  // lockstep (per-window round-trips lag and look broken).
  moveGroup: ({ moves }, app) => {
    for (const m of moves || []) { try { app.window(m.id).setPosition(m.x, m.y); } catch (e) {} }
    return true;
  },
  savePos: ({ id, x, y }) => { setP('pos:' + id, { x, y }); return true; },
  saveSize: ({ id, w, h }) => { setP('size:' + id, { w, h }); return true; },
  refreshDock: (_p, app) => { refreshDocking(app); return true; },   // called live while dragging

  // Click any amp window → bring the whole set to the front (keeps them
  // together in z-order, like Winamp), the clicked one raised last so it stays
  // on top. show({ activate: false }) reorders without stealing its focus.
  raiseAll: async ({ except }, app) => {
    for (const id of await app.windows()) {
      // never show() the rack from here — raising a window that lives in its
      // own fullscreen Space would yank the user out of their current Space
      if (id === except || id === 'rack' || (id !== 'main' && !shown[id])) continue;
      try { app.window(id).show({ activate: false }); } catch (e) {}
    }
    try { app.window(except).show({ activate: false }); } catch (e) {}
    return true;
  },

  // ── global always-on-top (all windows at once) ────────────────────────────
  setOnTop: ({ value }, app) => { setOnTop(app, !!value); return alwaysOnTop; },

  // ── animated Dock icon on/off (context menus; tray menu calls it directly) ─
  setDockAnim: ({ value }, app) => { setDockAnim(app, !!value); return dockAnim; },

  // ── theme: system-following by default, manual override for every window ──
  // ── 1.5×/2× mode: scale every window (except the big screen / visualizer) ─
  setScale: async ({ value }, app) => {
    const next = value === 2 ? 2 : value === 1.5 ? 1.5 : 1;
    if (next === scale) return scale;
    const factor = next / scale;   // any step: 1→1.5, 1.5→2, 2→1…
    scale = next;
    setP('scale', scale);
    const wins = await app.windows();
    for (const id of ['main', ...wins]) {
      if (SCALE_EXCLUDE.has(id)) continue;
      try {
        const w = app.window(id);
        // ORDER MATTERS. GTK grows a window on the spot when its min-size
        // rises above its current size — so measure BEFORE floors move, and
        // resize from that measurement, or the clamp compounds with the
        // resize and every on/off cycle leaves the window bigger (seen live:
        // satellites at 4× after one round trip).
        const st = await w.getState();
        // A shaded satellite keeps the collapsed floor — restoring its design
        // floor here would clamp the bar straight back open (and drag.js's
        // scale handler deliberately leaves satellites to us, so nobody else
        // would put it back down).
        let shadedNow = false;
        try { shadedNow = !!(await store.get('shade:' + id)); } catch (e) {}
        const min = id === 'main' ? null
          : shadedNow ? SHADE_MIN
          : SATELLITES[id] && SATELLITES[id].minSize;
        if (min) w.setMinSize(...scaled(min, scale).split('x').map(Number));
        w.setZoom(scale);
        // main resizes itself (drag.js knows its shade state); satellites here
        if (id !== 'main') w.setSize(Math.round(st.width * factor), Math.round(st.height * factor));
      } catch (e) {}
    }
    app.push('scale', { scale });   // pages update zoom-dependent math (main resizes too)
    setTimeout(() => refreshDocking(app), 250);
    return scale;
  },

  setTheme: ({ value }, app) => {
    theme = ['light', 'dark'].includes(value) ? value : 'system';
    setP('theme', theme);
    app.push('theme', theme);      // every page repaints + updates its menu
    return theme;
  },

  // ── display color: which phosphor the small windows' readouts glow in ─────
  setLcd: ({ value }, app) => {
    lcd = ['amber', 'blue', 'red'].includes(value) ? value : 'green';
    setP('lcd', lcd);
    app.push('lcd', lcd);          // every page re-tints + updates its menu
    return lcd;
  },

  // ── where amp appears: Dock & menu bar (default), or just one of them ─────
  setPresence: ({ value }, app) => { applyPresence(app, value); return presence; },

  // ── visualizer engine choice (milk = butterchurn, geiss = Geiss HDR,
  //    speakers = the big screen's CSS speaker stacks; viz.js shows milk for it)
  getVizEngine: async () => { try { return (await store.get('vizEngine')) || 'milk'; } catch (e) { return 'milk'; } },
  // Persist ANY real engine (the old list dropped every GPU engine to 'milk',
  // so the big screen never matched the small viz), and broadcast it so the
  // viz window and the big screen mirror one visualizer selection live.
  setVizEngine: ({ value }, app) => {
    const ok = ['milk', 'geiss', 'magneto', 'lagoon', 'murmur', 'ballroom', 'perm', 'speakers', 'art'].includes(value) ? value : 'milk';
    setP('vizEngine', ok);
    app.push('vizEngine', ok);
    return true;
  },

  // ── track titles inside the visuals (the bar's T toggle; on by default) ───
  getVizTitles: async () => { try { const v = await store.get('vizTitles'); return v == null ? true : !!v; } catch (e) { return true; } },
  setVizTitles: ({ value }) => { setP('vizTitles', !!value); return true; },

  // ── which speakers flank the rack (the bar's ‹ › cycle these) ─────────────
  getSpkModel: async () => { try { return (await store.get('spkModel')) || 'towers'; } catch (e) { return 'towers'; } },
  setSpkModel: ({ value }) => { setP('spkModel', String(value || 'towers')); return true; },

  // ── world radio: the tuner's globe location, persisted ────────────────────
  getRadioLoc: async () => { try { return (await store.get('radioLoc')) || null; } catch (e) { return null; } },
  setRadioLoc: ({ city, lat, lon }) => { setP('radioLoc', { city, lat, lon }); return true; },

  // Nearby stations from the community radio-browser.info API. Queried from
  // the backend (txiki fetch — no page-origin strings attached); the page gets
  // a slim, https-only list sorted by real distance. The public hostname is
  // round-robin DNS over volunteer mirrors and individual mirrors do go down,
  // so walk a shortlist; the search radius widens until there's a dial's worth.
  radioStations: async ({ lat, lon }) => {
    const MIRRORS = ['de1', 'de2', 'nl1', 'at1', 'fi1'];
    const UA = { 'User-Agent': 'amp-tinyjs-example/0.2 (https://github.com/tarwin/tinyjsapp-examples)' };
    const grab = async (host, km) => {
      const u = 'https://' + host + '.api.radio-browser.info/json/stations/search?limit=200&hidebroken=true&lastcheckok=1'
        + '&geo_lat=' + lat + '&geo_long=' + lon + '&geo_distance=' + Math.round(km * 1000);
      const res = await Promise.race([
        fetch(u, { headers: UA }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000)),
      ]);
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    };
    for (const km of [150, 600, 2500]) {
      for (const host of MIRRORS) {
        let rows;
        try { rows = await grab(host, km); } catch (e) { continue; }
        // WKWebView terms: https only (ATS blocks plain http), and codecs the
        // <audio> element actually decodes (MP3 / AAC families / native HLS)
        const seen = new Set(), out = [];
        for (const s of rows) {
          const url = s.url_resolved || s.url || '';
          if (!/^https:\/\//i.test(url)) continue;
          if (!/^(MP3|AAC|AAC\+|HLS)$/i.test(s.codec || '')) continue;
          const name = String(s.name || '').trim();
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          out.push({
            name, url, uuid: s.stationuuid,
            codec: s.codec, bitrate: s.bitrate || 0,
            km: Math.round((s.geo_distance || 0) / 1000),
            place: s.state || s.country || '',
          });
        }
        out.sort((a, b) => a.km - b.km);
        if (out.length >= 12 || km === 2500) return { stations: out.slice(0, 40), radiusKm: km };
        break;   // this mirror answered but the radius is thin — widen it
      }
    }
    return { stations: [], radiusKm: 0 };
  },

  // Polite ecosystem citizenship: tell radio-browser a station got tuned (it
  // feeds their popularity ranking). Fire-and-forget, failures are nobody's.
  radioClick: ({ uuid }) => {
    if (!/^[0-9a-f-]{16,}$/i.test(String(uuid || ''))) return false;
    (async () => {
      for (const host of ['de1', 'nl1', 'at1']) {
        try {
          await fetch('https://' + host + '.api.radio-browser.info/json/url/' + uuid,
            { headers: { 'User-Agent': 'amp-tinyjs-example/0.2' } });
          return;
        } catch (e) {}
      }
    })();
    return true;
  },

  // Credits links open in the default browser, never inside an amp window.
  // app.shell.open, not `open`: that binary is macOS-only (linux wants
  // xdg-open, windows has no `open` at all) and shell.open picks per-OS
  openExternal: ({ url }, app) => {
    if (!/^https:\/\//i.test(String(url))) return false;
    app.shell.open(url).catch(() => {});
    return true;
  },

  // ── windowshade persistence ───────────────────────────────────────────────
  setShade: ({ id, value }, app) => { setP('shade:' + id, !!value); setTimeout(() => refreshDocking(app), 60); return true; },

  // A window changed height by `dh` (shade/unshade). Slide the windows docked
  // BELOW it — and the ones docked below those — by `dh` so they stay attached.
  reflow: async ({ id, dh, x0, x1, oldBottom }, app) => {
    const rects = {};
    for (const wid of await app.windows()) {
      if (wid === id || wid === 'rack' || (wid !== 'main' && !shown[wid])) continue;
      try { const s = await app.window(wid).getState(); rects[wid] = { x: s.x, y: s.y, w: s.width, h: s.height }; } catch (e) {}
    }
    const seen = new Set(), toMove = [];
    let frontier = [{ x0, x1, bottom: oldBottom }];
    while (frontier.length) {
      const f = frontier.shift();
      for (const wid in rects) {
        if (seen.has(wid)) continue;
        const w = rects[wid];
        if (w.x < f.x1 + 4 && f.x0 < w.x + w.w + 4 && Math.abs(w.y - f.bottom) <= 6) {
          seen.add(wid); toMove.push(wid);
          frontier.push({ x0: w.x, x1: w.x + w.w, bottom: w.y + w.h });
        }
      }
    }
    for (const wid of toMove) { const w = rects[wid]; try { app.window(wid).setPosition(w.x, w.y + dh); } catch (e) {} }
    setTimeout(() => refreshDocking(app), 40);
    return true;
  },
};

// Dock and/or menu bar. The Dock side is a live NSApp activation-policy flip
// (app.presence); the menu-bar side adds/removes the tray item. The
// context menu never offers "neither", so amp always stays reachable.
function applyPresence(app, value) {
  presence = ['menubar', 'dock'].includes(value) ? value : 'both';
  setP('presence', presence);
  try { app.presence(presence === 'menubar' ? 'menubar' : 'normal'); } catch (e) {}
  if (presence === 'dock') { try { app.tray.remove(); } catch (e) {} trayKey = ''; }
  else { trayKey = ''; updateTray(app); }
  syncDockAnim(app);                // menu-bar-only mode has no Dock icon to animate
  app.push('presence', presence);   // update every window's context-menu checkmarks
}

async function setOnTop(app, value) {
  alwaysOnTop = value;
  setP('ontop', value);
  await applyOnTopLevels(app);
  app.push('ontop', value);   // update every window's context-menu checkmark
  updateTray(app);
}

// The rack is exempt from floating: a floating-level window can't enter
// native fullscreen. And while the rack is UP, everyone else's floating is
// SUSPENDED too — floating windows hover over fullscreen Spaces, so an
// on-top playlist would photobomb the big screen. The preference itself
// (alwaysOnTop, menus, store) is untouched; levels are restored on exit.
async function applyOnTopLevels(app) {
  const effective = alwaysOnTop && !shown.rack;
  for (const id of await app.windows()) {
    if (id === 'rack') continue;
    try { app.window(id).setAlwaysOnTop(effective); } catch (e) {}
  }
}

// Which edges of each window are flush against another → push so the page can
// highlight the "attached" edge.
async function refreshDocking(app) {
  const rects = {};
  for (const id of await app.windows()) {
    if (id === 'rack') continue;
    if (id !== 'main' && !shown[id]) continue;
    try { const s = await app.window(id).getState(); rects[id] = { x: s.x, y: s.y, w: s.width, h: s.height }; } catch (e) {}
  }
  const ids = Object.keys(rects), T = 6;
  const ov = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
  for (const id of ids) {
    const a = rects[id], e = { t: false, b: false, l: false, r: false };
    for (const j of ids) {
      if (j === id) continue;
      const b = rects[j];
      const vov = ov(a.y, a.y + a.h, b.y, b.y + b.h), hov = ov(a.x, a.x + a.w, b.x, b.x + b.w);
      if (vov && Math.abs((a.x + a.w) - b.x) <= T) e.r = true;
      if (vov && Math.abs(a.x - (b.x + b.w)) <= T) e.l = true;
      if (hov && Math.abs((a.y + a.h) - b.y) <= T) e.b = true;
      if (hov && Math.abs(a.y - (b.y + b.h)) <= T) e.t = true;
    }
    try { app.window(id).push('docked', e); } catch (err) {}
  }
}

function screenOf(screens, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2;
  for (const s of screens || []) { const v = s.visible || s; if (cx >= v.x && cx < v.x + v.width && cy >= v.y && cy < v.y + v.height) return v; }
  const s0 = screens && screens[0]; return s0 ? (s0.visible || s0) : null;
}
// The ONE way a satellite gets opened. It used to be written out twice — in
// toggleWindow and again in the launch restore — and the two drifted: only
// toggleWindow knew about double-size, so quitting at 2x and relaunching
// brought the main window back big and every panel back small.
async function openSatellite(app, id) {
  const cfg = SATELLITES[id];
  if (!cfg) return false;
  const pos = await computePos(app, id);
  // viz and rack are resolution-independent — scaling them just wastes pixels
  const big = scale !== 1 && !SCALE_EXCLUDE.has(id);
  // a user-resized window comes back at its last size, not the stock one
  // (drag.js saves it after every native edge-resize; rack fullscreens itself)
  let savedSize = null;
  if (id !== 'rack') { try { savedSize = await store.get('size:' + id); } catch (e) {} }
  app.openWindow(id, {
    ...cfg,
    ...(big ? { size: scaled(cfg.size, scale), minSize: cfg.minSize ? scaled(cfg.minSize, scale) : undefined } : {}),
    ...(savedSize && Number.isFinite(savedSize.w) ? { size: savedSize.w + 'x' + savedSize.h } : {}),
    ...(pos || {}),
  });
  if (big) { try { app.window(id).setZoom(scale); } catch (e) {} }
  return true;
}

async function computePos(app, id) {
  if (id === 'rack') return null;   // it fullscreens itself; spawn position is moot
  let saved = null;
  try { saved = await store.get('pos:' + id); } catch (e) {}
  if (saved && Number.isFinite(saved.x)) return { x: saved.x, y: saved.y };
  try {
    const m = await app.window('main').getState();
    if (id === 'playlist') return { x: m.x, y: m.y + m.height };
    if (id === 'eq') return { x: m.x, y: m.y + m.height + 260 };
    if (id === 'radio') return { x: m.x, y: m.y + m.height + 260 + 206 };   // under the eq
    // viz: to the right of main — but flip to the left if it would run off-screen
    const vizW = 640;
    const scr = screenOf(await app.screens(), m.x, m.y, m.width, m.height);
    const right = m.x + m.width + 8;
    if (scr && right + vizW > scr.x + scr.width) return { x: Math.max(scr.x, m.x - vizW - 8), y: m.y };
    return { x: right, y: m.y };
  } catch (e) { return null; }
}

// ── tray "pill": rasterize the split menu-bar item to a PNG ourselves ──────
// till's recipe: the tray is ONE NSStatusItem — no two-item split, and a text
// title's width shifts every second. So draw the whole widget (a glyph chip +
// a time chip, like Harvest's) into an RGBA buffer at a FIXED size and
// hand-encode a PNG (@2x, 144 dpi pHYs → retina-crisp). The click "split" is
// geometry, resolved in onTray. Idle shows the AMP wordmark; with a track
// loaded the chip is the elapsed time, amber while playing.
const TS = 2;                                  // render scale (2 = retina)
const TW = 68 * TS, TH = 22 * TS;              // fixed item size in px
const FONT = {                                 // 3×5 bitmap font, MSB = left px
  '0': [0b111, 0b101, 0b101, 0b101, 0b111], '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111], '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001], '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111], '7': [0b111, 0b001, 0b010, 0b100, 0b100],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111], '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  ':': [0b000, 0b010, 0b000, 0b010, 0b000], '-': [0b000, 0b000, 0b111, 0b000, 0b000],
  'A': [0b010, 0b101, 0b111, 0b101, 0b101], 'M': [0b101, 0b111, 0b111, 0b101, 0b101],
  'P': [0b110, 0b101, 0b110, 0b100, 0b100], ' ': [0, 0, 0, 0, 0],
  'L': [0b100, 0b100, 0b100, 0b100, 0b111], 'I': [0b111, 0b010, 0b010, 0b010, 0b111],
  'V': [0b101, 0b101, 0b101, 0b101, 0b010], 'E': [0b111, 0b100, 0b111, 0b100, 0b111],
};
function blend(buf, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= TW || y >= TH || a <= 0) return;
  const i = (y * TW + x) * 4, ia = a / 255, ib = 1 - ia;
  buf[i] = r * ia + buf[i] * ib; buf[i + 1] = g * ia + buf[i + 1] * ib;
  buf[i + 2] = b * ia + buf[i + 2] * ib;
  buf[i + 3] = Math.min(255, a + buf[i + 3] * ib);   // src-over: αo = αs + αd(1−αs)
}
function fillRR(buf, x0, y0, x1, y1, rad, r, g, b, a) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    let dx = 0, dy = 0;
    if (x < x0 + rad) dx = x0 + rad - x; else if (x >= x1 - rad) dx = x - (x1 - rad - 1);
    if (y < y0 + rad) dy = y0 + rad - y; else if (y >= y1 - rad) dy = y - (y1 - rad - 1);
    if (dx && dy && dx * dx + dy * dy > rad * rad) continue;
    blend(buf, x, y, r, g, b, a);
  }
}
function drawGlyph(buf, playing, cx, cy, sz, r, g, b, a) {
  if (playing) {                       // pause: two bars
    const bw = Math.max(2, Math.round(sz * 0.30)), h = Math.round(sz / 2);
    for (let xx = 0; xx < bw; xx++) for (let yy = -h; yy <= h; yy++) {
      blend(buf, cx + xx, cy + yy, r, g, b, a);
      blend(buf, cx + sz - bw + xx, cy + yy, r, g, b, a);
    }
  } else {                             // play: right-pointing triangle
    for (let xx = 0; xx < sz; xx++) {
      const half = Math.round((sz / 2) * (1 - xx / sz));
      for (let yy = -half; yy <= half; yy++) blend(buf, cx + xx, cy + yy, r, g, b, a);
    }
  }
}
function drawText(buf, x, y, str, sc, r, g, b, a) {
  let cx = x;
  for (const ch of str) {
    const gl = FONT[ch] || FONT[' '];
    const narrow = ch === ':' || ch === '-';        // tighter advance for punctuation
    for (let ry = 0; ry < 5; ry++) for (let rx = 0; rx < 3; rx++)
      if (gl[ry] & (1 << (2 - rx)))
        for (let yy = 0; yy < sc; yy++) for (let xx = 0; xx < sc; xx++)
          blend(buf, cx + rx * sc + xx, y + ry * sc + yy, r, g, b, a);
    cx += (narrow ? 2 : 3) * sc + sc;               // glyph width + 1px gap
  }
}
function textWidth(str, sc) {          // mirror of drawText's advances
  let w = 0;
  for (const ch of str) w += ((ch === ':' || ch === '-') ? 2 : 3) * sc + sc;
  return w - sc;                       // no trailing gap
}
// hand-rolled PNG (RGBA, uncompressed/stored zlib) — no image lib in txiki
let _crc;
function crc32(b) {
  if (!_crc) { _crc = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); _crc[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = _crc[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
function adler32(b) { let a = 1, s = 0; for (let i = 0; i < b.length; i++) { a = (a + b[i]) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; }
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function chunk(type, data) {
  const body = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3), ...data];
  return [...u32(data.length), ...body, ...u32(crc32(Uint8Array.from(body)))];
}
function encodePNG(rgba, w, h) {
  const raw = [];
  for (let y = 0; y < h; y++) { raw.push(0); for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; raw.push(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]); } }
  const z = [0x78, 0x01]; let p = 0;                 // stored deflate
  while (p < raw.length) { const len = Math.min(65535, raw.length - p), last = (p + len >= raw.length) ? 1 : 0;
    z.push(last, len & 255, (len >> 8) & 255, (~len) & 255, ((~len) >> 8) & 255);
    for (let i = 0; i < len; i++) z.push(raw[p + i]); p += len; }
  z.push(...u32(adler32(Uint8Array.from(raw))));
  const ppm = 5669;                                  // 144 dpi → retina point size
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', [...u32(w), ...u32(h), 8, 6, 0, 0, 0]),
    ...chunk('pHYs', [...u32(ppm), ...u32(ppm), 1]),
    ...chunk('IDAT', z), ...chunk('IEND', [])]);
}
function renderTrayPNG(playing, text) {
  const buf = new Uint8Array(TW * TH * 4);
  const cy = Math.round(TH / 2), rad = 4 * TS;
  const glyphW = 20 * TS, gap = 3 * TS;              // glyph chip 20pt + 3pt gap
  // glyph chip: amp amber while playing (dark glyph), gray idle (white glyph)
  if (playing) fillRR(buf, 0, TS, glyphW, TH - TS, rad, 255, 180, 55, 255);
  else fillRR(buf, 0, TS, glyphW, TH - TS, rad, 118, 120, 126, 255);
  // text chip: dark, LED-style amber digits while playing
  fillRR(buf, glyphW + gap, TS, TW, TH - TS, rad, 62, 63, 68, 255);
  const gsz = 9 * TS;
  if (playing) drawGlyph(buf, true, Math.round((glyphW - gsz) / 2), cy, gsz, 30, 22, 6, 255);
  else drawGlyph(buf, false, Math.round((glyphW - gsz) / 2) + TS, cy, gsz, 255, 255, 255, 255);
  const sc = 2 * TS;
  const tx = glyphW + gap + Math.round((TW - glyphW - gap - textWidth(text, sc)) / 2);
  if (playing) drawText(buf, tx, cy - Math.round(2.5 * sc), text, sc, 255, 180, 55, 255);
  else drawText(buf, tx, cy - Math.round(2.5 * sc), text, sc, 235, 237, 242, 190);
  return encodePNG(buf, TW, TH);
}
let trayN = 0;
const trayPath = () => (tjs.env.TMPDIR || '/tmp').replace(/\/$/, '') + '/amp-tray-' + (trayN ^= 1) + '.png';
const fmtMS = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ── menu-bar item: split pill — ▶/⏸ chip toggles, time chip opens the player
let trayKey = '';
function updateTray(app) {
  if (presence === 'dock') return;   // Dock-only mode: no tray item at all
  const playing = !!(latest && latest.playing);
  const title = latest && latest.title;
  // radio is a live stream — no elapsed time to show, it reads LIVE instead
  const text = latest && latest.radio ? 'LIVE' : title ? fmtMS(latest.elapsed) : 'AMP';
  const key = playing + '|' + text + '|' + alwaysOnTop + '|' + presence + '|' + dockAnim + '|' + artLookup;
  if (key === trayKey) return;
  trayKey = key;
  const menu = [
    { id: 'playpause', label: playing ? 'Pause' : 'Play' },
    { id: 'next', label: 'Next' },
    { id: 'prev', label: 'Previous' },
    { separator: true },
    { id: 'ontop', label: 'Always on Top', checked: alwaysOnTop },
    { id: 'dockanim', label: 'Animated Dock Icon', checked: dockAnim },
    { id: 'artlookup', label: 'Look Up Missing Artwork', checked: artLookup },
    { label: 'Appear In', submenu: [
      { id: 'presence:both', label: 'Dock & Menu Bar', checked: presence === 'both' },
      { id: 'presence:menubar', label: 'Menu Bar Only', checked: presence === 'menubar' },
      { id: 'presence:dock', label: 'Dock Only', checked: presence === 'dock' },
    ] },
    { id: 'show', label: 'Show Player' },
    { id: 'check-updates', label: 'Check for Updates…' },
    { id: 'quit', label: 'Quit amp' },
  ];
  const tooltip = title ? (playing ? '▶ ' : '⏸ ') + title : 'amp — ▶ plays · the time opens the player';
  // draw the fixed-width pill; fall back to the old SF symbol if anything trips
  (async () => {
    const spec = { tooltip, primaryAction: true, menu };
    try {
      const path = trayPath();
      await tjs.writeFile(path, renderTrayPNG(playing, text));
      app.tray.set({ ...spec, title: '', icon: path, template: false });
    } catch (e) {
      app.tray.set({ ...spec, icon: playing ? 'sf:pause.fill' : 'sf:play.fill' });
    }
  })();
}

export function onTray(id, app) {
  if (id === 'check-updates') return checkForUpdates(app);
  const send = (type) => app.window('main').push('action', { type });
  if (id === null) {
    // the "split": one NSStatusItem, two zones by geometry — compare the click
    // position against the item rect (till's trick; the cursor read right
    // after the click is close enough to where it landed)
    (async () => {
      try {
        const [spot, mouse] = await Promise.all([app.tray.position(), app.mousePosition()]);
        if (mouse.x < spot.x + 26) send('toggle');               // the ▶/⏸ chip
        else { app.show(); app.window('main').show(); }          // the time chip
      } catch (e) { send('toggle'); }
    })();
  }
  else if (id === 'playpause') send('toggle');
  else if (id === 'next') send('next');
  else if (id === 'prev') send('prev');
  else if (id === 'ontop') setOnTop(app, !alwaysOnTop);
  else if (id === 'dockanim') setDockAnim(app, !dockAnim);
  else if (id === 'artlookup') setArtLookup(app, !artLookup);
  else if (id && id.startsWith('presence:')) applyPresence(app, id.slice(9));
  else if (id === 'show') { app.show(); app.window('main').show(); }
  else if (id === 'quit') app.quit();
}

// ── animated Dock icon: the page renders spectrum-bar frames of the icon,
// we flip through them while music plays (app.icon; '' = bundle icon) ──
let dockAnim = true;               // persisted; toggle in tray + context menus
let dockFramePaths = [], dockTimer = 0, dockN = 0;
function syncDockAnim(app) {
  const want = dockAnim && presence !== 'menubar' && dockFramePaths.length &&
    !!(latest && latest.playing);
  if (want && !dockTimer) {
    dockTimer = setInterval(() => {
      try { app.icon(dockFramePaths[dockN++ % dockFramePaths.length]); } catch (e) {}
    }, 320);
  } else if (!want && dockTimer) {
    clearInterval(dockTimer); dockTimer = 0;
    try { app.icon(''); } catch (e) {}
  }
}
function setDockAnim(app, value) {
  dockAnim = !!value;
  setP('dockAnim', dockAnim);
  trayKey = ''; updateTray(app);     // refresh the menu checkmark
  app.push('dockanim', dockAnim);    // update every window's context menu
  syncDockAnim(app);
}

function setArtLookup(app, value) {
  artLookup = !!value;
  setP('artLookup', artLookup);
  trayKey = ''; updateTray(app);
  app.push('artlookup', artLookup);
  // tracks already given up on need another go now that we're allowed to ask
  if (artLookup) for (const [p, v] of artCache) if (!v.art) artCache.delete(p);
}

export function onWindowClosed(id, app) {
  if (id in shown) { shown[id] = false; setP('panels', { ...shown }); app.push('windows', { ...shown }); }
  if (id === 'rack') applyOnTopLevels(app);   // rack gone → floating comes back
}

// (The radio-analysis relay that used to live here is gone: since tinyjs
// 0.24, pages stream the station through tiny.proxyURL themselves — the
// proxy strips the CORS taint, so their MediaElementSources get real
// samples and the backend stays out of the audio path entirely.)

export function init(app) {
  store = app.store;
  // the on-disk sleeve cache + the User-Agent MusicBrainz asks for; neither
  // module opens a connection until something actually calls it
  lookup.init({ dir: ART_DIR, version: APP_VERSION });
  icy.init({ version: APP_VERSION });
  (async () => {
    try {
      const [tracks, meta, panels, ontop, mainPos, savedTheme, savedPresence, savedDockAnim, savedLcd, savedArtLookup] = await Promise.all([
        store.get('playlist'), store.get('meta'), store.get('panels'),
        store.get('ontop'), store.get('pos:main'),
        store.get('theme'), store.get('presence'), store.get('dockAnim'), store.get('lcd'),
        store.get('artLookup'),
      ]);
      try { const sv = await store.get('scale'); scale = (sv === 2 || sv === 1.5) ? sv : 1; } catch (e) {}
      try { const sf = await store.get('soundfont'); if (SOUNDFONTS.some((s) => s.id === sf)) sfActive = sf; } catch (e) {}
      // midicache is legacy — renders live in memory now, in the window that
      // made them (render.js). Sweep an old install's wavs once and move on.
      (async () => {
        try {
          for await (const e of await tjs.readDir(MIDI_CACHE_DIR))
            await tjs.remove(MIDI_CACHE_DIR + '/' + e.name).catch(() => {});
          await tjs.remove(MIDI_CACHE_DIR).catch(() => {});
        } catch (e) {}
      })();
      if (scale !== 1) { try { app.window('main').setZoom(scale); } catch (e) {} }
      alwaysOnTop = !!ontop;
      dockAnim = savedDockAnim == null ? true : !!savedDockAnim;
      theme = ['light', 'dark'].includes(savedTheme) ? savedTheme : 'system';
      lcd = ['amber', 'blue', 'red'].includes(savedLcd) ? savedLcd : 'green';
      artLookup = !!savedArtLookup;      // never on unless it was turned on
      // tray is created here (not before the store read) so Dock-only mode
      // never flashes a tray item at launch
      applyPresence(app, savedPresence);
      // First launch ever (no playlist has ever been persisted) → greet with
      // the bundled examples. `null` means never-saved; an empty [] means the
      // user cleared it, so we DON'T reseed then — the examples never nag.
      const seeded = tracks == null ? SAMPLE_TRACKS() : tracks;
      latest = { tracks: seeded, idx: -1, playing: false, elapsed: 0, duration: 0,
                 volume: meta?.volume ?? 0.8, balance: meta?.balance ?? 0,
                 eq: meta?.eq ?? null, wantIdx: meta?.idx ?? -1, restored: true };
      // restore main window: position + always-on-top
      if (mainPos && Number.isFinite(mainPos.x)) app.setPosition(mainPos.x, mainPos.y);
      if (alwaysOnTop) app.setAlwaysOnTop(true);
      // reopen the panels that were open last time
      for (const id of ['playlist', 'eq', 'radio', 'podcast', 'viz']) {
        if (panels && panels[id]) {
          await openSatellite(app, id);      // carries double-size, same as toggleWindow
          shown[id] = true;
          if (alwaysOnTop) setTimeout(() => { try { app.window(id).setAlwaysOnTop(true); } catch (e) {} }, 80);
        }
      }
      app.push('windows', { ...shown });
      app.push('artlookup', artLookup);
      setTimeout(() => refreshDocking(app), 400);
    } catch (e) {
      applyPresence(app, presence);   // store failed → still get the default tray up
    }
  })();
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

// Finder double-click / "Open With" / Dock-icon drop / `amp song.mp3` from a
// terminal — the OS routes every extension in tinyjs.json's fileExtensions
// here, whether amp was running or not. A double-click means "play this":
// the deck appends and starts the first one. When the click LAUNCHED amp the
// page isn't listening yet, so the paths also park for its boot-time
// openPending call (same trick as the info window's inspectTarget).
export function onOpenFiles(paths, app) {
  const AUDIO = /\.(mp3|m4a|aac|mp4|flac|wav|aif|aiff|caf|oga|ogg|opus|mid|midi|mod|s3m|xm|it|mptm)$/i;
  const good = (paths || []).filter((p) => AUDIO.test(String(p)));
  if (!good.length) return;
  openPendingFiles = { paths: good, t: Date.now() };
  try { app.show(); } catch (e) {}
  try { app.window('main').push('action', { type: 'open', paths: good }); } catch (e) {}
}
