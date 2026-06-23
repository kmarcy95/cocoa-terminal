/* ============================================================================
   CACAO/FP — enh-forecast-result.js
   Make "Run Forecast" (and "Run Scenarios") produce a VISUAL result instead of
   a toast: an inline detail page (uses the openDetail in-canvas pattern) with
   Chart.js graphics of the generated forecast — projected monthly spend vs
   budget vs actual, plus a scenario landed-cost / P&L chart.

   Self-installing. Overrides ACTIONS['confirm-run-forecast'] + ['run-scenarios']
   (the dispatcher reads ACTIONS per click). Reads the Run Forecast modal inputs
   by id (rf-ny / rf-ldn / rf-fx / rf-civ / rf-vol / rf-version). Bare lexical
   globals only (DATA/ACTIONS/_charts via typeof guards); never window.*.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__enhForecastResultInstalled) return;
  window.__enhForecastResultInstalled = true;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function numVal(id, fallback) {
    var el = document.getElementById(id);
    var n = el ? parseFloat(el.value) : NaN;
    return isNaN(n) ? fallback : n;
  }

  function baseline() {
    return (typeof DATA !== 'undefined' && DATA.whatIf && DATA.whatIf.baseline) ||
      { nyPx: 7842, ldnPx: 5418, eurusd: 1.085, civDiff: 240, volume: 6400, stdCost: 7975 };
  }

  /* Build a generated forecast from the modal drivers (same family as the
     What-If / driver-forecast formula). */
  function generate() {
    var b = baseline();
    var ny = numVal('rf-ny', b.nyPx);
    var ldn = numVal('rf-ldn', b.ldnPx);
    var fx = numVal('rf-fx', b.eurusd);
    var civ = numVal('rf-civ', b.civDiff);
    var vol = numVal('rf-vol', b.volume);
    var vEl = document.getElementById('rf-version');
    var version = vEl ? vEl.value : 'New rolling version';

    var landed = 8142 + (ny - b.nyPx) * 0.9 + (ldn - b.ldnPx) * 0.15 + (civ - b.civDiff) + (fx - b.eurusd) * (-2800);
    var monthlyM = landed * vol / 1e6;

    var fc = (typeof DATA !== 'undefined' && DATA.forecast) || { labels: [], actual: [], forecast: [], budget: [] };
    var labels = (fc.labels || []).slice();
    // seasonal shape from the seed forecast curve; scale forward months to the driver-implied level
    var seedFirstFwd = null;
    for (var i = 0; i < (fc.forecast || []).length; i++) {
      if (fc.actual[i] == null) { seedFirstFwd = fc.forecast[i]; break; }
    }
    var scale = (seedFirstFwd && seedFirstFwd !== 0) ? (monthlyM / seedFirstFwd) : 1;
    var generated = (fc.forecast || []).map(function (x, i) {
      return fc.actual[i] != null ? null : Math.round(x * scale * 10) / 10;
    });
    var actuals = (fc.actual || []).slice();
    var budget = (fc.budget || []).slice();
    var fySpend = generated.reduce(function (a, x) { return a + (x || 0); }, 0) +
                  actuals.reduce(function (a, x) { return a + (x || 0); }, 0);
    var fyBudget = budget.reduce(function (a, x) { return a + (x || 0); }, 0);
    return { ny: ny, ldn: ldn, fx: fx, civ: civ, vol: vol, version: version,
      landed: landed, monthlyM: monthlyM, labels: labels, generated: generated,
      actuals: actuals, budget: budget, fySpend: fySpend, fyBudget: fyBudget };
  }

  function qstat(label, value, cls) {
    return '<div class="qstat"><div class="qstat-label">' + esc(label) + '</div>' +
      '<div class="qstat-value ' + (cls || '') + ' mono">' + value + '</div></div>';
  }

  function showForecast() {
    var g = generate();
    var b = baseline();
    var stdCost = b.stdCost || 7975;
    var ppvM = (g.landed - stdCost) * g.vol / 1e6;
    var vsB = g.fySpend - g.fyBudget;
    var signM = function (x) { return (x >= 0 ? '+' : '−') + '€' + Math.abs(x).toFixed(x >= 100 ? 0 : 2) + 'M'; };

    var body =
      '<div class="qstat-grid">' +
        qstat('Generated landed cost', '€' + Math.round(g.landed).toLocaleString() + '/t', g.landed > stdCost ? 'neg' : 'pos') +
        qstat('FY spend (generated)', '€' + g.fySpend.toFixed(1) + 'M', '') +
        qstat('vs Budget', signM(vsB), vsB > 0 ? 'neg' : 'pos') +
        qstat('PPV vs standard', signM(ppvM), ppvM > 0 ? 'neg' : 'pos') +
      '</div>' +
      '<div class="section-title">Projected monthly spend — actual · generated forecast · budget (€M)</div>' +
      '<div class="chart-wrap" style="height:300px"><canvas id="c-fcresult"></canvas></div>' +
      '<div class="section-title">Scenario landed cost &amp; P&amp;L impact</div>' +
      '<div class="chart-wrap" style="height:260px"><canvas id="c-fcscen"></canvas></div>' +
      '<div class="form-help">Drivers — NY ' + esc(g.ny) + ' USD/t · LDN ' + esc(g.ldn) + ' GBP/t · EUR/USD ' + esc(g.fx) +
        ' · CIV diff $' + esc(g.civ) + '/t · ' + esc(g.vol) + ' MT/mo · ' + esc(g.version) + '</div>';

    if (typeof openDetail === 'function') {
      openDetail({ title: 'Generated Forecast', sub: 'Rolling forecast result · ' + new Date().toLocaleDateString(), body: body });
    }
    setTimeout(function () { drawForecastCharts(g); }, 40);
    if (typeof toast === 'function') {
      toast({ type: 'success', title: 'Forecast generated', body: 'FY €' + g.fySpend.toFixed(1) + 'M · landed €' + Math.round(g.landed) + '/t' });
    }
  }

  function drawForecastCharts(g) {
    if (typeof mkChart !== 'function' || typeof Chart === 'undefined') return;
    try {
      var lineCfg = {
        type: 'bar',
        data: {
          labels: g.labels,
          datasets: [
            { label: 'Actual', type: 'bar', data: g.actuals, backgroundColor: '#c9a96e', borderRadius: 3, order: 3 },
            { label: 'Generated forecast', type: 'line', data: g.generated, borderColor: '#4aa3ff', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 4], tension: 0.3, spanGaps: true, pointRadius: 2, order: 1 },
            { label: 'Budget', type: 'line', data: g.budget, borderColor: '#7a8597', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 0, order: 2 }
          ]
        },
        options: (typeof lineOpts === 'function') ? lineOpts() : { responsive: true, maintainAspectRatio: false }
      };
      mkChart('c-fcresult', lineCfg);

      var sc = (typeof DATA !== 'undefined' && DATA.scenarios) || [];
      var scCfg = {
        type: 'bar',
        data: {
          labels: sc.map(function (s) { return s.name + ' (' + s.prob + '%)'; }),
          datasets: [{
            label: 'Landed €/t',
            data: sc.map(function (s) { return Math.round(s.landed); }),
            backgroundColor: sc.map(function (s) { return s.name === 'Base' ? '#c9a96e' : (s.pnlM < 0 ? '#ff5466' : '#2dd4a4'); }),
            borderRadius: 4
          }]
        },
        options: (typeof barOpts === 'function') ? barOpts({ valuePrefix: '€', showLegend: false }) : { responsive: true, maintainAspectRatio: false }
      };
      mkChart('c-fcscen', scCfg);
    } catch (e) { /* never throw into the click loop */ }
  }

  /* run-scenarios → an inline scenario result with a P&L-by-scenario chart. */
  function showScenarios() {
    var sc = (typeof DATA !== 'undefined' && DATA.scenarios) || [];
    var ev = sc.reduce(function (a, s) { return a + (s.prob / 100) * s.pnlM; }, 0);
    var rows = sc.map(function (s) {
      var cls = s.pnlM < 0 ? 'neg' : (s.pnlM > 0 ? 'pos' : '');
      return '<tr><td class="cell-strong">' + esc(s.name) + '</td><td class="num mono">' + s.nyPx.toLocaleString() + '</td>' +
        '<td class="num mono">' + s.prob + '%</td>' +
        '<td class="num mono ' + cls + '">' + (s.pnlM >= 0 ? '+' : '−') + '€' + Math.abs(s.pnlM).toFixed(1) + 'M</td>' +
        '<td class="num mono">€' + Math.round(s.landed).toLocaleString() + '/t</td></tr>';
    }).join('');
    var body =
      '<div class="qstat-grid">' +
        qstat('Probability-weighted P&L', (ev >= 0 ? '+' : '−') + '€' + Math.abs(ev).toFixed(2) + 'M', ev < 0 ? 'neg' : 'pos') +
        qstat('Scenarios', String(sc.length), '') +
        qstat('Worst case (Tail)', '−€' + Math.abs(Math.min.apply(null, sc.map(function (s) { return s.pnlM; }))).toFixed(1) + 'M', 'neg') +
        qstat('Best case (Bear)', '+€' + Math.max.apply(null, sc.map(function (s) { return s.pnlM; })).toFixed(1) + 'M', 'pos') +
      '</div>' +
      '<div class="section-title">P&amp;L impact by scenario (€M)</div>' +
      '<div class="chart-wrap" style="height:280px"><canvas id="c-scenpnl"></canvas></div>' +
      '<div class="section-title">Scenario detail</div>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Scenario</th><th class="th-num">NY px</th><th class="th-num">Prob</th><th class="th-num">P&amp;L €M</th><th class="th-num">Landed</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    if (typeof openDetail === 'function') {
      openDetail({ title: 'Scenario Analysis', sub: '4-scenario P&L impact · probability-weighted', body: body });
    }
    setTimeout(function () {
      if (typeof mkChart !== 'function' || typeof Chart === 'undefined') return;
      try {
        mkChart('c-scenpnl', {
          type: 'bar',
          data: {
            labels: sc.map(function (s) { return s.name; }),
            datasets: [{ label: 'P&L €M', data: sc.map(function (s) { return s.pnlM; }),
              backgroundColor: sc.map(function (s) { return s.pnlM < 0 ? '#ff5466' : (s.pnlM > 0 ? '#2dd4a4' : '#c9a96e'); }), borderRadius: 4 }]
          },
          options: (typeof barOpts === 'function') ? barOpts({ valuePrefix: '€', valueSuffix: 'M', showLegend: false }) : { responsive: true, maintainAspectRatio: false }
        });
      } catch (e) { /* noop */ }
    }, 40);
    if (typeof toast === 'function') toast({ type: 'success', title: 'Scenarios run', body: 'Expected P&L ' + (ev >= 0 ? '+' : '−') + '€' + Math.abs(ev).toFixed(2) + 'M' });
  }

  function install() {
    if (typeof ACTIONS === 'undefined') return;
    // confirm-run-forecast: read the modal inputs (still open), render the visual
    // result inline, THEN close the modal to reveal it.
    ACTIONS['confirm-run-forecast'] = function () {
      showForecast();
      if (typeof closeModal === 'function') closeModal();
    };
    ACTIONS['run-scenarios'] = function () { showScenarios(); };
  }
  install();
})();
