// magneto.js — a Magnetosphere-style visualizer (an homage to Robert Hodgin's
// magnetic-particle pieces), v2: a small solar system of dark planets, each
// wearing a dandelion of glowing particles that ride its own magnetic dipole,
// pole to pole, wrapped in drifting smoke. Bass blows bursts off the poles and
// flashes the planet cores; the piece changes MODE every half-minute or so —
// lone giant, binary pair, cluster, nebula, void — fading emitters, smoke and
// particle populations in and out. 🎲 jumps modes by hand.
//
// Rendering: WebGPU-first. Trails accumulate in a ping-pong rgba16float
// texture (fade toward the background each frame, sprites added on top), then
// a present pass tonemaps to the canvas — and on an HDR display the canvas is
// configured rgba16float with extended tone mapping, so the cores genuinely
// glow past white (probed the way Geiss probes: render + read back, never
// trust configure()). No WebGPU → the v1 WebGL1 engine below takes over.
// Zero dependencies either way.

(function () {
  const PALETTES = [
    { name: 'deep space', a: [1.0, 0.98, 0.92], b: [0.45, 0.68, 1.0], c: [1.0, 0.55, 0.22], smoke: [0.35, 0.55, 0.9], bg: [0.008, 0.009, 0.014] },
    { name: 'hodgin green', a: [1.0, 1.0, 0.94], b: [0.5, 0.95, 0.45], c: [0.95, 0.85, 0.3], smoke: [0.38, 0.75, 0.35], bg: [0.006, 0.012, 0.007] },
    { name: 'aurora', a: [0.85, 1.0, 0.95], b: [0.2, 0.95, 0.6], c: [0.5, 0.3, 0.95], smoke: [0.25, 0.6, 0.6], bg: [0.006, 0.012, 0.012] },
    { name: 'ember', a: [1.0, 0.95, 0.8], b: [1.0, 0.45, 0.15], c: [0.85, 0.12, 0.25], smoke: [0.7, 0.35, 0.18], bg: [0.014, 0.007, 0.006] },
    { name: 'phosphor', a: null, b: null, c: null, smoke: null, bg: [0.006, 0.012, 0.009] },
  ];
  function lcdColor(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (!m) return fallback;
    return [1, 3, 5].map((i) => parseInt(m[1].slice(i - 1, i + 1), 16) / 255);
  }
  function resolvePalette(i) {
    const p = PALETTES[i % PALETTES.length];
    if (p.name !== 'phosphor') return p;
    const lcd = lcdColor('--lcd', [0.22, 1, 0.6]);
    const sel = lcdColor('--lcd-sel', [1, 0.7, 0.2]);
    return { name: 'phosphor', a: [1, 1, 0.96], b: lcd, c: sel, smoke: lcd.map((v) => v * 0.55), bg: p.bg };
  }

  // the changing "modes": how much of everything is on stage
  const MODES = [
    { name: 'lone giant', emitters: 1, smoke: 0.85, density: 1.0, camd: 4.0, camv: 0.10, hair: 0.85 },
    { name: 'binary', emitters: 2, smoke: 0.6, density: 0.95, camd: 5.2, camv: 0.13, hair: 0.5 },
    { name: 'cluster', emitters: 4, smoke: 1.0, density: 0.8, camd: 6.6, camv: 0.09, hair: 0.75 },
    { name: 'nebula', emitters: 3, smoke: 1.45, density: 0.55, camd: 5.8, camv: 0.07, hair: 1.0 },
    { name: 'void', emitters: 2, smoke: 0.25, density: 1.0, camd: 4.6, camv: 0.16, dark: true, hair: 0.15 },
  ];

  const N_P = 8000;      // particle pool
  const N_STARS = 300;
  const N_SMOKE = 60;
  const N_EM = 5;        // emitter slots

  // column-major perspective * lookAt
  function mvp(out, eye, aspect, t, f) {
    const zn = 0.1, zf = 80;
    const up = [Math.sin(t * 0.05) * 0.12, 1, Math.cos(t * 0.041) * 0.12];
    const zl = Math.hypot(eye[0], eye[1], eye[2]);
    const z = [eye[0] / zl, eye[1] / zl, eye[2] / zl];
    let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
    const xl = Math.hypot(x[0], x[1], x[2]); x = [x[0] / xl, x[1] / xl, x[2] / xl];
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const tx = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
    const ty = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
    const tz = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
    const A = (zf + zn) / (zn - zf), B = (2 * zf * zn) / (zn - zf);
    const fx = f / aspect;
    out[0] = fx * x[0]; out[4] = fx * x[1]; out[8] = fx * x[2]; out[12] = fx * tx;
    out[1] = f * y[0]; out[5] = f * y[1]; out[9] = f * y[2]; out[13] = f * ty;
    out[2] = A * z[0]; out[6] = A * z[1]; out[10] = A * z[2]; out[14] = A * tz + B;
    out[3] = -z[0]; out[7] = -z[1]; out[11] = -z[2]; out[15] = -tz;
  }

  const WGSL = `
struct U {
  mvp: mat4x4f,
  colA: vec4f, colB: vec4f, colC: vec4f, colSmoke: vec4f, colBg: vec4f,
  audio: vec4f,      // time, bass, mids, punch
  misc: vec4f,       // fscaleX, fscaleY, smokeLevel, coreGain
  misc2: vec4f,      // fade, hdr(0/1), unused, unused
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var prevTex: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) corner: vec2f,
  @location(1) hue: f32,
  @location(2) mag: f32,
  @location(3) kind: f32,
  @location(4) extra: f32,
};

@vertex
fn vSprite(@builtin(vertex_index) vi: u32,
           @location(0) ip: vec3f, @location(1) size: f32,
           @location(2) hue: f32, @location(3) mag: f32,
           @location(4) kind: f32, @location(5) extra: f32,
           @location(6) ivel: vec3f) -> VOut {
  var corners = array<vec2f, 4>(vec2f(-1.0,-1.0), vec2f(1.0,-1.0), vec2f(-1.0,1.0), vec2f(1.0,1.0));
  let c = corners[vi];
  var p = u.mvp * vec4f(ip, 1.0);
  var off = c * size;
  var m = mag;
  if (kind < 0.5 && u.misc2.z > 0.01) {
    // hair: stretch the sprite along its screen-space motion — and dim it by
    // the stretch, so a filament carries the same light as the dot it was
    let dv = (u.mvp * vec4f(ivel, 0.0)).xy;
    let dl = length(dv);
    if (dl > 1e-5) {
      let dir = dv / dl;
      let perp = vec2f(-dir.y, dir.x);
      let elong = 1.0 + min(8.0, dl * 26.0) * u.misc2.z;
      off = dir * (c.x * size * elong) + perp * (c.y * size * 0.42);
      m = mag / (0.45 + 0.55 * elong);
    }
  }
  p = vec4f(p.xy + off * vec2f(u.misc.x, u.misc.y), p.zw);
  var o: VOut;
  o.pos = p; o.corner = c; o.hue = hue; o.mag = m; o.kind = kind; o.extra = extra;
  return o;
}

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let a = hash2(i); let b = hash2(i + vec2f(1.0, 0.0));
  let c = hash2(i + vec2f(0.0, 1.0)); let d = hash2(i + vec2f(1.0, 1.0));
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

@fragment
fn fSprite(v: VOut) -> @location(0) vec4f {
  let r2 = dot(v.corner, v.corner);
  if (v.kind < 0.5) {
    // particle / star: additive gaussian with a hot white core
    let glow = exp(-4.5 * r2);
    let core = exp(-30.0 * r2);
    let col = mix(u.colB.rgb, u.colC.rgb, v.hue);
    return vec4f((col * glow * 0.72 + u.colA.rgb * core * 0.9) * v.mag, 1.0);
  } else if (v.kind < 1.5) {
    // smoke: big soft wisp, alpha-blended, noise-broken edge
    let n = vnoise(v.corner * 2.6 + vec2f(v.extra * 7.0, u.audio.x * 0.03))
          * 0.6 + vnoise(v.corner * 6.1 - vec2f(u.audio.x * 0.02, v.extra * 3.0)) * 0.4;
    let fall = exp(-2.2 * r2);
    let a = fall * (0.35 + 0.65 * n) * v.mag * u.misc.z;
    return vec4f(u.colSmoke.rgb * (0.55 + u.audio.y * 0.5), a * 0.13);
  } else if (v.kind < 2.5) {
    // planet disc: near-black body, soft edge, lit rim (extra = inner litness)
    let r = sqrt(r2);
    let body = 1.0 - smoothstep(0.86, 0.96, r);
    let rim = smoothstep(0.62, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
    let inner = exp(-6.0 * r2) * v.extra;
    let col = u.colBg.rgb * 1.8 + u.colB.rgb * rim * (0.10 + v.extra * 0.5)
            + mix(u.colB.rgb, u.colA.rgb, 0.4) * inner * 0.8;
    return vec4f(col, body * 0.985 * v.mag);
  }
  // core: the pulsing heart — ringed halo, pushed past 1.0 on HDR displays
  let r = sqrt(r2);
  let glow = exp(-3.2 * r2);
  let core = exp(-14.0 * r2);
  let rings = (0.5 + 0.5 * sin(r * 24.0 - u.audio.x * 1.6)) * smoothstep(0.12, 0.42, r) * (1.0 - smoothstep(0.55, 0.95, r));
  let col = mix(u.colB.rgb, u.colC.rgb, v.hue);
  return vec4f((col * (glow * 0.5 + rings * 0.4) + u.colA.rgb * core) * v.mag * u.misc.w, 1.0);
}

struct FSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vFull(@builtin(vertex_index) vi: u32) -> FSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  var o: FSOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = p[vi] * vec2f(0.5, -0.5) + 0.5;
  return o;
}

@fragment
fn fFade(v: FSOut) -> @location(0) vec4f {
  let prev = textureSample(prevTex, samp, v.uv).rgb;
  return vec4f(mix(prev, u.colBg.rgb, u.misc2.x), 1.0);
}

@fragment
fn fBlit(v: FSOut) -> @location(0) vec4f {
  let c = textureSample(prevTex, samp, v.uv).rgb;
  if (u.misc2.y > 0.5) {
    return vec4f(c * 1.1, 1.0);                    // HDR: let the peaks through
  }
  return vec4f(c / (1.0 + c * 0.45) * 1.25, 1.0);  // SDR: soft-knee tonemap
}`;

  // WebKit has ACCEPTED rgba16float canvases and presented black — render a
  // clear and read pixels back before trusting HDR (Geiss's trick). The rAF
  // inside can STARVE in an occluded window (WKWebView throttling), so the
  // whole probe races a timeout — no HDR beats never starting.
  const timeout = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
  async function probeHdr(device) {
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

  async function createGPU({ canvas, getAudio }) {
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
        console.error('magneto wgsl:', info.messages.map((m) => m.lineNum + ':' + m.message).join(' | '));
        return null;
      }
    }

    const UBYTES = 64 + 8 * 16;
    const ubo = device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const bgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });

    const ATTRS = { arrayStride: 32, stepMode: 'instance', attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32' },
      { shaderLocation: 2, offset: 16, format: 'float32' },
      { shaderLocation: 3, offset: 20, format: 'float32' },
      { shaderLocation: 4, offset: 24, format: 'float32' },
      { shaderLocation: 5, offset: 28, format: 'float32' },
    ] };
    const VELATTRS = { arrayStride: 12, stepMode: 'instance', attributes: [
      { shaderLocation: 6, offset: 0, format: 'float32x3' },
    ] };
    const sprite = (target, blend) => device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vSprite', buffers: [ATTRS, VELATTRS] },
      fragment: { module: mod, entryPoint: 'fSprite', targets: [{ format: target, blend }] },
      primitive: { topology: 'triangle-strip' },
    });
    const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const ALPHA = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const accumSprites = sprite('rgba16float', ADD);
    const canvasAdd = sprite(format, ADD);
    const canvasAlpha = sprite(format, ALPHA);
    const full = (entry, target) => device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vFull' },
      fragment: { module: mod, entryPoint: entry, targets: [{ format: target }] },
      primitive: { topology: 'triangle-list' },
    });
    const fadePipe = full('fFade', 'rgba16float');
    const blitPipe = full('fBlit', format);

    // ping-pong accumulation textures
    let texA = null, texB = null, bgA = null, bgB = null, W = 0, H = 0;
    function mkBind(tex) {
      return device.createBindGroup({ layout: bgl, entries: [
        { binding: 0, resource: { buffer: ubo } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: tex.createView() },
      ] });
    }
    function resize(w, h) {
      W = Math.max(2, w | 0); H = Math.max(2, h | 0);
      canvas.width = W; canvas.height = H;
      for (const t of [texA, texB]) if (t) t.destroy();
      const mk = () => device.createTexture({
        size: [W, H], format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      texA = mk(); texB = mk();
      bgA = mkBind(texA); bgB = mkBind(texB);
    }

    // ── the scene ──────────────────────────────────────────────────────────
    let seed = (Math.random() * 2147483646 + 1) | 0;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    // emitters: dark planets with dipoles; alive fades in/out with the mode
    const em = Array.from({ length: N_EM }, (_, i) => ({
      pos: [0, 0, 0], scale: 1, alive: i === 0 ? 1 : 0, want: i === 0 ? 1 : 0,
      tilt: 0.3, precess: 0.1, phase: Math.random() * 9, orbitR: 0, orbitA: Math.random() * 6.28, orbitV: 0.02,
      lit: 0, coreless: false, hue: Math.random(),
    }));
    function seatEmitters() {
      for (let i = 0; i < N_EM; i++) {
        const e = em[i];
        e.orbitR = i === 0 ? 0 : 1.6 + rnd() * 2.2;
        e.orbitA = rnd() * Math.PI * 2;
        e.orbitV = (rnd() - 0.5) * 0.06;
        e.scale = i === 0 ? 0.9 + rnd() * 0.4 : 0.45 + rnd() * 0.7;
        e.tilt = 0.15 + rnd() * 0.8;
        e.precess = 0.05 + rnd() * 0.3;
        e.coreless = rnd() < 0.18;                  // the silent dark one
        e.lit = rnd() < 0.3 ? rnd() * 0.8 : 0;      // some planets glow from within
        e.hue = rnd();
      }
    }
    seatEmitters();

    const STRIDE = 8;
    const accumData = new Float32Array((N_P + N_STARS) * STRIDE);
    const accumBuf = device.createBuffer({ size: accumData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const sceneData = new Float32Array((N_SMOKE + N_EM * 2) * STRIDE);
    const sceneBuf = device.createBuffer({ size: sceneData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const velUpload = new Float32Array((N_P + N_STARS) * 3);           // stars stay zero
    const velBuf = device.createBuffer({ size: velUpload.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const zeroVel = device.createBuffer({ size: (N_SMOKE + N_EM * 2) * 12, usage: GPUBufferUsage.VERTEX });

    const pEm = new Uint8Array(N_P);
    const pPhase = new Float32Array(N_P);
    const vel = new Float32Array(N_P * 3);
    function respawn(i, burst) {
      let e = null;
      for (let tries = 0; tries < 6 && !e; tries++) {
        const c = em[(rnd() * N_EM) | 0];
        if (c.alive > 0.1) e = c;
      }
      if (!e) e = em[0];
      pEm[i] = em.indexOf(e);
      const o = i * STRIDE;
      const pole = (i & 1) ? 1 : -1;
      const r = (0.22 + rnd() * 0.5) * e.scale;
      const a = rnd() * Math.PI * 2;
      accumData[o] = e.pos[0] + Math.cos(a) * r * 0.5;
      accumData[o + 1] = e.pos[1] + pole * (0.55 + rnd() * 0.4) * e.scale;
      accumData[o + 2] = e.pos[2] + Math.sin(a) * r * 0.5;
      const v = i * 3;
      vel[v] = (rnd() - 0.5) * 0.15;
      vel[v + 1] = -pole * (0.1 + rnd() * 0.25);
      vel[v + 2] = (rnd() - 0.5) * 0.15;
      if (burst) { vel[v] *= 6; vel[v + 1] *= 3; vel[v + 2] *= 6; }
      accumData[o + 4] = rnd() < 0.62 ? rnd() * 0.3 : 0.68 + rnd() * 0.32;
      accumData[o + 5] = 0;
      accumData[o + 6] = 0;
      accumData[o + 7] = 0;
      pPhase[i] = rnd() * 6.28;
    }
    for (let i = 0; i < N_P; i++) respawn(i, false);
    for (let i = 0; i < N_STARS; i++) {
      const o = (N_P + i) * STRIDE;
      const th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
      const R = 18 + rnd() * 22;
      accumData[o] = R * Math.sin(ph) * Math.cos(th);
      accumData[o + 1] = R * Math.cos(ph);
      accumData[o + 2] = R * Math.sin(ph) * Math.sin(th);
      accumData[o + 3] = 0.05 + rnd() * 0.05;
      accumData[o + 4] = 0.45;
      accumData[o + 5] = 0.10 + rnd() * 0.12;
      accumData[o + 6] = 0;
      accumData[o + 7] = 0;
    }
    const smoke = Array.from({ length: N_SMOKE }, () => ({
      pos: [0, 0, 0], home: 0, off: [0, 0, 0],
      r: 1.2 + Math.random() * 2.2,
      drift: [(Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.05],
      seed: Math.random(), mag: 0.5 + Math.random() * 0.5,
    }));
    function seatSmoke() {
      // most wisps adopt a living planet and pool around it; a third drift
      // free as ambient nebula between the planets
      const alive = em.filter((e) => e.want > 0);
      let k = 0;
      for (const sm of smoke) {
        if ((k++ % 3) === 2) {
          sm.home = -1;
          sm.off = [(Math.random() - 0.5) * 9, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 9];
          sm.r = 2.2 + Math.random() * 3.0;
          sm.mag = 0.3 + Math.random() * 0.35;
          continue;
        }
        const e = alive[(Math.random() * alive.length) | 0] || em[0];
        sm.home = em.indexOf(e);
        const R = (0.8 + Math.random() * 2.2) * e.scale;
        const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * 2;
        sm.off = [Math.cos(a) * R, b * R * 0.7, Math.sin(a) * R];
        sm.r = (1.1 + Math.random() * 2.0) * e.scale;
        sm.mag = 0.5 + Math.random() * 0.5;
      }
    }
    seatSmoke();

    let an = null, fd = null, td = null;
    function ensureAudio() {
      if (an || !getAudio) return;
      try {
        const { ctx: ac, srcNode } = getAudio();
        an = ac.createAnalyser();
        an.fftSize = 256; an.smoothingTimeConstant = 0.72;
        fd = new Uint8Array(an.frequencyBinCount);
        td = new Uint8Array(an.fftSize);
        srcNode.connect(an);
      } catch (e) {}
    }

    let pal = 0, palMix = resolvePalette(0);
    let modeIdx = 0, mode = MODES[0], modeT = 0, nextModeAt = 30;
    let smokeLevel = mode.smoke, density = mode.density, camd = mode.camd, camv = mode.camv;
    function setMode(i) {
      modeIdx = ((i % MODES.length) + MODES.length) % MODES.length;
      mode = MODES[modeIdx];
      modeT = 0; nextModeAt = 26 + rnd() * 18;
      seatEmitters();
      for (let k = 0; k < N_EM; k++) em[k].want = k < mode.emitters ? 1 : 0;
      if (mode.emitters > 1) {
        // every gathering keeps one silent black planet (the reference's
        // bottom-left) — no core, just a silhouette punched out of the glow
        const e = em[mode.emitters - 1];
        e.coreless = true; e.lit = 0; e.scale = Math.max(e.scale, 0.75);
      }
      seatSmoke();
      if (rnd() < 0.5 && !mode.dark) { pal = (pal + 1) % PALETTES.length; palMix = resolvePalette(pal); }
      return mode.name + ' · ' + palMix.name;
    }

    let bassAvg = 0.08, lastT = 0, camA = Math.random() * 6, active = false, hairNow = 0.8;
    const M = new Float32Array(16);
    const uarr = new Float32Array(UBYTES / 4);

    function frame(tms) {
      requestAnimationFrame(frame);
      if (!active || !texA) { lastT = 0; return; }
      const t = tms * 0.001;
      const dt = Math.min(0.05, lastT ? t - lastT : 0.016);
      lastT = t;
      modeT += dt;
      if (modeT > nextModeAt) setMode(modeIdx + 1 + (rnd() * 2 | 0));

      ensureAudio();
      let bass = 0, mids = 0, rms = 0;
      if (an) {
        an.getByteFrequencyData(fd);
        for (let i = 1; i < 10; i++) bass += fd[i];
        bass /= 9 * 255;
        for (let i = 20; i < 60; i++) mids += fd[i];
        mids /= 40 * 255;
        an.getByteTimeDomainData(td);
        for (let i = 0; i < td.length; i += 4) { const v = (td[i] - 128) / 128; rms += v * v; }
        rms = Math.sqrt(rms / (td.length / 4));
      }
      bassAvg += (bass - bassAvg) * 0.04;
      const punch = Math.max(0, bass - bassAvg * 1.25);

      smokeLevel += (mode.smoke - smokeLevel) * dt * 0.7;
      density += (mode.density - density) * dt * 0.7;
      camd += (mode.camd - camd) * dt * 0.5;
      camv += (mode.camv - camv) * dt * 0.5;
      for (const e of em) {
        e.alive += (e.want - e.alive) * dt * 0.8;
        e.orbitA += e.orbitV * dt;
        e.pos[0] = Math.cos(e.orbitA) * e.orbitR;
        e.pos[2] = Math.sin(e.orbitA) * e.orbitR;
        e.pos[1] = Math.sin(e.orbitA * 0.7 + e.phase) * e.orbitR * 0.25;
      }

      const drive = 1 + bass * 3.2;
      const burstN = punch > 0.08 ? Math.floor(punch * 300) : 0;
      for (let b = 0; b < burstN; b++) respawn((Math.random() * N_P) | 0, true);

      const activeN = Math.floor(N_P * density);
      for (let i = 0; i < N_P; i++) {
        const o = i * STRIDE, v = i * 3;
        const e = em[pEm[i]];
        if (e.alive < 0.05 && e.want === 0) { respawn(i, false); continue; }
        const s = e.scale;
        let x = (accumData[o] - e.pos[0]) / s, y = (accumData[o + 1] - e.pos[1]) / s, z = (accumData[o + 2] - e.pos[2]) / s;
        const ax = Math.sin(t * e.precess + e.phase) * e.tilt, az = Math.cos(t * e.precess * 0.83 + e.phase) * e.tilt;
        const mx = Math.sin(ax), mz = Math.sin(az);
        const my = Math.sqrt(Math.max(0, 1 - mx * mx - mz * mz));
        const r2 = x * x + y * y + z * z;
        const r = Math.sqrt(r2) + 1e-4;
        const nx = x / r, ny = y / r, nz = z / r;
        const md = mx * nx + my * ny + mz * nz;
        const ir3 = 1 / (r2 * r + 0.02);
        let bx = (3 * md * nx - mx) * ir3, by = (3 * md * ny - my) * ir3, bz = (3 * md * nz - mz) * ir3;
        const bl = Math.hypot(bx, by, bz) + 1e-5;
        bx /= bl; by /= bl; bz /= bl;
        const dir = (i & 1) ? 1 : -1;
        const sw = 0.6 / (r + 0.4);
        vel[v] += (bx * dir * 1.6 + (my * z - mz * y) * sw - x * 0.06) * dt * drive;
        vel[v + 1] += (by * dir * 1.6 + (mz * x - mx * z) * sw - y * 0.06) * dt * drive;
        vel[v + 2] += (bz * dir * 1.6 + (mx * y - my * x) * sw - z * 0.06) * dt * drive;
        vel[v] *= 0.988; vel[v + 1] *= 0.988; vel[v + 2] *= 0.988;
        x += vel[v] * dt; y += vel[v + 1] * dt; z += vel[v + 2] * dt;
        accumData[o] = x * s + e.pos[0];
        accumData[o + 1] = y * s + e.pos[1];
        accumData[o + 2] = z * s + e.pos[2];
        if (r < 0.16 || r > 2.9) { respawn(i, false); continue; }
        // populations come and go: each particle waxes and wanes on its own clock
        const wax = 0.55 + 0.45 * Math.sin(t * 0.35 + pPhase[i]);
        const on = i >= activeN ? 0 : 1;
        accumData[o + 3] = 0.028 * s;
        accumData[o + 5] = (0.42 + accumData[o + 4] * 0.25 + rms * 1.9 + (i % 7 === 0 ? punch * 3.5 : 0)) * wax * e.alive * on;
      }
      velUpload.set(vel, 0);
      device.queue.writeBuffer(accumBuf, 0, accumData);
      device.queue.writeBuffer(velBuf, 0, velUpload);

      let sOff = 0;
      for (const sm of smoke) {
        const free = sm.home < 0;
        const e = free ? null : em[sm.home];
        const bound = free ? 6 : 3.2 * e.scale;
        for (let a = 0; a < 3; a++) {
          sm.off[a] += sm.drift[a] * dt;
          if (Math.abs(sm.off[a]) > bound) sm.drift[a] *= -1;
        }
        const o = sOff * STRIDE;
        sceneData[o] = (free ? 0 : e.pos[0]) + sm.off[0];
        sceneData[o + 1] = (free ? 0 : e.pos[1]) + sm.off[1];
        sceneData[o + 2] = (free ? 0 : e.pos[2]) + sm.off[2];
        sceneData[o + 3] = sm.r;
        sceneData[o + 4] = 0.5;
        sceneData[o + 5] = sm.mag * (free ? 1 : e.alive);
        sceneData[o + 6] = 1;
        sceneData[o + 7] = sm.seed;
        sOff++;
      }
      const planet0 = sOff;
      for (const e of em) {
        const o = sOff * STRIDE;
        sceneData[o] = e.pos[0]; sceneData[o + 1] = e.pos[1]; sceneData[o + 2] = e.pos[2];
        sceneData[o + 3] = (e.coreless ? 0.46 : 0.36) * e.scale;
        sceneData[o + 4] = e.hue;
        sceneData[o + 5] = e.alive;
        sceneData[o + 6] = 2;
        // dark-mode planets stay pitch black; lit ones breathe with the mids
        sceneData[o + 7] = mode.dark ? 0 : e.lit * (0.5 + mids * 1.4 + punch);
        sOff++;
      }
      const core0 = sOff;
      for (const e of em) {
        const o = sOff * STRIDE;
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + e.phase * 3);
        sceneData[o] = e.pos[0]; sceneData[o + 1] = e.pos[1]; sceneData[o + 2] = e.pos[2];
        sceneData[o + 3] = 0.46 * e.scale * (1 + punch * 1.2);
        sceneData[o + 4] = e.hue;
        sceneData[o + 5] = e.coreless ? 0 : e.alive * (0.35 + pulse * 0.4 + bass * 1.3 + punch * 2.5);
        sceneData[o + 6] = 3;
        sceneData[o + 7] = 0;
        sOff++;
      }
      device.queue.writeBuffer(sceneBuf, 0, sceneData);

      camA += dt * (camv + mids * 0.22);
      const dist = camd - mids * 1.1;
      const eye = [Math.cos(camA) * dist, Math.sin(camA * 0.6) * 1.8, Math.sin(camA) * dist];
      const aspect = W / Math.max(1, H);
      const f = 1.6;
      mvp(M, eye, aspect, t, f);

      uarr.set(M, 0);
      uarr.set([...palMix.a, 1], 16);
      uarr.set([...palMix.b, 1], 20);
      uarr.set([...palMix.c, 1], 24);
      uarr.set([...palMix.smoke, 1], 28);
      uarr.set([...palMix.bg, 1], 32);
      uarr.set([t, bass, mids, punch], 36);
      uarr.set([f / aspect, f, smokeLevel, hdr ? 2.6 : 1.15], 40);
      hairNow += ((mode.hair || 0) - hairNow) * dt * 0.7;
      uarr.set([0.10 - Math.min(0.055, bass * 0.08), hdr ? 1 : 0, hairNow, 0], 44);
      device.queue.writeBuffer(ubo, 0, uarr);

      const enc = device.createCommandEncoder();
      {
        // fade prev accum into cur, then add this frame's sprites
        const pass = enc.beginRenderPass({ colorAttachments: [{
          view: texB.createView(), loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }] });
        pass.setBindGroup(0, bgA);
        pass.setPipeline(fadePipe);
        pass.draw(3);
        pass.setPipeline(accumSprites);
        pass.setVertexBuffer(0, accumBuf);
        pass.setVertexBuffer(1, velBuf);
        pass.draw(4, N_P + N_STARS);
        pass.end();
      }
      {
        // present: tonemapped trails, smoke over, planets occlude, cores on top
        const pass = enc.beginRenderPass({ colorAttachments: [{
          view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }] });
        pass.setBindGroup(0, bgB);
        pass.setPipeline(blitPipe);
        pass.draw(3);
        pass.setVertexBuffer(0, sceneBuf);
        pass.setVertexBuffer(1, zeroVel);
        pass.setPipeline(canvasAlpha);
        pass.draw(4, N_SMOKE, 0, 0);
        pass.draw(4, N_EM, 0, planet0);
        pass.setPipeline(canvasAdd);
        pass.draw(4, N_EM, 0, core0);
        pass.end();
      }
      device.queue.submit([enc.finish()]);
      const tT = texA; texA = texB; texB = tT;
      const tG = bgA; bgA = bgB; bgB = tG;
    }
    requestAnimationFrame(frame);

    return {
      backend: hdr ? 'webgpu · hdr' : 'webgpu',
      get paletteName() { return palMix.name; },
      setActive(on) { active = on; if (on) lastT = 0; },
      resize,
      randomize() { return setMode(modeIdx + 1 + (Math.random() * 2 | 0)); },
      cyclePalette() { pal = (pal + 1) % PALETTES.length; palMix = resolvePalette(pal); return palMix.name; },
    };
  }

  // ── v1 fallback: the WebGL1 single-dipole engine ─────────────────────────
  function createGL({ canvas, getAudio }) {
    const gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false,
      preserveDrawingBuffer: true, powerPreference: 'high-performance',
    });
    if (!gl) return null;
    const PARTICLES = 5200, STARS = 260;
    const VS = 'attribute vec3 aPos; attribute float aHue; attribute float aMag;' +
      'uniform mat4 uMvp; uniform float uSize; varying float vHue; varying float vMag;' +
      'void main() { vec4 p = uMvp * vec4(aPos, 1.0); gl_Position = p;' +
      'gl_PointSize = clamp(uSize * aMag / max(0.6, p.w), 1.5, 40.0); vHue = aHue; vMag = aMag; }';
    const FS = 'precision mediump float; uniform vec3 uColA, uColB, uColC;' +
      'varying float vHue; varying float vMag;' +
      'void main() { vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d) * 4.0;' +
      'float glow = exp(-4.5 * r2); float core = exp(-30.0 * r2);' +
      'vec3 col = mix(uColB, uColC, vHue);' +
      'gl_FragColor = vec4((col * glow * 0.72 + uColA * core * 0.9) * vMag, 1.0); }';
    const FADE_VS = 'attribute vec2 aXY; void main() { gl_Position = vec4(aXY, 0.0, 1.0); }';
    const FADE_FS = 'precision mediump float; uniform vec4 uFade; void main() { gl_FragColor = uFade; }';
    function compile(vsSrc, fsSrc) {
      const mk = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    const prog = compile(VS, FS), fade = compile(FADE_VS, FADE_FS);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aHue = gl.getAttribLocation(prog, 'aHue');
    const aMag = gl.getAttribLocation(prog, 'aMag');
    const uMvp = gl.getUniformLocation(prog, 'uMvp');
    const uSize = gl.getUniformLocation(prog, 'uSize');
    const uColA = gl.getUniformLocation(prog, 'uColA');
    const uColB = gl.getUniformLocation(prog, 'uColB');
    const uColC = gl.getUniformLocation(prog, 'uColC');
    const fXY = gl.getAttribLocation(fade, 'aXY');
    const fFade = gl.getUniformLocation(fade, 'uFade');
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const STRIDE = 5;
    const data = new Float32Array((PARTICLES + STARS) * STRIDE);
    const vel = new Float32Array(PARTICLES * 3);
    const buf = gl.createBuffer();
    let seed = (Math.random() * 2147483646 + 1) | 0;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let tilt = 0.35, precess = 0.12, charge = 1, swirl = 0.6;
    function respawn(i, burst) {
      const o = i * STRIDE;
      const pole = (i & 1) ? 1 : -1;
      const r = 0.22 + rnd() * 0.5;
      const a = rnd() * Math.PI * 2;
      data[o] = Math.cos(a) * r * 0.5;
      data[o + 1] = pole * (0.55 + rnd() * 0.4);
      data[o + 2] = Math.sin(a) * r * 0.5;
      const v = i * 3;
      vel[v] = (rnd() - 0.5) * 0.15;
      vel[v + 1] = -pole * (0.1 + rnd() * 0.25);
      vel[v + 2] = (rnd() - 0.5) * 0.15;
      if (burst) { vel[v] *= 6; vel[v + 1] *= 3; vel[v + 2] *= 6; }
      data[o + 3] = rnd() < 0.62 ? rnd() * 0.3 : 0.68 + rnd() * 0.32;
      data[o + 4] = 0.5 + rnd() * 0.8;
    }
    for (let i = 0; i < PARTICLES; i++) respawn(i, false);
    for (let i = 0; i < STARS; i++) {
      const o = (PARTICLES + i) * STRIDE;
      const th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
      const R = 14 + rnd() * 18;
      data[o] = R * Math.sin(ph) * Math.cos(th);
      data[o + 1] = R * Math.cos(ph);
      data[o + 2] = R * Math.sin(ph) * Math.sin(th);
      data[o + 3] = 0.45 + rnd() * 0.1;
      data[o + 4] = 0.16 + rnd() * 0.2;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    let an = null, fd2 = null, td2 = null;
    function ensureAudio() {
      if (an || !getAudio) return;
      try {
        const { ctx, srcNode } = getAudio();
        an = ctx.createAnalyser();
        an.fftSize = 256; an.smoothingTimeConstant = 0.72;
        fd2 = new Uint8Array(an.frequencyBinCount);
        td2 = new Uint8Array(an.fftSize);
        srcNode.connect(an);
      } catch (e) {}
    }
    let pal = 0, palMix = resolvePalette(0), active = false, started = false;
    let bassAvg = 0.08, lastT = 0, camA = 0;
    const M = new Float32Array(16);
    function frame(tms) {
      requestAnimationFrame(frame);
      if (!active) { lastT = 0; return; }
      const t = tms * 0.001;
      const dt = Math.min(0.05, lastT ? t - lastT : 0.016);
      lastT = t;
      ensureAudio();
      let bass = 0, mids = 0, rms = 0;
      if (an) {
        an.getByteFrequencyData(fd2);
        for (let i = 1; i < 10; i++) bass += fd2[i];
        bass /= 9 * 255;
        for (let i = 20; i < 60; i++) mids += fd2[i];
        mids /= 40 * 255;
        an.getByteTimeDomainData(td2);
        for (let i = 0; i < td2.length; i += 4) { const v = (td2[i] - 128) / 128; rms += v * v; }
        rms = Math.sqrt(rms / (td2.length / 4));
      }
      bassAvg += (bass - bassAvg) * 0.04;
      const punch = Math.max(0, bass - bassAvg * 1.25);
      const ax = Math.sin(t * precess) * tilt, az = Math.cos(t * precess * 0.83) * tilt;
      const mx = Math.sin(ax), mz = Math.sin(az);
      const my = Math.sqrt(Math.max(0, 1 - mx * mx - mz * mz));
      const drive = 1 + bass * 3.2;
      const burstN = punch > 0.08 ? Math.floor(punch * 260) : 0;
      for (let b = 0; b < burstN; b++) respawn((Math.random() * PARTICLES) | 0, true);
      for (let i = 0; i < PARTICLES; i++) {
        const o = i * STRIDE, v = i * 3;
        let x = data[o], y = data[o + 1], z = data[o + 2];
        const r2 = x * x + y * y + z * z;
        const r = Math.sqrt(r2) + 1e-4;
        const nx = x / r, ny = y / r, nz = z / r;
        const md = mx * nx + my * ny + mz * nz;
        const ir3 = 1 / (r2 * r + 0.02);
        let bxx = (3 * md * nx - mx) * ir3;
        let byy = (3 * md * ny - my) * ir3;
        let bzz = (3 * md * nz - mz) * ir3;
        const bl = Math.hypot(bxx, byy, bzz) + 1e-5;
        bxx /= bl; byy /= bl; bzz /= bl;
        const dir = (i & 1) ? charge : -charge;
        const sw = swirl / (r + 0.4);
        vel[v] += (bxx * dir * 1.6 + (my * z - mz * y) * sw - x * 0.06) * dt * drive;
        vel[v + 1] += (byy * dir * 1.6 + (mz * x - mx * z) * sw - y * 0.06) * dt * drive;
        vel[v + 2] += (bzz * dir * 1.6 + (mx * y - my * x) * sw - z * 0.06) * dt * drive;
        vel[v] *= 0.988; vel[v + 1] *= 0.988; vel[v + 2] *= 0.988;
        x += vel[v] * dt; y += vel[v + 1] * dt; z += vel[v + 2] * dt;
        data[o] = x; data[o + 1] = y; data[o + 2] = z;
        if (r < 0.16 || r > 6.5) respawn(i, false);
        data[o + 4] = 0.42 + data[o + 3] * 0.25 + rms * 1.9 + (i % 7 === 0 ? punch * 3.5 : 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      camA += dt * (0.11 + mids * 0.25);
      const dist = 4.6 - mids * 1.2;
      const eye = [Math.cos(camA) * dist, Math.sin(camA * 0.6) * 1.6, Math.sin(camA) * dist];
      mvp(M, eye, canvas.width / Math.max(1, canvas.height), t, 1.6);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(fade);
      const bg = palMix.bg;
      gl.uniform4f(fFade, bg[0], bg[1], bg[2], 0.11 - Math.min(0.06, bass * 0.08));
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(fXY);
      gl.vertexAttribPointer(fXY, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(uMvp, false, M);
      gl.uniform1f(uSize, canvas.height * (0.017 + bass * 0.009));
      gl.uniform3fv(uColA, palMix.a);
      gl.uniform3fv(uColB, palMix.b);
      gl.uniform3fv(uColC, palMix.c);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.enableVertexAttribArray(aHue);
      gl.enableVertexAttribArray(aMag);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, STRIDE * 4, 0);
      gl.vertexAttribPointer(aHue, 1, gl.FLOAT, false, STRIDE * 4, 12);
      gl.vertexAttribPointer(aMag, 1, gl.FLOAT, false, STRIDE * 4, 16);
      gl.drawArrays(gl.POINTS, 0, PARTICLES + STARS);
    }
    function clearHard() {
      const bg = palMix.bg;
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    return {
      backend: 'webgl',
      get paletteName() { return palMix.name; },
      setActive(on) {
        active = on;
        if (on && !started) { started = true; requestAnimationFrame(frame); }
        if (on) clearHard();
      },
      resize(w, h) { canvas.width = w; canvas.height = h; clearHard(); },
      randomize() {
        seed = (Math.random() * 2147483646 + 1) | 0;
        tilt = 0.15 + rnd() * 0.75;
        precess = 0.05 + rnd() * 0.3;
        swirl = 0.2 + rnd() * 1.3;
        charge = rnd() < 0.5 ? 1 : -1;
        if (rnd() < 0.45) { pal = (pal + 1) % PALETTES.length; palMix = resolvePalette(pal); }
        for (let i = 0; i < PARTICLES; i++) respawn(i, false);
        return palMix.name;
      },
      cyclePalette() { pal = (pal + 1) % PALETTES.length; palMix = resolvePalette(pal); return palMix.name; },
    };
  }

  // facade: WebGPU when it's there, v1 WebGL otherwise; callers stay sync
  function create(opts) {
    const want = { active: false, w: 0, h: 0 };
    let impl = null;
    (async () => {
      try { impl = await createGPU(opts); } catch (e) { console.warn('magneto gpu failed:', e); impl = null; }
      if (!impl) impl = createGL(opts);
      if (!impl) return;
      if (want.w) impl.resize(want.w, want.h);
      impl.setActive(want.active);
    })();
    return {
      get backend() { return impl ? impl.backend : 'starting'; },
      get paletteName() { return impl ? impl.paletteName : ''; },
      setActive(on) { want.active = on; if (impl) impl.setActive(on); },
      resize(w, h) { want.w = w; want.h = h; if (impl) impl.resize(w, h); },
      randomize() { return impl ? impl.randomize() : ''; },
      cyclePalette() { return impl ? impl.cyclePalette() : ''; },
    };
  }

  window.ampMagneto = { create };
})();
