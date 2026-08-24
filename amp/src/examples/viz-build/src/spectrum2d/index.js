// A plain Canvas 2D visualizer, built from several source files.
//
// No `// amp:uses` line: this one asks for no library, so amp injects nothing
// and the built file is a couple of KB. That is the normal case.
//
// @ts-check
/// <reference path="../../types/amp-viz.d.ts" />

import { PALETTES } from './palette.js';
import { createBars } from './bars.js';

amp.register({
  name: 'Spectrum',
  backends: ['2d'],
  presets: PALETTES.map((p) => p.name),

  create({ canvas, state }) {
    const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const bars = createBars(72);
    let skin = 0;
    try { const s = state ? JSON.parse(state) : null; if (s && s.skin != null) skin = s.skin % PALETTES.length; }
    catch (e) { /* a corrupt save is not worth a crash */ }

    return {
      frame({ audio, t, width, height }) {
        const p = PALETTES[skin];
        // wash rather than clear, so motion leaves a trail
        ctx.fillStyle = p.bg + 'd0';
        ctx.fillRect(0, 0, width, height);
        bars.update(audio);
        bars.draw(ctx, p, audio, t, width, height);

        if (audio.beat) {
          ctx.strokeStyle = p.hit;
          ctx.lineWidth = 1 + audio.punch * 4;
          ctx.beginPath();
          ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.13, 0, Math.PI * 2);
          ctx.stroke();
        }
      },

      randomize() {
        skin = (skin + 1) % PALETTES.length;
        amp.save({ skin });
        return PALETTES[skin].name;
      },
      preset(n) {
        skin = (skin + n + PALETTES.length) % PALETTES.length;
        amp.save({ skin });
      },
    };
  },
});
