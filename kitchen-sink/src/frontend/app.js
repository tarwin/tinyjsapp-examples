const $ = (id) => document.getElementById(id);
// Escape anything that goes into innerHTML — a filename like
// "<img src=x onerror=…>" must never become markup in a page that holds
// an RPC channel to the backend.
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtBytes = (n) => {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(1) + ' ' + u[i];
};
const fmtUptime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + ss + 's';
};

/* ══════════════ theme (auto / dark / light) ══════════════
   The mode persists in tiny.store (0.3.1). "auto" follows the OS: the native
   tiny.theme signal drives it when available, with matchMedia as a fallback
   for the brief window before the launcher reports the first value. */

const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
let themeMode = 'system';
let nativeDark = null;                        // from tiny.theme; null until reported

const isDark = () => (nativeDark != null ? nativeDark : sysDark.matches);

function applyTheme() {
  const eff = themeMode === 'system' ? (isDark() ? 'dark' : 'light') : themeMode;
  document.documentElement.dataset.theme = eff;
  for (const b of document.querySelectorAll('#themeSeg button'))
    b.classList.toggle('on', b.dataset.mode === themeMode);
  const nt = $('nativeTheme'), rt = $('resolvedTheme');
  if (nt) nt.textContent = nativeDark == null ? '(awaiting first signal — using matchMedia)' : (nativeDark ? 'dark' : 'light');
  if (rt) rt.textContent = eff + (themeMode === 'system' ? '' : ` (forced ${themeMode})`);
  drawSpark();
}
sysDark.addEventListener('change', applyTheme);
tiny.theme.on((dark) => { nativeDark = dark; applyTheme(); });   // live OS theme changes
$('themeSeg').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  themeMode = b.dataset.mode;
  applyTheme();
  tiny.store.set('theme', themeMode).catch(() => {});
});

const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ══════════════ tabs ══════════════ */

let activeTab = 'overview';
function showTab(name, persist = true) {
  activeTab = name;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const p of document.querySelectorAll('.panel')) p.classList.toggle('active', p.id === 'panel-' + name);
  gpuSetActive(name === 'gpu');
  if (name === 'ffi') ffiEnsure();
  if (name === 'system') systemEnsure();
  if (persist) tiny.store.set('tab', name).catch(() => {});
}
$('rail').addEventListener('click', (ev) => {
  const t = ev.target.closest('.tab');
  if (t) showTab(t.dataset.tab);
});

/* ── in-panel sub-tabs (App panel: split its many cards into screenfuls) ── */
$('appNav').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-sub]');
  if (!b) return;
  for (const x of $('appNav').children) x.classList.toggle('on', x === b);
  for (const p of document.querySelectorAll('#panel-app .subpanel'))
    p.classList.toggle('active', p.id === 'sub-' + b.dataset.sub);
});

/* ══════════════ live instruments (backend push, 1 Hz) ══════════════ */

const cpuHist = [];
tiny.api.on('tick', ({ time, uptime, cpu, load }) => {
  $('clock').textContent = time;
  $('uptime').textContent = fmtUptime(uptime);
  const pct = Math.round(cpu * 100);
  $('cpuBar').style.width = pct + '%';
  $('cpuPct').textContent = pct + '%';
  $('cpuNow').textContent = pct + '%';
  $('load').textContent = load.map((l) => l.toFixed(1)).join(' ');
  $('load1').textContent = load[0].toFixed(2);
  $('load5').textContent = load[1].toFixed(2);
  $('load15').textContent = load[2].toFixed(2);
  cpuHist.push(cpu);
  if (cpuHist.length > 90) cpuHist.shift();
  drawSpark();
});

function drawSpark() {
  const cv = $('spark');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = 72;
  if (!w) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.05)';
  g.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75]) {
    g.beginPath(); g.moveTo(0, h * f); g.lineTo(w, h * f); g.stroke();
  }
  if (cpuHist.length < 2) return;
  const step = w / 89;
  const x0 = w - (cpuHist.length - 1) * step;
  const y = (v) => h - 3 - v * (h - 8);
  const amber = cssVar('--amber') || '#ffb454';
  g.beginPath();
  cpuHist.forEach((v, i) => { const x = x0 + i * step; i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v)); });
  g.strokeStyle = amber;
  g.lineWidth = 1.5;
  g.stroke();
  g.lineTo(x0 + (cpuHist.length - 1) * step, h);
  g.lineTo(x0, h);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, amber);
  grad.addColorStop(1, amber);
  g.globalAlpha = 0.18;
  g.fillStyle = grad;
  g.fill();
  g.globalAlpha = 1;
}

/* ══════════════ overview: dialogs & window ══════════════ */

let renames = 0;
const say = (t) => { $('dialogOut').textContent = t; };
$('retitle').addEventListener('click', () => tiny.win.setTitle('renamed ' + ++renames + '×'));
$('grow').addEventListener('click', () => tiny.win.setSize(1280, 800));
$('shrink').addEventListener('click', () => tiny.win.setSize(1100, 720));
$('alertBtn').addEventListener('click', () => tiny.win.alert('Heads up', 'This is tiny.win.alert() — a native NSAlert.'));
$('confirmBtn').addEventListener('click', async () =>
  say('confirm → ' + await tiny.win.confirm('Proceed with the thing?', { detail: 'This is tiny.win.confirm().' })));
$('promptBtn').addEventListener('click', async () => {
  const name = await tiny.win.prompt('What is your name?', { default: 'world' });
  say(name == null ? 'prompt → (cancelled)' : 'prompt → hello, ' + name + '!');
});
$('pickBtn').addEventListener('click', async () => {
  const dir = await tiny.win.pickFolder();
  if (dir) { say('picked folder → ' + dir + '\nopening it in Files ⌘2'); showTab('files'); listDir(dir); }
  else say('pickFolder → (cancelled)');
});
$('quit').addEventListener('click', async () => {
  if (await tiny.win.confirm('Quit Tiny Deck?', { detail: 'Running commands will be terminated.' })) tiny.quit();
});

/* ══════════════ files ══════════════ */

let curPath = '/';
let curFile = null;

async function listDir(path) {
  $('dirErr').textContent = '';
  try {
    const { entries } = await tiny.api.call('listDir', { path });
    curPath = path;
    $('path').value = path;
    const base = path.replace(/\/$/, '');
    const up = base.replace(/\/[^/]+$/, '') || '/';
    $('dir').innerHTML =
      `<li class="dir" data-p="${esc(up)}" data-d="1">▴ ..</li>` +
      entries.map((e) =>
        `<li class="${e.isDir ? 'dir' : ''}" data-p="${esc(base + '/' + e.name)}" data-d="${e.isDir ? 1 : 0}">` +
        `${e.isDir ? '▸ ' : '&nbsp; '}${esc(e.name)}</li>`).join('');
  } catch (e) {
    $('dirErr').textContent = String(e);
  }
}

async function openFile(path, li) {
  $('dirErr').textContent = '';
  try {
    const f = await tiny.api.call('readFile', { path });
    curFile = f.binary ? null : path;
    for (const el of document.querySelectorAll('#dir li.sel')) el.classList.remove('sel');
    li?.classList.add('sel');
    $('fileName').textContent = path.split('/').pop();
    $('fileMeta').textContent = fmtBytes(f.size) + (f.truncated ? ' · showing first 128 KB' : '') + (f.binary ? ' · binary' : '');
    $('editor').value = f.binary ? '(binary file — not shown)' : f.text;
    $('editor').disabled = f.binary;
    $('saveBtn').disabled = !!f.binary || f.truncated;
    $('saveAsBtn').disabled = !!f.binary;
  } catch (e) {
    $('dirErr').textContent = String(e);
  }
}

$('dir').addEventListener('click', (ev) => {
  const li = ev.target.closest('li');
  if (!li) return;
  li.dataset.d === '1' ? listDir(li.dataset.p) : openFile(li.dataset.p, li);
});
$('path').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') listDir($('path').value); });
$('goBtn').addEventListener('click', () => listDir($('path').value));
$('openBtn').addEventListener('click', async () => {
  const p = await tiny.win.openFile();
  if (!p) return;
  showTab('files');
  await listDir(p.replace(/\/[^/]+$/, '') || '/');
  openFile(p, [...document.querySelectorAll('#dir li')].find((li) => li.dataset.p === p));
});

async function saveTo(path) {
  const { size } = await tiny.api.call('writeFile', { path, text: $('editor').value });
  $('fileMeta').textContent = fmtBytes(size) + ' · saved ✓';
  setTimeout(() => { $('fileMeta').textContent = fmtBytes(size); }, 1500);
}
$('saveBtn').addEventListener('click', () => curFile && saveTo(curFile).catch((e) => { $('dirErr').textContent = String(e); }));
$('saveAsBtn').addEventListener('click', async () => {
  const p = await tiny.win.saveFile();
  if (p) saveTo(p).then(() => listDir(curPath)).catch((e) => { $('dirErr').textContent = String(e); });
});

// live folder watching — backend tjs.watch pushes events to the page
let watching = null;
async function toggleWatch() {
  watching = watching ? null : curPath;
  await tiny.api.call('watchDir', { path: watching });
  $('watchBtn').classList.toggle('on', !!watching);
  $('watchBtn').textContent = watching ? '◉ Watching ' + watching.split('/').pop() : '◉ Watch this folder';
  if (watching) $('fsFeed').innerHTML = `<div>watching <b>${esc(watching)}</b> — touch, create or delete a file there…</div>`;
  syncMenuChecks();
}
$('watchBtn').addEventListener('click', () => toggleWatch().catch((e) => { $('dirErr').textContent = String(e); }));
tiny.api.on('fs:event', ({ file, event, time }) => {
  const d = document.createElement('div');
  d.innerHTML = `${esc(time)} · <b>${esc(event)}</b> ${esc(file)}`;
  $('fsFeed').prepend(d);
  while ($('fsFeed').children.length > 60) $('fsFeed').lastChild.remove();
  if (watching === curPath) listDir(curPath);
});

/* ══════════════ run ══════════════ */

let runId = 0, runningId = null;

function appendOut(text, cls) {
  const con = $('console');
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  con.appendChild(s);
  while (con.childNodes.length > 3000) con.firstChild.remove();
  con.scrollTop = con.scrollHeight;
}

function runCmd() {
  const cmd = $('cmd').value.trim();
  if (!cmd || runningId != null) return;
  const id = ++runId;
  runningId = id;
  $('console').textContent = '';
  $('runStatus').innerHTML = `running <b>${esc(cmd)}</b> …`;
  $('runBtn').disabled = true;
  $('killBtn').disabled = false;
  tiny.api.call('run', { id, cmd }).catch((e) => {
    appendOut(String(e) + '\n', 'se');
    finishRun(id);
  });
}
function finishRun(id) {
  if (runningId !== id) return;
  runningId = null;
  $('runBtn').disabled = false;
  $('killBtn').disabled = true;
}
tiny.api.on('run:out', ({ id, stream, chunk }) => {
  if (id === runningId) appendOut(chunk, stream === 'stderr' ? 'se' : 'so');
});
tiny.api.on('run:exit', ({ id, code, signal, ms }) => {
  if (id !== runningId) return;
  $('runStatus').innerHTML = signal
    ? `<span class="bad">killed by signal ${esc(signal)}</span> · ${ms} ms`
    : `exit <span class="${code === 0 ? 'ok' : 'bad'}">${code}</span> · ${ms} ms`;
  // long-running command? tell the user even if they wandered off (0.3.0 notify)
  if (ms > 3000 && !signal) tiny.notify('Tiny Deck', `Command finished — exit ${code} after ${(ms / 1000).toFixed(1)}s`);
  finishRun(id);
});
$('runBtn').addEventListener('click', runCmd);
$('cmd').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') runCmd(); });
$('killBtn').addEventListener('click', () => { if (runningId != null) tiny.api.call('kill', { id: runningId }); });
$('chips').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-cmd]');
  if (b) { $('cmd').value = b.dataset.cmd; runCmd(); }
});

/* ══════════════ http ══════════════ */

async function sendHttp() {
  const url = $('url').value.trim();
  if (!url) return;
  $('httpStatus').textContent = 'fetching…';
  $('httpHeaders').textContent = '';
  $('httpBody').textContent = '';
  try {
    const t = await tiny.api.call('httpFetch', { url, method: $('method').value });
    const ok = t.status >= 200 && t.status < 400;
    $('httpStatus').innerHTML =
      `<span class="${ok ? 'ok' : 'bad'}">${t.status} ${esc(t.statusText)}</span>` +
      ` · ${t.ms} ms · ${fmtBytes(t.body.length)}${t.truncated ? ' (truncated)' : ''}`;
    $('httpHeaders').textContent = Object.entries(t.headers).map(([k, v]) => k + ': ' + v).join('\n');
    let body = t.body;
    try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* not json */ }
    $('httpBody').textContent = body || '(empty body)';
  } catch (e) {
    $('httpStatus').innerHTML = `<span class="bad">failed</span> · ${esc(e)}`;
  }
}
$('sendBtn').addEventListener('click', sendHttp);
$('url').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') sendHttp(); });
document.querySelector('#panel-http .chips').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-url]');
  if (b) { $('url').value = b.dataset.url; sendHttp(); }
});

/* ══════════════ notes (sqlite) ══════════════ */

function renderNotes(rows) {
  $('notes').innerHTML = rows.map((n) =>
    `<li><span class="text">${esc(n.text)}</span>` +
    `<time>${esc(new Date(n.created_at).toLocaleString())}</time>` +
    `<button class="del" data-id="${n.id}" title="delete">✕</button></li>`).join('') ||
    '<li><span class="text muted">no notes yet — they persist in sqlite across relaunches</span></li>';
}
async function addNote() {
  const text = $('noteInput').value.trim();
  if (!text) return;
  $('noteInput').value = '';
  renderNotes(await tiny.api.call('notesAdd', { text }));
}
$('addNote').addEventListener('click', addNote);
$('noteInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') addNote(); });
$('notes').addEventListener('click', async (ev) => {
  const b = ev.target.closest('.del');
  if (b) renderNotes(await tiny.api.call('notesDelete', { id: Number(b.dataset.id) }));
});

/* ══════════════ gpu lab ══════════════
   Fragment-shader demos on WebGL2, recorded straight to a video file:
   canvas.captureStream → MediaRecorder (mp4) → base64 chunks over the
   bridge → backend writes wherever the native save dialog pointed.
   WebGPU is probed at runtime — this WKWebView doesn't expose it yet, so
   the status line reports honestly and lights up when WebKit ships it. */

let gpu = null;          // engine-specific state; { engine, cv, cur, raf, ... }
let gpuActive = false;
let recording = false;
let gpuBusy = false;

// A canvas is married to its first context type, so switching engines
// means replacing the element.
function freshCanvas() {
  const old = $('gpuCanvas');
  const cv = document.createElement('canvas');
  cv.id = 'gpuCanvas';
  old.replaceWith(cv);
  return cv;
}

function initWebGl2(cv) {
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: true });
  if (!gl) throw new Error('WebGL2 unavailable in this webview');
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const vert = compile(gl.VERTEX_SHADER, DECK_SHADERS.VERT);
  const progs = {};
  for (const name of ['plasma', 'torus', 'tunnel']) {
    const p = gl.createProgram();
    gl.attachShader(p, vert);
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, DECK_SHADERS[name]));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
    progs[name] = { p, u_time: gl.getUniformLocation(p, 'u_time'), u_res: gl.getUniformLocation(p, 'u_res') };
  }
  return { engine: 'webgl2', cv, gl, progs };
}

// WebGPU works since tinyjs 0.3.0: the page is a file:// secure context and
// the launcher flips WebKit's feature flag. Same three demos, in WGSL.
async function initWebGpu(cv) {
  if (!navigator.gpu) throw new Error('navigator.gpu not exposed');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  const ctx = cv.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  const ubuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const pipes = {}, groups = {};
  for (const name of ['plasma', 'torus', 'tunnel']) {
    const module = device.createShaderModule({ code: DECK_SHADERS.wgsl[name] });
    const p = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    pipes[name] = p;
    groups[name] = device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ubuf } }],
    });
  }
  return { engine: 'webgpu', cv, device, ctx, format, ubuf, pipes, groups };
}

function gpuFrame() {
  const { cv } = gpu;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(cv.clientWidth * dpr), h = Math.floor(cv.clientHeight * dpr);
  const t = (performance.now() - gpu.t0) / 1000;
  if (w && (cv.width !== w || cv.height !== h)) {
    cv.width = w; cv.height = h;
    if (gpu.engine === 'webgpu') gpu.ctx.configure({ device: gpu.device, format: gpu.format, alphaMode: 'opaque' });
    else gpu.gl.viewport(0, 0, w, h);
  }
  if (gpu.engine === 'webgpu') {
    gpu.device.queue.writeBuffer(gpu.ubuf, 0, new Float32Array([t, 0, cv.width, cv.height]));
    const enc = gpu.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{
      view: gpu.ctx.getCurrentTexture().createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }] });
    pass.setPipeline(gpu.pipes[gpu.cur]);
    pass.setBindGroup(0, gpu.groups[gpu.cur]);
    pass.draw(3);
    pass.end();
    gpu.device.queue.submit([enc.finish()]);
  } else {
    const pr = gpu.progs[gpu.cur];
    gpu.gl.useProgram(pr.p);
    gpu.gl.uniform1f(pr.u_time, t);
    gpu.gl.uniform2f(pr.u_res, cv.width, cv.height);
    gpu.gl.drawArrays(gpu.gl.TRIANGLES, 0, 3);
  }
  gpu.frames++;
  const now = performance.now();
  if (now - gpu.fpsAt >= 1000) {
    gpu.fps = Math.round(gpu.frames * 1000 / (now - gpu.fpsAt));
    gpu.frames = 0; gpu.fpsAt = now;
    if (!recording) $('gpuStatus').innerHTML =
      `render: <b>${gpu.engine === 'webgpu' ? 'WebGPU (WGSL)' : 'WebGL2 (GLSL)'}</b>` +
      ` · shader: <b>${esc(gpu.cur)}</b> · ${cv.width}×${cv.height} · <b>${gpu.fps}</b> fps`;
  }
  if (gpuActive || recording) gpu.raf = requestAnimationFrame(gpuFrame);
}

function updateEngineChips() {
  for (const b of document.querySelectorAll('#engineChips button')) {
    if (b.dataset.engine === 'webgpu' && !navigator.gpu) { b.disabled = true; b.title = 'not exposed by this webview'; }
    b.classList.toggle('on', gpu && b.dataset.engine === gpu.engine);
  }
}

async function gpuStart(engine) {
  if (gpuBusy || recording) return;
  gpuBusy = true;
  try {
    if (gpu) cancelAnimationFrame(gpu.raf);
    const cur = gpu ? gpu.cur : 'plasma';
    const next = engine === 'webgpu' ? await initWebGpu(freshCanvas()) : initWebGl2(freshCanvas());
    gpu = Object.assign(next, { cur, raf: 0, t0: performance.now(), frames: 0, fpsAt: performance.now(), fps: 0 });
    updateEngineChips();
    if (gpuActive) gpu.raf = requestAnimationFrame(gpuFrame);
  } catch (e) {
    $('gpuStatus').textContent = engine + ' init failed: ' + (e.message || e);
    if (engine === 'webgpu') { gpuBusy = false; return gpuStart('webgl2'); }   // graceful fallback
  } finally {
    gpuBusy = false;
  }
}

function gpuSetActive(on) {
  gpuActive = on;
  if (!on) return;                       // raf loop stops itself; recording keeps it alive
  probeWebGpu();
  if (!gpu) gpuStart(navigator.gpu ? 'webgpu' : 'webgl2');
  else { cancelAnimationFrame(gpu.raf); gpu.raf = requestAnimationFrame(gpuFrame); }
}

$('engineChips').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-engine]');
  if (b && !b.disabled && (!gpu || gpu.engine !== b.dataset.engine)) gpuStart(b.dataset.engine);
});

$('shaderChips').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-shader]');
  if (!b || !gpu) return;
  gpu.cur = b.dataset.shader;
  for (const c of document.querySelectorAll('#shaderChips button')) c.classList.toggle('on', c === b);
});

// -- record the canvas and save a real video file via the backend --

const b64encode = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};

async function recordVideo() {
  if (recording || !gpu) return;
  const secs = Number($('recSecs').value);
  const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
  const ext = mime === 'video/mp4' ? '.mp4' : '.webm';
  recording = true;
  $('recBtn').classList.add('rec');
  $('recBtn').textContent = '● recording…';
  try {
    const stream = gpu.cv.captureStream(60);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start(500);
    for (let s = secs; s > 0; s--) {
      $('gpuStatus').innerHTML = `<b>● recording ${esc(gpu.cur)}</b> — ${s}s left · ${mime}`;
      await new Promise((r) => setTimeout(r, 1000));
    }
    rec.stop();
    await stopped;
    for (const t of stream.getTracks()) t.stop();

    const bytes = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer());
    $('gpuStatus').innerHTML = `captured <b>${fmtBytes(bytes.length)}</b> — pick where to save it…`;
    let path = await tiny.win.saveFile();
    if (!path) { $('gpuStatus').textContent = 'recording discarded (save cancelled)'; return; }
    if (!/\.(mp4|webm|mov)$/i.test(path)) path += ext;

    await tiny.api.call('videoBegin');
    const STEP = 768 * 1024;
    for (let i = 0; i < bytes.length; i += STEP) {
      await tiny.api.call('videoAppend', { b64: b64encode(bytes.subarray(i, i + STEP)) });
      $('gpuStatus').innerHTML = `writing… ${Math.round(Math.min(i + STEP, bytes.length) * 100 / bytes.length)}%`;
    }
    const { size } = await tiny.api.call('videoEnd', { path });
    $('gpuStatus').innerHTML = `saved <b>${esc(path)}</b> · ${fmtBytes(size)} · ${secs}s of ${esc(gpu.cur)} ✓`;
    tiny.notify('Tiny Deck', 'Video saved — ' + path.split('/').pop() + ' (' + fmtBytes(size) + ')');
  } catch (e) {
    $('gpuStatus').innerHTML = `record failed: ${esc(e.message || e)}`;
  } finally {
    recording = false;
    $('recBtn').classList.remove('rec');
    $('recBtn').textContent = '◉ Record → video file';
    if (gpuActive) { cancelAnimationFrame(gpu.raf); gpu.raf = requestAnimationFrame(gpuFrame); }
  }
}
$('recBtn').addEventListener('click', recordVideo);

// -- WebGPU: detect, and prove it with a compute dispatch when present --

let webGpuProbed = false;
async function probeWebGpu() {
  if (webGpuProbed) return;
  webGpuProbed = true;
  const el = $('webgpuStatus');
  if (!navigator.gpu) {
    el.innerHTML = 'webgpu: <span class="bad">not exposed by this WKWebView</span> — demos render on WebGL2; this line lights up the day WebKit ships it';
    return;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { el.textContent = 'webgpu: navigator.gpu present but no adapter'; return; }
    const device = await adapter.requestDevice();
    const mod = device.createShaderModule({ code:
      '@group(0) @binding(0) var<storage, read_write> out: array<u32>;\n' +
      '@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3<u32>) { out[id.x] = id.x * 2u; }' });
    const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
    const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const read = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const enc2 = device.createCommandEncoder();
    const pass = enc2.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(4); pass.end();
    enc2.copyBufferToBuffer(buf, 0, read, 0, 16);
    device.queue.submit([enc2.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const result = [...new Uint32Array(read.getMappedRange())].join(',');
    const info = adapter.info || {};
    el.innerHTML = `webgpu: <span class="ok">live</span> — ${esc([info.vendor, info.device, info.description].filter(Boolean).join(' / ') || 'adapter')} · compute says [${esc(result)}] ✓`;
  } catch (e) {
    el.innerHTML = `webgpu: <span class="bad">error</span> — ${esc(e.message || e)}`;
  }
}

/* ══════════════ wasm lab ══════════════
   A WebAssembly module assembled by hand — every byte below is part of the
   spec'd binary format — instantiated in the webview's JavaScriptCore. */

const WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d,                                     // magic "\0asm"
  0x01, 0x00, 0x00, 0x00,                                     // version 1
  0x01, 0x0c, 0x02,                                           // type section
  0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,                         //   (i32,i32)->i32
  0x60, 0x01, 0x7f, 0x01, 0x7f,                               //   (i32)->i32
  0x03, 0x03, 0x02, 0x00, 0x01,                               // function section
  0x07, 0x0d, 0x02,                                           // export section
  0x03, 0x61, 0x64, 0x64, 0x00, 0x00,                         //   "add" -> fn 0
  0x03, 0x66, 0x69, 0x62, 0x00, 0x01,                         //   "fib" -> fn 1
  0x0a, 0x26, 0x02,                                           // code section
  0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,             //   add: a+b
  0x1c, 0x00, 0x20, 0x00, 0x41, 0x02, 0x48, 0x04, 0x7f,       //   fib: n<2 ? n
  0x20, 0x00, 0x05, 0x20, 0x00, 0x41, 0x01, 0x6b, 0x10, 0x01, //     : fib(n-1)
  0x20, 0x00, 0x41, 0x02, 0x6b, 0x10, 0x01, 0x6a, 0x0b, 0x0b, //     + fib(n-2)
]);

let wasmExports = null;

async function wasmInit() {
  const hex = [...WASM_BYTES].map((b, i) => {
    const s = b.toString(16).padStart(2, '0');
    return i < 8 ? `<b>${s}</b>` : s;                          // highlight header
  });
  const lines = [];
  for (let i = 0; i < hex.length; i += 16) lines.push(hex.slice(i, i + 16).join(' '));
  $('wasmHex').innerHTML = lines.join('\n') + `\n<span class="muted">— ${WASM_BYTES.length} bytes total</span>`;
  const { instance } = await WebAssembly.instantiate(WASM_BYTES);
  wasmExports = instance.exports;
}

$('addBtn').addEventListener('click', () => {
  if (!wasmExports) return;
  $('addOut').textContent = '= ' + wasmExports.add($('addA').value | 0, $('addB').value | 0);
});

const jsFib = (n) => n < 2 ? n : jsFib(n - 1) + jsFib(n - 2);
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
const timeIt = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };

$('benchBtn').addEventListener('click', async () => {
  if (!wasmExports) return;
  const n = Math.max(1, Math.min(38, $('fibN').value | 0));
  $('fibN').value = n;
  $('benchOut').textContent = 'running…';
  $('benchBtn').disabled = true;
  await new Promise((r) => setTimeout(r, 30));                 // let UI paint
  try {
    const js = [], wa = [];
    let result = 0;
    for (let i = 0; i < 7; i++) {
      js.push(timeIt(() => jsFib(n)));
      wa.push(timeIt(() => { result = wasmExports.fib(n); }));
    }
    const mJs = median(js), mWa = median(wa);
    const top = Math.max(mJs, mWa, 0.01);
    $('barJs').style.width = (mJs / top * 100) + '%';
    $('barWasm').style.width = (mWa / top * 100) + '%';
    $('msJs').textContent = mJs.toFixed(2) + ' ms';
    $('msWasm').textContent = mWa.toFixed(2) + ' ms';
    const ratio = mJs / mWa;
    $('benchOut').innerHTML = `fib(${n}) = <b>${result}</b> · wasm is <b>${ratio.toFixed(2)}×</b> ${ratio >= 1 ? 'faster' : 'slower'} · median of 7 runs`;
  } finally {
    $('benchBtn').disabled = false;
  }
});

/* ══════════════ app tab (tinyjs 0.3.0: window ops, tray, notify, update) ══ */

const appSay = (t) => { $('appOut').textContent = t; };
let trayOn = false, dockOn = true, onTop = false, resizableOn = true, hideOnCloseOn = false;

const toggleLabel = (el, on, label) => { el.textContent = (on ? '☑ ' : '☐ ') + label; el.classList.toggle('on', on); };

// 0.5.0 stateful menus: the Actions ▸ Toggles submenu carries live checkmarks.
// Every toggle in the app calls this to push its state into the menu bar with
// tiny.menu.update — so the ✓ next to "Tray Mode" etc. always tells the truth.
let menusReady = false;
function syncMenuChecks() {
  if (!menusReady) return;
  tiny.menu.update('m-watch', { checked: !!watching });
  tiny.menu.update('m-tray', { checked: trayOn });
  tiny.menu.update('m-ontop', { checked: onTop });
  tiny.menu.update('m-hideclose', { checked: hideOnCloseOn });
  tiny.menu.update('m-hotkey', { checked: hotkeyOn });
}

$('centerBtn').addEventListener('click', () => { tiny.win.center(); appSay('tiny.win.center()'); });
$('minBtn').addEventListener('click', () => { tiny.win.minimize(); appSay('tiny.win.minimize() — check the Dock'); });
$('fsBtn').addEventListener('click', () => { tiny.win.fullscreen(); appSay('tiny.win.fullscreen() — call again (or this button) to toggle back'); });
$('peekBtn').addEventListener('click', async () => {
  appSay('tiny.win.hide() … back in 1.5s');
  tiny.win.hide();
  await new Promise((r) => setTimeout(r, 1500));
  tiny.win.show();
  appSay('…and tiny.win.show(). Peek-a-boo.');
});

function moveCorner(cx, cy) {
  const m = 30;
  const x = cx ? Math.max(m, (screen.availWidth || 1440) - window.innerWidth - m) : m;
  const y = cy ? Math.max(m, (screen.availHeight || 900) - window.innerHeight - m * 2) : m;
  tiny.win.setPosition(x, y);
  appSay(`tiny.win.setPosition(${x}, ${y})`);
}
$('posNW').addEventListener('click', () => moveCorner(0, 0));
$('posNE').addEventListener('click', () => moveCorner(1, 0));
$('posSW').addEventListener('click', () => moveCorner(0, 1));
$('posSE').addEventListener('click', () => moveCorner(1, 1));

$('ontopBtn').addEventListener('click', () => {
  onTop = !onTop;
  tiny.win.setAlwaysOnTop(onTop);
  toggleLabel($('ontopBtn'), onTop, 'Always on top');
  syncMenuChecks();
  appSay(`tiny.win.setAlwaysOnTop(${onTop})` + (onTop ? ' — try clicking another app' : ''));
});
$('resizableBtn').addEventListener('click', () => {
  resizableOn = !resizableOn;
  tiny.win.setResizable(resizableOn);
  toggleLabel($('resizableBtn'), resizableOn, 'Resizable');
  appSay(`tiny.win.setResizable(${resizableOn})` + (resizableOn ? '' : ' — grab an edge and feel the refusal'));
});
$('hideCloseBtn').addEventListener('click', () => setHideOnClose(!hideOnCloseOn));

function setHideOnClose(on) {
  hideOnCloseOn = on;
  tiny.win.setHideOnClose(on);
  toggleLabel($('hideCloseBtn'), on, 'Hide on close');
  syncMenuChecks();
  if (on && !trayOn) setTray(true);      // never strand the user with no way back
  appSay(`tiny.win.setHideOnClose(${on})` + (on ? ' — the close button now hides; the tray brings it back' : ''));
}

async function setTray(on) {
  trayOn = on;
  if (on) {
    await tiny.tray.set({
      // 0.9.0: an SF Symbol icon (no shipped png), and primaryAction so a
      // left-click toggles the window while the menu moves to right-click.
      icon: 'sf:square.stack.3d.up.fill',
      title: 'Deck',
      tooltip: 'Tiny Deck — tinyjs mission control (left-click toggles, right-click for menu)',
      primaryAction: true,
      menu: [
        { id: 'show', label: 'Show Window' },
        { id: 'hide', label: 'Hide Window' },
        { id: 'ping', label: 'Ping Me (notification)' },
        { separator: true },
        { id: 'trayoff', label: 'Remove Tray Icon' },
        { id: 'quit', label: 'Quit Tiny Deck' },
      ],
    });
  } else {
    await tiny.tray.remove();
    if (hideOnCloseOn) setHideOnClose(false);   // tray gone → close must quit again
    if (!dockOn) setDock(true);                 // …and the Dock icon must return
  }
  toggleLabel($('trayBtn'), on, 'Tray mode');
  syncMenuChecks();
  appSay(on ? 'tiny.tray.set({ icon: "sf:…", primaryAction: true, … }) — look up: the deck icon is in the menu bar (left-click toggles the window, right-click opens the menu)' : 'tiny.tray.remove()');
}
$('trayBtn').addEventListener('click', () => setTray(!trayOn));

// 0.9.0 primaryAction: a left-click on the tray icon fires this instead of
// opening the menu — the classic "click to summon / dismiss" toggle.
tiny.tray.onClick(async () => {
  const st = await tiny.win.getState();
  if (st.visible && st.focused) tiny.win.hide(); else tiny.win.show();
});

function setDock(visible) {
  dockOn = visible;
  tiny.app.setDockVisible(visible);
  toggleLabel($('dockBtn'), visible, 'Dock icon');
  if (!visible && !trayOn) setTray(true);       // menu-bar-only app still needs the tray
  appSay(`tiny.app.setDockVisible(${visible})` + (visible ? '' : ' — menu-bar-only app now'));
}
$('dockBtn').addEventListener('click', () => setDock(!dockOn));

tiny.tray.on((id) => {
  if (id === 'show') tiny.win.show();
  if (id === 'hide') tiny.win.hide();
  if (id === 'ping') tiny.notify('Tiny Deck', 'Hello from the menu bar!');
  if (id === 'trayoff') setTray(false);
  if (id === 'quit') tiny.quit();
});

// 0.6.0 rich notifications: notify() takes { id, subtitle, sound }. A signed
// packaged .app shows a real Notification Center banner and routes clicks to
// tiny.app.onNotificationClick(id); dev builds fall back to osascript.
let notifySound = true, notifyN = 0;
$('soundBtn').addEventListener('click', () => {
  notifySound = !notifySound;
  toggleLabel($('soundBtn'), notifySound, 'Sound');
});
$('notifyBtn').addEventListener('click', async () => {
  const id = 'note-' + (++notifyN);
  const ok = await tiny.notify('Tiny Deck', $('notifyText').value || 'Hello!', {
    id,
    subtitle: $('notifySub').value || undefined,
    sound: notifySound,
  });
  $('notifyOut').innerHTML = ok
    ? `sent <b>{ id: ${esc(id)}, subtitle, sound: ${notifySound} }</b> — in a packaged .app, click the banner to fire onNotificationClick`
    : '<span class="bad">notify failed</span>';
});
tiny.app.onNotificationClick((id) => {
  tiny.win.show();
  tiny.win.center();
  showTab('app');
  $('notifyOut').innerHTML = `banner <b>${esc(id)}</b> clicked → tiny.app.onNotificationClick brought the window forward`;
});

$('updateBtn').addEventListener('click', async () => {
  $('updateOut').textContent = 'checking…';
  try {
    const { available, current, latest } = await tiny.api.call('update.check');
    $('updateOut').innerHTML = available
      ? `update available: <b>${esc(latest)}</b> (running ${esc(current)}) — update.install() would fetch, verify and relaunch`
      : `up to date — running <b>${esc(current)}</b>, latest is ${esc(latest)}`;
  } catch (e) {
    $('updateOut').innerHTML = `<span class="muted">${esc(e)}</span> — expected here: add "update": { "url": … } to tinyjs.json and ship with \`tinyjs publish\``;
  }
});

/* ── drag & drop: files from Finder arrive with real paths (0.3.0) ── */

tiny.win.onDrop(async (paths) => {
  showTab('files');
  for (const p of paths.slice().reverse()) {
    const d = document.createElement('div');
    d.innerHTML = `dropped · <b>${esc(p)}</b>`;
    $('fsFeed').prepend(d);
  }
  const first = paths[0];
  if (!first) return;
  try {
    await tiny.api.call('listDir', { path: first });      // directory? browse it
    listDir(first);
  } catch {
    const parent = first.replace(/\/[^/]+$/, '') || '/';  // file? open it in the editor
    await listDir(parent);
    openFile(first, [...document.querySelectorAll('#dir li')].find((li) => li.dataset.p === first));
  }
});

/* ── window state · restore · setFullscreen · menu.get (0.5.0) ── */

async function showWinState(note) {
  const s = await tiny.win.getState();
  $('stateOut').textContent = (note ? note + '\n\n' : '') + JSON.stringify(s, null, 2);
}
$('stateBtn').addEventListener('click', () => showWinState().catch((e) => { $('stateOut').textContent = String(e); }));
$('restoreBtn').addEventListener('click', async () => {
  tiny.win.restore();                                   // un-minimize / leave fullscreen
  await new Promise((r) => setTimeout(r, 150));
  showWinState('tiny.win.restore()').catch(() => {});
});
// setFullscreen takes an absolute value (unlike fullscreen(), which toggles).
// The transition animates, so read the state back after it settles.
$('fsOnBtn').addEventListener('click', async () => {
  tiny.win.setFullscreen(true);
  await new Promise((r) => setTimeout(r, 650));
  showWinState('tiny.win.setFullscreen(true)').catch(() => {});
});
$('fsOffBtn').addEventListener('click', async () => {
  tiny.win.setFullscreen(false);
  await new Promise((r) => setTimeout(r, 650));
  showWinState('tiny.win.setFullscreen(false)').catch(() => {});
});
$('menuGetBtn').addEventListener('click', async () => {
  const item = await tiny.menu.get('m-ontop');          // { exists, label, checked, enabled }
  $('menuGetOut').innerHTML = `tiny.menu.get('m-ontop') → <b>${esc(JSON.stringify(item))}</b>` +
    ` <span class="muted">— toggle “Always on top” and read it again</span>`;
});

/* ── deep links & file associations (0.4.0) — packaged .app only ── */

function deepLog(kind, val) {
  const d = document.createElement('div');
  d.innerHTML = `${esc(new Date().toLocaleTimeString())} · <b>${esc(kind)}</b> ${esc(val)}`;
  $('deepFeed').prepend(d);
  while ($('deepFeed').children.length > 40) $('deepFeed').lastChild.remove();
  showTab('app');
}
tiny.app.onOpenUrl((url) => {
  deepLog('url', url);
  tiny.notify('Tiny Deck', 'Opened link — ' + url);
});
tiny.app.onOpenFiles((paths) => {
  for (const p of paths) deepLog('file', p);
  tiny.notify('Tiny Deck', paths.length + ' file(s) opened via association');
});

/* ── window chrome · frameless / transparent / vibrancy (0.7.0) ── */
// State is kept locally and sent whole each time, so the shape is deterministic
// regardless of merge/replace semantics. The deck's <header data-tiny-drag>
// becomes the titlebar when frameless (drag to move, double-click to zoom).

const chrome = { frame: true, trafficLights: true, transparent: false, vibrancy: 'none' };
const chromeErr = (e) => { $('chromeOut').innerHTML = `<span class="bad">${esc(e)}</span>`; };
async function applyChrome(note) {
  await tiny.win.setChrome(chrome);
  toggleLabel($('frameBtn'), chrome.frame, 'Title bar');
  toggleLabel($('lightsBtn'), chrome.trafficLights, 'Traffic lights');
  toggleLabel($('transpBtn'), chrome.transparent, 'Transparent');
  $('vibrancy').value = chrome.vibrancy;
  $('chromeOut').innerHTML = (note ? esc(note) + ' — ' : '') +
    `setChrome({ frame:${chrome.frame}, trafficLights:${chrome.trafficLights}, ` +
    `transparent:${chrome.transparent}, vibrancy:'${esc(chrome.vibrancy)}' })` +
    (chrome.frame ? '' : ' — drag the top header to move the window');
}
$('frameBtn').addEventListener('click', () => { chrome.frame = !chrome.frame; applyChrome().catch(chromeErr); });
$('lightsBtn').addEventListener('click', () => { chrome.trafficLights = !chrome.trafficLights; applyChrome().catch(chromeErr); });
$('transpBtn').addEventListener('click', () => { chrome.transparent = !chrome.transparent; applyChrome().catch(chromeErr); });
$('vibrancy').addEventListener('change', () => { chrome.vibrancy = $('vibrancy').value; applyChrome().catch(chromeErr); });
$('zoomBtn').addEventListener('click', () => {
  tiny.win.zoom();
  $('chromeOut').textContent = 'tiny.win.zoom() — toggles the macOS green-button zoom state';
});
$('chromeReset').addEventListener('click', () => {
  chrome.frame = true; chrome.trafficLights = true; chrome.transparent = false; chrome.vibrancy = 'none';
  applyChrome('reset').catch(chromeErr);
});

/* ── multiple windows (0.8.0) ── */
// inspector.html becomes its own native window with the full tiny.* bridge.
// Opening an id that's already open just focuses it (single instance per id).

function windowLog(kind, val) {
  const d = document.createElement('div');
  d.innerHTML = `${esc(new Date().toLocaleTimeString())} · <b>${esc(kind)}</b> ${esc(val)}`;
  $('windowFeed').prepend(d);
  while ($('windowFeed').children.length > 40) $('windowFeed').lastChild.remove();
}
async function refreshWindows() {
  try {
    const ids = await tiny.win.windows();
    $('windowsOut').innerHTML = `tiny.win.windows() → ${ids.map((w) => `<b>${esc(w)}</b>`).join(', ')}`;
    return ids;
  } catch (e) {
    $('windowsOut').innerHTML = `<span class="bad">${esc(e)}</span>`;
    return [];
  }
}
$('openInspector').addEventListener('click', async () => {
  await tiny.win.open('inspector', { page: 'inspector.html', title: 'Inspector', size: '460x420' });
  windowLog('opened', 'inspector');
  refreshWindows();
});
$('listWindows').addEventListener('click', refreshWindows);
$('closeInspector').addEventListener('click', async () => {
  await tiny.win.close('inspector');
  refreshWindows();
});
// backend rebroadcasts closes (see onWindowClosed) so the list stays honest
// even when a window is closed by its own button or the red traffic light.
tiny.api.on('win-closed', ({ id }) => {
  windowLog('closed', id);
  refreshWindows();
});

/* ══════════════ ffi lab ══════════════
   The backend dlopens system dylibs (libSystem, libz) via tjs:ffi and calls
   raw C symbols — sysctlbyname, getpid, compress2 — no bindings, no build. */

let ffiLoaded = false;
async function ffiEnsure() {
  if (ffiLoaded) return;
  ffiLoaded = true;
  try {
    const rows = await tiny.api.call('ffiInfo');
    $('ffiInfo').innerHTML = rows.map((r) =>
      `<dt>${esc(r.label)}</dt><dd>${esc(r.value)} <span class="muted">· ${esc(r.call)}</span></dd>`).join('');
  } catch (e) {
    ffiLoaded = false;
    $('ffiInfo').innerHTML = `<dt>error</dt><dd>${esc(e)}</dd>`;
  }
}

async function querySysctl(name) {
  if (!name) return;
  $('sysctlName').value = name;
  try {
    const r = await tiny.api.call('ffiSysctl', { name });
    $('sysctlOut').innerHTML = `<b class="amber">${esc(r.name)}</b> <span class="muted">(${esc(r.kind)})</span>\n${esc(r.value)}`;
  } catch (e) {
    $('sysctlOut').innerHTML = `<span class="muted">${esc(e)}</span>`;
  }
}
$('sysctlBtn').addEventListener('click', () => querySysctl($('sysctlName').value.trim()));
$('sysctlName').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') querySysctl($('sysctlName').value.trim()); });
$('sysctlChips').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-name]');
  if (b) querySysctl(b.dataset.name);
});

$('zLevel').addEventListener('input', () => { $('zLevelVal').textContent = $('zLevel').value; });
$('zBtn').addEventListener('click', async () => {
  try {
    const r = await tiny.api.call('zlibRoundtrip', { text: $('zText').value, level: Number($('zLevel').value) });
    $('zIn').textContent = fmtBytes(r.inBytes);
    $('zOut').textContent = fmtBytes(r.outBytes);
    $('zBarOut').style.width = Math.min(100, r.outBytes / r.inBytes * 100) + '%';
    const pct = (100 - r.outBytes / r.inBytes * 100).toFixed(1);
    $('zStatus').innerHTML = `<b>${pct}%</b> smaller at level ${r.level} · ${r.ms.toFixed(2)} ms in native code · roundtrip ` +
      (r.roundtrip ? '<span class="ok">intact ✓</span>' : '<span class="bad">MISMATCH</span>');
    $('zHex').innerHTML = esc(r.hexHead) + (r.outBytes > 48 ? ` <span class="muted">… +${r.outBytes - 48} bytes</span>` : '');
  } catch (e) {
    $('zStatus').innerHTML = `<span class="bad">${esc(e)}</span>`;
  }
});

/* ══════════════ system tab (tinyjs 0.3.1: store / hotkey / context / theme / power / print) ══ */

// -- tiny.store: persistent JSON, namespaced by app id --

async function refreshStore() {
  try {
    const all = await tiny.store.all();
    const keys = Object.keys(all);
    $('storeDump').innerHTML = keys.length
      ? keys.map((k) => `<b>${esc(k)}</b> = ${esc(JSON.stringify(all[k]))}`).join('\n')
      : '<span class="muted">(store is empty)</span>';
  } catch (e) {
    $('storeDump').textContent = String(e);
  }
}
$('storeSet').addEventListener('click', async () => {
  const key = $('storeKey').value.trim();
  if (!key) return;
  const raw = $('storeVal').value;
  let value;
  try { value = JSON.parse(raw); } catch { value = raw; }   // accept JSON or bare text
  await tiny.store.set(key, value);
  refreshStore();
});
$('storeDel').addEventListener('click', async () => {
  const key = $('storeKey').value.trim();
  if (!key) return;
  await tiny.store.delete(key);
  refreshStore();
});

// -- tiny.hotkey: system-wide, fires even when the app is unfocused --

let hotkeyOn = false, hotkeyHits = 0;
async function toggleHotkey() {
  const combo = $('hotkeyCombo').value.trim();
  if (hotkeyOn) {
    await tiny.hotkey.unregister('summon');
    hotkeyOn = false;
    $('hotkeyOut').textContent = 'not registered';
  } else {
    if (!combo) return;
    await tiny.hotkey.register('summon', combo);
    hotkeyOn = true;
    $('hotkeyOut').innerHTML = `registered <b>${esc(combo)}</b> — now press it from another app`;
  }
  toggleLabel($('hotkeyBtn'), hotkeyOn, 'Register');
  syncMenuChecks();
}
$('hotkeyBtn').addEventListener('click', () => toggleHotkey().catch((e) => { $('hotkeyOut').textContent = String(e); }));
tiny.hotkey.on((id) => {
  if (id !== 'summon') return;
  hotkeyHits++;
  tiny.win.show();
  tiny.win.center();
  tiny.notify('Tiny Deck', 'Summoned by global hotkey (' + hotkeyHits + '×)');
  showTab('system');
  $('hotkeyOut').innerHTML = `fired <b>${hotkeyHits}×</b> — the combo works even while another app is focused`;
});

// -- tiny.menu.setContext: replace WebKit's right-click menu --

// The custom right-click menu is enabled at boot (see init → setCtx(true)),
// so right-clicking anywhere works from launch; the toggle flips back to
// WebKit’s default with setContext(null).
let ctxOn = false;
async function setCtx(on) {
  ctxOn = on;
  if (on) {
    await tiny.menu.setContext([
      { id: 'ctx-overview', label: 'Jump to Overview' },
      { id: 'ctx-gpu', label: 'Jump to GPU' },
      { separator: true },
      { id: 'ctx-notify', label: 'Send a Notification' },
      { id: 'ctx-print', label: 'Print Page…' },
    ]);
    $('ctxOut').innerHTML = 'custom menu active — <b>right-click anywhere</b>';
  } else {
    await tiny.menu.setContext(null);       // null restores WebKit’s default
    $('ctxOut').textContent = 'using WebKit’s default context menu';
  }
  toggleLabel($('ctxBtn'), ctxOn, 'Custom right-click menu');
}
$('ctxBtn').addEventListener('click', () => setCtx(!ctxOn).catch((e) => { $('ctxOut').textContent = String(e); }));
tiny.menu.onContext((id) => {
  if (id === 'ctx-overview') showTab('overview');
  if (id === 'ctx-gpu') showTab('gpu');
  if (id === 'ctx-notify') tiny.notify('Tiny Deck', 'Sent from the native context menu');
  if (id === 'ctx-print') tiny.win.print();
  if (id) $('ctxOut').innerHTML = `context click → <b>${esc(id)}</b>`;
});

// -- power events + print --

tiny.api.on('sleep', () => logPower('sleep'));
tiny.api.on('wake', () => logPower('wake'));
function logPower(kind) {
  const d = document.createElement('div');
  d.innerHTML = `${esc(new Date().toLocaleTimeString())} · <b>${esc(kind)}</b>`;
  $('powerFeed').prepend(d);
  while ($('powerFeed').children.length > 40) $('powerFeed').lastChild.remove();
}
$('printBtn').addEventListener('click', () => tiny.win.print());

let systemLoaded = false;
async function systemEnsure() {
  applyTheme();                             // refresh the theme readout lines
  if (systemLoaded) return;
  systemLoaded = true;
  refreshStore();
}

/* ══════════════ desktop + power tabs (0.13–0.15) ══════════════
   Desktop: shell verbs / share sheet / screens & captureScreen.
   Power:   dock & sounds / preventSleep · idle · frontmost / launchAtLogin
            & app.paths. */

const shellSay = (el, p) => p
  .then((r) => { $(el).innerHTML = '→ resolved <b>' + esc(JSON.stringify(r)) + '</b>'; })
  .catch((e) => { $(el).innerHTML = '→ rejected: <b>' + esc(e?.message || e) + '</b>'; });

// -- shell verbs + Quick Look, all pointed at one demo file --

let demoFile = null;
$('demoMake').addEventListener('click', async () => {
  const { path } = await tiny.api.call('makeDemoFile');
  demoFile = path;
  $('demoPath').textContent = path;
  $('shellOut').innerHTML = 'demo file written — now <b>Reveal</b> / <b>Quick Look</b> / <b>Open</b> / <b>Trash</b> it';
});
const needDemo = () => {
  if (!demoFile) $('shellOut').innerHTML = '<b>make the demo file first</b> — or Trash already ate it (rejects tell you)';
  return demoFile;
};
$('shReveal').addEventListener('click', () => needDemo() && shellSay('shellOut', tiny.app.shell.reveal(demoFile)));
$('shOpen').addEventListener('click', () => needDemo() && shellSay('shellOut', tiny.app.shell.open(demoFile)));
$('shTrash').addEventListener('click', () => needDemo() && shellSay('shellOut', tiny.app.shell.trash(demoFile)));
$('shQl').addEventListener('click', () => { if (needDemo()) { tiny.app.quickLook(demoFile); $('shellOut').textContent = 'Quick Look panel is up — space/esc closes it'; } });
$('shOpenUrl').addEventListener('click', () => shellSay('shellOut', tiny.app.shell.open($('shUrl').value.trim())));

// -- native share sheet, anchored at the click --

let shareAttach = false;
$('shareFile').addEventListener('click', () => {
  shareAttach = !shareAttach;
  toggleLabel($('shareFile'), shareAttach, 'Attach demo file');
});
$('shareBtn').addEventListener('click', (ev) => {
  const opts = { x: ev.clientX, y: ev.clientY };
  const text = $('shareText').value.trim(), url = $('shareUrl').value.trim();
  if (text) opts.text = text;
  if (url) opts.url = url;
  if (shareAttach && demoFile) opts.paths = [demoFile];
  tiny.win.share(opts);
  $('shareOut').textContent = 'share sheet raised at (' + ev.clientX + ', ' + ev.clientY + ')' +
    (opts.paths ? ' with the demo file attached' : '');
});

// -- displays + captureScreen --

async function refreshScreens() {
  const screens = await tiny.app.screens();
  const wrap = $('screensList');
  wrap.textContent = '';
  for (const s of screens) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = `${s.primary ? '★ ' : ''}${s.name || 'display ' + s.id} — ` +
      `${s.width}×${s.height} @${s.scale}x at (${s.x}, ${s.y}) · visible ${s.visible.width}×${s.visible.height}`;
    const btn = document.createElement('button');
    btn.textContent = '📸';
    btn.title = 'captureScreen(' + s.id + ')';
    btn.addEventListener('click', async () => {
      $('shotImg').hidden = true;
      try {
        const shot = await tiny.app.captureScreen(s.id);
        const { uri, bytes } = await tiny.api.call('readShot', { path: shot.path });
        $('shotImg').src = uri;
        $('shotImg').hidden = false;
        $('shotOut').innerHTML = `captured <b>${shot.width}×${shot.height}</b> → ${esc(shot.path)} (${fmtBytes(bytes)})`;
      } catch (e) {
        $('shotOut').innerHTML = 'rejected: <b>' + esc(e?.message || e) + '</b> — the onboarding hook (see pasta/deja for the full permission-gate recipe)';
      }
    });
    row.append(label, btn);
    wrap.appendChild(row);
  }
}

// -- dock badge / bounce, beep / playSound --

$('badgeSet').addEventListener('click', () => { tiny.app.dock.setBadge($('badgeText').value); $('dockOut').textContent = 'badge set — check the Dock tile'; });
$('badgeClear').addEventListener('click', () => { tiny.app.dock.setBadge(''); $('dockOut').textContent = 'badge cleared'; });
const armBounce = (critical) => {
  $('dockOut').textContent = 'switch to another app now — bouncing in 3 s…';
  setTimeout(() => tiny.app.dock.bounce(critical ? { critical: true } : undefined), 3000);
};
$('bounceBtn').addEventListener('click', () => armBounce(false));
$('bounceCrit').addEventListener('click', () => armBounce(true));
$('beepBtn').addEventListener('click', () => tiny.app.beep());
$('soundPlay').addEventListener('click', async () => {
  const name = $('soundName').value;
  const ok = await tiny.app.playSound(name);
  $('dockOut').innerHTML = ok ? `played <b>${esc(name)}</b>` : `<b>${esc(name)}</b> didn't load (playSound → false)`;
});

// -- power assertion + live idle / frontmost readouts --

let sleepOn = false, sleepDisplay = false;
$('sleepDisplay').addEventListener('click', () => {
  sleepDisplay = !sleepDisplay;
  toggleLabel($('sleepDisplay'), sleepDisplay, 'keep display on');
});
$('sleepBtn').addEventListener('click', async () => {
  if (sleepOn) {
    await tiny.app.power.allowSleep();
    sleepOn = false;
    $('powerState').textContent = 'none';
  } else {
    await tiny.app.power.preventSleep($('sleepReason').value.trim() || 'Tiny Deck demo',
      sleepDisplay ? { display: true } : undefined);
    sleepOn = true;
    $('powerState').textContent = 'active' + (sleepDisplay ? ' (display too)' : '') + ' — see pmset -g assertions';
  }
  toggleLabel($('sleepBtn'), sleepOn, 'Prevent sleep');
});

// Live rows tick only while the Power panel is showing — no idle bridge chatter.
setInterval(async () => {
  if (activeTab !== 'power') return;
  try {
    const [idle, front] = await Promise.all([tiny.app.idleTime(), tiny.app.frontmostApp()]);
    $('idleOut').textContent = idle.toFixed(1) + ' s';
    $('frontOut').textContent = front ? `${front.name ?? '?'} (${front.bundleId ?? 'no bundle id'}, pid ${front.pid})` : '—';
  } catch { /* pre-0.15 launcher */ }
}, 1000);

// -- launch at login + the standard per-app paths --

let loginOn = false;
async function paintLogin(status) {
  loginOn = status === 'enabled';
  $('loginStatus').textContent = status;
  toggleLabel($('loginBtn'), loginOn, 'Launch at login');
  $('loginBtn').disabled = status === 'unsupported';
}
$('loginBtn').addEventListener('click', async () => {
  paintLogin(await tiny.app.launchAtLogin.set(!loginOn));
});

async function refreshPaths() {
  const paths = await tiny.app.paths();
  const wrap = $('pathsList');
  wrap.textContent = '';
  for (const [key, value] of Object.entries(paths)) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.innerHTML = `<b>${esc(key)}</b> ${esc(value)}`;
    const btn = document.createElement('button');
    btn.textContent = '↗';
    btn.title = 'shell.reveal';
    btn.addEventListener('click', () => shellSay('shellOut', tiny.app.shell.reveal(value)));
    row.append(label, btn);
    wrap.appendChild(row);
  }
}

async function initDesktop() {
  try {
    await Promise.all([refreshScreens(), refreshPaths()]);
    paintLogin(await tiny.app.launchAtLogin.get());
  } catch (e) {
    $('screensList').textContent = 'needs tinyjs 0.15+ (' + (e?.message || e) + ')';
  }
}

/* ══════════════ boot ══════════════ */

async function init() {
  await tiny.api.call('ping');
  $('dot').classList.add('ok');
  $('linkState').textContent = 'up';

  const info = await tiny.api.call('sysinfo');
  $('sysinfo').innerHTML = Object.entries(info)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('notesDb').innerHTML = 'stored in <b>' + esc(info.db) + '</b> via tjs:sqlite';

  // version introspection (0.5.0): tiny.app.info() reports the app's own version
  // (from tinyjs.json), the tinyjs framework build, and the txiki runtime.
  try {
    const ai = await tiny.app.info();
    $('sysinfo').insertAdjacentHTML('afterbegin',
      `<dt>app version</dt><dd>${esc(ai.version)} <span class="muted">· tiny.app.info()</span></dd>` +
      `<dt>tinyjs build</dt><dd>${esc(ai.tinyjs)}</dd>` +
      `<dt>runtime</dt><dd>${esc(ai.runtime)}</dd>`);
  } catch { /* older runtime without app.info */ }

  listDir(info.home);
  renderNotes(await tiny.api.call('notesList'));
  wasmInit().catch((e) => { $('wasmHex').textContent = 'wasm failed: ' + e; });

  // seed the native theme (0.3.1); may be null until the launcher reports it,
  // in which case applyTheme() falls back to matchMedia and tiny.theme.on
  // fills it in a moment later.
  nativeDark = (await tiny.theme.get())?.dark ?? null;

  // show where tiny.store actually writes (namespaced by the app id)
  try {
    const si = await tiny.api.call('storeInfo');
    $('storePath').textContent = si.dir + '/store.json';
  } catch { /* non-critical */ }

  // restore persisted prefs — now via tiny.store (0.3.1) instead of the old
  // sqlite prefs table.
  const [savedTheme, savedTab] = await Promise.all([
    tiny.store.get('theme'),
    tiny.store.get('tab'),
  ]);
  if (savedTheme) { themeMode = savedTheme; applyTheme(); }
  if (savedTab && document.getElementById('panel-' + savedTab)) showTab(savedTab, false);

  await tiny.menu.set([
    {
      title: 'View',
      items: [
        { id: 'tab:overview', label: 'Overview', key: '1' },
        { id: 'tab:files', label: 'Files', key: '2' },
        { id: 'tab:run', label: 'Run', key: '3' },
        { id: 'tab:http', label: 'HTTP', key: '4' },
        { id: 'tab:notes', label: 'Notes', key: '5' },
        { id: 'tab:gpu', label: 'GPU', key: '6' },
        { id: 'tab:wasm', label: 'WASM', key: '7' },
        { id: 'tab:ffi', label: 'FFI', key: '8' },
        { id: 'tab:app', label: 'App', key: '9' },
        { id: 'tab:system', label: 'System', key: '0' },
        { id: 'tab:desktop', label: 'Desktop', key: 'd' },
        { id: 'tab:power', label: 'Power', key: 'e' },
      ],
    },
    {
      title: 'Actions',
      items: [
        { id: 'open', label: 'Open File…', key: 'o' },
        { id: 'rename', label: 'Rename Window', key: 'r' },
        // 0.5.0 stateful menus: a nested submenu of checkable items whose ✓
        // tracks live app state (see syncMenuChecks + tiny.menu.update).
        { id: 'toggles', label: 'Toggles', submenu: [
          { id: 'm-watch', label: 'Watch Current Folder', key: 'w', checked: !!watching },
          { id: 'm-tray', label: 'Tray Mode', key: 't', checked: trayOn },
          { id: 'm-ontop', label: 'Always on Top', checked: onTop },
          { id: 'm-hideclose', label: 'Hide on Close', checked: hideOnCloseOn },
          { id: 'm-hotkey', label: 'Global Hotkey', key: 'k', checked: hotkeyOn },
        ] },
        { separator: true },
        { id: 'print', label: 'Print…', key: 'p' },
        { id: 'hello', label: 'Say Hello' },
        { id: 'soon', label: 'More (coming soon)', enabled: false },   // grayed out
      ],
    },
  ]);
  menusReady = true;
  tiny.menu.on((id) => {
    if (id.startsWith('tab:')) return showTab(id.slice(4));
    if (id === 'open') $('openBtn').click();
    if (id === 'rename') $('retitle').click();
    if (id === 'm-watch') { showTab('files'); toggleWatch(); }
    if (id === 'm-tray') { showTab('app'); setTray(!trayOn); }
    if (id === 'm-ontop') { showTab('app'); $('ontopBtn').click(); }
    if (id === 'm-hideclose') { showTab('app'); setHideOnClose(!hideOnCloseOn); }
    if (id === 'm-hotkey') { showTab('system'); toggleHotkey(); }
    if (id === 'print') tiny.win.print();
    if (id === 'hello') tiny.win.alert('Hello!', 'This came from a native menu item.');
  });

  // custom right-click menu on by default — right-click anywhere from launch
  setCtx(true).catch(() => {});

  initDesktop();
}

applyTheme();   // runs last: everything above is declared by now
init().catch((e) => {
  $('linkState').textContent = 'error';
  $('dirErr').textContent = 'init failed: ' + e;
});
