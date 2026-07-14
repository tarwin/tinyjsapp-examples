// Tomato — a silly, tomato-shaped Pomodoro timer.
//
// The backend owns the clock: it ticks once a second, counts down the current
// phase, and keeps the menu-bar item in sync. Three tinyjs techniques carry
// the whole app:
//
//   1. Live tray title      — app.tray.set({ title }) every second, so the
//                             countdown ticks right there in the menu bar.
//   2. In-place menu patch  — app.updateMenuItem('toggle', { label }) flips
//                             Pause↔Resume without rebuilding the tray menu.
//   3. Click-to-open notify  — app.notify({ id }) when a phase ends; clicking
//                             the banner (onNotificationClick) pops the tomato
//                             back up and rolls into the next phase.
//
// The window itself is the fun part: a transparent, frameless round tomato
// (see tinyjs.json "chrome") that floats on the desktop — no square edges.

// Classic Pomodoro phases. A long break lands after every LONG_EVERY focus
// sessions; everything else alternates focus ↔ short break.
const PHASES = {
  focus: { label: 'Focus',       mins: 25, sf: 'sf:timer' },
  short: { label: 'Short Break', mins: 5,  sf: 'sf:leaf.fill' },
  long:  { label: 'Long Break',  mins: 15, sf: 'sf:leaf.fill' },
};
const LONG_EVERY = 4;

let phase = 'focus';
let remaining = PHASES.focus.mins * 60; // seconds left in this phase
let running = false;
let ticker = null;                      // the setInterval handle while running
let done = 0;                           // focus sessions finished this cycle

const info = () => PHASES[phase];
const total = () => info().mins * 60;

const two = (n) => String(n).padStart(2, '0');
const fmt = (s) => two(Math.floor(s / 60)) + ':' + two(s % 60);

// What a plain "next" does: focus → (long every 4th) → back to focus.
function nextPhase() {
  if (phase !== 'focus') return 'focus';
  return (done + 1) % LONG_EVERY === 0 ? 'long' : 'short';
}
const nextLabel = () => PHASES[nextPhase()].label;

// The tray's right-click menu, rebuilt from live state.
function buildMenu() {
  const toggleLabel = running ? 'Pause'
    : remaining < total() ? 'Resume'
    : 'Start ' + info().label;
  return [
    { id: 'status', label: info().label + ' · ' + fmt(remaining), enabled: false },
    { separator: true },
    { id: 'toggle', label: toggleLabel },
    { id: 'skip', label: 'Skip to ' + nextLabel() },
    { id: 'reset', label: 'Reset' },
    { separator: true },
    { id: 'show', label: 'Show Tomato' },
    { id: 'quit', label: 'Quit Tomato', key: 'q' },
  ];
}

// Full repaint: the ticking countdown as the menu-bar title + the whole menu.
// Called every second while running, and on any structural change.
function paint(app) {
  app.tray.set({
    title: fmt(remaining),
    icon: info().sf,
    tooltip: 'Tomato — ' + info().label,
    primaryAction: true,          // left-click toggles; menu on right-click
    menu: buildMenu(),
  });
  app.push('state', snapshot());
}

function snapshot() {
  return {
    phase, label: info().label, mins: info().mins,
    total: total(), remaining, running, done, longEvery: LONG_EVERY,
  };
}

function tick(app) {
  remaining -= 1;
  if (remaining <= 0) return finishPhase(app);
  paint(app);
}

function play(app) {
  if (running) return;
  running = true;
  ticker = setInterval(() => tick(app), 1000);
  paint(app);                     // repaint → toggle reads "Pause", status live
}

// Pausing is where technique #2 earns its keep: the timer stops ticking, so
// nothing is repainting the tray. Instead of a full tray.set (which would also
// resend the icon + whole menu), we patch just the two items that changed,
// in place — the frozen countdown stays put in the title.
function pause(app) {
  if (!running) return;
  running = false;
  clearInterval(ticker); ticker = null;
  app.updateMenuItem('toggle', { label: 'Resume' });
  app.updateMenuItem('status', { label: info().label + ' · Paused' });
  app.push('state', snapshot());
}

function toggle(app) { running ? pause(app) : play(app); }

function reset(app) {
  running = false;
  clearInterval(ticker); ticker = null;
  remaining = total();
  paint(app);
}

// Move to a specific phase, freshly reset and stopped.
function goTo(app, next) {
  running = false;
  clearInterval(ticker); ticker = null;
  phase = next;
  remaining = total();
  paint(app);
}

function skip(app) { goTo(app, nextPhase()); }

// A phase ran out. Advance, then nudge the human with a notification whose
// click brings the tomato back and starts the next round.
function finishPhase(app) {
  clearInterval(ticker); ticker = null;
  running = false;
  const wasFocus = phase === 'focus';
  if (wasFocus) done += 1;
  phase = nextPhase();
  remaining = total();

  const [title, body] = wasFocus
    ? ['🍅 Nice — time to breathe', 'Focus done. ' + info().label + ' for ' + info().mins + ' min?']
    : ['🌱 Break over', 'Back to it — click to start focusing.'];
  // id ties the banner to onNotificationClick below. Real banners (app icon,
  // click-through) need a packaged build; `tinyjs dev` falls back to a plain
  // osascript banner with no click.
  app.notify({ id: 'phase-done', title, body, sound: true });

  paint(app);
}

// Both the window buttons and the tray talk to the backend through these.
export const api = {
  state: () => snapshot(),
  toggle: (_p, app) => (toggle(app), snapshot()),
  reset: (_p, app) => (reset(app), snapshot()),
  skip: (_p, app) => (skip(app), snapshot()),
  hide: (_p, app) => (app.hide(), true),
};

// primaryAction: a bare left-click on the icon (id === null) toggles.
export function onTray(id, app) {
  if (id === null || id === 'toggle') return toggle(app);
  if (id === 'skip') return skip(app);
  if (id === 'reset') return reset(app);
  if (id === 'show') return app.show();
  if (id === 'quit') return app.quit();
}

// Technique #3: the banner was clicked — surface the tomato and get going.
export function onNotificationClick(_id, app) {
  app.show();
  play(app);
}

export function init(app) {
  // "activation": "accessory" launched us with no Dock icon and the window
  // hidden. The tomato *is* the app, so reveal it; closing it just hides.
  app.setHideOnClose(true);
  app.show();
  paint(app);
}
