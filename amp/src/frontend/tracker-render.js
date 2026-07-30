// tracker-render.js — module worker: a tracker module (.mod/.s3m/.xm/.it) in,
// WAV out. libopenmpt (vendored, the OpenMPT playback engine compiled to
// wasm) decodes it — the samples travel INSIDE the file, so unlike MIDI
// there's no soundfont to fetch first. Same Linux-safe shape as midi-render:
// pure computation, the deck plays the finished wav through a media element.
// {metaOnly: true} skips the render — a cache hit still wants the title and
// the sample names (tracker files' traditional greetz surface) for Track Info.
import factory from './libopenmpt.min.js';

let libPromise = null;
const getLib = () => (libPromise ||= factory());

function cstr(lib, str) {
  const p = lib.stackAlloc(str.length + 1);
  for (let i = 0; i < str.length; i++) lib.HEAP8[p + i] = str.charCodeAt(i);
  lib.HEAP8[p + str.length] = 0;
  return p;
}
function metaStr(lib, mod, key) {
  const stack = lib.stackSave();
  const s = lib.UTF8ToString(lib._openmpt_module_get_metadata(mod, cstr(lib, key)));
  lib.stackRestore(stack);
  return s;
}
function getMeta(lib, mod) {
  const names = (count, get) => {
    const out = [];
    for (let i = 0; i < count; i++) { const s = lib.UTF8ToString(get(i)); if (s.trim()) out.push(s); }
    return out;
  };
  return {
    title: metaStr(lib, mod, 'title'),
    artist: metaStr(lib, mod, 'artist'),
    type: metaStr(lib, mod, 'type_long'),
    message: metaStr(lib, mod, 'message_raw'),
    samples: names(lib._openmpt_module_get_num_samples(mod), (i) => lib._openmpt_module_get_sample_name(mod, i)),
    instruments: names(lib._openmpt_module_get_num_instruments(mod), (i) => lib._openmpt_module_get_instrument_name(mod, i)),
  };
}

// interleave two float channels into a 16-bit PCM WAV (what the deck expects
// back on disk — small and universally decodable)
function wavFromFloat(L, R, sr) {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w4(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w4(8, 'WAVE');
  w4(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w4(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  return buf;
}

onmessage = async (e) => {
  const m = e.data;
  let mod = 0, filePtr = 0, lp = 0, rp = 0;
  const lib = await getLib();
  try {
    const bytes = new Uint8Array(m.mod);
    filePtr = lib._malloc(bytes.byteLength);
    lib.HEAPU8.set(bytes, filePtr);
    mod = lib._openmpt_module_create_from_memory(filePtr, bytes.byteLength, 0, 0, 0);
    if (!mod) throw new Error('not a module libopenmpt understands');
    const meta = getMeta(lib, mod);
    if (m.metaOnly) { postMessage({ meta }); return; }

    lib._openmpt_module_set_repeat_count(mod, 0);          // play once — no infinite loops on disk
    const stack = lib.stackSave();                          // Amiga-style resampling for Amiga-born files
    lib._openmpt_module_ctl_set(mod, cstr(lib, 'render.resampler.emulate_amiga'), cstr(lib, '1'));
    lib.stackRestore(stack);
    const sr = 44100, CHUNK = 4096, CAP = sr * 1200;        // 20 min hard stop for pathological files
    const dur = lib._openmpt_module_get_duration_seconds(mod);
    const total = Math.min(CAP, Math.ceil(sr * (dur || 0)) + sr);   // + slack: duration is an estimate
    const L = new Float32Array(total), R = new Float32Array(total);
    lp = lib._malloc(4 * CHUNK); rp = lib._malloc(4 * CHUNK);
    let filled = 0, lastPct = -1;
    while (filled < total) {
      const n = lib._openmpt_module_read_float_stereo(mod, sr, Math.min(CHUNK, total - filled), lp, rp);
      if (!n) break;
      L.set(lib.HEAPF32.subarray(lp / 4, lp / 4 + n), filled);
      R.set(lib.HEAPF32.subarray(rp / 4, rp / 4 + n), filled);
      filled += n;
      const pct = Math.floor((filled / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; postMessage({ pct }); }
    }
    const wav = wavFromFloat(L.subarray(0, filled), R.subarray(0, filled), sr);
    postMessage({ wav, duration: filled / sr, meta }, [wav]);
  } catch (err) {
    postMessage({ error: String((err && err.message) || err) });
  } finally {
    if (mod) lib._openmpt_module_destroy(mod);
    if (filePtr) lib._free(filePtr);
    if (lp) lib._free(lp);
    if (rp) lib._free(rp);
  }
};
