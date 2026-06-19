/* ============================================================================
   CACAO/FP — enh-crossfilter.js  (#17 — cross-filter from chart clicks)
   Second-wave enhancement module. Pattern C (ENH_CONTRACT2 §C).

   Wires onClick handlers onto view charts (read from the global `_charts` map
   after each render) whose segment labels map cleanly to a real global FILTERS
   key. Clicking a segment sets that filter, persists it, repaints the filter
   bar + current view, and toasts. Today only the Dashboard "Spend by Origin"
   donut (`c-origin`) qualifies — its labels are origin CODES that map back to
   DATA.filterTaxonomy.origins (CIV/GHA/ECU/CMR/NGA/DOM). A generic
   matchTaxonomy(key,label) helper keeps it extensible without wiring charts
   (value-by-form, aging, time-series) whose labels are NOT filter values.

   Self-installs at top-level on load. Does NOT edit other files, does NOT
   redefine existing globals, and NEVER reassigns switchView (only calls it).
   ========================================================================== */
(function () {
  'use strict';

  /* ---- idempotency: guard double-install ------------------------------- */
  if (window.__enhCrossfilterInstalled) return;
  window.__enhCrossfilterInstalled = true;

  /* ---- one prefixed <style> (xf-*), token-driven ----------------------- */
  function injectStyle() {
    if (document.getElementById('xf-style')) return;
    var css =
      '.xf-caption{font-family:var(--sans);font-size:10px;line-height:1.4;' +
      'color:var(--text-2);margin-top:6px;text-align:center;' +
      'letter-spacing:.02em;display:flex;align-items:center;justify-content:center;gap:5px;}' +
      '.xf-caption .xf-dot{width:5px;height:5px;border-radius:50%;background:var(--accent);' +
      'display:inline-block;flex:0 0 auto;}' +
      '.xf-clickable canvas{cursor:pointer;}';
    var st = document.createElement('style');
    st.id = 'xf-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---- afterRender observer (ENH_CONTRACT §1) -------------------------- */
  function afterRender(fn) {
    var canvas = document.getElementById('canvas');
    if (!canvas) { try { fn(); } catch (e) { /* noop */ } return; }
    var t;
    var run = function () { clearTimeout(t); t = setTimeout(fn, 0); };
    try {
      new MutationObserver(run).observe(canvas, { childList: true, subtree: false });
    } catch (e) { /* noop */ }
    try { fn(); } catch (e) { /* noop */ } // initial pass for the already-rendered view
  }

  /* ---- taxonomy mapping: label (code or name) → valid filter value ----- *
   * Returns the canonical taxonomy value for `key`, or null when the label
   * does not map to a real filter value (so callers skip wiring/applying).  */
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

  function matchTaxonomy(key, label) {
    if (typeof DATA === 'undefined' || !DATA.filterTaxonomy) return null;
    var list = DATA.filterTaxonomy[key + 's']; // origin -> origins, supplier -> suppliers, sku -> skus
    if (!Array.isArray(list)) return null;
    var nl = norm(label);
    if (!nl) return null;

    // 1) direct case-insensitive match against a taxonomy value (skip "All …")
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (/^all\b/i.test(v)) continue;
      if (norm(v) === nl) return v;
    }

    // 2) origin-specific: the donut may label by code OR display name; map the
    //    clicked label back to the origin CODE that exists in the taxonomy.
    if (key === 'origin' && Array.isArray(DATA.originSpend)) {
      for (var j = 0; j < DATA.originSpend.length; j++) {
        var o = DATA.originSpend[j];
        if (norm(o.code) === nl || norm(o.name) === nl) {
          // confirm the resolved code is a real taxonomy value
          for (var k = 0; k < list.length; k++) {
            if (norm(list[k]) === norm(o.code)) return list[k];
          }
        }
      }
    }
    return null;
  }

  /* ---- charts we may wire: chartId -> { filterKey } -------------------- *
   * Only charts whose segment labels are real filter values. c-invform
   * (forms) / c-invage (aging) / c-spot / c-curve / c-forecast / c-hedge are
   * intentionally NOT here — their labels are not filter values.            */
  var WIRABLE = { 'c-origin': 'origin' };

  function applyCrossfilter(key, value) {
    if (!value) return;
    if (typeof FILTERS === 'undefined' || typeof switchView !== 'function') return;
    FILTERS[key] = value;
    if (typeof saveFilters === 'function') { try { saveFilters(FILTERS); } catch (e) { /* noop */ } }
    if (typeof renderFilterBar === 'function') { try { renderFilterBar(); } catch (e) { /* noop */ } }
    try { switchView(CURRENT_VIEW); } catch (e) { /* noop */ }
    if (typeof toast === 'function') {
      try { toast({ type: 'info', title: 'Cross-filtered', body: key + ' → ' + value }); }
      catch (e) { /* noop */ }
    }
  }

  function wireChart(c, filterKey) {
    if (!c || c.__xfWired) return;
    c.__xfWired = true;

    // affordance: cursor pointer over the canvas
    try {
      if (c.canvas && c.canvas.parentElement) c.canvas.parentElement.classList.add('xf-clickable');
    } catch (e) { /* noop */ }

    c.options = c.options || {};
    c.options.onClick = function (evt, els) {
      if (!els || !els.length) return;
      var idx = els[0].index;
      var labels = (c.data && c.data.labels) || [];
      var label = labels[idx];
      var value = matchTaxonomy(filterKey, label);
      if (value) applyCrossfilter(filterKey, value);
    };
    try { c.update(); } catch (e) { /* noop */ }
  }

  /* ---- inject a one-time caption under a wired chart's card ------------- */
  function ensureCaption(c) {
    try {
      var canvas = c && c.canvas;
      if (!canvas) return;
      // walk up to the enclosing card (fall back to chart-wrap parent)
      var card = canvas.closest ? canvas.closest('.card') : null;
      var host = card || (canvas.parentElement && canvas.parentElement.parentElement);
      if (!host) return;
      if (host.querySelector('.xf-caption')) return; // already added this render
      var cap = document.createElement('div');
      cap.className = 'xf-caption';
      cap.innerHTML = '<span class="xf-dot"></span>click a segment to filter';
      // place inside the card body next to the chart if possible
      var body = host.querySelector ? host.querySelector('.card-body') : null;
      (body || host).appendChild(cap);
    } catch (e) { /* noop */ }
  }

  /* ---- main pass: re-wire after each view switch (charts are recreated) - */
  function pass() {
    if (typeof Chart === 'undefined') return;          // Chart.js absent → skip
    if (typeof _charts === 'undefined' || !_charts) return; // chart registry absent → skip
    for (var id in WIRABLE) {
      if (!Object.prototype.hasOwnProperty.call(WIRABLE, id)) continue;
      var c = _charts[id];
      if (!c) continue;
      wireChart(c, WIRABLE[id]);
      ensureCaption(c);
    }
  }

  /* ---- retrying scan ---------------------------------------------------- *
   * Charts are created in the view's draw() at setTimeout(30) — AFTER the
   * canvas mutation that triggers afterRender — so a single pass() at +0ms
   * misses them. Scan a few times; wireChart is idempotent (__xfWired).      */
  function scheduleScan() {
    var n = 0;
    (function go() { pass(); if (++n < 6) setTimeout(go, 50); })();
  }

  /* ---- install --------------------------------------------------------- */
  injectStyle();
  afterRender(scheduleScan);
})();
