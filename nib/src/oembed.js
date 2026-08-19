// oEmbed, answered from the backend — the page can't ask the providers
// itself (those endpoints rarely send CORS headers), and the backend's fetch
// has no such rule. What goes back to the page is deliberately NOT the
// provider's HTML: the policy is IFRAMES ONLY. A response whose embed is a
// plain <iframe> (YouTube, Vimeo, Spotify, Figma, CodePen…) comes back as
// that iframe's src for the page to build its own element around; a response
// that needs the provider's script to run (Twitter, TikTok, Reddit) comes
// back as a card — title, author, provider — because third-party script in
// the preview is a price no embed is worth.
//
// Cached by URL for the session: every keystroke re-renders the preview, and
// the provider should hear about it once.

const PROVIDERS = [
  { hosts: ['youtube.com', 'youtu.be'], endpoint: 'https://www.youtube.com/oembed' },
  { hosts: ['vimeo.com'], endpoint: 'https://vimeo.com/api/oembed.json' },
  { hosts: ['dailymotion.com'], endpoint: 'https://www.dailymotion.com/services/oembed' },
  { hosts: ['ted.com'], endpoint: 'https://www.ted.com/services/v1/oembed.json' },
  { hosts: ['streamable.com'], endpoint: 'https://api.streamable.com/oembed.json' },
  { hosts: ['soundcloud.com'], endpoint: 'https://soundcloud.com/oembed' },
  { hosts: ['spotify.com', 'open.spotify.com'], endpoint: 'https://open.spotify.com/oembed' },
  { hosts: ['flickr.com', 'flic.kr'], endpoint: 'https://www.flickr.com/services/oembed/' },
  { hosts: ['deviantart.com', 'fav.me'], endpoint: 'https://backend.deviantart.com/oembed' },
  { hosts: ['giphy.com', 'gph.is'], endpoint: 'https://giphy.com/services/oembed' },
  { hosts: ['figma.com'], endpoint: 'https://www.figma.com/api/oembed' },
  { hosts: ['twitter.com', 'x.com'], endpoint: 'https://publish.twitter.com/oembed' },
  { hosts: ['reddit.com'], endpoint: 'https://www.reddit.com/oembed' },
  { hosts: ['tiktok.com'], endpoint: 'https://www.tiktok.com/oembed' },
  { hosts: ['slideshare.net'], endpoint: 'https://www.slideshare.net/api/oembed/2' },
  { hosts: ['issuu.com'], endpoint: 'https://issuu.com/oembed_wp' },
  { hosts: ['speakerdeck.com'], endpoint: 'https://speakerdeck.com/oembed.json' },
  { hosts: ['codepen.io'], endpoint: 'https://codepen.io/api/oembed' },
  { hosts: ['kickstarter.com'], endpoint: 'https://www.kickstarter.com/services/oembed' },
];

const cache = new Map();               // url -> the answer the page got

function providerFor(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, ''); }
  catch { return null; }
  return PROVIDERS.find((p) => p.hosts.some((h) =>
    host === h || host.endsWith('.' + h))) || null;
}

// The iframe src out of a provider's html — and null the moment a <script>
// appears, which is the whole policy in one line.
function iframeSrcOf(html) {
  if (!html || /<script\b/i.test(html)) return null;
  const m = /<iframe\b[^>]*\bsrc\s*=\s*"([^"]+)"/i.exec(html);
  if (!m) return null;
  const src = m[1].replace(/&amp;/g, '&');
  return /^https:\/\//i.test(src) ? src : null;
}

export async function oembedGet(url) {
  if (cache.has(url)) return cache.get(url);
  const answer = await lookup(url).catch((e) => ({ error: e.message || String(e) }));
  cache.set(url, answer);
  return answer;
}

async function lookup(url) {
  const provider = providerFor(url);
  if (!provider) return { error: 'no oEmbed provider for this site' };
  const api = new URL(provider.endpoint);
  api.searchParams.set('format', 'json');
  api.searchParams.set('url', url);

  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('the provider took too long')), 10000));
  const res = await Promise.race([
    fetch(api.toString(), { headers: { Accept: 'application/json' } }), timeout]);
  if (!res.ok) return { error: 'the provider said ' + res.status };
  const data = await res.json();
  if (!data || typeof data !== 'object') return { error: 'not an oEmbed answer' };

  // Vimeo's player chrome is asked off, the way the reference site does it.
  if (data.html && /vimeo\.com/.test(data.html)) {
    const m = data.html.match(/src="(.*?)"/);
    if (m) {
      try {
        const u = new URL(m[1].replace(/&amp;/g, '&'));
        u.searchParams.set('portrait', '0');
        u.searchParams.set('byline', '0');
        u.searchParams.set('title', '0');
        data.html = data.html.replace(m[1], u.toString());
      } catch { /* the original stands */ }
    }
  }

  const meta = {
    title: str(data.title), author: str(data.author_name),
    provider: str(data.provider_name),
  };
  const src = iframeSrcOf(data.html);
  if (src) {
    return { iframe: src, width: num(data.width), height: num(data.height), ...meta };
  }
  if (data.type === 'photo' && /^https:\/\//i.test(data.url || '')) {
    return { image: data.url, ...meta };
  }
  // script-dependent or bare-link embeds: the card is the honest answer
  return { card: true, thumb: /^https:\/\//i.test(data.thumbnail_url || '') ? data.thumbnail_url : null, ...meta };
}

const str = (v) => (typeof v === 'string' ? v.slice(0, 300) : null);
const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
