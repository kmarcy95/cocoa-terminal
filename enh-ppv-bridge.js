/* ============================================================================
   CACAO/FP — ENHANCEMENT #1: enh-ppv-bridge.js
   Five-way PPV attribution: Price · Mix · Volume · Yield · FX.
   Self-installing IIFE. Loaded AFTER app.js / views2.js / actions.js and after
   the first-wave + commentary patches. Compose-wraps VIEWS.ppv.render (which is
   ALREADY wrapped by the commentary patch) and APPENDS one .card — prior output
   is preserved. Reuses existing globals/helpers and CSS tokens only. Never
   reassigns switchView; calling it is fine. Idempotent; zero console errors.
   ENH_CONTRACT2 pattern A.

   Attribution model (ties EXACTLY per SKU and in aggregate):
     totalVar = (actEur - stdEur) * mt
     fx       = fxImpact * mt
     base     = totalVar - fx
     processed = /^(LQ|BT|PW|CK)/ (grind products carry conversion yield)
     yieldShare = BT? 0.50 : processed? 0.15 : 0
     yield_   = round(base * yieldShare)
     rem      = base - yield_
     price    = round(rem * 0.70)
     mix      = round(rem * 0.18)
     volume   = rem - price - mix         // remainder => row sums EXACTLY
   Book totals = Σ of each component; waterfall ends at Σ totalVar (~+€1.02M adverse).
   Color convention (matches app): positive variance = adverse = .neg/red;
   negative = favorable = .pos/green.
   ========================================================================== */
(function installPpvBridge() {
  'use strict';

  // --- Idempotency guard (double-install safe) -----------------------------
  if (window.__cacaoPpvBridgeInstalled) return;
  window.__cacaoPpvBridgeInstalled = true;

  // --- Component split (70 / 18 / 12 residual; documented above) -----------
  var PRICE_SHARE = 0.70;
  var MIX_SHARE = 0.18; // volume is the remainder so each row ties exactly
  var BUTTER_YIELD_SHARE = 0.50;
  var PROCESSED_YIELD_SHARE = 0.15;
  var PROCESSED_RE = /^(LQ|BT|PW|CK)/;

  /**
   * Decompose one PPV detail row into the five attribution components.
   * @param {{sku:string,mt:number,stdEur:number,actEur:number,fxImpact:number}} p
   * @returns {{sku:string,totalVar:number,price:number,mix:number,volume:number,yield_:number,fx:number}}
   */
  function attribute(p) {
    var totalVar = (p.actEur - p.stdEur) * p.mt;
    var fx = p.fxImpact * p.mt;
    var base = totalVar - fx;
    var processed = PROCESSED_RE.test(p.sku);
    var yieldShare = p.sku.indexOf('BT') === 0
      ? BUTTER_YIELD_SHARE
      : (processed ? PROCESSED_YIELD_SHARE : 0);
    var yield_ = Math.round(base * yieldShare);
    var rem = base - yield_;
    var price = Math.round(rem * PRICE_SHARE);
    var mix = Math.round(rem * MIX_SHARE);
    var volume = rem - price - mix; // remainder => price+mix+volume+yield_+fx === totalVar
    return { sku: p.sku, totalVar: totalVar, price: price, mix: mix, volume: volume, yield_: yield_, fx: fx };
  }

  /** Per-SKU rows + book totals for each component. */
  function buildAttribution() {
    var rows = (DATA.ppvDetail || []).map(attribute);
    var totals = rows.reduce(function (acc, r) {
      acc.price += r.price;
      acc.mix += r.mix;
      acc.volume += r.volume;
      acc.yield_ += r.yield_;
      acc.fx += r.fx;
      acc.totalVar += r.totalVar;
      return acc;
    }, { price: 0, mix: 0, volume: 0, yield_: 0, fx: 0, totalVar: 0 });
    return { rows: rows, totals: totals };
  }

  // --- Waterfall: zero -> +Price -> +Mix -> +Volume -> +Yield -> +FX -> Total
  // Reuse renderWaterfall (app.js) which interprets base/add/sub/total with a
  // running cumulative total. A 0-value 'base' anchors the bridge at zero so the
  // adds/subs stack to the final total (Σ totalVar). add => red, sub => green.
  function bridgeHtml(totals) {
    var steps = [
      { label: 'Zero', value: 0, type: 'base' },
      { label: '+Price', value: totals.price, type: totals.price >= 0 ? 'add' : 'sub' },
      { label: '+Mix', value: totals.mix, type: totals.mix >= 0 ? 'add' : 'sub' },
      { label: '+Volume', value: totals.volume, type: totals.volume >= 0 ? 'add' : 'sub' },
      { label: '+Yield', value: totals.yield_, type: totals.yield_ >= 0 ? 'add' : 'sub' },
      { label: '+FX', value: totals.fx, type: totals.fx >= 0 ? 'add' : 'sub' },
      { label: 'Total Var', value: totals.totalVar, type: 'total' },
    ];
    // renderWaterfall is a global from app.js; no drill action on these synthetic steps.
    return renderWaterfall(steps, null);
  }

  // --- Per-SKU table: SKU, Total Var, Price, Mix, Volume, Yield, FX ----------
  // Color: positive (adverse) => neg/red; negative (favorable) => pos/green.
  function varCls(v) {
    return v > 0 ? 'neg' : (v < 0 ? 'pos' : 'muted');
  }
  function varCell(v) {
    return '<td class="num mono ' + varCls(v) + '">' + fmtEur(v) + '</td>';
  }

  function tableHtml(rows) {
    var body = rows.map(function (r) {
      return '<tr class="row-click" data-action="drill-sku" data-payload="' + r.sku + '">' +
        '<td class="cell-strong mono">' + r.sku + '</td>' +
        varCell(r.totalVar) +
        varCell(r.price) +
        varCell(r.mix) +
        varCell(r.volume) +
        varCell(r.yield_) +
        varCell(r.fx) +
        '</tr>';
    }).join('');

    return '<div class="table-wrap"><table class="table">' +
      '<thead><tr>' +
      '<th>SKU</th>' +
      '<th class="th-num">Total Var</th>' +
      '<th class="th-num">Price</th>' +
      '<th class="th-num">Mix</th>' +
      '<th class="th-num">Volume</th>' +
      '<th class="th-num">Yield</th>' +
      '<th class="th-num">FX</th>' +
      '</tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table></div>';
  }

  // --- The appended card -----------------------------------------------------
  function attributionCard() {
    var data = buildAttribution();
    var t = data.totals;
    var dir = t.totalVar > 0 ? 'adverse' : (t.totalVar < 0 ? 'favorable' : 'flat');
    var totCls = t.totalVar > 0 ? 'neg' : (t.totalVar < 0 ? 'pos' : 'muted');

    return '<div class="card pb-card" id="pb-attribution">' +
      '<div class="card-head">' +
        '<div class="card-title">PPV Attribution — Price · Mix · Volume · Yield · FX</div>' +
        '<div class="card-sub">Bridges zero → +Price → +Mix → +Volume → +Yield → +FX → total variance ' +
          '<span class="mono ' + totCls + '">' + fmtEurM(t.totalVar) + '</span> ' + dir +
          ' · click a SKU to drill</div>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="pb-bridge">' + bridgeHtml(t) + '</div>' +
        tableHtml(data.rows) +
        '<div class="card-sub pb-foot">Attribution model: FX from per-SKU FX impact; conversion Yield ' +
          'concentrated on butter/processed forms; residual split Price 70% / Mix 18% / Volume 12%.</div>' +
      '</div>' +
    '</div>';
  }

  // --- Styles: token-driven, module-prefixed; reuse existing classes ---------
  function injectStyles() {
    if (document.getElementById('pb-styles')) return;
    var css =
      '.pb-bridge{margin-bottom:18px;}' +
      '.pb-foot{margin-top:12px;padding-top:10px;border-top:1px solid var(--line);' +
        'color:var(--text-2);font-size:11px;line-height:1.5;}';
    var style = document.createElement('style');
    style.id = 'pb-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Compose-wrap VIEWS.ppv.render (pattern A) -----------------------------
  function wrapPpvRender() {
    // NOTE: VIEWS is a top-level `const` in app.js — it is NOT a window property,
    // so reference the bare global (guarded via typeof), never window.VIEWS.
    if (typeof VIEWS === 'undefined' || !VIEWS.ppv ||
        typeof VIEWS.ppv.render !== 'function') return false;
    if (VIEWS.ppv.render.__pbWrapped) return true; // already composed by us
    var prior = VIEWS.ppv.render; // may already be wrapped (commentary patch) — fine
    var wrapped = function () {
      var out = prior(); // keep ALL prior output (base view + commentary)
      try {
        return out + attributionCard();
      } catch (err) {
        // Never break the view; fail soft so other cards still render.
        return out;
      }
    };
    wrapped.__pbWrapped = true;
    VIEWS.ppv.render = wrapped;
    return true;
  }

  // --- Install ---------------------------------------------------------------
  injectStyles();
  if (wrapPpvRender()) {
    // Repaint if the user is already on the PPV view (calling switchView is allowed).
    if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'ppv' &&
        typeof switchView === 'function') {
      switchView('ppv');
    }
  }
})();
