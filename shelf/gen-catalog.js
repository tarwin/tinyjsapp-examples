#!/usr/bin/env node
// Generates catalog.json (repo root) + shelf/src/frontend/catalog.js + 128px icons
// from every app's tinyjs.json, its _builds dmg, and the root README blurbs.
// Re-run after any release so Shelf's live catalog and bundled fallback stay fresh.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = '/Users/tarwin/all/development/tinyjsapp-examples';
const RAW = 'https://raw.githubusercontent.com/tarwin/tinyjsapp-examples/main';
const GH = 'https://github.com/tarwin/tinyjsapp-examples';

// useful = you'd actually keep it in the Dock; ux = interaction studies;
// toy = desktop fun; api = tinyjs API showcases
const CATEGORY = {
  amp: 'useful', pasta: 'useful', worldclock: 'useful', nib: 'useful',
  matcha: 'useful', tomato: 'useful',
  trolley: 'ux', till: 'ux', beam: 'ux',
  boo: 'toy', coo3d: 'toy', kraa: 'toy', kraa3d: 'toy', treez: 'toy',
  cheese: 'api', deja: 'api', hush: 'api', lumber: 'api', presto: 'api',
  procsy: 'api', sqlittle: 'api', 'kitchen-sink': 'api', tinyslaq: 'api',
};

const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

function readmeBits(dir) {
  // Section: ### **[dir](dir/)** \n\n #### tagline ... imgs ... \n\n description para
  const re = new RegExp(
    '### \\*\\*\\[' + dir + '\\]\\(' + dir + '/\\)\\*\\*\\s*\\n+#### (.+?)\\n([\\s\\S]*?)(?=\\n### |$)'
  );
  const m = readme.match(re);
  if (!m) return { tagline: '', desc: '' };
  const tagline = m[1].trim();
  const paras = m[2].split(/\n{2,}/).map((p) => p.trim())
    .filter((p) => p && !p.startsWith('<img') && !p.startsWith('**⬇'));
  return { tagline, desc: (paras[0] || '').replace(/\s+/g, ' ') };
}

const apps = [];
for (const dir of fs.readdirSync(ROOT).sort()) {
  if (dir === 'shelf') continue; // the store doesn't stock itself
  const tj = path.join(ROOT, dir, 'tinyjs.json');
  if (!fs.existsSync(tj)) continue;
  const j = JSON.parse(fs.readFileSync(tj, 'utf8'));
  const dmg = `${dir}-${j.version}.dmg`;
  const dmgPath = path.join(ROOT, '_builds', dmg);
  if (!fs.existsSync(dmgPath)) { console.log(`skip ${dir} — no ${dmg}`); continue; }
  const bytes = fs.statSync(dmgPath).size;
  const { tagline, desc } = readmeBits(dir);
  if (!CATEGORY[dir]) throw new Error(`no category for ${dir}`);
  apps.push({
    dir,
    title: j.title || j.name,
    id: j.id,
    version: j.version,
    app: `${j.title || j.name}.app`,
    category: CATEGORY[dir],
    tagline,
    desc,
    dmg,
    url: `${GH}/raw/main/_builds/${dmg}`,
    bytes,
    size: (bytes / 1048576).toFixed(1) + ' MB',
    screenshot: `${RAW}/_images/${dir}.webp`,
    readme: `${GH}/tree/main/${dir}`,
  });

  // 128px icon for the shelf list
  const src = path.join(ROOT, dir, 'icon.png');
  const dst = path.join(ROOT, 'shelf/src/frontend/icons', `${dir}.png`);
  if (fs.existsSync(src)) execFileSync('sips', ['-z', '128', '128', src, '--out', dst], { stdio: 'ignore' });
  else console.log(`no icon for ${dir}`);
}

const catalog = { generated: new Date().toISOString().slice(0, 10), apps };
fs.writeFileSync(path.join(ROOT, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
fs.writeFileSync(
  path.join(ROOT, 'shelf/src/frontend/catalog.js'),
  '// bundled fallback — regenerate with scripts in repo (gen-catalog)\n' +
    'window.CATALOG = ' + JSON.stringify(catalog, null, 2) + ';\n'
);
console.log(`catalog: ${apps.length} apps`);
for (const c of ['useful', 'ux', 'toy', 'api'])
  console.log(`  ${c}: ${apps.filter((a) => a.category === c).map((a) => a.dir).join(', ')}`);
