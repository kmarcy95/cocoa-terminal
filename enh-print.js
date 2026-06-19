/* ============================================================================
   CACAO/FP — enh-print.js  (#22 — Print / Board-Pack stylesheet)
   ----------------------------------------------------------------------------
   Self-installing enhancement module. Loaded AFTER app.js / views2.js /
   actions.js and the other enh-* modules (see index.html load order).

   What it does:
     • Injects ONE module-prefixed <style id="print-styles"> whose @media print
       block re-themes the dark terminal to a clean, board-ready, light-on-white
       print of the ACTIVE module (whatever #canvas currently renders).
     • Hides all chrome + injected controls when printing (topbar, filter bar,
       sidenav, FAB, activity rail, overlays, and the enh-* affordances).
     • Expands the layout (block flow, visible overflow) so the full canvas
       prints, not just the on-screen viewport.
     • Adds a "⎙ Print" button to .topbar-actions (idempotent, prepended) wired
       to data-action="print-view", and registers ACTIONS['print-view'].

   HARD-RULE compliance:
     • Plain JS IIFE, installs at top level on load. Edits no other file.
     • References VIEWS / ACTIONS / CURRENT_VIEW BARE with typeof guards
       (they are const/let — NOT on window). Never reassigns switchView.
     • No charts touched (canvases print as raster images natively).
     • localStorage not needed here; nothing persisted (no try/catch required).
     • Idempotent: guards on the <style> id and the button class.
   ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'print-styles';
  var BTN_CLASS = 'pr-print-btn';
  var ACTION_NAME = 'print-view';

  /* -----------------------------------------------------------------------
     1) The print stylesheet.
     -----------------------------------------------------------------------
     The terminal colours everything through CSS custom properties (var(--bg-*),
     var(--text-*), var(--line*), etc. — see CONTRACT §6). The cleanest way to
     re-theme the WHOLE active view for print — KPIs, tables, waterfalls, pills,
     badges, qstat values — is to OVERRIDE those tokens inside @media print:root.
     Every element that reads a token re-themes automatically, so we only need a
     few targeted rules on top (background reset, card borders, page breaks).

     Screen styling is untouched: nothing here applies outside @media print, so
     the live dark UI is unaffected. We keep the small .pr-* screen rules for the
     topbar button only (and a no-print marker class for safety). */
  function buildCss() {
    return [
      /* ---- screen: the topbar "Print" button (token-driven, matches chrome) */
      '.' + BTN_CLASS + '{display:inline-flex;align-items:center;gap:6px;}',
      '.pr-print-ico{font-family:var(--mono);font-size:13px;line-height:1;}',
      /* generic opt-out marker any future element can carry */
      '@media screen{.pr-print-only{display:none !important;}}',

      /* ===================================================================
         PRINT — re-theme to clean light-on-white board pack
         =================================================================== */
      '@media print{',

      /* -- token override: flip the dark palette to a light one ----------- */
      '  :root{',
      '    --bg-0:#fff; --bg-1:#fff; --bg-2:#f5f5f5; --bg-3:#eee; --bg-4:#e8e8e8;',
      '    --text-0:#111; --text-1:#333; --text-2:#555; --text-3:#777;',
      '    --line:#ddd; --line-2:#ccc; --line-3:#bbb;',
      '  }',

      /* -- base canvas: white page, dark ink ------------------------------ */
      '  html,body{background:#fff !important;color:#111 !important;}',
      '  body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}',

      /* -- hide chrome + overlays + injected controls --------------------- */
      '  .topbar,.filter-bar,.sidenav,.fab,.activity-rail,',
      '  .toast-stack,.modal-root,.drawer-root,',
      '  .ck-affordance,.ck-overlay,.sv-wrap,.rt-copy,.xf-caption,',
      '  .' + BTN_CLASS + ',.pr-print-only{',
      '    display:none !important;',
      '  }',

      /* -- expand the layout so the full canvas flows onto paper ---------- */
      '  .shell{display:block !important;}',
      '  .canvas{overflow:visible !important;height:auto !important;',
      '    max-height:none !important;padding:0 !important;margin:0 !important;}',

      /* -- cards: drop shadow/glow, keep a light hairline border ---------- */
      '  .card{box-shadow:none !important;border:1px solid #ddd !important;',
      '    background:#fff !important;}',
      '  .card-head{background:#f5f5f5 !important;}',

      /* -- keep grids multi-column on paper (don't collapse to 1) --------- */
      '  .grid-2,.grid-3,.grid-4,.grid-2-1,.grid-1-2{display:grid;}',

      /* -- charts are <canvas> → raster images; keep them on the page ----- */
      '  .chart-wrap{break-inside:avoid;page-break-inside:avoid;}',
      '  canvas{max-width:100% !important;}',

      /* -- avoid splitting key blocks across pages ------------------------ */
      '  .card,.table,.waterfall,.qstat-grid{',
      '    break-inside:avoid;page-break-inside:avoid;',
      '  }',
      '  .view-head{break-after:avoid;page-break-after:avoid;}',
      '  tr,.kv,.tl-item{break-inside:avoid;page-break-inside:avoid;}',

      /* -- table ink: light header, ruled rows (tokens cover most of it) -- */
      '  .table th{background:#f0f0f0 !important;}',
      '  .table,.table th,.table td{border-color:#ddd !important;}',

      /* -- printed page geometry ------------------------------------------ */
      '  @page{margin:14mm;}',

      '}'  /* end @media print */
    ].join('');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return; // idempotent
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = buildCss();
    document.head.appendChild(style);
  }

  /* -----------------------------------------------------------------------
     2) The topbar "Print" button (idempotent, prepended).
     ----------------------------------------------------------------------- */
  function injectButton() {
    var bar = document.querySelector('.topbar-actions');
    if (!bar) return;
    if (bar.querySelector('.' + BTN_CLASS)) return; // already injected
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost ' + BTN_CLASS;
    btn.title = 'Print the current module (board pack)';
    btn.setAttribute('aria-label', 'Print current module');
    btn.setAttribute('data-action', ACTION_NAME);
    btn.innerHTML = '<span class="pr-print-ico">⎙</span> Print';
    bar.insertBefore(btn, bar.firstChild); // prepend
  }

  /* -----------------------------------------------------------------------
     3) The action verb. ACTIONS is a bare const map in actions.js (NOT on
        window) — reference it bare, guarded. The universal dispatcher reads
        ACTIONS per click, so registering here is enough; this also makes
        "print-view" discoverable to any cmdk indexer that scans ACTIONS.
     ----------------------------------------------------------------------- */
  function registerAction() {
    if (typeof ACTIONS === 'undefined' || !ACTIONS) return;
    ACTIONS[ACTION_NAME] = function () {
      // Toast is best-effort: don't block printing if it isn't available.
      try {
        if (typeof toast === 'function') {
          var label = '';
          try {
            if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW) {
              label = String(CURRENT_VIEW);
            }
          } catch (e) { /* CURRENT_VIEW not reachable — fine */ }
          toast({
            type: 'info',
            title: 'Print',
            body: label ? ('Preparing board-pack print of “' + label + '”…')
                        : 'Preparing board-pack print…'
          });
        }
      } catch (e) { /* never let a toast failure stop the print */ }
      window.print();
    };
  }

  /* -----------------------------------------------------------------------
     INSTALL (top-level on load).
     ----------------------------------------------------------------------- */
  function install() {
    injectStyle();
    injectButton();
    registerAction();
  }

  install();
})();
