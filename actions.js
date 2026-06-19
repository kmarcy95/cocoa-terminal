/* ============================================================================
   CACAO/FP — actions.js  (UI primitives, dispatcher, ACTIONS map, drill drawers)
   LOADS LAST. Per CONTRACT §1/§2/§9/§10/§11.

   Owns:
     • toast / modal / closeModal / openDrawer / closeDrawer        (§9)
     • the single document click dispatcher + ACTIONS map           (§10)
     • 30+ modal factories + 13 drill-drawer factories              (§10/§11)
     • the card-action toggle handler
     • the single app boot call switchView('dashboard')             (§2)

   Calls (never redefines) globals from app.js / views2.js:
     $,$$, formatters (fmt*), signClass, switchView, CURRENT_VIEW,
     VIEWS, FILTERS, defaultFilters, saveFilters, loadFilters,
     renderFilterChips, resetWhatIf, generateCommentary, DATA.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   Small internal helpers (local to this file — not part of the contract).
   Prefixed `_a` to avoid colliding with anything owned elsewhere.
   --------------------------------------------------------------------------- */

const TOAST_TTL_MS = 3800;
const REFRESH_DELAY_MS = 1500;
const SYNC_DELAY_MS = 2000;
const NAV_DELAY_MS = 700;

/* HTML-escape for any user/data string we drop into innerHTML. */
function _aEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Map a semantic status string to a color token class (§6). */
function _aStatusClass(status) {
  const s = String(status || '').toUpperCase();
  if (/^(EFFECTIVE|DONE|FIXED|PASS|PAID|SUBMITTED|CURRENT|MATCHED|POSTED|OK)$/.test(s)) return 'pos';
  if (/^(WATCH|IN_PROGRESS|OPEN|PARTIAL|PENDING|DRAFT|WORKING|VARIANCE|ADVERSE)$/.test(s)) return 'warn';
  if (/^(FAILED|GAP|FAIL|UNPRICED|NONE)$/.test(s)) return 'neg';
  if (/^(SUPERSEDED|FROZEN|BUDGET)$/.test(s)) return 'muted';
  return 'info';
}

/* Safe formatter access — formatters live in app.js; guard for parse-time. */
function _aInt(n) { return (typeof fmtInt === 'function') ? fmtInt(n) : String(n); }
function _aEur(n, d) { return (typeof fmtEur === 'function') ? fmtEur(n, d) : '€' + n; }
function _aEurM(n, d) { return (typeof fmtEurM === 'function') ? fmtEurM(n, d) : '€' + n; }
function _aPct(n, d) { return (typeof fmtPct === 'function') ? fmtPct(n, d) : n + '%'; }
function _aSignedPct(n, d) { return (typeof fmtSignedPct === 'function') ? fmtSignedPct(n, d) : (n >= 0 ? '+' : '') + n + '%'; }
function _aUsd(n, d) { return (typeof fmtUsd === 'function') ? fmtUsd(n, d) : '$' + n; }
function _aGbp(n, d) { return (typeof fmtGbp === 'function') ? fmtGbp(n, d) : '£' + n; }
function _aNum(n, d) { return (typeof fmtNum === 'function') ? fmtNum(n, d) : String(n); }

/* Build a qstat-grid from [{label, value, cls}] (cls optional → color class). */
function _aQstatGrid(items) {
  return '<div class="qstat-grid">' + items.map(it =>
    '<div class="qstat">' +
      '<div class="qstat-label">' + _aEsc(it.label) + '</div>' +
      '<div class="qstat-value ' + (it.cls || '') + '">' + (it.html ? it.value : _aEsc(it.value)) + '</div>' +
    '</div>'
  ).join('') + '</div>';
}

/* Build a kv-list from [{k, v, cls}]. */
function _aKvList(rows) {
  return '<div class="kv-list">' + rows.map(r =>
    '<div class="kv">' +
      '<span class="kv-k">' + _aEsc(r.k) + '</span>' +
      '<span class="kv-v mono ' + (r.cls || '') + '">' + (r.html ? r.v : _aEsc(r.v)) + '</span>' +
    '</div>'
  ).join('') + '</div>';
}

/* Build a timeline from [{cls, body, time}]. */
function _aTimeline(items) {
  return '<div class="timeline">' + items.map(it =>
    '<div class="tl-item">' +
      '<span class="tl-dot ' + (it.cls || 'info') + '"></span>' +
      '<div class="tl-body">' + (it.html ? it.body : _aEsc(it.body)) +
        (it.time ? ' <span class="tl-time">' + _aEsc(it.time) + '</span>' : '') +
      '</div>' +
    '</div>'
  ).join('') + '</div>';
}

/* Build a quick-actions row of btn-sm from [{action, payload, label}]. */
function _aQuickActions(btns) {
  return '<div class="section-title">Quick actions</div><div class="quick-actions">' +
    btns.map(b =>
      '<button class="btn btn-sm" data-action="' + _aEsc(b.action) + '"' +
        (b.payload != null ? ' data-payload="' + _aEsc(b.payload) + '"' : '') + '>' +
        _aEsc(b.label) + '</button>'
    ).join('') + '</div>';
}

/* A single .form-row with a label + arbitrary inner control HTML. */
function _aFormRow(label, controlHtml, help) {
  return '<div class="form-row">' +
    '<label class="form-label">' + _aEsc(label) + '</label>' +
    controlHtml +
    (help ? '<div class="form-help">' + _aEsc(help) + '</div>' : '') +
    '</div>';
}

/* A select control for a form-row. opts = [string] or [{value,label}]. */
function _aSelect(opts, selected) {
  return '<select class="form-input">' + opts.map(o => {
    const val = (typeof o === 'object') ? o.value : o;
    const lab = (typeof o === 'object') ? o.label : o;
    const sel = (selected != null && String(selected) === String(val)) ? ' selected' : '';
    return '<option value="' + _aEsc(val) + '"' + sel + '>' + _aEsc(lab) + '</option>';
  }).join('') + '</select>';
}

/* A text/number input for a form-row. */
function _aInput(value, type, placeholder) {
  return '<input class="form-input" type="' + (type || 'text') + '"' +
    (value != null ? ' value="' + _aEsc(value) + '"' : '') +
    (placeholder ? ' placeholder="' + _aEsc(placeholder) + '"' : '') + ' />';
}

/* A checkbox row (label + checkbox) for forms. */
function _aCheck(label, checked) {
  return '<div class="form-row"><label class="form-label">' +
    '<input type="checkbox" class="form-input"' + (checked ? ' checked' : '') +
    ' style="width:auto;margin-right:8px;vertical-align:middle"> ' + _aEsc(label) +
    '</label></div>';
}

/* Standard modal footer: Cancel + a primary action button. */
function _aFooterCancelPrimary(primaryLabel, primaryAction, primaryPayload) {
  return '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" data-action="' + _aEsc(primaryAction) + '"' +
    (primaryPayload != null ? ' data-payload="' + _aEsc(primaryPayload) + '"' : '') +
    '>' + _aEsc(primaryLabel) + '</button>';
}

/* ---------------------------------------------------------------------------
   (A) UI PRIMITIVES — CONTRACT §9
   --------------------------------------------------------------------------- */

function toast({ type = 'info', title = '', body = '', meta = '' } = {}) {
  const stack = $('#toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML =
    '<div class="toast-title">' + _aEsc(title) + '</div>' +
    (body ? '<div class="toast-body">' + _aEsc(body) + '</div>' : '') +
    (meta ? '<div class="toast-meta">' + _aEsc(meta) + '</div>' : '');
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
  }, TOAST_TTL_MS);
}

function modal({ title = '', sub = '', body = '', footer = '' } = {}) {
  const root = $('#modal-root');
  if (!root) return;
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML =
    '<div class="modal-card">' +
      '<div class="modal-head">' +
        '<div>' +
          '<div class="modal-title">' + _aEsc(title) + '</div>' +
          (sub ? '<div class="modal-sub">' + _aEsc(sub) + '</div>' : '') +
        '</div>' +
        '<button class="drawer-close" data-action="close-modal" title="Close">✕</button>' +
      '</div>' +
      '<div class="modal-body">' + body + '</div>' +
      (footer ? '<div class="modal-foot">' + footer + '</div>' : '') +
    '</div>';
  // Scrim click closes only when the click lands on the scrim itself (inner
  // clicks have e.target !== scrim, so they never close it). We must NOT
  // stopPropagation on the card — that would block inner [data-action] buttons
  // from reaching the document-level dispatcher.
  scrim.addEventListener('click', (e) => { if (e.target === scrim) closeModal(); });
  root.innerHTML = '';
  root.appendChild(scrim);
}

function closeModal() {
  const root = $('#modal-root');
  if (root) root.innerHTML = '';
}

function openDrawer({ title = '', sub = '', body = '' } = {}) {
  const root = $('#drawer-root');
  if (!root) return;
  const scrim = document.createElement('div');
  scrim.className = 'drawer-scrim';
  scrim.innerHTML =
    '<div class="drawer">' +
      '<div class="drawer-head">' +
        '<div>' +
          '<div class="drawer-title">' + _aEsc(title) + '</div>' +
          (sub ? '<div class="drawer-sub">' + _aEsc(sub) + '</div>' : '') +
        '</div>' +
        '<button class="drawer-close" data-action="close-drawer" title="Close">✕</button>' +
      '</div>' +
      '<div class="drawer-body">' + body + '</div>' +
    '</div>';
  // Scrim-only close (inner clicks have e.target !== scrim). No stopPropagation
  // on the drawer — inner [data-action] buttons must reach the dispatcher.
  scrim.addEventListener('click', (e) => { if (e.target === scrim) closeDrawer(); });
  root.innerHTML = '';
  root.appendChild(scrim);
}

function closeDrawer() {
  const root = $('#drawer-root');
  if (root) root.innerHTML = '';
}

/* ---------------------------------------------------------------------------
   Shared EXPORT modal — used by export-pbi / export-excel / export-pdf /
   export-pptx and the chrome export buttons.
   --------------------------------------------------------------------------- */

function openExportModal(target) {
  const tgt = target || 'Export';
  const presets = ['Power BI Service', 'Excel (.xlsx)', 'PDF Pack', 'PowerPoint (.pptx)', 'Email distribution', 'SharePoint'];
  const presetSel = {
    'export-pbi': 'Power BI Service',
    'export-excel': 'Excel (.xlsx)',
    'export-pdf': 'PDF Pack',
    'export-pptx': 'PowerPoint (.pptx)',
  }[tgt] || 'Excel (.xlsx)';
  const scope = (typeof CURRENT_VIEW === 'string' && CURRENT_VIEW) ? CURRENT_VIEW : 'dashboard';
  const body =
    _aFormRow('Destination', _aSelect(presets, presetSel)) +
    _aFormRow('Scope', _aSelect([scope, 'All modules', 'Filtered selection'], scope), 'Current view export') +
    _aCheck('Include charts & visualizations', true) +
    _aCheck('Apply active filters', true) +
    _aFormRow('Recipients', _aInput('procurement@swissco.com; fpa@swissco.com', 'text', 'comma-separated'));
  modal({
    title: 'Export',
    sub: 'Queue an export of the current workspace',
    body,
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" data-action="confirm-export" data-payload="' + _aEsc(tgt) + '">Export</button>',
  });
}

/* ---------------------------------------------------------------------------
   (C) ACTIONS map — every action in CONTRACT §10 + addendum.
   --------------------------------------------------------------------------- */

const ACTIONS = {

  /* ---- chrome / confirmations -------------------------------------- */
  refresh: () => {
    toast({ type: 'info', title: 'Syncing…', body: 'Pulling S/4HANA, iRely CTRM & market feeds.' });
    setTimeout(() => toast({
      type: 'success', title: 'Data synced', body: 'Data synced · 0 errors', meta: 'S/4HANA · iRely · ICE',
    }), REFRESH_DELAY_MS);
  },

  'import-irely': () => {
    toast({ type: 'info', title: 'Importing…', body: 'Pulling positions from iRely CTRM.' });
    setTimeout(() => toast({
      type: 'success', title: 'iRely CTRM synced', body: 'Contracts & positions reconciled.', meta: '10 contracts · 7 hedges',
    }), SYNC_DELAY_MS);
  },

  'effectiveness-test': () => {
    toast({ type: 'warn', title: 'Effectiveness test', body: '1 designation failed (DES-04 74%)', meta: 'IFRS 9 corridor breach' });
    setTimeout(() => { if (typeof switchView === 'function') switchView('effectiveness'); }, NAV_DELAY_MS);
  },

  'lcm-test': () => toast({ type: 'warn', title: 'LCM / NRV test', body: '1 SKU below NRV — CK-DE-01, €25k reserve', meta: 'Cake · press by-product' }),

  'run-prospective': () => toast({ type: 'success', title: 'Prospective test', body: 'Monte Carlo prospective test passed (98.2% effective)', meta: '10,000 paths · 90d horizon' }),

  'run-scenarios': () => toast({ type: 'success', title: 'Scenarios run', body: '4 scenarios run — Bull −€4.2M / Bear +€3.9M', meta: 'Base / Bull / Bear / Tail' }),

  'open-blackline': () => toast({ type: 'info', title: 'BlackLine', body: 'Launching BlackLine via SSO…', meta: 'Month-end close' }),

  'run-test': (payload) => toast({ type: 'success', title: 'Control test passed', body: 'Control test passed · evidence archived', meta: payload ? 'Control ' + payload : 'SOX evidence repo' }),

  'sync-treasury': () => toast({ type: 'success', title: 'Treasury sync', body: '12-week outlook pushed to TMS', meta: 'Cash forecast · margin schedule' }),

  'open-s4': () => toast({ type: 'info', title: 'SAP S/4HANA', body: 'Opening SAP S/4HANA via SSO…', meta: 'Document flow' }),

  'snapshot-dashboard': () => toast({ type: 'success', title: 'Snapshot queued', body: 'Snapshot queued for email distribution', meta: 'PDF · recipients on file' }),

  'copy-commentary': () => {
    const node = $('#commentary-body');
    const text = node ? (node.innerText || node.textContent || '') : '';
    const done = () => toast({ type: 'success', title: 'Commentary copied', body: 'Executive commentary copied to clipboard.' });
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else { done(); }
    } catch (_e) { done(); }
  },

  'reset-whatif': () => {
    if (typeof resetWhatIf === 'function') resetWhatIf();
    toast({ type: 'success', title: 'What-if reset', body: 'Sliders reset to baseline', meta: 'June Rolling baseline' });
  },

  'reset-filters': () => {
    if (typeof FILTERS !== 'undefined' && typeof defaultFilters !== 'undefined') {
      FILTERS = { ...defaultFilters };
      if (typeof saveFilters === 'function') saveFilters(FILTERS);
    }
    if (typeof renderFilterChips === 'function') renderFilterChips();
    if (typeof switchView === 'function' && typeof CURRENT_VIEW === 'string') switchView(CURRENT_VIEW);
    toast({ type: 'info', title: 'Filters reset', body: 'All filters restored to defaults.' });
  },

  'clear-filter': (payload) => {
    if (payload && typeof FILTERS !== 'undefined' && typeof defaultFilters !== 'undefined') {
      FILTERS[payload] = defaultFilters[payload];
      if (typeof saveFilters === 'function') saveFilters(FILTERS);
    }
    if (typeof renderFilterChips === 'function') renderFilterChips();
    if (typeof switchView === 'function' && typeof CURRENT_VIEW === 'string') switchView(CURRENT_VIEW);
    toast({ type: 'info', title: 'Filter cleared', body: payload ? payload + ' restored to default.' : 'Filter cleared.' });
  },

  'post-activity': () => toast({ type: 'success', title: 'Comment posted', body: 'Comment posted to team channel', meta: '#cocoa-fpa' }),

  'generate-commentary': () => {
    const node = $('#commentary-body');
    if (node && typeof generateCommentary === 'function') {
      try { node.innerHTML = generateCommentary(); } catch (_e) { /* keep existing */ }
    }
    toast({ type: 'success', title: 'Commentary regenerated', body: 'Executive commentary regenerated from latest close data.' });
  },

  'send-report': (payload) => toast({ type: 'success', title: 'Report sent', body: 'Sent: ' + (payload || 'report'), meta: 'Distribution list notified' }),

  /* ---- export family (shared modal) -------------------------------- */
  'export-pbi': () => openExportModal('export-pbi'),
  'export-excel': () => openExportModal('export-excel'),
  'export-pdf': () => openExportModal('export-pdf'),
  'export-pptx': () => openExportModal('export-pptx'),
  'confirm-export': (payload) => { closeModal(); toast({ type: 'success', title: 'Export queued', body: 'Export queued → ' + (payload || 'destination'), meta: 'You will be emailed when ready.' }); },

  /* Reporting modals that reuse the shared export modal */
  'compliance-report': () => openExportModal('export-pdf'),
  'export-treasury': () => openExportModal('export-excel'),
  'export-pwc': () => openExportModal('export-pdf'),
  'export-trail': () => openExportModal('export-pdf'),

  /* ---- close / nav helpers ----------------------------------------- */
  'close-modal': () => closeModal(),
  'close-drawer': () => closeDrawer(),
  'toggle-rail': () => { const r = $('#activity-rail'); if (r) r.classList.toggle('open'); },

  /* ---- rich modals -------------------------------------------------- */
  'run-forecast': () => modalRunForecast(),
  'set-alert': () => modalSetAlert(),
  'strategy-book': () => modalStrategyBook(),
  'new-contract': () => modalNewContract(),
  'fix-ptbf': () => modalFixPtbf(),
  'new-hedge': () => modalNewHedge(),
  'new-position': () => ACTIONS['new-hedge'](),
  'var-report': () => modalVarReport(),
  'dedesignate-failed': () => modalDedesignate(),
  'cycle-count': () => modalCycleCount(),
  'reserve-calc': () => modalReserveCalc(),
  'lock-forecast': () => modalLockForecast(),
  'compare-versions': () => modalCompareVersions(),
  'branch-current': () => modalBranchCurrent(),
  'submit-approval': () => modalSubmitApproval(),
  'sign-off': () => modalSignOff(),
  'evidence-repo': () => modalEvidenceRepo(),
  'audit-requests': () => modalAuditRequests(),
  'submit-dds': () => modalSubmitDds(),
  'risk-heatmap': () => modalRiskHeatmap(),
  'liquidity-stress': () => modalLiquidityStress(),
  'save-scenario': () => modalSaveScenario(),
  'compare-scenarios': () => modalCompareScenarios(),
  'add-comment': () => modalAddComment(),
  'tag-reviewer': () => modalTagReviewer(),
  'escalate': () => modalEscalate(),
  'send-commentary': () => modalSendCommentary(),
  'view-contract': (payload) => modalViewContract(payload),

  /* ---- 13 + 1 drill drawers ---------------------------------------- */
  'drill-kpi': (payload) => drillKpi(payload),
  'drill-origin': (payload) => drillOrigin(payload),
  'drill-supplier': (payload) => drillSupplier(payload),
  'drill-sku': (payload) => drillSku(payload),
  'drill-alert': (payload) => drillAlert(payload),
  'drill-control': (payload) => drillControl(payload),
  'drill-lot': (payload) => drillLot(payload),
  'drill-task': (payload) => drillTask(payload),
  'drill-margin-call': (payload) => drillMarginCall(payload),
  'drill-activity': (payload) => drillActivity(payload),
  'drill-recon': (payload) => drillRecon(payload),
  'drill-je': (payload) => drillJe(payload),
  'drill-driver': (payload) => drillDriver(payload),
  'drill-version': (payload) => drillVersion(payload),

  /* card-action segment toggle is handled directly in the dispatcher. */
  'card-toggle': () => { /* handled in dispatcher */ },
};

/* ---------------------------------------------------------------------------
   RICH MODAL FACTORIES
   --------------------------------------------------------------------------- */

function modalRunForecast() {
  const v = (DATA.whatIf && DATA.whatIf.baseline) || {};
  const versions = (DATA.filterTaxonomy && DATA.filterTaxonomy.versions) || ['v5 · June Rolling (CURRENT)'];
  const body = '<div class="form-grid">' +
    _aFormRow('ICE NY (USD/t)', _aInput(v.nyPx != null ? v.nyPx : 7842, 'number')) +
    _aFormRow('ICE LDN (GBP/t)', _aInput(v.ldnPx != null ? v.ldnPx : 5418, 'number')) +
    _aFormRow('EUR/USD', _aInput(v.eurusd != null ? v.eurusd : 1.085, 'number')) +
    _aFormRow('CIV differential ($/t)', _aInput(v.civDiff != null ? v.civDiff : 240, 'number')) +
    _aFormRow('Monthly volume (MT)', _aInput(v.volume != null ? v.volume : 6400, 'number')) +
    _aFormRow('Save as version', _aSelect(['New rolling version', ...versions])) +
    '</div>';
  modal({
    title: 'Run Forecast',
    sub: 'Re-run the rolling forecast with adjusted market drivers',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" data-action="confirm-run-forecast">Run forecast</button>',
  });
}

function modalSetAlert() {
  const body = '<div class="form-grid">' +
    _aFormRow('Instrument', _aSelect(['ICE Cocoa NY', 'ICE Cocoa LDN', 'EUR/USD', 'GBP/USD', 'Baltic Dry'])) +
    _aFormRow('Condition', _aSelect(['Crosses above', 'Crosses below', 'Daily move >', 'Hedge ratio <'])) +
    _aFormRow('Threshold', _aInput(8300, 'number', 'e.g. 8300')) +
    _aFormRow('Notify via', _aSelect(['Email', 'Slack #cocoa-fpa', 'SMS', 'Teams'])) +
    '</div>';
  modal({
    title: 'Set Market Alert',
    sub: 'Trigger a notification when the market hits a level',
    body,
    footer: _aFooterCancelPrimary('Create alert', 'confirm-set-alert'),
  });
}

function modalStrategyBook() {
  const body = '<div class="form-grid">' +
    _aFormRow('Coverage target (Q3 %)', _aInput(80, 'number')) +
    _aFormRow('Risk limit (VaR €M)', _aInput(2.0, 'number')) +
    _aFormRow('Instruments', _aSelect(['ICE NY futures', 'ICE LDN futures', 'NY + LDN basket', 'Options collar'])) +
    _aFormRow('Rebalance cadence', _aSelect(['Weekly', 'Bi-weekly', 'Monthly'])) +
    '</div>';
  modal({
    title: 'Hedge Strategy Book',
    sub: 'Define the hedging policy parameters for the desk',
    body,
    footer: _aFooterCancelPrimary('Save strategy', 'confirm-strategy'),
  });
}

function modalNewContract() {
  const suppliers = (DATA.filterTaxonomy && DATA.filterTaxonomy.suppliers) || ['All suppliers'];
  const origins = (DATA.filterTaxonomy && DATA.filterTaxonomy.origins) || ['All origins'];
  const body = '<div class="form-grid">' +
    _aFormRow('Supplier', _aSelect(suppliers.filter(s => s !== 'All suppliers'))) +
    _aFormRow('Origin', _aSelect(origins.filter(o => o !== 'All origins'))) +
    _aFormRow('Volume (MT)', _aInput(500, 'number')) +
    _aFormRow('Pricing basis', _aSelect(['PTBF (price to be fixed)', 'Flat price'])) +
    _aFormRow('Certification', _aSelect(['RA', 'FT', 'ORG', '—'])) +
    '</div>';
  modal({
    title: 'New Physical Contract',
    sub: 'Register a new origin purchase contract',
    body,
    footer: _aFooterCancelPrimary('Create contract', 'confirm-new-contract'),
  });
}

function modalFixPtbf() {
  const unpriced = (DATA.contracts || []).filter(c => String(c.status).toUpperCase() === 'UNPRICED');
  let rows = unpriced.map(c =>
    '<div class="kv">' +
      '<span class="kv-k">' + _aEsc(c.id) + ' · ' + _aEsc(c.origin) + ' · ' + _aInt(c.mt) + ' MT · ' + _aEsc(c.execMonth) + '</span>' +
      '<span class="kv-v mono">' +
        '<span class="badge badge-neg">UNPRICED</span> ' +
        '<button class="btn btn-sm" data-action="confirm-fix-ptbf" data-payload="' + _aEsc(c.id) + '">Fix</button>' +
      '</span>' +
    '</div>'
  ).join('');
  if (!rows) rows = '<div class="kv"><span class="kv-k">No unpriced contracts</span><span class="kv-v mono pos">All fixed</span></div>';
  const body =
    '<div class="form-help">Unpriced PTBF contracts are exposed to futures moves until fixed. Fix against the current ICE curve.</div>' +
    '<div class="section-title">Unpriced contracts (' + unpriced.length + ')</div>' +
    '<div class="kv-list">' + rows + '</div>';
  modal({ title: 'Fix PTBF Contracts', sub: 'Price-to-be-fixed exposure', body, footer: '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' });
}

function modalNewHedge() {
  const body = '<div class="form-grid">' +
    _aFormRow('Book', _aSelect(['CC NY Q3', 'CC NY Q4', 'C LDN Q3', 'C LDN Q4', 'FX EURUSD', 'FX GBPUSD'])) +
    _aFormRow('Side', _aSelect(['LONG', 'SHORT'])) +
    _aFormRow('Contracts (lots)', _aInput(50, 'number')) +
    _aFormRow('Expiry', _aSelect(['SEP26', 'DEC26', 'MAR27', 'MAY27'])) +
    _aFormRow('Order type', _aSelect(['Market', 'Limit', 'Stop'])) +
    _aFormRow('IFRS 9 designation', _aSelect(['Cash flow hedge', 'Net investment hedge', 'Economic (undesignated)'])) +
    '</div>';
  modal({
    title: 'New Hedge Position',
    sub: 'Stage a futures order and IFRS 9 designation',
    body,
    footer: _aFooterCancelPrimary('Place order', 'confirm-new-hedge'),
  });
}

function modalVarReport() {
  const body = _aQstatGrid([
    { label: 'Portfolio VaR (1d 99%)', value: '€1.8M', cls: 'warn' },
    { label: 'Expected Shortfall', value: '€2.4M', cls: 'neg' },
    { label: 'Stress (2024 spike)', value: '€6.1M', cls: 'neg' },
    { label: 'Diversification benefit', value: '22%', cls: 'pos' },
  ]) +
  '<div class="section-title">Methodology</div>' +
  _aKvList([
    { k: 'Confidence / horizon', v: '99% · 1-day' },
    { k: 'Method', v: 'Historical simulation (500d)' },
    { k: 'Books in scope', v: 'CC NY · C LDN · FX' },
    { k: 'Limit utilization', v: '90% of €2.0M' },
  ]);
  modal({
    title: 'Value at Risk Report',
    sub: 'Hedge book risk decomposition',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' +
      '<button class="btn btn-primary" data-action="export-pdf">Export PDF</button>',
  });
}

function modalDedesignate() {
  const ineffective = (DATA.hedgeEffectiveness && DATA.hedgeEffectiveness.pnlImpact && DATA.hedgeEffectiveness.pnlImpact.ineffectiveToPnl) || -96000;
  const body =
    _aQstatGrid([
      { label: 'Hedge', value: 'HG-7006', cls: 'neg' },
      { label: 'Designation', value: 'DES-04', cls: 'neg' },
      { label: 'Hedge ratio', value: '74%', cls: 'neg' },
      { label: 'P&L impact', value: _aEur(Math.abs(ineffective)), cls: 'neg' },
    ]) +
    '<div class="form-help">DES-04 (C LDN Q4) effectiveness fell to 74% — outside the IFRS 9 80–125% corridor. De-designating recycles the ineffective portion to P&L and stops hedge accounting prospectively.</div>' +
    '<div class="section-title">Impact</div>' +
    _aKvList([
      { k: 'Ineffective portion → P&L', v: _aEur(Math.abs(ineffective)), cls: 'neg' },
      { k: 'OCI balance frozen', v: 'Reclassed on settlement' },
      { k: 'Prospective accounting', v: 'Fair value through P&L' },
      { k: 'Approval required', v: 'Treasury + Group Controller' },
    ]) +
    '<div class="section-title">Approval workflow</div>' +
    _aTimeline([
      { cls: 'pos', body: 'Effectiveness test flagged DES-04 (74%)', time: 'auto' },
      { cls: 'warn', body: 'Pending: Treasury sign-off', time: 'now' },
      { cls: 'muted', body: 'Pending: Group Controller approval', time: '—' },
      { cls: 'muted', body: 'Post de-designation JE', time: '—' },
    ]);
  modal({
    title: 'De-designate Failed Hedge',
    sub: 'HG-7006 · DES-04 · IFRS 9 corridor breach',
    body,
    footer: _aFooterCancelPrimary('De-designate & route', 'confirm-dedesignate'),
  });
}

function modalCycleCount() {
  const body = '<div class="form-grid">' +
    _aFormRow('Location', _aSelect(['Hamburg', 'Antwerp', 'Plant DE-01', 'Plant CH-02', 'In-Transit'])) +
    _aFormRow('SKUs in scope', _aSelect(['All beans', 'All liquor', 'All butter/powder', 'Full warehouse'])) +
    _aFormRow('Count date', _aInput('2026-06-18', 'date')) +
    _aFormRow('Counter', _aSelect(['Warehouse Team', 'A. Brunner', 'L. Meier', '3rd-party (SGS)'])) +
    _aFormRow('Tolerance (%)', _aInput(2, 'number')) +
    '</div>';
  modal({
    title: 'Schedule Cycle Count',
    sub: 'Physical inventory verification',
    body,
    footer: _aFooterCancelPrimary('Schedule count', 'confirm-cycle-count'),
  });
}

function modalReserveCalc() {
  const inv = DATA.inventory || [];
  let flagged = 0;
  const rows = inv.map(it => {
    const nrv = Math.round(it.wac * 0.98);
    const below = nrv < it.wac;
    const reserveK = below ? Math.round((it.wac - nrv) * it.mt / 1000) : 0;
    if (below) flagged++;
    return '<tr class="' + (below ? 'row-click' : '') + '">' +
      '<td class="cell-strong">' + _aEsc(it.sku) + '</td>' +
      '<td>' + _aEsc(it.form) + '</td>' +
      '<td class="num">' + _aInt(it.mt) + '</td>' +
      '<td class="num">' + _aEur(it.wac) + '</td>' +
      '<td class="num">' + _aEur(nrv) + '</td>' +
      '<td class="num ' + (below ? 'neg' : 'pos') + '">' + (below ? '−' + _aEur(reserveK) + 'k' : 'OK') + '</td>' +
      '</tr>';
  }).join('');
  const body =
    '<div class="form-help">Lower-of-cost-or-market: NRV estimated at WAC × 0.98 (net selling price less costs to complete & sell). Reserve booked where NRV &lt; WAC.</div>' +
    '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>SKU</th><th>Form</th><th class="th-num">MT</th><th class="th-num">WAC €/t</th><th class="th-num">NRV €/t</th><th class="th-num">Reserve</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>' +
    '<div class="section-title">' + flagged + ' SKU(s) below NRV</div>';
  modal({
    title: 'LCM / NRV Reserve Calculator',
    sub: 'Inventory write-down test',
    body,
    footer: _aFooterCancelPrimary('Book reserve JE', 'confirm-reserve'),
  });
}

function modalLockForecast() {
  const cur = (DATA.forecastVersions || []).find(v => String(v.status).toUpperCase() === 'CURRENT') || { id: 'v5', name: 'June Rolling' };
  const body =
    '<div class="form-help">Locking <b>' + _aEsc(cur.id) + ' · ' + _aEsc(cur.name) + '</b> freezes assumptions and prevents further edits. Downstream Power BI and the exec pack will reference this version.</div>' +
    '<div class="section-title">Implications</div>' +
    _aKvList([
      { k: 'Version frozen', v: _aEsc(cur.id) + ' · ' + _aEsc(cur.name) },
      { k: 'Edits', v: 'Disabled (branch to amend)' },
      { k: 'Downstream', v: 'Power BI · Exec pack' },
      { k: 'Status → FROZEN', v: 'Audit trail recorded' },
    ]) +
    '<div class="form-grid">' +
      _aFormRow('Reason', _aInput('', 'text', 'e.g. June close locked for board pack')) +
      _aFormRow('Approver', _aSelect(['FP&A Lead', 'Group Controller', 'CFO'])) +
      _aFormRow('Type LOCK to confirm', _aInput('', 'text', 'LOCK')) +
    '</div>';
  modal({
    title: 'Lock Forecast Version',
    sub: cur.id + ' · ' + cur.name,
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-danger" data-action="confirm-lock-forecast">Lock version</button>',
  });
}

function modalCompareVersions() {
  const versions = (DATA.forecastVersions || []).map(v => ({ value: v.id, label: v.id + ' · ' + v.name }));
  const diff = DATA.versionDiff || [];
  const rows = diff.map(d => {
    const cls = d.delta > 0 ? 'pos' : (d.delta < 0 ? 'neg' : 'muted');
    const deltaStr = (typeof d.delta === 'number' && Math.abs(d.delta) < 1)
      ? _aNum(d.delta, 3)
      : (d.delta >= 0 ? '+' : '−') + _aInt(Math.abs(d.delta));
    return '<tr>' +
      '<td class="cell-strong">' + _aEsc(d.assumption) + '</td>' +
      '<td class="num">' + _aEsc(d.v1) + '</td>' +
      '<td class="num">' + _aEsc(d.v2) + '</td>' +
      '<td class="num">' + _aEsc(d.v3) + '</td>' +
      '<td class="num ' + cls + '">' + deltaStr + '</td>' +
      '</tr>';
  }).join('');
  const body =
    '<div class="form-grid">' +
      _aFormRow('Base version', _aSelect(versions, 'v4')) +
      _aFormRow('Compare version', _aSelect(versions, 'v5')) +
    '</div>' +
    '<div class="section-title">Assumption diff (v1 → v2 → v3)</div>' +
    '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Assumption</th><th class="th-num">v1</th><th class="th-num">v2</th><th class="th-num">v3</th><th class="th-num">Δ</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>' +
    '<div class="section-title">FY impact</div>' +
    _aQstatGrid([
      { label: 'PPV Δ vs base', value: '+€0.05M', cls: 'warn' },
      { label: 'Landed Δ', value: '+€22/t', cls: 'warn' },
      { label: 'Hedge cov Δ', value: '−2pp', cls: 'neg' },
      { label: 'Net FY spend', value: '+€0.6M', cls: 'warn' },
    ]);
  modal({
    title: 'Compare Forecast Versions',
    sub: 'Side-by-side assumption diff',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' +
      '<button class="btn btn-primary" data-action="export-excel">Export diff</button>',
  });
}

function modalBranchCurrent() {
  const cur = (DATA.forecastVersions || []).find(v => String(v.status).toUpperCase() === 'CURRENT') || { id: 'v5', name: 'June Rolling' };
  const body = '<div class="form-grid">' +
    _aFormRow('New version name', _aInput('', 'text', 'e.g. July Rolling')) +
    _aFormRow('Branched from', _aInput(cur.id + ' · ' + cur.name, 'text'), 'Read-only parent') +
    _aFormRow('Purpose', _aSelect(['Monthly roll', 'Scenario sensitivity', 'Board ask', 'Re-forecast'])) +
    '</div>' +
    _aCheck('Lock parent version on branch', true);
  modal({
    title: 'Branch Current Version',
    sub: 'Create an editable copy from ' + cur.id,
    body,
    footer: _aFooterCancelPrimary('Create branch', 'confirm-branch'),
  });
}

function modalSubmitApproval() {
  const body =
    '<div class="form-help">Route the current forecast version through the approval chain. Each approver is notified in sequence.</div>' +
    '<div class="section-title">Approval chain</div>' +
    _aTimeline([
      { cls: 'pos', body: 'Prepared — You (FP&A)', time: 'today' },
      { cls: 'warn', body: 'Review — FP&A Lead', time: 'pending' },
      { cls: 'muted', body: 'Approve — Group Controller', time: '—' },
      { cls: 'muted', body: 'Sign-off — CFO', time: '—' },
    ]) +
    '<div class="form-grid">' +
      _aFormRow('Add note', _aInput('', 'text', 'Context for reviewers')) +
      _aFormRow('Priority', _aSelect(['Normal', 'High', 'Board deadline'])) +
    '</div>';
  modal({
    title: 'Submit for Approval',
    sub: 'Forecast sign-off routing',
    body,
    footer: _aFooterCancelPrimary('Submit', 'confirm-submit-approval'),
  });
}

function modalSignOff() {
  const open = (DATA.closeChecklist || []).filter(t => String(t.status).toUpperCase() !== 'DONE');
  const tl = open.map(t => ({
    cls: _aStatusClass(t.status),
    body: t.task + ' — ' + t.owner + ' (' + t.due + ')',
    time: String(t.status).replace('_', ' '),
  }));
  const body =
    '<div class="form-help">' + open.length + ' close task(s) outstanding. Sign-off requires all tasks DONE — remind owners or override with approval.</div>' +
    '<div class="section-title">Outstanding tasks</div>' +
    (tl.length ? _aTimeline(tl) : '<div class="form-help pos">All close tasks complete.</div>');
  modal({
    title: 'Month-End Sign-Off',
    sub: 'June 2026 close',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-ghost" data-action="confirm-remind">Remind owners</button>' +
      '<button class="btn btn-primary" data-action="confirm-signoff">Sign off close</button>',
  });
}

function modalEvidenceRepo() {
  const controls = (DATA.controls || []);
  const rows = controls.map(c =>
    '<tr>' +
      '<td class="cell-strong">' + _aEsc(c.id) + '</td>' +
      '<td>' + _aEsc(c.name) + '</td>' +
      '<td>' + _aEsc(c.lastTest) + '</td>' +
      '<td><span class="badge badge-' + _aStatusClass(c.status) + '">' + _aEsc(c.status) + '</span></td>' +
    '</tr>'
  ).join('');
  const body =
    '<div class="form-help">Control evidence registry — workpapers, screenshots and test logs archived per SOX control.</div>' +
    '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Control</th><th>Name</th><th>Last test</th><th>Status</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>';
  modal({
    title: 'Control Evidence Repository',
    sub: controls.length + ' controls archived',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' +
      '<button class="btn btn-primary" data-action="export-excel">Export register</button>',
  });
}

function modalAuditRequests() {
  const requests = [
    { id: 'PBC-001', desc: 'Hedge designation documentation (Q2)', owner: 'You', due: '2026-06-20', status: 'OPEN' },
    { id: 'PBC-002', desc: 'PPV variance reconciliation to GL', owner: 'You', due: '2026-06-22', status: 'OPEN' },
    { id: 'PBC-003', desc: 'Inventory cycle-count results', owner: 'Warehouse', due: '2026-06-24', status: 'IN_PROGRESS' },
    { id: 'PBC-004', desc: 'Supplier master change log', owner: 'MDM Team', due: '2026-06-19', status: 'OPEN' },
  ];
  const rows = requests.map(r =>
    '<tr>' +
      '<td class="cell-strong">' + _aEsc(r.id) + '</td>' +
      '<td>' + _aEsc(r.desc) + '</td>' +
      '<td>' + _aEsc(r.owner) + '</td>' +
      '<td class="num">' + _aEsc(r.due) + '</td>' +
      '<td><span class="badge badge-' + _aStatusClass(r.status) + '">' + _aEsc(r.status.replace('_', ' ')) + '</span></td>' +
    '</tr>'
  ).join('');
  const body =
    '<div class="form-help">Open PwC prepared-by-client (PBC) requests for the FY26 interim audit.</div>' +
    '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Ref</th><th>Request</th><th>Owner</th><th class="th-num">Due</th><th>Status</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>';
  modal({
    title: 'PwC Audit Requests',
    sub: '4 open PBC items',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' +
      '<button class="btn btn-primary" data-action="export-pwc">Submit pack</button>',
  });
}

function modalSubmitDds() {
  const suppliers = (DATA.eudr && DATA.eudr.bySupplier || []).map(s => s.supplier);
  const body = '<div class="form-grid">' +
    _aFormRow('Supplier', _aSelect(suppliers.length ? suppliers : ['—'])) +
    _aFormRow('Volume (MT)', _aInput(500, 'number')) +
    _aFormRow('Geo polygons', _aInput(120, 'number', 'plot count')) +
    _aFormRow('Risk class', _aSelect(['Low', 'Standard', 'High'])) +
    _aFormRow('Evidence pack', _aSelect(['GPS + deforestation scan', 'GPS only', 'Third-party attestation'])) +
    '</div>';
  modal({
    title: 'Submit EUDR Due-Diligence Statement',
    sub: 'TRACES DDS filing',
    body,
    footer: _aFooterCancelPrimary('Submit DDS', 'confirm-dds'),
  });
}

function modalRiskHeatmap() {
  const sup = (DATA.eudr && DATA.eudr.bySupplier) || [];
  const dims = ['Geo', 'DDS', 'Cert', 'Deforest', 'Overall'];
  const cellCls = (pct) => pct >= 75 ? 'pos' : (pct >= 50 ? 'warn' : 'neg');
  const head = '<tr><th>Supplier</th>' + dims.map(d => '<th class="th-num">' + d + '</th>').join('') + '</tr>';
  const rows = sup.map(s => {
    const geo = s.geoPct;
    const dds = String(s.dds).toUpperCase() === 'SUBMITTED' ? 95 : (String(s.dds).toUpperCase() === 'DRAFT' ? 55 : 20);
    const cert = s.cert && s.cert !== '—' ? 80 : 30;
    const deforest = 100 - (s.risk || 0);
    const overall = Math.round((geo + dds + cert + deforest) / 4);
    const vals = [geo, dds, cert, deforest, overall];
    return '<tr>' +
      '<td class="cell-strong">' + _aEsc(s.supplier) + '</td>' +
      vals.map(v => '<td class="num ' + cellCls(v) + '">' + _aPct(v, 0) + '</td>').join('') +
      '</tr>';
  }).join('');
  const body =
    '<div class="form-help">Supplier risk across 5 EUDR dimensions. Green ≥75% · amber 50–74% · red &lt;50%.</div>' +
    '<div class="table-wrap"><table class="table">' +
      '<thead>' + head + '</thead><tbody>' + rows + '</tbody>' +
    '</table></div>';
  modal({
    title: 'Supplier Risk Heatmap',
    sub: sup.length + ' suppliers · 5 dimensions',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' +
      '<button class="btn btn-primary" data-action="export-excel">Export matrix</button>',
  });
}

function modalLiquidityStress() {
  const body = _aQstatGrid([
    { label: 'Worst-case 12w outflow', value: '€106.4M', cls: 'neg' },
    { label: 'Facility headroom', value: '€34.0M', cls: 'warn' },
    { label: 'Peak weekly margin', value: '€2.4M', cls: 'warn' },
    { label: 'Recommendation', value: 'Extend RCF €25M', cls: 'info' },
  ]) +
  '<div class="section-title">Stress assumptions</div>' +
  _aKvList([
    { k: 'NY shock', v: '+15% (€8,300 → €9,545)' },
    { k: 'Margin multiplier', v: '1.8× variation margin' },
    { k: 'Freight / Baltic', v: '+20%' },
    { k: 'Closeout timing', v: 'Pulled forward 1 week' },
  ]) +
  '<div class="form-help">Under the combined stress, peak cumulative outflow exceeds committed facilities in week 9 — recommend extending the revolving credit facility by €25M.</div>';
  modal({
    title: 'Liquidity Stress Test',
    sub: '12-week cash outflow under combined shock',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' +
      '<button class="btn btn-primary" data-action="export-treasury">Export to TMS</button>',
  });
}

function modalSaveScenario() {
  const body = '<div class="form-grid">' +
    _aFormRow('Scenario name', _aInput('', 'text', 'e.g. NY +10% / EUR weak')) +
    _aFormRow('Description', _aInput('', 'text', 'Short description')) +
    _aFormRow('Tag', _aSelect(['Bull', 'Bear', 'Base', 'Tail', 'Custom'])) +
    '</div>';
  modal({
    title: 'Save What-If Scenario',
    sub: 'Persist the current slider state',
    body,
    footer: _aFooterCancelPrimary('Save scenario', 'confirm-save-scenario'),
  });
}

function modalCompareScenarios() {
  const saved = [
    { name: 'Base', tag: 'Base', ny: 7842, ppv: 1.07, landed: 8142 },
    { name: 'Bull +10%', tag: 'Bull', ny: 8650, ppv: 4.20, landed: 8720 },
    { name: 'Bear −9%', tag: 'Bear', ny: 7100, ppv: -3.90, landed: 7640 },
    { name: 'Tail +20%', tag: 'Tail', ny: 9400, ppv: -8.70, landed: 9180 },
  ];
  const rows = saved.map(s => {
    const cls = s.ppv > 0 ? 'neg' : (s.ppv < 0 ? 'pos' : 'muted');
    return '<tr>' +
      '<td class="cell-strong">' + _aEsc(s.name) + '</td>' +
      '<td><span class="badge badge-' + _aStatusClass(s.tag.toUpperCase()) + '">' + _aEsc(s.tag) + '</span></td>' +
      '<td class="num">' + _aUsd(s.ny) + '</td>' +
      '<td class="num ' + cls + '">' + (s.ppv >= 0 ? '+' : '−') + '€' + Math.abs(s.ppv).toFixed(2) + 'M</td>' +
      '<td class="num">' + _aEur(s.landed) + '</td>' +
      '</tr>';
  }).join('');
  const body =
    '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Scenario</th><th>Tag</th><th class="th-num">NY $/t</th><th class="th-num">PPV Δ</th><th class="th-num">Landed €/t</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>';
  modal({
    title: 'Compare Scenarios',
    sub: saved.length + ' saved scenarios',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' +
      '<button class="btn btn-primary" data-action="export-excel">Export comparison</button>',
  });
}

function modalAddComment() {
  const body = '<div class="form-grid">' +
    _aFormRow('Comment', _aInput('', 'text', 'Add context or a question…')) +
    _aFormRow('Severity', _aSelect(['Info', 'Watch', 'Critical'])) +
    _aFormRow('Notify', _aSelect(['FP&A team', 'Treasury', 'Accounting', 'Procurement', 'CFO'])) +
    '</div>';
  modal({
    title: 'Add Comment',
    sub: 'Annotate the variance trail',
    body,
    footer: _aFooterCancelPrimary('Post comment', 'confirm-add-comment'),
  });
}

function modalTagReviewer() {
  const body = '<div class="form-grid">' +
    _aFormRow('Reviewer', _aSelect(['Sophie Klein (FP&A)', 'Anja Brunner (Accounting)', 'Marc Favre (Treasury)', 'Elena Rossi (Procurement)'])) +
    _aFormRow('Priority', _aSelect(['Normal', 'High', 'Urgent'])) +
    _aFormRow('Due date', _aInput('2026-06-20', 'date')) +
    '</div>';
  modal({
    title: 'Tag Reviewer',
    sub: 'Assign this item for review',
    body,
    footer: _aFooterCancelPrimary('Assign', 'confirm-tag-reviewer'),
  });
}

function modalEscalate() {
  const body = '<div class="form-grid">' +
    _aFormRow('Escalate to', _aSelect(['Group Controller', 'CFO', 'Treasury Head', 'Procurement Director'])) +
    _aFormRow('Reason', _aSelect(['Effectiveness breach', 'Unpriced exposure', 'NRV write-down', 'Reconciliation gap', 'EUDR risk'])) +
    _aFormRow('Summary', _aInput('', 'text', 'One-line summary')) +
    '</div>';
  modal({
    title: 'Escalate Issue',
    sub: 'Route to senior stakeholder',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-danger" data-action="confirm-escalate">Escalate</button>',
  });
}

function modalSendCommentary() {
  let preview = 'June close commentary unavailable.';
  if (typeof generateCommentary === 'function') {
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = generateCommentary();
      preview = (tmp.innerText || tmp.textContent || preview).trim();
    } catch (_e) { /* fall back to default */ }
  } else {
    const node = $('#commentary-body');
    if (node) preview = (node.innerText || node.textContent || preview).trim();
  }
  const body =
    '<div class="form-grid">' +
      _aFormRow('To', _aInput('cfo@swissco.com', 'text')) +
      _aFormRow('Subject', _aInput('Cocoa Procurement — June 2026 Close Commentary', 'text')) +
    '</div>' +
    '<div class="section-title">Email body preview</div>' +
    '<div class="news-body" style="white-space:pre-wrap;max-height:240px;overflow:auto">' + _aEsc(preview) + '</div>';
  modal({
    title: 'Send Commentary to CFO',
    sub: 'Executive summary email',
    body,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" data-action="confirm-send-commentary">Send to CFO</button>',
  });
}

function modalViewContract(id) {
  const c = (DATA.contracts || []).find(x => x.id === id);
  if (!c) { toast({ type: 'error', title: 'Not found', body: 'Contract ' + (id || '') + ' not found.' }); return; }
  const unpriced = String(c.status).toUpperCase() === 'UNPRICED';
  const body =
    _aQstatGrid([
      { label: 'Volume', value: _aInt(c.mt) + ' MT' },
      { label: c.basis === 'PTBF' ? 'Differential' : 'Flat price', value: unpriced ? '+' + _aUsd(c.diff) + '/t' : _aEur(c.price) + '/t', cls: unpriced ? 'warn' : 'pos' },
      { label: 'Status', value: c.status, cls: _aStatusClass(c.status) },
      { label: 'Hedged', value: _aPct(c.hedgePct, 0), cls: c.hedgePct >= 80 ? 'pos' : (c.hedgePct > 0 ? 'warn' : 'neg') },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Contract', v: c.id },
      { k: 'Origin', v: c.origin },
      { k: 'Supplier', v: c.supplier },
      { k: 'Basis', v: c.basis },
      { k: 'Execution month', v: c.execMonth },
      { k: 'Differential', v: '+$' + c.diff + '/t' },
      { k: 'Certification', v: c.cert },
      { k: 'Linked PO', v: c.po },
      { k: 'iRely CTRM', v: c.irely },
    ]);
  const footer =
    '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' +
    (unpriced ? '<button class="btn btn-primary" data-action="fix-ptbf">Fix PTBF</button>' :
      '<button class="btn btn-primary" data-action="export-excel">Export</button>');
  modal({ title: 'Contract ' + c.id, sub: c.supplier + ' · ' + c.origin + ' · ' + c.execMonth, body, footer });
}

/* ---------------------------------------------------------------------------
   (D) 13 + 1 DRILL DRAWERS — CONTRACT §11 anatomy.
   --------------------------------------------------------------------------- */

function drillKpi(key) {
  const k = (DATA.kpis || {})[key];
  if (!k) { toast({ type: 'error', title: 'No KPI', body: 'Unknown KPI: ' + (key || '') }); return; }
  const sign = (typeof signClass === 'function') ? signClass(k.chgPct, !!k.invert) : (k.chgPct >= 0 ? 'pos' : 'neg');
  const valStr = (typeof k.value === 'number') ? _aNum(k.value, Number.isInteger(k.value) ? 0 : 2) : String(k.value);
  const body =
    _aQstatGrid([
      { label: 'Value', value: valStr + ' ' + (k.unit || ''), cls: 'accent' },
      { label: 'Change', value: _aSignedPct(k.chgPct), cls: sign },
      { label: 'Context', value: k.sub || '—' },
      { label: 'Trend', value: k.chgPct >= 0 ? '▲' : '▼', cls: sign },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Metric', v: k.label },
      { k: 'Current', v: valStr + ' ' + (k.unit || '') },
      { k: 'MoM change', v: _aSignedPct(k.chgPct), cls: sign },
      { k: 'Benchmark', v: k.sub || '—' },
    ]) +
    _aTimeline([
      { cls: 'pos', body: 'June MTD refreshed — ' + valStr + ' ' + (k.unit || ''), time: 'now' },
      { cls: 'info', body: 'May actual recorded', time: '−1mo' },
      { cls: 'muted', body: 'Budget baseline set', time: 'FY27' },
    ]).replace('<div class="timeline">', '<div class="section-title">History</div><div class="timeline">');
  openDrawer({
    title: k.label,
    sub: 'KPI drill · June 2026 MTD',
    body: body + _aQuickActions([
      { action: 'run-forecast', label: 'Re-forecast' },
      { action: 'export-excel', label: 'Export' },
      { action: 'add-comment', label: 'Comment' },
      { action: 'generate-commentary', label: 'Commentary' },
    ]),
  });
}

function drillOrigin(code) {
  const o = (DATA.originSpend || []).find(x => x.code === code);
  if (!o) { toast({ type: 'error', title: 'No origin', body: 'Unknown origin: ' + (code || '') }); return; }
  const body =
    _aQstatGrid([
      { label: 'Spend MTD', value: _aEurM(o.spendM * 1e6, 1), cls: 'accent' },
      { label: 'Volume', value: _aInt(o.mt) + ' MT' },
      { label: 'Certified', value: _aPct(o.certPct, 0), cls: o.certPct >= 70 ? 'pos' : 'warn' },
      { label: 'Premium', value: _aUsd(o.premiumUsd) + '/t', cls: 'warn' },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Origin', v: o.name + ' (' + o.code + ')' },
      { k: 'Spend', v: '€' + _aNum(o.spendM, 1) + 'M' },
      { k: 'Volume', v: _aInt(o.mt) + ' MT' },
      { k: 'Certification rate', v: _aPct(o.certPct, 0) },
      { k: 'Origin premium', v: '$' + o.premiumUsd + '/t' },
    ]) +
    '<div class="section-title">Origin chain</div>' +
    _aTimeline([
      { cls: 'pos', body: 'Farm-gate purchase · ' + o.name, time: 'origin' },
      { cls: 'info', body: 'Upcountry → port aggregation', time: '+7d' },
      { cls: 'info', body: 'FOB shipment booked', time: '+14d' },
      { cls: 'warn', body: 'In-transit to EU plant', time: '+30d' },
    ]);
  openDrawer({
    title: o.name,
    sub: 'Origin spend drill · ' + o.code,
    body: body + _aQuickActions([
      { action: 'drill-supplier', payload: 'Barry Callebaut Sourcing', label: 'Suppliers' },
      { action: 'submit-dds', label: 'EUDR DDS' },
      { action: 'export-excel', label: 'Export' },
      { action: 'add-comment', label: 'Comment' },
    ]),
  });
}

function drillSupplier(name) {
  const s = (DATA.eudr && DATA.eudr.bySupplier || []).find(x => x.supplier === name);
  if (!s) { toast({ type: 'error', title: 'No supplier', body: 'Unknown supplier: ' + (name || '') }); return; }
  const body =
    _aQstatGrid([
      { label: 'Geo coverage', value: _aPct(s.geoPct, 0), cls: s.geoPct >= 75 ? 'pos' : (s.geoPct >= 50 ? 'warn' : 'neg') },
      { label: 'DDS status', value: s.dds, cls: _aStatusClass(s.dds) },
      { label: 'Risk score', value: s.risk, cls: s.risk <= 25 ? 'pos' : (s.risk <= 50 ? 'warn' : 'neg') },
      { label: 'Certification', value: s.cert, cls: s.cert !== '—' ? 'pos' : 'muted' },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Supplier', v: s.supplier },
      { k: 'Origin', v: s.origin },
      { k: 'Geo coverage', v: _aPct(s.geoPct, 0) },
      { k: 'DDS', v: s.dds },
      { k: 'Certification', v: s.cert },
      { k: 'Risk score', v: String(s.risk) },
      { k: 'Last audit', v: s.lastAudit },
    ]) +
    '<div class="section-title">Audit history</div>' +
    _aTimeline([
      { cls: _aStatusClass(s.dds), body: 'DDS status: ' + s.dds, time: 'current' },
      { cls: 'info', body: 'Last on-site audit', time: s.lastAudit },
      { cls: s.geoPct >= 75 ? 'pos' : 'warn', body: 'Geo coverage ' + s.geoPct + '%', time: 'latest' },
    ]);
  openDrawer({
    title: s.supplier,
    sub: 'Supplier drill · ' + s.origin,
    body: body + _aQuickActions([
      { action: 'submit-dds', label: 'Submit DDS' },
      { action: 'risk-heatmap', label: 'Risk matrix' },
      { action: 'escalate', label: 'Escalate' },
      { action: 'add-comment', label: 'Comment' },
    ]),
  });
}

function drillSku(sku) {
  const p = (DATA.ppvDetail || []).find(x => x.sku === sku);
  const inv = (DATA.inventory || []).find(x => x.sku === sku);
  if (!p && !inv) { toast({ type: 'error', title: 'No SKU', body: 'Unknown SKU: ' + (sku || '') }); return; }
  let qstat, attrs, label, sub;
  if (p) {
    const varEur = p.actEur - p.stdEur;
    const totalK = Math.round(varEur * p.mt / 1000);
    qstat = _aQstatGrid([
      { label: 'Std €/t', value: _aEur(p.stdEur) },
      { label: 'Act €/t', value: _aEur(p.actEur), cls: varEur >= 0 ? 'neg' : 'pos' },
      { label: 'Var €/t', value: (varEur >= 0 ? '+' : '−') + _aEur(Math.abs(varEur)), cls: varEur >= 0 ? 'neg' : 'pos' },
      { label: 'Total var', value: (totalK >= 0 ? '+' : '−') + _aEur(Math.abs(totalK)) + 'k', cls: totalK >= 0 ? 'neg' : 'pos' },
    ]);
    attrs = _aKvList([
      { k: 'SKU', v: p.sku },
      { k: 'Description', v: p.desc },
      { k: 'Volume', v: _aInt(p.mt) + ' MT' },
      { k: 'Standard', v: _aEur(p.stdEur) + '/t' },
      { k: 'Actual', v: _aEur(p.actEur) + '/t' },
      { k: 'FX impact', v: (p.fxImpact >= 0 ? '+' : '−') + _aEur(Math.abs(p.fxImpact)) + '/t', cls: p.fxImpact >= 0 ? 'pos' : 'neg' },
    ]);
    label = p.sku; sub = p.desc;
  } else {
    qstat = _aQstatGrid([
      { label: 'WAC €/t', value: _aEur(inv.wac) },
      { label: 'Volume', value: _aInt(inv.mt) + ' MT' },
      { label: 'Value', value: _aEur(inv.valueK) + 'k', cls: 'accent' },
      { label: 'Aging', value: inv.aging, cls: inv.aging === '>90d' ? 'neg' : 'muted' },
    ]);
    attrs = _aKvList([
      { k: 'SKU', v: inv.sku },
      { k: 'Form', v: inv.form },
      { k: 'Location', v: inv.location },
      { k: 'WAC', v: _aEur(inv.wac) + '/t' },
      { k: 'Value', v: '€' + _aInt(inv.valueK) + 'k' },
      { k: 'Aging', v: inv.aging },
    ]);
    label = inv.sku; sub = inv.form + ' · ' + inv.location;
  }
  const body = qstat +
    '<div class="section-title">Attributes</div>' + attrs +
    '<div class="section-title">Variance history</div>' +
    _aTimeline([
      { cls: 'warn', body: 'June actual posted', time: 'now' },
      { cls: 'info', body: 'May variance recorded', time: '−1mo' },
      { cls: 'muted', body: 'Standard cost set (annual)', time: 'FY27' },
    ]);
  openDrawer({
    title: label,
    sub: 'SKU drill · ' + sub,
    body: body + _aQuickActions([
      { action: 'reserve-calc', label: 'LCM test' },
      { action: 'cycle-count', label: 'Cycle count' },
      { action: 'export-excel', label: 'Export' },
      { action: 'add-comment', label: 'Comment' },
    ]),
  });
}

function drillAlert(index) {
  const i = parseInt(index, 10);
  const a = (DATA.alerts || [])[i];
  if (!a) { toast({ type: 'error', title: 'No alert', body: 'Unknown alert.' }); return; }
  const sevCls = a.sev === 'high' ? 'neg' : (a.sev === 'med' ? 'warn' : 'info');
  const body =
    _aQstatGrid([
      { label: 'Severity', value: a.sev.toUpperCase(), cls: sevCls },
      { label: 'Time', value: a.time },
      { label: 'Status', value: a.sev === 'high' ? 'ACTION' : 'WATCH', cls: sevCls },
      { label: 'Channel', value: 'Desk feed' },
    ]) +
    '<div class="section-title">Detail</div>' +
    '<div class="kv-list"><div class="kv"><span class="kv-k">Alert</span><span class="kv-v">' + _aEsc(a.title) + '</span></div>' +
    '<div class="kv"><span class="kv-k">Body</span><span class="kv-v">' + _aEsc(a.body) + '</span></div></div>' +
    '<div class="section-title">Timeline</div>' +
    _aTimeline([
      { cls: sevCls, body: 'Raised: ' + a.title, time: a.time },
      { cls: 'info', body: 'Routed to desk feed', time: a.time },
      { cls: 'muted', body: 'Awaiting acknowledgement', time: '—' },
    ]);
  openDrawer({
    title: a.title,
    sub: a.sev.toUpperCase() + ' · ' + a.time,
    body: body + _aQuickActions([
      { action: 'escalate', label: 'Escalate' },
      { action: 'tag-reviewer', label: 'Assign' },
      { action: 'add-comment', label: 'Comment' },
      { action: 'post-activity', label: 'Acknowledge' },
    ]),
  });
}

function drillControl(id) {
  const c = (DATA.controls || []).find(x => x.id === id);
  if (!c) { toast({ type: 'error', title: 'No control', body: 'Unknown control: ' + (id || '') }); return; }
  const body =
    _aQstatGrid([
      { label: 'Status', value: c.status, cls: _aStatusClass(c.status) },
      { label: 'Frequency', value: c.freq },
      { label: 'Owner', value: c.owner },
      { label: 'Last test', value: c.lastTest },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Control', v: c.id },
      { k: 'Name', v: c.name },
      { k: 'Frequency', v: c.freq },
      { k: 'Owner', v: c.owner },
      { k: 'Status', v: c.status, cls: _aStatusClass(c.status) },
      { k: 'Last tested', v: c.lastTest },
    ]) +
    '<div class="section-title">Test history</div>' +
    _aTimeline([
      { cls: _aStatusClass(c.status), body: 'Last test: ' + c.status, time: c.lastTest },
      { cls: 'pos', body: 'Prior test passed', time: 'prev cycle' },
      { cls: 'info', body: 'Control documented', time: 'baseline' },
    ]);
  openDrawer({
    title: c.id + ' · ' + c.name,
    sub: 'SOX control drill',
    body: body + _aQuickActions([
      { action: 'run-test', payload: c.id, label: 'Run test' },
      { action: 'evidence-repo', label: 'Evidence' },
      { action: 'escalate', label: 'Escalate' },
      { action: 'add-comment', label: 'Comment' },
    ]),
  });
}

function drillLot(lot) {
  const l = (DATA.eudr && DATA.eudr.chainOfCustody || []).find(x => x.lot === lot);
  if (!l) { toast({ type: 'error', title: 'No lot', body: 'Unknown lot: ' + (lot || '') }); return; }
  const body =
    _aQstatGrid([
      { label: 'Geo check', value: l.geo, cls: _aStatusClass(l.geo) },
      { label: 'Polygons', value: _aInt(l.polygons) },
      { label: 'Coverage', value: _aPct(l.coverage, 0), cls: l.coverage >= 75 ? 'pos' : (l.coverage >= 50 ? 'warn' : 'neg') },
      { label: 'Origin', value: l.origin },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Lot', v: l.lot },
      { k: 'Supplier', v: l.supplier },
      { k: 'Origin', v: l.origin },
      { k: 'Geo result', v: l.geo, cls: _aStatusClass(l.geo) },
      { k: 'Polygons mapped', v: String(l.polygons) },
      { k: 'Coverage', v: _aPct(l.coverage, 0) },
    ]) +
    '<div class="section-title">Custody trail</div>' +
    _aTimeline([
      { cls: 'pos', body: 'Farm polygons captured (' + l.polygons + ')', time: 'origin' },
      { cls: _aStatusClass(l.geo), body: 'Deforestation scan: ' + l.geo, time: 'geo' },
      { cls: 'info', body: 'Lot aggregated at port', time: 'port' },
      { cls: 'info', body: 'Linked to EU import shipment', time: 'EU' },
    ]);
  openDrawer({
    title: l.lot,
    sub: 'Chain of custody · ' + l.supplier,
    body: body + _aQuickActions([
      { action: 'submit-dds', label: 'Submit DDS' },
      { action: 'drill-supplier', payload: l.supplier, label: 'Supplier' },
      { action: 'export-excel', label: 'Export' },
      { action: 'add-comment', label: 'Comment' },
    ]),
  });
}

function drillTask(index) {
  const i = parseInt(index, 10);
  const t = (DATA.closeChecklist || [])[i];
  if (!t) { toast({ type: 'error', title: 'No task', body: 'Unknown close task.' }); return; }
  const body =
    _aQstatGrid([
      { label: 'Status', value: String(t.status).replace('_', ' '), cls: _aStatusClass(t.status) },
      { label: 'Owner', value: t.owner },
      { label: 'Due', value: t.due },
      { label: 'Task', value: t.task },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Task', v: t.task },
      { k: 'Owner', v: t.owner },
      { k: 'Due', v: t.due },
      { k: 'Status', v: String(t.status).replace('_', ' '), cls: _aStatusClass(t.status) },
      { k: 'Notes', v: t.notes },
    ]) +
    '<div class="section-title">Progress</div>' +
    _aTimeline([
      { cls: _aStatusClass(t.status), body: 'Current: ' + String(t.status).replace('_', ' '), time: t.due },
      { cls: 'info', body: t.notes, time: 'note' },
    ]);
  openDrawer({
    title: t.task,
    sub: 'Close task · ' + t.owner,
    body: body + _aQuickActions([
      { action: 'sign-off', label: 'Sign-off' },
      { action: 'tag-reviewer', label: 'Assign' },
      { action: 'add-comment', label: 'Comment' },
      { action: 'escalate', label: 'Escalate' },
    ]),
  });
}

function drillMarginCall(index) {
  const i = parseInt(index, 10);
  const m = (DATA.marginCalls || [])[i];
  if (!m) { toast({ type: 'error', title: 'No margin call', body: 'Unknown margin call.' }); return; }
  const body =
    _aQstatGrid([
      { label: 'Broker', value: m.broker },
      { label: 'Amount', value: _aEur(m.amountK) + 'k', cls: 'accent' },
      { label: 'Status', value: m.status, cls: _aStatusClass(m.status) },
      { label: 'Date', value: m.date },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Broker', v: m.broker },
      { k: 'Amount', v: '€' + _aInt(m.amountK) + 'k' },
      { k: 'Reason', v: m.reason },
      { k: 'Status', v: m.status, cls: _aStatusClass(m.status) },
      { k: 'Date', v: m.date },
    ]) +
    '<div class="section-title">Timeline</div>' +
    _aTimeline([
      { cls: 'warn', body: 'Margin call issued: ' + m.reason, time: m.date },
      { cls: _aStatusClass(m.status), body: 'Status: ' + m.status, time: m.date },
    ]);
  openDrawer({
    title: m.broker + ' margin call',
    sub: '€' + _aInt(m.amountK) + 'k · ' + m.date,
    body: body + _aQuickActions([
      { action: 'sync-treasury', label: 'Push to TMS' },
      { action: 'liquidity-stress', label: 'Stress test' },
      { action: 'add-comment', label: 'Comment' },
      { action: 'escalate', label: 'Escalate' },
    ]),
  });
}

function drillActivity(index) {
  const i = parseInt(index, 10);
  const a = (DATA.activity || [])[i];
  if (!a) { toast({ type: 'error', title: 'No activity', body: 'Unknown activity item.' }); return; }
  const body =
    _aQstatGrid([
      { label: 'User', value: a.user },
      { label: 'Team', value: a.team },
      { label: 'Action', value: a.action },
      { label: 'When', value: a.time },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'User', v: a.user },
      { k: 'Team', v: a.team },
      { k: 'Action', v: a.action + ' ' + a.target },
      { k: 'Target', v: a.target },
      { k: 'Time', v: a.time },
    ]) +
    '<div class="section-title">Message</div>' +
    '<div class="news-body">' + _aEsc(a.body) + '</div>';
  openDrawer({
    title: a.user + ' · ' + a.target,
    sub: a.action + ' · ' + a.time,
    body: body + _aQuickActions([
      { action: 'post-activity', label: 'Reply' },
      { action: 'tag-reviewer', label: 'Assign' },
      { action: 'add-comment', label: 'Comment' },
      { action: 'escalate', label: 'Escalate' },
    ]),
  });
}

function drillRecon(index) {
  const i = parseInt(index, 10);
  const r = (DATA.recon || [])[i];
  if (!r) { toast({ type: 'error', title: 'No reconciliation', body: 'Unknown recon line.' }); return; }
  const body =
    _aQstatGrid([
      { label: 'S/4HANA', value: '€' + _aInt(r.s4) + 'k' },
      { label: 'iRely', value: '€' + _aInt(r.irely) + 'k' },
      { label: 'Delta', value: (r.deltaK === 0 ? '€0' : '€' + _aInt(r.deltaK) + 'k'), cls: r.deltaK === 0 ? 'pos' : 'warn' },
      { label: 'Status', value: r.status, cls: _aStatusClass(r.status) },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Account', v: r.account },
      { k: 'S/4HANA', v: '€' + _aInt(r.s4) + 'k' },
      { k: 'iRely CTRM', v: '€' + _aInt(r.irely) + 'k' },
      { k: 'Delta', v: '€' + _aInt(r.deltaK) + 'k', cls: r.deltaK === 0 ? 'pos' : 'warn' },
      { k: 'Status', v: r.status, cls: _aStatusClass(r.status) },
    ]) +
    '<div class="section-title">Reconciliation trail</div>' +
    _aTimeline([
      { cls: 'info', body: 'S/4 balance loaded', time: 'WD+1' },
      { cls: 'info', body: 'iRely balance loaded', time: 'WD+1' },
      { cls: _aStatusClass(r.status), body: 'Match result: ' + r.status, time: 'WD+1' },
    ]);
  openDrawer({
    title: r.account,
    sub: 'S/4 ↔ iRely recon',
    body: body + _aQuickActions([
      { action: 'open-s4', label: 'Open S/4' },
      { action: 'import-irely', label: 'Re-sync iRely' },
      { action: 'add-comment', label: 'Comment' },
      { action: 'escalate', label: 'Escalate' },
    ]),
  });
}

function drillJe(index) {
  const i = parseInt(index, 10);
  const j = (DATA.journalEntries || [])[i];
  if (!j) { toast({ type: 'error', title: 'No journal', body: 'Unknown journal entry.' }); return; }
  const body =
    _aQstatGrid([
      { label: 'Debit', value: j.dr },
      { label: 'Credit', value: j.cr },
      { label: 'Amount', value: '€' + _aInt(j.amountK) + 'k', cls: 'accent' },
      { label: 'Status', value: j.status, cls: _aStatusClass(j.status) },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Journal', v: j.je },
      { k: 'Description', v: j.desc },
      { k: 'Dr', v: j.dr },
      { k: 'Cr', v: j.cr },
      { k: 'Amount', v: '€' + _aInt(j.amountK) + 'k' },
      { k: 'Status', v: j.status, cls: _aStatusClass(j.status) },
      { k: 'Owner', v: j.owner },
    ]) +
    '<div class="section-title">Posting trail</div>' +
    _aTimeline([
      { cls: 'info', body: 'JE drafted by ' + j.owner, time: 'WD+1' },
      { cls: _aStatusClass(j.status), body: 'Status: ' + j.status, time: 'WD+1' },
    ]);
  openDrawer({
    title: j.je,
    sub: j.desc,
    body: body + _aQuickActions([
      { action: 'open-s4', label: 'View in S/4' },
      { action: 'tag-reviewer', label: 'Assign' },
      { action: 'add-comment', label: 'Comment' },
      { action: 'export-excel', label: 'Export' },
    ]),
  });
}

function drillDriver(label) {
  /* Synthesize a PPV bridge-step driver from the cost bridge. */
  const step = (DATA.costBridge || []).find(s => s.label === label);
  const eurPerT = step ? step.value : 0;
  const volume = (DATA.whatIf && DATA.whatIf.baseline && DATA.whatIf.baseline.volume) || 6400;
  const totalK = Math.round(eurPerT * volume / 1000);
  const adverse = eurPerT > 0;
  const body =
    _aQstatGrid([
      { label: 'Driver', value: label || 'Variance step' },
      { label: '€/t impact', value: (eurPerT >= 0 ? '+' : '−') + _aEur(Math.abs(eurPerT)), cls: adverse ? 'neg' : 'pos' },
      { label: 'Volume', value: _aInt(volume) + ' MT' },
      { label: 'Total impact', value: (totalK >= 0 ? '+' : '−') + '€' + _aInt(Math.abs(totalK)) + 'k', cls: adverse ? 'neg' : 'pos' },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Bridge step', v: label || '—' },
      { k: 'Type', v: step ? step.type : 'add' },
      { k: 'Unit impact', v: (eurPerT >= 0 ? '+' : '−') + '€' + Math.abs(eurPerT) + '/t' },
      { k: 'Applied volume', v: _aInt(volume) + ' MT' },
      { k: 'P&L direction', v: adverse ? 'Adverse' : 'Favorable', cls: adverse ? 'neg' : 'pos' },
    ]) +
    '<div class="section-title">Contribution</div>' +
    _aTimeline([
      { cls: adverse ? 'neg' : 'pos', body: label + ' contributed ' + (totalK >= 0 ? '+' : '−') + '€' + Math.abs(totalK) + 'k', time: 'MTD' },
      { cls: 'info', body: 'Rolled into landed cost bridge', time: 'bridge' },
    ]);
  openDrawer({
    title: label || 'Variance driver',
    sub: 'PPV bridge driver',
    body: body + _aQuickActions([
      { action: 'run-forecast', label: 'Re-forecast' },
      { action: 'export-excel', label: 'Export' },
      { action: 'add-comment', label: 'Comment' },
      { action: 'escalate', label: 'Escalate' },
    ]),
  });
}

function drillVersion(id) {
  const v = (DATA.forecastVersions || []).find(x => x.id === id);
  if (!v) { toast({ type: 'error', title: 'No version', body: 'Unknown version: ' + (id || '') }); return; }
  const body =
    _aQstatGrid([
      { label: 'Status', value: v.status, cls: _aStatusClass(v.status) },
      { label: 'Owner', value: v.owner },
      { label: 'PPV', value: (v.ppvM >= 0 ? '+' : '−') + '€' + Math.abs(v.ppvM).toFixed(2) + 'M', cls: v.ppvM > 0 ? 'neg' : (v.ppvM < 0 ? 'pos' : 'muted') },
      { label: 'Landed', value: _aEur(v.landed) + '/t' },
    ]) +
    '<div class="section-title">Attributes</div>' +
    _aKvList([
      { k: 'Version', v: v.id + ' · ' + v.name },
      { k: 'Status', v: v.status, cls: _aStatusClass(v.status) },
      { k: 'Owner', v: v.owner },
      { k: 'Date', v: v.date },
      { k: 'PPV', v: '€' + v.ppvM.toFixed(2) + 'M' },
      { k: 'Landed cost', v: _aEur(v.landed) + '/t' },
    ]) +
    '<div class="section-title">Version history</div>' +
    _aTimeline([
      { cls: _aStatusClass(v.status), body: v.name + ' — ' + v.status, time: v.date },
      { cls: 'info', body: 'Owned by ' + v.owner, time: v.date },
      { cls: 'muted', body: 'Landed ' + _aEur(v.landed) + '/t · PPV €' + v.ppvM.toFixed(2) + 'M', time: 'snapshot' },
    ]);
  openDrawer({
    title: v.id + ' · ' + v.name,
    sub: 'Forecast version · ' + v.status,
    body: body + _aQuickActions([
      { action: 'compare-versions', label: 'Compare' },
      { action: 'branch-current', label: 'Branch' },
      { action: 'lock-forecast', label: 'Lock' },
      { action: 'export-excel', label: 'Export' },
    ]),
  });
}

/* ---------------------------------------------------------------------------
   Confirmation handlers for the rich modals' primary buttons.
   Each closes the modal then toasts a realistic confirmation.
   --------------------------------------------------------------------------- */

const CONFIRM_ACTIONS = {
  'confirm-run-forecast': () => { closeModal(); toast({ type: 'success', title: 'Forecast run', body: 'Rolling forecast recomputed.', meta: 'New version drafted' }); },
  'confirm-set-alert': () => { closeModal(); toast({ type: 'success', title: 'Alert created', body: 'Market alert is now active.' }); },
  'confirm-strategy': () => { closeModal(); toast({ type: 'success', title: 'Strategy saved', body: 'Hedge policy parameters updated.' }); },
  'confirm-new-contract': () => { closeModal(); toast({ type: 'success', title: 'Contract created', body: 'New physical contract registered & PO drafted.' }); },
  'confirm-fix-ptbf': (payload) => { closeModal(); toast({ type: 'success', title: 'PTBF fixed', body: (payload || 'Contract') + ' priced against current ICE curve.', meta: 'iRely updated' }); },
  'confirm-new-hedge': () => { closeModal(); toast({ type: 'success', title: 'Order placed', body: 'Hedge staged & IFRS 9 designation drafted.' }); },
  'confirm-dedesignate': () => { closeModal(); toast({ type: 'warn', title: 'De-designated', body: 'HG-7006 de-designated — €96k routed to P&L, pending approval.' }); },
  'confirm-cycle-count': () => { closeModal(); toast({ type: 'success', title: 'Count scheduled', body: 'Cycle count added to the warehouse queue.' }); },
  'confirm-reserve': () => { closeModal(); toast({ type: 'success', title: 'Reserve booked', body: 'LCM reserve JE drafted (CK-DE-01, €25k).' }); },
  'confirm-lock-forecast': () => { closeModal(); toast({ type: 'warn', title: 'Version locked', body: 'Forecast version frozen — branch to amend.' }); },
  'confirm-branch': () => { closeModal(); toast({ type: 'success', title: 'Branch created', body: 'New editable forecast version created.' }); },
  'confirm-submit-approval': () => { closeModal(); toast({ type: 'success', title: 'Submitted', body: 'Forecast routed to FP&A Lead for review.' }); },
  'confirm-remind': () => { toast({ type: 'info', title: 'Reminders sent', body: 'Owners of open close tasks notified.' }); },
  'confirm-signoff': () => { closeModal(); toast({ type: 'success', title: 'Close signed off', body: 'June 2026 close signed off.', meta: 'Audit trail recorded' }); },
  'confirm-dds': () => { closeModal(); toast({ type: 'success', title: 'DDS submitted', body: 'Due-diligence statement filed to TRACES.' }); },
  'confirm-save-scenario': () => { closeModal(); toast({ type: 'success', title: 'Scenario saved', body: 'What-if scenario stored.' }); },
  'confirm-add-comment': () => { closeModal(); toast({ type: 'success', title: 'Comment posted', body: 'Comment added to the trail.' }); },
  'confirm-tag-reviewer': () => { closeModal(); toast({ type: 'success', title: 'Reviewer tagged', body: 'Item assigned for review.' }); },
  'confirm-escalate': () => { closeModal(); toast({ type: 'warn', title: 'Escalated', body: 'Issue escalated to senior stakeholder.' }); },
  'confirm-send-commentary': () => { closeModal(); toast({ type: 'success', title: 'Sent to CFO', body: 'Executive commentary emailed to the CFO.' }); },
};
Object.keys(CONFIRM_ACTIONS).forEach(k => { ACTIONS[k] = CONFIRM_ACTIONS[k]; });

/* ---------------------------------------------------------------------------
   (B) DISPATCHER — CONTRACT §10. One document click listener.
   --------------------------------------------------------------------------- */

function handleCardToggle(el) {
  const parent = el.parentNode;
  if (parent) {
    $$('.card-action', parent).forEach(a => a.classList.toggle('active', a === el));
  } else {
    el.classList.add('active');
  }
  const label = (el.dataset.payload || el.textContent || 'View').trim();
  toast({ type: 'info', title: 'View changed', body: label });
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const name = el.dataset.action;

  if (name === 'card-toggle') {
    e.preventDefault();
    handleCardToggle(el);
    return;
  }

  const handler = ACTIONS[name];
  if (handler) {
    e.preventDefault();
    try {
      handler(el.dataset.payload, el);
    } catch (err) {
      toast({ type: 'error', title: 'Action failed', body: name });
    }
  }
});

/* Allow Escape to dismiss any open overlay (nice-to-have, guarded). */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); closeDrawer(); }
});

/* ---------------------------------------------------------------------------
   (E) BOOT — LAST in load order (§2). Single initial view call.
   --------------------------------------------------------------------------- */

if (typeof switchView === 'function') {
  switchView('dashboard');
}
