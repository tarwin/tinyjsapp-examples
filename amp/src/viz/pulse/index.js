// Pulse — the smallest complete amp visualizer, and the one to copy first.
//
// Canvas 2D only, so it runs everywhere amp does (including WebKitGTK, which
// has no WebGPU at all). Everything it knows about the music arrives in the
// `audio` object handed to frame(): bands, a waveform, and the beat/bpm amp
// works out for you so every visualizer doesn't have to.

amp.register({
  name: 'Pulse',
  backends: ['2d'],
  presets: ['ember', 'arctic', 'acid'],

  create({ canvas, width, height }) {
    const ctx = canvas.getContext('2d');
    const PALETTES = {
      ember:  { bg: '#0b0705', a: [255, 140, 40],  b: [255, 60, 90],   c: [255, 220, 150] },
      arctic: { bg: '#04070c', a: [90, 200, 255],  b: [140, 120, 255], c: [220, 245, 255] },
      acid:   { bg: '#050b06', a: [140, 255, 90],  b: [255, 240, 60],  c: [200, 255, 220] },
    };
    const NAMES = Object.keys(PALETTES);
    let pal = 0;
    let W = width, H = height;
    const rings = [];          // expanding circles, one per beat
    let spin = 0;

    const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';

    return {
      resize(w, h) { W = w; H = h; },

      randomize() {
        pal = (pal + 1 + (Math.random() * (NAMES.length - 1) | 0)) % NAMES.length;
        return NAMES[pal];
      },
      preset(n) {
        if (typeof n === 'number') pal = (pal + n + NAMES.length) % NAMES.length;
        else { const i = NAMES.indexOf(String(n)); if (i >= 0) pal = i; }
        return NAMES[pal];
      },

      frame({ audio, dt }) {
        const P = PALETTES[NAMES[pal]];
        const cx = W / 2, cy = H / 2;
        const R = Math.min(W, H) * 0.22;

        // trails rather than a hard clear — cheap, and it makes beats smear
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = P.bg;
        ctx.globalAlpha = 0.22 + 0.3 * (1 - Math.min(1, audio.level * 3));
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter';

        // a beat spawns a ring; they expand and fade on their own
        if (audio.beat) rings.push({ r: R * 0.6, a: 1, w: 2 + audio.punch * 26 });
        for (let i = rings.length - 1; i >= 0; i--) {
          const g = rings[i];
          g.r += (240 + g.w * 12) * dt;
          g.a -= dt * 0.85;
          if (g.a <= 0) { rings.splice(i, 1); continue; }
          ctx.beginPath();
          ctx.arc(cx, cy, g.r, 0, Math.PI * 2);
          ctx.lineWidth = g.w * g.a;
          ctx.strokeStyle = rgba(P.b, g.a * 0.5);
          ctx.stroke();
        }

        // radial spectrum — 96 spokes off the low two thirds of the fft
        spin += dt * (0.15 + audio.mid * 1.2);
        const N = 96;
        for (let i = 0; i < N; i++) {
          const bin = 2 + ((i / N) * 150) | 0;
          const v = audio.fft[bin] / 255;
          const ang = spin + (i / N) * Math.PI * 2;
          const r0 = R * (0.85 + audio.bass * 0.5);
          const r1 = r0 + v * v * Math.min(W, H) * 0.34;
          const mixv = i / N;
          const col = [
            P.a[0] + (P.b[0] - P.a[0]) * mixv,
            P.a[1] + (P.b[1] - P.a[1]) * mixv,
            P.a[2] + (P.b[2] - P.a[2]) * mixv,
          ].map(Math.round);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
          ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
          ctx.lineWidth = 2 + v * 4;
          ctx.strokeStyle = rgba(col, 0.35 + v * 0.65);
          ctx.stroke();
        }

        // the waveform, wrapped into the middle as a closed ribbon
        ctx.beginPath();
        const step = 8;
        for (let i = 0; i < audio.wave.length; i += step) {
          const a = (i / audio.wave.length) * Math.PI * 2 - spin * 0.4;
          const v = (audio.wave[i] - 128) / 128;
          const r = R * (0.62 + v * (0.22 + audio.punch * 0.9));
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.lineWidth = 1.5 + audio.level * 6;
        ctx.strokeStyle = rgba(P.c, 0.5 + audio.level * 0.5);
        ctx.stroke();

        // the core, breathing on the bass
        const cr = R * (0.3 + audio.bass * 0.35) * (1 + audio.punch);
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, cr));
        grd.addColorStop(0, rgba(P.c, 0.9));
        grd.addColorStop(1, rgba(P.a, 0));
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, cr), 0, Math.PI * 2); ctx.fill();
      },
    };
  },
});
