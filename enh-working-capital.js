/* ============================================================================
   CACAO/FP — ENHANCEMENT: enh-working-capital.js
   Working Capital & Cash-Conversion Cycle — for the Cash Flow / Treasury view.
   Self-installing IIFE. Loaded AFTER app.js / views2.js / actions.js and after
   the first-wave patches. Compose-wraps VIEWS.cashflow.render (may already be
   wrapped) and APPENDS one "Working Capital & Cash Conversion" card — all prior
   output is preserved. Reuses existing globals/helpers and CSS tokens only.
   Never reassigns switchView (calling it is fine). Idempotent; localStorage-free;
   zero console errors. ENH_CONTRACT / ENH_CONTRACT2 pattern A.

   --- The working-capital model (assumptions stated in the card .card-sub) -----
   Inventory value  = Σ DATA.inventory[i].valueK × 1000          (≈ €38.4M booked)
   Inventory MT     = Σ DATA.inventory[i].mt
   Annual COGS      ≈ avg landed €/t × monthly volume × 12
                      using DATA.kpis.avgCost (€8,142/t) × DATA.whatIf.baseline.volume
                      (6,400 MT/mo) × 12 ≈ €625M.
   DIO (Days Inventory Outstanding) = Inventory value / Annual COGS × 365.
   DPO (Days Payable Outstanding)   = blended supplier-terms assumption (~35d;
                      derived from contract basis mix — Flat terms settle faster
                      than PTBF) → Payables ≈ Annual COGS/365 × DPO.
   DSO (Days Sales Outstanding)     ≈ 0 — procurement side, no trade receivables.
   Cash Conversion Cycle (CCC)      = DIO + DSO − DPO.
   Inventory carry cost = Inventory value × annual carry rate (6%) ×
                      (weighted-avg aging days / 365). Weighted aging derived from
                      DATA.inventory aging buckets (<30d≈15, 30-60d≈45, 60-90d≈75,
                      >90d≈120) weighted by valueK.
   Margin funding cost  ≈ Σ DATA.marginCalls amountK×1000 × short-rate proxy
                      (indicative — broker margin is posted cash that earns nothing).

   Color convention (matches app): cash tied up / cost = .neg/red drag; freeing
   cash / shorter cycle = .pos/green. Numerics use var(--mono).
   ========================================================================== */
(function installWorkingCapital() {
  'use strict';

  /* --- Idempotency guard (double-install safe) ---------------------------- */
  if (window.__cacaoWorkingCapitalInstalled) return;
  window.__cacaoWorkingCapitalInstalled = true;

  /* --- Documented assumptions --------------------------------------------- */
  var CARRY_RATE       = 0.06;   // annual inventory carry rate (warehousing + capital)
  var SHORT_RATE       = 0.035;  // short-rate proxy for margin-cash funding cost
  var DPO_FLAT         = 25;     // payable days for Flat-basis contracts (settle faster)
  var DPO_PTBF         = 45;     // payable days for PTBF-basis contracts (priced later)
  var DSO_DAYS         = 0;      // procurement side — no trade receivables
  var DAYS_PER_YEAR    = 365;
  var MONTHS_PER_YEAR  = 12;
  // Aging-bucket midpoints (days) for weighted-average aging.
  var AGING_DAYS = { '<30d': 15, '30-60d': 45, '60-90d': 75, '>90d': 120 };

  /* --- Local formatter fallbacks (reuse globals when present) ------------- */
  function f_eur(n)        { return (typeof fmtEur === 'function')   ? fmtEur(n)        : '€' + Math.round(n).toLocaleString('en-US'); }
  function f_eurM(n)       { return (typeof fmtEurM === 'function')  ? fmtEurM(n)       : '€' + (n / 1e6).toFixed(2) + 'M'; }
  function f_int(n)        { return (typeof fmtInt === 'function')   ? fmtInt(n)        : Math.round(n).toLocaleString('en-US'); }
  function f_num(n, d)     { return (typeof fmtNum === 'function')   ? fmtNum(n, d)     : Number(n).toFixed(d == null ? 0 : d); }
  function f_pct(n, d)     { return (typeof fmtPct === 'function')   ? fmtPct(n, d)     : Number(n).toFixed(d == null ? 1 : d) + '%'; }

  /* --- Compute the working-capital model ---------------------------------- */
  function model() {
    var inv  = (typeof DATA !== 'undefined' && DATA.inventory) ? DATA.inventory : [];
    var kpis = (typeof DATA !== 'undefined' && DATA.kpis) ? DATA.kpis : {};
    var wi   = (typeof DATA !== 'undefined' && DATA.whatIf && DATA.whatIf.baseline)
                 ? DATA.whatIf.baseline : { volume: 6400 };
    var contracts = (typeof DATA !== 'undefined' && DATA.contracts) ? DATA.contracts : [];
    var marginCalls = (typeof DATA !== 'undefined' && DATA.marginCalls) ? DATA.marginCalls : [];

    /* Inventory value (€) and MT from the booked WAC valuation. */
    var invValue = 0, invMt = 0;
    inv.forEach(function (r) {
      invValue += (Number(r.valueK) || 0) * 1000;
      invMt    += (Number(r.mt) || 0);
    });

    /* Annual COGS: avg landed €/t × monthly volume × 12. */
    var avgLanded = (kpis.avgCost && kpis.avgCost.value) ? kpis.avgCost.value : 8142;
    var monthlyVol = Number(wi.volume) || 6400;
    var annualCogs = avgLanded * monthlyVol * MONTHS_PER_YEAR;
    var cogsPerDay = annualCogs / DAYS_PER_YEAR;

    /* DIO from booked inventory against annual COGS. */
    var dio = invValue > 0 && annualCogs > 0 ? (invValue / annualCogs) * DAYS_PER_YEAR : 0;

    /* Blended DPO derived from the contract basis mix (PTBF settles later than Flat). */
    var ptbf = 0, flat = 0;
    contracts.forEach(function (c) {
      if (String(c.basis).toUpperCase() === 'PTBF') ptbf++;
      else flat++;
    });
    var nContr = ptbf + flat;
    var dpo = nContr > 0
      ? (ptbf * DPO_PTBF + flat * DPO_FLAT) / nContr
      : (DPO_PTBF + DPO_FLAT) / 2;
    var payables = cogsPerDay * dpo;

    /* Cash conversion cycle. */
    var ccc = dio + DSO_DAYS - dpo;

    /* Weighted-average aging (days) by valueK, then carry cost. */
    var agingWeighted = 0, agingDenom = 0;
    var bucketAgg = {}; // aging -> { valueEur, mt }
    inv.forEach(function (r) {
      var v = (Number(r.valueK) || 0) * 1000;
      var days = AGING_DAYS[r.aging];
      if (days == null) days = 30;
      agingWeighted += v * days;
      agingDenom    += v;
      if (!bucketAgg[r.aging]) bucketAgg[r.aging] = { valueEur: 0, mt: 0 };
      bucketAgg[r.aging].valueEur += v;
      bucketAgg[r.aging].mt       += (Number(r.mt) || 0);
    });
    var wAging = agingDenom > 0 ? agingWeighted / agingDenom : 0;
    var carryCost = invValue * CARRY_RATE * (wAging / DAYS_PER_YEAR);

    /* Ordered aging buckets for the bar-h breakdown. */
    var bucketOrder = ['<30d', '30-60d', '60-90d', '>90d'];
    var buckets = bucketOrder
      .filter(function (k) { return bucketAgg[k]; })
      .map(function (k) {
        var b = bucketAgg[k];
        return {
          label: k,
          valueEur: b.valueEur,
          mt: b.mt,
          days: AGING_DAYS[k],
          pct: agingDenom > 0 ? (b.valueEur / agingDenom) * 100 : 0,
          stale: (AGING_DAYS[k] >= 120),
        };
      });

    /* >90d slow-stock free-up opportunity. */
    var slow = bucketAgg['>90d'] ? bucketAgg['>90d'].valueEur : 0;
    var slowCarryPerYr = slow * CARRY_RATE; // full-year carry on the stale tranche

    /* Net working capital tied up = inventory + receivables − payables. */
    var nwc = invValue + 0 /* receivables */ - payables;

    /* Indicative margin-cash funding cost (posted broker margin earns nothing). */
    var marginPosted = 0;
    marginCalls.forEach(function (m) { marginPosted += (Number(m.amountK) || 0) * 1000; });
    var marginFunding = marginPosted * SHORT_RATE;

    return {
      invValue: invValue, invMt: invMt, kpiInvValue: (kpis.invValue && kpis.invValue.value) ? kpis.invValue.value : null,
      avgLanded: avgLanded, monthlyVol: monthlyVol, annualCogs: annualCogs, cogsPerDay: cogsPerDay,
      dio: dio, dpo: dpo, dso: DSO_DAYS, ccc: ccc, payables: payables, nwc: nwc,
      wAging: wAging, carryCost: carryCost, buckets: buckets,
      ptbf: ptbf, flat: flat, nContr: nContr,
      slow: slow, slowCarryPerYr: slowCarryPerYr,
      marginPosted: marginPosted, marginFunding: marginFunding,
    };
  }

  /* --- Headline qstat-grid (reuse .qstat-grid / .qstat) ------------------- */
  function headlineHtml(m) {
    // Shorter cycle / lower carry = good. CCC color: lower is better.
    var cccCls = m.ccc <= 0 ? 'pos' : (m.ccc > 30 ? 'neg' : 'warn');
    return '<div class="qstat-grid wc-headline">' +
      '<div class="qstat"><div class="qstat-label">DIO · Days Inventory</div>' +
        '<div class="qstat-value mono">' + f_num(m.dio, 0) + '<span class="wc-unit"> days</span></div></div>' +
      '<div class="qstat"><div class="qstat-label">DPO · Days Payable</div>' +
        '<div class="qstat-value mono">' + f_num(m.dpo, 0) + '<span class="wc-unit"> days</span></div></div>' +
      '<div class="qstat"><div class="qstat-label">Cash Conversion Cycle</div>' +
        '<div class="qstat-value mono ' + cccCls + '">' + f_num(m.ccc, 0) + '<span class="wc-unit"> days</span></div></div>' +
      '<div class="qstat"><div class="qstat-label">Inventory Carry Cost</div>' +
        '<div class="qstat-value mono neg">' + f_eurM(m.carryCost) + '<span class="wc-unit"> /yr</span></div></div>' +
      '</div>';
  }

  /* --- CCC formula strip (DIO + DSO − DPO) -------------------------------- */
  function cccStripHtml(m) {
    return '<div class="wc-ccc">' +
      '<span class="wc-ccc-term"><span class="wc-ccc-k">DIO</span>' +
        '<span class="wc-ccc-v mono">' + f_num(m.dio, 0) + 'd</span></span>' +
      '<span class="wc-ccc-op">+</span>' +
      '<span class="wc-ccc-term"><span class="wc-ccc-k">DSO</span>' +
        '<span class="wc-ccc-v mono">' + f_num(m.dso, 0) + 'd</span></span>' +
      '<span class="wc-ccc-op">−</span>' +
      '<span class="wc-ccc-term"><span class="wc-ccc-k">DPO</span>' +
        '<span class="wc-ccc-v mono">' + f_num(m.dpo, 0) + 'd</span></span>' +
      '<span class="wc-ccc-op">=</span>' +
      '<span class="wc-ccc-term wc-ccc-total"><span class="wc-ccc-k">CCC</span>' +
        '<span class="wc-ccc-v mono ' + (m.ccc > 30 ? 'neg' : (m.ccc <= 0 ? 'pos' : 'warn')) + '">' +
        f_num(m.ccc, 0) + 'd</span></span>' +
      '</div>';
  }

  /* --- Supporting working-capital table (reuse .table / .kv markup) ------- */
  function wcTableHtml(m) {
    var reconNote = (m.kpiInvValue != null)
      ? '<span class="wc-note"> · booked WAC; dashboard KPI shows €' + f_num(m.kpiInvValue, 1) + 'M incl. in-transit/open</span>'
      : '';
    var rows =
      '<tr><td class="cell-strong">Inventory value (booked)</td>' +
        '<td class="num mono">' + f_eurM(m.invValue) + reconNote + '</td></tr>' +
      '<tr><td class="cell-strong">Inventory quantity</td>' +
        '<td class="num mono">' + f_int(m.invMt) + ' MT</td></tr>' +
      '<tr><td class="cell-strong">Weighted-avg aging</td>' +
        '<td class="num mono">' + f_num(m.wAging, 0) + ' days</td></tr>' +
      '<tr><td class="cell-strong">Annual COGS (run-rate)</td>' +
        '<td class="num mono">' + f_eurM(m.annualCogs) + '</td></tr>' +
      '<tr><td class="cell-strong">Trade payables (≈ ' + f_num(m.dpo, 0) + 'd)</td>' +
        '<td class="num mono">' + f_eurM(m.payables) + '</td></tr>' +
      '<tr class="wc-row-total"><td class="cell-strong">Net working capital ' +
        (m.nwc < 0 ? '(supplier-funded)' : 'tied up') + '</td>' +
        '<td class="num mono ' + (m.nwc < 0 ? 'pos' : 'neg') + '">' + f_eurM(m.nwc) + '</td></tr>';
    return '<div class="table-wrap"><table class="table wc-table">' +
      '<thead><tr><th>Working-capital component</th><th class="th-num">Value</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  /* --- Aging-by-bucket .bar-h breakdown ----------------------------------- */
  function agingBarsHtml(m) {
    if (!m.buckets.length) return '';
    var bars = m.buckets.map(function (b) {
      var fillCls = b.stale ? ' wc-bar-stale' : '';
      return '<div class="wc-bar-row">' +
        '<div class="wc-bar-head">' +
          '<span class="wc-bar-label">' + b.label +
            '<span class="wc-bar-days mono"> · ~' + b.days + 'd</span></span>' +
          '<span class="wc-bar-val mono">' + f_eurM(b.valueEur) +
            ' <span class="wc-bar-pct">' + f_pct(b.pct, 0) + '</span></span>' +
        '</div>' +
        '<div class="bar-h"><div class="bar-h-fill' + fillCls + '" style="width:' +
          Math.max(2, Math.min(100, b.pct)).toFixed(1) + '%"></div></div>' +
        '</div>';
    }).join('');
    return '<div class="wc-bars">' + bars + '</div>';
  }

  /* --- CFO takeaway -------------------------------------------------------- */
  function takeawayHtml(m) {
    var slowTxt = m.slow > 0
      ? 'Cutting the ' + f_eurM(m.slow) + ' of &gt;90d slow stock would free ≈' +
        f_eurM(m.slow) + ' of cash and save ≈' + f_eurM(m.slowCarryPerYr) + '/yr in carry.'
      : 'No &gt;90d slow stock outstanding — aging profile is clean.';
    // Negative NWC = supplier terms more than fund the inventory (a cash source, favorable).
    var nwcTxt = m.nwc < 0
      ? '≈' + f_eurM(Math.abs(m.nwc)) + ' of cocoa working capital is supplier-funded (negative ' +
        'net working capital — payable terms more than cover the inventory), with a cash-conversion'
      : '≈' + f_eurM(m.nwc) + ' is tied up in cocoa working capital, with a cash-conversion';
    return '<div class="wc-takeaway">' +
      '<span class="wc-takeaway-tag">CFO TAKEAWAY</span> ' +
      nwcTxt +
      ' cycle of ' + f_num(m.ccc, 0) + ' days (DIO ' + f_num(m.dio, 0) + 'd − DPO ' +
      f_num(m.dpo, 0) + 'd; no receivables). Inventory carry still runs ≈' + f_eurM(m.carryCost) +
      '/yr at a ' + f_pct(CARRY_RATE * 100, 0) + ' rate. ' + slowTxt +
      ' Broker margin of ' + f_eurM(m.marginPosted) + ' posted as cash costs ≈' +
      f_eurM(m.marginFunding) + '/yr in funding (indicative @ ' + f_pct(SHORT_RATE * 100, 1) + ').' +
      '</div>';
  }

  /* --- The appended card --------------------------------------------------- */
  function workingCapitalCard() {
    var m = model();
    return '<div class="card wc-card" id="wc-working-capital">' +
      '<div class="card-head">' +
        '<div class="card-title">Working Capital &amp; Cash Conversion</div>' +
        '<div class="card-sub">DIO/DPO/CCC and inventory carry from booked WAC · ' +
          'COGS run-rate = €' + f_int(m.avgLanded) + '/t × ' + f_int(m.monthlyVol) +
          ' MT/mo × 12 ≈ ' + f_eurM(m.annualCogs) + ' · ' +
          'DPO blended from ' + m.ptbf + ' PTBF (' + DPO_PTBF + 'd) + ' + m.flat + ' Flat (' +
          DPO_FLAT + 'd) contracts · DSO 0 (no trade receivables) · carry @ ' +
          f_pct(CARRY_RATE * 100, 0) + '/yr</div>' +
      '</div>' +
      '<div class="card-body">' +
        headlineHtml(m) +
        cccStripHtml(m) +
        '<div class="grid grid-2 wc-grid">' +
          '<div>' +
            '<div class="section-title">Working-Capital Bridge</div>' +
            wcTableHtml(m) +
          '</div>' +
          '<div>' +
            '<div class="section-title">Inventory Value by Aging</div>' +
            agingBarsHtml(m) +
          '</div>' +
        '</div>' +
        takeawayHtml(m) +
      '</div>' +
    '</div>';
  }

  /* --- Styles: token-driven, module-prefixed (wc-*); reuse existing classes  */
  function injectStyles() {
    if (document.getElementById('wc-styles')) return;
    var css =
      '.wc-headline{margin-bottom:14px;}' +
      '.wc-unit{color:var(--text-2);font-size:11px;font-weight:400;}' +
      '.wc-note{color:var(--text-2);font-size:10px;font-weight:400;}' +
      '.wc-ccc{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px;' +
        'margin-bottom:16px;background:var(--bg-2);border:1px solid var(--line);border-radius:8px;}' +
      '.wc-ccc-term{display:flex;flex-direction:column;align-items:center;min-width:54px;}' +
      '.wc-ccc-k{color:var(--text-2);font-size:10px;letter-spacing:.04em;}' +
      '.wc-ccc-v{font-size:15px;color:var(--text-0);}' +
      '.wc-ccc-op{color:var(--text-3);font-size:15px;font-family:var(--mono);}' +
      '.wc-ccc-total .wc-ccc-k{color:var(--accent);}' +
      '.wc-grid{align-items:start;}' +
      '.wc-table td,.wc-table th{vertical-align:middle;}' +
      '.wc-row-total td{border-top:1px solid var(--line-2);font-weight:600;}' +
      '.wc-bars{display:flex;flex-direction:column;gap:12px;padding-top:2px;}' +
      '.wc-bar-head{display:flex;justify-content:space-between;align-items:baseline;' +
        'margin-bottom:5px;font-size:12px;}' +
      '.wc-bar-label{color:var(--text-1);}' +
      '.wc-bar-days{color:var(--text-3);font-size:10px;}' +
      '.wc-bar-val{color:var(--text-0);font-size:12px;}' +
      '.wc-bar-pct{color:var(--text-2);font-size:10px;margin-left:4px;}' +
      '.wc-bar-stale{background:linear-gradient(90deg,var(--neg-dim),var(--neg));}' +
      '.wc-takeaway{margin-top:16px;padding:12px 14px;background:var(--bg-2);' +
        'border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;' +
        'color:var(--text-1);font-size:12px;line-height:1.6;}' +
      '.wc-takeaway-tag{display:inline-block;font-family:var(--mono);font-size:10px;' +
        'letter-spacing:.06em;color:var(--accent);font-weight:600;margin-right:4px;}';
    var style = document.createElement('style');
    style.id = 'wc-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* --- Compose-wrap VIEWS.cashflow.render (pattern A) --------------------- */
  function wrapCashflowRender() {
    // VIEWS is a top-level `const` in app.js — NOT a window property. Reference
    // the bare global (guarded via typeof); never window.VIEWS.
    if (typeof VIEWS === 'undefined' || !VIEWS.cashflow ||
        typeof VIEWS.cashflow.render !== 'function') return false;
    if (VIEWS.cashflow.render.__wcWrapped) return true; // already composed by us
    var prior = VIEWS.cashflow.render; // may already be wrapped — fine
    var wrapped = function () {
      var out = prior(); // keep ALL prior output (base cashflow view + any prior cards)
      try {
        return out + workingCapitalCard();
      } catch (err) {
        // Never break the view; fail soft so prior cards still render.
        return out;
      }
    };
    wrapped.__wcWrapped = true;
    VIEWS.cashflow.render = wrapped;
    return true;
  }

  /* --- Install ------------------------------------------------------------- */
  injectStyles();
  if (wrapCashflowRender()) {
    // Repaint if the user is already on the Cash Flow view (calling switchView is allowed).
    if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'cashflow' &&
        typeof switchView === 'function') {
      switchView('cashflow');
    }
  }
})();
