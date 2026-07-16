// rack.js — the BIG SCREEN: the whole hi-fi as one fullscreen window.
//
// Same satellite contract as the other panels: render from the broadcast
// 'state', send intent back as 'action'. Like the visualizer, this window can
// completely cover main — whose timers then throttle to a crawl — so it runs
// its own silent twin of the track (a second <audio> whose MediaElementSource
// feeds analysers, never the speakers). The twin powers everything that has
// to be smooth here: both viz engines, the VU needles, the EQ's LED bridge,
// and the time/seek readouts.
//
// This page deliberately does NOT load drag.js: there's nothing to drag, and
// its focus → raiseAll hook must never fire from inside a fullscreen Space.

const $ = (id) => document.getElementById(id);
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

// ── silent twin audio (the viz window's trick, shared by every meter here) ─
const ac = new (window.AudioContext || window.webkitAudioContext)();
const el = new Audio();
el.preload = 'auto';
let srcNode = null, curPath = null, curName = '';

// analysis taps: stereo pair for the VU needles, one spectrum for the LEDs
const split = ac.createChannelSplitter(2);
const anL = ac.createAnalyser(), anR = ac.createAnalyser();
anL.fftSize = anR.fftSize = 1024;
const anSpec = ac.createAnalyser();
anSpec.fftSize = 256; anSpec.smoothingTimeConstant = 0.72;
const tdL = new Uint8Array(anL.fftSize), tdR = new Uint8Array(anR.fftSize);
const fd = new Uint8Array(anSpec.frequencyBinCount);

function ensureSrc() {
  if (!srcNode) {
    srcNode = ac.createMediaElementSource(el);   // routes el OFF the speakers
    srcNode.connect(split);
    split.connect(anL, 0); split.connect(anR, 1);
    srcNode.connect(anSpec);
  }
  return srcNode;
}
let viz = null, connected = false;
function connectGraph() {
  ensureSrc();
  if (viz && !connected) { viz.connectAudio(srcNode); connected = true; }
}
function loadFor(s) {
  if (!s) return;
  const t = s.tracks && s.tracks[s.idx];
  if (!t) { curPath = null; curName = ''; try { el.pause(); } catch (e) {} return; }
  if (t.path === curPath) { sync(s); return; }
  curPath = t.path;
  curName = (t.name || '').replace(/\.[^.]+$/, '');
  announceTrack();
  el.src = window.ampFileURL(t.path); el.load();
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
let showTitles = true;

function sizeGl() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  glCanvas.width = Math.round(innerWidth * dpr); glCanvas.height = Math.round(innerHeight * dpr);
  if (viz) viz.setRendererSize(glCanvas.width, glCanvas.height);
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
  engine = next;
  const geissOn = engine === 'geiss', spkOn = engine === 'speakers';
  $('geiss').style.display = geissOn ? 'block' : 'none';
  glCanvas.style.visibility = engine === 'milk' ? 'visible' : 'hidden';
  document.body.classList.toggle('speakers', spkOn);
  window.GeissAmpConfig.active = geissOn;
  $('engineTitle').textContent = geissOn ? 'geiss hdr' : spkOn ? 'speakers' : 'milkdrop';
  $('vPrevP').style.display = $('vNextP').style.display = engine === 'milk' ? '' : 'none';
  $('vRand').style.display = $('vTitles').style.display = spkOn ? 'none' : '';
  if (persist) tiny.api.call('setVizEngine', { value: engine });
  if (geissOn && !geissStarted && window.GeissAmpConfig.start) {
    geissStarted = true;
    window.GeissAmpConfig.getAudio = () => ({ ctx: ac, srcNode: ensureSrc() });
    window.GeissAmpConfig.onFullscreen = () => {};   // this window already is
    try {
      window.GeissAmpConfig.allowHdr = await probeHdrCanvas();
      await window.GeissAmpConfig.start();
    } catch (e) { nameFlash('Geiss HDR failed: ' + e); }
  }
  if (geissOn) window.dispatchEvent(new Event('resize'));
  requestAnimationFrame(layCables);   // after the centered layout lands
  announceTrack();
}
$('vEngine').onclick = () => setEngine({ milk: 'geiss', geiss: 'speakers', speakers: 'milk' }[engine], true);
$('vPrevP').onclick = () => stepPreset(-1);
$('vNextP').onclick = () => stepPreset(1);
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
  preIn.parentElement.classList.toggle('disabled', !eq.on);
  bandIns.forEach((inp) => inp.parentElement.classList.toggle('disabled', !eq.on));
  hpSel.value = eq.hp ? eq.hp.n : '';
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
    const lit = Math.round((v / 255) * ROWS);
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
    '#' + state.idx + '#' + state.playing + '#' + state.nextUp;
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
    if (i === state.idx) li.className = state.playing ? 'on playing' : 'on';
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

// ── state → UI ─────────────────────────────────────────────────────────────
function reflect() {
  $('powerLed').classList.toggle('on', true);
  $('powerLed').classList.toggle('pulse', !!state.playing);
  $('rShuf').classList.toggle('lit', !!state.shuffle);
  $('rRep').classList.toggle('lit', (state.repeatMode || 0) > 0);
  $('rRep').textContent = state.repeatMode === 2 ? 'REP1' : 'REP';
  $('rPlay').classList.toggle('lit', !!state.playing);
  $('hubL').classList.toggle('spin', !!state.playing);
  $('hubR').classList.toggle('spin', !!state.playing);
  const t = state.tracks && state.tracks[state.idx];
  setMarquee(t ? (t.name || '').replace(/\.[^.]+$/, '') : '‹ no track — press ⏏ ›');
  paintKnobs();
  renderList();
}
tiny.api.on('state', (s) => {
  if (!s) return;
  state = s;
  if (s.eq) eq = { on: !!s.eq.on, preamp: s.eq.preamp || 0, bands: (s.eq.bands || new Array(10).fill(0)).slice(0, 10), hp: s.eq.hp || null };
  while (eq.bands.length < 10) eq.bands.push(0);
  loadFor(s);
  reflect();
  reflectEq();
});

// speaker wire: one red/black pair per side, rack bottom → cabinet bottom,
// drooping to the floor between them (all coordinates from the live rects,
// so it survives any screen size)
function layCables() {
  const svg = $('cables');
  svg.replaceChildren();
  if (engine !== 'speakers') return;
  const st = document.querySelector('.stack').getBoundingClientRect();
  const L = $('spkL').getBoundingClientRect(), R = $('spkR').getBoundingClientRect();
  const wire = (cls, x1, y1, x2, y2, c1f, c2f, sagY) => {
    const c1 = x1 + (x2 - x1) * c1f, c2 = x1 + (x2 - x1) * c2f;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', 'wire ' + cls);
    p.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + c1 + ' ' + sagY + ', ' + c2 + ' ' + sagY + ', ' + x2 + ' ' + y2);
    svg.appendChild(p);
  };
  // Binding posts sit a way up the cabinet; the rack end exits from behind
  // the side of the case, clear of the bottom corner; the wire rests on the
  // floor the boxes stand on (st.bottom), never below it. Nobody dresses two
  // cable runs identically, so each side gets its own post height, exit
  // point, and slack — fixed constants, not random, so resize doesn't fidget.
  const runs = [
    [st.left + 12, st.bottom - 52, L.right - 14, L.bottom - L.height * 0.12, 0.26, 0.62, st.bottom - 5],
    [st.right - 12, st.bottom - 64, R.left + 14, R.bottom - R.height * 0.155, 0.38, 0.75, st.bottom - 11],
  ];
  for (const [x1, y1, x2, y2, c1f, c2f, sagY] of runs) {
    wire('blk', x1, y1 + 6, x2, y2 + 6, c1f, c2f, sagY + 3);
    wire('red', x1, y1 - 3, x2, y2 - 3, c1f, c2f, sagY - 3);
  }
  svg.setAttribute('viewBox', '0 0 ' + innerWidth + ' ' + innerHeight);
}

// speakers engine: three spectrum bands → cone excursion CSS vars, wildly
// over-responding on purpose (real drivers barely move; these are cartoons)
const exc = { lo: 0, mid: 0, hi: 0 };
function driveSpeakers() {
  const bins = fd.length;
  const band = (a, b) => { let v = 0; for (let i = a; i < b && i < bins; i++) v = Math.max(v, fd[i]); return v / 255; };
  const tgt = {
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
  // time + seek ride the twin (main's timers throttle while we cover it)
  const cur = el.duration ? el.currentTime : (state.elapsed || 0);
  const dur = el.duration || state.duration || 0;
  $('rTime').textContent = fmt(cur);
  $('rRate').textContent = dur ? fmt(dur) : '—';
  if (dur && !seeking) $('rSeek').value = Math.round((cur / dur) * 1000);
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
  else if (e.key === 'ArrowRight') { if (engine === 'milk') stepPreset(1); else shake(); }
  else if (e.key === 'ArrowLeft') { if (engine === 'milk') stepPreset(-1); else shake(); }
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
window.addEventListener('resize', () => { sizeGl(); requestAnimationFrame(layCables); });

// ── boot ───────────────────────────────────────────────────────────────────
sizeGl();
if (B && names.length) {
  viz = B.createVisualizer(ac, glCanvas, { width: glCanvas.width, height: glCanvas.height, pixelRatio: 1, textureRatio: 1 });
  connectGraph();
  pIdx = Math.floor(names.length * pseudo());
  loadPreset(0);
  resetAuto();
}
frame();
(async () => {
  const [s, eng, titles] = await Promise.all([
    tiny.api.call('hello'), tiny.api.call('getVizEngine'), tiny.api.call('getVizTitles'),
  ]);
  showTitles = titles !== false;
  $('vTitles').classList.toggle('lit', showTitles);
  if (s) {
    state = s;
    if (s.eq) eq = { on: !!s.eq.on, preamp: s.eq.preamp || 0, bands: (s.eq.bands || new Array(10).fill(0)).slice(0, 10), hp: s.eq.hp || null };
    while (eq.bands.length < 10) eq.bands.push(0);
    loadFor(s);
  }
  reflect(); reflectEq();
  if (eng && eng !== 'milk') setEngine(eng, false);
})();
tiny.api.call('windowReady', { id: 'rack' }).then((w) => {
  if (w && w.theme) { themeMode = w.theme; applyTheme(); }
}).catch(() => {});
enterFs();
