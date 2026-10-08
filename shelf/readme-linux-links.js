#!/usr/bin/env node
// Bumps README.md's version-pinned Linux download links (link text, tag
// path, size) to the tarballs in a build output dir — out/<app>/*.tar.gz:
//
//   node shelf/readme-linux-links.js <out-x86_64 dir>
//
// Only touches URLs/text ending in -linux-*; mac/win segments keep their own
// versions. A non-matching app just warns — README drift is reviewable, a
// failed release is not. Idempotent, so the linux-release workflow can run
// it again on a fresher main when its push races another release.

const fs = require('fs');
const out = process.argv[2];
if (!out) { console.error('usage: readme-linux-links.js <out-x86_64 dir>'); process.exit(2); }
let s = fs.readFileSync('README.md', 'utf8');
for (const d of fs.readdirSync(out)) {
  const tb = fs.readdirSync(`${out}/${d}`).find((f) => f.endsWith('-linux-x86_64.tar.gz'));
  if (!tb) continue;
  const ver = tb.replace(/^.*-([0-9][0-9a-zA-Z.]*)-linux-x86_64\.tar\.gz$/, '$1');
  const mb = (fs.statSync(`${out}/${d}/${tb}`).size / 1048576).toFixed(1);
  const before = s;
  s = s.replace(new RegExp(`${d}-v[0-9][\\w.]*/${d}-[0-9][\\w.]*-linux-`, 'g'), `${d}-v${ver}/${d}-${ver}-linux-`);
  s = s.replace(new RegExp(`\\[${d}-[0-9][\\w.]*-linux`, 'g'), `[${d}-${ver}-linux`);
  s = s.replace(new RegExp(`(${d}-${ver}-linux-arm64\\.tar\\.gz\\)\\s*\\*\\*\\()[0-9.]+ MB`, 'g'), `$1${mb} MB`);
  console.log(s !== before ? `README: ${d} -> ${ver}`
    : s.includes(`${d}-v${ver}/`) ? `README: ${d} already at ${ver}`
      : `WARN: no README links matched for ${d}`);
}
fs.writeFileSync('README.md', s);
