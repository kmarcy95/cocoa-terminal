/* ============================================================================
   CACAO/FP — enh-hedge-pnl.js  (Hedge Book — P&L Impact Analysis)

   Self-installing enhancement module. Loaded AFTER the first/second-wave
   modules and AFTER enh-hedge-optimizer.js. Compose-wraps VIEWS.hedge.render
   (ENH_CONTRACT2 pattern A) and APPENDS ONE "Hedge P&L Impact" card BELOW the
   existing Hedge Book content (KPIs + coverage chart + open positions + the
   optimizer's two cards).

   The card shows, for a Cost Accounting analyst, exactly WHERE hedge P&L lands
   and HOW the hedge book moves with cocoa price:

     (1) HEADLINE qstat-grid
         · Net MTM            = Σ mtmEur (fmtEurM, colored)
         · Net cocoa delta    = (LONG cocoa lots − SHORT cocoa lots) × 10 MT/lot
         · P&L sensitivity    = "€<x>k per €100/t move" = |netMT| × 100 / 1000
         · Effective hedge    = blended designation ratio capped at 100% (~78%)

     (2) PER-POSITION P&L table (DATA.hedges)
         ID · Book · Side(badge) · Lots · Avg Px · Current MTM €(colored) ·
         Delta MT (lots×10, + long / − short for cocoa; 0 for FX price-delta) ·
         P&L per €100/t move €  ·  Status(badge). Footer totals row.

     (3) SCENARIO P&L on the HEDGE BOOK (DATA.scenarios)
         priceMoveUsd = nyPx − 7842 ; priceMoveEur = priceMoveUsd / 1.085 ;
         hedgePnL€    = netLongCocoaMT × priceMoveEur  (longs GAIN on a rally).
         Table: Scenario · NY px · Prob % · Hedge P&L €(colored) · note that it
         OFFSETS the physical cost move (hedged book ≈ neutral; residual is
         basis / ineffectiveness). Plus a one-line takeaway.

     (4) IFRS-9 SPLIT (kv-list) — where the hedge result is recognised:
         Effective → OCI = €1.24M accumulated ; Ineffective → P&L = −€96k ;
         Reclassified on settlement = €410k.  (DATA.hedgeEffectiveness.pnlImpact)

   Rules honoured: plain JS IIFE, top-level install, NO edits to other files,
   never reassigns switchView (only CALLS it), ONE hp-* prefixed <style>,
   token-driven (var(--*)), idempotent (window.__cacaoHedgePnlInstalled +
   render.__hpWrapped), localStorage try/catch (nothing persisted, guarded
   anyway), zero console errors. References the BARE lexical globals
   (VIEWS / CURRENT_VIEW / DATA / switchView) via typeof guards — never
   window.VIEWS / window.DATA. Reuses globals: $, DATA, formatters. CSS/tables
   only (no Chart.js) for reliability.
   ========================================================================== */
(function () {
  'use strict';

  /* --- idempotency guard (set only after a successful wrap) -------------- */
  if (window.__cacaoHedgePnlInstalled) return;

  /* --- model constants (documented, not magic) -------------------------- */
  var MT_PER_LOT       = 10;        // 1 ICE lot = 10 MT
  var SPOT_NY_USD      = 7842;      // CC·NY reference px (matches DATA.ticker / Base scenario)
  var EURUSD           = 1.085;     // EUR/USD assumption (matches DATA.ticker)
  var MOVE_STEP_USD    = 100;       // sensitivity step: a €100/t (≈ $/t) parallel move
  var DEFAULT_HEDGE_R  = 78;        // fallback effective hedge ratio (%) if designations absent

  /* --- safe numeric ------------------------------------------------------ */
  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  /* --- formatting helpers (reuse globals, guard if absent) --------------- */
  function fInt(n) { try { return fmtInt(n); } catch (e) { return String(Math.round(num(n))); } }
  function fPct(n) { try { return fmtPct(n, 1); } catch (e) { return num(n).toFixed(1) + '%'; } }
  function fNum0(n) { try { return fmtNum(n, 0); } catch (e) { return String(Math.round(num(n))); } }
  function fNum2(n) { try { return fmtNum(n, 2); } catch (e) { return num(n).toFixed(2); } }
  function fNum3(n) { try { return fmtNum(n, 3); } catch (e) { return num(n).toFixed(3); } }
  function fEur0(n) { try { return fmtEur(Math.round(num(n))); } catch (e) { return '€' + fInt(n); } }
  function fSigned(n) { try { return fmtSigned(Math.round(num(n))); } catch (e) { return (num(n) >= 0 ? '+' : '−') + Math.abs(Math.round(num(n))); } }
  function sCls(n) { try { return signClass(num(n)); } catch (e) { return num(n) >= 0 ? 'pos' : 'neg'; } }
  function fEurM(eur) {
    try { return fmtEurM(num(eur), 2); } catch (e) {
      return '€' + (num(eur) / 1e6).toFixed(2) + 'M';
    }
  }
  /* signed euros with a real minus and grouping, e.g. "+€386,000" / "−€96,000" */
  function fSignedEur(eur) {
    var v = Math.round(num(eur));
    var sign = v >= 0 ? '+' : '−';
    return sign + fEur0(Math.abs(v));
  }
  /* compact € in k (thousands), signed — for the per-position sensitivity col */
  function fSignedEurK(eur) {
    var k = num(eur) / 1000;
    var sign = k >= 0 ? '+' : '−';
    return sign + '€' + fNum2(Math.abs(k)) + 'k';
  }

  /* --- badge for hedge status (mirror the core view's mapping) ----------- *
   * Core view uses a global badge(); reuse it if present, else map locally.  */
  function statusBadge(status) {
    try { if (typeof badge === 'function') return badge(status); } catch (e) { /* fall through */ }
    var s = String(status || '').toUpperCase();
    var cls = 'badge-muted';
    if (/^(EFFECTIVE|DONE|FIXED|PASS|PAID|SUBMITTED|CURRENT)$/.test(s)) cls = 'badge-pos';
    else if (/^(WATCH|IN_PROGRESS|OPEN|PARTIAL|PENDING|DRAFT|WORKING)$/.test(s)) cls = 'badge-warn';
    else if (/^(FAILED|GAP|FAIL|UNPRICED|NONE)$/.test(s)) cls = 'badge-neg';
    return '<span class="badge ' + cls + '">' + (status == null ? '—' : status) + '</span>';
  }
  function sideBadge(side) {
    var up = String(side || '').toUpperCase();
    var cls = up === 'LONG' ? 'badge-pos' : 'badge-info';
    return '<span class="badge ' + cls + '">' + (side == null ? '—' : side) + '</span>';
  }

  /* --- book classification (same convention as enh-hedge-optimizer) ------ *
   * cocoa futures books: 'CC NY ...' (ICE NY) and 'C LDN ...' (ICE London).  *
   * FX books are 'FX EURUSD' / 'FX GBPUSD' — price-delta is N/A for cocoa.    */
  function isCocoaBook(book) {
    var b = String(book || '').toUpperCase();
    if (b.indexOf('FX') === 0) return false;
    return /(^|\s)(NY|LDN|CC|C)(\s|$)/.test(b) || b.indexOf('CC') === 0 || b.indexOf('C LDN') === 0;
  }

  /* --- effective hedge ratio: blend designation ratios (cap each at 100%) - *
   * IFRS-9 effectiveness ratios can exceed 100% (over-hedge); for a single    *
   * "effective coverage" headline we cap each at 100% and average. Falls back *
   * to DEFAULT_HEDGE_R when no designations are present.                       */
  function effectiveHedgeRatio() {
    try {
      var des = (typeof DATA !== 'undefined' && DATA.hedgeEffectiveness &&
                 DATA.hedgeEffectiveness.designations) || [];
      if (!des.length) return DEFAULT_HEDGE_R;
      var sum = 0, n = 0;
      des.forEach(function (d) {
        var r = num(d.ratio, NaN);
        if (isFinite(r)) { sum += Math.min(100, r); n++; }
      });
      return n ? (sum / n) : DEFAULT_HEDGE_R;
    } catch (e) { return DEFAULT_HEDGE_R; }
  }

  /* ======================================================================
     CORE COMPUTATION — per-position P&L + book aggregates
     ====================================================================== */
  function computeBook() {
    var hedges = (typeof DATA !== 'undefined' && DATA.hedges) || [];

    var netMtm = 0;            // Σ mtmEur across the whole book
    var longCocoaLots = 0;     // cocoa LONG lots
    var shortCocoaLots = 0;    // cocoa SHORT lots
    var rows = [];

    hedges.forEach(function (h) {
      var lots = num(h.lots);
      var mtm = num(h.mtmEur);
      netMtm += mtm;

      var cocoa = isCocoaBook(h.book);
      var isLong = String(h.side).toUpperCase() === 'LONG';

      // Delta MT: cocoa lots → tonnes with sign by side; FX has no cocoa price-delta.
      var deltaMt = 0;
      if (cocoa) {
        deltaMt = lots * MT_PER_LOT * (isLong ? 1 : -1);
        if (isLong) longCocoaLots += lots; else shortCocoaLots += lots;
      }

      // P&L for a €100/t parallel cocoa move on THIS position (FX → 0).
      var pnlPer100Eur = deltaMt * MOVE_STEP_USD; // € per €100/t move (long gains on rally)

      rows.push({
        id: h.id, book: h.book, side: h.side, lots: lots,
        avgPx: num(h.avgPx), mtm: mtm, cocoa: cocoa,
        deltaMt: deltaMt, pnlPer100Eur: pnlPer100Eur, status: h.status
      });
    });

    var netLongCocoaLots = longCocoaLots - shortCocoaLots;   // net cocoa lots
    var netCocoaMt = netLongCocoaLots * MT_PER_LOT;          // net cocoa MT (signed)
    // Book-level €100/t sensitivity (absolute magnitude reads cleanest in the headline).
    var pnlPer100Eur = netCocoaMt * MOVE_STEP_USD;

    return {
      rows: rows,
      netMtm: netMtm,
      longCocoaLots: longCocoaLots,
      shortCocoaLots: shortCocoaLots,
      netLongCocoaLots: netLongCocoaLots,
      netCocoaMt: netCocoaMt,
      pnlPer100Eur: pnlPer100Eur
    };
  }

  /* ======================================================================
     SECTION 1 — HEADLINE qstat-grid
     ====================================================================== */
  function headlineHtml(b) {
    var effR = effectiveHedgeRatio();
    var sens = Math.abs(b.pnlPer100Eur) / 1000; // €k per €100/t move
    var netMtLabel = fSigned(b.netCocoaMt) + ' MT';

    return '' +
      '<div class="qstat-grid hp-kpis">' +
        '<div class="qstat"><div class="qstat-label">Net MTM</div>' +
          '<div class="qstat-value mono ' + sCls(b.netMtm) + '">' + fEurM(b.netMtm) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Net cocoa delta</div>' +
          '<div class="qstat-value mono ' + sCls(b.netCocoaMt) + '">' + netMtLabel + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">P&amp;L sensitivity</div>' +
          '<div class="qstat-value mono accent">€' + fNum0(sens) + 'k</div>' +
          '<div class="hp-qsub">per €100/t move</div></div>' +
        '<div class="qstat"><div class="qstat-label">Effective hedge ratio</div>' +
          '<div class="qstat-value mono ' + (effR >= 80 ? 'pos' : 'warn') + '">' + fPct(effR) + '</div>' +
          '<div class="hp-qsub">blended designations</div></div>' +
      '</div>';
  }

  /* ======================================================================
     SECTION 2 — PER-POSITION P&L table
     ====================================================================== */
  function positionsHtml(b) {
    var rows = b.rows.map(function (r) {
      var pxTxt = r.avgPx < 100 ? fNum3(r.avgPx) : fNum0(r.avgPx);
      var deltaTxt = r.cocoa ? (fSigned(r.deltaMt) + ' MT') : '—';
      var deltaCls = r.cocoa ? sCls(r.deltaMt) : 'muted';
      var sensTxt = r.cocoa ? fSignedEurK(r.pnlPer100Eur) : '—';
      var sensCls = r.cocoa ? sCls(r.pnlPer100Eur) : 'muted';
      return '' +
        '<tr>' +
          '<td class="cell-strong mono">' + r.id + '</td>' +
          '<td>' + r.book + '</td>' +
          '<td>' + sideBadge(r.side) + '</td>' +
          '<td class="num mono">' + fInt(r.lots) + '</td>' +
          '<td class="num mono">' + pxTxt + '</td>' +
          '<td class="num mono ' + sCls(r.mtm) + '">' + fEur0(r.mtm) + '</td>' +
          '<td class="num mono ' + deltaCls + '">' + deltaTxt + '</td>' +
          '<td class="num mono ' + sensCls + '">' + sensTxt + '</td>' +
          '<td>' + statusBadge(r.status) + '</td>' +
        '</tr>';
    }).join('');

    var totalLots = b.rows.reduce(function (s, r) { return s + r.lots; }, 0);
    var footer = '' +
      '<tr class="hp-foot">' +
        '<td class="cell-strong">Book total</td>' +
        '<td class="muted">' + b.rows.length + ' positions</td>' +
        '<td></td>' +
        '<td class="num mono cell-strong">' + fInt(totalLots) + '</td>' +
        '<td></td>' +
        '<td class="num mono cell-strong ' + sCls(b.netMtm) + '">' + fEur0(b.netMtm) + '</td>' +
        '<td class="num mono cell-strong ' + sCls(b.netCocoaMt) + '">' + fSigned(b.netCocoaMt) + ' MT</td>' +
        '<td class="num mono cell-strong ' + sCls(b.pnlPer100Eur) + '">' + fSignedEurK(b.pnlPer100Eur) + '</td>' +
        '<td></td>' +
      '</tr>';

    return '' +
      '<div class="section-title">Per-position P&amp;L</div>' +
      '<div class="table-wrap"><table class="table hp-table">' +
        '<thead><tr>' +
          '<th>ID</th>' +
          '<th>Book</th>' +
          '<th>Side</th>' +
          '<th class="th-num">Lots</th>' +
          '<th class="th-num">Avg Px</th>' +
          '<th class="th-num">Current MTM</th>' +
          '<th class="th-num">Delta MT</th>' +
          '<th class="th-num">P&amp;L /€100/t</th>' +
          '<th>Status</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + footer + '</tbody>' +
      '</table></div>';
  }

  /* ======================================================================
     SECTION 3 — SCENARIO P&L on the HEDGE BOOK
     ====================================================================== */
  function scenarioHtml(b) {
    var scenarios = (typeof DATA !== 'undefined' && DATA.scenarios) || [];
    var netLongCocoaMt = b.netCocoaMt; // signed net cocoa MT (longs positive)

    var bullPnl = null;
    var rows = scenarios.map(function (s) {
      var nyPx = num(s.nyPx, SPOT_NY_USD);
      var priceMoveUsd = nyPx - SPOT_NY_USD;          // $/t move vs reference
      var priceMoveEur = priceMoveUsd / EURUSD;       // €/t move (USD→EUR)
      var hedgePnlEur = netLongCocoaMt * priceMoveEur; // longs GAIN when price rises
      if (String(s.name).toUpperCase() === 'BULL') bullPnl = hedgePnlEur;

      return '' +
        '<tr>' +
          '<td class="cell-strong">' + s.name + '</td>' +
          '<td class="num mono">' + fNum0(nyPx) + '</td>' +
          '<td class="num mono">' + fSigned(priceMoveUsd) + '</td>' +
          '<td class="num mono muted">' + fPct(num(s.prob)) + '</td>' +
          '<td class="num mono ' + sCls(hedgePnlEur) + '">' + fSignedEur(hedgePnlEur) + '</td>' +
        '</tr>';
    }).join('');

    var table = '' +
      '<div class="section-title">Scenario P&amp;L on the hedge book</div>' +
      '<div class="table-wrap"><table class="table hp-table">' +
        '<thead><tr>' +
          '<th>Scenario</th>' +
          '<th class="th-num">NY px</th>' +
          '<th class="th-num">Move $/t</th>' +
          '<th class="th-num">Prob</th>' +
          '<th class="th-num">Hedge P&amp;L</th>' +
        '</tr></thead>' +
        '<tbody>' + (rows || '<tr><td class="muted" colspan="5">No scenarios</td></tr>') + '</tbody>' +
      '</table></div>';

    var bullTxt = bullPnl == null ? '—' : fSignedEur(bullPnl);
    var takeaway = '' +
      '<div class="hp-note">' +
        '<span class="pill pill-info">OFFSET</span> ' +
        'Long cocoa hedges gain ≈ <strong>' + bullTxt + '</strong> in the Bull case, ' +
        'offsetting higher physical cost; the hedged book is largely neutral. ' +
        'Net P&amp;L exposure is the <strong>unhedged + ineffective</strong> portion — basis ' +
        'risk (NY vs LDN vs physical differential) and any de-designated leg.' +
      '</div>';

    return table + takeaway;
  }

  /* ======================================================================
     SECTION 4 — IFRS-9 recognition split (kv-list)
     ====================================================================== */
  function ifrs9Html() {
    var p = (typeof DATA !== 'undefined' && DATA.hedgeEffectiveness &&
             DATA.hedgeEffectiveness.pnlImpact) || {};
    var oci = num(p.ociAccumulated);
    var ineff = num(p.ineffectiveToPnl);
    var reclass = num(p.reclassOnSettle);

    return '' +
      '<div class="section-title">IFRS-9 recognition — where hedge P&amp;L lands</div>' +
      '<div class="kv-list hp-ifrs">' +
        '<div class="kv">' +
          '<span class="kv-k">Effective portion → OCI <span class="badge badge-pos">OCI</span></span>' +
          '<span class="kv-v mono pos">' + fSignedEur(oci) + '</span>' +
        '</div>' +
        '<div class="kv">' +
          '<span class="kv-k">Ineffective portion → P&amp;L <span class="badge badge-warn">INCOME</span></span>' +
          '<span class="kv-v mono ' + sCls(ineff) + '">' + fSignedEur(ineff) + '</span>' +
        '</div>' +
        '<div class="kv">' +
          '<span class="kv-k">Reclassified on settlement → COGS <span class="badge badge-info">RECLASS</span></span>' +
          '<span class="kv-v mono ' + sCls(reclass) + '">' + fSignedEur(reclass) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="card-sub hp-assume">' +
        'Assumptions: ' + MT_PER_LOT + ' MT/lot · EUR/USD ' + fNum3(EURUSD) + ' · NY reference ' +
        fNum0(SPOT_NY_USD) + ' USD/t · long cocoa hedges gain on a price rise. ' +
        'Effective gains/losses accumulate in OCI and reclassify to COGS as the hedged ' +
        'purchase settles; only the ineffective portion hits the income statement immediately.' +
      '</div>';
  }

  /* --- generic card shell ------------------------------------------------ */
  function wrapCard(modClass, title, sub, inner) {
    return '' +
      '<div class="card ' + modClass + '">' +
        '<div class="card-head">' +
          '<div class="card-title">' + title + '</div>' +
          '<div class="card-sub">' + sub + '</div>' +
        '</div>' +
        '<div class="card-body">' + inner + '</div>' +
      '</div>';
  }

  function pnlCardHtml() {
    var b = computeBook();
    var inner = '';
    try { inner += headlineHtml(b); }  catch (e) { /* keep prior output intact */ }
    try { inner += positionsHtml(b); } catch (e) { /* keep prior output intact */ }
    try { inner += scenarioHtml(b); }  catch (e) { /* keep prior output intact */ }
    try { inner += ifrs9Html(); }      catch (e) { /* keep prior output intact */ }
    return wrapCard('hp-card', 'Hedge P&amp;L Impact',
      'How the hedge positions move P&amp;L · MTM · cocoa price sensitivity · IFRS-9 split',
      inner);
  }

  /* --- inject ONE prefixed <style> (token-driven) ------------------------ */
  function injectStyle() {
    if (document.getElementById('hp-style')) return;
    var css = '' +
      '.hp-card .hp-kpis{margin-bottom:14px;}' +
      '.hp-card .hp-qsub{font-size:10px;color:var(--text-2);font-family:var(--sans);margin-top:2px;}' +
      '.hp-card .hp-table th.th-num,.hp-card .hp-table td.num{text-align:right;}' +
      '.hp-card .hp-table tr.hp-foot td{border-top:1px solid var(--line-2);' +
        'background:var(--bg-2);font-weight:600;}' +
      '.hp-card .section-title{margin-top:18px;}' +
      '.hp-card .hp-ifrs{margin-top:6px;}' +
      '.hp-card .hp-ifrs .kv-k .badge{margin-left:6px;font-size:9px;letter-spacing:.04em;' +
        'vertical-align:middle;}' +
      '.hp-card .hp-note{margin:12px 0 4px;font-size:12px;font-family:var(--sans);' +
        'line-height:1.55;color:var(--text-1);border-left:2px solid var(--info);' +
        'padding:8px 12px;border-radius:6px;background:var(--bg-2);}' +
      '.hp-card .hp-note .pill{margin-right:6px;font-size:9px;letter-spacing:.04em;}' +
      '.hp-card .hp-assume{margin-top:14px;line-height:1.55;}';
    var st = document.createElement('style');
    st.id = 'hp-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* --- compose-wrap VIEWS.hedge.render (pattern A) ----------------------- *
   * VIEWS is a `const` LEXICAL global in app.js — NOT a property of window.  *
   * Reference the bare global (guarded via typeof); never window.VIEWS.      *
   * The prior render is ALREADY wrapped by enh-hedge-optimizer — capture it, *
   * append our card BELOW everything, and keep the prior output intact.      */
  function install() {
    if (typeof VIEWS === 'undefined' || !VIEWS.hedge ||
        typeof VIEWS.hedge.render !== 'function') return false;
    if (VIEWS.hedge.render.__hpWrapped) { window.__cacaoHedgePnlInstalled = true; return true; }

    injectStyle();

    var _r = VIEWS.hedge.render;                 // already wrapped by the optimizer — compose, don't clobber
    var wrapped = function () {
      var base = _r.apply(this, arguments);
      try { return base + pnlCardHtml(); } catch (e) { return base; }
    };
    wrapped.__hpWrapped = true;
    VIEWS.hedge.render = wrapped;
    window.__cacaoHedgePnlInstalled = true;

    // repaint if the Hedge Book is already on screen (CALL switchView; never reassign)
    try {
      if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'hedge'
          && typeof switchView === 'function') {
        switchView('hedge');
      }
    } catch (e) { /* no-op */ }
    return true;
  }

  install();
})();
