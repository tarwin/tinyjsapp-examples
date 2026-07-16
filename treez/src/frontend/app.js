// One hanging air freshener. The page owns everything that happens ON the
// string: a damped pendulum (sway, gusts, the breeze your cursor makes),
// the cardboard's little secondary flex, the drag (string bends with the
// lag, stretches past its length, then SNAPS), and the tumble afterwards —
// while the backend moves the window itself (drag easing, gravity).
//
// The tree is drawn once into an offscreen canvas per outfit (seven chunky
// outlined shapes off the gas-station spinner rack) and stamped rotated
// about its string hole every frame.

const W = 260, H = 420, DPR = 2;
const AX = W / 2, AY = -6;          // string anchor, just off the top edge
const me = tiny.win.id || 'main';

const cv = document.getElementById('cv');
const g2 = cv.getContext('2d');

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------- state

let cfg = null;                     // { design, name, scale, L, jit, phase }
let winPos = { x: 0, y: 0 };        // where my window sits on the screen
let sound = true;

let mode = 'off';                   // off | in | hang | drag | fall
let born = 0;                       // clock ms when the current tree arrived

// the pendulum
let th = 0, om = 0;                 // angle from straight-down, angular vel
let Lc = 0;                         // live string length (grows on the way in)
let bend = 0, bendV = 0;            // cardboard flex — a lagging second hinge

// the weather
let gust = 0;                       // shared, pushed by the backend
let breezeF = 0;                    // local cursor-breeze impulse, decays
let wind = { mx: -9999, my: -9999, vx: 0 };

// the grab
let drag = null;   // { sx, sy, offX, offY, lastTh, lastSX, hVel, strainN, sent }
let fall = null;   // { spin, spinV, t0, stub }

let wisps = [];                     // rising scent squiggles
let sparkle = null;                 // the magik
let nextWisp = 2000, nextSpark = 1200;

// ----------------------------------------------------------------- the art

// Chunky flat shapes with a fat dark outline, like the old website promised.
// Every draw() works in "tree units" (u): hole center at the origin, body
// hanging below it, roughly 150u tall and ±75u wide.

function pinePath(g, u, wmul, hmul) {
  const X = (v) => v * u * wmul, Y = (v) => v * u * hmul;
  g.beginPath();
  g.moveTo(0, Y(-8));
  g.lineTo(X(34), Y(34)); g.lineTo(X(17), Y(34));
  g.lineTo(X(50), Y(80)); g.lineTo(X(28), Y(80));
  g.lineTo(X(64), Y(126)); g.lineTo(X(9), Y(126));
  g.lineTo(X(9), Y(145)); g.lineTo(X(-9), Y(145)); g.lineTo(X(-9), Y(126));
  g.lineTo(X(-64), Y(126)); g.lineTo(X(-28), Y(80)); g.lineTo(X(-50), Y(80));
  g.lineTo(X(-17), Y(34)); g.lineTo(X(-34), Y(34));
  g.closePath();
}

// Overlapping circles, outlined cleanly: stroke every circle first, then
// fill every circle on top — the fills swallow the interior stroke lines.
function blobs(g, u, list, trunk) {
  const each = (fn) => {
    for (const [x, y, r] of list) {
      g.beginPath();
      g.arc(x * u, y * u, r * u, 0, Math.PI * 2);
      fn();
    }
    if (trunk) {
      g.beginPath();
      const [tx, ty, tw, thh] = trunk;
      g.rect((tx - tw / 2) * u, ty * u, tw * u, thh * u);
      fn();
    }
  };
  each(() => g.stroke());
  each(() => g.fill());
}

const DESIGNS = [
  { h: 137, s: 68, l: 38,   // Forest Fresh — the classic
    draw: (g, u) => { pinePath(g, u, 1, 1); g.stroke(); g.fill(); } },
  { h: 47, s: 88, l: 55,    // Vanillaroma — chubby yellow
    draw: (g, u) => blobs(g, u, [
      [0, 16, 25], [-27, 58, 22], [27, 58, 22], [0, 56, 26],
      [-22, 102, 26], [22, 102, 26], [0, 100, 30],
    ], [0, 124, 16, 18]) },
  { h: 4, s: 78, l: 50,     // Cherry Blast — starburst
    draw: (g, u) => {
      const cx0 = 0, cy0 = 74, pts = 13;
      g.beginPath();
      for (let i = 0; i < pts * 2; i++) {
        const a = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
        const wob = [1, 0.86, 1.08, 0.92, 1.02, 0.9][i % 6];
        const r = (i % 2 === 0 ? 82 : 40) * wob;
        const x = (cx0 + Math.sin(a) * r * 0.92) * u;
        const y = (cy0 + Math.cos(a) * -r) * u;
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.closePath(); g.stroke(); g.fill();
    } },
  { h: 275, s: 55, l: 55,   // Grape Ape — berry cluster
    draw: (g, u) => blobs(g, u, [
      [0, 14, 17],
      [-16, 44, 17], [16, 44, 17],
      [-30, 76, 17], [0, 74, 17], [30, 76, 17],
      [-16, 106, 17], [16, 106, 17],
      [0, 132, 16],
    ]) },
  { h: 330, s: 80, l: 72,   // Bubblegum — scalloped pink pine
    draw: (g, u) => blobs(g, u, [
      [0, 14, 19],
      [-18, 42, 17], [18, 42, 17], [0, 40, 16],
      [-36, 76, 19], [0, 74, 18], [36, 76, 19],
      [-48, 112, 21], [-16, 116, 19], [16, 116, 19], [48, 112, 21],
    ], [0, 130, 14, 16]) },
  { h: 205, s: 70, l: 52,   // Ocean Mist — spiky fuzz
    draw: (g, u) => {
      const cx0 = 0, cy0 = 74;
      const SPIKES = [ // [angle, length] — hand-shuffled so it reads as wild
        [-1.5, 74], [-1.18, 62], [-0.9, 78], [-0.62, 58], [-0.34, 72],
        [-0.1, 66], [0.1, 80], [0.38, 60], [0.64, 74], [0.9, 58],
        [1.2, 70], [1.5, 76], [1.82, 60], [2.1, 72], [2.42, 62],
        [2.7, 78], [2.98, 58], [-3.1, 68], [-2.8, 74], [-2.5, 58],
        [-2.2, 76], [-1.9, 62],
      ];
      for (const [a, len] of SPIKES) {
        g.beginPath();
        const bx = cx0 + Math.sin(a) * 20, by = cy0 - Math.cos(a) * 20;
        g.moveTo((bx + Math.cos(a) * 7) * u, (by + Math.sin(a) * 7) * u);
        g.lineTo((cx0 + Math.sin(a) * len) * u, (cy0 - Math.cos(a) * len) * u);
        g.lineTo((bx - Math.cos(a) * 7) * u, (by - Math.sin(a) * 7) * u);
        g.closePath(); g.stroke(); g.fill();
      }
      g.beginPath(); g.arc(0, cy0 * u, 34 * u, 0, Math.PI * 2);
      g.stroke(); g.fill();
    } },
  { h: 33, s: 78, l: 50,    // New Car Smell — squat amber pine
    draw: (g, u) => { pinePath(g, u, 1.18, 0.82); g.stroke(); g.fill(); } },
];

let off = null, offKX = 0, offKY = 0;   // the stamped tree + its hole point

function buildTree() {
  const d = DESIGNS[cfg.design];
  const u = cfg.scale * DPR;
  const hue = d.h + cfg.jit;
  off = document.createElement('canvas');
  off.width = Math.ceil(196 * u);
  off.height = Math.ceil(196 * u);
  offKX = off.width / 2;
  offKY = 18 * u;
  const g = off.getContext('2d');
  g.translate(offKX, offKY);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = 5 * u;
  g.fillStyle = `hsl(${hue}, ${d.s}%, ${d.l}%)`;
  g.strokeStyle = `hsl(${hue}, ${Math.round(d.s * 0.9)}%, ${Math.round(d.l * 0.34)}%)`;
  d.draw(g, u);
  // a soft sheen down the left, like lacquered cardboard in the sun
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.rotate(-0.35);
  g.beginPath();
  g.ellipse(-26 * u, 66 * u, 13 * u, 52 * u, 0, 0, Math.PI * 2);
  g.fillStyle = `hsla(${hue}, ${d.s}%, 94%, 0.28)`;
  g.fill();
  g.restore();
  // the punched string hole with its little reinforcement ring
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(0, 0, 3.4 * u, 0, Math.PI * 2); g.fill();
  g.restore();
  g.beginPath(); g.arc(0, 0, 5.6 * u, 0, Math.PI * 2);
  g.lineWidth = 3.4 * u;
  g.strokeStyle = 'rgba(252, 250, 242, 0.95)';
  g.stroke();
  g.beginPath(); g.arc(0, 0, 7.6 * u, 0, Math.PI * 2);
  g.lineWidth = 1.6 * u;
  g.strokeStyle = 'rgba(60, 50, 35, 0.55)';
  g.stroke();
}

// ----------------------------------------------------------------- weather

tiny.api.on('wind', (p) => {
  gust = p.g;
  wind = p;
  if (mode !== 'hang') return;
  // the breeze your cursor makes: horizontal speed, felt by distance
  const kx = winPos.x + AX + Math.sin(th) * Lc;
  const ky = winPos.y + AY + Math.cos(th) * Lc + 60 * cfg.scale;
  const d = Math.hypot(p.mx - kx, p.my - ky);
  const f = p.vx * Math.exp(-((d / 240) ** 2)) * 30;
  if (Math.abs(f) > Math.abs(breezeF)) breezeF = clamp(f, -420, 420);
});

// ------------------------------------------------------------------ sounds

let actx = null;
function ac() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}

// the new one bounces on its string — a little rubbery boing
function sndBoing() {
  if (!sound) return;
  try {
    const c = ac(), t0 = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(300, t0);
    o.frequency.exponentialRampToValueAtTime(150, t0 + 0.32);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + 0.36);
  } catch (e) {}
}

// stretching cardboard-and-string: nervous little creak ticks
let lastCreak = 0;
function sndCreak(strain) {
  if (!sound) return;
  const now = performance.now();
  if (now - lastCreak < 90 - strain * 40) return;
  lastCreak = now;
  try {
    const c = ac(), t0 = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square';
    o.frequency.value = 70 + strain * 260 + Math.random() * 30;
    g.gain.setValueAtTime(0.028, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + 0.05);
  } catch (e) {}
}

// the string gives way: a snip of noise and a sad downward pluck
function sndSnap() {
  if (!sound) return;
  try {
    const c = ac(), t0 = c.currentTime;
    const len = Math.floor(c.sampleRate * 0.07);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 1.4;
    const ng = c.createGain(); ng.gain.value = 0.3;
    src.connect(bp).connect(ng).connect(c.destination);
    src.start(t0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(330, t0);
    o.frequency.exponentialRampToValueAtTime(65, t0 + 0.26);
    g.gain.setValueAtTime(0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + 0.32);
  } catch (e) {}
}

// ------------------------------------------------------------------- grab

const knotPos = () => ({ x: AX + Math.sin(th) * Lc, y: AY + Math.cos(th) * Lc });

// mouse → the tree's own (rotated) frame, for an honest hit test
function overCardboard(mx, my) {
  const k = knotPos();
  const dx = mx - k.x, dy = my - k.y;
  const c = Math.cos(-(th + bend)), s = Math.sin(-(th + bend));
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) < 82 * cfg.scale && ly > -12 * cfg.scale && ly < 160 * cfg.scale;
}

cv.addEventListener('mousedown', (e) => {
  if (mode !== 'hang' || !overCardboard(e.clientX, e.clientY)) return;
  const k = knotPos();
  drag = {
    sx: e.screenX, sy: e.screenY,
    offX: e.clientX - k.x, offY: e.clientY - k.y,
    lastTh: th, lastSX: e.screenX, hVel: 0,
    strainN: 0, sent: 0,
  };
  mode = 'drag';
  document.body.className = 'grabbing';
  tiny.api.call('drag', { phase: 'start', sx: e.screenX, sy: e.screenY });
});

document.addEventListener('mousemove', (e) => {
  if (mode === 'drag' && drag) {
    drag.hVel = drag.hVel * 0.7 + (e.screenX - drag.lastSX) * 0.3;
    drag.lastSX = e.screenX;
    drag.sx = e.screenX;
    drag.sy = e.screenY;
    const now = performance.now();
    if (now - drag.sent > 33) {
      drag.sent = now;
      tiny.api.call('drag', { phase: 'move', sx: e.screenX, sy: e.screenY });
    }
  } else if (mode === 'hang') {
    document.body.className = overCardboard(e.clientX, e.clientY) ? 'grab' : '';
  }
});

document.addEventListener('mouseup', () => {
  if (mode !== 'drag' || !drag) return;
  tiny.api.call('drag', { phase: 'end' });
  // hand the pendulum back with the swing the hand gave it
  om = clamp((th - drag.lastTh) * 14 + drag.hVel * 0.012, -9, 9);
  drag = null;
  mode = 'hang';
  document.body.className = '';
});

// pull down too far and that's that
function doSnap(fromDrag) {
  const vx = fromDrag && drag ? clamp(drag.hVel * 0.35, -14, 14) : rnd(-3, 3);
  fall = {
    t0: performance.now(),
    spin: 0,
    spinV: clamp(om * 0.5, -3, 3) + vx * 0.14 + rnd(-0.8, 0.8),
    stub: 1,
  };
  if (fromDrag) tiny.api.call('snap', { vx });
  drag = null;
  mode = 'fall';
  document.body.className = '';
  sndSnap();
}

tiny.api.on('cut', (p) => {
  if (p.who !== me || mode === 'fall' || mode === 'off') return;
  doSnap(false);
});

// ------------------------------------------------------------------ pushes

function dressUp(c, x, y) {
  cfg = c;
  winPos = { x, y };
  buildTree();
  th = rnd(-0.06, 0.06);
  om = 0; bend = 0; bendV = 0;
  Lc = 0;
  fall = null; drag = null;
  wisps = []; sparkle = null;
  mode = 'in';
  born = performance.now();
  sndBoing();
}

tiny.api.on('tree', (p) => { if (p.who === me) dressUp(p.cfg, p.x, p.y); });
tiny.api.on('wpos', (p) => { if (p.who === me) winPos = { x: p.x, y: p.y }; });
tiny.api.on('opts', (p) => { sound = !!p.sound; });

// ------------------------------------------------------------------- render

function drawString(k, opt) {
  // two-pass string: a dark shadow line with a pale core, visible on any
  // desktop. Slack sags, motion bows it, tension pulls it straight and thin.
  const { slack = 0, bow = 0, tense = 0, shake = 0 } = opt || {};
  const mx = (AX + k.x) / 2 + bow, my = (AY + k.y) / 2 + slack;
  const wob = shake ? Math.sin(performance.now() * 0.09) * shake : 0;
  g2.beginPath();
  g2.moveTo(AX, AY);
  g2.quadraticCurveTo(mx + wob, my, k.x, k.y);
  g2.lineCap = 'round';
  g2.lineWidth = Math.max(1.2, 3 - tense * 1.6);
  g2.strokeStyle = 'rgba(48, 40, 28, 0.85)';
  g2.stroke();
  g2.lineWidth = Math.max(0.6, 1.5 - tense * 0.8);
  g2.strokeStyle = 'rgba(238, 230, 212, 0.9)';
  g2.stroke();
}

function drawTree(k, rot) {
  g2.save();
  g2.translate(k.x, k.y);
  g2.rotate(rot);
  // the loop of string through the hole
  g2.beginPath();
  g2.arc(0, -1.5, 4.5, 0, Math.PI * 2);
  g2.lineWidth = 2;
  g2.strokeStyle = 'rgba(238, 230, 212, 0.9)';
  g2.stroke();
  g2.drawImage(off, -offKX / DPR, -offKY / DPR, off.width / DPR, off.height / DPR);
  g2.restore();
}

function drawWisps(now, k) {
  wisps = wisps.filter((w) => now - w.t0 < 2400);
  for (const w of wisps) {
    const p = (now - w.t0) / 2400;
    const a = Math.sin(p * Math.PI) * 0.3;
    g2.save();
    g2.globalAlpha = a;
    g2.strokeStyle = '#fff';
    g2.lineWidth = 1.6;
    g2.beginPath();
    const x0 = k.x + w.dx, y0 = k.y - 6 - p * 46;
    g2.moveTo(x0, y0);
    for (let i = 1; i <= 4; i++) {
      g2.lineTo(x0 + Math.sin(p * 9 + i * 1.9 + w.dx) * 4, y0 - i * 7);
    }
    g2.stroke();
    g2.restore();
  }
  if (mode === 'hang' && now > nextWisp) {
    nextWisp = now + rnd(7000, 16000);
    wisps.push({ t0: now, dx: rnd(-30, 30) * cfg.scale });
    if (Math.random() < 0.6) wisps.push({ t0: now + 300, dx: rnd(-30, 30) * cfg.scale });
  }
}

function drawSparkle(now, k, rot) {
  if (!sparkle && mode === 'hang' && now > nextSpark) {
    nextSpark = now + rnd(2600, 6200);
    const a = rnd(0, Math.PI * 2), r = rnd(20, 66) * cfg.scale;
    sparkle = { t0: now, x: Math.sin(a) * r * 0.9, y: 70 * cfg.scale + Math.cos(a) * r };
  }
  if (!sparkle) return;
  const p = (now - sparkle.t0) / 700;
  if (p >= 1) { sparkle = null; return; }
  const a = Math.sin(p * Math.PI);
  const r = 3 + a * 3;
  g2.save();
  g2.translate(k.x, k.y);
  g2.rotate(rot);
  g2.translate(sparkle.x, sparkle.y);
  g2.rotate(p * 0.9);
  g2.globalAlpha = a * 0.85;
  g2.strokeStyle = '#fff';
  g2.lineWidth = 1.5;
  g2.beginPath();
  g2.moveTo(-r, 0); g2.lineTo(r, 0);
  g2.moveTo(0, -r); g2.lineTo(0, r);
  g2.stroke();
  g2.restore();
}

// -------------------------------------------------------------------- loop

const easeOutElastic = (p) =>
  p >= 1 ? 1 : 1 - Math.pow(2, -9 * p) * Math.cos(p * 9.5);

let lastT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = clamp((now - lastT) / 1000, 0.001, 0.045);
  lastT = now;
  if (mode === 'off' || !cfg) return;

  g2.setTransform(DPR, 0, 0, DPR, 0, 0);
  g2.clearRect(0, 0, W, H);

  if (mode === 'in') {
    // fresh out of the pack: the string pays out and the tree bounces at
    // the bottom like it means it
    const p = (now - born) / 1100;
    Lc = cfg.L * easeOutElastic(Math.min(1, p));
    if (p >= 1.25) { Lc = cfg.L; mode = 'hang'; }
    const k = knotPos();
    drawString(k, { slack: 0 });
    drawTree(k, th + bend);
  } else if (mode === 'hang') {
    // the pendulum: gravity, damping, and three winds — the shared gust
    // (own phase), a private flutter, and whatever your cursor stirred up
    const n1 = Math.sin(now * 0.00093 + cfg.phase * 1.7);
    const n2 = Math.sin(now * 0.00047 + cfg.phase * 3.1);
    const ambient = gust * 30 * (0.72 + 0.28 * n1) + n1 * n2 * 10;
    breezeF *= Math.pow(0.06, dt);            // the gust your hand made fades
    const windF = ambient + breezeF;
    const acc = (-1150 / cfg.L) * Math.sin(th) - 0.9 * om + (windF / cfg.L) * Math.cos(th);
    om += acc * dt;
    th += om * dt;
    // cardboard flex: a floppy second hinge chasing the swing
    const bendT = clamp(-om * 0.11, -0.28, 0.28);
    bendV += ((bendT - bend) * 90 - bendV * 9) * dt;
    bend += bendV * dt;
    Lc = cfg.L;
    const k = knotPos();
    drawString(k, { bow: clamp(-om * cfg.L * 0.07, -10, 10) });
    drawTree(k, th + bend);
    drawWisps(now, k);
    drawSparkle(now, k, th + bend);
  } else if (mode === 'drag') {
    // the knot chases the hand; the string tells the story of the distance
    const lx = drag.sx - winPos.x - drag.offX;
    const ly = drag.sy - winPos.y - drag.offY;
    const vx = lx - AX, vy = ly - AY;
    const dist = Math.hypot(vx, vy) || 1;
    const stretch = dist / cfg.L;
    let k;
    if (stretch <= 1) {
      k = { x: lx, y: ly };
      th = Math.atan2(vx, vy);
      Lc = dist;
      drawString(k, {
        slack: (1 - stretch) * cfg.L * 0.55,
        bow: clamp((AX - lx) * 0.2, -22, 22),
      });
    } else {
      // past its length: the string straightens, thins, gives a little —
      // the cardboard lags behind your hand like it's really being pulled
      const give = cfg.L + (dist - cfg.L) * 0.55;
      k = { x: AX + (vx / dist) * give, y: AY + (vy / dist) * give };
      th = Math.atan2(vx, vy);
      Lc = give;
      const strain = Math.min((stretch - 1) / 0.5, 1);
      drawString(k, { tense: strain, shake: strain > 0.55 ? strain * 1.6 : 0 });
      if (strain > 0.45) sndCreak(strain);
      // pulled DOWN too far → the fibers give out (a few frames of grace
      // so a fast yank sideways can whip through without tearing)
      if (stretch > 1.5 && vy > cfg.L * 0.35) {
        if (++drag.strainN >= 3) { doSnap(true); return; }
      } else drag.strainN = 0;
    }
    const bendT = clamp((AX - lx) * 0.004, -0.3, 0.3);
    bend += (bendT - bend) * (1 - Math.pow(0.001, dt));
    om = om * 0.8 + ((th - drag.lastTh) / Math.max(dt, 0.008)) * 0.2;
    drag.lastTh = th;
    drawTree(k, th + bend);
  } else if (mode === 'fall') {
    // the backend is dropping the WINDOW; in here the tree just tumbles in
    // place and the two ends of the broken string do their brief drama
    fall.spinV *= Math.pow(0.75, dt);
    fall.spin += fall.spinV * dt * 6;
    const age = (now - fall.t0) / 1000;
    const k = knotPos();
    if (age < 0.5) {
      // the anchor-side stub whips back and fades
      const wh = Math.sin(age * 26) * Math.exp(-age * 6) * 30;
      g2.save();
      g2.globalAlpha = 1 - age * 2;
      g2.beginPath();
      g2.moveTo(AX, AY);
      g2.quadraticCurveTo(AX + wh, AY + Lc * 0.16, AX + wh * 0.4, AY + Lc * 0.28);
      g2.lineWidth = 2.6;
      g2.strokeStyle = 'rgba(48, 40, 28, 0.85)';
      g2.stroke();
      g2.lineWidth = 1.3;
      g2.strokeStyle = 'rgba(238, 230, 212, 0.9)';
      g2.stroke();
      g2.restore();
    }
    g2.save();
    g2.translate(k.x, k.y);
    g2.rotate(th + bend + fall.spin);
    // its own sad little end of string, flapping upward
    const flap = Math.sin(now * 0.02) * 6;
    g2.beginPath();
    g2.moveTo(0, 0);
    g2.quadraticCurveTo(flap, -10, flap * 0.6, -17);
    g2.lineWidth = 2;
    g2.strokeStyle = 'rgba(238, 230, 212, 0.9)';
    g2.stroke();
    g2.drawImage(off, -offKX / DPR, -offKY / DPR, off.width / DPR, off.height / DPR);
    g2.restore();
  }
}

// -------------------------------------------------------------------- boot

tiny.api.call('boot', {}).then((r) => {
  sound = !!r.sound;
  if (r.active && r.cfg) dressUp(r.cfg, r.x, r.y);
  requestAnimationFrame(loop);
});
