/* ============================================================================
   CACAO/FP — enh-cmdk.js  (#13 — Command palette · ENH_CONTRACT2 pattern E)
   Bloomberg-style command palette: Ctrl/Cmd-K (or '/') opens a full-screen
   overlay indexing VIEWS, high-value ACTIONS verbs, and named DATA entities.
   Fuzzy filter · ↑/↓ to move · Enter/click to run · Escape to close.
   Self-installing IIFE. Never reassigns switchView; calls it. Idempotent.
   Wraps localStorage in try/catch (recent-commands memory). Zero deps beyond
   the documented globals.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- idempotency guard ------------------------------------------------ */
  if (window.__cacaoCmdkInstalled) return;
  window.__cacaoCmdkInstalled = true;

  var RECENT_KEY = 'cacao_cmdk_recent_v1';
  var MAX_RECENT = 6;
  var MAX_RESULTS = 40;

  /* ---- friendly view titles (from the sidenav nav-text) ----------------- */
  var VIEW_TITLES = {
    dashboard: 'Dashboard',
    market: 'Market Desk',
    contracts: 'Physical Contracts',
    ppv: 'PPV Analysis',
    hedge: 'Hedge Book',
    inventory: 'Inventory Valuation',
    forecast: 'Forecast & Planning',
    close: 'Month-End Close',
    sox: 'SOX & Controls',
    whatif: 'What-If Calculator',
    eudr: 'EUDR & Traceability',
    cashflow: 'Cash Flow / Treasury',
    versions: 'Forecast Versions',
    effectiveness: 'Hedge Effectiveness',
    investigator: 'Variance Investigator',
    exports: 'Exports & Mobile'
  };

  /* ---- curated high-value action verbs ---------------------------------- *
   * needView: switchView() first, then run the verb (so the modal/drawer
   * opens over the right context). null → run the verb directly.            */
  var ACTION_ITEMS = [
    { label: 'Run Forecast',           verb: 'run-forecast',        needView: null,            hint: 'forecast' },
    { label: 'New Hedge',              verb: 'new-hedge',           needView: 'hedge',         hint: 'hedge' },
    { label: 'VaR Report',             verb: 'var-report',          needView: 'hedge',         hint: 'risk' },
    { label: 'Effectiveness Test',     verb: 'effectiveness-test',  needView: 'effectiveness', hint: 'IFRS 9' },
    { label: 'Generate Commentary',    verb: 'generate-commentary', needView: null,            hint: 'narrative' },
    { label: 'Set Alert',              verb: 'set-alert',           needView: 'market',        hint: 'market' },
    { label: 'Export Excel',           verb: 'export-excel',        needView: null,            hint: '.xlsx' },
    { label: 'Export PDF',             verb: 'export-pdf',          needView: null,            hint: '.pdf' },
    { label: 'Export PPTX',            verb: 'export-pptx',         needView: null,            hint: '.pptx' },
    { label: 'Fix PTBF',               verb: 'fix-ptbf',            needView: 'contracts',     hint: 'pricing' },
    { label: 'Reserve Calc',           verb: 'reserve-calc',        needView: 'inventory',     hint: 'LCM/NRV' },
    { label: 'Cycle Count',            verb: 'cycle-count',         needView: 'inventory',     hint: 'inventory' }
  ];

  /* ---- build the static index (views + actions) ------------------------- */
  function buildIndex() {
    var items = [];

    // (1) VIEWS — drive off the live VIEWS registry so we never go stale
    try {
      Object.keys((typeof VIEWS !== 'undefined' && VIEWS) || {}).forEach(function (name) {
        var title = VIEW_TITLES[name] || name;
        items.push({
          group: 'Views',
          title: title,
          sub: name,
          hint: 'view',
          searchText: (title + ' ' + name).toLowerCase(),
          run: function () { safeSwitch(name); }
        });
      });
    } catch (e) { /* ignore — index degrades gracefully */ }

    // (2) ACTIONS — curated verbs
    ACTION_ITEMS.forEach(function (a) {
      if (typeof ACTIONS === 'undefined' || typeof ACTIONS[a.verb] !== 'function') return;
      items.push({
        group: 'Actions',
        title: a.label,
        sub: a.verb,
        hint: a.hint,
        searchText: (a.label + ' ' + a.verb + ' ' + a.hint).toLowerCase(),
        run: function () { runAction(a.verb, a.needView); }
      });
    });

    // (3) ENTITIES — contracts, hedges, skus, suppliers
    buildEntities(items);

    return items;
  }

  function buildEntities(items) {
    var D = (typeof DATA !== 'undefined' && DATA) || {};

    // contracts: id + supplier → view-contract modal
    (D.contracts || []).forEach(function (c) {
      items.push({
        group: 'Contracts',
        title: c.id,
        sub: (c.supplier || '') + ' · ' + (c.origin || '') + ' · ' + (c.status || ''),
        hint: 'contract',
        searchText: (c.id + ' ' + (c.supplier || '') + ' ' + (c.origin || '') + ' ' + (c.status || '')).toLowerCase(),
        run: function () { runActionPayload('view-contract', null, c.id); }
      });
    });

    // hedges: id → hedge view
    (D.hedges || []).forEach(function (h) {
      items.push({
        group: 'Hedges',
        title: h.id,
        sub: (h.book || '') + ' · ' + (h.side || '') + ' · ' + (h.status || ''),
        hint: 'hedge',
        searchText: (h.id + ' ' + (h.book || '') + ' ' + (h.side || '') + ' ' + (h.status || '')).toLowerCase(),
        run: function () { safeSwitch('hedge'); }
      });
    });

    // skus: from ppvDetail + inventory (dedup) → drill-sku (needs ppv view)
    var seenSku = {};
    var pushSku = function (sku, desc) {
      if (!sku || seenSku[sku]) return;
      seenSku[sku] = 1;
      items.push({
        group: 'SKUs',
        title: sku,
        sub: desc || '',
        hint: 'sku',
        searchText: (sku + ' ' + (desc || '')).toLowerCase(),
        run: function () { runActionPayload('drill-sku', 'ppv', sku); }
      });
    };
    (D.ppvDetail || []).forEach(function (p) { pushSku(p.sku, p.desc); });
    (D.inventory || []).forEach(function (i) { pushSku(i.sku, i.form + ' · ' + i.location); });

    // suppliers: from eudr.bySupplier → drill-supplier (needs eudr view)
    var seenSup = {};
    ((D.eudr && D.eudr.bySupplier) || []).forEach(function (s) {
      if (!s.supplier || seenSup[s.supplier]) return;
      seenSup[s.supplier] = 1;
      items.push({
        group: 'Suppliers',
        title: s.supplier,
        sub: (s.origin || '') + ' · DDS ' + (s.dds || '') + ' · risk ' + (s.risk != null ? s.risk : '—'),
        hint: 'supplier',
        searchText: (s.supplier + ' ' + (s.origin || '') + ' ' + (s.dds || '')).toLowerCase(),
        run: function () { runActionPayload('drill-supplier', 'eudr', s.supplier); }
      });
    });
  }

  /* ---- run helpers (always close the palette first) --------------------- */
  function safeSwitch(name) {
    close();
    try { if (typeof switchView === 'function') switchView(name); } catch (e) { /* noop */ }
  }

  function runAction(verb, needView) {
    close();
    try {
      if (needView && typeof switchView === 'function' && CURRENT_VIEW !== needView) {
        switchView(needView);
      }
      var fn = (typeof ACTIONS !== 'undefined') && ACTIONS[verb];
      if (typeof fn === 'function') fn();
    } catch (e) { /* noop — never throw into the click loop */ }
  }

  function runActionPayload(verb, needView, payload) {
    close();
    try {
      if (needView && typeof switchView === 'function' && CURRENT_VIEW !== needView) {
        switchView(needView);
      }
      var fn = (typeof ACTIONS !== 'undefined') && ACTIONS[verb];
      if (typeof fn === 'function') {
        // entity drills that switch view need the new render to exist first
        if (needView) { setTimeout(function () { try { fn(payload); } catch (e) {} }, 60); }
        else { fn(payload); }
      }
    } catch (e) { /* noop */ }
  }

  /* ---- fuzzy matching --------------------------------------------------- *
   * Score: exact substring (high) → ordered subsequence (lower). Earlier
   * matches and shorter targets rank better. Returns -1 for no match.       */
  function score(query, text) {
    if (!query) return 1; // empty query → keep, neutral score
    var q = query, t = text;
    var idx = t.indexOf(q);
    if (idx !== -1) {
      // substring hit: base 1000, reward early position + word-boundary start
      var boundary = (idx === 0 || /\s|[-·/]/.test(t.charAt(idx - 1))) ? 200 : 0;
      return 1000 + boundary - idx - t.length * 0.1;
    }
    // subsequence match
    var qi = 0, ti = 0, first = -1, last = -1, gaps = 0, prev = -1;
    while (qi < q.length && ti < t.length) {
      if (q.charAt(qi) === t.charAt(ti)) {
        if (first === -1) first = ti;
        if (prev !== -1 && ti - prev > 1) gaps++;
        prev = ti; last = ti; qi++;
      }
      ti++;
    }
    if (qi < q.length) return -1; // not all chars matched
    var span = last - first;
    return 400 - span - gaps * 5 - first * 0.5 - t.length * 0.05;
  }

  function search(index, raw) {
    var q = (raw || '').trim().toLowerCase();
    var scored = [];
    for (var i = 0; i < index.length; i++) {
      var it = index[i];
      var s = score(q, it.searchText);
      if (s < 0) continue;
      scored.push({ it: it, s: s });
    }
    scored.sort(function (a, b) {
      if (b.s !== a.s) return b.s - a.s;
      return a.it.title.localeCompare(b.it.title);
    });
    return scored.slice(0, MAX_RESULTS).map(function (x) { return x.it; });
  }

  /* ---- recent commands (localStorage, best-effort) ---------------------- */
  function loadRecent() {
    try {
      var arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function pushRecent(it) {
    try {
      var key = it.group + '|' + it.title;
      var arr = loadRecent().filter(function (k) { return k !== key; });
      arr.unshift(key);
      localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, MAX_RECENT)));
    } catch (e) { /* noop */ }
  }
  function recentItems(index) {
    var keys = loadRecent();
    if (!keys.length) return [];
    var byKey = {};
    index.forEach(function (it) { byKey[it.group + '|' + it.title] = it; });
    var out = [];
    keys.forEach(function (k) { if (byKey[k]) out.push(byKey[k]); });
    return out;
  }

  /* ---- DOM build -------------------------------------------------------- */
  var overlay = null, input = null, listEl = null, hintEl = null;
  var index = [];
  var results = [];
  var active = 0;
  var isOpen = false;

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'ck-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Command palette');
    overlay.innerHTML =
      '<div class="ck-box" role="document">' +
        '<div class="ck-input-wrap">' +
          '<span class="ck-prompt">⌘</span>' +
          '<input class="ck-input" type="text" autocomplete="off" spellcheck="false" ' +
            'placeholder="Search views, actions, contracts, SKUs, suppliers…" aria-label="Command search">' +
          '<span class="ck-esc">ESC</span>' +
        '</div>' +
        '<div class="ck-list" role="listbox"></div>' +
        '<div class="ck-foot">' +
          '<span class="ck-kbd-row">' +
            '<span class="ck-kbd">↑</span><span class="ck-kbd">↓</span><span class="ck-hint-label">move</span>' +
            '<span class="ck-kbd">↵</span><span class="ck-hint-label">run</span>' +
            '<span class="ck-kbd">esc</span><span class="ck-hint-label">close</span>' +
          '</span>' +
          '<span class="ck-brand">CACAO<span class="ck-slash">/</span>FP</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    input = overlay.querySelector('.ck-input');
    listEl = overlay.querySelector('.ck-list');

    // scrim click (outside the box) closes
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });

    // typing → re-filter
    input.addEventListener('input', function () { refresh(); });

    // keys scoped to the input while open
    input.addEventListener('keydown', onInputKey);
  }

  function onInputKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function move(delta) {
    if (!results.length) return;
    active = (active + delta + results.length) % results.length;
    paintActive();
  }

  function runActive() {
    var it = results[active];
    if (!it) return;
    pushRecent(it);
    it.run(); // each run() calls close() itself
  }

  /* ---- render results --------------------------------------------------- */
  function refresh() {
    var q = input ? input.value : '';
    if (!q.trim()) {
      var rec = recentItems(index);
      results = rec.length ? rec : search(index, '');
    } else {
      results = search(index, q);
    }
    active = 0;
    renderList(!q.trim() && recentItems(index).length > 0);
  }

  function renderList(showingRecent) {
    if (!listEl) return;
    if (!results.length) {
      listEl.innerHTML = '<div class="ck-empty">No matches.</div>';
      return;
    }
    var html = '';
    var lastGroup = null;
    results.forEach(function (it, i) {
      var groupLabel = showingRecent ? 'Recent' : it.group;
      if (groupLabel !== lastGroup) {
        html += '<div class="ck-group">' + esc(groupLabel) + '</div>';
        lastGroup = groupLabel;
      }
      html += '<div class="ck-row" role="option" data-i="' + i + '">' +
        '<span class="ck-row-title">' + esc(it.title) + '</span>' +
        (it.sub ? '<span class="ck-row-sub">' + esc(it.sub) + '</span>' : '') +
        (it.hint ? '<span class="ck-chip">' + esc(it.hint) + '</span>' : '') +
      '</div>';
    });
    listEl.innerHTML = html;

    // mouse interactions
    var rows = listEl.querySelectorAll('.ck-row');
    for (var r = 0; r < rows.length; r++) {
      rows[r].addEventListener('mousemove', onRowHover);
      rows[r].addEventListener('click', onRowClick);
    }
    paintActive();
  }

  function onRowHover(e) {
    var i = parseInt(e.currentTarget.getAttribute('data-i'), 10);
    if (!isNaN(i) && i !== active) { active = i; paintActive(); }
  }
  function onRowClick(e) {
    var i = parseInt(e.currentTarget.getAttribute('data-i'), 10);
    if (!isNaN(i)) { active = i; runActive(); }
  }

  function paintActive() {
    if (!listEl) return;
    var rows = listEl.querySelectorAll('.ck-row');
    for (var i = 0; i < rows.length; i++) {
      var on = (i === active);
      rows[i].classList.toggle('active', on);
      if (on && rows[i].scrollIntoView) {
        rows[i].scrollIntoView({ block: 'nearest' });
      }
    }
  }

  /* ---- open / close ----------------------------------------------------- */
  function open() {
    if (isOpen) return;
    ensureOverlay();
    index = buildIndex(); // rebuild each open so entities stay fresh
    isOpen = true;
    overlay.classList.add('open');
    if (input) { input.value = ''; }
    refresh();
    // focus after paint so autofocus is reliable
    setTimeout(function () { if (input) { input.focus(); input.select(); } }, 0);
  }

  function close() {
    if (!isOpen || !overlay) return;
    isOpen = false;
    overlay.classList.remove('open');
    if (input) input.blur();
  }

  function toggle() { if (isOpen) close(); else open(); }

  /* ---- global keydown (coexist with other handlers) -------------------- */
  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return; // respect handlers that already acted

    // Ctrl/Cmd-K toggles
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      toggle();
      return;
    }

    // '/' opens when not typing into a field and palette closed
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isOpen && !isTypingTarget(e.target)) {
      e.preventDefault();
      open();
      return;
    }

    // Escape closes (only when open; don't swallow others' Escape otherwise)
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      close();
    }
  });

  /* ---- topbar ⌘K affordance (idempotent) ------------------------------- */
  function installHint() {
    var bar = document.querySelector('.topbar-actions');
    if (!bar) return;
    if (bar.querySelector('.ck-affordance')) return; // already added
    var btn = document.createElement('button');
    btn.className = 'btn btn-ghost ck-affordance';
    btn.type = 'button';
    btn.title = 'Command palette (Ctrl/⌘ K)';
    btn.setAttribute('aria-label', 'Open command palette');
    btn.innerHTML = '<span class="ck-affordance-key">⌘K</span>';
    btn.addEventListener('click', function (e) { e.preventDefault(); open(); });
    bar.insertBefore(btn, bar.firstChild);
  }

  /* ---- styles (one prefixed <style>, token-driven) --------------------- */
  function installStyles() {
    if (document.getElementById('ck-styles')) return;
    var css = [
      '.ck-overlay{position:fixed;inset:0;z-index:6000;display:none;',
        'align-items:flex-start;justify-content:center;',
        'background:rgba(4,6,10,.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}',
      '.ck-overlay.open{display:flex;}',
      '.ck-box{margin-top:11vh;width:min(680px,92vw);max-height:72vh;display:flex;flex-direction:column;',
        'background:var(--bg-1);border:1px solid var(--line);border-radius:12px;overflow:hidden;',
        'box-shadow:0 24px 64px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.2);',
        'font-family:var(--sans);}',
      '.ck-input-wrap{display:flex;align-items:center;gap:10px;padding:14px 16px;',
        'border-bottom:1px solid var(--line);background:var(--bg-2);}',
      '.ck-prompt{color:var(--accent);font-family:var(--mono);font-size:15px;line-height:1;flex:0 0 auto;}',
      '.ck-input{flex:1 1 auto;background:transparent;border:0;outline:0;color:var(--text-0);',
        'font-family:var(--sans);font-size:16px;letter-spacing:.1px;}',
      '.ck-input::placeholder{color:var(--text-3);}',
      '.ck-esc{flex:0 0 auto;font-family:var(--mono);font-size:10px;letter-spacing:.5px;',
        'color:var(--text-3);border:1px solid var(--line-2);border-radius:5px;padding:2px 6px;}',
      '.ck-list{flex:1 1 auto;overflow-y:auto;padding:6px 0;}',
      '.ck-group{padding:8px 16px 4px;font-family:var(--mono);font-size:10px;letter-spacing:1px;',
        'text-transform:uppercase;color:var(--text-2);}',
      '.ck-row{display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer;',
        'border-left:2px solid transparent;}',
      '.ck-row.active{background:var(--bg-3);border-left-color:var(--accent);}',
      '.ck-row-title{flex:0 0 auto;color:var(--text-0);font-size:13.5px;',
        'font-family:var(--mono);white-space:nowrap;}',
      '.ck-row-sub{flex:1 1 auto;color:var(--text-2);font-size:11.5px;',
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--sans);}',
      '.ck-chip{flex:0 0 auto;font-family:var(--mono);font-size:9.5px;letter-spacing:.5px;',
        'text-transform:uppercase;color:var(--text-2);background:var(--bg-2);',
        'border:1px solid var(--line-2);border-radius:4px;padding:2px 6px;}',
      '.ck-row.active .ck-chip{color:var(--accent);border-color:var(--accent-dim);}',
      '.ck-empty{padding:24px 16px;text-align:center;color:var(--text-2);font-size:13px;',
        'font-family:var(--sans);}',
      '.ck-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;',
        'padding:9px 16px;border-top:1px solid var(--line);background:var(--bg-2);}',
      '.ck-kbd-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
      '.ck-kbd{font-family:var(--mono);font-size:10px;color:var(--text-1);background:var(--bg-3);',
        'border:1px solid var(--line-2);border-radius:4px;padding:1px 6px;min-width:14px;text-align:center;}',
      '.ck-hint-label{font-family:var(--sans);font-size:10.5px;color:var(--text-3);margin-right:6px;}',
      '.ck-brand{font-family:var(--mono);font-size:11px;letter-spacing:1px;color:var(--text-2);}',
      '.ck-slash{color:var(--accent);}',
      '.ck-affordance{display:inline-flex;align-items:center;gap:0;}',
      '.ck-affordance-key{font-family:var(--mono);font-size:11px;letter-spacing:.5px;color:var(--text-1);}',
      '@media (max-width:920px){.ck-box{width:94vw;margin-top:8vh;max-height:80vh;}',
        '.ck-row-sub{display:none;}}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'ck-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---- tiny HTML escaper ------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---- install (top-level on load) ------------------------------------- */
  installStyles();
  installHint();
})();
