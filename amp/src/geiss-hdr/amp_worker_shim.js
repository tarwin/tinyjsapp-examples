// amp_worker_shim.js — amp's worker factory for Geiss HDR (not part of the
// original Geiss HDR distribution; written for the amp example app).
//
// Geiss HDR spawns a module worker from "./background_worker.js" to build
// warp maps off-thread. The tinyjs build inlines the entire frontend into a
// single HTML file, so no relative worker URL can resolve at runtime.
// Instead, build.sh pre-bundles background_worker.js (+ its imports) into
// worker.bundle.txt, esbuild inlines that file here as a string (via
// --loader:.txt=text), and we boot the worker from a Blob URL.
import workerSrc from "./worker.bundle.txt";

export function CreateGeissWorker() {
  const blob = new Blob([workerSrc], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(blob));   // classic worker: the bundle has no imports left
}
