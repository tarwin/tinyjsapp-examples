// Tomato — window logic. The backend owns the clock and pushes a fresh `state`
// every second; this page just draws it. Buttons round-trip to the backend so
// the tray and the window can never disagree.

const $ = (id) => document.getElementById(id);
const two = (n) => String(n).padStart(2, '0');
const fmt = (s) => two(Math.floor(s / 60)) + ':' + two(s % 60);

function render(s) {
  $('time').textContent = fmt(s.remaining);
  $('phase').textContent = s.label;
  $('toggle').innerHTML = s.running ? '&#10073;&#10073;' : '&#9654;';  // ❚❚ / ▶

  // Progress ring: fraction elapsed, drawn as a conic sweep (CSS reads --p).
  const elapsed = s.total ? (1 - s.remaining / s.total) * 100 : 0;
  $('ring').style.setProperty('--p', elapsed.toFixed(1));

  // Break phases go green; the mood drives the googly face.
  const stage = $('stage');
  stage.dataset.phase = s.phase === 'focus' ? 'focus' : 'break';
  stage.dataset.mood = s.running ? (s.phase === 'focus' ? 'focus' : 'break')
    : s.remaining < s.total ? 'paused' : 'idle';
}

tiny.api.on('state', render);

$('toggle').addEventListener('click', () => tiny.api.call('toggle'));
$('reset').addEventListener('click', () => tiny.api.call('reset'));
$('skip').addEventListener('click', () => tiny.api.call('skip'));
$('hide').addEventListener('click', () => tiny.api.call('hide'));

async function init() {
  tiny.win.setChrome({ frame: false, trafficLights: false, transparent: true });
  tiny.win.setResizable(false);
  render(await tiny.api.call('state'));
}
init();
