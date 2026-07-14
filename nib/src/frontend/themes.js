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
.md hr { border: none; border-top: 1px solid; margin: 2em auto; width: 100%; }
.md a { text-decoration: none; }
.md a:hover { text-decoration: underline; }
`;

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
`,
  },
};
