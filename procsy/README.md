# Procsy

<img src="icon.png" alt="procsy icon" height="64" style="float: left; margin-right: 24px;">

<img src="../_images/procsy.webp" alt="procsy screenshot" width="640">

**⬇ Download:** [procsy-0.1.3.dmg](https://github.com/tarwin/tinyjsapp-examples/raw/main/_builds/procsy-0.1.3.dmg) **(4.8 MB)** — prebuilt, signed & notarized; open and drag to Applications.

A process & open-port inspector — **React 19 + Radix UI (Themes) + TypeScript**,
running as a tinyjs app (0.10.0 `--template react-ts`).

- **Processes** tab: live `ps` (2.5 s refresh), filter, click-to-sort columns,
  CPU badges, per-row menu with Quit (SIGTERM) / Force Kill (SIGKILL) / copy
  PID & path.
- **Open Ports** tab: `lsof -i` (listening TCP + UDP) with proto/address/owner,
  and a kill button per port.
- Every kill goes through a **native macOS confirm dialog**
  (`tiny.win.confirm`), and errors surface as native alerts.
- Follows the system light/dark theme live (`tiny.theme` → Radix `<Theme
  appearance>`).

The backend (`backend/main.ts`, TypeScript, esbuild-bundled by tinyjs) shells
out to `ps`, `lsof`, `kill`, and `sysctl` with `tjs.spawn` — the frontend never
touches the system directly.

```sh
npm install
tinyjs dev      # vite dev server + native window, HMR included
tinyjs build    # vite build + package dist/Procsy.app
```
