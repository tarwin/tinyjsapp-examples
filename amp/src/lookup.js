// amp — the rescue party: cover art and tags for files that carry none.
//
// Everything here is free and keyless: MusicBrainz (the search index) → Cover
// Art Archive (the actual scans) → iTunes Search → Deezer. It's the same chain
// platter runs, but TRACK-oriented instead of album-oriented, because amp's
// unit is one file dropped on a window, not a scanned folder — so there's an
// extra problem platter never has: an untagged file gives us nothing to search
// WITH, and the filename has to be talked into a query (guessFromPath).
//
// Three rules this module holds to:
//   • Embedded metadata always wins. This is a FALLBACK — main.js only calls
//     in here after meta.js comes back empty, and nothing here ever overwrites
//     a tag the file actually carries.
//   • Every answer is cached to disk, INCLUDING the misses. A file with no
//     tags and no online match must not re-ask MusicBrainz on every launch;
//     that's how you get rate-limited and how you make an offline app feel
//     broken on a plane.
//   • MusicBrainz asks for 1 request/second and a real User-Agent. That's
//     ENFORCED here by a serialized gate, not politely hoped for.
//
// Nothing calls out until the user turns lookups on (off by default — a local
// music player that phones home about every track you play is not the deal).

import { toDataURI } from './meta.js';

let CACHE = null;                 // <support>/artcache — set by init()
let UA_HDR = { 'user-agent': 'amp (tinyjsapp-examples; tarwin@gmail.com)' };

// One small index file rather than a scatter of markers and sidecars: a
// 900-track library of obscure bootlegs costs one json, not 1800 inodes. It
// holds the misses (when we last found nothing, so we can stop asking) and
// where each cached sleeve came from (so the Info panel can still credit the
// source on the second viewing, when the image comes off disk).
const MISS_TTL = 14 * 24 * 3600 * 1000;   // a miss goes stale after a fortnight
let misses = {}, sources = {};
let dirty = false, ready = Promise.resolve();

export function init({ dir, version }) {
  CACHE = dir;
  UA_HDR = { 'user-agent': 'amp/' + (version || '0') + ' (tinyjsapp-examples; tarwin@gmail.com)' };
  ready = (async () => {
    try { await tjs.makeDir(CACHE, { recursive: true }); } catch (e) {}
    try {
      const js = JSON.parse(new TextDecoder().decode(await tjs.readFile(CACHE + '/index.json')));
      const now = Date.now();
      for (const k of Object.keys(js.misses || {})) if (now - js.misses[k] < MISS_TTL) misses[k] = js.misses[k];
      sources = js.sources || {};
    } catch (e) { misses = {}; sources = {}; }
  })();
  return ready;
}

async function saveIndex() {
  if (!dirty || !CACHE) return;
  dirty = false;
  try { await tjs.writeFile(CACHE + '/index.json', new TextEncoder().encode(JSON.stringify({ misses, sources }))); }
  catch (e) {}
}
const markMiss = (key) => { misses[key] = Date.now(); dirty = true; saveIndex(); };
const isMiss = (key) => misses[key] != null && Date.now() - misses[key] < MISS_TTL;

// ── keys ────────────────────────────────────────────────────────────────────
// Deliberately loose: "The Beatles" and "beatles" should share a sleeve, and
// so should "Rubber Soul" and "Rubber Soul (Remastered)" — near enough that an
// album's twelve tracks cost ONE lookup instead of twelve.
const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[\u2018\u2019\u02bc]/g, "'")
  .replace(/\((?:remaster(?:ed)?|deluxe|explicit|bonus|expanded)[^)]*\)/g, ' ')
  .replace(/\b(19|20)\d\d\s+remaster\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const hashStr = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
// art is keyed by ALBUM where we know one (one lookup per record, not per
// track); a loose single falls back to its own title
const artKey = (d) => 'a' + hashStr(norm(d.artist) + '|' + norm(d.album || d.title));
const tagKey = (d) => 't' + hashStr(norm(d.artist) + '|' + norm(d.title) + '|' + norm(d.album));

const exists = async (p) => { try { await tjs.stat(p); return true; } catch (e) { return false; } };

// ── the search chain ────────────────────────────────────────────────────────
// MusicBrainz is the index everything else hangs off; CAA is the only source
// that hands back a real scan of a real pressing rather than a store's
// thumbnail, so it goes first even though it's the slowest.

let mbGate = Promise.resolve();
function politeMB(url) {
  const turn = mbGate.then(async () => {
    const r = await fetch(url, { headers: UA_HDR });
    await new Promise((res) => setTimeout(res, 1100));   // 1 req/sec, their rule
    return r;
  });
  mbGate = turn.then(() => {}, () => {});                // a failure mustn't jam the queue
  return turn;
}

const qEsc = (s) => String(s || '').replace(/["\\]/g, ' ').trim();

// The release index knows about the recordings ON a release, so ONE query
// shape serves both cases: search by album when we have one, by track title
// when all we have is a loose file.
function releaseQuery(d) {
  const bits = [];
  if (d.album) bits.push(`release:"${qEsc(d.album)}"`);
  else if (d.title) bits.push(`recording:"${qEsc(d.title)}"`);
  if (d.artist) bits.push(`artist:"${qEsc(d.artist)}"`);
  return bits.join(' AND ');
}

async function caaFind(d) {
  const q = releaseQuery(d);
  if (!q) return null;
  const r = await politeMB(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(q)}&limit=8&fmt=json`);
  if (!r.ok) return null;
  const js = await r.json();
  // a loose title-only match is far likelier to be a coincidence than an
  // album match, so it has to clear a higher bar before we trust its art
  const floor = d.album ? 85 : 92;
  const rels = (js.releases || []).filter((x) => (x.score || 0) >= floor).slice(0, 4);
  for (const rel of rels) {
    try {
      const cr = await fetch('https://coverartarchive.org/release/' + rel.id, { headers: UA_HDR });
      if (!cr.ok) continue;                    // 404 = that pressing has no scans
      const info = await cr.json();
      const img = (info.images || []).find((i) => i.front || (i.types || []).includes('Front'));
      const url = img && ((img.thumbnails && (img.thumbnails['500'] || img.thumbnails.large)) || img.image);
      if (url) return { url, source: 'caa' };
    } catch (e) {}
  }
  return null;
}

async function itunesArt(d) {
  const term = encodeURIComponent([d.artist, d.album || d.title].filter(Boolean).join(' ').trim());
  if (!term) return null;
  // song results carry their album's artwork, so an album-less track still
  // comes home with the right sleeve
  const entity = d.album ? 'album' : 'song';
  const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=${entity}&limit=3`);
  if (!r.ok) return null;
  const hit = ((await r.json()).results || [])[0];
  return hit && hit.artworkUrl100
    ? { url: hit.artworkUrl100.replace('100x100', '600x600'), source: 'itunes' }
    : null;
}

async function deezerArt(d) {
  let q;
  if (d.album) q = (d.artist ? `artist:"${qEsc(d.artist)}" ` : '') + `album:"${qEsc(d.album)}"`;
  else if (d.title) q = (d.artist ? `artist:"${qEsc(d.artist)}" ` : '') + `track:"${qEsc(d.title)}"`;
  else return null;
  const path = d.album ? 'album' : 'track';
  const r = await fetch(`https://api.deezer.com/search/${path}?q=${encodeURIComponent(q)}&limit=3`);
  if (!r.ok) return null;
  const hit = ((await r.json()).data || [])[0];
  if (!hit) return null;
  const cov = d.album ? hit : hit.album;       // a track hit carries its album
  const url = cov && (cov.cover_xl || cov.cover_big || cov.cover_medium);
  return url ? { url, source: 'deezer' } : null;
}

// ── art: cache → chain → disk ───────────────────────────────────────────────

const jobs = new Map();          // key → in-flight promise (bursts coalesce)

async function readCached(key) {
  const p = CACHE + '/' + key + '.img';
  try {
    const bytes = await tjs.readFile(p);
    // the index remembers WHERE it came from, so a sleeve served off disk is
    // still credited to the archive that had it
    if (bytes && bytes.length > 100) return { uri: toDataURI(bytes), source: sources[key] || 'cache' };
  } catch (e) {}
  return null;
}

async function download(url) {
  const r = await fetch(url, { headers: UA_HDR });
  if (!r.ok) throw new Error('http ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  // stores answer a miss with a 1x1 gif or an error page rather than a 404
  if (buf.length < 800) throw new Error('suspiciously small image');
  return buf;
}

// desc: { artist, album, title } — returns { uri, source } or null.
// No resizing: unlike platter (whose sleeves become WebGL textures at a fixed
// size) amp only ever puts these in an <img>, so the fetched bytes go to disk
// as they arrived and the mac-only sips dependency never appears.
export async function findArt(desc, opts = {}) {
  if (!CACHE) return null;
  await ready;                     // the cache dir has to exist before we write into it
  const d = desc || {};
  if (!d.artist && !d.album && !d.title) return null;
  const key = artKey(d);
  const hit = await readCached(key);
  if (hit) return hit;
  // `force` is the user asking in person (the Info panel's button) — a stale
  // "nothing out there" shouldn't be the answer to that
  if (isMiss(key) && !opts.force) return null;
  if (jobs.has(key)) return jobs.get(key);

  const job = (async () => {
    let found = null;
    for (const step of [caaFind, itunesArt, deezerArt]) {
      try { found = await step(d); } catch (e) { found = null; }
      if (found) break;
    }
    if (!found) { markMiss(key); return null; }
    try {
      const bytes = await download(found.url);
      await tjs.writeFile(CACHE + '/' + key + '.img', bytes);
      sources[key] = found.source; dirty = true; saveIndex();
      return { uri: toDataURI(bytes), source: found.source };
    } catch (e) { markMiss(key); return null; }
  })();
  jobs.set(key, job);
  job.finally(() => { if (jobs.get(key) === job) jobs.delete(key); });
  return job;
}

// ── tags: the same chain, asked for words instead of pictures ───────────────
// MusicBrainz first (it's a catalogue, not a shop — no "Greatest Hits (Live)
// Karaoke Version" noise), iTunes second because it's far more forgiving of a
// sloppy filename-derived query than MB's scored index.

async function mbTags(d) {
  const bits = [];
  if (d.title) bits.push(`recording:"${qEsc(d.title)}"`);
  if (d.artist) bits.push(`artist:"${qEsc(d.artist)}"`);
  if (!bits.length) return null;
  const r = await politeMB(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(bits.join(' AND '))}&limit=5&fmt=json`);
  if (!r.ok) return null;
  const js = await r.json();
  const rec = (js.recordings || []).find((x) => (x.score || 0) >= (d.artist ? 88 : 95));
  if (!rec) return null;
  const credit = (rec['artist-credit'] || [])[0];
  const rel = (rec.releases || [])[0];
  return {
    title: rec.title || undefined,
    artist: (credit && credit.name) || (credit && credit.artist && credit.artist.name) || undefined,
    album: (rel && rel.title) || undefined,
    date: (rel && rel.date) || undefined,
    source: 'musicbrainz',
  };
}

async function itunesTags(d) {
  const term = encodeURIComponent([d.artist, d.title].filter(Boolean).join(' ').trim());
  if (!term) return null;
  const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=3`);
  if (!r.ok) return null;
  const hit = ((await r.json()).results || [])[0];
  if (!hit || !hit.trackName) return null;
  return {
    title: hit.trackName,
    artist: hit.artistName || undefined,
    album: hit.collectionName || undefined,
    date: (hit.releaseDate || '').slice(0, 10) || undefined,
    source: 'itunes',
  };
}

// desc: { artist, title, album } — returns { title, artist, album, date,
// source } or null. Cached (hits AND misses) in the same misses.json / json
// sidecar scheme the art uses.
export async function findTags(desc, opts = {}) {
  if (!CACHE) return null;
  await ready;
  const d = desc || {};
  if (!d.title && !d.artist) return null;
  const key = tagKey(d);
  const p = CACHE + '/' + key + '.json';
  try {
    const js = JSON.parse(new TextDecoder().decode(await tjs.readFile(p)));
    if (js && js.title) return js;
  } catch (e) {}
  if (isMiss(key) && !opts.force) return null;
  if (jobs.has(key)) return jobs.get(key);

  const job = (async () => {
    let found = null;
    for (const step of [mbTags, itunesTags]) {
      try { found = await step(d); } catch (e) { found = null; }
      if (found && found.title) break;
      found = null;
    }
    if (!found) { markMiss(key); return null; }
    try { await tjs.writeFile(p, new TextEncoder().encode(JSON.stringify(found))); } catch (e) {}
    return found;
  })();
  jobs.set(key, job);
  job.finally(() => { if (jobs.get(key) === job) jobs.delete(key); });
  return job;
}

// ── talking a filename into a query ─────────────────────────────────────────
// The weak link in the whole feature, and it knows it: everything it returns
// is marked `weak`, which is why the search floors above are higher when the
// album is missing. Handles the shapes that actually turn up on disk:
//
//   04 - Artist - Title.mp3          NN Title.flac
//   Artist - Album - 04 Title.m4a    Artist - Title (Official Video).opus
//
// with the parent folder read as "Artist - Album" or a bare album name when
// the file itself only offers a title.
const JUNK = /\s*[\(\[](?:official\s*(?:music\s*)?video|official\s*audio|lyrics?(?:\s*video)?|audio|hd|hq|4k|remaster(?:ed)?(?:\s*\d{4})?|explicit|free\s*download)[\)\]]\s*/gi;

function tidy(s) {
  return String(s || '')
    .replace(JUNK, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s*\d{2,3}\s*kbps\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function guessFromPath(path) {
  const segs = String(path || '').split(/[\\/]/);
  const file = segs.pop() || '';
  const folder = segs.pop() || '';
  let base = file.replace(/\.[^.]+$/, '');
  // A leading track number goes — but only when it says so unambiguously: a
  // separator after it ("04 - ", "3. ") or a zero-padded number ("03 "). A
  // bare "99 Problems" or "1979" keeps its number, because guessing wrong
  // there mangles a title that was perfectly good to begin with.
  base = base.replace(/^\s*\d{1,3}\s*[-._)\]]+\s*/, '')
             .replace(/^\s*0\d\s+/, '');
  base = tidy(base);
  if (!base) return null;

  const parts = base.split(/\s+[-–—]\s+/).map(tidy).filter(Boolean);
  let artist, album, title;
  if (parts.length >= 3) {
    // Artist - Album - Title (the trailing pieces rejoin: titles have dashes too)
    artist = parts[0]; album = parts[1];
    title = parts.slice(2).join(' - ').replace(/^\s*\d{1,3}\s+/, '');
  } else if (parts.length === 2) {
    artist = parts[0]; title = parts[1];
  } else {
    title = parts[0];
  }

  // the folder fills whatever the filename didn't say
  const filenameSaidBoth = !!(artist && title);
  const fparts = tidy(folder).split(/\s+[-–—]\s+/).map(tidy).filter(Boolean);
  if (fparts.length >= 2) {
    // "Artist - Album (2001)" — the shape a ripper makes
    if (!artist) artist = fparts[0];
    if (!album) album = fparts.slice(1).join(' - ').replace(/\s*\((?:19|20)\d\d\)\s*$/, '').trim();
  } else if (fparts.length === 1 && !album && !filenameSaidBoth) {
    // A bare folder name is an album only when the file itself didn't already
    // name an artist AND a title: "Artist - Title.mp3" is what a loose
    // download looks like, and a loose download's folder is a junk drawer, not
    // a record. A folder that's plainly just where music lives never counts.
    const f = fparts[0];
    if (f.length > 2 && !/^(music|songs?|audio|downloads?|itunes|media|mp3s?|albums?|new|misc|stuff|tracks?|various)$/i.test(f)) album = f;
  }

  if (!title) return null;
  return { artist: artist || undefined, album: album || undefined, title, weak: true };
}

// The search description for a file: real tags where they exist, the filename
// guess only for what they don't say. A file tagged with just a title still
// gets its artist from the folder — and still counts as partly real.
export function describe(path, tags) {
  const t = tags || {};
  const g = guessFromPath(path) || {};
  const d = {
    artist: t.artist || g.artist,
    album: t.album || g.album,
    title: t.title || g.title,
  };
  d.weak = !(t.artist && (t.album || t.title));
  return (d.artist || d.album || d.title) ? d : null;
}
