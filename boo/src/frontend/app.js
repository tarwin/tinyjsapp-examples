// The page is boo's costume. All behavior — where to drift, when to flee,
// when to trust you — lives in the backend; this file just animates what
// it's told: a state class on <body>, eased pupil tracking, and little
// one-shot effects (bubbles, hearts, crumbs, the poof).

const $ = (id) => document.getElementById(id);
const ghost = $('ghost');

let state = 'idle';

function setState(s) {
  state = s;
  document.body.dataset.state = s;
}

// ------------------------------------------------------------ backend cues

tiny.api.on('pet', (p) => setState(p.state));

tiny.api.on('look', ({ x, y, dir, moving }) => {
  ghost.style.setProperty('--lx', x);
  ghost.style.setProperty('--ly', y);
  ghost.style.setProperty('--dir', dir);
  ghost.style.setProperty('--lean',
    moving ? dir * (state === 'flee' ? 7 : 2.5) : 0);
});

let sayT = null;
tiny.api.on('say', ({ text }) => {
  const b = $('bubble');
  b.textContent = text;
  b.classList.add('show');
  clearTimeout(sayT);
  sayT = setTimeout(() => b.classList.remove('show'), 1500);
});

tiny.api.on('poof', () => document.body.classList.add('gone'));
tiny.api.on('appear', () => document.body.classList.remove('gone'));

tiny.api.on('eat', () => {
  // Crumbs tumble off the cookie while the chomp animation runs.
  for (let i = 0; i < 5; i++) {
    setTimeout(() => spawn('crumb', 70 + rnd(-8, 8), 92, '', rnd(-14, 14)), 200 + i * 220);
  }
});

tiny.api.on('hearts', ({ n }) => {
  for (let i = 0; i < (n || 1); i++) {
    setTimeout(() => spawn('heart', 60 + rnd(-20, 30), 40 + rnd(-8, 8), '♥', rnd(-16, 16)), i * 160);
  }
});

// ------------------------------------------------------------- fx helpers

const rnd = (a, b) => a + Math.random() * (b - a);

function spawn(cls, x, y, text, drift) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.setProperty(cls === 'heart' ? '--hx' : '--cx', drift + 'px');
  $('fx').appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// Blink now and then — unless asleep (eyes are already closed) or mid-poof.
(function blinkLoop() {
  setTimeout(() => {
    if (state !== 'sleep' && !document.body.classList.contains('gone')) {
      document.body.classList.add('blink');
      setTimeout(() => document.body.classList.remove('blink'), 140);
    }
    blinkLoop();
  }, rnd(2200, 6000));
})();

// --------------------------------------------------------------- touching

// You can only reach boo when it lets you (it flees the cursor otherwise).
// Clicks poke it; slow strokes over a happy ghost count as petting.
ghost.addEventListener('click', () => tiny.api.call('poke'));

let stroke = 0, lastPet = 0;
ghost.addEventListener('mousemove', (ev) => {
  if (state !== 'happy') return;
  stroke += Math.abs(ev.movementX) + Math.abs(ev.movementY);
  const now = Date.now();
  if (stroke > 60 && now - lastPet > 900) {
    stroke = 0;
    lastPet = now;
    tiny.api.call('petted');
  }
});

// Listeners are up — wake the brain.
// Ask the Wayland tracking question BEFORE waking the brain — the ghost
// flees the cursor, and a confirm attached to a fleeing window is a chase.
offerTracking(false).catch(() => {}).then(() =>
  tiny.api.call('boot').then((p) => setState(p.state)));


// ── Wayland: ask before tracking the mouse beyond our window ────────────────
// The desktop hides the cursor once it leaves this window (capabilities()
// reports mousePosition false), so the pet goes blind. Tracking everywhere
// rides the system's screen-share permission — a user decision, so ask first,
// remember the answer, and let the context menu's "Follow mouse everywhere…"
// re-ask. Elsewhere mousePosition is global already and this returns at once.
async function offerTracking(again) {
  if (tiny.win.id !== 'main') return;   // one voice per app, not per window
  if ((await tiny.system.capabilities()).mousePosition !== false) return;
  let choice = again ? null : await tiny.store.get('mouseTrackChoice');
  if (choice !== 'yes' && choice !== 'no') {
    const yes = await tiny.dialog.confirm('Let Boo see your mouse everywhere?', {
      detail: 'On Wayland an app only sees the cursor while it is over its own '
        + 'window. Tracking everywhere uses the system screen-share permission — '
        + 'you will be asked once, and the sharing indicator shows while it is '
        + 'on. Right-click the ghost to change this later.',
      ok: 'Enable', cancel: 'Not now',
    });
    choice = yes ? 'yes' : 'no';
    await tiny.store.set('mouseTrackChoice', choice);
  }
  if (choice !== 'yes') return;
  try { await tiny.app.mouseTracking.start(); }
  catch { await tiny.store.set('mouseTrackChoice', 'no'); }  // portal said no — don't nag
}
tiny.api.on('ask-tracking', () => offerTracking(true));
