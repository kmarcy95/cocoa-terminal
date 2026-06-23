/* ============================================================================
   CACAO/FP — ENHANCEMENT: enh-supplier-scorecard.js
   EUDR & Traceability — composite supplier scorecard.

   Self-installing IIFE. Loaded AFTER app.js / views2.js / actions.js and after
   the other enh-* modules. It compose-wraps VIEWS.eudr.render and APPENDS one
   "Supplier Scorecard" .card below all existing EUDR content (every prior
   wrapper's output is preserved — other modules may already have wrapped this
   render; we keep theirs intact). Never reassigns switchView (calling it is
   allowed). Idempotent; localStorage-free; zero console errors.
   ENH_CONTRACT2 pattern A.

   LEXICAL-CONST TRAP obeyed: VIEWS / DATA / CURRENT_VIEW are top-level const/let
   in app.js — NOT window properties. They are referenced BARE with typeof
   guards; window.VIEWS / window.DATA are never used. switchView/toast called bare.

   --- Composite scoring model (documented; ties to the rendered card) --------
   For each DATA.eudr.bySupplier row {supplier, origin, geoPct, dds, cert, risk,
   lastAudit} we cross-reference DATA.contracts (match by supplier name) to size
   contracted MT and an MT-weighted price differential. We compute five
   sub-scores (0–100) and a weighted composite:

     • Geo coverage   = geoPct                                   (weight 30%)
     • Risk           = 100 − risk                               (weight 25%)
     • Certification  = cert !== '—' ? 100 : 40                  (weight 20%)
     • DDS status     = SUBMITTED→100 / DRAFT→55 / NONE→10       (weight 15%)
     • Price compet.  = relative to the peer-mean differential   (weight 10%)
                        from DATA.contracts (lower diff = better, mapped to
                        0–100 around the peer mean); 60 if the supplier has no
                        contract row.

   composite = Σ(sub × weight), rounded to a whole number.
   Grade:  ≥80 → A (pos) · 60–79 → B (warn) · <60 → C (neg).

   Price mapping detail: diff is an origin/quality premium in €/t — LOWER is
   cheaper, hence "better". We anchor on the peer mean of MT-weighted supplier
   diffs and spread by the peer max absolute deviation so the field uses the full
   0–100 range without a single outlier flattening everyone. A supplier priced at
   the peer mean scores 60; cheaper than the mean trends toward 100, dearer
   toward 0. No-contract suppliers are neutral at 60 (no price signal).
   ========================================================================== */
(function installSupplierScorecard() {
  'use strict';

  // --- Idempotency guard (double-install safe) -----------------------------
  if (window.__cacaoSupplierScorecardInstalled) return;
  window.__cacaoSupplierScorecardInstalled = true;

  // --- Constants -------------------------------------------------------------
  var W = { geo: 0.30, risk: 0.25, cert: 0.20, dds: 0.15, price: 0.10 };
  var DDS_SCORE = { SUBMITTED: 100, DRAFT: 55, NONE: 10 };
  var CERT_NONE = '—';          // em-dash used as "no cert" sentinel in data
  var CERT_HIT = 100, CERT_MISS = 40;
  var PRICE_NEUTRAL = 60;            // no-contract suppliers (no price signal)
  var GRADE_A = 80, GRADE_B = 60;    // composite thresholds
  var AT_RISK_NAMES = ['Telcar Cocoa', 'Tulip Cocoa']; // named in the brief callout

  // --- Safe global accessors (bare refs, typeof-guarded) ---------------------
  function getSuppliers() {
    if (typeof DATA === 'undefined' || !DATA.eudr || !Array.isArray(DATA.eudr.bySupplier)) return [];
    return DATA.eudr.bySupplier;
  }
  function getContracts() {
    if (typeof DATA === 'undefined' || !Array.isArray(DATA.contracts)) return [];
    return DATA.contracts;
  }

  // --- HTML escaper: reuse the global `attr` (views2.js) when present ---------
  function esc(v) {
    if (typeof attr === 'function') return attr(v);
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- Formatters: reuse globals, with tiny fallbacks (never throw) ----------
  function int0(n) { return typeof fmtInt === 'function' ? fmtInt(n) : String(Math.round(n)); }
  function num0(n) { return typeof fmtNum === 'function' ? fmtNum(Math.round(n), 0) : String(Math.round(n)); }
  function pct0(n) { return typeof fmtPct === 'function' ? fmtPct(n, 0) : (Math.round(n) + '%'); }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // --- Cross-reference contracts → per-supplier MT + MT-weighted diff --------
  function contractStats() {
    var byName = {};
    getContracts().forEach(function (c) {
      var name = c.supplier;
      if (!byName[name]) byName[name] = { mt: 0, weightedDiff: 0 };
      var mt = Number(c.mt) || 0;
      var diff = Number(c.diff) || 0;
      byName[name].mt += mt;
      byName[name].weightedDiff += diff * mt;
    });
    Object.keys(byName).forEach(function (name) {
      var s = byName[name];
      s.avgDiff = s.mt > 0 ? s.weightedDiff / s.mt : null;
    });
    return byName;
  }

  /**
   * Price sub-score (0–100). Anchored on the peer mean of supplier MT-weighted
   * diffs; spread by the peer max absolute deviation. Cheaper than the mean →
   * higher score; dearer → lower. No contract → PRICE_NEUTRAL.
   */
  function priceScorer(stats, suppliers) {
    var diffs = [];
    suppliers.forEach(function (s) {
      var cs = stats[s.supplier];
      if (cs && cs.avgDiff != null) diffs.push(cs.avgDiff);
    });
    if (!diffs.length) {
      return function () { return PRICE_NEUTRAL; };
    }
    var mean = diffs.reduce(function (a, b) { return a + b; }, 0) / diffs.length;
    var maxDev = diffs.reduce(function (m, d) { return Math.max(m, Math.abs(d - mean)); }, 0);
    if (maxDev <= 0) {
      // All peers identical → everyone with a contract sits at neutral.
      return function (avgDiff) { return avgDiff == null ? PRICE_NEUTRAL : PRICE_NEUTRAL; };
    }
    return function (avgDiff) {
      if (avgDiff == null) return PRICE_NEUTRAL;
      // (mean - diff)/maxDev ∈ [-1, 1] → scale ±40 around the 60 anchor.
      var rel = clamp((mean - avgDiff) / maxDev, -1, 1);
      return clamp(PRICE_NEUTRAL + rel * 40, 0, 100);
    };
  }

  // --- Build the scored model -----------------------------------------------
  function buildModel() {
    var suppliers = getSuppliers();
    var stats = contractStats();
    var scorePrice = priceScorer(stats, suppliers);

    var rows = suppliers.map(function (s) {
      var cs = stats[s.supplier] || null;
      var contractedMt = cs ? cs.mt : 0;
      var avgDiff = cs ? cs.avgDiff : null;

      var geoSub = clamp(Number(s.geoPct) || 0, 0, 100);
      var riskSub = clamp(100 - (Number(s.risk) || 0), 0, 100);
      var certSub = (s.cert && s.cert !== CERT_NONE && s.cert !== '-') ? CERT_HIT : CERT_MISS;
      var ddsKey = DDS_SCORE.hasOwnProperty(s.dds) ? s.dds : 'NONE';
      var ddsSub = DDS_SCORE[ddsKey];
      var priceSub = scorePrice(avgDiff);

      var composite = Math.round(
        geoSub * W.geo + riskSub * W.risk + certSub * W.cert +
        ddsSub * W.dds + priceSub * W.price
      );
      var grade = composite >= GRADE_A ? 'A' : composite >= GRADE_B ? 'B' : 'C';
      var gradeCls = grade === 'A' ? 'pos' : grade === 'B' ? 'warn' : 'neg';
      var compCls = composite >= GRADE_A ? 'pos' : composite >= GRADE_B ? 'warn' : 'neg';

      return {
        supplier: s.supplier, origin: s.origin, geoPct: Number(s.geoPct) || 0,
        dds: ddsKey, cert: s.cert, risk: Number(s.risk) || 0,
        contractedMt: contractedMt, avgDiff: avgDiff,
        geoSub: geoSub, riskSub: riskSub, certSub: certSub, ddsSub: ddsSub, priceSub: priceSub,
        composite: composite, grade: grade, gradeCls: gradeCls, compCls: compCls,
      };
    });

    // Sort by composite descending (stable tiebreak on supplier name).
    rows.sort(function (a, b) {
      if (b.composite !== a.composite) return b.composite - a.composite;
      return a.supplier < b.supplier ? -1 : a.supplier > b.supplier ? 1 : 0;
    });

    var totalMt = rows.reduce(function (acc, r) { return acc + r.contractedMt; }, 0);
    var aCount = rows.filter(function (r) { return r.grade === 'A'; }).length;
    var atRiskCount = rows.filter(function (r) { return r.composite < GRADE_B; }).length;

    // Weighted-avg score: weight by contracted MT where available; if NO supplier
    // has contracts, fall back to a simple mean so the stat is never NaN.
    var wAvg;
    if (totalMt > 0) {
      wAvg = rows.reduce(function (acc, r) { return acc + r.composite * r.contractedMt; }, 0) / totalMt;
    } else {
      wAvg = rows.length ? rows.reduce(function (acc, r) { return acc + r.composite; }, 0) / rows.length : 0;
    }

    return {
      rows: rows, totals: {
        suppliers: rows.length, aCount: aCount, atRiskCount: atRiskCount,
        wAvg: Math.round(wAvg), totalMt: totalMt,
      },
    };
  }

  // --- Header strip (reuse .qstat-grid) --------------------------------------
  function headerStrip(t) {
    var aCls = t.aCount > 0 ? 'pos' : 'muted';
    var arCls = t.atRiskCount > 0 ? 'neg' : 'pos';
    var avgCls = t.wAvg >= GRADE_A ? 'pos' : t.wAvg >= GRADE_B ? 'warn' : 'neg';
    return '<div class="qstat-grid ss-strip">' +
      '<div class="qstat"><div class="qstat-label">Suppliers</div>' +
        '<div class="qstat-value mono">' + int0(t.suppliers) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">A-Rated</div>' +
        '<div class="qstat-value mono ' + aCls + '">' + int0(t.aCount) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">At-Risk (&lt;60)</div>' +
        '<div class="qstat-value mono ' + arCls + '">' + int0(t.atRiskCount) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">Weighted Avg</div>' +
        '<div class="qstat-value mono ' + avgCls + '">' + int0(t.wAvg) + '</div></div>' +
      '</div>';
  }

  // --- A scored table row ----------------------------------------------------
  function tableRow(r) {
    var ddsCls = r.dds === 'SUBMITTED' ? 'pos' : r.dds === 'DRAFT' ? 'warn' : 'neg';
    var certHas = r.cert && r.cert !== CERT_NONE && r.cert !== '-';
    var certPillCls = certHas ? '' : ' ss-cert-none';
    var riskCls = r.risk > 40 ? 'neg' : 'pos';
    var geoW = clamp(r.geoPct, 0, 100);
    var mtCell = r.contractedMt > 0 ? num0(r.contractedMt) : '<span class="ss-nomt">no contract</span>';

    // Row is drillable into the existing supplier drawer (reuses drill-supplier).
    return '<tr class="row-click" data-action="drill-supplier" data-payload="' + esc(r.supplier) + '">' +
      '<td class="cell-strong">' + esc(r.supplier) + '</td>' +
      '<td class="mono">' + esc(r.origin) + '</td>' +
      '<td class="num mono">' + mtCell + '</td>' +
      '<td class="ss-geo-cell">' +
        '<div class="ss-geo">' +
          '<div class="bar-h"><div class="bar-h-fill" style="width:' + geoW + '%"></div></div>' +
          '<span class="mono ss-geo-v">' + pct0(r.geoPct) + '</span>' +
        '</div></td>' +
      '<td><span class="pill' + certPillCls + '">' + esc(certHas ? r.cert : '—') + '</span></td>' +
      '<td><span class="badge badge-' + ddsCls + '">' + esc(r.dds) + '</span></td>' +
      '<td class="num mono ' + riskCls + '">' + int0(r.risk) + '</td>' +
      '<td class="num">' +
        '<span class="ss-comp mono ' + r.compCls + '">' + int0(r.composite) + '</span>' +
        '<span class="badge badge-' + r.gradeCls + ' ss-grade">' + r.grade + '</span>' +
      '</td>' +
      '</tr>';
  }

  function scoredTable(rows) {
    var body = rows.map(tableRow).join('');
    return '<div class="table-wrap"><table class="table ss-table">' +
      '<thead><tr>' +
        '<th>Supplier</th><th>Origin</th><th class="th-num">Contracted MT</th>' +
        '<th>Geo Coverage</th><th>Cert</th><th>DDS</th><th class="th-num">Risk</th>' +
        '<th class="th-num">Composite</th>' +
      '</tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>';
  }

  // --- Callout: top performer + the named at-risk suppliers + lift action ----
  function calloutHtml(model) {
    var rows = model.rows;
    if (!rows.length) return '';
    var top = rows[0];

    // At-risk: those named in the brief (Telcar / Tulip) that exist in the model,
    // falling back to any composite < GRADE_B if the named ones are absent.
    var named = rows.filter(function (r) { return AT_RISK_NAMES.indexOf(r.supplier) !== -1; });
    var atRisk = named.length ? named : rows.filter(function (r) { return r.composite < GRADE_B; });

    var topLine =
      '<div class="ss-call-row ss-call-top">' +
        '<span class="dot dot-pos"></span>' +
        '<span class="ss-call-k">Top performer</span>' +
        '<span class="cell-strong">' + esc(top.supplier) + '</span>' +
        '<span class="muted">' + esc(top.origin) + ' · composite ' + int0(top.composite) +
          ' · grade ' + esc(top.grade) + '</span>' +
      '</div>';

    var riskLines = atRisk.map(function (r) {
      // The single dimension that, lifted to 100, would raise the composite most
      // is the one with the largest weighted shortfall: (100 − sub) × weight.
      var lift = biggestLift(r);
      return '<div class="ss-call-row">' +
        '<span class="dot dot-neg"></span>' +
        '<span class="ss-call-k">At-risk</span>' +
        '<span class="cell-strong">' + esc(r.supplier) + '</span>' +
        '<span class="muted">' + esc(r.origin) + ' · composite ' + int0(r.composite) + '</span>' +
        '<span class="ss-lift">lift: ' + esc(lift.label) +
          ' <span class="mono pos">+' + int0(lift.gain) + '</span></span>' +
        '<button class="btn btn-sm btn-danger" data-action="submit-dds" data-payload="' +
          esc(r.supplier) + '">Submit DDS</button>' +
      '</div>';
    }).join('');

    return '<div class="ss-callout">' + topLine + riskLines + '</div>';
  }

  /**
   * The dimension whose improvement to 100 lifts the composite most:
   * argmax over dimensions of (100 − sub) × weight. Returns {label, gain}.
   */
  function biggestLift(r) {
    var dims = [
      { key: 'geo',   label: 'Geo coverage',  sub: r.geoSub,   w: W.geo },
      { key: 'risk',  label: 'Risk mitigation', sub: r.riskSub, w: W.risk },
      { key: 'cert',  label: 'Certification', sub: r.certSub,  w: W.cert },
      { key: 'dds',   label: 'DDS submission', sub: r.ddsSub,  w: W.dds },
      { key: 'price', label: 'Price terms',   sub: r.priceSub, w: W.price },
    ];
    var best = dims[0], bestGain = -Infinity;
    dims.forEach(function (d) {
      var gain = (100 - d.sub) * d.w;
      if (gain > bestGain) { bestGain = gain; best = d; }
    });
    return { label: best.label, gain: Math.round(bestGain) };
  }

  // --- The appended card -----------------------------------------------------
  function scorecardCard() {
    var model = buildModel();
    if (!model.rows.length) return '';

    var sub =
      'Composite = Geo&nbsp;30% · Risk&nbsp;25% · Cert&nbsp;20% · DDS&nbsp;15% · Price&nbsp;10%. ' +
      'Sub-scores 0–100; grade A&nbsp;≥80 · B&nbsp;60–79 · C&nbsp;&lt;60. ' +
      'Contracted MT &amp; price terms cross-referenced from the contract register; ' +
      'sorted by composite. Click a row to drill the supplier.';

    return '<div class="card ss-card" id="ss-scorecard">' +
      '<div class="card-head">' +
        '<div class="card-title">Supplier Scorecard</div>' +
        '<div class="card-sub">' + sub + '</div>' +
      '</div>' +
      '<div class="card-body">' +
        headerStrip(model.totals) +
        calloutHtml(model) +
        scoredTable(model.rows) +
      '</div>' +
    '</div>';
  }

  // --- Styles: token-driven, module-prefixed (ss-) ---------------------------
  function injectStyles() {
    if (document.getElementById('ss-scorecard-styles')) return;
    var css =
      '.ss-card .ss-strip{margin-bottom:14px;}' +
      '.ss-callout{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;' +
        'background:var(--bg-2);border:1px solid var(--line);border-radius:8px;padding:12px 14px;}' +
      '.ss-call-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;}' +
      '.ss-call-top{padding-bottom:8px;border-bottom:1px solid var(--line);margin-bottom:2px;}' +
      '.ss-call-k{font-family:var(--sans);font-size:10px;font-weight:700;letter-spacing:.06em;' +
        'text-transform:uppercase;color:var(--text-2);}' +
      '.ss-call-row .muted{color:var(--text-2);}' +
      '.ss-lift{margin-left:auto;font-size:11px;color:var(--text-2);font-family:var(--sans);}' +
      '.ss-lift .mono{font-size:12px;}' +
      '.ss-call-row .btn-sm{flex:0 0 auto;}' +
      '.ss-call-top .ss-lift{margin-left:auto;}' +
      '.ss-geo{display:flex;align-items:center;gap:8px;min-width:120px;}' +
      '.ss-geo .bar-h{flex:1 1 auto;min-width:54px;}' +
      '.ss-geo-v{font-size:11px;color:var(--text-1);flex:0 0 auto;width:34px;text-align:right;}' +
      '.ss-geo-cell{min-width:140px;}' +
      '.ss-cert-none{color:var(--text-3);border-color:var(--line-2);}' +
      '.ss-nomt{font-family:var(--sans);font-size:10px;color:var(--text-3);font-style:italic;}' +
      '.ss-comp{font-size:16px;font-weight:700;}' +
      '.ss-grade{margin-left:8px;vertical-align:middle;}' +
      '.ss-table td .pill{font-size:10px;}' +
      '@media (max-width:920px){.ss-lift{margin-left:0;}.ss-call-row .btn-sm{margin-left:auto;}}';
    var style = document.createElement('style');
    style.id = 'ss-scorecard-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Compose-wrap VIEWS.eudr.render (pattern A) ----------------------------
  function wrapEudrRender() {
    if (typeof VIEWS === 'undefined' || !VIEWS.eudr ||
        typeof VIEWS.eudr.render !== 'function') return false;
    if (VIEWS.eudr.render.__ssWrapped) return true; // already composed by us
    var prior = VIEWS.eudr.render; // may already be wrapped by other modules — fine
    var wrapped = function () {
      var out = prior(); // keep ALL prior EUDR output intact
      try {
        return out + scorecardCard();
      } catch (err) {
        return out; // fail soft — never break the view
      }
    };
    wrapped.__ssWrapped = true;
    VIEWS.eudr.render = wrapped;
    return true;
  }

  // --- Install ---------------------------------------------------------------
  injectStyles();
  if (wrapEudrRender()) {
    if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'eudr' &&
        typeof switchView === 'function') {
      switchView('eudr');
    }
  }
})();
