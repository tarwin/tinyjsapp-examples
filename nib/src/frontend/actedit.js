// Manage Actions — the actions file as a form.
//
// The JSON is still the real thing, and editing it by hand is still a click
// away; this is the front door for people who don't want to learn a schema to
// get a button that runs `npm run build`. So it edits the FILE, not some
// parallel model of it: read the text, parse it with json.js, change the one
// entry that moved, print the tree back. Every comment outside the entry you
// touched survives, and a file this sheet has never seen keeps its shape.
//
// Nothing is written until you say Save. It used to write as you typed, which
// sounds friendly right up to the moment a half-typed command is what is in
// your folder's actions file. What it does instead is never LOSE anything:
// what you have typed is kept per action while the sheet is open, so clicking
// another one and coming back finds your edit where you left it (its row wears
// a dot), and closing with anything unsaved asks first.

(() => {
  const OSES = ['macos', 'windows', 'linux'];

  // A command line as argv, the way a shell would split it — quotes hold a
  // word together, so `pandoc "my file.md"` is two arguments and not three.
  function splitArgv(line) {
    const out = [];
    let cur = '', q = null, any = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === q) { q = null; continue; }
        cur += c;
        continue;
      }
      if (c === '"' || c === "'") { q = c; any = true; continue; }
      if (/\s/.test(c)) { if (cur || any) { out.push(cur); cur = ''; any = false; } continue; }
      cur += c;
    }
    if (cur || any) out.push(cur);
    return out;
  }

  // …and back again, quoting only what would otherwise come apart.
  const joinArgv = (argv) => (argv || [])
    .map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');

  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 40) || 'action';

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function setupActionEditor({ open: openApi, onRun, toast }) {
    const $ = (id) => document.getElementById(id);
    const shade = $('actEditShade');

    let scope = 'global';                 // which file is on screen
    let file = null;                      // { path, text, name, … }
    let tree = null;                      // json.js tree for that text
    let items = null;                     // the actions array's items, in the tree
    let rows = [];                        // what the list shows: saved + not-yet-saved
    let picked = -1;
    let scopes = [];

    // A row is one line in the list. `item` is its place in the parsed file —
    // absent on one you have just added, which exists only here until it is
    // saved. `draft` is what the form is holding: null once it matches what is
    // in the file.
    const cur = () => (picked >= 0 ? rows[picked] : null);
    const saved = (r) => (r && r.item ? jsonc.toValue(r.item.value) : null);
    const isDirty = (r) => !!r && (!r.item || (!!r.draft && !same(r.draft, saved(r))));
    const anyDirty = () => rows.some(isDirty);
    const shown = (r) => (r ? (r.draft || saved(r) || {}) : {});

    // ------------------------------------------------------- the file model

    // The actions array inside whatever shape the file is in — a bare array at
    // the root is allowed too, because the loader allows it.
    function actionsItems(t) {
      const root = t.root;
      if (root.kind === 'arr') return root.items;
      if (root.kind === 'obj') {
        const m = root.members.find((x) => x.key === '"actions"');
        if (m && m.value.kind === 'arr') return m.value.items;
        // no `actions` key yet: add one, so the first New Action has a home
        const value = { kind: 'arr', items: [], tail: [] };
        root.members.push({ key: '"actions"', lead: [], trail: [], value });
        return value.items;
      }
      return null;
    }

    async function load(which) {
      scope = which;
      file = await tiny.api.call('actionsFile', { scope });
      if (!file || file.error) { note(file && file.error); return false; }
      const text = file.exists && file.text.trim() ? file.text : '{\n  "actions": []\n}\n';
      const parsed = jsonc.check(text);
      if (!parsed.ok) {
        // Hand-edited into a state this sheet can't safely rewrite. Say so and
        // send them to the file rather than offering to stomp on it.
        tree = null; items = null; rows = []; picked = -1;
        paint();
        note('This file has a syntax error — ' + parsed.message);
        return false;
      }
      tree = parsed.tree;
      items = actionsItems(tree);
      rows = items.map((item) => ({ item, draft: null }));
      picked = rows.length ? 0 : -1;
      paint();
      note(file.exists ? '' : 'New file — nothing is written until you save');
      return true;
    }

    // Write the whole file. Only ever called from a Save, so what lands on
    // disk is the file plus the changes you approved — never a keystroke.
    async function writeFile() {
      if (!tree) return false;
      const text = jsonc.printTree(tree);
      const r = await tiny.api.call('actionsWrite', { scope, text });
      if (!r || r.error) { note((r && r.error) || 'couldn’t write that'); return false; }
      file.exists = true;
      note(r.problems && r.problems.length ? '⚠ ' + r.problems[0] : 'Saved');
      return true;
    }

    // One row, from its draft into the tree.
    function apply(r) {
      if (!r || !isDirty(r)) return;
      const value = jsonc.fromValue(r.draft || saved(r));
      if (r.item) r.item.value = value;
      else {
        r.item = { lead: [], trail: [], value };
        items.push(r.item);
      }
      r.draft = null;
    }

    async function saveOne(r) {
      apply(r);
      const ok = await writeFile();
      paint();
      return ok;
    }

    async function saveAll() {
      // one bad row stops the lot: writing the others and silently dropping
      // this one is exactly the outcome we are here to prevent
      const bad = rows.filter(isDirty).find((r) => problem(r));
      if (bad) {
        picked = rows.indexOf(bad);
        paint();
        note(problem(bad) + ' — fix it or discard it');
        toast(problem(bad));
        return false;
      }
      for (const r of rows) apply(r);
      const ok = await writeFile();
      paint();
      return ok;
    }

    const note = (s) => { $('aeNote').textContent = s || ''; };

    // ---------------------------------------------------------------- paint

    function paint() {
      const sc = $('aeScopes');
      sc.textContent = '';
      for (const s of scopes) {
        const b = document.createElement('button');
        b.className = 'aescope' + (s.scope === scope ? ' on' : '');
        b.textContent = s.name;
        b.onclick = () => switchScope(s.scope);
        sc.appendChild(b);
      }

      const list = $('aeRows');
      list.textContent = '';
      rows.forEach((r, i) => {
        const v = shown(r);
        const el = document.createElement('div');
        el.className = 'aerow' + (i === picked ? ' on' : '') + (isDirty(r) ? ' dirty' : '');
        const name = document.createElement('span');
        name.className = 'aename';
        name.textContent = v.label || v.id || '(unnamed)';
        const kind = document.createElement('span');
        kind.className = 'aekind';
        kind.textContent = isDirty(r) ? '●' : v.type === 'js' ? 'js' : '';
        kind.title = isDirty(r) ? 'Unsaved changes' : '';
        el.append(name, kind);
        // Switching rows keeps your edit — it stays on the row you left, dot
        // and all, so nothing has to be decided just to go and look at another.
        el.onclick = () => { picked = i; paint(); };
        list.appendChild(el);
      });
      $('aeEmpty').hidden = !!rows.length;
      $('aeFields').hidden = picked < 0 || !rows[picked];
      if (!$('aeFields').hidden) fill(shown(cur()));
      syncButtons();
    }

    // An action with nothing to run is not an action — and worse, the loader
    // DROPS it, so saving one quietly loses the button you thought you had
    // just made. (That is how a perfectly good "Reveal in terminal" became
    // `"run": []` and stopped existing.) So it is caught before the save, on
    // the button that would have done it.
    function problem(r) {
      const v = shown(r);
      if (!r) return null;
      if (v.type === 'js') return String(v.script || '').trim() ? null : 'The script is empty';
      const run = v.run;
      const empty = Array.isArray(run)
        ? !run.filter((x) => String(x).trim()).length : !String(run || '').trim();
      return empty ? 'The command is empty' : null;
    }

    function syncButtons() {
      const r = cur();
      const d = isDirty(r);
      const bad = d ? problem(r) : null;
      $('aeSave').disabled = !d || !!bad;
      $('aeSave').title = bad || '';
      $('aeRevert').disabled = !d;
      $('aeRevert').textContent = r && !r.item ? 'Discard' : 'Revert';
      return bad;
    }

    function fill(a) {
      a = a || {};
      $('aeLabel').value = a.label || '';
      $('aeType').value = a.type === 'js' ? 'js' : 'cli';
      const shell = typeof a.run === 'string' || a.shell === true;
      $('aeShell').checked = shell;
      $('aeRun').value = typeof a.run === 'string' ? a.run : joinArgv(a.run);
      $('aeScript').value = a.script || '';
      $('aeNeeds').value = a.needs || 'none';
      $('aeMatch').value = [].concat(a.match || []).join(', ');
      $('aeStdin').value = a.stdin || 'none';
      $('aeOutput').value = a.output || 'panel';
      $('aeCwd').value = a.cwd || '';
      $('aeTimeout').value = Math.round((a.timeout || 120000) / 1000);
      $('aeSaveFirst').checked = a.save !== false;
      $('aeConfirm').checked = !!a.confirm;
      const on = a.os ? [].concat(a.os) : OSES;
      for (const box of $('aeOS').querySelectorAll('input')) box.checked = on.includes(box.value);
      $('aeId').textContent = a.id ? 'id: ' + a.id : '';
      applyType();
      showArgv();
    }

    function applyType() {
      const js = $('aeType').value === 'js';
      $('aeCli').hidden = js;
      $('aeJs').hidden = !js;
    }

    // What the command will actually be handed as, shown while you type: the
    // whole point of the argv form is that you can SEE where it splits.
    function showArgv() {
      const box = $('aeArgv');
      box.textContent = '';
      if ($('aeShell').checked) {
        box.textContent = 'Handed to a shell exactly as written';
        return;
      }
      const argv = splitArgv($('aeRun').value);
      if (!argv.length) { box.textContent = 'The program to run, then its arguments'; return; }
      argv.forEach((a, i) => {
        const chip = document.createElement('span');
        chip.className = 'achip' + (i ? '' : ' first');
        chip.textContent = a;
        box.appendChild(chip);
      });
    }

    // ------------------------------------------------------------ collecting

    // The form as an action object — only what was actually said. Defaults are
    // left OUT of the file: a folder's actions.json should read like a
    // sentence, not like a settings dump.
    function collect(prev) {
      const a = {};
      const label = $('aeLabel').value.trim() || 'Action';
      // The id is what a trust grant is pinned to, so once it means something
      // it is kept: renaming a button must not ask its owner to approve it
      // again. The placeholder a new row is born with means nothing, so that
      // one follows the name until the name settles.
      const born = prev && prev.id && /^action-\d+$/.test(prev.id);
      a.id = (!born && prev && prev.id) ? prev.id : uniqueId(slug(label));
      a.label = label;
      if ($('aeType').value === 'js') {
        a.type = 'js';
        a.script = $('aeScript').value;
      } else {
        const line = $('aeRun').value;
        if ($('aeShell').checked) a.run = line;
        else a.run = splitArgv(line);
      }
      const needs = $('aeNeeds').value;
      if (needs !== 'none') a.needs = needs;
      const match = $('aeMatch').value.split(',').map((s) => s.trim()).filter(Boolean);
      if (match.length) a.match = match.length === 1 ? match[0] : match;
      const os = [...$('aeOS').querySelectorAll('input')].filter((b) => b.checked).map((b) => b.value);
      if (os.length && os.length < OSES.length) a.os = os.length === 1 ? os[0] : os;
      if ($('aeStdin').value !== 'none') a.stdin = $('aeStdin').value;
      if ($('aeOutput').value !== 'panel') a.output = $('aeOutput').value;
      if ($('aeCwd').value.trim()) a.cwd = $('aeCwd').value.trim();
      const secs = Math.max(1, Math.min(3600, +$('aeTimeout').value || 120));
      if (secs !== 120) a.timeout = secs * 1000;
      if (!$('aeSaveFirst').checked) a.save = false;
      if ($('aeConfirm').checked) a.confirm = true;
      return a;
    }

    // Two actions with one id would make a trust grant ambiguous (and the
    // loader drops the loser), so a clash gets a number.
    function uniqueId(want) {
      const taken = new Set(rows.map((r, i) => (i === picked ? null : (shown(r).id || null)))
        .filter(Boolean));
      if (!taken.has(want)) return want;
      for (let n = 2; ; n++) if (!taken.has(want + '-' + n)) return want + '-' + n;
    }

    // Every keystroke lands in the row's draft — never in the file.
    function touch() {
      const r = cur();
      if (!r) return;
      const next = collect(shown(r));
      r.draft = next;
      $('aeId').textContent = 'id: ' + next.id;
      const row = $('aeRows').children[picked];
      if (row) {
        row.querySelector('.aename').textContent = next.label || '(unnamed)';
        row.classList.toggle('dirty', isDirty(r));
        const k = row.querySelector('.aekind');
        k.textContent = isDirty(r) ? '●' : (next.type === 'js' ? 'js' : '');
        k.title = isDirty(r) ? 'Unsaved changes' : '';
      }
      const bad = syncButtons();
      if (isDirty(r)) note(bad || 'Unsaved changes');
    }

    // -------------------------------------------------------------- the keys

    for (const id of ['aeLabel', 'aeRun', 'aeScript', 'aeMatch', 'aeCwd', 'aeTimeout']) {
      $(id).addEventListener('input', () => { if (id === 'aeRun') showArgv(); touch(); });
    }
    for (const id of ['aeNeeds', 'aeOutput', 'aeStdin']) $(id).addEventListener('change', touch);
    $('aeType').addEventListener('change', () => { applyType(); touch(); });
    $('aeShell').addEventListener('change', () => { showArgv(); touch(); });
    for (const id of ['aeSaveFirst', 'aeConfirm']) $(id).addEventListener('change', touch);
    for (const box of $('aeOS').querySelectorAll('input')) box.addEventListener('change', touch);

    $('aeSave').onclick = () => saveOne(cur());
    $('aeRevert').onclick = () => {
      const r = cur();
      if (!r) return;
      if (!r.item) {                       // never saved: Discard removes it
        rows.splice(picked, 1);
        picked = Math.min(picked, rows.length - 1);
      } else r.draft = null;
      note('');
      paint();
    };

    $('aeAdd').onclick = () => {
      if (!items) return;
      rows.push({ item: null, draft: {
        id: 'action-' + (rows.length + 1), label: 'New Action', run: [''],
      } });
      picked = rows.length - 1;
      paint();
      note('New action — Save to add it to the file');
      $('aeLabel').focus();
      $('aeLabel').select();
    };

    $('aeDelete').onclick = async () => {
      const r = cur();
      if (!r) return;
      const v = shown(r);
      if (!r.item) { $('aeRevert').onclick(); return; }   // never made it to the file
      const sure = await tiny.dialog.confirm('Delete “' + (v.label || v.id) + '”?', {
        detail: 'It goes out of ' + (file ? file.path : 'the actions file') + '.',
        ok: 'Delete', cancel: 'Keep',
      });
      if (!sure) return;
      items.splice(items.indexOf(r.item), 1);
      rows.splice(picked, 1);
      picked = Math.min(picked, rows.length - 1);
      await writeFile();
      paint();
    };

    // Running is a thing you do to what is IN the file, so an edit has to land
    // first — offered, not assumed.
    $('aeRunNow').onclick = async () => {
      const r = cur();
      if (!r) return;
      if (isDirty(r)) {
        const ok = await tiny.dialog.confirm('Save “' + (shown(r).label || '') + '” first?', {
          detail: 'It runs what is in the file, so this change has to be saved to take part.',
          ok: 'Save and Run', cancel: 'Cancel',
        });
        if (!ok) return;
        if (!(await saveOne(r))) return;
      }
      const v = shown(r);
      close();
      if (onRun) onRun(scope, v.id);
    };

    $('aeJson').onclick = async () => {
      if (!(await settle('Save your changes before opening the file?'))) return;
      close();
      tiny.api.call('actionsEdit', { scope });
    };

    // Anything that would walk away from unsaved work asks once. Save is the
    // default button, so the safe answer is the easy one.
    async function settle(question) {
      if (!anyDirty()) return true;
      const n = rows.filter(isDirty).length;
      const ok = await tiny.dialog.confirm(question, {
        detail: n === 1 ? 'One action has changes that aren’t in the file yet.'
          : n + ' actions have changes that aren’t in the file yet.',
        ok: 'Save', cancel: 'Discard',
      });
      if (ok) return saveAll();
      // Discard: the tree was never touched, so dropping the drafts (and any
      // row that only ever existed here) is the whole undo.
      rows = rows.filter((r) => r.item);
      for (const r of rows) r.draft = null;
      picked = Math.min(picked, rows.length - 1);
      paint();
      return true;
    }

    async function switchScope(which) {
      if (which === scope) return;
      if (!(await settle('Save your changes to this file first?'))) return;
      load(which);
    }

    const close = () => { shade.hidden = true; };
    async function done() {
      if (!(await settle('Save your changes?'))) return;
      close();
    }
    $('aeClose').onclick = done;
    shade.addEventListener('mousedown', (e) => { if (e.target === shade) done(); });
    addEventListener('keydown', (e) => {
      if (shade.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); done(); }
      // ⌘S saves the action you are editing, like everywhere else in the app
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (isDirty(cur())) saveOne(cur());
      }
    }, true);

    async function open(which) {
      scopes = await openApi();             // which files are available now
      if (!scopes.length) return toast('No actions file is available');
      const want = scopes.some((s) => s.scope === which) ? which : scopes[0].scope;
      shade.hidden = false;
      await load(want);
    }

    return { open, isOpen: () => !shade.hidden };
  }

  window.setupActionEditor = setupActionEditor;
  window.splitArgv = splitArgv;
  window.joinArgv = joinArgv;
})();
