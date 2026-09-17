import {
  buildStagePromptTrace, composeCallInput, splitMessageSources, StagePromptTraceInput, TraceRecorder, traceLabel,
} from '../../core/llm/stagePromptTrace';
import { LLMCallTrace } from '../../core/llm/LLMClient';

const STAGE_ID = '05-playwright-script-generator';

function call(label: string | undefined, promptTokens: number, completionTokens: number, messages: Array<{ role: string; content: string }>, stageId = STAGE_ID): LLMCallTrace {
  const usage = {
    promptTokens, completionTokens, totalTokens: promptTokens + completionTokens,
    estimatedCost: 0.02, estimatedCostUSD: 0.02, estimatedCostINR: 1.9, exchangeRate: 95,
  };
  return {
    stageId, ...(label ? { label } : {}), provider: 'bedrock', model: 'sonnet', fallback: false,
    startedAt: '2026-09-17T00:00:00.000Z', durationMs: 5,
    request: { temperature: 0, maxTokens: 16384, json: true },
    messages: messages.map((m) => ({ ...m, chars: m.content.length })),
    responseText: '{}', truncated: false,
    reportedUsage: {
      promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, cacheReadTokens: 0, cacheWriteTokens: 0,
    },
    pricingPer1K: { input: 0.003, output: 0.015 },
    usage,
  };
}

function input(overrides: Partial<StagePromptTraceInput>): StagePromptTraceInput {
  return {
    stageId: STAGE_ID, stageName: 'Playwright Script Generator', status: 'COMPLETED', projectName: 'Demo',
    overview: {}, llmUsageNotes: [], sharedInputs: [], groups: [], calls: [], warnings: [], ...overrides,
  };
}

describe('Stage prompt trace', () => {
  it('gives a repeated group key a unique suffix so separate requests are not merged', () => {
    const recorder = new TraceRecorder();
    const first = recorder.group('plan TC-001 step 1', 'Navigation plan', 'a');
    const second = recorder.group('plan TC-001 step 1', 'Navigation plan', 'b');
    expect([first, second]).toEqual(['plan TC-001 step 1', 'plan TC-001 step 1 (2)']);
  });

  it('splits a JSON user payload by its top-level keys, and markdown prompts by "## " sections', () => {
    const json = splitMessageSources('user', `Implement these.\n\n${JSON.stringify({ mode: 'UI', testCases: [{ tcKey: 'TC-001' }] }, null, 2)}`);
    expect(json.map((row) => row.label)).toEqual(['user: Instructions', 'user: JSON "mode"', 'user: JSON "testCases"', 'user: JSON formatting']);
    expect(splitMessageSources('user', 'Intro\n\n## STORY\nx').map((row) => row.label)).toEqual(['user: Instructions', 'user: STORY']);
  });

  it('estimates source shares from the reported input tokens', () => {
    const comp = composeCallInput(call('g #1', 1000, 10, [{ role: 'system', content: 'S'.repeat(300) }, { role: 'user', content: 'U'.repeat(100) }]));
    expect(comp.rows.map((row) => row.estimatedTokens)).toEqual([750, 250]);
  });

  it('attributes calls to groups, totals only this stage and lists each distinct system prompt once', () => {
    const recorder = new TraceRecorder();
    const group = recorder.group('UI bodies F-01', 'UI test bodies', 'F-01 — TC-001');
    recorder.attempt(group, { attempt: 1, summary: '0 of 1 test body valid', errors: ['TC-001: bad'] });
    recorder.attempt(group, { attempt: 2, summary: '1 of 1 test body valid', errors: [] });
    const messages = [{ role: 'system', content: 'contract' }, { role: 'user', content: 'go' }];
    const trace = buildStagePromptTrace(input({
      groups: recorder.groups(),
      calls: [
        call(traceLabel(group, 1), 1000, 400, messages), call(traceLabel(group, 2), 1500, 300, messages),
        call(undefined, 99, 99, messages, '06-automation-reviewer'),
      ],
    }));
    expect(trace.calls.map((c: any) => c.purpose)).toEqual(['UI test bodies: F-01 — TC-001', 'UI test bodies: F-01 — TC-001 — retry 1']);
    expect(trace.groups[0].usage.promptTokens).toBe(2500);
    expect(trace.groups[0].callNumbers).toEqual([1, 2]);
    expect(trace.groups[0].attempts[0].errorCount).toBe(1);
    expect(trace.totals.stage.totalTokens).toBe(3200);
    expect(trace.sharedInputs).toEqual([{ label: 'System prompt — sent on 2 call(s)', content: 'contract' }]);
  });

  it('records a deterministic stage as making no LLM call, with the reason', () => {
    const trace = buildStagePromptTrace(input({ stageId: '04-test-data-generator', noLlmReason: 'Deterministic value policy.' }));
    expect(trace.llmCalled).toBe(false);
    expect(trace.noLlmReason).toBe('Deterministic value policy.');
    expect(trace.totals.stage.totalTokens).toBe(0);
  });
});
