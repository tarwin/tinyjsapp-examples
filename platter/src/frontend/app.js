// app.js — the ritual.
//
// Platter's whole point is what it WON'T do: no skip button, no queue, no
// search-play. You pull a sleeve from the crate, slide the record out, start
// the motor, set the needle down. Two tracks apart? Lift the arm and try to
// land it. Side over? Flip the record — motor off first. Want a different
// album? Put this one away. The state machine here is those manners:
//
//   empty ──pick sleeve──▶ pullout ──slide out──▶ (read durations)
//         ◀──put away──── record-on-platter ◀──────────┘
//
// Two engines can sit under the same deck: PLAYER (local files through
// WebAudio) and SPOT (Spotify Connect — the app is the turntable, Spotify
// is the amplifier). window.ENGINE is whichever one the current record
// needs; the deck and the manners don't know the difference.

const $ = (id) => document.getElementById(id);
const fileURL = (p) => tiny.fileURL(p);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let library = { dir: null, albums: [] };
let spotifyList = [];      // saved albums from the connected Spotify account
let spConnected = false;
let current = null;        // { album, img, sides, side } — the record that's out
let pulled = null;         // album shown centre-stage, pre-commitment
let hintT = 0;

let ENGINE = window.PLAYER;
window.ENGINE = ENGINE;
const setEngine = (e) => { ENGINE = e; window.ENGINE = e; };

// ── hints: italic whispers, never modal ────────────────────────────────────
function hint(text, ms = 4200) {
  const h = $('hint');
  h.textContent = text;
  h.classList.toggle('on', !!text);
  const t = ++hintT;
  if (ms) setTimeout(() => { if (hintT === t) h.classList.remove('on'); }, ms);
}

function nowline(text) {
  const n = $('nowline');
  n.textContent = text || '';
  n.classList.toggle('on', !!text);
}

// ── "Artist - Song" on every line ──────────────────────────────────────────
// Files get tagged and named by whoever ripped them, and a whole tracklist
// reading "Pink Floyd - Time / Pink Floyd - Money" spends its width on the
// part you already know — the sleeve right above it says whose record this
// is. So: if every track opens with the same text, that text belongs to the
// album, not the track, and it goes.
//
// Three passes, cheapest and most certain first. Real folders are messy —
// one file in an album will have a double space, or lose its dash entirely —
// so none of these may demand that EVERY line agree.
//
//   0. The artist (or album) we already know, off the folder or the tags.
//      No guessing at all, and it doesn't care about dashes, so
//      "Leonardo's Bride So Brand New" loses its prefix like the rest.
//   1. The same text before the first dash on MOST lines — a majority, not
//      a unanimity — then that prefix comes off every line that has it.
//   2. Longest common prefix backed off to its last punctuation mark, for
//      "Book_01_", "Disc One - " and friends.

const LEAD_SEP = /^[\s.\-–—_:|]+/;
const TAIL_SEP = /[\s.\-–—_:|]+$/;
// Pass 2 cuts on punctuation only, never a bare space: "The Wall" / "The
// Trial" / "The End" share "The " and are three different songs.
const PASS2_SEPS = ['.', '-', '–', '—', '_', ':', '|'];

function stripCommonPrefix(tracks, ...known) {
  if (tracks.length < 2) return tracks;
  const names = tracks.map((t) => t.name || '');
  if (names.some((n) => !n)) return tracks;

  const apply = (cut) => {
    // never blank a line, and never reduce a whole record to bare numbers —
    // the tracklist already numbers itself
    if (cut.some((s) => !s.length)) return null;
    if (cut.every((s) => /^\d+$/.test(s))) return null;
    return tracks.map((t, i) => ({ ...t, name: cut[i] }));
  };
  // take `prefix` off any line that opens with it; lines that don't are left
  // exactly as they are (a stray "Intro" among "Artist - x" keeps its name)
  const strip = (prefix) => {
    if (!prefix || prefix.length < 2) return null;
    const low = prefix.toLowerCase();
    let hits = 0;
    const cut = names.map((n) => {
      if (!n.toLowerCase().startsWith(low)) return n;
      const rest = n.slice(prefix.length).replace(LEAD_SEP, '').trim();
      if (!rest) return n;                 // that was the whole name — leave it
      hits++;
      return rest;
    });
    return hits > names.length / 2 ? apply(cut) : null;
  };

  // pass 0 — the artist / album title we were already told
  for (const k of known) {
    const out = strip((k || '').trim());
    if (out) return out;
  }

  // pass 1 — the most common "X - …" opener, if most lines agree on it
  const tally = new Map();
  for (const n of names) {
    const m = n.match(/^(.{1,80}?)\s+[-–—]\s+(.+)$/);
    if (m) tally.set(m[1], (tally.get(m[1]) || 0) + 1);
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > names.length / 2) {
    const out = strip(best[0]);
    if (out) return out;
  }

  // pass 2 — longest common prefix, cut back to a punctuation boundary
  let lcp = names[0];
  for (const n of names) {
    let i = 0;
    while (i < lcp.length && i < n.length && lcp[i] === n[i]) i++;
    lcp = lcp.slice(0, i);
    if (!lcp) return tracks;
  }
  const at = Math.max(...PASS2_SEPS.map((c) => lcp.lastIndexOf(c)));
  return strip(at < 0 ? '' : lcp.slice(0, at + 1).replace(TAIL_SEP, '')) || tracks;
}

// ── sides: split the tracklist where half the runtime falls ────────────────
function computeSides(tracks) {
  const total = tracks.reduce((s, t) => s + t.duration, 0);
  let cut = 1, best = Infinity, run = 0;
  for (let i = 0; i < tracks.length - 1; i++) {
    run += tracks[i].duration;
    const d = Math.abs(total / 2 - run);
    if (d < best) { best = d; cut = i + 1; }
  }
  const mk = (list) => {
    let at = 0;
    const withStarts = list.map((t) => { const o = { ...t, start: at }; at += t.duration; return o; });
    return {
      tracks: withStarts,
      duration: at || 20,              // a blank side still has grooves to crackle in
      seps: withStarts.slice(1).map((t) => t.start / (at || 1)),
    };
  };
  // single-track albums get a blank side B — it plays 20s of crackle
  const a = tracks.length > 1 ? tracks.slice(0, cut) : tracks;
  const b = tracks.length > 1 ? tracks.slice(cut) : [];
  return [mk(a), mk(b)];
}

// ── track durations, read off the files themselves (metadata only) ─────────
// An LP is 8–20 tracks and this was one throwaway <audio> per track. An
// audiobook is 300, and that shape falls over twice: removeAttribute('src')
// alone leaves WebKit holding every media resource (hundreds of live
// players), and indexOf-per-track made the gather O(n²). So: a POOL of four
// elements, torn down properly and reused, an index queue, progress you can
// watch, a token you can cancel with, and a cache so the second listen is
// instant.

const durPool = [];

function readDuration(path) {
  return new Promise((res) => {
    const a = durPool.pop() || new Audio();
    a.preload = 'metadata';
    let done = false;
    const onMeta = () => fin(isFinite(a.duration) && a.duration > 0 ? a.duration : 240);
    const onErr = () => fin(240);
    const timer = setTimeout(() => fin(240), 6000);
    function fin(d) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('error', onErr);
      // the teardown that matters: removeAttribute only detaches the URL —
      // load() on the now-empty element is what frees the media resource
      a.removeAttribute('src');
      try { a.load(); } catch (e) {}
      if (durPool.length < 4) durPool.push(a);
      res(d);
    }
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('error', onErr);
    a.src = fileURL(path);
  });
}

let durToken = 0;
const cancelDurations = () => { durToken++; };

// remembered per album, so a book you've heard before goes on instantly.
// Keyed on the album id (a hash of its folder) and guarded by the shape of
// the tracklist — add or rename files and we read them again.
const durKey = (al) => 'dur:' + al.id;
const durShape = (al) => al.tracks.length + '|' + al.tracks[0].name + '|' + al.tracks[al.tracks.length - 1].name;

async function cachedDurations(album) {
  try {
    const c = await tiny.store.get(durKey(album));
    if (c && c.shape === durShape(album) && Array.isArray(c.d) && c.d.length === album.tracks.length)
      return album.tracks.map((t, i) => ({ ...t, duration: c.d[i] }));
  } catch (e) {}
  return null;
}

// → tracks with durations, or null if something cancelled the read
async function readDurations(album, onProgress) {
  const token = ++durToken;
  const tracks = album.tracks;
  const out = new Array(tracks.length);
  let next = 0, done = 0;
  const workers = Array.from({ length: Math.min(4, tracks.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= tracks.length || token !== durToken) return;
      out[i] = { ...tracks[i], duration: await readDuration(tracks[i].path) };
      done++;
      if (onProgress && (done % 6 === 0 || done === tracks.length)) onProgress(done, tracks.length);
    }
  });
  await Promise.all(workers);
  if (token !== durToken) return null;
  try { await tiny.store.set(durKey(album), { shape: durShape(album), d: out.map((t) => t.duration) }); } catch (e) {}
  return out;
}

// ── the crate ──────────────────────────────────────────────────────────────
// Art resolution per sleeve: local file/tags → (if that comes up empty) the
// online hunt — CAA, iTunes, Deezer — queued one album at a time out of
// politeness to MusicBrainz. A colored blank jacket while we wait.

const lookupQueue = [];
const lookupTried = new Set();
let lookupBusy = false;

function queueLookup(el, album) {
  if (lookupTried.has(album.id)) return;
  lookupTried.add(album.id);
  lookupQueue.push({ el, album });
  pumpLookup();
}
async function pumpLookup() {
  if (lookupBusy || !lookupQueue.length) return;
  lookupBusy = true;
  const { el, album } = lookupQueue.shift();
  try {
    const r = await tiny.api.call('findArt', { id: album.id });
    if (r && r.art) {
      el.classList.remove('noart');
      el.style.background = '';
      el.style.backgroundImage = `url("${fileURL(r.art)}")`;
    }
  } catch (e) {}
  lookupBusy = false;
  pumpLookup();
}

const artObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    artObserver.unobserve(e.target);
    const el = e.target, id = el.dataset.id;
    const album = library.albums.find((a) => a.id === id) || spotifyList.find((a) => a.id === id);
    const noart = () => {                   // artless records get a coloured blank jacket
      el.classList.add('noart');
      let h = 5381;
      for (const c of id) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
      el.style.background = `linear-gradient(155deg, hsl(${h % 360}, 28%, 26%), hsl(${h % 360}, 34%, 13%))`;
      if (album && album.source !== 'spotify') queueLookup(el, album);   // go hunting
    };
    tiny.api.call('albumArt', { id }).then((p) => {
      if (p) el.style.backgroundImage = `url("${fileURL(p)}")`;
      else noart();
    }).catch(noart);
  }
}, { root: null, rootMargin: '200px' });

function allAlbums() { return [...library.albums, ...spotifyList]; }
// true only when the record on the deck is a Spotify one WE put on — so we
// never pause a phone/desktop Spotify session platter didn't start.
function playingSpotify() { return !!(current && current.album && current.album.source === 'spotify'); }

// two crates behind tabs, with a dig box and a sort — still one row of wood
let crateTab = 'local';
let crateQuery = '';
let crateSort = 'artist';

function crateItems() {
  let list = crateTab === 'local' ? library.albums : spotifyList;
  if (crateQuery) {
    const q = crateQuery.toLowerCase();
    list = list.filter((a) => (a.title + ' ' + a.artist).toLowerCase().includes(q));
  }
  if (crateSort === 'title') list = [...list].sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1));
  else if (crateSort === 'shuffle') {
    list = [...list];
    for (let i = list.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  return list;
}

// ── pulling a record UP out of the crate ───────────────────────────────────
// Clicking a sleeve opens it; so does lifting it, which is what your hands
// would actually do. The sleeve rises with the drag and the record comes out
// once it clears the lip — a horizontal drag is left alone, because that's
// the crate being flicked through sideways.
const CRATE_LIFT = 54;                     // px of upward drag to clear the lip
let crateDragOpened = false;

function bindCrateLift(el, album) {
  let st = null;
  const reset = () => { el.style.transform = ''; el.style.zIndex = ''; };
  el.addEventListener('pointerdown', (e) => {
    if (current || e.button) return;
    st = { x: e.clientX, y: e.clientY, id: e.pointerId, opened: false };
  });
  el.addEventListener('pointermove', (e) => {
    if (!st || st.id !== e.pointerId || st.opened) return;
    const dy = st.y - e.clientY, dx = Math.abs(e.clientX - st.x);
    if (dy < 3 || dx > dy) { reset(); return; }   // sideways: they're digging
    const lift = Math.min(dy, CRATE_LIFT);
    el.style.transform = `translateY(${-lift}px) rotate(${(-lift / CRATE_LIFT).toFixed(2)}deg)`;
    el.style.zIndex = '3';
    if (dy >= CRATE_LIFT) {
      st.opened = crateDragOpened = true;
      reset();
      pickAlbum(album);
    }
  });
  const end = () => { if (st) { st = null; reset(); } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', end);
}

function renderCrate() {
  const row = $('crateRow');
  row.innerHTML = '';
  $('tabLocal').classList.toggle('on', crateTab === 'local');
  $('tabSpotify').classList.toggle('on', crateTab === 'spotify');
  const addSleeve = (a) => {
    const s = document.createElement('div');
    s.className = 'sleeve';
    s.dataset.id = a.id;
    s.innerHTML = `<span class="tag">${esc(a.title)}<i>${esc(a.artist)}</i></span>` +
      (a.source === 'spotify' ? '<i class="spdot" title="Spotify"></i>' : '');
    s.addEventListener('click', () => {
      if (crateDragOpened) { crateDragOpened = false; return; }   // the drag already did it
      pickAlbum(a);
    });
    bindCrateLift(s, a);
    row.appendChild(s);
    artObserver.observe(s);
  };
  const list = crateItems();
  for (const a of list) addSleeve(a);
  if (crateTab === 'spotify' && !spConnected) {
    const s = document.createElement('div');
    s.className = 'sleeve spConnect';
    s.innerHTML = '<b>SPOTIFY</b><i>connect the amplifier — your saved albums join the crate</i>';
    s.addEventListener('click', () => { $('sources').hidden = false; refreshSpotifyUI(); });
    row.appendChild(s);
  } else if (!list.length) {
    const e = document.createElement('div');
    e.className = 'crateEmpty';
    e.textContent = crateQuery ? 'nothing in this crate matches "' + crateQuery + '"' : 'this crate is empty';
    row.appendChild(e);
  }
  $('welcome').hidden = !!allAlbums().length;
  if (library.dir && !allAlbums().length) {
    $('welcome').querySelector('p').textContent =
      'No records found in ' + library.dir + ' — folders with audio files inside become LPs.';
  }
}

async function setLibrary(dir) {
  hint('cataloguing the collection…', 0);
  library = await tiny.api.call('setLibrary', { dir });
  hint(library.albums.length ? `${library.albums.length} records in the crate` : 'no records found in that folder');
  renderCrate();
}

// ── pullout: sleeve in your hands, record still inside ─────────────────────
async function pickAlbum(album) {
  if (current) return;                       // a record is out — manners
  pulled = album;
  poDrag = null;
  poDragActed = false;
  document.body.dataset.state = 'pullout';
  $('pullout').hidden = false;
  $('pullout').classList.remove('sliding');
  const po = $('poArt');
  po.classList.remove('flipped', 'hasBack');
  po.querySelector('.front').style.backgroundImage = '';
  po.querySelector('.back').style.backgroundImage = '';
  tiny.api.call('albumArtData', { id: album.id }).then((uri) => {
    if (uri && pulled === album) {
      po.querySelector('.front').style.backgroundImage = `url("${uri}")`;
      album.artURI = uri;
    }
  }).catch(() => {});
  tiny.api.call('albumBack', { id: album.id }).then((pth) => {
    if (pth && pulled === album) {
      po.querySelector('.back').style.backgroundImage = `url("${fileURL(pth)}")`;
      po.classList.add('hasBack');
    }
  }).catch(() => {});
  hint(`${album.title}${album.artist ? ' — ' + album.artist : ''}`);
}

function putBack() {
  pulled = null;
  cancelDurations();                         // stop reading a book we dropped
  $('pullout').hidden = true;
  $('pullout').classList.remove('sliding');
  document.body.dataset.state = 'empty';
  hint('');
}

async function slideOut() {
  if (!pulled) return;
  const album = pulled;
  $('pullout').classList.add('sliding');
  hint('reading the grooves…', 0);

  let withDur;
  if (album.source === 'spotify') {
    withDur = album.tracks;                  // the API already told us
  } else {
    withDur = await cachedDurations(album);
    if (!withDur) {
      // a long record announces itself — an audiobook is minutes of reading
      // and a silent "reading the grooves…" looks like a dead app
      const long = album.tracks.length > 24;
      withDur = await readDurations(album, long
        ? (n, total) => hint(`reading the grooves… ${n} of ${total}  ·  esc to put it back`, 0)
        : null);
    }
  }
  if (!withDur || pulled !== album) return;  // they put it back mid-read
  // drop the "Artist - " that opens every line (the sleeve above already says it)
  withDur = stripCommonPrefix(withDur, album.artist, album.title);

  const img = await new Promise((res) => {
    if (!album.artURI) return res(null);
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = album.artURI;
  });

  const sides = computeSides(withDur);
  current = { album, img, sides, side: 0 };
  pulled = null;

  if (album.source === 'spotify') {
    setEngine(SPOT);
    SPOT.load(album, sides);
  } else {
    setEngine(PLAYER);
    PLAYER.setSides(sides);
  }
  DECK.setRecord(img, sides, album.title, album.artist);
  document.body.dataset.state = 'out';
  document.body.classList.add('recordOut');

  DECK.setView('aside');                     // make room for the sleeve display
  $('pullout').hidden = true;
  $('pullout').classList.remove('sliding');
  $('poSleeve').style.transform = '';

  // the sleeve, now empty, leans against the wall
  $('sleeveCard').hidden = false;
  const art = $('sleeveArt');
  art.classList.remove('flipped', 'hasBack');
  art.querySelector('.front').style.backgroundImage = album.artURI ? `url("${album.artURI}")` : '';
  art.querySelector('.back').style.backgroundImage = '';
  tiny.api.call('albumBack', { id: album.id }).then((p) => {
    if (p && current && current.album === album) {
      art.querySelector('.back').style.backgroundImage = `url("${fileURL(p)}")`;
      art.classList.add('hasBack');
      if (zoomAlbum === album) {           // the held-up copy gets it too
        const big = $('sleeveZoomArt');
        big.querySelector('.back').style.backgroundImage = `url("${fileURL(p)}")`;
        big.classList.add('hasBack');
        applyZoom();
      }
    }
  }).catch(() => {});
  $('sleeveTitle').textContent = album.title;
  $('sleeveArtist').textContent = album.artist;
  zoomAlbum = null;                          // the held-up copy is stale now
  tracksShown = false;
  renderSides();
  $('sleeveSides').hidden = true;
  $('tracksBtn').hidden = false;
  $('tracksBtn').textContent = 'tracks';
  $('putAway').hidden = false;

  await DECK.putRecord();
  scratchIfSpinning();                       // laid onto a platter still turning
  refreshPutAway();
  hint('start the motor, then set the needle down on the edge');
  // the sleeve on the wall is small; say once that it can be picked up
  if (!toldAboutZoom && album.artURI) setTimeout(hintZoomOnce, 9000);
}

// vinyl meeting a moving platter complains about it. Reachable both ways:
// leave the motor running with an empty deck and drop a record on, or hit
// put-away / flip while the platter is still coasting down.
function scratchIfSpinning(k = 1) {
  const r = (ENGINE && ENGINE.rate) ? ENGINE.rate() : 0;
  if (r > 0.06) PLAYER.scratch(Math.min(1, 0.3 + r * 0.8) * k);
}

function renderSides() {
  const el = $('sleeveSides');
  const names = ['SIDE ONE', 'SIDE TWO'];
  el.innerHTML = current.sides.map((s, si) => `
    <div class="side" data-side="${si}">
      <b>${names[si]}${si === current.side ? ' · ON THE PLATTER' : ''}</b>
      ${s.tracks.map((t, ti) => `<div class="tk" data-t="${si}:${ti}"><span class="no">${ti + 1}</span>${esc(t.name)}</div>`).join('')
      || '<div class="tk"><span class="no">–</span>(blank side)</div>'}
    </div>`).join('');
}

function markTrack(idx) {
  document.querySelectorAll('#sleeveSides .tk').forEach((el) => el.classList.remove('now'));
  if (idx < 0) return;
  const el = document.querySelector(`#sleeveSides .tk[data-t="${current.side}:${idx}"]`);
  if (el) el.classList.add('now');
  const tr = current.sides[current.side].tracks[idx];
  if (tr) nowline(`${tr.name} — ${current.album.title}, side ${current.side ? 'two' : 'one'}`);
}

let tracksShown = false;

// ── putting the record away ────────────────────────────────────────────────
// The manners say you can't, but the button used to just whisper a hint and
// look identical either way. Now it wears the refusal: dimmed and dashed
// while it's blocked, the reason under it on hover, and on a click it says
// the reason out loud AND points at the control that's in the way.

function putAwayBlock() {
  if (!current) return null;
  if (ENGINE.needleDown())
    return { at: 'arm', why: 'the needle is still in the groove',
             hint: 'lift the needle first — drag the tonearm back to its rest' };
  if (ENGINE.motorOn())
    return { at: 'power', why: 'the motor is still running',
             hint: 'stop the motor first — the switch is on the plinth' };
  return null;
}

let sayT = 0;
function refreshPutAway() {
  const b = $('putAway');
  if (b.hidden) return;
  const blk = putAwayBlock();
  b.classList.toggle('blocked', !!blk);
  b.title = blk ? blk.why : '';
  $('putAwayWhy').textContent = blk ? blk.why : '';
}

async function putAway() {
  if (!current) return;
  const blk = putAwayBlock();
  if (blk) {
    const b = $('putAway'), w = $('putAwayWhy');
    b.classList.remove('nope');
    void b.offsetWidth;                      // restart the shake on a re-click
    b.classList.add('nope');
    w.textContent = blk.why;
    w.classList.add('say');
    clearTimeout(sayT);
    sayT = setTimeout(() => w.classList.remove('say'), 4500);
    DECK.nudge(blk.at);                      // a ring pulses over the culprit
    hint(blk.hint, 5000);
    return;
  }
  scratchIfSpinning();                       // lifted off a platter still turning
  settleZoom(0);
  zoomAlbum = null;
  $('putAway').hidden = true;
  $('tracksBtn').hidden = true;
  $('putAwayWhy').textContent = '';
  nowline('');
  DECK.setView('center');
  await DECK.takeRecord();
  ENGINE.clear();
  setEngine(PLAYER);
  current = null;
  $('sleeveCard').hidden = true;
  document.body.dataset.state = 'empty';
  document.body.classList.remove('recordOut');
  hint('back in the crate');
}

// ── the flip ───────────────────────────────────────────────────────────────
let flipping = false;
async function flipRecord() {
  if (!current || flipping) return;
  if (ENGINE.needleDown()) { DECK.nudge('arm'); return hint('lift the needle first'); }
  if (ENGINE.motorOn()) { DECK.nudge('power'); return hint('stop the motor before touching the record'); }
  flipping = true;
  scratchIfSpinning();                       // off a platter that's still coasting
  current.side = current.side ? 0 : 1;
  ENGINE.setSide(current.side);
  renderSides();
  nowline('');
  await DECK.flip(current.side);
  scratchIfSpinning(0.8);                    // …and back down onto it
  flipping = false;
  hint(`side ${current.side ? 'two' : 'one'} is up`);
}

// ── SPOT: the Spotify Connect engine ───────────────────────────────────────
// Same contract as PLAYER, but sound comes out of whatever Spotify device
// is the "amplifier". The motor and the crackle stay OURS: rate is simulated
// locally (so spin-up looks right), the crackle bed is borrowed from the
// local WebAudio graph, and remote position is polled + interpolated.
const SPOT = (() => {
  let album = null, sides = null, sideIdx = 0;
  let needle = null, runout = false, motorOn = false, rate = 0, speed = 33;
  let playing = false, baseT = 0, baseAt = 0, trackIdx = -1;
  let pollT = null, deviceId = null, active = false, startPending = false;
  let lastPlayAt = 0, taughtPause = false;
  const P = { onTrack: null, onSideEnd: null };
  const remotePause = () => tiny.api.call('spotifyPause', {}).catch(() => {});

  const targetRate = () => (motorOn ? speed / 33.333 : 0);
  const curT = () => (playing ? baseT + (performance.now() - baseAt) / 1000 : (needle ? needle.t : 0));
  const absIndex = (si, i) => { let n = 0; for (let s = 0; s < si; s++) n += sides[s].tracks.length; return n + i; };
  const locate = (t) => {
    const s = sides[sideIdx];
    for (let i = 0; i < s.tracks.length; i++) if (t < s.tracks[i].start + s.tracks[i].duration) return i;
    return -1;
  };

  async function playAt(t) {
    if (startPending) return;
    const i = locate(t);
    if (i < 0) { enterRunout(); return; }
    const tr = sides[sideIdx].tracks[i];
    startPending = true;
    try {
      await tiny.api.call('spotifyPlay', {
        uri: album.uri, index: absIndex(sideIdx, i), positionMs: (t - tr.start) * 1000, deviceId,
      });
      trackIdx = i;
      baseT = t; baseAt = performance.now();
      lastPlayAt = performance.now();
      playing = true;
      if (P.onTrack) P.onTrack(i);
      if (!taughtPause) {
        taughtPause = true;
        setTimeout(() => hint('to pause: lift the needle — or stop the motor', 6000), 2500);
      }
    } catch (e) {
      hint(String((e && e.message) || e).replace(/^Error:\s*/, ''), 6000);
    }
    startPending = false;
  }

  function enterRunout() {
    runout = true; playing = false;
    needle = { t: sides[sideIdx].duration };
    remotePause();
    if (P.onSideEnd) P.onSideEnd();
  }

  async function poll() {
    if (!active || !needle || !playing) return;
    const st = await tiny.api.call('spotifyState', {}).catch(() => null);
    if (!st || !needle) return;
    const s = sides[sideIdx];
    const i = s.tracks.findIndex((tr) => tr.uri === st.trackUri);
    if (i >= 0) {
      if (i !== trackIdx) { trackIdx = i; if (P.onTrack) P.onTrack(i); }
      baseT = s.tracks[i].start + st.progressMs / 1000;
      baseAt = performance.now();
      // "not playing" right after our own play is just the device warming
      // up — don't let the race strand our model (it made pause unreachable)
      if (!st.playing && performance.now() - lastPlayAt > 6000) { playing = false; needle = { t: baseT }; }
    } else if (st.trackUri) {
      // the context rolled past this side's last track → that's the run-out
      enterRunout();
    }
  }

  let lastT = 0;
  function loop(now) {
    if (!active) return;
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    const tgt = targetRate();
    const k = tgt > rate ? 2.6 : 1.4;
    rate += (tgt - rate) * (1 - Math.exp(-k * dt));
    if (Math.abs(tgt - rate) < 0.004) rate = tgt;
    if (needle && !runout) {
      if (playing) {
        const t = curT();
        if (t >= sides[sideIdx].duration - 0.05) enterRunout();
        else needle = { t };
      } else if (motorOn && rate > 0.9 && !startPending) {
        playAt(needle.t);                     // motor came up with the needle down
      }
    }
    // our crackle, their music
    PLAYER.crackleBed(!needle ? 0 : runout ? 0.5 : playing ? 0.1 : (rate > 0.25 ? 0.5 : 0));
    requestAnimationFrame(loop);
  }

  return Object.assign(P, {
    load(al, s) {
      album = al; sides = s; sideIdx = 0;
      needle = null; runout = false; motorOn = false; playing = false; trackIdx = -1;
      active = true; lastT = performance.now();
      requestAnimationFrame(loop);
      clearInterval(pollT);
      pollT = setInterval(poll, 3000);
    },
    setDevice(id) { deviceId = id || null; },
    setSides(s) { sides = s; },
    setSide(i) { sideIdx = i; needle = null; runout = false; playing = false; trackIdx = -1; },
    clear() {
      remotePause();                       // unconditional: our model may be stale
      active = false; needle = null; playing = false; motorOn = false; rate = 0;
      clearInterval(pollT);
      PLAYER.crackleBed(null);
    },
    motor(on) {
      motorOn = on;
      if (!on) {
        remotePause();                     // even if we THINK nothing plays
        if (playing) needle = { t: curT() };
        playing = false;
      }
    },
    motorOn: () => motorOn,
    setSpeed(rpm) { speed = rpm; },          // visual only: Spotify won't chipmunk
    speed: () => speed,
    rate: () => rate,
    drop(t) {
      runout = false;
      needle = { t: Math.min(Math.max(0, t), sides[sideIdx].duration) };
      if (motorOn && rate > 0.9) playAt(needle.t);
    },
    lift() {
      if (needle) remotePause();           // unconditional while the arm is down
      needle = null; playing = false; runout = false; trackIdx = -1;
    },
    needleDown: () => !!needle,
    inRunout: () => runout,
    time: () => (runout ? sides[sideIdx].duration : curT()),
    trackIndex: () => trackIdx,
  });
})();

// ── deck callbacks: what the hardware means ────────────────────────────────
let pendingDrop = null;

DECK.init($('deck'), {
  onPower() {
    const on = !ENGINE.motorOn();
    ENGINE.motor(on);
    refreshPutAway();
    if (on) hint(current ? (ENGINE.needleDown() ? '' : 'now set the needle down') : 'the platter spins, empty');
    else if (ENGINE.needleDown()) hint('the record winds down under the needle…');
  },
  onSpeed() {
    const s = ENGINE.speed() === 33 ? 45 : 33;
    ENGINE.setSpeed(s);
    if (current && current.album.source === 'spotify')
      hint(s === 45 ? '45 rpm — but Spotify refuses to chipmunk. The platter spins faster anyway.' : '33⅓ rpm');
    else hint(s === 45 ? '45 rpm — every LP is a chipmunk record now' : '33⅓ rpm, as intended');
  },
  onNeedleDrop(radius) {
    if (!current) { pendingDrop = null; DECK.park(); return hint('there’s no record on the platter'); }
    pendingDrop = DECK.fracForRadius(radius) * current.sides[current.side].duration;
  },
  onNeedleLanded() {
    if (pendingDrop == null || !current) return;
    ENGINE.drop(pendingDrop);
    pendingDrop = null;
    refreshPutAway();
    if (!ENGINE.motorOn()) hint('the needle sits in a still groove — start the motor');
  },
  onNeedleLift() { ENGINE.lift(); nowline(''); refreshPutAway(); },
  onArmParked() { ENGINE.lift(); nowline(''); refreshPutAway(); },
  onRecordTap() { flipRecord(); },
  // while playing, the arm crawls inward with the music
  armTarget() {
    if (!current || !ENGINE.needleDown()) return null;
    const side = current.sides[current.side];
    return { radius: DECK.radiusForFrac(Math.min(1, ENGINE.time() / side.duration)), down: true };
  },
});

// the engines also move on their own (a side runs out, a remote device
// stops) — a slow tick keeps the put-away button honest either way
setInterval(() => { if (current) refreshPutAway(); }, 400);

PLAYER.onTrack = SPOT.onTrack = (idx) => markTrack(idx);
PLAYER.onSideEnd = SPOT.onSideEnd = () => {
  markTrack(-1);
  nowline('');
  hint(current && current.side === 0
    ? 'the side is over — lift the needle, stop the motor, flip the record'
    : 'the record is over — lift the needle and put it away, or drop it somewhere good');
};

// ── the deck itself: model, base colour, platter — U-Turn's options page ───
const deckCfg = { model: 'orbit', base: 'oak', mat: 'black' };
const CFG_CHOICES = {
  model: [['orbit', 'orbit'], ['sl1200', '1200']],
  base: [
    ['oak', 'linear-gradient(135deg,#c8a06a,#a9814e)'],
    ['walnut', 'linear-gradient(135deg,#5a4430,#3a2a1c)'],
    ['black', '#17171a'], ['white', '#f0efec'], ['red', '#c04a42'],
    ['blue', '#4a7aab'], ['green', '#3f8f6d'], ['silver', '#c4c7cc'],
  ],
  mat: [
    ['black', '#141415'], ['white', '#e8e6e0'], ['orange', '#d97a2e'],
    ['red', '#b03a32'], ['blue', '#3a6a9a'],
    ['acrylic', 'linear-gradient(135deg,rgba(255,255,255,.85),rgba(190,215,235,.25))'],
  ],
};

function buildDeckCfgUI() {
  for (const [key, choices] of Object.entries(CFG_CHOICES)) {
    const box = $('cfg' + key[0].toUpperCase() + key.slice(1));
    box.innerHTML = '';
    for (const [value, look] of choices) {
      const b = document.createElement('button');
      if (key === 'model') { b.className = 'txt'; b.textContent = look; }
      else { b.className = 'sw'; b.style.background = look; b.title = value; }
      b.dataset.v = value;
      b.addEventListener('click', () => {
        deckCfg[key] = value;
        applyDeckCfg();
        try { tiny.store.set('deck', deckCfg); } catch (e) {}
      });
      box.appendChild(b);
    }
  }
}

function applyDeckCfg() {
  DECK.configure(deckCfg);
  for (const key of Object.keys(CFG_CHOICES))
    document.querySelectorAll('#cfg' + key[0].toUpperCase() + key.slice(1) + ' button')
      .forEach((b) => b.classList.toggle('on', b.dataset.v === deckCfg[key]));
}
buildDeckCfgUI();

// ── the room: lamp, curtains, time of day, and the questionable switch ─────
const room = { lamp: true, curtains: false, disco: false };

function applyRoom() {
  const h = new Date().getHours();
  let base = (h >= 7 && h < 17) ? 'day' : (h >= 17 && h < 21) ? 'evening' : 'night';
  if (room.curtains) base = 'curtained';
  const L = room.lamp ? 1 : 0;
  const P = {
    day:       { amb: .85, key: .8 + 1.3 * L, fill: .6, win: 2.4, keyC: 0xffe2b8, winC: 0xeef2ff, a: '#38312a', b: '#171310', lamp: .10 + .10 * L, win2: .55 },
    evening:   { amb: .5, key: .5 + 1.9 * L, fill: .4, win: .8, keyC: 0xffd9a8, winC: 0xffb37a, a: '#241c14', b: '#0d0a07', lamp: .08 + .16 * L, win2: .28 },
    night:     { amb: .3, key: .18 + 2.3 * L, fill: .25, win: .05, keyC: 0xffd090, winC: 0x8899cc, a: '#191410', b: '#0a0806', lamp: .04 + .2 * L, win2: .06 },
    curtained: { amb: .27, key: .15 + 2.3 * L, fill: .22, win: 0, keyC: 0xffd090, winC: 0x8899cc, a: '#171310', b: '#090705', lamp: .03 + .2 * L, win2: 0 },
  }[base];
  DECK.setLighting({ amb: P.amb, key: P.key, fill: P.fill, win: P.win, keyC: P.keyC, winC: P.winC });
  DECK.setDisco(room.disco);
  const r = document.documentElement.style;
  r.setProperty('--room-a', P.a);
  r.setProperty('--room-b', P.b);
  r.setProperty('--lamp-glow', P.lamp);
  r.setProperty('--win-glow', P.win2);
  document.body.classList.toggle('curtained', room.curtains);
  document.body.classList.toggle('disco', room.disco);
  $('swLamp').classList.toggle('on', room.lamp);
  $('swCurtains').classList.toggle('on', room.curtains);
  $('swDisco').classList.toggle('on', room.disco);
}

function toggleRoom(key) {
  room[key] = !room[key];
  applyRoom();
  try { tiny.store.set('room', room); } catch (e) {}
  if (key === 'disco') hint(room.disco ? 'somebody unscrewed the good taste fuse' : 'the room recovers its dignity');
  if (key === 'curtains') hint(room.curtains ? 'curtains drawn — daytime is cancelled' : 'let there be daylight');
}

$('swLamp').addEventListener('click', () => toggleRoom('lamp'));
$('swCurtains').addEventListener('click', () => toggleRoom('curtains'));
$('swDisco').addEventListener('click', () => toggleRoom('disco'));
setInterval(applyRoom, 10 * 60 * 1000);      // the sun moves; the room follows

// ── sources panel (Spotify) ────────────────────────────────────────────────
async function refreshSpotifyUI() {
  try {
    const st = await tiny.api.call('spotifyStatus', {});
    $('spRedirect').textContent = st.redirect;
    if (st.clientId && !$('spClient').value) $('spClient').value = st.clientId;
    $('spStatus').textContent = st.connected ? 'connected' : 'not connected';
    $('spStatus').classList.toggle('ok', st.connected);
    $('spForget').hidden = !st.connected;
    $('spConnect').textContent = st.connected ? 'reconnect' : 'connect';
    $('spDeviceRow').hidden = !st.connected;
    if (st.connected) refreshDevices();
  } catch (e) {}
}

async function refreshDevices() {
  try {
    const devs = await tiny.api.call('spotifyDevices', {});
    const sel = $('spDevice');
    const prev = sel.value;
    sel.innerHTML = '<option value="">active device</option>' +
      devs.map((d) => `<option value="${esc(d.id)}"${d.active ? ' selected' : ''}>${esc(d.name)} (${esc(d.type)})</option>`).join('');
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    SPOT.setDevice(sel.value);
    if (!devs.length) $('spStatus').textContent = 'connected — open Spotify somewhere to give it an amplifier';
  } catch (e) {}
}

async function loadSpotifyAlbums() {
  try {
    spotifyList = await tiny.api.call('spotifyAlbums', {});
    renderCrate();
    if (spotifyList.length) hint(`${spotifyList.length} Spotify records join the crate`);
  } catch (e) {}
}

$('srcBtn').addEventListener('click', () => { $('sources').hidden = !$('sources').hidden; refreshSpotifyUI(); });
$('sourcesClose').addEventListener('click', () => { $('sources').hidden = true; });
$('spConnect').addEventListener('click', async () => {
  try {
    await tiny.api.call('spotifySetClient', { clientId: $('spClient').value });
    await tiny.api.call('spotifyConnect', {});
    $('spStatus').textContent = 'waiting for the browser…';
  } catch (e) {
    $('spStatus').textContent = String((e && e.message) || e).replace(/^Error:\s*/, '');
  }
});
$('spForget').addEventListener('click', async () => {
  await tiny.api.call('spotifyDisconnect', {});
  spotifyList = [];
  spConnected = false;
  renderCrate();
  refreshSpotifyUI();
});
$('spDevice').addEventListener('change', () => SPOT.setDevice($('spDevice').value));
$('spDevRefresh').addEventListener('click', refreshDevices);

tiny.api.on('hint', (h) => hint(h.text, h.ms || 4200));

tiny.api.on('spotify', (s) => {
  refreshSpotifyUI();
  spConnected = !!(s && s.connected);
  if (spConnected) { hint('Spotify connected — the amplifier hums'); loadSpotifyAlbums(); }
  else if (s && s.error) hint('Spotify: ' + s.error, 6000);
});

// ── the sleeve: click to turn it over, DRAG RIGHT to hold it up and read ───
// The leaning sleeve is thumbnail-sized on purpose, which is fine for
// recognising a record and useless for reading one. So it comes off the
// wall: drag right and it grows into the room (a bigger scan of the front
// swaps in on the way), a click still turns it over, and dragging back —
// or esc, or clicking the room — leans it against the wall again.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ZOOM_RANGE = 260;                    // px of drag for the full journey
let zoom = 0, zoomDrag = null, zoomAlbum = null, toldAboutZoom = false;

function applyZoom() {
  document.documentElement.style.setProperty('--z', zoom.toFixed(4));
  const z = $('sleeveZoom');
  z.hidden = zoom <= 0.001;
  z.classList.toggle('open', zoom > 0.5);
  const big = $('sleeveZoomArt');
  $('sleeveZoomTip').textContent = zoom > 0.5
    ? (big.classList.contains('hasBack')
        ? 'click to turn it over  ·  drag left, or esc, to put it back'
        : 'drag left, or esc, to put it back')
    : '';
}

function settleZoom(to) {
  const z = $('sleeveZoom');
  z.classList.add('settling');
  zoom = to;
  applyZoom();
  setTimeout(() => {
    z.classList.remove('settling');
    if (zoom <= 0.001) { z.hidden = true; $('sleeveZoomArt').classList.remove('flipped'); }
  }, 400);
}

// the big faces: start from what the small card already has (instant), then
// upgrade the front to a 1024px render if the backend can make one
async function loadZoomFaces(album) {
  if (zoomAlbum === album) return;
  zoomAlbum = album;
  const big = $('sleeveZoomArt');
  const small = $('sleeveArt');
  big.classList.remove('flipped', 'hasBack');
  big.querySelector('.front').style.backgroundImage = small.querySelector('.front').style.backgroundImage;
  const backImg = small.querySelector('.back').style.backgroundImage;
  big.querySelector('.back').style.backgroundImage = backImg;
  if (small.classList.contains('hasBack')) big.classList.add('hasBack');
  try {
    const p = await tiny.api.call('albumArt', { id: album.id, size: 1024 });
    if (p && zoomAlbum === album) big.querySelector('.front').style.backgroundImage = `url("${fileURL(p)}")`;
  } catch (e) {}
}

// one drag gesture, whether it started on the leaning sleeve or the big one
function bindSleeveDrag(el) {
  el.addEventListener('pointerdown', (e) => {
    if (!current) return;
    loadZoomFaces(current.album);
    zoomDrag = { x: e.clientX, z0: zoom, moved: 0, id: e.pointerId, el };
    el.classList.add('dragging');
    $('sleeveZoom').classList.remove('settling');
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
  });
  el.addEventListener('pointermove', (e) => {
    if (!zoomDrag || zoomDrag.id !== e.pointerId) return;
    const dx = e.clientX - zoomDrag.x;
    zoomDrag.moved = Math.max(zoomDrag.moved, Math.abs(dx));
    if (zoomDrag.moved <= 4) return;         // still could be a click
    zoom = clamp01(zoomDrag.z0 + dx / ZOOM_RANGE);
    applyZoom();
  });
  const end = (e) => {
    if (!zoomDrag || zoomDrag.id !== e.pointerId) return;
    const d = zoomDrag;
    zoomDrag = null;
    d.el.classList.remove('dragging');
    try { d.el.releasePointerCapture(e.pointerId); } catch (err) {}
    if (d.moved <= 4) {                      // a tap, not a drag: turn it over
      if (el.classList.contains('hasBack')) el.classList.toggle('flipped');
      else if (zoom < 0.5) hintZoomOnce();
      return;
    }
    settleZoom(zoom > 0.35 ? 1 : 0);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function hintZoomOnce() {
  if (toldAboutZoom) return;
  toldAboutZoom = true;
  hint('drag the sleeve to the right to hold it up and read it', 5000);
}

bindSleeveDrag($('sleeveArt'));
bindSleeveDrag($('sleeveZoomArt'));

// clicking the room around the held-up sleeve puts it back
$('sleeveZoom').addEventListener('pointerdown', (e) => {
  if (e.target === $('sleeveZoom') || e.target === $('sleeveZoomTip')) settleZoom(0);
});

$('poArt').addEventListener('click', () => {
  if (poDragActed) { poDragActed = false; return; }   // that was a drag, not a tap
  const a = $('poArt');
  if (a.classList.contains('hasBack')) a.classList.toggle('flipped');
});
$('tracksBtn').addEventListener('click', () => {
  tracksShown = !tracksShown;
  $('sleeveSides').hidden = !tracksShown;
  $('tracksBtn').textContent = tracksShown ? 'hide tracks' : 'tracks';
});

// ── self-update: platter updates itself through tinyjs' native updater ─────
// (tinyjs.json "update".url → manifest.json next to the zip in _builds/
// platter/). Auto-checks daily in the background; install() verifies sha256
// + signature, swaps the .app and relaunches — only failure needs handling.
let selfUp = null, selfBusy = false;

function renderSelfUpdate() {
  const b = $('updateBtn');
  b.hidden = !selfUp;
  if (selfUp) b.textContent = selfBusy ? 'fitting the new cartridge…' : `platter ${selfUp.latest} is out — update & relaunch`;
}

async function checkSelfUpdate() {
  try {
    const r = await tiny.api.call('update.check');
    if (r && r.available) { selfUp = { latest: r.latest, notes: r.notes }; renderSelfUpdate(); }
  } catch (e) { /* no manifest yet / offline — nothing to update to */ }
}

$('updateBtn').addEventListener('click', async () => {
  if (selfBusy || !selfUp) return;
  selfBusy = true;
  renderSelfUpdate();
  try {
    if (ENGINE.needleDown() || ENGINE.motorOn()) { ENGINE.lift(); ENGINE.motor(false); }
    if (playingSpotify()) await tiny.api.call('spotifyPause', {}).catch(() => {});
    await tiny.api.call('update.install');       // relaunches + quits on success
  } catch (e) {
    selfBusy = false;
    renderSelfUpdate();
    hint('update failed: ' + ((e && e.message) || e), 6000);
  }
});

tiny.api.on('update-available', (info) => {
  selfUp = { latest: info.latest, notes: info.notes };
  renderSelfUpdate();
});

// ── window chrome, menu, boot ──────────────────────────────────────────────
// leaving the room: if WE were driving the amplifier, stop it first — but
// don't touch Spotify if it's playing something we never started.
async function safeQuit() {
  if (playingSpotify()) {
    try {
      await Promise.race([
        tiny.api.call('spotifyPause', {}),
        new Promise((r) => setTimeout(r, 900)),
      ]);
    } catch (e) {}
  }
  tiny.quit();
}
window.addEventListener('keydown', (e) => {
  if (e.metaKey && (e.key === 'q' || e.key === 'w')) { e.preventDefault(); safeQuit(); }
});

// ── right-click: the house menu, not the browser's ─────────────────────────
function showCtx(x, y) {
  const m = $('ctxMenu');
  const items = [
    ['the shop (sources & deck)…', () => { $('sources').hidden = false; refreshSpotifyUI(); }],
    ['choose music folder…', chooseFolder],
    ['rescan the crate', () => library.dir && setLibrary(library.dir)],
    ['spin the sample record', playSample],
    null,
  ];
  if (current) {
    items.push(['flip the record', flipRecord]);
    items.push(['put the record away', putAway]);
    items.push(null);
  }
  items.push(['full screen', () => tiny.win.fullscreen()]);
  items.push(['quit platter', safeQuit]);
  m.innerHTML = '';
  for (const it of items) {
    if (!it) { m.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.textContent = it[0];
    b.addEventListener('click', () => { m.hidden = true; it[1](); });
    m.appendChild(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 10) + 'px';
  m.style.top = Math.min(y, window.innerHeight - r.height - 10) + 'px';
}
window.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtx(e.clientX, e.clientY); });
window.addEventListener('pointerdown', (e) => { if (!$('ctxMenu').contains(e.target)) $('ctxMenu').hidden = true; });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('ctxMenu').hidden = true; });

$('fsBtn').addEventListener('click', () => tiny.win.fullscreen());
$('quitBtn').addEventListener('click', safeQuit);
$('tabLocal').addEventListener('click', () => { crateTab = 'local'; renderCrate(); });
$('tabSpotify').addEventListener('click', () => { crateTab = 'spotify'; renderCrate(); });
$('crateSearch').addEventListener('input', () => { crateQuery = $('crateSearch').value.trim(); renderCrate(); });
$('crateSort').addEventListener('change', () => { crateSort = $('crateSort').value; renderCrate(); });

// copy the redirect URI (the dashboard wants it verbatim)
$('spCopy').addEventListener('click', async () => {
  const t = $('spRedirect').textContent;
  try { await navigator.clipboard.writeText(t); }
  catch (e) {
    const r = document.createRange();
    r.selectNodeContents($('spRedirect'));
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('copy');
    sel.removeAllRanges();
  }
  hint('redirect URI copied');
});

// the pulled-out sleeve leans with the mouse, like the deck does — except
// while you have hold of it, when it follows your hand instead
$('pullout').addEventListener('pointermove', (e) => {
  if ($('pullout').classList.contains('sliding') || poDrag) return;
  const nx = e.clientX / window.innerWidth - 0.5;
  const ny = e.clientY / window.innerHeight - 0.5;
  $('poSleeve').style.transform = `rotateY(${(nx * 10).toFixed(2)}deg) rotateX(${(-ny * 7).toFixed(2)}deg)`;
});

// ── the sleeve in your hands: up slides the record out, down puts it back ──
// The same vertical language as lifting one out of the crate. The buttons
// stay for anyone who'd rather read than gesture.
const PULL_TRIGGER = 90;                   // px before the gesture commits
let poDrag = null, poDragActed = false;

$('poSleeve').addEventListener('pointerdown', (e) => {
  if (!pulled || $('pullout').classList.contains('sliding')) return;
  poDrag = { y: e.clientY, x: e.clientX, id: e.pointerId, moved: 0, armed: '' };
  try { $('poSleeve').setPointerCapture(e.pointerId); } catch (err) {}
});
$('poSleeve').addEventListener('pointermove', (e) => {
  if (!poDrag || poDrag.id !== e.pointerId) return;
  const dy = e.clientY - poDrag.y;
  poDrag.moved = Math.max(poDrag.moved, Math.abs(dy));
  if (Math.abs(e.clientX - poDrag.x) > Math.abs(dy) && poDrag.moved < 6) return;
  const d = Math.max(-PULL_TRIGGER, Math.min(PULL_TRIGGER, dy));
  $('poSleeve').style.transform = `translateY(${d.toFixed(1)}px) rotate(${(d / PULL_TRIGGER * -1.2).toFixed(2)}deg)`;
  // the record starts to show itself on the way up
  $('poVinyl').style.transform = d < 0 ? `translateX(${(-d / PULL_TRIGGER * 16).toFixed(1)}%)` : '';
  // say what letting go would do, but only when that answer changes
  const armed = d <= -PULL_TRIGGER ? 'out' : d >= PULL_TRIGGER ? 'back' : '';
  if (armed !== poDrag.armed) {
    poDrag.armed = armed;
    if (armed === 'out') hint('let go to slide the record out', 0);
    else if (armed === 'back') hint('let go to put it back in the crate', 0);
    else hint('');
  }
});
const poDragEnd = (e) => {
  if (!poDrag || poDrag.id !== e.pointerId) return;
  const dy = e.clientY - poDrag.y, moved = poDrag.moved;
  poDrag = null;
  try { $('poSleeve').releasePointerCapture(e.pointerId); } catch (err) {}
  $('poSleeve').style.transform = '';
  $('poVinyl').style.transform = '';
  if (moved <= 6) return;                  // a tap: let the flip handler have it
  poDragActed = true;
  if (dy <= -PULL_TRIGGER) slideOut();
  else if (dy >= PULL_TRIGGER) putBack();
};
$('poSleeve').addEventListener('pointerup', poDragEnd);
$('poSleeve').addEventListener('pointercancel', poDragEnd);
$('chooseBtn').addEventListener('click', chooseFolder);
$('sampleBtn').addEventListener('click', playSample);
// leave the welcome up behind the sources panel (it sits on top, z 55 > 50);
// a successful connect hides it via renderCrate, backing out keeps the choices.
$('spotifyBtn').addEventListener('click', () => {
  $('sources').hidden = false;
  refreshSpotifyUI();
});

// the bundled sample record — from the welcome screen, or the ⚙ menu later on
// (once a real folder is loaded the crate no longer lists it, so we ask the
// backend for it on demand). Put away whatever's on the deck first.
async function playSample() {
  $('welcome').hidden = true;
  if (current) { hint('put the current record away first, then spin the sample'); return; }
  const demo = library.albums.find((a) => a.demo)
    || await tiny.api.call('sampleAlbum', {}).catch(() => null);
  if (demo) pickAlbum(demo);
}
$('poPlay').addEventListener('click', slideOut);
$('poBack').addEventListener('click', putBack);
$('putAway').addEventListener('click', putAway);
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (zoom > 0.001) settleZoom(0);           // put the held-up sleeve back
  else if (pulled) putBack();
});
window.addEventListener('resize', () => DECK.resize());

async function chooseFolder() {
  const dir = await tiny.dialog.pickFolder();
  if (dir) setLibrary(dir);
}

tiny.win.onDrop((paths) => { if (paths && paths.length && !current) setLibrary(paths[0]); });

tiny.api.on('menu', ({ id }) => {
  if (id === 'choose') chooseFolder();
  else if (id === 'rescan' && library.dir) setLibrary(library.dir);
  else if (id === 'sources') { $('sources').hidden = false; refreshSpotifyUI(); }
  else if (id === 'updates') {
    hint('checking for a newer platter…');
    checkSelfUpdate().then(() => {
      if (!selfUp) hint('you are spinning the latest platter');
    });
  }
  else if (id === 'fullscreen') tiny.win.fullscreen();
});

(async () => {
  try { Object.assign(room, (await tiny.store.get('room')) || {}); } catch (e) {}
  try { Object.assign(deckCfg, (await tiny.store.get('deck')) || {}); } catch (e) {}
  applyRoom();
  applyDeckCfg();
  library = await tiny.api.call('getLibrary', {});
  renderCrate();
  if (!library.dir) $('welcome').hidden = false;
  const st = await tiny.api.call('spotifyStatus', {}).catch(() => null);
  spConnected = !!(st && st.connected);
  if (spConnected) loadSpotifyAlbums();
  checkSelfUpdate();
})();
