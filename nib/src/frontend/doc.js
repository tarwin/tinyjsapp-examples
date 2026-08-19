// One document WINDOW, holding one or more documents as tabs. The backend
// told us who we are (api.boot → the showing document plus the window's tab
// list); from here on this page owns the textarea, the preview, and the
// save/close choreography. Menu events are broadcast to every window, so
// everything gates on document.hasFocus() — only the key window acts.
//
// The backend is the store of every open document's text (it has to be: that's
// what survives a window dying dirty), so switching tabs is: flush what's on
// screen, ask for the other one, put it up. The page keeps only what the
// backend has no business knowing — where the caret was and how far each tab
// was scrolled.

(async () => {
  const $ = (id) => document.getElementById(id);
  const ed = $('ed'), preview = $('preview'), previewPane = $('previewPane');

  // ------------------------------------------------------------------ state

  const boot = await tiny.api.call('boot');
  setupZoom(boot.zoom);            // ⌘+ / ⌘− / ⌥⌘0 — the whole UI, every window
  let { theme, view } = boot;
  let sheetId = boot.sheet.id;
  let path = boot.sheet.path;
  let name = boot.sheet.name;
  // 'doc' or 'image' — a picture opens in a tab like anything else, and shows
  // a viewer where the two panes would be. `previewing` is the VS Code tab
  // that hasn't been committed to; anything you do on purpose ends it.
  let kind = boot.sheet.kind || 'doc';
  let previewing = !!boot.sheet.preview;
  let savedText = boot.sheet.savedText;
  let dirty = false;
  let docDir = path ? path.slice(0, path.lastIndexOf('/')) : null;
  const imgCache = new Map();          // src -> Promise<dataUri|null>
  const history = setupHistory();      // per-sheet undo/redo over buffer diffs
  // An .adoc sheet renders through adoc.js's line-preserving mapping and is
  // never editable in the preview (the round-trip would write Markdown into
  // an AsciiDoc file). Everything else about a doc sheet applies.
  let sheetConfig = (boot.sheet && boot.sheet.config) || null;
  const isAdoc = () => /\.(adoc|asciidoc)$/i.test(path || '');
  // JSON (the folder's own settings file, mostly) is source, not Markdown:
  // the preview shows it as one highlighted code block and never edits it
  const isJson = () => /\.json$/i.test(path || '');
  const renderSrc = () =>
    (isAdoc() && window.adocToMarkdown ? window.adocToMarkdown(ed.value)
      : isJson() ? '````json\n' + ed.value + '\n````' : ed.value);
  const escRow = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|heic|tiff?)$/i;
  // What the native pickers offer ({ types } filters, tinyjs 0.35) — mirrors
  // the backend's OPENABLE and IMAGES sets.
  const DOC_TYPES = ['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'mdwn', 'mdtxt', 'mdtext',
    'mdx', 'qmd', 'rmd', 'mdc', 'adoc', 'asciidoc', 'txt', 'json'];
  const IMG_TYPES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic', 'tiff'];
  const baseName = (p) => String(p || '').split('/').pop();
  // A target as it has to be WRITTEN. A path with a space or a parenthesis in
  // it — `Screen Shot 2026.png`, `image (14).png` — only survives inside
  // <angle brackets>; anything else is written plainly.
  const mdTarget = (p) => (/[\s()<>]/.test(p) ? '<' + p + '>' : p);
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const seen = new Map();              // sheetId -> { sel, edScroll, pvScroll }
  // find.js's two surfaces, built further down (they need the peer sync), and
  // the search hit that arrived before the document it belongs to
  let find = null;
  let pendingGoto = null;
  let pendingAnchor = null;

  ed.value = boot.sheet.text;
  history.open(sheetId, ed.value);     // the boot sheet skips loadSheet — its
                                       // history has to start here
  ed.setSelectionRange(0, 0);          // open at the top, not the end

  // ------------------------------------------------------------- appearance

  // Light / Dark / Match System, app-wide (View ▸ Appearance). 'system' is
  // resolved here rather than in CSS so every rule can key off one concrete
  // data-appearance — see the note at the top of doc.css.
  let appearance = boot.appearance || 'system';
  // Resolving Light / Dark / Match System — and remembering the answer, so
  // the next window opens already knowing (appearance.js).
  async function applyAppearance(a) {
    appearance = a || 'system';
    await window.nibApplyAppearance(appearance);
  }
  tiny.theme.on(() => { if (appearance === 'system') applyAppearance('system'); });
  tiny.api.on('appearance', ({ appearance: a }) => applyAppearance(a));

  // ------------------------------------------------------------------ theme

  const themeStyle = document.createElement('style');
  document.head.appendChild(themeStyle);
  const themePick = $('themePick');
  for (const [id, t] of Object.entries(THEMES)) {
    themePick.add(new Option(t.label, id));
  }

  function applyTheme(t) {
    if (!THEMES[t]) return;
    theme = t;
    themeStyle.textContent = MD_BASE_CSS + THEMES[t].css;
    themePick.value = t;
    previewPane.style.background = getComputedStyle(preview).backgroundColor;
    paintDesk();
    paintFindColors();   // the default find wash follows the theme's darkness
    decorate();          // mermaid diagrams re-colour to match the new theme
  }

  // Page View's desk: the theme's own page colour, dimmed — so Paper gets a
  // grey desk and Night a darker one, and both keep their sheets legible.
  const previewBgParts = () =>
    (getComputedStyle(preview).backgroundColor.match(/\d+/g) || ['255', '255', '255']).slice(0, 3).map(Number);
  const previewIsDark = () => {
    const [r, g, b] = previewBgParts();
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  };
  function paintDesk() {
    document.body.style.setProperty('--desk',
      'rgb(' + previewBgParts().map((c) => Math.round(c * 0.72)).join(',') + ')');
  }

  // Find's highlight colours (Find ▸ Find Highlight). 'default' derives from
  // the accent, with more weight on a dark page so it still carries; the
  // named ones are deliberately loud, tuned to read on light AND dark.
  const FIND_COLORS = {
    yellow: { hi: 'rgba(255, 214, 10, .55)', cur: '#ffd60a', fg: '#000' },
    green:  { hi: 'rgba(50, 215, 75, .5)',   cur: '#28cd41', fg: '#000' },
    pink:   { hi: 'rgba(255, 55, 95, .45)',  cur: '#ff2d55', fg: '#fff' },
    orange: { hi: 'rgba(255, 149, 0, .55)',  cur: '#ff9500', fg: '#000' },
  };
  function paintFindColors() {
    const b = document.body.style;
    const c = FIND_COLORS[prefs.findColor];
    if (c) {
      b.setProperty('--find-hi', c.hi);
      b.setProperty('--find-cur', c.cur);
      b.setProperty('--find-cur-fg', c.fg);
    } else {
      b.setProperty('--find-hi',
        `color-mix(in srgb, var(--accent) ${previewIsDark() ? '46%' : '34%'}, transparent)`);
      b.setProperty('--find-cur', 'var(--accent)');
      b.setProperty('--find-cur-fg', '#fff');
    }
    // High Contrast forces the preview's text to full strength against ITS
    // OWN page — the theme may be dark while the app is light
    b.setProperty('--md-hc-fg', previewIsDark() ? '#fff' : '#000');
  }

  themePick.onchange = () => tiny.api.call('setTheme', { theme: themePick.value });
  tiny.api.on('doc-theme', ({ theme: t }) => applyTheme(t));

  // ---------------------------------------------------- reading preferences
  //
  // Page width, image captions and click-to-zoom (Preview ▸). All three are
  // app-wide like the theme, and all three are expressed as one class or one
  // custom property on the article — which is why they survive Export as HTML
  // and Save as PDF for free: those take a clone of this very element.

  let prefs = {
    width: 'normal', captions: false, zoom: false, center: false, linkTabs: false,
    hrBreaks: false, allFiles: false, linkPath: false, linkSep: 'chev', linkFrom: 'rel',
    ...(boot.prefs || {}),
  };

  function applyPrefs(p) {
    const hrWas = !!prefs.hrBreaks;
    const allWas = !!prefs.allFiles;
    const was = {};
    for (const k of ['alerts', 'emojiCodes', 'footnotes', 'math', 'mermaid',
      'carousel', 'download', 'embed', 'pagelink']) was[k] = !!prefs[k];
    prefs = { ...prefs, ...p };
    preview.classList.toggle('cap', !!prefs.captions);
    preview.classList.toggle('zoom', !!prefs.zoom);
    preview.classList.toggle('mid', !!prefs.center);
    const w = (PAGE_WIDTH[prefs.width] || PAGE_WIDTH.full)[1];
    document.body.style.setProperty('--pw', w);
    // what Page View's sheet wants to be: the page width, except Full
    // Width means paper-sized rather than edge-to-edge
    document.body.style.setProperty('--pgw', w === 'none' ? '816px' : w);
    // Page Width ▸ Apply to Editor — the source column narrows to match.
    // Full Width has nothing to apply, so the toggle rests then.
    const ew = prefs.edWidth && w !== 'none' ? w : '';
    document.body.toggleAttribute('data-edpw', !!ew);
    if (ew) document.body.style.setProperty('--edpw', ew);
    if (!prefs.zoom) hideLightbox();
    // "---" as Page Break and the Markdown Flavor toggles are the renderer's
    // preferences, not CSS — flipping any of them means a fresh parse
    const flavorMoved = ['alerts', 'emojiCodes', 'footnotes', 'math', 'mermaid',
      'carousel', 'download', 'embed', 'pagelink']
      .some((k) => !!prefs[k] !== was[k]);
    if (!!prefs.hrBreaks !== hrWas || flavorMoved) { flushLive(); render(); }
    if (!!prefs.allFiles !== allWas) tree.paint();      // hide/show the others
    document.body.toggleAttribute('data-paged', !!prefs.paged);
    document.body.toggleAttribute('data-hc', !!prefs.hc);
    paintDesk();
    paintFindColors();
    paintFilesHead();                           // the 👁 toggle mirrors allFiles
  }
  tiny.api.on('doc-prefs', (p) => applyPrefs(p));
  // opening or closing a folder can change the view mode too (a project keeps
  // its own), and that arrives as its own push rather than a fresh boot
  tiny.api.on('doc-view', ({ view: v }) => { if (v !== view) setView(v, false); });

  // ------------------------------------------------------------------- view

  // A JSON file has no second view worth having: the "preview" was the source
  // again inside a code block, which is a picture of what you are already
  // looking at. So JSON locks the window to Editor Only — the buttons grey
  // out, the View menu's other two go with them, and the mode you actually
  // chose is remembered untouched and comes back with the next Markdown tab.
  const viewLocked = () => isJson();

  // `fresh` means a sheet is being loaded and the preview already holds its
  // DOM — the same promise applyEditable's own `fresh` makes, and for the same
  // reason: serializing here would write the outgoing document over this one.
  function paintView(fresh) {
    const shown = viewLocked() ? 'edit' : view;
    document.body.dataset.view = shown;
    // [data-view] only: the ✎ Editable toggle lives inside the switcher too,
    // and its on/disabled states are applyEditable's to manage, not ours.
    for (const b of document.querySelectorAll('#views button[data-view]')) {
      b.classList.toggle('on', b.dataset.view === shown);
      b.disabled = viewLocked();
    }
    $('views').classList.toggle('locked', viewLocked());
    $('views').title = viewLocked() ? 'A JSON file is edited as source' : '';
    tiny.api.call('setViewLock', { on: viewLocked(), json: isJson() });
    if (kind === 'doc') applyEditable(false, fresh);
  }

  function setView(v, persist) {
    view = v;
    paintView();
    tiny.api.call('setView', { view: v, persist: !!persist });
  }
  for (const b of document.querySelectorAll('#views button[data-view]')) {
    b.onclick = () => { if (!viewLocked()) setView(b.dataset.view, true); };
  }
  // re-assert on focus so the View menu's ticks follow the active window
  window.addEventListener('focus', () => {
    tiny.api.call('setView', { view, persist: false });
    tiny.api.call('setOutline', { on: outlineOn, persist: false });
    tiny.api.call('setEditable', { on: editableOn, enabled: view !== 'edit', persist: false });
    tiny.api.call('setFilesPanel', { on: filesOn });
  });

  // ---------------------------------------------------------------- the tabs
  //
  // Files opened from inside this window — the tree, Open Quickly, a link —
  // land here rather than in a window of their own. The strip hides itself
  // when only one document is open.

  const tabstrip = $('tabstrip');
  let tabs = (boot.tabs && boot.tabs.tabs) || [];

  function paintTabs(payload) {
    if (payload) {
      tabs = payload.tabs;
      if (payload.active) sheetId = payload.active;
    }
    tabstrip.textContent = '';
    tabstrip.hidden = !tabs.length;      // one file still gets its tab
    for (const t of tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (t.id === sheetId ? ' on' : '') + (t.dirty ? ' dirty' : '')
                   + (t.preview ? ' preview' : '');
      el.title = (t.path || t.name) + (t.preview ? ' — preview (double-click to keep)' : '');
      el.draggable = true;
      const nm = document.createElement('span');
      nm.className = 'tname';
      nm.textContent = t.name;
      const dot = document.createElement('span');
      dot.className = 'tdot';
      dot.textContent = '●';
      const x = document.createElement('span');
      x.className = 'tx';
      x.textContent = '✕';
      x.title = 'Close tab';
      x.onclick = (e) => { e.stopPropagation(); closeTab(t.id); };
      el.append(nm, dot, x);
      el.onclick = () => showSheet(t.id);
      el.ondblclick = () => promote(t.id);           // keep this preview tab
      el.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } };

      // drag to reorder, within this window only
      el.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('drag');
        promote(t.id);              // arranging a tab is deciding to keep it
      };
      el.ondragend = () => {
        el.classList.remove('drag');
        for (const n of tabstrip.children) n.classList.remove('over');
      };
      el.ondragover = (e) => { e.preventDefault(); el.classList.add('over'); };
      el.ondragleave = () => el.classList.remove('over');
      el.ondrop = (e) => {
        e.preventDefault();
        el.classList.remove('over');
        const from = e.dataTransfer.getData('text/plain');
        if (!from || from === t.id) return;
        const order = tabs.map((x2) => x2.id).filter((id) => id !== from);
        order.splice(order.indexOf(t.id), 0, from);
        tiny.api.call('reorderSheets', { order });
      };
      tabstrip.appendChild(el);
    }
  }
  tiny.api.on('tabs', (p) => paintTabs(p));

  // Promotion: the tab stops being the disposable one. Anything deliberate
  // does it — a real edit, a double-click on the row or the tab, dragging it.
  // The backend is the authority on which sheets are previews, so this doesn't
  // consult the local tab list: during a load that list is a beat behind.
  function promote(id) {
    if (id && id !== sheetId) { tiny.api.call('promoteSheet', { id }); return; }
    if (!previewing) return;
    previewing = false;
    tiny.api.call('promoteSheet', { id: sheetId });
  }

  // A rename elsewhere (the tree) reaches the sheets that were showing it.
  tiny.api.on('sheet-path', (s) => {
    if (s.id !== loadedId) return;
    path = s.path;
    name = s.name;
    docDir = path ? path.slice(0, path.lastIndexOf('/')) : null;
    tree.showing(path);
    setDirty();                                  // the title carries the name
    if (kind === 'image') showImage(path);
  });

  // Put a document on screen. Everything derived from "which document is this"
  // is reset here — the source, the preview, the images' base directory, the
  // banner — and the outgoing one's caret and scroll are kept so coming back
  // to a tab feels like returning, not reopening.
  // `loadedId` is what is ON SCREEN, and only this function moves it. sheetId
  // can be reassigned by a tabs push that arrives before the switch completes,
  // which is exactly how the outgoing document's caret went missing.
  let loadedId = boot.sheet.id;

  function loadSheet(s) {
    if (loadedId && loadedId !== s.id && kind === 'doc') {
      seen.set(loadedId, {
        sel: [ed.selectionStart, ed.selectionEnd],
        edScroll: ed.scrollTop, pvScroll: previewPane.scrollTop,
      });
    }
    const fromTree = document.activeElement === $('files');
    if (loadedId && kind === 'doc') history.record(ed.value);   // flush the old sheet
    loadedId = s.id;
    sheetId = s.id;
    path = s.path;
    name = s.name;
    kind = s.kind || 'doc';
    sheetConfig = s.config || null;              // one of Nib's own JSON files?
    previewing = !!s.preview;
    savedText = s.savedText;
    docDir = path ? path.slice(0, path.lastIndexOf('/')) : null;
    imgCache.clear();                            // a different folder entirely
    ed.value = s.text || '';
    history.open(s.id, ed.value);                // its own history, from here
    const was = seen.get(s.id);
    ed.setSelectionRange(...(was ? was.sel : [0, 0]));
    $('banner').hidden = !s.restored;
    hideProblems();                              // they belonged to the last tab
    if (s.restored && !path) $('btnRevert').hidden = true;
    tree.showing(path);
    applyKind();
    setDirty();
    if (kind === 'doc') {
      render();
      applyEditable(false, true);        // adoc sheets drop the Editable mode
    }
    updateStatus();
    lockSync(300);                               // don't let the restore scroll drive
    ed.scrollTop = was ? was.edScroll : 0;
    edBack.scrollTop = ed.scrollTop;
    previewPane.scrollTop = was ? was.pvScroll : 0;
    paintTabs();
    // Find follows the tab: a picture has nothing to search, and a document
    // has to be searched again — the offsets belonged to the last one.
    if (kind === 'image') find.close();
    else find.refresh();
    if (pendingGoto && pendingGoto.path === path) {
      const g = pendingGoto;
      pendingGoto = null;
      applyGoto(g);
      return;                                    // it owns the caret, and the focus
    }
    if (pendingAnchor && pendingAnchor.path === path) {
      const g = pendingAnchor;
      pendingAnchor = null;
      applyAnchor(g);
      return;                                    // same claim, by heading
    }
    // Browsing the tree with the arrow keys must not yank the keyboard out of
    // it on every preview — that would make the second arrow press go nowhere.
    if (fromTree) tree.focus();
    else if (kind === 'image') { /* nothing to type into */ }
    else if (editing()) preview.focus(); else ed.focus();
  }

  // ------------------------------------------------------------ the picture
  //
  // Images ride the same rails as documents (a tab, a rename, a recent entry);
  // they just have nothing to edit. The bytes come from the backend as a data:
  // URI — the same route the preview's own images take, so WebKit is never
  // pointed at file:// itself.
  const imageShow = $('imageShow');
  let imageToken = 0;

  function applyKind() {
    document.body.dataset.kind = kind;
    $('imagePane').hidden = kind !== 'image';
    document.body.removeAttribute('data-zoom1');
    if (kind === 'image') showImage(path);
    else { imageShow.removeAttribute('src'); imageToken++; }
    paintView(true);
  }

  const niceBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB'
    : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' bytes');

  async function showImage(p) {
    const mine = ++imageToken;
    const meta = $('imageMeta');
    const old = $('imageMissing');
    if (old) old.remove();
    meta.textContent = 'Loading…';
    imageShow.hidden = false;
    const [got, info] = await Promise.all([
      tiny.api.call('imageData', { src: p }),
      tiny.api.call('fileInfo', { path: p }),
    ]);
    if (mine !== imageToken) return;             // another tab won the race
    const size = info && info.bytes ? niceBytes(info.bytes) : '';
    if (!got || !got.data) {
      imageShow.hidden = true;
      const note = document.createElement('div');
      note.id = 'imageMissing';
      note.textContent = size
        ? `Nib can’t show this one (${size}). Right-click it in Files to open it elsewhere.`
        : 'That picture has moved or can’t be read.';
      $('imageWrap').appendChild(note);
      meta.textContent = base(p) + (size ? ' · ' + size : '');
      return;
    }
    imageShow.src = got.data;
    imageShow.alt = base(p);
    const say = () => {
      const dim = imageShow.naturalWidth
        ? `${imageShow.naturalWidth} × ${imageShow.naturalHeight}` : '';
      meta.textContent = [base(p), dim, size].filter(Boolean).join(' · ');
    };
    imageShow.decode ? imageShow.decode().then(say, say) : (imageShow.onload = say);
  }

  const base = (p) => (p || '').split('/').pop();

  // fit ⇄ 1:1, the only two zoom levels a viewer this size needs
  $('imageZoom').onclick = () => {
    const on = document.body.toggleAttribute('data-zoom1');
    $('imageZoom').textContent = on ? 'Fit to Window' : 'Actual Size';
  };
  $('imageWrap').onclick = () => $('imageZoom').click();
  // A push can in principle land before this file has finished setting itself
  // up (loadSheet reaches for the tree and the backdrop, declared further
  // down), so anything early waits for the end of the boot sequence.
  let booted = false, pendingSheet = null;
  tiny.api.on('show-sheet', (s) => { if (booted) loadSheet(s); else pendingSheet = s; });

  async function showSheet(id) {
    if (id === sheetId) return;
    flushLive();
    clearTimeout(syncTimer);
    await syncNow();                             // the backend owns the text
    const s = await tiny.api.call('showSheet', { id });
    if (s) loadSheet(s);
  }

  function stepTab(by) {
    const i = tabs.findIndex((t) => t.id === sheetId);
    if (i < 0 || tabs.length < 2) return;
    showSheet(tabs[(i + by + tabs.length) % tabs.length].id);
  }

  // ------------------------------------------------------------- the project
  //
  // A folder opened with File ▸ Open Folder… shows up here as a file tree on
  // the left (the outline having moved to the right), plus two ways to reach a
  // file without it: Open Quickly (⌘P) and typing @ in the document. The
  // backend owns the folder and pushes the whole tree; this window only draws.

  let filesOn = false;
  async function pickFolder() {
    const dir = await tiny.dialog.pickFolder();
    if (dir) tiny.api.call('openFolder', { path: dir });
  }

  // Renaming is the backend's job (it owns the tree, the open sheets and the
  // recent lists); all this end does is report what came back — and then ask
  // the second question, which is what to do about the documents still
  // pointing at the old name.
  async function renameNode(node, name) {
    const r = await tiny.api.call('renameEntry', { path: node.path, name });
    if (r && r.error) { toast(r.error); return; }
    if (!r || !r.ok) return;
    toast('Renamed to ' + r.name);
    await offerRefs(r.from || node.path, r.path);
  }

  // The other half of a rename. It's a question rather than a side effect
  // because rewriting six documents you can't see is not something an editor
  // should do quietly — and the answer is per rename, not a preference,
  // because "no" is a real answer when the old name was the published one.
  //
  // Pictures count as much as documents: `![shot](old.png)` is the same link.
  async function offerRefs(from, to) {
    if (!from || from === to) return;
    let scan;
    try { scan = await tiny.api.call('scanRefs', { from, to }); } catch { return; }
    if (!scan || !scan.total) return;
    const docs = scan.files.length;
    const shown = scan.files.slice(0, 8)
      .map((f) => '• ' + f.rel + (f.count > 1 ? '  (' + f.count + ')' : '') + (f.dirty ? '  — unsaved' : ''));
    if (docs > shown.length) shown.push('…and ' + (docs - shown.length) + ' more');
    const dirty = scan.files.some((f) => f.dirty);
    const ok = await tiny.dialog.confirm(
      `Update ${plural(scan.total, 'link')} to “${baseName(to)}”?`, {
        detail: `${plural(docs, 'document')} in this folder still point at “${baseName(from)}”.\n\n`
          + shown.join('\n')
          + (dirty ? '\n\nUnsaved documents are edited in place, not written to disk — save them to keep it.' : ''),
        ok: 'Update Links', cancel: 'Leave Them',
      });
    if (!ok) return;
    const r = await tiny.api.call('updateRefs', { from, to });
    if (r && r.changed) toast(`Updated ${plural(r.total, 'link')} in ${plural(r.changed, 'document')}`);
  }

  const tree = setupFiles({
    nav: $('files'), title: $('filesTitle'), tree: $('tree'),
    // One click previews, a double-click (or ⌘⏎) keeps it — see openDoc in
    // the backend for what "preview" costs and buys.
    onOpen: (node, opts) => {
      // a file Nib can't open goes to the system's app, like a followed link
      if (node.kind === 'other') return tiny.api.call('openLink', { href: node.path });
      return tiny.api.call('openPaths', { paths: [node.path], preview: !!(opts && opts.preview) });
    },
    showAll: () => !!prefs.allFiles,
    onShowAll: () => tiny.api.call('setPref', { key: 'allFiles', value: true }),
    onChoose: pickFolder,                       // the panel's own empty state
    onRename: renameNode,
    onMenu: (node, x, y) => showTreeMenu(node, x, y),
    onPin: (node, state) => tiny.api.call('setPin', { path: node.path, state }),
    onEscape: () => { if (editing()) preview.focus(); else ed.focus(); },
  });

  // Both sidebars have a draggable width, remembered app-wide. --filw/--outw
  // still swing to 0 when a pane closes; the -open twins hold the real width
  // so the inner content keeps its shape through the fade.
  const PANE_DEF = { files: 232, outline: 218 };
  const clampPane = (w) =>
    Math.round(Math.min(Math.max(w, 120), Math.max(160, Math.min(600, innerWidth / 2))));
  const paneW = { ...PANE_DEF };
  for (const k of ['files', 'outline']) {
    const w = boot.paneW && +boot.paneW[k];
    if (w) paneW[k] = clampPane(w);
    document.body.style.setProperty(k === 'files' ? '--filw-open' : '--outw-open', paneW[k] + 'px');
  }

  function setFiles(on) {
    filesOn = !!on;
    document.body.toggleAttribute('data-files', filesOn);
    document.body.style.setProperty('--filw', filesOn ? paneW.files + 'px' : '0px');
    $('btnFiles').classList.toggle('on', filesOn);
    tiny.api.call('setFilesPanel', { on: filesOn });
  }
  $('btnFiles').onclick = () => setFiles(!filesOn);

  // The two switches at the top of the folder view: whether the pins scope
  // search right now (they keep their places either way), and whether files
  // Nib can't open are in the tree — the same tick as View ▸ Show All Files.
  function paintFilesHead() {
    const has = tree.has();
    const pinned = has && Object.keys(tree.pins()).length > 0;
    const tp = $('tgPins'), ta = $('tgAll');
    tp.hidden = ta.hidden = !has;
    tp.disabled = !pinned;
    tp.classList.toggle('on', pinned && tree.pinsOn());
    tp.title = !pinned ? 'No folder is pinned for search — right-click one in the tree'
      : tree.pinsOn() ? 'Search is scoped to the pinned folders — click to search everything'
        : 'Pins are off — click to scope search to the pinned folders again';
    ta.classList.toggle('on', !!prefs.allFiles);
  }
  $('tgPins').onclick = () => tiny.api.call('setPinsOn', { on: !tree.pinsOn() });
  $('tgAll').onclick = () => tiny.api.call('setPref', { key: 'allFiles', value: !prefs.allFiles });

  function applyProject(p) {
    tree.set(p, path);
    if (!p) {                                   // you closed the folder
      setFiles(false);
      showSearch(false);
      search.clear();
    } else {
      if (!filesOn) setFiles(true);             // a folder just opened: show it
      search.refresh();                         // its files may have moved
    }
    paintFilesHead();
  }
  tiny.api.on('project', (p) => applyProject(p));
  // the heading index lands a beat after the folder — the backend builds it
  // in the background and pushes it here when it's done
  tiny.api.on('project-heads', (h) => tree.setHeads(h));

  // ---------------------------------------------------- the tree's own menu
  //
  // Right-click a row. Everything here is something you'd otherwise leave the
  // app to do — rename it, find it on disk, or point at it from the document
  // you're writing, which is the whole reason a Markdown editor wants a tree.

  const ctx = $('ctx');
  const REVEAL = { macos: 'Reveal in Finder', windows: 'Show in Explorer' };
  const revealLabel = () => REVEAL[tiny.system.os()] || 'Show in File Manager';

  function hideCtx() { ctx.hidden = true; ctx.textContent = ''; }
  addEventListener('mousedown', (e) => { if (!ctx.hidden && !ctx.contains(e.target)) hideCtx(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtx(); }, true);
  addEventListener('blur', hideCtx);

  async function showTreeMenu(node, x, y) {
    const items = [];
    const add = (label, fn) => items.push({ label, fn });
    if (!node.dir) {
      if (node.kind !== 'other') add(node.kind === 'image' ? 'Open Picture' : 'Open', () =>
        tiny.api.call('openPaths', { paths: [node.path] }));
      // Only offer to write a link if there's something to write it into.
      if (kind === 'doc') {
        add(node.kind === 'image' ? 'Insert Picture Here' : 'Insert Link Here',
            () => insertNodeLink(node));
      }
      if (node.kind === 'image' && !OPT_EXCLUDE.test(node.path)) {
        add('Optimize Picture…', () => openOptimizer([node.path]));
      }
    }
    if (node.dir) {
      // pinning starts here; the badge on the row is where it changes and ends
      const pinned = tree.pins()[node.path];
      add(pinned ? 'Unpin from Search' : 'Pin for Search',
          () => tiny.api.call('setPin', { path: node.path, state: pinned ? null : 'all' }));
      const imgs = tree.files().filter((f) => f.kind === 'image'
        && !OPT_EXCLUDE.test(f.path) && f.path.startsWith(node.path + '/'));
      if (imgs.length) {
        add('Optimize ' + (imgs.length === 1 ? 'the Picture' : imgs.length + ' Pictures') + ' Here…',
            () => openOptimizer(imgs.map((f) => f.path)));
      }
    }
    add('Rename…', () => tree.rename(node));
    items.push({ sep: true });
    add(revealLabel(), () => tiny.app.shell.reveal(node.path));
    add('Copy Path', () => tiny.clipboard.write({ text: node.path }));
    const root = tree.root();
    if (root && node.path.startsWith(root + '/')) {
      add('Copy Relative Path', () =>
        tiny.clipboard.write({ text: node.path.slice(root.length + 1) }));
    }
    // …and whatever runs on THIS file. Asked fresh rather than filtered here,
    // because whether an action applies (needs, match, os) is the backend's
    // word — one implementation, not two that drift.
    if (!node.dir) {
      const acts = await actions.forFile(node.path);
      if (acts.length) {
        items.push({ sep: true });
        for (const a of acts) add(a.label, a.run);
      }
    }

    ctx.textContent = '';
    const head = document.createElement('div');
    head.className = 'chead';
    head.textContent = node.name;
    ctx.appendChild(head);
    for (const it of items) {
      const el = document.createElement('div');
      if (it.sep) { el.className = 'csep'; ctx.appendChild(el); continue; }
      el.className = 'citem';
      el.textContent = it.label;
      el.onclick = () => { hideCtx(); it.fn(); };
      ctx.appendChild(el);
    }
    // measured, then nudged back on screen — a menu opened near the bottom
    // right of the window would otherwise hang off it
    ctx.hidden = false;
    ctx.style.left = '0px';
    ctx.style.top = '0px';
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.round(Math.min(x, innerWidth - w - 8)) + 'px';
    ctx.style.top = Math.round(Math.min(y, innerHeight - h - 8)) + 'px';
  }

  const palette = setupPalette({
    box: $('palette'), input: $('paletteInput'),
    list: $('paletteList'), hint: $('paletteHint'),
  });

  // ------------------------------------------------------------ search pins
  //
  // A pinned folder (tree context menu; the badge cycles what it covers)
  // scopes every file search — ⌘P, the @-picker, Find in Folder. The rule:
  // the closest pin above this document answers for it; a document under no
  // pin sees every pinned folder of the right kind together; no pins at all
  // means the whole project. Docs and pictures resolve separately, so
  // assets/ can be pinned for pictures while notes/ is pinned for Markdown.
  function pinScopeFor(kind) {
    if (!tree.pinsOn()) return null;            // parked by the master switch
    const pins = tree.pins();
    const dirs = Object.keys(pins).filter((d) => pins[d] === 'all' || pins[d] === kind);
    if (!dirs.length) return null;
    const above = dirs.filter((d) => path && path.startsWith(d + '/'));
    if (above.length) return [above.sort((a, b) => b.length - a.length)[0]];
    return dirs;
  }
  // the palettes take the filter and wear the label, so a shortened list
  // always says why it is short
  function pinView() {
    const docs = pinScopeFor('docs'), images = pinScopeFor('images');
    if (!docs && !images) return { files: (fs) => fs, label: '' };
    const root = tree.root();
    const short = (s) => s.map((d) => d.slice(root.length + 1) + '/').join(', ');
    const under = (scope, p) => !scope || scope.some((d) => p.startsWith(d + '/'));
    const label = docs && images && String(docs) === String(images)
      ? '📌 ' + short(docs)
      : [docs && '📌 ' + short(docs), images && '🖼 ' + short(images)].filter(Boolean).join(' · ');
    return {
      files: (fs) => fs.filter((f) => under(f.kind === 'image' ? images : docs, f.path)),
      label,
    };
  }

  // ⌘P — every openable document in the project, matched over its whole
  // path; type > and the same box lists every COMMAND instead (⌘⇧P opens it
  // with the > already typed). It opens with no folder too now, saying
  // plainly that file search has nothing to find there — because > still
  // has everything to offer.
  async function quickOpen(seed) {
    const has = tree.has();
    const pin = has ? pinView() : { files: (fs) => fs, label: '' };
    // fresh each open: the menu is the registry, and its enabled/checked
    // states are the moment's
    const commands = await tiny.api.call('commands').catch(() => null);
    palette.open({
      // pictures open too now — they get a viewer instead of an editor; with
      // Show All Files on, the rest are searchable too and open system-side
      files: has
        ? pin.files(tree.files().filter((f) => f.kind !== 'other' || prefs.allFiles))
        : [],
      heads: has ? tree.heads() : null,
      commands,
      prefill: seed || '',
      placeholder: has ? 'Open quickly — name, folder, or both…'
        : 'Type > for commands…',
      emptyText: has ? 'No matching files'
        : 'No folder is open, so there are no files to find — > lists every command',
      hintText: has
        ? (pin.label ? pin.label + ' · ' : '')
          + 'spaces match anywhere · ⇥ headings · > commands · ⏎ to open · esc to dismiss'
        : 'No folder is open — > lists every command',
      pick: (f) => {
        // a command runs like the menu click it stands for: this window's
        // half here, the backend's half through runCommand — both, exactly
        // as a real click fires both
        if (f.cmd) { menuAct(f.cmd.id); tiny.api.call('runCommand', { id: f.cmd.id }); return; }
        // a heading lands ON the heading, the way a search hit does
        if (f.head) {
          tiny.api.call('openAt', {
            path: f.path, line: f.head.line, col: 0, len: 0, preview: false });
          return;
        }
        if (f.path === path) return;
        if (f.kind === 'other') { tiny.api.call('openLink', { href: f.path }); return; }
        tiny.api.call('openPaths', { paths: [f.path] });
      },
    });
  }

  // ---------------------------------------------------------------- outline

  let outlineOn = !!boot.outline;
  const outlineBox = $('outlineInner');
  let olinks = [];

  function setOutline(on, persist) {
    outlineOn = on;
    document.body.toggleAttribute('data-outline', on);
    document.body.style.setProperty('--outw', on ? paneW.outline + 'px' : '0px');
    $('btnOutline').classList.toggle('on', on);
    tiny.api.call('setOutline', { on, persist: !!persist });
    if (on) markOutline();
  }
  $('btnOutline').onclick = () => setOutline(!outlineOn, true);

  // Rebuilt from the rendered preview after every render — the headings there
  // carry both an anchor id and the source line they came from, so one click
  // can move the preview and the editor's caret together.
  function buildOutline() {
    const keepScroll = outlineBox.scrollTop;
    const heads = [...preview.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    outlineBox.textContent = '';
    olinks = [];

    const h = document.createElement('h2');
    h.textContent = 'Outline';
    outlineBox.appendChild(h);

    if (!heads.length) {
      const p = document.createElement('div');
      p.id = 'outlineEmpty';
      p.textContent = 'No headings yet. Start a line with # to make one.';
      outlineBox.appendChild(p);
      return;
    }
    for (const el of heads) {
      const link = document.createElement('div');
      link.className = 'olink';
      link.dataset.level = el.tagName[1];
      link.textContent = el.textContent;
      link.title = el.textContent;
      link.onclick = () => gotoHeading(el);
      outlineBox.appendChild(link);
      olinks.push({ link, el });
    }
    outlineBox.scrollTop = keepScroll;
    markOutline();
  }

  function gotoHeading(el) {
    peer.reveal(el);                                 // it may be inside a tab
    lockSync(400);                                   // don't let scroll-sync fight us
    previewPane.scrollTop += el.getBoundingClientRect().top
      - previewPane.getBoundingClientRect().top - 8;
    const ln = +el.dataset.line;
    if (!isNaN(ln)) {
      const lines = ed.value.split('\n');
      const at = lines.slice(0, ln).reduce((n, l) => n + l.length + 1, 0);
      ed.setSelectionRange(at, at + (lines[ln] || '').length);
      ed.scrollTop = (ln / Math.max(1, lines.length)) * (ed.scrollHeight - ed.clientHeight);
      if (view === 'edit' || view === 'split') ed.focus();
      updateStatus();
    }
    markOutline();
  }

  // the entry for wherever the preview is parked, highlighted
  let markPending = false;
  function markOutline() {
    if (!outlineOn || !olinks.length || markPending) return;
    markPending = true;
    requestAnimationFrame(() => {
      markPending = false;
      const top = previewPane.getBoundingClientRect().top + 12;
      let active = 0;
      olinks.forEach(({ el }, k) => {
        if (el.getBoundingClientRect().top <= top) active = k;
      });
      olinks.forEach(({ link }, k) => link.classList.toggle('on', k === active));
    });
  }
  previewPane.addEventListener('scroll', markOutline);

  // ---------------------------------------------------------------- render

  // ------------------------------------------------ flavor extras (decorate)
  //
  // md.js renders math and mermaid as data-text islands with their source
  // showing; this pass swaps in the real thing — MathML from Temml, SVG from
  // Mermaid — and folds the emojibase shortcode preset over emoji.js's
  // keyword map. All three are vendored files that load on FIRST USE only,
  // so a document without a formula or diagram never pays for them. Results
  // cache by source text: the keystroke-by-keystroke re-renders reuse them.

  const loadScript = (src) => new Promise((res) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res(true);
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
  let temmlP = null;
  const loadTemml = () => (temmlP ||= (() => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'vendor/temml.css';
    document.head.appendChild(l);
    return loadScript('vendor/temml.min.js');
  })());
  let mermaidP = null;
  const loadMermaid = () => (mermaidP ||= loadScript('vendor/mermaid.min.js'));
  let emojiP = null;
  const loadEmojiCodes = () => (emojiP ||= loadScript('vendor/emoji-github.js').then((ok) => {
    if (ok && window.EMOJI_CODES_GITHUB) {
      // the preset is authoritative; the keyword map fills its gaps
      window.emojiByCode = { ...window.emojiByCode, ...window.EMOJI_CODES_GITHUB };
    }
    return ok;
  }));

  const mathCache = new Map();           // 'B|I' + tex  -> MathML
  const mmCache = new Map();             // diagram text -> SVG
  let mmThemeKey = null;                 // cache dies when the theme changes
  let mmSeq = 0;
  let decorateGen = 0;

  // Mermaid's 'base' theme, coloured from whatever the preview theme computes
  // to — so Paper gets ink-on-paper diagrams and Night gets night ones.
  function mermaidVars() {
    const st = getComputedStyle(preview);
    const num = (c) => (String(c).match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    const F = num(st.color), B = num(st.backgroundColor);
    const mix = (k) => 'rgb(' + B.map((v, i2) => Math.round(v + (F[i2] - v) * k)).join(',') + ')';
    return {
      background: 'rgb(' + B.join(',') + ')',
      primaryColor: mix(0.08), primaryTextColor: st.color, primaryBorderColor: mix(0.45),
      secondaryColor: mix(0.14), tertiaryColor: mix(0.05),
      lineColor: mix(0.6), textColor: st.color,
      noteBkgColor: mix(0.1), noteTextColor: st.color, noteBorderColor: mix(0.35),
      fontFamily: st.fontFamily, fontSize: '13px',
    };
  }

  async function decorate() {
    const gen = ++decorateGen;

    // the shortcode preset arriving is worth one fresh parse — names the
    // keyword map didn't know become emoji too
    if (prefs.emojiCodes && !window.EMOJI_CODES_GITHUB) {
      loadEmojiCodes().then((ok) => { if (ok && gen === decorateGen) render(); });
    }

    const maths = [...preview.querySelectorAll('.math')];
    if (maths.length && prefs.math) {
      if (!window.temml) await loadTemml();
      if (gen !== decorateGen) return;
      for (const el of maths) {
        if (!el.isConnected) continue;
        const tex = el.dataset.text || '';
        const block = el.classList.contains('mblock');
        const key = (block ? 'B' : 'I') + '\u0000' + tex;
        let html = mathCache.get(key);
        if (html == null && window.temml) {
          try { html = window.temml.renderToString(tex, { displayMode: block }); }
          catch { html = null; }
          if (html != null) mathCache.set(key, html);
        }
        if (html != null) { el.innerHTML = html; el.classList.add('mathml'); }
        else el.classList.add('math-err');
      }
    }

    // ::: embed islands — the backend answers (and caches) the oEmbed
    // lookup; the page builds its own element around the answer. DOM built
    // by hand, never innerHTML: title and author are the provider's text.
    const embeds = [...preview.querySelectorAll('.oemb:not(.oemb-done)')];
    if (embeds.length && prefs.embed) {
      for (const el of embeds) {
        const url = el.dataset.url || '';
        const r = await tiny.api.call('oembedGet', { url });
        if (gen !== decorateGen) return;
        if (!el.isConnected) continue;
        el.classList.add('oemb-done');
        const box = el.querySelector(':scope > .oemb-box');
        if (!box || !r) continue;
        if (r.iframe) {
          const f = document.createElement('iframe');
          f.src = r.iframe;
          f.loading = 'lazy';
          f.allowFullscreen = true;
          f.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
          f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation');
          if (r.title) f.title = r.title;
          f.style.aspectRatio = r.width && r.height ? r.width + ' / ' + r.height : '16 / 9';
          box.textContent = '';
          box.appendChild(f);
        } else if (r.image) {
          const img = document.createElement('img');
          img.src = r.image;
          if (r.title) img.alt = r.title;
          box.textContent = '';
          box.appendChild(img);
        } else if (r.card) {
          const a = document.createElement('a');
          a.className = 'oemb-card';
          a.href = url;
          const line = (cls, text) => {
            if (!text) return;
            const d = document.createElement('div');
            d.className = cls;
            d.textContent = text;
            a.appendChild(d);
          };
          line('oemb-prov', r.provider);
          line('oemb-t', r.title || url);
          line('oemb-by', r.author);
          box.textContent = '';
          box.appendChild(a);
        } else {
          el.classList.add('oemb-err');    // the link stays up, and says why
        }
      }
    }

    const mms = [...preview.querySelectorAll('.mm')];
    if (mms.length && prefs.mermaid) {
      if (!window.mermaid) await loadMermaid();
      if (gen !== decorateGen || !window.mermaid) return;
      const vars = mermaidVars();
      const themeKey = JSON.stringify(vars);
      if (themeKey !== mmThemeKey) {
        mmThemeKey = themeKey;
        mmCache.clear();
        window.mermaid.initialize({
          startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: vars,
        });
      }
      for (const el of mms) {
        if (!el.isConnected) continue;
        const text = el.dataset.text || '';
        let svg = mmCache.get(text);
        if (svg == null) {
          try {
            ({ svg } = await window.mermaid.render('mmsvg' + (++mmSeq), text));
          } catch { svg = null; }
          if (gen !== decorateGen) return;
          if (svg != null) mmCache.set(text, svg);
        }
        if (!el.isConnected) continue;
        if (svg != null) { el.innerHTML = svg; el.classList.add('mm-live'); }
        else el.classList.add('mm-err');   // bad syntax: the source stays up
      }
    }
  }

  let renderTimer = null;
  const edBack = $('edBack');
  // what the renderer needs to know each time — restamp MUST pass the same
  // set, or its shape comparison is against a different document
  const mdOpts = () => ({
    hrBreaks: prefs.hrBreaks, alerts: prefs.alerts, emojiCodes: prefs.emojiCodes,
    footnotes: prefs.footnotes, math: prefs.math, mermaid: prefs.mermaid,
    carousel: prefs.carousel, download: prefs.download, embed: prefs.embed,
    pagelink: prefs.pagelink,
  });
  function render() {
    hideImagePop();                      // the old node is about to vanish
    preview.innerHTML = renderMarkdown(renderSrc(), mdOpts());
    peer.invalidate();
    inlineImages();
    buildOutline();
    paintSource();
    pairCursors();
    decorate();                          // math → MathML, mermaid → SVG (async)
  }

  // the coloured layer under the textarea (hl.js) — rebuilt with the preview,
  // so the two are always looking at the same text
  function paintSource() {
    // Markdown token colours on AsciiDoc would lie — plain rows. JSON gets
    // its own colours (json.js), which is also where the editor earns back
    // the highlighting the preview used to give it before JSON locked itself
    // to Editor Only.
    edBack.innerHTML = isJson() ? jsonc.highlight(ed.value)
      : isAdoc()
        ? String(ed.value).split('\n')
          .map((l) => '<div class="ln">' + (l ? escRow(l) : ' ') + '</div>').join('')
        : highlightSource(ed.value);
    edBack.scrollTop = ed.scrollTop;
    peer.invalidate();                   // the rows and the text both moved
    if (find) find.repaint();            // …and find's matches lived in them
  }
  const scheduleRender = () => {
    if (inPreview()) return;             // the preview IS the editor right now
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 90);
  };

  // Relative images resolve through the backend into data: URIs — the page
  // never touches file:// itself. Cached per path, one flight each.
  function inlineImages() {
    for (const img of preview.querySelectorAll('img[data-src]')) {
      const src = img.dataset.src;
      if (!imgCache.has(src)) {
        imgCache.set(src, tiny.api.call('imageData', { src, dir: docDir }).then((r) => r && r.data));
      }
      imgCache.get(src).then((data) => {
        if (data) img.src = data;
        else img.classList.add('missing');
      });
    }
  }

  // ------------------------------------------------------------ following a link
  //
  // A link is a place to go, and the app window itself never navigates: the
  // web opens in your browser, a Markdown file or a picture opens as a tab
  // here, and anything else — a PDF, a folder — goes to whatever the system
  // opens it with. Which is also the only sane answer for an editor that
  // understands one format.
  //
  // WHEN it happens is the other half. With Editable off a plain click follows
  // (there's nothing else a click could mean), but with the caret live in the
  // preview a click has to keep placing the caret — so following moves to ⌥,
  // which is also how it works in the source pane, where every click is a
  // caret. Holding ⌥ marks the links so you can see that it will.

  // A target as written in the document → what to do with it.
  async function followTarget(raw) {
    const href = String(raw || '').trim();
    if (!href) return;
    if (href.startsWith('#')) {
      const t = preview.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
      if (t) t.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (/^(https?:|mailto:)/i.test(href)) { tiny.api.call('openExternal', { url: href }); return; }
    if (/^[a-z][\w+.-]*:/i.test(href)) return;       // some other scheme: not ours
    if (!docDir && !href.startsWith('/')) { toast('Save the document first'); return; }
    const [rel, frag] = href.split('#');
    if (!rel) return;
    // Resolution belongs to the backend: only it knows the project, and what
    // that project says a leading `/` means (Format ▸ Image & Path Settings…).
    // The #fragment goes along — once the file is up, it scrolls to it.
    const r = await tiny.api.call('openLink', { href: rel, dir: docDir, frag: frag || null });
    if (r && r.missing) toast('Not found: ' + baseName(rel));
    else if (r && r.error) toast(r.error);
  }

  preview.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    // A fragment navigation on this page is never what a click means: WebKit
    // scrolls the ROOT scroller (the layout is height-locked, so the window
    // wedges) and rewrites location. Every in-page jump is claimed here,
    // whatever else the click decides to do.
    if (href.startsWith('#') || !href) e.preventDefault();
    // footnotes jump on a plain click even while editing — the ref and its ↩
    // are tiny targets you clicked on purpose, not a caret landing
    if (a.dataset.fnBack != null) {
      const ref = preview.querySelector(`.fnref[data-fn="${CSS.escape(a.dataset.fnBack)}"]`);
      if (ref) ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (a.closest('.fnref')) { followTarget(href); return; }
    if (editing() && !e.altKey) return;              // the caret has first claim
    e.preventDefault();
    followTarget(href);
  });

  // Belt and braces: nothing may scroll the document root — the app scrolls
  // its PANES. If anything ever does (a missed fragment jump), undo it.
  addEventListener('scroll', () => {
    const se = document.scrollingElement;
    if (se && se.scrollTop) se.scrollTop = 0;
  });

  // ⌥-click in the SOURCE. The textarea is on top of the coloured backdrop, so
  // there's nothing to hit-test — but the click has already placed the caret,
  // and that offset is all it takes to find the link it landed in.
  // the same shapes the rename rewriter knows: inline (bare or <bracketed>),
  // autolink, bare url, reference definition
  const SOURCE_LINK = /!?\[(?:[^\][\\\n]|\\.)*\]\(\s*(?:<([^<>\n]*)>|([^()\s]*))[^)\n]*\)|<((?:https?|mailto):[^>\s]+)>|(?:^|\s)((?:https?:)\/\/[^\s<>)"']+)|^[ ]{0,3}\[[^\]\n]+\]:[ \t]*(?:<([^<>\n]*)>|(\S+))/g;

  function linkAt(text, at) {
    const from = text.lastIndexOf('\n', at - 1) + 1;
    let to = text.indexOf('\n', at);
    if (to < 0) to = text.length;
    const line = text.slice(from, to);
    const col = at - from;
    SOURCE_LINK.lastIndex = 0;
    let m;
    while ((m = SOURCE_LINK.exec(line))) {
      const start = m.index + (m[0].length - m[0].trimStart().length);
      if (col >= start && col <= m.index + m[0].length) {
        return m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6];
      }
    }
    return null;
  }

  // Where the links ARE, in the source pane. The textarea has no elements to
  // hover — but the coloured backdrop beneath it does, wrapping every link in
  // a `.tk-a` span (hl.js) that carries the target it parsed. So the pointer
  // is hit-tested against those boxes: a browser's hand cursor over a link,
  // and the same span tells a click what it landed on.
  //
  // Rows are binary-searched by their rectangle rather than walked, because a
  // long document has thousands of them and this runs on mousemove.
  function rowAtY(y) {
    const rows = edBack.children;
    let lo = 0, hi = rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = rows[mid].getBoundingClientRect();
      if (y < r.top) hi = mid - 1;
      else if (y > r.bottom) lo = mid + 1;
      else return rows[mid];
    }
    return null;
  }

  function linkSpanAt(x, y) {
    const row = rowAtY(y);
    if (!row) return null;
    for (const a of row.querySelectorAll('.tk-a')) {
      for (const r of a.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return a;
      }
    }
    return null;
  }

  // the pointer's last known place, so ⌥ pressed over a link it is already
  // sitting on lights up without waiting for the mouse to move
  let mouseAt = null;
  function paintAltCursor() {
    const on = document.body.classList.contains('alt') && mouseAt
      && !!linkSpanAt(mouseAt.x, mouseAt.y);
    ed.classList.toggle('linkish', !!on);
  }
  ed.addEventListener('mousemove', (e) => {
    mouseAt = { x: e.clientX, y: e.clientY };
    if (document.body.classList.contains('alt') || ed.classList.contains('linkish')) paintAltCursor();
  });
  ed.addEventListener('mouseleave', () => { mouseAt = null; ed.classList.remove('linkish'); });

  ed.addEventListener('click', (e) => {
    if (!e.altKey) return;
    // the span under the pointer first — it holds the target hl.js already
    // parsed — and the caret's own line as the fallback for the forms the
    // highlighter doesn't wrap
    const span = linkSpanAt(e.clientX, e.clientY);
    const target = (span && span.dataset.href) || linkAt(ed.value, ed.selectionStart);
    if (target) { e.preventDefault(); followTarget(target); }
  });

  // ⌥ down: show the links as links. Only a hint, but without it nobody finds
  // the modifier — and the class comes straight off again on keyup or blur, so
  // a window that lost focus mid-chord isn't left looking clickable.
  function setAlt(on) {
    document.body.classList.toggle('alt', !!on);
    if (!on) ed.classList.remove('linkish');
    else paintAltCursor();
  }
  addEventListener('keydown', (e) => { if (e.key === 'Alt') setAlt(true); });
  addEventListener('keyup', (e) => { if (e.key === 'Alt') setAlt(false); });
  addEventListener('blur', () => setAlt(false));

  // Preview ▸ Link Tabs. Tab groups that share a title switch together: pick
  // "Windows" in one and every other group with a "Windows" tab follows, so a
  // document that repeats the same set doesn't have to be re-picked block by
  // block. Matching is by the label's own text, which is the only thing two
  // separate ::: tabs blocks have in common.
  function relinkTabs(radio) {
    if (!prefs.linkTabs || !radio || !radio.id) return;
    const own = preview.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
    const title = own && own.textContent.trim().toLowerCase();
    if (!title) return;
    for (const group of preview.querySelectorAll('.tabs')) {
      if (group.contains(radio)) continue;
      for (const label of group.querySelectorAll(':scope > label')) {
        if (label.textContent.trim().toLowerCase() !== title) continue;
        const twin = label.htmlFor && document.getElementById(label.htmlFor);
        if (twin && !twin.checked) twin.checked = true;
        break;
      }
    }
    peer.invalidate();                                // panels changed size
  }

  // task boxes are live: ticking one edits the matching source line
  preview.addEventListener('change', (e) => {
    const radio = e.target.closest('input[type="radio"]');
    if (radio) { relinkTabs(radio); return; }         // a tab was switched
    if (editing()) { queueSerialize(); return; }      // the box IS the source
    const box = e.target.closest('input[data-line]');
    if (!box) return;
    const lines = ed.value.split('\n');
    const ln = +box.dataset.line;
    if (lines[ln] != null) {
      lines[ln] = lines[ln].replace(/\[( |x|X)\]/, box.checked ? '[x]' : '[ ]');
      ed.value = lines.join('\n');
      onInput();
    }
  });

  // ----------------------------------------------------------- paired cursors
  //
  // The mapping itself lives in sync.js — this is just the wiring: who is
  // driving, and when. A pane drives when it owns the caret; the other pane
  // only ever gets painted, never scrolled out from under the user, and any
  // scroll we cause ourselves is locked out of driving anything back.

  const peer = createPeerSync({
    ed, edBack, preview, previewPane,
    caretPeer: $('caretPeer'), caretSource: $('caretSource'),
  });

  let syncLock = 0;
  const lockSync = (ms) => { syncLock = Date.now() + ms; };
  const locked = () => Date.now() < syncLock;

  // Whoever holds the caret drives — but a real selection in the preview wins
  // outright, because dragging over a plain (non-editable) preview doesn't
  // move focus off the textarea, and the editor would otherwise keep
  // insisting it's in charge.
  function pairCursors(scrollIntoView) {
    const sel = window.getSelection();
    const inPv = sel && sel.rangeCount && preview.contains(sel.anchorNode);
    if (inPv && !sel.isCollapsed) { peer.fromPreview({ moveCaret: true }); return; }
    if (document.activeElement === ed) { peer.fromEditor({ scrollIntoView }); return; }
    if (inPv && editing()) { peer.fromPreview({ moveCaret: true }); return; }
    peer.clearPaint();
  }

  // ------------------------------------------------------- find and replace
  //
  // The bar (⌘F) searches the source and paints its matches through peer.js;
  // the sidebar's other face (⌘⇧F) asks the backend the same question about
  // every file in the folder. find.js owns both — this is the wiring: where a
  // match is on screen, and what happens when you pick one.

  // Put a source offset on screen in the editor pane. The textarea only
  // scrolls itself when it has focus, and while you're typing in the find
  // field it hasn't — so it's done by hand, off the backdrop's rows.
  function scrollSource(off) {
    const top = peer.rowTop(peer.lineOf(off));
    if (top == null) return;
    const y = top - ed.scrollTop;
    if (y >= 40 && y <= ed.clientHeight - 80) return;
    ed.scrollTop = Math.max(0, top - ed.clientHeight / 3);
    edBack.scrollTop = ed.scrollTop;
  }

  const offsetOf = (line, col) => {
    let i = 0;
    for (let k = 0; k < line; k++) {
      const nl = ed.value.indexOf('\n', i);
      if (nl < 0) return ed.value.length;
      i = nl + 1;
    }
    return Math.min(i + (col || 0), ed.value.length);
  };

  find = setupFindBar({
    bar: $('findbar'), ed, peer,
    scrollTo: scrollSource,
    onEdit: onInput,
    onFolder: (query, opts) => openSearch({ query, opts }),
  });

  // ⌘F with something selected looks for it, the way every editor does — but
  // only a single line of it: a selection with a newline in it means the user
  // wanted the text, not the query.
  function findSeed() {
    if (kind !== 'doc') return null;
    const s = ed.value.slice(ed.selectionStart, ed.selectionEnd);
    return s && !s.includes('\n') ? s : null;
  }

  const search = setupSearchPanel({
    panel: $('searchInner'),
    // a result opens the way a tree click does: one click previews it, a
    // double-click keeps it — and either way it lands ON the match
    onOpen: (hit, { preview: pv }) => tiny.api.call('openAt', {
      path: hit.path, line: hit.line, col: hit.col, len: hit.len, preview: pv }),
    onClose: () => showSearch(false),
  });
  $('sfBack').onclick = () => showSearch(false);

  function showSearch(on) {
    $('filesInner').hidden = !!on;
    $('searchInner').hidden = !on;
    if (on && !filesOn) setFiles(true);
    if (!on && document.activeElement && $('searchInner').contains(document.activeElement)) ed.focus();
  }

  // ⌘⇧F, or "In Folder" in the bar: the same query, one scale up.
  function openSearch({ query, opts } = {}) {
    if (!tree.has()) { toast('Open a folder to search in it.'); return; }
    const seed = query != null ? query
      : (ed.selectionEnd > ed.selectionStart && !/\n/.test(ed.value.slice(ed.selectionStart, ed.selectionEnd))
         ? ed.value.slice(ed.selectionStart, ed.selectionEnd) : null);
    showSearch(true);
    search.seed(seed, opts);
    search.focus();
    if (seed) search.run();
  }

  // A search hit arrives as a push right after the document it's in — which
  // may still be loading, so it waits for the sheet it belongs to.
  function applyGoto({ line, col, len }) {
    const off = offsetOf(line, col);
    ed.setSelectionRange(off, off + (len || 0));
    scrollSource(off);
    peer.fromEditor({ scrollIntoView: true });
    if (kind === 'doc' && !editing()) ed.focus();
  }
  tiny.api.on('goto', (g) => {
    if (g.path && g.path !== path) { pendingGoto = g; return; }
    applyGoto(g);
  });

  // A #fragment that came with a file being opened — a heading link picked in
  // the @-palette, or clicked in another document. The heading may not be
  // rendered yet (a fresh sheet paints just after it shows), so one late
  // retry covers the gap; a slug that never matches simply stays put.
  function applyAnchor({ frag }, retried) {
    const el = preview.querySelector('[id="' + CSS.escape(frag) + '"]');
    if (el) { gotoHeading(el); return; }
    if (!retried) setTimeout(() => applyAnchor({ frag }, true), 350);
  }
  tiny.api.on('goto-anchor', (g) => {
    if (g.path && g.path !== path) { pendingAnchor = g; return; }
    applyAnchor(g);
  });

  // Replace in Folder rewrote a file this window is showing. The backend has
  // already taken the new text as the saved one; the page just catches up.
  //
  // `saved: false` is the other caller — updating links after a rename, in a
  // document with unsaved changes. Nothing was written to disk there, so the
  // buffer must stay dirty; taking this text as saved would quietly discard
  // everything the buffer was already holding.
  tiny.api.on('sheet-text', ({ id, text, saved }) => {
    if (id !== sheetId) return;                  // a background tab needs nothing
    const at = Math.min(ed.selectionStart, text.length);
    const top = ed.scrollTop;
    ed.value = text;
    history.record(ed.value, true);              // a rewrite is its own step
    if (saved !== false) savedText = text;
    ed.setSelectionRange(at, at);
    paintSource();
    scheduleRender();
    setDirty();
    updateStatus();
    ed.scrollTop = top;
    edBack.scrollTop = top;
    find.refresh();
  });

  // ------------------------------------------------------- dirty & syncing

  let syncTimer = null;
  function setDirty() {
    dirty = kind === 'doc' && ed.value !== savedText;
    // A changed document is never a disposable tab. Hanging promotion off the
    // dirty flag rather than off the input events means a serialize that
    // produces identical text — which several things trigger — can't promote,
    // and a restored draft promotes on arrival, which is right.
    if (dirty && previewing) promote();
    $('saveState').textContent = kind === 'image' ? 'Picture'
      : dirty ? 'Edited' : (path ? 'Saved' : '');
    $('saveState').classList.toggle('dirty', dirty);
    tiny.win.setTitle(name + (dirty ? ' — Edited' : ''));
  }

  // keep the backend's copy fresh — it's what survives a red-✗ close
  const syncNow = () => tiny.api.call('sync', { id: sheetId, text: ed.value });
  function onInput() {
    paintSource();                       // the visible text lives here now
    scheduleRender();
    setDirty();
    updateStatus();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 400);
  }
  ed.addEventListener('input', onInput);

  // ------------------------------------------------------------ undo / redo
  //
  // The buffer is watched, not the keys: once a second (and at every forced
  // boundary — a tab switch, a rename rewrite, ⌘Z itself) whatever moved
  // since the last look becomes a step in the per-sheet history (undo.js).
  // That's what makes every mutation source undoable — typing in either
  // pane, Replace All, a ticked checkbox — without each having to say so.
  setInterval(() => { if (kind === 'doc') history.record(ed.value); }, 1000);

  function applyHistory(r) {
    if (!r) return;
    const inPv = editing() && inPreview();
    ed.value = r.text;
    // an undone deletion comes back selected (r.sel) — see undo.js
    if (r.sel) ed.setSelectionRange(r.sel[0], r.sel[1]);
    else ed.setSelectionRange(r.caret, r.caret);
    paintSource();
    render();                            // direct — scheduleRender defers to the preview
    setDirty();
    updateStatus();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 400);
    // The caret lands where the edit happened (the diff knows), and the VIEW
    // follows it there — undoing an off-screen change that stays off-screen
    // reads as nothing happening at all.
    const line = r.text.slice(0, r.caret).split('\n').length - 1;
    if (!inPv) {
      ed.focus();
      const row = edBack.children[line];       // one div per source line (hl.js)
      if (row) {
        ed.scrollTop = Math.max(0, row.offsetTop - ed.clientHeight * 0.4);
        edBack.scrollTop = ed.scrollTop;       // scroll-sync brings the preview along
      }
      return;
    }
    // Editing in the preview: land on the block the change touched — and
    // inside it, on the text itself when it can be found again. Rendered
    // text disagrees with source wherever inline syntax was drawn (**bold**
    // shows as bold), so the needle is tried verbatim, then with inline
    // markers stripped, and the occurrence nearest the change's own column
    // wins when the block holds several. A restored deletion (r.sel) comes
    // back highlighted; otherwise the caret is aimed by the text just after
    // it. When nothing matches — heavier markup, a change spanning blocks —
    // the old block-start landing stands.
    let best = null;
    for (const el of preview.querySelectorAll('[data-line]')) {
      const l = +el.dataset.line;
      if (l <= line && (!best || l >= +best.dataset.line)) best = el;
    }
    preview.focus();
    if (!best) return;
    best.scrollIntoView({ block: 'center' });

    const hay = best.textContent;
    let blockAt = 0;                    // source offset where the block starts
    for (let k = +best.dataset.line; k > 0; k--) {
      const nl = r.text.indexOf('\n', blockAt);
      if (nl < 0) break;
      blockAt = nl + 1;
    }
    const strip = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|~~|[*_`])/g, '');
    const near = (needle, want) => {
      let hit = -1;
      for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
        if (hit < 0 || Math.abs(i - want) < Math.abs(hit - want)) hit = i;
      }
      return hit;
    };
    const spot = (needle, want) => {
      if (!needle) return null;
      let i = near(needle, want);
      if (i >= 0) return [i, i + needle.length];
      const plain = strip(needle);
      if (plain && plain !== needle) {
        i = near(plain, want);
        if (i >= 0) return [i, i + plain.length];
      }
      return null;
    };

    let span = r.sel ? spot(r.text.slice(r.sel[0], r.sel[1]), r.sel[0] - blockAt) : null;
    if (!span) {
      const ahead = r.text.slice(r.caret, r.caret + 24).split('\n')[0];
      const at = ahead.length >= 3 ? spot(ahead, r.caret - blockAt) : null;
      if (at) span = [at[0], at[0]];
    }

    const sel = window.getSelection();
    const rr = document.createRange();
    if (span) {
      const point = (off) => {
        const walk = document.createTreeWalker(best, NodeFilter.SHOW_TEXT);
        let n, seen = 0;
        while ((n = walk.nextNode())) {
          if (seen + n.nodeValue.length >= off) return [n, off - seen];
          seen += n.nodeValue.length;
        }
        return n ? [n, n.nodeValue.length] : [best, 0];
      };
      const [n1, o1] = point(span[0]), [n2, o2] = point(span[1]);
      rr.setStart(n1, o1);
      rr.setEnd(n2, o2);
    } else {
      const t = document.createTreeWalker(best, NodeFilter.SHOW_TEXT).nextNode();
      rr.setStart(t || best, 0);
      rr.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(rr);
  }
  // flush only a PENDING Live edit before stepping — an unconditional
  // serialize would rewrite the buffer through unmd's normalization and
  // hand undo a spurious "step" made of trimmed whitespace
  function doUndo() { if (livePending) serializeLive(); applyHistory(history.undo(ed.value)); }
  function doRedo() { if (livePending) serializeLive(); applyHistory(history.redo(ed.value)); }

  // ⌘Z / ⇧⌘Z (and ⌘Y) — ours, on both panes. Every other field (find, the
  // palette, a rename, the image sheet) keeps its native per-field undo.
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if ((k !== 'z' && k !== 'y') || kind !== 'doc') return;
    const t = e.target;
    if (t !== ed && t !== preview && t !== document.body && !preview.contains(t)) return;
    e.preventDefault();
    if (k === 'y' || e.shiftKey) doRedo(); else doUndo();
  }, true);
  // the same two intents by any other route (Edit ▸ Undo arrives this way)
  const onHistIntent = (e) => {
    if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
    e.preventDefault();
    if (e.inputType === 'historyUndo') doUndo(); else doRedo();
  };
  ed.addEventListener('beforeinput', onHistIntent);
  preview.addEventListener('beforeinput', onHistIntent);

  window.addEventListener('blur', () => {
    flushLive();
    clearTimeout(syncTimer);
    syncNow();
  });

  // ---------------------------------------------------------------- status

  function updateStatus() {
    if (kind === 'image') {              // the picture's own bar says the rest
      $('counts').textContent = '';
      $('caret').textContent = '';
      return;
    }
    const text = ed.value;
    const words = (text.match(/\S+/g) || []).length;
    const mins = Math.max(1, Math.round(words / 220));
    $('counts').textContent = words
      ? `${words.toLocaleString()} words · ${text.length.toLocaleString()} chars · ${mins} min read`
      : 'empty';
    const upto = text.slice(0, ed.selectionStart);
    const ln = (upto.match(/\n/g) || []).length + 1;
    const col = ed.selectionStart - (upto.lastIndexOf('\n') + 1) + 1;
    $('caret').textContent = `Ln ${ln}, Col ${col}`;
  }
  let pairTimer = null;
  const schedulePair = () => {
    clearTimeout(pairTimer);
    pairTimer = setTimeout(() => pairCursors(true), 40);
  };
  document.addEventListener('selectionchange', () => { updateStatus(); schedulePair(); });
  ed.addEventListener('keyup', updateStatus);
  ed.addEventListener('click', updateStatus);
  ed.addEventListener('focus', schedulePair);
  preview.addEventListener('focus', schedulePair);

  // ------------------------------------------------------------ save & co.

  // Nib's own config files. Broken JSON in one of these is not a typo in a
  // document, it is a folder that has lost its settings or its buttons — so
  // these are the ones a bad save is refused for outright, and the ones that
  // are tidied up on the way to disk.
  // The backend says which sheets these are (sheetPayload) — the page has no
  // business guessing at the data directory's path.
  const isNibConfig = () => !!sheetConfig;

  // The JSON gate. An invalid file is stopped before it is written, with the
  // caret put on the problem — the one thing you want from an error is to be
  // taken to it. Anything that ISN'T Nib's own config is offered a way past,
  // because a half-written file you meant to keep is your business.
  async function jsonGate() {
    if (!isJson()) return true;
    const r = jsonc.check(ed.value);
    if (!r.ok) {
      showProblems([{ text: r.full, line: r.line, col: r.col, bad: true }]);
      goToLineCol(r.line, r.col);
      if (isNibConfig()) {
        toast('Not saved — ' + r.message);
        return false;
      }
      return tiny.dialog.confirm('“' + name + '” isn’t valid JSON.', {
        detail: r.full + '\n\nSaving it anyway is fine — nothing else reads this file.',
        ok: 'Save Anyway', cancel: 'Keep Editing',
      });
    }
    // Valid: Nib's own files are laid out again, comments and all. Other
    // people's JSON is left exactly as they wrote it — reformatting a
    // package.json nobody asked about would be a rude way to save a file.
    if (isNibConfig()) {
      try {
        // safeFormat, not format: it re-reads its own output and refuses to
        // hand back anything that isn't the same data with the same comments.
        // This rewrites a file nobody asked to have rewritten, so a bug in the
        // layout must cost the person nothing.
        const tidy = jsonc.safeFormat(ed.value);
        if (tidy && tidy !== ed.value) {
          const at = Math.min(ed.selectionStart, tidy.length);
          ed.value = tidy;
          history.record(ed.value, true);            // its own undo step
          ed.setSelectionRange(at, at);
          paintSource();
          updateStatus();
        }
      } catch { /* it parsed a moment ago; if it won't lay out, save it as-is */ }
    }
    hideProblems();
    return true;
  }

  // The problem bar. One row per complaint, the bad ones in red; a row that
  // knows where it happened takes you there when you click it.
  function showProblems(list) {
    const box = $('problemRows');
    box.textContent = '';
    for (const p of list) {
      const row = document.createElement('div');
      row.className = 'prow' + (p.bad ? ' bad' : '');
      row.textContent = (p.bad ? '✕ ' : '⚠ ') + p.text;
      if (p.line) {
        row.classList.add('jump');
        row.onclick = () => goToLineCol(p.line, p.col || 1);
      }
      box.appendChild(row);
    }
    $('problems').hidden = !list.length;
  }
  const hideProblems = () => { $('problems').hidden = true; };
  $('problemsX').onclick = hideProblems;

  // Format ▸ Format JSON — the same layout the config files get on save, on
  // demand, for any JSON file. It refuses rather than guesses at a broken one.
  function formatJsonNow() {
    if (!isJson()) return toast('That isn’t a JSON file');
    const r = jsonc.check(ed.value);
    if (!r.ok) {
      showProblems([{ text: r.full, line: r.line, col: r.col, bad: true }]);
      goToLineCol(r.line, r.col);
      return toast('Can’t format — ' + r.message);
    }
    hideProblems();
    const tidy = jsonc.format(ed.value);
    if (tidy === ed.value) return toast('Already tidy');
    const at = Math.min(ed.selectionStart, tidy.length);
    ed.value = tidy;
    history.record(ed.value, true);
    ed.setSelectionRange(at, at);
    onInput();
    toast('Formatted');
  }

  function goToLineCol(line, col) {
    const lines = ed.value.split('\n');
    let at = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) at += lines[i].length + 1;
    at += Math.max(0, col - 1);
    ed.focus();
    ed.setSelectionRange(at, at);
    const row = edBack.children[line - 1];
    if (row) ed.scrollTop = Math.max(0, row.offsetTop - ed.clientHeight * 0.4);
    updateStatus();
  }

  async function doSave(saveAs) {
    flushLive();
    if (!(await jsonGate())) return false;
    let pick = null;
    if (saveAs || !path) {
      pick = await tiny.dialog.saveFile({ types: DOC_TYPES });
      if (!pick) return false;                       // user bailed
    }
    const r = await tiny.api.call('saveDoc', { id: sheetId, text: ed.value, path: pick });
    if (!r.ok) return false;
    // The backend re-read the actions file it just wrote; anything it couldn't
    // make sense of comes back as a warning. Valid JSON, wrong shape.
    if (r.actionProblems) {
      if (r.actionProblems.length) {
        showProblems(r.actionProblems.map((text) => ({ text })));
      } else hideProblems();
    }
    path = r.path;
    name = r.name;
    docDir = path.slice(0, path.lastIndexOf('/'));
    tree.showing(path);
    savedText = ed.value;
    setDirty();
    hideBanner();
    toast('Saved ' + name);
    return true;
  }

  async function doExport() {
    flushLive();
    const pick = await tiny.dialog.saveFile({ types: ['html'] });
    if (!pick) return;
    render();                                        // make sure it's current
    await Promise.all([...imgCache.values()]);       // and images are inlined
    const art = preview.cloneNode(true);
    art.removeAttribute('contenteditable');
    art.classList.remove('zoom');                    // nothing to click out there
    for (const box of art.querySelectorAll('input')) {
      box.setAttribute('disabled', '');              // static in the export
      box.removeAttribute('data-line');
    }
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const bg = getComputedStyle(preview).backgroundColor;
    // the clone carries the reading preferences as classes; the page width is
    // the only one that isn't, so it's written into the wrapper's max-width
    const pw = (PAGE_WIDTH[prefs.width] || PAGE_WIDTH.full)[1];
    // Tabs are pure CSS and stay that way; linking them is the one thing that
    // can't be, so an export made with Link Tabs on carries this and nothing
    // else. Off, the file has no script at all.
    const linkScript = !prefs.linkTabs ? '' : `<script>
document.addEventListener('change', (e) => {
  const r = e.target.closest('.tabs > input[type="radio"]');
  if (!r) return;
  const own = document.querySelector('label[for="' + r.id + '"]');
  const title = own && own.textContent.trim().toLowerCase();
  if (!title) return;
  for (const g of document.querySelectorAll('.tabs')) {
    if (g.contains(r)) continue;
    for (const l of g.querySelectorAll(':scope > label')) {
      if (l.textContent.trim().toLowerCase() !== title) continue;
      const t = document.getElementById(l.htmlFor);
      if (t) t.checked = true;
      break;
    }
  }
});
<\/script>
`;
    const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name.replace(/\.(md|markdown|mdown|mkdn|mkd|mdwn|mdtxt|mdtext|mdx|qmd|rmd|mdc|adoc|asciidoc)$/i, ''))}</title>
<style>body{margin:0;background:${bg};}main{max-width:${pw === 'none' ? '100%' : pw};margin:0 auto;padding:48px 28px;}
${MD_BASE_CSS}${THEMES[theme].css}</style>
</head><body><main class="${art.className}">
${art.innerHTML}
</main>${linkScript}</body></html>
`;
    const r = await tiny.api.call('exportHtml', { path: pick, html });
    toast('Exported ' + r.name);
  }

  function doPrint() {
    flushLive();
    render();                                        // print.css shows only the preview
    setTimeout(() => tiny.win.print(), 50);
  }

  // Save as PDF. printToPDF captures the page as it stands on screen rather
  // than as print media would render it — so flip the print stylesheet on for
  // the length of the capture and the PDF comes out as the themed document,
  // no toolbar, no editor.
  async function doPdf() {
    flushLive();
    let pick = await tiny.dialog.saveFile({ types: ['pdf'] });
    if (!pick) return;
    if (!/\.pdf$/i.test(pick)) pick += '.pdf';
    render();
    await Promise.all([...imgCache.values()]);
    const sheet = $('printCss');
    sheet.media = 'all';
    // a single-page capture can't honor page breaks, so keep their dotted
    // markers visible rather than losing them silently — see print.css.
    // Page View comes off for the capture too: the PDF is the document,
    // not a picture of sheets on a desk.
    document.body.classList.add('pdfcap');
    const wasPaged = document.body.hasAttribute('data-paged');
    document.body.removeAttribute('data-paged');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const r = await tiny.win.printToPDF(pick);
      const named = (r && r.path ? r.path : pick).split('/').pop();
      tiny.api.call('announce', { path: r && r.path ? r.path : pick, title: 'Nib — saved PDF' });
      toast('Saved ' + named);
    } catch (e) {
      tiny.dialog.alert('Couldn’t save the PDF', String((e && e.message) || e));
    } finally {
      sheet.media = 'print';
      document.body.classList.remove('pdfcap');
      if (wasPaged) document.body.setAttribute('data-paged', '');
    }
  }

  // ------------------------------------------------------------- the dance

  // ⌘W closes a TAB (the last one takes the window with it). The red ✗ can't
  // be intercepted — the backend drafts every dirty tab after the fact — so
  // this path is the one that gets the civilised three buttons.
  let closing = null;                                // the tab being closed

  async function closeTab(id) {
    const target = id || sheetId;
    if (target !== sheetId) await showSheet(target); // ask about what you can see
    flushLive();
    if (!dirty) { finishClose({}); return; }
    closing = target;
    $('sheetTitle').textContent = `Save changes to “${name}”?`;
    $('sheetDetail').textContent = 'Don’t Save discards them. (Closing the window instead keeps a draft — Nib restores it next time.)';
    $('shade').hidden = false;
    $('btnSave').focus();
  }

  async function finishClose(opts) {
    const id = closing || sheetId;
    closing = null;
    $('shade').hidden = true;
    const r = await tiny.api.call('closeSheet', { id, ...opts });
    if (r && r.closed) history.drop(id);             // its undo story ends here
    if (r && r.sheet) loadSheet(r.sheet);            // the neighbour takes over
  }

  const hideSheet = () => { $('shade').hidden = true; closing = null; ed.focus(); };
  $('btnCancel').onclick = hideSheet;
  $('btnDont').onclick = () => finishClose({ discard: true });
  $('btnSave').onclick = async () => {
    if (await doSave(false)) finishClose({});
    else hideSheet();                                // save panel cancelled
  };
  document.addEventListener('keydown', (e) => {
    if ($('shade').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); hideSheet(); }
    if (e.key === 'Enter') { e.preventDefault(); $('btnSave').click(); }
    // ⌘D (Ctrl+D off-mac) — the underlined D on the button
    if (e.key === 'd' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('btnDont').click(); }
  });

  // --------------------------------------------------------------- banner

  const hideBanner = () => { $('banner').hidden = true; };
  $('btnBannerX').onclick = hideBanner;
  $('btnRevert').onclick = async () => {
    const sure = await tiny.dialog.confirm(`Revert “${name}” to the saved version?`, {
      detail: 'The restored draft changes will be discarded.',
      ok: 'Revert', cancel: 'Cancel',
    });
    if (!sure) return;
    const r = await tiny.api.call('revert', { id: sheetId });
    ed.value = r.text;
    savedText = r.text;
    hideBanner();
    onInput();
  };
  if (boot.sheet.restored) {
    $('banner').hidden = false;
    if (!path) $('btnRevert').hidden = true;         // untitled: nothing to revert to
  }

  // ------------------------------------------------------------ formatting

  function wrapSelection(mark, endMark) {
    if (inPreview()) {                               // the DOM is the document
      document.execCommand(mark === '**' ? 'bold' : mark === '*' ? 'italic' : 'x');
      if (mark === '`') {
        const sel = String(window.getSelection() || '') || 'code';
        document.execCommand('insertHTML', false,
          '<code>' + sel.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</code>');
      }
      queueSerialize();
      return;
    }
    const end = endMark ?? mark;
    const { selectionStart: a, selectionEnd: b, value: v } = ed;
    const sel = v.slice(a, b) || 'text';
    const before = v.slice(a - mark.length, a), after = v.slice(b, b + end.length);
    if (before === mark && after === end) {          // already wrapped → unwrap
      ed.setRangeText(sel, a - mark.length, b + end.length, 'select');
    } else {
      ed.setRangeText(mark + sel + end, a, b, 'select');
      ed.setSelectionRange(a + mark.length, a + mark.length + sel.length);
    }
    ed.focus();
    onInput();
  }

  async function insertLink() {
    if (inPreview()) {
      const had = String(window.getSelection() || '');
      const url = await tiny.dialog.prompt('Link URL:', { default: 'https://', ok: 'Insert' });
      if (!url) return;
      preview.focus();
      if (had) document.execCommand('createLink', false, url);
      else document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '%22')}">link</a>`);
      queueSerialize();
      return;
    }
    const { selectionStart: a, selectionEnd: b, value: v } = ed;
    const sel = v.slice(a, b);
    const url = await tiny.dialog.prompt('Link URL:', { default: 'https://', ok: 'Insert' });
    ed.focus();
    if (!url) return;
    ed.setRangeText(`[${sel || 'link'}](${mdTarget(url)})`, a, b, 'end');
    onInput();
  }

  // ⌘V of a URL with text selected: the text becomes the link's label rather
  // than being thrown away — [what you had](what you pasted). It only fires
  // when both halves are unmistakable, because a paste that replaces the
  // selection is the behaviour everyone else has and guessing wrong is worse
  // than not helping: the clipboard has to hold one whitespace-free URL WITH A
  // SCHEME (`www.example.com` written into a link target would resolve as a
  // relative path, so it isn't one), and the selection has to look like a
  // label — one line, not a URL itself (replacing one address with another is
  // plainly a replacement), and not already sitting in the (target) half of a
  // link, which is the same thing said a different way. Anything else falls
  // through untouched.
  const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)[^\s]+$/i;
  // …and a label spanning lines, or carrying the very brackets a label is
  // delimited by, isn't one — that would write a link that doesn't parse
  const BADLABEL = /[\n[\]]/;

  // is [a,b) inside the (…) of a `](…)` on its own line?
  function inLinkTarget(v, a, b) {
    const bol = v.lastIndexOf('\n', Math.max(0, a - 1)) + 1;
    const open = v.lastIndexOf('](', a);
    if (open < bol) return false;                          // no link opened above us
    if (v.slice(open + 2, a).includes(')')) return false;  // …and it already closed
    const nl = v.indexOf('\n', b);
    return v.slice(b, nl < 0 ? v.length : nl).includes(')');
  }

  function pasteAsLink(e) {
    const url = String((e.clipboardData && e.clipboardData.getData('text/plain')) || '').trim();
    if (!url || !URLISH.test(url) || isJson()) return;

    if (inPreview()) {
      const text = String(window.getSelection() || '');
      if (!text.trim() || BADLABEL.test(text) || URLISH.test(text.trim())) return;
      e.preventDefault();
      // on a selection already inside an <a>, this retargets it — which is
      // what dropping a new address on an old link should do
      document.execCommand('createLink', false, url);
      queueSerialize();
      return;
    }
    if (document.activeElement !== ed) return;
    const { selectionStart: a, selectionEnd: b, value: v } = ed;
    const sel = v.slice(a, b);
    if (!sel.trim() || BADLABEL.test(sel) || URLISH.test(sel.trim())) return;
    if (!isAdoc() && inLinkTarget(v, a, b)) return;
    // a double-click usually takes the space after the word with it: whatever
    // whitespace the selection is padded with stays OUTSIDE the brackets
    const lead = sel.match(/^\s*/)[0];
    const tail = sel.match(/\s*$/)[0];
    const label = sel.slice(lead.length, sel.length - tail.length);
    // an .adoc sheet gets AsciiDoc's own spelling — the bare form for the
    // schemes it autolinks, the link: macro for the rest (both round-trip
    // through adoc.js)
    const md = isAdoc()
      ? (/^(?:https?|ftp):/i.test(url) ? `${url}[${label}]` : `link:${url}[${label}]`)
      : `[${label}](${mdTarget(url)})`;
    e.preventDefault();
    ed.setRangeText(lead + md + tail, a, b, 'end');
    onInput();
  }

  // Paste a lone oEmbed-able URL and Nib offers the embed — TESTED first,
  // then asked: the dialog only appears once the provider has actually
  // answered, so the question can name what it found ("YouTube — Big Buck
  // Bunny") instead of guessing. Declining is remembered for the session;
  // a URL that answers nothing never interrupts at all.
  const embedDeclined = new Set();
  async function offerEmbed(url) {
    if (!prefs.embed || isJson() || isAdoc() || embedDeclined.has(url)) return;
    const r = await tiny.api.call('oembedGet', { url });
    if (!r || r.error) return;
    // the paste may still be on its way into the source (the preview
    // serializes on idle), and the document may have moved on — the offer
    // only stands while the URL sits alone on a line
    const find = () => {
      const v = ed.value;
      let at = v.indexOf(url);
      while (at >= 0) {
        const ls = v.lastIndexOf('\n', at - 1) + 1;
        let le = v.indexOf('\n', at);
        if (le < 0) le = v.length;
        if (v.slice(ls, le).trim() === url) return { ls, le };
        at = v.indexOf(url, at + 1);
      }
      return null;
    };
    if (!find()) await new Promise((res) => setTimeout(res, 400));
    if (!find()) return;
    const what = [r.provider, r.title].filter(Boolean).join(' — ') || url;
    const ok = await tiny.dialog.confirm('Embed this link?', {
      detail: what + '\n\n“::: embed” plays it right here in the preview; '
        + 'kept as a link, it just links.',
      ok: 'Embed', cancel: 'Keep the Link',
    });
    if (!ok) { embedDeclined.add(url); return; }
    const hit = find();                          // again — the dialog took time
    if (!hit) return;
    ed.setRangeText('::: embed ' + url + '\n:::', hit.ls, hit.le, 'end');
    onInput();
  }

  // A paste that IS a bare URL, onto a collapsed caret (a selection is
  // pasteAsLink's business): let it land as text, then make the offer.
  function maybeOfferEmbed(e) {
    const url = String((e.clipboardData && e.clipboardData.getData('text/plain')) || '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return;
    const collapsed = inPreview()
      ? String(window.getSelection() || '') === ''
      : ed.selectionStart === ed.selectionEnd;
    if (!collapsed) return;
    setTimeout(() => offerEmbed(url), 0);        // after the paste itself lands
  }

  // ----------------------------------------------------------------- images
  //
  // Paste an image, or drop one on the window, and it lands as a real file
  // with a relative link in the source — the backend owns the write
  // (api.saveImage), the page decides three things about it: WHERE (the
  // settings' folder), WHAT IT'S CALLED (the document plus the heading you're
  // under), and WHETHER IT'S RE-ENCODED first, which has to happen here
  // because a canvas is the only image encoder that exists on all three
  // platforms — sips is macOS-only.
  //
  // A picked or dropped FILE keeps the name it already has; only a paste gets
  // a generated one, because a clipboard image has no name worth keeping.

  const isImage = (p) => IMAGE_EXT.test(p);

  // -------------------------------------------------------- what it's called

  const slug = (s) => String(s || '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')       // a link in a heading
    .replace(/[*_~#]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');

  function stamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // The heading the caret is under. In the source that's the last `## ` line
  // at or above it; in the editable preview the DOM already knows — walk back
  // from the block the selection is in. A picture pasted under "Installing on
  // macOS" should say so in its filename.
  //
  // "At or above": the search runs to the end of the caret's OWN line, so a
  // caret sitting in a heading counts as being under it. Cutting at the caret
  // instead means clicking on the heading you just typed finds the one before.
  function headingAtCaret() {
    if (inPreview()) {
      const sel = window.getSelection();
      let n = sel && sel.anchorNode;
      while (n && n.parentNode !== preview) n = n.parentNode;
      for (; n; n = n.previousElementSibling) {
        if (/^H[1-6]$/.test(n.nodeName)) return n.textContent;
      }
      return '';
    }
    let end = ed.value.indexOf('\n', ed.selectionStart);
    if (end < 0) end = ed.value.length;
    const before = ed.value.slice(0, end).split('\n');
    for (let i = before.length - 1; i >= 0; i--) {
      const m = before[i].match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
      if (m) return m[1];
    }
    return '';
  }

  const docSlug = () => slug((name || 'image').replace(/\.(md|markdown|mdown|mkdn|mkd|mdwn|mdtxt|mdtext|mdx|qmd|rmd|mdc|adoc|asciidoc|txt)$/i, '')) || 'image';

  // The pinned folders above this document, shallowest first — the same pins
  // that scope search, read here for what they say about WHERE the document
  // lives: {pin} in a template is the closest one, {pintop} the outermost,
  // {pin2}… counted down from the top. The master search switch doesn't
  // matter — a parked pin still names the folder.
  function pinsAbove() {
    if (!docDir) return [];
    return Object.keys(tree.pins())
      .filter((p) => docDir === p || docDir.startsWith(p + '/'))
      .sort((a, b) => a.length - b.length);
  }

  // Custom naming: `{doc}-{heading}` and friends. Every variable slugs itself
  // (so a heading can't smuggle a slash in), unknown ones expand to nothing,
  // and the runs of dashes that empty variables leave behind collapse. What
  // was typed BETWEEN the braces is kept, lightly cleaned.
  function expandTemplate(tpl, orig) {
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const root = tree.root();
    // {dir} counts up from the document but stops at the folder: a template
    // shouldn't be able to name your home directory. Outside a folder the
    // document's own path is all there is.
    const inRoot = root && docDir && (docDir === root || docDir.startsWith(root + '/'));
    const dirs = !docDir ? []
      : inRoot ? [baseName(root), ...(docDir === root ? [] : docDir.slice(root.length + 1).split('/'))]
      : docDir.split('/').filter(Boolean);
    const above = pinsAbove();
    const val = (key) => {
      if (key === 'doc') return docSlug();
      if (key === 'heading') return slug(headingAtCaret());
      if (key === 'name') return slug(orig || '');
      if (key === 'date') return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
      if (key === 'time') return p2(d.getHours()) + p2(d.getMinutes());
      if (key === 'path') {
        return root && docDir && docDir.startsWith(root + '/')
          ? slug(docDir.slice(root.length + 1).replace(/\//g, ' ')) : '';
      }
      if (key === 'pin') return slug(baseName(above[above.length - 1] || ''));
      if (key === 'pintop') return slug(baseName(above[0] || ''));
      if (key === 'pinpath') {
        const pin = above[above.length - 1];
        return pin && docDir.length > pin.length
          ? slug(docDir.slice(pin.length + 1).replace(/\//g, ' ')) : '';
      }
      let m = key.match(/^dir(\d*)$/);
      if (m) return slug(dirs[dirs.length - (+m[1] || 1)] || '');
      m = key.match(/^pin(\d+)$/);
      if (m) return slug(baseName(above[+m[1] - 1] || ''));
      return '';
    };
    return tpl.replace(/\{(\w+)\}/g, (_, k) => val(k))
      .replace(/[^\w .()-]+/g, '-')
      .replace(/-{2,}/g, '-').replace(/^[-.\s]+|[-\s]+$/g, '')
      .slice(0, 80);
  }

  function imageStem(s, orig) {
    if (s.naming === 'custom' && s.template) {
      return expandTemplate(s.template, orig) || docSlug() + '-image';
    }
    const doc = docSlug();
    if (s.naming === 'stamp') return doc + '-' + stamp();
    if (s.naming === 'heading') {
      const h = slug(headingAtCaret());
      if (h) return doc + '-' + h;
    }
    return doc + '-image';
  }

  // ------------------------------------------------------------- optimizing
  //
  // Decode the picture into an <img>, redraw it on a canvas at (at most) the
  // capped width, and re-encode. Nothing native is involved, so this works the
  // same on macOS, Windows and Linux — but WebP ENCODING isn't universal
  // (Safari only learned it recently, WebKitGTK depends on its build), so the
  // format is probed once and JPEG is the fallback.
  //
  // SVG and GIF are left alone on purpose: a canvas would rasterize the vector
  // and flatten the animation, which is not what "optimize" should mean. And
  // if the re-encode comes out BIGGER than what came in — already-tight JPEGs
  // and small PNGs both manage it — the original file wins.

  let webpOk = null;
  function canWebp() {
    if (webpOk === null) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      webpOk = c.toDataURL('image/webp').startsWith('data:image/webp');
    }
    return webpOk;
  }

  const loadImage = (src) => new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });

  const b64Bytes = (s) => Math.round((s.length * 3) / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);

  // `force` is the optimizer's flavor of "keep the format": on add, same
  // format + no resize means nothing was asked for; in the optimizer it means
  // recompress in place, and only the is-it-actually-smaller guard remains.
  async function optimizeImage(src, s, pre, force) {
    if (s.optimize === 'off') return null;
    const e = (src.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
    if (e === 'svg' || e === 'gif') return null;
    const got = pre || await tiny.api.call('imageData', { src });
    if (!got || !got.data) return null;
    const img = await loadImage(got.data);
    if (!img || !img.naturalWidth) return null;

    const cap = s.maxWidth || 0;
    const scale = cap && img.naturalWidth > cap ? cap / img.naturalWidth : 1;
    // "Convert" means convert to something small: WebP where it can be
    // written, JPEG where it can't (macOS WebKit still has no WebP encoder —
    // it decodes them happily, which is why the preview shows them). "Keep the
    // format" means exactly that, and only the resize is left to do.
    const type = s.optimize === 'webp'
      ? (canWebp() ? 'image/webp' : 'image/jpeg')
      : e === 'png' ? 'image/png'
      : e === 'webp' && canWebp() ? 'image/webp'
      : 'image/jpeg';
    const format = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[type];
    if (!force && scale === 1 && s.optimize === 'same' && format === e) return null;   // nothing to do

    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d');
    if (type === 'image/jpeg') {                     // a jpeg has no alpha to keep
      cx.fillStyle = '#fff';
      cx.fillRect(0, 0, w, h);
    }
    cx.drawImage(img, 0, 0, w, h);
    const url = c.toDataURL(type, (s.quality || 82) / 100);
    if (!url.startsWith('data:' + type)) return null;
    const data = url.slice(url.indexOf(',') + 1);
    const was = b64Bytes(got.data.slice(got.data.indexOf(',') + 1));
    const now = b64Bytes(data);
    if (now >= was && scale === 1) return null;      // the original was already better
    return { data, format, was, now };
  }

  // --------------------------------------------------------------- the write

  // The backend numbers the name and writes the bytes; what comes back is the
  // path relative to THIS document, which is what goes in the link.
  async function addImageFile(payload) {
    let r;
    try {
      r = await tiny.api.call('saveImage', { id: sheetId, ...payload });
    } catch {
      toast('Couldn’t add that image');
      return null;
    }
    if (r.needsPath) {                               // untitled: nowhere to put it
      toast('Save the document first');
      if (!(await doSave(false))) return null;
      return addImageFile(payload);
    }
    return r;
  }

  // Settings applied, optimized if they say so, written by the backend —
  // shared with the picture bar's Replace, which wants everything about this
  // except the inserting.
  async function placeImage(src, { rename = false } = {}) {
    const s = await imageSettings();                 // asks, once per folder
    if (!s) return null;
    const opt = await optimizeImage(src, s);
    // A template renames EVERYTHING that comes in — that's what it's for, and
    // {name} is how a picked file's own name survives it. (A paste has no
    // name worth keeping, so its {name} is empty.) The fixed namings keep the
    // old rule: pastes get named, picked files keep their names.
    const custom = s.naming === 'custom' && !!s.template;
    const orig = rename ? '' : baseName(src).replace(/\.[^.]*$/, '');
    const r = await addImageFile({
      src,
      stem: rename || custom ? imageStem(s, orig) : null,
      number: rename && !custom && s.naming !== 'stamp',
      ...(opt ? { data: opt.data, format: opt.format } : {}),
    });
    return r ? { ...r, opt } : null;
  }

  async function importImage(src, opts) {
    const r = await placeImage(src, opts);
    if (!r) return;
    const opt = r.opt;
    const link = r.rel || r.name;
    const alt = r.name.replace(/\.[^.]*$/, '');
    if (inPreview()) {
      preview.focus();
      document.execCommand('insertHTML', false,
        `<span class="fig" data-alt="${alt}"><img data-src="${link}" alt="${alt}"></span>`);
      inlineImages();
      queueSerialize();
    } else {
      ed.focus();
      ed.setRangeText(`![${alt}](${mdTarget(link)})`, ed.selectionStart, ed.selectionEnd, 'end');
      onInput();
    }
    toast(opt ? `Added ${r.name} — ${niceBytes(opt.was)} → ${niceBytes(opt.now)}`
              : 'Added ' + r.name);
  }

  // ⌘V with a picture on the pasteboard. The native clipboard is the source
  // of truth (tiny.clipboard hands back a real png path); clipboardData is
  // only consulted to decide whether this paste is ours to take.
  function onPaste(e) {
    const dt = e.clipboardData;
    const imageish = dt && (
      (dt.files && dt.files.length) ||
      [...(dt.items || [])].some((i) => i.kind === 'file' && /^image\//.test(i.type)));
    if (!imageish) {                                  // text: plain, or a link
      pasteAsLink(e);
      if (!e.defaultPrevented) maybeOfferEmbed(e);
      return;
    }
    e.preventDefault();                               // (synchronously — before any await)
    pasteImage();
  }

  async function pasteImage() {
    const c = await tiny.clipboard.read();
    if (!c || c.kind !== 'image' || !c.image) { toast('No image on the clipboard'); return; }
    importImage(c.image, { rename: true });
  }
  ed.addEventListener('paste', onPaste);
  preview.addEventListener('paste', onPaste);

  async function pickImage() {
    const picks = await tiny.dialog.openFiles({ types: IMG_TYPES });
    for (const p of (picks || []).filter(isImage)) await importImage(p);
  }

  // ------------------------------------------------------- the settings sheet
  //
  // Format ▸ Image Settings…, and — once — the first time you paste into a
  // folder that has never been asked. The backend remembers which folders have
  // been asked (and answers `ask`), so this is a question exactly once per
  // project and a menu item forever after. Cancelling still counts as asked:
  // a folder that nagged twice would be worse than one that guessed.

  const imgshade = $('imgshade');
  let imgDone = null;                                // resolve of the open sheet
  let imgRoot = null;                                // the project the sample is drawn against
  let imgScope = null;                               // the folder being marked as asked

  const cleanRoot = (v) => String(v || '').replace(/\\/g, '/').split('/')
    .filter((p) => p && p !== '.' && p !== '..').join('/');

  const imgForm = () => ({
    dest: $('imgDest').value,
    folder: $('imgFolder').value.trim() || 'images',
    naming: $('imgNaming').value,
    template: $('imgTpl').value.replace(/[/\\:]+/g, '-').trim().slice(0, 80),
    optimize: $('imgOptimize').value,
    maxWidth: Math.max(0, Math.min(8000, parseInt($('imgMax').value, 10) || 0)),
    imageRoot: cleanRoot($('imgRootImg').value),
    linkRoot: cleanRoot($('imgRootLink').value),
  });

  // The line that does the explaining: the exact path the next paste writes.
  function paintImgSample(root) {
    const s = imgForm();
    $('imgFolderRow').hidden = s.dest === 'beside';
    $('imgTplRow').hidden = s.naming !== 'custom';
    $('imgTplVars').hidden = s.naming !== 'custom';
    $('imgMaxRow').hidden = s.optimize === 'off';
    const custom = s.naming === 'custom' && s.template;
    const stem = imageStem(s, custom ? 'picture' : '')
      + (s.naming === 'stamp' || custom ? '' : '-1');
    const e = s.optimize === 'webp' ? (canWebp() ? 'webp' : 'jpg') : 'png';
    const base = root ? root + (s.imageRoot ? '/' + s.imageRoot : '') : null;
    let dir = '';
    if (s.dest === 'sub') dir = s.folder + '/';
    else if (s.dest === 'root' && base && docDir) dir = relativeTo(docDir, base + '/' + s.folder) + '/';
    $('imgdlgSample').textContent = dir + stem + '.' + e;
    // …and what the two roots resolve to, in the project's own terms
    if (root) {
      const name = baseName(root);
      $('imgdlgRootSample').textContent =
        `![](/images/logo.png)  →  ${name}/${s.imageRoot ? s.imageRoot + '/' : ''}images/logo.png\n`
        + `[x](/index.md)  →  ${name}/${s.linkRoot ? s.linkRoot + '/' : ''}index.md`;
    }
    const notes = [];
    if (s.optimize !== 'off') {
      notes.push(canWebp() ? 'SVG and GIF are never re-encoded.'
        : 'This webview can’t write WebP, so JPEG is used. SVG and GIF are never re-encoded.');
    }
    notes.push('A dropped picture is a paste, at the drop point. Insert Image… keeps the file’s own name.');
    $('imgdlgNote').textContent = notes.join(' ');
  }

  function openImageSettings(info, first) {
    const s = info.settings;
    $('imgDest').value = s.dest;
    $('imgFolder').value = s.folder;
    $('imgNaming').value = s.naming;
    $('imgTpl').value = s.template || '';
    $('imgOptimize').value = s.optimize;
    $('imgMax').value = s.maxWidth;
    $('imgRootImg').value = s.imageRoot || '';
    $('imgRootLink').value = s.linkRoot || '';
    // Both of these are questions about a FOLDER, so with none open there is
    // nothing to answer — a `/` is a path on the disk and the settings are the
    // app's own.
    $('imgRoots').hidden = !info.project;
    $('imgProjRow').hidden = !info.project;
    $('imgProj').checked = info.inFolder !== false;
    // "at the project root" needs a project — without one it's the same place
    // as "next to the document", which would be a lie in a menu.
    $('imgDest').options[2].disabled = !info.project;
    if (!info.project && s.dest === 'root') $('imgDest').value = 'beside';
    // Don't offer a format this build can't write — on macOS today that's
    // WebP, and the option quietly means JPEG.
    $('imgOptimize').options[1].textContent = canWebp() ? 'Convert to WebP' : 'Convert to JPEG';
    $('imgdlgTitle').textContent = first
      ? 'Where should pictures go?'
      : 'Images & Paths';
    $('imgdlgIntro').textContent = first
      ? `The first picture is landing in ${info.project ? '“' + baseName(info.root) + '”' : 'this folder'}. This is asked once — Format ▸ Image & Path Settings… changes it later.`
      : (info.project
        ? 'These belong to “' + baseName(info.root) + '”.'
        : 'These apply everywhere until a folder of its own is open.');
    $('imgSave').textContent = first ? 'Use These' : 'Save';
    paintImgSample(info.root);
    imgshade.hidden = false;
    $('imgDest').focus();
    return new Promise((res) => { imgDone = res; });
  }

  for (const id of ['imgDest', 'imgFolder', 'imgNaming', 'imgTpl', 'imgOptimize', 'imgMax',
                    'imgRootImg', 'imgRootLink']) {
    const paint = () => paintImgSample(imgRoot);
    $(id).addEventListener('input', paint);
    $(id).addEventListener('change', paint);
  }

  // File ▸ Save Settings in Folder, where you actually meet it: the sheet says
  // these belong to the folder, so this is where you get to disagree. It takes
  // effect at once — Save then writes wherever this now points.
  $('imgProj').addEventListener('change', async () => {
    await tiny.api.call('setProjectSettings', { on: $('imgProj').checked });
    const info = await tiny.api.call('imageOptions');
    if (info && info.settings) {                     // the other scope's answer
      $('imgDest').value = info.settings.dest;
      $('imgFolder').value = info.settings.folder;
      $('imgNaming').value = info.settings.naming;
      $('imgTpl').value = info.settings.template || '';
      $('imgOptimize').value = info.settings.optimize;
      $('imgMax').value = info.settings.maxWidth;
      $('imgRootImg').value = info.settings.imageRoot || '';
      $('imgRootLink').value = info.settings.linkRoot || '';
      paintImgSample(imgRoot);
    }
  });

  async function closeImgSheet(save, scope) {
    if (imgshade.hidden) return;
    imgshade.hidden = true;
    const settings = save ? imgForm() : null;
    const r = await tiny.api.call('setImageOptions', { settings, scope: scope || null });
    const done = imgDone;
    imgDone = null;
    if (done) done(save ? (r && r.settings) || settings : null);
    if (!editing()) ed.focus();
  }

  async function showImageSettings() {
    const info = await tiny.api.call('imageOptions');
    if (!info) return;
    imgRoot = info.root;
    imgScope = info.scope;
    return openImageSettings(info, false);
  }

  $('imgCancel').onclick = () => closeImgSheet(false, imgScope);
  $('imgSave').onclick = () => closeImgSheet(true, imgScope);
  document.addEventListener('keydown', (e) => {
    if (imgshade.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeImgSheet(false, imgScope); }
    else if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
      e.preventDefault();
      closeImgSheet(true, imgScope);
    }
  });

  async function imageSettings() {
    const info = await tiny.api.call('imageOptions');
    if (!info) return null;
    if (!info.ask) return info.settings;
    imgRoot = info.root;
    imgScope = info.scope;
    const answered = await openImageSettings(info, true);
    return answered || info.settings;                // cancelled: this time, as it was
  }

  // ------------------------------------------------------------ the optimizer
  //
  // Right-click a picture in the tree (or a folder of them) and squeeze it
  // where it sits — the on-add pipeline above, pointed at files that are
  // already in. The shape is squoosh's: the first picture is the test bench —
  // the preview IS the re-encode, press it to see the original — and once the
  // settings look right, "This + the Rest" runs them over the remainder
  // without stopping again. Every write goes through the backend
  // (optimizeWrite), which replaces the file in place; a format change
  // renames it, and the links question at the end is the same one a rename
  // asks, summed over the batch.

  const optshade = $('optshade');
  const OPT_EXCLUDE = /\.(svg|gif)$/i;               // same rule as on-add
  let optQueue = [];                                 // paths still to look at
  let optSrc = null;                                 // the one on the bench
  let optPre = null;                                 // its original bytes (data URI)
  let optOut = null;                                 // the current re-encode
  let optOutUri = '';
  let optTick = 0;                                   // stale-recompute guard
  let optTimer = 0;
  let optStats = null;

  const optSettings = () => ({
    optimize: $('optFmt').value,                     // 'same' | 'webp'
    maxWidth: Math.max(0, Math.min(8000, parseInt($('optMax').value, 10) || 0)),
    quality: Math.max(30, Math.min(100, parseInt($('optQ').value, 10) || 82)),
  });

  const optLabel = (p) => {
    const root = tree.root();
    return root && p.startsWith(root + '/') ? p.slice(root.length + 1) : baseName(p);
  };

  async function optRecompute() {
    const tok = ++optTick;
    $('optQv').textContent = $('optQ').value;
    $('optdlgResult').textContent = 'Re-encoding…';
    $('optOne').disabled = true;
    const out = await optimizeImage(optSrc, optSettings(), optPre, true);
    if (tok !== optTick || optshade.hidden) return;  // superseded by another tweak
    optOut = out;
    if (out) {
      optOutUri = 'data:image/' + (out.format === 'jpg' ? 'jpeg' : out.format) + ';base64,' + out.data;
      $('optImg').src = optOutUri;
      const pct = Math.round((1 - out.now / out.was) * 100);
      $('optdlgResult').textContent = niceBytes(out.was) + ' → ' + niceBytes(out.now)
        + (pct > 0 ? '  (−' + pct + '%)' : '');
      $('optOne').disabled = false;
    } else {
      optOutUri = '';
      $('optImg').src = optPre ? optPre.data : '';
      $('optdlgResult').textContent = 'The original is already smaller than this re-encode — nothing to do.';
    }
  }
  const optKick = () => { clearTimeout(optTimer); optTimer = setTimeout(optRecompute, 120); };

  // The split: the original on the left of the divider, the re-encode on the
  // right — the two are the same picture at the same size (the original is
  // stretched over the result, and they share an aspect), so the seam is an
  // honest one. Dragging anywhere in the pane moves it.
  let optCutAt = 50;
  let optDragging = false;
  function optPaintCut() {
    $('optOrig').style.clipPath = 'inset(0 ' + (100 - optCutAt) + '% 0 0)';
    $('optCut').style.left = optCutAt + '%';
    $('optTagL').style.opacity = optCutAt < 14 ? 0 : 1;
    $('optTagR').style.opacity = optCutAt > 86 ? 0 : 1;
  }
  function optCutFrom(e) {
    const r = $('optWrap').getBoundingClientRect();
    if (!r.width) return;
    optCutAt = Math.max(2, Math.min(98, ((e.clientX - r.left) / r.width) * 100));
    optPaintCut();
  }
  $('optPane').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    optDragging = true;
    optCutFrom(e);
  });
  addEventListener('pointermove', (e) => { if (optDragging) optCutFrom(e); });
  addEventListener('pointerup', () => { optDragging = false; });

  async function optShow() {
    optSrc = optQueue.shift();
    optOut = null;
    optOutUri = '';
    const left = optQueue.length;
    $('optdlgWhich').textContent = optLabel(optSrc) + (left ? '  ·  ' + left + ' more after this' : '');
    $('optSkip').hidden = $('optAll').hidden = !left;
    $('optdlgResult').textContent = 'Loading…';
    $('optImg').removeAttribute('src');
    $('optOrig').removeAttribute('src');
    let pre = null;
    try { pre = await tiny.api.call('imageData', { src: optSrc }); } catch { /* gone */ }
    if (optshade.hidden) return;
    if (!pre || !pre.data) { optStats.skipped++; optNext(); return; }
    optPre = pre;
    $('optImg').src = pre.data;
    $('optOrig').src = pre.data;
    optPaintCut();
    optRecompute();
  }

  function optNext() {
    if (optQueue.length) optShow();
    else optFinish();
  }

  async function optApplyTo(path, out) {
    let r = null;
    try { r = await tiny.api.call('optimizeWrite', { path, data: out.data, format: out.format }); } catch { /* fall through */ }
    if (!r || !r.ok) { optStats.skipped++; return; }
    optStats.done++;
    optStats.was += out.was;
    optStats.now += out.now;
    if (r.from) optStats.renames.push({ from: r.from, to: r.path });
  }

  // Closing is finishing: whatever was already optimized stays optimized, so
  // the toast and the links question still belong here, cancel or not.
  async function optFinish() {
    if (optshade.hidden) return;
    optshade.hidden = true;
    clearTimeout(optTimer);
    optTick++;
    const s = optStats;
    if (s.done) {
      toast('Optimized ' + plural(s.done, 'picture') + ' — ' + niceBytes(s.was) + ' → ' + niceBytes(s.now)
        + (s.skipped ? ', ' + s.skipped + ' skipped' : ''));
    } else if (s.skipped) {
      toast('Nothing optimized');
    }
    const renames = s.renames;
    optStats = null;
    if (!editing()) ed.focus();
    await offerRefsMany(renames);
  }

  $('optCancel').onclick = () => optFinish();
  $('optSkip').onclick = () => { optStats.skipped++; optNext(); };
  $('optOne').onclick = async () => {
    if (!optOut) return;
    $('optOne').disabled = true;
    await optApplyTo(optSrc, optOut);
    optNext();
  };
  $('optAll').onclick = async () => {
    const s = optSettings();
    $('optOne').disabled = $('optAll').disabled = $('optSkip').disabled = true;
    if (optOut) await optApplyTo(optSrc, optOut);
    else optStats.skipped++;
    while (optQueue.length && !optshade.hidden) {
      const p = optQueue.shift();
      $('optdlgWhich').textContent = 'Optimizing ' + optLabel(p) + '…  ·  ' + optQueue.length + ' to go';
      const out = await optimizeImage(p, s, null, true);
      if (!optStats) return;                         // Escape closed it mid-encode
      if (out) await optApplyTo(p, out);
      else optStats.skipped++;
    }
    optFinish();
  };
  document.addEventListener('keydown', (e) => {
    if (optshade.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); optFinish(); }
  });

  async function openOptimizer(paths) {
    const info = await tiny.api.call('imageOptions'); // seeds the controls, no asking
    const s = (info && info.settings) || {};
    optQueue = paths.filter((p) => !OPT_EXCLUDE.test(p));
    if (!optQueue.length) { toast('Nothing to optimize — SVG and GIF are left alone'); return; }
    optStats = { done: 0, skipped: 0, was: 0, now: 0, renames: [] };
    $('optFmt').options[1].textContent = canWebp() ? 'WebP' : 'JPEG';
    $('optFmt').value = s.optimize === 'webp' ? 'webp' : 'same';
    $('optQ').value = s.quality || 82;
    $('optMax').value = s.maxWidth || 0;
    $('optOne').disabled = $('optAll').disabled = $('optSkip').disabled = false;
    $('optdlgTitle').textContent = optQueue.length > 1 ? 'Optimize Pictures' : 'Optimize Picture';
    optshade.hidden = false;
    optShow();
  }

  for (const id of ['optFmt', 'optQ', 'optMax']) {
    $(id).addEventListener('input', () => { if (!optshade.hidden) optKick(); });
    $(id).addEventListener('change', () => { if (!optshade.hidden) optKick(); });
  }

  // The batch's version of offerRefs: several pictures changed name in one
  // pass, so the question is asked once, over the sum.
  async function offerRefsMany(pairs) {
    if (!pairs || !pairs.length) return;
    if (pairs.length === 1) return offerRefs(pairs[0].from, pairs[0].to);
    let total = 0;
    const live = [];
    for (const p of pairs) {
      try {
        const scan = await tiny.api.call('scanRefs', { from: p.from, to: p.to });
        if (scan && scan.total) { total += scan.total; live.push(p); }
      } catch { /* skip this one */ }
    }
    if (!total) return;
    const ok = await tiny.dialog.confirm(
      `Update ${plural(total, 'link')} to ${plural(live.length, 'renamed picture')}?`, {
        detail: 'Converting the format changed these files’ names, and documents in this folder still point at the old ones.',
        ok: 'Update Links', cancel: 'Leave Them',
      });
    if (!ok) return;
    let links = 0, docs = 0;
    for (const p of live) {
      try {
        const r = await tiny.api.call('updateRefs', { from: p.from, to: p.to });
        if (r) { links += r.total; docs += r.changed; }
      } catch { /* skip this one */ }
    }
    if (links) toast(`Updated ${plural(links, 'link')} in ${plural(docs, 'document')}`);
  }

  // ------------------------------------------------------- picture handling
  //
  // In the editable preview a picture is a thing you can act on, not just
  // something to type around: click it for replace / alt text / remove. The
  // markdown is regenerated from the DOM afterwards like any other edit.

  // Not editing, and zoom is on: a picture is something to look at, so a
  // click shows the whole thing over the window (Escape or a click closes).
  const lightbox = $('lightbox');
  function hideLightbox() {
    lightbox.hidden = true;
    $('lightboxImg').removeAttribute('src');
  }
  function showLightbox(img) {
    const src = img.currentSrc || img.getAttribute('src');
    if (!src) return;                                // still resolving, or missing
    $('lightboxImg').src = src;
    $('lightboxCap').textContent = img.getAttribute('alt') || '';
    lightbox.hidden = false;
  }
  lightbox.addEventListener('click', hideLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.hidden) { e.preventDefault(); hideLightbox(); }
  });
  preview.addEventListener('click', (e) => {
    if (editing()) return;
    const img = e.target.closest('img');
    if (!img) return;
    selectImageMd(img);                  // the split's source pane follows the pick
    if (prefs.zoom) showLightbox(img);
  });

  // md.js wraps every image that has alt text in the .fig span the caption is
  // drawn from — this is the same thing for pictures inserted or retitled
  // since the last render, so captions never lag behind the alt text.
  function refigure(img) {
    const alt = img.getAttribute('alt') || '';
    const fig = img.parentElement && img.parentElement.classList.contains('fig')
      ? img.parentElement : null;
    if (alt && fig) fig.dataset.alt = alt;
    else if (alt) {
      const span = document.createElement('span');
      span.className = 'fig';
      span.dataset.alt = alt;
      img.replaceWith(span);
      span.appendChild(img);
    } else if (fig) fig.replaceWith(img);
  }

  // Picking a picture in the preview selects its markdown in the source —
  // the ![alt](path) IS the thing you just clicked, so the other pane shows
  // it as the selection. Deliberately no scroll and no focus steal: scrolling
  // the source would drag the preview along through scroll-sync and yank the
  // picture out from under the click, and the focus belongs to the preview
  // (or the image bar's alt field). Duplicated images resolve by distance
  // from the block the click landed in, the way undo's landing does.
  function selectImageMd(img) {
    if (kind !== 'doc') return;
    const src = img.dataset.src || img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    const v = ed.value;
    const block = img.closest('[data-line]');
    let want = 0;
    if (block) {
      for (let k = +block.dataset.line; k > 0; k--) {
        const nl = v.indexOf('\n', want);
        if (nl < 0) break;
        want = nl + 1;
      }
    }
    let hit = null;
    const re = /!\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))[^)]*\)/g;
    for (let m; (m = re.exec(v)); ) {
      if ((m[1] || m[2]) !== src) continue;
      if (!hit || Math.abs(m.index - want) < Math.abs(hit.index - want)) hit = m;
    }
    if (hit) ed.setSelectionRange(hit.index, hit.index + hit[0].length);
  }

  const imagePop = $('imagePop');
  const altField = $('imageAlt');
  let picked = null;

  function hideImagePop() {
    imagePop.hidden = true;
    if (picked) picked.classList.remove('picked');
    picked = null;
  }

  function showImagePop(img, focusAlt) {
    if (picked && picked !== img) picked.classList.remove('picked');
    picked = img;
    img.classList.add('picked');
    $('imageName').textContent = img.dataset.src || 'image';
    if (document.activeElement !== altField) altField.value = img.getAttribute('alt') || '';
    imagePop.hidden = false;
    if (focusAlt) { altField.focus(); altField.select(); }
    const r = img.getBoundingClientRect();
    const w = imagePop.offsetWidth, h = imagePop.offsetHeight;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    imagePop.style.left = Math.round(x) + 'px';
    imagePop.style.top = Math.round(r.top - h - 8 > 6 ? r.top - h - 8 : r.bottom + 8) + 'px';
  }

  // A click on a picture opens the bar; a click on its caption — which is a
  // pseudo-element, so the .fig around the picture is what gets hit — opens it
  // with the cursor already in the alt field, since that IS the caption.
  preview.addEventListener('click', (e) => {
    if (!editing()) return;
    const img = e.target.closest('img');
    const fig = e.target.closest('.fig');
    if (!img && !fig) { hideImagePop(); return; }
    e.preventDefault();
    const it = img || fig.querySelector('img');
    showImagePop(it, !img);
    selectImageMd(it);
    live.hideBubble();
  });

  // Mousedown inside the bar must not steal the caret from the preview — the
  // alt field is the exception, it's a real input and needs the focus.
  imagePop.addEventListener('mousedown', (e) => {
    if (!e.target.closest('input')) e.preventDefault();
  });

  // Alt text, live: every keystroke updates the picture and the caption under
  // it, and the Markdown catches up on the usual serialize pause.
  altField.addEventListener('input', () => {
    if (!picked) return;
    picked.setAttribute('alt', altField.value);
    refigure(picked);
    queueSerialize();
  });
  altField.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    flushLive();
    hideImagePop();
    preview.focus();
  });

  imagePop.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !picked) return;
    const img = picked;

    if (b.dataset.act === 'remove') {
      img.remove();
      hideImagePop();
      queueSerialize();
      return;
    }
    // replace: same copy-next-to-the-document path as pasting one
    const picks = await tiny.dialog.openFiles({ types: IMG_TYPES });
    const file = (picks || []).filter(isImage)[0];
    if (!file) return;
    const placed = await placeImage(file);
    if (!placed) return;
    const named = placed.rel || placed.name;
    img.dataset.src = named;
    img.removeAttribute('src');
    if (!img.getAttribute('alt')) {
      img.setAttribute('alt', placed.name.replace(/\.[^.]*$/, ''));
    }
    refigure(img);
    altField.value = img.getAttribute('alt') || '';
    imgCache.delete(named);                          // it may have changed on disk
    inlineImages();
    hideImagePop();
    queueSerialize();
    toast('Replaced with ' + placed.name);
  });

  document.addEventListener('mousedown', (e) => {
    if (!imagePop.hidden && !imagePop.contains(e.target) && !e.target.closest('#preview img')) {
      hideImagePop();
    }
  });
  previewPane.addEventListener('scroll', () => { if (picked) showImagePop(picked); });

  // ------------------------------------------------------------- editable
  //
  // The ✎ Editable toggle: make the rendered article contenteditable and
  // serialize it back to Markdown (unmd.js) as you type. The textarea stays
  // the document of record — it's just being written to from the other end,
  // which is why Split can have a caret in either half at once. Editor Only
  // has no preview on screen, so the toggle grays out there.

  let editableOn = !!boot.editable;
  const editing = () => preview.isContentEditable;
  const inPreview = () =>
    editing() && (document.activeElement === preview || preview.contains(document.activeElement));

  // `fresh` says the preview already holds a just-rendered DOM for the NEW
  // sheet (loadSheet calls with it) — so switching editable off must neither
  // serialize (it would write this sheet's DOM over its own source — or an
  // AsciiDoc file's) nor render again.
  function applyEditable(persist, fresh) {
    const enabled = view !== 'edit' && !isAdoc() && !isJson();  // both render one-way
    const want = editableOn && enabled;
    $('btnEditable').disabled = !enabled;
    $('btnEditable').classList.toggle('on', want);
    document.body.toggleAttribute('data-editable', want);

    if (want !== editing()) {
      if (want) {
        if (!fresh) render();                        // a fresh DOM to edit
        preview.contentEditable = 'true';
        preview.spellcheck = true;
        document.execCommand('defaultParagraphSeparator', false, 'p');
      } else {
        // keep what was typed — and only what was TYPED: with nothing
        // pending the source is already current, and serializing anyway
        // would rewrite the file's soft line breaks for a toggle
        if (!fresh && livePending) serializeLive();
        preview.contentEditable = 'false';
        preview.spellcheck = false;
        if (live) live.hideBubble();
        if (!fresh) render();
      }
    }
    tiny.api.call('setEditable', { on: editableOn, enabled, persist: !!persist });
  }
  function toggleEditable() {
    if (view === 'edit') return;
    editableOn = !editableOn;
    applyEditable(true);
    if (editableOn) preview.focus();
    else ed.focus();
  }
  $('btnEditable').onclick = toggleEditable;

  let liveTimer = null;
  let livePending = false;             // a Live edit is queued but not yet serialized
  const queueSerialize = () => {
    clearTimeout(liveTimer);
    livePending = true;
    liveTimer = setTimeout(serializeLive, 260);
  };

  // Typing in the preview moves every line below the caret, but nothing
  // re-renders (that would take the caret with it) — so the data-line stamps
  // go stale the moment you press Return, and the pairing drifts a line
  // further out with every one after that.
  //
  // Fix without touching the live DOM: render the new source into a detached
  // tree, check it came out the same shape, and copy the fresh line numbers
  // across. Only attributes change, so the caret never notices.
  const STAMPED = 'p,h1,h2,h3,h4,h5,h6,ul,ol,li,pre,table,blockquote,hr,details,div';

  function restamp() {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderMarkdown(renderSrc(), mdOpts());
    // What's INSIDE a math or mermaid island doesn't count: the live one
    // holds MathML / SVG (whose foreignObject divs would match), the fresh
    // one holds the code fallback — same document, different innards.
    const grab = (root) => [...root.querySelectorAll(STAMPED)].filter((el) => {
      const isl = el.closest('.mm, .math');
      return !isl || isl === el;
    });
    const fresh = grab(tmp);
    const live = grab(preview);
    if (fresh.length !== live.length) return false;
    for (let i = 0; i < fresh.length; i++) {
      if (fresh[i].tagName !== live[i].tagName) return false;   // shapes diverged
    }
    for (let i = 0; i < fresh.length; i++) {
      const line = fresh[i].dataset.line;
      if (line == null) delete live[i].dataset.line;
      else live[i].dataset.line = line;
    }
    return true;
  }

  function serializeLive() {
    clearTimeout(liveTimer);
    livePending = false;
    if (!editing()) return;
    // Patch, don't rewrite: blocks the user didn't touch keep their source
    // lines byte-for-byte — hard wraps, reference definitions and all — and
    // only the edited ones are serialized fresh (patchMarkdown in unmd.js).
    // Where byte-precision can't be proven it returns null, and the whole
    // document serializes the way it always did.
    const tmp = document.createElement('div');
    tmp.innerHTML = renderMarkdown(renderSrc(), mdOpts());
    const md = window.patchMarkdown(ed.value, preview, tmp)
      || htmlToMarkdown(preview);
    if (md === ed.value) return;
    ed.value = md;                                   // no input event: the
    setDirty();                                      // preview must NOT be
    updateStatus();                                  // re-rendered under the
    restamp();                                       // caret
    buildOutline();
    paintSource();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 400);
  }
  // Anything that needs the source to be current right now — but ONLY when
  // something is actually pending. Serializing an untouched document is not
  // harmless: the DOM has no memory of the source's hard-wrapped lines, so a
  // round-trip rewrites every soft break in the file. Unguarded, the window-
  // blur flush did exactly that — open a document with Editable on, close
  // it, and the blur "flushed" zero edits into a 59-line rewrite, a phantom
  // dirty dot, and a draft that resurrected on the next open.
  const flushLive = () => { if (editing() && livePending) serializeLive(); };

  preview.addEventListener('input', queueSerialize);
  preview.addEventListener('blur', flushLive);

  // Markdown-as-you-type + the selection bubble (live.js). Both no-op unless
  // the preview is editable.
  const live = setupLiveEditing({
    preview,
    bubble: $('bubble'),
    changed: queueSerialize,
    // a hard undo boundary at the state just before an input rule rewrites
    // the block — ⌘Z lands exactly on what was typed, not mid-burst
    mark: () => { flushLive(); history.record(ed.value, true); },
    link: insertLink,
    langPop: $('langPop'),
    langPick: $('langPick'),
  });

  // ------------------------------------------------------------------ emoji
  //
  // Insertion has to work for both editing surfaces, and the picker steals
  // focus while it's open — so the preview's range is stashed on the way out
  // and put back on the way in. The textarea remembers its own selection.

  let savedRange = null;
  preview.addEventListener('blur', () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && preview.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  });
  let lastSurface = 'ed';
  ed.addEventListener('focus', () => { lastSurface = 'ed'; });
  preview.addEventListener('focus', () => { lastSurface = 'preview'; });

  // The whole document, replaced, as ONE undo step — and left dirty, because
  // something that rewrites your file should still need a ⌘S. Two callers now:
  // an action whose output is "replace", and a model's edit_document, which
  // takes this route precisely so ⌘Z can take it back.
  function applyWholeText(text) {
    if (kind !== 'doc') return;
    const at = Math.min(ed.selectionStart, text.length);
    const top = ed.scrollTop;
    ed.value = text;
    history.record(ed.value, true);
    ed.setSelectionRange(at, at);
    onInput();
    ed.scrollTop = top;
    edBack.scrollTop = top;
    find.refresh();
  }

  function insertText(text, opts) {
    const select = !!(opts && opts.select);
    if (editing() && lastSurface === 'preview') {
      preview.focus();
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      document.execCommand('insertText', false, text);
      if (select) selectBack(text.length);
      queueSerialize();
      return;
    }
    ed.focus();
    ed.setRangeText(text, ed.selectionStart, ed.selectionEnd, select ? 'select' : 'end');
    onInput();
  }

  // The last n characters before the caret, selected — how an action's
  // answer is handed back still highlighted (insertText {select}): you see
  // exactly what it wrote, and can run another action straight on it. Walks
  // text nodes leftward so it survives execCommand splitting the insertion
  // across highlight spans. (A multi-line answer split into new BLOCKS has
  // no text node for its newlines — the walk then reaches a hair further
  // left than the insertion; the common one-line answer is exact.)
  function selectBack(n) {
    const sel = window.getSelection();
    if (!n || !sel || !sel.rangeCount) return;
    const caret = sel.getRangeAt(0);
    let node = caret.startContainer, off = caret.startOffset;
    if (node.nodeType !== 3) {
      node = node.childNodes[off - 1];
      while (node && node.nodeType !== 3 && node.lastChild) node = node.lastChild;
      if (!node || node.nodeType !== 3) return;
      off = node.nodeValue.length;
    }
    const endNode = node, endOff = off;
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
    walker.currentNode = node;
    let left = n;
    while (off < left) {
      left -= off;
      const prev = walker.previousNode();
      if (!prev) { off = 0; break; }
      node = prev;
      off = node.nodeValue.length;
    }
    const r = document.createRange();
    r.setStart(node, Math.max(0, off - left));
    r.setEnd(endNode, endOff);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  const emoji = setupEmoji({
    button: $('btnEmoji'), pop: $('emojiPop'), search: $('emojiSearch'),
    tabs: $('emojiTabs'), grid: $('emojiGrid'),
    insert: insertText, recentKey: 'nib.emoji.recent',
  });

  // ------------------------------------------------------------- @ mentions
  //
  // Type @ anywhere in the document — source pane or editable preview — and
  // the project's files come up under the caret. Pick one and you get a link,
  // or the picture itself if that's what it was, with a path relative to THIS
  // document. Escape dismisses and leaves the @ you typed exactly where it is,
  // so @ is still a character you can write.

  // Relative to the document — but only when the document is actually inside
  // the project. A note kept somewhere else would otherwise get a link made
  // of a dozen ../, which is both unreadable and one move away from breaking.
  // Markdown markers don't belong in a link's TEXT — `**Big** plans` names
  // the heading, "Big plans" labels the link.
  const cleanHead = (s) => String(s)
    .replace(/\[([^\]]*)\]\([^))]*\)/g, '$1').replace(/[*_`~]/g, '').trim();
  // What a file answers to: its frontmatter title, else its first largest
  // heading (the heading index), else its filename — the old label, now the
  // fallback. A picked heading brings its own text and a #fragment.
  const titleOf = (f) => {
    const hx = tree.heads()[f.orel || f.rel];
    if (!hx) return null;
    if (hx.title) return hx.title;
    if (!hx.heads.length) return null;
    const top = Math.min(...hx.heads.map((h) => h.level));
    return cleanHead(hx.heads.find((h) => h.level === top).text) || null;
  };
  // Format ▸ Link Options: a heading link can carry the whole trail above it
  // — H1 › H2 › SMS — joined by the separator of your choice. The trail is
  // read out of the heading index: walk back from the picked heading, keeping
  // each nearest-shallower heading until a top-level one closes it.
  const SEP = { chev: ' › ', gt: ' > ', slash: ' / ', dash: ' — ', colon: ': ' };
  const sepOf = () => SEP[prefs.linkSep] || SEP.chev;
  const headTrail = (f) => {
    const hx = tree.heads()[f.orel || f.rel];
    const i = hx ? hx.heads.findIndex((h) => h.slug === f.head.slug) : -1;
    if (i < 0) return [f.head];
    const trail = [hx.heads[i]];
    let lvl = hx.heads[i].level;
    for (let j = i - 1; j >= 0 && lvl > 1; j--) {
      if (hx.heads[j].level < lvl) { trail.unshift(hx.heads[j]); lvl = hx.heads[j].level; }
    }
    return trail;
  };
  const headLabel = (f) => (prefs.linkPath ? headTrail(f) : [f.head])
    .map((h) => cleanHead(h.text)).filter(Boolean).join(sepOf());
  // How the path is written (Format ▸ Link Options): relative to the document
  // (the default), /from the folder's configured root, or /from the closest
  // PINNED folder above the document — the language-site pattern, where
  // everything in en/ writes /sms/index.md for en/sms/index.md. Either /-mode
  // falls back to relative when the document or the target lives outside its
  // base, so a link is never written that couldn't resolve.
  const linkTarget = (f, image) => {
    const root = tree.root();
    const inside = docDir && root && (docDir === root || docDir.startsWith(root + '/'));
    if (!inside) return f.path;
    if (prefs.linkFrom === 'pin') {
      const pin = Object.keys(tree.pins())
        .filter((d) => docDir === d || docDir.startsWith(d + '/'))
        .sort((a, b) => b.length - a.length)
        .find((d) => f.path.startsWith(d + '/'));
      if (pin) return '/' + f.path.slice(pin.length + 1);
    } else if (prefs.linkFrom === 'root') {
      const r = tree.roots();
      const base = root + ((image ? r.image : r.link) ? '/' + (image ? r.image : r.link) : '');
      if (f.path.startsWith(base + '/')) return '/' + f.path.slice(base.length + 1);
    }
    return relativeTo(docDir, f.path);
  };
  const linkFor = (f) => {
    const image = f.kind === 'image';
    const rel = linkTarget(f, image);
    const label = (f.head && headLabel(f))
      || (!image && titleOf(f))
      || f.name.replace(/\.[^.]*$/, '');
    return { rel, label, image, frag: f.head ? f.head.slug : null };
  };

  // in the textarea: put the markdown at `from`, swallowing the @ if one is
  // there (the menu route inserts at a caret with nothing to replace)
  function mentionIntoSource(from, f, replace = 1) {
    const { rel, label, image, frag } = linkFor(f);
    const md = (image ? '!' : '') + `[${label}](${mdTarget(rel + (frag ? '#' + frag : ''))})`;
    ed.focus();
    ed.setRangeText(md, from, from + replace, 'end');
    onInput();
  }

  // In the editable preview: put the caret back where it was — the palette's
  // own input took the focus, and without restoring the range WebKit inserts
  // at the top of the document — drop the @ behind it, then insert.
  function mentionIntoPreview(f, saved) {
    const { rel, label, image, frag } = linkFor(f);
    const target = rel + (frag ? '#' + frag : '');
    // preventScroll: a bare focus() scrolls the pane to wherever WebKit last
    // remembered a selection — nowhere near the @ being replaced
    preview.focus({ preventScroll: true });
    const sel = window.getSelection();
    const put = saved || savedRange;
    if (put) {
      sel.removeAllRanges();
      sel.addRange(put);
    }
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (r.startContainer.nodeType === 3 && r.startOffset > 0
        && r.startContainer.nodeValue[r.startOffset - 1] === '@') {
      r.setStart(r.startContainer, r.startOffset - 1);
      r.deleteContents();
    }
    // The space typed just before the @ is an &nbsp; in WebKit's book (it was
    // trailing when it went in); with the link after it it's mid-line, so make
    // it an ordinary space rather than write U+00A0 into the file.
    const t = r.startContainer;
    if (t.nodeType === 3 && r.startOffset > 0 && t.nodeValue[r.startOffset - 1] === '\u00A0') {
      t.replaceData(r.startOffset - 1, 1, ' ');
    }
    // Plain Range surgery, NOT execCommand('insertHTML'): WebKit's replace-
    // selection cleanup deletes "insignificant" whitespace around the caret,
    // and the space before the @ counts once the @ is gone — links used to
    // eat it. insertNode touches nothing around the insertion point.
    let node;
    if (image) {
      node = document.createElement('span');
      node.className = 'fig';
      node.dataset.alt = label;
      const img = document.createElement('img');
      img.dataset.src = rel;
      img.alt = label;
      node.append(img);
    } else {
      node = document.createElement('a');
      node.setAttribute('href', target);
      node.textContent = label;
    }
    r.deleteContents();
    r.insertNode(node);
    // A perch after the link — the same U+200B the input rules leave, and
    // unmd strips. Without it the caret has no position after the link, so
    // the next thing typed (say, the space before another @) lands INSIDE
    // it, where the label's trim() quietly eats it.
    const tail = document.createTextNode('​');
    node.after(tail);
    r.setStart(tail, tail.nodeValue.length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    node.scrollIntoView({ block: 'nearest' });      // no-op when already visible
    inlineImages();
    queueSerialize();
  }

  // Both surfaces, one palette. `at` is the caret's rect, so the list opens
  // where you are typing rather than in the middle of the window. `back` is
  // what esc means here — "keep typing", as the hint promises — so it puts
  // the focus and the caret back where the @ was typed. Only for esc: a
  // click-away went somewhere else on purpose.
  function mentionPalette({ at, into, back }) {
    if (!tree.has()) return;
    const pin = pinView();
    palette.open({
      files: pin.files(tree.files()),
      heads: tree.heads(),
      placeholder: 'Link a file…',
      hintText: (pin.label ? pin.label + ' · ' : '')
        + '⏎ links it · ⇥ a heading in it · esc keeps typing',
      at,
      pick: into,
      cancel: (byKey) => { if (byKey && back) back(); },
    });
  }

  function mentionFromSource(from) {
    const rect = peer.caretRect(from);
    mentionPalette({
      at: rect || null,
      into: (f) => mentionIntoSource(from, f),
      back: () => { ed.focus(); ed.setSelectionRange(from + 1, from + 1); },
    });
  }

  function mentionFromPreview() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const here = sel.getRangeAt(0).cloneRange();         // the caret, kept
    const r = here.cloneRange();
    let rect = r.getBoundingClientRect();
    if (!rect.height && r.startContainer.nodeType === 3 && r.startOffset > 0) {
      r.setStart(r.startContainer, r.startOffset - 1);   // a collapsed range
      rect = r.getBoundingClientRect();                  // can measure as 0×0
    }
    mentionPalette({
      at: rect.height ? rect : null,
      into: (f) => mentionIntoPreview(f, here),
      back: () => {
        preview.focus();
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(here);
      },
    });
  }

  // An @ only summons the picker at the start of a word — otherwise typing an
  // email address would open it mid-word, which is worse than useless.
  const typedAt = (e) => e.data && e.data.endsWith('@')
    && (!e.inputType || e.inputType.startsWith('insertText'));
  // …meaning: not straight after a word. Punctuation is fine, an email is not.
  const opensMention = (before) => !before || !/[\w.+-]$/.test(before);

  ed.addEventListener('input', (e) => {
    if (!typedAt(e) || !tree.has()) return;
    const at = ed.selectionStart - 1;
    if (opensMention(ed.value.slice(Math.max(0, at - 1), at))) mentionFromSource(at);
  });
  preview.addEventListener('input', (e) => {
    if (!typedAt(e) || !tree.has() || !editing()) return;
    const sel = window.getSelection();
    const n = sel && sel.anchorNode;
    const before = n && n.nodeType === 3 && sel.anchorOffset >= 2
      ? n.nodeValue.slice(sel.anchorOffset - 2, sel.anchorOffset - 1) : '';
    if (opensMention(before)) mentionFromPreview();
  });

  // Go ▸ Link to a File… is the same picker without the @ — it inserts at the
  // caret, and takes the character it replaces with it (there isn't one).
  function insertFileLink() {
    if (!tree.has()) return;
    const inPv = editing() && lastSurface === 'preview';
    const from = ed.selectionStart;
    const replace = ed.selectionEnd - from;
    const pin = pinView();
    palette.open({
      files: pin.files(tree.files()), heads: tree.heads(),
      placeholder: 'Link a file…',
      hintText: (pin.label ? pin.label + ' · ' : '')
        + '⏎ links it · ⇥ a heading in it · esc to dismiss',
      pick: (f) => insertPick(f, { from, replace, inPv }),
      // esc goes back to the editor, selection as it was (same promise the
      // @ mention makes; savedRange holds the preview's own)
      cancel: (byKey) => {
        if (!byKey) return;
        if (inPv) {
          preview.focus();
          if (savedRange) {
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(savedRange);
          }
        } else {
          ed.focus();
          ed.setSelectionRange(from, from + replace);
        }
      },
    });
  }

  // Where a picked file actually lands. The caret has to be remembered BEFORE
  // the palette (or the tree, or a menu) takes the focus — after that the
  // textarea's selection is stale and the preview's range is gone entirely.
  function insertPick(f, { from, replace = 0, inPv }) {
    if (!inPv) { mentionIntoSource(from, f, replace); return; }
    preview.focus();
    if (savedRange) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(savedRange);
    }
    mentionIntoPreview(f);              // no @ behind the caret: it just inserts
  }

  // Go ▸ Rename File… — the tree's ⏎, reachable from the editor. It renames
  // whatever the tree's cursor is on, and otherwise the document you're in.
  function renameCurrent() {
    if (!tree.has()) return;
    setFiles(true);
    let n = tree.node();
    if ((!n || (path && n.path !== path)) && path) {
      tree.showing(path);
      n = tree.node();
    }
    if (n) tree.rename(n);
    else toast('Pick a file in the tree first.');
  }

  // Files ▸ right-click ▸ Insert Link Here. Same insertion, no picker: the
  // file is the one you right-clicked.
  function insertNodeLink(node) {
    if (kind !== 'doc') return;
    insertPick({ path: node.path, name: node.name, kind: node.kind }, {
      from: ed.selectionStart,
      replace: ed.selectionEnd - ed.selectionStart,
      inPv: editing() && lastSurface === 'preview',
    });
  }

  // Tab indents — the whole block of lines when the selection spans more
  // than one, and ⇧⇥ outdents it (nibIndent, shared with the preview's code
  // blocks); a plain caret just gets two spaces. Enter continues lists
  // ("- ", "1. ", "- [ ] ", "> ")
  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ed.selectionStart, en = ed.selectionEnd;
      if (e.shiftKey || ed.value.slice(s, en).includes('\n')) {
        const r = window.nibIndent(ed.value, s, en, e.shiftKey);
        if (!r) return;
        ed.setRangeText(r.block, r.from, r.to);
        ed.setSelectionRange(r.start, r.end);
      } else {
        ed.setRangeText('  ', s, en, 'end');
      }
      onInput();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // ⌘⏎ — a page break at the caret, same as in the editable preview
      e.preventDefault();
      ed.setRangeText('\n\n\\newpage\n\n', ed.selectionStart, ed.selectionEnd, 'end');
      onInput();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
      const v = ed.value, at = ed.selectionStart;
      const lineStart = v.lastIndexOf('\n', at - 1) + 1;
      const line = v.slice(lineStart, at);
      const m = line.match(/^(\s*)([-*+]|\d+[.)]|>)(\s+\[[ xX]\])?(\s+)/);
      if (!m) return;
      e.preventDefault();
      if (line.trim() === m[0].trim()) {             // empty item ends the list
        ed.setRangeText('\n', lineStart, at, 'end');
      } else {
        let marker = m[2];
        const n = parseInt(marker, 10);
        if (!isNaN(n)) marker = (n + 1) + marker.slice(String(n).length);
        const box = m[3] ? ' [ ]' : '';
        ed.setRangeText('\n' + m[1] + marker + box + m[4], at, ed.selectionEnd, 'end');
      }
      onInput();
    }
  });

  // ------------------------------------------------------------------ menu

  // Everything that writes, prints or formats needs a document under it; on a
  // picture those items would act on the empty editor behind the viewer.
  const DOC_ONLY = new Set(['save', 'saveas', 'export', 'print', 'pdf', 'editable',
    'insertlink', 'fmt:bold', 'fmt:italic', 'fmt:code', 'fmt:link', 'fmt:image',
    'fmt:emoji', 'find', 'find:replace', 'find:next', 'find:prev']);

  tiny.menu.on((id) => {
    if (!document.hasFocus()) return;                // someone else's event
    menuAct(id);
  });

  // The page's half of a menu click — named so the command palette can fire
  // it directly: a palette pick IS a menu click, minus the mouse.
  async function menuAct(id) {
    if (kind === 'image' && DOC_ONLY.has(id)) { toast('That tab is a picture.'); return; }
    if (id === 'new') tiny.api.call('newDoc');
    else if (id === 'open') {
      const picks = await tiny.dialog.openFiles({ types: [...DOC_TYPES, ...IMG_TYPES] });
      if (picks) tiny.api.call('openPaths', { paths: picks });
    }
    else if (id === 'save') doSave(false);
    else if (id === 'saveas') doSave(true);
    else if (id === 'export') doExport();
    else if (id === 'print') doPrint();
    else if (id === 'pdf') doPdf();
    else if (id === 'closetab') closeTab();
    else if (id === 'closewin') tiny.api.call('closeWindow');
    // 'newwindow' is the backend's alone — answering it here as well opened two
    else if (id === 'tab:next') stepTab(1);
    else if (id === 'tab:prev') stepTab(-1);
    else if (id === 'fmt:bold') wrapSelection('**');
    else if (id === 'fmt:italic') wrapSelection('*');
    else if (id === 'fmt:code') wrapSelection('`');
    else if (id === 'fmt:link') insertLink();
    else if (id === 'fmt:image') pickImage();
    // The menu item is now a shortcut into Settings. The small sheet still
    // exists and still shows itself the first time you paste into a folder —
    // that one is a question about the thing you just did, and answering it
    // in a seven-section window would be the wrong size of interruption.
    else if (id === 'fmt:imgopts') tiny.api.call('openSettings', { section: 'images' });
    else if (id === 'fmt:emoji') emoji.toggle();
    else if (id === 'fmt:json') formatJsonNow();
    else if (id === 'outline') setOutline(!outlineOn, true);
    else if (id === 'files') setFiles(!filesOn);
    else if (id === 'editable') toggleEditable();
    else if (id === 'check-updates') checkForUpdatesUI();
    else if (id === 'default-md') makeDefaultUI();
    else if (id === 'install-cli') installCliUI();
    else if (id === 'openfolder') pickFolder();
    else if (id === 'find') find.open({ seed: findSeed() });
    else if (id === 'find:replace') find.open({ replace: true, seed: findSeed() });
    else if (id === 'find:next') find.next();
    else if (id === 'find:prev') find.prev();
    else if (id === 'find:folder') openSearch();
    else if (id === 'quickopen') quickOpen();
    else if (id === 'palette') quickOpen('>');
    else if (id === 'insertlink') insertFileLink();
    else if (id === 'renamefile') renameCurrent();
    else if (id.startsWith('view:')) setView(id.slice(5), true);
    else if (id.startsWith('theme:')) tiny.api.call('setTheme', { theme: id.slice(6) });
  }

  // ---------------------------------------------------------- scroll sync
  //
  // Not a ratio — ratios drift the moment one pane has a tall code block or a
  // collapsed tab. Take the line at the top of the source pane, find the
  // block it rendered into, and put that block at the top of the preview
  // (interpolating inside blocks that span several lines). Backwards is the
  // same idea, skipping blocks that have no box because they're in a tab
  // nobody has opened.

  ed.addEventListener('scroll', () => {
    edBack.scrollTop = ed.scrollTop;                 // the backdrop rides along
    if (locked()) return;
    lockSync(90);
    peer.scrollPreviewTo(peer.editorAnchor());
  });
  previewPane.addEventListener('scroll', () => {
    if (locked()) return;
    lockSync(90);
    peer.scrollEditorTo(peer.previewAnchor());
  });

  // ------------------------------------------------------------- splitter

  const gutter = $('gutter');
  gutter.addEventListener('pointerdown', (e) => {
    gutter.setPointerCapture(e.pointerId);
    gutter.classList.add('drag');
    const move = (ev) => {
      // Measured across the two panes only — the sidebars sit either side of
      // them and would otherwise offset every drag. The result is a pair of
      // grow factors, so the split holds when a sidebar opens or closes.
      const pane = document.getElementById('editorPane');
      const pv = document.getElementById('previewPane');
      const left = pane.getBoundingClientRect().left;
      const right = pv.getBoundingClientRect().right;
      const pct = Math.min(80, Math.max(20, ((ev.clientX - left) / (right - left)) * 100));
      document.body.style.setProperty('--edw', pct.toFixed(2));
      document.body.style.setProperty('--pvw', (100 - pct).toFixed(2));
    };
    const up = () => {
      gutter.classList.remove('drag');
      gutter.removeEventListener('pointermove', move);
      gutter.removeEventListener('pointerup', up);
    };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', up);
  });

  // The sidebar grips work the same way; the width only reaches the store on
  // pointer-up, so a drag is one write. Double-click puts the stock width back.
  function paneGrip(id, pane, widthAt) {
    const grip = $(id);
    const set = (w) => {
      paneW[pane] = w;
      const v = pane === 'files' ? '--filw' : '--outw';
      document.body.style.setProperty(v, w + 'px');       // grip exists ⇒ pane is open
      document.body.style.setProperty(v + '-open', w + 'px');
    };
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('drag');
      const move = (ev) => set(clampPane(widthAt(ev.clientX)));
      const up = () => {
        grip.classList.remove('drag');
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        tiny.api.call('setPaneWidth', { pane, w: paneW[pane] });
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', () => {
      set(PANE_DEF[pane]);
      tiny.api.call('setPaneWidth', { pane, w: paneW[pane] });
    });
  }
  paneGrip('filesGrip', 'files', (x) => x - $('files').getBoundingClientRect().left);
  paneGrip('outlineGrip', 'outline', (x) => $('outline').getBoundingClientRect().right - x);

  // -------------------------------------------------------------- actions
  //
  // The ⚡ in the toolbar, the Actions menu, and the file tree's right-click
  // all end up in actions.js. This is only the seam: what the document knows
  // (which file, what is selected, where the caret is) and what an action's
  // output is allowed to do to it.

  const actions = setupActions({
    button: $('btnActions'), menu: $('actMenu'),
    panel: $('runPanel'), grip: $('runGrip'), out: $('runOut'), head: $('runHead'),
    title: $('runTitle'), meta: $('runMeta'), dot: $('runDot'),
    stop: $('runStop'), clear: $('runClear'), close: $('runClose'),
    shade: $('trustShade'), sheet: $('trustSheet'),
    pins: $('actPins'),
    // selection actions ride in live.js's format bubble as a ⚡ menu — the
    // bubble is re-measured when the ⚡ appears or goes away
    bubble: $('bubble'), bubbleActs: $('bubbleActs'), bubbleActsMenu: $('bubbleActsMenu'),
    onSelActs: () => live.positionBubble(),
    context: () => {
      const a = ed.selectionStart, b = ed.selectionEnd;
      const before = ed.value.slice(0, a);
      return {
        file: path || null,
        sheetId,
        text: ed.value,
        dirty,
        sel: editing() && inPreview() ? String(getSelection()) : ed.value.slice(a, b),
        line: before.split('\n').length - 1,
        col: a - (before.lastIndexOf('\n') + 1),
        heading: headingAtCaret(),
      };
    },
    // output: "replace" — the whole document, as its own undo step, left
    // DIRTY. A command that rewrites your file should still need a ⌘S.
    applyText: applyWholeText,
    insertText,
    toast,
    onBusy: (on) => $('btnActions').classList.toggle('busy', on),
    onManage: () => actionEditor.open('global'),
  });

  // Manage Actions (⌥⌘A) — the form over the file. It asks the backend which
  // actions files exist right now, so a window with no folder open simply
  // isn't offered one, rather than being shown a door that doesn't open.
  const actionEditor = setupActionEditor({
    open: async () => {
      const out = [];
      const mine = await tiny.api.call('actionsFile', { scope: 'global' });
      if (mine && !mine.error) out.push({ scope: 'global', name: 'My Actions' });
      const theirs = await tiny.api.call('actionsFile', { scope: 'project' });
      if (theirs && !theirs.error) out.push({ scope: 'project', name: theirs.name });
      return out;
    },
    onRun: (scope, id) => actions.runById(scope, id),
    toast,
    // the Icon field borrows the toolbar's emoji picker rather than owning one
    pickEmoji: (btn, cb) => emoji.openFor(btn, cb),
    closeEmoji: () => emoji.close(),
  });
  tiny.api.on('manage-actions', () => actionEditor.open('global'));

  // Actions offered on a selection appear inside the format bubble (live.js)
  // as a ⚡ menu — actions.js owns the button and menu, so nothing to wire
  // here beyond the elements handed to setupActions above. Deliberately only
  // in the editable preview: in the raw source the same actions are a ⚡ away.

  // AI: the settings panel, and the sheet a tool has to get past before it
  // does anything. Both are page-side for the same reason the trust sheet is
  // — a dialog is a page, and the decision belongs to the person at it.
  // Only the approval half lives here: the sheet a model has to get past, and
  // the document rewrite it makes when you say yes. Providers, keys and limits
  // are in the Settings window (aipanel.js).
  setupAiAsk({ toast, applyText: applyWholeText });

  // Dictation. It knows nothing about AI — it puts words at the caret — but it
  // is switched on in the same panel, because "Nib may use the microphone" is
  // the same kind of decision as "Nib may talk to a model".
  const speech = setupSpeech({
    button: $('btnMic'),
    insertText,
    toast,
    textBefore: () => ed.value.slice(0, ed.selectionStart),
  });
  const syncSpeech = (st) => speech.setEnabled(!!(st && st.speech) && speech.available);
  tiny.api.call('aiStatus').then(syncSpeech);
  tiny.api.on('ai-config', syncSpeech);
  // Whether dictation is even possible depends on the engine, which only a
  // page can answer — so the page tells the backend, and the Settings window
  // (which is a different page) is spared having to guess.
  tiny.api.call('speechPossible', { yes: speech.available });

  // ----------------------------------------------------------------- misc

  let toastTimer = null;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }
  tiny.api.on('toast', ({ text }) => toast(text));

  // Dropped files split two ways: documents open, pictures get imported — and
  // a picture dropped on a document is a PASTE, in every sense. Same folder,
  // same generated name, same optimizing, and at the drop POINT if the webview
  // saw the drag go past (a native drop carries only paths, so the caret is
  // moved from the last dragover instead — and if none arrived, the caret is
  // wherever you left it).
  //
  // A window showing a picture has nothing to paste into: another picture
  // dropped on it just opens as its own tab.
  let dragAt = null;
  for (const ev of ['dragover', 'dragenter']) {
    // recorded, never prevented: making the page a drop target would let
    // WebKit handle the file itself, and the backend's onDrop owns that
    addEventListener(ev, (e) => { dragAt = { x: e.clientX, y: e.clientY, at: Date.now() }; });
  }
  addEventListener('dragleave', () => { dragAt = null; });
  // …and the editable preview IS a drop target by nature, so a picture dropped
  // on it must not become a file:// <img> WebKit inserted behind our back
  preview.addEventListener('drop', (e) => e.preventDefault());

  function caretToDrop() {
    if (!dragAt || Date.now() - dragAt.at > 4000) return;
    const { x, y } = dragAt;
    dragAt = null;
    if (editing() && preview.contains(document.elementFromPoint(x, y))) {
      const r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
      if (!r) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      preview.focus();
      return;
    }
    const hit = document.elementFromPoint(x, y);
    if (hit !== ed && !ed.contains(hit)) return;
    const row = rowAtY(y);
    if (!row) return;
    const line = [...edBack.children].indexOf(row);
    const lines = ed.value.split('\n');
    if (line < 0 || line >= lines.length) return;
    ed.focus();
    const off = offsetOf(line, lines[line].length);           // end of that line
    ed.setSelectionRange(off, off);
  }

  tiny.win.onDrop(async (paths) => {
    const pics = (paths || []).filter(isImage);
    const docs = (paths || []).filter((p) => !isImage(p));
    if (docs.length) tiny.api.call('openPaths', { paths: docs });
    if (!pics.length) return;
    if (kind !== 'doc') { tiny.api.call('openPaths', { paths: pics }); return; }
    caretToDrop();
    for (const p of pics) await importImage(p, { rename: true });
  });

  // ------------------------------------------------------------------- go

  // Whatever size you leave a window at is the size the next one opens at.
  // The call carries no numbers: innerWidth here is CSS pixels, which UI
  // zoom divides, so a zoomed window that reported its own size spawned the
  // next one smaller by the zoom factor. The backend measures the window.
  let sizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => tiny.api.call('rememberSize'), 400);
  });

  await applyAppearance(appearance);
  applyPrefs(prefs);
  applyProject(boot.project);
  paintTabs(boot.tabs);
  applyTheme(theme);
  applyKind();                          // a window can open ON a picture
  setDirty();
  render();
  setView(view, false);                 // also settles the Editable toggle
  setOutline(outlineOn, false);
  updateStatus();
  booted = true;
  if (pendingSheet) { const s = pendingSheet; pendingSheet = null; loadSheet(s); }
  if (kind === 'doc') { if (editing()) preview.focus(); else ed.focus(); }
})();
