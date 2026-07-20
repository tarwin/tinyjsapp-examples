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
  try {
    const info = await tiny.api.call('trackInfo', { path });
    if (shownPath !== path) return;              // track moved on while we waited
    fill(info, t);
    setArt(info && info.art ? info.art : null);
  } catch (e) { setArt(null); }
}

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
}

function setArt(src) {
  const img = $('art'), no = $('noart');
  if (src) { img.src = src; img.style.display = ''; no.style.display = 'none'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; no.style.display = ''; }
}

$('iLink').onclick = (e) => { e.preventDefault(); const u = e.target.dataset.url; if (u) tiny.app.shell.open(u); };
$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'info' });

tiny.api.on('state', (s) => { if (s) { state = s; render(); } });
(async () => { const s = await tiny.api.call('hello'); if (s) { state = s; render(); } })();
render();
