// Matcha — a minimal "keep my Mac awake" menu-bar app.
//
// The whole app is one menu-bar icon that toggles Apple's built-in
// `caffeinate` on and off, with the menu reflecting live state. No Dock icon,
// no window in your face — the only UI is the tray menu (plus a small About
// window on demand). This is the canonical tinyjs *tray app* recipe:
//
//   tray.set() + setDockVisible(false) + setHideOnClose(true)
//
// and the one bit of real work — preventing sleep — is just a child process.

// Preset activation durations, à la Caffeine / KeepingYouAwake. `secs: 0` means
// "indefinitely" — stay awake until you turn it off or quit.
const DURATIONS = [
  { id: 'indef', label: 'Indefinitely', secs: 0 },
  { id: '5m',  label: '5 minutes',  secs: 5 * 60 },
  { id: '10m', label: '10 minutes', secs: 10 * 60 },
  { id: '15m', label: '15 minutes', secs: 15 * 60 },
  { id: '30m', label: '30 minutes', secs: 30 * 60 },
  { id: '1h',  label: '1 hour',   secs: 60 * 60 },
  { id: '2h',  label: '2 hours',  secs: 2 * 60 * 60 },
  { id: '5h',  label: '5 hours',  secs: 5 * 60 * 60 },
];

let proc = null;      // the running `caffeinate` child, or null while asleep
let current = null;   // the active DURATION, or null
let endsAt = null;    // ms timestamp it auto-stops, or null for indefinite

const active = () => proc !== null;

// Start (or restart) a keep-awake session for the given duration.
function activate(dur, app) {
  deactivate();                                   // replace any running session
  // -d: prevent the display from sleeping · -i: prevent system idle sleep.
  // -t <secs>: caffeinate exits on its own after the timeout.
  const args = ['-di'];
  if (dur.secs) args.push('-t', String(dur.secs));
  proc = tjs.spawn(['/usr/bin/caffeinate', ...args], { stdout: 'ignore', stderr: 'ignore' });
  current = dur;
  endsAt = dur.secs ? Date.now() + dur.secs * 1000 : null;

  // A timed session ends when caffeinate exits by itself — notice that and drop
  // back to "asleep" (unless we killed it to start a different session).
  const mine = proc;
  proc.wait().then(() => {
    if (proc !== mine) return;                    // superseded — ignore
    proc = null; current = null; endsAt = null;
    sync(app);
    app.notify({ title: 'Matcha', body: 'Timer finished — your Mac can sleep again.' });
  });

  sync(app);
}

// Stop the current session (kills caffeinate, which releases the sleep assertion).
function deactivate() {
  if (proc) proc.kill();
  proc = null; current = null; endsAt = null;
}

function toggle(app) {
  if (active()) { deactivate(); sync(app); }
  else activate(DURATIONS[0], app);               // click = keep awake indefinitely
}

const two = (n) => String(n).padStart(2, '0');
function clock(ms) {
  const d = new Date(ms);
  let h = d.getHours(); const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return h + ':' + two(d.getMinutes()) + ' ' + ap;
}

// The right-click menu, rebuilt from live state on every change (the status
// line and duration checkmark track reality — tinyjs 0.5.0 stateful menus).
// No toggle item: with primaryAction a plain left-click already toggles.
function buildMenu() {
  const status = !active() ? 'Your Mac can sleep'
    : endsAt ? 'Awake until ' + clock(endsAt)
    : 'Awake — indefinitely';
  return [
    { id: 'status', label: status, enabled: false },
    { separator: true },
    { id: 'act', label: 'Activate for', submenu: DURATIONS.map((d) => ({
      id: 'dur:' + d.id,
      label: d.label + (d.secs ? '' : ' (Default)'),
      checked: active() && current && current.id === d.id,
    })) },
    { separator: true },
    { id: 'about', label: 'About Matcha…', key: ',' },
    { id: 'quit', label: 'Quit Matcha', key: 'q' },
  ];
}

// Redraw the tray and push the same state to the About window (if it's open).
// 0.9.0: an SF Symbol icon (full cup awake / empty cup asleep — no shipped
// asset), and primaryAction so a left click toggles and the menu is on
// right-click, exactly like Caffeine.
function sync(app) {
  app.tray.set({
    icon: active() ? 'sf:cup.and.saucer.fill' : 'sf:cup.and.saucer',
    tooltip: active() ? 'Matcha — keeping your Mac awake' : 'Matcha — your Mac can sleep',
    primaryAction: true,
    menu: buildMenu(),
  });
  app.push('state', snapshot());
}

function snapshot() {
  return {
    active: active(),
    duration: current ? current.id : null,
    label: current ? current.label : null,
    endsAt,
  };
}

// The About window talks to the backend through these.
export const api = {
  snapshot: () => snapshot(),
  durations: () => DURATIONS.map(({ id, label, secs }) => ({ id, label, secs })),
  toggle: (_p, app) => (toggle(app), snapshot()),
  activate: ({ id }, app) => {
    const d = DURATIONS.find((x) => x.id === id);
    if (d) activate(d, app);
    return snapshot();
  },
  deactivate: (_p, app) => (deactivate(), sync(app), snapshot()),
  hideWindow: (_p, app) => (app.hide(), true),
};

// id === null is a left click (primaryAction) — the Caffeine-style toggle.
export function onTray(id, app) {
  if (id === null) return toggle(app);
  if (id === 'quit') { deactivate(); return app.quit(); }
  if (id === 'about') return app.show();
  if (id === 'status') return;
  if (id && id.startsWith('dur:')) {
    const d = DURATIONS.find((x) => 'dur:' + x.id === id);
    if (d) activate(d, app);
  }
}

export function init(app) {
  // "activation": "accessory" (tinyjs.json) already launched us with no Dock
  // icon and the window hidden — no flash. We just keep the close button from
  // quitting, so the About window hides instead when dismissed.
  app.setHideOnClose(true);
  sync(app);                   // draw the tray in its initial (asleep) state
}
