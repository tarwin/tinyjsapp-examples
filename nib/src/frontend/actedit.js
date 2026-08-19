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
  const OS_NAMES = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

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

  function setupActionEditor({ open: openApi, onRun, toast, pickEmoji, closeEmoji }) {
    const $ = (id) => document.getElementById(id);
    const shade = $('actEditShade');

    // ---------------------------------------------------------------- icons
    //
    // The Icon field is still just a string in the file — an emoji, or an
    // Iconify name like "mdi:rocket". Everything here is presentation: put
    // the right picture next to the string wherever the sheet shows one,
    // without ever showing the raw name as if it were the icon.

    // An icon string into a span: emoji as text, an Iconify name as a marked
    // slot that decorate() fills in once the drawing arrives.
    function iconInto(span, icon) {
      span.textContent = '';
      delete span.dataset.iconname;
      if (!icon) return;
      if (window.nibIsIconName(icon)) span.dataset.iconname = icon;
      else span.textContent = icon;
    }

    // One round trip for every marked slot under root — the backend answers
    // from its cache (or fetches), misses just stay empty.
    async function decorate(root) {
      const want = [...root.querySelectorAll('[data-iconname]')]
        .map((el) => el.dataset.iconname);
      if (!want.length) return;
      const r = await tiny.api.call('iconGet', { names: [...new Set(want)] });
      const map = (r && r.icons) || {};
      for (const el of root.querySelectorAll('[data-iconname]')) {
        const rec = map[el.dataset.iconname];
        if (!rec) continue;
        delete el.dataset.iconname;
        el.appendChild(window.nibActIcon({ iconSvg: rec }));
      }
    }

    // The list row's name: icon slot, then the label.
    function nameInto(span, v) {
      span.textContent = '';
      const ico = document.createElement('span');
      ico.className = 'aeicon';
      iconInto(ico, v.icon);
      span.append(ico, document.createTextNode(v.label || v.id || '(unnamed)'));
    }

    // The swatch beside the field — only earns its keep for an Iconify name
    // (an emoji already shows itself in the input).
    function prevIcon() {
      const s = $('aeIconPrev');
      s.textContent = '';
      delete s.dataset.iconname;
      const v = $('aeIcon').value.trim();
      if (!window.nibIsIconName(v)) { s.hidden = true; return; }
      s.hidden = false;
      s.dataset.iconname = v;
      decorate(s.parentElement);
    }

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
      const bad = await vetJs(r);
      if (bad) {
        drawScriptErr();
        if (!(await askBroken(bad))) {
          note('Not saved — ' + bad);
          return false;
        }
      }
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
      for (const r of rows.filter(isDirty)) {
        const broken = await vetJs(r);
        if (broken) {
          picked = rows.indexOf(r);
          paint();
          if (!(await askBroken(broken))) {
            note('Not saved — ' + broken);
            return false;
          }
        }
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
        // The folder's tab wears a folder. These two files are the whole
        // design of actions and the difference between them matters every
        // time you press Save — one is yours, the other travels with the
        // folder and will be asking somebody else for approval.
        if (s.scope === 'project') {
          const ico = document.createElement('span');
          ico.className = 'aescopeico';
          ico.textContent = '📁';
          b.appendChild(ico);
        }
        b.appendChild(document.createTextNode(s.name));
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
        nameInto(name, v);
        const kind = document.createElement('span');
        kind.className = 'aekind';
        kind.textContent = isDirty(r) ? '●' : v.type === 'js' ? 'js' : v.type === 'ai' ? 'ai' : '';
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
      decorate(list);
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
      if (v.type === 'ai') return String(v.prompt || '').trim() ? null : 'The prompt is empty';
      const filled = (run) => (Array.isArray(run)
        ? !!run.filter((x) => String(x).trim()).length : !!String(run || '').trim());
      if (v.run === undefined && OSES.some((o) => v[o])) {
        // per-platform: every platform it is on needs its own command
        const on = v.os ? [].concat(v.os) : OSES;
        const missing = on.find((o) => !v[o] || !filled(v[o].run));
        return missing ? 'The ' + OS_NAMES[missing] + ' command is empty' : null;
      }
      return filled(v.run) ? null : 'The command is empty';
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
      $('aeIcon').value = a.icon || '';
      $('aeDesc').value = a.description || '';
      $('aeToolbar').checked = !!a.toolbar;
      $('aeSelection').checked = !!a.selection;
      askRows = normalizeAskForForm(a.ask);
      $('aeType').value = a.type === 'js' ? 'js' : a.type === 'ai' ? 'ai' : 'cli';
      drawAsk();          // after the type lands — its hint speaks differently for js
      const shell = typeof a.run === 'string' || a.shell === true;
      $('aeShell').checked = shell;
      $('aeRun').value = typeof a.run === 'string' ? a.run : joinArgv(a.run);
      // Each platform's command: its block, else the shared one — so an old
      // base-plus-override action reads as tabs prefilled with the base.
      const blocks = OSES.filter((o) => a[o] && typeof a[o] === 'object' && a[o].run !== undefined);
      perOS = !!blocks.length;
      $('aePerOS').checked = perOS;
      osRuns = blankRuns();
      for (const o of OSES) {
        const b = blocks.includes(o) ? a[o] : null;
        osRuns[o] = b
          ? { line: runLine(b.run), shell: typeof b.run === 'string' || b.shell === true }
          : { line: $('aeRun').value, shell };
      }
      if (perOS && !blocks.includes(osTab)) osTab = blocks[0];
      $('aeScript').value = a.script || '';
      $('aePrompt').value = a.prompt || '';
      $('aeSystem').value = a.system || '';
      $('aeTools').value = a.tools || '';
      $('aeApprove').value = a.approve || '';
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
      showRunFor();
      prevIcon();
      paintScript();
      closeCtx();
      drawScriptErr();
      if ($('aeType').value === 'js') checkScriptSoon();
    }

    // ------------------------------------------------------------- ask rows
    //
    // The questions an action asks before it runs. Kept as a plain array and
    // redrawn, rather than read out of the DOM on every keystroke — the rows
    // move (up, down, gone) and reading a moving list is how off-by-ones live.

    let askRows = [];
    const ASK_KINDS = [['text', 'A line of text'], ['multiline', 'Several lines'],
      ['number', 'A number'], ['choice', 'One of a list'],
      ['check', 'A tick box'], ['file', 'A file'], ['folder', 'A folder']];

    function normalizeAskForForm(ask) {
      return [].concat(ask || []).map((x) => (typeof x === 'string'
        ? { label: x, type: 'text' }
        : { label: x.label || x.name || '', type: x.type || 'text',
            name: x.name || '', default: x.default || '',
            choices: [].concat(x.choices || []).join(', ') }));
    }

    function collectAsk() {
      return askRows.filter((r) => String(r.label || '').trim()).map((r) => {
        const o = { label: r.label.trim() };
        if (r.name && r.name.trim()) o.name = r.name.trim();
        if (r.type && r.type !== 'text') o.type = r.type;
        if (r.default) o.default = r.default;
        if (r.type === 'choice' && r.choices) {
          o.choices = r.choices.split(',').map((c) => c.trim()).filter(Boolean);
        }
        // a one-field text question is just its label — the shorthand the
        // loader already understands, and the tidier thing to leave in a file
        return Object.keys(o).length === 1 ? o.label : o;
      });
    }

    function drawAsk() {
      const box = $('aeAsk');
      box.textContent = '';
      askRows.forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'askrow';

        const lab = document.createElement('input');
        lab.type = 'text';
        lab.placeholder = 'Question — e.g. Branch name';
        lab.value = r.label || '';
        lab.oninput = () => { r.label = lab.value; touch(); };

        const kind = document.createElement('select');
        for (const [v, name] of ASK_KINDS) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = name;
          kind.appendChild(o);
        }
        kind.value = r.type || 'text';
        kind.onchange = () => { r.type = kind.value; drawAsk(); touch(); };

        const drop = document.createElement('button');
        drop.className = 'askdrop';
        drop.textContent = '✕';
        drop.title = 'Remove this question';
        drop.onclick = () => { askRows.splice(i, 1); drawAsk(); touch(); };

        el.append(lab, kind, drop);

        if (r.type === 'choice') {
          const ch = document.createElement('input');
          ch.type = 'text';
          ch.className = 'askwide';
          ch.placeholder = 'The choices, comma separated';
          ch.value = r.choices || '';
          ch.oninput = () => { r.choices = ch.value; touch(); };
          el.appendChild(ch);
        }
        box.appendChild(el);
      });
      // The variable each question fills, spelled out — because "{branch}"
      // appearing in your command is the entire point and nothing else on
      // screen says so.
      const slugs = collectAsk().map((x) => (typeof x === 'string' ? x : x.label))
        .map((l) => String(l).toLowerCase().replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '').slice(0, 30));
      $('aeAskHint').textContent = slugs.length
        ? 'Use ' + slugs.map((n) => '{' + n + '}').join(', ') + ' in the command or prompt.'
        : 'Nothing — it runs straight away.';
    }

    $('aeAskAdd').onclick = (e) => {
      e.preventDefault();
      askRows.push({ label: '', type: 'text' });
      drawAsk();
      touch();
    };

    function applyType() {
      const t = $('aeType').value;
      $('aeCli').hidden = t !== 'cli';
      // a script asks for itself (ctx.prompt / choose / pickFile) — the form
      // would be a second way to say the same thing
      $('aeAskRow').hidden = t === 'js';
      $('aeAskHint').hidden = t === 'js';
      drawOSTabs();                        // the On row's fate depends on the type
      $('aeJs').hidden = t !== 'js';
      $('aeAi').hidden = t !== 'ai';
      // An AI action's default `stdin` is the document — that is what it is
      // for — so the field says so rather than reading "Nothing" and quietly
      // meaning something else.
      const nothing = $('aeStdin').querySelector('option[value="none"]');
      if (nothing) nothing.textContent = t === 'ai' ? 'Nothing (the prompt alone)' : 'Nothing';
      $('aeToolsHint').textContent = {
        '': '', off: 'Safest, and right for anything that rewrites text.',
        read: 'It can read and search the folder you have open.',
        full: 'It can write files, run commands and add actions — each one asks first '
          + 'unless you turned asking off. Only your own actions may use this.',
      }[$('aeTools').value] || '';
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

    // ------------------------------------------------ per-platform commands
    //
    // "Different command per platform" swaps the one Command field for three,
    // one behind each tab, held here the way askRows holds questions — the
    // field always shows the active tab and every keystroke is stashed back.
    // In the file this is the per-OS block form: no top-level `run`, and
    // { "run": … } under "macos"/"windows"/"linux" for each platform that has
    // one. The tick on a tab is the same switch as the On row below — a
    // platform ticked off keeps its command (here and in the file), it just
    // isn't offered there.

    let perOS = false;
    let osTab = 'macos';
    let osRuns = blankRuns();
    function blankRuns() {
      return { macos: { line: '', shell: false },
        windows: { line: '', shell: false }, linux: { line: '', shell: false } };
    }
    const runLine = (run) => (typeof run === 'string' ? run : joinArgv(run));
    const stash = () => {
      if (perOS) osRuns[osTab] = { line: $('aeRun').value, shell: $('aeShell').checked };
    };
    const osChecked = () => [...$('aeOS').querySelectorAll('input')]
      .filter((b) => b.checked).map((b) => b.value);

    function drawOSTabs() {
      const box = $('aeOSTabs');
      const off = $('aeOSOff');
      box.hidden = !perOS;
      off.hidden = true;
      // the ticks on the tabs ARE the On row, so showing both is saying it
      // twice — the row stays for the single command and for js/ai actions
      $('aeOnRow').hidden = perOS && $('aeType').value === 'cli';
      if (!perOS) return;
      box.textContent = '';
      const on = new Set(osChecked());
      for (const o of OSES) {
        const tab = document.createElement('div');
        tab.className = 'aeostab' + (o === osTab ? ' on' : '') + (on.has(o) ? '' : ' dim');
        const tick = document.createElement('input');
        tick.type = 'checkbox';
        tick.checked = on.has(o);
        tick.title = (on.has(o) ? 'Offered' : 'Not offered') + ' on ' + OS_NAMES[o];
        tick.onchange = () => {
          for (const b of $('aeOS').querySelectorAll('input')) {
            if (b.value === o) b.checked = tick.checked;
          }
          touch();
          drawOSTabs();
        };
        tab.append(tick, document.createTextNode(OS_NAMES[o]));
        tab.onclick = (e) => {
          if (e.target === tick) return;
          stash();
          osTab = o;
          showRunFor();
        };
        box.appendChild(tab);
      }
      if (!on.has(osTab)) {
        off.hidden = false;
        off.textContent = OS_NAMES[osTab] + ' is ticked off — the command is kept, '
          + 'but the action isn’t offered there.';
      }
    }

    // The Command field is the active tab's when there are tabs.
    function showRunFor() {
      if (perOS) {
        $('aeRun').value = osRuns[osTab].line;
        $('aeShell').checked = osRuns[osTab].shell;
      }
      drawOSTabs();
      showArgv();
    }

    // Turning per-platform ON seeds every empty platform with the shared
    // command — start from what you had, then make Windows its own. Turning
    // it OFF keeps whichever platform you were looking at as the one command.
    $('aePerOS').addEventListener('change', () => {
      if ($('aePerOS').checked) {
        const line = $('aeRun').value, sh = $('aeShell').checked;
        perOS = true;
        for (const o of OSES) if (!osRuns[o].line.trim()) osRuns[o] = { line, shell: sh };
      } else {
        stash();
        perOS = false;
      }
      showRunFor();
      touch();
    });

    // ---------------------------------------------------- the script editor
    //
    // Colour and completion for the js field. The textarea can't paint its
    // own text, so it is two layers like the document editor: highlightCode
    // (code.js — the very painter the preview's fenced blocks use) into a
    // backdrop <pre>, and the textarea on top with transparent text. The
    // completion is deliberately not "JS autocomplete": it knows the one
    // thing worth knowing here — the ctx surface — and offers it when you
    // type `ctx.`; everything else you already know how to spell.

    const CTX_WORDS = [
      ['sel', 'the selection'], ['text', 'the whole document'],
      ['file', 'the open file, full path'], ['dir', 'its directory'],
      ['root', 'the open folder'], ['rel', 'file, relative to the folder'],
      ['name', 'file name'], ['stem', 'name, no extension'], ['ext', 'the extension'],
      ['line', 'caret line'], ['heading', 'nearest heading above'],
      ['cwd', 'where the action runs'], ['os', '"macos" | "windows" | "linux"'],
      ['pin', 'the pinned folder'], ['home', 'your home directory'],
      ['read(path)', 'file → string'], ['write(path, text)', 'string → file'],
      ['exists(path)', 'true / false'], ['list(dir)', 'names in a directory'],
      ['mkdir(path)', 'make a directory'], ['remove(path)', 'delete a file'],
      ['run(argv)', '["git", "pull"] — or a shell line'],
      ['fetch(url)', 'the fetch you know'],
      ['log(…)', 'print to the output drawer'],
      ['prompt(label, opts)', 'ask — {type: "multiline" | "number"}'],
      ['choose(label, [choices])', 'pick one of a list'],
      ['pickFile()', 'a file, chosen in the dialog'],
      ['pickFolder()', 'a folder, chosen in the dialog'],
      ['confirm(question)', 'ask yes / no'],
      ['alert(body, title)', 'a box with OK'],
      ['notify(title, body)', 'a system notification'],
      ['join(a, b)', 'paths joined'], ['resolve(path)', 'made absolute'],
      ['basename(path)', ''], ['dirname(path)', ''],
      ['stemname(path)', ''], ['extname(path)', ''],
    ];

    const scriptEl = () => $('aeScript');
    function paintScript() {
      // the trailing newline keeps the last line box alive, so the layers
      // stay the same height while you type at the bottom
      $('aeScriptHl').innerHTML = window.highlightCode(scriptEl().value + '\n', 'js');
      $('aeScriptHl').scrollTop = scriptEl().scrollTop;
    }

    const ctxPop = $('aeCtxPop');
    let ctxItems = [];
    let ctxSel = 0;
    let ctxAt = 0;                        // where the partial word starts
    const closeCtx = () => { ctxPop.hidden = true; ctxItems = []; };

    function ctxComplete() {
      const ta = scriptEl();
      if (ta.selectionStart !== ta.selectionEnd) return closeCtx();
      const m = /\b(?:ctx|tiny)\.(\w*)$/.exec(ta.value.slice(0, ta.selectionStart));
      if (!m) return closeCtx();
      const want = m[1].toLowerCase();
      ctxItems = CTX_WORDS.filter(([w]) => w.toLowerCase().startsWith(want));
      if (!ctxItems.length) return closeCtx();
      ctxAt = ta.selectionStart - m[1].length;
      ctxSel = 0;
      drawCtx();
      placeCtx(ta);
    }

    function drawCtx() {
      ctxPop.textContent = '';
      ctxItems.forEach(([word, hint], i) => {
        const row = document.createElement('div');
        row.className = 'ctxrow' + (i === ctxSel ? ' on' : '');
        const w = document.createElement('span');
        w.textContent = word;
        row.appendChild(w);
        if (hint) {
          const h = document.createElement('span');
          h.className = 'ctxhint';
          h.textContent = hint;
          row.appendChild(h);
        }
        // mousedown, not click — the textarea must keep the focus
        row.onmousedown = (e) => { e.preventDefault(); ctxSel = i; acceptCtx(); };
        ctxPop.appendChild(row);
      });
      const on = ctxPop.children[ctxSel];
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }

    // Where the caret is, by the mirror trick: a hidden clone of the field's
    // text up to the word being completed, with a marker to measure.
    function placeCtx(ta) {
      const r = ta.getBoundingClientRect();
      const cs = getComputedStyle(ta);
      const mir = document.createElement('div');
      mir.style.cssText = 'position:fixed;visibility:hidden;left:-9999px;top:0;'
        + 'white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;box-sizing:border-box;'
        + 'width:' + ta.clientWidth + 'px;font:' + cs.font + ';line-height:' + cs.lineHeight
        + ';padding:' + cs.padding + ';tab-size:' + cs.tabSize + ';';
      mir.textContent = ta.value.slice(0, ctxAt);
      const dot = document.createElement('span');
      dot.textContent = '\u200b';
      mir.appendChild(dot);
      document.body.appendChild(mir);
      const x = r.left + dot.offsetLeft - ta.scrollLeft;
      const y = r.top + dot.offsetTop + dot.offsetHeight - ta.scrollTop;
      mir.remove();
      ctxPop.hidden = false;
      ctxPop.style.left = Math.round(Math.min(Math.max(8, x), innerWidth - ctxPop.offsetWidth - 8)) + 'px';
      ctxPop.style.top = Math.round(Math.min(y + 3, innerHeight - ctxPop.offsetHeight - 8)) + 'px';
    }

    function acceptCtx() {
      const [word] = ctxItems[ctxSel] || [];
      if (!word) return closeCtx();
      const ta = scriptEl();
      const name = word.replace(/\(.*$/, '');
      const call = word.includes('(');
      ta.setRangeText(call ? name + '()' : name, ctxAt, ta.selectionStart, 'end');
      if (call) ta.setSelectionRange(ta.selectionStart - 1, ta.selectionStart - 1);
      closeCtx();
      paintScript();
      checkScriptSoon();
      touch();
    }

    scriptEl().addEventListener('keydown', (e) => {
      if (ctxPop.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        ctxSel = (ctxSel + (e.key === 'ArrowDown' ? 1 : ctxItems.length - 1)) % ctxItems.length;
        drawCtx();
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        acceptCtx();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeCtx();
      }
    });
    scriptEl().addEventListener('scroll', () => {
      $('aeScriptHl').scrollTop = scriptEl().scrollTop;
      closeCtx();
    });
    scriptEl().addEventListener('blur', closeCtx);
    scriptEl().addEventListener('click', closeCtx);

    // ------------------------------------------------ the check before save
    //
    // Does the script parse? The backend compiles it — the QuickJS that will
    // run it, in runJsBody's exact wrapper, nothing executed — so what Save
    // vets is what pressing the button gets. Checked as you type for the
    // inline line, and checked FRESH on the way into a save, because the
    // whole point of the form is that a button you just made works.
    let jsCheck = { src: null, error: null, line: null };
    let jsCheckTimer = null;

    async function checkScript(src) {
      if (jsCheck.src !== src) {
        const r = await tiny.api.call('actionCheckJs', { script: src });
        jsCheck = { src, error: (r && r.error) || null, line: (r && r.line) || null };
      }
      return jsCheck;
    }
    function checkScriptSoon() {
      clearTimeout(jsCheckTimer);
      jsCheckTimer = setTimeout(async () => {
        const src = scriptEl().value;
        await checkScript(src);
        if (scriptEl().value !== src) return;         // superseded by typing
        drawScriptErr();
        syncButtons();
      }, 350);
    }
    function drawScriptErr() {
      const el = $('aeScriptErr');
      const bad = jsCheck.error && jsCheck.src === scriptEl().value;
      el.hidden = !bad;
      if (bad) {
        el.textContent = '⚠ The script doesn’t parse — '
          + (jsCheck.line ? 'line ' + jsCheck.line + ': ' : '') + jsCheck.error;
      }
    }

    // Saving a broken script is allowed — half-written work belongs in the
    // file too — but never silently: the dialog says what pressing the
    // button would do, and Keep Editing is the default answer.
    async function askBroken(bad) {
      return tiny.dialog.confirm('Save it anyway?', {
        detail: bad + '\n\nThe button will fail when pressed until it parses.',
        ok: 'Save Anyway', cancel: 'Keep Editing',
      });
    }
    async function vetJs(r) {
      const v = shown(r);
      if (v.type !== 'js' || !String(v.script || '').trim()) return null;
      const c = await checkScript(v.script);
      return c.error
        ? '“' + (v.label || v.id) + '” doesn’t parse — '
          + (c.line ? 'line ' + c.line + ': ' : '') + c.error
        : null;
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
      if ($('aeIcon').value.trim()) a.icon = $('aeIcon').value.trim();
      if ($('aeDesc').value.trim()) a.description = $('aeDesc').value.trim();
      if ($('aeToolbar').checked) a.toolbar = true;
      if ($('aeSelection').checked) a.selection = true;
      const ask = collectAsk();
      if (ask.length && $('aeType').value !== 'js') a.ask = ask;
      if ($('aeType').value === 'js') {
        a.type = 'js';
        a.script = $('aeScript').value;
      } else if ($('aeType').value === 'ai') {
        a.type = 'ai';
        a.prompt = $('aePrompt').value;
        if ($('aeSystem').value.trim()) a.system = $('aeSystem').value.trim();
        if ($('aeTools').value) a.tools = $('aeTools').value;
        if ($('aeApprove').value) a.approve = $('aeApprove').value;
      } else if ($('aePerOS').checked) {
        // the per-OS block form: no top-level run, one block per platform
        // that has a command — ticked off or not, so nothing typed is lost
        stash();
        for (const o of OSES) {
          const { line, shell } = osRuns[o];
          if (!String(line || '').trim()) continue;
          a[o] = { run: shell ? line : splitArgv(line) };
        }
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
        nameInto(row.querySelector('.aename'), next);
        decorate(row);
        row.classList.toggle('dirty', isDirty(r));
        const k = row.querySelector('.aekind');
        k.textContent = isDirty(r) ? '●' : next.type === 'js' ? 'js' : next.type === 'ai' ? 'ai' : '';
        k.title = isDirty(r) ? 'Unsaved changes' : '';
      }
      const bad = syncButtons();
      if (isDirty(r)) note(bad || 'Unsaved changes');
    }

    // -------------------------------------------------------------- the keys

    for (const id of ['aeLabel', 'aeIcon', 'aeDesc', 'aeRun', 'aeScript', 'aePrompt',
      'aeSystem', 'aeMatch', 'aeCwd', 'aeTimeout']) {
      $(id).addEventListener('input', () => {
        if (id === 'aeRun') { stash(); showArgv(); }
        if (id === 'aeIcon') prevIcon();
        if (id === 'aeScript') { paintScript(); ctxComplete(); checkScriptSoon(); }
        touch();
      });
    }

    // ------------------------------------------------- the two icon pickers
    //
    // 🙂 borrows the document's emoji picker (it knows how to be a popover
    // already); 🔍 is its own little popover over Iconify's search, through
    // the backend — the click writes the icon's NAME into the field, which is
    // all the file ever carries.

    $('aeIconEmoji').onclick = (e) => {
      e.preventDefault();
      if (!pickEmoji) return;
      icoClose();
      pickEmoji($('aeIconEmoji'), (ch) => {
        $('aeIcon').value = ch;
        prevIcon();
        touch();
      });
    };

    const icoPop = $('icoPop');
    let icoTimer = null;
    let icoTok = 0;
    const icoClose = () => { icoPop.hidden = true; };
    function icoOpen() {
      const r = $('aeIconFind').getBoundingClientRect();
      icoPop.hidden = false;
      const w = icoPop.offsetWidth;
      icoPop.style.left = Math.round(Math.min(Math.max(8, r.left), innerWidth - w - 8)) + 'px';
      icoPop.style.top = Math.round(r.bottom + 6) + 'px';
      $('icoGrid').textContent = '';
      $('icoNote').textContent = 'Type a word — rocket, deploy, tidy… '
        + 'Icons come from iconify.design; the one you pick is kept on this Mac.';
      // the action's name is usually the best first query
      const seed = window.nibIsIconName($('aeIcon').value.trim()) ? ''
        : ($('aeLabel').value.trim().split(/\s+/)[0] || '');
      $('icoSearch').value = seed;
      if (seed) icoSearch(seed);
      $('icoSearch').focus();
      $('icoSearch').select();
    }
    $('aeIconFind').onclick = (e) => {
      e.preventDefault();
      if (icoPop.hidden) icoOpen();
      else icoClose();
    };

    async function icoSearch(q) {
      const tok = ++icoTok;
      $('icoNote').textContent = 'Searching…';
      const r = await tiny.api.call('iconSearch', { query: q });
      if (tok !== icoTok || icoPop.hidden) return;
      const grid = $('icoGrid');
      grid.textContent = '';
      if (r && r.error) { $('icoNote').textContent = r.error; return; }
      const icons = (r && r.icons) || [];
      $('icoNote').textContent = icons.length ? '' : 'Nothing matches “' + q + '”';
      for (const ic of icons) {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = ic.name;
        b.appendChild(window.nibActIcon({ iconSvg: ic }));
        b.onclick = () => {
          $('aeIcon').value = ic.name;
          prevIcon();
          touch();
          icoClose();
        };
        grid.appendChild(b);
      }
    }
    $('icoSearch').addEventListener('input', () => {
      clearTimeout(icoTimer);
      const q = $('icoSearch').value.trim();
      if (!q) { $('icoGrid').textContent = ''; return; }
      icoTimer = setTimeout(() => icoSearch(q), 300);
    });
    $('icoSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); icoClose(); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = $('icoGrid').querySelector('button');
        if (first) first.click();
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (!icoPop.hidden && !icoPop.contains(e.target)
        && !$('aeIconFind').contains(e.target)) icoClose();
    });
    for (const id of ['aeNeeds', 'aeOutput', 'aeStdin']) $(id).addEventListener('change', touch);
    $('aeType').addEventListener('change', () => { applyType(); drawAsk(); touch(); });
    $('aeTools').addEventListener('change', () => { applyType(); touch(); });
    $('aeShell').addEventListener('change', () => { stash(); showArgv(); touch(); });
    for (const id of ['aeToolbar', 'aeSelection', 'aeApprove']) {
      $(id).addEventListener('change', touch);
    }
    for (const id of ['aeSaveFirst', 'aeConfirm']) $(id).addEventListener('change', touch);
    for (const box of $('aeOS').querySelectorAll('input')) {
      box.addEventListener('change', () => { touch(); drawOSTabs(); });
    }

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

    $('aeHelp').onclick = () => tiny.api.call('openHelp', { at: 'actions' });

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
      if (e.key === 'Escape') {
        e.preventDefault();
        // a picker popover catches the Escape the sheet would otherwise take
        const emo = document.getElementById('emojiPop');
        if (!ctxPop.hidden) { closeCtx(); return; }
        if (!icoPop.hidden) { icoClose(); return; }
        if (emo && !emo.hidden) { if (closeEmoji) closeEmoji(); return; }
        done();
      }
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
