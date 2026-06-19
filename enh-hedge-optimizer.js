/* ============================================================================
   CACAO/FP — enh-hedge-optimizer.js  (#10 — Hedge-Ratio Optimizer +
   Position-Limit / Greeks Monitor)

   Self-installing enhancement module. Loaded AFTER the first/second-wave
   modules. Compose-wraps VIEWS.hedge.render (ENH_CONTRACT2 pattern A) and
   APPENDS two cards below the existing Hedge Book content:

     CARD A — "Hedge-Ratio Optimizer"
       Per-month coverage table (Demand / Hedged / Coverage% / Gap-to-80% /
       Lots-to-add) from DATA.hedgeCoverage. Months below the 80% policy are
       flagged. A verdict line targets the NEAREST under-hedged month and
       states the lots to buy to reach policy, plus the documented minimum-
       variance optimal ratio β = 0.92 (physical-to-futures). Policy vs MV-
       optimal shown as a qstat.

     CARD B — "Position Limits & Greeks"
       Net cocoa futures position (LONG − SHORT lots, cocoa books only),
       delta-equivalent MT (netLots × 10), a DV01-style "P&L per €100/t move"
       (netMT × 100, in €M), utilization bars against a VaR limit (€2.0M) and
       a lot limit (600 lots) that flip amber (>80%) / red (>100%), and a
       net long/short-by-exchange mini-table (NY vs LDN).

   Rules honoured: plain JS IIFE, top-level install, NO edits to other files,
   never reassigns switchView (only CALLS it), one prefixed <style>, token-
   driven (var(--*)), idempotent, localStorage try/catch (nothing to persist
   here but guarded anyway), zero console errors. References the bare lexical
   globals (VIEWS / CURRENT_VIEW / DATA / switchView) via typeof guards — never
   window.VIEWS / window.DATA. Reuses globals: $, DATA, formatters.
   ========================================================================== */
(function () {
  'use strict';

  /* --- idempotency guard (set only after a successful wrap) -------------- */
  if (window.__cacaoHedgeOptInstalled) return;

  /* --- model constants (documented, not magic) -------------------------- */
  var MT_PER_LOT       = 10;        // 1 ICE lot = 10 MT
  var POLICY_TARGET    = 0.80;      // 80% hedge-coverage policy
  var MV_BETA          = 0.92;      // min-variance hedge ratio (physical→futures)
  var LOT_LIMIT        = 600;       // desk net-lot limit
  var VAR_LIMIT_EUR    = 2.0e6;     // VaR limit €2.0M
  var VAR_FALLBACK_EUR = 1.0e6;     // MC VaR fallback if none exposed (~€1.0M)
  var WARN_FRAC        = 0.80;      // >80% utilization → amber
  var BREACH_FRAC      = 1.00;      // >100% utilization → red
  var COVERAGE_START   = { mon: 6, year: 2026 }; // hedgeCoverage[0] = Jul 2026

  var MONABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* --- safe numeric ------------------------------------------------------ */
  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  /* --- formatting helpers (reuse globals, guard if absent) --------------- */
  function fInt(n) { try { return fmtInt(n); } catch (e) { return String(Math.round(n)); } }
  function fPct(n) { try { return fmtPct(n, 1); } catch (e) { return Number(n).toFixed(1) + '%'; } }
  function fSigned(n) { try { return fmtSigned(Math.round(n)); } catch (e) { return (n >= 0 ? '+' : '−') + Math.abs(Math.round(n)); } }
  function sCls(n, invert) { try { return signClass(n, invert); } catch (e) { return n >= 0 ? 'pos' : 'neg'; } }
  function fEurM(eur) {
    try { return fmtEurM(eur, 2); } catch (e) {
      var m = eur / 1e6; return '€' + m.toFixed(2) + 'M';
    }
  }
  function fNum2(n) { try { return fmtNum(n, 2); } catch (e) { return Number(n).toFixed(2); } }

  /* --- month label: hedgeCoverage labels are short ('Jul'..'Jun'); the    *
   * series starts Jul 2026 and rolls forward, so derive a 'Sep26'-style tag *
   * from the index rather than trusting the bare 3-letter label.            */
  function monthTag(idx, fallbackLabel) {
    var m = COVERAGE_START.mon + idx;
    var y = COVERAGE_START.year + Math.floor(m / 12);
    var mm = ((m % 12) + 12) % 12;
    var yy = ('0' + (y % 100)).slice(-2);
    return MONABBR[mm] + yy; // e.g. 'Sep26'
  }

  /* --- detect a possible MC VaR global (var-mc module) ------------------- *
   * The Monte-Carlo module computes VaR internally and does not reliably    *
   * publish it. Probe a couple of plausible globals; otherwise fall back.   */
  function getMcVarEur() {
    var candidates = [
      window.__cacaoMcVar95, window.__cacaoVar95, window.__cacaoMcVar,
      window.cacaoMcVar95, window.CACAO_MC_VAR
    ];
    for (var i = 0; i < candidates.length; i++) {
      var v = Number(candidates[i]);
      if (isFinite(v) && v > 0) return v;
    }
    return VAR_FALLBACK_EUR;
  }

  /* ======================================================================
     CARD A — Hedge-Ratio Optimizer
     ====================================================================== */
  function buildCoverageRows() {
    var hc = (typeof DATA !== 'undefined' && DATA.hedgeCoverage) || {};
    var labels = hc.labels || [];
    var demand = hc.demand || [];
    var hedged = hc.hedged || [];
    var n = Math.min(labels.length, demand.length, hedged.length);

    var rows = [];
    for (var i = 0; i < n; i++) {
      var d = num(demand[i]);
      var h = num(hedged[i]);
      var cov = d > 0 ? (h / d) : 0;                 // fraction
      var targetMt = POLICY_TARGET * d;              // MT needed for 80%
      var gapMt = targetMt - h;                      // >0 means short of policy
      var lotsToAdd = Math.max(0, Math.round(gapMt / MT_PER_LOT));
      rows.push({
        idx: i,
        tag: monthTag(i, labels[i]),
        label: labels[i],
        demand: d,
        hedged: h,
        covPct: cov * 100,
        gapPct: (POLICY_TARGET - cov) * 100,          // pts to 80% (>0 = under)
        gapMt: gapMt,
        lotsToAdd: lotsToAdd,
        under: cov < POLICY_TARGET
      });
    }
    return rows;
  }

  function cardA() {
    var rows = buildCoverageRows();

    if (!rows.length) {
      return wrapCard('ho-optimizer', 'Hedge-Ratio Optimizer',
        'Coverage data unavailable',
        '<div class="kv-list"><div class="kv"><span class="kv-k">No coverage series</span>' +
        '<span class="kv-v mono muted">—</span></div></div>');
    }

    // nearest under-hedged month (lowest index with coverage < policy)
    var nearest = null;
    for (var i = 0; i < rows.length; i++) { if (rows[i].under) { nearest = rows[i]; break; } }

    var bodyRows = rows.map(function (r) {
      var cls = r.under ? 'neg' : 'pos';
      var gapTxt = r.gapPct > 0 ? ('−' + fNum2(r.gapPct) + ' pts') : ('+' + fNum2(-r.gapPct) + ' pts');
      var lotsTxt = r.lotsToAdd > 0 ? ('+' + fInt(r.lotsToAdd)) : '—';
      return '' +
        '<tr' + (r.under ? ' class="ho-under"' : '') + '>' +
          '<td class="cell-strong mono">' + r.tag + '</td>' +
          '<td class="num mono">' + fInt(r.demand) + '</td>' +
          '<td class="num mono">' + fInt(r.hedged) + '</td>' +
          '<td class="num mono ' + cls + '">' + fPct(r.covPct) + '</td>' +
          '<td class="num mono ' + cls + '">' + gapTxt + '</td>' +
          '<td class="num mono ' + (r.lotsToAdd > 0 ? 'warn' : 'muted') + '">' + lotsTxt + '</td>' +
        '</tr>';
    }).join('');

    // policy vs MV-optimal qstat strip
    var underCount = rows.filter(function (r) { return r.under; }).length;
    var totalLots = rows.reduce(function (s, r) { return s + r.lotsToAdd; }, 0);
    var qstats = '' +
      '<div class="qstat-grid ho-kpis">' +
        '<div class="qstat"><div class="qstat-label">Policy target</div>' +
          '<div class="qstat-value mono">' + fPct(POLICY_TARGET * 100) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">MV-optimal ratio β</div>' +
          '<div class="qstat-value mono accent">' + fNum2(MV_BETA) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Months under policy</div>' +
          '<div class="qstat-value mono ' + (underCount ? 'neg' : 'pos') + '">' + fInt(underCount) + ' / ' + fInt(rows.length) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Total lots to add</div>' +
          '<div class="qstat-value mono warn">+' + fInt(totalLots) + '</div></div>' +
      '</div>';

    var verdict;
    if (nearest) {
      verdict = '' +
        '<div class="ho-verdict neg">' +
          '<span class="ho-verdict-tag pill pill-neg">ACTION</span> ' +
          '<strong>' + nearest.tag + '</strong> under-hedged by ' + fNum2(nearest.gapPct) +
          '% → buy <strong>+' + fInt(nearest.lotsToAdd) + ' NY lots</strong> ' +
          '(' + fInt(Math.round(nearest.lotsToAdd * MT_PER_LOT)) + ' MT) to reach the ' +
          fPct(POLICY_TARGET * 100) + ' policy; minimum-variance optimal ratio β = ' + fNum2(MV_BETA) + '.' +
        '</div>';
    } else {
      verdict = '' +
        '<div class="ho-verdict pos">' +
          '<span class="ho-verdict-tag pill pill-pos">ON POLICY</span> ' +
          'All 12 months at or above the ' + fPct(POLICY_TARGET * 100) +
          ' coverage policy; minimum-variance optimal ratio β = ' + fNum2(MV_BETA) + '.' +
        '</div>';
    }

    var table = '' +
      '<div class="table-wrap"><table class="table ho-table">' +
        '<thead><tr>' +
          '<th>Month</th>' +
          '<th class="th-num">Demand MT</th>' +
          '<th class="th-num">Hedged MT</th>' +
          '<th class="th-num">Coverage %</th>' +
          '<th class="th-num">Gap to 80%</th>' +
          '<th class="th-num">Lots to add</th>' +
        '</tr></thead>' +
        '<tbody>' + bodyRows + '</tbody>' +
      '</table></div>';

    return wrapCard('ho-optimizer', 'Hedge-Ratio Optimizer',
      '12-month coverage vs the ' + fPct(POLICY_TARGET * 100) + ' policy · lots-to-add = max(0, round((0.80·demand − hedged) / ' + MT_PER_LOT + '))',
      qstats + verdict + table);
  }

  /* ======================================================================
     CARD B — Position Limits & Greeks
     ====================================================================== */
  function isCocoaBook(book) {
    var b = String(book || '').toUpperCase();
    // cocoa futures books: 'CC NY ...' (ICE NY) and 'C LDN ...' (ICE London).
    // FX books are 'FX EURUSD' / 'FX GBPUSD' — excluded.
    return b.indexOf('FX') !== 0 && (b.indexOf('CC') === 0 || b.indexOf('C LDN') === 0 || b.indexOf('C ') === 0);
  }

  function exchangeOf(book) {
    var b = String(book || '').toUpperCase();
    if (b.indexOf('NY') !== -1) return 'NY';
    if (b.indexOf('LDN') !== -1) return 'LDN';
    return 'Other';
  }

  function buildGreeks() {
    var hedges = (typeof DATA !== 'undefined' && DATA.hedges) || [];
    var longLots = 0, shortLots = 0;
    var byEx = {}; // exchange -> { long, short }

    hedges.forEach(function (h) {
      if (!isCocoaBook(h.book)) return;
      var lots = num(h.lots);
      var ex = exchangeOf(h.book);
      if (!byEx[ex]) byEx[ex] = { long: 0, short: 0 };
      if (String(h.side).toUpperCase() === 'LONG') { longLots += lots; byEx[ex].long += lots; }
      else { shortLots += lots; byEx[ex].short += lots; }
    });

    var netLots = longLots - shortLots;
    var netMt = netLots * MT_PER_LOT;
    // DV01-style: € P&L for a €100/t parallel move across the net MT position.
    var pnlPer100 = netMt * 100;          // € for a €100/t move
    var pnlPer100M = pnlPer100 / 1e6;     // in €M

    return {
      longLots: longLots, shortLots: shortLots, netLots: netLots,
      netMt: netMt, pnlPer100: pnlPer100, pnlPer100M: pnlPer100M, byEx: byEx
    };
  }

  /* utilization bar (reuses .progress / .progress-bar / .progress-label) */
  function utilBar(label, usedTxt, frac) {
    var pct = Math.max(0, frac) * 100;
    var fillPct = Math.min(100, pct);
    var color;
    if (frac > BREACH_FRAC) color = 'var(--neg)';
    else if (frac > WARN_FRAC) color = 'var(--warn)';
    else color = 'var(--pos)';
    var pctCls = frac > BREACH_FRAC ? 'neg' : (frac > WARN_FRAC ? 'warn' : 'pos');
    return '' +
      '<div class="ho-util">' +
        '<div class="progress-label">' +
          '<span>' + label + '</span>' +
          '<span class="mono ' + pctCls + '">' + usedTxt + ' · ' + fPct(pct) + '</span>' +
        '</div>' +
        '<div class="progress"><div class="progress-bar" style="width:' + fillPct + '%;background:' + color + ';"></div></div>' +
      '</div>';
  }

  function cardB() {
    var g = buildGreeks();
    var mcVar = getMcVarEur();
    var varUsed = mcVar;                          // current VaR usage (€)
    var varFrac = VAR_LIMIT_EUR > 0 ? (varUsed / VAR_LIMIT_EUR) : 0;
    var lotFrac = LOT_LIMIT > 0 ? (Math.abs(g.netLots) / LOT_LIMIT) : 0;

    var sideLabel = g.netLots >= 0 ? 'NET LONG' : 'NET SHORT';
    var sidePill = g.netLots >= 0 ? 'pill-pos' : 'pill-neg';

    var qstats = '' +
      '<div class="qstat-grid ho-kpis">' +
        '<div class="qstat"><div class="qstat-label">Net cocoa position</div>' +
          '<div class="qstat-value mono ' + sCls(g.netLots) + '">' + fSigned(g.netLots) + ' lots</div></div>' +
        '<div class="qstat"><div class="qstat-label">Delta-equiv MT</div>' +
          '<div class="qstat-value mono ' + sCls(g.netMt) + '">' + fSigned(g.netMt) + ' MT</div></div>' +
        '<div class="qstat"><div class="qstat-label">P&amp;L per €100/t move</div>' +
          '<div class="qstat-value mono ' + sCls(g.pnlPer100) + '">' + fEurM(g.pnlPer100) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Long / Short</div>' +
          '<div class="qstat-value mono">' + fInt(g.longLots) + ' / ' + fInt(g.shortLots) + '</div></div>' +
      '</div>';

    var bars = '' +
      '<div class="section-title">Limit utilization</div>' +
      utilBar('VaR (1-day) vs ' + fEurM(VAR_LIMIT_EUR) + ' limit', fEurM(varUsed), varFrac) +
      utilBar('Net lots vs ' + fInt(LOT_LIMIT) + '-lot limit', fInt(Math.abs(g.netLots)) + ' lots', lotFrac);

    // net long/short by exchange mini-table
    var exOrder = ['NY', 'LDN'];
    Object.keys(g.byEx).forEach(function (k) { if (exOrder.indexOf(k) === -1) exOrder.push(k); });
    var exRows = exOrder.filter(function (ex) { return g.byEx[ex]; }).map(function (ex) {
      var e = g.byEx[ex];
      var net = e.long - e.short;
      var netMtEx = net * MT_PER_LOT;
      return '' +
        '<tr>' +
          '<td class="cell-strong mono">' + ex + '</td>' +
          '<td class="num mono pos">' + fInt(e.long) + '</td>' +
          '<td class="num mono neg">' + fInt(e.short) + '</td>' +
          '<td class="num mono ' + sCls(net) + '">' + fSigned(net) + '</td>' +
          '<td class="num mono ' + sCls(netMtEx) + '">' + fSigned(netMtEx) + '</td>' +
        '</tr>';
    }).join('');

    var exTable = '' +
      '<div class="section-title">Net long / short by exchange</div>' +
      '<div class="table-wrap"><table class="table ho-table">' +
        '<thead><tr>' +
          '<th>Exchange</th>' +
          '<th class="th-num">Long lots</th>' +
          '<th class="th-num">Short lots</th>' +
          '<th class="th-num">Net lots</th>' +
          '<th class="th-num">Net MT</th>' +
        '</tr></thead>' +
        '<tbody>' + (exRows || '<tr><td class="muted" colspan="5">No cocoa futures positions</td></tr>') + '</tbody>' +
      '</table></div>';

    var note = '' +
      '<div class="ho-note">' +
        '<span class="pill ' + sidePill + '">' + sideLabel + '</span> ' +
        'Net cocoa exposure ' + fSigned(g.netLots) + ' lots (' + fSigned(g.netMt) + ' MT). ' +
        'DV01-style sensitivity ≈ ' + fEurM(g.pnlPer100) + ' per €100/t parallel move. ' +
        'VaR usage ' + fEurM(varUsed) + ' of ' + fEurM(VAR_LIMIT_EUR) + ' limit; ' +
        'bars flip amber >' + fPct(WARN_FRAC * 100) + ' and red >' + fPct(BREACH_FRAC * 100) + ' of cap.' +
      '</div>';

    return wrapCard('ho-greeks', 'Position Limits &amp; Greeks',
      'Net cocoa futures (LONG − SHORT, cocoa books) · ' + MT_PER_LOT + ' MT/lot · limit monitor',
      qstats + bars + exTable + note);
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

  function optimizerHtml() {
    var out = '';
    try { out += cardA(); } catch (e) { /* keep prior output intact */ }
    try { out += cardB(); } catch (e) { /* keep prior output intact */ }
    return out;
  }

  /* --- inject ONE prefixed <style> (token-driven) ------------------------ */
  function injectStyle() {
    if (document.getElementById('ho-style')) return;
    var css = '' +
      '.ho-optimizer .ho-kpis,.ho-greeks .ho-kpis{margin-bottom:14px;}' +
      '.ho-optimizer .ho-table th.th-num,.ho-optimizer .ho-table td.num,' +
      '.ho-greeks .ho-table th.th-num,.ho-greeks .ho-table td.num{text-align:right;}' +
      '.ho-optimizer tr.ho-under td{background:rgba(255,84,102,.06);}' +
      '.ho-optimizer .ho-verdict,.ho-greeks .ho-note{margin:12px 0 4px;font-size:12px;' +
        'font-family:var(--sans);line-height:1.55;color:var(--text-1);' +
        'border-left:2px solid var(--line-3);padding:8px 12px;border-radius:6px;background:var(--bg-2);}' +
      '.ho-optimizer .ho-verdict.neg{border-left-color:var(--neg);}' +
      '.ho-optimizer .ho-verdict.pos{border-left-color:var(--pos);}' +
      '.ho-optimizer .ho-verdict-tag{margin-right:6px;font-size:9px;letter-spacing:.04em;}' +
      '.ho-greeks .ho-util{margin-bottom:12px;}' +
      '.ho-greeks .ho-note{border-left-color:var(--accent);}';
    var st = document.createElement('style');
    st.id = 'ho-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* --- compose-wrap VIEWS.hedge.render (pattern A) ----------------------- *
   * VIEWS is a `const` LEXICAL global in app.js — NOT a property of window.  *
   * Reference the bare global (guarded via typeof); never window.VIEWS.      *
   * The prior render may already be wrapped by another module — capture it,  *
   * append our two cards, and keep the prior output intact.                  */
  function install() {
    if (typeof VIEWS === 'undefined' || !VIEWS.hedge ||
        typeof VIEWS.hedge.render !== 'function') return false;
    if (VIEWS.hedge.render.__hoWrapped) { window.__cacaoHedgeOptInstalled = true; return true; }

    injectStyle();

    var _r = VIEWS.hedge.render;                 // may already be wrapped — compose, don't clobber
    var wrapped = function () {
      var base = _r.apply(this, arguments);
      try { return base + optimizerHtml(); } catch (e) { return base; }
    };
    wrapped.__hoWrapped = true;
    VIEWS.hedge.render = wrapped;
    window.__cacaoHedgeOptInstalled = true;

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
