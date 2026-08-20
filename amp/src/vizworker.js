// vizworker.js — the RUNTIME that runs inside a visualizer plugin's worker.
//
// This file is never loaded as a script tag. The backend reads it as text
// (vizRuntime) and vizhost.js concatenates it with a plugin's source into one
// Blob, which a hidden CSP-caged iframe turns into a Worker. So by the time a
// plugin's code runs it is inside a DedicatedWorkerGlobalScope that has:
//
//   • no `window`, no `document`, no DOM at all
//   • no `tiny` — the bridge is injected forMainFrameOnly, and workers get
//     nothing anyway, so a plugin cannot reach the backend
//   • no network — the cage's CSP (connect-src 'none') is inherited by the
//     worker, killing fetch / XHR / WebSocket / importScripts / sendBeacon
//   • no eval — 'unsafe-eval' is absent from the cage CSP
//   • its own THREAD, so a plugin that spins forever cannot freeze amp
//
// All it has is an OffscreenCanvas and a MessagePort. Measured on WKWebView
// (macOS 26.5): 60 fps, WebGPU + rgba16float/extended tone mapping available.
// See VIZ-API.md for the plugin-author side of this contract.

(function () {
  'use strict';

  let port = null;
  let plugin = null;        // what amp.register() was given
  let inst = null;          // what plugin.create() returned
  let canvas = null;
  let backend = '2d';
  let hdr = false;
  let W = 2, H = 2, dpr = 1;
  let started = false;
  let loadSeq = 0;
  const loadWaiting = Object.create(null);
  let errCount = 0;
  let frames = 0;
  let lastT = 0;

  // ── the audio snapshot, unpacked from the host's transferred buffer ───────
  // Layout must match packAudio() in vizhost.js:
  //   [0 .. 255]      fft bins       (Uint8)
  //   [256 .. 1279]   waveform       (Uint8)
  //   [1280 .. ]      scalars        (Float32 × 16)
  const FFT_N = 256, WAVE_N = 1024, SCALAR_OFF = FFT_N + WAVE_N;
  const audio = {
    fft: null, wave: null,
    t: 0, dt: 0, bass: 0, mid: 0, treb: 0, level: 0, peak: 0,
    punch: 0, beat: false, beatIndex: 0, bpm: 0, confidence: 0, since: 9,
    kick: false, snare: false, hat: false, beatPhase: 0, loudness: 0,
    playing: false, elapsed: 0, duration: 0,
  };
  function unpack(buf) {
    audio.fft = new Uint8Array(buf, 0, FFT_N);
    audio.wave = new Uint8Array(buf, FFT_N, WAVE_N);
    const s = new Float32Array(buf, SCALAR_OFF, 24);
    audio.t = s[0]; audio.dt = s[1];
    audio.bass = s[2]; audio.mid = s[3]; audio.treb = s[4];
    audio.level = s[5]; audio.peak = s[6]; audio.punch = s[7];
    audio.beat = s[8] > 0.5; audio.beatIndex = s[9] | 0; audio.bpm = s[10];
    audio.since = s[11];
    audio.playing = s[12] > 0.5; audio.elapsed = s[13]; audio.duration = s[14];
    audio.confidence = s[15];
    audio.kick = s[16] > 0.5; audio.snare = s[17] > 0.5; audio.hat = s[18] > 0.5;
    audio.beatPhase = s[19]; audio.loudness = s[20];
  }

  const post = (msg, transfer) => { try { port.postMessage(msg, transfer || []); } catch (e) {} };

  // ── what a plugin sees ───────────────────────────────────────────────────
  const amp = {
    get backend() { return backend; },
    get hdr() { return hdr; },
    get width() { return W; },
    get height() { return H; },
    get dpr() { return dpr; },
    register(def) {
      if (!def || typeof def.create !== 'function')
        return fail('amp.register() needs an object with a create() function');
      plugin = def;
    },
    log() { post({ log: Array.prototype.map.call(arguments, String).join(' ') }); },

    // ── remembering things between sessions ───────────────────────────────
    // A plugin has no storage of its own, so amp keeps one string for it —
    // whatever you like, JSON included. The string you saved last time is
    // handed to create() as `state`, so most plugins never need load().
    // Writes are debounced by the host; 64 KB is the cap.
    save(value) {
      post({ save: typeof value === 'string' ? value : JSON.stringify(value) });
    },
    load() {
      const seq = ++loadSeq;
      return new Promise((resolve) => {
        loadWaiting[seq] = resolve;
        post({ loadState: seq });
        // never leave a plugin awaiting forever if the host went away
        setTimeout(() => { if (loadWaiting[seq]) { delete loadWaiting[seq]; resolve(null); } }, 4000);
      });
    },
    osd(text) { post({ osd: String(text == null ? '' : text) }); },
    presets(list) { post({ presets: (list || []).map(String) }); },
    // a plugin that wants its own pacing can still ask; amp drives frames.
    now() { return audio.t; },
  };
  self.amp = amp;

  function fail(msg) { post({ fatal: String(msg) }); }
  function softErr(where, e) {
    errCount++;
    post({ error: where + ': ' + (e && e.message ? e.message : String(e)), count: errCount });
    // a plugin that throws every frame is not a visualizer any more
    if (errCount >= 12) { post({ fatal: 'stopped after 12 errors in ' + where } ); started = false; }
  }

  self.onerror = (e) => { fail('uncaught: ' + (e && e.message ? e.message : e)); };
  self.onunhandledrejection = (e) => { fail('unhandled rejection: ' + ((e && e.reason && e.reason.message) || e.reason)); };

  // ── protocol ─────────────────────────────────────────────────────────────
  async function onInit(d) {
    canvas = d.canvas; W = d.width | 0; H = d.height | 0; dpr = d.dpr || 1;
    hdr = !!d.hdr;
    const want = (plugin && plugin.backends) || ['2d'];
    const have = [];
    if (self.navigator && navigator.gpu) have.push('webgpu');
    have.push('webgl2', '2d');                       // both exist wherever a worker does
    backend = want.find((b) => have.indexOf(b) >= 0) || null;
    if (!backend) return fail('this visualizer needs ' + want.join('/') + ', which this machine has not got');
    try {
      inst = await plugin.create({ canvas, backend, hdr, width: W, height: H, dpr, audio,
        state: d.state == null ? null : String(d.state) });
    } catch (e) { return fail('create() threw: ' + (e && e.message ? e.message : e)); }
    if (!inst || typeof inst.frame !== 'function') return fail('create() must return an object with a frame() method');
    if (plugin.presets && plugin.presets.length) amp.presets(plugin.presets);
    started = true;
    // a plugin that knows more than the family name ("webgpu · hdr") wins
    post({ ready: { backend: (inst && inst.backend) || backend, name: plugin.name || 'visualizer', hdr } });
  }

  function onTick(d) {
    if (!started || !inst) { post({ ack: d.seq, buf: d.buf }, d.buf ? [d.buf] : []); return; }
    if (d.buf) unpack(d.buf);
    const t = audio.t;
    let dt = lastT ? t - lastT : 0.016;
    if (!(dt > 0) || dt > 0.25) dt = 0.016;          // clock jumps (fullscreen, sleep)
    lastT = t;
    frames++;
    try { inst.frame({ audio, t, dt, width: W, height: H }); }
    catch (e) { softErr('frame()', e); }
    // hand the buffer straight back so the host can refill it — no per-frame
    // allocation on either side
    post({ ack: d.seq, buf: d.buf, frames }, d.buf ? [d.buf] : []);
  }

  function onResize(d) {
    W = d.width | 0; H = d.height | 0; dpr = d.dpr || 1;
    if (canvas) { canvas.width = W; canvas.height = H; }
    if (inst && inst.resize) { try { inst.resize(W, H); } catch (e) { softErr('resize()', e); } }
  }

  function onCommand(d) {
    if (!inst) return;
    try {
      if (d.cmd === 'random' && inst.randomize) { const n = inst.randomize(); if (n) amp.osd(n); }
      else if (d.cmd === 'next' && inst.preset) inst.preset(1);
      else if (d.cmd === 'prev' && inst.preset) inst.preset(-1);
      else if (d.cmd === 'preset' && inst.preset) inst.preset(d.value);
      else if (d.cmd === 'control' && inst.control) inst.control(d.id, d.value);
      else if (d.cmd === 'track' && inst.track) inst.track(d.value);
      else if (d.cmd === 'transport' && inst.transport) inst.transport(d.value);
      else if (d.cmd === 'input' && inst.input) inst.input(d.value);
      else if (d.cmd === 'active' && inst.active) inst.active(!!d.value);
    } catch (e) { softErr(d.cmd + '()', e); }
  }

  function onPort(e) {
    const d = e.data;
    if (!d) return;
    if (d.init) onInit(d.init);
    else if (d.tick) onTick(d);
    else if (d.resize) onResize(d.resize);
    else if (d.cmd) onCommand(d);
    else if (d.stateLoaded != null) {
      const fn = loadWaiting[d.stateLoaded];
      if (fn) { delete loadWaiting[d.stateLoaded]; fn(d.value == null ? null : String(d.value)); }
    }
    else if (d.ping) post({ pong: d.ping });
  }

  self.addEventListener('message', (e) => {
    if (e.data && e.data.port) { port = e.data.port; port.onmessage = onPort; post({ hello: true }); }
  });
})();
