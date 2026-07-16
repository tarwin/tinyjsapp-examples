// viz.js — the Milkdrop window. Uses butterchurn (the real Milkdrop engine the
// Webamp family uses; MIT), but as its OWN native OS window with real
// fullscreen — not a div.
//
// It can't reach main's audio graph across the window boundary, and it can't
// rely on main pushing samples either: once this window covers main (e.g.
// fullscreen), WebKit throttles main's timers to a crawl. So the visualizer
// runs its OWN silent playback of the same track — a second <audio> whose
// MediaElementSource feeds only butterchurn's analyser, never the speakers —
// kept in step with main via the broadcast 'state'. Its render loop is driven
// by this window's own rAF, which stays smooth because this is the window
// you're looking at.

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const wrap = $('wrap');

const B = window.butterchurn && (window.butterchurn.default || window.butterchurn);
const PP = window.butterchurnPresetsMinimal && (window.butterchurnPresetsMinimal.default || window.butterchurnPresetsMinimal);
const presets = PP && PP.getPresets ? PP.getPresets() : {};
const names = Object.keys(presets);

let viz = null, idx = 0, autoTimer = 0;

// ── silent twin-audio just for the visualizer ──────────────────────────────
const ac = new (window.AudioContext || window.webkitAudioContext)();
const el = new Audio();
el.preload = 'auto';
let srcNode = null, connected = false, curPath = null;

function connectGraph() {
  if (!srcNode) srcNode = ac.createMediaElementSource(el);   // routes el OFF the speakers
  if (viz && !connected) { viz.connectAudio(srcNode); connected = true; }  // → analyser only
}
function loadFor(state) {
  if (!state) return;
  const t = state.tracks && state.tracks[state.idx];
  if (!t) { curPath = null; try { el.pause(); } catch (e) {} return; }
  if (t.path === curPath) { sync(state); return; }
  curPath = t.path;
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
tiny.api.on('state', loadFor);

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
  (async () => { const s = await tiny.api.call('hello'); loadFor(s); })();
}
function pseudo() { return (performance.now() % 997) / 997; }
function loadPreset(blend) {
  if (!viz) return;
  const name = names[((idx % names.length) + names.length) % names.length];
  viz.loadPreset(presets[name], blend == null ? 2.7 : blend);
  const el2 = $('name'); el2.textContent = name; el2.classList.remove('fade');
  clearTimeout(el2._t); el2._t = setTimeout(() => el2.classList.add('fade'), 4000);
}
function step(n) { idx += n; loadPreset(2.7); resetAuto(); }
function randomPreset() { idx = Math.floor(names.length * pseudo()); loadPreset(2.7); resetAuto(); }
function resetAuto() { clearInterval(autoTimer); autoTimer = setInterval(() => step(1), 24000); }
function frame() { requestAnimationFrame(frame); if (viz) viz.render(); }

// controls
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('rand').onclick = randomPreset;
$('full').onclick = () => tiny.win.fullscreen();
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'viz' });
canvas.addEventListener('dblclick', () => tiny.win.fullscreen());
if (window.ampBindDrag) window.ampBindDrag($('bar'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') tiny.win.fullscreen();
  else if (e.key === 'ArrowRight' && e.metaKey) tiny.api.call('action', { type: 'next' });   // transport, like every window
  else if (e.key === 'ArrowLeft' && e.metaKey) tiny.api.call('action', { type: 'prev' });
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === ' ') { e.preventDefault(); tiny.api.call('action', { type: 'toggle' }); }
  else if (e.key === 'Escape') tiny.win.setFullscreen(false);
});

let hideT = 0;
function poke() { wrap.classList.remove('hide-bar'); clearTimeout(hideT); hideT = setTimeout(() => wrap.classList.add('hide-bar'), 2200); }
window.addEventListener('mousemove', poke);
window.addEventListener('resize', size);
poke();

size();
start();
