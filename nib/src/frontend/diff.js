// The diff pane: one file, side by side against the last commit — HEAD's
// version on the left, the file on disk on the right. It rides the tab
// rails like a picture does (kind 'diff', nothing to edit); the Changes
// panel opens these.
//
// The backend hands over a whole-file unified diff (git diff -U999999 —
// every context line survives, so the whole file is one hunk) and both
// sides rebuild from a single pass over it: context lands on both, a run
// of -/+ lines zips together index-for-index the way VS Code pairs
// modified rows, and the leftover on the longer side faces a blank. One
// shared grid means one scrollbar and the sides can never drift apart.
//
// The ruler along the right edge is the overview: one mark per changed
// run, red left half for the old side, green right half for the new, at
// the run's position in the file. Click to jump there.

(() => {
  function setupDiffView({ pane, note, scroll, grid, ruler, msg }) {
    let current = null;                  // the file being shown
    let token = 0;                       // a newer show() wins the race

    // unified diff -> aligned rows: {o, n, ot, nt, kind} where kind is
    // 'same' | 'mod' (paired -/+) | 'del' | 'add'; a null side is a blank
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
      grid.textContent = '';
      const frag = document.createDocumentFragment();
      // who's who, for anyone who doesn't live in a diff tool: a sticky
      // header row in the same grid, so each label sits over its column
      for (const label of [null, 'Old — last commit', null, 'New — your file']) {
        const el = document.createElement('div');
        el.className = 'dfHd';
        if (label) el.textContent = label;
        frag.appendChild(el);
      }
      for (const r of rows) {
        const mk = (cls, txt) => {
          const el = document.createElement('div');
          el.className = cls;
          // a blank side stays blank; an empty LINE still needs a line box
          if (txt != null) el.textContent = txt === '' ? ' ' : txt;
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
      paintRuler(rows);
    }

    // The overview: changed rows fold into runs, each a mark at its
    // proportional place in the file. Row index stands in for height —
    // wrapped lines skew it a little, never enough to matter for a glance.
    function paintRuler(rows) {
      ruler.textContent = '';
      if (!rows.length) return;
      const runs = [];
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].kind === 'same') continue;
        const from = i;
        let del = false, add = false;
        while (i < rows.length && rows[i].kind !== 'same') {
          del = del || rows[i].ot != null || rows[i].kind === 'del';
          add = add || rows[i].nt != null || rows[i].kind === 'add';
          i++;
        }
        runs.push({ from, to: i, del, add });
      }
      for (const run of runs) {
        const mark = document.createElement('div');
        mark.className = 'dfMark'
          + (run.del ? ' del' : '') + (run.add ? ' add' : '');
        mark.style.top = (run.from / rows.length * 100) + '%';
        mark.style.height = 'max(3px, ' + ((run.to - run.from) / rows.length * 100) + '%)';
        ruler.appendChild(mark);
      }
    }

    // click the ruler → put that part of the file in the middle of the view
    ruler.addEventListener('mousedown', (e) => {
      const r = ruler.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      scroll.scrollTop = frac * scroll.scrollHeight - scroll.clientHeight / 2;
    });

    const say = (t) => {
      msg.textContent = t;
      msg.hidden = false;
      grid.textContent = '';
      ruler.textContent = '';
    };

    async function show(path) {
      current = path;
      const mine = ++token;
      const r = await tiny.api.call('gitDiff', { path });
      if (mine !== token || !pane.isConnected) return;
      msg.hidden = true;
      note.textContent = 'vs last commit';
      if (!r || r.error) return say((r && r.error) || 'git didn’t answer.');
      if (r.binary) return say('Binary file — nothing to show as text.');
      if (r.same) return say('No changes since the last commit.');
      if (r.added) {
        note.textContent = 'new file — not in the last commit';
        const lines = r.text.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        render(lines.map((t, i) => ({ o: null, ot: null, n: i + 1, nt: t, kind: 'add' })));
        return;
      }
      render(rowsOf(r.diff));
    }

    return {
      show,
      // the file may have been saved since this tab last looked
      refresh: () => { if (current && !pane.hidden) show(current); },
      shown: () => current,
    };
  }

  window.setupDiffView = setupDiffView;
})();
