// The page is one raven's costume — both bird windows load this same file.
// All behavior (where to walk, when to fly, whom to trust) lives in the
// backend; this file just animates what it's told. Pushes are broadcast to
// every window, tagged with `who`, so each page wears only its own state.

const $ = (id) => document.getElementById(id);
const raven = $('raven');

// 'main' is Huginn; the second window ('r2') is Muninn, the bold one.
const me = tiny.win.id || 'main';
if (me === 'r2') document.body.classList.add('muninn');

let state = 'idle';

function setState(s) {
  state = s;
  document.body.dataset.state = s;
}

// ------------------------------------------------------------ backend cues

tiny.api.on('bird', (p) => { if (p.who === me) setState(p.state); });

tiny.api.on('look', (p) => {
  if (p.who !== me) return;
  raven.style.setProperty('--lx', p.x);
  raven.style.setProperty('--ly', p.y);
  raven.style.setProperty('--dir', p.dir);
  raven.style.setProperty('--lean',
    p.moving ? (state === 'fly' ? 6 : 1.5) : 0);
  document.body.dataset.fast = p.fast ? '1' : '0';
});

let sayT = null;
tiny.api.on('say', (p) => {
  if (p.who !== me) return;
  const b = $('bubble');
  b.textContent = p.text;
  b.classList.add('show');
  clearTimeout(sayT);
  sayT = setTimeout(() => b.classList.remove('show'), 1400);
});

tiny.api.on('hearts', (p) => {
  if (p.who !== me) return;
  for (let i = 0; i < (p.n || 1); i++) {
    setTimeout(() => spawnHeart(70 + rnd(-22, 28), 46 + rnd(-8, 8), rnd(-16, 16)), i * 160);
  }
});

// ------------------------------------------------------------- fx helpers

const rnd = (a, b) => a + Math.random() * (b - a);

function spawnHeart(x, y, drift) {
  const el = document.createElement('span');
  el.className = 'heart';
  el.textContent = '♥';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.setProperty('--hx', drift + 'px');
  $('fx').appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// The beady-eye blink, now and then.
(function blinkLoop() {
  setTimeout(() => {
    document.body.classList.add('blink');
    setTimeout(() => document.body.classList.remove('blink'), 130);
    blinkLoop();
  }, rnd(1800, 5200));
})();

// --------------------------------------------------------------- touching

// Clicks poke the bird; the backend decides whether that's a compliment
// (fed, following) or an ambush (everything else).
raven.addEventListener('click', () => tiny.api.call('poke'));

// Listeners are up — wake the brain.
tiny.api.call('boot').then((p) => setState(p.state));
