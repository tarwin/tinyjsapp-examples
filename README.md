# tinyjs examples

Example apps for **[tinyjs](https://tinyjs.app)** — tiny (~6 MB) macOS desktop
apps built from a txiki.js backend and a native WebKit window.

## Getting started

1. Head to **[tinyjs.app](https://tinyjs.app)** and install the `tinyjs` CLI.
2. Clone this repo.
3. Pick an example, `cd` into it, and run it:

   ```sh
   cd kitchen-sink
   tinyjs dev      # run with hot reload
   tinyjs build    # produce dist/<Name>.app + a single binary
   ```

Each example is a self-contained project with its own `tinyjs.json`,
`src/main.js` (backend), and `src/frontend/` (the page).

## Examples

- **[kitchen-sink](kitchen-sink/)** — "Tiny Deck", a command deck that shows off
  the tinyjs API surface: running shell commands from the page, native
  notifications, tray mode, global hotkeys, window/menu control, and file
  dialogs.
- **[tinyslaq](tinyslaq/)** — "TinySlaq", a Slack-style chat clone. Multiple
  colored workspaces and accounts, channels and DMs, messages persisted in
  SQLite, a "post as" switcher, canned DM auto-replies pushed live over the
  bridge, plus desktop notifications for the channel you're not looking at.
  (A UI demo — not affiliated with Slack.)
