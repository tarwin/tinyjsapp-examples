// build-vizlibs.mjs — rebuild the sketch libraries amp injects into a plugin
// worker, from pinned npm versions.
//
//   node tools/build-vizlibs.mjs            # rebuild all of them
//   node tools/build-vizlibs.mjs three      # just one
//
// Output goes to src/vizlib/. Each library is its OWN file, exactly as npm
// built it, and amp's fake DOM (domshim.js) is a second file listed beside it
// in index.json, in the order that library needs. vizhost.js pastes those
// files in front of a plugin that asked for the library, and that is the whole
// mechanism; nothing is fetched at runtime and the worker's CSP is untouched.
//
// Keeping the library in a file of its own is not tidiness. p5 is LGPL-2.1 and
// q5 is LGPL-3.0, both of which want the user to be able to swap the library
// for a build of their own — and here they can, by replacing one plain text
// file inside the app. Never inline these into something else.
//
// BUMPING A VERSION: change PINS below, run this, check the lab's three library
// starters still run, and note the new version in src/docs/20-visualizers.md
// and README.md's credits. Keep bumps to non-breaking releases — a plugin
// somebody wrote against three r185 has no way to ask for r185 later, so a
// major bump silently rewrites what their code means. That is a release-note
// change, not a routine one.
//
// Needs network and npx (esbuild). Everything it downloads lands in a temp
// dir that is removed afterwards.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'src', 'vizlib');
const SHIM_SRC = path.join(HERE, 'vizlib', 'domshim.js');
const ESBUILD = 'esbuild@0.23.1';

// ── what amp ships ─────────────────────────────────────────────────────────
// `shim` says where the fake DOM goes relative to the library, and that
// ordering is measured, not chosen:
//   • p5 must load with NO document in sight. Give it one first and its own
//     boot path wedges the worker thread before a sketch is ever constructed.
//   • q5 wants the document already there — it decides at load time whether it
//     is in a browser, and picks a canvas implementation off the back of it.
const PINS = [
  {
    id: 'three',
    name: 'three.js',
    npm: 'three@0.185.1',
    home: 'https://threejs.org/',
    license: 'MIT',
    global: 'THREE',
    shim: 'none',
    note: '3D, via the WEBGPU build. WebGPURenderer runs on WebGPU where there '
        + 'is one (macOS, Windows) and falls back to WebGL2 where there is not '
        + '(Linux/WebKitGTK), off ONE code path — so a plugin does not write two '
        + 'renderers. Node materials and TSL come with it, as THREE.TSL, plus the '
        + 'display passes below — including SSGI, which is what a plugin needs for '
        + 'real bounce light. Needs no DOM shim: hand the renderer the canvas '
        + 'amp gives you.',
    // three is ESM-only since r150, so it is bundled to a classic script here.
    // NOTE this is `three/webgpu`, NOT `three` — a superset of the scene graph
    // that swaps WebGLRenderer for WebGPURenderer. There is no WebGLRenderer in
    // here; that is the point, since the one renderer covers both backends.
    entry: () => [
      "export * from 'three/webgpu';",
      "export * as TSL from 'three/tsl';",
      "export { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';",
      "export { ssr } from 'three/examples/jsm/tsl/display/SSRNode.js';",
      "export { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';",
      "export { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';",
      "export { traa } from 'three/examples/jsm/tsl/display/TRAANode.js';",
      "export { ssgi } from 'three/examples/jsm/tsl/display/SSGINode.js';",
      "export { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';",
      "export { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js';",
    ].join('\n'),
    globalName: 'THREE',
    expose: `self.THREE = THREE;`,
  },
  {
    id: 'p5',
    name: 'p5.js',
    npm: 'p5@2.3.2',
    home: 'https://p5js.org/',
    license: 'LGPL-2.1',
    global: 'p5',
    shim: 'after',
    note: 'p5 2.x built WITHOUT dom/io/events/accessibility — the modules that '
        + 'assume a page. Drawing, colour, maths, images, text and WEBGL only.',
    entry: () => [
      "import p5 from 'p5/core';",
      "import shape from 'p5/shape';",
      "import color from 'p5/color';",
      "import math from 'p5/math';",
      "import image from 'p5/image';",
      "import utilities from 'p5/utilities';",
      "import type from 'p5/type';",
      "import webgl from 'p5/webgl';",
      'shape(p5); color(p5); math(p5); image(p5); utilities(p5); type(p5); webgl(p5);',
      'export default p5;',
    ].join('\n'),
    globalName: '__p5lib',
    expose: `self.p5 = __p5lib.default || __p5lib;`,
  },
  {
    id: 'q5',
    name: 'q5.js',
    npm: 'q5@4.8.0',
    home: 'https://q5js.org/',
    license: 'LGPL-3.0-only',
    global: 'Q5',
    shim: 'before',
    note: 'A small p5-compatible sketch library. Ships whole — it is already a '
        + 'classic script and only ~230 KB.',
    verbatim: 'q5.js',            // no bundling needed
    expose: `self.q5 = self.Q5;`,
  },
];

const want = process.argv.slice(2);
const jobs = want.length ? PINS.filter((p) => want.includes(p.id)) : PINS;
if (!jobs.length) { console.error('nothing matched: ' + want.join(' ')); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-vizlib-'));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd: cwd || tmp, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

function header(job, version) {
  return [
    `// ${job.name} ${version} — ${job.license}, from ${job.home}`,
    '//',
    `// ${job.note.replace(/\n/g, '\n// ')}`,
    '//',
    '// Vendored for amp, NOT hand-edited: rebuilt by tools/build-vizlibs.mjs',
    '// from ' + job.npm + ', which is the source this corresponds to. amp pastes',
    '// it in front of any plugin whose source says',
    `//     // amp:uses ${job.id}`,
    `// and the library is then \`${job.global}\` inside that plugin's worker.`,
    '//',
    '// Replaceable: put your own build of the library here and amp will use it.',
    '',
  ].join('\n');
}

const index = [];
for (const job of jobs) {
  process.stdout.write(job.id + ': installing ' + job.npm + '… ');
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', job.npm]);
  const pkgJson = JSON.parse(fs.readFileSync(
    path.join(tmp, 'node_modules', job.id, 'package.json'), 'utf8'));
  const version = pkgJson.version;

  let body;
  if (job.verbatim) {
    body = fs.readFileSync(path.join(tmp, 'node_modules', job.id, job.verbatim), 'utf8');
  } else {
    fs.writeFileSync(path.join(tmp, 'entry.js'), job.entry());
    run('npx', ['--yes', ESBUILD, 'entry.js', '--bundle', '--format=iife',
      '--global-name=' + job.globalName, '--minify', '--outfile=out.js', '--log-level=warning']);
    body = fs.readFileSync(path.join(tmp, 'out.js'), 'utf8');
  }

  // a stray </script would end the <script> tag of any page that inlined this
  if (body.includes('</script')) throw new Error(job.id + ' contains </script');

  const out = header(job, version) + body.trimEnd()
    + (job.expose ? '\n\n// amp: name it the way a plugin expects to find it\n' + job.expose : '') + '\n';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, job.id + '.js'), out);

  // the fake DOM is amp's code and stays amp's file — one copy, shared
  const files = job.shim === 'before' ? ['domshim.js', job.id + '.js']
    : job.shim === 'after' ? [job.id + '.js', 'domshim.js']
    : [job.id + '.js'];
  if (job.shim !== 'none') fs.copyFileSync(SHIM_SRC, path.join(OUT_DIR, 'domshim.js'));

  index.push({ id: job.id, name: job.name, version, global: job.global,
    license: job.license, home: job.home, files, bytes: out.length, note: job.note });
  console.log('→ src/vizlib/' + files.join(' + ') + '  (' + (out.length / 1024).toFixed(0) + ' KB, v' + version + ')');
}

// index.json is what the app reads to tell a plugin author which versions this
// build of amp actually carries, so the docs cannot drift from the binary.
const idxPath = path.join(OUT_DIR, 'index.json');
let all = [];
try { all = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch (e) {}
for (const e of index) {
  const i = all.findIndex((x) => x.id === e.id);
  if (i >= 0) all[i] = e; else all.push(e);
}
all.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(idxPath, JSON.stringify(all, null, 2) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('src/vizlib/index.json updated (' + all.map((a) => a.id + ' ' + a.version).join(', ') + ')');
