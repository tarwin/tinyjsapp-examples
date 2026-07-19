// murmur.js — a starling murmuration: thousands of tiny birds over a dusk
// sky, steered like the real thing — each bird aligns with the average
// velocity of its neighborhood (a coarse flow-field grid, O(n)), chases a
// wandering attractor, and jitters — which is exactly the recipe that makes
// those breathing, folding sheets. Bass tightens the flock; a hard beat
// sends a falcon through and the sheet blooms apart around it. Sunset sun
// burns past white on HDR displays. WebGPU, one pass, no dependencies.

(function () {
  const PALETTES = [
    { name: 'dusk', sky0: [0.98, 0.52, 0.18], sky1: [0.10, 0.12, 0.24], sun: [1.0, 0.75, 0.4], bird: [0.05, 0.045, 0.06], glow: 0, stars: 0 },
    { name: 'late dusk', sky0: [0.45, 0.2, 0.12], sky1: [0.015, 0.02, 0.06], sun: [1.0, 0.5, 0.25], bird: [0.03, 0.028, 0.04], glow: 0, stars: 1 },
    { name: 'dawn', sky0: [0.95, 0.7, 0.5], sky1: [0.35, 0.4, 0.6], sun: [1.0, 0.9, 0.7], bird: [0.08, 0.07, 0.09], glow: 0, stars: 0 },
    { name: 'storm', sky0: [0.35, 0.37, 0.42], sky1: [0.08, 0.09, 0.12], sun: [0.8, 0.8, 0.85], bird: [0.03, 0.03, 0.04], glow: 0, stars: 0 },
    { name: 'night swarm', sky0: [0.02, 0.03, 0.08], sky1: [0.0, 0.005, 0.02], sun: [0.7, 0.8, 1.0], bird: [0.55, 0.85, 1.0], glow: 1, stars: 1 },
  ];

  const N_B = 4200;
  const GRID = 10;             // flow-field cells per axis (10³)
  const WORLD = 3.2;           // half-extent of the flight box

  function mvp(out, eye, at, aspect, f) {
    const zn = 0.1, zf = 60;
    const up = [0, 1, 0];
    let z = [eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]];
    const zl = Math.hypot(z[0], z[1], z[2]); z = [z[0] / zl, z[1] / zl, z[2] / zl];
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
  sky0: vec4f, sky1: vec4f, sun: vec4f, bird: vec4f,
  audio: vec4f,     // time, bass, mids, punch
  misc: vec4f,      // fscaleX, fscaleY, glowMode, hdr
  sunPos: vec4f,    // uv of the sun, z = size
  scene: vec4f,     // ground on, trees on, stars on, unused
};
@group(0) @binding(0) var<uniform> u: U;

struct FSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vFull(@builtin(vertex_index) vi: u32) -> FSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  var o: FSOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = p[vi] * vec2f(0.5, -0.5) + 0.5;
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
fn fSky(v: FSOut) -> @location(0) vec4f {
  // dusk gradient with a smear of haze, and a low sun
  let g = pow(1.0 - v.uv.y, 1.15);       // warm horizon below, slate above
  var col = mix(u.sky0.rgb, u.sky1.rgb, g);
  let haze = vnoise(vec2f(v.uv.x * 5.0 + u.audio.x * 0.008, v.uv.y * 3.0)) * 0.5
           + vnoise(vec2f(v.uv.x * 11.0 - u.audio.x * 0.005, v.uv.y * 7.0)) * 0.25;
  col += u.sky0.rgb * haze * 0.12 * (1.0 - g) + u.sky0.rgb * haze * 0.05;
  let asp = u.misc.y / u.misc.x;                     // width / height
  let d = v.uv - u.sunPos.xy;
  let r = length(vec2f(d.x * asp, d.y));             // circular in PIXELS, always
  let disc = smoothstep(u.sunPos.z, u.sunPos.z * 0.72, r);
  let halo = exp(-r * 7.0);
  let hot = select(1.4, 3.2, u.misc.w > 0.5);        // HDR sun burns
  col += u.sun.rgb * (disc * hot + halo * 0.5 * (1.0 + u.audio.y * 0.6));
  // stars, when the light is late enough (scene.z) — strongest at the zenith
  if (u.scene.z > 0.5) {
    let sp = vec2f(v.uv.x * asp, v.uv.y) * 130.0;
    let cell = floor(sp);
    let h = hash2(cell);
    if (h > 0.994) {
      let fo = fract(sp) - 0.5;
      let sInt = exp(-dot(fo, fo) * 16.0) * (h - 0.994) / 0.006;
      let tw = 0.55 + 0.45 * sin(u.audio.x * 2.2 + h * 91.0);
      col += vec3f(0.85, 0.92, 1.0) * sInt * tw * smoothstep(0.7, 0.25, v.uv.y) * 1.7;
    }
  }
  // scenery silhouettes (scene.x = ground on, scene.y = trees on)
  let dark = vec3f(0.012, 0.011, 0.016);
  let gline = 0.86 + vnoise(vec2f(v.uv.x * 3.0, 7.7)) * 0.03;
  if (u.scene.x > 0.5) {
    col = mix(col, dark, smoothstep(gline - 0.004, gline + 0.01, v.uv.y));
  }
  return vec4f(col, 1.0);
}

// ── the trees: branch segments grown on the CPU, drawn as tapered quads ──
struct TOut {
  @builtin(position) pos: vec4f,
  @location(0) cy: f32,
};
@vertex
fn vTree(@builtin(vertex_index) vi: u32,
         @location(0) a: vec2f, @location(1) b: vec2f, @location(2) w2: vec2f) -> TOut {
  var cx = array<f32, 4>(0.0, 1.0, 0.0, 1.0);
  var cyy = array<f32, 4>(-1.0, -1.0, 1.0, 1.0);
  let along = cx[vi];
  let cy = cyy[vi];
  let asp = u.misc.y / u.misc.x;
  var dir = b - a;
  let dl = length(dir);
  if (dl > 1e-6) { dir = dir / dl; } else { dir = vec2f(0.0, 1.0); }
  let perp = vec2f(-dir.y, dir.x);
  let w = mix(w2.x, w2.y, along);
  let p = mix(a, b, along) + perp * cy * w + dir * select(-w * 1.6, w * 1.6, along > 0.5);
  var o: TOut;
  o.pos = vec4f((p.x / asp) * 2.0 - 1.0, 1.0 - 2.0 * p.y, 0.0, 1.0);
  o.cy = cy;
  return o;
}
@fragment
fn fTree(v: TOut) -> @location(0) vec4f {
  let a = 1.0 - pow(abs(v.cy), 4.0) * 0.4;   // opaque wood, soft only at the rim
  return vec4f(0.012, 0.011, 0.016, a);
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) corner: vec2f,
  @location(1) flap: f32,
  @location(2) depth: f32,
};
@vertex
fn vBird(@builtin(vertex_index) vi: u32,
         @location(0) ip: vec3f, @location(1) size: f32, @location(2) phase: f32,
         @location(3) ivel: vec3f) -> VOut {
  var corners = array<vec2f, 4>(vec2f(-1.0,-1.0), vec2f(1.0,-1.0), vec2f(-1.0,1.0), vec2f(1.0,1.0));
  let c = corners[vi];
  var p = u.mvp * vec4f(ip, 1.0);
  // orient along velocity in screen space, wings on the perpendicular
  let dv = (u.mvp * vec4f(ivel, 0.0)).xy;
  let dl = length(dv);
  var dir = vec2f(1.0, 0.0);
  if (dl > 1e-5) { dir = dv / dl; }
  let perp = vec2f(-dir.y, dir.x);
  let flap = sin(u.audio.x * 14.0 + phase * 11.0);
  // body long axis + wings that shorten as they beat
  let off = dir * (c.x * size * 1.6) + perp * (c.y * size * (1.6 + flap * 0.9));
  var o: VOut;
  o.pos = vec4f(p.xy + off * vec2f(u.misc.x, u.misc.y), p.zw);
  o.corner = c;
  o.flap = flap;
  o.depth = clamp(p.w * 0.14, 0.0, 1.0);
  return o;
}
@fragment
fn fBird(v: VOut) -> @location(0) vec4f {
  // a speck with wing lobes: dark against the sky (or luminous at night)
  let x = v.corner.x; let y = v.corner.y;
  let body = exp(-(x * x * 3.0 + y * y * 9.0));
  let wings = exp(-(x * x * 14.0 + pow(abs(y) - 0.55, 2.0) * 6.0)) * (0.6 + 0.4 * v.flap);
  var a = clamp(body + wings, 0.0, 1.0);
  a *= 1.0 - v.depth * 0.55;                         // haze eats the far birds
  if (u.misc.z > 0.5) {
    return vec4f(u.bird.rgb * a * (1.5 + u.audio.y), a * 0.9);   // night: glowing
  }
  return vec4f(u.bird.rgb, a * 0.92);
}`;

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
        console.error('murmur wgsl:', info.messages.map((m) => m.lineNum + ':' + m.message).join(' | '));
        return null;
      }
    }

    const UBYTES = 64 + 8 * 16;
    const ubo = device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    ] });
    const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubo } }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const ALPHA = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const skyPipe = device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vFull' },
      fragment: { module: mod, entryPoint: 'fSky', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const treePipe = device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vTree', buffers: [
        { arrayStride: 24, stepMode: 'instance', attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 8, format: 'float32x2' },
          { shaderLocation: 2, offset: 16, format: 'float32x2' },
        ] },
      ] },
      fragment: { module: mod, entryPoint: 'fTree', targets: [{ format, blend: ALPHA }] },
      primitive: { topology: 'triangle-strip' },
    });
    const birdPipe = device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vBird', buffers: [
        { arrayStride: 20, stepMode: 'instance', attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32' },
          { shaderLocation: 2, offset: 16, format: 'float32' },
        ] },
        { arrayStride: 12, stepMode: 'instance', attributes: [
          { shaderLocation: 3, offset: 0, format: 'float32x3' },
        ] },
      ] },
      fragment: { module: mod, entryPoint: 'fBird', targets: [{ format, blend: ALPHA }] },
      primitive: { topology: 'triangle-strip' },
    });

    let W = 2, H = 2;
    function resize(w, h) {
      W = Math.max(2, w | 0); H = Math.max(2, h | 0);
      canvas.width = W; canvas.height = H;
    }

    // ── the flock ──────────────────────────────────────────────────────────
    const pos = new Float32Array(N_B * 3);
    const vel = new Float32Array(N_B * 3);
    const phase = new Float32Array(N_B);
    for (let i = 0; i < N_B; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 2;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 1.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 2;
      vel[i * 3] = (Math.random() - 0.5);
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
      vel[i * 3 + 2] = (Math.random() - 0.5);
      phase[i] = Math.random() * 6.28;
    }
    // coarse flow field: per-cell velocity average from last frame
    const NC = GRID * GRID * GRID;
    const cellV = new Float32Array(NC * 3);
    const cellP = new Float32Array(NC * 3);
    const cellN = new Float32Array(NC);
    const cellOf = (x, y, z) => {
      const gx = Math.min(GRID - 1, Math.max(0, ((x + WORLD) / (2 * WORLD) * GRID) | 0));
      const gy = Math.min(GRID - 1, Math.max(0, ((y + WORLD) / (2 * WORLD) * GRID) | 0));
      const gz = Math.min(GRID - 1, Math.max(0, ((z + WORLD) / (2 * WORLD) * GRID) | 0));
      return (gx * GRID + gy) * GRID + gz;
    };
    // trilinear sample of the flow field — smooth across cell walls, which is
    // what stops the flock printing the grid as strings of birds
    const fieldV = [0, 0, 0];
    function sampleField(x, y, z) {
      const fx = Math.min(GRID - 1.001, Math.max(0, (x + WORLD) / (2 * WORLD) * GRID - 0.5));
      const fy = Math.min(GRID - 1.001, Math.max(0, (y + WORLD) / (2 * WORLD) * GRID - 0.5));
      const fz = Math.min(GRID - 1.001, Math.max(0, (z + WORLD) / (2 * WORLD) * GRID - 0.5));
      const x0 = fx | 0, y0 = fy | 0, z0 = fz | 0;
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      fieldV[0] = 0; fieldV[1] = 0; fieldV[2] = 0;
      for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
        const c = ((Math.min(GRID - 1, x0 + dx) * GRID + Math.min(GRID - 1, y0 + dy)) * GRID + Math.min(GRID - 1, z0 + dz));
        const n = cellN[c];
        if (!n) continue;
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz) / n;
        fieldV[0] += cellV[c * 3] * w;
        fieldV[1] += cellV[c * 3 + 1] * w;
        fieldV[2] += cellV[c * 3 + 2] * w;
      }
      return fieldV;
    }

    const instData = new Float32Array(N_B * 5);
    const instBuf = device.createBuffer({ size: instData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const velData = new Float32Array(N_B * 3);
    const velBuf = device.createBuffer({ size: velData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

    let an = null, fd = null;
    function ensureAudio() {
      if (an || !getAudio) return;
      try {
        const { ctx: ac, srcNode } = getAudio();
        an = ac.createAnalyser();
        an.fftSize = 256; an.smoothingTimeConstant = 0.72;
        fd = new Uint8Array(an.frequencyBinCount);
        srcNode.connect(an);
      } catch (e) {}
    }

    let pal = 0, palMix = PALETTES[0];
    let sceneGround = 1, sceneTrees = 1;
    // sun wanders and changes size between scenes
    let sunX = 0.72, sunY = 0.78, sunR = 0.055;
    // trees are GROWN: recursive branching with kinks, taper, and the odd
    // broken limb — dead-tree rules (no leaves, high angle jitter)
    const MAX_SEGS = 2400;
    const segData = new Float32Array(MAX_SEGS * 6);
    let nSegs = 0;
    let plantedAspect = 16 / 9;
    function grow(x, y, ang, len, w, depth, maxD) {
      if (nSegs >= MAX_SEGS - 1 || depth > maxD || w < 0.00045 || len < 0.004) return;
      // the branch itself, with a mid-kink so nothing is ruler-straight
      const kink = (Math.random() - 0.5) * 0.22;
      const mx = x + Math.sin(ang + kink) * len * 0.5;
      const my = y - Math.cos(ang + kink) * len * 0.5;
      const ex = mx + Math.sin(ang) * len * 0.5;
      const ey = my - Math.cos(ang) * len * 0.5;
      const wEnd = w * 0.72;
      let o = nSegs * 6;
      segData[o] = x; segData[o + 1] = y; segData[o + 2] = mx; segData[o + 3] = my;
      segData[o + 4] = w; segData[o + 5] = (w + wEnd) / 2;
      nSegs++;
      o = nSegs * 6;
      segData[o] = mx; segData[o + 1] = my; segData[o + 2] = ex; segData[o + 3] = ey;
      segData[o + 4] = (w + wEnd) / 2; segData[o + 5] = wEnd;
      nSegs++;
      if (Math.random() < 0.08 && depth >= 3) return;             // snapped limb (never the trunk)
      // continuation drifts back toward vertical, plus jitter
      const cont = ang * 0.82 + (Math.random() - 0.5) * 0.5;
      grow(ex, ey, cont, len * (0.72 + Math.random() * 0.14), wEnd, depth + 1, maxD);
      // side limbs, alternating, wide dead-tree angles
      const side = Math.random() < 0.5 ? 1 : -1;
      if (Math.random() < (depth >= 3 ? 0.92 : 0.85)) {
        grow(ex, ey, ang + side * (0.5 + Math.random() * 0.55), len * (0.55 + Math.random() * 0.2), wEnd * 0.75, depth + 1, maxD);
      }
      if (Math.random() < 0.45 && depth >= 1) {
        grow(ex, ey, ang - side * (0.45 + Math.random() * 0.6), len * (0.5 + Math.random() * 0.2), wEnd * 0.7, depth + 1, maxD);
      }
    }
    function plantTrees(aspect) {
      plantedAspect = aspect;
      nSegs = 0;
      // far trees standing on the ground line…
      const n = 1 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const sc = 0.09 + Math.random() * 0.22;
        grow(
          (0.06 + Math.random() * 0.88) * aspect,
          0.875,
          (Math.random() - 0.5) * 0.24,
          sc * 0.30, sc * 0.055, 0, 7 + (Math.random() * 2 | 0),
        );
      }
      // …and sometimes one giant in the foreground, crown-only in frame
      if (Math.random() < 0.45) {
        const sc = 0.75 + Math.random() * 0.8;
        grow(
          (0.15 + Math.random() * 0.7) * aspect,
          1.15 + Math.random() * 0.35,
          (Math.random() - 0.5) * 0.3,
          sc * 0.30, sc * 0.05, 0, 9,
        );
      }
      device.queue.writeBuffer(segBuf, 0, segData, 0, nSegs * 6);
    }
    const segBuf = device.createBuffer({ size: segData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    plantTrees(16 / 9);
    let bassAvg = 0.08, lastT = 0, active = false;
    let falcon = null;                     // { pos, vel, ttl } during a strike
    const M = new Float32Array(16);
    const uarr = new Float32Array(UBYTES / 4);

    function frame(tms) {
      requestAnimationFrame(frame);
      if (!active) { lastT = 0; return; }
      const t = tms * 0.001;
      const dt = Math.min(0.05, lastT ? t - lastT : 0.016);
      lastT = t;

      ensureAudio();
      let bass = 0, mids = 0;
      if (an) {
        an.getByteFrequencyData(fd);
        for (let i = 1; i < 10; i++) bass += fd[i];
        bass /= 9 * 255;
        for (let i = 20; i < 60; i++) mids += fd[i];
        mids /= 40 * 255;
      }
      bassAvg += (bass - bassAvg) * 0.04;
      const punch = Math.max(0, bass - bassAvg * 1.25);

      // the wandering roost-point the flock loosely follows
      const T = [Math.sin(t * 0.21) * 1.6 + Math.sin(t * 0.07) * 0.7,
                 Math.sin(t * 0.16) * 0.8,
                 Math.cos(t * 0.19) * 1.6 + Math.cos(t * 0.05) * 0.7];
      // a hard beat launches the falcon through the middle of the flock
      if (punch > 0.12 && !falcon) {
        const a = Math.random() * Math.PI * 2;
        falcon = { pos: [Math.cos(a) * 3, 0.6, Math.sin(a) * 3],
                   vel: [-Math.cos(a) * 3.2, -0.35, -Math.sin(a) * 3.2], ttl: 2.2 };
      }
      if (falcon) {
        falcon.pos[0] += falcon.vel[0] * dt;
        falcon.pos[1] += falcon.vel[1] * dt;
        falcon.pos[2] += falcon.vel[2] * dt;
        falcon.ttl -= dt;
        if (falcon.ttl <= 0) falcon = null;
      }

      // rebuild the flow field from last frame's velocities (O(n))
      cellV.fill(0); cellP.fill(0); cellN.fill(0);
      for (let i = 0; i < N_B; i++) {
        const c = cellOf(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        cellV[c * 3] += vel[i * 3];
        cellV[c * 3 + 1] += vel[i * 3 + 1];
        cellV[c * 3 + 2] += vel[i * 3 + 2];
        cellP[c * 3] += pos[i * 3];
        cellP[c * 3 + 1] += pos[i * 3 + 1];
        cellP[c * 3 + 2] += pos[i * 3 + 2];
        cellN[c]++;
      }

      const cohesion = 0.22 + bass * 0.85;   // the flock breathes with the low end
      const speed = 0.9 + mids * 0.8;
      for (let i = 0; i < N_B; i++) {
        const o = i * 3;
        const c = cellOf(pos[o], pos[o + 1], pos[o + 2]);
        const n = Math.max(1, cellN[c]);
        // align with a SMOOTH sample of the neighborhood flow
        const F = sampleField(pos[o], pos[o + 1], pos[o + 2]);
        vel[o] += (F[0] - vel[o]) * 1.5 * dt;
        vel[o + 1] += (F[1] - vel[o + 1]) * 1.5 * dt;
        vel[o + 2] += (F[2] - vel[o + 2]) * 1.5 * dt;
        // separation: crowded cells push their birds apart
        const crowd = Math.min(2.2, n / 85);
        if (crowd > 0.15) {
          const sx = pos[o] - cellP[c * 3] / n, sy = pos[o + 1] - cellP[c * 3 + 1] / n, sz = pos[o + 2] - cellP[c * 3 + 2] / n;
          const sl = Math.hypot(sx, sy, sz) + 0.08;   // soft core so cell walls don't print
          const k = crowd * 1.1 * dt / sl;
          vel[o] += sx * k; vel[o + 1] += sy * k; vel[o + 2] += sz * k;
        }
        // chase the roost
        vel[o] += (T[0] - pos[o]) * cohesion * dt;
        vel[o + 1] += (T[1] - pos[o + 1]) * cohesion * 1.4 * dt;
        vel[o + 2] += (T[2] - pos[o + 2]) * cohesion * dt;
        // individuality
        vel[o] += Math.sin(t * 1.3 + phase[i] * 7.1) * 0.85 * dt;
        vel[o + 1] += Math.cos(t * 1.7 + phase[i] * 5.3) * 0.6 * dt;
        vel[o + 2] += Math.sin(t * 1.1 + phase[i] * 3.7) * 0.85 * dt;
        // flee the falcon
        if (falcon) {
          const dx = pos[o] - falcon.pos[0], dy = pos[o + 1] - falcon.pos[1], dz = pos[o + 2] - falcon.pos[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 1.2) {
            const k = 5.5 * dt / (d2 + 0.05);
            vel[o] += dx * k; vel[o + 1] += dy * k; vel[o + 2] += dz * k;
          }
        }
        // stay in the sky
        if (pos[o + 1] < -1.4) vel[o + 1] += 2.2 * dt;
        if (pos[o + 1] > 1.8) vel[o + 1] -= 1.8 * dt;
        const sp = Math.hypot(vel[o], vel[o + 1], vel[o + 2]);
        const cap = speed;
        const floor2 = speed * 0.45;
        if (sp > cap) { const k = cap / sp; vel[o] *= k; vel[o + 1] *= k; vel[o + 2] *= k; }
        else if (sp < floor2 && sp > 1e-4) { const k = floor2 / sp; vel[o] *= k; vel[o + 1] *= k; vel[o + 2] *= k; }
        pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
        const io = i * 5;
        instData[io] = pos[o]; instData[io + 1] = pos[o + 1]; instData[io + 2] = pos[o + 2];
        instData[io + 3] = 0.0075;
        instData[io + 4] = phase[i];
        velData[o] = vel[o]; velData[o + 1] = vel[o + 1]; velData[o + 2] = vel[o + 2];
      }
      device.queue.writeBuffer(instBuf, 0, instData);
      device.queue.writeBuffer(velBuf, 0, velData);

      const aspect = W / Math.max(1, H);
      const f = 1.5;
      const camA = t * 0.05;
      const eye = [Math.cos(camA) * 4.6, 0.4, Math.sin(camA) * 4.6];
      mvp(M, eye, [T[0] * 0.4, T[1] * 0.4 + 0.15, T[2] * 0.4], aspect, f);

      uarr.set(M, 0);
      uarr.set([...palMix.sky0, 1], 16);
      uarr.set([...palMix.sky1, 1], 20);
      uarr.set([...palMix.sun, 1], 24);
      uarr.set([...palMix.bird, 1], 28);
      uarr.set([t, bass, mids, punch], 32);
      uarr.set([f / aspect, f, palMix.glow, hdr ? 1 : 0], 36);
      if (Math.abs(aspect - plantedAspect) > 0.04) plantTrees(aspect);
      uarr.set([sunX, sunY, sunR, 0], 40);
      uarr.set([sceneGround, sceneTrees, palMix.stars || 0, 0], 44);
      device.queue.writeBuffer(ubo, 0, uarr);

      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{
        view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }] });
      pass.setBindGroup(0, bg);
      pass.setPipeline(skyPipe);
      pass.draw(3);
      if (sceneTrees && nSegs) {
        pass.setPipeline(treePipe);
        pass.setVertexBuffer(0, segBuf);
        pass.draw(4, nSegs);
      }
      pass.setPipeline(birdPipe);
      pass.setVertexBuffer(0, instBuf);
      pass.setVertexBuffer(1, velBuf);
      pass.draw(4, N_B);
      pass.end();
      device.queue.submit([enc.finish()]);
    }
    requestAnimationFrame(frame);

    return {
      backend: hdr ? 'webgpu · hdr' : 'webgpu',
      get paletteName() { return palMix.name; },
      setActive(on) { active = on; if (on) lastT = 0; },
      resize,
      randomize() {
        pal = (pal + 1) % PALETTES.length;
        palMix = PALETTES[pal];
        sceneGround = Math.random() < 0.6 ? 1 : 0;
        sceneTrees = sceneGround && Math.random() < 0.65 ? 1 : 0;
        sunX = 0.15 + Math.random() * 0.7;
        sunY = 0.5 + Math.random() * 0.34;
        sunR = 0.028 + Math.random() * 0.085;
        plantTrees(plantedAspect);
        return palMix.name + (sceneTrees ? ' · dead trees' : sceneGround ? ' · open field' : ' · open sky');
      },
      cyclePalette() { pal = (pal + 1) % PALETTES.length; palMix = PALETTES[pal]; return palMix.name; },
    };
  }

  function create(opts) {
    const want = { active: false, w: 0, h: 0 };
    let impl = null;
    (async () => {
      try { impl = await createGPU(opts); } catch (e) { console.warn('murmur gpu failed:', e); impl = null; }
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

  window.ampMurmur = { create };
})();
