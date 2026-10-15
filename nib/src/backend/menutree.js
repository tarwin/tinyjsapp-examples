// Editing menus that aren't written in ONE place: the ones a site builds from
// its folders. Their order is spread across the pages themselves (front
// matter: sidebar_position, sidebar.order, weight, nav_order, order) or
// across one meta file per folder (Fumadocs' meta.json, Nextra's _meta,
// Rspress's _meta.json). An edit here is a set of small writes — each to the
// one key or list it changes — returned as { writes: [{ file, text }] }.
//
// A move stays inside its folder, because in these sites a page's folder IS
// its place in the menu: moving it elsewhere means moving the file, which is
// the file tree's job. (Just the Docs is the exception — its tree is made of
// `parent:` titles, so a page can change parents with a front matter edit.)
//
// Reordering writes as little as it can: if the entries around the new
// spot leave a whole number between their positions, only the moved entry
// changes; otherwise the folder's entries are renumbered 1, 2, 3… — only the
// ones whose number actually changes are written.

import { tokenizeJS, findDefaultExport, safeKey } from './menuparse.js';

const join = (...parts) => parts.filter((x) => x !== undefined && x !== null && x !== '').join('/');

// ------------------------------------------------------------ front matter

function yamlVal(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (/^[\w][\w .,/()&+-]*$/.test(s) && !/^(true|false|null|yes|no|~|-?\d+(\.\d+)?)$/i.test(s) && !/\s$/.test(s)) return s;
  return JSON.stringify(s);
}

// Set (or with value null, remove) `path` — 'title' or one level deep,
// 'sidebar.order' — in a document's front matter, touching only that line.
// Hugo's TOML front matter (+++) takes flat keys.
export function setFrontMatter(text, path, value) {
  const keys = path.split('.');
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines[0] === '+++') {
    if (keys.length > 1) return null;
    const end = lines.indexOf('+++', 1);
    if (end < 0) return null;
    const re = new RegExp('^' + keys[0] + '\\s*=');
    const at = lines.slice(1, end).findIndex((l) => re.test(l));
    const line = keys[0] + ' = ' + (typeof value === 'string' ? JSON.stringify(value) : String(value));
    if (at >= 0) { if (value === null) lines.splice(at + 1, 1); else lines[at + 1] = line; }
    else if (value !== null) lines.splice(end, 0, line);
    return lines.join(nl);
  }
  if (lines[0] !== '---') {
    if (value === null) return text;
    const head = keys.length > 1 ? [keys[0] + ':', '  ' + keys[1] + ': ' + yamlVal(value)] : [keys[0] + ': ' + yamlVal(value)];
    return ['---', ...head, '---', ...lines].join(nl);
  }
  let end = -1;
  for (let n = 1; n < lines.length; n++) if (lines[n] === '---' || lines[n] === '...') { end = n; break; }
  if (end < 0) return null;
  const top = (k) => lines.slice(1, end).findIndex((l) => new RegExp('^' + k + '\\s*:').test(l)) + 1 || -1;
  if (keys.length === 1) {
    const at = top(keys[0]);
    if (at > 0) {
      if (value === null) {
        // and the indented lines under it, if it had any
        let e = at + 1;
        while (e < end && /^\s+\S/.test(lines[e])) e++;
        lines.splice(at, e - at);
      } else lines[at] = keys[0] + ': ' + yamlVal(value);
    } else if (value !== null) lines.splice(end, 0, keys[0] + ': ' + yamlVal(value));
    return lines.join(nl);
  }
  const at = top(keys[0]);
  if (at > 0) {
    if (!/^[^:]+:\s*$/.test(lines[at])) return null;            // `sidebar: { … }` — not ours to rewrite
    let e = at + 1, pad = '  ', hit = -1;
    for (; e < end && /^\s+\S/.test(lines[e]); e++) {
      pad = lines[e].match(/^\s+/)[0];
      if (new RegExp('^\\s+' + keys[1] + '\\s*:').test(lines[e])) hit = e;
    }
    if (hit >= 0) { if (value === null) lines.splice(hit, 1); else lines[hit] = pad + keys[1] + ': ' + yamlVal(value); }
    else if (value !== null) lines.splice(at + 1, 0, pad + keys[1] + ': ' + yamlVal(value));
    return lines.join(nl);
  }
  if (value === null) return text;
  lines.splice(end, 0, keys[0] + ':', '  ' + keys[1] + ': ' + yamlVal(value));
  return lines.join(nl);
}

// a top-level `key: value` in a small YAML file (_category_.yml, index.yml)
function setYamlTop(text, key, value) {
  const lines = (text || '').split('\n');
  const at = lines.findIndex((l) => new RegExp('^' + key + '\\s*:').test(l));
  if (at >= 0) lines[at] = key + ': ' + yamlVal(value);
  else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push(key + ': ' + yamlVal(value), '');
  }
  return lines.join('\n');
}

// the file's indent step: its smallest one (the first indented line may be nested)
const indentOfJson = (text) => {
  let best = null;
  for (const m of (text || '').matchAll(/\n([ \t]+)\S/g)) if (!best || m[1].length < best.length) best = m[1];
  return best || '  ';
};
// written the way the file already was: one line stays one line, and the
// last newline is kept or not as it was
const jsonOut = (obj, like) => {
  const oneLine = like && !/\n\s*\S/.test(like.trim());
  const body = oneLine ? JSON.stringify(obj) : JSON.stringify(obj, null, indentOfJson(like));
  return body + (!like || like.endsWith('\n') ? '\n' : '');
};

// ----------------------------------------------------------------- writes

// Pending writes, read-modify-written through: several edits to one file
// (renumbering in a folder of category files) land as one write.
function writer(ctx) {
  const texts = new Map();
  return {
    async get(rel) {
      if (!texts.has(rel)) texts.set(rel, { text: await ctx.read(rel), changed: false });
      return texts.get(rel).text;
    },
    async put(rel, text) {
      await this.get(rel);
      const t = texts.get(rel);
      if (t.text !== text) { t.text = text; t.changed = true; }
    },
    async fm(rel, path, value) {
      const cur = await this.get(rel);
      if (cur == null) throw new Error('Couldn’t read ' + rel + '.');
      const next = setFrontMatter(cur, path, value);
      if (next == null) throw new Error(rel + ' writes its ' + path.split('.')[0] + ' in a way Nib won’t rewrite — change it there.');
      await this.put(rel, next);
    },
    out: () => [...texts].filter(([, t]) => t.changed).map(([file, t]) => ({ file, text: t.text })),
  };
}

// ----------------------------------------------------------- the flavors

// key names in each system's front matter, and what a folder writes to
const FM = {
  docusaurus: { pos: 'sidebar_position', label: 'sidebar_label', hide: null,
    whyNoHide: 'Docusaurus has no “hide from the sidebar” switch for one page — list the sidebar in sidebars.js, or make the page a draft.' },
  starlight: { pos: 'sidebar.order', label: 'sidebar.label', hide: ['sidebar.hidden', true] },
  hugo: { pos: 'weight', label: 'linkTitle', hide: null,
    whyNoHide: 'Hugo has no standard “hide from the menu” switch — that’s the theme’s (Docsy uses toc_hide).' },
  jtd: { pos: 'nav_order', label: 'title', hide: ['nav_exclude', true] },
  retype: { pos: 'order', label: 'label', hide: ['visibility', 'hidden'], desc: true },
};

async function categoryFile(ctx, dir) {
  for (const n of ['_category_.json', '_category_.yml', '_category_.yaml']) {
    if ((await ctx.read(join(dir, n))) != null) return join(dir, n);
  }
  return null;
}

// Write one entry's sort position (ascending "sort space"; Retype's
// higher-first order is flipped on the way out)
async function writePos(w, ctx, flavor, node, sortPos) {
  const f = FM[flavor];
  const value = f.desc ? -sortPos : sortPos;
  if (node.dir && flavor === 'docusaurus') {
    const cat = await categoryFile(ctx, node.dir);
    const file = cat || join(node.dir, '_category_.json');
    const text = await w.get(file);
    if (file.endsWith('.json')) {
      let obj = {};
      try { obj = text ? JSON.parse(text) : {}; } catch { throw new Error(file + ' isn’t valid JSON.'); }
      obj.position = value;
      await w.put(file, jsonOut(obj, text));
    } else await w.put(file, setYamlTop(text, 'position', value));
    return;
  }
  if (node.dir && flavor === 'retype') {
    const file = join(node.dir, 'index.yml');
    await w.put(file, setYamlTop(await w.get(file), 'order', value));
    return;
  }
  if (!node.file) throw new Error('“' + node.text + '” has no file of its own to hold its place.');
  await w.fm(node.file, f.pos, value);
}

function canPlace(flavor, node) {
  if (flavor === 'starlight') return !node.dir;           // Starlight folders sort by name
  if (flavor === 'hugo') return !!node.file;              // a section needs its _index.md
  return !!(node.file || node.dir);
}

// The new order of a list: renumber, or squeeze the moved one in
async function placeAll(w, ctx, flavor, order, moved) {
  const k = order.indexOf(moved);
  const others = order.filter((n) => n !== moved && canPlace(flavor, n));
  const placed = others.every((n) => n.pos !== null && n.pos !== undefined);
  const mono = placed && order.filter((n) => n !== moved && canPlace(flavor, n))
    .every((n, i, a) => i === 0 || a[i - 1].pos < n.pos);
  if (mono) {
    const before = order.slice(0, k).reverse().find((n) => canPlace(flavor, n));
    const after = order.slice(k + 1).find((n) => canPlace(flavor, n));
    const lo = before ? before.pos : null, hi = after ? after.pos : null;
    let cand = lo === null && hi === null ? 1 : lo === null ? Math.ceil(hi) - 1 : hi === null ? Math.floor(lo) + 1
      : (Math.floor(lo) + 1 < hi ? Math.floor(lo) + 1 : null);
    // Hugo reads weight 0 as "no weight"; Retype's order 0 is its default
    if (cand !== null && (flavor === 'hugo' || flavor === 'docusaurus' || flavor === 'jtd') && cand < 1) cand = null;
    if (cand !== null && flavor === 'retype' && cand === 0) cand = null;
    if (cand !== null) { await writePos(w, ctx, flavor, moved, cand); return; }
  }
  // renumber, writing only what changes
  const list = order.filter((n) => canPlace(flavor, n));
  for (let i = 0; i < list.length; i++) {
    const sortPos = FM[flavor].desc ? i - list.length : i + 1;
    if (list[i].pos !== sortPos) await writePos(w, ctx, flavor, list[i], sortPos);
  }
}

function locate(menu, at) {
  if (at === null || at === undefined) return { item: null, list: menu.items, index: -1, parent: null };
  const ids = String(at).split('.').map(Number);
  let list = menu.items, parent = null, item = null;
  for (let k = 0; k < ids.length; k++) {
    item = list && list[ids[k]];
    if (!item) return null;
    if (k < ids.length - 1) { parent = item; list = item.items; }
  }
  return { item, list, index: ids[ids.length - 1], parent };
}

// ------------------------------------------------------- front-matter edit

export async function fmEdit(ctx, menu, op) {
  const at = locate(menu, op.at);
  if (!at || !at.item) return { error: 'That entry isn’t there any more.' };
  const it = at.item;
  const flavor = it.fm;
  const f = FM[flavor];
  const w = writer(ctx);
  try {
    if (op.kind === 'rename') {
      const name = String(op.text).trim();
      if (!name) return { error: 'A name can’t be empty.' };
      if (flavor === 'jtd') {
        // the title IS the key its children hang from: re-aim them too
        await w.fm(it.file, 'title', name);
        for (const kid of it.items || []) {
          if (kid.file) await w.fm(kid.file, 'parent', name);
          for (const gk of kid.items || []) if (gk.file) await w.fm(gk.file, 'grand_parent', name);
        }
      } else if (it.dir && flavor === 'docusaurus') {
        const cat = (await categoryFile(ctx, it.dir)) || join(it.dir, '_category_.json');
        const text = await w.get(cat);
        if (cat.endsWith('.json')) {
          let obj = {};
          try { obj = text ? JSON.parse(text) : {}; } catch { return { error: cat + ' isn’t valid JSON.' }; }
          obj.label = name;
          await w.put(cat, jsonOut(obj, text));
        } else await w.put(cat, setYamlTop(text, 'label', name));
      } else if (it.dir && flavor === 'retype') {
        const file = join(it.dir, 'index.yml');
        await w.put(file, setYamlTop(await w.get(file), 'label', name));
      } else if (it.dir && flavor === 'starlight') {
        return { error: 'Starlight names an autogenerated group after its folder — rename the folder, or give the group a label in the config.' };
      } else if (it.file) await w.fm(it.file, f.label, name);
      else return { error: 'Nothing to write the name into.' };
      return { writes: w.out() };
    }

    if (op.kind === 'remove') {
      if (!f.hide) return { error: f.whyNoHide };
      if (it.dir && flavor === 'retype') {
        const file = join(it.dir, 'index.yml');
        await w.put(file, setYamlTop(await w.get(file), 'visibility', 'hidden'));
      } else if (it.file && !it.dir) await w.fm(it.file, f.hide[0], f.hide[1]);
      else return { error: 'A folder can’t be hidden from here — hide its pages.' };
      return { writes: w.out() };
    }

    if (op.kind !== 'move') return { error: 'Pages here are listed by their folder — there’s nothing to add them to.' };
    const to = locate(menu, op.to);
    if (!to) return { error: 'Can’t find where to put it.' };
    if (op.to !== null && String(op.to).startsWith(String(op.at) + '.')) return { error: 'Can’t move an entry into itself.' };

    if (flavor === 'jtd') {
      // a new parent is a front matter edit; then the order among the new siblings
      let parent, list;
      if (op.where === 'inside') { parent = to.item; list = to.item.items || []; }
      else if (!to.item) { parent = null; list = menu.items; }
      else { parent = to.parent; list = to.list; }
      if (parent && !parent.file) return { error: 'Only a page can hold others in Just the Docs.' };
      const grand = parent ? findParent(menu.items, parent) ?? null : null;
      if (parent !== at.parent) {
        await w.fm(it.file, 'parent', parent ? parent.text : null);
        await w.fm(it.file, 'grand_parent', grand ? grand.text : null);
        for (const kid of it.items || []) if (kid.file) await w.fm(kid.file, 'grand_parent', parent ? parent.text : null);
      }
      const order = list.filter((n) => n !== it);
      const i = op.where === 'inside' || !to.item ? order.length : order.indexOf(to.item) + (op.where === 'after' ? 1 : 0);
      order.splice(i, 0, it);
      await placeAll(w, ctx, flavor, order, it);
      return { writes: w.out() };
    }

    if (op.where === 'inside' || !to.item || to.list !== at.list) {
      return { error: 'This menu follows the folders — to move a page to another group, move its file in the Project tab.' };
    }
    if (!canPlace(flavor, it)) {
      return { error: flavor === 'starlight' ? 'Starlight sorts autogenerated folders by name — rename the folder to move it.'
        : 'Give this section an _index.md so it has a weight to move by.' };
    }
    const order = at.list.filter((n) => n !== it);
    order.splice(order.indexOf(to.item) + (op.where === 'after' ? 1 : 0), 0, it);
    await placeAll(w, ctx, flavor, order, it);
    return { writes: w.out() };
  } catch (e) {
    return { error: e.message };
  }
}

// the entry `target` sits under — null at the top, undefined if absent
function findParent(items, target, parent = null) {
  for (const it of items || []) {
    if (it === target) return parent;
    const p = findParent(it.items, target, it);
    if (p !== undefined) return p;
  }
  return undefined;
}

// --------------------------------------------------------- meta-file edit

// The meta file a folder's order lives in, per system
async function metaFileFor(ctx, menu, dir) {
  if (menu.flavor === 'fumadocs') return join(dir, 'meta.json');
  if (menu.flavor === 'rspress') return join(dir, '_meta.json');
  for (const n of ['_meta.json', '_meta.js', '_meta.ts', '_meta.jsx', '_meta.tsx']) {
    if ((await ctx.read(join(dir, n))) != null) return join(dir, n);
  }
  // none yet: the same kind as the root's
  const ext = (menu.source.file.match(/\.(json|[jt]sx?)$/) || [, 'json'])[1];
  return join(dir, '_meta.' + ext);
}

export async function metaEdit(ctx, menu, op) {
  const at = locate(menu, op.at);
  if (!at || !at.item || !at.item.meta) return { error: 'That entry isn’t there any more.' };
  const it = at.item;
  const dir = it.meta.dir;
  if (at.list.some((n) => n.meta && n.meta.dir !== dir)) {
    return { error: 'Part of this list is spread in from another folder — edit that folder’s meta file.' };
  }
  const file = await metaFileFor(ctx, menu, dir);
  const text = await ctx.read(file);
  const w = writer(ctx);
  try {
    if (op.kind === 'rename') {
      const name = String(op.text).trim();
      if (!name) return { error: 'A name can’t be empty.' };
      if (menu.flavor === 'fumadocs') {
        if (it.dir) {
          const sub = join(it.dir, 'meta.json');
          const t = await w.get(sub);
          let obj = {};
          try { obj = t ? JSON.parse(t) : {}; } catch { return { error: sub + ' isn’t valid JSON.' }; }
          obj.title = name;
          await w.put(sub, jsonOut(obj, t));
        } else if (it.file) await w.fm(it.file, 'title', name);
        else return { error: 'Rename it in ' + file + '.' };
        return { writes: w.out() };
      }
      if (menu.flavor === 'rspress') {
        const arr = parseArr(text, file);
        const i = entryIndex(arr, it);
        if (i < 0) return { error: 'Add it to ' + file + ' first (move it once).' };
        const e = arr[i];
        arr[i] = typeof e === 'string' ? { type: it.meta.isDir ? 'dir' : 'file', name: e, label: name } : { ...e, label: name };
        await w.put(file, jsonOut(arr, text));
        return { writes: w.out() };
      }
      await w.put(file, nextraSet(text, file, it.meta.key, { title: name }));
      return { writes: w.out() };
    }

    if (op.kind === 'remove') {
      if (menu.flavor === 'fumadocs') {
        const obj = parseObj(text, file);
        const pages = Array.isArray(obj.pages) ? obj.pages : ['...'];
        const kept = pages.filter((p) => p !== it.meta.key);
        // a page `...` would bring back gets a `!` — a divider or link just goes
        if (it.kind !== 'sep' && it.kind !== 'link' && (kept.includes('...') || kept.includes('z...a'))) kept.push('!' + it.meta.key);
        obj.pages = kept;
        await w.put(file, jsonOut(obj, text));
      } else if (menu.flavor === 'rspress') {
        const arr = text ? parseArr(text, file) : at.list.map((n) => n.meta.entry);
        const i = entryIndex(arr, it);
        if (i >= 0) arr.splice(i, 1);
        await w.put(file, jsonOut(arr, text));
      } else if (it.kind === 'sep') await w.put(file, nextraDrop(text, file, it.meta.key));
      else await w.put(file, nextraSet(text, file, it.meta.key, { display: 'hidden' }, it.text));
      return { writes: w.out() };
    }

    if (op.kind !== 'move') return { error: 'Pages here are listed by their folder — there’s nothing to add them to.' };
    const to = locate(menu, op.to);
    if (!to || op.where === 'inside' || !to.item || to.list !== at.list) {
      return { error: 'This menu follows the folders — to move a page to another group, move its file in the Project tab.' };
    }
    const order = at.list.filter((n) => n !== it);
    order.splice(order.indexOf(to.item) + (op.where === 'after' ? 1 : 0), 0, it);

    if (menu.flavor === 'fumadocs') {
      const obj = parseObj(text, file);
      const old = Array.isArray(obj.pages) ? obj.pages : [];
      const rest = old.find((p) => p === '...' || p === 'z...a');
      const excluded = old.filter((p) => typeof p === 'string' && p.startsWith('!'));
      const keys = order.map((n) => n.meta.key);
      // `...` stays among the pages it used to bring in, so a new page
      // still turns up there; listing them now fixes their order
      if (rest) {
        let last = -1;
        order.forEach((n, i) => { if (n.meta.rest) last = i; });
        keys.splice(last + 1, 0, rest);
      }
      obj.pages = [...keys, ...excluded];
      await w.put(file, jsonOut(obj, text));
    } else if (menu.flavor === 'rspress') {
      await w.put(file, jsonOut(order.map((n) => n.meta.entry ?? n.meta.key), text));
    } else {
      await w.put(file, nextraOrder(text, file, order));
    }
    return { writes: w.out() };
  } catch (e) {
    return { error: e.message };
  }
}

function parseObj(text, file) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error(file + ' isn’t valid JSON.'); }
}
function parseArr(text, file) {
  const v = text ? parseObj(text, file) : [];
  if (!Array.isArray(v)) throw new Error(file + ' isn’t a list.');
  return v;
}
const entryIndex = (arr, it) => arr.findIndex((e) => (typeof e === 'string' ? e : e && e.name) === it.meta.key
  || JSON.stringify(e) === JSON.stringify(it.meta.entry));

// ------------------------------------------------------------ Nextra _meta

const isJsonMeta = (file) => file.endsWith('.json');
const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const keyLit = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k));

// Set fields of one key's entry (`title`, `display`); a string entry
// becomes an object when it needs more than a title.
function nextraSet(text, file, key, fields, fallbackTitle) {
  if (!safeKey(key)) throw new Error('Nib won’t write a key called “' + key + '”.');
  if (!text || isJsonMeta(file)) {
    const obj = parseObj(text, file);
    const cur = obj[key];
    if (fields.title && Object.keys(fields).length === 1 && (cur === undefined || typeof cur === 'string')) obj[key] = fields.title;
    else {
      const base = typeof cur === 'string' ? { title: cur } : cur && typeof cur === 'object' ? cur : (fallbackTitle ? { title: fallbackTitle } : {});
      obj[key] = { ...base, ...fields };
    }
    if (!text && !isJsonMeta(file)) return 'export default ' + jsLiteral(obj) + '\n';
    return jsonOut(obj, text);
  }
  const toks = tokenizeJS(text);
  const got = findDefaultExport(text, toks);
  if (!got || !got.v || typeof got.v !== 'object' || !got.v.$keys) throw new Error(file + ' builds its menu in code — edit it there.');
  const k = got.v.$keys.find((x) => x.key === key);
  const cur = got.v[key];
  if (!k) {
    // not listed yet: add it at the end
    const body = fields.title && Object.keys(fields).length === 1 ? q(fields.title)
      : jsLiteral({ ...(fallbackTitle ? { title: fallbackTitle } : {}), ...fields });
    return insertProp(text, got, keyLit(key) + ': ' + body);
  }
  if (typeof cur === 'string') {
    const next = fields.title && Object.keys(fields).length === 1 ? q(fields.title) : jsLiteral({ title: cur, ...fields });
    return text.slice(0, k.s) + next + text.slice(k.e);
  }
  if (cur && typeof cur === 'object' && cur.$keys) {
    let out = text;
    // last first, so earlier offsets hold
    const edits = [];
    for (const [f, v] of Object.entries(fields)) {
      const fk = cur.$keys.find((x) => x.key === f);
      if (fk) edits.push({ s: fk.s, e: fk.e, t: q(v) });
      else edits.push({ s: k.s + 1, e: k.s + 1, t: ' ' + f + ': ' + q(v) + ',' });
    }
    edits.sort((a, b) => b.s - a.s);
    for (const x of edits) out = out.slice(0, x.s) + x.t + out.slice(x.e);
    return out;
  }
  throw new Error('“' + key + '” is built by code in ' + file + '.');
}

// take a key out altogether (a separator has nothing to hide)
function nextraDrop(text, file, key) {
  if (isJsonMeta(file)) {
    const obj = parseObj(text, file);
    delete obj[key];
    return jsonOut(obj, text);
  }
  const got = findDefaultExport(text, tokenizeJS(text));
  const k = got && got.v && got.v.$keys && got.v.$keys.find((x) => x.key === key);
  if (!k) return text;
  const tail = /^\s*,?[ \t]*\n?/.exec(text.slice(k.e))[0];
  const ls = text.lastIndexOf('\n', k.ks) + 1;
  const own = !text.slice(ls, k.ks).trim() && tail.endsWith('\n');
  return own ? text.slice(0, ls) + text.slice(k.e + tail.length) : text.slice(0, k.ks) + text.slice(k.e + tail.length);
}

function jsLiteral(obj) {
  return '{ ' + Object.entries(obj).map(([k, v]) => keyLit(k) + ': ' + (typeof v === 'string' ? q(v) : JSON.stringify(v))).join(', ') + ' }';
}

function insertProp(text, got, propText) {
  const keys = got.v.$keys;
  if (!keys.length) return text.slice(0, got.s) + '{\n  ' + propText + ',\n}' + text.slice(got.e);
  const last = keys[keys.length - 1];
  const ls = text.lastIndexOf('\n', last.ks) + 1;
  const pad = /^\s*/.exec(text.slice(ls, last.ks))[0];
  const comma = /^\s*,/.test(text.slice(last.e));
  return text.slice(0, last.e) + (comma ? '' : ',') + '\n' + pad + propText + (comma ? ',' : '') + text.slice(last.e);
}

// Rewrite the key order: the moved list first, in its new order; then every
// other key the file had (top-bar pages, hidden ones, '*') as they were.
function nextraOrder(text, file, order) {
  const keys = order.map((n) => n.meta.key);
  if (keys.some((k) => !safeKey(k))) throw new Error('Nib won’t write a key called “__proto__”.');
  if (!text || isJsonMeta(file)) {
    const old = parseObj(text, file);
    const out = {};
    for (const n of order) out[n.meta.key] = Object.prototype.hasOwnProperty.call(old, n.meta.key) ? old[n.meta.key] : n.text;
    for (const [k, v] of Object.entries(old)) if (safeKey(k) && !Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
    if (!text && !isJsonMeta(file)) {
      return 'export default {\n' + Object.entries(out).map(([k, v]) => '  ' + keyLit(k) + ': ' + (typeof v === 'string' ? q(v) : JSON.stringify(v))).join(',\n') + ',\n}\n';
    }
    return jsonOut(out, text);
  }
  const toks = tokenizeJS(text);
  const got = findDefaultExport(text, toks);
  if (!got || !got.v || !got.v.$keys || got.v.$spread) throw new Error(file + ' builds its menu in code — edit it there.');
  const props = new Map(got.v.$keys.map((k) => [k.key, text.slice(k.ks, k.e)]));
  const first = got.v.$keys[0];
  const ls = first ? text.lastIndexOf('\n', first.ks) + 1 : got.s;
  const pad = first ? (/^\s*/.exec(text.slice(ls, first.ks))[0] || '  ') : '  ';
  const closePad = pad.slice(0, Math.max(0, pad.length - 2));
  const ordered = [];
  for (const n of order) ordered.push(props.get(n.meta.key) ?? (keyLit(n.meta.key) + ': ' + q(n.text)));
  for (const [k, p] of props) if (!keys.includes(k)) ordered.push(p);
  return text.slice(0, got.s) + '{\n' + ordered.map((p) => pad + p).join(',\n') + ',\n' + closePad + '}' + text.slice(got.e);
}
