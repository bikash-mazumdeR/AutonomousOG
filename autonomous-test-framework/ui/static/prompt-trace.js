/**
 * ARIA prompt trace viewer, shared by the Agent 03-06 consoles.
 *
 * Usage: <script src="/prompt-trace.js"></script> then AriaPromptTrace.mount({ prefix: 'agent05', title: 'Agent 05' }).
 * Adds a "View agent input & token math" button to the page's #tokenCard and a modal that renders the trace served
 * by GET /api/<prefix>/prompt-trace (built by core/llm/stagePromptTrace.ts). Token counts shown are the ones the
 * provider API reported; ARIA never tokenizes text itself.
 */
(function () {
  'use strict';

  /** Where each provider's API reports the counts ARIA displays. */
  const USAGE_FIELDS = {
    bedrock: 'Converse API usage.inputTokens / usage.outputTokens',
    anthropic: 'Messages API usage.input_tokens / usage.output_tokens',
    gemini: 'usageMetadata.promptTokenCount / usageMetadata.candidatesTokenCount',
    openai: 'usage.prompt_tokens / usage.completion_tokens',
    litellm: 'usage.prompt_tokens / usage.completion_tokens (LiteLLM proxy)',
  };

  const CSS = `
    .apt-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); display: none; align-items: center; justify-content: center; z-index: 1000; }
    .apt-overlay.apt-open { display: flex; }
    .apt-card { background: var(--surface, #1e293b); color: var(--text, #e2e8f0); border: 1px solid var(--border, #334155); border-radius: 14px;
      width: min(1150px, 96vw); max-height: 92vh; display: flex; flex-direction: column; font-size: 13px; text-align: left; }
    .apt-head { padding: 16px 22px; border-bottom: 1px solid var(--border, #334155); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .apt-title { font-size: 16px; font-weight: 700; }
    .apt-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
    .apt-btn { background: transparent; color: var(--text-muted, #94a3b8); border: 1px solid var(--border, #334155); border-radius: 6px;
      padding: 7px 12px; cursor: pointer; font-size: 12px; font-weight: 600; }
    .apt-btn:hover { background: var(--surface2, #273449); color: var(--text, #e2e8f0); }
    .apt-open-btn { width: 100%; margin-top: 12px; }
    .apt-body { padding: 18px 22px; overflow-y: auto; }
    .apt-section { margin-bottom: 22px; }
    .apt-section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted, #94a3b8); margin: 0 0 10px; }
    .apt-note { color: var(--text-muted, #94a3b8); font-size: 12px; margin: 6px 0; }
    .apt-meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
    .apt-meta div { background: var(--surface2, #273449); border-radius: 6px; padding: 8px 10px; font-size: 12px; overflow-wrap: anywhere; }
    .apt-meta b { display: block; color: var(--text-dim, #64748b); font-weight: 500; font-size: 11px; }
    .apt-table-wrap { overflow-x: auto; }
    .apt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .apt-table th, .apt-table td { padding: 6px 8px; border-bottom: 1px solid var(--border, #334155); text-align: left; vertical-align: top;
      position: static; background: none; }
    .apt-table th { color: var(--text-dim, #64748b); font-weight: 600; white-space: nowrap; }
    .apt-table .num { text-align: right; font-family: monospace; white-space: nowrap; }
    .apt-table tr.apt-total td { font-weight: 700; border-top: 2px solid var(--border, #334155); }
    .apt-bar { height: 6px; background: var(--accent, #6366f1); border-radius: 3px; min-width: 2px; }
    .apt-formula { background: #020817; border: 1px solid var(--border, #334155); border-radius: 8px; padding: 10px 12px;
      font-family: monospace; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 8px; }
    .apt-body details { background: var(--surface2, #273449); border-radius: 8px; margin-bottom: 8px; }
    .apt-body summary { cursor: pointer; padding: 9px 12px; font-size: 13px; font-weight: 600; }
    .apt-dim { color: var(--text-dim, #64748b); font-weight: 400; margin-left: 6px; }
    .apt-pre { background: #020817; margin: 0 10px 10px; padding: 10px 12px; border-radius: 6px; max-height: 420px; overflow: auto;
      font-family: 'Fira Code', 'JetBrains Mono', monospace; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .apt-body details details { margin: 0 10px 8px; background: var(--surface, #1e293b); }
    .apt-inner { padding: 0 12px 10px; }
    .apt-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; margin-left: 6px; }
    .apt-ok { background: rgba(34,197,94,.13); color: var(--success, #22c55e); border: 1px solid var(--success, #22c55e); }
    .apt-bad { background: rgba(239,68,68,.13); color: var(--danger, #ef4444); border: 1px solid var(--danger, #ef4444); }
    .apt-errors { margin: 0; padding-left: 18px; font-size: 12px; color: #f87171; }
    .apt-errors li { margin: 2px 0; overflow-wrap: anywhere; }
    .apt-alert { border: 1px solid var(--danger, #ef4444); color: #f87171; background: rgba(239,68,68,.1); border-radius: 6px;
      padding: 10px 12px; margin-top: 12px; white-space: pre-wrap; }
    .apt-info { border: 1px solid var(--accent, #6366f1); background: rgba(99,102,241,.1); border-radius: 6px; padding: 10px 12px; }
  `;

  let config = null;
  let currentTrace = null;

  const esc = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const fmtInt = (n) => (Number(n) || 0).toLocaleString();
  const fmtUsd = (n) => '$' + (Number(n) || 0).toFixed(6);
  const chars = (v) => ` — ${fmtInt(String(v || '').length)} chars`;

  function details(title, subtitle, content, open) {
    if (content === null || content === undefined) return '';
    return `<details${open ? ' open' : ''}><summary>${esc(title)}<span class="apt-dim">${esc(subtitle || '')}</span></summary>`
      + `<pre class="apt-pre">${esc(content === '' ? '(empty)' : content)}</pre></details>`;
  }

  function renderOverview(t) {
    const calls = t.calls || [];
    const models = [...new Set(calls.map((c) => `${c.provider} · ${c.model}`))].join(', ') || '— (no LLM call)';
    const cells = [
      ['Recorded', new Date(t.generatedAt).toLocaleString()], ['Project', t.projectName],
      ['Model(s)', models], ['LLM calls', calls.length],
      ...Object.entries(t.overview || {}),
    ];
    return `<div class="apt-section"><div class="apt-meta">${cells.map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div>`
      + (t.error ? `<div class="apt-alert">${esc(t.error)}</div>` : '') + '</div>';
  }

  function renderNoCalls(t) {
    const reason = t.noLlmReason
      || 'No LLM call was made on this run (for example, nothing needed the LLM, or the run stopped before its first call), so it consumed no tokens.';
    return `<div class="apt-section"><h3>How the token card is calculated</h3><div class="apt-info">${esc(reason)}</div>
      <p class="apt-note">Questions asked in this page's chat panel are handled by the UI server, not by an agent run, so they are not part of this trace.</p></div>`;
  }

  function renderTokens(t) {
    const calls = t.calls || [];
    if (!calls.length) return renderNoCalls(t);
    const rows = calls.map((c) => `<tr><td>${c.callNumber}</td>
        <td>${esc(c.purpose)}${c.truncated ? '<span class="apt-badge apt-bad">truncated</span>' : ''}${c.fallback ? '<span class="apt-badge apt-bad">fallback model</span>' : ''}
          <br><span class="apt-note">${esc(c.model)} · ${(c.durationMs / 1000).toFixed(1)}s</span></td>
        <td class="num">${fmtInt(c.reportedUsage.promptTokens)}</td>
        <td class="num">${fmtInt(c.reportedUsage.cacheReadTokens)} / ${fmtInt(c.reportedUsage.cacheWriteTokens)}</td>
        <td class="num">${fmtInt(c.reportedUsage.completionTokens)}</td>
        <td class="num">$${c.pricingPer1K.input} / $${c.pricingPer1K.output}</td>
        <td class="num">${fmtUsd(c.usage.estimatedCostUSD)}</td></tr>`).join('');
    const s = t.totals.stage;
    const formulas = calls.map((c) => `Call ${c.callNumber}: input  ${fmtInt(c.usage.promptTokens)} / 1000 × $${c.pricingPer1K.input} = ${fmtUsd(c.costBreakdownUSD.input)}\n`
      + `        output ${fmtInt(c.usage.completionTokens)} / 1000 × $${c.pricingPer1K.output} = ${fmtUsd(c.costBreakdownUSD.output)}`).join('\n');
    const rate = calls[calls.length - 1].usage.exchangeRate;
    const providers = [...new Set(calls.map((c) => c.provider))];
    const notes = [
      `Token counts are <b>not computed by ARIA</b>. They are read from the provider's response: ${providers.map((p) => `<b>${esc(p)}</b> → <code>${esc(USAGE_FIELDS[p] || 'usage')}</code>`).join('; ')}. `
        + 'Input tokens include the system prompt, the user prompt and the provider\'s message framing.',
      ...(t.llmUsageNotes || []).map(esc),
      'Chat panel questions are handled by the UI server, not by an agent run, so they are not listed here.',
      'Cost = input tokens / 1000 × input price + output tokens / 1000 × output price (USD per 1K tokens from <code>config/framework.config.ts → llm.pricing</code>); ₹ = USD × exchange rate. Cached input tokens (cache read / write) are reported separately and are not priced in this estimate.',
    ];
    const card = `Token card:  prompt ${fmtInt(s.promptTokens)}  +  completion ${fmtInt(s.completionTokens)}  =  total ${fmtInt(s.totalTokens)}\n`
      + `Cost:        ${fmtUsd(s.estimatedCostUSD)}  × ${rate} INR/USD  =  ₹${(s.estimatedCostINR || 0).toFixed(2)}`;
    return `<div class="apt-section"><h3>How the token card is calculated</h3>
      <div class="apt-table-wrap"><table class="apt-table">
        <tr><th>#</th><th>Call</th><th class="num">Input tok</th><th class="num">Cache read / write</th><th class="num">Output tok</th><th class="num">$ per 1K in / out</th><th class="num">Cost</th></tr>
        ${rows}
        <tr class="apt-total"><td></td><td>Token card total</td><td class="num">${fmtInt(s.promptTokens)}</td><td class="num">${fmtInt(s.cacheReadTokens)} / ${fmtInt(s.cacheWriteTokens)}</td><td class="num">${fmtInt(s.completionTokens)}</td><td></td><td class="num">${fmtUsd(s.estimatedCostUSD)}</td></tr>
      </table></div>
      <div class="apt-formula">${esc(formulas)}\n\n${esc(card)}</div>
      ${notes.map((n) => `<p class="apt-note">• ${n}</p>`).join('')}</div>`;
  }

  function renderComposition(group) {
    const comp = group.composition || {};
    if (!comp.rows || !comp.rows.length) return '';
    const totalChars = comp.rows.reduce((sum, r) => sum + r.chars, 0);
    const method = comp.method === 'proportional-to-reported'
      ? `Estimated: the ${fmtInt(comp.basisTokens)} input tokens the provider processed on this group's first call (including any prompt-cache reads/writes) are split across sources in proportion to their characters (${(totalChars / comp.basisTokens).toFixed(2)} chars per token). Exact per-section counts would need the provider's tokenizer.`
      : 'Estimated at ~4 characters per token.';
    const rows = comp.rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${fmtInt(r.chars)}</td><td class="num">≈ ${fmtInt(r.estimatedTokens)}</td>
        <td class="num">${(r.share * 100).toFixed(1)}%</td><td style="width:30%"><div class="apt-bar" style="width:${(r.share * 100).toFixed(1)}%"></div></td></tr>`).join('');
    return `<p class="apt-note"><b>What makes up the input (first call)</b></p><div class="apt-table-wrap"><table class="apt-table">
        <tr><th>Source</th><th class="num">Characters</th><th class="num">Tokens</th><th class="num">Share</th><th></th></tr>${rows}
        <tr class="apt-total"><td>Total</td><td class="num">${fmtInt(totalChars)}</td><td class="num">${comp.basisTokens ? fmtInt(comp.basisTokens) : ''}</td><td></td><td></td></tr>
      </table></div><p class="apt-note">${method}</p>`;
  }

  function renderAttempts(group) {
    if (!group.attempts || !group.attempts.length) return '<p class="apt-note">No validation result was recorded for this group.</p>';
    const rows = group.attempts.map((a) => {
      const shown = a.errors.length < a.errorCount ? ` (first ${a.errors.length} shown)` : '';
      const errors = a.errorCount === 0 ? '<span class="apt-badge apt-ok">no errors</span>'
        : `<details><summary>${fmtInt(a.errorCount)} error(s)${shown}</summary><ul class="apt-errors apt-inner">${a.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>`;
      return `<tr><td>${a.attempt}</td><td>${esc(a.summary || '')}</td><td>${errors}</td></tr>`;
    }).join('');
    return `<p class="apt-note"><b>Attempts</b> — errors are what the agent's own validation found; on a retry they are sent back to the model.</p>
      <div class="apt-table-wrap"><table class="apt-table"><tr><th>Attempt</th><th>Result</th><th>Validation</th></tr>${rows}</table></div>`;
  }

  function renderGroups(t) {
    const groups = t.groups || [];
    if (!groups.length) return '';
    const blocks = groups.map((g) => {
      const u = g.usage || {};
      const failed = (g.attempts || []).length > 0 && g.attempts[g.attempts.length - 1].errorCount > 0;
      const facts = Object.entries(g.facts || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
      return `<details${failed ? ' open' : ''}><summary>${esc(g.kind)} — ${esc(g.title)}${failed ? '<span class="apt-badge apt-bad">unresolved errors</span>' : ''}
          <span class="apt-dim">${esc(facts)}${facts ? ' · ' : ''}${(g.callNumbers || []).length} call(s) · in ${fmtInt(u.promptTokens)} / out ${fmtInt(u.completionTokens)} tokens · ${fmtUsd(u.estimatedCostUSD)}</span></summary>
        <div class="apt-inner">${renderAttempts(g)}${renderComposition(g)}</div></details>`;
    }).join('');
    return `<div class="apt-section"><h3>Per unit of work</h3>${blocks}</div>`;
  }

  function renderInputs(t) {
    const inputs = t.sharedInputs || [];
    if (!inputs.length) return '';
    return `<div class="apt-section"><h3>Shared agent input</h3>${inputs.map((i) => details(i.label, chars(i.content), i.content)).join('')}</div>`;
  }

  function renderCalls(t) {
    if (!(t.calls || []).length) return '';
    const calls = t.calls.map((c) => {
      const req = c.request || {};
      const params = `temperature ${req.temperature ?? 'default'} · seed ${req.seed ?? '—'} · JSON mode ${req.json ? 'on' : 'off'} · max tokens requested ${req.maxTokens ?? 'default'} / applied ${c.effectiveMaxTokens ?? 'provider default'}`;
      const messages = c.messages.map((m, idx) => details(`Message ${idx + 1} — ${m.role}`, ` ${fmtInt(m.chars)} chars`, m.content)).join('');
      return `<details><summary>Call ${c.callNumber}: ${esc(c.purpose)}<span class="apt-dim">${esc(c.model)} · in ${fmtInt(c.reportedUsage.promptTokens)} / out ${fmtInt(c.reportedUsage.completionTokens)} tokens</span></summary>
        <p class="apt-note apt-inner">${esc(params)}</p>${messages}${details('Raw LLM response', ` ${fmtInt((c.responseText || '').length)} chars`, c.responseText)}</details>`;
    }).join('');
    return `<div class="apt-section"><h3>LLM calls — request &amp; raw response</h3>${calls}</div>`;
  }

  function renderWarnings(t) {
    const warnings = t.warnings || [];
    if (!warnings.length) return '';
    return `<div class="apt-section"><details><summary>Run warnings<span class="apt-dim">${warnings.length}</span></summary>
      <ul class="apt-errors apt-inner" style="color:var(--warning, #f59e0b)">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details></div>`;
  }

  /** Renders a trace to HTML (exposed for tests). */
  function render(t) {
    return renderOverview(t) + renderTokens(t) + renderGroups(t) + renderInputs(t) + renderCalls(t) + renderWarnings(t);
  }

  async function fetchTrace() {
    const resp = await fetch(`/api/${config.prefix}/prompt-trace`);
    const data = await resp.json().catch(() => ({ error: `The server returned HTTP ${resp.status} — restart the UI server if this page was just updated.` }));
    if (!resp.ok) throw new Error(data.error || 'No prompt trace available.');
    return data;
  }

  async function open() {
    const body = document.getElementById('aptBody');
    body.innerHTML = 'Loading…';
    document.getElementById('aptStatus').innerHTML = '';
    document.getElementById('aptOverlay').classList.add('apt-open');
    try {
      currentTrace = await fetchTrace();
      document.getElementById('aptStatus').innerHTML = `<span class="apt-badge ${currentTrace.status === 'FAILED' ? 'apt-bad' : 'apt-ok'}">${esc(currentTrace.status)}</span>`;
      body.innerHTML = render(currentTrace);
    } catch (e) {
      currentTrace = null;
      body.innerHTML = `<p class="apt-note">${esc(e.message)}</p>`;
    }
  }

  /** Fills the token card from the trace when the stage stored no usage (a failed run, or a run from before usage was saved). */
  function fillHiddenTokenCard(card, trace) {
    const s = trace.totals && trace.totals.stage;
    if (!s || !card.classList.contains('hidden')) return;
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('tokPrompt', fmtInt(s.promptTokens));
    set('tokCompletion', fmtInt(s.completionTokens));
    set('tokTotal', fmtInt(s.totalTokens));
    set('tokCost', `₹${(s.estimatedCostINR || 0).toFixed(2)} ($${(s.estimatedCostUSD || 0).toFixed(6)})`);
    card.classList.remove('hidden');
  }

  function buildModal() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const overlay = document.createElement('div');
    overlay.className = 'apt-overlay';
    overlay.id = 'aptOverlay';
    overlay.innerHTML = `<div class="apt-card"><div class="apt-head">
        <div class="apt-title">🔍 ${esc(config.title)} — Input Context &amp; Token Usage</div><span id="aptStatus"></span>
        <div class="apt-actions"><button class="apt-btn" id="aptDownload">⬇ Download JSON</button><button class="apt-btn" id="aptClose">✕ Close</button></div>
      </div><div class="apt-body" id="aptBody">Loading…</div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('apt-open'); });
    document.getElementById('aptClose').addEventListener('click', () => overlay.classList.remove('apt-open'));
    document.getElementById('aptDownload').addEventListener('click', () => {
      if (!currentTrace) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(currentTrace, null, 2)], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: `${config.prefix}-prompt-trace.json` }).click();
      URL.revokeObjectURL(url);
    });
  }

  /**
   * Adds the viewer to the page.
   * @param {{ prefix: string, title: string }} options - prefix: API prefix such as "agent05"
   */
  function mount(options) {
    config = options;
    const start = () => {
      buildModal();
      const card = document.getElementById('tokenCard');
      if (!card) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'apt-btn apt-open-btn';
      button.textContent = '🔍 View agent input & token math';
      button.addEventListener('click', open);
      card.appendChild(button);
      fetchTrace().then((trace) => fillHiddenTokenCard(card, trace)).catch(() => { /* no trace yet */ });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  window.AriaPromptTrace = { mount, open, render };
}());
