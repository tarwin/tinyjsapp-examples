// hush palette — the whole app is a gate. Locked, it shows only names; unlock
// with Touch ID and reveal / copy / add / remove wake up. Every value the
// backend hands over is rendered with textContent (a secret must never become
// markup — this page holds an RPC channel with full system access), and the
// plaintext lives in the DOM only while a row is revealed.

const $ = (id) => document.getElementById(id);

let unlocked = false;
let entries = [];
const shown = new Map();       // name -> plaintext, only while revealed
const hideTimers = new Map();  // name -> auto-remask timeout

const REMASK_MS = 20_000;      // a revealed value re-hides itself after this

// ------------------------------------------------------------------ helpers

function relTime(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ------------------------------------------------------------------- render

function remask(name) {
  shown.delete(name);
  const tm = hideTimers.get(name);
  if (tm) { clearTimeout(tm); hideTimers.delete(name); }
}

function render() {
  document.body.classList.toggle('unlocked', unlocked);
  $('lockScreen').hidden = unlocked;
  $('lockBtn').hidden = !unlocked;
  $('addForm').hidden = !unlocked;

  const list = $('list');
  list.textContent = '';
  entries.forEach((it) => list.appendChild(row(it)));

  $('empty').hidden = entries.length > 0 || !unlocked;
}

function row(it) {
  const li = document.createElement('li');

  const head = document.createElement('div');
  head.className = 'head';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = it.name;
  head.appendChild(name);
  const when = document.createElement('span');
  when.className = 'when';
  when.textContent = relTime(it.at);
  head.appendChild(when);
  li.appendChild(head);

  if (it.note) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = it.note;
    li.appendChild(note);
  }

  // The value line: dots until revealed, the plaintext (monospace) after.
  const val = document.createElement('div');
  val.className = 'value';
  val.textContent = shown.has(it.name) ? shown.get(it.name) : '••••••••••••';
  if (shown.has(it.name)) val.classList.add('shown');
  li.appendChild(val);

  const acts = document.createElement('div');
  acts.className = 'acts';
  acts.appendChild(actionBtn(shown.has(it.name) ? 'Hide' : 'Reveal', () => toggleReveal(it.name)));
  acts.appendChild(actionBtn('Copy', () => copy(it.name)));
  acts.appendChild(actionBtn('Delete', () => remove(it), 'danger'));
  li.appendChild(acts);

  return li;
}

function actionBtn(label, onClick, cls) {
  const b = document.createElement('button');
  b.className = 'act' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ------------------------------------------------------------------ actions

async function refresh() {
  const st = await tiny.api.call('state');
  unlocked = st.unlocked;
  entries = st.entries;
  if (!unlocked) { shown.clear(); hideTimers.forEach(clearTimeout); hideTimers.clear(); }
  render();
}

async function unlock() {
  $('unlockErr').hidden = true;
  const ok = await tiny.api.call('unlock');
  if (!ok) {
    $('unlockErr').textContent = 'Touch ID was cancelled or unavailable.';
    $('unlockErr').hidden = false;
    return;
  }
  await refresh();
}

async function lock() {
  await tiny.api.call('lock');
  await refresh();
}

async function toggleReveal(name) {
  if (shown.has(name)) { remask(name); render(); return; }
  const value = await tiny.api.call('reveal', { name });
  if (value == null) { toast('Nothing stored for that name.'); return; }
  shown.set(name, value);
  hideTimers.set(name, setTimeout(() => { remask(name); render(); }, REMASK_MS));
  render();
}

async function copy(name) {
  const ok = await tiny.api.call('copy', { name });
  toast(ok ? 'Copied — clears from the clipboard in 30s' : 'Nothing to copy.');
}

async function remove(it) {
  const ok = await tiny.win.confirm('Delete “' + it.name + '”?', {
    detail: 'This removes it from the Keychain for good. This cannot be undone.',
    ok: 'Delete', cancel: 'Keep',
  });
  if (!ok) return;
  remask(it.name);
  await tiny.api.call('remove', { name: it.name });
  await refresh();
}

async function add() {
  $('addErr').hidden = true;
  const name = $('fName').value;
  const value = $('fValue').value;
  const note = $('fNote').value;
  try {
    await tiny.api.call('add', { name, value, note });
    $('fName').value = ''; $('fValue').value = ''; $('fNote').value = '';
    $('fName').focus();
    await refresh();
    toast('Saved to the Keychain.');
  } catch (e) {
    $('addErr').textContent = String(e && e.message ? e.message : e).replace(/^Error:\s*/, '');
    $('addErr').hidden = false;
  }
}

// -------------------------------------------------------------------- wiring

$('unlockBtn').addEventListener('click', unlock);
$('lockBtn').addEventListener('click', lock);
$('addBtn').addEventListener('click', add);
$('fNote').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
$('fValue').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('fNote').focus(); });
$('fName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('fValue').focus(); });

refresh();
