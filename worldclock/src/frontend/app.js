// World Clock — the page. It owns all the time-zone maths (WebKit has full
// `Intl`; the txiki.js backend does not), draws the city list once a second,
// and hands the backend a table of live UTC offsets so it can label the tray.

// The cities. `tz` is an IANA zone; `short` is what fits in the menu bar.
const CITIES = [
  { key: 'sf',  name: 'San Francisco', short: 'SF',     flag: '🌉', tz: 'America/Los_Angeles' },
  { key: 'nyc', name: 'New York',      short: 'NYC',    flag: '🗽', tz: 'America/New_York' },
  { key: 'lon', name: 'London',        short: 'London', flag: '🎡', tz: 'Europe/London' },
  { key: 'ber', name: 'Berlin',        short: 'Berlin', flag: '🥨', tz: 'Europe/Berlin' },
  { key: 'tok', name: 'Tokyo',         short: 'Tokyo',  flag: '🗼', tz: 'Asia/Tokyo' },
  { key: 'syd', name: 'Sydney',        short: 'Sydney', flag: '🦘', tz: 'Australia/Sydney' },
];

// Structural state from the backend (home city, 24h, which city is on the
// tray). Times aren't in here — the page computes those itself.
let model = { home: 'sf', h24: false, cycling: true, activeKey: null };

const $ = (id) => document.getElementById(id);

// A city's current wall-clock time, e.g. "4:45 PM" or "16:45".
function timeIn(tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: !model.h24,
  }).format(new Date());
}

// The city's local hour (0–23), for the day / night dot.
function hourIn(tz) {
  return +new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', hour12: false,
  }).format(new Date()) % 24;
}

// A whole-day number for the city's local date, so we can diff calendar days.
function dayNumber(tz) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

// Current offset from UTC in whole minutes, DST included — the one thing the
// backend can't work out for itself, so we compute it and send it over.
function offsetMinutes(tz) {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local - utc) / 60000);
}

// "Today" / "Tomorrow" / "Yesterday" (or ±N days) relative to the home city.
function dayLabel(tz) {
  const rel = dayNumber(tz) - dayNumber(homeTz());
  if (rel === 0) return 'Today';
  if (rel === 1) return 'Tomorrow';
  if (rel === -1) return 'Yesterday';
  return (rel > 0 ? '+' : '') + rel + ' days';
}

const homeTz = () => (CITIES.find((c) => c.key === model.home) || CITIES[0]).tz;

// Draw every row from scratch. Cheap (six rows) and keeps the DOM honest.
function render() {
  const list = $('list');
  list.innerHTML = '';
  for (const c of CITIES) {
    const hour = hourIn(c.tz);
    const night = hour < 6 || hour >= 19;

    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.key = c.key;
    if (c.key === model.home) li.classList.add('home');
    if (c.key === model.activeKey) li.classList.add('active');

    li.innerHTML =
      '<span class="flag">' + c.flag + '</span>' +
      '<span class="place">' +
        '<span class="name">' + c.name + '</span>' +
        '<span class="day">' + dayLabel(c.tz) + '</span>' +
      '</span>' +
      '<span class="clock">' +
        '<span class="dot ' + (night ? 'night' : 'day') + '">' + (night ? '🌙' : '☀️') + '</span>' +
        '<span class="time">' + timeIn(c.tz) + '</span>' +
      '</span>';

    li.addEventListener('click', () => tiny.api.call('setHome', c.key));
    list.appendChild(li);
  }
  $('cycle').textContent = model.cycling ? '⏸' : '▶';
  $('cycle').title = model.cycling ? 'Pause cycling' : 'Resume cycling';
  $('fmt').textContent = model.h24 ? '12h' : '24h';
}

// The backend pushes structural changes (new home, 24h flipped, a new city
// rotated onto the tray). Re-render to reflect them.
tiny.api.on('model', (m) => { model = m; render(); });

// Header controls round-trip to the backend, which owns the settings + tray.
$('cycle').addEventListener('click', () => tiny.api.call('toggleCycle'));
$('fmt').addEventListener('click', () => tiny.api.call('toggle24'));

// Click-out dismiss: when the window loses focus, tell the backend to hide it,
// so the panel behaves like a proper menu-bar popover.
window.addEventListener('blur', () => tiny.api.call('blurHide'));

// Send the backend the city table with fresh offsets. Offsets only shift at
// DST boundaries, so re-sending every few minutes is plenty.
function sync() {
  const list = CITIES.map((c) => ({
    key: c.key, short: c.short, flag: c.flag, name: c.name, off: offsetMinutes(c.tz),
  }));
  return tiny.api.call('sync', list);
}

async function init() {
  tiny.win.setChrome({ frame: false, trafficLights: false, vibrancy: 'popover' });
  tiny.win.setResizable(false);

  model = await sync();          // first sync also returns the saved settings
  render();

  setInterval(render, 1000);     // tick the clocks
  setInterval(sync, 5 * 60000);  // refresh offsets across DST changes
}
init();
