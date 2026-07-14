// Presto's page is a thin mirror of the backend's job queue: every change
// arrives as a full 'jobs' snapshot and the list is rebuilt. All DOM is
// built with textContent — filenames must never become markup (the page
// holds an RPC channel with full system access).

const $ = (id) => document.getElementById(id);

const SEGMENTS = {
  image: [['png', 'PNG'], ['jpeg', 'JPEG'], ['heic', 'HEIC'], ['tiff', 'TIFF']],
  video: [['mp4', 'MP4'], ['gif', 'GIF'], ['m4a', 'M4A']],
};

let state = { jobs: [], ffmpeg: true, targets: { image: 'png', video: 'mp4' } };

// ------------------------------------------------------------------ prefs

function buildSegments() {
  for (const [kind, seg] of [['image', $('segImage')], ['video', $('segVideo')]]) {
    seg.textContent = '';
    for (const [value, label] of SEGMENTS[kind]) {
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
    if (b.dataset.kind === 'video') b.disabled = !state.ffmpeg;
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
      reveal.title = 'Reveal in Finder';
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

// Listeners are registered — now the backend can start talking.
tiny.api.call('boot').then((snap) => { state = snap; buildSegments(); paintPrefs(); paintJobs(); });
