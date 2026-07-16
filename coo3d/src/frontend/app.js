// The page is one pigeon's costume — every pigeon window loads this same
// file. All behavior (where to waddle, whom to pair with, when to poop)
// lives in the backend; this file performs what it's told with a skinned,
// animated GLB driven by three.js.
//
// Clip casting (the model ships eleven — no faking required this time):
//   idle → "Idle"/"IdleLoop"   walk → "Walk"     peck/eat → "Peck"
//   coo → "Cooing"             circle → "Circle" (root rotation kept — the
//   strut turns in place)      loaf → slow "IdleLoop"
//   fly → real "TakeOff" once, then "FlyLoop"     land → real "Land"
//   idle sometimes opens with a "Left"/"Right" wing-shuffle flourish.
// The poop squat is the one procedural bit: after mixer.update poses the
// skeleton, the tail bone lifts and the hips tip forward on an envelope
// (this rig hinges on local Z; found by screenshot grid, same as kraa3d).

const $ = (id) => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);

const me = tiny.win.id || 'main';
const idx = me === 'main' ? 0 : Math.max(0, parseInt(me.slice(1), 10) || 0);

// nobody's plumage matches: tints cycle, size jitters deterministically
const TINT = [0, 0x9096a3, 0xc2a78f, 0xdcdfe4, 0x71767f,
              0xa8988a, 0x848b99, 0xcfc9bd, 0x99856f, 0x5f646e][idx % 10];
const SIZE = 1 + (((idx * 37) % 15) - 7) / 100;

let state = 'idle';
let shine = null;                   // special coat, if the backend rolled one
let dir = 1, fast = false, moving = false;
let look = { x: 0, y: 0 };          // where the backend says the bird is looking
let poopT = -10;                    // clock time the current squat started

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

// a pigeon over a dark desktop needs a little more light to read
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

// The contact shadow lives IN the scene: a radial-gradient blob on a ground
// plane, glued to the hip bone's world x/z every frame — so it stays under
// the feet through pecks, struts, and turns (a fixed CSS blob didn't).
const shadow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(10, 12, 28, 0.55)');
  g.addColorStop(0.55, 'rgba(10, 12, 28, 0.28)');
  g.addColorStop(1, 'rgba(10, 12, 28, 0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.26),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  m.renderOrder = -1;
  scene.add(m);
  return m;
})();
const hipPos = new THREE.Vector3();
const actions = {};
let current = null;                 // name of the playing action
let rainbowMats = [];               // materials that cycle hue (the rare one)

// SPECIAL coats, shiny-Pokémon rare (the backend rolls them per launch):
// real metalness needs something to reflect, so a special bird also gets a
// tiny canvas-painted equirect environment — sky, ground, one hot sun blob.
// bare = drop the feather texture (it multiplies a metal down to mud)
const SHINES = {
  gold:    { color: 0xf2c14e, metal: 1, rough: 0.24, bare: true },
  silver:  { color: 0xe8edf4, metal: 1, rough: 0.18, bare: true },
  bronze:  { color: 0xc98a4b, metal: 1, rough: 0.3, bare: true },
  blue:    { color: 0x3d7df2, metal: 0.55, rough: 0.26, glow: 0.22 },
  red:     { color: 0xe04438, metal: 0.55, rough: 0.26, glow: 0.22 },
  rainbow: { color: 0xffffff, metal: 0.85, rough: 0.22, bare: true, cycle: true },
};

function envTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, '#eaf2ff');
  g.addColorStop(0.5, '#9fb6d8');
  g.addColorStop(0.55, '#6b5f4e');
  g.addColorStop(1, '#3d382f');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 32);
  x.fillStyle = '#ffffff';
  x.beginPath(); x.arc(44, 6, 5, 0, Math.PI * 2); x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function applyShine(name) {
  const s = SHINES[name];
  if (!s || !model) return;
  scene.environment = envTexture();
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const m = o.material.clone();
    m.color.setHex(s.color);
    m.metalness = s.metal;
    m.roughness = s.rough;
    m.envMapIntensity = 1.6;
    if (s.bare) m.map = null;
    if (s.glow) { m.emissive.setHex(s.color); m.emissiveIntensity = s.glow; }
    o.material = m;
    if (s.cycle) { m.emissive.setHex(0xffffff); m.emissiveIntensity = 0.12; rainbowMats.push(m); }
  });
}

const YAW = Math.PI / 2;            // yaw that points the pigeon at screen-right
                                    // (this rig's forward is +Z — the crow's was -Z)

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
  if (s === 'idle') {
    // usually just stand there; sometimes a little wing-settle flourish first
    const r = Math.random();
    if (r < 0.14 && actions.left) play(Math.random() < 0.5 ? 'left' : 'right', { ts: 1.5, fade });
    else play(r < 0.6 ? 'idle' : 'idleloop', { fade });
  }
  else if (s === 'loaf') play('idleloop', { ts: 0.8, fade });
  else if (s === 'walk') play('walk', { ts: 1.5, fade });
  else if (s === 'peck') play('peck', { ts: 1.1, fade });
  else if (s === 'eat') play('peck', { ts: 1.35, fade });
  else if (s === 'coo') play('cooing', { fade });
  else if (s === 'circle') play('circle', { ts: 1.05, fade });
  else if (s === 'poop') { play('idleloop', { ts: 0.5, fade }); poopT = clock.elapsedTime; }
  // a REAL explosive take-off clip, then the flap loop takes over (below)
  else if (s === 'fly') play('takeoff', { ts: fast ? 2.2 : 1.7, fade: 0.1 });
  // and a REAL wings-out braking landing — quick, so it never reads as a float
  else if (s === 'land') play('land', { ts: 3, fade: 0.1 });
}

// Keep clips in place: the source actions carry root motion (Walk covers
// ground, Circle wanders a loop), but here the WINDOW is what moves — so pin
// every root bone's horizontal translation to its first keyframe, keep the
// bob. Rotation stays free: that's what makes the circle-strut turn.
function pinRootMotion(clip) {
  for (const tr of clip.tracks) {
    if (!/(RL_BoneRoot|RootNode_0|Hips)\.position$/.test(tr.name)) continue;
    const v = tr.values;
    for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
  }
}

const clock = new THREE.Clock();

const bin = Uint8Array.from(atob(PIGEON_GLB_B64), (c) => c.charCodeAt(0)).buffer;
new GLTFLoader().parse(bin, '', (gltf) => {
  model = gltf.scene;
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) o.frustumCulled = false;      // a flap must never clip out
  });
  if (TINT) {
    model.traverse((o) => {
      if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.setHex(TINT); }
    });
  }
  model.scale.setScalar(SIZE);
  model.rotation.y = YAW;
  rig.add(model);
  if (shine) applyShine(shine);            // (if boot won the race)

  mixer = new THREE.AnimationMixer(model);
  mixer.timeScale = 0.94 + idx * 0.035;         // desync the flock a touch
  for (const clip of gltf.animations) {
    pinRootMotion(clip);
    const short = clip.name.split('_').pop().toLowerCase();
    actions[short] = mixer.clipAction(clip);
  }
  // one-shot clips hand off when they finish
  for (const n of ['takeoff', 'land', 'left', 'right']) {
    if (!actions[n]) continue;
    actions[n].setLoop(THREE.LoopOnce);
    actions[n].clampWhenFinished = true;
  }
  mixer.addEventListener('finished', (e) => {
    if (e.action === actions.takeoff && state === 'fly') play('flyloop', { ts: fast ? 1.7 : 1.2, fade: 0.12 });
    else if (e.action === actions.land || e.action === actions.left || e.action === actions.right) {
      if (state === 'idle' || state === 'land' || state === 'loaf') play('idle', { fade: 0.2 });
    }
  });

  setState(state);
  requestAnimationFrame(loop);
}, (e) => tiny.log('pigeon load failed: ' + e));

// ------------------------------------------------------------ frame-by-frame

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (!mixer) return;

  mixer.update(dt);

  // the rainbow one is never the same color twice
  for (const m of rainbowMats) {
    m.color.setHSL((t * 0.12 + idx * 0.3) % 1, 0.8, 0.55);
    m.emissive.setHSL((t * 0.12 + idx * 0.3) % 1, 0.8, 0.3);
  }

  // face where the backend says — and when actually traveling, TURN into the
  // direction of travel. The look vector is the screen-space heading; treat
  // screen-down as toward the camera, so a bird waddling down-right angles
  // toward you and one climbing away shows you its back. The toward-camera
  // component is capped: fully sideways the wingspan would overflow the
  // 200px window mid-flap.
  let wantYaw;
  const traveling = moving && (state === 'fly' || state === 'land' || state === 'walk');
  if (traveling && (look.x || look.y)) {
    const depth = state === 'walk' ? 0.55 : 0.45;
    wantYaw = Math.atan2(look.x || dir * 0.05, look.y * depth);
  } else if (state === 'circle') {
    wantYaw = model.rotation.y;                 // the clip is doing the turning
  } else {
    wantYaw = dir > 0 ? YAW : -YAW;
  }
  // ease along the shortest arc (yaw wraps), then keep the angle bounded
  let dyaw = wantYaw - model.rotation.y;
  dyaw = ((dyaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  model.rotation.y += dyaw * Math.min(1, dt * 7);
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

  // shadow: follow the hips along the ground; fade and shrink on the wing
  if (bones.Hips) {
    bones.Hips.getWorldPosition(hipPos);
    shadow.position.x += (hipPos.x - shadow.position.x) * Math.min(1, dt * 12);
    shadow.position.z += (hipPos.z - shadow.position.z) * Math.min(1, dt * 12);
    const wantOp = airborne ? 0.22 : 0.9;
    const wantSc = airborne ? 0.55 : 1;
    shadow.material.opacity += (wantOp - shadow.material.opacity) * Math.min(1, dt * 4);
    shadow.scale.setScalar(shadow.scale.x + (wantSc - shadow.scale.x) * Math.min(1, dt * 4));
  }

  // drift the key light toward where the sun says it should be
  key.position.lerp(keyTarget, Math.min(1, dt * 3));
  // banking: pitch into climbs and dives on the wing. This happens on the
  // OUTER group, whose local Z is the screen axis — rotating the yawed model
  // itself would roll it instead.
  const wantTilt = airborne ? -look.y * 0.5 * dir : 0;
  rig.rotation.z += (wantTilt - rig.rotation.z) * Math.min(1, dt * 5);

  // post-mix puppetry: the mixer has already posed every bone this frame,
  // so nudging them now layers on top of the clip (local Z is the hinge)
  const tail = bones.Tail01, hips = bones.Hips, spine = bones.Spine;
  const squatAge = t - poopT;
  if (state === 'poop' && squatAge < 1.1 && tail && hips) {
    // tail up, tip forward, a businesslike shiver, and… done
    const k = Math.min(1, squatAge / 0.22) * (squatAge < 0.85 ? 1 : Math.max(0, (1.1 - squatAge) / 0.25));
    tail.rotateZ((0.9 + Math.sin(squatAge * 34) * 0.06) * k);
    hips.rotateZ(-0.24 * k);
  } else if (spine && (state === 'idle' || state === 'walk' || state === 'loaf')) {
    // watching: pitch the front half toward whatever the backend clocked
    // (+Z is chest-up on this rig, so looking down-screen hunches it down)
    spine.rotateZ(-look.y * 0.3);
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
    if (state === 'fly' && current === 'flyloop') play('flyloop', { ts: fast ? 1.7 : 1.2 });
  }
});

tiny.api.on('say', (p) => {
  if (me !== 'main' || !p.vol) return;   // one mixer for the whole flock
  playKind(p.kind, p.pan || 0, p.vol);
});

// ------------------------------------------------------------------- voice

// ALL audio plays here in the MAIN window — one AudioContext, one decoded
// copy of the 21-recording bank (twenty windows each decoding it would cost
// real memory for nothing). The backend supplies a kind, a stereo pan from
// the bird's x position on the screen, and a volume; a fresh source + gain
// + panner per play, with per-kind pitch jitter so no two coos match.
const KINDS = {
  coo:     { names: ['coo1', 'coo-2x', 'coo-2x-2', 'coo-2x-3', 'coo-2x-4', 'coo-2x-5',
                     'coo-3x', 'coo-3x-2', 'coo-3x-3', 'coo-3x-4'], rate: [0.94, 1.08] },
  coolong: { names: ['coo-4x', 'coo-5x'], rate: [0.95, 1.05] },          // courtship
  call:    { names: ['call-1', 'call-2', 'call-3'], rate: [0.98, 1.14], gain: 0.9 },
  takeoff: { names: ['take_off', 'more_flapping', 'more_flapping2'], rate: [0.92, 1.08], gain: 0.7 },
  scatter: { names: ['flap_away', 'flap_away2'], rate: [0.95, 1.12], gain: 0.85 },
  distant: { names: ['distant_long_cooing'], rate: [0.97, 1.03], gain: 0.28 },
};
let actx = null;
const bank = {};
function ensureAudio() {
  if (me !== 'main' || typeof SND_B64 === 'undefined') return;
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    for (const [name, b64] of Object.entries(SND_B64)) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      actx.decodeAudioData(bytes.buffer).then((buf) => { bank[name] = buf; });
    }
  }
  if (actx.state === 'suspended') actx.resume();
}
function playKind(kind, pan, vol) {
  ensureAudio();
  const k = KINDS[kind];
  if (!k || !actx) return;
  const loaded = k.names.filter((n) => bank[n]);
  if (!loaded.length) return;
  const src = actx.createBufferSource();
  src.buffer = bank[loaded[Math.floor(Math.random() * loaded.length)]];
  src.playbackRate.value = rnd(k.rate[0], k.rate[1]);
  const g = actx.createGain();
  g.gain.value = vol * (k.gain ?? 1);
  const p = actx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(g).connect(p).connect(actx.destination);
  src.start();
}

// Listeners are up — wake the brain (and prime the audio decoder so the
// first coo isn't swallowed while the mp3 decodes). Every window here is
// click-through, so there's nothing to wire for the mouse — the pigeons
// are scenery you can never accidentally interact with.
tiny.api.call('boot').then((p) => {
  setState(p.state);
  if (p.env) { sun = p.env.sun; aimSun(); }
  shine = p.shine || null;
  if (model && shine) applyShine(shine);   // (if the GLB won the race)
  ensureAudio();
});
