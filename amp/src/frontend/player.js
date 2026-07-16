// player.js — the main window: audio host and brain.
//
// Only this window owns the <audio> element and the Web Audio graph. The
// playlist, equalizer, and visualizer are separate OS windows that send their
// intentions here through the backend (api 'action' → pushed to us as an
// 'action' event), and we broadcast our state back out via api 'publish'.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s);

const EQ_FREQS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];

const audio = new Audio();
audio.preload = 'auto';

let ctx, srcNode, preamp, bands, hpPre, hpFilters, panner, analyser, masterGain, freqData;
let tracks = [];               // [{ path, name, duration }]
let cur = -1;
let nextUp = -1;               // single-click in the playlist queues this to play next
let wantPlay = false;
let shuffle = false, repeatMode = 0;   // 0 off · 1 all · 2 one
let volume = 0.8, balance = 0;
let eqState = { on: false, preamp: 0, bands: new Array(10).fill(0) };
let peaks = [];

// ── Web Audio graph (built lazily on first playback / gesture) ─────────────
function ensureCtx() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  srcNode = ctx.createMediaElementSource(audio);
  preamp = ctx.createGain();
  bands = EQ_FREQS.map((f) => {
    const b = ctx.createBiquadFilter();
    b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0;
    return b;
  });
  // headphone correction (AutoEq): its own preamp + up to 10 parametric
  // filters, retuned per profile — independent of the graphic EQ's ON switch
  hpPre = ctx.createGain();
  hpFilters = Array.from({ length: 10 }, () => {
    const b = ctx.createBiquadFilter();
    b.type = 'peaking'; b.frequency.value = 1000; b.Q.value = 1; b.gain.value = 0;
    return b;
  });
  try { panner = ctx.createStereoPanner(); } catch (e) { panner = null; }
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.78;
  freqData = new Uint8Array(analyser.frequencyBinCount);

  srcNode.connect(preamp);
  let tail = preamp;
  for (const b of bands) { tail.connect(b); tail = b; }
  tail.connect(hpPre); tail = hpPre;
  for (const b of hpFilters) { tail.connect(b); tail = b; }
  if (panner) { tail.connect(panner); tail = panner; }
  // master volume must be a gain node — audio.volume on a graph-routed element
  // has no effect in WebKit (the signal is tapped before the element's volume).
  masterGain = ctx.createGain();
  tail.connect(analyser);
  analyser.connect(masterGain);
  masterGain.connect(ctx.destination);
  applyEq(eqState);
  applyBalance();
}
function resumeCtx() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

// ── track loading / transport ──────────────────────────────────────────────
// readAccess (tinyjs.json) lets <audio> load the file straight off disk — no
// bytes cross the bridge; we only ask the backend for the size (for kbps).
async function loadTrack(i, autoplay) {
  if (i < 0 || i >= tracks.length) return;
  cur = i;
  if (nextUp === i) nextUp = -1;   // playing the queued track consumes the queue
  const t = tracks[i];
  setTitle(t.name);
  wantPlay = !!autoplay;
  audio.src = window.ampFileURL(t.path);
  audio.load();
  publish();
  try { t.size = await tiny.api.call('fileSize', { path: t.path }); } catch (e) {}
}

function doPlay() {
  if (cur < 0 && tracks.length) { loadTrack(0, true); return; }
  ensureCtx(); resumeCtx();
  audio.play().catch(() => {});
}
function doPause() { audio.pause(); }
function toggle() { audio.paused ? doPlay() : doPause(); }
function stop() { audio.pause(); audio.currentTime = 0; updateTime(); }
function next() {
  if (!tracks.length) return;
  // a queued track outranks shuffle and sequence (loadTrack clears the queue)
  if (nextUp >= 0 && nextUp < tracks.length) { loadTrack(nextUp, true); return; }
  let i = shuffle ? Math.floor(Math.random() * tracks.length) : cur + 1;
  if (i >= tracks.length) i = repeatMode === 1 ? 0 : -1;   // repeat-all loops, else stop at end
  if (i >= 0) loadTrack(i, true); else stop();
}
function prev() { if (tracks.length) loadTrack(cur <= 0 ? tracks.length - 1 : cur - 1, true); }

function addPaths(paths) {
  const AUDIO = /\.(mp3|m4a|aac|mp4|flac|wav|aif|aiff|caf|oga|ogg|opus)$/i;
  const ok = paths.filter((p) => AUDIO.test(p));
  const skipped = paths.length - ok.length;
  const added = ok.map((p) => ({ path: p, name: p.split('/').pop(), duration: 0 }));
  if (skipped > 0) flash('⚠ ' + skipped + ' unsupported file' + (skipped > 1 ? 's' : '') + ' skipped');
  if (!added.length) return;
  const wasEmpty = tracks.length === 0;
  tracks = tracks.concat(added);
  publish();
  if (cur < 0) loadTrack(0, false);
  else if (wasEmpty) loadTrack(0, false);
}
function removeTrack(i) {
  if (i < 0 || i >= tracks.length) return;
  tracks.splice(i, 1);
  if (i === nextUp) nextUp = -1;
  else if (i < nextUp) nextUp--;
  if (i === cur) { stop(); if (tracks.length) loadTrack(Math.min(i, tracks.length - 1), false); else { cur = -1; setTitle('‹ no track ›'); } }
  else if (i < cur) cur--;
  publish();
}
function clearAll() { tracks = []; cur = -1; nextUp = -1; stop(); audio.removeAttribute('src'); setTitle('‹ no track ›'); publish(); }

// Reorder (playlist drag): move the track at `from` so it ends up at index
// `to`, keeping the playing track and the queued (») track pointing at the
// same SONGS — indices shift, playback doesn't blink.
function moveTrack(from, to) {
  if (from === to || from < 0 || from >= tracks.length || to < 0 || to >= tracks.length) return;
  const [t] = tracks.splice(from, 1);
  tracks.splice(to, 0, t);
  const remap = (i) => {
    if (i < 0) return i;
    if (i === from) return to;
    const j = i > from ? i - 1 : i;   // the removal shifted later tracks down…
    return j >= to ? j + 1 : j;       // …and the insertion shifted these back up
  };
  cur = remap(cur);
  nextUp = remap(nextUp);
  publish(true);
}

function seekFrac(f) { if (audio.duration) { audio.currentTime = f * audio.duration; updateTime(); } }

// ── EQ / volume / balance ───────────────────────────────────────────────────
function applyEq(s) {
  eqState = s;
  if (!ctx) return;
  const on = s.on;
  preamp.gain.value = on ? Math.pow(10, (s.preamp || 0) / 20) : 1;
  bands.forEach((b, i) => { b.gain.value = on ? (s.bands[i] || 0) : 0; });
  // headphone profile: [type, Fc, gain dB, Q] rows (AutoEq); WebAudio shelf
  // filters ignore Q, which is fine — AutoEq's shelves are near the default
  const TYPE = { PK: 'peaking', LSC: 'lowshelf', HSC: 'highshelf' };
  const hp = s.hp;
  hpPre.gain.value = hp ? Math.pow(10, (hp.p || 0) / 20) : 1;
  hpFilters.forEach((b, i) => {
    const f = hp && hp.f && hp.f[i];
    if (f) { b.type = TYPE[f[0]] || 'peaking'; b.frequency.value = f[1]; b.gain.value = f[2]; b.Q.value = f[3]; }
    else { b.type = 'peaking'; b.gain.value = 0; }
  });
}
function applyBalance() {
  if (panner) panner.pan.value = Math.max(-1, Math.min(1, balance));
  if (masterGain) { masterGain.gain.value = volume; audio.volume = 1; }
  else audio.volume = volume;   // before the graph exists, the element's own volume works
}

// ── display: time, title marquee, spectrum ─────────────────────────────────
let showRemaining = false;
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function updateTime() {
  const d = audio.duration || 0, t = audio.currentTime || 0;
  $('time').textContent = (showRemaining && d ? '-' + fmt(d - t) : fmt(t));
  $('msTime').textContent = fmt(t);
  const seek = $('seek');
  if (d && !seekingNow) seek.value = Math.round((t / d) * 1000);
}
function setTitle(name) {
  const el = $('title');
  el.textContent = name;
  el.classList.remove('flash');
  requestAnimationFrame(setupMarquee);
}
// brief amber notice in the marquee (unsupported file, decode failure, …)
let flashT = 0;
function flash(msg) {
  const el = $('title');
  el.getAnimations && el.getAnimations().forEach((a) => a.cancel());
  el.style.transform = 'translateX(0)';
  el.textContent = msg;
  el.classList.add('flash');
  clearTimeout(flashT);
  flashT = setTimeout(() => setTitle(cur >= 0 && tracks[cur] ? tracks[cur].name : '‹ no track — drop audio here or ⏏ open ›'), 2800);
}
function setupMarquee() {
  const el = $('title'), cont = $('marquee');
  el.getAnimations && el.getAnimations().forEach((a) => a.cancel());
  el.style.transform = 'translateX(0)';
  const over = el.scrollWidth - cont.clientWidth;
  if (over > 6) {
    const base = el.textContent;
    el.textContent = base + '        •        ' + base + '        •        ';
    const half = el.scrollWidth / 2;
    if (el.animate) el.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-half) + 'px)' }],
      { duration: Math.max(6000, half * 26), iterations: Infinity });
  }
}
function setRate(kbps, khz, chan) {
  $('kbps').textContent = kbps || '—';
  $('khz').textContent = khz || '—';
  $('chan').textContent = chan || 'stereo';
}

const NB = 20;
function drawSpectrum() {
  requestAnimationFrame(drawSpectrum);
  const c = $('spec'), g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  if (!analyser) return;
  analyser.getByteFrequencyData(freqData);
  const bins = freqData.length;
  const bw = W / NB;
  for (let i = 0; i < NB; i++) {
    // log-ish bin mapping so bass doesn't dominate
    const lo = Math.floor(Math.pow(i / NB, 1.7) * bins);
    const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / NB, 1.7) * bins));
    let v = 0; for (let j = lo; j < hi && j < bins; j++) v = Math.max(v, freqData[j]);
    const h = (v / 255) * H;
    if ((peaks[i] || 0) < h) peaks[i] = h; else peaks[i] = Math.max(h, (peaks[i] || 0) - H * 0.02);
    const x = i * bw + 1, bwid = bw - 1.5;
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#0a8f4a'); grad.addColorStop(0.55, '#37ff9b');
    grad.addColorStop(0.8, '#ffe45a'); grad.addColorStop(1, '#ff5a5a');
    g.fillStyle = grad;
    g.fillRect(x, H - h, bwid, h);
    g.fillStyle = 'rgba(200,255,220,.85)';
    g.fillRect(x, H - peaks[i] - 1.5, bwid, 1.5);
  }
}

// ── publish state to the rest of the windows (+ persistence) ───────────────
let lastPub = 0;
function publish(force) {
  const now = performance.now();
  if (!force && now - lastPub < 180) return;
  lastPub = now;
  if (cur >= 0 && tracks[cur]) tracks[cur].duration = audio.duration || tracks[cur].duration || 0;
  tiny.api.call('publish', {
    tracks, idx: cur, nextUp, playing: !audio.paused,
    elapsed: audio.currentTime || 0, duration: audio.duration || 0,
    volume, balance, eq: eqState, shuffle, repeatMode,
    title: cur >= 0 && tracks[cur] ? tracks[cur].name : null,
  });
}

// ── Now Playing (Control Center / lock screen / media keys) ────────────────
// We claim a session on launch (even with no track loaded) so the hardware
// media keys route to amp straight away — open the app, press play, done.
function nowPlaying() {
  const t = tracks[cur];
  try {
    tiny.app.nowPlaying.set({
      title: t ? t.name.replace(/\.[^.]+$/, '') : 'amp',
      artist: 'amp', album: '',
      duration: audio.duration || 0, elapsed: audio.currentTime || 0,
      playing: !audio.paused,
    });
  } catch (e) {}
}

// ── wire up ─────────────────────────────────────────────────────────────────
let seekingNow = false;

audio.addEventListener('loadedmetadata', () => {
  if (cur >= 0 && tracks[cur]) tracks[cur].duration = audio.duration;
  // WebKit exposes little metadata; show sample rate if the ctx knows it.
  setRate(guessKbps(), ctx ? Math.round(ctx.sampleRate / 1000) : 44, 'stereo');
  updateTime();
  publish(true);
  if (wantPlay) { wantPlay = false; doPlay(); }
});
audio.addEventListener('timeupdate', () => { updateTime(); publish(); throttleNP(); });
audio.addEventListener('play', () => { setPlaying(true); nowPlaying(); publish(true); });
audio.addEventListener('pause', () => { setPlaying(false); nowPlaying(); publish(true); });
audio.addEventListener('ended', () => { if (repeatMode === 2) { audio.currentTime = 0; doPlay(); } else next(); });
audio.addEventListener('error', () => {   // e.g. WebKit can't decode Ogg Vorbis
  const t = tracks[cur];
  if (t && audio.src && audio.error) flash("⚠ can't play " + t.name.replace(/\.[^.]+$/, ''));
});
function guessKbps() {
  const t = tracks[cur];
  if (!t || !t.size || !audio.duration) return 'VBR';
  return Math.round((t.size * 8) / audio.duration / 1000);
}
let lastNP = 0;
function throttleNP() { const n = performance.now(); if (n - lastNP > 900) { lastNP = n; nowPlaying(); } }
function setPlaying(p) {
  $('play').classList.toggle('lit', p);
  $('pause').classList.toggle('lit', !p && cur >= 0);
  $('msPlay').textContent = p ? '⏸' : '▶';   // shade-mode mini button
}

$('play').onclick = () => { resumeCtx(); doPlay(); };
$('msPlay').onclick = () => { resumeCtx(); toggle(); };
$('msPrev').onclick = prev;
$('msNext').onclick = next;
$('pause').onclick = doPause;
$('stop').onclick = stop;
$('prev').onclick = prev;
$('next').onclick = next;
$('eject').onclick = async () => { const p = await tiny.win.openFiles(); if (p) addPaths(p); };
$('time').onclick = () => { showRemaining = !showRemaining; updateTime(); };

$('seek').addEventListener('pointerdown', () => { seekingNow = true; });
$('seek').addEventListener('input', (e) => { seekFrac(e.target.value / 1000); });
$('seek').addEventListener('change', () => { seekingNow = false; });

$('vol').addEventListener('input', (e) => { volume = e.target.value / 100; applyBalance(); publish(); });
$('bal').addEventListener('input', (e) => { balance = e.target.value / 100; applyBalance(); publish(); });

function setShuffle(v) { shuffle = v; $('shuffle').classList.toggle('lit', shuffle); publish(true); }
function cycleRepeat(m) {
  repeatMode = m != null ? m : (repeatMode + 1) % 3;   // off → all → one → off
  $('repeat').classList.toggle('lit', repeatMode > 0);
  $('repeat').textContent = repeatMode === 2 ? 'REP 1' : 'REP';
  $('repeat').title = ['Repeat: off', 'Repeat: all', 'Repeat: one'][repeatMode];
  publish(true);
}
$('shuffle').onclick = () => setShuffle(!shuffle);
$('repeat').onclick = () => cycleRepeat();
$('tEq').onclick = () => tiny.api.call('toggleWindow', { id: 'eq' });
$('tPl').onclick = () => tiny.api.call('toggleWindow', { id: 'playlist' });
$('tViz').onclick = () => tiny.api.call('toggleWindow', { id: 'viz' });
$('tBig').onclick = () => tiny.api.call('toggleWindow', { id: 'rack' });

$('min').onclick = () => tiny.win.minimize();
$('shade').onclick = () => window.ampToggleShade && window.ampToggleShade();   // collapse / expand
$('close').onclick = () => tiny.quit();

// actions routed from the other windows / media keys
tiny.api.on('action', (a) => {
  switch (a.type) {
    case 'add': addPaths(a.paths); break;
    case 'play': loadTrack(a.idx, true); break;
    case 'queue': nextUp = (a.idx === nextUp ? -1 : a.idx); publish(true); break;   // click again to unqueue
    case 'remove': removeTrack(a.idx); break;
    case 'move': moveTrack(a.from, a.to); break;
    case 'clear': clearAll(); break;
    case 'toggle': toggle(); break;
    case 'next': next(); break;
    case 'prev': prev(); break;
    case 'stop': stop(); break;
    case 'seekFrac': seekFrac(a.frac); break;
    case 'eq': applyEq(a.eq); publish(true); break;
    case 'vol': volume = a.value; $('vol').value = Math.round(volume * 100); applyBalance(); publish(); break;
    case 'bal': balance = a.value; $('bal').value = Math.round(balance * 100); applyBalance(); publish(); break;
    case 'shuffle': setShuffle(!shuffle); break;
    case 'repeat': cycleRepeat(); break;
  }
});
tiny.api.on('windows', (w) => {
  $('tEq').classList.toggle('lit', !!w.eq);
  $('tPl').classList.toggle('lit', !!w.playlist);
  $('tViz').classList.toggle('lit', !!w.viz);
  $('tBig').classList.toggle('lit', !!w.rack);
});

// hardware media keys / Control Center
try {
  tiny.app.onMediaKey(({ command, time }) => {
    if (command === 'toggle') toggle();
    else if (command === 'play') doPlay();
    else if (command === 'pause') doPause();
    else if (command === 'next') next();
    else if (command === 'previous') prev();
    else if (command === 'seek' && time != null) { audio.currentTime = time; updateTime(); }
  });
} catch (e) {}

// files (or a folder) dropped on any amp window — tinyjs broadcasts the drop to
// every window, so ONLY main handles it (else it'd add once per open window).
tiny.win.onDrop(async (paths) => {
  const files = await tiny.api.call('resolveDrop', { paths });   // folder → its audio files
  if (!files.length) { flash('⚠ no audio files found'); return; }
  addPaths(files);
});

// keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); toggle(); }
  else if (e.key === 'ArrowRight' && e.metaKey) { e.preventDefault(); next(); }
  else if (e.key === 'ArrowLeft' && e.metaKey) { e.preventDefault(); prev(); }
  else if (e.key === 'ArrowRight') { audio.currentTime = Math.min((audio.duration || 0), audio.currentTime + 5); updateTime(); }
  else if (e.key === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); updateTime(); }
  else if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey) tiny.api.call('toggleWindow', { id: 'rack' });
});
// any gesture in this window can wake the audio context
document.addEventListener('pointerdown', resumeCtx, { once: false });

// restore last session
(async () => {
  try {
    const s = await tiny.api.call('hello');
    if (s) {
      if (s.tracks && s.tracks.length) {
        tracks = s.tracks.map((t) => ({ path: t.path, name: t.name, duration: t.duration || 0 }));
      }
      if (typeof s.volume === 'number') volume = s.volume;
      if (typeof s.balance === 'number') balance = s.balance;
      if (s.eq) eqState = s.eq;
      $('vol').value = Math.round(volume * 100);
      $('bal').value = Math.round(balance * 100);
      if (tracks.length) loadTrack(0, false);
      publish(true);
    }
  } catch (e) {}
})();

// ── Dock-icon animation frames ──────────────────────────────────────────────
// The Dock icon dances while music plays: the backend flips through PNG
// frames (app.dockIcon), but only a page has a canvas — so draw the icon here
// (macOS rounded square, dark chassis, green LCD, spectrum bars) and hand the
// frames over once. Bar heights are fixed per frame, phase-shifted so the
// 6-frame loop reads as motion.
(function sendDockFrames() {
  try {
    const N = 6, S = 256;
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const rr = (x, y, w, h, r) => {
      g.beginPath(); g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    };
    const frames = [];
    for (let f = 0; f < N; f++) {
      g.clearRect(0, 0, S, S);
      const m = 14;                                       // chassis: rounded square, brushed dark
      const grad = g.createLinearGradient(0, m, 0, S - m);
      grad.addColorStop(0, '#4a4a56'); grad.addColorStop(0.1, '#33333c'); grad.addColorStop(1, '#1d1d24');
      rr(m, m, S - 2 * m, S - 2 * m, 58); g.fillStyle = grad; g.fill();
      g.lineWidth = 3; g.strokeStyle = '#0a0a0e'; g.stroke();
      rr(38, 58, S - 76, S - 116, 16);                    // the LCD window
      g.fillStyle = '#071d12'; g.fill();
      g.lineWidth = 4; g.strokeStyle = '#000'; g.stroke();
      const nb = 8, x0 = 50, w = (S - 100) / nb, hmax = 116;
      for (let i = 0; i < nb; i++) {
        const v = 0.28 + 0.62 * (0.5 + 0.5 * Math.sin(i * 1.9 + (f / N) * Math.PI * 2));
        const h = v * hmax;
        const bg = g.createLinearGradient(0, S - 70, 0, S - 70 - hmax);
        bg.addColorStop(0, '#0a8f4a'); bg.addColorStop(0.6, '#37ff9b'); bg.addColorStop(1, '#ffe45a');
        g.fillStyle = bg;
        g.fillRect(x0 + i * w + 3, S - 70 - h, w - 6, h);
        g.fillStyle = '#ffb437';                          // the riding peak cap
        g.fillRect(x0 + i * w + 3, S - 70 - h - 7, w - 6, 4);
      }
      frames.push(cv.toDataURL('image/png').split(',')[1]);
    }
    tiny.api.call('dockFrames', { frames });
  } catch (e) {}
})();

tiny.win.setResizable(false);
// Claim the media-key session immediately — and actually BECOME the system's
// Now Playing target. macOS only routes ⏮/⏭ (the hardware keys) to an app
// whose playbackState has been *playing* at least once; a session registered
// as paused gets ⏯ but not the skip keys until the first real play. So pulse
// playing → paused once at launch; no audio is involved.
try {
  tiny.app.nowPlaying.set({ title: 'amp', artist: 'amp', album: '',
    duration: 0, elapsed: 0, playing: true });
} catch (e) {}
setTimeout(nowPlaying, 400);   // settle to the real (paused) state
drawSpectrum();
