// Ribbon — a visualizer you play, after Vib-Ribbon (NanaOn-Sha, 1999).
//
// The idea worth stealing from that game: the level IS the music. Nothing here
// is authored. Every obstacle is cut from the track amp is playing, on the beat
// amp detected, and its shape comes from what the spectrum was doing at that
// moment. So a song plays as the same course every time, and two songs are
// never the same course.
//
// FOUR OBSTACLES, FOUR MOVES, TWO KEYS. Each obstacle has exactly one answer,
// and each wears a small chevron saying which:
//
//   block    ∧    a low step with a CEILING over it   jump          (up)
//   wall     ∧∧   tall, open sky above it             double jump   (up, up)
//   bar      ∨    a LOW gap, and narrow                duck          (down)
//   tunnel   ∨∨   a HIGHER gap, but long               slide         (down, down)
//
// Neither pair is a ladder where the second move is just "more". The ceiling
// over a block is what stops the double jump being a free upgrade: go up twice
// there and you crack your head. And the duck and the slide differ on two axes
// at once, so neither covers the other. The duck gets you LOWEST but lasts a
// third of a second. The slide lasts twice as long but does not get you as low.
//
// Three hearts. A hit costs one; losing all three wipes the score back to zero
// and refills them. Bests are kept PER TRACK plus one all-time best, banked
// live through amp.save, so a wipe never takes a record down with it.
//
// Heights below are in GROUND UNITS, one unit being the height of the player
// standing. Everything is chosen so that the right move clears with a little to
// spare and every wrong move collides. That is not eyeballed: amp/tools/
// test-ribbon.js runs this file in plain node and plays every move against
// every obstacle. A plugin is one file with no imports, so testing one needs
// nothing but node.
//
// Up or Z jumps, twice for a double. Down or X ducks, tapped twice for a
// slide. R restarts.

amp.register({
  name: 'Ribbon',
  backends: ['2d'],
  presets: ['wire', 'neon', 'paper'],

  create({ canvas, state }) {
    const ctx = canvas.getContext('2d');

    // acc is the accent — the scarf, the shooting stars — never the hit colour
    const SKINS = {
      wire:  { bg: '#07080a', ink: '#f2f5f8', dim: '#454c56', hit: '#ff5555', acc: '#7fc7ff', glow: 0 },
      neon:  { bg: '#05030d', ink: '#6ef2ff', dim: '#2e3b70', hit: '#ff3b8e', acc: '#c86bff', glow: 12 },
      paper: { bg: '#f4f1e8', ink: '#1a1a1a', dim: '#a9a294', hit: '#c02020', acc: '#3b6ea5', glow: 0 },
    };
    const SKIN_NAMES = Object.keys(SKINS);
    let skin = 0;

    // ── physics, tuned for weight rather than float ──────────────────────
    // A single jump is up and down in 0.44 s. The old one hung for nearly a
    // second, which is why it felt like the moon.
    const G = 50;            // units per second squared
    const JUMP_V = 11.0;     // apex 1.21 units, airtime 0.44 s
    const DBL_V = 10.0;      // a second push, apex about 2.2 from the top
    const FAST_FALL = -13;   // down while airborne drops you now, not eventually
    // The duck is lower than the slide but over almost at once. Nothing here
    // is held: both are commitments you time, which is the point.
    const STAND = 1.0, DUCK = 0.30, SLIDE_H = 0.50;
    const DUCK_TIME = 0.30, SLIDE_TIME = 0.70;
    const DOUBLE_TAP = 0.26; // seconds between two downs to mean "slide"
    const MAX_HP = 3;

    // ── the four obstacles ───────────────────────────────────────────────
    // `w` is half-width in SECONDS of travel, so the shapes keep their size
    // whatever the scroll speed. `ceil` is an overhead limit that only some
    // obstacles impose.
    const KINDS = {
      // Widths and heights are not taste. A single jump holds feet above 0.85
      // for 0.24 s, so a block 0.20 s wide clears with room; a wall at 1.60 is
      // out of reach of one jump and inside two. The test proves all of it.
      block:  { w: 0.10, floor: 0.55, ceil: 2.55, move: 'jump' },
      wall:   { w: 0.10, floor: 1.60, ceil: null, move: 'double jump' },
      // low and narrow: only the duck gets under it
      bar:    { w: 0.10, floor: 0, under: 0.38, move: 'duck' },
      // higher but long: the duck is over before you are through, so it takes
      // the slide even though the slide does not get as low
      tunnel: { w: 0.28, floor: 0, under: 0.60, move: 'slide' },
    };
    // when a track drones the same obstacle forever, swap in the twin that
    // needs the same KIND of commitment on the other axis — quick for quick,
    // committed for committed — so the course keeps asking a new question at
    // the same difficulty
    const OPPOSITE = { block: 'bar', bar: 'block', wall: 'tunnel', tunnel: 'wall' };

    // Does the player, at feet height `feet` and standing height `h`, collide?
    function collides(o, feet, h) {
      const k = KINDS[o.type];
      if (Math.abs(o.t) > k.w) return false;
      if (k.under != null) return feet + h > k.under;   // hangs down: get low
      if (feet < k.floor) return true;                  // stands up: get over it
      if (k.ceil != null && feet + h > k.ceil) return true;
      return false;
    }

    // ── saved: a best per track, and one across everything ───────────────
    let save = { best: {}, bestAll: 0, runs: 0, cleared: 0 };
    if (state) { try { save = Object.assign(save, JSON.parse(state)); } catch (e) {} }
    // an older save has per-track bests but no all-time — fold them in
    for (const k in save.best) if (save.best[k] > (save.bestAll || 0)) save.bestAll = save.best[k];
    save.runs++;
    const persist = () => amp.save(JSON.stringify(save));
    persist();

    // ── state ────────────────────────────────────────────────────────────
    const LEAD = 1.45;            // seconds from the right edge to the player
    const PLAYER_X = 0.2;

    let W = 2, H = 2;
    let obstacles = [];

    let feet = 0, vy = 0, airborne = false, jumps = 0;
    let duckT = 0, slideT = 0, lastDown = -9;
    let score = 0, combo = 1, hits = 0, hp = MAX_HP;
    let stumble = 0, flash = 0, wipeFlash = 0;
    let trackId = '', trackName = '';
    let banner = '', bannerT = 0, idleT = 0, quiet = 0;
    let speed = 1;
    let clock = 0;          // seconds of play, the game's only clock
    let lastType = '', sameRun = 0;

    // scenery — none of it touches the game
    // Ground samples live in the SAME coordinate as the obstacles (seconds of
    // course travel) and decrement with the same dt * speed, so the waveform
    // on the ground moves in lockstep with the things standing on it. A ring
    // buffer scrolled per frame instead, which slid at a different rate — the
    // ground moving against its own obstacles reads as broken glass.
    const gsamp = [];                            // { t, v } — the ground's waveform
    const scarf = [];                            // where you have just been
    const puffs = [];                            // landing rings
    const stars = [];                            // wire: streaming starfield
    const shots = [];                            // wire: beat-burst shooting stars
    for (let i = 0; i < 70; i++)
      stars.push({ x: Math.random(), y: Math.random() * 0.6, z: 0.3 + Math.random() * 0.7 });
    const bars = new Float32Array(48);           // neon: eased fft skyline
    const clouds = [];                           // paper: bobbing clouds
    for (let i = 0; i < 5; i++)
      clouds.push({ x: Math.random(), y: 0.08 + Math.random() * 0.3,
        r: 0.045 + Math.random() * 0.05, ph: Math.random() * 6 });
    let sunSpin = 0, squash = 0, wasAirborne = false;
    let hillOff = 0, cityOff = 0;                // parallax layers' travel

    const height = () => (duckT > 0 ? DUCK : slideT > 0 ? SLIDE_H : STAND);
    const bestFor = (id) => save.best[id] || 0;

    // bests are banked LIVE, not at the end of the song, so a wipe cannot
    // take a record down with it (the host debounces the writes)
    function noteScore() {
      let changed = false;
      if (trackId && score > (save.best[trackId] || 0)) { save.best[trackId] = score; changed = true; }
      if (score > (save.bestAll || 0)) { save.bestAll = score; changed = true; }
      if (changed) persist();
    }

    function reset() {
      obstacles = [];
      feet = 0; vy = 0; airborne = false; jumps = 0;
      duckT = 0; slideT = 0;
      score = 0; combo = 1; hits = 0; hp = MAX_HP; stumble = 0;
    }
    function say(text, secs) { banner = text; bannerT = secs || 2.2; }

    // the last heart gone wipes the score — the bests are already banked
    function wipe() {
      score = 0; combo = 1; hp = MAX_HP;
      wipeFlash = 1;
      say('wiped out', 2.2);
    }

    // ── the course, cut from the music ───────────────────────────────────
    // WHEN comes from audio.beat. WHAT comes from where the energy sits: low
    // sounds put things on the ground to get over, high sounds hang things
    // from above to get under. HOW HARD comes from audio.punch, so the big
    // moments in a track are the big moves.
    function pick(audio) {
      const low = audio.bass;
      const high = Math.max(audio.mid, audio.treb);
      // 0.35 on the log-compressed punch scale means roughly 2.6x the recent
      // bass norm — a genuine accent, not every kick
      const big = audio.punch > 0.35 || audio.level > 0.42;
      if (low >= high) return big ? 'wall' : 'block';
      return big ? 'tunnel' : 'bar';
    }
    function spawn(audio) {
      let type = pick(audio);
      // a monotone track would spawn the same thing forever — after three in a
      // row the fourth swaps to its opposite-axis twin, so the course keeps
      // asking a different question
      if (type === lastType && sameRun >= 3) {
        type = OPPOSITE[type];
        sameRun = 1;
      } else sameRun = type === lastType ? sameRun + 1 : 1;
      lastType = type;
      const last = obstacles[obstacles.length - 1];
      // Two obstacles closer than the MOVE between them takes is unfair rather
      // than hard. A jump is 0.44 s in the air, so two blocks need 0.5 s to
      // land and leave again. A slide commits you for 0.48 s and a double jump
      // for 0.62 s, so those need more room on both sides.
      const gap = type === 'tunnel' || type === 'wall' ? 0.7 : 0.5;
      if (last && LEAD - last.t < gap) return;
      obstacles.push({ t: LEAD, type, done: false, hit: false });
    }

    // a stack of chevrons — the obstacle's move, drawn on the obstacle
    function chevrons(S, x, y, dir, count, alpha) {
      ctx.strokeStyle = S.ink;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < count; i++) {
        const yy = y + dir * i * 7;
        ctx.beginPath();
        ctx.moveTo(x - 5, yy + dir * 3);
        ctx.lineTo(x, yy - dir * 3);
        ctx.lineTo(x + 5, yy + dir * 3);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    return {
      resize(w, h) { W = w; H = h; },

      randomize() { skin = (skin + 1) % SKIN_NAMES.length; return SKIN_NAMES[skin]; },
      preset(n) {
        if (typeof n === 'number') skin = (skin + n + SKIN_NAMES.length) % SKIN_NAMES.length;
        else { const i = SKIN_NAMES.indexOf(String(n)); if (i >= 0) skin = i; }
        return SKIN_NAMES[skin];
      },

      // Two keys, four moves. Up again while airborne is the double jump;
      // down twice quickly is the slide.
      input(ev) {
        const up = ev.key === 'ArrowUp' || ev.key === 'z';
        const down = ev.key === 'ArrowDown' || ev.key === 'x';
        if (ev.type === 'up') return;                   // nothing here is held
        if (ev.repeat) return;

        if (up) {
          if (slideT > 0 || duckT > 0 || stumble > 0) return;   // committed
          if (!airborne) { vy = JUMP_V; airborne = true; jumps = 1; duckT = 0; }
          else if (jumps === 1) { vy = DBL_V; jumps = 2; }
        } else if (down) {
          // the frame clock, not wall time: input and physics must agree about
          // what a second is, or the double tap works everywhere except under a
          // debugger, a test, or a stalled frame
          const now = clock;
          if (airborne) {
            vy = Math.min(vy, FAST_FALL);                // cut the jump short
          } else if (now - lastDown < DOUBLE_TAP) {
            slideT = SLIDE_TIME;                         // the second tap wins
            duckT = 0;
          } else {
            duckT = DUCK_TIME;                           // a tap, not a hold
          }
          lastDown = now;
        } else if (ev.key === 'r') {
          reset(); say('restart', 1.2);
        }
      },

      track(info) {
        trackId = info.id || '';
        trackName = info.title || '';
        reset();
        say(trackName ? 'new course: ' + trackName : 'new course', 2.6);
      },

      transport(ev) {
        if (ev.type === 'ended') {
          noteScore();
          save.cleared++;
          persist();
          say('course clear   ' + score, 4);
        } else if (ev.type === 'seek') {
          obstacles = [];
        }
      },

      frame({ audio, dt, t }) {
        const S = SKINS[SKIN_NAMES[skin]];
        const playing = audio.playing;
        clock += dt;

        // the beat, for everything that bounces: the PLL's swell into the next
        // beat when the tempo is trusted, the raw after-flash when it is not
        const swell = (audio.bpm && (audio.confidence || 0) > 0.35)
          ? 1 - (audio.beatPhase || 0)
          : Math.max(0, 1 - (audio.since || 9) * 3);

        // bpm nudges the scroll, so a fast track really does come at you
        // faster, but never so much that the lead time stops being readable
        const trust = audio.confidence == null || audio.confidence > 0.35;
        const want = (audio.bpm && trust) ? Math.max(0.85, Math.min(1.3, 0.72 + audio.bpm / 320)) : 1;
        speed += (want - speed) * Math.min(1, dt * 2);

        // ── spawn ────────────────────────────────────────────────────────
        if (playing) {
          quiet += dt;
          if (audio.beat) { spawn(audio); quiet = 0; }
          // ambient music with no detectable beat still gets a course
          else if (quiet > 1.5) { spawn(audio); quiet = 0; }
        }

        // ── advance and score ────────────────────────────────────────────
        for (const o of obstacles) o.t -= dt * speed;
        for (const o of obstacles) {
          if (o.done) continue;
          if (!o.hit && collides(o, feet, height())) {
            o.hit = true;
            hits++; combo = 1; stumble = 0.4; flash = 1;
            hp--;
            if (hp <= 0) wipe();
          }
          if (o.t < -0.25) {
            o.done = true;
            if (!o.hit) {
              score += 10 * combo;
              combo = Math.min(8, combo + 1);
              noteScore();
            }
          }
        }
        obstacles = obstacles.filter((o) => o.t > -1.2);

        // ── the body ─────────────────────────────────────────────────────
        if (stumble > 0) stumble = Math.max(0, stumble - dt);
        if (slideT > 0) slideT = Math.max(0, slideT - dt);
        if (duckT > 0) duckT = Math.max(0, duckT - dt);
        if (airborne || feet > 0) {
          vy -= G * dt;
          feet += vy * dt;
          if (feet <= 0) { feet = 0; vy = 0; airborne = false; jumps = 0; }
        }

        if (!playing) idleT += dt; else idleT = 0;
        if (bannerT > 0) bannerT -= dt;
        if (flash > 0) flash = Math.max(0, flash - dt * 3);
        if (wipeFlash > 0) wipeFlash = Math.max(0, wipeFlash - dt * 1.6);
        if (squash > 0) squash = Math.max(0, squash - dt * 6);
        if (wasAirborne && !airborne) {                   // just landed
          squash = 1;
          puffs.push({ r: 4, a: 0.8 });
        }
        wasAirborne = airborne;

        // ── geometry ─────────────────────────────────────────────────────
        const ground = H * 0.78;
        const unit = H * 0.19;
        const px = W * PLAYER_X;
        const xOf = (secs) => px + (secs / LEAD) * (W - px);
        const yOf = (u) => ground - u * unit;

        // the world's speed at the play plane, for everything that must move
        // with the course — the ground exactly, the backgrounds at a fraction
        const vx = ((W - px) / LEAD) * speed;    // px per second

        // the ground carries the waveform — a few pixels, purely visual. Each
        // sample is born at the right edge in COURSE coordinates and rides the
        // same clock as the obstacles, so ground and obstacles never shear.
        gsamp.push({ t: LEAD, v: playing ? (audio.wave[300] - 128) / 128 : 0 });
        for (const g of gsamp) g.t -= dt * speed;
        while (gsamp.length && gsamp[0].t < -0.45) gsamp.shift();
        const groundAt = (x) => {
          // samples are ordered oldest (leftmost) to newest — find the pair
          // that brackets this x and lerp
          const tq = ((x - px) / (W - px)) * LEAD;
          for (let i = gsamp.length - 1; i > 0; i--) {
            if (gsamp[i - 1].t <= tq) {
              const a2 = gsamp[i - 1], b2 = gsamp[i];
              const f = (tq - a2.t) / Math.max(1e-6, b2.t - a2.t);
              return ground + (a2.v + (b2.v - a2.v) * Math.max(0, Math.min(1, f))) * unit * 0.09;
            }
          }
          return ground;
        };

        // ── background, one per skin ─────────────────────────────────────
        ctx.fillStyle = S.bg;
        ctx.fillRect(0, 0, W, H);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const sk = SKIN_NAMES[skin];
        if (sk === 'wire') {
          // a starfield in PARALLAX with the course — deep stars crawl, near
          // ones hurry, all of it a fraction of the ground speed so the world
          // reads as one piece. Loud music adds a shimmer of extra drift, and
          // a beat fires shooting stars, more of them the harder it hits.
          const drift = (vx * 0.22 + audio.level * 90) * dt / W;
          ctx.fillStyle = S.dim;
          for (const st of stars) {
            st.x -= drift * st.z;
            if (st.x < 0) { st.x = 1; st.y = Math.random() * 0.6; }
            const len = 1 + st.z * (2 + audio.level * 26);
            ctx.globalAlpha = 0.25 + st.z * 0.45 + swell * 0.2;
            ctx.fillRect(st.x * W, st.y * H, len, Math.max(1, st.z * 1.6));
          }
          ctx.globalAlpha = 1;
          if (audio.beat) {
            const n = 2 + Math.round((audio.punch || 0) * 8);
            for (let i = 0; i < n; i++)
              shots.push({ x: 1.05, y: Math.random() * 0.5, v: 0.5 + Math.random() * 0.6, a: 1 });
          }
          ctx.strokeStyle = S.acc;
          ctx.lineWidth = 1.4;
          for (let i = shots.length - 1; i >= 0; i--) {
            const sh = shots[i];
            sh.x -= sh.v * dt; sh.y += sh.v * dt * 0.22; sh.a -= dt * 0.9;
            if (sh.a <= 0 || sh.x < -0.1) { shots.splice(i, 1); continue; }
            ctx.globalAlpha = sh.a * 0.8;
            ctx.beginPath();
            ctx.moveTo(sh.x * W, sh.y * H);
            ctx.lineTo(sh.x * W + sh.v * 46, sh.y * H - sh.v * 11);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        } else if (sk === 'neon') {
          // far behind the fft skyline, a silhouette city slides past at a
          // third of the course speed — the parallax that makes the equalizer
          // buildings read as NEAR
          cityOff += vx * 0.33 * dt;
          const bwCity = 42;
          ctx.fillStyle = S.dim;
          ctx.globalAlpha = 0.16;
          const first = Math.floor(cityOff / bwCity);
          for (let i = first; (i - first) * bwCity < W + bwCity; i++) {
            const hgt = (Math.abs(Math.sin(i * 127.1) * 43758.5) % 1) * H * 0.2 + H * 0.04;
            ctx.fillRect(i * bwCity - cityOff, ground - hgt, bwCity - 6, hgt);
          }
          ctx.globalAlpha = 1;

          // the fft skyline itself: rises fast, falls slow, and the rooflights
          // glow brighter INTO each beat (that is beatPhase at work)
          for (let i = 0; i < bars.length; i++) {
            const v = (audio.fft[2 + i * 3] || 0) / 255;
            bars[i] = Math.max(v, bars[i] - dt * 0.9);
          }
          const bw2 = W / bars.length;
          for (let i = 0; i < bars.length; i++) {
            const bh2 = bars[i] * H * 0.34;
            ctx.fillStyle = S.dim;
            ctx.globalAlpha = 0.24 + swell * 0.18;
            ctx.fillRect(i * bw2 + 1, ground - bh2, bw2 - 2, bh2);
            ctx.fillStyle = S.acc;
            ctx.globalAlpha = 0.5 + swell * 0.4;
            ctx.fillRect(i * bw2 + 1, ground - bh2, bw2 - 2, 2);
          }
          ctx.globalAlpha = 1;
        } else {
          // paper: a sketchy sun whose rays turn with the music, and clouds
          // that drift, bob, and puff up on the beat
          sunSpin += dt * (0.25 + audio.level * 1.6);
          const sx = W * 0.86, sy = H * 0.16, sr = unit * 0.5;
          ctx.strokeStyle = S.dim;
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.stroke();
          for (let i = 0; i < 8; i++) {
            const a2 = sunSpin + (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(sx + Math.cos(a2) * sr * 1.25, sy + Math.sin(a2) * sr * 1.25);
            ctx.lineTo(sx + Math.cos(a2) * sr * (1.55 + swell * 0.25),
              sy + Math.sin(a2) * sr * (1.55 + swell * 0.25));
            ctx.stroke();
          }
          // two ranges of sketchy hills, the near one at a third of the course
          // speed and the far one slower still
          hillOff += vx * dt;
          ctx.strokeStyle = S.dim;
          for (const [frac, amp2, base, step] of [[0.14, 0.5, 1.9, 90], [0.33, 0.8, 1.1, 70]]) {
            ctx.globalAlpha = frac < 0.2 ? 0.4 : 0.7;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            const off = hillOff * frac;
            for (let x = 0; x <= W; x += 14) {
              const u2 = (x + off) / step;
              const y = yOf(base) + (Math.sin(u2) * 0.6 + Math.sin(u2 * 2.7) * 0.4) * unit * amp2 * 0.4;
              if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          for (const c of clouds) {
            c.x -= dt * (0.004 + (vx * 0.05) / W);
            if (c.x < -0.15) c.x = 1.15;
            const cy = c.y * H + Math.sin(clock * 0.7 + c.ph) * 5;
            const cr = c.r * H * (1 + swell * 0.14);
            ctx.beginPath();
            ctx.arc(c.x * W, cy, cr, 0, Math.PI * 2);
            ctx.arc(c.x * W + cr * 0.9, cy + cr * 0.25, cr * 0.7, 0, Math.PI * 2);
            ctx.arc(c.x * W - cr * 0.9, cy + cr * 0.3, cr * 0.6, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        if (S.glow) { ctx.shadowColor = S.ink; ctx.shadowBlur = S.glow; }

        // ── the ground, wearing its waveform ─────────────────────────────
        ctx.strokeStyle = S.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, gsamp.length ? ground + gsamp[0].v * unit * 0.09 : ground);
        for (const g of gsamp) ctx.lineTo(xOf(g.t), ground + g.v * unit * 0.09);
        ctx.lineTo(W, ground);
        ctx.stroke();

        // ── obstacles, straight lines only, each wearing its move ────────
        for (const o of obstacles) {
          const k = KINDS[o.type];
          const x = xOf(o.t);
          const hw = (k.w / LEAD) * (W - px);
          if (x + hw < -20 || x - hw > W + 20) continue;
          ctx.strokeStyle = o.hit ? S.hit : S.ink;
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (o.type === 'block') {
            ctx.moveTo(x - hw, ground);
            ctx.lineTo(x - hw, yOf(k.floor));
            ctx.lineTo(x + hw, yOf(k.floor));
            ctx.lineTo(x + hw, ground);
            // the ceiling: dashed, wide, and the reason not to double jump
            ctx.moveTo(x - hw * 2.2, yOf(k.ceil));
            ctx.lineTo(x + hw * 2.2, yOf(k.ceil));
            for (let i = -2; i <= 2; i++) {
              ctx.moveTo(x + i * hw * 0.9, yOf(k.ceil));
              ctx.lineTo(x + i * hw * 0.9, yOf(k.ceil) + unit * 0.12);
            }
          } else if (o.type === 'wall') {
            ctx.moveTo(x - hw, ground);
            ctx.lineTo(x - hw, yOf(k.floor));
            ctx.lineTo(x + hw, yOf(k.floor));
            ctx.lineTo(x + hw, ground);
            ctx.moveTo(x - hw, yOf(k.floor * 0.55));       // a rung, to read the height
            ctx.lineTo(x + hw, yOf(k.floor * 0.55));
          } else {
            // bar and tunnel hang from the top of the play area
            const u = k.under;
            ctx.moveTo(x - hw, yOf(3.2));
            ctx.lineTo(x - hw, yOf(u));
            ctx.lineTo(x + hw, yOf(u));
            ctx.lineTo(x + hw, yOf(3.2));
            if (o.type === 'tunnel') {                     // hatch the long one
              for (let i = -2; i <= 2; i++) {
                ctx.moveTo(x + i * hw * 0.45, yOf(u));
                ctx.lineTo(x + i * hw * 0.45, yOf(u) - unit * 0.18);
              }
            }
          }
          ctx.stroke();
          // the move it wants, as chevrons: up over the ground obstacles,
          // down under the hanging ones, doubled for the double moves, and
          // pulsing gently into each beat
          const chevA = 0.45 + swell * 0.35;
          if (o.type === 'block') chevrons(S, x, yOf(k.floor) - 12, -1, 1, chevA);
          else if (o.type === 'wall') chevrons(S, x, yOf(k.floor) - 12, -1, 2, chevA);
          else if (o.type === 'bar') chevrons(S, x, yOf(k.under) + 14, 1, 1, chevA);
          else chevrons(S, x, yOf(k.under) + 14, 1, 2, chevA);
        }

        // ── landing puffs ────────────────────────────────────────────────
        const pgy = groundAt(px);
        for (let i = puffs.length - 1; i >= 0; i--) {
          const p = puffs[i];
          p.r += dt * 70; p.a -= dt * 2.4;
          if (p.a <= 0) { puffs.splice(i, 1); continue; }
          ctx.strokeStyle = S.dim;
          ctx.globalAlpha = p.a;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.ellipse(px, pgy, p.r, p.r * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // ── you ──────────────────────────────────────────────────────────
        const h = height();
        const py = pgy - feet * unit;

        // the scarf: a short history of where you have been, streaming behind
        scarf.unshift(py);
        if (scarf.length > 12) scarf.pop();
        ctx.strokeStyle = S.acc;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i < scarf.length; i++) {
          const sx2 = px - 4 - i * unit * 0.07;
          const sy2 = scarf[i] - unit * h * 0.8
            + Math.sin(clock * 9 + i * 0.9) * (1 + i * 0.4);
          if (i === 0) ctx.moveTo(sx2, sy2); else ctx.lineTo(sx2, sy2);
        }
        ctx.stroke();

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(stumble > 0 ? -0.5 : Math.max(-0.3, Math.min(0.3, -vy * 0.02)));
        // squash on landing, stretch going up — the weight you can see
        ctx.scale(1 + squash * 0.18, 1 - squash * 0.22 + (airborne && vy > 3 ? 0.12 : 0));
        ctx.strokeStyle = stumble > 0 ? S.hit : S.ink;
        ctx.lineWidth = 2.2;
        const bh = unit * h;
        const bw = unit * (slideT > 0 ? 0.42 : duckT > 0 ? 0.32 : 0.2);
        ctx.beginPath();
        if (slideT > 0) {                                  // stretched out low
          ctx.moveTo(-bw, 0); ctx.lineTo(bw, -bh * 0.5);
          ctx.moveTo(-bw * 0.4, 0); ctx.lineTo(-bw * 0.1, -bh);
          ctx.moveTo(bw * 0.2, -bh * 0.35); ctx.lineTo(bw * 0.9, -bh * 0.1);
        } else {
          // legs: striding on the ground, tucked mid-air, planted when idle
          if (!airborne && playing) {
            const st = Math.sin(clock * (8 + speed * 4));
            ctx.moveTo(0, -bh * 0.42); ctx.lineTo(-bw * 0.7 + st * bw * 0.5, 0);
            ctx.moveTo(0, -bh * 0.42); ctx.lineTo(bw * 0.7 - st * bw * 0.5, 0);
          } else if (airborne) {
            ctx.moveTo(0, -bh * 0.42); ctx.lineTo(-bw * 0.9, -bh * 0.18);
            ctx.moveTo(0, -bh * 0.42); ctx.lineTo(bw * 0.6, -bh * 0.05);
          } else {
            ctx.moveTo(0, 0); ctx.lineTo(-bw * 0.7, -bh * 0.42);
            ctx.moveTo(0, 0); ctx.lineTo(bw * 0.7, -bh * 0.42);
          }
          ctx.moveTo(0, -bh * 0.42); ctx.lineTo(0, -bh);                  // body
          ctx.moveTo(-bw, -bh * 0.72); ctx.lineTo(bw, -bh * 0.72);        // arms
          ctx.moveTo(-bw * 0.5, -bh); ctx.lineTo(-bw * 0.2, -bh * 1.45);  // ears
          ctx.moveTo(bw * 0.5, -bh); ctx.lineTo(bw * 0.2, -bh * 1.45);
        }
        ctx.stroke();
        // the eye: a dot that blinks, an x while you are hurting
        if (slideT <= 0) {
          if (stumble > 0) {
            ctx.beginPath();
            ctx.moveTo(bw * 0.15, -bh * 0.92); ctx.lineTo(bw * 0.55, -bh * 0.82);
            ctx.moveTo(bw * 0.55, -bh * 0.92); ctx.lineTo(bw * 0.15, -bh * 0.82);
            ctx.stroke();
          } else if ((clock % 3.1) > 0.12) {
            ctx.fillStyle = S.ink;
            ctx.fillRect(bw * 0.25, -bh * 0.92, 2.4, 2.4);
          }
        }
        ctx.restore();

        // ── the readout ──────────────────────────────────────────────────
        ctx.shadowBlur = 0;
        ctx.fillStyle = S.ink;
        ctx.font = '600 ' + Math.round(H * 0.045) + 'px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(String(score).padStart(6, '0'), W * 0.04, H * 0.1);
        ctx.font = Math.round(H * 0.026) + 'px ui-monospace, Menlo, monospace';
        ctx.fillStyle = S.dim;
        ctx.fillText('x' + combo + (hits ? '   hit ' + hits : '') + (jumps === 2 ? '   air' : ''),
          W * 0.04, H * 0.145);
        // hearts — what a hit costs
        ctx.fillStyle = S.hit;
        ctx.fillText('♥'.repeat(hp) + '♡'.repeat(MAX_HP - hp), W * 0.04, H * 0.19);
        // the bests, straight off the save file: if these survive a restart,
        // the saving works
        ctx.fillStyle = S.dim;
        ctx.textAlign = 'right';
        const tb = bestFor(trackId);
        if (tb) ctx.fillText('best ' + tb, W * 0.96, H * 0.1);
        if (save.bestAll) ctx.fillText('all ' + save.bestAll, W * 0.96, H * 0.14);

        if (bannerT > 0) {
          ctx.textAlign = 'center';
          ctx.fillStyle = S.ink;
          ctx.font = '600 ' + Math.round(H * 0.048) + 'px ui-monospace, Menlo, monospace';
          ctx.globalAlpha = Math.min(1, bannerT);
          ctx.fillText(banner, W / 2, H * 0.28);
          ctx.globalAlpha = 1;
        }

        if (!playing && idleT > 0.6) {
          ctx.textAlign = 'center';
          ctx.fillStyle = S.dim;
          ctx.font = Math.round(H * 0.027) + 'px ui-monospace, Menlo, monospace';
          ctx.fillText('play something. the track is the course.', W / 2, H * 0.36);
          ctx.fillText('∧ step: up      ∧∧ tall wall: up twice', W / 2, H * 0.43);
          ctx.fillText('∨ low bar: down      ∨∨ long tunnel: down twice', W / 2, H * 0.48);
        }

        // a miss washes the screen for an instant; a wipe washes it longer
        if (flash > 0 || wipeFlash > 0) {
          ctx.fillStyle = S.hit;
          ctx.globalAlpha = Math.min(0.35, flash * 0.16 + wipeFlash * 0.3);
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
        }
      },
    };
  },
});
