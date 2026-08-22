// The Changes window: one file, side by side against the last commit —
// HEAD's version on the left, the file on disk on the right.
//
// The backend hands over a whole-file unified diff (git diff -U999999 —
// every context line survives, so the whole file is one hunk) and both
// sides rebuild from a single pass over it: context lands on both, a run
// of -/+ lines zips together index-for-index the way VS Code pairs
// modified rows, and the leftover on the longer side faces a blank. One
// shared grid means one scrollbar and the sides can never drift apart.

(() => {
  const $ = (id) => document.getElementById(id);

  let current = null;                    // the file being shown

  // unified diff -> aligned rows: {o, n, ot, nt, kind} where kind is
  // 'same' | 'mod' (paired -/+) | 'del' | 'add', and a null side is a blank
  function rowsOf(diff) {
    const out = [];
    let oldN = 0, newN = 0, inHunk = false;
    let dels = [], adds = [];
    const flush = () => {
      for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
        const d = dels[i], a = adds[i];
        out.push({
          o: d ? d.n : null, ot: d ? d.t : null,
          n: a ? a.n : null, nt: a ? a.t : null,
          kind: d && a ? 'mod' : d ? 'del' : 'add',
        });
      }
      dels = [];
      adds = [];
    };
    const lines = diff.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();  // the split's artifact
    for (const line of lines) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        flush();
        inHunk = true;
        oldN = +m[1];
        newN = +m[2];
        continue;
      }
      if (!inHunk || line.startsWith('\\')) continue; // headers; \ No newline
      if (line.startsWith('-')) dels.push({ n: oldN++, t: line.slice(1) });
      else if (line.startsWith('+')) adds.push({ n: newN++, t: line.slice(1) });
      else {                                          // context: both sides
        flush();
        const t = line.slice(1);
        out.push({ o: oldN++, ot: t, n: newN++, nt: t, kind: 'same' });
      }
    }
    flush();
    return out;
  }

  function render(rows) {
    const grid = $('dfGrid');
    grid.textContent = '';
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const mk = (cls, txt) => {
        const el = document.createElement('div');
        el.className = cls;
        // a blank side stays blank; an empty LINE still needs a line box
        if (txt != null) el.textContent = txt === '' ? ' ' : txt;
        frag.appendChild(el);
      };
      const oc = r.kind === 'same' ? '' : r.ot != null ? ' del' : ' void';
      const nc = r.kind === 'same' ? '' : r.nt != null ? ' add' : ' void';
      mk('dfLn' + oc, r.o == null ? null : String(r.o));
      mk('dfTx' + oc, r.ot);
      mk('dfLn' + nc, r.n == null ? null : String(r.n));
      mk('dfTx' + nc, r.nt);
    }
    grid.appendChild(frag);
  }

  async function load(path) {
    current = path;
    const r = await tiny.api.call('gitDiff', { path });
    if (current !== path) return;                     // a newer click won
    $('dfName').textContent = (r && r.rel) || path;
    $('dfName').title = path;
    $('dfNote').textContent = 'vs last commit';
    const msg = $('dfMsg');
    const note = (t) => {
      msg.textContent = t;
      msg.hidden = false;
      $('dfGrid').textContent = '';
    };
    msg.hidden = true;
    if (!r || r.error) return note((r && r.error) || 'git didn’t answer.');
    if (r.binary) return note('Binary file — nothing to show as text.');
    if (r.same) return note('No changes since the last commit.');
    if (r.added) {
      $('dfNote').textContent = 'new file — not in the last commit';
      const lines = r.text.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      render(lines.map((t, i) => ({ o: null, ot: null, n: i + 1, nt: t, kind: 'add' })));
      return;
    }
    render(rowsOf(r.diff));
  }

  tiny.api.on('diff-file', (p) => { if (p && p.path) load(p.path); });
  // the file may have been saved again since this window last looked
  addEventListener('focus', () => { if (current) load(current); });

  (async () => {
    const b = await tiny.api.call('diffBoot', {});
    if (b && b.path) load(b.path);
  })();
})();
