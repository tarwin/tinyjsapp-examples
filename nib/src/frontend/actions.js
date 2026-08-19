// The page's half of Actions: the ⚡ list, the approval sheet, the output
// drawer, and what happens to what a command printed.
//
// The backend owns everything that decides — which actions exist, whether one
// may run, what its command really is once the variables are in. This file
// never reads the actions file and never spawns anything; it collects the
// context the backend can't know (which document, what's selected, where the
// caret is), draws the answer, and applies the output. The approval prompt
// lives here only because dialogs are page-side — the *decision* is checked
// again in the backend, so a page could not talk itself into trust.

(() => {
  function setupActions({
    button, menu, panel, grip, out, head, title, meta, dot, stop, clear, close,
    shade, sheet, pins, bubble, bubbleActs, bubbleActsMenu, onSelActs,
    // what only the document knows
    context, applyText, insertText, toast, onBusy, onManage,
  }) {
    let list = [];                 // the last actionsList answer
    let menuAt = null;             // where the ⚡ menu last opened, for redraws
    let run = null;                // the run in flight: { runId, label, mode }
    let pending = null;            // a trust prompt waiting on an answer
    let tail = true;               // is the drawer scrolled to the bottom?

    // ------------------------------------------------------------- the menu

    const hideMenu = () => { menu.hidden = true; menu.textContent = ''; };
    addEventListener('mousedown', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== button) hideMenu();
    });
    addEventListener('blur', hideMenu);

    // Going to pick an action must not be the click that takes the selection
    // away — the selection is half the context the action runs with, and it
    // should stay on the text (visibly) while you choose. Preventing the
    // mousedown keeps focus, and the highlight, in the editor; the click on
    // the ⚡, a pin, or a menu row still lands. Same trick the bubble ⚡ uses.
    for (const el of [button, menu, pins]) {
      if (el) el.addEventListener('mousedown', (e) => e.preventDefault());
    }

    async function refresh() {
      const r = await tiny.api.call('actionsList', { ctx: context() });
      list = (r && r.list) || [];
      // The ⚡ only appears once there is something behind it — an empty menu
      // is a worse answer than no button. Actions ▸ Edit… is always in the
      // menu bar, which is where you go to make the first one.
      button.hidden = !list.length;
      drawPins();
      syncSelActs();
      return r;
    }

    // --------------------------------------------------------- toolbar pins
    //
    // An action that says `"toolbar": true` gets a button beside the ⚡. It is
    // the same action, run the same way — this is a shortcut, not a second
    // kind of thing — and an unavailable one is DISABLED rather than dropped,
    // so the toolbar doesn't reshuffle itself every time you change tabs.
    function drawPins() {
      if (!pins) return;
      pins.textContent = '';
      for (const a of list.filter((x) => x.toolbar)) {
        const b = document.createElement('button');
        b.className = 'actpin';
        const ico = window.nibActIcon(a);
        if (ico) b.appendChild(ico);
        else b.textContent = a.label.slice(0, 2);
        b.title = a.label + (a.description ? ' — ' + a.description : '')
          + (a.why ? ' (' + a.why + ')' : '');
        b.disabled = !!a.why;
        b.onclick = () => start(a);
        pins.appendChild(b);
      }
    }

    // --------------------------------------------- actions on the selection
    //
    // Actions marked `"selection": true`, offered on what you have highlighted
    // in the editable preview. They used to be their own bar floating over the
    // selection, but the format bubble floats in exactly the same place and
    // the two overlapped — so they are now a ⚡ at the end of the bubble that
    // drops a menu. live.js owns the bubble; this owns only the ⚡ and menu.
    function selectionActions() {
      return list.filter((a) => a.selection && !a.why);
    }

    const hideSelMenu = () => {
      if (bubbleActsMenu) { bubbleActsMenu.hidden = true; bubbleActsMenu.textContent = ''; }
    };

    // The ⚡ (and its separator) only earn their slot in the bubble when an
    // action is behind them; the bubble re-measures itself when told.
    function syncSelActs() {
      if (!bubbleActs) return;
      const want = selectionActions().length > 0;
      if (bubbleActs.hidden === !want) return;
      bubbleActs.hidden = !want;
      hideSelMenu();
      if (onSelActs) onSelActs();
    }

    function openSelMenu() {
      const rows = selectionActions();
      if (!rows.length) return hideSelMenu();
      bubbleActsMenu.textContent = '';
      for (const a of rows) {
        const b = withIcon(document.createElement('button'), a, a.label);
        if (a.description) b.title = a.description;
        // mousedown, not click: a click would have cleared the selection the
        // action is about before the handler ever ran
        b.onmousedown = (e) => { e.preventDefault(); hideSelMenu(); start(a); };
        bubbleActsMenu.appendChild(b);
      }
      bubbleActsMenu.hidden = false;
      // right-aligned under the ⚡; above the bubble when it would land on the
      // selected text (the bubble usually sits just over the selection)
      const r = bubbleActs.getBoundingClientRect();
      const w = bubbleActsMenu.offsetWidth, h = bubbleActsMenu.offsetHeight;
      bubbleActsMenu.style.left = Math.round(Math.min(Math.max(8, r.right - w),
        innerWidth - w - 8)) + 'px';
      const above = r.top - h - 6;
      bubbleActsMenu.style.top = Math.round(above > 6 ? above : r.bottom + 6) + 'px';
    }

    if (bubbleActs) {
      // preventDefault keeps the selection; live.js's click handler skips any
      // bubble button without a data-cmd, so this one never reaches execCommand
      bubbleActs.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (bubbleActsMenu.hidden) openSelMenu(); else hideSelMenu();
      });
      // the menu dies with the selection, the bubble, or a click elsewhere
      document.addEventListener('selectionchange', () => {
        const s = getSelection();
        if (!s || s.isCollapsed || (bubble && bubble.hidden)) hideSelMenu();
      });
      addEventListener('scroll', hideSelMenu, true);
      addEventListener('mousedown', (e) => {
        if (!bubbleActsMenu.hidden && !bubbleActsMenu.contains(e.target)
            && !bubbleActs.contains(e.target)) hideSelMenu();
      });
      addEventListener('blur', hideSelMenu);
    }

    // "needs a selection" is the backend's verdict, given with the ctx of
    // whenever the list was last fetched — and the toolbar pins are drawn
    // from that answer. Without this, a pin sat greyed over a perfectly good
    // selection until something else (opening the menu, a run) happened to
    // refresh the list. Re-ask the moment a selection appears or goes away:
    // availability() only looks at presence, so a drag growing the selection
    // settles to a single refresh rather than churning per tick.
    let hadSel = null, selTick = null;
    document.addEventListener('selectionchange', () => {
      clearTimeout(selTick);
      selTick = setTimeout(() => {
        const has = !!context().sel;
        if (has === hadSel) return;
        hadSel = has;
        refresh();
      }, 200);
    });

    // An emoji carries almost no side bearing, so "🚀Deploy" is what a plain
    // space gets you. Every place an icon sits next to a name uses this —
    // handed the whole action (or anything with {icon, iconSvg}), so an
    // Iconify pick draws as its SVG and an emoji as itself.
    function withIcon(el, src, label) {
      const node = window.nibActIcon(src);
      if (node) {
        const ico = document.createElement('span');
        ico.className = 'askico';
        ico.appendChild(node);
        el.appendChild(ico);
      }
      el.appendChild(document.createTextNode(label));
      return el;
    }

    function rowFor(a) {
      const el = document.createElement('div');
      el.className = 'citem' + (a.why ? ' off' : '');
      // The icon is a glyph in a fixed-width slot, so a menu of six actions
      // where two have icons still reads as a column rather than a ransom note.
      const ico = document.createElement('span');
      ico.className = 'cico';
      const node = window.nibActIcon(a);
      if (node) ico.appendChild(node);
      el.appendChild(ico);
      const name = document.createElement('span');
      name.className = 'cname';
      name.textContent = a.label + (a.asks ? '…' : '');
      el.appendChild(name);
      // A description is the answer to "what does this one do?", which is the
      // question a folder full of somebody else's buttons always raises. It is
      // the row's tooltip, and the sheet renders it properly.
      if (a.description) el.title = a.description;
      // A folder's action says so, every time it is offered — provenance is
      // the whole difference between the two files.
      if (a.scope === 'project') {
        const tag = document.createElement('span');
        tag.className = 'ctag';
        tag.textContent = a.trust === 'trusted' ? 'folder'
          : a.trust === 'changed' ? 'folder · changed' : 'folder · approve';
        el.appendChild(tag);
      }
      // its shortcut, if you bound one (Settings ▸ Shortcuts) — same column
      // the native menu and the palette show it in
      if (a.key && window.nibKey) {
        const kb = document.createElement('span');
        kb.className = 'ckey';
        kb.textContent = window.nibKey(a.key);
        el.appendChild(kb);
      }
      if (a.why) {
        const why = document.createElement('span');
        why.className = 'cwhy';
        why.textContent = a.why;
        el.appendChild(why);
      } else {
        el.onclick = () => { hideMenu(); start(a); };
      }
      return el;
    }

    async function openMenu(x, y) {
      menuAt = { x, y };
      const r = await refresh();
      menu.textContent = '';
      const mine = list.filter((a) => a.scope === 'global');
      const theirs = list.filter((a) => a.scope === 'project');
      const section = (label, rows) => {
        if (!rows.length) return;
        if (menu.children.length) {
          const sep = document.createElement('div');
          sep.className = 'csep';
          menu.appendChild(sep);
        }
        const h = document.createElement('div');
        h.className = 'chead';
        h.textContent = label;
        menu.appendChild(h);
        for (const a of rows) menu.appendChild(rowFor(a));
      };
      section('Actions', mine);
      section(r && r.root ? nameOf(r.root) : 'This Folder', theirs);
      for (const p of (r && r.problems) || []) {
        const el = document.createElement('div');
        el.className = 'cwarn';
        el.textContent = '⚠ ' + p;
        menu.appendChild(el);
      }
      const sep = document.createElement('div');
      sep.className = 'csep';
      menu.appendChild(sep);
      // One way in for everything: the editor sheet knows which files exist
      // and offers only those, so there is no greyed row here saying that a
      // folder you haven't opened has no actions.
      const edit = (label) => {
        const el = document.createElement('div');
        el.className = 'citem';
        const name = document.createElement('span');
        name.className = 'cname';
        name.textContent = label;
        el.appendChild(name);
        el.onclick = () => { hideMenu(); if (onManage) onManage(); };
        menu.appendChild(el);
      };
      edit('Manage Actions…');

      menu.hidden = false;
      menu.style.left = '0px';
      menu.style.top = '0px';
      const w = menu.offsetWidth, h = menu.offsetHeight;
      menu.style.left = Math.round(Math.min(Math.max(8, x - w / 2), innerWidth - w - 8)) + 'px';
      menu.style.top = Math.round(Math.min(y, innerHeight - h - 8)) + 'px';
    }

    const nameOf = (p) => p.split('/').filter(Boolean).pop() || p;

    button.onclick = () => {
      if (!menu.hidden) return hideMenu();
      const r = button.getBoundingClientRect();
      openMenu(r.left + r.width / 2, r.bottom + 6);
    };

    // ------------------------------------------------------------ the sheet

    function askTrust(need, a, opts) {
      pending = { need, a, opts: opts || {} };
      title_(need);
      shade.hidden = false;
      document.getElementById('trustAlways').focus();
    }

    function title_(need) {
      const changed = need.state === 'changed';
      document.getElementById('trustTitle').textContent =
        (changed ? 'This action has changed: ' : 'Run ') + '“' + need.label + '”?';
      document.getElementById('trustWhy').textContent = changed
        ? 'You approved it before, but its command has been edited since. '
          + 'Read it again before letting it run.'
        : 'This action came with the folder, not from your own actions file. '
          + 'It runs on your machine, with your permissions.';
      document.getElementById('trustKind').textContent = need.kind;
      document.getElementById('trustCmd').textContent = need.body;
      document.getElementById('trustCwd').textContent = need.cwd;
    }

    const hideSheet = () => { shade.hidden = true; pending = null; };
    document.getElementById('trustCancel').onclick = hideSheet;
    document.getElementById('trustOnce').onclick = () => answer('once');
    document.getElementById('trustAlways').onclick = () => answer('always');
    function answer(how) {
      const p = pending;
      hideSheet();
      if (p) start(p.a, { ...p.opts, trust: how });
    }

    // ------------------------------------------------------- the ask sheet
    //
    // The little form an action can put in front of itself. Built from what
    // the action declared, so there is no fixed set of fields — and it
    // remembers what you last typed per action, because the second run of
    // "Deploy to {environment}" is nearly always the same answer as the first.

    const askShade = document.getElementById('askShade');
    let askPending = null;

    const lastAnswers = (id) => {
      try { return JSON.parse(localStorage.getItem('nib.ask.' + id) || '{}'); }
      catch { return {}; }
    };

    function askInput(need, a, opts) {
      askPending = { need, a, opts: opts || {} };
      const was = lastAnswers(a.scope + ':' + a.id);
      // an element rather than two spaces, because CSS collapses whitespace
      // and the icon would end up welded to the name
      const t = document.getElementById('askTitle');
      t.textContent = '';
      withIcon(t, need, need.label);
      const box = document.getElementById('askFields');
      box.textContent = '';
      for (const f of need.ask) {
        const wrap = document.createElement('label');
        wrap.className = 'afield';
        const lab = document.createElement('span');
        lab.textContent = f.label;
        wrap.appendChild(lab);

        let input;
        if (f.type === 'choice') {
          input = document.createElement('select');
          for (const c of f.choices || []) {
            const o = document.createElement('option');
            o.value = c;
            o.textContent = c;
            input.appendChild(o);
          }
        } else if (f.type === 'multiline') {
          input = document.createElement('textarea');
          input.rows = 4;
        } else if (f.type === 'check') {
          input = document.createElement('input');
          input.type = 'checkbox';
        } else if (f.type === 'file' || f.type === 'folder') {
          // A path field with a picker beside it — typing one is allowed, but
          // nobody should have to.
          input = document.createElement('input');
          input.type = 'text';
          const pick = document.createElement('button');
          pick.className = 'apick';
          pick.textContent = 'Choose…';
          pick.onclick = async (e) => {
            e.preventDefault();
            const p = f.type === 'folder'
              ? await tiny.dialog.pickFolder()
              : await tiny.dialog.openFile();
            if (p) input.value = Array.isArray(p) ? p[0] : p;
          };
          wrap.appendChild(input);
          wrap.appendChild(pick);
          wrap.classList.add('awithpick');
        } else {
          input = document.createElement('input');
          input.type = f.type === 'number' ? 'number' : 'text';
        }
        input.dataset.name = f.name;
        input.dataset.required = f.required ? '1' : '';
        input.spellcheck = false;
        if (f.placeholder) input.placeholder = f.placeholder;
        const start = was[f.name] !== undefined ? was[f.name] : f.value;
        if (f.type === 'check') input.checked = start === 'true' || start === true;
        else if (start !== '') input.value = start;
        if (!wrap.contains(input)) wrap.appendChild(input);
        box.appendChild(wrap);

        if (f.hint) {
          const h = document.createElement('div');
          h.className = 'ahint';
          h.textContent = f.hint;
          box.appendChild(h);
        }
      }
      askShade.hidden = false;
      const first = box.querySelector('input, select, textarea');
      if (first) first.focus();
    }

    const hideAsk = () => { askShade.hidden = true; askPending = null; };
    document.getElementById('askCancel').onclick = () => {
      if (promptLive) return answerPrompt(null);
      hideAsk();
    };
    document.getElementById('askGo').onclick = () => {
      if (promptLive) {
        const el = document.getElementById('askFields').querySelector('[data-live]');
        return answerPrompt(el ? el.value : '');
      }
      const p = askPending;
      if (!p) return;
      const inputs = {};
      for (const el of document.getElementById('askFields')
        .querySelectorAll('[data-name]')) {
        const v = el.type === 'checkbox' ? String(el.checked) : el.value;
        if (el.dataset.required && !String(v).trim()) {
          el.focus();
          return toast('“' + el.previousSibling.textContent + '” is needed');
        }
        inputs[el.dataset.name] = v;
      }
      hideAsk();
      try { localStorage.setItem('nib.ask.' + p.a.scope + ':' + p.a.id, JSON.stringify(inputs)); }
      catch { /* a full quota is not worth failing a run over */ }
      start(p.a, { ...p.opts, inputs });
    };
    askShade.addEventListener('keydown', (e) => {
      // ⌘⏎ from a textarea, ⏎ from anywhere else
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.target.tagName !== 'TEXTAREA')) {
        e.preventDefault();
        document.getElementById('askGo').click();
      }
    });

    // ------------------------------------------------------ the alert sheet

    const alertShade = document.getElementById('alertShade');
    function showAlert(src, title, body) {
      const t = document.getElementById('alertTitle');
      t.textContent = '';
      withIcon(t, src, title);
      document.getElementById('alertBody').textContent = body;
      alertShade.hidden = false;
      document.getElementById('alertOk').focus();
    }
    document.getElementById('alertOk').onclick = () => {
      alertShade.hidden = true;
      // a ctx.alert is waiting on this OK — let the script carry on
      if (alertLive) { tiny.api.call('actionAnswer', { askId: alertLive, value: true }); alertLive = null; }
    };
    document.getElementById('alertCopy').onclick = () => {
      tiny.clipboard.writeText(document.getElementById('alertBody').textContent);
      toast('Copied');
    };

    // -------------------------------------- mid-run prompt() / confirm() / alert()
    //
    // A js action can stop and talk (ctx.prompt / ctx.confirm / ctx.alert —
    // actions.js jsApi in the backend). The prompt borrows the ask sheet with
    // a single field, the alert is the box output:"alert" already uses, the
    // confirm is the app's own dialog. The script is parked on a promise in
    // the backend until actionAnswer goes back; the backend's patience turns
    // a sheet nobody answers into a cancel, so nothing hangs forever.
    let promptLive = null;               // the askId while a ctx.prompt is up
    let alertLive = null;                // …and while a ctx.alert is up

    const answerPrompt = (value) => {
      const askId = promptLive;
      promptLive = null;
      askShade.hidden = true;
      document.getElementById('askGo').textContent = 'Run';   // the sheet's day job
      tiny.api.call('actionAnswer', { askId, value });
    };

    tiny.api.on('action-prompt', (p) => {
      if (promptLive) answerPrompt(null);            // a newer ask wins
      promptLive = p.askId;
      const t = document.getElementById('askTitle');
      t.textContent = '';
      withIcon(t, (run && run.a) || {}, (run && run.label) || 'Action');
      const box = document.getElementById('askFields');
      box.textContent = '';
      const wrap = document.createElement('label');
      wrap.className = 'afield';
      const lab = document.createElement('span');
      lab.textContent = p.label || 'Value';
      wrap.appendChild(lab);
      let input;
      if (p.type === 'choice') {
        input = document.createElement('select');
        for (const c of p.choices || []) {
          const o = document.createElement('option');
          o.value = c;
          o.textContent = c;
          input.appendChild(o);
        }
      } else if (p.type === 'multiline') {
        input = document.createElement('textarea');
        input.rows = 5;
      } else {
        input = document.createElement('input');
        input.type = p.type === 'number' ? 'number' : 'text';
      }
      input.dataset.live = '1';
      input.spellcheck = false;
      if (p.placeholder) input.placeholder = p.placeholder;
      if (p.value) input.value = p.value;
      wrap.appendChild(input);
      box.appendChild(wrap);
      // mid-run, the button answers rather than launches
      document.getElementById('askGo').textContent = 'OK';
      askShade.hidden = false;
      input.focus();
      if (input.select) input.select();
    });

    tiny.api.on('action-alert', (p) => {
      alertLive = p.askId;
      showAlert((run && run.a) || {}, p.title || (run && run.label) || 'Action', p.body || '');
    });

    // ctx.pickFile / ctx.pickFolder — the system dialog is the whole sheet
    tiny.api.on('action-pick', async (p) => {
      const r = p.kind === 'folder' ? await tiny.dialog.pickFolder() : await tiny.dialog.openFile();
      const path = Array.isArray(r) ? r[0] : r;
      tiny.api.call('actionAnswer', { askId: p.askId, value: path || null });
    });

    tiny.api.on('action-confirm', async (p) => {
      const ok = await tiny.dialog.confirm(p.question || 'Continue?', {
        detail: p.detail || '', ok: p.ok || 'OK', cancel: p.cancel || 'Cancel',
      });
      tiny.api.call('actionAnswer', { askId: p.askId, value: !!ok });
    });

    // ------------------------------------------------------------ the drawer

    function showPanel(on) {
      panel.hidden = !on;
      grip.hidden = !on;
      document.body.toggleAttribute('data-run', !!on);
    }
    close.onclick = () => showPanel(false);
    clear.onclick = () => { out.textContent = ''; };
    stop.onclick = () => { if (run) tiny.api.call('actionCancel', { runId: run.runId }); };

    out.addEventListener('scroll', () => {
      tail = out.scrollHeight - out.scrollTop - out.clientHeight < 24;
    });

    // Three streams now, not two. 'meta' is what an AI run says about itself —
    // which tool it reached for, which model answered, what it cost — and it
    // is dimmed rather than mixed in, because the run's OUTPUT is the thing
    // you came to read and a transcript of it thinking is not.
    function write(text, stream) {
      const node = document.createElement(stream === 'err' ? 'b' : 'span');
      if (stream === 'meta') node.className = 'rmeta';
      node.textContent = text;
      out.appendChild(node);
      if (tail) out.scrollTop = out.scrollHeight;
    }

    // The drawer's height, dragged and remembered — the same grip idea as the
    // sidebars, in the other axis.
    let dragFrom = null;
    grip.addEventListener('mousedown', (e) => {
      dragFrom = { y: e.clientY, h: panel.offsetHeight };
      e.preventDefault();
    });
    addEventListener('mousemove', (e) => {
      if (!dragFrom) return;
      const h = Math.min(Math.max(80, dragFrom.h + (dragFrom.y - e.clientY)), innerHeight - 160);
      document.body.style.setProperty('--runh', Math.round(h) + 'px');
    });
    addEventListener('mouseup', () => {
      if (!dragFrom) return;
      dragFrom = null;
      localStorage.setItem('nib.runh', document.body.style.getPropertyValue('--runh'));
    });
    const savedH = localStorage.getItem('nib.runh');
    if (savedH) document.body.style.setProperty('--runh', savedH);

    // ------------------------------------------------------------- running

    async function start(a, opts = {}) {
      if (run) return toast('An action is still running');
      // The document's context, unless the caller had another file in mind —
      // the file tree's right-click runs on the row you clicked, not on the
      // document you happen to be looking at.
      const ctx = opts.ctx ? { ...context(), ...opts.ctx } : context();
      // Anything that reads {file} reads it off DISK, so an edited buffer has
      // to land there first — otherwise a formatter politely formats the
      // version you already changed.
      if (a.save !== false && ctx.dirty && ctx.file && !opts.ctx) {
        const r = await tiny.api.call('saveDoc', { id: ctx.sheetId, text: ctx.text });
        if (!r || r.needsPath) return toast('Save the document first');
      }

      const r = await tiny.api.call('actionRun', {
        scope: a.scope, id: a.id, ctx,
        trust: opts.trust, confirmed: opts.confirmed, inputs: opts.inputs,
      });
      if (!r) return;
      if (r.error) return toast(r.error);
      // The sheets take the focus, and answering them is clicks and typing —
      // by the time one says go, the selection this run was about is gone.
      // So the ctx from the moment you invoked rides along to the re-run,
      // instead of being read again from a document that no longer shows it.
      if (r.needsInput) return askInput(r.needsInput, a, { ...opts, ctx });
      if (r.needsTrust) return askTrust(r.needsTrust, a, { ...opts, ctx });
      if (r.needsConfirm) {
        const ok = await tiny.dialog.confirm('Run “' + r.needsConfirm.label + '”?',
          { detail: r.needsConfirm.body + '\n\nin ' + r.needsConfirm.cwd, ok: 'Run' });
        if (ok) start(a, { ...opts, ctx, confirmed: true });
        return;
      }

      run = { runId: r.runId, label: r.label, mode: r.mode, a };
      // 'panel' is the only mode that opens the drawer by itself; the others
      // do something visible with the output and would rather not cover the
      // document to do it. A failure opens it regardless — see below.
      if (r.mode === 'panel') showPanel(true);
      if (out.textContent) write('\n');
      write('$ ' + (r.command || r.label) + '\n');
      title.textContent = r.label;
      meta.textContent = r.cwd || '';
      dot.className = 'running';
      stop.hidden = false;
      if (onBusy) onBusy(true);
    }

    tiny.api.on('action-out', (p) => {
      if (!run || p.runId !== run.runId) return;
      // ctx.log means "show the person this" — the drawer opens for it even
      // when the output mode keeps it shut. A returned result stays 'out'.
      if (p.stream === 'log' && panel.hidden) showPanel(true);
      write(p.text, p.stream);
    });

    tiny.api.on('action-done', (p) => {
      if (!run || p.runId !== run.runId) return;
      const r = run;
      run = null;
      stop.hidden = true;
      dot.className = p.ok ? 'ok' : 'bad';
      if (onBusy) onBusy(false);
      const secs = p.ms >= 1000 ? (p.ms / 1000).toFixed(1) + 's' : p.ms + 'ms';
      meta.textContent = (p.ok ? 'done' : (p.error || 'exit ' + p.code)) + ' · ' + secs;
      if (p.error) write('\n[' + p.error + ']\n', 'err');

      // A failure always surfaces, whatever the output mode said: the one
      // thing worse than a command that fails is one that fails quietly.
      if (!p.ok) {
        showPanel(true);
        toast('“' + r.label + '” failed');
        return;
      }
      applyOutput(r, p);
    });

    function applyOutput(r, p) {
      // `text` is the ANSWER when the backend can tell the two apart — a js
      // action's return value, an AI action's reply. `output` is everything
      // the drawer saw, which for those two includes whatever they logged on
      // the way. Insert the answer, not the transcript.
      const raw = p.text != null ? p.text : (p.output || '');
      // Trimmed for the modes that put the output somewhere INSIDE a
      // document — a stray newline from `date` at your caret is noise. Never
      // for "replace": the trailing newline at the end of a Markdown file is
      // the file's own, and a formatter that round-trips must not lose it.
      const text = raw.replace(/\s+$/, '');
      switch (r.mode) {
        case 'replace':
          if (!text) return toast('“' + r.label + '” printed nothing — nothing replaced');
          applyText(raw);
          toast('Replaced from “' + r.label + '”');
          break;
        case 'insert':
          // the answer replaces the selection and STAYS selected — the caret
          // hopping to the end read as the action eating your selection
          if (text) insertText(text, { select: true });
          break;
        case 'doc':
          tiny.api.call('newDocWith', { text, name: r.label });
          break;
        // 'notify' is what 'toast' used to be called; both land here.
        case 'toast':
        case 'notify':
          toast(text ? text.split('\n').slice(-1)[0].slice(0, 120) : r.label + ' — done');
          break;
        // The whole answer, in a box, and then gone — for the actions whose
        // output is one line you want to READ rather than a stream you want to
        // watch. A word count should not open a drawer.
        case 'alert':
          showAlert(r.a, r.label, text || '(it printed nothing)');
          break;
        case 'none':
          break;
        default:
          break;                       // 'panel': it's already on screen
      }
    }

    // Actions ▸ <one of them> in the menu bar: the backend can't know what
    // this window is showing, so it asks the window to do it.
    tiny.api.on('run-action', async ({ scope, id }) => {
      await refresh();
      const a = list.find((x) => x.scope === scope && x.id === id);
      if (!a) return toast('That action is gone — Actions ▸ Reload');
      if (a.why) return toast(a.label + ' — ' + a.why);
      start(a);
    });

    // the set changed under us (a file saved, a folder opened, an icon the
    // backend just fetched) — and if the menu is on screen, redraw it where
    // it stands so a cold-cache icon pops in rather than waiting for a reopen
    tiny.api.on('actions', () => {
      if (!menu.hidden && menuAt) openMenu(menuAt.x, menuAt.y);
      else refresh();
    });

    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!menu.hidden) { hideMenu(); return; }
        if (!shade.hidden) { hideSheet(); return; }
        if (!panel.hidden && !run) { showPanel(false); return; }
      }
      // ⌘⇧R — the list, from the keyboard
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        if (menu.hidden) {
          const r = button.hidden ? { left: 20, width: 0, bottom: 40 } : button.getBoundingClientRect();
          openMenu(r.left + r.width / 2, r.bottom + 6);
        } else hideMenu();
      }
    }, true);

    refresh();

    return {
      refresh,
      openMenu,
      // the editor's "Run it now", once the file it just wrote is reloaded
      async runById(scope, id) {
        await refresh();
        const a = list.find((x) => x.scope === scope && x.id === id);
        if (!a) return toast('That action is gone — Actions ▸ Reload');
        if (a.why) return toast(a.label + ' — ' + a.why);
        start(a);
      },
      // For the file tree's right-click: what applies to THAT file, asked
      // fresh, because "applies" is the backend's word (needs, match, os).
      //
      // Only actions that are ABOUT a file are offered here, and only ones
      // that don't act on the open editor: "run this on that file" is the
      // gesture, so a formatter that would pipe the document you're looking
      // at into a file you merely right-clicked has no business in this menu.
      async forFile(file) {
        const r = await tiny.api.call('actionsList', { ctx: { ...context(), file } });
        return ((r && r.list) || []).filter((a) => !a.why && a.fileScoped
          && a.stdin === 'none' && a.output !== 'replace' && a.output !== 'insert').map((a) => ({
          label: a.label,
          scope: a.scope,
          run: () => start(a, { ctx: { file, sel: '', text: '' } }),
        }));
      },
    };
  }

  window.setupActions = setupActions;
})();
