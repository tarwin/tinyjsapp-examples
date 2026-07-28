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
