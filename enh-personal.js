/* ============================================================================
   CACAO/FP — enh-personal.js  (#30 — Copy-to-clipboard + Annotations + Audit)
   ----------------------------------------------------------------------------
   Self-installing enhancement module. Loaded AFTER app.js / views2.js /
   actions.js and the other enh-* modules (see index.html load order).

   THREE features, one file:

   (A) COPY TABLE → CLIPBOARD
       After every #canvas render, a small "⧉ Copy" .btn-sm is added to each
       <table class="table"> (idempotent per table). It serialises header +
       visible rows to TSV and writes it via navigator.clipboard.writeText
       (falling back to a hidden-textarea execCommand('copy')), then toasts
       "Copied N rows — paste into Excel".

   (B) ANNOTATIONS (sticky notes)
       The analyst can attach a note to any KPI tile (.kpi) and any drill row
       (tr[data-action]). After render a tiny "🗩" affordance is injected
       (idempotent); a stable id keys the note (kpi label / row action+payload
       + current view). Annotated elements show a coloured corner dot; clicking
       the affordance opens a small popover with a <textarea> to edit/save.
       A "🗩 Notes" topbar button lists every note with jump links.

   (C) PERSONAL AUDIT LOG
       A capture-phase document click listener records meaningful [data-action]
       activations (action verb + friendly label + timestamp) into an in-memory
       + localStorage ring buffer (cap ~100). A "🕘 Activity" topbar button opens
       a drawer "My Activity Today" listing the log newest-first, with Clear.

   HARD-RULE compliance:
     • Plain JS IIFE; installs at top level on load. Edits no other file.
     • ONE module-prefixed <style id="pn-styles">; pn-* classes; design tokens
       only (var(--bg-*) / --text-* / --line* / --accent / --pos --neg --warn
       --info / --mono --sans). styles.css untouched.
     • References DATA / VIEWS / ACTIONS / CURRENT_VIEW / toast / openDrawer /
       closeDrawer BARE with typeof guards (they are const/let — NOT on window).
       Never reassigns switchView / toast / modal / openDrawer.
     • Reacts to renders by OBSERVING #canvas with a MutationObserver
       (afterRender), never by intercepting switchView.
     • Additive document listeners only; respects e.defaultPrevented; never
       stopImmediatePropagation globally (coexists with cmdk Ctrl/⌘-K +
       brief Escape handlers).
     • Idempotent install guard (window.__personalInstalled).
     • localStorage keys prefixed cacao_, all reads/writes wrapped in try/catch.
     • Zero console output.
   ========================================================================== */
(function () {
  'use strict';

  /* Idempotent install guard ------------------------------------------------ */
  if (window.__personalInstalled) return;
  window.__personalInstalled = true;

  /* Constants --------------------------------------------------------------- */
  var STYLE_ID    = 'pn-styles';
  var NOTES_KEY   = 'cacao_notes_v1';
  var AUDIT_KEY   = 'cacao_audit_v1';
  var AUDIT_CAP   = 100;
  var COPY_CLASS  = 'pn-copy-btn';
  var NOTE_CLASS  = 'pn-note-aff';
  var POP_ID      = 'pn-popover';

  /* Actions we DON'T want cluttering the personal audit log (navigation /
     chrome / our own affordances / drill-open noise). Everything else that
     carries a data-action is treated as a meaningful activation. */
  var AUDIT_EXCLUDE = {
    'close-modal': 1, 'close-drawer': 1, 'toggle-rail': 1,
    'clear-filter': 1, 'reset-filters': 1, 'post-activity': 1,
    'card-toggle': 1, 'refresh': 1,
    'pn-add-note': 1, 'pn-open-notes': 1, 'pn-open-audit': 1,
    'pn-clear-audit': 1, 'pn-jump-note': 1, 'pn-save-note': 1,
    'pn-delete-note': 1, 'pn-close-pop': 1, 'pn-copy-table': 1
  };

  /* Friendly labels for the audit log (fallback = humanised verb). --------- */
  var ACTION_LABELS = {
    'export-excel': 'Exported to Excel',
    'export-pbi': 'Exported to Power BI',
    'export-pdf': 'Exported to PDF',
    'export-pptx': 'Exported to PowerPoint',
    'send-report': 'Sent report',
    'print-view': 'Printed module',
    'run-forecast': 'Ran forecast',
    'confirm-run-forecast': 'Confirmed forecast run',
    'snapshot-dashboard': 'Snapshotted dashboard',
    'set-alert': 'Opened set-alert',
    'confirm-set-alert': 'Created price alert',
    'strategy-book': 'Opened strategy book',
    'confirm-strategy': 'Saved hedging strategy',
    'new-position': 'Opened new position',
    'new-contract': 'Opened new contract',
    'confirm-new-contract': 'Created contract',
    'import-irely': 'Imported from iRely',
    'fix-ptbf': 'Opened PTBF fixing',
    'confirm-fix-ptbf': 'Fixed PTBF contract',
    'new-hedge': 'Opened new hedge',
    'confirm-new-hedge': 'Placed hedge order',
    'effectiveness-test': 'Ran effectiveness test',
    'var-report': 'Opened VaR report',
    'run-prospective': 'Ran prospective test',
    'export-pwc': 'Exported PwC pack',
    'dedesignate-failed': 'Opened de-designation',
    'confirm-dedesignate': 'De-designated hedge',
    'cycle-count': 'Opened cycle count',
    'confirm-cycle-count': 'Scheduled cycle count',
    'lcm-test': 'Ran LCM / NRV test',
    'reserve-calc': 'Opened reserve calc',
    'confirm-reserve': 'Booked reserve JE',
    'lock-forecast': 'Opened lock forecast',
    'confirm-lock-forecast': 'Locked forecast version',
    'compare-versions': 'Compared versions',
    'run-scenarios': 'Ran scenarios',
    'branch-current': 'Opened branch version',
    'confirm-branch': 'Branched forecast',
    'submit-approval': 'Submitted for approval',
    'open-blackline': 'Opened BlackLine',
    'sign-off': 'Signed off close item',
    'evidence-repo': 'Opened evidence repo',
    'audit-requests': 'Opened audit requests',
    'run-test': 'Ran control test',
    'submit-dds': 'Submitted DDS',
    'risk-heatmap': 'Opened risk heatmap',
    'compliance-report': 'Ran compliance report',
    'sync-treasury': 'Synced treasury',
    'liquidity-stress': 'Ran liquidity stress',
    'export-treasury': 'Exported treasury',
    'save-scenario': 'Saved what-if scenario',
    'compare-scenarios': 'Compared scenarios',
    'reset-whatif': 'Reset what-if',
    'generate-commentary': 'Generated commentary',
    'copy-commentary': 'Copied commentary',
    'send-commentary': 'Sent commentary',
    'open-s4': 'Opened S/4 record',
    'export-trail': 'Exported audit trail',
    'add-comment': 'Added comment',
    'tag-reviewer': 'Tagged reviewer',
    'escalate': 'Escalated item',
    'view-contract': 'Viewed contract',
    'drill-kpi': 'Drilled KPI',
    'drill-origin': 'Drilled origin',
    'drill-supplier': 'Drilled supplier',
    'drill-sku': 'Drilled SKU',
    'drill-alert': 'Drilled alert',
    'drill-control': 'Drilled control',
    'drill-lot': 'Drilled lot',
    'drill-task': 'Drilled close task',
    'drill-version': 'Drilled version',
    'drill-recon': 'Drilled reconciliation',
    'drill-je': 'Drilled journal entry',
    'drill-margin-call': 'Drilled margin call',
    'drill-driver': 'Drilled driver',
    'drill-activity': 'Drilled activity'
  };

  /* ----------------------------------------------------------------------- */
  /* Small utilities                                                          */
  /* ----------------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeToast(opts) {
    try { if (typeof toast === 'function') toast(opts); } catch (e) { /* best-effort */ }
  }

  function currentView() {
    try {
      if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW) return String(CURRENT_VIEW);
    } catch (e) { /* not reachable */ }
    return 'view';
  }

  function nowTime() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* localStorage JSON helpers (always try/catch) --------------------------- */
  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* ----------------------------------------------------------------------- */
  /* afterRender — observe #canvas, debounced, plus an initial pass.          */
  /* (ENH_CONTRACT §1)                                                        */
  /* ----------------------------------------------------------------------- */
  function afterRender(fn) {
    var canvas = document.getElementById('canvas');
    if (!canvas) { fn(); return; }
    var t;
    var run = function () { clearTimeout(t); t = setTimeout(fn, 0); };
    try { new MutationObserver(run).observe(canvas, { childList: true, subtree: false }); }
    catch (e) { /* MutationObserver always present in target runtime */ }
    fn(); // initial pass for the already-rendered view
  }

  /* ======================================================================= */
  /* (A) COPY TABLE → CLIPBOARD                                               */
  /* ======================================================================= */

  /* Serialise a table to TSV: header cells + every visible body row. */
  function tableToTsv(table) {
    var lines = [];
    var head = table.querySelector('thead tr');
    if (head) {
      lines.push(Array.prototype.map.call(head.children, cellText).join('\t'));
    }
    var bodyRows = table.querySelectorAll('tbody tr');
    if (!bodyRows.length) bodyRows = table.querySelectorAll('tr'); // tables w/o tbody
    var count = 0;
    Array.prototype.forEach.call(bodyRows, function (tr) {
      if (head && tr.parentNode && tr.parentNode.tagName === 'THEAD') return;
      if (!isVisible(tr)) return;                       // honour any row hiding
      var cells = tr.querySelectorAll('th,td');
      if (!cells.length) return;
      lines.push(Array.prototype.map.call(cells, cellText).join('\t'));
      count++;
    });
    return { tsv: lines.join('\n'), rows: count };
  }

  function cellText(cell) {
    var t = (cell.textContent || '').replace(/\s+/g, ' ').trim();
    return t.replace(/\t/g, ' ');
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.hidden) return false;
    var st = el.style;
    if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
    // offsetParent is null for display:none ancestors; rows have layout when shown.
    if (el.offsetParent === null && el.getClientRects().length === 0) return false;
    return true;
  }

  function writeClipboard(text, onDone) {
    var done = false;
    var finish = function (ok) { if (done) return; done = true; onDone(ok); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { finish(true); },
          function () { finish(legacyCopy(text)); }
        );
        return;
      }
    } catch (e) { /* fall through to legacy */ }
    finish(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.left = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* Inject a "⧉ Copy" button into each table's card header (or, lacking one,
     just before the table). Idempotent per table via a dataset flag. */
  function enhanceTables() {
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    var tables = canvas.querySelectorAll('table.table');
    Array.prototype.forEach.call(tables, function (table, i) {
      if (table.dataset.pnCopy) return;
      table.dataset.pnCopy = '1';
      var id = 'pn-tbl-' + i;
      table.dataset.pnTblId = id;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-ghost ' + COPY_CLASS;
      btn.title = 'Copy this table to the clipboard (TSV — paste into Excel)';
      btn.setAttribute('data-action', 'pn-copy-table');
      btn.setAttribute('data-payload', id);
      btn.innerHTML = '<span class="pn-ico">⧉</span> Copy';

      // Prefer the owning card's .card-head so the button sits with the title.
      var card = table.closest ? table.closest('.card') : null;
      var head = card ? card.querySelector('.card-head') : null;
      if (head) {
        head.classList.add('pn-head-flex');
        head.appendChild(btn);
      } else {
        var wrap = table.closest ? table.closest('.table-wrap') : null;
        var anchor = wrap || table;
        anchor.parentNode.insertBefore(btn, anchor);
      }
    });
  }

  function copyTableById(id) {
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    var table = canvas.querySelector('table.table[data-pn-tbl-id="' + id + '"]');
    if (!table) return;
    var res = tableToTsv(table);
    if (!res.tsv) {
      safeToast({ type: 'warn', title: 'Nothing to copy', body: 'This table has no visible rows.' });
      return;
    }
    writeClipboard(res.tsv, function (ok) {
      if (ok) {
        safeToast({
          type: 'success',
          title: 'Copied ' + res.rows + (res.rows === 1 ? ' row' : ' rows'),
          body: 'Paste into Excel (tab-separated).'
        });
      } else {
        safeToast({ type: 'error', title: 'Copy failed', body: 'Clipboard unavailable in this browser.' });
      }
    });
  }

  /* ======================================================================= */
  /* (B) ANNOTATIONS                                                          */
  /* ======================================================================= */

  /* Stable id for an annotatable element. KPIs key off their label (stable
     across renders); rows key off action+payload+view (stable per record). */
  function noteIdFor(el) {
    if (el.classList && el.classList.contains('kpi')) {
      var lab = el.querySelector('.kpi-label');
      var text = lab ? (lab.textContent || '').replace(/[▸\s]+$/, '').trim() : '';
      var pay = el.getAttribute('data-payload') || '';
      return 'kpi::' + (pay || text);
    }
    // tr[data-action]
    var act = el.getAttribute('data-action') || 'row';
    var payload = el.getAttribute('data-payload') || '';
    return 'row::' + currentView() + '::' + act + '::' + payload;
  }

  /* A short human label for the Notes list. */
  function noteTitleFor(el, id) {
    if (el && el.classList && el.classList.contains('kpi')) {
      var lab = el.querySelector('.kpi-label');
      var text = lab ? (lab.textContent || '').replace(/[▸\s]+$/, '').trim() : 'KPI';
      return 'KPI · ' + text;
    }
    if (el) {
      var strong = el.querySelector('.cell-strong');
      var first = el.querySelector('td,th');
      var label = (strong || first) ? ((strong || first).textContent || '').trim() : '';
      var act = el.getAttribute('data-action') || '';
      var view = currentView();
      return (view ? view + ' · ' : '') + (label || act || 'Row');
    }
    // Fallback derived from the id (used by jump-list rendering).
    return id;
  }

  function getNotes() { return lsGet(NOTES_KEY, {}); }
  function getNote(id) {
    var n = getNotes();
    return n && Object.prototype.hasOwnProperty.call(n, id) ? n[id] : null;
  }
  function saveNote(id, rec) {
    var n = getNotes();
    if (rec && rec.text && rec.text.trim()) { n[id] = rec; } else { delete n[id]; }
    lsSet(NOTES_KEY, n);
  }
  function deleteNote(id) {
    var n = getNotes();
    if (Object.prototype.hasOwnProperty.call(n, id)) { delete n[id]; lsSet(NOTES_KEY, n); }
  }

  /* Inject the 🗩 affordance onto KPI tiles + drill rows (idempotent). */
  function enhanceAnnotatables() {
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    var targets = [];
    Array.prototype.push.apply(targets, canvas.querySelectorAll('.kpi'));
    Array.prototype.push.apply(targets, canvas.querySelectorAll('tr[data-action]'));

    targets.forEach(function (el) {
      if (el.dataset.pnNote) { refreshNoteState(el); return; }
      el.dataset.pnNote = '1';
      var id = noteIdFor(el);
      el.dataset.pnNoteId = id;

      var aff = document.createElement('span');
      aff.className = NOTE_CLASS;
      aff.setAttribute('data-action', 'pn-add-note');
      aff.setAttribute('data-payload', id);
      aff.setAttribute('role', 'button');
      aff.setAttribute('tabindex', '0');
      aff.setAttribute('aria-label', 'Add or edit note');
      aff.title = 'Add / edit note';
      aff.textContent = '🗩';

      if (el.tagName === 'TR') {
        // Place the affordance inside the first cell so layout stays valid.
        var cell = el.querySelector('td,th');
        if (cell) { cell.classList.add('pn-cell-host'); cell.appendChild(aff); }
        else { return; }
      } else {
        el.classList.add('pn-host');
        el.appendChild(aff);
      }
      refreshNoteState(el);
    });
  }

  /* Toggle the coloured corner dot + tooltip based on whether a note exists. */
  function refreshNoteState(el) {
    var id = el.dataset.pnNoteId;
    if (!id) return;
    var rec = getNote(id);
    var aff = el.querySelector('.' + NOTE_CLASS);
    if (rec && rec.text) {
      el.classList.add('pn-annotated');
      if (aff) { aff.classList.add('pn-has-note'); aff.title = rec.text; }
    } else {
      el.classList.remove('pn-annotated');
      if (aff) { aff.classList.remove('pn-has-note'); aff.title = 'Add / edit note'; }
    }
  }

  function refreshAllNoteStates() {
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    Array.prototype.forEach.call(canvas.querySelectorAll('[data-pn-note-id]'), refreshNoteState);
  }

  /* ---- the note popover -------------------------------------------------- */
  function closePopover() {
    var pop = document.getElementById(POP_ID);
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    document.removeEventListener('keydown', popKeyHandler, true);
  }

  function popKeyHandler(e) {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      var pop = document.getElementById(POP_ID);
      if (pop) { e.preventDefault(); closePopover(); }
    }
  }

  function openPopover(id, anchorEl) {
    closePopover();
    var rec = getNote(id);
    var existing = rec && rec.text ? rec.text : '';

    var pop = document.createElement('div');
    pop.id = POP_ID;
    pop.className = 'pn-pop';
    pop.innerHTML =
      '<div class="pn-pop-head">' +
        '<span class="pn-pop-title">🗩 Note</span>' +
        '<button class="pn-pop-x" type="button" data-action="pn-close-pop" aria-label="Close">×</button>' +
      '</div>' +
      '<textarea class="pn-pop-ta" placeholder="Add a sticky note for this item…">' + esc(existing) + '</textarea>' +
      '<div class="pn-pop-foot">' +
        (existing
          ? '<button class="btn btn-sm btn-danger" type="button" data-action="pn-delete-note" data-payload="' + esc(id) + '">Delete</button>'
          : '<span class="pn-pop-spacer"></span>') +
        '<button class="btn btn-sm btn-primary" type="button" data-action="pn-save-note" data-payload="' + esc(id) + '">Save</button>' +
      '</div>';

    document.body.appendChild(pop);
    positionPopover(pop, anchorEl);

    var ta = pop.querySelector('.pn-pop-ta');
    if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
    document.addEventListener('keydown', popKeyHandler, true);
  }

  function positionPopover(pop, anchorEl) {
    var rect;
    try { rect = anchorEl.getBoundingClientRect(); } catch (e) { rect = null; }
    var w = 280, margin = 8;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var top, left;
    if (rect) {
      left = rect.left;
      top = rect.bottom + 6;
    } else {
      left = (vw - w) / 2; top = vh * 0.2;
    }
    if (left + w + margin > vw) left = vw - w - margin;
    if (left < margin) left = margin;
    // If it would overflow the bottom, place it above the anchor.
    var ph = pop.offsetHeight || 180;
    if (top + ph + margin > vh && rect) top = Math.max(margin, rect.top - ph - 6);
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  function handleSaveNote(id) {
    var pop = document.getElementById(POP_ID);
    var ta = pop ? pop.querySelector('.pn-pop-ta') : null;
    var text = ta ? ta.value : '';
    if (text && text.trim()) {
      saveNote(id, { text: text.trim(), view: currentView(), ts: Date.now() });
      safeToast({ type: 'success', title: 'Note saved', body: 'Annotation attached to this item.' });
    } else {
      deleteNote(id);
      safeToast({ type: 'info', title: 'Note cleared', body: 'Empty note removed.' });
    }
    closePopover();
    refreshAllNoteStates();
  }

  function handleDeleteNote(id) {
    deleteNote(id);
    safeToast({ type: 'info', title: 'Note deleted', body: 'Annotation removed.' });
    closePopover();
    refreshAllNoteStates();
  }

  /* ---- the Notes list (drawer) ------------------------------------------ */
  function openNotesDrawer() {
    if (typeof openDrawer !== 'function') return;
    var notes = getNotes();
    var ids = Object.keys(notes);
    // newest first by timestamp
    ids.sort(function (a, b) { return (notes[b].ts || 0) - (notes[a].ts || 0); });

    var body;
    if (!ids.length) {
      body = '<div class="pn-empty">No notes yet. Click the 🗩 on any KPI tile or drill row to attach a sticky note.</div>';
    } else {
      var items = ids.map(function (id) {
        var rec = notes[id] || {};
        var view = rec.view || idView(id);
        var label = idLabel(id);
        var when = rec.ts ? fmtWhen(rec.ts) : '';
        return '<div class="pn-note-row">' +
          '<div class="pn-note-meta">' +
            '<span class="pn-note-where">' + esc(label) + '</span>' +
            (when ? '<span class="pn-note-when mono">' + esc(when) + '</span>' : '') +
          '</div>' +
          '<div class="pn-note-text">' + esc(rec.text || '') + '</div>' +
          '<div class="pn-note-actions">' +
            '<button class="btn btn-sm btn-ghost" type="button" data-action="pn-jump-note" data-payload="' + esc(view) + '">Go to ' + esc(view) + '</button>' +
            '<button class="btn btn-sm btn-danger" type="button" data-action="pn-delete-note" data-payload="' + esc(id) + '">Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
      body = '<div class="section-title">' + ids.length + (ids.length === 1 ? ' note' : ' notes') + '</div>' +
             '<div class="pn-note-list">' + items + '</div>';
    }

    openDrawer({
      title: '🗩 My Notes',
      sub: 'Sticky annotations on KPIs & drill rows · saved locally',
      body: body
    });
  }

  function idView(id) {
    // row::<view>::<action>::<payload>
    var parts = String(id).split('::');
    if (parts[0] === 'row' && parts[1]) return parts[1];
    return 'dashboard';
  }
  function idLabel(id) {
    var parts = String(id).split('::');
    if (parts[0] === 'kpi') return 'KPI · ' + (parts[1] || '');
    if (parts[0] === 'row') {
      var view = parts[1] || '';
      var act = parts[2] || '';
      var pay = parts[3] || '';
      return (view ? view + ' · ' : '') + (pay || act);
    }
    return id;
  }

  /* ======================================================================= */
  /* (C) PERSONAL AUDIT LOG                                                   */
  /* ======================================================================= */

  /* In-memory mirror of the persisted ring buffer (keeps "today" only). */
  var auditLog = loadAuditToday();

  function loadAuditToday() {
    var all = lsGet(AUDIT_KEY, []);
    if (!Array.isArray(all)) all = [];
    var today = dayStamp(Date.now());
    return all.filter(function (e) { return e && e.day === today; });
  }

  function dayStamp(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function friendlyLabel(action, el) {
    var base = ACTION_LABELS[action];
    if (!base) {
      base = action.replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    // Append a target hint from the clicked element where useful.
    var hint = '';
    try {
      var payload = el && el.getAttribute ? (el.getAttribute('data-payload') || '') : '';
      if (payload && payload.length <= 24 && /drill|view-contract|view/.test(action)) hint = ' · ' + payload;
    } catch (e) { /* ignore */ }
    return base + hint;
  }

  function logActivity(action, el) {
    var entry = {
      action: action,
      label: friendlyLabel(action, el),
      view: currentView(),
      ts: Date.now(),
      day: dayStamp(Date.now())
    };
    auditLog.unshift(entry);

    // Persist a capped ring buffer across all days, newest-first.
    var all = lsGet(AUDIT_KEY, []);
    if (!Array.isArray(all)) all = [];
    all.unshift(entry);
    if (all.length > AUDIT_CAP) all = all.slice(0, AUDIT_CAP);
    lsSet(AUDIT_KEY, all);

    // Live-refresh the drawer if it's open.
    if (document.querySelector('.pn-audit-list')) renderAuditInto();
  }

  function clearAudit() {
    auditLog = [];
    // Drop only today's entries from the persisted buffer; keep history.
    var all = lsGet(AUDIT_KEY, []);
    if (!Array.isArray(all)) all = [];
    var today = dayStamp(Date.now());
    lsSet(AUDIT_KEY, all.filter(function (e) { return e && e.day !== today; }));
    if (document.querySelector('.pn-audit-list')) renderAuditInto();
    safeToast({ type: 'info', title: 'Activity cleared', body: "Today's log was reset." });
  }

  function fmtWhen(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function auditBodyHtml() {
    if (!auditLog.length) {
      return '<div class="pn-empty">No tracked activity yet today. Exports, sign-offs, fixes, tests and drills will appear here.</div>';
    }
    var rows = auditLog.map(function (e) {
      return '<div class="pn-audit-item">' +
        '<span class="pn-audit-time mono">' + esc(fmtWhen(e.ts)) + '</span>' +
        '<div class="pn-audit-body">' +
          '<div class="pn-audit-label">' + esc(e.label) + '</div>' +
          '<div class="pn-audit-view">' + esc(e.view) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="pn-audit-bar">' +
        '<span class="section-title pn-audit-count">' + auditLog.length + (auditLog.length === 1 ? ' event' : ' events') + '</span>' +
        '<button class="btn btn-sm btn-ghost" type="button" data-action="pn-clear-audit">Clear</button>' +
      '</div>' +
      '<div class="pn-audit-list">' + rows + '</div>';
  }

  /* Re-render the drawer body in place when the log changes while open. */
  function renderAuditInto() {
    var drawerBody = document.querySelector('.drawer-body');
    if (!drawerBody) return;
    if (!drawerBody.querySelector('.pn-audit-list') && !drawerBody.querySelector('.pn-empty')) return;
    drawerBody.innerHTML = auditBodyHtml();
  }

  function openAuditDrawer() {
    if (typeof openDrawer !== 'function') return;
    openDrawer({
      title: '🕘 My Activity Today',
      sub: 'Personal audit log · tracked actions, newest first · saved locally',
      body: auditBodyHtml()
    });
  }

  /* ======================================================================= */
  /* TOPBAR BUTTONS (idempotent, prepended)                                   */
  /* ======================================================================= */
  function injectTopbarButtons() {
    var bar = document.querySelector('.topbar-actions');
    if (!bar) return;

    if (!bar.querySelector('.pn-notes-btn')) {
      var notesBtn = document.createElement('button');
      notesBtn.type = 'button';
      notesBtn.className = 'btn btn-ghost pn-notes-btn';
      notesBtn.title = 'My notes (sticky annotations)';
      notesBtn.setAttribute('aria-label', 'Open my notes');
      notesBtn.setAttribute('data-action', 'pn-open-notes');
      notesBtn.innerHTML = '<span class="pn-ico">🗩</span> Notes';
      bar.insertBefore(notesBtn, bar.firstChild);
    }

    if (!bar.querySelector('.pn-audit-btn')) {
      var auditBtn = document.createElement('button');
      auditBtn.type = 'button';
      auditBtn.className = 'btn btn-ghost pn-audit-btn';
      auditBtn.title = 'My activity today (personal audit log)';
      auditBtn.setAttribute('aria-label', 'Open my activity log');
      auditBtn.setAttribute('data-action', 'pn-open-audit');
      auditBtn.innerHTML = '<span class="pn-ico">🕘</span> Activity';
      bar.insertBefore(auditBtn, bar.firstChild);
    }
  }

  /* ======================================================================= */
  /* EVENT WIRING                                                             */
  /* ======================================================================= */

  /* Our own controls (capture phase so we run before the app dispatcher and
     can preventDefault for affordances that aren't real ACTIONS). We do NOT
     stopImmediatePropagation; the app dispatcher still handles real verbs. */
  function ourClickHandler(e) {
    if (e.defaultPrevented) return;
    var el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) {
      // Click outside the popover closes it.
      if (document.getElementById(POP_ID) && !(e.target && e.target.closest && e.target.closest('.pn-pop'))) {
        closePopover();
      }
      return;
    }
    var action = el.getAttribute('data-action');
    var payload = el.getAttribute('data-payload') || '';

    switch (action) {
      case 'pn-copy-table':
        e.preventDefault(); copyTableById(payload); return;
      case 'pn-add-note':
        e.preventDefault(); e.stopPropagation(); openPopover(payload, el); return;
      case 'pn-save-note':
        e.preventDefault(); handleSaveNote(payload); return;
      case 'pn-delete-note':
        e.preventDefault(); handleDeleteNote(payload); return;
      case 'pn-close-pop':
        e.preventDefault(); closePopover(); return;
      case 'pn-open-notes':
        e.preventDefault(); openNotesDrawer(); return;
      case 'pn-open-audit':
        e.preventDefault(); openAuditDrawer(); return;
      case 'pn-clear-audit':
        e.preventDefault(); clearAudit(); return;
      case 'pn-jump-note':
        e.preventDefault();
        if (typeof closeDrawer === 'function') closeDrawer();
        try {
          if (typeof switchView === 'function' && payload &&
              typeof VIEWS !== 'undefined' && VIEWS && VIEWS[payload]) {
            switchView(payload);
          }
        } catch (err) { /* view not reachable */ }
        return;
      default:
        return; // not ours — let the app dispatcher handle it
    }
  }

  /* The audit recorder (separate capture listener). Logs meaningful verbs;
     never interferes with dispatch (no preventDefault, no stopPropagation). */
  function auditClickHandler(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var action = el.getAttribute('data-action');
    if (!action || AUDIT_EXCLUDE[action]) return;
    if (action.indexOf('pn-') === 0) return;     // our own affordances
    // Don't double-log the topbar Notes/Activity openers (covered by exclude),
    // and skip pure card toggles (covered above). Everything else is logged.
    logActivity(action, el);
  }

  /* Keep the popover glued to its anchor on scroll/resize (best-effort). */
  function repositionOnViewportChange() {
    var pop = document.getElementById(POP_ID);
    if (!pop) return;
    closePopover(); // simplest correct behaviour: dismiss on scroll/resize
  }

  /* ======================================================================= */
  /* STYLES (one prefixed <style>, token-driven)                              */
  /* ======================================================================= */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      /* shared icon glyph in topbar buttons / copy buttons */
      '.pn-ico{font-family:var(--mono);font-size:12px;line-height:1;}',

      /* (A) copy button — sits in the card head, pushed to the right */
      '.pn-head-flex{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}',
      '.' + COPY_CLASS + '{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;}',
      '.' + COPY_CLASS + ' .pn-ico{color:var(--accent);}',

      /* (B) annotation affordance */
      '.pn-host{position:relative;}',
      '.pn-cell-host{position:relative;}',
      '.' + NOTE_CLASS + '{display:inline-flex;align-items:center;justify-content:center;',
        'width:16px;height:16px;margin-left:6px;border-radius:4px;cursor:pointer;',
        'font-size:11px;line-height:1;opacity:0;transition:opacity .12s ease,background .12s ease;',
        'color:var(--text-2);vertical-align:middle;user-select:none;}',
      '.kpi .' + NOTE_CLASS + '{position:absolute;top:8px;right:8px;margin:0;}',
      '.kpi:hover .' + NOTE_CLASS + ',tr:hover .' + NOTE_CLASS + '{opacity:.75;}',
      '.' + NOTE_CLASS + ':hover{opacity:1 !important;background:var(--bg-3);color:var(--text-0);}',
      '.' + NOTE_CLASS + '.pn-has-note{opacity:1;color:var(--warn);}',
      /* coloured corner dot when a note exists */
      '.pn-annotated{position:relative;}',
      '.pn-annotated::after{content:"";position:absolute;top:5px;right:5px;width:7px;height:7px;',
        'border-radius:50%;background:var(--warn);box-shadow:0 0 0 2px var(--bg-1);pointer-events:none;z-index:2;}',
      'tr.pn-annotated > td:first-child::before,tr.pn-annotated > th:first-child::before{',
        'content:"";position:absolute;left:3px;top:50%;transform:translateY(-50%);',
        'width:6px;height:6px;border-radius:50%;background:var(--warn);}',
      'tr.pn-annotated > td:first-child,tr.pn-annotated > th:first-child{position:relative;}',

      /* (B) popover */
      '.pn-pop{position:fixed;z-index:7000;width:280px;max-width:92vw;',
        'background:var(--bg-1);border:1px solid var(--line-2);border-radius:10px;',
        'box-shadow:0 18px 48px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.2);',
        'font-family:var(--sans);overflow:hidden;}',
      '.pn-pop-head{display:flex;align-items:center;justify-content:space-between;',
        'padding:9px 12px;background:var(--bg-2);border-bottom:1px solid var(--line);}',
      '.pn-pop-title{font-size:12px;font-weight:600;color:var(--text-0);letter-spacing:.2px;}',
      '.pn-pop-x{background:none;border:0;color:var(--text-2);font-size:18px;line-height:1;',
        'cursor:pointer;padding:0 2px;}',
      '.pn-pop-x:hover{color:var(--text-0);}',
      '.pn-pop-ta{display:block;width:100%;box-sizing:border-box;min-height:90px;resize:vertical;',
        'background:var(--bg-3);border:0;border-bottom:1px solid var(--line);color:var(--text-0);',
        'font-family:var(--sans);font-size:13px;line-height:1.45;padding:10px 12px;outline:none;}',
      '.pn-pop-ta::placeholder{color:var(--text-3);}',
      '.pn-pop-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;',
        'padding:9px 12px;background:var(--bg-1);}',
      '.pn-pop-spacer{flex:1 1 auto;}',

      /* (B) notes drawer list */
      '.pn-note-list{display:flex;flex-direction:column;gap:10px;}',
      '.pn-note-row{background:var(--bg-2);border:1px solid var(--line);border-left:3px solid var(--warn);',
        'border-radius:8px;padding:10px 12px;}',
      '.pn-note-meta{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:5px;}',
      '.pn-note-where{font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:.6px;}',
      '.pn-note-when{font-size:11px;color:var(--text-3);}',
      '.pn-note-text{font-size:13px;line-height:1.5;color:var(--text-0);white-space:pre-wrap;word-break:break-word;}',
      '.pn-note-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:8px;}',

      /* (C) audit drawer */
      '.pn-audit-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;}',
      '.pn-audit-count{margin:0;}',
      '.pn-audit-list{display:flex;flex-direction:column;}',
      '.pn-audit-item{display:flex;align-items:flex-start;gap:12px;padding:9px 2px;',
        'border-bottom:1px solid var(--line);}',
      '.pn-audit-item:last-child{border-bottom:0;}',
      '.pn-audit-time{flex:0 0 auto;color:var(--accent);font-size:12px;padding-top:1px;min-width:42px;}',
      '.pn-audit-body{flex:1 1 auto;min-width:0;}',
      '.pn-audit-label{font-size:13px;color:var(--text-0);line-height:1.35;}',
      '.pn-audit-view{font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;}',

      /* shared empty state */
      '.pn-empty{color:var(--text-2);font-size:13px;line-height:1.6;padding:12px 4px;}',

      /* hide our injected chrome when printing (coexist with enh-print) */
      '@media print{.pn-notes-btn,.pn-audit-btn,.' + COPY_CLASS + ',.' + NOTE_CLASS +
        ',.pn-pop{display:none !important;}.pn-annotated::after{display:none !important;}}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ======================================================================= */
  /* INSTALL (top-level on load)                                              */
  /* ======================================================================= */
  function install() {
    injectStyles();

    // Re-run table + annotation enhancement after every view render, and once now.
    afterRender(function () {
      injectTopbarButtons();   // topbar persists, but cheap + idempotent
      enhanceTables();
      enhanceAnnotatables();
    });

    // Our control clicks (capture so affordance clicks beat the app dispatcher).
    document.addEventListener('click', ourClickHandler, true);
    // Audit recorder (capture; passive — never blocks the dispatcher).
    document.addEventListener('click', auditClickHandler, true);
    // Dismiss the popover when the layout shifts under it.
    window.addEventListener('scroll', repositionOnViewportChange, true);
    window.addEventListener('resize', repositionOnViewportChange);
  }

  install();
})();
