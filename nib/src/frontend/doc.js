// One document window. The backend told us who we are (api.boot →
// path/text/draft state); from here on this page owns the textarea, the
// preview, and the save/close choreography. Menu events are broadcast to
// every window, so everything gates on document.hasFocus() — only the key
// window acts.

(async () => {
  const $ = (id) => document.getElementById(id);
  const ed = $('ed'), preview = $('preview'), previewPane = $('previewPane');

  // ------------------------------------------------------------------ state

  const boot = await tiny.api.call('boot');
  let { path, name, theme, view } = boot;
  let savedText = boot.savedText;
  let dirty = false;
  let docDir = path ? path.slice(0, path.lastIndexOf('/')) : null;
  const imgCache = new Map();          // src -> Promise<dataUri|null>

  ed.value = boot.text;
  ed.setSelectionRange(0, 0);          // open at the top, not the end

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
  }

  themePick.onchange = () => tiny.api.call('setTheme', { theme: themePick.value });
  tiny.api.on('doc-theme', ({ theme: t }) => applyTheme(t));

  // ------------------------------------------------------------------- view

  function setView(v, persist) {
    view = v;
    document.body.dataset.view = v;
    for (const b of document.querySelectorAll('#views button')) {
      b.classList.toggle('on', b.dataset.view === v);
    }
    tiny.api.call('setView', { view: v, persist: !!persist });
  }
  for (const b of document.querySelectorAll('#views button')) {
    b.onclick = () => setView(b.dataset.view, true);
  }
  // re-assert on focus so the View menu's ticks follow the active window
  window.addEventListener('focus', () => tiny.api.call('setView', { view, persist: false }));

  // ---------------------------------------------------------------- render

  let renderTimer = null;
  function render() {
    preview.innerHTML = renderMarkdown(ed.value);
    inlineImages();
  }
  const scheduleRender = () => {
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

  // clicks in the preview: anchors scroll, .md links open in Nib, the web
  // opens in the browser — the app window never navigates anywhere
  preview.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) {
      const t = preview.querySelector(`[id="${href.slice(1)}"]`);
      if (t) t.scrollIntoView({ behavior: 'smooth' });
    } else if (/^(https?:|mailto:)/i.test(href)) {
      tiny.api.call('openExternal', { url: href });
    } else if (/\.(md|markdown)$/i.test(href) && docDir) {
      const abs = href.startsWith('/') ? href : docDir + '/' + href.replace(/^\.\//, '');
      tiny.api.call('openPaths', { paths: [abs] });
    }
  });

  // task boxes are live: ticking one edits the matching source line
  preview.addEventListener('change', (e) => {
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

  // ------------------------------------------------------- dirty & syncing

  let syncTimer = null;
  function setDirty() {
    dirty = ed.value !== savedText;
    $('saveState').textContent = dirty ? 'Edited' : (path ? 'Saved' : '');
    $('saveState').classList.toggle('dirty', dirty);
    tiny.win.setTitle(name + (dirty ? ' — Edited' : ''));
  }

  // keep the backend's copy fresh — it's what survives a red-✗ close
  const syncNow = () => tiny.api.call('sync', { text: ed.value });
  function onInput() {
    scheduleRender();
    setDirty();
    updateStatus();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 400);
  }
  ed.addEventListener('input', onInput);
  window.addEventListener('blur', () => { clearTimeout(syncTimer); syncNow(); });

  // ---------------------------------------------------------------- status

  function updateStatus() {
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
  document.addEventListener('selectionchange', updateStatus);
  ed.addEventListener('keyup', updateStatus);
  ed.addEventListener('click', updateStatus);

  // ------------------------------------------------------------ save & co.

  async function doSave(saveAs) {
    let pick = null;
    if (saveAs || !path) {
      pick = await tiny.win.saveFile();
      if (!pick) return false;                       // user bailed
    }
    const r = await tiny.api.call('saveDoc', { text: ed.value, path: pick });
    if (!r.ok) return false;
    path = r.path;
    name = r.name;
    docDir = path.slice(0, path.lastIndexOf('/'));
    savedText = ed.value;
    setDirty();
    hideBanner();
    toast('Saved ' + name);
    return true;
  }

  async function doExport() {
    const pick = await tiny.win.saveFile();
    if (!pick) return;
    render();                                        // make sure it's current
    await Promise.all([...imgCache.values()]);       // and images are inlined
    const art = preview.cloneNode(true);
    for (const box of art.querySelectorAll('input')) {
      box.setAttribute('disabled', '');              // static in the export
      box.removeAttribute('data-line');
    }
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const bg = getComputedStyle(preview).backgroundColor;
    const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name.replace(/\.(md|markdown)$/i, ''))}</title>
<style>body{margin:0;background:${bg};}main{max-width:760px;margin:0 auto;padding:48px 28px;}
${MD_BASE_CSS}${THEMES[theme].css}</style>
</head><body><main class="md">
${art.innerHTML}
</main></body></html>
`;
    const r = await tiny.api.call('exportHtml', { path: pick, html });
    toast('Exported ' + r.name);
  }

  function doPrint() {
    render();                                        // print CSS shows only the preview
    setTimeout(() => tiny.win.print(), 50);
  }

  // ------------------------------------------------------------- the dance

  // ⌘W. The red ✗ can't be intercepted (the backend drafts after the fact);
  // this path gets the civilised three buttons.
  function requestClose() {
    if (!dirty) { tiny.api.call('closeDoc', {}); return; }
    $('sheetTitle').textContent = `Save changes to “${name}”?`;
    $('sheetDetail').textContent = 'Don’t Save discards them. (Closing with the red ✗ instead keeps a draft — Nib restores it next time.)';
    $('shade').hidden = false;
    $('btnSave').focus();
  }
  const hideSheet = () => { $('shade').hidden = true; ed.focus(); };
  $('btnCancel').onclick = hideSheet;
  $('btnDont').onclick = () => tiny.api.call('closeDoc', { discard: true });
  $('btnSave').onclick = async () => {
    if (await doSave(false)) tiny.api.call('closeDoc', {});
    else hideSheet();                                // save panel cancelled
  };
  document.addEventListener('keydown', (e) => {
    if ($('shade').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); hideSheet(); }
    if (e.key === 'Enter') { e.preventDefault(); $('btnSave').click(); }
    if (e.key === 'd' && e.metaKey) { e.preventDefault(); $('btnDont').click(); }
  });

  // --------------------------------------------------------------- banner

  const hideBanner = () => { $('banner').hidden = true; };
  $('btnBannerX').onclick = hideBanner;
  $('btnRevert').onclick = async () => {
    const sure = await tiny.win.confirm(`Revert “${name}” to the saved version?`, {
      detail: 'The restored draft changes will be discarded.',
      ok: 'Revert', cancel: 'Cancel',
    });
    if (!sure) return;
    const r = await tiny.api.call('revert');
    ed.value = r.text;
    savedText = r.text;
    hideBanner();
    onInput();
  };
  if (boot.restored) {
    $('banner').hidden = false;
    if (!path) $('btnRevert').hidden = true;         // untitled: nothing to revert to
  }

  // ------------------------------------------------------------ formatting

  function wrapSelection(mark, endMark) {
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
    const { selectionStart: a, selectionEnd: b, value: v } = ed;
    const sel = v.slice(a, b);
    const url = await tiny.win.prompt('Link URL:', { default: 'https://', ok: 'Insert' });
    ed.focus();
    if (!url) return;
    ed.setRangeText(`[${sel || 'link'}](${url})`, a, b, 'end');
    onInput();
  }

  // Tab indents, Enter continues lists ("- ", "1. ", "- [ ] ", "> ")
  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      ed.setRangeText('  ', ed.selectionStart, ed.selectionEnd, 'end');
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

  tiny.menu.on(async (id) => {
    if (!document.hasFocus()) return;                // someone else's event
    if (id === 'new') tiny.api.call('newDoc');
    else if (id === 'open') {
      const picks = await tiny.win.openFiles();
      if (picks) tiny.api.call('openPaths', { paths: picks });
    }
    else if (id === 'save') doSave(false);
    else if (id === 'saveas') doSave(true);
    else if (id === 'export') doExport();
    else if (id === 'print') doPrint();
    else if (id === 'close') requestClose();
    else if (id === 'fmt:bold') wrapSelection('**');
    else if (id === 'fmt:italic') wrapSelection('*');
    else if (id === 'fmt:code') wrapSelection('`');
    else if (id === 'fmt:link') insertLink();
    else if (id.startsWith('view:')) setView(id.slice(5), true);
    else if (id.startsWith('theme:')) tiny.api.call('setTheme', { theme: id.slice(6) });
  });

  // ---------------------------------------------------------- scroll sync

  let syncLock = 0;
  const ratio = (el) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
  const follow = (from, to) => {
    if (Date.now() < syncLock) return;
    syncLock = Date.now() + 60;
    to.scrollTop = ratio(from) * (to.scrollHeight - to.clientHeight);
  };
  ed.addEventListener('scroll', () => follow(ed, previewPane));
  previewPane.addEventListener('scroll', () => follow(previewPane, ed));

  // ------------------------------------------------------------- splitter

  const gutter = $('gutter');
  gutter.addEventListener('pointerdown', (e) => {
    gutter.setPointerCapture(e.pointerId);
    gutter.classList.add('drag');
    const move = (ev) => {
      const w = document.getElementById('panes').clientWidth;
      const pct = Math.min(80, Math.max(20, (ev.clientX / w) * 100));
      document.getElementById('editorPane').style.flexBasis = pct + '%';
    };
    const up = () => {
      gutter.classList.remove('drag');
      gutter.removeEventListener('pointermove', move);
      gutter.removeEventListener('pointerup', up);
    };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', up);
  });

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

  tiny.win.onDrop((paths) => tiny.api.call('openPaths', { paths }));

  // ------------------------------------------------------------------- go

  applyTheme(theme);
  setView(view, false);
  setDirty();
  render();
  updateStatus();
  ed.focus();
})();
