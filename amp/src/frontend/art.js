// art.js — the sleeve: album art as big as the screen allows.
//
// The hidden feature behind clicking the cover in Track Info. This window
// never figures out what the art IS — the info card already runs the whole
// pipeline (embedded tags, a podcast's feed image, the online lookup), so the
// sleeve just shows whatever the card shows, pushed over as a 'cover' event,
// and stays in step when the track changes.
//
// Drag anywhere to move it. Resize by the edges like any amp window.
// Double-click fits the window to the art again. Esc or the × closes.

const $ = (id) => document.getElementById(id);
const img = $('cover');
let caption = '';

function apply(uri, cap) {
  caption = cap || '';
  $('cap').textContent = caption;
  if (uri) img.src = uri;
  else img.removeAttribute('src');
  document.title = caption ? 'amp — ' + caption : 'amp — cover';
}

// Fit the window to the art: the image's aspect at ~82% of the screen's
// shorter span, so "as large as possible" is literal without being a takeover.
async function fit() {
  if (!img.naturalWidth || !img.naturalHeight) return;
  try {
    const screens = await tiny.app.screens();
    const s = (screens && screens[0] && (screens[0].visible || screens[0])) || { width: 1440, height: 900 };
    const max = Math.min(s.width, s.height) * 0.82;
    const r = img.naturalWidth / img.naturalHeight;
    const w = Math.round(r >= 1 ? max : max * r);
    const h = Math.round(r >= 1 ? max / r : max);
    await tiny.win.setSize(Math.max(160, w), Math.max(160, h));
  } catch (e) {}
}

// first load fits; later track changes keep whatever size you dragged it to
let fitted = false;
img.addEventListener('load', () => { if (!fitted) { fitted = true; fit(); } });

tiny.api.on('cover', (c) => { if (c) apply(c.uri, c.caption); });

$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'art' });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') tiny.api.call('toggleWindow', { id: 'art' });
});
$('wrap').addEventListener('dblclick', fit);
if (window.ampBindDrag) window.ampBindDrag($('wrap'));

// whatever was parked while this window was being created
(async () => {
  try {
    const t = await tiny.api.call('artTarget');
    if (t && t.uri) apply(t.uri, t.caption);
  } catch (e) {}
})();
