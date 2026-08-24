// domshim.js — the smallest fake DOM that lets a sketch library boot inside
// amp's plugin worker. Pasted into a vendored bundle by tools/build-vizlibs.mjs;
// never loaded on its own.
//
// The cage (see src/vizworker.js) gives a plugin no window and no document, on
// purpose. three.js does not care — you hand WebGLRenderer a canvas and it
// never looks for one. p5 and q5 do care: both were written for a page, and
// both reach for a document while starting up, well below the drawing API.
//
// So this is not a DOM. It is the four things those two actually touch,
// measured by running them in the cage until they stopped throwing:
//
//   window                 they read it, and q5 hangs its globals off it
//   requestAnimationFrame  workers have none; amp drives frames anyway, so
//                          this only has to exist, not be good
//   document.createElement('canvas')  → an OffscreenCanvas, which is what the
//                          worker can actually draw on
//   a <main> to append the canvas to, with a parentElement above it
//
// Anything else returns an inert stub. Nothing here reaches the page, the
// bridge or the network — it is all local to the worker, and the CSP is
// untouched.
(function () {
  if (typeof self.document === 'object' && self.document) return;   // already shimmed

  var NOOP = function () {};
  function stubEl() {
    return {
      style: {}, dataset: {}, id: '', children: [], childNodes: [], parentNode: null,
      classList: { add: NOOP, remove: NOOP, toggle: NOOP, contains: function () { return false; } },
      setAttribute: NOOP, getAttribute: function () { return null; }, removeAttribute: NOOP,
      appendChild: NOOP, append: NOOP, prepend: NOOP, insertBefore: NOOP, removeChild: NOOP,
      insertAdjacentHTML: NOOP, insertAdjacentElement: NOOP, remove: NOOP,
      addEventListener: NOOP, removeEventListener: NOOP, dispatchEvent: function () { return true; },
      focus: NOOP, blur: NOOP, getContext: function () { return null; },
      getBoundingClientRect: function () {
        return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
      },
      offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0,
    };
  }

  // one stand-in element for every lookup — p5 appends its canvas to
  // document.getElementsByTagName('main')[0], so that must not be undefined
  var host = null;
  function theHost() { return host || (host = stubEl()); }

  self.window = self;
  self.global = self;
  if (typeof self.devicePixelRatio !== 'number') self.devicePixelRatio = 1;
  self.requestAnimationFrame = self.requestAnimationFrame || function (cb) {
    return setTimeout(function () { cb(performance.now()); }, 16);
  };
  self.cancelAnimationFrame = self.cancelAnimationFrame || function (id) { clearTimeout(id); };
  self.matchMedia = self.matchMedia || function () {
    return { matches: false, addEventListener: NOOP, removeEventListener: NOOP, addListener: NOOP };
  };

  self.document = {
    readyState: 'complete',
    createElement: function (tag) {
      if (String(tag).toLowerCase() === 'canvas') {
        // the one thing that has to be real: a canvas the worker can draw on
        var c = new OffscreenCanvas(1, 1);
        var s = stubEl();
        for (var k in s) { if (!(k in c)) { try { c[k] = s[k]; } catch (e) {} } }
        var parent = stubEl();
        try { c.parentElement = parent; c.parentNode = parent; } catch (e) {}
        return c;
      }
      return stubEl();
    },
    createElementNS: function (ns, tag) { return self.document.createElement(tag); },
    createTextNode: function () { return stubEl(); },
    getElementsByTagName: function () { return [theHost()]; },
    querySelector: function () { return theHost(); },
    querySelectorAll: function () { return []; },
    getElementById: function () { return null; },
    addEventListener: NOOP, removeEventListener: NOOP,
    get body() { return theHost(); },
    get head() { return theHost(); },
    get documentElement() { return theHost(); },
    fonts: { ready: Promise.resolve(), add: NOOP, load: function () { return Promise.resolve([]); } },
  };
})();
