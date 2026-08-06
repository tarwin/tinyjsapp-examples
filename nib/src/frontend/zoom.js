// Zoom — the whole interface, every window, one setting.
//
// ⌘+ and ⌘− step it, ⌥⌘0 puts it back; the backend owns the number so the
// document windows, the Welcome screen and the help window all move together
// and it survives a relaunch.
//
// The work is done by `tiny.win.setZoom` — the webview's OWN page zoom
// (WKWebView pageZoom, WebView2 ZoomFactor, webkit_web_view_set_zoom_level).
// That matters more than it sounds: the page is simply handed a smaller
// viewport and keeps laying out in ordinary CSS pixels, so clientX, client
// rects, offsetWidth and every length in the stylesheet stay in ONE
// coordinate system. Doing it page-side with CSS `zoom` also reflows, but it
// splits those apart — visual pixels for anything read off the screen, layout
// pixels for anything written into a style — and every popup positioned from
// a mouse event lands wrong by the zoom factor. (Measured: at 1.5×, a context
// menu opened at clientX 300 drew at 450.) Native zoom has none of that, and
// it renders crisp instead of scaling a bitmap.

(() => {
  const STEPS = [0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];

  window.setupZoom = (initial) => {
    const apply = (z) => tiny.win.setZoom(Math.max(STEPS[0],
      Math.min(STEPS[STEPS.length - 1], +z || 1)));
    apply(initial);
    tiny.api.on('ui-zoom', ({ zoom }) => apply(zoom));
    // The keys are handled here rather than as menu accelerators because
    // tinyjs' accelerators are AppKit key equivalents and punctuation doesn't
    // bind — and because the help and Welcome windows want them too, and they
    // have no menu handler of their own.
    addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key;
      if (e.altKey && k === '0') { e.preventDefault(); tiny.api.call('zoomStep', { dir: 0 }); return; }
      if (e.altKey) return;
      if (k === '=' || k === '+') { e.preventDefault(); tiny.api.call('zoomStep', { dir: 1 }); }
      else if (k === '-' || k === '_') { e.preventDefault(); tiny.api.call('zoomStep', { dir: -1 }); }
    }, true);
  };

  window.zoomSteps = STEPS;
})();
