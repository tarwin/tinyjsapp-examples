// pod.js — the 2003 firmware, reverently reimplemented.
//
// Everything is a stack of menus you scroll with the wheel: Playlists,
// Browse (Artists / Albums / Songs), Extras, Settings, Backlight — MENU
// pops back up, the centre button descends. Now Playing shows "3 of 12",
// three lines of text and a progress bar; the wheel there is VOLUME, and
// the centre button switches to scrubbing, exactly as it was. The wheel
// ticks (Settings → Clicker), the backlight times out (Settings →
// Backlight Timer), shuffle and repeat live where they always lived.
//
// Skipping tracks is allowed. It's an iPod — that was the whole point.

const $canvas = document.getElementById('pod');

let library = { dir: null, albums: [] };
let artists = [];                    // [{ name, albums: [...] }]
let allSongs = [];                   // [{ path, name, artist, album }]
let settings = { shuffle: 'Off', repeat: 'Off', clicker: true, blTimer: '10 sec' };
let volume = 0.8;
let ui = { presence: 'both', login: 'unsupported', dir: null };
let winShown = true;

// ── the clicker ────────────────────────────────────────────────────────────
const actx = new (window.AudioContext || window.webkitAudioContext)();
function click() {
  if (!settings.clicker) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'square';
  o.frequency.value = 1560;
  g.gain.setValueAtTime(0.06, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.014);
  o.connect(g); g.connect(actx.destination);
  o.start(); o.stop(actx.currentTime + 0.016);
}

// ── the player ─────────────────────────────────────────────────────────────
const fileURL = (p) => tiny.fileURL(p);
const el = new Audio();
let queue = [], qi = -1;

function applyVolume() { el.volume = volume; }

function playList(tracks, start) {
  queue = [...tracks];
  if (settings.shuffle === 'Songs') {
    const chosen = queue.splice(start, 1)[0];
    for (let i = queue.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    queue.unshift(chosen);
    qi = 0;
  } else qi = start;
  loadCurrent(true);
}

function loadCurrent(autoplay) {
  const t = queue[qi];
  if (!t) return;
  el.src = fileURL(t.path);
  applyVolume();
  if (autoplay) el.play().catch(() => {});
  paint();
}

function next() {
  if (!queue.length) return;
  if (qi < queue.length - 1) { qi++; loadCurrent(true); }
  else if (settings.repeat === 'All') { qi = 0; loadCurrent(true); }
  else { el.pause(); paint(); }
}
function prev() {
  if (!queue.length) return;
  if (el.currentTime > 3 || qi === 0) { el.currentTime = 0; el.play().catch(() => {}); }
  else { qi--; loadCurrent(true); }
}
el.addEventListener('ended', () => {
  if (settings.repeat === 'One') { el.currentTime = 0; el.play().catch(() => {}); }
  else next();
});

// ── screens: a stack of menus, plus the specials ───────────────────────────
const ROWS = 6;
let stack = [];
let npMode = 'progress';             // 'progress' | 'volume' | 'scrub'
let npVolT = 0;

const topScreen = () => stack[stack.length - 1];

function menuScreen(title, items) { return { kind: 'menu', title, items, sel: 0, scroll: 0 }; }

function mainMenu() {
  const items = [
    { label: 'Playlists', arrow: true, go: () => push(menuScreen('Playlists', [{ label: 'No playlists on this iPod' }])) },
    { label: 'Browse', arrow: true, go: () => push(browseMenu()) },
    { label: 'Extras', arrow: true, go: () => push(extrasMenu()) },
    { label: 'Settings', arrow: true, go: () => push(settingsMenu()) },
    { label: 'Backlight', go: () => toggleBacklight() },
  ];
  if (queue.length) items.push({ label: 'Now Playing', arrow: true, go: () => push({ kind: 'now' }) });
  return menuScreen('iPod', items);
}

function browseMenu() {
  return menuScreen('Browse', [
    { label: 'Artists', arrow: true, go: () => push(artistsMenu()) },
    { label: 'Albums', arrow: true, go: () => push(albumsMenu(library.albums, 'Albums')) },
    { label: 'Songs', arrow: true, go: () => push(songsMenu(allSongs, 'Songs')) },
  ]);
}

function artistsMenu() {
  return menuScreen('Artists', artists.map((a) => ({
    label: a.name, arrow: true,
    go: () => push(albumsMenu(a.albums, a.name, a)),
  })));
}

function albumsMenu(albums, title, artist) {
  const items = albums.map((al) => ({
    label: al.title, arrow: true,
    go: () => push(songsMenu(al.tracks.map((t) => ({ ...t, artist: al.artist, album: al.title })), al.title)),
  }));
  if (artist && albums.length > 1) {
    const all = albums.flatMap((al) => al.tracks.map((t) => ({ ...t, artist: al.artist, album: al.title })));
    items.unshift({ label: 'All', arrow: true, go: () => push(songsMenu(all, artist.name)) });
  }
  return menuScreen(title, items);
}

function songsMenu(songs, title) {
  return menuScreen(title, songs.map((s, i) => ({
    label: s.name,
    go: () => { playList(songs, i); replaceTopWith({ kind: 'now' }); },
  })));
}

function extrasMenu() {
  return menuScreen('Extras', [
    { label: 'Sample Track', arrow: true, go: playSample },
    { label: 'Clock', arrow: true, go: () => push({ kind: 'clock' }) },
    { label: 'About', arrow: true, go: () => push(aboutScreen()) },
  ]);
}

// play the bundled sample even when a real library is loaded (the demo album
// only rides in library.albums before you've chosen a folder)
async function playSample() {
  const al = await tiny.api.call('sampleAlbum', {}).catch(() => null);
  if (!al) return;
  const songs = al.tracks.map((t) => ({ ...t, artist: al.artist, album: al.title }));
  playList(songs, 0);
  push({ kind: 'now' });
}

function aboutScreen() {
  const n = allSongs.length;
  return {
    kind: 'note', title: 'About',
    lines: ['podd', n + ' song' + (n === 1 ? '' : 's'), 'a 2003 iPod for your desktop', 'tinyjs · tarwin.art'],
  };
}

function settingsMenu() {
  const cyc = (key, vals) => () => {
    const i = vals.indexOf(settings[key]);
    settings[key] = vals[(i + 1) % vals.length];
    saveSettings();
    refreshSettings();
  };
  const presLabel = { dock: 'Dock', menubar: 'Menu Bar', both: 'Both' };
  const m = menuScreen('Settings', [
    { label: 'Shuffle', value: settings.shuffle, go: cyc('shuffle', ['Off', 'Songs']) },
    { label: 'Repeat', value: settings.repeat, go: cyc('repeat', ['Off', 'One', 'All']) },
    { label: 'Clicker', value: settings.clicker ? 'On' : 'Off', go: () => { settings.clicker = !settings.clicker; saveSettings(); refreshSettings(); } },
    { label: 'Backlight Timer', value: settings.blTimer, go: cyc('blTimer', ['Off', '5 sec', '10 sec', '20 sec', 'Always On']) },
    { label: 'Music Folder', value: ui.dir ? ui.dir.split('/').pop() : 'None', go: () => chooseFolder() },
    { label: 'Show In', value: presLabel[ui.presence] || 'Both', go: async () => {
      const order = ['both', 'dock', 'menubar'];
      const nextMode = order[(order.indexOf(ui.presence) + 1) % order.length];
      ui.presence = await tiny.api.call('uiSetPresence', { mode: nextMode });
      refreshSettings();
    } },
    { label: 'Open at Login', value: ui.login === 'unsupported' ? 'App Only' : (ui.login === 'enabled' ? 'On' : 'Off'), go: async () => {
      if (ui.login === 'unsupported') return;
      ui.login = await tiny.api.call('uiSetLogin', { on: ui.login !== 'enabled' });
      refreshSettings();
    } },
    { label: 'Reset All Settings', go: () => { settings = { shuffle: 'Off', repeat: 'Off', clicker: true, blTimer: '10 sec' }; saveSettings(); refreshSettings(); } },
  ]);
  return m;
}
function refreshSettings() {
  const t = topScreen();
  if (t && t.title === 'Settings') {
    const sel = t.sel, scroll = t.scroll;
    stack[stack.length - 1] = settingsMenu();
    topScreen().sel = sel; topScreen().scroll = scroll;
  }
  paint();
}
function saveSettings() { try { tiny.store.set('settings', settings); } catch (e) {} }

function push(s) { stack.push(s); paint(); }
function pop() { if (stack.length > 1) { stack.pop(); paint(); } }
function replaceTopWith(s) { stack.push(s); paint(); }

// ── backlight ──────────────────────────────────────────────────────────────
let blOn = false, blTimer = 0;
function backlightSecs() {
  return { 'Off': 0, '5 sec': 5, '10 sec': 10, '20 sec': 20, 'Always On': Infinity }[settings.blTimer] ?? 10;
}
function poke() {
  const secs = backlightSecs();
  if (secs > 0) setBacklight(true);
  clearTimeout(blTimer);
  if (secs > 0 && secs !== Infinity) blTimer = setTimeout(() => setBacklight(false), secs * 1000);
}
function toggleBacklight() {
  setBacklight(!blOn);
  clearTimeout(blTimer);
  const secs = backlightSecs();
  if (blOn && secs > 0 && secs !== Infinity) blTimer = setTimeout(() => setBacklight(false), secs * 1000);
}
function setBacklight(on) { blOn = on; DEVICE.setBacklight(on); paint(); }

// ── drawing ────────────────────────────────────────────────────────────────
let lastTraySync = '';
function syncTray() {
  const tr = queue[qi];
  const state = { playing: !!(tr && !el.paused), track: tr ? tr.name + ' — ' + (tr.artist || '') : null };
  const key = JSON.stringify(state);
  if (key === lastTraySync) return;
  lastTraySync = key;
  tiny.api.call('uiTraySync', state).catch(() => {});
}

function paint() {
  syncTray();
  const t = topScreen();
  if (!t) return;
  if (t.kind === 'menu') {
    if (t.sel < t.scroll) t.scroll = t.sel;
    if (t.sel >= t.scroll + ROWS) t.scroll = t.sel - ROWS + 1;
    SCREEN.menu(t.title, t.items, t.sel, t.scroll, queue.length ? (el.paused ? 'pause' : 'play') : null);
  } else if (t.kind === 'now') {
    const tr = queue[qi] || {};
    SCREEN.nowPlaying({
      index: qi + 1, count: queue.length,
      title: tr.name, artist: tr.artist, album: tr.album,
      playing: !el.paused,
      elapsed: el.currentTime || 0,
      duration: el.duration || 0,
      mode: npMode === 'volume' ? 'volume' : npMode === 'scrub' ? 'scrub' : 'progress',
      volume,
    });
  } else if (t.kind === 'clock') {
    SCREEN.clock();
  } else if (t.kind === 'note') {
    SCREEN.note(t.title, t.lines);
  }
}
setInterval(() => {
  const t = topScreen();
  if (t && (t.kind === 'now' || t.kind === 'clock')) paint();
  if (npMode === 'volume' && performance.now() - npVolT > 1600) { npMode = 'progress'; paint(); }
}, 250);

// ── the controls mean things ───────────────────────────────────────────────
DEVICE.init($canvas, {
  onWheel(dir) {
    poke();
    const t = topScreen();
    if (!t) return;
    if (t.kind === 'menu') {
      const n = t.items.length;
      if (!n) return;
      const was = t.sel;
      t.sel = Math.min(n - 1, Math.max(0, t.sel + dir));
      if (t.sel !== was) { click(); paint(); }
    } else if (t.kind === 'now') {
      if (npMode === 'scrub') {
        if (el.duration) el.currentTime = Math.min(el.duration - 0.2, Math.max(0, el.currentTime + dir * Math.max(2, el.duration / 60)));
      } else {
        npMode = 'volume';
        npVolT = performance.now();
        volume = Math.min(1, Math.max(0, volume + dir * -0.05));   // up = louder
        applyVolume();
        try { tiny.store.set('volume', volume); } catch (e) {}
      }
      click();
      paint();
    }
  },
  onSelect() {
    poke();
    if (actx.state === 'suspended') actx.resume();
    const t = topScreen();
    if (!t) return;
    if (t.kind === 'menu') {
      const it = t.items[t.sel];
      if (it && it.go) { click(); it.go(); }
    } else if (t.kind === 'now') {
      npMode = npMode === 'scrub' ? 'progress' : 'scrub';
      npVolT = 0;
      click();
      paint();
    }
  },
  onButton(name) {
    poke();
    if (actx.state === 'suspended') actx.resume();
    if (name === 'menu') {
      const t = topScreen();
      if (t && t.kind === 'now') npMode = 'progress';
      pop();
    } else if (name === 'play') {
      if (!queue.length) return;
      if (el.paused) el.play().catch(() => {}); else el.pause();
      paint();
    } else if (name === 'next') next();
    else if (name === 'back') prev();
  },
  onButtonHold(name) {
    poke();
    if (!el.duration) return;
    if (name === 'next') el.currentTime = Math.min(el.duration - 0.2, el.currentTime + 4);
    else if (name === 'back') el.currentTime = Math.max(0, el.currentTime - 4);
    if (topScreen() && topScreen().kind === 'now') paint();
  },
});

window.addEventListener('resize', () => DEVICE.resize());

// wherever the widget sits, it angles a touch toward the screen's centre —
// enough to tell, not enough to pose. Polled: drags don't announce themselves.
async function centerLean() {
  try {
    const st = await tiny.win.getState();
    if (!st || !st.screen) return;
    const nx = Math.max(-1, Math.min(1, ((st.x + st.width / 2) - st.screen.width / 2) / (st.screen.width / 2)));
    const ny = Math.max(-1, Math.min(1, ((st.y + st.height / 2) - st.screen.height / 2) / (st.screen.height / 2)));
    DEVICE.setBaseLean(-nx * 0.13, ny * 0.055);   // low on screen → tips up toward centre
  } catch (e) {}
}
setInterval(centerLean, 900);
centerLean();
window.addEventListener('contextmenu', (e) => e.preventDefault());

// ── library plumbing ───────────────────────────────────────────────────────
function buildIndex() {
  const byArtist = new Map();
  allSongs = [];
  for (const al of library.albums) {
    const key = al.artist || 'Unknown Artist';
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key).push(al);
    for (const t of al.tracks) allSongs.push({ ...t, artist: al.artist, album: al.title });
  }
  artists = [...byArtist.entries()].map(([name, albums]) => ({ name, albums }))
    .sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
  allSongs.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
}

async function loadLibrary() {
  library = await tiny.api.call('getLibrary', {});
  buildIndex();
  stack = [mainMenu()];
  if (!library.albums.length) {
    stack.push({
      kind: 'note', title: 'iPod',
      lines: library.dir ? ['No music found in', library.dir.split('/').pop()] : ['No music on this iPod.', 'Right-click → nothing. Use the', 'iPod menu: Choose Music Folder'],
    });
  }
  paint();
}

async function chooseFolder() {
  const dir = await tiny.win.pickFolder();
  if (!dir) return;
  library = await tiny.api.call('setLibrary', { dir });
  ui.dir = dir;
  buildIndex();
  stack = [mainMenu()];
  paint();
}

tiny.api.on('menu', ({ id }) => {
  if (id === 'choose') chooseFolder();
  else if (id === 'rescan') loadLibrary();
});
tiny.api.on('tray', () => {
  winShown = !winShown;
  if (winShown) tiny.win.show({ activate: true });
  else tiny.win.hide();
});
tiny.api.on('trayCmd', ({ cmd }) => {
  if (cmd === 'playpause') { if (queue.length) { if (el.paused) el.play().catch(() => {}); else el.pause(); paint(); } }
  else if (cmd === 'next') next();
  else if (cmd === 'prev') prev();
});
tiny.api.on('boot', () => loadLibrary());

(async () => {
  try { ui = await tiny.api.call('uiGet', {}); } catch (e) {}
  try { Object.assign(settings, (await tiny.store.get('settings')) || {}); } catch (e) {}
  try { const v = await tiny.store.get('volume'); if (typeof v === 'number') volume = v; } catch (e) {}
  applyVolume();
  stack = [mainMenu()];
  paint();
  poke();
  loadLibrary();
})();
