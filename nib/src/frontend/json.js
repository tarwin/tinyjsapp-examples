// JSON with comments — one tokenizer, three jobs: colour it in the editor,
// say precisely what is wrong with it, and lay it out again without losing a
// word of what you wrote around it.
//
// Nib's own config files (`.nib/settings.json`, both actions files) are meant
// to be read and edited by a person, so they are JSONC: `//` and `/* */`
// survive, and a trailing comma is forgiven. That makes a plain JSON.parse
// useless here for two separate reasons — it rejects the comments, and when
// it does reject something WebKit's message is "JSON Parse error: Expected
// '}'" with no idea where. So this file parses the tokens itself and reports
// a line and a column you can jump to.
//
// The formatter is the same idea in reverse: parse to a tiny tree that carries
// the comments along with the values they were written next to, then print it.
// A container that has no comments in it and fits on one line stays on one
// line — an actions file whose every entry exploded into eight rows would be
// "formatted" and much worse to read.

(() => {
  const isDigit = (c) => c >= '0' && c <= '9';
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n';

  // ------------------------------------------------------------- tokenizer

  function tokenize(text) {
    const out = [];
    let i = 0, line = 1, col = 1;
    const at = () => ({ i, line, col });
    const push = (t, v, p) => out.push({ t, v, i: p.i, line: p.line, col: p.col });
    const step = (n) => {
      for (let k = 0; k < n; k++) {
        if (text[i] === '\n') { line++; col = 1; } else col++;
        i++;
      }
    };
    while (i < text.length) {
      const c = text[i], p = at();
      if (isSpace(c)) {
        let j = i;
        while (j < text.length && isSpace(text[j])) j++;
        const v = text.slice(i, j);
        step(j - i);
        push('ws', v, p);
        continue;
      }
      if (c === '/' && text[i + 1] === '/') {
        let j = i;
        while (j < text.length && text[j] !== '\n') j++;
        const v = text.slice(i, j);
        step(j - i);
        push('comment', v, p);
        continue;
      }
      if (c === '/' && text[i + 1] === '*') {
        let j = i + 2;
        while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++;
        j = Math.min(text.length, j + 2);
        const v = text.slice(i, j);
        step(j - i);
        push('comment', v, p);
        continue;
      }
      if (c === '"') {
        let j = i + 1, closed = false;
        while (j < text.length) {
          if (text[j] === '\\') { j += 2; continue; }
          if (text[j] === '"') { closed = true; j++; break; }
          if (text[j] === '\n') break;              // an unterminated string
          j++;
        }
        const v = text.slice(i, j);
        step(j - i);
        push(closed ? 'str' : 'bad', v, p);
        continue;
      }
      if (isDigit(c) || (c === '-' && isDigit(text[i + 1]))) {
        let j = i + 1;
        while (j < text.length && /[\d.eE+-]/.test(text[j])) j++;
        const v = text.slice(i, j);
        step(j - i);
        push('num', v, p);
        continue;
      }
      if (/[a-zA-Z_$]/.test(c)) {
        let j = i;
        while (j < text.length && /[\w$]/.test(text[j])) j++;
        const v = text.slice(i, j);
        step(j - i);
        push(v === 'true' || v === 'false' || v === 'null' ? 'lit' : 'bad', v, p);
        continue;
      }
      if ('{}[]:,'.includes(c)) { step(1); push('punct', c, p); continue; }
      step(1);
      push('bad', c, p);
    }
    return out;
  }

  // ---------------------------------------------------------------- parser
  //
  // Over the significant tokens, with the comments in between kept and hung
  // on whatever comes next (or, when they sit at the end of a line with
  // something before them, on what came before — a trailing note).

  function parse(text) {
    const toks = tokenize(text);
    let k = 0;

    const err = (msg, tok) => {
      const t = tok || toks[k] || { line: lastLine(), col: lastCol() };
      const e = new Error(msg + ' (line ' + t.line + ', column ' + t.col + ')');
      e.line = t.line; e.col = t.col; e.short = msg;
      throw e;
    };
    const lastLine = () => (text.split('\n').length);
    const lastCol = () => (text.length - text.lastIndexOf('\n'));

    // Comments (and whether a blank line preceded them, which is worth
    // keeping — a paragraph break in a config file is deliberate).
    function trivia() {
      const got = [];
      let newlines = 0;
      while (k < toks.length && (toks[k].t === 'ws' || toks[k].t === 'comment')) {
        if (toks[k].t === 'ws') newlines += (toks[k].v.match(/\n/g) || []).length;
        else { got.push({ text: toks[k].v, blankBefore: newlines > 1, sameLine: newlines === 0 }); newlines = 0; }
        k++;
      }
      return { comments: got, blankBefore: newlines > 1 };
    }

    const peek = () => toks[k];
    const isPunct = (v) => peek() && peek().t === 'punct' && peek().v === v;

    function value() {
      const t = peek();
      if (!t) err('Unexpected end of file — a value was expected');
      if (t.t === 'punct' && t.v === '{') return container('}');
      if (t.t === 'punct' && t.v === '[') return container(']');
      if (t.t === 'str' || t.t === 'num' || t.t === 'lit') { k++; return { kind: 'lit', raw: t.v }; }
      if (t.t === 'bad' && t.v.startsWith('"')) err('Unterminated string', t);
      if (t.t === 'bad' && /^[a-zA-Z_$]/.test(t.v)) {
        err('“' + t.v + '” is not valid here — strings need double quotes', t);
      }
      return err('Unexpected “' + t.v + '”', t);
    }

    // Objects and arrays differ only in what one member looks like, so they
    // share the loop — and with it the whole business of deciding which side
    // of a comma a comment belongs to. The rule: a comment on the SAME LINE
    // as the value it follows is that member's trailing note; anything else
    // leads whatever comes next (or ends the container).
    function container(close) {
      const open = peek();
      const obj = close === '}';
      k++;
      const list = [];
      let carried = [];
      for (;;) {
        const lead = trivia();
        if (!peek()) err('Unclosed “' + (obj ? '{' : '[') + '”', open);
        if (isPunct(close)) {
          k++;
          return obj ? { kind: 'obj', members: list, tail: carried.concat(lead.comments) }
            : { kind: 'arr', items: list, tail: carried.concat(lead.comments) };
        }
        const item = { lead: carried.concat(lead.comments), blankBefore: lead.blankBefore, trail: [] };
        carried = [];
        if (obj) {
          const kt = peek();
          if (!kt || kt.t !== 'str') {
            if (kt && kt.t === 'bad' && /^[a-zA-Z_$]/.test(kt.v)) {
              err('Keys must be in double quotes: "' + kt.v + '"', kt);
            }
            err('A key was expected', kt);
          }
          k++;
          item.key = kt.v;
          trivia();
          if (!isPunct(':')) err('Expected “:” after ' + kt.v, peek() || kt);
          k++;
          trivia();
        }
        item.value = value();
        list.push(item);

        const after = trivia();
        item.trail = after.comments.filter((c) => c.sameLine);
        carried = after.comments.filter((c) => !c.sameLine);
        if (isPunct(',')) {
          k++;
          const post = trivia();                     // `1, // note` — still this one's
          item.trail = item.trail.concat(post.comments.filter((c) => c.sameLine));
          carried = carried.concat(post.comments.filter((c) => !c.sameLine));
          continue;
        }
        if (isPunct(close)) { k++;
          return obj ? { kind: 'obj', members: list, tail: carried }
            : { kind: 'arr', items: list, tail: carried };
        }
        if (!peek()) err('Unclosed “' + (obj ? '{' : '[') + '”', open);
        err('Expected “,” or “' + close + '”', peek());
      }
    }

    const head = trivia();
    if (!peek()) err('The file is empty');
    const root = value();
    const tailTrivia = trivia();
    if (peek()) err('Unexpected “' + peek().v + '” after the end of the document', peek());
    return { root, head: head.comments, tail: tailTrivia.comments };
  }

  // ------------------------------------------------------------- the check

  function check(text) {
    try {
      return { ok: true, tree: parse(text) };
    } catch (e) {
      return { ok: false, message: e.short || e.message, line: e.line || 1, col: e.col || 1,
        full: e.message };
    }
  }

  // ------------------------------------------------------------ the format

  function format(text, opts) {
    const r = check(text);
    if (!r.ok) throw Object.assign(new Error(r.full), r);
    return printTree(r.tree, opts);
  }

  // The same layout, from a tree rather than from text — which is what lets
  // the actions editor change one entry and write the file back with every
  // comment around it still in place.
  function printTree(t, { indent = 2, width = 100 } = {}) {
    const pad = (d) => ' '.repeat(indent * d);
    const out = [];

    const hasComment = (n) => {
      if (!n) return false;
      if (n.kind === 'obj') {
        return n.members.some((m) => m.lead.length || m.trail.length || hasComment(m.value))
          || n.tail.length > 0;
      }
      if (n.kind === 'arr') {
        return n.items.some((it) => it.lead.length || it.trail.length || hasComment(it.value))
          || n.tail.length > 0;
      }
      return false;
    };

    // one line, no comments — used to decide whether a container can collapse
    const inline = (n) => {
      if (n.kind === 'lit') return n.raw;
      if (n.kind === 'obj') {
        return n.members.length
          ? '{ ' + n.members.map((m) => m.key + ': ' + inline(m.value)).join(', ') + ' }' : '{}';
      }
      return n.items.length ? '[' + n.items.map((it) => inline(it.value)).join(', ') + ']' : '[]';
    };

    const commentLines = (c, d) => {
      // a block comment keeps its own interior; only its first line is placed
      const lines = c.text.split('\n');
      out.push(pad(d) + lines[0].trimEnd());
      for (let i = 1; i < lines.length; i++) out.push(pad(d) + lines[i].trim());
    };

    function emit(n, d, prefix, suffix) {
      if (n.kind === 'lit') { out.push(prefix + n.raw + suffix); return; }
      const empty = n.kind === 'obj' ? !n.members.length : !n.items.length;
      if (empty) { out.push(prefix + (n.kind === 'obj' ? '{}' : '[]') + suffix); return; }
      // A container with nothing written around it stays on one line if it
      // fits — an actions file whose every entry exploded into eight rows
      // would be "formatted" and much worse to read. The prefix already
      // carries the indent, so its own length is the whole measure.
      if (!hasComment(n)) {
        const one = prefix + inline(n) + suffix;
        if (one.length <= width) { out.push(one); return; }
      }
      out.push(prefix + (n.kind === 'obj' ? '{' : '['));
      const list = n.kind === 'obj' ? n.members : n.items;
      list.forEach((m, i) => {
        // Blank lines are deliberate in a hand-written config, so they are
        // kept where they were — above a comment block, or between the block
        // and the member it introduces. Never straight after the brace,
        // though: nothing was ever separated by that one.
        const firstGap = m.lead.length ? m.lead[0].blankBefore : m.blankBefore;
        if (firstGap && i > 0) out.push('');
        m.lead.forEach((c, ci) => {
          if (ci > 0 && c.blankBefore) out.push('');
          commentLines(c, d + 1);
        });
        if (m.lead.length && m.blankBefore) out.push('');
        const head = pad(d + 1) + (n.kind === 'obj' ? m.key + ': ' : '');
        const tail = (i < list.length - 1 ? ',' : '')
          + (m.trail.length ? ' ' + m.trail.map((c) => c.text.trimEnd()).join(' ') : '');
        emit(m.value, d + 1, head, tail);
      });
      for (const c of n.tail) commentLines(c, d + 1);
      out.push(pad(d) + (n.kind === 'obj' ? '}' : ']') + suffix);
    }

    for (const c of t.head) commentLines(c, 0);
    emit(t.root, 0, '', '');
    for (const c of t.tail) commentLines(c, 0);
    return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }

  // ---------------------------------------------------------- the colouring
  //
  // One <div class="ln"> per SOURCE line, exactly like hl.js — the backdrop
  // and the textarea have to wrap identically or the two drift apart.

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ESC[c]);

  function highlight(text) {
    const toks = tokenize(text);
    // is this string a key? — the next significant token is a colon
    const cls = (tok, idx) => {
      if (tok.t === 'comment') return 'tk-quote';
      if (tok.t === 'num' || tok.t === 'lit') return 'tk-cb';
      if (tok.t === 'bad') return 'tk-bad';
      if (tok.t === 'punct') return 'tk-p';
      if (tok.t === 'str') {
        for (let j = idx + 1; j < toks.length; j++) {
          if (toks[j].t === 'ws' || toks[j].t === 'comment') continue;
          return toks[j].t === 'punct' && toks[j].v === ':' ? 'tk-h' : 'tk-link';
        }
        return 'tk-link';
      }
      return '';
    };
    const rows = [''];
    const add = (html) => { rows[rows.length - 1] += html; };
    toks.forEach((tok, idx) => {
      const c = cls(tok, idx);
      const parts = tok.v.split('\n');
      parts.forEach((part, pi) => {
        if (pi) rows.push('');
        if (!part) return;
        add(c ? '<span class="' + c + '">' + esc(part) + '</span>' : esc(part));
      });
    });
    return rows.map((r) => '<div class="ln">' + (r || ' ') + '</div>').join('');
  }

  // The data a tree holds, with the comments and the layout thrown away —
  // used to prove a reformat changed nothing that matters. Keys keep their
  // written order, which is what makes a plain stringify comparable.
  function toValue(n) {
    if (n.kind === 'lit') return JSON.parse(n.raw);
    if (n.kind === 'arr') return n.items.map((it) => toValue(it.value));
    const o = {};
    for (const m of n.members) o[JSON.parse(m.key)] = toValue(m.value);
    return o;
  }

  // Format, but only hand back a result that provably says the same thing.
  // This runs on SAVE, over a file the person did not ask to have rewritten —
  // so a formatter bug must cost them nothing. Returns null to mean "leave it
  // exactly as they wrote it".
  function safeFormat(text, opts) {
    const before = check(text);
    if (!before.ok) return null;
    let out;
    try { out = format(text, opts); } catch { return null; }
    const after = check(out);
    if (!after.ok) return null;
    try {
      if (JSON.stringify(toValue(before.tree.root)) !== JSON.stringify(toValue(after.tree.root))) {
        return null;
      }
    } catch { return null; }
    // …and every comment that went in comes out again
    const comments = (t) => (t.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) || []).length;
    if (comments(out) < comments(text)) return null;
    return out;
  }

  // A plain value as tree nodes, so an edited action can be spliced back in.
  // Anything undefined is dropped rather than written as null — an action file
  // should say what it means and stay quiet about the rest.
  function fromValue(v) {
    if (Array.isArray(v)) {
      return { kind: 'arr', items: v.filter((x) => x !== undefined)
        .map((x) => ({ lead: [], trail: [], value: fromValue(x) })), tail: [] };
    }
    if (v && typeof v === 'object') {
      return { kind: 'obj', tail: [], members: Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .map((k) => ({ key: JSON.stringify(k), lead: [], trail: [], value: fromValue(v[k]) })) };
    }
    return { kind: 'lit', raw: JSON.stringify(v === undefined ? null : v) };
  }

  window.jsonc = { check, format, printTree, safeFormat, highlight, tokenize, toValue, fromValue };
})();
