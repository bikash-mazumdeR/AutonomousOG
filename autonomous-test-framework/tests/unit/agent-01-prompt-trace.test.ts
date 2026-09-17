import { buildPromptTrace, composeInput, PromptTraceInput, UTILITY_STAGE_ID } from '../../agents/01-requirement-analyzer/promptTrace';
import { LLMCallTrace } from '../../core/llm/LLMClient';

const STAGE_ID = '01-requirement-analyzer';

function call(stageId: string, promptTokens: number, completionTokens: number, messages = 2): LLMCallTrace {
  const usage = {
    promptTokens, completionTokens, totalTokens: promptTokens + completionTokens,
    estimatedCost: 0.01, estimatedCostUSD: 0.01, estimatedCostINR: 0.9, exchangeRate: 90,
  };
  return {
    stageId, provider: 'gemini', model: 'gemini-3.5-flash', fallback: false,
    startedAt: '2026-09-17T00:00:00.000Z', durationMs: 10,
    request: { temperature: 0, seed: 42, maxTokens: 16384, json: true },
    messages: Array.from({ length: messages }, (_, i) => ({ role: i === 0 ? 'system' : 'user', content: 'x', chars: 1 })),
    responseText: '{}', truncated: false,
    reportedUsage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
    pricingPer1K: { input: 0.001, output: 0.002 },
    usage,
  };
}

function traceInput(calls: LLMCallTrace[]): PromptTraceInput {
  const requirements = 'R'.repeat(600);
  const improvementRules = '[]';
  const resolvedClarifications = '[]';
  return {
    stageId: STAGE_ID, status: 'COMPLETED', projectName: 'Demo', format: 'file', requirementSource: 'req.md',
    originalRequirements: requirements, skillPath: 'skills/requirement-analysis.md', skill: 'S'.repeat(200),
    promptParts: { prompt: `${'I'.repeat(196)}${improvementRules}${resolvedClarifications}${requirements}`, requirements, improvementRules, resolvedClarifications },
    calls,
  };
}

describe('Agent 01 prompt trace', () => {
  it('splits the reported input tokens across prompt sources in proportion to their characters', () => {
    const input = traceInput([call(STAGE_ID, 250, 100)]);
    const { method, rows } = composeInput(input, input.calls[0]);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));

    expect(method).toBe('proportional-to-reported');
    expect(byKey.requirements.chars).toBe(600);
    expect(byKey.skill.estimatedTokens).toBe(50);
    expect(byKey.instructions.chars).toBe(196);
    expect(byKey.requirements.estimatedTokens).toBe(150);
  });

  it('falls back to a characters-per-token estimate when the analysis made no LLM call', () => {
    const { method, rows } = composeInput(traceInput([]));
    expect(method).toBe('chars-per-token-heuristic');
    expect(rows.find((row) => row.key === 'requirements')?.estimatedTokens).toBe(150);
  });

  it('totals only stage calls for the token card and keeps squeeze calls separate', () => {
    const trace = buildPromptTrace(traceInput([
      call(UTILITY_STAGE_ID, 1000, 200),
      call(STAGE_ID, 250, 100),
      call(STAGE_ID, 400, 120, 4),
    ]));

    expect(trace.calls.map((c: any) => c.purpose)).toEqual([
      expect.stringContaining('Context squeeze'),
      'Initial requirement analysis',
      'Story-structure correction round 1',
    ]);
    expect(trace.totals.stage).toMatchObject({ promptTokens: 650, completionTokens: 220, totalTokens: 870 });
    expect(trace.totals.utility).toMatchObject({ promptTokens: 1000, completionTokens: 200 });
    expect(trace.calls[1].costBreakdownUSD).toEqual({ input: 0.00025, output: 0.0002 });
    expect(trace.composition.rows.find((row: any) => row.key === 'skill').estimatedTokens).toBe(50);
  });

  it('records the original text only when the squeezer changed what was sent', () => {
    const input = traceInput([]);
    expect(buildPromptTrace(input).inputs.squeezed).toBe(false);
    const squeezed = buildPromptTrace({ ...input, originalRequirements: 'much longer original' });
    expect(squeezed.inputs).toMatchObject({ squeezed: true, originalRequirements: 'much longer original' });
  });
});
