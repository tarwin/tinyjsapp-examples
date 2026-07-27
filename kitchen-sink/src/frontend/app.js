const $ = (id) => document.getElementById(id);
// Escape anything that goes into innerHTML — a filename like
// "<img src=x onerror=…>" must never become markup in a page that holds
// an RPC channel to the backend.
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtBytes = (n) => {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(1) + ' ' + u[i];
};
const fmtUptime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + ss + 's';
};

/* ══════════════ theme (auto / dark / light) ══════════════
   The mode persists in tiny.store (0.3.1). "auto" follows the OS: the native
   tiny.theme signal drives it when available, with matchMedia as a fallback
   for the brief window before the launcher reports the first value. */

const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
let themeMode = 'system';
let nativeDark = null;                        // from tiny.theme; null until reported

const isDark = () => (nativeDark != null ? nativeDark : sysDark.matches);

function applyTheme() {
  const eff = themeMode === 'system' ? (isDark() ? 'dark' : 'light') : themeMode;
  document.documentElement.dataset.theme = eff;
  for (const b of document.querySelectorAll('#themeSeg button'))
    b.classList.toggle('on', b.dataset.mode === themeMode);
  const nt = $('nativeTheme'), rt = $('resolvedTheme');
  if (nt) nt.textContent = nativeDark == null ? '(awaiting first signal — using matchMedia)' : (nativeDark ? 'dark' : 'light');
  if (rt) rt.textContent = eff + (themeMode === 'system' ? '' : ` (forced ${themeMode})`);
  drawSpark();
}
sysDark.addEventListener('change', applyTheme);
tiny.theme.on((dark) => { nativeDark = dark; applyTheme(); });   // live OS theme changes
$('themeSeg').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  themeMode = b.dataset.mode;
  applyTheme();
  tiny.store.set('theme', themeMode).catch(() => {});
});

const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ══════════════ tabs ══════════════ */

let activeTab = 'overview';
function showTab(name, persist = true) {
  activeTab = name;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  // On a short window the tab list scrolls, so a tab picked by ⌘-number can
  // be out of view. Nudge the list itself — block:'nearest' keeps it from
  // scrolling anything else.
  const active = document.querySelector('.railtabs .tab.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
  // The noise loop is per-pixel work every frame — only run it while its tab
  // is actually on screen, and start it the first time you go there.
  if (name === 'wasm') {
    if (!noise.inst) noiseInit().catch((e) => { $('noiseOut').textContent = 'noise init failed: ' + e; });
    else if (!noise.raf) noise.tick();
  } else if (noise.raf) {
    cancelAnimationFrame(noise.raf);
    noise.raf = 0;
  }
  for (const p of document.querySelectorAll('.panel')) p.classList.toggle('active', p.id === 'panel-' + name);
  gpuSetActive(name === 'gpu');
  if (name === 'ffi') ffiEnsure();
  if (name === 'system') systemEnsure();
  if (name === 'system') refreshBatteryWifi();
  if (persist) tiny.store.set('tab', name).catch(() => {});
}
$('rail').addEventListener('click', (ev) => {
  const t = ev.target.closest('.tab');
  if (!t) return;
  // picking a tab is a decision to stop searching
  if (searchTerm) { searchBox.value = ''; runSearch(''); }
  showTab(t.dataset.tab);
});

/* ══════════════ search ══════════════
   The deck has ten panels and ~50 cards, so finding "the printToPDF one"
   meant clicking through tabs. Typing here drops the one-panel-at-a-time rule
   and shows every card that matches, each labelled with the panel it lives in.
   Cards are filtered in place — never cloned — so their buttons, canvases and
   live push subscriptions keep working while filtered. */
const searchBox = $('search');
let searchTerm = '';

// Each card gets a lazily-built haystack (its text) and a label naming its
// panel. Built once on first search: the DOM is static apart from output
// areas, and re-reading textContent per keystroke would thrash on the big
// panels.
let searchIndex = null;
function buildSearchIndex() {
  const index = [];
  for (const panel of document.querySelectorAll('.panel')) {
    const name = panel.id.replace(/^panel-/, '');
    const tab = document.querySelector(`.tab[data-tab="${name}"]`);
    const label = tab ? tab.textContent.replace(/⌘.*$/, '').trim() : name;
    for (const card of panel.querySelectorAll(':scope > .cols > .stack > .card, :scope > .card, :scope .subpanel > .card')) {
      const from = document.createElement('div');
      from.className = 'searchfrom';
      from.textContent = label;
      card.prepend(from);
      // the heading carries the API name people actually search for
      const head = card.querySelector('h2');
      index.push({ card, panel, text: (card.textContent || '').toLowerCase(),
                   head, headText: head ? head.textContent : '' });
    }
  }
  const empty = document.createElement('div');
  empty.className = 'searchempty';
  empty.id = 'searchEmpty';
  document.querySelector('main').appendChild(empty);
  return index;
}

// Highlight the term inside each surviving heading, and put the heading back
// verbatim when the term changes or clears.
function markHeading(entry, term) {
  if (!entry.head) return;
  if (!term) { entry.head.innerHTML = entry.headHTML ?? entry.head.innerHTML; return; }
  if (entry.headHTML === undefined) entry.headHTML = entry.head.innerHTML;
  entry.head.innerHTML = entry.headHTML;
  const walk = document.createTreeWalker(entry.head, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeValue.toLowerCase().includes(term)) hits.push(n);
  }
  for (const node of hits) {
    const frag = document.createDocumentFragment();
    let rest = node.nodeValue, i;
    while ((i = rest.toLowerCase().indexOf(term)) >= 0) {
      frag.append(rest.slice(0, i));
      const m = document.createElement('mark');
      m.className = 'hit';
      m.textContent = rest.slice(i, i + term.length);
      frag.append(m);
      rest = rest.slice(i + term.length);
    }
    frag.append(rest);
    node.replaceWith(frag);
  }
}

function runSearch(raw) {
  const term = String(raw || '').trim().toLowerCase();
  searchTerm = term;
  $('searchClear').hidden = !term;
  const main = document.querySelector('main');
  if (!searchIndex) searchIndex = buildSearchIndex();

  if (!term) {
    main.classList.remove('searching');
    for (const e of searchIndex) { e.card.classList.remove('nomatch'); markHeading(e, ''); }
    for (const p of document.querySelectorAll('.panel')) p.classList.remove('nohits');
    showTab(activeTab, false);          // back to the one-panel view
    return;
  }

  main.classList.add('searching');
  const hitsPerPanel = new Map();
  for (const e of searchIndex) {
    const hit = e.text.includes(term);
    e.card.classList.toggle('nomatch', !hit);
    markHeading(e, hit ? term : '');
    if (hit) hitsPerPanel.set(e.panel, (hitsPerPanel.get(e.panel) || 0) + 1);
  }
  for (const p of document.querySelectorAll('.panel')) p.classList.toggle('nohits', !hitsPerPanel.get(p));
  const total = [...hitsPerPanel.values()].reduce((a, b) => a + b, 0);
  const empty = $('searchEmpty');
  empty.classList.toggle('on', total === 0);
  empty.textContent = total === 0 ? `nothing matches “${raw.trim()}”` : '';
}

searchBox.addEventListener('input', () => runSearch(searchBox.value));
searchBox.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { searchBox.value = ''; runSearch(''); searchBox.blur(); }
});
$('searchClear').addEventListener('click', () => {
  searchBox.value = ''; runSearch(''); searchBox.focus();
});
// ⌘F / Ctrl+F focuses the box wherever you are
document.addEventListener('keydown', (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'f') {
    ev.preventDefault();
    searchBox.focus();
    searchBox.select();
  }
});

/* ══════════════ call log ══════════════
   Every tiny.* call the deck makes, recorded as it happens, so the deck
   documents itself: click a control, read the exact line you'd have to write.
   Done by wrapping `tiny` once rather than instrumenting ~200 call sites —
   which would have gone stale the first time anyone added a button. */
const CALL_LOG = [];
const CALL_LOG_MAX = 300;
// Chatter that would drown the useful entries: the deck's own logging, and
// anything it polls on a timer.
const CALL_LOG_SKIP = new Set(['log', 'api.on', 'system.capabilities']);

function fmtArg(v, depth = 0) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v.length > 60 ? `'${v.slice(0, 57)}…'` : `'${v}'`;
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) {
    if (v.length > 8) return `[…${v.length} items]`;      // e.g. wasm bytes
    return '[' + v.map((x) => fmtArg(x, depth + 1)).join(', ') + ']';
  }
  if (depth > 1) return '{…}';
  const parts = Object.entries(v).slice(0, 6)
    .map(([k, x]) => `${k}: ${fmtArg(x, depth + 1)}`);
  if (Object.keys(v).length > 6) parts.push('…');
  return '{ ' + parts.join(', ') + ' }';
}

// Copying out of the log calls tiny.clipboard.write, which the proxy would
// happily record — so every copy would add a line to the thing you're reading.
let suppressCallLog = false;
async function copyQuietly(text) {
  suppressCallLog = true;
  try { await tiny.clipboard.write({ text }); } finally { suppressCallLog = false; }
}

function logCall(path, args, ret) {
  if (suppressCallLog) return { t: new Date(), line: '' };
  const line = `tiny.${path}(${args.map((a) => fmtArg(a)).join(', ')})`;
  const entry = { t: new Date(), line, ret };
  CALL_LOG.unshift(entry);
  if (CALL_LOG.length > CALL_LOG_MAX) CALL_LOG.pop();
  const n = $('callLogN');
  if (n) n.textContent = CALL_LOG.length;
  if ($('callLog') && !$('callLog').hidden) renderCallLog();
  return entry;
}

// Wrap every function on tiny.* (one level of namespace deep) so calling it
// records itself. Non-functions pass through untouched — tiny.win.id is a
// value, not a call.
function instrumentTiny(root) {
  const wrapNs = (obj, prefix) => new Proxy(obj, {
    get(target, key) {
      const val = target[key];
      if (typeof key !== 'string') return val;
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof val === 'function') {
        return (...args) => {
          const out = val.apply(target, args);
          if (CALL_LOG_SKIP.has(path)) return out;
          const entry = logCall(path, args);
          if (out && typeof out.then === 'function') {
            out.then((r) => {
              if (r !== undefined && typeof r !== 'function') {
                entry.ret = fmtArg(r);
                if ($('callLog') && !$('callLog').hidden) renderCallLog();
              }
            }, () => {});
          }
          return out;
        };
      }
      // one level down: tiny.app.secrets.get, tiny.win.…
      if (val && typeof val === 'object' && !Array.isArray(val) && prefix === '')
        return wrapNs(val, path);
      return val;
    },
  });
  return wrapNs(root, '');
}
window.tiny = instrumentTiny(window.tiny);

function renderCallLog() {
  const list = $('callLogList');
  if (!CALL_LOG.length) {
    list.innerHTML = '<li class="empty">Nothing yet — press something.</li>';
    return;
  }
  list.innerHTML = CALL_LOG.map((e) => {
    const t = e.t.toTimeString().slice(0, 8);
    const ret = e.ret !== undefined ? `<span class="ret">  // → ${esc(String(e.ret))}</span>` : '';
    // the line rides on the element, so a click still copies the right one
    // after newer calls have re-rendered the list underneath it
    // time + call + return are ONE flex item; only the button sits beside it.
    // As three separate items they each shrank to a single character wide.
    return `<li><div class="entry"><span class="t">${t}</span>${esc(e.line)}${ret}</div>` +
           `<button class="copyone" data-line="${esc(e.line)}" title="copy this call">⧉</button></li>`;
  }).join('');
}
$('callLogBtn').addEventListener('click', () => {
  const el = $('callLog');
  el.hidden = !el.hidden;
  if (!el.hidden) renderCallLog();
});
$('callLogClose').addEventListener('click', () => { $('callLog').hidden = true; });
$('callLogClear').addEventListener('click', () => {
  CALL_LOG.length = 0; $('callLogN').textContent = '0'; renderCallLog();
});
$('callLogCopy').addEventListener('click', async () => {
  await copyQuietly(CALL_LOG.map((e) => e.line).reverse().join('\n'));
  $('callLogCopy').textContent = 'Copied ✓';
  setTimeout(() => { $('callLogCopy').textContent = 'Copy all'; }, 1200);
});
$('callLogList').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button.copyone');
  if (!b) return;
  await copyQuietly(b.dataset.line);
  const was = b.textContent;
  b.textContent = '✓';
  b.classList.add('done');
  setTimeout(() => { b.textContent = was; b.classList.remove('done'); }, 1000);
});

/* ── in-panel sub-tabs ───────────────────────────────────────────────────
   Two flavours, for two shapes of panel:
   - data-panes: the pane owns a whole layout of its own (App's window ops,
     Storage's file browser), so the markup is nested in .subpanel blocks and
     the nav swaps which one is live.
   - data-cards: the pane is just a set of cards, so they carry data-group and
     the nav filters them in place — no re-nesting of markup that already lays
     out correctly.
   Both exist so a panel with five cards doesn't dump all five on a small
   screen. */
function showPane(nav, sub) {
  const panel = nav.closest('.panel');
  for (const b of nav.querySelectorAll('button[data-sub]'))
    b.classList.toggle('on', b.dataset.sub === sub);
  for (const p of panel.querySelectorAll(':scope > .subpanel'))
    p.classList.toggle('active', p.id === 'sub-' + sub);
}

for (const nav of document.querySelectorAll('nav.subnav[data-panes]')) {
  nav.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-sub]');
    if (b) showPane(nav, b.dataset.sub);
  });
}

// Jump straight to a pane from elsewhere (a menu item, a picked folder).
function openPane(tab, sub) {
  showTab(tab);
  const nav = document.querySelector(`#panel-${tab} nav.subnav[data-panes]`);
  if (nav) showPane(nav, sub);
}

function showCardGroup(nav, group) {
  const panel = nav.closest('.panel');
  for (const b of nav.querySelectorAll('button[data-group]'))
    b.classList.toggle('on', b.dataset.group === group);
  for (const card of panel.querySelectorAll('.card[data-group]'))
    card.hidden = card.dataset.group !== group;
  // a .cols wrapper left with one visible card shouldn't hold a 2-col gap
  for (const cols of panel.querySelectorAll('.cols'))
    cols.classList.toggle('one-up',
      cols.querySelectorAll('.card[data-group]:not([hidden])').length === 1);
}

for (const nav of document.querySelectorAll('nav.subnav[data-cards]')) {
  nav.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-group]');
    if (b) showCardGroup(nav, b.dataset.group);
  });
  showCardGroup(nav, nav.querySelector('button[data-group]').dataset.group);
}

/* ══════════════ live instruments (backend push, 1 Hz) ══════════════ */

const cpuHist = [];
tiny.api.on('tick', ({ time, uptime, cpu, load }) => {
  $('clock').textContent = time;
  $('uptime').textContent = fmtUptime(uptime);
  const pct = Math.round(cpu * 100);
  $('cpuBar').style.width = pct + '%';
  $('cpuPct').textContent = pct + '%';
  $('cpuNow').textContent = pct + '%';
  $('load').textContent = load.map((l) => l.toFixed(1)).join(' ');
  $('load1').textContent = load[0].toFixed(2);
  $('load5').textContent = load[1].toFixed(2);
  $('load15').textContent = load[2].toFixed(2);
  cpuHist.push(cpu);
  if (cpuHist.length > 90) cpuHist.shift();
  drawSpark();
});

function drawSpark() {
  const cv = $('spark');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = 72;
  if (!w) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.05)';
  g.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75]) {
    g.beginPath(); g.moveTo(0, h * f); g.lineTo(w, h * f); g.stroke();
  }
  if (cpuHist.length < 2) return;
  const step = w / 89;
  const x0 = w - (cpuHist.length - 1) * step;
  const y = (v) => h - 3 - v * (h - 8);
  const amber = cssVar('--amber') || '#ffb454';
  g.beginPath();
  cpuHist.forEach((v, i) => { const x = x0 + i * step; i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v)); });
  g.strokeStyle = amber;
  g.lineWidth = 1.5;
  g.stroke();
  g.lineTo(x0 + (cpuHist.length - 1) * step, h);
  g.lineTo(x0, h);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, amber);
  grad.addColorStop(1, amber);
  g.globalAlpha = 0.18;
  g.fillStyle = grad;
  g.fill();
  g.globalAlpha = 1;
}

/* ══════════════ overview: dialogs & window ══════════════ */

let renames = 0;
const say = (t) => { $('dialogOut').textContent = t; };
$('retitle').addEventListener('click', () => tiny.win.setTitle('renamed ' + ++renames + '×'));
$('grow').addEventListener('click', () => tiny.win.setSize(1280, 800));
$('shrink').addEventListener('click', () => tiny.win.setSize(1100, 720));
$('alertBtn').addEventListener('click', () => tiny.dialog.alert('Heads up', 'This is tiny.dialog.alert() — a native NSAlert.'));
$('confirmBtn').addEventListener('click', async () =>
  say('confirm → ' + await tiny.dialog.confirm('Proceed with the thing?', { detail: 'This is tiny.dialog.confirm().' })));
$('promptBtn').addEventListener('click', async () => {
  const name = await tiny.dialog.prompt('What is your name?', { default: 'world' });
  say(name == null ? 'prompt → (cancelled)' : 'prompt → hello, ' + name + '!');
});
$('pickBtn').addEventListener('click', async () => {
  const dir = await tiny.dialog.pickFolder();
  if (dir) { say('picked folder → ' + dir + '\nopening it in Storage → Files ⌘3'); openPane('storage', 'files'); listDir(dir); }
  else say('pickFolder → (cancelled)');
});
$('quit').addEventListener('click', async () => {
  if (await tiny.dialog.confirm('Quit Tiny Deck?', { detail: 'Running commands will be terminated.' })) tiny.quit();
});

/* ══════════════ files ══════════════ */

let curPath = '/';
let curFile = null;

async function listDir(path) {
  $('dirErr').textContent = '';
  try {
    const { entries } = await tiny.api.call('listDir', { path });
    curPath = path;
    $('path').value = path;
    const base = path.replace(/\/$/, '');
    const up = base.replace(/\/[^/]+$/, '') || '/';
    $('dir').innerHTML =
      `<li class="dir" data-p="${esc(up)}" data-d="1">▴ ..</li>` +
      entries.map((e) =>
        `<li class="${e.isDir ? 'dir' : ''}" data-p="${esc(base + '/' + e.name)}" data-d="${e.isDir ? 1 : 0}">` +
        `${e.isDir ? '▸ ' : '&nbsp; '}${esc(e.name)}</li>`).join('');
  } catch (e) {
    $('dirErr').textContent = String(e);
  }
}

async function openFile(path, li) {
  $('dirErr').textContent = '';
  try {
    const f = await tiny.api.call('readFile', { path });
    curFile = f.binary ? null : path;
    for (const el of document.querySelectorAll('#dir li.sel')) el.classList.remove('sel');
    li?.classList.add('sel');
    $('fileName').textContent = path.split('/').pop();
    $('fileMeta').textContent = fmtBytes(f.size) + (f.truncated ? ' · showing first 128 KB' : '') + (f.binary ? ' · binary' : '');
    $('editor').value = f.binary ? '(binary file — not shown)' : f.text;
    $('editor').disabled = f.binary;
    $('saveBtn').disabled = !!f.binary || f.truncated;
    $('saveAsBtn').disabled = !!f.binary;
  } catch (e) {
    $('dirErr').textContent = String(e);
  }
}

$('dir').addEventListener('click', (ev) => {
  const li = ev.target.closest('li');
  if (!li) return;
  li.dataset.d === '1' ? listDir(li.dataset.p) : openFile(li.dataset.p, li);
});
$('path').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') listDir($('path').value); });
$('goBtn').addEventListener('click', () => listDir($('path').value));
$('openBtn').addEventListener('click', async () => {
  const p = await tiny.dialog.openFile();
  if (!p) return;
  openPane('storage', 'files');
  await listDir(p.replace(/\/[^/]+$/, '') || '/');
  openFile(p, [...document.querySelectorAll('#dir li')].find((li) => li.dataset.p === p));
});

async function saveTo(path) {
  const { size } = await tiny.api.call('writeFile', { path, text: $('editor').value });
  $('fileMeta').textContent = fmtBytes(size) + ' · saved ✓';
  setTimeout(() => { $('fileMeta').textContent = fmtBytes(size); }, 1500);
}
$('saveBtn').addEventListener('click', () => curFile && saveTo(curFile).catch((e) => { $('dirErr').textContent = String(e); }));
$('saveAsBtn').addEventListener('click', async () => {
  const p = await tiny.dialog.saveFile();
  if (p) saveTo(p).then(() => listDir(curPath)).catch((e) => { $('dirErr').textContent = String(e); });
});

// live folder watching — backend tjs.watch pushes events to the page
let watching = null;
async function toggleWatch() {
  watching = watching ? null : curPath;
  await tiny.api.call('watchDir', { path: watching });
  $('watchBtn').classList.toggle('on', !!watching);
  $('watchBtn').textContent = watching ? '◉ Watching ' + watching.split('/').pop() : '◉ Watch this folder';
  if (watching) $('fsFeed').innerHTML = `<div>watching <b>${esc(watching)}</b> — touch, create or delete a file there…</div>`;
  syncMenuChecks();
}
$('watchBtn').addEventListener('click', () => toggleWatch().catch((e) => { $('dirErr').textContent = String(e); }));
tiny.api.on('fs:event', ({ file, event, time }) => {
  const d = document.createElement('div');
  d.innerHTML = `${esc(time)} · <b>${esc(event)}</b> ${esc(file)}`;
  $('fsFeed').prepend(d);
  while ($('fsFeed').children.length > 60) $('fsFeed').lastChild.remove();
  if (watching === curPath) listDir(curPath);
});

/* ══════════════ run ══════════════ */

let runId = 0, runningId = null;

function appendOut(text, cls) {
  const con = $('console');
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  con.appendChild(s);
  while (con.childNodes.length > 3000) con.firstChild.remove();
  con.scrollTop = con.scrollHeight;
}

function runCmd() {
  const cmd = $('cmd').value.trim();
  if (!cmd || runningId != null) return;
  const id = ++runId;
  runningId = id;
  $('console').textContent = '';
  $('runStatus').innerHTML = `running <b>${esc(cmd)}</b> …`;
  $('runBtn').disabled = true;
  $('killBtn').disabled = false;
  tiny.api.call('run', { id, cmd }).catch((e) => {
    appendOut(String(e) + '\n', 'se');
    finishRun(id);
  });
}
function finishRun(id) {
  if (runningId !== id) return;
  runningId = null;
  $('runBtn').disabled = false;
  $('killBtn').disabled = true;
}
tiny.api.on('run:out', ({ id, stream, chunk }) => {
  if (id === runningId) appendOut(chunk, stream === 'stderr' ? 'se' : 'so');
});
tiny.api.on('run:exit', ({ id, code, signal, ms }) => {
  if (id !== runningId) return;
  $('runStatus').innerHTML = signal
    ? `<span class="bad">killed by signal ${esc(signal)}</span> · ${ms} ms`
    : `exit <span class="${code === 0 ? 'ok' : 'bad'}">${code}</span> · ${ms} ms`;
  // long-running command? tell the user even if they wandered off (0.3.0 notify)
  if (ms > 3000 && !signal) tiny.notify('Tiny Deck', `Command finished — exit ${code} after ${(ms / 1000).toFixed(1)}s`);
  finishRun(id);
});
$('runBtn').addEventListener('click', runCmd);
$('cmd').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') runCmd(); });
$('killBtn').addEventListener('click', () => { if (runningId != null) tiny.api.call('kill', { id: runningId }); });
$('chips').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-cmd]');
  if (b) { $('cmd').value = b.dataset.cmd; runCmd(); }
});

/* ══════════════ http ══════════════ */

// tiny.fetch resolves a REAL Response, so everything below is ordinary fetch
// code — res.status, res.headers.entries(), res.text(). The deck used to call
// a hand-written backend handler here that packed the same three things into a
// JSON blob; deleting it is the point of the card.
async function sendHttp() {
  const url = $('url').value.trim();
  if (!url) return;
  $('httpStatus').textContent = 'fetching…';
  $('httpHeaders').textContent = '';
  $('httpBody').textContent = '';
  const started = performance.now();
  try {
    const res = await tiny.fetch(url, { method: $('method').value });
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    $('httpStatus').innerHTML =
      `<span class="${res.ok ? 'ok' : 'bad'}">${res.status} ${esc(res.statusText)}</span>` +
      ` · ${ms} ms · ${fmtBytes(text.length)}` +
      (res.redirected ? ` · redirected to ${esc(res.url)}` : '');
    $('httpHeaders').textContent =
      [...res.headers.entries()].map(([k, v]) => k + ': ' + v).join('\n') || '(no headers)';
    let body = text;
    try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not json */ }
    $('httpBody').textContent = body || '(empty body)';
  } catch (e) {
    $('httpStatus').innerHTML = `<span class="bad">failed</span> · ${esc(e?.message || e)}`;
  }
}

// -- streaming: the same call with { stream: true } --
let streamAbort = null;
$('streamBtn').addEventListener('click', async () => {
  const url = $('streamUrl').value.trim();
  if (!url || streamAbort) return;
  $('streamBtn').disabled = true;
  $('streamStop').disabled = false;
  $('streamOut').textContent = 'streaming…';
  $('streamChunks').textContent = '0';
  $('streamBytes').textContent = '0 B';
  let cancelled = false;
  streamAbort = () => { cancelled = true; };
  const started = performance.now();
  let chunks = 0, bytes = 0;
  try {
    const res = await tiny.fetch(url, { stream: true });
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (cancelled) { await reader.cancel(); break; }
      chunks++; bytes += value.byteLength;
      $('streamChunks').textContent = String(chunks);
      $('streamBytes').textContent = fmtBytes(bytes);
    }
    const ms = Math.round(performance.now() - started);
    $('streamOut').innerHTML = cancelled
      ? `cancelled after ${fmtBytes(bytes)} — <b>reader.cancel()</b> aborted the request in the backend, not just here`
      : `done — <b>${chunks}</b> chunks, ${fmtBytes(bytes)} in ${ms} ms, and memory never held more than one chunk`;
  } catch (e) {
    $('streamOut').innerHTML = `<span class="bad">failed</span> · ${esc(e?.message || e)}`;
  }
  streamAbort = null;
  $('streamBtn').disabled = false;
  $('streamStop').disabled = true;
});
$('streamStop').addEventListener('click', () => { if (streamAbort) streamAbort(); });

// -- fileURL / proxyURL --
// Both are string builders, so the demo has to prove the URL they build
// actually loads in a media element — and, for the proxy, that the pixels come
// back READABLE, which is the whole point and needs crossOrigin as well.
function loadImg(src, crossOrigin) {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => {
      const cv = $('mediaCv'), g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 0, 0, cv.width, cv.height);
      let readable;
      try { g.getImageData(0, 0, 1, 1); readable = true; } catch { readable = false; }
      resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight, readable, img });
    };
    img.onerror = () => resolve({ ok: false });
    img.src = src;
  });
}
function showImg(r) {
  const img = $('mediaImg'), cv = $('mediaCv');
  if (!r.ok) { img.hidden = true; cv.hidden = true; return; }
  img.src = r.img.src; img.hidden = false; cv.hidden = false;
}

$('mediaLocal').addEventListener('click', async () => {
  const { path } = await tiny.api.call('iconPath');
  if (!path) { $('mediaOut').textContent = "couldn't find icon.png next to the app"; return; }
  const url = tiny.fileURL(path);
  $('mediaOut').textContent = 'loading ' + url;
  const r = await loadImg(url, true);
  showImg(r);
  $('mediaOut').innerHTML = r.ok
    ? `<b>fileURL</b> → loaded ${r.w}×${r.h}. Note the path is outside the page's own folder, ` +
      'which only works because this app sets <b>"readAccess": true</b> in tinyjs.json — ' +
      'without it the element just fires <b>error</b> and says nothing.'
    : '<b>fileURL</b> → failed. The usual cause is no <b>"readAccess"</b> in tinyjs.json: the ' +
      "page may only load file:// paths under its own folder, and a backend-supplied path rarely is.";
});

// Load the same remote image twice — once plain, once with crossOrigin — so the
// difference is something you can see rather than something the card claims.
$('mediaProxy').addEventListener('click', async () => {
  const src = 'https://tinyjs.app/shelf-icon.png';
  const url = tiny.proxyURL(src);
  $('mediaOut').textContent = 'loading ' + url;
  const plain = await loadImg(url, false);
  const cors = await loadImg(url, true);
  showImg(cors.ok ? cors : plain);
  if (!plain.ok && !cors.ok) {
    $('mediaOut').innerHTML = '<b>proxyURL</b> → failed to load (offline?)';
    return;
  }
  $('mediaOut').innerHTML =
    `<b>proxyURL</b> → loaded ${(cors.ok ? cors : plain).w}×${(cors.ok ? cors : plain).h}. ` +
    `Pixels: <b>${plain.readable ? 'readable' : 'tainted'}</b> plain, ` +
    `<b>${cors.readable ? 'readable' : 'tainted'}</b> with <code>crossOrigin='anonymous'</code>. ` +
    'That second line is the point — the proxy serves permissive CORS, but you still have to ' +
    'opt in, and the audio equivalent of "tainted" is an analyser reading pure silence.';
});
$('sendBtn').addEventListener('click', sendHttp);
$('url').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') sendHttp(); });
document.querySelector('#sub-http .chips').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-url]');
  if (b) { $('url').value = b.dataset.url; sendHttp(); }
});

/* ══════════════ notes (sqlite) ══════════════ */

function renderNotes(rows) {
  $('notes').innerHTML = rows.map((n) =>
    `<li><span class="text">${esc(n.text)}</span>` +
    `<time>${esc(new Date(n.created_at).toLocaleString())}</time>` +
    `<button class="del" data-id="${n.id}" title="delete">✕</button></li>`).join('') ||
    '<li><span class="text muted">no notes yet — they persist in sqlite across relaunches</span></li>';
}
async function addNote() {
  const text = $('noteInput').value.trim();
  if (!text) return;
  $('noteInput').value = '';
  renderNotes(await tiny.api.call('notesAdd', { text }));
}
$('addNote').addEventListener('click', addNote);
// The .sqlite file is a real file — reveal it, or open it with any sqlite tool
// while the app is running. That's the point worth making: it isn't a private
// blob, it's a database you can inspect.
let dbFile = '';
$('dbReveal').addEventListener('click', () =>
  shellSay('dbOut', tiny.app.shell.reveal(dbFile)));
$('dbCount').addEventListener('click', async () => {
  const n = await tiny.api.call('notesCount');
  $('dbOut').innerHTML = `<b>SELECT COUNT(*) FROM notes</b> → <b>${n}</b> — ` +
    'a query, not a filter over everything the store had to load first.';
});
$('noteInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') addNote(); });
$('notes').addEventListener('click', async (ev) => {
  const b = ev.target.closest('.del');
  if (b) renderNotes(await tiny.api.call('notesDelete', { id: Number(b.dataset.id) }));
});

/* ══════════════ gpu lab ══════════════
   Fragment-shader demos on WebGL2, recorded straight to a video file:
   canvas.captureStream → MediaRecorder (mp4) → base64 chunks over the
   bridge → backend writes wherever the native save dialog pointed.
   WebGPU is probed at runtime — this WKWebView doesn't expose it yet, so
   the status line reports honestly and lights up when WebKit ships it. */

let gpu = null;          // engine-specific state; { engine, cv, cur, raf, ... }
let gpuActive = false;
let recording = false;
let gpuBusy = false;

// A canvas is married to its first context type, so switching engines
// means replacing the element.
function freshCanvas() {
  const old = $('gpuCanvas');
  const cv = document.createElement('canvas');
  cv.id = 'gpuCanvas';
  old.replaceWith(cv);
  return cv;
}

function initWebGl2(cv) {
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: true });
  if (!gl) throw new Error('WebGL2 unavailable in this webview');
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const vert = compile(gl.VERTEX_SHADER, DECK_SHADERS.VERT);
  const progs = {};
  for (const name of ['plasma', 'torus', 'tunnel']) {
    const p = gl.createProgram();
    gl.attachShader(p, vert);
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, DECK_SHADERS[name]));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
    progs[name] = { p, u_time: gl.getUniformLocation(p, 'u_time'), u_res: gl.getUniformLocation(p, 'u_res') };
  }
  // particles: WebGL2 has no compute stage, so positions are updated in JS
  // and the whole buffer is re-uploaded each frame.
  const pp = gl.createProgram();
  gl.attachShader(pp, compile(gl.VERTEX_SHADER, DECK_SHADERS.PARTICLE_VERT));
  gl.attachShader(pp, compile(gl.FRAGMENT_SHADER, DECK_SHADERS.PARTICLE_FRAG));
  gl.linkProgram(pp);
  if (!gl.getProgramParameter(pp, gl.LINK_STATUS)) throw new Error('particles: ' + gl.getProgramInfoLog(pp));
  const cpu = makeParticles();
  const pbuf = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
  gl.bufferData(gl.ARRAY_BUFFER, cpu.byteLength, gl.DYNAMIC_DRAW);
  // interleaved x,y,vx,vy — position is the first 8 bytes of each 16
  const locP = gl.getAttribLocation(pp, 'a_pos');
  gl.enableVertexAttribArray(locP);
  gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 16, 0);
  const locV = gl.getAttribLocation(pp, 'a_vel');
  if (locV >= 0) {
    gl.enableVertexAttribArray(locV);
    gl.vertexAttribPointer(locV, 2, gl.FLOAT, false, 16, 8);
  }
  gl.bindVertexArray(null);
  return { engine: 'webgl2', cv, gl, progs, particles: { prog: pp, buf: pbuf, vao, cpu } };
}

// The demo answers "how many particles can this backend hold at 60fps?", so
// the buffers are allocated once at a ceiling and only `gpu.active` of them
// are stepped and drawn. The count then walks up or down to find the level
// each backend can sustain — which is the comparison, rather than a fixed
// number that either both manage or neither does.
const PARTICLE_MAX = 3000000;
const PARTICLE_START = 150000;
function makeParticles() {
  const a = new Float32Array(PARTICLE_MAX * 4);
  for (let i = 0; i < PARTICLE_MAX; i++) {
    const ang = Math.random() * Math.PI * 2, rad = 0.35 + Math.random() * 0.5;
    a[i * 4] = Math.cos(ang) * rad;
    a[i * 4 + 1] = Math.sin(ang) * rad;
    a[i * 4 + 2] = -Math.sin(ang) * 0.002;
    a[i * 4 + 3] = Math.cos(ang) * 0.002;
  }
  return a;
}

// The same maths as the WGSL compute shader, on the CPU.
function stepParticlesCPU(a, t, count) {
  const tx = Math.cos(t * 0.7) * 0.55, ty = Math.sin(t * 0.9) * 0.55;
  const end = count * 4;
  for (let i = 0; i < end; i += 4) {
    const dx = tx - a[i], dy = ty - a[i + 1];
    const r = Math.max(Math.hypot(dx, dy), 0.06);
    const f = 0.00035 / (r * r * r);   // (d / r) * (k / r^2)
    let vx = (a[i + 2] + dx * f) * 0.994;
    let vy = (a[i + 3] + dy * f) * 0.994;
    let x = a[i] + vx, y = a[i + 1] + vy;
    if (x < -1 || x > 1) vx = -vx;
    if (y < -1 || y > 1) vy = -vy;
    a[i] = x; a[i + 1] = y; a[i + 2] = vx; a[i + 3] = vy;
  }
}

// WebGPU works since tinyjs 0.3.0: the page is a file:// secure context and
// the launcher flips WebKit's feature flag. Same three demos, in WGSL.
async function initWebGpu(cv) {
  if (!navigator.gpu) throw new Error('navigator.gpu not exposed');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  const ctx = cv.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  const ubuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const pipes = {}, groups = {};
  for (const name of ['plasma', 'torus', 'tunnel']) {
    const module = device.createShaderModule({ code: DECK_SHADERS.wgsl[name] });
    const p = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    pipes[name] = p;
    groups[name] = device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ubuf } }],
    });
  }
  // particles: the whole simulation stays on the GPU — a compute pass updates
  // the storage buffer and the vertex stage reads straight from it.
  const seed = makeParticles();
  const pbuf = device.createBuffer({
    size: seed.byteLength,
    // STORAGE for the compute pass to write, VERTEX for the render pass to
    // read as attributes — the same memory, never copied between them
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(pbuf, 0, seed);
  // Pipeline validation is asynchronous: a rejected pipeline just makes every
  // pass that uses it invalid, which reads as "60fps, black canvas". Scope the
  // creation so the real reason is reportable.
  device.pushErrorScope('validation');
  const cModule = device.createShaderModule({ code: DECK_SHADERS.particlesCompute });
  const cPipe = device.createComputePipeline({ layout: 'auto', compute: { module: cModule, entryPoint: 'cs' } });
  const cGroup = device.createBindGroup({
    layout: cPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: pbuf } },
              { binding: 1, resource: { buffer: ubuf } }],
  });
  const rModule = device.createShaderModule({ code: DECK_SHADERS.particlesRender });
  const rPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: rModule, entryPoint: 'vs', buffers: [{
      arrayStride: 16,                       // x, y, vx, vy
      stepMode: 'vertex',
      attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' },
                   { shaderLocation: 1, offset: 8, format: 'float32x2' }],
    }] },
    fragment: { module: rModule, entryPoint: 'fs', targets: [{
      format,
      // additive: overlapping particles accumulate into a glow instead of
      // overwriting each other
      blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
               alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } },
    }] },
    primitive: { topology: 'point-list' },
  });
  device.popErrorScope().then((err) => {
    if (err) {
      window.__particlesError = err.message;
      $('webgpuStatus').innerHTML =
        '<span class="bad">particles pipeline rejected: ' + esc(err.message) + '</span>';
    }
  });
  // Anything later (a bad draw, an exhausted buffer) surfaces the same way.
  device.addEventListener?.('uncapturederror', (e) => {
    const msg = (e.error && e.error.message) || String(e.error || e);
    $('webgpuStatus').innerHTML = '<span class="bad">webgpu error: ' + esc(msg) + '</span>';
  });
  return { engine: 'webgpu', cv, device, ctx, format, ubuf, pipes, groups,
           particles: { pbuf, cPipe, cGroup, rPipe } };
}

function gpuFrame() {
  const { cv } = gpu;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(cv.clientWidth * dpr), h = Math.floor(cv.clientHeight * dpr);
  const t = (performance.now() - gpu.t0) / 1000;
  if (w && (cv.width !== w || cv.height !== h)) {
    cv.width = w; cv.height = h;
    if (gpu.engine === 'webgpu') gpu.ctx.configure({ device: gpu.device, format: gpu.format, alphaMode: 'opaque' });
    else gpu.gl.viewport(0, 0, w, h);
  }
  const isParticles = gpu.cur === 'particles';
  if (gpu.engine === 'webgpu') {
    // u = { time, count, res } — count is what the compute shader bounds on
    gpu.device.queue.writeBuffer(gpu.ubuf, 0,
      new Float32Array([t, isParticles ? gpu.active : 0, cv.width, cv.height]));
    const enc = gpu.device.createCommandEncoder();
    if (isParticles) {
      const cp = enc.beginComputePass();
      cp.setPipeline(gpu.particles.cPipe);
      cp.setBindGroup(0, gpu.particles.cGroup);
      cp.dispatchWorkgroups(Math.ceil(gpu.active / 64));
      cp.end();
    }
    const pass = enc.beginRenderPass({ colorAttachments: [{
      view: gpu.ctx.getCurrentTexture().createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }] });
    if (isParticles) {
      pass.setPipeline(gpu.particles.rPipe);
      pass.setVertexBuffer(0, gpu.particles.pbuf);
      pass.draw(gpu.active);
    } else {
      pass.setPipeline(gpu.pipes[gpu.cur]);
      pass.setBindGroup(0, gpu.groups[gpu.cur]);
      pass.draw(3);
    }
    pass.end();
    gpu.device.queue.submit([enc.finish()]);
  } else if (isParticles) {
    // no compute stage here: step on the CPU, then re-upload everything
    const P = gpu.particles;
    stepParticlesCPU(P.cpu, t, gpu.active);
    const gl = gpu.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, P.buf);
    // upload only the slice in play — re-sending 48 MB to move 150k points
    // would measure the bus rather than the simulation
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, P.cpu, 0, gpu.active * 4);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);   // additive, matching the WebGPU pipeline
    gl.useProgram(P.prog);
    gl.bindVertexArray(P.vao);
    gl.drawArrays(gl.POINTS, 0, gpu.active);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  } else {
    const pr = gpu.progs[gpu.cur];
    gpu.gl.useProgram(pr.p);
    gpu.gl.uniform1f(pr.u_time, t);
    gpu.gl.uniform2f(pr.u_res, cv.width, cv.height);
    gpu.gl.drawArrays(gpu.gl.TRIANGLES, 0, 3);
  }
  gpu.frames++;
  const now = performance.now();
  if (now - gpu.fpsAt >= 1000) {
    gpu.fps = Math.round(gpu.frames * 1000 / (now - gpu.fpsAt));
    gpu.frames = 0; gpu.fpsAt = now;
    // Find the largest count this backend holds at 60fps, then STOP — a
    // number that keeps sliding is unreadable. requestAnimationFrame caps at
    // 60, so "how much headroom is left" is invisible and a plain climb-and-
    // back-off just oscillates. Instead: probe upward until a count fails,
    // then bisect between the last good and first bad until they're within
    // 6% and lock there.
    if (gpu.cur === 'particles' && !recording && !gpu.locked && !gpu.skip) {
      const good = gpu.fps >= 58;
      if (good) gpu.lo = Math.max(gpu.lo || 0, gpu.active);
      else if (gpu.fps <= 56) gpu.hi = Math.min(gpu.hi || Infinity, gpu.active);
      const was = gpu.active;
      if (!gpu.hi) {
        gpu.active = Math.min(PARTICLE_MAX, Math.round(gpu.active * 1.6));
        // ceiling reached without ever dropping a frame: the backend isn't
        // the limit, our buffer allocation is — say so rather than implying
        // this is where it tops out
        if (gpu.active >= PARTICLE_MAX) { gpu.locked = true; gpu.atCeiling = true; }
      } else {
        const lo = gpu.lo || 20000;
        if ((gpu.hi - lo) / gpu.hi < 0.06) { gpu.active = lo; gpu.locked = true; }
        else gpu.active = Math.max(20000, Math.round((lo + gpu.hi) / 2));
      }
      // fps is averaged over the PREVIOUS second, so a reading taken right
      // after a resize describes the old count. Skip one window after every
      // change or the search attributes frame drops to the wrong size.
      if (gpu.active !== was) gpu.skip = 1;
    } else if (gpu.skip) { gpu.skip = 0; }
    if (!recording) {
      const n = (gpu.active >= 1000000
        ? (gpu.active / 1000000).toFixed(2) + 'M'
        : Math.round(gpu.active / 1000) + 'k') + (gpu.atCeiling ? '+' : '');
      const how = gpu.cur !== 'particles' ? ''
        : gpu.engine === 'webgpu'
          ? ` · <b>${n}</b> particles${gpu.locked ? '' : ' (finding the limit…)'} at 60fps, stepped in a <b>compute shader</b>`
          : ` · <b>${n}</b> particles${gpu.locked ? '' : ' (finding the limit…)'} at 60fps, stepped <b>on the CPU</b> — WebGL2 has no compute stage`;
      $('gpuStatus').innerHTML =
        `render: <b>${gpu.engine === 'webgpu' ? 'WebGPU (WGSL)' : 'WebGL2 (GLSL)'}</b>` +
        ` · shader: <b>${esc(gpu.cur)}</b> · ${cv.width}×${cv.height} · <b>${gpu.fps}</b> fps` + how;
    }
  }
  if (gpuActive || recording) gpu.raf = requestAnimationFrame(gpuFrame);
}

function updateEngineChips() {
  for (const b of document.querySelectorAll('#engineChips button')) {
    if (b.dataset.engine === 'webgpu' && !navigator.gpu) { b.disabled = true; b.title = 'not exposed by this webview'; }
    b.classList.toggle('on', gpu && b.dataset.engine === gpu.engine);
  }
}

async function gpuStart(engine) {
  if (gpuBusy || recording) return;
  gpuBusy = true;
  try {
    if (gpu) cancelAnimationFrame(gpu.raf);
    const cur = gpu ? gpu.cur : 'plasma';
    const next = engine === 'webgpu' ? await initWebGpu(freshCanvas()) : initWebGl2(freshCanvas());
    // active restarts from the same floor on every engine switch, so each
    // backend finds its own 60fps level rather than inheriting the other's
    gpu = Object.assign(next, { cur, raf: 0, t0: performance.now(), frames: 0,
                                fpsAt: performance.now(), fps: 0,
                                active: PARTICLE_START, lo: 0, hi: 0, locked: false, skip: 0, atCeiling: false });
    updateEngineChips();
    if (gpuActive) gpu.raf = requestAnimationFrame(gpuFrame);
  } catch (e) {
    $('gpuStatus').textContent = engine + ' init failed: ' + (e.message || e);
    if (engine === 'webgpu') { gpuBusy = false; return gpuStart('webgl2'); }   // graceful fallback
  } finally {
    gpuBusy = false;
  }
}

function gpuSetActive(on) {
  gpuActive = on;
  if (!on) return;                       // raf loop stops itself; recording keeps it alive
  probeWebGpu();
  if (!gpu) gpuStart(navigator.gpu ? 'webgpu' : 'webgl2');
  else { cancelAnimationFrame(gpu.raf); gpu.raf = requestAnimationFrame(gpuFrame); }
}

$('engineChips').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-engine]');
  if (b && !b.disabled && (!gpu || gpu.engine !== b.dataset.engine)) gpuStart(b.dataset.engine);
});

$('shaderChips').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-shader]');
  if (!b || !gpu) return;
  gpu.cur = b.dataset.shader;
  for (const c of document.querySelectorAll('#shaderChips button')) c.classList.toggle('on', c === b);
});


/* ── animated noise: wasm vs js, and the same module in the backend ── */
const noise = { who: 'wasm', oct: 1, inst: null, mem: null, raf: 0,
                acc: 0, n: 0, jsAcc: 0, jsN: 0, wasmAcc: 0, wasmN: 0 };

async function noiseInit() {
  const cv = $('noiseCv');
  const ctx = cv.getContext('2d');
  const { instance } = await WebAssembly.instantiate(await loadNoiseWasm());
  // The canvas takes the card's width, so the pixel count follows the window.
  // One byte per pixel has to fit the module's 8 pages (512 KB), hence the cap.
  const MAX_PX = 8 * 65536;
  let W = 0, H = 0, img = null, jsBuf = null;
  const resize = () => {
    const want = Math.max(160, Math.min(1400, Math.floor(cv.clientWidth || 640)));
    // Height comes from the room actually left in the card, not a fixed
    // ratio — a ratio-sized canvas pushed the readout below the fold at the
    // default window size, which is where the numbers live.
    // clientHeight is whatever flex gave it — no measuring, no feedback loop
    const h = Math.max(110, Math.floor(cv.clientHeight || 200));
    if (want * h > MAX_PX) return;                 // never overrun the module
    if (want === W && h === H) return;
    W = cv.width = want; H = cv.height = h;
    img = ctx.createImageData(W, H);
    jsBuf = new Uint8Array(W * H);
    noise.wasmAcc = noise.wasmN = noise.jsAcc = noise.jsN = 0;   // timings are per-size
  };
  resize();
  addEventListener('resize', resize, { passive: true });
  noise.inst = instance;
  noise.mem = new Uint8Array(instance.exports.mem.buffer);

  const paint = (src) => {
    const d = img.data;
    for (let i = 0, p = 0; i < src.length; i++, p += 4) {
      const v = src[i];
      // warm ramp so it reads like the rest of the deck
      d[p] = v; d[p + 1] = (v * 0.72) | 0; d[p + 2] = (v * 0.38) | 0; d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };

  const frame = () => {
    resize();
    const t = performance.now() / 1000 * 0.35;
    const t0 = performance.now();
    let src;
    if (noise.who === 'wasm') {
      noise.inst.exports.fill(t, W, H, noise.oct);
      src = noise.mem.subarray(0, W * H);
    } else {
      jsFill(jsBuf, t, W, H, noise.oct);
      src = jsBuf;
    }
    const ms = performance.now() - t0;
    paint(src);
    if (noise.who === 'wasm') { noise.wasmAcc += ms; noise.wasmN++; }
    else { noise.jsAcc += ms; noise.jsN++; }
    noise.acc += ms; noise.n++;
    if (noise.n >= 20) {
      // Only ONE path runs per frame — the other figure is its last average,
      // kept so the two can be compared after trying each.
      const wa = noise.wasmN ? noise.wasmAcc / noise.wasmN : 0;
      const ja = noise.jsN ? noise.jsAcc / noise.jsN : 0;
      const other = noise.who === 'wasm'
        ? (ja ? ` · js was <b>${ja.toFixed(1)} ms</b>` : ' · js not run yet')
        : (wa ? ` · wasm was <b>${wa.toFixed(1)} ms</b>` : ' · wasm not run yet');
      const ratio = wa && ja ? ` · js is <b>${(ja / wa).toFixed(1)}×</b> slower` : '';
      $('noiseOut').innerHTML =
        `${W}×${H} · ${noise.oct} octave${noise.oct === 1 ? '' : 's'} · running <b>${noise.who}</b>: ` +
        `<b>${(noise.acc / noise.n).toFixed(1)} ms</b>/frame` +
        `<span class="muted">${other}${ratio}</span>`;
      noise.acc = 0; noise.n = 0;
    }
    noise.raf = requestAnimationFrame(frame);
  };
  noise.tick = frame;   // so switching back to the tab can resume it
  frame();
}

$('noiseWho').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-who]');
  if (!b) return;
  noise.who = b.dataset.who;
  for (const x of $('noiseWho').children) x.classList.toggle('on', x === b);
  noise.acc = 0; noise.n = 0;
});
$('noiseOct').addEventListener('input', (ev) => {
  noise.oct = +ev.target.value;
  $('noiseOctN').textContent = noise.oct;
  noise.wasmAcc = noise.wasmN = noise.jsAcc = noise.jsN = 0;   // timings are per-octave
});

// -- record the canvas and save a real video file via the backend --

const b64encode = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};

async function recordVideo() {
  if (recording || !gpu) return;
  const secs = Number($('recSecs').value);
  const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
  const ext = mime === 'video/mp4' ? '.mp4' : '.webm';
  recording = true;
  $('recBtn').classList.add('rec');
  $('recBtn').textContent = '● recording…';
  try {
    const stream = gpu.cv.captureStream(60);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start(500);
    for (let s = secs; s > 0; s--) {
      $('gpuStatus').innerHTML = `<b>● recording ${esc(gpu.cur)}</b> — ${s}s left · ${mime}`;
      await new Promise((r) => setTimeout(r, 1000));
    }
    rec.stop();
    await stopped;
    for (const t of stream.getTracks()) t.stop();

    const bytes = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer());
    $('gpuStatus').innerHTML = `captured <b>${fmtBytes(bytes.length)}</b> — pick where to save it…`;
    let path = await tiny.dialog.saveFile();
    if (!path) { $('gpuStatus').textContent = 'recording discarded (save cancelled)'; return; }
    if (!/\.(mp4|webm|mov)$/i.test(path)) path += ext;

    await tiny.api.call('videoBegin');
    const STEP = 768 * 1024;
    for (let i = 0; i < bytes.length; i += STEP) {
      await tiny.api.call('videoAppend', { b64: b64encode(bytes.subarray(i, i + STEP)) });
      $('gpuStatus').innerHTML = `writing… ${Math.round(Math.min(i + STEP, bytes.length) * 100 / bytes.length)}%`;
    }
    const { size } = await tiny.api.call('videoEnd', { path });
    $('gpuStatus').innerHTML = `saved <b>${esc(path)}</b> · ${fmtBytes(size)} · ${secs}s of ${esc(gpu.cur)} ✓`;
    tiny.notify('Tiny Deck', 'Video saved — ' + path.split('/').pop() + ' (' + fmtBytes(size) + ')');
  } catch (e) {
    $('gpuStatus').innerHTML = `record failed: ${esc(e.message || e)}`;
  } finally {
    recording = false;
    $('recBtn').classList.remove('rec');
    $('recBtn').textContent = '◉ Record → video file';
    if (gpuActive) { cancelAnimationFrame(gpu.raf); gpu.raf = requestAnimationFrame(gpuFrame); }
  }
}
$('recBtn').addEventListener('click', recordVideo);

// -- WebGPU: detect, and prove it with a compute dispatch when present --

let webGpuProbed = false;
async function probeWebGpu() {
  if (webGpuProbed) return;
  webGpuProbed = true;
  const el = $('webgpuStatus');
  if (!navigator.gpu) {
    el.innerHTML = 'webgpu: <span class="bad">not exposed by this WKWebView</span> — demos render on WebGL2; this line lights up the day WebKit ships it';
    return;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { el.textContent = 'webgpu: navigator.gpu present but no adapter'; return; }
    const device = await adapter.requestDevice();
    const mod = device.createShaderModule({ code:
      '@group(0) @binding(0) var<storage, read_write> out: array<u32>;\n' +
      '@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3<u32>) { out[id.x] = id.x * 2u; }' });
    const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
    const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const read = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const enc2 = device.createCommandEncoder();
    const pass = enc2.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(4); pass.end();
    enc2.copyBufferToBuffer(buf, 0, read, 0, 16);
    device.queue.submit([enc2.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const result = [...new Uint32Array(read.getMappedRange())].join(',');
    const info = adapter.info || {};
    el.innerHTML = `webgpu: <span class="ok">live</span> — ${esc([info.vendor, info.device, info.description].filter(Boolean).join(' / ') || 'adapter')} · compute says [${esc(result)}] ✓`;
  } catch (e) {
    el.innerHTML = `webgpu: <span class="bad">error</span> — ${esc(e.message || e)}`;
  }
}

/* ══════════════ wasm lab ══════════════
   A WebAssembly module assembled by hand — every byte below is part of the
   spec'd binary format — instantiated in the webview's JavaScriptCore. */


/* ══════════════ wasm noise: the same field, three ways ══════════════
   Compiled from src/frontend/noise.wat (kept in the repo as the source of
   truth — `npx -p wabt wat2wasm src/frontend/noise.wat` regenerates these
   bytes). fbm value noise, one byte per pixel, written straight into the
   module's linear memory. */
// noise.wasm ships next to this file, built from noise.wat. Loaded rather
// than embedded — instantiateStreaming can't be used because a file:// URL
// carries no application/wasm MIME type, and file:// fetches always report
// status 0, so the body is read regardless of `ok`.
let NOISE_WASM = null;
async function loadNoiseWasm() {
  if (NOISE_WASM) return NOISE_WASM;
  const res = await fetch('noise.wasm');
  NOISE_WASM = new Uint8Array(await res.arrayBuffer());
  return NOISE_WASM;
}

// The identical maths in JS, so the comparison is algorithmic and not a
// difference in what's being computed. Math.fround keeps it to f32 like the
// wasm side, which matters if you diff the two outputs pixel-for-pixel.
const fr = Math.fround;
function jsHash(x, y) {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) | 0;
  n = n ^ (n >>> 16);
  return fr((n & 0x7fffffff) * 4.656612873e-10);
}
function jsNoise2(x, y) {
  const fx = Math.floor(x), fy = Math.floor(y);
  const xi = fx | 0, yi = fy | 0;
  const xf = fr(x - fx), yf = fr(y - fy);
  const u = fr(fr(xf * xf) * fr(3 - fr(2 * xf)));
  const v = fr(fr(yf * yf) * fr(3 - fr(2 * yf)));
  const a = jsHash(xi, yi), b = jsHash(xi + 1, yi);
  const c = jsHash(xi, yi + 1), d = jsHash(xi + 1, yi + 1);
  const ab = fr(a + fr(fr(b - a) * u));
  const cd = fr(c + fr(fr(d - c) * u));
  return fr(ab + fr(fr(cd - ab) * v));
}
function jsFbm(x, y, oct) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum = fr(sum + fr(amp * jsNoise2(fr(x * freq), fr(y * freq))));
    norm = fr(norm + amp);
    amp = fr(amp * 0.5);
    freq = fr(freq * 2);
  }
  return fr(sum / norm);
}
function jsRidged(x, y, oct) {
  let amp = 1, freq = 1, sum = 0, norm = 0, prev = 1;
  for (let i = 0; i < oct; i++) {
    let n = jsNoise2(fr(x * freq), fr(y * freq));
    n = fr(1 - Math.abs(fr(fr(2 * n) - 1)));
    n = fr(n * n);
    n = fr(n * prev);
    prev = n;
    sum = fr(sum + fr(amp * n));
    norm = fr(norm + amp);
    amp = fr(amp * 0.5);
    freq = fr(freq * 2.02);
  }
  return fr(sum / norm);
}
// Quilez domain warping: five fbm evaluations per pixel before the ridged
// lookup, matching noise.wat exactly.
function jsWarped(x, y, oct) {
  const qx = jsFbm(x, y, oct);
  const qy = jsFbm(fr(x + 5.2), fr(y + 1.3), oct);
  const rx = jsFbm(fr(x + fr(fr(4 * qx) + 1.7)), fr(y + fr(fr(4 * qy) + 9.2)), oct);
  const ry = jsFbm(fr(x + fr(fr(4 * qx) + 8.3)), fr(y + fr(fr(4 * qy) + 2.8)), oct);
  return jsRidged(fr(x + fr(4 * rx)), fr(y + fr(4 * ry)), oct);
}
function jsFill(buf, t, w, h, oct) {
  let p = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = jsWarped(fr(fr(x * 0.018) + t), fr(fr(y * 0.018) + fr(t * 0.5)), oct);
      buf[p++] = fr(v * 255) | 0;
    }
  }
}

const WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d,                                     // magic "\0asm"
  0x01, 0x00, 0x00, 0x00,                                     // version 1
  0x01, 0x0c, 0x02,                                           // type section
  0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,                         //   (i32,i32)->i32
  0x60, 0x01, 0x7f, 0x01, 0x7f,                               //   (i32)->i32
  0x03, 0x03, 0x02, 0x00, 0x01,                               // function section
  0x07, 0x0d, 0x02,                                           // export section
  0x03, 0x61, 0x64, 0x64, 0x00, 0x00,                         //   "add" -> fn 0
  0x03, 0x66, 0x69, 0x62, 0x00, 0x01,                         //   "fib" -> fn 1
  0x0a, 0x26, 0x02,                                           // code section
  0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,             //   add: a+b
  0x1c, 0x00, 0x20, 0x00, 0x41, 0x02, 0x48, 0x04, 0x7f,       //   fib: n<2 ? n
  0x20, 0x00, 0x05, 0x20, 0x00, 0x41, 0x01, 0x6b, 0x10, 0x01, //     : fib(n-1)
  0x20, 0x00, 0x41, 0x02, 0x6b, 0x10, 0x01, 0x6a, 0x0b, 0x0b, //     + fib(n-2)
]);

let wasmExports = null;

async function wasmInit() {
  const hex = [...WASM_BYTES].map((b, i) => {
    const s = b.toString(16).padStart(2, '0');
    return i < 8 ? `<b>${s}</b>` : s;                          // highlight header
  });
  const lines = [];
  for (let i = 0; i < hex.length; i += 16) lines.push(hex.slice(i, i + 16).join(' '));
  $('wasmHex').innerHTML = lines.join('\n') + `\n<span class="muted">— ${WASM_BYTES.length} bytes total</span>`;
  const { instance } = await WebAssembly.instantiate(WASM_BYTES);
  wasmExports = instance.exports;
}

$('addBtn').addEventListener('click', () => {
  if (!wasmExports) return;
  $('addOut').textContent = '= ' + wasmExports.add($('addA').value | 0, $('addB').value | 0);
});

const jsFib = (n) => n < 2 ? n : jsFib(n - 1) + jsFib(n - 2);
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
const timeIt = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };

let benchWhere = 'page';
$('benchWhere').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-where]');
  if (!b) return;
  benchWhere = b.dataset.where;
  for (const x of $('benchWhere').children) x.classList.toggle('on', x === b);
});

$('benchBtn').addEventListener('click', async () => {
  if (!wasmExports) return;
  const n = Math.max(1, Math.min(38, $('fibN').value | 0));
  $('fibN').value = n;
  $('benchOut').textContent = 'running…';
  $('benchBtn').disabled = true;
  await new Promise((r) => setTimeout(r, 30));                 // let UI paint
  try {
    let mJs, mWa, result = 0, where = 'the page (JavaScriptCore)';
    if (benchWhere === 'backend') {
      // the backend instantiates the same bytes and times both there
      const r = await tiny.api.call('fibBench', { bytes: [...WASM_BYTES], n });
      mJs = r.js; mWa = r.wasm; result = r.result;
      where = 'the backend (' + r.runtime + ')';
    } else {
      // WebKit clamps performance.now(), so a single fast call measures as
      // 0 — which turned the ratio into Infinity. Repeat each sample until
      // it's comfortably above the clock's resolution, then divide back out.
      const batch = (fn) => {
        let reps = 1;
        for (;;) {
          const ms = timeIt(() => { for (let i = 0; i < reps; i++) fn(); });
          if (ms >= 5 || reps >= 1 << 20) return ms / reps;
          reps *= 4;
        }
      };
      const js = [], wa = [];
      for (let i = 0; i < 7; i++) {
        js.push(batch(() => jsFib(n)));
        wa.push(batch(() => { result = wasmExports.fib(n); }));
      }
      mJs = median(js); mWa = median(wa);
    }
    const top = Math.max(mJs, mWa, 0.01);
    $('barJs').style.width = (mJs / top * 100) + '%';
    $('barWasm').style.width = (mWa / top * 100) + '%';
    const fmt = (v) => (v >= 0.01 ? v.toFixed(2) : v.toFixed(4)) + ' ms';
    $('msJs').textContent = fmt(mJs);
    $('msWasm').textContent = fmt(mWa);
    const ratio = mWa > 0 ? mJs / mWa : 0;
    $('benchOut').innerHTML =
      `fib(${n}) = <b>${result}</b> in <b>${where}</b> · wasm is ` +
      `<b>${ratio.toFixed(2)}×</b> ${ratio >= 1 ? 'faster' : 'slower'} than JS there` +
      ` · median of 7 runs`;
  } finally {
    $('benchBtn').disabled = false;
  }
});

/* ══════════════ app tab (tinyjs 0.3.0: window ops, tray, notify, update) ══ */

// The call itself now lives in the CALLS log, so this keeps only the half the
// log can't give you: what to go and look at. Everything here was written as
// "tiny.win.thing() — what to notice", so the hint is whatever follows the em
// dash; a call with nothing to notice just points at the log.
const appSay = (t) => {
  const i = t.indexOf(' — ');
  $('appOut').textContent = i >= 0 ? t.slice(i + 3)
    : 'done — the exact call is in the CALLS log, top right';
};
let trayOn = false, dockOn = true, onTop = false, resizableOn = true, hideOnCloseOn = false;

const toggleLabel = (el, on, label) => { el.textContent = (on ? '☑ ' : '☐ ') + label; el.classList.toggle('on', on); };

// 0.5.0 stateful menus: the Actions ▸ Toggles submenu carries live checkmarks.
// Every toggle in the app calls this to push its state into the menu bar with
// tiny.menu.update — so the ✓ next to "Tray Mode" etc. always tells the truth.
let menusReady = false;
// The deck's own menu bar, kept as data so the Menus card can re-declare it
// with an extra menu appended. tiny.menu.set replaces the WHOLE bar, so
// "adding a menu" means sending the whole thing again — worth showing, since
// it's the part people get wrong.
let deckMenuSpec = [];
let demoMenuOn = false;
const DEMO_MENU = {
  title: 'Demo',
  items: [
    { id: 'demo-hello', label: 'Say hello', key: 'j' },
    { id: 'demo-check', label: 'A checkable item', checked: true },
    { separator: true },
    { id: 'demo-sub', label: 'A submenu', submenu: [
      { id: 'demo-sub-a', label: 'Nested item A' },
      { id: 'demo-sub-b', label: 'Nested item B' },
    ] },
    { id: 'demo-off', label: 'Disabled on purpose', enabled: false },
  ],
};
const applyMenus = () =>
  tiny.menu.set(demoMenuOn ? deckMenuSpec.concat([DEMO_MENU]) : deckMenuSpec);
function syncMenuChecks() {
  if (!menusReady) return;
  tiny.menu.update('m-watch', { checked: !!watching });
  tiny.menu.update('m-tray', { checked: trayOn });
  tiny.menu.update('m-ontop', { checked: onTop });
  tiny.menu.update('m-hideclose', { checked: hideOnCloseOn });
  tiny.menu.update('m-hotkey', { checked: hotkeyOn });
}

$('centerBtn').addEventListener('click', () => { tiny.win.center(); appSay('tiny.win.center()'); });
$('minBtn').addEventListener('click', () => { tiny.win.minimize(); appSay('tiny.win.minimize() — check the Dock'); });
$('fsBtn').addEventListener('click', () => { tiny.win.fullscreen(); appSay('tiny.win.fullscreen() — call again (or this button) to toggle back'); });
$('peekBtn').addEventListener('click', async () => {
  appSay('tiny.win.hide() … back in 1.5s');
  tiny.win.hide();
  await new Promise((r) => setTimeout(r, 1500));
  tiny.win.show();
  appSay('…and tiny.win.show(). Peek-a-boo.');
});

function moveCorner(cx, cy) {
  const m = 30;
  const x = cx ? Math.max(m, (screen.availWidth || 1440) - window.innerWidth - m) : m;
  const y = cy ? Math.max(m, (screen.availHeight || 900) - window.innerHeight - m * 2) : m;
  tiny.win.setPosition(x, y);
  appSay(`tiny.win.setPosition(${x}, ${y})`);
}
$('posNW').addEventListener('click', () => moveCorner(0, 0));
$('posNE').addEventListener('click', () => moveCorner(1, 0));
$('posSW').addEventListener('click', () => moveCorner(0, 1));
$('posSE').addEventListener('click', () => moveCorner(1, 1));

$('ontopBtn').addEventListener('click', () => {
  onTop = !onTop;
  tiny.win.setAlwaysOnTop(onTop);
  toggleLabel($('ontopBtn'), onTop, 'Always on top');
  syncMenuChecks();
  appSay(`tiny.win.setAlwaysOnTop(${onTop})` + (onTop ? ' — try clicking another app' : ''));
});
$('resizableBtn').addEventListener('click', () => {
  resizableOn = !resizableOn;
  tiny.win.setResizable(resizableOn);
  toggleLabel($('resizableBtn'), resizableOn, 'Resizable');
  appSay(`tiny.win.setResizable(${resizableOn})` + (resizableOn ? '' : ' — grab an edge and feel the refusal'));
});
$('hideCloseBtn').addEventListener('click', () => setHideOnClose(!hideOnCloseOn));

function setHideOnClose(on) {
  hideOnCloseOn = on;
  tiny.win.setHideOnClose(on);
  toggleLabel($('hideCloseBtn'), on, 'Hide on close');
  syncMenuChecks();
  if (on && !trayOn) setTray(true);      // never strand the user with no way back
  appSay(`tiny.win.setHideOnClose(${on})` + (on ? ' — the close button now hides; the tray brings it back' : ''));
}

// icon/template are optional — calling tray.set again with a new icon IS the
// update, so the recipes below just call this with different ones.
let trayIcon = 'sf:square.stack.3d.up.fill', trayTemplate = undefined;
async function setTray(on, icon, template) {
  trayOn = on;
  if (icon !== undefined) trayIcon = icon;
  if (template !== undefined) trayTemplate = template;
  if (on) {
    await tiny.tray.set({
      // 0.9.0: an SF Symbol icon (no shipped png), and primaryAction so a
      // left-click toggles the window while the menu moves to right-click.
      icon: trayIcon,
      ...(trayTemplate === undefined ? {} : { template: trayTemplate }),
      title: 'Deck',
      tooltip: 'Tiny Deck — tinyjs mission control (left-click toggles, right-click for menu)',
      primaryAction: true,
      menu: [
        { id: 'show', label: 'Show Window' },
        { id: 'hide', label: 'Hide Window' },
        { id: 'ping', label: 'Ping Me (notification)' },
        { separator: true },
        { id: 'trayoff', label: 'Remove Tray Icon' },
        { id: 'quit', label: 'Quit Tiny Deck' },
      ],
    });
  } else {
    await tiny.tray.remove();
    if (hideOnCloseOn) setHideOnClose(false);   // tray gone → close must quit again
    if (!dockOn) setDock(true);                 // …and the Dock icon must return
  }
  toggleLabel($('trayBtn'), on, 'Tray mode');
  syncMenuChecks();
  appSay(on ? 'tiny.tray.set({ icon: "sf:…", primaryAction: true, … }) — look up: the deck icon is in the menu bar (left-click toggles the window, right-click opens the menu)' : 'tiny.tray.remove()');
}
$('trayBtn').addEventListener('click', () => setTray(!trayOn));

// 0.9.0 primaryAction: a left-click on the tray icon fires this instead of
// opening the menu — the classic "click to summon / dismiss" toggle.
tiny.tray.onClick(async () => {
  // Two-zone recipe: one status item, two hit areas. Read where the item is
  // and where the pointer is, and act on which half took the click — the
  // cursor right after a click is still close enough to where it landed.
  if (trayZones) {
    try {
      const [spot, mouse] = await Promise.all([tiny.tray.position(), tiny.app.mousePosition()]);
      if (spot && mouse) {
        const left = mouse.x < spot.x + spot.width / 2;
        trayRecipe(`clicked the <b>${left ? 'left' : 'right'}</b> half — `
          + (left ? 'one action' : 'a different one') + ` (icon at ${spot.x}, pointer at ${Math.round(mouse.x)})`);
        return;
      }
    } catch { /* fall through to the normal toggle */ }
  }
  const st = await tiny.win.getState();
  if (st.visible && st.focused) tiny.win.hide(); else tiny.win.show();
});

function setDock(visible) {
  dockOn = visible;
  tiny.app.presence(visible ? 'normal' : 'menubar');
  toggleLabel($('dockBtn'), visible, 'Dock icon');
  if (!visible && !trayOn) {
    // an app with neither icon nor tray is running with no way back to it
    setTray(true);
    $('trayOut').innerHTML = '<b>tray switched on for you</b> — an app with no icon AND no tray has no way back';
  }
  appSay(`tiny.app.presence('${visible ? 'normal' : 'menubar'}')` + (visible ? '' : ' — menu-bar-only app now'));
}
$('dockBtn').addEventListener('click', () => setDock(!dockOn));

tiny.tray.on((id) => {
  if (id === 'show') tiny.win.show();
  if (id === 'hide') tiny.win.hide();
  if (id === 'ping') tiny.notify('Tiny Deck', 'Hello from the menu bar!');
  if (id === 'trayoff') setTray(false);
  if (id === 'quit') tiny.quit();
});

// 0.6.0 rich notifications: notify() takes { id, subtitle, sound }. A signed
// packaged .app shows a real Notification Center banner and routes clicks to
// tiny.app.onNotificationClick(id); dev builds fall back to osascript.
let notifySound = true, notifyN = 0;
$('soundBtn').addEventListener('click', () => {
  notifySound = !notifySound;
  toggleLabel($('soundBtn'), notifySound, 'Sound');
});
/* ── tray recipes: live icons, zones, a panel under the icon ─────────── */
// Icon forms are NOT portable: sf: is macOS-only, emoji: is Windows-only, and
// an absolute png path is the only form all three read. This is the branch a
// real cross-platform app has to write.
const TRAY_SYMS = tiny.system.isMacOS()
  ? ['sf:sparkles', 'sf:bolt.fill', 'sf:cup.and.saucer.fill', 'sf:waveform', 'sf:moon.stars.fill']
  : tiny.system.isWindows()
    ? ['emoji:✨', 'emoji:⚡', 'emoji:☕', 'emoji:🌊', 'emoji:🌙']
    : [];   // Linux reads neither — the drawn png below is the way there
let traySym = 0, trayZones = false;
// name the button after what this platform can actually do
addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('traySymBtn');
  if (!b) return;
  b.textContent = tiny.system.isMacOS() ? 'Cycle SF Symbol'
    : tiny.system.isWindows() ? 'Cycle emoji icon' : 'Icon forms (Linux)';
});
const trayRecipe = (html) => { $('trayRecipeOut').innerHTML = html; };
const needTray = () => {
  if (trayOn) return true;
  trayRecipe('<b>turn Tray mode on first</b> — there is no item to change');
  return false;
};

// Setting it again IS the update — there's no separate call.
$('traySymBtn').addEventListener('click', async () => {
  if (!needTray()) return;
  if (!TRAY_SYMS.length) {
    trayRecipe('Linux reads neither <b>sf:</b> nor <b>emoji:</b> — it takes an icon file, ' +
               'so use <b>Draw a live icon</b> beside this, or ship a png');
    return;
  }
  traySym = (traySym + 1) % TRAY_SYMS.length;
  await setTray(true, TRAY_SYMS[traySym]);
  trayRecipe(`tray.set({ icon: '${esc(TRAY_SYMS[traySym])}' }) — same call, new icon` +
    ` <span class="muted">(${tiny.system.isMacOS() ? 'sf: is macOS-only' : 'emoji: is Windows-only'}; ` +
    `a png works everywhere)</span>`);
});

// A png written this second, then handed to tray.set — how a tray icon shows
// live state (amp draws its play/pause chip exactly this way).
$('trayDrawBtn').addEventListener('click', async () => {
  if (!needTray()) return;
  const cv = $('trayCv'), c = cv.getContext('2d');
  const t = Date.now() / 1000;
  c.clearRect(0, 0, cv.width, cv.height);
  c.strokeStyle = '#000'; c.lineWidth = 4; c.lineCap = 'round';
  c.beginPath(); c.arc(22, 22, 15, t % (Math.PI * 2), (t % (Math.PI * 2)) + 4.2); c.stroke();
  c.fillStyle = '#000';
  c.beginPath(); c.arc(22, 22, 5, 0, Math.PI * 2); c.fill();
  const b64 = cv.toDataURL('image/png').split(',')[1];
  const { path } = await tiny.api.call('trayIconPng', { b64 });
  // template:true recolours it for light/dark menu bars; false keeps your pixels
  await setTray(true, path, true);
  trayRecipe(`drew a png → tray.set({ icon: '…/${esc(path.split('/').pop())}', template: true })`);
});

// One item, two hit areas — amp's trick, and the only way to get more than one
// action out of a single status item.
$('trayZonesBtn').addEventListener('click', () => {
  trayZones = !trayZones;
  toggleLabel($('trayZonesBtn'), trayZones, 'Two-zone button');
  trayRecipe(trayZones
    ? 'on — click the LEFT half of the tray icon for one action, the right half for the other'
    : 'off — a left click just toggles the window again');
});

// Anchor a frameless window under the icon: tray.position() gives the rect,
// setPosition puts the window beneath it. A popover, without a popover API.
$('trayPanelBtn').addEventListener('click', async () => {
  if (!needTray()) return;
  const spot = await tiny.tray.position();
  if (!spot) { trayRecipe('<b>null</b> — this platform won\'t say where the icon is, so there is nothing to anchor to'); return; }
  await tiny.win.open('traypanel', {
    page: 'inspector.html', title: 'under the tray', size: '260x150',
    chrome: { frame: false },
  });
  await tiny.api.call('placeUnderTray', { id: 'traypanel', x: spot.x, y: spot.y + spot.height, w: 260 });
  trayRecipe(`tray.position() → ${spot.x}, ${spot.y} — window placed just below it`);
});

// tray.position() — where the icon actually sits, for anchoring a popover
// under it. null when the platform won't say (Linux's AppIndicator).
$('trayPosBtn').addEventListener('click', async () => {
  if (!trayOn) { $('trayOut').innerHTML = '<b>turn Tray mode on first</b> — there is no icon to locate'; return; }
  const p = await tiny.tray.position();
  $('trayOut').innerHTML = p
    ? `tray icon at <b>${p.x}, ${p.y}</b> (${p.width}×${p.height}) — anchor a popover here`
    : '<b>null</b> — this platform won\'t say where the icon is (Linux menu-based indicators)';
});

// macOS only gets real banners from a packaged bundle: UNUserNotificationCenter
// needs one, so `tinyjs dev` falls back to osascript — which shows the Script
// Editor icon, drops action buttons, and still returns true. Pressing the
// button here would look like a broken feature, so it's disabled with the
// reason on it. Windows and Linux notify from the launcher in every mode.
(async () => {
  try {
    const { packaged } = await tiny.api.call('isPackaged');
    if (packaged || !tiny.system.isMacOS()) return;
    const b = $('notifyActionBtn');
    b.disabled = true;
    b.textContent = 'Buttons + reply — needs a packaged app';
    b.title = 'macOS routes dev notifications through osascript, which has no action buttons';
    $('notifyOut').innerHTML =
      'Action buttons need a bundle on macOS, and <code>tinyjs dev</code> has none — ' +
      'banners route through <b>osascript</b>, which is why they arrive under the ' +
      '<b>Script Editor</b> icon with a single Show button. Run <code>tinyjs build</code> ' +
      'and open the .app to see the real thing. Windows and Linux show buttons in dev too.';
  } catch {}
})();

// Action buttons, and a reply field on one of them — the answer comes back
// without the app ever coming forward.
$('notifyActionBtn').addEventListener('click', async () => {
  const ok = await tiny.notify('Tiny Deck', 'Two buttons and a reply field', {
    id: 'deck-actions',
    subtitle: 'tiny.notify({ actions: [...] })',
    actions: [
      { id: 'ack', title: 'Got it' },
      { id: 'reply', title: 'Reply…', reply: true, placeholder: 'type something' },
    ],
  });
  $('notifyOut').innerHTML = ok
    ? 'sent — the banner carries <b>Got it</b> and <b>Reply…</b>. Pressing one fires ' +
      '<b>onNotificationAction</b> with that action id; Reply opens an inline field and ' +
      'the text arrives as <b>reply</b> — all without the app coming to the front.'
    : '<span class="bad">notify returned false</span>';
});

tiny.app.onNotificationAction(({ id, action, reply }) => {
  $('notifyOut').innerHTML = `onNotificationAction → <b>${esc(action)}</b> on <b>${esc(id)}</b>` +
    (reply ? ` · you typed “<b>${esc(reply)}</b>”` : '');
});

$('notifyBtn').addEventListener('click', async () => {
  const id = 'note-' + (++notifyN);
  const ok = await tiny.notify('Tiny Deck', $('notifyText').value || 'Hello!', {
    id,
    subtitle: $('notifySub').value || undefined,
    sound: notifySound,
  });
  $('notifyOut').innerHTML = ok
    ? `sent <b>{ id: ${esc(id)}, subtitle, sound: ${notifySound} }</b> — in a packaged .app, click the banner to fire onNotificationClick`
    : '<span class="bad">notify failed</span>';
});
tiny.app.onNotificationClick((id) => {
  tiny.win.show();
  tiny.win.center();
  showTab('app');
  $('notifyOut').innerHTML = `banner <b>${esc(id)}</b> clicked → tiny.app.onNotificationClick brought the window forward`;
});

$('updateBtn').addEventListener('click', async () => {
  $('updateOut').textContent = 'checking…';
  try {
    const { available, current, latest } = await tiny.api.call('update.check');
    $('updateOut').innerHTML = available
      ? `update available: <b>${esc(latest)}</b> (running ${esc(current)}) — update.install() would fetch, verify and relaunch`
      : `up to date — running <b>${esc(current)}</b>, latest is ${esc(latest)}`;
  } catch (e) {
    $('updateOut').innerHTML = `<span class="muted">${esc(e)}</span> — expected here: add "update": { "url": … } to tinyjs.json and ship with \`tinyjs publish\``;
  }
});

/* ── drag & drop: files from Finder arrive with real paths (0.3.0) ── */

tiny.win.onDrop(async (paths) => {
  openPane('storage', 'files');
  for (const p of paths.slice().reverse()) {
    const d = document.createElement('div');
    d.innerHTML = `dropped · <b>${esc(p)}</b>`;
    $('fsFeed').prepend(d);
  }
  const first = paths[0];
  if (!first) return;
  try {
    await tiny.api.call('listDir', { path: first });      // directory? browse it
    listDir(first);
  } catch {
    const parent = first.replace(/\/[^/]+$/, '') || '/';  // file? open it in the editor
    await listDir(parent);
    openFile(first, [...document.querySelectorAll('#dir li')].find((li) => li.dataset.p === first));
  }
});

/* ── window state · restore · setFullscreen · menu.get (0.5.0) ── */

async function showWinState(note) {
  const s = await tiny.win.getState();
  $('stateOut').textContent = (note ? note + '\n\n' : '') + JSON.stringify(s, null, 2);
}
$('stateBtn').addEventListener('click', () => showWinState().catch((e) => { $('stateOut').textContent = String(e); }));
// restore is deminiaturize — it brings a MINIMIZED window back and nothing
// else. It does not leave fullscreen (setFullscreen(false) does that), which
// is what the old comment here claimed.
$('restoreBtn').addEventListener('click', async () => {
  tiny.win.restore();
  await new Promise((r) => setTimeout(r, 150));
  appSay('tiny.win.restore() — un-minimizes; the counterpart to Minimize');
});
// setFullscreen takes an absolute value (unlike fullscreen(), which toggles).
// The transition animates, so read the state back after it settles.
$('fsOnBtn').addEventListener('click', async () => {
  tiny.win.setFullscreen(true);
  await new Promise((r) => setTimeout(r, 650));
  appSay('tiny.win.setFullscreen(true) — absolute, unlike fullscreen() which toggles');
});
$('fsOffBtn').addEventListener('click', async () => {
  tiny.win.setFullscreen(false);
  await new Promise((r) => setTimeout(r, 650));
  appSay('tiny.win.setFullscreen(false) — call it twice and nothing flickers');
});
$('menuGetBtn').addEventListener('click', async () => {
  const item = await tiny.menu.get('m-ontop');          // { exists, label, checked, enabled }
  $('menuGetOut').innerHTML = `<b>${esc(JSON.stringify(item))}</b>` +
    ` <span class="muted">— toggle “Always on top” from either the button or the menu, then read it again</span>`;
});

/* ── deep links & file associations (0.4.0) — packaged .app only ── */

function deepLog(kind, val) {
  const d = document.createElement('div');
  d.innerHTML = `${esc(new Date().toLocaleTimeString())} · <b>${esc(kind)}</b> ${esc(val)}`;
  $('deepFeed').prepend(d);
  while ($('deepFeed').children.length > 40) $('deepFeed').lastChild.remove();
  showTab('app');
}
tiny.app.onOpenUrl((url) => {
  deepLog('url', url);
  tiny.notify('Tiny Deck', 'Opened link — ' + url);
});
tiny.app.onOpenFiles((paths) => {
  for (const p of paths) deepLog('file', p);
  tiny.notify('Tiny Deck', paths.length + ' file(s) opened via association');
});

/* ── window chrome · frameless / transparent / vibrancy (0.7.0) ── */
// State is kept locally and sent whole each time, so the shape is deterministic
// regardless of merge/replace semantics. The deck's <header data-tiny-drag>
// becomes the titlebar when frameless (drag to move, double-click to zoom).

const chromeOpts = { frame: true, controlsOn: true, transparent: false, vibrancy: 'none' };
const chromeErr = (e) => { $('chromeOut').innerHTML = `<span class="bad">${esc(e)}</span>`; };
// windowControls takes true | false | a subset array, so the demo shows both:
// the button is all-or-nothing, the three chips build the array form.
const CONTROL_NAMES = ['close', 'minimize', 'maximize'];
function controlsValue() {
  const picked = CONTROL_NAMES.filter((c) => $('ctlPicks').querySelector(`[data-ctl="${c}"]`).classList.contains('on'));
  if (!chromeOpts.controlsOn) return false;
  return picked.length === CONTROL_NAMES.length ? true : picked;
}
function controlsLabel(v) {
  return v === true ? 'true' : v === false ? 'false' : `['${v.join("','")}']`;
}
async function applyChrome(note) {
  const controls = controlsValue();
  await tiny.win.setChrome({ ...chromeOpts, windowControls: controls });
  toggleLabel($('frameBtn'), chromeOpts.frame, 'Title bar');
  toggleLabel($('lightsBtn'), chromeOpts.controlsOn, 'Window controls');
  toggleLabel($('transpBtn'), chromeOpts.transparent, 'Transparent');
  for (const c of CONTROL_NAMES) {
    const b = $('ctlPicks').querySelector(`[data-ctl="${c}"]`);
    b.disabled = !chromeOpts.controlsOn;
  }
  $('vibrancy').value = chromeOpts.vibrancy;
  // The call is in the CALLS log; this says what the window IS now, which the
  // log can't — plus the bit you'd otherwise have to discover by accident.
  const shape = [
    chromeOpts.frame ? 'titled' : 'frameless',
    controls === true ? 'all controls'
      : controls === false ? 'no controls'
      : `controls: ${controls.join(' + ')}`,
    chromeOpts.transparent ? 'transparent' : 'opaque',
    chromeOpts.vibrancy === 'none' ? null : `vibrancy: ${chromeOpts.vibrancy}`,
  ].filter(Boolean).join(' · ');
  const tip = !chromeOpts.frame ? ' — drag the top header to move the window'
    : chromeOpts.vibrancy !== 'none' && !chromeOpts.transparent
      ? ' — vibrancy renders behind the page, so turn on transparent to see it'
      : '';
  $('chromeOut').innerHTML = (note ? esc(note) + ' — ' : '') + esc(shape) + esc(tip);
}
$('ctlPicks').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-ctl]');
  if (!b || b.disabled) return;
  b.classList.toggle('on');
  applyChrome().catch(chromeErr);
});
$('frameBtn').addEventListener('click', () => { chromeOpts.frame = !chromeOpts.frame; applyChrome().catch(chromeErr); });
$('lightsBtn').addEventListener('click', () => { chromeOpts.controlsOn = !chromeOpts.controlsOn; applyChrome().catch(chromeErr); });
$('transpBtn').addEventListener('click', () => { chromeOpts.transparent = !chromeOpts.transparent; applyChrome().catch(chromeErr); });
$('vibrancy').addEventListener('change', () => { chromeOpts.vibrancy = $('vibrancy').value; applyChrome().catch(chromeErr); });
$('zoomBtn').addEventListener('click', () => {
  tiny.win.zoom();
  // reports into the window-ops readout now, since that's the card it lives on
  appSay('tiny.win.zoom() — toggles the zoom state the green button does (macOS); maximize elsewhere');
});
$('chromeReset').addEventListener('click', () => {
  chromeOpts.frame = true; chromeOpts.controlsOn = true;
  chromeOpts.transparent = false; chromeOpts.vibrancy = 'none';
  for (const c of CONTROL_NAMES) $('ctlPicks').querySelector(`[data-ctl="${c}"]`).classList.add('on');
  applyChrome('reset').catch(chromeErr);
});

/* ── multiple windows (0.8.0) ── */
// The same call the inspector makes, from the main window — the pair is the
// demo, since one answer on its own says nothing.
$('whoamiHere').addEventListener('click', async () => {
  try {
    const r = await tiny.api.call('whoami');
    const open = Array.isArray(r.open) ? r.open : [];
    $('windowsOut').innerHTML =
      `whoami() from <b>this</b> window:\n` +
      `  caller       <b>"${esc(r.caller)}"</b>\n` +
      `  open windows ${open.map((w) => '"' + esc(w) + '"').join(', ') || '(none reported)'}\n\n` +
      `Press the same button in the Inspector — caller comes back <b>"inspector"</b>, ` +
      `from the identical handler.`;
  } catch (e) {
    $('windowsOut').textContent = 'whoami() failed: ' + (e?.message || e);
  }
});

// inspector.html becomes its own native window with the full tiny.* bridge.
// Opening an id that's already open just focuses it (single instance per id).

function windowLog(kind, val) {
  const d = document.createElement('div');
  d.innerHTML = `${esc(new Date().toLocaleTimeString())} · <b>${esc(kind)}</b> ${esc(val)}`;
  $('windowFeed').prepend(d);
  while ($('windowFeed').children.length > 40) $('windowFeed').lastChild.remove();
}
async function refreshWindows() {
  try {
    const ids = await tiny.win.windows();
    $('windowsOut').innerHTML = `tiny.win.windows() → ${ids.map((w) => `<b>${esc(w)}</b>`).join(', ')}`;
    return ids;
  } catch (e) {
    $('windowsOut').innerHTML = `<span class="bad">${esc(e)}</span>`;
    return [];
  }
}
$('openInspector').addEventListener('click', async () => {
  await tiny.win.open('inspector', { page: 'inspector.html', title: 'Inspector', size: '460x420' });
  windowLog('opened', 'inspector');
  refreshWindows();
});
$('listWindows').addEventListener('click', refreshWindows);
$('closeInspector').addEventListener('click', async () => {
  await tiny.win.close('inspector');
  refreshWindows();
});
// backend rebroadcasts closes (see onWindowClosed) so the list stays honest
// even when a window is closed by its own button or the red traffic light.
tiny.api.on('win-closed', ({ id }) => {
  windowLog('closed', id);
  refreshWindows();
});

/* ══════════════ ffi lab ══════════════
   The backend dlopens system dylibs (libSystem, libz) via tjs:ffi and calls
   raw C symbols — sysctlbyname, getpid, compress2 — no bindings, no build. */

let ffiLoaded = false;
async function ffiEnsure() {
  if (ffiLoaded) return;
  ffiLoaded = true;
  try {
    const rows = await tiny.api.call('ffiInfo');
    $('ffiInfo').innerHTML = rows.map((r) =>
      `<dt>${esc(r.label)}</dt><dd>${esc(r.value)} <span class="muted">· ${esc(r.call)}</span></dd>`).join('');
  } catch (e) {
    ffiLoaded = false;
    $('ffiInfo').innerHTML = `<dt>error</dt><dd>${esc(e)}</dd>`;
  }
}

async function querySysctl(name) {
  if (!name) return;
  $('sysctlName').value = name;
  try {
    const r = await tiny.api.call('ffiSysctl', { name });
    $('sysctlOut').innerHTML = `<b class="amber">${esc(r.name)}</b> <span class="muted">(${esc(r.kind)})</span>\n${esc(r.value)}`;
  } catch (e) {
    $('sysctlOut').innerHTML = `<span class="muted">${esc(e)}</span>`;
  }
}
$('sysctlBtn').addEventListener('click', () => querySysctl($('sysctlName').value.trim()));
$('sysctlName').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') querySysctl($('sysctlName').value.trim()); });
$('sysctlChips').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-name]');
  if (b) querySysctl(b.dataset.name);
});

$('zLevel').addEventListener('input', () => { $('zLevelVal').textContent = $('zLevel').value; });
$('zBtn').addEventListener('click', async () => {
  try {
    const r = await tiny.api.call('zlibRoundtrip', { text: $('zText').value, level: Number($('zLevel').value) });
    $('zIn').textContent = fmtBytes(r.inBytes);
    $('zOut').textContent = fmtBytes(r.outBytes);
    $('zBarOut').style.width = Math.min(100, r.outBytes / r.inBytes * 100) + '%';
    const pct = (100 - r.outBytes / r.inBytes * 100).toFixed(1);
    $('zStatus').innerHTML = `<b>${pct}%</b> smaller at level ${r.level} · ${r.ms.toFixed(2)} ms in native code · roundtrip ` +
      (r.roundtrip ? '<span class="ok">intact ✓</span>' : '<span class="bad">MISMATCH</span>');
    $('zHex').innerHTML = esc(r.hexHead) + (r.outBytes > 48 ? ` <span class="muted">… +${r.outBytes - 48} bytes</span>` : '');
  } catch (e) {
    $('zStatus').innerHTML = `<span class="bad">${esc(e)}</span>`;
  }
});

/* ══════════════ system tab (tinyjs 0.3.1: store / hotkey / context / theme / power / print) ══ */

// -- tiny.store: persistent JSON, namespaced by app id --

async function refreshStore() {
  try {
    const all = await tiny.store.all();
    const keys = Object.keys(all);
    $('storeDump').innerHTML = keys.length
      ? keys.map((k) => `<b>${esc(k)}</b> = ${esc(JSON.stringify(all[k]))}`).join('\n')
      : '<span class="muted">(store is empty)</span>';
  } catch (e) {
    $('storeDump').textContent = String(e);
  }
}
$('storeSet').addEventListener('click', async () => {
  const key = $('storeKey').value.trim();
  if (!key) return;
  const raw = $('storeVal').value;
  let value;
  try { value = JSON.parse(raw); } catch { value = raw; }   // accept JSON or bare text
  await tiny.store.set(key, value);
  refreshStore();
});
$('storeDel').addEventListener('click', async () => {
  const key = $('storeKey').value.trim();
  if (!key) return;
  await tiny.store.delete(key);
  refreshStore();
});

// -- tiny.hotkey: system-wide, fires even when the app is unfocused --

let hotkeyOn = false, hotkeyHits = 0;
async function toggleHotkey() {
  const combo = $('hotkeyCombo').value.trim();
  if (hotkeyOn) {
    await tiny.hotkey.unregister('summon');
    hotkeyOn = false;
    $('hotkeyOut').textContent = 'not registered';
  } else {
    if (!combo) return;
    await tiny.hotkey.register('summon', combo);
    hotkeyOn = true;
    $('hotkeyOut').innerHTML = `registered <b>${esc(combo)}</b> — now press it from another app`;
  }
  toggleLabel($('hotkeyBtn'), hotkeyOn, 'Register');
  syncMenuChecks();
}
$('hotkeyBtn').addEventListener('click', () => toggleHotkey().catch((e) => { $('hotkeyOut').textContent = String(e); }));
tiny.hotkey.on((id) => {
  if (id !== 'summon') return;
  hotkeyHits++;
  tiny.win.show();
  tiny.win.center();
  tiny.notify('Tiny Deck', 'Summoned by global hotkey (' + hotkeyHits + '×)');
  showTab('system');
  $('hotkeyOut').innerHTML = `fired <b>${hotkeyHits}×</b> — the combo works even while another app is focused`;
});

// -- tiny.menu.set: declaring the menu bar --
$('menuDemoAdd').addEventListener('click', async () => {
  demoMenuOn = !demoMenuOn;
  await applyMenus();
  toggleLabel($('menuDemoAdd'), demoMenuOn, 'Add a "Demo" menu');
  $('menuDemoOut').innerHTML = demoMenuOn
    ? 'look at the menu bar — <b>Demo</b> is there now, with a ⌘J shortcut, a checkmark, ' +
      'a submenu and a greyed-out item. Pick something from it.'
    : 'gone again — the same <b>menu.set</b> call with the deck\'s menus and nothing appended';
});

// -- tiny.menu.setContext: replace WebKit's right-click menu --

// The custom right-click menu is enabled at boot (see init → setCtx(true)),
// so right-clicking anywhere works from launch; the toggle flips back to
// WebKit’s default with setContext(null).
let ctxOn = false;
async function setCtx(on) {
  ctxOn = on;
  if (on) {
    await tiny.menu.setContext([
      { id: 'ctx-overview', label: 'Jump to Overview' },
      { id: 'ctx-gpu', label: 'Jump to GPU' },
      { separator: true },
      { id: 'ctx-notify', label: 'Send a Notification' },
      { id: 'ctx-print', label: 'Print Page…' },
    ]);
    $('ctxOut').innerHTML = 'custom menu active — <b>right-click anywhere</b>';
  } else {
    await tiny.menu.setContext(null);       // null restores WebKit’s default
    $('ctxOut').textContent = 'using WebKit’s default context menu';
  }
  toggleLabel($('ctxBtn'), ctxOn, 'Custom right-click menu');
}
$('ctxBtn').addEventListener('click', () => setCtx(!ctxOn).catch((e) => { $('ctxOut').textContent = String(e); }));
tiny.menu.onContext((id) => {
  if (id === 'ctx-overview') showTab('overview');
  if (id === 'ctx-gpu') showTab('gpu');
  if (id === 'ctx-notify') tiny.notify('Tiny Deck', 'Sent from the native context menu');
  if (id === 'ctx-print') tiny.win.print();
  if (id) $('ctxOut').innerHTML = `context click → <b>${esc(id)}</b>`;
});

// -- power events + print --

tiny.api.on('sleep', () => logPower('sleep'));
tiny.api.on('wake', () => logPower('wake'));
function logPower(kind) {
  const d = document.createElement('div');
  d.innerHTML = `${esc(new Date().toLocaleTimeString())} · <b>${esc(kind)}</b>`;
  $('powerFeed').prepend(d);
  while ($('powerFeed').children.length > 40) $('powerFeed').lastChild.remove();
}
$('printBtn').addEventListener('click', () => tiny.win.print());

let systemLoaded = false;
async function systemEnsure() {
  applyTheme();                             // refresh the theme readout lines
  if (systemLoaded) return;
  systemLoaded = true;
  refreshStore();
}

/* ══════════════ desktop + power tabs (0.13–0.15) ══════════════
   Desktop: shell verbs / share sheet / screens & captureScreen.
   Power:   dock & sounds / preventSleep · idle · frontmost / launchAtLogin
            & app.paths. */

const shellSay = (el, p) => p
  .then((r) => { $(el).innerHTML = '→ resolved <b>' + esc(JSON.stringify(r)) + '</b>'; })
  .catch((e) => { $(el).innerHTML = '→ rejected: <b>' + esc(e?.message || e) + '</b>'; });

// -- shell verbs + Quick Look, all pointed at one demo file --

let demoFile = null;
$('demoMake').addEventListener('click', async () => {
  const { path } = await tiny.api.call('makeDemoFile');
  demoFile = path;
  $('demoPath').textContent = path;
  $('shellOut').innerHTML = 'demo file written — now <b>Reveal</b> / <b>Quick Look</b> / <b>Open</b> / <b>Trash</b> it';
});
const needDemo = () => {
  if (!demoFile) $('shellOut').innerHTML = '<b>make the demo file first</b> — or Trash already ate it (rejects tell you)';
  return demoFile;
};
$('shReveal').addEventListener('click', () => needDemo() && shellSay('shellOut', tiny.app.shell.reveal(demoFile)));
$('shOpen').addEventListener('click', () => needDemo() && shellSay('shellOut', tiny.app.shell.open(demoFile)));
$('shTrash').addEventListener('click', () => needDemo() && shellSay('shellOut', tiny.app.shell.trash(demoFile)));
$('shQl').addEventListener('click', () => { if (needDemo()) { tiny.macos.quickLook(demoFile); $('shellOut').textContent = 'Quick Look panel is up — space/esc closes it'; } });
$('shOpenUrl').addEventListener('click', () => shellSay('shellOut', tiny.app.shell.open($('shUrl').value.trim())));

// -- what this machine is, and what it's missing --

let lastInstallCmd = '';
$('sysCheck').addEventListener('click', async () => {
  const out = $('sysOut');
  out.textContent = 'probing…';
  try {
    const [info, caps, reqs] = await Promise.all([
      tiny.system.info(), tiny.system.capabilities(), tiny.system.requirements(),
    ]);
    const lines = [];
    lines.push(`${info.os} · ${info.arch}` + (info.session ? ` · ${info.session}` : '')
      + (info.desktop ? ` · ${info.desktop}` : ''));
    lines.push('');
    const off = Object.entries(caps).filter(([k, v]) => k !== 'os' && v === false).map(([k]) => k);
    lines.push(off.length ? `unavailable here: ${off.join(', ')}` : 'every capability available');
    lines.push('');
    for (const r of reqs) {
      lines.push(`${r.ok ? '✓' : '✗'} ${r.feature}`);
      if (!r.ok) lines.push(`    ${r.install ? r.install.command : r.detail}`);
    }
    const firstFix = reqs.find((r) => !r.ok && r.install);
    lastInstallCmd = firstFix ? firstFix.install.command : '';
    $('sysCopy').hidden = !lastInstallCmd;
    out.textContent = lines.join('\n');
  } catch (e) {
    out.innerHTML = `<span class="bad">${esc(e.message || String(e))}</span>`;
  }
});
$('sysCopy').addEventListener('click', async () => {
  await tiny.clipboard.write({ text: lastInstallCmd });
  flash('install command copied');
});

// -- system colour picker (macOS loupe / Linux Screenshot portal) --

$('pickColorBtn').addEventListener('click', async () => {
  const out = $('colorOut');
  out.textContent = 'eyedropper open — click anywhere on screen…';
  try {
    const hex = await tiny.app.pickColor();
    if (!hex) { out.textContent = 'cancelled'; return; }
    $('colorSwatch').style.background = hex;
    out.innerHTML = `picked <b>${esc(hex)}</b>`;
  } catch (e) {
    out.innerHTML = `<span class="bad">${esc(e.message || String(e))}</span>`;
  }
});

// -- native share sheet, anchored at the click --

let shareAttach = false;
$('shareFile').addEventListener('click', () => {
  shareAttach = !shareAttach;
  toggleLabel($('shareFile'), shareAttach, 'Attach demo file');
});
$('shareBtn').addEventListener('click', (ev) => {
  const opts = { x: ev.clientX, y: ev.clientY };
  const text = $('shareText').value.trim(), url = $('shareUrl').value.trim();
  if (text) opts.text = text;
  if (url) opts.url = url;
  if (shareAttach && demoFile) opts.paths = [demoFile];
  tiny.win.share(opts);
  $('shareOut').textContent = 'share sheet raised at (' + ev.clientX + ', ' + ev.clientY + ')' +
    (opts.paths ? ' with the demo file attached' : '');
});

// -- displays + captureScreen --

async function refreshScreens() {
  const screens = await tiny.app.screens();
  const wrap = $('screensList');
  wrap.textContent = '';
  for (const s of screens) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = `${s.primary ? '★ ' : ''}${s.name || 'display ' + s.id} — ` +
      `${s.width}×${s.height} @${s.scale}x at (${s.x}, ${s.y}) · visible ${s.visible.width}×${s.visible.height}`;
    const btn = document.createElement('button');
    btn.textContent = '📸';
    btn.title = 'captureScreen(' + s.id + ')';
    btn.addEventListener('click', async () => {
      $('shotImg').hidden = true;
      try {
        const shot = await tiny.app.captureScreen(s.id);
        const { uri, bytes } = await tiny.api.call('readShot', { path: shot.path });
        $('shotImg').src = uri;
        $('shotImg').hidden = false;
        $('shotOut').innerHTML = `captured <b>${shot.width}×${shot.height}</b> → ${esc(shot.path)} (${fmtBytes(bytes)})`;
      } catch (e) {
        $('shotOut').innerHTML = 'rejected: <b>' + esc(e?.message || e) + '</b> — the onboarding hook (see pasta/deja for the full permission-gate recipe)';
      }
    });
    row.append(label, btn);
    wrap.appendChild(row);
  }
}

// -- app icon: badge / progress / attention --

// app.progress — new in 0.30. The slider sets it directly; "Run to 100%"
// walks it so you can watch the tile fill, which is the thing worth seeing.
$('progressVal').addEventListener('input', async () => {
  const pct = +$('progressVal').value;
  $('progressN').textContent = pct + '%';
  await tiny.app.progress(pct / 100);
  $('dockIconOut').textContent = `progress at ${pct}% — watch the app icon`;
});
$('progressRun').addEventListener('click', async () => {
  for (let pct = 0; pct <= 100; pct += 2) {
    $('progressVal').value = pct;
    $('progressN').textContent = pct + '%';
    await tiny.app.progress(pct / 100);
    $('dockIconOut').textContent = `filling — ${pct}% — watch the app icon`;
    await new Promise((r) => setTimeout(r, 60));
  }
});
$('progressClear').addEventListener('click', async () => {
  await tiny.app.progress(null);
  $('dockIconOut').textContent = 'bar cleared — any icon you set is untouched';
});
$('badgeSet').addEventListener('click', () => { tiny.app.badge($('badgeText').value); $('dockIconOut').textContent = 'badge set — check the Dock tile'; });
$('badgeClear').addEventListener('click', () => { tiny.app.badge(''); $('dockIconOut').textContent = 'badge cleared'; });
const armBounce = (critical) => {
  $('dockIconOut').textContent = 'switch to another app now — bouncing in 3 s…';
  setTimeout(() => tiny.app.attention(critical ? { critical: true } : undefined), 3000);
};
$('bounceBtn').addEventListener('click', () => armBounce(false));
$('bounceCrit').addEventListener('click', () => armBounce(true));
/* ══════════════ media tab ══════════════ */

// -- system sounds: portable names vs this platform's own --
// Each OS ships alert sounds under names that mean nothing to the others, so
// the deck reads the real list for THIS machine and keeps a foreign name to
// hand — pressing it is the fastest way to see what "not portable" costs.
const SOUND_SETS = {
  macos: ['Ping', 'Glass', 'Basso', 'Funk', 'Submarine', 'Hero', 'Purr', 'Pop',
          'Sosumi', 'Tink', 'Bottle', 'Blow', 'Frog', 'Morse'],
  windows: ['SystemAsterisk', 'SystemExclamation', 'SystemHand', 'SystemQuestion',
            'SystemNotification', 'SystemExit', 'SystemStart'],
  linux: ['bell', 'message', 'complete', 'dialog-error', 'dialog-information',
          'dialog-warning', 'device-added', 'device-removed', 'window-attention'],
};
const SOUND_OS_LABEL = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

const soundSay = (html) => { $('soundOut').innerHTML = html; };
const playAndReport = async (name, note = '') => {
  const ok = await tiny.app.playSound(name);
  soundSay(ok
    ? `<b>${esc(name)}</b> played${note}`
    : `<b>${esc(name)}</b> → <b>false</b> — this platform has no such sound${note}`);
};

$('beepBtn').addEventListener('click', async () => {
  await tiny.app.beep();
  soundSay('<b>beep()</b> — the same call on every OS, no name needed');
});

for (const b of document.querySelectorAll('.sfx')) {
  b.addEventListener('click', () => {
    const meaning = b.dataset.sound;
    playAndReport(meaning, ` — portable name, resolved by ${SOUND_OS_LABEL[tiny.system.os()]}`);
  });
}

{
  const myOs = tiny.system.os();
  const sel = $('soundName');
  for (const n of SOUND_SETS[myOs] ?? []) sel.add(new Option(n, n));
  $('soundNative').textContent = SOUND_OS_LABEL[myOs] ?? myOs;
  // A name that is real somewhere else and meaningless here.
  const foreignOs = myOs === 'macos' ? 'windows' : 'macos';
  const foreign = SOUND_SETS[foreignOs][0];
  const wrong = $('soundWrong');
  wrong.textContent = `Play "${foreign}" (${SOUND_OS_LABEL[foreignOs]}-only)`;
  wrong.addEventListener('click', () =>
    playAndReport(foreign, ` — it's a real ${SOUND_OS_LABEL[foreignOs]} sound, so this is what porting a hardcoded name looks like`));
}
$('soundPlay').addEventListener('click', () => playAndReport($('soundName').value));

// -- native audio filters (tiny.audio.*) --
// The chain SHAPE stays fixed at three bands so every slider drag is a retune
// (filter(i, …), no gap) rather than a rebuild. That's the pattern worth
// copying: pass the same list of types every time and vary only the numbers.
const EQ_SHAPE = [
  { type: 'lowshelf', freq: 200, q: 0.7 },
  { type: 'peaking', freq: 1000, q: 1.0 },
  { type: 'highshelf', freq: 4000, q: 0.7 },
];
const eqDb = [0, 0, 0];
let eqOn = false, eqAudio = null;

const eqBands = () => EQ_SHAPE.map((f, i) => ({ ...f, gain: eqDb[i] }));
const eqBalValue = () => +$('eqBal').value / 100;

// Cached: capabilities() can't change under a running app, and the state
// read-back below runs once a second while the track plays.
let eqCaps = null;

async function eqRefreshState() {
  const cap = eqCaps || (eqCaps = await tiny.system.capabilities());
  $('eqCap').textContent = String(cap.audioFilters);
  if (!cap.audioFilters) {
    $('eqState').textContent = 'unsupported';
    $('eqWhy').innerHTML = `<b>${esc(cap.os)}</b> has no native chain — this is where an app
      falls back to Web Audio's BiquadFilterNode, which works properly here.`;
    return;
  }
  // macOS exposes the honest state: a chain can be set and not yet filtering.
  let s = null;
  try { s = await window.__invoke(JSON.stringify({ method: 'debug.get', params: { what: 'audiofilters' } })); }
  catch { /* Linux has no such read-back */ }
  if (!s || !s.state) {
    $('eqState').textContent = eqOn ? 'active' : 'off';
    $('eqWhy').textContent = 'PipeWire filter-chain — a chain is either up or it isn\'t.';
    return;
  }
  $('eqState').textContent = s.state + ` (${s.filters} filter${s.filters === 1 ? '' : 's'})`;
  $('eqWhy').innerHTML =
    s.state === 'active'
      ? 'Filtering. The tap proved it can hear this app, so it muted the direct path and took over.'
      : s.state === 'waiting'
      ? `Armed but <b>not</b> filtering — and deliberately so. Taking audio off the speakers
         needs the system-audio-capture permission, which macOS grants per <b>bundle id</b>,
         so it only engages in a packaged app. An unauthorized tap doesn't error, it returns
         <b>silence</b> — muting on that would kill your audio outright, so the chain refuses
         to mute until it has heard a real sample. You keep unfiltered audio instead.`
      : 'No chain set.';
}

// One switch for the whole chain: filters() puts it up with whatever the
// sliders are staging, clear() takes it down. While it's down the sliders only
// stage — an "off" that quietly turns itself back on at the next drag (which
// is what auto-arming did here before) isn't an off at all.
$('eqOn').addEventListener('click', async () => {
  eqOn = !eqOn;
  toggleLabel($('eqOn'), eqOn, 'EQ');
  if (eqOn) {
    await tiny.audio.filters(eqBands());
    // Balance rides on the chain, so it has to be re-sent once the chain is up.
    const b = eqBalValue();
    if (b !== 0) await tiny.audio.balance(b);
    $('eqOut').textContent =
      `filters([lowshelf 200, peaking 1k, highshelf 4k]) — chain up at ${eqDb.join(' / ')} dB`;
  } else {
    await tiny.audio.clear();
    $('eqOut').textContent = 'clear() — chain down, unprocessed output restored';
  }
  eqRefreshState();
});

const eqStaged = (what) =>
  `${what} staged — switch the EQ on to hear it`;

for (const [i, id, label] of [[0, 'eqLow', 'eqLowN'], [1, 'eqMid', 'eqMidN'], [2, 'eqHigh', 'eqHighN']]) {
  $(id).addEventListener('input', async () => {
    eqDb[i] = +$(id).value;
    $(label).textContent = (eqDb[i] > 0 ? '+' : '') + eqDb[i] + ' dB';
    if (!eqOn) { $('eqOut').textContent = eqStaged(eqDb.join(' / ') + ' dB'); return; }
    await tiny.audio.filter(i, { ...EQ_SHAPE[i], gain: eqDb[i] });
    $('eqOut').textContent = `filter(${i}, { gain: ${eqDb[i]} }) — retuned in place`;
  });
}
$('eqBal').addEventListener('input', async () => {
  const v = eqBalValue();
  const where = v === 0 ? 'centre'
    : v < 0 ? `${Math.round(-v * 100)}% left` : `${Math.round(v * 100)}% right`;
  $('eqBalN').textContent = where;
  if (!eqOn) { $('eqOut').textContent = eqStaged('balance ' + where); return; }
  await tiny.audio.balance(v);
  $('eqOut').textContent = `balance(${v.toFixed(2)}) — rides on the chain, costs no filter slot`;
});

// A source to hear the filters on: a real track through a plain <audio>
// element, shipped in the frontend dir so the relative URL resolves the same
// in dev and in a packaged build. The page never touches a sample of it —
// which is exactly the demonstration, since the FILTER is native and rides on
// whatever the app plays, Web Audio or not. Music beats a sine here: a shelf
// is obvious on a mix and nearly inaudible on a single tone.
const EQ_TRACK = 'media/Power%20Surge.opus';   // Ogg Opus — all three webviews decode it

const eqIdleLabel = () => { $('eqTrack').textContent = 'Power Surge · loops'; };

$('eqTone').addEventListener('click', async () => {
  if (!eqAudio) {
    eqAudio = new Audio(EQ_TRACK);
    eqAudio.loop = true;
    eqAudio.volume = 0.4;
    // A codec the webview can't decode fails through this event and nothing
    // else — without it the button would just look inert.
    eqAudio.addEventListener('error', () => {
      const e = eqAudio.error;
      $('eqTrack').textContent = `can't decode the track (media error ${e ? e.code : '?'})`;
      $('eqTone').textContent = '▶ Play';
    });
    let eqTick = -1;
    eqAudio.addEventListener('timeupdate', () => {
      if (eqAudio.paused) return;
      const t = Math.floor(eqAudio.currentTime);
      $('eqTrack').textContent =
        `Power Surge · ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} · loops`;
      // The chain state is not static: on macOS it sits at "waiting" until the
      // tap hears its first real sample, then flips to "active" on its own.
      // Poll while something is actually playing so the read-back says so.
      if (eqOn && t !== eqTick && t % 2 === 0) { eqTick = t; eqRefreshState(); }
    });
  }
  if (!eqAudio.paused) {
    eqAudio.pause();
    $('eqTone').textContent = '▶ Play';
    eqIdleLabel();
    return;
  }
  try {
    await eqAudio.play();
    $('eqTone').textContent = '■ Stop';
  } catch (e) {
    $('eqTrack').textContent = 'play() rejected: ' + e.message;
  }
});


// -- power assertion + live idle / frontmost readouts --

let sleepOn = false, sleepDisplay = false;
$('sleepDisplay').addEventListener('click', () => {
  sleepDisplay = !sleepDisplay;
  toggleLabel($('sleepDisplay'), sleepDisplay, 'keep display on');
});
$('sleepBtn').addEventListener('click', async () => {
  if (sleepOn) {
    await tiny.app.power.allowSleep();
    sleepOn = false;
    $('powerState').textContent = 'none';
  } else {
    await tiny.app.power.preventSleep($('sleepReason').value.trim() || 'Tiny Deck demo',
      sleepDisplay ? { display: true } : undefined);
    sleepOn = true;
    $('powerState').textContent = 'active' + (sleepDisplay ? ' (display too)' : '') + ' — see pmset -g assertions';
  }
  toggleLabel($('sleepBtn'), sleepOn, 'Prevent sleep');
});

// Live rows tick only while the Power panel is showing — no idle bridge chatter.
setInterval(async () => {
  if (activeTab !== 'system') return;
  try {
    const [idle, front] = await Promise.all([tiny.system.idleTime(), tiny.app.frontmostApp()]);
    $('idleOut').textContent = idle.toFixed(1) + ' s';
    $('frontOut').textContent = front ? `${front.name ?? '?'} (${front.bundleId ?? 'no bundle id'}, pid ${front.pid})` : '—';
  } catch { /* pre-0.15 launcher */ }
}, 1000);

// -- launch at login + the standard per-app paths --

let loginOn = false;
async function paintLogin(status) {
  loginOn = status === 'enabled';
  $('loginStatus').textContent = status;
  toggleLabel($('loginBtn'), loginOn, 'Launch at login');
  $('loginBtn').disabled = status === 'unsupported';
}
$('loginBtn').addEventListener('click', async () => {
  paintLogin(await tiny.app.launchAtLogin.set(!loginOn));
});

async function refreshPaths() {
  const paths = await tiny.app.paths();
  const wrap = $('pathsList');
  wrap.textContent = '';
  for (const [key, value] of Object.entries(paths)) {
    // .pathrow keeps the ↗ pinned right and lets the path itself wrap — these
    // are long and contain no spaces, so without an explicit break opportunity
    // they run straight off the side of the card.
    const row = document.createElement('div');
    row.className = 'pathrow';
    const label = document.createElement('span');
    label.innerHTML = `<b>${esc(key)}</b> ${esc(value)}`;
    const btn = document.createElement('button');
    btn.textContent = '↗';
    btn.title = 'shell.reveal';
    btn.addEventListener('click', () => shellSay('pathsOut', tiny.app.shell.reveal(value)));
    row.append(label, btn);
    wrap.appendChild(row);
  }
}

async function initDesktop() {
  try {
    await Promise.all([refreshScreens(), refreshPaths()]);
    paintLogin(await tiny.app.launchAtLogin.get());
  } catch (e) {
    $('screensList').textContent = 'needs tinyjs 0.15+ (' + (e?.message || e) + ')';
  }
}

/* ══════════════ latest tab (0.16–0.22) ══════════════
   battery / wifi live readouts, trackpad haptics, dynamic Dock icon,
   Spotlight search, and win.printToPDF. */

// -- battery + wifi: refresh only while the tab is showing --

async function refreshBatteryWifi() {
  try {
    const [bat, net] = await Promise.all([tiny.system.battery(), tiny.system.wifi()]);
    $('batOut').textContent = bat
      ? `${bat.percent}% · ${bat.charging ? '⚡ charging' : bat.plugged ? 'plugged in' : 'on battery'}` +
        (bat.minutesRemaining > 0 ? ` · ~${Math.floor(bat.minutesRemaining / 60)}h ${bat.minutesRemaining % 60}m left` : '')
      : 'null — no battery (desktop Mac)';
    $('wifiOut').textContent = net
      ? `${net.ssid || '(ssid needs Location)'} · ${net.rssi} dBm · ${net.txRate} Mbps`
      : 'null — Wi-Fi off / not connected';
  } catch (e) {
    $('batOut').textContent = 'needs tinyjs 0.22+ (' + (e?.message || e) + ')';
  }
}
setInterval(() => { if (activeTab === 'system') refreshBatteryWifi(); }, 2000);

// -- trackpad haptics --

for (const [id, pattern] of [['hapGeneric', 'generic'], ['hapAlign', 'alignment'], ['hapLevel', 'level']]) {
  $(id).addEventListener('click', () => {
    tiny.macos.haptic(pattern);
    $('hapOut').innerHTML = `haptic(<b>'${pattern}'</b>) — feel the trackpad`;
  });
}
let hapDetent = 0;
$('hapSlider').addEventListener('input', () => {
  const v = Number($('hapSlider').value);
  if (v === hapDetent) return;
  hapDetent = v;
  tiny.macos.haptic('alignment');
  $('hapOut').innerHTML = `detent <b>${v}</b> — alignment tap`;
});

// -- live app icon: canvas → temp png (backend) → app.icon --

function drawDockRing(pct) {
  const cv = $('dockCv'), c = cv.getContext('2d');
  c.clearRect(0, 0, 128, 128);
  c.fillStyle = '#1c2634';                        // rounded tile backing
  c.beginPath();
  c.roundRect(6, 6, 116, 116, 26);
  c.fill();
  c.lineWidth = 12;
  c.lineCap = 'round';
  c.strokeStyle = '#33404f';                      // track
  c.beginPath(); c.arc(64, 64, 42, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = '#4cc2ff';                      // progress
  c.beginPath(); c.arc(64, 64, 42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct / 100); c.stroke();
  c.fillStyle = '#e8f2ff';
  c.font = 'bold 28px -apple-system, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(pct + '%', 64, 65);
}
$('dockPct').addEventListener('input', () => drawDockRing(Number($('dockPct').value)));
$('dockApply').addEventListener('click', async () => {
  try {
    const { path } = await tiny.api.call('appIconPng', { b64: $('dockCv').toDataURL('image/png').split(',')[1] });
    $('dockIconOut').innerHTML = 'the app icon is now this canvas → ' + esc(path);
  } catch (e) {
    $('dockIconOut').innerHTML = '<span class="bad">' + esc(e?.message || e) + '</span>';
  }
});
$('dockReset').addEventListener('click', () => {
  tiny.app.icon('');
  $('dockIconOut').innerHTML = "back to the bundle icon — app.icon('')";
});
drawDockRing(65);

// -- Spotlight --

async function runSpotlight() {
  const q = $('spotQ').value.trim();
  if (!q) return;
  $('spotList').innerHTML = '<span class="muted">searching…</span>';
  try {
    const hits = await tiny.app.spotlight(q);
    const wrap = $('spotList');
    wrap.textContent = '';
    if (!hits.length) { wrap.innerHTML = '<span class="muted">no hits</span>'; return; }
    for (const p of hits.slice(0, 20)) {
      const row = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = p;
      const btn = document.createElement('button');
      btn.textContent = '↗';
      btn.title = 'shell.reveal';
      btn.addEventListener('click', () => tiny.app.shell.reveal(p).catch(() => {}));
      row.append(label, btn);
      wrap.appendChild(row);
    }
    if (hits.length > 20) {
      const more = document.createElement('div');
      more.innerHTML = `<span class="muted">… +${hits.length - 20} more shown of the API's 100-path cap</span>`;
      wrap.appendChild(more);
    }
  } catch (e) {
    $('spotList').innerHTML = '<span class="bad">' + esc(e?.message || e) + '</span>';
  }
}
$('spotBtn').addEventListener('click', runSpotlight);
$('spotQ').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') runSpotlight(); });

// -- print this page to a vector PDF --

$('pdfBtn').addEventListener('click', async () => {
  const dest = await tiny.dialog.saveFile();
  if (!dest) { $('pdfOut').textContent = 'save panel cancelled'; return; }
  const path = dest.endsWith('.pdf') ? dest : dest + '.pdf';
  try {
    const r = await tiny.win.printToPDF(path);
    $('pdfOut').innerHTML = 'wrote <b>' + esc(r?.path || path) + '</b> — revealing it';
    tiny.app.shell.reveal(r?.path || path).catch(() => {});
  } catch (e) {
    $('pdfOut').innerHTML = '<span class="bad">' + esc(e?.message || e) + '</span>';
  }
});

/* ══════════════ boot ══════════════ */

async function init() {
  await tiny.api.call('ping');
  $('dot').classList.add('ok');
  $('linkState').textContent = 'up';

  const info = await tiny.api.call('sysinfo');
  $('sysinfo').innerHTML = Object.entries(info)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('notesDb').innerHTML = 'stored in <b>' + esc(info.db) + '</b> via tjs:sqlite';
  $('dbPath').textContent = info.db;
  dbFile = info.db;

  // version introspection (0.5.0): tiny.app.info() reports the app's own version
  // (from tinyjs.json), the tinyjs framework build, and the txiki runtime.
  try {
    const ai = await tiny.app.info();
    $('sysinfo').insertAdjacentHTML('afterbegin',
      `<dt>app version</dt><dd>${esc(ai.version)} <span class="muted">· tiny.app.info()</span></dd>` +
      `<dt>tinyjs build</dt><dd>${esc(ai.tinyjs)}</dd>` +
      `<dt>runtime</dt><dd>${esc(ai.runtime)}</dd>`);
  } catch { /* older runtime without app.info */ }

  listDir(info.home);
  renderNotes(await tiny.api.call('notesList'));
  wasmInit().catch((e) => { $('wasmHex').textContent = 'wasm failed: ' + e; });

  // seed the native theme (0.3.1); may be null until the launcher reports it,
  // in which case applyTheme() falls back to matchMedia and tiny.theme.on
  // fills it in a moment later.
  nativeDark = (await tiny.theme.get())?.dark ?? null;

  // show where tiny.store actually writes (namespaced by the app id)
  try {
    const si = await tiny.api.call('storeInfo');
    $('storePath').textContent = si.dir + '/store.json';
  } catch { /* non-critical */ }

  // restore persisted prefs — now via tiny.store (0.3.1) instead of the old
  // sqlite prefs table.
  const [savedTheme, savedTab] = await Promise.all([
    tiny.store.get('theme'),
    tiny.store.get('tab'),
  ]);
  if (savedTheme) { themeMode = savedTheme; applyTheme(); }
  if (savedTab && document.getElementById('panel-' + savedTab)) showTab(savedTab, false);

  deckMenuSpec = [
    {
      title: 'View',
      items: [
        { id: 'tab:overview', label: 'Overview', key: '1' },
        { id: 'tab:app', label: 'App', key: '2' },
        { id: 'tab:storage', label: 'Storage', key: '3' },
        { id: 'tab:desktop', label: 'Desktop', key: '4' },
        { id: 'tab:system', label: 'System', key: '5' },
        { id: 'tab:media', label: 'Media', key: '6' },
        { id: 'tab:gpu', label: 'GPU', key: '7' },
        { id: 'tab:wasm', label: 'WASM', key: '8' },
        { id: 'tab:misc', label: 'Misc', key: '9' },
      ],
    },
    {
      title: 'Actions',
      items: [
        { id: 'open', label: 'Open File…', key: 'o' },
        { id: 'rename', label: 'Rename Window', key: 'r' },
        // 0.5.0 stateful menus: a nested submenu of checkable items whose ✓
        // tracks live app state (see syncMenuChecks + tiny.menu.update).
        { id: 'toggles', label: 'Toggles', submenu: [
          { id: 'm-watch', label: 'Watch Current Folder', key: 'w', checked: !!watching },
          { id: 'm-tray', label: 'Tray Mode', key: 't', checked: trayOn },
          { id: 'm-ontop', label: 'Always on Top', checked: onTop },
          { id: 'm-hideclose', label: 'Hide on Close', checked: hideOnCloseOn },
          { id: 'm-hotkey', label: 'Global Hotkey', key: 'k', checked: hotkeyOn },
        ] },
        { separator: true },
        { id: 'print', label: 'Print…', key: 'p' },
        { id: 'hello', label: 'Say Hello' },
        { id: 'check-updates', label: 'Check for Updates…' },
        { id: 'soon', label: 'More (coming soon)', enabled: false },   // grayed out
      ],
    },
  ];
  await applyMenus();
  menusReady = true;
  tiny.menu.on((id) => {
    if (id.startsWith('tab:')) return showTab(id.slice(4));
    if (id === 'open') $('openBtn').click();
    if (id === 'rename') $('retitle').click();
    if (id === 'm-watch') { openPane('storage', 'files'); toggleWatch(); }
    if (id === 'm-tray') { showTab('app'); setTray(!trayOn); }
    if (id === 'm-ontop') { showTab('app'); $('ontopBtn').click(); }
    if (id === 'm-hideclose') { showTab('app'); setHideOnClose(!hideOnCloseOn); }
    if (id === 'm-hotkey') { showTab('system'); toggleHotkey(); }
    if (id === 'print') tiny.win.print();
    if (id === 'hello') tiny.dialog.alert('Hello!', 'This came from a native menu item.');
    if (id === 'check-updates') checkForUpdates();
    // The Demo menu's ids arrive at this same handler — there is only ever one.
    if (id.startsWith('demo-')) {
      openPane('app', 'menus');
      $('menuDemoOut').innerHTML = `<b>${esc(id)}</b> clicked — every item in every menu ` +
        'comes back to the one <b>tiny.menu.on</b> handler, identified only by its id';
    }
  });

  // custom right-click menu on by default — right-click anywhere from launch
  setCtx(true).catch(() => {});

  initDesktop();
  eqRefreshState().catch(() => {});
}

applyTheme();   // runs last: everything above is declared by now
init().catch((e) => {
  $('linkState').textContent = 'error';
  $('dirErr').textContent = 'init failed: ' + e;
});


// ── self-update: the page drives it here (this app owns its own menus) ─────
async function checkForUpdates() {
  try {
    const r = await tiny.api.call('update.check');
    if (r && r.available) {
      const go = await tiny.dialog.confirm('Version ' + r.latest + ' is available', {
        detail: (r.notes || '') + '\nInstall and relaunch now?', ok: 'Update', cancel: 'Later',
      });
      if (go) await tiny.api.call('update.install');
    } else {
      await tiny.dialog.alert("You're up to date", 'v' + ((r && r.current) || '') + ' is the latest.');
    }
  } catch (e) {
    await tiny.dialog.alert('Update check failed', String((e && e.message) || e));
  }
}
tiny.api.on('update-available', (info) => {
  tiny.notify('Update available', 'v' + info.latest + ' is ready — Actions menu → Check for Updates…');
});
