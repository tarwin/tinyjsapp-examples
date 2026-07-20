// deck.js — the turntable, modeled from primitives in three.js.
//
// No GLB, no CDN: plinth, platter, record and tonearm are cylinders and
// boxes with canvas-painted textures (walnut grain, groove rings, labels).
// The camera is a person standing at the console — fixed, with a breath of
// parallax; three.js is here for light on vinyl, not for camera moves.
//
// The deck is deliberately dumb: it renders, animates, and reports touches
// (power button, speed switch, tonearm grabs, record taps) through
// callbacks. What those touches MEAN — the ritual — lives in app.js.
//
// Geometry (cm-ish): spindle at origin, platter r15.4, record r15,
// grooves r14.4 (lead-in) → r6.2 (lead-out), label r5.2. Tonearm pivot
// rear-right; stylus radius maps to side time in app.js.

window.DECK = (() => {
  const T = window.THREE;

  // groove band — app.js maps side time onto this radius range
  const R_OUT = 14.4, R_IN = 6.2, R_REC = 15, R_LABEL = 5.2;
  const R_REST = 26.3;                 // parked, the arm runs PARALLEL to the right edge

  let renderer, scene, cam, root;
  let platter, recordFlip, recordSpin, topLabelMat, botLabelMat, topDiscMat, botDiscMat;
  let armYaw, armLift, headshell;
  let powerBtn, speedBtn, powerLampMat;
  let ambLight, keyLight, fillLight, winLight, discoLights;
  let dropRing, dropDot;               // needle-landing preview
  // customization: two models share the bones, configure() dresses them
  let gOrbit, gTech, plinthMat, feltMesh, feltMat, acrylicGrp, platterDisc;
  let armTubeStraight, armTubeS, armBaseMesh;
  let orbitPower, orbitSpeed, techPower, techSpeed;
  let cfgModel = 'orbit';
  const woodTexCache = {}, feltTexCache = {};
  let cbs = {};
  let spin = 0;                        // record angle
  let armR = R_REST, armRTarget = R_REST;
  let lift = 1, liftTarget = 1;        // 1 = up, 0 = stylus in the groove
  let grabbed = false, cueing = false;
  let hasRecord = false;
  let curSide = 0;
  let snapSets = [[], []];             // per side: radii the stylus likes to find
  let anim = null;                     // one-shot record animation {t, dur, fn, done}
  let mouse = { x: 0, y: 0 };
  let disco = false;
  let discoBall, gobo1, gobo2, goboTex;
  let camDist = 56;                    // resize() pushes this back on narrow windows
  // empty room: deck centre stage. record out: deck slides right + down a
  // touch to make room for the sleeve display (the crate is hidden then).
  let viewT = { rx: 1, ly: -4.5 };
  let lookY = -4.5;

  // the deck doesn't care who spins it: local files or a Spotify remote —
  // whatever app.js parks in window.ENGINE (defaults to the local PLAYER)
  const E = () => window.ENGINE || window.PLAYER;

  // room lighting eases toward these; DECK.setLighting() retargets them
  const lightTarget = { amb: 0.55, key: 2.2, fill: 0.5, win: 0, keyC: 0xffd9a8, winC: 0xdfe8ff };

  // tonearm trig: pivot P, effective length L, distance to spindle D.
  // radius r → included angle φ = acos((D² + L² − r²) / 2DL); world arm
  // angle = base − φ (minus curves the stylus round the FRONT of the deck).
  const PIVOT = { x: 21.5, z: -13 };   // rear-right corner, U-Turn style
  const L = 28.2;
  const D = Math.hypot(PIVOT.x, PIVOT.z);
  const BASE = Math.atan2(-PIVOT.z, -PIVOT.x);         // pivot → spindle
  const phiFor = (r) => Math.acos(Math.min(1, Math.max(-1, (D * D + L * L - r * r) / (2 * D * L))));
  const armAngleFor = (r) => BASE - phiFor(r);

  // ── canvas textures ──────────────────────────────────────────────────────

  // max anisotropic filtering everywhere — the groove rings are exactly the
  // fine concentric detail that shimmers at grazing angles without it
  const maxAniso = () => (renderer ? renderer.capabilities.getMaxAnisotropy() : 8);
  const tex = (cv) => { const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = maxAniso(); return t; };

  function woodTexFor(name) {
    if (!woodTexCache[name]) {
      const t = tex(woodCanvas(WOODS[name]));
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(1 / 58, 1 / 58);                // extrude UVs are in world units
      woodTexCache[name] = t;
    }
    return woodTexCache[name];
  }
  function feltTexFor(name) {
    if (!feltTexCache[name]) feltTexCache[name] = tex(feltCanvas(FELTS[name]));
    return feltTexCache[name];
  }

  // wood palettes: [gradient stops], band tints, grain lines, cathedral arcs
  const WOODS = {
    oak:    { base: ['#c8a06a', '#bd9560', '#c49c66'], bandA: '176,132,84', bandB: '208,172,120', lineA: '122,86,48', lineB: '154,116,72', arc: 'rgba(140,100,58,.14)' },
    walnut: { base: ['#584129', '#4a3521', '#523d26'], bandA: '58,42,26', bandB: '104,78,50', lineA: '38,26,14', lineB: '118,88,56', arc: 'rgba(24,16,8,.22)' },
  };

  function woodCanvas(pal) {
    // straight fine grain running front-to-back (vertical here)
    const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
    const g = cv.getContext('2d');
    const base = g.createLinearGradient(0, 0, 1024, 0);
    base.addColorStop(0, pal.base[0]); base.addColorStop(.5, pal.base[1]); base.addColorStop(1, pal.base[2]);
    g.fillStyle = base; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 90; i++) {                     // broad tonal bands
      const x = Math.random() * 1024;
      g.fillStyle = `rgba(${Math.random() > .5 ? pal.bandA : pal.bandB},${.05 + Math.random() * .09})`;
      g.fillRect(x, 0, 12 + Math.random() * 46, 1024);
    }
    for (let i = 0; i < 520; i++) {                    // the fine grain lines
      const x = Math.random() * 1024;
      g.strokeStyle = `rgba(${Math.random() > .7 ? pal.lineA : pal.lineB},${.10 + Math.random() * .22})`;
      g.lineWidth = .5 + Math.random() * 1.1;
      g.beginPath();
      for (let y = 0; y <= 1024; y += 64)
        g.lineTo(x + Math.sin(y * .006 + i * 3) * 2.5 + Math.random(), y);
      g.stroke();
    }
    for (let i = 0; i < 7; i++) {                      // a few cathedral arcs
      const x = Math.random() * 1024, w = 60 + Math.random() * 120;
      g.strokeStyle = pal.arc;
      g.lineWidth = 1.6;
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        g.ellipse(x, 1024 * Math.random(), w * 0.2 + k * 9, 200 + k * 40, 0, -1.2, 1.2);
        g.stroke();
      }
    }
    return cv;
  }

  // felt palettes: base colour + speckle range (dark felt gets lighter dust,
  // light felt gets darker — it's the contrast that reads as fibre)
  const FELTS = {
    black:  { bg: '#141415', lo: 12, hi: 38, fib: 70 },
    white:  { bg: '#e6e3dc', lo: 150, hi: 205, fib: 120 },
    orange: { bg: '#c8721f', lo: 120, hi: 175, fib: 235, tint: [1, .62, .2] },
    red:    { bg: '#a63831', lo: 96, hi: 150, fib: 220, tint: [1, .42, .36] },
    blue:   { bg: '#38618c', lo: 70, hi: 125, fib: 200, tint: [.5, .68, 1] },
  };

  function feltCanvas(p) {
    // a felt mat: thousands of tiny fibre speckles, zero shine
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    const t = p.tint || [1, 1, 1];
    g.fillStyle = p.bg; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 26000; i++) {
      const v = p.lo + Math.random() * (p.hi - p.lo);
      g.fillStyle = `rgba(${v * t[0] | 0},${v * t[1] | 0},${v * t[2] | 0},${.25 + Math.random() * .5})`;
      g.fillRect(Math.random() * 512, Math.random() * 512, 1.2, 1.2);
    }
    for (let i = 0; i < 700; i++) {                    // stray fibres catching light
      const v = p.fib + Math.random() * 30;
      g.strokeStyle = `rgba(${v * t[0] | 0},${v * t[1] | 0},${v * t[2] | 0},${.12 + Math.random() * .14})`;
      g.lineWidth = .6;
      const x = Math.random() * 512, y = Math.random() * 512, a = Math.random() * 7;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5); g.stroke();
    }
    return cv;
  }

  function strobeCanvas() {
    // the SL-1200 platter rim: rows of strobe dots on dark metal
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#2a2a2e'; g.fillRect(0, 0, 1024, 64);
    for (const [y, n, r] of [[14, 90, 3.2], [30, 108, 2.8], [46, 130, 2.4]]) {
      g.fillStyle = '#d8d8dc';
      for (let i = 0; i < n; i++) {
        g.beginPath(); g.arc((i + 0.5) * (1024 / n), y, r, 0, 7); g.fill();
      }
    }
    return cv;
  }

  function plateCanvas() {
    // brushed-steel switch plate with engraved labels (no logo)
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#b9bcc2'; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 400; i++) {                    // the brush
      const y = Math.random() * 256;
      g.strokeStyle = `rgba(${Math.random() > .5 ? '255,255,255' : '110,114,120'},${.04 + Math.random() * .10})`;
      g.lineWidth = .8;
      g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke();
    }
    g.fillStyle = '#3a3d42';
    g.font = '600 30px -apple-system, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.fillText('on', 66, 224);
    g.fillText('off', 190, 224);
    g.fillText('33', 330, 224);
    g.fillText('45', 448, 224);
    return cv;
  }

  // tangent-space normal map of concentric grooves — one map serves every
  // record (the separators live in the COLOR maps). sin-profile ridges,
  // flat under the label and past the edge. NOT sRGB: normals are data.
  function grooveNormalTexture() {
    const S = 1024, C = S / 2;
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const img = g.createImageData(S, S);
    const d = img.data;
    const cmPerPx = R_REC / C;
    const period = 2.8;                              // px between groove crests
    const amp = 0.9;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const dx = x - C, dy = y - C;
        const r = Math.hypot(dx, dy);
        const rCm = r * cmPerPx;
        let nx = 0, ny = 0;
        if (rCm > R_LABEL + 0.2 && rCm < R_REC - 0.1 && r > 1) {
          const s = Math.cos(r * (Math.PI * 2) / period) * amp;
          nx = -s * dx / r;
          ny = -s * dy / r;
        }
        d[i] = nx * 127 + 128;
        d[i + 1] = ny * 127 + 128;
        d[i + 2] = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 127 + 128;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(cv);
    t.anisotropy = maxAniso();
    return t;
  }

  // the groove face of one side: near-black rings + lighter track separators
  function grooveCanvas(seps) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
    const g = cv.getContext('2d'), C = 512, S = 512 / (R_REC + 0.01);
    g.fillStyle = '#0b0b0c'; g.fillRect(0, 0, 1024, 1024);
    for (let r = R_LABEL + 0.15; r < R_REC - 0.05; r += 0.045) {
      const v = 14 + ((r * 37) % 9);                   // micro-variation per ring
      g.strokeStyle = `rgb(${v},${v},${v + 1})`;
      g.lineWidth = 1.4;
      g.beginPath(); g.arc(C, C, r * S, 0, 7); g.stroke();
    }
    for (const r of seps || []) {                      // the shiny gaps between tracks
      g.strokeStyle = 'rgba(180,180,190,.5)';
      g.lineWidth = 2.6;
      g.beginPath(); g.arc(C, C, r * S, 0, 7); g.stroke();
    }
    // lead-in and lead-out are wider, glossier bands
    for (const r of [R_OUT + 0.35, R_IN - 0.35]) {
      g.strokeStyle = 'rgba(150,150,160,.35)'; g.lineWidth = 5;
      g.beginPath(); g.arc(C, C, r * S, 0, 7); g.stroke();
    }
    return cv;
  }

  // label: side A wears the cover; side B gets the album's dominant colour
  function labelCanvas(img, side, title, artist) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    let tone = '#b3542e';
    if (img) {
      const p = document.createElement('canvas'); p.width = p.height = 1;
      const pg = p.getContext('2d');
      pg.drawImage(img, 0, 0, 1, 1);
      const d = pg.getImageData(0, 0, 1, 1).data;
      tone = `rgb(${d[0]},${d[1]},${d[2]})`;
    }
    g.fillStyle = tone; g.fillRect(0, 0, 512, 512);
    if (side === 0 && img) g.drawImage(img, 0, 0, 512, 512);
    else {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, 512, 512);
      g.fillStyle = 'rgba(255,245,225,.92)';
      g.textAlign = 'center';
      g.font = 'italic 700 150px Palatino, Georgia, serif';
      g.fillText('B', 256, 218);
      g.font = 'italic 26px Palatino, Georgia, serif';
      const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
      g.fillText(short(title, 26), 256, 300);
      g.font = '20px Palatino, Georgia, serif';
      g.fillStyle = 'rgba(255,245,225,.7)';
      g.fillText(short(artist, 30), 256, 336);
    }
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 3;
    g.beginPath(); g.arc(256, 256, 250, 0, 7); g.stroke();
    g.fillStyle = '#050505';                            // spindle hole
    g.beginPath(); g.arc(256, 256, 14, 0, 7); g.fill();
    return cv;
  }

  // a tiny warm room as an equirect env map — enough to put light on metal
  function envTexture() {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#181310'; g.fillRect(0, 0, 128, 64);
    const sky = g.createLinearGradient(0, 0, 0, 40);
    sky.addColorStop(0, '#5a4630'); sky.addColorStop(1, '#241c14');
    g.fillStyle = sky; g.fillRect(0, 0, 128, 40);
    const lamp = g.createRadialGradient(34, 12, 2, 34, 12, 26);
    lamp.addColorStop(0, 'rgba(255,214,150,.95)'); lamp.addColorStop(1, 'rgba(255,214,150,0)');
    g.fillStyle = lamp; g.fillRect(0, 0, 128, 64);
    const t = new T.CanvasTexture(cv);
    t.mapping = T.EquirectangularReflectionMapping;
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  // ── build ────────────────────────────────────────────────────────────────

  function build() {
    scene = new T.Scene();
    scene.environment = envTexture();
    root = new T.Group();
    root.position.set(1, 0, 0);
    scene.add(root);

    cam = new T.PerspectiveCamera(30, 1, 1, 300);

    ambLight = new T.AmbientLight(0x8a7458, 0.55);
    scene.add(ambLight);
    keyLight = new T.DirectionalLight(0xffd9a8, 2.2);   // the lamp, upper-left
    keyLight.position.set(-28, 55, 24);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    const sc = keyLight.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40;
    sc.updateProjectionMatrix();
    scene.add(keyLight);
    fillLight = new T.DirectionalLight(0x6a7a9a, 0.5);  // cool spill
    fillLight.position.set(30, 20, -18);
    scene.add(fillLight);
    winLight = new T.DirectionalLight(0xdfe8ff, 0);     // daylight through the window
    winLight.position.set(46, 40, 30);
    scene.add(winLight);
    // the mirrorball's little helpers — off until someone flips the switch
    discoLights = [0xff3355, 0x33ddff, 0xffcc33].map((c, i) => {
      const p = new T.PointLight(c, 0, 160, 1.2);
      p.position.set(Math.cos(i * 2.1) * 30, 26, Math.sin(i * 2.1) * 30);
      scene.add(p);
      return p;
    });
    // the ball itself: a PROPER mirrorball — hundreds of instanced mirror
    // chips on a fibonacci sphere over a dark core, on its chain
    discoBall = new T.Group();
    const chain = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 10, 6), new T.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.4 }));
    chain.position.y = 7.4;
    const core = new T.Mesh(new T.SphereGeometry(3.0, 20, 14), new T.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.8 }));
    const TILE_N = 460;
    const tiles = new T.InstancedMesh(
      new T.BoxGeometry(0.5, 0.5, 0.07),
      new T.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06, envMapIntensity: 3.2 }),
      TILE_N
    );
    const dummy = new T.Object3D();
    const GOLD = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < TILE_N; i++) {
      const y = 1 - (i / (TILE_N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = GOLD * i;
      dummy.position.set(Math.cos(a) * r * 3.15, y * 3.15, Math.sin(a) * r * 3.15);
      dummy.lookAt(dummy.position.clone().multiplyScalar(2));
      dummy.updateMatrix();
      tiles.setMatrixAt(i, dummy.matrix);
    }
    discoBall.add(chain, core, tiles);
    discoBall.position.set(4, 66, 0);
    scene.add(discoBall);
    // the thrown light: two gobo spotlights projecting a dot pattern (the
    // "gel") — the sparkle lands ON surfaces and sweeps, no particles.
    // (SpotLight.map projects through the shadow camera, so castShadow on.)
    const goboCv = document.createElement('canvas'); goboCv.width = goboCv.height = 512;
    const gg = goboCv.getContext('2d');
    gg.fillStyle = '#000'; gg.fillRect(0, 0, 512, 512);
    for (let gy = 20; gy < 512; gy += 46) {
      for (let gx = 20 + (gy % 92 > 46 ? 23 : 0); gx < 512; gx += 46) {
        const rr = 5 + Math.random() * 4;
        const grd = gg.createRadialGradient(gx, gy, 1, gx, gy, rr);
        grd.addColorStop(0, 'rgba(255,255,255,.95)');
        grd.addColorStop(0.7, 'rgba(255,255,255,.5)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        gg.fillStyle = grd;
        gg.beginPath(); gg.arc(gx, gy, rr, 0, 7); gg.fill();
      }
    }
    goboTex = new T.CanvasTexture(goboCv);
    goboTex.center.set(0.5, 0.5);
    const mkGobo = () => {
      const g = new T.SpotLight(0xfff0dd, 0, 110, 1.15, 0.4, 1.1);
      g.map = goboTex;
      g.castShadow = true;
      g.shadow.mapSize.set(256, 256);
      const tgt = new T.Object3D();
      scene.add(tgt);
      g.target = tgt;
      scene.add(g);
      return g;
    };
    gobo1 = mkGobo();
    gobo2 = mkGobo();

    // oak plinth: an extruded rounded-rect slab — soft corners, a whisper of
    // bevel on every edge (a plain box reads like a box)
    const wood = new T.MeshStandardMaterial({ map: woodTexFor('oak'), roughness: 0.5, metalness: 0.02 });
    plinthMat = wood;
    const rrect = (w, h, r) => {
      const s = new T.Shape(), x = -w / 2, y = -h / 2;
      s.moveTo(x + r, y);
      s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
      s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
      s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
      return s;
    };
    const plinthGeo = new T.ExtrudeGeometry(rrect(54, 39, 1.7), {
      depth: 3.7, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 3, curveSegments: 14,
    });
    const plinth = new T.Mesh(plinthGeo, wood);
    plinth.rotation.x = -Math.PI / 2;              // extrusion becomes height
    plinth.position.y = -4.0;                      // top lands at y = 0
    plinth.receiveShadow = plinth.castShadow = true;
    root.add(plinth);
    const footMat = new T.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6 });
    for (const [fx, fz] of [[-23, -15], [23, -15], [-23, 15], [23, 15]]) {
      const foot = new T.Mesh(new T.CylinderGeometry(1.6, 1.9, 1.2, 24), footMat);
      foot.position.set(fx, -4.7, fz);
      root.add(foot);
    }
    const hingeMat = new T.MeshStandardMaterial({ color: 0x141416, roughness: 0.45, metalness: 0.3 });

    const darkSteel = new T.MeshStandardMaterial({ color: 0x3c3c40, metalness: 0.7, roughness: 0.4 });

    platter = new T.Group();
    platterDisc = new T.Mesh(new T.CylinderGeometry(15.7, 15.7, 2.0, 128), darkSteel);
    platterDisc.position.y = 1.0;
    platterDisc.castShadow = platterDisc.receiveShadow = true;
    platter.add(platterDisc);
    // the big felt mat IS the platter's face (colour via configure)
    feltMat = new T.MeshStandardMaterial({ map: feltTexFor('black'), roughness: 1, metalness: 0, envMapIntensity: 0.06 });
    feltMesh = new T.Mesh(new T.CylinderGeometry(15.35, 15.35, 0.22, 128), feltMat);
    feltMesh.position.y = 2.05;
    feltMesh.receiveShadow = true;
    platter.add(feltMesh);
    // …or the U-Turn acrylic platter: a thick clear disc, no mat at all
    acrylicGrp = new T.Group();
    // NOT transmission: three renders transmissive materials in a separate
    // pass that fights the alpha canvas here. Acrylic = nearly-clear alpha
    // faces + a bright light-catching edge band, like the real thing.
    const acryl = new T.Mesh(
      new T.CylinderGeometry(15.5, 15.5, 1.9, 128),
      new T.MeshStandardMaterial({
        color: 0xdfe9f2, roughness: 0.06, metalness: 0.1, envMapIntensity: 1.2,
        transparent: true, opacity: 0.15, depthWrite: false,
      })
    );
    acryl.position.y = 1.15;
    acryl.castShadow = true;
    acrylicGrp.add(acryl);
    const acrylEdge = new T.Mesh(
      new T.CylinderGeometry(15.56, 15.56, 1.9, 128, 1, true),
      new T.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.12, metalness: 0.3, envMapIntensity: 2.2,
        transparent: true, opacity: 0.55, depthWrite: false,
      })
    );
    acrylEdge.position.y = 1.15;
    acrylicGrp.add(acrylEdge);
    const hub = new T.Mesh(
      new T.CylinderGeometry(5.1, 5.1, 0.1, 64),
      new T.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.4, metalness: 0.5, transparent: true, opacity: 0.8 })
    );
    hub.position.y = 2.14;
    acrylicGrp.add(hub);
    acrylicGrp.visible = false;
    platter.add(acrylicGrp);
    // strobe-dot rim for the SL-1200 (spins with the platter)
    const strobeTex = tex(strobeCanvas());
    strobeTex.wrapS = T.RepeatWrapping; strobeTex.repeat.set(3, 1);
    const strobe = new T.Mesh(
      new T.CylinderGeometry(15.85, 15.85, 1.9, 128, 1, true),
      new T.MeshStandardMaterial({ map: strobeTex, roughness: 0.4, metalness: 0.6 })
    );
    strobe.position.y = 1.0;
    strobe.visible = false;
    platter.add(strobe);
    platter.userData.strobe = strobe;
    const pin = new T.Mesh(new T.CylinderGeometry(0.3, 0.36, 1.4, 24), hingeMat);
    pin.position.y = 2.6;
    platter.add(pin);
    root.add(platter);

    // ── ORBIT dressing: exposed belt drive + the rocker plate ──
    gOrbit = new T.Group();
    root.add(gOrbit);
    const PUL = { x: -22.3, z: -14.2, r: 1.7 };
    const beltMat = new T.MeshStandardMaterial({ color: 0x101012, roughness: 0.7 });
    const beltY = 0.9;
    const pulleyBase = new T.Mesh(new T.CylinderGeometry(2.6, 2.9, 0.5, 32), hingeMat);
    pulleyBase.position.set(PUL.x, 0.25, PUL.z);
    gOrbit.add(pulleyBase);
    const pulley = new T.Mesh(new T.CylinderGeometry(PUL.r, PUL.r, 2.2, 32), hingeMat);
    pulley.position.set(PUL.x, 1.2, PUL.z);
    pulley.castShadow = true;
    gOrbit.add(pulley);
    const pulleyCap = new T.Mesh(new T.CylinderGeometry(0.8, 0.8, 0.7, 24), darkSteel);
    pulleyCap.position.set(PUL.x, 2.5, PUL.z);
    gOrbit.add(pulleyCap);
    for (const sa of [0.9, 4.1]) {                     // the housing screws
      const screw = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 0.2, 12), darkSteel);
      screw.position.set(PUL.x + Math.cos(sa) * 2.35, 0.55, PUL.z + Math.sin(sa) * 2.35);
      gOrbit.add(screw);
    }
    // belt: a band round the platter, a loop round the pulley, and the two
    // external tangent runs between them (real tangent geometry, not a guess)
    const beltBand = (r, x, z) => {
      const b = new T.Mesh(new T.TorusGeometry(r, 0.14, 8, 96), beltMat);
      b.rotation.x = Math.PI / 2;
      b.position.set(x, beltY, z);
      b.scale.set(1, 1, 2.4);                          // flatten: a band, not a cord
      return b;
    };
    gOrbit.add(beltBand(15.75, 0, 0));
    gOrbit.add(beltBand(PUL.r + 0.12, PUL.x, PUL.z));
    const dPul = Math.hypot(PUL.x, PUL.z);
    const basePul = Math.atan2(PUL.z, PUL.x);
    const tangA = Math.acos((15.75 - (PUL.r + 0.12)) / dPul);
    for (const s of [1, -1]) {
      const a = basePul + s * tangA;
      const p1 = { x: Math.cos(a) * 15.75, z: Math.sin(a) * 15.75 };
      const p2 = { x: PUL.x + Math.cos(a) * (PUL.r + 0.12), z: PUL.z + Math.sin(a) * (PUL.r + 0.12) };
      const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const seg = new T.Mesh(new T.BoxGeometry(len, 0.62, 0.13), beltMat);
      seg.position.set((p1.x + p2.x) / 2, beltY, (p1.z + p2.z) / 2);
      seg.rotation.y = -Math.atan2(p2.z - p1.z, p2.x - p1.x);
      gOrbit.add(seg);
    }

    // record group: Flip carries y + the side-flip, Spin turns with the motor
    recordFlip = new T.Group();
    recordSpin = new T.Group();
    recordFlip.add(recordSpin);
    recordFlip.position.y = 2.3;
    recordFlip.visible = false;
    root.add(recordFlip);

    const edge = new T.Mesh(
      new T.CylinderGeometry(R_REC, R_REC, 0.26, 96, 1, true),
      new T.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.5 })
    );
    recordSpin.add(edge);
    // vinyl: barely metallic, low env pickup — it should read BLACK, with
    // light living in the sheen lobes and the tiny groove ridges (normal map)
    const grooveN = grooveNormalTexture();
    topDiscMat = new T.MeshStandardMaterial({
      roughness: 0.38, metalness: 0.12, envMapIntensity: 0.28,
      normalMap: grooveN, normalScale: new T.Vector2(0.45, 0.45),
    });
    botDiscMat = new T.MeshStandardMaterial({
      roughness: 0.38, metalness: 0.12, envMapIntensity: 0.28,
      normalMap: grooveN, normalScale: new T.Vector2(0.45, 0.45),
    });
    const topDisc = new T.Mesh(new T.CircleGeometry(R_REC, 96), topDiscMat);
    topDisc.rotation.x = -Math.PI / 2; topDisc.position.y = 0.131;
    topDisc.castShadow = true;
    const botDisc = new T.Mesh(new T.CircleGeometry(R_REC, 96), botDiscMat);
    botDisc.rotation.x = Math.PI / 2; botDisc.position.y = -0.131;
    recordSpin.add(topDisc, botDisc);
    topLabelMat = new T.MeshStandardMaterial({ roughness: 0.85 });
    botLabelMat = new T.MeshStandardMaterial({ roughness: 0.85 });
    const topLabel = new T.Mesh(new T.CircleGeometry(R_LABEL, 64), topLabelMat);
    topLabel.rotation.x = -Math.PI / 2; topLabel.position.y = 0.135;
    const botLabel = new T.Mesh(new T.CircleGeometry(R_LABEL, 64), botLabelMat);
    botLabel.rotation.x = Math.PI / 2; botLabel.position.y = -0.135;
    recordSpin.add(topLabel, botLabel);

    // the static sheen: light lobes that do NOT rotate with the vinyl —
    // exactly how a real record catches the lamp
    const sheenCv = document.createElement('canvas'); sheenCv.width = sheenCv.height = 512;
    const sg = sheenCv.getContext('2d');
    for (const a of [Math.PI * 0.75, Math.PI * 1.75]) {
      const x = 256 + Math.cos(a) * 150, y = 256 + Math.sin(a) * 150;
      const rad = sg.createRadialGradient(x, y, 10, x, y, 200);
      rad.addColorStop(0, 'rgba(255,235,200,.34)');
      rad.addColorStop(1, 'rgba(255,235,200,0)');
      sg.fillStyle = rad; sg.fillRect(0, 0, 512, 512);
    }
    const sheen = new T.Mesh(
      new T.RingGeometry(R_LABEL + 0.2, R_REC - 0.1, 96),
      new T.MeshBasicMaterial({ map: tex(sheenCv), transparent: true, opacity: 0.5, depthWrite: false })
    );
    sheen.rotation.x = -Math.PI / 2; sheen.position.y = 0.145;
    recordFlip.add(sheen);                              // on Flip, not Spin

    // needle-landing preview: an amber ring at the would-be radius + a dot
    // under the stylus itself — visible only while the arm is in hand
    dropRing = new T.Mesh(
      new T.RingGeometry(0.982, 1.018, 96),
      new T.MeshBasicMaterial({ color: 0xd98a3d, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide })
    );
    dropRing.rotation.x = -Math.PI / 2;
    dropRing.position.y = 2.56;
    dropRing.visible = false;
    root.add(dropRing);
    dropDot = new T.Mesh(
      new T.CircleGeometry(0.28, 24),
      new T.MeshBasicMaterial({ color: 0xffc477, transparent: true, opacity: 0.85, depthWrite: false })
    );
    dropDot.rotation.x = -Math.PI / 2;
    dropDot.position.y = 2.57;
    dropDot.visible = false;
    root.add(dropDot);

    // ── tonearm ── (the part your eye lands on: worth the polygons)
    const armMetal = new T.MeshStandardMaterial({ color: 0xd8d5cc, metalness: 0.9, roughness: 0.25 });
    const blackGloss = new T.MeshStandardMaterial({ color: 0x17171a, metalness: 0.3, roughness: 0.3 });
    armBaseMesh = new T.Mesh(new T.CylinderGeometry(2.4, 2.8, 2.9, 32), blackGloss);
    armBaseMesh.position.set(PIVOT.x, 1.45, PIVOT.z);
    armBaseMesh.castShadow = true;
    root.add(armBaseMesh);
    // gimbal: a ring the arm swings inside, with a horizontal axle
    const gimbal = new T.Mesh(new T.TorusGeometry(1.05, 0.16, 12, 32), armMetal);
    gimbal.position.set(PIVOT.x, 3.35, PIVOT.z);
    gimbal.rotation.y = Math.PI / 2;
    gimbal.castShadow = true;
    root.add(gimbal);
    // the cueing lever, tucked beside the pivot
    const cue = new T.Mesh(new T.CylinderGeometry(0.14, 0.14, 2.1, 10), armMetal);
    cue.position.set(PIVOT.x + 2.4, 2.4, PIVOT.z + 1.6);
    cue.rotation.z = -0.7;
    root.add(cue);
    const cueTip = new T.Mesh(new T.SphereGeometry(0.32, 12, 10), blackGloss);
    cueTip.position.set(PIVOT.x + 3.15, 3.05, PIVOT.z + 1.6);
    root.add(cueTip);
    armYaw = new T.Group();
    armYaw.position.set(PIVOT.x, 3.35, PIVOT.z);
    root.add(armYaw);
    armLift = new T.Group();
    armYaw.add(armLift);
    const axle = new T.Mesh(new T.CylinderGeometry(0.14, 0.14, 2.5, 12), armMetal);
    axle.rotation.x = Math.PI / 2;
    armLift.add(axle);
    // tube tapers toward the headshell — matte black, U-Turn style
    armTubeStraight = new T.Mesh(new T.CylinderGeometry(0.24, 0.36, L - 3.4, 20), blackGloss);
    armTubeStraight.rotation.z = Math.PI / 2;
    armTubeStraight.position.x = (L - 3.4) / 2;
    armTubeStraight.castShadow = true;
    armLift.add(armTubeStraight);
    // …or the classic silver S-arm for the 1200
    const sCurve = new T.CatmullRomCurve3([
      new T.Vector3(0, 0, 0),
      new T.Vector3(7, 0.15, 0.1),
      new T.Vector3(13.5, 0.3, -1.7),
      new T.Vector3(19.5, 0.3, 1.2),
      new T.Vector3(L - 3.4, 0.05, 0),
    ]);
    armTubeS = new T.Mesh(new T.TubeGeometry(sCurve, 40, 0.33, 12), armMetal);
    armTubeS.castShadow = true;
    armTubeS.visible = false;
    armLift.add(armTubeS);
    // headshell assembly, offset-angled: shell plate, cartridge, cantilever,
    // stylus, finger lift and a little brand dot
    headshell = new T.Group();
    headshell.position.set(L - 1.7, -0.1, 0);
    headshell.rotation.y = 0.38;
    const shell = new T.Mesh(new T.BoxGeometry(3.4, 0.2, 1.5), blackGloss);
    shell.position.y = 0.12;
    shell.castShadow = true;
    const collar = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.9, 12), armMetal);
    collar.rotation.z = Math.PI / 2;
    collar.position.set(-1.9, 0.12, 0);
    const cart = new T.Mesh(new T.BoxGeometry(1.5, 0.8, 1.1), new T.MeshStandardMaterial({ color: 0x232328, roughness: 0.45 }));
    cart.position.set(0.55, -0.36, 0);
    cart.castShadow = true;
    const badge = new T.Mesh(new T.BoxGeometry(0.5, 0.3, 1.12), new T.MeshStandardMaterial({ color: 0xe4c122, roughness: 0.4 }));
    badge.position.set(1.06, -0.28, 0);
    const cant = new T.Mesh(new T.CylinderGeometry(0.035, 0.05, 0.85, 8), armMetal);
    cant.position.set(1.25, -0.78, 0);
    cant.rotation.z = 1.05;
    const styl = new T.Mesh(new T.ConeGeometry(0.07, 0.3, 8), armMetal);
    styl.position.set(1.62, -0.98, 0);
    styl.rotation.x = Math.PI;
    const lift_ = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 1.1, 8), armMetal);
    lift_.position.set(0.2, 0.35, -0.85);
    lift_.rotation.x = 0.9;
    headshell.add(shell, collar, cart, badge, cant, styl, lift_);
    armLift.add(headshell);
    // counterweight with a knurled ring, slightly under-slung
    const weight = new T.Mesh(new T.CylinderGeometry(1.05, 1.05, 1.7, 28), armMetal);
    weight.rotation.z = Math.PI / 2;
    weight.position.set(-2.7, -0.1, 0);
    weight.castShadow = true;
    armLift.add(weight);
    const knurl = new T.Mesh(new T.CylinderGeometry(1.12, 1.12, 0.35, 28), blackGloss);
    knurl.rotation.z = Math.PI / 2;
    knurl.position.set(-1.7, -0.1, 0);
    armLift.add(knurl);
    // arm rest: a post with a U-cradle the parked arm actually settles into
    const restA = armAngleFor(R_REST);
    const restMat = new T.MeshStandardMaterial({ color: 0x232327, roughness: 0.55 });
    const restX = PIVOT.x + Math.cos(restA) * (L - 5.2);   // behind the headshell
    const restZ = PIVOT.z + Math.sin(restA) * (L - 5.2);
    const restPost = new T.Mesh(new T.BoxGeometry(0.55, 3.3, 0.55), restMat);
    restPost.position.set(restX, 1.65, restZ);
    restPost.castShadow = true;
    root.add(restPost);
    const px = -Math.sin(restA), pz = Math.cos(restA);   // across the arm tube
    for (const s of [-1, 1]) {
      const prong = new T.Mesh(new T.BoxGeometry(0.16, 1.3, 0.55), restMat);
      prong.position.set(restX + px * 0.52 * s, 3.85, restZ + pz * 0.52 * s);
      prong.rotation.y = Math.PI / 2 - restA;            // long side ALONG the tube
      root.add(prong);
    }

    // ── controls: one brushed plate front-left (reference layout) with two
    // rockers — on/off and 33/45 — plus a discreet power LED. The arm now
    // owns the right side, so the plate goes back where U-Turn put it.
    // in the plinth's bottom-left corner, like the reference
    const PLATE = { x: -19.5, z: 15.2 };
    const plate = new T.Mesh(
      new T.BoxGeometry(9.2, 0.3, 4.4),
      new T.MeshStandardMaterial({ map: tex(plateCanvas()), metalness: 0.75, roughness: 0.35 })
    );
    plate.position.set(PLATE.x, 0.15, PLATE.z);
    gOrbit.add(plate);
    // rockers: extruded profile — chamfered shoulders, a finger-dip in the
    // middle, and a whisper of bevel (a plain box reads like a box)
    const rockerGeo = (() => {
      const s = new T.Shape();
      s.moveTo(-0.92, 0);
      s.lineTo(-0.92, 0.42);
      s.quadraticCurveTo(-0.82, 0.72, -0.5, 0.74);
      s.quadraticCurveTo(0, 0.5, 0.5, 0.74);      // the dip
      s.quadraticCurveTo(0.82, 0.72, 0.92, 0.42);
      s.lineTo(0.92, 0);
      s.closePath();
      const g = new T.ExtrudeGeometry(s, {
        depth: 1.05, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 10,
      });
      g.translate(0, 0, -0.525);
      return g;
    })();
    const rockerMat = new T.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.4, metalness: 0.2 });
    orbitPower = new T.Mesh(rockerGeo, rockerMat);
    orbitPower.position.set(PLATE.x - 2.15, 0.3, PLATE.z - 0.35);
    orbitPower.castShadow = true;
    gOrbit.add(orbitPower);
    orbitSpeed = new T.Mesh(rockerGeo, rockerMat);
    orbitSpeed.position.set(PLATE.x + 2.5, 0.3, PLATE.z - 0.35);
    orbitSpeed.castShadow = true;
    gOrbit.add(orbitSpeed);
    powerBtn = orbitPower;
    speedBtn = orbitSpeed;
    powerLampMat = new T.MeshStandardMaterial({ color: 0x381408, emissive: 0x000000 });
    const lamp = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.34, 12), powerLampMat);
    lamp.position.set(PLATE.x - 4.1, 0.32, PLATE.z + 1.5);
    gOrbit.add(lamp);

    // ── SL-1200 dressing: START·STOP, 33/45, pitch fader, strobe dome ──
    gTech = new T.Group();
    gTech.visible = false;
    root.add(gTech);
    const brushed = new T.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.7, roughness: 0.38 });
    const bevelBox = (w, d, h, r) => {
      const g = new T.ExtrudeGeometry(rrect(w, d, r), {
        depth: Math.max(0.05, h - 0.12), bevelEnabled: true,
        bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 8,
      });
      g.rotateX(-Math.PI / 2);
      return g;
    };
    techPower = new T.Mesh(bevelBox(3.6, 3.0, 0.7, 0.5), brushed);
    techPower.position.set(-21.3, 0.05, 14.2);
    techPower.castShadow = true;
    gTech.add(techPower);
    const techLed = new T.Mesh(new T.BoxGeometry(3.0, 0.16, 0.3), powerLampMat);
    techLed.position.set(-21.3, 0.72, 12.5);
    gTech.add(techLed);
    techSpeed = new T.Mesh(bevelBox(2.6, 1.2, 0.5, 0.3), brushed);
    techSpeed.position.set(-16.6, 0.05, 15.3);
    gTech.add(techSpeed);
    // pitch fader, right-front — pure furniture (and a little 45 wink)
    const faderSlot = new T.Mesh(new T.BoxGeometry(1.0, 0.12, 8.2), new T.MeshStandardMaterial({ color: 0x111114, roughness: 0.6 }));
    faderSlot.position.set(24.2, 0.1, 6.0);
    gTech.add(faderSlot);
    const faderKnob = new T.Mesh(bevelBox(1.7, 1.1, 0.55, 0.25), brushed);
    faderKnob.position.set(24.2, 0.12, 6.0);
    gTech.add(faderKnob);
    gTech.userData.faderKnob = faderKnob;
    // strobe dome, rear-left corner
    const dome = new T.Mesh(new T.CylinderGeometry(1.05, 1.2, 1.5, 24), brushed);
    dome.position.set(-23.5, 0.75, -16.2);
    dome.rotation.z = 0.18;
    gTech.add(dome);

    armYaw.rotation.y = -armAngleFor(R_REST);
    armLift.rotation.z = 0.07;
  }

  // ── record animations (one-shot, promise-based) ──────────────────────────

  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function play(dur, fn) {
    return new Promise((res) => { anim = { t: 0, dur, fn, done: res }; });
  }

  // ── interaction ──────────────────────────────────────────────────────────

  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  const dropPlane = new T.Plane(new T.Vector3(0, 1, 0), -2.45);  // y = 2.45, the record's face

  function pick(e, targets) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, cam);
    return targets ? ray.intersectObjects(targets, true)[0] : null;
  }

  function planeRadius(e) {              // pointer → radius from the spindle
    pick(e, null);
    const hit = new T.Vector3();
    if (!ray.ray.intersectPlane(dropPlane, hit)) return null;
    return Math.hypot(hit.x - root.position.x, hit.z - root.position.z);
  }

  function bindPointer(cv) {
    const isArm = (o) => { for (let p = o; p; p = p.parent) if (p === armLift) return true; return false; };
    cv.addEventListener('pointermove', (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (grabbed) {
        let r = planeRadius(e);
        if (r == null) return;
        r = Math.min(R_REST + 1.5, Math.max(R_IN - 0.3, r));
        // the stylus likes the grooves' beginnings: a gentle magnetic pull
        // toward track starts, strongest on the lead-in (track one)
        if (hasRecord) {
          let best = null, bd = 1e9;
          const snaps = snapSets[curSide] || [];
          for (let i = 0; i < snaps.length; i++) {
            const range = i === 0 ? 0.9 : 0.5;
            const d = Math.abs(r - snaps[i]);
            if (d < range && d < bd) { bd = d; best = { r: snaps[i], range, first: i === 0 }; }
          }
          if (best) {
            const w = (1 - Math.pow(bd / best.range, 2)) * (best.first ? 0.85 : 0.55);
            r += (best.r - r) * w;
          }
        }
        armRTarget = r;
        return;
      }
      const over = pick(e, hoverTargets());
      cv.className = over ? (isArm(over.object) ? 'hand' : 'tap') : '';
    });
    cv.addEventListener('pointerdown', (e) => {
      const armHit = pick(e, [armLift]);
      if (armHit && hasRecord !== null) {
        grabbed = true;
        cv.className = 'grab';
        cv.setPointerCapture(e.pointerId);
        if (lift < 0.5 && cbs.onNeedleLift) cbs.onNeedleLift();   // grabbing a playing arm lifts it
        liftTarget = 1;
        cueing = false;
        return;
      }
      const hit = pick(e, [powerBtn, speedBtn, ...(recordFlip.visible ? [recordFlip] : [])]);
      if (!hit) return;
      if (hit.object === powerBtn && cbs.onPower) cbs.onPower();
      else if (hit.object === speedBtn && cbs.onSpeed) cbs.onSpeed();
      else if (cbs.onRecordTap) cbs.onRecordTap();
    });
    const release = () => {
      if (!grabbed) return;
      grabbed = false;
      cv.className = '';
      const r = armRTarget;
      if (hasRecord && r <= R_OUT + 0.6 && r >= R_IN - 0.3 && cbs.onNeedleDrop) {
        cueing = true;                   // cue-lever glide, then the drop lands
        liftTarget = 0;
        cbs.onNeedleDrop(Math.min(R_OUT, Math.max(R_IN, r)));
      } else {
        armRTarget = R_REST;             // nothing under the stylus: park it
        liftTarget = 1;
        if (cbs.onArmParked) cbs.onArmParked();
      }
    };
    cv.addEventListener('pointerup', release);
    cv.addEventListener('pointercancel', release);
  }

  function hoverTargets() {
    const t = [armLift, powerBtn, speedBtn];
    if (recordFlip.visible) t.push(recordFlip);
    return t;
  }

  // ── frame loop ───────────────────────────────────────────────────────────

  let lastT = performance.now();
  function frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    // motor: ENGINE.rate() is 0..~1.35; 33⅓ rpm at rate 1 (clockwise)
    const eng = E();
    spin -= (eng ? eng.rate() : 0) * (33.333 / 60) * Math.PI * 2 * dt;
    recordSpin.rotation.y = spin;
    platter.rotation.y = spin * 0.999;   // platter slips a hair behind — alive

    // tonearm follows: its own target when grabbed, the music when not
    if (!grabbed && cbs.armTarget) {
      const t = cbs.armTarget();         // { radius, down } | null
      if (t) { armRTarget = t.radius; if (!cueing) liftTarget = t.down ? 0 : 1; }
    }
    armR += (armRTarget - armR) * (1 - Math.exp(-(grabbed ? 14 : 6) * dt));
    // a parked arm doesn't hover — it settles down INTO the rest cradle
    const resting = liftTarget === 1 && !grabbed && !cueing && armR > R_REST - 0.9;
    const liftGoal = resting ? 0.07 : liftTarget;   // tube settles ON the post, in the prongs
    let liftK = cueing || liftTarget === 0 ? 2.2 : 6;    // cue-down is damped, lift is quick
    lift += (liftGoal - lift) * (1 - Math.exp(-liftK * dt));
    if (cueing && lift < 0.04) { cueing = false; if (cbs.onNeedleLanded) cbs.onNeedleLanded(); }
    let wob = 0;
    if (eng && eng.inRunout() && lift < 0.2)
      wob = Math.sin(spin) * 0.012;      // the arm nods once per revolution
    const armRc = Math.max(R_IN - 0.4, Math.min(R_REST + 1.5, armR));
    armYaw.rotation.y = -armAngleFor(armRc);
    armLift.rotation.z = 0.005 + lift * 0.065 + wob;

    // landing preview: ring at the target radius, dot under the stylus
    const showDrop = grabbed && hasRecord && armRTarget <= R_OUT + 0.6;
    dropRing.visible = dropDot.visible = showDrop;
    if (showDrop) {
      const r = Math.min(R_OUT, Math.max(R_IN, armRTarget));
      dropRing.scale.set(r, r, 1);
      const pul = 0.42 + 0.18 * Math.sin(now * 0.006);
      dropRing.material.opacity = pul;
      const a = armAngleFor(armRc);
      dropDot.position.x = PIVOT.x + Math.cos(a) * L;
      dropDot.position.z = PIVOT.z + Math.sin(a) * L;
    }

    // one-shot record animation
    if (anim) {
      anim.t += dt;
      const k = Math.min(1, anim.t / anim.dur);
      anim.fn(ease(k), k);
      if (k >= 1) { const d = anim.done; anim = null; d(); }
    }

    // power lamp breathes up while the motor runs; the controls answer back
    if (eng && powerLampMat) {
      const on = eng.motorOn();
      powerLampMat.emissive.setHex(on ? 0xff5a18 : 0x000000);
      powerLampMat.emissiveIntensity = on ? 1.6 : 0;
      const rk = 1 - Math.exp(-10 * dt);
      if (cfgModel === 'orbit') {
        orbitPower.rotation.z += ((on ? 0.18 : -0.18) - orbitPower.rotation.z) * rk;
        orbitSpeed.rotation.z += ((eng.speed() === 45 ? -0.18 : 0.18) - orbitSpeed.rotation.z) * rk;
      } else {
        techPower.position.y += ((on ? -0.08 : 0.05) - techPower.position.y) * rk;
        const knob = gTech.userData.faderKnob;
        knob.position.z += ((eng.speed() === 45 ? 2.6 : 6.0) - knob.position.z) * rk;
      }
    }

    // room light eases toward its targets; disco paints in circles over it
    const lk = 1 - Math.exp(-3 * dt);
    ambLight.intensity += (lightTarget.amb - ambLight.intensity) * lk;
    keyLight.intensity += ((disco ? 0.32 : lightTarget.key) - keyLight.intensity) * lk;
    fillLight.intensity += ((disco ? 0.1 : lightTarget.fill) - fillLight.intensity) * lk;
    winLight.intensity += ((disco ? 0 : lightTarget.win) - winLight.intensity) * lk;
    keyLight.color.lerp(new T.Color(lightTarget.keyC), lk);
    winLight.color.lerp(new T.Color(lightTarget.winC), lk);
    for (let i = 0; i < discoLights.length; i++) {
      const p = discoLights[i];
      const want = disco ? 220 : 0;                  // moody, not floodlit
      p.intensity += (want - p.intensity) * lk;
      if (disco) {
        const a = now * 0.0011 + i * 2.1;
        p.position.set(Math.cos(a) * 26, 18 + Math.sin(now * 0.0017 + i) * 8, Math.sin(a) * 26);
        p.color.setHSL((now * 0.00006 + i / 3) % 1, 0.85, 0.5);
      }
    }
    // the ball drops in when the switch flips; its gobos sweep the room
    discoBall.position.y += ((disco ? 30 : 66) - discoBall.position.y) * lk;
    discoBall.rotation.y += dt * 0.4;
    for (const [g, ph, spd] of [[gobo1, 0, 0.00042], [gobo2, 2.4, -0.00031]]) {
      g.intensity += ((disco ? 1050 : 0) - g.intensity) * lk;
      if (disco) {
        g.position.copy(discoBall.position);
        const a = now * spd + ph;
        g.target.position.set(Math.cos(a) * 22, -2, Math.sin(a) * 16);
      }
    }
    if (disco) goboTex.rotation += dt * 0.12;          // dots crawl, ball-style

    // parallax: a person shifting their weight, nothing more. The distance
    // comes from resize() so tall/narrow windows still frame the whole deck.
    const dScale = camDist / 56;
    root.position.x += (viewT.rx - root.position.x) * lk;
    lookY += (viewT.ly - lookY) * lk;
    cam.position.x = 4 + mouse.x * 2.2;
    cam.position.y = 39 * (0.5 + 0.5 * dScale) - mouse.y * 1.6;
    cam.position.z = camDist;
    cam.lookAt(3, -3 + lookY, -3);

    renderer.render(scene, cam);
    requestAnimationFrame(frame);
  }

  // ── public face ──────────────────────────────────────────────────────────

  return {
    R_OUT, R_IN, R_REST,

    init(canvas, callbacks) {
      cbs = callbacks || {};
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      build();
      this.resize();
      bindPointer(canvas);
      requestAnimationFrame(frame);
    },

    resize() {
      const w = window.innerWidth, h = Math.max(300, window.innerHeight);
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      // portrait-ish windows: back the camera off until the plinth
      // (±32 world units) still fits across the view
      const hFov = 2 * Math.atan(Math.tan((30 * Math.PI / 180) / 2) * cam.aspect);
      camDist = Math.max(56, 32.5 / Math.tan(hFov / 2));
    },

    // dress the record: cover image (may be null) + per-side separator radii
    setRecord(img, sides, title, artist) {
      topLabelMat.map = tex(labelCanvas(img, 0, title, artist));
      botLabelMat.map = tex(labelCanvas(img, 1, title, artist));
      topLabelMat.needsUpdate = botLabelMat.needsUpdate = true;
      const sepR = (side) => (side.seps || []).map((f) => R_OUT - f * (R_OUT - R_IN));
      topDiscMat.map = tex(grooveCanvas(sepR(sides[0])));
      botDiscMat.map = tex(grooveCanvas(sepR(sides[1] || sides[0])));
      topDiscMat.needsUpdate = botDiscMat.needsUpdate = true;
      // where the stylus wants to fall: the lead-in, then each track's start
      snapSets = sides.map((s) => [R_OUT, ...sepR(s)]);
      curSide = 0;
    },

    // record floats in from the sleeve (screen left) and settles on the pin;
    // { settle: true } skips the fly-in — the DOM vinyl already delivered it
    // to the spindle, so it just drops the last few centimetres
    putRecord(opts) {
      hasRecord = true;
      if (opts && opts.settle) {
        recordFlip.position.set(0, 2.3 + 5.5, 0);
        recordFlip.rotation.set(0, 0, 0);
        recordFlip.visible = true;
        return play(0.65, (k) => { recordFlip.position.y = 2.3 + 5.5 * (1 - k); });
      }
      recordFlip.position.set(-46, 28, 0);   // set BEFORE visible: no one-frame flash
      recordFlip.rotation.set(0, 0, -0.5);
      recordFlip.visible = true;
      return play(1.5, (k) => {
        recordFlip.position.set(-46 * (1 - k), 2.3 + 26 * (1 - k), 0);
        recordFlip.rotation.z = -0.5 * (1 - k);
      });
    },

    // where the spindle sits on SCREEN (px) + the platter's on-screen radius
    // — so the DOM pull-out vinyl can fly itself to the exact right spot
    spindleScreen() {
      const rect = renderer.domElement.getBoundingClientRect();
      const toPx = (wx, wy, wz) => {
        const v = new T.Vector3(wx, wy, wz).project(cam);
        return { x: (v.x * 0.5 + 0.5) * rect.width + rect.left, y: (-v.y * 0.5 + 0.5) * rect.height + rect.top };
      };
      const c = toPx(root.position.x, 2.4, 0);
      const e = toPx(root.position.x + 15.35, 2.4, 0);
      return { x: c.x, y: c.y, r: Math.hypot(e.x - c.x, e.y - c.y) };
    },

    // the flip: pull the record OUT toward you and up — clear of spindle,
    // arm and plinth — turn it over mid-air, then lay it back on the pin
    async flip(toSide) {
      const from = recordFlip.rotation.z;
      const to = toSide === 1 ? Math.PI : 0;
      curSide = toSide;
      await play(2.3, (k, raw) => {
        const arc = Math.sin(Math.min(1, raw) * Math.PI);
        recordFlip.position.y = 2.3 + arc * 13;
        recordFlip.position.z = arc * 24;              // toward the camera
        const p = Math.min(1, Math.max(0, (raw - 0.26) / 0.48));
        const s = p * p * (3 - 2 * p);                 // turn only while airborne
        recordFlip.rotation.z = from + (to - from) * s;
      });
      recordFlip.rotation.z = to;
      recordFlip.position.z = 0;
      recordFlip.position.y = 2.3;
    },

    takeRecord() {
      hasRecord = false;
      return play(1.2, (k) => {
        recordFlip.position.set(-52 * k, 2.3 + 24 * k, 0);
        recordFlip.rotation.z = -0.6 * k;
      }).then(() => { recordFlip.visible = false; recordFlip.position.set(0, 2.3, 0); });
    },

    hasRecord: () => hasRecord,
    armRadius: () => armR,
    parked: () => armR > R_OUT + 0.8 && !grabbed,
    park() { armRTarget = R_REST; liftTarget = 1; cueing = false; },

    // side time ↔ stylus radius (app.js owns durations, deck owns geometry)
    radiusForFrac: (f) => R_OUT - f * (R_OUT - R_IN),
    fracForRadius: (r) => (R_OUT - Math.min(R_OUT, Math.max(R_IN, r))) / (R_OUT - R_IN),

    // room lighting: app.js turns time-of-day + switches into these targets
    setLighting(t) { Object.assign(lightTarget, t); },
    setDisco(on) { disco = !!on; },
    setView(mode) { viewT = mode === 'aside' ? { rx: 4.5, ly: -1.5 } : { rx: 1, ly: -4.5 }; },

    // ── customization: dress the same bones as an Orbit or an SL-1200 ──
    // base: wood name, paint colour name, or 'silver'; mat: felt colour or
    // 'acrylic' (the clear U-Turn platter, no mat at all)
    configure({ model = 'orbit', base = 'oak', mat = 'black' } = {}) {
      cfgModel = model;
      const PAINTS = {
        black: 0x1b1b1e, white: 0xf0efec, red: 0xc04a42, blue: 0x4a7aab,
        green: 0x3f8f6d, silver: 0xc4c7cc,
      };
      if (WOODS[base]) {
        plinthMat.map = woodTexFor(base);
        plinthMat.color.setHex(0xffffff);
        plinthMat.metalness = 0.02;
        plinthMat.roughness = 0.5;
        plinthMat.envMapIntensity = 1;
      } else {
        plinthMat.map = null;                      // painted (or brushed) slab
        plinthMat.color.setHex(PAINTS[base] ?? PAINTS.black);
        plinthMat.metalness = base === 'silver' ? 0.65 : 0.08;
        plinthMat.roughness = base === 'silver' ? 0.38 : 0.34;
        plinthMat.envMapIntensity = base === 'silver' ? 1 : 0.55;
      }
      plinthMat.needsUpdate = true;
      if (mat === 'acrylic') {
        feltMesh.visible = false;
        platterDisc.visible = false;
        acrylicGrp.visible = true;
      } else {
        feltMesh.visible = true;
        platterDisc.visible = true;
        acrylicGrp.visible = false;
        feltMat.map = feltTexFor(FELTS[mat] ? mat : 'black');
        feltMat.needsUpdate = true;
      }
      const tech = model === 'sl1200';
      gOrbit.visible = !tech;
      gTech.visible = tech;
      platter.userData.strobe.visible = tech && mat !== 'acrylic';
      armTubeStraight.visible = !tech;
      armTubeS.visible = tech;
      armBaseMesh.material = tech ? armTubeS.material : armTubeStraight.material;
      powerBtn = tech ? techPower : orbitPower;
      speedBtn = tech ? techSpeed : orbitSpeed;
    },
  };
})();
