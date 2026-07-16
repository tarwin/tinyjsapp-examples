// The page is one crow's costume — both bird windows load this same file.
// All behavior (where to walk, when to fly, whom to trust) lives in the
// backend, unchanged from kraa; this file just performs what it's told,
// except the puppet is now a skinned, animated GLB driven by three.js.
//
// Clip casting (the model ships seven):
//   idle → "look"      walk → "walk"       hop → middle of "run jump"
//   peck/eat → "eat"   preen → "clearing"  fly → "fly" (flap) / "glide"
// A cruising bird alternates flap-bursts with glides like the real thing;
// a scared one just hammers the flap. There is no caw clip, so the caw is
// procedural: the jaw bone hinges open and the neck throws back, layered
// on top of whatever the mixer said (bones are plain Object3Ds after
// mixer.update, so post-mixing them is fair game).

const $ = (id) => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);

// 'main' is Huginn; the second window ('r2') is Muninn, the bold one.
const me = tiny.win.id || 'main';
const muninn = me === 'r2';

let state = 'idle';
let dir = 1, fast = false, moving = false;
let look = { x: 0, y: 0 };          // where the backend says the bird is looking
let cawT = -10;                     // clock time the current caw started

// ------------------------------------------------------------------- stage

const W = 200;
const renderer = new THREE.WebGLRenderer({ canvas: $('cv'), antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(W, W);

const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
cam.position.set(0.34, 0.5, 1.1);            // gentle 3/4 view, a bit above
cam.lookAt(0, 0.15, 0);

// day-lit but soft — the bird lives over whatever wallpaper is behind it
const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x8a7a66, 1.5);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(1.5, 3, 2);
scene.add(key);
const rim = new THREE.DirectionalLight(0xaac4ff, 1.1);
rim.position.set(-2, 1.5, -1.5);
scene.add(rim);

// ONE sun for the whole flock, parked at a fixed screen spot way above the
// display. Each window aims its key light from the sun relative to its own
// position (the backend sends both), so as a bird crosses the screen its
// shading actually changes — the light isn't glued to the bird.
let sun = { x: 980, y: -520 };
let winPos = { x: 620, y: 400 };
const keyTarget = key.position.clone();
function aimSun() {
  const vx = sun.x - (winPos.x + 100);
  const vy = (winPos.y + 100) - sun.y;               // screen-down → world-up
  const len = Math.hypot(vx, vy) || 1;
  keyTarget.set((vx / len) * 4, (vy / len) * 4, 1.7); // a bit frontal so the
}                                                     // near side never goes black
tiny.api.on('env', (e) => { sun = e.sun; aimSun(); });

// a crow over a dark desktop needs a little more light to read
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
function applyShade() {
  const dark = darkMq.matches;
  hemi.intensity = dark ? 2.1 : 1.5;
  key.intensity = dark ? 2.7 : 2.2;
  rim.intensity = dark ? 1.6 : 1.1;
}
applyShade();
darkMq.addEventListener('change', applyShade);

// ------------------------------------------------------------------ puppet

let model = null, mixer = null, bones = {};
const rig = new THREE.Group();      // outer group: screen-space pitch (banking)
scene.add(rig);
const actions = {};
let current = null;                 // name of the playing action
let flapUntil = 0, glideUntil = 0;  // flight cadence clocks

const YAW = -Math.PI / 2;           // yaw that points the crow at screen-right

function play(name, { ts = 1, fade = 0.25 } = {}) {
  const next = actions[name];
  if (!next) return;
  next.timeScale = ts;
  if (current === name) return;
  next.reset().play();
  if (current && actions[current]) next.crossFadeFrom(actions[current], fade, false);
  current = name;
}

function setState(s) {
  const wasAirborne = state === 'fly' || state === 'land';
  state = s;
  document.body.dataset.state = s;
  // a bird coming off the wing snaps into its ground gait — long blends here
  // read as mushy hovering
  const fade = wasAirborne ? 0.08 : 0.25;
  if (s === 'idle') play('look', { fade });
  else if (s === 'walk') play('walk', { ts: 2.3, fade });
  else if (s === 'hop') play('hop', { ts: 1.6, fade: 0.12 });
  else if (s === 'peck') play('eat', { ts: 1.1, fade });
  else if (s === 'eat') play('eat', { ts: 1.3, fade });
  else if (s === 'preen') play('clearing');
  else if (s === 'caw') { play('look', { fade }); cawT = clock.elapsedTime; }
  else if (s === 'fly') { play('fly', { ts: fast ? 1.7 : 1.25, fade: 0.15 }); flapUntil = clock.elapsedTime + rnd(0.9, 1.6); }
  // touchdown goes STRAIGHT to standing — waiting out the flight clip reads
  // as floating; the backend's land state is only a few ticks of settling
  else if (s === 'land') play('look', { fade: 0.07 });
}

// Keep clips in place: the source actions carry root motion (run jump covers
// ground, eat wanders), but here the WINDOW is what moves — so pin every
// root bone's horizontal translation to its first keyframe, keep the bob.
function pinRootMotion(clip) {
  for (const tr of clip.tracks) {
    if (!/(RL_BoneRoot|RootNode_0|Pelvis)\.position$/.test(tr.name)) continue;
    const v = tr.values;
    for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
  }
}

const clock = new THREE.Clock();

const bin = Uint8Array.from(atob(CROW_GLB_B64), (c) => c.charCodeAt(0)).buffer;
new GLTFLoader().parse(bin, '', (gltf) => {
  model = gltf.scene;
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) o.frustumCulled = false;      // a flap must never clip out
  });
  // Muninn is a touch smaller with a warmer, browner sheen
  if (muninn) {
    model.scale.setScalar(0.88);
    model.traverse((o) => {
      if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.setHex(0xc9a685); }
    });
  }
  model.rotation.y = YAW;
  rig.add(model);

  mixer = new THREE.AnimationMixer(model);
  for (const clip of gltf.animations) {
    pinRootMotion(clip);
    actions[clip.name] = mixer.clipAction(clip);
  }
  // the hop is the airborne middle of "run jump"
  const rj = gltf.animations.find((a) => a.name === 'run jump');
  if (rj) actions.hop = mixer.clipAction(THREE.AnimationUtils.subclip(rj, 'hop', 22, 58, 60));

  setState(state);
  requestAnimationFrame(loop);
}, (e) => tiny.log('crow load failed: ' + e));

// ------------------------------------------------------------ frame-by-frame

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (!mixer) return;

  // a cruising flier alternates flap-bursts and glides; a scared one doesn't
  if (state === 'fly' && !fast) {
    if (current === 'fly' && t > flapUntil) { play('glide', { fade: 0.3 }); glideUntil = t + rnd(0.7, 1.4); }
    else if (current === 'glide' && t > glideUntil) { play('fly', { ts: 1.25, fade: 0.3 }); flapUntil = t + rnd(0.9, 1.6); }
  }

  mixer.update(dt);

  // face where the backend says — and when actually traveling, TURN into the
  // direction of travel. The look vector is the screen-space heading; treat
  // screen-down as toward the camera, so a bird walking down-right angles
  // toward you and one climbing away shows you its back. The toward-camera
  // component is capped: fully sideways the wingspan would overflow the
  // 200px window mid-flap.
  let wantYaw;
  const traveling = moving && (state === 'fly' || state === 'land' || state === 'walk' || state === 'hop');
  if (traveling && (look.x || look.y)) {
    const depth = state === 'walk' ? 0.55 : 0.45;
    wantYaw = Math.atan2(look.x || dir * 0.05, look.y * depth) + Math.PI;
  } else {
    wantYaw = dir > 0 ? YAW : -YAW;
  }
  // ease along the shortest arc (yaw wraps), then keep the angle bounded
  let dy = wantYaw - model.rotation.y;
  dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  model.rotation.y += dy * Math.min(1, dt * 7);
  if (model.rotation.y > Math.PI) model.rotation.y -= Math.PI * 2;
  else if (model.rotation.y < -Math.PI) model.rotation.y += Math.PI * 2;
  // a bird angled to/away from the camera spreads its wingspan across the
  // window — shrink it a touch as it turns off-profile so flaps stay inside
  const airborne = state === 'fly' || state === 'land';
  const off = Math.abs(Math.cos(model.rotation.y));
  const wantScale = 1 - off * (airborne ? 0.14 : 0.06);
  rig.scale.setScalar(rig.scale.x + (wantScale - rig.scale.x) * Math.min(1, dt * 5));
  // in the air, ride a little higher in the frame — a flap's downstroke
  // otherwise pokes the wingtip out the bottom of the window
  const wantLift = airborne ? 0.07 : 0;
  rig.position.y += (wantLift - rig.position.y) * Math.min(1, dt * 5);

  // drift the key light toward where the sun says it should be
  key.position.lerp(keyTarget, Math.min(1, dt * 3));
  // banking: pitch into climbs and dives on the wing. This happens on the
  // OUTER group, whose local Z is the screen axis — rotating the yawed model
  // itself would roll it instead.
  const wantTilt = state === 'fly' || state === 'land' ? -look.y * 0.5 * dir : 0;
  rig.rotation.z += (wantTilt - rig.rotation.z) * Math.min(1, dt * 5);

  // post-mix puppetry: the mixer has already posed every bone this frame,
  // so nudging them now layers on top of the clip
  // (this ActorCore-style rig hinges on local Z — X is pure bone twist)
  const neck = bones.Neck_TopSHJnt, head = bones.Head_TopSHJnt, jaw = bones.Head_JawSHJnt;
  const cawAge = t - cawT;
  if (state === 'caw' && cawAge < 1.0 && head && jaw) {
    // throw the head back and hinge the beak — a two-beat kraa-kraa envelope
    const shout = Math.max(0, Math.sin(cawAge * Math.PI * 2)) * (cawAge < 0.9 ? 1 : (1 - cawAge) * 10);
    head.rotateZ(0.28 * shout);
    if (neck) neck.rotateZ(0.12 * shout);
    jaw.rotateZ(-0.75 * shout);          // negative Z drops the lower mandible
  } else if (neck && head && (state === 'idle' || state === 'walk' || state === 'caw')) {
    // watching: tip the head toward whatever the backend says it clocked
    // (the body already faces it — dir flips the whole model; +Z is head-up)
    const pitch = -look.y * 0.4;
    neck.rotateZ(pitch * 0.7);
    head.rotateZ(pitch * 0.8);
  }

  renderer.render(scene, cam);
}

// ------------------------------------------------------------ backend cues

tiny.api.on('bird', (p) => { if (p.who === me) setState(p.state); });

tiny.api.on('look', (p) => {
  if (p.who !== me) return;
  look = { x: p.x, y: p.y };
  dir = p.dir;
  moving = p.moving;
  if (p.wx !== undefined) { winPos = { x: p.wx, y: p.wy }; aimSun(); }
  if (p.fast !== fast) {
    fast = p.fast;
    if (state === 'fly') play('fly', { ts: fast ? 1.7 : 1.25 });
  }
});

let sayT = null;
tiny.api.on('say', (p) => {
  if (p.who !== me) return;
  // Audible birds don't need subtitles — the bubble only shows when muted.
  if (p.vol) { playCaw(p.pan || 0, p.vol, p.text === '!'); return; }
  const b = $('bubble');
  b.textContent = p.text;
  b.classList.add('show');
  clearTimeout(sayT);
  sayT = setTimeout(() => b.classList.remove('show'), 1400);
});

// ------------------------------------------------------------------- voice

// One decoded caw, replayed through a fresh gain + stereo panner each time:
// the backend sends pan from the bird's x position on screen and a random
// volume, and a startled "!" plays sharper and higher than a proper kraa.
let actx = null, cawBuf = null;
function ensureAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const bytes = Uint8Array.from(atob(KRAA_MP3_B64), (c) => c.charCodeAt(0));
    actx.decodeAudioData(bytes.buffer).then((b) => { cawBuf = b; });
  }
  if (actx.state === 'suspended') actx.resume();
}
function playCaw(pan, vol, startled) {
  ensureAudio();
  if (!cawBuf) return;
  const src = actx.createBufferSource();
  src.buffer = cawBuf;
  src.playbackRate.value = (startled ? 1.3 : 1) * (0.92 + Math.random() * 0.16);
  const g = actx.createGain();
  g.gain.value = startled ? vol * 0.7 : vol;
  const p = actx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(g).connect(p).connect(actx.destination);
  src.start();
}

tiny.api.on('hearts', (p) => {
  if (p.who !== me) return;
  for (let i = 0; i < (p.n || 1); i++) {
    setTimeout(() => spawnHeart(92 + rnd(-24, 30), 62 + rnd(-10, 10), rnd(-18, 18)), i * 160);
  }
});

function spawnHeart(x, y, drift) {
  const el = document.createElement('span');
  el.className = 'heart';
  el.textContent = '♥';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.setProperty('--hx', drift + 'px');
  $('fx').appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// --------------------------------------------------------------- touching

// Clicks poke the bird — but only clicks that actually land on it. The
// backend decides whether that's a compliment or an ambush.
const caster = new THREE.Raycaster();
$('cv').addEventListener('click', (e) => {
  if (!model) return;
  const r = $('cv').getBoundingClientRect();
  caster.setFromCamera(new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  ), cam);
  if (caster.intersectObject(model, true).length) tiny.api.call('poke');
});

// Listeners are up — wake the brain (and prime the audio decoder so the
// first kraa isn't swallowed while the mp3 decodes).
tiny.api.call('boot').then((p) => {
  setState(p.state);
  if (p.env) { sun = p.env.sun; aimSun(); }
  ensureAudio();
});


