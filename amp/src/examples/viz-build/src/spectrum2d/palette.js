// One module doing one thing — which is the whole reason to build a plugin
// from a project rather than write it in a textarea.

/** @type {{name: string, bg: string, ink: string[], hit: string}[]} */
export const PALETTES = [
  { name: 'ember', bg: '#0b0705', hit: '#fff2d0',
    ink: ['#ff7a18', '#ff3d3d', '#ffb703', '#8a2be2'] },
  { name: 'tide',  bg: '#04080d', hit: '#e8faff',
    ink: ['#00d4ff', '#0077ff', '#00ffa3', '#7b61ff'] },
  { name: 'bone',  bg: '#0a0a0a', hit: '#ffffff',
    ink: ['#e6e6e6', '#9a9a9a', '#c9b18a', '#5f5f5f'] },
];

/** Blend two hex colours. Cheap, and enough for a visualizer. */
export function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round((pa >> 16 & 255) * (1 - t) + (pb >> 16 & 255) * t);
  const g = Math.round((pa >> 8 & 255) * (1 - t) + (pb >> 8 & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}
