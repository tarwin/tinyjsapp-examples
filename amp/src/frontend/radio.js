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
}

tiny.api.on('state', (s) => { if (s) reflect(s); });

$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'radio' });

// the globe idles around at this window's own pace (throttled when hidden,
// which is exactly right — nothing here needs to run while unseen)
(function frame() {
  requestAnimationFrame(frame);
  tuner.draw();
})();

window.addEventListener('resize', () => tuner.sizeGlobe());

(async () => {
  await tuner.boot();
  try {
    const s = await tiny.api.call('hello');
    if (s) reflect(s);
  } catch (e) {}
})();
tiny.api.call('windowReady', { id: 'radio' }).catch(() => {});
