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

// ── world radio ─────────────────────────────────────────────────────────────
// Streams play on their own <audio>, and since tinyjs 0.24 they go THROUGH
// the Web Audio graph like any track: tiny.proxyURL streams the remote via
// the native layer with permissive CORS, so the MediaElementSource is
// untainted (a raw cross-origin stream would be spec-mandated silence) and
// radio gets the full EQ / balance / spectrum treatment. Without proxyURL
// (older runtime) the element stays off-graph — radio still plays, just
// uncorrected. Element volume is kept in sync either way: it's a no-op for
// graph-captured audio, and it's the ONLY volume for the leak paths the
// graph can't capture (native HLS plays direct, bypassing the graph).
const HAS_PROXY = typeof tiny !== 'undefined' && tiny.proxyURL ? true : false;
const radioEl = new Audio();          // proxied + graph-captured: the EQ path
radioEl.preload = 'none';
radioEl.crossOrigin = 'anonymous';    // proxyURL's contract (only ever gets proxied URLs)
// The fallback: some streams defeat the proxy (v0.24 chokes on upstream HTTP
// redirects — streamtheworld, mediahub, most HLS). Raw playback on the
// CAPTURED element would be CORS-silenced, so the fallback is a second,
// never-captured element: no EQ, but the station PLAYS, at element volume.
const radioRawEl = new Audio();
radioRawEl.preload = 'none';
let radioActive = radioRawEl;         // whichever element carries the station
// Some stations only publish HLS, and not every engine plays it natively:
// WebKitGTK refuses application/vnd.apple.mpegurl before GStreamer ever sees
// it, so installing decoders doesn't help. hls.js pulls the segments itself
// and feeds them through Media Source, which WebKit does support. Native
// playback wins where it exists (Safari), so this is the fallback, not the
// default.
const NATIVE_HLS = !!document.createElement('audio')
  .canPlayType('application/vnd.apple.mpegurl');
const IS_HLS = (u) => /\.m3u8(\?|$)/i.test(u || '');
let hls = null;
function hlsDetach() {
  if (!hls) return;
  try { hls.destroy(); } catch (e) {}
  hls = null;
}
let radio = null;          // { name, url, uuid } while tuned
let radioList = [];        // the tuner's station list — next/prev step it
let radioIdx = -1;

// ── Linux plays without a Web Audio graph ──────────────────────────────────
// WebKitGTK renders Web Audio on a normal-priority (SCHED_OTHER) thread while
// its media threads get real-time priority, so ANY graph reaching
// ctx.destination misses its deadline and crunches — on an idle machine, at
// any latencyHint, whether the source is an element or a decoded buffer. A
// plain <audio> element goes through GStreamer instead and is flawless. So on
// Linux amp plays the element directly and gets its analysis from
// tiny.audioTap (scope 'app': a PipeWire null sink fed by amp's own output
// ports, so it hears amp and nothing else). The cost is the two things that
// WERE graph nodes — the equalizer and the balance control. Everything else
// is untouched, because the tap analysers below answer the same two methods
// the display code already calls.
const NO_GRAPH = !!(window.tiny && tiny.system && tiny.system.isLinux && tiny.system.isLinux());

let ctx, srcNode, radioSrc, preamp, bands, hpPre, hpFilters, panner, analyser, masterGain, freqData;
let anL, anR, tdL, tdR;        // stereo pair for the levels/scope displays
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
  // Linux: element straight to the speakers. applyBalance still has to run —
  // it's what copies the restored volume onto the element, and with no graph
  // to build there is no other path that would have done it. Skipping it left
  // the element at its default 1.0 while the slider read 80.
  // applyEq matters here for the same reason applyBalance does: the graph
  // branch below ends by applying both, and with no graph to build nothing
  // else would ever push the restored EQ at the native chain.
  if (NO_GRAPH) { ensureTapAnalysis(); applyEq(eqState); applyBalance(); return; }
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  srcNode = ctx.createMediaElementSource(audio);
  // the radio element feeds the SAME chain (only one of the two ever plays);
  // proxyURL keeps it untainted, so the graph gets real samples
  if (HAS_PROXY) { radioSrc = ctx.createMediaElementSource(radioEl); }
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
  // stereo taps for the L/R levels + a longer window for the oscilloscope —
  // analysis-only branches, nothing connects onward to the speakers
  const split = ctx.createChannelSplitter(2);
  anL = ctx.createAnalyser(); anR = ctx.createAnalyser();
  anL.fftSize = anR.fftSize = 512;
  tdL = new Uint8Array(512); tdR = new Uint8Array(512);
  analyser.connect(split); split.connect(anL, 0); split.connect(anR, 1);

  srcNode.connect(preamp);
  if (radioSrc) radioSrc.connect(preamp);
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
  radioOff(true);   // the deck takes over from the tuner
  cur = i;
  if (nextUp === i) nextUp = -1;   // playing the queued track consumes the queue
  const t = tracks[i];
  setTitle(trackTitle(t));
  wantPlay = !!autoplay;
  // podcast episodes are remote-URL tracks: proxied through the native layer
  // so the captured element stays untainted (same trick as radio) — unless
  // they've been downloaded, in which case they're just files
  if (t.path) audio.src = window.ampFileURL(t.path);
  else if (t.url) audio.src = HAS_PROXY && !NO_GRAPH ? tiny.proxyURL(t.url) : t.url;
  else return;
  audio.load();
  publish();
  if (t.path) { try { t.size = await tiny.api.call('fileSize', { path: t.path }); } catch (e) {} }
}

// ── podcast listened-tracking: the deck owns the truth ─────────────────────
// pos + done per episode guid live in the store; the pod window paints them.
let podState = {};
let podStateT = 0;
function podSaveSoon(force) {
  const now = performance.now();
  if (!force && now - podStateT < 5000) return;
  podStateT = now;
  try { tiny.store.set('podState', podState); } catch (e) {}
}
function podTrackProgress(ended) {
  const t = tracks[cur];
  if (!t || !t.pod) return;
  const dur = (isFinite(audio.duration) && audio.duration) || t.duration || 0;
  const pos = audio.currentTime || 0;
  const st = podState[t.pod.guid] || {};
  st.dur = dur;
  st.pos = ended ? 0 : pos;
  if (ended || (dur && pos / dur > 0.92)) st.done = true;
  podState[t.pod.guid] = st;
  podSaveSoon(ended);
}
function podResume() {
  const t = tracks[cur];
  if (!t || !t.pod) return;
  const st = podState[t.pod.guid];
  const dur = (isFinite(audio.duration) && audio.duration) || 0;
  if (st && !st.done && st.pos > 15 && (!dur || st.pos < dur - 20)) {
    try { audio.currentTime = st.pos; } catch (e) {}
  }
}
// play (or queue) an episode handed over from the pod window / big screen
function podAdd(track, queueOnly) {
  if (!track || !(track.url || track.path) || !track.pod) return;
  let i = tracks.findIndex((t) => t.pod && t.pod.guid === track.pod.guid);
  if (i < 0) { tracks.push(track); i = tracks.length - 1; }
  else tracks[i] = { ...tracks[i], ...track };   // maybe it got downloaded since
  if (queueOnly) { nextUp = i; publish(true); }
  else loadTrack(i, true);
}

function doPlay() {
  if (radio) { resumeCtx(); radioActive.play().catch(() => {}); return; }
  if (cur < 0 && tracks.length) { loadTrack(0, true); return; }
  ensureCtx(); resumeCtx();
  audio.play().catch(() => {});
}
function doPause() { if (radio) { radioActive.pause(); return; } audio.pause(); }
function toggle() { (radio ? radioActive : audio).paused ? doPlay() : doPause(); }
function stop() {
  if (radio) { radioOff(); return; }
  audio.pause(); audio.currentTime = 0; updateTime();
}
function next() {
  if (radio) { radioStep(1); return; }
  if (!tracks.length) return;
  // a queued track outranks shuffle and sequence (loadTrack clears the queue)
  if (nextUp >= 0 && nextUp < tracks.length) { loadTrack(nextUp, true); return; }
  let i = shuffle ? Math.floor(Math.random() * tracks.length) : cur + 1;
  if (i >= tracks.length) i = repeatMode === 1 ? 0 : -1;   // repeat-all loops, else stop at end
  if (i >= 0) loadTrack(i, true); else stop();
}
function prev() {
  if (radio) { radioStep(-1); return; }
  if (tracks.length) loadTrack(cur <= 0 ? tracks.length - 1 : cur - 1, true);
}

// ── tuning (actions from the big screen's tuner unit) ───────────────────────
function radioTune(st, list, idx) {
  if (!st || !st.url) return;
  // already tuned to this very station and on the air (or still connecting —
  // paused flips false the instant play() is called)? A repeat click must not
  // tear the stream down and reconnect it. Only a dead/errored stream retunes.
  if (radio && radio.url === st.url && !radioActive.paused && !radioActive.error) {
    publish(true);
    return;
  }
  audio.pause();                          // the tuner takes over from the deck
  radio = { name: st.name, url: st.url, uuid: st.uuid || null };
  if (Array.isArray(list) && list.length) {
    radioList = list;
    radioIdx = idx != null ? idx : list.findIndex((s) => s.url === st.url);
  } else if (radioList.length) {
    radioIdx = radioList.findIndex((s) => s.url === st.url);
  }
  radioQuiet();
  // The proxy exists to keep the captured element untainted so the graph gets
  // real samples. With no graph (Linux) there is nothing to keep untainted and
  // nothing to EQ, so play the station straight — one less thing to fall back
  // from, since the proxy can't follow the redirects many stations serve.
  if (HAS_PROXY && !NO_GRAPH) {           // EQ path first; falls back on error
    radioActive = radioEl;
    radioEl.src = tiny.proxyURL(st.url);
    ensureCtx(); resumeCtx();             // captured audio needs a live graph
  } else {
    radioActive = radioRawEl;
    if (IS_HLS(st.url) && !NATIVE_HLS && window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      // hls.js owns the element's src (a Media Source blob) once attached, so
      // don't set it ourselves. A fatal error is a real failure, unlike the
      // load() abort radioQuiet provokes.
      hls.on(Hls.Events.ERROR, (e, d) => {
        if (!d || !d.fatal) return;
        hlsDetach();
        if (radio && radioActive === radioRawEl) codecHint('⚠ stream dropped — ' + st.name);
      });
      hls.loadSource(st.url);
      hls.attachMedia(radioRawEl);
    } else {
      radioRawEl.src = st.url;
    }
    if (NO_GRAPH) ensureCtx();            // arms the tap that drives the meters
  }
  radioActive.volume = radioActive === radioRawEl ? volume : 1;
  radioActive.play().catch(() => {});
  armStall();
  setTitle('📻 ' + st.name);
  if (st.uuid) { try { tiny.api.call('radioClick', { uuid: st.uuid }); } catch (e) {} }
  publish(true);
}
function radioQuiet() {   // stop + unload both radio elements
  clearTimeout(stallT);
  hlsDetach();            // before the elements, so it can't re-feed a dead one
  for (const el of [radioEl, radioRawEl]) {
    try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
  }
}
function radioOff(silent) {
  if (!radio) return;
  radio = null;
  radioQuiet();
  if (!silent) {
    setTitle(cur >= 0 && tracks[cur] ? trackTitle(tracks[cur]) : '‹ no track — drop audio here or ⏏ open ›');
    setPlaying(false); nowPlaying(); publish(true);
  }
}
function radioStep(n) {
  if (!radio || !radioList.length) return;
  radioIdx = ((radioIdx + n) % radioList.length + radioList.length) % radioList.length;
  radioTune(radioList[radioIdx]);
}

function addPaths(paths) {
  const AUDIO = /\.(mp3|m4a|aac|mp4|flac|wav|aif|aiff|caf|oga|ogg|opus)$/i;
  const ok = paths.filter((p) => AUDIO.test(p));
  const skipped = paths.length - ok.length;
  const added = ok.map((p) => ({ path: p, name: p.split(/[\\/]/).pop(), duration: 0 }));
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

function seekFrac(f) { if (!radio && isFinite(audio.duration) && audio.duration) { audio.currentTime = f * audio.duration; updateTime(); } }

// ── EQ / volume / balance ───────────────────────────────────────────────────
// Linux has no Web Audio graph to hang filters on, so the same EQ runs natively
// in PipeWire (tiny.audio.filters). The chain's SHAPE never changes — a preamp
// gain, the ten graphic bands, then ten headphone slots — so every change is a
// retune in place rather than a rebuild, and dragging a slider stays gapless.
// Unused headphone slots sit at 0 dB, which is a no-op.
const HP_TYPE = { PK: 'peaking', LSC: 'lowshelf', HSC: 'highshelf' };
// The chain: preamp + 10 graphic bands + up to 10 headphone-correction rows =
// 21 filters, well inside the native limit (28 when channels stay identical).
// The SHAPE only changes when a headphone profile is picked, so the common
// case — dragging a band, flipping ON — retunes in place with no gap. Balance
// is NOT in here: it rides on the chain's output (tiny.audio.balance), which
// never costs a slot and never rebuilds.
let nativeEqReady = false;
async function applyEqNative(s) {
  if (!window.tiny || !tiny.audio) return;
  const on = s.on;
  const hp = s.hp;
  const list = [
    // the native preamp is a linear multiplier, not dB
    { type: 'gain', gain: Math.pow(10, ((on ? (s.preamp || 0) : 0) + (hp ? (hp.p || 0) : 0)) / 20) },
    ...EQ_FREQS.map((f, i) => ({
      type: 'peaking', freq: f, q: 1.1, gain: on ? (s.bands[i] || 0) : 0,
    })),
    ...((hp && hp.f) || []).map((f) => ({
      type: HP_TYPE[f[0]] || 'peaking', freq: f[1], gain: f[2], q: f[3],
    })),
  ];
  try {
    await tiny.audio.filters(list);
    nativeEqReady = true;
    tiny.audio.balance(balance);   // (re)apply — a rebuild resets the output stream
  } catch (e) {}
}
function applyEq(s) {
  eqState = s;
  if (NO_GRAPH) { applyEqNative(s); return; }
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
  // no panner on Linux — balance rides the native chain's output stream
  if (NO_GRAPH && window.tiny && tiny.audio) tiny.audio.balance(balance);
  if (masterGain) { masterGain.gain.value = volume; audio.volume = 1; }
  else audio.volume = volume;   // no graph (Linux) or not built yet: the element's own fader
  radioEl.volume = masterGain ? 1 : volume;   // graph-captured → its own volume is a no-op
  radioRawEl.volume = volume;                 // always raw, always its own fader
}

// Linux ships AAC/HLS in optional GStreamer packages, so a station or a file
// the engine refuses is usually a missing decoder, not a bad URL — and about
// half of all radio stations are AAC. "Stream dropped" sends someone hunting
// the wrong problem, so ask what's actually missing and name the package.
let codecHinted = false;
async function codecHint(fallback) {
  if (!NO_GRAPH || codecHinted) { flash(fallback); return; }
  codecHinted = true;   // ask once a session, however many stations fail after
  try {
    // Offers the install command with a copy button. Shows nothing at all if
    // the decoders are actually present, so a genuinely dead stream still
    // just flashes.
    const { missing } = await tiny.system.promptMissing(['media.aac']);
    if (missing.length) return;
  } catch (e) {}
  codecHinted = false;
  flash(fallback);
}

// Reaching for a control that only exists inside the graph. Say so once per
// control rather than letting the slider move and nothing happen.
const saidNoGraphFor = new Set();
function saidNoGraph(what) {
  if (!NO_GRAPH || saidNoGraphFor.has(what)) return;
  saidNoGraphFor.add(what);
  flash('⚠ ' + what + ' unavailable on Linux — audio bypasses Web Audio');
}

// ── display: time, title marquee, spectrum ─────────────────────────────────
let showRemaining = false;
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function updateTime() {
  // radio: it's a live stream — no elapsed, no length, no seek. The clock
  // slot shows a streaming glyph instead (CSS pulses it while on the air).
  const d = radio ? 0 : (isFinite(audio.duration) && audio.duration) || 0;
  const t = (radio ? radioActive.currentTime : audio.currentTime) || 0;
  $('time').textContent = radio ? '📡' : (showRemaining && d ? '-' + fmt(d - t) : fmt(t));
  $('time').classList.toggle('live', !!radio);
  $('msTime').textContent = radio ? '📡' : fmt(t);
  const seek = $('seek');
  seek.disabled = !!radio;
  if (d && !seekingNow) seek.value = Math.round((t / d) * 1000);
  else if (radio) seek.value = 0;
}
// A podcast episode gets the mic the way a station gets the radio — the LCD
// says what KIND of thing is playing, not just its name.
const trackTitle = (t) => (t && t.pod ? '🎙 ' : '') + (t ? t.name : '');
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
  flashT = setTimeout(() => setTitle(cur >= 0 && tracks[cur] ? trackTitle(tracks[cur]) : '‹ no track — drop audio here or ⏏ open ›'), 2800);
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

// spectrum colors follow the display-color preference (style.css palettes,
// applied by drag.js as <html data-lcd>) — watch the attribute, not the event,
// so init order doesn't matter
let specCols = ['#0a8f4a', '#37ff9b', '#ffe45a'];
function refreshSpecCols() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  specCols = [v('--spec-lo', '#0a8f4a'), v('--spec-mid', '#37ff9b'), v('--spec-hi', '#ffe45a')];
}
new MutationObserver(refreshSpecCols)
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-lcd'] });
refreshSpecCols();

// ── the little display: seven looks, click the canvas to cycle ─────────────
// All of them read the same analysers (the tap's side analyser when a
// raw-fallback station plays), all follow the LCD color preference.
const SPEC_MODES = [
  ['bars', 'analyzer bars'], ['dots', 'led dots'], ['line', 'spectrum line'],
  ['mirror', 'mirror bars'], ['scope', 'oscilloscope'], ['levels', 'L / R levels'],
  ['falls', 'spectrogram'],
];
let specMode = 'bars';
let peakL = 0, peakR = 0;

const NB = 20;
// log-ish bin mapping + pink tilt: FFT magnitudes of music pile up in the
// bass, so trim the low columns and lift the top — reads balanced, not boomy
function binVal(data, i, n) {
  const bins = data.length;
  const lo = Math.floor(Math.pow(i / n, 1.7) * bins);
  const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * bins));
  let v = 0; for (let j = lo; j < hi && j < bins; j++) v = Math.max(v, data[j]);
  return Math.min(255, v * (0.6 + 0.55 * (i / (n - 1))));
}
function rmsOf(an, buf) {
  an.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / buf.length);
}
const barGrad = (g, H) => {
  const grad = g.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, specCols[0]); grad.addColorStop(0.55, specCols[1]);
  grad.addColorStop(0.8, specCols[2]); grad.addColorStop(1, '#ff5a5a');
  return grad;
};

function drawBars(g, W, H, data) {
  const bw = W / NB;
  for (let i = 0; i < NB; i++) {
    const h = (binVal(data, i, NB) / 255) * H;
    if ((peaks[i] || 0) < h) peaks[i] = h; else peaks[i] = Math.max(h, (peaks[i] || 0) - H * 0.02);
    const x = i * bw + 1, bwid = bw - 1.5;
    g.fillStyle = barGrad(g, H);
    g.fillRect(x, H - h, bwid, h);
    g.fillStyle = 'rgba(200,255,220,.85)';
    g.fillRect(x, H - peaks[i] - 1.5, bwid, 1.5);
  }
}
function drawDots(g, W, H, data) {
  const rows = Math.floor(H / 4), bw = W / NB;
  for (let i = 0; i < NB; i++) {
    const lit = Math.round((binVal(data, i, NB) / 255) * rows);
    const hpx = (binVal(data, i, NB) / 255) * H;
    if ((peaks[i] || 0) < hpx) peaks[i] = hpx; else peaks[i] = Math.max(hpx, (peaks[i] || 0) - H * 0.02);
    const pkRow = Math.min(rows - 1, Math.round((peaks[i] / H) * rows));
    for (let r = 0; r < rows; r++) {
      const frac = (r + 1) / rows;
      const on = r < lit;
      g.fillStyle = r === pkRow && peaks[i] > 2 ? 'rgba(200,255,220,.9)'
        : !on ? 'rgba(120,160,140,.09)'
        : frac > 0.92 ? '#ff5a5a' : frac > 0.75 ? specCols[2] : frac > 0.5 ? specCols[1] : specCols[0];
      g.fillRect(i * bw + 1.5, H - (r + 1) * 4 + 1, bw - 3, 2.5);
    }
  }
}
function drawLine(g, W, H, data) {
  const N = 44, pts = [];
  for (let i = 0; i < N; i++) pts.push([(i / (N - 1)) * W, H - 1.5 - (binVal(data, i, N) / 255) * (H - 3)]);
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < N - 1; i++)
    g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  g.lineTo(W, pts[N - 1][1]);
  const fill = g.createLinearGradient(0, 0, 0, H);
  fill.addColorStop(0, specCols[2] + 'cc'); fill.addColorStop(0.6, specCols[0] + '55'); fill.addColorStop(1, specCols[0] + '11');
  g.save();
  g.lineTo(W, H); g.lineTo(0, H); g.closePath();
  g.fillStyle = fill; g.fill();
  g.restore();
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < N - 1; i++)
    g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  g.strokeStyle = specCols[1]; g.lineWidth = 1.5; g.stroke();
}
function drawMirror(g, W, H, data) {
  const bw = W / NB, cy = H / 2;
  g.fillStyle = 'rgba(120,160,140,.25)';
  g.fillRect(0, cy - 0.5, W, 1);
  for (let i = 0; i < NB; i++) {
    const h = (binVal(data, i, NB) / 255) * (cy - 1);
    const x = i * bw + 1, bwid = bw - 1.5;
    const grad = g.createLinearGradient(0, cy - h, 0, cy + h);
    grad.addColorStop(0, specCols[2]); grad.addColorStop(0.5, specCols[0]); grad.addColorStop(1, specCols[2]);
    g.fillStyle = grad;
    g.fillRect(x, cy - h, bwid, h * 2);
  }
}
function drawScope(g, W, H, an, buf) {
  an.getByteTimeDomainData(buf);
  g.strokeStyle = 'rgba(120,160,140,.25)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.beginPath();
  const n = buf.length;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W;
    const y = H / 2 + ((buf[i] - 128) / 128) * (H / 2 - 1.5);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.strokeStyle = specCols[1]; g.lineWidth = 1.5; g.stroke();
}
function drawLevels(g, W, H, viaTap) {
  // stereo pair off the post-EQ signal; the tap is mono, so raw radio shows
  // the same level on both rails
  const l = viaTap ? rmsOf(tapAn, tapTd) : rmsOf(anL, tdL);
  const r = viaTap ? l : rmsOf(anR, tdR);
  const lv = Math.min(1, l * 2.8), rv = Math.min(1, r * 2.8);
  peakL = lv > peakL ? lv : Math.max(lv, peakL - 0.014);
  peakR = rv > peakR ? rv : Math.max(rv, peakR - 0.014);
  const x0 = 12, bw = W - x0 - 4, bh = Math.floor(H / 2) - 8;
  const rows = [[lv, peakL, 5, 'L'], [rv, peakR, H / 2 + 3, 'R']];
  g.font = '9px ui-monospace, Menlo, monospace';
  for (const [v, pk, y, lbl] of rows) {
    g.fillStyle = 'rgba(200,255,220,.7)';
    g.fillText(lbl, 2, y + bh - 1);
    g.fillStyle = 'rgba(120,160,140,.12)';
    g.fillRect(x0, y, bw, bh);
    const grad = g.createLinearGradient(x0, 0, x0 + bw, 0);
    grad.addColorStop(0, specCols[0]); grad.addColorStop(0.6, specCols[1]);
    grad.addColorStop(0.85, specCols[2]); grad.addColorStop(1, '#ff5a5a');
    g.fillStyle = grad;
    g.fillRect(x0, y, bw * v, bh);
    g.fillStyle = 'rgba(200,255,220,.85)';
    g.fillRect(x0 + bw * pk - 1, y, 1.5, bh);
  }
}
function drawFalls(g, W, H, c, data) {
  // waterfall: everything slides one column left, the newest slice paints in
  g.drawImage(c, -1, 0);
  g.fillStyle = 'rgba(4,12,8,1)';
  g.fillRect(W - 1, 0, 1, H);
  for (let r = 0; r < H; r++) {
    const v = binVal(data, H - 1 - r, H);
    if (v < 12) continue;
    g.fillStyle = v > 205 ? '#ff5a5a' : v > 150 ? specCols[2] : v > 85 ? specCols[1] : specCols[0];
    g.globalAlpha = Math.min(1, (v - 4) / 110);
    g.fillRect(W - 1, r, 1, 1);
  }
  g.globalAlpha = 1;
}

function drawSpectrum() {
  requestAnimationFrame(drawSpectrum);
  const c = $('spec'), g = c.getContext('2d');
  const W = c.width, H = c.height;
  if (!analyser) { g.clearRect(0, 0, W, H); return; }
  // raw-fallback radio bypasses the graph — read the tap's side analyser
  const viaTap = radio && radioActive === radioRawEl && tapAn;
  const an = viaTap ? tapAn : analyser, data = viaTap ? tapData : freqData;
  if (specMode !== 'falls') g.clearRect(0, 0, W, H);
  if (specMode === 'scope') { drawScope(g, W, H, viaTap ? tapAn : anL, viaTap ? tapTd : tdL); return; }
  if (specMode === 'levels') { drawLevels(g, W, H, viaTap); return; }
  an.getByteFrequencyData(data);
  if (specMode === 'bars') drawBars(g, W, H, data);
  else if (specMode === 'dots') drawDots(g, W, H, data);
  else if (specMode === 'line') drawLine(g, W, H, data);
  else if (specMode === 'mirror') drawMirror(g, W, H, data);
  else if (specMode === 'falls') drawFalls(g, W, H, c, data);
}

function setSpecMode(m, quiet) {
  specMode = m;
  peaks = []; peakL = peakR = 0;
  const c = $('spec');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
  const label = (SPEC_MODES.find(([k]) => k === m) || [])[1] || m;
  c.title = 'Display: ' + label + ' — click to change';
  if (!quiet) {   // quiet = boot/restore: no marquee flash, no store rewrite
    flash('▚ ' + label);
    try { tiny.store.set('specMode', m); } catch (e) {}
  }
}
$('spec').style.cursor = 'pointer';
$('spec').addEventListener('click', () => {
  const i = SPEC_MODES.findIndex(([k]) => k === specMode);
  setSpecMode(SPEC_MODES[(i + 1) % SPEC_MODES.length][0]);
});
setSpecMode('bars', true);   // default look + tooltip; the restore may override

// ── publish state to the rest of the windows (+ persistence) ───────────────
let lastPub = 0;
function publish(force) {
  const now = performance.now();
  if (!force && now - lastPub < 180) return;
  lastPub = now;
  if (cur >= 0 && tracks[cur]) tracks[cur].duration = audio.duration || tracks[cur].duration || 0;
  tiny.api.call('publish', {
    tracks, idx: cur, nextUp,
    playing: radio ? !radioActive.paused : !audio.paused,
    elapsed: (radio ? radioActive.currentTime : audio.currentTime) || 0,
    duration: radio ? 0 : ((isFinite(audio.duration) && audio.duration) || 0),
    volume, balance, eq: eqState, shuffle, repeatMode,
    // both were Web Audio nodes; on Linux there is no graph to put them in, so
    // the windows that offer them gray themselves out instead of lying
    caps: { eq: true, balance: true },
    radio: radio ? { ...radio, idx: radioIdx, raw: radioActive === radioRawEl } : null,
    title: radio ? radio.name : (cur >= 0 && tracks[cur] ? tracks[cur].name : null),
  });
}

// ── Now Playing (Control Center / lock screen / media keys) ────────────────
// We claim a session on launch (even with no track loaded) so the hardware
// media keys route to amp straight away — open the app, press play, done.
function nowPlaying() {
  const t = tracks[cur];
  try {
    tiny.app.nowPlaying.set({
      title: radio ? radio.name : (t ? t.name.replace(/\.[^.]+$/, '') : 'amp'),
      artist: radio ? 'world radio' : (t && t.pod && t.pod.show) || 'amp', album: '',
      duration: radio ? 0 : ((isFinite(audio.duration) && audio.duration) || 0),
      elapsed: (radio ? radioActive.currentTime : audio.currentTime) || 0,
      playing: radio ? !radioActive.paused : !audio.paused,
    });
  } catch (e) {}
}

// ── wire up ─────────────────────────────────────────────────────────────────
let seekingNow = false;

audio.addEventListener('loadedmetadata', () => {
  if (cur >= 0 && tracks[cur]) tracks[cur].duration = audio.duration;
  podResume();
  // WebKit exposes little metadata; show sample rate if the ctx knows it.
  setRate(guessKbps(), Math.round((ctx ? ctx.sampleRate : NO_GRAPH ? tapSR : 44100) / 1000), 'stereo');
  updateTime();
  publish(true);
  if (wantPlay) { wantPlay = false; doPlay(); }
});
audio.addEventListener('timeupdate', () => { updateTime(); publish(); throttleNP(); podTrackProgress(false); });
audio.addEventListener('play', () => { setPlaying(true); nowPlaying(); publish(true); });
audio.addEventListener('pause', () => { setPlaying(false); nowPlaying(); publish(true); });
audio.addEventListener('ended', () => { podTrackProgress(true); if (repeatMode === 2) { audio.currentTime = 0; doPlay(); } else next(); });
audio.addEventListener('error', () => {   // e.g. WebKit can't decode Ogg Vorbis
  const t = tracks[cur];
  if (t && audio.src && audio.error) codecHint("⚠ can't play " + t.name.replace(/\.[^.]+$/, ''));
});
// the tuner's elements mirror the deck's wiring — one UI, two sources (only
// the ACTIVE one may speak; the abandoned one's pause event must not lie)
for (const el of [radioEl, radioRawEl]) {
  el.addEventListener('play', () => { if (radio && el === radioActive) { setPlaying(true); nowPlaying(); publish(true); } });
  el.addEventListener('pause', () => { if (radio && el === radioActive) { setPlaying(false); nowPlaying(); publish(true); } });
  el.addEventListener('timeupdate', () => { if (radio && el === radioActive) { updateTime(); publish(); throttleNP(); } });
}
// proxied load failed (v0.24's proxy can't follow upstream redirects, and
// HLS won't ride it either) → retune RAW on the uncaptured element
// radioQuiet() unloads an element by removing src and calling load(), and that
// itself fires an error — our own doing, not the station's. On Linux
// radioActive is ALWAYS radioRawEl, so that self-inflicted error surfaced as
// "stream dropped" on every tune (macOS tunes radioEl, so its guard hid it).
// A real failure always still has a src attached.
const selfUnload = (el) => !el.getAttribute('src');
radioEl.addEventListener('error', () => {
  if (!selfUnload(radioEl) && radio && radioActive === radioEl) radioFallback();
});
radioRawEl.addEventListener('error', () => {
  if (selfUnload(radioRawEl)) return;
  if (radio && radioActive === radioRawEl && radioRawEl.error) codecHint('⚠ stream dropped — ' + radio.name);
});
let stallT = 0;
function armStall() {   // belt for streams that neither play nor error
  clearTimeout(stallT);
  if (radioActive !== radioEl) return;
  stallT = setTimeout(() => {
    if (radio && radioActive === radioEl && radioEl.readyState === 0) radioFallback();
  }, 8000);
}
function radioFallback() {
  if (!radio || radioActive !== radioEl) return;
  clearTimeout(stallT);
  try { radioEl.pause(); radioEl.removeAttribute('src'); radioEl.load(); } catch (e) {}
  radioActive = radioRawEl;
  radioRawEl.src = radio.url;          // no EQ this way, but it PLAYS
  radioRawEl.volume = volume;
  radioRawEl.play().catch(() => {});
  ensureTap();                         // raw audio never crosses the graph — tap it for the spectrum
  publish(true);
}

// ── tap analysers: AnalyserNode's shape, no Web Audio underneath ───────────
// On Linux the sound never enters a graph, so there is no AnalyserNode to read.
// These stand in: PCM arrives from tiny.audioTap, and each analyser keeps the
// newest fftSize samples and answers the same two methods with the same byte
// encodings (time domain centred on 128; frequency mapped -100…-30 dB over
// 0…255, smoothed) that a real AnalyserNode produces. Every display mode —
// bars, dots, line, mirror, scope, levels, spectrogram — then works unchanged,
// and levels are true stereo because the tap hands us both channels.
function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
function makeTapAnalyser(fftSize, smoothing) {
  const bins = fftSize >> 1;
  const win = new Float32Array(fftSize);      // newest samples, oldest first
  const prev = new Float32Array(bins);        // smoothingTimeConstant state
  const re = new Float32Array(fftSize), im = new Float32Array(fftSize);
  const MINDB = -100, MAXDB = -30;
  return {
    fftSize, frequencyBinCount: bins,
    push(s) {
      const n = s.length;
      if (n >= fftSize) { win.set(s.subarray(n - fftSize)); return; }
      win.copyWithin(0, n);                   // slide the window along
      win.set(s, fftSize - n);
    },
    getByteTimeDomainData(out) {
      const n = Math.min(out.length, fftSize), off = fftSize - n;
      for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round(128 + win[off + i] * 128)));
    },
    getByteFrequencyData(out) {
      for (let i = 0; i < fftSize; i++) {     // Hann window, then transform
        re[i] = win[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1)));
        im[i] = 0;
      }
      fftInPlace(re, im);
      const n = Math.min(out.length, bins);
      for (let k = 0; k < n; k++) {
        const mag = Math.hypot(re[k], im[k]) / bins;
        const sm = prev[k] * smoothing + mag * (1 - smoothing);
        prev[k] = sm;
        const db = 20 * Math.log10(sm || 1e-9);
        out[k] = Math.max(0, Math.min(255, Math.round(255 * (db - MINDB) / (MAXDB - MINDB))));
      }
    },
  };
}

// Linux only: stand the analysers up and arm the tap that feeds them. Called
// from ensureCtx, so it happens on the first play like the graph does.
let tapSR = 48000;
function ensureTapAnalysis() {
  if (analyser || !window.tiny || !tiny.audioTap) return;
  analyser = makeTapAnalyser(256, 0.78);       // the little display's spectrum
  anL = makeTapAnalyser(512, 0.78);            // L/R for levels + oscilloscope
  anR = makeTapAnalyser(512, 0.78);
  freqData = new Uint8Array(analyser.frequencyBinCount);
  tdL = new Uint8Array(512); tdR = new Uint8Array(512);
  // Each chunk refreshes the window once, so the interval sets the display's
  // real frame rate (33ms ≈ 30fps). Shorter is smoother but chattier on the
  // bridge; the peak-decay in the drawing already carries the eye between them.
  tiny.audioTap.start({ scope: 'app', interval: 33 }).catch(() => {});
  // The tap needs PipeWire's CLI tools present. Without them the meters just
  // sit there, which reads as our bug — so say what to install instead.
  (async () => {
    try {
      const [req] = await tiny.system.requirements(['audioTap']);
      if (!req || req.ok) return;
      flash('⚠ meters need ' + (req.install ? req.install.packages.join(' ') : 'the PipeWire tools'));
      if (req.install) console.log('[amp] ' + req.detail + '\n  ' + req.install.command);
    } catch (e) {}
  })();
}
// interleaved s16 → the three analysers (mono for the spectrum, L/R for meters)
function pushTapPcm(bin, chans, frames) {
  if (!analyser) return;
  const l = new Float32Array(frames), r = new Float32Array(frames), m = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const j = 2 * i * chans;
    const a = ((bin.charCodeAt(j) | (bin.charCodeAt(j + 1) << 8)) << 16 >> 16) / 32768;
    const b = chans > 1
      ? ((bin.charCodeAt(j + 2) | (bin.charCodeAt(j + 3) << 8)) << 16 >> 16) / 32768
      : a;
    l[i] = a; r[i] = b; m[i] = (a + b) / 2;
  }
  analyser.push(m); anL.push(l); anR.push(r);
}

// ── spectrum for raw-fallback radio ─────────────────────────────────────────
// The raw element lives OUTSIDE the graph (that's the whole point of the
// fallback), so the analyser flatlines and the spectrum dies with it. Same
// hybrid as the viz windows: tiny.audioTap PCM chunks feed a side analyser
// that only the spectrum reads. Nothing here reaches the speakers, and the
// tap (with its one-time system-audio consent) arms only when a raw station
// actually plays.
let tapAn = null, tapData = null, tapTd = null, tapT2 = 0, tapStarted = false;
let tapLastLoud = 0, tapHinted = false;
function ensureTap() {
  if (tapStarted || !window.tiny.audioTap || !ctx) return;
  tapStarted = true;
  tapAn = ctx.createAnalyser();
  tapAn.fftSize = 256; tapAn.smoothingTimeConstant = 0.78;
  tapData = new Uint8Array(tapAn.frequencyBinCount);
  tapTd = new Uint8Array(tapAn.fftSize);
  tapLastLoud = performance.now();
  tiny.audioTap.start({ scope: 'app', interval: 80 }).catch(() => {});
  // The tap can "run" and deliver nothing but zeros — a voided/denied
  // system-audio permission does that (macOS never errors, it just goes
  // quiet). Dead meters look like OUR bug, so say what's actually wrong.
  setInterval(() => {
    if (!(radio && radioActive === radioRawEl) || radioRawEl.paused) return;
    if (tapHinted || performance.now() - tapLastLoud < 6000) return;
    tapHinted = true;
    flash('⚠ meters idle — no audio from the system tap (permission?)');
  }, 2000);
}
if (window.tiny && tiny.audioTap) {
  tiny.audioTap.on((c) => {
    if (!c || !c.pcm) return;
    if (!/^A{40}/.test(c.pcm)) { tapLastLoud = performance.now(); tapHinted = false; }
    let bin;
    try { bin = atob(c.pcm); } catch (e) { return; }
    const chans = Math.max(1, c.channels || 2);
    const frames = c.frames || ((bin.length / 2 / chans) | 0);
    if (!frames) return;
    // Linux: the tap IS the analysis path, for every source, always.
    if (NO_GRAPH) { tapSR = c.sampleRate || tapSR; pushTapPcm(bin, chans, frames); return; }
    if (!tapAn) return;
    if (!(radio && radioActive === radioRawEl) || radioRawEl.paused) return;
    if (ctx.state === 'suspended') { ctx.resume(); return; }
    const buf = ctx.createBuffer(chans, frames, c.sampleRate || 48000);
    for (let ch = 0; ch < chans; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < frames; i++) {
        const j = 2 * (i * chans + ch);
        d[i] = ((bin.charCodeAt(j) | (bin.charCodeAt(j + 1) << 8)) << 16 >> 16) / 32768;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(tapAn);               // analyser only — never the destination
    const t0 = Math.max(ctx.currentTime + 0.06, tapT2);
    src.start(t0);
    tapT2 = t0 + buf.duration;
  });
}

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
$('bal').addEventListener('input', (e) => {
  balance = e.target.value / 100;
  // detent at center, like the rack's knob: close enough snaps to dead center
  if (Math.abs(balance) < 0.06) { balance = 0; e.target.value = 0; }
  applyBalance(); publish();
});

function setShuffle(v) { shuffle = v; $('shuffle').classList.toggle('lit', shuffle); publish(true); }
function cycleRepeat(m) {
  repeatMode = m != null ? m : (repeatMode + 1) % 3;   // off → all → one → off
  $('repeat').classList.toggle('lit', repeatMode > 0);
  $('repeat').textContent = repeatMode === 2 ? '↻¹' : '↻';
  $('repeat').title = ['Repeat: off', 'Repeat: all', 'Repeat: one'][repeatMode];
  publish(true);
}
$('shuffle').onclick = () => setShuffle(!shuffle);
$('repeat').onclick = () => cycleRepeat();
$('tEq').onclick = () => tiny.api.call('toggleWindow', { id: 'eq' });
$('tPl').onclick = () => tiny.api.call('toggleWindow', { id: 'playlist' });
$('tRad').onclick = () => tiny.api.call('toggleWindow', { id: 'radio' });
$('tPod').onclick = () => tiny.api.call('toggleWindow', { id: 'podcast' });
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
    case 'radio': radioTune(a.station, a.list, a.idx); break;
    case 'podPlay': podAdd(a.track, false); break;
    case 'podQueue': podAdd(a.track, true); break;
    case 'radioOff': radioOff(); break;
    case 'eq': applyEq(a.eq); publish(true); break;
    case 'vol': volume = a.value; $('vol').value = Math.round(volume * 100); applyBalance(); publish(); break;
    case 'bal': balance = a.value; $('bal').value = Math.round(balance * 100); applyBalance(); publish(); break;
    case 'shuffle': setShuffle(!shuffle); break;
    case 'repeat': cycleRepeat(); break;
  }
});
function applyWindows(w) {
  if (!w) return;
  $('tEq').classList.toggle('lit', !!w.eq);
  $('tPl').classList.toggle('lit', !!w.playlist);
  $('tRad').classList.toggle('lit', !!w.radio);
  $('tPod').classList.toggle('lit', !!w.podcast);
  $('tViz').classList.toggle('lit', !!w.viz);
  $('tBig').classList.toggle('lit', !!w.rack);
}
tiny.api.on('windows', applyWindows);

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
  // the backend broadcast its 'windows' snapshot while this page was still
  // booting (init() reopens saved panels before we subscribe) — pull it
  try { applyWindows(await tiny.api.call('windowState')); } catch (e) {}
  try {
    const m = await tiny.store.get('specMode');
    if (SPEC_MODES.some(([k]) => k === m)) setSpecMode(m, true);
  } catch (e) {}
  try { podState = (await tiny.store.get('podState')) || {}; } catch (e) {}
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
      applyBalance();   // the restored volume has to reach the element, not just the slider
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





















