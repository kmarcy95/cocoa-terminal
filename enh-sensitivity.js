/* ============================================================================
   CACAO/FP — ENHANCEMENT: enh-sensitivity.js
   ONE card appended to the Forecast & Planning view:
     Forecast Sensitivity — Driver Tornado

   Self-installing IIFE. Loaded AFTER app.js / views2.js / actions.js and after
   the first/second-wave modules + enh-forecast-suite. Compose-wraps
   VIEWS.forecast.render (ENH_CONTRACT2 pattern A) and APPENDS one .card BELOW
   the existing Forecast content and the enh-forecast-suite cards — all prior
   output is preserved (we capture the prior, possibly-already-wrapped render).
   Repaints via switchView('forecast') only when CURRENT_VIEW === 'forecast'.

   Reuses existing globals/helpers (DATA, formatters fmtEur/fmtM/fmtPct/fmtSigned
   with local fallbacks) and design tokens only. CSS bars / table only (NO
   Chart.js — appended cards have no draw() hook). Never reassigns switchView;
   calling it is fine. Idempotent (window.__cacaoSensitivityInstalled guard);
   localStorage not used; zero console errors.

   --- MODEL (same family as the What-If / driver-forecast formula) ----------
   baseline from DATA.whatIf.baseline:
     { nyPx:7842, ldnPx:5418, eurusd:1.085, civDiff:240, sustain:96,
       freight:64, volume:6400, stdCost:7975 }

     landed(s) = 8142
       + (s.nyPx   − 7842) * 0.9
       + (s.ldnPx  − 5418) * 0.15
       + (s.civDiff − 240)
       + (s.sustain − 96)
       + (s.freight − 64)
       + (s.eurusd  − 1.085) * (−2800)

     monthlySpendM(s) = landed(s) * s.volume / 1e6
     FY spend baseline = monthlySpendM(baseline) * 12

   For EACH driver (NY price, LDN price, EUR/USD, CIV diff, Sustainability,
   Freight, Monthly volume) compute the FY-spend impact of a +10% and −10% move
   in THAT driver only (others held at baseline). Volume scales spend directly.
   Record +Δ and −Δ (€M) per driver; rank by max(|+Δ|,|−Δ|) descending.

   --- RENDER ----------------------------------------------------------------
   Horizontal TORNADO (CSS only): a centered zero line; per driver a row with
   the label on the left, a left (favorable, green/--pos) bar and a right
   (adverse, red/--neg) bar sized proportionally to the largest |Δ| across all
   drivers, and the ±€M values. Most-sensitive driver on top. A .qstat row (FY
   spend baseline, most-sensitive driver + swing) + a one-line takeaway. The
   ±10% assumption + coefficients are footnoted in .card-sub.
   ========================================================================== */
(function installSensitivity() {
  'use strict';

  // --- Idempotency guard (double-install safe) -----------------------------
  if (window.__cacaoSensitivityInstalled) return;
  window.__cacaoSensitivityInstalled = true;

  // --- Model constants (mirror the driver-forecast formula) ----------------
  var LANDED_BASE = 8142;
  var K_NY = 0.9, K_LDN = 0.15, K_CIV = 1, K_SUS = 1, K_FRT = 1, K_FX = -2800;
  var SHOCK = 0.10;     // ±10% per-driver move
  var MONTHS = 12;      // FY = 12 months of monthly spend
  var MAX_BAR_PCT = 88; // longest bar fills 88% of each (left/right) half

  // --- Local formatter fallbacks (reuse globals when present) --------------
  function _fmtEur(n) {
    if (typeof fmtEur === 'function') return fmtEur(Math.round(n));
    return '€' + Math.round(n).toLocaleString('en-US');
  }
  function _fmtM(n, d) {
    if (typeof fmtM === 'function') return fmtM(n, (typeof d === 'number') ? d : 1);
    return (Math.round(n * 10) / 10).toFixed((typeof d === 'number') ? d : 1) + 'M';
  }
  function _fmtPct(n, d) {
    if (typeof fmtPct === 'function') return fmtPct(n, (typeof d === 'number') ? d : 1);
    return (Math.round(n * 10) / 10).toFixed((typeof d === 'number') ? d : 1) + '%';
  }
  // Signed €M with the real minus glyph "−" and a "+" for >= 0.
  function signedM(n) {
    var mag = _fmtM(Math.abs(n), 1).replace(/^[\-−]/, '');
    return (n >= 0 ? '+€' : '−€') + mag;
  }

  function num(v, fallback) {
    var n = (typeof v === 'number' && isFinite(v)) ? v : parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  // --- Baseline (never mutate DATA.whatIf.baseline) ------------------------
  function baseline() {
    var b = (typeof DATA !== 'undefined' && DATA.whatIf && DATA.whatIf.baseline)
      ? DATA.whatIf.baseline : {};
    return {
      nyPx:   num(b.nyPx,   7842),
      ldnPx:  num(b.ldnPx,  5418),
      eurusd: num(b.eurusd, 1.085),
      civDiff:num(b.civDiff,240),
      sustain:num(b.sustain,96),
      freight:num(b.freight,64),
      volume: num(b.volume, 6400),
    };
  }

  // landed €/t from a driver vector
  function landed(s) {
    return LANDED_BASE
      + (s.nyPx    - 7842)  * K_NY
      + (s.ldnPx   - 5418)  * K_LDN
      + (s.civDiff - 240)   * K_CIV
      + (s.sustain - 96)    * K_SUS
      + (s.freight - 64)    * K_FRT
      + (s.eurusd  - 1.085) * K_FX;
  }
  function monthlySpendM(s) { return landed(s) * s.volume / 1e6; }
  function fySpendM(s) { return monthlySpendM(s) * MONTHS; }

  // Apply a +/- pct shock to ONE driver key (others held at baseline).
  function shocked(base, key, pct) {
    var s = {
      nyPx: base.nyPx, ldnPx: base.ldnPx, eurusd: base.eurusd,
      civDiff: base.civDiff, sustain: base.sustain, freight: base.freight,
      volume: base.volume,
    };
    s[key] = base[key] * (1 + pct);
    return s;
  }

  // --- Driver registry ------------------------------------------------------
  // unit = how the baseline value reads in the footnote / value column.
  var DRIVERS = [
    { key: 'nyPx',    label: 'ICE NY price',     unit: 'USD/t' },
    { key: 'ldnPx',   label: 'ICE LDN price',    unit: 'GBP/t' },
    { key: 'eurusd',  label: 'EUR/USD',          unit: '' },
    { key: 'civDiff', label: 'CIV differential', unit: '$/t' },
    { key: 'sustain', label: 'Sustainability',   unit: '$/t' },
    { key: 'freight', label: 'Freight',          unit: '$/t' },
    { key: 'volume',  label: 'Monthly volume',   unit: 'MT' },
  ];

  /**
   * Build the ranked sensitivity rows.
   * For each driver: up = FY spend at +10% − baseline FY spend (€M);
   *                  down = FY spend at −10% − baseline FY spend (€M).
   * swing = max(|up|,|down|); rank descending by swing.
   * @returns {{base:Object, fyBase:number, rows:Array, maxSwing:number}}
   */
  function computeSensitivity() {
    var base = baseline();
    var fyBase = fySpendM(base);

    var rows = DRIVERS.map(function (d) {
      var up = fySpendM(shocked(base, d.key, SHOCK)) - fyBase;
      var down = fySpendM(shocked(base, d.key, -SHOCK)) - fyBase;
      var swing = Math.max(Math.abs(up), Math.abs(down));
      return {
        key: d.key, label: d.label, unit: d.unit,
        baseVal: base[d.key], up: up, down: down, swing: swing,
      };
    });

    rows.sort(function (a, b) { return b.swing - a.swing; });
    var maxSwing = rows.length ? rows[0].swing : 0;
    return { base: base, fyBase: fyBase, rows: rows, maxSwing: maxSwing };
  }

  // Format a baseline driver value for the value column.
  function fmtBaseVal(r) {
    if (r.key === 'eurusd') return r.baseVal.toFixed(3);
    if (r.key === 'volume') {
      return Math.round(r.baseVal).toLocaleString('en-US') + (r.unit ? ' ' + r.unit : '');
    }
    return Math.round(r.baseVal).toLocaleString('en-US') + (r.unit ? ' ' + r.unit : '');
  }

  // One tornado row. The favorable (spend-down) bar grows LEFT from centre;
  // the adverse (spend-up) bar grows RIGHT. Bar lengths normalize to maxSwing.
  function tornadoRow(r, maxSwing) {
    var favVal = Math.min(r.up, r.down);   // most negative Δ (spend falls) = favorable
    var advVal = Math.max(r.up, r.down);   // most positive Δ (spend rises) = adverse
    // If both legs share a sign (e.g. volume both move spend same direction only
    // because we took +/-10%, they are symmetric opposite signs), this still holds:
    // the negative side renders left/green, the positive side right/red.
    var leftPct = maxSwing ? (Math.abs(Math.min(favVal, 0)) / maxSwing) * MAX_BAR_PCT : 0;
    var rightPct = maxSwing ? (Math.max(advVal, 0) / maxSwing) * MAX_BAR_PCT : 0;

    return '' +
      '<div class="sn-row">' +
        '<div class="sn-rlabel">' +
          '<span class="sn-rname">' + r.label + '</span>' +
          '<span class="sn-rbase mono">' + fmtBaseVal(r) + '</span>' +
        '</div>' +
        '<div class="sn-rval sn-rval-fav mono">' + signedM(favVal) + '</div>' +
        '<div class="sn-track">' +
          '<div class="sn-half sn-half-left">' +
            '<div class="sn-bar sn-bar-fav" style="width:' + leftPct.toFixed(1) + '%"></div>' +
          '</div>' +
          '<div class="sn-zero"></div>' +
          '<div class="sn-half sn-half-right">' +
            '<div class="sn-bar sn-bar-adv" style="width:' + rightPct.toFixed(1) + '%"></div>' +
          '</div>' +
        '</div>' +
        '<div class="sn-rval sn-rval-adv mono">' + signedM(advVal) + '</div>' +
      '</div>';
  }

  function tornadoHtml(model) {
    var rows = model.rows.map(function (r) {
      return tornadoRow(r, model.maxSwing);
    }).join('');

    return '' +
      '<div class="sn-tornado">' +
        '<div class="sn-axis">' +
          '<span class="sn-axis-cap sn-axis-fav">◀ favorable · FY spend falls</span>' +
          '<span class="sn-axis-cap sn-axis-mid">baseline</span>' +
          '<span class="sn-axis-cap sn-axis-adv">FY spend rises · adverse ▶</span>' +
        '</div>' +
        rows +
      '</div>';
  }

  function statHtml(model) {
    var top = model.rows[0] || { label: '—', swing: 0 };
    return '' +
      '<div class="qstat-grid sn-stats">' +
        '<div class="qstat"><div class="qstat-label">FY spend baseline</div>' +
          '<div class="qstat-value mono">' + _fmtM(model.fyBase, 1) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Most-sensitive driver</div>' +
          '<div class="qstat-value">' + top.label + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Swing on ±10% move</div>' +
          '<div class="qstat-value mono warn">±' + _fmtM(top.swing, 1) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Drivers tested</div>' +
          '<div class="qstat-value mono">' + model.rows.length + '</div></div>' +
      '</div>';
  }

  // One-line takeaway: top driver swing, then #2 and #3 by name.
  function takeawayHtml(model) {
    var rows = model.rows;
    if (!rows.length) return '';
    var top = rows[0];
    var second = rows[1];
    var third = rows[2];
    var follow = '';
    if (second && third) follow = second.label + ' and ' + third.label + ' follow';
    else if (second) follow = second.label + ' follows';
    var swingTxt = _fmtM(top.swing, 1);
    return '' +
      '<div class="sn-takeaway">' +
        '<span class="sn-take-ico">◉</span>' +
        '<span class="sn-take-text">FY cocoa spend is most sensitive to <b>' + top.label +
          '</b>: a ±10% move swings FY spend ≈ ±€' +
          swingTxt.replace(/M$/, 'M') +
          (follow ? '; ' + follow + '.' : '.') +
        '</span>' +
      '</div>';
  }

  // --- The appended card ----------------------------------------------------
  function sensitivityCard() {
    var model = computeSensitivity();
    var sub = 'Each driver flexed ±10% in isolation (others held at baseline) · ' +
      'bars scale to the largest FY-spend swing · favorable (spend falls) green, adverse red · ' +
      'landed = €8,142 + (NY−7842)·0.9 + (LDN−5418)·0.15 + (CIVdiff−240) + ' +
      '(Sustain−96) + (Freight−64) + (EURUSD−1.085)·(−2,800); FY spend = landed·volume·12.';

    return '' +
      '<div class="card sn-card" id="sn-tornado-card">' +
        '<div class="card-head">' +
          '<div class="card-title">Forecast Sensitivity — Driver Tornado</div>' +
          '<div class="card-sub">' + sub + '</div>' +
        '</div>' +
        '<div class="card-body">' +
          statHtml(model) +
          tornadoHtml(model) +
          takeawayHtml(model) +
        '</div>' +
      '</div>';
  }

  // The appended section (heading + the one card).
  function sensitivitySection() {
    return '' +
      '<div class="sn-suite-head section-title">Sensitivity — FY-spend driver tornado</div>' +
      sensitivityCard();
  }

  // --- Styles: token-driven, module-prefixed (sn-) --------------------------
  function injectStyles() {
    if (document.getElementById('sn-styles')) return;
    var css =
      '.sn-suite-head{margin-top:26px;}' +
      '.sn-stats{margin-bottom:18px;}' +
      // axis caption row
      '.sn-tornado{margin-top:4px;}' +
      '.sn-axis{display:flex;justify-content:space-between;align-items:center;' +
        'margin-bottom:12px;padding:0 2px;}' +
      '.sn-axis-cap{font-family:var(--sans);font-size:10.5px;letter-spacing:.02em;' +
        'text-transform:uppercase;color:var(--text-2);}' +
      '.sn-axis-fav{color:var(--pos);}' +
      '.sn-axis-adv{color:var(--neg);}' +
      '.sn-axis-mid{color:var(--text-3);}' +
      // a tornado row: label | favVal | track | advVal
      '.sn-row{display:grid;' +
        'grid-template-columns:160px 72px 1fr 72px;align-items:center;gap:10px;' +
        'padding:5px 0;}' +
      '.sn-rlabel{display:flex;flex-direction:column;gap:1px;min-width:0;}' +
      '.sn-rname{font-family:var(--sans);font-size:12.5px;color:var(--text-0);' +
        'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.sn-rbase{font-size:10.5px;color:var(--text-2);}' +
      '.sn-rval{font-size:12px;font-weight:600;}' +
      '.sn-rval-fav{color:var(--pos);text-align:right;}' +
      '.sn-rval-adv{color:var(--neg);text-align:left;}' +
      // the centred track: two halves + a zero line
      '.sn-track{position:relative;display:flex;align-items:center;height:18px;}' +
      '.sn-half{height:14px;flex:1 1 50%;display:flex;align-items:center;overflow:hidden;}' +
      '.sn-half-left{justify-content:flex-end;}' +
      '.sn-half-right{justify-content:flex-start;}' +
      '.sn-zero{width:0;border-left:1px dashed var(--line-3);height:18px;flex:0 0 auto;}' +
      '.sn-bar{height:14px;border-radius:3px;min-width:0;transition:width .4s ease;}' +
      '.sn-bar-fav{background:linear-gradient(90deg,var(--pos-dim),var(--pos));' +
        'border-radius:3px 0 0 3px;}' +
      '.sn-bar-adv{background:linear-gradient(90deg,var(--neg),var(--neg-dim));' +
        'border-radius:0 3px 3px 0;}' +
      // takeaway callout
      '.sn-takeaway{display:flex;align-items:flex-start;gap:9px;margin-top:18px;' +
        'padding:11px 13px;background:var(--bg-2);border:1px solid var(--line-2);' +
        'border-left:3px solid var(--accent);border-radius:7px;}' +
      '.sn-take-ico{color:var(--accent);font-size:13px;line-height:1.4;flex:0 0 auto;}' +
      '.sn-take-text{font-family:var(--sans);font-size:12.5px;line-height:1.5;' +
        'color:var(--text-1);}' +
      '.sn-take-text b{color:var(--text-0);}' +
      // responsive — collapse value columns onto the label, keep the track
      '@media (max-width:920px){' +
        '.sn-row{grid-template-columns:120px 1fr;grid-template-areas:' +
          '"label track";row-gap:2px;}' +
        '.sn-rlabel{grid-area:label;}' +
        '.sn-track{grid-area:track;}' +
        '.sn-rval-fav,.sn-rval-adv{display:none;}' +
        '.sn-axis-cap{font-size:9px;}' +
      '}';
    var style = document.createElement('style');
    style.id = 'sn-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Compose-wrap VIEWS.forecast.render (pattern A) -----------------------
  function wrapForecastRender() {
    // VIEWS is a top-level const in app.js — reference bare (guarded), never window.VIEWS.
    if (typeof VIEWS === 'undefined' || !VIEWS.forecast ||
        typeof VIEWS.forecast.render !== 'function') return false;
    if (VIEWS.forecast.render.__snWrapped) return true;
    var prior = VIEWS.forecast.render; // may already be wrapped (forecast-suite etc.) — fine
    var wrapped = function () {
      var out = prior(); // keep ALL prior Forecast & Planning + suite output
      try {
        return out + sensitivitySection();
      } catch (err) {
        return out; // fail soft so the base view still renders
      }
    };
    wrapped.__snWrapped = true;
    VIEWS.forecast.render = wrapped;
    return true;
  }

  // --- Install --------------------------------------------------------------
  injectStyles();

  if (wrapForecastRender()) {
    // If already on the forecast view, repaint (calling switchView is allowed;
    // never REASSIGN it).
    if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'forecast' &&
        typeof switchView === 'function') {
      switchView('forecast');
    }
  }
})();
