/* ============================================================================
   CACAO/FP — ENHANCEMENT #3: enh-press-economics.js
   Bean → product grind / press economics for the Inventory Valuation view.
   Self-installing IIFE. Loaded AFTER app.js / views2.js / actions.js and after
   the first-wave patches. Compose-wraps VIEWS.inventory.render (may already be
   wrapped by other modules) and APPENDS one "Processing / Grind Economics" card
   — all prior output is preserved. Reuses existing globals/helpers and CSS
   tokens only. Never reassigns switchView; calling it is fine. Idempotent;
   zero console errors. ENH_CONTRACT / ENH_CONTRACT2 pattern A.

   --- The cocoa press (documented standard yields / assumptions) -------------
   1 MT beans  ──grind──>  liquor      @ 0.80 yield from beans
   liquor      ──press──>  butter      @ 0.47 yield from liquor
   liquor      ──press──>  powder      @ 0.45 yield from liquor
   liquor      ──press──>  cake        @ 0.08 yield (by-product credit)
   Butter ACTUAL yield = std 0.47 − 1.4pts = 0.456 (the known yield miss that
   drags realized butter cost above standard — ties to DATA.ppvDetail BT-DE-01).

   --- Hard anchors from DATA.ppvDetail ---------------------------------------
   BT-DE-01  std €14,850/t · act €15,240/t · mt 540  (butter)
   CK-DE-01  std €3,180/t  · mt 280                  (cake by-product)
   BN-CIV-STD std €7,975 + BN-GHA-STD std €8,050  →  bean cost in ≈ €8,000/t
   Yield variance impact (BT-DE-01) = (actEur − stdEur) × mt
                                    = (15,240 − 14,850) × 540 ≈ €211k adverse.

   Color convention (matches app): cost ABOVE standard = adverse = .neg/red;
   BELOW standard = favorable = .pos/green.
   ========================================================================== */
(function installPressEconomics() {
  'use strict';

  // --- Idempotency guard (double-install safe) -----------------------------
  if (window.__cacaoPressEconInstalled) return;
  window.__cacaoPressEconInstalled = true;

  // --- Standard yield assumptions (documented above) -----------------------
  var YIELD_LIQUOR = 0.80;   // beans  -> liquor
  var YIELD_BUTTER = 0.47;   // liquor -> butter
  var YIELD_POWDER = 0.45;   // liquor -> powder
  var YIELD_CAKE   = 0.08;   // liquor -> cake (by-product credit)
  var BUTTER_YIELD_MISS_PTS = 1.4; // butter actual = std − 1.4 percentage points

  // Conversion (grind + press) cost added per tonne of beans processed.
  var CONVERSION_COST_PER_T = 760; // €/t — synthetic standard conversion charge

  // --- Lookup helpers against DATA.ppvDetail (bare global, guarded) ---------
  function ppvRow(sku) {
    var list = (typeof DATA !== 'undefined' && DATA.ppvDetail) ? DATA.ppvDetail : [];
    for (var i = 0; i < list.length; i++) { if (list[i].sku === sku) return list[i]; }
    return null;
  }

  // Bean cost in (€/t): average of the std bean SKUs in ppvDetail, ~€8,000.
  function beanCostIn() {
    var list = (typeof DATA !== 'undefined' && DATA.ppvDetail) ? DATA.ppvDetail : [];
    var beans = list.filter(function (r) { return /^BN-/.test(r.sku); });
    if (!beans.length) return 8000;
    var sum = beans.reduce(function (s, r) { return s + r.stdEur; }, 0);
    return Math.round(sum / beans.length); // ≈ €8,013 → presented as bean cost in
  }

  // --- Model the press economics -------------------------------------------
  function model() {
    var bt = ppvRow('BT-DE-01');
    var ck = ppvRow('CK-DE-01');
    var butterStd = bt ? bt.stdEur : 14850;
    var butterAct = bt ? bt.actEur : 15240;
    var butterMt  = bt ? bt.mt : 540;
    var cakeStd   = ck ? ck.stdEur : 3180;
    var cakeMt    = ck ? ck.mt : 280;

    var beanIn = beanCostIn();

    // Stage yields. Butter actual reflects the −1.4pt miss.
    var butterActYield = YIELD_BUTTER - (BUTTER_YIELD_MISS_PTS / 100);
    var stages = [
      { stage: 'Beans → Liquor',  std: YIELD_LIQUOR, act: YIELD_LIQUOR,     note: 'grind' },
      { stage: 'Liquor → Butter', std: YIELD_BUTTER, act: butterActYield,   note: 'press · −1.4pt miss' },
      { stage: 'Liquor → Powder', std: YIELD_POWDER, act: YIELD_POWDER,     note: 'press' },
      { stage: 'Cake credit',     std: YIELD_CAKE,   act: YIELD_CAKE,       note: 'by-product' },
    ];

    // Cake by-product credit per tonne of beans processed:
    //   beans -> liquor (0.80) -> cake (0.08 of liquor) at cake std value.
    var cakeCreditPerT = Math.round(beanIn * 0 + cakeStd * YIELD_LIQUOR * YIELD_CAKE);

    // Combined product cost build (€ per MT of beans processed):
    //   bean cost in  +  conversion cost  −  cake by-product credit
    var combinedActual = beanIn + CONVERSION_COST_PER_T - cakeCreditPerT;
    // Standard combined cost uses the same charge but the std butter yield
    // realizes more sellable butter per tonne, so the realized (actual) yield
    // miss pushes the realized cost above standard. Standard reference =
    // std bean cost path without the yield drag.
    var yieldDragPerT = Math.round(beanIn * (YIELD_BUTTER - butterActYield));
    var combinedStandard = combinedActual - yieldDragPerT;

    // Yield variance impact € for BT-DE-01 (the headline adverse).
    var yieldVarImpact = (butterAct - butterStd) * butterMt; // ≈ €211k

    // Total cake by-product credit € (cake std value × cake tonnes).
    var cakeCreditTotal = cakeStd * cakeMt;

    return {
      beanIn: beanIn,
      stages: stages,
      cakeCreditPerT: cakeCreditPerT,
      conversion: CONVERSION_COST_PER_T,
      combinedActual: combinedActual,
      combinedStandard: combinedStandard,
      yieldDragPerT: yieldDragPerT,
      butterStd: butterStd,
      butterAct: butterAct,
      butterMt: butterMt,
      yieldVarImpact: yieldVarImpact,
      cakeStd: cakeStd,
      cakeMt: cakeMt,
      cakeCreditTotal: cakeCreditTotal,
    };
  }

  // --- Headline qstat-grid (reuse .qstat-grid / .qstat) --------------------
  function headlineHtml(m) {
    var yvCls = m.yieldVarImpact > 0 ? 'neg' : (m.yieldVarImpact < 0 ? 'pos' : 'muted');
    return '<div class="qstat-grid pe-headline">' +
      '<div class="qstat"><div class="qstat-label">Bean Cost In</div>' +
        '<div class="qstat-value mono">' + fmtEur(m.beanIn) + '<span class="pe-unit"> /t</span></div></div>' +
      '<div class="qstat"><div class="qstat-label">Butter Std vs Act</div>' +
        '<div class="qstat-value mono">' + fmtEur(m.butterStd) +
        ' <span class="neg">→ ' + fmtEur(m.butterAct) + '</span></div></div>' +
      '<div class="qstat"><div class="qstat-label">Yield Variance Impact</div>' +
        '<div class="qstat-value mono ' + yvCls + '">' + fmtEurM(m.yieldVarImpact) +
        '<span class="pe-unit"> BT-DE-01</span></div></div>' +
      '<div class="qstat"><div class="qstat-label">Cake By-Product Credit</div>' +
        '<div class="qstat-value mono pos">' + fmtEurM(m.cakeCreditTotal) + '</div></div>' +
      '</div>';
  }

  // --- Standard-vs-actual yield table --------------------------------------
  function yieldTableHtml(m) {
    var body = m.stages.map(function (s) {
      var delta = s.act - s.std; // percentage-point delta
      var dCls = delta < -0.0001 ? 'neg' : (delta > 0.0001 ? 'pos' : 'muted');
      var dTxt = delta === 0
        ? '—'
        : fmtSignedPct(delta * 100, 1) + 'pt';
      return '<tr>' +
        '<td class="cell-strong">' + s.stage + '</td>' +
        '<td class="num mono">' + fmtPct(s.std * 100, 1) + '</td>' +
        '<td class="num mono">' + fmtPct(s.act * 100, 1) + '</td>' +
        '<td class="num mono ' + dCls + '">' + dTxt + '</td>' +
        '<td><span class="pe-note">' + s.note + '</span></td>' +
        '</tr>';
    }).join('');

    return '<div class="table-wrap"><table class="table pe-table">' +
      '<thead><tr>' +
        '<th>Stage</th>' +
        '<th class="th-num">Std Yield</th>' +
        '<th class="th-num">Act Yield</th>' +
        '<th class="th-num">Δ</th>' +
        '<th>Note</th>' +
      '</tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table></div>';
  }

  // --- Product cost build (reuse renderWaterfall: base/add/sub/total) ------
  // add => red (raises cost), sub => green (lowers cost). Reuses app.js global.
  function costBuildHtml(m) {
    var steps = [
      { label: 'Bean Cost',    value: m.beanIn,           type: 'base'  },
      { label: '+Conversion',  value: m.conversion,       type: 'add'   },
      { label: '−Cake Credit', value: -m.cakeCreditPerT,  type: 'sub'   },
      { label: 'Product Cost', value: m.combinedActual,   type: 'total' },
    ];
    if (typeof renderWaterfall === 'function') {
      return renderWaterfall(steps, null);
    }
    return ''; // graceful no-op if the helper is unavailable
  }

  // --- Cost vs standard comparison strip -----------------------------------
  function costCompareHtml(m) {
    var aboveStd = m.combinedActual > m.combinedStandard;
    var diff = m.combinedActual - m.combinedStandard;
    var diffCls = aboveStd ? 'neg' : (diff < 0 ? 'pos' : 'muted');
    return '<div class="kv-list pe-compare">' +
      '<div class="kv"><span class="kv-k">Standard product cost</span>' +
        '<span class="kv-v mono">' + fmtEur(m.combinedStandard) + ' /t</span></div>' +
      '<div class="kv"><span class="kv-k">Realized product cost</span>' +
        '<span class="kv-v mono ' + (aboveStd ? 'neg' : 'pos') + '">' + fmtEur(m.combinedActual) + ' /t</span></div>' +
      '<div class="kv"><span class="kv-k">Yield drag vs standard</span>' +
        '<span class="kv-v mono ' + diffCls + '">' + fmtSigned(diff) + ' /t' +
        (aboveStd ? ' <span class="badge badge-neg pe-flag">YIELD MISS</span>' : '') + '</span></div>' +
      '</div>';
  }

  // --- The appended card ----------------------------------------------------
  function pressEconomicsCard() {
    var m = model();
    return '<div class="card pe-card" id="pe-grind-economics">' +
      '<div class="card-head">' +
        '<div class="card-title">Processing / Grind Economics</div>' +
        '<div class="card-sub">1 MT beans → liquor → butter + powder (+ cake by-product) · ' +
          'realized butter yield miss drags product cost above standard</div>' +
      '</div>' +
      '<div class="card-body">' +
        headlineHtml(m) +
        '<div class="grid grid-2 pe-grid">' +
          '<div>' +
            '<div class="section-title">Standard vs Actual Yield</div>' +
            yieldTableHtml(m) +
          '</div>' +
          '<div>' +
            '<div class="section-title">Product Cost Build (€/t beans)</div>' +
            '<div class="pe-bridge">' + costBuildHtml(m) + '</div>' +
            costCompareHtml(m) +
          '</div>' +
        '</div>' +
        '<div class="card-sub pe-foot">Standard yield assumptions: beans→liquor ' +
          fmtPct(YIELD_LIQUOR * 100, 0) + ', liquor→butter ' + fmtPct(YIELD_BUTTER * 100, 0) +
          ', liquor→powder ' + fmtPct(YIELD_POWDER * 100, 0) + ', cake by-product ' +
          fmtPct(YIELD_CAKE * 100, 0) + '. Butter actual yield = std − ' +
          BUTTER_YIELD_MISS_PTS + 'pts (the −1.4pt miss in DATA.ppvDetail BT-DE-01: std ' +
          fmtEur(m.butterStd) + '/t vs act ' + fmtEur(m.butterAct) + '/t). Conversion charge ' +
          fmtEur(m.conversion) + '/t; cake credited at std value. Yield variance impact = ' +
          '(act − std) × MT.</div>' +
      '</div>' +
    '</div>';
  }

  // --- Styles: token-driven, module-prefixed (pe-*); reuse existing classes -
  function injectStyles() {
    if (document.getElementById('pe-styles')) return;
    var css =
      '.pe-headline{margin-bottom:16px;}' +
      '.pe-unit{color:var(--text-2);font-size:11px;font-weight:400;}' +
      '.pe-grid{align-items:start;}' +
      '.pe-bridge{margin-bottom:14px;}' +
      '.pe-note{color:var(--text-2);font-size:11px;}' +
      '.pe-table td,.pe-table th{vertical-align:middle;}' +
      '.pe-compare{margin-top:4px;}' +
      '.pe-flag{margin-left:8px;}' +
      '.pe-foot{margin-top:14px;padding-top:10px;border-top:1px solid var(--line);' +
        'color:var(--text-2);font-size:11px;line-height:1.55;}';
    var style = document.createElement('style');
    style.id = 'pe-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Compose-wrap VIEWS.inventory.render (pattern A) ----------------------
  function wrapInventoryRender() {
    // VIEWS is a top-level `const` in app.js — NOT a window property. Reference
    // the bare global (guarded via typeof); never window.VIEWS.
    if (typeof VIEWS === 'undefined' || !VIEWS.inventory ||
        typeof VIEWS.inventory.render !== 'function') return false;
    if (VIEWS.inventory.render.__peWrapped) return true; // already composed by us
    var prior = VIEWS.inventory.render; // may already be wrapped — fine
    var wrapped = function () {
      var out = prior(); // keep ALL prior output (base inventory view + any prior cards)
      try {
        return out + pressEconomicsCard();
      } catch (err) {
        // Never break the view; fail soft so prior cards still render.
        return out;
      }
    };
    wrapped.__peWrapped = true;
    VIEWS.inventory.render = wrapped;
    return true;
  }

  // --- Install --------------------------------------------------------------
  injectStyles();
  if (wrapInventoryRender()) {
    // Repaint if the user is already on the Inventory view (calling switchView is allowed).
    if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'inventory' &&
        typeof switchView === 'function') {
      switchView('inventory');
    }
  }
})();
