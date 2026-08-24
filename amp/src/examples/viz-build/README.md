# Building an amp visualizer from a project

A visualizer plugin has to arrive as **one classic script**. amp mints it as a
worker from a blob, so at the far end there is no module loader, no
`importScripts` and no network — one file is the only shape that can run.

That is a packaging rule, not a way of working. This project is the other half:
several source files, your editor telling you what a `Matrix4` does, and a build
step that produces the one file amp wants.

```
npm install
npm run build      # → dist/<name>/index.js  (+ viz.json beside it)
npm run watch      # rebuild on save
```

Then either copy `dist/<name>/` into amp's visualizer folder (viz picker → ☰ →
*Add a visualizer…*), or open `dist/<name>/index.js` in the **Viz Lab** and press
Watch — the lab re-runs it every time the file changes, so `npm run watch` in one
window and the lab in another is the edit loop.

## Two examples

| | |
|---|---|
| `src/spectrum2d/` | Canvas 2D, three source files, no library. **3.5 KB** out. |
| `src/spheres3d/`  | three.js — glossy spheres in a room lit by an environment map. **7.6 KB** out. |

## The two things that are not default esbuild

**Format.** `format: 'iife'`, never `esm`. A plugin is a classic script.

**The `// amp:uses` line has to survive into the output.** amp reads it off the
*built* file, before it mints the worker, and only scans the first 4 KB — but a
bundler puts its own preamble first and a minifier would throw a comment away.
So `build.mjs` lifts that line off the entry file and re-emits it as a banner.

## Why three.js is not in the bundle

`src/spheres3d/index.js` says `// amp:uses three` and then **never imports
three**. amp injects its own copy as a global, so by the time your code runs
`THREE` is simply there.

Which means three is a **devDependency of this project only** — it exists for
`@types/three` and your editor, and it is absent from the output. That is why
the three example builds to 7.6 KB instead of 1.1 MB, and why a visualizer you
share stays a small readable file somebody can audit before installing.

The types come from `types/amp-viz.d.ts`, which declares:

```ts
declare const THREE: typeof import('three/webgpu') & { TSL: typeof import('three/tsl') };
```

so you get full completion on a global you never imported. Note it is the
**webgpu** build: `WebGPURenderer` covers both backends (WebGPU where the
machine has one, WebGL2 where it does not), and there is no `WebGLRenderer`.

## Editor setup

`jsconfig.json` already points at the declarations and turns on `checkJs`, so
VS Code type-checks the plugin API without a build step. Each entry file also
carries a `/// <reference …>` so a single file opened on its own still gets it.

For TypeScript instead of JavaScript: rename to `.ts`, swap `jsconfig.json` for
a `tsconfig.json` with the same `include`, and point esbuild at `index.ts`.
Nothing else changes — esbuild strips the types on the way through.

## What amp actually guarantees

The sandbox and the plugin API are documented in
[`../../src/docs/20-visualizers.md`](../../src/docs/20-visualizers.md), which is
also readable in the app (right-click the deck → *amp Help…*). The short version:
you get an `OffscreenCanvas` and amp's audio analysis, on your own thread, with
no DOM, no `eval`, no network and no way to reach amp itself.
