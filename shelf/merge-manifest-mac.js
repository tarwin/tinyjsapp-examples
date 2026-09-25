#!/usr/bin/env node
// Merges staged per-CPU macOS builds into the committed
// _builds/<dir>/manifest.json — WITHOUT touching the win/linux blocks.
//
//   node shelf/merge-manifest-mac.js [--notes-file notes.json] <dir> [<dir> …]
//
// For each dir, at its tinyjs.json version, it looks for the zips
// release-mac.sh stages (_builds/<dir>/<dir>-<ver>-macos-<arch>.zip) and
// writes mac.<arch> = { version, url, sha256 }, url pointing at the
// <dir>-v<ver> release asset — upload the zips there FIRST.
//
// The top level stays the Apple Silicon build: every app shipped before
// tinyjs 0.42 reads only those fields, and all of them run on arm64. So a
// freshly staged arm64 zip also becomes the top-level url/sha256/version
// (+ notes from --notes-file, a { "<dir>": "notes" } map). When only an
// Intel build was added (the arm64 one already shipped at this version,
// under the old unsuffixed name), the existing top level is mirrored into
// mac.arm64 so both CPUs sit in the block.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const RELEASES = 'https://github.com/tarwin/tinyjsapp-examples/releases/download';
const argv = process.argv.slice(2);
let notes = {};
const ni = argv.indexOf('--notes-file');
if (ni >= 0) {
  notes = JSON.parse(fs.readFileSync(argv[ni + 1], 'utf8'));
  argv.splice(ni, 2);
}
if (!argv.length) {
  console.log('usage: merge-manifest-mac.js [--notes-file notes.json] <dir> [<dir> …]');
  process.exit(2);
}

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

for (const dir of argv) {
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'tinyjs.json'), 'utf8')).version;
  const dest = path.join(ROOT, '_builds', dir, 'manifest.json');
  const d = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8')) : {};
  d.mac = d.mac || {};
  const got = [];
  for (const arch of ['arm64', 'x86_64']) {
    const file = `${dir}-${ver}-macos-${arch}.zip`;
    const zip = path.join(ROOT, '_builds', dir, file);
    if (!fs.existsSync(zip)) continue;
    d.mac[arch] = { version: ver, url: `${RELEASES}/${dir}-v${ver}/${file}`, sha256: sha256(zip) };
    got.push(arch);
  }
  if (!got.length) { console.log(`${dir}: no macos zips staged for ${ver} — skipped`); continue; }
  if (got.includes('arm64')) {
    d.version = ver;
    d.url = d.mac.arm64.url;
    d.sha256 = d.mac.arm64.sha256;
    if (notes[dir]) d.notes = notes[dir];
  } else if (d.version === ver && d.url && d.sha256) {
    d.mac.arm64 = { version: ver, url: d.url, sha256: d.sha256 };
  } else {
    console.log(`${dir}: WARNING — x86_64 ${ver} staged but the top level is ${d.version}; ` +
                'Apple Silicon users will not see this version');
  }
  // Key order: top level first, then mac, then the other platforms.
  const { version, url, sha256: sha, notes: n, mac, ...rest } = d;
  const out = { version, url, sha256: sha, ...(n ? { notes: n } : {}), mac, ...rest };
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  console.log(`${dir}: mac { ${Object.keys(mac).join(', ')} } at ${ver}` +
              (got.includes('arm64') ? '' : ' (arm64 = existing top level)'));
}
