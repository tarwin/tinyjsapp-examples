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
//      must never become markup.
//   2. URLs are vetted. http(s)/mailto/# pass through; unknown schemes
//      (javascript: and friends) don't. Relative image paths get data-src
//      and are resolved by the backend into data: URIs.

(() => {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

  function safeUrl(u) {
    const t = u.trim();
    if (/^(https?:|mailto:|data:image\/|#)/i.test(t)) return t;
    if (/^[a-zA-Z][\w+.-]*:/.test(t)) return null;      // javascript: etc.
    return t;                                            // relative / plain path
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
    s = s.replace(/\\([\\`*_{}[\]()#+\-.!~|>$])/g, (_, c) => keep(esc(c)));

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
      const u = safeUrl(url);
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

  // Preview ▸ --- as Page Break, set per render() call — a render option rather
  // than parser state, so help.html's examples stay on the default.
  let hrBreaks = false;

  // The Markdown Flavor toggles (Preview ▸ Markdown Flavor), same lifecycle as
  // hrBreaks. Math and mermaid render as data-text ISLANDS here — doc.js
  // decorates them with Temml / Mermaid when their libraries are loaded, so
  // this file stays dependency-free and help.html degrades to showing source.
  const EXT_DEFAULTS = { alerts: true, emojiCodes: true, footnotes: true, math: true, mermaid: true };
  let EXT = { ...EXT_DEFAULTS };
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
           (EXT.math && /^\s*\$\$/.test(l)) || (EXT.footnotes && FNDEF.test(l));
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
        out.push(`<h${level} id="${slug(h[2])}"${at(i)}>${inline(h[2])}</h${level}>`);
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

  window.MD_CONTAINERS = CB;             // unmd.js + help.html read these back
  window.renderMarkdown = (src, opts) => {
    hrBreaks = !!(opts && opts.hrBreaks);
    EXT = { ...EXT_DEFAULTS, ...(opts || {}) };
    fnRefs = [];
    fnDefs = new Map();
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const slug = slugger();
    const fm = frontMatter(lines);
    const body = fm
      ? fm.html + '\n' + renderBlocks(lines.slice(fm.end + 1), slug, true, fm.end + 1)
      : renderBlocks(lines, slug, true, 0);
    return body + footnoteSection();
  };
})();
