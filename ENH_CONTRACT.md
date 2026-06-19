# CACAO/FP — ENHANCEMENT MODULE CONTRACT (first wave)

Each enhancement is ONE self-contained `enh-*.js` file loaded AFTER `actions.js` (which already
called `switchView('dashboard')` once at boot). Modules self-install at top-level on load. They must
add behavior WITHOUT editing app.js / views2.js / actions.js / styles.css. Read `CONTRACT.md`,
`data.js`, `data2.js` first for the data shapes and design tokens.

## Globals available at runtime (call; never redefine)
`$`, `$$`, formatters (`fmtInt fmtNum fmtEur fmtEurM fmtM fmtUsd fmtGbp fmtPct fmtSignedPct fmtSigned signClass`),
`DATA`, `FILTERS`, `defaultFilters`, `saveFilters(f)`, `loadFilters()`, `VIEWS`, `switchView(name)`,
`CURRENT_VIEW`, `toast({type,title,body,meta})`, `modal({title,sub,body,footer})`, `closeModal()`,
`openDrawer({title,sub,body})`, `closeDrawer()`, `ACTIONS` (mutable map), `renderFilterBar()`,
`renderFilterChips()`, `generateCommentary()`. Vendored libs (globals): `Chart`, `XLSX`,
`jspdf` (use `const { jsPDF } = window.jspdf`), `PptxGenJS`.

## Design tokens (use these — match the terminal look)
`--bg-0..--bg-4`, `--line --line-2 --line-3`, `--text-0..--text-3`, `--accent --accent-2`,
`--pos --neg --warn --info --purple`, `--mono --sans`. Numerics → `var(--mono)`.

## HOOK PATTERNS (use exactly these — do NOT reassign `switchView`)
`switchView` is captured lexically by app.js (nav clicks call the original binding), so reassigning
the global does NOT intercept renders. Instead:

1. **Run code after EVERY view render** — observe the canvas, debounced, AND run once on load:
```js
function afterRender(fn){
  const canvas = document.getElementById('canvas');
  let t; const run = () => { clearTimeout(t); t = setTimeout(fn, 0); };
  new MutationObserver(run).observe(canvas, { childList: true, subtree: false });
  fn(); // initial pass for the already-rendered view
}
```
2. **Augment a specific view's output** — wrap its render (works because switchView reads
`VIEWS[name].render` at call time), then repaint if it's the current view:
```js
const _r = VIEWS.dashboard.render;
VIEWS.dashboard.render = () => _r() + myExtraCardHtml();
if (CURRENT_VIEW === 'dashboard') switchView('dashboard'); // CALLING switchView is fine; only reassigning it is not
```
3. **Add/replace an action** — `ACTIONS` is a live object the dispatcher reads per click:
```js
ACTIONS['export-excel'] = (payload, el) => { /* ... */ };
```
4. **Styles** — append ONE `<style>` to `<head>` with class names prefixed to your module
(`sv-`, `pt-`, `mb-`, `xp-`). Use the tokens above. Don't touch styles.css.
5. **Persistence** — localStorage keys prefixed `cacao_` (`cacao_views_v1`, `cacao_alerts_v1`,
`cacao_brief_dismissed`). Wrap in try/catch.
6. **Idempotency** — guard against double-install (e.g. `if (el.dataset.enhanced) return; el.dataset.enhanced='1'`).

## File ownership (no two modules write the same file)
- `enh-saved-views.js` — injects a "Views ▾" control into `#filter-bar`; saved filter presets.
- `enh-tables.js` — `afterRender` → enhance every `table.table` in `#canvas` (sort/search/sticky + sparklines).
- `enh-exports.js` — reassign `ACTIONS['export-excel'|'export-pdf'|'export-pptx'|'send-report']` to real generators.
- `enh-brief.js` — patch `VIEWS.dashboard.render` (Morning Brief card) + inject a topbar alerts-inbox bell.

Each file ends with its top-level install call(s). Return a short structured summary.
