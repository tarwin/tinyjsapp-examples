// Matcha — a minimal "keep my machine awake" menu-bar / tray app.
//
// The whole app is one menu-bar icon that toggles sleep prevention on and
// off, with the menu reflecting live state. It launches as a menu-bar agent
// (tinyjs.json "activation": "accessory" — no Dock icon, no window, no
// flash); the only UI is the tray menu plus two windows opened on demand: a
// small About panel and a tabbed Settings window.
//
// The one bit of real work — preventing sleep — is per-platform: macOS runs
// Apple's built-in `caffeinate` as a child process; Windows calls
// SetThreadExecutionState via FFI (timed sessions are just a setTimeout).

import { Lib, CFunction, types } from 'tjs:ffi';

const IS_WIN = tjs.env.OS === 'Windows_NT';
const MACHINE = IS_WIN ? 'PC' : 'Mac';

// Windows sleep control: ES_CONTINUOUS keeps the flags applied until we clear
// them (or the process exits, which also releases the assertion — same
// lifetime guarantee killing caffeinate gives us on macOS).
let winAwake = null;
if (IS_WIN) {
  const k32 = new Lib('kernel32.dll');
  const STES = new CFunction(k32.symbol('SetThreadExecutionState'),
                             types.uint32, [types.uint32]);
  const ES_CONTINUOUS = 0x80000000, ES_SYSTEM = 0x1, ES_DISPLAY = 0x2;
  winAwake = (on, keepDisplay) => STES.call(
    on ? (ES_CONTINUOUS | ES_SYSTEM | (keepDisplay ? ES_DISPLAY : 0))
       : ES_CONTINUOUS);
}

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

// Persisted settings (the Settings window edits these; saved via tiny.store).
// A few are wired to real behavior; the rest mirror KeepingYouAwake's panels
// and simply persist — this is an example, not a full power-management suite.
const DEFAULTS = {
  activateOnLaunch: false,    // ✓ wired: start awake when Matcha launches
  startAtLogin: false,        //   persisted (a real app would write a LaunchAgent)
  defaultDuration: 'indef',   // ✓ wired: what a left-click activates
  allowDisplaySleep: false,   // ✓ wired: caffeinate -i (system only) vs -di (+ display)
  quitWhenDone: false,        // ✓ wired: quit when a timed session ends
  batteryGuard: false,        //   persisted (illustrative)
  batteryLevel: 20,           //   persisted (illustrative)
  lowPowerGuard: false,       //   persisted (illustrative)
  externalDisplay: false,     //   persisted (illustrative)
  deactivateOnSwitch: false,  //   persisted (illustrative)
  autoUpdate: true,           //   persisted (illustrative)
  preRelease: false,          //   persisted (illustrative)
};
let settings = { ...DEFAULTS };

const durById = (id) => DURATIONS.find((d) => d.id === id) || DURATIONS[0];

let proc = null;      // the running `caffeinate` child, or true on Windows
let timer = null;     // Windows: the setTimeout ending a timed session
let current = null;   // the active DURATION, or null
let endsAt = null;    // ms timestamp it auto-stops, or null for indefinite

const active = () => proc !== null;

// A timed session ran its full course — drop back to "asleep" and say so.
function sessionEnded(app) {
  proc = null; current = null; endsAt = null;
  if (settings.quitWhenDone) return app.quit();   // Advanced: quit when done
  sync(app);
  app.notify({ title: 'Matcha', body: `Timer finished — your ${MACHINE} can sleep again.` });
}

// Start (or restart) a keep-awake session for the given duration.
function activate(dur, app) {
  deactivate();                                   // replace any running session
  if (IS_WIN) {
    winAwake(true, !settings.allowDisplaySleep);
    proc = true;                                  // no child — a truthy marker
    if (dur.secs) timer = setTimeout(() => { winAwake(false); timer = null; sessionEnded(app); },
                                     dur.secs * 1000);
  } else {
    // -i: prevent system idle sleep · -d: also keep the display awake (dropped
    // when "Allow the display to sleep" is on). -t <secs>: caffeinate self-exits.
    const args = [settings.allowDisplaySleep ? '-i' : '-di'];
    if (dur.secs) args.push('-t', String(dur.secs));
    proc = tjs.spawn(['/usr/bin/caffeinate', ...args], { stdout: 'ignore', stderr: 'ignore' });

    // A timed session ends when caffeinate exits by itself — notice that and
    // drop back to "asleep" (unless we killed it to start a different session).
    const mine = proc;
    proc.wait().then(() => {
      if (proc !== mine) return;                  // superseded — ignore
      sessionEnded(app);
    });
  }
  current = dur;
  endsAt = dur.secs ? Date.now() + dur.secs * 1000 : null;
  sync(app);
}

// Stop the current session (kills caffeinate / clears the execution-state
// flags, which releases the sleep assertion).
function deactivate() {
  if (IS_WIN) {
    if (proc) winAwake(false);
    if (timer) clearTimeout(timer);
    timer = null;
  } else if (proc) proc.kill();
  proc = null; current = null; endsAt = null;
}

function toggle(app) {
  if (active()) { deactivate(); sync(app); }
  else activate(durById(settings.defaultDuration), app);   // click = the default duration
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
  const status = !active() ? `Your ${MACHINE} can sleep`
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
    { id: 'settings', label: 'Settings…', key: ',' },
    { id: 'about', label: 'About Matcha…' },
    { id: 'check-updates', label: 'Check for Updates…' },
    { id: 'quit', label: 'Quit Matcha', key: 'q' },
  ];
}

// Redraw the tray and push the same state to the About window (if it's open).
// 0.9.0: an SF Symbol icon (full cup awake / empty cup asleep — no shipped
// asset), and primaryAction so a left click toggles and the menu is on
// right-click, exactly like Caffeine.
function sync(app) {
  app.tray.set({
    // asset-free on both platforms: SF Symbols on macOS, emoji silhouettes
    // on Windows (full cup awake, zzz asleep)
    icon: IS_WIN ? (active() ? 'emoji:🍵' : 'emoji:💤')
                 : (active() ? 'sf:cup.and.saucer.fill' : 'sf:cup.and.saucer'),
    tooltip: active() ? `Matcha — keeping your ${MACHINE} awake` : `Matcha — your ${MACHINE} can sleep`,
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

// Both windows (About + Settings) talk to the backend through these.
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

  // --- settings ---
  getSettings: () => ({ ...settings }),
  setSetting: async ({ key, value }, app) => {
    if (key in settings) settings[key] = value;
    await app.store.set('settings', settings);
    // apply the one change that's visible immediately
    if (key === 'allowDisplaySleep' && active()) activate(current, app);
    return { ...settings };
  },
  // Hand a URL / settings-pane target to the OS opener (used by the About
  // links and the "Notification Settings…" button). The macOS notification
  // pref-pane URL maps to its ms-settings twin on Windows.
  openExternal: ({ target }) => {
    target = String(target);
    if (IS_WIN) {
      if (target.startsWith('x-apple.systempreferences:')) target = 'ms-settings:notifications';
      tjs.spawn(['cmd', '/c', 'start', '', target], { stdout: 'ignore', stderr: 'ignore' });
    } else {
      tjs.spawn(['open', target], { stdout: 'ignore', stderr: 'ignore' });
    }
    return true;
  },
};

// id === null is a left click (primaryAction) — the Caffeine-style toggle.
export function onTray(id, app) {
  if (id === 'check-updates') return checkForUpdates(app);
  if (id === null) return toggle(app);
  if (id === 'quit') { deactivate(); return app.quit(); }
  if (id === 'settings') {
    app.openWindow('settings', { page: 'settings.html', title: 'Matcha Settings', size: '540x470' });
    // accessory apps don't auto-order a new window front when inactive (e.g.
    // opened from the tray menu) — surface it explicitly, or it opens behind
    // and only appears once something else (About) activates the whole app.
    try { app.window('settings').show(); } catch (e) {}
    return;
  }
  if (id === 'about') return app.show();
  if (id === 'status') return;
  if (id && id.startsWith('dur:')) {
    const d = DURATIONS.find((x) => 'dur:' + x.id === id);
    if (d) activate(d, app);
  }
}

export async function init(app) {
  // "activation": "accessory" (tinyjs.json) already launched us with no Dock
  // icon and the window hidden — no flash. We just keep the close button from
  // quitting, so the About window hides instead when dismissed.
  app.setHideOnClose(true);
  settings = { ...DEFAULTS, ...(await app.store.get('settings')) };
  sync(app);                   // draw the tray in its initial (asleep) state
  if (settings.activateOnLaunch) activate(durById(settings.defaultDuration), app);
}


// ── self-update (uniform across the examples) ──────────────────────────────
// The runtime does the real work (sha256 + signature verified, swap +
// relaunch). "Check for Updates…" runs this; the daily background check
// just taps you on the shoulder via a notification.
async function checkForUpdates(app) {
  try {
    const r = await app.update.check();
    if (r && r.available) {
      app.notify('Updating…', 'v' + r.latest + ' is downloading — the app will relaunch.');
      await app.update.install();
    } else {
      app.notify("You're up to date", 'v' + ((r && r.current) || '') + ' is the latest.');
    }
  } catch (e) {
    app.notify('Update check failed', String((e && e.message) || e));
  }
}

export function onUpdateAvailable(info, app) {
  app.notify('Update available', 'v' + info.latest + ' is ready — use "Check for Updates…" to install.');
}
