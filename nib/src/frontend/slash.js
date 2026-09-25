// The / menu's catalogue: everything the editable preview can insert as a
// block, in the order the empty menu lists it. doc.js owns the menu and the
// insertion; this file only says WHAT there is, and what each one looks like
// when it arrives.
//
// Each block is plain Markdown, written into the source where the "/" line
// was and rendered like anything else — so it round-trips exactly as if it
// had been typed. Where a block has words in it, they are placeholder words
// and `sel` names the element whose text comes up SELECTED, so the first
// thing you type replaces them: the heading's text, a table's first header
// cell, a callout's body. A block with nothing to type into (a divider, a
// diagram, a table of contents) has no `sel`, and the caret lands after it.
//
// `run` marks the entries that aren't Markdown at all but one of the app's
// own pickers (a picture from disk, a link to a file, an emoji) — the "/"
// line is emptied and the picker inserts at it, exactly as from the menu.
//
// The extras follow Preview ▸ Markdown Flavor: a block the renderer isn't
// drawing right now isn't offered, since inserting it would only show you
// the syntax.

(() => {
  const CALLOUTS = [
    ['note', 'Note', 'ℹ️'], ['tip', 'Tip', '💡'], ['info', 'Info', '📘'],
    ['important', 'Important', '❗'], ['warning', 'Warning', '⚠️'],
    ['danger', 'Danger', '⛔'], ['success', 'Success', '✅'], ['bug', 'Bug', '🐞'],
  ];

  window.nibSlashItems = (prefs, { folder } = {}) => {
    const p = prefs || {};
    const items = [
      { id: 'h1', label: 'Heading 1', group: 'Text', icon: 'H1', md: '# Heading', sel: 'self' },
      { id: 'h2', label: 'Heading 2', group: 'Text', icon: 'H2', md: '## Heading', sel: 'self' },
      { id: 'h3', label: 'Heading 3', group: 'Text', icon: 'H3', md: '### Heading', sel: 'self' },
      { id: 'quote', label: 'Quote', group: 'Text', icon: '❝', md: '> Quote', sel: 'p' },

      { id: 'ul', label: 'Bulleted List', group: 'Lists', icon: '•', md: '- List item', sel: 'li' },
      { id: 'ol', label: 'Numbered List', group: 'Lists', icon: '1.', md: '1. List item', sel: 'li' },
      { id: 'task', label: 'Task List', group: 'Lists', icon: '☑', md: '- [ ] To do', sel: 'li' },

      // "a small 2×2 table with headers": two columns, a header row, two rows
      { id: 'table', label: 'Table', group: 'Blocks', icon: '▦',
        md: '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |\n| Cell | Cell |', sel: 'th' },
      { id: 'code', label: 'Code Block', group: 'Blocks', icon: '{}', md: '```\ncode\n```', sel: 'code' },
      // with "---" as Page Break on, --- would be a page break — *** stays a rule
      { id: 'hr', label: 'Divider', group: 'Blocks', icon: '―', md: p.hrBreaks ? '***' : '---' },
      { id: 'pgbrk', label: 'Page Break', group: 'Blocks', icon: '⤓', md: '\\newpage' },
      { id: 'details', label: 'Details (collapsible)', group: 'Blocks', icon: '▸',
        md: '::: details Summary\nHidden until opened.\n:::', sel: 'summary' },
      { id: 'tabs', label: 'Tabs', group: 'Blocks', icon: '⊟',
        md: '::: tabs\n\n== First\n\nThe first tab.\n\n== Second\n\nThe second tab.\n\n:::', sel: '.tp p' },
    ];

    for (const [kind, label, icon] of CALLOUTS) {
      items.push({ id: 'cb-' + kind, label, group: 'Callouts', icon,
        md: '::: ' + kind + '\n' + label + ' text.\n:::', sel: 'p:not(.cb-t)' });
    }
    if (p.alerts) {
      items.push({ id: 'alert', label: 'GitHub Alert', group: 'Callouts', icon: '❕',
        md: '> [!NOTE]\n> Alert text.', sel: 'p:not(.cb-t)' });
    }

    if (p.toc) items.push({ id: 'toc', label: 'Table of Contents', group: 'Extras', icon: '☰', md: '::: toc\n:::' });
    if (p.math) {
      items.push({ id: 'math', label: 'Math Block', group: 'Extras', icon: '∑',
        md: '$$\nE = mc^2\n$$' });
    }
    if (p.mermaid) {
      items.push({ id: 'mermaid', label: 'Mermaid Diagram', group: 'Extras', icon: '⎔',
        md: '```mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n```' });
    }
    if (p.download) {
      items.push({ id: 'download', label: 'Download Card', group: 'Extras', icon: '⬇',
        md: '::: download [Download](https://example.com/file.zip)\nWhat it is.\n:::', sel: '.dlc-t a' });
    }
    if (p.pagelink) {
      items.push({ id: 'pagelink', label: 'Page Link Card', group: 'Extras', icon: '↗',
        md: '::: pagelink [Page title](./page.md)\n:::', sel: '.dlc-t a' });
    }
    if (p.embed) items.push({ id: 'embed', label: 'Embed…', group: 'Extras', icon: '▶', run: 'embed' });

    items.push({ id: 'image', label: 'Image…', group: 'Insert', icon: '🖼', run: 'image' });
    if (folder) items.push({ id: 'link', label: 'Link to a File…', group: 'Insert', icon: '🔗', run: 'link' });
    items.push({ id: 'emoji', label: 'Emoji…', group: 'Insert', icon: '😀', run: 'emoji' });
    return items;
  };
})();
