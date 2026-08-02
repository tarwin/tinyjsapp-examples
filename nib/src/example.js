// The example document (Help ▸ Open Example Document). It ships as a string
// rather than a file so it works identically in `tinyjs dev` and inside a
// packaged .app, where the frontend lives somewhere else entirely. The
// backend writes it — plus the little SVG it references — into the app's
// data folder and opens that copy, so the example is always editable and the
// original is always intact.
//
// Backticks and ${ are escaped because this is a template literal.

export const EXAMPLE_NAME = 'Nib Example.md';
export const EXAMPLE_IMAGE = 'nib-example-swatch.svg';

export const EXAMPLE_MD = `---
title: Nib, by example
about: front-matter is shown as-is, never parsed or hidden
---

# Nib, by example

Everything Nib renders, in one document. Edit it freely — this is your own
copy, and **Help ▸ Open Example Document** always brings back a fresh one.

::: tip Try this first
Hit **⌘2** for the split view, then the **✎ Editable** button (**⌘⇧L**) and
type into the right-hand side. Your Markdown rewrites itself as you go — and
whichever pane you're in, the other one shows you where you are.
:::

## Headings

Use one to six \`#\` and a space. Every heading becomes an anchor and an entry
in the outline sidebar — **⌘⇧O** to slide it open.

### Third level

#### Fourth level

## Words

Text can be *italic*, **bold**, ***both at once***, ~~struck out~~,
==highlighted== or \`inline code\`. Underscores work too: _italic_, __bold__.
A backslash keeps a marker literal: \\*not italic\\*. And there's an emoji
picker in the toolbar (**⌘⇧J**) when you want one of these 🖋 🎉 ✅.

Paragraphs are separated by a blank line. Two spaces at the end of a line
force a break inside one — like this,  
and this is the next line.

## Lists

- A bullet list
- takes \`-\`, \`*\` or \`+\`
  - and nests two spaces at a time
    - as deep as you like
- back to the top level

1. Numbered lists
2. keep counting
   - and mix with bullets
3. as you'd expect

7. A list can start anywhere
8. and carries on from there

### Task lists

Click these in the preview — the source line updates itself:

- [x] Write the renderer
- [x] Give every document a window
- [ ] Finish the novel
  - [ ] Chapter one
  - [ ] Chapter two

## Quotes

> Markdown is intended to be as easy-to-read and easy-to-write as is feasible.
>
> Readability, however, is emphasized above all else.
>
> — John Gruber, 2004

> Quotes hold other blocks too:
>
> 1. lists
> 2. code
>
> \`\`\`sh
> tinyjs dev
> \`\`\`

## Code

An inline \`const\` here, and a fenced block whose language picks the colours:

\`\`\`js
// nothing in here is treated as Markdown
export const api = {
  boot: async (_p, app, meta) => ({ kind: 'doc', window: meta.window }),
};
\`\`\`

Tildes fence too, which is handy when the code itself has backticks:

~~~md
Use \`backticks\` for code spans.
~~~

## Tables

| Thing        | Where it lives     |            Shortcut |
| ------------ | :----------------: | ------------------: |
| Editor       | \`doc.html\`         |                  ⌘1 |
| Split        | both panes         |                  ⌘2 |
| Preview      | \`md.js\`            |                  ⌘3 |
| Outline      | the sidebar        |                 ⌘⇧O |
| Editable     | \`unmd.js\`          |                 ⌘⇧L |

The dashes row sets alignment: \`:---\` left, \`:---:\` centre, \`---:\` right.

## Links

- An ordinary [link to tinyjs](https://tinyjs.app)
- An autolink: <https://daringfireball.net/projects/markdown/>
- A bare one — https://commonmark.org — spotted on sight
- A [mail link](mailto:hello@example.com)
- A [jump to the callouts](#callouts) further down this page

Web links open in your browser; a relative link to another \`.md\` file opens
it in a new Nib window.

## Images

Relative paths are resolved next to this document and inlined by the backend,
so the window itself never touches the filesystem:

![a small swatch](${EXAMPLE_IMAGE})

Paste an image with **⌘V**, drop a file on the window, or use
**Format ▸ Insert Image…** (**⌘⇧I**) — Nib copies it next to the document and
writes the link for you. With **✎ Editable** on, click the picture above for
replace / alt text / remove.

## Rules

Three or more dashes, asterisks or underscores:

---

## Page breaks

\`\\newpage\` or \`<!-- pagebreak -->\` alone on a line. On screen it's the
dotted mark below; under **⌘P** (and in exported HTML) it starts a new page.

\\newpage

**View ▸ Rendering ▸ "---" as Page Break** turns every dash rule into one too — \`***\`
and \`___\` stay rules. Other renderers shrug at both spellings: \`\\newpage\`
is plain text to them, a comment is nothing at all.

## Callouts

Nib's one extension: three colons, a type, an optional title, three colons to
close. The body is ordinary Markdown.

::: note
The default type, when you don't name one.
:::

::: info Types available
\`note\` \`info\` \`tip\` \`hint\` \`important\` \`warning\` \`caution\` \`danger\`
\`success\` \`bug\` — plus \`details\`, below.
:::

::: warning Careful
Callouts can hold **anything**:

- lists
- code
- other callouts

::: danger Nested
Right down inside each other.
:::
:::

::: details A collapsed section
This one is a real \`<details>\` element — click the title to fold it away.
:::

::: aside Unknown types are fine
A type Nib doesn't know gets neutral styling and its own name as the title.
:::

## Tabs

\`::: tabs\`, split by \`== Title\` lines. The switching is pure CSS, so tabs
survive **Export as HTML** — and printing simply shows every panel.

::: tabs

== Writing
Type into either pane. With **✎ Editable** on, \`## \` and \`**bold**\` turn
into the real thing as you finish them.

== Keys
| Action | Key |
| ------ | --- |
| Outline | ⌘⇧O |
| Editable | ⌘⇧L |
| Emoji | ⌘⇧J |

== Why
Because a tab strip is the one thing a long document always seems to want,
and three colons is a cheap price for it. Put the cursor in a hidden panel's
source and the preview switches to that tab to show you.

:::

## Alerts

GitHub's spelling of a callout — a quote whose first line is \`[!NOTE]\`.
Same look as \`:::\`, but this form renders on GitHub too.

> [!NOTE]
> Handy things a reader can skim past.

> [!WARNING]
> Things a reader had better not.

> [!TIP]
> \`NOTE\` \`TIP\` \`IMPORTANT\` \`WARNING\` \`CAUTION\` — toggle them under
> **View ▸ Markdown Flavor**.

## Math

TeX between dollars — \`$e^{i\\pi} + 1 = 0$\` renders as $e^{i\\pi} + 1 = 0$
right in the sentence. Two dollars (or a \`\`\`math fence) make a display
block:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

\`\`\`math
\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}
\\begin{pmatrix} x \\\\ y \\end{pmatrix} =
\\begin{pmatrix} ax + by \\\\ cx + dy \\end{pmatrix}
\`\`\`

It compiles to native MathML (Temml), so exported HTML and printed pages
carry real markup, no scripts. GitHub renders all three spellings too.

## Diagrams

A \`\`\`mermaid fence, drawn with [Mermaid](https://mermaid.js.org) — and
coloured to match whichever preview theme you're wearing, so it never looks
like a stranger's slide deck:

\`\`\`mermaid
flowchart LR
  ed[Editor] -->|render| pv[Preview]
  pv -->|unmd.js| ed
  pv --> out[Outline]
  ed --> hl[Colours]
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant You
  participant Nib
  You->>Nib: type
  Nib-->>You: rendered page
  You->>Nib: ⌘S
  Nib-->>You: saved
\`\`\`

## Emoji shortcodes

GitHub's \`:name:\` spellings become the real character: :tada: :rocket:
:bug: :sparkles: :+1: — the full emojibase GitHub set, plus the picker's
own keywords. (The picker itself is ⌘⇧J.)

## Footnotes

A reference like this one[^1] becomes a numbered link, and the definitions
gather at the very end of the document[^why], wherever you wrote them.

[^1]: The definition. It can run on,
  as long as the continuation is indented.

[^why]: Because that is where a reader's eye goes looking for them.

## Raw HTML

Shown as text, never executed — <b>this stays visible</b>, and a
<script> tag can't do anything at all. A Nib window holds a private channel
to the backend, so a document must never be able to become markup.

---

Made with [Nib](https://tinyjs.app) 🖋
`;

// A tiny standalone SVG so the Images section actually has something to show.
export const EXAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="90" viewBox="0 0 420 90">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4a6bdf"/>
      <stop offset="1" stop-color="#8a4b1f"/>
    </linearGradient>
  </defs>
  <rect width="420" height="90" rx="10" fill="url(#g)"/>
  <path d="M52 70 C40 55 30 43 30 32 A11 11 0 0 1 74 32 C74 43 64 55 52 70 Z" fill="#fff" opacity=".93"/>
  <path d="M52 62 L52 40" stroke="#4a6bdf" stroke-width="3" stroke-linecap="round"/>
  <circle cx="52" cy="35" r="3.4" fill="#4a6bdf"/>
  <text x="98" y="52" font-family="-apple-system, Helvetica, sans-serif" font-size="24"
        font-weight="600" fill="#fff">a local image, inlined</text>
</svg>
`;
