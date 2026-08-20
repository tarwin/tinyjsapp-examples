// audio.js — the vinyl in the speakers.
//
// One <audio> element streams the current track straight off disk (file://
// via readAccess), captured into a WebAudio graph so we can do the two
// things that make it a TURNTABLE and not a player:
//   • playbackRate rides the motor — spin-up bends the pitch from a groan
//     up to speed, spin-down sags it back (preservesPitch = false).
//   • a procedural crackle bed (sparse pops + faint hiss) plays whenever
//     the stylus is in the groove, plus a once-per-revolution thump when a
//     side runs out into the lead-out groove.
//
// The model: `needle` is WHERE the stylus sits (side time in seconds);
// the motor is a rate that eases toward its target. Sound only happens
// when needle is down AND the motor is turning — every combination
// (drop on a stopped record, kill the motor mid-song, …) falls out.

window.PLAYER = (() => {
  const fileURL = (p) => tiny.fileURL(p);

  // Linux: NO Web Audio anywhere. WebKitGTK renders the graph on a
  // normal-priority thread, so anything reaching ctx.destination crackles —
  // and not the good kind of crackle. The music element plays straight
  // through GStreamer (clean, and playbackRate still bends the motor); the
  // procedural sounds are pre-rendered ONCE into WAV blobs and played by
  // plain <audio> elements. Same ritual, different plumbing.
  const NO_GRAPH = !!(window.tiny && tiny.system && tiny.system.isLinux && tiny.system.isLinux());

  const el = new Audio();
  el.preservesPitch = false;
  el.webkitPreservesPitch = false;

  const SR = 44100;

  // the dust bed, as raw samples — 6s of hiss + pops, shared by both paths
  function noiseSamples() {
    const len = SR * 6;
    const chans = [new Float32Array(len), new Float32Array(len)];
    for (const d of chans) {
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.012;   // dust hiss
      for (let k = 0; k < 160; k++) {                                        // the pops
        const at = (Math.random() * len) | 0;
        const amp = Math.pow(Math.random(), 2.2) * 0.6 + 0.04;
        const w = 30 + Math.random() * 90;
        for (let i = 0; i < w && at + i < len; i++)
          d[at + i] += amp * Math.exp(-i / (w * 0.22)) * (i % 2 ? -1 : 1) * (0.4 + Math.random() * 0.6);
      }
    }
    return chans;
  }
  // the felted 65 Hz run-out knock, as raw samples
  function thumpSamples() {
    const len = (SR * 0.15) | 0;
    const d = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      d[i] = 0.20 * Math.sin(2 * Math.PI * 65 * t) * Math.exp(-t / 0.045);
    }
    return [d, d];
  }
  // the scrape: vinyl dragged across a still-turning platter as it lands or
  // leaves. A noise band sweeping DOWN (the contact loses speed as the disc
  // settles) with a woody knock under it. Rendered once; playbackRate makes
  // every scrape a slightly different one.
  function scratchSamples() {
    const len = (SR * 0.44) | 0;
    const d = new Float32Array(len);
    let lo = 0, band = 0;                              // Chamberlin SVF, Q ≈ 1.1
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const f = 2 * Math.sin(Math.PI * (2800 * Math.pow(0.19, t)) / SR);
      const hi = (Math.random() * 2 - 1) - lo - 0.9 * band;
      band += f * hi;
      lo += f * band;
      const env = Math.min(1, t / 0.02) * Math.pow(1 - t, 1.7);
      const knock = Math.sin(2 * Math.PI * 120 * (i / SR)) * 0.10 * Math.exp(-t * 14);
      d[i] = Math.max(-1, Math.min(1, band * 0.55 * env + knock));
    }
    return [d, d];
  }
  // Float32 stereo → 16-bit PCM WAV blob URL (for the graph-less path)
  function wavURL(chans) {
    const n = chans[0].length, ch = chans.length;
    const buf = new ArrayBuffer(44 + n * ch * 2);
    const v = new DataView(buf);
    const w4 = (o, str) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w4(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w4(8, 'WAVE');
    w4(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, ch, true); v.setUint32(24, SR, true);
    v.setUint32(28, SR * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    w4(36, 'data'); v.setUint32(40, n * ch * 2, true);
    for (let i = 0; i < n; i++)
      for (let c = 0; c < ch; c++) {
        const x = Math.max(-1, Math.min(1, chans[c][i]));
        v.setInt16(44 + (i * ch + c) * 2, x * 32767, true);
      }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  let ctx = null, crackleGain = null, master = null;
  let crackleEl = null, thumpEl = null;
  let scratchBuf = null, scratchEls = null, scratchAt = 0;
  if (!NO_GRAPH) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(el);
    const musicGain = ctx.createGain();
    master = ctx.createGain();
    src.connect(musicGain); musicGain.connect(master); master.connect(ctx.destination);
    crackleGain = ctx.createGain();
    crackleGain.gain.value = 0;
    crackleGain.connect(master);
    const chans = noiseSamples();
    const b = ctx.createBuffer(2, chans[0].length, SR);
    b.getChannelData(0).set(chans[0]); b.getChannelData(1).set(chans[1]);
    const crackleSrc = ctx.createBufferSource();
    crackleSrc.buffer = b;
    crackleSrc.loop = true;
    crackleSrc.start();
    crackleSrc.connect(crackleGain);
    const sc = scratchSamples();
    scratchBuf = ctx.createBuffer(2, sc[0].length, SR);
    scratchBuf.getChannelData(0).set(sc[0]); scratchBuf.getChannelData(1).set(sc[1]);
  } else {
    crackleEl = new Audio();
    crackleEl.src = wavURL(noiseSamples());
    crackleEl.loop = true;
    crackleEl.volume = 0;
    thumpEl = new Audio();
    thumpEl.src = wavURL(thumpSamples());
    // three elements so a scrape can overlap the tail of the one before it
    const su = wavURL(scratchSamples());
    scratchEls = [0, 1, 2].map(() => { const a = new Audio(); a.src = su; return a; });
  }
  // one clock for the groove-gap timing, whichever path runs
  const clock = () => (ctx ? ctx.currentTime : performance.now() / 1000);
  // resume audio on a user gesture — and (graph-less) get the bed looping,
  // silently, so later volume moves are instant
  const wake = () => {
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (crackleEl && crackleEl.paused) crackleEl.play().catch(() => {});
  };

  let crackleAt = 0;                   // last target — don't re-schedule the same ramp every frame
  const setCrackle = (v, t = 0.4) => {
    if (v === crackleAt) return;
    crackleAt = v;
    if (crackleGain) crackleGain.gain.setTargetAtTime(v, ctx.currentTime, t / 3);
    else if (crackleEl) crackleEl.volume = Math.min(1, v);   // stepped, but it's noise
  };

  // the run-out thump: a felted 65 Hz knock, once per revolution
  function thump() {
    if (ctx) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 65;
      g.gain.setValueAtTime(0.20, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      o.connect(g); g.connect(master);
      o.start(); o.stop(ctx.currentTime + 0.15);
    } else if (thumpEl) {
      try { thumpEl.currentTime = 0; } catch (e) {}
      thumpEl.play().catch(() => {});
    }
  }

  // a record laid on (or lifted off) a platter that hasn't stopped turning:
  // one scrape, loudness and pitch riding how fast it's still going
  function scratch(level = 1) {
    const v = Math.max(0, Math.min(1, level));
    if (v <= 0) return;
    wake();
    const speed = 0.82 + v * 0.36 + Math.random() * 0.14;
    if (ctx && scratchBuf) {
      const s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = scratchBuf;
      s.playbackRate.value = speed;
      g.gain.value = 0.34 * v;
      s.connect(g); g.connect(master);
      s.start();
    } else if (scratchEls) {
      const a = scratchEls[scratchAt++ % scratchEls.length];
      a.volume = Math.min(1, 0.55 * v);
      try { a.currentTime = 0; } catch (e) {}
      a.play().catch(() => {});
    }
  }

  // ── deck state ──
  let bedMode = false;          // true → an external engine (Spotify) drives the crackle
  let sides = null;              // [{ tracks: [{path,name,duration,start}], duration }]
  let sideIdx = 0;
  let needle = null;             // { t } side-seconds under the stylus, or null (arm at rest)
  let trackIdx = -1;             // which track el is loaded with (-1 = none)
  let loadedPath = null;         // the FILE el holds — a cue rip's tracks share one
  let runout = false;
  let motorOn = false;
  let speed = 33;                // 33 | 45 — 45 on an LP is the classic gag
  let rate = 0;                  // actual motor rate, eases toward target
  let gapUntil = 0;              // ctx time until which we sit in a between-track groove

  const P = {
    onTrack: null,               // fn(idx) — tracklist highlight
    onSideEnd: null,             // fn() — lead-out reached, arm should bob
  };

  const targetRate = () => (motorOn ? speed / 33.333 : 0);
  const atSpeed = () => rate > targetRate() * 0.985 && motorOn;

  // A cue track is a WINDOW into a longer rip: `start` is where it sits on
  // this side, `cueStart` where it sits in the file. Every conversion between
  // the two goes through here (a plain file has no cueStart, so both are 0).
  const fileTime = (tr, t) => Math.max(0, t - tr.start) + (tr.cueStart || 0);
  const sideTime = (tr) => tr.start + Math.max(0, el.currentTime - (tr.cueStart || 0));

  function locate(t) {           // side time → track index (or -1 past the end)
    const side = sides[sideIdx];
    for (let i = 0; i < side.tracks.length; i++) {
      const tr = side.tracks[i];
      if (t < tr.start + tr.duration) return i;
    }
    return -1;
  }

  // el.play() is async: without this guard the motor tick would re-seek and
  // re-play EVERY FRAME until the promise lands — the source of doubled-up
  // starts and buffer stutter
  let playPending = false;

  function loadAndPlay(t) {
    if (playPending) return;
    const side = sides[sideIdx];
    const i = locate(t);
    if (i < 0) { enterRunout(); return; }
    const tr = side.tracks[i];
    if (trackIdx !== i) {
      trackIdx = i;
      // moving within one rip is a seek, never a reload — that's the gapless
      if (loadedPath !== tr.path) { loadedPath = tr.path; el.src = fileURL(tr.path); }
      if (P.onTrack) P.onTrack(i);
    }
    try { el.currentTime = fileTime(tr, t); } catch (e) {}
    playPending = true;
    const p = el.play();
    if (p && p.finally) p.finally(() => { playPending = false; });
    else playPending = false;
  }

  function enterRunout() {
    runout = true;
    trackIdx = -1;
    el.pause();
    needle = { t: sides[sideIdx].duration };
    setCrackle(0.5);             // the lead-out is all crackle
    if (P.onSideEnd) P.onSideEnd();
  }

  // a track ran out under the stylus: 1.6s of silent groove, then the next.
  // `gapless` is the cue-rip case — the same file just keeps playing, so the
  // groove never lifts and there's nothing to wait for.
  function advance(gapless) {
    if (!needle) return;
    const side = sides && sides[sideIdx];
    if (!side) return;
    if (trackIdx >= side.tracks.length - 1) { enterRunout(); return; }
    const next = side.tracks[trackIdx + 1];
    needle = { t: next.start };
    if (gapless) {
      trackIdx += 1;
      if (P.onTrack) P.onTrack(trackIdx);
      return;
    }
    el.pause();
    gapUntil = clock() + 1.6;    // (clock, not ctx: Linux runs without a graph)
    setCrackle(0.5, 0.15);       // the groove between tracks, up close
  }
  el.addEventListener('ended', () => advance(false));

  // ── the motor loop: ease rate, keep the element honest ──
  let lastT = performance.now();
  function tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const tgt = targetRate();
    // spin-up is brisker than spin-down (motor pulls, friction coasts)
    const k = tgt > rate ? 2.6 : 1.4;
    rate += (tgt - rate) * (1 - Math.exp(-k * dt));
    if (Math.abs(tgt - rate) < 0.004) rate = tgt;

    const audible = needle && !runout && rate > 0.25;
    if (audible) {
      if (el.paused && !playPending && clock() >= gapUntil) loadAndPlay(needle.t);
      const pr = Math.min(4, rate);
      if (!el.paused && Math.abs(el.playbackRate - pr) > 0.004) el.playbackRate = pr;
      // a cue track ends where the NEXT one starts, not where the file does:
      // nothing fires 'ended', so the boundary is watched here. Running into
      // the side's last cue window is the run-out (side two lives further up
      // the same file — the needle must not wander into it).
      if (!el.paused && trackIdx >= 0) {
        const tr = sides[sideIdx].tracks[trackIdx];
        if (tr.cueEnd && el.currentTime >= tr.cueEnd - 0.03) {
          const next = sides[sideIdx].tracks[trackIdx + 1];
          advance(!!(next && next.path === tr.path && Math.abs((next.cueStart || 0) - tr.cueEnd) < 0.05));
        }
      }
    } else if (!el.paused) {
      // freeze the needle where the groove stopped moving
      if (trackIdx >= 0 && needle) needle = { t: sideTime(sides[sideIdx].tracks[trackIdx]) };
      el.pause();
    }
    // crackle follows the stylus: silent at rest, quiet under music, loud in
    // gaps (bedMode: a remote source borrows the bed and drives it itself)
    if (!bedMode) {
      if (!needle) setCrackle(0);
      else if (runout || (el.paused && rate > 0.25)) setCrackle(0.5);
      else if (!el.paused) setCrackle(0.12);
      else setCrackle(0);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // run-out thump, once per revolution while the lead-out spins under the arm
  setInterval(() => { if (runout && motorOn && rate > 0.5) thump(); }, 1810);

  // ── public face ──
  return Object.assign(P, {
    ctx,
    setSides(s) { sides = s; sideIdx = 0; needle = null; trackIdx = -1; loadedPath = null; runout = false; el.pause(); el.removeAttribute('src'); },
    setSide(i) { sideIdx = i; needle = null; trackIdx = -1; runout = false; el.pause(); },
    clear() { this.setSides(null); motorOn = false; },
    motor(on) { motorOn = on; wake(); },
    motorOn: () => motorOn,
    setSpeed(rpm) { speed = rpm; },
    speed: () => speed,
    rate: () => rate,            // 0..1.35 — the deck spins the record with this
    atSpeed,
    drop(t) {                    // stylus lands at side time t
      if (!sides) return;
      wake();
      runout = false;
      const d = sides[sideIdx].duration;
      needle = { t: Math.min(Math.max(0, t), d) };
      trackIdx = -1;             // force a src reload at the new spot
      el.pause();                // whatever was under the old spot stops NOW
      gapUntil = 0;
      if (needle.t >= d - 0.5) { enterRunout(); return; }
      // the physical act of landing: one pop, louder than the bed
      setCrackle(0.7, 0.05); setTimeout(() => { if (needle) setCrackle(0.25); }, 350);
      if (!(motorOn && rate > 0.25)) el.pause();   // on a still record: just sits
    },
    lift() {
      if (!needle) return;
      if (!el.paused && trackIdx >= 0) needle = { t: sideTime(sides[sideIdx].tracks[trackIdx]) };
      runout = false;
      trackIdx = -1;
      el.pause();
      needle = null;
      setCrackle(0, 0.1);
    },
    needleDown: () => !!needle,
    inRunout: () => runout,
    // where the stylus is, in side seconds — drives the tonearm's slow crawl
    time() {
      if (!sides) return 0;
      if (runout) return sides[sideIdx].duration;
      if (needle && !el.paused && trackIdx >= 0) return sideTime(sides[sideIdx].tracks[trackIdx]);
      return needle ? needle.t : 0;
    },
    trackIndex: () => trackIdx,
    // the crackle bed on loan: a remote engine (Spotify Connect) has no local
    // samples, but the stylus-in-groove noise is OUR turntable's, not theirs
    crackleBed(level) { bedMode = level != null; setCrackle(bedMode ? level : 0, 0.25); },
    // the scrape of vinyl meeting a platter that's still turning
    scratch,
  });
})();
