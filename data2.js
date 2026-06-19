/* ============================================================================
   CACAO/FP — data2.js  (enhancement data layer, v2)
   Mutates the global DATA object declared in data.js with the datasets that
   back the 7 advanced modules + cross-cutting features.
   ========================================================================== */

/* ---- Hedge Effectiveness (IFRS 9) ------------------------------------- */
DATA.hedgeEffectiveness = {
  designations: [
    { id: 'DES-01', name: 'CC NY Q3 Cash Flow Hedge',  ratio: 98,  status: 'EFFECTIVE', method: 'Dollar-offset' },
    { id: 'DES-02', name: 'CC NY Q4 Cash Flow Hedge',  ratio: 104, status: 'EFFECTIVE', method: 'Regression'    },
    { id: 'DES-03', name: 'C LDN Q3 Cash Flow Hedge',  ratio: 88,  status: 'WATCH',     method: 'Dollar-offset' },
    { id: 'DES-04', name: 'C LDN Q4 Cash Flow Hedge',  ratio: 74,  status: 'FAILED',    method: 'Regression'    },
    { id: 'DES-05', name: 'FX EUR/USD Net Investment', ratio: 112, status: 'EFFECTIVE', method: 'Dollar-offset' },
  ],
  // 6-month effectiveness trend per key designation (ratio %)
  history: {
    labels: ['Jan','Feb','Mar','Apr','May','Jun'],
    des01:  [101, 99,  102, 97,  99,  98],
    des03:  [96,  93,  91,  89,  90,  88],
    des04:  [99,  94,  86,  81,  78,  74],
  },
  pnlImpact: {
    ociAccumulated: 1240000,   // € accumulated in OCI
    ineffectiveToPnl: -96000,  // € ineffective portion recycled to P&L
    reclassOnSettle: 410000,   // € reclassified on settlement
  },
};

/* ---- EUDR & Traceability ---------------------------------------------- */
DATA.eudr = {
  summary: { compliant: 4, partial: 2, atRisk: 2, ddsClock: 196, geoAvg: 68 },
  bySupplier: [
    { supplier: 'Barry Callebaut Sourcing', origin: 'CIV', geoPct: 92, dds: 'SUBMITTED', cert: 'RA',  risk: 18, lastAudit: '2026-04-12' },
    { supplier: 'Cocobod Direct',           origin: 'GHA', geoPct: 88, dds: 'SUBMITTED', cert: 'FT',  risk: 22, lastAudit: '2026-03-28' },
    { supplier: 'Hacienda Victoria',        origin: 'ECU', geoPct: 95, dds: 'SUBMITTED', cert: 'ORG', risk: 12, lastAudit: '2026-05-02' },
    { supplier: 'Rizek Cacao',              origin: 'DOM', geoPct: 90, dds: 'SUBMITTED', cert: 'ORG', risk: 15, lastAudit: '2026-02-18' },
    { supplier: 'Olam Agri',                origin: 'CIV', geoPct: 61, dds: 'DRAFT',     cert: 'RA',  risk: 44, lastAudit: '2026-01-30' },
    { supplier: 'Cargill Cocoa',            origin: 'CIV', geoPct: 58, dds: 'DRAFT',     cert: 'RA',  risk: 47, lastAudit: '2026-01-22' },
    { supplier: 'Telcar Cocoa',             origin: 'CMR', geoPct: 34, dds: 'NONE',      cert: '—',   risk: 71, lastAudit: '2025-11-15' },
    { supplier: 'Tulip Cocoa',              origin: 'NGA', geoPct: 27, dds: 'NONE',      cert: '—',   risk: 76, lastAudit: '2025-10-08' },
  ],
  chainOfCustody: [
    { lot: 'LOT-CIV-9981', supplier: 'Barry Callebaut Sourcing', origin: 'CIV', geo: 'PASS',    polygons: 142, coverage: 92 },
    { lot: 'LOT-GHA-4420', supplier: 'Cocobod Direct',           origin: 'GHA', geo: 'PASS',    polygons: 98,  coverage: 88 },
    { lot: 'LOT-ECU-2210', supplier: 'Hacienda Victoria',        origin: 'ECU', geo: 'PASS',    polygons: 31,  coverage: 95 },
    { lot: 'LOT-CIV-9982', supplier: 'Olam Agri',                origin: 'CIV', geo: 'PARTIAL', polygons: 88,  coverage: 61 },
    { lot: 'LOT-CIV-9983', supplier: 'Cargill Cocoa',            origin: 'CIV', geo: 'PARTIAL', polygons: 74,  coverage: 58 },
    { lot: 'LOT-CMR-1180', supplier: 'Telcar Cocoa',             origin: 'CMR', geo: 'FAIL',    polygons: 22,  coverage: 34 },
    { lot: 'LOT-NGA-7705', supplier: 'Tulip Cocoa',              origin: 'NGA', geo: 'FAIL',    polygons: 14,  coverage: 27 },
  ],
  roadmap: [
    { name: 'Geo-mapping',       pct: 68 },
    { name: 'DDS submission',    pct: 52 },
    { name: 'Risk assessment',   pct: 74 },
    { name: 'Mitigation plans',  pct: 41 },
    { name: 'TRACES integration',pct: 35 },
    { name: 'Buyer training',    pct: 80 },
  ],
};

/* ---- Forecast versions (7) -------------------------------------------- */
DATA.forecastVersions = [
  { id: 'v1', name: 'FY27 Budget',        status: 'BUDGET',     owner: 'FP&A Lead', date: '2026-01-15', ppvM: 0.0,  landed: 7975 },
  { id: 'v2', name: 'Q1 Reforecast',      status: 'SUPERSEDED', owner: 'You',       date: '2026-03-31', ppvM: 0.6,  landed: 8040 },
  { id: 'v3', name: 'Q2 Reforecast',      status: 'SUPERSEDED', owner: 'You',       date: '2026-04-30', ppvM: 0.9,  landed: 8095 },
  { id: 'v4', name: 'May Rolling',        status: 'FROZEN',     owner: 'You',       date: '2026-05-31', ppvM: 1.02, landed: 8120 },
  { id: 'v5', name: 'June Rolling',       status: 'CURRENT',    owner: 'You',       date: '2026-06-15', ppvM: 1.07, landed: 8142 },
  { id: 'v6', name: 'Bull Sensitivity',   status: 'WORKING',    owner: 'You',       date: '2026-06-16', ppvM: 4.20, landed: 8720 },
  { id: 'v7', name: 'Bear Sensitivity',   status: 'WORKING',    owner: 'You',       date: '2026-06-16', ppvM: -3.90,landed: 7640 },
];

/* ---- Version assumption diff (v3 → v4 → v5) --------------------------- */
DATA.versionDiff = [
  { assumption: 'NY price (USD/t)',      v1: 7600, v2: 7720, v3: 7842, delta: 122  },
  { assumption: 'LDN price (GBP/t)',     v1: 5200, v2: 5310, v3: 5418, delta: 108  },
  { assumption: 'EUR/USD',               v1: 1.10, v2: 1.092,v3: 1.085,delta: -0.007},
  { assumption: 'CIV differential ($/t)',v1: 210,  v2: 225,  v3: 240,  delta: 15   },
  { assumption: 'Sustainability ($/t)',  v1: 80,   v2: 88,   v3: 96,   delta: 8    },
  { assumption: 'Monthly volume (MT)',   v1: 6600, v2: 6500, v3: 6400, delta: -100 },
  { assumption: 'Hedge coverage Q3 (%)', v1: 82,   v2: 80,   v3: 78,   delta: -2   },
];

/* ---- Cash flow / treasury (12-week stacked outflows, €M) -------------- */
DATA.cashFlow = {
  labels: ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12'],
  physical: [8.2, 6.1, 9.4, 7.8, 5.9, 8.6, 7.1, 6.4, 9.0, 8.1, 6.8, 7.5],
  margin:   [1.2, 0.9, 1.8, 1.1, 0.7, 1.4, 0.6, 1.0, 1.6, 0.8, 1.1, 0.9],
  freight:  [0.8, 0.6, 0.9, 0.7, 0.5, 0.8, 0.7, 0.6, 0.9, 0.8, 0.6, 0.7],
  closeout: [0.0, 0.0, 2.1, 0.0, 0.0, 1.6, 0.0, 0.0, 2.4, 0.0, 0.0, 1.9],
};

/* ---- Margin calls log (7) --------------------------------------------- */
DATA.marginCalls = [
  { date: '2026-06-16', broker: 'StoneX',        amountK: 420, reason: 'NY rally +1.8%',        status: 'PAID'    },
  { date: '2026-06-13', broker: 'Marex',         amountK: 180, reason: 'LDN initial margin',    status: 'PAID'    },
  { date: '2026-06-11', broker: 'StoneX',        amountK: 260, reason: 'Variation margin',      status: 'PAID'    },
  { date: '2026-06-09', broker: 'ADM Investor',  amountK: 95,  reason: 'FX position add',        status: 'PAID'    },
  { date: '2026-06-06', broker: 'Marex',         amountK: 310, reason: 'Q4 lot increase',       status: 'PAID'    },
  { date: '2026-06-17', broker: 'StoneX',        amountK: 540, reason: 'Intraday NY spike',     status: 'PENDING' },
  { date: '2026-06-17', broker: 'Marex',         amountK: 120, reason: 'LDN variation',         status: 'PENDING' },
];

/* ---- Activity / collaboration rail (9) -------------------------------- */
DATA.activity = [
  { user: 'Sophie Klein',  avatar: 'SK', team: 'FP&A',        action: 'commented on',  target: 'PPV variance', body: 'Butter PPV looks like the press yield issue from May — @You can you confirm vs std?', time: '12m ago' },
  { user: 'You',           avatar: 'KM', team: 'FP&A',        action: 'replied to',    target: 'PPV variance', body: 'Confirmed — yield ran 1.4pts below std. Posting variance to 8410xx.', time: '9m ago' },
  { user: 'Lukas Meier',   avatar: 'LM', team: 'Supply Chain',action: 'flagged',       target: 'PC-2404',      body: 'CIV PTBF still unpriced into DEC — desk wants a fix decision today.', time: '24m ago' },
  { user: 'Anja Brunner',  avatar: 'AB', team: 'Accounting',  action: 'posted',        target: 'JE-44021',     body: 'GR/IR clearing posted, €0.3M aged items resolved.', time: '38m ago' },
  { user: 'Marc Favre',    avatar: 'MF', team: 'Treasury',    action: 'approved',      target: 'Margin call',  body: 'StoneX €420k variation margin approved and wired.', time: '1h ago' },
  { user: 'Sophie Klein',  avatar: 'SK', team: 'FP&A',        action: 'mentioned',     target: 'Hedge book',   body: '@Treasury HG-7006 effectiveness slipped to 74% — need de-designation call.', time: '1h ago' },
  { user: 'Auto',          avatar: '⚙', team: 'Auto',         action: 'auto-posted',   target: 'Commentary',   body: 'PPV executive commentary regenerated for June close.', time: '2h ago' },
  { user: 'Elena Rossi',   avatar: 'ER', team: 'Procurement', action: 'reviewed',      target: 'EUDR matrix',  body: 'Telcar + Tulip geo coverage still below 40% — escalating to mitigation queue.', time: '3h ago' },
  { user: 'Anja Brunner',  avatar: 'AB', team: 'Accounting',  action: 'commented on',  target: 'Cake reserve', body: 'CK-DE-01 below NRV — booking €25k LCM reserve unless we move it this week.', time: '4h ago' },
];

/* ---- Variance Investigator drill chain (SKU → … → JE) ----------------- */
DATA.drillChain = {
  sku: 'BT-DE-01',
  desc: 'Butter · Hamburg Press',
  varianceEur: 211000,
  steps: [
    { type: 'sku',      id: 'BT-DE-01',  label: 'Butter · Hamburg Press',  status: 'adverse', detail: '540 MT · std €14,850 · act €15,240 · +€390/t' },
    { type: 'contract', id: 'PC-2401',   label: 'CIV Beans feedstock',     status: 'open',    detail: 'PTBF · 500 MT · diff +€240/t · 80% hedged' },
    { type: 'po',       id: 'PO-88231',  label: 'Purchase order',          status: 'ok',      detail: 'Released 2026-05-12 · Barry Callebaut Sourcing' },
    { type: 'invoice',  id: 'INV-77310', label: 'Supplier invoice',        status: 'ok',      detail: '€4.03M · received 2026-06-02 · 3-way matched' },
    { type: 'bl',       id: 'BL-CIV-551',label: 'Bill of lading',          status: 'ok',      detail: 'Abidjan → Hamburg · 500 MT · ETA 2026-06-09' },
    { type: 'hedge',    id: 'HG-7001',   label: 'CC NY Q3 hedge',          status: 'effective',detail: '120 lots LONG · avg €7,780 · MTM +€386k' },
    { type: 'je',       id: 'JE-44102',  label: 'Variance journal entry',  status: 'posted',  detail: 'Dr 8410xx €211k · Cr inventory · press yield -1.4pts' },
  ],
};

/* ---- What-If baseline -------------------------------------------------- */
DATA.whatIf = {
  baseline: {
    nyPx: 7842, ldnPx: 5418, eurusd: 1.085, civDiff: 240,
    sustain: 96, freight: 64, volume: 6400, hedgeCov: 78,
    stdCost: 7975,
  },
};

/* ---- Scheduled reports (4) -------------------------------------------- */
DATA.scheduledReports = [
  { name: 'Daily Cocoa Brief',     cadence: 'Daily · 07:00 CET',  recipients: 'Procurement, FP&A', format: 'PDF',  next: 'Tomorrow 07:00' },
  { name: 'Weekly Hedge Coverage', cadence: 'Mon · 08:00 CET',    recipients: 'Treasury, CFO',     format: 'XLSX', next: 'Mon 08:00'     },
  { name: 'Monthly Exec Pack',     cadence: 'WD+5 · 09:00 CET',   recipients: 'CFO, Board',        format: 'PPTX', next: 'WD+5 09:00'    },
  { name: 'PPV Drilldown',         cadence: 'On-demand',          recipients: 'Cost Accounting',   format: 'XLSX', next: '—'             },
];

/* ---- S/4 ↔ iRely reconciliation (Close view + drill-recon drawer) ----- */
DATA.recon = [
  { account: 'Inventory — Beans',   s4: 22486, irely: 22486, deltaK: 0,   status: 'MATCHED'  },
  { account: 'Inventory — Liquor',  s4: 6413,  irely: 6402,  deltaK: 11,  status: 'VARIANCE' },
  { account: 'Inventory — Butter',  s4: 5066,  irely: 5066,  deltaK: 0,   status: 'MATCHED'  },
  { account: 'Open hedge MTM',      s4: 532,   irely: 528,   deltaK: 4,   status: 'VARIANCE' },
  { account: 'GR/IR clearing',      s4: 0,     irely: 0,     deltaK: 0,   status: 'MATCHED'  },
  { account: 'Origin premium accr.',s4: 318,   irely: 290,   deltaK: 28,  status: 'OPEN'     },
];

/* ---- Recent journal entries (Close view + drill-je drawer) ------------ */
DATA.journalEntries = [
  { je: 'JE-44102', desc: 'PPV variance — Butter press yield', dr: '8410xx', cr: 'Inventory', amountK: 211, status: 'POSTED',  owner: 'You' },
  { je: 'JE-44021', desc: 'GR/IR clearing — aged items',       dr: 'GR/IR',  cr: 'AP',        amountK: 300, status: 'POSTED',  owner: 'A. Brunner' },
  { je: 'JE-44118', desc: 'Hedge MTM revaluation (IFRS 9)',     dr: 'OCI',    cr: 'Deriv.',    amountK: 532, status: 'POSTED',  owner: 'You' },
  { je: 'JE-44126', desc: 'Origin premium accrual — RA/FT',     dr: '8420xx', cr: 'Accruals',  amountK: 290, status: 'DRAFT',   owner: 'You' },
  { je: 'JE-44131', desc: 'LCM reserve — Cake CK-DE-01',         dr: 'COGS',   cr: 'Reserve',   amountK: 25,  status: 'DRAFT',   owner: 'A. Brunner' },
];

/* ---- Filter taxonomy (drives the global filter bar) ------------------- */
DATA.filterTaxonomy = {
  periods:    ['Jun 2026 (MTD)', 'Q2 2026', 'FY26 YTD', 'Rolling 12M'],
  origins:    ['All origins', 'CIV', 'GHA', 'ECU', 'CMR', 'NGA', 'DOM'],
  suppliers:  ['All suppliers', 'Barry Callebaut Sourcing', 'Cocobod Direct', 'Hacienda Victoria', 'Olam Agri', 'Cargill Cocoa', 'Telcar Cocoa', 'Tulip Cocoa', 'Rizek Cacao'],
  skus:       ['All SKUs', 'BN-CIV-STD', 'BN-GHA-STD', 'BN-ECU-FN', 'LQ-DE-01', 'BT-DE-01', 'PW-DE-01', 'CK-DE-01'],
  currencies: ['EUR', 'USD', 'GBP', 'CHF'],
  versions:   ['v5 · June Rolling (CURRENT)', 'v4 · May Rolling', 'v3 · Q2 Reforecast', 'v1 · FY27 Budget'],
};
