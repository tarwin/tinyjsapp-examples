# hush 🤫

<img src="icon.png" alt="hush icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/hush.webp" alt="hush screenshot" width="640">

**⬇ Download:** [hush-0.1.1.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/hush-0.1.1.dmg) **(4.2 MB)** — prebuilt, signed & notarized; open and drag to Applications.

A tiny secret keeper — API tokens, passwords, connection strings — locked
behind **Touch ID**. Plain JavaScript, zero dependencies, ~6 MB.

The whole app is one idea: **what's secret and what isn't live in different
places.** Secret *values* go straight into the macOS **Keychain**; the app
only remembers the *names*. Nothing sensitive ever touches `tiny.store` or the
disk in the clear, and because the Keychain outlives the app bundle, your
secrets survive a reinstall.

hush starts **locked** — you see the names, nothing else. Press **Unlock with
Touch ID** (or the account-password sheet) and reveal, copy, add, and delete
wake up; the unlock is an in-memory session flag, so it evaporates the moment
you quit. **Reveal** shows a value inline and re-masks it after 20 s;
**Copy** puts it on the clipboard and wipes it 30 s later — but only if it's
still the thing you copied, so it never clobbers whatever you copied next.

Four tinyjs 0.16 techniques, and not much else:

1. **Keychain secrets** — `app.secrets.set(name, value)` / `.get(name)` /
   `.delete(name)`, the keytar / Electron-`safeStorage` role. Generic
   passwords stored under the app id; `get` returns `null` for a name that
   isn't there. There's no "list my keys", which is *why* the app keeps its
   own name index — a real, honest constraint, not a shortcut.
2. **Touch ID** — `app.authenticate('Unlock hush…')` throws up the biometric
   sheet and resolves `true` / `false`. Every value-exposing call is gated on
   the session flag it sets; a cancel or a Mac without enrolled biometrics
   just leaves the app locked and says so.
3. **Clipboard, carefully** — `app.clipboard.write({ text })` to copy, then a
   30 s timer that `app.clipboard.read()`s and only writes an empty string
   back if the clipboard still holds our value. Read-before-write is the whole
   trick to auto-clearing without stomping the user's next copy.
4. **`tiny.store`** — the non-secret name index (`{ name, note, at }[]`), the
   only thing hush persists itself.

The page renders every value with `textContent` (a secret must never become
markup — the page holds an RPC channel with full system access), and the
plaintext lives in the DOM only while a row is revealed.

```sh
tinyjs dev      # run with hot reload
tinyjs build    # package dist/hush.app
```

No permission prompts to pre-arrange: Keychain access and Touch ID need no TCC
usage strings. The name index lives in this app's `tiny.store`; the values
live in your login Keychain under `art.tarwin.hush` (search "hush" in
Keychain Access to see — but not read — them).
