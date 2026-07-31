#!/usr/bin/env node
// check-streams.mjs — liveness harness for the radio LIST directory.
//
//   node tools/check-streams.mjs             report only
//   node tools/check-streams.mjs --prune     rewrite radio-list.js without the dead
//
// Each station's stream URL gets a real GET (curl, not fetch — Node's fetch
// rejects shoutcast's "ICY 200 OK" status line as invalid HTTP; curl has
// spoken icecast for twenty years). A .pls/.m3u wrapper is fetched and its
// first stream tested instead, exactly what the app's resolveStream does.
// Alive = HTTP 200 with a non-HTML content type (an infinite stream that
// outlives --max-time still reports its code + type). Failures get one
// retry with a longer window before they count as dead — radio servers nap.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const LIST = join(DIR, '..', 'src', 'frontend', 'radio-list.js');
const PRUNE = process.argv.includes('--prune');
const POOL = 24;

const src = readFileSync(LIST, 'utf8');
const ASSIGN = 'window.RADIO_LIST =';
const header = src.slice(0, src.indexOf(ASSIGN));
const data = JSON.parse(src.slice(src.indexOf(ASSIGN) + ASSIGN.length, src.lastIndexOf(';')));

const curl = (args, timeoutMs) => new Promise((resolve) => {
  execFile('curl', args, { timeout: timeoutMs, maxBuffer: 1 << 20 },
    (err, stdout) => resolve({ err, out: String(stdout || '') }));
});
async function head(url, sec) {
  const { out } = await curl(['-s', '-o', '/dev/null',
    '-w', '%{http_code}\t%{content_type}', '-L', '--max-time', String(sec),
    '-H', 'Icy-MetaData: 1', '-H', 'User-Agent: amp-radio-check/1.0', url],
    (sec + 4) * 1000);
  const [code, type] = out.split('\t');
  return { code: Number(code) || 0, type: (type || '').toLowerCase() };
}
async function playlistTarget(url, sec) {
  const { out } = await curl(['-s', '-L', '--max-time', String(sec),
    '-H', 'User-Agent: amp-radio-check/1.0', url], (sec + 4) * 1000);
  for (const line of out.split(/\r?\n/)) {
    const l = line.trim();
    const m = l.match(/^File\d+\s*=\s*(\S+)/i);
    if (m) return m[1];
    if (/^https?:\/\//i.test(l)) return l;
  }
  return null;
}
async function alive(url, sec) {
  let target = url;
  if (/\.(pls|m3u)(\?|$)/i.test(url)) {
    target = await playlistTarget(url, sec);
    if (!target) return { ok: false, why: 'playlist unreadable' };
  }
  const r = await head(target, sec);
  if (r.code !== 200) return { ok: false, why: 'http ' + (r.code || 'dead') };
  if (r.type.startsWith('text/html')) return { ok: false, why: 'html page, not a stream' };
  return { ok: true };
}

const all = [];
for (const g of data) for (const s of g.s) all.push(s);
console.log(`checking ${all.length} streams, ${POOL} at a time…`);
let done = 0;
const verdicts = new Map();
async function worker(queue, sec) {
  for (;;) {
    const s = queue.shift();
    if (!s) return;
    verdicts.set(s.u, await alive(s.u, sec));
    if (++done % 40 === 0) console.log(`  ${done}…`);
  }
}
const q1 = [...all];
await Promise.all(Array.from({ length: POOL }, () => worker(q1, 6)));
const retry = all.filter((s) => !verdicts.get(s.u).ok);
console.log(`first pass: ${retry.length} down — retrying those with a longer window`);
done = 0;
const q2 = [...retry];
await Promise.all(Array.from({ length: POOL }, () => worker(q2, 12)));

const dead = all.filter((s) => !verdicts.get(s.u).ok);
console.log(`\ndead: ${dead.length} / ${all.length}`);
for (const s of dead) console.log(`  ✗ ${s.n} — ${verdicts.get(s.u).why}\n      ${s.u}`);
if (PRUNE && dead.length) {
  const deadUrls = new Set(dead.map((s) => s.u));
  const pruned = data
    .map((g) => ({ ...g, s: g.s.filter((s) => !deadUrls.has(s.u)) }))
    .filter((g) => g.s.length);
  writeFileSync(LIST, header + 'window.RADIO_LIST = ' + JSON.stringify(pruned, null, 1) + ';\n');
  console.log(`\npruned → ${pruned.reduce((n, g) => n + g.s.length, 0)} stations remain in radio-list.js`);
}
