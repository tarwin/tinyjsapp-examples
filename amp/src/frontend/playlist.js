// playlist.js — the playlist window. Pure UI: it renders the track list from
// the state main broadcasts, and sends user intent back as 'action' calls.
const $ = (id) => document.getElementById(id);
const list = $('list');
let state = { tracks: [], idx: -1, playing: false };

const fmt = (s) => { s = Math.floor(s || 0); return (s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '–:––'); };
const act = (a) => tiny.api.call('action', a);

function render() {
  const t = state.tracks || [];
  list.replaceChildren();
  $('empty').toggleAttribute('data-show', t.length === 0);
  list.style.display = t.length === 0 ? 'none' : '';
  let total = 0;
  t.forEach((tr, i) => {
    total += tr.duration || 0;
    const li = document.createElement('li');
    if (i === state.idx) li.className = state.playing ? 'on playing' : 'on';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = (i + 1);
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = (tr.name || '').replace(/\.[^.]+$/, '');
    const d = document.createElement('span'); d.className = 'd'; d.textContent = fmt(tr.duration);
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; x.title = 'Remove';
    x.onclick = (e) => { e.stopPropagation(); act({ type: 'remove', idx: i }); };
    li.append(n, nm, d, x);
    li.ondblclick = () => act({ type: 'play', idx: i });
    li.onclick = () => { state.idx = i; render(); };   // select highlight (dbl to play)
    list.appendChild(li);
  });
  $('count').textContent = t.length + ' track' + (t.length === 1 ? '' : 's') +
    (total ? ' · ' + fmt(total) : '');
  // shade view: the current track + elapsed, scrolling green like Winamp
  const cur = state.idx >= 0 && t[state.idx];
  $('plShade').textContent = cur
    ? (state.idx + 1) + '. ' + (cur.name || '').replace(/\.[^.]+$/, '') + '   ' + fmt(state.elapsed)
    : 'no track';
}

$('add').onclick = async () => { const p = await tiny.win.openFiles(); if (p) act({ type: 'add', paths: p }); };
$('clear').onclick = () => act({ type: 'clear' });
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'playlist' });   // hide (keep position)

tiny.api.on('state', (s) => { state = s; render(); });
// NB: no onDrop here — tinyjs broadcasts the drop to EVERY window, so the main
// window handles it once for all of them (registering it here too double-adds).

(async () => { const s = await tiny.api.call('hello'); if (s) { state = s; render(); } })();
render();
