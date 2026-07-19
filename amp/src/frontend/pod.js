// pod.js — the podcasts window: a shelf of shows, Tarwin's favourites, and a
// little episode browser. Feeds are fetched by the BACKEND (no CORS there) and
// parsed here (WKWebView has DOMParser, txiki doesn't). Episodes play on the
// main deck — a ▶ sends a `podPlay` action carrying a remote-URL track; the
// player streams it through tiny.proxyURL (EQ, spectrum and seek included) or
// straight off disk when it's been downloaded for offline. The player owns
// listened-tracking (position + done flags in the store); this window just
// paints it.

/* global tiny */
const $ = (id) => document.getElementById(id);

let tab = 'shelf';            // 'shelf' | 'faves'
let view = 'list';            // 'list' | 'grid' (shelf only)
let shelf = [];               // [{ t, u, art }]
let openFeed = null;          // feed url while browsing episodes
let openShow = null;          // its shelf/fave entry
const feeds = new Map();      // feed url -> { title, art, eps: [...] }
let podState = {};            // guid -> { pos, dur, done }   (the player writes this)
let dlIndex = {};             // guid -> { path, bytes }      (the backend writes this)
const dlBusy = new Map();     // guid -> pct while downloading
let playingGuid = null;
let pendingPlay = null;    // guid we promised to play once its download lands
let epSort = 'new';        // 'new' | 'old' | 'unheard'
let notesOpen = null;      // guid with its show notes unfolded

const save = () => tiny.store.set('podShelf', shelf);
const fmtDur = (s) => {
  s = Math.round(s || 0);
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? h + 'h' + String(m).padStart(2, '0') : m + ':' + String(s % 60).padStart(2, '0');
};
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? '' : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const fmtMB = (b) => (b / 1048576).toFixed(1) + ' MB';

// ── feed parsing ───────────────────────────────────────────────────────────
function text(el, tag) {
  const n = el.getElementsByTagName(tag)[0];
  return n ? n.textContent.trim() : '';
}
function parseDur(s) {
  if (!s) return 0;
  if (/^\d+$/.test(s)) return +s;
  const p = s.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : 0;
}
function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const ch = doc.getElementsByTagName('channel')[0];
  if (!ch) return null;
  let art = '';
  const itImg = ch.getElementsByTagName('itunes:image')[0];
  if (itImg) art = itImg.getAttribute('href') || '';
  if (!art) {
    const img = ch.getElementsByTagName('image')[0];
    if (img) art = text(img, 'url');
  }
  const eps = [];
  const strip = (h) => {
    const d = document.createElement('div');
    d.innerHTML = h;
    return (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1400);
  };
  for (const item of ch.getElementsByTagName('item')) {
    const enc = item.getElementsByTagName('enclosure')[0];
    if (!enc || !enc.getAttribute('url')) continue;
    const url = enc.getAttribute('url');
    eps.push({
      guid: text(item, 'guid') || url,
      title: text(item, 'title') || 'untitled',
      date: text(item, 'pubDate'),
      durS: parseDur(text(item, 'itunes:duration')),
      url,
      bytes: +enc.getAttribute('length') || 0,
      notes: strip(text(item, 'content:encoded') || text(item, 'description') || text(item, 'itunes:summary') || ''),
    });
    if (eps.length >= 120) break;   // a shelf browser, not an archive
  }
  return { title: text(ch, 'title'), art, eps };
}
async function loadFeed(url) {
  if (feeds.has(url)) return feeds.get(url);
  const r = await tiny.api.call('podFetchFeed', { url });
  if (!r || !r.ok) throw new Error(r && r.error || 'fetch failed');
  const f = parseFeed(r.xml);
  if (!f) throw new Error('not an RSS feed');
  feeds.set(url, f);
  return f;
}

// artwork for the grid: fill in lazily, one feed at a time, persisted
let artPump = false;
async function pumpArt() {
  if (artPump) return;
  artPump = true;
  try {
    for (const s of shelf) {
      if (s.art !== undefined && s.art !== null) continue;
      try {
        const f = await loadFeed(s.u);
        s.art = f.art || '';
        if (f.title && !s.t) s.t = f.title;
        save();
        if (tab === 'shelf' && !openFeed) render();
      } catch (e) { s.art = ''; }
    }
  } finally { artPump = false; }
}

// ── rendering ──────────────────────────────────────────────────────────────
const list = $('podList');
function note(msg) {
  list.replaceChildren();
  const li = document.createElement('li');
  li.className = 'empty'; li.textContent = msg;
  list.appendChild(li);
}
function chrome() {
  $('tabShelf').classList.toggle('lit', tab === 'shelf' && !openFeed);
  $('tabFaves').classList.toggle('lit', tab === 'faves' && !openFeed);
  $('view').classList.toggle('lit', view === 'grid');
  $('showHead').style.display = openFeed ? '' : 'none';
  list.classList.toggle('grid', view === 'grid' && !openFeed);
}
function render() {
  chrome();
  if (openFeed) return renderEpisodes();
  if (tab === 'faves') return renderFaves();
  renderShelf();
}

function renderShelf() {
  list.replaceChildren();
  if (!shelf.length) return note('shelf is bare — browse FAVES or ＋ add a feed');
  for (const s of shelf) {
    const li = document.createElement('li');
    li.className = 'show';
    if (view === 'grid') {
      li.classList.add('tile');
      const ph = document.createElement('div');
      ph.className = 'ph'; ph.textContent = '📻';
      li.appendChild(ph);
      if (s.art) {
        const img = document.createElement('img');
        img.src = s.art; img.alt = '';
        img.onload = () => ph.remove();
        img.onerror = () => img.remove();
        li.appendChild(img);
      }
      const cap = document.createElement('span');
      cap.className = 'cap'; cap.textContent = s.t;
      li.appendChild(cap);
    } else {
      const nm = document.createElement('span');
      nm.className = 'nm'; nm.textContent = s.t;
      li.appendChild(nm);
    }
    const rm = document.createElement('button');
    rm.className = 'row-x'; rm.textContent = '×';
    rm.title = 'Remove from shelf';
    rm.onclick = (e) => {
      e.stopPropagation();
      shelf = shelf.filter((x) => x.u !== s.u);
      save(); render();
    };
    li.appendChild(rm);
    li.onclick = () => openEpisodes(s);
    list.appendChild(li);
  }
  if (view === 'grid') pumpArt();
}

let favArt = {};           // feed url -> art url, persisted
let favPump = false;
async function pumpFavArt() {
  if (favPump) return;
  favPump = true;
  try {
    for (const f of (window.POD_FAVS || [])) {
      if (tab !== 'faves' || view !== 'grid' || openFeed) break;   // stop when it stops mattering
      if (favArt[f.u] !== undefined) continue;
      try {
        const fd = await loadFeed(f.u);
        favArt[f.u] = fd.art || '';
      } catch (e) { favArt[f.u] = ''; }
      tiny.store.set('podFavArt', favArt);
      if (tab === 'faves' && !openFeed) render();
    }
  } finally { favPump = false; }
}
function renderFaves() {
  list.replaceChildren();
  for (const f of (window.POD_FAVS || [])) {
    const li = document.createElement('li');
    li.className = 'show';
    if (view === 'grid') {
      li.classList.add('tile');
      const ph = document.createElement('div');
      ph.className = 'ph'; ph.textContent = '📻';
      li.appendChild(ph);
      if (favArt[f.u]) {
        const img = document.createElement('img');
        img.src = favArt[f.u]; img.alt = '';
        img.onload = () => ph.remove();
        img.onerror = () => img.remove();
        li.appendChild(img);
      }
      const cap = document.createElement('span');
      cap.className = 'cap'; cap.textContent = f.t;
      li.appendChild(cap);
    } else {
      const nm = document.createElement('span');
      nm.className = 'nm'; nm.textContent = f.t;
      li.appendChild(nm);
    }
    const onShelf = shelf.some((s) => s.u === f.u);
    const add = document.createElement('button');
    add.className = 'row-add' + (onShelf ? ' done' : '');
    add.textContent = onShelf ? '✓' : '＋';
    add.title = onShelf ? 'On your shelf' : 'Add to your shelf';
    add.onclick = (e) => {
      e.stopPropagation();
      if (!shelf.some((s) => s.u === f.u)) {
        shelf.push({ t: f.t, u: f.u, art: null });
        save(); render(); pumpArt();
      }
    };
    li.appendChild(add);
    li.onclick = () => openEpisodes({ t: f.t, u: f.u, art: favArt[f.u] || '' });
    list.appendChild(li);
  }
  if (view === 'grid') pumpFavArt();
}

async function openEpisodes(show) {
  openFeed = show.u; openShow = show;
  $('showTitle').textContent = show.t;
  chrome();
  note('tuning in…');
  try {
    const f = await loadFeed(show.u);
    if (f.title) { $('showTitle').textContent = f.title; }
    if (openFeed === show.u) renderEpisodes();
  } catch (e) {
    if (openFeed === show.u) note('feed failed: ' + e.message);
  }
}

function epTrack(ep) {
  const dl = dlIndex[ep.guid];
  return {
    name: ep.title,
    path: dl ? dl.path : undefined,
    url: dl ? undefined : ep.url,
    duration: ep.durS || 0,
    pod: { guid: ep.guid, show: (openShow && openShow.t) || '', feed: openFeed,
           art: (openShow && openShow.art) || (feeds.get(openFeed) || {}).art || '' },
  };
}

function startDl(ep) {
  if (dlBusy.has(ep.guid)) return;
  dlBusy.set(ep.guid, -1);
  tiny.api.call('podDownload', { guid: ep.guid, url: ep.url, title: ep.title, show: (openShow && openShow.t) || '' })
    .catch(() => {
      dlBusy.delete(ep.guid);
      // the download fell over — if a play was riding on it, stream instead
      if (pendingPlay === ep.guid) { pendingPlay = null; tiny.api.call('action', { type: 'podPlay', track: epTrack(ep) }); }
      render();
    });
}

function sortedEps(f) {
  const eps = [...f.eps];                 // feeds arrive newest-first
  if (epSort === 'old') eps.reverse();
  else if (epSort === 'unheard') {
    eps.sort((a, b) => {
      const da = (podState[a.guid] || {}).done ? 1 : 0;
      const db = (podState[b.guid] || {}).done ? 1 : 0;
      return da - db;
    });
  }
  return eps;
}
function renderEpisodes() {
  const f = feeds.get(openFeed);
  if (!f) return;
  list.replaceChildren();
  if (!f.eps.length) return note('no playable episodes in this feed');
  for (const ep of sortedEps(f)) {
    const st = podState[ep.guid] || {};
    const dl = dlIndex[ep.guid];
    const li = document.createElement('li');
    li.className = 'ep' + (st.done ? ' played' : '') + (playingGuid === ep.guid ? ' on' : '');

    const play = document.createElement('button');
    play.className = 'row-play';
    const dling = dlBusy.has(ep.guid);
    play.textContent = playingGuid === ep.guid ? '♪'
      : dling && pendingPlay === ep.guid ? (dlBusy.get(ep.guid) >= 0 ? dlBusy.get(ep.guid) + '' : '…')
      : '▶';
    play.title = dl ? (st.pos > 15 && !st.done ? 'Resume at ' + fmtDur(st.pos) : 'Play (downloaded)')
      : pendingPlay === ep.guid ? 'Downloading — plays when it lands'
      : 'Download & play (double-click streams right away)';
    play.onclick = (e) => {
      e.stopPropagation();
      if (dl) { tiny.api.call('action', { type: 'podPlay', track: epTrack(ep) }); return; }
      if (dlBusy.has(ep.guid)) { pendingPlay = ep.guid; render(); return; }
      pendingPlay = ep.guid;
      startDl(ep);
      render();
    };
    li.appendChild(play);

    const mid = document.createElement('span');
    mid.className = 'mid';
    const nm = document.createElement('span');
    nm.className = 'nm'; nm.textContent = ep.title;
    nm.title = ep.title;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = [fmtDate(ep.date), fmtDur(ep.durS), st.done ? 'played' : st.pos > 15 ? 'at ' + fmtDur(st.pos) : '']
      .filter(Boolean).join(' · ');
    mid.append(nm, meta);
    li.appendChild(mid);

    const q = document.createElement('button');
    q.className = 'row-q'; q.textContent = '»';
    q.title = 'Play next';
    q.onclick = (e) => { e.stopPropagation(); tiny.api.call('action', { type: 'podQueue', track: epTrack(ep) }); };
    li.appendChild(q);

    const d = document.createElement('button');
    d.className = 'row-dl' + (dl ? ' done' : '');
    if (dlBusy.has(ep.guid)) {
      const pct = dlBusy.get(ep.guid);
      d.textContent = pct >= 0 ? pct + '%' : '…';
      d.title = 'Downloading';
    } else if (dl) {
      d.textContent = '✕';
      d.title = 'Downloaded (' + fmtMB(dl.bytes) + ') — click to delete';
      d.onclick = async (e) => {
        e.stopPropagation();
        dlIndex = await tiny.api.call('podDelete', { guid: ep.guid });
        render(); refreshCache();
      };
    } else {
      d.textContent = '⤓';
      d.title = 'Download for offline';
      d.onclick = (e) => { e.stopPropagation(); startDl(ep); render(); };
    }
    li.appendChild(d);

    li.ondblclick = () => tiny.api.call('action', { type: 'podPlay', track: epTrack(ep) });
    mid.onclick = () => { notesOpen = notesOpen === ep.guid ? null : ep.guid; render(); };
    if (notesOpen === ep.guid && ep.notes) {
      const nd = document.createElement('div');
      nd.className = 'notes';
      nd.textContent = ep.notes;
      li.appendChild(nd);
      li.classList.add('open');
    }
    list.appendChild(li);
  }
}

async function refreshCache() {
  dlIndex = await tiny.api.call('podDlIndex') || {};
  const entries = Object.values(dlIndex);
  const bytes = entries.reduce((n, e) => n + (e.bytes || 0), 0);
  $('cacheInfo').textContent = entries.length
    ? entries.length + ' offline · ' + fmtMB(bytes)
    : 'nothing downloaded';
  $('poShade').textContent = shelf.length + ' shows';
}

// ── events ────────────────────────────────────────────────────────────────
tiny.api.on('pod-dl', ({ guid, pct, done, error }) => {
  if (done || error) {
    dlBusy.delete(guid);
    refreshCache().then(() => {
      if (done && pendingPlay === guid) {
        pendingPlay = null;
        const f = feeds.get(openFeed);
        const ep = f && f.eps.find((e) => e.guid === guid);
        if (ep) tiny.api.call('action', { type: 'podPlay', track: epTrack(ep) });
      }
      if (error && pendingPlay === guid) pendingPlay = null;
      render();
    });
  } else {
    dlBusy.set(guid, pct);
    render();   // cheap: lists are short
  }
});

// the player's word on what's playing + what's been listened to
let stateT = 0;
tiny.api.on('state', (s) => {
  const g = s && s.tracks && s.tracks[s.idx] && s.tracks[s.idx].pod ? s.tracks[s.idx].pod.guid : null;
  const changed = g !== playingGuid;
  playingGuid = g;
  const now = performance.now();
  if (changed || now - stateT > 5000) {
    stateT = now;
    tiny.store.get('podState').then((ps) => {
      podState = ps || {};
      if (openFeed) render();
    });
  }
});

$('tabShelf').onclick = () => { tab = 'shelf'; openFeed = null; render(); };
$('tabFaves').onclick = () => { tab = 'faves'; openFeed = null; render(); };
$('back').onclick = () => { openFeed = null; notesOpen = null; render(); };
$('sortBtn').onclick = () => {
  epSort = { new: 'old', old: 'unheard', unheard: 'new' }[epSort];
  $('sortBtn').textContent = { new: 'NEW', old: 'OLD', unheard: 'UNHEARD' }[epSort];
  render();
};
$('view').onclick = () => {
  view = view === 'list' ? 'grid' : 'list';
  tiny.store.set('podView', view);
  render();
};
$('addBtn').onclick = () => {
  const r = $('addRow');
  r.style.display = r.style.display === 'none' ? '' : 'none';
  if (r.style.display !== 'none') $('addUrl').focus();
};
async function addFeed() {
  const url = $('addUrl').value.trim();
  if (!/^https?:\/\//.test(url)) { $('addUrl').classList.add('bad'); return; }
  $('addUrl').classList.remove('bad');
  $('addGo').textContent = '…';
  try {
    const f = await loadFeed(url);
    if (!shelf.some((s) => s.u === url)) {
      shelf.push({ t: f.title || url, u: url, art: f.art || '' });
      save();
    }
    $('addUrl').value = '';
    $('addRow').style.display = 'none';
    tab = 'shelf'; openFeed = null;
    render();
  } catch (e) {
    $('addUrl').classList.add('bad');
  }
  $('addGo').textContent = 'ADD';
}
$('addGo').onclick = addFeed;
$('addUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFeed(); });
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'podcast' });

// ── boot ──────────────────────────────────────────────────────────────────
(async () => {
  const [sh, v, ps, fa, s] = await Promise.all([
    tiny.store.get('podShelf'), tiny.store.get('podView'),
    tiny.store.get('podState'), tiny.store.get('podFavArt'), tiny.api.call('hello'),
  ]);
  if (fa && typeof fa === 'object') favArt = fa;
  if (Array.isArray(sh)) shelf = sh;
  if (v === 'grid') view = 'grid';
  podState = ps || {};
  if (s && s.tracks && s.tracks[s.idx] && s.tracks[s.idx].pod) playingGuid = s.tracks[s.idx].pod.guid;
  await refreshCache();
  render();
  tiny.api.call('windowReady', { id: 'podcast' });
})();
