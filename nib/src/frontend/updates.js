// The two menu items whose answer is a DIALOG, and dialogs are page-side —
// so they live here, shared by every window. The menu event broadcasts to all
// of them; whichever one has focus runs it.
//
// The daily background check stays a notification (onUpdateAvailable in the
// backend) — that one is unsolicited, so it shouldn't stop what you're doing.

window.checkForUpdatesUI = async () => {
  let r;
  try {
    r = await tiny.api.call('update.check');
  } catch (e) {
    await tiny.dialog.alert('Couldn’t check for updates',
      String((e && e.message) || e) + '\n\nCheck your connection and try again.');
    return;
  }
  const now = (r && r.current) ? 'v' + r.current : 'This version';
  if (!r || !r.available) {
    await tiny.dialog.alert('You’re up to date', now + ' is the latest version of Nib.');
    return;
  }
  const go = await tiny.dialog.confirm('Nib v' + r.latest + ' is available', {
    detail: (r.notes ? r.notes + '\n\n' : '') + 'You’re on ' + now
      + '. Nib will download the update and relaunch.',
    ok: 'Update Now', cancel: 'Later',
  });
  if (!go) return;
  try {
    await tiny.api.call('update.install');
  } catch (e) {
    await tiny.dialog.alert('Update failed', String((e && e.message) || e));
  }
};

// File ▸ Install ‘nib’ Shell Command… — a `nib` on PATH, so `nib .` in a
// terminal opens the folder as a project and `nib notes.md` opens the file.
// The backend writes the shim (installCli in main.js says where and what per
// platform); this turns its answer into a dialog. Running it again is the
// repair for a moved app — the shim just gets rewritten.
window.installCliUI = async () => {
  let r;
  try { r = await tiny.api.call('installCli'); }
  catch (e) { r = { status: 'failed', error: String((e && e.message) || e) }; }
  if (r.status === 'ok') {
    const extra = r.note === 'new-terminal'
      ? '\n\nAlready-open terminals keep their old PATH — open a new one first.'
      : r.note === 'add-path'
        ? '\n\nIf the command isn’t found, add ~/.local/bin to your PATH.'
        : '';
    await tiny.dialog.alert('The nib command is installed',
      'In a terminal, `nib .` opens the current folder as a project and '
      + '`nib readme.md` opens the file.\n\n(' + r.path + ')' + extra);
  } else if (r.status === 'dev') {
    await tiny.dialog.alert('Nib is running from source',
      'The shim needs an installed copy of Nib to point at — build or install '
      + 'the app, then run this again from there.');
  } else if (r.status === 'cancelled') {
    await tiny.dialog.alert('Nothing was installed',
      'Writing to /usr/local/bin needs an administrator’s OK — nothing was changed.');
  } else {
    await tiny.dialog.alert('Couldn’t install the nib command',
      String(r.error || 'Unknown error.'));
  }
};

// File ▸ Open .md Files with Nib… — the one part of a file association that
// registering can't do for you. Being IN the "Open With" list happens by
// itself (tinyjs writes the plist entry, the ProgId or the .desktop); being
// the answer to a double-click is the user's to give, and each platform
// guards it differently. Linux has a command, so tinyjs runs it; macOS and
// Windows answer 'unsupported' on purpose, and the honest response to that is
// to say where the switch is rather than pretend to have thrown it.
//
// It's a menu item and not something asked on first launch, for the reason
// tinyjs gives for not doing it automatically: claiming a scheme competes
// with nobody, and claiming .md competes with the user's editor.
window.makeDefaultUI = async () => {
  let r;
  try { r = await tiny.app.setAsDefaultHandler('md'); } catch { r = 'failed'; }
  if (r === 'ok') {
    try { await tiny.app.setAsDefaultHandler('markdown'); } catch { /* one is enough */ }
    await tiny.dialog.alert('Nib opens .md files now',
      'Double-clicking a Markdown file will open it here.');
    return;
  }
  const os = tiny.system.os();
  const how = os === 'windows'
    ? 'Windows keeps this switch to itself — no app is allowed to throw it.\n\n'
      + 'Settings ▸ Apps ▸ Default apps ▸ Choose defaults by file type, find .md, and pick Nib.'
    : os === 'macos'
      ? 'macOS keeps this switch to itself — no app is allowed to throw it.\n\n'
        + 'Select any .md file in Finder and press ⌘I. Under “Open with”, choose Nib, '
        + 'then press “Change All…”.'
      : 'That didn’t take. Your desktop may not have xdg-mime, or it keeps its own '
        + 'association list — set Nib as the handler for text/markdown there.';
  await tiny.dialog.alert(
    r === 'failed' ? 'Couldn’t set Nib as the default' : 'Nib is already in the “Open With” list',
    how);
};
