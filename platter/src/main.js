// platter — a record player, not a music player.
//
// The backend is the record shop: it scans a music folder into ALBUMS (any
// folder that directly contains audio files is an LP), digs cover art out of
// the folder or the files themselves, and hands the page a crate to browse.
// Everything ritual — sleeves, the platter, the tonearm, sides — lives in the
// frontend. readAccess:"/" means the page streams tracks straight off disk
// via file:// URLs; no audio bytes ever cross the bridge.
//
// Sources are a seam on purpose: 'local' is the only one today, but the
// album shape ({ id, artist, title, tracks[] }) is what a Spotify-Connect or
// Music.app source would also produce — the deck doesn't care who spins it.

const HOME = tjs.env.HOME;
const CACHE = HOME + '/Library/Application Support/art.tarwin.platter/art';

const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|oga|aiff?)$/i;
const ARTFILE = /^(cover|folder|front|album|art|artwork)\.(jpe?g|png|webp)$/i;
const SKIPDIR = /^(\.|__|node_modules$)/;

let musicDir = null;
let byId = new Map();                // id → album, from the last scan
let store = null;

const hashStr = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

async function run(args) {
  const p = tjs.spawn(args, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  return p.wait();
}

// ── the scan ───────────────────────────────────────────────────────────────
// A folder with audio files directly inside it is one LP — but real music
// folders come in layouts, and the scanner reads them like a person would:
//   Music/Artist/Album/tracks        → artist from the tree
//   Music/Artist - Album/tracks      → artist from the folder name
//   Music/Artist/1997 - Album        → year prefixes stripped from titles
//   Music/Album/{CD1,Disc 2}/tracks  → disc folders MERGE into one LP
//   Music/Artist/stray.mp3           → that artist's "Singles"
//   Music/stray.mp3                  → "Loose Records"
// When the folders don't say who the artist is (an album sitting straight in
// the root), the first track's TAGS get the vote (ID3 / FLAC / M4A).

const DISC_RE = /^(cd|disc|disk|dvd|vol(ume)?)[\s._-]*\d+$/i;
const YEAR_RE = /^(\((19|20)\d\d\)|\[(19|20)\d\d\]|(19|20)\d\d)[\s._-]+/;

const natCmp = (a, b) => {
  const ax = a.match(/\d+/), bx = b.match(/\d+/);
  if (ax && bx && ax.index === bx.index) {
    const d = parseInt(ax[0], 10) - parseInt(bx[0], 10);
    if (d) return d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};

const deYear = (s) => s.replace(YEAR_RE, '').trim() || s;
const trackName = (f) => f.replace(AUDIO, '').replace(/^\d+[\s._-]+/, '');

async function readFolder(dir) {
  const f = { tracks: [], subdirs: [], art: null };
  try {
    for await (const e of await tjs.readDir(dir)) {
      if (SKIPDIR.test(e.name)) continue;
      if (e.isDirectory) f.subdirs.push(e.name);
      else if (AUDIO.test(e.name)) f.tracks.push(e.name);
      else if (ARTFILE.test(e.name)) f.art = dir + '/' + e.name;
    }
  } catch (e) { return null; }
  f.tracks.sort(natCmp);
  return f;
}

// who made this? folder shapes first, the files' own tags as tiebreaker
async function albumMeta(dir, root, tracks, hasAlbumSubdirs) {
  const base = dir.split('/').pop();
  const parent = dir.slice(0, dir.lastIndexOf('/'));

  if (dir === root) return { artist: '', title: 'Loose Records' };

  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m && !/^(19|20)\d\d$/.test(m[1]))          // "Artist - Album" (not "1997 - …")
    return { artist: m[1], title: deYear(m[2]) };

  if (parent.length > root.length)               // Artist/Album/tracks
    return { artist: parent.split('/').pop(), title: deYear(base) };

  // a top-level folder: an artist's strays, or an album by persons unknown —
  // ask the first track's tags before shrugging
  const tags = (await readTags(tracks[0].path)) || {};
  if (hasAlbumSubdirs)                           // it has albums below → it's an artist
    return { artist: base, title: tags.album || 'Singles' };
  return { artist: tags.artist || '', title: tags.album || deYear(base) };
}

async function walk(dir, root, out, depth) {
  if (depth > 4 || out.length >= 400) return;
  const f = await readFolder(dir);
  if (!f) return;

  // CD1 / Disc 2 folders are not albums — they're sides of a box
  const discDirs = f.subdirs.filter((n) => DISC_RE.test(n)).sort(natCmp);
  const albumDirs = f.subdirs.filter((n) => !DISC_RE.test(n));
  let tracks = f.tracks.map((n) => ({ path: dir + '/' + n, name: trackName(n) }));
  let art = f.art;
  for (const d of discDirs) {
    const sub = await readFolder(dir + '/' + d);
    if (!sub) continue;
    tracks = tracks.concat(sub.tracks.map((n) => ({ path: dir + '/' + d + '/' + n, name: trackName(n) })));
    if (!art) art = sub.art;
  }

  if (tracks.length) {
    const meta = await albumMeta(dir, root, tracks, albumDirs.length > 0);
    out.push({ id: hashStr(dir), dir, artist: meta.artist, title: meta.title, artSource: art, tracks });
  }
  for (const d of albumDirs) await walk(dir + '/' + d, root, out, depth + 1);
}

async function scan(dir) {
  const out = [];
  await walk(dir, dir, out, 0);
  out.sort((a, b) => natCmp((a.artist + ' ' + a.title).toLowerCase(), (b.artist + ' ' + b.title).toLowerCase()));
  byId = new Map(out.map((a) => [a.id, a]));
  // the page gets the crate without artSource paths — art goes via albumArt
  return { dir, albums: out.map(({ artSource, ...a }) => a) };
}

// ── cover art ──────────────────────────────────────────────────────────────
// Priority: cached thumb → cover.jpg-style folder art → art embedded in the
// first track (ID3 APIC / FLAC picture / M4A covr). Whatever we find gets
// sips'd to a 512px jpeg in the app cache and the page loads it via file://,
// so a 40-album crate costs the bridge 40 short path strings, not megabytes.

function id3Art(buf) {
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null;
  const ver = buf[3];
  const ss = (o) => ((buf[o] & 0x7f) << 21) | ((buf[o + 1] & 0x7f) << 14) | ((buf[o + 2] & 0x7f) << 7) | (buf[o + 3] & 0x7f);
  const tagEnd = Math.min(ss(6) + 10, buf.length);
  let o = 10;
  if (buf[5] & 0x40) o += ver === 4 ? ss(10) : (((buf[10] << 24) | (buf[11] << 16) | (buf[12] << 8) | buf[13]) >>> 0) + 4;
  while (o + 10 < tagEnd) {
    if (ver === 2) {
      const id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2]);
      if (!/^[A-Z0-9]{3}$/.test(id)) return null;
      const size = (buf[o + 3] << 16) | (buf[o + 4] << 8) | buf[o + 5];
      if (id === 'PIC') return picBody(buf, o + 6, size, 2);
      o += 6 + size;
    } else {
      const id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) return null;
      const size = ver === 4 ? ss(o + 4) : (((buf[o + 4] << 24) | (buf[o + 5] << 16) | (buf[o + 6] << 8) | buf[o + 7]) >>> 0);
      if (size <= 0 || o + 10 + size > buf.length) return null;
      if (id === 'APIC') return picBody(buf, o + 10, size, ver);
      o += 10 + size;
    }
  }
  return null;
}
function picBody(buf, o, size, ver) {
  const end = o + size;
  const enc = buf[o++];
  if (ver === 2) o += 3;                                    // 'JPG'/'PNG'
  else { while (o < end && buf[o] !== 0) o++; o++; }        // mime\0
  o++;                                                      // picture type
  if (enc === 1 || enc === 2) {                             // utf-16 desc\0\0
    while (o + 1 < end && (buf[o] !== 0 || buf[o + 1] !== 0)) o += 2;
    o += 2;
  } else { while (o < end && buf[o] !== 0) o++; o++; }
  return o < end ? buf.subarray(o, end) : null;
}

function flacArt(buf) {
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'fLaC') return null;
  let o = 4;
  while (o + 4 <= buf.length) {
    const last = buf[o] & 0x80, type = buf[o] & 0x7f;
    const size = (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
    o += 4;
    if (type === 6) {
      let p = o;
      const u32 = () => { const v = ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0; p += 4; return v; };
      u32();                     // picture type
      const mimeLen = u32(); p += mimeLen;   // (NOT p += u32(): += reads p first)
      const descLen = u32(); p += descLen;
      p += 16;                   // w, h, depth, colors
      const len = u32();
      return p + len <= buf.length ? buf.subarray(p, p + len) : null;
    }
    o += size;
    if (last) break;
  }
  return null;
}

function m4aArt(buf) {
  const atom = (o, end, want) => {                          // first `want` child in [o, end)
    while (o + 8 <= end) {
      const size = ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
      const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
      if (size < 8 || o + size > end) return null;
      if (type === want) return [o + 8, o + size];
      o += size;
    }
    return null;
  };
  let span = [0, buf.length];
  for (const name of ['moov', 'udta', 'meta', 'ilst', 'covr', 'data']) {
    span = atom(span[0], span[1], name);
    if (!span) return null;
    if (name === 'meta') span = [span[0] + 4, span[1]];     // version + flags
  }
  return span[1] - span[0] > 8 ? buf.subarray(span[0] + 8, span[1]) : null;  // type + locale
}

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

async function extractEmbedded(track) {
  try {
    const lower = track.toLowerCase();
    // ID3 and FLAC metadata live at the front; M4A needs the atom tree,
    // which iTunes-style files keep at the front too — 12 MB covers both.
    const b = await readHead(track, 12 * 1024 * 1024);
    if (lower.endsWith('.flac')) return flacArt(b);
    if (/\.(m4a|aac|mp4)$/.test(lower)) return m4aArt(b) || id3Art(b);
    return id3Art(b) || flacArt(b);
  } catch (e) { return null; }
}

// ── text tags (artist / album), same three formats as the art ──────────────

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
    } else for (const c of b) s += String.fromCharCode(c);      // latin1
  } catch (e) { return ''; }
  return s.replace(/\0+$/g, '').trim();
}

function id3Tags(buf) {
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null;
  const ver = buf[3];
  const ss = (o) => ((buf[o] & 0x7f) << 21) | ((buf[o + 1] & 0x7f) << 14) | ((buf[o + 2] & 0x7f) << 7) | (buf[o + 3] & 0x7f);
  const tagEnd = Math.min(ss(6) + 10, buf.length);
  let o = 10;
  if (buf[5] & 0x40) o += ver === 4 ? ss(10) : (((buf[10] << 24) | (buf[11] << 16) | (buf[12] << 8) | buf[13]) >>> 0) + 4;
  const got = {};
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
    if (['TPE1', 'TPE2', 'TALB', 'TP1', 'TP2', 'TAL'].includes(id))
      got[id] = id3Str(buf.subarray(o + hdr, o + hdr + size));
    o += hdr + size;
  }
  const artist = got.TPE2 || got.TP2 || got.TPE1 || got.TP1;   // album artist wins
  const album = got.TALB || got.TAL;
  return artist || album ? { artist, album } : null;
}

function flacTags(buf) {
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'fLaC') return null;
  let o = 4;
  while (o + 4 <= buf.length) {
    const last = buf[o] & 0x80, type = buf[o] & 0x7f;
    const size = (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
    o += 4;
    if (type === 4) {                              // VORBIS_COMMENT: lengths are LE
      let p = o;
      const u32le = () => { const v = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0; p += 4; return v; };
      const vlen = u32le(); p += vlen;
      const count = u32le();
      const got = {};
      const dec = new TextDecoder('utf-8');
      for (let i = 0; i < count && p + 4 <= o + size; i++) {
        const len = u32le();
        if (p + len > buf.length) break;
        const s = dec.decode(buf.subarray(p, p + len)); p += len;
        const eq = s.indexOf('=');
        if (eq > 0) got[s.slice(0, eq).toUpperCase()] = s.slice(eq + 1).trim();
      }
      const artist = got.ALBUMARTIST || got['ALBUM ARTIST'] || got.ARTIST;
      return artist || got.ALBUM ? { artist, album: got.ALBUM } : null;
    }
    o += size;
    if (last) break;
  }
  return null;
}

function m4aTags(buf) {
  const atom = (o, end, want) => {
    while (o + 8 <= end) {
      const size = ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
      const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
      if (size < 8 || o + size > end) return null;
      if (type === want) return [o + 8, o + size];
      o += size;
    }
    return null;
  };
  let span = [0, buf.length];
  for (const name of ['moov', 'udta', 'meta', 'ilst']) {
    span = atom(span[0], span[1], name);
    if (!span) return null;
    if (name === 'meta') span = [span[0] + 4, span[1]];
  }
  const dec = new TextDecoder('utf-8');
  const text = (name) => {
    const box = atom(span[0], span[1], name);
    if (!box) return undefined;
    const d = atom(box[0], box[1], 'data');
    if (!d || d[1] - d[0] <= 8) return undefined;
    return dec.decode(buf.subarray(d[0] + 8, d[1])).trim();   // type + locale
  };
  const artist = text('aART') || text('©ART');
  const album = text('©alb');
  return artist || album ? { artist, album } : null;
}

async function readTags(track) {
  try {
    // text frames sit ahead of the (possibly megabyte) art in practice,
    // but a big early FLAC picture block can push the comment out — 4 MB
    // is cheap insurance for the handful of albums that need this
    const b = await readHead(track, 4 * 1024 * 1024);
    const lower = track.toLowerCase();
    if (lower.endsWith('.flac')) return flacTags(b);
    if (/\.(m4a|aac|mp4)$/.test(lower)) return m4aTags(b) || id3Tags(b);
    return id3Tags(b) || flacTags(b);
  } catch (e) { return null; }
}

const exists = async (p) => { try { return (await tjs.stat(p)).size > 0; } catch (e) { return false; } };

const artJobs = new Map();           // id → promise, so bursts don't re-extract

async function albumArtPath(id) {
  const album = byId.get(id) || spById.get(id);
  if (!album) return null;
  const thumb = CACHE + '/' + id + '.jpg';
  if (await exists(thumb)) return thumb;
  await run(['mkdir', '-p', CACHE]);
  let src = album.artSource;
  if (!src && album.artUrl) {                    // a streaming sleeve: fetch it
    src = CACHE + '/' + id + '.src';
    try { await download(album.artUrl, src); } catch (e) { return null; }
  } else if (!src) {
    const raw = await extractEmbedded(album.tracks[0].path);
    if (!raw) return null;
    src = CACHE + '/' + id + '.raw';
    await tjs.writeFile(src, raw);
  }
  await run(['/usr/bin/sips', '-Z', '512', '-s', 'format', 'jpeg', src, '--out', thumb]);
  if (!album.artSource) { try { await tjs.remove(src); } catch (e) {} }
  return (await exists(thumb)) ? thumb : null;
}

// ── the sleeve hunt: free art APIs for albums whose files carry none ───────
// Chain: MusicBrainz → Cover Art Archive (typed FRONT and BACK images, no
// key) → iTunes Search → Deezer (front only, keyless). MusicBrainz asks for
// 1 request/second and a real User-Agent — politeness is enforced here, not
// hoped for. Everything lands in the same thumb cache the local art uses.

const UA_HDR = { 'user-agent': 'platter/0.1 (tinyjsapp-examples; tarwin@gmail.com)' };
let mbGate = Promise.resolve();
function politeMB(url) {
  const turn = mbGate.then(async () => {
    const r = await fetch(url, { headers: UA_HDR });
    await new Promise((res) => setTimeout(res, 1100));
    return r;
  });
  mbGate = turn.then(() => {}, () => {});
  return turn;
}

async function download(url, dest) {
  const r = await fetch(url, { headers: UA_HDR });
  if (!r.ok) throw new Error('http ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length < 800) throw new Error('suspiciously small file');
  await tjs.writeFile(dest, buf);
  return dest;
}

async function caaFind(artist, title) {
  const q = encodeURIComponent(`release:"${title}"` + (artist ? ` AND artist:"${artist}"` : ''));
  const r = await politeMB(`https://musicbrainz.org/ws/2/release/?query=${q}&limit=8&fmt=json`);
  if (!r.ok) return null;
  const js = await r.json();
  const rels = (js.releases || []).filter((x) => (x.score || 0) >= 85).slice(0, 4);
  for (const rel of rels) {
    try {
      const cr = await fetch('https://coverartarchive.org/release/' + rel.id, { headers: UA_HDR });
      if (!cr.ok) continue;                      // 404 = that pressing has no scans
      const info = await cr.json();
      const pick = (want) => {
        const img = (info.images || []).find((i) => i[want] || (i.types || []).includes(want === 'front' ? 'Front' : 'Back'));
        return img ? ((img.thumbnails && (img.thumbnails['500'] || img.thumbnails.large)) || img.image) : null;
      };
      const front = pick('front'), back = pick('back');
      if (front || back) return { front, back };
    } catch (e) {}
  }
  return null;
}

async function itunesFind(artist, title) {
  const term = encodeURIComponent((artist + ' ' + title).trim());
  const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=3`);
  if (!r.ok) return null;
  const hit = ((await r.json()).results || [])[0];
  return hit && hit.artworkUrl100 ? { front: hit.artworkUrl100.replace('100x100', '600x600') } : null;
}

async function deezerFind(artist, title) {
  const q = encodeURIComponent(artist ? `artist:"${artist}" album:"${title}"` : title);
  const r = await fetch(`https://api.deezer.com/search/album?q=${q}&limit=3`);
  if (!r.ok) return null;
  const hit = ((await r.json()).data || [])[0];
  return hit && (hit.cover_xl || hit.cover_big) ? { front: hit.cover_xl || hit.cover_big } : null;
}

async function fetchThumb(url, dest, tmpSuffix) {
  const raw = CACHE + '/' + tmpSuffix;
  await download(url, raw);
  await run(['/usr/bin/sips', '-Z', '512', '-s', 'format', 'jpeg', raw, '--out', dest]);
  try { await tjs.remove(raw); } catch (e) {}
  return exists(dest);
}

async function findArtFor(album) {
  const id = album.id;
  await run(['mkdir', '-p', CACHE]);
  const thumb = CACHE + '/' + id + '.jpg';
  const backThumb = CACHE + '/' + id + '-back.jpg';
  const artist = (album.artist || '').replace(/"/g, '');
  const title = (album.title || '').replace(/"/g, '');
  const haveFront = await exists(thumb);
  const haveBack = await exists(backThumb);
  if (haveFront && haveBack) return { art: thumb, back: backThumb };

  let urls = null;
  try { urls = await caaFind(artist, title); } catch (e) {}
  if (!haveFront && !(urls && urls.front)) {
    let alt = null;
    try { alt = await itunesFind(artist, title); } catch (e) {}
    if (!alt) { try { alt = await deezerFind(artist, title); } catch (e) {} }
    if (alt) urls = { ...(urls || {}), front: alt.front };
  }
  if (!haveFront && urls && urls.front) { try { await fetchThumb(urls.front, thumb, id + '.dl'); } catch (e) {} }
  if (!haveBack && urls && urls.back) { try { await fetchThumb(urls.back, backThumb, id + '-b.dl'); } catch (e) {} }
  return { art: (await exists(thumb)) ? thumb : null, back: (await exists(backThumb)) ? backThumb : null };
}

// ── spotify connect ────────────────────────────────────────────────────────
// The app is the turntable; Spotify.app (or any Connect device) is the
// amplifier. WKWebView has no Widevine, so audio can never render here —
// instead: OAuth PKCE against the user's own Spotify app (client id only,
// no secret), a loopback callback server on a FIXED port (the redirect URI
// http://127.0.0.1:8898/callback must be registered verbatim in the
// dashboard), then /v1/me/* as a remote control. Premium required for
// playback control; that's Spotify's rule, not ours.

const SP_PORT = 8898;
const SP_REDIRECT = 'http://127.0.0.1:' + SP_PORT + '/callback';
const SP_SCOPES = 'user-library-read user-read-playback-state user-modify-playback-state';
// Tarwin's own Spotify app (PKCE: a client id is not a secret; in dev mode
// only allowlisted accounts can use it anyway). The shop input overrides.
const SP_DEFAULT_CLIENT = '707ee4d233054c2fbc5b91f1eb413651';
const form = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let sp = { clientId: null, refresh: null };
let spAccess = null, spExp = 0, spVerifier = null, spServer = null, spState = null;
let spAlbums = { at: 0, list: null };
let spById = new Map();
let appRef = null;

async function spSaveCfg() { try { await store.set('spotify', sp); } catch (e) {} }

async function spExchange(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form(params),
  });
  const js = await r.json();
  if (!r.ok || js.error) throw new Error(js.error_description || js.error || ('http ' + r.status));
  spAccess = js.access_token;
  spExp = Date.now() + ((js.expires_in || 3600) - 60) * 1000;
  if (js.refresh_token) { sp.refresh = js.refresh_token; await spSaveCfg(); }
}

async function spToken() {
  if (spAccess && Date.now() < spExp) return spAccess;
  if (!sp.refresh) throw new Error('not connected');
  await spExchange({ grant_type: 'refresh_token', refresh_token: sp.refresh, client_id: sp.clientId });
  return spAccess;
}

async function spFetch(path, opts = {}) {
  let tok = await spToken();
  const go = () => fetch('https://api.spotify.com' + path, {
    ...opts,
    headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  let r = await go();
  if (r.status === 401) { spAccess = null; tok = await spToken(); r = await go(); }
  return r;
}

// the loopback port is reachable by ANY local process (and by drive-by web
// requests), so: nothing reflected without escaping, no exchange without the
// state we minted, and a strict CSP on the one page we ever serve
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function spStartServer() {
  if (spServer) return;
  spServer = tjs.serve({
    port: SP_PORT,
    fetch: async (req) => {
      const u = new URL(req.url);
      if (u.pathname !== '/callback') return new Response('platter', { status: 404 });
      const code = u.searchParams.get('code'), err = u.searchParams.get('error');
      const state = u.searchParams.get('state');
      let msg = 'Connected! You can close this tab and go back to Platter.';
      let done = false;
      if (!spState || state !== spState) msg = 'That didn’t come from this Platter session — ignored.';
      else if (err) { msg = 'Spotify said: ' + err; done = true; }
      else {
        done = true;
        try {
          await spExchange({ grant_type: 'authorization_code', code, redirect_uri: SP_REDIRECT, client_id: sp.clientId, code_verifier: spVerifier });
        } catch (e) { msg = 'Token exchange failed: ' + e.message; }
      }
      if (done) {
        spState = null;                              // one shot only
        if (appRef) appRef.push('spotify', { connected: !!sp.refresh, error: err || null });
        setTimeout(() => { try { spServer.close(); } catch (e) {} spServer = null; }, 1000);
      }
      return new Response(
        '<html><body style="font:16px -apple-system;background:#16100a;color:#e8ddc8;display:grid;place-items:center;height:100vh">' +
        '<div style="text-align:center"><h2 style="font:italic 700 28px Palatino,serif">platter</h2><p>' + escHtml(msg) + '</p></div></body></html>',
        { headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } }
      );
    },
  });
}

// ── api ────────────────────────────────────────────────────────────────────

export const api = {
  // page picked (or dropped) a folder — remember it, scan it, hand back the crate
  setLibrary: async ({ dir }) => {
    musicDir = dir;
    try { await store.set('musicDir', dir); } catch (e) {}
    return scan(dir);
  },
  getLibrary: async () => {
    if (!musicDir) return { dir: null, albums: [] };
    return scan(musicDir);
  },
  // → absolute path of a 512px jpeg (page loads it file://), or null
  albumArt: async ({ id }) => {
    if (!artJobs.has(id)) {
      artJobs.set(id, albumArtPath(id).catch(() => null));
      artJobs.get(id).finally(() => artJobs.delete(id));
    }
    return artJobs.get(id);
  },
  // same thumb as a data: URI — the page paints record labels onto WebGL
  // textures, and a file:// image would taint the canvas; data: does not
  albumArtData: async ({ id }) => {
    const p = await api.albumArt({ id });
    if (!p) return null;
    try {
      const bytes = await tjs.readFile(p);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return 'data:image/jpeg;base64,' + btoa(s);
    } catch (e) { return null; }
  },
  // go hunting online (CAA → iTunes → Deezer) — returns thumb paths
  findArt: async ({ id }) => {
    const album = byId.get(id) || spById.get(id);
    if (!album) return { art: null, back: null };
    const key = 'find:' + id;
    if (!artJobs.has(key)) {
      artJobs.set(key, findArtFor(album).catch(() => ({ art: null, back: null })));
      artJobs.get(key).finally(() => artJobs.delete(key));
    }
    return artJobs.get(key);
  },
  // the sleeve's reverse, if a scan has been fetched (file:// for the page)
  albumBack: async ({ id }) => {
    const p = CACHE + '/' + id + '-back.jpg';
    return (await exists(p)) ? p : null;
  },

  // ── spotify ──
  spotifyStatus: () => ({ clientId: sp.clientId || '', connected: !!sp.refresh, redirect: SP_REDIRECT }),
  spotifySetClient: async ({ clientId }) => {
    sp.clientId = (clientId || '').trim() || null;
    await spSaveCfg();
    return true;
  },
  spotifyConnect: async (p) => {
    if (!sp.clientId) throw new Error('paste your Spotify app client id first');
    const v = new Uint8Array(48);
    crypto.getRandomValues(v);
    spVerifier = b64url(v);
    const st = new Uint8Array(24);
    crypto.getRandomValues(st);
    spState = b64url(st);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(spVerifier)));
    spStartServer();
    const url = 'https://accounts.spotify.com/authorize?' + form({
      client_id: sp.clientId, response_type: 'code', redirect_uri: SP_REDIRECT,
      code_challenge_method: 'S256', code_challenge: b64url(digest), scope: SP_SCOPES,
      state: spState,
    });
    if (!p || p.open !== false) await run(['open', url]);
    return { url };
  },
  spotifyDisconnect: async () => {
    sp.refresh = null; spAccess = null;
    spAlbums = { at: 0, list: null };
    spById.clear();
    await spSaveCfg();
    return true;
  },
  // the user's saved albums, shaped exactly like local ones (+ uri/artUrl)
  spotifyAlbums: async () => {
    if (!sp.refresh) return [];
    if (spAlbums.list && Date.now() - spAlbums.at < 10 * 60 * 1000) return spAlbums.list;
    const list = [];
    let next = '/v1/me/albums?limit=50';
    for (let page = 0; page < 4 && next; page++) {
      const r = await spFetch(next);
      if (!r.ok) break;
      const js = await r.json();
      for (const it of js.items || []) {
        const al = it.album || {};
        const a = {
          id: 'sp' + hashStr(al.id || al.uri || Math.random().toString(36)),
          source: 'spotify',
          uri: al.uri,
          artist: (al.artists || []).map((x) => x.name).join(', '),
          title: al.name || '?',
          artUrl: al.images && al.images[0] && al.images[0].url,
          tracks: ((al.tracks && al.tracks.items) || []).map((t) => ({
            name: t.name, duration: (t.duration_ms || 180000) / 1000, uri: t.uri,
          })),
        };
        if (a.tracks.length) { list.push(a); spById.set(a.id, a); }
      }
      next = js.next ? js.next.replace('https://api.spotify.com', '') : null;
    }
    list.sort((a, b) => natCmp((a.artist + ' ' + a.title).toLowerCase(), (b.artist + ' ' + b.title).toLowerCase()));
    spAlbums = { at: Date.now(), list };
    return list;
  },
  spotifyDevices: async () => {
    const r = await spFetch('/v1/me/player/devices');
    if (!r.ok) return [];
    return (((await r.json()).devices) || []).map((d) => ({ id: d.id, name: d.name, type: d.type, active: d.is_active }));
  },
  // A play without a live device 404s ("no active device"). So: resolve a
  // real device first — active one, else this computer, else anything —
  // and if the house has NO amplifier at all, wake Spotify.app ourselves
  // and wait for it to show up on the network.
  spotifyPlay: async ({ uri, index = 0, positionMs = 0, deviceId }) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const findDevice = async (want) => {
      const r = await spFetch('/v1/me/player/devices');
      const devs = r.ok ? (((await r.json()).devices) || []) : [];
      if (want) { const w = devs.find((d) => d.id === want); if (w) return w.id; }
      const pick = devs.find((d) => d.is_active) || devs.find((d) => d.type === 'Computer') || devs[0];
      return pick ? pick.id : null;
    };
    let dev = await findDevice(deviceId);
    if (!dev) {
      if (appRef) appRef.push('hint', { text: 'waking the amplifier…', ms: 9000 });
      await run(['open', '-g', '-a', 'Spotify']);
      for (let i = 0; i < 14 && !dev; i++) { await sleep(800); dev = await findDevice(deviceId); }
    }
    if (!dev) throw new Error('no Spotify device found — open Spotify (logged in) and try again');
    const doPlay = () => spFetch('/v1/me/player/play?device_id=' + encodeURIComponent(dev), {
      method: 'PUT',
      body: JSON.stringify({ context_uri: uri, offset: { position: index }, position_ms: Math.max(0, Math.round(positionMs)) }),
    });
    let r = await doPlay();
    if (r.status === 404 || r.status === 502) { await sleep(900); r = await doPlay(); }   // device still waking
    if (!r.ok && r.status !== 204) {
      let detail = '';
      try { detail = (await r.json()).error?.message || ''; } catch (e) {}
      throw new Error('play failed (' + r.status + (detail ? ': ' + detail : '') + ')' +
        (r.status === 403 ? ' — playback control needs Spotify Premium' : ''));
    }
    return true;
  },
  // Pause is the RITUAL's whole enforcement arm — it must not fail silently.
  // Bare /pause targets the "active device", which Spotify sometimes loses
  // track of even mid-sound; retry against the device we can actually see,
  // and as a last resort transfer playback there with play:false.
  spotifyPause: async () => {
    try {
      let r = await spFetch('/v1/me/player/pause', { method: 'PUT' });
      if (!r.ok && r.status !== 204) {
        const d = await spFetch('/v1/me/player/devices');
        const devs = d.ok ? (((await d.json()).devices) || []) : [];
        const pick = devs.find((x) => x.is_active) || devs.find((x) => x.type === 'Computer') || devs[0];
        if (pick) {
          r = await spFetch('/v1/me/player/pause?device_id=' + encodeURIComponent(pick.id), { method: 'PUT' });
          if (!r.ok && r.status !== 204)
            r = await spFetch('/v1/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [pick.id], play: false }) });
        }
      }
      if (!r.ok && r.status !== 204) {
        let detail = '';
        try { detail = (await r.json()).error?.message || ''; } catch (e) {}
        console.log('[spotify] pause failed', r.status, detail);
        if (appRef) appRef.push('hint', { text: 'the amplifier ignored the pause (' + r.status + (detail ? ': ' + detail : '') + ')', ms: 6000 });
        return false;
      }
    } catch (e) { console.log('[spotify] pause error', e && e.message); }
    return true;
  },
  spotifySeek: async ({ positionMs }) => {
    await spFetch('/v1/me/player/seek?position_ms=' + Math.max(0, Math.round(positionMs)), { method: 'PUT' });
    return true;
  },
  spotifyState: async () => {
    try {
      const r = await spFetch('/v1/me/player');
      if (r.status === 204 || !r.ok) return null;
      const js = await r.json();
      return {
        playing: !!js.is_playing,
        progressMs: js.progress_ms || 0,
        trackUri: js.item && js.item.uri,
        contextUri: js.context && js.context.uri,
        device: js.device && js.device.name,
      };
    } catch (e) { return null; }
  },
};

export function init(app) {
  store = app.store;
  appRef = app;
  // best-effort: if the process is told to die while the amplifier plays,
  // fire the pause on the way down (no await — whatever lands, lands)
  const spPanic = () => { try { if (sp.refresh) api.spotifyPause(); } catch (e) {} };
  try { tjs.addSignalListener('SIGTERM', spPanic); tjs.addSignalListener('SIGINT', spPanic); } catch (e) {}
  app.setMenu([{
    title: 'Records',
    items: [
      { id: 'choose', label: 'Choose Music Folder…', key: 'o' },
      { id: 'rescan', label: 'Rescan', key: 'r' },
      { id: 'sources', label: 'Sources…', key: ',' },
      { id: 'updates', label: 'Check for Updates…' },
      { separator: true },
      { id: 'fullscreen', label: 'Toggle Full Screen', key: 'f' },
    ],
  }]);
  (async () => {
    try { musicDir = (await store.get('musicDir')) || null; } catch (e) {}
    try { sp = { ...sp, ...((await store.get('spotify')) || {}) }; } catch (e) {}
    if (!sp.clientId) sp.clientId = SP_DEFAULT_CLIENT;
    app.push('boot', { dir: musicDir });
  })();
}

export function onMenu(id, app) {
  app.push('menu', { id });          // the page owns the pickers and the window
}
