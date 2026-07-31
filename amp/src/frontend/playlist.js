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
// state.playing is the TRANSPORT's state, and while a station is tuned that's
// the radio — so the deck's track must not keep showing as playing just because
// something is. The deck is only the source when no station is on the air.
const deckPlaying = () => !!state.playing && !state.radio;
const rowName = (tr) => (tr && tr.display) || String((tr && tr.name) || '').replace(/\.[^.]+$/, '');
// The delete cursor: after a removal the row ABOVE lights up and becomes the
// next Delete's target, so a run of tracks goes with repeated keypresses.
// Moving the mouse over a row takes precedence again (pointing is selecting).
let selIdx = -1;
function render() {
  if (drag && drag.moved) return;   // mid-drag: don't rebuild rows under the pointer
  const t = state.tracks || [];
  if (selIdx >= t.length) selIdx = t.length - 1;
  // `display` is the tagged "Artist — Title" the deck worked out; it arrives a
  // beat after the files do, so it's part of the key that triggers a rebuild
  const key = t.map((tr) => (tr.pod ? 'p·' : /\.midi?$/i.test(tr.path || '') ? 'm·' : /\.(mod|s3m|xm|it|mptm)$/i.test(tr.path || '') ? 't·' : '') + rowName(tr) + '|' + (tr.duration || 0)).join('\n') +
    '#' + state.idx + '#' + deckPlaying() + '#' + state.nextUp + '#' + selIdx;
  if (key !== listKey) { listKey = key; renderList(t); }
  // shade view: the current track + elapsed, scrolling green like Winamp —
  // the name is a marquee (rolls when it overflows), the time stays parked
  const cur = state.idx >= 0 && t[state.idx];
  plNm.set(cur ? (state.idx + 1) + '. ' + rowName(cur) : 'no track');
  $('plShadeT').textContent = cur ? fmt(state.elapsed) : '';
}
const plNm = window.ampMarquee($('plShadeNm'));

function renderList(t) {
  list.replaceChildren();
  $('empty').toggleAttribute('data-show', t.length === 0);
  list.style.display = t.length === 0 ? 'none' : '';
  let total = 0;
  t.forEach((tr, i) => {
    total += tr.duration || 0;
    const li = document.createElement('li');
    li.dataset.idx = i;
    if (i === state.idx) li.className = deckPlaying() ? 'on playing' : 'on';
    if (i === state.nextUp) li.classList.add('next');
    if (i === selIdx) li.classList.add('sel');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = (i + 1);
    const nm = document.createElement('span'); nm.className = 'nm';
    // podcast episodes wear the deck's 🎙 so the list tells them from files;
    // .mid rows get 🎹 (they're synthesized, not decoded)
    if (tr.pod) {
      const k = document.createElement('span'); k.className = 'kind'; k.textContent = '🎙 ';
      k.title = 'podcast' + (tr.pod.show ? ' — ' + tr.pod.show : '');
      nm.appendChild(k);
    } else if (/\.midi?$/i.test(tr.path || '')) {
      const k = document.createElement('span'); k.className = 'kind'; k.textContent = '🎵 ';
      k.title = 'MIDI — rendered with a SoundFont';
      nm.appendChild(k);
    } else if (/\.(mod|s3m|xm|it|mptm)$/i.test(tr.path || '')) {
      const k = document.createElement('span'); k.className = 'kind'; k.textContent = '🎛 ';
      k.title = 'tracker module — rendered by libopenmpt';
      nm.appendChild(k);
    }
    nm.appendChild(document.createTextNode(rowName(tr)));
    nm.title = tr.path || tr.url || '';
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
  if (e.target.classList.contains('x')) { act({ type: 'remove', idx: i }); selIdx = Math.max(0, i - 1); selAt = performance.now(); return; }
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
// The keyboard drives the list through selIdx, the highlighted cursor row:
// ↑/↓ walk it, Enter plays it, ⌘/Ctrl+↑/↓ carry it, Escape drops it, and
// Delete/Backspace removes it — though the row under the POINTER outranks it
// (pointing is selecting), else the last-clicked row.
// The row under the pointer also plants "This Track Info…" at the top of the
// shared right-click menu (via drag.js's ampCtxExtra — see there for why it
// must happen at hover time). Leaving the list pulls it back out, so the
// other windows' menus never carry it.
let hoverIdx = -1;
let hoverAt = 0, selAt = 0;   // who moved last decides who Delete/Enter act on
function setHover(i) {
  if (i === hoverIdx) return;
  hoverIdx = i;
  if (i >= 0) hoverAt = performance.now();
  if (window.ampCtxExtra) window.ampCtxExtra(i >= 0 ? [{ id: 'inspect:' + i, label: 'This Track Info…' }] : []);
}
// The pointer and the keyboard cursor both point at a row; when both are
// live, the one the user touched most recently is the one they mean.
function target() {
  if (hoverIdx >= 0 && selIdx >= 0) return hoverAt > selAt ? hoverIdx : selIdx;
  return hoverIdx >= 0 ? hoverIdx : selIdx >= 0 ? selIdx : lastClick.idx;
}
list.addEventListener('mouseover', (e) => {
  const li = e.target.closest('li');
  setHover(li ? Number(li.dataset.idx) : -1);
});
list.addEventListener('mouseleave', () => setHover(-1));
tiny.menu.onContext((id) => {
  if (String(id).startsWith('inspect:')) tiny.api.call('inspect', { idx: Number(id.slice(8)) });
});

document.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); act({ type: 'toggle' }); }
  else if (e.key === 'ArrowRight' && e.metaKey) { e.preventDefault(); act({ type: 'next' }); }
  else if (e.key === 'ArrowLeft' && e.metaKey) { e.preventDefault(); act({ type: 'prev' }); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const n = (state.tracks || []).length;
    if (!n) return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? -1 : 1;
    if (e.metaKey || e.ctrlKey) {
      // ⌘/Ctrl+↑/↓ carries the row. selIdx moves now; the repaint waits for
      // the state round-trip so the highlight and the row travel together.
      // Mashing it is safe — the deck applies the queued moves in order.
      const i = target();
      const to = i + dir;
      if (i >= 0 && to >= 0 && to < n) {
        act({ type: 'move', from: i, to });
        selIdx = to; selAt = performance.now();
        setTimeout(() => { const li = list.children[selIdx]; if (li) li.scrollIntoView({ block: 'nearest' }); }, 60);
      }
    } else {
      // plain ↑/↓ walks the cursor (starting from the hovered row if any)
      selIdx = selIdx < 0
        ? (hoverIdx >= 0 ? hoverIdx : (dir > 0 ? 0 : n - 1))
        : Math.min(n - 1, Math.max(0, selIdx + dir));
      selAt = performance.now();
      render();
      const li = list.children[selIdx];
      if (li) li.scrollIntoView({ block: 'nearest' });
    }
  }
  else if (e.key === 'Enter') {
    const i = target();
    if (i >= 0) { e.preventDefault(); act({ type: 'play', idx: i }); }
  }
  else if (e.key === 'Escape') { if (selIdx >= 0) { selIdx = -1; render(); } }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    const i = target();
    if (i >= 0) {
      e.preventDefault();
      act({ type: 'remove', idx: i });
      // the row above becomes the cursor, so Delete-Delete-Delete walks a run
      selIdx = Math.max(0, i - 1); selAt = performance.now();
      if (i === lastClick.idx) lastClick = { idx: -1, t: 0 };
      // the rows shift under a stationary pointer without re-firing mouseover,
      // so the stale hover must not outrank the cursor we just placed
      setHover(-1);
    }
  }
});

$('add').onclick = async () => { const p = await tiny.dialog.openFiles(); if (p) act({ type: 'add', paths: p }); };
$('loadSample').onclick = (e) => { e.preventDefault(); tiny.api.call('addSample'); };
$('clear').onclick = () => act({ type: 'clear' });
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'playlist' });   // hide (keep position)

tiny.api.on('state', (s) => { state = s; render(); });
// NB: no onDrop here — tinyjs broadcasts the drop to EVERY window, so the main
// window handles it once for all of them (registering it here too double-adds).

(async () => { const s = await tiny.api.call('hello'); if (s) { state = s; render(); } })();
render();
