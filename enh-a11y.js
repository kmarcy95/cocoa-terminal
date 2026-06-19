/* ============================================================================
   CACAO/FP — enh-a11y.js  (#20 — Accessibility: focus-trap dialogs + keyboard nav)
   Self-installing IIFE. Loads AFTER the other enh-* modules.

   What it adds (additively, without editing any other file):
     (A) Accessible dialogs — MutationObserver on #modal-root and #drawer-root.
         When a .modal-card / .drawer appears it is given role="dialog",
         aria-modal="true", an aria-labelledby pointing at its title, focus is
         moved inside and TRAPPED with Tab / Shift-Tab. On removal, focus is
         restored to the element that opened the dialog. (Escape already closes
         via existing handlers — we do NOT double-bind it; we only restore
         focus when the node is removed.)
     (B) Keyboard navigation —
         1. A visually-hidden "Skip to content" link (first body child) → #canvas.
         2. Roving-tabindex .sidenav: ArrowUp/Down move between .nav-item,
            Enter/Space activates (dispatches a click so the existing nav handler
            runs). Active item is the single tab stop.
         3. Table-row navigation: when #canvas has tr[data-action] rows,
            ArrowDown/Up (or j/k) move a visible focus ring across rows and
            Enter triggers the focused row (row.click()). Re-initialized per view.
         4. :focus-visible outlines (var(--accent)) for buttons / nav / rows.

   Coexists with cmdk (Ctrl/Cmd-K, '/') and brief (Escape): all listeners are
   additive, respect e.defaultPrevented, and never stopImmediatePropagation
   globally. Styles use a single a11y-* prefixed <style> with design tokens.
   Idempotent (window.__cacaoA11yInstalled). localStorage untouched. Zero deps
   beyond documented globals.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- idempotency guard ------------------------------------------------ */
  if (window.__cacaoA11yInstalled) return;
  window.__cacaoA11yInstalled = true;

  /* ---- small utilities -------------------------------------------------- */
  var FOCUSABLE_SEL = [
    'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', 'iframe', 'object',
    'embed', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]'
  ].join(',');

  var _uid = 0;
  function uniqueId(prefix) { _uid += 1; return (prefix || 'a11y') + '-' + _uid; }

  function isVisible(el) {
    if (!el) return false;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    // offsetParent is null for display:none; rects guard against 0-size.
    if (el.offsetParent === null && el.getClientRects().length === 0) return false;
    return true;
  }

  function focusableWithin(root) {
    if (!root) return [];
    var nodes = root.querySelectorAll(FOCUSABLE_SEL);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  /* ======================================================================
     (A) ACCESSIBLE DIALOGS — modal + drawer focus management
     ====================================================================== */

  // Track active dialog records so we can trap Tab and restore focus on close.
  var _dialogs = []; // { node, trigger, keyHandler }

  function labelDialog(node, titleSel) {
    if (node.getAttribute('aria-labelledby')) return; // already labelled
    var titleEl = node.querySelector(titleSel);
    if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
      if (!titleEl.id) titleEl.id = uniqueId('a11y-dlg-title');
      node.setAttribute('aria-labelledby', titleEl.id);
    } else {
      node.setAttribute('aria-label', 'Dialog');
    }
  }

  function trapKeydown(node) {
    return function (e) {
      if (e.key !== 'Tab') return;
      if (e.defaultPrevented) return;
      var items = focusableWithin(node);
      if (!items.length) {
        // Nothing focusable inside — keep focus on the dialog itself.
        e.preventDefault();
        if (node.focus) node.focus();
        return;
      }
      var first = items[0];
      var last = items[items.length - 1];
      var current = document.activeElement;
      if (e.shiftKey) {
        if (current === first || current === node || !node.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (current === last || current === node || !node.contains(current)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
  }

  function openDialog(node, titleSel) {
    if (!node || node.__a11yDialog) return;
    node.__a11yDialog = true;

    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    labelDialog(node, titleSel);

    // Remember the trigger so we can restore focus when the dialog closes.
    var trigger = document.activeElement;
    if (trigger === document.body || !trigger) trigger = null;

    // Make the dialog container itself focusable as a fallback target.
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');

    var keyHandler = trapKeydown(node);
    node.addEventListener('keydown', keyHandler);

    _dialogs.push({ node: node, trigger: trigger, keyHandler: keyHandler });

    // Move focus inside after the dialog DOM is settled.
    setTimeout(function () {
      if (!node.isConnected) return;
      var items = focusableWithin(node);
      // Prefer the first non-close control; fall back to first focusable, then node.
      var target = null;
      for (var i = 0; i < items.length; i++) {
        if (!items[i].classList || !items[i].classList.contains('drawer-close')) {
          target = items[i]; break;
        }
      }
      if (!target) target = items[0] || node;
      try { target.focus(); } catch (e) { /* noop */ }
    }, 0);
  }

  function closeDialogRecord(rec) {
    if (!rec) return;
    if (rec.node && rec.keyHandler) {
      rec.node.removeEventListener('keydown', rec.keyHandler);
    }
    // Restore focus to the opener if it is still in the document.
    var t = rec.trigger;
    if (t && t.isConnected && typeof t.focus === 'function') {
      try { t.focus(); } catch (e) { /* noop */ }
    }
  }

  function handleDialogRemovals(removedNodes, titleSel, dialogSel) {
    if (!removedNodes || !removedNodes.length || !_dialogs.length) return;
    // A removed node may BE the dialog, or CONTAIN it (scrim wrapping the card).
    for (var i = _dialogs.length - 1; i >= 0; i--) {
      var rec = _dialogs[i];
      var stillThere = rec.node && rec.node.isConnected;
      if (!stillThere) {
        closeDialogRecord(rec);
        _dialogs.splice(i, 1);
      }
    }
  }

  function observeDialogRoot(rootId, dialogSel, titleSel) {
    var root = document.getElementById(rootId);
    if (!root) return;

    function scan() {
      var node = root.querySelector(dialogSel);
      if (node) openDialog(node, titleSel);
    }

    var mo = new MutationObserver(function (mutations) {
      var sawAdded = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length) sawAdded = true;
        if (mutations[i].removedNodes && mutations[i].removedNodes.length) {
          handleDialogRemovals(mutations[i].removedNodes, titleSel, dialogSel);
        }
      }
      if (sawAdded) scan();
    });
    mo.observe(root, { childList: true, subtree: true });

    // Initial pass in case a dialog is already open at install time.
    scan();
  }

  function installDialogA11y() {
    observeDialogRoot('modal-root', '.modal-card', '.modal-title');
    observeDialogRoot('drawer-root', '.drawer', '.drawer-title');
  }

  /* ======================================================================
     (B1) SKIP-TO-CONTENT LINK
     ====================================================================== */

  function installSkipLink() {
    if (document.querySelector('.a11y-skip')) return;
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '-1');

    var link = document.createElement('a');
    link.className = 'a11y-skip';
    link.href = '#canvas';
    link.textContent = 'Skip to content';
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var c = document.getElementById('canvas');
      if (!c) return;
      if (!c.hasAttribute('tabindex')) c.setAttribute('tabindex', '-1');
      try { c.focus(); } catch (err) { /* noop */ }
      if (c.scrollIntoView) c.scrollIntoView();
    });
    if (document.body.firstChild) {
      document.body.insertBefore(link, document.body.firstChild);
    } else {
      document.body.appendChild(link);
    }
  }

  /* ======================================================================
     (B2) ROVING-TABINDEX SIDENAV
     ====================================================================== */

  function navItems() {
    var nav = document.getElementById('sidenav');
    if (!nav) return [];
    return Array.prototype.slice.call(nav.querySelectorAll('.nav-item'));
  }

  function activeNavIndex(items) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].classList.contains('active')) return i;
    }
    return 0;
  }

  // Set the roving tab stop to the active item (or a chosen index).
  function syncNavRoving(focusIndex) {
    var items = navItems();
    if (!items.length) return;
    var stop = (typeof focusIndex === 'number') ? focusIndex : activeNavIndex(items);
    if (stop < 0) stop = 0;
    if (stop >= items.length) stop = items.length - 1;
    for (var i = 0; i < items.length; i++) {
      items[i].setAttribute('tabindex', i === stop ? '0' : '-1');
      if (!items[i].hasAttribute('role')) items[i].setAttribute('role', 'link');
    }
  }

  function moveNav(items, fromIndex, delta) {
    var next = (fromIndex + delta + items.length) % items.length;
    syncNavRoving(next);
    try { items[next].focus(); } catch (e) { /* noop */ }
  }

  function onNavKeydown(e) {
    if (e.defaultPrevented) return;
    var nav = document.getElementById('sidenav');
    if (!nav) return;
    var target = e.target && e.target.closest ? e.target.closest('.nav-item') : null;
    if (!target || !nav.contains(target)) return; // only act when focus is on a nav item

    var items = navItems();
    if (!items.length) return;
    var idx = items.indexOf(target);
    if (idx === -1) return;

    var key = e.key;
    if (key === 'ArrowDown') {
      e.preventDefault();
      moveNav(items, idx, 1);
    } else if (key === 'ArrowUp') {
      e.preventDefault();
      moveNav(items, idx, -1);
    } else if (key === 'Home') {
      e.preventDefault();
      syncNavRoving(0);
      try { items[0].focus(); } catch (er) { /* noop */ }
    } else if (key === 'End') {
      e.preventDefault();
      syncNavRoving(items.length - 1);
      try { items[items.length - 1].focus(); } catch (er) { /* noop */ }
    } else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      // Dispatch a real click so the existing wireNav() handler runs switchView.
      target.click();
    }
  }

  function installSidenavNav() {
    var nav = document.getElementById('sidenav');
    if (!nav) return;
    syncNavRoving();
    // One delegated keydown on the sidenav (scoped — never global).
    if (!nav.__a11yKeyed) {
      nav.__a11yKeyed = true;
      nav.addEventListener('keydown', onNavKeydown);
    }
  }

  /* ======================================================================
     (B3) TABLE-ROW KEYBOARD NAVIGATION (per view)
     ====================================================================== */

  var _rowState = { rows: [], index: -1, keyed: false };

  function getCanvasRows() {
    var canvas = document.getElementById('canvas');
    if (!canvas) return [];
    return Array.prototype.slice.call(canvas.querySelectorAll('tr[data-action]'));
  }

  function clearRowFocus() {
    if (_rowState.rows) {
      for (var i = 0; i < _rowState.rows.length; i++) {
        var r = _rowState.rows[i];
        if (r && r.classList) r.classList.remove('a11y-row-focus');
      }
    }
  }

  function setRowFocus(index, doFocus) {
    var rows = _rowState.rows;
    if (!rows.length) return;
    if (index < 0) index = 0;
    if (index >= rows.length) index = rows.length - 1;
    clearRowFocus();
    _rowState.index = index;
    var row = rows[index];
    if (!row) return;
    row.classList.add('a11y-row-focus');
    if (doFocus) {
      try { row.focus(); } catch (e) { /* noop */ }
      if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }
  }

  function onCanvasRowKeydown(e) {
    if (e.defaultPrevented) return;
    if (isTypingTarget(e.target)) return; // never hijack typing
    var canvas = document.getElementById('canvas');
    if (!canvas) return;

    var rows = _rowState.rows;
    if (!rows.length) return;

    // Determine the current row: prefer the one holding focus.
    var focusedRow = e.target && e.target.closest ? e.target.closest('tr[data-action]') : null;
    var withinCanvas = focusedRow && canvas.contains(focusedRow);
    var curIdx = withinCanvas ? rows.indexOf(focusedRow) : _rowState.index;

    var key = e.key;
    var isDown = (key === 'ArrowDown' || key === 'j');
    var isUp = (key === 'ArrowUp' || key === 'k');
    var isEnter = (key === 'Enter');

    // j/k only when a row already has focus (so they don't fight global typing).
    if ((key === 'j' || key === 'k') && !withinCanvas) return;
    // Arrow keys: act only when focus is on a row OR we already have a tracked row
    // in this view; otherwise leave them for the page/scroll.
    if ((key === 'ArrowDown' || key === 'ArrowUp') && !withinCanvas && curIdx < 0) return;

    if (isDown) {
      e.preventDefault();
      setRowFocus((curIdx < 0 ? -1 : curIdx) + 1, true);
    } else if (isUp) {
      e.preventDefault();
      setRowFocus((curIdx < 0 ? rows.length : curIdx) - 1, true);
    } else if (isEnter && withinCanvas && curIdx >= 0) {
      e.preventDefault();
      var row = rows[curIdx];
      if (row && typeof row.click === 'function') row.click();
    }
  }

  function initRowNav() {
    // Re-scan rows for the freshly-rendered view.
    clearRowFocus();
    _rowState.rows = getCanvasRows();
    _rowState.index = -1;
    // Make each navigable row focusable + advertise it as a button.
    for (var i = 0; i < _rowState.rows.length; i++) {
      var r = _rowState.rows[i];
      if (!r.hasAttribute('tabindex')) r.setAttribute('tabindex', '-1');
      if (!r.hasAttribute('role')) r.setAttribute('role', 'button');
    }
    var canvas = document.getElementById('canvas');
    if (canvas && !_rowState.keyed) {
      _rowState.keyed = true;
      // Scoped to the canvas subtree (rows live here) — not a global listener.
      canvas.addEventListener('keydown', onCanvasRowKeydown);
      // Clicking a row should also sync the focus ring to it.
      canvas.addEventListener('focusin', function (e) {
        var row = e.target && e.target.closest ? e.target.closest('tr[data-action]') : null;
        if (row && _rowState.rows.indexOf(row) !== -1) {
          setRowFocus(_rowState.rows.indexOf(row), false);
        }
      });
    }
  }

  /* ======================================================================
     afterRender — re-init per-view widgets (sidenav roving + row nav)
     (ENH_CONTRACT §1 pattern; debounced; initial pass on load)
     ====================================================================== */
  function afterRender(fn) {
    var canvas = document.getElementById('canvas');
    if (!canvas) { fn(); return; }
    var t;
    var run = function () { clearTimeout(t); t = setTimeout(fn, 0); };
    new MutationObserver(run).observe(canvas, { childList: true, subtree: false });
    fn(); // initial pass for the already-rendered view
  }

  function onAfterRender() {
    // The active nav item changes per view → re-point the roving tab stop.
    syncNavRoving();
    // Rebuild row navigation for the new view's table(s).
    initRowNav();
  }

  /* ======================================================================
     STYLES — one prefixed <style>, token-driven, focus-visible outlines
     ====================================================================== */
  function installStyles() {
    if (document.getElementById('a11y-styles')) return;
    var css = [
      /* Skip link — visually hidden until focused */
      '.a11y-skip{position:fixed;top:-200px;left:8px;z-index:9000;',
        'background:var(--bg-2);color:var(--text-0);font-family:var(--sans);',
        'font-size:13px;font-weight:600;padding:10px 16px;border-radius:8px;',
        'border:1px solid var(--accent);text-decoration:none;',
        'box-shadow:0 8px 28px rgba(0,0,0,.5);transition:top .12s ease;}',
      '.a11y-skip:focus{top:8px;outline:none;}',

      /* Visible focus-visible outlines (keyboard only) — accent ring */
      '.btn:focus-visible,.nav-item:focus-visible,.card-action:focus-visible,',
        '.chip:focus-visible,.origin-pill:focus-visible,.filter-select:focus-visible,',
        '.drawer-close:focus-visible{outline:2px solid var(--accent);outline-offset:2px;',
        'border-radius:6px;}',

      /* Sidenav roving item keyboard focus */
      '.nav-item:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;}',

      /* Table-row keyboard focus ring + the moving "focus" highlight */
      '#canvas tr[data-action]:focus-visible{outline:2px solid var(--accent);',
        'outline-offset:-2px;}',
      '#canvas tr.a11y-row-focus{box-shadow:inset 3px 0 0 0 var(--accent);',
        'background:var(--bg-2);}',
      '#canvas tr.a11y-row-focus td{color:var(--text-0);}',

      /* Dialog containers: give a focusable outline only on keyboard focus */
      '.modal-card:focus-visible,.drawer:focus-visible{outline:none;}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'a11y-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ======================================================================
     INSTALL (top-level on load)
     ====================================================================== */
  installStyles();
  installSkipLink();
  installDialogA11y();
  installSidenavNav();
  afterRender(onAfterRender);
})();
