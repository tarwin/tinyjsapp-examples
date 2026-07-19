// ballroom.js — the Sony-Bravia-ad fantasy: a dark hall of intricate stairs
// with hundreds of glowing bouncy balls raining down them — iridescent ones
// shifting hue with the view, amber ones burning past white on HDR. Real 3D:
// instanced lit boxes with a depth buffer, ball impostors depth-tested
// against the steps, CPU physics (gravity + AABB bounces, restitution 0.82).
// A hard beat pours a fresh burst of balls in; bass swells the glow. WebGPU,
// no dependencies.

(function () {
  const PALETTES = [
    { name: 'bravia', key: [1.0, 0.9, 0.75], amber: [1.0, 0.62, 0.12], tint: [0.5, 0.7, 1.0] },
    { name: 'neon night', key: [0.7, 0.8, 1.0], amber: [0.2, 1.0, 0.6], tint: [1.0, 0.3, 0.8] },
    { name: 'golden hour', key: [1.0, 0.8, 0.55], amber: [1.0, 0.45, 0.1], tint: [1.0, 0.85, 0.4] },
  ];

  const N_BALLS = 420;
  const GRAV = -5.2;
  const REST = 0.82;

  function mvp(out, eye, at, aspect, f) {
    const zn = 0.1, zf = 80;
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
  key: vec4f, amber: vec4f, tint: vec4f,
  audio: vec4f,      // time, bass, mids, punch
  misc: vec4f,       // fscaleX, fscaleY, hdr, flash
  eye: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;

// ── boxes: 36 vertices of a unit cube with face normals, instanced ──
struct BoxV {
  @builtin(position) pos: vec4f,
  @location(0) n: vec3f,
  @location(1) wp: vec3f,
  @location(2) glow: vec3f,
};
fn cubeCorner(vi: u32) -> vec3f {
  // 6 faces × 2 triangles; positions in [-0.5, 0.5]
  var f = vi / 6u;          // face
  var v = vi % 6u;          // vert in face
  var quad = array<vec2f, 6>(vec2f(-0.5,-0.5), vec2f(0.5,-0.5), vec2f(0.5,0.5),
                             vec2f(-0.5,-0.5), vec2f(0.5,0.5), vec2f(-0.5,0.5));
  let q = quad[v];
  switch f {
    case 0u: { return vec3f(q.x, q.y, 0.5); }
    case 1u: { return vec3f(-q.x, q.y, -0.5); }
    case 2u: { return vec3f(0.5, q.y, -q.x); }
    case 3u: { return vec3f(-0.5, q.y, q.x); }
    case 4u: { return vec3f(q.x, 0.5, -q.y); }
    default: { return vec3f(q.x, -0.5, q.y); }
  }
}
fn cubeNormal(vi: u32) -> vec3f {
  switch vi / 6u {
    case 0u: { return vec3f(0.0, 0.0, 1.0); }
    case 1u: { return vec3f(0.0, 0.0, -1.0); }
    case 2u: { return vec3f(1.0, 0.0, 0.0); }
    case 3u: { return vec3f(-1.0, 0.0, 0.0); }
    case 4u: { return vec3f(0.0, 1.0, 0.0); }
    default: { return vec3f(0.0, -1.0, 0.0); }
  }
}
@vertex
fn vBox(@builtin(vertex_index) vi: u32,
        @location(0) bpos: vec3f, @location(1) bscale: vec3f,
        @location(2) bglow: vec3f) -> BoxV {
  let wp = cubeCorner(vi) * bscale + bpos;
  var o: BoxV;
  o.pos = u.mvp * vec4f(wp, 1.0);
  o.n = cubeNormal(vi);
  o.wp = wp;
  o.glow = bglow;
  return o;
}
@fragment
fn fBox(v: BoxV) -> @location(0) vec4f {
  // charcoal steps under one warm key light; fog swallows the far hall
  let L = normalize(vec3f(0.35, 0.9, 0.25));
  let nl = max(0.0, dot(v.n, L));
  let base = vec3f(0.085, 0.078, 0.082);
  var col = base * (0.4 + nl * 1.2) * u.key.rgb;
  col += vec3f(0.04) * max(0.0, v.n.y);                        // top faces catch a sheen
  // the balls light the hall a little — per-box bounce glow (fake GI)
  col += v.glow * (0.45 + max(0.0, v.n.y) * 0.55);
  let d = length(v.wp - u.eye.xyz);
  let fog = clamp(d * 0.07, 0.0, 0.92);
  col = mix(col, vec3f(0.004, 0.004, 0.006), fog);
  col *= 1.0 + u.misc.w * 0.5;                                 // beat flash
  return vec4f(col, 1.0);
}

// ── balls: billboard sphere impostors, depth-tested against the boxes ──
struct BallV {
  @builtin(position) pos: vec4f,
  @location(0) corner: vec2f,
  @location(1) hue: f32,
  @location(2) kindA: f32,     // 1 = amber emissive
  @location(3) wp: vec3f,
  @location(4) rad: f32,
};
@vertex
fn vBall(@builtin(vertex_index) vi: u32,
         @location(0) ip: vec3f, @location(1) rad: f32,
         @location(2) hue: f32, @location(3) kindA: f32) -> BallV {
  var corners = array<vec2f, 4>(vec2f(-1.0,-1.0), vec2f(1.0,-1.0), vec2f(-1.0,1.0), vec2f(1.0,1.0));
  let c = corners[vi];
  var p = u.mvp * vec4f(ip, 1.0);
  p = vec4f(p.xy + c * rad * 1.15 * vec2f(u.misc.x, u.misc.y), p.zw);
  var o: BallV;
  o.pos = p; o.corner = c; o.hue = hue; o.kindA = kindA; o.wp = ip; o.rad = rad;
  return o;
}
@fragment
fn fBall(v: BallV) -> @location(0) vec4f {
  let r2 = dot(v.corner, v.corner);
  if (r2 > 1.0) { discard; }
  // fake sphere normal + lighting
  let n = vec3f(v.corner, sqrt(max(0.0, 1.0 - r2)));
  let L = normalize(vec3f(0.35, 0.9, 0.45));
  let nl = max(0.0, dot(n, L));
  let spec = pow(max(0.0, dot(n, normalize(L + vec3f(0.0, 0.0, 1.0)))), 32.0);
  let fres = pow(1.0 - n.z, 2.0);
  let hdrK = select(1.0, 1.8, u.misc.z > 0.5);
  var col: vec3f;
  if (v.kindA > 0.5) {
    // amber: emissive glass
    col = u.amber.rgb * (0.55 + nl * 0.5) * (0.85 + u.audio.y * 1.0) * hdrK;
    col += u.amber.rgb * vec3f(1.0, 0.8, 0.6) * spec * 1.2;
  } else {
    // iridescent: hue rolls with the viewing angle
    let h = v.hue * 6.28 + fres * 4.0 + u.audio.x * 0.4;
    let irid = vec3f(0.5 + 0.5 * sin(h), 0.5 + 0.5 * sin(h + 2.09), 0.5 + 0.5 * sin(h + 4.19));
    col = irid * u.tint.rgb * (0.25 + nl * 0.75) * (1.0 + u.audio.y * 0.8);
    col += irid * fres * 0.9 * hdrK;
    col += vec3f(spec) * 1.2;
  }
  return vec4f(col, 1.0);
}
// soft additive halo around every ball (drawn after, no depth write)
@fragment
fn fHalo(v: BallV) -> @location(0) vec4f {
  let r2 = dot(v.corner, v.corner);
  let g = exp(-3.0 * r2);
  let hdrK = select(0.5, 1.1, u.misc.z > 0.5);
  var col = select(u.tint.rgb, u.amber.rgb, v.kindA > 0.5);
  return vec4f(col * g * hdrK * (0.4 + u.audio.y * 0.6), 1.0);
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
        console.error('ballroom wgsl:', info.messages.map((m) => m.lineNum + ':' + m.message).join(' | '));
        return null;
      }
    }

    const UBYTES = 64 + 6 * 16;
    const ubo = device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    ] });
    const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubo } }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const boxPipe = device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vBox', buffers: [
        { arrayStride: 36, stepMode: 'instance', attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x3' },
        ] },
      ] },
      fragment: { module: mod, entryPoint: 'fBox', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const BALLATTRS = [
      { arrayStride: 24, stepMode: 'instance', attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32' },
        { shaderLocation: 2, offset: 16, format: 'float32' },
        { shaderLocation: 3, offset: 20, format: 'float32' },
      ] },
    ];
    const ballPipe = device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vBall', buffers: BALLATTRS },
      fragment: { module: mod, entryPoint: 'fBall', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const haloPipe = device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vBall', buffers: BALLATTRS },
      fragment: { module: mod, entryPoint: 'fHalo', targets: [{ format, blend: ADD }] },
      primitive: { topology: 'triangle-strip' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });

    let W = 2, H = 2, depthTex = null;
    function resize(w, h) {
      W = Math.max(2, w | 0); H = Math.max(2, h | 0);
      canvas.width = W; canvas.height = H;
      if (depthTex) depthTex.destroy();
      depthTex = device.createTexture({
        size: [W, H], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }

    // ── the hall: staircases built from boxes (also the collision AABBs) ──
    const boxes = [];   // { x, y, z, sx, sy, sz, glow: [r,g,b] }
    const stairRuns = [];   // camera framing targets
    function addBox(x, y, z, sx, sy, sz) { boxes.push({ x, y, z, sx, sy, sz, glow: [0, 0, 0] }); }
    function buildStairs() {
      boxes.length = 0;
      stairRuns.length = 0;
      // the floor, as tiles, so the ball-glow pools locally on it
      for (let tx = -2; tx <= 2; tx++) for (let tz = -2; tz <= 2; tz++) {
        addBox(tx * 6, -2.15, tz * 6, 6, 0.3, 6);
      }
      const runs = 6;
      for (let r = 0; r < runs; r++) {
        const dir = r % 2 ? 1 : -1;
        const ox = (Math.random() - 0.5) * 6;
        const oz = -4 + r * 1.6 + (Math.random() - 0.5) * 1.2;
        const steps = 9 + (Math.random() * 5 | 0);
        const rise = 0.34, run = 0.62;
        const y0 = -2 + Math.random() * 0.5;
        for (let i = 0; i < steps; i++) {
          addBox(ox + dir * i * run, y0 + i * rise, oz, 1.6, 0.26, 1.15);
        }
        addBox(ox + dir * steps * run + dir * 0.6, y0 + steps * rise, oz, 2.2, 0.26, 1.6);
        stairRuns.push({ ox, oz, dir, y0, steps, rise, run });
      }
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        const R = 6.5 + Math.random() * 2.5;
        addBox(Math.cos(a) * R, 0.4, Math.sin(a) * R, 0.5, 5.5, 0.5);
      }
    }
    buildStairs();
    const boxData = new Float32Array(512 * 9);
    const boxBuf = device.createBuffer({ size: boxData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    function uploadBoxes() {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i], o = i * 9;
        boxData[o] = b.x; boxData[o + 1] = b.y; boxData[o + 2] = b.z;
        boxData[o + 3] = b.sx; boxData[o + 4] = b.sy; boxData[o + 5] = b.sz;
        boxData[o + 6] = b.glow[0]; boxData[o + 7] = b.glow[1]; boxData[o + 8] = b.glow[2];
      }
      device.queue.writeBuffer(boxBuf, 0, boxData, 0, boxes.length * 9);
    }
    uploadBoxes();

    // ── the balls ──
    const balls = Array.from({ length: N_BALLS }, () => ({
      x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0,
      r: 0, hue: 0, amber: 0, ttl: 0,
    }));
    function spawn(b) {
      b.x = (Math.random() - 0.5) * 8;
      b.y = 3.4 + Math.random() * 2.5;
      b.z = (Math.random() - 0.5) * 7;
      b.vx = (Math.random() - 0.5) * 1.6;
      b.vy = -Math.random() * 0.5;
      b.vz = (Math.random() - 0.5) * 1.6;
      b.r = 0.07 + Math.random() * 0.075;
      b.hue = Math.random();
      b.amber = Math.random() < 0.22 ? 1 : 0;
      b.ttl = 14 + Math.random() * 10;
      if (b.amber) { b.rgb = [1.0, 0.55, 0.12]; }
      else {
        const h = b.hue * 6.28;
        b.rgb = [0.5 + 0.5 * Math.sin(h), 0.5 + 0.5 * Math.sin(h + 2.09), 0.5 + 0.5 * Math.sin(h + 4.19)];
      }
    }
    for (let i = 0; i < N_BALLS * 0.4; i++) spawn(balls[i]);
    const ballData = new Float32Array(N_BALLS * 6);
    const ballBuf = device.createBuffer({ size: ballData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

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
    let bassAvg = 0.08, lastT = 0, active = false, flash = 0;
    // still camera, cut to a new framing every so often — the motion in this
    // piece belongs to the balls
    let shot = null, shotUntil = 0;
    function newShot(t) {
      const r = stairRuns[(Math.random() * stairRuns.length) | 0];
      const midI = r.steps * (0.35 + Math.random() * 0.3);
      const mx = r.ox + r.dir * midI * r.run;
      const my = r.y0 + midI * r.rise;
      const mz = r.oz;
      const side = Math.random() < 0.5 ? 1 : -1;
      const eye = [mx - r.dir * (2.4 + Math.random() * 1.8),
                   my + 0.9 + Math.random() * 1.2,
                   mz + side * (2.0 + Math.random() * 2.0)];
      const at = [mx + r.dir * 0.8, my + 0.3, mz];
      // a pier square in the lens ruins the shot — check the sightline
      for (const bx of boxes) {
        if (bx.sy < 2) continue;
        const ax = at[0] - eye[0], ay = at[1] - eye[1], az = at[2] - eye[2];
        const bxx = bx.x - eye[0], bxy = bx.y - eye[1], bxz = bx.z - eye[2];
        const L2 = ax * ax + ay * ay + az * az;
        const tt = Math.max(0, Math.min(1, (bxx * ax + bxy * ay + bxz * az) / L2));
        const dx = bxx - ax * tt, dy = bxy - ay * tt, dz = bxz - az * tt;
        if (dx * dx + dy * dy + dz * dz < 1.2) return newShot(t);   // blocked — reroll
      }
      shot = { eye, at };
      shotUntil = t + 8 + Math.random() * 6;
    }
    const M = new Float32Array(16);
    const uarr = new Float32Array(UBYTES / 4);

    function frame(tms) {
      requestAnimationFrame(frame);
      if (!active || !depthTex) { lastT = 0; return; }
      const t = tms * 0.001;
      const dt = Math.min(0.04, lastT ? t - lastT : 0.016);
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
      flash = Math.max(0, flash - dt * 2.2);
      if (punch > 0.1) {
        flash = Math.min(1, flash + punch * 2.5);
        let poured = 0;
        for (const b of balls) {
          if (b.ttl <= 0 && poured < 45) { spawn(b); poured++; }
        }
      }

      // physics: gravity, then resolve against every AABB
      for (let i = 0; i < N_BALLS; i++) {
        const b = balls[i];
        if (b.ttl <= 0) { ballData[i * 6 + 3] = 0; continue; }
        b.ttl -= dt;
        b.vy += GRAV * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        for (const bx of boxes) {
          const hx = bx.sx / 2 + b.r, hy = bx.sy / 2 + b.r, hz = bx.sz / 2 + b.r;
          const dx = b.x - bx.x, dy = b.y - bx.y, dz = b.z - bx.z;
          if (Math.abs(dx) > hx || Math.abs(dy) > hy || Math.abs(dz) > hz) continue;
          const px = hx - Math.abs(dx), py = hy - Math.abs(dy), pz = hz - Math.abs(dz);
          if (px < py && px < pz) {
            b.x += Math.sign(dx) * px;
            b.vx = Math.sign(dx) * Math.abs(b.vx) * REST;
          } else if (py < pz) {
            b.y += Math.sign(dy) * py;
            b.vy = Math.sign(dy) * Math.abs(b.vy) * REST;
            b.vx *= 0.995; b.vz *= 0.995;
          } else {
            b.z += Math.sign(dz) * pz;
            b.vz = Math.sign(dz) * Math.abs(b.vz) * REST;
          }
        }
        if (b.y < -6) spawn(b);
        const o = i * 6;
        ballData[o] = b.x; ballData[o + 1] = b.y; ballData[o + 2] = b.z;
        ballData[o + 3] = b.r;
        ballData[o + 4] = b.hue;
        ballData[o + 5] = b.amber;
      }
      device.queue.writeBuffer(ballBuf, 0, ballData);

      // fake GI: every box collects glow from the balls near it
      for (const bx of boxes) { bx.glow[0] = 0; bx.glow[1] = 0; bx.glow[2] = 0; }
      for (let i = 0; i < N_BALLS; i += 2) {
        const b = balls[i];
        if (b.ttl <= 0) continue;
        const gain = (b.amber ? 0.10 : 0.05) * (1 + mids * 1.2);
        for (const bx of boxes) {
          const dx = b.x - bx.x, dy = b.y - bx.y, dz = b.z - bx.z;
          const k = gain / (1 + (dx * dx + dy * dy + dz * dz) * 1.4);
          if (k < 0.004) continue;
          bx.glow[0] += b.rgb[0] * k;
          bx.glow[1] += b.rgb[1] * k;
          bx.glow[2] += b.rgb[2] * k;
        }
      }
      uploadBoxes();

      const aspect = W / Math.max(1, H);
      const f = 1.7;                                   // tighter lens, closer shots
      if (!shot || t > shotUntil || (punch > 0.16 && t > shotUntil - 6)) newShot(t);
      const drift = Math.sin(t * 0.4) * 0.04;          // barely-there breathing
      const eye = [shot.eye[0] + drift, shot.eye[1] + drift * 0.5, shot.eye[2] - drift];
      mvp(M, eye, shot.at, aspect, f);

      uarr.set(M, 0);
      uarr.set([...palMix.key, 1], 16);
      uarr.set([...palMix.amber, 1], 20);
      uarr.set([...palMix.tint, 1], 24);
      uarr.set([t, bass, mids, punch], 28);
      uarr.set([f / aspect, f, hdr ? 1 : 0, flash], 32);
      uarr.set([eye[0], eye[1], eye[2], 0], 36);
      device.queue.writeBuffer(ubo, 0, uarr);

      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0.004, g: 0.004, b: 0.006, a: 1 },
        }],
        depthStencilAttachment: {
          view: depthTex.createView(),
          depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1,
        },
      });
      pass.setBindGroup(0, bg);
      pass.setPipeline(boxPipe);
      pass.setVertexBuffer(0, boxBuf);
      pass.draw(36, boxes.length);
      pass.setPipeline(ballPipe);
      pass.setVertexBuffer(0, ballBuf);
      pass.draw(4, N_BALLS);
      pass.setPipeline(haloPipe);
      pass.setVertexBuffer(0, ballBuf);
      pass.draw(4, N_BALLS);
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
        buildStairs();
        uploadBoxes();
        return palMix.name + ' · new stairs';
      },
      cyclePalette() { pal = (pal + 1) % PALETTES.length; palMix = PALETTES[pal]; return palMix.name; },
    };
  }

  function create(opts) {
    const want = { active: false, w: 0, h: 0 };
    let impl = null;
    (async () => {
      try { impl = await createGPU(opts); } catch (e) { console.warn('ballroom gpu failed:', e); impl = null; }
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

  window.ampBallroom = { create };
})();
