// amp — what's actually playing on the radio.
//
// A station's <audio> element knows the URL and nothing else: WebKit doesn't
// surface Shoutcast/Icecast metadata, so until now the LCD could only say the
// station's NAME. The track titles are in there though — interleaved into the
// audio bytes themselves, which is why no media element ever hands them over.
//
// The protocol, such as it is: ask with `Icy-MetaData: 1`, and a station that
// speaks it answers with an `icy-metaint: N` header meaning "every N bytes of
// audio, I splice in a metadata block". The block is one length byte (in
// 16-byte units, so 0 = nothing new this interval) followed by that many bytes
// of `StreamTitle='Artist - Title';StreamUrl='…';` padded with NULs.
//
// So this opens a SECOND, short-lived connection to the station, reads far
// enough to catch one non-empty block (a second or so of audio at 128kbps),
// and hangs up. The connection playing the music is never touched.
//
// It is entirely normal for this to come back null: plenty of stations send no
// metadata at all, and HLS ones can't — callers treat that as "no title", not
// as an error.

const MAX_BLOCKS = 6;              // empty blocks to sit through before giving up
const DEFAULT_TIMEOUT = 9000;

let UA = 'amp (tinyjsapp-examples)';
export function init({ version }) { UA = 'amp/' + (version || '0') + ' (tinyjsapp-examples)'; }

// "Artist - Title" is the overwhelming convention, but plenty of stations send
// a bare title, and a few send "Title - Artist". We only split on the first
// separator and never guess at the order — the caller shows artist + title if
// we found two halves and just the line if we didn't.
export function parseStreamTitle(raw) {
  const s = String(raw || '').replace(/\0+$/, '').trim();
  if (!s) return null;
  const m = s.split(/\s+[-–—]\s+/);
  if (m.length >= 2) {
    const artist = m[0].trim();
    const title = m.slice(1).join(' - ').trim();
    if (artist && title) return { artist, title, raw: s };
  }
  return { artist: null, title: s, raw: s };
}

function extract(text) {
  // titles legitimately contain apostrophes, so prefer the greedy-to-`';`
  // form and only fall back to the naive one
  const m = text.match(/StreamTitle='([\s\S]*?)';/) || text.match(/StreamTitle='([^']*)'/);
  return m ? parseStreamTitle(m[1]) : null;
}

const inflight = new Map();        // url → promise (a poll tick mustn't stack up)

// → { artist, title, raw } | null
export function nowPlaying(url, opts = {}) {
  if (!/^https?:/i.test(url || '')) return Promise.resolve(null);
  // HLS carries its metadata in the playlist/ID3 frames, not as ICY — asking
  // just downloads a .m3u8 and wastes everyone's time
  if (/\.m3u8(\?|$)/i.test(url)) return Promise.resolve(null);
  if (inflight.has(url)) return inflight.get(url);
  const job = probe(url, opts).catch(() => null);
  inflight.set(url, job);
  job.finally(() => { if (inflight.get(url) === job) inflight.delete(url); });
  return job;
}

async function probe(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, opts.timeoutMs || DEFAULT_TIMEOUT);
  let reader = null;
  try {
    const r = await fetch(url, {
      headers: { 'Icy-MetaData': '1', 'user-agent': UA, accept: '*/*' },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const metaint = parseInt(r.headers.get('icy-metaint') || '', 10);
    if (!Number.isFinite(metaint) || metaint <= 0 || metaint > 1 << 20) return null;
    if (!r.body || !r.body.getReader) return null;   // no streaming body: nothing to read
    reader = r.body.getReader();

    // walk the interleaved stream: `remain` audio bytes, then a length byte,
    // then that many metadata bytes
    let remain = metaint, need = -1, meta = null, mpos = 0, blocks = 0;
    while (blocks < MAX_BLOCKS) {
      const { value, done } = await reader.read();
      if (done || !value || !value.length) break;
      let i = 0;
      while (i < value.length) {
        if (remain > 0) {                            // audio — skip it
          const n = Math.min(remain, value.length - i);
          i += n; remain -= n;
          continue;
        }
        if (need < 0) {                              // the length byte
          need = value[i++] * 16;
          blocks++;
          if (need === 0) { remain = metaint; need = -1; continue; }   // nothing new
          meta = new Uint8Array(need); mpos = 0;
          continue;
        }
        const n = Math.min(need - mpos, value.length - i);
        meta.set(value.subarray(i, i + n), mpos);
        mpos += n; i += n;
        if (mpos === need) {
          const got = extract(new TextDecoder('utf-8', { fatal: false }).decode(meta));
          if (got) return got;
          remain = metaint; need = -1; meta = null;  // a block with no title in it
        }
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
    // hang up hard — this is an endless stream and we only wanted a sip of it
    try { if (reader) await reader.cancel(); } catch (e) {}
    try { ctrl.abort(); } catch (e) {}
  }
}
