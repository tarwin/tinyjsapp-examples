// cue.js — CUE sheets, both kinds: the external .cue text file sitting next to
// a single-file album rip, and the CUESHEET metadata block FLAC can carry
// inside the file itself. Either way the answer is the same normalized shape —
// a list of playlist-ready tracks pointing at ONE audio file with absolute
// start/end offsets in seconds — so the deck can show an album as tracks and
// step between them by seeking, never reloading the file (that's the gapless).
//
// External sheets win over embedded ones when both exist: only the text file
// carries titles (FLAC's CUESHEET block is a CD burning structure — track
// numbers and sample offsets, no names).
import { readHead, flacBlocks } from './meta.js';

// what WKWebView/WebView2/WebKitGTK can actually decode — a cue pointing at
// .ape/.wv/.tta parses fine but the element could never play it, so the sheet
// is treated as missing its audio rather than adding N dead rows
const PLAYABLE = /\.(mp3|m4a|aac|mp4|flac|wav|aif|aiff|caf|oga|ogg|opus)$/i;

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
  const album = { title: null, performer: null, date: null };
  const files = [];                 // a sheet may span several FILE entries
  let curFile = null, curTrack = null;
  const unq = (s) => { s = String(s || '').trim(); const q = /^"([^"]*)"/.exec(s); return q ? q[1] : s.split(/\s+/)[0] || ''; };
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\S+)\s*(.*)$/.exec(line);
    const cmd = m[1].toUpperCase(), rest = m[2] || '';
    if (cmd === 'REM') {
      const r = /^(\w+)\s+(.*)$/.exec(rest);
      if (r && r[1].toUpperCase() === 'DATE' && !album.date) album.date = unq(r[2]);
    } else if (cmd === 'FILE') {
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
    // PREGAP/POSTGAP/FLAGS/ISRC/CATALOG: not needed for playback
  }
  return { album, files };
}

// ── FLAC STREAMINFO — sample rate + total length ────────────────────────────
// Needed twice: converting the CUESHEET block's sample offsets to seconds, and
// giving the LAST track an end (a sheet only says where the next track starts).
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

// ── normalized track shape — what the playlist actually gets ────────────────
function mkTrack({ path, no, title, performer, album, date, start, end }) {
  const t = title || 'Track ' + String(no).padStart(2, '0');
  start = Math.max(0, start || 0);
  return {
    path, cueStart: start, cueEnd: end || null, trackNo: no,
    name: t,
    display: (performer ? performer + ' — ' : '') + t,
    // the last track's duration stays 0 until the file's real length is known
    // (FLAC says; anything else waits for the element's loadedmetadata)
    duration: end != null ? Math.max(0, end - start) : 0,
    tags: { title: t, artist: performer || undefined, album: album || undefined, date: date || undefined },
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
// → { tracks, missing } or null when the sheet itself is unreadable.
// `missing` counts FILE entries whose audio couldn't be found (or isn't a
// format the webview can decode) — the caller reports those as skipped.
export async function loadCue(cuePath) {
  let bytes;
  try { bytes = await tjs.readFile(cuePath); } catch (e) { return null; }
  const { album, files } = parseCueText(decodeCue(bytes));
  const dir = cuePath.replace(/[\\/][^\\/]*$/, '') || '/';
  const out = [];
  let missing = 0;
  for (const f of files) {
    const audio = f.tracks.filter((t) => t.type === 'AUDIO' && (t.indexes[1] != null || t.indexes[0] != null));
    if (!audio.length) continue;
    const audioPath = await resolveAudio(dir, f.file, cuePath);
    if (!audioPath || !PLAYABLE.test(audioPath)) { missing++; continue; }
    // FLAC's header says how long the file is — that's the last track's end
    const endCap = /\.flac$/i.test(audioPath) ? await flacLength(audioPath) : null;
    const startOf = (t) => (t.indexes[1] != null ? t.indexes[1] : t.indexes[0]);   // 01 = track proper, 00 = pregap
    audio.forEach((t, i) => {
      out.push(mkTrack({
        path: audioPath, no: t.no || i + 1, title: t.title,
        performer: t.performer || album.performer, album: album.title, date: album.date,
        start: startOf(t), end: audio[i + 1] ? startOf(audio[i + 1]) : endCap,
      }));
    });
  }
  return { tracks: out, missing };
}

// ── embedded FLAC CUESHEET → tracks ─────────────────────────────────────────
// No titles live in the block, so the caller passes the file's own tags
// (artist/album) and each track is named "Track NN". A block with fewer than
// two audio tracks is a burning artifact, not an album — ignored.
// 256 KB of head covers STREAMINFO + a fat SEEKTABLE + the sheet itself;
// a file that buries its CUESHEET behind megabytes of art just won't expand.
export async function flacEmbeddedCue(path, fileTags) {
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
  const tags = fileTags || {};
  return {
    missing: 0,
    tracks: audio.map((t, i) => mkTrack({
      path, no: t.no, title: null, performer: tags.artist, album: tags.album, date: tags.date,
      start: startOf(t),
      end: audio[i + 1] ? startOf(audio[i + 1]) : (endSamples != null ? endSamples / sr : null),
    })),
  };
}
