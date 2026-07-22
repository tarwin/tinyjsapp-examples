// playlist.js — the playlist window. Pure UI: it renders the track list from
// the state main broadcasts, and sends user intent back as 'action' calls.
const $ = (id) => document.getElementById(id);
const list = $('list');
let state = { tracks: [], idx: -1, playing: false, nextUp: -1 };

const fmt = (s) => { s = Math.floor(s || 0); return (s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '–:––'); };
const act = (a) => tiny.api.call('action', a);

// Rebuild the rows only when something STRUCTURAL changed. State broadcasts
// arrive several times a second during playback (elapsed ticks), and replacing
// every <li> between the two clicks of a double-click makes the second click
// land on a fresh element — the old "you have to double-click impossibly fast"
// bug. The shade line (elapsed time) updates separately, every push.
let listKey = '';
function render() {
  if (drag && drag.moved) return;   // mid-drag: don't rebuild rows under the pointer
  const t = state.tracks || [];
  const key = t.map((tr) => tr.name + '|' + (tr.duration || 0)).join('\n') +
    '#' + state.idx + '#' + state.playing + '#' + state.nextUp;
  if (key !== listKey) { listKey = key; renderList(t); }
  // shade view: the current track + elapsed, scrolling green like Winamp
  const cur = state.idx >= 0 && t[state.idx];
  $('plShade').textContent = cur
    ? (state.idx + 1) + '. ' + (cur.name || '').replace(/\.[^.]+$/, '') + '   ' + fmt(state.elapsed)
    : 'no track';
}

function renderList(t) {
  list.replaceChildren();
  $('empty').toggleAttribute('data-show', t.length === 0);
  list.style.display = t.length === 0 ? 'none' : '';
  let total = 0;
  t.forEach((tr, i) => {
    total += tr.duration || 0;
    const li = document.createElement('li');
    li.dataset.idx = i;
    if (i === state.idx) li.className = state.playing ? 'on playing' : 'on';
    if (i === state.nextUp) li.classList.add('next');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = (i + 1);
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = (tr.name || '').replace(/\.[^.]+$/, '');
    const d = document.createElement('span'); d.className = 'd'; d.textContent = fmt(tr.duration);
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; x.title = 'Remove';
    li.append(n, nm, d, x);
    list.appendChild(li);
  });
  $('count').textContent = t.length + ' track' + (t.length === 1 ? '' : 's') +
    (total ? ' · ' + fmt(total) : '');
}

// One delegated handler on the <ul> — the rows get rebuilt, the list doesn't.
// Double-click is detected by hand for the same reason: native dblclick gives
// up when the first click's element is gone by the second click.
// Single click queues the track to play NEXT (click again to unqueue);
// double-click plays it now.
let lastClick = { idx: -1, t: 0 };
list.addEventListener('click', (e) => {
  if (suppressClick) return;        // this "click" was the tail end of a drag
  const li = e.target.closest('li');
  if (!li) return;
  const i = Number(li.dataset.idx);
  if (e.target.classList.contains('x')) { act({ type: 'remove', idx: i }); return; }
  const now = performance.now();
  if (i === lastClick.idx && now - lastClick.t < 450) {
    lastClick = { idx: -1, t: 0 };
    act({ type: 'play', idx: i });
  } else {
    lastClick = { idx: i, t: now };
    act({ type: 'queue', idx: i });
  }
});

// ── drag a row to reorder ───────────────────────────────────────────────────
// Pointer events, not HTML5 DnD (drag.js suppresses window-level dragover/drop
// to stop WebKit navigating on file drops). A 5px movement threshold keeps
// plain clicks (queue) and the hand-rolled double-click (play) intact; while a
// drag is live, incoming state pushes skip the row rebuild (see render) so the
// grabbed <li> can't be replaced under the pointer.
let drag = null;            // { from, li, y0, pid, moved, slot }
let suppressClick = false;  // a drag's pointerup still fires a click — eat it

list.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const li = e.target.closest('li');
  if (!li || e.target.classList.contains('x')) return;
  drag = { from: Number(li.dataset.idx), li, y0: e.clientY, pid: e.pointerId, moved: false, slot: null };
});

list.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  if (!drag.moved) {
    if (Math.abs(e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    try { list.setPointerCapture(drag.pid); } catch (err) {}
    drag.li.classList.add('dragging');
  }
  const lis = [...list.children];
  let slot = lis.length;                    // insertion slot: before row i, or after the last
  for (let i = 0; i < lis.length; i++) {
    const r = lis[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { slot = i; break; }
  }
  drag.slot = slot;
  lis.forEach((el, i) => {
    el.classList.toggle('drop-above', i === slot);
    el.classList.toggle('drop-below', slot === lis.length && i === lis.length - 1);
  });
  const lr = list.getBoundingClientRect();  // nudge the scroll at the edges
  if (e.clientY < lr.top + 14) list.scrollTop -= 8;
  else if (e.clientY > lr.bottom - 14) list.scrollTop += 8;
});

function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.pid)) return;
  const d = drag; drag = null;
  if (!d.moved) return;                     // it was just a click — the click handler owns it
  d.li.classList.remove('dragging');
  list.querySelectorAll('.drop-above, .drop-below').forEach((el) => el.classList.remove('drop-above', 'drop-below'));
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  if (d.slot != null) {
    let to = d.slot;
    if (to > d.from) to--;                  // removing the dragged row shifts later slots down
    if (to !== d.from) act({ type: 'move', from: d.from, to });
  }
  render();                                 // flush anything that arrived mid-drag
}
list.addEventListener('pointerup', endDrag);
list.addEventListener('pointercancel', endDrag);

// transport works from this window too, not just main (keys land wherever
// focus is — before this, ⌘←/⌘→ did nothing until you clicked the player)
// Delete/Backspace removes the row under the cursor (this list has no
// selection — pointing IS selecting), else the last-clicked row.
let hoverIdx = -1;
list.addEventListener('mouseover', (e) => {
  const li = e.target.closest('li');
  hoverIdx = li ? Number(li.dataset.idx) : -1;
});
list.addEventListener('mouseleave', () => { hoverIdx = -1; });

document.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); act({ type: 'toggle' }); }
  else if (e.key === 'ArrowRight' && e.metaKey) { e.preventDefault(); act({ type: 'next' }); }
  else if (e.key === 'ArrowLeft' && e.metaKey) { e.preventDefault(); act({ type: 'prev' }); }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    const i = hoverIdx >= 0 ? hoverIdx : lastClick.idx;
    if (i >= 0) {
      e.preventDefault();
      act({ type: 'remove', idx: i });
      if (i === lastClick.idx) lastClick = { idx: -1, t: 0 };
      hoverIdx = -1;
    }
  }
});

$('add').onclick = async () => { const p = await tiny.win.openFiles(); if (p) act({ type: 'add', paths: p }); };
$('loadSample').onclick = (e) => { e.preventDefault(); tiny.api.call('addSample'); };
$('clear').onclick = () => act({ type: 'clear' });
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'playlist' });   // hide (keep position)

tiny.api.on('state', (s) => { state = s; render(); });
// NB: no onDrop here — tinyjs broadcasts the drop to EVERY window, so the main
// window handles it once for all of them (registering it here too double-adds).

(async () => { const s = await tiny.api.call('hello'); if (s) { state = s; render(); } })();
render();
