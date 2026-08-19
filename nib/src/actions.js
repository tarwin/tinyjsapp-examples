// Actions — the little buttons that run something. A folder full of Markdown
// usually has a build, a deploy, a formatter and three shell one-liners living
// in someone's terminal history; this is where they live instead.
//
// Two files hold them and the difference matters more than it looks:
//
//   <app data>/actions.json    yours, on this machine, in every folder —
//                              nothing but you can write it, so it is trusted
//   <folder>/.nib/actions.json the folder's own, and it TRAVELS: clone a repo
//                              and its actions come with it, written by
//                              somebody else. Those are inert until you say
//                              otherwise, per action, and the grant is pinned
//                              to a hash of what you approved (trust.js).
//
// An action has a `type` because "run a command" is only the first answer.
// Today: 'cli' (argv, spawned), 'js' (a script, run in the backend's own
// QuickJS realm with a small `ctx` of file helpers) and 'ai' (a prompt, sent
// to whichever model you configured — ai.js). That third one is why the type
// existed: nothing else in this file moved to add it. The loading, the gating,
// the variables, the trust, the output drawer are all the same machinery.
//
// The one thing that is deliberately NOT a string is the command. `run` is an
// argv array, so a path with a space in it is one argument and not a quoting
// bug; `"shell": true` is there for the day you really do want a pipeline.

import { generate, aiConfig, providerConfig, effectivePolicy } from './ai.js';
import { buildTools, framePrompt, GUARD } from './aitools.js';

const dec = new TextDecoder();
const enc = new TextEncoder();

export const ACTION_TYPES = new Set(['cli', 'js', 'ai']);
const NEEDS = new Set(['none', 'folder', 'file', 'selection']);
// 'notify' is the old name for 'toast' and still works — it was always an
// in-app toast rather than a system notification, and renaming it without
// keeping the old spelling would break every actions file that used it.
const OUTPUTS = new Set(['panel', 'replace', 'insert', 'doc', 'toast', 'alert', 'notify', 'none']);
const STDINS = new Set(['none', 'doc', 'selection']);
const ASK_TYPES = new Set(['text', 'multiline', 'number', 'choice', 'file', 'folder', 'check']);
// An icon is a glyph or an Iconify NAME ("icon-park-outline:word"), never a
// picture: no file to find, nothing to ship. The cap is a sanity bound, not a
// grapheme count — it has to clear the longest set:name pairs Iconify serves,
// and 8 was silently beheading them into gibberish the menus then displayed.
const ICON_CAP = 64;

const OS = () => (tjs.env.OS === 'Windows_NT' ? 'windows'
  : /linux/i.test(globalThis.navigator?.platform ?? '') ? 'linux' : 'macos');

// A GUI app inherits launchd's idea of PATH — /usr/bin:/bin:/usr/sbin:/sbin —
// and nothing a developer has installed is on it. Every "command not found"
// this feature could possibly produce starts here, so the search path is the
// inherited one PLUS the places things actually live, plus whatever the
// actions file adds. Cheap, and it turns a mystery into a working button.
const EXTRA_PATH = () => {
  const home = tjs.homeDir;
  if (OS() === 'windows') return [];
  return [
    home + '/.local/bin', home + '/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin',
    '/usr/local/bin', '/usr/local/sbin', home + '/.cargo/bin', home + '/.bun/bin',
    home + '/go/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ];
};

const base = (p) => p.split(/[\\/]/).pop();
const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '') || '/';
const stemOf = (p) => base(p).replace(/\.[^.]+$/, '');
const extOf = (p) => (/\.([^.\\/]+)$/.exec(base(p)) || [null, ''])[1];

// ---------------------------------------------------------------- loading

// Everything a hand-written file can get wrong is fixed here or dropped here,
// once, so nothing downstream has to ask whether `run` is really an array.
// Dropped ones come back as `problems` — an action that silently isn't there
// is worse than one that says why.
function normalize(raw, i, scope, problems) {
  const where = raw && raw.label ? `“${raw.label}”` : `#${i + 1}`;
  const bad = (why) => { problems.push(`${where}: ${why}`); return null; };
  if (!raw || typeof raw !== 'object') return bad('not an object');

  const type = raw.type || 'cli';
  if (!ACTION_TYPES.has(type)) return bad(`unknown type “${type}”`);

  const a = {
    scope,
    id: String(raw.id || raw.label || '').trim() || 'action-' + (i + 1),
    label: String(raw.label || raw.id || 'Action').trim(),
    type,
    needs: NEEDS.has(raw.needs) ? raw.needs : (raw.needs === true ? 'folder' : 'none'),
    match: raw.match ? [].concat(raw.match).map(String) : null,
    os: raw.os ? [].concat(raw.os).map(String) : null,
    cwd: raw.cwd ? String(raw.cwd) : null,
    env: raw.env && typeof raw.env === 'object' ? { ...raw.env } : null,
    path: Array.isArray(raw.path) ? raw.path.map(String) : null,
    stdin: STDINS.has(raw.stdin) ? raw.stdin : 'none',
    output: OUTPUTS.has(raw.output) ? raw.output : 'panel',
    confirm: !!raw.confirm,
    timeout: Number.isFinite(raw.timeout) ? Math.max(1000, raw.timeout) : 120000,
    save: raw.save !== false,          // write the document first — see runAction
    shell: !!raw.shell,

    // How it presents itself. None of this changes what the action DOES, so
    // none of it is in the trust hash: pinning a button to the toolbar must
    // not ask you to approve its command again.
    icon: raw.icon ? String(raw.icon).slice(0, ICON_CAP) : null,
    description: raw.description ? String(raw.description).slice(0, 600) : null,
    toolbar: !!raw.toolbar,            // a pinned button beside the ⚡
    selection: !!raw.selection,        // offered on a selection in the preview

    // Questions to ask before it runs. The answers become variables, so
    // {branch} in a command is filled by the field labelled Branch.
    ask: normalizeAsk(raw.ask, where, problems),
  };

  if (type === 'cli') {
    // A bare string is taken as a shell line rather than refused: it's what
    // everyone types first, and refusing it would only teach the lesson twice.
    let run = raw.run !== undefined ? raw.run : raw.command;
    if (typeof run === 'string') { a.run = [run]; a.shell = true; }
    else if (Array.isArray(run) && run.length && run.every((x) => typeof x === 'string')) a.run = run;
    else if (run !== undefined) return bad('“run” must be an argv array (or a string, for a shell line)');
    const hadBase = !!a.run;
    // Per-OS override, so one file can serve three machines. The block's own
    // run decides shell mode the way the top-level one does — a string is a
    // shell line, an argv array is not — rather than inheriting whichever
    // the base happened to be.
    const over = raw[OS()];
    if (over && typeof over === 'object') {
      if (typeof over.run === 'string') { a.run = [over.run]; a.shell = true; }
      else if (Array.isArray(over.run)) { a.run = over.run.map(String); a.shell = false; }
      if (over.shell !== undefined) a.shell = !!over.shell;
      if (over.cwd) a.cwd = String(over.cwd);
      if (over.env) a.env = { ...(a.env || {}), ...over.env };
    }
    // No top-level run at all: the per-OS blocks ARE the action, and it only
    // exists on the platforms that wrote one. `os` can narrow that further,
    // never widen it — a platform with no command has nothing to offer.
    if (!hadBase) {
      const blocks = ['macos', 'windows', 'linux']
        .filter((o) => raw[o] && typeof raw[o] === 'object' && raw[o].run !== undefined);
      if (!blocks.length) return bad('“run” must be an argv array (or a string, for a shell line)');
      a.os = (a.os || blocks).filter((o) => blocks.includes(o));
    }
  } else if (type === 'js') {
    if (typeof raw.script === 'string' && raw.script.trim()) a.script = raw.script;
    else if (typeof raw.file === 'string' && raw.file.trim()) a.file = raw.file;
    else return bad('a js action needs “script” or “file”');
    // a script asks for itself — ctx.prompt, ctx.choose, ctx.pickFile — and
    // one way to ask beats two, so `ask` is a cli/ai thing
    if (a.ask) {
      a.ask = null;
      problems.push(`${where}: “ask” is for command and AI actions — a script asks with ctx.prompt`);
    }
  } else if (type === 'ai') {
    const prompt = typeof raw.prompt === 'string' ? raw.prompt
      : typeof raw.run === 'string' ? raw.run : '';
    if (!prompt.trim()) return bad('an ai action needs a “prompt”');
    a.prompt = prompt;
    a.system = typeof raw.system === 'string' ? raw.system : null;
    a.tools = ['off', 'read', 'full'].includes(raw.tools) ? raw.tools : null;
    a.approve = ['never', 'writes', 'always'].includes(raw.approve) ? raw.approve : null;
    a.temperature = Number.isFinite(raw.temperature) ? raw.temperature : undefined;
    // an AI action with no `stdin` still wants the document — that is what it
    // is FOR — so the default flips here rather than making everyone say it
    if (!raw.stdin) a.stdin = 'doc';
    if (!raw.output) a.output = 'panel';

    // THE RULE (ai.js says it at length): where the request goes, and what
    // pays for it, is yours. A folder's action carries a prompt and nothing
    // else — no endpoint, no key, and not even a choice of model, because a
    // repository picking your most expensive one is still a repository
    // spending your money. Yours may choose freely; it's your file.
    if (scope === 'global') {
      a.provider = raw.provider ? String(raw.provider) : null;
      a.model = raw.model ? String(raw.model) : null;
    } else {
      a.provider = null;
      a.model = null;
      if (raw.provider || raw.model || raw.base || raw.baseUrl || raw.key || raw.apiKey) {
        problems.push(`${where}: a folder’s action can’t choose the provider, model or key `
          + '— it runs on the one you set in AI Settings');
      }
      if (a.tools === 'full') {
        a.tools = null;         // a folder cannot hand itself the power tools
        problems.push(`${where}: “tools”: “full” is ignored for a folder’s action`);
      }
      if (a.approve === 'never') {
        a.approve = null;       // …nor talk its way out of being asked
        problems.push(`${where}: “approve”: “never” is ignored for a folder’s action`);
      }
    }
  }
  return a;
}

// `ask` — the little form an action can put in front of itself. The shorthand
// is a bare string ("Branch name"), because most of them want one line of
// text and nobody should have to write an object to get it.
//
// The names are what the variables are called, so they are slugged into
// something `{...}` can actually address, and a name that would collide with a
// built-in variable ({file}, {sel}, …) is refused rather than silently losing
// to it — a form field that does nothing is a bad afternoon.
function normalizeAsk(raw, where, problems) {
  if (!raw) return null;
  const list = [].concat(raw);
  const out = [];
  const taken = new Set(RESERVED_VARS);
  list.forEach((one, i) => {
    const o = typeof one === 'string' ? { label: one } : (one || {});
    const label = String(o.label || o.name || 'Value').trim();
    let name = String(o.name || label).toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    if (!name) name = 'value' + (i + 1);
    if (taken.has(name)) {
      problems.push(`${where}: “ask” field “${name}” collides with a built-in variable`);
      return;
    }
    taken.add(name);
    const type = ASK_TYPES.has(o.type) ? o.type : (o.choices ? 'choice' : 'text');
    out.push({
      name, label, type,
      placeholder: o.placeholder ? String(o.placeholder) : '',
      hint: o.hint ? String(o.hint) : '',
      value: o.default !== undefined ? String(o.default) : '',
      required: o.required !== false && type !== 'check',
      choices: type === 'choice' ? [].concat(o.choices || []).map(String) : null,
    });
  });
  return out.length ? out : null;
}

// Everything vars() already defines — an `ask` field may not shadow one.
const RESERVED_VARS = ['file', 'dir', 'root', 'rel', 'name', 'stem', 'ext', 'doc',
  'rootname', 'pin', 'sel', 'line', 'col', 'heading', 'home', 'date', 'time', 'reldir'];

// The actions file is written by hand, so it is read as JSONC: // and /* */
// survive the way they do in every other editor's config. Strings are walked
// rather than regexed past, because a `//` inside a URL is not a comment and
// finding that out from a broken build would be a miserable afternoon.
export function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], d = text[i + 1];
    if (c === '"') {                              // copy the whole string whole
      out += c;
      for (i++; i < text.length; i++) {
        out += text[i];
        if (text[i] === '\\') { out += text[++i]; continue; }
        if (text[i] === '"') break;
      }
      continue;
    }
    if (c === '/' && d === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));   // and a trailing comma is forgiven
}

async function readActionsFile(path, scope) {
  let raw;
  try { raw = parseJsonc(dec.decode(await tjs.readFile(path))); }
  catch (e) {
    // ENOENT is the normal case — most folders have no actions
    if (/no such file|ENOENT/i.test(e.message || '')) return { list: [], problems: [] };
    return { list: [], problems: ['couldn’t read ' + base(path) + ': ' + e.message] };
  }
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.actions) ? raw.actions : [];
  const problems = [];
  const list = arr.map((r, i) => normalize(r, i, scope, problems)).filter(Boolean);
  // two actions with one id would make a trust grant ambiguous; last wins, and
  // the shadowed one says so
  const seen = new Map();
  for (const a of list) {
    if (seen.has(a.id)) problems.push(`duplicate id “${a.id}” — the later one wins`);
    seen.set(a.id, a);
  }
  return { list: [...seen.values()], problems, config: Array.isArray(raw) ? {} : raw };
}

export const globalActionsPath = (app) => app.paths.data + '/actions.json';
export const projectActionsPath = (root) => root + '/.nib/actions.json';

// What Actions ▸ Edit… writes when there is no file yet. It is the whole
// documentation of the format, in the place you will be standing when you
// want it — an empty `{}` would only send you to a README.
export const STARTER_GLOBAL = `{
  // Nib actions — yours, on this machine, in every folder.
  // Buttons under the ⚡ in the toolbar; also in the Actions menu.
  //
  //   type    "cli" (default) — argv, spawned. "js" — a script, run inside
  //           Nib's backend with a small ctx of file helpers (see below).
  //           "ai" — a prompt, sent to the model you set in AI Settings.
  //   run     the argv ARRAY: ["pandoc", "{file}", "-o", "{stem}.pdf"].
  //           A plain string is taken as a shell line instead.
  //   prompt  (ai) what to ask. The document or the selection comes with it.
  //   system  (ai) optional instructions, ahead of the prompt.
  //   tools   (ai) "off" | "read" | "full" — overrides the setting, downward
  //           as often as up: a rewriting prompt wants "off".
  //   needs   "none" | "folder" | "file" | "selection"  — greys the button out
  //   match   "*.md", "docs/**", ["*.png", "*.jpg"]     — which files it's for
  //   icon    a glyph: "🔨". Shown in the menu, and it IS the toolbar button
  //   description  what it does, in a line — its tooltip everywhere
  //   toolbar true — pin a button beside the ⚡
  //   selection true — offer it on a selection in the editable preview
  //   (a keyboard shortcut isn't a field here: bind one in Settings ▸
  //   Shortcuts — the keys are yours, not the file's)
  //   ask     (cli and ai — a script asks for itself with ctx.prompt)
  //           questions to put in front of it. The answers become variables:
  //           "ask": ["Branch name"]  →  {branch_name}
  //           "ask": [{ "label": "Environment", "type": "choice",
  //                     "choices": ["staging", "live"] }]  →  {environment}
  //           types: text | multiline | number | choice | check | file | folder
  //   os      "macos" | "windows" | "linux" (or a list), and a per-OS block
  //           { "windows": { "run": [...] } } overrides run/cwd/env there.
  //           With no top-level "run" the blocks ARE the action — each
  //           platform its own command, only where one is defined
  //   cwd     where it runs — default is the pinned folder, else the folder,
  //           else the document's own directory
  //   stdin   "doc" | "selection" — piped in (for ai: what the model is shown,
  //           and "doc" is the default there)
  //   output  "panel" (default) | "replace" | "insert" | "doc" | "toast"
  //           | "alert" (a box with the answer in it) | "none"
  //
  // Variables: {file} {dir} {root} {rel} {name} {stem} {ext} {doc} {pin}
  //            {sel} {line} {col} {heading} {date} {time} {home}
  //            {dir1} {dir2}… (folder names counted up) {reldir}

  "actions": [
    {
      // "alert" rather than the drawer: the whole answer is one line and you
      // want to read it, not watch it arrive.
      "label": "Word count",
      "icon": "🔢",
      "description": "How many words are in this document.",
      "run": ["wc", "-w", "{file}"],
      "needs": "file",
      "output": "alert"
    },
    {
      "label": "Reveal in terminal",
      "run": "open -a Terminal .",
      "os": "macos"
    },
    {
      "label": "Title Case the Selection",
      "type": "js",
      "needs": "selection",
      "output": "insert",
      "script": "return ctx.sel.replace(/\\\\w\\\\S*/g, w => w[0].toUpperCase() + w.slice(1));"
    },
    {
      // Needs a model — Actions ▸ AI Settings…, and the Apple one is free and
      // offline if you are on macOS 26. "tools": "off" because tidying a
      // paragraph has no business reading your folder.
      "label": "Tidy the Selection",
      "type": "ai",
      "needs": "selection",
      "stdin": "selection",
      "output": "insert",
      "tools": "off",
      "prompt": "Fix the grammar, spelling and punctuation. Keep the wording, the tone and the Markdown as they are. Reply with the corrected text only."
    },
    {
      "label": "Summarise This Document",
      "type": "ai",
      "needs": "file",
      "tools": "off",
      "prompt": "Summarise this document as three or four bullet points."
    }
  ]
}
`;

export const STARTER_PROJECT = `{
  // This folder's actions. They TRAVEL with the folder — anyone who opens it
  // is asked to approve each one before it can run, and again if it changes.
  // Same format as your own actions file — and Actions ▸ Manage Actions…
  // edits either of them as a form, comments and all.

  "actions": [
    {
      "label": "Build",
      "run": ["npm", "run", "build"],
      "needs": "folder"
    }
  ]
}
`;

// The whole set, both scopes, with a hash per action so trust can be pinned to
// exactly what was approved. Global actions carry `trusted: true` — the file
// is inside the app's own data directory, which nothing but the person using
// the app can write; asking them to approve their own file would train them to
// click through the prompt that matters.
export async function loadActions(app, root, allowProject) {
  const g = await readActionsFile(globalActionsPath(app), 'global');
  const p = root && allowProject
    ? await readActionsFile(projectActionsPath(root), 'project')
    : { list: [], problems: [] };

  const out = [];
  for (const a of g.list) out.push({ ...a, trusted: true, hash: await hashAction(a) });
  for (const a of p.list) out.push({ ...a, root, hash: await hashAction(a) });
  return {
    list: out,
    problems: [...g.problems.map((s) => 'actions.json — ' + s),
      ...p.problems.map((s) => '.nib/actions.json — ' + s)],
  };
}

// What the trust grant is pinned to: everything that decides what the action
// DOES. Label and cosmetics are left out on purpose — renaming a button
// shouldn't ask you to approve it again; changing its command must.
export async function hashAction(a) {
  const material = JSON.stringify([a.type, a.run || null, a.shell, a.script || null,
    a.file || null, a.cwd, a.env, a.path, a.stdin, a.output,
    // an AI action's command IS its prompt — edit the prompt and the approval
    // has to come back, for exactly the reason editing a command does
    a.prompt || null, a.system || null, a.tools || null]);
  const d = await crypto.subtle.digest('SHA-256', enc.encode(material));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// -------------------------------------------------------------- the gating

// Whether this action can run right now, and if not, in one word why — the
// menu greys the row and puts the reason in its tooltip rather than hiding it,
// because a button that vanishes teaches nothing.
export function availability(a, ctx) {
  if (a.os && !a.os.includes(OS())) return 'not for ' + OS();
  if (a.needs === 'folder' && !ctx.root) return 'needs a folder';
  if ((a.needs === 'file' || a.match) && !ctx.file) return 'needs a saved file';
  if (a.needs === 'selection' && !ctx.sel) return 'needs a selection';
  if (a.match && ctx.file && !a.match.some((g) => globMatch(g, ctx.file, ctx.root))) {
    return 'not for this file';
  }
  return null;
}

// Enough glob for what a match line is ever asked to say: *.md, docs/**,
// **/*.png, README.md. Matched against the path relative to the folder when
// there is one, and against the bare name either way.
function globMatch(pattern, file, root) {
  const rel = root && file.startsWith(root + '/') ? file.slice(root.length + 1) : base(file);
  // one pass, so a `**` can't be re-read by a later replace: each token is
  // either a wildcard or a literal run that gets escaped
  const re = new RegExp('^' + pattern.replace(/\*\*\/|\*\*|\*|\?|[^*?]+/g, (tok) =>
    tok === '**/' ? '(?:.*/)?'
      : tok === '**' ? '.*'
        : tok === '*' ? '[^/]*'
          : tok === '?' ? '[^/]'
            : tok.replace(/[.+^${}()|[\]\\]/g, '\\$&')) + '$', 'i');
  return re.test(rel) || re.test(base(file));
}

// ------------------------------------------------------------- the variables
//
// The same vocabulary the image-naming templates use ({doc}, {pin}, {date}…)
// plus the ones only a command wants — because two dialects for "the file I
// am looking at" is one too many. Two deliberate differences: nothing is
// SLUGGED here (a path variable comes out as the path), and {dir} is the
// containing directory's full path rather than its name, because that is what
// a command means by a directory. The counted folder NAMES are {dir1},
// {dir2}… as before.

export function vars(ctx) {
  const file = ctx.file || '';
  const root = ctx.root || (file ? dirOf(file) : '');
  const dir = file ? dirOf(file) : root;
  const rel = file && root && file.startsWith(root + '/') ? file.slice(root.length + 1) : base(file);
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const v = {
    file, dir, root, rel,
    name: base(file), stem: stemOf(file), ext: extOf(file),
    doc: stemOf(file),                       // what the image templates call it
    rootname: root ? base(root) : '',
    pin: ctx.pin || root || dir,
    sel: ctx.sel || '',
    line: String((ctx.line || 0) + 1),
    col: String((ctx.col || 0) + 1),
    heading: ctx.heading || '',
    home: tjs.homeDir,
    date: `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`,
    time: `${two(now.getHours())}${two(now.getMinutes())}`,
  };
  // {dir1}, {dir2}… — folder names counted UP from the document, stopping at
  // the folder root, and {reldir} is the whole run of them
  const parts = root && dir.startsWith(root) ? dir.slice(root.length).split('/').filter(Boolean) : [];
  for (let i = 0; i < parts.length; i++) v['dir' + (i + 1)] = parts[parts.length - 1 - i];
  v.reldir = parts.join('/');

  // What the `ask` form came back with. Last, but it cannot overwrite anything
  // above it — normalizeAsk already refused those names, and this is the
  // second half of that promise.
  for (const [k, val] of Object.entries(ctx.inputs || {})) {
    if (v[k] === undefined) v[k] = String(val ?? '');
  }
  return v;
}

// {{ is a literal brace; an unknown variable expands to nothing, which is what
// the naming templates do and what a shell would do with $NOPE.
export function expand(s, v) {
  if (typeof s !== 'string') return s;
  return s.replace(/\{\{|\}\}|\{(\w+)\}/g, (m, k) =>
    m === '{{' ? '{' : m === '}}' ? '}' : (v[k] !== undefined ? v[k] : ''));
}

// ---------------------------------------------------------------- running

const runs = new Map();          // runId -> { proc, cancel, win }
let runSeq = 0;

const isAbs = (p) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
const join = (a, b) => (isAbs(b) ? b : (a.replace(/[\\/]$/, '') + '/' + b));

async function isExec(p) {
  try {
    const st = await tjs.stat(p);
    return !st.isDirectory && (OS() === 'windows' || (st.mode & 0o111) !== 0);
  } catch { return false; }
}

// Resolve the binary ourselves rather than letting spawn's ENOENT be the whole
// story: this is what lets a button say "pandoc — not found" before you press
// it, and what makes the PATH augmentation above visible to the child too.
export async function whichBin(cmd, extraPath) {
  if (!cmd) return null;
  if (cmd.includes('/') || cmd.includes('\\')) return (await isExec(cmd)) ? cmd : null;
  const dirs = [...(extraPath || []), ...(tjs.env.PATH || '').split(OS() === 'windows' ? ';' : ':'),
    ...EXTRA_PATH()].filter(Boolean);
  const exts = OS() === 'windows' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const seen = new Set();
  for (const d of dirs) {
    if (seen.has(d)) continue;
    seen.add(d);
    for (const e of exts) if (await isExec(join(d, cmd + e))) return join(d, cmd + e);
  }
  return null;
}

function childEnv(a, v) {
  const env = { ...tjs.env };
  const sep = OS() === 'windows' ? ';' : ':';
  const extra = [...(a.path || []).map((p) => expand(p, v)), ...EXTRA_PATH()];
  const have = new Set((env.PATH || '').split(sep));
  env.PATH = [...(env.PATH ? [env.PATH] : []), ...extra.filter((p) => !have.has(p))].join(sep);
  env.NIB_FILE = v.file; env.NIB_ROOT = v.root; env.NIB_DIR = v.dir;
  if (a.env) for (const [k, val] of Object.entries(a.env)) env[k] = expand(String(val), v);
  return env;
}

// One place decides where a command runs: what the action said, expanded, or
// the closest pinned folder above the document, or the folder, or — with no
// folder at all — the document's own directory. A loose file is still a place.
function cwdFor(a, v) {
  const want = a.cwd ? expand(a.cwd, v) : (v.pin || v.root || v.dir);
  return want && want !== '' ? want : (v.dir || tjs.homeDir);
}

// A run is a handle, not a promise the caller waits on: the api call returns
// the id at once and the output arrives as pushes, so a five-minute build and
// a 40ms formatter are the same shape and neither can time the bridge out.
export async function startRun(app, a, ctx, { onChunk, onDone, aiHost }) {
  const id = 'r' + (++runSeq);
  const v = vars(ctx);
  const cwd = cwdFor(a, v);
  const started = Date.now();
  let out = '';
  const CAP = 2 * 1024 * 1024;               // a runaway `yes` shouldn't eat the app
  const push = (stream, text) => {
    if (out.length < CAP) out += text;
    onChunk({ runId: id, stream, text });
  };

  const finish = (r) => {
    runs.delete(id);
    if (tmpIn) tjs.remove(tmpIn).catch(() => { /* it was a temp file */ });
    onDone({ runId: id, ms: Date.now() - started, output: out, ...r });
  };
  let tmpIn = null;                          // set below if this run has stdin

  if (a.type === 'js' || a.type === 'ai') {
    const cancel = { stopped: false };
    runs.set(id, { cancel, kill: () => { cancel.stopped = true; } });
    const work = a.type === 'js'
      ? runJs(app, a, ctx, v, cwd, push, cancel, aiHost)
      : runAi(app, a, ctx, v, cwd, push, cancel, aiHost);
    work
      .then((r) => finish({ ok: !r.error, code: r.error ? 1 : 0, error: r.error, text: r.text,
        usage: r.usage || null, note: r.note || null }))
      .catch((e) => finish({ ok: false, code: 1, error: e.message }));
    // the drawer's "$ …" line: for an AI action the prompt IS the command,
    // so its first line is what belongs there
    return { runId: id, cwd,
      command: a.type === 'ai' ? expand(a.prompt, v).split('\n')[0].slice(0, 120) : a.label };
  }

  // A per-platform action with no block for this one: the menus grey it out,
  // but Run It Now in the editor doesn't come through availability().
  if (!Array.isArray(a.run) || !a.run.length) {
    finish({ ok: false, code: 1, error: 'no command for ' + OS() });
    return { runId: id, command: a.label, cwd };
  }
  const argv = a.run.map((s) => expand(s, v));
  let spawnArgs = argv;
  if (a.shell) {
    spawnArgs = OS() === 'windows'
      ? ['cmd', '/c', argv.join(' ')]
      : ['/bin/sh', '-c', argv.join(' ')];
  }

  // stdin is a FILE, redirected by a shell, rather than the child's pipe —
  // because txiki's stdin pipe drops small writes on the floor: 320 KB
  // arrives, `abc def\n` never does, and neither the write nor the close
  // promise ever settles (measured on the runtime this ships with; upstream
  // PR #1028 is the fix, untagged as of writing). A temp file is also the
  // shape that survives a huge document without a partial-write dance.
  //
  //   sh -c 'exec "$@" < "$0"' <tmpfile> <cmd> <args…>
  //
  // keeps the argv exactly as it was — no quoting, no re-splitting — and
  // wraps a `shell: true` line just as happily, since that is already an argv.
  if (a.stdin !== 'none') {
    const text = a.stdin === 'selection' ? (ctx.sel || '') : (ctx.text || '');
    tmpIn = app.paths.data + '/run-' + id + '.stdin';
    try {
      await tjs.makeDir(app.paths.data, { recursive: true });
      await tjs.writeFile(tmpIn, enc.encode(text));
      spawnArgs = OS() === 'windows'
        ? ['cmd', '/c', spawnArgs.map((s) => '"' + s + '"').join(' ') + ' < "' + tmpIn + '"']
        : ['/bin/sh', '-c', 'exec "$@" < "$0"', tmpIn, ...spawnArgs];
    } catch (e) {
      finish({ ok: false, code: 1, error: 'couldn’t stage stdin: ' + e.message });
      return { runId: id, command: argv.join(' '), cwd };
    }
  }
  const env = childEnv(a, v);
  const bin = await whichBin(spawnArgs[0], (a.path || []).map((p) => expand(p, v)));
  if (!bin) {
    finish({ ok: false, code: 127, error: spawnArgs[0] + ': command not found' });
    return { runId: id, command: argv.join(' '), cwd };
  }

  let proc;
  try {
    proc = tjs.spawn([bin, ...spawnArgs.slice(1)], {
      cwd, env, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
    });
  } catch (e) {
    finish({ ok: false, code: 127, error: e.message });
    return { runId: id, command: argv.join(' '), cwd };
  }

  const timer = setTimeout(() => {
    const r = runs.get(id);
    if (r) { r.timedOut = true; try { proc.kill(); } catch { /* already gone */ } }
  }, a.timeout);
  runs.set(id, { proc, kill: () => { try { proc.kill(); } catch { /* gone */ } } });

  const pump = async (stream, tag) => {
    const rd = stream.getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) return;
      push(tag, dec.decode(value));
    }
  };
  Promise.all([pump(proc.stdout, 'out').catch(() => {}), pump(proc.stderr, 'err').catch(() => {})])
    .then(() => proc.wait())
    .then((st) => {
      clearTimeout(timer);
      const rec = runs.get(id) || {};
      const killed = !!st.term_signal;
      finish({
        ok: !killed && st.exit_status === 0,
        code: st.exit_status, signal: st.term_signal || null,
        error: rec.timedOut ? 'timed out after ' + Math.round(a.timeout / 1000) + 's'
          : killed ? 'stopped' : null,
      });
    })
    .catch((e) => { clearTimeout(timer); finish({ ok: false, code: 1, error: e.message }); });

  return { runId: id, command: argv.join(' '), cwd };
}

export function cancelRun(runId) {
  const r = runs.get(runId);
  if (!r) return false;
  r.kill();
  return true;
}

// ------------------------------------------------------------- js actions
//
// A js action runs in the backend's own realm — same QuickJS, same `tjs` — so
// it can read and write files, spawn things, and hand text back, with none of
// the ceremony a child process would need. The price is honest and worth
// saying out loud: an infinite loop in one of these freezes the app, because
// QuickJS can't preempt itself. The timeout below can end a script that is
// WAITING; it cannot end one that is spinning. That is exactly why project
// actions need approval before they get here.
async function runJs(app, a, ctx, v, cwd, push, cancel, host) {
  let src = a.script;
  if (!src && a.file) {
    const p = isAbs(a.file) ? a.file : join(v.root || cwd, a.file);
    src = dec.decode(await tjs.readFile(p));
  }
  return runJsBody(app, a, src, jsApi(app, a, ctx, v, cwd, push, host), push, cancel);
}

// The harness itself, lifted out of runJs because the AI's `run_js` tool hands
// a model the very same one — same helpers, same cwd, same PATH. Two ways in,
// one thing to reason about.
export function jsApi(app, a, ctx, v, cwd, push, host) {
  const resolve = (p) => (isAbs(p) ? p : join(cwd, p));
  // Time spent waiting on the person is nobody's timeout: a prompt left up
  // over lunch must not fail the action at the 120s mark. The tally is read
  // by runJsBody's guard, which extends its patience by exactly this much.
  const waited = { ms: 0, live: [] };
  const attended = async (work) => {
    const t0 = Date.now();
    waited.live.push(t0);           // counted while STILL waiting — the guard
    try { return await work; }      // must not fire in the middle of a prompt
    finally {
      waited.live.splice(waited.live.indexOf(t0), 1);
      waited.ms += Date.now() - t0;
    }
  };
  return {
    __waited: waited,
    ...v,                                   // file, dir, root, sel, stem, …
    vars: v,
    text: ctx.text || '',
    cwd,
    os: OS(),
    read: async (p) => dec.decode(await tjs.readFile(resolve(p))),
    write: async (p, s) => tjs.writeFile(resolve(p), enc.encode(String(s))),
    exists: async (p) => { try { await tjs.stat(resolve(p)); return true; } catch { return false; } },
    list: async (p) => {
      const out = [];
      for await (const e of await tjs.readDir(resolve(p || '.'))) out.push(e.name);
      return out;
    },
    mkdir: (p) => tjs.makeDir(resolve(p), { recursive: true }),
    remove: (p) => tjs.remove(resolve(p)),
    // named so they can't collide with the VARIABLES above — ctx.stem is the
    // open file's stem, ctx.stemname() is the function that made it
    join, resolve, basename: base, dirname: dirOf, stemname: stemOf, extname: extOf,
    // its own stream, not 'out': log means "show the person this", so the
    // drawer opens for it even when the output mode keeps the drawer shut —
    // a returned result stays 'out' and doesn't
    log: (...args) => push('log', args.map((x) =>
      typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'),
    // shelling out from a script, without re-implementing spawn each time
    run: async (argv, opts = {}) => {
      const cmd = typeof argv === 'string' ? ['/bin/sh', '-c', argv] : argv;
      const bin = await whichBin(cmd[0], []);
      if (!bin) throw new Error(cmd[0] + ': command not found');
      const p = tjs.spawn([bin, ...cmd.slice(1)],
        { cwd: opts.cwd ? resolve(opts.cwd) : cwd, env: childEnv(a, v), stdout: 'pipe', stderr: 'pipe' });
      const read = async (s) => {
        const rd = s.getReader(); let t = '';
        for (;;) { const { done, value } = await rd.read(); if (done) return t; t += dec.decode(value); }
      };
      const [o, e] = await Promise.all([read(p.stdout), read(p.stderr)]);
      const st = await p.wait();
      return { code: st.exit_status, out: o, err: e, ok: st.exit_status === 0 };
    },
    fetch: (...args) => fetch(...args),
    notify: (title, body) => app.notify({ title: title || 'Nib', body: body || '', sound: false }),
    // ---- talking to the person mid-run. The window's own sheets do the
    // drawing (main.js aiHostFor pushes, the page answers); the script parks
    // on the promise. No window, or no answer inside the backend's patience,
    // and these resolve like a cancel rather than hanging the run.
    prompt: async (label, opts = {}) => {
      if (!host || !host.promptUser) return null;
      const type = ['text', 'multiline', 'number'].includes(opts.type) ? opts.type : 'text';
      const r = await attended(host.promptUser({
        label: String(label ?? 'Value'), type,
        value: opts.default !== undefined ? String(opts.default) : '',
        placeholder: opts.placeholder !== undefined ? String(opts.placeholder) : '',
      }));
      if (r === null || r === undefined) return null;
      if (type === 'number') {
        const n = Number(r);
        return String(r).trim() !== '' && Number.isFinite(n) ? n : null;
      }
      return String(r);
    },
    confirm: async (question, opts = {}) => {
      if (!host || !host.confirmUser) return false;
      return (await attended(host.confirmUser({
        question: String(question ?? 'Continue?'),
        detail: opts.detail !== undefined ? String(opts.detail) : '',
        ok: opts.ok ? String(opts.ok) : '', cancel: opts.cancel ? String(opts.cancel) : '',
      }))) === true;
    },
    alert: async (body, title) => {
      if (!host || !host.alertUser) return;
      await attended(host.alertUser({
        title: title !== undefined ? String(title) : (a.label || 'Nib'),
        body: String(body ?? ''),
      }));
    },
    // …and the rest of what an `ask` form can ask, callable: one of a list,
    // a file, a folder. All null on cancel, like prompt.
    choose: async (label, choices, opts = {}) => {
      const list = [].concat(choices || []).map(String).filter(Boolean);
      if (!host || !host.promptUser || !list.length) return null;
      const r = await attended(host.promptUser({
        label: String(label ?? 'Pick one'), type: 'choice', choices: list,
        value: opts.default !== undefined ? String(opts.default) : '',
      }));
      return r === null || r === undefined ? null : String(r);
    },
    pickFile: async () => {
      if (!host || !host.pickUser) return null;
      const r = await attended(host.pickUser({ kind: 'file' }));
      return r ? String(r) : null;
    },
    pickFolder: async () => {
      if (!host || !host.pickUser) return null;
      const r = await attended(host.pickUser({ kind: 'folder' }));
      return r ? String(r) : null;
    },
  };
}

// The one wrapper both the runner and the save-time check compile: the
// script is this function's body, which is why top-level `return` and
// `await` mean what they look like.
const compileJs = (src) => new Function('ctx', 'tiny',
  '"use strict"; return (async () => {\n' + src + '\n})();');

// Does it parse? Compiled by the engine that will RUN it, never executed —
// so what Manage Actions vets at save time is exactly what pressing the
// button gets. The wrapper puts one line above the script; any line number
// the engine reports is shifted back up before a person sees it.
export function checkJsSyntax(src) {
  try {
    compileJs(src);
    return null;
  } catch (e) {
    const stack = /(?:<anonymous>|<input>|eval[^:\n]*):(\d+)/.exec(e.stack || '');
    const said = /\(line (\d+)\)|line (\d+)/i.exec(e.message || '');
    const raw = typeof e.lineNumber === 'number' ? e.lineNumber
      : stack ? +stack[1] : said ? +(said[1] || said[2]) : null;
    return { message: e.message || String(e), line: raw && raw > 1 ? raw - 1 : null };
  }
}

async function runJsBody(app, a, src, api, push, cancel) {
  const fn = compileJs(src);
  const work = (async () => {
    const r = await fn(api, api);
    if (r === undefined || r === null) return { text: null };
    if (typeof r === 'string') return { text: r };
    if (typeof r === 'object' && typeof r.text === 'string') return { text: r.text };
    return { text: JSON.stringify(r, null, 2) };
  })();

  // The clock stops while a prompt is up: the deadline slides by however
  // long the script spent waiting on the person (api.__waited, tallied by
  // jsApi), so the timeout stays a measure of the script, not the reader.
  const started = Date.now();
  let timer = null;
  const guard = new Promise((_, rej) => {
    const arm = () => {
      const now = Date.now();
      const w = api.__waited;
      const waitedMs = w ? w.ms + w.live.reduce((sum, t0) => sum + (now - t0), 0) : 0;
      const left = a.timeout + waitedMs - (now - started);
      if (left <= 0) return rej(new Error('timed out after ' + Math.round(a.timeout / 1000) + 's'));
      timer = setTimeout(arm, Math.min(left, 5000));
    };
    arm();
  });
  try {
    const r = await Promise.race([work, guard]);
    if (cancel.stopped) return { error: 'stopped' };
    if (r.text) push('out', r.text.endsWith('\n') ? r.text : r.text + '\n');
    return r;
  } catch (e) {
    push('err', String(e && e.stack ? e.stack : e) + '\n');
    return { error: e.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------- ai actions
//
// An AI action is a prompt where the argv goes. Everything around it is the
// machinery that was already here: the same variables ({sel}, {file}, {heading}
// …), the same `stdin` deciding what the model is shown, the same `output`
// deciding where its answer lands, the same drawer, the same Stop button, the
// same trust prompt for a folder's.
//
// Text streams into the drawer as it arrives, and the ANSWER is kept apart
// from it — tool chatter goes to the drawer only, so an action with
// `output: "insert"` puts the model's words at your caret and not a
// transcript of it reading four files first.
async function runAi(app, a, ctx, v, cwd, push, cancel, host = {}) {
  const cfg = await aiConfig(app);
  if (!cfg.enabled) {
    return { error: 'AI is off — turn it on in Actions ▸ AI Settings…' };
  }

  // Three opinions about what this may do — the general setting, the
  // provider's limit, and the action's own request — resolved by the rule that
  // none of them can widen the one before (ai.js: effectivePolicy).
  const pconf = await providerConfig(app, a.provider || cfg.provider);
  const policy = effectivePolicy({
    general: cfg,
    provider: pconf || {},
    action: { tools: a.tools, approve: a.approve },
  });
  if (policy.cappedTools) {
    push('meta', 'this action asked for “' + a.tools + '” tools; '
      + (pconf ? pconf.label : 'the provider') + ' is limited to “' + policy.tools + '”\n');
  }

  const tier = policy.tools;
  const api = jsApi(app, a, ctx, v, cwd, push, host);
  const tools = buildTools({
    root: v.root || null,
    file: v.file || null,
    text: ctx.text || '',
    cwd,
    log: (s) => push('meta', s),
    ask: host.ask || (async () => false),
    applyDoc: host.applyDoc || null,
    addAction: host.addAction || null,
    spawn: (command) => api.run(command),
    jsApi: () => api,
  }, { tier, approve: policy.approve });

  const prompt = framePrompt({
    prompt: expand(a.prompt, v),
    text: a.stdin === 'doc' ? (ctx.text || '') : '',
    sel: a.stdin === 'selection' ? (ctx.sel || '') : '',
    file: v.file || null,
    heading: v.heading || null,
  });
  const system = [GUARD, a.system ? expand(a.system, v) : ''].filter(Boolean).join('\n\n');

  let text = '';
  try {
    const r = await generate(app, {
      provider: a.provider || undefined,
      model: a.model || undefined,
      system,
      prompt,
      tools,
      temperature: a.temperature,
      cancel,
      onDelta: (d) => { text += d; push('out', d); },
      onEvent: (e) => {
        if (e.type === 'tool') {
          push('meta', '⟶ ' + e.name + ' '
            + JSON.stringify(e.args || {}).slice(0, 160) + '\n');
        } else if (e.type === 'tool-done' && !e.ok) {
          push('err', '  ' + e.result + '\n');
        }
      },
    });
    if (cancel.stopped) return { error: 'stopped' };
    // Apple's adapter doesn't stream, so its text arrives in one delta; either
    // way `r.text` is the whole of it and `text` is what the drawer saw.
    const answer = r.text || text;
    if (!text && answer) push('out', answer);
    const note = [r.providerLabel + (r.model ? ' · ' + r.model : ''),
      usageOf(r), r.capped ? 'stopped after ' + r.turns + ' turns' : ''].filter(Boolean).join(' · ');
    push('meta', '\n' + note + '\n');
    return { text: answer.replace(/\s+$/, ''), usage: r.usage || null, note };
  } catch (e) {
    if (cancel.stopped) return { error: 'stopped' };
    push('err', (e.message || String(e)) + '\n');
    return { error: e.message || String(e) };
  }
}

// Tokens, or the truth about a local one. No prices: a pricing table in an app
// that updates monthly is a wrong number waiting to happen.
function usageOf(r) {
  if (!r.usage || (!r.usage.input && !r.usage.output)) return '';
  return r.usage.input + ' in / ' + r.usage.output + ' out';
}

// Adding an action to YOUR file, for the model's create_action tool. The file
// is edited as TEXT, not reserialized: the starter file is mostly comments and
// a JSON.stringify round trip would throw all of them away. So the array's
// closing bracket is found by scanning (strings walked, not regexed past — the
// same reason parseJsonc does it) and the new entry is spliced in front of it.
export function appendActionText(text, action) {
  const body = JSON.stringify(action, null, 2)
    .split('\n').map((l, i) => (i ? '    ' + l : l)).join('\n');

  // no file yet, or one that isn't the shape we know: start from the starter
  if (!text || !text.trim()) {
    return '{\n  "actions": [\n    ' + body + '\n  ]\n}\n';
  }

  const at = findActionsArray(text);
  if (!at) return null;
  const inner = text.slice(at.open + 1, at.close);
  const sep = inner.trim() ? ',\n    ' : '\n    ';
  const head = inner.replace(/\s*$/, '');
  return text.slice(0, at.open + 1) + head + sep + body + '\n  ' + text.slice(at.close);
}

// The `[` and the matching `]` of the actions array, whichever shape the file
// is in — `{ "actions": [...] }` or a bare array at the root.
function findActionsArray(text) {
  let i = 0;
  const skipString = () => {
    for (i++; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === '"') return;
    }
  };
  let open = -1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      skipString();
      if (text.slice(start, i + 1) === '"actions"') {
        // the next `[` after the colon is ours
        for (i++; i < text.length; i++) {
          if (text[i] === '[') { open = i; break; }
          if (text[i] === '{') return null;      // "actions" wasn't an array
        }
        break;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    if (c === '[' && open < 0 && !text.slice(0, i).trim().replace(/^﻿/, '')) { open = i; break; }
  }
  if (open < 0) return null;

  let depth = 0;
  for (i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { skipString(); continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (!depth) return { open, close: i }; }
  }
  return null;
}

// What the approval prompt shows — the real thing, expanded, not the template.
// A prompt that says "runs a command" teaches nobody anything; this one says
// which command, in which folder, and admits when it is a script instead.
export function summarize(a, ctx) {
  const v = vars(ctx);
  if (a.type === 'ai') {
    // What approving this really means: your model, your key, this prompt —
    // and, if it asked for them, the tools. The tools line is the one people
    // need to see, so it is not buried in the prompt.
    const what = a.tools === 'full' ? 'and it may write files, run commands and add actions'
      : a.tools === 'off' ? 'text only — no tools'
        : 'and it may read files in this folder';
    return {
      kind: 'A prompt, sent to your AI provider (' + what + ')',
      body: expand(a.prompt, v),
      cwd: cwdFor(a, v),
    };
  }
  if (a.type === 'js') {
    const src = a.script || ('(from ' + a.file + ')');
    const head = src.split('\n').slice(0, 6).join('\n');
    return { kind: 'JavaScript, in Nib’s own backend', body: head + (src.split('\n').length > 6 ? '\n…' : ''),
      cwd: cwdFor(a, v) };
  }
  const argv = a.run.map((s) => expand(s, v));
  return {
    kind: a.shell ? 'Shell line' : 'Command',
    body: a.shell ? argv.join(' ') : argv.map((s) => (/\s/.test(s) ? JSON.stringify(s) : s)).join(' '),
    cwd: cwdFor(a, v),
  };
}
