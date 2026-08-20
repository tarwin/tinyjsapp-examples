// test-ribbon.js — plays src/viz/ribbon/index.js without amp.
//
// A visualizer plugin is one file with no imports and no DOM, so it runs in
// plain node with a stub canvas. That makes a game testable: this drives the
// real physics and the real collision code, tries every move against every
// obstacle, plays a whole course correctly, and checks that a machine-gun beat
// still comes out playable.
//
//   node tools/test-ribbon.js src/viz/ribbon/index.js

// obstacles can actually be played back to back, and whether the spacing rule
// really culls a machine-gun beat.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const texts = [];
const saved = [];
const ampApi = { register: (d) => { ampApi.def = d; }, save: (v) => saved.push(String(v)),
  log: () => {}, osd: () => {} };
const ctxProxy = new Proxy({}, { get: (t, k) => {
  if (k === 'fillText') return (s) => texts.push(String(s));
  if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
  if (k === 'measureText') return () => ({ width: 10 });
  return () => {};
}, set: () => true });
const canvas = { width: 900, height: 500, getContext: () => ctxProxy };
new Function('amp', src)(ampApi);

const FFT = new Uint8Array(256), WAVE = new Uint8Array(1024).fill(128);
const base = () => ({ fft: FFT, wave: WAVE, bass: 0, mid: 0, treb: 0, level: 0, peak: 0,
  punch: 0, beat: false, beatIndex: 0, bpm: 0, since: 9, playing: true, elapsed: 0, duration: 300 });
const SEED = {
  block:  { bass: 0.5, mid: 0.1, treb: 0.1, punch: 0.05, level: 0.2 },
  wall:   { bass: 0.7, mid: 0.1, treb: 0.1, punch: 0.50, level: 0.5 },
  bar:    { bass: 0.1, mid: 0.5, treb: 0.2, punch: 0.05, level: 0.2 },
  tunnel: { bass: 0.1, mid: 0.6, treb: 0.5, punch: 0.50, level: 0.5 },
};
const LEAD = 1.45;
// how far before arrival each move must start, and what keys it needs
const PLAY = {
  block:  [[0.22, 'down', 'ArrowUp']],
  wall:   [[0.44, 'down', 'ArrowUp'], [0.22, 'down', 'ArrowUp']],
  bar:    [[0.12, 'down', 'ArrowDown']],
  tunnel: [[0.39, 'down', 'ArrowDown'], [0.35, 'down', 'ArrowDown']],
};

async function play(sequence, spacing, bot, opts = {}) {
  texts.length = 0;
  saved.length = 0;
  const inst = await ampApi.def.create({ canvas, backend: '2d', hdr: false,
    width: 900, height: 500, dpr: 1, state: opts.state || null });
  inst.resize(900, 500);
  const audio = base();
  const dt = 1 / 60;
  const events = [];
  // botFor limits the bot to the first N obstacles — the rest are ignored,
  // which is how the health tests get some hits on purpose
  const botFor = opts.botFor != null ? opts.botFor : (bot ? Infinity : 0);
  let s = 0, next = 0, i = 0, stopAt = Infinity;
  const end = spacing * sequence.length + LEAD + 1.2;
  while (s < end) {
    audio.beat = false;
    // the track "ends" one frame AFTER the last beat, or the game never sees
    // that beat as part of a playing track and the final obstacle vanishes
    if (s >= stopAt) audio.playing = false;
    if (i < sequence.length && s >= next) {
      Object.assign(audio, SEED[sequence[i]], { beat: true });
      if (i < botFor) for (const [lead, ty, key] of PLAY[sequence[i]])
        events.push([s + LEAD - lead, ty, key]);
      i++; next += spacing;
      if (i >= sequence.length) stopAt = s + 2 / 60;
    }
    while (events.length && s >= events[0][0]) {
      const [, ty, key] = events.shift();
      inst.input({ type: ty, key, repeat: false });
    }
    inst.frame({ audio, dt, t: s });
    s += dt;
  }
  const hitLine = texts.filter((x) => x.includes('hit ')).pop() || '';
  const m = /hit (\d+)/.exec(hitLine);
  const scoreLine = texts.filter((x) => /^\d{6}$/.test(x)).pop() || '000000';
  const allLine = texts.filter((x) => /^all \d+$/.test(x)).pop() || '';
  const hearts = texts.filter((x) => /[♥♡]/.test(x)).pop() || '';
  return { hits: m ? +m[1] : 0, score: parseInt(scoreLine, 10),
    bestAll: allLine ? +allLine.slice(4) : 0, hearts,
    lastSaved: saved.length ? saved[saved.length - 1] : '' };
}

// how each single obstacle is answered, as seconds since it spawned
const SOLO = {
  none:   [],
  jump:   [[1.23, 'down', 'ArrowUp']],
  double: [[1.01, 'down', 'ArrowUp'], [1.23, 'down', 'ArrowUp']],
  duck:   [[1.33, 'down', 'ArrowDown']],
  slide:  [[1.06, 'down', 'ArrowDown'], [1.10, 'down', 'ArrowDown']],
};
async function solo(type, move) {
  texts.length = 0;
  const inst = await ampApi.def.create({ canvas, backend: '2d', hdr: false,
    width: 900, height: 500, dpr: 1, state: null });
  inst.resize(900, 500);
  const audio = base();
  const dt = 1 / 60;
  const script = SOLO[move].slice();
  Object.assign(audio, SEED[type], { beat: true });
  inst.frame({ audio, dt, t: 0 });
  Object.assign(audio, { beat: false, playing: false });
  let s = dt;
  while (s < 2.2) {
    while (script.length && s >= script[0][0]) {
      const [, ty, key] = script.shift();
      inst.input({ type: ty, key, repeat: false });
    }
    inst.frame({ audio, dt, t: s });
    s += dt;
  }
  const hit = (texts.filter((x) => x.includes('hit ')).pop() || '').includes('hit ');
  const score = parseInt(texts.filter((x) => /^\d{6}$/.test(x)).pop() || '0', 10);
  return !hit && score > 0;
}

(async () => {
  let fail = false;
  // every move against every obstacle
  const RIGHT = { block: 'jump', wall: 'double', bar: 'duck', tunnel: 'slide' };
  // The duck and the slide differ on two axes, so neither covers the other:
  // the duck is lower but brief, the slide is longer but higher.
  const ALSO_OK = {};
  const moves = ['none', 'jump', 'double', 'duck', 'slide'];
  console.log('            ' + moves.map((m) => m.padEnd(8)).join(''));
  for (const ty of Object.keys(RIGHT)) {
    let row = ty.padEnd(12);
    for (const mv of moves) {
      const cleared = await solo(ty, mv);
      row += (cleared ? 'clear' : 'HIT').padEnd(8);
      const should = mv === RIGHT[ty] || (ALSO_OK[ty] || []).indexOf(mv) >= 0;
      if (should !== cleared) { fail = true; row += '<- wrong '; }
    }
    console.log(row);
  }
  console.log('');
  // which type does the bot fumble?
  for (const ty of ['block', 'wall', 'bar', 'tunnel']) {
    const one = await play([ty, ty, ty], 1.1, true);
    console.log('  three ' + ty.padEnd(7) + ' played correctly: hits ' + one.hits + ', score ' + one.score);
  }
  console.log('');
  // 1. a real run, played correctly
  const course = ['block', 'bar', 'block', 'wall', 'bar', 'tunnel', 'block', 'wall', 'bar', 'block'];
  const r = await play(course, 0.9, true);
  console.log('perfect run of ' + course.length + ':  hits ' + r.hits + '   score ' + r.score);
  if (r.hits !== 0) { console.log('  PROBLEM: a correctly played course should never be hit'); fail = true; }
  if (r.score !== 520) { console.log('  PROBLEM: a clean 10-course scores 520, got ' + r.score); fail = true; }

  // 2. the same course, ignored
  const idle = await play(course, 0.9, false);
  console.log('same course, no input:  hits ' + idle.hits);
  if (idle.hits !== course.length) { console.log('  PROBLEM: every ignored obstacle should hit, got ' + idle.hits); fail = true; }

  // 3. a machine-gun beat must be culled to something playable
  const spam = new Array(48).fill('block');
  const dense = await play(spam, 0.08, false);
  const seconds = 0.08 * spam.length;
  const cap = Math.ceil(seconds / 0.5) + 2;
  console.log('48 beats in ' + seconds.toFixed(1) + 's -> ' + dense.hits + ' obstacles (cap ' + cap + ')');
  if (dense.hits > cap) { console.log('  PROBLEM: the spacing rule is not culling'); fail = true; }

  // ── health: three hits wipe the score, and the bests survive the wipe ────
  {
    const r = await play(['block', 'block', 'bar', 'bar', 'bar'], 1.1, true, { botFor: 2 });
    console.log('play 2, eat 3:  hits ' + r.hits + '   score ' + r.score
      + '   all-time ' + r.bestAll + '   hearts ' + r.hearts);
    if (r.hits !== 3) { console.log('  PROBLEM: expected exactly 3 hits'); fail = true; }
    if (r.score !== 0) { console.log('  PROBLEM: three hearts gone should wipe the score'); fail = true; }
    if (r.bestAll !== 30) { console.log('  PROBLEM: the best should be banked BEFORE the wipe'); fail = true; }
    if (r.hearts !== '♥♥♥') { console.log('  PROBLEM: hearts should refill after a wipe'); fail = true; }
    if (!/"bestAll":30/.test(r.lastSaved)) { console.log('  PROBLEM: bestAll never reached amp.save'); fail = true; }
  }
  // ── variety: a monotone track still changes the question ────────────────
  {
    const r = await play(new Array(8).fill('block'), 1.1, true);
    console.log('8 identical beats, bot plays jump every time:  hits ' + r.hits);
    if (r.hits < 1 || r.hits > 3) {
      console.log('  PROBLEM: after three of the same, the fourth should differ (expected 1-3 hits)');
      fail = true;
    }
  }
  // ── the save round-trips: an old save loads, and folds into the all-time ─
  {
    const r = await play([], 1, false, { state: '{"best":{"someTrack":77},"runs":4}' });
    console.log('loaded an old save with best 77:  all-time shows ' + r.bestAll);
    if (r.bestAll !== 77) { console.log('  PROBLEM: an old save should fold into the all-time best'); fail = true; }
  }

  console.log('');
  console.log(fail ? 'FAILED' : 'the course plays, health and bests hold, and a monotone track still varies');
  process.exit(fail ? 1 : 0);
})();
