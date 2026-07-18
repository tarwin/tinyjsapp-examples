/* global tiny */

const SECTIONS = [
  { key: 'useful', label: 'Daily drivers' },
  { key: 'ux', label: 'UX experiments' },
  { key: 'toy', label: 'Desktop toys' },
  { key: 'api', label: 'API showcases' },
];

let catalog = null;      // { generated, apps: [...] }
let live = false;        // came from GitHub vs bundled copy
let selfId = '';
let installed = {};      // dir -> {installed, version?, running?, foreign?}
let busy = {};           // dir -> {phase, pct}
let tab = 'all';         // 'all' | 'installed'
const open = new Set();  // expanded rows
const confirming = new Set();  // rows showing the uninstall confirm strip

const $list = document.getElementById('list');
const $src = document.getElementById('src');
const $counts = document.getElementById('counts');

const stripMd = (s) =>
  (s || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');

function vcmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function flash(msg) {
  const d = document.createElement('div');
  d.className = 'err';
  d.textContent = msg;
  $list.prepend(d);
  setTimeout(() => d.remove(), 6000);
}

async function doInstall(a) {
  const wasUpdate = (installed[a.dir] || {}).installed;
  busy[a.dir] = { phase: 'download', pct: 0 };
  render();
  let ok = false;
  try {
    installed[a.dir] = await tiny.api.call('install', {
      dir: a.dir, url: a.url, app: a.app, id: a.id,
    });
    ok = true;
  } catch (e) {
    flash(`${a.title}: ${e.message || e}`);
  }
  delete busy[a.dir];
  render();
  // updating myself: the copy on disk is now newer than the one running
  if (ok && wasUpdate && a.id === selfId) tiny.api.call('relaunch');
}

async function doUninstall(a, removeSettings) {
  busy[a.dir] = { phase: 'remove', pct: 0 };
  render();
  try {
    installed[a.dir] = await tiny.api.call('uninstall', {
      app: a.app, id: a.id, removeSettings,
    });
  } catch (e) {
    flash(`${a.title}: ${e.message || e}`);
  }
  delete busy[a.dir];
  open.delete(a.dir);
  confirming.delete(a.dir);
  render();
}

function actionEls(a) {
  const st = installed[a.dir] || {};
  const b = busy[a.dir];
  const els = [];
  if (b) {
    const p = document.createElement('div');
    p.className = 'prog';
    p.innerHTML = '<i></i><span></span>';
    p.dataset.dir = a.dir;
    paintProg(p, b);
    els.push(p);
    return els;
  }
  if (st.foreign) {
    const s = document.createElement('span');
    s.className = 'tag';
    s.title = `${a.app} in /Applications isn't from this repo`;
    s.textContent = 'name taken';
    els.push(s);
    return els;
  }
  const self = a.id === selfId;
  if (!st.installed) {
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = `Install · ${a.size}`;
    btn.onclick = (e) => { e.stopPropagation(); doInstall(a); };
    els.push(btn);
  } else {
    const hasUpdate = vcmp(a.version, st.version) > 0;
    if (hasUpdate) {
      const up = document.createElement('button');
      up.className = 'primary';
      up.textContent = self ? `Update & relaunch` : `Update ${st.version} → ${a.version}`;
      up.onclick = (e) => { e.stopPropagation(); doInstall(a); };
      els.push(up);
    }
    if (!self) {
      if (!hasUpdate) {
        const btn = document.createElement('button');
        btn.textContent = 'Open';
        btn.onclick = (e) => {
          e.stopPropagation();
          tiny.api.call('openApp', { app: a.app });
        };
        els.push(btn);
      }
      const rm = document.createElement('button');
      rm.className = 'danger';
      rm.textContent = '✕';
      rm.title = `Uninstall ${a.app}`;
      rm.onclick = async (e) => {
        e.stopPropagation();
        const yes = await tiny.win.confirm(`Uninstall ${a.title}?`,
          { detail: 'Its settings are kept — the Uninstall… link inside the row can remove those too.',
            ok: 'Uninstall', cancel: 'Cancel' });
        if (yes) doUninstall(a, false);
      };
      els.push(rm);
    }
  }
  return els;
}

function paintProg(el, b) {
  const label = { download: 'download', install: 'copying…', remove: 'removing…', done: 'done' }[b.phase];
  el.querySelector('i').style.width = `${Math.round((b.pct || 0) * 100)}%`;
  el.querySelector('span').textContent =
    b.phase === 'download' ? `${Math.round((b.pct || 0) * 100)}%` : label;
}

function row(a) {
  const st = installed[a.dir] || {};
  const div = document.createElement('div');
  div.className = 'row' + (open.has(a.dir) ? ' open' : '');

  const top = document.createElement('div');
  top.className = 'row-top';

  const img = document.createElement('img');
  img.src = `icons/${a.dir}.png`;
  img.alt = '';
  top.appendChild(img);

  const info = document.createElement('div');
  info.className = 'row-info';
  const t = document.createElement('div');
  t.className = 't';
  const name = document.createElement('span');
  name.textContent = a.title;
  t.appendChild(name);
  if (st.running) {
    const d = document.createElement('span');
    d.className = 'dot-run';
    d.title = 'running';
    t.appendChild(d);
  }
  const v = document.createElement('span');
  v.className = 'v';
  v.textContent = st.installed ? `v${st.version} installed` : `v${a.version}`;
  t.appendChild(v);
  if (a.id === selfId) {
    const me = document.createElement('span');
    me.className = 'me';
    me.textContent = 'this app';
    t.appendChild(me);
  }
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = stripMd(a.tagline);
  info.appendChild(t);
  info.appendChild(tag);
  top.appendChild(info);

  const act = document.createElement('div');
  act.className = 'act';
  for (const el of actionEls(a)) act.appendChild(el);
  top.appendChild(act);

  top.onclick = () => {
    if (open.has(a.dir)) { open.delete(a.dir); confirming.delete(a.dir); }
    else open.add(a.dir);
    render();
  };
  div.appendChild(top);

  const more = document.createElement('div');
  more.className = 'more';
  if (open.has(a.dir)) {
    const shot = document.createElement('img');
    shot.className = 'shot';
    shot.alt = '';
    shot.src = a.screenshot;
    shot.onerror = () => shot.remove();
    more.appendChild(shot);

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = stripMd(a.desc);
    more.appendChild(desc);

    const links = document.createElement('div');
    links.className = 'links';
    const gh = document.createElement('a');
    gh.href = '#';
    gh.textContent = 'README on GitHub';
    gh.onclick = (e) => { e.preventDefault(); tiny.api.call('openURL', { url: a.readme }); };
    links.appendChild(gh);
    if (st.installed && a.id !== selfId) {
      const rv = document.createElement('a');
      rv.href = '#';
      rv.textContent = 'Show in Finder';
      rv.onclick = (e) => { e.preventDefault(); tiny.api.call('reveal', { app: a.app }); };
      links.appendChild(rv);
      const un = document.createElement('a');
      un.href = '#';
      un.textContent = 'Uninstall…';
      un.style.color = 'var(--danger)';
      un.onclick = (e) => {
        e.preventDefault();
        confirming.add(a.dir);
        render();
      };
      links.appendChild(un);
    }
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${a.dmg} · ${a.size} · signed & notarized`;
    links.appendChild(meta);
    more.appendChild(links);

    if (confirming.has(a.dir) && st.installed && a.id !== selfId) {
      const c = document.createElement('div');
      c.className = 'confirm';
      const q = document.createElement('span');
      q.textContent = `Remove ${a.app}?`;
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode('also delete its settings'));
      const yes = document.createElement('button');
      yes.className = 'danger';
      yes.textContent = 'Remove';
      yes.onclick = () => doUninstall(a, cb.checked);
      const no = document.createElement('button');
      no.textContent = 'Cancel';
      no.onclick = () => { confirming.delete(a.dir); render(); };
      c.append(q, lab, yes, no);
      more.appendChild(c);
    }
  }
  div.appendChild(more);
  return div;
}

function tile(a) {
  const st = installed[a.dir] || {};
  const b = busy[a.dir];
  const d = document.createElement('div');
  d.className = 'tile';
  d.title = a.title;

  const img = document.createElement('img');
  img.src = `icons/${a.dir}.png`;
  img.alt = '';
  d.appendChild(img);

  const name = document.createElement('span');
  name.className = 'tname';
  name.textContent = a.title;
  d.appendChild(name);

  if (st.running) {
    const r = document.createElement('span');
    r.className = 'trun';
    r.title = 'running';
    d.appendChild(r);
  }
  if (b) {
    const p = document.createElement('div');
    p.className = 'tprog';
    p.innerHTML = '<i></i>';
    p.dataset.dir = a.dir;
    p.firstChild.style.width = `${Math.round((b.pct || 0) * 100)}%`;
    d.appendChild(p);
  } else {
    if (vcmp(a.version, st.version) > 0) {
      const up = document.createElement('button');
      up.className = 'tup';
      up.textContent = '↑';
      up.title = `Update to ${a.version}`;
      up.onclick = (e) => { e.stopPropagation(); doInstall(a); };
      d.appendChild(up);
    }
    if (a.id !== selfId) {
      const x = document.createElement('button');
      x.className = 'tx';
      x.textContent = '✕';
      x.title = `Uninstall ${a.app}`;
      x.onclick = async (e) => {
        e.stopPropagation();
        const yes = await tiny.win.confirm(`Uninstall ${a.title}?`,
          { detail: 'Its settings are kept. Use the All tab to remove those too.', ok: 'Uninstall', cancel: 'Cancel' });
        if (yes) doUninstall(a, false);
      };
      d.appendChild(x);
    }
  }

  d.onclick = () => {
    if (a.id === selfId) return;
    tiny.api.call('openApp', { app: a.app });
  };
  return d;
}

function renderGrid() {
  const apps = catalog.apps.filter((a) => (installed[a.dir] || {}).installed || busy[a.dir]);
  if (!apps.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    const p = document.createElement('p');
    p.textContent = 'The shelf is bare — nothing installed yet.';
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Browse the fleet';
    btn.onclick = () => setTab('all');
    e.append(p, btn);
    $list.appendChild(e);
    return;
  }
  const g = document.createElement('div');
  g.className = 'grid';
  for (const a of apps) g.appendChild(tile(a));
  $list.appendChild(g);
}

function renderList() {
  for (const s of SECTIONS) {
    const apps = catalog.apps.filter((a) => a.category === s.key);
    if (!apps.length) continue;
    const h = document.createElement('div');
    h.className = 'sect';
    const h2 = document.createElement('h2');
    h2.textContent = s.label;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(apps.length);
    h.append(h2, n);
    $list.appendChild(h);
    for (const a of apps) $list.appendChild(row(a));
    const plank = document.createElement('div');
    plank.className = 'plank';
    $list.appendChild(plank);
  }
}

function render() {
  $list.textContent = '';
  if (tab === 'installed') renderGrid();
  else renderList();
  const inst = Object.values(installed).filter((s) => s.installed).length;
  const ups = catalog.apps.filter((a) => {
    const st = installed[a.dir];
    return st && st.installed && vcmp(a.version, st.version) > 0;
  }).length;
  $counts.textContent = `${catalog.apps.length} apps · ${inst} installed` +
    (ups ? ` · ${ups} update${ups > 1 ? 's' : ''} ready` : '');
}

function setTab(t) {
  tab = t;
  for (const b of document.querySelectorAll('#tabs button'))
    b.classList.toggle('on', b.dataset.tab === t);
  try { tiny.store.set('tab', t); } catch {}
  render();
}

tiny.api.on('progress', ({ dir, phase, pct }) => {
  busy[dir] = { phase, pct };
  const el = document.querySelector(`.prog[data-dir="${CSS.escape(dir)}"]`);
  if (el) paintProg(el, busy[dir]);
  const tp = document.querySelector(`.tprog[data-dir="${CSS.escape(dir)}"] i`);
  if (tp) tp.style.width = `${Math.round((pct || 0) * 100)}%`;
});

document.getElementById('repo').onclick = (e) => {
  e.preventDefault();
  tiny.api.call('openURL', { url: 'https://github.com/tarwin/tinyjsapp-examples' });
};
document.getElementById('dotClose').onclick = () => tiny.quit();
document.getElementById('dotMini').onclick = () => tiny.win.minimize();
const $refresh = document.getElementById('refresh');
$refresh.onclick = async () => {
  if ($refresh.classList.contains('spin')) return;
  $refresh.classList.add('spin');
  try {
    if (!(await tiny.api.call('refresh'))) flash("Couldn't reach the catalog on GitHub");
  } finally {
    $refresh.classList.remove('spin');
  }
};
for (const b of document.querySelectorAll('#tabs button'))
  b.onclick = () => setTab(b.dataset.tab);

function srcLabel() {
  $src.textContent = live ? `catalog · live (${catalog.generated})` : `catalog · bundled (${catalog.generated})`;
  $src.classList.toggle('live', live);
}

// backend refreshes the catalog from GitHub shortly after launch, every
// 15 min, and on the ⟳ — and re-scans whenever /Applications changes under us
tiny.api.on('catalog', (cat) => {
  catalog = cat;
  live = true;
  srcLabel();
  render();
});
tiny.api.on('installed', (map) => {
  installed = map;
  render();
});

async function boot() {
  selfId = await tiny.api.call('selfId');
  catalog = window.CATALOG;   // paint immediately; the live push replaces it
  live = false;
  srcLabel();
  let saved = null;
  try { saved = await tiny.store.get('tab'); } catch {}
  setTab(saved === 'installed' ? 'installed' : 'all');
  installed = await tiny.api.call('watchApps', {
    apps: catalog.apps.map((a) => ({ dir: a.dir, app: a.app, id: a.id, title: a.title, version: a.version })),
  });
  render();
}

boot();

