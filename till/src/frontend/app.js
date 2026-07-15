// Till frontend — a thin renderer over the backend's state snapshots.
// Every mutation (start/stop/add/edit/delete) is a round-trip that returns a
// fresh snapshot; we paint it. The backend keeps time (it survives the window
// being hidden), and pushes a 'tick' each second so the running row + tray stay
// live. Nothing here keeps its own clock.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
function icon(id, cls) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s; }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DLET = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const two = (n) => (n < 10 ? '0' + n : '' + n);
const fmtHM = (s) => Math.floor(s / 3600) + ':' + two(Math.floor((s % 3600) / 60));
const fmtHMS = (s) => Math.floor(s / 3600) + ':' + two(Math.floor((s % 3600) / 60)) + ':' + two(s % 60);
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

let data = null;          // last snapshot
let sel = null;           // selected YYYY-MM-DD
let runSecAtLoad = 0;     // running seconds when this snapshot loaded (for live deltas)
let projById = {};        // id → { id, name, client, color, tasks }
let runTimeEl = null;     // the running row's <time> node

// open the standalone New/Edit entry window (the backend owns that window)
const openEntry = (editId) => tiny.api.call('openEntryWindow', editId ? { editId } : {});

async function load(date) {
  data = await tiny.api.call('state', date ? { date } : {});
  sel = data.selDate;
  projById = {};
  for (const c of data.catalog) for (const p of c.projects) projById[p.id] = { ...p, client: c.client, color: c.color };
  runSecAtLoad = data.running ? data.running.seconds : 0;
  render();
}

function render() { renderHeader(); renderWeek(); renderBody(); }

function dateLabel(ds) {
  const d = parseYmd(ds), t = parseYmd(data.today);
  const dd = Math.round((d - t) / 864e5);
  const tail = ', ' + d.getDate() + ' ' + MON[d.getMonth()];
  if (dd === 0) return 'Today' + tail;
  if (dd === -1) return 'Yesterday' + tail;
  if (dd === 1) return 'Tomorrow' + tail;
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + tail;
}
function renderHeader() { $('hdrDate').textContent = dateLabel(sel); }

function renderWeek() {
  const days = $('days'); days.innerHTML = '';
  const delta = data.running ? (data.running.seconds - runSecAtLoad) : 0;
  for (const w of data.week) {
    const d = parseYmd(w.date);
    const isSel = w.date === sel, isToday = w.date === data.today;
    let total = w.total;
    if (data.running && data.running.date === w.date) total += delta;   // keep running day live
    const col = el('div', 'day' + (isSel ? ' sel' : '') + (isToday ? ' today' : '') + (total > 0 ? ' has' : ''));
    col.appendChild(el('div', 'dl', DLET[d.getDay()]));
    col.appendChild(el('div', 'dt', fmtHM(total)));
    col.onclick = () => { if (w.date !== sel) load(w.date); };
    days.appendChild(col);
  }
}

function renderBody() {
  const body = $('body'); body.innerHTML = ''; runTimeEl = null;
  if (!data.entries.length) { body.appendChild(emptyState()); return; }
  for (const e of data.entries) body.appendChild(entryRow(e));
}

function emptyState() {
  const wrap = el('div', 'empty');
  const q = el('div', 'q', data.quote.text);
  q.appendChild(el('span', 'by', '— ' + data.quote.author));
  const btn = el('button', 'add', 'Add New Entry');
  btn.onclick = () => openEntry();
  wrap.append(q, btn);
  return wrap;
}

function entryRow(e) {
  const row = el('div', 'entry' + (e.running ? ' run' : ''));
  const meta = el('div', 'meta');
  if (e.client) meta.appendChild(el('div', 'cl', e.client));
  meta.appendChild(el('div', 'pj', e.project));
  if (e.task) meta.appendChild(el('div', 'tk', e.task));
  if (e.notes) meta.appendChild(el('div', 'nt', e.notes));
  const time = el('div', 'time', e.running ? fmtHMS(e.seconds) : fmtHM(e.seconds));
  if (e.running) runTimeEl = time;
  const tog = el('button', 'tog');
  tog.appendChild(icon(e.running ? 'i-stop' : 'i-play'));
  tog.onclick = (ev) => { ev.stopPropagation(); toggleEntry(e); };
  row.append(meta, time, tog);
  row.oncontextmenu = (ev) => { ev.preventDefault(); openContext(ev, e); };
  return row;
}

async function toggleEntry(e) {
  data = await tiny.api.call(e.running ? 'stopTimer' : 'startTimer', { id: e.id });
  postMutate();
}
function postMutate() { sel = data.selDate; runSecAtLoad = data.running ? data.running.seconds : 0; render(); }

// ── live tick from the backend ──────────────────────────────────────────────
tiny.api.on('tick', (t) => {
  if (!data || !data.running || t.id !== data.running.id) return;
  data.running.seconds = t.seconds;
  if (runTimeEl) runTimeEl.textContent = t.text;
  renderWeek();
  if (summaryOpen) patchSummary();
});
tiny.api.on('anchor', (a) => { anchor = a; document.documentElement.style.setProperty('--ptr', a.pointer); });
tiny.api.on('refresh', () => load(sel));
// a global hotkey (Preferences → Shortcuts) asked for a specific view
tiny.api.on('open-view', (v) => {
  closePops();
  if (v === 'summary') openSummary($('btnInfo'));
  else if (v === 'favorites') openFavs($('btnFav'));
});

// ── tear-off: drag the header to rip the popover off the menu bar ───────────
// Attached, it's a popover (pointer, floating, hides on blur). Drag it past a
// threshold and it "tears": traffic lights appear, it becomes a plain window
// (resizable, survives blur). Drag it back under the tray icon — the pointer
// pokes out again to say "I'll re-attach" — and release to snap it home.
// The page owns the drag (pointer capture + setPosition, same trick as the
// entry window); the backend owns the mode.
let mode = 'attached';
let anchor = null;                 // { x, y, pointer } — the attached window rect
let dragWin = null;

tiny.api.on('mode', (m) => {
  mode = m.detached ? 'detached' : 'attached';
  document.body.classList.toggle('detached', !!m.detached);
  document.body.classList.remove('torn', 'will-attach');
});

const NEAR_Y = 44, NEAR_X = 140;   // "close enough to snap back" box around the anchor
const nearAnchor = (x, y) => !!anchor && Math.abs(y - anchor.y) < NEAR_Y && Math.abs(x - anchor.x) < NEAR_X;

const hdr = $('hdr');
hdr.addEventListener('pointerdown', async (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  try {
    const s = await tiny.win.getState();
    dragWin = { sx: e.screenX, sy: e.screenY, ox: s.x, oy: s.y, x: s.x, y: s.y, w: s.width, h: s.height };
    hdr.setPointerCapture(e.pointerId);
  } catch (er) {}
});
hdr.addEventListener('pointermove', (e) => {
  if (!dragWin) return;
  dragWin.x = dragWin.ox + (e.screenX - dragWin.sx);
  dragWin.y = dragWin.oy + (e.screenY - dragWin.sy);
  tiny.win.setPosition(dragWin.x, dragWin.y);
  const near = nearAnchor(dragWin.x, dragWin.y);
  document.body.classList.toggle('will-attach', near);        // pointer pokes out: "I'll attach"
  document.body.classList.toggle('torn', !near);              // lights preview: "I'll detach"
});
hdr.addEventListener('pointerup', () => {
  if (!dragWin) return;
  const d = dragWin; dragWin = null;
  document.body.classList.remove('torn', 'will-attach');
  if (Math.hypot(d.x - d.ox, d.y - d.oy) < 6) return;          // just a click, not a drag
  if (nearAnchor(d.x, d.y)) tiny.api.call('setDetached', { detached: false });
  else tiny.api.call('setDetached', { detached: true, x: d.x, y: d.y, w: d.w, h: d.h });
});

// traffic lights (visible only while detached)
$('tlClose').onclick = () => tiny.api.call('hidePopover', {});
$('tlMin').onclick = () => tiny.win.minimize();
$('tlZoom').onclick = () => tiny.win.zoom();

// detached windows resize natively — clamp to Harvest-ish bounds (only so
// wide) and remember the rect so reopen/relaunch restore it
let rszTimer = null;
window.addEventListener('resize', () => {
  if (mode !== 'detached') return;
  clearTimeout(rszTimer);
  rszTimer = setTimeout(async () => {
    try {
      const s = await tiny.win.getState();
      const w = Math.max(380, Math.min(560, s.width));
      const h = Math.max(430, s.height);
      if (w !== s.width || h !== s.height) tiny.win.setSize(w, h);
      tiny.api.call('saveWinRect', { x: s.x, y: s.y, w, h });
    } catch (e) {}
  }, 160);
});

// ── header tools ─────────────────────────────────────────────────────────────
$('btnToday').onclick = () => load(data.today);
$('prevWk').onclick = () => load(shiftDays(sel, -7));
$('nextWk').onclick = () => load(shiftDays(sel, 7));
function shiftDays(ds, n) { const d = parseYmd(ds); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); }

// ── footer ───────────────────────────────────────────────────────────────────
$('btnNew').onclick = () => openEntry();
$('btnFav').onclick = (e) => openFavs(e.currentTarget);
$('btnGear').onclick = (e) => openGear(e.currentTarget);
$('btnInfo').onclick = (e) => openSummary(e.currentTarget);

// ── popover layer ─────────────────────────────────────────────────────────────
function closePops() { $('popLayer').innerHTML = ''; summaryOpen = false; ctxEntry = null; }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.pop') && !e.target.closest('.hbtn,.fbtn,.tog,.entry')) closePops(); }, true);

// place a pop anchored to a footer/header button; side 'up' opens above
function mountPop(pop, anchorEl, align) {
  closePops();
  $('popLayer').appendChild(pop);
  const card = $('card').getBoundingClientRect();
  const a = anchorEl.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left, top;
  if (align === 'br') {                 // above-right (gear/fav in footer)
    left = a.right - card.left - pr.width;
    top = a.top - card.top - pr.height - 8;
  } else {                              // below-right (header info)
    left = a.right - card.left - pr.width;
    top = a.bottom - card.top + 8;
  }
  left = Math.max(8, Math.min(left, card.width - pr.width - 8));
  top = Math.max(8, Math.min(top, card.height - pr.height - 8));
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}

// ── gear / account menu ────────────────────────────────────────────────────
function openGear(anchor) {
  const pop = el('div', 'pop');
  const head = el('div', 'phead');
  head.appendChild(Object.assign(el('div', 'av', 'T'), {}));
  const who = el('div'); who.append(el('div', 'nm', 'Till'), el('div', 'sub', 'Local timesheet'));
  head.appendChild(who);
  pop.appendChild(head);
  pop.appendChild(el('div', 'sep'));
  pop.appendChild(popItem('New Time Entry', null, () => { closePops(); openEntry(); }));
  pop.appendChild(popItem('Preferences…', null, () => { closePops(); tiny.api.call('openPrefs', {}); }));
  pop.appendChild(popItem('Reset demo data', null, async () => { closePops(); if (await tiny.win.confirm('Clear all time entries and favorites?', { ok: 'Reset', cancel: 'Keep' })) { data = await tiny.api.call('resetDemo', {}); postMutate(); } }));
  pop.appendChild(el('div', 'sep'));
  pop.appendChild(popItem('About Till', null, () => { closePops(); tiny.win.alert('Till', 'A local time tracker — a tinyjs take on Harvest. Your hours never leave this machine.'); }));
  pop.appendChild(popItem('Quit Till', null, () => tiny.api.call('quit', {})));
  mountPop(pop, anchor, 'br');
}
function popItem(label, hint, fn, danger) {
  const it = el('div', 'pi' + (danger ? ' danger' : ''));
  it.appendChild(el('span', null, label));
  if (hint) it.appendChild(el('span', 'k', hint));
  it.onclick = fn;
  return it;
}

// ── time summary ───────────────────────────────────────────────────────────
let summaryOpen = false;
function openSummary(anchor) {
  const pop = el('div', 'pop summary');
  pop.appendChild(el('div', 'stitle', 'Time Summary'));
  const grid = el('div', 'sgrid');
  const cells = [['Hours Today', 'today'], ['Hours Yesterday', 'yesterday'], ['Hours This Week', 'week'], ['Hours This Month', 'month']];
  for (const [lab, key] of cells) {
    const c = el('div', 'cell');
    c.append(el('div', 'cl2', lab), el('div', 'v', fmtHM(data.summary[key])));
    c.dataset.key = key; grid.appendChild(c);
  }
  pop.appendChild(grid);
  mountPop(pop, anchor, 'below');
  summaryOpen = true;
}
function patchSummary() {
  const delta = data.running ? (data.running.seconds - runSecAtLoad) : 0;
  const add = { today: data.running && data.running.date === data.today ? delta : 0,
                yesterday: 0, week: delta, month: delta };
  document.querySelectorAll('.sgrid .cell').forEach((c) => {
    const k = c.dataset.key; c.querySelector('.v').textContent = fmtHM(data.summary[k] + (add[k] || 0));
  });
}

// ── favorites ────────────────────────────────────────────────────────────────
function openFavs(anchor) {
  const pop = el('div', 'pop favs');
  if (!data.favorites.length) { pop.appendChild(el('div', 'pempty', 'No favorites yet.\nStar a project in the entry form.')); }
  else for (const f of data.favorites) {
    const row = el('div', 'fav');
    const dot = el('div', 'dot'); dot.style.background = f.color; row.appendChild(dot);
    const m = el('div', 'fm'); m.append(el('div', 'fp', f.project), el('div', 'ft', f.task)); row.appendChild(m);
    row.onclick = async () => { closePops(); data = await tiny.api.call('addEntry', { projectId: f.projectId, task: f.task, start: true }); postMutate(); };
    pop.appendChild(row);
  }
  mountPop(pop, anchor, 'br');
}

// ── per-entry context menu ───────────────────────────────────────────────────
let ctxEntry = null;
function openContext(ev, e) {
  closePops(); ctxEntry = e;
  const pop = el('div', 'pop');
  pop.appendChild(popItem('Edit Entry', 'E', () => { closePops(); openEntry(e.id); }));
  pop.appendChild(popItem(e.running ? 'Stop Timer' : 'Start Timer', 'S', () => { closePops(); toggleEntry(e); }));
  pop.appendChild(popItem('Duplicate Entry', null, async () => { closePops(); data = await tiny.api.call('addEntry', { projectId: e.projectId, task: e.task, notes: e.notes, seconds: e.seconds }); postMutate(); }));
  pop.appendChild(el('div', 'sep'));
  pop.appendChild(popItem('Delete Entry', null, async () => { closePops(); data = await tiny.api.call('deleteEntry', { id: e.id }); postMutate(); }, true));
  $('popLayer').appendChild(pop);
  const card = $('card').getBoundingClientRect(), pr = pop.getBoundingClientRect();
  let left = ev.clientX - card.left, top = ev.clientY - card.top;
  left = Math.min(left, card.width - pr.width - 8); top = Math.min(top, card.height - pr.height - 8);
  pop.style.left = Math.max(8, left) + 'px'; pop.style.top = Math.max(8, top) + 'px';
}
// keyboard hints (E / S / delete) while a context menu is open
document.addEventListener('keydown', (e) => {
  if (!ctxEntry) return;
  if (e.key === 'e' || e.key === 'E') { const en = ctxEntry; closePops(); openEntry(en.id); }
  else if (e.key === 's' || e.key === 'S') { const en = ctxEntry; closePops(); toggleEntry(en); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { const en = ctxEntry; closePops(); tiny.api.call('deleteEntry', { id: en.id }).then((d) => { data = d; postMutate(); }); }
  else if (e.key === 'Escape') closePops();
});

// ── auto-hide when the popover loses focus (real menu-bar behaviour) ─────────
// Skip while an in-page popover is open, and skip entirely when torn off — a
// detached window stays put like any other window. The backend also refuses to
// hide while the entry window is up (it steals focus, which would blur us).
window.addEventListener('blur', () => {
  if (mode === 'detached') return;
  if ($('popLayer').children.length) return;
  tiny.api.call('hidePopover', {});
});
window.addEventListener('focus', () => { if (data) load(sel); });

// ── boot ──────────────────────────────────────────────────────────────────────
load();
