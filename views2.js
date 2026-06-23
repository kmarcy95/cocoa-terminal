/* ============================================================================
   CACAO/FP — views2.js  (advanced views + collaboration layer)

   Owns (per CONTRACT §1):
     • the 7 advanced views: whatif, eudr, cashflow, versions, effectiveness,
       investigator, exports  (each VIEWS.<key> = { render, draw })
     • generateCommentary()  + the PPV-commentary render patch
     • renderFilterBar() / renderFilterChips()
     • renderActivityRail()
     • recomputeWhatIf() / resetWhatIf()

   Globals assumed at runtime (declared in app.js — NEVER redefined here):
     $, $$, fmtInt, fmtNum, fmtEur, fmtEurM, fmtM, fmtUsd, fmtGbp, fmtPct,
     fmtSignedPct, fmtSigned, signClass, mkChart, destroyCharts, lineOpts,
     barOpts, kpiBlock, VIEWS, switchView, CURRENT_VIEW, FILTERS, saveFilters,
     loadFilters, WHATIF_STATE, DATA.
   Globals assumed at runtime (declared in actions.js — safe inside handlers):
     toast, modal, closeModal, openDrawer, closeDrawer.

   Boot (§2): this file registers the 7 views + the ppv patch at top-level, then
   calls renderFilterBar() and renderActivityRail(). It must NOT call switchView.
   ========================================================================== */

/* ---- small local helpers (file-scoped; not contract globals) ----------- */

/* Map a status string to a contract status class (pos|neg|warn|info|muted). */
function statusClass(status) {
  const s = String(status || '').toUpperCase();
  if (/^(EFFECTIVE|DONE|FIXED|PASS|PAID|SUBMITTED|CURRENT|MATCHED|POSTED)$/.test(s)) return 'pos';
  if (/^(WATCH|IN_PROGRESS|OPEN|PARTIAL|PENDING|DRAFT|WORKING|VARIANCE)$/.test(s)) return 'warn';
  if (/^(FAILED|GAP|FAIL|UNPRICED|NONE)$/.test(s)) return 'neg';
  if (/^(SUPERSEDED|FROZEN|BUDGET)$/.test(s)) return 'muted';
  return 'muted';
}

/* Escape a string for safe embedding in a double-quoted HTML attribute. */
function attr(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/* Standard view header. */
function viewHead(title, sub, actionsHtml) {
  return (
    '<div class="view-head">' +
    '<div><div class="view-title">' + title + '</div>' +
    '<div class="view-sub">' + sub + '</div></div>' +
    '<div class="view-actions">' + (actionsHtml || '') + '</div>' +
    '</div>'
  );
}

/* Chart container per contract (charts always live in .chart-wrap). */
function chartWrap(id) {
  return '<div class="chart-wrap"><canvas id="' + id + '"></canvas></div>';
}

/* ============================================================================
   10. WHAT-IF DRIVERS
   ========================================================================== */

/* slider definitions drive both the markup and recomputeWhatIf reads */
const WHATIF_SLIDERS = [
  { id: 'nyPx',    label: 'ICE NY (USD/t)',      min: 6500, max: 9500, step: 10,    value: 7842 },
  { id: 'ldnPx',   label: 'ICE LDN (GBP/t)',     min: 4500, max: 6800, step: 10,    value: 5418 },
  { id: 'eurusd',  label: 'EUR/USD',             min: 1.00, max: 1.20, step: 0.005, value: 1.085 },
  { id: 'civDiff', label: 'CIV differential ($/t)', min: 100, max: 500, step: 5,    value: 240 },
  { id: 'sustain', label: 'Sustainability ($/t)',min: 40,   max: 200,  step: 2,     value: 96 },
  { id: 'freight', label: 'Freight ($/t)',       min: 20,   max: 160,  step: 2,     value: 64 },
  { id: 'volume',  label: 'Monthly volume (MT)', min: 4000, max: 9000, step: 50,    value: 6400 },
  { id: 'hedgeCov',label: 'Hedge coverage (%)',  min: 40,   max: 100,  step: 1,     value: 78 },
];

/* Format the current display value for a slider head. */
function whatIfSliderDisplay(id, val) {
  if (id === 'eurusd') return fmtNum(val, 3);
  if (id === 'nyPx') return fmtUsd(val);
  if (id === 'ldnPx') return fmtGbp(val);
  if (id === 'civDiff' || id === 'sustain' || id === 'freight') return fmtUsd(val);
  if (id === 'volume') return fmtInt(val) + ' MT';
  if (id === 'hedgeCov') return fmtPct(val, 0);
  return fmtNum(val);
}

function whatIfSliderRow(s) {
  return (
    '<div class="slider-row">' +
    '<div class="slider-head">' +
    '<span class="slider-label">' + s.label + '</span>' +
    '<span class="slider-val" id="wf-val-' + s.id + '">' + whatIfSliderDisplay(s.id, s.value) + '</span>' +
    '</div>' +
    '<input class="slider-input" type="range" id="wf-' + s.id + '"' +
    ' min="' + s.min + '" max="' + s.max + '" step="' + s.step + '"' +
    ' value="' + s.value + '" oninput="recomputeWhatIf()">' +
    '</div>'
  );
}

VIEWS.whatif = {
  render: function () {
    const actions =
      '<button class="btn btn-ghost" data-action="reset-whatif">↺ Reset</button>' +
      '<button class="btn btn-ghost" data-action="save-scenario">＋ Save Scenario</button>' +
      '<button class="btn btn-primary" data-action="compare-scenarios">Compare</button>';

    const sliders = WHATIF_SLIDERS.map(whatIfSliderRow).join('');

    const tiles =
      '<div class="qstat-grid">' +
      '<div class="qstat"><div class="qstat-label">Landed Cost €/t</div><div class="qstat-value mono" id="wf-landed">—</div></div>' +
      '<div class="qstat"><div class="qstat-label">Monthly Spend €M</div><div class="qstat-value mono" id="wf-spend">—</div></div>' +
      '<div class="qstat"><div class="qstat-label">PPV vs Std €M</div><div class="qstat-value mono" id="wf-ppv">—</div></div>' +
      '<div class="qstat"><div class="qstat-label">Hedge MTM €M</div><div class="qstat-value mono" id="wf-mtm">—</div></div>' +
      '</div>' +
      '<p id="wf-narrative" class="muted" style="margin-top:14px;line-height:1.55"></p>';

    return (
      viewHead(
        'What-If Driver Calculator',
        'Live cost & P&amp;L sensitivity — drag the eight market drivers to re-cost the book in real time.',
        actions
      ) +
      '<div class="grid grid-2-1">' +
      '<div class="card"><div class="card-head"><div class="card-title">What-If Drivers</div>' +
      '<div class="card-sub">8 market &amp; structural inputs</div></div>' +
      '<div class="card-body sensitivity">' + sliders + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Live Impact</div>' +
      '<div class="card-sub">recomputed on every drag</div></div>' +
      '<div class="card-body">' + tiles + '</div></div>' +
      '</div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Sensitivity (±10% per driver)</div>' +
      '<div class="card-sub">approx Δ landed €/t for a +10% move in each driver</div></div>' +
      '<div class="card-body">' + chartWrap('c-sens') + '</div></div>'
    );
  },
  draw: function () {
    const base = DATA.whatIf.baseline;
    // |Δ landed €/t| for a +10% move in each driver (linear coefficients per spec).
    const rows = [
      { k: 'NY price',       d: Math.abs((base.nyPx * 0.10) * 0.9) },
      { k: 'EUR/USD',        d: Math.abs((base.eurusd * 0.10) * (-2800)) },
      { k: 'CIV diff',       d: Math.abs(base.civDiff * 0.10) },
      { k: 'Sustainability', d: Math.abs(base.sustain * 0.10) },
      { k: 'Freight',        d: Math.abs(base.freight * 0.10) },
      { k: 'Volume',         d: Math.abs(base.volume * 0.10 * 0) + 1 }, // volume shifts spend, not €/t
    ].sort(function (a, b) { return b.d - a.d; });

    mkChart('c-sens', {
      type: 'bar',
      data: {
        labels: rows.map(function (r) { return r.k; }),
        datasets: [{
          label: 'Δ landed €/t',
          data: rows.map(function (r) { return Math.round(r.d); }),
          backgroundColor: '#c9a96e',
          borderColor: '#c9a96e',
          borderWidth: 0,
          borderRadius: 3,
          barThickness: 16,
        }],
      },
      options: barOpts({ indexAxis: 'y', valueSuffix: ' €/t', showLegend: false }),
    });

    recomputeWhatIf();
  },
};

/* Read the 8 sliders, recompute the model, paint tiles + narrative + slider heads. */
function recomputeWhatIf() {
  const base = DATA.whatIf.baseline;
  const s = {};
  WHATIF_SLIDERS.forEach(function (def) {
    const el = $('#wf-' + def.id);
    const raw = el ? parseFloat(el.value) : def.value;
    s[def.id] = isNaN(raw) ? def.value : raw;
    // keep the global what-if state in sync
    WHATIF_STATE[def.id] = s[def.id];
    const head = $('#wf-val-' + def.id);
    if (head) head.textContent = whatIfSliderDisplay(def.id, s[def.id]);
  });

  const landed =
    8142 +
    (s.nyPx - base.nyPx) * 0.9 +
    (s.ldnPx - base.ldnPx) * 0.15 +
    (s.civDiff - base.civDiff) +
    (s.sustain - base.sustain) +
    (s.freight - base.freight) +
    (s.eurusd - base.eurusd) * (-2800);

  const spendM = (landed * s.volume) / 1e6;
  const ppvM = ((landed - base.stdCost) * s.volume) / 1e6;
  const mtmM = 0.53 + (s.nyPx - base.nyPx) * (s.hedgeCov / 100) * 0.0009;

  const landedEl = $('#wf-landed');
  const spendEl = $('#wf-spend');
  const ppvEl = $('#wf-ppv');
  const mtmEl = $('#wf-mtm');

  if (landedEl) landedEl.textContent = fmtEur(Math.round(landed));
  if (spendEl) spendEl.textContent = fmtM(spendM, 2);
  if (ppvEl) {
    ppvEl.textContent = (ppvM >= 0 ? '+' : '−') + fmtM(Math.abs(ppvM), 2);
    // PPV adverse (positive) is bad → neg color; favorable (negative) → pos.
    ppvEl.className = 'qstat-value mono ' + (ppvM > 0 ? 'neg' : 'pos');
  }
  if (mtmEl) {
    mtmEl.textContent = (mtmM >= 0 ? '+' : '−') + fmtM(Math.abs(mtmM), 2);
    mtmEl.className = 'qstat-value mono ' + (mtmM >= 0 ? 'pos' : 'neg');
  }

  const narr = $('#wf-narrative');
  if (narr) {
    const dLanded = landed - 8142;
    const dir = dLanded >= 0 ? 'above' : 'below';
    const ppvWord = ppvM > 0 ? 'adverse' : 'favorable';
    narr.innerHTML =
      'At these settings landed cost is <span class="' + (dLanded > 0 ? 'neg' : 'pos') + ' mono">' +
      fmtEur(Math.round(landed)) + '/t</span> — ' + fmtEur(Math.abs(Math.round(dLanded))) +
      '/t ' + dir + ' the €8,142 baseline. Monthly spend lands at <span class="mono">' + fmtM(spendM, 1) +
      '</span> on ' + fmtInt(s.volume) + ' MT, driving a <span class="' + (ppvM > 0 ? 'neg' : 'pos') +
      '">' + fmtM(Math.abs(ppvM), 2) + ' ' + ppvWord + '</span> PPV vs the €' + fmtInt(base.stdCost) +
      ' standard. Hedge MTM marks at <span class="' + (mtmM >= 0 ? 'pos' : 'neg') + ' mono">' +
      (mtmM >= 0 ? '+' : '−') + fmtM(Math.abs(mtmM), 2) + '</span> with ' + fmtPct(s.hedgeCov, 0) +
      ' coverage.';
  }
}

/* Reset every slider to its baseline value, then recompute. Exposed for actions.js. */
function resetWhatIf() {
  WHATIF_SLIDERS.forEach(function (def) {
    const el = $('#wf-' + def.id);
    if (el) el.value = def.value;
  });
  recomputeWhatIf();
}

/* ============================================================================
   11. EUDR & TRACEABILITY
   ========================================================================== */

VIEWS.eudr = {
  render: function () {
    const e = DATA.eudr;
    const sum = e.summary;

    const actions =
      '<button class="btn btn-ghost" data-action="submit-dds">⬆ Submit DDS</button>' +
      '<button class="btn btn-ghost" data-action="risk-heatmap">▦ Risk Heatmap</button>' +
      '<button class="btn btn-primary" data-action="compliance-report">Compliance Report</button>';

    const tiles =
      '<div class="qstat-grid">' +
      '<div class="qstat"><div class="qstat-label">Compliant</div><div class="qstat-value pos">' + fmtInt(sum.compliant) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">Partial</div><div class="qstat-value warn">' + fmtInt(sum.partial) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">At-Risk</div><div class="qstat-value neg">' + fmtInt(sum.atRisk) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">DDS Clock</div><div class="qstat-value warn mono">' + fmtInt(sum.ddsClock) + ' d</div></div>' +
      '<div class="qstat"><div class="qstat-label">Geo Avg</div><div class="qstat-value mono">' + fmtPct(sum.geoAvg, 0) + '</div></div>' +
      '</div>';

    // Supplier compliance matrix
    const supRows = e.bySupplier.map(function (r) {
      const ddsCls = r.dds === 'SUBMITTED' ? 'pos' : r.dds === 'DRAFT' ? 'warn' : 'neg';
      const riskCls = r.risk > 40 ? 'neg' : 'pos';
      return (
        '<tr class="row-click" data-action="drill-supplier" data-payload="' + attr(r.supplier) + '">' +
        '<td class="cell-strong">' + r.supplier + '</td>' +
        '<td class="mono">' + r.origin + '</td>' +
        '<td class="num mono">' + fmtPct(r.geoPct, 0) + '</td>' +
        '<td><span class="badge badge-' + ddsCls + '">' + r.dds + '</span></td>' +
        '<td><span class="pill">' + r.cert + '</span></td>' +
        '<td class="num mono ' + riskCls + '">' + fmtInt(r.risk) + '</td>' +
        '<td class="mono">' + r.lastAudit + '</td>' +
        '</tr>'
      );
    }).join('');

    const supTable =
      '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Supplier</th><th>Origin</th><th class="th-num">Geo %</th><th>DDS</th><th>Cert</th><th class="th-num">Risk</th><th>Last Audit</th></tr></thead>' +
      '<tbody>' + supRows + '</tbody></table></div>';

    // Chain of custody
    const cocRows = e.chainOfCustody.map(function (r) {
      const geoCls = r.geo === 'PASS' ? 'pos' : r.geo === 'PARTIAL' ? 'warn' : 'neg';
      return (
        '<tr class="row-click" data-action="drill-lot" data-payload="' + attr(r.lot) + '">' +
        '<td class="cell-strong mono">' + r.lot + '</td>' +
        '<td>' + r.supplier + '</td>' +
        '<td class="mono">' + r.origin + '</td>' +
        '<td><span class="badge badge-' + geoCls + '">' + r.geo + '</span></td>' +
        '<td class="num mono">' + fmtInt(r.polygons) + '</td>' +
        '<td class="num mono">' + fmtPct(r.coverage, 0) + '</td>' +
        '</tr>'
      );
    }).join('');

    const cocTable =
      '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Lot</th><th>Supplier</th><th>Origin</th><th>Geo</th><th class="th-num">Polygons</th><th class="th-num">Coverage</th></tr></thead>' +
      '<tbody>' + cocRows + '</tbody></table></div>';

    // Readiness roadmap (progress bars)
    const roadmap = e.roadmap.map(function (r) {
      return (
        '<div class="progress">' +
        '<div class="progress-label">' + r.name + '<span class="mono">' + fmtPct(r.pct, 0) + '</span></div>' +
        '<div class="progress-bar" style="width:' + r.pct + '%"></div>' +
        '</div>'
      );
    }).join('');

    // High-risk action queue (risk > 40)
    const queue = e.bySupplier.filter(function (r) { return r.risk > 40; }).map(function (r) {
      return (
        '<div class="pill-row">' +
        '<span class="dot dot-neg"></span>' +
        '<span class="cell-strong">' + r.supplier + '</span>' +
        '<span class="muted">' + r.origin + ' · geo ' + fmtPct(r.geoPct, 0) + ' · risk ' + fmtInt(r.risk) + '</span>' +
        '<button class="btn btn-sm btn-danger" data-action="submit-dds" data-payload="' + attr(r.supplier) + '">Submit DDS</button>' +
        '</div>'
      );
    }).join('');

    return (
      viewHead(
        'EUDR &amp; Traceability',
        'Deforestation-regulation readiness — supplier compliance, geo-traceability and the DDS clock.',
        actions
      ) +
      '<div class="card"><div class="card-head"><div class="card-title">Compliance Summary</div></div>' +
      '<div class="card-body">' + tiles + '</div></div>' +
      '<div class="grid grid-1-2">' +
      '<div class="card"><div class="card-head"><div class="card-title">Compliance Status</div></div>' +
      '<div class="card-body">' + chartWrap('c-eudr') + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Supplier Compliance Matrix</div>' +
      '<div class="card-sub">click a row to drill the supplier</div></div>' +
      '<div class="card-body">' + supTable + '</div></div>' +
      '</div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Chain of Custody</div>' +
      '<div class="card-sub">lot-level geo verification</div></div>' +
      '<div class="card-body">' + cocTable + '</div></div>' +
      '<div class="grid grid-2">' +
      '<div class="card"><div class="card-head"><div class="card-title">EUDR Readiness Roadmap</div></div>' +
      '<div class="card-body">' + roadmap + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">High-Risk Action Queue</div>' +
      '<div class="card-sub">suppliers with risk &gt; 40</div></div>' +
      '<div class="card-body">' + queue + '</div></div>' +
      '</div>'
    );
  },
  draw: function () {
    const e = DATA.eudr.summary;
    mkChart('c-eudr', {
      type: 'doughnut',
      data: {
        labels: ['Compliant', 'Partial', 'At-Risk'],
        datasets: [{
          data: [e.compliant, e.partial, e.atRisk],
          backgroundColor: ['#2dd4a4', '#f5b342', '#ff5466'],
          borderColor: '#0f141b',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#b8c2d1', font: { family: 'Inter', size: 11 }, padding: 12 } },
        },
      },
    });
  },
};

/* ============================================================================
   12. CASH FLOW / TREASURY
   ========================================================================== */

VIEWS.cashflow = {
  render: function () {
    const actions =
      '<button class="btn btn-ghost" data-action="sync-treasury">⟳ Sync Treasury</button>' +
      '<button class="btn btn-ghost" data-action="liquidity-stress">⚡ Liquidity Stress</button>' +
      '<button class="btn btn-primary" data-action="export-treasury">Export</button>';

    // Margin calls table
    const mcRows = DATA.marginCalls.map(function (r, i) {
      const cls = r.status === 'PAID' ? 'pos' : 'warn';
      return (
        '<tr class="row-click" data-action="drill-margin-call" data-payload="' + i + '">' +
        '<td class="mono">' + r.date + '</td>' +
        '<td class="cell-strong">' + r.broker + '</td>' +
        '<td class="num mono">' + fmtEur(r.amountK * 1000) + '</td>' +
        '<td>' + r.reason + '</td>' +
        '<td><span class="badge badge-' + cls + '">' + r.status + '</span></td>' +
        '</tr>'
      );
    }).join('');

    const mcTable =
      '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Date</th><th>Broker</th><th class="th-num">Amount</th><th>Reason</th><th>Status</th></tr></thead>' +
      '<tbody>' + mcRows + '</tbody></table></div>';

    // Broker credit-line mini list
    const creditLines = [
      { broker: 'StoneX',       used: 1220, limit: 2500 },
      { broker: 'Marex',        used: 610,  limit: 1500 },
      { broker: 'ADM Investor', used: 95,   limit: 800 },
    ];
    const credit = creditLines.map(function (c) {
      const pct = Math.round((c.used / c.limit) * 100);
      return (
        '<div class="progress">' +
        '<div class="progress-label">' + c.broker +
        '<span class="mono">' + fmtEur(c.used * 1000) + ' / ' + fmtEur(c.limit * 1000) + '</span></div>' +
        '<div class="progress-bar" style="width:' + pct + '%"></div>' +
        '</div>'
      );
    }).join('');

    // Liquidity stress scenarios
    const stress = [
      { name: 'NY +5%',        outflowK: 980 },
      { name: 'NY +10%',       outflowK: 1960 },
      { name: 'EUR/USD −5%',   outflowK: 540 },
      { name: 'Freight +20%',  outflowK: 210 },
    ];
    const stressRows = stress.map(function (r) {
      return (
        '<tr>' +
        '<td class="cell-strong">' + r.name + '</td>' +
        '<td class="num mono neg">' + fmtEur(r.outflowK * 1000) + '</td>' +
        '</tr>'
      );
    }).join('');

    const stressTable =
      '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Scenario</th><th class="th-num">Incremental Outflow</th></tr></thead>' +
      '<tbody>' + stressRows + '</tbody></table></div>';

    return (
      viewHead(
        'Cash Flow / Treasury',
        '12-week cocoa cash outlook, broker margin calls and liquidity stress triggers.',
        actions
      ) +
      '<div class="card"><div class="card-head"><div class="card-title">12-Week Cash Outlook</div>' +
      '<div class="card-sub">stacked outflows €M — physical · margin · freight · close-out</div></div>' +
      '<div class="card-body">' + chartWrap('c-cash') + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Margin Calls</div>' +
      '<div class="card-sub">click a row to drill the call</div></div>' +
      '<div class="card-body">' + mcTable + '</div></div>' +
      '<div class="grid grid-2">' +
      '<div class="card"><div class="card-head"><div class="card-title">Broker Credit Lines</div></div>' +
      '<div class="card-body">' + credit + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Liquidity Triggers</div>' +
      '<div class="card-sub">incremental outflow per stress scenario</div></div>' +
      '<div class="card-body">' + stressTable + '</div></div>' +
      '</div>'
    );
  },
  draw: function () {
    const cf = DATA.cashFlow;
    mkChart('c-cash', {
      type: 'bar',
      data: {
        labels: cf.labels,
        datasets: [
          { label: 'Physical',  data: cf.physical, backgroundColor: '#c9a96e', borderWidth: 0 },
          { label: 'Margin',    data: cf.margin,   backgroundColor: '#4aa3ff', borderWidth: 0 },
          { label: 'Freight',   data: cf.freight,  backgroundColor: '#a78bfa', borderWidth: 0 },
          { label: 'Close-out', data: cf.closeout, backgroundColor: '#f5b342', borderWidth: 0 },
        ],
      },
      options: barOpts({ stacked: true, valuePrefix: '€', valueSuffix: 'M', showLegend: true }),
    });
  },
};

/* ============================================================================
   13. FORECAST VERSIONS
   ========================================================================== */

VIEWS.versions = {
  render: function () {
    const actions =
      '<button class="btn btn-ghost" data-action="compare-versions">⇄ Compare</button>' +
      '<button class="btn btn-ghost" data-action="lock-forecast">🔒 Lock</button>' +
      '<button class="btn btn-ghost" data-action="branch-current">⑂ Branch</button>' +
      '<button class="btn btn-primary" data-action="submit-approval">Submit</button>';

    // Version register
    const verStatusBadge = function (s) {
      const map = { BUDGET: 'info', SUPERSEDED: 'muted', FROZEN: 'muted', CURRENT: 'pos', WORKING: 'warn' };
      return 'badge-' + (map[s] || 'muted');
    };
    const verRows = DATA.forecastVersions.map(function (v) {
      const ppvCls = v.ppvM > 0 ? 'neg' : v.ppvM < 0 ? 'pos' : 'muted';
      const ppvTxt = (v.ppvM > 0 ? '+' : v.ppvM < 0 ? '−' : '') + fmtM(Math.abs(v.ppvM), 2);
      return (
        '<tr class="row-click" data-action="drill-version" data-payload="' + attr(v.id) + '">' +
        '<td class="cell-strong mono">' + v.id + '</td>' +
        '<td>' + v.name + '</td>' +
        '<td><span class="badge ' + verStatusBadge(v.status) + '">' + v.status + '</span></td>' +
        '<td>' + v.owner + '</td>' +
        '<td class="mono">' + v.date + '</td>' +
        '<td class="num mono ' + ppvCls + '">' + ppvTxt + '</td>' +
        '<td class="num mono">' + fmtEur(v.landed) + '</td>' +
        '</tr>'
      );
    }).join('');

    const verTable =
      '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Owner</th><th>Date</th><th class="th-num">PPV €M</th><th class="th-num">Landed</th></tr></thead>' +
      '<tbody>' + verRows + '</tbody></table></div>';

    // Assumption diff
    const fmtCell = function (assumption, n) {
      if (/EUR\/USD/.test(assumption)) return fmtNum(n, 3);
      if (/%/.test(assumption)) return fmtNum(n, 0);
      return fmtNum(n, 0);
    };
    const diffRows = DATA.versionDiff.map(function (r) {
      const dCls = r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : 'muted';
      const dTxt = (r.delta > 0 ? '+' : r.delta < 0 ? '−' : '') +
        (/EUR\/USD/.test(r.assumption) ? fmtNum(Math.abs(r.delta), 3) : fmtNum(Math.abs(r.delta), 0));
      return (
        '<tr>' +
        '<td class="cell-strong">' + r.assumption + '</td>' +
        '<td class="num mono muted">' + fmtCell(r.assumption, r.v1) + '</td>' +
        '<td class="num mono muted">' + fmtCell(r.assumption, r.v2) + '</td>' +
        '<td class="num mono">' + fmtCell(r.assumption, r.v3) + '</td>' +
        '<td class="num mono ' + dCls + '">' + dTxt + '</td>' +
        '</tr>'
      );
    }).join('');

    const diffTable =
      '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Assumption</th><th class="th-num">v1</th><th class="th-num">v2</th><th class="th-num">v3</th><th class="th-num">Δ</th></tr></thead>' +
      '<tbody>' + diffRows + '</tbody></table></div>';

    // Approval workflow stepper (4 steps, first two done)
    const steps = [
      { label: 'Submit',  done: true },
      { label: 'Review',  done: true },
      { label: 'Approve', done: false },
      { label: 'Lock',    done: false },
    ];
    const stepper = steps.map(function (st, i) {
      const badgeCls = st.done ? 'badge-pos' : 'badge-muted';
      const glyph = st.done ? '✓' : (i + 1);
      const arrow = i < steps.length - 1 ? '<span class="chain-arrow">→</span>' : '';
      return (
        '<span class="badge ' + badgeCls + '">' + glyph + ' ' + st.label + '</span>' + arrow
      );
    }).join('');

    return (
      viewHead(
        'Forecast Versions',
        'Version register, assumption diff and the approval workflow for the rolling forecast.',
        actions
      ) +
      '<div class="card"><div class="card-head"><div class="card-title">Version Register</div>' +
      '<div class="card-sub">click a row to drill the version</div></div>' +
      '<div class="card-body">' + verTable + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Assumption Diff (v1 → v2 → v3)</div></div>' +
      '<div class="card-body">' + diffTable + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Approval Workflow</div></div>' +
      '<div class="card-body"><div class="pill-row">' + stepper + '</div></div></div>'
    );
  },
};

/* ============================================================================
   14. HEDGE EFFECTIVENESS (IFRS 9)
   ========================================================================== */

/* Map an effectiveness ratio (50–150 domain) to a 0–100% horizontal position. */
function effPos(ratio) {
  const clamped = Math.max(50, Math.min(150, ratio));
  return ((clamped - 50) / 100) * 100;
}

VIEWS.effectiveness = {
  render: function () {
    const he = DATA.hedgeEffectiveness;

    const actions =
      '<button class="btn btn-ghost" data-action="effectiveness-test">▦ Effectiveness Test</button>' +
      '<button class="btn btn-ghost" data-action="run-prospective">↻ Run Prospective</button>' +
      '<button class="btn btn-ghost" data-action="export-pwc">↗ Export PwC</button>' +
      '<button class="btn btn-primary" data-action="dedesignate-failed">De-designate</button>';

    // 80–125% corridor band, mapped onto the 50→0 / 150→100 width.
    const bandLeft = effPos(80);
    const bandWidth = effPos(125) - effPos(80);

    const gauges = he.designations.map(function (d) {
      const cls = statusClass(d.status);
      const markerLeft = effPos(d.ratio);
      return (
        '<div class="gauge">' +
        '<div class="gauge-label">' + d.name +
        '<span class="gauge-val ' + cls + ' mono">' + fmtPct(d.ratio, 0) + '</span></div>' +
        '<div class="gauge-track">' +
        '<div class="gauge-band" style="left:' + bandLeft + '%;width:' + bandWidth + '%"></div>' +
        '<div class="gauge-marker ' + cls + '" style="left:' + markerLeft + '%"></div>' +
        '</div>' +
        '</div>'
      );
    }).join('');

    // P&L impact qstat grid
    const p = he.pnlImpact;
    const pnl =
      '<div class="qstat-grid">' +
      '<div class="qstat"><div class="qstat-label">OCI Accumulated</div><div class="qstat-value mono">' + fmtEurM(p.ociAccumulated) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">Ineffective → P&amp;L</div><div class="qstat-value neg mono">' + fmtEurM(p.ineffectiveToPnl) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">Reclass on Settle</div><div class="qstat-value mono">' + fmtEurM(p.reclassOnSettle) + '</div></div>' +
      '</div>';

    // Designation register table
    const regRows = he.designations.map(function (d) {
      const cls = statusClass(d.status);
      return (
        '<tr>' +
        '<td class="cell-strong mono">' + d.id + '</td>' +
        '<td>' + d.name + '</td>' +
        '<td class="num mono ' + cls + '">' + fmtPct(d.ratio, 0) + '</td>' +
        '<td><span class="badge badge-' + cls + '">' + d.status + '</span></td>' +
        '<td>' + d.method + '</td>' +
        '</tr>'
      );
    }).join('');

    const regTable =
      '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>ID</th><th>Designation</th><th class="th-num">Ratio</th><th>Status</th><th>Method</th></tr></thead>' +
      '<tbody>' + regRows + '</tbody></table></div>';

    return (
      viewHead(
        'Hedge Effectiveness',
        'IFRS 9 cash-flow hedge corridors (80–125%), OCI impact and the 6-month effectiveness trend.',
        actions
      ) +
      '<div class="card"><div class="card-head"><div class="card-title">Effectiveness Corridors (IFRS 9 80–125%)</div>' +
      '<div class="card-sub">marker = current dollar-offset / regression ratio</div></div>' +
      '<div class="card-body">' + gauges + '</div></div>' +
      '<div class="grid grid-2">' +
      '<div class="card"><div class="card-head"><div class="card-title">P&amp;L Impact</div></div>' +
      '<div class="card-body">' + pnl + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">6-Month Effectiveness Trend</div></div>' +
      '<div class="card-body">' + chartWrap('c-eff') + '</div></div>' +
      '</div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Designation Register</div></div>' +
      '<div class="card-body">' + regTable + '</div></div>'
    );
  },
  draw: function () {
    const h = DATA.hedgeEffectiveness.history;
    mkChart('c-eff', {
      type: 'line',
      data: {
        labels: h.labels,
        datasets: [
          { label: 'DES-01 (NY Q3)',  data: h.des01, borderColor: '#c9a96e', backgroundColor: 'rgba(201,169,110,.12)', tension: 0.3, borderWidth: 2, pointRadius: 2 },
          { label: 'DES-03 (LDN Q3)', data: h.des03, borderColor: '#4aa3ff', backgroundColor: 'rgba(74,163,255,.10)', tension: 0.3, borderWidth: 2, pointRadius: 2 },
          { label: 'DES-04 (LDN Q4)', data: h.des04, borderColor: '#ff5466', backgroundColor: 'rgba(255,84,102,.10)', tension: 0.3, borderWidth: 2, pointRadius: 2 },
        ],
      },
      options: lineOpts(),
    });
  },
};

/* ============================================================================
   15. VARIANCE INVESTIGATOR
   ========================================================================== */

/* Type → glyph map for the drill chain. */
const CHAIN_GLYPH = {
  sku: '▦', contract: '▤', po: '⎙', invoice: '€', bl: '⚓', hedge: '⇄', je: '▣',
};

VIEWS.investigator = {
  render: function () {
    const dc = DATA.drillChain;

    const actions =
      '<button class="btn btn-ghost" data-action="open-s4">⎋ Open in S/4</button>' +
      '<button class="btn btn-ghost" data-action="export-trail">↗ Export Trail</button>' +
      '<button class="btn btn-ghost" data-action="add-comment">＋ Add Comment</button>' +
      '<button class="btn btn-ghost" data-action="tag-reviewer">@ Tag Reviewer</button>' +
      '<button class="btn btn-primary" data-action="escalate">Escalate</button>';

    const steps = dc.steps.map(function (st, i) {
      const cls = statusClass(st.status);
      const glyph = CHAIN_GLYPH[st.type] || '•';
      const connector = i < dc.steps.length - 1 ? '<div class="chain-mid"></div>' : '';
      return (
        '<div class="chain-step">' +
        '<div class="chain-glyph">' + glyph + '</div>' +
        '<span class="chain-dot ' + cls + '"></span>' +
        '<div class="chain-id mono">' + st.id + '</div>' +
        '<div class="chain-label">' + st.label + '</div>' +
        '<div class="chain-detail mono">' + st.detail + '</div>' +
        connector +
        '</div>'
      );
    }).join('');

    // Investigation notes — hardcoded root-cause explanation
    const notes =
      '<p class="muted" style="line-height:1.6">' +
      'The <span class="cell-strong">' + dc.desc + '</span> variance of ' +
      '<span class="neg mono">' + fmtEurM(dc.varianceEur) + '</span> traces to a press-yield miss on the ' +
      'Hamburg butter line. Actual yield ran <span class="neg">1.4 pts below standard</span>, lifting the ' +
      'per-tonne cost to €15,240 against a €14,850 std (+€390/t across 540 MT). The CIV feedstock contract ' +
      '(PC-2401) was 80% hedged via HG-7001, so the futures leg was largely neutral — the residual is a ' +
      'genuine physical conversion-yield variance, not a price effect. It has been posted to 8410xx via JE-44102.' +
      '</p>' +
      '<div class="section-title">Root-cause attributes</div>' +
      '<div class="kv-list">' +
      '<div class="kv"><span class="kv-k">Variance type</span><span class="kv-v">Conversion yield (physical)</span></div>' +
      '<div class="kv"><span class="kv-k">Yield delta</span><span class="kv-v neg mono">−1.4 pts vs std</span></div>' +
      '<div class="kv"><span class="kv-k">Per-tonne impact</span><span class="kv-v neg mono">+€390 / t</span></div>' +
      '<div class="kv"><span class="kv-k">Volume affected</span><span class="kv-v mono">540 MT</span></div>' +
      '<div class="kv"><span class="kv-k">Hedge offset</span><span class="kv-v pos mono">80% (HG-7001)</span></div>' +
      '<div class="kv"><span class="kv-k">GL account</span><span class="kv-v mono">8410xx</span></div>' +
      '<div class="kv"><span class="kv-k">Posted via</span><span class="kv-v mono">JE-44102</span></div>' +
      '</div>';

    // Related tasks
    const tasks =
      '<div class="pill-row"><span class="dot dot-warn"></span><span class="cell-strong">Confirm press-yield vs std</span>' +
      '<span class="muted">FP&amp;A · @You</span></div>' +
      '<div class="pill-row"><span class="dot dot-pos"></span><span class="cell-strong">Post variance to 8410xx</span>' +
      '<span class="muted">Done · JE-44102</span></div>' +
      '<div class="pill-row"><span class="dot dot-warn"></span><span class="cell-strong">Engineering review of press line</span>' +
      '<span class="muted">Operations · open</span></div>' +
      '<div class="quick-actions" style="margin-top:12px">' +
      '<button class="btn btn-sm" data-action="add-comment">＋ Comment</button>' +
      '<button class="btn btn-sm" data-action="tag-reviewer">@ Tag</button>' +
      '<button class="btn btn-sm" data-action="open-s4">Open in S/4</button>' +
      '<button class="btn btn-sm btn-danger" data-action="escalate">Escalate</button>' +
      '</div>';

    return (
      viewHead(
        'Variance Investigator',
        'End-to-end drill from SKU variance to the posting journal — the full evidentiary chain.',
        actions
      ) +
      '<div class="card"><div class="card-head"><div class="card-title">Drill Chain — ' + dc.sku + '</div>' +
      '<div class="card-sub">' + dc.desc + ' · ' + fmtEurM(dc.varianceEur) + ' adverse</div></div>' +
      '<div class="card-body"><div class="chain">' + steps + '</div></div></div>' +
      '<div class="grid grid-2">' +
      '<div class="card"><div class="card-head"><div class="card-title">Investigation Notes</div></div>' +
      '<div class="card-body">' + notes + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Related Tasks</div></div>' +
      '<div class="card-body">' + tasks + '</div></div>' +
      '</div>' +
      // Comments & Activity — the live, persisted reply/assign/escalate thread
      '<div class="card"><div class="card-head">' +
      '<div><div class="card-title">Comments &amp; Activity</div>' +
      '<div class="card-sub">Full reply / assignment / escalation history</div></div>' +
      '<div class="card-actions">' +
      '<button class="btn btn-sm" data-action="add-comment">＋ Reply</button>' +
      '<button class="btn btn-sm" data-action="tag-reviewer">@ Assign</button>' +
      '<button class="btn btn-sm btn-danger" data-action="escalate">Escalate</button>' +
      '</div></div>' +
      '<div class="card-body">' +
      ((typeof _aThreadHtml === 'function') ? _aThreadHtml() : '<div class="muted">Thread unavailable.</div>') +
      '</div></div>'
    );
  },
};

/* ============================================================================
   16. EXPORTS & MOBILE
   ========================================================================== */

VIEWS.exports = {
  render: function () {
    const actions =
      '<button class="btn btn-ghost" data-action="export-pbi">Power BI</button>' +
      '<button class="btn btn-ghost" data-action="export-excel">Excel</button>' +
      '<button class="btn btn-ghost" data-action="export-pdf">PDF</button>' +
      '<button class="btn btn-primary" data-action="export-pptx">PPTX</button>';

    // Scheduled reports table
    const repRows = DATA.scheduledReports.map(function (r) {
      const fmtCls = { PDF: 'info', XLSX: 'pos', PPTX: 'warn' }[r.format] || 'muted';
      return (
        '<tr>' +
        '<td class="cell-strong">' + r.name + '</td>' +
        '<td class="mono">' + r.cadence + '</td>' +
        '<td>' + r.recipients + '</td>' +
        '<td><span class="badge badge-' + fmtCls + '">' + r.format + '</span></td>' +
        '<td class="mono">' + r.next + '</td>' +
        '<td><button class="btn btn-sm" data-action="send-report" data-payload="' + attr(r.name) + '">Send now</button></td>' +
        '</tr>'
      );
    }).join('');

    const repTable =
      '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Report</th><th>Cadence</th><th>Recipients</th><th>Format</th><th>Next</th><th></th></tr></thead>' +
      '<tbody>' + repRows + '</tbody></table></div>';

    // Mobile phone mockup
    const phone =
      '<div class="phone">' +
      '<div class="phone-notch"></div>' +
      '<div class="phone-screen">' +
      '<div class="phone-row"><span class="muted">Spend MTD</span><span class="mono accent big">€48.2M</span><span class="pos">−6.9% vs plan</span></div>' +
      '<div class="phone-row"><span class="muted">Landed Cost</span><span class="mono accent big">€8,142/t</span><span class="neg">+2.1% vs std</span></div>' +
      '<div class="phone-row"><span class="muted">Hedge Coverage Q3</span><span class="mono accent big">78%</span><span class="warn">target 80%</span></div>' +
      '</div>' +
      '</div>';

    // Snapshot template editor
    const editor =
      '<div class="form-row">' +
      '<label class="form-label">Snapshot template</label>' +
      '<div class="form-input" contenteditable="true" style="min-height:120px;white-space:pre-wrap" spellcheck="false">' +
      'CACAO/FP — June Close Snapshot\n• Spend MTD: €48.2M (−6.9% vs plan)\n' +
      '• Landed cost: €8,142/t (+2.1% vs std)\n• PPV: €1.07M adverse\n• Hedge coverage Q3: 78% (target 80%)' +
      '</div>' +
      '<div class="form-help">Edit inline, then save as the default board snapshot.</div>' +
      '</div>' +
      '<div class="card-foot"><button class="btn btn-sm btn-primary" data-action="snapshot-dashboard">Save Snapshot</button></div>';

    return (
      viewHead(
        'Exports &amp; Mobile',
        'Scheduled distribution, the mobile board view and the executive snapshot template.',
        actions
      ) +
      '<div class="card"><div class="card-head"><div class="card-title">Scheduled Reports</div></div>' +
      '<div class="card-body">' + repTable + '</div></div>' +
      '<div class="grid grid-1-2">' +
      '<div class="card"><div class="card-head"><div class="card-title">Mobile Preview</div></div>' +
      '<div class="card-body">' + phone + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Snapshot Template</div></div>' +
      '<div class="card-body">' + editor + '</div></div>' +
      '</div>'
    );
  },
};

/* ============================================================================
   AUTO-GENERATED EXECUTIVE COMMENTARY  (+ PPV view patch)
   ========================================================================== */

/* Build a 4-paragraph HTML narrative from DATA.ppvDetail. */
function generateCommentary() {
  const rows = DATA.ppvDetail.map(function (r) {
    return {
      sku: r.sku,
      desc: r.desc,
      mt: r.mt,
      varPerT: r.actEur - r.stdEur,
      varEur: (r.actEur - r.stdEur) * r.mt,
      fxImpact: r.fxImpact,
    };
  });

  const totalVar = rows.reduce(function (a, r) { return a + r.varEur; }, 0);
  const adverse = rows.filter(function (r) { return r.varEur > 0; });
  const favorable = rows.filter(function (r) { return r.varEur < 0; });
  const adverseTot = adverse.reduce(function (a, r) { return a + r.varEur; }, 0);
  const favTot = favorable.reduce(function (a, r) { return a + r.varEur; }, 0);

  const byMag = rows.slice().sort(function (a, b) { return b.varEur - a.varEur; });
  const topAdverse = byMag[0];
  const topFavorable = byMag[byMag.length - 1];

  const period = (typeof FILTERS !== 'undefined' && FILTERS.period) ? FILTERS.period : 'Jun 2026 (MTD)';

  const dirWord = totalVar > 0 ? 'adverse' : 'favorable';
  const dirCls = totalVar > 0 ? 'neg' : 'pos';

  const p1 =
    '<p>Purchase price variance for <strong>' + period + '</strong> closed at a net ' +
    '<span class="' + dirCls + '">' + fmtEurM(Math.abs(totalVar)) + ' ' + dirWord + '</span> position across ' +
    rows.length + ' costed SKUs. Gross adverse variances of <span class="neg">' + fmtEurM(adverseTot) +
    '</span> were partially offset by <span class="pos">' + fmtEurM(Math.abs(favTot)) +
    '</span> of favourable movement, leaving the book ' + (Math.abs(totalVar) > 1e6 ? 'materially' : 'modestly') +
    ' above standard cost.</p>';

  const p2 =
    '<p>The single largest adverse driver was <strong>' + topAdverse.desc + ' (' + topAdverse.sku + ')</strong>, ' +
    'contributing <span class="neg">' + fmtEurM(topAdverse.varEur) + '</span> at ' +
    fmtSigned(topAdverse.varPerT) + ' €/t over ' + fmtInt(topAdverse.mt) + ' MT. This reflects elevated ICE NY ' +
    'futures feeding the CIV/GHA bean complex plus a press-yield miss on the German butter line, only ' +
    'partly cushioned by the Q3 hedge book.</p>';

  const p3 =
    '<p>On the favourable side, <strong>' + topFavorable.desc + ' (' + topFavorable.sku + ')</strong> delivered ' +
    '<span class="pos">' + fmtEurM(Math.abs(topFavorable.varEur)) + '</span> at ' +
    fmtSigned(topFavorable.varPerT) + ' €/t, as realised conversion costs and a softer EUR/USD basis ran below ' +
    'the standard build-up. Powder and cake by-products similarly priced under standard, recovering part of the ' +
    'bean-side pressure.</p>';

  const p4 =
    '<p><strong>Outlook &amp; actions:</strong> with the forward curve in contango and PC-2404 still unpriced into ' +
    'DEC26, residual upside risk remains on the CIV PTBF leg. Recommended actions — lift Q3 hedge coverage toward ' +
    'the 80% target, confirm the butter press-yield root cause before sign-off, and hold the origin-premium ' +
    'accrual pending the DOM certification update. Net PPV is expected to remain ' +
    '<span class="' + dirCls + '">' + dirWord + '</span> into the WD+4 commentary lock.</p>';

  return p1 + p2 + p3 + p4;
}

/* PPV commentary patch — wrap the original render to append a commentary card. */
(function patchPpvCommentary() {
  if (!VIEWS.ppv || typeof VIEWS.ppv.render !== 'function') return; // guard: app.js must have registered ppv
  const _ppvRender = VIEWS.ppv.render;
  VIEWS.ppv.render = function () {
    return _ppvRender() +
      '<div class="card" id="ppv-commentary"><div class="card-head">' +
      '<div class="card-title">Auto-Generated Executive Commentary</div>' +
      '<div class="card-actions">' +
      '<button class="btn btn-sm" data-action="generate-commentary">Regenerate</button>' +
      '<button class="btn btn-sm" data-action="copy-commentary">Copy</button>' +
      '<button class="btn btn-sm btn-primary" data-action="send-commentary">Send to CFO</button>' +
      '</div></div>' +
      '<div class="card-body" id="commentary-body">' + generateCommentary() + '</div></div>';
  };
})();

/* ============================================================================
   FILTER BAR
   ========================================================================== */

/* Visible select keys (sku/currency optional per spec — keep the bar compact). */
const FILTER_SELECTS = [
  { key: 'period',   tax: 'periods',    label: 'Period'   },
  { key: 'origin',   tax: 'origins',    label: 'Origin'   },
  { key: 'supplier', tax: 'suppliers',  label: 'Supplier' },
  { key: 'version',  tax: 'versions',   label: 'Version'  },
  { key: 'sku',      tax: 'skus',       label: 'SKU'      },
  { key: 'currency', tax: 'currencies', label: 'Currency' },
];

/* default value per filter key (for chip / reset comparison). */
function defaultFor(key) {
  const d = {
    period: 'Jun 2026 (MTD)', origin: 'All origins', supplier: 'All suppliers',
    sku: 'All SKUs', currency: 'EUR', version: 'v5 · June Rolling (CURRENT)',
  };
  return d[key];
}

function renderFilterBar() {
  const bar = $('#filter-bar');
  if (!bar) return;
  const tax = DATA.filterTaxonomy;

  const groups = FILTER_SELECTS.map(function (f) {
    const opts = (tax[f.tax] || []).map(function (v) {
      const sel = (FILTERS[f.key] === v) ? ' selected' : '';
      return '<option value="' + attr(v) + '"' + sel + '>' + v + '</option>';
    }).join('');
    return (
      '<div class="filter-group">' +
      '<span class="filter-label">' + f.label + '</span>' +
      '<select class="filter-select" data-filter-key="' + f.key + '" ' +
      'onchange="onFilterChange(\'' + f.key + '\', this.value)">' + opts + '</select>' +
      '</div>'
    );
  }).join('');

  bar.innerHTML = groups + '<div class="filter-chips" id="filter-chips"></div>';
  renderFilterChips();
}

/* Filter change handler (called from the inline onchange). */
function onFilterChange(key, value) {
  const next = {};
  Object.keys(FILTERS).forEach(function (k) { next[k] = FILTERS[k]; });
  next[key] = value;
  saveFilters(next);
  renderFilterChips();
  if (typeof switchView === 'function' && typeof CURRENT_VIEW !== 'undefined') {
    switchView(CURRENT_VIEW);
  }
  if (typeof toast === 'function') {
    toast({ type: 'info', title: 'Filter applied', body: key + ' → ' + value });
  }
}

/* Render the dismissible chip area for every non-default filter. */
function renderFilterChips() {
  const wrap = $('#filter-chips');
  if (!wrap) return;
  const chips = [];
  let anyActive = false;

  Object.keys(FILTERS).forEach(function (key) {
    const val = FILTERS[key];
    if (val !== defaultFor(key)) {
      anyActive = true;
      chips.push(
        '<span class="chip">' +
        '<span class="muted">' + key + '</span> ' + val +
        '<span class="chip-x" data-action="clear-filter" data-payload="' + attr(key) + '">×</span>' +
        '</span>'
      );
    }
  });

  if (anyActive) {
    chips.push('<button class="filter-reset" data-action="reset-filters">Reset all</button>');
  }
  wrap.innerHTML = chips.join('');
}

/* ============================================================================
   ACTIVITY RAIL
   ========================================================================== */

/* Wrap @mentions in a styled span. */
function highlightMentions(text) {
  const safe = String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return safe.replace(/@([A-Za-z][A-Za-z0-9_&;]*)/g, '<span class="mention">@$1</span>');
}

function renderActivityRail() {
  const rail = $('#activity-rail');
  if (!rail) return;

  const items = (DATA.activity || []).map(function (a, i) {
    return (
      '<div class="rail-item" data-action="drill-activity" data-payload="' + i + '">' +
      '<div class="rail-avatar">' + a.avatar + '</div>' +
      '<div class="rail-meta">' +
      '<div><span class="rail-name">' + a.user + '</span> ' +
      '<span class="rail-team">' + a.team + '</span></div>' +
      '<div class="rail-action">' + a.action + ' <span class="rail-target">' + a.target + '</span></div>' +
      '<div class="rail-body-text">' + highlightMentions(a.body) + '</div>' +
      '<div class="rail-time">' + a.time + '</div>' +
      '</div>' +
      '</div>'
    );
  }).join('');

  rail.innerHTML =
    '<div class="rail-head">' +
    '<div class="rail-title">Activity</div>' +
    '<button class="rail-close" data-action="toggle-rail" title="Close">×</button>' +
    '</div>' +
    '<div class="rail-body">' + items + '</div>' +
    '<div class="rail-composer">' +
    '<input class="rail-input" type="text" placeholder="Write an update… use @ to mention">' +
    '<button class="btn btn-sm btn-primary" data-action="post-activity">Post</button>' +
    '</div>';
}

/* ============================================================================
   BOOT (§2) — top-level init: this file's views/patch are already registered
   above at load time. Render the chrome now; do NOT call switchView.
   ========================================================================== */

renderFilterBar();
renderActivityRail();
