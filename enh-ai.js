/* ============================================================================
   CACAO/FP — enh-ai.js  (enhancement #24 + #25)
   ----------------------------------------------------------------------------
   A self-contained, BRING-YOUR-OWN-KEY AI layer. This module NEVER hardcodes
   an API key. The USER pastes their own key into a ⚙ Settings panel; it is
   stored only in their own localStorage (cacao_ai_cfg_v1). All AI features
   degrade gracefully to a clear "add your key" message when no key is set.

     #24  Real LLM commentary  — an "✦ AI narrative" button in the PPV
          commentary card replaces the templated narrative with a model-
          authored executive narrative grounded in live DATA. On error the
          existing templated commentary is left intact.
     #25  Ask the Desk        — an "✦ Ask" topbar launcher opens a drawer with
          a Q&A transcript. Questions are answered against a compact, grounded
          serialization of the live DATA tables. If the model returns a small
          {view,filters} directive, the module can navigate/cross-filter.

   OBEYS ENH_CONTRACT.md / ENH_CONTRACT2.md / CONTRACT.md:
     • Plain JS IIFE; installs at top level on load. Edits no other file.
     • ONE module-prefixed <style> (ai-*) using design tokens only.
     • Idempotent (window.__enhAiInstalled guard).
     • localStorage cacao_ prefix, all in try/catch. The key is never logged.
     • LEXICAL-CONST TRAP: VIEWS/ACTIONS/DATA/FILTERS/CURRENT_VIEW are bare
       const/let — referenced bare behind typeof guards, NEVER via window.*.
     • switchView/toast/modal/closeModal/openDrawer/closeDrawer are called
       bare (never reassigned). To inject into a rendered view we OBSERVE the
       DOM (#canvas) with a MutationObserver (afterRender), not switchView.
     • Additive document keydown only; respects e.defaultPrevented; never
       stopImmediatePropagation globally.
   ========================================================================== */

(function () {
  'use strict';

  /* ---- idempotency guard ----------------------------------------------- */
  if (typeof window !== 'undefined' && window.__enhAiInstalled) return;
  if (typeof window !== 'undefined') window.__enhAiInstalled = true;

  /* ---- constants ------------------------------------------------------- */
  var CFG_KEY      = 'cacao_ai_cfg_v1';
  var STYLE_ID     = 'ai-style';
  var SETTINGS_BTN = 'ai-settings-btn';
  var ASK_BTN      = 'ai-ask-btn';
  var NARRATIVE_BTN= 'ai-narrative-btn';

  var PROVIDERS = {
    openai: {
      label: 'OpenAI',
      defaultModel: 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1/chat/completions',
    },
    anthropic: {
      label: 'Anthropic',
      defaultModel: 'claude-3-5-haiku-latest',
      endpoint: 'https://api.anthropic.com/v1/messages',
    },
  };

  var NO_KEY_MSG = 'Add your API key in ⚙ Settings to enable AI.';
  var MAX_TOKENS = 900;

  /* In-memory Ask-the-Desk transcript (session-only, never persisted). */
  var transcript = []; // [{ role:'user'|'assistant'|'error', text }]
  var asking = false;  // request in flight (drawer)

  /* =========================================================================
     SAFE GLOBAL ACCESSORS — the const/let lexical-trap. Reference bare names
     behind typeof guards; never touch window.VIEWS/ACTIONS/DATA/FILTERS.
     ======================================================================= */
  function getDATA()    { try { return (typeof DATA    !== 'undefined') ? DATA    : null; } catch (e) { return null; } }
  function getFILTERS() { try { return (typeof FILTERS !== 'undefined') ? FILTERS : null; } catch (e) { return null; } }
  function getVIEWS()   { try { return (typeof VIEWS   !== 'undefined') ? VIEWS   : null; } catch (e) { return null; } }
  function getACTIONS() { try { return (typeof ACTIONS !== 'undefined') ? ACTIONS : null; } catch (e) { return null; } }
  function getCurrentView() { try { return (typeof CURRENT_VIEW !== 'undefined') ? CURRENT_VIEW : null; } catch (e) { return null; } }

  function safeToast(opts) {
    try { if (typeof toast === 'function') toast(opts); } catch (e) { /* never throw from a toast */ }
  }
  function safeCloseModal() {
    try { if (typeof closeModal === 'function') closeModal(); } catch (e) { /* ignore */ }
  }

  /* Local HTML escape (don't depend on actions.js internals). */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* =========================================================================
     CONFIG PERSISTENCE  (cacao_ai_cfg_v1 = {provider, model, key})
     ======================================================================= */
  function loadCfg() {
    var fallback = { provider: 'openai', model: PROVIDERS.openai.defaultModel, key: '' };
    try {
      var raw = localStorage.getItem(CFG_KEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw) || {};
      var provider = PROVIDERS[parsed.provider] ? parsed.provider : 'openai';
      return {
        provider: provider,
        model: (typeof parsed.model === 'string' && parsed.model.trim())
          ? parsed.model.trim()
          : PROVIDERS[provider].defaultModel,
        key: (typeof parsed.key === 'string') ? parsed.key : '',
      };
    } catch (e) {
      return fallback;
    }
  }

  function saveCfg(cfg) {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify({
        provider: cfg.provider,
        model: cfg.model,
        key: cfg.key,
      }));
    } catch (e) { /* storage unavailable / quota — non-fatal */ }
  }

  function clearKey() {
    var cfg = loadCfg();
    cfg.key = '';
    saveCfg(cfg);
  }

  function hasKey() {
    var cfg = loadCfg();
    return !!(cfg.key && String(cfg.key).trim());
  }

  /* Masked status string. NEVER reveals or logs the key. */
  function keyStatusLabel() {
    return hasKey() ? 'key •••• set' : 'no key';
  }

  /* =========================================================================
     FETCH WRAPPER  —  callLLM(systemPrompt, userPrompt) -> Promise<string>
     Throws a friendly Error on any failure (no key, network, API error).
     ======================================================================= */
  function callLLM(systemPrompt, userPrompt) {
    var cfg = loadCfg();
    if (!cfg.key || !String(cfg.key).trim()) {
      return Promise.reject(new Error(NO_KEY_MSG));
    }
    var provider = PROVIDERS[cfg.provider] ? cfg.provider : 'openai';
    var model = (cfg.model && cfg.model.trim()) ? cfg.model.trim() : PROVIDERS[provider].defaultModel;

    if (provider === 'anthropic') {
      return callAnthropic(cfg.key.trim(), model, systemPrompt, userPrompt);
    }
    return callOpenAI(cfg.key.trim(), model, systemPrompt, userPrompt);
  }

  function callOpenAI(key, model, systemPrompt, userPrompt) {
    var body = {
      model: model,
      max_tokens: MAX_TOKENS,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    return fetch(PROVIDERS.openai.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      return parseJsonOrThrow(res).then(function (data) {
        if (!res.ok) throw friendlyApiError(res.status, data);
        var text = data && data.choices && data.choices[0] &&
          data.choices[0].message && data.choices[0].message.content;
        if (!text || !String(text).trim()) {
          throw new Error('The model returned an empty response. Try again.');
        }
        return String(text).trim();
      });
    }).catch(rethrowNetwork);
  }

  function callAnthropic(key, model, systemPrompt, userPrompt) {
    var body = {
      model: model,
      max_tokens: MAX_TOKENS,
      temperature: 0.4,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    };
    return fetch(PROVIDERS.anthropic.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      return parseJsonOrThrow(res).then(function (data) {
        if (!res.ok) throw friendlyApiError(res.status, data);
        var text = '';
        if (data && data.content && data.content.length) {
          for (var i = 0; i < data.content.length; i++) {
            if (data.content[i] && data.content[i].type === 'text' && data.content[i].text) {
              text += data.content[i].text;
            }
          }
        }
        if (!text || !String(text).trim()) {
          throw new Error('The model returned an empty response. Try again.');
        }
        return String(text).trim();
      });
    }).catch(rethrowNetwork);
  }

  function parseJsonOrThrow(res) {
    return res.text().then(function (raw) {
      if (!raw) return {};
      try { return JSON.parse(raw); } catch (e) { return { __raw: raw }; }
    });
  }

  function friendlyApiError(status, data) {
    var apiMsg = '';
    try {
      if (data && data.error) {
        apiMsg = (typeof data.error === 'string') ? data.error : (data.error.message || '');
      }
    } catch (e) { /* ignore */ }
    if (status === 401 || status === 403) {
      return new Error('Your API key was rejected (' + status + '). Check it in ⚙ Settings.');
    }
    if (status === 429) {
      return new Error('Rate limit / quota reached (429). Try again shortly.');
    }
    if (status >= 500) {
      return new Error('The AI provider had a server error (' + status + '). Try again later.');
    }
    return new Error('AI request failed (' + status + ')' + (apiMsg ? ': ' + apiMsg : '') + '.');
  }

  function rethrowNetwork(err) {
    // Already a friendly Error from above — pass through.
    if (err && err.__cacaoFriendly) throw err;
    if (err && err.message && /Add your API key|API key was rejected|Rate limit|server error|request failed|empty response/i.test(err.message)) {
      throw err;
    }
    // Genuine network / CORS / offline failure.
    var e = new Error('Could not reach the AI provider (network or CORS). Check your connection.');
    e.__cacaoFriendly = true;
    throw e;
  }

  /* =========================================================================
     LIVE-DATA GROUNDING  — compact, deterministic serializations of DATA so
     the model answers from the terminal's real numbers, not hallucination.
     ======================================================================= */

  function r2(n) { return Math.round(n * 100) / 100; }

  /* Computed PPV variances per SKU (var €/t = act - std; total = var*mt). */
  function ppvComputed() {
    var d = getDATA();
    var rows = (d && d.ppvDetail) || [];
    return rows.map(function (r) {
      var varT = r.actEur - r.stdEur;
      var totalEur = varT * r.mt;
      return {
        sku: r.sku, desc: r.desc, mt: r.mt,
        stdEur: r.stdEur, actEur: r.actEur,
        varPerT: varT, totalVarEur: Math.round(totalEur),
        fxImpact: r.fxImpact,
      };
    });
  }

  function ppvTotals() {
    var rows = ppvComputed();
    var total = 0;
    rows.forEach(function (r) { total += r.totalVarEur; });
    var sorted = rows.slice().sort(function (a, b) { return b.totalVarEur - a.totalVarEur; });
    return {
      totalVarEur: Math.round(total),
      adverse: sorted.filter(function (r) { return r.totalVarEur > 0; }).slice(0, 3),
      favorable: sorted.filter(function (r) { return r.totalVarEur < 0; }).slice(-3).reverse(),
    };
  }

  function forecastVsBudget() {
    var d = getDATA();
    var f = (d && d.forecast) || {};
    var fc = f.forecast || [], bu = f.budget || [];
    var sf = 0, sb = 0;
    for (var i = 0; i < fc.length; i++) {
      if (typeof fc[i] === 'number') sf += fc[i];
      if (typeof bu[i] === 'number') sb += bu[i];
    }
    return { forecastTotalM: r2(sf), budgetTotalM: r2(sb), deltaM: r2(sf - sb) };
  }

  function failedHedge() {
    var d = getDATA();
    var hedges = (d && d.hedges) || [];
    var failed = hedges.filter(function (h) { return String(h.status).toUpperCase() === 'FAILED'; });
    var des = (d && d.hedgeEffectiveness && d.hedgeEffectiveness.designations) || [];
    var failedDes = des.filter(function (x) { return String(x.status).toUpperCase() === 'FAILED'; });
    return { hedges: failed, designations: failedDes };
  }

  /* Structured context object for the PPV narrative (#24). */
  function buildCommentaryContext() {
    var d = getDATA();
    var t = ppvTotals();
    var fvb = forecastVsBudget();
    var fh = failedHedge();
    return {
      asOf: '2026-06-19',
      currency: 'EUR',
      kpis: (d && d.kpis) || null,
      ppvBySku: ppvComputed(),
      ppvTotal: t,
      costBridge: (d && d.costBridge) || [],
      forecastVsBudget: fvb,
      failedHedge: fh,
      hedgeCoverageTargetPct: 80,
    };
  }

  function commentaryPrompt() {
    var ctx = buildCommentaryContext();
    var lines = [];
    lines.push('You are a senior cost accountant / FP&A lead at a cocoa processor.');
    lines.push('Write a concise EXECUTIVE COMMENTARY (3 short paragraphs) on the month-end');
    lines.push('purchase price variance (PPV) position for a CFO audience. Use ONLY the figures');
    lines.push('provided below — do not invent numbers. Be specific: cite the total adverse PPV,');
    lines.push('the top adverse and favorable SKUs, the cost-bridge drivers, forecast-vs-budget,');
    lines.push('and the failed IFRS 9 hedge designation and its accounting consequence.');
    lines.push('Tone: factual, board-ready, no fluff. Output plain prose, no markdown headers.');
    lines.push('');
    lines.push('=== LIVE DATA (JSON) ===');
    lines.push(safeStringify(ctx, 4000));
    return lines.join('\n');
  }

  /* Compact schema + relevant tables for Ask-the-Desk (#25). */
  function buildAskContext() {
    var d = getDATA();
    if (!d) return { error: 'no data' };
    var ctx = {
      asOf: '2026-06-19',
      kpis: d.kpis || null,
      contracts: trimRows(d.contracts, ['id', 'origin', 'supplier', 'basis', 'mt', 'execMonth', 'price', 'diff', 'status', 'hedgePct']),
      ppvDetail: ppvComputed(),
      ppvTotal: ppvTotals(),
      hedges: trimRows(d.hedges, ['id', 'book', 'side', 'lots', 'expiry', 'avgPx', 'mtmEur', 'status']),
      eudrBySupplier: trimRows(d.eudr && d.eudr.bySupplier, ['supplier', 'origin', 'geoPct', 'dds', 'cert', 'risk']),
      forecastVsBudget: forecastVsBudget(),
      originSpend: trimRows(d.originSpend, ['code', 'name', 'spendM', 'mt', 'certPct']),
    };
    return ctx;
  }

  function trimRows(rows, keys) {
    if (!rows || !rows.length) return [];
    return rows.map(function (r) {
      var o = {};
      keys.forEach(function (k) { if (r[k] !== undefined) o[k] = r[k]; });
      return o;
    });
  }

  function askSystemPrompt() {
    var views = getVIEWS();
    var viewNames = views ? Object.keys(views) : [];
    return [
      'You are "Ask the Desk", the embedded analyst for a cocoa procurement FP&A terminal (CACAO/FP).',
      'Answer the user STRICTLY from the JSON context provided in the user message — never invent figures.',
      'If the answer is not in the data, say so plainly. Keep answers tight (a few sentences or a short list).',
      'Amounts are in EUR unless stated; PPV variance per tonne = actual − standard (positive = adverse).',
      '',
      'Optionally, if the user clearly asks to navigate or filter the terminal, you MAY append on the',
      'FINAL line a single JSON directive of the form:',
      '@@NAV {"view":"<one of: ' + viewNames.join(', ') + '>","filters":{"origin":"CIV"}}',
      'Valid filter keys: period, origin, supplier, sku, currency, version. Origin codes: CIV, GHA, ECU, CMR, NGA, DOM.',
      'Only emit @@NAV when navigation/filtering is genuinely requested. Otherwise omit it entirely.',
    ].join('\n');
  }

  function askUserPrompt(question) {
    return [
      'QUESTION: ' + question,
      '',
      '=== TERMINAL DATA (JSON) ===',
      safeStringify(buildAskContext(), 6000),
    ].join('\n');
  }

  function safeStringify(obj, maxLen) {
    var s;
    try { s = JSON.stringify(obj); } catch (e) { s = '{}'; }
    if (maxLen && s.length > maxLen) s = s.slice(0, maxLen) + '…(truncated)';
    return s;
  }

  /* Parse a trailing @@NAV directive from the model answer.
     Returns { answer, directive }. directive is null when absent/invalid. */
  function extractDirective(text) {
    var result = { answer: text, directive: null };
    if (!text) return result;
    var idx = text.lastIndexOf('@@NAV');
    if (idx === -1) return result;
    var jsonPart = text.slice(idx + 5).trim();
    var answer = text.slice(0, idx).trim();
    try {
      var dir = JSON.parse(jsonPart);
      var clean = sanitizeDirective(dir);
      if (clean) { result.answer = answer || text; result.directive = clean; }
    } catch (e) { /* malformed directive — ignore, keep full text */ }
    return result;
  }

  function sanitizeDirective(dir) {
    if (!dir || typeof dir !== 'object') return null;
    var views = getVIEWS();
    var out = {};
    if (dir.view && views && views[dir.view]) out.view = String(dir.view);
    var allowedKeys = { period: 1, origin: 1, supplier: 1, sku: 1, currency: 1, version: 1 };
    if (dir.filters && typeof dir.filters === 'object') {
      var f = {};
      Object.keys(dir.filters).forEach(function (k) {
        if (allowedKeys[k]) f[k] = String(dir.filters[k]);
      });
      if (Object.keys(f).length) out.filters = f;
    }
    return (out.view || out.filters) ? out : null;
  }

  function applyDirective(dir) {
    if (!dir) return false;
    var applied = false;
    var f = getFILTERS();
    if (dir.filters && f) {
      Object.keys(dir.filters).forEach(function (k) {
        f[k] = dir.filters[k];
        applied = true;
      });
      try { if (typeof saveFilters === 'function') saveFilters(f); } catch (e) { /* ignore */ }
      try { if (typeof renderFilterBar === 'function') renderFilterBar(); } catch (e) { /* ignore */ }
    }
    var views = getVIEWS();
    if (dir.view && views && views[dir.view] && typeof switchView === 'function') {
      try { switchView(dir.view); applied = true; } catch (e) { /* ignore */ }
    } else if (applied && typeof switchView === 'function') {
      // Filters changed but no view jump — repaint current view to reflect them.
      var cur = getCurrentView();
      if (cur) { try { switchView(cur); } catch (e) { /* ignore */ } }
    }
    return applied;
  }

  /* =========================================================================
     (A) ⚙ SETTINGS MODAL
     ======================================================================= */
  function openSettings() {
    if (typeof modal !== 'function') {
      safeToast({ type: 'warn', title: 'AI Settings', body: 'Settings dialog is unavailable.' });
      return;
    }
    var cfg = loadCfg();
    var providerOpts =
      '<option value="openai"' + (cfg.provider === 'openai' ? ' selected' : '') + '>OpenAI</option>' +
      '<option value="anthropic"' + (cfg.provider === 'anthropic' ? ' selected' : '') + '>Anthropic</option>';

    var body =
      '<div class="form-help">Bring your own key. It is stored only in this browser ' +
        '(localStorage) and is sent directly to the provider you choose — never to us. ' +
        'Leave it empty to keep AI features off.</div>' +
      '<div class="form-grid">' +
        '<div class="form-row">' +
          '<label class="form-label">Provider</label>' +
          '<select class="form-input" id="ai-cfg-provider">' + providerOpts + '</select>' +
        '</div>' +
        '<div class="form-row">' +
          '<label class="form-label">Model</label>' +
          '<input class="form-input" type="text" id="ai-cfg-model" value="' + esc(cfg.model) + '" ' +
            'placeholder="' + esc(PROVIDERS[cfg.provider].defaultModel) + '" />' +
        '</div>' +
        '<div class="form-row">' +
          '<label class="form-label">API key</label>' +
          '<input class="form-input ai-key-input" type="password" id="ai-cfg-key" autocomplete="off" ' +
            'spellcheck="false" placeholder="paste your key…" />' +
        '</div>' +
      '</div>' +
      '<div class="ai-status-row">' +
        '<span class="ai-status-dot ' + (hasKey() ? 'ai-on' : 'ai-off') + '" id="ai-cfg-dot"></span>' +
        '<span class="ai-status-text" id="ai-cfg-status">Status: ' + esc(keyStatusLabel()) + '</span>' +
      '</div>';

    var footer =
      '<button class="btn btn-ghost" data-action="ai-clear-key">Clear key</button>' +
      '<button class="btn btn-primary" data-action="ai-save-settings">Save</button>';

    modal({ title: '⚙ AI Settings', sub: 'Bring-your-own-key LLM commentary & Q&A', body: body, footer: footer });

    // When provider changes, refresh the model placeholder/default hint.
    setTimeout(function () {
      var provSel = document.getElementById('ai-cfg-provider');
      var modelInp = document.getElementById('ai-cfg-model');
      if (provSel && modelInp) {
        provSel.addEventListener('change', function () {
          var p = PROVIDERS[provSel.value] || PROVIDERS.openai;
          modelInp.setAttribute('placeholder', p.defaultModel);
          // If the model field still holds the OTHER provider's default, swap it.
          var cur = (modelInp.value || '').trim();
          if (!cur || cur === PROVIDERS.openai.defaultModel || cur === PROVIDERS.anthropic.defaultModel) {
            modelInp.value = p.defaultModel;
          }
        });
      }
    }, 30);
  }

  function saveSettingsFromModal() {
    var provSel = document.getElementById('ai-cfg-provider');
    var modelInp = document.getElementById('ai-cfg-model');
    var keyInp = document.getElementById('ai-cfg-key');
    var prev = loadCfg();

    var provider = (provSel && PROVIDERS[provSel.value]) ? provSel.value : prev.provider;
    var model = (modelInp && modelInp.value.trim()) ? modelInp.value.trim() : PROVIDERS[provider].defaultModel;
    // Empty key field => keep the existing stored key (don't wipe on a re-open save).
    var key = (keyInp && keyInp.value) ? keyInp.value : prev.key;

    saveCfg({ provider: provider, model: model, key: key });
    safeCloseModal();
    safeToast({
      type: hasKey() ? 'success' : 'info',
      title: 'AI Settings saved',
      body: PROVIDERS[provider].label + ' · ' + model + ' · ' + keyStatusLabel(),
    });
  }

  function clearKeyFromModal() {
    clearKey();
    var dot = document.getElementById('ai-cfg-dot');
    var status = document.getElementById('ai-cfg-status');
    var keyInp = document.getElementById('ai-cfg-key');
    if (keyInp) keyInp.value = '';
    if (dot) { dot.classList.remove('ai-on'); dot.classList.add('ai-off'); }
    if (status) status.textContent = 'Status: ' + keyStatusLabel();
    safeToast({ type: 'info', title: 'API key cleared', body: 'AI features are now off.' });
  }

  /* =========================================================================
     (C) REAL COMMENTARY  — "✦ AI narrative" button in the PPV commentary card
     ======================================================================= */
  function injectNarrativeButton() {
    var card = document.getElementById('ppv-commentary');
    if (!card) return;
    var actions = card.querySelector('.card-actions');
    if (!actions) return;
    if (actions.querySelector('.' + NARRATIVE_BTN)) return; // already injected

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm ' + NARRATIVE_BTN;
    btn.setAttribute('data-action', 'ai-commentary');
    btn.title = hasKey()
      ? 'Generate a model-authored executive narrative from live data'
      : NO_KEY_MSG;
    btn.innerHTML = '✦ AI narrative';
    // Place it first so it reads as the "smart" option next to Regenerate.
    actions.insertBefore(btn, actions.firstChild);
  }

  function runCommentary() {
    var bodyEl = document.getElementById('commentary-body');
    if (!hasKey()) {
      safeToast({ type: 'info', title: 'AI narrative', body: NO_KEY_MSG });
      return;
    }
    if (!bodyEl) {
      safeToast({ type: 'warn', title: 'AI narrative', body: 'Open the PPV view first.' });
      return;
    }
    // Preserve the existing templated commentary so we can restore on error.
    var previousHtml = bodyEl.innerHTML;
    bodyEl.innerHTML = '<div class="ai-loading"><span class="ai-spinner"></span>' +
      '<span>Drafting executive narrative from live data…</span></div>';

    var btn = document.querySelector('.' + NARRATIVE_BTN);
    if (btn) btn.setAttribute('disabled', 'disabled');

    callLLM('You write board-ready financial commentary. Be precise and grounded.', commentaryPrompt())
      .then(function (text) {
        // Re-fetch in case the view changed while the request was in flight.
        var el = document.getElementById('commentary-body');
        if (el) el.innerHTML = renderNarrative(text);
        safeToast({ type: 'success', title: 'AI narrative ready', body: 'Executive commentary regenerated by your model.' });
      })
      .catch(function (err) {
        var el = document.getElementById('commentary-body');
        if (el) el.innerHTML = previousHtml; // keep templated commentary intact
        safeToast({ type: 'error', title: 'AI narrative failed', body: (err && err.message) || 'Unknown error.' });
      })
      .then(function () {
        var b = document.querySelector('.' + NARRATIVE_BTN);
        if (b) b.removeAttribute('disabled');
      });
  }

  /* Render model prose into the commentary body using existing look. */
  function renderNarrative(text) {
    var paras = String(text).split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (!paras.length) paras = [String(text).trim()];
    var html = '<div class="ai-narrative">';
    html += '<div class="ai-narrative-tag">✦ AI-authored · grounded in live data</div>';
    paras.forEach(function (p) { html += '<p>' + esc(p) + '</p>'; });
    html += '</div>';
    return html;
  }

  /* =========================================================================
     (D) ASK THE DESK  — topbar "✦ Ask" launcher + drawer with transcript
     ======================================================================= */
  function openAsk() {
    if (typeof openDrawer !== 'function') {
      safeToast({ type: 'warn', title: 'Ask the Desk', body: 'Drawer is unavailable.' });
      return;
    }
    openDrawer({
      title: '✦ Ask the Desk',
      sub: 'Natural-language Q&A grounded in the live terminal data',
      body: askDrawerBody(),
    });
    // Wire the composer after the drawer DOM exists.
    setTimeout(wireAskComposer, 30);
  }

  function askDrawerBody() {
    var keyBanner = hasKey() ? '' :
      '<div class="ai-nokey-banner">' +
        '<div class="ai-nokey-title">AI is off</div>' +
        '<div class="ai-nokey-body">' + esc(NO_KEY_MSG) + ' ' +
          'Click <button class="btn btn-sm ai-open-settings-inline" data-action="ai-settings">⚙ Settings</button> ' +
          'to paste an OpenAI or Anthropic key. Your key stays in this browser.</div>' +
      '</div>';

    return keyBanner +
      '<div class="ai-chat" id="ai-chat-transcript">' + renderTranscript() + '</div>' +
      '<div class="ai-suggest" id="ai-suggest">' + renderSuggestions() + '</div>' +
      '<div class="ai-composer">' +
        '<textarea class="form-input ai-chat-input" id="ai-chat-input" rows="2" ' +
          'placeholder="Ask about PPV, hedges, EUDR, contracts, forecast…"></textarea>' +
        '<button class="btn btn-primary ai-send-btn" id="ai-send-btn" data-action="ai-send">Send</button>' +
      '</div>';
  }

  function renderSuggestions() {
    if (transcript.length) return '';
    var qs = [
      'What is the total adverse PPV and which SKU drives it?',
      'Which hedge designation failed and why?',
      'Which suppliers are at EUDR risk?',
      'How does the forecast compare to budget?',
    ];
    return '<div class="ai-suggest-label">Try asking</div>' +
      qs.map(function (q) {
        return '<button class="ai-suggest-chip" type="button" data-ai-suggest="' + esc(q) + '">' + esc(q) + '</button>';
      }).join('');
  }

  function renderTranscript() {
    if (!transcript.length) {
      return '<div class="ai-empty">Ask a question about the cocoa book — variances, hedges, ' +
        'EUDR readiness, contracts, or the forecast. Answers are grounded in the live data on screen.</div>';
    }
    return transcript.map(function (m) {
      if (m.role === 'user') {
        return '<div class="ai-msg ai-msg-user"><div class="ai-msg-who">You</div>' +
          '<div class="ai-bubble ai-bubble-user">' + esc(m.text) + '</div></div>';
      }
      if (m.role === 'error') {
        return '<div class="ai-msg ai-msg-desk"><div class="ai-msg-who">Desk</div>' +
          '<div class="ai-bubble ai-bubble-error">' + esc(m.text) + '</div></div>';
      }
      // assistant
      return '<div class="ai-msg ai-msg-desk"><div class="ai-msg-who">Desk</div>' +
        '<div class="ai-bubble ai-bubble-desk">' + renderAnswerHtml(m.text) + '</div></div>';
    }).join('');
  }

  function renderAnswerHtml(text) {
    var paras = String(text).split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (!paras.length) paras = [String(text).trim()];
    return paras.map(function (p) {
      // Render simple bullet blocks as a list; otherwise a paragraph.
      var bulletLines = p.split('\n').filter(function (l) { return /^\s*[-*•]/.test(l); });
      if (bulletLines.length && bulletLines.length === p.split('\n').length) {
        return '<ul class="ai-list">' + bulletLines.map(function (l) {
          return '<li>' + esc(l.replace(/^\s*[-*•]\s?/, '')) + '</li>';
        }).join('') + '</ul>';
      }
      return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function refreshTranscriptDom() {
    var chat = document.getElementById('ai-chat-transcript');
    if (chat) {
      chat.innerHTML = renderTranscript();
      chat.scrollTop = chat.scrollHeight;
    }
    var sug = document.getElementById('ai-suggest');
    if (sug) sug.innerHTML = renderSuggestions();
  }

  function wireAskComposer() {
    var input = document.getElementById('ai-chat-input');
    if (input && !input.__aiWired) {
      input.__aiWired = true;
      input.addEventListener('keydown', function (e) {
        if (e.defaultPrevented) return;
        // Enter sends; Shift+Enter newline.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendAsk();
        }
      });
      input.focus();
    }
    // Suggestion chips (scoped to the drawer; not via the global dispatcher).
    var sug = document.getElementById('ai-suggest');
    if (sug && !sug.__aiWired) {
      sug.__aiWired = true;
      sug.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-ai-suggest]');
        if (!chip) return;
        var q = chip.getAttribute('data-ai-suggest') || '';
        var inp = document.getElementById('ai-chat-input');
        if (inp) inp.value = q;
        sendAsk();
      });
    }
  }

  function sendAsk() {
    if (asking) return;
    var input = document.getElementById('ai-chat-input');
    var q = input ? (input.value || '').trim() : '';
    if (!q) return;

    if (!hasKey()) {
      safeToast({ type: 'info', title: 'Ask the Desk', body: NO_KEY_MSG });
      return;
    }

    transcript.push({ role: 'user', text: q });
    if (input) input.value = '';
    refreshTranscriptDom();

    asking = true;
    setSendBusy(true);
    appendThinking();

    callLLM(askSystemPrompt(), askUserPrompt(q))
      .then(function (raw) {
        var parsed = extractDirective(raw);
        transcript.push({ role: 'assistant', text: parsed.answer || raw });
        refreshTranscriptDom();
        if (parsed.directive) {
          var applied = applyDirective(parsed.directive);
          if (applied) {
            var bits = [];
            if (parsed.directive.view) bits.push('view → ' + parsed.directive.view);
            if (parsed.directive.filters) {
              Object.keys(parsed.directive.filters).forEach(function (k) {
                bits.push(k + ' → ' + parsed.directive.filters[k]);
              });
            }
            safeToast({ type: 'info', title: 'Applied by Desk', body: bits.join(' · ') });
          }
        }
      })
      .catch(function (err) {
        transcript.push({ role: 'error', text: (err && err.message) || 'Unknown error.' });
        refreshTranscriptDom();
      })
      .then(function () {
        asking = false;
        setSendBusy(false);
        removeThinking();
        refreshTranscriptDom();
      });
  }

  function appendThinking() {
    var chat = document.getElementById('ai-chat-transcript');
    if (!chat) return;
    var el = document.createElement('div');
    el.className = 'ai-msg ai-msg-desk';
    el.id = 'ai-thinking';
    el.innerHTML = '<div class="ai-msg-who">Desk</div>' +
      '<div class="ai-bubble ai-bubble-desk ai-thinking"><span class="ai-spinner"></span>Thinking…</div>';
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
  }

  function removeThinking() {
    var el = document.getElementById('ai-thinking');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function setSendBusy(busy) {
    var btn = document.getElementById('ai-send-btn');
    if (!btn) return;
    if (busy) { btn.setAttribute('disabled', 'disabled'); btn.textContent = '…'; }
    else { btn.removeAttribute('disabled'); btn.textContent = 'Send'; }
  }

  /* =========================================================================
     TOPBAR BUTTONS — ⚙ Settings + ✦ Ask (idempotent, prepended)
     ======================================================================= */
  function injectTopbarButtons() {
    var bar = document.querySelector('.topbar-actions');
    if (!bar) return;

    if (!bar.querySelector('.' + SETTINGS_BTN)) {
      var sBtn = document.createElement('button');
      sBtn.type = 'button';
      sBtn.className = 'btn btn-ghost ' + SETTINGS_BTN;
      sBtn.title = 'AI Settings (bring your own key)';
      sBtn.setAttribute('aria-label', 'AI Settings');
      sBtn.setAttribute('data-action', 'ai-settings');
      sBtn.innerHTML = '⚙';
      bar.insertBefore(sBtn, bar.firstChild); // prepend
    }

    if (!bar.querySelector('.' + ASK_BTN)) {
      var aBtn = document.createElement('button');
      aBtn.type = 'button';
      aBtn.className = 'btn btn-ghost ' + ASK_BTN;
      aBtn.title = 'Ask the Desk — natural-language Q&A over the live data';
      aBtn.setAttribute('aria-label', 'Ask the Desk');
      aBtn.setAttribute('data-action', 'ai-ask');
      aBtn.innerHTML = '✦ Ask';
      // Prepend after the settings cog so order reads: ⚙  ✦ Ask  …
      var cog = bar.querySelector('.' + SETTINGS_BTN);
      if (cog && cog.nextSibling) bar.insertBefore(aBtn, cog.nextSibling);
      else bar.insertBefore(aBtn, bar.firstChild);
    }
  }

  /* =========================================================================
     ACTION REGISTRATION — ACTIONS is a live map the dispatcher reads per click
     ======================================================================= */
  function registerActions() {
    var A = getACTIONS();
    if (!A) return false;
    A['ai-settings']   = function () { openSettings(); };
    A['ai-save-settings'] = function () { saveSettingsFromModal(); };
    A['ai-clear-key']  = function () { clearKeyFromModal(); };
    A['ai-commentary'] = function () { runCommentary(); };
    A['ai-ask']        = function () { openAsk(); };
    A['ai-send']       = function () { sendAsk(); };
    return true;
  }

  /* =========================================================================
     afterRender — run a fn after every #canvas render + once on load.
     ======================================================================= */
  function afterRender(fn) {
    var canvas = document.getElementById('canvas');
    if (!canvas) { fn(); return; }
    var t;
    var run = function () { clearTimeout(t); t = setTimeout(fn, 0); };
    try {
      new MutationObserver(run).observe(canvas, { childList: true, subtree: false });
    } catch (e) { /* MutationObserver unavailable — initial pass still runs */ }
    fn(); // initial pass for the already-rendered view
  }

  /* =========================================================================
     STYLES — ONE module-prefixed <style>, design tokens only.
     ======================================================================= */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      /* topbar buttons */
      '.' + SETTINGS_BTN + '{font-size:14px;padding-left:9px;padding-right:9px;}',
      '.' + ASK_BTN + '{letter-spacing:.2px;}',
      '.' + ASK_BTN + ',.' + NARRATIVE_BTN + '{color:var(--accent);}',

      /* settings status row */
      '.ai-status-row{display:flex;align-items:center;gap:8px;margin-top:12px;' +
        'padding-top:12px;border-top:1px solid var(--line);}',
      '.ai-status-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}',
      '.ai-status-dot.ai-on{background:var(--pos);box-shadow:0 0 6px var(--pos);}',
      '.ai-status-dot.ai-off{background:var(--text-3);}',
      '.ai-status-text{font-family:var(--mono);font-size:11px;color:var(--text-2);}',
      '.ai-key-input{font-family:var(--mono);letter-spacing:1px;}',

      /* AI narrative (commentary body) */
      '.ai-narrative{display:flex;flex-direction:column;gap:10px;}',
      '.ai-narrative-tag{font-family:var(--mono);font-size:10px;letter-spacing:.5px;' +
        'text-transform:uppercase;color:var(--accent);}',
      '.ai-narrative p{margin:0;color:var(--text-1);font-family:var(--sans);' +
        'font-size:13px;line-height:1.62;}',
      '.ai-loading{display:flex;align-items:center;gap:10px;color:var(--text-2);' +
        'font-family:var(--sans);font-size:13px;padding:6px 0;}',

      /* spinner */
      '.ai-spinner{display:inline-block;width:13px;height:13px;border-radius:50%;' +
        'border:2px solid var(--line-3);border-top-color:var(--accent);' +
        'animation:ai-spin .7s linear infinite;flex:0 0 auto;}',
      '@keyframes ai-spin{to{transform:rotate(360deg);}}',

      /* Ask drawer — no-key banner */
      '.ai-nokey-banner{border:1px solid var(--line-2);background:var(--bg-2);' +
        'border-radius:8px;padding:12px 14px;margin-bottom:12px;}',
      '.ai-nokey-title{font-family:var(--mono);font-size:11px;text-transform:uppercase;' +
        'letter-spacing:.5px;color:var(--warn);margin-bottom:4px;}',
      '.ai-nokey-body{font-family:var(--sans);font-size:12.5px;color:var(--text-1);line-height:1.55;}',
      '.ai-open-settings-inline{padding:1px 7px;vertical-align:baseline;}',

      /* Ask drawer — chat */
      '.ai-chat{display:flex;flex-direction:column;gap:14px;max-height:46vh;' +
        'overflow-y:auto;padding:4px 2px 8px;}',
      '.ai-empty{color:var(--text-2);font-family:var(--sans);font-size:12.5px;' +
        'line-height:1.55;padding:8px 2px;}',
      '.ai-msg{display:flex;flex-direction:column;gap:4px;}',
      '.ai-msg-user{align-items:flex-end;}',
      '.ai-msg-desk{align-items:flex-start;}',
      '.ai-msg-who{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;' +
        'letter-spacing:.5px;color:var(--text-3);padding:0 4px;}',
      '.ai-bubble{max-width:88%;border-radius:10px;padding:9px 12px;' +
        'font-family:var(--sans);font-size:12.5px;line-height:1.55;}',
      '.ai-bubble p{margin:0 0 7px;}',
      '.ai-bubble p:last-child{margin-bottom:0;}',
      '.ai-bubble-user{background:var(--accent-dim);color:var(--text-0);' +
        'border:1px solid var(--accent-2);border-bottom-right-radius:3px;}',
      '.ai-bubble-desk{background:var(--bg-2);color:var(--text-1);' +
        'border:1px solid var(--line-2);border-bottom-left-radius:3px;}',
      '.ai-bubble-error{background:var(--neg-dim);color:var(--text-0);' +
        'border:1px solid var(--neg);border-bottom-left-radius:3px;}',
      '.ai-thinking{display:flex;align-items:center;gap:8px;color:var(--text-2);}',
      '.ai-list{margin:2px 0 0;padding-left:18px;}',
      '.ai-list li{margin:2px 0;}',

      /* suggestions */
      '.ai-suggest{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px;}',
      '.ai-suggest-label{flex:1 0 100%;font-family:var(--mono);font-size:9.5px;' +
        'text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);margin-bottom:2px;}',
      '.ai-suggest-chip{font-family:var(--sans);font-size:11.5px;color:var(--text-1);' +
        'background:var(--bg-2);border:1px solid var(--line-2);border-radius:14px;' +
        'padding:5px 11px;cursor:pointer;text-align:left;line-height:1.3;}',
      '.ai-suggest-chip:hover{background:var(--bg-3);border-color:var(--line-3);color:var(--text-0);}',

      /* composer */
      '.ai-composer{display:flex;gap:8px;align-items:flex-end;margin-top:12px;' +
        'padding-top:12px;border-top:1px solid var(--line);}',
      '.ai-chat-input{flex:1 1 auto;resize:vertical;min-height:40px;' +
        'font-family:var(--sans);font-size:12.5px;line-height:1.45;}',
      '.ai-send-btn{flex:0 0 auto;align-self:stretch;}',
    ].join('\n');

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* =========================================================================
     INSTALL (top-level on load)
     ======================================================================= */
  injectStyle();
  registerActions();
  injectTopbarButtons();

  // Inject the "✦ AI narrative" button after every render (it only attaches
  // when the PPV commentary card is present). afterRender also runs once now.
  afterRender(function () {
    injectNarrativeButton();
  });

  // Topbar can be re-rendered by other modules; re-ensure our buttons exist.
  // (afterRender fires on canvas changes; the topbar is static, but this keeps
  // the buttons resilient if another module touches .topbar-actions later.)
  try {
    var tb = document.querySelector('.topbar-actions');
    if (tb) {
      new MutationObserver(function () { injectTopbarButtons(); })
        .observe(tb, { childList: true });
    }
  } catch (e) { /* non-fatal */ }

})();
