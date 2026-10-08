// Editing tables in the editable preview: a grip over each column and beside
// each row (on hover, or wherever the caret is) that drops a menu — insert,
// move, delete, align — plus Tab / ⇧Tab from cell to cell, Tab in the last
// cell growing a row. Ideas from Domternal's table view, minus everything
// Markdown can't hold (merged cells, widths, cell colours).
//
// Every operation is done to the SOURCE, not the DOM: the table's lines are
// parsed into a grid, the grid is changed, and the lines are written back —
// so what you get is exactly the Markdown you'd have typed. Rows an operation
// doesn't touch keep their original line byte-for-byte (adding a row to a
// hand-written table doesn't re-pad it); only a column change, which touches
// every row, rewrites the whole table with even pipes. doc.js owns the
// rewrite (undo, render, sync) — this file knows tables and the UI.

(() => {
  // ------------------------------------------------------------ the model

  // md.js's own split: unescaped pipes divide cells; outer pipes optional.
  // Cells stay RAW Markdown — `\|` stays escaped, since it goes back as is.
  const split = (l) =>
    l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
      .split(/(?<!\\)\|/).map((c) => c.trim());

  const SEP = /^\s*\|?(\s*:?-{1,}:?\s*\|)*\s*:?-{1,}:?\s*\|?\s*$/;

  // the table whose header is lines[i] → model, or null if it isn't one
  function parse(lines, i) {
    if (!lines[i] || !lines[i + 1] || !SEP.test(lines[i + 1])) return null;
    const cells = [split(lines[i])], raw = [lines[i]];
    const aligns = split(lines[i + 1]).map((c) =>
      /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : '');
    let end = i + 2;
    while (end < lines.length && lines[end].includes('|') && lines[end].trim()) {
      cells.push(split(lines[end]));
      raw.push(lines[end]);
      end++;
    }
    // ragged rows: pad to the widest, so every column has a cell in every row
    const w = Math.max(aligns.length, ...cells.map((r) => r.length));
    for (const r of cells) while (r.length < w) r.push('');
    while (aligns.length < w) aligns.push('');
    // a table written with its pipes lined up gets new lines lined up too;
    // a compact hand-written one stays compact
    const all = raw.concat(lines[i + 1]);
    const padded = all.every((l) => l.trimEnd().length === all[0].trimEnd().length);
    return { cells, raw, aligns, sepRaw: lines[i + 1], start: i, end, padded };
  }

  function serialize(m) {
    if (m.deleted) return [];
    const w = m.aligns.length;
    const width = [];
    for (let c = 0; c < w; c++) {
      const colons = m.aligns[c] === 'center' ? 2 : m.aligns[c] ? 1 : 0;
      width.push(m.padded ? Math.max(3 + colons, ...m.cells.map((r) => (r[c] || '').length)) : 3);
    }
    const row = (r) => '| ' + r.map((t, c) => (m.padded ? t.padEnd(width[c]) : t)).join(' | ') + ' |';
    // never fewer than three dashes: md.js wants two, and ":-:" reads badly
    const d = (n) => '-'.repeat(Math.max(3, n));
    const dash = (a, n) =>
      a === 'center' ? ':' + d(n - 2) + ':'
        : a === 'right' ? d(n - 1) + ':'
          : a === 'left' ? ':' + d(n - 1) : d(n);
    const sep = '| ' + m.aligns.map((a, c) => dash(a, width[c])).join(' | ') + ' |';
    const out = m.cells.map((r, k) => m.raw[k] ?? row(r));
    out.splice(1, 0, m.sepRaw ?? sep);
    return out;
  }

  // Each op changes the model in place and answers the cell the caret
  // should land in afterwards, [row, col] (row 0 is the header), or null
  // when it can't apply. A column op drops every raw line: they all change.
  const allNew = (m) => { m.raw = m.raw.map(() => null); m.sepRaw = null; };
  const ops = {
    insertRow(m, at) {                               // at ≥ 1: never above the header
      m.cells.splice(at, 0, m.aligns.map(() => ''));
      m.raw.splice(at, 0, null);
      return [at, 0];
    },
    deleteRow(m, r) {
      if (r < 1) return null;
      m.cells.splice(r, 1);
      m.raw.splice(r, 1);
      return [Math.min(r, m.cells.length - 1), 0];
    },
    moveRow(m, r, d) {
      const t = r + d;
      if (r < 1 || t < 1 || t >= m.cells.length) return null;
      [m.cells[r], m.cells[t]] = [m.cells[t], m.cells[r]];
      [m.raw[r], m.raw[t]] = [m.raw[t], m.raw[r]];
      return [t, null];
    },
    insertCol(m, at) {
      for (const r of m.cells) r.splice(at, 0, '');
      m.aligns.splice(at, 0, '');
      allNew(m);
      return [null, at];
    },
    deleteCol(m, c) {
      if (m.aligns.length < 2) return null;
      for (const r of m.cells) r.splice(c, 1);
      m.aligns.splice(c, 1);
      allNew(m);
      return [null, Math.min(c, m.aligns.length - 1)];
    },
    moveCol(m, c, d) {
      const t = c + d;
      if (t < 0 || t >= m.aligns.length) return null;
      for (const r of m.cells) [r[c], r[t]] = [r[t], r[c]];
      [m.aligns[c], m.aligns[t]] = [m.aligns[t], m.aligns[c]];
      allNew(m);
      return [null, t];
    },
    deleteTable(m) {
      m.deleted = true;
      return [0, 0];
    },
    align(m, c, a) {
      m.aligns[c] = a;
      m.sepRaw = null;                               // only the separator changes
      return [null, c];
    },
  };

  window.nibTable = { parse, serialize, ops };

  // ------------------------------------------------------------ the grips

  function setupTableGrips({ preview, editing, edit }) {
    const mk = (cls, text, title) => {
      const b = document.createElement('button');
      b.className = 'tgrip ' + cls;
      b.textContent = text;
      b.title = title;
      b.hidden = true;
      document.body.appendChild(b);
      return b;
    };
    const colGrip = mk('tcol', '⋯', 'Column');
    const rowGrip = mk('trow', '⋮', 'Row');
    const menu = document.createElement('div');
    menu.id = 'tableMenu';
    menu.hidden = true;
    document.body.appendChild(menu);

    let cur = null;                                  // { table, r, c }

    // only top-level tables: one inside a callout or a list is written with
    // prefixes this line arithmetic doesn't speak
    const cellOf = (n) => {
      const el = n && (n.nodeType === 3 ? n.parentNode : n);
      const cell = el && el.closest && el.closest('td, th');
      const table = cell && cell.closest('table');
      return table && table.parentNode === preview && table.dataset.line != null ? cell : null;
    };

    function show(cell) {
      if (!editing()) return hide();
      const table = cell.closest('table');
      cur = { table, r: cell.parentNode.rowIndex, c: cell.cellIndex };
      place();
    }
    function place() {
      if (!cur || !cur.table.isConnected) return hide();
      const tr = cur.table.getBoundingClientRect();
      const row = cur.table.rows[cur.r], cell = row && row.cells[cur.c];
      if (!cell) return hide();
      const cr = cell.getBoundingClientRect(), rr = row.getBoundingClientRect();
      colGrip.hidden = rowGrip.hidden = false;
      colGrip.style.left = Math.round(cr.left + cr.width / 2 - colGrip.offsetWidth / 2) + 'px';
      colGrip.style.top = Math.round(tr.top - colGrip.offsetHeight / 2) + 'px';
      rowGrip.style.left = Math.round(tr.left - rowGrip.offsetWidth / 2) + 'px';
      rowGrip.style.top = Math.round(rr.top + rr.height / 2 - rowGrip.offsetHeight / 2) + 'px';
    }
    function hide() {
      cur = null;
      colGrip.hidden = rowGrip.hidden = true;
      hideMenu();
    }
    const hideMenu = () => { menu.hidden = true; menu.textContent = ''; };

    // the caret into cell [r, c] of a (freshly rendered) table, at its end
    function caretTo(table, r, c) {
      const row = table && table.rows[Math.min(r, table.rows.length - 1)];
      const cell = row && row.cells[Math.min(c, row.cells.length - 1)];
      if (!cell) return;
      preview.focus();
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      show(cell);
    }

    function run(op, ...args) {
      if (!cur) return;
      const { r, c } = cur;
      hideMenu();
      const done = edit(cur.table, (m) => ops[op](m, ...args));
      if (!done) return;
      if (!done.table) return hide();                // deleted: doc.js placed the caret
      const [nr, nc] = done.cell;
      caretTo(done.table, nr ?? r, nc ?? c);
    }

    function openMenu(which) {
      if (!cur) return;
      const { table, r, c } = cur;
      const rows = table.rows.length, cols = table.rows[0].cells.length;
      const a = (table.rows[0].cells[c].style.textAlign || '');
      // [label, icon (icons.js), action, ticked]
      const items = which === 'row' ? [
        r >= 1 && ['Insert row above', 'between-horizontal-start', () => run('insertRow', r)],
        ['Insert row below', 'between-horizontal-end', () => run('insertRow', r + 1)],
        r > 1 && ['Move row up', 'arrow-up', () => run('moveRow', r, -1)],
        r >= 1 && r < rows - 1 && ['Move row down', 'arrow-down', () => run('moveRow', r, 1)],
        r >= 1 && ['Delete row', 'trash-2', () => run('deleteRow', r)],
        '-',
        ['Delete table', 'trash-2', () => run('deleteTable')],
      ] : [
        ['Align left', 'align-left', () => run('align', c, ''), !a || a === 'left'],
        ['Align center', 'align-center', () => run('align', c, 'center'), a === 'center'],
        ['Align right', 'align-right', () => run('align', c, 'right'), a === 'right'],
        '-',
        ['Insert column left', 'between-vertical-start', () => run('insertCol', c)],
        ['Insert column right', 'between-vertical-end', () => run('insertCol', c + 1)],
        c > 0 && ['Move column left', 'arrow-left', () => run('moveCol', c, -1)],
        c < cols - 1 && ['Move column right', 'arrow-right', () => run('moveCol', c, 1)],
        cols > 1 && ['Delete column', 'trash-2', () => run('deleteCol', c)],
        '-',
        ['Delete table', 'trash-2', () => run('deleteTable')],
      ];
      menu.textContent = '';
      for (const it of items) {
        if (!it) continue;
        if (it === '-') {
          const s = document.createElement('div');
          s.className = 'tmsep';
          menu.appendChild(s);
          continue;
        }
        const b = document.createElement('button');
        if (window.nibIcon) b.appendChild(window.nibIcon(it[1], 14));
        const label = document.createElement('span');
        label.textContent = it[0];
        b.appendChild(label);
        if (it[3]) b.classList.add('on');
        if (/^Delete/.test(it[0])) b.classList.add('danger');
        b.onmousedown = (e) => { e.preventDefault(); it[2](); };
        menu.appendChild(b);
      }
      menu.hidden = false;
      const g = (which === 'row' ? rowGrip : colGrip).getBoundingClientRect();
      const w = menu.offsetWidth, h = menu.offsetHeight;
      const left = which === 'row' ? g.right + 4 : g.left + g.width / 2 - w / 2;
      menu.style.left = Math.round(Math.min(Math.max(8, left), innerWidth - w - 8)) + 'px';
      const top = which === 'row' ? g.top : g.bottom + 4;
      menu.style.top = Math.round(Math.min(top, innerHeight - h - 8)) + 'px';
    }

    for (const [g, which] of [[rowGrip, 'row'], [colGrip, 'col']]) {
      // mousedown, so the caret the grip is about stays where it was
      g.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!menu.hidden && menu.dataset.which === which) return hideMenu();
        openMenu(which);
        menu.dataset.which = which;
      });
    }

    // Hover shows the grips for the cell under the pointer; they stay while
    // the pointer is within reach of the table (the grips sit just outside
    // it), the caret is in it, or a menu is open.
    let pointer = null;                              // last { x, y } seen
    const nearTable = () => {
      if (!cur || !pointer) return false;
      const r = cur.table.getBoundingClientRect();
      return pointer.x > r.left - 24 && pointer.x < r.right + 8
        && pointer.y > r.top - 24 && pointer.y < r.bottom + 8;
    };
    document.addEventListener('mousemove', (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!editing()) { if (cur) hide(); return; }
      const cell = cellOf(e.target);
      if (cell) { if (!cur || cur.table.rows[cur.r] !== cell.parentNode || cur.c !== cell.cellIndex) show(cell); return; }
      if (!cur || !menu.hidden || e.target.closest('.tgrip')) return;
      if (!nearTable() && !cellOf(getSelection().anchorNode)) hide();
    });
    // …and so does the caret, for the keyboard — and the caret LEAVING the
    // table (an arrow off its top or bottom) takes them away again, unless
    // the pointer is still parked over it
    document.addEventListener('selectionchange', () => {
      const s = getSelection();
      const cell = s && editing() && preview.contains(s.anchorNode) ? cellOf(s.anchorNode) : null;
      if (cell) show(cell);
      else if (cur && menu.hidden && !nearTable()) hide();
    });
    addEventListener('scroll', () => { hideMenu(); if (cur) place(); }, true);
    addEventListener('resize', () => { if (cur) place(); });
    // the table can move without anything scrolling — a line opened above
    // it, a paragraph above growing as you type — so follow the layout
    new ResizeObserver(() => { if (cur) place(); }).observe(preview);
    preview.addEventListener('input', () => { if (cur) place(); });
    addEventListener('mousedown', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('.tgrip')) hideMenu();
    });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) hideMenu(); }, true);

    // ⇥ / ⇧⇥: next and previous cell, row by row. Tab off the last cell
    // makes a new row and lands in it — the spreadsheet move.
    preview.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey || !editing()) return;
      const s = getSelection();
      const cell = s && cellOf(s.anchorNode);
      if (!cell) return;
      e.preventDefault();
      const table = cell.closest('table');
      const all = [...table.rows].flatMap((tr) => [...tr.cells]);
      const k = all.indexOf(cell) + (e.shiftKey ? -1 : 1);
      if (k < 0) return;
      if (k < all.length) {
        const n = all[k];
        caretTo(table, n.parentNode.rowIndex, n.cellIndex);
        return;
      }
      show(cell);
      run('insertRow', table.rows.length);
    });

    return { hide };
  }

  window.setupTableGrips = setupTableGrips;
})();
