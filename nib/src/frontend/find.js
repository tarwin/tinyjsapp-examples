// Find and Replace — the bar over the editor, and the folder-wide search in
// the sidebar. Both are here because they are the same question asked at two
// scales, and they must answer it the same way: one place turns what you typed
// into a regular expression (`pattern`), and the folder search sends that very
// pattern to the backend rather than its own re-reading of your query.
//
// The bar searches the SOURCE, always — the textarea is the document of record,
// and a match found in the rendered preview would have nowhere to be replaced.
// Matches are painted through sync.js, which puts them in the coloured backdrop
// under the textarea: a <textarea> can't hold a highlight, and the backdrop has
// its metrics exactly.

(() => {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;

  // What you typed -> what gets matched. `null` means the query can't compile,
  // which only happens in regex mode and is shown as such rather than silently
  // finding nothing.
  function pattern(query, { regex, word, caseSensitive }) {
    if (!query) return null;
    let src = regex ? query : query.replace(RE_SPECIAL, '\\$&');
    if (word) src = '\\b(?:' + src + ')\\b';
    const flags = 'gm' + (caseSensitive ? '' : 'i');
    try { new RegExp(src, flags); } catch { return null; }
    return { source: src, flags };
  }

  // A replacement is a template in regex mode ($1, $&) and literal text
  // otherwise — where a bare $ has to be spelled $$ or it eats the next char.
  const replacementFor = (text, regex) => (regex ? text : text.replace(/\$/g, '$$$$'));

  function markLine(text, col, len) {
    return esc(text.slice(0, col)) + '<b>' + esc(text.substr(col, len)) + '</b>'
         + esc(text.slice(col + len));
  }

  // ------------------------------------------------------------------ the bar

  // opts: { bar, ed, peer, onEdit, canFind, docKind } — onEdit is called after
  // the text is changed from here, so the window can re-render and re-sync.
  function setupFindBar({ bar, ed, peer, onEdit, onFolder, scrollTo }) {
    const $ = (id) => document.getElementById(id);
    const q = $('findInput'), rep = $('replaceInput'), count = $('findCount');
    const opts = { regex: false, word: false, caseSensitive: false };
    let spans = [];                 // [from, to] for every match, in order
    let at = -1;                    // which one is current
    let replacing = false;

    const showing = () => !bar.hidden;

    function compile() {
      const p = pattern(q.value, opts);
      q.classList.toggle('bad', !!q.value && !p);
      return p;
    }

    // Re-run the search over the current text. Keeps you on the match nearest
    // to where you already were, so typing another letter doesn't jump.
    function search({ keepAt } = {}) {
      const anchor = at >= 0 && spans[at] ? spans[at][0] : ed.selectionStart;
      spans = [];
      const p = compile();
      if (p && q.value) {
        const re = new RegExp(p.source, p.flags);
        for (let m = re.exec(ed.value); m; m = re.exec(ed.value)) {
          spans.push([m.index, m.index + m[0].length]);
          if (!m[0].length) re.lastIndex++;             // matches nothing: step on
          if (spans.length > 20000) break;              // a runaway pattern
        }
      }
      if (!spans.length) at = -1;
      else if (keepAt && at >= 0) at = Math.min(at, spans.length - 1);
      else {
        at = spans.findIndex(([a]) => a >= anchor);
        if (at < 0) at = 0;
      }
      paint();
      return spans.length;
    }

    function paint() {
      const bad = q.value && !compile();
      count.textContent = bad ? 'Bad pattern'
        : !q.value ? ''
        : !spans.length ? 'No results'
        : (at + 1) + ' of ' + spans.length;
      count.classList.toggle('none', !!q.value && (bad || !spans.length));
      peer.paintFind(spans, at);
    }

    // Show the current match: select it in the textarea (which is what Replace
    // then acts on) and put it on screen in both panes.
    function reveal({ focusEditor } = {}) {
      const s = spans[at];
      if (!s) return;
      ed.setSelectionRange(s[0], s[1]);
      scrollTo(s[0]);
      peer.fromEditor({ scrollIntoView: true });         // the preview follows
      peer.paintFind(spans, at);                         // fromEditor repaints
      if (focusEditor) ed.focus();
    }

    function step(d) {
      // ⌘G with the bar closed brings it back with the last query, rather
      // than doing nothing at all
      if (!showing()) { open(); return; }
      if (!spans.length) { if (!search()) return; }
      if (!spans.length) return;
      at = (at + d + spans.length) % spans.length;
      paint();
      reveal();
    }

    // ------------------------------------------------------------ replacing

    function replaceOne() {
      const s = spans[at];
      if (!s) return;
      const p = compile();
      if (!p) return;
      const one = new RegExp(p.source, p.flags.replace('g', ''));
      const out = ed.value.slice(s[0], s[1]).replace(one, replacementFor(rep.value, opts.regex));
      ed.focus();
      ed.setSelectionRange(s[0], s[1]);
      // execCommand, not setRangeText: this is the only route that leaves the
      // textarea's own undo stack intact, and ⌘Z has to work after a replace
      document.execCommand('insertText', false, out);
      onEdit();
      // the text moved under every later match — re-find, and stay put
      search({ keepAt: true });
      if (at >= 0 && spans.length) reveal();
      q.focus();
    }

    function replaceAll() {
      const p = compile();
      if (!p || !spans.length) return;
      const re = new RegExp(p.source, p.flags);
      const out = ed.value.replace(re, replacementFor(rep.value, opts.regex));
      if (out === ed.value) return;
      const n = spans.length;
      const top = ed.scrollTop;
      ed.focus();
      ed.select();
      document.execCommand('insertText', false, out);
      ed.scrollTop = top;
      onEdit();
      search();
      q.focus();
      return n;
    }

    // ---------------------------------------------------------------- wiring

    q.addEventListener('input', () => { search(); if (spans.length) reveal(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    rep.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.metaKey ? replaceAll() : replaceOne(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });

    for (const [id, key] of [['findCase', 'caseSensitive'], ['findWord', 'word'], ['findRe', 'regex']]) {
      $(id).onclick = () => {
        opts[key] = !opts[key];
        $(id).classList.toggle('on', opts[key]);
        search();
        if (spans.length) reveal();
        q.focus();
      };
    }
    $('findNext').onclick = () => step(1);
    $('findPrev').onclick = () => step(-1);
    $('findClose').onclick = () => close();
    $('replaceOne').onclick = () => replaceOne();
    $('replaceAll').onclick = () => replaceAll();
    $('findFolder').onclick = () => onFolder(q.value, opts);
    $('findToggle').onclick = () => setReplacing(!replacing);

    function setReplacing(on) {
      replacing = on;
      bar.classList.toggle('rep', on);
      $('findReplaceRow').hidden = !on;
      $('findToggle').textContent = on ? '⌄' : '›';
      $('findToggle').title = on ? 'Hide Replace' : 'Replace (⌥⌘F)';
    }

    function open({ replace, seed } = {}) {
      const wasOpen = showing();
      bar.hidden = false;
      if (replace || !wasOpen) setReplacing(!!replace || replacing);
      if (seed) q.value = seed;
      search();
      q.focus();
      q.select();
      if (spans.length) reveal();
    }

    function close() {
      if (!showing()) return;
      bar.hidden = true;
      peer.clearFind();
      spans = [];
      at = -1;
      ed.focus();
    }

    return {
      open,
      close,
      showing,
      toggleReplace: () => setReplacing(true),
      next: () => step(1),
      prev: () => step(-1),
      query: () => q.value,
      options: () => ({ ...opts }),
      // the document changed under us (an edit, a tab switch, a repaint of the
      // backdrop) — the offsets and the DOM ranges both have to be redone
      refresh() { if (showing()) { search({ keepAt: true }); } },
      repaint() { if (showing()) peer.paintFind(spans, at); },
    };
  }

  // --------------------------------------------------------- the folder panel

  // The sidebar's other face: one search over every text file in the project,
  // grouped by file, and a Replace All that goes through the backend in one
  // call. opts.onOpen(hit, { preview }) is how a result becomes a document.
  function setupSearchPanel({ panel, onOpen, onClose }) {
    const $ = (id) => document.getElementById(id);
    const q = $('sfInput'), rep = $('sfReplace'), list = $('sfResults'), note = $('sfNote');
    const opts = { regex: false, word: false, caseSensitive: false };
    let data = null;                 // the last answer from the backend
    let timer = null;
    let cursor = null;               // 'rel:line:col' of the row you're on
    const collapsed = new Set();

    const showing = () => !panel.hidden;

    function compile() {
      const p = pattern(q.value, opts);
      q.classList.toggle('bad', !!q.value && !p);
      return p;
    }

    async function run() {
      const p = compile();
      if (!p) {
        data = null;
        note.textContent = q.value ? 'Bad pattern' : '';
        list.textContent = '';
        return;
      }
      const r = await tiny.api.call('findInFolder', { pattern: p.source, flags: p.flags });
      if (!r || r.error) {
        data = null;
        note.textContent = (r && r.error) || 'Search failed';
        list.textContent = '';
        return;
      }
      data = r;
      const files = r.files.length;
      note.textContent = !r.total ? 'No results'
        : r.total + (r.total === 1 ? ' result in ' : ' results in ')
          + files + (files === 1 ? ' file' : ' files')
          + (r.truncated ? ' (showing the first ' + r.total + ')' : '');
      paint();
    }

    const soon = () => { clearTimeout(timer); timer = setTimeout(run, 180); };

    function paint() {
      list.textContent = '';
      if (!data) return;
      for (const f of data.files) {
        const head = document.createElement('div');
        head.className = 'sfFile' + (collapsed.has(f.rel) ? ' shut' : '');
        head.innerHTML = '<span class="sfTwist">▾</span><span class="sfName">' + esc(f.name)
          + '</span><span class="sfDir">' + esc(f.rel.slice(0, Math.max(0, f.rel.length - f.name.length - 1)))
          + '</span><span class="sfN">' + f.hits.length + '</span>';
        head.onclick = () => {
          if (collapsed.has(f.rel)) collapsed.delete(f.rel);
          else collapsed.add(f.rel);
          paint();
        };
        list.appendChild(head);
        if (collapsed.has(f.rel)) continue;
        for (const h of f.hits) {
          const key = f.rel + ':' + h.line + ':' + h.col;
          const row = document.createElement('div');
          row.className = 'sfHit' + (key === cursor ? ' cur' : '');
          row.innerHTML = '<span class="sfLn">' + (h.line + 1) + '</span><span class="sfTxt">'
            + markLine(h.text, h.col, h.len) + '</span>';
          row.onclick = () => { cursor = key; paint(); onOpen({ ...h, path: f.path }, { preview: true }); };
          row.ondblclick = () => onOpen({ ...h, path: f.path }, { preview: false });
          list.appendChild(row);
        }
      }
    }

    async function replaceAll() {
      const p = compile();
      if (!p || !data || !data.total) return;
      const n = data.total, files = data.files.length;
      const go = await tiny.dialog.confirm(
        'Replace ' + n + (n === 1 ? ' result' : ' results') + ' in '
          + files + (files === 1 ? ' file' : ' files') + '?',
        { detail: 'This writes to the files on disk. It can be undone in an open '
            + 'document with ⌘Z, but not in the ones that aren’t open.',
          ok: 'Replace All' });
      if (!go) return;
      const r = await tiny.api.call('replaceInFolder', {
        pattern: p.source, flags: p.flags, replace: replacementFor(rep.value, opts.regex) });
      if (!r || r.error) { note.textContent = (r && r.error) || 'Replace failed'; return; }
      await run();
      const skipped = (r.skipped || []).length;
      note.textContent = 'Replaced in ' + r.changed + (r.changed === 1 ? ' file' : ' files')
        + (skipped ? ' · ' + skipped + ' skipped (unsaved changes)' : '');
    }

    q.addEventListener('input', soon);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    });
    rep.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    });
    for (const [id, key] of [['sfCase', 'caseSensitive'], ['sfWord', 'word'], ['sfRe', 'regex']]) {
      $(id).onclick = () => {
        opts[key] = !opts[key];
        $(id).classList.toggle('on', opts[key]);
        run();
      };
    }
    $('sfAll').onclick = () => replaceAll();

    return {
      showing,
      focus() { q.focus(); q.select(); },
      // opened from the bar: carry the query and its options across
      seed(query, from) {
        if (query != null) q.value = query;
        if (from) {
          for (const [id, key] of [['sfCase', 'caseSensitive'], ['sfWord', 'word'], ['sfRe', 'regex']]) {
            opts[key] = !!from[key];
            document.getElementById(id).classList.toggle('on', opts[key]);
          }
        }
      },
      run,
      // the folder changed under the results (a rename, a replace, a refresh)
      refresh() { if (showing() && q.value) run(); },
      clear() { data = null; list.textContent = ''; note.textContent = ''; },
    };
  }

  window.findPattern = pattern;
  window.setupFindBar = setupFindBar;
  window.setupSearchPanel = setupSearchPanel;
})();
