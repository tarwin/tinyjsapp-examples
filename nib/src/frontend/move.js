// Moving whole blocks and sections of the source: what dragging a heading in
// the outline does, and ⌘⇧↑ / ⌘⇧↓ in the editable preview. Pure line
// arithmetic over the Markdown, no DOM: lines [a, b) go to just before line
// t, taking their own trailing blank lines along as the gap behind them, and
// the file keeps the ending it had. Every line outside the moved run stays
// byte-for-byte, so a move is a move in the diff, never a reflow.

(() => {
  const blank = (l) => l.trim() === '';

  // → { text, line } with `line` where the moved run now starts, or null
  // when nothing would move (into itself, or nothing there)
  function moveLines(text, a, b, t) {
    const ending = text.match(/\n*$/)[0];
    const lines = text.slice(0, text.length - ending.length).split('\n');
    b = Math.min(b, lines.length);
    t = Math.min(t, lines.length);
    if (a >= b || (t >= a && t <= b)) return null;

    const chunk = lines.slice(a, b);
    let gap = [];
    while (chunk.length && blank(chunk[chunk.length - 1])) gap.unshift(chunk.pop());
    if (!chunk.length) return null;
    if (!gap.length) gap = [''];                     // it was last: give it one

    const rest = lines.slice(0, a).concat(lines.slice(b));
    const at = t > b ? t - (b - a) : t;
    let out, line;
    if (at >= rest.length) {                         // to the very end
      while (rest.length && blank(rest[rest.length - 1])) rest.pop();
      if (rest.length) rest.push('');
      line = rest.length;
      out = rest.concat(chunk);
    } else {
      const head = rest.slice(0, at);
      // a paragraph dropped straight under a line of text would join it
      if (head.length && !blank(head[head.length - 1])) head.push('');
      line = head.length;
      out = head.concat(chunk, gap, rest.slice(at));
    }
    // whatever gap now trails the file was some block's spacing, not its end
    while (out.length > line + chunk.length && blank(out[out.length - 1])) out.pop();
    return { text: out.join('\n') + ending, line };
  }

  window.nibMoveLines = moveLines;
})();
