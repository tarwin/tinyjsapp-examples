// labhl.js — syntax colouring for the viz lab's editor.
//
// A textarea cannot colour its own text, so the lab stacks a <pre> underneath
// holding the same text marked up, and makes the textarea's own text
// transparent with a visible caret. The two must agree on font, padding and
// wrapping to the pixel, which is why .lab-hl and #code share every metric in
// style.css. Editing, undo, selection and the caret all stay native.
//
// One pass, no dependencies, and it only has to be right about JavaScript.
//
// window.ampHighlight(source) -> html

(function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const KEYWORDS = new Set(['await', 'async', 'break', 'case', 'catch', 'class', 'const',
    'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends',
    'finally', 'for', 'function', 'get', 'if', 'import', 'in', 'instanceof', 'let',
    'new', 'of', 'return', 'set', 'static', 'super', 'switch', 'this', 'throw', 'try',
    'typeof', 'var', 'void', 'while', 'with', 'yield']);
  const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
  const BUILTINS = new Set(['amp', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
    'Boolean', 'Date', 'Promise', 'Map', 'Set', 'console', 'navigator', 'self',
    'Float32Array', 'Uint8Array', 'Uint32Array', 'Int32Array', 'ArrayBuffer',
    'OffscreenCanvas', 'requestAnimationFrame', 'performance', 'WebAssembly']);

  const ID_START = /[A-Za-z_$]/;
  const ID_PART = /[A-Za-z0-9_$]/;

  function highlight(src) {
    const s = String(src);
    let out = '';
    let i = 0;
    // whether a '/' here starts a regex or is division: after a value it is
    // division, after an operator or '(' it is a regex
    let prevSignificant = '';

    const push = (cls, text) => { out += '<span class="' + cls + '">' + esc(text) + '</span>'; };

    while (i < s.length) {
      const c = s[i];

      // line comment
      if (c === '/' && s[i + 1] === '/') {
        let j = s.indexOf('\n', i);
        if (j < 0) j = s.length;
        push('c', s.slice(i, j));
        i = j;
        continue;
      }
      // block comment
      if (c === '/' && s[i + 1] === '*') {
        let j = s.indexOf('*/', i + 2);
        j = j < 0 ? s.length : j + 2;
        push('c', s.slice(i, j));
        i = j;
        continue;
      }
      // strings and template literals. Template substitutions are left inside
      // the string colour: this is a highlighter, not a parser.
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        while (j < s.length) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === c) { j++; break; }
          if (c !== '`' && s[j] === '\n') break;      // an unterminated quote ends at the line
          j++;
        }
        push('s', s.slice(i, j));
        i = j;
        prevSignificant = 'value';
        continue;
      }
      // regex literal, but only where a value cannot precede it
      if (c === '/' && prevSignificant !== 'value') {
        let j = i + 1, cls = false, ok = false;
        while (j < s.length) {
          const d = s[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '[') cls = true;
          else if (d === ']') cls = false;
          else if (d === '/' && !cls) { j++; ok = true; break; }
          else if (d === '\n') break;
          j++;
        }
        if (ok) {
          while (j < s.length && /[gimsuy]/.test(s[j])) j++;
          push('r', s.slice(i, j));
          i = j;
          prevSignificant = 'value';
          continue;
        }
      }
      // number
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        let j = i;
        while (j < s.length && /[0-9a-fA-FxXoObB._eE+-]/.test(s[j])) {
          // stop a trailing +/- that belongs to the next expression
          if ((s[j] === '+' || s[j] === '-') && !/[eE]/.test(s[j - 1])) break;
          j++;
        }
        push('n', s.slice(i, j));
        i = j;
        prevSignificant = 'value';
        continue;
      }
      // identifier, keyword, property, call
      if (ID_START.test(c)) {
        let j = i;
        while (j < s.length && ID_PART.test(s[j])) j++;
        const word = s.slice(i, j);
        let k = j;
        while (k < s.length && (s[k] === ' ' || s[k] === '\t')) k++;
        const isCall = s[k] === '(';
        const isProp = i > 0 && s[i - 1] === '.';

        if (KEYWORDS.has(word) && !isProp) { push('k', word); prevSignificant = 'op'; }
        else if (LITERALS.has(word) && !isProp) { push('l', word); prevSignificant = 'value'; }
        else if (BUILTINS.has(word) && !isProp) { push('b', word); prevSignificant = 'value'; }
        else if (isCall) { push('f', word); prevSignificant = 'value'; }
        else if (isProp) { push('p', word); prevSignificant = 'value'; }
        else { out += esc(word); prevSignificant = 'value'; }
        i = j;
        continue;
      }
      // punctuation and whitespace
      if (/\s/.test(c)) { out += esc(c); i++; continue; }
      if (c === ')' || c === ']' || c === '}') prevSignificant = 'value';
      else prevSignificant = 'op';
      push('o', c);
      i++;
    }
    // a trailing newline needs something after it or the <pre> loses the line,
    // which puts the highlight layer one line out of step with the textarea
    return out + '\n';
  }

  window.ampHighlight = highlight;
})();
