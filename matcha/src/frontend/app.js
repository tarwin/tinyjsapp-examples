// Matcha — About/status window. All real logic lives in the backend + tray;
// this window just mirrors state and offers the same toggles as the menu.

const $ = (id) => document.getElementById(id);
const pane = $('pane');
const MACHINE = /Windows/.test(navigator.userAgent) ? 'PC' : 'Mac';

let durations = [];
let countdown = null;

const two = (n) => String(n).padStart(2, '0');
function clockOf(ms) {
  const d = new Date(ms);
  let h = d.getHours(); const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return h + ':' + two(d.getMinutes()) + ' ' + ap;
}
function fmtLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h) return h + 'h ' + m + 'm left';
  if (m) return m + 'm ' + two(ss) + 's left';
  return ss + 's left';
}

function render(state) {
  pane.classList.toggle('on', state.active);
  $('toggle').textContent = state.active ? 'Turn Off' : `Keep ${MACHINE} Awake`;

  if (countdown) { clearInterval(countdown); countdown = null; }
  if (!state.active) {
    $('stateText').textContent = `Your ${MACHINE} can sleep`;
  } else if (state.endsAt) {
    const tick = () => { $('stateText').textContent = 'Awake · ' + fmtLeft(state.endsAt - Date.now()); };
    tick();
    countdown = setInterval(tick, 1000);
  } else {
    $('stateText').textContent = 'Awake — indefinitely';
  }

  for (const b of $('pills').children) b.classList.toggle('on', state.active && b.dataset.id === state.duration);
}

function renderPills() {
  $('pills').replaceChildren();
  for (const d of durations) {
    const b = document.createElement('button');
    b.dataset.id = d.id;
    b.textContent = d.secs === 0 ? 'Indefinitely' : d.label;
    b.addEventListener('click', async () => render(await tiny.api.call('activate', { id: d.id })));
    $('pills').append(b);
  }
}

$('toggle').addEventListener('click', async () => render(await tiny.api.call('toggle')));
// open the tabbed Settings window (a second native window; 0.8.0 multi-window)
$('openSettings').addEventListener('click', () =>
  tiny.win.open('settings', { page: 'settings.html', title: 'Matcha Settings', size: '540x470' }));
tiny.api.on('state', render);

async function init() {
  tiny.win.setResizable(false);   // the About panel is a fixed-size popover
  durations = await tiny.api.call('durations');
  renderPills();
  render(await tiny.api.call('snapshot'));
}
init();
