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
// Today: 'cli' (argv, spawned) and 'js' (a script, run in the backend's own
// QuickJS realm with a small `ctx` of file helpers). Tomorrow the type is
// where an HTTP call or a shipped-script kind lands, without any of the rest
// of this file — the loading, the gating, the variables, the trust — moving.
//
// The one thing that is deliberately NOT a string is the command. `run` is an
// argv array, so a path with a space in it is one argument and not a quoting
// bug; `"shell": true` is there for the day you really do want a pipeline.

const dec = new TextDecoder();
const enc = new TextEncoder();

export const ACTION_TYPES = new Set(['cli', 'js']);
const NEEDS = new Set(['none', 'folder', 'file', 'selection']);
const OUTPUTS = new Set(['panel', 'replace', 'insert', 'doc', 'notify', 'none']);
const STDINS = new Set(['none', 'doc', 'selection']);

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
  };

  if (type === 'cli') {
    // A bare string is taken as a shell line rather than refused: it's what
    // everyone types first, and refusing it would only teach the lesson twice.
    let run = raw.run !== undefined ? raw.run : raw.command;
    if (typeof run === 'string') { a.run = [run]; a.shell = true; }
    else if (Array.isArray(run) && run.length && run.every((x) => typeof x === 'string')) a.run = run;
    else return bad('“run” must be an argv array (or a string, for a shell line)');
    // per-OS override, so one file can serve three machines
    const over = raw[OS()];
    if (over && typeof over === 'object') {
      if (typeof over.run === 'string') { a.run = [over.run]; a.shell = true; }
      else if (Array.isArray(over.run)) a.run = over.run.map(String);
      if (over.cwd) a.cwd = String(over.cwd);
      if (over.env) a.env = { ...(a.env || {}), ...over.env };
    }
  } else if (type === 'js') {
    if (typeof raw.script === 'string' && raw.script.trim()) a.script = raw.script;
    else if (typeof raw.file === 'string' && raw.file.trim()) a.file = raw.file;
    else return bad('a js action needs “script” or “file”');
  }
  return a;
}

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
  //   run     the argv ARRAY: ["pandoc", "{file}", "-o", "{stem}.pdf"].
  //           A plain string is taken as a shell line instead.
  //   needs   "none" | "folder" | "file" | "selection"  — greys the button out
  //   match   "*.md", "docs/**", ["*.png", "*.jpg"]     — which files it's for
  //   os      "macos" | "windows" | "linux" (or a list), and a per-OS block
  //           { "windows": { "run": [...] } } overrides run/cwd/env there
  //   cwd     where it runs — default is the pinned folder, else the folder,
  //           else the document's own directory
  //   stdin   "doc" | "selection" — piped in
  //   output  "panel" (default) | "replace" | "insert" | "doc" | "notify" | "none"
  //
  // Variables: {file} {dir} {root} {rel} {name} {stem} {ext} {doc} {pin}
  //            {sel} {line} {col} {heading} {date} {time} {home}
  //            {dir1} {dir2}… (folder names counted up) {reldir}

  "actions": [
    {
      "label": "Word count",
      "run": ["wc", "-w", "{file}"],
      "needs": "file"
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
    a.file || null, a.cwd, a.env, a.path, a.stdin, a.output]);
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
export async function startRun(app, a, ctx, { onChunk, onDone }) {
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

  if (a.type === 'js') {
    const cancel = { stopped: false };
    runs.set(id, { cancel, kill: () => { cancel.stopped = true; } });
    runJs(app, a, ctx, v, cwd, push, cancel)
      .then((r) => finish({ ok: !r.error, code: r.error ? 1 : 0, error: r.error, text: r.text }))
      .catch((e) => finish({ ok: false, code: 1, error: e.message }));
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
async function runJs(app, a, ctx, v, cwd, push, cancel) {
  let src = a.script;
  if (!src && a.file) {
    const p = isAbs(a.file) ? a.file : join(v.root || cwd, a.file);
    src = dec.decode(await tjs.readFile(p));
  }
  const resolve = (p) => (isAbs(p) ? p : join(cwd, p));
  const api = {
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
    log: (...args) => push('out', args.map((x) =>
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
  };

  const fn = new Function('ctx', 'tiny', '"use strict"; return (async () => {\n' + src + '\n})();');
  const work = (async () => {
    const r = await fn(api, api);
    if (r === undefined || r === null) return { text: null };
    if (typeof r === 'string') return { text: r };
    if (typeof r === 'object' && typeof r.text === 'string') return { text: r.text };
    return { text: JSON.stringify(r, null, 2) };
  })();

  const guard = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('timed out after ' + Math.round(a.timeout / 1000) + 's')),
      a.timeout));
  try {
    const r = await Promise.race([work, guard]);
    if (cancel.stopped) return { error: 'stopped' };
    if (r.text) push('out', r.text.endsWith('\n') ? r.text : r.text + '\n');
    return r;
  } catch (e) {
    push('err', String(e && e.stack ? e.stack : e) + '\n');
    return { error: e.message || String(e) };
  }
}

// What the approval prompt shows — the real thing, expanded, not the template.
// A prompt that says "runs a command" teaches nobody anything; this one says
// which command, in which folder, and admits when it is a script instead.
export function summarize(a, ctx) {
  const v = vars(ctx);
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
