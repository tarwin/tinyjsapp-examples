// TinySlaq — frontend. Draws a Slack-shaped shell from the backend config and
// keeps messages in sync over the bridge. User-entered text is always written
// with textContent (never innerHTML) — the page holds an RPC channel to a
// backend with full system access, so message text must never become markup.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const initials = (name) => {
  const p = name.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return (name[0].toUpperCase() + (name[1] || '')).trim();
};
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayKey = (ts) => new Date(ts).toDateString();
function dayLabel(ts) {
  const d = new Date(ts).toDateString();
  const today = new Date().toDateString();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d === today) return 'Today';
  if (d === y.toDateString()) return 'Yesterday';
  return new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

/* ─────────── state ─────────── */

let cfg = null;                          // { workspaces }
let wsId = null, chId = null, meId = 'tarwin';
const unread = {};                       // `${wsId}/${chId}` -> count
let lastCh = {};                         // wsId -> last channel id (per workspace)
let render = { member: null, ts: 0, day: null };   // tail of the shown channel

const composer = $('composer');
const input = $('input');

/* ─────────── lookups ─────────── */

const ws = () => cfg.workspaces.find((w) => w.id === wsId);
const wsMember = (wId, mId) => cfg.workspaces.find((w) => w.id === wId)?.members.find((m) => m.id === mId);
const memberById = (mId) => wsMember(wsId, mId);
const channelById = (id) => ws().channels.find((c) => c.id === id);
const isDM = (id) => id.startsWith('dm:');
const dmPartner = (id) => memberById(id.slice(3));
const key = (w, c) => w + '/' + c;

function chanMeta(id) {
  if (isDM(id)) { const m = dmPartner(id); return { name: m ? m.name : id.slice(3), topic: m ? m.role : '' }; }
  const c = channelById(id); return { name: c.name, topic: c.topic };
}

/* ─────────── rail / sidebar render ─────────── */

function applyTheme(t) {
  const r = document.documentElement.style;
  r.setProperty('--rail', t.rail);
  r.setProperty('--side', t.side);
  r.setProperty('--active', t.active);
  r.setProperty('--hover', t.hover);
}

function wsUnread(wId) {
  let n = 0;
  for (const k in unread) if (k.startsWith(wId + '/')) n += unread[k];
  return n;
}

function renderRail() {
  const rail = $('rail');
  rail.innerHTML = '';
  for (const w of cfg.workspaces) {
    const btn = document.createElement('button');
    btn.className = 'ws-square' + (w.id === wsId ? ' on' : '');
    btn.title = w.name;
    btn.innerHTML = `<span class="pip"></span>${esc(w.square)}`;
    const n = wsUnread(w.id);
    if (n && w.id !== wsId) {
      const b = document.createElement('span');
      b.className = 'badge'; b.textContent = n > 99 ? '99+' : String(n);
      btn.appendChild(b);
    }
    btn.addEventListener('click', () => selectWorkspace(w.id));
    rail.appendChild(btn);
  }
  const add = document.createElement('button');
  add.className = 'rail-add'; add.textContent = '+'; add.title = 'Add a workspace';
  rail.appendChild(add);
  rail.appendChild(Object.assign(document.createElement('div'), { className: 'rail-spacer' }));
  const me = memberById(meId) || ws().members[0];
  const meEl = document.createElement('div');
  meEl.className = 'rail-me'; meEl.style.background = me.color; meEl.title = me.name + ' (you)';
  meEl.innerHTML = `${esc(initials(me.name))}<span class="presence"></span>`;
  rail.appendChild(meEl);
}

function sideRow(glyph, name, id) {
  const li = document.createElement('li');
  li.dataset.ch = id;
  const n = unread[key(wsId, id)] || 0;
  if (id === chId) li.classList.add('on');
  else if (n) li.classList.add('unread');
  li.innerHTML = `<span class="glyph">${esc(glyph)}</span><span class="nm">${esc(name)}</span>`;
  if (n && id !== chId) {
    const b = document.createElement('span');
    b.className = 'badge-count'; b.textContent = n > 99 ? '99+' : String(n);
    li.appendChild(b);
  }
  li.addEventListener('click', () => selectChannel(id));
  return li;
}

function dmRow(m) {
  const id = 'dm:' + m.id;
  const li = document.createElement('li');
  li.dataset.ch = id;
  const n = unread[key(wsId, id)] || 0;
  if (id === chId) li.classList.add('on');
  else if (n) li.classList.add('unread');
  li.innerHTML =
    `<span class="dm-ava" style="background:${esc(m.color)}">${esc(initials(m.name))}` +
    `<span class="presence ${m.presence === 'active' ? 'active' : ''}"></span></span>` +
    `<span class="nm">${esc(m.name)}</span>`;
  if (n && id !== chId) {
    const b = document.createElement('span');
    b.className = 'badge-count'; b.textContent = n > 99 ? '99+' : String(n);
    li.appendChild(b);
  }
  li.addEventListener('click', () => selectChannel(id));
  return li;
}

function renderSidebar() {
  const w = ws();
  const cl = $('channelList'); cl.innerHTML = '';
  for (const c of w.channels) cl.appendChild(sideRow('#', c.name, c.id));
  const dl = $('dmList'); dl.innerHTML = '';
  for (const mId of w.dms) { const m = memberById(mId); if (m) dl.appendChild(dmRow(m)); }

  const me = memberById(meId) || w.members[0];
  $('sideMe').innerHTML =
    `<div class="ava" style="background:${esc(me.color)}">${esc(initials(me.name))}<span class="presence"></span></div>` +
    `<div><div class="who">${esc(me.name)}</div><div class="sub">${esc(me.role)}</div></div>`;
  renderPostAs();
  applyFilter();
}

function renderPostAs() {
  const me = memberById(meId) || ws().members[0];
  $('postAsBtn').innerHTML =
    `<span class="ava" style="background:${esc(me.color)}">${esc(initials(me.name))}</span>${esc(me.name)}`;
  $('postAsMenu').innerHTML = `<div class="pa-head">Post as…</div>` + ws().members.map((m) =>
    `<button type="button" class="pa-item ${m.id === meId ? 'on' : ''}" data-m="${esc(m.id)}">` +
    `<span class="ava" style="background:${esc(m.color)}">${esc(initials(m.name))}</span>` +
    `<span>${esc(m.name)}</span><span class="role">${esc(m.role)}</span></button>`).join('');
}

/* ─────────── selection ─────────── */

function selectWorkspace(id) {
  wsId = id;
  const w = ws();
  applyTheme(w.theme);
  if (!memberById(meId)) meId = w.members[0].id;
  $('wsName').firstChild.textContent = w.name + ' ';
  renderRail();
  renderSidebar();
  const saved = lastCh[id];
  const ok = saved && (channelById(saved) || (isDM(saved) && dmPartner(saved)));
  selectChannel(ok ? saved : w.channels[0].id);
  persist();
}

async function selectChannel(id) {
  chId = id;
  lastCh[wsId] = id;
  unread[key(wsId, id)] = 0;
  const meta = chanMeta(id);
  const g = $('topGlyph');
  if (isDM(id)) {
    const m = dmPartner(id);
    g.innerHTML = `<span class="dm-ava" style="width:20px;height:20px;background:${esc(m.color)};border-radius:5px;font-size:11px;display:inline-grid;place-items:center;vertical-align:-4px">${esc(initials(m.name))}</span>`;
  } else {
    g.textContent = '#';
  }
  $('topName').textContent = meta.name;
  $('topTopic').textContent = meta.topic || '';
  $('memberCount').textContent = String(ws().members.length);
  tiny.win.setTitle('TinySlaq · ' + ws().name + ' · ' + (isDM(id) ? '@' : '#') + meta.name);
  renderRail();
  renderSidebar();
  const rows = await tiny.api.call('history', { workspace: wsId, channel: id });
  renderMessages(rows, meta);
  persist();
  input.focus();
}

/* ─────────── messages ─────────── */

const actionsHTML = () =>
  `<div class="actions"><button type="button" title="React">😀</button>` +
  `<button type="button" title="Reply in thread">💬</button>` +
  `<button type="button" title="More">⋯</button></div>`;

function msgEl(m, r, cont) {
  const el = document.createElement('div');
  el.className = 'msg' + (cont ? ' cont' : '');
  el.innerHTML = cont
    ? `<div class="gutter-time">${esc(fmtTime(r.ts))}</div><div class="body"><div class="text"></div></div>${actionsHTML()}`
    : `<div class="avatar" style="background:${esc(m.color)}">${esc(initials(m.name))}</div>` +
      `<div class="body"><div class="head"><span class="name">${esc(m.name)}</span>` +
      `<span class="time">${esc(fmtTime(r.ts))}</span></div><div class="text"></div></div>${actionsHTML()}`;
  el.querySelector('.text').textContent = r.text;   // user text — textContent only
  return el;
}

function appendOne(box, r) {
  const m = memberById(r.member) || { name: r.member, color: '#8a8a8a' };
  const d = dayKey(r.ts);
  if (d !== render.day) {
    const div = document.createElement('div');
    div.className = 'day-divider';
    div.innerHTML = `<span>${esc(dayLabel(r.ts))}</span>`;
    box.appendChild(div);
    render.day = d; render.member = null;
  }
  const cont = render.member === r.member && (new Date(r.ts).getTime() - render.ts) < 5 * 60 * 1000;
  box.appendChild(msgEl(m, r, cont));
  render.member = r.member;
  render.ts = new Date(r.ts).getTime();
}

function emptyState(meta) {
  return `<div class="empty">👋 This is the very beginning of ` +
    (isDM(chId) ? `your direct message with <b>${esc(meta.name)}</b>` : `the <b>#${esc(meta.name)}</b> channel`) +
    `.</div>`;
}

function renderMessages(rows, meta) {
  const box = $('messages');
  box.innerHTML = '';
  render = { member: null, ts: 0, day: null };
  if (!rows.length) { box.innerHTML = emptyState(meta); return; }
  for (const r of rows) appendOne(box, r);
  box.scrollTop = box.scrollHeight;
}

function appendLive(row) {
  if (row.workspace === wsId && row.channel === chId) {
    const box = $('messages');
    if (box.querySelector('.empty')) { box.innerHTML = ''; render = { member: null, ts: 0, day: null }; }
    appendOne(box, row);
    box.scrollTop = box.scrollHeight;
  } else {
    bumpUnread(row);
  }
}

function bumpUnread(row) {
  unread[key(row.workspace, row.channel)] = (unread[key(row.workspace, row.channel)] || 0) + 1;
  if (row.workspace === wsId) renderSidebar();
  renderRail();
  const m = wsMember(row.workspace, row.member);
  const label = row.channel.startsWith('dm:') ? (m ? m.name : 'DM') : ('#' + row.channel);
  tiny.notify((m ? m.name : 'Someone') + ' · ' + label, row.text);
}

tiny.api.on('message', (row) => appendLive(row));

/* ─────────── composer ─────────── */

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(200, input.scrollHeight) + 'px';
}
function updateSend() { $('sendBtn').disabled = input.value.trim() === ''; }

async function doSend() {
  const text = input.value.trim();
  if (!text) return;
  input.value = ''; autoGrow(); updateSend();
  const row = await tiny.api.call('send', { workspace: wsId, channel: chId, member: meId, text });
  appendLive(row);
}

input.addEventListener('input', () => { autoGrow(); updateSend(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
});
composer.addEventListener('submit', (e) => { e.preventDefault(); doSend(); });

/* ─────────── post-as menu ─────────── */

$('postAsBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const mn = $('postAsMenu'); mn.hidden = !mn.hidden;
});
$('postAsMenu').addEventListener('click', (e) => {
  const b = e.target.closest('.pa-item');
  if (!b) return;
  meId = b.dataset.m;
  $('postAsMenu').hidden = true;
  renderSidebar(); renderRail(); persist(); input.focus();
});
document.addEventListener('click', () => { $('postAsMenu').hidden = true; });

/* ─────────── odds & ends ─────────── */

function applyFilter() {
  const q = $('quickFind').value.trim().toLowerCase();
  for (const li of document.querySelectorAll('.side-list li')) {
    const nm = li.querySelector('.nm').textContent.toLowerCase();
    li.style.display = (!q || nm.includes(q)) ? '' : 'none';
  }
}
$('quickFind').addEventListener('input', applyFilter);
$('composeBtn').addEventListener('click', () => input.focus());
$('huddleBtn').addEventListener('click', () => $('huddleBtn').classList.toggle('on'));
$('wsName').addEventListener('click', (e) => e.preventDefault());

function persist() { tiny.store.set('tinyslaq', { wsId, meId, lastCh }).catch(() => {}); }

/* ─────────── boot ─────────── */

async function init() {
  cfg = await tiny.api.call('config');
  const saved = await tiny.store.get('tinyslaq');
  if (saved) {
    lastCh = saved.lastCh || {};
    if (saved.meId) meId = saved.meId;
  }
  const startWs = (saved && cfg.workspaces.some((w) => w.id === saved.wsId)) ? saved.wsId : cfg.workspaces[0].id;
  selectWorkspace(startWs);
}

init().catch((e) => { document.body.innerHTML = '<pre style="padding:20px">init failed: ' + esc(String(e)) + '</pre>'; });
