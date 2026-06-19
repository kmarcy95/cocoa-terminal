/* ============================================================================
   CACAO/FP — enh-market-analytics.js  (#8 Curve / Roll-Yield + Term Structure
   and #9 Basis & Differential Tracker — Market Desk)

   Self-installing enhancement module. Loaded AFTER the first/second-wave
   modules (including enh-ptbf, which already compose-wrapped
   VIEWS.market.render to append its PTBF cockpit). This module compose-wraps
   VIEWS.market.render AGAIN (ENH_CONTRACT2 pattern A) and APPENDS two more
   cards BELOW the existing Market Desk content:

     CARD A — "Curve Analytics — Roll Yield & Term Structure"
       Per adjacent NY expiry pair: calendar spread ($/t) + annualized %
       (spread / near-leg, scaled by 12 / monthsBetween). Verdict on the term
       structure (contango / backwardation / mixed). Roll-cost headline:
       total JUL26→DEC27 carry, net long cocoa lots (CC/LDN longs, FX excluded),
       and an estimated €/qtr carry drag on the open long book.

     CARD B — "Basis & Differentials"
       Transatlantic arb: NY (USD/t) and LDN (GBP/t) converted to a common €/t
       via the live EUR/USD + GBP/USD ticker, with a rich/cheap note. Origin
       differential drift table (dedup from DATA.contracts) with the CIV
       v1→v2→v3 trend from DATA.versionDiff (210→225→240 = richening) and a
       badge on diffs notably above peers.

   Rules honoured: plain JS IIFE, top-level install on load, no edits to other
   files, never reassigns switchView (only CALLS it), ONE module-prefixed
   <style> (ma-*), token-driven (var(--*)), idempotent, localStorage in
   try/catch (nothing persisted here), zero console errors. References the
   bare lexical globals (VIEWS, DATA, CURRENT_VIEW, switchView, formatters)
   with typeof guards — NEVER window.VIEWS / window.DATA (those are undefined).
   ========================================================================== */
(function () {
  'use strict';

  /* --- idempotency: bail if already wired ------------------------------- */
  if (window.__cacaoMarketAnalyticsInstalled) return;

  /* --- module constants -------------------------------------------------- */
  var EURUSD_FALLBACK = 1.085;   // EUR/USD if ticker missing
  var GBPUSD_FALLBACK = 1.272;   // GBP/USD if ticker missing
  var LOT_MT = 10;               // ICE cocoa contract size (10 MT / lot)
  var STEP_MONTHS_FALLBACK = 3;  // ~quarterly spacing fallback for annualizing
  var MONTHS_PER_YEAR = 12;
  // diff is flagged "rich" when notably above the peer mean (mean + this)
  var RICH_OVER_MEAN_USD = 80;

  /* --- safe number ------------------------------------------------------- */
  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  /* --- ticker reads (live, with fallbacks) ------------------------------- */
  function tickerPx(sym, fallback) {
    try {
      var t = (DATA.ticker || []).find(function (x) { return x.sym === sym; });
      return num(t && t.px, fallback) || fallback;
    } catch (e) { return fallback; }
  }
  function getEurUsd() { return tickerPx('EUR/USD', EURUSD_FALLBACK); }
  function getGbpUsd() { return tickerPx('GBP/USD', GBPUSD_FALLBACK); }

  /* --- exec-month label → ordinal (year*12+month) for spacing ------------ */
  var MONTHS = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
  };
  function monthOrdinal(label) {
    if (!label) return null;
    var s = String(label).toUpperCase().trim();
    var mm = MONTHS[s.slice(0, 3)];
    if (mm === undefined) return null;
    var yy = parseInt(s.slice(3), 10);
    if (!isFinite(yy)) return null;
    if (yy < 100) yy += 2000;
    return yy * 12 + mm;
  }
  function monthsBetween(aLabel, bLabel) {
    var a = monthOrdinal(aLabel), b = monthOrdinal(bLabel);
    if (a === null || b === null) return STEP_MONTHS_FALLBACK;
    var d = Math.abs(b - a);
    return d > 0 ? d : STEP_MONTHS_FALLBACK;
  }

  /* --- formatting helpers (reuse globals; guard if absent) --------------- */
  function fInt(n) { try { return fmtInt(n); } catch (e) { return String(Math.round(n)); } }
  function fUsd(n) { try { return fmtUsd(Math.round(n)); } catch (e) { return '$' + Math.round(n); } }
  function fEur(n) { try { return fmtEur(Math.round(n)); } catch (e) { return '€' + Math.round(n); } }
  function fGbp(n) { try { return fmtGbp(Math.round(n)); } catch (e) { return '£' + Math.round(n); } }
  function fSigned(n) { try { return fmtSigned(Math.round(n)); } catch (e) { return (n >= 0 ? '+' : '−') + Math.abs(Math.round(n)); } }
  function fSignedPct(n) { try { return fmtSignedPct(n, 1); } catch (e) { return (n >= 0 ? '+' : '−') + Math.abs(Number(n)).toFixed(1) + '%'; } }
  function fPct(n) { try { return fmtPct(n, 1); } catch (e) { return Number(n).toFixed(1) + '%'; } }
  function fNum4(n) { try { return fmtNum(n, 4); } catch (e) { return Number(n).toFixed(4); } }
  function sCls(n, invert) { try { return signClass(n, invert); } catch (e) { return n >= 0 ? 'pos' : 'neg'; } }
  function fEurM(eur) {
    var m = eur / 1e6, txt;
    try { txt = fmtNum(m, 2); } catch (e) { txt = m.toFixed(2); }
    return '€' + txt + 'M';
  }

  /* ===================================================================== *
   * CARD A model — curve roll yield / term structure
   * ===================================================================== */
  function buildCurveModel() {
    var fc = (DATA.futuresCurve) || {};
    var labels = fc.labels || [];
    var ny = fc.ny || [];
    var n = Math.min(labels.length, ny.length);

    var pairs = [];
    var rising = 0, falling = 0;
    var spreadSum = 0;
    for (var i = 0; i < n - 1; i++) {
      var near = num(ny[i], null);
      var far = num(ny[i + 1], null);
      if (near === null || far === null) continue;
      var spread = far - near;                       // $/t calendar spread
      var months = monthsBetween(labels[i], labels[i + 1]);
      // annualized %: spread relative to near leg, scaled to a full year
      var annPct = near ? (spread / near) * (MONTHS_PER_YEAR / months) * 100 : 0;
      pairs.push({
        from: labels[i], to: labels[i + 1],
        spread: spread, months: months, annPct: annPct
      });
      spreadSum += spread;
      if (spread > 0) rising++; else if (spread < 0) falling++;
    }

    // verdict on the whole term structure
    var verdict, verdictCls;
    if (pairs.length && falling === 0 && rising === pairs.length) {
      verdict = 'NY in full CONTANGO'; verdictCls = 'warn';
    } else if (pairs.length && rising === 0 && falling === pairs.length) {
      verdict = 'NY in BACKWARDATION'; verdictCls = 'pos';
    } else {
      verdict = 'NY term structure MIXED'; verdictCls = 'info';
    }

    var rollTotal = (n >= 2) ? (num(ny[n - 1], 0) - num(ny[0], 0)) : 0; // JUL26→DEC27 $/t
    var avgSpread = pairs.length ? (spreadSum / pairs.length) : 0;      // avg adjacent step $/t

    return {
      pairs: pairs, verdict: verdict, verdictCls: verdictCls,
      rollTotal: rollTotal, avgSpread: avgSpread,
      firstLabel: labels[0], lastLabel: labels[n - 1]
    };
  }

  /* Net LONG cocoa lots: CC/NY/LDN books, side LONG, FX excluded. --------- */
  function netLongCocoaLots() {
    var lots = 0;
    try {
      (DATA.hedges || []).forEach(function (h) {
        var book = String(h.book || '');
        var side = String(h.side || '').toUpperCase();
        if (side !== 'LONG') return;
        if (/FX/i.test(book)) return;                // belt-and-braces FX exclude
        if (/(NY|LDN|CC|C )/i.test(book)) {
          lots += num(h.contracts, num(h.lots, 0));
        }
      });
    } catch (e) { /* noop */ }
    return lots;
  }

  function curveCardHtml() {
    var m = buildCurveModel();
    var eurusd = getEurUsd();
    var longLots = netLongCocoaLots();

    /* carry drag: avg adjacent spread ($/t) × long lots × 10 MT, in € /qtr.
     * positive spread (contango) on a LONG book = cost to carry/roll = drag.  */
    var carryDragEur = (m.avgSpread * longLots * LOT_MT) / (eurusd || EURUSD_FALLBACK);
    // position value (€) of the long book at the near NY price
    var nearNy = num((DATA.futuresCurve && DATA.futuresCurve.ny && DATA.futuresCurve.ny[0]), 0);
    var posValueEur = (nearNy * longLots * LOT_MT) / (eurusd || EURUSD_FALLBACK);
    var dragPctQtr = posValueEur ? (carryDragEur / posValueEur) * 100 : 0;

    // table rows: one per adjacent expiry pair
    var rows = m.pairs.map(function (p) {
      return '' +
        '<tr>' +
          '<td class="cell-strong mono">' + p.from + '→' + p.to + '</td>' +
          '<td class="num mono ' + sCls(p.spread) + '">' + fSigned(p.spread) + ' $/t</td>' +
          '<td class="num mono ' + sCls(p.annPct) + '">' + fSignedPct(p.annPct) + '</td>' +
        '</tr>';
    }).join('');

    // headline qstat strip
    var kpis = '' +
      '<div class="qstat-grid ma-kpis">' +
        '<div class="qstat">' +
          '<div class="qstat-label">Roll cost ' + m.firstLabel + '→' + m.lastLabel + '</div>' +
          '<div class="qstat-value mono ' + sCls(m.rollTotal) + '">' + fSigned(m.rollTotal) + ' $/t</div>' +
        '</div>' +
        '<div class="qstat">' +
          '<div class="qstat-label">Net long cocoa lots</div>' +
          '<div class="qstat-value mono">' + fInt(longLots) + '</div>' +
        '</div>' +
        '<div class="qstat">' +
          '<div class="qstat-label">Est. carry drag / qtr</div>' +
          '<div class="qstat-value mono ' + sCls(-dragPctQtr) + '">' + fSignedPct(-dragPctQtr) + '</div>' +
        '</div>' +
        '<div class="qstat">' +
          '<div class="qstat-label">Carry drag (€)</div>' +
          '<div class="qstat-value mono neg">' + fEurM(carryDragEur) + '/qtr</div>' +
        '</div>' +
      '</div>';

    // one-line plain-language summary
    var summary = '' +
      '<div class="ma-summary">' +
        '<span class="ma-verdict badge badge-' + m.verdictCls + '">' + m.verdict + '</span> ' +
        '~' + fSigned(m.rollTotal) + '/t to roll the curve ' + m.firstLabel + '→' + m.lastLabel + '; ' +
        '≈' + fSignedPct(-dragPctQtr) + '/qtr carry drag on ' + fInt(longLots) + ' long lots ' +
        '(' + fEurM(carryDragEur) + '/qtr).' +
      '</div>';

    return '' +
      '<div class="card ma-curve">' +
        '<div class="card-head">' +
          '<div class="card-title">Curve Analytics — Roll Yield &amp; Term Structure</div>' +
          '<div class="card-sub">Adjacent ICE NY calendar spreads · annualized = spread / near-leg × 12 / months between</div>' +
        '</div>' +
        '<div class="card-body">' +
          kpis +
          summary +
          '<div class="table-wrap"><table class="table ma-table">' +
            '<thead><tr>' +
              '<th>Expiry pair</th>' +
              '<th class="th-num">Spread $/t</th>' +
              '<th class="th-num">Annualized %</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div>' +
          '<div class="ma-note">Positive spread = ' + m.firstLabel + '+ deferred richer (contango → cost to be long &amp; roll); ' +
          'carry drag = avg adjacent spread (' + fSigned(m.avgSpread) + ' $/t) × ' + fInt(longLots) + ' lots × ' + LOT_MT + ' MT, in € at ' + fNum4(eurusd) + '. ' +
          'FX hedge books excluded from long-lot count.</div>' +
        '</div>' +
      '</div>';
  }

  /* ===================================================================== *
   * CARD B model — basis & differentials
   * ===================================================================== */
  function buildBasisModel() {
    var fc = (DATA.futuresCurve) || {};
    var nyUsd = num((fc.ny && fc.ny[0]), 0);   // near NY USD/t
    var ldnGbp = num((fc.ldn && fc.ldn[0]), 0); // near LDN GBP/t
    var eurusd = getEurUsd();
    var gbpusd = getGbpUsd();

    var nyEur = eurusd ? (nyUsd / eurusd) : 0;
    var ldnEur = eurusd ? ((ldnGbp * gbpusd) / eurusd) : 0;
    var arb = nyEur - ldnEur;                   // €/t NY minus LDN

    return {
      nyUsd: nyUsd, ldnGbp: ldnGbp, eurusd: eurusd, gbpusd: gbpusd,
      nyEur: nyEur, ldnEur: ldnEur, arb: arb
    };
  }

  /* Dedup origins from contracts, keep most recent (last-seen) diff. ------ */
  function buildOriginDiffs() {
    var seen = {};
    var order = [];
    try {
      (DATA.contracts || []).forEach(function (c) {
        var code = String(c.origin || '').trim();
        if (!code) return;
        if (!(code in seen)) { order.push(code); }
        seen[code] = num(c.diff, num(seen[code], 0)); // last contract's diff wins
      });
    } catch (e) { /* noop */ }

    var rows = order.map(function (code) { return { code: code, diff: seen[code] }; });
    // peer mean for the "rich" badge
    var sum = 0;
    rows.forEach(function (r) { sum += r.diff; });
    var mean = rows.length ? (sum / rows.length) : 0;
    rows.forEach(function (r) { r.rich = (r.diff >= mean + RICH_OVER_MEAN_USD); });
    return { rows: rows, mean: mean };
  }

  /* CIV differential trend from versionDiff (v1→v2→v3). ------------------- */
  function civDiffTrend() {
    try {
      var row = (DATA.versionDiff || []).find(function (d) {
        return /CIV differential/i.test(String(d.assumption));
      });
      if (!row) return null;
      var v1 = num(row.v1, null), v2 = num(row.v2, null), v3 = num(row.v3, null);
      if (v1 === null || v3 === null) return null;
      return { v1: v1, v2: v2, v3: v3, rising: (v3 > v1) };
    } catch (e) { return null; }
  }

  function basisCardHtml() {
    var b = buildBasisModel();
    var od = buildOriginDiffs();
    var civ = civDiffTrend();

    var arbCls = sCls(b.arb);
    var richNote = (b.arb > 0)
      ? 'NY rich to LDN'
      : (b.arb < 0 ? 'NY cheap to LDN' : 'NY ≈ LDN (flat)');

    var kpis = '' +
      '<div class="qstat-grid ma-kpis">' +
        '<div class="qstat">' +
          '<div class="qstat-label">NY (USD/t → €/t)</div>' +
          '<div class="qstat-value mono">' + fEur(b.nyEur) + '</div>' +
        '</div>' +
        '<div class="qstat">' +
          '<div class="qstat-label">LDN (GBP/t → €/t)</div>' +
          '<div class="qstat-value mono">' + fEur(b.ldnEur) + '</div>' +
        '</div>' +
        '<div class="qstat">' +
          '<div class="qstat-label">NY − LDN spread</div>' +
          '<div class="qstat-value mono ' + arbCls + '">' + fSigned(b.arb) + ' €/t</div>' +
        '</div>' +
        '<div class="qstat">' +
          '<div class="qstat-label">Transatlantic basis</div>' +
          '<div class="qstat-value mono ' + arbCls + '">' + richNote + '</div>' +
        '</div>' +
      '</div>';

    // origin differential drift table
    var diffRows = od.rows.map(function (r) {
      var isCiv = (r.code === 'CIV' && civ);
      var trendTxt, trendCls;
      if (isCiv) {
        var parts = [];
        if (civ.v1 !== null) parts.push(fInt(civ.v1));
        if (civ.v2 !== null) parts.push(fInt(civ.v2));
        if (civ.v3 !== null) parts.push(fInt(civ.v3));
        trendTxt = parts.join('→') + (civ.rising ? ' ▲' : ' ▼');
        trendCls = civ.rising ? 'neg' : 'pos'; // richening diff = adverse to buyer
      } else {
        trendTxt = '—';
        trendCls = 'muted';
      }
      var flag = '';
      if (r.rich) {
        flag = ' <span class="badge badge-warn ma-rich-tag">RICH</span>';
      }
      if (isCiv && civ.rising) {
        flag += ' <span class="badge badge-neg ma-rich-tag">richening</span>';
      }
      return '' +
        '<tr>' +
          '<td class="cell-strong mono">' + r.code + flag + '</td>' +
          '<td class="num mono">' + fSigned(r.diff) + ' $/t</td>' +
          '<td class="num mono ' + trendCls + '">' + trendTxt + '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div class="card ma-basis">' +
        '<div class="card-head">' +
          '<div class="card-title">Basis &amp; Differentials</div>' +
          '<div class="card-sub">NY vs LDN transatlantic arb in common €/t · origin differential drift</div>' +
        '</div>' +
        '<div class="card-body">' +
          kpis +
          '<div class="section-title">Origin differential drift</div>' +
          '<div class="table-wrap"><table class="table ma-table">' +
            '<thead><tr>' +
              '<th>Origin</th>' +
              '<th class="th-num">Current diff</th>' +
              '<th class="th-num">CIV v1→v2→v3 trend</th>' +
            '</tr></thead>' +
            '<tbody>' + diffRows + '</tbody>' +
          '</table></div>' +
          '<div class="ma-note">€/t basis: NY = NY$ / EUR-USD (' + fNum4(b.eurusd) + '); ' +
          'LDN = LDN£ × GBP-USD (' + fNum4(b.gbpusd) + ') / EUR-USD. ' +
          'RICH = diff ≥ peer mean (' + fSigned(Math.round(od.mean)) + ' $/t) + ' + RICH_OVER_MEAN_USD + '. ' +
          'CIV differential ' + (civ ? (civ.rising ? 'richening' : 'easing') : 'flat') +
          (civ ? ' (' + fInt(civ.v1) + '→' + fInt(civ.v3) + ' $/t over v1→v3)' : '') + '.</div>' +
        '</div>' +
      '</div>';
  }

  /* --- combined append (both cards) -------------------------------------- */
  function analyticsHtml() {
    var out = '';
    try { out += curveCardHtml(); } catch (e) { /* skip card A on error */ }
    try { out += basisCardHtml(); } catch (e) { /* skip card B on error */ }
    return out;
  }

  /* --- one prefixed <style> (ma-*), token-driven ------------------------- */
  function injectStyle() {
    if (document.getElementById('ma-style')) return;
    var css = '' +
      '.ma-curve .ma-kpis,.ma-basis .ma-kpis{margin-bottom:14px;}' +
      '.ma-curve .ma-table th.th-num,.ma-curve .ma-table td.num,' +
      '.ma-basis .ma-table th.th-num,.ma-basis .ma-table td.num{text-align:right;}' +
      '.ma-summary{font-family:var(--sans);font-size:12px;line-height:1.6;color:var(--text-1);' +
        'margin:0 0 14px 0;padding:10px 12px;background:var(--bg-2);border:1px solid var(--line);' +
        'border-radius:8px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;}' +
      '.ma-summary .ma-verdict{flex:0 0 auto;}' +
      '.ma-rich-tag{margin-left:6px;font-size:9px;letter-spacing:.04em;vertical-align:middle;}' +
      '.ma-note{margin-top:10px;font-size:11px;color:var(--text-2);font-family:var(--sans);' +
        'line-height:1.5;border-top:1px solid var(--line);padding-top:8px;}';
    var st = document.createElement('style');
    st.id = 'ma-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* --- compose-wrap VIEWS.market.render (pattern A) ---------------------- *
   * VIEWS is a const lexical global in app.js (NOT window.VIEWS). Reference
   * it bare, guarded by typeof. enh-ptbf already wrapped this render; we wrap
   * the (possibly already-wrapped) function again and KEEP the prior output,
   * so PTBF cockpit + our two cards all render in order.                     */
  function install() {
    if (typeof VIEWS === 'undefined' || !VIEWS.market ||
        typeof VIEWS.market.render !== 'function') return false;
    if (VIEWS.market.render.__maWrapped) {
      window.__cacaoMarketAnalyticsInstalled = true;
      return true;
    }

    injectStyle();

    var _r = VIEWS.market.render;          // prior render (may already be wrapped)
    var wrapped = function () {
      var base = _r.apply(this, arguments);
      try { return base + analyticsHtml(); } catch (e) { return base; }
    };
    wrapped.__maWrapped = true;
    VIEWS.market.render = wrapped;
    window.__cacaoMarketAnalyticsInstalled = true;

    // repaint if Market Desk is on screen now (CALL switchView; never reassign)
    try {
      if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'market' &&
          typeof switchView === 'function') {
        switchView('market');
      }
    } catch (e) { /* noop */ }
    return true;
  }

  install();
})();
