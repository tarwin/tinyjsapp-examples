// theme.js — the deck's light/dark, for the windows that aren't the deck.
//
// The main deck owns the MODE (system | dark | light): a segmented control in
// Desktop ▸ theme, persisted in tiny.store. Every window then resolves the
// same three inputs the same way — that stored mode, the native signal
// (tiny.theme, which the launcher reports and updates live), and matchMedia
// for the moment before the first native value lands — and stamps data-theme
// on <html>, which is all style.css needs.
//
// A secondary window that skips this inherits the :root defaults and is stuck
// in dark forever, however the deck beside it looks — which is what the
// inspector and the undocked call log both did before this file existed.
(() => {
  if (!window.tiny) return;
  const sysDark = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system';
  let nativeDark = null;                     // null until the launcher says

  const apply = () => {
    const dark = nativeDark != null ? nativeDark : sysDark.matches;
    document.documentElement.dataset.theme = mode === 'system' ? (dark ? 'dark' : 'light') : mode;
  };
  apply();                                   // paint something right, right away
  sysDark.addEventListener('change', apply);
  try { tiny.theme.on((d) => { nativeDark = d; apply(); }); } catch { /* older runtime */ }
  // the deck broadcasts when YOU change the mode (a store write is silent —
  // nothing tells the other windows about it)
  try { tiny.api.on('theme-mode', (m) => { mode = (m && m.mode) || 'system'; apply(); }); } catch { /* … */ }

  (async () => {
    try { nativeDark = (await tiny.theme.get())?.dark ?? null; } catch { /* … */ }
    try { mode = (await tiny.store.get('theme')) || 'system'; } catch { /* … */ }
    apply();
  })();
})();
