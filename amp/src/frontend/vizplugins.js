// vizplugins.js — everything about visualizer PLUGINS that is not window
// specific, shared by the three pages that show one.
//
// vizhost.js is the sandbox: it mints the worker, drives the frames and speaks
// the protocol. This is the layer above it — finding out which plugins exist,
// fetching their source and the libraries they ask for, and the little dance of
// swapping one in. All three of viz.js (the visualizer window), rack.js (the
// big screen) and vizlab.js (the lab) need exactly that and nothing more.
//
// What is deliberately NOT here: anything you can see. The picker, the labels,
// the name flashes and the rack's dropped/undropped gating all differ per
// window and stay in the window. This module is data and lifecycle.
//
// window.ampVizPlugins = { list, open, onChange }
// window.ampVizRuntime, window.ampVizLib — read by vizhost.js as globals

(function () {
  'use strict';

  // ── the runtime and the sketch libraries ─────────────────────────────────
  // Both are big strings that never change while amp is running, and vizhost
  // asks for them every time it mints a worker. Cached per window.
  //
  // These are globals rather than members because vizhost.js reaches for them
  // by name — it is handed no reference to this module, and keeping it that
  // way means the lab can still run a plugin with nothing else loaded.
  let runtimeSrc = null;
  window.ampVizRuntime = async function () {
    if (runtimeSrc == null) {
      try { runtimeSrc = await tiny.api.call('vizRuntime'); } catch (e) { runtimeSrc = ''; }
      if (!runtimeSrc) {
        runtimeSrc = '';
        if (window.ampVizPlugins.onError) window.ampVizPlugins.onError('could not load the plugin runtime');
      }
    }
    return runtimeSrc;
  };

  // A plugin that uses three is usually not the last one you will look at, and
  // re-reading a megabyte across the bridge every time you press › would be
  // felt. One copy per window, kept for the session.
  const libCache = Object.create(null);
  window.ampVizLib = async function (id) {
    if (!(id in libCache)) {
      try { libCache[id] = await tiny.api.call('vizLib', { id }); }
      catch (e) { libCache[id] = null; }
    }
    return libCache[id];
  };

  window.ampVizPlugins = {
    // set by a window that wants to show load failures its own way
    onError: null,

    /**
     * Which plugins this machine can actually run, keyed 'p:<id>' the way every
     * engine-shaped code path expects.
     *
     * `hasGpu` gates the WebGPU-only ones. That rule is the plugin's own — it
     * declares its backends — rather than amp's NEEDS_GPU list, but the effect
     * is the same: something that could only ever paint black on this machine
     * stays out of the picker instead of being offered.
     */
    async list(hasGpu) {
      let all = [];
      try { all = (await tiny.api.call('vizPlugins')) || []; } catch (e) { all = []; }
      const map = {}, ids = [];
      for (const m of all) {
        if (!m.backends.some((b) => b !== 'webgpu' || hasGpu)) continue;
        const key = 'p:' + m.id;
        map[key] = m;
        ids.push(key);
      }
      return { map, ids };
    },

    /**
     * Swap a plugin into a host. Returns true if it is now running.
     *
     * `stillWanted` is the guard against a slow load: reading a plugin's source
     * crosses the bridge, and in that time the user may well have pressed › a
     * few more times. Without it the last one to FINISH wins rather than the
     * last one chosen, which on a folder of heavy plugins is a real race.
     */
    async open(host, manifest, stillWanted) {
      if (!host || !manifest) return false;
      const want = stillWanted || (() => true);
      try {
        const got = await tiny.api.call('vizPlugin', { id: manifest.id });
        if (!want()) return false;
        if (!got || !got.source) {
          if (this.onError) this.onError('could not read ' + manifest.name);
          return false;
        }
        await host.load({ id: manifest.id, source: got.source });
        if (!want()) { host.dispose(); return false; }
        return true;
      } catch (e) {
        if (this.onError) this.onError('could not load ' + manifest.name);
        return false;
      }
    },

    /** amp watches the visualizer folder; this is how a page hears about it. */
    onChange(fn) {
      try { tiny.api.on('viz-plugins', fn); } catch (e) {}
    },
  };
})();
