// The sheet a model has to get past, and the edit it makes when you say yes.
//
// This lives in DOCUMENT windows, not in Settings, because that is where the
// question is asked and where the answer lands: a write shows a diff of the
// file you are looking at, and `edit_document` goes through the editor's own
// applyText so ⌘Z takes it back. The settings half — providers, keys, limits
// — is aipanel.js, in the Settings window.

(() => {
  const $ = (id) => document.getElementById(id);

  function setupAiAsk({ toast, applyText }) {
    // ------------------------------------------------------- the ask sheet

    const askShade = $('aiAskShade');
    let asking = null;

    function ask(req) {
      asking = req;
      $('aiAskTitle').textContent = req.title || 'Allow this?';
      $('aiAskWhy').textContent = req.why || '';
      $('aiAskDetail').textContent = req.detail || '';
      // A write is the one that needs showing rather than describing.
      const diff = req.before !== undefined && req.after !== undefined
        ? summarise(req.before, req.after) : null;
      $('aiAskDiff').hidden = !diff;
      if (diff) {
        const body = $('aiAskDiffBody');
        body.textContent = '';
        body.appendChild(diff);
      }
      // "Allow" is not the safe answer, so it is not the focused one — the
      // habit this sheet must not build is return-to-continue.
      askShade.hidden = false;
      $('aiAskNo').focus();
    }

    function answer(ok) {
      const a = asking;
      asking = null;
      askShade.hidden = true;
      if (a) tiny.api.call('aiApprove', { askId: a.askId, ok });
    }
    $('aiAskNo').onclick = () => answer(false);
    $('aiAskYes').onclick = () => answer(true);
    tiny.api.on('ai-approve', ask);

    // Enough of a diff to decide by: the first lines that differ, from each
    // end in, so a one-line change in a long file reads as a one-line change.
    function summarise(before, after) {
      const a = String(before).split('\n');
      const b = String(after).split('\n');
      let head = 0;
      while (head < a.length && head < b.length && a[head] === b[head]) head++;
      let tail = 0;
      while (tail < a.length - head && tail < b.length - head
        && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
      const gone = a.slice(head, a.length - tail);
      const came = b.slice(head, b.length - tail);

      const out = document.createDocumentFragment();
      const line = (text, cls) => {
        const el = document.createElement('span');
        el.className = cls;
        el.textContent = text + '\n';
        out.appendChild(el);
      };
      if (!gone.length && !came.length) {
        line('nothing would change', 'dsame');
        return out;
      }
      line('at line ' + (head + 1), 'dsame');
      // Capped, and the cap SAYS SO — a preview that quietly shows the first
      // forty lines of a two-hundred-line replacement is worse than no preview,
      // because you would approve it believing you had read it.
      const show = (lines, mark, cls) => {
        for (const l of lines.slice(0, 40)) line(mark + ' ' + l, cls);
        if (lines.length > 40) line(mark + ' …and ' + (lines.length - 40) + ' more lines', 'dsame');
      };
      show(gone, '−', 'dgone');
      show(came, '+', 'dcame');
      return out;
    }

    // A model rewriting the open document goes through the editor's own
    // applyText — which records an undo step. That is the whole reason it
    // takes this route instead of being written to disk behind the page.
    tiny.api.on('ai-apply', ({ text }) => {
      applyText(String(text ?? ''));
      toast('The document was rewritten — ⌘Z takes it back');
    });

    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !askShade.hidden) answer(false);
    }, true);

    return { close: () => answer(false) };
  }

  window.setupAiAsk = setupAiAsk;
})();
