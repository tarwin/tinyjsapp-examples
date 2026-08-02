// AsciiDoc, read as Markdown. Nib is a Markdown editor; .adoc files open in
// it because the everyday AsciiDoc constructs map onto Markdown line for
// line, and a faithful-enough preview beats "can't open that". One-way ONLY:
// the preview renders through this mapping and the Editable toggle is
// disabled for these sheets (doc.js) — serializing the edited DOM back would
// write Markdown into an AsciiDoc file. The mapping keeps the LINE COUNT
// exactly (every input line becomes exactly one output line), so the
// data-line stamps still pair source and preview and sync scrolling works.
//
// It is a reading subset, not a parser: tables show as raw text in a code
// box, conditionals and includes show as blank lines, and anything exotic
// falls through as plain text. Good enough to read a README.adoc; anyone
// authoring serious AsciiDoc has Asciidoctor.

(() => {
  // the inline constructs that differ from Markdown
  function inline(s) {
    return s
      // https://host[label] — AsciiDoc's bare-url-with-label form
      .replace(/(https?:\/\/[^\s[\]]+)\[([^\]]*)\]/g, (_, u, t) => (t ? `[${t}](${u})` : `<${u}>`))
      // link:target[label] and xref:target[label]
      .replace(/\b(?:link|xref):([^\s[\]]+)\[([^\]]*)\]/g, (_, u, t) => `[${t || u}](${u})`)
      // inline image:path[alt]
      .replace(/\bimage:([^\s[\]:][^\s[\]]*)\[([^\]]*)\]/g, (_, u, t) => `![${t.split(',')[0]}](${u})`)
      // *bold* — single stars are BOLD in AsciiDoc (Markdown would read italic)
      .replace(/(^|[\s(>])\*([^*\n]+)\*(?=$|[\s).,;:!?<])/g, '$1**$2**')
      // +monospace+
      .replace(/(^|[\s(>])\+([^+\n]+)\+(?=$|[\s).,;:!?<])/g, '$1`$2`');
    // _italic_ and `mono` already mean the same thing
  }

  window.adocToMarkdown = (src) => {
    const out = [];
    const lines = String(src).split('\n');
    let lang = '';        // [source,x] remembered for the ---- that follows
    let code = false;     // inside ---- or .... delimiters
    let table = false;    // inside |=== — shown raw in a code box

    for (const l of lines) {
      // ---- listing and .... literal blocks become fences
      if (/^-{4,}\s*$/.test(l) || /^\.{4,}\s*$/.test(l)) {
        out.push(code ? '```' : '```' + lang);
        code = !code;
        lang = '';
        continue;
      }
      if (code) { out.push(l); continue; }

      // |=== tables: no Markdown shape matches, so show the rows verbatim
      if (/^\|={3,}\s*$/.test(l)) { out.push('```'); table = !table; continue; }
      if (table) { out.push(l); continue; }

      // [source,js] keeps its language for the block below; any other
      // [attribute] line, :attr: line or // comment renders as nothing —
      // a blank line, so the count holds
      const srcAttr = l.match(/^\[source(?:\s*,\s*([\w+-]+))?[^\]]*\]\s*$/);
      if (srcAttr) { lang = srcAttr[1] || ''; out.push(''); continue; }
      if (/^\[[^\]]*\]\s*$/.test(l) || /^:[\w!-]+:/.test(l) || /^\/\//.test(l)) {
        out.push('');
        continue;
      }

      // = Title  ==> # Title
      const h = l.match(/^(=+)\s+(.*)$/);
      if (h) { out.push('#'.repeat(Math.min(6, h[1].length)) + ' ' + inline(h[2])); continue; }

      // block image
      const img = l.match(/^image::([^[]+)\[([^\]]*)\]\s*$/);
      if (img) { out.push(`![${img[2].split(',')[0]}](${img[1]})`); continue; }

      // NOTE: / TIP: / WARNING: … admonitions read well as quotes
      const ad = l.match(/^(NOTE|TIP|IMPORTANT|WARNING|CAUTION):\s+(.*)$/);
      if (ad) {
        out.push('> **' + ad[1][0] + ad[1].slice(1).toLowerCase() + ':** ' + inline(ad[2]));
        continue;
      }

      // lists nest by marker count: ** item ==> two levels deep
      const ul = l.match(/^(\*+)\s+(.*)$/);
      if (ul) { out.push('  '.repeat(ul[1].length - 1) + '- ' + inline(ul[2])); continue; }
      const ol = l.match(/^(\.+)\s+(\S.*)$/);
      if (ol) { out.push('  '.repeat(ol[1].length - 1) + '1. ' + inline(ol[2])); continue; }

      // Term:: definition — the description list, as a bold lead-in
      const dl = l.match(/^(\S[^:\n]*)::(\s+(.*))?$/);
      if (dl) { out.push('**' + dl[1] + ':**' + (dl[3] ? ' ' + inline(dl[3]) : '')); continue; }

      out.push(inline(l));
    }
    return out.join('\n');
  };
})();
