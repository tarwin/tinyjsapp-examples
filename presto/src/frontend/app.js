// Presto's page is a thin mirror of the backend's job queue: every change
// arrives as a full 'jobs' snapshot and the list is rebuilt. All DOM is
// built with textContent — filenames must never become markup (the page
// holds an RPC channel with full system access).

const $ = (id) => document.getElementById(id);

// Fallback only — the real list comes from the backend snapshot's `segments`,
// so per-platform targets (e.g. no HEIC on Windows) need no client edits.
const SEGMENTS = {
  image: [['png', 'PNG'], ['jpeg', 'JPEG'], ['heic', 'HEIC'], ['tiff', 'TIFF']],
  video: [['mp4', 'MP4'], ['gif', 'GIF'], ['m4a', 'M4A']],
};

// Platform comes from the backend (it reads tjs.env.OS) via the snapshot's
// `win` flag — the page has no tjs and the tiny bridge exposes no OS field, so
// this beats sniffing navigator.userAgent.
let state = { jobs: [], ffmpeg: true, targets: { image: 'png', video: 'mp4' }, win: false };

// ------------------------------------------------------------------ prefs

function buildSegments() {
  for (const [kind, seg] of [['image', $('segImage')], ['video', $('segVideo')]]) {
    seg.textContent = '';
    const list = (state.segments && state.segments[kind]) || SEGMENTS[kind];
    for (const [value, label] of list) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = 'seg-btn';
      b.dataset.kind = kind;
      b.dataset.value = value;
      b.addEventListener('click', () =>
        tiny.api.call('setTarget', { kind, target: value }));
      seg.appendChild(b);
    }
  }
}

function paintPrefs() {
  for (const b of document.querySelectorAll('.seg-btn')) {
    b.classList.toggle('active', state.targets[b.dataset.kind] === b.dataset.value);
    // Video always needs ffmpeg; on Windows images do too (no sips there).
    if (b.dataset.kind === 'video' || state.win) b.disabled = !state.ffmpeg;
  }
  $('noFfmpeg').hidden = state.ffmpeg;
}

// ------------------------------------------------------------------- jobs

const KIND_ICON = { image: '🖼️', video: '🎬' };

function paintJobs() {
  const ul = $('jobs');
  ul.textContent = '';

  for (const j of [...state.jobs].reverse()) {       // newest on top
    const li = document.createElement('li');
    li.className = 'job ' + j.status;

    const icon = document.createElement('span');
    icon.className = 'job-icon';
    icon.textContent = j.status === 'done' ? '✨' : (KIND_ICON[j.kind] || '📄');
    li.appendChild(icon);

    const mid = document.createElement('div');
    mid.className = 'job-mid';

    const name = document.createElement('div');
    name.className = 'job-name';
    name.textContent = j.status === 'done' && j.outName ? j.outName : j.name;
    mid.appendChild(name);

    const sub = document.createElement('div');
    sub.className = 'job-sub';
    if (j.status === 'queued') sub.textContent = 'waiting · → ' + j.targetLabel;
    else if (j.status === 'working') sub.textContent = '→ ' + j.targetLabel + (j.pct ? ' · ' + j.pct + '%' : '…');
    else if (j.status === 'done') sub.textContent = 'from ' + j.name;
    else sub.textContent = j.error || 'failed';
    mid.appendChild(sub);

    if (j.status === 'working') {
      const bar = document.createElement('div');
      bar.className = 'bar' + (j.pct ? '' : ' indeterminate');
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      if (j.pct) fill.style.width = j.pct + '%';
      bar.appendChild(fill);
      mid.appendChild(bar);
    }
    li.appendChild(mid);

    if (j.status === 'done') {
      const reveal = document.createElement('button');
      reveal.className = 'job-act';
      reveal.title = state.win ? 'Reveal in Explorer' : 'Reveal in Finder';
      reveal.textContent = '🔍';
      reveal.addEventListener('click', () => tiny.api.call('reveal', { id: j.id }));
      li.appendChild(reveal);
    }
    ul.appendChild(li);
  }

  const done = state.jobs.filter((j) => j.status === 'done').length;
  const bad = state.jobs.filter((j) => j.status === 'error').length;
  const busy = state.jobs.length - done - bad;
  $('summary').textContent = state.jobs.length === 0 ? ''
    : [busy && busy + ' converting', done && done + ' done', bad && bad + ' failed']
        .filter(Boolean).join(' · ');
  $('clear').hidden = done + bad === 0;
  document.body.classList.toggle('has-jobs', state.jobs.length > 0);
}

// On Windows there's no sips (images need ffmpeg too) and no Dock — reword the
// mac-flavoured static copy so nothing references a tool/place that isn't here.
function applyPlatformCopy() {
  if (!state.win) return;
  const nf = $('noFfmpeg');
  nf.textContent = 'images & video need ffmpeg — ';
  const code = document.createElement('code');
  code.textContent = 'winget install ffmpeg';
  nf.appendChild(code);
  const sub = document.querySelector('.drop-sub');
  if (sub && sub.firstChild) sub.firstChild.textContent = 'or onto the taskbar — or ';
}

// ------------------------------------------------------------------ wiring

tiny.api.on('jobs', (snap) => { state = snap; paintPrefs(); paintJobs(); });

const send = (paths) => paths.length && tiny.api.call('enqueue', { paths });

tiny.win.onDrop(send);
// Finder / Dock-icon drops. Only accept media files — matching what
// fileExtensions declares also screens out dev-mode launch-arg noise.
const MEDIA = /\.(png|jpe?g|heic|heif|tiff?|gif|bmp|webp|psd|ico|jp2|mov|mp4|m4v|avi|mkv|webm|mpe?g|wmv|flv|mts|ts)$/i;
tiny.app.onOpenFiles((paths) => send(paths.filter((p) => MEDIA.test(p))));

$('browse').addEventListener('click', async () => {
  const paths = await tiny.win.openFiles();
  if (paths) send(paths);
});
$('drop').addEventListener('dblclick', async () => {
  const paths = await tiny.win.openFiles();
  if (paths) send(paths);
});

$('clear').addEventListener('click', () => tiny.api.call('clearDone'));

// Listeners are registered — now the backend can start talking. The boot
// snapshot carries the platform (`win`), so platform copy waits for it.
tiny.api.call('boot').then((snap) => {
  state = snap;
  applyPlatformCopy();
  buildSegments();
  paintPrefs();
  paintJobs();
});
