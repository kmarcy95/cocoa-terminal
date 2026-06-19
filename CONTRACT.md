# CACAO/FP — BUILD CONTRACT (frozen interfaces)

This file is the **single source of truth** for the four code files built in parallel
(`styles.css`, `app.js`, `views2.js`, `actions.js`). Every cross-file reference —
CSS class names, helper signatures, the VIEWS registry, DATA fields, the action
dispatch convention — is fixed here. **Do not invent new global function names, new
CSS classes, or new DATA fields.** If you emit a class, it MUST be in §7 so the CSS
file styles it. Read `data.js` and `data2.js` for the exact data — they are real files.

Stack: vanilla HTML/CSS/JS + Chart.js 4.4.1 (global `Chart`). No build, no modules,
no frameworks. All functions are plain top-level declarations on the global scope.

---

## 1. File responsibilities & ownership (no file writes another file's file)

| File | Owns |
|------|------|
| `app.js`     | helpers (`$`,`$$`, formatters, chart helpers, `kpiBlock`), `VIEWS` registry (declares `const VIEWS = {}`), `switchView`, `CURRENT_VIEW`, `FILTERS` state + persistence, `WHATIF_STATE`, ticker/clock/nav boot, and the **9 core views** (dashboard, market, contracts, ppv, hedge, inventory, forecast, close, sox). |
| `views2.js`  | the **7 advanced views** (whatif, eudr, cashflow, versions, effectiveness, investigator, exports), `generateCommentary()`, the PPV-commentary patch, `renderFilterBar()`, `renderActivityRail()`, `recomputeWhatIf()`. |
| `actions.js` | `toast`, `modal`/`closeModal`, `openDrawer`/`closeDrawer`, the universal click **dispatcher**, the `ACTIONS` map (60+ handlers), 30+ modal factories, the **13 drill-drawer factories**, the card-action toggle handler, and the **single app boot call** (`switchView('dashboard')`). |
| `styles.css` | the full design system: tokens (§6), every class in §7, responsive (§8). |

## 2. Boot order (deterministic — scripts are at end of `<body>`, DOM is ready)

Each file runs its own top-level init at the **end** of the file, in load order:

1. `app.js` end (top-level, synchronous): `renderTicker(); startClock(); wireNav();`
   — **must NOT call `switchView`** (defer so patches register first).
2. `views2.js` end (top-level): registers the 7 advanced views into `VIEWS`,
   patches `VIEWS.ppv.render`, then `renderFilterBar(); renderActivityRail();`
   — **must NOT call `switchView`**.
3. `actions.js` end (top-level, LAST script): attaches the document click dispatcher,
   then calls **`switchView('dashboard')` exactly once**. This is the only initial view call.

Cross-file calls resolve at runtime (e.g. a filter `onchange` in `views2.js` calls
`toast()` from `actions.js`) — fine because handlers fire after all scripts load.

## 3. Global helpers (defined in `app.js`, used everywhere)

```js
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Formatters — ALL take a Number and return a String:
fmtInt(n)              // 7842        -> "7,842"        (grouped, 0 dp)
fmtNum(n, d = 0)       // 1.085, 3    -> "1.085"        (grouped, d dp)
fmtEur(n, d = 0)       // 8142        -> "€8,142"
fmtEurM(eur, d = 2)    // 1070000     -> "€1.07M"       (input is raw euros)
fmtM(n, d = 1)         // 48.2        -> "48.2M"        (input already in millions)
fmtUsd(n, d = 0)       // 7842        -> "$7,842"
fmtGbp(n, d = 0)       // 5418        -> "£5,418"
fmtPct(n, d = 1)       // 78          -> "78.0%"
fmtSignedPct(n, d=1)   // -6.9        -> "−6.9%"        (uses real minus "−", "+" prefix for >=0)
fmtSigned(n, d=0)      // -58         -> "−58"          (+ prefix for >=0)
signClass(n, invert=false) // returns "pos" or "neg"; if invert, flips
```

### Chart helpers (Chart.js global `Chart`)
```js
const _charts = {};                 // id -> Chart instance
mkChart(id, config)                 // new Chart($('#'+id), config); store in _charts[id]; return it
destroyCharts()                     // destroy every _charts[*], then reset _charts = {}
lineOpts({ dualAxis = false } = {})  // returns Chart options (dark theme, no aspect ratio)
barOpts({ stacked=false, indexAxis='x', valuePrefix='', valueSuffix='', showLegend=true } = {})
```
Chart theme constants used inside the helpers: grid color `#161e2a`, tick color `#7a8597`,
tick font `{ family: 'JetBrains Mono', size: 10 }`, legend label color `#b8c2d1`.
`responsive:true, maintainAspectRatio:false` always (charts live in `.chart-wrap`, a
fixed-height box). **Category-axis tick callback MUST be**
`function(value){ return this.getLabelForValue(value); }` (NOT an arrow returning `value`).

### KPI tile
```js
// k = { label, value, unit, chgPct, sub }  (see DATA.kpis)
kpiBlock(k, invertColor = false, kpiKey = '')
```
Returns an HTML string for one `.kpi` tile. It MUST:
- render `.kpi-label` (with a trailing `<span class="kpi-drill">▸</span>` when `kpiKey` is set),
- render `.kpi-value` + `.kpi-unit`,
- render `.kpi-chg` with class `pos`/`neg` from `signClass(k.chgPct, invertColor)` and text `fmtSignedPct(k.chgPct)`,
- render `.kpi-sub` = `k.sub`,
- put `data-action="drill-kpi" data-payload="<kpiKey>"` on the tile root when `kpiKey` is set.

## 4. VIEWS registry + switchView

```js
const VIEWS = {};   // declared in app.js
// each entry: VIEWS.<name> = { render: () => htmlString, draw: () => void }
// draw is optional; switchView must guard `v.draw && v.draw()`.

function switchView(name){
  destroyCharts();
  const v = VIEWS[name]; if(!v) return;
  $('#canvas').innerHTML = v.render();
  $('#canvas').scrollTop = 0;
  CURRENT_VIEW = name;
  setTimeout(() => { v.draw && v.draw(); }, 30);
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
}
let CURRENT_VIEW = 'dashboard';
```
View `render()` returns a full HTML string. Standard view header markup:
```html
<div class="view-head">
  <div><div class="view-title">PPV Analysis</div><div class="view-sub">…</div></div>
  <div class="view-actions"><button class="btn btn-ghost" data-action="…">…</button></div>
</div>
<!-- then .grid-* of .card blocks -->
```
The 7 advanced views are registered in `views2.js`. The PPV commentary patch wraps the
original render: `const _ppv = VIEWS.ppv.render; VIEWS.ppv.render = () => _ppv() + commentaryCard();`

## 5. FILTERS + WHATIF state (declared in app.js)

```js
const FILTERS_KEY = 'cacao_filters_v1';
const defaultFilters = {
  period:'Jun 2026 (MTD)', origin:'All origins', supplier:'All suppliers',
  sku:'All SKUs', currency:'EUR', version:'v5 · June Rolling (CURRENT)'
};
let FILTERS = loadFilters();              // { ...defaultFilters, ...persisted }
function saveFilters(f){ FILTERS = f; try{ localStorage.setItem(FILTERS_KEY, JSON.stringify(f)); }catch{} }
function loadFilters(){ try{ return {...defaultFilters, ...JSON.parse(localStorage.getItem(FILTERS_KEY)||'{}')}; }catch{ return {...defaultFilters}; } }
let WHATIF_STATE = { ...DATA.whatIf.baseline };   // mutated by sliders in views2
```
Filter-bar behavior (`views2.js`): a `<select>` per taxonomy key; on change →
update FILTERS, `saveFilters(FILTERS)`, re-render chips, `switchView(CURRENT_VIEW)`,
and `toast({type:'info', title:'Filter applied', body:…})`. Non-default filters render
as dismissible `.chip` with `data-action="clear-filter" data-payload="<key>"`. A
`.filter-reset` carries `data-action="reset-filters"`.

## 6. Design tokens (styles.css `:root`)

```css
--bg-0:#0a0d12; --bg-1:#0f141b; --bg-2:#141b25; --bg-3:#1b2330; --bg-4:#232c3b;
--line:#1f2937; --line-2:#2a3547; --line-3:#374357;
--text-0:#e8edf5; --text-1:#b8c2d1; --text-2:#7a8597; --text-3:#515c6d;
--accent:#c9a96e; --accent-2:#8b6f3f; --accent-dim:#6b542d;
--pos:#2dd4a4; --pos-dim:#15604f; --neg:#ff5466; --neg-dim:#6b1f29;
--warn:#f5b342; --info:#4aa3ff; --purple:#a78bfa;
--mono:'JetBrains Mono',ui-monospace,monospace; --sans:'Inter',system-ui,sans-serif;
```
Numerics, IDs, prices → always `var(--mono)`. UI text → `var(--sans)`. App bg `--bg-0`,
cards `--bg-1`, card headers/nested `--bg-2`, hover/inputs `--bg-3`.

Status → color mapping (used by `.badge-*`, `.pill-*`, `.tl-dot`, `.qstat-value`, `.dot`):
`pos`→--pos, `neg`→--neg, `warn`→--warn, `info`→--info, `muted`→--text-2.
Semantic status strings map as: `EFFECTIVE|DONE|FIXED|PASS|PAID|SUBMITTED|CURRENT`→pos;
`WATCH|IN_PROGRESS|OPEN|PARTIAL|PENDING|DRAFT|WORKING`→warn;
`FAILED|GAP|FAIL|UNPRICED|NONE`→neg; `SUPERSEDED|FROZEN|BUDGET`→muted/info.

## 7. CSS class vocabulary (styles.css MUST style ALL; views use ONLY these)

**Shell/chrome:** `topbar brand brand-mark brand-slash brand-sub ticker-strip ticker-item ticker-sym ticker-px ticker-chg topbar-right session-clock clock-time clock-zone topbar-actions filter-bar shell sidenav nav-section nav-label nav-item nav-ico nav-text nav-foot nav-foot-row dot dot-pos dot-warn dot-neg canvas fab fab-ico fab-badge activity-rail toast-stack modal-root drawer-root`

**View frame:** `view-head view-title view-sub view-actions grid grid-2 grid-3 grid-4 grid-2-1 grid-1-2 card card-head card-title card-sub card-body card-actions card-action card-foot`

**KPIs / values:** `hero-kpis kpi kpi-label kpi-value kpi-unit kpi-sub kpi-chg kpi-drill pos neg warn info muted mono accent big`

**Pills/badges:** `pill pill-pos pill-neg pill-warn pill-info pill-row badge badge-pos badge-neg badge-warn badge-info badge-muted`

**Tables:** `table-wrap table num row-click cell-strong th-num`

**KV / qstat / timeline / quick:** `kv-list kv kv-k kv-v qstat-grid qstat qstat-label qstat-value section-title timeline tl-item tl-dot tl-body tl-time quick-actions`

**Charts/bars:** `chart-wrap bar-h bar-h-fill progress progress-bar progress-label`

**Waterfall (custom):** `waterfall wf-col wf-bar wf-bar-inner wf-label wf-val wf-connector`

**Gauge (IFRS9 corridor):** `gauge gauge-track gauge-band gauge-marker gauge-label gauge-val`

**Filters:** `chip chip-x filter-group filter-label filter-select filter-reset filter-chips`

**Sliders (what-if):** `slider-row slider-head slider-label slider-val slider-input sensitivity`

**Chain (investigator):** `chain chain-step chain-glyph chain-dot chain-mid chain-id chain-label chain-detail chain-arrow`

**Alerts/news:** `alert-feed alert-item alert-sev alert-title alert-body alert-time news-feed news-item news-time news-title news-body`

**Donut/origin:** `donut-wrap origin-pills origin-pill`

**Phone mockup:** `phone phone-notch phone-screen phone-row`

**Buttons:** `btn btn-primary btn-ghost btn-danger btn-sm`

**Toast:** `toast toast-title toast-body toast-meta` (+ state classes `success warn error info` on `.toast`)

**Modal:** `modal-scrim modal-card modal-head modal-title modal-sub modal-body modal-foot form-row form-label form-input form-grid form-help qstat-grid` (modals reuse qstat-grid)

**Drawer:** `drawer-scrim drawer drawer-head drawer-title drawer-sub drawer-close drawer-body`

**Activity rail:** `rail-head rail-title rail-close rail-body rail-item rail-avatar rail-meta rail-name rail-team rail-action rail-target rail-body-text rail-time rail-composer rail-input mention` (rail opens via `.activity-rail.open`)

## 8. Responsive — single breakpoint at 920px (styles.css)
```css
@media (max-width:920px){
  .ticker-strip,.session-clock{display:none;}
  .shell{grid-template-columns:1fr;} .sidenav{display:none;}
  .hero-kpis{grid-template-columns:1fr 1fr;}
  .grid-4,.grid-3,.grid-2,.grid-2-1,.grid-1-2{grid-template-columns:1fr !important;}
  .activity-rail{width:100%;}
}
```

## 9. UI primitives (defined in actions.js)

```js
toast({ type='info', title, body='', meta='' })   // append .toast to #toast-stack; auto-remove ~3.8s
modal({ title, sub='', body='', footer='' })       // render scrim+card into #modal-root; scrim click closes; inner card stops propagation
closeModal()                                       // empty #modal-root
openDrawer({ title, sub='', body='' })             // render scrim+drawer into #drawer-root; scrim click closes
closeDrawer()                                      // empty #drawer-root
```
Modal footer buttons use real handlers via `onclick="closeModal()"` or `data-action="…"`.
A close button uses `data-action="close-modal"` / `data-action="close-drawer"`.

## 10. Action dispatch convention (actions.js)

```js
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if(!el) return;
  const handler = ACTIONS[el.dataset.action];
  if(handler){ e.preventDefault(); handler(el.dataset.payload, el); }
});
```
Every interactive element uses `data-action="<name>"` and optional `data-payload="<string>"`.
`ACTIONS` is a flat map `{ '<name>': (payload, el) => {…} }`. Handlers either `toast`, open a
`modal`, open a drawer (`openDrawer`), toggle the rail, or navigate (`switchView`).

**Required action names** (views emit these; actions.js implements all):
- chrome: `refresh export-excel export-pbi export-pdf export-pptx run-forecast snapshot-dashboard toggle-rail close-modal close-drawer reset-filters clear-filter post-activity`
- market: `set-alert strategy-book new-position`
- contracts: `new-contract import-irely fix-ptbf`
- hedge: `new-hedge effectiveness-test var-report run-prospective export-pwc dedesignate-failed`
- inventory: `cycle-count lcm-test reserve-calc`
- forecast: `lock-forecast compare-versions run-scenarios branch-current submit-approval`
- close: `open-blackline sign-off`
- sox: `evidence-repo audit-requests run-test`
- eudr: `submit-dds risk-heatmap compliance-report`
- cashflow: `sync-treasury liquidity-stress export-treasury`
- whatif: `reset-whatif save-scenario compare-scenarios`
- commentary: `generate-commentary copy-commentary send-commentary`
- investigator: `open-s4 export-trail add-comment tag-reviewer escalate`
- drill (13): `drill-kpi drill-origin drill-supplier drill-sku drill-alert drill-control drill-lot drill-task drill-margin-call drill-activity drill-recon drill-je drill-driver`
- segment toggles: `card-toggle` (generic; toggles `.active` among sibling `.card-action`, then toasts)

`drill-kpi` payload = kpi key (`spendMTD|avgCost|ppvMTD|hedgeCov|invValue`); `drill-origin`
payload = origin code; `drill-sku` payload = sku id; `drill-supplier` payload = supplier
name; `drill-alert` payload = alert index; etc. Drawer factories read the matching DATA
record by payload and render the §11 anatomy.

## 11. Drill-drawer anatomy (every drawer body follows this)
```html
<div class="qstat-grid">
  <div class="qstat"><div class="qstat-label">…</div><div class="qstat-value pos">…</div></div>  <!-- ×4 -->
</div>
<div class="section-title">Attributes</div>
<div class="kv-list">
  <div class="kv"><span class="kv-k">…</span><span class="kv-v mono">…</span></div>            <!-- n rows -->
</div>
<div class="section-title">History</div>                                                       <!-- when temporal -->
<div class="timeline">
  <div class="tl-item"><span class="tl-dot pos"></span><div class="tl-body">… <span class="tl-time">…</span></div></div>
</div>
<div class="section-title">Quick actions</div>
<div class="quick-actions">
  <button class="btn btn-sm" data-action="…">…</button>                                          <!-- ×4 -->
</div>
```

## 12. DATA reference (read data.js / data2.js for exact values)

Core (`data.js`): `ticker[]{sym,name,px,unit,chg,chgPct}` · `kpis{spendMTD,avgCost,ppvMTD,hedgeCov,invValue,fcastAccuracy each {label,value,unit,chgPct,sub,invert}}` · `originSpend[]{code,name,spendM,mt,certPct,premiumUsd,color}` · `costBridge[]{label,value,type:base|add|sub|total}` · `futuresCurve{labels[],ny[],ldn[]}` · `spotHistory{labels[],ny[],ldn[]}` · `contracts[]{id,origin,supplier,basis,mt,execMonth,price,diff,status,cert,hedgePct,po,irely}` · `ppvDetail[]{sku,desc,mt,stdEur,actEur,fxImpact}` (var €/t = actEur−stdEur) · `hedges[]{id,book,side,contracts,lots,expiry,avgPx,mtmEur,status}` · `hedgeCoverage{labels[],demand[],hedged[]}` · `inventory[]{sku,form,location,mt,wac,valueK,aging}` · `forecast{labels[],actual[],forecast[],budget[]}` · `scenarios[]{name,nyPx,prob,pnlM,landed}` · `closeChecklist[]{task,owner,due,status,notes}` · `controls[]{id,name,freq,owner,status,lastTest}` · `alerts[]{sev,title,body,time}`

Enhancement (`data2.js`): `hedgeEffectiveness{designations[]{id,name,ratio,status,method}, history{labels[],des01[],des03[],des04[]}, pnlImpact{ociAccumulated,ineffectiveToPnl,reclassOnSettle}}` · `eudr{summary{compliant,partial,atRisk,ddsClock,geoAvg}, bySupplier[]{supplier,origin,geoPct,dds,cert,risk,lastAudit}, chainOfCustody[]{lot,supplier,origin,geo,polygons,coverage}, roadmap[]{name,pct}}` · `forecastVersions[]{id,name,status,owner,date,ppvM,landed}` · `versionDiff[]{assumption,v1,v2,v3,delta}` · `cashFlow{labels[],physical[],margin[],freight[],closeout[]}` · `marginCalls[]{date,broker,amountK,reason,status}` · `activity[]{user,avatar,team,action,target,body,time}` · `drillChain{sku,desc,varianceEur,steps[]{type,id,label,status,detail}}` · `whatIf{baseline{nyPx,ldnPx,eurusd,civDiff,sustain,freight,volume,hedgeCov,stdCost}}` · `scheduledReports[]{name,cadence,recipients,format,next}` · `recon[]{account,s4,irely,deltaK,status}` (Close view + drill-recon) · `journalEntries[]{je,desc,dr,cr,amountK,status,owner}` (Close view + drill-je) · `filterTaxonomy{periods[],origins[],suppliers[],skus[],currencies[],versions[]}`

### Addendum actions (beyond §10 — emitted by views, implemented in actions.js)
`view-contract` (payload=contract id → contract-detail **modal**) · `drill-version` (payload=version id → **drawer**, reads `forecastVersions`) · `send-report` (payload=report name → toast confirm).
