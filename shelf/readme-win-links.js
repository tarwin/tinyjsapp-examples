#!/usr/bin/env node
// Bumps README.md's version-pinned Windows download links (link text, tag
// path, size) to the zips in a build output dir — out/<app>/*-win.zip:
//
//   node shelf/readme-win-links.js <out dir>
//
// Only touches *-win.zip links; a non-matching app just warns. Idempotent,
// so the windows-release workflow can run it again on a fresher main when
// its push races another release.

const fs = require('fs');
const out = process.argv[2];
if (!out) { console.error('usage: readme-win-links.js <out dir>'); process.exit(2); }
let s = fs.readFileSync('README.md', 'utf8');
for (const d of fs.readdirSync(out)) {
  const zip = fs.readdirSync(`${out}/${d}`).find((f) => f.endsWith('-win.zip'));
  if (!zip) continue;
  const name = zip.replace(/-[0-9][\w.]*-win\.zip$/, '');
  const ver = zip.replace(/^.*-([0-9][\w.]*)-win\.zip$/, '$1');
  const mb = (fs.statSync(`${out}/${d}/${zip}`).size / 1048576).toFixed(1);
  const before = s;
  s = s.replace(new RegExp(`${d}-v[0-9][\\w.]*/${name}-[0-9][\\w.]*-win\\.zip`, 'g'), `${d}-v${ver}/${zip}`);
  s = s.replace(new RegExp(`\\[${name}-[0-9][\\w.]*-win\\.zip\\]`, 'g'), `[${zip}]`);
  s = s.replace(new RegExp(`(${zip.replace(/\./g, '\\.')}\\)\\s*\\*\\*\\()[0-9.]+ MB`, 'g'), `$1${mb} MB`);
  console.log(s !== before ? `README: ${d} -> ${ver}`
    : s.includes(`${d}-v${ver}/`) ? `README: ${d} already at ${ver}`
      : `WARN: no README links matched for ${d}`);
}
fs.writeFileSync('README.md', s);
