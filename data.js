/* ============================================================================
   CACAO/FP — data.js  (core data layer, v1)
   Declares the global DATA object. All values are synthetic but modelled on
   realistic 2025–2026 cocoa market conditions:
     ICE NY ~7,842 USD/t · ICE LDN ~5,418 GBP/t · EUR/USD ~1.085
   data2.js extends this object with v2 enhancement datasets.
   ========================================================================== */

const DATA = {

  /* ---- Topbar ticker (7 instruments) ---------------------------------- */
  ticker: [
    { sym: 'CC·NY',   name: 'ICE Cocoa NY',  px: 7842,  unit: 'USD/t', chg: -58,    chgPct: -0.73 },
    { sym: 'C·LDN',   name: 'ICE Cocoa LDN', px: 5418,  unit: 'GBP/t', chg: 34,     chgPct: 0.63  },
    { sym: 'EUR/USD', name: 'Euro Dollar',   px: 1.0850,unit: '',      chg: 0.0021, chgPct: 0.19  },
    { sym: 'GBP/USD', name: 'Cable',         px: 1.2720,unit: '',      chg: -0.0015,chgPct: -0.12 },
    { sym: 'EUR/CHF', name: 'Euro Swiss',    px: 0.9685,unit: '',      chg: 0.0008, chgPct: 0.08  },
    { sym: 'BDI',     name: 'Baltic Dry',    px: 1842,  unit: 'idx',   chg: -12,    chgPct: -0.65 },
  ],

  /* ---- Dashboard headline KPIs (6) ------------------------------------ *
   * value/unit render large; chgPct drives color (kpiBlock supports an
   * invertColor flag so a -7% spend can render green).                    */
  kpis: {
    spendMTD:      { label: 'Spend MTD',        value: 48.2,  unit: '€M',  chgPct: -6.9, sub: 'vs €51.8M plan',  invert: true  },
    avgCost:       { label: 'Avg Landed Cost',  value: 8142,  unit: '€/t', chgPct: 2.1,  sub: 'vs €7,975 std',   invert: true  },
    ppvMTD:        { label: 'PPV vs Standard',  value: 1.07,  unit: '€M',  chgPct: 3.4,  sub: 'adverse MTD',     invert: true  },
    hedgeCov:      { label: 'Hedge Coverage Q3',value: 78,    unit: '%',   chgPct: 4.0,  sub: 'target 80%',      invert: false },
    invValue:      { label: 'Inventory Value',  value: 62.4,  unit: '€M',  chgPct: 1.8,  sub: '9 SKUs · 4 forms',invert: true  },
    fcastAccuracy: { label: 'Forecast Accuracy',value: 94.2,  unit: '%',   chgPct: 0.6,  sub: '3-mo MAPE 5.8%',  invert: true  },
  },

  /* ---- Spend by origin (6) — donut + pills ---------------------------- */
  originSpend: [
    { code: 'CIV', name: "Côte d'Ivoire", spendM: 18.4, mt: 2280, certPct: 71, premiumUsd: 240, color: '#c9a96e' },
    { code: 'GHA', name: 'Ghana',          spendM: 12.1, mt: 1490, certPct: 83, premiumUsd: 305, color: '#8b6f3f' },
    { code: 'ECU', name: 'Ecuador (Fine)', spendM: 7.6,  mt:  820, certPct: 64, premiumUsd: 410, color: '#a78bfa' },
    { code: 'CMR', name: 'Cameroon',       spendM: 4.9,  mt:  640, certPct: 38, premiumUsd: 150, color: '#4aa3ff' },
    { code: 'NGA', name: 'Nigeria',        spendM: 3.2,  mt:  430, certPct: 22, premiumUsd:  95, color: '#2dd4a4' },
    { code: 'DOM', name: 'Dominican Rep.', spendM: 2.0,  mt:  240, certPct: 91, premiumUsd: 520, color: '#f5b342' },
  ],

  /* ---- Cost build-up waterfall (Std → Landed) ------------------------- *
   * type: base | add | sub | total. Values are €/t deltas; running total
   * ends at avg landed cost ~8,142.                                        */
  costBridge: [
    { label: 'Standard',       value: 7975, type: 'base'  },
    { label: 'Futures Δ',      value: 280,  type: 'add'   },
    { label: 'Origin Diff',    value: 145,  type: 'add'   },
    { label: 'Sustainability', value: 96,   type: 'add'   },
    { label: 'Freight',        value: 64,   type: 'add'   },
    { label: 'Mix / FX',       value: -228, type: 'sub'   },
    { label: 'Mix Offset',     value: -190, type: 'sub'   },
    { label: 'Landed',         value: 8142, type: 'total' },
  ],

  /* ---- ICE futures curve (8 expiries, NY USD/t + LDN GBP/t) ----------- */
  futuresCurve: {
    labels: ['JUL26', 'SEP26', 'DEC26', 'MAR27', 'MAY27', 'JUL27', 'SEP27', 'DEC27'],
    ny:  [7842, 7905, 8010, 8120, 8185, 8240, 8275, 8320],
    ldn: [5418, 5462, 5535, 5602, 5648, 5690, 5718, 5752],
  },

  /* ---- 60-day spot history (deterministic, lands on ticker headline) -- */
  spotHistory: (() => {
    const labels = [], ny = [], ldn = [];
    const noiseAt    = (i) => Math.sin(i * 0.42) * 110 + Math.cos(i * 0.27) * 60;
    const ldnNoiseAt = (i) => Math.sin(i * 0.31 + 1.2) * 75 + Math.cos(i * 0.19) * 40;
    for (let i = 60; i >= 0; i--) {
      const d = new Date(2026, 5, 17); d.setDate(d.getDate() - i);
      labels.push(d.toISOString().slice(5, 10));
      const linNy  = 7842 + (8420 - 7842) * (i / 60);
      const linLdn = 5418 + (5640 - 5418) * (i / 60);
      ny.push(Math.round(linNy   + (i === 0 ? 0 : noiseAt(i))));
      ldn.push(Math.round(linLdn + (i === 0 ? 0 : ldnNoiseAt(i))));
    }
    return { labels, ny, ldn };
  })(),

  /* ---- Physical contracts register (10) ------------------------------- */
  contracts: [
    { id: 'PC-2401', origin: 'CIV', supplier: 'Barry Callebaut Sourcing', basis: 'PTBF', mt: 500, execMonth: 'SEP26', price: 8060, diff: 240, status: 'OPEN',     cert: 'RA',  hedgePct: 80, po: 'PO-88231', irely: 'IR-50012' },
    { id: 'PC-2402', origin: 'GHA', supplier: 'Cocobod Direct',           basis: 'Flat', mt: 320, execMonth: 'JUL26', price: 8315, diff: 305, status: 'FIXED',    cert: 'FT',  hedgePct: 100,po: 'PO-88240', irely: 'IR-50018' },
    { id: 'PC-2403', origin: 'ECU', supplier: 'Hacienda Victoria',        basis: 'Flat', mt: 180, execMonth: 'AUG26', price: 8540, diff: 410, status: 'FIXED',    cert: 'ORG', hedgePct: 100,po: 'PO-88255', irely: 'IR-50021' },
    { id: 'PC-2404', origin: 'CIV', supplier: 'Olam Agri',                basis: 'PTBF', mt: 640, execMonth: 'DEC26', price: 0,    diff: 235, status: 'UNPRICED', cert: 'RA',  hedgePct: 0,  po: 'PO-88261', irely: 'IR-50027' },
    { id: 'PC-2405', origin: 'CMR', supplier: 'Telcar Cocoa',             basis: 'PTBF', mt: 280, execMonth: 'SEP26', price: 7990, diff: 150, status: 'OPEN',     cert: '—',   hedgePct: 60, po: 'PO-88270', irely: 'IR-50031' },
    { id: 'PC-2406', origin: 'GHA', supplier: 'Cocobod Direct',           basis: 'PTBF', mt: 420, execMonth: 'MAR27', price: 0,    diff: 300, status: 'UNPRICED', cert: 'FT',  hedgePct: 0,  po: 'PO-88284', irely: 'IR-50038' },
    { id: 'PC-2407', origin: 'NGA', supplier: 'Tulip Cocoa',              basis: 'Flat', mt: 210, execMonth: 'JUL26', price: 7720, diff: 95,  status: 'FIXED',    cert: '—',   hedgePct: 100,po: 'PO-88291', irely: 'IR-50044' },
    { id: 'PC-2408', origin: 'CIV', supplier: 'Cargill Cocoa',            basis: 'PTBF', mt: 560, execMonth: 'DEC26', price: 8095, diff: 245, status: 'OPEN',     cert: 'RA',  hedgePct: 75, po: 'PO-88305', irely: 'IR-50051' },
    { id: 'PC-2409', origin: 'DOM', supplier: 'Rizek Cacao',             basis: 'Flat', mt: 120, execMonth: 'AUG26', price: 8740, diff: 520, status: 'FIXED',    cert: 'ORG', hedgePct: 100,po: 'PO-88312', irely: 'IR-50057' },
    { id: 'PC-2410', origin: 'ECU', supplier: 'Hacienda Victoria',        basis: 'PTBF', mt: 200, execMonth: 'MAY27', price: 0,    diff: 405, status: 'UNPRICED', cert: 'ORG', hedgePct: 0,  po: 'PO-88320', irely: 'IR-50063' },
  ],

  /* ---- PPV detail by SKU (8) — sums to ~€1.07M adverse ---------------- *
   * var €/t = actEur - stdEur ; total var = var * mt.                      */
  ppvDetail: [
    { sku: 'BN-CIV-STD', desc: 'CIV Beans · Main Crop',      mt: 2280, stdEur: 7975, actEur: 8210, fxImpact: -42 },
    { sku: 'BN-GHA-STD', desc: 'GHA Beans · Light Crop',     mt: 1490, stdEur: 8050, actEur: 8255, fxImpact: -28 },
    { sku: 'LQ-DE-01',   desc: 'Liquor · Hamburg Grind',     mt:  860, stdEur: 9120, actEur: 9080, fxImpact: 18  },
    { sku: 'BT-DE-01',   desc: 'Butter · Hamburg Press',     mt:  540, stdEur: 14850,actEur: 15240,fxImpact: -64 },
    { sku: 'PW-DE-01',   desc: 'Powder · Natural 10/12',     mt:  610, stdEur: 6420, actEur: 6310, fxImpact: 22  },
    { sku: 'BN-ECU-FN',  desc: 'ECU Fine Flavour Beans',     mt:  820, stdEur: 8480, actEur: 8615, fxImpact: -19 },
    { sku: 'LQ-CH-02',   desc: 'Liquor · CH-02 Specialty',   mt:  330, stdEur: 9350, actEur: 9290, fxImpact: 12  },
    { sku: 'CK-DE-01',   desc: 'Cake · Press By-Product',     mt:  280, stdEur: 3180, actEur: 3120, fxImpact: 8   },
  ],

  /* ---- Open hedge positions (7) --------------------------------------- */
  hedges: [
    { id: 'HG-7001', book: 'CC NY Q3',  side: 'LONG',  contracts: 120, lots: 120, expiry: 'SEP26', avgPx: 7780, mtmEur: 386000,  status: 'EFFECTIVE' },
    { id: 'HG-7002', book: 'CC NY Q4',  side: 'LONG',  contracts: 95,  lots: 95,  expiry: 'DEC26', avgPx: 7910, mtmEur: 152000,  status: 'EFFECTIVE' },
    { id: 'HG-7003', book: 'C LDN Q3',  side: 'LONG',  contracts: 60,  lots: 60,  expiry: 'SEP26', avgPx: 5360, mtmEur: 41000,   status: 'WATCH'     },
    { id: 'HG-7004', book: 'FX EURUSD', side: 'SHORT', contracts: 40,  lots: 40,  expiry: 'SEP26', avgPx: 1.092,mtmEur: 28000,   status: 'EFFECTIVE' },
    { id: 'HG-7005', book: 'CC NY Q1',  side: 'LONG',  contracts: 70,  lots: 70,  expiry: 'MAR27', avgPx: 8050, mtmEur: -64000,  status: 'WATCH'     },
    { id: 'HG-7006', book: 'C LDN Q4',  side: 'LONG',  contracts: 45,  lots: 45,  expiry: 'DEC26', avgPx: 5470, mtmEur: -22000,  status: 'FAILED'    },
    { id: 'HG-7007', book: 'FX GBPUSD', side: 'SHORT', contracts: 25,  lots: 25,  expiry: 'DEC26', avgPx: 1.278,mtmEur: 11000,   status: 'EFFECTIVE' },
  ],

  /* ---- 12-month hedge coverage (demand vs hedged, MT) ----------------- */
  hedgeCoverage: {
    labels: ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'],
    demand: [2100,2050,1980,2150,2240,2300,2180,2090,2010,1960,1900,1880],
    hedged: [1900,1820,1680,1600,1540,1480,1180,980,820,640,520,410],
  },

  /* ---- Inventory valuation (9 SKUs) ----------------------------------- */
  inventory: [
    { sku: 'BN-CIV-STD', form: 'Beans',  location: 'Hamburg',   mt: 1240, wac: 7990,  valueK: 9908, aging: '<30d'   },
    { sku: 'BN-GHA-STD', form: 'Beans',  location: 'Antwerp',   mt: 880,  wac: 8060,  valueK: 7093, aging: '30-60d' },
    { sku: 'BN-ECU-FN',  form: 'Beans',  location: 'Antwerp',   mt: 410,  wac: 8500,  valueK: 3485, aging: '60-90d' },
    { sku: 'LQ-DE-01',   form: 'Liquor', location: 'Plant DE-01',mt: 520,  wac: 9100,  valueK: 4732, aging: '<30d'   },
    { sku: 'LQ-CH-02',   form: 'Liquor', location: 'Plant CH-02',mt: 180,  wac: 9340,  valueK: 1681, aging: '30-60d' },
    { sku: 'BT-DE-01',   form: 'Butter', location: 'Plant DE-01',mt: 340,  wac: 14900, valueK: 5066, aging: '<30d'   },
    { sku: 'PW-DE-01',   form: 'Powder', location: 'Plant DE-01',mt: 460,  wac: 6400,  valueK: 2944, aging: '30-60d' },
    { sku: 'CK-DE-01',   form: 'Cake',   location: 'In-Transit', mt: 210,  wac: 3160,  valueK: 664,  aging: '>90d'   },
    { sku: 'BN-CMR-STD', form: 'Beans',  location: 'In-Transit', mt: 360,  wac: 7820,  valueK: 2815, aging: '60-90d' },
  ],

  /* ---- 12-month forecast (Actual / Forecast / Budget, €M spend) ------- */
  forecast: {
    labels: ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'],
    actual:   [48.2, 46.8, 49.5, null, null, null, null, null, null, null, null, null],
    forecast: [48.2, 46.8, 49.5, 51.2, 53.8, 55.1, 52.4, 50.9, 49.2, 47.8, 46.5, 45.9],
    budget:   [51.8, 50.4, 50.9, 50.2, 51.5, 52.0, 51.1, 50.0, 49.8, 49.0, 48.2, 47.5],
  },

  /* ---- Scenario P&L impact (4) ---------------------------------------- */
  scenarios: [
    { name: 'Base', nyPx: 7842, prob: 50, pnlM: 0.0,  landed: 8142 },
    { name: 'Bull', nyPx: 8650, prob: 20, pnlM: -4.2, landed: 8720 },
    { name: 'Bear', nyPx: 7100, prob: 22, pnlM: 3.9,  landed: 7640 },
    { name: 'Tail', nyPx: 9400, prob: 8,  pnlM: -8.7, landed: 9180 },
  ],

  /* ---- Month-end close checklist (10) --------------------------------- */
  closeChecklist: [
    { task: 'GR/IR reconciliation',          owner: 'A. Brunner', due: 'WD+1', status: 'DONE',        notes: 'Cleared €0.3M aged items' },
    { task: 'Hedge MTM revaluation',         owner: 'You',         due: 'WD+1', status: 'DONE',        notes: 'IFRS 9 designations updated' },
    { task: 'Origin premium accruals',       owner: 'You',         due: 'WD+2', status: 'IN_PROGRESS', notes: 'RA/FT premiums pending DOM' },
    { task: 'In-transit cutoff',             owner: 'L. Meier',    due: 'WD+2', status: 'IN_PROGRESS', notes: '2 BLs awaiting confirmation' },
    { task: 'Freight accruals',              owner: 'L. Meier',    due: 'WD+2', status: 'OPEN',        notes: 'Baltic adj. not posted' },
    { task: 'Standard cost variance posting',owner: 'You',         due: 'WD+3', status: 'OPEN',        notes: 'Awaiting PPV sign-off' },
    { task: 'LCM / NRV test',                owner: 'A. Brunner', due: 'WD+3', status: 'OPEN',        notes: '1 SKU flagged (cake)' },
    { task: 'Hedge designation review',      owner: 'You',         due: 'WD+3', status: 'OPEN',        notes: 'HG-7006 effectiveness fail' },
    { task: 'Executive commentary',          owner: 'You',         due: 'WD+4', status: 'OPEN',        notes: 'Auto-draft ready' },
    { task: 'Power BI refresh & dist.',      owner: 'IT-BI',       due: 'WD+5', status: 'OPEN',        notes: 'Scheduled 06:00 CET' },
  ],

  /* ---- SOX controls (8) ----------------------------------------------- */
  controls: [
    { id: 'CTL-01', name: 'Contract approval > €1M',          freq: 'Per event', owner: 'Procurement Dir.', status: 'EFFECTIVE', lastTest: '2026-05-28' },
    { id: 'CTL-02', name: 'Daily futures position limit',     freq: 'Daily',     owner: 'Treasury',         status: 'EFFECTIVE', lastTest: '2026-06-16' },
    { id: 'CTL-03', name: 'Hedge designation documentation',  freq: 'Per trade', owner: 'You',              status: 'WATCH',     lastTest: '2026-06-10' },
    { id: 'CTL-04', name: 'Standard cost annual review',      freq: 'Annual',    owner: 'FP&A Lead',        status: 'EFFECTIVE', lastTest: '2026-01-15' },
    { id: 'CTL-05', name: 'PPV variance threshold (±3%)',     freq: 'Monthly',   owner: 'You',              status: 'EFFECTIVE', lastTest: '2026-05-31' },
    { id: 'CTL-06', name: 'Inventory cycle count',            freq: 'Monthly',   owner: 'Warehouse',        status: 'WATCH',     lastTest: '2026-05-20' },
    { id: 'CTL-07', name: 'S/4 ↔ iRely reconciliation',       freq: 'Monthly',   owner: 'A. Brunner',       status: 'EFFECTIVE', lastTest: '2026-05-31' },
    { id: 'CTL-08', name: 'Supplier master change review',    freq: 'Per event', owner: 'MDM Team',         status: 'GAP',       lastTest: '2026-04-30' },
  ],

  /* ---- Dashboard alerts (6: 2 high / 2 med / 2 low) ------------------- */
  alerts: [
    { sev: 'high', title: 'PC-2404 unpriced into DEC26',   body: '640 MT CIV PTBF unfixed — exposed to futures rally above €8,300.', time: '08:12' },
    { sev: 'high', title: 'HG-7006 effectiveness < 80%',   body: 'C LDN Q4 hedge ratio 74% — IFRS 9 corridor breach, de-designation likely.', time: '07:58' },
    { sev: 'med',  title: 'EUDR clock: 196 days',          body: 'CMR & NGA suppliers at <40% geo coverage for DDS readiness.', time: '07:40' },
    { sev: 'med',  title: 'Cake SKU below NRV',            body: 'CK-DE-01 WAC €3,160 vs NRV €3,040 — €25k reserve indicated.', time: '07:31' },
    { sev: 'low',  title: 'Forecast v4 ready for review',  body: 'Rolling forecast refreshed — €1.2M favorable vs v3.', time: '06:55' },
    { sev: 'low',  title: 'Power BI dataset refreshed',    body: 'Cocoa Procurement model refreshed 06:00 CET, 0 errors.', time: '06:02' },
  ],
};
