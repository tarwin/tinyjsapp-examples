// amp:uses three
//
// Ballroom — a swarm of spheres in a bright room, jostling on the beat.
// After the pmndrs SSGI-spheres study; the lighting rig, the lens and the post
// chain follow it, the styles and everything that listens to music are amp's.
//
// Three things carry the look, and none of them is the material:
//
//   THE LENS. 17.5° is a portrait lens. It flattens the perspective, makes the
//   spheres read as enormous, and holds the highlights steady across the frame
//   the way a studio photograph does. The camera distance moves to fit the
//   swarm; the focal length never does.
//
//   A DARK ROOM WITH SMALL FIERCE LIGHTS IN IT. Not a bright room. The backdrop
//   is a flat pale grey that emits nothing; the light is a hard key, a broad dim
//   fill and a red ring, built as real emissive geometry and prefiltered into an
//   environment map. A dark room is what gives a shaded side anywhere to go, and
//   what leaves the global illumination something to contribute.
//
//   RESTRAINT. Three colours at a time, never four.
//
// WebGPU only: the post chain is the point of this one and it does not survive
// three's WebGL2 fallback (measured — the composite comes out empty).

amp.register({
  name: 'Ballroom',
  backends: ['webgpu'],
  presets: ['auto', 'studio', 'chrome', 'glass', 'prism', 'clay', 'pottery', 'harlequin', 'lantern', 'nightclub', 'nebula', 'oilslick', 'vortex', 'jumble', 'embers', 'porcelain', 'marble', 'gyroid', 'paperweight'],

  async create({ canvas, width, height, state, hdr }) {
    const ROOM = 0xeeeeee, DARK = 0x444444, PALE = 0xffffff;
    const ACCENTS = [0xff4060, 0xffcc00, 0x20ffa0, 0x2060ff, 0xff7a18, 0xc86bff];
    // Neighbours of the current accent rather than the whole wheel. Picking
    // freely from six hues gives a clown's palette; taking the accent and the
    // two either side of it keeps the frame in one family while still letting
    // a dozen patterned balls differ from each other.
    const nearAccent = (i, spread) => ACCENTS[
      (accentIx + ((i * 7) % ((spread || 2) * 2 + 1)) - (spread || 2)
        + ACCENTS.length * 2) % ACCENTS.length];

    // ── patterns ───────────────────────────────────────────────────────────
    // Signed distance fields, evaluated in the shader, rather than a picture
    // painted into a texture. Three reasons, and the first is the one that
    // matters here:
    //
    //   SHARPNESS. This visualizer cuts to macro shots. A 512×256 map is a
    //   soft grey smear by the time a ball fills the frame, and its mipmaps
    //   make that worse, not better. A distance field has no resolution — the
    //   edge is exact at any zoom, and antialiased from the screen-space
    //   derivative, so it stays crisp without shimmering either.
    //
    //   IT IS A MASK. A distance gives you coverage 0..1, which can drive
    //   anything. Here it drives EMISSION: the ball itself is unlit black and
    //   only the pattern glows, which a texture in the albedo slot cannot do —
    //   that just gets lit along with everything else.
    //
    //   NO MEMORY, no upload, no cache keyed by colour.
    //
    // The distances are computed in ARC LENGTH on the sphere, not in raw UV.
    // Longitude lines converge at the poles, so a dot laid out in plain UV is
    // a circle at the equator and a thin ellipse at the top.
    //
    // ONE graph for every patterned ball, with the kind, count, width and
    // colour read off the material being drawn (materialReference with no
    // material bound reads whichever one is rendering). This is the load-time
    // fix. three shares a compiled pipeline only between materials whose
    // generated WGSL is identical, and a number baked in as a TSL constant is
    // part of that text — so the old graph-per-(kind, count, width) plus a
    // colour constant per ball gave harlequin eighteen distinct shaders and a
    // three-second freeze while they compiled. As uniforms, every patterned
    // ball in every style is the same program, compiled once.
    const T0 = THREE.TSL;
    const patKind = T0.materialReference('patKind', 'float');     // 0 dots, 1 stripes, 2 spiral
    const patCount = T0.materialReference('patCount', 'float');
    const patWidth = T0.materialReference('patWidth', 'float');
    const PAT_KIND = { dots: 0, stripes: 1, spiral: 2 };
    const patternMask = T0.Fn(() => {
      const T = T0;
      const p = T.uv();

      // Bands of latitude: rings around the ball, not segments of an orange.
      // Count and width both vary per ball — four fat bands next to fourteen
      // fine ones is most of what stops eighteen striped spheres reading as
      // wallpaper.
      const dStripes = p.y.mul(patCount).fract().sub(0.5).abs().sub(patWidth);

      // one band whose longitude advances with latitude — the whole spiral is
      // this single line, and it wraps for free because fract() does
      const dSpiral = p.x.sub(p.y.mul(patCount)).fract().sub(0.5).abs().sub(patWidth);

      // rows of dots, with the count per row following the circumference so
      // they neither crowd at the poles nor stretch at the equator
      const cols = patCount.mul(1.9).round();
      const rowF = p.y.mul(patCount);
      const row = rowF.floor();
      const fy = rowF.fract().sub(0.5);
      const circ = row.add(0.5).div(patCount).mul(Math.PI).sin().max(0.12);
      const n = circ.mul(cols).max(2.0);
      const stagger = row.mul(0.5).fract();
      const fx = p.x.mul(n).add(stagger).fract().sub(0.5);
      // arc length: du spans 2π·sin(lat)/n, dv spans π/ROWS
      const sx = fx.mul(circ.mul(Math.PI * 2).div(n));
      const sy = fy.mul(Math.PI).div(patCount);
      const dDots = T.length(T.vec2(sx, sy)).sub(patWidth);

      // all three are a handful of ALU each; selecting beats a pipeline apiece
      const d = T.select(patKind.lessThan(0.5), dDots,
        T.select(patKind.lessThan(1.5), dStripes, dSpiral));

      // one pixel of coverage either side of the edge, from the derivative —
      // this is what keeps it clean at a macro shot AND at a wide one
      const w = T.fwidth(d).max(0.0001);
      return T.smoothstep(w, w.negate(), d);
    })();

    // how hard the patterns glow, pushed from the beat each frame
    const patternGlow = THREE.TSL.uniform(1);
    // and the two the orb fields run on: a clock, and how hard the music is
    // pushing the field about
    const fieldTime = THREE.TSL.uniform(0);
    const fieldWarp = THREE.TSL.uniform(0);

    // ── orb fields ─────────────────────────────────────────────────────────
    // Whole-surface procedural shaders, as opposed to the patterns above. Two
    // differences that matter:
    //
    //   They are sampled at positionLocal — noise evaluated in 3D at the point
    //   on the sphere — rather than in UV. So there is no seam to hide and no
    //   pole to compensate for; the field simply exists in space and the
    //   sphere passes through it. All the arc-length care the dots needed is
    //   moot here.
    //
    //   They are EMISSIVE. These orbs are lit from within, not by the room, so
    //   they read against a dark backdrop the way the reference images do.
    //
    // Cached per KIND only. The two colours come off the material (fieldA,
    // fieldB) for the same reason the patterns' do: baked in as constants,
    // every accent change minted three brand-new shaders and stalled on them.
    const fieldCache = Object.create(null);
    function orbField(kind) {
      if (fieldCache[kind]) return fieldCache[kind];
      const T = THREE.TSL;
      const va = T.materialReference('fieldA', 'color');
      const vb = T.materialReference('fieldB', 'color');

      fieldCache[kind] = T.Fn(() => {
        const t = fieldTime;
        const p = T.positionLocal;

        if (kind === 'nebula') {
          // Cloud, with a hot core. The core is a dot against a fixed
          // direction rather than a point in the noise, so it stays put while
          // the cloud drifts over it — which is what makes it read as
          // something burning INSIDE rather than a bright patch of cloud.
          const q = T.vec3(p.x.add(t.mul(0.05)), p.y.sub(t.mul(0.02)), p.z).mul(1.5);
          // pow() on the noise pushes most of the surface DOWN. Straight fBm
          // sits around 0.5 everywhere, which makes a uniformly bright ball;
          // the reference is mostly dark cloud with the fire in one place.
          const n = T.mx_fractal_noise_float(q, 5, 2.1, 0.55).mul(0.5).add(0.5).pow(2.2);
          const core = T.normalLocal.dot(T.vec3(0.2, 0.3, 0.93)).max(0).pow(4.5);
          const heat = n.mul(0.5).add(core.mul(0.95)).add(fieldWarp.mul(0.15)).clamp(0, 1.5);
          const base = T.mix(va, vb, heat.clamp(0, 1));
          const lit = base.add(T.vec3(1, 0.88, 0.66).mul(heat.sub(1.0).max(0).mul(2.2)));
          // The dark limb. A sphere lit from inside still falls off where the
          // surface turns away from you, and without it the thing reads as a
          // flat disc of noise rather than a globe — it is doing as much work
          // here as the cloud is.
          const facing = T.normalView.z.max(0);
          return lit.mul(facing.pow(0.85).mul(0.9).add(0.1));
        }

        if (kind === 'oilslick') {
          // Thin film. The rings come from folding a noise field through a
          // sine and reading the result as HUE — interference is a phase
          // effect, so cycling hue on a phase is closer to the real thing than
          // any amount of blending two colours would be.
          const q = p.mul(1.35).add(t.mul(0.06));
          const warp = T.mx_fractal_noise_vec3(q, 3, 2, 0.5).mul(fieldWarp.mul(0.5).add(0.55));
          const n = T.mx_fractal_noise_float(q.add(warp), 4, 2.2, 0.5);
          const phase = n.mul(9).add(t.mul(0.35));
          const band = phase.sin().mul(0.5).add(0.5);
          const hue = phase.mul(0.11).add(n.mul(0.25)).fract();
          return T.mx_hsvtorgb(T.vec3(hue, 0.8, band.mul(0.62).add(0.28)));
        }

        // vortex: the sample point is ROTATED by an angle that grows with
        // latitude, which drags the noise into arms. Domain warping — the
        // swirl is in the coordinates, not the colour.
        const spin = p.y.mul(2.1)
          .add(T.mx_fractal_noise_float(p.mul(0.7).add(t.mul(0.04)), 3, 2, 0.5).mul(2.2))
          .add(t.mul(0.12)).add(fieldWarp.mul(0.5));
        const ca = spin.cos(), sa = spin.sin();
        const q = T.vec3(p.x.mul(ca).sub(p.z.mul(sa)), p.y, p.x.mul(sa).add(p.z.mul(ca)));
        const n = T.mx_fractal_noise_float(q.mul(1.25), 4, 2.1, 0.55).mul(0.5).add(0.5);
        const k = n.pow(1.6);
        return T.mix(va, vb, k).mul(k.mul(1.15).add(0.22));
      })();
      return fieldCache[kind];
    }

    // ── light through the ball ─────────────────────────────────────────────
    // After the porcelain study at stream1018: light that ENTERS a ball on
    // the far side, loses colour on the way through (Beer–Lambert), and
    // leaves toward the viewer through a phase lobe bent by the surface
    // normal. The study marches an SDF to find how much material lies between
    // a point and the light. Here there is nothing to march — the thing is a
    // sphere, and the chord from a surface point toward the light is exactly
    // 2·max(0, −N·L) in local units. The study's whole cost goes away and the
    // look stays.
    //
    // The lights it uses are the rig's: the key disc and the coloured ring,
    // as world directions that follow the environment's rotation each frame.
    const T = THREE.TSL;
    const keyDir = T.uniform(new THREE.Vector3(0, 1, 0));
    const keyCol = T.uniform(new THREE.Color(1, 1, 1));
    const rimDir = T.uniform(new THREE.Vector3(1, 0, 0));
    const rimCol = T.uniform(new THREE.Color(1, 0, 0));
    const sssPulse = T.uniform(1);              // the beat, pushed through the wax
    const sssTint = T.materialReference('sssTint', 'color');     // what survives the trip
    const sssColor = T.materialReference('sssColor', 'color');   // what it scatters as
    const sssDensity = T.materialReference('sssDensity', 'float');
    // pow() through exp2/log2 with the base held off zero: Metal's fast maths
    // turns pow(0, y) into NaN, and bloom spreads one NaN into a white block
    const spow = (x, y) => T.exp2(T.log2(x.max(1e-4)).mul(y));

    const translucency = T.Fn(([N, V]) => {
      const absorb = T.log(sssTint.max(0.001)).negate().mul(sssDensity);
      const through = (L, C) => {
        const thick = N.dot(L).negate().max(0).mul(2);
        const transmit = T.exp(absorb.mul(thick).negate());
        // the study's distortion 0.2 and ambient 0.03; a tighter lobe than
        // its power 3, because a rig light is far brighter than its lamps
        const Lt = L.add(N.mul(0.2)).normalize();
        const phase = spow(V.dot(Lt.negate()).clamp(0, 1), 5).mul(1.6);
        return C.mul(phase.add(0.03)).mul(transmit);
      };
      return sssColor.mul(through(keyDir, keyCol).add(through(rimDir, rimCol))).mul(sssPulse);
    });
    const viewDirWorld = T.cameraPosition.sub(T.positionWorld).normalize();
    const sssNode = translucency(T.normalWorld, viewDirWorld);

    // ── marble ─────────────────────────────────────────────────────────────
    // The vein recipe from the same studies' raymarched marble: two sine
    // bands pushed around by fractal noise and then SHARPENED with a high
    // power, a bold one and a fine one crossing it. The power is the trick —
    // a plain sine of noise is a soft stripe; raised to the 14th and the 40th
    // it collapses into the thin, branching lines real stone has. Evaluated
    // at positionLocal, so it is carved through the ball and turns with it.
    const marbleBase = T.materialReference('marbleBase', 'color');
    const marbleVein = T.materialReference('marbleVein', 'color');
    const marbleSeed = T.materialReference('marbleSeed', 'float');
    const fbm01 = (q) => T.mx_fractal_noise_float(q, 4, 2.03, 0.5).mul(0.5).add(0.5);
    const marbleNode = T.Fn(() => {
      const q = T.positionLocal.mul(1.05).add(marbleSeed);
      const bold = T.float(1).sub(T.sin(q.dot(T.vec3(0.8, 0.5, 0.3)).mul(1.5).add(fbm01(q).mul(4.5))).abs());
      const fine = T.float(1).sub(T.sin(q.dot(T.vec3(-0.3, 0.9, 0.4)).mul(3.1).add(fbm01(q.mul(2).add(5)).mul(6))).abs());
      const veins = spow(bold, 14).mul(0.9).add(spow(fine, 60).mul(0.3)).clamp(0, 1);
      const stone = marbleBase.mul(fbm01(q.mul(0.7).add(3)).mul(0.16).add(0.88));
      return T.mix(stone, marbleVein, veins);
    })();

    // ── gyroid ─────────────────────────────────────────────────────────────
    // The gyroid study: a triply periodic surface, sin·cos summed over the
    // axes, thickened into a sheet and clipped by the shape it lives in. The
    // study marches a baked statue SDF; the shape here is a unit sphere, so
    // the clip is one length(). Each ball is drawn as its ordinary mesh and
    // the fragment shader marches the lattice inside it from the point where
    // the view ray enters: a miss is discarded (you see the next ball through
    // the gaps), a hit writes its OWN depth and normal. That last part is
    // what lets SSR, SSGI and TRAA treat the lattice as real geometry —
    // reflections land on the struts and the bounce light pools inside.
    //
    // The cell drifts through the ball on the field clock and the sheet
    // thickens with the bass, so the structure breathes with the music, and
    // the heart of each ball burns in the accent on the beat.
    const gyroOffset = T.uniform(new THREE.Vector3());
    const gyroThick = T.uniform(0.11);
    const gyroColor = T.materialReference('gyroColor', 'color');
    const gyroGlow = T.materialReference('gyroGlow', 'color');
    const GYRO_K = 7.5;                         // ~2.4 cells across a ball
    const gyroSdf = T.Fn(([p]) => {
      const q = p.mul(GYRO_K).add(gyroOffset);
      const g = T.sin(q).dot(T.cos(q.yzx));
      const sheet = g.abs().div(GYRO_K * 1.8).sub(gyroThick.mul(0.5));
      return T.max(p.length().sub(1), sheet);
    });
    const gyroMarch = T.Fn(() => {
      const ro = T.modelWorldMatrixInverse.mul(T.vec4(T.cameraPosition, 1)).xyz;
      const rd = T.positionLocal.sub(ro).normalize();
      const p = T.positionLocal.toVar();
      const hit = T.float(0).toVar();
      T.Loop(56, () => {
        const d = gyroSdf(p);
        T.If(d.lessThan(0.0015), () => { hit.assign(1); T.Break(); });
        p.addAssign(rd.mul(d.max(0.004)));
        T.If(p.dot(p).greaterThan(1.0004), () => { T.Break(); });
      });
      T.If(hit.lessThan(0.5), () => { T.Discard(); });
      return p;
    })().toVar('gyroHit');
    const gyroNormalLocal = T.Fn(() => {
      // four taps on a tetrahedron, not six on the axes
      const e = 0.0025;
      const k0 = T.vec3(1, -1, -1), k1 = T.vec3(-1, -1, 1), k2 = T.vec3(-1, 1, -1), k3 = T.vec3(1, 1, 1);
      return k0.mul(gyroSdf(gyroMarch.add(k0.mul(e))))
        .add(k1.mul(gyroSdf(gyroMarch.add(k1.mul(e)))))
        .add(k2.mul(gyroSdf(gyroMarch.add(k2.mul(e)))))
        .add(k3.mul(gyroSdf(gyroMarch.add(k3.mul(e))))).normalize();
    })().toVar('gyroN');
    // the study's five-tap occlusion: how far the field falls short of the
    // distance stepped out along the normal is how buried the point is
    const gyroAO = T.Fn(() => {
      const occ = T.float(0).toVar();
      for (let i = 0; i < 5; i++) {
        const h = 0.02 + 0.05 * i;
        occ.addAssign(T.float(h).sub(gyroSdf(gyroMarch.add(gyroNormalLocal.mul(h)))).mul(Math.pow(0.8, i)));
      }
      return T.float(1).sub(occ.mul(3.2)).clamp(0.15, 1);
    })();
    const gyroDepth = T.Fn(() => {
      const clip = T.cameraProjectionMatrix.mul(T.modelViewMatrix).mul(T.vec4(gyroMarch, 1));
      return clip.z.div(clip.w);
    })();
    const gyroLook = {
      colorNode: gyroColor.mul(gyroAO),
      normalNode: T.transformNormalToView(gyroNormalLocal),
      depthNode: gyroDepth,
      // the heart: brightest at the centre of the ball, carried by the beat
      emissiveNode: gyroGlow.mul(spow(T.float(1).sub(gyroMarch.length()).clamp(0, 1), 2.2))
        .mul(patternGlow).mul(gyroAO),
      // Out of SSR's way. A deep concave lattice is where screen-space rays
      // miss most, and the misses salted the struts with black and teal. The
      // material still shades as metal from the room; this only tells the
      // reflection pass, through the metal/rough buffer it reads, that there
      // is nothing here for it to do.
      mrtNode: T.mrt({ metalrough: T.vec2(0, 1) }),
    };

    // ── gold in glass ──────────────────────────────────────────────────────
    // The gold-in-glass study, done exactly instead of by marching. The view
    // ray refracts into the ball; a concentric gold core is a ray–sphere test
    // away. Hit it and the gold is shaded where the ray lands — Fresnel over
    // the room's prefiltered light, ROUGHER the further the ray travelled
    // through the frosted glass, which is the study's best idea: a core near
    // the surface reads sharp and one deep inside reads soft. Miss it and the
    // ray leaves through the back and sees the backdrop. Glass absorption on
    // both, by path length. And the study's cone trick for the edge: a ray
    // that only just misses the core still picks up some of it, in
    // proportion to how near it came against how wide the frost has spread
    // by then — so the core's silhouette goes soft with depth too.
    //
    // No transmission pass at all. The glass is a black dielectric that keeps
    // its own reflection; the light through it is emission.
    const envTurn = T.uniform(0);                // the environment's Y rotation
    const goldColor = T.materialReference('goldColor', 'color');
    const coreRadius = T.materialReference('coreRadius', 'float');
    const frost = T.materialReference('frost', 'float');
    const glassTint = T.materialReference('glassTint', 'color');
    let paperEnv = null, paperNode = null;
    function paperLook() {
      if (paperNode) return paperNode;
      const IOR = 1.5;
      // local direction → the direction to look up in the environment:
      // to world, then by transpose(R), i.e. a turn of −θ about Y
      const envDir = (d) => {
        const w = T.modelWorldMatrix.mul(T.vec4(d, 0)).xyz.normalize();
        const c = T.cos(envTurn), s = T.sin(envTurn);
        return T.vec3(w.x.mul(c).sub(w.z.mul(s)), w.y, w.x.mul(s).add(w.z.mul(c)));
      };
      const backdrop = (d) => T.texture(rigFlat, T.equirectUV(
        T.modelWorldMatrix.mul(T.vec4(d, 0)).xyz.normalize())).rgb;
      paperNode = T.Fn(() => {
        const p = T.positionLocal.normalize();
        const N = p;
        const ro = T.modelWorldMatrixInverse.mul(T.vec4(T.cameraPosition, 1)).xyz;
        const V = ro.sub(p).normalize();
        const rd = T.refract(V.negate(), N, 1 / IOR).normalize();
        const absorb = T.log(glassTint.max(0.001)).negate();

        const b = p.dot(rd);
        const disc = b.mul(b).sub(p.dot(p)).add(coreRadius.mul(coreRadius));
        const tCore = b.negate().sub(disc.max(0).sqrt());
        const hitCore = disc.greaterThan(0).and(tCore.greaterThan(0));
        const tExit = b.mul(-2).max(1e-3);           // |p| = 1, so the far side is at −2·p·rd
        // the near miss: closest approach of the ray to the centre
        const tNear = b.negate().clamp(1e-3, tExit);
        const dNear = p.add(rd.mul(tNear)).length();
        const spread = frost.mul(1 - 1 / IOR).add(1e-3);
        const cover = T.select(hitCore, T.float(1),
          T.float(1).sub(T.smoothstep(0, 1, dNear.sub(coreRadius).div(spread.mul(tNear)))));

        const tg = T.select(hitCore, tCore, tNear);
        const h = p.add(rd.mul(tg));
        const nh = h.normalize();
        const rough = frost.mul(0.35).add(spread.mul(tg).mul(2.2)).add(0.12).clamp(0, 1);
        const cosT = nh.dot(rd.negate()).clamp(0, 1);
        const f5 = T.float(1).sub(cosT);
        const F = goldColor.add(T.float(1).sub(goldColor).mul(f5.mul(f5).mul(f5).mul(f5).mul(f5)));
        paperEnv = T.pmremTexture(scene.environment, envDir(rd.reflect(nh)), rough);
        const gold = F.mul(paperEnv).mul(1.6)
          .mul(T.exp(absorb.mul(tg).negate()));

        const pe = p.add(rd.mul(tExit));
        const out0 = T.refract(rd, pe.normalize().negate(), IOR);
        const out = T.select(out0.dot(out0).greaterThan(1e-4), out0, rd.reflect(pe.normalize().negate()));
        const behind = backdrop(out.normalize()).mul(T.exp(absorb.mul(tExit).negate()));

        // the study keeps the glass's own reflection and hands the rest of
        // the light to what is inside, in proportion to 1 − Fresnel
        const fres = T.float(0.04).add(T.float(0.96).mul(spow(T.float(1).sub(N.dot(V).clamp(0, 1)), 5)));
        return T.mix(behind, gold, cover).mul(T.float(1).sub(fres));
      })();
      return paperNode;
    }


    // ── styles ─────────────────────────────────────────────────────────────
    // A style is a material recipe plus a size range and a temperament. `skin`
    // paints one ball: it gets the index and the current accent, and returns
    // what that ball should be. Everything else — physics, framing, lighting —
    // is shared, which is what keeps them feeling like one piece rather than
    // six visualizers wearing a trenchcoat.
    const STYLES = [
      {
        id: 'studio', name: 'studio',
        // the reference: charcoal, white, accent, six each, all radius 1
        size: [1, 1], orbit: 0.02, churn: 0,
        skin(i, accent) {
          const t = [2, 0, 1, 2, 1, 0, 0, 2, 1, 1, 0, 2, 2, 1, 0, 0, 1, 2][i % 18];
          return { color: t === 1 ? accent : t === 2 ? DARK : PALE,
            metalness: 0.5, roughness: 0.2 };
        },
      },
      {
        id: 'chrome', name: 'chrome',
        // mirrors, and a wider range of sizes so the reflections have something
        // interesting to bend
        size: [0.7, 1.6], orbit: 0.06, churn: 0,
        skin(i, accent) {
          const tinted = i % 4 === 0;
          return { color: tinted ? accent : 0xffffff, metalness: 1, roughness: 0.06 };
        },
      },
      {
        id: 'glass', name: 'glass',
        size: [0.8, 1.5], orbit: 0.05, churn: 0.35,
        skin(i, accent) {
          return { color: 0xffffff, metalness: 0, roughness: 0.04,
            transmission: 1, ior: 1.45, thickness: 1.6,
            attenuationColor: i % 3 === 0 ? accent : 0xffffff, attenuationDistance: 3 };
        },
      },
      {
        id: 'prism', name: 'prism',
        // glass that splits the light. `dispersion` is real chromatic
        // dispersion — the rainbow lives in the refraction rather than being
        // painted on — with a film of iridescence over the top for the sheen.
        size: [0.85, 1.5], orbit: 0.09, churn: 0.5,
        skin() {
          return { color: 0xffffff, metalness: 0, roughness: 0.02,
            transmission: 1, ior: 1.6, thickness: 2.2, dispersion: 4.5,
            iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [120, 520] };
        },
      },
      {
        id: 'clay', name: 'clay',
        // Matte. Everything else here is glossy, and after a while a whole
        // frame of reflections has nowhere left to go — the eye has no plain
        // surface to rest on. Roughness up, metalness off, and enough sheen
        // that the balls still have a form rather than reading as flat discs.
        size: [0.85, 1.5], orbit: 0.03, churn: 0.15,
        skin(i, accent) {
          const t = [2, 0, 1, 2, 1, 0, 0, 2, 1, 1, 0, 2, 2, 1, 0, 0, 1, 2][i % 18];
          return { color: t === 1 ? accent : t === 2 ? 0x2e2b28 : 0xe8e2d8,
            metalness: 0, roughness: 0.78, sheen: 0.5, sheenRoughness: 0.7,
            sheenColor: 0xffffff };
        },
      },
      {
        id: 'pottery', name: 'pottery',
        // Glazed and painted: black balls carrying one colour, in dots, rings
        // or a spiral. The pattern is the subject, so the surface has to stay
        // matte — put this on chrome and the room's reflection sits on top of
        // the pattern and you can read neither.
        size: [0.9, 1.55], orbit: 0.035, churn: 0.25,
        skin(i, accent) {
          const kinds = ['dots', 'stripes', 'spiral'];
          // a third of them plain, so the patterned ones have something to be
          // patterned against
          if (i % 3 === 2) {
            return { color: 0x141414, metalness: 0, roughness: 0.62,
              sheen: 0.4, sheenRoughness: 0.6, sheenColor: 0xffffff };
          }
          // NOT kinds[i % 3]: i % 3 === 2 is the plain branch above, so that
          // index can only ever land on 0 or 1 and the spiral would never once
          // be drawn. Stepping by i/3 walks all three.
          //
          // The ball is unlit black and the PATTERN glows. That is the whole
          // reason for the distance field: a mask can drive emission, where a
          // texture in the albedo slot would only ever be lit like the rest of
          // the surface.
          // Count and width vary per ball. Eighteen spheres wearing the same
          // seven stripes is wallpaper; four fat bands next to twelve fine
          // ones is a set of objects.
          const kind = kinds[Math.floor(i / 3) % kinds.length];
          const step = (i * 7) % 5;                       // 0..4, well mixed
          const count = kind === 'dots' ? 5 + step
            : kind === 'spiral' ? 3 + step
            : 4 + step * 2;                               // stripes: 4 to 12
          const width = kind === 'dots' ? 0.1 + step * 0.012
            : 0.34 - step * 0.035;                        // fat bands to fine
          return { color: 0x0b0b0b, metalness: 0, roughness: 0.62,
            sheen: 0.4, sheenRoughness: 0.6, sheenColor: 0xffffff,
            glow: { kind, count, width, colour: accent } };
        },
      },
      {
        id: 'harlequin', name: 'harlequin',
        // The same distance fields, but every ball painted in its own colour
        // off a narrow palette instead of all sharing the accent. Spin makes
        // this one: a dozen differently-marked balls slowly turning is a very
        // different object from a dozen identical ones sitting still.
        size: [0.8, 1.5], orbit: 0.05, churn: 0.3,
        skin(i) {
          const kinds = ['dots', 'stripes', 'spiral'];
          const kind = kinds[Math.floor(i / 2) % kinds.length];
          const step = (i * 7) % 5;
          const count = kind === 'dots' ? 5 + step : kind === 'spiral' ? 3 + step : 4 + step * 2;
          const width = kind === 'dots' ? 0.1 + step * 0.012 : 0.34 - step * 0.035;
          return { color: 0x0d0d0d, metalness: 0, roughness: 0.6,
            sheen: 0.4, sheenRoughness: 0.6, sheenColor: 0xffffff,
            glow: { kind, count, width, colour: nearAccent(i, 2) } };
        },
      },
      {
        id: 'lantern', name: 'lantern',
        // Holes cut clean through the shell, with a lit core behind them. The
        // pattern stops being paint and becomes structure — the ball has an
        // inside, and the inside is the brightest thing in the frame.
        //
        // This is what the distance field was really for: the same mask that
        // painted a dot can just as easily remove one.
        flicker: 0.35, size: [1, 1.7], orbit: 0.05, churn: 0.4,
        hero: { scale: 2.3, pull: 3.2 },
        skin(i, accent) {
          const kinds = ['dots', 'stripes', 'spiral'];
          const kind = kinds[i % kinds.length];
          return {
            color: 0x17161a, metalness: 0.1, roughness: 0.34,
            // fewer, fatter holes than the painted version — a hole has to be
            // big enough to see through before it reads as one
            holes: { kind, count: kind === 'dots' ? 6 : 5,
              width: kind === 'dots' ? 0.16 : 0.2 },
            // Emissive is multiplied by the colour, so a big number does not
            // glow harder — it pushes past white and ACES flattens it to grey,
            // losing the accent. Under 1 keeps the colour and still blooms.
            core: { color: 0x120a0c, emissive: accent, intensity: 0.85, scale: 0.8 },
          };
        },
      },
      {
        id: 'nightclub', name: 'nightclub',
        // The lights themselves come into shot. On a black backdrop the rig
        // stops being something you infer from reflections and becomes the
        // subject: glowing discs and rings hanging behind the swarm, with the
        // balls reading as dark glass in front of them.
        flicker: 0.55, size: [0.7, 1.5], orbit: 0.08, churn: 0.3,
        bg: 0x05060a, showRig: true, pulse: 1, bands: true,
        skin(i, accent) {
          return { color: 0x121212, metalness: 0.2, roughness: 0.12,
            emissive: accent, emissiveIntensity: 0 };   // the pulse drives this
        },
      },
      {
        id: 'nebula', name: 'nebula',
        // A cloud with something burning inside it. Dark room, because these
        // are lit from within and a bright backdrop would flatten them.
        size: [0.9, 1.7], orbit: 0.03, churn: 0.2,
        bg: 0x07050a, orb: 'nebula',
        skin(i, accent) {
          return { color: 0x000000, metalness: 0, roughness: 1,
            field: { kind: 'nebula', a: 0x3a0f3a, b: nearAccent(i, 1) } };
        },
      },
      {
        id: 'oilslick', name: 'oilslick',
        // Thin-film interference. Hue cycled on a phase rather than two
        // colours blended, because that is what interference actually is.
        size: [0.85, 1.6], orbit: 0.06, churn: 0.25,
        bg: 0x05060c, orb: 'oilslick',
        skin() {
          return { color: 0x000000, metalness: 0, roughness: 1,
            field: { kind: 'oilslick', a: 0x000000, b: 0xffffff } };
        },
      },
      {
        id: 'vortex', name: 'vortex',
        // Domain-warped swirl — the spiral is in the coordinates, not the
        // colour, which is why the arms bend rather than merely rotating.
        size: [0.9, 1.7], orbit: 0.04, churn: 0.2,
        bg: 0x06040c, orb: 'vortex',
        skin(i, accent) {
          return { color: 0x000000, metalness: 0, roughness: 1,
            field: { kind: 'vortex', a: 0x140b33, b: nearAccent(i, 1) } };
        },
      },
      {
        id: 'jumble', name: 'jumble',
        // One ball from each of the others. It works because every style here
        // shares the same lighting, lens and physics — only the surface
        // differs — so a glass ball next to a chrome one next to a striped one
        // still reads as one scene rather than a sampler sheet.
        size: [0.75, 1.6], orbit: 0.06, churn: 0.35,
        skin(i, accent) {
          // everything except itself, and except the styles that want a hero
          // or a backdrop of their own
          const pool = STYLES.filter((st) => st.id !== 'jumble'
            && !st.hero && !st.showRig);
          const st = pool[(i * 5 + 1) % pool.length];
          return st.skin(i, nearAccent(i, 1));
        },
      },
      {
        id: 'embers', name: 'embers',
        // mostly cold and near-black, a few burning. The lit ones are the only
        // thing in the frame with any brightness, so bloom does the rest and
        // the dark ones read as coal.
        flicker: 0.4, size: [0.6, 1.7], orbit: 0.04, churn: 0.8,
        skin(i, accent) {
          const lit = i % 6 === 2;
          return lit
            ? { color: 0x101010, metalness: 0, roughness: 0.5,
                emissive: accent, emissiveIntensity: 7 }
            : { color: 0x0e0e0e, metalness: 0.35, roughness: 0.42 };
        },
      },
      // ── the stream1018 studies, on spheres ─────────────────────────────
      // New styles go on the END: a pinned style is saved as its index.
      {
        id: 'porcelain', name: 'porcelain',
        // Glazed white ceramic that the key and the rim shine THROUGH. Front
        // on it is a plain glossy ball; turn it against the light and the
        // thin edge lights up warm while the thick middle stays dense. The
        // room flickers with the kick, so the glow does too.
        // A DARK room, as the study has: translucency is light against
        // shadow, and in the bright room the whole frame went to milk.
        flicker: 0.25, size: [0.85, 1.55], orbit: 0.04, churn: 0.2, bg: 0x0d0c0e,
        skin(i, accent) {
          const tinted = i % 3 === 1;
          // The body is greyer than the glaze looks. The room's ambient fill
          // saturates a true white to a flat disc, which is the one thing
          // translucency cannot be seen against.
          return { color: 0x8f8a84, metalness: 0, roughness: 0.22,
            clearcoat: 1, clearcoatRoughness: 0.05,
            look: { sss: { color: tinted ? accent : 0xfff3e6,
              tint: tinted ? accent : 0xffd2b0, density: tinted ? 0.9 : 1.3 } } };
        },
      },
      {
        id: 'marble', name: 'marble',
        // Polished stone: carrara, nero marquina, and white with veins in the
        // accent. The pale ones carry the same light-through-the-ball as
        // porcelain, denser, because real marble does glow at a thin edge.
        size: [0.85, 1.6], orbit: 0.035, churn: 0.2,
        skin(i, accent) {
          const k = (i * 7) % 6;
          const stone = k < 3 ? { base: 0xece8e2, vein: 0x4f5157 }       // carrara
            : k < 5 ? { base: 0x121214, vein: 0xa8a196 }                // nero marquina
            : { base: 0xeeeae4, vein: accent };
          const pale = k !== 3 && k !== 4;
          return { color: 0xffffff, metalness: 0, roughness: 0.2,
            clearcoat: 0.6, clearcoatRoughness: 0.08,
            look: { marble: { ...stone, seed: i * 3.7 },
              sss: { color: pale ? 0xfff6ec : 0x000000, tint: 0xe8dccb, density: 2.4 } } };
        },
      },
      {
        id: 'gyroid', name: 'gyroid',
        // Every ball a cut through an endless lattice — brass, steel and
        // gunmetal struts with a fire at the centre. The cell flows through
        // the ball and the struts fatten on the bass.
        size: [0.95, 1.7], orbit: 0.05, churn: 0.3,
        skin(i, accent) {
          const metal = [0xd9b26a, 0xc9ced4, 0x34343a][i % 3];
          return { color: metal, metalness: 0.85, roughness: 0.3,
            look: { gyro: { color: metal, glow: nearAccent(i, 1) } } };
        },
      },
      {
        id: 'paperweight', name: 'paperweight',
        // The gold-in-glass study: a metal core inside a ball of frosted
        // glass, the core softer the deeper it sits. Mostly gold; now and
        // then a core in the accent. See "gold in glass" for how.
        size: [0.9, 1.6], orbit: 0.045, churn: 0.3,
        skin(i, accent) {
          const odd = i % 4 === 3;
          return { color: 0x000000, metalness: 0, roughness: 0.06,
            look: { paper: { gold: odd ? accent : 0xffc35a,
              radius: 0.42 + ((i * 7) % 5) * 0.045, frost: 0.25 + ((i * 3) % 4) * 0.12,
              tint: 0xf2e9dc } } };
        },
      },
    ];

    for (const st of STYLES) {
      if (st.bg == null) st.bg = ROOM;
      if (!st.pulse) st.pulse = 0;
      if (!st.bands) st.bands = false;
      if (!st.showRig) st.showRig = false;
      if (!st.flicker) st.flicker = 0;
    }

    let styleIx = 0;           // which style is showing
    let pinned = -1;           // -1 = auto-cycle, otherwise a fixed style
    let accentIx = 0;
    try {
      const saved = state ? JSON.parse(state) : null;
      if (saved) {
        if (saved.pinned != null) pinned = saved.pinned;
        if (saved.accentIx != null) accentIx = saved.accentIx % ACCENTS.length;
        if (pinned >= 0) styleIx = pinned % STYLES.length;
      }
    } catch (e) { /* a corrupt save is not worth a crash */ }
    const style = () => STYLES[styleIx];

    // antialias OFF: a multisampled scene pass cannot have its depth copied
    // into the 1x targets the post chain reads, and it fails as an uncatchable
    // WebGPU validation error. TRAA does the antialiasing.
    // ── HDR ────────────────────────────────────────────────────────────────
    // `hdr` is true only when amp has probed THIS display and got a real
    // extended-range canvas back — it configures one and reads the pixels,
    // because WebKit has been known to accept an rgba16float canvas and then
    // present black.
    //
    // three reaches the same place through `outputType`: hand the WebGPU
    // backend HalfFloatType and it configures the canvas with
    // `toneMappingMode: 'extended'`, which is exactly the contract in amp's
    // own docs.
    //
    // This scene has plenty to spend the range on. The key light in the
    // environment sits at intensity 100, the lantern cores and the pattern
    // glow are emissive, and bloom piles more on top — all of which is
    // currently being rolled down to fit in 0..1.
    const renderer = new THREE.WebGPURenderer(
      hdr ? { canvas, antialias: false, outputType: THREE.HalfFloatType }
          : { canvas, antialias: false });
    await renderer.init();
    renderer.setSize(width, height, false);
    // On SDR, ACES — the whole look was tuned through it and it stays exactly
    // as it was. On HDR, nothing here: the roll-off happens at the end of the
    // post chain instead, with room left above white. Doing both would crush
    // the highlights and then present the crushed result as extended.
    renderer.toneMapping = hdr ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    let aspect = width / height;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(ROOM);
    const FOV = 17.5;
    const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 200);
    camera.position.set(0, 0, 30);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 2));

    // ── the lighting rig ───────────────────────────────────────────────────
    // Real emissive geometry in a black room, prefiltered by PMREM — which is
    // what a drei <Environment> full of <Lightformer>s is underneath. Doing it
    // this way rather than painting an equirect matters for one reason: units.
    // Intensity here is radiance on a mesh of a given size, so a big dim panel
    // and a small fierce one land in the right proportion on their own.
    async function buildEnvironment(rimColour) {
      const room = new THREE.Scene();
      const glow = (colour, intensity) => new THREE.MeshBasicMaterial({
        color: new THREE.Color(colour).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      });
      const rig = new THREE.Group();
      rig.rotation.set(-Math.PI / 3, 0, 1);
      const disc = new THREE.CircleGeometry(1, 64);

      const key = new THREE.Mesh(disc, glow(0xffffff, 100));
      key.position.set(0, 5, -9); key.rotation.x = Math.PI / 2; key.scale.setScalar(2);
      rig.add(key);

      const fill = new THREE.Mesh(disc, glow(0xffffff, 2));
      fill.position.set(10, 1, 0); fill.rotation.y = -Math.PI / 2; fill.scale.setScalar(8);
      rig.add(fill);

      // a THIN ring: radiance is per unit area, so a fat annulus scaled to 10
      // is an enormous emitter and at the reference's 80 it out-lit the key and
      // pushed the whole frame pink, whites included
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 64), glow(rimColour, 34));
      ring.position.set(10, 10, 0); ring.scale.setScalar(10); ring.lookAt(0, 0, 0);
      rig.add(ring);

      room.add(rig);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const target = pmrem.fromSceneAsync ? await pmrem.fromSceneAsync(room) : pmrem.fromScene(room);
      pmrem.dispose();
      return target.texture;
    }

    // where the key and the ring sit in the environment, as directions — the
    // translucency shader lights with these (see "light through the ball")
    const RIG_TILT = new THREE.Euler(-Math.PI / 3, 0, 1);
    const KEY_ENV = new THREE.Vector3(0, 5, -9).applyEuler(RIG_TILT).normalize();
    const RIM_ENV = new THREE.Vector3(10, 10, 0).applyEuler(RIG_TILT).normalize();
    const Y_AXIS = new THREE.Vector3(0, 1, 0);

    // the lamps in shot, kept so the beat can drive them
    const rigLamps = [];
    const rigMat = (colour, intensity) => new THREE.MeshBasicMaterial({
      color: new THREE.Color(colour).multiplyScalar(intensity),
      side: THREE.DoubleSide, transparent: true, opacity: 1,
    });

    // ── the same rig, painted flat ─────────────────────────────────────────
    // Stochastic SSR needs somewhere for a ray that leaves the screen to land,
    // and it wants an EQUIRECT texture with CPU-side data — a PMREM cube will
    // not do, and handing it nothing dereferences null inside the environment
    // BRDF. So the rig exists twice: as real geometry for the lighting, and as
    // this rough painting for the reflections' misses. Rough is fine; it is
    // only ever seen glancing off a sphere at the edge of frame.
    const RIG_W = 256, RIG_H = 128;
    const rigData = new Float32Array(RIG_W * RIG_H * 4);
    function paintRigEquirect(backdrop) {
      const W = RIG_W, H = RIG_H;
      const data = rigData;
      const tilt = new THREE.Euler(-Math.PI / 3, 0, 1);
      const lamp = (x, y, z, scale, intensity, colour) => {
        const dir = new THREE.Vector3(x, y, z);
        const radius = Math.atan2(scale, dir.length());
        dir.normalize().applyEuler(tilt);
        const c = new THREE.Color(colour);
        return { dir, radius, intensity, r: c.r, g: c.g, b: c.b };
      };
      const bd = [((backdrop >> 16) & 255) / 255, ((backdrop >> 8) & 255) / 255,
        (backdrop & 255) / 255];
      const lamps = [
        lamp(0, 5, -9, 2, 100, 0xffffff),
        lamp(10, 1, 0, 8, 2, 0xffffff),
        lamp(10, 10, 0, 10, 34, 0xff0000),
      ];
      const d = new THREE.Vector3();
      for (let y = 0; y < H; y++) {
        const v = (y + 0.5) / H;                 // v = 0 is straight DOWN
        const dy = Math.sin((v - 0.5) * Math.PI);
        const dr = Math.sqrt(Math.max(0, 1 - dy * dy));
        for (let x = 0; x < W; x++) {
          const az = ((x + 0.5) / W - 0.5) * Math.PI * 2;
          d.set(Math.cos(az) * dr, dy, Math.sin(az) * dr);
          // NOT the dark room the LIGHTING uses. This texture answers a
          // different question: what does a reflected ray see when it walks
          // off the edge of the screen? Not the light rig — the backdrop, the
          // big flat wall this whole scene is shot against. Filling it with
          // near-black (which an earlier version did, by copying the lighting
          // environment) is why reflections kept resolving to black holes
          // wherever a ray missed, which is most rays near a silhouette.
          const dim = 0.55 + Math.max(0, dy) * 0.45;     // a little sky gradient
          let r = bd[0] * dim, g = bd[1] * dim, b = bd[2] * dim;
          for (const L of lamps) {
            const ang = Math.acos(Math.max(-1, Math.min(1, d.dot(L.dir))));
            if (ang > L.radius) continue;
            const f = Math.pow(1 - ang / L.radius, 1.3) * L.intensity;
            r += L.r * f; g += L.g * f; b += L.b * f;
          }
          const i = (y * W + x) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
        }
      }
      rigFlat.needsUpdate = true;
      return rigFlat;
    }
    const rigFlat = new THREE.DataTexture(rigData, RIG_W, RIG_H,
      THREE.RGBAFormat, THREE.FloatType);
    rigFlat.mapping = THREE.EquirectangularReflectionMapping;
    rigFlat.colorSpace = THREE.LinearSRGBColorSpace;
    rigFlat.minFilter = THREE.LinearFilter;
    rigFlat.magFilter = THREE.LinearFilter;
    paintRigEquirect(ROOM);

    // ── the rig, in shot ───────────────────────────────────────────────────
    // The same lights again, a third time — but these are real objects in the
    // scene rather than something the balls merely reflect. Hung well behind
    // the swarm and only added when a style asks for them.
    const rigVisible = new THREE.Group();
    {
      const disc = new THREE.CircleGeometry(1, 64);
      const put = (mesh, x, y, z, scale) => {
        mesh.position.set(x, y, z); mesh.scale.setScalar(scale);
        mesh.lookAt(0, 0, 0); rigVisible.add(mesh); return mesh;
      };
      // Positions are UNIT directions; frame() scales them by the camera
      // distance each frame. A lamp at a fixed depth disappears the moment the
      // camera cuts close, and these are meant to be seen, not merely
      // reflected — so they live at a fixed fraction of the shot instead.
      rigLamps.push(put(new THREE.Mesh(disc, rigMat(0xffffff, 6)), -0.62, 0.34, -1, 0.20));
      rigLamps.push(put(new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 96), rigMat(0xff2050, 9)), 0.74, 0.46, -1, 0.34));
      rigLamps.push(put(new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 96), rigMat(0x2080ff, 7)), -0.80, -0.40, -1, 0.44));
      rigLamps.push(put(new THREE.Mesh(disc, rigMat(0xffcc40, 5)), 0.55, -0.52, -1, 0.16));
      for (const l of rigLamps) { l.userData.dir = l.position.clone(); l.userData.rel = l.scale.x; }
    }
    rigVisible.visible = false;
    scene.add(rigVisible);

    // Which colour the rim light is. Mostly the classic red, but every so
    // often something off the palette instead — it changes the whole frame,
    // because the rim is the only coloured light in the room and every ball
    // wears it along its terminator.
    //
    // Rebuilt rather than tinted: the environment is PREFILTERED into a mip
    // chain, so its colour cannot be changed per frame the way a light's can.
    // That is fine for something that changes every half-minute, and it is why
    // the PULSE below rides on intensity instead, which is just a number.
    let rimColour = 0xff0000;
    function rollRim() {
      rimColour = Math.random() < 0.55 ? 0xff0000
        : ACCENTS[Math.floor(Math.random() * ACCENTS.length)];
    }
    async function relightRoom() {
      try {
        scene.environment = await buildEnvironment(rimColour);
        if (paperEnv) paperEnv.value = scene.environment;
      }
      catch (e) { /* keep whatever room we already had */ }
    }

    try {
      scene.environment = await buildEnvironment(rimColour);
    } catch (e) {
      amp.log('viz: environment could not be built (' + (e && e.message) + ')');
    }

    // ── the reflection probe — OFF ─────────────────────────────────────────
    // Built, measured, and parked. Turn it on by flipping this.
    //
    // WHAT WORKS: it genuinely delivers the second bounce. You can see spheres
    // reflected inside spheres, which is precisely what screen-space
    // reflection structurally cannot do, along with rays toward hidden balls
    // and rays that leave the frame.
    //
    // WHY IT IS OFF: it costs 1.62 ms/frame against 0.20 without — eight times
    // the submit cost — and the picture got WORSE, for a reason that was
    // already written down elsewhere in this file. A camera at the middle of
    // the swarm mostly sees the flat pale BACKDROP. So using its output as
    // scene.environment throws away the dark room with three small fierce
    // lights in it and replaces it with a big bright uniform one, which
    // flattens everything. Prefiltering through PMREM fixes the mip chain and
    // not that.
    //
    // WHAT WOULD ACTUALLY WORK: keep the prefiltered dark room as the
    // environment, so the LIGHTING is untouched, and add the probe as a
    // separate specular term — sample the cube along the reflection vector in
    // TSL, weight it by Fresnel and metalness, add it on. The room lights, the
    // probe reflects, neither pretends to be the other. That is the version to
    // build, and it is a bigger change because eleven of the fourteen styles
    // already use emissiveNode for something else.
    const PROBE = false;

    // A cube camera at the middle of the pile, rendering the swarm into a small
    // cube map that then becomes the environment. This is the answer to
    // everything screen-space reflection structurally cannot do: a ray toward a
    // ball hidden behind another ball, a ray that leaves the frame, and — the
    // one that matters most — a SECOND BOUNCE, because the probe photographs
    // balls that are already wearing the previous probe.
    //
    // It works here for a reason specific to this piece: the spring holds the
    // swarm compact and centred, so one probe at the origin is a fair
    // approximation for all eighteen. That is normally what makes probe
    // reflections awkward, and the physics had already solved it.
    //
    // LAYERS are what make it possible. The light rig has to exist as real
    // geometry for the probe to see it — a prefiltered environment map cannot
    // be photographed by a camera — but it must not be visible in the shot. So
    // the rig sits on layer 1, the main camera is told to look only at layer 0,
    // and the cube camera looks at both.
    const PROBE_LAYER = 1;
    const probeRig = new THREE.Group();
    probeRig.layers.set(PROBE_LAYER);
    {
      const glow = (colour, intensity) => new THREE.MeshBasicMaterial({
        color: new THREE.Color(colour).multiplyScalar(intensity), side: THREE.DoubleSide,
      });
      const disc = new THREE.CircleGeometry(1, 48);
      const rig = new THREE.Group();
      rig.rotation.set(-Math.PI / 3, 0, 1);
      const add = (mesh, x, y, z, sc) => {
        mesh.position.set(x, y, z); mesh.scale.setScalar(sc);
        mesh.layers.set(PROBE_LAYER); rig.add(mesh); return mesh;
      };
      // the same three lights the prefiltered room is built from, so the
      // probe's lighting matches the one it replaces
      add(new THREE.Mesh(disc, glow(0xffffff, 100)), 0, 5, -9, 2).rotation.x = Math.PI / 2;
      add(new THREE.Mesh(disc, glow(0xffffff, 2)), 10, 1, 0, 8).rotation.y = -Math.PI / 2;
      const ring = add(new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), glow(0xff0000, 34)), 10, 10, 0, 10);
      ring.lookAt(0, 0, 0);
      rig.layers.set(PROBE_LAYER);
      probeRig.add(rig);
      probeRig.userData.ring = ring;
    }
    if (PROBE) {
      scene.add(probeRig);
      // the viewer never sees the rig; the probe sees everything
      camera.layers.set(0);
    }

    const probeRT = PROBE ? new THREE.CubeRenderTarget(128, {
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    }) : null;
    const probeCam = PROBE ? new THREE.CubeCamera(0.35, 120, probeRT) : null;
    if (PROBE) { probeCam.layers.enable(0); probeCam.layers.enable(PROBE_LAYER); }
    let probeTick = 0;
    let probePM = null;                 // the prefiltered result, reused
    let probeOut = null;

    function refreshProbe() {
      if (!PROBE) return;
      // Every eighth frame. The swarm moves slowly enough that a stale
      // reflection is invisible, and the prefilter below is the expensive part
      // — six faces plus a mip chain every frame would be absurd for something
      // nobody can see the difference in.
      if ((probeTick++ % 8) !== 0) return;
      try {
        probeCam.update(renderer, scene);

        // PREFILTER it. Handing three a raw cube as scene.environment gives
        // neither of the two things an environment is for: the diffuse
        // irradiance and the roughness mip chain both come out of PMREM. Skip
        // it and the lighting collapses to a flat pale wash with the
        // reflections sitting on top at full strength — which is exactly what
        // the first attempt did.
        if (!probePM) probePM = new THREE.PMREMGenerator(renderer);
        const next = probePM.fromCubemap(probeRT.texture);
        // fromCubemap hands back a NEW target every call, so the old one has
        // to go or this leaks a render target eight times a second
        if (probeOut) probeOut.dispose();
        probeOut = next;
        scene.environment = next.texture;
      } catch (e) {
        // keep whatever room we already had rather than lose the lighting
      }
    }

    // ── the swarm ──────────────────────────────────────────────────────────
    // Individual meshes, NOT an InstancedMesh. Not a style choice: three's
    // velocity buffer is built from each object's previous world matrix, so an
    // instanced mesh whose instances move every frame reports the mesh's own
    // motion — zero — and TRAA downstream then reprojects against nothing and
    // smears. Eighteen draw calls is nothing; a wrong velocity buffer is not.
    const N = 18;
    const geo = new THREE.SphereGeometry(1, 48, 48);
    const balls = [];
    const P = [], V = [], R = [], GROW = [];
    // Each ball turns on its own axis. On a plain sphere this is invisible —
    // a featureless ball looks identical however it is rotated — but the
    // moment there is a pattern on it, spin is the difference between a
    // painted marble and an object. Random axes so they do not turn as a
    // formation, and the rate comes off the music.
    const SPIN_AXIS = [], SPIN_RATE = [];
    const rand = (a, b) => a + Math.random() * (b - a);

    // ── the hero ───────────────────────────────────────────────────────────
    // One ball, much bigger, held near the middle while the rest tumble around
    // it. It gives the frame a subject: a pile of equals is a texture, but a
    // pile with something at the centre of it is a composition. Ball zero
    // draws the part, and only when the style asks for one.
    const isHero = (i) => i === 0 && !!style().hero;
    function sizeFor(i) {
      const s = style().size;
      const r = rand(s[0], s[1]);
      return isHero(i) ? r * style().hero.scale : r;
    }

    // Each ball owns a slice of the spectrum, low to high across the swarm.
    // When a style asks for `bands`, that slice drives its size — which turns
    // the pile into a spectrum analyser you can walk around, rather than
    // eighteen balls all doing the same thing to the same bass.
    const BAND = [];
    const pulseEnv = new Float32Array(N);      // 0..1, decays after a hit

    for (let i = 0; i < N; i++) {
      // low bins are where the energy is, so spread the slices logarithmically
      // or the top third of the swarm never moves
      BAND.push(Math.floor(Math.pow(i / N, 1.7) * 190) + 2);
      R.push(sizeFor(i));
      GROW.push(1);                       // 0..1, the birth/death envelope
      const ax = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1));
      if (ax.lengthSq() < 1e-6) ax.set(0, 1, 0);
      SPIN_AXIS.push(ax.normalize());
      SPIN_RATE.push(rand(0.35, 1) * (Math.random() < 0.5 ? -1 : 1));
      P.push([rand(-5, 5), rand(-5, 5), rand(-5, 5)]);
      V.push([rand(-1, 1), rand(-1, 1), rand(-1, 1)]);
      // the NODE material, not the classic one: it carries the same physical
      // properties every style already sets AND the colorNode / emissiveNode
      // slots the patterns need. The classic class has no node slots at all.
      const m = new THREE.Mesh(geo, new THREE.MeshPhysicalNodeMaterial({ color: 0xffffff }));

      // A second sphere inside the first, normally hidden. When a style cuts
      // holes in the outer shell this is what you see through them — which is
      // the difference between a ball with gaps in it and a ball with
      // something going on inside. Parented, so it inherits every bit of the
      // outer one's motion and scale for free.
      const core = new THREE.Mesh(geo, new THREE.MeshPhysicalNodeMaterial({
        color: 0x000000, roughness: 0.4, metalness: 0,
      }));
      core.scale.setScalar(0.82);
      core.visible = false;
      m.add(core);
      m.userData.core = core;

      scene.add(m);
      balls.push(m);
    }

    // Every property any style touches has to be reset by paint(), or a ball
    // that was glass keeps its transmission when the style turns to chrome.
    const BASE = {
      metalness: 0.5, roughness: 0.2, transmission: 0, thickness: 0, ior: 1.5,
      dispersion: 0, iridescence: 0, iridescenceIOR: 1.3, emissiveIntensity: 0,
      attenuationDistance: Infinity, sheen: 0, sheenRoughness: 0.5, map: null,
      alphaTest: 0, side: THREE.FrontSide, clearcoat: 0, clearcoatRoughness: 0,
    };
    // the pattern, holes and fields all read these off the material; every
    // ball carries them so all materials present the same set of properties
    const PER_BALL = { patKind: 0, patCount: 8, patWidth: 0.115 };
    const glowNode = THREE.TSL.materialReference('glowColor', 'color')
      .mul(patternMask).mul(patternGlow);
    const holesNode = patternMask.oneMinus();
    const BALL_COLOURS = ['glowColor', 'fieldA', 'fieldB', 'sssColor', 'sssTint',
      'marbleBase', 'marbleVein', 'gyroColor', 'gyroGlow', 'goldColor', 'glassTint'];
    function ballProps(m) {
      Object.assign(m, PER_BALL, { sssDensity: 1, marbleSeed: 0, coreRadius: 0.5, frost: 0.3 });
      for (const k of BALL_COLOURS) m[k] = new THREE.Color();
    }
    for (const b of balls) ballProps(b.material);

    // the stream1018 looks: node graphs shared by every ball, values per ball
    function applyLook(mat, look) {
      if (look.sss) {
        mat.sssColor.set(look.sss.color);
        mat.sssTint.set(look.sss.tint);
        mat.sssDensity = look.sss.density;
        mat.emissiveNode = sssNode;
      }
      if (look.marble) {
        mat.marbleBase.set(look.marble.base);
        mat.marbleVein.set(look.marble.vein);
        mat.marbleSeed = look.marble.seed;
        mat.colorNode = marbleNode;
      }
      if (look.paper) {
        mat.goldColor.set(look.paper.gold);
        mat.glassTint.set(look.paper.tint);
        mat.coreRadius = look.paper.radius;
        mat.frost = look.paper.frost;
        mat.emissiveNode = paperLook();
      }
      if (look.gyro) {
        mat.gyroColor.set(look.gyro.color);
        mat.gyroGlow.set(look.gyro.glow);
        Object.assign(mat, gyroLook);
      }
    }

    // What decides which PROGRAM a material compiles to: its nodes, and which
    // features are on at all (three keys numbers as zero / non-zero). Colour,
    // roughness and the per-ball pattern values are uniforms and need no
    // rebuild. needsUpdate re-runs three's whole node builder for that
    // material, so setting it on all thirty-six every time the accent moved
    // was a stall in itself; now it is only set when this signature changes.
    function shapeOf(mat) {
      let s = (mat.emissiveNode ? mat.emissiveNode.id : '-') + ':'
        + (mat.opacityNode ? mat.opacityNode.id : '-') + ':'
        + (mat.colorNode ? mat.colorNode.id : '-') + ':'
        + (mat.normalNode ? mat.normalNode.id : '-') + ':'
        + (mat.depthNode ? mat.depthNode.id : '-') + ':'
        + (mat.mrtNode ? mat.mrtNode.id : '-') + ':' + mat.side;
      for (const k in BASE) if (typeof BASE[k] === 'number') s += mat[k] ? '1' : '0';
      return s;
    }

    function paint(i) {
      const spec = style().skin(i, ACCENTS[accentIx]);
      const mat = balls[i].material;
      dress(mat, spec);
      const core = balls[i].userData.core;
      core.visible = !!spec.core;
      if (spec.core) {
        dressCore(core.material, spec.core);
        core.scale.setScalar(spec.core.scale != null ? spec.core.scale : 0.82);
        const cs = shapeOf(core.material);
        if (cs !== core.userData.shape) { core.userData.shape = cs; core.material.needsUpdate = true; }
      }
      const shape = shapeOf(mat);
      if (shape !== balls[i].userData.shape) {
        balls[i].userData.shape = shape;
        mat.needsUpdate = true;
      }
    }

    function dressCore(cm, c) {
      cm.color.set(c.color != null ? c.color : 0x000000);
      cm.emissive.set(c.emissive != null ? c.emissive : 0x000000);
      cm.emissiveIntensity = c.intensity != null ? c.intensity : 1;
      cm.roughness = c.roughness != null ? c.roughness : 0.4;
      cm.metalness = c.metalness != null ? c.metalness : 0;
    }

    // everything paint() does to the outer material, minus the bookkeeping —
    // shared with the warm-up below, which dresses throwaway materials the
    // same way so they compile to the same programs
    function dress(mat, spec) {
      for (const k in BASE) mat[k] = BASE[k];
      mat.emissive.set(0x000000);
      mat.attenuationColor.set(0xffffff);
      if (mat.sheenColor) mat.sheenColor.set(0xffffff);
      mat.iridescenceThicknessRange = [100, 400];
      // a style that does not ask for a pattern must not inherit the last
      // one's node graph
      mat.emissiveNode = null;
      mat.opacityNode = null;
      mat.colorNode = null;
      mat.normalNode = null;
      mat.depthNode = null;
      mat.mrtNode = null;
      for (const k in spec) {
        if (k === 'glow' || k === 'holes' || k === 'field' || k === 'core' || k === 'look') continue;
        if (k === 'color' || k === 'emissive' || k === 'attenuationColor'
            || k === 'sheenColor') mat[k].set(spec[k]);
        else mat[k] = spec[k];
      }
      if (spec.field) {
        // the whole surface, lit from within — no room reflection involved
        mat.fieldA.set(spec.field.a);
        mat.fieldB.set(spec.field.b);
        mat.emissiveNode = orbField(spec.field.kind);
      }
      const pat = spec.glow || spec.holes;
      if (pat) {
        mat.patKind = PAT_KIND[pat.kind] || 0;
        mat.patCount = pat.count != null ? pat.count : 8;
        mat.patWidth = pat.width != null ? pat.width : 0.115;
      }
      if (spec.glow) {
        mat.glowColor.set(spec.glow.colour);
        mat.emissiveNode = glowNode;
      }
      if (spec.look) applyLook(mat, spec.look);

      // Holes. The mask drives OPACITY and alphaTest turns that into a hard
      // discard — not blending, which would need the whole swarm depth-sorted
      // every frame and would still get the overlaps wrong. DoubleSide so the
      // inside of the shell is there to be seen rather than a hole straight
      // through to the backdrop.
      if (spec.holes) {
        // oneMinus: the mask marks where the PATTERN is, and the pattern is
        // what gets removed. Using it the other way round keeps the dots and
        // discards the shell, which gives a lattice of floating spots rather
        // than a ball with holes in it.
        mat.opacityNode = holesNode;
        mat.alphaTest = 0.5;
        mat.side = THREE.DoubleSide;
      }
    }
    function paintAll() { for (let i = 0; i < N; i++) paint(i); }
    function applyStyle() {
      paintAll();
      scene.background = new THREE.Color(style().bg);
      // the reflections' idea of "off screen" has to follow the backdrop, or
      // nightclub's black room reflects a bright wall that is not there
      paintRigEquirect(style().bg);
      rigVisible.visible = style().showRig;
    }
    applyStyle();

    // ── physics ────────────────────────────────────────────────────────────
    // No gravity. A spring toward the origin plus heavy damping, and equal-mass
    // elastic collisions. The constants are the reference's rapier settings
    // converted: an impulse of -position × 0.25 per frame on a unit sphere is a
    // velocity change of about -position × 3.6 per second.
    let stir = [0, 0, 0];
    let beatsSeen = 0, lastBig = -99;

    function step(dt, a) {
      const pull = 3.4 + a.bass * 2.6;
      // leaned a little across the frame so the pile fills a landscape window
      // rather than sitting as a ball in a letterbox — only a little, because
      // leaning it hard pulls the cluster into a scatter
      const wide = Math.sqrt(Math.min(1.8, Math.max(1, aspect)));
      const pullX = pull / wide;
      const damp = Math.exp(-4 * dt);

      // ── the shove ──────────────────────────────────────────────────────
      // A beat throws the swarm outward, and how hard depends on how DEEP the
      // beat is rather than merely that one happened. An IMPULSE, not a force:
      // a straight addition to velocity on the single frame the beat lands.
      // Multiplying by dt the way a force would be makes the same track hit
      // harder on a slow machine.
      const weight = Math.min(1, a.bass * 0.75 + a.punch * 0.45);
      let burst = a.kick ? 0.5 + weight * 2.4 : a.beat ? 0.2 + weight * 0.8 : 0;

      // ...and every so often, a real one. Not every eighth beat on the nose —
      // that reads as a metronome. It needs a heavy beat AND a gap since the
      // last one, so it lands where the music actually swells.
      if (a.beat) beatsSeen++;
      if (a.kick && weight > 0.62 && beatsSeen - lastBig > 12) {
        lastBig = beatsSeen;
        burst *= 3.4;
        churnSome(2 + Math.floor(weight * 3));
        // a big moment is a fair excuse to change the shot, now and then
        if (Math.random() < 0.4) cut();
      }

      // ── continuous motion ──────────────────────────────────────────────
      // Beat impulses alone leave the pile sitting still between hits, and on
      // anything without a hard kick it barely moves at all. These three run
      // the whole time and come off different parts of the analysis, so the
      // swarm answers the music rather than waiting for it.
      //
      //   SWIRL     a constant churn about the view axis, from level and mids.
      //             Never zero — even a quiet passage keeps turning over.
      //   BREATHE   radial, locked to beatPhase: gathers in through the bar
      //             and lets go on the beat. This is the one that reads as
      //             tempo when nothing is being struck.
      //   SHEAR     snares push sideways rather than outward, so a backbeat
      //             looks different from a kick instead of louder than one.
      const swirl = (0.5 + a.level * 3.2 + a.mid * 2.2) * swirlDir;
      const breathe = Math.cos(a.beatPhase * Math.PI * 2) * (0.5 + a.bass * 2.6)
        * (0.35 + (a.confidence || 0) * 0.65);
      const shear = a.snare ? (1.6 + a.punch * 3.4) * swirlDir : 0;
      const jitter = a.hat ? 0.25 + a.treb * 0.9 : 0;

      const ph = a.t * 0.6 + a.beatPhase * 0.9;
      // the stirrer ORBITS rather than wanders: a path whose time average is
      // off-centre slowly shoves the whole swarm out of frame
      stir = [Math.cos(ph) * 4, Math.sin(ph * 1.31) * 3.2, Math.sin(ph * 0.7) * 1.2];

      for (let i = 0; i < N; i++) {
        const p = P[i], v = V[i];
        const d = Math.hypot(p[0], p[1], p[2]) || 1e-4;

        if (isHero(i)) {
          // Held on a much stiffer spring and deaf to everything else. A hero
          // that gets shoved about with the rest is just a big ball in the
          // pile; one that stays put is the thing they are orbiting.
          const hp = style().hero.pull;
          for (let k = 0; k < 3; k++) { v[k] -= p[k] * hp * dt; v[k] *= damp; p[k] += v[k] * dt; }
          continue;
        }

        v[0] -= p[0] * pullX * dt;
        v[1] -= p[1] * pull * dt;
        v[2] -= p[2] * pull * dt;

        if (burst) {
          // the ones already out get thrown furthest, so it reads as a
          // shockwave rather than a wobble
          const reach = 0.55 + Math.min(1.4, d / 4) * 0.65;
          for (let k = 0; k < 3; k++) v[k] += (p[k] / d) * burst * reach;
        }

        // swirl and shear both act along the tangent — cross((0,1,0), p) —
        // which is a rotation about the axis the camera orbits, so it reads as
        // turning from wherever you are standing
        const tx = -p[2], tz = p[0];
        const tl = Math.hypot(tx, tz) || 1e-4;
        v[0] += (tx / tl) * swirl * dt;
        v[2] += (tz / tl) * swirl * dt;
        if (shear) { v[0] += (tx / tl) * shear; v[2] += (tz / tl) * shear; }

        // the breath, in and out along the radius
        for (let k = 0; k < 3; k++) v[k] += (p[k] / d) * breathe * dt;

        if (jitter && i % 3 === 2) {
          v[0] += (Math.random() - 0.5) * jitter;
          v[1] += (Math.random() - 0.5) * jitter;
          v[2] += (Math.random() - 0.5) * jitter;
        }

        const sx = p[0] - stir[0], sy = p[1] - stir[1], sz = p[2] - stir[2];
        const sd = Math.hypot(sx, sy, sz) || 1e-4;
        if (sd < 2.6) {
          const f = (2.6 - sd) * 26 * dt;
          v[0] += (sx / sd) * f; v[1] += (sy / sd) * f; v[2] += (sz / sd) * f;
        }
        for (let k = 0; k < 3; k++) { v[k] *= damp; p[k] += v[k] * dt; }
      }

      // Keep the centre of mass on the lens. Collisions conserve momentum and
      // the spring is symmetric, but a burst catching an uneven pile still
      // walks the centre off frame over a few minutes.
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < N; i++) { cx += P[i][0]; cy += P[i][1]; cz += P[i][2]; }
      cx /= N; cy /= N; cz /= N;
      const k = Math.min(1, dt * 1.5);
      for (let i = 0; i < N; i++) { P[i][0] -= cx * k; P[i][1] -= cy * k; P[i][2] -= cz * k; }

      // equal-mass elastic response, scaled by the CURRENT radii so a style
      // with mixed sizes still collides correctly. 153 pairs — cheaper than
      // thinking about a broadphase.
      for (let i = 0; i < N; i++) {
        if (GROW[i] <= 0) continue;
        for (let j = i + 1; j < N; j++) {
          if (GROW[j] <= 0) continue;
          const pi = P[i], pj = P[j];
          let dx = pj[0] - pi[0], dy = pj[1] - pi[1], dz = pj[2] - pi[2];
          const dd = Math.hypot(dx, dy, dz);
          const min = R[i] * GROW[i] + R[j] * GROW[j];
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
    }

    // ── birth and death ────────────────────────────────────────────────────
    // A ball marked for churn shrinks away, is re-rolled somewhere out at the
    // edge with a new size and skin, and grows back. Shrinking rather than
    // vanishing matters: a sphere that pops out of existence reads as a
    // glitch, one that collapses reads as an event.
    const DYING = -1;
    const fate = new Array(N).fill(0);      // 0 alive, DYING shrinking
    function churnSome(howMany) {
      if (!style().churn) return;
      // furthest-out first: those are the ones already leaving the frame
      const order = [];
      for (let i = 0; i < N; i++) if (fate[i] === 0 && !isHero(i)) order.push(i);
      order.sort((a, b) => Math.hypot(...P[b]) - Math.hypot(...P[a]));
      for (let n = 0; n < Math.min(howMany, order.length); n++) {
        if (Math.random() > style().churn) continue;
        fate[order[n]] = DYING;
      }
    }
    function reincarnate(i) {
      R[i] = sizeFor(i);
      const a = Math.random() * Math.PI * 2, e = Math.acos(rand(-1, 1)), r = rand(3.5, 6);
      P[i] = [Math.sin(e) * Math.cos(a) * r, Math.sin(e) * Math.sin(a) * r, Math.cos(e) * r];
      V[i] = [0, 0, 0];
      GROW[i] = 0.001;
      fate[i] = 0;
      paint(i);
    }
    // ── listening ──────────────────────────────────────────────────────────
    // Where the audio actually lands on the picture, beyond the shove.
    //
    //   BANDS      each ball owns a slice of the spectrum and swells with it,
    //              low at one end of the swarm and high at the other. Eighteen
    //              balls all pumping to the same bass is one gesture; eighteen
    //              balls each answering their own band is a machine you can
    //              read the music off.
    //   PULSE      kick, snare and hat land on different thirds of the swarm,
    //              so a drum pattern is legible as pattern rather than as a
    //              single flash. Emissive, so bloom carries it.
    //   ANTICIPATE beatPhase says how far we are toward the NEXT beat, which
    //              almost nothing uses. Inhaling on the approach and releasing
    //              on the hit is what makes it look like it knows the song
    //              rather than merely reacting to it a frame late.
    const bandLevel = new Float32Array(N);
    let anticipate = 1, glowEnv = 0, roomEnv = 0;

    function listen(dt, audio) {
      const st = style();

      if (st.bands) {
        for (let i = 0; i < N; i++) {
          const v = audio.fft[BAND[i]] / 255;
          // rise fast, fall slow, or it reads as noise rather than as music
          bandLevel[i] = Math.max(v * v, bandLevel[i] - dt * 1.1);
        }
      } else {
        for (let i = 0; i < N; i++) bandLevel[i] = Math.max(0, bandLevel[i] - dt * 1.6);
      }

      if (st.pulse) {
        for (let i = 0; i < N; i++) {
          const third = i % 3;
          const hit = third === 0 ? audio.kick : third === 1 ? audio.snare : audio.hat;
          if (hit) pulseEnv[i] = 1;
          pulseEnv[i] = Math.max(0, pulseEnv[i] - dt * (third === 2 ? 6 : 3.2));
          const mat = balls[i].material;
          if (mat.emissiveIntensity !== undefined) {
            mat.emissiveIntensity = st.pulse * (0.15 + pulseEnv[i] * 9);
          }
        }
        // the lamps in shot breathe with the room's loudness
        for (const lamp of rigLamps) {
          lamp.material.opacity = 0.55 + audio.loudness * 0.45;
        }
      }

      // The patterns glow on the beat, all of them together. One shared
      // uniform rather than one per ball: eighteen patterns pulsing in unison
      // is a stronger read than eighteen doing their own thing, and it costs a
      // single float per frame instead of eighteen material rebuilds.
      // Kept low on purpose. Emission is multiplied by the accent, so a big
      // number does not make the pattern brighter — it drives every channel
      // past white and ACES rolls the result to a flat grey, which throws away
      // the colour that was the point. At the top of a kick this reaches about
      // 2, which blooms without bleaching.
      // The room pulsing with the music — but only for the styles that want
      // it, and only sometimes, because a room that strobes every bar stops
      // being a room. Intensity is a plain number on the scene, so this costs
      // nothing; the rim's COLOUR cannot move this way (see rollRim).
      const st0 = style();
      if (st0.flicker) {
        roomEnv = Math.max(audio.kick ? 1 : audio.beat ? 0.4 : 0, roomEnv - dt * 2.6);
        scene.environmentIntensity = 1 + roomEnv * st0.flicker;
      } else if (scene.environmentIntensity !== 1) {
        scene.environmentIntensity += (1 - scene.environmentIntensity) * Math.min(1, dt * 4);
      }

      // the orb fields drift on their own clock and churn harder when the
      // music does — a field frozen between beats looks like a photograph of
      // a shader rather than a live one
      fieldTime.value += dt * (0.55 + audio.level * 2.2 + audio.mid * 1.4);
      fieldWarp.value += ((audio.bass * 1.2 + (audio.kick ? 0.8 : 0)) - fieldWarp.value)
        * Math.min(1, dt * 4);

      glowEnv = Math.max(audio.kick ? 1 : audio.beat ? 0.55 : 0, glowEnv - dt * 3.4);
      patternGlow.value = 0.32 + glowEnv * 1.5 + audio.bass * 0.35;
      // the light through porcelain and marble swells on the kick, and the
      // gyroid's struts drift on the field clock and fatten on the bass
      sssPulse.value = 1 + glowEnv * 0.9;
      gyroOffset.value.set(fieldTime.value * 0.35, fieldTime.value * 0.22, fieldTime.value * 0.15);
      gyroThick.value += ((0.09 + audio.bass * 0.09) - gyroThick.value) * Math.min(1, dt * 8);

      // one shared breath: tighten toward the beat, let go on it
      const approach = Math.pow(audio.beatPhase, 3);
      const target = audio.playing ? 1 - approach * 0.06 * (0.3 + audio.confidence) : 1;
      anticipate += (target - anticipate) * Math.min(1, dt * 12);
    }

    function lifecycle(dt) {
      for (let i = 0; i < N; i++) {
        if (fate[i] === DYING) {
          GROW[i] -= dt * 1.8;
          if (GROW[i] <= 0) { GROW[i] = 0; reincarnate(i); }
        } else if (GROW[i] < 1) {
          GROW[i] = Math.min(1, GROW[i] + dt * 1.3);
        }
      }
    }

    // ── framing and the orbit ──────────────────────────────────────────────
    // The reference is a still, shot portrait; amp's window is whatever shape
    // it was dragged to, and the swarm breathes. So fit the cluster each frame
    // — find the furthest ball, back off enough to hold it, ease so a burst
    // does not yank the camera. The lens stays 17.5°; only the distance moves.
    const HALF = Math.tan((FOV * Math.PI / 180) / 2);
    let dist = 30, orbitA = 0.6, orbitE = 0.1;

    // ── which way round ────────────────────────────────────────────────────
    // One direction forever is a turntable. Reversing is the cheapest way to
    // make a slow camera feel authored, but it only means anything if it lands
    // ON something — a reversal in the middle of a bar is just confusion.
    //
    // How often depends on DRIVE: how hard the music is pushing. Bass weight,
    // transient density, a tempo worth trusting. On something gentle the
    // camera picks a way and stays there for a minute at a time; on hard
    // four-to-the-floor it can turn on the beat, which is the thing that makes
    // it look choreographed rather than merely animated.
    let orbitDir = 1, swirlDir = 1, orbitRate = 0, drive = 0, lastFlip = -99;

    function maybeFlip(a) {
      // 0..1, smoothed — a single loud beat should not convince it that a
      // ballad is techno
      const now = Math.min(1, a.bass * 0.55 + a.punch * 0.35
        + Math.max(0, ((a.bpm || 0) - 96) / 70) * 0.35) * (0.35 + (a.confidence || 0) * 0.65);
      drive += (now - drive) * 0.02;

      if (!a.beat) return;
      // never twice in a row: a flip needs room to read as a flip
      if (beatsSeen - lastFlip < 2) return;
      // gentle music, roughly one turn-around a minute; driving music, up to
      // about one beat in four
      const chance = 0.006 + drive * drive * 0.26;
      if (Math.random() > chance) return;
      lastFlip = beatsSeen;
      orbitDir = -orbitDir;
      // the churn usually goes with the camera, but not always — the two
      // fighting for a moment is more interesting than either alone
      if (Math.random() < 0.7) swirlDir = orbitDir;
      else swirlDir = -swirlDir;
    }

    // ── shots ──────────────────────────────────────────────────────────────
    // How much of the swarm to hold. A wide shot frames the whole pile with
    // its edges cropped; a close one puts you among two or three balls, which
    // is a completely different piece — the reflections stop being detail and
    // become the subject. Changing this is a CUT and it belongs on a musical
    // event, not on a timer: a camera that creeps in continuously reads as a
    // slow zoom, which is the one camera move that always looks like a
    // screensaver.
    const SHOTS = [
      { name: 'wide',  crop: 0.82 },
      { name: 'wide',  crop: 0.95 },
      { name: 'close', crop: 0.42 },
      { name: 'macro', crop: 0.26 },
    ];
    let crop = 0.82, cropWant = 0.82;
    function cut(force) {
      // mostly wide: a close-up is worth having because it is occasional
      const pick = force != null ? force
        : Math.random() < 0.62 ? Math.floor(Math.random() * 2)
        : 2 + Math.floor(Math.random() * 2);
      cropWant = SHOTS[pick].crop;
    }
    function frameSwarm(dt, a) {
      let far = 0;
      for (let i = 0; i < N; i++) {
        if (GROW[i] <= 0) continue;
        far = Math.max(far, Math.hypot(P[i][0], P[i][1]) + R[i] * GROW[i]);
      }
      // 0.82, not 1.0: the reference crops its pile at the frame edge rather
      // than sitting it in the middle with air around it, and that cropping is
      // most of why the spheres read as enormous
      // ease the crop toward whatever the last cut asked for, then fit to it
      crop += (cropWant - crop) * Math.min(1, dt * 1.6);
      const want = Math.min(46, Math.max(4, (far * crop) / Math.min(HALF, HALF * aspect)));
      dist += (want - dist) * Math.min(1, dt * 1.1);

      // The orbit is slow and it eases with the music rather than running at a
      // constant rate — a camera moving at a fixed speed under changing music
      // is the thing that makes a visualizer feel like a screensaver.
      // Ease the RATE through zero rather than snapping the direction. A
      // teleporting reversal reads as a dropped frame; swinging through a stop
      // over a third of a second reads as a whip, and lands the turnaround
      // just after the beat that caused it.
      const wanted = orbitDir * style().orbit * (0.5 + a.loudness * 1.6);
      orbitRate += (wanted - orbitRate) * Math.min(1, dt * 3.2);
      orbitA += dt * orbitRate;
      orbitE += dt * style().orbit * 0.37;
    }

    // ── flakes ─────────────────────────────────────────────────────────────
    // Leaf on the wind, after the stream1018 gold-flakes study: a cloud of
    // tiny foil discs blown through the swarm on curl-noise gusts, and the
    // ones that hit a ball stick to it. They come and go — a visit now and
    // then on a kick, or summoned with ↑ and sent away with ↓ — and they are
    // not always gold.
    //
    // The study's moves, kept: the simulation lives entirely on the GPU (a
    // compute pass over storage buffers, here, where it ping-ponged float
    // textures); each flake is one quad tumbling on its own axis, cut to a
    // wobbly disc and given a faceted normal so it flashes as it turns; a
    // flake that lands on the surface lies flat on it, a little askew.
    //
    // What a moving, spinning surface adds: a stuck flake remembers its spot
    // in the BALL'S OWN FRAME, so it rides the ball's spin and drift rather
    // than hanging where the ball used to be. And a kick shakes some loose.
    //
    // One draw for the whole cloud means three's velocity buffer cannot see a
    // flake move (see the swarm), so the material writes its own: this frame's
    // projected position against last frame's, the same quantity TRAA reads.
    const FLAKES = 12288;
    const FLAKE_KINDS = [
      { name: 'gold leaf', cols: [0xffcf73, 0xffdc95, 0xf0b552, 0xffe9b8], metal: 1, rough: 0.3, holo: 0 },
      { name: 'silver leaf', cols: [0xe4e8ef, 0xc9d0da, 0xf6f7fa, 0xb7c0cc], metal: 1, rough: 0.2, holo: 0 },
      { name: 'copper leaf', cols: [0xec9670, 0xd97a52, 0xf4b090, 0xc4643f], metal: 1, rough: 0.28, holo: 0 },
      { name: 'holographic', cols: [0xdfe4ec, 0xd0d6e0, 0xf0f2f6, 0xc9d0da], metal: 1, rough: 0.15, holo: 1 },
      { name: 'foil', cols: 'accent', metal: 0.9, rough: 0.3, holo: 0 },
      { name: 'confetti', cols: 'wheel', metal: 0.15, rough: 0.45, holo: 0 },
    ];
    const flakes = (() => {
      const T = THREE.TSL;
      const { Fn, If, Loop, float, int, uint, vec2, vec3, vec4, hash, instanceIndex, select } = T;
      const dead = new Float32Array(FLAKES * 4);
      for (let k = 3; k < dead.length; k += 4) dead[k] = -1;
      const pos = T.instancedArray(dead, 'vec4');       // xyz · w age, below zero = not out
      const vel = T.instancedArray(FLAKES, 'vec4');     // free: velocity, w 0 · stuck: surface normal, w 1
      const hold = T.instancedArray(FLAKES, 'vec4');    // stuck: the spot in the ball's frame · w which ball
      const prev = T.instancedArray(FLAKES, 'vec4');    // last frame's position, for the velocity buffer
      const vecs = () => Array.from({ length: N }, () => new THREE.Vector4());
      const ballAt = T.uniformArray(vecs(), 'vec4');    // centre · w radius, 0 when not there
      const ballTurn = T.uniformArray(vecs(), 'vec4');  // orientation, a quaternion
      const ballVel = T.uniformArray(vecs(), 'vec4');
      const u = {
        time: T.uniform(0), dt: T.uniform(1 / 60), frame: T.uniform(0),
        wind: T.uniform(new THREE.Vector3(1, 0, 0)), windSpeed: T.uniform(1.6),
        turb: T.uniform(1), gust: T.uniform(0.35), gravity: T.uniform(0.25),
        stick: T.uniform(0), emit: T.uniform(0), shake: T.uniform(0),
        life: T.uniform(14), reach: T.uniform(9), span: T.uniform(12),
        size: T.uniform(0.1), spin: T.uniform(0), glint: T.uniform(0), room: T.uniform(0.5),
        metal: T.uniform(1), rough: T.uniform(0.25), holo: T.uniform(0),
        proj: T.uniform(new THREE.Matrix4()), view: T.uniform(new THREE.Matrix4()),
        projWas: T.uniform(new THREE.Matrix4()), viewWas: T.uniform(new THREE.Matrix4()),
      };
      const cols = [0, 1, 2, 3].map(() => T.uniform(new THREE.Color()));
      const OFF = 0.012;                                // a stuck flake's height off the surface

      // per flake and fixed (salts 0..7), or fresh every frame
      const seedOf = (s) => hash(instanceIndex.mul(uint(8)).add(uint(s)));
      const rollOf = (s) => hash(instanceIndex.mul(uint(8)).add(uint(s))
        .add(u.frame.toUint().mul(uint(FLAKES * 8))));
      const qrot = (q, v) => {
        const t = q.xyz.cross(v).mul(2);
        return v.add(t.mul(q.w)).add(q.xyz.cross(t));
      };
      // the wind's turbulence: the curl of a noise field, which is
      // divergence-free, so gusts swirl the cloud without bunching it up
      const noise3 = Fn(([p]) => T.mx_noise_vec3(p)).setLayout({
        name: 'flakeNoise', type: 'vec3', inputs: [{ name: 'p', type: 'vec3' }] });
      const curl = (p) => {
        const e = 0.1;
        const x0 = noise3(p.sub(vec3(e, 0, 0))), x1 = noise3(p.add(vec3(e, 0, 0)));
        const y0 = noise3(p.sub(vec3(0, e, 0))), y1 = noise3(p.add(vec3(0, e, 0)));
        const z0 = noise3(p.sub(vec3(0, 0, e))), z1 = noise3(p.add(vec3(0, 0, e)));
        return vec3(
          y1.z.sub(y0.z).sub(z1.y.sub(z0.y)),
          z1.x.sub(z0.x).sub(x1.z.sub(x0.z)),
          x1.y.sub(x0.y).sub(y1.x.sub(y0.x))).div(2 * e);
      };

      const update = Fn(() => {
        const i = instanceIndex;
        const p = pos.element(i).xyz.toVar(), age = pos.element(i).w.toVar();
        const v = vel.element(i).xyz.toVar(), state = vel.element(i).w.toVar();
        const h = hold.element(i).toVar();
        const was = p.toVar();
        const life = u.life.mul(seedOf(1).add(0.5));

        If(age.lessThan(0), () => {
          // out of play: come back in upwind, a few at a time while emitting
          If(rollOf(0).lessThan(u.emit.mul(u.dt)), () => {
            const side = u.wind.cross(vec3(0, 1, 0)).normalize();
            const up = side.cross(u.wind);
            p.assign(u.wind.mul(u.reach.mul(rollOf(3).mul(0.3).add(1)).negate())
              .add(side.mul(rollOf(1).sub(0.5).mul(u.span)))
              .add(up.mul(rollOf(2).sub(0.5).mul(u.span).mul(0.8))));
            was.assign(p);
            age.assign(0);
            v.assign(u.wind.mul(u.windSpeed.mul(rollOf(4).mul(0.4).add(0.8))));
            state.assign(0);
          });
        }).Else(() => {
          If(state.greaterThan(0.5), () => {
            // stuck: ride the ball, age slowly, and let go when shaken
            age.addAssign(u.dt.mul(0.15));
            const b = int(h.w);
            const at = ballAt.element(b);
            const n = qrot(ballTurn.element(b), h.xyz);
            If(at.w.lessThan(0.08).or(rollOf(5).lessThan(u.shake)).or(age.greaterThan(life)), () => {
              state.assign(0);
              v.assign(ballVel.element(b).xyz.add(n.mul(rollOf(6).mul(2).add(1.5))));
            }).Else(() => {
              p.assign(at.xyz.add(n.mul(at.w.add(OFF))));
              v.assign(n);
            });
          }).Else(() => {
            age.addAssign(u.dt);
            const air = u.wind.mul(u.windSpeed)
              .add(curl(p.mul(u.gust).add(u.time.mul(0.15))).mul(u.turb));
            // each flake has its own drag: leaf is light, some ride the gust
            // and some lag it, which is what spreads a cloud into streamers
            const drag = seedOf(3).mul(3).add(1);
            v.addAssign(air.sub(v).mul(drag.mul(u.dt).negate().exp().oneMinus()));
            v.subAssign(vec3(0, u.gravity.mul(u.dt), 0));
            const next = p.add(v.mul(u.dt)).toVar();
            Loop(N, ({ i: j }) => {
              const at = ballAt.element(j);
              const d = next.sub(at.xyz);
              const r = at.w.add(OFF);
              If(state.lessThan(0.5).and(at.w.greaterThan(0.08)).and(d.dot(d).lessThan(r.mul(r))), () => {
                const n = d.normalize();
                const bv = ballVel.element(j).xyz;
                const rel = v.sub(bv);
                const vn = rel.dot(n);
                If(vn.lessThan(0), () => {
                  If(rollOf(7).lessThan(u.stick), () => {
                    const q = ballTurn.element(j);
                    state.assign(1);
                    h.assign(vec4(qrot(vec4(q.xyz.negate(), q.w), n), float(j)));
                    v.assign(n);
                  }).Else(() => {
                    // a glancing skid off the ball, mostly along it
                    v.assign(bv.add(rel.sub(n.mul(vn)).mul(0.6)).sub(n.mul(vn.mul(0.3))));
                  });
                });
                next.assign(at.xyz.add(n.mul(r)));
              });
            });
            p.assign(next);
            // gone downwind, blown out of the room, or simply done
            If(age.greaterThan(life).or(p.dot(u.wind).greaterThan(u.reach.mul(1.15)))
              .or(p.length().greaterThan(u.reach.mul(2.5))), () => { age.assign(-1); });
          });
        });
        pos.element(i).assign(vec4(p, age));
        vel.element(i).assign(vec4(v, state));
        hold.element(i).assign(h);
        prev.element(i).assign(vec4(was, 0));
      })().compute(FLAKES);

      // ── the flake itself ──
      const P = pos.toAttribute(), S = vel.toAttribute(), W = prev.toAttribute();
      const rnd = vec4(seedOf(0), seedOf(1), seedOf(2), seedOf(3));
      const stuck = S.w.greaterThan(0.5);
      // free, it tumbles about its own axis at its own rate
      const axis = rnd.xzy.sub(0.5).normalize();
      const ang = u.spin.mul(rnd.w.mul(6).add(2)).add(rnd.w.mul(6.2832));
      const tumble = (q) => q.mul(ang.cos()).add(axis.cross(q).mul(ang.sin()))
        .add(axis.mul(axis.dot(q).mul(ang.cos().oneMinus())));
      // stuck, it lies on the surface, a little askew and turned at random
      const n = S.xyz.add(rnd.xyz.sub(0.5).mul(0.35)).normalize();
      const t0 = select(n.y.abs().lessThan(0.95), vec3(0, 1, 0), vec3(1, 0, 0)).cross(n).normalize();
      const twist = rnd.w.mul(6.2832);
      const tt = t0.mul(twist.cos()).add(n.cross(t0).mul(twist.sin()));
      const lie = (q) => tt.mul(q.x).add(n.cross(tt).mul(q.y)).add(n.mul(q.z));
      // grows in when it appears, shrinks away as its life runs out
      const life = u.life.mul(rnd.y.add(0.5));
      const grow = T.smoothstep(0, 0.3, P.w).mul(T.smoothstep(life.sub(1.5), life, P.w).oneMinus());
      const size = u.size.mul(rnd.x.mul(7.31).fract().mul(1.2).add(0.4)).mul(grow);
      const corner = T.positionGeometry.mul(size);
      const local = select(stuck, lie(corner), tumble(corner));
      const world = P.xyz.add(local);
      const nWorld = select(stuck, n, tumble(vec3(0, 0, 1))).toVarying('vFlakeN');
      const now = u.proj.mul(u.view).mul(vec4(world, 1)).toVarying('vFlakeNow');
      const then = u.projWas.mul(u.viewWas).mul(vec4(W.xyz.add(local), 1)).toVarying('vFlakeThen');
      const fr = rnd.toVarying('vFlakeRnd');

      const fuv = T.uv();
      const h2 = (q) => q.dot(vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
      // three panes to a side, each tipped its own way: crinkled leaf
      const facet = fuv.mul(3).floor().add(fr.w.mul(17));
      const tilt = vec3(h2(facet), h2(facet.add(31.7)), 0.5).sub(0.5);
      const nv0 = T.cameraViewMatrix.mul(vec4(nWorld, 0)).xyz;
      const nv = select(nv0.dot(T.positionView).greaterThan(0), nv0.negate(), nv0);
      const normal = nv.add(tilt.mul(0.45)).normalize();

      const colour = Fn(() => {
        // a disc with a wobbling edge, not a square
        const o = fuv.sub(0.5);
        const a = T.atan(o.y, o.x);
        const edge = a.mul(3).add(fr.w.mul(20)).sin().mul(0.07)
          .add(a.mul(5).add(fr.w.mul(37)).sin().mul(0.05)).add(0.4);
        If(o.length().greaterThan(edge), () => { T.Discard(); });
        const k = fr.z.mul(4).floor();
        const base = select(k.lessThan(1), cols[0], select(k.lessThan(2), cols[1],
          select(k.lessThan(3), cols[2], cols[3])));
        // holographic: the hue runs with the angle to the eye, pane by pane
        const facing = normal.dot(T.positionView.normalize().negate());
        const hue = vec3(facing.mul(2).add(fr.w).add(h2(facet.add(7)).mul(0.3)));
        const rainbow = hue.add(vec3(0, 0.33, 0.67)).mul(6.2832).cos().mul(0.5).add(0.5);
        return T.mix(base, rainbow, u.holo);
      })();

      const mat = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
      mat.positionNode = world;
      mat.normalNode = normal;
      mat.colorNode = colour;
      mat.metalnessNode = u.metal;
      mat.roughnessNode = u.rough;
      mat.clearcoatNode = float(0.25);
      mat.clearcoatRoughnessNode = float(0.05);
      // The room's light is a few small lamps in the dark, so a mirror-flat
      // flake mostly reflects black and reads as a speck of soot. Real leaf
      // in a pale room reflects the walls: that is the floor here, the
      // flake's own colour at the room's brightness. On the beat a few
      // flakes catch the light hard enough to bloom.
      const twinkle = T.step(0.94, h2(vec2(fr.x.mul(91), u.time.mul(6).floor())));
      mat.emissiveNode = colour.mul(u.room.add(u.glint.mul(2.5).mul(twinkle)));
      mat.mrtNode = T.mrt({
        velocity: now.xy.div(now.w).sub(then.xy.div(then.w)),
        // out of SSR: specks this small only make it sparkle and crawl
        metalrough: vec2(0, 1),
      });

      const quad = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index;
      for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, quad.getAttribute(k));
      geo.instanceCount = FLAKES;
      // NOT in the depth buffer. SSR marches that buffer, and a cloud of
      // specks in it turned every ray that grazed one into a black dot on
      // the balls (measured: gone with SSR off, gone with this). Drawn after
      // the swarm, they still hide behind it; among themselves the order is
      // wrong and at this size nobody can tell.
      mat.depthWrite = false;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      return { update, mesh, u, cols, ballAt, ballTurn, ballVel };
    })();

    let flakeMode = 'auto';         // 'auto' visits now and then · 'on' always · 'never'
    let flaking = false;            // emitting right now
    let flakeEnd = 0, flakeLinger = 0, flakeKind = -1, flakeRoom = 0;
    let nextVisit = rand(40, 90), windAng = rand(0, Math.PI * 2), clock = 0;
    try { const s = state && JSON.parse(state); if (s && s.flakes) flakeMode = s.flakes; } catch (e) {}

    function flakesOn(visit) {
      // a different kind from last time, and colour from the kind
      let k = Math.floor(Math.random() * FLAKE_KINDS.length);
      if (k === flakeKind) k = (k + 1) % FLAKE_KINDS.length;
      flakeKind = k;
      const kind = FLAKE_KINDS[k];
      const wheel = ACCENTS.slice().sort(() => Math.random() - 0.5);
      for (let c = 0; c < 4; c++) {
        flakes.cols[c].value.setHex(kind.cols === 'accent' ? nearAccent(c, 1)
          : kind.cols === 'wheel' ? wheel[c] : kind.cols[c]);
      }
      flakes.u.metal.value = kind.metal;
      flakes.u.rough.value = kind.rough;
      flakes.u.holo.value = kind.holo;
      flakeRoom = kind.metal * 0.35;
      flaking = true;
      flakeEnd = visit ? clock + rand(25, 50) : Infinity;
      flakeLinger = Infinity;
      flakes.mesh.visible = true;
      amp.osd(kind.name);
    }
    function flakesOff() {
      flaking = false;
      // long enough for the last of them to blow out of the room
      flakeLinger = 24;
    }

    // every frame, after the balls have moved and the camera is placed
    function stepFlakes(dt, a) {
      const u = flakes.u;
      // the velocity buffer needs last frame's camera, so keep it current
      // even while there is nothing to draw
      u.projWas.value.copy(u.proj.value);
      u.viewWas.value.copy(u.view.value);
      camera.updateMatrixWorld();
      u.proj.value.copy(camera.projectionMatrix);
      u.view.value.copy(camera.matrixWorldInverse);

      if (flakeMode === 'on' && !flaking) flakesOn(false);
      if (flakeMode === 'auto' && !flaking && clock > nextVisit && a.kick) {
        flakesOn(true);
        nextVisit = flakeEnd + rand(60, 150);
      }
      if (flaking && clock > flakeEnd) flakesOff();
      if (!flaking) {
        flakeLinger -= dt;
        if (flakeLinger <= 0) { flakes.mesh.visible = false; return; }
      }

      let far = 0;
      for (let i = 0; i < N; i++) {
        const r = balls[i].visible ? balls[i].scale.x : 0;
        flakes.ballAt.array[i].set(P[i][0], P[i][1], P[i][2], r);
        const q = balls[i].quaternion;
        flakes.ballTurn.array[i].set(q.x, q.y, q.z, q.w);
        flakes.ballVel.array[i].set(V[i][0], V[i][1], V[i][2], 0);
        far = Math.max(far, Math.hypot(P[i][0], P[i][1], P[i][2]) + r);
      }
      u.reach.value = Math.max(6, far + 2.5);
      u.span.value = u.reach.value * 1.3;

      // The wind turns slowly round the room and gusts with the music. Sent
      // away, the flakes stop sticking, shake loose and the wind picks up to
      // carry them off rather than having them vanish.
      windAng += dt * 0.05;
      u.wind.value.set(Math.cos(windAng), Math.sin(clock * 0.07) * 0.3, Math.sin(windAng)).normalize();
      u.windSpeed.value = (flaking ? 1 : 2.4) * (1.2 + a.loudness * 0.8 + a.bass * 1.1);
      u.turb.value = 0.8 + a.mid * 1.6;
      u.emit.value = flaking ? 0.4 : 0;
      u.stick.value = flaking ? 0.55 : 0;
      const weight = Math.min(1, a.bass * 0.75 + a.punch * 0.45);
      u.shake.value = !flaking ? 0.03 : a.kick ? 0.04 + weight * 0.12 : 0.0004;
      u.spin.value += dt * (1 + a.treb * 3 + (a.hat ? 2 : 0));
      u.glint.value = glowEnv;
      // a dark room has fewer pale walls to reflect, but leaf that goes
      // brown on a dark ball is not leaf any more, so never much below half
      const bg = scene.background && scene.background.isColor ? scene.background : null;
      u.room.value = flakeRoom * (bg ? 0.5 + 0.5 * Math.min(1, (bg.r + bg.g + bg.b) / 3) : 1);
      u.time.value = clock;
      u.dt.value = dt;
      u.frame.value = (u.frame.value + 1) % 16777216;
      renderer.compute(flakes.update);
    }

    // ── the post chain ─────────────────────────────────────────────────────
    let post = null, scenePass = null;
    try {
      const TSL = THREE.TSL;
      const pp = new THREE.PostProcessing(renderer);
      scenePass = TSL.pass(scene, camera, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      });
      // one geometry pass, four buffers out — everything below reads these
      // rather than rendering the scene again
      scenePass.setMRT(TSL.mrt({
        output: TSL.output,
        normal: TSL.directionToColor(TSL.normalView),
        metalrough: TSL.vec2(TSL.metalness, TSL.roughness),
        velocity: TSL.velocity,
      }));
      // Normal and metal/rough at 8 bits rather than the pass's half-float
      // default. Both only ever feed the blurred SSR and SSGI, where a normal
      // a fraction of a degree out is invisible, and at retina sizes the
      // halved bandwidth is worth ~2 ms a frame. Velocity stays half-float:
      // TRAA needs sub-pixel motion.
      scenePass.getTexture('normal').type = THREE.UnsignedByteType;
      scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;
      const col = scenePass.getTextureNode('output');
      const dep = scenePass.getTextureNode('depth');
      const vel = scenePass.getTextureNode('velocity');
      const nrmTex = scenePass.getTextureNode('normal');
      const nrm = TSL.sample((uv) => TSL.colorToDirection(nrmTex.sample(uv)));
      const mr = scenePass.getTextureNode('metalrough');

      // SSR — the balls reflecting each other, which an environment map cannot
      // fake. Note ssr() takes (colour, depth, normal, OPTIONS): passing
      // metalness and roughness as a fifth and sixth argument puts the metalness
      // node in the options slot, drops the roughness, and the pass renders pure
      // black. Silent and total.
      //
      // MIRROR trace, heavily blurred — not the stochastic path.
      //
      // Stochastic GGX rays plus the denoise node is the pairing three
      // documents for glossy surfaces, and on paper it is the right answer to
      // the temporal smearing that TRAA causes downstream. Tried it: it needs
      // an equirect environmentNode or it dereferences null inside the
      // environment BRDF, and once fed one it renders dark blotches and
      // coloured speckle that the denoiser does not clear at this ray count.
      // Measurably worse than a blurred mirror trace, so this keeps the mirror
      // trace and buys stability with blur instead. Worth revisiting when the
      // ray budget can go up.
      const refl = THREE.ssr(col, dep, nrm, {
        metalnessNode: mr.r,
        roughnessNode: mr.g,
        camera,
        // Sub-step binary search on a detected hit. This is aimed straight at
        // the artefact: the march flips from miss to hit between two steps, so
        // a ray crossing the silhouette of the ball behind lands a whole step
        // late and the reflection arrives with a hard edge instead of wrapping
        // round. Refining the crossing point is the difference between an edge
        // and a smear. Compile-time, so it costs shader length rather than
        // per-frame work.
        binaryRefine: true,
        environmentNode: rigFlat,    // where a ray that misses ends up
      });
      // HALF resolution, half quality, blur 2. SSR was two thirds of the whole
      // frame: 24.5 ms at 2880×1800 with everything else at 8.7 (measured,
      // M-series, headless Chrome). This set lands at 8.3 ms total, and it
      // looks the same, for a reason the old settings already admitted: the
      // reflection was being blurred to mush anyway. Blur 2 at half resolution
      // covers the same screen distance blur 4 did at full.
      //
      // Why it is blurred at all: TRAA sits downstream and a reflection does
      // not move the way the surface under it moves, so reprojection cannot
      // line it up; any instability in SSR arrives as coloured trails smeared
      // across the balls. Blurring until it is temporally steady is the fix,
      // and the reflections are soft anyway at roughness 0.2.
      refl.resolutionScale = 0.5;
      refl.blurQuality = 2;
      if (refl.quality) refl.quality.value = 0.5;
      if (refl.maxDistance) refl.maxDistance.value = 5;
      if (refl.thickness) refl.thickness.value = 0.15;
      // Fade toward the frame edge rather than cutting. A ray that walks off
      // screen has no data, and stopping dead at that boundary draws a line
      // across the ball; fading hands it over to the environment instead.
      // It matters more here than in most scenes because the camera cuts to
      // macro shots, where a great deal of every sphere is near an edge.
      if (refl.screenEdgeFade) refl.screenEdgeFade.value = 0.45;

      // SSGI — the bounce between the balls and the dark where they touch. In
      // a dark room the bounce IS the fill light, which is why giIntensity is
      // 100 and not a mistake.
      const gi = THREE.ssgi(col, dep, nrm, camera);
      gi.sliceCount.value = 2;
      gi.stepCount.value = 8;
      gi.radius.value = 25;
      gi.giIntensity.value = 100;
      gi.aoIntensity.value = 3;
      gi.thickness.value = 0.5;

      let node = TSL.vec4(TSL.add(col.rgb.mul(gi.a), col.rgb.mul(gi.rgb)), col.a);
      node = node.add(THREE.bloom(col, 0.1, 0.8, 0.9));
      node = TSL.blendColor(node, refl);
      // TRAA last. It needs the velocity buffer above, which is why the balls
      // are separate meshes.
      node = THREE.traa(node, dep, vel, camera);

      // The HDR roll-off, and only on HDR. amp's own engines use
      // c / (1 + c · 0.4), which lands white at about 2.5 — right for an SDR
      // canvas. Here the divisor is gentler, so the curve is nearly linear
      // through the range an SDR canvas would have shown and keeps going
      // afterwards: a highlight that WAS clipped to white now has somewhere to
      // go. The SDR image is still the deliverable, and it is untouched.
      if (hdr) {
        const rgb = node.rgb;
        node = THREE.TSL.vec4(rgb.div(rgb.mul(0.18).add(1)), node.a);
      }

      pp.outputNode = node;
      post = pp;
    } catch (e) {
      amp.log('viz: post chain unavailable, drawing plain (' + (e && e.message) + ')');
      post = null;
    }

    // ── warming the other styles ───────────────────────────────────────────
    // A style's FIRST appearance used to stall the frame while its programs
    // compiled — 300 to 500 ms each for the pattern, lantern and orb-field
    // shaders, landing right on the musical cut that switched to them. So
    // once the first style is up, the rest are compiled in the background,
    // one style at a time, through compileAsync (three's async pipeline path).
    //
    // A throwaway material per distinct program, dressed exactly as paint()
    // would, on a mesh that is made visible ONLY for the synchronous part of
    // compileAsync — it gathers its object list and render context before its
    // first await, so no rendered frame ever contains these.
    //
    // It must compile against the scene pass's own target and MRT, and for
    // the WHOLE compile, not just its synchronous start: three builds each
    // shader after an await, reading renderer.getMRT() (four outputs or one)
    // and the current target (tone mapped or not) at that moment. Restoring
    // them straight after the call — the first version — warmed eighteen
    // single-output, tone-mapped programs nothing ever draws with, and every
    // style still stalled on first use. So the pass state is HELD while a
    // compile is in flight, and frame() steps out of it around its own
    // render, because PostProcessing draws its final quad into whatever
    // target is current.
    //
    // The materials are kept, not disposed. Disposing releases the programs,
    // which is the opposite of the point.
    const warmGroup = new THREE.Group();
    warmGroup.visible = false;
    scene.add(warmGroup);
    const warmed = new Set();
    for (const b of balls) { warmed.add(b.userData.shape); warmed.add('core' + b.userData.core.userData.shape); }
    let warmState = 0;                  // 0 not started, 1 running, 2 done
    let warmHold = false;               // a compile is in flight: keep the pass state
    // TRAA points the shared velocity node at an unjittered projection for
    // exactly the span of the scene pass and clears it after, which changes
    // the generated code (a per-object matrix uniform instead of the
    // camera's). A compile outside that span gets the other program — this
    // was the last mismatch, found by diffing the WGSL of the two.
    const warmProj = new THREE.Matrix4();
    function holdPass() {
      renderer.setRenderTarget(scenePass.renderTarget);
      renderer.setMRT(scenePass.getMRT());
      THREE.TSL.velocity.setProjectionMatrix(warmProj);
    }
    function releasePass() {
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      THREE.TSL.velocity.setProjectionMatrix(null);
    }
    function warmMaterial(spec) {
      const m = new THREE.MeshPhysicalNodeMaterial({ color: 0xffffff });
      ballProps(m);
      dress(m, spec);
      return m;
    }
    function warmMesh(kind, spec, again) {
      let m;
      if (kind === 'core') {
        m = new THREE.MeshPhysicalNodeMaterial({ color: 0x000000, roughness: 0.4, metalness: 0 });
        dressCore(m, spec.core);
      } else m = warmMaterial(spec);
      // an extra property changes three's node-builder cache key (it appends
      // one entry per property) without changing a line of the shader, so
      // the second pass really builds again instead of reusing the first
      if (again) m.warmAgain = 1;
      const mesh = new THREE.Mesh(geo, m);
      mesh.frustumCulled = false;
      return mesh;
    }
    async function compileWarm(meshes) {
      for (const old of warmGroup.children) old.visible = false;
      for (const m of meshes) warmGroup.add(m);
      let job = null;
      warmHold = true;
      holdPass();
      try {
        warmGroup.visible = true;
        job = renderer.compileAsync(scene, camera);
      } catch (e) { /* warming is an optimisation; never worth a crash */ }
      warmGroup.visible = false;
      try { if (job) await job; } catch (e) {}
      warmHold = false;
      releasePass();
      // breathing room between styles, so the frame loop is never starved
      await new Promise((r) => setTimeout(r, 120));
    }
    async function warmUp() {
      warmState = 1;
      // the flakes first: their sim (with nothing emitting, a step changes
      // nothing) and their one material, so the first visit does not stall
      try { renderer.compute(flakes.update); } catch (e) {}
      if (!flakes.mesh.visible) {
        const fm = new THREE.Mesh(flakes.mesh.geometry, flakes.mesh.material);
        fm.frustumCulled = false;
        await compileWarm([fm]);
      }
      const order = STYLES.slice(styleIx + 1).concat(STYLES.slice(0, styleIx));
      const batches = [];
      for (const st of order) {
        const jobs = [];
        for (let i = 0; i < N; i++) {
          const spec = st.skin(i, ACCENTS[accentIx]);
          const key = shapeOf(warmMaterial(spec));
          if (!warmed.has(key)) { warmed.add(key); jobs.push(['ball', spec]); }
          if (spec.core) {
            const cm = new THREE.MeshPhysicalNodeMaterial();
            dressCore(cm, spec.core);
            const ck = 'core' + shapeOf(cm);
            if (!warmed.has(ck)) { warmed.add(ck); jobs.push(['core', spec]); }
          }
        }
        if (!jobs.length) continue;
        batches.push(jobs);
        await compileWarm(jobs.map(([k, sp]) => warmMesh(k, sp)));
      }
      // ...and again. three emits a graph's helper functions (the MaterialX
      // noise, here) in a different ORDER the first time it builds that graph
      // than on every build after, and a different order is a different
      // program. The real balls always build second, so the first pass alone
      // left the orb fields compiling twice. On the second pass everything
      // else comes back from the program cache and costs only the node build.
      for (const jobs of batches) await compileWarm(jobs.map(([k, sp]) => warmMesh(k, sp, true)));
      warmState = 2;
    }

    // ── holding the frame rate ─────────────────────────────────────────────
    // The post chain is fill-rate bound: its cost is per PIXEL, and a full
    // retina window is three times the pixels of a laptop-sized one. So the
    // render size follows the GPU. Every frame's work is timed from submit to
    // done; when the median says 60 fps is out of reach the internal size
    // steps down, and when there is plenty of headroom it steps back up. The
    // canvas element is CSS-sized by amp, so a smaller bitmap is simply
    // stretched to fill it — and TRAA's resolve hides the difference far
    // better than dropped frames would.
    let fullW = width, fullH = height, renderScale = 1;
    const gpuMs = [];
    let gpuPending = false, scaleCool = 0;
    function applySize() {
      renderer.setSize(Math.max(2, Math.round(fullW * renderScale)),
        Math.max(2, Math.round(fullH * renderScale)), false);
    }
    function timeGpu(t) {
      const device = renderer.backend && renderer.backend.device;
      if (!device || gpuPending) return;
      gpuPending = true;
      const t0 = performance.now();
      device.queue.onSubmittedWorkDone().then(() => {
        gpuPending = false;
        gpuMs.push(performance.now() - t0);
        if (gpuMs.length < 40 || t < scaleCool) return;
        const med = gpuMs.sort((a, b) => a - b)[gpuMs.length >> 1];
        gpuMs.length = 0;
        let next = renderScale;
        if (med > 15 && renderScale > 0.55) next = Math.max(0.55, renderScale - 0.15);
        else if (med < 8 && renderScale < 1) next = Math.min(1, renderScale + 0.15);
        if (next !== renderScale) {
          renderScale = next;
          applySize();
          scaleCool = t + 3;     // let the new size settle before judging it
        }
      }, () => { gpuPending = false; });
    }

    // ── drifting between looks ─────────────────────────────────────────────
    // The accent moves on its own, slowly, and the style follows further
    // behind. Both wait for a beat to change so the cut lands with the music
    // instead of across it.
    let nextAccent = 26, nextStyle = 62, framesDrawn = 0;
    function drift(t, beat) {
      if (!beat) return;
      if (t > nextAccent) {
        nextAccent = t + rand(22, 38);
        accentIx = (accentIx + 1) % ACCENTS.length;
        paintAll();
        rollRim();
        relightRoom();
        save();
      }
      if (pinned < 0 && t > nextStyle) {
        nextStyle = t + rand(50, 80);
        styleIx = (styleIx + 1) % STYLES.length;
        // re-roll the sizes so a style with a different range takes effect
        for (let i = 0; i < N; i++) { R[i] = sizeFor(i); }
        applyStyle();
        cut();
        amp.osd(style().name);
        save();
      }
    }
    function save() { amp.save(JSON.stringify({ pinned, accentIx, flakes: flakeMode })); }

    return {
      backend: 'webgpu · three · ssgi+ssr' + (hdr ? ' · hdr' : ''),

      frame({ audio, t, dt }) {
        const d = Math.min(0.05, dt || 1 / 60);
        const a = { bass: audio.bass, mid: audio.mid, treb: audio.treb,
          level: audio.level, punch: audio.punch, beat: audio.beat,
          kick: audio.kick, snare: audio.snare, hat: audio.hat,
          beatPhase: audio.beatPhase, loudness: audio.loudness,
          confidence: audio.confidence, bpm: audio.bpm, t };
        drift(t, audio.beat);
        maybeFlip(a);
        listen(d, audio);
        lifecycle(d);
        step(d, a);

        // Treble and the hats drive the spin, where bass drives the shoving.
        // Splitting the band up like that is what stops every property of the
        // scene surging at once on a kick.
        const spin = 0.25 + audio.treb * 2.4 + audio.mid * 0.8 + (audio.hat ? 1.4 : 0);
        for (let i = 0; i < N; i++) {
          balls[i].rotateOnAxis(SPIN_AXIS[i], SPIN_RATE[i] * spin * d);
          const g = R[i] * GROW[i] * anticipate * (1 + bandLevel[i] * 0.55);
          balls[i].visible = GROW[i] > 0.002;
          balls[i].position.set(P[i][0], P[i][1], P[i][2]);
          balls[i].scale.setScalar(g);
        }

        frameSwarm(d, a);

        // ── keep the lights on the camera ──────────────────────────────────
        // The rig is built in WORLD space, which is fine for a still and wrong
        // the moment the camera moves: orbit round and the key slides off the
        // shoulder, the rim stops being a rim, and the ring ends up pasted
        // across the front of every sphere as a circle.
        //
        // A fast spin hides that — you cannot read the lighting while the
        // frame is moving. Parking at a new angle is where it shows, and that
        // is the case worth designing for. So the environment turns WITH the
        // camera and the key/rim relationship survives every angle.
        //
        // Not quite locked, though. Following exactly welds the room to the
        // lens: orbit all the way round and nothing about the light changes,
        // which reads as a turntable rather than a place. So it follows all
        // the way and then wanders a few degrees on its own, slowly and
        // independently of where the camera is. Enough to keep the highlights
        // alive on a still frame, never enough to put the key somewhere
        // unflattering.
        const wander = Math.sin(t * 0.06) * 0.16 + Math.sin(t * 0.023) * 0.1;
        scene.environmentRotation.y = orbitA + wander;
        scene.backgroundRotation.y = orbitA + wander;
        // Where the key and the ring land in the world. Measured, not
        // derived: with six candidate directions drawn as dots on mirror
        // balls, this is the one that sits on the key's reflection every time
        // — the rig's direction with z mirrored (the cube render's handedness)
        // and turned by MINUS the environment's rotation.
        const turn = orbitA + wander;
        envTurn.value = turn;
        keyDir.value.set(KEY_ENV.x, KEY_ENV.y, -KEY_ENV.z).applyAxisAngle(Y_AXIS, -turn);
        rimDir.value.set(RIM_ENV.x, RIM_ENV.y, -RIM_ENV.z).applyAxisAngle(Y_AXIS, -turn);
        rimCol.value.set(rimColour).multiplyScalar(0.55);
        keyCol.value.setScalar(0.9 * scene.environmentIntensity);

        if (style().showRig) {
          // hang the lamps behind the swarm at a fixed fraction of the shot,
          // so a close-up still has them in frame
          const ox = Math.cos(orbitA), oz = Math.sin(orbitA);
          for (const l of rigLamps) {
            const dir = l.userData.dir;
            // the same turn applied to the lamps in shot, so they hold their
            // place in frame instead of swinging past
            const rx = dir.x * ox + dir.z * oz;
            const rz = -dir.x * oz + dir.z * ox;
            l.position.set(rx * dist * 0.9, dir.y * dist * 0.9, rz * dist * 1.15);
            l.scale.setScalar(l.userData.rel * dist);
            l.lookAt(0, 0, 0);
          }
        }
        // Spherical, so the camera sits at EXACTLY the fitted distance at every
        // angle. Scaling the axes independently — which an earlier version did,
        // x by 0.32 and z by 1 — swings the true distance from dist to 0.34 ×
        // dist and back every half turn, so the whole scene appeared to zoom in
        // and out as it orbited. The fit is meaningless if the orbit undoes it.
        const el = Math.sin(orbitE) * 0.22;          // a gentle rise and fall
        const ce = Math.cos(el), se = Math.sin(el);
        camera.position.set(
          Math.sin(orbitA) * ce * dist,
          se * dist,
          Math.cos(orbitA) * ce * dist);
        camera.lookAt(0, 0, 0);

        refreshProbe();
        clock = t;
        stepFlakes(d, a);
        if (warmHold) releasePass();
        if (post) post.render(); else renderer.render(scene, camera);
        if (warmHold) holdPass();
        timeGpu(t);
        // the first style is on screen and settled: compile the others
        if (warmState === 0 && post && ++framesDrawn > 45) warmUp();
      },

      resize(w, h) {
        fullW = w; fullH = h;
        applySize();
        aspect = w / h;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      },

      randomize() {
        accentIx = (accentIx + 1 + Math.floor(Math.random() * (ACCENTS.length - 1))) % ACCENTS.length;
        if (pinned < 0) { styleIx = Math.floor(Math.random() * STYLES.length); }
        for (let i = 0; i < N; i++) R[i] = sizeFor(i);
        applyStyle();
        cut();
        churnSome(6);
        save();
        return style().name;
      },

      // ↑ brings the flakes (again: a different kind), ↓ sends them away, and
      // ↓ with none about stops the visits until the next ↑
      input(ev) {
        if (ev.type !== 'down' || ev.repeat) return;
        if (ev.key === 'ArrowUp') {
          flakeMode = 'on';
          flakesOn(false);
        } else if (ev.key === 'ArrowDown') {
          if (flaking) {
            if (flakeMode === 'on') flakeMode = 'auto';
            flakesOff();
            nextVisit = clock + rand(60, 150);
            amp.osd('flakes away');
          } else if (flakeMode !== 'never') {
            flakeMode = 'never';
            amp.osd('no flakes');
          }
        } else return;
        save();
      },

      // preset 0 is 'auto' — the styles drift on their own. 1..n pin one.
      preset(n) {
        if (typeof n !== 'number') return;
        const list = STYLES.length + 1;
        const cur = pinned < 0 ? 0 : pinned + 1;
        const next = (cur + n + list) % list;
        pinned = next === 0 ? -1 : next - 1;
        if (pinned >= 0) styleIx = pinned;
        for (let i = 0; i < N; i++) R[i] = sizeFor(i);
        applyStyle();
        cut();
        save();
      },
    };
    // No teardown to write: when amp drops a visualizer it terminates the whole
    // worker, and the GPU device goes with it.
  },
});
