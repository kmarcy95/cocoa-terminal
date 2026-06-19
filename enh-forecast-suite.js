/* ============================================================================
   CACAO/FP — ENHANCEMENT: enh-forecast-suite.js
   Three cards appended to the Forecast & Planning view:
     #4  Driver-Based Forecast (editable)   — live recompute of the forward curve
     #5  Budget vs Actual / Forecast Bridge — materiality-flagged waterfall
     #2  Standard-Cost Roll-Forward         — FY26 → FY27 by component + reval impact

   Self-installing IIFE. Loaded AFTER app.js / views2.js / actions.js and after the
   first/second-wave modules. Compose-wraps VIEWS.forecast.render (ENH_CONTRACT2
   pattern A) and APPENDS one section (three .card blocks) below the existing
   Forecast content — prior output is preserved. Reuses existing globals/helpers
   (renderWaterfall, formatters, DATA) and CSS tokens only. Never reassigns
   switchView; calling it is fine. Idempotent; localStorage in try/catch; zero
   console errors.

   --- Driver math (CARD A) -------------------------------------------------
     landed = 8142
       + (nyPx   - 7842) * 0.9
       + (ldnPx  - 5418) * 0.15
       + (civDiff - 240)
       + (sustain - 96)
       + (eurusd - 1.085) * (-2800)
     monthlySpendM = landed * volume / 1e6
   Forward months (DATA.forecast.actual[i] === null) are rescaled to PRESERVE THE
   CURVE SHAPE: forecast[i] = origForecast[i] * (monthlySpendM / baseFirstForecast),
   where baseFirstForecast is the original forecast value of the first forward month
   at baseline inputs. Actual months are left untouched. At baseline inputs the
   scale factor is 1.0, so the curve reproduces the seed forecast exactly.

   --- Bridge allocation (CARD B) -------------------------------------------
     budgetTotal = Σ budget ; fcstTotal = Σ (actual ?? forecast)
     delta = fcstTotal - budgetTotal   (positive = adverse / over-spend)
     Allocated Price 55% / Volume 20% / FX 15% / Mix·Timing 10%.
     Materiality threshold = ±3% of budgetTotal; |leg| ≥ threshold → MATERIAL.
     Color: adverse (+spend) => neg/red ; favorable (−spend) => pos/green.

   --- Std-cost roll (CARD C) -----------------------------------------------
     Current std €7,975/t split by component (sums to 7,975). Each component
     rolled to a market-implied level; Proposed FY27 ≈ current landed (~€8,140).
     Inventory reval = (proposedStd − 7,975) × Σ DATA.inventory[].mt  → € P&L.
   ========================================================================== */
(function installForecastSuite() {
  'use strict';

  // --- Idempotency guard (double-install safe) -----------------------------
  if (window.__cacaoForecastSuiteInstalled) return;
  window.__cacaoForecastSuiteInstalled = true;

  // --- Constants ------------------------------------------------------------
  var LS_KEY = 'cacao_fcsuite_v1';
  var CURRENT_STD = 7975;              // €/t current FY26 standard
  var PROPOSED_TARGET = 8140;          // €/t target proposed FY27 std (≈ landed)
  // Driver sensitivities (per CARD A spec)
  var K_NY = 0.9, K_LDN = 0.15, K_CIV = 1, K_SUS = 1, K_FX = -2800;
  var LANDED_BASE = 8142;
  // Bridge leg allocation shares (documented in card-sub)
  var LEG_PRICE = 0.55, LEG_VOLUME = 0.20, LEG_FX = 0.15, LEG_MIX = 0.10;
  var MATERIALITY_PCT = 0.03;          // ±3% of budget total

  // Baseline drivers (never mutate DATA.whatIf.baseline) ---------------------
  function baseline() {
    var b = (typeof DATA !== 'undefined' && DATA.whatIf && DATA.whatIf.baseline)
      ? DATA.whatIf.baseline : {};
    return {
      nyPx:   num(b.nyPx,   7842),
      ldnPx:  num(b.ldnPx,  5418),
      eurusd: num(b.eurusd, 1.085),
      civDiff:num(b.civDiff,240),
      sustain:num(b.sustain,96),
      volume: num(b.volume, 6400),
    };
  }

  function num(v, fallback) {
    var n = (typeof v === 'number' && isFinite(v)) ? v : parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  // Working driver state (mutated by inputs / reset) -------------------------
  var STATE = loadState();

  function loadState() {
    var b = baseline();
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    } catch (e) { saved = {}; }
    return {
      nyPx:   num(saved.nyPx,   b.nyPx),
      ldnPx:  num(saved.ldnPx,  b.ldnPx),
      eurusd: num(saved.eurusd, b.eurusd),
      civDiff:num(saved.civDiff,b.civDiff),
      sustain:num(saved.sustain,b.sustain),
      volume: num(saved.volume, b.volume),
    };
  }

  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(STATE)); } catch (e) { /* ignore */ }
  }

  // --- Forecast series helpers ----------------------------------------------
  function fc() {
    return (typeof DATA !== 'undefined' && DATA.forecast) ? DATA.forecast : null;
  }

  // Original (seed) forecast curve — captured ONCE so recompute is reversible.
  var ORIG_FORECAST = (function () {
    var f = fc();
    return f && Array.isArray(f.forecast) ? f.forecast.slice() : [];
  })();

  function isForward(f, i) { return f.actual[i] === null || f.actual[i] === undefined; }

  // Original forecast value of the FIRST forward month (curve-shape anchor).
  function baseFirstForecast(f) {
    for (var i = 0; i < f.actual.length; i++) {
      if (isForward(f, i)) {
        var v = ORIG_FORECAST[i];
        return (typeof v === 'number' && isFinite(v) && v !== 0) ? v : 1;
      }
    }
    return 1;
  }

  // landed €/t from current driver STATE
  function computeLanded(s) {
    return LANDED_BASE
      + (s.nyPx   - 7842)  * K_NY
      + (s.ldnPx  - 5418)  * K_LDN
      + (s.civDiff - 240)  * K_CIV
      + (s.sustain - 96)   * K_SUS
      + (s.eurusd - 1.085) * K_FX;
  }

  function computeMonthlySpendM(s) {
    return computeLanded(s) * s.volume / 1e6;
  }

  /**
   * Rebuild DATA.forecast.forecast[] for forward months by SCALING the original
   * curve to preserve its shape. Actual months are left unchanged.
   * @returns {{landed:number, monthlySpendM:number, scale:number}}
   */
  function rebuildForecast() {
    var f = fc();
    var landed = computeLanded(STATE);
    var monthlySpendM = computeMonthlySpendM(STATE);
    if (!f) return { landed: landed, monthlySpendM: monthlySpendM, scale: 1 };
    var anchor = baseFirstForecast(f);
    var scale = monthlySpendM / anchor;
    for (var i = 0; i < f.forecast.length; i++) {
      if (isForward(f, i)) {
        var orig = ORIG_FORECAST[i];
        f.forecast[i] = (typeof orig === 'number' && isFinite(orig))
          ? Math.round(orig * scale * 100) / 100
          : f.forecast[i];
      } else {
        // hold the actual-driven seed value on actual months
        f.forecast[i] = ORIG_FORECAST[i];
      }
    }
    return { landed: landed, monthlySpendM: monthlySpendM, scale: scale };
  }

  // Update the live Chart.js instance (forward months only) ------------------
  function updateChart(attempts) {
    attempts = (typeof attempts === 'number') ? attempts : 0;
    if (attempts > 12) return; // chart never appeared — give up quietly
    var charts = (typeof _charts !== 'undefined') ? _charts : null;
    var c = charts ? charts['c-forecast'] : null;
    if (!c || !c.data || !Array.isArray(c.data.datasets)) {
      // chart created in draw() at setTimeout(30) AFTER render — retry briefly
      setTimeout(function () { updateChart(attempts + 1); }, 40);
      return;
    }
    var f = fc();
    if (!f) return;
    var ds = null;
    for (var i = 0; i < c.data.datasets.length; i++) {
      if (/forecast/i.test(String(c.data.datasets[i].label || ''))) { ds = c.data.datasets[i]; break; }
    }
    if (!ds) return;
    ds.data = f.forecast.slice();
    try { c.update(); } catch (e) { /* chart mid-teardown — ignore */ }
  }

  // --- Accuracy over forward months -----------------------------------------
  // 100 − mean(|forecast − budget| / budget) * 100
  function forwardAccuracy() {
    var f = fc(); if (!f) return 0;
    var errs = [];
    for (var i = 0; i < f.forecast.length; i++) {
      if (isForward(f, i) && typeof f.budget[i] === 'number' && f.budget[i] !== 0) {
        errs.push(Math.abs(f.forecast[i] - f.budget[i]) / f.budget[i]);
      }
    }
    if (!errs.length) return 100;
    var mean = errs.reduce(function (a, b) { return a + b; }, 0) / errs.length;
    return 100 - mean * 100;
  }

  function fyTotal() {
    var f = fc(); if (!f) return 0;
    var sum = 0;
    for (var i = 0; i < f.forecast.length; i++) {
      var v = isForward(f, i) ? f.forecast[i] : f.actual[i];
      if (typeof v === 'number' && isFinite(v)) sum += v;
    }
    return sum;
  }

  function baseFyTotal() {
    var f = fc(); if (!f) return 0;
    var sum = 0;
    for (var i = 0; i < ORIG_FORECAST.length; i++) {
      var v = isForward(f, i) ? ORIG_FORECAST[i] : f.actual[i];
      if (typeof v === 'number' && isFinite(v)) sum += v;
    }
    return sum;
  }

  // =====================================================================
  // CARD A — Driver-Based Forecast (editable)
  // =====================================================================
  var DRIVERS = [
    { key: 'nyPx',   label: 'ICE NY (USD/t)',  step: '1',     dp: 0 },
    { key: 'ldnPx',  label: 'ICE LDN (GBP/t)', step: '1',     dp: 0 },
    { key: 'eurusd', label: 'EUR/USD',         step: '0.001', dp: 3 },
    { key: 'civDiff',label: 'CIV diff ($/t)',  step: '1',     dp: 0 },
    { key: 'sustain',label: 'Sustainability ($/t)', step: '1', dp: 0 },
    { key: 'volume', label: 'Monthly vol (MT)',step: '10',    dp: 0 },
  ];

  function driverInputs() {
    return DRIVERS.map(function (d) {
      var val = STATE[d.key];
      var shown = (d.dp > 0) ? val.toFixed(d.dp) : Math.round(val);
      return '' +
        '<div class="fc-input-row">' +
          '<label class="fc-input-label" for="fc-in-' + d.key + '">' + d.label + '</label>' +
          '<input class="fc-input mono" id="fc-in-' + d.key + '" type="number" ' +
            'step="' + d.step + '" value="' + shown + '" data-fckey="' + d.key + '" ' +
            'oninput="window.__fcSuite.recompute()" />' +
        '</div>';
    }).join('');
  }

  function readoutHtml() {
    var total = fyTotal();
    var base = baseFyTotal();
    var delta = total - base;
    var dCls = delta > 0 ? 'neg' : (delta < 0 ? 'pos' : 'muted'); // +spend adverse
    var acc = forwardAccuracy();
    var spendM = computeMonthlySpendM(STATE);
    var landed = computeLanded(STATE);
    return '' +
      '<div class="qstat-grid fc-readout">' +
        '<div class="qstat"><div class="qstat-label">Driver landed</div>' +
          '<div class="qstat-value mono">' + fmtEur(Math.round(landed)) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Implied monthly spend</div>' +
          '<div class="qstat-value mono">' + fmtM(spendM) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">FY spend total</div>' +
          '<div class="qstat-value mono">' + fmtM(total) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Δ vs base</div>' +
          '<div class="qstat-value mono ' + dCls + '">' + (delta >= 0 ? '+' : '−') +
            fmtM(Math.abs(delta)).replace(/^−/, '') + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Recomputed accuracy</div>' +
          '<div class="qstat-value mono">' + fmtPct(acc) + '</div></div>' +
      '</div>';
  }

  function cardA() {
    return '' +
      '<div class="card fc-card" id="fc-driver">' +
        '<div class="card-head">' +
          '<div class="card-title">Driver-Based Forecast (editable)</div>' +
          '<div class="card-sub">Edit a driver to re-scale the forward forecast curve live · ' +
            'forward months preserve shape (scaled to driver-implied monthly spend); actual months held</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="fc-inputs">' + driverInputs() + '</div>' +
          '<div id="fc-readout">' + readoutHtml() + '</div>' +
          '<div class="card-actions fc-actions">' +
            '<button class="btn btn-ghost btn-sm" data-action="fc-reset-base">↺ Reset to base</button>' +
          '</div>' +
          '<div class="card-sub fc-foot">landed = €8,142 + (NY−7842)·0.9 + (LDN−5418)·0.15 + ' +
            '(CIVdiff−240) + (Sustain−96) + (EURUSD−1.085)·(−2,800); monthly spend = landed·volume.</div>' +
        '</div>' +
      '</div>';
  }

  // recompute() — called from input oninput + Reset; exposed on window.__fcSuite
  function recompute() {
    // 1. read inputs from the DOM (if present), else keep STATE
    DRIVERS.forEach(function (d) {
      var el = document.getElementById('fc-in-' + d.key);
      if (el) {
        var v = parseFloat(el.value);
        if (isFinite(v)) STATE[d.key] = v;
      }
    });
    saveState();
    // 2. rebuild forward forecast series + push to live chart
    rebuildForecast();
    updateChart(0);
    // 3. refresh the readout + bridge (which both depend on the new curve)
    var ro = document.getElementById('fc-readout');
    if (ro) ro.innerHTML = readoutHtml();
    var br = document.getElementById('fc-bridge-body');
    if (br) br.innerHTML = bridgeBody();
  }

  function resetToBase() {
    var b = baseline();
    STATE.nyPx = b.nyPx; STATE.ldnPx = b.ldnPx; STATE.eurusd = b.eurusd;
    STATE.civDiff = b.civDiff; STATE.sustain = b.sustain; STATE.volume = b.volume;
    saveState();
    // restore the seed forecast curve exactly
    var f = fc();
    if (f) { for (var i = 0; i < ORIG_FORECAST.length; i++) f.forecast[i] = ORIG_FORECAST[i]; }
    // reflect into inputs
    DRIVERS.forEach(function (d) {
      var el = document.getElementById('fc-in-' + d.key);
      if (el) el.value = (d.dp > 0) ? STATE[d.key].toFixed(d.dp) : Math.round(STATE[d.key]);
    });
    updateChart(0);
    var ro = document.getElementById('fc-readout');
    if (ro) ro.innerHTML = readoutHtml();
    var br = document.getElementById('fc-bridge-body');
    if (br) br.innerHTML = bridgeBody();
    if (typeof toast === 'function') {
      toast({ type: 'info', title: 'Drivers reset', body: 'Forecast restored to baseline assumptions.' });
    }
  }

  // =====================================================================
  // CARD B — Budget vs Actual / Forecast Bridge
  // =====================================================================
  function bridgeFigures() {
    var f = fc();
    var budgetTotal = 0, fcstTotal = 0;
    if (f) {
      for (var i = 0; i < f.budget.length; i++) {
        if (typeof f.budget[i] === 'number') budgetTotal += f.budget[i];
        var v = isForward(f, i) ? f.forecast[i] : f.actual[i];
        if (typeof v === 'number' && isFinite(v)) fcstTotal += v;
      }
    }
    var delta = fcstTotal - budgetTotal; // + => adverse (over budget)
    var legs = [
      { name: 'Price',       val: delta * LEG_PRICE },
      { name: 'Volume',      val: delta * LEG_VOLUME },
      { name: 'FX',          val: delta * LEG_FX },
      { name: 'Mix·Timing',  val: delta * LEG_MIX },
    ];
    return { budgetTotal: budgetTotal, fcstTotal: fcstTotal, delta: delta, legs: legs };
  }

  function bridgeWaterfallHtml(fig) {
    // base = Budget total, then +/- each leg, ending at Actual/Fcst total.
    // add = +spend (adverse, red); sub = −spend (favorable, green).
    var steps = [{ label: 'Budget', value: fig.budgetTotal, type: 'base' }];
    fig.legs.forEach(function (leg) {
      steps.push({
        label: (leg.val >= 0 ? '+' : '−') + leg.name,
        value: leg.val,
        type: leg.val >= 0 ? 'add' : 'sub',
      });
    });
    steps.push({ label: 'Actual/Fcst', value: fig.fcstTotal, type: 'total' });
    if (typeof renderWaterfall === 'function') return renderWaterfall(steps, null);
    return ''; // graceful no-op if helper missing
  }

  function legTableHtml(fig) {
    var threshold = Math.abs(fig.budgetTotal) * MATERIALITY_PCT;
    var rows = fig.legs.map(function (leg) {
      var material = Math.abs(leg.val) >= threshold;
      var cls = leg.val > 0 ? 'neg' : (leg.val < 0 ? 'pos' : 'muted');
      var pctOfBud = fig.budgetTotal ? (leg.val / fig.budgetTotal) * 100 : 0;
      var badge = material
        ? '<span class="badge badge-warn">MATERIAL — commentary required</span>'
        : '<span class="badge badge-muted">immaterial</span>';
      return '<tr>' +
        '<td class="cell-strong">' + leg.name + '</td>' +
        '<td class="num mono ' + cls + '">' + fmtM(leg.val) + '</td>' +
        '<td class="num mono ' + cls + '">' + fmtSignedPct(pctOfBud) + '</td>' +
        '<td>' + badge + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Leg</th><th class="th-num">Δ €M</th>' +
      '<th class="th-num">% of budget</th><th>Materiality</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // The portion of CARD B that depends on the (mutable) forecast — refreshed on recompute.
  function bridgeBody() {
    var fig = bridgeFigures();
    var dCls = fig.delta > 0 ? 'neg' : (fig.delta < 0 ? 'pos' : 'muted');
    var dir = fig.delta > 0 ? 'adverse' : (fig.delta < 0 ? 'favorable' : 'on budget');
    return '' +
      '<div class="fc-bridge-wrap">' + bridgeWaterfallHtml(fig) + '</div>' +
      '<div class="qstat-grid fc-bridge-stats">' +
        '<div class="qstat"><div class="qstat-label">Budget total</div>' +
          '<div class="qstat-value mono">' + fmtM(fig.budgetTotal) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Actual + Forecast</div>' +
          '<div class="qstat-value mono">' + fmtM(fig.fcstTotal) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Bridge Δ</div>' +
          '<div class="qstat-value mono ' + dCls + '">' + fmtM(fig.delta) + ' ' + dir + '</div></div>' +
      '</div>' +
      legTableHtml(fig);
  }

  function cardB() {
    return '' +
      '<div class="card fc-card" id="fc-bridge">' +
        '<div class="card-head">' +
          '<div class="card-title">Budget vs Actual / Forecast Bridge</div>' +
          '<div class="card-sub">Bridges budget → actual+forecast · delta allocated ' +
            'Price 55% / Volume 20% / FX 15% / Mix·Timing 10% · legs ≥ ±3% of budget flag MATERIAL · ' +
            'adverse (over-spend) red, favorable green</div>' +
        '</div>' +
        '<div class="card-body" id="fc-bridge-body">' + bridgeBody() + '</div>' +
      '</div>';
  }

  // =====================================================================
  // CARD C — Standard-Cost Roll-Forward (FY26 → FY27)
  // =====================================================================
  // Component split of €7,975 (sums EXACTLY); proposed ≈ €8,140 landed level.
  var STD_COMPONENTS = [
    { name: 'Base bean',            cur: 6850, market: 7000, prop: 6995 },
    { name: 'Origin differential',  cur: 540,  market: 575,  prop: 568  },
    { name: 'Sustainability / cert',cur: 205,  market: 220,  prop: 214  },
    { name: 'Freight',              cur: 175,  market: 188,  prop: 184  },
    { name: 'FX',                   cur: 95,   market: 70,   prop: 78   },
    { name: 'Conversion',           cur: 110,  market: 104,  prop: 101  },
  ];
  // cur sum = 6850+540+205+175+95+110 = 7,975 (== CURRENT_STD)
  // prop sum = 6995+568+214+184+78+101 = 8,140 (== PROPOSED_TARGET)

  function inventoryMt() {
    var inv = (typeof DATA !== 'undefined' && Array.isArray(DATA.inventory)) ? DATA.inventory : [];
    return inv.reduce(function (a, r) {
      return a + (typeof r.mt === 'number' && isFinite(r.mt) ? r.mt : 0);
    }, 0);
  }

  function stdRollHtml() {
    var sumCur = 0, sumMkt = 0, sumProp = 0;
    var body = STD_COMPONENTS.map(function (c) {
      sumCur += c.cur; sumMkt += c.market; sumProp += c.prop;
      var d = c.prop - c.cur;
      var dCls = d > 0 ? 'neg' : (d < 0 ? 'pos' : 'muted'); // +€/t adverse
      return '<tr>' +
        '<td class="cell-strong">' + c.name + '</td>' +
        '<td class="num mono">' + fmtEur(c.cur) + '</td>' +
        '<td class="num mono">' + fmtEur(c.market) + '</td>' +
        '<td class="num mono">' + fmtEur(c.prop) + '</td>' +
        '<td class="num mono ' + dCls + '">' + fmtSigned(d) + '</td>' +
        '</tr>';
    }).join('');

    var dTot = sumProp - sumCur;
    var dTotCls = dTot > 0 ? 'neg' : (dTot < 0 ? 'pos' : 'muted');
    var foot = '<tr class="fc-roll-total">' +
      '<td class="cell-strong">Total std (€/t)</td>' +
      '<td class="num mono">' + fmtEur(sumCur) + '</td>' +
      '<td class="num mono">' + fmtEur(sumMkt) + '</td>' +
      '<td class="num mono">' + fmtEur(sumProp) + '</td>' +
      '<td class="num mono ' + dTotCls + '">' + fmtSigned(dTot) + '</td>' +
      '</tr>';

    // Inventory revaluation impact: (proposed − current) × Σ inventory mt
    var totMt = inventoryMt();
    var revalEur = (sumProp - CURRENT_STD) * totMt; // raw euros
    // A higher std raises carrying value (favorable book gain) → pos; lower → adverse.
    var revalCls = revalEur > 0 ? 'pos' : (revalEur < 0 ? 'neg' : 'muted');

    return '' +
      '<div class="table-wrap"><table class="table fc-roll">' +
        '<thead><tr>' +
          '<th>Component</th>' +
          '<th class="th-num">Current (€/t)</th>' +
          '<th class="th-num">Market-implied (€/t)</th>' +
          '<th class="th-num">Proposed FY27 (€/t)</th>' +
          '<th class="th-num">Δ (€/t)</th>' +
        '</tr></thead>' +
        '<tbody>' + body + foot + '</tbody>' +
      '</table></div>' +
      '<div class="fc-reval">' +
        '<span class="fc-reval-label">Inventory revaluation impact</span>' +
        '<span class="fc-reval-detail mono">(' + fmtEur(sumProp) + ' − ' + fmtEur(CURRENT_STD) +
          ') × ' + fmtInt(totMt) + ' MT =</span>' +
        '<span class="fc-reval-val mono ' + revalCls + '">' + fmtEurM(revalEur) + '</span>' +
      '</div>';
  }

  function cardC() {
    return '' +
      '<div class="card fc-card" id="fc-stdroll">' +
        '<div class="card-head">' +
          '<div class="card-title">Standard-Cost Roll-Forward (FY26 → FY27)</div>' +
          '<div class="card-sub">Rolls current €7,975/t to proposed €8,140/t by component · ' +
            'reval = (proposed − current std) × total on-hand MT</div>' +
        '</div>' +
        '<div class="card-body">' +
          stdRollHtml() +
          '<div class="card-sub fc-foot">Assumptions: component split sums to current std €7,975/t; ' +
            'market-implied levels reflect spot futures/diffs/FX; proposed FY27 set near the current ' +
            'landed level (~€8,140/t). Revaluation applies the std uplift to all on-hand inventory tonnage; ' +
            'a higher carrying std is a favorable book gain (green).</div>' +
        '</div>' +
      '</div>';
  }

  // =====================================================================
  // The appended section (three cards)
  // =====================================================================
  function suiteSection() {
    // Recompute the forward curve from the persisted STATE BEFORE rendering the
    // bridge/readout so the appended cards reflect the saved drivers. (Chart is
    // updated separately after draw() via updateChart.)
    rebuildForecast();
    return '' +
      '<div class="fc-suite-head section-title">Forecast Suite — drivers · bridge · standard cost</div>' +
      cardA() +
      '<div class="grid grid-2 fc-suite-grid">' + cardB() + cardC() + '</div>';
  }

  // --- Styles: token-driven, module-prefixed; reuse existing classes ---------
  function injectStyles() {
    if (document.getElementById('fc-styles')) return;
    var css =
      '.fc-suite-head{margin-top:26px;}' +
      '.fc-inputs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 14px;margin-bottom:16px;}' +
      '.fc-input-row{display:flex;flex-direction:column;gap:4px;}' +
      '.fc-input-label{font-size:11px;color:var(--text-2);font-family:var(--sans);}' +
      '.fc-input{background:var(--bg-3);border:1px solid var(--line-2);border-radius:6px;' +
        'color:var(--text-0);font-family:var(--mono);font-size:13px;padding:7px 9px;width:100%;}' +
      '.fc-input:focus{outline:none;border-color:var(--accent);}' +
      '.fc-readout{margin-bottom:6px;}' +
      '.fc-actions{margin-top:6px;}' +
      '.fc-foot{margin-top:12px;padding-top:10px;border-top:1px solid var(--line);' +
        'color:var(--text-2);font-size:11px;line-height:1.5;}' +
      '.fc-bridge-wrap{margin-bottom:16px;}' +
      '.fc-bridge-stats{margin-bottom:14px;}' +
      '.fc-roll-total td{border-top:1px solid var(--line-2);font-weight:600;}' +
      '.fc-reval{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:14px;' +
        'padding-top:12px;border-top:1px solid var(--line);}' +
      '.fc-reval-label{font-family:var(--sans);font-size:12px;color:var(--text-1);font-weight:600;}' +
      '.fc-reval-detail{font-size:11px;color:var(--text-2);}' +
      '.fc-reval-val{font-size:15px;font-weight:600;margin-left:auto;}' +
      '@media (max-width:920px){.fc-inputs{grid-template-columns:1fr 1fr;}' +
        '.fc-reval-val{margin-left:0;}}';
    var style = document.createElement('style');
    style.id = 'fc-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Compose-wrap VIEWS.forecast.render (pattern A) ------------------------
  function wrapForecastRender() {
    // VIEWS is a top-level const in app.js — reference bare (guarded), never window.VIEWS.
    if (typeof VIEWS === 'undefined' || !VIEWS.forecast ||
        typeof VIEWS.forecast.render !== 'function') return false;
    if (VIEWS.forecast.render.__fcWrapped) return true;
    var prior = VIEWS.forecast.render; // may already be wrapped — fine
    var wrapped = function () {
      var out = prior(); // keep ALL prior Forecast & Planning output
      try {
        return out + suiteSection();
      } catch (err) {
        return out; // fail soft so the base view still renders
      }
    };
    wrapped.__fcWrapped = true;
    VIEWS.forecast.render = wrapped;
    return true;
  }

  // --- Public API ------------------------------------------------------------
  window.__fcSuite = { recompute: recompute };

  // --- Install ---------------------------------------------------------------
  injectStyles();

  // Bridge "Reset to base" through the app's action dispatcher (ACTIONS is a live map).
  if (typeof ACTIONS !== 'undefined') {
    ACTIONS['fc-reset-base'] = function () { resetToBase(); };
  }

  if (wrapForecastRender()) {
    // If already on the forecast view, repaint (calling switchView is allowed),
    // then sync the live chart to the persisted drivers after draw() runs.
    if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'forecast' &&
        typeof switchView === 'function') {
      switchView('forecast');
      updateChart(0);
    }
  }
})();
