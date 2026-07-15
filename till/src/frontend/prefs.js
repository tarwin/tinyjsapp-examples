// Till — the Preferences window (a normal titled window, native close button).
// Everything here is live: checkboxes call straight into real tinyjs APIs on
// the backend (launchAtLogin, setDockVisible, idleTime polling, global
// hotkeys) and persist through the store.

const $ = (id) => document.getElementById(id);
let prefs = null;

// ── tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.ptab').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.ptab').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.psheet').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + b.dataset.tab));
  };
});

// ── General ─────────────────────────────────────────────────────────────────
// launch-at-login is a real macOS login item (packaged apps; dev = unsupported)
function paintAutostart(status) {
  const chk = $('chkAuto'), note = $('autoNote');
  chk.checked = status === 'enabled';
  chk.disabled = status === 'unsupported';
  note.hidden = status !== 'unsupported' && status !== 'requires-approval';
  note.textContent =
    status === 'unsupported' ? 'Available in the packaged app (tinyjs build) on macOS 13+.'
    : status === 'requires-approval' ? 'macOS wants your OK — allow Till in System Settings → General → Login Items.'
    : '';
}
$('chkAuto').onchange = async () => paintAutostart(await tiny.api.call('setAutostart', { enabled: $('chkAuto').checked }));
$('chkDock').onchange = () => tiny.api.call('setPrefs', { dock: $('chkDock').checked });
$('chkIdle').onchange = () => tiny.api.call('setPrefs', { idleEnabled: $('chkIdle').checked });
$('inpIdle').onchange = () => tiny.api.call('setPrefs', { idleMinutes: parseInt($('inpIdle').value, 10) || 10 });
$('btnNotif').onclick = () => tiny.api.call('manageNotifications', {});

// ── Shortcuts ────────────────────────────────────────────────────────────────
// Click a recorder, press a combo → registered SYSTEM-WIDE via tiny hotkeys.
// Backspace clears, Escape cancels.
const SLOTS = [
  ['sc_new', 'Start a new timer'],
  ['sc_toggle', 'Show/hide timesheet'],
  ['sc_summary', 'Show time summary'],
  ['sc_favs', 'Show favorites'],
];
const SYM = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' };
const pretty = (combo) => combo.split('+').map((p) => SYM[p] || p.toUpperCase()).join('');
let recording = null;            // slot id while capturing

function paintShortcuts() {
  const box = $('scRows'); box.innerHTML = '';
  for (const [id, label] of SLOTS) {
    const row = document.createElement('div'); row.className = 'scrow';
    const lab = document.createElement('span'); lab.className = 'lab'; lab.textContent = label;
    const btn = document.createElement('button'); btn.className = 'screc'; btn.dataset.id = id;
    const combo = prefs.shortcuts[id];
    if (recording === id) { btn.classList.add('rec'); btn.textContent = 'Type shortcut… (⌫ clears, esc cancels)'; }
    else if (combo) { btn.classList.add('set'); btn.textContent = pretty(combo); }
    else btn.textContent = 'Record Shortcut';
    btn.onclick = () => { recording = recording === id ? null : id; paintShortcuts(); };
    row.append(lab, btn); box.appendChild(row);
  }
}
document.addEventListener('keydown', async (e) => {
  if (!recording) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { recording = null; paintShortcuts(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    const r = await tiny.api.call('setShortcut', { id: recording, combo: null });
    prefs.shortcuts = r.shortcuts; recording = null; paintShortcuts(); return;
  }
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;   // wait for the real key
  const mods = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  if (e.metaKey) mods.push('cmd');
  if (!mods.some((m) => m !== 'shift')) return;                      // need ⌘/⌃/⌥, shift alone is typing
  let key = e.key.toLowerCase();
  if (e.code && e.code.startsWith('Key')) key = e.code.slice(3).toLowerCase();      // layout-stable letters
  else if (e.code && e.code.startsWith('Digit')) key = e.code.slice(5);
  if (!/^([a-z0-9]|f[0-9]{1,2})$/.test(key)) return;                 // letters, digits, F-keys
  const r = await tiny.api.call('setShortcut', { id: recording, combo: mods.concat(key).join('+') });
  if (r.ok) { prefs.shortcuts = r.shortcuts; recording = null; }
  paintShortcuts();
}, true);
$('btnScReset').onclick = async () => {
  const r = await tiny.api.call('clearShortcuts', {});
  prefs.shortcuts = r.shortcuts; recording = null; paintShortcuts();
};

// ── Support ──────────────────────────────────────────────────────────────────
$('btnReset').onclick = async () => {
  if (await tiny.win.confirm('Clear all time entries and favorites?', { detail: 'This resets the local timesheet. There is no undo.', ok: 'Clear', cancel: 'Keep' }))
    await tiny.api.call('resetDemo', {});
};
$('selLog').onchange = () => tiny.api.call('setPrefs', { logLevel: $('selLog').value });
$('btnReveal').onclick = () => tiny.api.call('revealData', {});

// ── boot ─────────────────────────────────────────────────────────────────────
(async () => {
  const r = await tiny.api.call('getPrefs', {});
  prefs = r.prefs;
  paintAutostart(r.autostart);
  $('chkDock').checked = !!prefs.dock;
  $('chkIdle').checked = !!prefs.idleEnabled;
  $('inpIdle').value = prefs.idleMinutes;
  $('selLog').value = prefs.logLevel || 'error';
  paintShortcuts();
})();
