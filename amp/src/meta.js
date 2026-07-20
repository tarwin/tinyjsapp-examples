// meta.js — embedded cover art + text tags, read straight off disk in the
// backend (txiki). amp identifies tracks by filename for the playlist, but the
// big-screen sleeve, the visualizer's album-art mode, and the Info panel all
// want the REAL art and tags baked into the file. So we parse them here.
//
// Four containers: ID3 (mp3), FLAC picture/comment, M4A/MP4 'covr'/ilst, and
// Ogg/Opus (METADATA_BLOCK_PICTURE + Vorbis/Opus comments). The ID3/FLAC/M4A
// byte-walkers are lifted from the sibling `platter` app; the Ogg/Opus reader
// is new (platter never handled Ogg), and it's the one that matters most —
// amp's bundled default track is a .opus.
//
// Everything returns raw image bytes (a Uint8Array subarray) or a plain tag
// dict; the caller turns art into a data: URI (data:, not file://, so the page
// can paint it onto a WebGL/canvas surface without tainting it).

// ── read just the head of the file (art/tags live near the front) ───────────
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

// ── ID3 (mp3) — APIC art + TIT2/TPE1/TALB/TYER/COMM text ─────────────────────
function id3Str(payload) {
  // txiki's TextDecoder only speaks utf-8 — latin1 and utf-16 by hand
  const enc = payload[0], b = payload.subarray(1);
  let s = '';
  try {
    if (enc === 3) s = new TextDecoder().decode(b);
    else if (enc === 1 || enc === 2) {
      let le = enc === 1, o = 0;
      if (b[0] === 0xff && b[1] === 0xfe) { le = true; o = 2; }
      else if (b[0] === 0xfe && b[1] === 0xff) { le = false; o = 2; }
      for (; o + 1 < b.length; o += 2)
        s += String.fromCharCode(le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
    } else for (const c of b) s += String.fromCharCode(c);       // latin1
  } catch (e) { return ''; }
  return s.replace(/\0+$/g, '').trim();
}
function picBody(buf, o, size, ver) {
  const end = o + size;
  const enc = buf[o++];
  if (ver === 2) o += 3;                                          // 'JPG'/'PNG'
  else { while (o < end && buf[o] !== 0) o++; o++; }              // mime\0
  o++;                                                            // picture type
  if (enc === 1 || enc === 2) {                                   // utf-16 desc\0\0
    while (o + 1 < end && (buf[o] !== 0 || buf[o + 1] !== 0)) o += 2;
    o += 2;
  } else { while (o < end && buf[o] !== 0) o++; o++; }
  return o < end ? buf.subarray(o, end) : null;
}
function id3Walk(buf, onFrame) {
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return;   // 'ID3'
  const ver = buf[3];
  const ss = (o) => ((buf[o] & 0x7f) << 21) | ((buf[o + 1] & 0x7f) << 14) | ((buf[o + 2] & 0x7f) << 7) | (buf[o + 3] & 0x7f);
  const tagEnd = Math.min(ss(6) + 10, buf.length);
  let o = 10;
  if (buf[5] & 0x40) o += ver === 4 ? ss(10) : (((buf[10] << 24) | (buf[11] << 16) | (buf[12] << 8) | buf[13]) >>> 0) + 4;
  while (o + 10 < tagEnd) {
    let id, size, hdr;
    if (ver === 2) {
      id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2]);
      if (!/^[A-Z0-9]{3}$/.test(id)) break;
      size = (buf[o + 3] << 16) | (buf[o + 4] << 8) | buf[o + 5];
      hdr = 6;
    } else {
      id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      size = ver === 4 ? ss(o + 4) : (((buf[o + 4] << 24) | (buf[o + 5] << 16) | (buf[o + 6] << 8) | buf[o + 7]) >>> 0);
      hdr = 10;
    }
    if (size <= 0 || o + hdr + size > buf.length) break;
    if (onFrame(id, o + hdr, size, ver) === true) return;         // early-out on art hit
    o += hdr + size;
  }
}
function id3Art(buf) {
  let art = null;
  id3Walk(buf, (id, o, size, ver) => {
    if (id === 'APIC' || id === 'PIC') { art = picBody(buf, o, size, ver); return true; }
  });
  return art;
}
function id3Tags(buf) {
  const got = {};
  id3Walk(buf, (id, o, size) => {
    if (/^(TIT2|TPE1|TPE2|TALB|TYER|TDRC|COMM|TP1|TP2|TAL|TT2)$/.test(id))
      got[id] = id === 'COMM' ? id3Str(buf.subarray(o + 4, o + size)) : id3Str(buf.subarray(o, o + size));
  });
  return {
    title: got.TIT2 || got.TT2,
    artist: got.TPE2 || got.TPE1 || got.TP2 || got.TP1,
    album: got.TALB || got.TAL,
    date: got.TDRC || got.TYER,
    comment: got.COMM,
  };
}

// ── FLAC — PICTURE block art + VORBIS_COMMENT text ──────────────────────────
// The PICTURE block body is byte-identical to what Ogg's METADATA_BLOCK_PICTURE
// base64-decodes to, so flacPicBody() is shared by both.
function flacPicBody(b) {                 // b starts at the u32 BE picture-type
  let p = 0;
  const u32 = () => { const v = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; p += 4; return v; };
  u32();                                  // picture type
  const mimeLen = u32(); p += mimeLen;    // (NOT p += u32(): += evaluates p first)
  const descLen = u32(); p += descLen;
  p += 16;                                // width, height, depth, colors
  const len = u32();
  return p + len <= b.length ? b.subarray(p, p + len) : null;
}
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
function flacArt(buf) {
  let art = null;
  flacBlocks(buf, (type, o, size) => {
    if (type === 6) { art = flacPicBody(buf.subarray(o, o + size)); return true; }
  });
  return art;
}
function flacTags(buf) {
  let dict = null;
  flacBlocks(buf, (type, o, size) => {
    if (type === 4) { dict = vorbisDict(buf, o, o + size); return true; }
  });
  return dict ? normalizeVorbis(dict) : null;
}

// ── Vorbis comments (used by FLAC block AND Ogg/Opus packet) ─────────────────
// [vendor len][vendor][count]([len][KEY=VALUE])*, all lengths u32 LITTLE-endian.
function vorbisDict(buf, o, end) {
  const u32le = () => { const v = (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0; o += 4; return v; };
  const dict = {};
  if (o + 4 > end) return dict;
  const vlen = u32le(); o += vlen;                 // vendor string, skipped
  if (o + 4 > end) return dict;
  const count = u32le();
  const dec = new TextDecoder('utf-8');
  for (let i = 0; i < count && o + 4 <= end; i++) {
    const len = u32le();
    if (o + len > buf.length) break;
    const s = dec.decode(buf.subarray(o, o + len)); o += len;
    const eq = s.indexOf('=');
    if (eq > 0) dict[s.slice(0, eq).toUpperCase()] = s.slice(eq + 1);
  }
  return dict;
}
function normalizeVorbis(d) {
  const link = d.CONTACT || d.WEBSITE || d.URL ||
    ((d.COMMENT || d.DESCRIPTION || '').match(/https?:\/\/\S+/) || [])[0];
  return {
    title: d.TITLE,
    artist: d.ALBUMARTIST || d['ALBUM ARTIST'] || d.ARTIST,
    album: d.ALBUM,
    date: d.DATE || d.YEAR,
    comment: d.COMMENT || d.DESCRIPTION,
    link,
  };
}

// ── M4A / MP4 — 'covr' art + ilst text atoms ────────────────────────────────
function m4aAtom(buf, o, end, want) {     // first `want` child in [o, end)
  while (o + 8 <= end) {
    const size = ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
    const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
    if (size < 8 || o + size > end) return null;
    if (type === want) return [o + 8, o + size];
    o += size;
  }
  return null;
}
function m4aIlst(buf) {
  let span = [0, buf.length];
  for (const name of ['moov', 'udta', 'meta', 'ilst']) {
    span = m4aAtom(buf, span[0], span[1], name);
    if (!span) return null;
    if (name === 'meta') span = [span[0] + 4, span[1]];           // version + flags
  }
  return span;
}
function m4aArt(buf) {
  const ilst = m4aIlst(buf);
  if (!ilst) return null;
  const covr = m4aAtom(buf, ilst[0], ilst[1], 'covr');
  if (!covr) return null;
  const data = m4aAtom(buf, covr[0], covr[1], 'data');
  return data && data[1] - data[0] > 8 ? buf.subarray(data[0] + 8, data[1]) : null;
}
function m4aTags(buf) {
  const ilst = m4aIlst(buf);
  if (!ilst) return null;
  const dec = new TextDecoder('utf-8');
  const text = (name) => {
    const box = m4aAtom(buf, ilst[0], ilst[1], name);
    if (!box) return undefined;
    const d = m4aAtom(buf, box[0], box[1], 'data');
    if (!d || d[1] - d[0] <= 8) return undefined;
    return dec.decode(buf.subarray(d[0] + 8, d[1])).trim();       // type + locale
  };
  return {
    title: text('\xa9nam'),
    artist: text('aART') || text('\xa9ART'),
    album: text('\xa9alb'),
    date: text('\xa9day'),
    comment: text('\xa9cmt'),
  };
}

// ── Ogg / Opus — new. Reassemble packets across pages, find the comment ──────
// header (OpusTags / \x03vorbis), then read Vorbis comments incl. the base64
// METADATA_BLOCK_PICTURE. The comment packet spans several Ogg pages when the
// embedded picture is large, so packets must be stitched from their segments.
function oggCommentPacket(buf) {
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'OggS') return null;
  const segs = [];                        // every segment, in order, across pages
  let o = 0;
  while (o + 27 <= buf.length) {
    if (!(buf[o] === 0x4f && buf[o + 1] === 0x67 && buf[o + 2] === 0x67 && buf[o + 3] === 0x53)) break;  // 'OggS'
    const nseg = buf[o + 26];
    const table = o + 27;
    if (table + nseg > buf.length) break;
    let data = table + nseg;
    for (let i = 0; i < nseg; i++) { segs.push([data, buf[table + i]]); data += buf[table + i]; }
    o = data;
  }
  // stitch segments into packets (a lace < 255 ends a packet)
  const packets = [];
  let cur = [];
  for (const s of segs) { cur.push(s); if (s[1] < 255) { packets.push(cur); cur = []; } }
  for (const pk of packets) {
    const [off] = pk[0];
    const magic = String.fromCharCode.apply(null, buf.subarray(off, Math.min(off + 8, buf.length)));
    if (magic.startsWith('OpusTags') || magic.slice(0, 7) === '\x03vorbis') {
      let total = 0; for (const s of pk) total += s[1];
      const packet = new Uint8Array(total);
      let p = 0; for (const [so, sl] of pk) { packet.set(buf.subarray(so, so + sl), p); p += sl; }
      return { packet, start: magic.startsWith('OpusTags') ? 8 : 7 };
    }
  }
  return null;
}
function oggDict(buf) {
  const c = oggCommentPacket(buf);
  return c ? vorbisDict(c.packet, c.start, c.packet.length) : null;
}
function oggArt(buf) {
  const d = oggDict(buf);
  if (!d) return null;
  if (d.METADATA_BLOCK_PICTURE) {
    try { return flacPicBody(Uint8Array.from(atob(d.METADATA_BLOCK_PICTURE), (ch) => ch.charCodeAt(0))); } catch (e) {}
  }
  if (d.COVERART) {                       // legacy: raw base64 image
    try { return Uint8Array.from(atob(d.COVERART), (ch) => ch.charCodeAt(0)); } catch (e) {}
  }
  return null;
}
function oggTags(buf) { const d = oggDict(buf); return d ? normalizeVorbis(d) : null; }

// ── public: art bytes + normalized tags, dispatched by extension ─────────────
export async function readArt(path) {
  try {
    const lower = path.toLowerCase();
    // ID3/FLAC metadata sit at the front; M4A keeps its atom tree there too for
    // streamable files. Ogg comment+picture are in the first pages. 12 MB is
    // generous cover for a front-loaded picture block in any of them.
    const b = await readHead(path, 12 * 1024 * 1024);
    if (lower.endsWith('.flac')) return flacArt(b);
    if (/\.(m4a|aac|mp4)$/.test(lower)) return m4aArt(b) || id3Art(b);
    if (/\.(opus|ogg|oga)$/.test(lower)) return oggArt(b);
    return id3Art(b) || flacArt(b) || oggArt(b);
  } catch (e) { return null; }
}
export async function readMeta(path) {
  try {
    const b = await readHead(path, 4 * 1024 * 1024);
    const lower = path.toLowerCase();
    let t = null;
    if (lower.endsWith('.flac')) t = flacTags(b);
    else if (/\.(m4a|aac|mp4)$/.test(lower)) t = m4aTags(b) || id3Tags(b);
    else if (/\.(opus|ogg|oga)$/.test(lower)) t = oggTags(b);
    else t = id3Tags(b) || flacTags(b) || oggTags(b);
    t = t || {};
    // a URL sitting in the comment (how mp3/m4a usually carry it) becomes the link
    if (!t.link && t.comment) { const u = t.comment.match(/https?:\/\/\S+/); if (u) t.link = u[0]; }
    return t;
  } catch (e) { return {}; }
}

// ── raw image bytes → data: URI (safe for canvas/WebGL, unlike file://) ──────
export function toDataURI(bytes) {
  const mime = (bytes[0] === 0x89 && bytes[1] === 0x50) ? 'image/png'
    : (bytes[0] === 0x47 && bytes[1] === 0x49) ? 'image/gif'
    : 'image/jpeg';
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return 'data:' + mime + ';base64,' + btoa(bin);
}
