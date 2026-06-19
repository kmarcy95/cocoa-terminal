/* ============================================================================
   CACAO/FP — enh-theme.js  (#18 light theme + density toggle)

   Self-installing enhancement module. Loaded AFTER all other enh-*.js modules.
   Adds two topbar toggles, no edits to any other file:

     (A) LIGHT THEME — a "◐ Theme" button flips body.theme-light. An injected
         <style> redefines the :root design tokens (--bg-*, --line*, --text-*)
         to a clean "paper" palette UNDER body.theme-light, so the entire app
         re-themes automatically (every surface reads var(--…)). Chart.js global
         defaults are repointed and the current view is redrawn so charts re-theme
         too. Persisted in cacao_theme (light|dark) and re-applied on load.

     (B) DENSITY — a "⊟ Density" button flips body.density-compact, tightening
         table/kpi/card padding, base font-size and hero-kpi gap via the same
         <style>. Persisted in cacao_density (compact|comfortable).

   CONTRACT NOTES (obeyed):
     • Plain IIFE, installs at top level. Idempotent (window.__cacaoThemeInstalled).
     • Injects ONE module-prefixed <style id="th-styles">; helper classes are th-*.
       The token overrides target :root values under body.theme-light — allowed
       (we are not editing styles.css; we only raise specificity via body.<class>).
     • localStorage wrapped in try/catch, keys prefixed cacao_.
     • VIEWS / ACTIONS / DATA / CURRENT_VIEW / _charts are lexical consts in the
       app — NOT on window. Referenced BARE with typeof guards; never window.*.
     • switchView/toast are bare function declarations — CALLED (allowed), never
       reassigned. The topbar is re-observed so the buttons survive re-renders.
     • Coexists with cmdk (Ctrl/Cmd-K) + brief (Escape): no global keydown here.
     • Browser runtime only (document / localStorage / Chart). Zero console errors.
   ========================================================================== */

(function () {
  'use strict';

  if (window.__cacaoThemeInstalled) return;
  window.__cacaoThemeInstalled = true;

  /* ---- constants -------------------------------------------------------- */
  var STYLE_ID    = 'th-styles';
  var THEME_KEY   = 'cacao_theme';      // 'light' | 'dark'
  var DENSITY_KEY = 'cacao_density';    // 'compact' | 'comfortable'
  var THEME_BTN   = 'th-toggle';        // marker class on the theme button
  var DENSITY_BTN = 'th-density';       // marker class on the density button
  var LIGHT_CLASS = 'theme-light';
  var DENSE_CLASS = 'density-compact';

  /* -----------------------------------------------------------------------
     1) localStorage helpers — defensive (private mode / quota / disabled).
     ----------------------------------------------------------------------- */
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* ignore */ }
  }

  function isLight()   { return lsGet(THEME_KEY) === 'light'; }
  function isCompact() { return lsGet(DENSITY_KEY) === 'compact'; }

  /* -----------------------------------------------------------------------
     2) The injected <style>.
        (A) body.theme-light overrides the :root tokens with a paper palette.
            body.<class> beats :root on specificity, and because <body> is an
            ancestor of every node the app paints, the overridden custom
            properties cascade to all var(--…) consumers automatically.
            --accent/--pos/--neg/--warn/--info are kept (just --accent darkened
            slightly for contrast on white; status dims re-tuned for light bg).
        (B) body.density-compact tightens spacing + base font.
     ----------------------------------------------------------------------- */
  function buildCss() {
    return [
      /* ====================== (A) LIGHT "PAPER" THEME ====================== */
      'body.' + LIGHT_CLASS + '{',
      /* Backgrounds — ascending elevation, paper-white stack */
      '  --bg-0:#f7f7fa;',   /* app canvas / deepest */
      '  --bg-1:#ffffff;',   /* cards, chrome surfaces */
      '  --bg-2:#f1f2f5;',   /* card headers, nested panels, inputs */
      '  --bg-3:#e9ebf0;',   /* hover, tracks, raised inputs */
      '  --bg-4:#dfe2e8;',   /* highest — device bezels, swatches */
      /* Lines / borders — ascending contrast on white */
      '  --line:#e2e5ea;',
      '  --line-2:#d4d8df;',
      '  --line-3:#c4c9d2;',
      /* Text — descending emphasis, dark ink */
      '  --text-0:#1a1d24;',
      '  --text-1:#3a4150;',
      '  --text-2:#5a6477;',
      '  --text-3:#8893a5;',
      /* Accent — darken cocoa-gold slightly so it reads on white */
      '  --accent:#a9874a;',
      '  --accent-2:#8b6f3f;',
      '  --accent-dim:#caa86a;',
      /* Keep status hues; re-tune the dim companions for a light surface */
      '  --pos:#0f9d76;',
      '  --pos-dim:#c8efe2;',
      '  --neg:#e0394b;',
      '  --neg-dim:#fbd8dd;',
      '  --warn:#cf8a14;',
      '  --info:#1f7fe0;',
      '  --purple:#7c5cdc;',
      '}',

      /* Page chrome that reads body bg directly still flips via the token. */
      'body.' + LIGHT_CLASS + '{background:var(--bg-0);color:var(--text-0);}',

      /* Soften the heavy dark drop-shadows so cards don't look bruised on white. */
      'body.' + LIGHT_CLASS + ' .kpi:hover,',
      'body.' + LIGHT_CLASS + ' .card:hover{',
      '  box-shadow:0 6px 18px rgba(20,28,45,0.10);',
      '}',
      'body.' + LIGHT_CLASS + ' .modal-card,',
      'body.' + LIGHT_CLASS + ' .drawer{',
      '  box-shadow:0 18px 50px rgba(20,28,45,0.22);',
      '}',
      /* Scrims read as ink wash on a light page, not a black void. */
      'body.' + LIGHT_CLASS + ' .modal-scrim,',
      'body.' + LIGHT_CLASS + ' .drawer-scrim{',
      '  background:rgba(26,29,36,0.34);',
      '}',

      /* The theme button glyph fills when light mode is active. */
      'body.' + LIGHT_CLASS + ' .' + THEME_BTN + ' .th-ico{color:var(--accent);}',

      /* ====================== (B) COMPACT DENSITY ========================= */
      /* Base font −1px (13px → 12px); tighten the major rhythm surfaces. */
      'body.' + DENSE_CLASS + '{font-size:12px;}',
      'body.' + DENSE_CLASS + ' .table td{padding:5px 9px;}',
      'body.' + DENSE_CLASS + ' .table th{padding:5px 9px;}',
      'body.' + DENSE_CLASS + ' .kpi{padding:9px 11px;}',
      'body.' + DENSE_CLASS + ' .card-body{padding:11px;}',
      'body.' + DENSE_CLASS + ' .hero-kpis{gap:9px;margin-bottom:11px;}',
      'body.' + DENSE_CLASS + ' .card-head{padding-top:9px;padding-bottom:9px;}',
      /* Active-state pip on the density button. */
      'body.' + DENSE_CLASS + ' .' + DENSITY_BTN + ' .th-ico{color:var(--accent);}'
    ].join('\n');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return; // idempotent
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = buildCss();
    (document.head || document.documentElement).appendChild(style);
  }

  /* -----------------------------------------------------------------------
     3) Chart.js re-theming. styles.css bakes the dark chart palette into the
        chart-option helpers (grid #161e2a, ticks #7a8597), so flipping CSS
        tokens alone won't re-color canvases. We repoint the GLOBAL Chart
        defaults, then redraw the current view so its draw() picks them up.
        We own Chart.defaults (no other module touches it).
     ----------------------------------------------------------------------- */
  function applyChartTheme(light) {
    if (typeof Chart === 'undefined' || !Chart || !Chart.defaults) return;
    var d = Chart.defaults;
    if (light) {
      d.color = '#3a4150';                 // default text (ticks/legend)
      d.borderColor = '#d4d8df';           // default element borders
    } else {
      d.color = '#b8c2d1';                 // styles.css legend label color
      d.borderColor = '#1f2937';           // styles.css --line
    }
    // Grid lines live under defaults.scale.grid (Chart.js 4.x).
    try {
      if (d.scale && d.scale.grid) {
        d.scale.grid.color = light ? '#e2e5ea' : '#161e2a';
      }
    } catch (e) { /* shape differs — non-fatal */ }
    // Some 4.x builds also expose elements line/point border colors.
    try { if (d.scale && d.scale.ticks) d.scale.ticks.color = light ? '#5a6477' : '#7a8597'; }
    catch (e) { /* non-fatal */ }
  }

  /* Redraw the current view so charts rebuild with the new defaults. The app
     draws charts in a setTimeout(30) after render, so a single switchView is
     enough; we guard the bare reference and never reassign switchView. */
  function redrawCurrentView() {
    if (typeof switchView !== 'function') return;
    var view = 'dashboard';
    try { if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW) view = CURRENT_VIEW; }
    catch (e) { /* CURRENT_VIEW unreachable — fall back to dashboard */ }
    try { switchView(view); } catch (e) { /* never let a redraw crash the toggle */ }
  }

  /* -----------------------------------------------------------------------
     4) Apply persisted state to <body> (no chart work here — see toggles).
        Called on load + defensively whenever we sync.
     ----------------------------------------------------------------------- */
  function applyBodyState() {
    var body = document.body;
    if (!body) return;
    body.classList.toggle(LIGHT_CLASS, isLight());
    body.classList.toggle(DENSE_CLASS, isCompact());
    syncButtons();
  }

  /* -----------------------------------------------------------------------
     5) Toggles.
     ----------------------------------------------------------------------- */
  function toggleTheme() {
    var light = !isLight();
    lsSet(THEME_KEY, light ? 'light' : 'dark');
    if (document.body) document.body.classList.toggle(LIGHT_CLASS, light);
    applyChartTheme(light);
    redrawCurrentView();   // rebuild charts with the new palette
    syncButtons();
    if (typeof toast === 'function') {
      try {
        toast({
          type: 'info',
          title: 'Theme',
          body: light ? 'Light "paper" theme on.' : 'Dark terminal theme on.'
        });
      } catch (e) { /* toast best-effort */ }
    }
  }

  function toggleDensity() {
    var compact = !isCompact();
    lsSet(DENSITY_KEY, compact ? 'compact' : 'comfortable');
    if (document.body) document.body.classList.toggle(DENSE_CLASS, compact);
    syncButtons();
    if (typeof toast === 'function') {
      try {
        toast({
          type: 'info',
          title: 'Density',
          body: compact ? 'Compact density on.' : 'Comfortable density on.'
        });
      } catch (e) { /* toast best-effort */ }
    }
  }

  /* -----------------------------------------------------------------------
     6) Topbar buttons — prepend two toggles to .topbar-actions, idempotently.
        Re-run on a MutationObserver so they survive any topbar re-render.
     ----------------------------------------------------------------------- */
  function makeButton(markerClass, action, label, title) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost ' + markerClass;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = '<span class="th-ico">' + label.glyph + '</span> ' + label.text;
    btn.addEventListener('click', function (e) {
      if (e && e.defaultPrevented) return;   // coexist with other handlers
      if (e) e.preventDefault();
      action();
    });
    return btn;
  }

  function injectButtons() {
    var bar = document.querySelector('.topbar-actions');
    if (!bar) return;
    // Density first, then Theme prepended before it, so final order is:
    // [◐ Theme] [⊟ Density] … existing buttons.
    if (!bar.querySelector('.' + DENSITY_BTN)) {
      var dBtn = makeButton(
        DENSITY_BTN, 'toggle-density',
        { glyph: '⊟', text: 'Density' },   // ⊟
        'Toggle compact / comfortable density'
      );
      bar.insertBefore(dBtn, bar.firstChild);
    }
    if (!bar.querySelector('.' + THEME_BTN)) {
      var tBtn = makeButton(
        THEME_BTN, 'toggle-theme',
        { glyph: '◐', text: 'Theme' },     // ◐
        'Toggle light / dark theme'
      );
      bar.insertBefore(tBtn, bar.firstChild);
    }
    syncButtons();
  }

  /* Reflect current state on the buttons (pressed styling driven by CSS via
     body.<class>; here we keep aria-pressed truthful for assistive tech). */
  function syncButtons() {
    var t = document.querySelector('.' + THEME_BTN);
    if (t) t.setAttribute('aria-pressed', isLight() ? 'true' : 'false');
    var d = document.querySelector('.' + DENSITY_BTN);
    if (d) d.setAttribute('aria-pressed', isCompact() ? 'true' : 'false');
  }

  /* Keep the buttons present if the topbar gets re-rendered by another module. */
  function watchTopbar() {
    var topbar = document.querySelector('.topbar') || document.body;
    if (!topbar || typeof MutationObserver === 'undefined') return;
    var t;
    var run = function () { clearTimeout(t); t = setTimeout(injectButtons, 0); };
    try {
      new MutationObserver(run).observe(topbar, { childList: true, subtree: true });
    } catch (e) { /* observer unsupported — buttons still injected once */ }
  }

  /* -----------------------------------------------------------------------
     7) Register the action verbs too, so the cmdk palette (which scans
        ACTIONS) can surface "toggle-theme" / "toggle-density". ACTIONS is a
        bare const map in actions.js — reference guarded, never window.ACTIONS.
        Buttons use a direct click listener (above) so they work even if the
        dispatcher hasn't loaded; the ACTIONS entries are a bonus discovery
        path. We use distinct keys so we never clobber an existing verb.
     ----------------------------------------------------------------------- */
  function registerActions() {
    if (typeof ACTIONS === 'undefined' || !ACTIONS) return;
    if (!ACTIONS['toggle-theme'])   ACTIONS['toggle-theme']   = function () { toggleTheme(); };
    if (!ACTIONS['toggle-density']) ACTIONS['toggle-density'] = function () { toggleDensity(); };
  }

  /* -----------------------------------------------------------------------
     INSTALL (top-level on load). Apply persisted theme BEFORE the user sees
     the page, repoint Chart defaults to match, then wire chrome.
     ----------------------------------------------------------------------- */
  function install() {
    injectStyle();
    applyBodyState();                 // land in persisted theme + density
    applyChartTheme(isLight());       // so the first view's charts match
    injectButtons();
    watchTopbar();
    registerActions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
