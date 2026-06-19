/* ============================================================================
   CACAO/FP — enh-saved-views.js  (Enhancement #15 — Saved Views / filter presets)

   Self-installing module loaded AFTER actions.js. Injects a "▾ Views" control
   into #filter-bar that lets the analyst save, recall, delete, and set a
   default-landing filter preset. Presets persist to localStorage.

   Hooks used (per ENH_CONTRACT.md):
     • MutationObserver on #filter-bar — re-injects .sv-wrap whenever
       renderFilterBar() rebuilds the bar (idempotent).
     • Reads/mutates the live FILTERS object (Object.assign — never reassigns
       the const binding). Calls saveFilters / renderFilterBar / switchView /
       toast / modal / closeModal — all existing globals, none redefined.

   Globals consumed (never redefined): FILTERS, defaultFilters, saveFilters,
   renderFilterBar, switchView, CURRENT_VIEW, toast, modal, closeModal.

   Persistence keys (cacao_ prefix):
     • cacao_views_v1     — JSON array of { name, filters }
     • cacao_view_default — name of the default-landing preset
   ========================================================================== */

(function () {
  'use strict';

  /* ---- Idempotency: never install twice -------------------------------- */
  if (window.__cacaoSavedViewsInstalled) return;
  window.__cacaoSavedViewsInstalled = true;

  var VIEWS_KEY = 'cacao_views_v1';
  var DEFAULT_KEY = 'cacao_view_default';
  var DEFAULT_PRESET_NAME = '(default)';

  /* ====================================================================== *
     Persistence helpers (all localStorage access wrapped in try/catch)
     ====================================================================== */

  function loadPresets() {
    try {
      var raw = localStorage.getItem(VIEWS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Defensive: keep only well-formed { name, filters } records.
      return parsed.filter(function (p) {
        return p && typeof p.name === 'string' && p.filters && typeof p.filters === 'object';
      });
    } catch (e) {
      return [];
    }
  }

  function savePresets(list) {
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(list));
    } catch (e) { /* storage unavailable — non-fatal */ }
  }

  function loadDefaultName() {
    try {
      return localStorage.getItem(DEFAULT_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function saveDefaultName(name) {
    try {
      if (name) localStorage.setItem(DEFAULT_KEY, name);
      else localStorage.removeItem(DEFAULT_KEY);
    } catch (e) { /* non-fatal */ }
  }

  /* ====================================================================== *
     Small DOM / string helpers (local — not contract globals)
     ====================================================================== */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeToast(opts) {
    try { if (typeof toast === 'function') toast(opts); } catch (e) {}
  }

  function findPreset(name) {
    var list = loadPresets();
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) return list[i];
    }
    return null;
  }

  /* Snapshot the live FILTERS object into a plain copy. */
  function currentFilters() {
    var out = {};
    if (typeof FILTERS === 'object' && FILTERS) {
      Object.keys(FILTERS).forEach(function (k) { out[k] = FILTERS[k]; });
    }
    return out;
  }

  function baseFilters() {
    return (typeof defaultFilters === 'object' && defaultFilters) ? defaultFilters : {};
  }

  /* ====================================================================== *
     Apply a preset to the live FILTERS object + re-render the app
     ====================================================================== */

  function applyPreset(preset) {
    if (!preset || !preset.filters) return;
    if (typeof FILTERS !== 'object' || !FILTERS) return;

    // Merge against defaults so a preset that omits a key falls back cleanly.
    var merged = {};
    var defs = baseFilters();
    Object.keys(defs).forEach(function (k) { merged[k] = defs[k]; });
    Object.keys(preset.filters).forEach(function (k) { merged[k] = preset.filters[k]; });

    // Mutate FILTERS' PROPERTIES in place (it is a const binding):
    //  1) drop keys no longer present in the merged set,
    //  2) Object.assign the merged values on top.
    Object.keys(FILTERS).forEach(function (k) {
      if (!(k in merged)) { try { delete FILTERS[k]; } catch (e) {} }
    });
    Object.assign(FILTERS, merged);

    // Persist + re-sync the UI through the existing app machinery.
    try { if (typeof saveFilters === 'function') saveFilters(FILTERS); } catch (e) {}
    try { if (typeof renderFilterBar === 'function') renderFilterBar(); } catch (e) {}
    try {
      if (typeof switchView === 'function' && typeof CURRENT_VIEW !== 'undefined') {
        switchView(CURRENT_VIEW);
      }
    } catch (e) {}

    safeToast({ type: 'info', title: 'View applied', body: preset.name });
  }

  /* ====================================================================== *
     Preset mutations (save / delete / set-default)
     ====================================================================== */

  function saveCurrentAs(name) {
    name = (name || '').trim();
    if (!name) {
      safeToast({ type: 'warn', title: 'Name required', body: 'Enter a name for this view.' });
      return false;
    }
    var list = loadPresets();
    var record = { name: name, filters: currentFilters() };
    // Replace an existing preset of the same name rather than duplicating.
    var replaced = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) { list[i] = record; replaced = true; break; }
    }
    if (!replaced) list.push(record);
    savePresets(list);
    safeToast({ type: 'success', title: 'View saved', body: name });
    return true;
  }

  function deletePreset(name) {
    var list = loadPresets().filter(function (p) { return p.name !== name; });
    savePresets(list);
    if (loadDefaultName() === name) saveDefaultName('');
    safeToast({ type: 'info', title: 'View deleted', body: name });
    refreshPanel();
  }

  function setCurrentAsDefault() {
    // Store the current FILTERS as a preset named "(default)" + flag it.
    var list = loadPresets();
    var record = { name: DEFAULT_PRESET_NAME, filters: currentFilters() };
    var replaced = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === DEFAULT_PRESET_NAME) { list[i] = record; replaced = true; break; }
    }
    if (!replaced) list.push(record);
    savePresets(list);
    saveDefaultName(DEFAULT_PRESET_NAME);
    safeToast({ type: 'success', title: 'Default landing set', body: 'Current view will load on next open.' });
    refreshPanel();
  }

  /* ====================================================================== *
     Save modal (uses the existing modal/closeModal globals)
     ====================================================================== */

  function openSaveModal() {
    if (typeof modal !== 'function') return;
    var body =
      '<div class="form-row">' +
      '<label class="form-label" for="sv-name">View name</label>' +
      '<input class="form-input sv-modal-input" id="sv-name" type="text" ' +
      'placeholder="e.g. CIV · Q2 lens" autocomplete="off" />' +
      '</div>';
    var footer =
      '<button class="btn btn-ghost" data-action="close-modal">Cancel</button>' +
      '<button class="btn btn-primary" data-action="sv-save">Save</button>';
    modal({ title: 'Save view', sub: 'Capture the current filters as a named preset.', body: body, footer: footer });

    // Focus the input shortly after the modal mounts.
    setTimeout(function () {
      var input = document.getElementById('sv-name');
      if (input) {
        input.focus();
        // Enter submits the save.
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            doSaveFromModal();
          }
        });
      }
    }, 30);
  }

  function doSaveFromModal() {
    var input = document.getElementById('sv-name');
    var name = input ? input.value : '';
    if (saveCurrentAs(name)) {
      try { if (typeof closeModal === 'function') closeModal(); } catch (e) {}
      refreshPanel();
    }
  }

  /* ====================================================================== *
     Dropdown panel rendering
     ====================================================================== */

  function buildPanelHtml() {
    var presets = loadPresets();
    var defName = loadDefaultName();
    var rows = '';

    if (presets.length === 0) {
      rows = '<div class="sv-empty">No saved views yet.</div>';
    } else {
      rows = presets.map(function (p) {
        var isDefault = (p.name === defName);
        var check = isDefault ? '<span class="sv-check" title="Default landing view">✓</span>' : '';
        return (
          '<div class="sv-item" data-sv-apply="' + esc(p.name) + '" role="button" tabindex="0">' +
          '<span class="sv-item-name">' + esc(p.name) + '</span>' +
          check +
          '<span class="sv-del" data-sv-del="' + esc(p.name) + '" title="Delete view" role="button">×</span>' +
          '</div>'
        );
      }).join('');
    }

    return (
      '<div class="sv-panel-head">Saved views</div>' +
      '<div class="sv-list">' + rows + '</div>' +
      '<div class="sv-divider"></div>' +
      '<div class="sv-action" data-sv-action="save">★ Save current view…</div>' +
      '<div class="sv-action" data-sv-action="default">⌂ Set current as default landing</div>'
    );
  }

  function refreshPanel() {
    var panel = document.querySelector('.sv-panel');
    if (panel) panel.innerHTML = buildPanelHtml();
  }

  function closePanel() {
    var wrap = document.querySelector('.sv-wrap');
    if (wrap) wrap.classList.remove('sv-open');
  }

  function togglePanel() {
    var wrap = document.querySelector('.sv-wrap');
    if (!wrap) return;
    var willOpen = !wrap.classList.contains('sv-open');
    if (willOpen) refreshPanel();
    wrap.classList.toggle('sv-open', willOpen);
  }

  /* ====================================================================== *
     Inject the .sv-wrap control into #filter-bar (idempotent)
     ====================================================================== */

  function injectControl() {
    var bar = document.getElementById('filter-bar');
    if (!bar) return;
    if (bar.querySelector('.sv-wrap')) return; // already present

    var wrap = document.createElement('div');
    wrap.className = 'sv-wrap';
    wrap.innerHTML =
      '<button class="btn btn-ghost sv-btn" type="button" data-sv-toggle="1" aria-haspopup="true">' +
      '<span class="sv-caret">▾</span> Views</button>' +
      '<div class="sv-panel" role="menu">' + buildPanelHtml() + '</div>';

    bar.appendChild(wrap);
  }

  /* ====================================================================== *
     Event wiring — one delegated document listener (own namespace; the
     contract dispatcher reads data-action, we read data-sv-* so we do not
     collide with the existing ACTIONS map)
     ====================================================================== */

  function wireEvents() {
    document.addEventListener('click', function (e) {
      var t = e.target;

      // Toggle button.
      var toggle = t.closest ? t.closest('[data-sv-toggle]') : null;
      if (toggle) { e.preventDefault(); togglePanel(); return; }

      // Delete (check before apply — the × lives inside an apply row).
      var del = t.closest ? t.closest('[data-sv-del]') : null;
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        deletePreset(del.getAttribute('data-sv-del'));
        return;
      }

      // Apply a saved preset.
      var apply = t.closest ? t.closest('[data-sv-apply]') : null;
      if (apply) {
        e.preventDefault();
        var preset = findPreset(apply.getAttribute('data-sv-apply'));
        if (preset) applyPreset(preset);
        closePanel();
        return;
      }

      // Panel actions (save / set-default).
      var action = t.closest ? t.closest('[data-sv-action]') : null;
      if (action) {
        e.preventDefault();
        var kind = action.getAttribute('data-sv-action');
        if (kind === 'save') { openSaveModal(); closePanel(); }
        else if (kind === 'default') { setCurrentAsDefault(); }
        return;
      }

      // Modal Save button.
      var modalSave = t.closest ? t.closest('[data-action="sv-save"]') : null;
      if (modalSave) { e.preventDefault(); doSaveFromModal(); return; }

      // Click outside an open panel closes it.
      if (!(t.closest && t.closest('.sv-wrap'))) closePanel();
    });

    // Escape closes the dropdown.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePanel();
    });
  }

  /* ====================================================================== *
     Styles — ONE <style>, all classes prefixed sv-, tokens only
     ====================================================================== */

  function injectStyles() {
    if (document.getElementById('sv-styles')) return;
    var css =
      '.sv-wrap{position:relative;display:inline-flex;align-items:center;margin-left:auto;}' +
      '.sv-btn{font-family:var(--sans);white-space:nowrap;}' +
      '.sv-btn .sv-caret{color:var(--accent);margin-right:2px;}' +
      '.sv-panel{position:absolute;top:calc(100% + 6px);right:0;z-index:60;min-width:230px;' +
        'background:var(--bg-2);border:1px solid var(--line-2);border-radius:8px;' +
        'box-shadow:0 12px 30px rgba(0,0,0,.45);padding:6px;display:none;}' +
      '.sv-wrap.sv-open .sv-panel{display:block;}' +
      '.sv-panel-head{font-family:var(--sans);font-size:10px;text-transform:uppercase;' +
        'letter-spacing:.08em;color:var(--text-2);padding:4px 8px 6px;}' +
      '.sv-list{max-height:240px;overflow-y:auto;}' +
      '.sv-empty{font-family:var(--sans);font-size:12px;color:var(--text-3);padding:6px 8px 8px;}' +
      '.sv-item{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;' +
        'cursor:pointer;font-family:var(--sans);font-size:12.5px;color:var(--text-1);}' +
      '.sv-item:hover{background:var(--bg-3);color:var(--text-0);}' +
      '.sv-item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.sv-check{color:var(--pos);font-size:12px;font-weight:700;}' +
      '.sv-del{color:var(--text-3);font-size:14px;line-height:1;padding:0 2px;border-radius:4px;cursor:pointer;}' +
      '.sv-del:hover{color:var(--neg);background:var(--neg-dim);}' +
      '.sv-divider{height:1px;background:var(--line);margin:6px 2px;}' +
      '.sv-action{padding:7px 8px;border-radius:6px;cursor:pointer;font-family:var(--sans);' +
        'font-size:12.5px;color:var(--text-1);}' +
      '.sv-action:hover{background:var(--bg-3);color:var(--text-0);}' +
      '.sv-modal-input{font-family:var(--mono);}' +
      '@media (max-width:920px){.sv-panel{right:auto;left:0;}}';

    var style = document.createElement('style');
    style.id = 'sv-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ====================================================================== *
     MutationObserver — re-inject .sv-wrap whenever renderFilterBar() wipes
     #filter-bar (innerHTML reset). Debounced; idempotent via injectControl.
     ====================================================================== */

  function observeFilterBar() {
    var bar = document.getElementById('filter-bar');
    if (!bar) return;
    var t;
    var obs = new MutationObserver(function () {
      clearTimeout(t);
      t = setTimeout(injectControl, 0);
    });
    obs.observe(bar, { childList: true, subtree: false });
  }

  /* ====================================================================== *
     Default-landing: if a saved default exists, apply it once on install
     ====================================================================== */

  function applyDefaultOnce() {
    var defName = loadDefaultName();
    if (!defName) return;
    var preset = findPreset(defName);
    if (preset) applyPreset(preset);
  }

  /* ====================================================================== *
     Install (top-level on load)
     ====================================================================== */

  function install() {
    injectStyles();
    injectControl();
    observeFilterBar();
    wireEvents();
    applyDefaultOnce();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
