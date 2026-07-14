// Beam's brains, no DOM: the fuzzy scorer and the calculator. Kept apart from
// app.js so they're trivially testable — everything here is a pure function
// on window.beam.
//
// The calculator is a real tokenizer + recursive-descent parser, NOT eval():
// the palette holds an RPC channel with full system access, so user input
// must never reach an evaluator that can do more than arithmetic.

(() => {

// ------------------------------------------------------------------- fuzzy
// Subsequence match, best alignment by dynamic programming (a greedy scan
// would grab "ViSual" when "vsc" should hit "Visual Studio Code"'s word
// starts). Returns { score, at } (matched indices in `target`, for
// highlighting) or null when the query isn't a subsequence at all. Bonuses
// favour word starts, consecutive runs, and short names; names are short,
// so the n·m² worst case is nothing.

function fuzzy(query, target) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return { score: 0, at: [] };
  const n = q.length;
  const m = t.length;
  if (n > m) return null;

  const wordStart = new Array(m);
  for (let i = 0; i < m; i++) wordStart[i] = i === 0 || ' -_./('.includes(t[i - 1]);

  const NEG = -1e9;
  const parents = [];
  let prev = null;
  for (let qi = 0; qi < n; qi++) {
    const cur = new Array(m).fill(NEG);
    const par = new Array(m).fill(-1);
    for (let ti = qi; ti <= m - (n - qi); ti++) {
      if (t[ti] !== q[qi]) continue;
      if (qi === 0) {
        cur[ti] = ti === 0 ? 10 : wordStart[ti] ? 8 : -Math.min(ti, 3);
        continue;
      }
      for (let tp = qi - 1; tp < ti; tp++) {           // best predecessor
        if (prev[tp] === NEG) continue;
        const gap = ti - tp - 1;
        const bonus = wordStart[ti] ? 8 : gap === 0 ? 6 : -Math.min(gap, 3);
        if (prev[tp] + bonus > cur[ti]) { cur[ti] = prev[tp] + bonus; par[ti] = tp; }
      }
    }
    parents.push(par);
    prev = cur;
  }

  let end = -1;
  for (let ti = 0; ti < m; ti++) {
    if (prev[ti] !== NEG && (end === -1 || prev[ti] > prev[end])) end = ti;
  }
  if (end === -1) return null;

  const at = [];
  for (let qi = n - 1, ti = end; qi >= 0; qi--) {
    at.push(ti);
    ti = parents[qi][ti];
  }
  at.reverse();

  let score = prev[end];
  if (t.startsWith(q)) score += 8;                               // exact prefix
  if (t.includes(q)) score += 4;                                 // exact substring
  score += Math.max(0, 6 - Math.floor(m / 8));                   // short names win ties
  return { score, at };
}

// -------------------------------------------------------------- calculator
// number | pi | e | x(=*) | + - * / % ^ ( ) | sqrt abs round floor ceil
// sin cos tan log ln    — '^' is right-associative, '%' is modulo.

const FNS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor,
  ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  log: Math.log10, ln: Math.log,
};
const CONSTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const toks = [];
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c >= '0' && c <= '9' || c === '.') {
      const m = /^\d*\.?\d+/.exec(s.slice(i));
      if (!m) return null;
      toks.push({ n: parseFloat(m[0]) });
      i += m[0].length;
    } else if (c >= 'a' && c <= 'z') {
      const m = /^[a-z]+/.exec(s.slice(i));
      const w = m[0];
      if (w === 'x') toks.push({ op: '*' });                     // 2x3
      else if (w in FNS) toks.push({ fn: w });
      else if (w in CONSTS) toks.push({ n: CONSTS[w] });
      else return null;
      i += w.length;
    } else if ('+-*/%^()'.includes(c)) {
      toks.push({ op: c });
      i++;
    } else {
      return null;
    }
  }
  return toks;
}

function parse(toks) {
  let p = 0;
  const peek = () => toks[p];
  const eat = (op) => (toks[p] && toks[p].op === op ? (p++, true) : false);

  function atom() {
    const t = peek();
    if (!t) return NaN;
    if ('n' in t) { p++; return t.n; }
    if (t.fn) {
      p++;
      if (!eat('(')) return NaN;
      const v = expr();
      if (!eat(')')) return NaN;
      return FNS[t.fn](v);
    }
    if (eat('(')) {
      const v = expr();
      if (!eat(')')) return NaN;
      return v;
    }
    return NaN;
  }

  function power() {                   // right-assoc: 2^3^2 = 512
    const base = atom();
    if (eat('^')) return Math.pow(base, unary());
    return base;
  }

  function unary() {
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    return power();
  }

  function term() {
    let v = unary();
    while (true) {
      if (eat('*')) v *= unary();
      else if (eat('/')) v /= unary();
      else if (eat('%')) v %= unary();
      else return v;
    }
  }

  function expr() {
    let v = term();
    while (true) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  }

  const v = expr();
  return p === toks.length ? v : NaN;  // leftovers = not an expression
}

function fmtNumber(v) {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return v.toLocaleString('en-US');
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return v.toExponential(6).replace(/\.?0+e/, 'e');
  return String(parseFloat(v.toPrecision(12)));
}

// The gate: only claim a query that has an operator or a function (a bare
// number or word is a search, not a sum) and parses cleanly end-to-end.
function calc(input) {
  const src = input.trim().toLowerCase();
  if (!src) return null;
  if (!/[+\-*/%^×÷−]|\d\s*x\s*[\d.]|sqrt|abs|round|floor|ceil|sin|cos|tan|log|ln/.test(src)) return null;
  const toks = tokenize(src);
  if (!toks || !toks.length) return null;
  const v = parse(toks);
  if (typeof v !== 'number' || !isFinite(v)) return null;
  return { value: v, display: fmtNumber(v), raw: String(v) };
}

window.beam = { fuzzy, calc };

})();
