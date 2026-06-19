/* ============================================================================
   CACAO/FP — enh-tables.js  (enhancement #16)
   Self-installing module: sortable / searchable / sticky tables + sparklines.

   Loaded AFTER actions.js. Adds behavior WITHOUT editing app.js / views2.js /
   actions.js / styles.css. Uses ONLY the documented hook patterns from
   ENH_CONTRACT.md:
     - afterRender(fn): MutationObserver on #canvas + an initial pass.
     - one injected <style> with module-prefixed class names (pt-*).
     - reads globals (CURRENT_VIEW) but never redefines them.

   For every `table.table` inside #canvas not yet enhanced it adds:
     1. Sticky header (z-index'd, var(--bg-2) background).
     2. Click-to-sort headers (numeric-aware, asc/desc toggle, active caret).
     3. A search toolbar (filter rows + live count) for non-tiny tables.
     4. A deterministic, clearly-synthetic "Trend" sparkline column — ONLY on
        the ppv / hedge / inventory views.

   Idempotent (guarded against double-install AND per-table re-enhancement),
   re-runs cleanly after every view switch, localStorage-free, zero console
   errors. Wrapped in an IIFE; installs at top level on load.
   ========================================================================== */
(function () {
  'use strict';

  /* -- Hard guard against double-install of the whole module --------------- */
  if (window.__ptTablesInstalled) return;
  window.__ptTablesInstalled = true;

  /* -- Constants ----------------------------------------------------------- */
  var MIN_ROWS_FOR_SEARCH = 4;               // skip toolbar for tiny tables
  var SPARK_VIEWS = { ppv: 1, hedge: 1, inventory: 1 };
  var SPARK_POINTS = 12;
  var SPARK_W = 64;
  var SPARK_H = 18;
  var SPARK_PAD = 2;                          // inner vertical padding for the line

  /* ------------------------------------------------------------------------ *
   * afterRender — run fn after EVERY canvas render, debounced, + initial pass *
   * (verbatim shape from ENH_CONTRACT §1)                                     *
   * ------------------------------------------------------------------------ */
  function afterRender(fn) {
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    var t;
    var run = function () {
      clearTimeout(t);
      t = setTimeout(fn, 0);
    };
    new MutationObserver(run).observe(canvas, { childList: true, subtree: false });
    fn(); // initial pass for the already-rendered view
  }

  /* ------------------------------------------------------------------------ *
   * Numeric-aware value extraction                                            *
   * ------------------------------------------------------------------------ */
  // Strip currency/percent/grouping glyphs and parse a float. Handles the
  // real-minus glyph "−" the formatters emit (fmtSignedPct / fmtSigned).
  function numericValue(text) {
    if (text == null) return NaN;
    var cleaned = String(text)
      .replace(/−/g, '-')               // real minus → ASCII hyphen
      .replace(/[€£$%,\s]/g, '')             // currency / percent / grouping
      .replace(/[^0-9.\-+eE]/g, '');         // drop any remaining non-numeric
    if (cleaned === '' || cleaned === '-' || cleaned === '+' || cleaned === '.') {
      return NaN;
    }
    var n = parseFloat(cleaned);
    return isNaN(n) ? NaN : n;
  }

  function cellText(row, colIndex) {
    var cell = row.children[colIndex];
    return cell ? (cell.textContent || '').trim() : '';
  }

  /* ------------------------------------------------------------------------ *
   * Deterministic sparkline (NO Math.random — seeded by row's first cell)     *
   * ------------------------------------------------------------------------ */
  // FNV-1a-ish 32-bit string hash → stable unsigned seed.
  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // Mulberry32 PRNG — deterministic, seeded; gives a smooth-ish 12pt series.
  function seededSeries(seed, count) {
    var state = seed >>> 0;
    var out = [];
    var prev = 0.5;
    for (var i = 0; i < count; i++) {
      state |= 0; state = (state + 0x6D2B79F5) | 0;
      var r = Math.imul(state ^ (state >>> 15), 1 | state);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      var u = ((r ^ (r >>> 14)) >>> 0) / 4294967296; // 0..1
      // random-walk toward the new draw for a believable trend shape
      prev = prev + (u - prev) * 0.55;
      if (prev < 0.04) prev = 0.04;
      if (prev > 0.96) prev = 0.96;
      out.push(prev);
    }
    return out;
  }

  function sparklineSvg(seedText) {
    var series = seededSeries(hashString(seedText || 'cacao'), SPARK_POINTS);
    var min = Math.min.apply(null, series);
    var max = Math.max.apply(null, series);
    var span = (max - min) || 1;
    var usableH = SPARK_H - SPARK_PAD * 2;
    var stepX = SPARK_W / (SPARK_POINTS - 1);
    var pts = [];
    for (var i = 0; i < series.length; i++) {
      var x = (i * stepX).toFixed(1);
      // invert Y so higher values sit higher in the box
      var norm = (series[i] - min) / span;
      var y = (SPARK_PAD + (1 - norm) * usableH).toFixed(1);
      pts.push(x + ',' + y);
    }
    var lastX = (SPARK_W - 1).toFixed(1);
    var lastNorm = (series[series.length - 1] - min) / span;
    var lastY = (SPARK_PAD + (1 - lastNorm) * usableH).toFixed(1);
    return (
      '<svg class="pt-spark" width="' + SPARK_W + '" height="' + SPARK_H + '" ' +
      'viewBox="0 0 ' + SPARK_W + ' ' + SPARK_H + '" ' +
      'preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<polyline points="' + pts.join(' ') + '" ' +
      'fill="none" stroke="var(--accent)" stroke-width="1.25" ' +
      'stroke-linejoin="round" stroke-linecap="round" />' +
      '<circle cx="' + lastX + '" cy="' + lastY + '" r="1.4" fill="var(--accent)" />' +
      '</svg>'
    );
  }

  /* ------------------------------------------------------------------------ *
   * Sorting                                                                   *
   * ------------------------------------------------------------------------ */
  function getBodyRows(table) {
    var tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return { tbody: null, rows: [] };
    // Only real data rows (skip any spacer rows with no cells).
    var rows = Array.prototype.filter.call(tbody.rows, function (r) {
      return r.cells && r.cells.length > 0;
    });
    return { tbody: tbody, rows: rows };
  }

  function clearCarets(table) {
    var carets = table.querySelectorAll('.pt-caret');
    for (var i = 0; i < carets.length; i++) carets[i].textContent = '';
    var ths = table.tHead ? table.tHead.querySelectorAll('th') : [];
    for (var j = 0; j < ths.length; j++) ths[j].classList.remove('pt-sort-active');
  }

  function sortBy(table, th, colIndex) {
    var info = getBodyRows(table);
    if (!info.tbody || info.rows.length < 2) return;

    // Toggle direction; default ascending on first activation of a column.
    var dir = th.dataset.ptDir === 'asc' ? 'desc' : 'asc';
    // Reset other columns' stored direction so each starts fresh.
    var allTh = table.tHead.querySelectorAll('th');
    for (var k = 0; k < allTh.length; k++) {
      if (allTh[k] !== th) delete allTh[k].dataset.ptDir;
    }
    th.dataset.ptDir = dir;

    var rows = info.rows.slice();
    rows.sort(function (a, b) {
      var ta = cellText(a, colIndex);
      var tb = cellText(b, colIndex);
      var na = numericValue(ta);
      var nb = numericValue(tb);
      var cmp;
      if (!isNaN(na) && !isNaN(nb)) {
        cmp = na - nb;
      } else {
        cmp = ta.localeCompare(tb, undefined, { numeric: true, sensitivity: 'base' });
      }
      return dir === 'asc' ? cmp : -cmp;
    });

    // Re-append the SAME <tr> nodes (preserves data-action for row-drill).
    var frag = document.createDocumentFragment();
    for (var r = 0; r < rows.length; r++) frag.appendChild(rows[r]);
    info.tbody.appendChild(frag);

    // Caret + active styling.
    clearCarets(table);
    th.classList.add('pt-sort-active');
    var caret = th.querySelector('.pt-caret');
    if (caret) caret.textContent = dir === 'asc' ? '▲' : '▼'; // ▲ / ▼
  }

  function makeHeaderSortable(table) {
    var thead = table.tHead;
    if (!thead) return;
    var headRow = thead.rows[thead.rows.length - 1]; // last header row = data columns
    if (!headRow) return;

    Array.prototype.forEach.call(headRow.cells, function (th, idx) {
      if (th.dataset.ptSortable === '1') return;
      th.dataset.ptSortable = '1';
      th.classList.add('pt-th-sortable');

      // Append a caret slot without disturbing existing header text/markup.
      var caret = document.createElement('span');
      caret.className = 'pt-caret';
      th.appendChild(caret);

      th.addEventListener('click', function () {
        sortBy(table, th, idx);
      });
    });
  }

  /* ------------------------------------------------------------------------ *
   * Search toolbar                                                            *
   * ------------------------------------------------------------------------ */
  function countVisible(rows) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].style.display !== 'none') n++;
    }
    return n;
  }

  function buildToolbar(table) {
    var info = getBodyRows(table);
    if (info.rows.length < MIN_ROWS_FOR_SEARCH) return; // skip tiny tables

    var total = info.rows.length;

    var toolbar = document.createElement('div');
    toolbar.className = 'pt-toolbar';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'pt-search';
    input.placeholder = 'Filter rows…';
    input.setAttribute('aria-label', 'Filter table rows');
    input.autocomplete = 'off';
    input.spellcheck = false;

    var hint = document.createElement('span');
    hint.className = 'pt-count';
    hint.textContent = total + ' rows';

    toolbar.appendChild(input);
    toolbar.appendChild(hint);

    var applyFilter = function () {
      var q = input.value.trim().toLowerCase();
      var rows = getBodyRows(table).rows;
      if (!q) {
        for (var i = 0; i < rows.length; i++) rows[i].style.display = '';
        hint.textContent = rows.length + ' rows';
        return;
      }
      for (var j = 0; j < rows.length; j++) {
        var match = (rows[j].textContent || '').toLowerCase().indexOf(q) !== -1;
        rows[j].style.display = match ? '' : 'none';
      }
      hint.textContent = countVisible(rows) + ' of ' + rows.length;
    };

    input.addEventListener('input', applyFilter);

    // Insert immediately before the table (or its scroll wrapper, so the bar
    // sits above the horizontally-scrolling box rather than inside it).
    var anchor = table.closest('.table-wrap') || table;
    if (anchor.parentNode) {
      anchor.parentNode.insertBefore(toolbar, anchor);
    }
  }

  /* ------------------------------------------------------------------------ *
   * Sparkline "Trend" column (ppv / hedge / inventory only)                   *
   * ------------------------------------------------------------------------ */
  function addSparklineColumn(table) {
    var thead = table.tHead;
    var info = getBodyRows(table);
    if (!thead || !info.rows.length) return;

    var headRow = thead.rows[thead.rows.length - 1];
    if (!headRow || headRow.querySelector('.pt-trend-th')) return;

    // Prepend a "Trend" header cell.
    var th = document.createElement('th');
    th.className = 'pt-trend-th';
    th.textContent = 'Trend';
    th.title = 'Synthetic 12-pt illustrative trend';
    // Mark non-sortable so makeHeaderSortable (run earlier) won't touch it; and
    // intercept clicks so a stray sort doesn't fire on the synthetic column.
    th.dataset.ptSortable = '1';
    th.addEventListener('click', function (e) { e.stopPropagation(); });
    headRow.insertBefore(th, headRow.firstChild);

    // Per-row sparkline cell seeded by the row's first (original) cell text.
    for (var i = 0; i < info.rows.length; i++) {
      var row = info.rows[i];
      var seedText = cellText(row, 0) || ('row-' + i);
      var td = document.createElement('td');
      td.className = 'pt-trend-td';
      td.innerHTML = sparklineSvg(seedText);
      row.insertBefore(td, row.firstChild);
    }
  }

  /* ------------------------------------------------------------------------ *
   * Enhance one table                                                         *
   * ------------------------------------------------------------------------ */
  function enhanceTable(table) {
    if (!table || table.dataset.ptEnhanced === '1') return;
    table.dataset.ptEnhanced = '1';
    table.classList.add('pt-enhanced');

    try {
      // Sparklines FIRST so the new "Trend" column gets a caret slot / index
      // alignment from the subsequent header pass.
      var view = (typeof CURRENT_VIEW !== 'undefined') ? CURRENT_VIEW : '';
      if (SPARK_VIEWS[view]) {
        addSparklineColumn(table);
      }
      makeHeaderSortable(table);
      buildToolbar(table);
    } catch (err) {
      // Never let one bad table break the page; leave it un-enhanced-but-usable.
      table.dataset.ptEnhanced = '1';
    }
  }

  /* ------------------------------------------------------------------------ *
   * Enhance every eligible table currently in the canvas                      *
   * ------------------------------------------------------------------------ */
  function enhanceAll() {
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    var tables = canvas.querySelectorAll('table.table');
    for (var i = 0; i < tables.length; i++) {
      enhanceTable(tables[i]);
    }
  }

  /* ------------------------------------------------------------------------ *
   * Styles — ONE injected <style>, module-prefixed (pt-*), token-driven       *
   * ------------------------------------------------------------------------ */
  function injectStyles() {
    if (document.getElementById('pt-tables-style')) return;
    var css = [
      /* Sticky header: explicit z-index + bg so it overlays scrolled rows.   */
      '.pt-enhanced thead th{position:sticky;top:0;z-index:2;background:var(--bg-2);}',

      /* Sortable headers.                                                     */
      '.pt-th-sortable{cursor:pointer;user-select:none;-webkit-user-select:none;}',
      '.pt-th-sortable:hover{color:var(--text-1);}',
      '.pt-enhanced thead th.pt-sort-active{color:var(--accent);}',
      '.pt-caret{display:inline-block;margin-left:5px;font-size:8px;color:var(--text-2);' +
        'vertical-align:middle;font-family:var(--mono);}',
      '.pt-enhanced thead th.pt-sort-active .pt-caret{color:var(--accent);}',

      /* Trend / sparkline column.                                            */
      '.pt-trend-th{width:78px;}',
      '.pt-trend-td{padding:6px 12px !important;}',
      '.pt-spark{display:block;}',

      /* Search toolbar.                                                       */
      '.pt-toolbar{display:flex;align-items:center;gap:10px;margin:0 0 10px 0;' +
        'padding:7px 9px;background:var(--bg-1);border:1px solid var(--line);' +
        'border-radius:var(--r-sm,6px);}',
      '.pt-search{flex:1;min-width:0;max-width:280px;background:var(--bg-3);' +
        'border:1px solid var(--line-2);border-radius:var(--r-sm,6px);' +
        'color:var(--text-0);font-family:var(--sans);font-size:12px;' +
        'padding:6px 9px;outline:none;transition:border-color .12s ease;}',
      '.pt-search::placeholder{color:var(--text-3);}',
      '.pt-search:focus{border-color:var(--accent);}',
      '.pt-count{font-family:var(--mono);font-size:10.5px;color:var(--text-2);' +
        'letter-spacing:.4px;white-space:nowrap;}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = 'pt-tables-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------------ *
   * Install                                                                   *
   * ------------------------------------------------------------------------ */
  injectStyles();
  afterRender(enhanceAll);
})();
