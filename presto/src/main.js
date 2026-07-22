// Presto — drop a file, ✨ it's converted. A dropzone for images and video:
// drop on the window OR on the Dock icon / taskbar (tinyjs.json
// "fileExtensions" makes the OS route those files here), pick a target
// format, done. Outputs land next to the source, never overwriting anything.
//
// The techniques on show:
//
//   1. Real-path drag & drop  — tiny.win.onDrop hands the page actual
//                               filesystem paths, not sandboxed blobs.
//   2. Open-With / icon drops — tiny.app.onOpenFiles (works cold-start too).
//   3. Spawn + progress       — on macOS images go through the built-in
//                               `sips` (instant); on Windows there is no
//                               sips, so images go through ffmpeg too. Video
//                               is always ffmpeg, parsing `time=` off its
//                               stderr into a live progress bar.
//   4. Click-to-reveal notify — app.notify when a job lands; clicking the
//                               banner reveals the output (`open -R` on mac,
//                               explorer /select on Windows).
//
// No ffmpeg? On macOS images still work via sips and only video rows explain
// themselves; on Windows both need ffmpeg — winget install ffmpeg.

const IS_WIN = tjs.env.OS === 'Windows_NT';  // txiki has no tjs.platform
const dec = new TextDecoder();

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'heic', 'heif', 'tiff', 'tif', 'gif', 'bmp', 'webp', 'psd', 'ico', 'jp2']);
const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'flv', 'mts', 'ts']);

// What we can convert *to*. On macOS images use the built-in `sips`; on
// Windows there is no sips so images run through ffmpeg (the `ff` args are the
// output-format flags — ffmpeg picks the encoder from the extension). Video
// always needs ffmpeg (its usual install spots are checked at startup — a
// Finder/Explorer-launched app doesn't inherit your shell PATH).
const TARGETS = {
  image: {
    png:  { label: 'PNG',  ext: 'png',  sips: ['png'],                            ff: [] },
    jpeg: { label: 'JPEG', ext: 'jpg',  sips: ['jpeg', '-s', 'formatOptions', '85'], ff: ['-q:v', '3'] },
    heic: { label: 'HEIC', ext: 'heic', sips: ['heic'],                           ff: ['-c:v', 'libx265'] },
    tiff: { label: 'TIFF', ext: 'tiff', sips: ['tiff'],                           ff: [] },
  },
  video: {
    mp4: { label: 'MP4', ext: 'mp4' },
    gif: { label: 'GIF', ext: 'gif' },
    m4a: { label: 'M4A', ext: 'm4a' },   // just the audio track
  },
};

// Windows ffmpeg builds generally can't encode HEIC — don't offer it there.
if (IS_WIN) delete TARGETS.image.heic;

let targets = { image: 'png', video: 'mp4' };  // current pick, persisted
let ffmpeg = null;                             // resolved binary path or null
let jobs = [];
let seq = 1;
let running = false;

// ------------------------------------------------------------------ helpers

async function run(args) {
  const proc = tjs.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let out = '', err = '';
  const drain = async (stream, sink) => {
    const reader = stream.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sink(dec.decode(value));
      }
    } catch { /* stream closed with the process */ }
  };
  await Promise.all([
    drain(proc.stdout, (s) => { out += s; }),
    drain(proc.stderr, (s) => { err += s; }),
  ]);
  const status = await proc.wait();
  return { ok: status.exit_status === 0, out, err };
}

async function findFfmpeg() {
  const candidates = IS_WIN
    ? ['ffmpeg',
       (tjs.env.LOCALAPPDATA || '') + '\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
       'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe']
    : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];
  for (const bin of candidates) {
    try {
      const r = await run([bin, '-version']);
      if (r.ok) return bin;
    } catch { /* not there — next */ }
  }
  return null;
}

// Windows binaries carry a .exe — keep it when deriving the sibling ffprobe.
const ffprobeFor = (bin) => bin.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

function kindOf(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

// dir/base.ext, then dir/base-2.ext, -3… — never clobber anything.
async function uniqueOut(src, ext) {
  const dir = src.slice(0, Math.max(src.lastIndexOf('/'), src.lastIndexOf('\\')));
  const base = src.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  for (let n = 1; ; n++) {
    const candidate = dir + '/' + base + (n === 1 ? '' : '-' + n) + '.' + ext;
    try { await tjs.stat(candidate); } catch { return candidate; }
  }
}

// ------------------------------------------------------------------- queue

function snapshot() {
  return {
    jobs: jobs.map((j) => ({
      id: j.id, name: j.name, kind: j.kind, targetLabel: j.targetLabel,
      outName: j.out ? j.out.split(/[\\/]/).pop() : null,
      status: j.status, pct: j.pct, error: j.error || null,
    })),
    ffmpeg: !!ffmpeg,
    targets,
    win: IS_WIN,   // the backend knows the platform (tjs.env.OS); tell the page
    // The page renders the format buttons from this — so dropping a target
    // (e.g. HEIC on Windows) here removes it from the UI, no client edits.
    segments: {
      image: Object.entries(TARGETS.image).map(([v, t]) => [v, t.label]),
      video: Object.entries(TARGETS.video).map(([v, t]) => [v, t.label]),
    },
  };
}
const paint = (app) => app.push('jobs', snapshot());

function enqueue(paths, app) {
  for (const src of paths) {
    const kind = kindOf(src);
    const job = {
      id: seq++, src, name: src.split(/[\\/]/).pop(), kind,
      status: 'queued', pct: 0, out: null, error: null, targetLabel: '',
    };
    // Video always needs ffmpeg; on Windows images do too (no sips there).
    const needsFfmpeg = kind === 'video' || (IS_WIN && kind === 'image');
    if (!kind) {
      job.status = 'error';
      job.error = 'not an image or video';
    } else if (needsFfmpeg && !ffmpeg) {
      job.status = 'error';
      job.error = 'needs ffmpeg — ' + (IS_WIN ? 'winget install ffmpeg' : 'brew install ffmpeg');
    } else {
      const t = TARGETS[kind][targets[kind]];
      job.target = targets[kind];
      job.targetLabel = t.label;
    }
    jobs.push(job);
  }
  paint(app);
  pump(app);
}

// One job at a time — parallel ffmpeg runs would just fight over cores.
async function pump(app) {
  if (running) return;
  const job = jobs.find((j) => j.status === 'queued');
  if (!job) return;
  running = true;
  job.status = 'working';
  paint(app);
  try {
    if (job.kind === 'image') await convertImage(job);
    else await convertVideo(job, app);
    job.status = 'done';
    job.pct = 100;
    app.notify({
      id: 'done:' + job.out,
      title: '✨ Presto — converted',
      body: job.out.split(/[\\/]/).pop(),
      sound: false,
    });
  } catch (e) {
    job.status = 'error';
    job.error = String(e.message || e).slice(0, 300);
  }
  paint(app);
  running = false;
  pump(app);                       // next in line
}

async function convertImage(job) {
  const t = TARGETS.image[job.target];
  job.out = await uniqueOut(job.src, t.ext);

  // Windows has no sips — encode with ffmpeg (picks the codec from the ext).
  if (IS_WIN) {
    const r = await run([ffmpeg, '-i', job.src, ...t.ff, '-y', job.out]);
    if (!r.ok) {
      throw new Error((r.err || r.out).trim().split('\n').pop() || 'ffmpeg failed');
    }
    return;
  }

  const r = await run(['sips', '-s', 'format', ...t.sips, job.src, '--out', job.out]);
  // sips reports problems on stdout as often as stderr, and sometimes
  // "succeeds" with an Error: line — treat any of that as failure.
  const noise = (r.err + r.out).trim();
  if (!r.ok || /error/i.test(noise)) {
    throw new Error(noise.split('\n').pop() || 'sips failed');
  }
}

async function convertVideo(job, app) {
  const t = TARGETS.video[job.target];
  job.out = await uniqueOut(job.src, t.ext);

  // Duration first (ffprobe ships alongside ffmpeg) so time= becomes a %.
  let duration = null;
  try {
    const p = await run([ffprobeFor(ffmpeg), '-v', 'error',
      '-show_entries', 'format=duration', '-of', 'csv=p=0', job.src]);
    if (p.ok) duration = parseFloat(p.out) || null;
  } catch { /* fine — indeterminate bar */ }

  const args = job.target === 'mp4'
    ? ['-i', job.src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
       '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-y', job.out]
    : job.target === 'gif'
    ? ['-i', job.src,
       '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
       '-y', job.out]
    : ['-i', job.src, '-vn', '-c:a', 'aac', '-b:a', '192k', '-y', job.out];

  const proc = tjs.spawn([ffmpeg, ...args], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });

  // ffmpeg narrates on stderr: "…time=00:00:04.32 bitrate=…" every chunk.
  let tail = '';
  const reader = proc.stderr.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      tail = (tail + dec.decode(value)).slice(-2000);
      const m = [...tail.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
      if (m && duration) {
        const secs = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
        const pct = Math.min(99, Math.round((secs / duration) * 100));
        if (pct !== job.pct) { job.pct = pct; paint(app); }
      }
    }
  } catch { /* closed with the process */ }

  const status = await proc.wait();
  if (status.exit_status !== 0) {
    const lines = tail.trim().split('\n');
    throw new Error(lines.pop() || 'ffmpeg failed');
  }
}

// ----------------------------------------------------------------------- api

export const api = {
  boot: async (_p, app) => {
    const saved = await app.store.get('targets');
    if (saved && TARGETS.image[saved.image] && TARGETS.video[saved.video]) targets = saved;
    if (ffmpeg === null) ffmpeg = await findFfmpeg();
    return snapshot();
  },

  enqueue: ({ paths }, app) => (enqueue(paths || [], app), true),

  setTarget: ({ kind, target }, app) => {
    if (TARGETS[kind] && TARGETS[kind][target]) {
      targets[kind] = target;
      app.store.set('targets', targets);
    }
    paint(app);
    return true;
  },

  reveal: ({ id }) => {
    const job = jobs.find((j) => j.id === id);
    if (job && job.out) revealInFileManager(job.out);
    return true;
  },

  clearDone: (_p, app) => {
    jobs = jobs.filter((j) => j.status === 'queued' || j.status === 'working');
    paint(app);
    return true;
  },
};

// Reveal a file in the OS file manager. macOS: `open -R`. Windows: explorer
// /select, which wants backslashes and often exits nonzero — ignore status.
function revealInFileManager(path) {
  const cmd = IS_WIN
    ? ['explorer', '/select,' + path.replace(/\//g, '\\')]
    : ['open', '-R', path];
  tjs.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
}

// A banner was clicked — show the file it announced.
export function onNotificationClick(id, app) {
  if (id.startsWith('done:')) {
    revealInFileManager(id.slice(5));
    app.show();
  }
}

export function init(app) {
  app.setMenu([{ title: 'Help', items: [{ id: 'check-updates', label: 'Check for Updates…' }] }]);
  // Nothing to do — the page calls api.boot once its listeners are up, and
  // files from Finder arrive through the page's tiny.app.onOpenFiles.
}


export function onMenu(id, app) {
  if (id === 'check-updates') checkForUpdates(app);
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
