# CACAO/FP — ENHANCEMENT CONTRACT — ADDENDUM (second wave)

Read `ENH_CONTRACT.md` first — all of its rules still apply (self-installing `enh-*.js` loaded after
the first-wave modules; design tokens; inject one prefixed `<style>`; idempotent; localStorage `cacao_`
prefix; never reassign `switchView`; zero console errors). This adds patterns the second-wave modules need.

## Already-installed globals you may rely on (first wave shipped)
The first wave added: `XLSX`, `window.jspdf.jsPDF`, `PptxGenJS` (vendored). Modules
`enh-saved-views/tables/exports/brief` are loaded BEFORE these. `VIEWS.ppv.render` and
`VIEWS.dashboard.render` are ALREADY WRAPPED (commentary patch + morning brief). Compose, don't clobber.

## NEW PATTERNS

### A. Compose-wrap a render that may already be wrapped
```js
const _r = VIEWS.ppv.render;                 // could already be wrapped by views2/brief — fine
VIEWS.ppv.render = function () { return _r() + myCardHtml(); };
if (CURRENT_VIEW === 'ppv') switchView('ppv'); // CALL switchView (allowed); never REASSIGN it
```
Append your card; keep the prior output intact. Order across modules composes (each wraps the previous).

### B. A Chart.js chart INSIDE a modal (separate from the view `_charts` lifecycle)
`destroyCharts()` (called on every view switch) must NOT manage modal charts. Keep a module-local
handle, draw after the modal DOM exists, and destroy it when the modal closes:
```js
let _modalChart = null;
modal({ title:'…', body:'<div class="chart-wrap"><canvas id="mc-hist"></canvas></div>', footer:'…' });
setTimeout(() => { const el = document.getElementById('mc-hist'); if (el) _modalChart = new Chart(el, cfg); }, 30);
// wrap closeModal so the modal chart is torn down:
const _close = closeModal; closeModal = function(){ if (_modalChart){ _modalChart.destroy(); _modalChart=null; } return _close(); };
```
(Reassigning `closeModal` — a top-level `function` in actions.js — is acceptable; it is called, not lexically captured by other modules. If unsure, instead destroy on the next document click outside, or null-guard re-entry.)

### C. Cross-filter from chart clicks via the `_charts` global
Charts are stored in the global `_charts` map after a view's `draw()`. Use the `afterRender` observer
(ENH_CONTRACT §1) then, for charts whose labels map to a taxonomy, attach an onClick that sets a filter:
```js
afterRender(() => {
  const c = _charts['c-origin']; if (!c || c.__xf) return; c.__xf = true;
  c.options.onClick = (evt, els) => {
    if (!els.length) return;
    const label = c.data.labels[els[0].index];                  // e.g. an origin name/code
    const code = matchTaxonomy('origin', label);                 // map label→FILTERS.origin value
    if (code){ FILTERS.origin = code; saveFilters(FILTERS); renderFilterBar(); switchView(CURRENT_VIEW);
               toast({type:'info',title:'Filtered',body:'Origin → '+code}); }
  };
  c.update();
});
```
Only wire charts whose segments map cleanly to a real filter key (origin/supplier/sku/period/version).

### D. Hash routing with an echo-guard (no infinite loops)
Sync `CURRENT_VIEW` + `FILTERS` to `location.hash`; restore on load + on `hashchange`. Guard against the
write→hashchange→read→write loop with a module flag:
```js
let _applying = false;
function writeHash(){ if (_applying) return; const h = buildHash(CURRENT_VIEW, FILTERS); if ('#'+h !== location.hash) { _applying = true; location.hash = h; setTimeout(()=>_applying=false, 0); } }
function applyHash(){ if (_applying) return; _applying = true; const {view, filters} = parseHash(location.hash); Object.assign(FILTERS, filters); saveFilters(FILTERS); renderFilterBar(); if (view && VIEWS[view]) switchView(view); else switchView(CURRENT_VIEW); setTimeout(()=>_applying=false, 0); }
window.addEventListener('hashchange', applyHash);
afterRender(writeHash);   // CURRENT_VIEW/FILTERS changed → reflect in the URL
applyHash();              // on load: restore deep-linked state
```

### E. A global keydown overlay (command palette)
Add a `keydown` listener for Ctrl/Cmd-K (`e.key==='k' && (e.metaKey||e.ctrlKey)` → `e.preventDefault()`),
toggle a full-screen overlay you inject into `<body>`. Other modules already bind Escape/keys — coexist
(check `e.defaultPrevented`, don't `stopImmediatePropagation` globally). Index `Object.keys(VIEWS)` +
high-value `ACTIONS` verbs + named entities from DATA (contract ids, hedge ids, skus, suppliers). Fuzzy
filter, ↑/↓ to move, Enter to run (`switchView(name)` or `ACTIONS[verb]()`), Escape to close.

### F. Seeded PRNG for reproducible simulations (Monte Carlo)
Browser `Math.random` is allowed here, but prefer a fixed-seed PRNG so VaR/ES are stable across runs:
```js
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const rnd = mulberry32(0xC0C0A);  // gaussian via Box–Muller from two rnd()
```

## Second-wave file ownership (one file each — no shared writes)
- `enh-cmdk.js` — #13 command palette (pattern E).
- `enh-routing.js` — #14 hash deep-link routing (pattern D). LOAD LAST so it restores deep-links after all views/actions are wired.
- `enh-crossfilter.js` — #17 chart click → filter (pattern C).
- `enh-ppv-bridge.js` — #1 five-way PPV attribution (pattern A; reuse `.waterfall` classes + a per-SKU table).
- `enh-var-mc.js` — #7 Monte-Carlo VaR/ES, reassign `ACTIONS['var-report']` (pattern B + F).
- `enh-ptbf.js` — #11 PTBF cockpit; compose-wrap `VIEWS.market.render` (pattern A).
