// The physics: no gravity, a spring to the middle, heavy damping, and
// equal-mass collisions. Nothing here knows about three.

export function createSwarm(count, rand = Math.random) {
  const P = [], V = [], R = [];
  const between = (a, b) => a + rand() * (b - a);
  for (let i = 0; i < count; i++) {
    R.push(between(1.15, 2.05));
    P.push([between(-3.5, 3.5), between(-3.5, 3.5), between(-2, 2)]);
    V.push([between(-1, 1), between(-1, 1), between(-0.4, 0.4)]);
  }

  return {
    positions: P,
    radii: R,

    /** @param {AmpViz.Audio} audio */
    step(dt, audio, aspect) {
      const pull = 1.6 + audio.bass * 3.4;
      const pullX = pull / Math.min(1.7, Math.max(1, aspect));
      const damp = Math.exp(-3.2 * dt);
      const burst = audio.kick ? 9 + audio.punch * 14 : audio.beat ? 4 : 0;

      for (let i = 0; i < count; i++) {
        const p = P[i], v = V[i];
        const d = Math.hypot(p[0], p[1], p[2]) || 1e-4;
        v[0] -= p[0] * pullX * dt;
        v[1] -= p[1] * pull * dt;
        v[2] -= p[2] * (pull + 0.8) * dt;
        if (burst) for (let k = 0; k < 3; k++) v[k] += (p[k] / d) * burst * dt * 6;
        for (let k = 0; k < 3; k++) { v[k] *= damp; p[k] += v[k] * dt; }
      }

      // keep the centre of mass on the lens — a fixed camera shows every
      // millimetre of drift
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < count; i++) { cx += P[i][0]; cy += P[i][1]; cz += P[i][2]; }
      cx /= count; cy /= count; cz /= count;
      const k = Math.min(1, dt * 1.5);
      for (let i = 0; i < count; i++) { P[i][0] -= cx * k; P[i][1] -= cy * k; P[i][2] -= cz * k; }

      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const pi = P[i], pj = P[j];
          let dx = pj[0] - pi[0], dy = pj[1] - pi[1], dz = pj[2] - pi[2];
          const dd = Math.hypot(dx, dy, dz), min = R[i] + R[j];
          if (dd >= min || dd === 0) continue;
          dx /= dd; dy /= dd; dz /= dd;
          const push = (min - dd) * 0.5;
          pi[0] -= dx * push; pi[1] -= dy * push; pi[2] -= dz * push;
          pj[0] += dx * push; pj[1] += dy * push; pj[2] += dz * push;
          const vi = V[i], vj = V[j];
          const rel = (vj[0] - vi[0]) * dx + (vj[1] - vi[1]) * dy + (vj[2] - vi[2]) * dz;
          if (rel > 0) continue;
          const imp = rel * 0.92;
          vi[0] += dx * imp; vi[1] += dy * imp; vi[2] += dz * imp;
          vj[0] -= dx * imp; vj[1] -= dy * imp; vj[2] -= dz * imp;
        }
      }
    },
  };
}
