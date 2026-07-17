// Cheese — a photo booth. Live camera preview, 3-2-1 countdown snaps with
// filters baked in, and video clips with sound. Say cheese!
//
// One app, four tinyjs techniques (0.12 camera & microphone):
//
//   1. getUserMedia, for real — the camera preview and mic capture happen in
//      the WebKit page with the standard web APIs. The launcher answers
//      WebKit's per-origin media prompt for you, so the user only ever sees
//      the one system dialog naming this app.
//   2. Permission onboarding — app.permissions.check('camera'|'microphone')
//      drives the gate screen: 'undetermined' gets an Enable button (the
//      system prompt appears on first getUserMedia), 'denied' gets a button
//      that opens the right pane of System Settings. No silent black box.
//   3. Packaged permissions — tinyjs.json's "permissions" block becomes the
//      Info.plist usage strings + hardened-runtime entitlements, so the
//      built Cheese.app passes TCC. (Without them, macOS kills the app the
//      moment it touches the camera.)
//   4. Real files out — snaps land in ~/Pictures/Cheese as real jpgs (sent
//      over the bridge in base64 chunks), thumbnails come back the pasta
//      way (sips + data URI), and every gallery tile drags out of the app
//      as a real file (win.startDrag).
//
// MediaRecorder note: WebKit records video/mp4 (H.264/AAC) — feature-detect
// with isTypeSupported instead of assuming webm like Chromium.

const SHOTS_DIR = tjs.env.HOME + '/Pictures/Cheese';
const SUPPORT_DIR = tjs.env.HOME + '/Library/Application Support/art.tarwin.cheese';
const THUMB_DIR = SUPPORT_DIR + '/thumbs';
const THUMB_PX = '320';               // gallery tile bounding box
const MAX_MEDIA = 200 * 1024 * 1024;  // refuse absurd uploads (200 MB)

// ------------------------------------------------------------------ spawning

async function run(cmd) {
  const proc = tjs.spawn(cmd, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  await proc.wait();
}

// ------------------------------------------------------------------- helpers

const b64decode = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const b64encode = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ` +
         `${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
};

const thumbOf = (name) => THUMB_DIR + '/' + name.replace(/\.\w+$/, '.jpg');

// ------------------------------------------------------------------- uploads
// Media crosses the bridge in base64 chunks (a clip can be tens of MB — one
// giant JSON-RPC message is asking for trouble). The frontend slices the
// base64 string on 4-char boundaries so every chunk decodes independently.

let nextUpload = 1;
const uploads = new Map();   // id -> { kind, ext, chunks: [], size }

// ---------------------------------------------------------------------- api

export const api = {
  // Both TCC states at once — the gate screen renders from this.
  perms: async (_p, app) => ({
    camera: await app.permissions.check('camera'),
    microphone: await app.permissions.check('microphone'),
  }),

  request: ({ name }, app) => {
    if (name !== 'camera' && name !== 'microphone') throw new Error('bad name');
    return app.permissions.request(name);
  },

  // 'denied' can't be re-prompted (macOS only asks once) — deep-link the
  // user to the exact pane of System Settings instead.
  openPrivacy: ({ pane }) => {
    const panes = { camera: 'Privacy_Camera', microphone: 'Privacy_Microphone' };
    if (!panes[pane]) throw new Error('bad pane');
    return run(['open', 'x-apple.systempreferences:com.apple.preference.security?' + panes[pane]]);
  },

  begin: ({ kind, ext }) => {
    if (!/^(jpg|png|mp4|webm)$/.test(ext)) throw new Error('bad ext');
    const id = nextUpload++;
    uploads.set(id, { kind, ext, chunks: [], size: 0 });
    return { id };
  },

  chunk: ({ id, b64 }) => {
    const up = uploads.get(id);
    if (!up) throw new Error('no such upload');
    up.size += b64.length;
    if (up.size > MAX_MEDIA * 1.4) { uploads.delete(id); throw new Error('too big'); }
    up.chunks.push(b64);
  },

  // Concatenate, write the real file, make the gallery thumbnail. Photos get
  // a sips thumbnail; clips bring their own poster (a canvas grab from the
  // moment recording started — sips can't thumbnail video).
  end: async ({ id, poster }) => {
    const up = uploads.get(id);
    uploads.delete(id);
    if (!up) throw new Error('no such upload');
    const parts = up.chunks.map(b64decode);
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) { bytes.set(p, off); off += p.length; }

    const name = `${up.kind === 'clip' ? 'Clip' : 'Cheese'} ${stamp()}.${up.ext}`;
    const file = SHOTS_DIR + '/' + name;
    await tjs.writeFile(file, bytes);

    if (poster) {
      await tjs.writeFile(thumbOf(name), b64decode(poster));
    } else {
      await run(['sips', '-Z', THUMB_PX, '-s', 'format', 'jpeg', file, '--out', thumbOf(name)]);
    }
    return { name };
  },

  list: async () => {
    const items = [];
    try {
      for await (const e of await tjs.readDir(SHOTS_DIR)) {
        const m = e.name.match(/^(Cheese|Clip) .+\.(jpg|png|mp4|webm)$/);
        if (!m) continue;
        const file = SHOTS_DIR + '/' + e.name;
        const st = await tjs.stat(file);
        items.push({
          name: e.name,
          file,
          kind: m[1] === 'Clip' ? 'clip' : 'photo',
          bytes: st.size,
          mtime: st.mtim.getTime(),
          thumb: await thumbUri(e.name),
        });
      }
    } catch { /* folder not created yet — empty gallery */ }
    items.sort((a, b) => b.mtime - a.mtime);
    return items;
  },

  reveal: ({ file }) => {
    guard(file);
    return run(['open', '-R', file]);
  },

  remove: async ({ file, name }) => {
    guard(file);
    await run(['rm', '-f', file, thumbOf(name)]);
    thumbCache.delete(name);
  },

  openFolder: () => run(['open', SHOTS_DIR]),
};

// Only ever touch files inside our own folder, whatever the page sends.
function guard(file) {
  if (typeof file !== 'string' || !file.startsWith(SHOTS_DIR + '/') || file.includes('..')) {
    throw new Error('bad path');
  }
}

const thumbCache = new Map();          // name -> data URI

async function thumbUri(name) {
  if (thumbCache.has(name)) return thumbCache.get(name);
  let uri = null;
  try {
    uri = 'data:image/jpeg;base64,' + b64encode(await tjs.readFile(thumbOf(name)));
  } catch { /* thumb missing — the tile renders a glyph */ }
  thumbCache.set(name, uri);
  return uri;
}

// --------------------------------------------------------------------- init

export function init(app) {
  run(['mkdir', '-p', SHOTS_DIR, THUMB_DIR]);
}
