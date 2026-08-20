// Signal — every input a visualizer gets, drawn and labelled.
//
// Keep this open in one window while you write your own in another. Everything
// on screen is named after the field it comes from, so when the docs say
// `audio.punch` you can watch what punch actually does to your music before you
// decide what it should do to your picture.
//
// It also shows the hooks that are not part of the audio frame: what track()
// last said, what transport() last reported, and which keys input() received,
// which are the three things that are otherwise invisible until they misfire.

amp.register({
  name: 'Signal',
  backends: ['2d'],
  presets: ['amber', 'green', 'ice'],

  create({ canvas, backend, hdr }) {
    const ctx = canvas.getContext('2d');

    const SKINS = {
      amber: { ink: '#ffb454', dim: '#5a4326', grid: '#241a10', bg: '#0c0906', hot: '#fff0d0' },
      green: { ink: '#7ddb92', dim: '#2c5236', grid: '#10231a', bg: '#050b07', hot: '#dfffe8' },
      ice:   { ink: '#7dcfff', dim: '#2c4a63', grid: '#0f1e2b', bg: '#05090d', hot: '#e0f6ff' },
    };
    const NAMES = Object.keys(SKINS);
    let skin = 0;

    let W = 2, H = 2;
    let fps = 60, fpsAcc = 0, fpsN = 0;

    // what the non-audio hooks last told us
    let track = null;
    let lastEvent = '', lastEventAt = -99;
    const keys = [];                    // recent input(), newest last
    const held = new Set();

    // short histories, so you can see shape rather than a twitching number
    const HIST = 160;
    const hist = { level: [], punch: [], bass: [], beats: [] };
    for (const k in hist) hist[k] = new Array(HIST).fill(0);

    let peakHold = { bass: 0, mid: 0, treb: 0, level: 0, loudness: 0, peak: 0, punch: 0, confidence: 0 };
    let lastBeatIndex = 0, beatFlash = 0, bpmPhase = 0;
    const drumFlash = { kick: 0, snare: 0, hat: 0 };

    const fmt = (v, n) => (v == null ? '-' : v.toFixed(n == null ? 2 : n));
    const clock = (s) => {
      if (!isFinite(s) || s < 0) s = 0;
      const m = Math.floor(s / 60);
      return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    };

    // one labelled box, returning its inner rectangle
    function panel(S, x, y, w, h, title) {
      ctx.strokeStyle = S.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      ctx.fillStyle = S.dim;
      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(title, x + 6, y + 12);
      return { x: x + 6, y: y + 18, w: w - 12, h: h - 24 };
    }

    // a horizontal meter with its name, value and a peak marker
    function meter(S, x, y, w, h, name, v, hold) {
      ctx.fillStyle = S.grid;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = S.ink;
      ctx.fillRect(x, y, Math.max(0, Math.min(1, v)) * w, h);
      if (hold != null) {
        ctx.fillStyle = S.hot;
        ctx.fillRect(x + Math.min(1, hold) * w - 1, y - 1, 2, h + 2);
      }
      ctx.fillStyle = S.dim;
      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(name, x, y - 3);
      ctx.textAlign = 'right';
      ctx.fillStyle = S.ink;
      ctx.fillText(fmt(v), x + w, y - 3);
    }

    function trace(S, r, data, colour) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = r.x + (i / (data.length - 1)) * r.w;
        const y = r.y + r.h - Math.max(0, Math.min(1, data[i])) * r.h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    return {
      resize(w, h) { W = w; H = h; },

      randomize() { skin = (skin + 1) % NAMES.length; return NAMES[skin]; },
      preset(n) {
        if (typeof n === 'number') skin = (skin + n + NAMES.length) % NAMES.length;
        else { const i = NAMES.indexOf(String(n)); if (i >= 0) skin = i; }
        return NAMES[skin];
      },

      track(info) { track = info; },
      transport(ev) { lastEvent = ev.type + ' @ ' + fmt(ev.elapsed, 1) + 's'; lastEventAt = 0; },
      input(ev) {
        if (ev.type === 'down') {
          if (!ev.repeat) keys.push({ key: ev.key, t: 0 });
          held.add(ev.key);
          while (keys.length > 8) keys.shift();
        } else held.delete(ev.key);
      },

      frame({ audio, dt, t }) {
        const S = SKINS[NAMES[skin]];

        // ── keep the histories ───────────────────────────────────────────
        fpsAcc += dt; fpsN++;
        if (fpsAcc > 0.25) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
        for (const k of ['level', 'punch', 'bass']) { hist[k].push(audio[k]); hist[k].shift(); }
        hist.beats.push(audio.beat ? 1 : 0); hist.beats.shift();
        for (const k in peakHold) {
          peakHold[k] = Math.max(audio[k] || 0, peakHold[k] - dt * 0.35);
        }
        if (audio.beat) { beatFlash = 1; lastBeatIndex = audio.beatIndex; }
        beatFlash = Math.max(0, beatFlash - dt * 4);
        for (const k in drumFlash) {
          if (audio[k]) drumFlash[k] = 1;
          drumFlash[k] = Math.max(0, drumFlash[k] - dt * 5);
        }
        // the ring runs on the PLL's predicted phase when amp has one; the
        // fallback free-runs at the reported tempo
        if (audio.beatPhase != null && audio.bpm) bpmPhase = audio.beatPhase;
        else if (audio.bpm) bpmPhase = (bpmPhase + dt * (audio.bpm / 60)) % 1;
        for (const k of keys) k.t += dt;
        if (lastEventAt >= 0) lastEventAt += dt;

        // ── frame ────────────────────────────────────────────────────────
        ctx.fillStyle = S.bg;
        ctx.fillRect(0, 0, W, H);
        const pad = Math.max(8, Math.min(18, W * 0.016));
        const colW = (W - pad * 3) * 0.62;
        const rightW = W - pad * 3 - colW;
        const rowH = (H - pad * 4) / 3;

        // ── spectrum: audio.fft ──────────────────────────────────────────
        {
          const r = panel(S, pad, pad, colW, rowH, 'audio.fft   Uint8Array(256)   0 to 255');
          // mark the windows amp averages for bass, mid and treb
          const bands = [[1, 10, 'bass'], [20, 60, 'mid'], [80, 160, 'treb']];
          for (const [a, b, name] of bands) {
            const x0 = r.x + (a / 256) * r.w, x1 = r.x + (b / 256) * r.w;
            ctx.fillStyle = S.grid;
            ctx.fillRect(x0, r.y, x1 - x0, r.h);
            ctx.fillStyle = S.dim;
            ctx.font = '9px ui-monospace, Menlo, monospace';
            ctx.textAlign = 'left';
            ctx.fillText(name, x0 + 2, r.y + r.h + 10);
          }
          const bw = r.w / 256;
          ctx.fillStyle = S.ink;
          for (let i = 0; i < 256; i++) {
            const v = audio.fft[i] / 255;
            ctx.fillRect(r.x + i * bw, r.y + r.h - v * r.h, Math.max(1, bw - 0.5), v * r.h);
          }
        }

        // ── waveform: audio.wave ─────────────────────────────────────────
        {
          const r = panel(S, pad, pad * 2 + rowH, colW, rowH,
            'audio.wave   Uint8Array(1024)   128 is silence');
          ctx.strokeStyle = S.grid;
          ctx.beginPath();
          ctx.moveTo(r.x, r.y + r.h / 2); ctx.lineTo(r.x + r.w, r.y + r.h / 2);
          ctx.stroke();
          ctx.strokeStyle = S.ink;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let i = 0; i < 1024; i += 2) {
            const x = r.x + (i / 1023) * r.w;
            const y = r.y + r.h / 2 - ((audio.wave[i] - 128) / 128) * (r.h / 2) * 0.95;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        // ── histories ────────────────────────────────────────────────────
        {
          const r = panel(S, pad, pad * 3 + rowH * 2, colW, rowH,
            'over time   level, bass, punch, and every beat');
          for (let i = 0; i < HIST; i++) {
            if (!hist.beats[i]) continue;
            ctx.fillStyle = S.dim;
            ctx.fillRect(r.x + (i / (HIST - 1)) * r.w, r.y, 1, r.h);
          }
          trace(S, r, hist.level, S.dim);
          trace(S, r, hist.bass, S.ink);
          trace(S, r, hist.punch, S.hot);
          ctx.fillStyle = S.dim;
          ctx.font = '9px ui-monospace, Menlo, monospace';
          ctx.textAlign = 'right';
          ctx.fillText('punch is the bright one', r.x + r.w, r.y + 10);
        }

        // ── the right column ─────────────────────────────────────────────
        const rx = pad * 2 + colW;

        // bands and levels
        {
          const r = panel(S, rx, pad, rightW, rowH, 'bands and levels   0 to 1');
          const rows = [['bass', audio.bass], ['mid', audio.mid], ['treb', audio.treb],
            ['level', audio.level], ['loudness', audio.loudness || 0], ['peak', audio.peak],
            ['punch', audio.punch], ['confidence', audio.confidence || 0]];
          const gap = r.h / rows.length;
          rows.forEach(([name, v], i) => {
            meter(S, r.x, r.y + i * gap + 10, r.w, Math.max(4, gap - 16), name, v, peakHold[name]);
          });
        }

        // beat and bpm
        {
          const r = panel(S, rx, pad * 2 + rowH, rightW, rowH, 'beat detection');
          // the flash
          ctx.fillStyle = beatFlash > 0 ? S.hot : S.grid;
          ctx.beginPath();
          ctx.arc(r.x + 22, r.y + 24, 14 + beatFlash * 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = S.dim;
          ctx.font = '10px ui-monospace, Menlo, monospace';
          ctx.textAlign = 'left';
          ctx.fillText('audio.beat', r.x + 44, r.y + 16);
          ctx.fillStyle = S.ink;
          ctx.font = '14px ui-monospace, Menlo, monospace';
          ctx.fillText('#' + lastBeatIndex, r.x + 44, r.y + 32);

          // the per-band streams: kick, snare, hat
          let dx = r.x + r.w - 20;
          for (const name of ['hat', 'snare', 'kick']) {
            const glow = drumFlash[name];
            ctx.fillStyle = glow > 0 ? S.hot : S.grid;
            ctx.beginPath();
            ctx.arc(dx, r.y + 14, 6 + glow * 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = S.dim;
            ctx.font = '8px ui-monospace, Menlo, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(name, dx, r.y + 32);
            dx -= 32;
          }
          ctx.textAlign = 'left';

          // bpm, with a dot going round at that tempo
          ctx.fillStyle = S.dim;
          ctx.font = '10px ui-monospace, Menlo, monospace';
          ctx.fillText('audio.bpm · ring is audio.beatPhase', r.x, r.y + 58);
          ctx.fillStyle = S.ink;
          ctx.font = '600 26px ui-monospace, Menlo, monospace';
          ctx.fillText(audio.bpm ? String(Math.round(audio.bpm)) : '--', r.x, r.y + 84);
          if (audio.bpm) {
            const cx = r.x + r.w - 26, cy = r.y + 72, rad = 16;
            ctx.strokeStyle = S.grid;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
            const a = bpmPhase * Math.PI * 2 - Math.PI / 2;
            ctx.fillStyle = S.hot;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }

          // seconds since the last beat
          ctx.fillStyle = S.dim;
          ctx.font = '10px ui-monospace, Menlo, monospace';
          ctx.fillText('audio.since  ' + fmt(audio.since) + 's', r.x, r.y + r.h - 6);
          ctx.fillStyle = S.grid;
          ctx.fillRect(r.x, r.y + r.h - 4, r.w, 3);
          ctx.fillStyle = S.ink;
          ctx.fillRect(r.x, r.y + r.h - 4, Math.min(1, audio.since / 2) * r.w, 3);
        }

        // the hooks that are not the audio frame
        {
          const r = panel(S, rx, pad * 3 + rowH * 2, rightW, rowH, 'the other hooks');
          ctx.font = '10px ui-monospace, Menlo, monospace';
          ctx.textAlign = 'left';
          let y = r.y + 12;
          const line = (label, value, hot) => {
            ctx.fillStyle = S.dim;
            ctx.fillText(label, r.x, y);
            ctx.fillStyle = hot ? S.hot : S.ink;
            ctx.fillText(String(value).slice(0, 34), r.x + 74, y);
            y += 15;
          };
          line('track()', track ? (track.title || track.id || '(untitled)') : 'nothing yet');
          line('  artist', track && track.artist ? track.artist : '-');
          line('  isRadio', track ? !!track.isRadio : '-');
          line('transport()', lastEvent || 'nothing yet', lastEventAt >= 0 && lastEventAt < 1.2);
          line('playing', audio.playing);
          line('elapsed', clock(audio.elapsed) + ' / ' + clock(audio.duration));

          // the transport bar
          ctx.fillStyle = S.grid;
          ctx.fillRect(r.x, y - 8, r.w, 3);
          if (audio.duration > 0) {
            ctx.fillStyle = S.ink;
            ctx.fillRect(r.x, y - 8, (audio.elapsed / audio.duration) * r.w, 3);
          }
          y += 12;

          // input(), which only arrives for keys viz.json asked for
          ctx.fillStyle = S.dim;
          ctx.fillText('input()', r.x, y);
          let kx = r.x + 74;
          if (!keys.length) { ctx.fillStyle = S.ink; ctx.fillText('press an arrow', kx, y); }
          for (const k of keys.slice(-6)) {
            const label = k.key === ' ' ? 'space' : k.key.replace('Arrow', '');
            const w = ctx.measureText(label).width + 8;
            const fresh = Math.max(0, 1 - k.t);
            ctx.fillStyle = held.has(k.key) ? S.ink : (fresh > 0 ? S.hot : S.grid);
            ctx.fillRect(kx, y - 9, w, 12);
            ctx.fillStyle = held.has(k.key) || fresh > 0 ? S.bg : S.dim;
            ctx.fillText(label, kx + 4, y);
            kx += w + 4;
          }
        }

        // ── footer: what create() was told, and how fast we are going ────
        ctx.fillStyle = S.dim;
        ctx.font = '10px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('backend ' + backend + (hdr ? '   hdr true' : '   hdr false')
          + '   dt ' + fmt(dt, 4) + 's   ' + Math.round(fps) + ' fps   t ' + fmt(t, 1) + 's',
          pad, H - 6);
        ctx.textAlign = 'right';
        ctx.fillText('skin: ' + NAMES[skin] + '   (this plugin took the arrow keys, so use the '
          + 'toolbar to change preset)', W - pad, H - 6);
      },
    };
  },
});
