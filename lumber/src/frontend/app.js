// Lumber HUD — the backend streams batches of new lines ('lines' events);
// this page keeps a ring buffer, filters it live, and sticks to the bottom
// like tail -f. All DOM is built with textContent: log lines come from
// arbitrary files and must never become markup (the page holds an RPC
// channel with full system access).

const $ = (id) => document.getElementById(id);
const $lines = $('lines');
const $scroll = $('scroll');
const $filter = $('filter');

const MAX_LINES = 5000;          // ring buffer + at most this many DOM rows

let lines = [];                  // [{ text, lv }]
let counts = { error: 0, warn: 0 };
let levelOnly = null;            // 'error' | 'warn' | null (footer toggles)
let follow = true;               // stick to bottom until the user scrolls up
let shownTotal = 0;              // rows currently in the DOM (for the counter)

// ------------------------------------------------------------------ levels

function levelOf(text) {
  if (/\b(err(or)?|fatal|panic|exception|fail(ed|ure)?)\b/i.test(text)) return 'error';
  if (/\bwarn(ing)?\b/i.test(text)) return 'warn';
  if (/\b(debug|trace)\b/i.test(text)) return 'debug';
  return 'info';
}

// ------------------------------------------------------------------ render

function matches(l) {
  if (levelOnly && l.lv !== levelOnly) return false;
  const q = $filter.value.trim().toLowerCase();
  return !q || l.text.toLowerCase().includes(q);
}

function rowFor(l) {
  const div = document.createElement('div');
  div.className = 'line lv-' + l.lv;
  const q = $filter.value.trim();
  if (!q) {
    div.textContent = l.text;
    return div;
  }
  // Highlight filter hits — built from split parts, never from markup.
  const lower = l.text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  while (true) {
    const hit = lower.indexOf(needle, i);
    if (hit === -1) { div.appendChild(document.createTextNode(l.text.slice(i))); break; }
    if (hit > i) div.appendChild(document.createTextNode(l.text.slice(i, hit)));
    const m = document.createElement('mark');
    m.textContent = l.text.slice(hit, hit + q.length);
    div.appendChild(m);
    i = hit + q.length;
  }
  return div;
}

function renderAll() {
  $lines.textContent = '';
  const frag = document.createDocumentFragment();
  let shown = 0;
  for (const l of lines) {
    if (!matches(l)) continue;
    frag.appendChild(rowFor(l));
    shown += 1;
  }
  $lines.appendChild(frag);
  shownTotal = shown;
  paintCount();
  if (follow) snapToBottom();
}

function appendLines(batch) {
  const frag = document.createDocumentFragment();
  for (const l of batch) {
    if (!matches(l)) continue;
    frag.appendChild(rowFor(l));
    shownTotal += 1;
  }
  if (frag.childNodes.length) $lines.appendChild(frag);

  // Trim the DOM to match the ring buffer.
  while ($lines.childNodes.length > MAX_LINES) {
    $lines.removeChild($lines.firstChild);
    shownTotal -= 1;
  }
  paintCount();
  if (follow) snapToBottom();
}

function paintCount() {
  const filtered = $filter.value.trim() || levelOnly;
  $('count').textContent = filtered
    ? shownTotal.toLocaleString() + ' of ' + lines.length.toLocaleString() + ' lines'
    : lines.length.toLocaleString() + ' lines';
  $('nError').textContent = counts.error.toLocaleString();
  $('nWarn').textContent = counts.warn.toLocaleString();
  $('empty').hidden = lines.length > 0 || !!$('fname').dataset.path;
}

// ------------------------------------------------------------------ follow

function snapToBottom() {
  $scroll.scrollTop = $scroll.scrollHeight;
}

$scroll.addEventListener('scroll', () => {
  const atBottom = $scroll.scrollTop + $scroll.clientHeight >= $scroll.scrollHeight - 8;
  if (follow && !atBottom) { follow = false; $('follow').hidden = false; }
  else if (!follow && atBottom) { follow = true; $('follow').hidden = true; }
});

$('follow').addEventListener('click', () => {
  follow = true;
  $('follow').hidden = true;
  snapToBottom();
});

// ------------------------------------------------------------------ events

tiny.api.on('file', ({ path, name }) => {
  $('fname').textContent = name;
  $('fname').title = path;
  $('fname').dataset.path = path;
});

tiny.api.on('lines', ({ lines: batch, reset, note }) => {
  if (reset) {
    lines = [];
    counts = { error: 0, warn: 0 };
    $lines.textContent = '';
    shownTotal = 0;
  }
  const cooked = (batch || []).map((text) => ({ text, lv: levelOf(text) }));
  if (note) cooked.unshift({ text: '— ' + note + ' —', lv: 'meta' });
  for (const l of cooked) {
    if (l.lv === 'error') counts.error += 1;
    if (l.lv === 'warn') counts.warn += 1;
  }
  lines.push(...cooked);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  appendLines(cooked);
});

// The opening tail started mid-file — the first line is a fragment.
tiny.api.on('trim-first', () => {
  if (!lines.length) return;
  const first = lines[1] ? 1 : 0;       // keep the "showing last…" meta row
  lines.splice(first, 1);
  renderAll();
});

tiny.api.on('gone', () => {
  lines.push({ text: '— file disappeared —', lv: 'meta' });
  appendLines([lines[lines.length - 1]]);
});

tiny.api.on('ontop', ({ onTop }) => $('pin').classList.toggle('off', !onTop));

// ----------------------------------------------------------------- actions

async function openPath(path) {
  try { await tiny.api.call('open', { path }); }
  catch (e) { await tiny.win.alert('Could not open file', String(e.message || e)); }
}

$('openBtn').addEventListener('click', async () => {
  const path = await tiny.win.openFile();
  if (path) openPath(path);
});

$('demoBtn').addEventListener('click', () => tiny.api.call('demo'));

$('pin').addEventListener('click', async () => {
  const on = !$('pin').classList.contains('off');
  await tiny.api.call('setOnTop', { v: !on });
});

$('close').addEventListener('click', () => tiny.quit());

$('fname').addEventListener('click', () => {
  if ($('fname').dataset.path) tiny.api.call('reveal');
});

// Drops take any file (plenty of logs aren't named *.log); Finder's
// Open With only ever sends what fileExtensions declares.
tiny.win.onDrop((paths) => { if (paths[0]) openPath(paths[0]); });
tiny.app.onOpenFiles((paths) => {
  const p = paths.find((x) => /\.log$/i.test(x));
  if (p) openPath(p);
});

// ------------------------------------------------------------------- input

let debounce = 0;
$filter.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(renderAll, 60);
});

for (const btn of document.querySelectorAll('.lv')) {
  btn.addEventListener('click', () => {
    levelOnly = levelOnly === btn.dataset.lv ? null : btn.dataset.lv;
    for (const b of document.querySelectorAll('.lv')) {
      b.classList.toggle('active', b.dataset.lv === levelOnly);
    }
    renderAll();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($filter.value) { $filter.value = ''; renderAll(); }
    $filter.blur();
  } else if (e.key === 'f' && e.metaKey) {
    e.preventDefault();
    $filter.focus();
  } else if (e.target !== $filter && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
    $filter.focus();                    // type anywhere, land in the filter
  }
});

// ------------------------------------------------------------------- start

// Listeners above are registered; now it's safe for the backend to stream.
tiny.api.call('boot').then(({ onTop }) => {
  $('pin').classList.toggle('off', !onTop);
  paintCount();
});
