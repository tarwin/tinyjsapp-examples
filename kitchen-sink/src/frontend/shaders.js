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

window.DECK_SHADERS = {

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
  let warm = vec3f(1.0, 0.71, 0.33);
  let cold = vec3f(0.10, 0.22, 0.35);
  var col = mix(cold, warm, v * 0.5 + 0.5);
  col = col + vec3f(pow(max(v, 0.0), 3.0) * 0.5);
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
  let r = length(uv);
  let a = atan2(uv.y, uv.x);
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
  vec3 warm = vec3(1.0, 0.71, 0.33);
  vec3 cold = vec3(0.10, 0.22, 0.35);
  vec3 col = mix(cold, warm, v * 0.5 + 0.5);
  col += pow(max(v, 0.0), 3.0) * 0.5;             // hot cores
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
  float r = length(uv);
  float a = atan(uv.y, uv.x);
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
