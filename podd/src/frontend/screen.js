// screen.js — the monochrome LCD, drawn on a canvas the 3D device wears.
//
// 320×256 pixels, nearest-filtered on the model so it stays chunky. Two
// palettes: unlit (that grey-green STN look) and the third-gen's cold
// blue-white backlight. Everything is rows, arrows, and one inverted
// selection bar — 2003 didn't need more and neither do we.

window.SCREEN = (() => {
  const W = 320, H = 256;
  const TITLE_H = 34, ROW_H = 37, ROWS = 6;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  let backlight = false;
  const pal = () => backlight
    ? { bg: '#bcd2e8', ink: '#10141c', dim: '#5a6c85' }
    : { bg: '#c2c9b8', ink: '#1c211c', dim: '#6a7264' };

  const FONT = '600 19px "Helvetica Neue", sans-serif';
  const FONT_SM = '600 15px "Helvetica Neue", sans-serif';

  function clip(s, max) {
    if (g.measureText(s).width <= max) return s;
    while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }

  function titleBar(text) {
    const p = pal();
    g.fillStyle = p.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = p.ink;
    g.font = FONT;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(clip(text, W - 90), W / 2, TITLE_H / 2 + 1);
    g.fillRect(0, TITLE_H - 2, W, 2);
    // battery, top right (always smugly full — it's OUR fantasy iPod)
    g.strokeStyle = p.ink; g.lineWidth = 2;
    g.strokeRect(W - 44, 8, 30, 16);
    g.fillRect(W - 14, 12, 4, 8);
    g.fillRect(W - 41, 11, 24, 10);
  }

  // classic play/pause glyphs in the title bar's left corner
  function stateGlyph(state) {
    const p = pal();
    g.fillStyle = p.ink;
    if (state === 'play') {
      g.beginPath(); g.moveTo(12, 9); g.lineTo(26, 17); g.lineTo(12, 25); g.fill();
    } else if (state === 'pause') {
      g.fillRect(12, 9, 5, 16); g.fillRect(21, 9, 5, 16);
    }
  }

  return {
    canvas: cv,
    setBacklight(on) { backlight = !!on; },
    backlit: () => backlight,

    // items: [{ label, arrow?, value? }] — sel index, scroll = first row shown
    menu(title, items, sel, scroll, playState) {
      titleBar(title);
      stateGlyph(playState);
      const p = pal();
      g.font = FONT;
      for (let r = 0; r < ROWS; r++) {
        const i = scroll + r;
        if (i >= items.length) break;
        const y = TITLE_H + r * ROW_H;
        const selRow = i === sel;
        if (selRow) { g.fillStyle = p.ink; g.fillRect(0, y, W, ROW_H); }
        g.fillStyle = selRow ? p.bg : p.ink;
        g.textAlign = 'left'; g.textBaseline = 'middle';
        const it = items[i];
        const rightBits = (it.arrow ? 22 : 0) + (it.value ? g.measureText(it.value).width + 14 : 0);
        g.fillText(clip(it.label, W - 30 - rightBits), 12, y + ROW_H / 2 + 1);
        if (it.value) {
          g.textAlign = 'right';
          g.fillText(it.value, W - (it.arrow ? 34 : 14), y + ROW_H / 2 + 1);
        }
        if (it.arrow) {
          g.beginPath();
          g.moveTo(W - 22, y + ROW_H / 2 - 7);
          g.lineTo(W - 13, y + ROW_H / 2);
          g.lineTo(W - 22, y + ROW_H / 2 + 7);
          g.fill();
        }
      }
      if (items.length > ROWS) {                       // scrollbar
        const p2 = pal();
        const trackY = TITLE_H, trackH = H - TITLE_H;
        g.strokeStyle = p2.ink; g.lineWidth = 2;
        g.strokeRect(W - 7, trackY, 5, trackH);
        const h = Math.max(14, trackH * ROWS / items.length);
        const yy = trackY + (trackH - h) * (scroll / Math.max(1, items.length - ROWS));
        g.fillStyle = p2.ink;
        g.fillRect(W - 7, yy, 5, h);
      }
    },

    // the Now Playing screen: n of m, three text rows, progress or volume
    nowPlaying(np) {
      titleBar('Now Playing');
      stateGlyph(np.playing ? 'play' : 'pause');
      const p = pal();
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.font = FONT_SM;
      g.fillStyle = p.dim;
      g.fillText(np.index + ' of ' + np.count, 14, 56);
      g.font = FONT;
      g.fillStyle = p.ink;
      g.fillText(clip(np.title || '—', W - 28), 14, 92);
      g.fillText(clip(np.artist || '', W - 28), 14, 124);
      g.fillText(clip(np.album || '', W - 28), 14, 156);

      const barY = 196, barW = W - 28;
      if (np.mode === 'volume') {
        g.font = FONT_SM; g.fillStyle = p.dim;
        g.fillText('volume', 14, barY - 16);
        g.strokeStyle = p.ink; g.lineWidth = 2;
        g.strokeRect(14, barY, barW, 20);
        g.fillStyle = p.ink;
        g.fillRect(16, barY + 2, (barW - 4) * np.volume, 16);
      } else {
        const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
        g.strokeStyle = p.ink; g.lineWidth = 2;
        g.strokeRect(14, barY, barW, 20);
        const f = np.duration ? Math.min(1, np.elapsed / np.duration) : 0;
        g.fillStyle = p.ink;
        if (np.mode === 'scrub') {                      // diamond thumb while scrubbing
          g.fillRect(16, barY + 6, (barW - 4) * f, 8);
          const tx = 16 + (barW - 8) * f;
          g.beginPath();
          g.moveTo(tx, barY - 4); g.lineTo(tx + 7, barY + 10); g.lineTo(tx, barY + 24); g.lineTo(tx - 7, barY + 10);
          g.fill();
        } else {
          g.fillRect(16, barY + 2, (barW - 4) * f, 16);
        }
        g.font = FONT_SM;
        g.fillStyle = p.ink;
        g.textAlign = 'left'; g.fillText(fmt(np.elapsed || 0), 14, barY + 38);
        g.textAlign = 'right'; g.fillText('-' + fmt(Math.max(0, (np.duration || 0) - (np.elapsed || 0))), W - 14, barY + 38);
      }
    },

    // Extras → Clock
    clock() {
      titleBar('Clock');
      const p = pal();
      const now = new Date();
      g.fillStyle = p.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 52px "Helvetica Neue", sans-serif';
      let h = now.getHours() % 12; if (h === 0) h = 12;
      g.fillText(h + ':' + String(now.getMinutes()).padStart(2, '0'), W / 2, 118);
      g.font = FONT_SM; g.fillStyle = p.dim;
      g.fillText(now.toDateString(), W / 2, 168);
    },

    // a centred message ("No music — right-click to choose a folder")
    note(title, lines) {
      titleBar(title);
      const p = pal();
      g.fillStyle = p.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = FONT_SM;
      lines.forEach((ln, i) => g.fillText(clip(ln, W - 24), W / 2, 110 + i * 26));
    },
  };
})();
