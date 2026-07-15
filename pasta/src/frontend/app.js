// Pasta palette — search, arrow, ⏎ to copy. All DOM is built with
// textContent (clipboard text must never become markup: the page holds an
// RPC channel with full system access).

const $search = document.getElementById('search');
const $list = document.getElementById('list');
const $empty = document.getElementById('empty');
const $emptyText = document.getElementById('emptyText');
const $count = document.getElementById('count');
const $paused = document.getElementById('paused');
const $preview = document.getElementById('preview');
const $pvImg = document.getElementById('pvImg');
const $pvMeta = document.getElementById('pvMeta');

let items = [];
let total = 0;
let sel = 0;
let dialogUp = false;   // a native dialog steals focus; don't blur-hide then
let previewItem = null; // the image clip currently shown full-size, or null

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

function prettyBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

const basename = (p) => p.slice(p.lastIndexOf('/') + 1) || p;

function shortDir(path) {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  const home = dir.match(/^\/Users\/[^/]+/);
  return home ? '~' + dir.slice(home[0].length) : dir;
}

// ------------------------------------------------------------------- render

// The first line of a row, by kind: an image clip shows its thumbnail (a
// data URI from our own backend), a files clip shows the basenames, a text
// clip shows the text. All text lands via textContent — clipboard content
// must never become markup.
// Image and files clips can be dragged OUT of the palette — real files, into
// Finder, Slack, anywhere. The grab handle is the thumbnail / the 🗂 glyph.
// startDrag only fires once the pointer actually MOVES past a small threshold:
// a plain click is left alone so it can fall through to the row (a click that
// started a native drag never lands, leaving the drag ghost stuck on screen).
function dragHandle(node, it) {
  node.classList.add('draggable');
  node.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !it.drag || !it.drag.length) return;
    const sx = e.clientX, sy = e.clientY;
    const cleanup = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', cleanup);
    };
    const move = (ev) => {
      if (Math.abs(ev.clientX - sx) < 5 && Math.abs(ev.clientY - sy) < 5) return;
      cleanup();
      tiny.win.startDrag({ files: it.drag });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', cleanup);
  });
}

function rowBody(it) {
  if (it.kind === 'image' && it.thumb) {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = it.thumb;
    img.alt = '';
    img.draggable = false;               // native drag-out, not the DOM kind
    dragHandle(img, it);
    return img;
  }
  // A files clip: a Quick Look thumbnail of the first file (0.16,
  // app.thumbnail — any format) when we got one, else the 🗂 glyph. The
  // basename run reads alongside it; the preview image is the drag handle.
  if (it.kind === 'files') {
    const wrap = document.createElement('div');
    wrap.className = 'files-row';
    const names = it.preview.split('\n').map(basename).filter(Boolean);
    if (it.fthumb) {
      const img = document.createElement('img');
      img.className = 'thumb filethumb';
      img.src = it.fthumb;
      img.alt = '';
      img.draggable = false;
      dragHandle(img, it);
      wrap.appendChild(img);
    } else {
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.textContent = '🗂';
      dragHandle(glyph, it);
      wrap.appendChild(glyph);
    }
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = names.join('  ·  ');
    wrap.appendChild(text);
    return wrap;
  }
  const text = document.createElement('div');
  text.className = 'text';
  if (it.kind === 'image') {
    text.textContent = '🖼 ' + previewOf(it.preview);   // thumbnail went missing
  } else if (it.kind === 'color') {
    const dot = document.createElement('span');
    dot.className = 'swatch';
    if (/^#[0-9A-F]{6}([0-9A-F]{2})?$/i.test(it.preview)) dot.style.background = it.preview;
    text.appendChild(dot);
    text.appendChild(document.createTextNode(' ' + previewOf(it.preview)));
  } else {
    text.textContent = previewOf(it.preview);
  }
  return text;
}

function rowMeta(it) {
  const m = it.meta || {};
  const bits = [];
  if (it.pinned) bits.push('📌');
  bits.push(relTime(it.last_at));
  if (it.kind === 'image') {
    if (m.w) bits.push(m.w + '×' + m.h);
    if (m.bytes) bits.push(prettyBytes(m.bytes));
  } else if (it.kind === 'files') {
    bits.push((m.count || 1) + (m.count > 1 ? ' items' : ' item'));
    const first = it.preview.split('\n')[0];
    if (first) bits.push(shortDir(first));
  } else if (it.kind === 'color') {
    if (m.alpha != null) bits.push(Math.round(m.alpha * 100) + '% alpha');
  } else {
    bits.push(it.len.toLocaleString() + ' chars');
  }
  if (it.times > 1) bits.push('×' + it.times);
  if (m.app) bits.push('from ' + m.app);
  if (m.src) {
    try { bits.push(new URL(m.src).hostname + ' — ⌘O opens'); } catch { /* not a url */ }
  }
  return bits.join(' · ');
}

function render() {
  $list.textContent = '';
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.classList.add(it.kind || 'text');
    if (i === sel) li.classList.add('selected');

    li.appendChild(rowBody(it));

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = rowMeta(it);
    li.appendChild(meta);

    const del = document.createElement('button');
    del.className = 'del';
    del.title = 'Delete (⌘⌫)';
    del.textContent = '✕';
    del.addEventListener('click', (e) => { e.stopPropagation(); removeAt(i); });
    li.appendChild(del);

    // Image clips get an OCR action — copy the text out of the picture.
    if (it.kind === 'image') {
      const ocr = document.createElement('button');
      ocr.className = 'ocr';
      ocr.title = 'Copy the text out of this image (OCR)';
      ocr.textContent = 'OCR';
      ocr.addEventListener('click', (e) => { e.stopPropagation(); ocrAt(i); });
      li.appendChild(ocr);
    }

    // Image rows open a preview (see it before you copy it); every other
    // kind copies straight back on click.
    li.addEventListener('click', () => {
      const it = items[i];
      if (it && it.kind === 'image') openPreview(it); else copyAt(i);
    });
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

// Backend puts the clip back on the clipboard (as its own kind) + hides us.
// opts: { paste } types ⌘V into the previous app, { plain } strips rich text.
async function copyAt(i, opts = {}) {
  const it = items[i];
  if (!it) return;
  await tiny.api.call('copy', { id: it.id, ...opts });
}

async function removeAt(i) {
  const it = items[i];
  if (!it) return;
  await tiny.api.call('remove', { id: it.id });
  await refresh();
}

async function pinAt(i) {
  const it = items[i];
  if (!it) return;
  await tiny.api.call('pin', { id: it.id });
  await refresh();
}

// The system eyedropper — the picked colour becomes the newest clip (and it's
// on the clipboard). null = cancelled, so the list is left as it was.
async function pickColor() {
  const hex = await tiny.api.call('pickColor');
  if (hex) { sel = 0; await refresh(); }
  $search.focus();
}

// OCR an image clip: on success the recognised text is the newest clip; when
// the picture has no readable text, say so rather than silently doing nothing.
async function ocrAt(i) {
  const it = items[i];
  if (!it || it.kind !== 'image') return;
  const res = await tiny.api.call('ocrClip', { id: it.id });
  if (res && res.text) { sel = 0; await refresh(); return; }
  dialogUp = true;
  await tiny.win.alert('No text found', 'On-device OCR didn’t detect any text in this image.');
  dialogUp = false;
  $search.focus();
}

document.getElementById('pick').addEventListener('click', pickColor);

// ------------------------------------------------------------------ preview

// Image clips open a full-size preview over the list, with a Back bar pinned
// on top. The thumbnail shows instantly; the crisp full-res image swaps in
// when the backend hands it over.
async function openPreview(it) {
  if (!it || it.kind !== 'image') return;
  previewItem = it;
  $pvImg.src = it.thumb || '';
  $pvMeta.textContent = rowMeta(it);
  $preview.hidden = false;
  const full = await tiny.api.call('fullImage', { id: it.id });
  if (full && previewItem === it) $pvImg.src = full;
}

function closePreview() {
  if (!previewItem) return;
  previewItem = null;
  $preview.hidden = true;
  $pvImg.src = '';
  $search.focus();
}

// Copy the previewed image back and close (the backend hides the palette).
async function copyPreview() {
  if (!previewItem) return;
  const id = previewItem.id;
  previewItem = null;
  $preview.hidden = true;
  await tiny.api.call('copy', { id });
}

document.getElementById('pvBack').addEventListener('click', closePreview);
document.getElementById('pvCopy').addEventListener('click', copyPreview);
$preview.addEventListener('mousedown', (e) => { if (e.target === $preview) closePreview(); });

// --------------------------------------------------------------------- keys

document.addEventListener('keydown', (e) => {
  // While a preview is open it owns the keyboard: Enter copies, Esc/⌫ backs out.
  if (previewItem) {
    if (e.key === 'Enter') { e.preventDefault(); copyPreview(); }
    else if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); closePreview(); }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (sel < items.length - 1) { sel += 1; paintSelection(); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (sel > 0) { sel -= 1; paintSelection(); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    copyAt(sel, { paste: e.altKey, plain: e.shiftKey });
  } else if (e.key === 'Backspace' && e.metaKey) {
    e.preventDefault();
    removeAt(sel);
  } else if (e.key === 'p' && e.metaKey) {
    e.preventDefault();                 // (also keeps ⌘P from meaning Print)
    pinAt(sel);
  } else if (e.key === 'o' && e.metaKey) {
    e.preventDefault();
    const it = items[sel];
    if (it && it.meta && it.meta.src) tiny.api.call('openSource', { id: it.id });
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
  previewItem = null;
  $preview.hidden = true;
  $pvImg.src = '';
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
    detail: 'All unpinned clips will be deleted (📌 pinned clips stay). This cannot be undone.',
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
  // Not while a native dialog is up, and not while an image preview is open —
  // a stray blur must never tear the palette down mid-preview.
  if (!dialogUp && !previewItem) tiny.api.call('blurHide');
});

refresh();
$search.focus();
