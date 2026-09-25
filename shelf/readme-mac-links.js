#!/usr/bin/env node
// Rewrites the macOS part of every "⬇ Download" line (root README.md and
// each <dir>/README.md) to the per-CPU dmgs in catalog.json's "mac" blocks:
//   macOS [Apple Silicon](…-macos-arm64.dmg) / [Intel](…-macos-x86_64.dmg)
// Run after gen-catalog.js. Shelf isn't in the catalog, so its dmgs are read
// from _builds at shelf/tinyjs.json's version. Lines for apps without an
// Intel build are left alone.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RELEASES = 'https://github.com/tarwin/tinyjsapp-examples/releases/download';
const mac = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'))
  .apps.filter((a) => a.mac && a.mac.x86_64).map((a) => [a.dir, a.mac]));
{
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'shelf/tinyjs.json'), 'utf8')).version;
  const m = {};
  for (const arch of ['arm64', 'x86_64']) {
    const dmg = `shelf-${v}-macos-${arch}.dmg`;
    const f = path.join(ROOT, '_builds', dmg);
    if (fs.existsSync(f)) m[arch] = { url: `${RELEASES}/shelf-v${v}/${dmg}`, size: (fs.statSync(f).size / 1048576).toFixed(1) + ' MB' };
  }
  if (m.arm64 && m.x86_64) mac.set('shelf', m);
}

const DMG = /\[[^\]]+\.dmg\]\((https:\/\/github\.com\/tarwin\/tinyjsapp-examples\/releases\/download\/([a-z0-9-]+)-v[^/]+\/[^)]+\.dmg)\) \*\*\(([\d.]+ MB)/;
const files = ['README.md', ...fs.readdirSync(ROOT).map((d) => path.join(d, 'README.md'))
  .filter((f) => fs.existsSync(path.join(ROOT, f)) && f !== 'README.md')];
let changed = 0;
for (const rel of files) {
  const p = path.join(ROOT, rel);
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  let dirty = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('**⬇ Download:**')) continue;
    const m = lines[i].match(DMG);
    if (!m || !mac.has(m[2])) continue;
    const b = mac.get(m[2]);
    // "macOS " prefix: the root README already has it; per-app lines gain it.
    const hasOs = lines[i].slice(0, m.index).endsWith('macOS ');
    lines[i] = lines[i].slice(0, m.index) + (hasOs ? '' : 'macOS ') +
      `[Apple Silicon](${b.arm64.url}) / [Intel](${b.x86_64.url}) **(${b.arm64.size}` +
      lines[i].slice(m.index + m[0].length);
    dirty = true;
  }
  if (dirty) { fs.writeFileSync(p, lines.join('\n')); changed++; console.log('updated ' + rel); }
}
console.log(`${changed} README(s) updated`);
