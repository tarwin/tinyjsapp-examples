// Preview themes. Each is a plain CSS string scoped to `.md`, which is what
// lets one definition serve three masters: the live preview pane, the print
// stylesheet (⌘P — so "Save as PDF" comes out themed), and Export as HTML
// (where it's inlined into the standalone file). System font stacks only —
// nothing here may phone home.

const MD_BASE_CSS = `
.md { line-height: 1.65; word-wrap: break-word; }
.md > :first-child { margin-top: 0; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 {
  line-height: 1.25; margin: 1.6em 0 .6em;
}
.md h1 { font-size: 2em; }
.md h2 { font-size: 1.5em; }
.md h3 { font-size: 1.2em; }
.md h4 { font-size: 1em; }
.md h5, .md h6 { font-size: .9em; }
.md p, .md ul, .md ol, .md table, .md pre, .md blockquote { margin: 0 0 1em; }
.md ul, .md ol { padding-left: 1.7em; }
.md li > ul, .md li > ol { margin: .25em 0; }
.md li { margin: .15em 0; }
.md li.task { list-style: none; margin-left: -1.45em; }
.md li.task input { margin-right: .45em; vertical-align: -1px; }
.md li.task.done { opacity: .6; }
.md li.task.done { text-decoration: line-through; text-decoration-thickness: 1px; }
.md blockquote { padding: .1em 1.1em; border-left: 3px solid; }
.md blockquote > :last-child { margin-bottom: 0; }
.md code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: .88em;
  padding: .12em .35em; border-radius: 4px; }
.md pre { padding: .85em 1em; border-radius: 8px; overflow-x: auto; }
.md pre code { padding: 0; border-radius: 0; background: none; font-size: .85em; line-height: 1.55; }
.md table { border-collapse: collapse; max-width: 100%; display: block; overflow-x: auto; }
.md th, .md td { padding: .35em .8em; border: 1px solid; }
.md img { max-width: 100%; border-radius: 4px; }

/* Pictures. .fig wraps any image that has alt text (md.js); the caption is
   drawn from the attribute so toggling it is one class on the article, and
   .zoom is the click-to-enlarge mode — which also stops a huge photo from
   pushing the whole document off the screen, since the full thing is one
   click away. */
.md .fig { display: inline-block; max-width: 100%; vertical-align: bottom; }
.md .fig > img { display: block; }
/* Only a picture that stands alone in its paragraph (p.figp, stamped by
   md.js) gets a caption — a caption under an image used mid-sentence would
   break the line it sits in. Inline images still carry their alt text, it
   just isn't drawn. */
.md.cap p.figp > .fig::after {
  content: attr(data-alt); display: block; margin: .45em 0 .2em;
  font-size: .82em; line-height: 1.45; opacity: .65; text-align: center;
}
.md.zoom img { cursor: zoom-in; max-height: 70vh; }
/* Centred pictures — only ones that stand alone in their own paragraph, so an
   image used inline in a sentence stays where it was put. A fit-content width
   keeps the box as wide as the picture, which is what the caption centres
   under. (No backticks in here: this file is one template literal.) */
.md.mid p.figp > .fig { display: block; width: fit-content; margin-inline: auto; }
.md.mid p.figp > img { display: block; margin-inline: auto; }
.md hr { border: none; border-top: 1px solid; margin: 2em auto; width: 100%; }
/* Page breaks: a faint dotted line on screen, a real break on paper. The
   print block matters to exported HTML too — this sheet is all it gets. */
.md .pgbrk { border: none; border-top: 2px dotted; margin: 2.2em auto; opacity: .25; }
@media print {
  .md .pgbrk { border: none; margin: 0; height: 0; break-after: page; page-break-after: always; }
}
.md a { text-decoration: none; }
.md a:hover { text-decoration: underline; }

/* ::: containers. Structure and hue live here so all four themes agree;
   each theme only supplies --cbfill, the tint behind the block. */
.md .cb {
  --cb: #7a8090;
  margin: 0 0 1.2em; padding: .8em 1em .1em;
  border-left: 3px solid var(--cb);
  border-radius: 0 7px 7px 0;
  background: var(--cbfill, rgba(127, 127, 127, .08));
}
.md .cb > .cb-t, .md .cb > summary {
  font-weight: 650; margin: 0 0 .5em; color: var(--cb);
  letter-spacing: .01em;
}
.md .cb > :last-child { margin-bottom: .8em; }
.md .cb .cb { margin-bottom: .8em; }
.md .cb-note { --cb: #4a6bdf; }
.md .cb-info { --cb: #2f8fbf; }
.md .cb-tip, .md .cb-hint, .md .cb-success { --cb: #2f9160; }
.md .cb-important { --cb: #8a5cd6; }
.md .cb-warning, .md .cb-caution { --cb: #c07a12; }
.md .cb-danger, .md .cb-bug { --cb: #c8452f; }
.md .cb-note > .cb-t::before { content: "📝 "; }
.md .cb-info > .cb-t::before { content: "ℹ️ "; }
.md .cb-tip > .cb-t::before, .md .cb-hint > .cb-t::before { content: "💡 "; }
.md .cb-important > .cb-t::before { content: "❗ "; }
.md .cb-warning > .cb-t::before, .md .cb-caution > .cb-t::before { content: "⚠️ "; }
.md .cb-danger > .cb-t::before { content: "⛔ "; }
.md .cb-success > .cb-t::before { content: "✅ "; }
.md .cb-bug > .cb-t::before { content: "🐞 "; }
/* ::: tabs — switched by CSS alone, so exported HTML keeps working. */
.md .tabs { margin: 0 0 1.2em; }
.md .tabs > input { position: absolute; opacity: 0; pointer-events: none; }
.md .tabs > label {
  display: inline-block; padding: .35em .9em; margin: 0 2px -1px 0;
  border: 1px solid var(--cb, #7a8090); border-bottom: none;
  border-radius: 7px 7px 0 0; font-size: .9em; font-weight: 600;
  opacity: .55; cursor: default;
}
.md .tabs > .tp {
  display: none; padding: .9em 1em .1em;
  border: 1px solid var(--cb, #7a8090); border-radius: 0 7px 7px 7px;
  background: var(--cbfill, rgba(127, 127, 127, .06));
}
.md .tabs > .tp > :last-child { margin-bottom: .9em; }
.md .tabs > input:nth-of-type(1):checked ~ label:nth-of-type(1),
.md .tabs > input:nth-of-type(2):checked ~ label:nth-of-type(2),
.md .tabs > input:nth-of-type(3):checked ~ label:nth-of-type(3),
.md .tabs > input:nth-of-type(4):checked ~ label:nth-of-type(4),
.md .tabs > input:nth-of-type(5):checked ~ label:nth-of-type(5),
.md .tabs > input:nth-of-type(6):checked ~ label:nth-of-type(6),
.md .tabs > input:nth-of-type(7):checked ~ label:nth-of-type(7),
.md .tabs > input:nth-of-type(8):checked ~ label:nth-of-type(8) {
  opacity: 1; background: var(--cbfill, rgba(127, 127, 127, .06));
}
.md .tabs > input:nth-of-type(1):checked ~ div:nth-of-type(1),
.md .tabs > input:nth-of-type(2):checked ~ div:nth-of-type(2),
.md .tabs > input:nth-of-type(3):checked ~ div:nth-of-type(3),
.md .tabs > input:nth-of-type(4):checked ~ div:nth-of-type(4),
.md .tabs > input:nth-of-type(5):checked ~ div:nth-of-type(5),
.md .tabs > input:nth-of-type(6):checked ~ div:nth-of-type(6),
.md .tabs > input:nth-of-type(7):checked ~ div:nth-of-type(7),
.md .tabs > input:nth-of-type(8):checked ~ div:nth-of-type(8) { display: block; }

/* front-matter, kept verbatim rather than rendered as a rule + text */
.md pre.fm {
  border-left: 3px solid var(--cb, #7a8090); border-radius: 0 6px 6px 0;
  opacity: .8; font-size: .8em;
}
.md mark { padding: .05em .2em; border-radius: 3px; }

/* Fenced-code colours (code.js). Classes only, so they survive Export as
   HTML and printing; each theme may override the palette below. */
.md pre .cd-cm { color: var(--cd-cm, #8a93a3); font-style: italic; }
.md pre .cd-str { color: var(--cd-str, #2a7d4f); }
.md pre .cd-num { color: var(--cd-num, #b5560c); }
.md pre .cd-kw { color: var(--cd-kw, #9430b8); font-weight: 600; }
.md pre .cd-lit { color: var(--cd-lit, #b5560c); }
.md pre .cd-fn { color: var(--cd-fn, #1a63c4); }
.md pre .cd-type { color: var(--cd-type, #0b7a86); }
.md pre .cd-key { color: var(--cd-key, #1a63c4); }
.md pre .cd-attr { color: var(--cd-type, #0b7a86); }
.md pre .cd-tag { color: var(--cd-kw, #9430b8); }
.md pre .cd-var { color: var(--cd-num, #b5560c); }
.md pre .cd-at, .md pre .cd-dec { color: var(--cd-kw, #9430b8); }
.md pre .cd-sel { color: var(--cd-fn, #1a63c4); }
.md pre .cd-url { color: var(--cd-str, #2a7d4f); text-decoration: underline; }
.md pre .cd-op, .md pre .cd-pun { color: var(--cd-pun, #6f7684); }
.md pre .cd-ins { color: var(--cd-str, #2a7d4f); }
.md pre .cd-del { color: var(--cd-err, #c0392b); }

/* ::: details. The UA's disclosure triangle can't be positioned — it lands
   out in the container's left border stripe, adrift from the title — so it's
   suppressed and redrawn as a ::before inside the summary's own row. Pure
   CSS, rotation included, so a folded section still folds in exported HTML. */
.md details.cb { padding-bottom: .1em; }
.md details.cb > summary {
  display: flex; align-items: center; gap: .5em;
  cursor: default; list-style: none;
}
.md details.cb > summary::-webkit-details-marker { display: none; }
.md details.cb > summary::before {
  content: ""; flex: none;
  border: .32em solid transparent; border-right-width: 0;
  border-left-color: currentColor; opacity: .8;
  transition: transform .15s ease;
}
.md details.cb[open] > summary::before { transform: rotate(90deg); }
.md details.cb > summary:hover::before { opacity: 1; }
.md details.cb:not([open]) > summary { margin-bottom: 0; }
`;

// View ▸ Page Width — how wide a line of prose is allowed to get. The preview
// is centred in its pane rather than the pane being narrowed, and the same
// numbers are written into exported HTML, so a document reads the same
// everywhere. In Split the panes are usually narrower than any of these, so
// the setting only starts to bite in Preview Only or a wide window.
const PAGE_WIDTH = {
  narrow: ['Narrow', '620px'],
  normal: ['Normal', '760px'],
  wide: ['Wide', '980px'],
  full: ['Full Width', 'none'],
};

const THEMES = {
  paper: {
    label: 'Paper',
    css: `
.md { font: 16px/1.7 "Iowan Old Style", Palatino, Georgia, serif;
  color: #2c2620; background: #faf6ee; }
.md h1, .md h2, .md h3, .md h4 { font-weight: 600; color: #1f1a14; }
.md h1 { border-bottom: 1px solid #e0d7c4; padding-bottom: .3em; }
.md a { color: #8a4b1f; }
.md blockquote { border-color: #d8c9a8; color: #6b5f4c; font-style: italic; }
.md code { background: #f0e8d8; color: #59421f; }
.md pre { background: #f2ecdf; border: 1px solid #e5dcc6; }
.md th, .md td { border-color: #ddd2ba; }
.md th { background: #f2ecdf; }
.md hr { border-top-color: #ddd2ba; }
.md .cb, .md .tabs > .tp, .md .tabs > label:hover { --cbfill: rgba(120, 95, 45, .08); }
.md .tabs > label, .md .tabs > .tp, .md pre.fm { --cb: #b09763; }
.md mark { background: #f6e08a; }
.md pre { --cd-cm: #9a8e77; --cd-str: #4a7a2f; --cd-num: #a35a12; --cd-kw: #8a4b8f;
  --cd-lit: #a35a12; --cd-fn: #2f5fa8; --cd-type: #2c7a72; --cd-key: #2f5fa8;
  --cd-pun: #8a8172; --cd-err: #b03a2e; }
`,
  },

  ink: {
    label: 'Ink',
    css: `
.md { font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1f2328; background: #ffffff; }
.md h1, .md h2 { border-bottom: 1px solid #e4e8ee; padding-bottom: .3em; }
.md h1, .md h2, .md h3, .md h4 { font-weight: 650; }
.md a { color: #0b62d6; }
.md blockquote { border-color: #d4dae2; color: #59626d; }
.md code { background: #eef1f5; color: #24292f; }
.md pre { background: #f5f7fa; border: 1px solid #e4e8ee; }
.md th, .md td { border-color: #d4dae2; }
.md th { background: #f5f7fa; }
.md hr { border-top-color: #d4dae2; }
.md .cb, .md .tabs > .tp, .md .tabs > label:hover { --cbfill: rgba(80, 110, 150, .07); }
.md .tabs > label, .md .tabs > .tp, .md pre.fm { --cb: #b7c1cf; }
.md mark { background: #fff0a6; }
`,
  },

  typewriter: {
    label: 'Typewriter',
    css: `
.md { font: 14px/1.8 "SF Mono", Menlo, "Courier New", monospace;
  color: #3a3a35; background: #f7f4ec; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 {
  font-size: 1em; font-weight: 700; color: #232320; letter-spacing: .02em; }
.md h1::before { content: "# "; opacity: .4; }
.md h2::before { content: "## "; opacity: .4; }
.md h3::before { content: "### "; opacity: .4; }
.md h1 { font-size: 1.3em; }
.md h2 { font-size: 1.15em; }
.md a { color: #2f6f4f; text-decoration: underline; }
.md em { font-style: normal; background: #efe7cf; }
.md blockquote { border-color: #cfc7b0; color: #6e6a5c; }
.md code { background: #ede8da; }
.md pre { background: #ede8da; border: 1px dashed #c9c1a8; border-radius: 0; }
.md th, .md td { border-color: #c9c1a8; }
.md hr { border-top: none; margin: 2em 0; }
.md hr::before { content: "* * *"; display: block; text-align: center; color: #a39a7e; }
.md .cb, .md .tabs > .tp, .md .tabs > label:hover { --cbfill: rgba(140, 120, 70, .1); }
.md .cb { border-radius: 0; }
.md .tabs > label, .md .tabs > .tp { --cb: #c9c1a8; border-radius: 0; }
.md pre.fm { --cb: #c9c1a8; }
.md mark { background: #e6dcae; }
.md pre { --cd-cm: #9a927c; --cd-str: #4a7a2f; --cd-num: #96590f; --cd-kw: #7a4b86;
  --cd-lit: #96590f; --cd-fn: #2f6f8f; --cd-type: #2c7a72; --cd-key: #2f6f8f;
  --cd-pun: #8b8672; --cd-err: #a8382b; }
.md .cb > .cb-t, .md .cb > summary { text-transform: uppercase; font-size: .9em; }
`,
  },

  night: {
    label: 'Night',
    css: `
.md { font: 15px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #d3d7e3; background: #16181f; }
.md h1, .md h2, .md h3, .md h4 { color: #eef0f8; font-weight: 650; }
.md h1, .md h2 { border-bottom: 1px solid #2b2f3d; padding-bottom: .3em; }
.md a { color: #8ab4ff; }
.md blockquote { border-color: #3d4356; color: #9aa1b5; }
.md code { background: #232734; color: #c8cfea; }
.md pre { background: #1d212c; border: 1px solid #2b2f3d; }
.md th, .md td { border-color: #343a4b; }
.md th { background: #1d212c; }
.md hr { border-top-color: #2b2f3d; }
.md img { opacity: .92; }
.md .cb, .md .tabs > .tp, .md .tabs > label:hover { --cbfill: rgba(255, 255, 255, .05); }
.md .tabs > label, .md .tabs > .tp, .md pre.fm { --cb: #3d4356; }
.md mark { background: #5d5326; color: #f0e8c8; }
.md pre { --cd-cm: #6b7285; --cd-str: #8fd39a; --cd-num: #e6a86c; --cd-kw: #c99cf0;
  --cd-lit: #e6a86c; --cd-fn: #7fb4ff; --cd-type: #5fd0c6; --cd-key: #7fb4ff;
  --cd-pun: #8d94a6; --cd-err: #f08a76; }
.md .cb-note { --cb: #8ab4ff; }
.md .cb-info { --cb: #6cc4ea; }
.md .cb-tip, .md .cb-hint, .md .cb-success { --cb: #63cf9a; }
.md .cb-important { --cb: #b79cf5; }
.md .cb-warning, .md .cb-caution { --cb: #e0a94f; }
.md .cb-danger, .md .cb-bug { --cb: #f08a76; }
`,
  },
};
