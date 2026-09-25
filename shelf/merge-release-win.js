#!/usr/bin/env node
// Merges freshly published Windows builds into the committed manifests AND
// the catalog — the Windows twin of merge-manifest-linux.js +
// gen-catalog-linux.js, in one pass (Windows has one arch, so there is no
// second pass to wait for).
//
//   node shelf/merge-release-win.js [--notes-file notes.json]
//
// For each app with a `<app>/dist/publish/manifest.json` carrying a "win"
// block (what `tinyjs publish` writes on Windows) and its zip staged at
// `_builds/<dir>/<name>-<ver>-win.zip`:
//   - _builds/<dir>/manifest.json gets win = { version, url, sha256, notes },
//     url pointing at the <dir>-v<ver> release asset — upload FIRST. The top
//     level (mac) and the linux block are never touched.
//   - catalog.json + shelf/src/frontend/catalog.js get the entry's win block
//     { version, zip, url, bytes, size, sha256, folder, exe }.
// Notes: the --notes-file map ({ "<dir>": "…" }) wins; otherwise, when the
// mac release is at the same version, its notes are reused (same release,
// same words); otherwise the win block goes out without notes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const RELEASES = 'https://github.com/tarwin/tinyjsapp-examples/releases/download';
const argv = process.argv.slice(2);
const ni = argv.indexOf('--notes-file');
const notes = ni >= 0 ? JSON.parse(fs.readFileSync(argv[ni + 1], 'utf8')) : {};

const catalogPath = path.join(ROOT, 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const byDir = new Map(catalog.apps.map((a) => [a.dir, a]));

let touched = 0;
const warn = [];

for (const dir of fs.readdirSync(ROOT).sort()) {
  const fresh = path.join(ROOT, dir, 'dist', 'publish', 'manifest.json');
  if (!fs.existsSync(fresh)) continue;
  const f = JSON.parse(fs.readFileSync(fresh, 'utf8'));
  if (!f.win || !f.win.url) continue;
  const version = f.version;
  const zip = f.win.url.replace(/^.*\//, '');
  const zipPath = path.join(ROOT, '_builds', dir, zip);
  if (!fs.existsSync(zipPath)) { warn.push(`${dir}: ${zip} not staged in _builds/${dir}/ — skipped`); continue; }
  const buf = fs.readFileSync(zipPath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha256 !== f.win.sha256) { warn.push(`${dir}: staged ${zip} doesn't match its manifest sha — skipped`); continue; }
  const url = `${RELEASES}/${dir}-v${version}/${zip}`;

  const dest = path.join(ROOT, '_builds', dir, 'manifest.json');
  const d = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8')) : { version };
  const note = notes[dir] ?? (d.version === version ? d.notes : undefined);
  d.win = { version, url, sha256, ...(note ? { notes: note } : {}) };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(d, null, 2) + '\n');

  const entry = byDir.get(dir);
  if (entry) {
    const name = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'tinyjs.json'), 'utf8')).name;
    entry.win = {
      version, zip, url, bytes: buf.length,
      size: (buf.length / 1048576).toFixed(1) + ' MB',
      sha256, folder: name, exe: name + '.exe',
    };
    entry.platforms = [...new Set([...(entry.platforms || ['macos']), 'windows'])].sort();
  } else if (dir !== 'shelf') {
    warn.push(`${dir}: not in catalog.json — manifest merged, catalog untouched`);
  }
  touched++;
  console.log(`${dir}: win ${version} (${(buf.length / 1048576).toFixed(1)} MB)${note ? '' : ' — no notes'}`);
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
fs.writeFileSync(
  path.join(ROOT, 'shelf/src/frontend/catalog.js'),
  '// bundled fallback — regenerate with scripts in repo (gen-catalog)\n' +
    'window.CATALOG = ' + JSON.stringify(catalog, null, 2) + ';\n'
);
console.log(touched ? `\n${touched} app${touched === 1 ? '' : 's'} merged` : 'nothing to merge — run tinyjs publish on Windows first');
if (warn.length) { console.log('warnings:\n  ' + warn.join('\n  ')); process.exitCode = 1; }
