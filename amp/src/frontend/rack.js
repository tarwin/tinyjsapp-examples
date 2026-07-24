// rack.js — the BIG SCREEN: the whole hi-fi as one fullscreen window.
//
// Same satellite contract as the other panels: render from the broadcast
// 'state', send intent back as 'action'. Everything that must move smoothly —
// both viz engines, the VU needles, the EQ's LED bridge — feeds on a hybrid:
// a silent twin <audio> mirrors whatever the page CAN analyse itself (file
// tracks off disk, radio through tiny.proxyURL) at zero permission cost, and
// tiny.audioTap (0.25) steps in ONLY for streams the page can't touch (the
// raw-fallback stations: proxy-defeating redirects and HLS) — starting the
// tap is what triggers macOS's one-time system-audio consent, so it must
// never run for people who just play files.
//
// This page deliberately does NOT load drag.js: there's nothing to drag, and
// its focus → raiseAll hook must never fire from inside a fullscreen Space.

const $ = (id) => document.getElementById(id);

// WebKitGTK ignores writing-mode on range inputs — the sliders render
// horizontal inside a 14px column and appear frozen. Probe the engine and
// flip the stylesheet to the legacy vertical appearance when needed.
{
  const p = document.createElement('input');
  p.type = 'range';
  p.style.writingMode = 'vertical-lr';
  document.documentElement.appendChild(p);
  if (getComputedStyle(p).writingMode !== 'vertical-lr')
    document.documentElement.classList.add('no-vert-wm');
  p.remove();
}


const act = (a) => tiny.api.call('action', a);
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

let state = { tracks: [], idx: -1, playing: false, nextUp: -1, volume: 0.8, balance: 0 };
let eq = { on: false, preamp: 0, bands: new Array(10).fill(0), hp: null };

// ── fullscreen: this window IS the mode ────────────────────────────────────
function enterFs() { try { tiny.win.fullscreen(); } catch (e) {} }
tiny.api.on('enterFullscreen', enterFs);   // re-shown after standby → go big again
function standby() {
  try { tiny.win.setFullscreen(false); } catch (e) {}
  // let the un-fullscreen animation land before the window hides
  setTimeout(() => tiny.api.call('toggleWindow', { id: 'rack' }), 700);
}
$('standby').onclick = standby;

// ── analysis audio: silent twin + audioTap, each for what it's good at ─────
const ac = new (window.AudioContext || window.webkitAudioContext)();
const el = new Audio();
el.preload = 'auto';
// The MediaElementSource routes the twin off the speakers — but WebKit has
// direct-output leaks it doesn't cover, so the element runs at VOLUME zero:
// the graph taps the signal before element volume, so the analysers keep
// theirs. (NOT `muted`: WebKit applies mute at the source and the analysers
// go dark — probed for real.)
// WKWebView taps MediaElementSource PRE-volume (probed), Chromium POST-volume:
// volume 0 silenced the analysers on Windows. The graph never reaches the
// speakers (analyser-only), so full volume is inaudible on both engines —
// but keep 0 on WebKit where it was probed safe.
el.volume = /Chrome/.test(navigator.userAgent) ? 1 : 0;
let srcNode = null, curPath = null, curName = '', curRadio = null, rawNow = false;

// analysis taps: stereo pair for the VU needles, one spectrum for the LEDs
const split = ac.createChannelSplitter(2);
const anL = ac.createAnalyser(), anR = ac.createAnalyser();
anL.fftSize = anR.fftSize = 1024;
const anSpec = ac.createAnalyser();
anSpec.fftSize = 256; anSpec.smoothingTimeConstant = 0.72;
const tdL = new Uint8Array(anL.fftSize), tdR = new Uint8Array(anR.fftSize);
const fd = new Uint8Array(anSpec.frequencyBinCount);

// Everything analyses the HUB: the twin element feeds it for file tracks and
// proxied radio; audioTap PCM chunks feed it for raw-fallback radio. Nothing
// downstream of the hub reaches the speakers — this graph only listens.
const hub = ac.createGain();
hub.connect(split); split.connect(anL, 0); split.connect(anR, 1);
hub.connect(anSpec);
function ensureSrc() {
  if (!srcNode) {
    srcNode = ac.createMediaElementSource(el);   // routes el OFF the speakers
    srcNode.connect(hub);
  }
  return srcNode;
}
let viz = null, connected = false;
function connectGraph() {
  ensureSrc();
  if (viz && !connected) { viz.connectAudio(hub); connected = true; }
}
// a dead twin stream must not retry on every state push
el.addEventListener('error', () => {
  if (curRadio) { try { el.removeAttribute('src'); el.load(); } catch (e) {} }
});

// tiny.audioTap — ONLY for stations the page can't mirror. Starting it is
// what triggers macOS's one-time "record system audio" consent (even for
// scope:'app' — WebKit renders audio in a helper process, which TCC counts
// as capture), so it arms exactly when an untappable station starts playing
// and the permission finally buys something.
let tapT = 0, tapStarted = false;
function ensureTap() {
  if (tapStarted || !window.tiny.audioTap) return;
  tapStarted = true;
  tiny.audioTap.start({ scope: 'app', interval: 80 }).catch(() => {});
}
if (window.tiny.audioTap) {
  tiny.audioTap.on((c) => {
    if (!c || !c.pcm) return;
    // the twin covers everything else — only raw-fallback radio needs us
    if (!rawNow || !state.playing || document.hidden) return;
    if (ac.state === 'suspended') { ac.resume(); return; }   // clock stopped
    let bin;
    try { bin = atob(c.pcm); } catch (e) { return; }
    const chans = Math.max(1, c.channels || 2);
    const frames = c.frames || ((bin.length / 2 / chans) | 0);
    if (!frames) return;
    const buf = ac.createBuffer(chans, frames, c.sampleRate || 48000);
    for (let ch = 0; ch < chans; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < frames; i++) {
        const j = 2 * (i * chans + ch);
        d[i] = ((bin.charCodeAt(j) | (bin.charCodeAt(j + 1) << 8)) << 16 >> 16) / 32768;
      }
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(hub);
    const t0 = Math.max(ac.currentTime + 0.06, tapT);
    src.start(t0);
    tapT = t0 + buf.duration;
  });
}

function loadFor(s) {
  if (!s) return;
  if (s.radio) {
    const raw = !!s.radio.raw || !window.tiny.proxyURL;
    if (s.radio.url !== curRadio || raw !== rawNow) {
      curRadio = s.radio.url; rawNow = raw; curPath = null;
      curName = s.radio.name || 'radio';
      announceTrack();
      if (raw) {
        // main is on the raw-fallback element (redirect/HLS) — the twin
        // can't mirror that; quiet it and let the tap carry the meters
        try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
        el.crossOrigin = null;
        if (s.radio.raw) ensureTap();
        connectGraph();
        if (ac.state === 'suspended') ac.resume();
      } else {
        // proxied stream: the twin mirrors it, untainted, no permissions
        el.crossOrigin = 'anonymous';
        el.src = tiny.proxyURL(s.radio.url); el.load();
        el.onloadedmetadata = () => { connectGraph(); if (ac.state === 'suspended') ac.resume(); };
        if (s.playing) el.play().catch(() => {});
      }
    } else if (!rawNow) {
      if (s.playing) { if (el.paused && el.src) el.play().catch(() => {}); }
      else if (!el.paused) el.pause();
    }
    return;
  }
  if (curRadio) {   // back to the deck: drop the stream, restore file loading
    curRadio = null; rawNow = false;
    try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
    el.crossOrigin = null;
  }
  const t = s.tracks && s.tracks[s.idx];
  if (!t) { curPath = null; curName = ''; try { el.pause(); } catch (e) {} return; }
  const key = t.path || t.url;               // podcast episodes are URL tracks
  if (key === curPath) { sync(s); return; }
  curPath = key;
  curName = (t.name || '').replace(/\.[^.]+$/, '');
  announceTrack();
  if (t.path) { el.crossOrigin = null; el.src = window.ampFileURL(t.path); }
  else { el.crossOrigin = 'anonymous'; el.src = tiny.proxyURL(t.url); }   // same untaint trick as radio
  el.load();
  el.onloadedmetadata = () => { connectGraph(); sync(s); };
}
function sync(s) {
  connectGraph();
  if (ac.state === 'suspended') ac.resume();
  if (s.elapsed != null && el.duration && Math.abs((el.currentTime || 0) - s.elapsed) > 0.35) {
    try { el.currentTime = Math.min(s.elapsed, el.duration - 0.05); } catch (e) {}
  }
  if (s.playing) { if (el.paused) el.play().catch(() => {}); }
  else if (!el.paused) el.pause();
}

// ── the big screen: butterchurn + Geiss HDR (viz.js's engines, full-bleed) ─
const B = window.butterchurn && (window.butterchurn.default || window.butterchurn);
const PP = window.butterchurnPresetsMinimal && (window.butterchurnPresetsMinimal.default || window.butterchurnPresetsMinimal);
const presets = PP && PP.getPresets ? PP.getPresets() : {};
const names = Object.keys(presets);
const glCanvas = $('gl');
let engine = 'milk', geissStarted = false, pIdx = 0, autoTimer = 0;
let sleeveArtFor = null, sleeveArtURI = null;   // local-file cover for the sleeve
let showTitles = true;

function sizeGl() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  glCanvas.width = Math.round(innerWidth * dpr); glCanvas.height = Math.round(innerHeight * dpr);
  if (viz) viz.setRendererSize(glCanvas.width, glCanvas.height);
}
// amp's own WebGPU engines, full-bleed behind the rack (lazily created)
const GPU_ENGINES = {
  magneto: { cv: 'vzmag', lib: () => window.ampMagneto, title: 'magnetosphere' },
  lagoon: { cv: 'vzlag', lib: () => window.ampLagoon, title: 'lagoon' },
  murmur: { cv: 'vzmur', lib: () => window.ampMurmur, title: 'murmuration' },
  ballroom: { cv: 'vzbal', lib: () => window.ampBallroom, title: 'ballroom' },
};
const gpuViz = {};
function sizeMag() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const id in gpuViz)
    gpuViz[id].resize(Math.round(innerWidth * dpr), Math.round(innerHeight * dpr));
}
function ensureGpu(id) {
  if (gpuViz[id] || !GPU_ENGINES[id]) return;
  const lib = GPU_ENGINES[id].lib();
  if (!lib) return;
  gpuViz[id] = lib.create({ canvas: $(GPU_ENGINES[id].cv), getAudio: () => ({ ctx: ac, srcNode: hub }) });
  sizeMag();
}
function pseudo() { return (performance.now() % 997) / 997; }
function nameFlash(text) {
  const v = $('vname'); v.textContent = text; v.classList.add('show');
  clearTimeout(v._t); v._t = setTimeout(() => v.classList.remove('show'), 4000);
}
function loadPreset(blend) {
  if (!viz || !names.length) return;
  const n = names[((pIdx % names.length) + names.length) % names.length];
  viz.loadPreset(presets[n], blend == null ? 2.7 : blend);
  if (engine === 'milk') nameFlash(n);
}
function stepPreset(n) { pIdx += n; loadPreset(2.7); resetAuto(); }
function shake() {
  if (engine === 'milk') { pIdx = Math.floor(names.length * pseudo()); loadPreset(2.7); resetAuto(); }
  else if (gpuViz[engine]) nameFlash(gpuViz[engine].randomize());
  else if (engine === 'geiss' && window.GeissAmpConfig.randomize) window.GeissAmpConfig.randomize();
}
function resetAuto() { clearInterval(autoTimer); autoTimer = setInterval(() => { if (engine === 'milk') stepPreset(1); }, 24000); }
function announceTrack() {
  if (window.GeissAmpConfig.setTrackTitle) window.GeissAmpConfig.setTrackTitle(showTitles ? curName : '');
  if (showTitles && curName && engine === 'milk' && viz && typeof viz.launchSongTitleAnim === 'function') {
    try { viz.launchSongTitleAnim(curName); } catch (e) {}
  }
}

// HDR probe — same dance as viz.js: WebKit has ACCEPTED rgba16float canvases
// and presented black, so render a clear and read the pixels back.
async function probeHdrCanvas() {
  try {
    if (!navigator.gpu || !matchMedia('(dynamic-range: high)').matches) return false;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    const device = await adapter.requestDevice();
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 8;
    const ctx = cv.getContext('webgpu');
    ctx.configure({ device, format: 'rgba16float', alphaMode: 'opaque', toneMapping: { mode: 'extended' } });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{
      view: ctx.getCurrentTexture().createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
    }] });
    pass.end();
    device.queue.submit([enc.finish()]);
    await new Promise((r) => requestAnimationFrame(r));
    const s = document.createElement('canvas'); s.width = 8; s.height = 8;
    const sc = s.getContext('2d');
    sc.drawImage(cv, 0, 0);
    const d = sc.getImageData(0, 0, 8, 8).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
    device.destroy();
    return lit > 32;
  } catch (e) { return false; }
}
async function setEngine(next, persist) {
  if (NEEDS_GPU.has(next) && !HAS_GPU) next = 'milk';   // saved pref this box can't run
  engine = next;
  const geissOn = engine === 'geiss', spkOn = engine === 'speakers';
  const gpuOn = !!GPU_ENGINES[engine];
  $('geiss').style.display = geissOn ? 'block' : 'none';
  for (const id in GPU_ENGINES) $(GPU_ENGINES[id].cv).style.visibility = engine === id ? 'visible' : 'hidden';
  glCanvas.style.visibility = engine === 'milk' ? 'visible' : 'hidden';
  document.body.classList.toggle('speakers', spkOn);
  window.GeissAmpConfig.active = geissOn;
  if (gpuOn) { ensureGpu(engine); sizeMag(); }
  for (const id in gpuViz) gpuViz[id].setActive(engine === id);
  $('engineTitle').textContent = geissOn ? 'geiss hdr' : spkOn ? 'speakers' : gpuOn ? GPU_ENGINES[engine].title : 'milkdrop';
  $('vPrevP').style.display = $('vNextP').style.display = (engine === 'milk' || spkOn) ? '' : 'none';
  $('vPrevP').title = spkOn ? 'Previous speakers (←)' : 'Previous preset (←)';
  $('vNextP').title = spkOn ? 'Next speakers (→)' : 'Next preset (→)';
  $('vRand').style.display = spkOn ? 'none' : '';
  $('vTitles').style.display = (spkOn || gpuOn) ? 'none' : '';
  if (persist) tiny.api.call('setVizEngine', { value: engine });
  if (geissOn && !geissStarted && window.GeissAmpConfig.start) {
    geissStarted = true;
    window.GeissAmpConfig.getAudio = () => ({ ctx: ac, srcNode: hub });
    window.GeissAmpConfig.onFullscreen = () => {};   // this window already is
    // Background duty: Geiss chases 120 Hz by rendering extra subframes with
    // busy-wait spacing when rAF dips below its target — behind the whole
    // animated rack that spiral-drags the main thread down. One render per
    // frame is plenty for wallpaper.
    window.GeissAmpConfig.noSubframes = true;
    try {
      window.GeissAmpConfig.allowHdr = await probeHdrCanvas();
      await window.GeissAmpConfig.start();
    } catch (e) { nameFlash('Geiss HDR failed: ' + e); }
  }
  if (geissOn) window.dispatchEvent(new Event('resize'));
  requestAnimationFrame(layScene);   // after the centered layout lands
  announceTrack();
}
// Same WebGPU story as the visualizer window (see viz.js): without
// navigator.gpu these engines can only paint black, so keep them out of the
// cycle instead of offering them.
const NEEDS_GPU = new Set(['geiss', 'magneto', 'lagoon', 'murmur', 'ballroom']);
const HAS_GPU = !!navigator.gpu;
const ENGINE_ORDER = ['milk', 'geiss', 'magneto', 'lagoon', 'murmur', 'ballroom', 'speakers']
  .filter((e) => HAS_GPU || !NEEDS_GPU.has(e));
$('vEngine').onclick = () => setEngine(ENGINE_ORDER[(ENGINE_ORDER.indexOf(engine) + 1) % ENGINE_ORDER.length], true);
$('vPrevP').onclick = () => { if (engine === 'speakers') cycleSpk(-1); else stepPreset(-1); };
$('vNextP').onclick = () => { if (engine === 'speakers') cycleSpk(1); else stepPreset(1); };
$('vRand').onclick = shake;
$('vTitles').onclick = () => {
  showTitles = !showTitles;
  $('vTitles').classList.toggle('lit', showTitles);
  tiny.api.call('setVizTitles', { value: showTitles });
  announceTrack();
};

// ── receiver: transport, display, seek, knobs ──────────────────────────────
$('rPlay').onclick = () => { if (!state.playing) act({ type: 'toggle' }); };
$('rPause').onclick = () => { if (state.playing) act({ type: 'toggle' }); };
$('rStop').onclick = () => act({ type: 'stop' });
$('rPrev').onclick = () => act({ type: 'prev' });
$('rNext').onclick = () => act({ type: 'next' });
$('rEject').onclick = async () => { const p = await tiny.win.openFiles(); if (p) act({ type: 'add', paths: p }); };
$('rShuf').onclick = () => act({ type: 'shuffle' });
$('rRep').onclick = () => act({ type: 'repeat' });

let seeking = false;
$('rSeek').addEventListener('pointerdown', () => { seeking = true; });
$('rSeek').addEventListener('input', (e) => act({ type: 'seekFrac', frac: e.target.value / 1000 }));
$('rSeek').addEventListener('change', () => { seeking = false; });

// marquee — duplicate + scroll only when the title overflows
let marqText = null;
function setMarquee(text) {
  if (text === marqText) return;
  marqText = text;
  const elT = $('rTitle'), cont = elT.parentElement;
  elT.getAnimations && elT.getAnimations().forEach((a) => a.cancel());
  elT.style.transform = 'translateX(0)';
  elT.textContent = text;
  requestAnimationFrame(() => {
    const over = elT.scrollWidth - cont.clientWidth;
    if (over > 6) {
      elT.textContent = text + '        •        ' + text + '        •        ';
      const half = elT.scrollWidth / 2;
      if (elT.animate) elT.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-half) + 'px)' }],
        { duration: Math.max(9000, half * 30), iterations: Infinity });
    }
  });
}

// knobs: drag up/down; the cap rotates -135°..+135° across the range
function bindKnob(node, get, set, fine) {
  let d = null;
  node.addEventListener('pointerdown', (e) => {
    d = { y0: e.clientY, v0: get(), pid: e.pointerId };
    try { node.setPointerCapture(e.pointerId); } catch (err) {}
  });
  node.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.pid) return;
    set(d.v0 + (d.y0 - e.clientY) / (fine ? 160 : 220));
  });
  const up = () => { d = null; };
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
}
function paintKnobs() {
  $('volKnob').firstElementChild.style.transform = 'rotate(' + (-135 + (state.volume ?? 0.8) * 270) + 'deg)';
  $('balKnob').firstElementChild.style.transform = 'rotate(' + (((state.balance ?? 0) + 1) / 2 * 270 - 135) + 'deg)';
}
bindKnob($('volKnob'),
  () => state.volume ?? 0.8,
  (v) => { state.volume = Math.max(0, Math.min(1, v)); paintKnobs(); act({ type: 'vol', value: state.volume }); });
bindKnob($('balKnob'),
  () => ((state.balance ?? 0) + 1) / 2,
  (v) => { state.balance = Math.max(0, Math.min(1, v)) * 2 - 1; if (Math.abs(state.balance) < 0.06) state.balance = 0; paintKnobs(); act({ type: 'bal', value: state.balance }); },
  true);
$('balKnob').addEventListener('dblclick', () => { state.balance = 0; paintKnobs(); act({ type: 'bal', value: 0 }); });

// ── VU meters: cream dial, needle ballistics, peak LED ─────────────────────
function drawVuFace(g, W, H) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0d0d10'; g.fillRect(0, 0, W, H);
  const r = H * 1.06, cx = W / 2, cy = H * 1.28;   // pivot below the visible face
  // dial card
  g.fillStyle = '#e8dfc8';
  g.fillRect(3, 3, W - 6, H - 6);
  g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(3, 3, W - 6, 8);
  // scale arc: a 90° sweep centered straight up, -23..+3 dB (red past 0)
  const a = (db) => -Math.PI / 2 + ((db + 23) / 26 - 0.5) * (Math.PI / 2);
  const zero = a(0), end = a(3), start = a(-23);
  g.lineWidth = 2.4;
  g.strokeStyle = '#2b2b2b';
  g.beginPath(); g.arc(cx, cy, r, start, zero); g.stroke();
  g.strokeStyle = '#c33';
  g.beginPath(); g.arc(cx, cy, r, zero, end); g.stroke();
  // ticks + labels
  g.font = '700 ' + Math.round(H * 0.093) + 'px -apple-system, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'bottom';
  for (const t of [-20, -10, -7, -5, -3, -1, 0, 1, 3]) {
    const an = a(t), red = t >= 0;
    g.strokeStyle = g.fillStyle = red ? '#c33' : '#2b2b2b';
    g.lineWidth = t === 0 ? 2 : 1.2;
    g.beginPath();
    g.moveTo(cx + Math.cos(an) * (r - 1), cy + Math.sin(an) * (r - 1));
    g.lineTo(cx + Math.cos(an) * (r - H * 0.075), cy + Math.sin(an) * (r - H * 0.075));
    g.stroke();
    g.fillText(String(Math.abs(t)), cx + Math.cos(an) * (r + H * 0.075), cy + Math.sin(an) * (r + H * 0.075) + 3);
  }
  g.fillStyle = '#2b2b2b';
  g.font = '800 ' + Math.round(H * 0.17) + 'px -apple-system, sans-serif';
  g.fillText('VU', cx, H * 0.92);
}
function makeVu(canvas, label) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  return {
    val: -23, peakT: 0,
    draw(db, now) {
      drawVuFace(g, W, H);
      // ballistics: fast-ish attack, lazy decay — the classic bounce
      this.val += (db - this.val) * (db > this.val ? 0.32 : 0.09);
      if (db > 0.5) this.peakT = now;
      const r = H * 1.06, cx = W / 2, cy = H * 1.28;
      const an = -Math.PI / 2 + ((Math.max(-23, Math.min(3, this.val)) + 23) / 26 - 0.5) * (Math.PI / 2);
      g.strokeStyle = '#1a1a1a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(an) * (r - 4), cy + Math.sin(an) * (r - 4));
      g.stroke();
      // peak LED + channel label
      g.fillStyle = now - this.peakT < 400 ? '#ff4545' : '#3a1212';
      g.beginPath(); g.arc(W - 15, 15, 4.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#6b6353';
      g.font = '700 ' + Math.round(H * 0.1) + 'px -apple-system, sans-serif';
      g.textAlign = 'left'; g.fillText(label, 8, H * 0.16);
    },
  };
}
const vuL = makeVu($('vuL'), 'L'), vuR = makeVu($('vuR'), 'R');
function rmsDb(an, buf) {
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
  const rms = Math.sqrt(sum / buf.length);
  return rms > 0.0001 ? 20 * Math.log10(rms) + 6 : -60;   // +6: RMS of full-scale sine ≈ -3dB, nudge 0VU
}

// ── EQ unit ────────────────────────────────────────────────────────────────
const LABELS = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];
const EQ_PRESETS = {
  rock: [5, 4, 2, -1, -1, 1, 3, 4, 4, 4], pop: [-1, 2, 4, 5, 4, 1, -1, -1, -1, -1],
  jazz: [4, 3, 1, 2, -1, -1, 0, 1, 3, 4], classical: [5, 4, 3, 2, -1, -1, 0, 2, 3, 4],
  dance: [6, 5, 2, 0, 0, -2, -3, -3, 0, 0], bass: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 2, 4, 5, 6, 7], vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
};
const faders = $('faders');
function buildFader(label, cls) {
  const col = document.createElement('div');
  col.className = 'fader' + (cls ? ' ' + cls : '');
  const input = document.createElement('input');
  input.type = 'range'; input.min = -12; input.max = 12; input.step = 1; input.value = 0;
  const hz = document.createElement('span'); hz.className = 'hz'; hz.textContent = label;
  col.append(input, hz);
  faders.appendChild(col);
  return input;
}
const preIn = buildFader('PRE', 'pre');
const bandIns = LABELS.map((l) => buildFader(l));
// The EQ runs in Web Audio on macOS/Windows and in a native PipeWire chain on
// Linux, so it's only dead where neither exists. Balance is a different story:
// it was a StereoPanner, and the native chain is symmetric, so it stays
// unavailable on Linux for now.
let NO_EQ = false;
const NO_BALANCE = false;   // native chain carries balance on Linux too
(async () => {
  try {
    const can = await tiny.system.capabilities();
    NO_EQ = tiny.system.isLinux() && !can.audioFilters;
  } catch (e) {}
  if (NO_EQ) disableEq();
  reflectEq();
})();
if (NO_BALANCE) {
  const bal = $('balKnob');
  if (bal) { bal.classList.add('dead'); bal.title = 'Balance unavailable on Linux'; }
}
function disableEq() {
  const head = document.querySelector('.equnit .u-head .etch');
  if (head) head.textContent = 'graphic equalizer — unavailable on Linux';
  document.querySelector('.equnit').title =
    'Linux plays audio outside Web Audio to keep it clean, so there is no filter chain to drive';
  for (const id of ['eqOn', 'eqFlat', 'eqPreset', 'hp']) { const el = $(id); if (el) el.disabled = true; }
  for (const inp of [preIn, ...bandIns]) inp.disabled = true;
}

const sendEq = () => act({ type: 'eq', eq });
preIn.addEventListener('input', () => { eq.preamp = +preIn.value; if (!eq.on) { eq.on = true; } sendEq(); reflectEq(); });
bandIns.forEach((inp, i) => inp.addEventListener('input', () => { eq.bands[i] = +inp.value; if (!eq.on) { eq.on = true; } sendEq(); reflectEq(); }));
$('eqOn').onclick = () => { eq.on = !eq.on; sendEq(); reflectEq(); };
$('eqFlat').onclick = () => { eq.preamp = 0; eq.bands = new Array(10).fill(0); sendEq(); reflectEq(); };
$('eqPreset').onchange = (e) => {
  const p = EQ_PRESETS[e.target.value]; if (!p) return;
  eq.bands = p.slice(); eq.on = true; sendEq(); reflectEq();
  e.target.value = '';
};
// headphone correction — same dropdown as the equalizer window (autoeq.js)
const hpSel = $('hp');
{
  const none = document.createElement('option');
  none.value = ''; none.textContent = 'Headphone correction: none';
  hpSel.appendChild(none);
  const groups = { over: 'Over-ear', in: 'In-ear', bud: 'Earbuds' };
  for (const c of Object.keys(groups)) {
    const og = document.createElement('optgroup');
    og.label = groups[c];
    for (const p of window.AUTOEQ) {
      if (p.c !== c) continue;
      const o = document.createElement('option');
      o.value = p.n; o.textContent = p.n;
      og.appendChild(o);
    }
    hpSel.appendChild(og);
  }
}
hpSel.onchange = () => {
  const p = window.AUTOEQ.find((x) => x.n === hpSel.value) || null;
  eq.hp = p ? { n: p.n, p: p.p, f: p.f } : null;
  sendEq();
};
function reflectEq() {
  preIn.value = eq.preamp;
  bandIns.forEach((inp, i) => { inp.value = eq.bands[i] || 0; });
  $('eqOn').classList.toggle('lit', eq.on);
  // same as the equalizer window: dimmed while off, still draggable
  preIn.parentElement.classList.toggle('off', !eq.on && !NO_EQ);
  preIn.parentElement.classList.toggle('disabled', NO_EQ);
  bandIns.forEach((inp) => {
    inp.parentElement.classList.toggle('off', !eq.on && !NO_EQ);
    inp.parentElement.classList.toggle('disabled', NO_EQ);
  });
  hpSel.value = eq.hp ? eq.hp.n : '';
  // a live profile = headphones exist: plug the jack, park the cans
  const hpOn = !!eq.hp;
  document.body.classList.toggle('hp', hpOn);
  $('pjack').classList.toggle('plugged', hpOn);
  requestAnimationFrame(placeCans);
}

// LED bridge: 10 log-spaced spectrum columns over the faders, peak dots ride
const bridge = $('ledBridge'), bg = bridge.getContext('2d');
const ROWS = 12, COLS = 10;
const colPeaks = new Array(COLS).fill(0);
function drawBridge() {
  const W = bridge.width, H = bridge.height;
  bg.clearRect(0, 0, W, H);
  anSpec.getByteFrequencyData(fd);
  const bins = fd.length;
  const cw = W / COLS, ch = H / ROWS;
  for (let i = 0; i < COLS; i++) {
    const lo = Math.floor(Math.pow(i / COLS, 1.7) * bins);
    const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / COLS, 1.7) * bins));
    let v = 0; for (let j = lo; j < hi && j < bins; j++) v = Math.max(v, fd[j]);
    // pink tilt (same as the player's spectrum): trim the bass columns, lift
    // the top — otherwise the low end pins the meter on almost any music
    v *= 0.6 + 0.55 * (i / (COLS - 1));
    const lit = Math.round(Math.min(1, v / 255) * ROWS);
    colPeaks[i] = Math.max(lit, colPeaks[i] - 0.14);
    for (let r = 0; r < ROWS; r++) {
      const on = r < lit;
      const y = H - (r + 1) * ch;
      bg.fillStyle = r >= ROWS - 1 ? (on ? '#ff4545' : '#2a1212')
        : r >= ROWS - 4 ? (on ? '#ffb437' : '#2a2212')
        : (on ? '#37ff9b' : '#0f2418');
      bg.fillRect(i * cw + cw * 0.18, y + ch * 0.2, cw * 0.64, ch * 0.6);
    }
    const pk = Math.round(colPeaks[i]);
    if (pk > 0) {
      const y = H - pk * ch;
      bg.fillStyle = '#cfe9dc';
      bg.fillRect(i * cw + cw * 0.18, y + ch * 0.2, cw * 0.64, 2);
    }
  }
}

// ── program deck (playlist) — playlist.js's render-key + hand-rolled dblclick
const list = $('list');
let listKey = '';
function renderList() {
  const t = state.tracks || [];
  const key = t.map((tr) => tr.name + '|' + (tr.duration || 0)).join('\n') +
    '#' + state.idx + '#' + state.playing + '#' + state.nextUp + '#' + !!state.radio;
  if (key === listKey) return;
  listKey = key;
  list.replaceChildren();
  if (!t.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'no program — drop audio anywhere, or ADD';
    list.appendChild(li);
  }
  let total = 0;
  t.forEach((tr, i) => {
    total += tr.duration || 0;
    const li = document.createElement('li');
    li.dataset.idx = i;
    if (i === state.idx) li.className = state.playing && !state.radio ? 'on playing' : 'on';
    if (i === state.nextUp) li.classList.add('next');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = (i + 1);
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = (tr.name || '').replace(/\.[^.]+$/, '');
    const d = document.createElement('span'); d.className = 'd'; d.textContent = tr.duration ? fmt(tr.duration) : '–:––';
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; x.title = 'Remove';
    li.append(n, nm, d, x);
    list.appendChild(li);
  });
  $('plCount').textContent = t.length + ' track' + (t.length === 1 ? '' : 's') + (total ? ' · ' + fmt(total) : '');
  const on = list.querySelector('li.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}
let lastClick = { idx: -1, t: 0 };
list.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li || li.classList.contains('empty')) return;
  const i = Number(li.dataset.idx);
  if (e.target.classList.contains('x')) { act({ type: 'remove', idx: i }); return; }
  const now = performance.now();
  if (i === lastClick.idx && now - lastClick.t < 450) {
    lastClick = { idx: -1, t: 0 };
    act({ type: 'play', idx: i });
  } else {
    lastClick = { idx: i, t: now };
    act({ type: 'queue', idx: i });
  }
});
$('plAdd').onclick = async () => { const p = await tiny.win.openFiles(); if (p) act({ type: 'add', paths: p }); };
$('plClear').onclick = () => act({ type: 'clear' });

// ── world radio: the LED globe + station list, via the shared tuner brain
// (tuner.js — the standalone Radio window runs the same factory)
const tuner = window.ampTuner({
  globe: $('globe'), list: $('stations'), city: $('tCity'),
  led: $('tLed'), off: $('tOff'),
});

// ── podcasts in the tuner unit: POD flips the world radio into a pod deck ──
// (a compact cousin of the podcast window: shelf → episodes → play; the pod
// window owns adding/downloading — this is a couch-distance browser)
let podMode = false, podOpen = null, podShelfR = [], podStateR = {}, podDlR = {};
const podFeedsR = new Map();
function podParseR(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const ch = doc.getElementsByTagName('channel')[0];
  if (!ch) return null;
  const tx = (el, tag) => { const n = el.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ''; };
  const eps = [];
  for (const item of ch.getElementsByTagName('item')) {
    const enc = item.getElementsByTagName('enclosure')[0];
    if (!enc || !enc.getAttribute('url')) continue;
    eps.push({ guid: tx(item, 'guid') || enc.getAttribute('url'), title: tx(item, 'title') || 'untitled', url: enc.getAttribute('url') });
    if (eps.length >= 60) break;
  }
  return { title: tx(ch, 'title'), eps };
}
const podUl = $('podStations');
function podNoteR(msg) {
  podUl.replaceChildren();
  const li = document.createElement('li');
  li.className = 'empty'; li.textContent = msg;
  podUl.appendChild(li);
}
function renderPodR() {
  podUl.replaceChildren();
  podUl.classList.remove('grid');
  if (podOpen) {
    const back = document.createElement('li');
    back.innerHTML = '<span class="n">‹</span><span class="nm">back to the shelf</span>';
    back.onclick = () => { podOpen = null; $('tCity').textContent = '—'; renderPodR(); };
    podUl.appendChild(back);
    const f = podFeedsR.get(podOpen);
    if (!f) return;
    const now = state.tracks && state.tracks[state.idx] && state.tracks[state.idx].pod;
    for (const ep of f.eps) {
      const st = podStateR[ep.guid] || {};
      const li = document.createElement('li');
      if (now && now.guid === ep.guid) li.className = 'on';
      if (st.done) li.style.opacity = '.45';
      const n = document.createElement('span'); n.className = 'n';
      n.textContent = li.className ? '♪' : st.done ? '✓' : '·';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = ep.title;
      nm.title = ep.title;
      li.append(n, nm);
      li.onclick = () => {
        const dl = podDlR[ep.guid];
        act({ type: 'podPlay', track: {
          name: ep.title, path: dl ? dl.path : undefined, url: dl ? undefined : ep.url,
          duration: 0, pod: { guid: ep.guid, show: f.title, feed: podOpen },
        } });
      };
      podUl.appendChild(li);
    }
    return;
  }
  if (!podShelfR.length) return podNoteR('shelf is bare — stock it in the POD window');
  podUl.classList.add('grid');
  for (const s of podShelfR) {
    const li = document.createElement('li');
    li.className = 'tile';
    if (s.art) {
      const img = document.createElement('img');
      img.src = s.art; img.alt = '';
      img.onerror = () => img.remove();
      li.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'ph'; ph.textContent = '📻';
      li.appendChild(ph);
    }
    const nm = document.createElement('span'); nm.className = 'cap'; nm.textContent = s.t;
    li.appendChild(nm);
    li.onclick = async () => {
      podOpen = s.u;
      $('tCity').textContent = s.t;
      podNoteR('tuning in…');
      if (!podFeedsR.has(s.u)) {
        try {
          const r = await tiny.api.call('podFetchFeed', { url: s.u });
          const f = r && r.ok ? podParseR(r.xml) : null;
          if (!f) { podNoteR('feed failed'); return; }
          podFeedsR.set(s.u, f);
        } catch (e) { podNoteR('feed failed'); return; }
      }
      if (podOpen === s.u) renderPodR();
    };
    podUl.appendChild(li);
  }
}
async function setPodMode(on) {
  podMode = on;
  $('tPodMode').classList.toggle('lit', on);
  $('tEtch').textContent = on ? 'podcasts' : 'world radio';
  $('globe').style.display = on ? 'none' : '';
  $('stations').style.display = on ? 'none' : '';
  podUl.style.display = on ? '' : 'none';
  if (!on) { $('tCity').textContent = '—'; return; }
  const [sh, ps, dl] = await Promise.all([
    tiny.store.get('podShelf'), tiny.store.get('podState'), tiny.api.call('podDlIndex'),
  ]);
  podShelfR = Array.isArray(sh) ? sh : [];
  podStateR = ps || {};
  podDlR = dl || {};
  renderPodR();
}
$('tPodMode').onclick = () => setPodMode(!podMode);

// ── state → UI ─────────────────────────────────────────────────────────────
function reflect() {
  $('powerLed').classList.toggle('on', true);
  $('powerLed').classList.toggle('pulse', !!state.playing);
  $('rShuf').classList.toggle('lit', !!state.shuffle);
  $('rRep').classList.toggle('lit', (state.repeatMode || 0) > 0);
  $('rRep').textContent = state.repeatMode === 2 ? 'REP1' : 'REP';
  $('rPlay').classList.toggle('lit', !!state.playing);
  $('hubL').classList.toggle('spin', !!state.playing && !state.radio);
  $('hubR').classList.toggle('spin', !!state.playing && !state.radio);
  document.body.classList.toggle('playing', !!state.playing);   // nearfield power LEDs
  document.body.classList.toggle('radio', !!state.radio);       // the antenna comes out 📡
  // the LP sleeve leans into view with the artwork — a podcast's feed image,
  // or (new) the cover embedded in a local file (fetched once per track,
  // cached in the backend). Radio has no sleeve.
  const tNow = state.tracks && state.tracks[state.idx];
  const podNow = !state.radio && tNow && tNow.pod;
  const localArtPath = (!state.radio && tNow && tNow.path && !tNow.pod) ? tNow.path : null;
  if (localArtPath !== sleeveArtFor) {          // current track changed → refetch
    sleeveArtFor = localArtPath; sleeveArtURI = null;
    if (localArtPath) tiny.api.call('trackArt', { path: localArtPath })
      .then((u) => { if (sleeveArtFor === localArtPath) { sleeveArtURI = u; reflect(); } });
  }
  const art = podNow ? (tNow.pod.art || '') : (localArtPath ? (sleeveArtURI || '') : '');
  document.body.classList.toggle('podplay', !!(podNow && art));
  document.body.classList.toggle('localart', !!(localArtPath && art));
  const img = $('sleeveArt');
  if (img.dataset.src !== art) {
    img.dataset.src = art;
    img.style.display = art ? '' : 'none';
    if (art) img.src = art;
  }
  const t = state.tracks && state.tracks[state.idx];
  setMarquee(state.radio ? '📻 ' + state.radio.name
    : (t ? (t.name || '').replace(/\.[^.]+$/, '') : '‹ no track — press ⏏ ›'));
  paintKnobs();
  renderList();
  tuner.reflect(state);
}
tiny.api.on('state', (s) => {
  if (!s) return;
  state = s;
  if (podMode && podOpen) {
    tiny.store.get('podState').then((ps) => { podStateR = ps || {}; renderPodR(); });
  }
  if (s.eq) eq = { on: !!s.eq.on, preamp: s.eq.preamp || 0, bands: (s.eq.bands || new Array(10).fill(0)).slice(0, 10), hp: s.eq.hp || null };
  while (eq.bands.length < 10) eq.bands.push(0);
  loadFor(s);
  reflect();
  reflectEq();
});

// ── the speaker collection: six cabinets, all CSS, all loving cartoons of
// real legends (see README credits). The bar's ‹ › cycle them (←/→ too).
const SPK_MODELS = [
  { id: 'towers', label: 'reference towers', html:
    '<div class="model"><div class="cab">' +
    '<div class="driver tweeter"><div class="dome"></div></div>' +
    '<div class="driver mid"><div class="cone"></div><div class="dust"></div></div>' +
    '<div class="driver woofer"><div class="cone"></div><div class="dust"></div></div>' +
    '<div class="port"></div><div class="badge">amp · acoustic research</div></div>' +
    '<span class="post"></span><span class="crown"></span></div>' },
  { id: 'msp5', label: 'studio nearfields', html:
    '<div class="model m-msp5"><div class="mon">' +
    '<div class="wg"><div class="tw"></div></div>' +
    '<div class="driver"><div class="cone"></div><div class="dust"></div></div>' +
    '<div class="ms-badge">MSP·5 STUDIO</div><div class="pled"></div></div>' +
    '<div class="stand-pillar"></div><div class="stand-base"></div>' +
    '<span class="post"></span><span class="crown"></span></div>' },
  { id: 'l100', label: 'quadrex monitors', html:
    '<div class="model m-l100"><div class="box">' +
    '<div class="waffle"></div><div class="jbadge">L·CENTURY</div></div>' +
    '<span class="post"></span><span class="crown"></span></div>' },
  { id: 'ls50', label: 'uni-driver minis', html:
    '<div class="model m-ls50"><div class="box"><div class="uniq"><div class="tw"></div></div></div>' +
    '<div class="kbadge">uni·driver 50</div>' +
    '<div class="stand-pillar"></div><div class="stand-base"></div>' +
    '<span class="post"></span><span class="crown"></span></div>' },
  { id: 'esl', label: 'electrostatic panels', html:
    '<div class="model m-esl"><div class="panel"></div><div class="rail"></div>' +
    '<div class="ebadge">electrostat · 57</div>' +
    '<div class="leg l1"></div><div class="leg l2"></div><div class="leg l3"></div><div class="leg l4"></div>' +
    '<span class="post"></span><span class="crown"></span></div>' },
  { id: '801', label: 'sphere-head towers', html:
    '<div class="model m-801">' +
    '<div class="head"><div class="pod"><div class="dome"></div></div><div class="kevlar"></div></div>' +
    '<div class="box"><div class="driver woofer"><div class="cone"></div><div class="dust"></div></div></div>' +
    '<div class="bbadge">sphere · eight-oh-one</div>' +
    '<span class="post"></span><span class="crown"></span></div>' },
];
let spkIdx = 0;
function buildSpeakers() {
  const m = SPK_MODELS[spkIdx];
  for (const id of ['spkL', 'spkR']) $(id).querySelector('.build').innerHTML = m.html;
  requestAnimationFrame(layScene);
}
// the bar's ‹ › step presets in Milkdrop — in the speakers engine they step
// cabinets instead (the model name flashes like a preset name)
function cycleSpk(dir) {
  spkIdx = (spkIdx + dir + SPK_MODELS.length) % SPK_MODELS.length;
  buildSpeakers();
  nameFlash(SPK_MODELS[spkIdx].label);
  tiny.api.call('setSpkModel', { value: SPK_MODELS[spkIdx].id });
}

// speaker wire: one red/black pair per side, rack bottom → each model's
// binding-post marker, drooping to the floor between them; plus, when a
// headphone profile is live, the parked cans and their coiled cord. All
// coordinates come from live rects, so it survives any screen or model.
function layScene() {
  const svg = $('cables');
  svg.replaceChildren();
  placeCans();
  if (engine !== 'speakers') return;
  const st = document.querySelector('.stack').getBoundingClientRect();
  const pL = document.querySelector('#spkL .post');
  const pR = document.querySelector('#spkR .post');
  if (!pL || !pR) return;
  const L = pL.getBoundingClientRect(), R = pR.getBoundingClientRect();
  // The far control point sits directly BELOW the terminal, so the wire sags
  // along the floor and then rises dead vertical — up the back of the stand
  // or cabinet, never slicing diagonally across badges and stands.
  const wire = (cls, x1, y1, x2, y2, c1f, sagY) => {
    const c1 = x1 + (x2 - x1) * c1f;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', 'wire ' + cls);
    p.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + c1 + ' ' + sagY + ', ' + x2 + ' ' + sagY + ', ' + x2 + ' ' + y2);
    svg.appendChild(p);
  };
  // The wire rests on the floor the boxes stand on (st.bottom), never below
  // it, and vanishes behind the cabinet at the post marker. Nobody dresses
  // two cable runs identically, so each side gets its own exit point and
  // slack — fixed constants, not random, so resize doesn't fidget. At the
  // SPEAKER end, though, red and black arrive side by side the same way on
  // both cabinets — real speakers have identical terminal plates, not
  // mirrored ones.
  const runs = [
    [st.left + 12, st.bottom - 52, L.x, L.y, 0.26, st.bottom - 5],
    [st.right - 12, st.bottom - 64, R.x, R.y, 0.38, st.bottom - 11],
  ];
  for (const [x1, y1, x2, y2, c1f, sagY] of runs) {
    wire('blk', x1, y1 + 6, x2 + 5, y2 + 3, c1f, sagY + 3);
    wire('red', x1, y1 - 3, x2 - 5, y2 - 3, c1f, sagY - 3);
  }
  svg.setAttribute('viewBox', '0 0 ' + innerWidth + ' ' + innerHeight);
}

// Which cans to draw for which correction profile — a few visual families
// cover the whole AutoEq menu (category comes from the bundled list):
// closed studio over-ears (DT-style velour, the default), open-backs with
// grille backs, AirPods-Max-ish aluminum slabs, Porta-Pro-ish wireframe
// on-ears, and in-ears/buds that just lie on the cabinet.
function hpStyle(hp) {
  const n = (hp && hp.n) || '';
  const cat = (window.AUTOEQ.find((p) => p.n === n) || {}).c || 'over';
  if (/AirPods Max/i.test(n)) return 'apm';
  if (/Porta Pro|KSC75/i.test(n)) return 'pp';
  if (cat === 'bud') return 'bud';
  if (cat === 'in') return 'iem';
  if (/HIFIMAN|Ananda|Sundara|Edition XS|HE400|HD 5|HD 6|HD 58|HD 490|Focal|Clear|SHP9500|Fidelio|K240|K702|K712|LCD|DT 990|DT 900/i.test(n)) return 'open';
  return 'dt';
}
const HP_LABEL = { dt: 'DT·770ish', open: 'open·back', apm: 'max·ish', pp: 'porta·ish', bud: '', iem: '' };

// the headphones: parked on the left speaker's crown marker, coiled cord
// running down to the floor and along it into the receiver's phones jack
function placeCans() {
  const cans = $('cans'), cord = $('hpcord');
  cord.replaceChildren();
  if (engine !== 'speakers' || !eq.hp) return;   // CSS hides both anyway
  const style = hpStyle(eq.hp);
  cans.dataset.hp = style;
  cans.querySelector('.clbl').textContent = HP_LABEL[style] || '';
  const crown = document.querySelector('#spkL .crown');
  if (!crown) return;
  const c = crown.getBoundingClientRect();
  const W = cans.offsetWidth, H = cans.offsetHeight;
  const x = c.left - W / 2, y = c.top - H + Math.min(14, H * 0.1);
  cans.style.left = x + 'px'; cans.style.top = y + 'px';
  const jackEl = document.querySelector('#pjack .jhole');
  const stack = document.querySelector('.stack');
  if (!jackEl || !stack) return;
  const j = jackEl.getBoundingClientRect(), st = stack.getBoundingClientRect();
  const rack = document.querySelector('.rack').getBoundingClientRect();
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('class', 'cord');
  const flat = style === 'bud' || style === 'iem';   // lying loose, no cup to exit
  p.setAttribute('d', cordPath(
    x + W * (flat ? 0.52 : 0.24), y + H * (flat ? 1 : 0.94),   // out of the cans
    j.left + j.width / 2, j.bottom - 2,      // into the plug
    st.bottom - 4,                            // the floor everything stands on
    rack.left));                              // hang PAST the cheek, not down the dials
  cord.appendChild(p);
  cord.setAttribute('viewBox', '0 0 ' + innerWidth + ' ' + innerHeight);
}
// a proper curly cord: swings from the jack out past the rack's wooden cheek,
// lands on the floor beside it, marches toward the speaker in little cursive
// loops, then rises into the cup
function cordPath(cupX, cupY, jackX, jackY, floorY, rackX) {
  // gravity first: straight-ish down the faceplates with a lazy S, landing at
  // the rack's feet — then out past the cheek to where the coils start
  const d = ['M', jackX, jackY,
    'C', jackX - 2, jackY + 90, jackX - 30, jackY + 170, jackX - 22, jackY + 260,
    'C', jackX - 16, (jackY + floorY) / 2 + 120, jackX - 34, floorY - 100, jackX - 30, floorY];
  const step = 17, r = 9;
  const endX = cupX + 36;
  let xx = Math.min(rackX - 40, jackX - 70);
  d.push('C', jackX - 60, floorY + 2, xx + 20, floorY + 2, xx, floorY);
  while (xx - step > endX) {
    // swapped control points make the cubic cross itself — one coil per step
    d.push('C', xx - step - r * 1.7, floorY - r * 2.6,
      xx + r * 1.7, floorY - r * 2.6, xx - step, floorY);
    xx -= step;
  }
  d.push('C', xx - 24, floorY, cupX + 16, cupY + 60, cupX, cupY);
  return d.map((v) => typeof v === 'number' ? Math.round(v * 10) / 10 : v).join(' ');
}

// speakers engine: three spectrum bands → cone excursion CSS vars, wildly
// over-responding on purpose (real drivers barely move; these are cartoons).
// With headphones plugged (a correction profile live) the signal goes to the
// cans instead — the cones decay to rest.
const exc = { lo: 0, mid: 0, hi: 0 };
function driveSpeakers() {
  const bins = fd.length;
  const band = (a, b) => { let v = 0; for (let i = a; i < b && i < bins; i++) v = Math.max(v, fd[i]); return v / 255; };
  const tgt = eq.hp ? { lo: 0, mid: 0, hi: 0 } : {
    lo: Math.pow(band(0, 6), 1.6) * 1.5,
    mid: Math.pow(band(10, 46), 1.5) * 1.3,
    hi: Math.pow(band(56, 118), 1.4) * 1.3,
  };
  for (const k of ['lo', 'mid', 'hi']) exc[k] = tgt[k] > exc[k] ? tgt[k] : exc[k] * 0.8;
  const st = document.documentElement.style;
  st.setProperty('--exc', exc.lo.toFixed(3));
  st.setProperty('--excm', exc.mid.toFixed(3));
  st.setProperty('--exct', exc.hi.toFixed(3));
}

// ── the one animation loop: viz render + VU + LEDs + time readouts ─────────
function frame() {
  requestAnimationFrame(frame);
  if (viz && engine === 'milk') viz.render();
  const now = performance.now();
  vuL.draw(state.playing ? rmsDb(anL, tdL) : -60, now);
  vuR.draw(state.playing ? rmsDb(anR, tdR) : -60, now);
  drawBridge();
  if (engine === 'speakers') driveSpeakers();
  // time + seek ride the twin for files (smooth), the broadcast state for
  // radio (live — elapsed listening time, no length, no seeking)
  const live = !!state.radio;
  const twinT = (isFinite(el.duration) && el.duration) ? el.currentTime : 0;
  const cur = live ? (state.elapsed || 0) : (twinT || state.elapsed || 0);
  const dur = live ? 0 : ((isFinite(el.duration) && el.duration) || state.duration || 0);
  $('rTime').textContent = live ? '📡' : fmt(cur);   // a stream has no clock
  $('rRate').textContent = live ? 'LIVE' : (dur ? fmt(dur) : '—');
  $('rSeek').disabled = live;                        // …and nothing to scrub
  if (dur && !seeking) $('rSeek').value = Math.round((cur / dur) * 1000);
  else if (live) $('rSeek').value = 0;
  tuner.draw();
}

// ── theme: silver in the light, black at night (drag.js's logic, compact —
// this page doesn't load drag.js). Resolved value → <html data-theme>.
const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
let themeMode = 'system', nativeDark = null;
function applyTheme() {
  const dark = nativeDark != null ? nativeDark : sysDark.matches;
  document.documentElement.dataset.theme = themeMode === 'system' ? (dark ? 'dark' : 'light') : themeMode;
}
sysDark.addEventListener('change', applyTheme);
if (tiny.theme && tiny.theme.on) tiny.theme.on((dark) => { nativeDark = dark; applyTheme(); });
tiny.api.on('theme', (v) => { themeMode = v || 'system'; applyTheme(); });
applyTheme();

// clock — a hi-fi has a clock
function tickClock() {
  const d = new Date();
  $('clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
setInterval(tickClock, 5000);
tickClock();

// ── keyboard ───────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') standby();
  else if (e.key === ' ') { e.preventDefault(); act({ type: 'toggle' }); }
  else if (e.key === 'ArrowRight' && e.metaKey) { e.preventDefault(); act({ type: 'next' }); }
  else if (e.key === 'ArrowLeft' && e.metaKey) { e.preventDefault(); act({ type: 'prev' }); }
  else if (e.key === 'ArrowRight') { if (engine === 'milk') stepPreset(1); else if (engine === 'speakers') cycleSpk(1); else shake(); }
  else if (e.key === 'ArrowLeft') { if (engine === 'milk') stepPreset(-1); else if (engine === 'speakers') cycleSpk(-1); else shake(); }
  else if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey) standby();
});
// a keydown nobody marks handled bounces up WKWebView's responder chain and
// macOS BEEPS (drag.js absorbs these elsewhere; this page doesn't load it) —
// focused inputs keep their keys, and preventDefault doesn't stop our own
// listeners above, or Geiss's
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
  e.preventDefault();
});
document.addEventListener('pointerdown', () => { if (ac.state === 'suspended') ac.resume(); });
window.addEventListener('resize', () => { sizeGl(); sizeMag(); tuner.sizeGlobe(); requestAnimationFrame(layScene); });

// ── boot ───────────────────────────────────────────────────────────────────
sizeGl();
if (B && names.length) {
  viz = B.createVisualizer(ac, glCanvas, { width: glCanvas.width, height: glCanvas.height, pixelRatio: 1, textureRatio: 1 });
  connectGraph();
  pIdx = Math.floor(names.length * pseudo());
  loadPreset(0);
  resetAuto();
}
buildSpeakers();
tuner.boot();
frame();
(async () => {
  const [s, eng, titles, spk] = await Promise.all([
    tiny.api.call('hello'), tiny.api.call('getVizEngine'), tiny.api.call('getVizTitles'),
    tiny.api.call('getSpkModel'),
  ]);
  const si = SPK_MODELS.findIndex((m) => m.id === spk);
  if (si > 0) { spkIdx = si; buildSpeakers(); }
  showTitles = titles !== false;
  $('vTitles').classList.toggle('lit', showTitles);
  if (s) {
    state = s;
    if (s.eq) eq = { on: !!s.eq.on, preamp: s.eq.preamp || 0, bands: (s.eq.bands || new Array(10).fill(0)).slice(0, 10), hp: s.eq.hp || null };
    while (eq.bands.length < 10) eq.bands.push(0);
    loadFor(s);
  }
  reflect(); reflectEq();
  // adopt the persisted engine — but 'art' is a viz-window-only mode with no
  // big-screen equivalent (album art shows via the sleeve in speakers view)
  if (eng && eng !== 'milk' && eng !== 'art') setEngine(eng, false);
})();
// mirror live engine changes from the small viz window (ignore its 'art' mode)
tiny.api.on('vizEngine', (v) => { if (v && v !== engine && v !== 'art') setEngine(v, false); });
tiny.api.call('windowReady', { id: 'rack' }).then((w) => {
  if (w && w.theme) { themeMode = w.theme; applyTheme(); }
}).catch(() => {});
enterFs();

