// about.js — the About panel. Static credits (visualizer engines, AutoEq
// headphone data, inspirations); every link opens in the real browser via the
// backend, never inside an amp window.
document.getElementById('close').onclick = () => tiny.api.call('toggleWindow', { id: 'about' });

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url]');
  if (!a) return;
  e.preventDefault();
  tiny.api.call('openExternal', { url: a.dataset.url });
});

tiny.app.info().then((i) => {
  if (i && i.version) document.getElementById('aVer').textContent = 'v' + i.version;
}).catch(() => {});
