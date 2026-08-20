// viz.js — the visualizer window, with three switchable engines:
//   • Milkdrop, via butterchurn (the real Milkdrop 2 engine the Webamp family
//     uses; MIT, github.com/jberg/butterchurn) — WebGL.
//   • Geiss HDR, vendored from Ryan Geiss's modern rewrite of the 1998 Geiss
//     screensaver (Apache-2.0, geisswerks.com/geiss_hdr) — WebGPU. See
//     src/geiss-hdr/README.md for the licenses and the marked modifications.
//   • Magnetosphere, amp's own Hodgin homage (magneto.js) — WebGPU + HDR,
//     WebGL1 fallback.
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
// WKWebView taps MediaElementSource PRE-volume (probed), Chromium POST-volume:
// volume 0 silenced the analysers on Windows. The graph never reaches the
// speakers (analyser-only), so full volume is inaudible on both engines —
// but keep 0 on WebKit where it was probed safe.
el.volume = /Chrome/.test(navigator.userAgent) ? 1 : 0;
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
let lastState = null;
function loadFor(state) {
  if (!state) return;
  lastState = state;                 // album-art mode reads the current track from here
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
  const key = t.path || t.url;               // podcast episodes are URL tracks
  if (key === curPath) {
    // same file, maybe a different cue track — announce it, never reload
    const nm = (t.name || '').replace(/\.[^.]+$/, '');
    if (nm !== curName) { curName = nm; announceTrack(); }
    sync(state); return;
  }
  curPath = key;
  curName = (t.name || '').replace(/\.[^.]+$/, '');
  announceTrack();                                   // each engine shows it its own way
  if (engine === 'art') paintArt();                  // new track → repaint the cover
  // a .mid or tracker module is not audio until rendered — this window
  // renders ITS OWN copy through the shared pipeline (render.js), exactly as
  // the big screen does, and the twin plays the local blob
  if (t.path && window.ampRender && window.ampRender.isRendered(t.path)) {
    try { el.pause(); el.removeAttribute('src'); } catch (e) {}   // silent until the render lands
    window.ampRender.render(t.path).then((r) => {
      if (curPath !== key) return;                 // the deck moved on meanwhile
      el.crossOrigin = null;
      el.src = r.url;
      el.load();
      el.onloadedmetadata = () => { connectGraph(); sync(state); };
    }).catch(() => {});
    return;
  }
  if (t.path) { el.crossOrigin = null; el.src = window.ampFileURL(t.path); }   // readAccess → straight off disk
  else { el.crossOrigin = 'anonymous'; el.src = tiny.proxyURL(t.url); }        // same untaint trick as radio
  el.load();
  el.onloadedmetadata = () => { connectGraph(); sync(state); };
}
function sync(state) {
  if (vizHost) vizHost.setTrack(trackInfo());
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
function trackInfo() {
  const st = lastState || {};
  const t = st.tracks && st.tracks[st.idx];
  return {
    // what makes this track THIS track — the host diffs on it so a plugin's
    // track() only fires when the track really changed, not once a second
    id: (st.radio && st.radio.url) || (t && (t.path || t.url)) || '',
    title: showTitles ? curName : '',
    artist: (t && t.artist) || '',
    album: (t && t.album) || '',
    isRadio: !!st.radio,
    playing: !!st.playing,
    elapsed: st.elapsed || 0,
    duration: (t && t.duration) || 0,
  };
}
function announceTrack() {
  if (vizHost) vizHost.setTrack(trackInfo());
  if (window.GeissAmpConfig.setTrackTitle) window.GeissAmpConfig.setTrackTitle(showTitles ? curName : '');
  if (showTitles && curName && engine === 'milk' && viz && typeof viz.launchSongTitleAnim === 'function') {
    try { viz.launchSongTitleAnim(curName); } catch (e) {}
  }
}
tiny.api.on('state', loadFor);
// the big screen (or this window's twin) picked an engine — mirror it, so the
// two views always show the same visualizer. 'speakers' is a big-screen-only
// mode, so we ignore that one here.
tiny.api.on('vizEngine', (v) => { if (v && v !== engine && v !== 'speakers') setEngine(v, false); });

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
  const artOn = engine === 'art';
  const plug = PLUGINS[engine];
  const plugSteps = !!(plug && plug.presets && plug.presets.length > 1);
  $('engineTitle').textContent = ENGINE_LABELS[engine] || 'Milkdrop';
  $('prev').style.display = $('next').style.display = (milk || plugSteps) ? '' : 'none';
  $('rand').style.display = artOn ? 'none' : '';               // no presets to shuffle in art mode
  $('rand').title = milk ? 'Random preset' : engine === 'geiss' ? 'Randomize visuals'
    : engine === 'perm' ? 'New reel' : 'Shuffle the scene';
  if (plug) {
    $('hint').textContent = 'F fullscreen · '
      + (plugSteps ? '← → presets · 🎲 random · ' : '🎲 shuffle · ')
      + 'space play/pause';
    return;
  }
  $('hint').textContent = artOn
    ? 'F fullscreen · album art · space play/pause'
    : milk
      ? 'F fullscreen · ← → presets · space play/pause'
      : engine === 'geiss'
        ? 'F fullscreen · ← → 🎲 randomize · H keys · space play/pause'
        : engine === 'perm'
          ? 'F fullscreen · ← → 🎲 new reel · H controls · space play/pause'
          : 'F fullscreen · ← → 🎲 shuffle · space play/pause';
  if (!milk) { const n = $('name'); n.textContent = ''; n.classList.add('fade'); }
}

// ── album-art view: paint the current track's embedded cover ─────────────────
let artToken = 0;
async function paintArt() {
  const t = lastState && lastState.tracks && lastState.tracks[lastState.idx];
  const box = $('artmode'), img = $('artImg');
  $('artCap').textContent = curName || (t ? (t.display || (t.name || '').replace(/\.[^.]+$/, '')) : '');
  const path = t && t.path;
  // a podcast's feed cover stands in wherever the file has no picture of its
  // own (episodes rarely embed one; streamed ones have no file at all)
  const podArt = (t && t.pod && t.pod.art) || null;
  const noArt = () => {
    if (podArt) { img.src = podArt; box.classList.remove('noart'); }
    else { img.removeAttribute('src'); box.classList.add('noart'); }
  };
  if (!path) { noArt(); return; }
  const token = ++artToken;
  try {
    // { uri, source } — source says whether this is the file's own picture or
    // one the lookup found, which the caption notes so they're never confused
    const art = await tiny.api.call('trackArt', { path });
    if (token !== artToken || engine !== 'art') return;         // track/engine moved on
    if (art && art.uri) {
      img.src = art.uri;
      box.classList.remove('noart');
      if (art.source && art.source !== 'embedded') $('artCap').textContent += '  ·  cover found online';
    } else noArt();
  } catch (e) { noArt(); }
}

// ── the ☰ visualizer picker ─────────────────────────────────────────────────
function toggleList(force) {
  const box = $('vizList');
  const open = force != null ? force : box.style.display === 'none';
  if (!open) { box.style.display = 'none'; return; }
  box.replaceChildren();
  for (const id of ENGINE_ORDER) {
    const b = document.createElement('button');
    b.className = 'vitem' + (id === engine ? ' on' : '');
    b.textContent = ENGINE_LABELS[id];
    b.onclick = (e) => { e.stopPropagation(); setEngine(id, true); toggleList(false); };
    if (PLUGINS[id]) b.title = (PLUGINS[id].description || '')
      + (PLUGINS[id].author ? '\n— ' + PLUGINS[id].author : '')
      + '\n' + PLUGINS[id].backends.join(' / ');
    box.appendChild(b);
  }
  // the way in for other people's visualizers: reveal the folder they live in
  const sep = document.createElement('div');
  sep.className = 'vsep';
  box.appendChild(sep);
  const fromUrl = document.createElement('button');
  fromUrl.className = 'vitem dim';
  fromUrl.textContent = 'Add from URL…';
  fromUrl.title = 'Install a visualizer from a link to its viz.json';
  fromUrl.onclick = async (e) => {
    e.stopPropagation(); toggleList(false);
    const url = await tiny.dialog.prompt('Paste a link to a visualizer\u2019s viz.json', {
      default: 'https://', ok: 'Install',
    });
    if (!url || !/^https:\/\/\S+$/.test(url.trim())) return;
    flashName('installing…', 8000);
    try {
      const got = await tiny.api.call('vizInstall', { url: url.trim() });
      await loadPlugins();
      flashName('installed ' + got.name + (got.author ? ' · ' + got.author : ''), 5000);
      setEngine('p:' + got.id, true);          // show it straight away
    } catch (err) {
      tiny.dialog.alert('That visualizer could not be installed', String(err && err.message || err));
      flashName('');
    }
  };
  box.appendChild(fromUrl);
  const lab = document.createElement('button');
  lab.className = 'vitem dim';
  lab.textContent = 'Viz Lab…';
  lab.title = 'Write and test a visualizer, with a track of your choosing';
  lab.onclick = (e) => { e.stopPropagation(); tiny.api.call('toggleWindow', { id: 'vizlab' }); toggleList(false); };
  box.appendChild(lab);
  const help = document.createElement('button');
  help.className = 'vitem dim';
  help.textContent = 'Writing a visualizer…';
  help.title = 'How to make one of these';
  help.onclick = (e) => { e.stopPropagation(); tiny.api.call('openHelp', { slug: '20-visualizers' }); toggleList(false); };
  box.appendChild(help);
  const add = document.createElement('button');
  add.className = 'vitem dim';
  add.textContent = 'Add a visualizer…';
  add.title = 'Open the folder amp loads visualizers from';
  add.onclick = (e) => { e.stopPropagation(); tiny.api.call('vizFolder', { reveal: true }); toggleList(false); };
  box.appendChild(add);
  box.style.display = '';
}
// amp's own WebGPU engines — Magnetosphere, Lagoon, Murmuration, Ballroom —
// each in its own file and canvas, analysing the same hub; their rAF loops
// idle while inactive, like Geiss. Created lazily on first visit.
const GPU_ENGINES = {
  magneto: { cv: 'vzmag', lib: () => window.ampMagneto, title: 'Magnetosphere' },
  lagoon: { cv: 'vzlag', lib: () => window.ampLagoon, title: 'Lagoon' },
  murmur: { cv: 'vzmur', lib: () => window.ampMurmur, title: 'Murmuration' },
  ballroom: { cv: 'vzbal', lib: () => window.ampBallroom, title: 'Ballroom' },
  perm: { cv: 'vzper', lib: () => window.ampPermutations, title: 'Permutations' },
};
// (album-art has no toolbar toggle — reach it from the ☰ picker or the ⇄ cycle)
// 'art' is a pseudo-engine: no audio reactivity, it just shows the track's
// embedded cover breathing gently (the ☰ picker lists it; 🖼 toggles it).
// WebKitGTK ships no navigator.gpu, so a WebGPU-only engine can only ever paint
// black there — drop those from the picker and the ⇄ cycle rather than offering
// visualisers that can't run. Feature-detected, not platform-detected: a
// WebKitGTK that gains WebGPU lights them back up on its own, and this stays
// correct on machines that lack a suitable adapter for other reasons.
// Lagoon, Murmuration and Permutations are NOT in the set — each carries a full
// WebGL2 renderer (the same passes, SDR), so they run anywhere. Magnetosphere's
// WebGL1 path is a deliberately lesser v1 engine, so it stays gated; Ballroom is
// genuinely WebGPU-only (instanced 3D with a depth buffer).
const NEEDS_GPU = new Set(['geiss', 'magneto', 'ballroom']);
const HAS_GPU = !!navigator.gpu;
const BASE_ORDER = ['milk', 'geiss', 'magneto', 'lagoon', 'murmur', 'ballroom', 'perm', 'art']
  .filter((e) => HAS_GPU || !NEEDS_GPU.has(e));
let ENGINE_ORDER = BASE_ORDER.slice();
const ENGINE_LABELS = { milk: 'Milkdrop', geiss: 'Geiss HDR', magneto: 'Magnetosphere',
  lagoon: 'Lagoon', murmur: 'Murmuration', ballroom: 'Ballroom', perm: 'Permutations',
  art: 'Album Art' };

// ── visualizer PLUGINS ──────────────────────────────────────────────────────
// Everything above this line is amp's own code, loaded into this window. A
// plugin is not: it runs in a worker with no DOM, no bridge and no network
// (vizhost.js), and amp only ever hands it an OffscreenCanvas and audio. So a
// plugin joins the SAME picker and the SAME ⇄ cycle as the built-ins, keyed
// 'p:<id>' — every engine-shaped code path below treats it like any other.
let PLUGINS = {};                     // 'p:<id>' -> manifest
let vizHost = null;
let hdrOK = false;                    // probed once, shared by every plugin
let runtimeSrc = null;

window.ampVizRuntime = async () => {
  if (runtimeSrc == null) {
    try { runtimeSrc = await tiny.api.call('vizRuntime'); } catch (e) { runtimeSrc = ''; }
    if (!runtimeSrc) runtimeSrc = '';
  }
  return runtimeSrc;
};

function ensureHost() {
  if (vizHost || !window.ampVizHost) return vizHost;
  vizHost = window.ampVizHost.create({
    wrap,
    getAudio: () => ({ ctx: ac, srcNode: hub }),
    hdr: () => hdrOK,
    onOsd: (text) => flashName(text),
    onStatus: (st) => {
      if (st.state === 'ready') {
        // the backend a plugin actually got, not the one it asked for
        flashName((ENGINE_LABELS['p:' + st.id.replace(/^p:/, '')] || st.name) + ' · ' + st.backend);
      } else if (st.state === 'presets' && PLUGINS['p:' + st.id.replace(/^p:/, '')]) {
        PLUGINS['p:' + st.id.replace(/^p:/, '')].presets = st.presets;
        updateChrome();
      } else if (st.state === 'error') {
        console.warn('[viz]', st.message);
      } else if (st.state === 'fatal' || st.state === 'hung') {
        // a plugin that dies must not leave a black window with no way out
        flashName(st.message || 'this visualizer stopped', 6000);
        if (engine !== 'milk') setEngine('milk', true);
      }
    },
  });
  return vizHost;
}

async function loadPlugins() {
  let list = [];
  try { list = (await tiny.api.call('vizPlugins')) || []; } catch (e) { list = []; }
  PLUGINS = {};
  const ids = [];
  for (const m of list) {
    // a WebGPU-only plugin can only paint black on WebKitGTK — same rule the
    // built-in NEEDS_GPU set follows, but declared by the plugin itself
    if (!m.backends.some((b) => b !== 'webgpu' || HAS_GPU)) continue;
    const key = 'p:' + m.id;
    PLUGINS[key] = m;
    ENGINE_LABELS[key] = m.name;
    ids.push(key);
  }
  const tail = BASE_ORDER.indexOf('art') >= 0 ? ['art'] : [];
  ENGINE_ORDER = BASE_ORDER.filter((e) => e !== 'art').concat(ids, tail);
}
const gpuViz = {};
function sizeMag() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const id in gpuViz)
    gpuViz[id].resize(Math.round(wrap.clientWidth * dpr), Math.round(wrap.clientHeight * dpr));
  // plugins are told CSS pixels and apply dpr themselves (vizhost)
  if (vizHost) vizHost.resize(wrap.clientWidth, wrap.clientHeight);
}
function ensureGpu(id) {
  if (gpuViz[id] || !GPU_ENGINES[id]) return;
  const lib = GPU_ENGINES[id].lib();
  if (!lib) return;
  gpuViz[id] = lib.create({ canvas: $(GPU_ENGINES[id].cv), getAudio: () => ({ ctx: ac, srcNode: hub }) });
  sizeMag();
}
async function setEngine(next, persist) {
  // A persisted preference (or a saved session from a GPU machine) can still
  // name an engine this box can't run — fall back rather than show black.
  if (NEEDS_GPU.has(next) && !HAS_GPU) next = 'milk';
  // a plugin that was uninstalled since the preference was saved
  if (/^p:/.test(next) && !PLUGINS[next]) next = 'milk';
  engine = next;
  const plugOn = !!PLUGINS[engine];
  // leaving a plugin TERMINATES its worker: one plugin runs at a time, and a
  // backgrounded one has no business holding a GPU device open
  if (vizHost && !plugOn) { vizHost.setActive(false); vizHost.dispose(); }
  const geissOn = engine === 'geiss';
  const artOn = engine === 'art';
  $('geiss').style.display = geissOn ? 'block' : 'none';
  for (const id in GPU_ENGINES) $(GPU_ENGINES[id].cv).style.display = engine === id ? 'block' : 'none';
  canvas.style.visibility = engine === 'milk' ? 'visible' : 'hidden';
  $('artmode').style.display = artOn ? 'flex' : 'none';
  window.GeissAmpConfig.active = geissOn;
  if (GPU_ENGINES[engine]) { ensureGpu(engine); sizeMag(); }
  for (const id in gpuViz) gpuViz[id].setActive(engine === id);
  if (artOn) paintArt();
  updateChrome();
  if (persist) tiny.api.call('setVizEngine', { value: engine });
  if (plugOn) {
    const host = ensureHost();
    const want = engine, man = PLUGINS[want];
    if (!host) { flashName('the plugin sandbox could not start'); return; }
    flashName(man.name + ' …');
    try {
      const got = await tiny.api.call('vizPlugin', { id: man.id });
      if (engine !== want) return;                  // switched again while loading
      if (!got || !got.source) { flashName('could not read ' + man.name); return; }
      await host.load({ id: man.id, source: got.source });
      if (engine !== want) { host.dispose(); return; }
      host.setActive(true);
      host.resize(wrap.clientWidth, wrap.clientHeight);
      host.setTrack(trackInfo());
    } catch (e) { flashName('could not load ' + man.name); }
    return;
  }
  if (artOn) return;   // nothing more to spin up for the still image
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
      loadPlugins(),
    ]);
    showTitles = titles !== false;
    $('titles').classList.toggle('lit', showTitles);
    loadFor(s);
    // one HDR probe for every plugin (the built-ins each do their own)
    probeHdrCanvas().then((v) => { hdrOK = v; }).catch(() => {});
    if (eng === 'geiss' || eng === 'art' || GPU_ENGINES[eng] || PLUGINS[eng]) setEngine(eng, false);
  })();
  // dropping a plugin into the folder shows up without a restart
  tiny.api.on('viz-plugins', async () => {
    const was = engine;
    await loadPlugins();
    toggleList(false);
    if (PLUGINS[was]) setEngine(was, false);       // reload the live one
    else updateChrome();
  });
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
function flashName(text, ms) {
  const n = $('name');
  n.textContent = text || '';
  n.classList.remove('fade');
  clearTimeout(n._t);
  n._t = setTimeout(() => n.classList.add('fade'), ms || 2800);
}
function step(n) {
  if (PLUGINS[engine]) { if (vizHost) vizHost.command(n > 0 ? 'next' : 'prev'); return; }
  idx += n; loadPreset(2.7); resetAuto();
}
function randomPreset() { idx = Math.floor(names.length * pseudo()); loadPreset(2.7); resetAuto(); }
function resetAuto() { clearInterval(autoTimer); autoTimer = setInterval(() => { if (engine === 'milk') step(1); }, 24000); }
function frame() { requestAnimationFrame(frame); if (viz && engine === 'milk') viz.render(); }

// one "randomize" verb that fits whichever engine is up
function shake() {
  if (PLUGINS[engine]) { if (vizHost) vizHost.command('random'); return; }
  if (engine === 'milk') randomPreset();
  else if (gpuViz[engine]) {
    const p = gpuViz[engine].randomize();
    const n = $('name'); n.textContent = p; n.classList.remove('fade');
    clearTimeout(n._t); n._t = setTimeout(() => n.classList.add('fade'), 2500);
  }
  else if (window.GeissAmpConfig.randomize) window.GeissAmpConfig.randomize();
}

// controls
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('rand').onclick = shake;
$('engine').onclick = () => setEngine(ENGINE_ORDER[(ENGINE_ORDER.indexOf(engine) + 1) % ENGINE_ORDER.length], true);
$('list').onclick = (e) => { e.stopPropagation(); toggleList(); };
// a click anywhere else dismisses the picker
document.addEventListener('click', (e) => { if (!e.target.closest('#vizList, #list')) toggleList(false); });
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

// credits popover — links open in the default browser via the backend.
// Plugins appear under the built-in engines: name, description, and the
// author linked to their url. Everything is set with textContent because a
// manifest is somebody else's text, and this window holds the bridge.
function renderPluginCredits() {
  const box = $('plugCredits');
  if (!box) return;
  box.replaceChildren();
  const plugs = ENGINE_ORDER.filter((id) => PLUGINS[id]).map((id) => PLUGINS[id]);
  if (!plugs.length) return;
  const head = document.createElement('b');
  head.textContent = 'Added visualizers';
  box.appendChild(head);
  for (const m of plugs) {
    const para = document.createElement('p');
    const name = document.createElement('b');
    name.textContent = m.name;
    para.appendChild(name);
    if (m.version) para.appendChild(document.createTextNode(' ' + m.version));
    if (m.description) para.appendChild(document.createTextNode(' — ' + m.description));
    if (m.author || m.url) {
      para.appendChild(document.createTextNode(' By '));
      if (m.url) {
        // the click handler below routes data-url through openExternal,
        // which takes nothing but https
        const a = document.createElement('a');
        a.href = '#';
        a.dataset.url = m.url;
        a.textContent = m.author || m.url.replace(/^https:\/\//, '');
        para.appendChild(a);
      } else para.appendChild(document.createTextNode(m.author));
      para.appendChild(document.createTextNode('.'));
    }
    if (m.license) para.appendChild(document.createTextNode(' (' + m.license + ')'));
    box.appendChild(para);
  }
}
$('credits').onclick = () => { renderPluginCredits(); $('creditsBox').style.display = ''; };
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
// A plugin can ask for keys (viz.json "input"). It gets only the ones it named,
// and never these: amp has to keep a way out of fullscreen, a way to reach the
// transport, and its own window shortcuts.
const KEYS_AMP_KEEPS = new Set(['Escape', 'f', 'F']);
function plugWantsKey(e) {
  const man = PLUGINS[engine];
  if (!man || !man.input || !man.input.length || !vizHost) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (KEYS_AMP_KEEPS.has(e.key)) return false;
  return man.input.indexOf(e.key) >= 0;
}
document.addEventListener('keyup', (e) => {
  if (!plugWantsKey(e)) return;
  e.preventDefault();
  vizHost.key('up', e.key);
});
document.addEventListener('keydown', (e) => {
  // a plugin that declared this key gets it, and amp's own binding stands down
  if (plugWantsKey(e)) { e.preventDefault(); vizHost.key('down', e.key, e.repeat); return; }
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
window.addEventListener('resize', () => { size(); sizeMag(); });
poke();

size();
start();







