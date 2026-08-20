// cue.js — single-file album rips, read as a tracklist.
//
// A rip is one long FLAC (or WAV, or APE-turned-FLAC) plus a sheet saying
// where each track begins: either an external `.cue` text file sitting next
// to it, or the CUESHEET metadata block FLAC can carry inside itself. Either
// way the answer is the same shape — playlist-ready tracks that all point at
// ONE audio file with absolute start/end offsets in seconds.
//
// That's exactly what a side of vinyl is anyway: one continuous groove with
// gaps drawn in it. The deck lays those tracks out at their real radii and
// the needle just seeks; the file never reloads between tracks, so a rip
// plays gapless the way the master did.
//
// External sheets win over embedded ones when both exist: only the text file
// carries titles (FLAC's CUESHEET block is a CD burning structure — track
// numbers and sample offsets, no names).
//
// Ported from amp's src/cue.js; the head-reader is duplicated (ten lines)
// rather than reaching into main.js for it.

// what the webview can actually decode — a sheet pointing at .ape/.wv/.tta
// parses fine but the element could never play it, so it's treated as a
// sheet whose audio is missing rather than N dead tracks in the crate
const PLAYABLE = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|aiff?)$/i;

async function readHead(path, bytes) {
  const fh = await tjs.open(path, 'r');
  const buf = new Uint8Array(bytes);
  let got = 0;
  while (got < buf.length) {
    const n = await fh.read(buf.subarray(got), got);
    if (!n) break;
    got += n;
  }
  await fh.close();
  return buf.subarray(0, got);
}

// ── the .cue text format ────────────────────────────────────────────────────
// Line-oriented, whitespace-indented, values optionally quoted. Times are
// MM:SS:FF where FF is CD frames (75/second); MM can exceed 99.
function cueTime(s) {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(s);
  return m ? +m[1] * 60 + +m[2] + +m[3] / 75 : null;
}
// old rips are anything: UTF-8 (maybe BOM'd), UTF-16 with BOM, or latin1.
// txiki's TextDecoder only speaks utf-8, so the others are decoded by hand;
// a replacement char in the utf-8 attempt means it wasn't utf-8 at all.
function decodeCue(b) {
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) {
    const le = b[0] === 0xff;
    let s = '';
    for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
    return s;
  }
  let s = '';
  try { s = new TextDecoder('utf-8').decode(b); } catch (e) {}
  if (!s || s.includes('�')) { s = ''; for (const c of b) s += String.fromCharCode(c); }   // latin1 rescue
  return s.replace(/^﻿/, '');
}
export function parseCueText(text) {
  const album = { title: null, performer: null };
  const files = [];                 // a sheet may span several FILE entries
  let curFile = null, curTrack = null;
  const unq = (s) => { s = String(s || '').trim(); const q = /^"([^"]*)"/.exec(s); return q ? q[1] : s.split(/\s+/)[0] || ''; };
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\S+)\s*(.*)$/.exec(line);
    const cmd = m[1].toUpperCase(), rest = m[2] || '';
    if (cmd === 'FILE') {
      curFile = { file: unq(rest), tracks: [] };
      files.push(curFile);
      curTrack = null;
    } else if (cmd === 'TRACK') {
      const r = /^(\d+)\s+(\S+)/.exec(rest);
      curTrack = { no: r ? +r[1] : 0, type: r ? r[2].toUpperCase() : 'AUDIO', title: null, performer: null, indexes: {} };
      if (curFile) curFile.tracks.push(curTrack);
    } else if (cmd === 'TITLE') {
      if (curTrack) curTrack.title = unq(rest); else album.title = unq(rest);
    } else if (cmd === 'PERFORMER') {
      if (curTrack) curTrack.performer = unq(rest); else album.performer = unq(rest);
    } else if (cmd === 'INDEX') {
      const r = /^(\d+)\s+(\S+)/.exec(rest);
      if (r && curTrack) { const t = cueTime(r[2]); if (t != null) curTrack.indexes[+r[1]] = t; }
    }
    // REM/PREGAP/POSTGAP/FLAGS/ISRC/CATALOG: not needed to spin the record
  }
  return { album, files };
}

// ── FLAC STREAMINFO — sample rate + total length ────────────────────────────
// Needed twice: converting the CUESHEET block's sample offsets to seconds, and
// giving the LAST track an end (a sheet only says where the next one starts).
function flacBlocks(buf, onBlock) {
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'fLaC') return false;
  let o = 4;
  while (o + 4 <= buf.length) {
    const last = buf[o] & 0x80, type = buf[o] & 0x7f;
    const size = (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
    o += 4;
    if (onBlock(type, o, size) === true) return true;
    o += size;
    if (last) break;
  }
  return true;
}
function streamInfo(b, o) {
  const sampleRate = (b[o + 10] << 12) | (b[o + 11] << 4) | (b[o + 12] >> 4);
  const totalSamples = (b[o + 13] & 0x0f) * 4294967296 +
    (((b[o + 14] << 24) | (b[o + 15] << 16) | (b[o + 16] << 8) | b[o + 17]) >>> 0);
  return { sampleRate, totalSamples };
}
async function flacLength(path) {
  try {
    const b = await readHead(path, 4096);
    let si = null;
    flacBlocks(b, (type, o) => {                  // STREAMINFO is always the first block
      if (type === 0 && o + 18 <= b.length) si = streamInfo(b, o);
      return true;
    });
    return si && si.sampleRate ? si.totalSamples / si.sampleRate : null;
  } catch (e) { return null; }
}

// ── the FLAC CUESHEET block (type 5) ────────────────────────────────────────
// MCN(128) lead-in(u64) is-CD flag(1) reserved(258) ntracks(u8), then per
// track: offset(u64 samples) number(u8) ISRC(12) flags(1) reserved(13)
// nindexes(u8), per index: offset(u64, relative to track) number(u8)
// reserved(3). Lead-out is track 170 on a CD sheet, 255 otherwise.
function u64(b, p) { let v = 0; for (let i = 0; i < 8; i++) v = v * 256 + b[p + i]; return v; }
function cueBlock(b, o, size) {
  const end = o + size;
  let p = o + 128 + 8 + 1 + 258;
  if (p >= end) return null;
  const n = b[p]; p += 1;
  const tracks = [];
  for (let t = 0; t < n; t++) {
    if (p + 36 > end) return null;
    const offset = u64(b, p); p += 8;
    const no = b[p]; p += 1;
    p += 12;                                          // ISRC
    const audio = !(b[p] & 0x80); p += 1;
    p += 13;
    const ni = b[p]; p += 1;
    const indexes = [];
    for (let i = 0; i < ni; i++) {
      if (p + 12 > end) return null;
      indexes.push({ offset: u64(b, p), no: b[p + 8] });
      p += 12;
    }
    tracks.push({ offset, no, audio, indexes });
  }
  return { tracks };
}

// ── the track shape the crate speaks ────────────────────────────────────────
// Same {path,name} every scanned file gets, plus the window into the rip.
// `duration` rides along because the sheet already knows it — the page skips
// its usual metadata read for these. The last track of a non-FLAC rip has no
// end (nothing says how long the file is) and gets measured in the page.
function mkTrack({ path, no, title, start, end }) {
  start = Math.max(0, start || 0);
  return {
    path,
    name: title || 'Track ' + String(no).padStart(2, '0'),
    cueStart: start,
    cueEnd: end != null ? end : null,
    duration: end != null ? Math.max(0, end - start) : 0,
  };
}

// ── external .cue → tracks ──────────────────────────────────────────────────
// The FILE reference is resolved in the sheet's own folder: exact name, then
// case-insensitive, then "same basename as the .cue with any playable
// extension" — the classic renamed-the-flac-but-not-the-cue rescue.
async function fileExists(p) {
  try { return !(await tjs.stat(p)).isDirectory; } catch (e) { return false; }
}
async function resolveAudio(dir, fileRef, cuePath) {
  const name = String(fileRef || '').replace(/^.*[\\/]/, '');
  if (name && await fileExists(dir + '/' + name)) return dir + '/' + name;
  const lower = name.toLowerCase();
  const cueBase = cuePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').toLowerCase();
  let byBase = null;
  try {
    for await (const e of await tjs.readDir(dir)) {
      if (e.isDirectory) continue;
      const en = e.name.toLowerCase();
      if (lower && en === lower) return dir + '/' + e.name;
      if (!byBase && PLAYABLE.test(en) && en.replace(/\.[^.]+$/, '') === cueBase) byBase = dir + '/' + e.name;
    }
  } catch (e) {}
  return byBase;
}

// → { album, tracks } (tracks empty when the sheet's audio can't be found),
// or null when the sheet itself is unreadable.
export async function loadCue(cuePath) {
  let bytes;
  try { bytes = await tjs.readFile(cuePath); } catch (e) { return null; }
  const { album, files } = parseCueText(decodeCue(bytes));
  const dir = cuePath.replace(/[\\/][^\\/]*$/, '') || '/';
  const out = [];
  for (const f of files) {
    const audio = f.tracks.filter((t) => t.type === 'AUDIO' && (t.indexes[1] != null || t.indexes[0] != null));
    if (!audio.length) continue;
    const audioPath = await resolveAudio(dir, f.file, cuePath);
    if (!audioPath || !PLAYABLE.test(audioPath)) continue;
    // FLAC's header says how long the file is — that's the last track's end
    const endCap = /\.flac$/i.test(audioPath) ? await flacLength(audioPath) : null;
    const startOf = (t) => (t.indexes[1] != null ? t.indexes[1] : t.indexes[0]);   // 01 = track proper, 00 = pregap
    audio.forEach((t, i) => {
      out.push(mkTrack({
        path: audioPath, no: t.no || i + 1, title: t.title,
        start: startOf(t), end: audio[i + 1] ? startOf(audio[i + 1]) : endCap,
      }));
    });
  }
  return { album, tracks: out };
}

// ── embedded FLAC CUESHEET → tracks ─────────────────────────────────────────
// No titles live in the block, so every track is "Track NN" and the album
// name has to come from the file's own tags (the caller's job). A block with
// fewer than two audio tracks is a burning artifact, not an album — ignored.
// 256 KB of head covers STREAMINFO + a fat SEEKTABLE + the sheet itself;
// a file that buries its CUESHEET behind megabytes of art just won't expand.
export async function flacEmbeddedCue(path) {
  let b;
  try { b = await readHead(path, 256 * 1024); } catch (e) { return null; }
  let si = null, cs = null;
  flacBlocks(b, (type, o, size) => {
    if (o + size > b.length) return true;             // block ran past our read: stop
    if (type === 0) si = streamInfo(b, o);
    else if (type === 5) { cs = cueBlock(b, o, size); return true; }
  });
  if (!cs || !si || !si.sampleRate) return null;
  const audio = cs.tracks.filter((t) => t.audio && t.no >= 1 && t.no <= 99);
  if (audio.length < 2) return null;
  const sr = si.sampleRate;
  const leadOut = cs.tracks.find((t) => t.no === 170 || t.no === 255);
  const endSamples = leadOut ? leadOut.offset : (si.totalSamples || null);
  const startOf = (t) => {
    const i1 = t.indexes.find((x) => x.no === 1) || t.indexes[0];
    return (t.offset + (i1 ? i1.offset : 0)) / sr;
  };
  return {
    album: { title: null, performer: null },
    tracks: audio.map((t, i) => mkTrack({
      path, no: t.no, title: null,
      start: startOf(t),
      end: audio[i + 1] ? startOf(audio[i + 1]) : (endSamples != null ? endSamples / sr : null),
    })),
  };
}
