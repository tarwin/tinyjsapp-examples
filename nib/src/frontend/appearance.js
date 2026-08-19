// Stamp the appearance before the first paint.
//
// This is a <head> script on purpose, and it is synchronous on purpose. Every
// page resolves Light / Dark / Match System itself and puts a concrete
// data-appearance on <html>, but it could only do that AFTER asking the
// backend — so a window opened in dark mode painted light first and blinked.
// The old answer was a duplicate of the whole dark palette behind
// `@media (prefers-color-scheme: dark)`, which covered the flash and cost a
// second copy of every colour.
//
// So: remember the last resolved answer, and use it immediately. `matchMedia`
// covers a first run with nothing remembered, and the real answer arrives a
// moment later from the backend and corrects the attribute if it disagrees —
// which it only can when the setting changed while Nib wasn't running.
//
// With the attribute always present, palette.css needs no media query at all,
// and a new variant is one more block rather than one more block in two places.

(() => {
  let saved = null;
  try { saved = localStorage.getItem('nib.appearance'); } catch { /* private mode */ }
  const dark = saved === 'dark' || (saved !== 'light'
    && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.appearance = dark ? 'dark' : 'light';
})();

// What every page calls once it knows the real setting. Resolving 'system'
// needs the backend (the OS's answer), so this is the async half.
window.nibApplyAppearance = async function nibApplyAppearance(a) {
  const want = a || 'system';
  let dark = want === 'dark';
  if (want === 'system') {
    const t = await tiny.theme.get();
    dark = !!(t && t.dark);
  }
  document.documentElement.dataset.appearance = dark ? 'dark' : 'light';
  // …so the NEXT window to open already knows, and opens without a flash
  try { localStorage.setItem('nib.appearance', dark ? 'dark' : 'light'); } catch { /* fine */ }
  return dark;
};
