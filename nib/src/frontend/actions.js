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
    shade, sheet,
    // what only the document knows
    context, applyText, insertText, toast, onBusy, onManage,
  }) {
    let list = [];                 // the last actionsList answer
    let run = null;                // the run in flight: { runId, label, mode }
    let pending = null;            // a trust prompt waiting on an answer
    let tail = true;               // is the drawer scrolled to the bottom?

    // ------------------------------------------------------------- the menu

    const hideMenu = () => { menu.hidden = true; menu.textContent = ''; };
    addEventListener('mousedown', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== button) hideMenu();
    });
    addEventListener('blur', hideMenu);

    async function refresh() {
      const r = await tiny.api.call('actionsList', { ctx: context() });
      list = (r && r.list) || [];
      // The ⚡ only appears once there is something behind it — an empty menu
      // is a worse answer than no button. Actions ▸ Edit… is always in the
      // menu bar, which is where you go to make the first one.
      button.hidden = !list.length;
      return r;
    }

    function rowFor(a) {
      const el = document.createElement('div');
      el.className = 'citem' + (a.why ? ' off' : '');
      const name = document.createElement('span');
      name.textContent = a.label;
      el.appendChild(name);
      // A folder's action says so, every time it is offered — provenance is
      // the whole difference between the two files.
      if (a.scope === 'project') {
        const tag = document.createElement('span');
        tag.className = 'ctag';
        tag.textContent = a.trust === 'trusted' ? 'folder'
          : a.trust === 'changed' ? 'folder · changed' : 'folder · approve';
        el.appendChild(tag);
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

    function write(text, isErr) {
      const node = document.createElement(isErr ? 'b' : 'span');
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

      const r = await tiny.api.call('actionRun',
        { scope: a.scope, id: a.id, ctx, trust: opts.trust, confirmed: opts.confirmed });
      if (!r) return;
      if (r.error) return toast(r.error);
      if (r.needsTrust) return askTrust(r.needsTrust, a, opts);
      if (r.needsConfirm) {
        const ok = await tiny.dialog.confirm('Run “' + r.needsConfirm.label + '”?',
          { detail: r.needsConfirm.body + '\n\nin ' + r.needsConfirm.cwd, ok: 'Run' });
        if (ok) start(a, { ...opts, confirmed: true });
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
      write(p.text, p.stream === 'err');
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
      if (p.error) write('\n[' + p.error + ']\n', true);

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
      const raw = p.output || '';
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
          if (text) insertText(text);
          break;
        case 'doc':
          tiny.api.call('newDocWith', { text, name: r.label });
          break;
        case 'notify':
          toast(text ? text.split('\n').slice(-1)[0].slice(0, 120) : r.label + ' — done');
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

    // the set changed under us (a file saved, a folder opened)
    tiny.api.on('actions', () => refresh());

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
