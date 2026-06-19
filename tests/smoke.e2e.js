/* ============================================================================
   CACAO/FP — e2e smoke test (enhancement #23)
   Loads the running app, switches through all 16 views, opens a drill drawer,
   and asserts ZERO console/page errors. Standalone (no test runner):
     1) serve the folder:  python -m http.server 8770
     2) node tests/smoke.e2e.js   (set CACAO_URL to override the base URL)
   Skips gracefully (exit 0) if Playwright isn't installed.
   ========================================================================== */

let pw;
try { pw = require('playwright'); }
catch { console.log('SKIP — playwright not installed (npm i -D playwright && npx playwright install chromium)'); process.exit(0); }

const URL = process.env.CACAO_URL || 'http://127.0.0.1:8770/index.html';

(async () => {
  const errors = [];
  const browser = await pw.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle' });

  const views = await page.evaluate(() => Object.keys(VIEWS));
  if (views.length !== 16) { errors.push(`expected 16 views, got ${views.length}`); }

  for (const v of views) {
    await page.evaluate((n) => switchView(n), v);
    await page.waitForTimeout(180);
    const len = await page.evaluate(() => document.querySelector('#canvas').innerHTML.length);
    if (len < 200) errors.push(`view ${v} rendered thin (${len} chars)`);
  }

  // drill drawer round-trip
  await page.evaluate(() => switchView('dashboard'));
  await page.waitForTimeout(120);
  await page.evaluate(() => ACTIONS['drill-kpi'] && ACTIONS['drill-kpi']('spendMTD'));
  const drawer = await page.evaluate(() => !!document.querySelector('#drawer-root .drawer'));
  if (!drawer) errors.push('drill-kpi drawer did not open');

  // real export libs present (enhancement #27)
  const libs = await page.evaluate(() => ({ xlsx: typeof XLSX !== 'undefined', jspdf: !!(window.jspdf && window.jspdf.jsPDF), pptx: typeof PptxGenJS !== 'undefined' }));
  for (const [k, ok] of Object.entries(libs)) if (!ok) errors.push(`export lib missing: ${k}`);

  await browser.close();

  if (errors.length) { console.log('FAIL — ' + errors.length + ' issue(s):'); errors.forEach((e) => console.log('  ✗ ' + e)); process.exit(1); }
  console.log(`PASS — ${views.length} views, drill drawer, export libs OK · zero console/page errors`);
})();
