// Shader library for the GPU tab — the same three demos in two dialects:
// GLSL ES 3.0 (WebGL2 fallback) and WGSL (WebGPU, live since tinyjs 0.3.0).
// Kept in its own file so capability probes can compile exactly what ships.

// Shared WGSL prelude: uniforms, fullscreen-triangle vertex stage, 2D rotate.
// fs() flips Y so both dialects agree on orientation (GL origin is bottom-left).
const WGSL_COMMON = `
struct U { time: f32, pad: f32, res: vec2f };
@group(0) @binding(0) var<uniform> u: U;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn rot2(p: vec2f, a: f32) -> vec2f {
  let c = cos(a); let s = sin(a);
  return vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
}
`;

// The particles demo exists to show the one thing WebGL2 genuinely cannot do:
// run the simulation on the GPU. WebGPU updates every particle in a compute
// shader and draws straight from that storage buffer, so nothing crosses the
// bus. WebGL2 has no compute stage, so the same maths runs in JS and the whole
// buffer is uploaded every frame — same picture, very different frame time.
// (WebGL2's transform feedback could keep it on the GPU; the CPU path is what
// most code actually does, and it's what makes the contrast visible.)
const WGSL_PARTICLES_COMPUTE = `
struct P { pos: vec2f, vel: vec2f };
struct U { time: f32, count: f32, res: vec2f };
@group(0) @binding(0) var<storage, read_write> parts: array<P>;
@group(0) @binding(1) var<uniform> u: U;

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (f32(i) >= u.count) { return; }
  var p = parts[i];
  // NB: 'target' is a WGSL reserved word — naming it that compiles to an
  // invalid pipeline, which then silently invalidates every pass that uses
  // it. 60fps, black canvas, no thrown error.
  let attractor = vec2f(cos(u.time * 0.7), sin(u.time * 0.9)) * 0.55;
  let d = attractor - p.pos;
  let r = max(length(d), 0.06);
  p.vel += (d / r) * (0.00035 / (r * r));
  p.vel *= 0.994;
  p.pos += p.vel;
  if (p.pos.x < -1.0 || p.pos.x > 1.0) { p.vel.x = -p.vel.x; }
  if (p.pos.y < -1.0 || p.pos.y > 1.0) { p.vel.y = -p.vel.y; }
  parts[i] = p;
}
`;

// Separate module from the compute one: the render side consumes the
// particles as vertex attributes.
const WGSL_PARTICLES_RENDER = `
struct VOut { @builtin(position) pos: vec4f, @location(0) col: vec3f };

// The same buffer the compute pass writes, read here as a VERTEX buffer
// rather than a storage buffer. Reading storage from the vertex stage is
// allowed by the spec but WebKit's limit for it is effectively zero, so the
// pipeline failed validation asynchronously — 60fps, nothing drawn.
@vertex fn vs(@location(0) pos: vec2f, @location(1) vel: vec2f) -> VOut {
  // tint by speed: slow embers stay amber, fast ones run pale and hot. With
  // additive blending the crowded regions bloom on their own.
  let sp = clamp(length(vel) * 55.0, 0.0, 1.0);
  var o: VOut;
  o.pos = vec4f(pos, 0.0, 1.0);
  o.col = mix(vec3f(0.55, 0.20, 0.03), vec3f(1.0, 0.92, 0.70), sp) * 0.55;
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return vec4f(v.col, 1.0);
}
`;

window.DECK_SHADERS = {

  particlesCompute: WGSL_PARTICLES_COMPUTE,
  particlesRender: WGSL_PARTICLES_RENDER,

  // WebGL2: points fed from a CPU-updated buffer
  PARTICLE_VERT: `#version 300 es
in vec2 a_pos;
in vec2 a_vel;
out vec3 v_col;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  gl_PointSize = 1.0;
  float sp = clamp(length(a_vel) * 55.0, 0.0, 1.0);
  v_col = mix(vec3(0.55, 0.20, 0.03), vec3(1.0, 0.92, 0.70), sp) * 0.55;
}`,
  PARTICLE_FRAG: `#version 300 es
precision mediump float;
in vec3 v_col;
out vec4 o;
void main() { o = vec4(v_col, 1.0); }`,

  wgsl: {

    plasma: WGSL_COMMON + `
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let frag = vec2f(fc.x, u.res.y - fc.y);
  let uv = (frag * 2.0 - u.res) / min(u.res.x, u.res.y);
  let t = u.time * 0.6;
  var v = sin(uv.x * 3.0 + t)
        + sin(uv.y * 4.0 - t * 1.3)
        + sin((uv.x + uv.y) * 2.5 + t * 0.7)
        + sin(length(uv) * 5.0 - t * 2.0);
  v = v * 0.25;
  // Four octaves of domain-warped turbulence over the smooth field: the big
  // shape stays, but it gains curdled detail that survives zooming in.
  var q = uv * 2.3 + vec2f(t * 0.15, -t * 0.11);
  var amp = 0.5;
  var fb = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    fb = fb + amp * sin(q.x + sin(q.y * 1.7 + t * 0.3));
    q = vec2f(q.x * 1.94 + q.y * 0.62, q.y * 1.94 - q.x * 0.62) + vec2f(1.7, 9.2);
    amp = amp * 0.52;
  }
  v = v + fb * 0.28;
  let warm = vec3f(1.0, 0.71, 0.33);
  let cold = vec3f(0.10, 0.22, 0.35);
  var col = mix(cold, warm, v * 0.5 + 0.5);
  col = col + vec3f(pow(max(v, 0.0), 3.0) * 0.5);
  // filament highlights where the turbulence folds back on itself
  col = col + vec3f(0.9, 0.5, 0.2) * pow(1.0 - abs(fract(v * 2.2) - 0.5) * 2.0, 12.0) * 0.35;
  // fine grain, so flat areas still have tooth
  let grain = fract(sin(dot(frag, vec2f(12.9898, 78.233))) * 43758.5453);
  col = col + (grain - 0.5) * 0.035;
  col = col * (1.0 - 0.35 * dot(uv, uv));
  return vec4f(col, 1.0);
}`,

    torus: WGSL_COMMON + `
fn map(p0: vec3f) -> f32 {
  var p = p0;
  let xz = rot2(p.xz, u.time * 0.5);
  p = vec3f(xz.x, p.y, xz.y);
  let xy = rot2(p.xy, u.time * 0.35);
  p = vec3f(xy.x, xy.y, p.z);
  let q = vec2f(length(p.xz) - 1.15, p.y);
  return length(q) - 0.42;
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let frag = vec2f(fc.x, u.res.y - fc.y);
  let uv = (frag * 2.0 - u.res) / min(u.res.x, u.res.y);
  let ro = vec3f(0.0, 0.0, -3.4);
  let rd = normalize(vec3f(uv, 1.7));
  var d = 0.0;
  var glow = 0.0;
  var hit = false;
  var p = ro;
  for (var i = 0; i < 90; i++) {
    p = ro + rd * d;
    let s = map(p);
    glow += exp(-abs(s) * 6.0) * 0.018;
    if (s < 0.001) { hit = true; break; }
    d += s;
    if (d > 12.0) { break; }
  }
  var col = vec3f(0.015, 0.02, 0.035);
  if (hit) {
    let e = vec2f(0.0015, 0.0);
    let n = normalize(vec3f(
      map(p + e.xyy) - map(p - e.xyy),
      map(p + e.yxy) - map(p - e.yxy),
      map(p + e.yyx) - map(p - e.yyx)));
    let l = normalize(vec3f(0.6, 0.8, -0.5));
    let dif = max(dot(n, l), 0.0);
    let rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col = vec3f(0.08, 0.05, 0.02)
        + vec3f(1.0, 0.62, 0.25) * dif * 0.85
        + vec3f(1.0, 0.8, 0.5) * rim;
  }
  col = col + vec3f(1.0, 0.65, 0.3) * glow;
  return vec4f(col, 1.0);
}`,

    tunnel: WGSL_COMMON + `
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let frag = vec2f(fc.x, u.res.y - fc.y);
  let uv = (frag * 2.0 - u.res) / min(u.res.x, u.res.y);
  // Curve the tunnel: work out the depth first, then swing the centre by a
  // function of THAT — deeper rings displace further, so the bore reads as
  // bending away rather than the whole image sliding.
  let r0 = length(uv);
  let z0 = 0.6 / (r0 + 0.12) + u.time * 1.8;
  let bend = vec2f(sin(z0 * 0.45) * 0.42, cos(z0 * 0.31) * 0.30);
  let p = uv - bend * r0;
  let r = length(p);
  let a = atan2(p.y, p.x);
  let z = 0.6 / (r + 0.12) + u.time * 1.8;
  let rings = sin(z * 3.0) * 0.5 + 0.5;
  let spokes = sin(a * 9.0 + z * 0.7 + u.time * 0.5) * 0.5 + 0.5;
  let v = rings * (0.55 + spokes * 0.45);
  var col = mix(vec3f(0.03, 0.04, 0.08), vec3f(1.0, 0.66, 0.28), v);
  col = col * smoothstep(0.0, 0.45, r);
  col = col + vec3f(1.0, 0.75, 0.4) * pow(rings * spokes, 6.0) * 0.6;
  return vec4f(col, 1.0);
}`,

  },

  VERT: `#version 300 es
void main() {
  vec2 p = vec2[](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0))[gl_VertexID];
  gl_Position = vec4(p, 0.0, 1.0);
}`,

  plasma: `#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_res;
out vec4 o;

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float t = u_time * 0.6;
  float v = sin(uv.x * 3.0 + t)
          + sin(uv.y * 4.0 - t * 1.3)
          + sin((uv.x + uv.y) * 2.5 + t * 0.7)
          + sin(length(uv) * 5.0 - t * 2.0);
  v *= 0.25;
  // same four octaves of domain-warped turbulence as the WGSL side
  vec2 q = uv * 2.3 + vec2(t * 0.15, -t * 0.11);
  float amp = 0.5, fb = 0.0;
  for (int i = 0; i < 4; i++) {
    fb += amp * sin(q.x + sin(q.y * 1.7 + t * 0.3));
    q = vec2(q.x * 1.94 + q.y * 0.62, q.y * 1.94 - q.x * 0.62) + vec2(1.7, 9.2);
    amp *= 0.52;
  }
  v += fb * 0.28;
  vec3 warm = vec3(1.0, 0.71, 0.33);
  vec3 cold = vec3(0.10, 0.22, 0.35);
  vec3 col = mix(cold, warm, v * 0.5 + 0.5);
  col += pow(max(v, 0.0), 3.0) * 0.5;             // hot cores
  col += vec3(0.9, 0.5, 0.2) *
         pow(1.0 - abs(fract(v * 2.2) - 0.5) * 2.0, 12.0) * 0.35;  // filaments
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (grain - 0.5) * 0.035;                   // fine tooth
  col *= 1.0 - 0.35 * dot(uv, uv);                // vignette
  o = vec4(col, 1.0);
}`,

  torus: `#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_res;
out vec4 o;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float map(vec3 p) {
  p.xz *= rot(u_time * 0.5);
  p.xy *= rot(u_time * 0.35);
  vec2 q = vec2(length(p.xz) - 1.15, p.y);
  return length(q) - 0.42;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  vec3 ro = vec3(0.0, 0.0, -3.4);
  vec3 rd = normalize(vec3(uv, 1.7));
  float d = 0.0, glow = 0.0;
  bool hit = false;
  vec3 p = ro;
  for (int i = 0; i < 90; i++) {
    p = ro + rd * d;
    float s = map(p);
    glow += exp(-abs(s) * 6.0) * 0.018;
    if (s < 0.001) { hit = true; break; }
    d += s;
    if (d > 12.0) break;
  }
  vec3 col = vec3(0.015, 0.02, 0.035);
  if (hit) {
    vec2 e = vec2(0.0015, 0.0);
    vec3 n = normalize(vec3(
      map(p + e.xyy) - map(p - e.xyy),
      map(p + e.yxy) - map(p - e.yxy),
      map(p + e.yyx) - map(p - e.yyx)));
    vec3 l = normalize(vec3(0.6, 0.8, -0.5));
    float dif = max(dot(n, l), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col = vec3(0.08, 0.05, 0.02)
        + vec3(1.0, 0.62, 0.25) * dif * 0.85
        + vec3(1.0, 0.8, 0.5) * rim;
  }
  col += vec3(1.0, 0.65, 0.3) * glow;
  o = vec4(col, 1.0);
}`,

  tunnel: `#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_res;
out vec4 o;

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  // depth first, then swing the centre by a function of it — same curve as
  // the WGSL side, so both dialects show the same tunnel
  float r0 = length(uv);
  float z0 = 0.6 / (r0 + 0.12) + u_time * 1.8;
  vec2 bend = vec2(sin(z0 * 0.45) * 0.42, cos(z0 * 0.31) * 0.30);
  vec2 p = uv - bend * r0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float z = 0.6 / (r + 0.12) + u_time * 1.8;
  float rings = sin(z * 3.0) * 0.5 + 0.5;
  float spokes = sin(a * 9.0 + z * 0.7 + u_time * 0.5) * 0.5 + 0.5;
  float v = rings * (0.55 + spokes * 0.45);
  vec3 col = mix(vec3(0.03, 0.04, 0.08), vec3(1.0, 0.66, 0.28), v);
  col *= smoothstep(0.0, 0.45, r);                // dark core = depth
  col += vec3(1.0, 0.75, 0.4) * pow(rings * spokes, 6.0) * 0.6;
  o = vec4(col, 1.0);
}`,

};
