// The room the spheres reflect, as an equirectangular image built in code.
//
// Note this file never imports three. `THREE` is a global amp injects, and the
// types come from the `declare const THREE` in types/amp-viz.d.ts — which
// is why `three` is a devDependency here and not in the output.

/**
 * @param {number} accent  the bounce colour, 0xRRGGBB
 * @param {number} room    the wall colour, 0xRRGGBB
 */
export function makeEnvironment(accent, room) {
  const W = 256, H = 128;
  // FLOAT, not bytes: a studio look lives above white, and 8 bits clamps there
  const data = new Float32Array(W * H * 4);
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;

  const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const blob = (u, v, cu, cv, ru, rv, f) => {
    let du = Math.abs(u - cu); if (du > 0.5) du = 1 - du;   // wrap in azimuth
    const d = Math.hypot(du / ru, (v - cv) / rv);
    return d >= 1 ? 0 : Math.pow(1 - d, f);
  };

  const wall = rgb(room), acc = rgb(accent);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const sky = 1.35 - Math.pow(v, 1.6) * 1.15;
      let r = wall[0] * sky, g = wall[1] * sky, b = wall[2] * sky;
      const key = blob(u, v, 0.42, 0.16, 0.20, 0.26, 1.6) * 7;
      const hot = blob(u, v, 0.42, 0.15, 0.05, 0.07, 2.2) * 16;
      r += key + hot; g += key + hot; b += key + hot;
      const bounce = blob(u, v, 0.70, 0.78, 0.34, 0.30, 1.3) * 3.2;
      r += acc[0] * bounce; g += acc[1] * bounce; b += acc[2] * bounce;
      const i = (y * W + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
    }
  }
  tex.needsUpdate = true;
  return tex;
}
