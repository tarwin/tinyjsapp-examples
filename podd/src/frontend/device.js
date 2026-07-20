// device.js — a third-generation iPod, modeled from primitives.
//
// White acrylic slab (extruded rounded-rect, chrome band on the sides),
// recessed monochrome LCD wearing SCREEN's canvas as a nearest-filtered
// texture, the 3G's row of four touch buttons (they glow red-orange when
// the backlight is on — Apple's one moment of camp), and the touch wheel.
//
// It floats: gentle bob, and it leans toward the mouse like a hand is
// holding it. Grabbing anywhere that isn't a control drags the WINDOW —
// the device is the widget.

window.DEVICE = (() => {
  const T = window.THREE;

  let renderer, scene, cam, pod;
  let lcdTex, glowMat, iconMats = [], btnMats = [];
  let wheelMesh, centerMesh, btnMeshes = [], bodyMesh;
  let cbs = {};
  let mouse = { x: 0, y: 0 };
  let backlit = false;
  let pressT = {};                     // mesh → press anim amount
  const WHEEL_Y = -4.35;               // wheel centre (input math uses it too)
  let spinT = 1;                       // double-tap flourish: 0→1 over the spin
  let baseLean = { yaw: 0, pitch: 0 }; // set from window position: face the screen centre
  let lastBodyTap = 0;
  // easeInOutBack: a little wind-up, the spin, a little overshoot, settle
  const SPIN_S = 1.15;
  const easeSpin = (t) => {
    const s = SPIN_S * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((s + 1) * 2 * t - s)) / 2
      : (Math.pow(2 * t - 2, 2) * ((s + 1) * (2 * t - 2) + s) + 2) / 2;
  };

  const rrect = (w, h, r) => {
    const s = new T.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  };

  function envTexture() {
    // a bright soft studio for white acrylic + chrome
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    const g = cv.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 64);
    sky.addColorStop(0, '#f2f4f8'); sky.addColorStop(0.55, '#b8bcc4'); sky.addColorStop(1, '#5c5e66');
    g.fillStyle = sky; g.fillRect(0, 0, 128, 64);
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.fillRect(14, 6, 26, 20);                        // the softbox
    const t = new T.CanvasTexture(cv);
    t.mapping = T.EquirectangularReflectionMapping;
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  function iconCanvas(kind) {
    const cv = document.createElement('canvas'); cv.width = 96; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#8d8f94';
    g.strokeStyle = '#8d8f94';
    const tri = (x, dir) => {
      g.beginPath();
      g.moveTo(x, 32 - 11); g.lineTo(x + dir * 15, 32); g.lineTo(x, 32 + 11);
      g.fill();
    };
    if (kind === 'back') { tri(40, -1); tri(58, -1); g.fillRect(24, 21, 5, 22); }
    if (kind === 'menu') { g.font = '600 17px "Helvetica Neue"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('MENU', 48, 33); }
    if (kind === 'play') { tri(30, 1); g.fillRect(56, 21, 5, 22); g.fillRect(65, 21, 5, 22); }
    if (kind === 'next') { tri(30, 1); tri(48, 1); g.fillRect(66, 21, 5, 22); }
    return cv;
  }

  function build() {
    scene = new T.Scene();
    scene.environment = envTexture();
    cam = new T.PerspectiveCamera(26, 1, 1, 100);
    cam.position.set(0, 0, 42);

    scene.add(new T.AmbientLight(0xfff4e8, 0.9));
    const key = new T.DirectionalLight(0xffffff, 2.0);
    key.position.set(-14, 18, 26);
    scene.add(key);
    const fill = new T.DirectionalLight(0xdfe8ff, 0.7);
    fill.position.set(16, -6, 20);
    scene.add(fill);

    pod = new T.Group();
    scene.add(pod);

    // body: white acrylic face, chrome wrap
    const bodyGeo = new T.ExtrudeGeometry(rrect(9.7, 15.9, 1.0), {
      depth: 1.1, bevelEnabled: true, bevelThickness: 0.42, bevelSize: 0.38, bevelSegments: 6, curveSegments: 28,
    });
    const white = new T.MeshStandardMaterial({ color: 0xeceff2, roughness: 0.32, metalness: 0.02, envMapIntensity: 0.85 });
    const chrome = new T.MeshStandardMaterial({ color: 0xd9dbe0, roughness: 0.12, metalness: 1, envMapIntensity: 1.4 });
    bodyMesh = new T.Mesh(bodyGeo, [white, chrome]);
    bodyMesh.position.z = -1.1 - 0.42;                 // front face lands at z≈0
    pod.add(bodyMesh);
    const shadeCv = document.createElement('canvas');
    shadeCv.width = 256; shadeCv.height = 400;
    const sg = shadeCv.getContext('2d');
    const edge = (x, y, w, h, r) => {                  // rounded-rect path
      sg.beginPath();
      sg.moveTo(x + r, y);
      sg.arcTo(x + w, y, x + w, y + h, r); sg.arcTo(x + w, y + h, x, y + h, r);
      sg.arcTo(x, y + h, x, y, r); sg.arcTo(x, y, x + w, y, r);
      sg.closePath();
    };
    // build the vignette as stacked strokes fading inward
    for (let i = 0; i < 26; i++) {
      const inset = i * 2.2;
      sg.strokeStyle = `rgba(96, 104, 116, ${0.055 * (1 - i / 26)})`;
      sg.lineWidth = 4;
      edge(4 + inset, 4 + inset * 1.35, 248 - 2 * inset, 392 - 2.7 * inset, Math.max(4, 30 - i));
      sg.stroke();
    }
    const topLight = sg.createLinearGradient(0, 0, 0, 400);
    topLight.addColorStop(0, 'rgba(255,255,255,.10)');
    topLight.addColorStop(0.3, 'rgba(255,255,255,0)');
    topLight.addColorStop(1, 'rgba(70,78,92,.06)');
    sg.fillStyle = topLight;
    edge(2, 2, 252, 396, 30); sg.fill();
    const shadeTex = new T.CanvasTexture(shadeCv);
    shadeTex.colorSpace = T.SRGBColorSpace;
    const shade = new T.Mesh(
      new T.PlaneGeometry(10.4, 16.6),
      new T.MeshBasicMaterial({ map: shadeTex, transparent: true, depthWrite: false })
    );
    shade.position.z = 0.002;
    pod.add(shade);

    // LCD: bezel recess, glow underlay, and the screen canvas itself
    const SCR_Y = 4.3;
    const bezelSoft = new T.Mesh(
      new T.ExtrudeGeometry(rrect(7.1, 5.75, 0.3), { depth: 0.03, bevelEnabled: false, curveSegments: 8 }),
      new T.MeshStandardMaterial({ color: 0xc9ccce, roughness: 0.5, envMapIntensity: 0.5 })
    );
    bezelSoft.position.set(0, SCR_Y, 0.004);
    pod.add(bezelSoft);
    const bezelLip = new T.Mesh(
      new T.ExtrudeGeometry(rrect(6.8, 5.45, 0.22), { depth: 0.02, bevelEnabled: false, curveSegments: 8 }),
      new T.MeshStandardMaterial({ color: 0x85888b, roughness: 0.55 })
    );
    bezelLip.position.set(0, SCR_Y, 0.035);
    pod.add(bezelLip);
    glowMat = new T.MeshBasicMaterial({ color: 0x9cc4ff, transparent: true, opacity: 0 });
    const glow = new T.Mesh(new T.PlaneGeometry(6.7, 5.35), glowMat);
    glow.position.set(0, SCR_Y, 0.05);
    pod.add(glow);
    lcdTex = new T.CanvasTexture(SCREEN.canvas);
    lcdTex.colorSpace = T.SRGBColorSpace;
    lcdTex.minFilter = lcdTex.magFilter = T.NearestFilter;
    lcdTex.generateMipmaps = false;
    const lcd = new T.Mesh(new T.PlaneGeometry(6.5, 5.2), new T.MeshBasicMaterial({ map: lcdTex }));
    lcd.position.set(0, SCR_Y, 0.07);
    pod.add(lcd);

    // the four touch buttons — pills with engraved icons
    const kinds = ['back', 'menu', 'play', 'next'];
    for (let i = 0; i < 4; i++) {
      const bx = -3.6 + i * 2.4;
      const mat = new T.MeshStandardMaterial({ color: 0xf0f2f4, roughness: 0.3, envMapIntensity: 0.7 });
      btnMats.push(mat);
      const b = new T.Mesh(new T.CylinderGeometry(1.0, 1.05, 0.12, 40), mat);
      b.rotation.x = Math.PI / 2;
      b.position.set(bx, 0.15, 0.06);
      b.userData.btn = kinds[i];
      pod.add(b);
      btnMeshes.push(b);
      const icoTex = new T.CanvasTexture(iconCanvas(kinds[i]));
      icoTex.colorSpace = T.SRGBColorSpace;
      const icoMat = new T.MeshBasicMaterial({ map: icoTex, transparent: true, opacity: 0.9 });
      iconMats.push(icoMat);
      const ico = new T.Mesh(new T.PlaneGeometry(1.6, 1.06), icoMat);
      ico.position.set(bx, 0.15, 0.14);
      ico.userData.btn = kinds[i];
      pod.add(ico);
      btnMeshes.push(ico);
    }

    // the touch wheel: engraved ring + centre button
    const wheelTexCv = document.createElement('canvas');
    wheelTexCv.width = wheelTexCv.height = 256;
    const wg = wheelTexCv.getContext('2d');
    // the touch surface reads slightly grey, with a recessed groove ring
    const wgrad = wg.createRadialGradient(128, 108, 30, 128, 128, 128);
    wgrad.addColorStop(0, '#e9ebee'); wgrad.addColorStop(0.8, '#d9dcdf'); wgrad.addColorStop(1, '#c9cdd1');
    wg.fillStyle = wgrad; wg.fillRect(0, 0, 256, 256);
    wg.strokeStyle = 'rgba(0,0,0,.22)'; wg.lineWidth = 4;
    wg.beginPath(); wg.arc(128, 128, 124, 0, 7); wg.stroke();
    wg.strokeStyle = 'rgba(255,255,255,.8)'; wg.lineWidth = 2;
    wg.beginPath(); wg.arc(128, 128, 118, 0, 7); wg.stroke();
    wg.strokeStyle = 'rgba(0,0,0,.16)'; wg.lineWidth = 3;
    wg.beginPath(); wg.arc(128, 128, 54, 0, 7); wg.stroke();
    const wheelTex = new T.CanvasTexture(wheelTexCv);
    wheelTex.colorSpace = T.SRGBColorSpace;
    wheelMesh = new T.Mesh(
      new T.CylinderGeometry(3.3, 3.3, 0.06, 64),
      new T.MeshStandardMaterial({ map: wheelTex, roughness: 0.34, envMapIntensity: 0.6 })
    );
    wheelMesh.rotation.x = Math.PI / 2;
    wheelMesh.position.set(0, WHEEL_Y, 0.02);
    pod.add(wheelMesh);
    centerMesh = new T.Mesh(
      new T.CylinderGeometry(1.3, 1.36, 0.14, 48),
      new T.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.22, envMapIntensity: 0.9 })
    );
    centerMesh.rotation.x = Math.PI / 2;
    centerMesh.position.set(0, WHEEL_Y, 0.07);
    pod.add(centerMesh);
  }

  // ── input ────────────────────────────────────────────────────────────────

  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  let wheelDrag = null;                // { lastAngle, acc }
  let holdTimer = null, heldBtn = null;

  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, cam);
    const hits = ray.intersectObjects(pod.children, false);
    return hits[0] || null;
  }

  function wheelAngle(hit) {
    const p = hit.point;                               // pod-space ≈ world here
    return Math.atan2(p.y - (WHEEL_Y + pod.position.y), p.x - pod.position.x);
  }

  const STEP = Math.PI / 9;                            // 20° per tick, iPod-brisk

  function bindPointer(cv) {
    cv.addEventListener('pointerdown', (e) => {
      const hit = pick(e);
      const dragOrSpin = () => {
        const nowT = performance.now();
        if (nowT - lastBodyTap < 350) { lastBodyTap = 0; spinT = 0; return; }
        lastBodyTap = nowT;
        tiny.win.startDrag();
      };
      if (spinT < 1) return;                           // mid-flourish: hands off
      if (!hit) { dragOrSpin(); return; }
      const o = hit.object;
      if (o === centerMesh) {
        pressT.center = 1;
        if (cbs.onSelect) cbs.onSelect();
      } else if (o.userData.btn) {
        pressT[o.userData.btn] = 1;
        heldBtn = o.userData.btn;
        if (cbs.onButton) cbs.onButton(heldBtn);
        holdTimer = setTimeout(function rep() {
          if (heldBtn && cbs.onButtonHold) cbs.onButtonHold(heldBtn);
          holdTimer = setTimeout(rep, 180);
        }, 420);
        cv.setPointerCapture(e.pointerId);
      } else if (o === wheelMesh) {
        wheelDrag = { last: wheelAngle(hit), acc: 0 };
        cv.setPointerCapture(e.pointerId);
      } else {
        dragOrSpin();                                  // the body is the handle
      }
    });
    cv.addEventListener('pointermove', (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (!wheelDrag) return;
      const hit = pick(e);
      if (!hit || (hit.object !== wheelMesh && hit.object !== centerMesh)) return;
      const a = wheelAngle(hit);
      let d = a - wheelDrag.last;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      wheelDrag.last = a;
      wheelDrag.acc += d;
      while (wheelDrag.acc <= -STEP) { wheelDrag.acc += STEP; if (cbs.onWheel) cbs.onWheel(1); }   // clockwise = down
      while (wheelDrag.acc >= STEP) { wheelDrag.acc -= STEP; if (cbs.onWheel) cbs.onWheel(-1); }
    });
    const up = () => {
      wheelDrag = null;
      heldBtn = null;
      clearTimeout(holdTimer);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    // desktop courtesy: the mouse scroll wheel spins the touch wheel
    let wheelAcc = 0;
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheelAcc += e.deltaY;
      while (wheelAcc >= 40) { wheelAcc -= 40; if (cbs.onWheel) cbs.onWheel(1); }
      while (wheelAcc <= -40) { wheelAcc += 40; if (cbs.onWheel) cbs.onWheel(-1); }
    }, { passive: false });
  }

  // ── frame loop ───────────────────────────────────────────────────────────

  let lastT = performance.now();
  function frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    lcdTex.needsUpdate = true;

    // sits still — just a slight lean toward the mouse (no idle waving)
    let spinAngle = 0, pop = 0;
    if (spinT < 1) {
      spinT = Math.min(1, spinT + dt / 1.15);
      spinAngle = easeSpin(spinT) * Math.PI * 2;
      pop = Math.sin(spinT * Math.PI) * 0.045;
    }
    const leanY = mouse.x * 0.1 + baseLean.yaw;
    pod.rotation.y += ((leanY + spinAngle) - pod.rotation.y) * (spinT < 1 ? 1 : (1 - Math.exp(-5 * dt)));
    pod.rotation.x += ((-mouse.y * 0.06 + baseLean.pitch) - pod.rotation.x) * (1 - Math.exp(-5 * dt));
    pod.scale.setScalar(1 + pop);

    // button presses sink and recover; backlit icons glow 3G red
    for (const [k, v] of Object.entries(pressT)) {
      if (v <= 0) continue;
      pressT[k] = Math.max(0, v - dt * 5);
    }
    btnMeshes.forEach((m) => {
      const k = m.userData.btn;
      if (k) m.position.z = (m.geometry.type === 'PlaneGeometry' ? 0.14 : 0.06) - (pressT[k] || 0) * 0.08;
    });
    centerMesh.position.z = 0.07 - (pressT.center || 0) * 0.1;
    glowMat.opacity += ((backlit ? 0.35 : 0) - glowMat.opacity) * (1 - Math.exp(-6 * dt));
    iconMats.forEach((m) => m.color.lerp(new T.Color(backlit ? 0xff5a30 : 0xffffff), 1 - Math.exp(-6 * dt)));

    renderer.render(scene, cam);
    requestAnimationFrame(frame);
  }

  return {
    init(canvas, callbacks) {
      cbs = callbacks || {};
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      build();
      this.resize();
      bindPointer(canvas);
      requestAnimationFrame(frame);
    },
    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    },
    setBacklight(on) { backlit = !!on; SCREEN.setBacklight(on); },
    setBaseLean(yaw, pitch) { baseLean = { yaw, pitch }; },
  };
})();
