// render.js — the ONE place synthesized formats (.mid + tracker modules)
// become playable audio, shared by every window that owns an audio element
// (the deck and the big screen load this ahead of their own scripts).
//
// The rule this file exists to enforce: AUDIO BYTES NEVER CROSS THE API
// SOCKET. The backend is a single QuickJS event loop serving every window,
// and base64-chunking megabytes through it (soundfonts down, finished wavs
// up) once made the whole app crawl. So the PAGE reads files straight off
// disk — fetch on a tiny.fileURL, which readAccess covers — hands the bytes
// zero-copy to a module worker (SpessaSynth / libopenmpt under the webview's
// real JIT + wasm, where an 83 s module renders in ~100 ms), and plays the
// result from an in-memory blob. Nothing is written back to disk, ever: a
// re-render is cheaper than the transport was, and each window renders its
// own copy in its own process. The backend's only remaining jobs are
// "download the soundfont to disk once" and "tell me its path".
window.ampRender = (() => {
  const isMidi = (p) => /\.midi?$/i.test(p || '');
  const isTracker = (p) => /\.(mod|s3m|xm|it|mptm)$/i.test(p || '');
  const isRendered = (p) => isMidi(p) || isTracker(p);

  // workers resolve against THIS script's directory, so even a page loaded
  // from somewhere else (test harnesses) finds midi-render/tracker-render
  const BASE = document.currentScript
    ? new URL('.', document.currentScript.src) : new URL('.', location.href);
  let midiWorker = null, trkWorker = null, midiSfId = null;
  let q = Promise.resolve();          // one worker exchange at a time
  function workerCall(which, msg, transfer, onPct) {
    q = q.catch(() => {}).then(() => new Promise((resolve, reject) => {
      if (which === 'midi' && !midiWorker) midiWorker = new Worker(new URL('midi-render.js', BASE), { type: 'module' });
      if (which === 'trk' && !trkWorker) trkWorker = new Worker(new URL('tracker-render.js', BASE), { type: 'module' });
      const w = which === 'midi' ? midiWorker : trkWorker;
      const onMsg = (e) => {
        const d = e.data;
        if (d.pct != null) { if (onPct) onPct(d.pct); return; }
        w.removeEventListener('message', onMsg);
        if (d.error) reject(new Error(d.error)); else resolve(d);
      };
      w.addEventListener('message', onMsg);
      w.postMessage(msg, transfer || []);
    }));
    return q;
  }

  // page-side file read — no socket. If fetch(file://) is ever walled off (a
  // platform quirk, not the design), the base64 chunk crawl still exists
  // behind the backend's generic 'fileChunk' — slow, but never wrong.
  const u8FromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  async function fileBytes(path) {
    try {
      const res = await fetch(tiny.fileURL(path));
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.arrayBuffer();
    } catch (e) {
      // say so — the fallback is correct but ~60x slower, and a silent one
      // reads exactly like the fast path from the outside (measured on
      // Windows 2026-07-30: 21 ms fetch vs ~1.3 s chunked, same 8 MB bank)
      console.warn('[render] fetch(file://) unavailable, falling back to fileChunk:', e);
      const parts = [];
      let off = 0;
      for (;;) {
        const r = await tiny.api.call('fileChunk', { path, off, len: 786432 });
        if (!r || !r.b64) break;
        const c = u8FromB64(r.b64);
        parts.push(c); off += c.length;
        if (r.eof) break;
      }
      const out = new Uint8Array(off);
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return out.buffer;
    }
  }

  // keep-only-current, in MEMORY: a render is 7–60 MB of wav, so one lives at
  // a time per window. The outgoing URL is revoked on a delay — the audio
  // element has definitely moved on by then.
  let cached = null;                  // { key, url, meta, duration }
  function remember(key, res) {
    if (cached && cached.url) {
      const old = cached.url;
      setTimeout(() => { try { URL.revokeObjectURL(old); } catch (e) {} }, 5000);
    }
    cached = { key, ...res };
    return cached;
  }

  // render(path) -> { url, meta, duration }: url is a blob: src for an
  // <audio> in THIS window. onPct/onNote are progress hooks — the deck turns
  // them into marquee flashes; the big screen renders silently.
  async function render(path, { onPct, onNote } = {}) {
    const midi = isMidi(path);
    // first ever .mid: the backend streams the bank to disk ('sf-dl' flashes)
    const sf = midi ? await tiny.api.call('sfEnsure') : null;
    const key = path + '|' + (midi ? sf.id : 'self');
    if (cached && cached.key === key) return cached;
    if (midi && midiSfId !== sf.id) {
      if (onNote) onNote('♪ loading soundfont…');
      const buf = await fileBytes(sf.path);
      await workerCall('midi', { sf: buf, sfId: sf.id }, [buf]);
      midiSfId = sf.id;
    }
    const bytes = await fileBytes(path);
    const res = midi
      ? await workerCall('midi', { mid: bytes }, [bytes], onPct)
      : await workerCall('trk', { mod: bytes }, [bytes], onPct);
    const url = URL.createObjectURL(new Blob([res.wav], { type: 'audio/wav' }));
    return remember(key, { url, meta: res.meta || null, duration: res.duration });
  }

  // the active soundfont changed: a cached midi render no longer applies
  // (tracker renders carry their own samples and survive)
  function invalidate() {
    midiSfId = null;
    if (cached && !cached.key.endsWith('|self')) {
      const old = cached.url;
      setTimeout(() => { try { URL.revokeObjectURL(old); } catch (e) {} }, 5000);
      cached = null;
    }
  }

  return { isMidi, isTracker, isRendered, render, invalidate };
})();
