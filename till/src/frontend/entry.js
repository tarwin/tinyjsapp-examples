// Till — the New/Edit Time Entry window. A small standalone window (its own OS
// window via app.openWindow('entry')); it can't see the main popover, so it
// gets its catalog + the row being edited from the backend and sends the result
// back through `submitEntry`, which refreshes the popover and closes this window.

const $ = (id) => document.getElementById(id);
const el = (tag, txt) => { const n = document.createElement(tag); if (txt != null) n.textContent = txt; return n; };
const two = (n) => (n < 10 ? '0' + n : '' + n);
const fmtHM = (s) => Math.floor(s / 3600) + ':' + two(Math.floor((s % 3600) / 60));
function parseTime(str) {
  str = (str || '').trim(); if (!str) return 0;
  if (str.includes(':')) { const [h, m] = str.split(':'); return (parseInt(h || '0', 10) || 0) * 3600 + (parseInt(m || '0', 10) || 0) * 60; }
  const f = parseFloat(str); return isNaN(f) ? 0 : Math.round(f * 3600);
}

let catalog = [], favorites = [], projById = {}, editId = null;

function fillProjects(selectedId) {
  const sp = $('eProject'); sp.innerHTML = '';
  for (const c of catalog) {
    const og = document.createElement('optgroup'); og.label = c.client;
    for (const p of c.projects) { const o = el('option', p.name); o.value = p.id; og.appendChild(o); }
    sp.appendChild(og);
  }
  sp.value = selectedId || (catalog[0] && catalog[0].projects[0].id);
  fillTasks(sp.value);
}
function fillTasks(projectId, selectedTask) {
  const st = $('eTask'); st.innerHTML = '';
  const tasks = (projById[projectId] && projById[projectId].tasks) || [];
  for (const t of tasks) { const o = el('option', t); o.value = t; st.appendChild(o); }
  if (selectedTask != null) st.value = selectedTask;
}
function refreshStar() {
  const on = favorites.some((f) => f.projectId === $('eProject').value && f.task === $('eTask').value);
  $('eStar').classList.toggle('on', on);
  $('eStarUse').setAttribute('href', on ? '#i-star-f' : '#i-star');
}

$('eProject').onchange = () => { fillTasks($('eProject').value); refreshStar(); };
$('eTask').onchange = () => refreshStar();
$('eStar').onclick = async () => {
  await tiny.api.call('toggleFavorite', { projectId: $('eProject').value, task: $('eTask').value });
  const init = await tiny.api.call('entryInit');   // re-read favorites
  favorites = init.favorites;
  refreshStar();
};

$('eCancel').onclick = () => tiny.api.call('closeEntryWindow', {});
$('eGo').onclick = () => {
  tiny.api.call('submitEntry', {
    editId,
    projectId: $('eProject').value,
    task: $('eTask').value,
    notes: $('eNotes').value,
    seconds: parseTime($('eTime').value),
    start: !editId,          // "Start" on a new entry begins the timer
  });
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') tiny.api.call('closeEntryWindow', {});
  else if (e.key === 'Enter' && (e.metaKey || e.target.id !== 'eNotes')) { e.preventDefault(); $('eGo').click(); }
});

// drag the window by its non-interactive chrome (frameless = no native titlebar)
let drag = null;
document.querySelector('.ecard').addEventListener('pointerdown', async (e) => {
  if (e.button !== 0 || e.target.closest('select, input, textarea, button')) return;
  try { const s = await tiny.win.getState(); drag = { sx: e.screenX, sy: e.screenY, ox: s.x, oy: s.y }; e.currentTarget.setPointerCapture(e.pointerId); } catch (er) {}
});
document.addEventListener('pointermove', (e) => { if (drag) tiny.win.setPosition(drag.ox + (e.screenX - drag.sx), drag.oy + (e.screenY - drag.sy)); });
document.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ── boot ──────────────────────────────────────────────────────────────────────
(async () => {
  const init = await tiny.api.call('entryInit');
  catalog = init.catalog; favorites = init.favorites;
  projById = {};
  for (const c of catalog) for (const p of c.projects) projById[p.id] = { ...p };
  const editing = init.mode === 'edit' && init.edit;
  editId = editing ? init.edit.id : null;
  $('eTitle').textContent = editing ? 'Edit Time Entry' : 'New Time Entry';
  $('eGo').textContent = editing ? 'Save' : 'Start';
  fillProjects(editing ? init.edit.projectId : null);
  if (editing) fillTasks(init.edit.projectId, init.edit.task);
  $('eNotes').value = editing ? init.edit.notes : '';
  $('eTime').value = editing ? fmtHM(init.edit.seconds) : '0:00';
  refreshStar();
  setTimeout(() => $('eProject').focus(), 40);
})();
