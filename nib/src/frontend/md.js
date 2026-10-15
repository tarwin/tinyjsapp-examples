// A small hand-rolled Markdown renderer — zero dependencies, like every
// plain-JS example in this repo. It covers the everyday set: ATX headings
// (with anchor ids), emphasis, code spans and fences, links, images, lists
// (nested, with clickable task boxes), blockquotes, tables, and rules — plus
// one extension, `::: note` fenced containers (callouts / <details>), and
// page breaks: `\newpage` or `<!-- pagebreak -->` alone on a line (both are
// invisible prose to other renderers), a faint mark here, a new page on paper.
//
// Two rules matter more than coverage:
//   1. EVERYTHING is escaped. Raw HTML in the source is shown, not executed —
//      this page holds an RPC channel with full system access, so a document
//      must never become markup. (The HTML flavor option doesn't bend this:
//      it rebuilds an allowlisted subset tag by tag — see "raw HTML" below.)
//   2. URLs are vetted. http(s)/mailto/# pass through; unknown schemes
//      (javascript: and friends) don't. Relative image paths get data-src
//      and are resolved by the backend into data: URIs.

(() => {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

  // Vet what a browser would actually navigate to, and hand back only that:
  // the URL parser drops tabs and newlines ANYWHERE and C0 controls / spaces
  // at either end, so "jav<TAB>ascript:" (or &#9; in an HTML attribute, or a
  // leading \x01) IS javascript: — checking the raw string let it through.
  // Any other control character is refused outright. `link` is for an href:
  // a data: URL is fine for a picture but never something to navigate to.
  function safeUrl(u, link) {
    const t = String(u).replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
    if (/[\u0000-\u001f\u007f]/.test(t)) return null;
    if (/^data:/i.test(t)) return !link && /^data:image\//i.test(t) ? t : null;
    if (/^(https?:|mailto:|#)/i.test(t)) return t;
    if (/^[a-zA-Z][\w+.-]*:/.test(t)) return null;      // javascript: etc.
    return t;                                            // relative / plain path
  }

  // --------------------------------------------------------------- raw HTML
  //
  // Preview ▸ Markdown Flavor ▸ HTML renders the subset GitHub does — and
  // rule 1 above still holds, because the author's HTML is never passed
  // through. Every tag is parsed and WRITTEN AFRESH from an allowlist: the
  // tag, then only the attributes below, each value checked and escaped.
  // No on*, class, id or data-* ever survives, and style= keeps layout
  // properties only (cleanStyle), so a document can't script the page,
  // restyle it, or pose as one of Nib's own islands (a forged data-src
  // would be read by the backend). A tag off the list stays
  // text, exactly as it always did. Comments are hidden.
  //
  // Where HTML stands as a BLOCK, the whole region — from its opening tag to
  // the blank line after its matching close, Markdown in between included
  // (`<div align="center">`, blank, `# Title`, blank, `</div>`) — is one
  // island: rendered, uneditable in the preview, its source riding in
  // data-text so Live mode hands it back byte-for-byte. Inline tags (<kbd>,
  // <sub>, <br>, <img width>) render in place inside an ordinary paragraph
  // and remember how they were written (data-h) for the same round trip.
  const INLINE_TAGS = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'del',
    'dfn', 'em', 'i', 'img', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span',
    'strike', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr']);
  const BLOCK_TAGS = new Set(['div', 'p', 'center', 'details', 'summary', 'picture', 'source',
    'figure', 'figcaption', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote',
    'pre', 'hr', 'section', 'article', 'header', 'footer', 'aside', 'nav']);
  const VOID = new Set(['br', 'hr', 'img', 'source', 'wbr']);
  // the tags whose close is never optional — what a region's depth counts.
  // <p>, <li>, <td> and friends may legally be left open, so they can't.
  const DEPTH_TAGS = new Set(['div', 'center', 'details', 'picture', 'figure', 'table', 'ul',
    'ol', 'dl', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'aside', 'nav']);
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
  const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const HTML_OPEN = /^ {0,3}<\/?([a-zA-Z][a-zA-Z0-9]*)(?=[\s/>]|$)/;
  const COMMENT_OPEN = /^ {0,3}<!--/;
  const htmlStart = (l) => {
    if (!EXT.html) return false;
    if (COMMENT_OPEN.test(l)) return true;
    const m = l.match(HTML_OPEN);
    return !!m && BLOCK_TAGS.has(m[1].toLowerCase());
  };

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const unent = (v) => v.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  });
  // HTML's own text keeps its entities (&nbsp; &copy; &#8594;); a bare & or
  // < is escaped like everywhere else
  const escHtmlText = (s) => String(s)
    .replace(/&(?!(?:#x[\da-f]+|#\d+|[a-z][a-z\d]*);)/gi, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const ONE_OF = (re) => (v) => (re.test(v) ? v.toLowerCase() : null);
  const SIZE = (v) => (/^\d+(?:\.\d+)?(?:%|px)?$/.test(v) ? v : null);
  const INT = (v) => (/^-?\d+$/.test(v) ? v : null);
  const ANY = (v) => v;
  // style= keeps LAYOUT only — grid, flex, spacing, alignment, sizes — so
  // a README's two-column grid of cards still lays out. Nothing that could
  // lift content out of the preview (position, z-index, transform, negative
  // margins), restyle Nib (colours, fonts) or load anything (url(), image-
  // set, @import): a declaration off the list is dropped, the rest kept.
  const CSS_PROPS = new Set(['display', 'gap', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow',
    'grid-auto-columns', 'grid-auto-rows', 'grid-column', 'grid-row', 'grid-area',
    'flex', 'flex-direction', 'flex-wrap', 'flex-flow', 'flex-grow', 'flex-shrink',
    'flex-basis', 'order', 'align-items', 'align-content', 'align-self', 'justify-content',
    'justify-items', 'justify-self', 'place-items', 'place-content', 'place-self',
    'text-align', 'vertical-align', 'white-space', 'float', 'clear', 'object-fit',
    'aspect-ratio', 'list-style-type',
    'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'margin-inline', 'margin-block',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'padding-inline', 'padding-block']);
  const CSS_BAD = /url\s*\(|image-set|expression|var\s*\(|env\s*\(|attr\s*\(|javascript:|[\\<>{}@"'`]/i;
  const DISPLAY_OK = /^(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|none|flow-root|table|table-row|table-cell)$/i;
  function cleanStyle(v) {
    const out = [];
    for (const decl of v.split(';')) {
      const c = decl.indexOf(':');
      if (c < 0) continue;
      const prop = decl.slice(0, c).trim().toLowerCase();
      const val = decl.slice(c + 1).trim().replace(/\s*!important$/i, '');
      if (!CSS_PROPS.has(prop) || !val || val.length > 200 || CSS_BAD.test(val)) continue;
      if (prop === 'display' && !DISPLAY_OK.test(val)) continue;
      if (prop.startsWith('margin') && /(?:^|[\s(,])-/.test(val)) continue;
      out.push(prop + ': ' + val);
    }
    return out.length ? out.join('; ') : null;
  }
  const ATTRS_ALL = {
    style: cleanStyle,
    align: ONE_OF(/^(?:left|center|right|justify)$/i),
    dir: ONE_OF(/^(?:ltr|rtl|auto)$/i),
    lang: (v) => (/^[\w-]+$/.test(v) ? v : null),
    title: ANY,
  };
  const ATTRS_BY_TAG = {
    img: { alt: ANY, width: SIZE, height: SIZE },
    td: { colspan: INT, rowspan: INT, valign: ONE_OF(/^(?:top|middle|bottom|baseline)$/i), width: SIZE },
    th: { colspan: INT, rowspan: INT, valign: ONE_OF(/^(?:top|middle|bottom|baseline)$/i), width: SIZE },
    table: { width: SIZE },
    ol: { start: INT, type: (v) => (/^[1aAiI]$/.test(v) ? v : null), reversed: ANY },
    li: { value: INT },
    details: { open: ANY },
    source: { media: ANY, type: (v) => (/^[\w.+-]+\/[\w.+-]+$/.test(v) ? v : null) },
    time: { datetime: ANY },
    abbr: {}, a: { name: (v) => (/^[\w.:-]+$/.test(v) ? v : null) },
  };

  // One tag, written afresh. `orig` (inline only) is how it was spelled.
  function openTag(t, attrs, orig) {
    const ok = { ...ATTRS_ALL, ...(ATTRS_BY_TAG[t] || {}) };
    const out = [];
    let m;
    ATTR.lastIndex = 0;
    while ((m = ATTR.exec(attrs || ''))) {
      const name = m[1].toLowerCase();
      const raw = m[2] ?? m[3] ?? m[4];
      const v = raw === undefined ? '' : unent(raw);
      if (t === 'a' && name === 'href') {
        const u = safeUrl(v, true);
        if (u != null) out.push(`href="${esc(u)}"`);
      } else if (t === 'img' && name === 'src') {
        // like a Markdown image: a web or data: picture loads as is, a path
        // goes through the backend (data-src — which only WE ever write)
        const u = safeUrl(v);
        if (u != null) out.push(/^(https?:|data:)/i.test(u) ? `src="${esc(u)}"` : `data-src="${esc(u)}"`);
      } else if (t === 'source' && name === 'srcset') {
        // web pictures only: a path here would be fetched as file://
        if (v.split(',').every((c) => /^\s*https:\/\/\S+(?:\s+[\d.]+[wx])?\s*$/i.test(c))) {
          out.push(`srcset="${esc(v)}"`);
        }
      } else if (ok[name]) {
        if (raw === undefined) { if (name === 'open' || name === 'reversed') out.push(name); continue; }
        const clean = ok[name](v);
        if (clean != null) out.push(`${name}="${esc(clean)}"`);
      }
    }
    if (orig) out.push(`data-h="${esc(orig)}"`);
    return `<${t}${out.length ? ' ' + out.join(' ') : ''}>`;
  }

  // A run of HTML text, every tag rewritten; `stack` is the open-tag state
  // shared across a whole region, so a close in a later chunk finds its open.
  function cleanHtml(text, stack) {
    let out = '';
    let last = 0;
    const s = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
    TAG.lastIndex = 0;
    let m;
    while ((m = TAG.exec(s))) {
      out += escHtmlText(s.slice(last, m.index));
      last = TAG.lastIndex;
      const [whole, close, name, attrs] = m;
      const t = name.toLowerCase();
      if (!INLINE_TAGS.has(t) && !BLOCK_TAGS.has(t)) { out += esc(whole); continue; }
      if (close) {
        const k = stack.lastIndexOf(t);
        if (k < 0) continue;                      // a close with no open: dropped
        while (stack.length > k) out += `</${stack.pop()}>`;
      } else {
        out += openTag(t, attrs);
        if (!VOID.has(t)) stack.push(t);
      }
    }
    return out + escHtmlText(s.slice(last));
  }

  // How far a block of HTML reaches: to the blank line after its depth comes
  // back to zero. Never closed at all, it gets CommonMark's own rule — up to
  // the first blank line — rather than swallowing the rest of the document.
  function htmlRegion(lines, i) {
    if (COMMENT_OPEN.test(lines[i])) {
      let j = i;
      while (j < lines.length - 1 && !lines[j].includes('-->')) j++;
      return { end: j + 1, comment: true };
    }
    let depth = 0;
    let j = i;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) { if (depth <= 0) break; continue; }
      TAG.lastIndex = 0;
      let m;
      while ((m = TAG.exec(l.replace(/<!--[\s\S]*?-->/g, '')))) {
        if (DEPTH_TAGS.has(m[2].toLowerCase())) depth += m[1] ? -1 : 1;
      }
    }
    if (depth > 0) {
      j = i;
      while (j < lines.length && lines[j].trim()) j++;
    }
    return { end: j };
  }

  // The inside of a region: HTML chunks (an HTML line to the next blank
  // line — a <pre> to its close) and the Markdown between them, which is
  // rendered as Markdown, as GitHub does.
  function htmlBlock(lines, slug) {
    const stack = [];
    let out = '';
    let k = 0;
    while (k < lines.length) {
      if (!lines[k].trim()) { k++; continue; }
      const buf = [];
      if (htmlStart(lines[k])) {
        // a blank line ends the chunk — unless a <pre> is open across it
        const inPre = () => stack.includes('pre') || (buf.join('\n').match(/<pre[\s>]/gi) || []).length
          > (buf.join('\n').match(/<\/pre\s*>/gi) || []).length;
        while (k < lines.length && (lines[k].trim() || inPre())) buf.push(lines[k++]);
        out += cleanHtml(buf.join('\n'), stack);
      } else {
        while (k < lines.length && !htmlStart(lines[k])) buf.push(lines[k++]);
        out += renderBlocks(buf, slug, false);
      }
    }
    while (stack.length) out += `</${stack.pop()}>`;
    return out;
  }

  // ------------------------------------------------------------ inline text

  function emphasis(s) {
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
    return s;
  }

  function inline(raw) {
    const stash = [];
    const keep = (html) => '\uE000' + (stash.push(html) - 1) + '\uE001';
    let s = String(raw);

    // code spans first, on the raw text — nothing inside them is markdown
    s = s.replace(/(`{1,3})([\s\S]+?)\1(?!`)/g, (_, _t, code) =>
      keep('<code>' + esc(code.replace(/^ (.+) $/s, '$1')) + '</code>'));

    // backslash escapes: \* renders a literal *
    s = s.replace(/\\([\\`*_{}[\]()#+\-.!~|<>$])/g, (_, c) => keep(esc(c)));

    // inline HTML (see "raw HTML" above): comments hidden, allowlisted tags
    // rewritten, every other tag left as text. Opens still open at the end
    // of the paragraph are closed there, and a close with no open is dropped,
    // so nothing leaks into the next block.
    const opened = [];
    if (EXT.html) {
      s = s.replace(/<!--[\s\S]*?-->/g, (m) =>
        keep(`<span class="hcom" contenteditable="false" data-text="${esc(m)}"></span>`));
      s = s.replace(TAG, (m, close, name, attrs) => {
        const t = name.toLowerCase();
        if (!INLINE_TAGS.has(t)) return m;
        if (close) {
          const k = opened.lastIndexOf(t);
          if (k < 0) return keep('');
          opened.splice(k, 1);
          return keep(`</${t}>`);
        }
        if (!VOID.has(t)) opened.push(t);
        return keep(openTag(t, attrs, m));
      });
    }

    // $inline math$, still on the raw text — TeX is full of * and _ that
    // emphasis would eat. GitHub's rule: no space just inside either $.
    // The TeX rides in data-text; the <code> child is the look until
    // Temml swaps in MathML (doc.js decorates when the pref is on).
    if (EXT.math) {
      s = s.replace(/\$(\S(?:[^$\n]*\S)?)\$/g, (_, tex) =>
        keep(`<span class="math" data-kind="math" contenteditable="false"` +
             ` data-text="${esc(tex)}"><code>${esc(tex)}</code></span>`));
    }

    // [^id] footnote references, numbered in order of first use
    if (EXT.footnotes) {
      s = s.replace(/\[\^([^\]\s]+)\](?!:)/g, (_, id) => {
        let n = fnRefs.indexOf(id);
        if (n < 0) n = fnRefs.push(id) - 1;
        return keep(`<sup class="fnref" data-fn="${esc(id)}">` +
                    `<a href="#fn-${esc(id)}">${n + 1}</a></sup>`);
      });
    }

    s = esc(s);

    // images — direct http(s)/data srcs load as-is; anything path-like gets
    // data-src and is inlined by the page via the backend (api.imageData).
    // One with alt text is wrapped in a .fig span carrying that text as an
    // attribute: the caption is then drawn by CSS (content: attr(data-alt)),
    // so Preview ▸ Image Captions is a class toggle and never touches the DOM —
    // and an exported or printed document keeps whatever the screen showed.
    // The target comes in two spellings: bare, or wrapped in <angle brackets>,
    // which is how a path with spaces or parentheses has to be written —
    // `![](</assets/image (14).png>)`. By this point the text has been escaped,
    // so the brackets are entities. ANG matches one lazily, up to its own >.
    s = s.replace(/!\[([^\]]*)\]\(\s*(?:&lt;((?:(?!&gt;).)*)&gt;|([^)\s]+))\s*\)/g, (m, alt, ang, bare) => {
      const src = ang === undefined ? bare : ang;
      const u = safeUrl(src);
      if (!u) return m;
      const img = /^(https?:|data:)/i.test(u)
        ? `<img src="${u}" alt="${alt}">`
        : `<img data-src="${u}" alt="${alt}">`;
      return keep(alt ? `<span class="fig" data-alt="${alt}">${img}</span>` : img);
    });

    // links — the label keeps its emphasis ([**bold** link](url) works), and
    // the same two spellings of the target as images above
    s = s.replace(/\[([^\]]+)\]\(\s*(?:&lt;((?:(?!&gt;).)*)&gt;|([^)\s]+))\s*\)/g, (m, label, ang, bare) => {
      const url = ang === undefined ? bare : ang;
      const u = safeUrl(url, true);
      if (!u) return m;
      return keep(`<a href="${u}">${emphasis(label)}</a>`);
    });

    // autolinks: <https://…> (angle brackets are entities by now)
    s = s.replace(/&lt;(https?:\/\/[^\s<>]+?)&gt;/g, (_, u) => keep(`<a href="${u}">${u}</a>`));

    // bare URLs, minus trailing punctuation
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>\uE000]+)/g, (_, pre, u) => {
      const trail = (u.match(/[.,;:!?)]+$/) || [''])[0];
      const clean = trail ? u.slice(0, -trail.length) : u;
      return pre + keep(`<a href="${clean}">${clean}</a>`) + trail;
    });

    // :shortcode: emoji — emoji.js owns the name → glyph table. The code
    // rides in data-text so a Live round-trip hands back what was typed.
    if (EXT.emojiCodes && window.emojiByCode) {
      s = s.replace(/:([a-z0-9_+-]+):/g, (m, code) => {
        const g = window.emojiByCode[code];
        return g ? keep(`<span class="emo" data-text="${esc(m)}">${g}</span>`) : m;
      });
    }

    s = emphasis(s);
    s = s.replace(/ {2,}\n/g, '<br>\n');                // two-space hard break
    while (opened.length) s += `</${opened.pop()}>`;

    while (/\uE000/.test(s)) {
      s = s.replace(/\uE000(\d+)\uE001/g, (_, n) => stash[+n]);
    }
    return s;
  }

  // ----------------------------------------------------------------- blocks

  const FENCE = /^(\s*)(`{3,}|~{3,})\s*(\S*)\s*$/;
  const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  const HR = /^ {0,3}([-*_])( *\1){2,} *$/;
  const PGBRK = /^ {0,3}(?:\\(?:newpage|pagebreak)|<!--\s*(?:page[-_ ]?break|newpage)\s*-->)\s*$/i;
  const QUOTE = /^ {0,3}> ?/;
  const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const TABLE_SEP = /^\s*\|?(\s*:?-{2,}:?\s*\|)*\s*:?-{2,}:?\s*\|?\s*$/;
  const CB_OPEN = /^ {0,3}:{3,}\s*([A-Za-z][\w-]*)?[ \t]*(.*?)\s*$/;
  const CB_CLOSE = /^ {0,3}:{3,}\s*$/;

  // `::: warning Title` … `:::` — the one extension Nib renders. Everything
  // else about a container is ordinary Markdown, nesting included. The icons
  // live in CSS (themes.js) rather than the DOM, so the title stays plain
  // text that Live mode can edit and unmd.js can read straight back.
  const CB = {
    note: 'Note', info: 'Info', tip: 'Tip', hint: 'Hint',
    important: 'Important', warning: 'Warning', caution: 'Caution',
    danger: 'Danger', success: 'Success', bug: 'Bug',
  };

  // `[Title](url)` — the head a download / pagelink card is declared with.
  // Same two target spellings as a link: bare, or <angle brackets> for a
  // path with spaces.
  const CARD = /^\[(.+)\]\(\s*(?:<([^>]*)>|([^)\s]+))\s*\)$/;
  // the cards' icons, inline SVG so exported HTML keeps them
  const DLC_SVG = (body) => '<svg class="dlc-ico" viewBox="0 0 24 24" fill="none"'
    + ' stroke="currentColor" stroke-width="2" stroke-linecap="round"'
    + ' stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  const DLC_ICONS = {
    download: DLC_SVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'
      + '<polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
    pagelink: DLC_SVG('<path d="M15 3h6v6"/><path d="M10 14 21 3"/>'
      + '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  };

  // Preview ▸ --- as Page Break, set per render() call — a render option rather
  // than parser state, so help.html's examples stay on the default.
  let hrBreaks = false;

  // The Markdown Flavor toggles (Preview ▸ Markdown Flavor), same lifecycle as
  // hrBreaks. Math and mermaid render as data-text ISLANDS here — doc.js
  // decorates them with Temml / Mermaid when their libraries are loaded, so
  // this file stays dependency-free and help.html degrades to showing source.
  const EXT_DEFAULTS = { alerts: true, emojiCodes: true, footnotes: true, math: true, mermaid: true,
    carousel: true, download: true, embed: true, pagelink: true, toc: true, html: false };
  let EXT = { ...EXT_DEFAULTS };
  // ::: toc — per render: every heading as it is emitted (the same set the
  // outline shows, containers included), and each toc block's settings. The
  // block is written as a placeholder where it stands and filled in once the
  // whole document has been read, so a toc at the top sees the headings below.
  let tocHeads = [];
  let tocSpecs = [];
  const TOC_MARK = /\u0001TOC(\d+)\u0001/g;
  // `::: toc [title] [N | N-M]` — a trailing level or range of levels
  const TOC_ARG = /^(.*?)\s*(?:(?:^|\s)([1-6])(?:\s*-\s*([1-6]))?)?$/;
  const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/;
  const FNDEF = /^\[\^([^\]\s]+)\]:\s?(.*)$/;
  // per-render footnote state: refs in order of first use, defs by id
  let fnRefs = [];
  let fnDefs = new Map();

  const isTableStart = (lines, i) =>
    lines[i].includes('|') && i + 1 < lines.length &&
    lines[i + 1].includes('-') && TABLE_SEP.test(lines[i + 1]);

  const blockStart = (lines, i) => {
    const l = lines[i];
    return FENCE.test(l) || HEADING.test(l) || HR.test(l) || PGBRK.test(l) ||
           QUOTE.test(l) || ITEM.test(l) || CB_OPEN.test(l) || isTableStart(lines, i) ||
           (EXT.math && /^\s*\$\$/.test(l)) || (EXT.footnotes && FNDEF.test(l)) || htmlStart(l);
  };

  function slugger() {
    const used = new Set();
    const slug = (text) => {
      let s = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
      let out = s, n = 2;
      while (used.has(out)) out = s + '-' + n++;
      used.add(out);
      return out;
    };
    slug.uid = 0;                          // tab groups need unique radio names
    return slug;
  }

  // `track` is false inside blockquotes: their lines are rewritten, so task
  // boxes there lose their source line and render untoggleable. `off` is how
  // far this slice of lines sits into the document — containers pass their
  // own start so task boxes and outline entries inside one still point at the
  // right source line.
  function renderBlocks(lines, slug, track, off = 0) {
    const out = [];
    let i = 0;
    // every block remembers where it came from — that's what lets the outline
    // jump, and the editor and preview show each other's cursor
    const at = (n) => (track ? ` data-line="${off + n}"` : '');

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      const fence = line.match(FENCE);
      if (fence) {
        const [, , ticks, lang] = fence;
        const buf = [];
        const from = i;
        i++;
        while (i < lines.length && !(lines[i].trim().startsWith(ticks[0].repeat(3)) && lines[i].trim().replace(/[`~]/g, '') === '')) {
          buf.push(lines[i]);
          i++;
        }
        i++;                                             // closing fence
        const raw = buf.join('\n');
        // ```math and ```mermaid are islands, not code: the source rides in
        // data-text (data-fence remembers which spelling), the visible code
        // is the fallback look until doc.js decorates it.
        if (EXT.math && lang === 'math') {
          out.push(`<div class="math mblock" data-kind="math" data-fence="ticks" contenteditable="false"` +
                   ` data-text="${esc(raw)}"${at(from)}><code>${esc(raw)}</code></div>`);
          continue;
        }
        if (EXT.mermaid && lang === 'mermaid') {
          out.push(`<div class="mm" data-kind="mermaid" contenteditable="false"` +
                   ` data-text="${esc(raw)}"${at(from)}><pre class="mm-src"><code>${esc(raw)}</code></pre></div>`);
          continue;
        }
        const cls = /^[\w+-]+$/.test(lang) ? ` class="lang-${lang}"` : '';
        // code.js colours known languages; it escapes its own output, and
        // when it isn't loaded (or the language is unknown) we escape here
        const body = window.highlightCode
          ? window.highlightCode(raw, lang)
          : esc(raw);
        out.push(`<pre${at(from)}><code${cls}>${body}</code></pre>`);
        continue;
      }

      // $$ display math: one line ($$x^2$$) or a $$…$$ block of them
      if (EXT.math && /^\s*\$\$/.test(line)) {
        const from = i;
        const one = line.trim().match(/^\$\$(.+?)\$\$\s*$/);
        let tex;
        if (one) {
          tex = one[1].trim();
          i++;
        } else {
          const buf = [];
          const lead = line.trim().replace(/^\$\$/, '');
          if (lead) buf.push(lead);
          i++;
          while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
          i++;                                           // closing $$
          tex = buf.join('\n');
        }
        out.push(`<div class="math mblock" data-kind="math" data-fence="dollars" contenteditable="false"` +
                 ` data-text="${esc(tex)}"${at(from)}><code>${esc(tex)}</code></div>`);
        continue;
      }

      // [^id]: a footnote definition — collected here (with its indented
      // continuation lines), rendered nowhere, emitted as one list at the
      // end of the document in reference order.
      const fd = EXT.footnotes && line.match(FNDEF);
      if (fd) {
        const buf = [fd[2]];
        const from = i;
        i++;
        while (i < lines.length && /^ {2,}\S/.test(lines[i])) { buf.push(lines[i].trim()); i++; }
        fnDefs.set(fd[1], { text: buf.join('\n'), line: off + from });
        continue;
      }

      const h = line.match(HEADING);
      if (h) {
        const level = h[1].length;
        const id = slug(h[2]);
        const html = inline(h[2]);
        tocHeads.push({ level, id, html });
        out.push(`<h${level} id="${id}"${at(i)}>${html}</h${level}>`);
        i++;
        continue;
      }

      // Page breaks. The spelling it was written with rides along in
      // data-text so Live mode hands back exactly what was typed, and
      // contenteditable treats the empty div as one atomic object.
      // The label span is real content so it survives export; unmd.js never
      // walks into a .pgbrk (data-text answers first), so it can't leak back
      // into the document.
      const brk = (text) =>
        `<div class="pgbrk" data-kind="pagebreak" contenteditable="false" data-text="${esc(text)}"${at(i)}><span>page break</span></div>`;
      if (PGBRK.test(line)) { out.push(brk(line.trim())); i++; continue; }

      // a block of HTML: one island, rendered from the allowlist (above)
      if (htmlStart(line)) {
        const from = i;
        const r = htmlRegion(lines, i);
        const raw = lines.slice(i, r.end);
        i = r.end;
        out.push(`<div class="rawhtml${r.comment ? ' hcom' : ''}" data-kind="html" contenteditable="false"` +
                 ` data-text="${esc(raw.join('\n'))}"${at(from)}>${r.comment ? '' : htmlBlock(raw, slug)}</div>`);
        continue;
      }

      const hr = line.match(HR);
      if (hr) {
        // Preview ▸ --- as Page Break converts only the dash spelling — *** and
        // ___ stay rules, so a document can carry both on purpose. A rule
        // keeps its spelling in data-text for the same reason a break does:
        // unmd.js used to normalize every rule to ---, which would turn a
        // deliberate *** into a page break on the next Live round-trip.
        out.push(hrBreaks && hr[1] === '-'
          ? brk(line.trim())
          : `<hr data-text="${esc(line.trim())}"${at(i)}>`);
        i++;
        continue;
      }

      // ::: containers. A lone ::: this far in is a stray close — skip it.
      if (CB_CLOSE.test(line)) { i++; continue; }
      const cb = line.match(CB_OPEN);
      if (cb) {
        const kind = (cb[1] || 'note').toLowerCase();
        const buf = [];
        const from = i + 1;
        let depth = 1;
        i++;
        while (i < lines.length) {
          if (CB_CLOSE.test(lines[i])) {
            if (!--depth) { i++; break; }
          } else if (CB_OPEN.test(lines[i])) depth++;
          buf.push(lines[i]);
          i++;
        }
        if (kind === 'tabs') {
          out.push(tabs(buf, slug, track, off + from, at(from - 1)));
          continue;
        }
        // ::: carousel [small|medium|large] — the images inside, as a strip
        if (EXT.carousel && kind === 'carousel') {
          const size = /^(small|medium|large)$/.test((cb[2] || '').trim()) ? cb[2].trim() : '';
          out.push(`<div class="carousel${size ? ' c-' + size : ''}" data-kind="carousel"` +
                   (size ? ` data-arg="${size}"` : '') + `${at(from - 1)}>` +
                   renderBlocks(buf, slug, track, off + from) + '</div>');
          continue;
        }
        // ::: download [Title](url) and ::: pagelink [Title](url) — a card,
        // the body its description. The title is a real link, so clicking
        // goes wherever a link goes: the browser for http, the file for a
        // relative path. A head that isn't [Title](url) falls through to the
        // generic box below, which at least shows everything.
        if ((kind === 'download' && EXT.download) || (kind === 'pagelink' && EXT.pagelink)) {
          const m = (cb[2] || '').match(CARD);
          const u = m && safeUrl(m[2] !== undefined ? m[2] : m[3], true);
          if (u) {
            const body = buf.some((l) => l.trim()) ? renderBlocks(buf, slug, track, off + from) : '';
            out.push(`<div class="dlc dlc-${kind}" data-kind="${kind}"${at(from - 1)}>` +
                     DLC_ICONS[kind] +
                     `<div class="dlc-main"><p class="dlc-t"><a href="${esc(u)}">${inline(m[1])}</a></p>` +
                     body + '</div></div>');
            continue;
          }
        }
        // ::: toc [title] [N | N-M] — a table of contents built from the
        // document's headings, levels N to M (just N: 1 to N; neither: all
        // of them, like the outline). The body, if any, is a line under the
        // title. An island: data-arg and data-text are what unmd.js writes
        // back, since the list itself is derived, never written.
        if (EXT.toc && kind === 'toc') {
          const arg = (cb[2] || '').trim();
          const m = arg.match(TOC_ARG) || [arg, arg];
          const lo = m[3] ? +m[2] : 1;
          const hi = m[3] ? +m[3] : m[2] ? +m[2] : 6;
          const title = (m[1] || '').trim() || 'Contents';
          const desc = buf.some((l) => l.trim())
            ? `<div class="toc-d">${renderBlocks(buf, slug, false)}</div>` : '';
          tocSpecs.push({ lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
          // a div (role=navigation), not a <nav>: every island is a div, and
          // unmd.js only walks known block tags as blocks
          out.push(`<div class="toc" role="navigation" data-kind="toc" contenteditable="false"` +
                   ` data-arg="${esc(arg)}" data-text="${esc(buf.join('\n'))}"${at(from - 1)}>` +
                   `<p class="toc-t">${inline(title)}</p>${desc}` +
                   `\u0001TOC${tocSpecs.length - 1}\u0001</div>`);
          continue;
        }
        // ::: embed <url> — an island doc.js fills through the backend's
        // oEmbed fetch (the page can't: those endpoints rarely send CORS
        // headers). Until then, and wherever that fails, it is a link. The
        // body is the caption — its RAW lines ride in data-text so unmd.js
        // hands back exactly what was written, whatever we rendered.
        if (EXT.embed && kind === 'embed') {
          const arg = (cb[2] || '').trim();
          const url = safeUrl(arg.split(/\s+/)[0] || '');
          if (url && /^https?:/i.test(url)) {
            const cap = buf.some((l) => l.trim())
              ? `<div class="oemb-cap">${renderBlocks(buf, slug, false)}</div>` : '';
            out.push(`<div class="oemb" data-kind="embed" contenteditable="false"` +
                     ` data-arg="${esc(arg)}" data-url="${esc(url)}"` +
                     ` data-text="${esc(buf.join('\n'))}"${at(from - 1)}>` +
                     `<div class="oemb-box"><a href="${esc(url)}">${esc(url)}</a></div>${cap}</div>`);
            continue;
          }
        }
        const body = renderBlocks(buf, slug, track, off + from);
        if (kind === 'details') {
          out.push(`<details class="cb cb-details" data-kind="details"${at(from - 1)}>` +
                   `<summary>${inline(cb[2] || 'Details')}</summary>${body}</details>`);
        } else {
          const label = cb[2] || CB[kind] || kind[0].toUpperCase() + kind.slice(1);
          out.push(`<div class="cb${CB[kind] ? ' cb-' + kind : ''}" data-kind="${kind}"${at(from - 1)}>` +
                   `<p class="cb-t">${inline(label)}</p>${body}</div>`);
        }
        continue;
      }

      if (QUOTE.test(line)) {
        const buf = [];
        const from = i;
        while (i < lines.length && (QUOTE.test(lines[i]) || (buf.length && lines[i].trim()))) {
          buf.push(lines[i].replace(QUOTE, ''));
          i++;
        }
        // GitHub alerts: > [!NOTE] on the first line makes the quote a
        // callout. It borrows the ::: containers' whole look (cb classes),
        // but data-alert remembers the spelling, so unmd.js writes the
        // quote form back rather than converting the document to :::.
        const al = EXT.alerts && buf[0] && buf[0].trim().match(ALERT);
        if (al) {
          const kind = al[1].toLowerCase();
          out.push(`<div class="cb cb-${kind}" data-kind="${kind}" data-alert="${al[1]}"${at(from)}>` +
                   `<p class="cb-t">${CB[kind]}</p>${renderBlocks(buf.slice(1), slug, false)}</div>`);
          continue;
        }
        out.push(`<blockquote${at(from)}>${renderBlocks(buf, slug, false)}</blockquote>`);
        continue;
      }

      if (ITEM.test(line)) {
        i = list(lines, i, out, slug, track, off);
        continue;
      }

      if (isTableStart(lines, i)) {
        i = table(lines, i, out, at(i));
        continue;
      }

      const buf = [line];
      const from = i;
      i++;
      while (i < lines.length && lines[i].trim() && !blockStart(lines, i)) {
        buf.push(lines[i]);
        i++;
      }
      // A paragraph that is nothing but a picture is a figure, and gets said
      // so here: CSS can't tell it apart on its own (`:only-child` counts
      // elements, so an image sitting in the middle of a sentence looks
      // identical to one on a line of its own), and Preview ▸ Center Images has
      // to leave the inline one where the author put it.
      const raw = buf.join('\n');
      const solo = /^\s*!\[[^\]]*\]\([^)\s]+\)\s*$/.test(raw) ? ' class="figp"' : '';
      out.push(`<p${solo}${at(from)}>${inline(raw)}</p>`);
    }
    return out.join('\n');
  }

  // ------------------------------------------------------------------- tabs
  //
  // `::: tabs` with `== Title` splitting the body. Rendered as hidden radios
  // + labels + panels, switched by CSS alone (:checked ~ .tp) — so tabs keep
  // working in exported HTML, which carries no script, and print can simply
  // show every panel.

  function tabs(buf, slug, track, off, at) {
    const parts = [];
    let cur = null;
    buf.forEach((l, k) => {
      const m = l.match(/^==\s+(.+?)\s*$/);
      if (m) {
        cur = { title: m[1], lines: [], from: off + k + 1 };
        parts.push(cur);
      } else if (cur) {
        cur.lines.push(l);
      }
    });
    if (!parts.length) return `<div class="tabs" data-kind="tabs"${at}></div>`;

    const gid = 'tab' + ++slug.uid;
    const head = [], panes = [];
    parts.forEach((p, k) => {
      const id = `${gid}-${k}`;
      head.push(`<input type="radio" name="${gid}" id="${id}"${k ? '' : ' checked'}>` +
                `<label for="${id}">${inline(p.title)}</label>`);
      panes.push(`<div class="tp"${track ? ` data-line="${p.from - 1}"` : ''}>` +
                 `${renderBlocks(p.lines, slug, track, p.from)}</div>`);
    });
    return `<div class="tabs" data-kind="tabs"${at}>${head.join('')}${panes.join('')}</div>`;
  }

  // ------------------------------------------------------------------ lists

  function list(lines, i, out, slug, track, off = 0) {
    // flatten the run into { indent, ordered, text, line } items…
    const items = [];
    while (i < lines.length && lines[i].trim()) {
      const m = lines[i].match(ITEM);
      if (m) {
        items.push({
          indent: m[1].length,
          ordered: /\d/.test(m[2]),
          start: parseInt(m[2], 10),
          text: [m[3]],
          line: off + i,
        });
      } else if (items.length && /^\s/.test(lines[i])) {
        items[items.length - 1].text.push(lines[i].trim());   // continuation
      } else break;
      i++;
    }

    // …then fold them into a tree by indent
    const render = (from, to, depth) => {
      const indent = items[from].indent;
      const ordered = items[from].ordered;
      const start = ordered && items[from].start !== 1 ? ` start="${items[from].start}"` : '';
      const bits = [];
      let k = from;
      while (k < to) {
        let next = k + 1;
        while (next < to && items[next].indent > indent) next++;
        let body = items[k].text.join('\n');
        let attrs = '';
        const task = body.match(/^\[([ xX])\]\s+/);
        if (task) {
          body = body.slice(task[0].length);
          const on = task[1] !== ' ';
          attrs = ' class="task' + (on ? ' done' : '') + '"';
          body = `<input type="checkbox"${on ? ' checked' : ''}${track ? ` data-line="${items[k].line}"` : ' disabled'}> ` + inline(body);
        } else {
          body = inline(body);
        }
        const kids = next > k + 1 ? render(k + 1, next, depth + 1) : '';
        bits.push(`<li${attrs}${track ? ` data-line="${items[k].line}"` : ''}>${body}${kids}</li>`);
        k = next;
      }
      const tag = ordered ? 'ol' : 'ul';
      const at = track && !depth ? ` data-line="${items[from].line}"` : '';
      return `<${tag}${start}${at}>${bits.join('')}</${tag}>`;
    };

    out.push(render(0, items.length, 0));
    return i;
  }

  // ----------------------------------------------------------------- tables

  function table(lines, i, out, at = '') {
    const splitRow = (l) =>
      l.trim().replace(/^\|/, '').replace(/\|$/, '')
        .split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

    const head = splitRow(lines[i]);
    const aligns = splitRow(lines[i + 1]).map((c) =>
      /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : '');
    i += 2;

    const rows = [];
    while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
      rows.push(splitRow(lines[i]));
      i++;
    }

    const cell = (tag, txt, col) => {
      const a = aligns[col] ? ` style="text-align:${aligns[col]}"` : '';
      return `<${tag}${a}>${inline(txt ?? '')}</${tag}>`;
    };
    const tr = (cells, tag) => `<tr>${cells.map((c, k) => cell(tag, c, k)).join('')}</tr>`;

    out.push(`<table${at}><thead>${tr(head, 'th')}</thead><tbody>${rows.map((r) => tr(r, 'td')).join('')}</tbody></table>`);
    return i;
  }

  // ------------------------------------------------------------------ export

  // YAML front-matter: a --- fence at the very top. Nib doesn't parse it, but
  // it shouldn't render as a rule and a paragraph either — it gets its own
  // block, kept verbatim so it survives the trip back through unmd.js.
  function frontMatter(lines) {
    if (lines[0] !== '---') return null;
    const end = lines.indexOf('---', 1);
    if (end < 1) return null;
    return {
      html: `<pre class="fm" data-kind="frontmatter" data-line="0">${esc(lines.slice(1, end).join('\n'))}</pre>`,
      end,
    };
  }

  // The footnote list: every referenced id in reference order, then any
  // defined-but-unreferenced stragglers (GitHub hides those; dropping them
  // here would LOSE them on a Live round-trip, so they stay, dimmed by CSS).
  // Whole section is one island — unmd.js rebuilds the [^id]: lines from it.
  function footnoteSection() {
    if (!fnRefs.length && !fnDefs.size) return '';
    const ids = [...fnRefs, ...[...fnDefs.keys()].filter((id) => !fnRefs.includes(id))];
    const items = ids.map((id) => {
      const def = fnDefs.get(id);
      const cls = fnRefs.includes(id) ? '' : ' class="fn-stray"';
      const back = fnRefs.includes(id)
        ? ` <a class="fn-back" href="#" data-fn-back="${esc(id)}">↩</a>` : '';
      return `<li id="fn-${esc(id)}" data-fn="${esc(id)}"${cls}` +
             `${def ? ` data-line="${def.line}"` : ''}>${inline(def ? def.text : '(missing)')}${back}</li>`;
    });
    return `<section class="footnotes" data-kind="footnotes" contenteditable="false">` +
           `<ol>${items.join('')}</ol></section>`;
  }

  // The nested list for one toc block. Nesting follows the levels as they
  // come, so a skipped level (## then ####) nests one deeper, not two; link
  // text is the heading's with its markup stripped, since a link inside a
  // link isn't one.
  function tocList({ lo, hi }) {
    const heads = tocHeads.filter((h) => h.level >= lo && h.level <= hi);
    if (!heads.length) return '<p class="toc-none">No headings yet.</p>';
    let html = '';
    const stack = [];
    for (const h of heads) {
      while (stack.length && stack[stack.length - 1] > h.level) { html += '</li></ul>'; stack.pop(); }
      if (stack.length && stack[stack.length - 1] === h.level) html += '</li>';
      else { html += '<ul>'; stack.push(h.level); }
      html += `<li><a href="#${h.id}">${h.html.replace(/<[^>]*>/g, '')}</a>`;
    }
    while (stack.pop() !== undefined) html += '</li></ul>';
    return html;
  }

  window.MD_CONTAINERS = CB;             // unmd.js + help.html read these back
  window.renderMarkdown = (src, opts) => {
    hrBreaks = !!(opts && opts.hrBreaks);
    EXT = { ...EXT_DEFAULTS, ...(opts || {}) };
    fnRefs = [];
    fnDefs = new Map();
    tocHeads = [];
    tocSpecs = [];
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const slug = slugger();
    const fm = frontMatter(lines);
    const body = fm
      ? fm.html + '\n' + renderBlocks(lines.slice(fm.end + 1), slug, true, fm.end + 1)
      : renderBlocks(lines, slug, true, 0);
    const html = body + footnoteSection();
    return tocSpecs.length ? html.replace(TOC_MARK, (_, n) => tocList(tocSpecs[+n])) : html;
  };
})();
