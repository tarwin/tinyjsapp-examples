// Settings — its own window, with two tabs: Mine, and the open folder.
//
// The important thing about this file is what it ISN'T. It is not where the
// settings live and it is not a second way to change them: every control calls
// the same api the menu item calls, and the menu bar redraws because the
// BACKEND pushed. So the tick in View ▸ High Contrast and the switch in
// Settings ▸ Editor cannot disagree — they are two windows onto one value, and
// neither is the real one.
//
// Which is also why the menus stayed. A settings window is where you go to
// browse what an app can do; a menu is where you go when you already know, and
// an app that makes you open a window to toggle something you toggle ten times
// a day has traded one of those for the other and called it tidying up.
//
// THE TABS. Every setting is either YOURS or the PROJECT'S (main.js,
// PROJECT_PREFS — the test is whether it changes what gets written into the
// repo or what its platform renders). Mine shows everything; the folder tab
// shows only the project keys — markdown flavour, link writing, images —
// plus the folder's own switches. Where the folder's answers are STORED is
// one choice at the top of its tab: in `.nib/settings.json`, which travels
// with the folder into every clone, or in Nib's own settings on this Mac
// only. A row on the folder tab can also opt itself out of the shared file
// (the 📌 pin — "my answer, this Mac only") without changing it for anyone
// else. Rows always show what is in effect and where it came from; a row
// this tab set offers ↺, a row that inherits offers nothing to reset.

(() => {
  const $ = (id) => document.getElementById(id);

  const THEMES = [['paper', 'Paper'], ['ink', 'Ink'],
    ['typewriter', 'Typewriter'], ['night', 'Night']];
  const APPEARANCES = [['system', 'Match System'], ['light', 'Light'], ['dark', 'Dark']];
  const WIDTHS = [['narrow', 'Narrow'], ['normal', 'Normal'],
    ['wide', 'Wide'], ['full', 'Full']];
  const VIEWS = [['edit', 'Editor Only'], ['split', 'Split'], ['preview', 'Preview Only']];
  const FIND_HI = [['default', 'Default'], ['yellow', 'Marker Yellow'],
    ['green', 'Green'], ['pink', 'Pink'], ['orange', 'Orange']];
  const DESTS = [['beside', 'Beside the document'], ['sub', 'In a folder next to it'],
    ['root', 'In one folder at the project root']];
  const NAMINGS = [['heading', 'Document + heading'], ['doc', 'Document name'],
    ['stamp', 'Date and time'], ['custom', 'A template of my own']];
  const OPTIMIZE = [['off', 'Keep the original'], ['webp', 'Convert'],
    ['same', 'Re-encode, same format']];
  const LINK_FROM = [['rel', 'Relative to the document'], ['root', 'From the link root'],
    ['pin', 'From the pinned folder']];
  const LINK_SEP = [['chev', '›'], ['slash', '/'], ['dash', '–'], ['gt', '>']];

  const TAB_WHY = {
    mine: 'Yours, on this machine, in every folder. The answer everything else '
      + 'falls back to.',
    folder: 'This folder’s setup — markdown flavour, link writing, images. '
      + 'Saved in its own .nib/settings.json, so it TRAVELS: commit it and '
      + 'everyone who clones the repo gets it.',
    folderLocal: 'This folder’s setup — kept in Nib’s own settings, on this '
      + 'Mac only. Nothing is written inside the folder.',
  };

  // Rows that aren't settings paths at all: about this machine or the app.
  const MINE_ONLY = new Set(['appearance', 'zoom', 'ai', 'speech']);

  function setupSettings({ ai, toast }) {
    const side = $('setSide');
    const pane = $('setPane');
    let all = null;
    let section = 'general';
    let tab = 'mine';

    // ------------------------------------------------------------ the rows

    // `p` is the dotted path (layers.js); everything else follows from it —
    // the current value, who set it, and where a change goes. The Mine tab
    // shows MINE's answers (all.mine), not the effective ones: its controls
    // write to Mine, so they must show what Mine says — the folder-override
    // note explains the difference when there is one. The folder tab shows
    // what is in effect, which is what its controls edit.
    const val = (path) => {
      const src = tab === 'mine' && all.mine ? all.mine : all;
      const [head, key] = path.split('.');
      return key === undefined ? src[head] : src[head][key];
    };
    const prov = (path) => (all.from && all.from[path]) || { from: null, set: [] };
    // does the folder keep its settings IN the folder (.nib), or on this Mac?
    const owns = () => !!(all.folder && all.folder.inFolder);

    // Where a change made on this tab, to this row, actually goes. On the
    // folder tab that is the folder's storage — the shared file normally, the
    // this-Mac twin when the folder doesn't keep settings, and always the
    // this-Mac twin for a row that pinned itself there (the 📌), because
    // editing a value somewhere it wouldn't take effect is a trap.
    const writeLayerFor = (path) => {
      if (tab === 'mine') return 'mine';
      if (!owns()) return 'local';
      return prov(path).set.includes('local') ? 'local' : 'folder';
    };

    const set = async (path, value) => {
      await tiny.api.call('settingsSet', { layer: writeLayerFor(path), path, value });
      await load();
    };
    const reset = async (path) => {
      // undo what THIS tab is contributing: the winning layer of the pair
      const target = tab === 'mine' ? 'mine'
        : (prov(path).set.includes('local') ? 'local' : 'folder');
      await tiny.api.call('settingsClear', { layer: target, path });
      await load();
    };

    const SECTIONS = () => [
      { id: 'general', title: 'General', icon: '⚙', rows: [
        row('appearance', 'Appearance', pick(APPEARANCES, all.appearance,
          (v) => callPlain('setAppearance', { appearance: v })),
        'Nib’s own chrome. The preview has its own theme, under Preview.'),
        row('zoom', 'Zoom', pick([['0.9', '90%'], ['1', '100%'], ['1.1', '110%'],
          ['1.25', '125%'], ['1.5', '150%']], String(all.zoom),
        (v) => callPlain('setZoom', { zoom: +v })),
        'Every window. ⌘+ and ⌘− do it too.'),
        row('view', 'Opens in', pick(VIEWS, val('view'), (v) => set('view', v)),
          'What a newly opened document shows.'),
        row('speech', 'Dictation', all.speechPossible
          ? check(all.ai.speech, (v) => callPlain('aiSet', { speech: v }))
          : note('Not available — this build’s web engine has no speech recogniser.'),
        'Shows the 🎙 button (⌃⌘D). It types what you say at the caret and knows '
          + 'nothing about AI — tidying the words up afterwards is an ordinary action.'),
        row('prefs.allFiles', 'Show all files', check(val('prefs.allFiles'),
          (v) => set('prefs.allFiles', v)),
        'The file tree and ⌘P list files Nib can’t open, too.'),
      ] },

      { id: 'editor', title: 'Editor', icon: '✎', rows: [
        row('prefs.hc', 'High contrast', check(val('prefs.hc'), (v) => set('prefs.hc', v))),
        row('prefs.findColor', 'Find highlight',
          pick(FIND_HI, val('prefs.findColor'), (v) => set('prefs.findColor', v))),
        row('prefs.edWidth', 'Page width applies to the editor',
          check(val('prefs.edWidth'), (v) => set('prefs.edWidth', v)),
          'Otherwise Page Width only narrows the preview.'),
        row('prefs.linkPath', 'Heading links carry their path',
          check(val('prefs.linkPath'), (v) => set('prefs.linkPath', v)),
          'A link to a heading is written as the whole trail — H1 › H2 › SMS.'),
        row('prefs.linkSep', 'Joined by',
          pick(LINK_SEP, val('prefs.linkSep'), (v) => set('prefs.linkSep', v))),
        row('prefs.linkFrom', 'Paths written',
          pick(LINK_FROM, val('prefs.linkFrom'), (v) => set('prefs.linkFrom', v))),
      ] },

      { id: 'preview', title: 'Preview', icon: '👁', rows: [
        row('theme', 'Theme', pick(THEMES, val('theme'), (v) => set('theme', v)),
          'Follows the document everywhere it goes — print, PDF, exported HTML.'),
        row('prefs.width', 'Page width',
          pick(WIDTHS, val('prefs.width'), (v) => set('prefs.width', v))),
        row('prefs.paged', 'Page view', check(val('prefs.paged'), (v) => set('prefs.paged', v)),
          'The preview as sheets of paper on a desk.'),
        head('Markdown flavour', 'The extras over CommonMark — what this '
          + 'document’s destination can render. A preset writes them as a group.'),
        row('_presets', '', presets()),
        row('prefs.alerts', 'Alerts', check(val('prefs.alerts'), (v) => set('prefs.alerts', v)),
          '> [!NOTE] callouts'),
        row('prefs.math', 'Math', check(val('prefs.math'), (v) => set('prefs.math', v)),
          '$x$, $$…$$ and ```math'),
        row('prefs.mermaid', 'Mermaid diagrams',
          check(val('prefs.mermaid'), (v) => set('prefs.mermaid', v))),
        row('prefs.emojiCodes', 'Emoji shortcodes',
          check(val('prefs.emojiCodes'), (v) => set('prefs.emojiCodes', v)), ':tada: → 🎉'),
        row('prefs.footnotes', 'Footnotes',
          check(val('prefs.footnotes'), (v) => set('prefs.footnotes', v)), '[^1]'),
        row('prefs.hrBreaks', '“---” as a page break',
          check(val('prefs.hrBreaks'), (v) => set('prefs.hrBreaks', v))),
        row('prefs.carousel', 'Carousels',
          check(val('prefs.carousel'), (v) => set('prefs.carousel', v)),
          '::: carousel — images as a sideways strip'),
        row('prefs.download', 'Download cards',
          check(val('prefs.download'), (v) => set('prefs.download', v)),
          '::: download [Title](url)'),
        row('prefs.embed', 'Embeds',
          check(val('prefs.embed'), (v) => set('prefs.embed', v)),
          '::: embed <url> — YouTube, Vimeo, Spotify and friends'),
        row('prefs.pagelink', 'Page links',
          check(val('prefs.pagelink'), (v) => set('prefs.pagelink', v)),
          '::: pagelink [Title](./page) — a card that opens the page'),
        head('Rendering'),
        row('prefs.captions', 'Image captions',
          check(val('prefs.captions'), (v) => set('prefs.captions', v)),
          'Each picture’s alt text, printed underneath.'),
        row('prefs.center', 'Centre images',
          check(val('prefs.center'), (v) => set('prefs.center', v))),
        row('prefs.zoom', 'Click an image to zoom',
          check(val('prefs.zoom'), (v) => set('prefs.zoom', v))),
        row('prefs.linkTabs', 'Link tabs',
          check(val('prefs.linkTabs'), (v) => set('prefs.linkTabs', v))),
      ] },

      { id: 'images', title: 'Images & Paths', icon: '🖼', rows: [
        head('Where a pasted or dropped picture goes'),
        row('images.dest', 'Put it', pick(DESTS, val('images.dest'), (v) => set('images.dest', v))),
        val('images.dest') !== 'beside'
          ? row('images.folder', 'Folder called',
            text(val('images.folder'), 'images', (v) => set('images.folder', v)))
          : null,
        head('What it is called'),
        row('images.naming', 'Name it after',
          pick(NAMINGS, val('images.naming'), (v) => set('images.naming', v)),
          'The heading your caret is under is what makes a screenshot under '
          + '“Installing on macOS” become guide-installing-on-macos-1.png.'),
        val('images.naming') === 'custom'
          ? row('images.template', 'Template',
            text(val('images.template'), '{doc}-{heading}', (v) => set('images.template', v)),
            '{doc} {heading} {name} {date} {time} {dir} {dir2}… {path} {pin} {pintop} '
            + '{pinpath} — each one slugged, unknown ones dropped.')
          : null,
        head('On the way in'),
        row('images.optimize', 'Optimise',
          pick(OPTIMIZE, val('images.optimize'), (v) => set('images.optimize', v)),
          'Decode, redraw at a capped width, re-encode — in the page, since no '
          + 'native tool exists on all three platforms. SVG and animated GIF are '
          + 'never touched, and a re-encode that comes out bigger is thrown away.'),
        val('images.optimize') !== 'off'
          ? row('images.maxWidth', 'Widest side',
            number(val('images.maxWidth'), 0, 8000, (v) => set('images.maxWidth', v)),
            '0 means don’t scale.')
          : null,
        val('images.optimize') !== 'off'
          ? row('images.quality', 'Quality',
            number(val('images.quality'), 30, 100, (v) => set('images.quality', v)))
          : null,
        head('What a leading “/” means',
          'Two questions, not one: a site with its sources in src/ may write '
          + '[home](/index.md) meaning src/index.md and ![](/images/logo.png) meaning '
          + 'src/assets/images/logo.png. Both are relative to the open folder.'),
        row('images.imageRoot', 'Images from',
          text(val('images.imageRoot'), 'the folder itself', (v) => set('images.imageRoot', v))),
        row('images.linkRoot', 'Links from',
          text(val('images.linkRoot'), 'the folder itself', (v) => set('images.linkRoot', v))),
      ] },

      { id: 'keys', title: 'Shortcuts', icon: '⌨️', custom: (el) => drawShortcuts(el) },

      { id: 'ai', title: 'AI', icon: '✨', custom: (el) => ai.renderInto(el) },

      { id: 'actions', title: 'Actions', icon: '⚡', rows: [
        row(null, '', button('Manage Actions…', () => {
          tiny.api.call('openActionEditor');
        }), 'The actions file as a form — what each button runs, when it is '
          + 'available, what happens to what it prints. It opens on a document window.'),
        row(null, '', button('Reload from disk', async () => {
          const r = await tiny.api.call('actionsReload');
          toast(r ? r.count + ' action' + (r.count === 1 ? '' : 's') : 'reloaded');
        })),
        head('Approved folder actions',
          'What you have said yes to in a folder’s own actions file. Taking one '
          + 'back means it asks again next time.'),
        row(null, '', trustList()),
      ] },

    ].filter(Boolean);

    // The project's own switches — the first section of the Project tab.
    // WHICH folder the tab means leads, name and full path, because the tab
    // itself only says "Project"; then the storage choice, because it is what
    // the whole tab MEANS: the same answers either travel in `.nib` or stay
    // on this Mac.
    const folderSection = () => ({ id: 'folder', title: 'Project', icon: '📁', rows: [
      whichFolder(),
      row(null, 'Save settings in the folder', check(owns(),
        (v) => callPlain('setProjectSettings', { on: v })),
      'On: this tab writes .nib/settings.json, which travels with the folder — '
        + 'commit it and everyone gets this setup. Off: the same answers are '
        + 'kept in Nib’s own settings, on this Mac only, and Nib never writes '
        + 'anything inside the folder. Remembered per folder.'),
      row(null, 'Pinned folders', check(all.folder.pinsOn,
        (v) => callPlain('setPinsOn', { on: v })),
      'Pins scope where a document’s images and links are resolved from.'),
      owns() ? row(null, '', button('Edit .nib/settings.json…',
        () => tiny.api.call('editFolderSettings'))) : null,
    ].filter(Boolean) });

    // Which folder "Project" is — the name big, the whole path under it,
    // since the name alone can be anything ("docs", "v2-final-FINAL").
    function whichFolder() {
      const el = document.createElement('div');
      el.className = 'setwhich';
      const name = document.createElement('b');
      name.textContent = '📁 ' + all.folder.name;
      const path = document.createElement('div');
      path.className = 'ahint setpath';
      path.textContent = all.folder.root;
      el.append(name, path);
      return el;
    }

    // Anything not routed through a layer: it is app-wide by nature.
    const callPlain = async (name, params) => {
      await tiny.api.call(name, params);
      await load();
    };

    // ------------------------------------------------------ little builders

    function row(path, label, control, hint) {
      const el = document.createElement('div');
      el.className = 'setrow' + (label ? '' : ' nolabel');
      if (path) el.dataset.path = path;     // the folder tab filters on this
      if (label) {
        const lab = document.createElement('span');
        lab.className = 'setlab';
        lab.textContent = label;
        el.appendChild(lab);
      }
      const body = document.createElement('div');
      body.className = 'setctl';
      const line = document.createElement('div');
      line.className = 'setline';
      line.appendChild(control);

      // Where this value came from. A row this tab set gets a ↺; a row that
      // inherits says from where, because a control that looks editable while
      // something else is answering is a trap.
      if (path && path !== '_presets' && !MINE_ONLY.has(path)) {
        const p = prov(path);
        const tag = document.createElement('span');
        tag.className = 'setfrom';
        if (tab === 'mine') {
          // On Mine there is nothing underneath to inherit FROM, so holding a
          // key means nothing on its own — what matters is whether it differs
          // from the built-in default.
          if (val(path) !== all.defaults[path]) {
            tag.classList.add('here');
            tag.textContent = 'set here';
            const undo = document.createElement('button');
            undo.className = 'setreset';
            undo.textContent = '↺';
            undo.title = 'Back to the default';
            undo.onclick = () => reset(path);
            line.appendChild(tag);
            line.appendChild(undo);
          }
          // A project key the open folder answers: your row is the DEFAULT,
          // not the value in effect. Say so — that is the model in one line.
          if (p.from === 'folder' || p.from === 'local') {
            el.classList.add('overridden');
            const o = document.createElement('div');
            o.className = 'ahint setover';
            o.textContent = '📁 ' + (all.folder ? all.folder.name : 'The folder')
              + ' is answering this right now — your setting here is the '
              + 'default for folders that don’t.';
            body.appendChild(line);
            body.appendChild(o);
            el.appendChild(body);
            if (hint) {
              const h = document.createElement('div');
              h.className = 'ahint';
              h.textContent = hint;
              body.appendChild(h);
            }
            return el;
          }
        } else {
          const onLocal = p.set.includes('local');
          const onFolder = p.set.includes('folder');
          if (onLocal || onFolder) {
            tag.classList.add('here');
            tag.textContent = onLocal ? 'this Mac' : 'set here';
            const undo = document.createElement('button');
            undo.className = 'setreset';
            undo.textContent = '↺';
            undo.title = onLocal
              ? (onFolder ? 'Back to the folder’s answer' : 'Back to your default')
              : 'Back to your default';
            undo.onclick = () => reset(path);
            line.appendChild(tag);
            line.appendChild(undo);
          } else {
            tag.textContent = 'from Mine';
            line.appendChild(tag);
          }
          // The escape hatch: keep ONE answer out of the shared file without
          // giving up sharing. Only offered while the file is shared at all.
          if (owns()) {
            const pin = document.createElement('button');
            pin.className = 'setpin' + (onLocal ? ' on' : '');
            pin.textContent = '📌';
            pin.title = onLocal
              ? 'Pinned to this Mac — click to share it again'
                + (onFolder ? ' (the folder’s answer comes back)' : '')
              : 'Keep this answer on this Mac only — never written into the folder';
            pin.onclick = async () => {
              if (onLocal) await tiny.api.call('settingsClear', { layer: 'local', path });
              else await tiny.api.call('settingsSet', { layer: 'local', path, value: val(path) });
              await load();
            };
            line.appendChild(pin);
          }
        }
      }
      body.appendChild(line);
      if (hint) {
        const h = document.createElement('div');
        h.className = 'ahint';
        h.textContent = hint;
        body.appendChild(h);
      }
      el.appendChild(body);
      return el;
    }

    function head(text, hint) {
      const el = document.createElement('div');
      el.className = 'setgroup';
      const h = document.createElement('div');
      h.className = 'sethead';
      h.textContent = text;
      el.appendChild(h);
      if (hint) {
        const p = document.createElement('div');
        p.className = 'ahint';
        p.textContent = hint;
        el.appendChild(p);
      }
      return el;
    }

    function check(on, onChange) {
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = !!on;
      el.onchange = () => onChange(el.checked);
      return el;
    }

    function pick(pairs, value, onChange) {
      const el = document.createElement('select');
      for (const [v, label] of pairs) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label;
        el.appendChild(o);
      }
      el.value = value;
      el.onchange = () => onChange(el.value);
      return el;
    }

    function text(value, placeholder, onChange) {
      const el = document.createElement('input');
      el.type = 'text';
      el.spellcheck = false;
      el.value = value || '';
      el.placeholder = placeholder || '';
      el.onchange = () => onChange(el.value);
      return el;
    }

    function number(value, min, max, onChange) {
      const el = document.createElement('input');
      el.type = 'number';
      el.min = min;
      el.max = max;
      el.value = value;
      el.className = 'setnum';
      el.onchange = () => onChange(+el.value);
      return el;
    }

    function button(label, onClick) {
      const el = document.createElement('button');
      el.className = 'setbtn';
      el.textContent = label;
      el.onclick = onClick;
      return el;
    }

    function note(text) {
      const el = document.createElement('span');
      el.className = 'ahint';
      el.textContent = text;
      return el;
    }

    function presets() {
      const wrap = document.createElement('span');
      wrap.className = 'setpresets';
      for (const [id, label] of [['github', 'GitHub'], ['commonmark', 'CommonMark'],
        ['nib', 'Everything']]) {
        wrap.appendChild(button(label, async () => {
          await tiny.api.call('setFlavor', { flavor: id, layer: writeLayerFor('prefs.math') });
          await load();
        }));
      }
      return wrap;
    }

    // ------------------------------------------------------------ shortcuts
    //
    // Every menu accelerator, remappable. Yours alone (a folder has no
    // business rebinding your keys), so this only ever appears on Mine.
    // Recording writes what AppKit accelerators can spell: ⌘x, ⇧⌘X, ⌥⌘x —
    // anything else is refused out loud rather than silently not binding.
    async function drawShortcuts(el) {
      // both a keymapSet and the settings-refresh it pushes redraw this pane;
      // the token lets whichever fetch finishes last be the only one drawing
      const tok = (drawShortcuts.tok = (drawShortcuts.tok || 0) + 1);
      el.textContent = 'Reading…';
      const km = await tiny.api.call('keymapAll');
      if (drawShortcuts.tok !== tok || !el.isConnected) return;
      el.textContent = '';

      const presetSel = document.createElement('select');
      const presetName = new Map(km.presets);
      // Edited keys mean the map is no longer any preset's — say so, as a
      // selected "Custom" entry, rather than leaving a preset name up that is
      // quietly no longer true. It is a state, not a choice: picking a real
      // preset below is how you leave it (and that forgets the edits).
      if (km.customCount) {
        const o = document.createElement('option');
        o.value = '_custom';
        o.textContent = 'Custom — ' + (presetName.get(km.preset) || km.preset)
          + ' + ' + km.customCount + (km.customCount === 1 ? ' change' : ' changes');
        presetSel.appendChild(o);
      }
      for (const [v, label] of km.presets) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label;
        presetSel.appendChild(o);
      }
      presetSel.value = km.customCount ? '_custom' : km.preset;
      presetSel.onchange = async () => {
        if (presetSel.value === '_custom') return;   // the state, re-picked
        await tiny.api.call('keymapPreset', { preset: presetSel.value });
        drawShortcuts(el);
      };
      el.appendChild(row(null, 'Preset', presetSel,
        'A starting point, not a cage — pick your old editor, then change any '
        + 'key below on its own (the preset then reads Custom). Choosing a '
        + 'preset starts fresh and forgets your per-key changes.'));

      // What the chosen preset actually rebinds, spelled out — because "I
      // picked VS Code and nothing happened" is the right outcome for a
      // preset that matches Nib's defaults, and the pane should say so.
      const diffs = km.commands.filter((c) => (c.def || null) !== (c.base || null));
      const say = document.createElement('div');
      say.className = 'ahint keydiff';
      say.textContent = diffs.length
        ? (presetName.get(km.preset) || km.preset) + ' changes: ' + diffs.map((c) =>
          c.label + ' ' + (c.def ? window.nibKey(c.def) : 'unbound')).join(' · ')
        : (km.preset === 'nib' ? ''
          : (presetName.get(km.preset) || km.preset) + ' binds these the same way '
            + 'Nib already does — picking it changes nothing.');
      if (say.textContent) el.appendChild(say);

      // who holds which key, for saying "that's taken" inline
      const byKey = new Map();
      for (const c of km.commands) {
        if (c.key) byKey.set(c.key, [...(byKey.get(c.key) || []), c]);
      }

      let recording = null;                    // the chip currently listening
      const record = (c, chip) => {
        if (recording) recording.done();
        chip.classList.add('recording');
        chip.textContent = 'press keys…';
        const done = () => {
          removeEventListener('keydown', onKey, true);
          chip.classList.remove('recording');
          recording = null;
        };
        const onKey = async (e) => {
          if (['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) return;
          e.preventDefault();
          e.stopPropagation();
          done();
          if (e.key === 'Escape') { drawShortcuts(el); return; }
          if (e.key === 'Backspace' || e.key === 'Delete') {
            await tiny.api.call('keymapSet', { id: c.id, key: null });
            drawShortcuts(el);
            return;
          }
          const isMac = /Mac/.test(navigator.platform || '');
          if (!(isMac ? e.metaKey : e.ctrlKey)) {
            toast('Shortcuts are ' + (isMac ? '⌘' : 'Ctrl') + '-combinations');
            drawShortcuts(el);
            return;
          }
          let ch = e.key.length === 1 ? e.key : '';
          if (!/^[a-zA-Z0-9,]$/.test(ch)) {
            toast('That key can’t be an accelerator here');
            drawShortcuts(el);
            return;
          }
          if (/[a-z]/i.test(ch)) ch = e.shiftKey ? ch.toUpperCase() : ch.toLowerCase();
          const key = (e.altKey ? 'alt+' : '') + ch;
          const r = await tiny.api.call('keymapSet', { id: c.id, key });
          if (r && r.error) toast(r.error);
          drawShortcuts(el);
        };
        recording = { done };
        addEventListener('keydown', onKey, true);
      };

      for (const c of km.commands) {
        const line = document.createElement('div');
        line.className = 'setrow keyrow';
        const lab = document.createElement('span');
        lab.className = 'setlab';
        lab.textContent = c.label;
        const body = document.createElement('div');
        body.className = 'setctl';
        const ctl = document.createElement('div');
        ctl.className = 'setline';
        const where = document.createElement('span');
        where.className = 'ahint keypath';
        where.textContent = c.path;
        const chip = document.createElement('button');
        chip.className = 'keychip' + (c.key ? '' : ' none');
        chip.textContent = c.key ? window.nibKey(c.key) : 'none';
        chip.title = 'Click, then press the keys — Backspace unbinds, esc keeps it';
        chip.onclick = () => record(c, chip);
        ctl.append(where, chip);
        if (c.custom) {
          const undo = document.createElement('button');
          undo.className = 'setreset';
          undo.textContent = '↺';
          undo.title = 'Back to ' + (c.def ? window.nibKey(c.def) : 'unbound');
          undo.onclick = async () => {
            await tiny.api.call('keymapSet', { id: c.id, key: c.def });
            drawShortcuts(el);
          };
          ctl.appendChild(undo);
        }
        const twin = (byKey.get(c.key) || []).find((o) => o.id !== c.id);
        body.appendChild(ctl);
        if (twin) {
          const warn = document.createElement('div');
          warn.className = 'ahint keyclash';
          warn.textContent = window.nibKey(c.key) + ' is also ' + twin.label
            + ' — one of them won’t fire';
          body.appendChild(warn);
        }
        line.append(lab, body);
        el.appendChild(line);
      }
    }

    function trustList() {
      const box = document.createElement('div');
      box.className = 'settrust';
      box.textContent = 'Reading…';
      tiny.api.call('actionsTrusted').then((rows) => {
        box.textContent = '';
        if (!rows || !rows.length) {
          box.appendChild(note('Nothing approved yet.'));
          return;
        }
        for (const r of rows) {
          const el = document.createElement('div');
          el.className = 'settrustrow';
          const name = document.createElement('b');
          name.textContent = r.label || r.id;
          const what = document.createElement('code');
          what.textContent = (r.summary || '').slice(0, 90);
          const where = document.createElement('span');
          where.className = 'ahint';
          where.textContent = r.root || '';
          const drop = document.createElement('button');
          drop.textContent = 'Revoke';
          drop.onclick = async () => {
            await tiny.api.call('actionRevoke', { key: r.key });
            draw();
          };
          el.append(name, what, where, drop);
          box.appendChild(el);
        }
      });
      return box;
    }

    // ------------------------------------------------------------- drawing

    function drawTabs() {
      const box = $('setTabs');
      box.textContent = '';
      const tabs = [['mine', 'Mine', TAB_WHY.mine]];
      // Two tabs, not three: where the folder's answers are STORED (shared
      // .nib or this Mac) is a switch on its tab, not a tab of its own.
      // The label is the fixed word — a folder's name is an unbounded string
      // that would wear the tab as a hat; WHICH folder is answered inside,
      // at the top of the Project section, with the full path.
      if (all.folder) {
        tabs.push(['folder', 'Project',
          '📁 ' + all.folder.root + '\n'
            + (owns() ? TAB_WHY.folder : TAB_WHY.folderLocal)]);
      }
      for (const [name, label, why] of tabs) {
        const b = document.createElement('button');
        b.className = 'settab' + (name === tab ? ' on' : '');
        b.textContent = label;
        b.title = why;
        b.onclick = () => { tab = name; draw(); };
        box.appendChild(b);
      }
    }

    // The sections the ACTIVE tab shows. Mine shows everything; the folder
    // tab leads with its own switches, then only the sections and rows that
    // hold project keys — pruned from the same definitions, so each row
    // exists once and cannot disagree with itself between tabs.
    function sectionsFor() {
      const list = SECTIONS();
      if (tab === 'mine') return list;
      const keep = new Set([...(all.projectKeys || []), '_presets']);
      const out = [folderSection()];
      for (const s of list) {
        if (s.custom) continue;
        const rows = [];
        let pendingHead = null;      // a group heading earns its place only
        for (const r of s.rows) {    // if a kept row follows it
          if (!r) continue;
          if (r.classList.contains('setgroup')) { pendingHead = r; continue; }
          if (r.dataset.path && keep.has(r.dataset.path)) {
            if (pendingHead) { rows.push(pendingHead); pendingHead = null; }
            rows.push(r);
          }
        }
        if (rows.length) out.push({ ...s, rows });
      }
      return out;
    }

    function drawSide(sections) {
      side.textContent = '';
      for (const s of sections) {
        const el = document.createElement('button');
        el.className = 'setnav' + (s.id === section ? ' on' : '');
        const ico = document.createElement('span');
        ico.className = 'setnavico';
        ico.textContent = s.icon;
        const lab = document.createElement('span');
        lab.textContent = s.title;
        el.append(ico, lab);
        el.onclick = () => { section = s.id; draw(); };
        side.appendChild(el);
      }
    }

    function draw() {
      if (!all) return;
      if (tab === 'folder' && !all.folder) tab = 'mine';
      drawTabs();
      const sections = sectionsFor();
      const s = sections.find((x) => x.id === section) || sections[0];
      section = s.id;
      drawSide(sections);
      pane.textContent = '';

      $('setScope').textContent = tab === 'mine' ? TAB_WHY.mine
        : (owns() ? TAB_WHY.folder : TAB_WHY.folderLocal);
      const foot = $('setNote');
      foot.textContent = tab === 'mine' ? 'Writing to your settings'
        : owns()
          ? 'Writing to ' + all.folder.name + '/.nib/settings.json — travels with the folder'
          : 'Kept on this Mac — nothing is written inside ' + all.folder.name;
      // Only the folder tab can be emptied — clearing Mine would just be
      // "restore all defaults", which is a different promise.
      if (tab === 'folder' && countSetHere()) {
        const clear = document.createElement('button');
        clear.className = 'setclear';
        clear.textContent = 'Clear all ' + countSetHere() + ' on this tab';
        clear.title = 'Every setting here falls back to your defaults — shared '
          + 'and this-Mac answers both';
        clear.onclick = async () => {
          await tiny.api.call('settingsClearLayer', { layer: 'folder' });
          await tiny.api.call('settingsClearLayer', { layer: 'local' });
          await load();
          toast('Cleared — ' + all.folder.name + ' now inherits everything');
        };
        foot.appendChild(document.createTextNode('  '));
        foot.appendChild(clear);
      }

      if (s.custom) { s.custom(pane); return; }
      for (const r of s.rows) if (r) pane.appendChild(r);
    }

    // How many settings the folder actually holds, either way it stores them
    // — what the footer offers to clear, and the honest size of "this folder
    // overrides things".
    function countSetHere() {
      if (!all.from) return 0;
      return Object.values(all.from)
        .filter((p) => p.set.includes('folder') || p.set.includes('local')).length;
    }

    async function load() {
      all = await tiny.api.call('settingsAll');
      draw();
    }

    // The menus stay live while this window is open, so anything that changes
    // out from under it reloads the view.
    // 'settings-refresh' is the backend saying the world changed shape —
    // a value written elsewhere, or the focused scope crossing between a
    // folder window and a bare one, which adds or removes whole tabs.
    for (const ev of ['doc-prefs', 'doc-theme', 'doc-view', 'appearance',
      'ui-zoom', 'actions', 'ai-config', 'project', 'settings-refresh']) {
      tiny.api.on(ev, () => load());
    }
    tiny.api.on('settings-section', ({ section: want, layer: wantLayer }) => {
      if (want) section = want;
      if (wantLayer) tab = wantLayer === 'mine' ? 'mine' : 'folder';
      load();
    });

    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'w')) {
        e.preventDefault();
        tiny.win.close();
      }
    }, true);

    load();
    return { load };
  }

  // Light / Dark / Match System — the shared helper in appearance.js, which
  // every window uses and which also stamps the answer before first paint.
  let appearance = 'system';
  window.nibAppearance = async (a) => {
    appearance = a || 'system';
    await window.nibApplyAppearance(appearance);
  };
  // the OS switching under us, and the setting changing in another window
  tiny.theme.on(() => { if (appearance === 'system') window.nibAppearance('system'); });
  tiny.api.on('appearance', ({ appearance: a }) => window.nibAppearance(a));

  // The window's own toast, since it has no document to borrow one from.
  let toastTimer = null;
  window.nibToast = (text) => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  };

  window.setupSettings = setupSettings;
})();
