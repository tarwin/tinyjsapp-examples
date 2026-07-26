// permutations.js — amp's homage to John Whitney's "Permutations" (1968), the
// film he made on a war-surplus M5 analogue computer: a few hundred points, each
// advancing by k × Δθ, sweeping every rational until the field locks into
// symmetry — printed one black-and-white figure at a time through a single
// colour filter, so a frame holds several DISTINCT figures in DISTINCT colours.
//
// The simulation is Whitney's mechanic, driven by the music: dots divided into
// independent "voices", each with its own symmetry order, radial band, spin and
// one tint, gating in and out with its part of the spectrum. The renderer is the
// PRINT — halation, base fog, gate weave, emulsion grain — and it runs on
// WebGPU (rgba16float + extended tone mapping, so a blown-out dot core is a real
// HDR highlight rather than a clipped white) with a WebGL2 fallback that draws
// the same passes in SDR. No dependencies.
//
// Self-contained by design: the control desk and its little "H · controls" tag
// are built and styled from here, so both hosts (the visualizer window and the
// big screen) need nothing but a canvas and a script tag.

(function () {
  const TAU = Math.PI * 2;
  const N = 281;                       // Whitney's maximum, not his normal
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const timeout = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

  /* Tints sampled off the film, not RGB primaries: scarlet, phosphor green,
     magenta, cold cyan-white, amber. */
  const TINTS = [
    [1.000, 0.180, 0.149],   // 0 scarlet
    [0.455, 1.000, 0.580],   // 1 phosphor green
    [1.000, 0.259, 0.659],   // 2 magenta
    [0.620, 0.808, 1.000],   // 3 cold cyan-white
    [1.000, 0.745, 0.337],   // 4 amber
  ];
  const TINT_CSS = TINTS.map((c) => 'rgb(' + c.map((v) => Math.round(v * 255)).join(',') + ')');

  /* A pack is one loading of the printer's filter turret: which tint each voice
     gets, and in what order. Ordered cool → warm, because the auto target picks
     by the music's own warmth. The lead colour differs in every pack, so a
     single voice is scarlet in only one of the five. */
  const PACKS = [
    { name: 'cold', order: [3, 2, 1, 0] },
    { name: 'aniline', order: [2, 3, 0, 1] },
    { name: 'primary', order: [0, 1, 2, 3] },
    { name: 'phosphor', order: [1, 0, 3, 2] },
    { name: 'warm', order: [4, 0, 1, 2] },
  ];

  /* dq offsets the symmetry order, so voices land on different petal counts;
     rIn/rOut give each one its own annulus, which is what produces the
     nested-figure look. band ties each voice to a part of the spectrum —
     counterpoint, one line per register. */
  const VOICE_DEF = [
    { band: 'low', dq: 0, spin: 1.00, rIn: 0.56, rOut: 1.00 },
    { band: 'mid', dq: 1, spin: -0.64, rIn: 0.22, rOut: 0.62 },
    { band: 'high', dq: 2, spin: 1.78, rIn: 0.05, rOut: 0.28 },
    { band: 'mid', dq: -1, spin: 0.42, rIn: 0.78, rOut: 1.08 },
  ];

  const HARMONICS = [2, 3, 4, 5, 6, 8, 10];
  const RATIOS = [[1, 1], [1, 2], [2, 3], [3, 2], [3, 4], [4, 3], [3, 5], [5, 4], [5, 6], [2, 5]];
  const NAMES = ['harmonic consonance', 'chaotic swarm', 'quadrant polyphony', 'lissajous · stereo'];
  const SHORT = ['ROSE', 'SWARM', 'QUAD', 'LISSAJOUS · STEREO'];
  const MIRRORS = [1, 1, 4, 1];

  const DOT_CAP = 6000;                // 281 dots × 4 mirrors, with headroom
  const LINE_CAP = 9000;
  const FFT = 1024;
  const FILM = [8 / 255, 3 / 255, 10 / 255];   // never pure black — it's a print

  /* ═══════════════════════════════════════════════════════════════════════
     SIMULATION — the M5, in software. Renderer-agnostic: it fills two
     instance arrays (dots, lines) in device pixels and hands over the print
     parameters. Lifted from the standalone engine; see the comments there for
     why each auto target is shaped the way it is.
     ═══════════════════════════════════════════════════════════════════════ */

  function createSim(getAudio) {
    let W = 2, H = 2, cx = 1, cy = 1, maxR = 1, PX = 1;

    const ui = {
      pack: 3, voices: 3, dots: 0.55, chord: 1, weave: 2.4, arc: 0.55, sep: 0.62,
      gate: 0.6, grain: 0.22, rate: 0.60, sweep: 0.40, spin: 0.40,
      hal: 0.34, rad: 2.2, fog: 0.3, trail: 0.17,
    };
    const A = { low: 0, mid: 0, high: 0, overall: 0, balance: 0, corr: 1, width: 0, spectralPan: 0, beat: false };
    const S = { low: 0, mid: 0, high: 0, overall: 0, balance: 0, corr: 1, width: 0, spectralPan: 0, pulse: 0 };
    const peak = { low: 1, mid: 1, high: 1 };
    const P = {
      spin: 0.34, harmQ: 5, consonance: 0.6,
      lissA: 1, lissB: 1, lissDelta: Math.PI / 2, lissSpin: 0.34,
      ampX: 0, ampY: 0, tilt: -Math.PI / 4, weaveM: 3.5,
    };

    let fluxAvg = 0, demoT = 0, onsetEnv = 0, density = 0, driftT = 0, perfCap = 4;
    let lastRatioSwap = 0, lastHarmSwap = 0, frameDt = 0.016;
    let cur = 0, prev = 0, blend = 1, dwell = 0, forced = -1, packNudge = false;
    let t = 0, silentFor = 0;

    const packOrder = () => PACKS[clamp(Math.round(ui.pack), 1, PACKS.length) - 1].order;
    const packName = () => PACKS[clamp(Math.round(ui.pack), 1, PACKS.length) - 1].name;
    const drift = (period, phase) => Math.sin(driftT * TAU / period + phase);

    // ── audio: one main analyser plus a split pair, so the stereo field
    //    (balance, correlation, width, spectral pan) is real and not inferred.
    //    A mono source up-mixes through the splitter to two identical channels,
    //    which reads as corr 1 / width 0 — exactly right.
    let anaMain = null, anaL = null, anaR = null;
    let fMain = null, fL = null, fR = null, wL = null, wR = null, prevSpec = null, sr = 48000;
    function ensureAudio() {
      if (anaMain || !getAudio) return;
      try {
        const { ctx, srcNode } = getAudio();
        const mk = () => {
          const a = ctx.createAnalyser();
          a.fftSize = FFT; a.smoothingTimeConstant = 0.72;
          a.minDecibels = -92; a.maxDecibels = -12;
          return a;
        };
        anaMain = mk(); anaL = mk(); anaR = mk();
        const split = ctx.createChannelSplitter(2);
        srcNode.connect(anaMain);
        srcNode.connect(split);
        split.connect(anaL, 0);
        split.connect(anaR, 1);
        const bins = anaMain.frequencyBinCount;
        fMain = new Uint8Array(bins); fL = new Uint8Array(bins); fR = new Uint8Array(bins);
        wL = new Uint8Array(FFT); wR = new Uint8Array(FFT);
        prevSpec = new Float32Array(bins);
        sr = ctx.sampleRate;
      } catch (e) { anaMain = null; }
    }

    function bandAvg(data, lo, hi, binHz) {
      const a = Math.max(1, Math.floor(lo / binHz));
      const b = Math.min(data.length - 1, Math.ceil(hi / binHz));
      let s = 0;
      for (let i = a; i <= b; i++) s += data[i];
      return s / Math.max(1, b - a + 1) / 255;
    }
    function centroid(data, binHz) {
      let num = 0, den = 0;
      for (let i = 1; i < data.length; i++) { const m = data[i]; num += i * binHz * m; den += m; }
      return den > 4 ? num / den : 0;
    }

    function analyse() {
      anaMain.getByteFrequencyData(fMain);
      anaL.getByteFrequencyData(fL);
      anaR.getByteFrequencyData(fR);
      anaL.getByteTimeDomainData(wL);
      anaR.getByteTimeDomainData(wR);

      const binHz = (sr / 2) / anaMain.frequencyBinCount;
      const rawLow = bandAvg(fMain, 20, 180, binHz);
      const rawMid = bandAvg(fMain, 180, 2200, binHz);
      const rawHigh = bandAvg(fMain, 2200, 9000, binHz);
      if (rawLow + rawMid + rawHigh < 1e-4) return false;    // nothing playing

      peak.low = Math.max(peak.low * 0.9992, rawLow, 0.05);
      peak.mid = Math.max(peak.mid * 0.9992, rawMid, 0.05);
      peak.high = Math.max(peak.high * 0.9992, rawHigh, 0.03);

      A.low = clamp(rawLow / peak.low, 0, 1);
      A.mid = clamp(rawMid / peak.mid, 0, 1);
      A.high = clamp(rawHigh / peak.high, 0, 1);
      A.overall = (A.low + A.mid + A.high) / 3;

      let flux = 0;
      for (let i = 1; i < fMain.length; i++) {
        const v = fMain[i] / 255, d = v - prevSpec[i];
        if (d > 0) flux += d;
        prevSpec[i] = v;
      }
      flux /= fMain.length;
      A.beat = flux > fluxAvg * 1.55 + 0.0015;
      fluxAvg = lerp(fluxAvg, flux, 0.06);

      let sl = 0, sr2 = 0, slr = 0;
      for (let i = 0; i < FFT; i++) {
        const l = (wL[i] - 128) / 128, r = (wR[i] - 128) / 128;
        sl += l * l; sr2 += r * r; slr += l * r;
      }
      const rmsL = Math.sqrt(sl / FFT), rmsR = Math.sqrt(sr2 / FFT);
      A.balance = (rmsR - rmsL) / (rmsR + rmsL + 1e-6);
      A.corr = clamp(slr / (Math.sqrt(sl * sr2) + 1e-9), -1, 1);
      A.width = clamp(1 - A.corr, 0, 2) / 2;
      const cL = centroid(fL, binHz), cR = centroid(fR, binHz);
      A.spectralPan = (cR - cL) / (cR + cL + 1e-6);
      return true;
    }

    // Silence is a legitimate state here — paused amp, a gap between tracks —
    // and a dead screen would read as a broken visualizer. So the figure keeps
    // running on a slow synthetic score until real audio comes back.
    function demo(dt) {
      demoT += dt;
      A.low = 0.42 + 0.34 * Math.sin(demoT * 0.51);
      A.mid = 0.46 + 0.30 * Math.sin(demoT * 0.83 + 1.1);
      A.high = 0.34 + 0.28 * Math.sin(demoT * 1.27 + 2.4);
      A.overall = (A.low + A.mid + A.high) / 3;
      A.balance = 0.55 * Math.sin(demoT * 0.29);
      A.corr = Math.cos(demoT * 0.21);
      A.width = clamp(1 - A.corr, 0, 2) / 2;
      A.spectralPan = 0.5 * Math.sin(demoT * 0.17);
      A.beat = Math.sin(demoT * 3.1) > 0.985;
    }

    function updateParams(dt) {
      const k = 1 - Math.pow(0.001, dt);
      S.low = lerp(S.low, A.low, k * 3);
      S.mid = lerp(S.mid, A.mid, k * 3);
      S.high = lerp(S.high, A.high, k * 4);
      S.overall = lerp(S.overall, A.overall, k * 3);
      S.balance = lerp(S.balance, A.balance, k * 2);
      S.corr = lerp(S.corr, A.corr, k * 2);
      S.width = lerp(S.width, A.width, k * 2);
      S.spectralPan = lerp(S.spectralPan, A.spectralPan, k * 1.5);
      S.pulse = Math.max(S.pulse - dt * 3.2, 0);
      if (A.beat) S.pulse = 1;

      // Three independent clocks: `rate` is master time, `sweep` is how fast Δθ
      // grows (how quickly the figure evolves through its symmetries), `spin` is
      // bulk rotation. Welding them together means slowing the rotation freezes
      // the evolution too.
      P.spin = (0.22 + S.mid * 0.34) * ui.sweep;
      const target = clamp(1 - S.high * 1.15, 0, 1) * 0.75 + S.pulse * 0.55;
      P.consonance = lerp(P.consonance, clamp(target, 0, 1), k * 2.5);

      if (A.beat && t - lastHarmSwap > 1.1) {
        lastHarmSwap = t;
        P.harmQ = HARMONICS[Math.min(HARMONICS.length - 1,
          Math.floor(S.low * HARMONICS.length * 0.999))];
      }
      if (A.beat && t - lastRatioSwap > 0.75) {
        lastRatioSwap = t;
        const idx = Math.floor(clamp(Math.abs(S.spectralPan) * 5.5, 0, 0.999) * RATIOS.length);
        P.lissA = RATIOS[idx][0]; P.lissB = RATIOS[idx][1];
      }
      P.lissDelta = lerp(P.lissDelta, Math.acos(clamp(S.corr, -1, 1)), k * 2);

      const lvl = 0.30 + 0.70 * S.overall;
      P.ampX = lerp(P.ampX, maxR * lvl * (1 + S.balance * 0.45), k * 2.5);
      P.ampY = lerp(P.ampY, maxR * lvl * (1 - S.balance * 0.45), k * 2.5);
      P.tilt = lerp(P.tilt, -Math.PI / 4 + S.balance * 0.75, k * 2);
      P.lissSpin = (0.16 + S.mid * 0.5) * ui.spin;

      // The slider sets the free chord multiplier; consonance pulls it onto a
      // whole number, which is what closes the envelope into a cardioid (2) or
      // nephroid (3). Fractional values leave it precessing.
      P.weaveM = lerp(P.weaveM, lerp(ui.weave, Math.round(ui.weave), P.consonance), k * 3);
    }

    function targetState() {
      if (forced >= 0) return forced;
      if (cur === 1 && dwell > 9) return 0;          // the swarm is a gesture, not a home
      if (S.width > 0.40) return 3;
      // Treble has to be genuinely dominant, not merely present — one hi-hat
      // shouldn't tip the whole piece into the swarm.
      if (S.high > 0.72 && S.high > S.mid * 1.15 && S.high > S.low * 1.15) return 1;
      if (S.low > 0.68) return 2;
      return 0;
    }
    let onStateName = null;
    function stateMachine(dt) {
      dwell += dt;
      const want = targetState();
      if (want !== cur && dwell > (forced >= 0 ? 0 : 2.2) && blend >= 1) {
        prev = cur; cur = want; blend = 0; dwell = 0; packNudge = true;
        if (onStateName) onStateName(NAMES[cur]);
      }
      if (blend < 1) blend = Math.min(1, blend + dt / 0.75);
    }

    /* Position of dot k (of gN) belonging to voice V. k may be fractional and
       may run past gN for a chord partner — both endpoints of a line have to
       sit on the same figure or the web sprays outside it. */
    const pa = { x: 0, y: 0 }, pb = { x: 0, y: 0 }, sa = { x: 0, y: 0 }, sb = { x: 0, y: 0 };

    function pointPos(state, k, gN, V, vi, tt, out) {
      let f = gN > 1 ? k / (gN - 1) : 0;
      if (V.asChord) f -= Math.floor(f);
      const sep = ui.sep;
      const rOut = lerp(1.00, V.rOut, sep);
      const rIn = V.asChord ? rOut * 0.94 : lerp(0.06, V.rIn, sep);
      const vdir = lerp(1, V.spin, sep);
      let x, y;

      if (state === 0 || state === 2) {
        // Whitney's mechanic: dot k advances by k × Δθ. As Δθ grows the field
        // sweeps every rational and locks into symmetry at 2π·p/q; blending
        // toward the snapped value on `consonance` makes figures coalesce and
        // dissolve rather than sit still.
        const q = Math.max(2, P.harmQ + Math.round(V.dq * sep * 2));
        const unit = TAU / q;
        let d = tt * P.spin * vdir;
        d = lerp(d, Math.round(d / unit) * unit, P.consonance * (state === 2 ? 0.85 : 1));
        // Chord voices sit evenly spaced on the bare ring instead of riding the
        // k×Δθ mechanic — that even spacing is what makes k → k×m produce the
        // cardioid and nephroid envelopes. All their rotation is applied at
        // emit time, so the arc can sweep while the envelope stays rigid.
        const th = V.asChord ? TAU * k / gN : k * d + tt * 0.20 * ui.spin;
        const shrink = state === 2 ? 0.62 : 1;
        const rr = maxR * shrink * (rIn + (rOut - rIn) * f) * (0.76 + 0.24 * V.level);
        x = Math.cos(th) * rr; y = Math.sin(th) * rr;

      } else if (state === 1) {
        // Not random — each dot keeps its own trajectory and falls out of phase
        // with its neighbours.
        const d = tt * P.spin * vdir * (1 + S.high * 0.42);
        const th = k * d + Math.sin(tt * 0.9 + k * 0.137 + vi * 2.1) * (0.35 + S.high * 2.4);
        const rr = maxR * (rIn + (rOut - rIn) * f)
          + Math.sin(tt * 1.7 + k * 0.41 + vi * 1.3) * maxR * 0.18 * S.high;
        x = Math.cos(th) * rr; y = Math.sin(th) * rr;

      } else {
        // Each voice takes a different reading of the same stereo field: the
        // a:b figure, its transpose, and the plain 1:1 vectorscope ellipse.
        const R3 = [[P.lissA, P.lissB], [P.lissB, P.lissA], [1, 1], [P.lissA, P.lissA + 1]];
        const pair = R3[vi & 3];
        const det = (1 - Math.abs(S.corr)) * 0.055;       // coherence closes the figure
        const a = pair[0] + det, b = pair[1] - det;
        const th = f * TAU + tt * P.lissSpin * lerp(1, V.spin, sep * 0.6);
        const sc = lerp(1, V.rOut, sep);
        const dl = P.lissDelta + vi * sep * 0.5;
        const lx = Math.sin(a * th + dl) * P.ampX * sc;
        const ly = Math.sin(b * th) * P.ampY * sc;
        const c = Math.cos(P.tilt), s = Math.sin(P.tilt);
        x = lx * c - ly * s; y = lx * s + ly * c;
      }
      out.x = x; out.y = y;
    }

    function posAt(kk, gN, V, vi, tt, out) {
      if (blend < 1) {
        pointPos(prev, kk, gN, V, vi, tt, sa);
        pointPos(cur, kk, gN, V, vi, tt, sb);
        const e = blend * blend * (3 - 2 * blend);
        out.x = lerp(sa.x, sb.x, e); out.y = lerp(sa.y, sb.y, e);
      } else {
        pointPos(cur, kk, gN, V, vi, tt, out);
      }
    }

    // ── instance buffers the renderer uploads verbatim ──────────────────────
    const dots = new Float32Array(DOT_CAP * 7);     // x, y, size, r, g, b, a
    const lines = new Float32Array(LINE_CAP * 9);   // x0, y0, x1, y1, r, g, b, a, w
    let dotN = 0, lineN = 0;

    function pushDot(x, y, size, c, a) {
      if (dotN >= DOT_CAP) return;
      const o = dotN++ * 7;
      dots[o] = x; dots[o + 1] = y; dots[o + 2] = size;
      dots[o + 3] = c[0]; dots[o + 4] = c[1]; dots[o + 5] = c[2]; dots[o + 6] = a;
    }
    function pushLine(x0, y0, x1, y1, c, a, w) {
      if (lineN >= LINE_CAP) return;
      const o = lineN++ * 9;
      lines[o] = x0; lines[o + 1] = y0; lines[o + 2] = x1; lines[o + 3] = y1;
      lines[o + 4] = c[0]; lines[o + 5] = c[1]; lines[o + 6] = c[2];
      lines[o + 7] = a; lines[o + 8] = w;
    }

    function emitVoice(V, vi, count, tt) {
      const share = Math.floor(N / count) + (vi === count - 1 ? N % count : 0);
      // Mirrored states already multiply what's on screen fourfold, so they get
      // a smaller budget per voice or the disc packs solid.
      const gN = Math.max(3, Math.round(share * ui.dots * (MIRRORS[cur] > 1 ? 0.55 : 1)));
      const tint = TINTS[packOrder()[vi]];
      const mA = MIRRORS[prev], mB = MIRRORS[cur], mMax = Math.max(mA, mB);
      // Small dots: the originals read as countable points, so size stays low
      // and only breathes a little on transients.
      const size = (1.5 + S.overall * 1.9 + S.pulse * 1.1) * 3.8 * PX;
      const gain = (0.62 + V.level * 0.38) * V.gate;

      for (let q = 0; q < mMax; q++) {
        let a = 1;
        if (q >= mA) a = blend; else if (q >= mB) a = 1 - blend;
        if (a <= 0.002) continue;
        const rot = q * TAU / mMax;

        if (V.asChord) {
          // Only the first `arc` fraction of the ring gets chords, so the web
          // can be a partial fan rather than always a closed rosette. The whole
          // arc rotates as one, which keeps the envelope rigid while it travels.
          const nL = Math.max(2, Math.round(gN * clamp(ui.arc, 0.04, 1)));
          const base = vi * gN * 0.17;                 // stagger multiple chord voices
          const ang = rot + tt * 0.26 * ui.spin + vi * 0.7;
          const ca = Math.cos(ang), sn = Math.sin(ang);
          const alpha = (0.26 + V.level * 0.30) * gain * a;
          const lw = (0.9 + S.overall * 0.5) * PX;
          for (let j = 0; j < nL; j++) {
            const kk = base + j;
            posAt(kk, gN, V, vi, tt, pa);
            posAt(kk * P.weaveM, gN, V, vi, tt, pb);
            pushLine(cx + pa.x * ca - pa.y * sn, cy + pa.x * sn + pa.y * ca,
              cx + pb.x * ca - pb.y * sn, cy + pb.x * sn + pb.y * ca,
              tint, alpha, lw);
          }
        } else {
          const ca = Math.cos(rot), sn = Math.sin(rot);
          const alpha = gain * a;
          for (let k = 0; k < gN; k++) {
            posAt(k, gN, V, vi, tt, pa);
            pushDot(cx + pa.x * ca - pa.y * sn, cy + pa.x * sn + pa.y * ca, size, tint, alpha);
          }
        }
      }
    }

    function emit(tt) {
      dotN = 0; lineN = 0;
      const count = clamp(Math.round(ui.voices), 1, 4);
      const weaving = Math.min(Math.round(ui.chord), Math.max(0, count - 1));
      for (let vi = 0; vi < count; vi++) {
        const V = VOICE_DEF[vi];
        V.level = V.band === 'low' ? S.low : V.band === 'high' ? S.high : S.mid;

        /* Each voice has its own gate. In the film figures arrive and leave — a
           red ring alone for several seconds, then a green figure joins it.
           Drawing every voice continuously is most of why a frame reads as
           undifferentiated. Voice 0 is the anchor and opens earliest; later
           voices need more of their band, on a threshold that drifts, so they
           come and go independently. */
        const thresh = 0.06 + vi * 0.15 + drift(37 + vi * 19, vi * 1.7) * 0.13;
        const want = clamp((V.level - thresh) * 3.2, 0, 1);
        V.gate = V.gate === undefined ? want
          : lerp(V.gate, want, 1 - Math.pow(0.001, frameDt * 1.1));
        if (V.gate < 0.02) continue;

        V.asChord = vi >= count - weaving;            // the outermost voice stays dots
        // A hair of temporal offset between voices — successive printer passes
        // were never perfectly registered in time.
        emitVoice(V, vi, count, tt - vi * ui.sep * 0.018);
      }
    }

    /* ── Controls ─────────────────────────────────────────────────────────
       Every parameter runs on its own unless you take it. The auto targets are
       deliberately not pure audio-followers — each is an audio term plus a very
       slow sine on an unrelated period (32s, 43s, 53s, 59s, 67s…), so the print
       keeps wandering during a steady passage instead of sitting still. The
       periods share no common multiple worth waiting for.                    */

    const dec2 = (v) => v.toFixed(2).replace(/^0/, '');
    const CONTROLS = [
      { k: 'pack', g: 'A', label: 'Filters', min: 1, max: 5, step: 1, fmt: String, int: true,
        // Warm material (low-heavy) pulls toward the amber/scarlet packs, bright
        // material toward cyan/magenta. Long hold: this should read as a reel
        // change, not a strobe.
        auto: { min: 1, max: 5, hold: 18, f: () => {
          const warmth = clamp((S.low - S.high) * 1.15 + 0.5, 0, 1);
          const x = clamp(warmth + drift(137, 1.3) * 0.24, 0, 0.999);
          return 1 + Math.floor(x * PACKS.length);   // equal-width bins; round()
        } } },                                        // would halve the two end packs
      { k: 'voices', g: 'A', label: 'Voices', min: 1, max: 4, step: 1, fmt: String, int: true,
        auto: { min: 1, max: 4, f: () => {
          if (cur === 2) return 2;                    // quadrant mirroring is busy enough
          if (cur === 3) return 3;
          // Tied to the dot budget rather than to band thresholds: the bands are
          // auto-gained, so on most material all three cleared any fixed level
          // and this sat pinned at 3–4.
          return clamp(Math.round(0.7 + ui.dots * 2.4), 1, 3);
        } } },
      { k: 'dots', g: 'A', label: 'Dots', min: 0.08, max: 1, step: 0.01, fmt: dec2,
        // The single biggest lever on how busy the frame is. The drift term
        // dominates deliberately and runs long, so the piece gets real sparse
        // stretches rather than hovering near full.
        auto: { min: 0.12, max: 0.95, rate: 0.35,
          f: () => 0.40 + drift(101, 0.5) * 0.34 + S.overall * 0.17 } },
      { k: 'chord', g: 'A', label: 'Chords', min: 0, max: 3, step: 1, fmt: String, int: true,
        // Line figures belong to the calm, geometric passages — they appear as
        // the ratios lock and the transient density drops, never in the swarm.
        auto: { min: 0, max: 3, hold: 5, f: () => (cur === 1 ? 0
          : clamp(Math.round(P.consonance * 2.4 - density * 1.4), 0, Math.max(0, ui.voices - 1))) } },
      { k: 'weave', g: 'A', label: 'Weave', min: 1, max: 7, step: 0.05, fmt: (v) => v.toFixed(2),
        // Near 1 each point joins its neighbour and the web collapses to an
        // outline; 2 is the cardioid, 3 the nephroid.
        auto: { min: 1.05, max: 6.5, rate: 0.5, f: () => 2.3 + drift(67, 0.7) * 1.5 + S.mid * 0.55 } },
      { k: 'arc', g: 'A', label: 'Arc', min: 0.04, max: 1, step: 0.01, fmt: dec2,
        auto: { min: 0.22, max: 1.0, rate: 0.4, f: () => 0.58 + drift(83, 2.6) * 0.36 + density * 0.10 } },
      { k: 'sep', g: 'A', label: 'Separation', min: 0, max: 1, step: 0.01, fmt: dec2,
        auto: { min: 0.38, max: 0.95, rate: 0.7, f: () => 0.54 + S.width * 0.26 + S.high * 0.15 + drift(77, 2.2) * 0.11 } },
      { k: 'hal', g: 'B', label: 'Halation', min: 0, max: 1, step: 0.01, fmt: dec2,
        auto: { min: 0.14, max: 0.58, rate: 1.5, f: () => 0.20 + S.overall * 0.26 + S.pulse * 0.11 + drift(32, 0) * 0.06 } },
      { k: 'rad', g: 'B', label: 'Radius', min: 0.4, max: 6, step: 0.1, fmt: (v) => v.toFixed(1),
        auto: { min: 1.0, max: 3.8, rate: 0.8, f: () => 2.0 + S.low * 0.85 + drift(59, 1.7) * 0.65 } },
      { k: 'fog', g: 'B', label: 'Base fog', min: 0, max: 1, step: 0.01, fmt: dec2,
        auto: { min: 0.06, max: 0.40, rate: 1.0, f: () => 0.15 + S.low * 0.18 + drift(43, 3.1) * 0.09 } },
      { k: 'gate', g: 'B', label: 'Gate weave', min: 0, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2),
        auto: { min: 0.25, max: 1.1, rate: 0.25, f: () => 0.6 + drift(71, 0.4) * 0.35 } },
      { k: 'grain', g: 'B', label: 'Grain', min: 0, max: 1, step: 0.01, fmt: dec2,
        auto: { min: 0.06, max: 0.28, rate: 0.3, f: () => 0.15 + drift(89, 3.4) * 0.10 } },
      { k: 'trail', g: 'B', label: 'Persistence', min: 0.03, max: 0.45, step: 0.005, fmt: dec2,
        // Busy material gets a faster wash so dots stay countable; sparse
        // material is allowed to smear.
        auto: { min: 0.11, max: 0.36, rate: 1.0, f: () => 0.17 + density * 0.15 + drift(91, 0.9) * 0.03 } },
      { k: 'rate', g: 'C', label: 'Rate', min: 0.05, max: 2, step: 0.01, fmt: (v) => v.toFixed(2),
        auto: { min: 0.26, max: 0.95, rate: 0.45, f: () => 0.50 + S.mid * 0.22 + drift(111, 4.4) * 0.13 } },
      { k: 'sweep', g: 'C', label: 'Sweep', min: 0.05, max: 2, step: 0.01, fmt: (v) => v.toFixed(2),
        auto: { min: 0.20, max: 0.85, rate: 0.4, f: () => 0.42 + S.overall * 0.18 + drift(53, 2.9) * 0.17 } },
      { k: 'spin', g: 'C', label: 'Spin', min: 0, max: 1.5, step: 0.01, fmt: (v) => v.toFixed(2),
        // Allowed all the way to zero — a still field that only morphs is a
        // legitimate look.
        auto: { min: 0.03, max: 0.70, rate: 0.35, f: () => 0.30 + S.low * 0.18 + drift(97, 1.1) * 0.24 } },
    ];
    CONTROLS.forEach((c) => { c.locked = false; c.hold = 0; });

    let syncTick = 0, onPush = null;
    function autoDrift(dt) {
      driftT += dt;
      // Onset density: a decaying count of transients — roughly "how busy is it".
      onsetEnv *= Math.pow(0.35, dt);
      if (A.beat) onsetEnv = Math.min(onsetEnv + 1, 8);
      density = clamp(onsetEnv / 5, 0, 1);

      const push = (++syncTick % 6) === 0;
      for (const c of CONTROLS) {
        if (c.locked || !c.auto) continue;
        const a = c.auto;
        if (c.int) {
          // Integers can't be eased, so they change only on a transient and only
          // after holding a while — otherwise the voice count flickers.
          c.hold += dt;
          if (c.k === 'pack' && packNudge) c.hold += 4;
          const hi = c.k === 'voices' ? Math.min(a.max, perfCap) : a.max;
          const want = clamp(Math.round(a.f()), a.min, hi);
          if (want !== ui[c.k] && c.hold > (a.hold || 3.5) && A.beat) {
            c.hold = 0; ui[c.k] = want;
            if (onPush) onPush(c);
          }
          continue;
        }
        const tgt = clamp(a.f(), a.min, a.max);
        ui[c.k] = lerp(ui[c.k], tgt, 1 - Math.pow(0.001, dt * a.rate));
        if (push && onPush) onPush(c);
      }
      packNudge = false;
    }

    // ── frame-rate governor: the dot budget is the thing worth shedding ──
    let fpsAcc = 0, fpsN = 0, slowFor = 0;
    function governor(dt) {
      fpsAcc += 1 / dt; fpsN++;
      if (fpsN < 30) return;
      const fps = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
      if (fps < 40) { slowFor++; if (slowFor > 3) perfCap = 2; }
      else if (fps > 55) { perfCap = 4; slowFor = 0; }
    }

    return {
      ui, A, S, CONTROLS, dots, lines,
      get dotN() { return dotN; },
      get lineN() { return lineN; },
      get packName() { return packName(); },
      get stateName() { return NAMES[cur]; },
      get packOrder() { return packOrder(); },
      set onStateName(f) { onStateName = f; },
      set onPush(f) { onPush = f; },
      get forced() { return forced; },

      resize(w, h) {
        W = w; H = h; cx = W / 2; cy = H / 2;
        maxR = Math.min(cx, cy) * 0.80;
        // Dot size and stroke width are the only things that don't scale with
        // the figure, so give them their own unit: the piece then looks the
        // same on a laptop panel and a 5K screen.
        PX = Math.max(0.6, Math.min(W, H) / 900);
      },
      setState(v) {
        if (v === 'auto') forced = -1;
        else { forced = +v; dwell = 99; }
      },
      step(dt) {
        frameDt = dt;
        ensureAudio();
        if (!anaMain || !analyse()) {
          silentFor += dt;
          if (silentFor > 0.25) demo(dt);
        } else silentFor = 0;
        updateParams(dt);
        stateMachine(dt);
        autoDrift(dt);
        governor(dt);
        t += dt * (0.34 + S.overall * 0.60) * ui.rate;
        emit(t);
      },
      // What the print pass needs, in one object so the two renderers agree.
      print() {
        // Gate weave: the frame never sat perfectly still in the printer. Three
        // incommensurate sines give a wander that never repeats.
        const gw = ui.gate;
        return {
          fadeA: ui.trail + S.overall * 0.03,
          wx: (Math.sin(driftT * 3.1) + Math.sin(driftT * 7.7) * 0.5 + Math.sin(driftT * 13.3) * 0.25) * gw,
          wy: (Math.cos(driftT * 2.7) + Math.cos(driftT * 6.1) * 0.5 + Math.cos(driftT * 11.9) * 0.25) * gw,
          fog: ui.fog * (0.10 + S.low * 0.24),
          halA: clamp(ui.hal * 0.40, 0, 1),
          halB: clamp(ui.hal * 0.20, 0, 1),
          grain: ui.grain * 0.42,
          rad: ui.rad,
        };
      },
      randomize() {
        // A reel change: new filter turret, new symmetry, and a jump in the
        // drift clock so every slow wander lands somewhere else.
        ui.pack = 1 + ((Math.round(ui.pack) + 1 + (Math.random() * 3 | 0)) % PACKS.length);
        driftT += 40 + Math.random() * 120;
        P.harmQ = HARMONICS[(Math.random() * HARMONICS.length) | 0];
        CONTROLS.forEach((c) => { c.hold = 99; });
        return packName() + ' · ' + NAMES[cur];
      },
      cyclePack() {
        ui.pack = 1 + (Math.round(ui.pack) % PACKS.length);
        return packName();
      },
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     WEBGPU RENDERER — the print. The scene accumulates in an rgba16float
     texture that is never cleared (that's the phosphor trail); halation is two
     downsampled, separably-blurred taps off it; the composite adds base fog,
     gate weave and grain. On an HDR canvas the blown-out dot cores are pushed
     past 1.0 so they present as real highlights instead of clipping to white.
     ═══════════════════════════════════════════════════════════════════════ */

  const WGSL = `
struct U {
  res:   vec4f,   // W, H, 1/W, 1/H
  fade:  vec4f,   // film base rgb, trail alpha
  weave: vec4f,   // wx, wy, hdrK, unused
  post:  vec4f,   // fog, halA, halB, grain
  blur:  vec4f,   // tap step: A.x, A.y, B.x, B.y (texture-normalised)
  seed:  vec4f,   // grain seed x, y, unused, unused
  fog0:  vec4f, fog1: vec4f, fog2: vec4f,   // base-fog gradient stops (rgb, a)
};
@group(0) @binding(0) var<uniform> u: U;

struct Q { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vQuad(@builtin(vertex_index) vi: u32) -> Q {
  var c = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  let p = c[vi];
  var o: Q;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = vec2f((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return o;
}

// The trail wash: a translucent coat of film base over last frame's scene.
@fragment
fn fFade() -> @location(0) vec4f { return u.fade; }

// ── dots ────────────────────────────────────────────────────────────────────
struct DotV {
  @builtin(position) pos: vec4f,
  @location(0) c: vec2f,
  @location(1) tint: vec4f,
};
@vertex
fn vDot(@builtin(vertex_index) vi: u32,
        @location(0) ipos: vec2f, @location(1) isize: f32,
        @location(2) itint: vec4f) -> DotV {
  var q = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  let c = q[vi];
  let p = ipos + c * (isize * 0.5);
  var o: DotV;
  o.pos = vec4f(p.x * u.res.z * 2.0 - 1.0, 1.0 - p.y * u.res.w * 2.0, 0.0, 1.0);
  o.c = c;
  o.tint = itint;
  return o;
}
// A small overexposed dot on stock: a blown-out white core with the tint taking
// over immediately outside it. Keeping the tint at the edges is what stops the
// whole field turning white once several voices overlap.
fn sprite(r: f32, tint: vec3f) -> vec4f {
  let w1 = vec3f(1.0, 0.988, 0.964);
  let w2 = vec3f(1.0, 0.980, 0.941);
  if (r < 0.10) { let t = r / 0.10; return vec4f(mix(w1, w2, t), mix(1.0, 0.92, t)); }
  if (r < 0.17) { let t = (r - 0.10) / 0.07; return vec4f(mix(w2, tint, t), mix(0.92, 0.90, t)); }
  if (r < 0.34) { let t = (r - 0.17) / 0.17; return vec4f(tint, mix(0.90, 0.30, t)); }
  if (r < 0.62) { let t = (r - 0.34) / 0.28; return vec4f(tint, mix(0.30, 0.06, t)); }
  let t = (r - 0.62) / 0.38;
  return vec4f(tint, mix(0.06, 0.0, t));
}
@fragment
fn fDot(v: DotV) -> @location(0) vec4f {
  let r = length(v.c);
  if (r > 1.0) { discard; }
  let g = sprite(r, v.tint.rgb);
  var col = g.rgb * g.a * v.tint.a;
  // HDR headroom lives in the core only — the skirts stay where they were, so
  // the figure doesn't just get brighter, it gets a hotter centre.
  col *= 1.0 + (u.weave.z - 1.0) * (1.0 - smoothstep(0.0, 0.20, r));
  return vec4f(col, 1.0);
}

// ── chord lines: quad-expanded so width and feather survive on any DPR ──────
struct LineV {
  @builtin(position) pos: vec4f,
  @location(0) d: f32,        // signed distance across the line, in pixels
  @location(1) hw: f32,
  @location(2) tint: vec4f,
};
@vertex
fn vLine(@builtin(vertex_index) vi: u32,
         @location(0) a: vec2f, @location(1) b: vec2f,
         @location(2) tint: vec4f, @location(3) w: f32) -> LineV {
  let d = b - a;
  let L = max(1e-5, length(d));
  let dir = d / L;
  let nrm = vec2f(-dir.y, dir.x);
  let half = w * 0.5 + 1.0;                       // one pixel of feather
  var q = array<vec2f, 4>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0), vec2f(1.0, 1.0));
  let c = q[vi];
  let p = a + dir * (c.x * L) + nrm * (c.y * half);
  var o: LineV;
  o.pos = vec4f(p.x * u.res.z * 2.0 - 1.0, 1.0 - p.y * u.res.w * 2.0, 0.0, 1.0);
  o.d = c.y * half;
  o.hw = w * 0.5;
  o.tint = tint;
  return o;
}
@fragment
fn fLine(v: LineV) -> @location(0) vec4f {
  let cov = clamp(v.hw + 0.5 - abs(v.d), 0.0, 1.0);
  return vec4f(v.tint.rgb * v.tint.a * cov, 1.0);
}

// ── halation ────────────────────────────────────────────────────────────────
// Not bloom. High contrast on the bright pass means only the blown-out cores
// bleed and everything else is crushed away; tap A is a tight neutral halo, tap
// B a broad warm veil — film's red-shifted halation from the deepest layer.
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var texA: texture_2d<f32>;

fn crush(c: vec3f) -> vec3f {
  return max(vec3f(0.0), (c * 1.05 - vec3f(0.5)) * 3.4 + vec3f(0.5));
}
fn warm(c: vec3f) -> vec3f {
  let sep = vec3f(dot(c, vec3f(0.393, 0.769, 0.189)),
                  dot(c, vec3f(0.349, 0.686, 0.168)),
                  dot(c, vec3f(0.272, 0.534, 0.131)));
  var x = mix(c, sep, 0.75);
  let l = dot(x, vec3f(0.213, 0.715, 0.072));
  x = vec3f(l) + (x - vec3f(l)) * 2.6;
  return max(vec3f(0.0), x * 0.85);
}
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(texA, samp, uv, 0.0).rgb; }

@fragment
fn fBlurAH(v: Q) -> @location(0) vec4f {
  let s = vec2f(u.blur.x, 0.0);
  var c = crush(tap(v.uv)) * 0.2270270;
  c += (crush(tap(v.uv + s)) + crush(tap(v.uv - s))) * 0.1945946;
  c += (crush(tap(v.uv + s * 2.0)) + crush(tap(v.uv - s * 2.0))) * 0.1216216;
  c += (crush(tap(v.uv + s * 3.0)) + crush(tap(v.uv - s * 3.0))) * 0.0540541;
  c += (crush(tap(v.uv + s * 4.0)) + crush(tap(v.uv - s * 4.0))) * 0.0162162;
  return vec4f(c, 1.0);
}
@fragment
fn fBlurAV(v: Q) -> @location(0) vec4f {
  let s = vec2f(0.0, u.blur.y);
  var c = tap(v.uv) * 0.2270270;
  c += (tap(v.uv + s) + tap(v.uv - s)) * 0.1945946;
  c += (tap(v.uv + s * 2.0) + tap(v.uv - s * 2.0)) * 0.1216216;
  c += (tap(v.uv + s * 3.0) + tap(v.uv - s * 3.0)) * 0.0540541;
  c += (tap(v.uv + s * 4.0) + tap(v.uv - s * 4.0)) * 0.0162162;
  return vec4f(c, 1.0);
}
@fragment
fn fBlurBH(v: Q) -> @location(0) vec4f {
  let s = vec2f(u.blur.z, 0.0);
  var c = warm(tap(v.uv)) * 0.2270270;
  c += (warm(tap(v.uv + s)) + warm(tap(v.uv - s))) * 0.1945946;
  c += (warm(tap(v.uv + s * 2.0)) + warm(tap(v.uv - s * 2.0))) * 0.1216216;
  c += (warm(tap(v.uv + s * 3.0)) + warm(tap(v.uv - s * 3.0))) * 0.0540541;
  c += (warm(tap(v.uv + s * 4.0)) + warm(tap(v.uv - s * 4.0))) * 0.0162162;
  return vec4f(c, 1.0);
}
@fragment
fn fBlurBV(v: Q) -> @location(0) vec4f {
  let s = vec2f(0.0, u.blur.w);
  var c = tap(v.uv) * 0.2270270;
  c += (tap(v.uv + s) + tap(v.uv - s)) * 0.1945946;
  c += (tap(v.uv + s * 2.0) + tap(v.uv - s * 2.0)) * 0.1216216;
  c += (tap(v.uv + s * 3.0) + tap(v.uv - s * 3.0)) * 0.0540541;
  c += (tap(v.uv + s * 4.0) + tap(v.uv - s * 4.0)) * 0.0162162;
  return vec4f(c, 1.0);
}

// ── composite ───────────────────────────────────────────────────────────────
@group(2) @binding(0) var samp2: sampler;
@group(2) @binding(1) var scene: texture_2d<f32>;
@group(2) @binding(2) var halA: texture_2d<f32>;
@group(2) @binding(3) var halB: texture_2d<f32>;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}
@fragment
fn fComp(v: Q) -> @location(0) vec4f {
  let px = v.uv * u.res.xy;
  // The print is laid a couple of pixels oversized and shifted by the weave, so
  // the wander can never expose an edge.
  let suv = (px - vec2f(u.weave.x - 2.0, u.weave.y - 2.0)) / (u.res.xy + vec2f(4.0));
  var col = textureSampleLevel(scene, samp2, suv, 0.0).rgb;

  // Base fog: the printer's light spill on the film base. Sits under the
  // halation and lifts the black to a dark maroon.
  let d = clamp(length(px - u.res.xy * 0.5) / (max(u.res.x, u.res.y) * 0.62), 0.0, 1.0);
  var fg: vec4f;
  if (d < 0.42) { fg = mix(u.fog0, u.fog1, d / 0.42); }
  else { fg = mix(u.fog1, u.fog2, (d - 0.42) / 0.58); }
  col += fg.rgb * fg.a * u.post.x;

  col += textureSampleLevel(halA, samp2, suv, 0.0).rgb * u.post.y;
  col += textureSampleLevel(halB, samp2, suv, 0.0).rgb * u.post.z;

  // Emulsion grain. On a dark print the grain you actually see is the bright
  // side of it, so these are sparse warm specks, not full-range noise.
  let g = hash(floor(px) + u.seed.xy);
  if (g > 0.86) {
    col += vec3f(1.0, 0.957, 0.910) * ((g - 0.86) / 0.14 * 0.588) * u.post.w;
  }
  return vec4f(col, 1.0);
}`;

  async function probeHdr(device) {
    // WebKit has historically ACCEPTED an rgba16float canvas and then presented
    // black, so don't trust configure(): render a clear and read it back.
    try {
      if (!matchMedia('(dynamic-range: high)').matches) return false;
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
      await Promise.race([new Promise((r) => requestAnimationFrame(r)), timeout(400)]);
      const s = document.createElement('canvas'); s.width = 8; s.height = 8;
      const sc = s.getContext('2d');
      sc.drawImage(cv, 0, 0);
      const d = sc.getImageData(0, 0, 8, 8).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
      return lit > 32;
    } catch (e) { return false; }
  }

  async function createGPU(canvas) {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const hdr = await Promise.race([probeHdr(device), timeout(1500, false)]);
    const ctx = canvas.getContext('webgpu');
    if (!ctx) return null;
    const format = hdr ? 'rgba16float' : navigator.gpu.getPreferredCanvasFormat();
    const conf = { device, format, alphaMode: 'opaque' };
    if (hdr) conf.toneMapping = { mode: 'extended' };
    ctx.configure(conf);

    const mod = device.createShaderModule({ code: WGSL });
    if (mod.getCompilationInfo) {
      const info = await Promise.race([mod.getCompilationInfo(), timeout(1200, { messages: [] })]);
      if (info.messages.some((m) => m.type === 'error')) {
        console.error('permutations wgsl:', info.messages.map((m) => m.lineNum + ':' + m.message).join(' | '));
        return null;
      }
    }

    const HDRF = 'rgba16float';
    const UBYTES = 9 * 16;
    const ubo = device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bglU = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    ] });
    const bgU = device.createBindGroup({ layout: bglU, entries: [{ binding: 0, resource: { buffer: ubo } }] });
    const bgl1 = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ] });
    const bgl3 = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ] });
    // Group indices in the shader are 0 (uniform), 1 (blur source), 2 (composite
    // sources) — the pipeline layouts have to line up with that, so the blur
    // pipelines pad slot 2 and the composite pads slot 1.
    const layScene = device.createPipelineLayout({ bindGroupLayouts: [bglU] });
    const layBlur = device.createPipelineLayout({ bindGroupLayouts: [bglU, bgl1] });
    const layComp = device.createPipelineLayout({ bindGroupLayouts: [bglU, bgl1, bgl3] });

    const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const OVER = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
      alpha: { srcFactor: 'one', dstFactor: 'zero' },
    };
    const quad = { topology: 'triangle-strip' };

    const fadePipe = device.createRenderPipeline({
      layout: layScene,
      vertex: { module: mod, entryPoint: 'vQuad' },
      fragment: { module: mod, entryPoint: 'fFade', targets: [{ format: HDRF, blend: OVER }] },
      primitive: quad,
    });
    const dotPipe = device.createRenderPipeline({
      layout: layScene,
      vertex: { module: mod, entryPoint: 'vDot', buffers: [
        { arrayStride: 28, stepMode: 'instance', attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 8, format: 'float32' },
          { shaderLocation: 2, offset: 12, format: 'float32x4' },
        ] },
      ] },
      fragment: { module: mod, entryPoint: 'fDot', targets: [{ format: HDRF, blend: ADD }] },
      primitive: quad,
    });
    const linePipe = device.createRenderPipeline({
      layout: layScene,
      vertex: { module: mod, entryPoint: 'vLine', buffers: [
        { arrayStride: 36, stepMode: 'instance', attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 8, format: 'float32x2' },
          { shaderLocation: 2, offset: 16, format: 'float32x4' },
          { shaderLocation: 3, offset: 32, format: 'float32' },
        ] },
      ] },
      fragment: { module: mod, entryPoint: 'fLine', targets: [{ format: HDRF, blend: ADD }] },
      primitive: quad,
    });
    const mkBlur = (entry) => device.createRenderPipeline({
      layout: layBlur,
      vertex: { module: mod, entryPoint: 'vQuad' },
      fragment: { module: mod, entryPoint: entry, targets: [{ format: HDRF }] },
      primitive: quad,
    });
    const blurAH = mkBlur('fBlurAH'), blurAV = mkBlur('fBlurAV');
    const blurBH = mkBlur('fBlurBH'), blurBV = mkBlur('fBlurBV');
    const compPipe = device.createRenderPipeline({
      layout: layComp,
      vertex: { module: mod, entryPoint: 'vQuad' },
      fragment: { module: mod, entryPoint: 'fComp', targets: [{ format }] },
      primitive: quad,
    });

    const samp = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    const dotBuf = device.createBuffer({ size: DOT_CAP * 7 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const lineBuf = device.createBuffer({ size: LINE_CAP * 9 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const uarr = new Float32Array(UBYTES / 4);

    let W = 2, H = 2, W4 = 1, H4 = 1, W8 = 1, H8 = 1;
    let sceneT = null, tmpA = null, halAT = null, tmpB = null, halBT = null;
    let bgSceneA = null, bgTmpA = null, bgHalA = null, bgTmpB = null, bgComp = null;
    let needClear = true;

    const mkTex = (w, h) => device.createTexture({
      size: [w, h], format: HDRF,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    function resize(w, h) {
      W = Math.max(2, w | 0); H = Math.max(2, h | 0);
      canvas.width = W; canvas.height = H;
      W4 = Math.max(1, W >> 2); H4 = Math.max(1, H >> 2);
      W8 = Math.max(1, W >> 3); H8 = Math.max(1, H >> 3);
      for (const t of [sceneT, tmpA, halAT, tmpB, halBT]) if (t) t.destroy();
      sceneT = mkTex(W, H);
      tmpA = mkTex(W4, H4); halAT = mkTex(W4, H4);
      tmpB = mkTex(W8, H8); halBT = mkTex(W8, H8);
      const one = (tex) => device.createBindGroup({ layout: bgl1, entries: [
        { binding: 0, resource: samp }, { binding: 1, resource: tex.createView() },
      ] });
      bgSceneA = one(sceneT);      // halation tap A reads the scene
      bgTmpA = one(tmpA);
      bgHalA = one(halAT);         // tap B reads tap A
      bgTmpB = one(tmpB);
      bgComp = device.createBindGroup({ layout: bgl3, entries: [
        { binding: 0, resource: samp },
        { binding: 1, resource: sceneT.createView() },
        { binding: 2, resource: halAT.createView() },
        { binding: 3, resource: halBT.createView() },
      ] });
      needClear = true;
    }

    function frame(sim, p) {
      if (!sceneT) return;
      const hdrK = hdr ? 3.2 : 1.0;
      uarr.set([W, H, 1 / W, 1 / H], 0);
      uarr.set([FILM[0], FILM[1], FILM[2], p.fadeA], 4);
      uarr.set([p.wx, p.wy, hdrK, 0], 8);
      uarr.set([p.fog, p.halA, p.halB, p.grain], 12);
      // CSS blur(r) is a gaussian of std-dev r applied in the destination
      // buffer's own pixels — quarter-res for tap A, eighth-res for tap B.
      const sA = Math.max(0.35, p.rad * 0.5), sB = Math.max(0.35, p.rad * 1.15 * 0.5);
      uarr.set([sA / W4, sA / H4, sB / W8, sB / H8], 16);
      uarr.set([(Math.random() * 4096) | 0, (Math.random() * 4096) | 0, 0, 0], 20);
      uarr.set([104 / 255, 24 / 255, 12 / 255, 1.0], 24);
      uarr.set([64 / 255, 14 / 255, 9 / 255, 0.5], 28);
      uarr.set([16 / 255, 4 / 255, 6 / 255, 0.0], 32);
      device.queue.writeBuffer(ubo, 0, uarr);

      const nD = sim.dotN, nL = sim.lineN;
      if (nD) device.queue.writeBuffer(dotBuf, 0, sim.dots, 0, nD * 7);
      if (nL) device.queue.writeBuffer(lineBuf, 0, sim.lines, 0, nL * 9);

      const enc = device.createCommandEncoder();

      // 1 · the scene, never cleared — that persistence IS the trail
      const scenePass = enc.beginRenderPass({ colorAttachments: [{
        view: sceneT.createView(),
        loadOp: needClear ? 'clear' : 'load', storeOp: 'store',
        clearValue: { r: FILM[0], g: FILM[1], b: FILM[2], a: 1 },
      }] });
      needClear = false;
      scenePass.setBindGroup(0, bgU);
      scenePass.setPipeline(fadePipe);
      scenePass.draw(4);
      if (nD) {
        scenePass.setPipeline(dotPipe);
        scenePass.setVertexBuffer(0, dotBuf);
        scenePass.draw(4, nD);
      }
      if (nL) {
        scenePass.setPipeline(linePipe);
        scenePass.setVertexBuffer(0, lineBuf);
        scenePass.draw(4, nL);
      }
      scenePass.end();

      // 2 · halation, two taps
      const blit = (view, pipe, src) => {
        const pass = enc.beginRenderPass({ colorAttachments: [{
          view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }] });
        pass.setBindGroup(0, bgU);
        pass.setBindGroup(1, src);
        pass.setPipeline(pipe);
        pass.draw(4);
        pass.end();
      };
      blit(tmpA.createView(), blurAH, bgSceneA);
      blit(halAT.createView(), blurAV, bgTmpA);
      blit(tmpB.createView(), blurBH, bgHalA);
      blit(halBT.createView(), blurBV, bgTmpB);

      // 3 · the print
      const out = enc.beginRenderPass({ colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }] });
      out.setBindGroup(0, bgU);
      out.setBindGroup(1, bgSceneA);      // unused by fComp; the layout wants a slot
      out.setBindGroup(2, bgComp);
      out.setPipeline(compPipe);
      out.draw(4);
      out.end();

      device.queue.submit([enc.finish()]);
    }

    return { backend: hdr ? 'webgpu · hdr' : 'webgpu', resize, frame };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     WEBGL2 RENDERER — the same passes for machines without WebGPU (notably
     WebKitGTK on Linux, which ships no navigator.gpu but a fine WebGL2).
     Half-float targets when the driver will render to them, RGBA8 otherwise;
     either way the output is SDR, so the dot cores clip to white as they did
     on the 2D-canvas original.
     ═══════════════════════════════════════════════════════════════════════ */

  const GL_HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
  // GL renders bottom-up into a framebuffer while these shaders think top-down,
  // so every sample of a texture we rendered ourselves flips back.
  const GL_FLIP = 'vec2 F(vec2 uv){ return vec2(uv.x, 1.0 - uv.y); }\n';

  const GL_QUAD_VS = GL_HEAD + `
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID & 1) == 1 ? 1.0 : -1.0, (gl_VertexID & 2) == 2 ? 1.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
  vUv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
}`;

  const GL_FADE_FS = GL_HEAD + `
uniform vec4 uFade;
out vec4 o;
void main() { o = uFade; }`;

  const GL_DOT_VS = GL_HEAD + `
layout(location=0) in vec2 iPos;
layout(location=1) in float iSize;
layout(location=2) in vec4 iTint;
uniform vec2 uInvRes;
out vec2 vC;
out vec4 vTint;
void main() {
  vec2 c = vec2((gl_VertexID & 1) == 1 ? 1.0 : -1.0, (gl_VertexID & 2) == 2 ? 1.0 : -1.0);
  vec2 p = iPos + c * (iSize * 0.5);
  gl_Position = vec4(p.x * uInvRes.x * 2.0 - 1.0, 1.0 - p.y * uInvRes.y * 2.0, 0.0, 1.0);
  vC = c; vTint = iTint;
}`;

  const GL_DOT_FS = GL_HEAD + `
in vec2 vC;
in vec4 vTint;
out vec4 o;
vec4 sprite(float r, vec3 tint) {
  vec3 w1 = vec3(1.0, 0.988, 0.964);
  vec3 w2 = vec3(1.0, 0.980, 0.941);
  if (r < 0.10) { float t = r / 0.10; return vec4(mix(w1, w2, t), mix(1.0, 0.92, t)); }
  if (r < 0.17) { float t = (r - 0.10) / 0.07; return vec4(mix(w2, tint, t), mix(0.92, 0.90, t)); }
  if (r < 0.34) { float t = (r - 0.17) / 0.17; return vec4(tint, mix(0.90, 0.30, t)); }
  if (r < 0.62) { float t = (r - 0.34) / 0.28; return vec4(tint, mix(0.30, 0.06, t)); }
  float t = (r - 0.62) / 0.38;
  return vec4(tint, mix(0.06, 0.0, t));
}
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  vec4 g = sprite(r, vTint.rgb);
  o = vec4(g.rgb * g.a * vTint.a, 1.0);
}`;

  const GL_LINE_VS = GL_HEAD + `
layout(location=0) in vec2 iA;
layout(location=1) in vec2 iB;
layout(location=2) in vec4 iTint;
layout(location=3) in float iW;
uniform vec2 uInvRes;
out float vD;
out float vHW;
out vec4 vTint;
void main() {
  vec2 d = iB - iA;
  float L = max(1e-5, length(d));
  vec2 dir = d / L;
  vec2 nrm = vec2(-dir.y, dir.x);
  float half_ = iW * 0.5 + 1.0;
  vec2 c = vec2((gl_VertexID & 1) == 1 ? 1.0 : 0.0, (gl_VertexID & 2) == 2 ? 1.0 : -1.0);
  vec2 p = iA + dir * (c.x * L) + nrm * (c.y * half_);
  gl_Position = vec4(p.x * uInvRes.x * 2.0 - 1.0, 1.0 - p.y * uInvRes.y * 2.0, 0.0, 1.0);
  vD = c.y * half_; vHW = iW * 0.5; vTint = iTint;
}`;

  const GL_LINE_FS = GL_HEAD + `
in float vD;
in float vHW;
in vec4 vTint;
out vec4 o;
void main() {
  float cov = clamp(vHW + 0.5 - abs(vD), 0.0, 1.0);
  o = vec4(vTint.rgb * vTint.a * cov, 1.0);
}`;

  const GL_BLUR_FS = GL_HEAD + GL_FLIP + `
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform int uTone;        // 0 = none, 1 = crush (tap A), 2 = warm (tap B)
out vec4 o;
vec3 tone(vec3 c) {
  if (uTone == 1) return max(vec3(0.0), (c * 1.05 - vec3(0.5)) * 3.4 + vec3(0.5));
  if (uTone == 2) {
    vec3 sep = vec3(dot(c, vec3(0.393, 0.769, 0.189)),
                    dot(c, vec3(0.349, 0.686, 0.168)),
                    dot(c, vec3(0.272, 0.534, 0.131)));
    vec3 x = mix(c, sep, 0.75);
    float l = dot(x, vec3(0.213, 0.715, 0.072));
    x = vec3(l) + (x - vec3(l)) * 2.6;
    return max(vec3(0.0), x * 0.85);
  }
  return c;
}
vec3 t(vec2 uv) { return tone(texture(uTex, F(uv)).rgb); }
void main() {
  vec3 c = t(vUv) * 0.2270270;
  c += (t(vUv + uStep) + t(vUv - uStep)) * 0.1945946;
  c += (t(vUv + uStep * 2.0) + t(vUv - uStep * 2.0)) * 0.1216216;
  c += (t(vUv + uStep * 3.0) + t(vUv - uStep * 3.0)) * 0.0540541;
  c += (t(vUv + uStep * 4.0) + t(vUv - uStep * 4.0)) * 0.0162162;
  o = vec4(c, 1.0);
}`;

  const GL_COMP_FS = GL_HEAD + GL_FLIP + `
in vec2 vUv;
uniform sampler2D uScene, uHalA, uHalB;
uniform vec2 uRes;
uniform vec2 uWeave;
uniform vec4 uPost;       // fog, halA, halB, grain
uniform vec2 uSeed;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = vUv * uRes;
  vec2 suv = (px - (uWeave - vec2(2.0))) / (uRes + vec2(4.0));
  vec3 col = texture(uScene, F(suv)).rgb;

  float d = clamp(length(px - uRes * 0.5) / (max(uRes.x, uRes.y) * 0.62), 0.0, 1.0);
  vec4 f0 = vec4(104.0 / 255.0, 24.0 / 255.0, 12.0 / 255.0, 1.0);
  vec4 f1 = vec4(64.0 / 255.0, 14.0 / 255.0, 9.0 / 255.0, 0.5);
  vec4 f2 = vec4(16.0 / 255.0, 4.0 / 255.0, 6.0 / 255.0, 0.0);
  vec4 fg = d < 0.42 ? mix(f0, f1, d / 0.42) : mix(f1, f2, (d - 0.42) / 0.58);
  col += fg.rgb * fg.a * uPost.x;

  col += texture(uHalA, F(suv)).rgb * uPost.y;
  col += texture(uHalB, F(suv)).rgb * uPost.z;

  float g = hash(floor(px) + uSeed);
  if (g > 0.86) col += vec3(1.0, 0.957, 0.910) * ((g - 0.86) / 0.14 * 0.588) * uPost.w;
  o = vec4(col, 1.0);
}`;

  function createGL2(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, powerPreference: 'high-performance',
    });
    if (!gl) return null;
    // Rendering TO half-float needs an extension even in WebGL2; sampling one
    // linearly does not. Without it we still work, just in 8-bit — the trail
    // banding is the only visible cost.
    const half = !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
    const IFMT = half ? gl.RGBA16F : gl.RGBA8;
    const TYPE = half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

    function compile(vs, fs) {
      const mk = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    let pFade, pDot, pLine, pBlur, pComp;
    try {
      pFade = compile(GL_QUAD_VS, GL_FADE_FS);
      pDot = compile(GL_DOT_VS, GL_DOT_FS);
      pLine = compile(GL_LINE_VS, GL_LINE_FS);
      pBlur = compile(GL_QUAD_VS, GL_BLUR_FS);
      pComp = compile(GL_QUAD_VS, GL_COMP_FS);
    } catch (e) { console.error('permutations glsl:', e); return null; }

    const U = (p, n) => gl.getUniformLocation(p, n);
    const uni = {
      fade: U(pFade, 'uFade'),
      dotRes: U(pDot, 'uInvRes'),
      lineRes: U(pLine, 'uInvRes'),
      blurTex: U(pBlur, 'uTex'), blurStep: U(pBlur, 'uStep'), blurTone: U(pBlur, 'uTone'),
      cScene: U(pComp, 'uScene'), cHalA: U(pComp, 'uHalA'), cHalB: U(pComp, 'uHalB'),
      cRes: U(pComp, 'uRes'), cWeave: U(pComp, 'uWeave'), cPost: U(pComp, 'uPost'), cSeed: U(pComp, 'uSeed'),
    };

    const emptyVao = gl.createVertexArray();
    const dotBuf = gl.createBuffer(), lineBuf = gl.createBuffer();
    const dotVao = gl.createVertexArray(), lineVao = gl.createVertexArray();
    gl.bindVertexArray(dotVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
    gl.bufferData(gl.ARRAY_BUFFER, DOT_CAP * 7 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 28, 8); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 28, 12); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, LINE_CAP * 9 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 36, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 8); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 36, 32); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    function mkTarget(w, h) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, IFMT, w, h, 0, gl.RGBA, TYPE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, w, h };
    }

    let W = 2, H = 2, scene = null, tmpA = null, halA = null, tmpB = null, halB = null;
    function resize(w, h) {
      W = Math.max(2, w | 0); H = Math.max(2, h | 0);
      canvas.width = W; canvas.height = H;
      for (const t of [scene, tmpA, halA, tmpB, halB]) {
        if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      }
      const w4 = Math.max(1, W >> 2), h4 = Math.max(1, H >> 2);
      const w8 = Math.max(1, W >> 3), h8 = Math.max(1, H >> 3);
      scene = mkTarget(W, H);
      tmpA = mkTarget(w4, h4); halA = mkTarget(w4, h4);
      tmpB = mkTarget(w8, h8); halB = mkTarget(w8, h8);
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(FILM[0], FILM[1], FILM[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function blurPass(dst, srcTex, stepX, stepY, tone) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.disable(gl.BLEND);
      gl.useProgram(pBlur);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(uni.blurTex, 0);
      gl.uniform2f(uni.blurStep, stepX, stepY);
      gl.uniform1i(uni.blurTone, tone);
      gl.bindVertexArray(emptyVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function frame(sim, p) {
      if (!scene) return;
      const nD = sim.dotN, nL = sim.lineN;

      // 1 · scene, over whatever is already there
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(pFade);
      gl.uniform4f(uni.fade, FILM[0], FILM[1], FILM[2], p.fadeA);
      gl.bindVertexArray(emptyVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.blendFunc(gl.ONE, gl.ONE);
      if (nD) {
        gl.useProgram(pDot);
        gl.uniform2f(uni.dotRes, 1 / W, 1 / H);
        gl.bindVertexArray(dotVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.dots, 0, nD * 7);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nD);
      }
      if (nL) {
        gl.useProgram(pLine);
        gl.uniform2f(uni.lineRes, 1 / W, 1 / H);
        gl.bindVertexArray(lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.lines, 0, nL * 9);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nL);
      }

      // 2 · halation
      const sA = Math.max(0.35, p.rad * 0.5), sB = Math.max(0.35, p.rad * 1.15 * 0.5);
      blurPass(tmpA, scene.tex, sA / tmpA.w, 0, 1);
      blurPass(halA, tmpA.tex, 0, sA / halA.h, 0);
      blurPass(tmpB, halA.tex, sB / tmpB.w, 0, 2);
      blurPass(halB, tmpB.tex, 0, sB / halB.h, 0);

      // 3 · the print
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
      gl.useProgram(pComp);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.tex); gl.uniform1i(uni.cScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, halA.tex); gl.uniform1i(uni.cHalA, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, halB.tex); gl.uniform1i(uni.cHalB, 2);
      gl.uniform2f(uni.cRes, W, H);
      gl.uniform2f(uni.cWeave, p.wx, p.wy);
      gl.uniform4f(uni.cPost, p.fog, p.halA, p.halB, p.grain);
      gl.uniform2f(uni.cSeed, (Math.random() * 4096) | 0, (Math.random() * 4096) | 0);
      gl.bindVertexArray(emptyVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    }

    return { backend: half ? 'webgl2 · half-float' : 'webgl2', resize, frame };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     THE CONTROL DESK — every parameter runs itself unless you take it.
     Dragging a slider locks it to your value, the square beside it fills to
     show you own it, and clicking that square hands the parameter back.
     Built and styled from here so both hosts get it for free; H shows and
     hides it, and the little tag that says so fades with the mouse.
     ═══════════════════════════════════════════════════════════════════════ */

  const DESK_CSS = `
.pm-tag, .pm-desk { font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.pm-tag {
  position: fixed; left: 8px; top: 26px; z-index: 4;
  padding: 3px 6px; border-radius: 3px;
  background: rgba(10,10,12,.55); color: rgba(255,255,255,.62);
  font-size: 9px; letter-spacing: .14em; text-transform: uppercase;
  text-shadow: 0 1px 2px #000; cursor: pointer; border: 0;
  transition: opacity .5s;
}
.pm-tag:hover { color: #fff; background: rgba(10,10,12,.8); }
/* faded means gone: it must not swallow clicks aimed at the desk beneath it */
.pm-tag.pm-out { opacity: 0; pointer-events: none; }
.pm-desk {
  position: fixed; left: 8px; top: 26px; z-index: 4; width: 250px;
  --card: #e9e3d5; --card-2: #dcd4c2; --ink: #17150f; --ink-2: #5c574a;
  --rule: #b4ab95; --mark: #8a2f1d;
  background: var(--card); color: var(--ink); border: 1px solid #0a0a0a; border-radius: 3px;
  box-shadow: 0 18px 40px rgba(0,0,0,.55);
  transition: transform .24s cubic-bezier(.2,.7,.2,1), opacity .24s;
}
.pm-desk.pm-out { transform: translateX(calc(-100% - 12px)); opacity: 0; pointer-events: none; }
.pm-head {
  display: flex; align-items: baseline; justify-content: space-between;
  padding: 8px 10px 6px; border-bottom: 1px solid var(--rule); background: var(--card-2);
}
.pm-head h1 { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
.pm-head span { font-size: 9px; color: var(--ink-2); letter-spacing: .08em; }
.pm-body { padding: 9px 10px 11px; max-height: calc(100vh - 60px); overflow-y: auto; scrollbar-width: thin; }
.pm-rule { height: 1px; background: var(--rule); margin: 10px 0; }
.pm-lbl { font-size: 9px; letter-spacing: .16em; text-transform: uppercase; color: var(--ink-2); margin: 0 0 6px; }
.pm-lbl.pm-split { display: flex; justify-content: space-between; align-items: baseline; }
.pm-lbl .pm-hint { text-transform: none; letter-spacing: 0; font-size: 9px; opacity: .75; }
.pm-states { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
.pm-states button {
  appearance: none; border: 0; background: var(--card); color: var(--ink-2);
  font: inherit; font-size: 9px; padding: 5px 0; cursor: pointer; letter-spacing: .06em;
}
.pm-states button:hover { background: #f2ecdf; color: var(--ink); }
.pm-states button[aria-pressed="true"] { background: var(--ink); color: var(--card); }
.pm-now { margin: 6px 0 0; font-size: 10px; }
.pm-now em { font-style: normal; color: var(--mark); font-weight: 700; }
.pm-voices { display: flex; gap: 4px; margin: 0 0 2px; }
.pm-voices i { flex: 1; height: 8px; display: block; opacity: .25; transition: opacity .2s; }
.pm-voices i.on { opacity: 1; }
.pm-row { display: flex; align-items: center; gap: 7px; margin: 0 0 4px; }
.pm-row label { flex: 0 0 68px; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-2); }
.pm-row output { flex: 0 0 32px; text-align: right; font-variant-numeric: tabular-nums; font-size: 10px; }
.pm-desk input[type=range] {
  flex: 1; appearance: none; -webkit-appearance: none; height: 1px;
  background: var(--rule); margin: 0; cursor: pointer; min-width: 0;
}
.pm-desk input[type=range]::-webkit-slider-thumb {
  appearance: none; -webkit-appearance: none; width: 9px; height: 13px;
  background: var(--ink); border: 0; border-radius: 0; margin-top: -6px;
}
.pm-lk { flex: 0 0 13px; height: 13px; padding: 0; border: 0; background: none; cursor: pointer; position: relative; }
.pm-lk::before { content: ""; position: absolute; inset: 3px; border: 1px solid var(--mark); }
.pm-lk[aria-pressed="true"]::before { background: var(--ink); border-color: var(--ink); }
.pm-meter { display: flex; align-items: center; gap: 7px; margin: 0 0 4px; }
.pm-meter span { flex: 0 0 68px; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-2); }
.pm-bar { flex: 1; height: 6px; background: #cdc4af; position: relative; overflow: hidden; }
.pm-bar i { position: absolute; top: 0; bottom: 0; background: var(--ink); display: block; }
.pm-bar.pm-bi::after { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--rule); }
.pm-meter output { flex: 0 0 32px; text-align: right; font-variant-numeric: tabular-nums; font-size: 10px; }
.pm-wide {
  display: block; width: 100%; appearance: none; border: 1px solid var(--rule);
  background: var(--card); color: var(--ink); font: inherit; font-size: 9px;
  letter-spacing: .14em; text-transform: uppercase; padding: 5px 0; cursor: pointer;
}
.pm-wide:hover { background: #f2ecdf; }
.pm-keys { margin: 9px 0 0; font-size: 9px; color: var(--ink-2); }
.pm-keys b { color: var(--ink); font-weight: 700; }
@media (prefers-reduced-motion: reduce) { .pm-desk, .pm-tag { transition: none; } }`;

  function injectCss() {
    if (document.getElementById('pm-desk-css')) return;
    const s = document.createElement('style');
    s.id = 'pm-desk-css';
    s.textContent = DESK_CSS;
    document.head.appendChild(s);
  }

  function buildDesk(sim, host, backendOf) {
    injectCss();
    const desk = document.createElement('div');
    desk.className = 'pm-desk pm-out';
    desk.innerHTML =
      '<div class="pm-head"><h1>Permutations</h1><span class="pm-be"></span></div>' +
      '<div class="pm-body">' +
        '<p class="pm-lbl">State</p>' +
        '<div class="pm-states pm-s1"></div>' +
        '<div class="pm-states pm-s2" style="margin-top:1px;grid-template-columns:1fr"></div>' +
        '<p class="pm-now">Running <em class="pm-state">harmonic consonance</em></p>' +
        '<div class="pm-rule"></div>' +
        '<p class="pm-lbl pm-split"><span>Filter pack</span><span class="pm-hint">drag to lock</span></p>' +
        '<div class="pm-voices"></div>' +
        '<div class="pm-A" style="margin-top:7px"></div>' +
        '<div class="pm-rule"></div>' +
        '<p class="pm-lbl pm-split"><span>Motion</span><span class="pm-hint">drag to lock</span></p>' +
        '<div class="pm-C"></div>' +
        '<div class="pm-rule"></div>' +
        '<p class="pm-lbl">Stereo field</p>' +
        '<div class="pm-meter"><span>Balance</span><div class="pm-bar pm-bi"><i class="pm-mbal"></i></div><output class="pm-obal">0.00</output></div>' +
        '<div class="pm-meter"><span>Correlation</span><div class="pm-bar pm-bi"><i class="pm-mcor"></i></div><output class="pm-ocor">0.00</output></div>' +
        '<div class="pm-meter"><span>Width</span><div class="pm-bar"><i class="pm-mwid"></i></div><output class="pm-owid">0.00</output></div>' +
        '<div class="pm-rule"></div>' +
        '<p class="pm-lbl pm-split"><span>Print</span><span class="pm-hint">drag to lock</span></p>' +
        '<div class="pm-B"></div>' +
        '<button class="pm-wide pm-rel">Lock all</button>' +
        '<p class="pm-keys"><b>H</b> hide · <b>← →</b> new reel · <b>1–4</b> state · <b>A</b> auto</p>' +
      '</div>';
    host.appendChild(desk);

    const tag = document.createElement('button');
    tag.className = 'pm-tag';
    tag.textContent = 'H · controls';
    tag.title = 'Show the control desk (H)';
    host.appendChild(tag);

    const q = (s) => desk.querySelector(s);
    const stateName = q('.pm-state');
    const beEl = q('.pm-be');
    let beShown = '';
    const legend = q('.pm-voices');
    VOICE_DEF.forEach(() => legend.appendChild(document.createElement('i')));

    // state buttons
    const stateBtns = [];
    const mkState = (box, key, text) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.dataset.s = key;
      b.setAttribute('aria-pressed', String(key === 'auto'));
      b.onclick = () => setState(key);
      box.appendChild(b);
      stateBtns.push(b);
    };
    mkState(q('.pm-s1'), 'auto', 'AUTO');
    mkState(q('.pm-s1'), '0', SHORT[0]);
    mkState(q('.pm-s1'), '1', SHORT[1]);
    mkState(q('.pm-s1'), '2', SHORT[2]);
    mkState(q('.pm-s2'), '3', SHORT[3]);
    function setState(v) {
      sim.setState(v);
      stateBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === String(v))));
    }

    const relBtn = q('.pm-rel');
    const BOX = { A: q('.pm-A'), B: q('.pm-B'), C: q('.pm-C') };

    function syncLegend() {
      const order = sim.packOrder;
      legend.title = 'Filter pack: ' + sim.packName;
      [...legend.children].forEach((el, i) => {
        el.style.background = TINT_CSS[order[i]];
        el.classList.toggle('on', i < sim.ui.voices);
      });
    }
    function setLock(c, on) {
      c.locked = on;
      c.lk.setAttribute('aria-pressed', String(on));
      c.lk.title = on ? 'Locked — click to release to auto' : 'Auto — drag the slider to take control';
      relBtn.textContent = sim.CONTROLS.some((x) => x.locked) ? 'Release all to auto' : 'Lock all';
    }
    function toDom(c) {
      c.el.value = String(sim.ui[c.k]);
      c.out.textContent = c.fmt(sim.ui[c.k]);
      if (c.k === 'voices' || c.k === 'pack') syncLegend();
    }

    sim.CONTROLS.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'pm-row';
      row.innerHTML =
        '<label>' + c.label + '</label>' +
        '<input type="range" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '">' +
        '<output></output><button class="pm-lk" aria-pressed="false"></button>';
      c.el = row.querySelector('input');
      c.out = row.querySelector('output');
      c.lk = row.querySelector('.pm-lk');
      toDom(c);
      setLock(c, false);
      c.el.addEventListener('input', () => { setLock(c, true); sim.ui[c.k] = +c.el.value; toDom(c); });
      c.lk.addEventListener('click', () => setLock(c, !c.locked));
      BOX[c.g].appendChild(row);
    });
    relBtn.onclick = () => {
      const lockAll = !sim.CONTROLS.some((x) => x.locked);
      sim.CONTROLS.forEach((c) => setLock(c, lockAll));
    };
    syncLegend();

    sim.onPush = toDom;                                   // the auto side, pushed back
    sim.onStateName = (n) => { stateName.textContent = n; };

    // meters — cheap, but no reason to touch the DOM 60 times a second
    const mBal = q('.pm-mbal'), oBal = q('.pm-obal');
    const mCor = q('.pm-mcor'), oCor = q('.pm-ocor');
    const mWid = q('.pm-mwid'), oWid = q('.pm-owid');
    let tick = 0;
    function bipolar(el, v) {
      const w = Math.abs(v) * 50;
      el.style.width = w + '%';
      el.style.left = (v >= 0 ? 50 : 50 - w) + '%';
    }
    function meters() {
      if (++tick % 5) return;
      const S = sim.S;
      bipolar(mBal, clamp(S.balance, -1, 1)); oBal.textContent = S.balance.toFixed(2);
      bipolar(mCor, clamp(S.corr, -1, 1)); oCor.textContent = S.corr.toFixed(2);
      mWid.style.left = '0%'; mWid.style.width = (clamp(S.width, 0, 1) * 100) + '%';
      oWid.textContent = S.width.toFixed(2);
    }

    // The tag fades on its own clock rather than borrowing the host's toolbar
    // idle state, so it behaves the same in both windows.
    let idle = 0, open = false, shown = false;
    const wake = () => { idle = 0; if (shown && !open) tag.classList.remove('pm-out'); };
    addEventListener('mousemove', wake, { passive: true });
    addEventListener('pointerdown', wake, { passive: true });

    function show(on) {
      shown = on;
      desk.style.display = on ? '' : 'none';
      tag.style.display = on ? '' : 'none';
      if (on) { idle = 0; tag.classList.toggle('pm-out', open); }
    }
    show(false);

    const api = {
      setActive: show,
      setState,
      toggle(force) {
        open = force != null ? force : desk.classList.contains('pm-out');
        desk.classList.toggle('pm-out', !open);
        tag.classList.toggle('pm-out', open);
        if (!open) idle = 0;
        return open;
      },
      get open() { return open; },
      tick(dt) {
        meters();
        const be = backendOf();                 // 'starting' until the device is up
        if (be !== beShown) { beShown = be; beEl.textContent = be; }
        idle += dt;
        if (idle > 2.6 && !open) tag.classList.add('pm-out');
      },
    };
    // The tag is a redundant affordance for the key, so hand focus straight
    // back — leaving it focused would put space and enter on the wrong control.
    tag.onclick = () => { api.toggle(true); tag.blur(); };
    return api;
  }

  /* ═══════════════════════════════════════════════════════════════════════ */

  function create({ canvas, getAudio }) {
    const sim = createSim(getAudio);
    let rend = null, backend = 'starting';
    const desk = buildDesk(sim, canvas.parentElement || document.body, () => backend);

    let active = false, wantW = 0, wantH = 0, lastT = 0;

    (async () => {
      try { rend = await createGPU(canvas); } catch (e) { console.warn('permutations gpu failed:', e); rend = null; }
      if (!rend) { try { rend = createGL2(canvas); } catch (e) { console.warn('permutations gl2 failed:', e); } }
      if (!rend) { backend = 'unavailable'; return; }
      backend = rend.backend;
      if (wantW) rend.resize(wantW, wantH);
    })();

    function frame(tms) {
      requestAnimationFrame(frame);
      if (!active) { lastT = 0; return; }
      const t = tms * 0.001;
      // Guard the whole range, not just the top: a clock that jumps backwards
      // (it happens across a fullscreen transition) hands out a negative dt,
      // and every lerp/pow in the sim turns to NaN or infinity on one of those.
      let dt = lastT ? t - lastT : 0.016;
      if (!(dt > 0) || dt > 0.1) dt = 0.016;
      lastT = t;
      sim.step(dt);
      desk.tick(dt);
      if (rend) rend.frame(sim, sim.print());
    }
    requestAnimationFrame(frame);

    // The desk owns its own key, so neither host has to know it exists. Nothing
    // fires unless this engine is the one on screen, and typing in a field
    // (the radio search, a playlist filter) always wins.
    addEventListener('keydown', (e) => {
      if (!active || e.metaKey || e.ctrlKey || e.altKey) return;
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if (k === 'h') { e.preventDefault(); desk.toggle(); }
      else if (k === 'a') desk.setState('auto');
      else if (k >= '1' && k <= '4') desk.setState(String(+k - 1));
    });

    return {
      get backend() { return backend; },
      get paletteName() { return sim.packName; },
      setActive(on) {
        active = on;
        if (on) lastT = 0;
        desk.setActive(on);
      },
      resize(w, h) {
        wantW = w; wantH = h;
        sim.resize(w, h);
        if (rend) rend.resize(w, h);
      },
      randomize() { return sim.randomize(); },
      cyclePalette() { return sim.cyclePack(); },
    };
  }

  window.ampPermutations = { create };
})();
