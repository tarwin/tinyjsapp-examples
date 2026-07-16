// drag.js — magnetic window dragging, shared by every amp window.
//
// Frameless windows have no native titlebar, so we drag them ourselves. The
// trick that makes it robust: a pointer event's screenX/screenY are GLOBAL, so
// even as we move the window under the cursor, (screenX - start) is the true
// physical displacement. We add snapping to screen edges and to sibling
// windows (their rects come from the backend, which is the only thing that can
// see across windows). Dragging the MAIN window carries the windows docked to
// it along for the ride (the classic Winamp feel); dragging a satellite moves
// only itself.

(function () {
  const SNAP = 12;                 // px: how close before an edge grabs
  const me = tiny.win.id;
  const canShade = me === 'main' || me === 'playlist' || me === 'eq';
  let d = null;
  let shaded = false, fullH = 0;

  const overlaps = (a0, a1, b0, b1, t) => a0 < b1 + t && b0 < a1 + t;
  const flush = (a, b) => {        // are a and b edge-to-edge right now?
    const t = 6;
    const vx = overlaps(a.y, a.y + a.height, b.y, b.y + b.height, 0);
    const hy = overlaps(a.x, a.x + a.width, b.x, b.x + b.width, 0);
    const touchX = vx && (Math.abs(a.x + a.width - b.x) <= t || Math.abs(b.x + b.width - a.x) <= t);
    const touchY = hy && (Math.abs(a.y + a.height - b.y) <= t || Math.abs(b.y + b.height - a.y) <= t);
    return touchX || touchY;
  };
  // every window connected (transitively) to `start` through flush contacts
  function cluster(start, all) {
    const ids = Object.keys(all), seen = new Set([start]), q = [start];
    while (q.length) {
      const cur = q.shift();
      for (const j of ids) if (!seen.has(j) && flush(all[cur], all[j])) { seen.add(j); q.push(j); }
    }
    seen.delete(start);
    return [...seen];
  }

  function pickScreen(screens, w) {
    if (!screens || !screens.length) return null;
    const cx = w.x + w.width / 2, cy = w.y + w.height / 2;
    let best = screens[0];
    for (const s of screens) {
      const v = s.visible || s;
      if (cx >= v.x && cx < v.x + v.width && cy >= v.y && cy < v.y + v.height) return v;
    }
    return best.visible || best;
  }

  // snap one axis; returns the adjusted coordinate
  function snap(pos, size, perpPos, perpSize, others, scr, axis) {
    const P = axis === 'x' ? 'x' : 'y', S = axis === 'x' ? 'width' : 'height';
    const PP = axis === 'x' ? 'y' : 'x', PS = axis === 'x' ? 'height' : 'width';
    let bestV = pos, bestD = SNAP + 1;
    const consider = (edge, candidate) => {
      const dist = Math.abs(edge - candidate);
      if (dist < bestD) { bestD = dist; bestV = pos + (candidate - edge); }
    };
    if (scr) {
      consider(pos, scr[P]);
      consider(pos + size, scr[P] + scr[S]);
    }
    for (const r of others) {
      if (!overlaps(perpPos, perpPos + perpSize, r[PP], r[PP] + r[PS], SNAP)) continue;
      const r0 = r[P], r1 = r[P] + r[S];
      consider(pos, r0);            // align near edges
      consider(pos + size, r1);     // align far edges
      consider(pos + size, r0);     // dock: my far edge to their near edge
      consider(pos, r1);            // dock: my near edge to their far edge
    }
    return bestD <= SNAP ? Math.round(bestV) : Math.round(pos);
  }

  async function begin(e, handle) {
    if (e.button !== 0) return;
    if (e.target.closest('.wbtn, .btn, input, a, .nodrag')) return;
    e.preventDefault();
    let self, rects, screens;
    try {
      self = await tiny.win.getState();
      rects = await tiny.api.call('rects');
      screens = await tiny.api.call('screens');
    } catch (err) { return; }
    // every window keyed by id (use my fresh getState for my own rect)
    const all = {};
    for (const id in rects) all[id] = { id, x: rects[id].x, y: rects[id].y, width: rects[id].width, height: rects[id].height };
    all[me] = { id: me, x: self.x, y: self.y, width: self.width, height: self.height };
    // Only the MAIN window carries its docked neighbours along; dragging a
    // satellite just moves that one window (simpler, and main stays the anchor).
    const groupIds = me === 'main' ? cluster(me, all) : [];
    const inGroup = new Set(groupIds);
    const group = groupIds.map((id) => ({ id, dx: all[id].x - self.x, dy: all[id].y - self.y }));
    const others = Object.keys(all).filter((id) => id !== me && !inGroup.has(id)).map((id) => all[id]);
    d = {
      sx: e.screenX, sy: e.screenY, ox: self.x, oy: self.y,
      w: self.width, h: self.height,
      others, scr: pickScreen(screens, self), group, pid: e.pointerId, handle,
    };
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function move(e) {
    if (!d) return;
    let x = d.ox + (e.screenX - d.sx);
    let y = d.oy + (e.screenY - d.sy);
    x = snap(x, d.w, y, d.h, d.others, d.scr, 'x');
    y = snap(y, d.h, x, d.w, d.others, d.scr, 'y');
    if (d.group.length) {
      // one call moves me + every docked window together (per-window calls lag)
      const moves = [{ id: me, x, y }].concat(d.group.map((g) => ({ id: g.id, x: x + g.dx, y: y + g.dy })));
      tiny.api.call('moveGroup', { moves });
    } else {
      tiny.win.setPosition(x, y);
    }
    d.lastX = x; d.lastY = y;
    const now = performance.now();     // update the "attached" edges live (throttled)
    if (!d.lastDock || now - d.lastDock > 90) { d.lastDock = now; tiny.api.call('refreshDock'); }
  }

  function end() {
    if (!d) return;
    if (d.lastX != null) {
      tiny.api.call('savePos', { id: me, x: d.lastX, y: d.lastY });
      for (const g of d.group) tiny.api.call('savePos', { id: g.id, x: d.lastX + g.dx, y: d.lastY + g.dy });
      tiny.api.call('refreshDock');   // final docked-edge highlight
    }
    d = null;
  }

  // ── windowshade: double-click the titlebar to collapse to just the bar ────
  async function applyShade(on) {
    const chassis = document.querySelector('.chassis');
    if (!chassis || on === shaded) return;
    const st = await tiny.win.getState();     // remember the top-left corner + old size
    const bar = document.querySelector('.titlebar');
    let newH;
    if (on) { fullH = st.height; shaded = true; chassis.classList.add('shaded'); newH = (bar ? bar.offsetHeight : 20) + 2; }
    else { shaded = false; chassis.classList.remove('shaded'); newH = fullH || 172; }
    tiny.win.setSize(st.width, newH);
    tiny.win.setPosition(st.x, st.y);         // resizing anchors bottom-left; pin the top-left back
    // slide anything docked below up/down so it stays attached
    tiny.api.call('reflow', { id: me, dh: newH - st.height, x0: st.x, x1: st.x + st.width, oldBottom: st.y + st.height });
  }
  function toggleShade() { applyShade(!shaded).then(() => tiny.api.call('setShade', { id: me, value: shaded })); }
  window.ampToggleShade = toggleShade;   // for a titlebar button, not just double-click

  function bind(handle) {
    handle.addEventListener('pointerdown', (e) => begin(e, handle));
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    if (canShade) handle.addEventListener('dblclick', (e) => {
      if (e.target.closest('.wbtn, .btn, input')) return;
      toggleShade();
    });
  }

  function ready() { document.querySelectorAll('.titlebar').forEach(bind); }
  if (document.readyState !== 'loading') ready();
  else document.addEventListener('DOMContentLoaded', ready);
  window.ampBindDrag = bind;   // for titlebars added later

  // file:// URL for a disk path (readAccess lets <audio>/<img> load these).
  // Encode each path segment so spaces/()#? in filenames don't break the URL.
  window.ampFileURL = (p) => 'file://' + p.split('/').map(encodeURIComponent).join('/');

  // WebKit's default file-drop navigates the webview to the dropped file (which
  // replaces our whole UI with the browser's native media player). Suppress it;
  // real file paths still arrive via the launcher's tiny.win.onDrop channel.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // clicking/focusing any amp window raises the whole set to the front together
  window.addEventListener('focus', () => tiny.api.call('raiseAll', { except: me }));

  // Right-click menu: a single Always-on-Top toggle that applies to the WHOLE
  // app (the backend sets it on every window). Declaring our own context menu
  // also replaces WebKit's default — so no "Inspect Element".
  let onTop = false;
  const setCtx = () => tiny.menu.setContext([{ id: 'ontop', label: 'Always on Top', checked: onTop }]);
  setCtx();
  tiny.menu.onContext((id) => { if (id === 'ontop') tiny.api.call('setOnTop', { value: !onTop }); });
  tiny.api.on('ontop', (v) => { onTop = !!v; setCtx(); });   // backend applied it everywhere

  // ⌘A in ANY window is the same toggle (nothing here has text to select-all).
  document.addEventListener('keydown', (e) => {
    if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      tiny.api.call('setOnTop', { value: !onTop });
    }
  });

  // "attached" edge highlight — the backend says which of our edges are docked
  tiny.api.on('docked', (e) => {
    const c = document.querySelector('.chassis'); if (!c) return;
    c.classList.toggle('dock-t', !!e.t); c.classList.toggle('dock-b', !!e.b);
    c.classList.toggle('dock-l', !!e.l); c.classList.toggle('dock-r', !!e.r);
  });

  // restore this window's shade + always-on-top checkmark on load
  (async () => {
    try {
      const st = await tiny.api.call('windowReady', { id: me });
      if (st) { onTop = !!st.onTop; setCtx(); if (st.shade) applyShade(true); }
    } catch (e) {}
  })();
})();
