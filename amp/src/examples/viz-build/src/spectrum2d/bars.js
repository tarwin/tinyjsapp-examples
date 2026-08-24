import { mix } from './palette.js';

/**
 * A ring of spectrum bars that rise fast and fall slow. Tracking the fft
 * exactly looks like noise; the asymmetric decay is what makes it read as
 * music.
 */
export function createBars(count = 72) {
  const heights = new Float32Array(count);

  return {
    /** @param {AmpViz.Audio} audio */
    update(audio) {
      for (let i = 0; i < count; i++) {
        const v = audio.fft[Math.floor(i * (200 / count))] / 255;
        heights[i] = Math.max(v * v, heights[i] * 0.88);
      }
    },

    /**
     * @param {OffscreenCanvasRenderingContext2D} ctx
     * @param {{name: string, bg: string, ink: string[], hit: string}} skin
     */
    draw(ctx, skin, audio, t, w, h) {
      const cx = w / 2, cy = h / 2;
      const base = Math.min(w, h) * (0.16 + audio.bass * 0.05);
      ctx.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + t * 0.12;
        const len = base + heights[i] * base * 2.2;
        const c = mix(skin.ink[i % skin.ink.length],
                      skin.hit, Math.min(1, heights[i] * 1.4));
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(1.5, (w / count) * 0.5 * (0.6 + heights[i]));
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * base, cy + Math.sin(a) * base);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
      }
    },
  };
}
