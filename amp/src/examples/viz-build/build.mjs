// build.mjs — turn a project into an amp visualizer plugin.
//
//   npm install && npm run build      # once
//   npm run watch                     # rebuild on save
//
// Each folder under src/ becomes dist/<name>/index.js — ONE classic script,
// which is the only shape amp's sandbox can run: a plugin is minted as a
// worker from a blob, so there is no module loader, no importScripts and no
// network at the far end. Whatever structure you want lives here instead.
//
// Two things this does that a default esbuild config would not:
//
//   format: 'iife'   a plugin is a classic script, never a module
//   banner           the `// amp:uses` line has to survive into the OUTPUT,
//                    because amp reads it off the built file before it mints
//                    the worker. Put it in the source and a minifier will
//                    happily throw it away.
//
// And one thing it deliberately does NOT do: bundle three.js. amp injects its
// own copy as a global when it sees `// amp:uses three`, so three is a
// devDependency here — present for @types/three and your editor, absent from
// the output. That is why dist/spheres3d/index.js is a few KB rather than 1.1 MB.

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(HERE, 'src');
const DIST = path.join(HERE, 'dist');

const watch = process.argv.includes('--watch');

const targets = fs.readdirSync(SRC).filter((d) =>
  fs.statSync(path.join(SRC, d)).isDirectory()
  && fs.existsSync(path.join(SRC, d, 'index.js')));

if (!targets.length) {
  console.error('nothing in src/ with an index.js');
  process.exit(1);
}

for (const name of targets) {
  const entry = path.join(SRC, name, 'index.js');
  const outfile = path.join(DIST, name, 'index.js');

  // the `// amp:uses …` line, lifted off the entry file's head so it can be
  // re-emitted as a banner. amp only scans the first 4 KB of a plugin, and a
  // bundler puts its own preamble first, so this must lead the output.
  const head = fs.readFileSync(entry, 'utf8').slice(0, 4096);
  const uses = /^[ \t]*\/\/[ \t]*amp:uses[ \t].*$/mi.exec(head);

  const options = {
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',              // a plugin is a classic script
    target: 'es2022',            // the worker is modern; no need to go lower
    platform: 'browser',
    legalComments: 'inline',
    banner: { js: (uses ? uses[0] + '\n' : '') + '// built by examples/viz-build — edit src/' + name + '/, not this file\n' },
    logLevel: 'info',
  };

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('watching ' + name);
  } else {
    await esbuild.build(options);
    const bytes = fs.statSync(outfile).size;
    console.log(name + ' → dist/' + name + '/index.js  (' + (bytes / 1024).toFixed(1) + ' KB)'
      + (uses ? '  ' + uses[0].trim() : ''));
    // a viz.json beside it, so the folder is installable as it stands
    const manifest = path.join(SRC, name, 'viz.json');
    if (fs.existsSync(manifest)) fs.copyFileSync(manifest, path.join(DIST, name, 'viz.json'));
  }
}

if (!watch) {
  console.log('\nInstall one: copy dist/<name>/ into amp\'s visualizer folder');
  console.log('(viz picker → ☰ → Add a visualizer…), or open its index.js in the Viz Lab.');
}
