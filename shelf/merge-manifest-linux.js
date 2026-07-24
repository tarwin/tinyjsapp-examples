#!/usr/bin/env node
// Merges each app's freshly-published Linux manifest block into the committed
// _builds/<dir>/manifest.json — WITHOUT clobbering the mac/win entries.
//
// Why merging matters: `tinyjs publish` emits a manifest with only
// { version, linux: { <arch>: { url, sha256 } } }. Copying that over the
// committed manifest would delete the mac top-level fields and the win block —
// and bumping the TOP-LEVEL version while the mac url still points at an older
// zip would tell every mac user to "update" onto the wrong artifact. So: the
// top level stays mac's, win stays win's, and each linux arch block carries
// its OWN version (the updater reads linux.<arch>.version — verified).
//
// Usage, after `tinyjs publish` in each app and copying tarballs to _builds:
//   node shelf/merge-manifest-linux.js
// Safe to run per-arch: an x86_64 pass adds linux.x86_64 beside linux.arm64.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let touched = 0;

for (const dir of fs.readdirSync(ROOT).sort()) {
  const fresh = path.join(ROOT, dir, 'dist', 'publish', 'manifest.json');
  const dest = path.join(ROOT, '_builds', dir, 'manifest.json');
  if (!fs.existsSync(fresh)) continue;
  const f = JSON.parse(fs.readFileSync(fresh, 'utf8'));
  if (!f.linux) continue;
  const d = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8'))
                                : { version: f.version };
  d.linux = d.linux || {};
  for (const [arch, block] of Object.entries(f.linux)) {
    if (typeof block !== 'object' || !block.url) continue;   // skip e.g. linux.notes
    d.linux[arch] = { ...block, version: f.version };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(d, null, 2) + '\n');
  const arches = Object.keys(d.linux).filter((k) => d.linux[k] && d.linux[k].url);
  console.log(`${dir}: linux { ${arches.join(', ')} } merged (mac ${d.version}, win ${d.win ? d.win.version || 'yes' : '—'})`);
  touched++;
}
console.log(touched ? `\n${touched} manifests merged` : 'nothing to merge — run tinyjs publish first');
