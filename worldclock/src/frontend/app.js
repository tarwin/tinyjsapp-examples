// World Clock — the page. It owns all the time-zone maths (WebKit has full
// `Intl`; the txiki.js backend does not), draws the city list once a second,
// and hands the backend a table of live UTC offsets so it can label the tray.

// The starter cities. `tz` is an IANA zone; the flag emoji doubles as the
// menu-bar label. Yours are editable: add with ＋, remove with the hover ✕ —
// the full list persists in the backend store and replaces this one.
const DEFAULT_CITIES = [
  { key: 'sf',  name: 'San Francisco', short: 'SF',     flag: '🌉', tz: 'America/Los_Angeles' },
  { key: 'nyc', name: 'New York',      short: 'NYC',    flag: '🗽', tz: 'America/New_York' },
  { key: 'lon', name: 'London',        short: 'London', flag: '🎡', tz: 'Europe/London' },
  { key: 'ber', name: 'Berlin',        short: 'Berlin', flag: '🥨', tz: 'Europe/Berlin' },
  { key: 'tok', name: 'Tokyo',         short: 'Tokyo',  flag: '🗼', tz: 'Asia/Tokyo' },
  { key: 'syd', name: 'Sydney',        short: 'Sydney', flag: '🦘', tz: 'Australia/Sydney' },
];
let CITIES = DEFAULT_CITIES.slice();

// Structural state from the backend (home city, 24h, which city is on the
// tray). Times aren't in here — the page computes those itself.
let model = { home: 'sf', h24: false, cycling: false, activeKey: null };

const $ = (id) => document.getElementById(id);

// City names and emoji are user input now — never let them become markup.
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

// Draw every row from scratch. Cheap (a handful of rows) and keeps the DOM honest.
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
      '<span class="flag">' + esc(c.flag) + '</span>' +
      '<span class="place">' +
        '<span class="name">' + esc(c.name) + '</span>' +
        '<span class="day">' + dayLabel(c.tz) + '</span>' +
      '</span>' +
      '<span class="clock">' +
        '<span class="dot ' + (night ? 'night' : 'day') + '">' + (night ? '🌙' : '☀️') + '</span>' +
        '<span class="time">' + timeIn(c.tz) + '</span>' +
      '</span>' +
      (CITIES.length > 1 ? '<button class="rm" title="Remove ' + esc(c.name) + '">✕</button>' : '<span></span>');

    li.addEventListener('click', () => tiny.api.call('setHome', c.key));
    const rm = li.querySelector('.rm');
    if (rm) rm.addEventListener('click', (e) => { e.stopPropagation(); removeCity(c.key); });
    list.appendChild(li);
  }
  $('cycle').textContent = model.cycling ? '⏸' : '▶';
  $('cycle').title = model.cycling ? 'Stop cycling (pin to Home)' : 'Cycle through cities';
  $('fmt').textContent = model.h24 ? '12h' : '24h';
}

// ── editing the list ──────────────────────────────────────────────────────
// Any change re-persists the whole table and re-syncs the backend, so the
// tray, its Home submenu, and the store all follow in one move.
async function saveAndSync() {
  await tiny.api.call('saveCities', CITIES);
  model = await sync();
  render();
}

function removeCity(key) {
  if (CITIES.length <= 1) return;
  CITIES = CITIES.filter((c) => c.key !== key);
  saveAndSync();          // backend re-homes itself if Home was removed
}

function openAdd() {
  $('add').hidden = false;
  $('a-tz').value = ''; $('a-name').value = ''; $('a-emoji').value = '';
  $('a-tz').focus();
}
function closeAdd() { $('add').hidden = true; }

function addCity() {
  const tz = $('a-tz').value.trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); }
  catch { $('a-tz').classList.add('bad'); return; }
  $('a-tz').classList.remove('bad');
  const fallback = (tz.split('/').pop() || tz).replace(/_/g, ' ');
  const name = $('a-name').value.trim() || fallback;
  const flag = $('a-emoji').value.trim() || '🕐';
  CITIES.push({ key: 'c' + Date.now().toString(36), name, short: name, flag, tz });
  closeAdd();
  saveAndSync();
}

// The backend pushes structural changes (new home, 24h flipped, a new city
// rotated onto the tray). Re-render to reflect them.
tiny.api.on('model', (m) => { model = m; render(); });
// The tray menu's "Add City…" lands here once the panel is up.
tiny.api.on('add-city', openAdd);

// Header controls round-trip to the backend, which owns the settings + tray.
$('cycle').addEventListener('click', () => tiny.api.call('toggleCycle'));
$('fmt').addEventListener('click', () => tiny.api.call('toggle24'));
$('addBtn').addEventListener('click', () => ($('add').hidden ? openAdd() : closeAdd()));
$('a-ok').addEventListener('click', addCity);
$('a-cancel').addEventListener('click', closeAdd);
$('add').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addCity();
  if (e.key === 'Escape') closeAdd();
});
// Picking a zone pre-fills the label with the city part, ready to overtype.
$('a-tz').addEventListener('change', () => {
  if (!$('a-name').value.trim()) {
    $('a-name').value = ($('a-tz').value.split('/').pop() || '').replace(/_/g, ' ');
  }
});

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

  const saved = await tiny.api.call('getCities');
  if (Array.isArray(saved) && saved.length) CITIES = saved;

  // Every zone WebKit knows about, as autocomplete for the add form.
  const dl = $('tzs');
  for (const z of Intl.supportedValuesOf('timeZone')) {
    const o = document.createElement('option');
    o.value = z;
    dl.appendChild(o);
  }

  model = await sync();          // first sync also returns the saved settings
  render();

  setInterval(render, 1000);     // tick the clocks
  setInterval(sync, 5 * 60000);  // refresh offsets across DST changes
}
init();

