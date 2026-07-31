// radio.js — the world radio as its own little panel (the same tuner brain
// the big screen uses — see tuner.js). Drag the globe, click a city, click a
// station; the MAIN window does the actual streaming, this panel just sends
// 'action's and renders the broadcast state like every other satellite.
const $ = (id) => document.getElementById(id);

const tuner = window.ampTuner({
  globe: $('globe'), list: $('stations'), city: $('tCity'),
  led: $('tLed'), off: $('tOff'),
});

// shade view: the tuned station + listening time, like the playlist's strip
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function reflect(s) {
  tuner.reflect(s);
  $('raShade').textContent = s.radio
    ? '📻 ' + (s.radio.name || '') + '   ' + fmt(s.elapsed)
    : 'no station';
  const u = (s.radio && s.radio.url) || '';
  if (u !== nowUrl) { nowUrl = u; paintNow(); }   // LIST/PICKS row highlight
}

tiny.api.on('state', (s) => { if (s) reflect(s); });

$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'radio' });

// the globe idles around at this window's own pace (throttled when hidden,
// which is exactly right — nothing here needs to run while unseen)
(function frame() {
  requestAnimationFrame(frame);
  tuner.draw();
})();

// ── the splitter: drag to trade globe for list ─────────────────────────────
// The dark panel stays FULL height (it's the globe's sky, not dead metal) and
// the divider sets only its width; tuner.js centers the globe circle in
// whatever box it gets, sized by the short side. Persisted; double-click goes
// back to the stock square-panel look.
const row = document.querySelector('.r-row'), split = $('rSplit'), globe = $('globe');
let gFrac = null;               // null = stock CSS sizing (square panel)
function layoutGlobe() {
  if (gFrac == null) globe.style.width = '';
  else {
    const r = row.getBoundingClientRect();
    if (!r.width) return;                          // shaded: nothing to measure
    globe.style.width = Math.round(Math.max(48, Math.min(0.85, gFrac) * r.width)) + 'px';
  }
  tuner.sizeGlobe();
}
let sdrag = null;
split.addEventListener('pointerdown', (e) => {
  sdrag = e.pointerId;
  try { split.setPointerCapture(sdrag); } catch (err) {}
  split.classList.add('live');
});
split.addEventListener('pointermove', (e) => {
  if (sdrag == null || e.pointerId !== sdrag) return;
  const r = row.getBoundingClientRect();
  if (!r.width) return;
  gFrac = Math.min(0.85, Math.max(0.12, (e.clientX - r.left) / r.width));
  layoutGlobe();
});
function endSplit(e) {
  if (sdrag == null || e.pointerId !== sdrag) return;
  sdrag = null;
  split.classList.remove('live');
  try { tiny.store.set('radioSplit', gFrac); } catch (err) {}
}
split.addEventListener('pointerup', endSplit);
split.addEventListener('pointercancel', endSplit);
split.addEventListener('dblclick', () => {
  gFrac = null; layoutGlobe();
  try { tiny.store.set('radioSplit', null); } catch (err) {}
});
tiny.store.get('radioSplit').then((v) => {
  if (typeof v === 'number') { gFrac = v; layoutGlobe(); }
}).catch(() => {});

window.addEventListener('resize', () => layoutGlobe());

// ── tabs: WORLD (the globe) | LIST (the directory) | PICKS (starter dial) ──
// WORLD is the tuner above, untouched. LIST is the vendored four-hundred-
// station directory (radio-list.js, CC0 — see its header); PICKS is the
// same idea as the podcast window's PICKS: what the dial opens with, not
// the user's favourites. Rows tune through the SAME 'radio' action as the
// globe, carrying the visible flat list so ⏮/⏭ step through what you see.
const act = (a) => tiny.api.call('action', a);
let rtab = 'world';
let nowUrl = '';                 // what's on air — row highlights
let altRows = [];                // the stations behind the rendered rows
// a .pls/.m3u "stream" URL wraps the real one — the backend unwraps it
// (the page can't fetch it: CORS). .m3u8 is HLS and plays as-is.
const needsResolve = (u) => /\.(pls|m3u)(\?|$)/i.test(u || '');
function setTab(t) {
  rtab = t;
  try { tiny.store.set('radioTab', t); } catch (e) {}
  $('tabWorld').classList.toggle('lit', t === 'world');
  $('tabList').classList.toggle('lit', t === 'list');
  $('tabPicks').classList.toggle('lit', t === 'picks');
  row.style.display = t === 'world' ? '' : 'none';
  $('rAlt').style.display = t === 'world' ? 'none' : '';
  $('rFilter').style.display = t === 'list' ? '' : 'none';
  if (t === 'world') layoutGlobe();      // remeasure: the canvas was display:none
  else renderAlt();
}
function renderAlt() {
  const ul = $('rAltList');
  ul.replaceChildren();
  altRows = [];
  const q = rtab === 'list' ? $('rFilter').value.trim().toLowerCase() : '';
  const groups = rtab === 'list'
    ? (window.RADIO_LIST || [])
    : [{ g: '', s: window.RADIO_PICKS || [] }];
  for (const grp of groups) {
    const hits = grp.s.filter((s) => !q || (s.n + ' ' + (s.d || '') + ' ' + grp.g).toLowerCase().includes(q));
    if (!hits.length) continue;
    if (grp.g) {
      const h = document.createElement('li');
      h.className = 'ghead';
      h.textContent = grp.g;
      ul.appendChild(h);
    }
    for (const s of hits) {
      const li = document.createElement('li');
      li.dataset.idx = altRows.length;
      const nm = document.createElement('span'); nm.className = 'nm';
      nm.textContent = (s.f ? '⭐ ' : '') + s.n;
      li.title = s.d || s.n;
      li.append(nm);
      if (nowUrl && (s.u === nowUrl || s.ru === nowUrl)) li.classList.add('on');
      ul.appendChild(li);
      altRows.push(s);
    }
  }
  if (!altRows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = q ? 'nothing matches "' + q + '"' : 'nothing here yet';
    ul.appendChild(li);
  }
}
function paintNow() {
  if (rtab === 'world') return;
  for (const li of $('rAltList').children) {
    if (li.dataset.idx == null) continue;
    const s = altRows[Number(li.dataset.idx)];
    li.classList.toggle('on', !!nowUrl && !!s && (s.u === nowUrl || s.ru === nowUrl));
  }
}
$('rAltList').addEventListener('click', async (e) => {
  const li = e.target.closest('li');
  if (!li || li.dataset.idx == null) return;
  const s = altRows[Number(li.dataset.idx)];
  if (!s) return;
  let url = s.ru || s.u;
  if (!s.ru && needsResolve(s.u)) {
    li.classList.add('tuning');
    const r = await tiny.api.call('resolveStream', { url: s.u }).catch(() => null);
    li.classList.remove('tuning');
    if (!r || !r.url) {
      const d = document.createElement('span');
      d.className = 'd'; d.textContent = 'stream unreachable';
      li.appendChild(d);
      setTimeout(() => d.remove(), 2000);
      return;
    }
    s.ru = url = r.url;
  }
  const list = altRows.map((x) => ({ name: x.n, url: x.ru || x.u }));
  act({ type: 'radio', station: { name: s.n, url }, list, idx: Number(li.dataset.idx) });
});
$('rFilter').addEventListener('input', () => renderAlt());
$('tabWorld').onclick = () => setTab('world');
$('tabList').onclick = () => setTab('list');
$('tabPicks').onclick = () => setTab('picks');
setTab('world');                     // lit state now; the saved tab lands async
tiny.store.get('radioTab').then((t) => {
  if (t === 'list' || t === 'picks') setTab(t);
}).catch(() => {});

(async () => {
  await tuner.boot();
  try {
    const s = await tiny.api.call('hello');
    if (s) reflect(s);
  } catch (e) {}
})();
tiny.api.call('windowReady', { id: 'radio' }).catch(() => {});
