// Icons — a hand-picked handful from Lucide (lucide.dev, ISC licence),
// vendored as path data rather than loaded from anywhere. Inline SVG with
// stroke: currentColor is the whole point: an icon is text-coloured, so it
// follows --fg, --dim, --on-accent and every appearance change for free —
// which emoji never did (a colour emoji is the same picture on every theme,
// and the wrong weight against 11px labels).
//
// Emoji still appear where they are CONTENT rather than chrome: the icon an
// action chose for itself, the file-type badges in the tree, and anything in
// the native menus, which are text-only.
//
// To add one: lucide.dev, copy the paths, keep the 24×24 viewBox.

(() => {
  const ICONS = {
    'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
    list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  };

  window.nibIcon = function nibIcon(name, size) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('width', size || 15);
    el.setAttribute('height', size || 15);
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '2');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true');
    el.classList.add('icon');
    el.innerHTML = ICONS[name] || '';
    return el;
  };

  // Markup opts in with data-icon="name" (data-icon-size to override); the
  // svg is prepended so a button can also carry a caret or a label after it.
  window.nibIconsApply = function nibIconsApply(root) {
    for (const el of (root || document).querySelectorAll('[data-icon]')) {
      if (el.querySelector(':scope > svg.icon')) continue;
      el.prepend(window.nibIcon(el.dataset.icon, +el.dataset.iconSize || undefined));
    }
  };
  window.nibIconsApply();

  // An action's icon, as a node. The icon FIELD is a string in the actions
  // file: an emoji comes back as text, an Iconify name ("mdi:rocket") comes
  // back as the SVG the backend fetched and cached (iconSvg rides beside it
  // on everything actionsList/commandList answer). A name whose drawing
  // hasn't arrived — offline, or the first listing hasn't warmed the cache
  // yet — is NOTHING rather than the raw "mdi:rocket" text. Callers decide
  // what nothing looks like (usually: same as an action with no icon).
  window.nibIsIconName = (s) => typeof s === 'string' && /^[a-z0-9-]+:[a-z0-9-]+$/.test(s);
  window.nibActIcon = function nibActIcon(a) {   // {icon, iconSvg} — or a bare string
    const icon = typeof a === 'string' ? a : (a && a.icon);
    const svg = (a && typeof a === 'object' && a.iconSvg) || null;
    if (svg && svg.body) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      el.setAttribute('viewBox', '0 0 ' + (svg.width || 16) + ' ' + (svg.height || 16));
      el.setAttribute('width', 15);
      el.setAttribute('height', 15);
      el.setAttribute('aria-hidden', 'true');
      el.classList.add('icon', 'actico');   // bodies carry fill="currentColor"
      el.innerHTML = svg.body;
      return el;
    }
    if (icon && !window.nibIsIconName(icon)) {
      // a text icon is a glyph — 8 code points clears any ZWJ emoji, and a
      // longer string is a mistake that shouldn't get to wreck a menu row
      return document.createTextNode([...icon].slice(0, 8).join(''));
    }
    return null;
  };

  // An accelerator the way the menu spells it ('p', 'S', 'alt+o'), shown the
  // way a person reads it (⌘P, ⇧⌘S, ⌥⌘O — Ctrl+… off-mac). Lives here
  // because both the palette and Settings ▸ Shortcuts need the same answer.
  const MAC = /Mac/.test(navigator.platform || '');
  window.nibKey = function nibKey(k) {
    if (!k) return '';
    let alt = false;
    if (k.startsWith('alt+')) { alt = true; k = k.slice(4); }
    const shift = /^[A-Z]$/.test(k);
    const ch = k.length === 1 ? k.toUpperCase() : k;
    return MAC
      ? (alt ? '⌥' : '') + (shift ? '⇧' : '') + '⌘' + ch
      : ['Ctrl', alt ? 'Alt' : null, shift ? 'Shift' : null, ch].filter(Boolean).join('+');
  };
})();
