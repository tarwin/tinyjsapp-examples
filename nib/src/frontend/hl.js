// Colour for the source pane. A textarea can't paint its own text, so the
// editor is really two layers: this backdrop, one <div> per source line, and
// a transparent textarea sitting exactly on top of it. Everything therefore
// has to wrap identically — same font, padding and width — which is why the
// two share a rule in doc.css.
//
// One <div> per line also gives doc.js somewhere to put the band that marks
// where the preview's cursor is, and an easy offsetTop for any line number.
//
// Same escaping discipline as md.js: nothing reaches innerHTML unescaped.

(() => {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ESC[c]);
  const span = (cls, s) => `<span class="${cls}">${esc(s)}</span>`;
  const attr = (s) => esc(s).replace(/"/g, '&quot;');
  // A whole link, wrapped: the backdrop is the only place the source text has
  // real boxes (the textarea over it is transparent), so this is what doc.js
  // hit-tests to put a hand cursor under an ⌥-hover and to know what an
  // ⌥-click landed on. The target rides along in the attribute already parsed.
  const link = (href, inner) => `<span class="tk-a" data-href="${attr(href)}">${inner}</span>`;
  // What was written between the parens, as a path: <brackets> are a wrapper
  // (and everything inside is the path, spaces included), while a bare target
  // ends at the first space — what follows it is a "title".
  const target = (u) => (u.startsWith('<') && u.endsWith('>')
    ? u.slice(1, -1) : u.trim().split(/\s+/)[0]);

  // --------------------------------------------------------------- inline

  function inline(raw) {
    const stash = [];
    const keep = (html) => '\uE000' + (stash.push(html) - 1) + '\uE001';
    let s = String(raw);

    s = s.replace(/(`+)([^`]*)\1/g, (m) => keep(span('tk-code', m)));
    s = s.replace(/\\[\\`*_{}[\]()#+\-.!~|>=]/g, (m) => keep(span('tk-esc', m)));

    // [^id]: a footnote definition — the marker dims, the definition is
    // ordinary prose, NOT a url. Before the reference-definition rule below,
    // which would otherwise paint the first word as a link target.
    s = s.replace(/^( {0,3}\[\^[^\]\s]+\]:)/, (m) => keep(span('tk-p', m)));
    // …and inline [^id] references
    s = s.replace(/\[\^[^\]\s]+\](?!:)/g, (m) => keep(span('tk-p', m)));

    // [id]: target — the reference definition, which the renderer doesn't
    // support but a rename still re-aims, so it may as well be followable.
    // First, before the url rules below have stashed anything inside it.
    s = s.replace(/^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^<>\n]*>|\S+)/, (_, head, u) =>
      keep(span('tk-p', head) + link(target(u), span('tk-url', u))));

    // images and links: brackets dim, label plain, url tinted. The target is
    // either bare or in <angle brackets> — the second is how a path with
    // spaces is written, and matching only the first would colour half of it.
    s = s.replace(/(!?)\[([^\]\n]*)\]\((<[^<>\n]*>|[^)\n]*)\)/g, (_, bang, label, url) =>
      keep(link(target(url),
        span('tk-p', bang + '[') + span(bang ? 'tk-alt' : 'tk-label', label)
        + span('tk-p', '](') + span('tk-url', url) + span('tk-p', ')'))));

    s = s.replace(/<((?:https?|mailto):[^\s<>]+)>/g, (m, u) => keep(link(u, span('tk-url', m))));
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>]+)/g, (_, pre, u) =>
      pre + keep(link(u, span('tk-url', u))));
    s = s.replace(/<\/?[A-Za-z][^<>\n]*>/g, (m) => keep(span('tk-html', m)));

    for (const [re, cls] of [
      [/\*\*\*([^*\n]+)\*\*\*/g, 'tk-bi'], [/\*\*([^*\n]+)\*\*/g, 'tk-b'],
      [/__([^_\n]+)__/g, 'tk-b'], [/~~([^~\n]+)~~/g, 'tk-s'],
      [/==([^=\n]+)==/g, 'tk-mark'], [/\*([^*\n]+)\*/g, 'tk-i'],
    ]) {
      s = s.replace(re, (m, inner) => {
        const mark = (m.length - inner.length) / 2;
        return keep(span('tk-p', m.slice(0, mark)) + span(cls, inner) + span('tk-p', m.slice(0, mark)));
      });
    }

    s = esc(s);
    while (/\uE000/.test(s)) s = s.replace(/\uE000(\d+)\uE001/g, (_, n) => stash[+n]);
    return s;
  }

  // ---------------------------------------------------------------- lines

  const FENCE = /^\s*(`{3,}|~{3,})/;
  const CB = /^ {0,3}(:{3,})\s*([A-Za-z][\w-]*)?(.*)$/;

  function lineHtml(raw, state) {
    if (state.fm) {                                    // YAML front-matter
      if (raw === '---') { state.fm = false; return span('tk-fence', raw); }
      const kv = raw.match(/^([\w.-]+)(\s*:)([\s\S]*)$/);
      return kv ? span('tk-key', kv[1]) + span('tk-p', kv[2]) + esc(kv[3]) : esc(raw);
    }
    if (state.fence) {
      if (FENCE.test(raw) && raw.trim().replace(/[`~]/g, '') === '') {
        state.fence = false;
        return span('tk-fence', raw);
      }
      return span('tk-code', raw);
    }
    const f = raw.match(FENCE);
    if (f) {
      state.fence = true;
      const rest = raw.slice(raw.indexOf(f[1]) + f[1].length);
      return span('tk-fence', raw.slice(0, raw.indexOf(f[1]) + f[1].length)) + span('tk-lang', rest);
    }

    const cb = raw.match(CB);
    if (cb) {
      return span('tk-p', cb[1]) + (cb[2] ? span('tk-cbtype', ' ' + cb[2]) : '')
           + (cb[3] ? span('tk-cbtitle', cb[3]) : '');
    }
    if (/^==\s+\S/.test(raw)) {                        // a tab title
      return span('tk-p', '==') + span('tk-cbtype', raw.slice(2));
    }
    if (/^ {0,3}([-*_])( *\1){2,} *$/.test(raw)) return span('tk-hr', raw);
    // page breaks (\newpage or <!-- pagebreak -->) dress like a rule
    if (/^ {0,3}(?:\\(?:newpage|pagebreak)|<!--\s*(?:page[-_ ]?break|newpage)\s*-->)\s*$/i.test(raw)) {
      return span('tk-hr', raw);
    }

    const h = raw.match(/^(\s*#{1,6}\s+)(.*)$/);
    if (h) return span('tk-hm', h[1]) + `<span class="tk-h">${inline(h[2])}</span>`;

    const q = raw.match(/^(\s*(?:>\s?)+)(.*)$/);
    if (q) return span('tk-qm', q[1]) + `<span class="tk-q">${inline(q[2])}</span>`;

    const li = raw.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/);
    if (li) {
      return esc(li[1]) + span('tk-lm', li[2]) + esc(li[3])
           + (li[4] ? span(/[xX]/.test(li[4]) ? 'tk-done' : 'tk-task', li[4]) : '')
           + inline(li[5]);
    }
    if (/^\s*\|/.test(raw) || /^\s*:?-{2,}:?\s*\|/.test(raw)) {
      return inline(raw).replace(/\|/g, '<span class="tk-p">|</span>');
    }
    return inline(raw);
  }

  // A space keeps an empty line's box the height of a full one, so the
  // backdrop and the textarea stay in step all the way down.
  window.highlightSource = (text) => {
    const state = { fence: false, fm: String(text).startsWith('---\n') };
    return String(text).split('\n')
      .map((l, i) => {
        if (state.fm && i === 0) return '<div class="ln">' + span('tk-fence', l) + '</div>';
        return '<div class="ln">' + (l ? lineHtml(l, state) : ' ') + '</div>';
      })
      .join('');
  };
})();
