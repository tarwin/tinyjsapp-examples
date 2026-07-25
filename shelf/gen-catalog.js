#!/usr/bin/env node
// Generates catalog.json (repo root) + shelf/src/frontend/catalog.js + 128px icons
// from every app's tinyjs.json, its _builds dmg, and the root README blurbs.
// Re-run after any release so Shelf's live catalog and bundled fallback stay fresh.
//
// Rebuilds the MAC entries only: win/linux/platforms blocks are carried over
// from the existing catalog.json (their generators live elsewhere — see
// gen-catalog-linux.js). Payload urls point at GitHub Releases (tag
// <dir>-v<version>, see CLAUDE.md); a version bump here assumes you've
// uploaded the new dmg to that release. Raw _builds urls are dead — payloads
// were purged from git history 2026-07-25.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.env.EXAMPLES_ROOT || '/Users/tarwin/all/development/tinyjsapp-examples';
const RAW = 'https://raw.githubusercontent.com/tarwin/tinyjsapp-examples/main';
const GH = 'https://github.com/tarwin/tinyjsapp-examples';
const RELEASES = `${GH}/releases/download`;

// useful = you'd actually keep it in the Dock; ux = interaction studies;
// toy = desktop fun; api = tinyjs API showcases
const CATEGORY = {
  amp: 'useful', pasta: 'useful', worldclock: 'useful', nib: 'useful',
  matcha: 'useful', tomato: 'useful', platter: 'useful', podd: 'useful',
  trolley: 'ux', till: 'ux', beam: 'ux',
  boo: 'toy', coo3d: 'toy', kraa: 'toy', kraa3d: 'toy', treez: 'toy',
  cheese: 'api', deja: 'api', hush: 'api', lumber: 'api', presto: 'api',
  procsy: 'api', sqlittle: 'api', 'kitchen-sink': 'api', tinyslaq: 'api',
};

const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const oldByDir = new Map(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'))
    .apps.map((a) => [a.dir, a])
);

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
  const prev = oldByDir.get(dir);
  if (!fs.existsSync(dmgPath)) {
    // no dmg staged for this version (e.g. tinyjs.json bumped for another
    // platform's release) — keep the app's existing entry, never drop it
    if (prev) { console.log(`no ${dmg} — keeping existing entry for ${dir}`); apps.push(prev); }
    else console.log(`skip ${dir} — no ${dmg} and no existing entry`);
    continue;
  }
  const bytes = fs.statSync(dmgPath).size;
  const { tagline, desc } = readmeBits(dir);
  if (!CATEGORY[dir]) throw new Error(`no category for ${dir}`);
  const entry = {
    dir,
    title: j.title || j.name,
    id: j.id,
    version: j.version,
    app: `${j.title || j.name}.app`,
    category: CATEGORY[dir],
    tagline,
    desc,
    dmg,
    // same version → keep the url already in the catalog; new version → the
    // dmg must be uploaded to the <dir>-v<version> release before pushing
    url: prev && prev.version === j.version
      ? prev.url
      : `${RELEASES}/${dir}-v${j.version}/${dmg}`,
    bytes,
    size: (bytes / 1048576).toFixed(1) + ' MB',
    screenshot: `${RAW}/_images/${dir}.webp`,
    // remote copy of the 128px icon — the shelf prefers its bundled
    // icons/<dir>.png but falls back to this for apps added since it was built
    icon: `${RAW}/shelf/src/frontend/icons/${dir}.png`,
    readme: `${GH}/tree/main/${dir}`,
  };
  if (prev) for (const k of ['platforms', 'win', 'linux'])
    if (prev[k]) entry[k] = prev[k];
  apps.push(entry);

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
for (const c of ['useful', 'toy', 'ux', 'api'])
  console.log(`  ${c}: ${apps.filter((a) => a.category === c).map((a) => a.dir).join(', ')}`);
