/* ============================================================================
   CACAO/FP — app.js  (helpers, VIEWS registry, switchView, 9 core views, boot)
   Vanilla JS. No modules, no frameworks. Depends on global DATA (data.js +
   data2.js) and global Chart (Chart.js 4.4.1). Per CONTRACT.md §1–§7.
   ========================================================================== */

/* ===========================================================================
   (A) HELPERS  — CONTRACT §3
   =========================================================================== */

/* ---- DOM ---------------------------------------------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---- Formatters --------------------------------------------------------- *
 * All take a Number and return a String. Signed formatters use the real
 * minus sign "−" (U+2212) and a "+" prefix for non-negative values.        */
function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtNum(n, d = 0) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}
function fmtEur(n, d = 0) {
  return '€' + fmtNum(n, d);
}
function fmtEurM(eur, d = 2) {
  return '€' + fmtNum((Number(eur || 0)) / 1e6, d) + 'M';
}
function fmtM(n, d = 1) {
  return fmtNum(n, d) + 'M';
}
function fmtUsd(n, d = 0) {
  return '$' + fmtNum(n, d);
}
function fmtGbp(n, d = 0) {
  return '£' + fmtNum(n, d);
}
function fmtPct(n, d = 1) {
  return fmtNum(n, d) + '%';
}
function fmtSignedPct(n, d = 1) {
  const v = Number(n || 0);
  const sign = v >= 0 ? '+' : '−';
  return sign + fmtNum(Math.abs(v), d) + '%';
}
function fmtSigned(n, d = 0) {
  const v = Number(n || 0);
  const sign = v >= 0 ? '+' : '−';
  return sign + fmtNum(Math.abs(v), d);
}
function signClass(n, invert = false) {
  const v = Number(n || 0);
  const positive = invert ? v < 0 : v >= 0;
  return positive ? 'pos' : 'neg';
}

/* ---- Chart helpers (dark theme) ----------------------------------------- */
const _charts = {};                 // id -> Chart instance

const CHART_GRID  = '#161e2a';
const CHART_TICK  = '#7a8597';
const CHART_LABEL = '#b8c2d1';
const CHART_TICK_FONT = { family: 'JetBrains Mono', size: 10 };

function mkChart(id, config) {
  const el = $('#' + id);
  if (!el || typeof Chart === 'undefined') return null;
  const chart = new Chart(el, config);
  _charts[id] = chart;
  return chart;
}

function destroyCharts() {
  Object.keys(_charts).forEach((id) => {
    try { _charts[id] && _charts[id].destroy(); } catch (e) { /* noop */ }
  });
  for (const k in _charts) delete _charts[k];
}

/* Category-axis tick callback per CONTRACT §3 — must use getLabelForValue. */
function categoryTick(value) {
  return this.getLabelForValue(value);
}

function lineOpts({ dualAxis = false } = {}) {
  const scales = {
    x: {
      grid: { color: CHART_GRID, drawBorder: false },
      ticks: { color: CHART_TICK, font: CHART_TICK_FONT, callback: categoryTick },
    },
    y: {
      position: 'left',
      grid: { color: CHART_GRID, drawBorder: false },
      ticks: { color: CHART_TICK, font: CHART_TICK_FONT },
    },
  };
  if (dualAxis) {
    scales.y1 = {
      position: 'right',
      grid: { drawOnChartArea: false, color: CHART_GRID, drawBorder: false },
      ticks: { color: CHART_TICK, font: CHART_TICK_FONT },
    };
  }
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        labels: { color: CHART_LABEL, font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8 },
      },
      tooltip: {
        backgroundColor: '#141b25',
        borderColor: '#2a3547',
        borderWidth: 1,
        titleColor: '#e8edf5',
        bodyColor: '#b8c2d1',
        titleFont: { family: 'JetBrains Mono', size: 11 },
        bodyFont: { family: 'JetBrains Mono', size: 11 },
        padding: 10,
      },
    },
    scales,
  };
}

function barOpts({ stacked = false, indexAxis = 'x', valuePrefix = '', valueSuffix = '', showLegend = true } = {}) {
  const catTicks = { color: CHART_TICK, font: CHART_TICK_FONT, callback: categoryTick };
  const valTickFmt = (val) => valuePrefix + fmtNum(val, 0) + valueSuffix;
  const valTicks = { color: CHART_TICK, font: CHART_TICK_FONT, callback: valTickFmt };

  const xIsCategory = indexAxis === 'x';
  const scales = {
    x: {
      stacked,
      grid: { color: CHART_GRID, drawBorder: false },
      ticks: xIsCategory ? catTicks : valTicks,
    },
    y: {
      stacked,
      grid: { color: CHART_GRID, drawBorder: false },
      ticks: xIsCategory ? valTicks : catTicks,
    },
  };

  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: showLegend,
        labels: { color: CHART_LABEL, font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8 },
      },
      tooltip: {
        backgroundColor: '#141b25',
        borderColor: '#2a3547',
        borderWidth: 1,
        titleColor: '#e8edf5',
        bodyColor: '#b8c2d1',
        titleFont: { family: 'JetBrains Mono', size: 11 },
        bodyFont: { family: 'JetBrains Mono', size: 11 },
        padding: 10,
      },
    },
    scales,
  };
}

/* ---- KPI tile ----------------------------------------------------------- *
 * k = { label, value, unit, chgPct, sub }. invertColor flips sign coloring,
 * kpiKey makes the tile drillable (drill ▸ glyph + data-action).            */
function kpiBlock(k, invertColor = false, kpiKey = '') {
  const cls = signClass(k.chgPct, invertColor);
  const drillAttr = kpiKey
    ? ` data-action="drill-kpi" data-payload="${kpiKey}"`
    : '';
  const drillGlyph = kpiKey ? ' <span class="kpi-drill">▸</span>' : '';
  const val = (typeof k.value === 'number' && Number.isInteger(k.value) && Math.abs(k.value) >= 1000)
    ? fmtInt(k.value) : k.value;
  return `
    <div class="kpi"${drillAttr}>
      <div class="kpi-label">${k.label}${drillGlyph}</div>
      <div class="kpi-value mono">${val}<span class="kpi-unit">${k.unit || ''}</span></div>
      <div class="kpi-chg ${cls} mono">${fmtSignedPct(k.chgPct)}</div>
      <div class="kpi-sub">${k.sub || ''}</div>
    </div>`;
}

/* ===========================================================================
   (B) STATE  — CONTRACT §5
   =========================================================================== */

const FILTERS_KEY = 'cacao_filters_v1';
const defaultFilters = {
  period: 'Jun 2026 (MTD)', origin: 'All origins', supplier: 'All suppliers',
  sku: 'All SKUs', currency: 'EUR', version: 'v5 · June Rolling (CURRENT)',
};

function loadFilters() {
  try {
    return { ...defaultFilters, ...JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}') };
  } catch (e) {
    return { ...defaultFilters };
  }
}
function saveFilters(f) {
  FILTERS = f;
  try { localStorage.setItem(FILTERS_KEY, JSON.stringify(f)); } catch (e) { /* noop */ }
}

let FILTERS = loadFilters();
let WHATIF_STATE = { ...DATA.whatIf.baseline };   // mutated by sliders in views2

/* ===========================================================================
   (C) VIEWS registry + switchView  — CONTRACT §4
   =========================================================================== */

const VIEWS = {};
let CURRENT_VIEW = 'dashboard';

function switchView(name) {
  destroyCharts();
  const v = VIEWS[name];
  if (!v) return;
  $('#canvas').innerHTML = v.render();
  $('#canvas').scrollTop = 0;
  CURRENT_VIEW = name;
  setTimeout(() => { v.draw && v.draw(); }, 30);
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
}

/* ---- shared small builders ---------------------------------------------- */
function viewHead(title, sub, actionsHtml) {
  return `
    <div class="view-head">
      <div><div class="view-title">${title}</div><div class="view-sub">${sub}</div></div>
      <div class="view-actions">${actionsHtml || ''}</div>
    </div>`;
}

function ghostBtn(action, label) {
  return `<button class="btn btn-ghost" data-action="${action}">${label}</button>`;
}
function primaryBtn(action, label) {
  return `<button class="btn btn-primary" data-action="${action}">${label}</button>`;
}

/* Map a status string -> badge color class per CONTRACT §6. */
function statusBadgeClass(status) {
  const s = String(status || '').toUpperCase();
  if (/^(EFFECTIVE|DONE|FIXED|PASS|PAID|SUBMITTED|CURRENT|MATCHED|POSTED|LONG)$/.test(s)) return 'badge-pos';
  if (/^(WATCH|IN_PROGRESS|OPEN|PARTIAL|PENDING|DRAFT|WORKING|VARIANCE)$/.test(s)) return 'badge-warn';
  if (/^(FAILED|GAP|FAIL|UNPRICED|NONE)$/.test(s)) return 'badge-neg';
  if (/^(SUPERSEDED|FROZEN|BUDGET|SHORT)$/.test(s)) return 'badge-info';
  return 'badge-muted';
}
function badge(status) {
  return `<span class="badge ${statusBadgeClass(status)}">${status}</span>`;
}

/* Custom waterfall renderer shared by dashboard + ppv. steps:
 * [{ label, value, type: base|add|sub|total, running }] with drillAction. */
function renderWaterfall(steps, drillAction) {
  // Compute running totals and a global max for proportional bar heights.
  let running = 0;
  const rows = steps.map((s) => {
    let barBottom, barTop;
    if (s.type === 'base' || s.type === 'total') {
      barBottom = 0;
      running = s.value;
      barTop = s.value;
    } else {
      barBottom = running;
      running = running + s.value;
      barTop = running;
      // For a sub step the bar spans from new(lower) to old(higher)
      if (s.value < 0) { barBottom = running; barTop = running - s.value; }
    }
    return { ...s, barBottom, barTop, runAfter: running };
  });
  const maxTop = Math.max(...rows.map((r) => Math.max(r.barTop, r.barBottom)), 1);

  const cols = rows.map((r) => {
    const fullCol = (r.type === 'base' || r.type === 'total');
    const topPct = (r.barTop / maxTop) * 100;
    const botPct = (r.barBottom / maxTop) * 100;
    const heightPct = Math.max(topPct - botPct, 1.5);
    let innerCls = 'wf-bar-inner';
    if (r.type === 'add') innerCls += ' neg';      // adds raise cost => red-tinted
    else if (r.type === 'sub') innerCls += ' pos'; // subs lower cost => green-tinted
    else innerCls += ' base';

    const drillAttr = (r.type !== 'total' && drillAction)
      ? ` data-action="${drillAction}" data-payload="${r.label}"`
      : '';

    const valTxt = (r.type === 'base' || r.type === 'total')
      ? fmtEur(r.value)
      : fmtSigned(r.value);

    return `
      <div class="wf-col"${drillAttr}>
        <div class="wf-val mono">${valTxt}</div>
        <div class="wf-bar" style="height:100%;">
          <div class="${innerCls}" style="bottom:${botPct}%;height:${heightPct}%;${fullCol ? '' : ''}"></div>
        </div>
        <div class="wf-label">${r.label}</div>
      </div>`;
  }).join('<div class="wf-connector"></div>');

  return `<div class="waterfall">${cols}</div>`;
}

/* ===========================================================================
   (D) CORE VIEWS
   =========================================================================== */

/* ---- 1. DASHBOARD -------------------------------------------------------- */
VIEWS.dashboard = {
  render() {
    const k = DATA.kpis;
    const heroTiles = [
      kpiBlock(k.spendMTD, true,  'spendMTD'),  // spend down = good (green)
      kpiBlock(k.avgCost,  true,  'avgCost'),   // landed cost up = bad (red)
      kpiBlock(k.ppvMTD,   true,  'ppvMTD'),    // adverse variance up = bad (red)
      kpiBlock(k.hedgeCov, false, 'hedgeCov'),  // coverage up = good (green)
      kpiBlock(k.invValue, true,  'invValue'),  // inventory value up = working capital risk (red)
    ].join('');

    const originPills = DATA.originSpend.map((o) => `
      <div class="origin-pill" data-action="drill-origin" data-payload="${o.code}">
        <span class="dot" style="background:${o.color};"></span>
        <span class="mono">${o.code}</span>
        <span class="origin-pill-val mono">${fmtEurM(o.spendM * 1e6, 1)}</span>
      </div>`).join('');

    const alertItems = DATA.alerts.map((a, i) => `
      <div class="alert-item" data-action="drill-alert" data-payload="${i}">
        <span class="alert-sev ${a.sev}"></span>
        <div>
          <div class="alert-title">${a.title}</div>
          <div class="alert-body">${a.body}</div>
        </div>
        <div class="alert-time mono">${a.time}</div>
      </div>`).join('');

    return `
      ${viewHead('Procurement Dashboard',
        'Cocoa cost & exposure overview · Jun 2026 (MTD) · SwissCo Group',
        ghostBtn('snapshot-dashboard', '◳ Snapshot') + ghostBtn('export-pdf', '↗ PDF') + primaryBtn('run-forecast', 'Run Forecast'))}

      <div class="hero-kpis">${heroTiles}</div>

      <div class="grid grid-1-2">
        <div class="card">
          <div class="card-head"><div class="card-title">60-Day Spot History</div>
            <div class="card-sub">ICE NY (USD/t) · ICE LDN (GBP/t)</div></div>
          <div class="card-body"><div class="chart-wrap"><canvas id="c-spot"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">Spend by Origin</div>
            <div class="card-sub">MTD physical spend · €M</div></div>
          <div class="card-body">
            <div class="chart-wrap"><canvas id="c-origin"></canvas></div>
            <div class="origin-pills">${originPills}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Cost Build-Up — Standard → Landed</div>
          <div class="card-sub">€/t bridge · click a driver to investigate</div></div>
        <div class="card-body">${renderWaterfall(DATA.costBridge, 'drill-driver')}</div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Alerts</div>
          <div class="card-sub">${DATA.alerts.length} open · procurement & risk</div></div>
        <div class="card-body"><div class="alert-feed">${alertItems}</div></div>
      </div>`;
  },
  draw() {
    const sh = DATA.spotHistory;
    mkChart('c-spot', {
      type: 'line',
      data: {
        labels: sh.labels,
        datasets: [
          { label: 'ICE NY (USD/t)', data: sh.ny, borderColor: '#c9a96e', backgroundColor: 'rgba(201,169,110,.12)',
            yAxisID: 'y', tension: .25, pointRadius: 0, borderWidth: 2, fill: true },
          { label: 'ICE LDN (GBP/t)', data: sh.ldn, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,.08)',
            yAxisID: 'y1', tension: .25, pointRadius: 0, borderWidth: 2, fill: false },
        ],
      },
      options: lineOpts({ dualAxis: true }),
    });

    const os = DATA.originSpend;
    mkChart('c-origin', {
      type: 'doughnut',
      data: {
        labels: os.map((o) => o.code),
        datasets: [{
          data: os.map((o) => o.spendM),
          backgroundColor: os.map((o) => o.color),
          borderColor: '#0f141b', borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { display: false } },
      },
    });
  },
};

/* ---- 2. MARKET DESK ------------------------------------------------------ */
VIEWS.market = {
  render() {
    const fx = DATA.ticker.filter((t) => /\//.test(t.sym) && t.unit === '');
    const fxRows = [
      ['EUR/USD', DATA.ticker.find((t) => t.sym === 'EUR/USD')],
      ['GBP/USD', DATA.ticker.find((t) => t.sym === 'GBP/USD')],
      ['EUR/CHF', DATA.ticker.find((t) => t.sym === 'EUR/CHF')],
    ].filter((r) => r[1]).map(([sym, t]) => `
      <tr>
        <td class="cell-strong mono">${sym}</td>
        <td class="num mono">${fmtNum(t.px, 4)}</td>
        <td class="num mono ${signClass(t.chg)}">${fmtSigned(t.chg, 4)}</td>
        <td class="num mono ${signClass(t.chgPct)}">${fmtSignedPct(t.chgPct)}</td>
      </tr>`).join('');

    const diffRows = DATA.originSpend.map((o) => `
      <tr>
        <td class="cell-strong mono">${o.code}</td>
        <td>${o.name}</td>
        <td class="num mono">${fmtSigned(o.premiumUsd)} $/t</td>
        <td class="num mono">${fmtPct(o.certPct, 0)}</td>
      </tr>`).join('');

    const news = [
      { time: '08:20', title: 'ICCO lifts 2025/26 deficit estimate to −478kt',
        body: 'International Cocoa Organization revised the global supply deficit wider on weaker mid-crop arrivals from West Africa, the fourth consecutive deficit season.' },
      { time: '07:45', title: 'West African weather: Harmattan eases, rains return to CIV',
        body: 'Improved soil moisture across Côte d\'Ivoire growing belt supports mid-crop pod development, though black-pod disease risk rises in southern regions.' },
      { time: '07:10', title: 'EU Q2 grindings tracking +2.1% y/y',
        body: 'European Cocoa Association preliminary grind data points to resilient demand despite elevated bean prices; powder/butter ratio favoring butter.' },
      { time: '06:30', title: 'EUDR enforcement clock: 196 days to full applicability',
        body: 'Operators must complete geolocation and due-diligence statements; CMR and NGA smallholder coverage remains the key gap for compliant sourcing.' },
    ].map((n) => `
      <div class="news-item">
        <div class="news-time mono">${n.time}</div>
        <div class="news-title">${n.title}</div>
        <div class="news-body">${n.body}</div>
      </div>`).join('');

    return `
      ${viewHead('Market Desk',
        'ICE cocoa futures, FX cross-rates & origin differentials · live feed',
        ghostBtn('set-alert', '◔ Set Alert') + ghostBtn('strategy-book', '▦ Strategy Book') + primaryBtn('new-position', '+ New Position'))}

      <div class="card">
        <div class="card-head"><div class="card-title">ICE Futures Curve</div>
          <div class="card-sub">NY USD/t (left) · LDN GBP/t (right) · 8 expiries</div></div>
        <div class="card-body"><div class="chart-wrap"><canvas id="c-curve"></canvas></div></div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><div class="card-title">FX Cross-Rates</div></div>
          <div class="card-body">
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Pair</th><th class="th-num">Px</th><th class="th-num">Chg</th><th class="th-num">Chg %</th></tr></thead>
              <tbody>${fxRows}</tbody>
            </table></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">Origin Differentials</div></div>
          <div class="card-body">
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Origin</th><th>Name</th><th class="th-num">Diff</th><th class="th-num">Cert</th></tr></thead>
              <tbody>${diffRows}</tbody>
            </table></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Market News</div>
          <div class="card-sub">Reuters · ICCO · ECA wire</div></div>
        <div class="card-body"><div class="news-feed">${news}</div></div>
      </div>`;
  },
  draw() {
    const fc = DATA.futuresCurve;
    mkChart('c-curve', {
      type: 'line',
      data: {
        labels: fc.labels,
        datasets: [
          { label: 'ICE NY (USD/t)', data: fc.ny, borderColor: '#c9a96e', backgroundColor: 'rgba(201,169,110,.12)',
            yAxisID: 'y', tension: .2, pointRadius: 3, borderWidth: 2, fill: true },
          { label: 'ICE LDN (GBP/t)', data: fc.ldn, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,.08)',
            yAxisID: 'y1', tension: .2, pointRadius: 3, borderWidth: 2, fill: false },
        ],
      },
      options: lineOpts({ dualAxis: true }),
    });
  },
};

/* ---- 3. PHYSICAL CONTRACTS ----------------------------------------------- */
VIEWS.contracts = {
  render() {
    const rows = DATA.contracts.map((c) => {
      const priceTxt = (!c.price || c.price === 0) ? '—' : fmtEur(c.price);
      const certTxt = (!c.cert || c.cert === '—')
        ? '—'
        : `<span class="pill pill-info">${c.cert}</span>`;
      return `
        <tr class="row-click" data-action="view-contract" data-payload="${c.id}">
          <td class="cell-strong mono">${c.id}</td>
          <td class="mono">${c.origin}</td>
          <td>${c.supplier}</td>
          <td><span class="pill ${c.basis === 'PTBF' ? 'pill-warn' : 'pill-info'}">${c.basis}</span></td>
          <td class="num mono">${fmtInt(c.mt)}</td>
          <td class="mono">${c.execMonth}</td>
          <td class="num mono">${priceTxt}</td>
          <td class="num mono">${fmtSigned(c.diff)} $</td>
          <td>${badge(c.status)}</td>
          <td>${certTxt}</td>
          <td class="num mono">${fmtPct(c.hedgePct, 0)}</td>
        </tr>`;
    }).join('');

    const totalMt = DATA.contracts.reduce((s, c) => s + c.mt, 0);
    return `
      ${viewHead('Physical Contracts',
        `${DATA.contracts.length} active contracts · ${fmtInt(totalMt)} MT · iRely CTRM register`,
        ghostBtn('import-irely', '⇩ Import iRely') + ghostBtn('fix-ptbf', '◎ Fix PTBF') + primaryBtn('new-contract', '+ New Contract'))}

      <div class="card">
        <div class="card-head"><div class="card-title">Active Contract Register</div>
          <div class="card-sub">PTBF & flat-price physical positions · click a row to drill</div></div>
        <div class="card-body">
          <div class="table-wrap"><table class="table">
            <thead><tr>
              <th>Contract</th><th>Origin</th><th>Supplier</th><th>Basis</th>
              <th class="th-num">MT</th><th>Exec</th><th class="th-num">Price</th>
              <th class="th-num">Diff</th><th>Status</th><th>Cert</th><th class="th-num">Hedge</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>`;
  },
};

/* ---- 4. PPV ANALYSIS ----------------------------------------------------- */
function ppvBridgeSteps() {
  // Derive €/t bridge from Standard 7975 -> Actual ~8142 (matches landed/avgCost).
  return [
    { label: 'Standard',       value: 7975, type: 'base'  },
    { label: '+Futures',       value: 168,  type: 'add'   },
    { label: '+Origin Diff',   value: 132,  type: 'add'   },
    { label: '+Sustainability',value: 96,   type: 'add'   },
    { label: '+Freight',       value: 64,   type: 'add'   },
    { label: '−Mix',           value: -148, type: 'sub'   },
    { label: '−FX',            value: -135, type: 'sub'   },
    { label: 'Actual',         value: 8142, type: 'total' },
  ];
}

VIEWS.ppv = {
  render() {
    const skuRows = DATA.ppvDetail.map((p) => {
      const varT = p.actEur - p.stdEur;                 // €/t (positive = adverse)
      const totalVar = varT * p.mt;                     // raw €
      const varCls = varT > 0 ? 'neg' : (varT < 0 ? 'pos' : 'muted');
      const totCls = totalVar > 0 ? 'neg' : (totalVar < 0 ? 'pos' : 'muted');
      // FX impact: negative fx is adverse => red. invert so negative => neg.
      const fxCls = signClass(p.fxImpact, true);
      return `
        <tr class="row-click" data-action="drill-sku" data-payload="${p.sku}">
          <td class="cell-strong mono">${p.sku}</td>
          <td>${p.desc}</td>
          <td class="num mono">${fmtInt(p.mt)}</td>
          <td class="num mono">${fmtEur(p.stdEur)}</td>
          <td class="num mono">${fmtEur(p.actEur)}</td>
          <td class="num mono ${varCls}">${fmtSigned(varT)}</td>
          <td class="num mono ${totCls}">${fmtEurM(totalVar)}</td>
          <td class="num mono ${fxCls}">${fmtSigned(p.fxImpact)}</td>
        </tr>`;
    }).join('');

    const totalVarEur = DATA.ppvDetail.reduce((s, p) => s + (p.actEur - p.stdEur) * p.mt, 0);

    return `
      ${viewHead('PPV Analysis',
        'Purchase price variance · Standard → Actual · Jun 2026 (MTD)',
        ghostBtn('generate-commentary', '✎ Generate Commentary') + ghostBtn('export-excel', '↗ Export'))}

      <div class="card">
        <div class="card-head"><div class="card-title">PPV Bridge — Standard → Actual</div>
          <div class="card-sub">€/t decomposition · adverse drivers red, favorable green</div></div>
        <div class="card-body">${renderWaterfall(ppvBridgeSteps(), 'drill-driver')}</div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">PPV by SKU</div>
          <div class="card-sub">Total variance ${fmtEurM(totalVarEur)} ${totalVarEur > 0 ? 'adverse' : 'favorable'} · click a SKU to drill</div></div>
        <div class="card-body">
          <div class="table-wrap"><table class="table">
            <thead><tr>
              <th>SKU</th><th>Description</th><th class="th-num">MT</th>
              <th class="th-num">Std €/t</th><th class="th-num">Act €/t</th>
              <th class="th-num">Var €/t</th><th class="th-num">Total Var</th><th class="th-num">FX</th>
            </tr></thead>
            <tbody>${skuRows}</tbody>
          </table></div>
        </div>
      </div>`;
  },
  // draw: none. Commentary card is patched on in views2.js.
};

/* ---- 5. HEDGE BOOK ------------------------------------------------------- */
VIEWS.hedge = {
  render() {
    const netMtm = DATA.hedges.reduce((s, h) => s + h.mtmEur, 0);
    const openCount = DATA.hedges.length;
    const kpis = [
      { label: 'Net MTM',        value: fmtEurM(netMtm), unit: '',  chgPct: 5.2, sub: 'open derivative book' },
      { label: 'Open Positions', value: openCount,        unit: '',  chgPct: 0.0, sub: '4 books · 2 FX' },
      { label: 'Q3 Coverage',    value: 78,               unit: '%', chgPct: 4.0, sub: 'target 80%' },
      { label: 'Q4 Coverage',    value: 62,               unit: '%', chgPct: -3.0, sub: 'building exposure' },
    ];
    const kpiHtml = kpis.map((k, i) => kpiBlock(k, i === 3)).join('');

    const rows = DATA.hedges.map((h) => {
      const sideCls = h.side === 'LONG' ? 'badge-pos' : 'badge-info';
      const pxTxt = h.avgPx < 100 ? fmtNum(h.avgPx, 3) : fmtNum(h.avgPx, 0);
      return `
        <tr>
          <td class="cell-strong mono">${h.id}</td>
          <td>${h.book}</td>
          <td><span class="badge ${sideCls}">${h.side}</span></td>
          <td class="num mono">${fmtInt(h.contracts)}</td>
          <td class="num mono">${fmtInt(h.lots)}</td>
          <td class="mono">${h.expiry}</td>
          <td class="num mono">${pxTxt}</td>
          <td class="num mono ${signClass(h.mtmEur)}">${fmtEur(h.mtmEur)}</td>
          <td>${badge(h.status)}</td>
        </tr>`;
    }).join('');

    return `
      ${viewHead('Hedge Book',
        'ICE futures & FX hedges · IFRS 9 cash-flow designations',
        ghostBtn('effectiveness-test', '∿ Effectiveness Test') + ghostBtn('var-report', '◔ VaR Report') + primaryBtn('new-hedge', '+ New Hedge'))}

      <div class="hero-kpis">${kpiHtml}</div>

      <div class="card">
        <div class="card-head"><div class="card-title">Hedged vs Open Exposure (12M)</div>
          <div class="card-sub">Monthly demand decomposed · MT</div>
          <div class="card-actions">
            <button class="card-action" data-action="run-prospective">Run Prospective</button>
            <button class="card-action" data-action="export-pwc">Export PwC</button>
            <button class="card-action" data-action="dedesignate-failed">De-designate</button>
          </div></div>
        <div class="card-body"><div class="chart-wrap"><canvas id="c-hedge"></canvas></div></div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Open Positions</div>
          <div class="card-sub">${DATA.hedges.length} positions · mark-to-market</div></div>
        <div class="card-body">
          <div class="table-wrap"><table class="table">
            <thead><tr>
              <th>ID</th><th>Book</th><th>Side</th><th class="th-num">Contracts</th>
              <th class="th-num">Lots</th><th>Expiry</th><th class="th-num">Avg Px</th>
              <th class="th-num">MTM</th><th>Status</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>`;
  },
  draw() {
    const hc = DATA.hedgeCoverage;
    const open = hc.demand.map((d, i) => Math.max(d - hc.hedged[i], 0));
    mkChart('c-hedge', {
      type: 'bar',
      data: {
        labels: hc.labels,
        datasets: [
          { label: 'Hedged', data: hc.hedged, backgroundColor: '#c9a96e', borderColor: '#c9a96e', borderWidth: 0, stack: 'cov' },
          { label: 'Open',   data: open,       backgroundColor: '#374357', borderColor: '#374357', borderWidth: 0, stack: 'cov' },
        ],
      },
      options: barOpts({ stacked: true, valueSuffix: '' }),
    });
  },
};

/* ---- 6. INVENTORY VALUATION ---------------------------------------------- */
VIEWS.inventory = {
  render() {
    const totalValueEur = DATA.inventory.reduce((s, r) => s + r.valueK * 1000, 0);
    const totalMt = DATA.inventory.reduce((s, r) => s + r.mt, 0);
    const skuCount = DATA.inventory.length;
    const kpis = [
      { label: 'Total Value', value: fmtEurM(totalValueEur), unit: '',   chgPct: 1.8, sub: `${skuCount} SKUs · 4 forms` },
      { label: 'Total MT',    value: fmtInt(totalMt),         unit: ' MT', chgPct: -0.9, sub: 'on hand + in-transit' },
      { label: 'SKUs',        value: 9,                       unit: '',    chgPct: 0.0, sub: 'beans, liquor, butter, powder, cake' },
    ];
    const kpiHtml = kpis.map((k, i) => kpiBlock(k, i === 0)).join('');

    const agingBadge = (a) => {
      if (a === '<30d')   return `<span class="badge badge-pos">${a}</span>`;
      if (a === '30-60d') return `<span class="badge badge-info">${a}</span>`;
      if (a === '60-90d') return `<span class="badge badge-warn">${a}</span>`;
      return `<span class="badge badge-neg">${a}</span>`;
    };

    const rows = DATA.inventory.map((r) => `
      <tr class="row-click" data-action="drill-sku" data-payload="${r.sku}">
        <td class="cell-strong mono">${r.sku}</td>
        <td>${r.form}</td>
        <td>${r.location}</td>
        <td class="num mono">${fmtInt(r.mt)}</td>
        <td class="num mono">${fmtEur(r.wac)}</td>
        <td class="num mono">${fmtEur(r.valueK * 1000)}</td>
        <td>${agingBadge(r.aging)}</td>
      </tr>`).join('');

    return `
      ${viewHead('Inventory Valuation',
        'Weighted-average cost · LCM/NRV · 4 forms across 6 locations',
        ghostBtn('cycle-count', '▦ Cycle Count') + ghostBtn('lcm-test', '◔ LCM Test') + primaryBtn('reserve-calc', '∑ Reserve Calc'))}

      <div class="hero-kpis">${kpiHtml}</div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><div class="card-title">Value by Form</div>
            <div class="card-sub">€k · weighted-average cost</div></div>
          <div class="card-body"><div class="chart-wrap"><canvas id="c-invform"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">Aging Distribution</div>
            <div class="card-sub">€k by inventory age bucket</div></div>
          <div class="card-body"><div class="chart-wrap"><canvas id="c-invage"></canvas></div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Inventory Detail</div>
          <div class="card-sub">${DATA.inventory.length} SKUs · click a row to drill</div></div>
        <div class="card-body">
          <div class="table-wrap"><table class="table">
            <thead><tr>
              <th>SKU</th><th>Form</th><th>Location</th><th class="th-num">MT</th>
              <th class="th-num">WAC</th><th class="th-num">Value</th><th>Aging</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>`;
  },
  draw() {
    // Value by form (sum valueK by form)
    const byForm = {};
    DATA.inventory.forEach((r) => { byForm[r.form] = (byForm[r.form] || 0) + r.valueK; });
    const forms = Object.keys(byForm);
    mkChart('c-invform', {
      type: 'bar',
      data: {
        labels: forms,
        datasets: [{ label: 'Value (€k)', data: forms.map((f) => byForm[f]),
          backgroundColor: '#c9a96e', borderColor: '#c9a96e', borderWidth: 0 }],
      },
      options: barOpts({ indexAxis: 'y', showLegend: false, valuePrefix: '€', valueSuffix: 'k' }),
    });

    // Aging distribution (sum valueK by bucket)
    const buckets = ['<30d', '30-60d', '60-90d', '>90d'];
    const byAge = buckets.map((b) => DATA.inventory.filter((r) => r.aging === b)
      .reduce((s, r) => s + r.valueK, 0));
    mkChart('c-invage', {
      type: 'doughnut',
      data: {
        labels: buckets,
        datasets: [{
          data: byAge,
          backgroundColor: ['#2dd4a4', '#4aa3ff', '#f5b342', '#ff5466'],
          borderColor: '#0f141b', borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { display: true, labels: { color: CHART_LABEL, font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8 } } },
      },
    });
  },
};

/* ---- 7. FORECAST & PLANNING ---------------------------------------------- */
VIEWS.forecast = {
  render() {
    const scenRows = DATA.scenarios.map((s) => {
      const pnlCls = s.pnlM > 0 ? 'pos' : (s.pnlM < 0 ? 'neg' : 'muted');
      return `
        <tr>
          <td class="cell-strong">${s.name}</td>
          <td class="num mono">${fmtUsd(s.nyPx)}</td>
          <td class="num mono">${fmtPct(s.prob, 0)}</td>
          <td class="num mono ${pnlCls}">${fmtM(s.pnlM)}</td>
          <td class="num mono">${fmtEur(s.landed)}</td>
        </tr>`;
    }).join('');

    const assumptions = [
      ['ICE NY (USD/t)', fmtInt(7842)],
      ['ICE LDN (GBP/t)', fmtInt(5418)],
      ['EUR/USD', fmtNum(1.085, 3)],
      ['CIV differential', fmtSigned(240) + ' $/t'],
      ['Sustainability', fmtSigned(96) + ' $/t'],
      ['Monthly volume', fmtInt(6400) + ' MT'],
      ['Version', 'v5 · June Rolling'],
      ['Approver', 'CFO'],
    ].map(([k, v]) => `
      <div class="kv"><span class="kv-k">${k}</span><span class="kv-v mono">${v}</span></div>`).join('');

    const fy27 = [
      { sku: 'BN-CIV-STD', cur: 7975, prop: 8190 },
      { sku: 'BN-GHA-STD', cur: 8050, prop: 8265 },
      { sku: 'BT-DE-01',   cur: 14850, prop: 15320 },
      { sku: 'PW-DE-01',   cur: 6420, prop: 6485 },
    ].map((s) => {
      const dPct = ((s.prop - s.cur) / s.cur) * 100;
      return `
        <tr>
          <td class="cell-strong mono">${s.sku}</td>
          <td class="num mono">${fmtEur(s.cur)}</td>
          <td class="num mono">${fmtEur(s.prop)}</td>
          <td class="num mono ${signClass(dPct)}">${fmtSignedPct(dPct)}</td>
        </tr>`;
    }).join('');

    return `
      ${viewHead('Forecast & Planning',
        'Rolling 12-month spend forecast · scenario P&L · standard-cost proposal',
        ghostBtn('lock-forecast', '🔒 Lock') + ghostBtn('compare-versions', '⑂ Compare') + ghostBtn('branch-current', '⌥ Branch') + ghostBtn('submit-approval', '✓ Submit') + primaryBtn('run-scenarios', '⚄ Run Scenarios'))}

      <div class="card">
        <div class="card-head"><div class="card-title">Actual vs Forecast vs Budget (12M)</div>
          <div class="card-sub">Monthly cocoa spend · €M</div></div>
        <div class="card-body"><div class="chart-wrap"><canvas id="c-forecast"></canvas></div></div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><div class="card-title">Forecast Assumptions</div>
            <div class="card-sub">v5 · June Rolling (CURRENT)</div></div>
          <div class="card-body"><div class="kv-list">${assumptions}</div></div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">FY27 Standard Cost Proposal</div>
            <div class="card-sub">Current → proposed · annual review</div></div>
          <div class="card-body">
            <div class="table-wrap"><table class="table">
              <thead><tr><th>SKU</th><th class="th-num">Current Std</th><th class="th-num">Proposed Std</th><th class="th-num">Δ%</th></tr></thead>
              <tbody>${fy27}</tbody>
            </table></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Scenario P&L Impact</div>
          <div class="card-sub">Probability-weighted NY price scenarios · €M</div></div>
        <div class="card-body">
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Scenario</th><th class="th-num">NY Px</th><th class="th-num">Prob</th><th class="th-num">P&L</th><th class="th-num">Landed</th></tr></thead>
            <tbody>${scenRows}</tbody>
          </table></div>
        </div>
      </div>`;
  },
  draw() {
    const f = DATA.forecast;
    mkChart('c-forecast', {
      type: 'bar',
      data: {
        labels: f.labels,
        datasets: [
          { type: 'bar', label: 'Actual', data: f.actual,
            backgroundColor: '#c9a96e', borderColor: '#c9a96e', borderWidth: 0, order: 3 },
          { type: 'line', label: 'Forecast', data: f.forecast, borderColor: '#4aa3ff',
            backgroundColor: 'rgba(74,163,255,.08)', borderDash: [6, 4], borderWidth: 2,
            tension: .25, pointRadius: 0, order: 1 },
          { type: 'line', label: 'Budget', data: f.budget, borderColor: '#7a8597',
            backgroundColor: 'transparent', borderWidth: 2, tension: .25, pointRadius: 0, order: 2 },
        ],
      },
      options: barOpts({ valuePrefix: '€', valueSuffix: 'M' }),
    });
  },
};

/* ---- 8. MONTH-END CLOSE -------------------------------------------------- */
VIEWS.close = {
  render() {
    const checkRows = DATA.closeChecklist.map((t, i) => `
      <tr class="row-click" data-action="drill-task" data-payload="${i}">
        <td class="cell-strong">${t.task}</td>
        <td>${t.owner}</td>
        <td class="mono">${t.due}</td>
        <td>${badge(t.status)}</td>
        <td>${t.notes}</td>
      </tr>`).join('');

    const reconRows = DATA.recon.map((r, i) => {
      const deltaEur = r.deltaK * 1000;
      const deltaCls = r.deltaK !== 0 ? 'neg' : 'muted';
      return `
        <tr class="row-click" data-action="drill-recon" data-payload="${i}">
          <td class="cell-strong">${r.account}</td>
          <td class="num mono">${fmtEur(r.s4 * 1000)}</td>
          <td class="num mono">${fmtEur(r.irely * 1000)}</td>
          <td class="num mono ${deltaCls}">${r.deltaK === 0 ? '—' : fmtEur(deltaEur)}</td>
          <td>${badge(r.status)}</td>
        </tr>`;
    }).join('');

    const jeRows = DATA.journalEntries.map((j, i) => `
      <tr class="row-click" data-action="drill-je" data-payload="${i}">
        <td class="cell-strong mono">${j.je}</td>
        <td>${j.desc}</td>
        <td class="mono">${j.dr}</td>
        <td class="mono">${j.cr}</td>
        <td class="num mono">${fmtEur(j.amountK * 1000)}</td>
        <td>${badge(j.status)}</td>
      </tr>`).join('');

    return `
      ${viewHead('Month-End Close',
        'WD calendar · S/4 ↔ iRely reconciliation · journal entries · Jun 2026',
        ghostBtn('open-blackline', '▦ Open BlackLine') + primaryBtn('sign-off', '✓ Sign-Off'))}

      <div class="card">
        <div class="card-head"><div class="card-title">Close Checklist (WD calendar)</div>
          <div class="card-sub">${DATA.closeChecklist.length} tasks · click a task to drill</div></div>
        <div class="card-body">
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>${checkRows}</tbody>
          </table></div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><div class="card-title">S/4 ↔ iRely Reconciliation</div>
            <div class="card-sub">Sub-ledger tie-out · €</div></div>
          <div class="card-body">
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Account</th><th class="th-num">S/4</th><th class="th-num">iRely</th><th class="th-num">Δ</th><th>Status</th></tr></thead>
              <tbody>${reconRows}</tbody>
            </table></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">Recent Journal Entries</div>
            <div class="card-sub">Close postings · click to drill</div></div>
          <div class="card-body">
            <div class="table-wrap"><table class="table">
              <thead><tr><th>JE</th><th>Description</th><th>Dr</th><th>Cr</th><th class="th-num">Amount</th><th>Status</th></tr></thead>
              <tbody>${jeRows}</tbody>
            </table></div>
          </div>
        </div>
      </div>`;
  },
};

/* ---- 9. SOX & CONTROLS --------------------------------------------------- */
VIEWS.sox = {
  render() {
    const rows = DATA.controls.map((c) => `
      <tr class="row-click" data-action="drill-control" data-payload="${c.id}">
        <td class="cell-strong mono">${c.id}</td>
        <td>${c.name}</td>
        <td>${c.freq}</td>
        <td>${c.owner}</td>
        <td>${badge(c.status)}</td>
        <td class="mono">${c.lastTest}</td>
      </tr>`).join('');

    const trail = [
      { status: 'pos',  time: '2026-06-16 09:42', text: 'CTL-02 Daily futures position limit — tested PASS by Treasury (M. Favre)' },
      { status: 'pos',  time: '2026-06-15 14:18', text: 'CTL-07 S/4 ↔ iRely reconciliation — May tie-out signed by A. Brunner' },
      { status: 'warn', time: '2026-06-10 11:05', text: 'CTL-03 Hedge designation docs — HG-7006 flagged WATCH, evidence requested' },
      { status: 'warn', time: '2026-05-20 16:30', text: 'CTL-06 Inventory cycle count — 2 SKU count variances, recount scheduled' },
      { status: 'neg',  time: '2026-04-30 10:12', text: 'CTL-08 Supplier master change — control GAP identified, remediation owner assigned' },
      { status: 'pos',  time: '2026-05-31 08:55', text: 'CTL-05 PPV variance threshold ±3% — monthly test PASS, no exceptions' },
    ].map((e) => `
      <div class="tl-item">
        <span class="tl-dot ${e.status}"></span>
        <div class="tl-body">${e.text} <span class="tl-time mono">${e.time}</span></div>
      </div>`).join('');

    const requests = [
      { id: 'PBC-118', title: 'Hedge designation memos — Q2 cash-flow hedges', due: 'Due 2026-06-20' },
      { id: 'PBC-121', title: 'Standard cost roll-forward support (FY27 proposal)', due: 'Due 2026-06-24' },
      { id: 'PBC-126', title: 'CTL-08 remediation plan & supplier master log', due: 'Due 2026-06-27' },
    ].map((r) => `
      <div class="rail-item">
        <div class="rail-meta">
          <span class="rail-name mono">${r.id}</span>
          <span class="rail-team">${r.due}</span>
        </div>
        <div class="rail-body-text">${r.title}</div>
        <div class="quick-actions">
          <button class="btn btn-sm" data-action="audit-requests" data-payload="${r.id}">Respond</button>
        </div>
      </div>`).join('');

    return `
      ${viewHead('SOX & Controls',
        'Control matrix · audit trail · PwC PBC requests · FY26',
        ghostBtn('evidence-repo', '▦ Evidence Repo') + ghostBtn('audit-requests', '✉ Audit Requests') + primaryBtn('run-test', '✓ Run Test'))}

      <div class="card">
        <div class="card-head"><div class="card-title">SOX Controls</div>
          <div class="card-sub">${DATA.controls.length} controls · click a control to drill</div></div>
        <div class="card-body">
          <div class="table-wrap"><table class="table">
            <thead><tr><th>ID</th><th>Control</th><th>Freq</th><th>Owner</th><th>Status</th><th>Last Test</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><div class="card-title">Audit Trail</div>
            <div class="card-sub">Recent control executions</div></div>
          <div class="card-body"><div class="timeline">${trail}</div></div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">Open Audit Requests</div>
            <div class="card-sub">PwC prepared-by-client (PBC) queue</div></div>
          <div class="card-body">${requests}</div>
        </div>
      </div>`;
  },
};

/* ===========================================================================
   (E) BOOT  — CONTRACT §2 (top-level; must NOT call switchView)
   =========================================================================== */

function tickerPx(t) {
  if (t.unit === 'USD/t') return fmtUsd(t.px);
  if (t.unit === 'GBP/t') return fmtGbp(t.px);
  if (t.unit === 'idx')   return fmtInt(t.px);
  return fmtNum(t.px, 4);
}

function renderTicker() {
  const strip = $('#ticker-strip');
  if (!strip) return;
  strip.innerHTML = DATA.ticker.map((t) => `
    <div class="ticker-item">
      <span class="ticker-sym mono">${t.sym}</span>
      <span class="ticker-px mono">${tickerPx(t)}</span>
      <span class="ticker-chg mono ${signClass(t.chgPct)}">${fmtSignedPct(t.chgPct)}</span>
    </div>`).join('');
}

function startClock() {
  const el = $('#clock-time');
  if (!el) return;
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const d = new Date();
    el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

function wireNav() {
  $$('.nav-item').forEach((n) => {
    n.addEventListener('click', () => {
      const view = n.dataset.view;
      if (view) switchView(view);
    });
  });
}

/* ---- top-level init (load order: app.js runs first) --------------------- */
renderTicker();
startClock();
wireNav();
