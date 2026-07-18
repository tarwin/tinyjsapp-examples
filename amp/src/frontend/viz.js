// viz.js — the visualizer window, with two switchable engines:
//   • Milkdrop, via butterchurn (the real Milkdrop 2 engine the Webamp family
//     uses; MIT, github.com/jberg/butterchurn) — WebGL.
//   • Geiss HDR, vendored from Ryan Geiss's modern rewrite of the 1998 Geiss
//     screensaver (Apache-2.0, geisswerks.com/geiss_hdr) — WebGPU. See
//     src/geiss-hdr/README.md for the licenses and the marked modifications.
// Both run as this window's OWN native OS window with real fullscreen — not a
// div. The ⇄ bar button (persisted) switches engines; the inactive one keeps
// its rAF loop alive but skips all work.
//
// Neither engine can reach main's audio graph across the window boundary, so
// this window analyses a hybrid of its own: a silent twin <audio> mirrors
// whatever the page CAN reach itself (file tracks off disk, radio through
// tiny.proxyURL) at zero permission cost, and tiny.audioTap (0.25) steps in
// ONLY for raw-fallback stations (proxy-defeating redirects, HLS) — starting
// the tap triggers macOS's one-time system-audio consent, so it must never
// run for people who just play files.

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const wrap = $('wrap');

const B = window.butterchurn && (window.butterchurn.default || window.butterchurn);
const PP = window.butterchurnPresetsMinimal && (window.butterchurnPresetsMinimal.default || window.butterchurnPresetsMinimal);
const presets = PP && PP.getPresets ? PP.getPresets() : {};
const names = Object.keys(presets);

let viz = null, idx = 0, autoTimer = 0;
let engine = 'milk';          // 'milk' | 'geiss' — persisted via the backend
let geissStarted = false;

// ── analysis audio: silent twin + audioTap, each for what it's good at ─────
const ac = new (window.AudioContext || window.webkitAudioContext)();
const el = new Audio();
el.preload = 'auto';
// volume zero, not muted: the graph taps pre-volume (analysers keep signal),
// mute is applied at the source (analysers go dark) — probed for real
el.volume = 0;
let srcNode = null, connected = false, curPath = null, curRadio = null;
let rawNow = false, playingNow = false;

// Both engines analyse the HUB: twin element for files + proxied radio,
// audioTap PCM for raw-fallback radio. Nothing here reaches the speakers.
const hub = ac.createGain();
function ensureSrc() {
  if (!srcNode) { srcNode = ac.createMediaElementSource(el); srcNode.connect(hub); }
  return srcNode;
}
function connectGraph() {
  ensureSrc();
  if (viz && !connected) { viz.connectAudio(hub); connected = true; }  // → analyser only
}
// a dead twin stream must not retry on every state push
el.addEventListener('error', () => {
  if (curRadio) { try { el.removeAttribute('src'); el.load(); } catch (e) {} }
});
// the tap arms only when an untappable station plays — see rack.js
let tapT = 0, tapStarted = false;
function ensureTap() {
  if (tapStarted || !window.tiny.audioTap) return;
  tapStarted = true;
  tiny.audioTap.start({ scope: 'app', interval: 80 }).catch(() => {});
}
if (window.tiny.audioTap) {
  tiny.audioTap.on((c) => {
    if (!c || !c.pcm) return;
    if (!rawNow || !playingNow || document.hidden) return;
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
function loadFor(state) {
  if (!state) return;
  playingNow = !!state.playing;
  if (state.radio) {
    const raw = !!state.radio.raw || !window.tiny.proxyURL;
    if (state.radio.url !== curRadio || raw !== rawNow) {
      curRadio = state.radio.url; rawNow = raw; curPath = null;
      curName = state.radio.name || 'radio';
      announceTrack();
      if (raw) {
        try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
        el.crossOrigin = null;
        if (state.radio.raw) ensureTap();
        connectGraph();
        if (ac.state === 'suspended') ac.resume();
      } else {
        el.crossOrigin = 'anonymous';
        el.src = tiny.proxyURL(state.radio.url); el.load();
        el.onloadedmetadata = () => { connectGraph(); if (ac.state === 'suspended') ac.resume(); };
        if (state.playing) el.play().catch(() => {});
      }
    } else if (!rawNow) {
      if (state.playing) { if (el.paused && el.src) el.play().catch(() => {}); }
      else if (!el.paused) el.pause();
    }
    return;
  }
  if (curRadio) {   // back to the deck: drop the stream, restore file loading
    curRadio = null; rawNow = false;
    try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
    el.crossOrigin = null;
  }
  const t = state.tracks && state.tracks[state.idx];
  if (!t) { curPath = null; curName = ''; try { el.pause(); } catch (e) {} return; }
  if (t.path === curPath) { sync(state); return; }
  curPath = t.path;
  curName = (t.name || '').replace(/\.[^.]+$/, '');
  announceTrack();                                   // each engine shows it its own way
  el.src = window.ampFileURL(t.path); el.load();     // readAccess → load straight off disk
  el.onloadedmetadata = () => { connectGraph(); sync(state); };
}
function sync(state) {
  connectGraph();
  if (ac.state === 'suspended') ac.resume();
  if (state.elapsed != null && el.duration && Math.abs((el.currentTime || 0) - state.elapsed) > 0.35) {
    try { el.currentTime = Math.min(state.elapsed, el.duration - 0.05); } catch (e) {}
  }
  if (state.playing) { if (el.paused) el.play().catch(() => {}); }
  else if (!el.paused) el.pause();
}

// Tell the active engine what's playing — each renders it natively: Milkdrop
// swirls it through the preset (butterchurn's launchSongTitleAnim), Geiss
// paints it into the image (its own auto-embed path; T repaints, SHIFT+T
// toggles the auto). The bar's T button turns the whole thing off (persisted);
// off means Geiss gets an empty title too, so its T key goes quiet as well.
let curName = '';
let showTitles = true;   // bar toggle, persisted via the backend
function announceTrack() {
  if (window.GeissAmpConfig.setTrackTitle) window.GeissAmpConfig.setTrackTitle(showTitles ? curName : '');
  if (showTitles && curName && engine === 'milk' && viz && typeof viz.launchSongTitleAnim === 'function') {
    try { viz.launchSongTitleAnim(curName); } catch (e) {}
  }
}
tiny.api.on('state', loadFor);

// ── engine switching ────────────────────────────────────────────────────────
// HDR probe for Geiss: WebKit historically ACCEPTED an rgba16float canvas but
// silently presented black (the Geiss author's Safari notes) — macOS 26.5
// WebKit renders it fine. So don't trust configure(): actually render a clear
// and read pixels back. Non-black → real HDR canvas support → Geiss runs its
// HDR path (Ctrl+H compares HDR/SDR live); black or any throw → SDR fallback.
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
    return lit > 32;   // more than half the 64 pixels actually presented
  } catch (e) { return false; }
}
function updateChrome() {
  const milk = engine === 'milk';
  $('engineTitle').textContent = milk ? 'Milkdrop' : 'Geiss HDR';
  $('prev').style.display = $('next').style.display = milk ? '' : 'none';
  $('rand').title = milk ? 'Random preset' : 'Randomize visuals';
  $('hint').textContent = milk
    ? 'F fullscreen · ← → presets · space play/pause'
    : 'F fullscreen · ← → 🎲 randomize · H keys · space play/pause';
  if (!milk) { const n = $('name'); n.textContent = ''; n.classList.add('fade'); }
}
async function setEngine(next, persist) {
  engine = next;
  const geissOn = engine === 'geiss';
  $('geiss').style.display = geissOn ? 'block' : 'none';
  canvas.style.visibility = geissOn ? 'hidden' : 'visible';
  window.GeissAmpConfig.active = geissOn;
  updateChrome();
  if (persist) tiny.api.call('setVizEngine', { value: engine });
  if (geissOn && !geissStarted && window.GeissAmpConfig.start) {
    geissStarted = true;
    window.GeissAmpConfig.getAudio = () => ({ ctx: ac, srcNode: hub });
    window.GeissAmpConfig.onFullscreen = () => goFull();
    try {
      window.GeissAmpConfig.allowHdr = await probeHdrCanvas();
      await window.GeissAmpConfig.start();
    }
    catch (e) { $('name').textContent = 'Geiss HDR failed: ' + e; $('name').classList.remove('fade'); }
  }
  if (geissOn) window.dispatchEvent(new Event('resize'));  // it sized itself while hidden
  announceTrack();   // greet the engine you just switched to with the current track
}

// ── butterchurn ─────────────────────────────────────────────────────────────
function size() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = wrap.clientWidth, h = wrap.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  if (viz) viz.setRendererSize(canvas.width, canvas.height);
}
function start() {
  if (!B || !names.length) { $('name').textContent = 'butterchurn failed to load'; return; }
  viz = B.createVisualizer(ac, canvas, { width: canvas.width, height: canvas.height, pixelRatio: 1, textureRatio: 1 });
  connectGraph();
  idx = Math.floor(names.length * pseudo());
  loadPreset(0);
  resetAuto();
  frame();
  (async () => {
    const [s, eng, titles] = await Promise.all([
      tiny.api.call('hello'), tiny.api.call('getVizEngine'), tiny.api.call('getVizTitles'),
    ]);
    showTitles = titles !== false;
    $('titles').classList.toggle('lit', showTitles);
    loadFor(s);
    if (eng === 'geiss') setEngine('geiss', false);
  })();
}
function pseudo() { return (performance.now() % 997) / 997; }
function loadPreset(blend) {
  if (!viz) return;
  const name = names[((idx % names.length) + names.length) % names.length];
  viz.loadPreset(presets[name], blend == null ? 2.7 : blend);
  if (engine !== 'milk') return;   // don't flash preset names over Geiss
  const el2 = $('name'); el2.textContent = name; el2.classList.remove('fade');
  clearTimeout(el2._t); el2._t = setTimeout(() => el2.classList.add('fade'), 4000);
}
function step(n) { idx += n; loadPreset(2.7); resetAuto(); }
function randomPreset() { idx = Math.floor(names.length * pseudo()); loadPreset(2.7); resetAuto(); }
function resetAuto() { clearInterval(autoTimer); autoTimer = setInterval(() => { if (engine === 'milk') step(1); }, 24000); }
function frame() { requestAnimationFrame(frame); if (viz && engine === 'milk') viz.render(); }

// one "randomize" verb that fits whichever engine is up
function shake() {
  if (engine === 'milk') randomPreset();
  else if (window.GeissAmpConfig.randomize) window.GeissAmpConfig.randomize();
}

// controls
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('rand').onclick = shake;
$('engine').onclick = () => setEngine(engine === 'milk' ? 'geiss' : 'milk', true);
$('titles').onclick = () => {
  showTitles = !showTitles;
  $('titles').classList.toggle('lit', showTitles);
  tiny.api.call('setVizTitles', { value: showTitles });
  announceTrack();   // on: greet with the current track; off: hands Geiss ''
};
// macOS refuses fullscreen on a floating-level window — with always-on-top
// active this window IS floated, so the button would silently do nothing.
// Shed the level first, fullscreen, and take the level back on the way out.
async function goFull() {
  try { await tiny.api.call('unfloat', { id: 'viz' }); } catch (e) {}
  tiny.win.fullscreen();
}
$('full').onclick = goFull;
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'viz' });
canvas.addEventListener('dblclick', goFull);
$('geiss').addEventListener('dblclick', goFull);
if (window.ampBindDrag) window.ampBindDrag($('bar'));

// credits popover — links open in the default browser via the backend
$('credits').onclick = () => { $('creditsBox').style.display = ''; };
$('creditsClose').onclick = () => { $('creditsBox').style.display = 'none'; };
$('creditsBox').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url]');
  if (!a) return;
  e.preventDefault();
  tiny.api.call('openExternal', { url: a.dataset.url });
});

// Space, F, and ⌘arrows are amp's everywhere; the vendored Geiss handler has
// those branches disabled in external-audio mode, so there's no double-fire.
// Everything else (H help, m/p/w, brightness, locks…) falls through to Geiss
// while it's active.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.shiftKey) goFull();
  else if (e.key === 'ArrowRight' && e.metaKey) { e.preventDefault(); tiny.api.call('action', { type: 'next' }); }   // transport, like every window
  else if (e.key === 'ArrowLeft' && e.metaKey) { e.preventDefault(); tiny.api.call('action', { type: 'prev' }); }
  else if (e.key === 'ArrowRight') { if (engine === 'milk') step(1); else shake(); }
  else if (e.key === 'ArrowLeft') { if (engine === 'milk') step(-1); else shake(); }
  else if (e.key === ' ') { e.preventDefault(); tiny.api.call('action', { type: 'toggle' }); }
  else if (e.key === 'Escape') {
    tiny.win.setFullscreen(false);
    tiny.api.call('refloat');   // take the always-on-top level back, if it's set
  }
});

let hideT = 0;
function poke() { wrap.classList.remove('hide-bar'); clearTimeout(hideT); hideT = setTimeout(() => wrap.classList.add('hide-bar'), 2200); }
window.addEventListener('mousemove', poke);
window.addEventListener('resize', size);
poke();

size();
start();
