// Deja frontend — a flipbook player over the frames the backend captures.
// Frames arrive one at a time as data URIs (with the real file path riding
// along for drag-out); a small LRU keeps scrubbing smooth without hoarding
// the whole day in memory. All text is rendered with textContent.

const $ = (id) => document.getElementById(id);

let model = { perm: 'undetermined', capturing: true, intervalSecs: 30, days: [], today: '' };
let curDay = null;
let frames = [];        // [{ name, time }]
let idx = -1;
let curFile = null;     // real path of the shown frame (drag-out)
let playing = 0;

// -------------------------------------------------------------- frame cache

const cache = new Map();               // 'day/name' -> { uri, file }
const CACHE_MAX = 90;

async function getFrame(day, name) {
  const key = day + '/' + name;
  if (cache.has(key)) return cache.get(key);
  const f = await tiny.api.call('frame', { day, name });
  cache.set(key, f);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return f;
}

function prefetch(from, n) {
  for (let i = from; i < Math.min(from + n, frames.length); i++) {
    getFrame(curDay, frames[i].name).catch(() => {});
  }
}

// ------------------------------------------------------------------- player

async function show(i) {
  if (!frames.length) {
    $('frame').hidden = true;
    $('frametime').hidden = true;
    $('noframes').hidden = false;
    $('noframes').textContent = model.capturing && model.perm === 'granted'
      ? 'No frames yet — the first one lands within ' + model.intervalSecs + ' s.'
      : 'No frames for this day.';
    $('pos').textContent = '–';
    curFile = null;
    return;
  }
  idx = Math.max(0, Math.min(i, frames.length - 1));
  $('slider').max = frames.length - 1;
  $('slider').value = idx;
  $('pos').textContent = `${idx + 1} / ${frames.length}`;
  const fr = frames[idx];
  try {
    const { uri, file } = await getFrame(curDay, fr.name);
    curFile = file;
    $('frame').src = uri;
    $('frame').hidden = false;
    $('noframes').hidden = true;
    $('frametime').hidden = false;
    $('frametime').textContent = fr.time;
  } catch { /* frame vanished (day cleared) */ }
  prefetch(idx + 1, playing ? 6 : 3);
  if (idx > 0) getFrame(curDay, frames[idx - 1].name).catch(() => {});
}

function stop() {
  clearInterval(playing);
  playing = 0;
  $('play').textContent = '▶';
}

function togglePlay() {
  if (playing) return stop();
  if (!frames.length) return;
  if (idx >= frames.length - 1) idx = -1;   // replay from the start
  $('play').textContent = '⏸';
  playing = setInterval(() => {
    if (idx >= frames.length - 1) return stop();
    show(idx + 1);
  }, 90);                                   // ~11 fps: an hour a minute at 30 s
}

// --------------------------------------------------------------------- days

function dayLabel(day) {
  if (day === model.today) return 'Today';
  const d = new Date(day + 'T12:00:00');
  const yest = new Date(Date.now() - 86400e3);
  if (day === `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderDays() {
  const wrap = $('days');
  wrap.textContent = '';
  const days = model.days.length ? model.days : [{ day: model.today, count: 0 }];
  for (const d of days) {
    const b = document.createElement('button');
    b.className = 'day' + (d.day === curDay ? ' on' : '');
    const t = document.createElement('span');
    t.textContent = dayLabel(d.day);
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = d.count;
    b.append(t, c);
    b.onclick = () => selectDay(d.day);
    wrap.appendChild(b);
  }
}

async function selectDay(day) {
  stop();
  curDay = day;
  $('daytitle').textContent = dayLabel(day) + ' · ' + day;
  frames = await tiny.api.call('frames', { day });
  renderDays();
  show(frames.length - 1);              // land on the newest frame
}

// -------------------------------------------------------------------- model

function paint() {
  const cap = $('capturing');
  cap.textContent = model.capturing ? '● Capturing' : '○ Paused';
  cap.classList.toggle('on', model.capturing);
  $('interval').value = String(model.intervalSecs);
  const total = model.days.reduce((n, d) => n + d.count, 0);
  $('stats').textContent = `${model.days.length} day${model.days.length === 1 ? '' : 's'} · ${total} frames · keeps a week`;
  $('gate').hidden = model.perm === 'granted';
}

async function refresh(keepDay) {
  model = await tiny.api.call('status');
  paint();
  renderDays();
  if (!keepDay || !curDay) await selectDay(curDay && model.days.some((d) => d.day === curDay) ? curDay : model.today);
}

// --------------------------------------------------------------------- boot

function boot() {
  $('play').onclick = togglePlay;
  $('slider').oninput = (e) => { stop(); show(Number(e.target.value)); };
  $('close').onclick = () => { stop(); tiny.api.call('hide'); };
  $('reveal').onclick = () => curDay && tiny.api.call('reveal', { day: curDay });
  $('clearday').onclick = async () => {
    if (!curDay) return;
    const ok = await tiny.win.confirm(`Delete all frames for ${dayLabel(curDay)}?`,
      { detail: 'This removes the jpg files from disk.', ok: 'Delete', cancel: 'Keep' });
    if (!ok) return;
    await tiny.api.call('clearDay', { day: curDay });
    cache.clear();
    refresh(false);
  };
  $('capturing').onclick = () => tiny.api.call('setCapturing', { on: !model.capturing });
  $('interval').onchange = (e) => tiny.api.call('setIntervalSecs', { secs: Number(e.target.value) });
  $('shotnow').onclick = () => tiny.api.call('shot').catch(() => {});
  $('gatebtn').onclick = () => tiny.api.call('request');
  $('gatesettings').onclick = () => tiny.api.call('openPrivacy');

  // Frameless window: the title bar is the drag handle.
  $('titlebar').addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    tiny.win.startDrag();
  });
  // The preview is the real jpg — drag it out of the app.
  $('frame').addEventListener('mousedown', () => {
    if (curFile) tiny.win.startDrag({ files: [curFile] });
  });
  $('frame').addEventListener('mouseenter', () => { $('dragtip').hidden = !curFile; });
  $('frame').addEventListener('mouseleave', () => { $('dragtip').hidden = true; });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') { stop(); tiny.api.call('hide'); }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    if (e.key === 'ArrowLeft') { stop(); show(idx - 1); }
    if (e.key === 'ArrowRight') { stop(); show(idx + 1); }
  });

  tiny.api.on('wake', () => refresh(true));
  tiny.api.on('perm', (p) => { model.perm = p; paint(); if (p === 'granted') refresh(true); });
  tiny.api.on('capturing', (on) => { model.capturing = on; paint(); });
  tiny.api.on('shot', async ({ day, name }) => {
    const known = model.days.find((d) => d.day === day);
    if (known) known.count++;
    else model.days.unshift({ day, count: 1 });
    paint();
    renderDays();
    if (day === curDay) {
      const follow = idx >= frames.length - 1 && !playing;
      frames.push({ name, time: name.slice(0, 8).replace(/-/g, ':') });
      if (follow) show(frames.length - 1);   // live mode: ride the newest frame
      else { $('slider').max = frames.length - 1; $('pos').textContent = `${idx + 1} / ${frames.length}`; }
    }
  });

  refresh(false);
}

boot();
