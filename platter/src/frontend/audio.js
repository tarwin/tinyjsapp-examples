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
  const fileURL = (p) => {
  p = p.replace(/\\/g, '/');           // windows separators
  if (!p.startsWith('/')) p = '/' + p;   // drive paths need the third slash
  return 'file://' + p.split('/').map(encodeURIComponent).join('/').replace(/%3A/gi, ':');
};

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const el = new Audio();
  el.preservesPitch = false;
  el.webkitPreservesPitch = false;
  const src = ctx.createMediaElementSource(el);
  const musicGain = ctx.createGain();
  const master = ctx.createGain();
  src.connect(musicGain); musicGain.connect(master); master.connect(ctx.destination);

  // ── crackle bed: a 6s loop of hiss + pops, gain 0 until the needle drops ──
  function noiseBuffer() {
    const len = ctx.sampleRate * 6;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.012;   // dust hiss
      for (let k = 0; k < 160; k++) {                                        // the pops
        const at = (Math.random() * len) | 0;
        const amp = Math.pow(Math.random(), 2.2) * 0.6 + 0.04;
        const w = 30 + Math.random() * 90;
        for (let i = 0; i < w && at + i < len; i++)
          d[at + i] += amp * Math.exp(-i / (w * 0.22)) * (i % 2 ? -1 : 1) * (0.4 + Math.random() * 0.6);
      }
    }
    return b;
  }
  const crackleGain = ctx.createGain();
  crackleGain.gain.value = 0;
  crackleGain.connect(master);
  const crackleSrc = ctx.createBufferSource();
  crackleSrc.buffer = noiseBuffer();
  crackleSrc.loop = true;
  crackleSrc.start();
  crackleSrc.connect(crackleGain);
  let crackleAt = 0;                   // last target — don't re-schedule the same ramp every frame
  const setCrackle = (v, t = 0.4) => {
    if (v === crackleAt) return;
    crackleAt = v;
    crackleGain.gain.setTargetAtTime(v, ctx.currentTime, t / 3);
  };

  // the run-out thump: a felted 65 Hz knock, once per revolution
  function thump() {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 65;
    g.gain.setValueAtTime(0.20, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + 0.15);
  }

  // ── deck state ──
  let bedMode = false;           // true → an external engine (Spotify) drives the crackle
  let sides = null;              // [{ tracks: [{path,name,duration,start}], duration }]
  let sideIdx = 0;
  let needle = null;             // { t } side-seconds under the stylus, or null (arm at rest)
  let trackIdx = -1;             // which track el is loaded with (-1 = none)
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
      el.src = fileURL(tr.path);
      if (P.onTrack) P.onTrack(i);
    }
    try { el.currentTime = Math.max(0, t - tr.start); } catch (e) {}
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

  // a track ran out under the stylus: 1.6s of silent groove, then the next
  el.addEventListener('ended', () => {
    if (!needle || !motorOn) return;
    const side = sides && sides[sideIdx];
    if (!side) return;
    if (trackIdx >= side.tracks.length - 1) { enterRunout(); return; }
    const next = side.tracks[trackIdx + 1];
    needle = { t: next.start };
    gapUntil = ctx.currentTime + 1.6;
    setCrackle(0.5, 0.15);       // the groove between tracks, up close
  });

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
      if (el.paused && !playPending && ctx.currentTime >= gapUntil) loadAndPlay(needle.t);
      const pr = Math.min(4, rate);
      if (!el.paused && Math.abs(el.playbackRate - pr) > 0.004) el.playbackRate = pr;
    } else if (!el.paused) {
      // freeze the needle where the groove stopped moving
      if (trackIdx >= 0 && needle) needle = { t: sides[sideIdx].tracks[trackIdx].start + el.currentTime };
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
    setSides(s) { sides = s; sideIdx = 0; needle = null; trackIdx = -1; runout = false; el.pause(); el.removeAttribute('src'); },
    setSide(i) { sideIdx = i; needle = null; trackIdx = -1; runout = false; el.pause(); },
    clear() { this.setSides(null); motorOn = false; },
    motor(on) { motorOn = on; if (ctx.state === 'suspended') ctx.resume(); },
    motorOn: () => motorOn,
    setSpeed(rpm) { speed = rpm; },
    speed: () => speed,
    rate: () => rate,            // 0..1.35 — the deck spins the record with this
    atSpeed,
    drop(t) {                    // stylus lands at side time t
      if (!sides) return;
      if (ctx.state === 'suspended') ctx.resume();
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
      if (!el.paused && trackIdx >= 0) needle = { t: sides[sideIdx].tracks[trackIdx].start + el.currentTime };
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
      if (needle && !el.paused && trackIdx >= 0) return sides[sideIdx].tracks[trackIdx].start + el.currentTime;
      return needle ? needle.t : 0;
    },
    trackIndex: () => trackIdx,
    // the crackle bed on loan: a remote engine (Spotify Connect) has no local
    // samples, but the stylus-in-groove noise is OUR turntable's, not theirs
    crackleBed(level) { bedMode = level != null; setCrackle(bedMode ? level : 0, 0.25); },
  });
})();
