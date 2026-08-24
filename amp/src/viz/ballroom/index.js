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
  presets: ['auto', 'studio', 'chrome', 'glass', 'prism', 'clay', 'pottery', 'harlequin', 'lantern', 'nightclub', 'nebula', 'oilslick', 'vortex', 'jumble', 'embers'],

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
    function sdfMask(kind, opt) {
      const o = opt || {};
      const T = THREE.TSL;
      return T.Fn(() => {
        const p = T.uv();
        let d;

        if (kind === 'stripes') {
          // Bands of latitude: rings around the ball, not segments of an
          // orange. Count and width are both parameters — a ball with four fat
          // bands and one with fourteen fine ones are different objects, and
          // varying them across the swarm is most of what stops eighteen
          // striped spheres reading as wallpaper.
          const N = o.count != null ? o.count : 7;
          const W = o.width != null ? o.width : 0.3;
          d = p.y.mul(N).fract().sub(0.5).abs().sub(W);

        } else if (kind === 'spiral') {
          // one band whose longitude advances with latitude — the whole spiral
          // is this single line, and it wraps for free because fract() does
          const TURNS = o.count != null ? o.count : 5;
          const W = o.width != null ? o.width : 0.17;
          d = p.x.sub(p.y.mul(TURNS)).fract().sub(0.5).abs().sub(W);

        } else {
          // rows of dots, with the count per row following the circumference
          // so they neither crowd at the poles nor stretch at the equator
          const ROWS = o.count != null ? o.count : 8;
          const COLS = Math.round((o.count != null ? o.count : 8) * 1.9);
          const rowF = p.y.mul(ROWS);
          const row = rowF.floor();
          const fy = rowF.fract().sub(0.5);
          const circ = row.add(0.5).div(ROWS).mul(Math.PI).sin().max(0.12);
          const n = circ.mul(COLS).max(2.0);
          const stagger = row.mul(0.5).fract();
          const fx = p.x.mul(n).add(stagger).fract().sub(0.5);
          // arc length: du spans 2π·sin(lat)/n, dv spans π/ROWS
          const sx = fx.mul(circ.mul(Math.PI * 2).div(n));
          const sy = fy.mul(Math.PI / ROWS);
          d = T.length(T.vec2(sx, sy)).sub(o.width != null ? o.width : 0.115);
        }

        // one pixel of coverage either side of the edge, from the derivative —
        // this is what keeps it clean at a macro shot AND at a wide one
        const w = T.fwidth(d).max(0.0001);
        return T.smoothstep(w, w.negate(), d);
      })();
    }

    // cached per kind: the graph does not depend on colour, only the uniforms
    // multiplied onto it do
    const maskCache = Object.create(null);
    function maskFor(kind, opt) {
      const key = kind + ':' + (opt ? opt.count + 'x' + opt.width : 'default');
      if (!maskCache[key]) maskCache[key] = sdfMask(kind, opt);
      return maskCache[key];
    }

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
    const fieldCache = Object.create(null);
    function orbField(kind, cA, cB) {
      const key = kind + ':' + cA + ':' + cB;
      if (fieldCache[key]) return fieldCache[key];
      const T = THREE.TSL;
      const A = new THREE.Color(cA), B = new THREE.Color(cB);
      const va = T.vec3(A.r, A.g, A.b), vb = T.vec3(B.r, B.g, B.b);

      fieldCache[key] = T.Fn(() => {
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
      return fieldCache[key];
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
      try { scene.environment = await buildEnvironment(rimColour); }
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
      alphaTest: 0, side: THREE.FrontSide,
    };
    const white = new THREE.Color(0xffffff);
    function paint(i) {
      const mat = balls[i].material;
      const spec = style().skin(i, ACCENTS[accentIx]);
      for (const k in BASE) mat[k] = BASE[k];
      mat.emissive.set(0x000000);
      mat.attenuationColor.set(0xffffff);
      if (mat.sheenColor) mat.sheenColor.set(0xffffff);
      mat.iridescenceThicknessRange = [100, 400];
      // a style that does not ask for a pattern must not inherit the last
      // one's node graph
      mat.emissiveNode = null;
      mat.opacityNode = null;
      const core = balls[i].userData.core;
      core.visible = false;
      for (const k in spec) {
        if (k === 'glow') continue;
        if (k === 'color' || k === 'emissive' || k === 'attenuationColor'
            || k === 'sheenColor') mat[k].set(spec[k]);
        else mat[k] = spec[k];
      }
      if (spec.field) {
        // the whole surface, lit from within — no room reflection involved
        mat.emissiveNode = orbField(spec.field.kind, spec.field.a, spec.field.b);
      }
      if (spec.glow) {
        const c = new THREE.Color(spec.glow.colour);
        mat.emissiveNode = THREE.TSL.vec3(c.r, c.g, c.b)
          .mul(maskFor(spec.glow.kind, spec.glow))
          .mul(patternGlow);
      }

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
        mat.opacityNode = maskFor(spec.holes.kind, spec.holes).oneMinus();
        mat.alphaTest = 0.5;
        mat.side = THREE.DoubleSide;
      }
      if (spec.core) {
        core.visible = true;
        core.material.color.set(spec.core.color != null ? spec.core.color : 0x000000);
        core.material.emissive.set(spec.core.emissive != null ? spec.core.emissive : 0x000000);
        core.material.emissiveIntensity = spec.core.intensity != null ? spec.core.intensity : 1;
        core.material.roughness = spec.core.roughness != null ? spec.core.roughness : 0.4;
        core.material.metalness = spec.core.metalness != null ? spec.core.metalness : 0;
        core.scale.setScalar(spec.core.scale != null ? spec.core.scale : 0.82);
        core.material.needsUpdate = true;
      }
      mat.needsUpdate = true;
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

    // ── the post chain ─────────────────────────────────────────────────────
    let post = null;
    try {
      const TSL = THREE.TSL;
      const pp = new THREE.PostProcessing(renderer);
      const scenePass = TSL.pass(scene, camera, {
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
      refl.resolutionScale = 1;
      // 4, where the reference uses 1. TRAA sits downstream and a reflection
      // does not move the way the surface under it moves, so reprojection
      // cannot line it up; any instability in SSR arrives as coloured trails
      // smeared across the balls. Blurring until it is temporally steady is
      // the fix, and the reflections are soft anyway at roughness 0.2.
      refl.blurQuality = 4;
      if (refl.quality) refl.quality.value = 1;
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

    // ── drifting between looks ─────────────────────────────────────────────
    // The accent moves on its own, slowly, and the style follows further
    // behind. Both wait for a beat to change so the cut lands with the music
    // instead of across it.
    let nextAccent = 26, nextStyle = 62;
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
    function save() { amp.save(JSON.stringify({ pinned, accentIx })); }

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
        if (post) post.render(); else renderer.render(scene, camera);
      },

      resize(w, h) {
        renderer.setSize(w, h, false);
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
