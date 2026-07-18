// tuner.js — the world-radio brain, shared by the big screen's tuner unit
// (rack.html) and the standalone Radio window (radio.html). One factory owns
// the LED globe, the city list, the station fetch, and tuning; the host page
// supplies the elements and calls draw() from its own rAF loop.
//
// Cities are the tuner's dial stops — enough of them that everyone has one in
// reach; stations come from the backend (radio-browser.info, sorted by real
// distance from the city). No basemap: a graticule and a constellation of
// city dots read perfectly on a tuner display.
window.ampTuner = function ampTuner(els) {
  // els: { globe, list, city, led, off }
  const act = (a) => tiny.api.call('action', a);
  const CITIES = [
    ['Melbourne', -37.81, 144.96], ['Sydney', -33.87, 151.21], ['Brisbane', -27.47, 153.03],
    ['Perth', -31.95, 115.86], ['Adelaide', -34.93, 138.60], ['Hobart', -42.88, 147.33],
    ['Darwin', -12.46, 130.84], ['Auckland', -36.85, 174.76], ['Wellington', -41.29, 174.78],
    ['Suva', -18.14, 178.44], ['Tokyo', 35.68, 139.69], ['Osaka', 34.69, 135.50],
    ['Seoul', 37.57, 126.98], ['Beijing', 39.90, 116.41], ['Shanghai', 31.23, 121.47],
    ['Hong Kong', 22.32, 114.17], ['Taipei', 25.03, 121.57], ['Manila', 14.60, 120.98],
    ['Bangkok', 13.76, 100.50], ['Singapore', 1.35, 103.82], ['Kuala Lumpur', 3.14, 101.69],
    ['Jakarta', -6.21, 106.85], ['Hanoi', 21.03, 105.85], ['Mumbai', 19.08, 72.88],
    ['Delhi', 28.61, 77.21], ['Bangalore', 12.97, 77.59], ['Karachi', 24.86, 67.01],
    ['Dubai', 25.20, 55.27], ['Tehran', 35.69, 51.39], ['Riyadh', 24.71, 46.68],
    ['Istanbul', 41.01, 28.98], ['Tel Aviv', 32.08, 34.78], ['Athens', 37.98, 23.73],
    ['London', 51.51, -0.13], ['Manchester', 53.48, -2.24], ['Edinburgh', 55.95, -3.19],
    ['Dublin', 53.35, -6.26], ['Paris', 48.86, 2.35], ['Madrid', 40.42, -3.70],
    ['Barcelona', 41.39, 2.17], ['Lisbon', 38.72, -9.14], ['Rome', 41.90, 12.50],
    ['Milan', 45.46, 9.19], ['Zurich', 47.37, 8.54], ['Geneva', 46.20, 6.14],
    ['Vienna', 48.21, 16.37], ['Berlin', 52.52, 13.40], ['Munich', 48.14, 11.58],
    ['Hamburg', 53.55, 9.99], ['Amsterdam', 52.37, 4.90], ['Brussels', 50.85, 4.35],
    ['Copenhagen', 55.68, 12.57], ['Oslo', 59.91, 10.75], ['Stockholm', 59.33, 18.07],
    ['Helsinki', 60.17, 24.94], ['Warsaw', 52.23, 21.01], ['Prague', 50.08, 14.44],
    ['Budapest', 47.50, 19.04], ['Kyiv', 50.45, 30.52], ['Reykjavik', 64.15, -21.94],
    ['Cairo', 30.04, 31.24], ['Lagos', 6.52, 3.38], ['Nairobi', -1.29, 36.82],
    ['Johannesburg', -26.20, 28.05], ['Cape Town', -33.92, 18.42], ['Casablanca', 33.57, -7.59],
    ['Accra', 5.60, -0.19], ['Addis Ababa', 9.01, 38.75], ['Tunis', 36.81, 10.18],
    ['Dakar', 14.72, -17.47], ['New York', 40.71, -74.01], ['Boston', 42.36, -71.06],
    ['Philadelphia', 39.95, -75.17], ['Washington', 38.91, -77.04], ['Toronto', 43.65, -79.38],
    ['Montreal', 45.50, -73.57], ['Chicago', 41.88, -87.63], ['Detroit', 42.33, -83.05],
    ['Minneapolis', 44.98, -93.27], ['Nashville', 36.16, -86.78], ['New Orleans', 29.95, -90.07],
    ['Atlanta', 33.75, -84.39], ['Miami', 25.76, -80.19], ['Dallas', 32.78, -96.80],
    ['Houston', 29.76, -95.37], ['Austin', 30.27, -97.74], ['Denver', 39.74, -104.99],
    ['Seattle', 47.61, -122.33], ['Portland', 45.52, -122.68], ['Vancouver', 49.28, -123.12],
    ['San Francisco', 37.77, -122.42], ['Los Angeles', 34.05, -118.24], ['Las Vegas', 36.17, -115.14],
    ['Anchorage', 61.22, -149.90], ['Honolulu', 21.31, -157.86], ['Mexico City', 19.43, -99.13],
    ['Havana', 23.11, -82.37], ['Bogotá', 4.71, -74.07], ['Lima', -12.05, -77.04],
    ['Santiago', -33.45, -70.67], ['Buenos Aires', -34.60, -58.38], ['Montevideo', -34.90, -56.16],
    ['São Paulo', -23.55, -46.63], ['Rio de Janeiro', -22.91, -43.17],
  ].map(([city, lat, lon]) => ({ city, lat, lon }));

  const RAD = Math.PI / 180;
  const gcv = els.globe, gg = gcv.getContext('2d');
  let view = { lon: 0, lat: 20, zoom: 1 };   // zoom: 1 (whole globe) … 8
  let loc = null;                 // { city, lat, lon } — the chosen dial stop
  let stations = [];              // slim station list from the backend
  let radioNow = null;            // state.radio mirror (what's actually tuned)
  let playingNow = false;

  function sizeGlobe() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = Math.max(64, Math.round((gcv.clientHeight || 120) * dpr));
    if (gcv.width !== s) { gcv.width = s; gcv.height = s; }
  }
  function gproj(lat, lon, cx, cy, R) {
    const f = lat * RAD, l = (lon - view.lon) * RAD, t = view.lat * RAD;
    const x0 = Math.cos(f) * Math.sin(l), y0 = Math.sin(f), z0 = Math.cos(f) * Math.cos(l);
    return { x: cx + x0 * R, y: cy - (y0 * Math.cos(t) - z0 * Math.sin(t)) * R,
      z: y0 * Math.sin(t) + z0 * Math.cos(t) };
  }
  // the canvas follows the page's display-color palette (style.css --lcd /
  // --lcd-sel; the rack defines its own green, so its globe stays green)
  let palKey = '', palA = [55, 255, 155], palB = [255, 180, 55];
  function palette() {
    const cs = getComputedStyle(gcv);
    const key = cs.getPropertyValue('--lcd') + '|' + cs.getPropertyValue('--lcd-sel');
    if (key === palKey) return;
    palKey = key;
    const hex = (v, d) => {
      const m = /^#([0-9a-f]{6})$/i.exec((v || '').trim());
      return m ? [1, 3, 5].map((i) => parseInt(m[1].slice(i - 1, i + 1), 16)) : d;
    };
    palA = hex(cs.getPropertyValue('--lcd'), [55, 255, 155]);
    palB = hex(cs.getPropertyValue('--lcd-sel'), [255, 180, 55]);
  }
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  let gDrag = null;
  function draw() {
    const w = gcv.width; if (!w) return;
    palette();
    const cx = w / 2, cy = w / 2, R = (w / 2 - w * 0.07) * view.zoom;
    if (!gDrag) view.lon += 0.06 / view.zoom;  // the world idles by (slower up close)
    gg.clearRect(0, 0, w, w);
    gg.strokeStyle = rgba(palA, 0.45); gg.lineWidth = Math.max(1, w * 0.006);
    gg.beginPath(); gg.arc(cx, cy, R, 0, Math.PI * 2); gg.stroke();
    // graticule: sample, connect only runs facing us
    gg.strokeStyle = rgba(palA, 0.16); gg.lineWidth = 1;
    const line = (pts) => {
      gg.beginPath(); let pen = false;
      for (const p of pts) {
        if (p.z <= 0.02) { pen = false; continue; }
        if (pen) gg.lineTo(p.x, p.y); else gg.moveTo(p.x, p.y);
        pen = true;
      }
      gg.stroke();
    };
    // the graticule densifies as you zoom, so there's always a grid in view
    const gStep = view.zoom >= 3.5 ? 10 : view.zoom >= 1.8 ? 15 : 30;
    const sStep = view.zoom >= 1.8 ? 3 : 6;
    for (let m = -180; m < 180; m += gStep) {
      const pts = []; for (let a = -84; a <= 84; a += sStep) pts.push(gproj(a, m, cx, cy, R));
      line(pts);
    }
    for (let p = -60; p <= 60; p += gStep) {
      const pts = []; for (let a = 0; a <= 360; a += sStep) pts.push(gproj(p, a, cx, cy, R));
      line(pts);
    }
    // coastlines + country borders (world-outline.js — Natural Earth 110m,
    // simplified to ~2700 points; each polyline is flat [lon,lat,lon,lat,…])
    if (window.WORLD_OUTLINE) {
      gg.strokeStyle = rgba(palA, 0.34); gg.lineWidth = Math.max(1, w * 0.003);
      gg.beginPath();
      for (const seg of window.WORLD_OUTLINE) {
        let pen = false;
        for (let i = 0; i < seg.length; i += 2) {
          const p = gproj(seg[i + 1], seg[i], cx, cy, R);
          if (p.z <= 0.02) { pen = false; continue; }
          if (pen) gg.lineTo(p.x, p.y); else gg.moveTo(p.x, p.y);
          pen = true;
        }
      }
      gg.stroke();
    }
    // the constellation of cities (dots grow gently as you zoom in)
    const dotK = Math.sqrt(view.zoom);
    for (const c of CITIES) {
      const p = gproj(c.lat, c.lon, cx, cy, R);
      if (p.z <= 0.02) continue;
      const sel = loc && c.city === loc.city;
      gg.fillStyle = sel ? rgba(palB, 1) : rgba(palA, +(0.25 + p.z * 0.65).toFixed(2));
      gg.beginPath(); gg.arc(p.x, p.y, ((sel ? 0.016 : 0.008) * w + p.z * w * 0.004) * dotK, 0, Math.PI * 2); gg.fill();
      if (sel) {
        const pulse = 1 + 0.35 * Math.sin(performance.now() / 300);
        gg.strokeStyle = rgba(palB, 0.7); gg.lineWidth = Math.max(1, w * 0.005);
        gg.beginPath(); gg.arc(p.x, p.y, w * 0.03 * pulse, 0, Math.PI * 2); gg.stroke();
      }
    }
  }
  if (!gcv.title) gcv.title = 'drag to spin · scroll or pinch to zoom · tap a city';
  gcv.addEventListener('pointerdown', (e) => {
    gDrag = { x: e.clientX, y: e.clientY, lon: view.lon, lat: view.lat, moved: 0, pid: e.pointerId };
    gcv.classList.add('dragging');
    try { gcv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  gcv.addEventListener('pointermove', (e) => {
    if (!gDrag || e.pointerId !== gDrag.pid) return;
    const dx = e.clientX - gDrag.x, dy = e.clientY - gDrag.y;
    gDrag.moved = Math.max(gDrag.moved, Math.abs(dx) + Math.abs(dy));
    const k = 36 / (gcv.clientWidth || 120) / view.zoom;   // ~full spin per drag-across; finer up close
    view.lon = gDrag.lon - dx * k * 10;
    view.lat = Math.max(-75, Math.min(75, gDrag.lat + dy * k * 10));
  });
  // scroll (or trackpad pinch — WebKit sends those as gesture events) zooms;
  // it bottoms out at the whole globe, so scrolling out always gets you home
  function setZoom(z) { view.zoom = Math.max(1, Math.min(5, z)); }
  gcv.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(view.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
  }, { passive: false });
  let pinch0 = 1;
  gcv.addEventListener('gesturestart', (e) => { e.preventDefault(); pinch0 = view.zoom; });
  gcv.addEventListener('gesturechange', (e) => { e.preventDefault(); setZoom(pinch0 * e.scale); });
  function gUp(e) {
    if (!gDrag || (e.pointerId !== undefined && e.pointerId !== gDrag.pid)) return;
    const wasTap = gDrag.moved < 5;
    gDrag = null;
    gcv.classList.remove('dragging');
    if (!wasTap) return;
    // a tap: pick the closest visible city within reach
    const rect = gcv.getBoundingClientRect();
    const scale = gcv.width / rect.width;
    const mx = (e.clientX - rect.left) * scale, my = (e.clientY - rect.top) * scale;
    const w = gcv.width, cx = w / 2, cy = w / 2, R = (w / 2 - w * 0.07) * view.zoom;
    let best = null, bd = w * 0.08;
    for (const c of CITIES) {
      const p = gproj(c.lat, c.lon, cx, cy, R);
      if (p.z <= 0.02) continue;
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) setLoc(best, true);
  }
  gcv.addEventListener('pointerup', gUp);
  gcv.addEventListener('pointercancel', () => { gDrag = null; gcv.classList.remove('dragging'); });

  function stationNote(msg) {
    els.list.replaceChildren();
    const li = document.createElement('li');
    li.className = 'empty'; li.textContent = msg;
    els.list.appendChild(li);
  }
  function renderStations() {
    els.list.replaceChildren();
    if (!stations.length) { stationNote('nothing on the air near ' + (loc ? loc.city : 'here')); return; }
    stations.forEach((s, i) => {
      const li = document.createElement('li');
      li.dataset.idx = i;
      if (radioNow && radioNow.url === s.url) li.className = 'on';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = li.className ? '' : '·';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = s.name;
      nm.title = s.name + (s.place ? ' — ' + s.place : '') + ' · ' + (s.codec || '') + (s.bitrate ? ' ' + s.bitrate + 'k' : '');
      const d = document.createElement('span'); d.className = 'd';
      d.textContent = s.km >= 1 ? s.km + 'km' : 'here';
      li.append(n, nm, d);
      els.list.appendChild(li);
    });
  }
  els.list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li || li.classList.contains('empty')) return;
    const s = stations[Number(li.dataset.idx)];
    if (!s) return;
    // already tuned to this station and audibly on the air? A second click
    // (or a double-click) must not restart the stream.
    if (radioNow && radioNow.url === s.url && playingNow) return;
    act({ type: 'radio', station: { name: s.name, url: s.url, uuid: s.uuid },
      list: stations.map(({ name, url, uuid }) => ({ name, url, uuid })),
      idx: Number(li.dataset.idx) });
  });
  els.off.onclick = () => act({ type: 'radioOff' });

  let locSeq = 0;
  async function setLoc(c, persistIt) {
    loc = c;
    locSeq++;
    const seq = locSeq;
    els.city.textContent = c.city.toUpperCase();
    view.lon = c.lon; view.lat = Math.max(-75, Math.min(75, c.lat));
    stationNote('scanning the ' + c.city + ' airwaves…');
    if (persistIt) { try { tiny.api.call('setRadioLoc', { city: c.city, lat: c.lat, lon: c.lon }); } catch (e) {} }
    let r = null;
    try { r = await tiny.api.call('radioStations', { lat: c.lat, lon: c.lon }); } catch (e) {}
    if (seq !== locSeq) return;                 // the dial moved on while we scanned
    stations = (r && r.stations) || [];
    renderStations();
  }
  function guessCity() {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    const name = (tz.split('/').pop() || '').replace(/_/g, ' ').toLowerCase();
    return CITIES.find((c) => c.city.toLowerCase() === name) || CITIES.find((c) => c.city === 'London');
  }
  function reflect(state) {
    const r = (state && state.radio) || null;
    playingNow = !!(state && state.playing && r);
    const changed = (r && r.url) !== (radioNow && radioNow.url);
    radioNow = r;
    els.led.classList.toggle('on', !!r);
    els.led.classList.toggle('pulse', playingNow);
    els.off.classList.toggle('lit', !!r);
    if (changed) renderStations();
  }
  async function boot() {
    sizeGlobe();
    // the tuner needs a home: last-used spot, else a guess from the timezone
    let saved = null;
    try { saved = await tiny.api.call('getRadioLoc'); } catch (e) {}
    const home = (saved && Number.isFinite(saved.lat))
      ? { city: saved.city, lat: saved.lat, lon: saved.lon } : guessCity();
    if (home) setLoc(home, false);
  }
  return { draw, sizeGlobe, reflect, boot };
};
