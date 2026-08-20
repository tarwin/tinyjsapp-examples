// help.js — amp's help window.
//
// The documents are plain Markdown files in src/docs/, listed and read by the
// backend. Nothing here knows what they say: add a .md file to that folder and
// it appears in the sidebar, ordered by its numeric filename prefix. The same
// files are the source for the website, which is the point of keeping them as
// Markdown rather than pages of HTML.

const $ = (id) => document.getElementById(id);
let docs = [];
let current = null;

function pick(slug, push) {
  const d = docs.find((x) => x.slug === slug) || docs[0];
  if (!d) return;
  current = d.slug;
  for (const b of $('nav').children) b.classList.toggle('on', b.dataset.slug === d.slug);
  tiny.api.call('docsRead', { slug: d.slug }).then((text) => {
    if (current !== d.slug) return;              // a fast second click won
    // ampMarkdown escapes the whole document before it adds any markup, and the
    // only links it emits are https (opened in the browser) or doc: (internal) —
    // so no part of a .md file can become live HTML in this window
    $('doc').innerHTML = window.ampMarkdown(text || '');
    $('doc').scrollTop = 0;
  }).catch((e) => {
    $('doc').textContent = 'Could not read that document.';
  });
}

function buildNav() {
  const nav = $('nav');
  nav.replaceChildren();
  for (const d of docs) {
    const b = document.createElement('button');
    b.className = 'help-item';
    b.textContent = d.title;
    b.dataset.slug = d.slug;
    b.onclick = () => pick(d.slug);
    nav.appendChild(b);
  }
}

// links inside a document: doc: hops to another page, https opens the browser
$('doc').addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.doc) pick(a.dataset.doc);
  else if (a.dataset.url) tiny.api.call('openExternal', { url: a.dataset.url });
});

$('close').onclick = () => tiny.api.call('toggleWindow', { id: 'help' });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') tiny.api.call('toggleWindow', { id: 'help' });
});

(async () => {
  try {
    docs = (await tiny.api.call('docsList')) || [];
  } catch (e) { docs = []; }
  if (!docs.length) { $('doc').textContent = 'No documents found.'; return; }
  buildNav();
  // the window can be asked to open on a particular page (the viz window's
  // "how do I write one of these" route)
  let want = null;
  try { want = await tiny.api.call('docsWanted'); } catch (e) {}
  pick(want || docs[0].slug);
})();

// opening Help while it is already open should still jump to the asked-for page
tiny.api.on('docs-goto', (slug) => { if (slug) pick(slug); });
