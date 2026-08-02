// Keeping two views of one document in step — the hard part of this app.
//
// The two panes have nothing in common geometrically: the source is a flat
// run of wrapped lines, the preview is a tree whose boxes have their own
// heights, and some of that tree ISN'T LAID OUT AT ALL (a hidden tab panel
// has no rect, no offsetParent, no height). Anything that reasons about
// pixels has to cope with that; anything that reasons about position has to
// map through the document instead.
//
// So there are three layers here, and they're deliberately separate:
//
//   1. A block index. md.js stamps every rendered block with the source line
//      it came from, so `blocks` is a sorted list of (element, first line,
//      last line). Deepest match wins, which is why parents are listed
//      before children.
//   2. A character map, per block, built lazily. The rendered text of a
//      block is very nearly a subsequence of its Markdown source ("**bold**"
//      renders as "bold"), so a two-pointer walk — take the character if it's
//      next, otherwise scan forward — gives a monotone rendered→source index
//      map. Exact for prose; inside dense punctuation it can slip by a
//      character or two, and it can never leave the block.
//   3. Painting. Selections use the CSS Custom Highlight API so nothing is
//      injected into the document (the preview may be contenteditable, and a
//      stray marker span would end up in your Markdown). Carets are measured
//      with a collapsed Range and drawn as a fixed-position overlay.
//
// Scroll follows the same rule: never ratios. Take the line at the top of the
// source pane, find its block, and put THAT at the top of the preview —
// interpolating within blocks that span several lines, and climbing to the
// nearest laid-out ancestor when the target is inside a closed tab.

(() => {
  const HL_SUPPORTED = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';

  function createPeerSync(opts) {
    const { ed, edBack, preview, previewPane, caretPeer, caretSource } = opts;

    let cache = null;
    const invalidate = () => { cache = null; };

    // ------------------------------------------------------------- the index

    function model() {
      if (cache) return cache;
      const lines = ed.value.split('\n');
      const starts = new Int32Array(lines.length + 1);
      for (let i = 0; i < lines.length; i++) starts[i + 1] = starts[i] + lines[i].length + 1;

      const blocks = [];
      for (const el of preview.querySelectorAll('[data-line]')) {
        if (el.tagName === 'INPUT') continue;            // task boxes aren't blocks
        const line = +el.dataset.line;
        if (!isNaN(line)) blocks.push({ el, line, end: lines.length - 1 });
      }
      // A block runs until the next one that starts further down. Document
      // order is source order, so the lines are non-decreasing and one
      // backwards pass does it — this is rebuilt on every keystroke, so the
      // obvious nested loop is not an option on a long document.
      for (let i = blocks.length - 1; i >= 0; i--) {
        const next = i + 1 < blocks.length
          ? (blocks[i + 1].line > blocks[i].line ? blocks[i + 1].line : blocks[i + 1].after)
          : lines.length;
        blocks[i].after = next;
        blocks[i].end = Math.max(blocks[i].line, next - 1);
      }
      cache = { lines, starts, blocks, maps: new WeakMap() };
      return cache;
    }

    const lineOf = (off) => {
      const { starts } = model();
      let lo = 0, hi = starts.length - 2, best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= off) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    };

    // parents come first in document order, so the last container wins
    function blockForLine(line) {
      const { blocks } = model();
      let best = null;
      for (const b of blocks) if (b.line <= line && line <= b.end) best = b;
      return best;
    }

    // ------------------------------------------------- the per-block char map

    // The node list is NEVER cached — contenteditable splits and merges text
    // nodes behind your back (focusing the preview is enough), and a stale
    // list silently collapses every lookup to the start of the block. The
    // index arithmetic is cached, guarded by the block's own text.
    function nodesOf(el) {
      const out = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n);
      return out;
    }

    // Source that renders to no text at all: an image's whole run, and the
    // `](url)` tail of a link. The walk below finds the next occurrence of a
    // rendered character, and inside an alt text or a url there is always one
    // to find — so a paragraph with a picture in it would drag every character
    // after it out of step. Blanked index-for-index, they can't be matched
    // and the walk steps straight over them.
    const INVISIBLE = /!\[[^\]\n]*\]\([^)\n]*\)|\]\([^)\n]*\)/g;
    // NUL rather than spaces: spaces would go on matching the spaces in the
    // rendered text, which is the whole problem over again.
    const blank = (s) => s.replace(INVISIBLE, (m) => '\u0000'.repeat(m.length));

    function mapFor(b) {
      const m = model();
      const text = b.el.textContent;
      let mp = m.maps.get(b.el);
      if (mp && mp.text === text) return mp;

      const src = m.lines.slice(b.line, b.end + 1).join('\n');
      const hay = blank(src);                            // matched against

      const map = new Int32Array(text.length + 1);
      let s = 0;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (hay[s] === ch) { map[i] = s++; continue; }   // the common case
        const j = hay.indexOf(ch, s);                    // syntax in between
        if (j < 0) { map[i] = s; continue; }             // rendered-only text
        map[i] = j;
        s = j + 1;
      }
      map[text.length] = s;

      mp = { src, text, map, base: m.starts[b.line] };
      m.maps.set(b.el, mp);
      return mp;
    }

    // rendered index -> a DOM position inside the block
    function domAt(el, mp, i) {
      const nodes = nodesOf(el);
      let left = Math.max(0, Math.min(i, mp.text.length));
      for (const node of nodes) {
        const len = node.nodeValue.length;
        if (left <= len) return { node, offset: left };
        left -= len;
      }
      const last = nodes[nodes.length - 1];
      return last ? { node: last, offset: last.nodeValue.length } : null;
    }

    // a DOM position -> rendered index
    function indexAt(el, node, offset) {
      let n = 0;
      for (const t of nodesOf(el)) {
        if (t === node) return n + Math.min(offset, t.nodeValue.length);
        n += t.nodeValue.length;
      }
      return -1;
    }

    // ---------------------------------------------------- source <-> preview

    // Absolute source offset -> DOM position in the preview.
    //
    // `forward` matters where the offset lands in a gap — the run of syntax
    // that produced no rendered text, like the `*` of `*word*`. Both ends of a
    // selection snap forward, to the first rendered character at or after the
    // offset: an offset sitting on a marker means the text next to it, at
    // either end. A collapsed caret snaps back instead, so it stays put rather
    // than jumping over the markers you are typing.
    function srcToDom(off, forward) {
      const b = blockForLine(lineOf(off));
      if (!b) return null;
      const mp = mapFor(b);
      const want = off - mp.base;
      if (!mp.text.length) return { block: b, node: b.el, offset: 0, atElement: true };
      let lo = 0, hi = mp.text.length, best = 0;                 // map is monotone
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (mp.map[mid] <= want) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (forward && mp.map[best] < want && best < mp.text.length) best++;
      const at = domAt(b.el, mp, best);
      return at && { block: b, node: at.node, offset: at.offset };
    }

    // DOM position in the preview -> absolute source offset. `atEnd` marks the
    // exclusive end of a selection: it resolves to one past the last character
    // actually selected rather than to the start of whatever comes next, so
    // selecting the word inside `*word*` doesn't come back with the closing
    // star attached.
    function domToSrc(node, offset, atEnd) {
      let el = node.nodeType === 3 ? node.parentElement : node;
      while (el && el !== preview && !el.hasAttribute('data-line')) el = el.parentElement;
      if (!el || el === preview) return null;
      const b = model().blocks.find((x) => x.el === el);
      if (!b) return null;
      const mp = mapFor(b);
      const i = node.nodeType === 3 ? indexAt(b.el, node, offset) : 0;
      if (i < 0) return mp.base;
      const k = Math.min(i, mp.text.length);
      if (atEnd && k > 0) return mp.base + mp.map[k - 1] + 1;
      return mp.base + mp.map[k];
    }

    // ------------------------------------------------------- the source rows

    // absolute source offset -> a DOM position inside the coloured backdrop,
    // which is one <div> per line whose text matches that line exactly
    function srcToRow(off) {
      const m = model();
      const line = lineOf(off);
      const row = edBack.children[line];
      if (!row) return null;
      let col = off - m.starts[line];
      const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let node = null;
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        node = n;
        if (col <= n.nodeValue.length) return { row, node: n, offset: col };
        col -= n.nodeValue.length;
      }
      return node ? { row, node, offset: node.nodeValue.length } : { row, node: row, offset: 0 };
    }

    const rangeIn = (a, b) => {
      if (!a || !b) return null;
      const r = document.createRange();
      try {
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
      } catch { return null; }
      return r.collapsed && a.node !== b.node ? null : r;
    };

    // --------------------------------------------------------------- painting

    const peerHi = HL_SUPPORTED ? new Highlight() : null;
    if (peerHi) CSS.highlights.set('nib-peer', peerHi);

    // Find's matches, painted in the same borrowed way: the textarea can't
    // hold a highlight, but the coloured backdrop under it can, and it has the
    // same metrics. Two registries — every match, and the one you're on.
    const findHi = HL_SUPPORTED ? new Highlight() : null;
    const findOnHi = HL_SUPPORTED ? new Highlight() : null;
    if (findHi) {
      CSS.highlights.set('nib-find', findHi);
      CSS.highlights.set('nib-find-on', findOnHi);
    }

    function clearPaint() {
      if (peerHi) peerHi.clear();
      caretPeer.hidden = true;
      caretSource.hidden = true;
      for (const el of preview.querySelectorAll('.here')) el.classList.remove('here', 'lead');
      for (const el of edBack.querySelectorAll('.hit, .caret')) el.classList.remove('hit', 'caret');
    }

    // a caret has no width, so it can't be a highlight — measure the collapsed
    // range and float a 2px overlay at it, clipped to the pane it belongs to
    function drawCaret(bar, pos, pane) {
      if (!pos) { bar.hidden = true; return; }
      const r = document.createRange();
      try {
        r.setStart(pos.node, pos.offset);
        r.collapse(true);
      } catch { bar.hidden = true; return; }
      let rect = r.getBoundingClientRect();
      if (!rect.height) {                                  // empty line: use the box
        const host = pos.node.nodeType === 3 ? pos.node.parentElement : pos.node;
        rect = host.getBoundingClientRect();
      }
      const box = pane.getBoundingClientRect();
      if (!rect.height || rect.bottom < box.top || rect.top > box.bottom) { bar.hidden = true; return; }
      bar.hidden = false;
      bar.style.left = Math.round(rect.left) + 'px';
      bar.style.top = Math.round(Math.max(box.top, rect.top)) + 'px';
      bar.style.height = Math.round(Math.min(rect.height, box.bottom - rect.top)) + 'px';
    }

    // block tint, for context under a collapsed caret (and the whole show when
    // the Custom Highlight API isn't available)
    function tintPreview(fromLine, toLine) {
      const deepest = new Map();
      let lead = null;
      for (const b of model().blocks) {
        if (b.line >= fromLine && b.line <= toLine) deepest.set(b.line, b.el);
        if (b.line <= fromLine) lead = b.el;
      }
      for (const el of deepest.values()) el.classList.add('here');
      if (lead) lead.classList.add('here', 'lead');
      return lead;
    }

    function tintSource(fromLine, toLine) {
      const rows = edBack.children;
      if (fromLine < 0 || fromLine >= rows.length) return null;
      for (let i = fromLine; i <= toLine && i < rows.length; i++) rows[i].classList.add('hit');
      rows[fromLine].classList.add('caret');
      return rows[fromLine];
    }

    // ------------------------------------------------------ reveal (tabs etc)

    // A position inside a closed tab or a folded <details> can't be shown
    // without opening it. Cursor moves do open it — that's the point — but
    // scrolling must not, so `layoutHost` is the read-only alternative:
    // the nearest ancestor that actually has a box.
    function reveal(el) {
      let changed = false;
      for (let p = el && el.parentElement; p && p !== preview; p = p.parentElement) {
        if (p.tagName === 'DETAILS' && !p.open) { p.open = true; changed = true; }
        if (!p.classList.contains('tp')) continue;
        const group = p.parentElement;
        const k = [...group.querySelectorAll(':scope > .tp')].indexOf(p);
        const radio = group.querySelectorAll(':scope > input[type=radio]')[k];
        if (radio && !radio.checked) {
          radio.checked = true;
          changed = true;
          // setting .checked fires nothing, and View ▸ Link Tabs listens for
          // the change — so a tab opened by the cursor still takes its
          // same-titled twins with it
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return changed;
    }

    const hasBox = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

    function layoutHost(el) {
      let p = el;
      while (p && p !== preview && !hasBox(p)) p = p.parentElement;
      return p && p !== preview ? p : el;
    }

    // ----------------------------------------------------- editor -> preview

    function fromEditor({ scrollIntoView } = {}) {
      clearPaint();
      const a = ed.selectionStart, b = ed.selectionEnd;
      const from = srcToDom(a, a !== b);
      if (!from) return;
      if (reveal(from.block.el)) invalidate();          // opening a tab re-lays out

      if (a !== b) {
        // Both ends snap FORWARD out of a gap. The end matters as much as the
        // start: select just the word inside `*word*` and its end offset sits
        // on the closing star, which snapping backwards reads as "the letter
        // before" — one character short of the word every time.
        const r = rangeIn(srcToDom(a, true), srcToDom(b, true));
        if (peerHi && r) peerHi.add(r);
        else tintPreview(lineOf(a), lineOf(b));
      } else {
        tintPreview(lineOf(a), lineOf(a));
        drawCaret(caretPeer, from, previewPane);
      }
      if (scrollIntoView) showBlock(from.block);
    }

    function showBlock(b) {
      const el = layoutHost(b.el);
      const box = previewPane.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (!r.height) return;
      if (r.top >= box.top + 8 && r.bottom <= box.bottom - 8) return;
      previewPane.scrollTop += r.top - box.top - Math.min(140, previewPane.clientHeight / 3);
    }

    // ----------------------------------------------------- preview -> editor

    function fromPreview({ moveCaret } = {}) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !preview.contains(sel.anchorNode)) return;
      clearPaint();
      const r = sel.getRangeAt(0);
      const a = domToSrc(r.startContainer, r.startOffset);
      const b = r.collapsed ? a : domToSrc(r.endContainer, r.endOffset, true);
      if (a == null) return;

      if (!r.collapsed && b != null && b !== a) {
        const range = rangeIn(srcToRow(Math.min(a, b)), srcToRow(Math.max(a, b)));
        if (peerHi && range) peerHi.add(range);
        else tintSource(lineOf(a), lineOf(b));
      } else {
        tintSource(lineOf(a), lineOf(a));
        drawCaret(caretSource, srcToRow(a), ed);
      }
      // Mirror it into the textarea's real selection, so clicking into the
      // source picks up where the preview left off. NOT while the textarea
      // has focus: setting the selection of a focused textarea pulls the
      // document selection out of the preview, and the selection the user is
      // making with the mouse vanishes mid-drag. Guarded on "actually moved"
      // too, or the selectionchange it fires bounces straight back in here.
      if (moveCaret && document.activeElement !== ed) {
        const lo = Math.min(a, b == null ? a : b), hi = Math.max(a, b == null ? a : b);
        if (ed.selectionStart !== lo || ed.selectionEnd !== hi) ed.setSelectionRange(lo, hi);
      }
      showLine(lineOf(a));
      return { from: a, to: b };
    }

    function showLine(line) {
      const row = edBack.children[line];
      if (!row) return;
      const y = row.offsetTop - ed.scrollTop;
      if (y >= 30 && y <= ed.clientHeight - 60) return;
      ed.scrollTop = Math.max(0, row.offsetTop - ed.clientHeight / 3);
      edBack.scrollTop = ed.scrollTop;
    }

    // ------------------------------------------------------------ scroll sync

    const padTop = () => parseFloat(getComputedStyle(edBack).paddingTop) || 0;

    // which source line sits at the top of the source pane, and how far into
    // it — the rows start one padding-height down, so that comes off the top
    function editorAnchor() {
      const rows = edBack.children;
      if (!rows.length) return null;
      const y = ed.scrollTop + padTop();
      let lo = 0, hi = rows.length - 1, k = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].offsetTop <= y) { k = mid; lo = mid + 1; } else hi = mid - 1;
      }
      const row = rows[k];
      const h = row.offsetHeight || 1;
      return { line: k, frac: Math.max(0, Math.min(1, (y - row.offsetTop) / h)) };
    }

    function scrollPreviewTo(anchor) {
      if (!anchor) return;
      const b = blockForLine(anchor.line);
      if (!b) return;
      const el = layoutHost(b.el);
      const r = el.getBoundingClientRect();
      if (!r.height) return;
      const box = previewPane.getBoundingClientRect();
      const span = b.end - b.line + 1;
      // where in this block the anchor line falls (blocks can be many lines)
      const within = span > 1
        ? Math.min(1, (anchor.line - b.line + anchor.frac) / span) * r.height
        : anchor.frac * r.height;
      previewPane.scrollTop += (r.top - box.top) + within;
    }

    // the topmost laid-out block in the preview, and how far into it we are
    function previewAnchor() {
      const box = previewPane.getBoundingClientRect();
      const top = box.top + 1;
      let found = null;
      for (const b of model().blocks) {
        if (!hasBox(b.el)) continue;                     // inside a closed tab
        const r = b.el.getBoundingClientRect();
        if (!r.height) continue;
        if (r.bottom > top) { found = { b, r }; break; }
      }
      if (!found) return null;
      const { b, r } = found;
      const span = b.end - b.line + 1;
      const through = Math.max(0, Math.min(1, (top - r.top) / Math.max(1, r.height)));
      const pos = through * span;
      return { line: Math.min(b.end, b.line + Math.floor(pos)), frac: pos % 1 };
    }

    function scrollEditorTo(anchor) {
      if (!anchor) return;
      const row = edBack.children[anchor.line];
      if (!row) return;
      ed.scrollTop = Math.max(0, row.offsetTop + anchor.frac * (row.offsetHeight || 0) - padTop());
      edBack.scrollTop = ed.scrollTop;
    }

    return {
      invalidate,
      fromEditor,
      fromPreview,
      clearPaint,
      reveal,
      editorAnchor,
      previewAnchor,
      scrollPreviewTo,
      scrollEditorTo,
      srcToDom,
      domToSrc,
      // Where a source offset is on screen, in the coloured backdrop that
      // sits under the textarea — the only place the textarea's own caret
      // can be measured. The @-picker anchors itself with this.
      // Paint source ranges — [from, to] offsets — as find matches, with
      // `at` marked as the current one. The ranges live in the backdrop's DOM,
      // so every repaint of it invalidates them: call this again after one.
      paintFind(spans, at) {
        if (!findHi) return false;
        findHi.clear();
        findOnHi.clear();
        // One common letter in a long document matches thousands of times, and
        // every range costs a walk of its line. Paint a window around the one
        // you're on — the rest are counted, which is what the count is for.
        const MAX = 1200;
        let from = 0, to = spans.length;
        if (spans.length > MAX) {
          from = Math.max(0, Math.max(0, at) - (MAX >> 1));
          to = Math.min(spans.length, from + MAX);
        }
        for (let i = from; i < to; i++) {
          const reg = i === at ? findOnHi : findHi;
          const r = rangeIn(srcToRow(spans[i][0]), srcToRow(spans[i][1]));
          if (r) reg.add(r);
          // …and the same match where the PREVIEW shows it. The character
          // map is exact for prose — inside **bold** it lights just the
          // word — but a match that lives in the SYNTAX ("note" inside
          // `::: note`) maps to a smear of unrelated text, so a range only
          // counts when it covers the very text that matched.
          const pr = rangeIn(srcToDom(spans[i][0], true), srcToDom(spans[i][1], true));
          if (pr && !pr.collapsed
              && pr.toString() === ed.value.slice(spans[i][0], spans[i][1])) reg.add(pr);
        }
        return true;
      },
      clearFind() {
        if (!findHi) return;
        findHi.clear();
        findOnHi.clear();
      },
      // which line an offset is on, and where a line starts — Find scrolls the
      // source by row, the same way showLine does
      lineOf,
      rowTop(line) {
        const row = edBack.children[line];
        return row ? row.offsetTop : null;
      },
      caretRect(off) {
        const at = srcToRow(off);
        if (!at) return null;
        const r = document.createRange();
        r.setStart(at.node, at.offset);
        r.collapse(true);
        const box = r.getBoundingClientRect();
        if (box.height) return box;
        const row = edBack.children[lineOf(off)];
        return row ? row.getBoundingClientRect() : null;
      },
      supported: HL_SUPPORTED,
    };
  }

  window.createPeerSync = createPeerSync;
})();
