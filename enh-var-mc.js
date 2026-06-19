/* ============================================================================
   CACAO/FP — enh-var-mc.js  (#7 — Monte-Carlo VaR / Expected Shortfall)
   Self-installing enhancement module (ENH_CONTRACT2 patterns B + F).

   Replaces the static ACTIONS['var-report'] with a REAL modal that computes
   one-day portfolio VaR / Expected Shortfall by Monte-Carlo simulation over a
   seeded mulberry32 PRNG (so the figures are reproducible across runs) and
   renders a Chart.js histogram of the simulated P&L distribution with VaR/ES
   reference markers.

   Rules obeyed:
     - Plain JS IIFE, installs at top-level on load.
     - Never reassigns switchView. Reassigns ACTIONS['var-report'] (allowed,
       a live map) and wraps closeModal (allowed top-level fn) for chart teardown.
     - One module-prefixed <style> (vm-*), token-driven; reuses qstat-grid /
       chart-wrap / section-title / kv-list from the design system.
     - Idempotent (guarded), localStorage-free (no persistence needed), all
       library access guarded, zero console errors.
   ========================================================================== */
(function () {
  'use strict';

  /* -- Idempotency guard ---------------------------------------------------- */
  if (window.__enhVarMcInstalled) return;
  window.__enhVarMcInstalled = true;

  /* -- Simulation constants ------------------------------------------------- */
  const SEED        = 0xC0C0A;   // fixed seed → reproducible VaR/ES
  const N_PATHS     = 5000;      // one-day Monte-Carlo paths
  const DAILY_VOL   = 0.022;     // 2.2% daily NY price vol
  const NY_PX_USD   = 7842;      // ICE NY headline (USD/t)
  const EURUSD      = 1.085;     // EUR/USD — convert USD/t → €/t
  const CONTRACT_MT = 10;        // MT per ICE cocoa lot/contract
  const N_BINS      = 41;        // histogram bins (odd → symmetric about 0)

  /* -- Seeded PRNG + gaussian (ENH_CONTRACT2 §F) ---------------------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // Box–Muller standard normal from two uniforms of the seeded stream.
  function gaussian(rnd) {
    let u = rnd(), v = rnd();
    if (u < 1e-12) u = 1e-12;      // guard log(0)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* -- Net delta MT exposure ------------------------------------------------ *
   * netMT = Σ long-cocoa-hedge MT − Σ unpriced physical MT.
   *   hedges: side LONG on a cocoa book (CC / C LDN) => +contracts*10 MT;
   *           FX books (SHORT) carry no price-delta to cocoa => 0.
   *   contracts: status UNPRICED => still price-exposed (must buy later)
   *           => short cocoa exposure => − mt.                                */
  function isCocoaBook(book) {
    const b = String(book || '').toUpperCase();
    return b.indexOf('FX') === -1; // CC NY / C LDN books; FX EURUSD/GBPUSD excluded
  }
  function computeNetMt() {
    const D         = (typeof DATA !== 'undefined' && DATA) ? DATA : {};
    const hedges    = Array.isArray(D.hedges)    ? D.hedges    : [];
    const contracts = Array.isArray(D.contracts) ? D.contracts : [];

    let longHedgeMt = 0;
    hedges.forEach(h => {
      if (String(h.side).toUpperCase() === 'LONG' && isCocoaBook(h.book)) {
        longHedgeMt += (Number(h.contracts) || 0) * CONTRACT_MT;
      }
      // SHORT / FX books => 0 cocoa price-delta (intentionally ignored).
    });

    let unpricedMt = 0;
    contracts.forEach(c => {
      if (String(c.status).toUpperCase() === 'UNPRICED') {
        unpricedMt += Number(c.mt) || 0;
      }
    });

    return { netMt: longHedgeMt - unpricedMt, longHedgeMt, unpricedMt };
  }

  /* -- Monte-Carlo engine --------------------------------------------------- *
   * Work entirely in €/t. Spot €/t = NY USD/t ÷ EUR/USD. One-day sigma €/t =
   * DAILY_VOL * spot€/t. priceMove_i = sigma * Z_i (mean-zero gaussian).
   * P&L_i (€) = netMT * priceMove_i.                                          */
  function runSimulation(netMt) {
    const rnd     = mulberry32(SEED);
    const spotEur = NY_PX_USD / EURUSD;        // ≈ €7,228/t
    const sigEur  = DAILY_VOL * spotEur;       // one-day €/t std dev

    const pnl = new Array(N_PATHS);
    let sum = 0, min = Infinity, max = -Infinity;
    for (let i = 0; i < N_PATHS; i++) {
      const move = sigEur * gaussian(rnd);     // €/t one-day price move
      const p = netMt * move;                  // € P&L
      pnl[i] = p;
      sum += p;
      if (p < min) min = p;
      if (p > max) max = p;
    }

    const meanPnl = sum / N_PATHS;
    const sorted  = pnl.slice().sort((a, b) => a - b);

    // VaR / ES: losses are negative P&L; report as positive € loss numbers.
    const var99 = -percentile(sorted, 1);   // 1st percentile of P&L
    const var95 = -percentile(sorted, 5);   // 5th percentile of P&L
    const cut01 = percentile(sorted, 1);    // P&L threshold for the worst 1%
    const es    = -tailMean(sorted, cut01); // mean of P&L at/below the 1% cut

    return {
      pnl, sorted, meanPnl, var99, var95, es,
      cut01, min, max, spotEur, sigEur,
    };
  }

  // Linear-interpolated percentile on an ascending-sorted array (p in 0..100).
  function percentile(sortedAsc, p) {
    const n = sortedAsc.length;
    if (!n) return 0;
    if (n === 1) return sortedAsc[0];
    const rank = (p / 100) * (n - 1);
    const lo = Math.floor(rank), hi = Math.ceil(rank);
    if (lo === hi) return sortedAsc[lo];
    const frac = rank - lo;
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
  }
  // Mean of all P&L values at or below a threshold (the conditional tail mean).
  function tailMean(sortedAsc, threshold) {
    let s = 0, c = 0;
    for (let i = 0; i < sortedAsc.length; i++) {
      if (sortedAsc[i] <= threshold) { s += sortedAsc[i]; c++; } else break;
    }
    return c ? s / c : (sortedAsc[0] || 0);
  }

  /* -- Histogram binning ---------------------------------------------------- */
  function buildHistogram(sim) {
    const lo = sim.min, hi = sim.max;
    const span = (hi - lo) || 1;
    const width = span / N_BINS;
    const counts = new Array(N_BINS).fill(0);
    const centers = new Array(N_BINS);
    for (let b = 0; b < N_BINS; b++) centers[b] = lo + width * (b + 0.5);

    for (let i = 0; i < sim.pnl.length; i++) {
      let idx = Math.floor((sim.pnl[i] - lo) / width);
      if (idx < 0) idx = 0; else if (idx >= N_BINS) idx = N_BINS - 1;
      counts[idx]++;
    }

    // Reference markers: the bin nearest the VaR99 / ES loss thresholds.
    const var99Pnl = -sim.var99; // negative P&L value of the VaR loss
    const esPnl    = -sim.es;
    const binOf = (val) => {
      let idx = Math.floor((val - lo) / width);
      if (idx < 0) idx = 0; else if (idx >= N_BINS) idx = N_BINS - 1;
      return idx;
    };
    return { counts, centers, width, lo, hi, var99Bin: binOf(var99Pnl), esBin: binOf(esPnl) };
  }

  /* -- Formatting helpers (use globals when present) ------------------------ */
  function eur(n)   { return (typeof fmtEur  === 'function') ? fmtEur(Math.round(n)) : '€' + Math.round(n); }
  function eurM(n)  { return (typeof fmtEurM === 'function') ? fmtEurM(n, 2)         : '€' + (n / 1e6).toFixed(2) + 'M'; }
  function intf(n)  { return (typeof fmtInt  === 'function') ? fmtInt(Math.round(n)) : String(Math.round(n)); }
  function esc(s)   { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* -- Module-local modal-chart handle + close teardown (pattern B) --------- */
  let _modalChart = null;
  function teardownChart() {
    if (_modalChart) { try { _modalChart.destroy(); } catch (e) { /* noop */ } _modalChart = null; }
  }
  // Wrap closeModal exactly once so the modal chart is torn down on close.
  // closeModal is a top-level fn in actions.js — reassigning it is acceptable
  // (ENH_CONTRACT2 §B); other modules call it, never lexically capture it.
  try {
    if (typeof closeModal === 'function' && !closeModal.__vmWrapped) {
      const _close = closeModal;
      closeModal = function () { teardownChart(); return _close.apply(this, arguments); };
      closeModal.__vmWrapped = true;
    }
  } catch (e) { /* closeModal not yet defined — chart still torn down via Close button below */ }

  /* -- Chart config (guarded if Chart is missing) --------------------------- */
  function drawHistogram(hist, sim) {
    const el = document.getElementById('mc-hist');
    if (!el || typeof Chart === 'undefined') return;

    const accent  = cssVar('--info',   '#4aa3ff');
    const negCol  = cssVar('--neg',    '#ff5466');
    const warnCol = cssVar('--warn',   '#f5b342');
    const grid    = '#161e2a';
    const tick    = '#7a8597';
    const tickFont = { family: 'JetBrains Mono', size: 10 };

    const labels = hist.centers.map(c => (c / 1e6).toFixed(2)); // €M bin centers
    // Histogram bars, with VaR/ES bins highlighted in place (colored bars).
    const barColors = hist.counts.map((_, b) => {
      if (b === hist.esBin)   return negCol;   // Expected Shortfall marker bin
      if (b === hist.var99Bin) return warnCol; // VaR 99% marker bin
      return accent + '88';                    // semi-transparent info fill
    });
    const maxCount = Math.max.apply(null, hist.counts) || 1;

    const cfg = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'P&L paths',
            data: hist.counts,
            backgroundColor: barColors,
            borderWidth: 0,
            categoryPercentage: 1.0,
            barPercentage: 1.0,
            order: 2,
          },
          // VaR99 vertical reference line (thin full-height bar at its bin).
          {
            label: 'VaR 99%',
            type: 'bar',
            data: hist.counts.map((_, b) => (b === hist.var99Bin ? maxCount : null)),
            backgroundColor: warnCol,
            categoryPercentage: 1.0,
            barPercentage: 0.12,
            order: 1,
          },
          // ES vertical reference line.
          {
            label: 'Expected Shortfall',
            type: 'bar',
            data: hist.counts.map((_, b) => (b === hist.esBin ? maxCount : null)),
            backgroundColor: negCol,
            categoryPercentage: 1.0,
            barPercentage: 0.12,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#b8c2d1', font: { size: 11 }, usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            callbacks: {
              title: (items) => {
                const b = items[0] ? items[0].dataIndex : 0;
                return 'P&L ≈ ' + eur(hist.centers[b]);
              },
              label: (item) => {
                if (item.datasetIndex === 1) return 'VaR 99%: ' + eur(-sim.var99);
                if (item.datasetIndex === 2) return 'ES: ' + eur(-sim.es);
                return item.parsed.y + ' paths';
              },
            },
          },
        },
        scales: {
          x: {
            stacked: false,
            grid: { color: grid, drawBorder: false },
            ticks: {
              color: tick, font: tickFont, maxRotation: 0, autoSkip: true, maxTicksLimit: 9,
              callback: function (value) { return this.getLabelForValue(value) + 'M'; },
            },
            title: { display: true, text: 'One-day P&L (€M)', color: tick, font: tickFont },
          },
          y: {
            stacked: false,
            grid: { color: grid, drawBorder: false },
            ticks: { color: tick, font: tickFont, callback: (v) => intf(v) },
            title: { display: true, text: 'Path count', color: tick, font: tickFont },
          },
        },
      },
    };

    try { _modalChart = new Chart(el, cfg); } catch (e) { _modalChart = null; }
  }

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    } catch (e) { return fallback; }
  }

  /* -- qstat-grid + kv-list builders (match design-system markup) ----------- */
  function qstatGrid(items) {
    return '<div class="qstat-grid">' + items.map(it =>
      '<div class="qstat">' +
        '<div class="qstat-label">' + esc(it.label) + '</div>' +
        '<div class="qstat-value ' + (it.cls || '') + '">' + esc(it.value) + '</div>' +
      '</div>'
    ).join('') + '</div>';
  }
  function kvList(rows) {
    return '<div class="kv-list">' + rows.map(r =>
      '<div class="kv"><span class="kv-k">' + esc(r.k) + '</span>' +
      '<span class="kv-v mono">' + esc(r.v) + '</span></div>'
    ).join('') + '</div>';
  }

  /* -- The real VaR/ES modal ------------------------------------------------ */
  function openVarReport() {
    const exposure = computeNetMt();
    const sim      = runSimulation(exposure.netMt);
    const hist     = buildHistogram(sim);

    const chartLib = (typeof Chart !== 'undefined');
    const meanCls  = sim.meanPnl >= 0 ? 'pos' : 'neg';

    const metrics = qstatGrid([
      { label: 'VaR 99% · 1-day',   value: eurM(sim.var99), cls: 'neg'  },
      { label: 'Expected Shortfall', value: eurM(sim.es),    cls: 'neg'  },
      { label: 'VaR 95% · 1-day',   value: eurM(sim.var95), cls: 'warn' },
      { label: 'Net delta',          value: intf(exposure.netMt) + ' MT', cls: 'info' },
    ]);

    const chartBlock = chartLib
      ? '<div class="section-title">Simulated one-day P&L distribution</div>' +
        '<div class="chart-wrap"><canvas id="mc-hist"></canvas></div>' +
        '<div class="vm-legend">' +
          '<span class="vm-key"><span class="vm-swatch" style="background:var(--warn)"></span>VaR 99% ' + eur(-sim.var99) + '</span>' +
          '<span class="vm-key"><span class="vm-swatch" style="background:var(--neg)"></span>ES ' + eur(-sim.es) + '</span>' +
          '<span class="vm-key"><span class="vm-swatch" style="background:var(--info)"></span>P&L paths</span>' +
        '</div>'
      : '<div class="vm-nochart">Chart.js unavailable — numeric results shown above.</div>';

    const stats = '<div class="section-title">Distribution &amp; methodology</div>' +
      kvList([
        { k: 'Mean 1-day P&L',    v: eur(sim.meanPnl) + (sim.meanPnl >= 0 ? '  (≈ flat)' : '') },
        { k: 'Worst path',        v: eur(sim.min) },
        { k: 'Best path',         v: eur(sim.max) },
        { k: 'Long cocoa hedges', v: intf(exposure.longHedgeMt) + ' MT' },
        { k: 'Unpriced physical', v: '−' + intf(exposure.unpricedMt) + ' MT' },
        { k: 'Spot (€/t)',        v: eur(sim.spotEur) + '  ·  σ ' + eur(sim.sigEur) + '/t' },
      ]);

    const methodology =
      'Seed 0x' + SEED.toString(16).toUpperCase() + ' · N=' + intf(N_PATHS) +
      ' paths · σ ' + (DAILY_VOL * 100).toFixed(1) + '%/day on NY (USD/t ÷ ' + EURUSD +
      ' → €/t) · horizon 1-day · confidence 99% (Box–Muller, mulberry32)';

    modal({
      title: 'Monte-Carlo VaR / Expected Shortfall',
      sub: methodology,
      body: '<span class="vm-mark" data-vm-mark="1"></span>' + metrics + chartBlock + stats,
      footer:
        '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' +
        '<button class="btn btn-primary" data-action="export-pdf">Export PDF</button>',
    });

    // Build the chart AFTER the modal DOM exists (pattern B).
    setTimeout(function () {
      if (!document.querySelector('[data-vm-mark="1"]')) return; // modal already closed
      drawHistogram(hist, sim);
    }, 30);
  }

  /* -- Inject ONE module-prefixed <style> (token-driven) -------------------- */
  function injectStyle() {
    if (document.getElementById('vm-style')) return;
    const css =
      '.vm-legend{display:flex;flex-wrap:wrap;gap:14px;margin:10px 0 4px;' +
        'font:11px var(--mono);color:var(--text-2);}' +
      '.vm-key{display:inline-flex;align-items:center;gap:6px;}' +
      '.vm-swatch{display:inline-block;width:10px;height:10px;border-radius:2px;}' +
      '.vm-nochart{margin-top:12px;padding:10px 12px;border:1px solid var(--line-2);' +
        'border-radius:6px;background:var(--bg-2);color:var(--text-2);' +
        'font:11px var(--sans);}' +
      '.vm-mark{display:none;}';
    const style = document.createElement('style');
    style.id = 'vm-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  /* -- Install (top-level on load) — reassign ACTIONS (pattern #3) --------- */
  injectStyle();
  try {
    if (typeof ACTIONS !== 'undefined' && ACTIONS) {
      ACTIONS['var-report'] = function () { openVarReport(); };
    }
  } catch (e) { /* ACTIONS not defined — module loaded out of order; no-op */ }
})();
