// The other direction: turn the rendered preview back into Markdown. This is
// what makes the ✎ Editable toggle work — the article is contenteditable,
// and every idle keystroke re-serializes it into the textarea's buffer.
//
// It only has to understand two dialects: the HTML md.js emits, and whatever
// contenteditable improvises on top of it (WebKit reaches for <div>, <b>,
// <i>, <font> and stray <span>s). Anything else is walked through for its
// text. Images serialize from data-src, not src — by then src is a data: URI
// the backend handed us, and the document must keep its relative path.
//
// Round-tripping is normalizing, not lossless: **bold** and *italic* come
// back in that spelling whatever you typed, `- ` leads every bullet, tables
// are rebuilt with even pipes. That's the deal Live mode makes — but only
// for the blocks you actually EDIT: patchMarkdown (below) splices every
// untouched block's original source lines through byte-for-byte, hard wraps
// and all, so one word typed in the preview is one block's diff, not a
// whole-file reflow.

(() => {
  const INLINE_ESC = /([\\*`[\]])/g;
  const esc = (s) => s.replace(INLINE_ESC, '\\$1');

  const isEl = (n, ...tags) => n.nodeType === 1 && tags.includes(n.tagName);

  // --------------------------------------------------------------- inline

  function inline(node) {
    // U+200B is live.js's caret perch after an input rule fires — it is
    // scaffolding, never content.
    if (node.nodeType === 3) return esc(node.nodeValue.replace(/​/g, '').replace(/\s+/g, ' '));
    if (node.nodeType !== 1) return '';
    // inline islands answer from data-text before anything walks into them:
    // an emoji goes home as its :shortcode:, inline math as its $TeX$
    if (node.classList.contains('emo')) return node.dataset.text || node.textContent;
    if (node.classList.contains('math')) return '$' + (node.dataset.text || '') + '$';
    const kids = () => [...node.childNodes].map(inline).join('');
    // a path with a space or a bracket in it has to go back inside <angle
    // brackets> — written bare it would not parse as a link at all
    const target = (p) => (/[\s()<>]/.test(p) ? '<' + p + '>' : p);

    switch (node.tagName) {
      case 'BR': return '  \n';
      case 'INPUT': return '';                        // task boxes: handled by the li
      case 'IMG': {
        const src = node.dataset.src || node.getAttribute('src') || '';
        return `![${(node.getAttribute('alt') || '').replace(/[[\]]/g, '')}](${target(src)})`;
      }
      case 'CODE': {
        const raw = node.textContent;
        const tick = '`'.repeat((raw.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0) + 1);
        return tick + (/^`|`$/.test(raw) ? ' ' + raw + ' ' : raw) + tick;
      }
      case 'STRONG': case 'B': {
        const s = kids().trim();
        return s ? '**' + s + '**' : '';
      }
      case 'EM': case 'I': {
        const s = kids().trim();
        return s ? '*' + s + '*' : '';
      }
      case 'DEL': case 'S': case 'STRIKE': {
        const s = kids().trim();
        return s ? '~~' + s + '~~' : '';
      }
      case 'MARK': {
        const s = kids().trim();
        return s ? '==' + s + '==' : '';
      }
      case 'LABEL': return '';                        // tab titles: the div emits them
      case 'SUP': {
        // a footnote reference — the number is presentation, the id is truth
        if (node.classList.contains('fnref')) return '[^' + node.dataset.fn + ']';
        return kids();
      }
      case 'A': {
        const href = node.getAttribute('href') || '';
        const label = kids().trim() || href;
        if (!href) return label;
        return href === label ? label : `[${label}](${target(href)})`;
      }
      default: return kids();
    }
  }

  // Newlines in inline content only ever come from <br>, which Markdown
  // spells as two trailing spaces — so normalize around them and drop the
  // indentation the renderer left on the following line.
  const inlineOf = (nodes) =>
    nodes.map(inline).join('')
      .replace(/[ \t]+\n/g, '  \n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/^ +| +$/g, '');

  // ---------------------------------------------------------------- blocks

  function listOf(el, indent) {
    const ordered = el.tagName === 'OL';
    let n = parseInt(el.getAttribute('start') || '1', 10) || 1;
    const out = [];
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      const nested = [], own = [];
      for (const c of li.childNodes) {
        (isEl(c, 'UL', 'OL') ? nested : own).push(c);
      }
      const box = li.querySelector(':scope > input[type=checkbox]');
      const mark = ordered ? n++ + '. ' : '- ';
      const body = inlineOf(own).replace(/\n/g, '\n' + indent + '  ') || '';
      out.push(indent + mark + (box ? (box.checked ? '[x] ' : '[ ] ') : '') + body);
      for (const sub of nested) out.push(listOf(sub, indent + '  '));
    }
    return out.join('\n');
  }

  function tableOf(el) {
    const rows = [...el.querySelectorAll('tr')];
    if (!rows.length) return '';
    const cells = (tr) => [...tr.children].map((td) => inlineOf([...td.childNodes]).replace(/\|/g, '\\|').trim());
    const align = [...(rows[0].children || [])].map((td) => {
      const a = td.style.textAlign || '';
      return a === 'center' ? ':---:' : a === 'right' ? '---:' : '---';
    });
    const line = (cs) => '| ' + cs.join(' | ') + ' |';
    const out = [line(cells(rows[0])), line(align)];
    for (const tr of rows.slice(1)) out.push(line(cells(tr)));
    return out.join('\n');
  }

  function blockOf(el) {
    const kids = () => blocks(el);

    if (/^H[1-6]$/.test(el.tagName)) {
      return '#'.repeat(+el.tagName[1]) + ' ' + inlineOf([...el.childNodes]);
    }
    switch (el.tagName) {
      // the spelling it was written with (--- vs *** matters once Preview ▸
      // "---" as Page Break is on); a fresh <hr> live.js made has no memory
      case 'HR': return el.dataset.text || '---';
      case 'UL': case 'OL': return listOf(el, '');
      case 'TABLE': return tableOf(el);
      case 'PRE': {
        if (el.classList.contains('fm')) return '---\n' + el.textContent.replace(/\n$/, '') + '\n---';
        const code = el.querySelector('code');
        const lang = (code && (code.className.match(/lang-([\w+-]+)/) || [])[1]) || '';
        const body = (code || el).textContent.replace(/\n$/, '');
        const fence = '`'.repeat(Math.max(3, ((body.match(/`{3,}/g) || []).reduce((m, r) => Math.max(m, r.length), 0)) + 1));
        return fence + lang + '\n' + body + '\n' + fence;
      }
      case 'BLOCKQUOTE':
        return kids().split('\n').map((l) => (l ? '> ' + l : '>')).join('\n');
      case 'DETAILS': {
        const sum = el.querySelector(':scope > summary');
        const title = sum ? inlineOf([...sum.childNodes]).trim() : '';
        const inner = blocks(el, (n) => n !== sum);
        return '::: details ' + (title || 'Details') + '\n' + inner + '\n:::';
      }
      // the footnote list at the document's end: back into [^id]: lines
      case 'SECTION': {
        if (el.classList.contains('footnotes')) {
          return [...el.querySelectorAll('li[data-fn]')]
            .map((li) => {
              const kids = [...li.childNodes].filter((n) =>
                !(n.nodeType === 1 && n.classList.contains('fn-back')));
              return '[^' + li.dataset.fn + ']: ' + inlineOf(kids).replace(/\n/g, '\n  ');
            })
            .join('\n');
        }
        return kids();
      }
      default: {
        // page breaks: an empty div that must not vanish — it goes back out
        // in the spelling it was written with (md.js kept it in data-text)
        if (el.classList.contains('pgbrk')) return el.dataset.text || '\\newpage';
        // math and mermaid islands, in the spelling they were written with
        if (el.classList.contains('math')) {
          const tex = el.dataset.text || '';
          return el.dataset.fence === 'ticks'
            ? '```math\n' + tex + '\n```' : '$$\n' + tex + '\n$$';
        }
        if (el.classList.contains('mm')) {
          return '```mermaid\n' + (el.dataset.text || '') + '\n```';
        }
        if (el.classList.contains('tabs')) {
          const labels = [...el.querySelectorAll(':scope > label')];
          const panes = [...el.querySelectorAll(':scope > .tp')];
          const out = panes.map((pane, k) => {
            const title = labels[k] ? inlineOf([...labels[k].childNodes]).trim() : 'Tab ' + (k + 1);
            return '== ' + title + '\n' + blocks(pane);
          });
          return '::: tabs\n\n' + out.join('\n\n') + '\n\n:::';
        }
        // the ::: extension blocks, each back in its own spelling. The
        // embed is an island — data-arg and data-text are the whole truth,
        // whatever doc.js swapped into the box.
        if (el.classList.contains('oemb')) {
          const body = el.dataset.text || '';
          return '::: embed ' + (el.dataset.arg || '')
            + (body.trim() ? '\n' + body : '') + '\n:::';
        }
        if (el.classList.contains('carousel')) {
          return '::: carousel' + (el.dataset.arg ? ' ' + el.dataset.arg : '')
            + '\n' + blocks(el) + '\n:::';
        }
        if (el.classList.contains('dlc')) {
          const kind = el.dataset.kind || 'download';
          const t = el.querySelector(':scope > .dlc-main > .dlc-t');
          const a = t && t.querySelector('a');
          const href = a ? a.getAttribute('href') || '' : '';
          const title = (a ? inlineOf([...a.childNodes]) : '').trim().replace(/[[\]]/g, '');
          const main = el.querySelector(':scope > .dlc-main');
          const inner = main ? blocks(main, (n) => n !== t) : '';
          return '::: ' + kind + ' [' + title + '](' + (/[\s()<>]/.test(href) ? '<' + href + '>' : href)
            + ')' + (inner.trim() ? '\n' + inner : '') + '\n:::';
        }
        // a GitHub alert wears the callout look but goes home as a quote
        if (el.classList.contains('cb') && el.dataset.alert) {
          const t = el.querySelector(':scope > .cb-t');
          const inner = blocks(el, (n) => n !== t);
          return '> [!' + el.dataset.alert + ']\n'
            + inner.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n');
        }
        if (el.classList.contains('cb')) {
          const kind = el.dataset.kind || 'note';
          const t = el.querySelector(':scope > .cb-t');
          const title = t ? inlineOf([...t.childNodes]).trim() : '';
          const inner = blocks(el, (n) => n !== t);
          const head = title && title !== (window.MD_CONTAINERS || {})[kind]
            ? kind + ' ' + title : kind;
          return '::: ' + head + '\n' + inner + '\n:::';
        }
        // P, DIV, and whatever else contenteditable invented: if it holds
        // block children, recurse; otherwise it's a paragraph.
        if ([...el.children].some((c) => BLOCKS.test(c.tagName) || c.classList.contains('cb'))) {
          return kids();
        }
        return inlineOf([...el.childNodes]);
      }
    }
  }

  const BLOCKS = /^(H[1-6]|P|DIV|UL|OL|PRE|TABLE|BLOCKQUOTE|HR|DETAILS|SECTION|ARTICLE)$/;

  function blocks(parent, keep) {
    const out = [];
    let loose = [];                                   // bare text between blocks
    const flush = () => {
      const s = inlineOf(loose).trim();
      loose = [];
      if (s) out.push(s);
    };
    for (const n of parent.childNodes) {
      if (keep && !keep(n)) continue;
      if (n.nodeType === 1 && (BLOCKS.test(n.tagName) || n.classList.contains('cb'))) {
        flush();
        const s = blockOf(n)
          .replace(/[ \t]+$/gm, (t) => (t.length >= 2 ? '  ' : ''))   // keep hard breaks
          .replace(/[ \t]+$/, '');                                    // but not a dangling one
        if (s.trim()) out.push(s);
      } else {
        loose.push(n);
      }
    }
    flush();
    return out.join('\n\n');
  }

  window.htmlToMarkdown = (root) => blocks(root).replace(/\n{3,}/g, '\n\n').trim() + '\n';

  // a list of nodes serialized as if they were a document — blocks() only
  // ever reads parent.childNodes, so a bare object is root enough
  const nodesMd = (nodes) =>
    blocks({ childNodes: nodes }).replace(/\n{3,}/g, '\n\n').trim();
  window.htmlToMarkdownNodes = nodesMd;

  // ------------------------------------------------------------ patching
  //
  // Serialize ONLY what changed. Whole-document serialization is correct but
  // heavy-handed: the DOM has no memory of the source's hard-wrapped lines,
  // reference-style links, or `[^id]:` placement, so one word typed in the
  // preview used to reflow every paragraph in the file — death by a thousand
  // git diffs, and poison for any future diff view.
  //
  // The idea: the source the editor holds still describes MOST of the live
  // DOM. Render that source into a detached tree (the caller passes it in —
  // it already builds one for restamping) and walk the live preview's
  // top-level blocks. A live block whose data-line names a fresh block that
  // SERIALIZES IDENTICALLY is untouched — its original source lines go
  // through byte-for-byte, wraps and all. Everything between such anchors is
  // what the user actually edited, and only that is serialized fresh.
  //
  // Equality of serializations is the load-bearing trick: the live block is
  // full of enhancements (MathML, mermaid SVG, inlined images, a checked
  // tab) and the fresh one is plain, but both serialize from the same
  // data-* attributes — so "same Markdown" is provable where "same DOM"
  // never would be. And a stale or duplicated data-line can't corrupt
  // anything: a false candidate fails the equality check and simply falls
  // into a segment, which is the degraded-but-correct path.
  //
  // Returns null whenever byte-precision can't be PROVEN, and the caller
  // falls back to whole-document serialization — today's behavior:
  //  - a fresh top-level block with no data-line (nothing to splice by)
  //  - out-of-order or missing anchors where ranges would be guesswork
  //  - a replaced range holding a `[id]:` / `[^id]:` definition line other
  //    blocks may depend on (whole-doc mode relocates those; splicing would
  //    silently drop them)
  //  - an edited footnote section (it is synthesized from lines that live
  //    inside OTHER blocks' ranges — unchanged it drops out of both sides,
  //    changed it is the whole document's business)
  //  - loose text typed at the article root
  const DEF_LINE = /^ {0,3}\[[^\]]*\]:/m;
  const isFnSection = (el) =>
    el.tagName === 'SECTION' && el.classList.contains('footnotes');

  window.patchMarkdown = function patchMarkdown(src, liveRoot, freshRoot) {
    // the renderer's line numbers count \n-normalized lines; a CRLF file's
    // raw offsets wouldn't line up, so it takes the whole-document path
    if (src.includes('\r')) return null;
    for (const n of liveRoot.childNodes) {
      if (n.nodeType === 3 && n.nodeValue.replace(/​/g, '').trim()) return null;
    }
    let live = [...liveRoot.children];
    let fresh = [...freshRoot.children];

    const lfn = live.length && isFnSection(live[live.length - 1])
      ? live[live.length - 1] : null;
    const ffn = fresh.length && isFnSection(fresh[fresh.length - 1])
      ? fresh[fresh.length - 1] : null;
    if (!!lfn !== !!ffn) return null;
    if (lfn) {
      if (nodesMd([lfn]) !== nodesMd([ffn])) return null;
      live = live.slice(0, -1);
      fresh = fresh.slice(0, -1);
    }
    if (!live.length || !fresh.length) return null;

    const freshLine = fresh.map((el) =>
      (el.dataset && el.dataset.line != null ? +el.dataset.line : NaN));
    for (let i = 0; i < freshLine.length; i++) {
      if (!(freshLine[i] >= 0)) return null;
      if (i && !(freshLine[i] > freshLine[i - 1])) return null;
    }

    const lineStart = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStart.push(i + 1);
    const offAt = (ln) => (ln < lineStart.length ? lineStart[ln] : src.length);
    // a fresh block's RANGE runs to the next block's first line, so the
    // blank lines and definition lines after it travel with it untouched
    const freshEnd = freshLine.map((_, i) =>
      (i + 1 < freshLine.length ? freshLine[i + 1] : lineStart.length));
    const freshMd = fresh.map((el) => nodesMd([el]));
    const idxByLine = new Map(freshLine.map((d, i) => [d, i]));

    const pieces = [];
    let seg = [];              // live blocks awaiting fresh serialization
    let posLn = 0;             // first source line not yet accounted for
    let lastFresh = -1;
    let endedWithSeg = false;
    const flushSeg = (uptoLn) => {
      const replaced = src.slice(offAt(posLn), offAt(uptoLn));
      const out = seg.length ? nodesMd(seg) : '';
      seg = [];
      posLn = uptoLn;
      if (!out && !replaced) return true;
      if (DEF_LINE.test(replaced)) return false;
      if (out) { pieces.push(out + '\n\n'); endedWithSeg = true; }
      return true;
    };

    for (const el of live) {
      const d = el.dataset && el.dataset.line != null ? +el.dataset.line : NaN;
      const fi = idxByLine.has(d) ? idxByLine.get(d) : -1;
      if (fi > lastFresh && nodesMd([el]) === freshMd[fi]) {
        if (!flushSeg(freshLine[fi])) return null;
        pieces.push(src.slice(offAt(freshLine[fi]), offAt(freshEnd[fi])));
        posLn = freshEnd[fi];
        lastFresh = fi;
        endedWithSeg = false;
      } else {
        seg.push(el);
      }
    }
    if (lastFresh < 0) return null;              // nothing anchored: no gain
    if (!flushSeg(lineStart.length)) return null;

    let out = pieces.join('');
    if (!out.trim()) return null;
    // a trailing SEGMENT tidies its end the way whole-doc mode would; a
    // trailing anchor slice is the file's own ending, kept byte-for-byte
    if (endedWithSeg) out = out.replace(/\n+$/, '') + '\n';
    return out;
  };
})();
