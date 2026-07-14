# Welcome to Nib

A tiny Markdown editor where **every document is its own window**. This file
is a tour — open it with `tinyjs dev`, or drop it onto the Dock icon once the
app is running.

## The basics

Text can be **bold**, *italic*, ***both***, ~~struck out~~, or `inline code`.
Links work too: [tinyjs](https://tinyjs.app), autolinks like
<https://txikijs.org>, and bare ones — https://tinyjs.app/api — become
clickable. Clicking any of them opens your *browser*, never the editor window.

Escapes render literally: \*not italic\*, and raw HTML is shown, not executed:
<marquee>nope</marquee>.

> Blockquotes hold anything —
> **formatting**, `code`, even headings.
>
> > And they nest.

## Lists

1. Ordered lists
2. Keep their numbers
   - and nest unordered ones
   - with *formatting* inside
3. Continuation lines
   just join their item

A task list — **click the boxes in the preview** and watch the source update:

- [x] Build a markdown renderer
- [x] One window per document
- [ ] Write something worth printing

## Code

```js
// fenced code, kept verbatim
const app = await openWindow('doc2', { page: 'doc.html' });
app.push('doc-theme', { theme: 'night' });
```

## A table

| Feature        | Where it lives     | API                        |
|:---------------|:------------------:|---------------------------:|
| One brain      | `src/main.js`      | `app.openWindow`           |
| Drafts         | backend store      | `onWindowClosed`           |
| PDF export     | the print panel    | `tiny.win.print()`         |

## Images

Relative paths are resolved by the backend and inlined as data: URIs — the
page never reads the disk itself:

![the Nib icon](icon.png)

---

Try **⌘1 / ⌘2 / ⌘3** for editor, split, and preview view; pick a theme in the
**View ▸ Theme** menu; then **⌘P** and *Save as PDF* — the theme goes with it.
Now make some edits and close this window with the red ✕. Reopen the file:
your changes come back as a draft. That's the whole trick. 🖋
