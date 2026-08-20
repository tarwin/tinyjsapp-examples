// md.js — a small Markdown renderer for amp's help window.
//
// Deliberately not a library: amp ships no dependencies, and the docs are
// written for this renderer rather than the other way round. It covers what
// src/docs/*.md actually uses — headings, paragraphs, lists, tables, fenced
// code, blockquotes, rules, and inline code/bold/italic/links.
//
// EVERYTHING is escaped first and the markup added afterwards, because the page
// holding this renderer also holds an RPC channel to the backend.
//
// window.ampMarkdown(text) -> html string

(function () {
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Inline spans. Code is lifted out FIRST and put back LAST, so nothing inside
  // a span of code is re-formatted (a `*` in a code sample must stay a `*`).
  // a character no document will contain, used to park code spans while the
  // rest of the line is escaped and formatted
  const SENT = '\u0001';
  function inline(s) {
    const code = [];
    s = String(s).replace(/`([^`]+)`/g, (m, c) => {
      code.push(c);
      return SENT + (code.length - 1) + SENT;
    });
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
      // doc:<slug> stays inside the help window; anything else is external, and
      // only https ever reaches the browser
      if (/^doc:/.test(href)) return '<a href="#" data-doc="' + esc(href.slice(4)) + '">' + text + '</a>';
      if (/^https:\/\//i.test(href)) return '<a href="#" data-url="' + esc(href) + '">' + text + '</a>';
      return text;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(new RegExp(SENT + '(\\d+)' + SENT, 'g'), (m, i) => '<code>' + esc(code[+i]) + '</code>');
    return s;
  }

  const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  function render(src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0, para = [];
    const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };

    while (i < lines.length) {
      const line = lines[i];

      if (/^```/.test(line)) {                       // fenced code
        flush();
        const body = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
        i++;
        out.push('<pre><code>' + esc(body.join('\n')) + '</code></pre>');
        continue;
      }
      if (/^\s*$/.test(line)) { flush(); i++; continue; }
      if (/^#{1,4}\s/.test(line)) {                  // heading
        flush();
        const n = line.match(/^#+/)[0].length;
        const text = line.replace(/^#+\s*/, '');
        out.push('<h' + n + '>' + inline(text) + '</h' + n + '>');
        i++; continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }

      // table: a pipe row followed by a |---|---| separator
      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        flush();
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        const anyHead = head.some((h) => h !== '');
        out.push('<table>'
          + (anyHead ? '<thead><tr>' + head.map((h) => '<th>' + inline(h) + '</th>').join('') + '</tr></thead>' : '')
          + '<tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('')
          + '</tbody></table>');
        continue;
      }
      if (/^\s*>/.test(line)) {                      // blockquote
        flush();
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push('<blockquote>' + render(body.join('\n')) + '</blockquote>');
        continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {       // list — one level, all the docs use
        flush();
        const ordered = /^\s*\d+\./.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          let text = lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, '');
          // an indented continuation line belongs to the item above it
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]))
            text += ' ' + lines[i++].trim();
          items.push('<li>' + inline(text) + '</li>');
        }
        out.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.join('')
          + '</' + (ordered ? 'ol' : 'ul') + '>');
        continue;
      }
      para.push(line.trim());
      i++;
    }
    flush();
    return out.join('\n');
  }

  window.ampMarkdown = render;
})();
