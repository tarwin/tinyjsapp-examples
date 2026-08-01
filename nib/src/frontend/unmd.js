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
// are rebuilt with even pipes. That's the deal Live mode makes.

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
      // the spelling it was written with (--- vs *** matters once View ▸
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
      default: {
        // page breaks: an empty div that must not vanish — it goes back out
        // in the spelling it was written with (md.js kept it in data-text)
        if (el.classList.contains('pgbrk')) return el.dataset.text || '\\newpage';
        if (el.classList.contains('tabs')) {
          const labels = [...el.querySelectorAll(':scope > label')];
          const panes = [...el.querySelectorAll(':scope > .tp')];
          const out = panes.map((pane, k) => {
            const title = labels[k] ? inlineOf([...labels[k].childNodes]).trim() : 'Tab ' + (k + 1);
            return '== ' + title + '\n' + blocks(pane);
          });
          return '::: tabs\n\n' + out.join('\n\n') + '\n\n:::';
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
})();
