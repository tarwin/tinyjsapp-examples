#!/usr/bin/env node
// Merges Linux download blocks into catalog.json + shelf/src/frontend/catalog.js
// from the tarballs staged in _builds/<dir>/.
//
// Companion to gen-catalog.js, not a replacement: that one rebuilds the whole
// catalog from the macOS dmgs, this one only ADDS to what's already there, so
// the mac and win blocks survive. Run it on each architecture you ship — Linux
// builds are per-arch, so an entry carries one download per arch and a machine
// only ever sees the entries built for it:
//
//   "linux": {
//     "version": "0.3.3", "folder": "worldclock", "bin": "worldclock",
//     "arm64":  { "tarball": "…", "url": "…", "bytes": 1, "size": "5.0 MB", "sha256": "…" },
//     "x86_64": { … }
//   }
//
// Usage, from a checkout on the arch you're publishing for:
//   for d in */; do (cd "$d" && tinyjs publish); done
//   cp <each>/dist/publish/*-linux-*.tar.gz _builds/<dir>/
//   node shelf/gen-catalog-linux.js
// then commit the tarballs alongside the catalog — the urls point at them in
// this repo, so catalog and payload land in the same push.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const RAW = 'https://raw.githubusercontent.com/tarwin/tinyjsapp-examples/main';

const catalogPath = path.join(ROOT, 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const byDir = new Map(catalog.apps.map((a) => [a.dir, a]));

let touched = 0;
const skipped = [];

for (const dir of fs.readdirSync(ROOT).sort()) {
  const tj = path.join(ROOT, dir, 'tinyjs.json');
  if (!fs.existsSync(tj)) continue;
  if (dir === 'shelf') continue;              // the store doesn't stock itself
  const entry = byDir.get(dir);
  if (!entry) { skipped.push(`${dir} (not in catalog.json)`); continue; }

  const j = JSON.parse(fs.readFileSync(tj, 'utf8'));
  const name = j.name;
  const buildDir = path.join(ROOT, '_builds', dir);
  if (!fs.existsSync(buildDir)) { skipped.push(`${dir} (no _builds/${dir})`); continue; }

  // <name>-<version>-linux-<arch>.tar.gz, one per arch — take the newest
  // version present for each so a stale tarball can sit alongside.
  const found = new Map();
  for (const f of fs.readdirSync(buildDir)) {
    const m = new RegExp(`^${name}-(\\d[\\w.]*)-linux-(arm64|x86_64)\\.tar\\.gz$`).exec(f);
    if (!m) continue;
    const [, version, arch] = m;
    const prev = found.get(arch);
    if (!prev || vcmp(version, prev.version) > 0) found.set(arch, { file: f, version });
  }
  if (!found.size) { skipped.push(`${dir} (no linux tarball in _builds/${dir})`); continue; }

  // one shared version per entry: publishing different versions per arch would
  // make "is there an update?" arch-dependent, so refuse rather than guess
  const versions = [...new Set([...found.values()].map((v) => v.version))];
  if (versions.length > 1) {
    skipped.push(`${dir} (arch versions disagree: ${versions.join(' vs ')} — republish)`);
    continue;
  }

  const block = { version: versions[0], folder: dir, bin: name };
  for (const [arch, { file }] of [...found].sort()) {
    const buf = fs.readFileSync(path.join(buildDir, file));
    block[arch] = {
      tarball: file,
      url: `${RAW}/_builds/${dir}/${file}`,
      bytes: buf.length,
      size: (buf.length / 1048576).toFixed(1) + ' MB',
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    };
  }
  entry.linux = block;
  entry.platforms = [...new Set([...(entry.platforms || ['macos']), 'linux'])].sort();
  touched++;
  console.log(`  ${dir} ${block.version} — ${[...found.keys()].sort().join(', ')}`);
}

function vcmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
fs.writeFileSync(
  path.join(ROOT, 'shelf/src/frontend/catalog.js'),
  '// bundled fallback — regenerate with scripts in repo (gen-catalog)\n' +
    'window.CATALOG = ' + JSON.stringify(catalog, null, 2) + ';\n'
);

console.log(`\nlinux blocks: ${touched} app${touched === 1 ? '' : 's'}`);
if (skipped.length) console.log('skipped:\n  ' + skipped.join('\n  '));
const arches = new Set();
for (const a of catalog.apps) for (const k of Object.keys(a.linux || {}))
  if (k === 'arm64' || k === 'x86_64') arches.add(k);
console.log(`arches present: ${[...arches].sort().join(', ') || 'none'}`);
if (arches.size === 1)
  console.log(`NOTE: only ${[...arches][0]} — shelf on the other arch will list nothing.`);
