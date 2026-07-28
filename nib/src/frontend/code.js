// Syntax highlighting for fenced code blocks in the preview. Same shape as
// hl.js but for other people's languages: a per-language list of rules, fused
// into one regex, scanned left to right. First rule that matches at a
// position wins, so order matters — comments and strings come first, because
// a keyword inside a string is not a keyword.
//
// The output is classes only (.cd-*), styled in themes.js, so highlighting
// survives Export as HTML and printing without any script. Everything is
// escaped here; md.js hands us raw source and expects markup back.

(() => {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ESC[c]);

  // Rules use non-capturing groups ONLY — the fused regex gives each rule
  // exactly one group, and that's how we know which one matched.
  const NUM = /(?:\b0[xXbBoO][0-9a-fA-F_]+|\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)\b/;
  const CLIKE_STR = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/;
  const SLASH_CM = /\/\/[^\n]*|\/\*[\s\S]*?\*\//;
  const HASH_CM = /#[^\n]*/;

  const kw = (words) => new RegExp('\\b(?:' + words.trim().split(/\s+/).join('|') + ')\\b');

  const JS_KW = kw(`await async break case catch class const continue debugger default delete do
    else export extends finally for from function get if implements import in instanceof interface
    let new of return set static super switch this throw try typeof var void while with yield
    enum type declare namespace readonly public private protected abstract satisfies as keyof infer`);
  const PY_KW = kw(`and as assert async await break class continue def del elif else except finally
    for from global if import in is lambda nonlocal not or pass raise return try while with yield
    match case self None True False`);
  const GO_KW = kw(`break case chan const continue default defer else fallthrough for func go goto
    if import interface map package range return select struct switch type var
    fn let mut impl pub use crate mod match trait where unsafe ref move dyn
    auto bool char class delete double enum extern float friend inline int long namespace new
    operator private protected public register return short signed sizeof static struct template
    this throw try typedef union unsigned virtual void volatile
    abstract assert boolean byte extends final finally implements instanceof native package
    strictfp super synchronized throws transient
    guard defer init deinit protocol extension associatedtype some any lazy willSet didSet`);
  const SH_KW = kw(`if then else elif fi for while until do done case esac function select in
    return break continue local export readonly declare source alias unset trap shift eval exec set`);
  const SQL_KW = /\b(?:SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|ON|AS|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|PRIMARY|KEY|FOREIGN|REFERENCES|DEFAULT|UNIQUE|CONSTRAINT|BEGIN|COMMIT|ROLLBACK|WITH|RETURNING|IF|EXISTS)\b/i;

  const IDENT_FN = /[A-Za-z_$][\w$]*(?=\s*\()/;
  const PUNCT = /[{}[\]();,.:]/;
  const OP = /[+\-*/%=<>!&|^~?]+/;

  const clike = (keywords, extra = []) => [
    ['cm', SLASH_CM], ['str', CLIKE_STR], ...extra,
    ['num', NUM], ['kw', keywords],
    ['lit', /\b(?:true|false|null|nil|undefined|NaN|None|True|False)\b/],
    ['fn', IDENT_FN], ['type', /\b[A-Z][A-Za-z0-9_]*\b/],
    ['op', OP], ['pun', PUNCT],
  ];

  const LANGS = {
    js: clike(JS_KW, [['str', /`(?:\\.|[^`\\])*`/], ['attr', /\B#[A-Za-z_$][\w$]*/]]),
    json: [
      ['key', /"(?:\\.|[^"\\\n])*"(?=\s*:)/], ['str', /"(?:\\.|[^"\\\n])*"/],
      ['num', NUM], ['lit', /\b(?:true|false|null)\b/], ['pun', PUNCT],
    ],
    py: [
      ['cm', HASH_CM],
      ['str', /(?:[rbfu]{0,2})(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/],
      ['dec', /@[A-Za-z_][\w.]*/], ['num', NUM], ['kw', PY_KW],
      ['fn', IDENT_FN], ['type', /\b[A-Z][A-Za-z0-9_]*\b/], ['op', OP], ['pun', PUNCT],
    ],
    sh: [
      ['cm', HASH_CM],
      ['str', /"(?:\\.|[^"\\])*"|'[^']*'/],
      ['var', /\$(?:\{[^}\n]*\}|[A-Za-z_][\w]*|[0-9@*#?$!])/],
      ['kw', SH_KW],
      ['fn', /(?:^|\n|[|;&]\s*)\s*[A-Za-z_][\w.-]*/],
      ['op', /[|&;<>]+|\B--?[A-Za-z][\w-]*/], ['num', NUM],
    ],
    css: [
      ['cm', /\/\*[\s\S]*?\*\//], ['str', CLIKE_STR],
      ['at', /@[\w-]+/],
      ['key', /[-\w]+(?=\s*:)/],
      ['num', /(?:[-+]?\d*\.?\d+)(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch|pt)?\b/],
      ['fn', /[\w-]+(?=\()/], ['lit', /#[0-9a-fA-F]{3,8}\b/],
      ['sel', /[.#][-\w]+|::?[-\w()]+|\b[a-z][\w-]*(?=[^:;{}]*\{)/],
      ['pun', /[{};:,()]/],
    ],
    html: [
      ['cm', /<!--[\s\S]*?-->/],
      ['tag', /<\/?[A-Za-z][\w:-]*/], ['tag', /\/?>/],
      ['attr', /\b[A-Za-z_:][-\w:.]*(?==)/], ['str', CLIKE_STR],
      ['lit', /&[a-zA-Z#0-9]+;/],
    ],
    sql: [
      ['cm', /--[^\n]*|\/\*[\s\S]*?\*\//], ['str', /'(?:''|[^'])*'/],
      ['kw', SQL_KW], ['num', NUM], ['fn', IDENT_FN], ['op', OP], ['pun', PUNCT],
    ],
    yaml: [
      ['cm', HASH_CM], ['key', /^[ \t-]*[\w.-]+(?=\s*:)/m],
      ['str', CLIKE_STR], ['num', NUM],
      ['lit', /\b(?:true|false|null|yes|no|on|off)\b/i], ['pun', /[-:[\]{},]/],
    ],
    diff: [
      ['ins', /^\+[^\n]*/m], ['del', /^-[^\n]*/m],
      ['cm', /^@@[^\n]*|^diff [^\n]*|^index [^\n]*/m],
    ],
    md: [
      ['kw', /^#{1,6} [^\n]*/m], ['str', /`[^`\n]+`/],
      ['fn', /\*\*[^*\n]+\*\*|_[^_\n]+_|\*[^*\n]+\*/],
      ['url', /\[[^\]\n]*\]\([^)\n]*\)/], ['pun', /^\s*[-*+>]|^\s*\d+\./m],
    ],
    go: clike(GO_KW, [['str', /`[^`]*`/]]),
  };

  const ALIAS = {
    javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', cjs: 'js',
    python: 'py', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', sh: 'sh',
    scss: 'css', less: 'css', xml: 'html', svg: 'html', vue: 'html',
    yml: 'yaml', patch: 'diff', markdown: 'md',
    rust: 'go', rs: 'go', c: 'go', cpp: 'go', 'c++': 'go', h: 'go', java: 'go',
    swift: 'go', kotlin: 'go', kt: 'go', cs: 'go', csharp: 'go', php: 'go', dart: 'go',
  };

  const cache = new Map();
  function fused(lang) {
    if (cache.has(lang)) return cache.get(lang);
    const rules = LANGS[lang];
    const re = new RegExp(rules.map(([, r]) => '(' + r.source + ')').join('|'),
      'g' + (rules.some(([, r]) => r.multiline) ? 'm' : '')
        + (rules.some(([, r]) => r.ignoreCase) ? 'i' : ''));
    const out = { re, cls: rules.map(([c]) => c) };
    cache.set(lang, out);
    return out;
  }

  window.highlightCode = (src, lang) => {
    const key = ALIAS[String(lang || '').toLowerCase()] || String(lang || '').toLowerCase();
    if (!LANGS[key]) return esc(src);
    const { re, cls } = fused(key);
    re.lastIndex = 0;
    let out = '', last = 0, m;
    while ((m = re.exec(src))) {
      if (m[0] === '') { re.lastIndex++; continue; }      // never spin
      let which = -1;
      for (let i = 1; i < m.length; i++) if (m[i] !== undefined) { which = i - 1; break; }
      if (which < 0) continue;
      out += esc(src.slice(last, m.index));
      out += `<span class="cd-${cls[which]}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(src.slice(last));
  };
})();
