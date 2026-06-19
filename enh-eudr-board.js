/* ============================================================================
   CACAO/FP — ENHANCEMENT #12: enh-eudr-board.js
   EUDR "DDS Workflow Board" — a 3-column kanban (NONE → DRAFT → SUBMITTED)
   over DATA.eudr.bySupplier, with the DDS clock and a €-at-risk exposure model.
   Self-installing IIFE. Loaded AFTER app.js / views2.js / actions.js. It
   compose-wraps VIEWS.eudr.render and APPENDS one .card below the existing EUDR
   content — all prior output is preserved (other modules may already have
   wrapped this render; we keep theirs intact). Never reassigns switchView
   (calling it is fine). Idempotent; localStorage-free; zero console errors.
   ENH_CONTRACT2 pattern A.

   LEXICAL-CONST TRAP obeyed: VIEWS / DATA / CURRENT_VIEW are top-level const/let
   in app.js — NOT window properties. They are referenced BARE with typeof
   guards; window.VIEWS / window.DATA are never used.

   --- €-at-risk exposure model (documented; ties to the screen) -------------
   landedPerT = €8,140 (avg landed cost / tonne, per the EUDR brief).
   For each supplier we size committed tonnage from DATA.contracts:
     mtBySupplier = Σ contracts.mt where contract.supplier === supplier.
   Suppliers WITH matching contracts:  exposureT = mtBySupplier.
   Suppliers WITHOUT any matching contract (none in the register): we ESTIMATE
   by evenly splitting the *unmatched* contract tonnage across the suppliers
   that have no direct contract row — so total modeled tonnage still reconciles
   to the contract register, and every supplier gets a non-zero, defensible
   number. The estimate is flagged with an "est." tag on the card.
     unmatchedMt  = Σ contracts.mt for contracts whose supplier is NOT in the
                    EUDR supplier list;
     estPerSupplier = unmatchedMt / (count of EUDR suppliers with no contract).
   €-at-risk(supplier) = exposureT × €8,140.
   A supplier is "exposed" when dds !== 'SUBMITTED' (NONE or DRAFT).
   Header "Total €-at-risk" = Σ €-at-risk over exposed suppliers only.
   ========================================================================== */
(function installEudrBoard() {
  'use strict';

  // --- Idempotency guard (double-install safe) -----------------------------
  if (window.__cacaoEudrBoardInstalled) return;
  window.__cacaoEudrBoardInstalled = true;

  // --- Constants -------------------------------------------------------------
  var LANDED_PER_T = 8140;          // € / tonne avg landed cost
  var DDS_CLOCK_WARN_DAYS = 200;    // clock turns .warn below this
  var RISK_NEG_THRESHOLD = 40;      // risk score above this renders .neg/red
  var COLUMNS = ['NONE', 'DRAFT', 'SUBMITTED'];
  var COL_META = {
    NONE:      { title: 'NONE',      cls: 'neg',  note: 'no DDS started' },
    DRAFT:     { title: 'DRAFT',     cls: 'warn', note: 'in preparation' },
    SUBMITTED: { title: 'SUBMITTED', cls: 'pos',  note: 'filed to TRACES' },
  };

  // --- Safe global accessors (bare refs, typeof-guarded) ---------------------
  function getEudr() {
    if (typeof DATA === 'undefined' || !DATA.eudr) return null;
    return DATA.eudr;
  }
  function getContracts() {
    if (typeof DATA === 'undefined' || !Array.isArray(DATA.contracts)) return [];
    return DATA.contracts;
  }

  // --- HTML escaper: reuse the global `attr` (views2.js) when present --------
  function esc(v) {
    if (typeof attr === 'function') return attr(v);
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  // --- Formatters: reuse globals, with tiny fallbacks (never throw) ----------
  function pct0(n) { return typeof fmtPct === 'function' ? fmtPct(n, 0) : (Math.round(n) + '%'); }
  function int0(n) { return typeof fmtInt === 'function' ? fmtInt(n) : String(Math.round(n)); }
  function eurM(n) { return typeof fmtEurM === 'function' ? fmtEurM(n) : ('€' + (n / 1e6).toFixed(2) + 'M'); }
  function eur0(n) { return typeof fmtEur === 'function' ? fmtEur(Math.round(n)) : ('€' + Math.round(n)); }

  /**
   * Build the per-supplier exposure model (see header comment).
   * @returns {{rows:Array,totals:Object}}
   */
  function buildExposure() {
    var eudr = getEudr();
    var suppliers = (eudr && Array.isArray(eudr.bySupplier)) ? eudr.bySupplier : [];
    var contracts = getContracts();

    // Σ contract MT per supplier name.
    var mtBySupplier = {};
    contracts.forEach(function (c) {
      var key = c.supplier;
      mtBySupplier[key] = (mtBySupplier[key] || 0) + (Number(c.mt) || 0);
    });

    // EUDR supplier names (set) → identify which have no direct contract row.
    var eudrNames = {};
    suppliers.forEach(function (s) { eudrNames[s.supplier] = true; });

    var noContractSuppliers = suppliers.filter(function (s) {
      return !mtBySupplier[s.supplier];
    });

    // Unmatched contract MT = contracts whose supplier is NOT an EUDR supplier.
    var unmatchedMt = contracts.reduce(function (acc, c) {
      return acc + (eudrNames[c.supplier] ? 0 : (Number(c.mt) || 0));
    }, 0);
    var estPerSupplier = noContractSuppliers.length
      ? unmatchedMt / noContractSuppliers.length
      : 0;

    var rows = suppliers.map(function (s) {
      var matchedMt = mtBySupplier[s.supplier] || 0;
      var estimated = matchedMt === 0;
      var exposureT = estimated ? estPerSupplier : matchedMt;
      var atRisk = exposureT * LANDED_PER_T;
      var exposed = s.dds !== 'SUBMITTED';
      var dds = COLUMNS.indexOf(s.dds) === -1 ? 'NONE' : s.dds; // defensive bucket
      return {
        supplier: s.supplier,
        origin: s.origin,
        geoPct: Number(s.geoPct) || 0,
        dds: dds,
        cert: s.cert,
        risk: Number(s.risk) || 0,
        lastAudit: s.lastAudit,
        exposureT: exposureT,
        estimated: estimated,
        atRisk: atRisk,
        exposed: exposed,
      };
    });

    var totals = rows.reduce(function (acc, r) {
      acc.total += 1;
      if (r.dds === 'SUBMITTED') acc.submitted += 1; else acc.exposed += 1;
      if (r.exposed) acc.atRiskExposed += r.atRisk;
      return acc;
    }, { total: 0, submitted: 0, exposed: 0, atRiskExposed: 0 });

    return { rows: rows, totals: totals };
  }

  // --- Header strip (reuse .qstat-grid) --------------------------------------
  function headerStrip(totals, clockDays) {
    var clockCls = clockDays < DDS_CLOCK_WARN_DAYS ? 'warn' : '';
    return '<div class="qstat-grid eu-strip">' +
      '<div class="qstat"><div class="qstat-label">Suppliers</div>' +
        '<div class="qstat-value mono">' + int0(totals.total) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">Submitted</div>' +
        '<div class="qstat-value pos mono">' + int0(totals.submitted) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">Exposed</div>' +
        '<div class="qstat-value neg mono">' + int0(totals.exposed) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">€ at-risk</div>' +
        '<div class="qstat-value neg mono">' + eurM(totals.atRiskExposed) + '</div></div>' +
      '<div class="qstat"><div class="qstat-label">DDS Clock</div>' +
        '<div class="qstat-value mono ' + clockCls + '">' + int0(clockDays) + ' d</div></div>' +
      '</div>';
  }

  // --- One supplier card inside a column -------------------------------------
  function supplierCard(r, clockDays) {
    var riskCls = r.risk > RISK_NEG_THRESHOLD ? 'neg' : 'pos';
    var clockCls = clockDays < DDS_CLOCK_WARN_DAYS ? 'warn' : '';
    var estTag = r.estimated ? '<span class="eu-est" title="estimated from unmatched contract tonnage">est.</span>' : '';

    // Submit-DDS button only on NONE / DRAFT cards (exposed). Reuses the
    // existing submit-dds modal; payload = supplier (handler ignores it but it
    // mirrors the EUDR view\'s high-risk queue convention).
    var actionBtn = r.exposed
      ? '<button class="btn btn-sm eu-submit" data-action="submit-dds" data-payload="' + esc(r.supplier) + '">⬆ Submit DDS</button>'
      : '<span class="eu-filed badge badge-pos">FILED</span>';

    return '<div class="eu-card">' +
      '<div class="eu-card-top">' +
        '<span class="eu-sup cell-strong">' + esc(r.supplier) + '</span>' +
        '<span class="eu-origin mono">' + esc(r.origin) + '</span>' +
      '</div>' +
      '<div class="progress eu-geo">' +
        '<div class="progress-label">Geo coverage<span class="mono">' + pct0(r.geoPct) + '</span></div>' +
        '<div class="progress-bar" style="width:' + Math.max(0, Math.min(100, r.geoPct)) + '%"></div>' +
      '</div>' +
      '<div class="eu-metrics">' +
        '<div class="eu-metric"><span class="eu-mk">DDS clock</span>' +
          '<span class="eu-mv mono ' + clockCls + '">' + int0(clockDays) + ' d</span></div>' +
        '<div class="eu-metric"><span class="eu-mk">Risk</span>' +
          '<span class="eu-mv mono ' + riskCls + '">' + int0(r.risk) + '</span></div>' +
        '<div class="eu-metric"><span class="eu-mk">€ at-risk ' + estTag + '</span>' +
          '<span class="eu-mv mono neg">' + eur0(r.atRisk) + '</span></div>' +
      '</div>' +
      '<div class="eu-card-foot">' + actionBtn + '</div>' +
    '</div>';
  }

  // --- One kanban column -----------------------------------------------------
  function column(colKey, rows, clockDays) {
    var meta = COL_META[colKey];
    var cardsInCol = rows.filter(function (r) { return r.dds === colKey; })
      // sort by risk descending within the column
      .sort(function (a, b) { return b.risk - a.risk; });

    var cardsHtml = cardsInCol.length
      ? cardsInCol.map(function (r) { return supplierCard(r, clockDays); }).join('')
      : '<div class="eu-empty">none</div>';

    return '<div class="eu-col">' +
      '<div class="eu-col-head">' +
        '<span class="eu-col-title ' + meta.cls + '">' + meta.title + '</span>' +
        '<span class="eu-col-count mono">' + int0(cardsInCol.length) + '</span>' +
      '</div>' +
      '<div class="eu-col-note">' + meta.note + '</div>' +
      '<div class="eu-col-body">' + cardsHtml + '</div>' +
    '</div>';
  }

  // --- The appended card -----------------------------------------------------
  function boardCard() {
    var eudr = getEudr();
    if (!eudr) return '';
    var clockDays = (eudr.summary && Number(eudr.summary.ddsClock)) || 196;
    var model = buildExposure();

    var board = '<div class="eu-board">' +
      COLUMNS.map(function (k) { return column(k, model.rows, clockDays); }).join('') +
      '</div>';

    return '<div class="card eu-board-card" id="eu-dds-board">' +
      '<div class="card-head">' +
        '<div class="card-title">DDS Workflow Board</div>' +
        '<div class="card-sub">Kanban of EUDR Due-Diligence Statements (NONE → DRAFT → SUBMITTED). ' +
          '€ at-risk = committed tonnage × ' + eur0(LANDED_PER_T) + '/t; ' +
          'suppliers without a contract row are estimated (est.) from unmatched register tonnage, ' +
          'split evenly. Cards sorted by risk within each column.</div>' +
      '</div>' +
      '<div class="card-body">' +
        headerStrip(model.totals, clockDays) +
        board +
      '</div>' +
    '</div>';
  }

  // --- Styles: token-driven, module-prefixed (eu-) ---------------------------
  function injectStyles() {
    if (document.getElementById('eu-board-styles')) return;
    var css =
      '.eu-board-card .eu-strip{margin-bottom:16px;}' +
      '.eu-board{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}' +
      '.eu-col{background:var(--bg-2);border:1px solid var(--line);border-radius:8px;' +
        'padding:10px;display:flex;flex-direction:column;min-width:0;}' +
      '.eu-col-head{display:flex;align-items:center;justify-content:space-between;}' +
      '.eu-col-title{font-family:var(--sans);font-size:11px;font-weight:700;' +
        'letter-spacing:.08em;text-transform:uppercase;color:var(--text-2);}' +
      '.eu-col-title.pos{color:var(--pos);}.eu-col-title.warn{color:var(--warn);}' +
      '.eu-col-title.neg{color:var(--neg);}' +
      '.eu-col-count{font-size:12px;color:var(--text-2);background:var(--bg-3);' +
        'border:1px solid var(--line-2);border-radius:10px;padding:1px 8px;}' +
      '.eu-col-note{font-size:10px;color:var(--text-3);margin:2px 0 10px;}' +
      '.eu-col-body{display:flex;flex-direction:column;gap:10px;}' +
      '.eu-card{background:var(--bg-1);border:1px solid var(--line-2);border-radius:7px;' +
        'padding:10px 11px;display:flex;flex-direction:column;gap:9px;}' +
      '.eu-card-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}' +
      '.eu-sup{font-size:12.5px;line-height:1.25;}' +
      '.eu-origin{font-size:11px;color:var(--accent);flex:0 0 auto;}' +
      '.eu-geo{margin:0;}' +
      '.eu-metrics{display:flex;flex-direction:column;gap:5px;}' +
      '.eu-metric{display:flex;align-items:center;justify-content:space-between;font-size:11px;}' +
      '.eu-mk{color:var(--text-2);display:flex;align-items:center;gap:5px;}' +
      '.eu-mv{font-size:12px;}' +
      '.eu-est{font-family:var(--sans);font-size:9px;text-transform:uppercase;' +
        'letter-spacing:.04em;color:var(--text-3);border:1px solid var(--line-2);' +
        'border-radius:3px;padding:0 4px;}' +
      '.eu-card-foot{display:flex;justify-content:flex-end;margin-top:1px;}' +
      '.eu-submit{background:var(--bg-3);border:1px solid var(--accent-dim);color:var(--accent);}' +
      '.eu-submit:hover{background:var(--accent-dim);color:var(--text-0);}' +
      '.eu-filed{font-size:10px;}' +
      '.eu-empty{font-size:11px;color:var(--text-3);font-style:italic;padding:8px 2px;}' +
      '@media (max-width:920px){.eu-board{grid-template-columns:1fr;}}';
    var style = document.createElement('style');
    style.id = 'eu-board-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Compose-wrap VIEWS.eudr.render (pattern A) ----------------------------
  function wrapEudrRender() {
    // VIEWS is a bare top-level const in app.js (NOT window.VIEWS) — guard via typeof.
    if (typeof VIEWS === 'undefined' || !VIEWS.eudr ||
        typeof VIEWS.eudr.render !== 'function') return false;
    if (VIEWS.eudr.render.__euWrapped) return true; // already composed by us
    var prior = VIEWS.eudr.render; // may already be wrapped by other modules — fine
    var wrapped = function () {
      var out = prior(); // keep ALL prior EUDR output intact
      try {
        return out + boardCard();
      } catch (err) {
        // Never break the view; fail soft so existing cards still render.
        return out;
      }
    };
    wrapped.__euWrapped = true;
    VIEWS.eudr.render = wrapped;
    return true;
  }

  // --- Install ---------------------------------------------------------------
  injectStyles();
  if (wrapEudrRender()) {
    // Repaint if the user is already on the EUDR view (calling switchView is allowed).
    if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'eudr' &&
        typeof switchView === 'function') {
      switchView('eudr');
    }
  }
})();
