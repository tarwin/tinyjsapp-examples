// Deja — your workday on a scrub bar. A menu-bar agent quietly screenshots
// your screen every 30 seconds; open the window and slide back through the
// day like a flipbook. Wait, when did I start reading Wikipedia?
//
// One app, five tinyjs techniques (0.12 'screen' permission):
//
//   1. Screen Recording onboarding — app.permissions.check('screen') gates
//      the whole capture loop (without the grant, `screencapture` just fails:
//      "could not create image from display" — and older macOS silently
//      shoots wallpaper-only). request('screen') raises the system prompt,
//      and the gate screen polls check() until the user flips the switch.
//      Note: 'screen' reports denied-until-granted — there is no
//      'undetermined' (CGPreflightScreenCaptureAccess is a boolean).
//   2. The capture loop lives in the BACKEND — a 1 s heartbeat spawns
//      `screencapture -x` on schedule, `sips` shrinks each frame to 1280 px,
//      and frames land in Application Support as days/<date>/<time>.jpg.
//      The window can stay closed all day; the tray runs the show.
//   3. Frames cross the bridge as data URIs on demand — the scrubber asks
//      for one frame at a time and prefetches around the playhead, so
//      playback is a stress test of JSON-RPC throughput, not a memory hog.
//   4. Live tray state — the 🌀 menu shows ✓ Capturing, an interval radio
//      (10 s / 30 s / 1 m / 5 m), and Capture now; settings persist in
//      tiny.store. Each new shot pushes to the open window (follow-live).
//   5. Frames are real files — drag the big preview out of the window
//      (win.startDrag) to drop the jpg anywhere; ↗ reveals the day in
//      Finder. Days older than a week are pruned on launch.

const SUPPORT_DIR = tjs.env.HOME + '/Library/Application Support/art.tarwin.deja';
const DAYS_DIR = SUPPORT_DIR + '/days';
const FRAME_W = '1280';        // stored frame width (sips resample)
const KEEP_DAYS = 7;           // prune older days on launch
const INTERVALS = [10, 30, 60, 300];

let capturing = true;          // persisted; the tray toggle
let intervalSecs = 30;         // persisted
let perm = 'undetermined';     // last check('screen') result
let lastShot = 0;
let open = false;              // is the window showing?

// ------------------------------------------------------------------ spawning

async function run(cmd) {
  const proc = tjs.spawn(cmd, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  return (await proc.wait()).exit_status === 0;
}

// ------------------------------------------------------------------- helpers

const p2 = (n) => String(n).padStart(2, '0');
const dayStr = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const timeStr = (d) => `${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FRAME_RE = /^\d{2}-\d{2}-\d{2}\.jpg$/;

// Whatever the page sends only ever resolves inside our days folder.
function framePath(day, name) {
  if (!DAY_RE.test(day) || !FRAME_RE.test(name)) throw new Error('bad frame');
  return `${DAYS_DIR}/${day}/${name}`;
}

const b64encode = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

async function listDays() {
  const days = [];
  try {
    for await (const e of await tjs.readDir(DAYS_DIR)) {
      if (!DAY_RE.test(e.name)) continue;
      let count = 0;
      for await (const f of await tjs.readDir(DAYS_DIR + '/' + e.name)) {
        if (FRAME_RE.test(f.name)) count++;
      }
      days.push({ day: e.name, count });
    }
  } catch { /* nothing captured yet */ }
  days.sort((a, b) => (a.day < b.day ? 1 : -1));
  return days;
}

// --------------------------------------------------------------- the camera

async function checkPerm(app) {
  const before = perm;
  perm = await app.permissions.check('screen');
  if (perm !== before && open) app.push('perm', perm);
  return perm;
}

async function capture(app) {
  const d = new Date();
  const dir = DAYS_DIR + '/' + dayStr(d);
  const tmp = SUPPORT_DIR + '/shot.tmp.jpg';
  await run(['mkdir', '-p', dir]);
  // -x: no shutter sound. Main display; jpg keeps a day around ~100 MB.
  if (!(await run(['screencapture', '-x', '-t', 'jpg', tmp]))) return;
  const name = timeStr(d) + '.jpg';
  await run(['sips', '--resampleWidth', FRAME_W, tmp, '--out', dir + '/' + name]);
  await run(['rm', '-f', tmp]);
  lastShot = Date.now();
  if (open) app.push('shot', { day: dayStr(d), name });
}

async function prune() {
  const cutoff = dayStr(new Date(Date.now() - KEEP_DAYS * 86400e3));
  for (const { day } of await listDays()) {
    if (day < cutoff) await run(['rm', '-rf', DAYS_DIR + '/' + day]);
  }
}

// ---------------------------------------------------------------------- api

export const api = {
  status: async (_p, app) => ({
    perm: await checkPerm(app),
    capturing,
    intervalSecs,
    days: await listDays(),
    today: dayStr(new Date()),
  }),

  request: (_p, app) => app.permissions.request('screen'),

  openPrivacy: () =>
    run(['open', 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture']),

  setCapturing: ({ on }, app) => setCapturing(app, !!on),

  setIntervalSecs: ({ secs }, app) => {
    if (!INTERVALS.includes(secs)) throw new Error('bad interval');
    intervalSecs = secs;
    app.store.set('intervalSecs', secs);
    paintTray(app);
  },

  shot: async (_p, app) => {
    if ((await checkPerm(app)) !== 'granted') throw new Error('screen permission not granted');
    await capture(app);
  },

  frames: async ({ day }) => {
    if (!DAY_RE.test(day)) throw new Error('bad day');
    const frames = [];
    try {
      for await (const f of await tjs.readDir(DAYS_DIR + '/' + day)) {
        if (!FRAME_RE.test(f.name)) continue;
        frames.push({ name: f.name, time: f.name.slice(0, 8).replace(/-/g, ':') });
      }
    } catch { /* cleared under us */ }
    frames.sort((a, b) => (a.name < b.name ? -1 : 1));
    return frames;
  },

  frame: async ({ day, name }) => {
    const bytes = await tjs.readFile(framePath(day, name));
    return { uri: 'data:image/jpeg;base64,' + b64encode(bytes), file: framePath(day, name) };
  },

  clearDay: async ({ day }) => {
    if (!DAY_RE.test(day)) throw new Error('bad day');
    await run(['rm', '-rf', DAYS_DIR + '/' + day]);
  },

  reveal: ({ day }) => {
    if (!DAY_RE.test(day)) throw new Error('bad day');
    return run(['open', DAYS_DIR + '/' + day]);
  },

  hide: (_p, app) => { open = false; app.hide(); },
};

// --------------------------------------------------------------------- tray

function paintTray(app) {
  app.tray.set({
    icon: 'sf:clock.arrow.circlepath',
    tooltip: 'Deja — your day on a scrub bar',
    primaryAction: true,               // left-click opens; menu on right-click
    menu: [
      { id: 'title', label: 'Deja — Screen Time-Lapse', enabled: false },
      { separator: true },
      { id: 'open', label: 'Open Deja' },
      { id: 'shot', label: 'Capture Now' },
      { id: 'toggle', label: 'Capturing', checked: capturing },
      { separator: true },
      ...INTERVALS.map((s) => ({
        id: 'int:' + s,
        label: 'Every ' + (s < 60 ? s + ' s' : s / 60 + ' min'),
        checked: s === intervalSecs,
      })),
      { separator: true },
      { id: 'quit', label: 'Quit Deja' },
    ],
  });
}

function setCapturing(app, on) {
  capturing = on;
  app.store.set('capturing', on);
  paintTray(app);
  if (open) app.push('capturing', on);
}

function openWindow(app) {
  open = true;
  app.show();
  app.push('wake');                    // window refreshes its model
}

export function onTray(id, app) {
  if (id === null || id === 'open') return openWindow(app);
  if (id === 'shot') return capture(app);
  if (id === 'toggle') return setCapturing(app, !capturing);
  if (id?.startsWith('int:')) return api.setIntervalSecs({ secs: Number(id.slice(4)) }, app);
  if (id === 'quit') return app.quit();
}

// --------------------------------------------------------------------- init

export function init(app) {
  app.setHideOnClose(true);            // red ✗ hides; Deja lives in the tray

  Promise.all([app.store.get('capturing'), app.store.get('intervalSecs')]).then(([c, i]) => {
    if (c !== null) capturing = !!c;
    if (INTERVALS.includes(i)) intervalSecs = i;
    paintTray(app);
  });

  run(['mkdir', '-p', DAYS_DIR]).then(prune);
  checkPerm(app);

  // The heartbeat: capture when due. While the grant is missing, re-check
  // TCC every few seconds so the gate screen flips the moment the user
  // allows it (the backend pushes 'perm' on change).
  let tick = 0;
  setInterval(async () => {
    tick++;
    if (perm !== 'granted') {
      if (tick % 3 === 0) await checkPerm(app);
      return;
    }
    if (capturing && Date.now() - lastShot >= intervalSecs * 1000) await capture(app);
  }, 1000);

  openWindow(app);                     // accessory apps start hidden
}
