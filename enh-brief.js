/* ============================================================================
   CACAO/FP — enh-brief.js  (Enhancement #29)
   Morning Brief card (dashboard) + actionable Alerts Inbox bell (topbar).

   Self-installing, idempotent, vanilla JS in an IIFE. Uses ONLY the globals and
   hook patterns declared in ENH_CONTRACT.md / CONTRACT.md. Does not edit any
   other file, does not redefine globals, does not reassign switchView.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- Idempotency guard (whole module) -------------------------------- */
  if (window.__cacaoBriefInstalled) return;
  window.__cacaoBriefInstalled = true;

  /* ---- Constants ------------------------------------------------------- */
  var BRIEF_KEY  = 'cacao_brief_dismissed';   // value = "YYYY-MM-DD"
  var ALERTS_KEY = 'cacao_alerts_v1';         // { read:[], snoozed:{}, assigned:{} }

  /* ---- Small local helpers (do NOT shadow globals) --------------------- */
  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function isoPlusDays(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeArr(v) { return Array.isArray(v) ? v : []; }

  /* ---- Persistence (try/catch wrapped) --------------------------------- */
  function loadBriefDismissed() {
    try { return localStorage.getItem(BRIEF_KEY) || ''; } catch (e) { return ''; }
  }
  function saveBriefDismissed(val) {
    try { localStorage.setItem(BRIEF_KEY, val); } catch (e) {}
  }
  function isBriefDismissedToday() {
    return loadBriefDismissed() === todayISO();
  }

  function loadAlertState() {
    var base = { read: [], snoozed: {}, assigned: {} };
    try {
      var raw = JSON.parse(localStorage.getItem(ALERTS_KEY) || '{}');
      return {
        read: Array.isArray(raw.read) ? raw.read.slice() : [],
        snoozed: (raw.snoozed && typeof raw.snoozed === 'object') ? raw.snoozed : {},
        assigned: (raw.assigned && typeof raw.assigned === 'object') ? raw.assigned : {}
      };
    } catch (e) { return base; }
  }
  function saveAlertState(st) {
    try { localStorage.setItem(ALERTS_KEY, JSON.stringify(st)); } catch (e) {}
  }

  /* ---- Alert state predicates ------------------------------------------ */
  function isRead(st, i) { return st.read.indexOf(i) !== -1; }
  function isSnoozed(st, i) {
    var until = st.snoozed[i];
    if (!until) return false;
    // hidden / muted while snooze date is still in the future (>= today)
    return until >= todayISO();
  }
  function unreadCount() {
    var st = loadAlertState();
    var alerts = safeArr(DATA && DATA.alerts);
    var n = 0;
    for (var i = 0; i < alerts.length; i++) {
      if (!isRead(st, i) && !isSnoozed(st, i)) n++;
    }
    return n;
  }

  /* ---- Distinct users for the Assign select ---------------------------- */
  function assignableUsers() {
    var seen = {};
    var out = [];
    safeArr(DATA && DATA.activity).forEach(function (a) {
      var u = a && a.user;
      if (u && u !== 'Auto' && !seen[u]) { seen[u] = 1; out.push(u); }
    });
    if (!out.length) out = ['You'];
    return out;
  }

  /* ====================================================================== */
  /*  PART A — MORNING BRIEF CARD                                            */
  /* ====================================================================== */

  function tickerBySym(sym) {
    return safeArr(DATA && DATA.ticker).filter(function (t) { return t.sym === sym; })[0];
  }

  function marketChip(t) {
    if (!t) return '';
    var cls = (typeof signClass === 'function') ? signClass(t.chgPct) : (t.chgPct >= 0 ? 'pos' : 'neg');
    var chg = (typeof fmtSignedPct === 'function') ? fmtSignedPct(t.chgPct) : (t.chgPct + '%');
    var px;
    if (t.sym === 'EUR/USD') px = (typeof fmtNum === 'function') ? fmtNum(t.px, 4) : String(t.px);
    else px = (typeof fmtInt === 'function') ? fmtInt(t.px) : String(t.px);
    var unit = t.unit ? ' <span class="mb-unit">' + esc(t.unit) + '</span>' : '';
    return '<span class="mb-mkt">' +
      '<span class="mb-mkt-sym">' + esc(t.sym) + '</span>' +
      '<span class="mb-mkt-px mono">' + px + unit + '</span>' +
      '<span class="mb-mkt-chg ' + cls + '">' + chg + '</span>' +
      '</span>';
  }

  // One actionable brief line. `view` is the destination passed to mb-go.
  function briefLine(icon, label, valueHtml, view) {
    return '<div class="mb-line" data-action="mb-go" data-payload="' + esc(view) + '" ' +
      'role="button" tabindex="0" title="Open ' + esc(view) + '">' +
      '<span class="mb-ico">' + icon + '</span>' +
      '<span class="mb-line-label">' + esc(label) + '</span>' +
      '<span class="mb-line-val">' + valueHtml + '</span>' +
      '<span class="mb-go-arrow">›</span>' +
      '</div>';
  }

  function composeBriefBody() {
    var lines = '';

    /* -- Overnight market -- */
    var market = '' + marketChip(tickerBySym('CC·NY')) +
      marketChip(tickerBySym('C·LDN')) +
      marketChip(tickerBySym('EUR/USD'));
    lines += briefLine('◧', 'Overnight market', '<span class="mb-mkt-row">' + market + '</span>', 'market');

    /* -- Pending margin calls -- */
    var pending = safeArr(DATA && DATA.marginCalls).filter(function (m) { return m.status === 'PENDING'; });
    var totalEur = pending.reduce(function (s, m) { return s + (Number(m.amountK) || 0) * 1000; }, 0);
    if (pending.length) {
      var mcVal = '<span class="mb-strong neg">' + pending.length + ' pending</span> · ' +
        '<span class="mono">' + (typeof fmtEurM === 'function' ? fmtEurM(totalEur) : '€' + totalEur) + '</span> to settle';
      lines += briefLine('€', 'Margin calls', mcVal, 'cashflow');
    } else {
      lines += briefLine('€', 'Margin calls', '<span class="mb-strong pos">all settled</span>', 'cashflow');
    }

    /* -- Unpriced PTBF needing a fix -- */
    var unpriced = safeArr(DATA && DATA.contracts).filter(function (c) { return c.status === 'UNPRICED'; });
    if (unpriced.length) {
      var ids = unpriced.map(function (c) { return c.id; });
      // nearest execMonth by calendar order of the contract set
      var nearest = nearestExecMonth(unpriced);
      var idLabel = ids.slice(0, 3).join(', ') + (ids.length > 3 ? ' +' + (ids.length - 3) : '');
      var upVal = '<span class="mb-strong warn">' + unpriced.length + ' unpriced</span> · ' +
        '<span class="mono">' + esc(idLabel) + '</span>' +
        (nearest ? ' · nearest <span class="mono">' + esc(nearest) + '</span>' : '');
      lines += briefLine('◔', 'Unpriced PTBF', upVal, 'contracts');
    }

    /* -- Failed hedge designation -- */
    var failed = [];
    if (DATA && DATA.hedgeEffectiveness && Array.isArray(DATA.hedgeEffectiveness.designations)) {
      failed = DATA.hedgeEffectiveness.designations.filter(function (d) { return d.status === 'FAILED'; });
    }
    if (failed.length) {
      var f = failed[0];
      var rest = failed.length > 1 ? ' +' + (failed.length - 1) : '';
      var fVal = '<span class="mb-strong neg">' + esc(f.id) + ' ' + (Number(f.ratio) || 0) + '%</span>' + rest +
        ' · designation fail';
      lines += briefLine('⚠', 'Hedge effectiveness', fVal, 'effectiveness');
    }

    /* -- Next close task due -- */
    var nextTask = safeArr(DATA && DATA.closeChecklist).filter(function (t) { return t.status !== 'DONE'; })[0];
    if (nextTask) {
      var ctVal = '<span class="mb-strong">' + esc(nextTask.task) + '</span> · due ' +
        '<span class="mono">' + esc(nextTask.due) + '</span>';
      lines += briefLine('☑', 'Next close task', ctVal, 'close');
    }

    return lines;
  }

  // Order execMonth tokens (e.g. SEP26) chronologically and return the earliest present.
  function nearestExecMonth(rows) {
    var order = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
    function key(em) {
      if (!em || em.length < 5) return Infinity;
      var mo = order[em.slice(0, 3).toUpperCase()] || 99;
      var yr = parseInt(em.slice(3), 10);
      if (isNaN(yr)) yr = 99;
      return yr * 100 + mo;
    }
    var best = null, bestK = Infinity;
    rows.forEach(function (r) {
      var k = key(r.execMonth);
      if (k < bestK) { bestK = k; best = r.execMonth; }
    });
    return best;
  }

  function briefCardHtml() {
    if (isBriefDismissedToday()) return '';
    var d = new Date();
    var nice = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    return '<div class="card mb-brief">' +
      '<div class="card-head mb-brief-head">' +
      '<div>' +
      '<div class="card-title mb-brief-title">Morning Brief</div>' +
      '<div class="card-sub mb-brief-sub">' + esc(nice) + ' · what needs you today</div>' +
      '</div>' +
      '<button class="mb-dismiss" data-action="mb-dismiss-brief" title="Dismiss for today" aria-label="Dismiss brief">✕</button>' +
      '</div>' +
      '<div class="card-body mb-brief-body">' + composeBriefBody() + '</div>' +
      '</div>';
  }

  function installBriefCard() {
    if (typeof VIEWS === 'undefined' || !VIEWS.dashboard || typeof VIEWS.dashboard.render !== 'function') return;
    if (VIEWS.dashboard.render.__mbWrapped) return;

    var orig = VIEWS.dashboard.render.bind(VIEWS.dashboard);
    var wrapped = function () {
      var base = orig();
      // Prepend the brief ABOVE existing dashboard content.
      return briefCardHtml() + base;
    };
    wrapped.__mbWrapped = true;
    VIEWS.dashboard.render = wrapped;

    // Repaint so the brief appears immediately if we're on the dashboard.
    if (typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'dashboard' && typeof switchView === 'function') {
      switchView('dashboard');
    }
  }

  /* ---- Brief ACTIONS --------------------------------------------------- */
  function registerBriefActions() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['mb-go'] = function (payload) {
      if (payload && typeof switchView === 'function') switchView(payload);
    };

    ACTIONS['mb-dismiss-brief'] = function () {
      saveBriefDismissed(todayISO());
      if (typeof switchView === 'function' && typeof CURRENT_VIEW !== 'undefined' && CURRENT_VIEW === 'dashboard') {
        switchView('dashboard'); // re-render to drop the card
      }
      if (typeof toast === 'function') {
        toast({ type: 'info', title: 'Morning Brief dismissed', body: 'It will return tomorrow.' });
      }
    };

    // Keyboard activation for the focusable brief lines.
    if (!window.__cacaoBriefKeyBound) {
      window.__cacaoBriefKeyBound = true;
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var el = e.target && e.target.closest ? e.target.closest('.mb-line[data-action="mb-go"]') : null;
        if (!el) return;
        e.preventDefault();
        var pl = el.getAttribute('data-payload');
        if (pl && typeof switchView === 'function') switchView(pl);
      });
    }
  }

  /* ====================================================================== */
  /*  PART B — ALERTS INBOX BELL                                            */
  /* ====================================================================== */

  function sevClass(sev) {
    if (sev === 'high') return 'high';
    if (sev === 'med') return 'med';
    return 'low';
  }

  function updateBellBadge() {
    var badge = document.querySelector('.mb-bell .mb-badge');
    if (!badge) return;
    var n = unreadCount();
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.style.display = n > 0 ? '' : 'none';
  }

  function injectBell() {
    var host = document.querySelector('.topbar-actions');
    if (!host) return;
    if (host.querySelector('.mb-bell')) return; // already injected

    var btn = document.createElement('button');
    btn.className = 'btn btn-ghost mb-bell';
    btn.setAttribute('data-action', 'mb-open-inbox');
    btn.setAttribute('title', 'Alerts inbox');
    btn.setAttribute('aria-label', 'Alerts inbox');
    btn.innerHTML = '<span class="mb-bell-ico" aria-hidden="true">🔔</span>' +
      '<span class="mb-badge">0</span>';
    host.insertBefore(btn, host.firstChild); // prepend
    updateBellBadge();
  }

  /* ---- Inbox drawer body ------------------------------------------------ */
  function alertRowHtml(alert, i, st) {
    var assigned = st.assigned[i] || '';
    var snoozedUntil = st.snoozed[i] || '';
    var read = isRead(st, i);
    var snoozed = isSnoozed(st, i);

    var users = assignableUsers();
    var opts = '<option value="">Assign…</option>' + users.map(function (u) {
      return '<option value="' + esc(u) + '"' + (u === assigned ? ' selected' : '') + '>' + esc(u) + '</option>';
    }).join('');

    var cls = 'mb-alert' + (read ? ' mb-read' : '') + (snoozed ? ' mb-snoozed' : '');
    var snoozeNote = (snoozed && snoozedUntil)
      ? '<span class="mb-snooze-note">snoozed → ' + esc(snoozedUntil) + '</span>' : '';
    var assignNote = assigned ? '<span class="mb-assign-note">→ ' + esc(assigned) + '</span>' : '';

    return '<div class="' + cls + '" data-mb-alert="' + i + '">' +
      '<span class="mb-sev ' + sevClass(alert.sev) + '" title="' + esc(alert.sev) + '"></span>' +
      '<div class="mb-alert-main">' +
        '<div class="mb-alert-top">' +
          '<span class="mb-alert-title">' + esc(alert.title) + '</span>' +
          '<span class="mb-alert-time mono">' + esc(alert.time) + '</span>' +
        '</div>' +
        '<div class="mb-alert-body">' + esc(alert.body) + '</div>' +
        '<div class="mb-alert-meta">' + assignNote + snoozeNote + '</div>' +
        '<div class="mb-alert-ctl">' +
          '<button class="mb-ctl" data-action="mb-alert-read" data-payload="' + i + '">' +
            (read ? 'Mark unread' : 'Mark read') + '</button>' +
          '<button class="mb-ctl" data-action="mb-alert-snooze" data-payload="' + i + ':1">Snooze 1d</button>' +
          '<button class="mb-ctl" data-action="mb-alert-snooze" data-payload="' + i + ':3">Snooze 3d</button>' +
          (snoozed ? '<button class="mb-ctl" data-action="mb-alert-snooze" data-payload="' + i + ':0">Wake</button>' : '') +
          '<select class="mb-assign" data-mb-assign="' + i + '" ' +
            'onchange="window.__cacaoBrief.assign(' + i + ', this.value)">' + opts + '</select>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function inboxBodyHtml() {
    var st = loadAlertState();
    var alerts = safeArr(DATA && DATA.alerts);

    // Active (not snoozed) first, then snoozed; keep original index for state keys.
    var active = [], snoozedRows = [];
    alerts.forEach(function (a, i) {
      if (isSnoozed(st, i)) snoozedRows.push([a, i]); else active.push([a, i]);
    });

    var body = '';
    if (!active.length && !snoozedRows.length) {
      body += '<div class="mb-empty">No alerts.</div>';
    }
    active.forEach(function (pair) { body += alertRowHtml(pair[0], pair[1], st); });
    if (snoozedRows.length) {
      body += '<div class="mb-snooze-divider">Snoozed (' + snoozedRows.length + ')</div>';
      snoozedRows.forEach(function (pair) { body += alertRowHtml(pair[0], pair[1], st); });
    }
    return '<div class="mb-inbox">' + body + '</div>';
  }

  function openInbox() {
    if (typeof openDrawer !== 'function') return;
    var n = unreadCount();
    openDrawer({
      title: 'Alerts Inbox',
      sub: n + ' unread',
      body: inboxBodyHtml()
    });
  }

  // Refresh the drawer body in place (without re-opening) + bell badge.
  function refreshInbox() {
    var bodyEl = document.querySelector('#drawer-root .drawer-body');
    if (bodyEl) bodyEl.innerHTML = inboxBodyHtml();
    var subEl = document.querySelector('#drawer-root .drawer-sub');
    if (subEl) subEl.textContent = unreadCount() + ' unread';
    updateBellBadge();
  }

  /* ---- Alert mutation handlers ----------------------------------------- */
  function toggleRead(i) {
    var st = loadAlertState();
    var idx = st.read.indexOf(i);
    if (idx === -1) st.read.push(i); else st.read.splice(idx, 1);
    saveAlertState(st);
    refreshInbox();
  }
  function snooze(i, days) {
    var st = loadAlertState();
    if (days <= 0) {
      delete st.snoozed[i];           // wake
    } else {
      st.snoozed[i] = isoPlusDays(days);
    }
    saveAlertState(st);
    refreshInbox();
  }
  function assign(i, user) {
    var st = loadAlertState();
    if (user) st.assigned[i] = user; else delete st.assigned[i];
    saveAlertState(st);
    refreshInbox();
  }

  // Exposed for inline onchange on the <select> (assign).
  window.__cacaoBrief = { assign: assign };

  function registerInboxActions() {
    if (typeof ACTIONS === 'undefined') return;

    ACTIONS['mb-open-inbox'] = function () { openInbox(); };

    ACTIONS['mb-alert-read'] = function (payload) {
      var i = parseInt(payload, 10);
      if (!isNaN(i)) toggleRead(i);
    };

    ACTIONS['mb-alert-snooze'] = function (payload) {
      // payload "<index>:<days>"
      var parts = String(payload || '').split(':');
      var i = parseInt(parts[0], 10);
      var days = parseInt(parts[1], 10);
      if (!isNaN(i) && !isNaN(days)) snooze(i, days);
    };

    ACTIONS['mb-alert-assign'] = function (payload) {
      // payload "<index>:<user>" (kept for parity; select uses inline onchange)
      var raw = String(payload || '');
      var sep = raw.indexOf(':');
      if (sep === -1) return;
      var i = parseInt(raw.slice(0, sep), 10);
      var user = raw.slice(sep + 1);
      if (!isNaN(i)) assign(i, user);
    };
  }

  /* ====================================================================== */
  /*  STYLES (single <style>, mb- prefixed, token-based)                    */
  /* ====================================================================== */

  function injectStyles() {
    if (document.getElementById('mb-brief-styles')) return;
    var css = [
      /* ---- Morning Brief card ---- */
      '.mb-brief{border-left:3px solid var(--accent);}',
      '.mb-brief-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}',
      '.mb-brief-title{color:var(--text-0);}',
      '.mb-brief-sub{color:var(--text-2);}',
      '.mb-dismiss{background:transparent;border:1px solid var(--line-2);color:var(--text-2);',
        'width:24px;height:24px;border-radius:6px;cursor:pointer;line-height:1;font-size:12px;',
        'display:flex;align-items:center;justify-content:center;flex:0 0 auto;transition:all .12s ease;}',
      '.mb-dismiss:hover{background:var(--bg-3);color:var(--text-0);border-color:var(--line-3);}',
      '.mb-brief-body{display:flex;flex-direction:column;gap:2px;padding-top:4px;}',
      '.mb-line{display:flex;align-items:center;gap:10px;padding:9px 8px;border-radius:8px;cursor:pointer;',
        'border:1px solid transparent;transition:background .12s ease,border-color .12s ease;}',
      '.mb-line+.mb-line{border-top:1px solid var(--line);}',
      '.mb-line:hover{background:var(--bg-2);border-color:var(--line-2);}',
      '.mb-line:focus-visible{outline:none;border-color:var(--accent);background:var(--bg-2);}',
      '.mb-ico{flex:0 0 auto;width:22px;text-align:center;color:var(--accent);font-size:13px;}',
      '.mb-line-label{flex:0 0 auto;min-width:132px;color:var(--text-2);font-family:var(--sans);',
        'font-size:12px;text-transform:uppercase;letter-spacing:.04em;}',
      '.mb-line-val{flex:1 1 auto;color:var(--text-1);font-family:var(--sans);font-size:13px;}',
      '.mb-go-arrow{flex:0 0 auto;color:var(--text-3);font-size:16px;transition:color .12s ease,transform .12s ease;}',
      '.mb-line:hover .mb-go-arrow{color:var(--accent);transform:translateX(2px);}',
      '.mb-strong{font-weight:600;color:var(--text-0);}',
      '.mb-line-val .mono,.mb-mkt-px{font-family:var(--mono);}',
      '.mb-line-val .pos,.mb-strong.pos{color:var(--pos);}',
      '.mb-line-val .neg,.mb-strong.neg{color:var(--neg);}',
      '.mb-line-val .warn,.mb-strong.warn{color:var(--warn);}',
      /* market chips inside the first line */
      '.mb-mkt-row{display:inline-flex;flex-wrap:wrap;gap:14px;align-items:baseline;}',
      '.mb-mkt{display:inline-flex;align-items:baseline;gap:6px;}',
      '.mb-mkt-sym{color:var(--text-2);font-size:11px;font-family:var(--sans);letter-spacing:.03em;}',
      '.mb-mkt-px{color:var(--text-0);font-size:13px;}',
      '.mb-unit{color:var(--text-3);font-size:10px;}',
      '.mb-mkt-chg{font-family:var(--mono);font-size:12px;}',
      '.mb-mkt-chg.pos{color:var(--pos);} .mb-mkt-chg.neg{color:var(--neg);}',

      /* ---- Bell ---- */
      '.mb-bell{position:relative;padding-left:10px;padding-right:10px;}',
      '.mb-bell-ico{font-size:14px;line-height:1;}',
      '.mb-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;',
        'border-radius:9px;background:var(--neg);color:#fff;font-family:var(--mono);font-size:10px;',
        'font-weight:600;line-height:16px;text-align:center;box-shadow:0 0 0 2px var(--bg-0);}',

      /* ---- Inbox (drawer body) ---- */
      '.mb-inbox{display:flex;flex-direction:column;gap:8px;}',
      '.mb-empty{color:var(--text-2);font-family:var(--sans);padding:18px 4px;text-align:center;}',
      '.mb-alert{display:flex;gap:10px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;',
        'background:var(--bg-2);transition:opacity .12s ease,border-color .12s ease;}',
      '.mb-alert:hover{border-color:var(--line-2);}',
      '.mb-alert.mb-read{opacity:.55;}',
      '.mb-alert.mb-snoozed{opacity:.5;}',
      '.mb-sev{flex:0 0 auto;width:9px;height:9px;border-radius:50%;margin-top:5px;}',
      '.mb-sev.high{background:var(--neg);box-shadow:0 0 6px var(--neg-dim);}',
      '.mb-sev.med{background:var(--warn);}',
      '.mb-sev.low{background:var(--info);}',
      '.mb-alert-main{flex:1 1 auto;min-width:0;}',
      '.mb-alert-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}',
      '.mb-alert-title{color:var(--text-0);font-family:var(--sans);font-size:13px;font-weight:600;}',
      '.mb-alert-time{color:var(--text-3);font-size:11px;flex:0 0 auto;}',
      '.mb-alert-body{color:var(--text-2);font-family:var(--sans);font-size:12px;margin-top:3px;line-height:1.4;}',
      '.mb-alert-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:5px;min-height:0;}',
      '.mb-assign-note{color:var(--accent);font-family:var(--mono);font-size:11px;}',
      '.mb-snooze-note{color:var(--warn);font-family:var(--mono);font-size:11px;}',
      '.mb-alert-ctl{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;}',
      '.mb-ctl{background:var(--bg-3);border:1px solid var(--line-2);color:var(--text-1);',
        'font-family:var(--sans);font-size:11px;padding:4px 9px;border-radius:6px;cursor:pointer;',
        'transition:all .12s ease;}',
      '.mb-ctl:hover{background:var(--bg-4);border-color:var(--line-3);color:var(--text-0);}',
      '.mb-assign{background:var(--bg-3);border:1px solid var(--line-2);color:var(--text-1);',
        'font-family:var(--sans);font-size:11px;padding:3px 6px;border-radius:6px;cursor:pointer;max-width:140px;}',
      '.mb-assign:focus{outline:none;border-color:var(--accent);}',
      '.mb-snooze-divider{color:var(--text-3);font-family:var(--sans);font-size:11px;text-transform:uppercase;',
        'letter-spacing:.05em;margin:8px 0 2px;padding-top:6px;border-top:1px solid var(--line);}',
      '@media (max-width:920px){.mb-line-label{min-width:0;}}'
    ].join('');

    var style = document.createElement('style');
    style.id = 'mb-brief-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ====================================================================== */
  /*  INSTALL                                                               */
  /* ====================================================================== */

  function install() {
    try { injectStyles(); } catch (e) {}
    try { registerBriefActions(); } catch (e) {}
    try { registerInboxActions(); } catch (e) {}
    try { injectBell(); } catch (e) {}
    try { installBriefCard(); } catch (e) {}
  }

  // Run now (scripts load after DOM is ready, per CONTRACT boot order).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
