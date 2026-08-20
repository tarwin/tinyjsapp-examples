// vizlab.js — write a visualizer without leaving amp.
//
// This is an amp window like any other, so it uses amp's REAL sandbox: the same
// vizhost.js that the viz window uses, and the same runtime the backend hands
// out. What runs here is what runs there. No copies, no build step, nothing to
// drift.
//
// It opens your plugin's index.js off disk, watches it, and re-runs on save.
// Errors and amp.log() land in the pane at the bottom instead of vanishing into
// a black rectangle, which is the whole reason this window exists.

const $ = (id) => document.getElementById(id);

// ── the log pane ────────────────────────────────────────────────────────────
function log(msg, cls) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  const t = new Date();
  d.textContent = String(t.getHours()).padStart(2, '0') + ':'
    + String(t.getMinutes()).padStart(2, '0') + ':'
    + String(t.getSeconds()).padStart(2, '0') + '  ' + msg;
  $('log').appendChild(d);
  $('log').scrollTop = $('log').scrollHeight;
  while ($('log').children.length > 300) $('log').removeChild($('log').firstChild);
}

// ── audio: a real element you can hear, tapped for analysis ─────────────────
// amp's viz window keeps its twin silent because the deck is already playing.
// Here nothing else is playing, so the lab is the thing making the sound.
const au = $('au');
let ac = null, hub = null, srcNode = null;
function ensureAudio() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    hub = ac.createGain();
    srcNode = ac.createMediaElementSource(au);
    srcNode.connect(hub);
    hub.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume();
  return { ctx: ac, srcNode: hub };
}

// ── the sandbox, straight out of amp ────────────────────────────────────────
let runtimeSrc = null;
window.ampVizRuntime = async () => {
  if (runtimeSrc == null) {
    try { runtimeSrc = await tiny.api.call('vizRuntime'); } catch (e) { runtimeSrc = ''; }
    if (!runtimeSrc) { runtimeSrc = ''; log('could not load the plugin runtime', 'err'); }
  }
  return runtimeSrc;
};

let hdrOK = false;
let host = null;
function ensureHost() {
  if (host) return host;
  host = window.ampVizHost.create({
    wrap: $('wrap'),
    getAudio: ensureAudio,
    hdr: () => hdrOK,
    // unlike the viz window, keep drawing when this window is not focused —
    // you are looking at it while typing somewhere else
    pauseWhenHidden: false,
    onOsd: (t) => { $('osd').textContent = t; },
    onStatus: (st) => {
      if (st.state === 'ready') log('running on ' + st.backend + (st.hdr ? ' (hdr available)' : ''), 'ok');
      else if (st.state === 'presets') log('presets: ' + st.presets.join(', '));
      else if (st.state === 'error') log(st.message, 'err');
      else if (st.state === 'fatal' || st.state === 'hung') log(st.message, 'err');
    },
  });
  return host;
}

// amp probes HDR by rendering and reading back, because WebKit has accepted an
// rgba16float canvas and then presented black. Same probe here.
(async () => {
  try {
    if (!navigator.gpu || !matchMedia('(dynamic-range: high)').matches) return;
    const ad = await navigator.gpu.requestAdapter(); if (!ad) return;
    const dev = await ad.requestDevice();
    const cv = document.createElement('canvas'); cv.width = cv.height = 8;
    const ctx = cv.getContext('webgpu');
    ctx.configure({ device: dev, format: 'rgba16float', alphaMode: 'opaque', toneMapping: { mode: 'extended' } });
    const enc = dev.createCommandEncoder();
    const p = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: { r: .9, g: .9, b: .9, a: 1 } }] });
    p.end(); dev.queue.submit([enc.finish()]);
    await new Promise((r) => requestAnimationFrame(r));
    const s = document.createElement('canvas'); s.width = s.height = 8;
    const sc = s.getContext('2d'); sc.drawImage(cv, 0, 0);
    const d = sc.getImageData(0, 0, 8, 8).data;
    let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
    hdrOK = lit > 32; dev.destroy();
    if (hdrOK) log('this display is real HDR, so create() gets hdr: true');
  } catch (e) {}
})();

// ── run ─────────────────────────────────────────────────────────────────────
let runs = 0;
async function run() {
  const source = $('code').value;
  if (!source.trim()) { log('nothing to run', 'err'); return; }
  ensureAudio();
  const h = ensureHost();
  $('hint').style.display = 'none';
  $('osd').textContent = '';
  log('--- run ' + (++runs) + ' ---');
  try {
    await h.load({ id: 'lab', source });
    h.setActive(true);
    h.resize($('wrap').clientWidth, $('wrap').clientHeight);
    h.setTrack({ id: audioPath || 'lab', title: trackTitle, playing: !au.paused,
      elapsed: au.currentTime || 0, duration: au.duration || 0, isRadio: false });
  } catch (e) { log(String(e), 'err'); }
}

$('run').onclick = run;
$('rand').onclick = () => host && host.command('random');
$('next').onclick = () => host && host.command('next');
$('prev').onclick = () => host && host.command('prev');
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'vizlab' });
// The lab has no manifest to read, so while you are testing a game it forwards
// the arrows and a couple of likely buttons. Never while the caret is in the
// editor, where those keys are yours.
const LAB_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'z', 'x', 'c', ' ']);
const typing = () => document.activeElement === codeEl;
document.addEventListener('keyup', (e) => {
  if (typing() || !host || !LAB_KEYS.has(e.key)) return;
  e.preventDefault();
  host.key('up', e.key);
});
document.addEventListener('keydown', (e) => {
  if (!typing() && host && LAB_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    host.key('down', e.key, e.repeat);
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  else if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
  else if (e.key === 'Escape' && document.activeElement !== $('code'))
    tiny.api.call('toggleWindow', { id: 'vizlab' });
});
window.addEventListener('resize', () => { if (host) host.resize($('wrap').clientWidth, $('wrap').clientHeight); });

// fps and frame count, read off the acked frames the host already counts
let lastFrames = 0, lastT = performance.now();
setInterval(() => {
  if (!host || !host.backend) { $('hud').textContent = ''; return; }
  const f = host.frames, now = performance.now();
  const fps = Math.round((f - lastFrames) * 1000 / Math.max(1, now - lastT));
  lastFrames = f; lastT = now;
  $('hud').textContent = host.backend + '   ' + fps + ' fps';
}, 1000);

// keep the plugin's idea of the track current, so track()/transport() fire
let trackTitle = '', audioPath = '', wasPlaying = false;
setInterval(() => {
  if (!host) return;
  host.setTrack({ id: audioPath || '', title: trackTitle, playing: !au.paused,
    elapsed: au.currentTime || 0, duration: au.duration || 0, isRadio: false });
  if (!au.paused !== wasPlaying) { wasPlaying = !au.paused; $('play').textContent = au.paused ? '▶' : '⏸'; }
}, 400);

// ── files: the backend does the reading, writing and watching ───────────────
let jsPath = '', watching = false;

async function openJs() {
  if (!(await confirmReplace('another file'))) return;
  let p = null;
  try { p = await tiny.dialog.openFile(); } catch (e) {}
  if (!p) return;
  if (!/\.js$/i.test(p)) { log('that is not a .js file', 'err'); return; }
  try {
    const src = await tiny.api.call('vizLabRead', { path: p });
    setCode(src);
    jsPath = p;
    setFileName(p.split('/').pop());
    log('opened ' + p, 'ok');
    run();
  } catch (e) { log('could not read that file: ' + (e.message || e), 'err'); }
}

async function save() {
  if (!jsPath) { log('nothing opened to save to — use Install… to put this somewhere', 'err'); return; }
  try {
    await tiny.api.call('vizLabSave', { path: jsPath, source: codeEl.value });
    baseline = codeEl.value;                 // saved, so no longer dirty
    markDirty();
    log('saved ' + jsPath.split('/').pop(), 'ok');
  } catch (e) { log('could not save: ' + (e.message || e), 'err'); }
}

$('open').onclick = openJs;
$('save').onclick = save;

$('watch').onclick = async () => {
  if (!jsPath) { log('open a file first, then Watch re-runs it on every save', 'err'); return; }
  watching = !watching;
  $('watch').classList.toggle('on', watching);
  try { await tiny.api.call('vizLabWatch', { path: watching ? jsPath : null }); } catch (e) {}
  log(watching ? 'watching ' + jsPath.split('/').pop() + ', it will re-run when you save' : 'not watching');
};
// the backend saw the file change
tiny.api.on('vizlab-changed', async () => {
  if (!watching || !jsPath) return;
  // you edited here AND the file moved underneath: reloading would throw your
  // edits away without asking, so say so and let you decide
  if (isDirty()) {
    log('the file changed on disk, but you have unsaved edits here. Save (⌘S) or '
      + 'turn Watch off, then re-open.', 'err');
    return;
  }
  try {
    setCode(await tiny.api.call('vizLabRead', { path: jsPath }));
    log('file changed on disk');
    run();
  } catch (e) {}
});

// Install: copy what is in the editor into amp's own visualizer folder, with a
// viz.json beside it, so the thing you have been editing becomes a real plugin
// in the picker.
$('install').onclick = async () => {
  const name = await tiny.dialog.prompt('Install this visualizer as…', {
    default: (jsPath ? jsPath.split('/').slice(-2, -1)[0] : 'my-visualizer'), ok: 'Install',
  });
  if (!name) return;
  try {
    const got = await tiny.api.call('vizLabInstall', { name, source: $('code').value });
    log('installed as "' + got.name + '" — it is in the viz picker now', 'ok');
  } catch (e) { log('could not install: ' + (e.message || e), 'err'); }
};

// ── audio ───────────────────────────────────────────────────────────────────
$('audio').onclick = async () => {
  let p = null;
  try { p = await tiny.dialog.openFile(); } catch (e) {}
  if (!p) return;
  if (following) setFollow(false);
  au.volume = 1;
  audioPath = p;
  trackTitle = p.split('/').pop().replace(/\.[^.]+$/, '');
  $('trackName').textContent = trackTitle;
  au.src = tiny.fileURL(p);
  ensureAudio();
  au.play().catch((e) => log('could not play that file: ' + e.name, 'err'));
  log('audio: ' + trackTitle, 'ok');
};
// ── follow whatever amp is playing ──────────────────────────────────────────
// The lab's element goes silent and mirrors the deck's position, so you hear
// amp and the lab reacts to the same music. This is the trick amp's viz window
// already uses: a page cannot reach another window's audio graph, so it plays
// its own muted copy of the same file and keeps the clock in step.
let following = false, followPath = '';
function setFollow(on) {
  following = on;
  $('follow').classList.toggle('on', on);
  au.volume = on ? 0 : 1;
  if (!on) { log('no longer following amp'); return; }
  audioPath = ''; followPath = '';
  log('following amp. The deck plays, the lab listens.', 'ok');
  tiny.api.call('hello').then(applyDeck).catch(() => {});
}
function applyDeck(state) {
  if (!following || !state) return;
  const t = state.tracks && state.tracks[state.idx];
  const path = state.radio ? null : (t && t.path);
  const url = state.radio ? state.radio.url : (t && t.url);
  const key = path || url || '';
  if (!key) { $('trackName').textContent = 'amp has nothing loaded'; return; }
  if (key !== followPath) {
    followPath = key;
    audioPath = key;
    trackTitle = state.radio ? (state.radio.name || 'radio')
      : ((t.name || '').replace(/\.[^.]+$/, ''));
    $('trackName').textContent = trackTitle;
    // .mid and tracker modules are not audio until rendered (render.js, the
    // same pipeline the deck uses) — everything else loads straight off disk
    if (path && window.ampRender && window.ampRender.isRendered(path)) {
      try { au.pause(); au.removeAttribute('src'); } catch (e) {}
      window.ampRender.render(path).then((r) => {
        if (followPath !== key) return;
        au.crossOrigin = null;
        au.src = r.url;
        au.load();
        ensureAudio();
      }).catch(() => log('could not render ' + trackTitle, 'err'));
      return;
    }
    au.crossOrigin = path ? null : 'anonymous';
    au.src = path ? tiny.fileURL(path) : (tiny.proxyURL ? tiny.proxyURL(url) : url);
    au.load();
    ensureAudio();
  }
  // keep the clock within a third of a second of the deck
  if (state.elapsed != null && au.duration && Math.abs((au.currentTime || 0) - state.elapsed) > 0.35) {
    try { au.currentTime = Math.min(state.elapsed, au.duration - 0.05); } catch (e) {}
  }
  if (state.playing) { if (au.paused) au.play().catch(() => {}); }
  else if (!au.paused) au.pause();
}
tiny.api.on('state', applyDeck);
$('follow').onclick = () => setFollow(!following);

$('play').onclick = () => {
  if (!au.src) { log('pick a track with Audio… first'); return; }
  ensureAudio();
  if (au.paused) au.play().catch(() => {}); else au.pause();
};
au.addEventListener('error', () => log('audio failed to load', 'err'));

// dropping a file on the window does the obvious thing with it
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  if (/\.js$/i.test(f.name)) {
    if (!(await confirmReplace(f.name))) return;
    setCode(await f.text());
    setFileName(f.name);
    jsPath = '';                    // a dropped File has no path we can save to
    log('loaded ' + f.name + ' (dropped, so Save needs Open… or Install…)', 'ok');
    run();
  } else {
    audioPath = f.name;
    trackTitle = f.name.replace(/\.[^.]+$/, '');
    $('trackName').textContent = trackTitle;
    au.src = URL.createObjectURL(f);
    ensureAudio();
    au.play().catch(() => {});
    log('audio: ' + f.name, 'ok');
  }
});

// ── the highlight layer ─────────────────────────────────────────────────────
// The <pre> behind the textarea carries the colour; the textarea keeps the
// caret, selection, undo and every other native editing behaviour. They only
// stay lined up if the paint follows every change AND every scroll.
const codeEl = $('code'), hlEl = $('hl');
let paintT = 0;
function paint() {
  hlEl.innerHTML = window.ampHighlight(codeEl.value);
  syncScroll();
}
function syncScroll() {
  hlEl.scrollTop = codeEl.scrollTop;
  hlEl.scrollLeft = codeEl.scrollLeft;
}
codeEl.addEventListener('input', () => { clearTimeout(paintT); paintT = setTimeout(paint, 16); });
codeEl.addEventListener('scroll', syncScroll);
// Tab inserts a tab instead of leaving the editor, which is what you want in
// something you are typing code into
codeEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  const a = codeEl.selectionStart, b = codeEl.selectionEnd;
  codeEl.value = codeEl.value.slice(0, a) + '  ' + codeEl.value.slice(b);
  codeEl.selectionStart = codeEl.selectionEnd = a + 2;
  paint();
});
// What is on disk (or in the template you loaded), so the lab knows whether
// you have unsaved work before it replaces the editor with something else.
let baseline = '';
function setCode(text, clean) {
  codeEl.value = text;
  if (clean !== false) baseline = text;
  paint();
  markDirty();
}
const isDirty = () => codeEl.value !== baseline;
function markDirty() {
  const name = $('fileName');
  const base = name.dataset.name || 'untitled';
  name.textContent = base + (isDirty() ? ' •' : '');
}
codeEl.addEventListener('input', markDirty);
function setFileName(n) { $('fileName').dataset.name = n; markDirty(); }

// Anything that is about to throw away the editor asks first, and only when
// there is something to throw away.
async function confirmReplace(what) {
  if (!isDirty()) return true;
  try {
    return await tiny.dialog.confirm('Replace what is in the editor?', {
      detail: 'You have unsaved changes' + (jsPath ? ' to ' + jsPath.split('/').pop() : '')
        + '. Loading ' + what + ' will discard them.',
      ok: 'Discard and load', cancel: 'Keep editing',
    });
  } catch (e) { return true; }
}

// ── draggable gutters ───────────────────────────────────────────────────────
// The canvas and the code are both the thing you are looking at, depending on
// the minute, so neither gets a fixed share.
function dragGutter(el, onMove) {
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('lab-dragging');
    const move = (ev) => onMove(ev);
    const up = () => {
      document.body.classList.remove('lab-dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (host) host.resize($('wrap').clientWidth, $('wrap').clientHeight);
      tiny.api.call('setLabLayout', { side: $('side').offsetWidth, log: $('log').offsetHeight }).catch(() => {});
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}
dragGutter($('gutterV'), (e) => {
  const w = Math.min(Math.max(280, window.innerWidth - e.clientX), Math.max(320, window.innerWidth - 260));
  $('side').style.width = w + 'px';
  if (host) host.resize($('wrap').clientWidth, $('wrap').clientHeight);
});
dragGutter($('gutterH'), (e) => {
  const side = $('side').getBoundingClientRect();
  const h = Math.min(Math.max(60, side.bottom - e.clientY), Math.max(80, side.height - 160));
  $('log').style.height = h + 'px';
});

// ── the starter ─────────────────────────────────────────────────────────────
const TEMPLATE = `// my-visualizer — an amp visualizer plugin.
//
// A plugin is a folder with this file and a viz.json:
//   { "id": "my-visualizer", "name": "My Visualizer", "author": "you",
//     "version": "1.0.0", "backends": ["2d"], "presets": ["one", "two"] }
//
// Install… puts both in amp's visualizer folder for you.

amp.register({
  name: 'My Visualizer',
  backends: ['2d'],          // '2d' runs everywhere. Add 'webgl2' or 'webgpu'.
  presets: ['one', 'two'],   // a non-empty list makes amp show the < > buttons

  create({ canvas, backend, hdr, width, height, state }) {
    const ctx = canvas.getContext('2d');
    let preset = 0;

    // state is the string this visualizer saved last time. It is the only
    // thing a plugin can keep between sessions. JSON is fine.
    const save = state ? JSON.parse(state) : { beats: 0 };

    return {
      // One frame. amp calls this at 60 fps and hands you the audio:
      //   audio.fft    Uint8Array(256)   frequency bins
      //   audio.wave   Uint8Array(1024)  waveform, 128 is silence
      //   audio.bass / mid / treb / level / peak    0 to 1
      //   audio.punch  the transient, meaning something just happened
      //   audio.beat   true on the one frame a beat lands
      //   audio.kick / snare / hat   band-limited beats
      //   audio.beatPhase   0..1 toward the NEXT beat, for anticipation
      //   audio.bpm, audio.confidence, audio.since, audio.loudness, audio.playing
      frame({ audio, t, dt, width, height }) {
        // fade instead of clearing, so movement leaves a trail
        ctx.fillStyle = 'rgba(6,8,12,0.25)';
        ctx.fillRect(0, 0, width, height);

        const cx = width / 2, cy = height / 2;
        const r = Math.min(width, height) * (0.14 + audio.bass * 0.22);

        if (audio.beat) save.beats++;
        ctx.strokeStyle = audio.beat ? '#fff' : (preset ? '#6cf' : '#fa4');
        ctx.lineWidth = 2 + audio.punch * 20;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        for (let i = 0; i < 64; i++) {
          const v = audio.fft[i * 2] / 255;
          const a = (i / 64) * Math.PI * 2 + t * 0.2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          ctx.lineTo(cx + Math.cos(a) * (r + v * v * r * 2), cy + Math.sin(a) * (r + v * v * r * 2));
          ctx.stroke();
        }
      },

      resize(w, h) {},                 // the canvas is already the new size
      randomize() { preset = preset ? 0 : 1; return ['one', 'two'][preset]; },
      preset(n) { if (typeof n === 'number') preset = (preset + n + 2) % 2; },

      // a different track is playing. Fires on a real change, not once a second
      track(info) { amp.log('now playing: ' + (info.title || '?')); },
      // ev.type is 'play', 'pause', 'ended' or 'seek'
      transport(ev) {
        if (ev.type === 'ended') { amp.save(JSON.stringify(save)); }
      },
    };
  },
});
`;
const TEMPLATE_GPU = `// my-visualizer — WebGPU with a WebGL2 fallback.
//
//   { "id": "my-visualizer", "name": "My Visualizer", "author": "you",
//     "version": "1.0.0", "backends": ["webgpu", "webgl2"], "hdr": "optional" }
//
// The shape is the point. One sim that owns every piece of state and every
// audio reaction, and two thin renderers hanging off it. Never fork the sim
// per backend: that is how the WebGL2 path rots while you work on WebGPU.

amp.register({
  name: 'My Visualizer',
  backends: ['webgpu', 'webgl2'],

  async create({ canvas, backend, hdr }) {
    const u = new Float32Array(8);          // the renderers' whole input
    let pulse = 0;

    const sim = {
      u,
      step(audio, dt, t) {
        if (audio.beat) pulse = Math.min(1.5, pulse + 0.5 + audio.punch * 2);
        pulse *= Math.exp(-dt * 2.5);
        u[0] = t; u[1] = audio.bass; u[2] = audio.treb; u[3] = pulse;
        u[4] = canvas.width; u[5] = canvas.height; u[6] = hdr ? 1 : 0;
      },
    };

    let rend = null;
    if (backend === 'webgpu') rend = await createGPU(canvas, sim, hdr);
    if (!rend) rend = createGL2(canvas, sim);
    if (!rend) throw new Error('no renderer could start');

    return {
      get backend() { return rend.name; },
      frame({ audio, dt, t }) { sim.step(audio, dt, t); rend.frame(); },
      resize(w, h) { rend.resize(w, h); },
    };
  },
});

// ── WebGPU ──────────────────────────────────────────────────────────────────
const WGSL = \`
struct U { a: vec4f, b: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  return vec4f(p[i], 0., 1.);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let res = vec2f(u.b.x, u.b.y);
  let uv = (fc.xy - 0.5 * res) / min(res.x, res.y);
  let t = u.a.x; let bass = u.a.y; let treb = u.a.z; let pulse = u.a.w;
  let r = length(uv) * (3.0 + bass * 4.0) - t * 0.8 - pulse;
  let band = 0.5 + 0.5 * sin(r * 6.2831);
  var col = vec3f(0.5 + 0.5 * sin(t * 0.3), 0.4, 0.9) * pow(band, 6.0 + treb * 30.0);
  col = col * (0.4 + bass * 2.0 + pulse) * exp(-length(uv) * length(uv) * 1.2);
  if (u.b.z < 0.5) { col = col / (1.0 + col * 0.4); }   // SDR roll-off
  return vec4f(col, 1.0);
}\`;

async function createGPU(canvas, sim, wantHdr) {
  if (!self.navigator || !navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    const pref = navigator.gpu.getPreferredCanvasFormat();
    let format = pref, hdrOn = false;
    if (wantHdr) {
      try {
        ctx.configure({ device, format: 'rgba16float', alphaMode: 'opaque',
                        toneMapping: { mode: 'extended' } });
        format = 'rgba16float'; hdrOn = true;
      } catch (e) {}
    }
    if (!hdrOn) ctx.configure({ device, format: pref, alphaMode: 'opaque' });
    const mod = device.createShaderModule({ code: WGSL });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const ubo = device.createBuffer({ size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ubo } }] });
    return {
      name: hdrOn ? 'webgpu · hdr' : 'webgpu',
      resize() {},
      frame() {
        device.queue.writeBuffer(ubo, 0, sim.u);
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        device.queue.submit([enc.finish()]);
      },
    };
  } catch (e) { amp.log('webgpu failed, falling back: ' + e.message); return null; }
}

// ── WebGL2: the same passes, SDR only ───────────────────────────────────────
const VS = \`#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
}\`;
const FS = \`#version 300 es
precision highp float;
uniform vec4 u[2];
out vec4 fragColor;
void main() {
  vec2 res = vec2(u[1].x, u[1].y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * res) / min(res.x, res.y);
  uv.y = -uv.y;                        // GL is bottom-up; match the WebGPU image
  float t = u[0].x, bass = u[0].y, treb = u[0].z, pulse = u[0].w;
  float r = length(uv) * (3.0 + bass * 4.0) - t * 0.8 - pulse;
  float band = 0.5 + 0.5 * sin(r * 6.2831);
  vec3 col = vec3(0.5 + 0.5 * sin(t * 0.3), 0.4, 0.9) * pow(band, 6.0 + treb * 30.0);
  col *= (0.4 + bass * 2.0 + pulse) * exp(-length(uv) * length(uv) * 1.2);
  col = col / (1.0 + col * 0.4);
  fragColor = vec4(col, 1.0);
}\`;

function createGL2(canvas, sim) {
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const loc = gl.getUniformLocation(prog, 'u');
  const vao = gl.createVertexArray();
  return {
    name: 'webgl2',
    resize(w, h) { gl.viewport(0, 0, w, h); },
    frame() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform4fv(loc, sim.u);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
`;

// ── the Template menu ───────────────────────────────────────────────────────
// Two starters, plus the two visualizers amp ships, loaded from disk so what
// you get is the real thing rather than a copy that drifts.
const STARTERS = [
  { label: 'Starter · Canvas 2D', src: () => TEMPLATE, name: 'untitled (2d)' },
  { label: 'Starter · WebGPU + WebGL2', src: () => TEMPLATE_GPU, name: 'untitled (gpu)' },
];
const BUNDLED = [
  { label: 'Pulse · the shipped 2D one', id: 'pulse' },
  { label: 'Lattice · the shipped dual-backend one', id: 'lattice' },
];

let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
document.addEventListener('click', (e) => { if (menuEl && !e.target.closest('#tmpl, .lab-menu')) closeMenu(); });

async function loadStarter(entry) {
  if (!(await confirmReplace(entry.label.replace(/ ·.*/, '')))) return;
  if (entry.src) {
    setCode(entry.src());
    setFileName(entry.name);
    jsPath = '';
    log('loaded the ' + entry.label + ' starter', 'ok');
  } else {
    try {
      const got = await tiny.api.call('vizPlugin', { id: entry.id });
      if (!got || !got.source) throw new Error('not found');
      setCode(got.source);
      setFileName(entry.id + '/index.js (copy)');
      // deliberately NOT jsPath: Save must never write over a shipped
      // visualizer. Install… is how this becomes yours.
      jsPath = '';
      log('loaded ' + got.manifest.name + '. Save is off until you Install… it '
        + 'somewhere of your own.', 'ok');
    } catch (e) { log('could not load that one: ' + (e.message || e), 'err'); }
  }
  run();
}

$('tmpl').onclick = (e) => {
  e.stopPropagation();
  if (menuEl) { closeMenu(); return; }
  menuEl = document.createElement('div');
  menuEl.className = 'lab-menu';
  const add = (entry) => {
    const b = document.createElement('button');
    b.className = 'lab-menu-item';
    b.textContent = entry.label;
    b.onclick = () => { closeMenu(); loadStarter(entry); };
    menuEl.appendChild(b);
  };
  STARTERS.forEach(add);
  const sep = document.createElement('div');
  sep.className = 'lab-menu-sep';
  menuEl.appendChild(sep);
  BUNDLED.forEach(add);
  $('tmpl').parentNode.appendChild(menuEl);
  const b = $('tmpl').getBoundingClientRect();
  const p = $('tmpl').parentNode.getBoundingClientRect();
  menuEl.style.right = Math.max(4, p.right - b.right) + 'px';
  menuEl.style.top = (b.bottom - p.top + 3) + 'px';
};

setCode(TEMPLATE);
setFileName('untitled');

// restore the panel sizes from last time
(async () => {
  try {
    const l = await tiny.api.call('getLabLayout');
    if (l && l.side) $('side').style.width = Math.max(280, l.side) + 'px';
    if (l && l.log) $('log').style.height = Math.max(60, l.log) + 'px';
  } catch (e) {}
  if (host) host.resize($('wrap').clientWidth, $('wrap').clientHeight);
})();

log('viz lab ready. Pick a track with Audio…, or Follow amp, then Run (⌘↵)');
