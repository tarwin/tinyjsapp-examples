// A small hand-rolled Markdown renderer — zero dependencies, like every
// plain-JS example in this repo. It covers the everyday set: ATX headings
// (with anchor ids), emphasis, code spans and fences, links, images, lists
// (nested, with clickable task boxes), blockquotes, tables, and rules.
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
    s = s.replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, (_, c) => keep(esc(c)));

    s = esc(s);

    // images — direct http(s)/data srcs load as-is; anything path-like gets
    // data-src and is inlined by the page via the backend (api.imageData)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
      const u = safeUrl(src);
      if (!u) return m;
      return /^(https?:|data:)/i.test(u)
        ? keep(`<img src="${u}" alt="${alt}">`)
        : keep(`<img data-src="${u}" alt="${alt}">`);
    });

    // links — the label keeps its emphasis ([**bold** link](url) works)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
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
  const QUOTE = /^ {0,3}> ?/;
  const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const TABLE_SEP = /^\s*\|?(\s*:?-{2,}:?\s*\|)*\s*:?-{2,}:?\s*\|?\s*$/;

  const isTableStart = (lines, i) =>
    lines[i].includes('|') && i + 1 < lines.length &&
    lines[i + 1].includes('-') && TABLE_SEP.test(lines[i + 1]);

  const blockStart = (lines, i) => {
    const l = lines[i];
    return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) ||
           ITEM.test(l) || isTableStart(lines, i);
  };

  function slugger() {
    const used = new Set();
    return (text) => {
      let s = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
      let out = s, n = 2;
      while (used.has(out)) out = s + '-' + n++;
      used.add(out);
      return out;
    };
  }

  // `track` is false inside blockquotes: their lines are rewritten, so task
  // boxes there lose their source line and render untoggleable.
  function renderBlocks(lines, slug, track) {
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      const fence = line.match(FENCE);
      if (fence) {
        const [, , ticks, lang] = fence;
        const buf = [];
        i++;
        while (i < lines.length && !(lines[i].trim().startsWith(ticks[0].repeat(3)) && lines[i].trim().replace(/[`~]/g, '') === '')) {
          buf.push(lines[i]);
          i++;
        }
        i++;                                             // closing fence
        const cls = /^[\w+-]+$/.test(lang) ? ` class="lang-${lang}"` : '';
        out.push(`<pre><code${cls}>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }

      const h = line.match(HEADING);
      if (h) {
        const level = h[1].length;
        out.push(`<h${level} id="${slug(h[2])}">${inline(h[2])}</h${level}>`);
        i++;
        continue;
      }

      if (HR.test(line)) { out.push('<hr>'); i++; continue; }

      if (QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && (QUOTE.test(lines[i]) || (buf.length && lines[i].trim()))) {
          buf.push(lines[i].replace(QUOTE, ''));
          i++;
        }
        out.push(`<blockquote>${renderBlocks(buf, slug, false)}</blockquote>`);
        continue;
      }

      if (ITEM.test(line)) {
        i = list(lines, i, out, slug, track);
        continue;
      }

      if (isTableStart(lines, i)) {
        i = table(lines, i, out);
        continue;
      }

      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !blockStart(lines, i)) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<p>${inline(buf.join('\n'))}</p>`);
    }
    return out.join('\n');
  }

  // ------------------------------------------------------------------ lists

  function list(lines, i, out, slug, track) {
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
          line: i,
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
        bits.push(`<li${attrs}>${body}${kids}</li>`);
        k = next;
      }
      const tag = ordered ? 'ol' : 'ul';
      return `<${tag}${start}>${bits.join('')}</${tag}>`;
    };

    out.push(render(0, items.length, 0));
    return i;
  }

  // ----------------------------------------------------------------- tables

  function table(lines, i, out) {
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

    out.push(`<table><thead>${tr(head, 'th')}</thead><tbody>${rows.map((r) => tr(r, 'td')).join('')}</tbody></table>`);
    return i;
  }

  // ------------------------------------------------------------------ export

  window.renderMarkdown = (src) =>
    renderBlocks(String(src).replace(/\r\n?/g, '\n').split('\n'), slugger(), true);
})();
