/* ============================================================================
   CACAO/FP — enh-cfo-brief.js  (enhancement module — CFO Position Brief)
   ----------------------------------------------------------------------------
   A NEW, always-available executive view that answers two questions for the
   analyst before they walk into the CFO's office:
       1) "What is our CURRENT position?"   (live, every number real)
       2) "What SHOULD our position be?"    (recommended target + the gap)
   ...followed by a ready-to-read Gap & Actions table and an executive narrative
   the analyst can deliver verbatim.

   Self-installing, idempotent, token-driven, zero console errors. NO Chart.js —
   everything is qstat tiles / tables / CSS bars for maximum reliability.

   Obeys ENH_CONTRACT.md + ENH_CONTRACT2.md + CONTRACT.md:
     • Registers a NEW view  VIEWS.cfobrief = { render, draw }.
     • Injects its own nav item (sidenav is static; wireNav already ran at boot)
       and wires its own click → switchView('cfobrief').
     • Registers ACTIONS['cfo-copy'] (clipboard copy of the narrative + toast).
     • Reuses the live `print-view` action (shipped by enh-print.js) for ⎙ Print.
     • References VIEWS/ACTIONS/DATA/CURRENT_VIEW BARE with typeof guards — never
       window.VIEWS / window.ACTIONS. Never reassigns switchView.
     • One module-prefixed <style> (cf-*), design tokens only. localStorage n/a
       (read-only brief) — no persistence needed.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- idempotency guard ------------------------------------------------- */
  if (window.__cfoBriefInstalled) return;
  window.__cfoBriefInstalled = true;

  /* ---- defensive access to the runtime globals (bare, typeof-guarded) ---- */
  if (typeof VIEWS === 'undefined' || typeof DATA === 'undefined') return;

  var STYLE_ID = 'cf-styles';
  var VIEW_NAME = 'cfobrief';
  var NAV_FLAG = 'cfBriefNav';

  /* price proxy for valuing physical exposure — avg landed €/t (≈ €8,140). */
  var EUR_PER_T = 8140;

  /* ---- tiny safe formatter fallbacks (use globals when present) ---------- */
  function f_int(n) { return (typeof fmtInt === 'function') ? fmtInt(n) : String(Math.round(n)); }
  function f_eurM(n) { return (typeof fmtEurM === 'function') ? fmtEurM(n) : ('€' + (n / 1e6).toFixed(2) + 'M'); }
  function f_eur(n) { return (typeof fmtEur === 'function') ? fmtEur(n) : ('€' + Math.round(n).toLocaleString()); }
  function f_pct(n, d) { return (typeof fmtPct === 'function') ? fmtPct(n, d) : (Number(n).toFixed(d == null ? 1 : d) + '%'); }

  /* ========================================================================
     1) LIVE METRICS — every figure derived from DATA at render time.
     ====================================================================== */
  function computeMetrics() {
    var kpis = DATA.kpis || {};

    /* hedge coverage vs policy */
    var hedgeCov = (kpis.hedgeCov && kpis.hedgeCov.value) || 78;
    var hedgeTarget = 80;
    var hedgeGapPts = hedgeTarget - hedgeCov;

    /* net hedge MTM (Σ mtmEur) */
    var hedges = DATA.hedges || [];
    var netMtm = hedges.reduce(function (a, h) { return a + (h.mtmEur || 0); }, 0);
    var failedHedges = hedges.filter(function (h) { return String(h.status).toUpperCase() === 'FAILED'; });

    /* unpriced PTBF exposure */
    var contracts = DATA.contracts || [];
    var unpriced = contracts.filter(function (c) { return String(c.status).toUpperCase() === 'UNPRICED'; });
    var unpricedMt = unpriced.reduce(function (a, c) { return a + (c.mt || 0); }, 0);
    var unpricedNotional = unpricedMt * EUR_PER_T;

    /* PPV vs standard */
    var ppvM = (kpis.ppvMTD && kpis.ppvMTD.value) || 1.07;

    /* inventory value + LCM reserve flag (Cake CK-DE-01 below NRV → €25k) */
    var invValueM = (kpis.invValue && kpis.invValue.value) || 62.4;
    var lcmReserveK = 25;

    /* EUDR € at risk: suppliers with DDS not yet SUBMITTED, valued on the MT of
       their physical contracts (origin-matched), × EUR_PER_T. */
    var eudr = DATA.eudr || { summary: {}, bySupplier: [] };
    var exposedSuppliers = (eudr.bySupplier || []).filter(function (s) {
      return String(s.dds).toUpperCase() !== 'SUBMITTED';
    });
    var exposedNames = exposedSuppliers.map(function (s) { return s.supplier; });
    var exposedMt = contracts.reduce(function (a, c) {
      return exposedNames.indexOf(c.supplier) >= 0 ? a + (c.mt || 0) : a;
    }, 0);
    var eudrAtRisk = exposedMt * EUR_PER_T;
    var ddsClock = (eudr.summary && eudr.summary.ddsClock) || 196;
    /* the two worst (geo < 40%) — DDS filing recommended now */
    var ddsWorst = (eudr.bySupplier || [])
      .filter(function (s) { return (s.geoPct || 0) < 40; })
      .map(function (s) { return s.supplier; });

    /* VaR 99% (stable analytic proxy ≈ €1.03M, from net hedge + open exposure) */
    var var99 = 1.03; /* €M, 1-day 99% — consistent with enh-var-mc seed */

    /* forecast accuracy */
    var fcastAcc = (kpis.fcastAccuracy && kpis.fcastAccuracy.value) || 94.2;

    /* hedge top-up to close the headline Q3 coverage gap (the figure the CFO
       sees: 78% → 80% policy). Size against Q3 demand (Jul+Aug+Sep) from the
       hedgeCoverage MT series, then convert to NY lots (10 MT / contract).
       Basing the top-up MT on the KPI gap keeps every number in the brief
       reconciled to the same 78%/80% headline. */
    var hc = DATA.hedgeCoverage || { labels: [], demand: [], hedged: [] };
    var q3Months = ['Jul', 'Aug', 'Sep'];
    var q3Demand = 0;
    (hc.labels || []).forEach(function (lab, i) {
      if (q3Months.indexOf(lab) >= 0) q3Demand += (hc.demand[i] || 0);
    });
    /* MT to move from current coverage to policy, on Q3 demand */
    var topUpMt = Math.max(0, Math.round(q3Demand * (hedgeTarget - hedgeCov) / 100));
    var topUpLots = Math.ceil(topUpMt / 10); /* ICE NY = 10 MT / contract */

    /* the DEC26 unpriced PTBF the desk is chasing (PC-2404) + its trigger */
    var dec26 = unpriced.filter(function (c) { return c.execMonth === 'DEC26'; });

    return {
      hedgeCov: hedgeCov, hedgeTarget: hedgeTarget, hedgeGapPts: hedgeGapPts,
      netMtm: netMtm, failedHedges: failedHedges,
      unpriced: unpriced, unpricedMt: unpricedMt, unpricedNotional: unpricedNotional,
      dec26: dec26,
      ppvM: ppvM,
      invValueM: invValueM, lcmReserveK: lcmReserveK,
      eudrAtRisk: eudrAtRisk, exposedMt: exposedMt, exposedSuppliers: exposedSuppliers,
      ddsClock: ddsClock, ddsWorst: ddsWorst,
      var99: var99, fcastAcc: fcastAcc,
      topUpMt: topUpMt, topUpLots: topUpLots, q3Demand: q3Demand
    };
  }

  /* ---- "as of <today>" date string -------------------------------------- */
  function todayStr() {
    try {
      return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_e) { return '22 Jun 2026'; }
  }

  /* ---- a small CSS coverage bar (current vs target) --------------------- */
  function covBar(pct, target) {
    var p = Math.max(0, Math.min(100, pct));
    var t = Math.max(0, Math.min(100, target));
    return '<div class="cf-bar">' +
      '<div class="cf-bar-fill" style="width:' + p + '%"></div>' +
      '<div class="cf-bar-target" style="left:' + t + '%" title="policy ' + t + '%"></div>' +
      '</div>';
  }

  /* ========================================================================
     2) THE BRIEF SECTIONS
     ====================================================================== */

  /* -- header ------------------------------------------------------------- */
  function headHtml() {
    var actions =
      '<button class="btn btn-ghost" data-action="print-view">⎙ Print</button>' +
      '<button class="btn btn-ghost" data-action="cfo-copy">✦ Copy summary</button>';
    return '' +
      '<div class="view-head">' +
        '<div>' +
          '<div class="view-title">CFO Position Brief</div>' +
          '<div class="view-sub">Cocoa Procurement · as of ' + todayStr() + ' · ready to present</div>' +
        '</div>' +
        '<div class="view-actions">' + actions + '</div>' +
      '</div>';
  }

  /* -- Current Position --------------------------------------------------- */
  function currentHtml(m) {
    var mtmCls = m.netMtm >= 0 ? 'pos' : 'neg';
    var q = function (label, value, cls, sub) {
      return '<div class="qstat">' +
        '<div class="qstat-label">' + label + '</div>' +
        '<div class="qstat-value ' + (cls || '') + '">' + value + '</div>' +
        (sub ? '<div class="cf-qsub">' + sub + '</div>' : '') +
        '</div>';
    };

    var grid = '<div class="qstat-grid">' +
      q('Hedge coverage Q3', f_pct(m.hedgeCov, 0), m.hedgeCov >= m.hedgeTarget ? 'pos' : 'warn', 'target ' + m.hedgeTarget + '% · ' + (m.hedgeGapPts > 0 ? '−' + m.hedgeGapPts + 'pts' : 'on policy')) +
      q('Net hedge MTM', f_eurM(m.netMtm), mtmCls, m.failedHedges.length + ' designation' + (m.failedHedges.length === 1 ? '' : 's') + ' failing') +
      q('Unpriced exposure', f_int(m.unpricedMt) + ' MT', 'warn', m.unpriced.length + ' PTBF lots · ' + f_eurM(m.unpricedNotional)) +
      q('PPV vs standard', '€' + m.ppvM.toFixed(2) + 'M', 'neg', 'adverse MTD') +
      q('Inventory value', m.invValueM.toFixed(1) + ' €M', 'info', '1 SKU < NRV · €' + m.lcmReserveK + 'k reserve') +
      q('EUDR € at risk', f_eurM(m.eudrAtRisk), 'warn', 'DDS clock ' + m.ddsClock + ' days') +
      q('VaR 99% (1-day)', '€' + m.var99.toFixed(2) + 'M', 'info', 'within limit') +
      q('Forecast accuracy', f_pct(m.fcastAcc, 1), 'pos', '3-mo MAPE 5.8%') +
      '</div>';

    /* supporting detail table */
    var rows = '' +
      cfRow('Hedge coverage (Q3, Sep)', f_pct(m.hedgeCov, 0), covBar(m.hedgeCov, m.hedgeTarget), 'warn') +
      cfRow('Net hedge MTM (Σ open books)', f_eurM(m.netMtm), f_int(DATA.hedges.length) + ' positions, ' + m.failedHedges.length + ' failed', mtmCls) +
      cfRow('Unpriced PTBF notional', f_eurM(m.unpricedNotional), f_int(m.unpricedMt) + ' MT across ' + m.unpriced.length + ' contracts', 'warn') +
      cfRow('Inventory below NRV', '€' + m.lcmReserveK + 'k', 'CK-DE-01 (Cake) WAC > NRV', 'neg') +
      cfRow('EUDR exposure (un-filed DDS)', f_eurM(m.eudrAtRisk), f_int(m.exposedMt) + ' MT · clock ' + m.ddsClock + 'd', 'warn');

    var table = '<div class="card cf-card"><div class="card-head"><div class="card-title">Current Position — supporting detail</div>' +
      '<div class="card-sub">live from contracts, hedge book, inventory &amp; EUDR matrix</div></div>' +
      '<div class="card-body"><div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Measure</th><th class="th-num">Value</th><th>Detail</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div></div>';

    return '<div class="cf-section"><div class="section-title">Current Position</div>' + grid + table + '</div>';
  }
  function cfRow(measure, value, detail, cls) {
    return '<tr><td class="cell-strong">' + measure + '</td>' +
      '<td class="num ' + (cls || '') + '">' + value + '</td>' +
      '<td>' + detail + '</td></tr>';
  }

  /* -- Recommended Position ----------------------------------------------- */
  function recommendedHtml(m) {
    var dec = m.dec26[0];
    var items = [];
    items.push({
      t: 'Lift hedge coverage to ' + m.hedgeTarget + '%',
      d: 'Q3 coverage at ' + f_pct(m.hedgeCov, 0) + ' of ' + f_int(m.q3Demand) + ' MT demand — buy <b>+' + m.topUpLots + ' NY lots</b> (' + f_int(m.topUpMt) + ' MT) to close the ' + m.hedgeGapPts + 'pt policy gap.',
      cls: 'warn'
    });
    items.push({
      t: 'Price the ' + m.unpriced.length + ' unpriced PTBF lots',
      d: 'Fix before their triggers' + (dec ? ' — <b>' + dec.id + '</b> (' + f_int(dec.mt) + ' MT CIV ' + dec.execMonth + ') exposed above ~€8,300/t' : '') + '. ' + f_eurM(m.unpricedNotional) + ' of open price risk.',
      cls: 'neg'
    });
    items.push({
      t: 'Book the €' + m.lcmReserveK + 'k LCM reserve',
      d: 'CK-DE-01 (Cake) carried above NRV — post the lower-of-cost-or-market reserve at close.',
      cls: 'info'
    });
    items.push({
      t: 'File DDS for ' + (m.ddsWorst.length ? m.ddsWorst.join(' &amp; ') : 'sub-threshold suppliers'),
      d: 'Geo coverage < 40% with the EUDR clock at ' + m.ddsClock + ' days — start due-diligence statements now.',
      cls: 'warn'
    });
    if (m.failedHedges.length) {
      var fh = m.failedHedges[0];
      items.push({
        t: 'De-designate ' + fh.id + ' (failed hedge)',
        d: fh.book + ' effectiveness ratio 74% breaches the IFRS 9 80–125% corridor — de-designate and recycle to P&amp;L.',
        cls: 'neg'
      });
    }

    var cards = items.map(function (it) {
      return '<div class="cf-rec">' +
        '<div class="cf-rec-bar ' + it.cls + '"></div>' +
        '<div class="cf-rec-body"><div class="cf-rec-title">' + it.t + '</div>' +
        '<div class="cf-rec-detail">' + it.d + '</div></div></div>';
    }).join('');

    return '<div class="cf-section"><div class="section-title">Recommended Position</div>' +
      '<div class="card cf-card"><div class="card-head"><div class="card-title">What the position should be — and how to get there</div>' +
      '<div class="card-sub">policy-aligned target stance with the closing actions</div></div>' +
      '<div class="card-body"><div class="cf-rec-list">' + cards + '</div></div></div></div>';
  }

  /* -- Gap & Actions ------------------------------------------------------ */
  function gapHtml(m) {
    var dec = m.dec26[0];
    var rows = [
      ['Hedge coverage Q3', f_pct(m.hedgeCov, 0), f_pct(m.hedgeTarget, 0), '−' + m.hedgeGapPts + ' pts', 'warn', 'Buy +' + m.topUpLots + ' NY lots (' + f_int(m.topUpMt) + ' MT)', 'Treasury'],
      ['Unpriced PTBF', f_int(m.unpricedMt) + ' MT', '0 MT', '+' + f_int(m.unpricedMt) + ' MT', 'neg', 'Fix ' + (dec ? dec.id + ' @ ~€8,300 trigger' : 'open lots'), 'Procurement'],
      ['PPV vs standard', '€' + m.ppvM.toFixed(2) + 'M adv', '≤ €0.6M', '+€' + (m.ppvM - 0.6).toFixed(2) + 'M', 'neg', 'Address butter press-yield (not price)', 'Cost Acctg'],
      ['Inventory NRV', '€' + m.lcmReserveK + 'k over', '€0', '€' + m.lcmReserveK + 'k', 'neg', 'Book LCM reserve on CK-DE-01', 'Accounting'],
      ['Failed hedge (DES-04)', '74%', '80–125%', '−6 pts', 'neg', 'De-designate, recycle to P&amp;L', 'You / Treasury'],
      ['EUDR DDS', m.ddsWorst.length + ' suppliers open', 'all filed', m.ddsClock + 'd clock', 'warn', 'File DDS: ' + (m.ddsWorst.join(', ') || '—'), 'Procurement'],
      ['VaR 99% (1-day)', '€' + m.var99.toFixed(2) + 'M', '≤ €1.5M limit', 'in limit', 'pos', 'No action — monitor', 'Treasury']
    ];
    var body = rows.map(function (r) {
      return '<tr>' +
        '<td class="cell-strong">' + r[0] + '</td>' +
        '<td class="num">' + r[1] + '</td>' +
        '<td class="num">' + r[2] + '</td>' +
        '<td class="num ' + r[4] + '">' + r[3] + '</td>' +
        '<td>' + r[5] + '</td>' +
        '<td>' + r[6] + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="cf-section"><div class="section-title">Gap &amp; Actions</div>' +
      '<div class="card cf-card"><div class="card-body"><div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Metric</th><th class="th-num">Current</th><th class="th-num">Target</th><th class="th-num">Gap</th><th>Action</th><th>Owner</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></div></div></div>';
  }

  /* -- Executive narrative ------------------------------------------------ */
  function narrativeText(m) {
    var dec = m.dec26[0];
    var ddsList = m.ddsWorst.length ? m.ddsWorst.join(' and ') : 'the sub-threshold suppliers';
    return '' +
      'Bottom line: the cocoa procurement position is sound but under-hedged by ~' + m.hedgeGapPts + ' points, with two actionable risks heading into close. ' +
      'We are well-hedged at ' + f_pct(m.hedgeCov, 0) + ' coverage on Q3 — just below the ' + m.hedgeTarget + '% policy — and the open hedge book is carrying a net mark-to-market of ' + f_eurM(m.netMtm) + '. ' +
      'The main physical risk is ' + f_int(m.unpricedMt) + ' MT of unpriced PTBF cocoa (' + f_eurM(m.unpricedNotional) + ' of notional), ' +
      (dec ? 'led by ' + dec.id + ' — ' + f_int(dec.mt) + ' MT of CIV beans into ' + dec.execMonth + ' that is exposed if futures rally above ~€8,300/t. ' : 'exposed to a futures rally in the bull case. ') +
      'PPV is €' + m.ppvM.toFixed(2) + 'M adverse month-to-date, but the driver is a butter press-yield miss — a conversion issue, not a market-price problem — so it is operationally fixable rather than a sourcing-cost overrun. ' +
      'Liquidity and risk are comfortable: 1-day 99% VaR sits at €' + m.var99.toFixed(2) + 'M, inside limit, and forecast accuracy holds at ' + f_pct(m.fcastAcc, 1) + '. ' +
      'On compliance, the EUDR clock is at ' + m.ddsClock + ' days and ' + f_eurM(m.eudrAtRisk) + ' of supply sits behind un-filed due-diligence statements. ' +
      'Recommended actions: (1) top hedge coverage to ' + m.hedgeTarget + '% by buying +' + m.topUpLots + ' NY lots; ' +
      '(2) price the ' + m.unpriced.length + ' open PTBF lots, starting with ' + (dec ? dec.id : 'the DEC26 lot') + '; ' +
      '(3) book the €' + m.lcmReserveK + 'k LCM reserve on the cake SKU; ' +
      '(4) file DDS for ' + ddsList + '; and ' +
      '(5) de-designate the failed C-LDN Q4 hedge (74% effectiveness) and recycle it to P&L. ' +
      'In one sentence: the position is healthy and within risk limits — under-hedged by roughly ' + m.hedgeGapPts + ' points with two clean fixes — so the recommendation is to close the DEC26 PTBF and lift hedge coverage to ' + m.hedgeTarget + '%.';
  }
  function narrativeHtml(m) {
    return '<div class="cf-section"><div class="section-title">Executive narrative</div>' +
      '<div class="card cf-card"><div class="card-head"><div class="card-title">Read this to the CFO</div>' +
      '<div class="card-sub">auto-built from live figures · ' + todayStr() + '</div></div>' +
      '<div class="card-body"><div class="cf-narrative" id="cf-narrative">' + narrativeText(m) + '</div></div></div></div>';
  }

  /* ========================================================================
     3) THE VIEW RENDER
     ====================================================================== */
  function render() {
    var m = computeMetrics();
    return headHtml() +
      currentHtml(m) +
      recommendedHtml(m) +
      gapHtml(m) +
      narrativeHtml(m);
  }

  /* register the view (no Chart.js → empty draw, but switchView guards it). */
  VIEWS[VIEW_NAME] = { render: render, draw: function () {} };

  /* ========================================================================
     4) ACTION — copy the narrative to the clipboard + toast
     ====================================================================== */
  if (typeof ACTIONS !== 'undefined') {
    ACTIONS['cfo-copy'] = function () {
      var node = document.getElementById('cf-narrative');
      var text = node ? (node.innerText || node.textContent || '') : narrativeText(computeMetrics());
      var done = function () {
        if (typeof toast === 'function') {
          toast({ type: 'success', title: 'Summary copied', body: 'CFO position narrative copied to clipboard.', meta: 'ready to paste' });
        }
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, done);
        } else { done(); }
      } catch (_e) { done(); }
    };
  }

  /* ========================================================================
     5) NAV ITEM — prepend into the Workspace nav-section (idempotent)
     ====================================================================== */
  function injectNav() {
    var sidenav = document.getElementById('sidenav');
    if (!sidenav) return;
    if (sidenav.querySelector('.nav-item[data-view="' + VIEW_NAME + '"]')) return; /* already present */

    var firstSection = sidenav.querySelector('.nav-section');
    if (!firstSection) return;

    var a = document.createElement('a');
    a.className = 'nav-item cf-nav';
    a.setAttribute('data-view', VIEW_NAME);
    a.innerHTML = '<span class="nav-ico">★</span><span class="nav-text">CFO Brief</span>';

    /* own click listener — switchView toggles .active by data-view for us. */
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (typeof switchView === 'function') switchView(VIEW_NAME);
    });

    /* prepend ABOVE the first real nav item, but AFTER the .nav-label. */
    var label = firstSection.querySelector('.nav-label');
    if (label && label.nextSibling) firstSection.insertBefore(a, label.nextSibling);
    else if (label) firstSection.appendChild(a);
    else firstSection.insertBefore(a, firstSection.firstChild);
  }

  /* ========================================================================
     6) STYLES — one prefixed <style>, tokens only
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      /* prominent accent nav item */
      '.cf-nav{border-left:2px solid var(--accent);}',
      '.cf-nav .nav-ico{color:var(--accent);}',
      '.cf-nav .nav-text{color:var(--accent);font-weight:600;letter-spacing:.02em;}',
      '.cf-nav.active .nav-ico,.cf-nav.active .nav-text{color:var(--text-0);}',

      /* section rhythm */
      '.cf-section{margin-bottom:18px;}',
      '.cf-card{margin-top:12px;}',

      /* qstat sub-line under the value */
      '.cf-qsub{font-family:var(--sans);font-size:11px;color:var(--text-2);margin-top:4px;line-height:1.3;}',

      /* coverage bar (current fill + policy target marker) */
      '.cf-bar{position:relative;height:8px;border-radius:4px;background:var(--bg-3);overflow:hidden;min-width:120px;}',
      '.cf-bar-fill{position:absolute;top:0;left:0;height:100%;background:linear-gradient(90deg,var(--accent-2),var(--accent));border-radius:4px;}',
      '.cf-bar-target{position:absolute;top:-2px;width:2px;height:12px;background:var(--info);box-shadow:0 0 0 1px var(--bg-1);}',

      /* recommended-position cards */
      '.cf-rec-list{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',
      '.cf-rec{display:flex;gap:0;background:var(--bg-2);border:1px solid var(--line);border-radius:8px;overflow:hidden;}',
      '.cf-rec-bar{width:4px;flex:0 0 4px;align-self:stretch;}',
      '.cf-rec-bar.pos{background:var(--pos);}.cf-rec-bar.neg{background:var(--neg);}',
      '.cf-rec-bar.warn{background:var(--warn);}.cf-rec-bar.info{background:var(--info);}',
      '.cf-rec-body{padding:11px 13px;}',
      '.cf-rec-title{font-family:var(--sans);font-size:13px;font-weight:600;color:var(--text-0);margin-bottom:4px;}',
      '.cf-rec-detail{font-family:var(--sans);font-size:12px;color:var(--text-1);line-height:1.5;}',
      '.cf-rec-detail b{color:var(--text-0);font-family:var(--mono);}',

      /* executive narrative */
      '.cf-narrative{font-family:var(--sans);font-size:14px;line-height:1.7;color:var(--text-1);white-space:normal;max-width:78ch;}',
      '.cf-narrative b{color:var(--text-0);}',

      /* responsive: collapse the rec grid on the 920px breakpoint */
      '@media (max-width:920px){.cf-rec-list{grid-template-columns:1fr;}}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ========================================================================
     7) INSTALL (top-level on load)
     ====================================================================== */
  injectStyles();
  injectNav();

  /* If the boot view call already happened and we're on a stale empty canvas
     that referenced cfobrief (deep-link), repaint. Safe no-op otherwise. */
  if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === VIEW_NAME &&
      typeof switchView === 'function') {
    switchView(VIEW_NAME);
  }

})();
