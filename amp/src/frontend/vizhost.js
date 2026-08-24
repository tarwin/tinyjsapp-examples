// vizhost.js — amp's side of the visualizer PLUGIN sandbox.
//
// A plugin is somebody else's JavaScript. It runs in a worker that has no DOM,
// no `tiny` bridge, no network and its own thread (vizworker.js explains the
// cage); this file is what talks to it. Nothing here trusts the plugin: every
// message is shape-checked, the frame loop is driven from amp's rAF rather than
// the plugin's, and a plugin that stops acking gets terminated.
//
// Why a worker and not an iframe: measured on WKWebView, ANY cross-origin frame
// (sandboxed srcdoc, loopback http, custom scheme — all of them) is rAF-
// throttled to ~20 fps, while a same-origin frame runs at 60 but can reach
// window.parent.tiny. A worker is the only place that is both isolated AND
// 60 fps — and it survives the freeze test an iframe fails.
//
// window.ampVizHost = { create, vizUses, createBeatDetector }

(function () {
  'use strict';

  // The CSP cage. This hidden same-origin iframe exists for one reason: a
  // worker inherits the Content-Security-Policy of the context that MINTS it,
  // and viz.html itself must stay unrestricted (it streams radio through
  // tiny-media:, paints data: art, and so on). So the cage carries the strict
  // policy, mints every plugin worker, and hands amp back a port. Verified:
  // fetch / loopback fetch / importScripts / WebSocket / sendBeacon all fail
  // inside a worker minted this way, and nothing reaches a listening socket.
  const CAGE_CSP = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; "
    + "worker-src blob:; connect-src 'none'";

  const CAGE_HTML = '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="' + CAGE_CSP + '">'
    + '</head><body><script>\n'
    + 'var live = Object.create(null);\n'
    + 'window.addEventListener("message", function (e) {\n'
    + '  var d = e.data; if (!d) return;\n'
    + '  if (d.mint) {\n'
    + '    try {\n'
    + '      var url = URL.createObjectURL(new Blob([d.src], { type: "text/javascript" }));\n'
    + '      var w = new Worker(url);\n'
    + '      URL.revokeObjectURL(url);\n'
    + '      live[d.key] = w;\n'
    + '      w.onerror = function (ev) { parent.postMessage({ workerError: d.key, msg: (ev && ev.message) || "worker error" }, "*"); };\n'
    + '      var ch = new MessageChannel();\n'
    + '      w.postMessage({ port: ch.port2 }, [ch.port2]);\n'
    + '      parent.postMessage({ minted: d.key }, "*", [ch.port1]);\n'
    + '    } catch (err) { parent.postMessage({ mintError: d.key, msg: String(err) }, "*"); }\n'
    + '  } else if (d.kill) {\n'
    + '    var k = live[d.kill]; if (k) { try { k.terminate(); } catch (x) {} delete live[d.kill]; }\n'
    + '  }\n'
    + '});\n'
    + 'parent.postMessage({ cageReady: true }, "*");\n'
    + '<' + '/script></body></html>';

  // ── `// amp:uses three, q5` ──────────────────────────────────────────────
  // Which sketch libraries a plugin wants. It has to be a comment rather than
  // a field on amp.register(), because the libraries must already be in the
  // blob by the time any of the plugin's code runs. Only the head of the file
  // is scanned, and only ids matching the shipped ones survive — the name goes
  // to the backend, which resolves it against its own list, so this can never
  // become a path.
  function vizUses(source) {
    const m = /^[ \t]*\/\/[ \t]*amp:uses[ \t]+([a-z0-9, \t]+)$/mi.exec(String(source || '').slice(0, 4096));
    if (!m) return [];
    const out = [];
    for (const raw of m[1].split(',')) {
      const id = raw.trim().toLowerCase();
      if (/^[a-z][a-z0-9]{0,15}$/.test(id) && !out.includes(id)) out.push(id);
    }
    return out.slice(0, 4);
  }

  const FFT_N = 256, WAVE_N = 1024, SCALAR_OFF = FFT_N + WAVE_N, BUF_BYTES = SCALAR_OFF + 24 * 4;

  // ── beat detection ─────────────────────────────────────────────────────
  // The textbook real-time recipe, because the obvious one (bass minus its
  // average, fixed threshold) misses snares and dies on quiet tracks:
  //   • spectral FLUX — per-bin positive difference between consecutive
  //     spectra (Dixon, "Onset Detection Revisited": the best simple onset
  //     function). The byte spectrum is already dB-mapped, so this is
  //     log-magnitude flux for free.
  //   • adaptive WHITENING (Stowell & Plumbley) — each bin is normalised by
  //     its own decaying peak, so a hi-hat counts as much as a kick and a
  //     quiet passage keeps triggering.
  //   • a Schmitt trigger on an adaptive threshold (mean + k·deviation), so
  //     one drum hit is one beat, not three.
  //   • tempo by AUTOCORRELATING the onset envelope with Ellis's log-Gaussian
  //     weight around 120 BPM (the same scheme librosa ships), which reads
  //     the whole envelope instead of just the peaks we happened to catch.
  // Fed from its OWN analyser with smoothing 0 — the pretty analyser's 0.72
  // smoothing smears the very transients this is looking for.
  // Exposed on ampVizHost so tools/test-beat.js can drive it in plain node.
  function createBeatDetector() {
    const BINS = 256;                  // up to ~12 kHz of a 1024-fft at 48 k
    const BASS_TOP = 20;               // ~47..940 Hz — where punch listens
    // Per-band onsets, the MilkDrop tradition (its presets watch bass, mid and
    // treb beats separately): kick, snare and hat each get the same whitened
    // flux + Schmitt machinery as the full-band beat, on their own slice.
    // Bands follow MilkDrop 3's splits, mapped to ~47 Hz bins.
    const BANDS = {
      kick:  { lo: 1, hi: 5, refractory: 0.15 },      //   47..~250 Hz
      snare: { lo: 6, hi: 85, refractory: 0.15 },     //  ~250..4 k
      hat:   { lo: 86, hi: 255, refractory: 0.06 },   //  4 k+, 16ths allowed
    };
    const band = {};
    for (const k in BANDS) band[k] = { mean: 0.02, dev: 0.02, armed: true, last: -9 };
    // K-weighting, roughly: hearing discounts the lowest octaves and favours
    // the presence region, so a bass-only mix must not read as loud as a full
    // one. A smooth curve, not the BS.1770 filter — this is for pictures.
    const KW = new Float32Array(BINS);
    for (let i = 1; i < BINS; i++) {
      const f = i * 46.9;
      KW[i] = f < 60 ? 0.1 : f < 200 ? 0.1 + 0.9 * (f - 60) / 140 : f < 2000 ? 1 : 1.4;
    }
    let kwSum = 0;
    for (let i = 1; i < BINS; i++) kwSum += KW[i];
    let loud = 0;
    let prev = null;
    const peak = new Float32Array(BINS).fill(40);
    let lastT = 0, lastFlux = 0;
    let fluxMean = 0.02, fluxDev = 0.02, bassMean = 0.004;
    let armed = true, lastBeat = -9, beatIndex = 0;
    let bpm = 0, confidence = 0, nextTempoAt = 0;
    // the entrainment oscillator (Large & Kolen, by way of every PLL): phase
    // advances at the autocorrelated tempo and each onset nudges it into line,
    // so beatPhase says where we are BETWEEN beats — anticipation, where the
    // beat flag is only ever reaction
    let phase = 0, lastAnchor = -9;
    const hist = [];                   // [t, flux] pairs, the onset envelope

    // Ellis: autocorrelate the envelope, weight lags log-Gaussian around
    // 0.5 s (120 BPM), pick the best. Confidence is that peak, normalised.
    function retempo(now) {
      while (hist.length && hist[0][0] < now - 6) hist.shift();
      if (hist.length < 60) { bpm = 0; confidence = 0; return; }
      const HZ = 100, N = 600;
      const g = new Float32Array(N);
      for (const [ht, hv] of hist) {
        const i = Math.round((ht - (now - 6)) * HZ);
        if (i >= 0 && i < N && hv > g[i]) g[i] = hv;
      }
      let mean = 0;
      for (let i = 0; i < N; i++) mean += g[i];
      mean /= N;
      for (let i = 0; i < N; i++) g[i] -= mean;
      let r0 = 0;
      for (let i = 0; i < N; i++) r0 += g[i] * g[i];
      if (r0 < 1e-6) { bpm = 0; confidence = 0; return; }
      let bestLag = 0, bestScore = 0, bestR = 0;
      for (let lag = 30; lag <= 100; lag++) {         // 0.30..1.00 s = 60..200 BPM
        let r = 0;
        for (let i = lag; i < N; i++) r += g[i] * g[i - lag];
        r /= r0;
        const oct = Math.log2(lag / (HZ * 0.5));      // distance from 120 BPM, in octaves
        const scr = r * Math.exp(-0.5 * oct * oct);
        if (scr > bestScore) { bestScore = scr; bestLag = lag; bestR = r; }
      }
      if (bestR > 0.1 && bestLag) {
        bpm = Math.round(60 * HZ / bestLag);
        confidence = Math.max(0, Math.min(1, bestR * 1.5));
      } else { bpm = 0; confidence = Math.max(0, confidence - 0.2); }
    }

    return {
      update(fd, t) {
        let dt = lastT ? t - lastT : 1 / 60;
        if (!(dt > 0.001)) dt = 0.001;
        if (dt > 0.1) dt = 0.1;
        lastT = t;
        const n = Math.min(BINS, fd.length);
        if (!prev) {
          prev = new Uint8Array(n);
          prev.set(fd.subarray(0, n));
          return { beat: false, punch: 0, bpm: 0, confidence: 0, since: 9, beatIndex: 0,
            kick: false, snare: false, hat: false, beatPhase: 0, loudness: 0 };
        }
        // whitened flux: full-band for beats, per-band for kick/snare/hat,
        // raw bass for punch — one pass over the bins for all of it
        const decay = Math.exp(-dt / 8);
        let flux = 0, bassFlux = 0, kickF = 0, snareF = 0, hatF = 0, wsum = 0;
        for (let i = 1; i < n; i++) {
          const v = fd[i];
          peak[i] = Math.max(v, peak[i] * decay, 40);   // the 40 floor stops
          wsum += v * KW[i];                            // silence being amplified
          const d = v - prev[i];
          if (d > 0) {
            const w = d / peak[i];
            flux += w;
            if (i <= BASS_TOP) bassFlux += d;
            if (i <= BANDS.kick.hi) kickF += w;
            else if (i <= BANDS.snare.hi) snareF += w;
            else hatF += w;
          }
          prev[i] = v;
        }
        flux /= 24;                                     // typical kick ≈ 0.3 (measured)
        bassFlux /= BASS_TOP * 255;
        kickF /= 1.4; snareF /= 16; hatF /= 24;         // each band's kick ≈ 0.3
        loud += ((wsum / (kwSum * 255)) - loud) * (1 - Math.exp(-dt / 0.15));

        const a = 1 - Math.exp(-dt / 1.5);
        fluxMean += (flux - fluxMean) * a;
        fluxDev += (Math.abs(flux - fluxMean) - fluxDev) * a;
        bassMean += (bassFlux - bassMean) * a;

        // punch: how far the low end just rose above its own recent norm,
        // log-compressed so an ordinary kick reads ~0.2 and a real accent ~0.5
        // instead of everything pinning at 1
        let punch = 0;
        if (bassFlux > 0.004) {
          const ratio = bassFlux / (bassMean + 0.002);
          punch = Math.max(0, Math.min(1, Math.log2(Math.max(1, ratio - 0.2)) * 0.25));
        }

        hist.push([t, flux]);

        // Schmitt trigger: fire crossing the high line, re-arm below the low
        const hi = fluxMean + 1.5 * fluxDev + 0.01;
        const lo = fluxMean + 0.4 * fluxDev;
        let beat = false;
        if (armed && flux > hi && t - lastBeat > 0.15) {
          beat = true; armed = false;
          lastBeat = t; beatIndex++;
        } else if (!armed && flux < lo) armed = true;
        lastFlux = flux;

        // The same trigger per band, plus an ABSOLUTE floor of 0.35. A narrow
        // band has so few bins that its noise rides well above mean + k·dev;
        // the floor demands a real transient, and whitening keeps it honest at
        // any volume (a quiet kick still moves its bins by ~their own peak).
        const fires = { kick: false, snare: false, hat: false };
        const bandFlux = { kick: kickF, snare: snareF, hat: hatF };
        for (const k in BANDS) {
          const b = band[k], f = bandFlux[k];
          b.mean += (f - b.mean) * a;
          b.dev += (Math.abs(f - b.mean) - b.dev) * a;
          const bHi = b.mean + 1.5 * b.dev + 0.35;
          const bLo = b.mean + 0.4 * b.dev;
          if (b.armed && f > bHi && t - b.last > BANDS[k].refractory) {
            fires[k] = true; b.armed = false; b.last = t;
          } else if (!b.armed && f < bLo) b.armed = true;
        }

        if (t >= nextTempoAt) { nextTempoAt = t + 0.5; retempo(t); }

        // The PLL: only spin when the tempo is worth trusting, and let the LOW
        // onsets steer it. Kicks and snares sit on the grid; hats sit between,
        // and with a symmetric loop whichever the lock lands on first wins —
        // half the time that is the offbeat, permanently (measured 0.465 of a
        // beat out against a kick + offbeat-hat pattern). So kick and snare
        // fires correct the phase, near-grid ones hard and far ones gently,
        // and anything else only gets a say when no low anchor has spoken for
        // two seconds (music with no drums at all).
        let beatPhase = 0;
        if (bpm > 0 && confidence > 0.25) {
          phase += dt * bpm / 60;
          const anchor = fires.kick || fires.snare;
          if (anchor) lastAnchor = t;
          if (anchor || (beat && t - lastAnchor > 2)) {
            const err = phase - Math.round(phase);      // -0.5..0.5 of a beat
            phase -= err * (anchor && Math.abs(err) < 0.25 ? 0.35 : 0.08);
          }
          beatPhase = ((phase % 1) + 1) % 1;
        } else phase = 0;

        return { beat, punch, bpm, confidence, since: t - lastBeat, beatIndex,
          kick: fires.kick, snare: fires.snare, hat: fires.hat, beatPhase, loudness: loud };
      },
    };
  }

  let cageFrame = null, cageReady = null;
  function ensureCage() {
    if (cageReady) return cageReady;
    cageReady = new Promise((res) => {
      const f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:absolute;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none;border:0';
      const onMsg = (e) => {
        if (e.source === f.contentWindow && e.data && e.data.cageReady) {
          window.removeEventListener('message', onMsg); res(f);
        }
      };
      window.addEventListener('message', onMsg);
      document.body.appendChild(f);
      f.srcdoc = CAGE_HTML;
      cageFrame = f;
      setTimeout(() => res(f), 4000);     // never hang the picker on a cage that won't boot
    });
    return cageReady;
  }

  let keySeq = 0;

  function create(opts) {
    const wrap = opts.wrap;
    const getAudio = opts.getAudio;
    const onStatus = opts.onStatus || function () {};
    // amp stops drawing while the viz window is covered — WebKit throttles it
    // anyway and there is nothing to look at. The viz lab passes false: you
    // watch it while typing in another window.
    const pauseWhenHidden = opts.pauseWhenHidden !== false;
    const onOsd = opts.onOsd || function () {};

    let cur = null;   // { key, id, port, canvas, ready, lastAck, backend, presets }
    let active = false;
    let rafId = 0;
    let seq = 0;
    const pool = [];  // returned ArrayBuffers, reused so frames allocate nothing

    // ── analysis: two analysers on amp's hub, shared by every plugin ────────
    // The smoothed one draws well (fft/wave/bands); the raw one feeds the beat
    // detector, which needs the transients that smoothing exists to remove.
    let an = null, onAn = null, fd = null, td = null, fdOn = null;
    const detector = createBeatDetector();
    function ensureAnalyser() {
      if (an || !getAudio) return an;
      try {
        const a = getAudio();
        if (!a || !a.ctx || !a.srcNode) return null;
        an = a.ctx.createAnalyser();
        an.fftSize = 2048;                     // 1024 waveform samples
        an.smoothingTimeConstant = 0.72;
        fd = new Uint8Array(FFT_N);            // first 256 bins is plenty of band
        td = new Uint8Array(WAVE_N);
        a.srcNode.connect(an);
        onAn = a.ctx.createAnalyser();
        onAn.fftSize = 1024;
        onAn.smoothingTimeConstant = 0;
        fdOn = new Uint8Array(onAn.frequencyBinCount);
        a.srcNode.connect(onAn);
      } catch (e) { an = null; onAn = null; }
      return an;
    }

    function analyse(t) {
      let bass = 0, mid = 0, treb = 0, rms = 0, peak = 0;
      if (ensureAnalyser()) {
        an.getByteFrequencyData(fd);
        for (let i = 1; i < 10; i++) bass += fd[i];
        bass /= 9 * 255;
        for (let i = 20; i < 60; i++) mid += fd[i];
        mid /= 40 * 255;
        for (let i = 80; i < 160; i++) treb += fd[i];
        treb /= 80 * 255;
        an.getByteTimeDomainData(td);
        for (let i = 0; i < td.length; i += 2) {
          const v = (td[i] - 128) / 128;
          rms += v * v;
          const av = v < 0 ? -v : v;
          if (av > peak) peak = av;
        }
        rms = Math.sqrt(rms / (td.length / 2));
      }
      let b = { beat: false, punch: 0, bpm: 0, confidence: 0, since: 9, beatIndex: 0,
        kick: false, snare: false, hat: false, beatPhase: 0, loudness: 0 };
      if (onAn) {
        onAn.getByteFrequencyData(fdOn);
        b = detector.update(fdOn, t);
      }
      return { bass, mid, treb, rms, peak, punch: b.punch, beat: b.beat,
        bpm: b.bpm, confidence: b.confidence, since: b.since, beatIndex: b.beatIndex,
        kick: b.kick, snare: b.snare, hat: b.hat, beatPhase: b.beatPhase, loudness: b.loudness };
    }

    let track = { id: '', playing: false, elapsed: 0, duration: 0 };
    let lastSeekBase = 0;
    function packAudio(t) {
      const buf = pool.pop() || new ArrayBuffer(BUF_BYTES);
      const a = analyse(t);
      if (fd) new Uint8Array(buf, 0, FFT_N).set(fd);
      if (td) new Uint8Array(buf, FFT_N, WAVE_N).set(td);
      const s = new Float32Array(buf, SCALAR_OFF, 24);
      s[0] = t; s[1] = 0;
      s[2] = a.bass; s[3] = a.mid; s[4] = a.treb;
      s[5] = a.rms; s[6] = a.peak; s[7] = a.punch;
      s[8] = a.beat ? 1 : 0; s[9] = a.beatIndex; s[10] = a.bpm; s[11] = Math.min(a.since, 9);
      s[12] = track.playing ? 1 : 0; s[13] = track.elapsed || 0; s[14] = track.duration || 0;
      s[15] = a.confidence;
      s[16] = a.kick ? 1 : 0; s[17] = a.snare ? 1 : 0; s[18] = a.hat ? 1 : 0;
      s[19] = a.beatPhase || 0; s[20] = a.loudness || 0;
      return buf;
    }

    // ── the frame loop ─────────────────────────────────────────────────────
    function tick() {
      rafId = requestAnimationFrame(tick);
      if (!cur || !cur.ready || !active || (pauseWhenHidden && document.hidden)) return;
      // one frame in flight at a time: a plugin that renders slower than 60 Hz
      // simply gets fewer frames instead of an unbounded message backlog
      if (cur.inFlight) {
        if (performance.now() - cur.lastAck > 4000) hung();
        return;
      }
      const t = performance.now() * 0.001;
      const buf = packAudio(t);
      cur.inFlight = true;
      try { cur.port.postMessage({ tick: 1, seq: ++seq, buf }, [buf]); }
      catch (e) { cur.inFlight = false; }
    }

    function hung() {
      const id = cur && cur.id;
      onStatus({ id, state: 'hung', message: 'this visualizer stopped responding — it has been shut down' });
      dispose();
    }

    function onPortMessage(entry, e) {
      const d = e.data;
      if (!d || entry !== cur) return;
      if (d.ack != null) {
        entry.inFlight = false;
        entry.lastAck = performance.now();
        if (d.frames) entry.frames = d.frames;
        if (d.buf && pool.length < 4) pool.push(d.buf);
        return;
      }
      if (d.ready) {
        entry.ready = true; entry.backend = d.ready.backend;
        onStatus({ id: entry.id, state: 'ready', backend: d.ready.backend, hdr: d.ready.hdr, name: d.ready.name });
        return;
      }
      if (d.presets) { entry.presets = d.presets; onStatus({ id: entry.id, state: 'presets', presets: d.presets }); return; }
      if (d.osd != null) { onOsd(String(d.osd).slice(0, 120)); return; }
      if (d.log != null) { console.log('[viz ' + entry.id + ']', String(d.log).slice(0, 400)); return; }
      if (d.save !== undefined) { saveState(entry, d.save); return; }
      if (d.loadState != null) {
        tiny.api.call('vizState', { id: entry.id })
          .then((v) => { if (entry === cur) entry.port.postMessage({ stateLoaded: d.loadState, value: v == null ? null : String(v) }); })
          .catch(() => { if (entry === cur) entry.port.postMessage({ stateLoaded: d.loadState, value: null }); });
        return;
      }
      if (d.error) { onStatus({ id: entry.id, state: 'error', message: String(d.error).slice(0, 300) }); return; }
      if (d.fatal) {
        onStatus({ id: entry.id, state: 'fatal', message: String(d.fatal).slice(0, 300) });
        dispose();
      }
    }

    // ── lifecycle ──────────────────────────────────────────────────────────
    async function load(plug) {
      dispose();
      const key = 'v' + (++keySeq);
      const cage = await ensureCage();
      if (!cage || !cage.contentWindow) { onStatus({ id: plug.id, state: 'fatal', message: 'the plugin sandbox failed to start' }); return; }

      const runtime = await window.ampVizRuntime();      // cached, from the backend

      // ── the sketch libraries ───────────────────────────────────────────
      // A plugin that says `// amp:uses three` gets three.js pasted in front
      // of it, from the copy amp ships. Nothing is fetched — the library is
      // one more string concatenated into the same blob the worker is minted
      // from, so the cage's CSP, its lack of network and its lack of a DOM
      // are all exactly as they were. A plugin that asks for nothing carries
      // nothing: this costs the other visualizers not one byte.
      const want = vizUses(plug.source);
      const libs = [];
      for (const id of want) {
        const code = window.ampVizLib ? await window.ampVizLib(id) : null;
        if (code == null) {
          onStatus({ id: plug.id, state: 'fatal',
            message: 'this visualizer asks for "' + id + '", which this build of amp does not ship' });
          return;
        }
        libs.push('/* amp:uses ' + id + ' */\n' + code);
      }

      const src = runtime + '\n' + libs.join('\n') + '\n;(function(){\n' + plug.source + '\n})();\n';

      const port = await new Promise((res) => {
        const to = setTimeout(() => res(null), 5000);
        const onMsg = (e) => {
          if (e.source !== cage.contentWindow || !e.data) return;
          if (e.data.minted === key) { clearTimeout(to); window.removeEventListener('message', onMsg); res(e.ports[0]); }
          if (e.data.mintError === key) { clearTimeout(to); window.removeEventListener('message', onMsg); res(null); }
        };
        window.addEventListener('message', onMsg);
        cage.contentWindow.postMessage({ mint: 1, key, src }, '*');
      });
      if (!port) { onStatus({ id: plug.id, state: 'fatal', message: 'could not start the plugin worker' }); return; }

      const canvas = document.createElement('canvas');
      canvas.className = 'viz-plug';
      wrap.insertBefore(canvas, wrap.firstChild);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(wrap.clientWidth * dpr));
      const h = Math.max(2, Math.round(wrap.clientHeight * dpr));
      canvas.width = w; canvas.height = h;

      const entry = { key, id: plug.id, port, canvas, ready: false, inFlight: false, lastAck: performance.now(), presets: [] };
      cur = entry;
      port.onmessage = (e) => onPortMessage(entry, e);

      // whatever this plugin saved last time, fetched before it starts so
      // create({ state }) can just use it
      let saved = null;
      try { saved = await tiny.api.call('vizState', { id: plug.id }); } catch (e) {}

      const off = canvas.transferControlToOffscreen();
      const hdrNow = typeof opts.hdr === 'function' ? !!opts.hdr() : !!opts.hdr;
      port.postMessage({ init: { canvas: off, width: w, height: h, dpr, hdr: hdrNow,
        state: saved == null ? null : String(saved) } }, [off]);
      onStatus({ id: plug.id, state: 'loading' });
      if (!rafId) rafId = requestAnimationFrame(tick);
    }

    function dispose() {
      if (!cur) return;
      // a plugin switched away from mid-debounce must not lose its last save
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
      if (savePending) {
        const p = savePending; savePending = null;
        tiny.api.call('vizStateSet', { id: p.id, value: p.value }).catch(() => {});
      }
      const key = cur.key, canvas = cur.canvas;
      try { cur.port.close(); } catch (e) {}
      if (cageFrame && cageFrame.contentWindow) { try { cageFrame.contentWindow.postMessage({ kill: key }, '*'); } catch (e) {} }
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      cur = null;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }

    function send(msg, transfer) { if (cur && cur.port) { try { cur.port.postMessage(msg, transfer || []); } catch (e) {} } }

    // A plugin has no storage of its own — no localStorage, no disk, no
    // network. When it wants to remember something (a high score, which preset
    // you left it on) it hands the host a string and the host keeps it, one
    // slot per plugin. Writes are debounced: a plugin calling save() every
    // frame must not become a plugin writing to disk every frame.
    const STATE_CAP = 64 * 1024;
    let saveTimer = 0, savePending = null;
    function saveState(entry, value) {
      if (typeof value !== 'string') return;
      if (value.length > STATE_CAP) {
        onStatus({ id: entry.id, state: 'error',
          message: 'amp.save() ignored — over ' + (STATE_CAP / 1024) + ' KB' });
        return;
      }
      savePending = { id: entry.id, value };
      if (saveTimer) return;
      saveTimer = setTimeout(() => {
        saveTimer = 0;
        const p = savePending; savePending = null;
        if (p) tiny.api.call('vizStateSet', { id: p.id, value: p.value }).catch(() => {});
      }, 400);
    }

    return {
      load,
      dispose,
      get id() { return cur && cur.id; },
      get backend() { return cur && cur.backend; },
      get frames() { return (cur && cur.frames) || 0; },
      get presets() { return (cur && cur.presets) || []; },
      setActive(on) {
        active = !!on;
        if (cur && cur.canvas) cur.canvas.style.display = on ? 'block' : 'none';
        send({ cmd: 'active', value: !!on });
        if (on && !rafId) rafId = requestAnimationFrame(tick);
      },
      resize(w, h) {
        if (!cur) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        send({ resize: { width: Math.max(2, w | 0), height: Math.max(2, h | 0), dpr } });
      },
      command(cmd, value, id) { send({ cmd, value, id }); },
      // one key event. The caller decides which keys a plugin is allowed, so
      // nothing here can take a key amp needs for itself.
      key(type, k, repeat) { send({ cmd: 'input', value: { type, key: k, repeat: !!repeat } }); },
      // amp pushes its whole state about once a second. Rather than hand a
      // plugin that firehose, diff it here and send the three things a plugin
      // actually wants: a new track, a transport change, and a seek.
      setTrack(info) {
        const now = info || {};
        const wasPlaying = track.playing, wasElapsed = track.elapsed;
        const wasId = track.id, wasDur = track.duration;
        track.id = now.id || '';
        track.playing = !!now.playing;
        track.elapsed = now.elapsed || 0;
        track.duration = now.duration || 0;

        if (track.id !== wasId) { send({ cmd: 'track', value: now }); lastSeekBase = performance.now(); }
        if (track.playing !== wasPlaying) {
          // "ended" rather than "pause" when the stop lands at the end of the
          // track — a plugin that celebrates a finished song should not fire
          // every time you hit pause with two seconds to go
          const atEnd = wasDur > 0 && wasElapsed >= wasDur - 1.5;
          send({ cmd: 'transport', value: {
            type: track.playing ? 'play' : (atEnd ? 'ended' : 'pause'),
            elapsed: track.elapsed, duration: track.duration } });
        } else if (track.playing && Math.abs(track.elapsed - wasElapsed) > 1.6
                   && track.id === wasId) {
          // the clock moved further than wall time can explain
          send({ cmd: 'transport', value: { type: 'seek',
            elapsed: track.elapsed, duration: track.duration, from: wasElapsed } });
        }
      },
    };
  }

  window.ampVizHost = { create, vizUses, createBeatDetector };
})();
