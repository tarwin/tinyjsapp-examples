// magneto.js — a Magnetosphere-style visualizer, an homage to Robert Hodgin's
// 2007 iTunes visualizer (The Barbarian Group), v3. Built the way the original
// was: a few GRAVITIES (charged emitters) that repel one another and drift
// toward the centre, each holding a shell of charged PARTICLES; every particle
// listens to one SECTION of the spectrum, so a band that jumps kicks its
// particles off the shell, and each particle trails a RIBBON drawn through its
// own recent positions — the fine dandelion hair. Shells wrap a dark inner
// body with the core burning through it (hot centre, faint lens ring);
// some modes add lone dark planets that eclipse whatever is behind them.
// Colours are picked per particle from a small swatch set, the way the
// original pulled its palettes from photographs. The camera rides small
// random rotation kicks that decay away. The piece changes MODE every
// half-minute or so; 🎲 jumps modes by hand.
//
// Rendering: WebGPU-first, in world space (no screen-space feedback, so the
// camera never smears the frame). The scene renders into rgba16float with a
// depth buffer — dark bodies write depth so they really occlude the shells
// behind them — then a two-level bloom, then a present pass that tonemaps.
// On an HDR display the canvas is configured rgba16float with extended tone
// mapping, so the cores genuinely glow past white (probed the way Geiss
// probes: render + read back, never trust configure()). No WebGPU → the v1
// WebGL1 engine below takes over. Zero dependencies either way.

(function () {
  // swatches: per-particle colours; a/b/c/bg feed the WebGL1 fallback
  const PALETTES = [
    { name: 'hodgin green',
      sw: [[0.80, 1.0, 0.45], [0.55, 0.92, 0.32], [1.0, 0.92, 0.48], [0.92, 1.0, 0.78], [0.42, 0.78, 0.28], [1.0, 0.78, 0.30]],
      core: [0.72, 0.92, 1.0], smoke: [0.30, 0.56, 0.16], bgIn: [0.030, 0.052, 0.020], bgOut: [0.002, 0.006, 0.002], body: [0.30, 0.34, 0.22] },
    { name: 'ultraviolet',
      sw: [[0.66, 0.46, 1.0], [0.96, 0.56, 1.0], [0.46, 0.66, 1.0], [1.0, 0.86, 1.0], [0.80, 0.36, 0.96], [0.52, 0.90, 1.0]],
      core: [0.86, 0.80, 1.0], smoke: [0.34, 0.22, 0.78], bgIn: [0.10, 0.06, 0.26], bgOut: [0.016, 0.008, 0.05], body: [0.20, 0.13, 0.32] },
    { name: 'deep space',
      sw: [[0.45, 0.75, 1.0], [0.86, 0.95, 1.0], [0.36, 0.95, 0.56], [0.62, 0.86, 1.0], [1.0, 1.0, 1.0]],
      core: [0.80, 0.95, 1.0], smoke: [0.14, 0.34, 0.56], bgIn: [0.05, 0.10, 0.15], bgOut: [0.0, 0.01, 0.025], body: [0.10, 0.13, 0.16] },
    { name: 'ember',
      sw: [[1.0, 0.65, 0.20], [1.0, 0.86, 0.46], [1.0, 0.42, 0.15], [0.96, 0.36, 0.66], [1.0, 0.95, 0.76]],
      core: [1.0, 0.86, 0.62], smoke: [0.66, 0.20, 0.36], bgIn: [0.16, 0.03, 0.05], bgOut: [0.025, 0.0, 0.008], body: [0.34, 0.12, 0.10] },
    { name: 'confetti',
      sw: [[1.0, 0.55, 0.70], [0.60, 1.0, 0.60], [1.0, 0.90, 0.50], [0.60, 0.80, 1.0], [1.0, 0.70, 0.40], [0.92, 0.92, 0.96]],
      core: [1.0, 0.95, 0.90], smoke: [0.36, 0.30, 0.22], bgIn: [0.12, 0.10, 0.08], bgOut: [0.025, 0.02, 0.016], body: [0.14, 0.12, 0.10] },
    { name: 'phosphor' },
  ];
  function lcdColor(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (!m) return fallback;
    return [1, 3, 5].map((i) => parseInt(m[1].slice(i - 1, i + 1), 16) / 255);
  }
  function resolvePalette(i) {
    let p = PALETTES[i % PALETTES.length];
    if (p.name === 'phosphor') {
      const lcd = lcdColor('--lcd', [0.22, 1, 0.6]);
      const sel = lcdColor('--lcd-sel', [1, 0.7, 0.2]);
      const lift = (c, k) => c.map((v) => Math.min(1, v + (1 - v) * k));
      p = { name: 'phosphor', sw: [lcd, lift(lcd, 0.4), sel, lift(lcd, 0.75)],
        core: lift(lcd, 0.6), smoke: lcd.map((v) => v * 0.45), bgIn: lcd.map((v) => v * 0.05),
        bgOut: lcd.map((v) => v * 0.006), body: lcd.map((v) => v * 0.3) };
    }
    return { ...p, a: [1, 0.98, 0.94], b: p.sw[0], c: p.sw[2], bg: p.bgOut };
  }

  // the changing "modes" (the original's ModeMgr): who is on stage and how
  // the particles behave. emitters = shells with cores; planets = lone dark
  // bodies; hair = share of particles streaming off the shells as ribbons.
  const MODES = [
    { name: 'lone giant', emitters: [1.25], planets: [], hair: 0.34, smoke: 0.9, camd: 4.3, spin: 0.10, jit: 0.05 },
    { name: 'binary', emitters: [0.95, 0.8], planets: [0.55], hair: 0.3, smoke: 0.8, camd: 5.0, spin: 0.14, jit: 0.06 },
    { name: 'cluster', emitters: [0.85, 0.7, 0.62], planets: [0.62], hair: 0.36, smoke: 1.1, camd: 5.6, spin: 0.08, jit: 0.07 },
    { name: 'nebula', emitters: [1.05, 0.75], planets: [], hair: 0.2, smoke: 1.3, camd: 4.8, spin: 0.07, jit: 0.22 },
    { name: 'eclipse', emitters: [0.9], planets: [0.62, 0.42, 0.34], hair: 0.42, smoke: 0.35, camd: 5.2, spin: 0.18, jit: 0.05, gloss: 1 },
  ];

  const N_P = 4400;       // particle pool
  const N_STARS = 240;
  const HIST = 18;        // ribbon history rows (sampled at 60 Hz)
  const N_G = 5;          // gravity slots
  const N_SMOKE = 44;
  const N_BANDS = 12;     // the original's SoundSections

  // camera: perspective * lookAt (column-major), plus the camera basis the
  // shaders need for billboards and sphere impostors
  function camera(out, basis, eye, tgt, aspect, f, roll) {
    const zn = 0.05, zf = 120;
    let z = [eye[0] - tgt[0], eye[1] - tgt[1], eye[2] - tgt[2]];
    const zl = Math.hypot(z[0], z[1], z[2]) || 1; z = z.map((v) => v / zl);
    const up = [Math.sin(roll) * 0.2, 1, Math.cos(roll * 0.8) * 0.2];
    let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
    const xl = Math.hypot(x[0], x[1], x[2]) || 1; x = x.map((v) => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const tx = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
    const ty = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
    const tz = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
    const A = zf / (zn - zf), B = (zf * zn) / (zn - zf);   // WebGPU depth 0..1
    const fx = f / aspect;
    out[0] = fx * x[0]; out[4] = fx * x[1]; out[8] = fx * x[2]; out[12] = fx * tx;
    out[1] = f * y[0]; out[5] = f * y[1]; out[9] = f * y[2]; out[13] = f * ty;
    out[2] = A * z[0]; out[6] = A * z[1]; out[10] = A * z[2]; out[14] = A * tz + B;
    out[3] = -z[0]; out[7] = -z[1]; out[11] = -z[2]; out[15] = -tz;
    basis.r = x; basis.u = y; basis.f = z;
  }
  // the WebGL1 fallback's camera: GL clip depth (-1..1), looking at the origin
  function mvp(out, eye, aspect, t, f) {
    const b = {};
    camera(out, b, eye, [0, 0, 0], aspect, f, t * 0.05);
    const zn = 0.05, zf = 120;
    const A = (zf + zn) / (zn - zf), B = (2 * zf * zn) / (zn - zf);
    const z = b.f;
    const tz = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
    out[2] = A * z[0]; out[6] = A * z[1]; out[10] = A * z[2]; out[14] = A * tz + B;
  }

  const WGSL = `
struct U {
  mvp: mat4x4f,
  camR: vec4f, camU: vec4f, camF: vec4f,
  view: vec4f,       // W, H, ribbon px width, focal
  audio: vec4f,      // bass, mids, punch, time
  smoke: vec4f, bgIn: vec4f, bgOut: vec4f, core: vec4f, body: vec4f,
  gains: vec4f,      // hair, sprite, smoke, core
  hist: vec4f,       // rows, head, N, unused
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> P: array<vec4f>;    // pos.xyz, size
@group(0) @binding(2) var<storage, read> C: array<vec4f>;    // rgb, mag
@group(0) @binding(3) var<storage, read> Hs: array<vec4f>;   // [row * N + p]
@group(0) @binding(4) var<storage, read> A: array<f32>;      // valid rows since respawn

fn cornerOf(vi: u32) -> vec2f {
  var c = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  return c[vi];
}
// a screen-facing quad of world radius rad, never thinner than minPx; the
// returned scale (<= 1) dims what had to be inflated so the light is conserved
fn billboard(center: vec3f, rad: f32, c: vec2f, minPx: f32, scale: ptr<function, f32>) -> vec4f {
  let p = u.mvp * vec4f(center, 1.0);
  let w = max(p.w, 0.05);
  let sy = rad * u.view.w / w;
  let sMin = minPx * 2.0 / u.view.y;
  let s = max(sy, max(sMin, 1e-6));
  *scale = (sy * sy) / (s * s);
  return vec4f(p.xy + c * vec2f(s * u.view.y / u.view.x, s) * p.w, p.zw);
}

// ── particles ──────────────────────────────────────────────────────────────
struct SO { @builtin(position) pos: vec4f, @location(0) corner: vec2f, @location(1) col: vec3f };
@vertex
fn vSprite(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SO {
  let c = cornerOf(vi);
  var k = 1.0;
  var o: SO;
  o.pos = billboard(P[ii].xyz, P[ii].w, c, 1.6, &k);
  o.corner = c;
  o.col = C[ii].rgb * C[ii].w * k;
  return o;
}
@fragment
fn fSprite(v: SO) -> @location(0) vec4f {
  let r2 = dot(v.corner, v.corner);
  let glow = exp(-4.5 * r2);
  let hot = exp(-26.0 * r2);
  let col = v.col * glow * 0.55 + mix(v.col, vec3f(dot(v.col, vec3f(0.33))), 0.5) * hot * 1.1;
  return vec4f(col * u.gains.y, 1.0);
}

// ── ribbons: each particle's last rows of history as a thin strip ─────────
struct RO { @builtin(position) pos: vec4f, @location(0) col: vec3f, @location(1) side: f32 };
fn hpt(p: u32, k: u32) -> vec3f {
  if (k == 0u) { return P[p].xyz; }
  let H = u32(u.hist.x);
  let row = (u32(u.hist.y) + H - (k - 1u)) % H;
  return Hs[row * u32(u.hist.z) + p].xyz;
}
@vertex
fn vRibbon(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RO {
  let H = u32(u.hist.x);
  let p = ii / H;
  let k = ii % H;
  var o: RO;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0); o.col = vec3f(0.0); o.side = 0.0;
  if (f32(k) >= A[p] || C[p].w < 0.004) { return o; }
  let ca = u.mvp * vec4f(hpt(p, k), 1.0);
  let cb = u.mvp * vec4f(hpt(p, k + 1u), 1.0);
  if (ca.w < 0.1 || cb.w < 0.1) { return o; }
  let half = u.view.xy * 0.5;
  let d = cb.xy / cb.w * half - ca.xy / ca.w * half;     // pixels
  let dl = length(d);
  if (dl < 0.25) { return o; }
  let dir = d / dl;
  let perp = vec2f(-dir.y, dir.x);
  let end = f32(vi & 1u);
  let side = select(-1.0, 1.0, vi >= 2u);
  var c = select(ca, cb, end > 0.5);
  c = vec4f(c.xy + perp * side * u.view.z / u.view.xy * c.w, c.zw);
  let t = (f32(k) + end) / f32(H);
  let ft = max(1.0 - t, 0.0);
  let fade = ft * sqrt(ft);
  o.pos = c;
  o.col = C[p].rgb * C[p].w * fade * u.gains.x * smoothstep(0.25, 2.0, dl);
  o.side = side;
  return o;
}
@fragment
fn fRibbon(v: RO) -> @location(0) vec4f {
  return vec4f(v.col * (1.0 - abs(v.side)), 1.0);
}

// ── scene objects (instance buffer): bodies, cores, smoke ─────────────────
struct OO {
  @builtin(position) pos: vec4f,
  @location(0) corner: vec2f,
  @location(1) center: vec3f,
  @location(2) rad: f32,
  @location(3) rgb: vec3f,
  @location(4) extra: f32,
  @location(5) k: f32,
};
fn objVert(vi: u32, center: vec3f, rad: f32, rgb: vec3f, extra: f32, minPx: f32, grow: f32) -> OO {
  let c = cornerOf(vi);
  var k = 1.0;
  var o: OO;
  o.pos = billboard(center, rad * grow, c, minPx, &k);
  o.corner = c * grow; o.center = center; o.rad = rad; o.rgb = rgb; o.extra = extra; o.k = k;
  return o;
}
@vertex
fn vObj(@builtin(vertex_index) vi: u32, @location(0) center: vec3f, @location(1) rad: f32,
        @location(2) rgb: vec3f, @location(3) extra: f32) -> OO {
  return objVert(vi, center, rad, rgb, extra, 0.0, 1.0);
}
@vertex
fn vCore(@builtin(vertex_index) vi: u32, @location(0) center: vec3f, @location(1) rad: f32,
         @location(2) rgb: vec3f, @location(3) extra: f32) -> OO {
  // a core sits at the front of its own dark body (rgb.x = that radius):
  // depth-tested from there, other bodies eclipse it but its own never does
  return objVert(vi, center + u.camF.xyz * rgb.x, rad, rgb, extra, 0.0, 1.0);
}
@vertex
fn vBody(@builtin(vertex_index) vi: u32, @location(0) center: vec3f, @location(1) rad: f32,
         @location(2) rgb: vec3f, @location(3) extra: f32) -> OO {
  // a hair larger than the sphere: the perspective silhouette is
  return objVert(vi, center, rad, rgb, extra, 0.0, 1.08);
}

struct BF { @location(0) col: vec4f, @builtin(frag_depth) depth: f32 };
@fragment
fn fBody(v: OO) -> BF {
  // a sphere impostor: real normal, real depth, so it truly occludes
  let r2 = dot(v.corner, v.corner);
  if (r2 > 1.0) { discard; }
  let nz = sqrt(1.0 - r2);
  let n = normalize(u.camR.xyz * v.corner.x + u.camU.xyz * v.corner.y + u.camF.xyz * nz);
  let cp = u.mvp * vec4f(v.center + n * v.rad, 1.0);
  let L = normalize(v.rgb);
  let diff = max(dot(n, L), 0.0);
  let rn = max(1.0 - nz, 0.0);
  let rim = rn * rn * rn;
  let h = normalize(L + u.camF.xyz);
  let gloss = fract(v.extra) * 2.0;           // extra = kind + gloss/2
  let spec = exp2(60.0 * log2(max(dot(n, h), 1e-4))) * gloss;
  let dim = select(0.3, 1.0, v.extra >= 1.0);  // inner shell bodies stay darker
  let grain = fract(sin(dot(floor(v.corner * 90.0), vec2f(12.9898, 78.233))) * 43758.5453);
  var col = u.body.rgb * (0.05 + 0.5 * diff) * dim * (0.9 + 0.2 * grain)
          + u.smoke.rgb * rim * (0.12 + 0.45 * (dim - 0.3)) + u.core.rgb * spec * 1.4;
  let edge = 1.0 - smoothstep(0.94, 1.0, sqrt(r2));
  var o: BF;
  o.col = vec4f(col, edge);
  o.depth = cp.z / cp.w;
  return o;
}

@fragment
fn fCore(v: OO) -> @location(0) vec4f {
  // the gravity's heart: a hot white centre, a tinted glow and a faint lens ring
  let r2 = dot(v.corner, v.corner);
  let r = sqrt(r2);
  let hot = exp(-48.0 * r2);
  let glow = exp(-7.0 * r2);
  let r1 = (r - 0.70) / 0.035; let r2b = (r - 0.42) / 0.1;
  let ring = exp(-r1 * r1) * 0.07 + exp(-r2b * r2b) * 0.04;
  let tint = u.core.rgb;
  let col = tint * (glow * 0.42 + ring) + mix(tint, vec3f(1.0), 0.75) * hot * 1.8;
  return vec4f(col * v.extra * v.k * u.gains.w, 1.0);
}

fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let a = hash2(i); let b = hash2(i + vec2f(1.0, 0.0));
  let c = hash2(i + vec2f(0.0, 1.0)); let d = hash2(i + vec2f(1.0, 1.0));
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}
@fragment
fn fSmoke(v: OO) -> @location(0) vec4f {
  let r2 = dot(v.corner, v.corner);
  let t = u.audio.w;
  let n = vnoise(v.corner * 2.4 + vec2f(v.extra * 7.0, t * 0.03)) * 0.6
        + vnoise(v.corner * 5.7 - vec2f(t * 0.02, v.extra * 3.0)) * 0.4;
  let a = exp(-2.4 * r2) * (0.25 + 0.75 * n * n);
  return vec4f(v.rgb * a * u.gains.z * 0.075, 1.0);
}

// ── fullscreen ─────────────────────────────────────────────────────────────
struct FS { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vFull(@builtin(vertex_index) vi: u32) -> FS {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  var o: FS;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = p[vi] * vec2f(0.5, -0.5) + 0.5;
  return o;
}
@fragment
fn fBg(v: FS) -> @location(0) vec4f {
  let q = (v.uv - 0.5) * vec2f(u.view.x / u.view.y, 1.0);
  let r = length(q - vec2f(0.0, -0.1));
  let g = smoothstep(0.0, 1.0, r);
  let dither = (hash2(v.uv * u.view.xy) - 0.5) / 255.0;
  return vec4f(mix(u.bgIn.rgb * (1.0 + u.audio.x * 0.25), u.bgOut.rgb, g) + dither, 1.0);
}`;

  const POST = `
@group(0) @binding(0) var ps: sampler;
@group(0) @binding(1) var t0: texture_2d<f32>;
@group(0) @binding(2) var<uniform> pu: vec4f;
@group(0) @binding(3) var t1: texture_2d<f32>;
@group(0) @binding(4) var t2: texture_2d<f32>;
struct FS { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vFull(@builtin(vertex_index) vi: u32) -> FS {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  var o: FS;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = p[vi] * vec2f(0.5, -0.5) + 0.5;
  return o;
}
@fragment
fn fDown(v: FS) -> @location(0) vec4f {
  // pu.xy = source texel; 4 bilinear taps = a 16-texel box
  let o = pu.xy;
  let c = textureSample(t0, ps, v.uv + vec2f(-o.x, -o.y)) + textureSample(t0, ps, v.uv + vec2f(o.x, -o.y))
        + textureSample(t0, ps, v.uv + vec2f(-o.x, o.y)) + textureSample(t0, ps, v.uv + vec2f(o.x, o.y));
  return vec4f(min(c.rgb * 0.25, vec3f(64.0)), 1.0);
}
@fragment
fn fBlur(v: FS) -> @location(0) vec4f {
  // pu.xy = texel * direction; 9-tap gaussian in 5 linear fetches
  let d = pu.xy;
  var c = textureSample(t0, ps, v.uv).rgb * 0.227027;
  c += (textureSample(t0, ps, v.uv + d * 1.3846154).rgb + textureSample(t0, ps, v.uv - d * 1.3846154).rgb) * 0.3162162;
  c += (textureSample(t0, ps, v.uv + d * 3.2307692).rgb + textureSample(t0, ps, v.uv - d * 3.2307692).rgb) * 0.0702703;
  return vec4f(c, 1.0);
}
@fragment
fn fComp(v: FS) -> @location(0) vec4f {
  // pu = (near bloom, wide bloom, hdr, exposure)
  let s = textureSample(t0, ps, v.uv).rgb;
  let q = textureSample(t1, ps, v.uv).rgb;
  let e = textureSample(t2, ps, v.uv).rgb;
  let c = (s + q * pu.x + e * pu.y) * pu.w;
  if (pu.z > 0.5) { return vec4f(c, 1.0); }                    // HDR: let the peaks through
  let m = c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14);  // SDR: filmic shoulder
  return vec4f(clamp(m, vec3f(0.0), vec3f(1.0)), 1.0);
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

  async function compiled(device, code) {
    const mod = device.createShaderModule({ code });
    if (mod.getCompilationInfo) {
      const info = await Promise.race([mod.getCompilationInfo(), timeout(1200, { messages: [] })]);
      if (info.messages.some((m) => m.type === 'error')) {
        console.error('magneto wgsl:', info.messages.map((m) => m.lineNum + ':' + m.message).join(' | '));
        return null;
      }
    }
    return mod;
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

    const mod = await compiled(device, WGSL);
    const post = await compiled(device, POST);
    if (!mod || !post) return null;

    // ── buffers ────────────────────────────────────────────────────────────
    const UFLOATS = 16 + 4 * 12;
    const ubo = device.createBuffer({ size: UFLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const NS = N_P + N_STARS;
    const Pd = new Float32Array(NS * 4), Cd = new Float32Array(NS * 4);
    const Ad = new Float32Array(N_P);
    const histRow = new Float32Array(N_P * 4);
    const STO = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const pBuf = device.createBuffer({ size: Pd.byteLength, usage: STO });
    const cBuf = device.createBuffer({ size: Cd.byteLength, usage: STO });
    const hBuf = device.createBuffer({ size: histRow.byteLength * HIST, usage: STO });
    const aBuf = device.createBuffer({ size: Ad.byteLength, usage: STO });
    const OSTRIDE = 8;
    const N_OBJ = N_SMOKE + N_G * 2;
    const Od = new Float32Array(N_OBJ * OSTRIDE);
    const oBuf = device.createBuffer({ size: Od.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

    const sceneBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      ...[1, 2, 3, 4].map((binding) => ({ binding, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } })),
    ] });
    const sceneBG = device.createBindGroup({ layout: sceneBGL, entries: [
      { binding: 0, resource: { buffer: ubo } },
      { binding: 1, resource: { buffer: pBuf } },
      { binding: 2, resource: { buffer: cBuf } },
      { binding: 3, resource: { buffer: hBuf } },
      { binding: 4, resource: { buffer: aBuf } },
    ] });
    const sceneLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneBGL] });

    // ── pipelines ──────────────────────────────────────────────────────────
    const HDRF = 'rgba16float';
    const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const ALPHA = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const OBJ = [{ arrayStride: OSTRIDE * 4, stepMode: 'instance', attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32' },
      { shaderLocation: 2, offset: 16, format: 'float32x3' },
      { shaderLocation: 3, offset: 28, format: 'float32' },
    ] }];
    const pipe = (vs, fs, { blend, buffers = [], depth = 'test', topology = 'triangle-strip' }) => device.createRenderPipeline({
      layout: sceneLayout,
      vertex: { module: mod, entryPoint: vs, buffers },
      fragment: { module: mod, entryPoint: fs, targets: [{ format: HDRF, blend }] },
      primitive: { topology },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: depth === 'write',
        depthCompare: depth === 'always' ? 'always' : 'less',
      },
    });
    const bgPipe = pipe('vFull', 'fBg', { depth: 'always', topology: 'triangle-list' });
    const bodyPipe = pipe('vBody', 'fBody', { blend: ALPHA, buffers: OBJ, depth: 'write' });
    const smokePipe = pipe('vObj', 'fSmoke', { blend: ADD, buffers: OBJ });
    const ribbonPipe = pipe('vRibbon', 'fRibbon', { blend: ADD });
    const spritePipe = pipe('vSprite', 'fSprite', { blend: ADD });
    const corePipe = pipe('vCore', 'fCore', { blend: ADD, buffers: OBJ });

    const postBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ] });
    const postLayout = device.createPipelineLayout({ bindGroupLayouts: [postBGL] });
    const postPipe = (fs, target) => device.createRenderPipeline({
      layout: postLayout,
      vertex: { module: post, entryPoint: 'vFull' },
      fragment: { module: post, entryPoint: fs, targets: [{ format: target }] },
      primitive: { topology: 'triangle-list' },
    });
    const downPipe = postPipe('fDown', HDRF);
    const blurPipe = postPipe('fBlur', HDRF);
    const compPipe = postPipe('fComp', format);
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const compU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // ── render targets (rebuilt on resize) ─────────────────────────────────
    let W = 0, H = 0, rt = null;
    function resize(w, h) {
      W = Math.max(16, w | 0); H = Math.max(16, h | 0);
      canvas.width = W; canvas.height = H;
      if (rt) for (const t of rt.owned) t.destroy();
      const owned = [];
      const tex = (tw, th, fmt = HDRF) => {
        const t = device.createTexture({ size: [Math.max(1, tw), Math.max(1, th)], format: fmt,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        owned.push(t); return t;
      };
      const scene = tex(W, H), depth = tex(W, H, 'depth24plus');
      const qw = Math.ceil(W / 4), qh = Math.ceil(H / 4), ew = Math.ceil(W / 8), eh = Math.ceil(H / 8);
      const q1 = tex(qw, qh), q2 = tex(qw, qh), e1 = tex(ew, eh), e2 = tex(ew, eh);
      const bind = (src, vec, extra1 = src, extra2 = src) => {
        const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(b, 0, new Float32Array(vec));
        owned.push(b);
        return device.createBindGroup({ layout: postBGL, entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: src.createView() },
          { binding: 2, resource: { buffer: b } },
          { binding: 3, resource: extra1.createView() },
          { binding: 4, resource: extra2.createView() },
        ] });
      };
      // the bloom chain: scene → ¼ (blurred twice) → ⅛ (blurred twice)
      const passes = [
        [downPipe, bind(scene, [1 / W, 1 / H, 0, 0]), q1],
        [blurPipe, bind(q1, [1 / qw, 0, 0, 0]), q2], [blurPipe, bind(q2, [0, 1 / qh, 0, 0]), q1],
        [blurPipe, bind(q1, [2 / qw, 0, 0, 0]), q2], [blurPipe, bind(q2, [0, 2 / qh, 0, 0]), q1],
        [downPipe, bind(q1, [1 / qw, 1 / qh, 0, 0]), e1],
        [blurPipe, bind(e1, [1 / ew, 0, 0, 0]), e2], [blurPipe, bind(e2, [0, 1 / eh, 0, 0]), e1],
        [blurPipe, bind(e1, [2 / ew, 0, 0, 0]), e2], [blurPipe, bind(e2, [0, 2 / eh, 0, 0]), e1],
      ];
      const comp = device.createBindGroup({ layout: postBGL, entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: scene.createView() },
        { binding: 2, resource: { buffer: compU } },
        { binding: 3, resource: q1.createView() },
        { binding: 4, resource: e1.createView() },
      ] });
      rt = { owned, scene: scene.createView(), depth: depth.createView(), passes, comp };
    }

    // ── the simulation ─────────────────────────────────────────────────────
    let seed = (Math.random() * 2147483646 + 1) | 0;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    // gravities: emitters (shell + core + inner body) or lone dark planets
    const grav = Array.from({ length: N_G }, (_, i) => ({
      pos: [(rnd() - 0.5) * 2, (rnd() - 0.5), (rnd() - 0.5) * 2], vel: [0, 0, 0], dp: [0, 0, 0],
      scale: 1, R: 1, Rcur: 0, alive: 0, want: 0, planet: false,
      axis: [0, 1, 0], spin: 0.3, band: (i * 5) % N_BANDS, phase: rnd() * 9, gloss: 0, share: 0,
    }));

    const vel = new Float32Array(N_P * 3);
    const owner = new Uint8Array(N_P);
    const band = new Uint8Array(N_P);
    const tint = new Float32Array(N_P * 3);       // target colour (palette swatch)
    const jit = new Float32Array(N_P);            // shell thickness offset
    const hair = new Uint8Array(N_P);             // 1 = streams off the shell
    const reach = new Float32Array(N_P);          // how far a streamer gets
    const spark = new Uint8Array(N_P);            // the big glinting few
    const fadeIn = new Float32Array(N_P);
    const home = new Float32Array(N_P * 3);       // own spot on the shell (unit vector)
    function pickHome(i) {
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      home[i * 3] = s * Math.cos(a); home[i * 3 + 1] = z; home[i * 3 + 2] = s * Math.sin(a);
    }
    // particle-particle repulsion (the original's repelAllParticles) over a
    // hashed grid: like charges spread evenly over each shell
    const REP_H = 0.15, GRID = 8192;
    const gHead = new Int32Array(GRID), gNext = new Int32Array(N_P);
    const rep = new Float32Array(N_P * 3);
    const cellKey = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) & (GRID - 1);
    function repel() {
      gHead.fill(-1);
      rep.fill(0);
      for (let i = 0; i < N_P; i++) {
        if (hair[i]) continue;
        const o = i * 4;
        const k = cellKey(Math.floor(Pd[o] / REP_H), Math.floor(Pd[o + 1] / REP_H), Math.floor(Pd[o + 2] / REP_H));
        gNext[i] = gHead[k]; gHead[k] = i;
      }
      const h2 = REP_H * REP_H;
      for (let i = 0; i < N_P; i++) {
        if (hair[i]) continue;
        const o = i * 4;
        const x = Pd[o], y = Pd[o + 1], z = Pd[o + 2];
        const cx = Math.floor(x / REP_H), cy = Math.floor(y / REP_H), cz = Math.floor(z / REP_H);
        let fx = 0, fy = 0, fz = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
          for (let j = gHead[cellKey(cx + a, cy + b, cz + c)]; j >= 0; j = gNext[j]) {
            if (j <= i) continue;
            const q = j * 4;
            const dx = x - Pd[q], dy = y - Pd[q + 1], dz = z - Pd[q + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= h2 || d2 < 1e-10) continue;
            const d = Math.sqrt(d2), f = (1 - d / REP_H) / d;
            fx += dx * f; fy += dy * f; fz += dz * f;
            rep[j * 3] -= dx * f; rep[j * 3 + 1] -= dy * f; rep[j * 3 + 2] -= dz * f;
          }
        }
        rep[i * 3] += fx; rep[i * 3 + 1] += fy; rep[i * 3 + 2] += fz;
      }
    }

    let pal = 0, palMix = resolvePalette(0);
    function pickTint(i) {
      const sw = palMix.sw;
      const c = sw[(rnd() * sw.length) | 0];
      const v = 0.85 + rnd() * 0.3;
      tint[i * 3] = c[0] * v; tint[i * 3 + 1] = c[1] * v; tint[i * 3 + 2] = c[2] * v;
    }
    function pickOwner() {
      let tot = 0;
      for (const g of grav) if (g.want && !g.planet) tot += g.share;
      let r = rnd() * tot;
      for (let k = 0; k < N_G; k++) {
        const g = grav[k];
        if (!g.want || g.planet) continue;
        r -= g.share;
        if (r <= 0) return k;
      }
      return 0;
    }
    function onShell(i, burst) {
      const g = grav[owner[i]];
      if (!hair[i]) pickHome(i);
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      const nx = hair[i] ? s * Math.cos(a) : home[i * 3], ny = hair[i] ? z : home[i * 3 + 1], nz = hair[i] ? s * Math.sin(a) : home[i * 3 + 2];
      const R = Math.max(0.05, g.Rcur) * (1 + jit[i]);
      const o = i * 4, v = i * 3;
      Pd[o] = g.pos[0] + nx * R; Pd[o + 1] = g.pos[1] + ny * R; Pd[o + 2] = g.pos[2] + nz * R;
      const sp = hair[i] ? 0.4 + rnd() * 0.6 : (burst ? 0.8 + rnd() * 1.2 : 0);
      vel[v] = nx * sp; vel[v + 1] = ny * sp; vel[v + 2] = nz * sp;
      Ad[i] = 0;
      fadeIn[i] = 0;
    }

    let modeIdx = 0, mode = MODES[0], modeT = 0, nextModeAt = 32;
    let smokeLevel = mode.smoke, camd = mode.camd, hairShare = mode.hair;
    function setMode(i) {
      modeIdx = ((i % MODES.length) + MODES.length) % MODES.length;
      mode = MODES[modeIdx];
      modeT = 0; nextModeAt = 26 + rnd() * 18;
      const roles = [...mode.emitters.map((s) => ({ s, planet: false })), ...mode.planets.map((s) => ({ s, planet: true }))];
      for (let k = 0; k < N_G; k++) {
        const g = grav[k], r = roles[k];
        g.want = r ? 1 : 0;
        if (!r) continue;
        if (g.alive < 0.05) {
          // newcomers enter from somewhere off to the side
          const a = rnd() * Math.PI * 2;
          g.pos = [Math.cos(a) * 2.5, (rnd() - 0.5) * 1.2, Math.sin(a) * 2.5];
          g.vel = [0, 0, 0];
        }
        g.planet = r.planet;
        g.scale = r.s * (0.9 + rnd() * 0.2);
        g.R = g.scale;
        g.share = r.planet ? 0 : g.scale * g.scale;
        const ax = [rnd() - 0.5, 1.2, rnd() - 0.5], al = Math.hypot(...ax);
        g.axis = ax.map((v) => v / al);
        g.spin = (rnd() < 0.5 ? -1 : 1) * mode.spin * (0.7 + rnd() * 0.6);
        g.gloss = r.planet ? (mode.gloss ? 0.4 + rnd() * 0.5 : rnd() * 0.15) : 0;
      }
      // every particle takes a new gravity — they fly across, ribbons and all
      for (let p = 0; p < N_P; p++) {
        owner[p] = pickOwner();
        pickHome(p);
        hair[p] = rnd() < mode.hair ? 1 : 0;
        jit[p] = (rnd() - 0.5) * 2 * mode.jit;
      }
      if (rnd() < 0.5) setPalette(pal + 1);
      return mode.name + ' · ' + palMix.name;
    }
    function setPalette(i) {
      pal = i % PALETTES.length; palMix = resolvePalette(pal);
      for (let p = 0; p < N_P; p++) pickTint(p);
      return palMix.name;
    }

    for (let p = 0; p < N_P; p++) {
      band[p] = (rnd() * N_BANDS) | 0;
      spark[p] = rnd() < 0.06 ? 1 : 0;
      reach[p] = 1.5 + rnd() * 1.4;
      pickTint(p);
      Cd.set([tint[p * 3], tint[p * 3 + 1], tint[p * 3 + 2], 0], p * 4);
    }
    setMode(0);
    for (const g of grav) { g.alive = g.want; g.Rcur = g.want ? g.R : 0; }
    for (let p = 0; p < N_P; p++) onShell(p, false);
    for (let i = 0; i < N_STARS; i++) {
      const o = (N_P + i) * 4;
      const th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
      const R = 30 + rnd() * 30;
      Pd[o] = R * Math.sin(ph) * Math.cos(th); Pd[o + 1] = R * Math.cos(ph); Pd[o + 2] = R * Math.sin(ph) * Math.sin(th);
      Pd[o + 3] = 0.05;
      const b = 0.08 + rnd() * 0.12;
      Cd.set([b, b, b * 1.1, 1], o);
    }
    for (let r = 0; r < HIST; r++) device.queue.writeBuffer(hBuf, r * histRow.byteLength, Pd, 0, N_P * 4);

    const smoke = Array.from({ length: N_SMOKE }, (_, k) => ({
      home: 0, off: [0, 0, 0], r: 1, mag: 1, seed: rnd(), free: k % 3 === 2,
      drift: [(rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.06],
    }));
    function seatSmoke() {
      for (const sm of smoke) {
        if (sm.free) {
          sm.off = [(rnd() - 0.5) * 10, (rnd() - 0.5) * 5, (rnd() - 0.5) * 10];
          sm.r = 2.5 + rnd() * 3.0; sm.mag = 0.35 + rnd() * 0.3;
          continue;
        }
        sm.home = pickOwner();
        const R = (0.9 + rnd() * 1.8), a = rnd() * Math.PI * 2, b = rnd() - 0.5;
        sm.off = [Math.cos(a) * R, b * R, Math.sin(a) * R];
        sm.r = 1.3 + rnd() * 1.8; sm.mag = 0.5 + rnd() * 0.5;
      }
    }
    seatSmoke();

    // ── sound: the spectrum in log-spaced sections, each with its own
    // running max (so treble moves too), an average and a trigger
    let an = null, fd = null;
    function ensureAudio() {
      if (an || !getAudio) return;
      try {
        const { ctx: ac, srcNode } = getAudio();
        an = ac.createAnalyser();
        an.fftSize = 512; an.smoothingTimeConstant = 0.6;
        fd = new Uint8Array(an.frequencyBinCount);
        srcNode.connect(an);
      } catch (e) {}
    }
    const edges = Array.from({ length: N_BANDS + 1 }, (_, k) => Math.round(1.5 * Math.pow(190 / 1.5, k / N_BANDS)));
    const lvl = new Float32Array(N_BANDS), avg = new Float32Array(N_BANDS), bmax = new Float32Array(N_BANDS).fill(0.1);
    const flash = new Float32Array(N_BANDS), cool = new Float32Array(N_BANDS);
    const trig = new Uint8Array(N_BANDS);

    // ── camera (the original's POV): slow orbit, random kicks that decay
    const cam = { th: rnd() * 6.28, ph: 0.2, phT: 0.2, w: 0.08, d: mode.camd, tgt: [0, 0, 0], nextAt: 8 };

    let bassAvg = 0.08, lastT = 0, active = false, histAcc = 0, head = 0, t0 = 0;
    const M = new Float32Array(16), basis = {};
    const uarr = new Float32Array(UFLOATS);
    const cur = { smoke: [...palMix.smoke], bgIn: [...palMix.bgIn], bgOut: [...palMix.bgOut], core: [...palMix.core], body: [...palMix.body] };

    function frame(tms) {
      requestAnimationFrame(frame);
      if (!active || !rt) { lastT = 0; return; }
      const now = tms * 0.001;
      const dt = Math.min(0.05, lastT ? now - lastT : 0.016);
      lastT = now;
      t0 += dt;
      const t = t0;
      modeT += dt;
      if (modeT > nextModeAt) setMode(modeIdx + 1 + (rnd() * 2 | 0));

      // sound
      ensureAudio();
      let bass = 0, mids = 0;
      if (an) {
        an.getByteFrequencyData(fd);
        for (let i = 1; i < 8; i++) bass += fd[i];
        bass /= 7 * 255;
        for (let i = 12; i < 60; i++) mids += fd[i];
        mids /= 48 * 255;
      }
      for (let k = 0; k < N_BANDS; k++) {
        let raw = 0;
        if (an) {
          const a = edges[k], b = Math.max(a + 1, edges[k + 1]);
          for (let i = a; i < b; i++) raw += fd[i];
          raw /= (b - a) * 255;
        } else {
          raw = 0.25 + 0.2 * Math.sin(t * (0.7 + k * 0.23) + k);   // idle breath
        }
        bmax[k] = Math.max(bmax[k] * Math.pow(0.997, dt * 60), raw, 0.06);
        const n = raw / bmax[k];
        lvl[k] += (n - lvl[k]) * Math.min(1, dt * 30);
        avg[k] += (n - avg[k]) * Math.min(1, dt * 3);
        cool[k] -= dt;
        trig[k] = 0;
        if (n - avg[k] > 0.16 && cool[k] <= 0 && raw > 0.04) { trig[k] = 1; flash[k] = 1; cool[k] = 0.14; }
        flash[k] *= Math.pow(0.9, dt * 60);
      }
      bassAvg += (bass - bassAvg) * 0.04;
      const punch = Math.max(0, bass - bassAvg * 1.25);

      smokeLevel += (mode.smoke - smokeLevel) * dt * 0.6;
      hairShare += (mode.hair - hairShare) * dt * 0.6;
      for (const key of ['smoke', 'bgIn', 'bgOut', 'core', 'body']) {
        const c = cur[key], tg = palMix[key];
        for (let j = 0; j < 3; j++) c[j] += (tg[j] - c[j]) * Math.min(1, dt * 1.2);
      }

      // gravities: repel one another, drift toward the centre, orbit, breathe
      for (let k = 0; k < N_G; k++) {
        const g = grav[k];
        g.alive += (g.want - g.alive) * Math.min(1, dt * 0.9);
        const a = [-g.pos[0] * 0.35, -g.pos[1] * 0.6, -g.pos[2] * 0.35];
        for (let j = 0; j < N_G; j++) {
          if (j === k || grav[j].alive < 0.05) continue;
          const h = grav[j];
          const dx = g.pos[0] - h.pos[0], dy = g.pos[1] - h.pos[1], dz = g.pos[2] - h.pos[2];
          const d2 = dx * dx + dy * dy + dz * dz + 0.05, d = Math.sqrt(d2);
          const rep = 1.6 * (g.scale + h.scale) * h.alive / d2;
          a[0] += dx / d * rep; a[1] += dy / d * rep; a[2] += dz / d * rep;
        }
        const orb = g.planet ? 0.5 : 0.18;
        a[0] += -g.pos[2] * orb + Math.sin(t * 0.13 + g.phase) * 0.12;
        a[2] += g.pos[0] * orb + Math.cos(t * 0.11 + g.phase) * 0.12;
        a[1] += Math.sin(t * 0.17 + g.phase * 2) * 0.1;
        const damp = Math.exp(-dt * 0.9);
        for (let j = 0; j < 3; j++) { g.vel[j] = g.vel[j] * damp + a[j] * dt; g.dp[j] = g.vel[j] * dt; g.pos[j] += g.dp[j]; }
        const want = g.want ? g.R * (1 + lvl[g.band] * 0.12 + punch * 0.25) : 0;
        g.Rcur += (want * Math.sqrt(Math.max(0, g.alive)) - g.Rcur) * Math.min(1, dt * 4);
      }

      // particles
      repel();
      const kicks = punch > 0.06 ? punch * 2.5 : 0;
      for (let i = 0; i < N_P; i++) {
        const o = i * 4, v = i * 3;
        let g = grav[owner[i]];
        if (!g.want || g.planet) { owner[i] = pickOwner(); pickHome(i); g = grav[owner[i]]; }
        // ride along with the gravity — a shell that has to chase its
        // planet bunches up on the trailing side
        const x = Pd[o] + g.dp[0], y = Pd[o + 1] + g.dp[1], z = Pd[o + 2] + g.dp[2];
        const dx = x - g.pos[0], dy = y - g.pos[1], dz = z - g.pos[2];
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
        const nx = dx / r, ny = dy / r, nz = dz / r;
        const L = lvl[band[i]], F = flash[band[i]];
        const Rg = Math.max(0.05, g.Rcur);
        let ax, ay, az, fade = 1;
        if (hair[i]) {
          // streamer: rides out along the radius, louder = faster, then
          // re-seeds on the shell — each pass draws one strand of hair
          const push = 0.5 + L * 2.6 + F * 1.5;
          ax = nx * push; ay = ny * push; az = nz * push;
          const lim = Rg * reach[i] * (1 + L * 0.5);
          fade = 1 - Math.min(1, Math.max(0, (r - Rg) / (lim - Rg + 1e-3)));
          if (r > lim || r < Rg * 0.5) { onShell(i, false); continue; }
        } else {
          // shell: sprung to its radius, kicked off it when its band triggers
          const Rt = Rg * (1 + jit[i]) + L * 0.12 * g.scale;
          const k = 7 * (r - Rt);
          ax = -nx * k; ay = -ny * k; az = -nz * k;
          // and drawn toward its own spot on the sphere, so a shell fills
          // evenly however its particles arrived
          const hx = home[v] * r - dx, hy = home[v + 1] * r - dy, hz = home[v + 2] * r - dz;
          ax += hx * 2.2; ay += hy * 2.2; az += hz * 2.2;
          if (trig[band[i]] && (i % 3 === 0)) {
            const kick = 0.5 + rnd() * 0.9;
            vel[v] += nx * kick; vel[v + 1] += ny * kick; vel[v + 2] += nz * kick;
          }
          if (kicks && rnd() < kicks * 0.04) {
            const kick = 1 + rnd() * 1.6;
            vel[v] += nx * kick; vel[v + 1] += ny * kick; vel[v + 2] += nz * kick;
          }
          if (r > Rg * 4.5 + 2) { onShell(i, false); continue; }
        }
        if (!hair[i]) {
          const REP = 2.2;
          ax += rep[v] * REP; ay += rep[v + 1] * REP; az += rep[v + 2] * REP;
        }
        const damp = Math.exp(-dt * (hair[i] ? 1.2 : 2.6));
        vel[v] = vel[v] * damp + ax * dt;
        vel[v + 1] = vel[v + 1] * damp + ay * dt;
        vel[v + 2] = vel[v + 2] * damp + az * dt;
        // swirl about the gravity's axis plus a slowly varying wobble, both
        // ROTATIONS applied straight to position: as forces they'd build a
        // centrifugal bulge (an equator ring), and a shared push would slide
        // the shell into a crescent
        const s = g.spin * 0.8;
        const wx = Math.sin(t * 0.31 + dy * 2.3 + g.phase) * 0.35 + g.axis[0] * s;
        const wy = Math.sin(t * 0.27 + dz * 2.1) * 0.35 + g.axis[1] * s;
        const wz = Math.sin(t * 0.23 + dx * 1.9 + g.phase) * 0.35 + g.axis[2] * s;
        const sx = wy * dz - wz * dy, sy = wz * dx - wx * dz, sz = wx * dy - wy * dx;
        {
          // homes turn with the swirl (not the wobble), renormalised
          const ex = g.axis[0] * s, ey = g.axis[1] * s, ez = g.axis[2] * s;
          let h0 = home[v], h1 = home[v + 1], h2 = home[v + 2];
          h0 += (ey * h2 - ez * h1) * dt; h1 += (ez * home[v] - ex * h2) * dt; h2 += (ex * home[v + 1] - ey * home[v]) * dt;
          const hl = Math.hypot(h0, h1, h2) || 1;
          home[v] = h0 / hl; home[v + 1] = h1 / hl; home[v + 2] = h2 / hl;
        }
        Pd[o] = x + (vel[v] + sx) * dt; Pd[o + 1] = y + (vel[v + 1] + sy) * dt; Pd[o + 2] = z + (vel[v + 2] + sz) * dt;

        fadeIn[i] = Math.min(1, fadeIn[i] + dt * 1.5);
        const sp = spark[i];
        Pd[o + 3] = g.scale * (sp ? 0.032 : 0.02) * (0.5 + L * 1.0) * (1 + F * (sp ? 1.2 : 0.5));
        let mag = hair[i]
          ? (0.3 + L * 0.6 + F * 0.4) * fade
          : (0.2 + L * 0.55 + F * (sp ? 1.8 : 0.8));
        mag *= fadeIn[i] * Math.min(1, g.alive * 1.5) * (sp ? 1.3 : 1);
        const tr = Math.min(1, dt * 2);
        Cd[o] += (tint[v] - Cd[o]) * tr;
        Cd[o + 1] += (tint[v + 1] - Cd[o + 1]) * tr;
        Cd[o + 2] += (tint[v + 2] - Cd[o + 2]) * tr;
        Cd[o + 3] = mag;
      }
      // ribbon history sampled at a fixed 60 Hz, so hair length doesn't
      // depend on the display's refresh rate
      histAcc += dt;
      let pushed = false;
      while (histAcc >= 1 / 60) {
        histAcc -= 1 / 60;
        if (!pushed) {
          head = (head + 1) % HIST;
          histRow.set(Pd.subarray(0, N_P * 4));
          for (let i = 0; i < N_P; i++) Ad[i] = Math.min(HIST, Ad[i] + 1);
          pushed = true;
        }
      }
      if (histAcc > 0.1) histAcc = 0;
      device.queue.writeBuffer(pBuf, 0, Pd);
      device.queue.writeBuffer(cBuf, 0, Cd);
      device.queue.writeBuffer(aBuf, 0, Ad);
      if (pushed) device.queue.writeBuffer(hBuf, head * histRow.byteLength, histRow);

      // scene objects: smoke, then bodies, then cores
      let n = 0;
      const put = (p, rad, c0, c1, c2, extra) => {
        const o = n++ * OSTRIDE;
        Od[o] = p[0]; Od[o + 1] = p[1]; Od[o + 2] = p[2]; Od[o + 3] = rad;
        Od[o + 4] = c0; Od[o + 5] = c1; Od[o + 6] = c2; Od[o + 7] = extra;
      };
      for (const sm of smoke) {
        const g = sm.free ? null : grav[sm.home];
        const bound = sm.free ? 6 : 3 * g.scale;
        for (let a = 0; a < 3; a++) {
          sm.off[a] += sm.drift[a] * dt;
          if (Math.abs(sm.off[a]) > bound) sm.drift[a] = -Math.sign(sm.off[a]) * Math.abs(sm.drift[a]);
        }
        const p = sm.free ? sm.off : [g.pos[0] + sm.off[0] * g.scale, g.pos[1] + sm.off[1] * g.scale, g.pos[2] + sm.off[2] * g.scale];
        const m = sm.mag * (sm.free ? 1 : g.alive) * (0.7 + bass * 0.8);
        put(p, sm.r * (sm.free ? 1 : g.scale), cur.smoke[0] * m, cur.smoke[1] * m, cur.smoke[2] * m, sm.seed);
      }
      const body0 = n;
      // a light for the planets: the brightest emitter
      let lightG = grav[0];
      for (const g of grav) if (!g.planet && g.want && g.alive > lightG.alive) lightG = g;
      for (const g of grav) {
        const rad = g.planet ? g.scale * 0.6 * g.alive : g.Rcur * 0.8;
        let l = [lightG.pos[0] - g.pos[0], lightG.pos[1] - g.pos[1] + 0.3, lightG.pos[2] - g.pos[2]];
        if (!g.planet || Math.hypot(...l) < 0.4) l = [-0.5, 1, 0.4];
        put(g.pos, Math.max(0, rad), l[0], l[1], l[2], (g.planet ? 1 : 0) + g.gloss * 0.5);
      }
      const core0 = n;
      for (const g of grav) {
        const L = lvl[g.band], pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + g.phase * 3);
        const m = g.planet ? 0 : g.alive * (0.55 + pulse * 0.25 + L * 0.5 + bass * 0.9 + punch * 2.2);
        put(g.pos, g.Rcur * (0.42 + punch * 0.25), g.Rcur * 0.86, 0, 0, m);
      }
      device.queue.writeBuffer(oBuf, 0, Od);

      // camera: orbit the gravities' centre; beats kick the rotation
      // (RANDOM_ROTATION 0.001..0.01 per frame in the original), which decays
      if (punch > 0.1 && rnd() < 0.3) cam.w += (rnd() < 0.5 ? -1 : 1) * (0.06 + rnd() * 0.5);
      cam.w += (0.07 * Math.sign(cam.w || 1) - cam.w) * Math.min(1, dt * 1.2);
      cam.th += cam.w * dt;
      cam.nextAt -= dt;
      if (cam.nextAt <= 0) { cam.phT = -0.35 + rnd() * 0.9; cam.nextAt = 7 + rnd() * 9; }
      cam.ph += (cam.phT - cam.ph) * Math.min(1, dt * 0.25);
      camd += (mode.camd - camd) * dt * 0.4;
      cam.d = camd * (1 - mids * 0.12);
      let cx = 0, cy = 0, cz = 0, cw = 0;
      for (const g of grav) { const w = g.alive * g.scale; cx += g.pos[0] * w; cy += g.pos[1] * w; cz += g.pos[2] * w; cw += w; }
      if (cw > 0) { cx /= cw; cy /= cw; cz /= cw; }
      const ease = Math.min(1, dt * 0.8);
      cam.tgt[0] += (cx - cam.tgt[0]) * ease; cam.tgt[1] += (cy - cam.tgt[1]) * ease; cam.tgt[2] += (cz - cam.tgt[2]) * ease;
      const eye = [
        cam.tgt[0] + Math.cos(cam.th) * Math.cos(cam.ph) * cam.d,
        cam.tgt[1] + Math.sin(cam.ph) * cam.d,
        cam.tgt[2] + Math.sin(cam.th) * Math.cos(cam.ph) * cam.d,
      ];
      const f = 1.55;
      camera(M, basis, eye, cam.tgt, W / H, f, t * 0.05);

      uarr.set(M, 0);
      uarr.set([...basis.r, 0], 16);
      uarr.set([...basis.u, 0], 20);
      uarr.set([...basis.f, 0], 24);
      uarr.set([W, H, Math.max(1.1, H / 640), f], 28);
      uarr.set([bass, mids, punch, t], 32);
      uarr.set([...cur.smoke, 1], 36);
      uarr.set([...cur.bgIn, 1], 40);
      uarr.set([...cur.bgOut, 1], 44);
      uarr.set([...cur.core, 1], 48);
      uarr.set([...cur.body, 1], 52);
      uarr.set([0.5 + hairShare * 0.7, 1.0, smokeLevel, hdr ? 2.4 : 1.2], 56);
      uarr.set([HIST, head, N_P, 0], 60);
      device.queue.writeBuffer(ubo, 0, uarr);
      device.queue.writeBuffer(compU, 0, new Float32Array([0.32, 0.42, hdr ? 1 : 0, hdr ? 1.0 : 1.0]));

      const enc = device.createCommandEncoder();
      {
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: rt.scene, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
          depthStencilAttachment: { view: rt.depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
        });
        pass.setBindGroup(0, sceneBG);
        pass.setPipeline(bgPipe); pass.draw(3);
        pass.setVertexBuffer(0, oBuf);
        pass.setPipeline(bodyPipe); pass.draw(4, N_G, 0, body0);
        pass.setPipeline(smokePipe); pass.draw(4, N_SMOKE, 0, 0);
        pass.setPipeline(ribbonPipe); pass.draw(4, N_P * HIST);
        pass.setPipeline(spritePipe); pass.draw(4, NS);
        pass.setVertexBuffer(0, oBuf);
        pass.setPipeline(corePipe); pass.draw(4, N_G, 0, core0);
        pass.end();
      }
      const run = (pipeline, bg, view) => {
        const pass = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
      };
      for (const [pipeline, bg, target] of rt.passes) run(pipeline, bg, target.createView());
      run(compPipe, rt.comp, ctx.getCurrentTexture().createView());
      device.queue.submit([enc.finish()]);
    }
    requestAnimationFrame(frame);

    return {
      backend: hdr ? 'webgpu · hdr' : 'webgpu',
      get paletteName() { return palMix.name; },
      setActive(on) { active = on; if (on) lastT = 0; },
      resize,
      randomize() { return setMode(modeIdx + 1 + (Math.random() * 2 | 0)); },
      cyclePalette() { return setPalette(pal + 1); },
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
