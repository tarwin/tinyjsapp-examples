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
  // state.elapsed is file time; a cue track's clock starts at its own start
  $('plShadeT').textContent = cur ? fmt(Math.max(0, state.elapsed - (cur.cueStart || 0))) : '';
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
  // typing in the Lib view's filter box must not drive the transport —
  // a space there is a space, not play/pause
  if (e.target && e.target.tagName === 'INPUT') return;
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

// ── the Lib view ────────────────────────────────────────────────────────────
// The same window flipped into a library browser (CSS .lib-open does the
// swap; the Lib toggle lives in the titlebar next to ×). The backend scans
// the chosen folder into albums; this side only groups, filters and renders.
// Three levels: ARTISTS (names → an artist's shelf), ALBUMS (everything,
// flat), and click any album for its track list. Album lists come as an
// artwork grid by default — folder cover.jpg files load straight off disk
// (file://), embedded art is pumped in lazily — with a ▦ toggle back to
// names. Rows work like the podcast window: ＋ appends to the playlist,
// ▶ appends and plays, so the playlist stays the one queue there is.
let libOpen = false;
let libTab = 'artists';        // 'artists' | 'albums'
let libArtist = null;          // drilled-into artist (artists tab only)
let libAlbum = null;           // drilled-into album id (its track list)
let libDir = null;             // the chosen folder, null = not chosen yet
let libAlbums = [];
let libLoaded = false;         // first backend answer arrived
let libQ = '';                 // live filter text
let libView = 'grid';          // 'grid' | 'list' — how album lists paint (persisted)
let libFlashT = 0;
const libArt = new Map();      // album id → embedded-art data URI | '' (a miss)
let libArtPump = false;

const chassis = document.querySelector('.chassis');
const libList = $('libList');
const artistName = (a) => a.artist || '(no artist)';

function libChrome() {
  chassis.classList.toggle('lib-open', libOpen);
  $('lib').classList.toggle('lit', libOpen);
  $('libTabArtists').classList.toggle('lit', libTab === 'artists' && !libArtist && !libAlbum);
  $('libTabAlbums').classList.toggle('lit', libTab === 'albums' && !libAlbum);
  $('libBack').style.display = (libArtist || libAlbum) ? '' : 'none';
  $('libView').classList.toggle('lit', libView === 'grid');
  $('libFolder').title = libDir ? 'Music folder: ' + libDir + ' — click to change' : 'Choose the music folder…';
}

// the click's receipt: the pressed ＋/▶ pops amber and reads ✓ for a beat
function zap(btn) {
  if (!btn) return;
  const old = btn.textContent;
  btn.textContent = '✓';
  btn.classList.add('zap');
  setTimeout(() => { btn.classList.remove('zap'); btn.textContent = old; }, 650);
}

function libNote(msg, click) {
  libList.replaceChildren();
  const li = document.createElement('li');
  li.className = 'empty'; li.textContent = msg;
  if (click) { li.style.cursor = 'pointer'; li.onclick = click; }
  libList.appendChild(li);
}

function libInfo(msg) { $('libInfo').textContent = msg; }
function libFlash(msg) {
  libInfo(msg);
  clearTimeout(libFlashT);
  libFlashT = setTimeout(renderLib, 1600);
}

function libAdd(tracks, playNow, btn) {
  if (!tracks.length) return;
  // ready-made rows, not paths: cue-split tracks carry their cue window and
  // their sheet-given tags, and the deck takes them as-is (player addRows)
  act({
    type: 'add',
    rows: tracks.map((t) => ({ path: t.path, name: t.name, display: t.display, tags: t.tags,
                               duration: t.duration, cueStart: t.cueStart, cueEnd: t.cueEnd, trackNo: t.trackNo })),
    playNow,
  });
  zap(btn);
  libFlash((playNow ? '▶ playing ' : '✓ added ') + tracks.length + ' track' + (tracks.length === 1 ? '' : 's'));
}
const albumTracks = (albums) => albums.flatMap((a) => a.tracks);

// the album's sleeve, wherever we have or can get one: folder art loads off
// disk right away; otherwise the first track's embedded art is fetched and
// patched in (and remembered in libArt either way)
function sleeveInto(img, a) {
  img.style.display = 'none';
  img.onload = () => { img.style.display = ''; };
  img.onerror = () => img.remove();
  const uri = a.art ? tiny.fileURL(a.art) : libArt.get(a.id);
  if (uri) { img.src = uri; return; }
  if (uri === '' || !a.tracks.length) return;   // '' = a known miss
  tiny.api.call('trackArt', { path: a.tracks[0].path }).then((r) => {
    libArt.set(a.id, (r && r.uri) || '');
    if (r && r.uri && img.isConnected) img.src = r.uri;
  }).catch(() => {});
}

const libMatch = (q) => (s) => String(s).toLowerCase().includes(q);
function albumRow(a, flat) {
  const li = document.createElement('li');
  li.className = 'ep';
  li.style.cursor = 'pointer';
  const play = document.createElement('button');
  play.className = 'row-play'; play.textContent = '▶'; play.title = 'Add to playlist & play';
  play.onclick = (e) => { e.stopPropagation(); libAdd(a.tracks, true, play); };
  const mid = document.createElement('span'); mid.className = 'mid';
  const nm = document.createElement('span'); nm.className = 'nm';
  nm.textContent = flat && a.artist ? a.artist + ' — ' + a.title : a.title;
  nm.title = a.dir;
  const meta = document.createElement('span'); meta.className = 'meta';
  meta.textContent = a.tracks.length + ' track' + (a.tracks.length === 1 ? '' : 's');
  mid.append(nm, meta);
  const add = document.createElement('button');
  add.className = 'row-add'; add.textContent = '＋'; add.title = 'Add to playlist';
  add.onclick = (e) => { e.stopPropagation(); libAdd(a.tracks, false, add); };
  li.append(play, mid, add);
  li.onclick = () => { libAlbum = a.id; renderLib(); };
  return li;
}

// a sleeve in the grid: folder art loads straight off disk, embedded art
// arrives via the pump; ＋ floats over the corner, clicking opens the tracks
function albumTile(a, flat) {
  const li = document.createElement('li');
  li.className = 'show tile';
  li.dataset.aid = a.id;
  const ph = document.createElement('div');
  ph.className = 'ph'; ph.textContent = '💿';
  li.appendChild(ph);
  const uri = a.art ? tiny.fileURL(a.art) : libArt.get(a.id);
  if (uri) {
    const img = document.createElement('img');
    img.src = uri; img.alt = '';
    img.onload = () => ph.remove();
    img.onerror = () => img.remove();
    li.appendChild(img);
  }
  const cap = document.createElement('span');
  cap.className = 'cap';
  cap.textContent = flat && a.artist ? a.artist + ' — ' + a.title : a.title;
  cap.title = a.dir;
  li.appendChild(cap);
  const add = document.createElement('button');
  add.className = 'row-add'; add.textContent = '＋'; add.title = 'Add to playlist';
  add.onclick = (e) => { e.stopPropagation(); libAdd(a.tracks, false, add); };
  li.appendChild(add);
  li.onclick = () => { libAlbum = a.id; renderLib(); };
  return li;
}

// embedded art for sleeves without a cover.jpg: one album at a time, only
// while the grid is actually looking, patched into the tile in place so the
// scroll position never jumps. Misses cache as '' and are never re-asked.
async function pumpLibArt(albs) {
  if (libArtPump) return;
  libArtPump = true;
  try {
    for (const a of albs) {
      if (!libOpen || libView !== 'grid') break;
      if (a.art || libArt.has(a.id) || !a.tracks.length) continue;
      let uri = '';
      try {
        const r = await tiny.api.call('trackArt', { path: a.tracks[0].path });
        uri = (r && r.uri) || '';
      } catch (e) {}
      libArt.set(a.id, uri);
      if (!uri) continue;
      const li = libList.querySelector('li[data-aid="' + a.id + '"]');
      if (li && !li.querySelector('img')) {
        const ph = li.querySelector('.ph');
        const img = document.createElement('img');
        img.src = uri; img.alt = '';
        img.onload = () => ph && ph.remove();
        img.onerror = () => img.remove();
        li.insertBefore(img, li.querySelector('.cap'));   // right after .ph — the CSS leans on it
      }
    }
  } finally { libArtPump = false; }
}

// same idea for the artists list: one embedded-art fetch per sleeve-less
// artist (their first album), patched into the row's stack in place
async function pumpArtistArt(items) {
  if (libArtPump || !items.length) return;
  libArtPump = true;
  try {
    for (const it of items) {
      if (!libOpen || libTab !== 'artists' || libArtist || libAlbum) break;
      if (libArt.has(it.a.id)) continue;
      let uri = '';
      try {
        const r = await tiny.api.call('trackArt', { path: it.a.tracks[0].path });
        uri = (r && r.uri) || '';
      } catch (e) {}
      libArt.set(it.a.id, uri);
      if (!uri) continue;
      const li = [...libList.children].find((el) => el.dataset && el.dataset.artist === it.artist);
      const stack = li && li.querySelector('.art-stack');
      if (stack && !stack.childElementCount) {
        const im = document.createElement('img');
        im.src = uri; im.alt = '';
        im.onerror = () => im.remove();
        stack.appendChild(im);
      }
    }
  } finally { libArtPump = false; }
}

function renderLib() {
  if (!libOpen) return;
  libChrome();
  clearTimeout(libFlashT);
  libList.classList.remove('grid');
  if (!libDir) {
    libNote('no music folder yet — click here (or 📁 above) to choose one', libChoose);
    libInfo('the folder is scanned & watched');
    return;
  }
  if (!libLoaded) { libNote('reading the crate…'); libInfo('—'); return; }
  const q = libQ.trim().toLowerCase();
  libList.replaceChildren();

  // ── inside an album: its tracks ──
  if (libAlbum) {
    const a = libAlbums.find((x) => x.id === libAlbum);
    if (!a) { libAlbum = null; return renderLib(); }
    // header row: the sleeve + the album line, with whole-album ＋/▶
    const head = document.createElement('li');
    head.className = 'show lib-head';
    const hart = document.createElement('img');
    hart.className = 'lib-sleeve';
    sleeveInto(hart, a);
    const hplay = document.createElement('button');
    hplay.className = 'row-play'; hplay.textContent = '▶'; hplay.title = 'Add the album & play';
    hplay.onclick = (e) => { e.stopPropagation(); libAdd(a.tracks, true, hplay); };
    const hnm = document.createElement('span'); hnm.className = 'nm';
    hnm.textContent = (a.artist ? a.artist + ' — ' : '') + a.title;
    hnm.title = a.dir;
    hnm.style.color = 'var(--lcd)';
    const hadd = document.createElement('button');
    hadd.className = 'row-add'; hadd.textContent = '＋'; hadd.title = 'Add the whole album';
    hadd.onclick = (e) => { e.stopPropagation(); libAdd(a.tracks, false, hadd); };
    head.append(hart, hplay, hnm, hadd);
    head.style.cursor = 'default';
    libList.appendChild(head);
    const shown2 = q ? a.tracks.filter((t) => libMatch(q)(t.name)) : a.tracks;
    shown2.forEach((t) => {
      const li = document.createElement('li');
      li.className = 'ep';
      const play = document.createElement('button');
      play.className = 'row-play'; play.textContent = '▶'; play.title = 'Add this track & play';
      play.onclick = (e) => { e.stopPropagation(); libAdd([t], true, play); };
      const mid = document.createElement('span'); mid.className = 'mid';
      const nm = document.createElement('span'); nm.className = 'nm';
      nm.textContent = (a.tracks.indexOf(t) + 1) + '. ' + t.name;
      nm.title = t.path;
      mid.appendChild(nm);
      // a cue-split track knows its length already — say so
      if (t.duration) {
        const dur = document.createElement('span'); dur.className = 'meta';
        dur.textContent = fmt(t.duration);
        mid.appendChild(dur);
      }
      const add = document.createElement('button');
      add.className = 'row-add'; add.textContent = '＋'; add.title = 'Add this track';
      add.onclick = (e) => { e.stopPropagation(); libAdd([t], false, add); };
      li.append(play, mid, add);
      li.ondblclick = () => libAdd([t], true, play);
      libList.appendChild(li);
    });
    if (!shown2.length) libNote('nothing matches "' + libQ.trim() + '"');
    libInfo(a.tracks.length + ' track' + (a.tracks.length === 1 ? '' : 's'));
    return;
  }

  // ── the artists: names with album counts ──
  if (libTab === 'artists' && !libArtist) {
    // group albums by artist, keep the scan's artist+title order
    const by = new Map();
    for (const a of libAlbums) {
      const k = artistName(a);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(a);
    }
    const names = [...by.keys()].filter(q ? libMatch(q) : () => true);
    if (!names.length) return libNote(q ? 'nothing matches "' + libQ.trim() + '"' : 'no albums found in this folder'), libInfo(libAlbums.length + ' albums');
    const wantArt = [];   // artists with no sleeve on hand yet → the pump
    for (const n of names) {
      const albs = by.get(n);
      const li = document.createElement('li');
      li.className = 'show';
      li.dataset.artist = n;
      // a little stack of the artist's sleeves — whatever's already on hand
      const stack = document.createElement('span');
      stack.className = 'art-stack';
      let got = 0;
      for (const al of albs) {
        const u = al.art ? tiny.fileURL(al.art) : libArt.get(al.id);
        if (!u) continue;
        const im = document.createElement('img');
        im.src = u; im.alt = '';
        im.onerror = () => im.remove();
        stack.appendChild(im);
        if (++got >= 3) break;
      }
      if (!got && albs[0].tracks.length && !libArt.has(albs[0].id)) wantArt.push({ artist: n, a: albs[0] });
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = n;
      const ct = document.createElement('span'); ct.className = 'meta'; ct.style.opacity = '.6';
      ct.textContent = albs.length + (albs.length === 1 ? ' album' : ' albums');
      const add = document.createElement('button');
      add.className = 'row-add'; add.textContent = '＋'; add.title = 'Add everything by ' + n;
      add.onclick = (e) => { e.stopPropagation(); libAdd(albumTracks(albs), false, add); };
      li.append(stack, nm, ct, add);
      li.onclick = () => { libArtist = n; renderLib(); };
      libList.appendChild(li);
    }
    pumpArtistArt(wantArt);
    libInfo(by.size + ' artist' + (by.size === 1 ? '' : 's') + ' · ' + libAlbums.length + ' album' + (libAlbums.length === 1 ? '' : 's'));
    return;
  }

  // ── album shelves: an artist's, or every album flat — grid or names ──
  const flat = libTab === 'albums';
  let albs = flat ? libAlbums : libAlbums.filter((a) => artistName(a) === libArtist);
  if (q) albs = albs.filter((a) => libMatch(q)(artistName(a) + ' ' + a.title));
  if (!albs.length) return libNote(q ? 'nothing matches "' + libQ.trim() + '"' : 'no albums here'), libInfo('—');
  if (libView === 'grid') {
    libList.classList.add('grid');
    for (const a of albs) libList.appendChild(albumTile(a, flat));
    pumpLibArt(albs);
  } else {
    for (const a of albs) libList.appendChild(albumRow(a, flat));
  }
  const n = albs.reduce((s, a) => s + a.tracks.length, 0);
  libInfo((libArtist ? libArtist + ' · ' : '') + albs.length + ' album' + (albs.length === 1 ? '' : 's') + ' · ' + n + ' track' + (n === 1 ? '' : 's'));
}

function applyLib(s) {
  if (!s) return;
  libDir = s.dir || null;
  libAlbums = s.albums || [];
  libLoaded = true;
  // what we're drilled into may have vanished in a rescan — back out if so
  if (libAlbum && !libAlbums.some((a) => a.id === libAlbum)) libAlbum = null;
  if (libArtist && !libAlbums.some((a) => artistName(a) === libArtist)) libArtist = null;
  renderLib();
}

async function libChoose() {
  const p = await tiny.dialog.pickFolder();
  if (!p) return;
  libDir = p; libLoaded = false; libArtist = null; libAlbum = null;
  libArt.clear();
  renderLib();
  try { applyLib(await tiny.api.call('libSet', { dir: p })); }
  catch (e) { libNote('scan failed — is that folder readable?'); }
}

$('lib').onclick = async () => {
  libOpen = !libOpen;
  libChrome();
  if (!libOpen) return;
  renderLib();
  try {
    applyLib(await tiny.api.call('libState'));
    // the watcher only sees the top folders — a fresh open re-walks the tree
    // so deeper edits show up too (the result arrives on the 'lib' push)
    if (libDir) tiny.api.call('libRescan').catch(() => {});
  } catch (e) {}
};
$('libFolder').onclick = libChoose;
// back walks one level: tracks → the shelf they came from → the artists
$('libBack').onclick = () => { if (libAlbum) libAlbum = null; else libArtist = null; renderLib(); };
$('libTabArtists').onclick = () => { libTab = 'artists'; libArtist = null; libAlbum = null; renderLib(); };
$('libTabAlbums').onclick = () => { libTab = 'albums'; libArtist = null; libAlbum = null; renderLib(); };
$('libView').onclick = () => {
  libView = libView === 'grid' ? 'list' : 'grid';
  tiny.store.set('libView', libView);
  renderLib();
};
tiny.store.get('libView').then((v) => { if (v === 'list' || v === 'grid') { libView = v; if (libOpen) renderLib(); } }).catch(() => {});
$('libQ').addEventListener('input', () => { libQ = $('libQ').value; renderLib(); });
$('libQ').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('libQ').value = ''; libQ = ''; renderLib(); e.stopPropagation(); }
});
tiny.api.on('lib', applyLib);

tiny.api.on('state', (s) => { state = s; render(); });
// NB: no onDrop here — tinyjs broadcasts the drop to EVERY window, so the main
// window handles it once for all of them (registering it here too double-adds).

(async () => { const s = await tiny.api.call('hello'); if (s) { state = s; render(); } })();
render();
