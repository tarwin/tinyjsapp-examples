// info.js — the "Track Info" panel. Reads the CURRENT track from the state the
// backend broadcasts, then asks the backend for its embedded tags + cover art
// (meta.js does the parsing) and paints a little sleeve-notes card. The link
// (a track's CONTACT/COMMENT URL — e.g. the Swine Island trailer on YouTube)
// opens in the real browser, never inside an amp window.
const $ = (id) => document.getElementById(id);
let state = { tracks: [], idx: -1 };
let shownPath = null;                 // guard: only refetch when the track changes
let shownKey = '';

const fmtDur = (s) => { s = Math.floor(s || 0); return s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '—'; };
const fmtSize = (b) => (!b ? '—' : b < 1024 * 1024 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
const stripExt = (n) => (n || '').replace(/\.[^.]+$/, '');

async function render() {
  const t = state.idx >= 0 && state.tracks ? state.tracks[state.idx] : null;
  const key = t ? ((t.path || t.url || '') + '#' + (t.duration || 0)) : '';
  if (key === shownKey) return;       // nothing structural changed
  shownKey = key;
  $('infoShade').textContent = t ? stripExt(t.name) : 'no track';

  if (!t) {
    $('iTitle').textContent = 'No track playing';
    $('iArtist').textContent = ''; $('iAlbum').textContent = '';
    $('iFormat').textContent = $('iLen').textContent = $('iSize').textContent = '—';
    $('iLink').style.display = 'none'; $('iPath').textContent = '';
    setArt(null);
    return;
  }

  // radio / remote-URL tracks have no local file to parse — show what we have
  if (!t.path) {
    fill({ title: t.name, artist: t.pod && t.pod.show, ext: '', size: 0 }, t);
    setArt(t.pod && t.pod.art ? t.pod.art : null);
    return;
  }

  // local file → parse tags + art in the backend
  const path = t.path; shownPath = path;
  fill({ title: stripExt(t.name) }, t);          // instant filename, upgraded below
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
    const info = await tiny.api.call('trackInfo', { path, force });
    if (shownPath !== path) return;              // track moved on while we waited
    fill(info, t);
    setArt(info && info.art ? info.art : null);
  } catch (e) { setArt(null); }
}

// Anything that didn't come out of the file is marked as such — dimmed, and
// credited underneath. A guess from a music database is useful; a guess passed
// off as the file's own metadata is not.
const SOURCE_NAME = { caa: 'Cover Art Archive', musicbrainz: 'MusicBrainz', itunes: 'iTunes', deezer: 'Deezer', cache: 'a previous lookup' };
function fill(info, t) {
  info = info || {};
  $('iTitle').textContent = info.title || stripExt(t.name) || '—';
  $('iArtist').textContent = info.artist || '';
  const bits = [info.album, info.date].filter(Boolean);
  $('iAlbum').textContent = bits.join(' · ');
  $('iFormat').textContent = (info.ext || (t.path || '').split('.').pop() || '').toUpperCase() || '—';
  $('iLen').textContent = fmtDur(t.duration);
  $('iSize').textContent = fmtSize(info.size || t.size);
  const link = info.link;
  const a = $('iLink');
  if (link) { a.style.display = ''; a.textContent = link.replace(/^https?:\/\/(www\.)?/, ''); a.dataset.url = link; }
  else a.style.display = 'none';
  const p = t.path || t.url || '';
  $('iPath').textContent = p; $('iPath').title = p;

  const guessed = !!info.tagSource;
  for (const id of ['iTitle', 'iArtist', 'iAlbum']) $(id).classList.toggle('guessed', guessed);
  $('artWrap').classList.toggle('guessed', !!info.artSource && info.artSource !== 'embedded');
  const credits = [];
  if (guessed) credits.push('tags from ' + (SOURCE_NAME[info.tagSource] || info.tagSource));
  if (info.artSource && info.artSource !== 'embedded') credits.push('cover from ' + (SOURCE_NAME[info.artSource] || info.artSource));
  $('iFound').textContent = credits.length ? credits.join(' · ') + ' — not in the file' : '';

  // offer the manual lookup only when there's a gap worth filling
  const missing = !info.art || (!info.artist && !info.album);
  const btn = $('iLookup');
  btn.style.display = (t.path && missing) ? '' : 'none';
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
$('iLookup').onclick = async (e) => {
  const btn = e.currentTarget, path = btn.dataset.path;
  const t = state.idx >= 0 && state.tracks ? state.tracks[state.idx] : null;
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

tiny.api.on('state', (s) => { if (s) { state = s; render(); } });
(async () => { const s = await tiny.api.call('hello'); if (s) { state = s; render(); } })();
render();
