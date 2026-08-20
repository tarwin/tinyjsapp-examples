// Lattice — the reference dual-backend amp visualizer.
//
// The thing worth copying here is the SHAPE, not the shader: one renderer-
// agnostic sim that owns all the state and every audio reaction, and two thin
// renderers hanging off it. Never fork the sim per backend — that is how the
// WebGL2 path quietly rots while you develop against WebGPU.
//
//   webgpu  — an rgba16float canvas with extended tone mapping when amp says
//             the display can take it (amp.hdr), so highlights go past white
//   webgl2  — the same passes in SDR, for machines with no navigator.gpu
//             (every WebKitGTK build today)
//
// The SDR roll-off c/(1+c*0.4) is applied in the shader whenever the canvas
// is not HDR, so the two backends agree about what "too bright" looks like.

amp.register({
  name: 'Lattice',
  backends: ['webgpu', 'webgl2'],
  presets: ['magma', 'tide', 'orchid', 'signal'],

  async create({ canvas, backend, hdr, width, height }) {
    const sim = createSim(width, height, hdr);
    let rend = null;
    if (backend === 'webgpu') rend = await createGPU(canvas, sim, hdr);
    if (!rend) rend = createGL2(canvas, sim);
    if (!rend) throw new Error('no renderer could start');

    return {
      get backend() { return rend.backend; },
      frame({ audio, dt, t }) { sim.step(audio, dt, t); rend.frame(); },
      resize(w, h) { sim.resize(w, h); rend.resize(w, h); },
      randomize() { return sim.randomize(); },
      preset(n) { return sim.preset(n); },
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// THE SIM — no GPU calls live here, only numbers. Both renderers read `u`.
// ═══════════════════════════════════════════════════════════════════════════
const PALETTES = [
  { name: 'magma',  a: [1.0, 0.42, 0.12], b: [0.55, 0.08, 0.45] },
  { name: 'tide',   a: [0.10, 0.65, 0.95], b: [0.35, 0.95, 0.70] },
  { name: 'orchid', a: [0.85, 0.35, 0.95], b: [0.25, 0.30, 0.95] },
  { name: 'signal', a: [0.95, 0.90, 0.25], b: [0.95, 0.25, 0.35] },
];

function createSim(width, height, hdr) {
  const u = new Float32Array(20);          // 5 × vec4, the renderers' whole input
  let pal = 0, pulse = 0, zoom = 1.6, warp = 0, W = width, H = height;

  function applyPal() {
    const p = PALETTES[pal];
    u[8] = p.a[0]; u[9] = p.a[1]; u[10] = p.a[2]; u[11] = hdr ? 1 : 0;
    u[12] = p.b[0]; u[13] = p.b[1]; u[14] = p.b[2]; u[15] = 0;
  }
  applyPal();
  u[16] = W; u[17] = H;

  return {
    u,
    get paletteName() { return PALETTES[pal].name; },
    resize(w, h) { W = w; H = h; u[16] = w; u[17] = h; },
    step(audio, dt, t) {
      // a beat kicks the fold; it decays on its own so the picture keeps moving
      // even through a quiet passage
      if (audio.beat) pulse = Math.min(1.6, pulse + 0.6 + audio.punch * 2);
      pulse *= Math.exp(-dt * 2.4);
      zoom += ((1.45 + audio.mid * 0.9) - zoom) * Math.min(1, dt * 1.5);
      warp += dt * (0.2 + audio.treb * 2.4);
      u[0] = t; u[1] = W / Math.max(1, H); u[2] = audio.bass; u[3] = audio.mid;
      u[4] = audio.treb; u[5] = audio.punch; u[6] = pulse;
      u[7] = 1 + (u[11] > 0.5 ? audio.punch * 2.2 : 0);   // HDR headroom on transients
      u[18] = zoom; u[19] = warp;
    },
    randomize() {
      pal = (pal + 1 + (Math.random() * (PALETTES.length - 1) | 0)) % PALETTES.length;
      applyPal();
      return PALETTES[pal].name;
    },
    preset(n) {
      if (typeof n === 'number') pal = (pal + n + PALETTES.length) % PALETTES.length;
      else { const i = PALETTES.findIndex((p) => p.name === String(n)); if (i >= 0) pal = i; }
      applyPal();
      return PALETTES[pal].name;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBGPU RENDERER
// ═══════════════════════════════════════════════════════════════════════════
const WGSL = `
struct U { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f };
@group(0) @binding(0) var<uniform> u: U;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let res = vec2f(u.e.x, u.e.y);
  let m = min(res.x, res.y);
  var uv = (fc.xy - 0.5 * res) / m;
  let t = u.a.x; let bass = u.a.z; let mid = u.a.w;
  let treb = u.b.x; let punch = u.b.y; let pulse = u.b.z; let gain = u.b.w;
  let ang = t * 0.07 + pulse * 0.35;
  let s = sin(ang); let c = cos(ang);
  var p = vec2f(uv.x * c - uv.y * s, uv.x * s + uv.y * c) * u.e.z;
  var col = vec3f(0.0);
  for (var i = 0; i < 5; i = i + 1) {
    let fi = f32(i);
    let k = 1.0 + fi * 0.7;
    let q = p * k + vec2f(sin(t * 0.23 + fi + u.e.w * 0.2), cos(t * 0.19 + fi * 1.7)) * (0.4 + bass * 1.3);
    let d = abs(sin(q.x * 3.0 + t * 0.5) * sin(q.y * 3.0 - t * 0.4));
    let band = pow(1.0 - clamp(d, 0.0, 1.0), 8.0 + treb * 26.0);
    col = col + mix(u.c.rgb, u.d.rgb, fi / 4.0) * band;
  }
  let r = length(uv);
  let vig = exp(-r * r * 1.3);
  var outc = col * (0.30 + bass * 2.2 + pulse * 1.4) * vig * gain;
  if (u.c.w < 0.5) { outc = outc / (1.0 + outc * 0.4); }   // SDR roll-off
  return vec4f(outc, 1.0);
}
`;

async function createGPU(canvas, sim, wantHdr) {
  if (!self.navigator || !navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    if (!ctx) return null;

    const pref = navigator.gpu.getPreferredCanvasFormat ? navigator.gpu.getPreferredCanvasFormat() : 'bgra8unorm';
    let format = pref, hdrOn = false;
    if (wantHdr) {
      try {
        ctx.configure({ device, format: 'rgba16float', alphaMode: 'opaque', toneMapping: { mode: 'extended' } });
        format = 'rgba16float'; hdrOn = true;
      } catch (e) { hdrOn = false; }
    }
    if (!hdrOn) ctx.configure({ device, format: pref, alphaMode: 'opaque' });

    const mod = device.createShaderModule({ code: WGSL });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const ubo = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }] });

    return {
      backend: hdrOn ? 'webgpu · hdr' : 'webgpu',
      resize() {},
      frame() {
        device.queue.writeBuffer(ubo, 0, sim.u);
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        device.queue.submit([enc.finish()]);
      },
    };
  } catch (e) { amp.log('webgpu path failed, falling back: ' + e.message); return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBGL2 RENDERER — the same passes, SDR only
// ═══════════════════════════════════════════════════════════════════════════
const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec4 u[5];
out vec4 fragColor;
void main() {
  vec2 res = vec2(u[4].x, u[4].y);
  float m = min(res.x, res.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * res) / m;
  uv.y = -uv.y;                       // GL is bottom-up; match the WebGPU image
  float t = u[0].x, bass = u[0].z, mid = u[0].w;
  float treb = u[1].x, punch = u[1].y, pulse = u[1].z, gain = u[1].w;
  float ang = t * 0.07 + pulse * 0.35;
  float s = sin(ang), c = cos(ang);
  vec2 p = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) * u[4].z;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float k = 1.0 + fi * 0.7;
    vec2 q = p * k + vec2(sin(t * 0.23 + fi + u[4].w * 0.2), cos(t * 0.19 + fi * 1.7)) * (0.4 + bass * 1.3);
    float d = abs(sin(q.x * 3.0 + t * 0.5) * sin(q.y * 3.0 - t * 0.4));
    float band = pow(1.0 - clamp(d, 0.0, 1.0), 8.0 + treb * 26.0);
    col += mix(u[2].rgb, u[3].rgb, fi / 4.0) * band;
  }
  float r = length(uv);
  float vig = exp(-r * r * 1.3);
  vec3 outc = col * (0.30 + bass * 2.2 + pulse * 1.4) * vig * gain;
  outc = outc / (1.0 + outc * 0.4);
  fragColor = vec4(outc, 1.0);
}`;

function createGL2(canvas, sim) {
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const loc = gl.getUniformLocation(prog, 'u');
  const vao = gl.createVertexArray();
  return {
    backend: 'webgl2',
    resize(w, h) { gl.viewport(0, 0, w, h); },
    frame() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform4fv(loc, sim.u);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
