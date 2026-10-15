// Editing a site menu IN ITS OWN FILE: move an entry, rename it, remove it,
// add a page. Every edit is surgery on the text, never a rewrite — the lines
// (or the literal) that change are the only ones that do, so comments, odd
// formatting, helper functions and everything around the menu survive.
//
// Three kinds of source, three surgeons:
//
//   lines — a Markdown list (SUMMARY.md, _sidebar.md, _Sidebar.md) or
//           mkdocs.yml's nav. Each entry is one line; its children are the
//           more-indented lines under it. Moving is cutting that block and
//           re-indenting it where it lands.
//   code  — a JS/TS literal (VitePress, Docusaurus, Starlight, Rspress).
//           Each entry has its exact source span (menuparse.js keeps them);
//           moving is cutting that span with its comma and splicing it in
//           beside another, with the indentation of where it lands.
//   json  — Mintlify's docs.json: parsed, changed, written back with the
//           file's own indent. JSON has no comments to lose.
//
// The reader (menus.js) is run fresh before every edit, so spans and lines
// are never stale; menus.js marks what this file can edit (`editable`).

// ----------------------------------------------------------------- helpers

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

function relPath(fromDir, target) {
  const a = fromDir.split('/').filter(Boolean);
  const b = target.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return '../'.repeat(a.length - i) + b.slice(i).join('/');
}

// '0.2.1' -> the item, its parent list, its index in that list
function locate(menu, at) {
  if (at === null || at === undefined || at === '') return { item: null, list: menu.items, index: -1, parent: null };
  const ids = String(at).split('.').map(Number);
  let list = menu.items, parent = null, item = null;
  for (let k = 0; k < ids.length; k++) {
    item = list && list[ids[k]];
    if (!item) return null;
    if (k < ids.length - 1) { parent = item; list = item.items; }
  }
  return { item, list, index: ids[ids.length - 1], parent };
}

const inside = (a, b) => String(b).startsWith(String(a) + '.');   // b is under a

// ===================================================================== lines

const indentOf = (l) => (l.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length);
const isHeading = (l) => /^#{1,6}\s/.test(l);
const isRule = (l) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);

// [start, end) of the lines an entry owns: itself and everything more
// indented under it. A part heading owns up to the next heading or rule.
function blockOf(lines, n, item) {
  if (item && item.part) {
    let e = n + 1;
    while (e < lines.length && !isHeading(lines[e]) && !isRule(lines[e])) e++;
    while (e > n + 1 && !lines[e - 1].trim()) e--;
    return [n, e];
  }
  const ind = indentOf(lines[n]);
  let e = n + 1, last = n + 1;
  for (; e < lines.length; e++) {
    const l = lines[e];
    if (!l.trim()) continue;
    if (isHeading(l) || indentOf(l) <= ind) break;
    last = e + 1;
  }
  return [n, last];
}

// the indent one level deeper than `ind`, as this file writes it
function stepOf(lines) {
  let step = 0;
  for (let n = 1; n < lines.length; n++) {
    const d = indentOf(lines[n]) - indentOf(lines[n - 1]);
    if (d > 0 && /^\s*([-*+]|\d+[.)])\s/.test(lines[n]) && (!step || d < step)) step = d;
  }
  return step || 2;
}

function reindent(block, delta) {
  if (!delta) return block;
  return block.map((l) => {
    if (!l.trim()) return l;
    if (delta > 0) return ' '.repeat(delta) + l;
    const cut = Math.min(-delta, indentOf(l));
    return l.replace(/^[ \t]*/, (w) => w.replace(/\t/g, '    ').slice(cut));
  });
}

// Where a new block goes, and at what indent: before/after an entry, or
// as the last child of a group (a part heading's children sit at indent 0).
function landing(lines, menu, target, where, step) {
  if (!target.item) {
    // the end of the menu: after the last line any entry owns
    let last = -1;
    const walk = (items) => { for (const it of items || []) { if (it.line != null) last = Math.max(last, blockOf(lines, it.line, it)[1]); walk(it.items); } };
    walk(menu.items);
    const first = menu.items.find((it) => it.line != null && !it.part);
    return { at: last < 0 ? lines.length : last, ind: first ? indentOf(lines[first.line]) : 0 };
  }
  const t = target.item;
  if (t.line == null) return null;
  if (where === 'before') return { at: t.line, ind: t.part ? 0 : indentOf(lines[t.line]) };
  const [, end] = blockOf(lines, t.line, t);
  if (where === 'after') return { at: end, ind: t.part ? 0 : indentOf(lines[t.line]) };
  // inside: as its last child
  if (t.part) return { at: end, ind: 0 };
  const kid = (t.items || []).find((k) => k.line != null);
  return { at: end, ind: kid ? indentOf(lines[kid.line]) : indentOf(lines[t.line]) + step };
}

// YAML lists of mappings (Quarto, Jupyter Book, Jekyll's navigation.yml):
// the key an entry's link is written under, and its name when the reader
// didn't say (a bare `- page.qmd` has neither until it's renamed)
const YLINK = { quarto: 'href', jbook: 'file', myst: 'file', jekyll: 'url' };
const YLABEL = { quarto: 'text', jbook: 'title', myst: 'title', jekyll: 'title' };
const yq = (t) => (/^[\w][\w .,/()&+-]*$/.test(t) && !/^(true|false|null|yes|no|~|-?\d+(\.\d+)?)$/i.test(t) && !/\s$/.test(t)
  ? t : JSON.stringify(t));
const isMapping = (t) => /^("[^"]*"|'[^']*'|[^:'"\s][^:]*?)\s*:(\s|$)/.test(t);

function ymapRename(lines, it, menu, name) {
  const n = it.line;
  const m = /^(\s*-\s+)(.*)$/.exec(lines[n]);
  if (!m) return 'That entry isn’t a list item any more.';
  const pad = ' '.repeat(m[1].length);
  const key = it.ylabel || YLABEL[menu.flavor];
  const re = new RegExp('^' + key + '\\s*:');
  if (re.test(m[2])) { lines[n] = m[1] + key + ': ' + yq(name); return null; }
  const [, end] = blockOf(lines, n, it);
  for (let k = n + 1; k < end; k++) {
    if (lines[k].startsWith(pad) && !/^\s/.test(lines[k].slice(pad.length)) && re.test(lines[k].slice(pad.length))) {
      lines[k] = pad + key + ': ' + yq(name);
      return null;
    }
  }
  // not named yet: a bare `- page.qmd` becomes a mapping that can be
  if (!isMapping(m[2])) lines[n] = m[1] + YLINK[menu.flavor] + ': ' + m[2];
  lines.splice(n + 1, 0, pad + key + ': ' + yq(name));
  return null;
}

// Landing INSIDE a YAML-map group with no children yet: under its child key
// (`contents:`, `children:` …), which is added when it isn't there
function ymapInside(lines, t) {
  const m = /^(\s*-\s+)/.exec(lines[t.line]);
  const padLen = m ? m[1].length : indentOf(lines[t.line]) + 2;
  const [, end] = blockOf(lines, t.line, t);
  const key = t.ychild;
  if (new RegExp('^\\s*-\\s+' + key + '\\s*:\\s*$').test(lines[t.line])) return { at: t.line + 1, ind: padLen + 2, header: null };
  for (let k = t.line + 1; k < end; k++) {
    if (new RegExp('^\\s*' + key + '\\s*:\\s*(\\[\\s*\\])?\\s*$').test(lines[k])) {
      if (/\[\s*\]/.test(lines[k])) lines[k] = lines[k].replace(/\s*\[\s*\]\s*$/, '');
      return { at: k + 1, ind: indentOf(lines[k]) + 2, header: null };
    }
  }
  return { at: end, ind: padLen + 2, header: ' '.repeat(padLen) + key + ':' };
}

// After a cut at line `a`: a child key (`sections:`) left with nothing under
// it would read as null and break the site's build — take it out too.
// Returns how many lines went, so a landing spot below can be adjusted.
function dropEmptyKey(lines, a) {
  const k = a - 1;
  if (k < 0 || !/^\s*[\w-]+\s*:\s*$/.test(lines[k]) || /^\s*-\s/.test(lines[k])) return 0;
  let n = a;
  while (n < lines.length && !lines[n].trim()) n++;
  if (n < lines.length && indentOf(lines[n]) > indentOf(lines[k])) return 0;
  if (n < lines.length && indentOf(lines[n]) === indentOf(lines[k]) && /^\s*-\s/.test(lines[n])) return 0;  // `key:\n- item` at the same indent
  lines.splice(k, 1);
  return 1;
}

function markerOf(lines, menu, yaml) {
  if (yaml) return '-';
  for (const l of lines) { const m = /^\s*([-*+])\s/.exec(l); if (m) return m[1]; }
  return '-';
}

function lineEdit(text, menu, op, ctx) {
  const lines = text.split('\n');
  const ymap = menu.source.kind === 'yamlmap';
  const yaml = menu.source.kind === 'yamllist' || ymap;
  const step = stepOf(lines);
  const src = op.at != null ? locate(menu, op.at) : null;
  if (op.at != null && (!src || !src.item || src.item.line == null)) return { error: 'That entry isn’t in the file any more.' };

  if (op.kind === 'rename') {
    const n = src.item.line;
    const l = lines[n];
    const name = String(op.text).replace(/\n/g, ' ').trim();
    if (!name) return { error: 'A name can’t be empty.' };
    if (ymap) {
      const err = ymapRename(lines, src.item, menu, name);
      return err ? { error: err } : { text: lines.join('\n') };
    }
    if (yaml) {
      const m = /^(\s*-\s+)(.*)$/.exec(l);
      const kv = /^(['"]?)(.*?)\1\s*:\s*(.*)$/.exec(m[2]);
      const q = (t) => (/[:#'"{}[\],&*?|<>=!%@`]/.test(t) || /^\s|\s$/.test(t) ? '"' + t.replace(/["\\]/g, '\\$&') + '"' : t);
      lines[n] = kv && !/^https?:/.test(m[2]) ? m[1] + q(name) + ':' + (kv[3] ? ' ' + kv[3] : '')
        : m[1] + q(name) + ': ' + m[2];                    // `- page.md` -> `- Name: page.md`
    } else if (src.item.part || isHeading(l)) {
      lines[n] = l.replace(/^(#{1,6}\s+).*$/, '$1' + name);
    } else if (/\[[^\]]*\]\(/.test(l)) {
      lines[n] = l.replace(/\[((?:[^\]\\]|\\.)*)\]\(/, () => '[' + name.replace(/[[\]]/g, '\\$&') + '](');
    } else if (/\[\[[^\]]+\]\]/.test(l)) {
      // [[Page]] -> [[Name|Page]]
      lines[n] = l.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/, (w, a, b) => '[[' + name + '|' + (b || a) + ']]');
    } else {
      lines[n] = l.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/, (w, h) => h + name);
    }
    return { text: lines.join('\n') };
  }

  if (op.kind === 'remove') {
    const [a, b] = blockOf(lines, src.item.line, src.item);
    lines.splice(a, b - a);
    if (ymap) dropEmptyKey(lines, a);
    return { text: lines.join('\n') };
  }

  const target = op.to != null ? locate(menu, op.to) : { item: null };
  if (!target) return { error: 'Can’t find where to put it.' };
  if (op.kind === 'move' && (op.to === op.at || inside(op.at, op.to))) return { error: 'Can’t move an entry into itself.' };
  if (target.item && target.item.part && op.kind === 'move' && !src.item.part && op.where !== 'inside') {
    // beside a part heading means "into the part", at its top or bottom
    op = { ...op, where: 'inside' };
  }
  let land;
  if (ymap && op.where === 'inside' && target.item) {
    if (!target.item.ychild || target.item.line == null) return { error: 'Only a group can hold entries — drop it beside this one instead.' };
    land = (target.item.items || []).some((k) => k.line != null) ? landing(lines, menu, target, 'inside', step) : ymapInside(lines, target.item);
  } else land = landing(lines, menu, target, op.where, step);
  if (!land) return { error: 'Can’t find where to put it.' };
  const head = land.header ? [land.header] : [];

  let block;
  if (op.kind === 'move') {
    const [a, b] = blockOf(lines, src.item.line, src.item);
    block = lines.slice(a, b);
    if (src.item.part) {
      if (target.item && !target.item.part) return { error: 'A part can only move beside another part.' };
    } else block = reindent(block, land.ind - indentOf(lines[a]));
    let at = land.at;
    if (at > a && at < b) return { error: 'Can’t move an entry into itself.' };
    lines.splice(a, b - a);
    if (at > a) at -= b - a;
    if (ymap && dropEmptyKey(lines, a) && at >= a) at -= 1;
    lines.splice(at, 0, ...head, ...block);
    return { text: lines.join('\n') };
  }

  if (op.kind === 'add') {
    const link = op.link;
    const title = op.text;
    const pad = ' '.repeat(land.ind);
    const mk = markerOf(lines, menu, yaml);
    let line;
    if (ymap) {
      const f = menu.flavor;
      const add = f === 'jekyll' ? [pad + '- title: ' + yq(title || link), pad + '  url: ' + link]
        : f === 'quarto' ? [pad + '- ' + link] : [pad + '- file: ' + link];
      lines.splice(land.at, 0, ...head, ...add);
      return { text: lines.join('\n') };
    }
    if (yaml) line = pad + '- ' + (title ? JSON.stringify(title) + ': ' : '') + link;
    else if (menu.flavor === 'wiki') line = pad + mk + ' [[' + (title && title !== link ? title + '|' : '') + link + ']]';
    else line = pad + mk + ' [' + (title || link).replace(/[[\]]/g, '\\$&') + '](' + (/[\s()]/.test(link) ? '<' + link + '>' : link) + ')';
    lines.splice(land.at, 0, line);
    return { text: lines.join('\n') };
  }
  return { error: 'Unknown edit.' };
}

// ====================================================================== code

const lineStartOf = (src, i) => src.lastIndexOf('\n', i - 1) + 1;
const padBefore = (src, i) => src.slice(lineStartOf(src, i), i);
const ownLine = (src, s) => !padBefore(src, s).trim();

// The text an element owns: from its line start (when it's alone on the
// line) through its comma, a trailing comment and the newline — so cutting
// it leaves no blank line or stray comma. Inline elements own just
// themselves and the comma after.
function regionOf(src, [s, e]) {
  const tail = /^[ \t]*,?[ \t]*(\/\/[^\n]*)?\n?/.exec(src.slice(e))[0];
  if (ownLine(src, s) && tail.endsWith('\n')) return [lineStartOf(src, s), e + tail.length, true];
  const comma = /^\s*,\s*/.exec(src.slice(e));
  if (comma) return [s, e + comma[0].length, false];
  // last inline element: take the comma BEFORE it instead
  const before = /,\s*$/.exec(src.slice(0, s));
  return before ? [before.index, e, false] : [s, e, false];
}

// Move every line after the first by `delta` columns
function shiftLines(text, delta) {
  if (!delta) return text;
  return text.split('\n').map((l, k) => {
    if (!k || !l.trim()) return l;
    if (delta > 0) return ' '.repeat(delta) + l;
    return l.replace(new RegExp('^[ \\t]{0,' + (-delta) + '}'), '');
  }).join('\n');
}

const quoteOf = (src) => ((src.match(/'/g) || []).length >= (src.match(/"/g) || []).length ? "'" : '"');
const lit = (s, q) => q + String(s).replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q).replace(/\n/g, '\\n') + q;

// Apply non-overlapping splices, last first
function splice(src, edits) {
  edits.sort((a, b) => b.s - a.s || b.e - a.e);
  for (const { s, e, text } of edits) src = src.slice(0, s) + text + src.slice(e);
  return src;
}

// Where to insert a new element and how: before/after a sibling, or at the
// end of an array (a group's items, or the menu itself).
function codeLanding(src, menu, target, where) {
  const t = target.item;
  let arr = null;                                  // [s, e] of an array literal
  if (!t) arr = menu.arraySpan;
  else if (where === 'inside') {
    if (!t.itemsSpan) return { error: t.kind === 'group' ? 'This group’s entries are built by code.' : 'Only a group can hold entries — drop it beside this one instead.' };
    arr = t.itemsSpan;
  }
  if (arr) {
    const kids = !t ? menu.items : t.items || [];
    const last = [...kids].reverse().find((k) => k.span);
    if (last) return codeLanding(src, menu, { item: last }, 'after');
    // an empty array: `[]` becomes a multi-line one
    const ind = padBefore(src, arr[0]).match(/^\s*/)[0];
    return { s: arr[0], e: arr[1], empty: true, ind };
  }
  if (!t.span) return { error: 'That entry is built by code.' };
  const own = ownLine(src, t.span[0]);
  const ind = own ? padBefore(src, t.span[0]) : null;
  if (where === 'before') return { s: own ? lineStartOf(src, t.span[0]) : t.span[0], own, ind, before: true };
  // after: past its comma (adding one if it was the last element)
  const tail = /^[ \t]*,/.exec(src.slice(t.span[1]));
  if (own) {
    const r = regionOf(src, t.span);
    return { s: r[1], own, ind, needComma: !tail && t.span[1] };
  }
  // inline: after its comma (`a, |b`), or with a new one if it was last (`a|]`)
  const comma = /^\s*,[ \t]*/.exec(src.slice(t.span[1]));
  return comma ? { s: t.span[1] + comma[0].length, own: false, before: true }
    : { s: t.span[1], own: false, inlineLast: true };
}

function insertAt(src, land, elemText) {
  if (land.empty) {
    const body = '[\n' + land.ind + '  ' + shiftLines(elemText, 0) + ',\n' + land.ind + ']';
    return [{ s: land.s, e: land.e, text: body }];
  }
  const edits = [];
  if (land.needComma) edits.push({ s: land.needComma, e: land.needComma, text: ',' });
  if (land.own) edits.push({ s: land.s, e: land.s, text: land.ind + elemText + ',\n' });
  else if (land.before) edits.push({ s: land.s, e: land.s, text: elemText + ', ' });
  else edits.push({ s: land.s, e: land.s, text: ', ' + elemText });
  return edits;
}

function codeEdit(src, menu, op, site) {
  const at = op.at != null ? locate(menu, op.at) : null;
  if (op.at != null && (!at || !at.item)) return { error: 'That entry isn’t in the file any more.' };
  const q = quoteOf(src);

  if (op.kind === 'rename') {
    const it = at.item;
    const name = String(op.text).trim();
    if (!name) return { error: 'A name can’t be empty.' };
    if (it.textSpan) return { text: splice(src, [{ s: it.textSpan[0], e: it.textSpan[1], text: lit(name, q) }]) };
    if (!it.span) return { error: 'That entry is built by code.' };
    const body = src.slice(it.span[0], it.span[1]);
    const key = menu.flavor === 'vitepress' ? 'text' : 'label';
    if (body.startsWith('{')) {
      return { text: splice(src, [{ s: it.span[0] + 1, e: it.span[0] + 1, text: ' ' + key + ': ' + lit(name, q) + ',' }]) };
    }
    // a bare 'doc-id' / 'slug' string: spell it out so it can carry a label
    const v = body.slice(1, -1);
    const obj = menu.flavor === 'docusaurus' ? `{ type: ${lit('doc', q)}, id: ${lit(v, q)}, label: ${lit(name, q)} }`
      : menu.flavor === 'starlight' ? `{ label: ${lit(name, q)}, slug: ${lit(v, q)} }`
        : `{ text: ${lit(name, q)}, link: ${lit(v, q)} }`;
    return { text: splice(src, [{ s: it.span[0], e: it.span[1], text: obj }]) };
  }

  if (op.kind === 'remove') {
    if (!at.item.span) return { error: 'That entry is built by code.' };
    const r = regionOf(src, at.item.span);
    return { text: splice(src, [{ s: r[0], e: r[1], text: '' }]) };
  }

  const target = op.to != null ? locate(menu, op.to) : { item: null };
  if (!target) return { error: 'Can’t find where to put it.' };
  if (op.kind === 'move' && (op.to === op.at || inside(op.at, op.to))) return { error: 'Can’t move an entry into itself.' };
  const land = codeLanding(src, menu, target, op.where);
  if (land.error) return land;

  let elem, cut = null;
  if (op.kind === 'move') {
    if (!at.item.span) return { error: 'That entry is built by code.' };
    const [s, e] = at.item.span;
    const r = regionOf(src, [s, e]);
    if (land.s > r[0] && land.s < r[1]) return { error: 'Can’t move an entry into itself.' };
    cut = { s: r[0], e: r[1], text: '' };
    const fromInd = ownLine(src, s) ? padBefore(src, s).length : 0;
    const toInd = land.own ? land.ind.length : land.empty ? land.ind.length + 2 : fromInd;
    elem = shiftLines(src.slice(s, e), toInd - fromInd);
  } else if (op.kind === 'add') {
    elem = menu.flavor === 'docusaurus' ? lit(op.link, q)
      : menu.flavor === 'starlight' ? (op.text ? `{ label: ${lit(op.text, q)}, slug: ${lit(op.link, q)} }` : lit(op.link, q))
        : `{ text: ${lit(op.text || op.link, q)}, link: ${lit(op.link, q)} }`;
  } else return { error: 'Unknown edit.' };

  const edits = insertAt(src, land, elem);
  if (cut) {
    // a comma added after the old last element may sit inside the cut — drop it then
    const keep = edits.filter((x) => !(x.text === ',' && x.s >= cut.s && x.s <= cut.e));
    if (keep.some((x) => x.s > cut.s && x.s < cut.e)) return { error: 'Can’t move an entry into itself.' };
    return { text: splice(src, [...keep, cut]) };
  }
  return { text: splice(src, edits) };
}

// ====================================================================== json

// the file's indent step: its smallest one (the first indented line may be nested)
function jsonIndent(text) {
  let best = null;
  for (const m of text.matchAll(/\n([ \t]+)\S/g)) if (!best || m[1].length < best.length) best = m[1];
  return best || '  ';
}

function jsonEdit(text, menu, op) {
  let j;
  try { j = JSON.parse(text); } catch { return { error: 'The file isn’t valid JSON right now.' }; }
  const ind = jsonIndent(text);
  const get = (path) => path.reduce((o, k) => (o == null ? o : o[k]), j);
  const at = op.at != null ? locate(menu, op.at) : null;
  if (op.at != null && (!at || !at.item || !at.item.jpath)) return { error: 'That entry isn’t in the file any more.' };
  const parentOf = (jp) => ({ arr: get(jp.slice(0, -1)), i: jp[jp.length - 1] });

  if (op.kind === 'rename') {
    const it = at.item;
    const name = String(op.text).trim();
    if (menu.flavor === 'vitepress') {
      // a VitePress sidebar kept as JSON: { text, link } — a per-locale
      // { en, ja } label gets just this menu's language changed
      const { arr, i } = parentOf(it.jpath);
      const cur = arr[i];
      if (typeof cur === 'string') arr[i] = { text: name, link: cur };
      else if (cur.text && typeof cur.text === 'object') {
        const k = menu.lang && menu.lang in cur.text ? menu.lang : 'en' in cur.text ? 'en' : Object.keys(cur.text)[0];
        cur.text[k] = name;
      } else cur.text = name;
    } else {
      if (it.kind !== 'group') return { error: 'Mintlify takes a page’s name from its own front matter (title:).' };
      get(it.jpath).group = name;
    }
  } else if (op.kind === 'remove') {
    const { arr, i } = parentOf(at.item.jpath);
    arr.splice(i, 1);
  } else {
    const target = op.to != null ? locate(menu, op.to) : { item: null };
    if (!target) return { error: 'Can’t find where to put it.' };
    if (op.kind === 'move' && (op.to === op.at || inside(op.at, op.to))) return { error: 'Can’t move an entry into itself.' };
    let value;
    if (op.kind === 'move') {
      const { arr, i } = parentOf(at.item.jpath);
      value = arr[i];
      arr[i] = undefined;                               // a hole, so later indices don't shift
    } else value = menu.flavor === 'vitepress' ? { text: op.text || op.link, link: op.link } : op.link;
    let dest, di;
    if (!target.item) { dest = get(menu.listPath); di = dest.length; }
    else if (op.where === 'inside') {
      if (!target.item.listPath) return { error: 'Only a group can hold pages — drop it beside this one instead.' };
      dest = get(target.item.listPath); di = dest.length;
    } else {
      const p = parentOf(target.item.jpath);
      dest = p.arr; di = p.i + (op.where === 'after' ? 1 : 0);
    }
    dest.splice(di, 0, value);
    // close the hole the move left
    const sweep = (o) => {
      if (Array.isArray(o)) { for (let k = o.length - 1; k >= 0; k--) if (o[k] === undefined) o.splice(k, 1); o.forEach(sweep); }
      else if (o && typeof o === 'object') Object.values(o).forEach(sweep);
    };
    sweep(j);
  }
  if (/\n/.test(text.trim())) return { text: JSON.stringify(j, null, ind) + (text.endsWith('\n') ? '\n' : '') };
  return { text: JSON.stringify(j) + (text.endsWith('\n') ? '\n' : '') };
}

// ===================================================== the link to add a page

// How this menu would write a link to project-relative `file`. Checked
// against the site's own resolver (`resolves`), so a link that wouldn't come
// back to the file is never written.
export function linkFor(site, menu, file, resolves) {
  const content = site.content || '';
  const sub = content ? file.slice(content.length + 1) : file;
  const noExt = sub.replace(/\.(mdx?|markdown|qmd|rmd|adoc)$/i, '');
  const tries = [];
  switch (menu.flavor) {
    case 'relative': tries.push(relPath(dirOf(menu.source.file), file)); break;
    case 'docsify': tries.push(content ? file.slice(content.length + 1) : file); break;
    case 'wiki': tries.push(noExt.split('/').pop()); break;
    case 'mkdocs': tries.push(sub); break;
    case 'mintlify': tries.push(noExt); break;
    case 'quarto': tries.push(file.slice(site.root ? site.root.length + 1 : 0)); break;
    case 'jbook': tries.push(file.slice(site.root ? site.root.length + 1 : 0).replace(/\.(md|ipynb|rst|myst)$/i, '')); break;
    case 'myst': tries.push(file.slice(site.root ? site.root.length + 1 : 0)); break;
    case 'jekyll': {
      const r = file.slice(site.root ? site.root.length + 1 : 0).replace(/\.(md|markdown)$/i, '').replace(/(^|\/)index$/, '$1');
      tries.push('/' + r + (r && !r.endsWith('/') ? '/' : ''), '/' + r + '.html');
      break;
    }
    case 'docusaurus': if (menu.ids && menu.ids[file]) tries.push(menu.ids[file]); break;
    case 'starlight': if (menu.slugs && menu.slugs[file] != null) tries.push(menu.slugs[file] || '/'); break;
    case 'vitepress': {
      const clean = noExt.replace(/(^|\/)index$/i, '$1');
      const forms = ['/' + clean];
      // a rewrite like 'en/:rest*' -> ':rest*' means the URL drops 'en/'
      for (const [from, to] of site.rewrites || []) {
        const pre = from.replace(/:.*$/, '');
        const toPre = to.replace(/:.*$/, '');
        if (pre && clean.startsWith(pre)) forms.push('/' + toPre + clean.slice(pre.length));
      }
      // a locale menu written without its /ja prefix (a helper adds it)
      if (menu.scope && menu.note) for (const f of [...forms]) if (f.startsWith(menu.scope)) forms.push(f.slice(menu.scope.length - 1));
      tries.push(...forms.reverse());
      break;
    }
    default: return null;
  }
  for (const t of tries) if (t && resolves(t) === file) return t;
  return null;
}

// =================================================================== the API

// -> { file, text } to write, or { error }
export function applyEdit(site, menu, text, op) {
  if (!menu.editable) return { error: 'Nib can’t edit this menu yet — open its file to change it.' };
  const kind = menu.source.kind;
  if (kind === 'mdlist' || kind === 'yamllist' || kind === 'yamlmap') return lineEdit(text, menu, op);
  if (kind === 'json') return jsonEdit(text, menu, op);
  if (menu.arraySpan) return codeEdit(text, menu, op, site);
  return { error: 'Nib can’t edit this menu yet — open its file to change it.' };
}
