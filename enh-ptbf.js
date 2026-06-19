/* ============================================================================
   CACAO/FP — enh-ptbf.js  (#11 — PTBF Pricing Cockpit)
   Self-installing enhancement module. Loaded AFTER the first/second-wave
   modules. Compose-wraps VIEWS.market.render (ENH_CONTRACT2 pattern A) and
   APPENDS a "PTBF Pricing Cockpit — Unpriced Lots" card to the Market Desk.

   For every DATA.contracts row with status === 'UNPRICED' it computes the
   all-in $/t fixable cost today (interpolated ICE NY future at the contract's
   exec month + origin differential), the € equivalent, distance to the alert
   trigger (8300 USD/t), and the € exposure if the market rallies to the bull
   case (8650 USD/t) before the lot is fixed. Rows sort by urgency.

   Rules honoured: plain JS IIFE, top-level install, no edits to other files,
   never reassigns switchView (only CALLS it), one prefixed <style>, token-
   driven, idempotent, localStorage-free (nothing to persist), zero console
   errors. Reuses existing globals: $, DATA, VIEWS, CURRENT_VIEW, switchView,
   formatters (fmtInt/fmtUsd/fmtEur/fmtSigned/fmtNum/signClass).
   ========================================================================== */
(function () {
  'use strict';

  /* --- idempotency guard (flag is set only after a successful wrap) ------ */
  if (window.__cacaoPtbfInstalled) return;

  /* --- module constants (token names live in styles.css :root) ----------- */
  var PTBF_TRIGGER_USD = 8300;   // PC-2404 alert trigger; applied to all lots
  var BULL_NY_FALLBACK = 8650;   // scenario "Bull" nyPx fallback
  var EURUSD_FALLBACK = 1.085;   // EUR/USD fallback if ticker missing

  /* --- safe accessors ---------------------------------------------------- */
  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function getEurUsd() {
    try {
      var t = (DATA.ticker || []).find(function (x) { return x.sym === 'EUR/USD'; });
      return num(t && t.px, EURUSD_FALLBACK) || EURUSD_FALLBACK;
    } catch (e) { return EURUSD_FALLBACK; }
  }

  function getBullNy() {
    try {
      var s = (DATA.scenarios || []).find(function (x) {
        return String(x.name).toUpperCase() === 'BULL';
      });
      return num(s && s.nyPx, BULL_NY_FALLBACK);
    } catch (e) { return BULL_NY_FALLBACK; }
  }

  /* --- exec-month → numeric ordinal so we can interpolate the curve ------ *
   * Curve labels look like 'JUL26'..'DEC27'. Convert any 'MMMYY' to a month
   * index (year*12 + month) so a contract exec month between two listed
   * expiries interpolates linearly; at/after the last expiry → last value.  */
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
    if (yy < 100) yy += 2000;             // 'JUL26' → 2026
    return yy * 12 + mm;
  }

  /* Linear-interpolate the NY futures curve at the given exec month.        */
  function futuresAtMonth(execMonth) {
    var fc = (DATA.futuresCurve) || {};
    var labels = fc.labels || [];
    var ny = fc.ny || [];
    if (!labels.length || !ny.length) return null;

    var target = monthOrdinal(execMonth);
    var pts = [];
    for (var i = 0; i < labels.length; i++) {
      var ord = monthOrdinal(labels[i]);
      var px = num(ny[i], null);
      if (ord !== null && px !== null) pts.push({ ord: ord, px: px });
    }
    if (!pts.length) return null;
    pts.sort(function (a, b) { return a.ord - b.ord; });

    if (target === null) return pts[0].px;               // unparseable → first
    if (target <= pts[0].ord) return pts[0].px;          // at/before first
    if (target >= pts[pts.length - 1].ord) return pts[pts.length - 1].px; // at/after last

    for (var j = 0; j < pts.length - 1; j++) {
      var lo = pts[j], hi = pts[j + 1];
      if (target === lo.ord) return lo.px;
      if (target > lo.ord && target < hi.ord) {
        var span = hi.ord - lo.ord;
        var frac = span === 0 ? 0 : (target - lo.ord) / span;
        return lo.px + (hi.px - lo.px) * frac;
      }
    }
    return pts[pts.length - 1].px;
  }

  /* --- build the per-contract model -------------------------------------- */
  function buildLots() {
    var eurusd = getEurUsd();
    var bullNy = getBullNy();
    var contracts = (DATA.contracts || []).filter(function (c) {
      return String(c.status).toUpperCase() === 'UNPRICED';
    });

    var lots = contracts.map(function (c) {
      var fut = futuresAtMonth(c.execMonth);
      var diff = num(c.diff, 0);
      var mt = num(c.mt, 0);
      var fixableUsd = (fut === null) ? null : (fut + diff);
      var fixableEur = (fixableUsd === null || !eurusd) ? null : (fixableUsd / eurusd);
      var distanceToTrigger = (fixableUsd === null) ? null : (PTBF_TRIGGER_USD - fixableUsd);
      // bull exposure in USD/t * MT, converted to € notional
      var atRiskUsd = (fut === null) ? null : (bullNy - fut) * mt;
      var atRiskEur = (atRiskUsd === null || !eurusd) ? null : (atRiskUsd / eurusd);
      return {
        c: c,
        mt: mt,
        diff: diff,
        fut: fut,
        fixableUsd: fixableUsd,
        fixableEur: fixableEur,
        distanceToTrigger: distanceToTrigger,
        atRiskEur: atRiskEur
      };
    });

    // urgency sort: smallest / most-negative distanceToTrigger first
    lots.sort(function (a, b) {
      var da = (a.distanceToTrigger === null) ? Infinity : a.distanceToTrigger;
      var db = (b.distanceToTrigger === null) ? Infinity : b.distanceToTrigger;
      return da - db;
    });
    return { lots: lots, eurusd: eurusd, bullNy: bullNy };
  }

  /* --- formatting helpers (reuse globals, guard if absent) --------------- */
  function fInt(n) { try { return fmtInt(n); } catch (e) { return String(Math.round(n)); } }
  function fUsd(n) { try { return fmtUsd(Math.round(n)); } catch (e) { return '$' + Math.round(n); } }
  function fEur(n) { try { return fmtEur(Math.round(n)); } catch (e) { return '€' + Math.round(n); } }
  function fSigned(n) { try { return fmtSigned(Math.round(n)); } catch (e) { return (n >= 0 ? '+' : '−') + Math.abs(Math.round(n)); } }
  function sCls(n, invert) { try { return signClass(n, invert); } catch (e) { return n >= 0 ? 'pos' : 'neg'; } }

  function fEurM(eur) {
    var m = eur / 1e6;
    var txt;
    try { txt = fmtNum(m, 2); } catch (e) { txt = m.toFixed(2); }
    return '€' + txt + 'M';
  }

  /* --- render the cockpit card ------------------------------------------- */
  function cockpitHtml() {
    var model = buildLots();
    var lots = model.lots;

    if (!lots.length) {
      return '' +
        '<div class="card pt-cockpit">' +
          '<div class="card-head">' +
            '<div class="card-title">PTBF Pricing Cockpit — Unpriced Lots</div>' +
            '<div class="card-sub">Price-to-be-fixed exposure vs the live ICE NY curve</div>' +
          '</div>' +
          '<div class="card-body"><div class="kv-list">' +
            '<div class="kv"><span class="kv-k">No unpriced PTBF lots</span>' +
            '<span class="kv-v mono pos">All fixed</span></div>' +
          '</div></div>' +
        '</div>';
    }

    // KPI strip totals
    var totalMt = 0, totalNotionalEur = 0, totalAtRiskEur = 0;
    lots.forEach(function (l) {
      totalMt += l.mt;
      if (l.fixableEur !== null) totalNotionalEur += l.fixableEur * l.mt;
      if (l.atRiskEur !== null) totalAtRiskEur += l.atRiskEur;
    });

    var kpis = '' +
      '<div class="qstat-grid pt-kpis">' +
        '<div class="qstat">' +
          '<div class="qstat-label">Unpriced MT</div>' +
          '<div class="qstat-value warn mono">' + fInt(totalMt) + '</div>' +
        '</div>' +
        '<div class="qstat">' +
          '<div class="qstat-label">Notional @ fixable cost</div>' +
          '<div class="qstat-value mono">' + fEurM(totalNotionalEur) + '</div>' +
        '</div>' +
        '<div class="qstat">' +
          '<div class="qstat-label">At-risk if bull (' + fUsd(model.bullNy) + ')</div>' +
          '<div class="qstat-value neg mono">' + fEurM(totalAtRiskEur) + '</div>' +
        '</div>' +
        '<div class="qstat">' +
          '<div class="qstat-label">Trigger / EUR USD</div>' +
          '<div class="qstat-value mono">' + fUsd(PTBF_TRIGGER_USD) + ' · ' + fNum4(model.eurusd) + '</div>' +
        '</div>' +
      '</div>';

    // rows
    var rows = lots.map(function (l) {
      var c = l.c;
      var distCls = (l.distanceToTrigger === null) ? 'muted'
        : (l.distanceToTrigger < 0 ? 'neg' : 'pos');
      var distTxt = (l.distanceToTrigger === null) ? '—'
        : fSigned(l.distanceToTrigger) + ' $/t';
      var urgent = (l.distanceToTrigger !== null && l.distanceToTrigger < 0);

      return '' +
        '<tr' + (urgent ? ' class="pt-urgent"' : '') + '>' +
          '<td class="cell-strong mono">' + c.id +
            (urgent ? ' <span class="pill pill-neg pt-urgent-tag">URGENT</span>' : '') + '</td>' +
          '<td class="mono">' + c.execMonth + '</td>' +
          '<td class="num mono">' + fInt(l.mt) + '</td>' +
          '<td class="mono">' + c.origin + '</td>' +
          '<td class="num mono">' + fSigned(l.diff) + ' $</td>' +
          '<td class="num mono">' + (l.fut === null ? '—' : fUsd(l.fut)) + '</td>' +
          '<td class="num mono cell-strong">' + (l.fixableUsd === null ? '—' : fUsd(l.fixableUsd)) + '</td>' +
          '<td class="num mono">' + (l.fixableEur === null ? '—' : fEur(l.fixableEur)) + '</td>' +
          '<td class="num mono ' + distCls + '">' + distTxt + '</td>' +
          '<td class="num mono neg">' + (l.atRiskEur === null ? '—' : fEur(l.atRiskEur)) + '</td>' +
          '<td class="num">' +
            '<button class="btn btn-sm btn-primary" data-action="fix-ptbf" data-payload="' + c.id + '">Fix now</button>' +
          '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div class="card pt-cockpit">' +
        '<div class="card-head">' +
          '<div class="card-title">PTBF Pricing Cockpit — Unpriced Lots</div>' +
          '<div class="card-sub">' + lots.length + ' lot(s) exposed · fixable $/t = interpolated ICE NY future + origin differential · sorted by urgency</div>' +
        '</div>' +
        '<div class="card-body">' +
          kpis +
          '<div class="table-wrap"><table class="table pt-table">' +
            '<thead><tr>' +
              '<th>Contract</th>' +
              '<th>Exec</th>' +
              '<th class="th-num">MT</th>' +
              '<th>Origin</th>' +
              '<th class="th-num">Diff</th>' +
              '<th class="th-num">Future @ month</th>' +
              '<th class="th-num">Fixable $/t</th>' +
              '<th class="th-num">Fixable €/t</th>' +
              '<th class="th-num">Δ to trigger</th>' +
              '<th class="th-num">At-risk if bull</th>' +
              '<th></th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div>' +
          '<div class="pt-note">Trigger ' + fUsd(PTBF_TRIGGER_USD) + ' USD/t · negative Δ = already above trigger (urgent). ' +
          'At-risk = (bull ' + fUsd(model.bullNy) + ' − future) × MT, in € at ' + fNum4(model.eurusd) + '.</div>' +
        '</div>' +
      '</div>';
  }

  function fNum4(n) { try { return fmtNum(n, 4); } catch (e) { return Number(n).toFixed(4); } }

  /* --- inject ONE prefixed <style> (token-driven) ------------------------ */
  function injectStyle() {
    if (document.getElementById('pt-cockpit-style')) return;
    var css = '' +
      '.pt-cockpit .pt-kpis{margin-bottom:14px;}' +
      '.pt-cockpit .pt-table th.th-num,.pt-cockpit .pt-table td.num{text-align:right;}' +
      '.pt-cockpit tr.pt-urgent td{background:rgba(255,84,102,.06);}' +
      '.pt-cockpit .pt-urgent-tag{margin-left:6px;font-size:9px;letter-spacing:.04em;}' +
      '.pt-cockpit .pt-note{margin-top:10px;font-size:11px;color:var(--text-2);' +
        'font-family:var(--sans);line-height:1.5;border-top:1px solid var(--line);padding-top:8px;}';
    var st = document.createElement('style');
    st.id = 'pt-cockpit-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* --- compose-wrap VIEWS.market.render (pattern A) ---------------------- *
   * VIEWS is declared `const` in app.js — a LEXICAL global, NOT a property of
   * window. Reference the bare global (guarded via typeof); never window.VIEWS. */
  function install() {
    if (typeof VIEWS === 'undefined' || !VIEWS.market ||
        typeof VIEWS.market.render !== 'function') return false;
    if (VIEWS.market.render.__ptWrapped) { window.__cacaoPtbfInstalled = true; return true; }

    injectStyle();

    var _r = VIEWS.market.render;               // may already be wrapped — compose, don't clobber
    var wrapped = function () {
      var base = _r.apply(this, arguments);
      try { return base + cockpitHtml(); } catch (e) { return base; }
    };
    wrapped.__ptWrapped = true;
    VIEWS.market.render = wrapped;
    window.__cacaoPtbfInstalled = true;

    // repaint if Market Desk is already on screen (CALL switchView; never reassign)
    try {
      if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'market'
          && typeof switchView === 'function') {
        switchView('market');
      }
    } catch (e) { /* no-op */ }
    return true;
  }

  install();
})();
