// Undo / redo for the document buffer — nib's own, because the textarea's
// native history can't survive this app: every `ed.value =` assignment (a
// tab switch, a Live-mode serialize, a rename rewriting links) wipes it, and
// the editable preview's edits never enter it at all.
//
// One history per sheet, held as DIFFS: old and new buffer are compared by
// trimming their common prefix and suffix, and only the changed span is
// kept — { at, del, ins }. A keystroke costs its characters, not a copy of
// the document. The recorder doesn't care where a change came from (typing,
// Live editing, Replace All, a checkbox click); whatever moved the buffer
// since last look becomes the next step, so no mutation site can be missed.
//
// Grouping: records that land close together and continue the same insertion
// (or the same backspace run) extend the previous step instead of piling new
// ones — undo takes back a burst of typing, not one character. A step that
// has grown to a line's worth stops absorbing more.

(() => {
  const GROUP_MS = 1500;       // records closer than this may merge…
  const GROUP_MAX = 80;        // …until the step holds about a line
  const MAX_ENTRIES = 1000;    // per sheet
  const MAX_CHARS = 1 << 20;   // ~1 MB of stored spans per sheet, oldest out

  // the changed span, or null if nothing moved
  function diff(a, b) {
    if (a === b) return null;
    let s = 0;
    const max = Math.min(a.length, b.length);
    while (s < max && a.charCodeAt(s) === b.charCodeAt(s)) s++;
    let ea = a.length, eb = b.length;
    while (ea > s && eb > s && a.charCodeAt(ea - 1) === b.charCodeAt(eb - 1)) { ea--; eb--; }
    return { at: s, del: a.slice(s, ea), ins: b.slice(s, eb) };
  }

  function setupHistory() {
    const stacks = new Map();            // sheetId -> { undo: [], redo: [], chars }
    let cur = null;                      // the active sheet's stacks
    let prev = '';                       // the buffer as last recorded

    const forSheet = (id) => {
      if (!stacks.has(id)) stacks.set(id, { undo: [], redo: [], chars: 0 });
      return stacks.get(id);
    };
    const trim = () => {
      while (cur.undo.length > MAX_ENTRIES || cur.chars > MAX_CHARS) {
        const e = cur.undo.shift();
        if (!e) break;
        cur.chars -= e.del.length + e.ins.length;
      }
    };

    const record = (text, hard) => {
      if (!cur) return false;
      const d = diff(prev, String(text));
      if (!d) return false;
      const now = Date.now();
      const last = cur.undo[cur.undo.length - 1];
      const near = last && !hard && now - last.ts < GROUP_MS
        && last.ins.length + last.del.length < GROUP_MAX;
      if (near && !d.del && d.at === last.at + last.ins.length) {
        last.ins += d.ins;                         // typing carries on
        last.ts = now;
      } else if (near && !d.ins && !last.ins && d.at + d.del.length === last.at) {
        last.del = d.del + last.del;               // backspacing carries on
        last.at = d.at;
        last.ts = now;
        last.grew = true;                          // a run, not one gesture
      } else {
        cur.undo.push({ ...d, ts: now });
        cur.chars += d.del.length + d.ins.length;
        trim();
      }
      cur.redo.length = 0;
      prev = String(text);
      return true;
    };

    return {
      // a sheet arrived (or came back): its text is the baseline from here
      open(id, text) { cur = forSheet(id); prev = String(text ?? ''); },
      drop(id) { stacks.delete(id); },
      record,
      // both first fold in whatever the buffer holds — a pending change
      // becomes a step (and, being a fresh edit, clears redo, as it must)
      undo(text) {
        record(text);
        const e = cur && cur.undo.pop();
        if (!e) return null;
        cur.redo.push(e);
        prev = prev.slice(0, e.at) + e.del + prev.slice(e.at + e.ins.length);
        // A step that swallowed text in ONE gesture — a selection deleted,
        // cut, or typed over — hands it back SELECTED: the selection you had
        // was part of the state undo restores. A backspace RUN (grew) comes
        // back as a caret after the restored text, the way native undo does.
        return { text: prev, caret: e.at + e.del.length,
          sel: e.del.length > 1 && !e.grew ? [e.at, e.at + e.del.length] : null };
      },
      redo(text) {
        record(text);
        const e = cur && cur.redo.pop();
        if (!e) return null;
        cur.undo.push(e);
        prev = prev.slice(0, e.at) + e.ins + prev.slice(e.at + e.del.length);
        return { text: prev, caret: e.at + e.ins.length };
      },
    };
  }

  window.setupHistory = setupHistory;
})();
