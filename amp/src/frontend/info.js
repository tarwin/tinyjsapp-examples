// info.js — the "Track Info" panel. Reads the CURRENT track from the state the
// backend broadcasts, then asks the backend for its embedded tags + cover art
// (meta.js does the parsing) and paints a little sleeve-notes card. The link
// (a track's CONTACT/COMMENT URL — e.g. the Swine Island trailer on YouTube)
// opens in the real browser, never inside an amp window.
const $ = (id) => document.getElementById(id);
let state = { tracks: [], idx: -1 };
let shownPath = null;                 // guard: only refetch when the track changes
let shownKey = '';

// A right-clicked playlist row pins that track here — playing it is not
// required. While the pin differs from the playing track the panel grows two
// little tabs (Current | the pinned name) so both stay reachable; the pin
// only lets go when its track leaves the playlist, becomes the playing track
// (one view is enough), or its tab's × is clicked.
let pin = null;                       // { key }
let view = 'cur';                     // which tab is showing: 'cur' | 'pin'
const keyOf = (t) => (t && (t.path || t.url)) || '';
function resolve() {
  const cur = state.idx >= 0 && state.tracks ? state.tracks[state.idx] : null;
  let pinned = null;
  if (pin) {
    pinned = (state.tracks || []).find((tr) => keyOf(tr) === pin.key) || null;
    if (!pinned || keyOf(cur) === pin.key) { pin = null; pinned = null; view = 'cur'; }
  }
  return { cur, pinned };
}
function applyPin(idx) {
  const t = state.tracks && state.tracks[idx];
  if (!t) return;
  pin = { key: keyOf(t) };
  view = 'pin';
  render();
}
function renderTabs(pinned) {
  const strip = $('tabs');
  strip.style.display = pinned ? '' : 'none';
  if (!pinned) return;
  $('tabCur').classList.toggle('lit', view === 'cur');
  $('tabPin').classList.toggle('lit', view === 'pin');
  $('tabPinName').textContent = stripExt(pinned.name);
}

const fmtDur = (s) => { s = Math.floor(s || 0); return s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '—'; };
const fmtSize = (b) => (!b ? '—' : b < 1024 * 1024 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
const stripExt = (n) => (n || '').replace(/\.[^.]+$/, '');

async function render() {
  const { cur, pinned } = resolve();
  renderTabs(pinned);
  const t = view === 'pin' && pinned ? pinned : cur;
  // mmeta (a tracker module's own words) arrives a beat after the render —
  // part of the key so its landing repaints the card
  const key = t ? ((t.path || t.url || '') + '#' + (t.duration || 0) + '#' + (t.mmeta ? 'm' : '')) : '';
  if (key === shownKey) return;       // nothing structural changed
  shownKey = key;
  $('infoShade').textContent = t ? stripExt(t.name) : 'no track';

  if (!t) {
    $('iTitle').textContent = 'No track playing';
    $('iArtist').textContent = ''; $('iAlbum').textContent = '';
    $('iFormat').textContent = $('iLen').textContent = $('iSize').textContent = '—';
    $('iLink').style.display = 'none';
    $('iDir').textContent = $('iBase').textContent = ''; $('iPath').title = '';
    $('iCopy').style.display = $('iReveal').style.display = 'none';
    $('iMod').style.display = 'none';
    setArt(null);
    return;
  }

  // radio / remote-URL tracks have no local file to parse — show what we have
  if (!t.path) {
    fill({ title: t.name, artist: t.pod && t.pod.show, ext: '', size: 0 }, t);
    setArt(t.pod && t.pod.art ? t.pod.art : null);
    return;
  }

  // local file → parse tags + art in the backend. A downloaded episode is a
  // local file too, but the feed already told us the show and the cover —
  // paint them now rather than after the (likely tagless) file read.
  const path = t.path; shownPath = path;
  fill({ title: stripExt(t.name), artist: t.pod && t.pod.show }, t);   // instant, upgraded below
  if (t.pod && t.pod.art) setArt(t.pod.art);
  // that provisional fill has no art and no tags to judge by, so it would
  // offer the lookup button for a heartbeat on every track — only the real
  // read knows whether anything is actually missing
  $('iLookup').style.display = 'none';
  await load(path, t, false);
}

// force = the user pressed the button: go and ask even with the preference off,
// and even if we came back empty-handed last time.
async function load(path, t, force) {
  try {
    const info = (await tiny.api.call('trackInfo', { path, force })) || {};
    if (shownPath !== path) return;              // track moved on while we waited
    // a downloaded episode rarely embeds a picture or tags — the feed's cover
    // and show name are the right ones, credited to the feed not the file
    if (t.pod) {
      if (!info.art && t.pod.art) { info.art = t.pod.art; info.artSource = 'feed'; }
      if (!info.artist && t.pod.show) info.artist = t.pod.show;
    }
    fill(info, t);
    setArt(info.art || null);
  } catch (e) { setArt(null); }
}

// Anything that didn't come out of the file is marked as such — dimmed, and
// credited underneath. A guess from a music database is useful; a guess passed
// off as the file's own metadata is not.
const SOURCE_NAME = { caa: 'Cover Art Archive', musicbrainz: 'MusicBrainz', itunes: 'iTunes', deezer: 'Deezer', cache: 'a previous lookup', feed: 'the podcast feed' };
function fill(info, t) {
  info = info || {};
  // a tracker module's own words (read by the render worker) beat filename
  // guesses; its message / sample names get their own box below
  const mm = t.mmeta;
  if (mm) {
    if (!info.title && mm.title) info.title = mm.title;
    if (!info.artist && mm.artist) info.artist = mm.artist;
  }
  $('iTitle').textContent = info.title || stripExt(t.name) || '—';
  $('iArtist').textContent = info.artist || '';
  const bits = [info.album, info.date].filter(Boolean);
  $('iAlbum').textContent = bits.join(' · ');
  $('iFormat').textContent = (info.ext || (t.path || '').split('.').pop() || '').toUpperCase() || '—';
  if (mm && mm.type) $('iFormat').textContent += ' · ' + mm.type;
  $('iLen').textContent = fmtDur(t.duration);
  $('iSize').textContent = fmtSize(info.size || t.size);
  const link = info.link;
  const a = $('iLink');
  if (link) { a.style.display = ''; a.textContent = link.replace(/^https?:\/\/(www\.)?/, ''); a.dataset.url = link; }
  else a.style.display = 'none';
  // dir + name in separate spans so CSS can collapse the directory first
  const p = t.path || t.url || '';
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1;
  $('iDir').textContent = p.slice(0, cut); $('iBase').textContent = p.slice(cut);
  $('iPath').title = p;
  $('iCopy').style.display = p ? '' : 'none';
  $('iReveal').style.display = t.path ? '' : 'none';   // a stream URL has nowhere to reveal
  $('iReveal').dataset.path = t.path || '';

  const guessed = !!info.tagSource;
  for (const id of ['iTitle', 'iArtist', 'iAlbum']) $(id).classList.toggle('guessed', guessed);
  $('artWrap').classList.toggle('guessed', !!info.artSource && info.artSource !== 'embedded');
  const credits = [];
  if (guessed) credits.push('tags from ' + (SOURCE_NAME[info.tagSource] || info.tagSource));
  if (info.artSource && info.artSource !== 'embedded') credits.push('cover from ' + (SOURCE_NAME[info.artSource] || info.artSource));
  $('iFound').textContent = credits.length ? credits.join(' · ') + ' — not in the file' : '';

  // the greetz box: a module's message if it wrote one, else the instrument
  // names (XM/IT convention), else the sample names (MOD/S3M convention)
  const modBox = $('iMod');
  const greetz = mm
    ? ((mm.message || '').trim() || (mm.instruments && mm.instruments.length ? mm.instruments.join('\n') : '')
        || (mm.samples && mm.samples.length ? mm.samples.join('\n') : ''))
    : '';
  modBox.textContent = greetz.replace(/\n{3,}/g, '\n\n');
  modBox.style.display = greetz ? '' : 'none';

  // offer the manual lookup only when there's a gap worth filling — and never
  // for podcasts or tracker modules: a music database has nothing to say here
  const missing = !info.art || (!info.artist && !info.album);
  const btn = $('iLookup');
  btn.style.display = (t.path && !t.pod && missing && !/\.(mid|midi|mod|s3m|xm|it|mptm)$/i.test(t.path)) ? '' : 'none';
  btn.disabled = false;
  btn.textContent = 'Look up cover & tags';
  btn.dataset.path = t.path || '';
}

function setArt(src) {
  const img = $('art'), no = $('noart');
  if (src) { img.src = src; img.style.display = ''; no.style.display = 'none'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; no.style.display = ''; }
}

$('iLink').onclick = (e) => { e.preventDefault(); const u = e.target.dataset.url; if (u) tiny.app.shell.open(u); };
$('iCopy').onclick = async (e) => {
  const p = $('iPath').title; if (!p) return;
  try { await tiny.clipboard.write({ text: p }); } catch (err) { return; }
  const b = e.currentTarget;
  b.textContent = '✓ Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 900);
};
$('iReveal').onclick = (e) => { const p = e.currentTarget.dataset.path; if (p) tiny.app.shell.reveal(p); };
$('iLookup').onclick = async (e) => {
  const btn = e.currentTarget, path = btn.dataset.path;
  const { cur, pinned } = resolve();
  const t = view === 'pin' && pinned ? pinned : cur;
  if (!path || !t) return;
  btn.disabled = true;
  btn.textContent = 'Looking…';       // MusicBrainz is rate-limited: this takes a beat
  $('iFound').textContent = '';
  await load(path, t, true);
  // fill() re-enables the button as a matter of course; if the lookup credited
  // nothing then nothing was found, and saying so beats looking idle
  if (shownPath === path && !$('iFound').textContent) {
    btn.textContent = 'Nothing found'; btn.disabled = true;
  }
};
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'info' });

$('tabCur').onclick = () => { if (view !== 'cur') { view = 'cur'; render(); } };
$('tabPin').onclick = () => { if (view !== 'pin') { view = 'pin'; render(); } };
$('tabPinX').onclick = (e) => { e.stopPropagation(); pin = null; view = 'cur'; render(); };

tiny.api.on('state', (s) => { if (s) { state = s; render(); } });
// a right-click while this window is already open lands here (idx = the row);
// "Current Track Info…" arrives as idx null and flips back to the playing
// tab. A right-click that CREATED this window parked its index in the
// backend — collected after hello, when there's a track list to resolve it.
tiny.api.on('inspect', ({ idx }) => {
  if (idx == null) { view = 'cur'; render(); }
  else applyPin(idx);
});
(async () => {
  const s = await tiny.api.call('hello');
  if (s) { state = s; render(); }
  try { const p = await tiny.api.call('inspectTarget'); if (p) applyPin(p.idx); } catch (e) {}
})();
render();
