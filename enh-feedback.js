/* ============================================================================
   CACAO/FP — enh-feedback.js  (Enhancement #21 — loading / empty / error states
   + drill breadcrumb)

   Self-installing module, loaded after the first/second/third/fourth-wave
   enhancements and before enh-routing. Adds polish WITHOUT editing app.js /
   views2.js / actions.js / styles.css. Uses ONLY the documented hook patterns
   (ENH_CONTRACT §1 afterRender canvas observer; document-level listeners that
   respect e.defaultPrevented; one prefixed <style>; reads contract globals with
   typeof guards but never reassigns switchView / toast / etc.).

   Four pieces — all fb-* prefixed:

   (A) EMPTY STATES — for every table.table in #canvas whose tbody has zero
       *visible* data rows (respecting the display:none that enh-tables' search
       toggles), inject a tasteful empty-state row ("No rows match the current
       filter" + a "Reset filters" .btn-sm data-action="reset-filters"). Removed
       automatically once rows reappear. Re-runs on every render (filter changes
       already re-render) and after enh-tables' search input toggles row display.

   (B) SYNC / LOADING SHIM — a subtle top-of-canvas progress shimmer shown when a
       [data-action="refresh"] or "run-forecast" control is clicked (document
       click listener), auto-hidden after ~1.6s. Purely cosmetic — it never
       blocks input or intercepts the real action handler.

   (C) DRILL BREADCRUMB — a lightweight .fb-breadcrumb strip prepended to #canvas
       after each render: the current view's friendly name, plus the open
       drawer's title appended as a crumb (observed on #drawer-root). A "‹ Back"
       control returns to the previous view from a small view-level history stack
       (built by READING CURRENT_VIEW on each render — never writing the hash, so
       it doesn't fight enh-routing).

   (D) ERROR NOTE — after render, if #canvas is empty / whitespace when a view
       was expected, show an inline "This module failed to render — Reload" card.

   Idempotent (window.__cacaoFeedbackInstalled guard); localStorage-free; zero
   console errors. Wrapped in an IIFE; installs at top level on load.

   Globals consumed (never redefined): CURRENT_VIEW, VIEWS, switchView, toast.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- Idempotency: never install twice -------------------------------- */
  if (window.__cacaoFeedbackInstalled) return;
  window.__cacaoFeedbackInstalled = true;

  /* ---- Constants ------------------------------------------------------- */
  var LOADING_MS = 1600;               // (B) auto-hide the shimmer after ~1.6s
  var MAX_HISTORY = 24;                // (C) cap the view-history stack
  var LOADING_ACTIONS = { 'refresh': 1, 'run-forecast': 1 }; // (B) trigger verbs

  /* Friendly fallback names (DOM nav-text wins when present). Mirrors the
     sidenav labels in index.html so the breadcrumb reads naturally even before
     the nav has been queried. */
  var VIEW_NAMES = {
    dashboard:     'Dashboard',
    market:        'Market Desk',
    contracts:     'Physical Contracts',
    ppv:           'PPV Analysis',
    hedge:         'Hedge Book',
    inventory:     'Inventory Valuation',
    forecast:      'Forecast & Planning',
    close:         'Month-End Close',
    sox:           'SOX & Controls',
    whatif:        'What-If Calculator',
    eudr:          'EUDR & Traceability',
    cashflow:      'Cash Flow / Treasury',
    versions:      'Forecast Versions',
    effectiveness: 'Hedge Effectiveness',
    investigator:  'Variance Investigator',
    exports:       'Exports & Mobile'
  };

  /* View-level history stack (most recent last). Updated by syncHistory() which
     READS CURRENT_VIEW after every render. Never persisted, never touches the
     hash. */
  var _history = [];

  /* ---- tiny helpers ---------------------------------------------------- */
  function canvasEl() { return document.getElementById('canvas'); }

  function currentView() {
    return (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW) ? String(CURRENT_VIEW) : '';
  }

  function safeToast(opts) {
    try { if (typeof toast === 'function') toast(opts); } catch (e) {}
  }

  /* Resolve a view's friendly name: prefer the live sidenav label, fall back to
     the static map, then a Title-cased version of the raw key. */
  function friendlyName(view) {
    if (!view) return '';
    try {
      var nav = document.querySelector('.nav-item[data-view="' + cssEscape(view) + '"]');
      if (nav) {
        var txt = nav.querySelector('.nav-text');
        var label = txt ? (txt.textContent || '').trim() : (nav.textContent || '').trim();
        if (label) return label;
      }
    } catch (e) { /* fall through to static map */ }
    if (VIEW_NAMES[view]) return VIEW_NAMES[view];
    return view.charAt(0).toUpperCase() + view.slice(1);
  }

  /* Minimal CSS.escape shim for attribute selectors (view keys are simple
     identifiers, but be defensive). */
  function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      try { return window.CSS.escape(s); } catch (e) {}
    }
    return String(s).replace(/["\\\]]/g, '\\$&');
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ====================================================================== *
     afterRender — run fn after EVERY canvas render (ENH_CONTRACT §1)
     Debounced + an initial pass for the already-rendered view.
     ====================================================================== */
  function afterRender(fn) {
    var canvas = canvasEl();
    if (!canvas) { try { fn(); } catch (e) {} return; }
    var t;
    var run = function () { clearTimeout(t); t = setTimeout(fn, 0); };
    try {
      new MutationObserver(run).observe(canvas, { childList: true, subtree: false });
    } catch (e) { /* observer unavailable — initial pass still runs below */ }
    try { fn(); } catch (e) {}
  }

  /* ====================================================================== *
     (C) DRILL BREADCRUMB — view history + current drawer crumb
     ====================================================================== */

  /* Push the current view onto the history stack (skip consecutive dupes; cap
     length). Pure read of CURRENT_VIEW — never writes routing state. */
  function syncHistory() {
    var v = currentView();
    if (!v) return;
    if (_history.length === 0 || _history[_history.length - 1] !== v) {
      _history.push(v);
      if (_history.length > MAX_HISTORY) _history.shift();
    }
  }

  /* The view we'd return to with "‹ Back": the most recent entry that differs
     from the current view. Returns null when there's no distinct previous view. */
  function previousView() {
    var cur = currentView();
    for (var i = _history.length - 2; i >= 0; i--) {
      if (_history[i] && _history[i] !== cur) return _history[i];
    }
    return null;
  }

  /* Read the open drawer's title (if a drawer is currently mounted). */
  function openDrawerTitle() {
    try {
      var root = document.getElementById('drawer-root');
      if (!root) return '';
      var el = root.querySelector('.drawer-title');
      return el ? (el.textContent || '').trim() : '';
    } catch (e) { return ''; }
  }

  /* Build the breadcrumb markup for the current view (+ optional drawer crumb). */
  function breadcrumbHtml() {
    var cur = currentView();
    var prev = previousView();
    var drawerTitle = openDrawerTitle();

    var crumbs = '';
    if (prev) {
      crumbs +=
        '<button type="button" class="fb-bc-back" data-fb-back="1" ' +
          'title="Back to ' + escHtml(friendlyName(prev)) + '">‹ Back</button>';
    }
    crumbs += '<span class="fb-bc-home" title="Workspace">Workspace</span>';
    crumbs += '<span class="fb-bc-sep">/</span>';
    crumbs += '<span class="fb-bc-crumb fb-bc-current">' + escHtml(friendlyName(cur)) + '</span>';

    if (drawerTitle) {
      crumbs += '<span class="fb-bc-sep">/</span>';
      crumbs += '<span class="fb-bc-crumb fb-bc-drawer">' + escHtml(drawerTitle) + '</span>';
    }
    return crumbs;
  }

  /* Insert / refresh the .fb-breadcrumb strip at the very top of #canvas. It is
     rebuilt (not duplicated) on every render and whenever the drawer changes. */
  function renderBreadcrumb() {
    var canvas = canvasEl();
    if (!canvas) return;

    // If the view failed to render (handled separately by (D)), don't add a
    // lonely breadcrumb above an error card — keep it, it still aids orientation.
    var bar = canvas.querySelector(':scope > .fb-breadcrumb');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'fb-breadcrumb';
      // Prepend so it sits above the view-head.
      canvas.insertBefore(bar, canvas.firstChild);
    }
    var html = breadcrumbHtml();
    if (bar.innerHTML !== html) bar.innerHTML = html;
  }

  /* Delegated click for the breadcrumb "‹ Back" control. Additive document
     listener; respects e.defaultPrevented and never stops other handlers. */
  function onBackClick(e) {
    if (e.defaultPrevented) return;
    var btn = e.target && e.target.closest ? e.target.closest('[data-fb-back]') : null;
    if (!btn) return;
    var prev = previousView();
    if (!prev) return;
    if (typeof VIEWS === 'object' && VIEWS && !VIEWS[prev]) return; // gone? bail
    e.preventDefault();

    // Returning to `prev` means: drop the current view AND the prev entry so the
    // upcoming switchView re-push lands cleanly (avoids ping-pong duplicates).
    var cur = currentView();
    while (_history.length && _history[_history.length - 1] === cur) _history.pop();
    while (_history.length && _history[_history.length - 1] === prev) _history.pop();

    if (typeof switchView === 'function') {
      try { switchView(prev); } catch (err) { /* non-fatal */ }
    }
  }

  /* Observe #drawer-root so the breadcrumb gains/loses its drawer crumb as
     drawers open and close (the drawer is rendered by actions.js, not us). */
  function observeDrawer() {
    var root = document.getElementById('drawer-root');
    if (!root) return;
    var t;
    try {
      new MutationObserver(function () {
        clearTimeout(t);
        t = setTimeout(renderBreadcrumb, 0);
      }).observe(root, { childList: true, subtree: false });
    } catch (e) { /* observer unavailable — non-fatal */ }
  }

  /* ====================================================================== *
     (A) EMPTY STATES — per-table "no rows" placeholder
     ====================================================================== */

  /* Count this table's column span so the empty cell stretches the full width.
     Prefer the last header row; fall back to the widest body row. */
  function columnCount(table) {
    var n = 0;
    try {
      if (table.tHead && table.tHead.rows.length) {
        var hr = table.tHead.rows[table.tHead.rows.length - 1];
        for (var i = 0; i < hr.cells.length; i++) {
          n += hr.cells[i].colSpan || 1;
        }
      }
    } catch (e) {}
    if (!n) {
      try {
        var tb = table.tBodies && table.tBodies[0];
        if (tb) {
          for (var r = 0; r < tb.rows.length; r++) {
            var rr = tb.rows[r];
            if (rr.dataset && rr.dataset.fbEmpty === '1') continue;
            var c = 0;
            for (var k = 0; k < rr.cells.length; k++) c += rr.cells[k].colSpan || 1;
            if (c > n) n = c;
          }
        }
      } catch (e2) {}
    }
    return n || 1;
  }

  /* Real, visible data rows = rows with cells, not our own empty-state row, and
     not currently display:none (enh-tables search hides non-matches this way). */
  function visibleDataRowCount(tbody) {
    var n = 0;
    for (var i = 0; i < tbody.rows.length; i++) {
      var r = tbody.rows[i];
      if (!r.cells || r.cells.length === 0) continue;          // spacer
      if (r.dataset && r.dataset.fbEmpty === '1') continue;    // our placeholder
      // getComputedStyle is overkill per-row; inline display:none is what the
      // search filter sets, which is the only hiding mechanism in play.
      if (r.style && r.style.display === 'none') continue;
      n++;
    }
    return n;
  }

  function removeEmptyRow(tbody) {
    var existing = tbody.querySelector('tr[data-fb-empty="1"]');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function ensureEmptyRow(table) {
    if (!table) return;
    var tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return;

    var visible = visibleDataRowCount(tbody);
    if (visible > 0) {
      removeEmptyRow(tbody);
      return;
    }

    // Already showing our placeholder? Leave it (idempotent).
    if (tbody.querySelector('tr[data-fb-empty="1"]')) return;

    var span = columnCount(table);
    var tr = document.createElement('tr');
    tr.dataset.fbEmpty = '1';
    tr.className = 'fb-empty-row';
    tr.innerHTML =
      '<td class="fb-empty-cell" colspan="' + span + '">' +
        '<div class="fb-empty">' +
          '<div class="fb-empty-ico" aria-hidden="true">⌀</div>' +
          '<div class="fb-empty-text">No rows match the current filter.</div>' +
          '<button type="button" class="btn btn-sm fb-empty-reset" ' +
            'data-action="reset-filters">Reset filters</button>' +
        '</div>' +
      '</td>';
    tbody.appendChild(tr);
  }

  /* Apply / refresh empty states for every table in the canvas. */
  function refreshEmptyStates() {
    var canvas = canvasEl();
    if (!canvas) return;
    var tables = canvas.querySelectorAll('table.table');
    for (var i = 0; i < tables.length; i++) {
      try { ensureEmptyRow(tables[i]); } catch (e) { /* skip bad table */ }
    }
  }

  /* enh-tables' search toggles row display:none on `input` WITHOUT re-rendering
     #canvas, so the afterRender observer won't fire. Listen for input on the
     canvas (capture-free, bubbling) and re-evaluate empty states then. */
  function onCanvasInput(e) {
    var t = e.target;
    if (!t || !t.classList) return;
    // enh-tables search box is .pt-search; be tolerant of any input in canvas.
    if (t.tagName !== 'INPUT') return;
    // Defer so the filter's own input handler (which sets display) runs first.
    setTimeout(refreshEmptyStates, 0);
  }

  /* ====================================================================== *
     (B) SYNC / LOADING SHIM — cosmetic top-of-canvas shimmer
     ====================================================================== */

  var _loadingTimer = null;

  function ensureLoadingBar() {
    var canvas = canvasEl();
    if (!canvas) return null;
    var bar = canvas.querySelector(':scope > .fb-loading');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'fb-loading';
      bar.setAttribute('aria-hidden', 'true');
      bar.innerHTML = '<div class="fb-loading-shimmer"></div>';
      // Insert just under the breadcrumb if present, else at the very top.
      var bc = canvas.querySelector(':scope > .fb-breadcrumb');
      if (bc && bc.nextSibling) canvas.insertBefore(bar, bc.nextSibling);
      else if (bc) canvas.appendChild(bar);
      else canvas.insertBefore(bar, canvas.firstChild);
    }
    return bar;
  }

  function showLoading() {
    var bar = ensureLoadingBar();
    if (!bar) return;
    bar.classList.add('fb-loading-on');
    if (_loadingTimer) clearTimeout(_loadingTimer);
    _loadingTimer = setTimeout(hideLoading, LOADING_MS);
  }

  function hideLoading() {
    if (_loadingTimer) { clearTimeout(_loadingTimer); _loadingTimer = null; }
    var canvas = canvasEl();
    if (!canvas) return;
    var bar = canvas.querySelector(':scope > .fb-loading');
    if (bar) bar.classList.remove('fb-loading-on');
  }

  /* Document click listener: show the shimmer when Sync / Run-Forecast is
     clicked. Purely additive — we do NOT preventDefault or stop the real
     ACTIONS handler; we just observe the click and animate. */
  function onDocClick(e) {
    if (e.defaultPrevented) return; // someone already consumed it — still fine,
                                    // but avoid reacting to handled non-trigger
                                    // clicks; the trigger check below is precise.
    var el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var action = el.getAttribute('data-action');
    if (LOADING_ACTIONS[action]) {
      // Don't block anything; the dispatcher (also a document listener) still
      // runs its handler. Just trigger the cosmetic shimmer.
      showLoading();
    }
  }

  /* ====================================================================== *
     (D) ERROR NOTE — inline "failed to render" card when canvas is empty
     ====================================================================== */

  /* Is the canvas effectively empty (ignoring our own injected chrome)? */
  function canvasIsEmpty(canvas) {
    var kids = canvas.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.classList && (
            c.classList.contains('fb-breadcrumb') ||
            c.classList.contains('fb-loading') ||
            c.classList.contains('fb-error'))) {
        continue; // our own injected elements don't count as content
      }
      return false; // found real view content
    }
    // No real children — also treat pure-whitespace text as empty.
    return (canvas.textContent || '').trim() === '';
  }

  function removeErrorCard(canvas) {
    var card = canvas.querySelector(':scope > .fb-error');
    if (card && card.parentNode) card.parentNode.removeChild(card);
  }

  function renderErrorIfEmpty() {
    var canvas = canvasEl();
    if (!canvas) return;

    // Only flag an error when a real view was expected. On the very first paint
    // CURRENT_VIEW may be set but the view genuinely empty (shouldn't happen for
    // the seeded app) — guard on a known view existing.
    var view = currentView();
    var viewKnown = (typeof VIEWS === 'object' && VIEWS && view && VIEWS[view]);

    if (!viewKnown || !canvasIsEmpty(canvas)) {
      removeErrorCard(canvas);
      return;
    }
    if (canvas.querySelector(':scope > .fb-error')) return; // already shown

    var card = document.createElement('div');
    card.className = 'fb-error';
    card.innerHTML =
      '<div class="card fb-error-card">' +
        '<div class="card-body fb-error-body">' +
          '<div class="fb-error-ico" aria-hidden="true">⚠</div>' +
          '<div class="fb-error-text">' +
            '<div class="fb-error-title">This module failed to render.</div>' +
            '<div class="fb-error-sub">The “' + escHtml(friendlyName(view)) +
              '” view returned no content. Reload to try again.</div>' +
          '</div>' +
          '<button type="button" class="btn btn-sm fb-error-reload" data-fb-reload="1">' +
            'Reload</button>' +
        '</div>' +
      '</div>';
    // Append after the breadcrumb so orientation is preserved.
    canvas.appendChild(card);
  }

  /* Delegated click for the error-card "Reload" button: re-run switchView for
     the current view (cheap, no hash write). Additive; respects defaultPrevented. */
  function onReloadClick(e) {
    if (e.defaultPrevented) return;
    var btn = e.target && e.target.closest ? e.target.closest('[data-fb-reload]') : null;
    if (!btn) return;
    e.preventDefault();
    var view = currentView();
    if (typeof switchView === 'function' &&
        typeof VIEWS === 'object' && VIEWS && view && VIEWS[view]) {
      try { switchView(view); } catch (err) { /* non-fatal */ }
    } else {
      try { location.reload(); } catch (err2) {}
    }
  }

  /* ====================================================================== *
     Combined per-render pass
     ====================================================================== */
  function onRender() {
    // Order matters: history first (so the breadcrumb's "previous" is correct),
    // then breadcrumb, then empty states, then the error check (which ignores
    // our own injected chrome when deciding "empty").
    syncHistory();
    renderBreadcrumb();
    refreshEmptyStates();
    renderErrorIfEmpty();
  }

  /* ====================================================================== *
     Styles — ONE <style>, all classes prefixed fb-, tokens only
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById('fb-styles')) return;
    var css = [
      /* ---- (C) breadcrumb ------------------------------------------------ */
      '.fb-breadcrumb{display:flex;align-items:center;flex-wrap:wrap;gap:8px;' +
        'margin:0 0 14px 0;font-family:var(--sans);font-size:12px;color:var(--text-2);' +
        'min-height:22px;}',
      '.fb-bc-back{font-family:var(--sans);font-size:11px;font-weight:600;' +
        'color:var(--text-1);background:var(--bg-2);border:1px solid var(--line-2);' +
        'border-radius:6px;padding:3px 9px;cursor:pointer;line-height:1.4;' +
        'transition:background .12s ease,border-color .12s ease,color .12s ease;}',
      '.fb-bc-back:hover{background:var(--bg-3);border-color:var(--line-3);' +
        'color:var(--text-0);}',
      '.fb-bc-back:active{background:var(--bg-4);}',
      '.fb-bc-home{color:var(--text-3);font-weight:500;}',
      '.fb-bc-sep{color:var(--text-3);opacity:.7;}',
      '.fb-bc-crumb{color:var(--text-2);}',
      '.fb-bc-current{color:var(--text-1);font-weight:600;}',
      '.fb-bc-drawer{color:var(--accent);font-weight:600;}',

      /* ---- (B) loading shimmer ------------------------------------------- */
      '.fb-loading{height:0;overflow:hidden;margin:0;border-radius:3px;' +
        'background:var(--bg-2);transition:height .18s ease,margin .18s ease,' +
        'opacity .18s ease;opacity:0;}',
      '.fb-loading.fb-loading-on{height:3px;margin:0 0 12px 0;opacity:1;}',
      '.fb-loading-shimmer{height:100%;width:100%;border-radius:3px;' +
        'background:linear-gradient(90deg,' +
          'rgba(201,169,110,0) 0%,' +          /* --accent, transparent edges */
          'rgba(201,169,110,.15) 25%,' +
          'rgba(201,169,110,.85) 50%,' +
          'rgba(201,169,110,.15) 75%,' +
          'rgba(201,169,110,0) 100%);' +
        'background-size:220% 100%;' +
        'animation:fb-shimmer 1.1s linear infinite;}',
      '@keyframes fb-shimmer{0%{background-position:120% 0;}' +
        '100%{background-position:-120% 0;}}',
      '@media (prefers-reduced-motion:reduce){' +
        '.fb-loading-shimmer{animation:none;background:var(--accent);opacity:.6;}}',

      /* ---- (A) empty state row ------------------------------------------- */
      '.fb-empty-cell{padding:26px 16px !important;text-align:center;' +
        'background:var(--bg-1);border-top:1px dashed var(--line-2);}',
      '.fb-empty{display:flex;flex-direction:column;align-items:center;gap:8px;' +
        'font-family:var(--sans);color:var(--text-2);}',
      '.fb-empty-ico{font-size:20px;line-height:1;color:var(--text-3);' +
        'font-family:var(--mono);}',
      '.fb-empty-text{font-size:12.5px;color:var(--text-2);}',
      '.fb-empty-reset{margin-top:2px;}',

      /* ---- (D) error card ------------------------------------------------ */
      '.fb-error{margin-top:14px;}',
      '.fb-error-body{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}',
      '.fb-error-ico{font-size:22px;line-height:1;color:var(--warn);flex:0 0 auto;}',
      '.fb-error-text{flex:1 1 220px;min-width:0;}',
      '.fb-error-title{font-family:var(--sans);font-size:13px;font-weight:600;' +
        'color:var(--text-0);}',
      '.fb-error-sub{font-family:var(--sans);font-size:12px;color:var(--text-2);' +
        'margin-top:3px;}',
      '.fb-error-reload{flex:0 0 auto;}'
    ].join('');

    var style = document.createElement('style');
    style.id = 'fb-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ====================================================================== *
     Install (top-level on load)
     ====================================================================== */
  function install() {
    injectStyles();

    // Document-level listeners (additive; never stopImmediatePropagation):
    //  - click: loading shimmer trigger (B), breadcrumb Back (C), error reload (D)
    document.addEventListener('click', onDocClick, false);
    document.addEventListener('click', onBackClick, false);
    document.addEventListener('click', onReloadClick, false);

    // enh-tables' in-place search hides rows without re-rendering — re-check
    // empty states when an input in the canvas changes.
    var canvas = canvasEl();
    if (canvas) canvas.addEventListener('input', onCanvasInput, false);

    // React to every view render: breadcrumb + empty states + error check.
    afterRender(onRender);

    // React to drawer open/close for the trailing breadcrumb crumb.
    observeDrawer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
