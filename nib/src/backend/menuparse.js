// The small readers menus.js stands on: a forgiving JS/TS object-literal
// reader, a YAML subset, and front matter. None of them is a real parser for
// its language — each reads the part docs sites actually write their menus in
// and says so (rather than guessing) when it meets anything else.
//
// The JS reader is the interesting one. A VitePress / Docusaurus / Starlight
// sidebar is code, but nearly always code that is one big literal with a type
// annotation stuck on it. So: tokenize, then read a VALUE — objects, arrays,
// strings, numbers, booleans — and turn anything that would need running
// (a call, a variable, a spread, a template with ${}) into a `{ $dyn: text }`
// marker instead of failing. Every value also remembers its source span
// [s, e), which is what lets a later writer replace just that literal and
// leave the rest of the file — comments, imports, helper functions — alone.

// Every parsed key goes through this: these files come from whatever folder
// is open, and a `__proto__:` key (or `[__proto__]` table) assigned onto a
// plain object would reach Object.prototype for the whole backend.
const BAD_KEY = new Set(['__proto__', 'constructor', 'prototype']);
export const safeKey = (k) => !BAD_KEY.has(k);

// ------------------------------------------------------------------ JS / TS

const PUNCT = '{}[](),:;?.=<>!&|+-*/%~^@#';

export function tokenizeJS(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    const s = i;
    if (c === '"' || c === "'") {
      let v = '';
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { v += unescape1(src[i + 1]); i += 2; } else v += src[i++];
      }
      i++;
      out.push({ t: 'str', v, s, e: i });
      continue;
    }
    if (c === '`') {
      let v = '';
      let dyn = false;
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { v += unescape1(src[i + 1]); i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          dyn = true;
          let depth = 0;
          for (; i < n; i++) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}' && --depth === 0) { i++; break; }
          }
          continue;
        }
        v += src[i++];
      }
      i++;
      out.push({ t: dyn ? 'tpl' : 'str', v, s, e: i });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      while (i < n && /[0-9a-fA-FxXoObBeE._n]/.test(src[i])) i++;
      out.push({ t: 'num', v: Number(src.slice(s, i).replace(/_/g, '').replace(/n$/, '')), s, e: i });
      continue;
    }
    if (/[\p{L}_$]/u.test(c)) {
      while (i < n && /[\p{L}\p{N}_$]/u.test(src[i])) i++;
      out.push({ t: 'id', v: src.slice(s, i), s, e: i });
      continue;
    }
    // `...` is the one multi-character punctuator a literal cares about
    if (c === '.' && src[i + 1] === '.' && src[i + 2] === '.') {
      out.push({ t: 'p', v: '...', s, e: i + 3 });
      i += 3;
      continue;
    }
    if (c === '=' && src[i + 1] === '>') { out.push({ t: 'p', v: '=>', s, e: i + 2 }); i += 2; continue; }
    out.push({ t: 'p', v: PUNCT.includes(c) ? c : c, s, e: i + 1 });
    i++;
  }
  return out;
}

function unescape1(c) {
  return c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c === undefined ? '' : c;
}

const isP = (tok, v) => tok && tok.t === 'p' && tok.v === v;
const CLOSE = { '{': '}', '[': ']', '(': ')' };

// Skip one balanced expression from toks[i] to the next `,` / closer at depth
// 0. Used for anything the reader won't interpret — a call, an arrow
// function, a ternary — so the reader can carry on past it.
function skipExpr(toks, i) {
  let depth = 0;
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'p') continue;
    if (t.v === '{' || t.v === '[' || t.v === '(') depth++;
    else if (t.v === '}' || t.v === ']' || t.v === ')') {
      if (depth === 0) return i;
      depth--;
    } else if ((t.v === ',' || t.v === ';') && depth === 0) return i;
  }
  return i;
}

// TS's trailing `as const` / `satisfies X` / `as Foo<Bar>`: read past it.
function skipTypeTail(toks, i) {
  while (toks[i] && toks[i].t === 'id' && (toks[i].v === 'as' || toks[i].v === 'satisfies')) {
    i++;
    let depth = 0;
    for (; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'p' && (t.v === '<' || t.v === '{' || t.v === '[' || t.v === '(')) depth++;
      else if (t.t === 'p' && (t.v === '>' || t.v === '}' || t.v === ']' || t.v === ')')) {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && t.t === 'p' && (t.v === ',' || t.v === ';')) break;
      else if (depth === 0 && t.t === 'id' && i > 0 && toks[i - 1].t === 'id' && toks[i - 1].v !== 'as'
        && toks[i - 1].v !== 'satisfies' && toks[i - 1].v !== 'typeof') break;
    }
  }
  return i;
}

// Read one value starting at toks[i]. Returns { v, s, e, end } where `end` is
// the index of the first token after it. `src` is only used to quote the
// text of anything dynamic.
export function readValue(toks, i, src) {
  const t = toks[i];
  if (!t) return { v: undefined, s: src.length, e: src.length, end: i };
  const done = (v, endTok, j) => {
    const k = skipTypeTail(toks, j);
    return { v, s: t.s, e: endTok.e, end: k };
  };
  if (t.t === 'str') {
    // `'a' + 'b'` is still a constant, but nobody writes menus that way —
    // anything after it that isn't a separator makes the whole thing code
    const nx = toks[i + 1];
    if (nx && nx.t === 'p' && !',;)]}'.includes(nx.v) && nx.v !== ':') return dyn(toks, i, src);
    return done(t.v, t, i + 1);
  }
  if (t.t === 'num') return done(t.v, t, i + 1);
  if (t.t === 'id' && (t.v === 'true' || t.v === 'false' || t.v === 'null' || t.v === 'undefined')) {
    const nx = toks[i + 1];
    if (nx && nx.t === 'p' && !',;)]}'.includes(nx.v)) return dyn(toks, i, src);
    return done(t.v === 'true' ? true : t.v === 'false' ? false : null, t, i + 1);
  }
  if (isP(t, '-') && toks[i + 1] && toks[i + 1].t === 'num') {
    return { v: -toks[i + 1].v, s: t.s, e: toks[i + 1].e, end: i + 2 };
  }
  if (isP(t, '[')) {
    const arr = [];
    // where each element sits, strings included, so a writer can move rows
    const spans = [];
    Object.defineProperty(arr, '$spans', { value: spans, enumerable: false });
    let j = i + 1;
    while (j < toks.length && !isP(toks[j], ']')) {
      if (isP(toks[j], ',')) { j++; continue; }
      if (isP(toks[j], '...')) {
        const k = skipExpr(toks, j + 1);
        arr.push(dynNode(src, toks[j].s, toks[k - 1].e));
        spans.push([toks[j].s, toks[k - 1].e]);
        j = k;
        continue;
      }
      const r = readValue(toks, j, src);
      arr.push(r.v);
      spans.push([r.s, r.e]);
      if (r.v && typeof r.v === 'object') Object.defineProperty(r.v, '$span', { value: [r.s, r.e], enumerable: false });
      j = r.end > j ? r.end : j + 1;
    }
    if (!toks[j]) return { v: arr, s: t.s, e: src.length, end: j };
    return done(arr, toks[j], j + 1);
  }
  if (isP(t, '{')) {
    const obj = {};
    const keys = [];
    let j = i + 1;
    while (j < toks.length && !isP(toks[j], '}')) {
      const k = toks[j];
      if (isP(k, ',')) { j++; continue; }
      if (isP(k, '...')) {
        const end = skipExpr(toks, j + 1);
        (obj.$spread || Object.defineProperty(obj, '$spread', { value: [], enumerable: false }).$spread)
          .push(src.slice(toks[j].s, toks[end - 1].e));
        j = end;
        continue;
      }
      let key = null;
      if (k.t === 'id' || k.t === 'str' || k.t === 'num') key = String(k.v);
      else if (isP(k, '[')) {                     // [computed]: v
        const end = skipExpr(toks, j + 1);
        key = '[' + src.slice(toks[j + 1].s, toks[end - 1].e) + ']';
        j = end;                                   // on the `]`
      }
      if (key === null || !safeKey(key)) { j = skipExpr(toks, j + 1); continue; }
      const nx = toks[j + 1];
      if (isP(nx, ':')) {
        const r = readValue(toks, j + 2, src);
        obj[key] = r.v;
        keys.push({ key, ks: k.s, s: r.s, e: r.e });
        j = r.end > j + 2 ? r.end : j + 3;
      } else if (isP(nx, '(') || (k.t === 'id' && (k.v === 'get' || k.v === 'set' || k.v === 'async'))) {
        // method shorthand: `foo() { … }` — code, skip it whole
        let m = j + 1;
        while (m < toks.length && !isP(toks[m], '{')) m++;
        let depth = 0;
        for (; m < toks.length; m++) {
          if (isP(toks[m], '{')) depth++;
          else if (isP(toks[m], '}') && --depth === 0) break;
        }
        obj[key] = dynNode(src, k.s, toks[m] ? toks[m].e : src.length);
        j = m + 1;
      } else {
        // shorthand `{ sidebar }` — a reference, not a value
        obj[key] = { $dyn: key, $ref: key };
        keys.push({ key, ks: k.s, s: k.s, e: k.e });
        j++;
      }
    }
    Object.defineProperty(obj, '$keys', { value: keys, enumerable: false });
    if (!toks[j]) return { v: obj, s: t.s, e: src.length, end: j };
    return done(obj, toks[j], j + 1);
  }
  if (isP(t, '(')) {
    // `(expr)` around a literal is still the literal — anything else is code
    const r = readValue(toks, i + 1, src);
    if (isP(toks[r.end], ')') && !(r.v && r.v.$dyn)) return { ...r, end: skipTypeTail(toks, r.end + 1) };
  }
  return dyn(toks, i, src);
}

function dyn(toks, i, src) {
  const end = skipExpr(toks, i);
  const last = toks[Math.max(i, end - 1)];
  const node = dynNode(src, toks[i].s, last.e);
  // a bare identifier, or a call to one — the caller may know where it leads
  const t = toks[i];
  if (t.t === 'id') {
    if (end === i + 1) node.$ref = t.v;
    else if (isP(toks[i + 1], '(')) node.$call = t.v;
  }
  return { v: node, s: toks[i].s, e: last.e, end };
}

function dynNode(src, s, e) {
  const text = src.slice(s, e);
  return { $dyn: text.length > 80 ? text.slice(0, 77) + '…' : text };
}

export const isDyn = (v) => !!v && typeof v === 'object' && '$dyn' in v;

// Where `name = <value>` is declared at the top level of a module:
// const/let/var (with or without a type annotation), `export default`, or
// `module.exports =`. Returns { v, s, e } or null.
export function findDeclared(src, toks, name) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'id') continue;
    if ((t.v === 'const' || t.v === 'let' || t.v === 'var') && toks[i + 1] && toks[i + 1].v === name
        && toks[i + 1].t === 'id') {
      let j = i + 2;
      if (isP(toks[j], ':')) {                   // a type annotation, up to `=`
        let depth = 0;
        for (j++; j < toks.length; j++) {
          const p = toks[j];
          if (p.t !== 'p') continue;
          if ('<{[('.includes(p.v)) depth++;
          else if ('>}])'.includes(p.v)) depth--;
          else if (p.v === '=' && depth <= 0) break;
        }
      }
      if (isP(toks[j], '=')) return readValue(toks, j + 1, src);
    }
  }
  return null;
}

export function findDefaultExport(src, toks) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'id' && t.v === 'export' && toks[i + 1] && toks[i + 1].v === 'default') {
      let j = i + 2;
      // export default defineConfig({ … }) / defineSidebar([ … ]) — the
      // argument is the literal
      if (toks[j] && toks[j].t === 'id' && isP(toks[j + 1], '(')) j += 2;
      return readValue(toks, j, src);
    }
    if (t.t === 'id' && t.v === 'module' && isP(toks[i + 1], '.') && toks[i + 2] && toks[i + 2].v === 'exports'
        && isP(toks[i + 3], '=')) {
      return readValue(toks, i + 4, src);
    }
  }
  return null;
}

// Every `key: value` in the file whose key is `name`, wherever it sits —
// `sidebar:` inside themeConfig, inside a locale, inside starlight({…}).
// Shorthand `{ sidebar }` counts too. Returns [{ v, s, e, at }] where `at` is
// the token index, so a caller can ask what encloses it.
export function findKeyed(src, toks, name) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!((t.t === 'id' || t.t === 'str') && t.v === name)) continue;
    const prev = toks[i - 1];
    if (!prev || !(isP(prev, '{') || isP(prev, ','))) continue;
    if (isP(toks[i + 1], ':')) out.push({ ...readValue(toks, i + 2, src), at: i });
    else if (isP(toks[i + 1], ',') || isP(toks[i + 1], '}')) {
      out.push({ v: { $dyn: name, $ref: name }, s: t.s, e: t.e, end: i + 1, at: i });
    }
  }
  return out;
}

// The chain of keys enclosing token `at` — ['locales', 'ja', 'themeConfig']
// — by walking back over balanced brackets. Good enough to name a menu.
export function keyPath(toks, at) {
  const path = [];
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const t = toks[i];
    if (t.t !== 'p') continue;
    if (t.v === '}' || t.v === ']' || t.v === ')') depth++;
    else if (t.v === '{' || t.v === '[' || t.v === '(') {
      if (depth > 0) { depth--; continue; }
      // the key this brace is the value of: `key: {`
      if (t.v === '{' && isP(toks[i - 1], ':') && toks[i - 2]) path.unshift(String(toks[i - 2].v));
      else if (t.v === '(' && toks[i - 1] && toks[i - 1].t === 'id') path.unshift(toks[i - 1].v + '()');
    }
  }
  return path;
}

// `import X from './x'`, `import { X } from './x'`, `import { Y as X } …`
// -> { from: './x', name: 'default' | 'Y' } for local name X.
export function findImport(toks, local) {
  for (let i = 0; i < toks.length; i++) {
    if (!(toks[i].t === 'id' && toks[i].v === 'import')) continue;
    let j = i + 1;
    const names = [];
    if (toks[j] && toks[j].t === 'id' && toks[j].v === 'type') j++;
    if (toks[j] && toks[j].t === 'id') { names.push(['default', toks[j].v]); j++; }
    if (isP(toks[j], ',')) j++;
    if (isP(toks[j], '{')) {
      j++;
      while (toks[j] && !isP(toks[j], '}')) {
        if (toks[j].t === 'id' && toks[j].v !== 'type') {
          const imported = toks[j].v;
          if (toks[j + 1] && toks[j + 1].v === 'as') { names.push([imported, toks[j + 2].v]); j += 3; continue; }
          names.push([imported, imported]);
        }
        j++;
      }
      j++;
    }
    if (!(toks[j] && toks[j].v === 'from' && toks[j + 1] && toks[j + 1].t === 'str')) continue;
    for (const [imported, as] of names) if (as === local) return { from: toks[j + 1].v, name: imported };
  }
  // CommonJS: const X = require('./x')
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t === 'id' && toks[i].v === local && isP(toks[i + 1], '=') && toks[i + 2]
        && toks[i + 2].v === 'require' && toks[i + 4] && toks[i + 4].t === 'str') {
      return { from: toks[i + 4].v, name: 'default' };
    }
  }
  return null;
}

// The body of `function name(…) { … }` or `const name = (…) => { … }`, as a
// token range — so a sidebar written `getSidebar('en')` can be followed to
// the literal the helper starts from.
export function functionBody(toks, name) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'id' || t.v !== name) continue;
    const prev = toks[i - 1];
    const isDecl = (prev && prev.t === 'id' && (prev.v === 'function' || prev.v === 'const'
      || prev.v === 'let' || prev.v === 'var'));
    if (!isDecl) continue;
    // find the first `{` after the parameter list / arrow
    let j = i + 1;
    while (j < toks.length && !(isP(toks[j], '{') && (isP(toks[j - 1], '=>') || isP(toks[j - 1], ')')))) {
      if (isP(toks[j], ';')) break;
      j++;
    }
    if (!isP(toks[j], '{')) continue;
    let depth = 0;
    const start = j;
    for (; j < toks.length; j++) {
      if (isP(toks[j], '{')) depth++;
      else if (isP(toks[j], '}') && --depth === 0) return [start, j];
    }
  }
  return null;
}

// ------------------------------------------------------------------- YAML
//
// Block mappings and sequences (including `- key: v` with more keys under
// it), plain and quoted scalars, flow [..] / {..}, | and > block scalars,
// comments. Tags (`!!python/name:…`, `!ENV`) come through as strings; anchors
// and aliases are dropped. Keys keep their order — Nextra-style "order is the
// key order" depends on it, and JS objects keep string-key order anyway.

export function parseYAML(text) {
  const lines = [];
  // n: the line's number in the file, kept so a sequence can say where
  // each of its items starts (arr.$lines) — what the menu editor cuts by
  const all = text.replace(/\r\n?/g, '\n').split('\n');
  for (let n = 0; n < all.length; n++) {
    const raw = all[n];
    if (/^(---|\.\.\.)\s*$/.test(raw)) {
      if (lines.some(Boolean)) break;          // the next document
      lines.push(null);
      continue;
    }
    const stripped = stripComment(raw);
    if (!stripped.trim()) { lines.push(null); continue; }
    lines.push({ ind: stripped.match(/^ */)[0].length, text: stripped.trim(), raw, n });
  }
  let i = 0;
  const peek = () => {
    while (i < lines.length && lines[i] === null) i++;
    return lines[i];
  };

  function block(ind) {
    const l = peek();
    if (!l || l.ind < ind) return null;
    if (l.text.startsWith('- ') || l.text === '-') return seq(l.ind);
    return map(l.ind);
  }

  function seq(ind) {
    const arr = [];
    const at = [];
    Object.defineProperty(arr, '$lines', { value: at, enumerable: false });
    for (;;) {
      const l = peek();
      if (!l || l.ind !== ind || !(l.text.startsWith('- ') || l.text === '-')) break;
      at.push(l.n);
      i++;
      const rest = l.text === '-' ? '' : l.text.slice(2).trim();
      if (!rest) { arr.push(block(ind + 1)); continue; }
      if (rest.startsWith('- ')) {
        // `- - a` — nested sequence on one line: treat the remainder as its first item
        lines[--i] = { ind: ind + 2, text: rest, raw: l.raw, n: l.n };
        arr.push(seq(ind + 2));
        continue;
      }
      const kv = splitKey(rest);
      if (kv) {
        // a mapping that starts on the dash line; its other keys sit at ind+2
        const inner = ind + 2 + (l.text.slice(2).length - l.text.slice(2).trimStart().length);
        lines[--i] = { ind: inner, text: rest, raw: l.raw, n: l.n };
        arr.push(map(inner));
        continue;
      }
      arr.push(scalarOrBlock(rest, ind));
    }
    return arr;
  }

  function map(ind) {
    const obj = {};
    for (;;) {
      const l = peek();
      if (!l || l.ind !== ind) break;
      const kv = splitKey(l.text);
      if (!kv) break;
      i++;
      const [k, v] = kv;
      if (!safeKey(k)) { block(ind + 1); continue; }     // skip it and anything under it
      if (v === '') {
        const nx = peek();
        // a sequence may sit at the SAME indent as its key — YAML allows it
        if (nx && (nx.ind > ind || (nx.ind === ind && (nx.text.startsWith('- ') || nx.text === '-')))) {
          obj[k] = block(nx.ind);
        } else obj[k] = null;
      } else obj[k] = scalarOrBlock(v, ind);
    }
    return obj;
  }

  function scalarOrBlock(v, ind) {
    if (/^[|>][-+0-9]*$/.test(v)) {
      const fold = v[0] === '>';
      const body = [];
      let base = -1;
      while (i < lines.length) {
        const l = lines[i];
        if (l === null) { body.push(''); i++; continue; }
        if (l.ind <= ind) break;
        if (base < 0) base = l.ind;
        body.push(l.raw.slice(base));
        i++;
      }
      while (body.length && body[body.length - 1] === '') body.pop();
      return fold ? body.join(' ') : body.join('\n');
    }
    return scalar(v);
  }

  return block(0) ?? null;
}

function stripComment(line) {
  let q = null;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") {
      // only a quote that OPENS a scalar starts a quoted run
      const before = line.slice(0, k).trimEnd();
      if (!before || /[:\-\[{,]$/.test(before)) q = c;
      continue;
    }
    if (c === '#' && (k === 0 || /\s/.test(line[k - 1]))) return line.slice(0, k).trimEnd();
  }
  return line.trimEnd();
}

// `key: value` -> [key, value]; quoted keys allowed; `http://x` is not a key
function splitKey(text) {
  let k, rest;
  if (text[0] === '"' || text[0] === "'") {
    const e = text.indexOf(text[0], 1);
    if (e < 0) return null;
    k = text.slice(1, e);
    rest = text.slice(e + 1);
    if (!/^\s*:(\s|$)/.test(rest)) return null;
    return [k, rest.replace(/^\s*:/, '').trim()];
  }
  if (text[0] === '[' || text[0] === '{') return null;
  const m = /^([^:]+?)\s*:(\s+|$)(.*)$/.exec(text);
  if (!m) return null;
  return [m[1], m[3].trim()];
}

function scalar(v) {
  v = v.replace(/^&\S+\s*/, '');                     // anchors
  if (v.startsWith('*')) return null;               // aliases
  if (v[0] === '[' || v[0] === '{') {
    try { return flow(v); } catch { return v; }
  }
  if (v[0] === '"') {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  if (v[0] === "'") return v.slice(1, v.lastIndexOf("'")).replace(/''/g, "'");
  if (v === 'true' || v === 'True' || v === 'yes') return true;
  if (v === 'false' || v === 'False' || v === 'no') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

// [a, "b", {c: d}] — flow collections, recursively
function flow(s) {
  let i = 0;
  const ws = () => { while (/\s/.test(s[i] || '')) i++; };
  function val() {
    ws();
    if (s[i] === '[') {
      i++;
      const arr = [];
      for (;;) {
        ws();
        if (s[i] === ']') { i++; return arr; }
        arr.push(val());
        ws();
        if (s[i] === ',') i++;
        else if (s[i] !== ']') throw new Error('flow');
      }
    }
    if (s[i] === '{') {
      i++;
      const obj = {};
      for (;;) {
        ws();
        if (s[i] === '}') { i++; return obj; }
        const k = atom(':');
        ws();
        const v = s[i] === ':' ? (i++, val()) : null;
        if (safeKey(k)) obj[k] = v;
        ws();
        if (s[i] === ',') i++;
        else if (s[i] !== '}') throw new Error('flow');
      }
    }
    return scalar(atom());
  }
  function atom(stop) {
    ws();
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i];
      let e = i + 1;
      while (e < s.length && s[e] !== q) e += s[e] === '\\' ? 2 : 1;
      const out = s.slice(i, e + 1);
      i = e + 1;
      return stop ? out.slice(1, -1) : out;
    }
    const st = i;
    while (i < s.length && !',]}'.includes(s[i]) && !(stop && s[i] === ':' && /[\s,]/.test(s[i + 1] || ' '))) i++;
    return s.slice(st, i).trim();
  }
  return val();
}

// ------------------------------------------------------------- front matter
//
// YAML between `---` fences, or Hugo's TOML between `+++` (read as flat
// `key = value` lines, plus [tables] one level deep — enough for weight,
// title and linkTitle). Returns {} when there is none.

export function frontMatter(text) {
  if (!text) return {};
  if (text.startsWith('---')) {
    const end = text.search(/\n(---|\.\.\.)\s*(\n|$)/);
    if (end < 0) return {};
    try {
      const v = parseYAML(text.slice(text.indexOf('\n') + 1, end + 1));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
  }
  if (text.startsWith('+++')) {
    const end = text.indexOf('\n+++', 3);
    if (end < 0) return {};
    return parseTOMLish(text.slice(text.indexOf('\n') + 1, end));
  }
  return {};
}

// Flat TOML: `key = value` lines and `[table]` headers. Arrays and inline
// tables come through the YAML flow reader, which accepts `{a = 1}` poorly
// and `["a", "b"]` fine — enough for config keys like contentDir.
export function parseTOMLish(text) {
  const out = {};
  let cur = out;
  for (const raw of text.split('\n')) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    const t = /^\[([^\]]+)\]$/.exec(line);
    if (t) {
      cur = out;
      for (const part of t[1].split('.')) {
        const k = part.trim();
        // a bad table name: its keys go into a throwaway object
        if (!safeKey(k)) { cur = {}; break; }
        if (!Object.prototype.hasOwnProperty.call(cur, k) || typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
        cur = cur[k];
      }
      continue;
    }
    const m = /^("?)([^"=]+)\1\s*=\s*(.+)$/.exec(line);
    if (m && safeKey(m[2].trim())) cur[m[2].trim()] = scalar(m[3].trim());
  }
  return out;
}

// The page title a menu shows when the menu itself doesn't name it: front
// matter `title:` (or `sidebar_label`-style overrides the caller looks for),
// else the first `# Heading`, else null.
export function titleOf(text, fm = frontMatter(text)) {
  if (fm && typeof fm.title === 'string' && fm.title.trim()) return fm.title.trim();
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(stripFront(text || ''));
  if (m) return m[1].replace(/\{#[^}]*\}\s*$/, '').trim();
  const r = /^(.+)\n=+\s*$/m.exec(stripFront(text || ''));   // setext, and rst titles
  if (r) return r[1].trim();
  return null;
}

export function stripFront(text) {
  if (text.startsWith('---')) {
    const end = text.search(/\n(---|\.\.\.)\s*(\n|$)/);
    if (end >= 0) return text.slice(text.indexOf('\n', end + 1) + 1);
  }
  if (text.startsWith('+++')) {
    const end = text.indexOf('\n+++', 3);
    if (end >= 0) return text.slice(text.indexOf('\n', end + 1) + 1);
  }
  return text;
}
