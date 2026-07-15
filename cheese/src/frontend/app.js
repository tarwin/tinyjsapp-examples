// Cheese frontend. All the camera and microphone work happens HERE, in the
// page, with the standard web APIs — getUserMedia for the preview, canvas
// for the snap, MediaRecorder for clips. The backend only ever sees
// finished bytes. Gallery tiles/names are rendered with textContent only.

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ filters
// CSS previews the filter live on the <video>; the px() twin bakes the same
// look into the snapped pixels (WebKit has no ctx.filter, so canvas snaps
// are filtered by hand).

function noirPx(d) {
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const v = (l - 128) * 1.15 + 128;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}
function sepiaPx(d) {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i]     = 0.393 * r + 0.769 * g + 0.189 * b;
    d[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
    d[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
  }
}
function popPx(d) {
  const S = 1.6, C = 1.1;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    d[i]     = ((l + (r - l) * S) - 128) * C + 128;
    d[i + 1] = ((l + (g - l) * S) - 128) * C + 128;
    d[i + 2] = ((l + (b - l) * S) - 128) * C + 128;
  }
}

const FILTERS = [
  { id: 'none',  label: 'Normal', css: 'none', px: null },
  { id: 'noir',  label: 'Noir',   css: 'grayscale(1) contrast(1.15)', px: noirPx },
  { id: 'sepia', label: 'Sepia',  css: 'sepia(0.85)', px: sepiaPx },
  { id: 'pop',   label: 'Pop',    css: 'saturate(1.6) contrast(1.1)', px: popPx },
];

// -------------------------------------------------------------------- state

let stream = null;        // camera
let audioStream = null;   // mic, first requested when recording starts
let filter = FILTERS[0];
let timerOn = true;
let rec = null;           // active MediaRecorder
let recTimer = null, recStart = 0;
let audioCtx = null, meterRaf = 0;
let gatePoll = 0;

// --------------------------------------------------------------------- gate
// Permission onboarding. 'undetermined' → friendly enable button (the system
// prompt appears on the first getUserMedia); 'denied' → deep-link into the
// Camera pane of System Settings and live-poll until the user flips it.

function gate(mode) {
  const g = $('gate'), title = $('gatetitle'), text = $('gatetext'), btn = $('gatebtn');
  g.hidden = false;
  if (mode === 'enable') {
    title.textContent = 'Say cheese!';
    text.textContent = 'Cheese needs your camera for the booth. macOS will ask once — the prompt names this app.';
    btn.textContent = 'Enable camera';
    btn.onclick = () => { g.hidden = true; startCamera(); };
  } else {
    title.textContent = 'Camera is switched off';
    text.textContent = 'macOS only asks once. Flip Cheese on under Privacy & Security → Camera and this screen will notice.';
    btn.textContent = 'Open System Settings';
    btn.onclick = () => tiny.api.call('openPrivacy', { pane: 'camera' });
    clearInterval(gatePoll);
    gatePoll = setInterval(async () => {
      const p = await tiny.api.call('perms');
      if (p.camera === 'granted' || p.camera === 'undetermined') {
        clearInterval(gatePoll);
        g.hidden = true;
        startCamera();
      }
    }, 2000);
  }
}

// ------------------------------------------------------------------- camera

async function startCamera(deviceId) {
  try {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 }, height: { ideal: 720 },
      },
    });
  } catch (err) {
    const p = await tiny.api.call('perms');
    return gate(p.camera === 'denied' ? 'denied' : 'enable');
  }
  $('gate').hidden = true;
  $('preview').srcObject = stream;
  fillDevices(deviceId);
}

async function fillDevices(current) {
  const sel = $('devices');
  const cams = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'videoinput');
  sel.hidden = cams.length < 2;
  sel.textContent = '';
  cams.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = c.deviceId;
    o.textContent = c.label || `Camera ${i + 1}`;
    if (c.deviceId === current) o.selected = true;
    sel.appendChild(o);
  });
}

// ------------------------------------------------------------------ uploads
// begin/chunk/end: base64 sliced on 4-char boundaries so every chunk decodes
// on its own. FileReader gives us the blob's base64 without building a
// megabyte binary string by hand.

const CHUNK = 384 * 1024;  // chars per bridge message (multiple of 4)

const blobB64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result.split(',')[1]);
  r.onerror = rej;
  r.readAsDataURL(blob);
});

async function upload(kind, ext, b64, poster) {
  const { id } = await tiny.api.call('begin', { kind, ext });
  for (let i = 0; i < b64.length; i += CHUNK) {
    await tiny.api.call('chunk', { id, b64: b64.slice(i, i + CHUNK) });
  }
  await tiny.api.call('end', { id, poster });
  refresh();
}

// -------------------------------------------------------------------- snaps

function grabFrame(maxW) {
  const v = $('preview');
  if (!v.videoWidth) return null;
  const scale = maxW ? Math.min(1, maxW / v.videoWidth) : 1;
  const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.translate(w, 0); ctx.scale(-1, 1);           // mirrored, like the preview
  ctx.drawImage(v, 0, 0, w, h);
  if (filter.px) {
    const img = ctx.getImageData(0, 0, w, h);
    filter.px(img.data);
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

async function snap() {
  const c = grabFrame(0);
  if (!c) return hint('Camera is still warming up');
  flash();
  click(1200);
  await upload('photo', 'jpg', c.toDataURL('image/jpeg', 0.92).split(',')[1], null);
}

function shutterPressed() {
  if (!timerOn) return snap();
  const cd = $('countdown');
  let n = 3;
  cd.hidden = false;
  const tick = () => {
    if (n === 0) { cd.hidden = true; snap(); return; }
    cd.textContent = n;
    cd.classList.remove('pulse'); void cd.offsetWidth; cd.classList.add('pulse');
    click(n === 1 ? 880 : 520);
    n--;
    setTimeout(tick, 700);
  };
  tick();
}

function flash() {
  const f = $('flash');
  f.hidden = false;
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  setTimeout(() => { f.hidden = true; }, 350);
}

function click(freq) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.13);
  } catch { /* no audio — fine */ }
}

// -------------------------------------------------------------------- clips

async function toggleRecord() {
  if (rec) { rec.stop(); return; }
  if (!stream) return hint('No camera yet');

  // Mic is asked for at the moment it makes sense — the first recording.
  if (!audioStream) {
    try { audioStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { hint('No microphone — recording a silent clip'); }
  }

  // WebKit records video/mp4; Chromium-family records webm. Detect, don't assume.
  const mime = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) return hint('MediaRecorder is not available here');

  const tracks = [...stream.getVideoTracks(), ...(audioStream ? audioStream.getAudioTracks() : [])];
  const poster = grabFrame(320);
  const chunks = [];
  rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    stopRecUi();
    rec = null;
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) return hint('Nothing recorded');
    hint('Saving clip…');
    await upload('clip', mime.includes('mp4') ? 'mp4' : 'webm', await blobB64(blob),
                 poster ? poster.toDataURL('image/jpeg', 0.8).split(',')[1] : null);
    hint('Clip saved');
  };
  rec.start(1000);
  startRecUi();
}

function startRecUi() {
  $('record').textContent = '⏹';
  $('record').classList.add('rec');
  $('recbadge').hidden = false;
  recStart = Date.now();
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $('rectime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 60 && rec) rec.stop();          // keep clips shareable
  }, 250);
  meter();
}

function stopRecUi() {
  $('record').textContent = '⏺';
  $('record').classList.remove('rec');
  $('recbadge').hidden = true;
  clearInterval(recTimer);
  cancelAnimationFrame(meterRaf);
}

// Live input level while recording — proof the mic is actually flowing.
function meter() {
  if (!audioStream) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(audioStream);
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const loop = () => {
      if (!rec) { src.disconnect(); return; }
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
      $('meterfill').style.width = Math.min(100, Math.sqrt(sum / buf.length) * 300) + '%';
      meterRaf = requestAnimationFrame(loop);
    };
    loop();
  } catch { /* meter is decoration */ }
}

// ------------------------------------------------------------------ gallery

async function refresh() {
  const items = await tiny.api.call('list');
  const g = $('gallery');
  g.textContent = '';
  $('empty').hidden = items.length > 0;
  for (const it of items) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.title = it.name + ' — drag me out';

    if (it.thumb) {
      const img = document.createElement('img');
      img.src = it.thumb;
      img.draggable = false;
      tile.appendChild(img);
    } else {
      const glyph = document.createElement('div');
      glyph.className = 'glyph';
      glyph.textContent = it.kind === 'clip' ? '🎬' : '🖼';
      tile.appendChild(glyph);
    }
    if (it.kind === 'clip') {
      const badge = document.createElement('span');
      badge.className = 'clipbadge';
      badge.textContent = '▶';
      tile.appendChild(badge);
    }

    // The tile IS the file — a native drag out of the app.
    tile.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      tiny.win.startDrag({ files: [it.file] });
    });

    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const [label, fn, cls] of [
      ['↗', () => tiny.api.call('reveal', { file: it.file }), ''],
      ['✕', () => tiny.api.call('remove', { file: it.file, name: it.name }).then(refresh), 'danger'],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', fn);
      actions.appendChild(b);
    }
    tile.appendChild(actions);
    g.appendChild(tile);
  }
}

// --------------------------------------------------------------------- misc

let hintTimer = 0;
function hint(msg) {
  const h = $('stagehint');
  h.textContent = msg;
  h.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { h.hidden = true; }, 2500);
}

function buildFilterChips() {
  const wrap = $('filters');
  for (const f of FILTERS) {
    const b = document.createElement('button');
    b.className = 'chip' + (f === filter ? ' on' : '');
    b.textContent = f.label;
    b.onclick = () => {
      filter = f;
      $('preview').style.filter = f.css;
      wrap.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
    };
    wrap.appendChild(b);
  }
}

// --------------------------------------------------------------------- boot

async function boot() {
  buildFilterChips();
  refresh();

  $('shutter').onclick = shutterPressed;
  $('record').onclick = toggleRecord;
  $('folder').onclick = () => tiny.api.call('openFolder');
  $('timer').onclick = () => {
    timerOn = !timerOn;
    $('timer').classList.toggle('off', !timerOn);
  };
  $('devices').onchange = (e) => startCamera(e.target.value);
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT') return;
    if (e.key === ' ') { e.preventDefault(); shutterPressed(); }
    if (e.key === 'r' || e.key === 'R') toggleRecord();
  });

  const perms = await tiny.api.call('perms');
  if (perms.camera === 'denied') gate('denied');
  else if (perms.camera === 'granted') startCamera();
  else gate('enable');
}

boot();
