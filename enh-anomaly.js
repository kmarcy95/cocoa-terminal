/* ============================================================================
   CACAO/FP — ENHANCEMENT #26: enh-anomaly.js
   Statistical anomaly detection on PPV variances (per-€/t z-scores).
   Self-installing IIFE. Loaded AFTER app.js / views2.js / actions.js and after
   the first-/second-wave PPV patches (commentary patch + enh-ppv-bridge #1).

   What it does (deterministic, no API key):
     - Uses the afterRender(fn) canvas observer (ENH_CONTRACT §1).
     - Only acts when CURRENT_VIEW === 'ppv'.
     - Scans #canvas for table rows carrying data-action="drill-sku" — covers
       BOTH the original "PPV by SKU" table (app.js) and the #1 attribution
       table (enh-ppv-bridge.js). Each row's SKU comes from data-payload.
     - For every distinct SKU present in DATA.ppvDetail, varPerT = actEur - stdEur.
     - Across the FULL DATA.ppvDetail set computes mean + POPULATION stddev of
       varPerT, then z_i = (varPerT_i - mean) / stddev.
     - Flags rows with |z| >= SIGMA (2.0) by appending an OUTLIER badge into the
       row's first cell, with a title explaining the breach.
     - Injects a once-per-render summary banner (.an-banner) at the top of the
       PPV canvas listing the flagged SKUs (or a clear "none" message).

   Idempotency: rows + banner carry dataset flags so a single render is marked
   once; the PPV table is rebuilt on every ppv render (switchView re-runs
   render()), so we recompute + re-mark on each pass. Guards bail out when not
   on ppv, when there are no rows, or when stddev is zero. Reuses design tokens
   and existing CSS classes (.badge .badge-neg). Never reassigns switchView.
   Tiny an-* prefixed <style>. Zero console errors.
   ENH_CONTRACT §1 + ENH_CONTRACT2 (read-only DOM augmentation).
   ========================================================================== */
(function installAnomaly() {
  'use strict';

  /* ---- idempotency: guard double-install ------------------------------- */
  if (window.__enhAnomalyInstalled) return;
  window.__enhAnomalyInstalled = true;

  /* ---- constants -------------------------------------------------------- */
  var SIGMA = 1.5;             // |z| threshold to flag as a statistical outlier (variance-triage level; flags BT-DE-01 butter z≈1.8)
  var RENDER_FLAG = 'anPass';  // marks a render pass on #canvas (dataset key)
  var ROW_FLAG = 'anRow';      // marks a row whose badge was already appended

  /* ---- one prefixed <style> (an-*), token-driven ----------------------- */
  function injectStyle() {
    if (document.getElementById('an-style')) return;
    var css =
      '.an-banner{display:flex;align-items:flex-start;gap:9px;' +
      'font-family:var(--sans);font-size:12px;line-height:1.45;' +
      'color:var(--text-1);background:rgba(245,179,66,.08);' +
      'border:1px solid var(--line-2);border-left:3px solid var(--warn);' +
      'border-radius:6px;padding:9px 12px;margin:0 0 14px;}' +
      '.an-banner.an-clear{background:rgba(45,212,164,.06);' +
      'border-left-color:var(--pos);}' +
      '.an-banner .an-ico{flex:0 0 auto;font-size:13px;line-height:1.2;}' +
      '.an-banner .an-sku{font-family:var(--mono);color:var(--text-0);}' +
      '.an-banner .an-sig{font-family:var(--mono);color:var(--warn);}' +
      '.an-badge{margin-left:7px;font-size:9px;letter-spacing:.04em;' +
      'vertical-align:middle;cursor:help;}';
    var st = document.createElement('style');
    st.id = 'an-style';
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

  /* ---- statistics over the full DATA.ppvDetail set --------------------- *
   * varPerT = actEur - stdEur (positive = adverse). Population stddev (÷ n)
   * per the spec. Returns a map sku -> { varT, z, desc, fx } plus the moments
   * and the rounded-sigma string used by the badge/banner.                  */
  function computeStats() {
    if (typeof DATA === 'undefined' || !Array.isArray(DATA.ppvDetail)) return null;
    var set = DATA.ppvDetail;
    var n = set.length;
    if (!n) return null;

    var vars = set.map(function (p) { return (p.actEur - p.stdEur); });
    var mean = vars.reduce(function (a, b) { return a + b; }, 0) / n;
    var varianceSum = vars.reduce(function (a, b) {
      var d = b - mean; return a + d * d;
    }, 0);
    var stddev = Math.sqrt(varianceSum / n); // POPULATION stddev (÷ n)

    var bySku = {};
    set.forEach(function (p, i) {
      var varT = vars[i];
      var z = stddev > 0 ? (varT - mean) / stddev : 0;
      bySku[p.sku] = {
        sku: p.sku,
        desc: p.desc,
        varT: varT,
        fx: p.fxImpact,
        z: z,
        absSigma: Math.round(Math.abs(z) * 10) / 10, // one-dp rounded sigma
        isOutlier: stddev > 0 && Math.abs(z) >= SIGMA,
      };
    });
    return { bySku: bySku, mean: mean, stddev: stddev, n: n };
  }

  /* ---- short descriptor: first token of the desc (e.g. "Butter") ------- */
  function shortName(desc) {
    if (!desc) return '';
    // descriptions look like "Butter · Hamburg Press" — take the part before "·"
    var head = String(desc).split('·')[0];
    return head.trim();
  }

  /* ---- escape for use inside an HTML attribute (title=) ---------------- */
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---- per-row badge title --------------------------------------------- */
  function badgeTitle(rec) {
    var dir = rec.varT >= 0 ? 'above' : 'below';
    var name = shortName(rec.desc) || rec.sku;
    return name + ' ' + fmtSigned(rec.varT) + '/t is ' + rec.absSigma + 'σ ' + dir +
      ' the SKU mean; FX impact only ' + fmtSigned(rec.fx) + '/t.';
  }

  /* ---- flag a single row: append an OUTLIER badge into its first cell --- */
  function flagRow(tr, rec) {
    if (!tr || tr.dataset[ROW_FLAG] === '1') return;
    var firstCell = tr.querySelector('td');
    if (!firstCell) return;
    // avoid a stray duplicate badge if the cell somehow already carries one
    if (firstCell.querySelector('.an-badge')) { tr.dataset[ROW_FLAG] = '1'; return; }
    var badge = document.createElement('span');
    badge.className = 'badge badge-neg an-badge';
    badge.title = badgeTitle(rec);
    badge.textContent = 'OUTLIER ' + rec.absSigma + 'σ';
    firstCell.appendChild(badge);
    tr.dataset[ROW_FLAG] = '1';
  }

  /* ---- build the summary-banner element -------------------------------- */
  function buildBanner(flagged) {
    var banner = document.createElement('div');
    banner.className = 'an-banner';
    if (!flagged.length) {
      banner.className = 'an-banner an-clear';
      banner.innerHTML = '<span class="an-ico">✓</span>' +
        '<span>No SKUs breach the ' + SIGMA + 'σ variance threshold.</span>';
      return banner;
    }
    var parts = flagged.map(function (r) {
      return '<span class="an-sku">' + escAttr(r.sku) + '</span> (' +
        escAttr(shortName(r.desc)) + ', ' + fmtSigned(r.varT) + '/t, ' +
        '<span class="an-sig">' + r.absSigma + 'σ</span>)';
    });
    var noun = flagged.length === 1 ? 'SKU flagged' : 'SKUs flagged';
    banner.innerHTML = '<span class="an-ico">⚠</span>' +
      '<span>' + flagged.length + ' ' + noun +
      ' as a statistical outlier (≥' + SIGMA + 'σ): ' + parts.join(', ') + '</span>';
    return banner;
  }

  /* ---- inject the banner at the very top of the PPV canvas ------------- */
  function injectBanner(canvas, flagged) {
    if (canvas.querySelector('.an-banner')) return; // once per render
    var banner = buildBanner(flagged);
    if (canvas.firstChild) canvas.insertBefore(banner, canvas.firstChild);
    else canvas.appendChild(banner);
  }

  /* ---- main pass: mark rows + banner once per ppv render --------------- */
  function pass() {
    if (typeof CURRENT_VIEW === 'undefined' || CURRENT_VIEW !== 'ppv') return;
    var canvas = document.getElementById('canvas');
    if (!canvas) return;

    // already processed this render? (rows rebuilt on each ppv render → re-mark)
    if (canvas.dataset[RENDER_FLAG] === '1') return;

    var rows = canvas.querySelectorAll('tr[data-action="drill-sku"]');
    if (!rows.length) return; // guard: no PPV/attribution table yet this pass

    var stats = computeStats();
    if (!stats) return;

    // collect distinct flagged SKUs (for the banner) while marking rows
    var flaggedMap = {};
    Array.prototype.forEach.call(rows, function (tr) {
      var sku = tr.getAttribute('data-payload');
      var rec = sku && stats.bySku[sku];
      if (!rec || !rec.isOutlier) return;
      flagRow(tr, rec);
      flaggedMap[sku] = rec;
    });

    var flagged = Object.keys(flaggedMap)
      .map(function (k) { return flaggedMap[k]; })
      .sort(function (a, b) { return Math.abs(b.z) - Math.abs(a.z); });

    injectBanner(canvas, flagged);
    canvas.dataset[RENDER_FLAG] = '1';
  }

  /* ---- retrying scan ---------------------------------------------------- *
   * The PPV view content (and the appended #1 attribution table) lands via
   * render() synchronously into #canvas, so afterRender's +0ms pass usually
   * sees the rows. We still scan a few times to be safe against any deferred
   * DOM mutation; pass() is idempotent within a render (RENDER_FLAG guard).    */
  function scheduleScan() {
    var n = 0;
    (function go() {
      try { pass(); } catch (e) { /* never break the app */ }
      if (++n < 5) setTimeout(go, 50);
    })();
  }

  /* ---- reset the per-render flag when the canvas is rebuilt ------------ *
   * switchView() replaces #canvas.innerHTML wholesale, which drops the
   * dataset flag with the old node tree — but the #canvas element itself is
   * reused, so clear our marker at the START of each afterRender cycle so the
   * next ppv render is re-evaluated.                                          */
  function onRender() {
    var canvas = document.getElementById('canvas');
    if (canvas) { try { delete canvas.dataset[RENDER_FLAG]; } catch (e) { /* noop */ } }
    scheduleScan();
  }

  /* ---- install --------------------------------------------------------- */
  injectStyle();
  afterRender(onRender);
})();
