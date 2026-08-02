// Typing aids for the editable preview: Markdown input rules (type `code`
// and it becomes code; "## " and the line becomes a heading) plus a floating
// format bubble over any selection.
//
// Both work on the contenteditable DOM directly — no Markdown involved. The
// source is regenerated from that DOM afterwards (unmd.js), so anything that
// leaves the document in a shape md.js could have produced round-trips
// cleanly. Nothing here fires unless the preview is actually editable.

(() => {
  const BLOCKISH = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|TD|TH|SUMMARY|PRE)$/;

  const elt = (tag, txt) => {
    const el = document.createElement(tag);
    el.textContent = txt;
    return el;
  };

  // markers you type at the end of a word/phrase, and what they become
  const INLINE = [
    { ch: '`', re: /`([^`\n]+)`$/, make: (m) => elt('code', m[1]) },
    { ch: '*', re: /\*\*\*([^*\n]+)\*\*\*$/, make: (m) => {
      const s = document.createElement('strong');
      s.appendChild(elt('em', m[1]));
      return s;
    } },
    { ch: '*', re: /\*\*([^*\n]+)\*\*$/, make: (m) => elt('strong', m[1]) },
    { ch: '*', re: /\*([^*\n]+)\*$/, make: (m) => elt('em', m[1]) },
    { ch: '_', re: /__([^_\n]+)__$/, make: (m) => elt('strong', m[1]) },
    { ch: '~', re: /~~([^~\n]+)~~$/, make: (m) => elt('del', m[1]) },
    { ch: ')', re: /\[([^\]\n]*)\]\(([^)\s]+)\)$/, make: (m) => {
      const a = document.createElement('a');
      a.setAttribute('href', m[2]);
      a.textContent = m[1] || m[2];
      return a;
    } },
  ];

  // markers you type at the START of a block. execCommand('formatBlock') is
  // no good here — it loses the caret when the block is empty, which is the
  // common case (you type "## " on a fresh line) — so these rehouse the
  // block's children by hand instead.
  const BLOCK = [
    { re: /^(#{1,6})\s$/, run: (block, m, api) => api.reblock(block, 'h' + m[1].length) },
    { re: /^[-*+]\s$/, run: (block, m, api) => api.relist(block, 'ul') },
    { re: /^\d+[.)]\s$/, run: (block, m, api) => api.relist(block, 'ol') },
    { re: /^>\s$/, run: (block, m, api) => api.requote(block) },
  ];

  function setupLiveEditing({ preview, bubble, changed, mark, link, langPop, langPick }) {
    const editing = () => preview.isContentEditable;

    const caret = () => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      if (!r.collapsed || r.startContainer.nodeType !== 3) return null;
      if (!preview.contains(r.startContainer)) return null;
      return { node: r.startContainer, off: r.startOffset };
    };

    const place = (node, off) => {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, off);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    };

    const blockOf = (node) => {
      let el = node.nodeType === 3 ? node.parentNode : node;
      while (el && el !== preview && !BLOCKISH.test(el.tagName)) el = el.parentNode;
      return el === preview ? null : el;
    };

    // An element with no content needs a <br> or WebKit won't hold a caret
    // in it; one with content wants the caret in its first text node.
    const settle = (el) => {
      if (!el.textContent.length && !el.querySelector('br, img, input')) {
        el.textContent = '';
        el.appendChild(document.createElement('br'));
      }
      return el;
    };
    const caretInto = (el) => {
      const first = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      if (first) place(first, 0); else place(el, 0);
      return el;
    };
    const moveInto = (from, to) => {
      while (from.firstChild) to.appendChild(from.firstChild);
      return to;
    };

    const surgery = {
      reblock(block, tag) {
        const el = settle(moveInto(block, document.createElement(tag)));
        block.replaceWith(el);
        caretInto(el);
      },
      relist(block, tag) {
        const list = document.createElement(tag);
        const li = settle(moveInto(block, document.createElement('li')));
        list.appendChild(li);
        block.replaceWith(list);
        caretInto(li);
      },
      requote(block) {
        const quote = document.createElement('blockquote');
        const p = settle(moveInto(block, document.createElement('p')));
        quote.appendChild(p);
        block.replaceWith(quote);
        caretInto(p);
      },
    };

    // Is the caret in the very first text of its block? That's all a block
    // rule needs — what precedes the caret is the whole of the block's text
    // so far, so the marker regexes can anchor on it. It deliberately does
    // NOT require an empty line: typing "## " in front of a paragraph you
    // already wrote should turn that paragraph into a heading.
    const atBlockStart = (block, node) => {
      if (!block) return false;
      const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      return walk.nextNode() === node;
    };

    // ------------------------------------------------------------ input rules

    function rules(e) {
      if (!editing() || e.inputType !== 'insertText' || !e.data) return;
      const c = caret();
      if (!c) return;
      const { node, off } = c;
      if (blockOf(node) && blockOf(node).tagName === 'PRE') return;   // code is literal
      const before = node.nodeValue.slice(0, off);

      if (e.data === ' ') {
        const block = blockOf(node);
        if (block && atBlockStart(block, node)) {
          // "[ ] " right after a bullet turns the item into a task
          if (block.tagName === 'LI') {
            const t = before.match(/^\[([ xX]?)\]\s$/);
            if (t) {
              node.nodeValue = node.nodeValue.slice(off);
              for (const br of [...block.querySelectorAll(':scope > br')]) br.remove();
              const box = document.createElement('input');
              box.type = 'checkbox';
              box.checked = t[1] === 'x' || t[1] === 'X';
              block.classList.add('task');
              block.insertBefore(box, block.firstChild);
              block.insertBefore(document.createTextNode(' '), box.nextSibling);
              place(node, 0);
              changed();
              return;
            }
          } else if (block.tagName === 'P' || block.tagName === 'DIV') {
            for (const r of BLOCK) {
              const m = before.match(r.re);
              if (!m) continue;
              node.nodeValue = node.nodeValue.slice(off);
              r.run(block, m, surgery);
              changed();
              return;
            }
          }
        }
      }

      for (const r of INLINE) {
        if (r.ch !== e.data) continue;
        const m = before.match(r.re);
        if (!m) continue;
        // "a **bold**" types its closing pair one star at a time — after the
        // first, the single-star italic rule would happily match "*bold*".
        // A marker butted up against another of its kind isn't a marker yet.
        if (before[before.length - m[0].length - 1] === r.ch) continue;
        const range = document.createRange();
        range.setStart(node, off - m[0].length);
        range.setEnd(node, off);
        range.deleteContents();
        const el = r.make(m);
        range.insertNode(el);
        const tail = document.createTextNode('​');   // somewhere to land
        el.parentNode.insertBefore(tail, el.nextSibling);
        place(tail, 1);
        changed();
        return;
      }
    }

    // "---" on its own line, then Enter, becomes a rule
    // ⌘⏎ (Ctrl off-mac) — a page break at the caret. A paragraph splits
    // there, its tail moving below the break; any other block (a list, a
    // table, a callout — nothing a page can break inside of) gets the break
    // after it whole. The div matches md.js's exact shape, so unmd.js hands
    // back \newpage and restamp sees the same silhouette a re-render makes.
    function pageBreakAt() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return false;
      const r = sel.getRangeAt(0);
      if (!preview.contains(r.startContainer)) return false;
      let top = r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer;
      if (top === preview) top = top.childNodes[Math.min(r.startOffset, top.childNodes.length - 1)];
      while (top && top.parentNode !== preview) top = top.parentNode;
      if (!top || top.nodeType !== 1 || (top.classList && top.classList.contains('pgbrk'))) return false;

      const brk = document.createElement('div');
      brk.className = 'pgbrk';
      brk.dataset.kind = 'pagebreak';
      brk.dataset.text = '\\newpage';
      brk.setAttribute('contenteditable', 'false');
      brk.appendChild(elt('span', 'page break'));

      const p2 = document.createElement('p');
      if (top.tagName === 'P' && top.contains(r.startContainer)) {
        const tail = document.createRange();
        tail.setStart(r.startContainer, r.startOffset);
        tail.setEnd(top, top.childNodes.length);
        p2.appendChild(tail.extractContents());
        settle(top);
      }
      // A split at either end of the paragraph must not leave an empty half
      // behind — the empty <p> shows in the preview until the next re-render
      // (unmd drops it, so the Markdown never sees it, which is worse: the
      // two sides disagree). At the start the break lands before the intact
      // paragraph; at the end it lands after, and the caret moves to
      // whatever block already follows.
      const has = (el) => el.textContent.trim() || el.querySelector('img, input');
      let landing;
      if (top.tagName === 'P' && !has(top) && has(p2)) {           // caret at the very start
        settle(p2);
        top.replaceWith(brk, p2);
        landing = p2;
      } else if (!has(p2) && top.nextElementSibling && !top.nextElementSibling.classList.contains('pgbrk')) {
        top.after(brk);                                            // caret at the very end
        landing = brk.nextElementSibling;
      } else {
        settle(p2);
        top.after(brk, p2);
        landing = p2;
      }
      caretInto(landing);
      changed();
      return true;
    }

    // Deleting a page break. The div is contenteditable=false, so the caret
    // can never sit against it and WebKit's default delete merges the blocks
    // around it — so both routes are handled by hand, and only the break
    // goes: Backspace at the very start of the block after one, ⌦ at the
    // very end of the block before one, or either key while the break itself
    // is selected (clicking the strip selects it, see below).
    // the atomic block islands: contenteditable=false, deleted whole —
    // page breaks, mermaid diagrams, block math
    const ISLAND = '.pgbrk, .mm, .math.mblock';
    const isIsland = (el) => !!(el && el.nodeType === 1 && el.matches && el.matches(ISLAND));
    const topOf = (node) => {
      let el = node.nodeType === 3 ? node.parentNode : node;
      while (el && el !== preview && el.parentNode !== preview) el = el.parentNode;
      return el && el !== preview ? el : null;
    };
    function onDelete(e) {
      if (!editing() || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      if (!preview.contains(r.startContainer)) return;

      if (!sel.isCollapsed) {                        // the break selected as an object
        const one = r.startContainer === r.endContainer && r.endOffset - r.startOffset === 1
          ? r.startContainer.childNodes[r.startOffset] : null;
        if (isIsland(one)) {
          e.preventDefault();
          const next = one.nextElementSibling;
          one.remove();
          if (next) caretInto(next);
          changed();
        }
        return;
      }

      const top = topOf(r.startContainer);
      if (!top) return;
      const side = document.createRange();
      side.selectNodeContents(top);
      if (e.key === 'Backspace') side.setEnd(r.startContainer, r.startOffset);
      else side.setStart(r.startContainer, r.startOffset);
      if (side.toString().length || side.cloneContents().querySelector('img, input')) return;
      // Backspace at the very start of a heading takes the #s back one at a
      // time — H3 → H2 → H1 → plain paragraph — instead of WebKit's merge
      // into whatever came before.
      if (e.key === 'Backspace' && /^H[1-6]$/.test(top.tagName)) {
        e.preventDefault();
        const n = +top.tagName[1];
        surgery.reblock(top, n > 1 ? 'h' + (n - 1) : 'p');
        changed();
        return;
      }
      const brk = e.key === 'Backspace' ? top.previousElementSibling : top.nextElementSibling;
      if (!isIsland(brk)) return;
      e.preventDefault();                            // the blocks stay; the break goes
      brk.remove();
      changed();
    }

    // A click on the strip selects it whole — the caret can't sit in it, and
    // a selected break is one Backspace from gone.
    function onBreakClick(e) {
      if (!editing()) return;
      const brk = e.target && e.target.closest && e.target.closest(ISLAND);
      if (!brk || !preview.contains(brk)) return;
      e.preventDefault();                  // or the click collapses it to a caret
      preview.focus();
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNode(brk);
      sel.removeAllRanges();
      sel.addRange(r);
    }

    function onKey(e) {
      if (!editing() || e.key !== 'Enter') return;
      if (!e.shiftKey && (e.metaKey || e.ctrlKey)) {
        if (pageBreakAt()) e.preventDefault();
        return;
      }

      // Enter inside a code block is a newline, nothing more — WebKit's
      // default splits the <pre> in two, which round-trips as two fences.
      // At the block's end a lone trailing \n has no line box to hold the
      // caret, so the last newline is doubled and the caret sits between.
      const sel0 = window.getSelection();
      if (sel0 && sel0.rangeCount && preview.contains(sel0.getRangeAt(0).startContainer)) {
        const r0 = sel0.getRangeAt(0);
        const el0 = r0.startContainer.nodeType === 3 ? r0.startContainer.parentNode : r0.startContainer;
        const pre = el0 && el0.closest ? el0.closest('pre') : null;
        if (pre && preview.contains(pre) && !pre.classList.contains('fm')) {
          e.preventDefault();
          const code = pre.querySelector('code') || pre;
          r0.deleteContents();
          const rest = document.createRange();
          rest.selectNodeContents(code);
          rest.setStart(r0.startContainer, r0.startOffset);
          const nl = document.createTextNode(rest.toString().length ? '\n' : '\n\n');
          r0.insertNode(nl);
          place(nl, 1);
          for (const br of [...code.querySelectorAll('br')]) br.remove();
          changed();
          return;
        }
      }

      if (e.shiftKey) return;
      const c = caret();
      if (!c) return;
      const block = blockOf(c.node);
      if (!block || !/^(P|DIV)$/.test(block.tagName)) return;

      // ``` (or ```js) alone on the line, then Enter: a fenced code block.
      // The closing fence is unmd's to write — a PRE always serializes with
      // both — and mark() puts a hard undo boundary at the literal-backticks
      // state first, so ⌘Z gives the plain ``` back if that's what you meant.
      const fence = block.textContent.replace(/​/g, '').match(/^`{3}([\w+-]*)\s*$/);
      if (fence) {
        e.preventDefault();
        if (mark) mark();
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (fence[1]) code.className = 'lang-' + fence[1];
        code.appendChild(document.createElement('br'));
        pre.appendChild(code);
        block.replaceWith(pre);
        place(code, 0);
        changed();
        return;
      }

      if (!/^ {0,3}([-*_])( *\1){2,} *$/.test(block.textContent)) return;
      e.preventDefault();
      const hr = document.createElement('hr');
      const p = document.createElement('p');
      p.appendChild(document.createElement('br'));
      block.replaceWith(hr);
      hr.parentNode.insertBefore(p, hr.nextSibling);
      place(p, 0);
      changed();
    }

    // → at the very end of an inline <code> that closes out its block: WebKit
    // has no caret position after it, so typing there keeps extending the
    // code. Give it the same U+200B perch the input rules leave (unmd strips
    // it) and step onto it, and typing carries on in plain text.
    function onArrowOut(e) {
      if (!editing() || e.key !== 'ArrowRight'
          || e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
      const r = sel.getRangeAt(0);
      if (!preview.contains(r.startContainer)) return;
      let code = r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer;
      code = code && code.closest ? code.closest('code') : null;
      if (!code || !preview.contains(code) || code.closest('pre')) return;
      const rest = document.createRange();
      rest.selectNodeContents(code);
      rest.setStart(r.startContainer, r.startOffset);
      if (rest.toString().length) return;            // not at the code's end yet
      const after = code.nextSibling;                 // real text after it? the
      if (after && after.nodeType === 3              // arrow already works
          && after.nodeValue.replace(/​/g, '').length) return;
      e.preventDefault();
      let perch = after && after.nodeType === 3 ? after : null;
      if (!perch) {
        perch = document.createTextNode('​');
        code.after(perch);
      } else if (!perch.nodeValue) {
        perch.nodeValue = '​';
      }
      place(perch, perch.nodeValue.length);
    }

    // ⌄ inside the document's LAST code block: once the arrow has nowhere
    // left to go (the caret didn't move), a fresh paragraph appears after the
    // block and the caret lands in it. Default is never prevented — moving
    // within the block, and the hop onto its last line, still belong to WebKit.
    function onDownOut(e) {
      if (!editing() || e.key !== 'ArrowDown'
          || e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
      const r = sel.getRangeAt(0);
      const el = r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer;
      const pre = el && el.closest ? el.closest('pre') : null;
      if (!pre || !preview.contains(pre) || pre.nextElementSibling) return;
      const was = { node: r.startContainer, off: r.startOffset };
      setTimeout(() => {
        const s2 = window.getSelection();
        if (!s2 || !s2.rangeCount) return;
        const r2 = s2.getRangeAt(0);
        if (r2.startContainer !== was.node || r2.startOffset !== was.off) return;
        const p = document.createElement('p');
        p.appendChild(document.createElement('br'));
        pre.after(p);
        place(p, 0);
        changed();
      }, 0);
    }

    // --------------------------------------------------- code blocks, live
    //
    // Highlighting is render-time work (md.js runs code.js over the fence),
    // so a block being typed in drifts to plain text. The caret LEAVING the
    // block is the safe moment to redo it — no selection inside, nothing
    // measured. The same watcher hangs the language picker off whichever
    // block the caret is in.
    let inPre = null;
    const langOf = (pre) => {
      const code = pre.querySelector('code');
      return (code && (code.className.match(/lang-([\w+-]+)/) || [])[1]) || '';
    };
    function rehighlight(pre) {
      const code = pre.querySelector('code');
      const lang = langOf(pre);
      if (!code || !lang || !window.highlightCode) return;
      const src = code.textContent;
      if (!src.trim()) return;
      code.innerHTML = window.highlightCode(src, lang);
    }
    function placeLangPop(pre) {
      if (!langPop) return;
      if (!pre) { langPop.hidden = true; return; }
      const lang = langOf(pre);
      const known = [...langPick.options].some((o) => o.value === lang);
      langPick.value = known ? lang : '';
      langPop.hidden = false;
      const rect = pre.getBoundingClientRect();
      langPop.style.left = Math.round(rect.right - langPop.offsetWidth - 8) + 'px';
      langPop.style.top = Math.round(rect.top + 6) + 'px';
    }
    function watchPre() {
      if (langPop && document.activeElement === langPick) return;   // mid-pick
      const sel = window.getSelection();
      let pre = null;
      if (editing() && sel && sel.rangeCount) {
        const n = sel.getRangeAt(0).startContainer;
        if (preview.contains(n)) {
          const el = n.nodeType === 3 ? n.parentNode : n;
          pre = el && el.closest ? el.closest('pre') : null;
          if (pre && (pre.classList.contains('fm') || !preview.contains(pre))) pre = null;
        }
      }
      if (inPre && inPre !== pre && inPre.isConnected) rehighlight(inPre);
      inPre = pre;
      placeLangPop(pre);
    }
    if (langPick) {
      langPick.addEventListener('change', () => {
        const pre = inPre;
        if (!pre || !pre.isConnected) return;
        const code = pre.querySelector('code');
        if (!code) return;
        code.className = langPick.value ? 'lang-' + langPick.value : '';
        rehighlight(pre);
        preview.focus({ preventScroll: true });
        const walk = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let t = null, next;
        while ((next = walk.nextNode())) t = next;
        if (t) place(t, t.nodeValue.length); else place(code, 0);
        changed();
      });
    }

    preview.addEventListener('input', rules);
    preview.addEventListener('keydown', onKey);
    preview.addEventListener('keydown', onArrowOut);
    preview.addEventListener('keydown', onDownOut);
    document.addEventListener('selectionchange', watchPre);
    preview.addEventListener('keydown', onDelete);
    preview.addEventListener('mousedown', onBreakClick);

    // ---------------------------------------------------------------- bubble

    const hide = () => { bubble.hidden = true; };

    function position() {
      const sel = window.getSelection();
      if (!editing() || !sel || !sel.rangeCount || sel.isCollapsed
          || !preview.contains(sel.anchorNode)) return hide();
      if (!String(sel).trim()) return hide();      // a picked image, not text
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (!r.width && !r.height) return hide();
      bubble.hidden = false;
      const w = bubble.offsetWidth, h = bubble.offsetHeight;
      const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
      const above = r.top - h - 8;
      bubble.style.left = Math.round(x) + 'px';
      bubble.style.top = Math.round(above > 6 ? above : r.bottom + 8) + 'px';
    }

    document.addEventListener('selectionchange', position);
    window.addEventListener('resize', position);
    preview.addEventListener('blur', () => setTimeout(() => {
      if (!bubble.contains(document.activeElement)) hide();
    }, 120));
    for (const pane of document.querySelectorAll('#previewPane')) {
      pane.addEventListener('scroll', () => {
        if (!bubble.hidden) position();
        if (inPre) placeLangPop(inPre);
      });
    }

    // mousedown would drop the selection before the click lands
    bubble.addEventListener('mousedown', (e) => e.preventDefault());
    bubble.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const cmd = b.dataset.cmd;
      preview.focus();
      if (cmd === 'link') { link(); hide(); return; }
      if (cmd === 'code') {
        const sel = String(window.getSelection() || '') || 'code';
        document.execCommand('insertHTML', false, '<code>'
          + sel.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))
          + '</code>');
      } else if (/^(h[1-6]|p|blockquote)$/.test(cmd)) {
        document.execCommand('formatBlock', false, cmd);
      } else if (cmd === 'ul') {
        document.execCommand('insertUnorderedList');
      } else {
        document.execCommand(cmd);                    // bold | italic | strikeThrough
      }
      changed();
      position();
    });

    return { hideBubble: hide, positionBubble: position };
  }

  window.setupLiveEditing = setupLiveEditing;
})();
