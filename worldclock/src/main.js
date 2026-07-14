// World Clock — a menu-bar clock that cycles through cities, plus a little
// translucent dropdown panel listing them all.
//
// Three tinyjs techniques carry the app:
//
//   1. Cycling tray title  — a 1-second ticker calls app.tray.set() with a
//                            different city each rotation, so the menu bar
//                            shows "Tokyo 4:45p" then "London 8:45p" and on.
//   2. Vibrancy dropdown   — a frameless window with the macOS "popover"
//                            material (see tinyjs.json "chrome"), positioned
//                            just under the menu bar on the tray click.
//   3. Click-out dismiss   — the panel hides itself when it loses focus
//                            (the page's window `blur`), like a real menu.
//
// A wrinkle worth calling out: txiki.js (the backend runtime) ships without
// `Intl`, so it can't turn a time zone into a wall-clock time on its own. The
// WebKit page *does* have full `Intl`, so it computes each city's current UTC
// offset (DST included) and hands the backend a table; the backend then does
// the clock with plain Date arithmetic. Frontend knows the zones, backend
// owns the tick — see api.sync below and app.js.

const ROTATE_SECS = 4;             // seconds each city sits in the menu bar

// Filled in by the frontend (api.sync): [{ key, short, flag, name, off }],
// where `off` is the city's current offset from UTC in minutes.
let cities = [];
let index = 0;                     // which city is on the menu bar right now
let tickN = 0;                     // 1-second ticks since cycling (re)started
let cycling = true;                // false = pinned to one city
let home = 'sf';                   // highlighted city; day labels are relative
let h24 = false;                   // 24-hour clock
let open = false;                  // is the panel showing?
let lastBlurHide = 0;              // ms timestamp of the last click-out dismiss

const two = (n) => String(n).padStart(2, '0');
const cityByKey = (k) => cities.find((c) => c.key === k);

// Wall-clock time for a city, from its UTC offset in minutes. No Intl needed:
// shift "now" by the offset and read the UTC fields of the result.
function clockFor(off) {
  const d = new Date(Date.now() + off * 60000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  if (h24) return two(h) + ':' + two(m);
  const hh = h % 12 || 12;
  return hh + ':' + two(m) + (h < 12 ? 'a' : 'p');
}

// The tray's right-click menu, rebuilt from live state.
function buildMenu() {
  const homeItems = cities.map((c) => ({
    id: 'home:' + c.key, label: c.flag + '  ' + c.name, checked: c.key === home,
  }));
  return [
    { id: 'title', label: 'World Clock', enabled: false },
    { separator: true },
    { id: 'cycle', label: cycling ? 'Pause Cycling' : 'Resume Cycling' },
    { id: 'open', label: 'Show Panel' },
    { separator: true },
    { id: 'home', label: 'Home City', submenu: homeItems },
    { id: 'h24', label: '24-Hour Clock', checked: h24 },
    { separator: true },
    { id: 'quit', label: 'Quit World Clock', key: 'q' },
  ];
}

// Technique #1: the whole tray item — title, icon, menu — resent each tick.
// Rebuilding is cheap, and the title is the point: it's what animates.
function paintTray(app) {
  const c = cities[index];
  const title = c ? c.short + '  ' + clockFor(c.off) : 'World Clock';
  app.tray.set({
    title,
    icon: 'sf:globe',
    tooltip: 'World Clock',
    primaryAction: true,          // left-click toggles the panel; menu on right
    menu: buildMenu(),
  });
}

// Tell the page what's structural (home/24h/cycling and which city is live),
// so it can highlight the right rows. Times themselves are the page's job.
function pushModel(app) {
  app.push('model', {
    home, h24, cycling,
    activeKey: cities[index] ? cities[index].key : null,
  });
}

function tick(app) {
  if (!cities.length) return;
  const prev = cities[index] ? cities[index].key : null;
  if (cycling) index = Math.floor(tickN / ROTATE_SECS) % cities.length;
  tickN += 1;
  paintTray(app);
  const now = cities[index] ? cities[index].key : null;
  // Nudge the panel only when the highlighted city actually changes.
  if (open && now !== prev) pushModel(app);
}

// --- the dropdown panel ------------------------------------------------
// Drop it just under the menu bar at the top-right, the way a status-bar
// popover falls. We don't know the tray item's exact x, so top-right (where
// the icon lives) is the honest approximation.
async function positionPanel(app) {
  try {
    const s = await app.getWinState();
    const sw = (s && s.screen && s.screen.width) || 1440;
    const w = (s && s.width) || 300;
    app.setPosition(sw - w - 8, 30);
  } catch { /* no window yet — center fallback is fine */ }
}

async function openPanel(app) {
  await positionPanel(app);
  app.show();
  open = true;
  pushModel(app);
}

function closePanel(app) {
  app.hide();
  open = false;
}

async function togglePanel(app) {
  if (open) { closePanel(app); return; }
  // If the panel just dismissed itself because this very click stole its
  // focus, swallow the click instead of immediately reopening.
  if (Date.now() - lastBlurHide < 300) { lastBlurHide = 0; return; }
  await openPanel(app);
}

function setHome(app, key) {
  if (!cityByKey(key)) return;
  home = key;
  app.store.set('home', home);
  paintTray(app);
  if (open) pushModel(app);
}

function toggle24(app) {
  h24 = !h24;
  app.store.set('h24', h24);
  paintTray(app);
  if (open) pushModel(app);
}

function toggleCycle(app) {
  cycling = !cycling;
  tickN = 0;                       // restart the rotation clock cleanly
  paintTray(app);                  // flip the menu label + title immediately
  if (open) pushModel(app);
}

// The page talks to the backend through these.
export const api = {
  // The page computed each zone's live UTC offset (with Intl, which the
  // backend lacks) and sends the city table here. First call starts the tick.
  sync: (list, app) => {
    if (Array.isArray(list) && list.length) {
      cities = list;
      if (!cityByKey(home)) home = cities[0].key;
      paintTray(app);
    }
    return { home, h24, cycling, activeKey: cities[index] ? cities[index].key : null };
  },
  setHome: (key, app) => (setHome(app, key), true),
  toggle24: (_p, app) => (toggle24(app), true),
  toggleCycle: (_p, app) => (toggleCycle(app), true),
  // The page lost focus (a click landed outside it) — dismiss like a menu.
  blurHide: (_p, app) => {
    if (open) { closePanel(app); lastBlurHide = Date.now(); }
    return true;
  },
};

// primaryAction: a bare left-click on the icon (id === null) toggles the panel.
export function onTray(id, app) {
  if (id === null) return togglePanel(app);
  if (id === 'open') return openPanel(app);        // menu item always shows it
  if (id === 'cycle') return toggleCycle(app);
  if (id === 'h24') return toggle24(app);
  if (id === 'quit') return app.quit();
  if (id && id.startsWith('home:')) return setHome(app, id.slice(5));
}

export function init(app) {
  // "activation": "accessory" — no Dock icon, window starts hidden. The tray
  // is the app; the panel only appears on demand and hides (never quits) when
  // it's closed or loses focus.
  app.setHideOnClose(true);

  Promise.all([app.store.get('home'), app.store.get('h24')]).then(([h, hh]) => {
    if (typeof h === 'string') home = h;
    if (typeof hh === 'boolean') h24 = hh;
  });

  // Placeholder until the page reports back with the city offsets.
  paintTray(app);
  setInterval(() => tick(app), 1000);
}
