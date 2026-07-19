// lagoon.js — "smoke/liquid" visualizer: a slab of slow liquid smoke (domain-
// warped noise, all in the fragment shader) with a small school of glowing
// fish swimming through it. The fish stir the liquid — each one drags a swirl
// through the smoke field — and they chase drifting plankton motes, pulsing
// bright when they eat. Bass drives their glow and hurry; a beat makes one
// dart. WebGPU with an rgba16float accumulation buffer for the mote trails,
// HDR canvas when the display can (probed render+readback, Geiss-style).

(function () {
  const PALETTES = [
    { name: 'deep lagoon', water0: [0.004, 0.02, 0.03], water1: [0.02, 0.10, 0.12], wisp: [0.14, 0.5, 0.5], fish: [1.0, 0.62, 0.2], fishB: [0.3, 0.9, 1.0], mote: [0.55, 1.0, 0.8] },
    { name: 'ink & koi', water0: [0.008, 0.008, 0.012], water1: [0.05, 0.05, 0.08], wisp: [0.28, 0.28, 0.38], fish: [1.0, 0.35, 0.12], fishB: [1.0, 0.9, 0.85], mote: [1.0, 0.8, 0.45] },
    { name: 'abyss', water0: [0.002, 0.004, 0.012], water1: [0.01, 0.03, 0.09], wisp: [0.1, 0.2, 0.5], fish: [0.5, 0.9, 1.0], fishB: [0.9, 0.5, 1.0], mote: [0.5, 0.8, 1.0] },
  ];

  const N_FISH = 9;
  const N_MOTE = 520;

  const WGSL = `
struct U {
  colW0: vec4f, colW1: vec4f, colWisp: vec4f,
  colFish: vec4f, colFishB: vec4f, colMote: vec4f,
  audio: vec4f,        // time, bass, mids, punch
  misc: vec4f,         // aspect, hdr, fade, glow
  fish: array<vec4f, 9>,   // xy = position (world), zw = velocity
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var prevTex: texture_2d<f32>;
@group(0) @binding(3) var denTex: texture_2d<f32>;

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
fn fbm(p0: vec2f) -> f32 {
  var p = p0;
  var v = 0.0; var a = 0.5;
  for (var i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return v;
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

// the liquid: a real advected density field (CPU fluid sim, uploaded as a
// texture each frame — the fish stir it by injecting velocity), plus a hint
// of fbm so the smoke keeps fine grain between sim cells
@fragment
fn fLiquid(v: FSOut) -> @location(0) vec4f {
  let t = u.audio.x;
  let w = vec2f((v.uv.x - 0.5) * u.misc.x, v.uv.y - 0.5) * 2.0;
  let den = textureSample(denTex, samp, v.uv).r;
  let det = fbm(w * 3.2 + vec2f(t * 0.05, -t * 0.033));
  let m = clamp(den * (1.5 + det * 1.2), 0.0, 1.7);
  let depthShade = 1.0 - v.uv.y * 0.35;
  var col = mix(u.colW0.rgb, u.colW1.rgb, (0.25 + m) * depthShade * (1.0 + u.audio.y * 0.6));
  col += u.colWisp.rgb * pow(m, 1.5) * (1.25 + u.audio.y * 1.1);
  let ray = pow(max(0.0, fbm(vec2f(w.x * 0.7 + t * 0.01, 0.4))), 3.0) * (1.0 - v.uv.y) * 0.3;
  col += u.colWisp.rgb * ray;
  return vec4f(col, 1.0);
}

@fragment
fn fFade(v: FSOut) -> @location(0) vec4f {
  let prev = textureSample(prevTex, samp, v.uv).rgb;
  return vec4f(prev * (1.0 - u.misc.z), 1.0);
}
@fragment
fn fBlit(v: FSOut) -> @location(0) vec4f {
  let c = textureSample(prevTex, samp, v.uv).rgb;
  if (u.misc.y > 0.5) { return vec4f(c, 1.0); }
  return vec4f(c / (1.0 + c * 0.4), 1.0);
}

// sprites: motes (kind 0, additive) and fish (kind 1, shaped)
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) corner: vec2f,
  @location(1) hue: f32,
  @location(2) mag: f32,
  @location(3) kind: f32,
  @location(4) phase: f32,
};
@vertex
fn vSprite(@builtin(vertex_index) vi: u32,
           @location(0) ip: vec2f, @location(1) size: f32, @location(2) hue: f32,
           @location(3) mag: f32, @location(4) kind: f32, @location(5) phase: f32,
           @location(6) ivel: vec2f) -> VOut {
  var corners = array<vec2f, 4>(vec2f(-1.0,-1.0), vec2f(1.0,-1.0), vec2f(-1.0,1.0), vec2f(1.0,1.0));
  let c = corners[vi];
  var off = c * size;
  if (kind > 0.5) {
    // fish orient along their velocity, body stretched 2.6:1
    let dl = length(ivel);
    var dir = vec2f(1.0, 0.0);
    if (dl > 1e-4) { dir = ivel / dl; }
    let perp = vec2f(-dir.y, dir.x);
    off = dir * (c.x * size * 2.6) + perp * (c.y * size);
  }
  let ndc = vec2f((ip.x + off.x) / u.misc.x, ip.y + off.y);
  var o: VOut;
  o.pos = vec4f(ndc.x, ndc.y, 0.0, 1.0);
  o.corner = c; o.hue = hue; o.mag = mag; o.kind = kind; o.phase = phase;
  return o;
}
@fragment
fn fSprite(v: VOut) -> @location(0) vec4f {
  if (v.kind < 0.5) {
    let r2 = dot(v.corner, v.corner);
    let g = exp(-5.0 * r2) * 0.55 + exp(-26.0 * r2);
    return vec4f(u.colMote.rgb * g * v.mag, 1.0);
  }
  // fish: capsule body + sine-wiggle tail, glowing rim
  let x = v.corner.x;            // -1 tail … +1 nose
  var y = v.corner.y;
  let t = u.audio.x;
  // tail sways harder toward the back
  let sway = sin(t * 9.0 + v.phase + x * 2.2) * 0.30 * (0.5 - x * 0.5);
  y += sway;
  let bodyW = 0.56 * (1.0 - x * x * 0.55) * (0.35 + 0.65 * smoothstep(-1.0, -0.2, x));
  let d = abs(y) / max(bodyW, 1e-3);
  if (d > 1.0) { discard; }
  let body = 1.0 - d * d;
  var belly = mix(u.colFishB.rgb, u.colFish.rgb, clamp(x * 0.5 + 0.5 + y, 0.0, 1.0));
  belly = mix(belly, u.colFishB.rgb, clamp(u.audio.w * 2.0, 0.0, 0.7));   // beats blanch them
  let rim = pow(1.0 - body, 2.0) * (0.8 + u.audio.y * 1.1);
  let eye = exp(-dot((v.corner - vec2f(0.62, 0.1)) * vec2f(9.0, 7.0), (v.corner - vec2f(0.62, 0.1)) * vec2f(9.0, 7.0)));
  var col = belly * (0.35 + body * 0.65) * v.mag * u.misc.w;
  col += u.colFishB.rgb * rim * v.mag;
  col -= vec3f(eye) * 0.8;
  return vec4f(max(col, vec3f(0.0)), body * 0.92);
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
        console.error('lagoon wgsl:', info.messages.map((m) => m.lineNum + ':' + m.message).join(' | '));
        return null;
      }
    }

    // uniforms: 6 colors + audio + misc + 9 fish vec4s
    const UBYTES = (6 + 1 + 1 + 9) * 16;
    const ubo = device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const bgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const full = (entry, target, blend) => device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vFull' },
      fragment: { module: mod, entryPoint: entry, targets: [{ format: target, blend }] },
      primitive: { topology: 'triangle-list' },
    });
    const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const ALPHA = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const ATTRS = { arrayStride: 24, stepMode: 'instance', attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
      { shaderLocation: 1, offset: 8, format: 'float32' },
      { shaderLocation: 2, offset: 12, format: 'float32' },
      { shaderLocation: 3, offset: 16, format: 'float32' },
      { shaderLocation: 5, offset: 20, format: 'float32' },
    ] };
    const VELATTRS = { arrayStride: 8, stepMode: 'instance', attributes: [
      { shaderLocation: 6, offset: 0, format: 'float32x2' },
    ] };
    // kind rides in a third tiny buffer so motes/fish share one layout
    const KINDATTRS = { arrayStride: 4, stepMode: 'instance', attributes: [
      { shaderLocation: 4, offset: 0, format: 'float32' },
    ] };
    const sprite = (target, blend) => device.createRenderPipeline({
      layout,
      vertex: { module: mod, entryPoint: 'vSprite', buffers: [ATTRS, VELATTRS, KINDATTRS] },
      fragment: { module: mod, entryPoint: 'fSprite', targets: [{ format: target, blend }] },
      primitive: { topology: 'triangle-strip' },
    });
    const liquidPipe = full('fLiquid', format);
    const fadePipe = full('fFade', 'rgba16float');
    const blitAdd = full('fBlit', format, ADD);
    const accumSprites = sprite('rgba16float', ADD);
    const fishPipe = sprite(format, ALPHA);

    // ── the fluid: a coarse semi-Lagrangian smoke sim the fish stir up ────
    const GW = 256, GH = 144;
    const fU = new Float32Array(GW * GH), fV = new Float32Array(GW * GH);
    const fU2 = new Float32Array(GW * GH), fV2 = new Float32Array(GW * GH);
    const den = new Float32Array(GW * GH), den2 = new Float32Array(GW * GH);
    const denU8 = new Uint8Array(GW * GH);
    const denTex = device.createTexture({
      size: [GW, GH], format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const bilin = (f, x, y) => {
      const x0 = Math.max(0, Math.min(GW - 1.001, x)), y0 = Math.max(0, Math.min(GH - 1.001, y));
      const xi = x0 | 0, yi = y0 | 0, tx = x0 - xi, ty = y0 - yi;
      const a = f[yi * GW + xi], b = f[yi * GW + xi + 1];
      const c = f[(yi + 1) * GW + xi], d = f[(yi + 1) * GW + xi + 1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
    function stepFluid(dt, t, aspect, bass) {
      const adv = dt * 42;                 // grid cells per second of drift
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          const i = y * GW + x;
          const sx = x - fU[i] * adv, sy = y - fV[i] * adv;
          fU2[i] = bilin(fU, sx, sy) * 0.992;
          fV2[i] = bilin(fV, sx, sy) * 0.992;
          den2[i] = bilin(den, sx, sy) * 0.9965;
        }
      }
      fU.set(fU2); fV.set(fV2); den.set(den2);
      // a slow ambient stir so the tank never goes still
      for (let k = 0; k < 3; k++) {
        const gx = (GW * (0.5 + 0.4 * Math.sin(t * 0.11 + k * 2.1))) | 0;
        const gy = (GH * (0.5 + 0.4 * Math.cos(t * 0.09 + k * 1.7))) | 0;
        const i = gy * GW + gx;
        den[i] = Math.min(1.4, den[i] + 0.05 + bass * 0.06);
        fU[i] += Math.sin(t * 0.5 + k) * 0.02;
        fV[i] += Math.cos(t * 0.4 + k) * 0.02;
      }
      for (let i = 0; i < GW * GH; i++) denU8[i] = Math.min(255, den[i] * 210) | 0;
      device.queue.writeTexture({ texture: denTex }, denU8, { bytesPerRow: GW }, { width: GW, height: GH });
    }
    // world → grid (world x spans [-aspect, aspect], y [-1, 1]; uv flips y)
    function inject(wx, wy, vx, vy, amt, aspect) {
      const gx = ((wx / aspect) * 0.5 + 0.5) * GW;
      const gy = (1 - (wy * 0.5 + 0.5)) * GH;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = (gx + dx) | 0, y = (gy + dy) | 0;
        if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
        const w = Math.exp(-(dx * dx + dy * dy) / 4);
        const i = y * GW + x;
        den[i] = Math.min(1.6, den[i] + amt * w * 1.8);
        fU[i] += vx * w * 0.9;
        fV[i] += -vy * w * 0.9;            // grid y runs downward
      }
    }

    let texA = null, texB = null, bgA = null, bgB = null, W = 2, H = 2;
    function mkBind(tex) {
      return device.createBindGroup({ layout: bgl, entries: [
        { binding: 0, resource: { buffer: ubo } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: tex.createView() },
        { binding: 3, resource: denTex.createView() },
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

    // ── the pond ───────────────────────────────────────────────────────────
    // world: x in [-aspect, aspect], y in [-1, 1]
    let pal = 0, palMix = PALETTES[0];
    const fish = Array.from({ length: N_FISH }, (_, i) => ({
      x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 1.6,
      vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2,
      phase: Math.random() * 6.28, size: 0.05 + Math.random() * 0.05,
      hue: Math.random(), pulse: 0, target: -1, dart: 0,
    }));
    const motes = Array.from({ length: N_MOTE }, () => ({
      x: (Math.random() - 0.5) * 3.4, y: (Math.random() - 0.5) * 2,
      vx: 0, vy: 0, phase: Math.random() * 6.28, mag: 0.4 + Math.random() * 0.6,
    }));

    const STRIDE = 6;
    const instData = new Float32Array((N_MOTE + N_FISH) * STRIDE);
    const instBuf = device.createBuffer({ size: instData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const velData = new Float32Array((N_MOTE + N_FISH) * 2);
    const velBuf = device.createBuffer({ size: velData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const kindData = new Float32Array(N_MOTE + N_FISH);
    kindData.fill(1, N_MOTE);
    const kindBuf = device.createBuffer({ size: kindData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(kindBuf, 0, kindData);

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

    let bassAvg = 0.08, lastT = 0, active = false;
    const uarr = new Float32Array(UBYTES / 4);

    function frame(tms) {
      requestAnimationFrame(frame);
      if (!active || !texA) { lastT = 0; return; }
      const t = tms * 0.001;
      const dt = Math.min(0.05, lastT ? t - lastT : 0.016);
      lastT = t;

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
      const aspect = W / Math.max(1, H);

      // ── motes drift in lazy curls ──
      for (let i = 0; i < N_MOTE; i++) {
        const m = motes[i];
        m.vx += Math.sin(t * 0.3 + m.phase + m.y * 2.1) * 0.010 * dt * 60;
        m.vy += Math.cos(t * 0.23 + m.phase + m.x * 1.7) * 0.008 * dt * 60;
        m.vx *= 0.97; m.vy *= 0.97;
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.x > aspect + 0.1) m.x = -aspect - 0.1;
        if (m.x < -aspect - 0.1) m.x = aspect + 0.1;
        if (m.y > 1.1) m.y = -1.1;
        if (m.y < -1.1) m.y = 1.1;
        const o = i * STRIDE;
        instData[o] = m.x; instData[o + 1] = m.y;
        instData[o + 2] = 0.012;
        instData[o + 3] = 0;
        instData[o + 4] = m.mag * (0.5 + 0.5 * Math.sin(t * 1.3 + m.phase)) * (0.7 + rms * 1.6);
        instData[o + 5] = m.phase;
        velData[i * 2] = m.vx; velData[i * 2 + 1] = m.vy;
      }
      // ── fish: wander, chase the nearest mote, pulse when they eat ──
      const hurry = 1 + bass * 0.45;   // audio shows in their bodies, not their hurry
      if (punch > 0.1) {
        const f = fish[(Math.random() * N_FISH) | 0];
        f.dart = 0.5;                       // a beat startles someone
      }
      for (let i = 0; i < N_FISH; i++) {
        const f = fish[i];
        // pick / keep a target mote
        if (f.target < 0 || Math.random() < 0.01) {
          let best = -1, bd = 1e9;
          for (let k = 0; k < 24; k++) {
            const j = (Math.random() * N_MOTE) | 0;
            const d = (motes[j].x - f.x) ** 2 + (motes[j].y - f.y) ** 2;
            if (d < bd) { bd = d; best = j; }
          }
          f.target = best;
        }
        const m = motes[f.target];
        let ax = (m.x - f.x), ay = (m.y - f.y);
        const al = Math.hypot(ax, ay) + 1e-4;
        // ate it?
        if (al < 0.06) {
          f.pulse = 1;
          m.x = (Math.random() - 0.5) * 2 * aspect;
          m.y = (Math.random() - 0.5) * 2;
          f.target = -1;
        }
        ax /= al; ay /= al;
        const wob = Math.sin(t * 1.7 + f.phase) * 0.35;
        f.vx += (ax * 0.35 * hurry + -ay * wob) * dt;
        f.vy += (ay * 0.35 * hurry + ax * wob) * dt;
        if (f.dart > 0) {
          f.dart -= dt;
          f.vx += Math.sin(f.phase * 9 + t) * 0.8 * dt;
          f.vy += Math.cos(f.phase * 7 + t) * 0.8 * dt;
        }
        // soft walls
        if (f.x > aspect - 0.15) f.vx -= 0.8 * dt;
        if (f.x < -aspect + 0.15) f.vx += 0.8 * dt;
        if (f.y > 0.85) f.vy -= 0.8 * dt;
        if (f.y < -0.85) f.vy += 0.8 * dt;
        const sp = Math.hypot(f.vx, f.vy);
        const cap = 0.55 * hurry;
        if (sp > cap) { f.vx *= cap / sp; f.vy *= cap / sp; }
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.pulse = Math.max(0, f.pulse - dt * 1.4);
        if (punch > 0.1 && Math.random() < punch * 2.5) f.pulse = Math.min(1.4, f.pulse + punch * 3);
        inject(f.x, f.y, f.vx, f.vy, 0.05 + Math.hypot(f.vx, f.vy) * 0.12, aspect);
        const o = (N_MOTE + i) * STRIDE;
        instData[o] = f.x; instData[o + 1] = f.y;
        instData[o + 2] = f.size * (1 + f.pulse * 0.30 + bass * 0.12);
        instData[o + 3] = f.hue;
        instData[o + 4] = 0.5 + bass * 1.7 + f.pulse * 1.8;
        instData[o + 5] = f.phase;
        velData[(N_MOTE + i) * 2] = f.vx; velData[(N_MOTE + i) * 2 + 1] = f.vy;
      }
      device.queue.writeBuffer(instBuf, 0, instData);
      device.queue.writeBuffer(velBuf, 0, velData);
      stepFluid(dt, t, aspect, bass);

      // uniforms
      const put = (o, v) => uarr.set(v, o);
      put(0, [...palMix.water0, 1]); put(4, [...palMix.water1, 1]); put(8, [...palMix.wisp, 1]);
      put(12, [...palMix.fish, 1]); put(16, [...palMix.fishB, 1]); put(20, [...palMix.mote, 1]);
      put(24, [t, bass, mids, punch]);
      put(28, [aspect, hdr ? 1 : 0, 0.055, hdr ? 1.9 : 1.1]);
      for (let i = 0; i < N_FISH; i++) put(32 + i * 4, [fish[i].x, fish[i].y, fish[i].vx, fish[i].vy]);
      device.queue.writeBuffer(ubo, 0, uarr);

      const enc = device.createCommandEncoder();
      {
        // mote trails accumulate
        const pass = enc.beginRenderPass({ colorAttachments: [{
          view: texB.createView(), loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }] });
        pass.setBindGroup(0, bgA);
        pass.setPipeline(fadePipe);
        pass.draw(3);
        pass.setPipeline(accumSprites);
        pass.setVertexBuffer(0, instBuf);
        pass.setVertexBuffer(1, velBuf);
        pass.setVertexBuffer(2, kindBuf);
        pass.draw(4, N_MOTE);
        pass.end();
      }
      {
        // liquid, then glowing motes over it, then the fish
        const pass = enc.beginRenderPass({ colorAttachments: [{
          view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }] });
        pass.setBindGroup(0, bgB);
        pass.setPipeline(liquidPipe);
        pass.draw(3);
        pass.setPipeline(blitAdd);
        pass.draw(3);
        pass.setVertexBuffer(0, instBuf);
        pass.setVertexBuffer(1, velBuf);
        pass.setVertexBuffer(2, kindBuf);
        pass.setPipeline(fishPipe);
        pass.draw(4, N_FISH, 0, N_MOTE);
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
      randomize() {
        pal = (pal + 1) % PALETTES.length;
        palMix = PALETTES[pal];
        for (const f of fish) { f.hue = Math.random(); f.size = 0.05 + Math.random() * 0.05; }
        return palMix.name;
      },
      cyclePalette() { pal = (pal + 1) % PALETTES.length; palMix = PALETTES[pal]; return palMix.name; },
    };
  }

  function create(opts) {
    const want = { active: false, w: 0, h: 0 };
    let impl = null;
    (async () => {
      try { impl = await createGPU(opts); } catch (e) { console.warn('lagoon gpu failed:', e); impl = null; }
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

  window.ampLagoon = { create };
})();
