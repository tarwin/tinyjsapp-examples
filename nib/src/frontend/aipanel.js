// The AI section of Settings: providers, keys, models, and the limits each
// provider is held to.
//
// It never sees a key after it is set. It sends one down and is told where it
// landed; from then on the row says "a key is saved" and offers to forget it.
// There is no read-back, so a page that got confused — or a page that got
// clever — has nothing to leak.
//
// The other half of AI — the sheet a model has to get past before it does
// anything — is aiask.js, and it lives in document windows rather than here,
// because that is where the question is asked and where the answer lands.

(() => {
  const TOOLS = [
    ['off', 'None — text only'],
    ['read', 'Read the open folder'],
    ['full', 'Read, write, run, make actions'],
  ];
  const APPROVE = [
    ['always', 'Before every tool'],
    ['writes', 'Before anything that changes something'],
    ['never', 'Never'],
  ];
  // The same two choices in the width a provider row can spare. The long
  // labels above are the general setting's, where there is room to explain.
  const TOOLS_SHORT = [['off', 'Nothing'], ['read', 'Read'], ['full', 'Read & write']];
  const APPROVE_SHORT = [['always', 'Always'], ['writes', 'On changes'], ['never', 'Never']];

  function setupAiPanel({ toast }) {
    // ---------------------------------------------------------- the panel

    let status = null;
    let host = null;                 // the section element Settings gave us

    async function refresh(redraw = true) {
      status = await tiny.api.call('aiStatus');
      if (redraw && host) draw();
      return status;
    }

    async function save(patch) {
      status = await tiny.api.call('aiSet', patch);
      draw();
    }

    // one row's worth of provider settings, patched without disturbing the rest
    const patchProvider = (id, bit) => save({ providers: { [id]: bit } });

    function draw() {
      if (!host || !status) return;
      host.textContent = '';

      host.appendChild(field('Use AI in Nib', check(status.enabled, (v) => save({ enabled: v }))));
      host.appendChild(hint('Nib’s AI is an action: a prompt with a name, in the ⚡ menu beside '
        + 'your commands and scripts. Off, nothing here is reached and nothing is sent.'));

      host.appendChild(head('Providers',
        'The one with the dot filled in is the default. A provider set to “on this machine” '
        + 'sends nothing anywhere.'));
      const box = document.createElement('div');
      box.className = 'aiprovs';
      for (const p of status.providers) box.appendChild(rowFor(p));
      host.appendChild(box);

      host.appendChild(head('What a model may do',
        'These are the general answers. Each provider above can be held to something '
        + 'narrower, and an action can ask for less — never for more.'));
      host.appendChild(field('Tools',
        select(TOOLS, status.tools, (v) => save({ tools: v }))));
      host.appendChild(hint({
        off: 'The safest setting, and enough for rewriting, summarising and drafting.',
        read: 'It can read and search files in the folder you have open. Anything outside '
          + 'it asks first, every time.',
        full: 'It can also write files, run commands and add actions. Every one of those '
          + 'asks first unless you turn asking off below.',
      }[status.tools]));
      host.appendChild(field('Ask me',
        select(APPROVE, status.approve, (v) => save({ approve: v }))));
      host.appendChild(hint({
        always: 'Every tool call, including reads. Noisy, and the right answer while you '
          + 'are working out whether you trust this.',
        writes: 'Reads inside the folder happen quietly; writing, running and reading '
          + 'anything outside the folder ask.',
        never: 'Nothing asks. Reasonable for a model on this machine working on your own '
          + 'notes — a poor idea with a cloud model and “full” tools, because a document '
          + 'you open can contain instructions aimed at it.',
      }[status.approve]));

      host.appendChild(hint(status.keyStore === 'store'
        ? 'This system’s keychain refused to hold a key, so keys are kept in Nib’s own '
          + 'settings file instead — readable by anything that can read your home folder.'
        : 'Keys are kept in the system keychain, not in Nib’s settings.'));
    }

    // ------------------------------------------------------- little builders

    function head(text, why) {
      const h = document.createElement('div');
      h.className = 'sethead';
      h.textContent = text;
      const wrap = document.createDocumentFragment();
      wrap.appendChild(h);
      if (why) wrap.appendChild(hint(why));
      return wrap;
    }

    function hint(text) {
      const el = document.createElement('div');
      el.className = 'ahint';
      el.textContent = text || '';
      return el;
    }

    // The same row shape Settings' own sections use, so the label column lines
    // up across every section rather than only within one.
    function field(label, control) {
      const row = document.createElement('label');
      row.className = 'setrow';
      const lab = document.createElement('span');
      lab.className = 'setlab';
      lab.textContent = label;
      const body = document.createElement('div');
      body.className = 'setctl';
      body.appendChild(control);
      row.append(lab, body);
      return row;
    }

    function check(on, onChange) {
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = !!on;
      el.onchange = () => onChange(el.checked);
      return el;
    }

    function select(pairs, value, onChange, extra) {
      const el = document.createElement('select');
      for (const [v, label] of (extra ? [extra, ...pairs] : pairs)) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label;
        el.appendChild(o);
      }
      el.value = value === null || value === undefined ? '' : value;
      el.onchange = () => onChange(el.value || null);
      return el;
    }

    function rowFor(p) {
      const el = document.createElement('div');
      el.className = 'aiprov' + (status.provider === p.id ? ' picked' : '')
        + (p.off ? ' isoff' : '');

      const top = document.createElement('div');
      top.className = 'aitop';

      // The default. A provider that is switched off can't be it, so its radio
      // goes with it rather than sitting there lying about what would happen.
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'aiprov';
      radio.checked = status.provider === p.id;
      radio.disabled = p.off;
      radio.title = 'Use this one by default';
      radio.onchange = () => save({ provider: p.id });
      top.appendChild(radio);

      const name = document.createElement('b');
      name.textContent = p.label;
      top.appendChild(name);

      if (p.local) {
        const tag = document.createElement('span');
        tag.className = 'ctag';
        tag.textContent = 'on this machine';
        top.appendChild(tag);
      }

      const dot = document.createElement('span');
      dot.className = 'aidot ' + (p.ok ? 'ok' : 'bad');
      dot.title = p.ok ? 'ready' : (p.why || '');
      top.appendChild(dot);

      // on/off for the provider itself — the row stays, so turning one back on
      // is where turning it off was
      const onoff = document.createElement('input');
      onoff.type = 'checkbox';
      onoff.className = 'aionoff';
      onoff.checked = !p.off;
      onoff.title = p.off ? 'Turn this provider on' : 'Turn this provider off';
      onoff.onchange = () => patchProvider(p.id, { off: !onoff.checked });
      top.appendChild(onoff);
      el.appendChild(top);

      if (p.off) return el;

      if (p.note || p.why) {
        const why = document.createElement('div');
        why.className = 'ahint';
        why.textContent = [p.ok ? null : p.why, p.note].filter(Boolean).join(' · ');
        el.appendChild(why);
      }

      const fields = document.createElement('div');
      fields.className = 'aifields';

      // Apple's provider has no address, no key and one model — that is its
      // whole appeal — so it goes straight to the limits.
      if (p.kind !== 'apple') {
        if (p.needsKey || p.hasKey) fields.appendChild(keyField(p));
        if (p.id === 'custom' || p.id === 'ollama' || p.id === 'lmstudio') {
          fields.appendChild(textField('Address', p.base, 'http://localhost:11434/v1',
            (v) => patchProvider(p.id, { base: v })));
        }
        fields.appendChild(modelField(p));
      }

      // The per-provider limits. "Anthropic may write, Ollama may only read"
      // is the sentence these two make, and it is a limit rather than a
      // preference: an action cannot argue its way past it.
      const lim = document.createElement('div');
      lim.className = 'ailimits';
      lim.appendChild(smallField('May', select(TOOLS_SHORT, p.tools,
        (v) => patchProvider(p.id, { tools: v }), ['', '— general —'])));
      lim.appendChild(smallField('Ask', select(APPROVE_SHORT, p.approve,
        (v) => patchProvider(p.id, { approve: v }), ['', '— general —'])));
      fields.appendChild(lim);

      el.appendChild(fields);
      return el;
    }

    function keyField(p) {
      const row = document.createElement('div');
      row.className = 'aifield';
      const lab = document.createElement('span');
      lab.textContent = 'Key';
      row.appendChild(lab);
      if (p.hasKey) {
        const have = document.createElement('span');
        have.className = 'aihave';
        have.textContent = 'saved';
        row.appendChild(have);
        const forget = document.createElement('button');
        forget.textContent = 'Forget';
        forget.onclick = async () => {
          await tiny.api.call('aiForgetKey', { provider: p.id });
          refresh();
        };
        row.appendChild(forget);
        return row;
      }
      const inp = document.createElement('input');
      inp.type = 'password';
      inp.spellcheck = false;
      inp.placeholder = p.keyHint || 'paste your key';
      inp.onchange = async () => {
        if (!inp.value.trim()) return;
        const r = await tiny.api.call('aiSetKey', { provider: p.id, key: inp.value.trim() });
        inp.value = '';
        if (r && r.where === 'store') toast('Saved — but not in the keychain (see below)');
        refresh();
      };
      row.appendChild(inp);
      if (p.keyUrl) {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = 'get one';
        a.onclick = (e) => { e.preventDefault(); tiny.app.shell.open(p.keyUrl); };
        row.appendChild(a);
      }
      return row;
    }

    // Model, with a list when the provider will tell us — for Ollama that is
    // the only way to know what has actually been pulled.
    function modelField(p) {
      const row = document.createElement('div');
      row.className = 'aifield';
      const lab = document.createElement('span');
      lab.textContent = 'Model';
      row.appendChild(lab);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.spellcheck = false;
      inp.value = p.model || '';
      inp.setAttribute('list', 'aimodels-' + p.id);
      inp.onchange = () => patchProvider(p.id, { model: inp.value.trim() });
      row.appendChild(inp);
      const dl = document.createElement('datalist');
      dl.id = 'aimodels-' + p.id;
      row.appendChild(dl);

      const list = document.createElement('button');
      list.textContent = 'List';
      list.onclick = async () => {
        list.disabled = true;
        list.textContent = '…';
        const r = await tiny.api.call('aiModels', { provider: p.id });
        list.disabled = false;
        list.textContent = 'List';
        if (!r || r.error) return toast(r ? r.error : 'no answer');
        dl.textContent = '';
        for (const m of r.models) {
          const o = document.createElement('option');
          o.value = m;
          dl.appendChild(o);
        }
        toast(r.models.length + ' model' + (r.models.length === 1 ? '' : 's') + ' — click the field');
        inp.focus();
      };
      row.appendChild(list);

      const test = document.createElement('button');
      test.textContent = 'Test';
      test.onclick = async () => {
        test.disabled = true;
        test.textContent = '…';
        const r = await tiny.api.call('aiTest', { provider: p.id });
        test.disabled = false;
        test.textContent = 'Test';
        toast(r && r.ok ? p.label + ' answered: ' + (r.text || '(nothing)')
          : (r && r.error) || 'no answer');
        refresh();
      };
      row.appendChild(test);
      return row;
    }

    function textField(label, value, placeholder, onSave) {
      const row = document.createElement('div');
      row.className = 'aifield';
      const lab = document.createElement('span');
      lab.textContent = label;
      row.appendChild(lab);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.spellcheck = false;
      inp.value = value || '';
      inp.placeholder = placeholder || '';
      inp.onchange = () => onSave(inp.value.trim());
      row.appendChild(inp);
      return row;
    }

    function smallField(label, control) {
      const row = document.createElement('div');
      row.className = 'aifield asmallf';
      const lab = document.createElement('span');
      lab.textContent = label;
      row.append(lab, control);
      return row;
    }

    return {
      // Settings hands us the section body; we own what goes in it.
      async renderInto(el) {
        host = el;
        await refresh(false);
        draw();
      },
      refresh: () => refresh(true),
      status: () => status,
    };
  }

  window.setupAiPanel = setupAiPanel;
})();
