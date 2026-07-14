// Beam palette — type, arrow, ⏎. Apps are fuzzy-scored locally against the
// index (zero bridge traffic per keystroke); files go to mdfind, debounced;
// math is handled by the parser in logic.js. All DOM is built with
// textContent / createElement — a filename must never become markup.

const $search = document.getElementById('search');
const $list = document.getElementById('list');
const $empty = document.getElementById('empty');
const $emptyText = document.getElementById('emptyText');
const $status = document.getElementById('status');
const $hotkey = document.getElementById('hotkey');

const MAX_APPS = 8;
const SUGGESTIONS = 8;

let apps = [];                 // the index: [{ name, path, uses }]
let fileRows = [];             // latest mdfind answer for the current query
let fileSeq = 0;               // stale-response guard
let items = [];                // flat selectable rows currently rendered
let sel = 0;

const icons = new Map();       // app path -> data URI | null (per session)
let iconFetch = null;          // only one icons call in flight

// ------------------------------------------------------------------ helpers

const EXT_GLYPH = [
  [/\.(png|jpe?g|gif|webp|heic|svg|icns)$/i, '🖼️'],
  [/\.(mp4|mov|mkv|avi)$/i, '🎬'],
  [/\.(mp3|m4a|wav|flac|aiff)$/i, '🎵'],
  [/\.(zip|gz|tar|dmg|pkg)$/i, '📦'],
  [/\.pdf$/i, '📕'],
  [/\.(js|ts|py|rb|go|rs|c|h|swift|java|sh|json|yml|yaml|toml|css|html)$/i, '📜'],
];

function glyphFor(f) {
  if (f.dir) return '📁';
  for (const [re, g] of EXT_GLYPH) if (re.test(f.name)) return g;
  return '📄';
}

function shortDir(path) {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  const home = dir.match(/^\/Users\/[^/]+/);
  return home ? '~' + dir.slice(home[0].length) : dir;
}

// name with matched characters bolded — spans, never innerHTML
function highlighted(name, at) {
  const frag = document.createDocumentFragment();
  const hot = new Set(at || []);
  let run = null;
  for (let i = 0; i < name.length; i++) {
    const el = hot.has(i) ? 'b' : null;
    if (!run || run.tagName !== (el || 'SPAN').toUpperCase()) {
      run = document.createElement(el || 'span');
      frag.appendChild(run);
    }
    run.textContent += name[i];
  }
  return frag;
}

// ------------------------------------------------------------------- search

function appMatches(q) {
  if (!q) {
    return [...apps]
      .sort((a, b) => (b.uses - a.uses) || a.name.localeCompare(b.name))
      .slice(0, SUGGESTIONS)
      .map((a) => ({ ...a, at: [] }));
  }
  const out = [];
  for (const a of apps) {
    const m = beam.fuzzy(q, a.name);
    if (m) out.push({ ...a, at: m.at, score: m.score + Math.min(a.uses, 12) * 2 });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, MAX_APPS);
}

let debounce = 0;
function queueFiles(q) {
  clearTimeout(debounce);
  const seq = ++fileSeq;
  if (q.length < 3) { fileRows = []; return; }
  debounce = setTimeout(async () => {
    const rows = await tiny.api.call('files', { query: q });
    if (seq !== fileSeq) return;               // an older answer — drop it
    fileRows = rows;
    render();
  }, 180);
}

function refresh() {
  const q = $search.value.trim();
  queueFiles(q);
  render();
}

// ------------------------------------------------------------------- render

function section(label) {
  const li = document.createElement('li');
  li.className = 'section';
  li.textContent = label;
  $list.appendChild(li);
}

function row(item, iconNode, name, at, sub) {
  const li = document.createElement('li');
  li.className = 'row';

  const ic = document.createElement('span');
  ic.className = 'icon';
  ic.appendChild(iconNode);
  li.appendChild(ic);

  const text = document.createElement('div');
  text.className = 'text';
  const title = document.createElement('div');
  title.className = 'name';
  title.appendChild(highlighted(name, at));
  text.appendChild(title);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'sub';
    s.textContent = sub;
    text.appendChild(s);
  }
  li.appendChild(text);

  const i = items.length;
  li.addEventListener('click', () => act(items[i], false));
  li.addEventListener('mousemove', () => {
    if (sel !== i) { sel = i; paintSelection(); }
  });

  item.el = li;
  items.push(item);
  $list.appendChild(li);
}

function appIconNode(path) {
  const uri = icons.get(path);
  if (uri) {
    const img = document.createElement('img');
    img.src = uri;
    img.alt = '';
    return img;
  }
  const span = document.createElement('span');
  span.textContent = '⬡';
  span.className = 'ghost';
  return span;
}

function glyphNode(g) {
  const span = document.createElement('span');
  span.textContent = g;
  return span;
}

function render() {
  const q = $search.value.trim();
  $list.textContent = '';
  items = [];

  const result = beam.calc(q);
  if (result) {
    section('Calculator');
    row({ kind: 'calc', raw: result.raw }, glyphNode('🧮'), result.display, [], q + '  ·  ⏎ copies the result');
  }

  const matched = appMatches(q);
  if (matched.length) {
    section(q ? 'Applications' : 'Suggestions');
    for (const a of matched) {
      row({ kind: 'app', path: a.path }, appIconNode(a.path), a.name,
        a.at, a.uses ? `opened ${a.uses}×` : '');
    }
  }

  if (fileRows.length) {
    section('Files');
    for (const f of fileRows) {
      const m = beam.fuzzy(q, f.name);
      row({ kind: 'file', path: f.path }, glyphNode(glyphFor(f)), f.name,
        m ? m.at : [], shortDir(f.path));
    }
  }

  if (sel >= items.length) sel = Math.max(0, items.length - 1);
  paintSelection();

  $empty.hidden = items.length > 0;
  $emptyText.textContent = q ? `Nothing for “${q}”.` : 'Type to search apps and files — or do math.';
  $status.textContent = q
    ? items.length + (items.length === 1 ? ' result' : ' results')
    : apps.length + ' apps indexed';

  fetchMissingIcons(matched.map((a) => a.path));
}

function paintSelection() {
  items.forEach((it, i) => it.el.classList.toggle('selected', i === sel));
  const el = items[sel] && items[sel].el;
  if (el) el.scrollIntoView({ block: 'nearest' });
}

// Ask the backend only for icons we've never seen, one call in flight at a
// time; rows are patched in place when it lands (no full re-render).
function fetchMissingIcons(paths) {
  const missing = paths.filter((p) => !icons.has(p));
  if (!missing.length || iconFetch) return;
  iconFetch = tiny.api.call('icons', { paths: missing }).then((got) => {
    iconFetch = null;
    for (const [path, uri] of Object.entries(got)) {
      icons.set(path, uri);
      if (!uri) continue;
      for (const it of items) {
        if (it.kind === 'app' && it.path === path) {
          const ic = it.el.querySelector('.icon');
          ic.textContent = '';
          ic.appendChild(appIconNode(path));
        }
      }
    }
  }).catch(() => { iconFetch = null; });
}

// ------------------------------------------------------------------ actions

async function act(item, revealInstead) {
  if (!item) return;
  if (item.kind === 'calc') return tiny.api.call('copy', { text: item.raw });
  if (revealInstead) return tiny.api.call('reveal', { path: item.path });
  if (item.kind === 'app') {
    await tiny.api.call('launch', { path: item.path });
    const a = apps.find((x) => x.path === item.path);
    if (a) a.uses += 1;                        // keep the local index honest
    return;
  }
  return tiny.api.call('openFile', { path: item.path });
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
    act(items[sel], e.metaKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if ($search.value) { $search.value = ''; sel = 0; refresh(); }
    else tiny.api.call('hide');
  } else if (e.target !== $search && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
    $search.focus();                  // type anywhere, land in the search box
  }
});

$search.addEventListener('input', () => { sel = 0; refresh(); });

// ------------------------------------------------------------------- events

// Summoned (hotkey or tray): reset, re-pull the index, take the keyboard.
tiny.api.on('opened', async () => {
  $search.value = '';
  sel = 0;
  fileRows = [];
  const res = await tiny.api.call('apps');
  apps = res.apps;
  $hotkey.textContent = res.hotkey;
  render();
  $search.focus();
});

// Click-out dismiss: losing focus hides the palette, like a real menu.
window.addEventListener('blur', () => tiny.api.call('blurHide'));

tiny.api.call('apps').then((res) => {
  apps = res.apps;
  $hotkey.textContent = res.hotkey;
  render();
  $search.focus();
});
