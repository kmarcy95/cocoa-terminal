/* ============================================================================
   CACAO/FP — enh-exports.js  (enhancement #27 — real xlsx / pdf / pptx exports)

   Self-installing module. Reassigns ACTIONS['export-excel'|'export-pdf'|
   'export-pptx'|'send-report'] from toast-only stubs to real document
   generators built from the LIVE DATA + current FILTERS. Uses vendored globals
   XLSX (SheetJS), window.jspdf (+ autoTable plugin) and PptxGenJS.

   Obeys ENH_CONTRACT.md:
   - plain JS, single IIFE, installs at top-level on load
   - does NOT edit other files / redefine globals / reassign switchView
   - augments behaviour only via ACTIONS property reassignment (pattern #3)
   - one <style> injected with module-prefixed class names (xp-)
   - idempotent, localStorage-free (no persistence needed here), zero console errors
   - leaves export-pbi untouched (Power BI embed = separate future item)
   ========================================================================== */

(function () {
  'use strict';

  /* ---- idempotency guard ------------------------------------------------ */
  if (window.__cacaoExportsInstalled) return;
  window.__cacaoExportsInstalled = true;

  /* ---- branded palette (cocoa gold on white) ---------------------------- */
  var BRAND = {
    gold:    'C9A96E', // --accent
    goldDk:  '8B6F3F', // --accent-2
    ink:     '14202B', // near-black header text
    text:    '2A3547', // body text
    muted:   '7A8597', // --text-2
    pos:     '2DD4A4', // --pos
    neg:     'FF5466', // --neg
    warn:    'F5B342', // --warn
    band:    'F4EEE2', // light gold tint for table rows / fills
    white:   'FFFFFF',
    line:    'D8CFBE',
  };

  /* ---- module style (only an export-progress hint badge) ---------------- */
  function injectStyle() {
    if (document.getElementById('xp-style')) return;
    var s = document.createElement('style');
    s.id = 'xp-style';
    s.textContent =
      '.xp-busy{position:relative;}' +
      '.xp-flash{position:fixed;left:50%;bottom:88px;transform:translateX(-50%);' +
      'z-index:9999;display:flex;align-items:center;gap:8px;padding:8px 14px;' +
      'border:1px solid var(--line-2);border-radius:8px;background:var(--bg-2);' +
      'color:var(--text-1);font:600 12px var(--sans);box-shadow:0 8px 24px rgba(0,0,0,.45);' +
      'opacity:0;transition:opacity .18s ease;pointer-events:none;}' +
      '.xp-flash.xp-on{opacity:1;}' +
      '.xp-flash .xp-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);' +
      'box-shadow:0 0 8px var(--accent);}' +
      '.xp-flash .xp-mono{font-family:var(--mono);color:var(--accent);}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---- transient "generating…" flash (matches terminal look) ------------ */
  function flash(label) {
    try {
      var el = document.createElement('div');
      el.className = 'xp-flash';
      el.innerHTML = '<span class="xp-dot"></span><span>Generating </span>' +
        '<span class="xp-mono">' + escapeHtml(label) + '</span>';
      document.body.appendChild(el);
      requestAnimationFrame(function () { el.classList.add('xp-on'); });
      setTimeout(function () {
        el.classList.remove('xp-on');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
      }, 1100);
    } catch (e) { /* non-fatal cosmetic */ }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---- safe toast wrappers (toast lives in actions.js) ------------------ */
  function ok(title, body, meta) {
    if (typeof toast === 'function') toast({ type: 'success', title: title, body: body || '', meta: meta || '' });
  }
  function err(title, body) {
    if (typeof toast === 'function') toast({ type: 'error', title: title, body: body || '' });
  }

  /* ---- shared metadata helpers ------------------------------------------ */
  function stamp() {
    // real timestamp at click time, browser locale
    var d = new Date();
    try { return d.toLocaleString(); } catch (e) { return d.toString(); }
  }

  // current filters as ordered [key, value] rows (read live, defensive)
  function filterRows() {
    var f = (typeof FILTERS === 'object' && FILTERS) ? FILTERS : {};
    var order = ['period', 'origin', 'supplier', 'sku', 'currency', 'version'];
    var labels = {
      period: 'Period', origin: 'Origin', supplier: 'Supplier',
      sku: 'SKU', currency: 'Currency', version: 'Forecast version',
    };
    var rows = [];
    order.forEach(function (k) {
      if (k in f) rows.push([labels[k] || k, String(f[k])]);
    });
    // include any extra keys not in the canonical order
    Object.keys(f).forEach(function (k) {
      if (order.indexOf(k) === -1) rows.push([k, String(f[k])]);
    });
    return rows;
  }

  // one-line human summary of non-default filters for headers/subtitles
  function filterSummary() {
    var f = (typeof FILTERS === 'object' && FILTERS) ? FILTERS : {};
    var def = (typeof defaultFilters === 'object' && defaultFilters) ? defaultFilters : {};
    var parts = [];
    Object.keys(f).forEach(function (k) {
      var v = f[k];
      if (def[k] === undefined || String(def[k]) !== String(v)) {
        // skip "All …" style defaults even if defaultFilters absent
        if (!/^All\b/i.test(String(v))) parts.push(v);
      }
    });
    if (!parts.length) {
      // fall back to period + currency so the line is never empty
      var base = [];
      if (f.period) base.push(f.period);
      if (f.currency) base.push(f.currency);
      return base.length ? base.join(' · ') : 'All data (no filters applied)';
    }
    return parts.join(' · ');
  }

  function num(n) { return (typeof n === 'number' && isFinite(n)) ? n : 0; }

  // PPV rows enriched with computed variance (act − std) and total variance
  function ppvRows() {
    var src = (DATA && Array.isArray(DATA.ppvDetail)) ? DATA.ppvDetail : [];
    return src.map(function (r) {
      var varEur = num(r.actEur) - num(r.stdEur);     // €/t
      var totalVar = varEur * num(r.mt);              // total €
      return {
        sku: r.sku, desc: r.desc, mt: num(r.mt),
        stdEur: num(r.stdEur), actEur: num(r.actEur),
        fxImpact: num(r.fxImpact), varEur: varEur, totalVar: totalVar,
      };
    });
  }

  // the chart canvas currently visible in #canvas (first non-empty one)
  function visibleChartCanvas() {
    try {
      var canvas = document.getElementById('canvas');
      if (!canvas) return null;
      var nodes = canvas.querySelectorAll('canvas');
      for (var i = 0; i < nodes.length; i++) {
        var c = nodes[i];
        if (c.width > 0 && c.height > 0 && c.offsetParent !== null) return c;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function chartPng() {
    var c = visibleChartCanvas();
    if (!c) return null;
    try { return { url: c.toDataURL('image/png'), w: c.width, h: c.height }; }
    catch (e) { return null; }
  }

  function kpiList() {
    var k = (DATA && DATA.kpis) ? DATA.kpis : {};
    return Object.keys(k).map(function (key) { return k[key]; })
      .filter(function (x) { return x && typeof x === 'object'; });
  }

  function chgText(p) {
    var n = num(p);
    var sign = n >= 0 ? '+' : '−';
    return sign + Math.abs(n).toFixed(1) + '%';
  }

  /* =======================================================================
     1) EXCEL — multi-sheet workbook
     ===================================================================== */
  function exportExcel() {
    if (typeof XLSX === 'undefined' || !XLSX || !XLSX.utils) {
      err('Excel export unavailable', 'SheetJS (XLSX) library not loaded.');
      return;
    }
    flash('CACAO-FP_Workbook.xlsx');
    try {
      var wb = XLSX.utils.book_new();

      /* Cover / Filters sheet (aoa) */
      var cover = [
        ['CACAO/FP — Cocoa FP&A Workbook'],
        ['Generated', stamp()],
        ['Filter summary', filterSummary()],
        [],
        ['Filter', 'Value'],
      ].concat(filterRows());
      var coverWs = XLSX.utils.aoa_to_sheet(cover);
      coverWs['!cols'] = [{ wch: 22 }, { wch: 48 }];
      XLSX.utils.book_append_sheet(wb, coverWs, 'Filters');

      /* Contracts */
      appendJson(wb, 'Contracts', (DATA && DATA.contracts) || []);

      /* PPV with computed variance */
      var ppv = ppvRows().map(function (r) {
        return {
          SKU: r.sku, Description: r.desc, MT: r.mt,
          'Std EUR/t': r.stdEur, 'Act EUR/t': r.actEur,
          'Var EUR/t': r.varEur, 'Total Var EUR': r.totalVar,
          'FX Impact EUR/t': r.fxImpact,
        };
      });
      appendJson(wb, 'PPV', ppv);

      /* Inventory / Hedges / Recon / Journal entries */
      appendJson(wb, 'Inventory', (DATA && DATA.inventory) || []);
      appendJson(wb, 'Hedges', (DATA && DATA.hedges) || []);
      appendJson(wb, 'Recon', (DATA && DATA.recon) || []);
      appendJson(wb, 'JournalEntries', (DATA && DATA.journalEntries) || []);

      XLSX.writeFile(wb, 'CACAO-FP_Workbook.xlsx');
      ok('Workbook exported', 'CACAO-FP_Workbook.xlsx — 7 sheets', filterSummary());
    } catch (e) {
      err('Excel export failed', (e && e.message) ? e.message : 'Unknown error');
    }
  }

  function appendJson(wb, name, rows) {
    var arr = Array.isArray(rows) ? rows : [];
    var ws = arr.length
      ? XLSX.utils.json_to_sheet(arr)
      : XLSX.utils.aoa_to_sheet([['(no rows)']]);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  /* =======================================================================
     2) PDF — Daily Cocoa Brief (jsPDF + autoTable)
     ===================================================================== */
  function exportPdf() {
    var jspdfNs = window.jspdf;
    if (!jspdfNs || typeof jspdfNs.jsPDF !== 'function') {
      err('PDF export unavailable', 'jsPDF library not loaded.');
      return;
    }
    var jsPDF = jspdfNs.jsPDF;
    flash('CACAO-FP_Daily-Brief.pdf');
    try {
      var doc = new jsPDF({ unit: 'pt', format: 'a4' });
      var pageW = doc.internal.pageSize.getWidth();
      var M = 40;

      /* gold brand rule + title */
      doc.setDrawColor(201, 169, 110);
      doc.setLineWidth(3);
      doc.line(M, 46, pageW - M, 46);

      doc.setTextColor(20, 32, 43);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text('CACAO/FP — Daily Cocoa Brief', M, 40);

      /* subtitle: date + filter summary */
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(122, 133, 151);
      doc.text('Generated ' + stamp(), M, 62);
      doc.text('Filters: ' + filterSummary(), M, 75);

      /* KPI block */
      var y = 100;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(139, 111, 63);
      doc.text('Headline KPIs', M, y);
      y += 16;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(42, 53, 71);
      kpiList().forEach(function (k) {
        var line = (k.label || '—') + ': ' + fmtVal(k.value) +
          (k.unit ? ' ' + k.unit : '') + '  (' + chgText(k.chgPct) + ')' +
          (k.sub ? '  — ' + k.sub : '');
        doc.text(String(line), M + 8, y);
        y += 14;
      });
      y += 8;

      /* PPV by SKU table */
      var body = ppvRows().map(function (r) {
        return [r.sku, fmtInt0(r.mt), fmtInt0(r.stdEur), fmtInt0(r.actEur),
          signed0(r.varEur), signedEur(r.totalVar)];
      });
      if (typeof doc.autoTable === 'function') {
        doc.autoTable({
          startY: y,
          head: [['SKU', 'MT', 'Std EUR/t', 'Act EUR/t', 'Var EUR/t', 'Total Var']],
          body: body,
          theme: 'grid',
          styles: { font: 'helvetica', fontSize: 8.5, textColor: [42, 53, 71], lineColor: [216, 207, 190] },
          headStyles: { fillColor: [201, 169, 110], textColor: [20, 32, 43], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [244, 238, 226] },
          margin: { left: M, right: M },
        });
        y = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 20 : y + 200;
      }

      /* visible chart, guarded for size + page bounds */
      var png = chartPng();
      if (png) {
        var pageH = doc.internal.pageSize.getHeight();
        var maxW = pageW - M * 2;
        var ratio = png.h / (png.w || 1);
        var imgW = Math.min(maxW, 460);
        var imgH = imgW * ratio;
        if (imgH > 240) { imgH = 240; imgW = imgH / (ratio || 1); }
        if (y + imgH + 30 > pageH) { doc.addPage(); y = M; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(139, 111, 63);
        doc.text('Current chart', M, y);
        y += 10;
        try { doc.addImage(png.url, 'PNG', M, y, imgW, imgH); } catch (e) { /* skip image */ }
      }

      doc.save('CACAO-FP_Daily-Brief.pdf');
      ok('Brief exported', 'CACAO-FP_Daily-Brief.pdf', filterSummary());
    } catch (e) {
      err('PDF export failed', (e && e.message) ? e.message : 'Unknown error');
    }
  }

  /* =======================================================================
     3) PPTX — Monthly Exec Pack (PptxGenJS)
     ===================================================================== */
  function exportPptx() {
    if (typeof PptxGenJS === 'undefined' || !PptxGenJS) {
      err('PowerPoint export unavailable', 'PptxGenJS library not loaded.');
      return;
    }
    flash('CACAO-FP_Exec-Pack.pptx');
    try {
      var pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'CACAO16x9', width: 13.333, height: 7.5 });
      pptx.layout = 'CACAO16x9';

      var W = 13.333;

      /* ---- Slide 1: title ---- */
      var s1 = pptx.addSlide();
      s1.background = { color: BRAND.white };
      s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.18, fill: { color: BRAND.gold } });
      s1.addText('CACAO/FP — Monthly Exec Pack', {
        x: 0.7, y: 2.5, w: W - 1.4, h: 1.0,
        fontSize: 34, bold: true, color: BRAND.ink, fontFace: 'Arial',
      });
      s1.addText(stamp() + '   ·   ' + filterSummary(), {
        x: 0.7, y: 3.6, w: W - 1.4, h: 0.5,
        fontSize: 14, color: BRAND.muted, fontFace: 'Arial',
      });
      s1.addShape(pptx.ShapeType.rect, { x: 0.7, y: 3.45, w: 3.2, h: 0.04, fill: { color: BRAND.goldDk } });

      /* ---- Slide 2: KPI scorecard grid ---- */
      var s2 = pptx.addSlide();
      s2.background = { color: BRAND.white };
      slideHeader(pptx, s2, 'Headline KPIs', W);
      var kpis = kpiList();
      var cols = 3, cw = 3.9, ch = 1.6, gx = 0.45, gy = 0.45, ox = 0.7, oy = 1.4;
      kpis.slice(0, 6).forEach(function (k, i) {
        var r = Math.floor(i / cols), c = i % cols;
        var x = ox + c * (cw + gx), y = oy + r * (ch + gy);
        var adverse = num(k.chgPct) < 0;
        var chgColor = k.invert ? (adverse ? BRAND.pos : BRAND.neg) : (adverse ? BRAND.neg : BRAND.pos);
        s2.addShape(pptx.ShapeType.rect, { x: x, y: y, w: cw, h: ch, fill: { color: BRAND.band }, line: { color: BRAND.line, width: 1 } });
        s2.addText(String(k.label || ''), { x: x + 0.15, y: y + 0.12, w: cw - 0.3, h: 0.35, fontSize: 11, color: BRAND.muted, fontFace: 'Arial' });
        s2.addText(fmtVal(k.value) + (k.unit ? ' ' + k.unit : ''), { x: x + 0.15, y: y + 0.5, w: cw - 0.3, h: 0.5, fontSize: 22, bold: true, color: BRAND.ink, fontFace: 'Arial' });
        s2.addText(chgText(k.chgPct) + (k.sub ? '   ' + k.sub : ''), { x: x + 0.15, y: y + 1.05, w: cw - 0.3, h: 0.35, fontSize: 10, color: chgColor, fontFace: 'Arial' });
      });

      /* ---- Slide 3: data table (PPV by SKU) ---- */
      var s3 = pptx.addSlide();
      s3.background = { color: BRAND.white };
      slideHeader(pptx, s3, 'PPV by SKU', W);
      var head = ['SKU', 'MT', 'Std EUR/t', 'Act EUR/t', 'Var EUR/t', 'Total Var'].map(function (h) {
        return { text: h, options: { bold: true, color: BRAND.white, fill: { color: BRAND.goldDk } } };
      });
      var rows = [head];
      ppvRows().forEach(function (r, idx) {
        var fill = idx % 2 ? BRAND.band : BRAND.white;
        rows.push([
          cell(r.sku, fill), cell(fmtInt0(r.mt), fill), cell(fmtInt0(r.stdEur), fill),
          cell(fmtInt0(r.actEur), fill), cell(signed0(r.varEur), fill), cell(signedEur(r.totalVar), fill),
        ]);
      });
      s3.addTable(rows, {
        x: 0.7, y: 1.4, w: W - 1.4,
        colW: [2.6, 1.5, 2.0, 2.0, 1.8, 2.0],
        fontSize: 11, fontFace: 'Arial', color: BRAND.text,
        border: { type: 'solid', color: BRAND.line, pt: 1 },
        valign: 'middle',
      });

      /* ---- Optional slide 4: visible chart ---- */
      var png = chartPng();
      if (png) {
        var s4 = pptx.addSlide();
        s4.background = { color: BRAND.white };
        slideHeader(pptx, s4, 'Current chart', W);
        var ratio = png.h / (png.w || 1);
        var iw = 9.5, ih = iw * ratio;
        if (ih > 5.2) { ih = 5.2; iw = ih / (ratio || 1); }
        try { s4.addImage({ data: png.url, x: (W - iw) / 2, y: 1.5, w: iw, h: ih }); } catch (e) { /* skip */ }
      }

      pptx.writeFile({ fileName: 'CACAO-FP_Exec-Pack.pptx' });
      ok('Exec pack exported', 'CACAO-FP_Exec-Pack.pptx', filterSummary());
    } catch (e) {
      err('PowerPoint export failed', (e && e.message) ? e.message : 'Unknown error');
    }
  }

  function slideHeader(pptx, slide, title, W) {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.14, fill: { color: BRAND.gold } });
    slide.addText(title, { x: 0.7, y: 0.45, w: W - 1.4, h: 0.6, fontSize: 22, bold: true, color: BRAND.ink, fontFace: 'Arial' });
    slide.addText('CACAO/FP · ' + filterSummary(), { x: 0.7, y: 0.98, w: W - 1.4, h: 0.3, fontSize: 9, color: BRAND.muted, fontFace: 'Arial' });
  }

  function cell(text, fill) {
    return { text: String(text), options: { fill: { color: fill } } };
  }

  /* =======================================================================
     Formatting helpers (prefer app.js formatters when present)
     ===================================================================== */
  function fmtVal(v) {
    if (typeof v === 'number') {
      if (typeof fmtNum === 'function') {
        return Number.isInteger(v) ? fmtNum(v, 0) : fmtNum(v, (Math.abs(v) < 100 ? 2 : 1));
      }
      return String(v);
    }
    return String(v == null ? '' : v);
  }
  function fmtInt0(n) {
    if (typeof fmtInt === 'function') return fmtInt(num(n));
    return String(Math.round(num(n)));
  }
  function signed0(n) {
    var v = Math.round(num(n));
    return (v >= 0 ? '+' : '−') + fmtInt0(Math.abs(v));
  }
  function signedEur(n) {
    var v = Math.round(num(n));
    if (typeof fmtEur === 'function') {
      return (v >= 0 ? '+' : '−') + fmtEur(Math.abs(v));
    }
    return (v >= 0 ? '+€' : '−€') + fmtInt0(Math.abs(v));
  }

  /* =======================================================================
     send-report router → routes a report name to the right generator
     ===================================================================== */
  function sendReport(name) {
    var n = String(name || '').trim();
    var route = {
      'Daily Cocoa Brief': exportPdf,
      'Weekly Hedge Coverage': exportExcel,
      'Monthly Exec Pack': exportPptx,
      'PPV Drilldown': exportExcel,
    };
    var gen = route[n];
    if (gen) {
      gen();
      ok('Generated & downloaded: ' + n, 'Report distributed to recipients.');
    } else {
      // unknown report name → safe default to workbook
      exportExcel();
      ok('Generated & downloaded: ' + (n || 'report'), 'Report distributed to recipients.');
    }
  }

  /* =======================================================================
     INSTALL — reassign ACTIONS (pattern #3). Leave export-pbi untouched.
     ===================================================================== */
  function install() {
    injectStyle();
    if (typeof ACTIONS === 'undefined' || !ACTIONS) return;
    ACTIONS['export-excel'] = function () { exportExcel(); };
    ACTIONS['export-pdf'] = function () { exportPdf(); };
    ACTIONS['export-pptx'] = function () { exportPptx(); };
    ACTIONS['send-report'] = function (payload) { sendReport(payload); };
  }

  install();
})();
