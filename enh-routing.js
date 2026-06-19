/* ============================================================================
   CACAO/FP — enh-routing.js  (Enhancement #14 — URL hash deep-link routing)

   Self-installing module, loaded LAST (after every view + action + first/second
   wave enhancement is wired) so it can restore a deep-linked state once the app
   is fully assembled.

   What it does
   ------------
   • Encodes CURRENT_VIEW + the *non-default* FILTERS into location.hash, e.g.
       #/ppv?origin=CIV&supplier=Barry%20Callebaut%20Sourcing&version=v5%20·%20…
     Only filters that differ from defaultFilters are written (keeps the hash
     short); values are URL-encoded.
   • buildHash(view, FILTERS) / parseHash(hash) round-trip. parseHash tolerates a
     missing/garbage hash (returns { view:null, filters:{} }).
   • Echo-guarded sync (ENH_CONTRACT2 §D): afterRender(writeHash) reflects nav
     clicks + filter changes into the URL; a window 'hashchange' listener calls
     applyHash to restore state. A module flag breaks the write→hashchange→read
     →write loop.
   • applyHash() sets FILTERS via Object.assign (never reassigns the const) +
     saveFilters + renderFilterBar + switchView(view). On install it runs once to
     restore a deep-link; if there is no hash it leaves the current dashboard
     as-is (no forced switch).
   • A "Copy link" affordance (.rt-copy, styled like .btn-ghost btn-sm) is appended
     to #filter-bar and re-injected by a #filter-bar MutationObserver (mirrors the
     saved-views control). It writes location.href to the clipboard and toasts.

   Validation
   ----------
   A parsed filter value is dropped unless it appears in DATA.filterTaxonomy for
   its key — invalid/garbage filters are never applied.

   Hooks used (per ENH_CONTRACT / ENH_CONTRACT2 §D)
   ------------------------------------------------
   • afterRender (canvas MutationObserver, debounced + initial pass).
   • window 'hashchange' → applyHash.
   • #filter-bar MutationObserver → re-inject .rt-copy.
   None of these reassign switchView; they only CALL switchView/renderFilterBar/
   saveFilters and mutate FILTERS' properties in place.

   Globals consumed (never redefined): DATA, FILTERS, defaultFilters, saveFilters,
   renderFilterBar, switchView, CURRENT_VIEW, VIEWS, toast.
   ========================================================================== */

(function () {
  'use strict';

  /* ---- Idempotency: never install twice -------------------------------- */
  if (window.__cacaoRoutingInstalled) return;
  window.__cacaoRoutingInstalled = true;

  /* Echo-guard flag: true while WE are writing the hash / applying it, so the
     resulting hashchange event is ignored (no infinite write→read→write loop). */
  var _applying = false;

  /* ====================================================================== *
     Small helpers (local — not contract globals)
     ====================================================================== */

  /* Map each FILTERS key → its DATA.filterTaxonomy list name. Mirrors
     views2.js FILTER_SELECTS so encode/decode stay consistent. */
  var KEY_TO_TAX = {
    period: 'periods',
    origin: 'origins',
    supplier: 'suppliers',
    version: 'versions',
    sku: 'skus',
    currency: 'currencies'
  };

  function safeToast(opts) {
    try { if (typeof toast === 'function') toast(opts); } catch (e) {}
  }

  /* Default value for a filter key, read from the live defaultFilters const. */
  function defaultValue(key) {
    if (typeof defaultFilters === 'object' && defaultFilters && key in defaultFilters) {
      return defaultFilters[key];
    }
    return undefined;
  }

  /* Is `value` a member of the taxonomy list for `key`? Used to drop garbage. */
  function isValidFilterValue(key, value) {
    var taxName = KEY_TO_TAX[key];
    if (!taxName) return false;
    try {
      var list = DATA && DATA.filterTaxonomy ? DATA.filterTaxonomy[taxName] : null;
      return Array.isArray(list) && list.indexOf(value) !== -1;
    } catch (e) {
      return false;
    }
  }

  /* ====================================================================== *
     buildHash / parseHash — the round-trip
     ====================================================================== */

  /* Encode view + the non-default filters into a "/view?k=v&k=v" hash body
     (no leading '#'). Only keys that (a) exist in the taxonomy map, (b) differ
     from their default, and (c) hold a non-empty value are written. */
  function buildHash(view, filters) {
    var v = (typeof view === 'string' && view) ? view : 'dashboard';
    var parts = [];
    var f = (filters && typeof filters === 'object') ? filters : {};

    Object.keys(KEY_TO_TAX).forEach(function (key) {
      if (!(key in f)) return;
      var val = f[key];
      if (val == null || val === '') return;
      if (val === defaultValue(key)) return; // skip defaults → short hash
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(val));
    });

    var body = '/' + encodeURIComponent(v);
    if (parts.length) body += '?' + parts.join('&');
    return body;
  }

  /* Parse a hash string (with or without leading '#') back into
     { view, filters }. Tolerant: a missing/garbage hash yields
     { view:null, filters:{} }. Only taxonomy-valid filters survive. */
  function parseHash(hash) {
    var result = { view: null, filters: {} };
    try {
      var h = String(hash == null ? '' : hash);
      if (h.charAt(0) === '#') h = h.slice(1);
      if (h.charAt(0) === '/') h = h.slice(1);
      if (!h) return result;

      var qIdx = h.indexOf('?');
      var viewPart = qIdx === -1 ? h : h.slice(0, qIdx);
      var queryPart = qIdx === -1 ? '' : h.slice(qIdx + 1);

      var view = decodeURIComponent(viewPart);
      // Only honour a real, registered view name.
      if (view && typeof VIEWS === 'object' && VIEWS && VIEWS[view]) {
        result.view = view;
      }

      if (queryPart) {
        queryPart.split('&').forEach(function (pair) {
          if (!pair) return;
          var eq = pair.indexOf('=');
          if (eq === -1) return;
          var rawKey, rawVal;
          try {
            rawKey = decodeURIComponent(pair.slice(0, eq));
            rawVal = decodeURIComponent(pair.slice(eq + 1));
          } catch (e) {
            return; // malformed escape → drop this pair
          }
          if (!(rawKey in KEY_TO_TAX)) return;       // unknown key → drop
          if (!isValidFilterValue(rawKey, rawVal)) return; // not in taxonomy → drop
          result.filters[rawKey] = rawVal;
        });
      }
    } catch (e) {
      return { view: null, filters: {} };
    }
    return result;
  }

  /* ====================================================================== *
     writeHash / applyHash — echo-guarded sync (ENH_CONTRACT2 §D)
     ====================================================================== */

  function writeHash() {
    if (_applying) return;
    if (typeof CURRENT_VIEW === 'undefined') return;
    var body = buildHash(CURRENT_VIEW, (typeof FILTERS === 'object' && FILTERS) ? FILTERS : {});
    if ('#' + body === location.hash) return; // already in sync — no-op
    _applying = true;
    try {
      location.hash = body;
    } catch (e) { /* hash write blocked — non-fatal */ }
    setTimeout(function () { _applying = false; }, 0);
  }

  /* Restore state from the current hash. forceSwitch=false (install path) leaves
     the already-rendered dashboard alone when the hash carries no view. */
  function applyHash(forceSwitch) {
    if (_applying) return;
    var parsed = parseHash(location.hash);
    var hasView = !!parsed.view;
    var filterKeys = Object.keys(parsed.filters);

    // Nothing to restore and we're not allowed to force a switch → bail.
    if (!hasView && filterKeys.length === 0 && forceSwitch !== true) return;

    _applying = true;
    try {
      if (typeof FILTERS === 'object' && FILTERS) {
        // Reset taxonomy-managed keys to their defaults, then overlay the parsed
        // (validated) filters. This makes the hash authoritative: removing a
        // param from the URL clears that filter rather than leaving a stale one.
        var resetPatch = {};
        Object.keys(KEY_TO_TAX).forEach(function (key) {
          if (key in FILTERS) {
            var def = defaultValue(key);
            if (def !== undefined) resetPatch[key] = def;
          }
        });
        Object.assign(FILTERS, resetPatch, parsed.filters);

        try { if (typeof saveFilters === 'function') saveFilters(FILTERS); } catch (e) {}
        try { if (typeof renderFilterBar === 'function') renderFilterBar(); } catch (e) {}
      }

      if (parsed.view && typeof switchView === 'function') {
        switchView(parsed.view);
      } else if (forceSwitch === true && typeof switchView === 'function' &&
                 typeof CURRENT_VIEW !== 'undefined') {
        // Hash had filters but no view (or a forced re-render is requested):
        // repaint the current view so the new filters take effect.
        switchView(CURRENT_VIEW);
      }
    } catch (e) {
      /* never throw out of a hashchange / install path */
    }
    setTimeout(function () { _applying = false; }, 0);
  }

  /* ====================================================================== *
     afterRender — run a fn after EVERY view render (ENH_CONTRACT §1)
     ====================================================================== */

  function afterRender(fn) {
    var canvas = document.getElementById('canvas');
    if (!canvas) { try { fn(); } catch (e) {} return; }
    var t;
    var run = function () { clearTimeout(t); t = setTimeout(fn, 0); };
    try {
      new MutationObserver(run).observe(canvas, { childList: true, subtree: false });
    } catch (e) { /* observer unavailable — initial pass still runs below */ }
    try { fn(); } catch (e) {} // initial pass for the already-rendered view
  }

  /* ====================================================================== *
     "Copy link" affordance — .rt-copy appended to #filter-bar (idempotent)
     ====================================================================== */

  function copyCurrentLink() {
    var url = location.href;

    var done = function () {
      safeToast({
        type: 'success',
        title: 'Link copied',
        body: 'Opens this exact view + filters'
      });
    };
    var fail = function () {
      safeToast({
        type: 'warn',
        title: 'Copy failed',
        body: 'Select the address bar and copy manually.'
      });
    };

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(url).then(done, function () {
          if (!legacyCopy(url)) fail(); else done();
        });
        return;
      }
    } catch (e) { /* fall through to legacy copy */ }

    if (legacyCopy(url)) done(); else fail();
  }

  /* Fallback copy for browsers without async clipboard (e.g. insecure origin). */
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  function injectCopyButton() {
    var bar = document.getElementById('filter-bar');
    if (!bar) return;
    if (bar.querySelector('.rt-copy')) return; // already present

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm rt-copy';
    btn.setAttribute('title', 'Copy a link to this exact view + filters');
    btn.innerHTML = '<span class="rt-copy-ico">🔗</span> Copy link';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      copyCurrentLink();
    });
    bar.appendChild(btn);
  }

  /* Re-inject .rt-copy whenever renderFilterBar() rebuilds #filter-bar.
     Debounced; idempotent via injectCopyButton (mirrors the saved-views obs). */
  function observeFilterBar() {
    var bar = document.getElementById('filter-bar');
    if (!bar) return;
    var t;
    try {
      var obs = new MutationObserver(function () {
        clearTimeout(t);
        t = setTimeout(injectCopyButton, 0);
      });
      obs.observe(bar, { childList: true, subtree: false });
    } catch (e) { /* observer unavailable — non-fatal */ }
  }

  /* ====================================================================== *
     Styles — ONE <style>, all classes prefixed rt-, tokens only
     ====================================================================== */

  function injectStyles() {
    if (document.getElementById('rt-styles')) return;
    var css =
      '.rt-copy{font-family:var(--sans);white-space:nowrap;display:inline-flex;' +
        'align-items:center;gap:5px;margin-left:8px;}' +
      '.rt-copy .rt-copy-ico{color:var(--accent);font-size:12px;line-height:1;}' +
      '.rt-copy:hover .rt-copy-ico{color:var(--accent-2);}';

    var style = document.createElement('style');
    style.id = 'rt-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ====================================================================== *
     Install (top-level on load)
     ====================================================================== */

  function install() {
    injectStyles();
    injectCopyButton();
    observeFilterBar();

    // Reflect CURRENT_VIEW/FILTERS into the URL after every render (nav clicks +
    // filter changes). afterRender also fires once now for the current view.
    afterRender(writeHash);

    // Restore on subsequent hash edits (back/forward, manual edits, copied link).
    window.addEventListener('hashchange', function () { applyHash(true); });

    // On load: restore a deep-linked state if one is present. Pass forceSwitch
    // = false so a bare app (no hash) keeps the already-rendered dashboard.
    applyHash(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
