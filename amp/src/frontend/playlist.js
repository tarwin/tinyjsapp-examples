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

// transport works from this window too, not just main (keys land wherever
// focus is — before this, ⌘←/⌘→ did nothing until you clicked the player)
document.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); act({ type: 'toggle' }); }
  else if (e.key === 'ArrowRight' && e.metaKey) act({ type: 'next' });
  else if (e.key === 'ArrowLeft' && e.metaKey) act({ type: 'prev' });
});

$('add').onclick = async () => { const p = await tiny.win.openFiles(); if (p) act({ type: 'add', paths: p }); };
$('clear').onclick = () => act({ type: 'clear' });
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'playlist' });   // hide (keep position)

tiny.api.on('state', (s) => { state = s; render(); });
// NB: no onDrop here — tinyjs broadcasts the drop to EVERY window, so the main
// window handles it once for all of them (registering it here too double-adds).

(async () => { const s = await tiny.api.call('hello'); if (s) { state = s; render(); } })();
render();
