// Presto — drop a file, ✨ it's converted. A dropzone for images and video:
// drop on the window OR on the Dock icon (tinyjs.json "fileExtensions" makes
// Finder route those files here), pick a target format, done. Outputs land
// next to the source, never overwriting anything.
//
// The techniques on show:
//
//   1. Real-path drag & drop  — tiny.win.onDrop hands the page actual
//                               filesystem paths, not sandboxed blobs.
//   2. Dock / Open With drops — tiny.app.onOpenFiles (works cold-start too).
//   3. Spawn + progress       — images through macOS's built-in `sips`
//                               (instant); video through ffmpeg, parsing
//                               `time=` off its stderr into a live progress
//                               bar pushed to the page.
//   4. Click-to-reveal notify — app.notify when a job lands; clicking the
//                               banner runs `open -R` on the output.
//
// No ffmpeg installed? Images still work; video rows explain themselves.

const dec = new TextDecoder();

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'heic', 'heif', 'tiff', 'tif', 'gif', 'bmp', 'webp', 'psd', 'ico', 'jp2']);
const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'flv', 'mts', 'ts']);

// What we can convert *to*. sips formats are built into macOS; the video
// targets need ffmpeg (homebrew's usual spots are checked at startup —
// a Finder-launched .app doesn't inherit your shell PATH).
const TARGETS = {
  image: {
    png:  { label: 'PNG',  ext: 'png',  sips: ['png'] },
    jpeg: { label: 'JPEG', ext: 'jpg',  sips: ['jpeg', '-s', 'formatOptions', '85'] },
    heic: { label: 'HEIC', ext: 'heic', sips: ['heic'] },
    tiff: { label: 'TIFF', ext: 'tiff', sips: ['tiff'] },
  },
  video: {
    mp4: { label: 'MP4', ext: 'mp4' },
    gif: { label: 'GIF', ext: 'gif' },
    m4a: { label: 'M4A', ext: 'm4a' },   // just the audio track
  },
};

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
  for (const bin of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']) {
    try {
      const r = await run([bin, '-version']);
      if (r.ok) return bin;
    } catch { /* not there — next */ }
  }
  return null;
}

const ffprobeFor = (bin) => bin.replace(/ffmpeg$/, 'ffprobe');

function kindOf(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

// dir/base.ext, then dir/base-2.ext, -3… — never clobber anything.
async function uniqueOut(src, ext) {
  const dir = src.slice(0, src.lastIndexOf('/'));
  const base = src.split('/').pop().replace(/\.[^.]+$/, '');
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
      outName: j.out ? j.out.split('/').pop() : null,
      status: j.status, pct: j.pct, error: j.error || null,
    })),
    ffmpeg: !!ffmpeg,
    targets,
  };
}
const paint = (app) => app.push('jobs', snapshot());

function enqueue(paths, app) {
  for (const src of paths) {
    const kind = kindOf(src);
    const job = {
      id: seq++, src, name: src.split('/').pop(), kind,
      status: 'queued', pct: 0, out: null, error: null, targetLabel: '',
    };
    if (!kind) {
      job.status = 'error';
      job.error = 'not an image or video';
    } else if (kind === 'video' && !ffmpeg) {
      job.status = 'error';
      job.error = 'needs ffmpeg — brew install ffmpeg';
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
      body: job.out.split('/').pop(),
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
    if (job && job.out) tjs.spawn(['open', '-R', job.out], { stdout: 'ignore', stderr: 'ignore' });
    return true;
  },

  clearDone: (_p, app) => {
    jobs = jobs.filter((j) => j.status === 'queued' || j.status === 'working');
    paint(app);
    return true;
  },
};

// A banner was clicked — show the file it announced.
export function onNotificationClick(id, app) {
  if (id.startsWith('done:')) {
    tjs.spawn(['open', '-R', id.slice(5)], { stdout: 'ignore', stderr: 'ignore' });
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
