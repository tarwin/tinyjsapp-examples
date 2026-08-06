// The project side of a document window: the file tree in the left sidebar,
// and the palette that Open Quickly (⌘P) and the @-picker share.
//
// The backend owns the folder — one at a time, app-wide — and pushes the whole
// tree down as plain data, so this file never touches the filesystem. Two
// things it does own: the fuzzy match (a subsequence scorer, no dependency)
// and the relative path an inserted link needs, which is relative to the
// DOCUMENT, not to the project root, because that's what Markdown resolves
// against and what the backend hands the preview back for.

(() => {
  // ------------------------------------------------------------------ paths

  // a/b/c.md relative to a/x/y.md -> ../b/c.md
  function relativeTo(fromDir, target) {
    if (!fromDir) return target;
    const a = fromDir.split('/').filter(Boolean);
    const b = target.split('/').filter(Boolean);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const up = a.length - i;
    const rest = b.slice(i);
    if (!up && rest.length === b.length) return target;       // nothing in common
    return (up ? '../'.repeat(up) : '') + rest.join('/');
  }

  // ------------------------------------------------------------------ match
  //
  // Everything is matched against the path RELATIVE TO THE PROJECT ROOT, so
  // typing a folder narrows the list the way typing a filename does, and spaces
  // cut the query into terms that may land anywhere in it, in any order —
  // "deep note" finds docs/deep/nested-note.md, and so does "dn". Matches in
  // the filename still outrank matches in the folders above it, which is the
  // one thing you always mean.

  // One term as a subsequence of `text`, starting at `from`. Greedy, which
  // never misses a match that exists — only, sometimes, the prettiest one; the
  // caller runs it twice and keeps the better. Returns null for no match.
  function subseq(text, lower, q, from) {
    const hits = [];
    let i = from, s = 0, streak = 0;
    for (const ch of q) {
      const at = lower.indexOf(ch, i);
      if (at < 0) return null;
      const prev = at ? text[at - 1] : '/';
      if (at === i && hits.length) { streak++; s += 6 + streak * 2; }
      else { streak = 0; s += 1; }
      if (/[\s/_\-.]/.test(prev)) s += 8;                     // start of a word
      else if (prev === prev.toLowerCase() && text[at] !== lower[at]) s += 6;  // camelCase
      if (text[at] === ch) s += 2;                            // you typed the case too
      hits.push(at);
      i = at + 1;
    }
    return { score: s, hits };
  }

  // Every term has to match, and each is scored twice — over the whole path and
  // over the filename alone — because greedy matching from the left would
  // otherwise spend a term's letters in the folders and never reach the name.
  function scoreFile(f, terms) {
    const rel = f.rel, lower = rel.toLowerCase();
    const nameAt = rel.length - f.name.length;
    let total = 0;
    const hits = [];
    for (const t of terms) {
      const weigh = (m) => {
        if (!m) return null;
        const all = m.hits.every((h) => h >= nameAt);
        return { hits: m.hits,
          score: m.score + (all ? 18 : 0) + (m.hits[0] === nameAt || m.hits[0] === 0 ? 12 : 0) };
      };
      const a = weigh(subseq(rel, lower, t, 0));
      const b = weigh(subseq(rel, lower, t, nameAt));
      const best = !a ? b : !b || a.score >= b.score ? a : b;
      if (!best) return null;
      total += best.score - best.hits[0] * 0.05;              // early beats late
      hits.push(...best.hits);
    }
    return { score: total, hits: [...new Set(hits)].sort((x, y) => x - y) };
  }

  function rank(files, q, limit) {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const f of files) {
      const m = terms.length ? scoreFile(f, terms) : { score: 0, hits: [] };
      if (m) out.push({ f, score: m.score, hits: m.hits });
    }
    out.sort((a, b) => b.score - a.score || a.f.rel.length - b.f.rel.length);
    return out.slice(0, limit || 40);
  }

  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function mark(text, hits) {
    let out = '', last = 0;
    for (const h of hits) {
      out += esc(text.slice(last, h)) + '<b>' + esc(text[h]) + '</b>';
      last = h + 1;
    }
    return out + esc(text.slice(last));
  }

  // ------------------------------------------------------------------- tree

  // The tree is a listbox, not a pile of divs: one row at a time holds the
  // cursor, ↑↓ move it, → and ← open and close folders, and moving the cursor
  // PREVIEWS the file (onOpen with preview: true) the way a single click does.
  // ⌘⏎ is "I mean it" — the same open, kept. ⏎ renames in place, which is
  // Finder's binding rather than VS Code's, and the one that was asked for.
  // `showAll` is a live getter (View ▸ Show All Files in Folder): off, files
  // Nib can't open are left out of the tree entirely, with a one-line footer
  // saying how many — click it (or the menu) to bring them back.
  function setupFiles({ nav, title, tree, onOpen, onChoose, onRename, onMenu, onEscape, showAll, onShowAll, onPin }) {
    nav.tabIndex = 0;                // a listbox has to be focusable to be one
    let data = null;                 // the project payload
    let current = null;              // the path this window is showing
    let cursor = null;               // the row with the keyboard cursor, by path
    let rows = [];                   // what's visible right now, in order
    let renaming = null;             // the path being renamed, while it is
    let typed = null;                // what has been typed into that field
    const open = new Set();          // expanded folders, by path

    // Moving the cursor with the arrow keys shows the file, but a held-down
    // arrow shouldn't open twenty documents on its way past them.
    let previewTimer = null;
    function previewSoon(n) {
      clearTimeout(previewTimer);
      if (!n || n.dir || n.kind === 'other') return;
      previewTimer = setTimeout(() => onOpen(n, { preview: true }), 170);
    }

    function paint() {
      tree.textContent = '';
      rows = [];
      // pins parked by the master switch stay visible, but only just
      tree.classList.toggle('pins-off', !!data && data.pinsOn === false);
      // No folder open: the panel is the way to choose one. Hiding it until a
      // project exists left the only route to a project in the File menu.
      if (!data) {
        title.textContent = 'Files';
        title.title = '';
        const p = document.createElement('div');
        p.id = 'treeEmpty';
        p.textContent = 'No folder is open. A folder puts its files here, and in Open Quickly (⌘P).';
        const b = document.createElement('button');
        b.id = 'treePick';
        b.textContent = 'Open Folder…';
        b.onclick = () => onChoose && onChoose();
        tree.append(p, b);
        return;
      }
      title.textContent = data.name;
      title.title = data.root;
      if (!data.tree.length) {
        const p = document.createElement('div');
        p.id = 'treeEmpty';
        p.textContent = 'This folder is empty.';
        tree.appendChild(p);
        return;
      }
      const all = !showAll || showAll();
      const walk = (nodes, depth) => {
        for (const n of nodes) {
          if (!all && !n.dir && n.kind === 'other') continue;
          rows.push({ n, el: row(n, depth) });
          if (n.dir && open.has(n.path)) walk(n.kids, depth + 1);
        }
      };
      walk(data.tree, 0);
      for (const r of rows) tree.appendChild(r.el);
      if (cursor && !rows.some((r) => r.n.path === cursor)) cursor = null;
      // whole-tree count, not just the folders that happen to be expanded
      if (!all) {
        const hidden = (data.files || []).filter((f) => f.kind === 'other').length;
        if (hidden) {
          const foot = document.createElement('div');
          foot.id = 'treeHidden';
          foot.textContent = hidden + (hidden === 1 ? ' file Nib can’t open is hidden' : ' files Nib can’t open are hidden');
          foot.title = 'View ▸ Show All Files in Folder';
          foot.onclick = () => onShowAll && onShowAll();
          tree.appendChild(foot);
        }
      }
    }

    function row(n, depth) {
      // `.nib` at the top of the folder is NIB'S OWN — the settings and the
      // actions that travel with the folder, not something you put there. It
      // is in the tree because hiding the files the app tells you to edit only
      // makes people hunt; it wears a different icon (and a quieter name) so
      // it never reads as one of your own folders.
      const ours = n.dir && depth === 0 && n.name === '.nib';
      const el = document.createElement('div');
      el.className = 'trow' + (n.dir || n.kind === 'doc' || n.kind === 'image' ? '' : ' dim')
        + (ours ? ' ours' : '');
      el.style.paddingLeft = 8 + depth * 12 + 'px';
      el.title = ours ? 'Nib’s own settings and actions for this folder' : n.path;
      el.dataset.path = n.path;
      const tw = document.createElement('span');
      tw.className = 'tw';
      tw.textContent = n.dir ? (open.has(n.path) ? '▾' : '▸') : '';
      const icon = document.createElement('span');
      icon.className = 'ti';
      icon.textContent = ours ? '⚙'
        : n.dir ? '📁' : n.kind === 'doc' ? '📄' : n.kind === 'image' ? '🖼' : '·';
      const name = document.createElement('span');
      name.className = 'tn';
      name.textContent = n.name;
      el.append(tw, icon, name);
      // A pinned folder wears its pin, and the pin itself is the control:
      // each click narrows what it covers — everything, Markdown, pictures —
      // and the last click takes it off. Pinning starts in the context menu.
      const pinned = n.dir && data.pins && data.pins[n.path];
      if (pinned) {
        const pin = document.createElement('span');
        pin.className = 'tpin';
        pin.textContent = '📌';
        if (pinned !== 'all') {
          const k = document.createElement('span');
          k.className = 'tpk';
          k.textContent = pinned === 'docs' ? 'md' : 'img';
          pin.appendChild(k);
        }
        pin.title = {
          all: 'Search is pinned here — every file. Click: Markdown only.',
          docs: 'Search is pinned here — Markdown only. Click: pictures only.',
          images: 'Search is pinned here — pictures only. Click to unpin.',
        }[pinned];
        pin.onclick = (e) => {
          e.stopPropagation();
          if (onPin) onPin(n, { all: 'docs', docs: 'images', images: null }[pinned]);
        };
        el.appendChild(pin);
      }
      if (!n.dir && n.path === current) el.classList.add('on');
      if (n.path === cursor) el.classList.add('cur');
      if (n.path === renaming) queueMicrotask(() => editRow(n, el));

      el.onmousedown = (e) => {
        if (e.button === 2 || renaming) return;
        e.preventDefault();                    // keep the cursor in the tree
        nav.focus();
      };
      el.onclick = () => {
        if (renaming) return;
        cursor = n.path;
        if (n.dir) {
          open.has(n.path) ? open.delete(n.path) : open.add(n.path);
          paint();
        } else {
          paint();
          if (n.kind !== 'other') onOpen(n, { preview: true });
        }
      };
      // A double-click means it: the tab stops being a preview — and on a
      // file Nib can't open (visible with Show All Files), it means the
      // system's own app instead.
      el.ondblclick = () => {
        if (!n.dir) onOpen(n, { preview: false });
      };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (renaming) return;
        cursor = n.path;
        paint();
        if (onMenu) onMenu(n, e.clientX, e.clientY);
      };
      return el;
    }

    // ------------------------------------------------------------- renaming
    //
    // In place, in the row itself — the extension is left out of the initial
    // selection because renaming `notes.md` almost never means renaming `.md`.
    function editRow(n, el) {
      if (!el.isConnected) return;             // a repaint beat us to it
      const label = el.querySelector('.tn');
      if (!label) return;
      const input = document.createElement('input');
      input.className = 'tname-edit';
      input.type = 'text';
      // The file you just clicked is still loading, and its arrival repaints
      // the tree under us — so the field is rebuilt mid-rename. What you have
      // typed is kept in `typed` and put back, rather than lost or reset.
      const fresh = typed === null;
      input.value = fresh ? n.name : typed;
      input.spellcheck = false;
      label.replaceWith(input);
      input.focus();
      const dot = n.dir ? -1 : input.value.lastIndexOf('.');
      if (fresh) input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
      else input.setSelectionRange(input.value.length, input.value.length);
      input.oninput = () => { typed = input.value; };

      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        renaming = null;
        const value = input.value;
        typed = null;
        paint();
        nav.focus();
        if (commit && value.trim() && value !== n.name && onRename) onRename(n, value.trim());
      };
      input.onkeydown = (e) => {
        e.stopPropagation();                   // the tree's own keys are off
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      };
      // Like Finder, clicking away accepts the name — but a REPAINT also
      // blurs the field (the row it lives in is rebuilt), and that must not
      // count as leaving: the file being opened underneath you would end the
      // rename you just started. A detached input is a repaint, not a person.
      input.onblur = () => { if (input.isConnected) finish(true); };
    }

    function startRename(n) {
      if (!n) return;
      renaming = n.path;
      typed = null;
      paint();
    }

    // -------------------------------------------------------------- the keys

    function at(delta) {
      const i = rows.findIndex((r) => r.n.path === cursor);
      const next = rows[Math.min(rows.length - 1, Math.max(0, (i < 0 ? 0 : i + delta)))];
      return next || null;
    }
    function moveTo(r, { preview = true } = {}) {
      if (!r) return;
      cursor = r.n.path;
      paint();
      const el = tree.querySelector('.trow.cur');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      if (preview) previewSoon(r.n);
    }
    const node = () => (rows.find((r) => r.n.path === cursor) || {}).n || null;

    nav.addEventListener('keydown', (e) => {
      if (renaming || !data) return;
      const n = node();
      if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(at(1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveTo(at(-1)); }
      else if (e.key === 'Home') { e.preventDefault(); moveTo(rows[0]); }
      else if (e.key === 'End') { e.preventDefault(); moveTo(rows[rows.length - 1]); }
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (n && n.dir && !open.has(n.path)) { open.add(n.path); paint(); }
        else if (n && n.dir) moveTo(at(1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (n && n.dir && open.has(n.path)) { open.delete(n.path); paint(); }
        else if (n) {                          // jump to the folder it's in
          const up = n.path.slice(0, n.path.lastIndexOf('/'));
          const r = rows.find((x) => x.n.path === up);
          if (r) moveTo(r, { preview: false });
        }
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        clearTimeout(previewTimer);
        if (n && !n.dir && n.kind !== 'other') onOpen(n, { preview: false });
      } else if (e.key === 'Enter') {
        e.preventDefault();                    // ⏎ renames; ←/→ do the folders
        startRename(n);
      } else if (e.key === ' ') {
        e.preventDefault();
        if (n && !n.dir && n.kind !== 'other') onOpen(n, { preview: true });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearTimeout(previewTimer);
        if (onEscape) onEscape();              // hand the keyboard back
      }
    });

    return {
      set(payload, showing) {
        data = payload;
        current = showing || current;
        if (!data) { cursor = null; renaming = null; typed = null; }
        if (data && !open.size) {
          // first paint: open the folders on the way to this document, so the
          // file you are looking at is visible without hunting for it
          for (const seg of (current || '').split('/').slice(0, -1)) void seg;
          let p = (current || '').slice(0, (current || '').lastIndexOf('/'));
          while (p && p.length > data.root.length) {
            open.add(p);
            p = p.slice(0, p.lastIndexOf('/'));
          }
        }
        paint();
      },
      // The file on screen — and where the keyboard cursor goes when you come
      // to the tree from the document rather than the other way round.
      showing(path) {
        current = path;
        if (path) cursor = path;
        paint();
      },
      files: () => (data ? data.files : []),
      pins: () => (data && data.pins) || {},
      pinsOn: () => !!data && data.pinsOn !== false,
      // the heading index: rel -> { title, heads } — arrives a beat after the
      // folder (built in the backend's background), so it has its own setter
      heads: () => (data && data.heads) || {},
      setHeads(h) { if (data) data.heads = h; },
      roots: () => (data && data.roots) || { link: '', image: '' },
      root: () => (data ? data.root : null),
      has: () => !!data,
      // the node under the cursor, for the menu and for Rename from elsewhere
      node: () => (rows.find((r) => r.n.path === cursor) || {}).n || null,
      rename: (n) => startRename(n || null),
      focus() {
        nav.focus();
        if (!cursor && rows.length) { cursor = rows[0].n.path; paint(); }
      },
      paint,
    };
  }

  // ---------------------------------------------------------------- palette

  function setupPalette({ box, input, list, hint }) {
    let items = [], sel = 0, onPick = null, onCancel = null;
    // headings: the index (rel -> { title, heads }), and the descend state —
    // ⇥ on a file steps INTO its headings, esc steps back out
    let headsMap = null, mode = 'files', headFile = null, keptQuery = '';
    let openHint = '', openPlaceholder = '';

    const close = (cancelled) => {
      if (box.hidden) return;
      box.hidden = true;
      box.classList.remove('at-caret');
      mode = 'files';
      headFile = null;
      const c = onCancel;
      onPick = onCancel = null;
      if (cancelled && c) c();
    };

    // a heading as a rankable pseudo-file: the file's path and kind ride
    // along untouched, `head` marks it, rel/name are what the scorer sees —
    // and orel/oname keep the file's own, for descend and the pick handlers
    const headEntry = (f, h, rel) =>
      ({ ...f, head: h, rel, name: h.text, orel: f.rel, oname: f.name });

    function descend(f) {
      const hx = headsMap && headsMap[f.rel];
      if (!hx || !hx.heads.length) return;
      mode = 'heads';
      headFile = f;
      keptQuery = input.value;
      input.value = '';
      input.placeholder = 'Heading in ' + f.name + '…';
      hint.textContent = '⏎ picks the heading · esc back to the files';
      refresh();
    }
    function surface() {
      mode = 'files';
      headFile = null;
      input.value = keptQuery;
      input.placeholder = openPlaceholder;
      hint.textContent = openHint;
      refresh();
    }

    function paint() {
      list.textContent = '';
      if (!items.length) {
        const none = document.createElement('div');
        none.id = 'paletteNone';
        none.textContent = 'No matching files';
        list.appendChild(none);
        return;
      }
      items.forEach((it, k) => {
        const row = document.createElement('div');
        row.className = 'prow' + (k === sel ? ' on' : '');
        // hits are indices into the whole relative path: split them at the
        // filename so the name and its folder can be marked in their own spans
        const nameAt = it.f.rel.length - it.f.name.length;
        const dir = nameAt ? it.f.rel.slice(0, nameAt - 1) : '';
        if (it.f.head) {
          const lv = document.createElement('span');
          lv.className = 'ph';
          lv.textContent = '#'.repeat(it.f.head.level);
          row.appendChild(lv);
        }
        const n = document.createElement('span');
        n.className = 'pn';
        n.innerHTML = mark(it.f.name, it.hits.filter((h) => h >= nameAt).map((h) => h - nameAt));
        const p = document.createElement('span');
        p.className = 'pp';
        p.innerHTML = mark(dir, it.hits.filter((h) => h < dir.length));
        row.append(n, p);
        row.onmousedown = (e) => { e.preventDefault(); pick(k); };
        list.appendChild(row);
      });
      const on = list.children[sel];
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }

    function pick(k) {
      const it = items[k];
      if (!it) return;
      const fn = onPick;
      close(false);
      if (fn) fn(it.f);
    }

    input.addEventListener('input', () => { refresh(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
        e.preventDefault();
        sel = Math.min(items.length - 1, sel + 1);
        paint();
      } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
        e.preventDefault();
        sel = Math.max(0, sel - 1);
        paint();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(sel);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (mode === 'heads') surface();       // esc steps back before it closes
        else close(true);
      } else if (mode === 'files'
          && (e.key === 'Tab' && !e.shiftKey
              || (e.key === 'ArrowRight' && input.selectionStart === input.value.length
                  && input.selectionStart === input.selectionEnd))) {
        // ⇥ (or → at the end of the query) steps into the file's headings
        const it = items[sel];
        if (it && headsMap && headsMap[it.f.rel] && headsMap[it.f.rel].heads.length) {
          e.preventDefault();
          descend(it.f.head ? { ...it.f, head: undefined, rel: it.f.orel, name: it.f.oname } : it.f);
        } else if (e.key === 'Tab') e.preventDefault();   // the focus stays put
      } else if (mode === 'heads' && e.key === 'Backspace' && !input.value) {
        e.preventDefault();
        surface();
      } else if (e.key === 'Tab') e.preventDefault();
    });
    input.addEventListener('blur', () => close(true));

    let source = [], filter = '';
    function refresh() {
      filter = input.value;
      if (mode === 'heads') {
        const hx = (headsMap && headsMap[headFile.rel]) || { heads: [] };
        items = rank(hx.heads.map((h) => headEntry(headFile, h, h.text)), filter, 40);
      } else {
        const entries = [...source];
        // headings ride along in the main list once there's a query — a file
        // named like the heading you meant still outranks it, which is right
        if (headsMap && filter.trim()) {
          for (const f of source) {
            const hx = headsMap[f.rel];
            if (!hx) continue;
            for (const h of hx.heads) entries.push(headEntry(f, h, f.rel + ' › ' + h.text));
          }
        }
        items = rank(entries, filter, 40);
      }
      sel = 0;
      paint();
    }

    return {
      open({ files, heads, placeholder, hintText, at, prefill, pick: onPickFn, cancel }) {
        source = files;
        headsMap = heads || null;
        mode = 'files';
        headFile = null;
        keptQuery = '';
        onPick = onPickFn;
        onCancel = cancel;
        openPlaceholder = placeholder || 'Open quickly…';
        openHint = hintText || '↑↓ to choose · ⏎ to open · esc to dismiss';
        input.placeholder = openPlaceholder;
        hint.textContent = openHint;
        input.value = prefill || '';
        box.hidden = false;
        box.classList.toggle('at-caret', !!at);
        if (at) {
          // keep the whole box on screen wherever the caret happens to be
          const w = box.offsetWidth, h = box.offsetHeight;
          const x = Math.min(Math.max(8, at.x), innerWidth - w - 8);
          const below = at.y + at.height + 6;
          box.style.left = Math.round(x) + 'px';
          box.style.top = Math.round(below + h < innerHeight - 8 ? below : at.y - h - 6) + 'px';
        } else {
          box.style.left = '50%';
          box.style.top = '64px';
        }
        refresh();
        input.focus();
        input.select();
      },
      // the @-picker keeps typing in the document, so it feeds us the query
      setQuery(q) { input.value = q; refresh(); },
      isOpen: () => !box.hidden,
      close,
    };
  }

  window.setupFiles = setupFiles;
  window.setupPalette = setupPalette;
  window.relativeTo = relativeTo;
})();
