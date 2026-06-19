/* ============================================================================
   CACAO/FP — enh-accruals-je.js  (enhancement module #6)
   Accruals worksheet + journal-entry generator on the Month-End Close view.

   - Self-installing plain-JS IIFE; installs at top level on load.
   - Compose-wraps VIEWS.close.render (pattern A) to APPEND two cards below the
     existing Close content (prior output preserved).
   - Registers ACTIONS['gen-je'] (modal w/ balanced double-entry) and
     ACTIONS['post-je-batch'] (post-to-batch footer handler).
   - Reuses design tokens + .card/.table/.btn-sm/.qstat-grid/.badge markup.
   - Idempotent; localStorage try/catch; zero console errors.

   NOTE on lexical-const trap: VIEWS, ACTIONS, DATA, CURRENT_VIEW are const/let
   in app.js — referenced BARE here (guarded with typeof). switchView/toast/
   modal/closeModal are function declarations (callable bare). Never reassign
   switchView; never touch window.VIEWS/ACTIONS/DATA (undefined).
   ========================================================================== */
(function () {
  'use strict';

  // Guard: required globals must exist (loaded after app.js/views2.js/actions.js).
  if (typeof VIEWS === 'undefined' || typeof DATA === 'undefined' ||
      typeof ACTIONS === 'undefined' || typeof VIEWS.close === 'undefined') {
    return;
  }

  // Idempotency: install once even if the file is included twice.
  if (VIEWS.close.render && VIEWS.close.render.__accJe) return;

  /* ---- constants ---------------------------------------------------------- */
  var MOD = 'acc-je';
  var POSTED_KEY = 'cacao_acc_je_posted_v1';
  var EURUSD_FALLBACK = 1.085;          // EUR/USD when ticker lookup fails
  var BDI_FALLBACK = 1842;              // Baltic Dry index fallback
  var BDI_FREIGHT_DIVISOR = 100;        // synthetic: BDI / divisor → freight €/t
  var LCM_AMOUNT_EUR = 25000;           // CK-DE-01 NRV reserve (fixed)

  /* ---- session-local posted-to-batch counter (persisted, try/catch) ------- */
  var postedCount = (function () {
    try {
      var v = parseInt(localStorage.getItem(POSTED_KEY) || '0', 10);
      return isNaN(v) ? 0 : v;
    } catch (e) { return 0; }
  })();

  function savePostedCount() {
    try { localStorage.setItem(POSTED_KEY, String(postedCount)); } catch (e) { /* ignore */ }
  }

  /* ---- safe formatter shims (fall back if a global is somehow missing) ---- */
  function eur(n) {
    return (typeof fmtEur === 'function') ? fmtEur(n)
      : '€' + Math.round(n).toLocaleString('en-US');
  }
  function pct1(n) {
    return (typeof fmtPct === 'function') ? fmtPct(n) : (Number(n).toFixed(1) + '%');
  }
  function num2(n) {
    return (typeof fmtNum === 'function') ? fmtNum(n, 2) : Number(n).toFixed(2);
  }
  function int0(n) {
    return (typeof fmtInt === 'function') ? fmtInt(n) : Math.round(n).toLocaleString('en-US');
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---- market lookups from DATA.ticker ------------------------------------ */
  function tickerPx(sym, fallback) {
    try {
      var t = (DATA.ticker || []).filter(function (x) { return x.sym === sym; })[0];
      return (t && typeof t.px === 'number' && t.px > 0) ? t.px : fallback;
    } catch (e) { return fallback; }
  }
  function eurusd() { return tickerPx('EUR/USD', EURUSD_FALLBACK); }
  function bdi() { return tickerPx('BDI', BDI_FALLBACK); }

  /* ---- computed figures (recomputed each render so they track DATA) ------- */

  // CARD A — per-origin premium accrual rows.
  function originAccruals() {
    var fx = eurusd();
    return (DATA.originSpend || []).map(function (o) {
      var certifiedMT = o.mt * (o.certPct / 100);
      var premiumEur = o.premiumUsd / fx;          // USD/t → EUR/t
      var accrualEur = certifiedMT * premiumEur;
      return {
        code: o.code, name: o.name, certPct: o.certPct,
        certifiedMT: certifiedMT, premiumEur: premiumEur, accrualEur: accrualEur
      };
    });
  }
  function premiumAccrualTotal() {
    return originAccruals().reduce(function (s, r) { return s + r.accrualEur; }, 0);
  }

  // Freight accrual — synthetic but clearly labelled, derived from the Baltic.
  function freightFigures() {
    var totalMT = (DATA.originSpend || []).reduce(function (s, o) { return s + o.mt; }, 0);
    var freightEurPerT = bdi() / BDI_FREIGHT_DIVISOR;     // e.g. 1842/100 ≈ €18.42/t
    var freightAccrual = totalMT * freightEurPerT;
    return { totalMT: totalMT, freightEurPerT: freightEurPerT, freightAccrual: freightAccrual };
  }

  // PPV (gen-je: ppv) — Σ((actEur − stdEur) * mt) ≈ €1.02M.
  function ppvAmount() {
    return (DATA.ppvDetail || []).reduce(function (s, p) {
      return s + (p.actEur - p.stdEur) * p.mt;
    }, 0);
  }

  // Hedge MTM (gen-je: hedge) — Σ DATA.hedges mtmEur ≈ €532k.
  function hedgeMtmAmount() {
    return (DATA.hedges || []).reduce(function (s, h) { return s + (h.mtmEur || 0); }, 0);
  }

  /* ---- JE mapping --------------------------------------------------------- *
   * Each entry: a single balanced double-entry (Dr account = Cr account amt). */
  function jeSpec(payload) {
    // payload may be "premium:<origin>" — strip the suffix for the generic premium JE.
    var key = String(payload || '').split(':')[0] || 'ppv';
    if (key === 'freight') key = 'freight';

    switch (key) {
      case 'ppv':
        return {
          title: 'Journal Entry — Cocoa PPV vs Standard',
          drAcct: '8410xx', drName: 'Std cost variance',
          crAcct: '13xxxx', crName: 'Inventory',
          amount: Math.abs(ppvAmount()),
          narrative: 'Cocoa PPV vs standard, June'
        };
      case 'lcm':
        return {
          title: 'Journal Entry — LCM / NRV Reserve',
          drAcct: '5xxxxx', drName: 'COGS',
          crAcct: '14xxxx', crName: 'LCM reserve',
          amount: LCM_AMOUNT_EUR,
          narrative: 'LCM/NRV reserve — CK-DE-01'
        };
      case 'premium':
        return {
          title: 'Journal Entry — Origin Premium Accrual',
          drAcct: '8420xx', drName: 'Origin premium',
          crAcct: '21xxxx', crName: 'Accruals',
          amount: premiumAccrualTotal(),
          narrative: 'RA/FT/ORG origin premium accrual'
        };
      case 'freight': {
        var f = freightFigures();
        return {
          title: 'Journal Entry — Freight Accrual (Baltic)',
          drAcct: '8430xx', drName: 'Inbound freight',
          crAcct: '21xxxx', crName: 'Accruals',
          amount: f.freightAccrual,
          narrative: 'Inbound freight accrual — Baltic Dry ' + int0(bdi()) +
            ' idx (' + eur(f.freightEurPerT) + '/t × ' + int0(f.totalMT) + ' MT)'
        };
      }
      case 'hedge':
      default:
        return {
          title: 'Journal Entry — Hedge MTM Revaluation',
          drAcct: '1xxxxx', drName: 'OCI / Cash-flow hedge reserve',
          crAcct: '17xxxx', crName: 'Derivative',
          amount: Math.abs(hedgeMtmAmount()),
          narrative: 'Hedge MTM revaluation (IFRS 9)'
        };
    }
  }

  /* ---- ACTION: gen-je → balanced double-entry modal ----------------------- */
  ACTIONS['gen-je'] = function (payload) {
    var spec = jeSpec(payload);
    var amt = eur(spec.amount);

    var body =
      '<div class="qstat-grid">' +
        '<div class="qstat"><div class="qstat-label">Debit</div>' +
          '<div class="qstat-value info">' + esc(spec.drAcct) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Credit</div>' +
          '<div class="qstat-value info">' + esc(spec.crAcct) + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Amount</div>' +
          '<div class="qstat-value mono">' + amt + '</div></div>' +
        '<div class="qstat"><div class="qstat-label">Status</div>' +
          '<div class="qstat-value warn">DRAFT</div></div>' +
      '</div>' +
      '<div class="' + MOD + '-narr">' + esc(spec.narrative) + '</div>' +
      '<div class="table-wrap"><table class="table ' + MOD + '-je-table">' +
        '<thead><tr>' +
          '<th>Account</th><th>Name</th>' +
          '<th class="th-num">Dr</th><th class="th-num">Cr</th>' +
        '</tr></thead>' +
        '<tbody>' +
          '<tr><td class="cell-strong mono">' + esc(spec.drAcct) + '</td>' +
            '<td>' + esc(spec.drName) + '</td>' +
            '<td class="num mono">' + amt + '</td>' +
            '<td class="num mono muted">—</td></tr>' +
          '<tr><td class="cell-strong mono">' + esc(spec.crAcct) + '</td>' +
            '<td>' + esc(spec.crName) + '</td>' +
            '<td class="num mono muted">—</td>' +
            '<td class="num mono">' + amt + '</td></tr>' +
          '<tr class="' + MOD + '-je-total"><td class="cell-strong">Totals</td><td></td>' +
            '<td class="num mono accent">' + amt + '</td>' +
            '<td class="num mono accent">' + amt + '</td></tr>' +
        '</tbody>' +
      '</table></div>' +
      '<div class="' + MOD + '-balance">Balanced · debits = credits = ' + amt + '</div>';

    var footer =
      '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" data-action="post-je-batch" data-payload="' +
        esc(spec.drAcct + '|' + spec.crAcct) + '">Post to batch</button>';

    if (typeof modal === 'function') {
      modal({ title: spec.title, sub: 'Balanced double-entry · ' + spec.narrative, body: body, footer: footer });
    }
  };

  /* ---- ACTION: post-je-batch → confirm + increment posted counter --------- */
  ACTIONS['post-je-batch'] = function (payload) {
    postedCount += 1;
    savePostedCount();
    if (typeof closeModal === 'function') closeModal();
    if (typeof toast === 'function') {
      toast({
        type: 'success', title: 'Posted to batch',
        body: 'Journal entry queued for the close batch.',
        meta: (payload ? String(payload).replace('|', ' / ') + ' · ' : '') +
          postedCount + ' posted this session'
      });
    }
    // Refresh the count chip live if we're on the close view.
    refreshPostedChip();
  };

  /* ---- CARD A — Accruals Worksheet ---------------------------------------- */
  function cardAccrualsHtml() {
    var rows = originAccruals();
    var fx = eurusd();
    var total = rows.reduce(function (s, r) { return s + r.accrualEur; }, 0);
    var f = freightFigures();

    var bodyRows = rows.map(function (r) {
      return '<tr>' +
        '<td class="cell-strong">' + esc(r.name) + ' <span class="muted mono">' + esc(r.code) + '</span></td>' +
        '<td class="num mono">' + pct1(r.certPct) + '</td>' +
        '<td class="num mono">' + int0(r.certifiedMT) + '</td>' +
        '<td class="num mono">' + eur(r.premiumEur) + '</td>' +
        '<td class="num mono">' + eur(r.accrualEur) + '</td>' +
        '<td class="' + MOD + '-act"><button class="btn btn-sm" data-action="gen-je" ' +
          'data-payload="premium:' + esc(r.code) + '">Generate JE</button></td>' +
      '</tr>';
    }).join('');

    var totalRow =
      '<tr class="' + MOD + '-total-row">' +
        '<td class="cell-strong">Premium accrual total</td>' +
        '<td class="num"></td><td class="num"></td><td class="num"></td>' +
        '<td class="num mono accent">' + eur(total) + '</td>' +
        '<td class="' + MOD + '-act"><button class="btn btn-sm" data-action="gen-je" ' +
          'data-payload="premium">Generate JE</button></td>' +
      '</tr>';

    var freightRow =
      '<tr class="' + MOD + '-freight-row">' +
        '<td class="cell-strong">Freight accrual <span class="muted mono">BDI ' + int0(bdi()) + '</span></td>' +
        '<td class="num mono muted">—</td>' +
        '<td class="num mono">' + int0(f.totalMT) + '</td>' +
        '<td class="num mono">' + eur(f.freightEurPerT) + '</td>' +
        '<td class="num mono">' + eur(f.freightAccrual) + '</td>' +
        '<td class="' + MOD + '-act"><button class="btn btn-sm" data-action="gen-je" ' +
          'data-payload="freight">Generate JE</button></td>' +
      '</tr>';

    return '' +
      '<div class="card ' + MOD + '-card">' +
        '<div class="card-head"><div class="card-title">Accruals Worksheet (origin premium + freight)</div>' +
          '<div class="card-sub">EUR/USD ' + num2(fx) + ' · certified MT × premium €/t · freight from Baltic Dry (synthetic)</div></div>' +
        '<div class="card-body">' +
          '<div class="table-wrap"><table class="table">' +
            '<thead><tr>' +
              '<th>Origin</th><th class="th-num">Cert %</th><th class="th-num">Certified MT</th>' +
              '<th class="th-num">Premium €/t</th><th class="th-num">Accrual €</th><th>JE</th>' +
            '</tr></thead>' +
            '<tbody>' + bodyRows + totalRow + freightRow + '</tbody>' +
          '</table></div>' +
        '</div>' +
      '</div>';
  }

  /* ---- CARD B — Journal-Entry Generator ----------------------------------- */
  var JE_BUTTONS = [
    { payload: 'ppv', label: 'PPV variance', desc: 'Dr 8410xx / Cr 13xxxx' },
    { payload: 'lcm', label: 'LCM reserve', desc: 'Dr 5xxxxx / Cr 14xxxx' },
    { payload: 'premium', label: 'Origin premium', desc: 'Dr 8420xx / Cr 21xxxx' },
    { payload: 'hedge', label: 'Hedge MTM', desc: 'Dr 1xxxxx / Cr 17xxxx' }
  ];

  function cardGeneratorHtml() {
    var btns = JE_BUTTONS.map(function (b) {
      return '<div class="' + MOD + '-gen-cell">' +
        '<div class="' + MOD + '-gen-label">' + esc(b.label) + '</div>' +
        '<div class="' + MOD + '-gen-desc mono muted">' + esc(b.desc) + '</div>' +
        '<button class="btn btn-sm" data-action="gen-je" data-payload="' + esc(b.payload) + '">Generate JE</button>' +
      '</div>';
    }).join('');

    return '' +
      '<div class="card ' + MOD + '-card">' +
        '<div class="card-head"><div class="card-title">Journal-Entry Generator</div>' +
          '<div class="card-sub">Balanced double-entries · post to the close batch</div></div>' +
        '<div class="card-body">' +
          '<div class="' + MOD + '-gen-grid">' + btns + '</div>' +
          '<div class="' + MOD + '-posted" id="' + MOD + '-posted">' +
            'Posted to batch this session: <span class="' + MOD + '-posted-n mono accent" id="' + MOD + '-posted-n">' +
            postedCount + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // Live-update the posted-count chip without a full repaint (best effort).
  function refreshPostedChip() {
    try {
      var el = document.getElementById(MOD + '-posted-n');
      if (el) el.textContent = String(postedCount);
    } catch (e) { /* ignore */ }
  }

  /* ---- compose-wrap VIEWS.close.render (pattern A) ------------------------ */
  var _origRender = VIEWS.close.render.bind(VIEWS.close);
  function wrappedRender() {
    var prior = '';
    try { prior = _origRender(); } catch (e) { prior = ''; }
    return prior + cardAccrualsHtml() + cardGeneratorHtml();
  }
  wrappedRender.__accJe = true;
  VIEWS.close.render = wrappedRender;

  /* ---- styles (ONE module-prefixed <style>, design tokens) ---------------- */
  function injectStyles() {
    if (document.getElementById(MOD + '-styles')) return;
    var css =
      '.' + MOD + '-total-row td,.' + MOD + '-freight-row td{' +
        'border-top:1px solid var(--line-2);background:var(--bg-2);}' +
      '.' + MOD + '-freight-row td{font-style:normal;}' +
      '.' + MOD + '-act{text-align:right;white-space:nowrap;}' +
      '.' + MOD + '-gen-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}' +
      '.' + MOD + '-gen-cell{display:flex;flex-direction:column;gap:6px;align-items:flex-start;' +
        'padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg-2);}' +
      '.' + MOD + '-gen-label{font-family:var(--sans);font-size:13px;color:var(--text-0);font-weight:600;}' +
      '.' + MOD + '-gen-desc{font-size:11px;}' +
      '.' + MOD + '-posted{margin-top:12px;font-family:var(--sans);font-size:12px;color:var(--text-1);}' +
      '.' + MOD + '-posted-n{font-size:14px;}' +
      '.' + MOD + '-narr{margin:10px 0;font-family:var(--sans);font-size:12px;color:var(--text-1);}' +
      '.' + MOD + '-je-total td{border-top:1px solid var(--line-2);background:var(--bg-2);}' +
      '.' + MOD + '-balance{margin-top:10px;padding:8px 10px;border:1px solid var(--pos-dim);' +
        'border-radius:6px;background:rgba(45,212,164,0.08);color:var(--pos);' +
        'font-family:var(--mono);font-size:12px;}' +
      '@media (max-width:920px){.' + MOD + '-gen-grid{grid-template-columns:1fr 1fr;}}';
    var style = document.createElement('style');
    style.id = MOD + '-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }
  injectStyles();

  /* ---- repaint if Close is the current view ------------------------------- */
  if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'close' &&
      typeof switchView === 'function') {
    switchView('close');
  }
})();
