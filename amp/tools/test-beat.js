// test-beat.js — drives amp's beat detector in plain node.
//
// The detector (createBeatDetector in src/frontend/vizhost.js) takes byte
// spectra and a clock, nothing else, so it runs headless against synthesized
// drum patterns: steady kicks, the same kicks at quarter volume, a fast track,
// a sloppy human one, a drone, and silence.
//
//   node tools/test-beat.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/frontend/vizhost.js'), 'utf8');
const w = {};
new Function('window', src)(w);
const mk = w.ampVizHost.createBeatDetector;

// A pretend unsmoothed analyser: 512 bins, decaying energy, noise floor,
// kicks in the low bins with some broadband thump.
function run({ bpm, seconds, gain = 1, jitter = 0 }) {
  const det = mk();
  const level = new Float32Array(512);
  const fd = new Uint8Array(512);
  const dt = 1 / 60;
  const period = 60 / bpm;
  let nextKick = 0.1;
  let beats = 0, maxPunch = 0, last = null;
  for (let t = 0; t < seconds; t += dt) {
    for (let i = 0; i < 512; i++) level[i] *= 0.55;
    for (let i = 1; i < 256; i++) level[i] = Math.max(level[i], 8 + Math.random() * 10);
    if (t >= nextKick) {
      nextKick += period + (Math.random() * 2 - 1) * jitter;
      for (let i = 1; i <= 8; i++) level[i] = Math.min(255, level[i] + 210 * gain);
      for (let i = 9; i < 120; i++) level[i] = Math.min(255, level[i] + 70 * gain);
    }
    for (let i = 0; i < 512; i++) fd[i] = level[i] | 0;
    last = det.update(fd, t);
    if (last.beat) beats++;
    if (last.punch > maxPunch) maxPunch = last.punch;
  }
  return { beats, maxPunch: +maxPunch.toFixed(2), bpm: last.bpm, confidence: +last.confidence.toFixed(2) };
}

function drone(seconds) {
  const det = mk();
  const fd = new Uint8Array(512).fill(200);
  let beats = 0;
  for (let t = 0; t < seconds; t += 1 / 60) if (det.update(fd, t).beat) beats++;
  return beats;
}
function silence(seconds) {
  const det = mk();
  const fd = new Uint8Array(512);
  let beats = 0, maxPunch = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    const r = det.update(fd, t);
    if (r.beat) beats++;
    if (r.punch > maxPunch) maxPunch = r.punch;
  }
  return { beats, maxPunch };
}

let fail = false;
const check = (name, cond, got) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + '   ' + got);
  if (!cond) fail = true;
};

{
  const r = run({ bpm: 120, seconds: 20 });                 // ~40 kicks
  console.log('120 BPM, 20 s:', JSON.stringify(r));
  check('finds most kicks', r.beats >= 34 && r.beats <= 46, r.beats + ' beats');
  check('tempo right', Math.abs(r.bpm - 120) <= 4, r.bpm + ' bpm');
  check('confident', r.confidence >= 0.4, 'confidence ' + r.confidence);
  check('punch spikes on kicks', r.maxPunch >= 0.15 && r.maxPunch <= 1, 'maxPunch ' + r.maxPunch);
}
{
  const r = run({ bpm: 120, seconds: 20, gain: 0.25 });     // the quiet mix
  console.log('same, quarter volume:', JSON.stringify(r));
  check('quiet kicks still beat', r.beats >= 30, r.beats + ' beats');
  check('quiet tempo right', Math.abs(r.bpm - 120) <= 4, r.bpm + ' bpm');
}
{
  const r = run({ bpm: 150, seconds: 20 });                 // ~50 kicks
  console.log('150 BPM, 20 s:', JSON.stringify(r));
  check('fast tempo right', Math.abs(r.bpm - 150) <= 5, r.bpm + ' bpm');
}
{
  const r = run({ bpm: 96, seconds: 20, jitter: 0.02 });    // a human drummer
  console.log('96 BPM ±20 ms:', JSON.stringify(r));
  check('sloppy tempo right', Math.abs(r.bpm - 96) <= 5, r.bpm + ' bpm');
}
{
  const b = drone(10);
  console.log('10 s drone:', b, 'beats');
  check('a drone is not a drum', b <= 2, b + ' beats');
}
{
  const r = silence(10);
  console.log('10 s silence:', JSON.stringify(r));
  check('silence is silent', r.beats === 0 && r.maxPunch < 0.05, r.beats + ' beats, punch ' + r.maxPunch);
}
// ── a whole kit: kick on 1 and 3, snare on 2 and 4, hats on the 8ths ────────
// Each drum lives in its own bins, so the per-band streams should separate
// them the way MilkDrop presets expect bass/mid/treb beats to separate.
function kit({ bpm, seconds, kick = true, snare = true, hat = true }) {
  const det = mk();
  const level = new Float32Array(512);
  const fd = new Uint8Array(512);
  const dt = 1 / 60;
  const beatLen = 60 / bpm;
  let nBeat = 0.1, nEighth = 0.1, count = 0;
  const got = { kick: 0, snare: 0, hat: 0 };
  const phaseErr = [];
  let sent = { kick: 0, snare: 0, hat: 0 };
  for (let t = 0; t < seconds; t += dt) {
    for (let i = 0; i < 512; i++) level[i] *= 0.5;
    for (let i = 1; i < 256; i++) level[i] = Math.max(level[i], 6 + Math.random() * 8);
    if (t >= nBeat) {
      nBeat += beatLen;
      const even = count % 2 === 0;
      count++;
      if (kick && even) { for (let i = 1; i <= 5; i++) level[i] = Math.min(255, level[i] + 220); sent.kick++; }
      if (snare && !even) {
        for (let i = 8; i <= 60; i++) level[i] = Math.min(255, level[i] + 140);
        for (let i = 61; i <= 90; i++) level[i] = Math.min(255, level[i] + 60);
        sent.snare++;
      }
    }
    if (t >= nEighth) {
      nEighth += beatLen / 2;
      if (hat) { for (let i = 100; i <= 240; i++) level[i] = Math.min(255, level[i] + 110); sent.hat++; }
    }
    for (let i = 0; i < 512; i++) fd[i] = level[i] | 0;
    const r = det.update(fd, t);
    if (r.kick) got.kick++;
    if (r.snare) got.snare++;
    if (r.hat) got.hat++;
    // after the tempo settles, note how far the PLL phase sits from a beat
    // at the moments beats actually land
    if (t > seconds / 2 && r.bpm > 0 && Math.abs(t - (nBeat - beatLen)) < dt) {
      const e = Math.abs(r.beatPhase - Math.round(r.beatPhase));
      phaseErr.push(e);
    }
  }
  const meanPhase = phaseErr.length ? phaseErr.reduce((x, y) => x + y) / phaseErr.length : 1;
  return { got, sent, meanPhase: +meanPhase.toFixed(3) };
}

{
  const r = kit({ bpm: 120, seconds: 20 });
  console.log('full kit at 120:', JSON.stringify(r));
  check('kicks separated', r.got.kick >= r.sent.kick * 0.7 && r.got.kick <= r.sent.kick * 1.4,
    r.got.kick + ' of ' + r.sent.kick);
  check('snares separated', r.got.snare >= r.sent.snare * 0.7 && r.got.snare <= r.sent.snare * 1.6,
    r.got.snare + ' of ' + r.sent.snare);
  check('hats separated', r.got.hat >= r.sent.hat * 0.7 && r.got.hat <= r.sent.hat * 1.3,
    r.got.hat + ' of ' + r.sent.hat);
  check('phase locks to the beat', r.meanPhase <= 0.15, 'mean error ' + r.meanPhase + ' of a beat');
}
{
  const r = kit({ bpm: 120, seconds: 15, kick: false, snare: false });  // hats alone
  console.log('hats only:', JSON.stringify(r.got));
  check('hats do not fake kicks', r.got.kick <= 2, r.got.kick + ' kicks from hats');
}
{
  const r = kit({ bpm: 120, seconds: 15, snare: false, hat: false });   // kicks alone
  console.log('kicks only:', JSON.stringify(r.got));
  check('kicks do not fake hats', r.got.hat <= 3, r.got.hat + ' hats from kicks');
}

// ── loudness must be perceptual, not flat: the same byte energy reads quieter
// when it is all in the bottom octaves ─────────────────────────────────────
{
  const det1 = mk(), det2 = mk();
  const bassOnly = new Uint8Array(512), midsOnly = new Uint8Array(512);
  for (let i = 1; i <= 4; i++) bassOnly[i] = 220;             // 880 units low
  for (let i = 20; i <= 23; i++) midsOnly[i] = 220;           // 880 units mid
  let l1 = 0, l2 = 0;
  for (let t = 0; t < 2; t += 1 / 60) {
    l1 = det1.update(bassOnly, t).loudness;
    l2 = det2.update(midsOnly, t).loudness;
  }
  console.log('loudness, same energy: bass-only ' + l1.toFixed(4) + ' vs mids ' + l2.toFixed(4));
  check('hearing-weighted', l2 > l1 * 2, 'mids read ' + (l2 / (l1 || 1e-9)).toFixed(1) + 'x louder');
}

console.log('');
console.log(fail ? 'FAILED' : 'the detector holds across volume, tempo, sloppiness, bands and phase');
process.exit(fail ? 1 : 0);
