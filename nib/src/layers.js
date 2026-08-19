// Layers — the three answers a setting can have, and which one wins.
//
//   mine    yours, on this machine, everywhere. The base.
//   folder  the folder's own, in `.nib/settings.json`. It TRAVELS: commit it
//           and everyone who clones the repo gets it.
//   local   this folder, on THIS machine, in Nib's own store. Never written
//           inside the folder, so it is the layer for "the repo says Night
//           and I want Paper" — and the only one available at all when a
//           folder isn't keeping settings of its own.
//
// Higher wins, PER KEY. That last part is the whole point of this file: it
// used to be per OBJECT, so a folder that set the theme silently owned the
// page width, the Markdown flavour and every other preference too — because
// the loader helpfully filled in the defaults before storing them. A folder
// now sets what it set, and everything else falls through and SAYS it fell
// through, which is what makes the settings window able to show you where a
// value actually came from.
//
// Nothing here touches disk or knows what a preference means. It takes plain
// objects in layer order and answers two questions: what is the value, and who
// said so. That is what makes it testable, and this is exactly the sort of
// precedence logic that is miserable to debug through a UI.

export const LAYER_NAMES = ['mine', 'folder', 'local'];   // low → high

// A setting is addressed by a dotted path: a scalar at the top ('theme') or a
// member of one of the maps ('prefs.hc', 'images.dest'). Two levels is all
// this ever needs, and pretending otherwise would buy nothing.
export function readPath(layer, path) {
  if (!layer) return undefined;
  const i = path.indexOf('.');
  if (i < 0) return layer[path];
  const outer = layer[path.slice(0, i)];
  return outer ? outer[path.slice(i + 1)] : undefined;
}

export function writePath(layer, path, value) {
  const i = path.indexOf('.');
  if (i < 0) { layer[path] = value; return layer; }
  const head = path.slice(0, i);
  if (!layer[head] || typeof layer[head] !== 'object') layer[head] = {};
  layer[head][path.slice(i + 1)] = value;
  return layer;
}

// Clearing is what "reset to inherited" does, and it has to leave NOTHING
// behind: an empty `prefs: {}` in a folder's settings file is a promise that
// the folder has an opinion, and it would keep showing up in diffs.
export function clearPath(layer, path) {
  if (!layer) return layer;
  const i = path.indexOf('.');
  if (i < 0) { delete layer[path]; return layer; }
  const head = path.slice(0, i);
  if (!layer[head]) return layer;
  delete layer[head][path.slice(i + 1)];
  if (!Object.keys(layer[head]).length) delete layer[head];
  return layer;
}

/**
 * Who wins for one path.
 *
 * `stack` is [{ name, data }] in LOW-to-high order — callers pass only the
 * layers that are actually in play, so a window with no folder open simply
 * hands over one.
 *
 * Returns { value, from, set } — `from` is the layer that provided it (or
 * null when nothing did and the default stands), and `set` lists every layer
 * holding a value, so the UI can say "the folder sets this too, but your
 * local answer is winning" rather than hiding it.
 */
export function effective(stack, path, fallback) {
  let value = fallback;
  let from = null;
  const set = [];
  for (const { name, data } of stack) {
    const v = readPath(data, path);
    if (v === undefined) continue;
    set.push(name);
    value = v;
    from = name;
  }
  return { value, from, set };
}

// The whole resolved settings object the app runs on: scalars picked, maps
// merged key by key over their defaults.
export function resolveAll(stack, { prefDefaults, imageDefaults }) {
  const prefs = { ...prefDefaults };
  const images = { ...imageDefaults };
  for (const { data } of stack) {
    if (!data) continue;
    if (data.prefs) for (const [k, v] of Object.entries(data.prefs)) {
      if (v !== undefined && k in prefDefaults) prefs[k] = v;
    }
    if (data.images) for (const [k, v] of Object.entries(data.images)) {
      if (v !== undefined && k in imageDefaults) images[k] = v;
    }
  }
  return {
    theme: effective(stack, 'theme', 'paper').value,
    view: effective(stack, 'view', 'split').value,
    prefs,
    images,
  };
}

// Provenance for every path the settings window draws, in one pass — one
// object keyed by path, so the page never has to ask per row.
export function provenance(stack, paths, defaults) {
  const out = {};
  for (const p of paths) out[p] = effective(stack, p, defaults[p]);
  return out;
}
