# SQLittle

A little SQLite browser — **Vue 3 + PrimeVue 4 + TypeScript**, running as a
tinyjs app (0.10.0 `--template vue-ts`).

- **Open a database three ways**: the Open… button (native file panel),
  dropping a file on the window (`tiny.win.onDrop`), or **double-clicking a
  `.db` / `.sqlite` / `.sqlite3` file in Finder** — `"fileExtensions"` in
  `tinyjs.json` registers the packaged app as an Open With handler, and
  `tiny.app.onOpenFiles` delivers the path (buffered across cold start).
- Sidebar lists tables & views with live row counts; **Browse** is a lazy
  paginated PrimeVue DataTable (100 rows a page, straight from disk).
- **Query** tab: free-form SQL with ⌘↩ to run, timing + row count, sortable
  results, and inline error display.
- The backend is ~100 lines because txiki ships SQLite natively
  (`import { Database } from 'tjs:sqlite'`) — no driver, no npm dependency.
- Follows the system light/dark theme live (`tiny.theme` → PrimeVue's
  `.p-dark` selector).

`sample.db` is a small music library (tables + a view) to poke at.

```sh
npm install
tinyjs dev      # vite dev server + native window, HMR included
tinyjs build    # vite build + package dist/SQLittle.app
open sample.db  # after a build: opens in SQLittle via Open With
```
