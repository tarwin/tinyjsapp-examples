// Pasta palette — search, arrow, ⏎ to copy. All DOM is built with
// textContent (clipboard text must never become markup: the page holds an
// RPC channel with full system access).

const $search = document.getElementById('search');
const $list = document.getElementById('list');
const $empty = document.getElementById('empty');
const $emptyText = document.getElementById('emptyText');
const $count = document.getElementById('count');
const $paused = document.getElementById('paused');

let items = [];
let total = 0;
let sel = 0;
let dialogUp = false;   // a native dialog steals focus; don't blur-hide then

// ------------------------------------------------------------------ helpers

function relTime(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

// One line of readable preview: collapse runs of whitespace, trim.
function previewOf(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

// ------------------------------------------------------------------- render

function render() {
  $list.textContent = '';
  items.forEach((it, i) => {
    const li = document.createElement('li');
    if (i === sel) li.classList.add('selected');

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = previewOf(it.preview);
    li.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const bits = [relTime(it.last_at), it.len.toLocaleString() + ' chars'];
    if (it.times > 1) bits.push('×' + it.times);
    meta.textContent = bits.join(' · ');
    li.appendChild(meta);

    const del = document.createElement('button');
    del.className = 'del';
    del.title = 'Delete (⌘⌫)';
    del.textContent = '✕';
    del.addEventListener('click', (e) => { e.stopPropagation(); removeAt(i); });
    li.appendChild(del);

    li.addEventListener('click', () => copyAt(i));
    li.addEventListener('mousemove', () => {
      if (sel !== i) { sel = i; paintSelection(); }
    });
    $list.appendChild(li);
  });

  const q = $search.value.trim();
  $empty.hidden = items.length > 0;
  $emptyText.textContent = q
    ? 'Nothing matches “' + q + '”.'
    : 'Copy something — it shows up here.';
  $count.textContent = q
    ? items.length + ' of ' + total + ' clips'
    : total + (total === 1 ? ' clip' : ' clips');
}

function paintSelection() {
  [...$list.children].forEach((el, i) => el.classList.toggle('selected', i === sel));
  const el = $list.children[sel];
  if (el) el.scrollIntoView({ block: 'nearest' });
}

// ------------------------------------------------------------------ actions

async function refresh() {
  const res = await tiny.api.call('list', { query: $search.value });
  items = res.rows;
  total = res.total;
  $paused.hidden = !res.paused;
  if (sel >= items.length) sel = Math.max(0, items.length - 1);
  render();
}

async function copyAt(i) {
  const it = items[i];
  if (!it) return;
  await tiny.api.call('copy', { id: it.id });   // backend pbcopies + hides us
}

async function removeAt(i) {
  const it = items[i];
  if (!it) return;
  await tiny.api.call('remove', { id: it.id });
  await refresh();
}

// --------------------------------------------------------------------- keys

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (sel < items.length - 1) { sel += 1; paintSelection(); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (sel > 0) { sel -= 1; paintSelection(); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    copyAt(sel);
  } else if (e.key === 'Backspace' && e.metaKey) {
    e.preventDefault();
    removeAt(sel);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if ($search.value) { $search.value = ''; sel = 0; refresh(); }
    else tiny.api.call('hide');
  } else if (e.target !== $search && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
    $search.focus();                  // type anywhere, land in the search box
  }
});

let debounce = 0;
$search.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { sel = 0; refresh(); }, 80);
});

// ------------------------------------------------------------------- events

// Summoned (hotkey, tray, or menu): reset and take the keyboard.
tiny.api.on('opened', ({ paused }) => {
  $paused.hidden = !paused;
  $search.value = '';
  sel = 0;
  refresh();
  $search.focus();
});

// The clipboard changed while we're visible — keep the list live.
tiny.api.on('changed', refresh);

tiny.api.on('model', ({ paused }) => { $paused.hidden = !paused; });

// Tray "Clear History…" routes through us for a native confirm.
tiny.api.on('confirm-clear', async () => {
  dialogUp = true;
  const ok = await tiny.win.confirm('Clear clipboard history?', {
    detail: 'All saved clips will be deleted. This cannot be undone.',
    ok: 'Clear History',
    cancel: 'Cancel',
  });
  dialogUp = false;
  $search.focus();
  if (ok) { await tiny.api.call('clear'); refresh(); }
});

// Click-out dismiss: losing focus hides the palette, like a real menu —
// unless it's our own confirm dialog doing the stealing.
window.addEventListener('blur', () => {
  if (!dialogUp) tiny.api.call('blurHide');
});

refresh();
$search.focus();
