// eq.js — 10-band equalizer window. Sliders → 'action' {type:'eq'} → the main
// window applies them to the BiquadFilter chain feeding the speakers.
const $ = (id) => document.getElementById(id);
const LABELS = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];
const PRESETS = {
  flat:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  rock:      [5, 4, 2, -1, -1, 1, 3, 4, 4, 4],
  pop:       [-1, 2, 4, 5, 4, 1, -1, -1, -1, -1],
  jazz:      [4, 3, 1, 2, -1, -1, 0, 1, 3, 4],
  classical: [5, 4, 3, 2, -1, -1, 0, 2, 3, 4],
  dance:     [6, 5, 2, 0, 0, -2, -3, -3, 0, 0],
  bass:      [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  treble:    [0, 0, 0, 0, 0, 2, 4, 5, 6, 7],
  vocal:     [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
};

let eq = { on: false, preamp: 0, bands: new Array(10).fill(0), hp: null };

const rows = $('rows');
function buildColumn(label, value, cls) {
  const col = document.createElement('div');
  col.className = cls;
  const input = document.createElement('input');
  input.type = 'range'; input.className = 'vert';
  input.min = -12; input.max = 12; input.step = 1; input.value = value;
  const hz = document.createElement('span'); hz.className = 'hz'; hz.textContent = label;
  col.append(input, hz);
  return { col, input };
}

// preamp column
const pre = buildColumn('PRE', 0, 'eq-pre');
rows.appendChild(pre.col);
pre.input.addEventListener('input', () => { eq.preamp = +pre.input.value; send(); });

// band columns
const bandInputs = [];
LABELS.forEach((lab, i) => {
  const c = buildColumn(lab, 0, 'eq-band');
  rows.appendChild(c.col);
  bandInputs.push(c.input);
  c.input.addEventListener('input', () => { eq.bands[i] = +c.input.value; send(); });
});

function reflect() {
  pre.input.value = eq.preamp;
  bandInputs.forEach((inp, i) => { inp.value = eq.bands[i] || 0; });
  $('on').classList.toggle('lit', eq.on);
  rows.classList.toggle('disabled', !eq.on);
  hpSel.value = eq.hp ? eq.hp.n : '';
}
function send() {          // moving any slider turns the EQ on, like Winamp
  if (!eq.on) { eq.on = true; reflect(); }
  tiny.api.call('action', { type: 'eq', eq });
}

$('on').onclick = () => { eq.on = !eq.on; reflect(); tiny.api.call('action', { type: 'eq', eq }); };
$('auto').onclick = () => { eq.preamp = 0; eq.bands = new Array(10).fill(0); reflect(); tiny.api.call('action', { type: 'eq', eq }); };
$('preset').onchange = (e) => {
  const p = PRESETS[e.target.value]; if (!p) return;
  eq.bands = p.slice(); eq.on = true; reflect();
  tiny.api.call('action', { type: 'eq', eq });
};
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'eq' });

// ── headphone correction (AutoEq profiles, see autoeq.js) ──────────────────
// Independent of the ON switch: ON gates the sliders you set by hand, while a
// profile corrects the headphone itself — picking one applies it, "none"
// removes it. The chosen profile travels inside the eq state, so the player
// applies it and it persists with the session like everything else.
const hpSel = $('hp');
{
  const none = document.createElement('option');
  none.value = ''; none.textContent = 'Headphone correction: none';
  hpSel.appendChild(none);
  const groups = { over: 'Over-ear', in: 'In-ear', bud: 'Earbuds' };
  for (const c of Object.keys(groups)) {
    const og = document.createElement('optgroup');
    og.label = groups[c];
    for (const p of window.AUTOEQ) {
      if (p.c !== c) continue;
      const o = document.createElement('option');
      o.value = p.n; o.textContent = p.n;
      og.appendChild(o);
    }
    hpSel.appendChild(og);
  }
}
hpSel.onchange = () => {
  const p = window.AUTOEQ.find((x) => x.n === hpSel.value) || null;
  eq.hp = p ? { n: p.n, p: p.p, f: p.f } : null;
  tiny.api.call('action', { type: 'eq', eq });
};

// transport works from this window too, not just main
document.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); tiny.api.call('action', { type: 'toggle' }); }
  else if (e.key === 'ArrowRight' && e.metaKey) { e.preventDefault(); tiny.api.call('action', { type: 'next' }); }
  else if (e.key === 'ArrowLeft' && e.metaKey) { e.preventDefault(); tiny.api.call('action', { type: 'prev' }); }
});

// ── shade view: mini volume + panning (interactive) ────────────────────────
// When collapsed, the equalizer's titlebar shows the player's volume and
// balance (they ride in the broadcast state) — drag them to adjust.
let vol = 0.8, bal = 0;
const eqShade = $('eqShade');
// VOL and BAL sit side by side; balance is the narrower track. (internal coords)
const VT = { x0: 36, x1: 248 };   // volume  (wide)
const BT = { x0: 330, x1: 452 };  // balance (narrower); the ~80px gap is drag space
const CY = 14;
function track(g, t, frac, center) {
  const w = t.x1 - t.x0;
  g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(t.x0, CY); g.lineTo(t.x1, CY); g.stroke();
  if (center) { g.strokeStyle = 'rgba(55,255,155,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(t.x0 + w / 2, CY - 5); g.lineTo(t.x0 + w / 2, CY + 5); g.stroke(); }
  const tx = t.x0 + Math.max(0, Math.min(1, frac)) * w;
  g.fillStyle = '#dcdce4'; g.fillRect(tx - 4, CY - 6, 8, 12);
}
function drawShade() {
  const g = eqShade.getContext('2d');
  g.clearRect(0, 0, eqShade.width, eqShade.height);
  g.font = '8px -apple-system, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillStyle = 'rgba(150,160,180,.85)';
  g.fillText('VOL', 4, CY); g.fillText('BAL', 296, CY);
  track(g, VT, vol, false);
  track(g, BT, (bal + 1) / 2, true);
}
let sliding = null;   // 'vol' | 'bal' | null — the slider the grab STARTED on
function trackAt(e) {
  const r = eqShade.getBoundingClientRect();
  const xi = (e.clientX - r.left) * (eqShade.width / r.width);
  if (xi >= VT.x0 - 8 && xi <= VT.x1 + 8) return 'vol';
  if (xi >= BT.x0 - 8 && xi <= BT.x1 + 8) return 'bal';
  return null;   // labels / gap → not a slider, so the window can be dragged
}
function shadeInput(e, which) {
  const r = eqShade.getBoundingClientRect();
  const xi = (e.clientX - r.left) * (eqShade.width / r.width);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  if (which === 'vol') { vol = clamp((xi - VT.x0) / (VT.x1 - VT.x0)); tiny.api.call('action', { type: 'vol', value: vol }); }
  else { bal = clamp((xi - BT.x0) / (BT.x1 - BT.x0)) * 2 - 1; tiny.api.call('action', { type: 'bal', value: bal }); }
  drawShade();
}
eqShade.addEventListener('pointerdown', (e) => {
  const t = trackAt(e);
  if (!t) return;                 // not on a slider → let it bubble so drag.js moves the window
  e.stopPropagation();            // on a slider → don't start a window drag
  sliding = t;                    // lock to this slider for the whole gesture
  try { eqShade.setPointerCapture(e.pointerId); } catch (er) {}
  shadeInput(e, t);
});
eqShade.addEventListener('pointermove', (e) => { if (sliding) shadeInput(e, sliding); });
eqShade.addEventListener('pointerup', () => { sliding = null; });
eqShade.addEventListener('pointercancel', () => { sliding = null; });

tiny.api.on('state', (s) => {
  if (!s) return;
  if (typeof s.volume === 'number') vol = s.volume;
  if (typeof s.balance === 'number') bal = s.balance;
  if (!sliding) drawShade();
});

// sync from saved state
(async () => {
  const s = await tiny.api.call('hello');
  if (s) {
    if (s.eq) { eq = { on: !!s.eq.on, preamp: s.eq.preamp || 0, bands: (s.eq.bands || []).slice(0, 10), hp: s.eq.hp || null }; while (eq.bands.length < 10) eq.bands.push(0); }
    if (typeof s.volume === 'number') vol = s.volume;
    if (typeof s.balance === 'number') bal = s.balance;
  }
  reflect(); drawShade();
})();
reflect();
drawShade();
