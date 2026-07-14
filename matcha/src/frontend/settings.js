// Matcha — Settings window. A second native window (0.8.0 multi-window) sharing
// the one backend. Every control reads/writes tiny.store via the backend's
// getSettings / setSetting; a few drive real behavior (see main.js DEFAULTS).

const $ = (id) => document.getElementById(id);
let settings = {};
let durations = [];

/* ── tabs ── */
function tabTo(name) {
  for (const b of $('setTabs').children) b.classList.toggle('on', b.dataset.tab === name);
  for (const p of document.querySelectorAll('.set-panel')) p.classList.toggle('on', p.id === 'tab-' + name);
}
$('setTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) tabTo(b.dataset.tab);
});

/* ── persist a change through the backend ── */
async function save(key, value) {
  settings = await tiny.api.call('setSetting', { key, value });
}

// Reflect every data-key control from the loaded settings.
function renderControls() {
  for (const el of document.querySelectorAll('[data-key]')) {
    const key = el.dataset.key;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else if (el.type === 'range') el.value = settings[key];
  }
  $('batVal').textContent = settings.batteryLevel + '%';
}

// Checkboxes + slider — one delegated handler.
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-key]');
  if (!el) return;
  if (el.type === 'checkbox') save(el.dataset.key, el.checked);
  else if (el.type === 'range') save(el.dataset.key, Number(el.value));
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('input[type="range"][data-key]');
  if (el) $('batVal').textContent = el.value + '%';
});

/* ── activation-duration list (pick the default) ── */
function renderDurations() {
  $('durList').replaceChildren();
  for (const d of durations) {
    const row = document.createElement('button');
    row.className = 'dur-row' + (settings.defaultDuration === d.id ? ' on' : '');
    const name = document.createElement('span');
    name.textContent = d.secs === 0 ? 'Indefinitely' : d.label;
    row.append(name);
    if (settings.defaultDuration === d.id) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Default';
      row.append(badge);
    }
    row.addEventListener('click', async () => { await save('defaultDuration', d.id); renderDurations(); });
    $('durList').append(row);
  }
}

/* ── buttons / links (routed through macOS `open`) ── */
const open = (target) => tiny.api.call('openExternal', { target });
$('notifBtn').addEventListener('click', () => open('x-apple.systempreferences:com.apple.Notifications-Settings.extension'));
$('ghLink').addEventListener('click', (e) => { e.preventDefault(); open('https://github.com/tarwin/tinyjsapp-examples'); });
$('tjLink').addEventListener('click', (e) => { e.preventDefault(); open('https://tinyjs.app'); });
$('checkBtn').addEventListener('click', () => { $('upMsg').textContent = 'You are up to date — no update URL configured (demo).'; });
$('closeBtn').addEventListener('click', () => tiny.win.close());

/* ── live status footer (same broadcast the tray + About window get) ── */
function renderFoot(s) {
  $('footState').textContent = !s.active ? '💤 your Mac can sleep'
    : s.endsAt ? '🍵 keeping awake' : '🍵 awake — indefinitely';
}
tiny.api.on('state', renderFoot);

async function init() {
  tiny.win.setResizable(false);          // fixed-size settings window
  settings = await tiny.api.call('getSettings');
  durations = await tiny.api.call('durations');
  renderControls();
  renderDurations();
  try {
    const info = await tiny.app.info();
    $('ver').textContent = 'version ' + info.version + ' · built with tinyjs ' + info.tinyjs;
  } catch { $('ver').textContent = ''; }
  renderFoot(await tiny.api.call('snapshot'));
}
init();
