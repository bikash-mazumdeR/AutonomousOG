import {
  buildPromptTrace, composeStoryInput, PromptTraceInput, splitPromptSections,
} from '../../agents/02-test-case-generator/generation/promptTrace';
import { assertTestCasesGenerated } from '../../agents/02-test-case-generator/generation/emptyResultGuard';
import { generateStoryScenarios, ChatMessage } from '../../agents/02-test-case-generator/generation/storyGenerator';
import { normalizeAnalysis } from '../../agents/02-test-case-generator/analysis/normalizeAnalysis';
import { STEP_GRAMMAR_RULES } from '../../agents/02-test-case-generator/prompts/storyPrompt';
import { LLMCallTrace } from '../../core/llm/LLMClient';

const STAGE_ID = '02-test-case-generator';

function call(label: string, promptTokens: number, completionTokens: number, cache = { read: 0, write: 0 }): LLMCallTrace {
  const usage = {
    promptTokens, completionTokens, totalTokens: promptTokens + completionTokens,
    estimatedCost: 0.01, estimatedCostUSD: 0.01, estimatedCostINR: 0.9, exchangeRate: 90,
  };
  return {
    stageId: STAGE_ID, label, provider: 'bedrock', model: 'sonnet', fallback: false,
    startedAt: '2026-09-17T00:00:00.000Z', durationMs: 10,
    request: { temperature: 0, seed: 42, maxTokens: 8192 },
    messages: [{ role: 'system', content: 'S', chars: 1 }, { role: 'user', content: 'U', chars: 1 }],
    responseText: 'Scenario: x', truncated: false,
    reportedUsage: {
      promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, cacheReadTokens: cache.read, cacheWriteTokens: cache.write,
    },
    pricingPer1K: { input: 0.003, output: 0.015 },
    usage,
  };
}

const USER_PROMPT = `Generate scenarios for one story.\n\n## STORY\n${'s'.repeat(300)}\n\n## OUTPUT\n${'o'.repeat(100)}`;

function traceInput(calls: LLMCallTrace[]): PromptTraceInput {
  return {
    stageId: STAGE_ID, status: 'FAILED', error: 'No valid test case', projectName: 'Demo', excludedTypes: ['api'],
    skillPath: 'skills/test-case-generation.md', systemPrompt: 'S'.repeat(600),
    memory: { improvementRules: [], rejectionFeedback: [] },
    stories: [
      {
        key: 'F-01/US-01', title: 'Login', acceptanceCriteria: 2, businessRules: 1, userPrompt: USER_PROMPT, scenariosAccepted: 0,
        attemptLog: [{
          attempt: 1, truncated: false, parsedScenarios: 1, acceptedTotal: 0, errors: ['Scenario "x" (line 2): Scenario has no When action'],
        }],
      },
      {
        key: 'F-01/US-02', title: 'Logout', acceptanceCriteria: 1, businessRules: 0, userPrompt: USER_PROMPT, scenariosAccepted: 2, attemptLog: [],
      },
    ],
    testCaseCount: 2,
    warnings: [],
    calls,
  };
}

describe('Agent 02 prompt trace', () => {
  it('splits a story prompt into its instruction preamble and "## SECTION" blocks', () => {
    expect(splitPromptSections(USER_PROMPT).map((section) => section.label)).toEqual(['Instructions', 'STORY', 'OUTPUT']);
  });

  it('estimates each source share from all processed input tokens, prompt-cache reads and writes included', () => {
    const comp = composeStoryInput('S'.repeat(600), USER_PROMPT, call('F-01/US-01 #1', 100, 50, { read: 700, write: 200 }));
    expect(comp.method).toBe('proportional-to-reported');
    expect(comp.basisTokens).toBe(1000);
    expect(comp.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
    expect(comp.rows[0].label).toMatch(/System prompt/);
  });

  it('attributes labelled calls to their story and attempt, and totals the stage', () => {
    const trace = buildPromptTrace(traceInput([
      call('F-01/US-01 #1', 1000, 400), call('F-01/US-02 #1', 900, 300), call('F-01/US-01 #2', 1600, 200),
    ]));
    const [login, logout] = trace.stories;
    expect(login.usage.promptTokens).toBe(2600);
    expect(logout.usage.promptTokens).toBe(900);
    expect(login.attempts[0].errorCount).toBe(1);
    expect(trace.calls.map((c: any) => c.purpose)).toEqual([
      'F-01/US-01 — initial scenario generation', 'F-01/US-02 — initial scenario generation', 'F-01/US-01 — self-correction round 1',
    ]);
    expect(trace.totals.stage.totalTokens).toBe(4400);
    expect(trace.calls[0].costBreakdownUSD.input).toBeCloseTo(0.003);
  });
});

describe('Agent 02 empty-result guard', () => {
  const unresolved = '[F-01/US-01] Unresolved after 3 attempt(s): Scenario "x" (line 2): Scenario has no When action';

  it('fails a run whose generated stories yielded no valid scenario, quoting the validation errors', () => {
    expect(() => assertTestCasesGenerated({ testCases: [], warnings: [unresolved, unresolved], meta: { storyCount: 1 } }))
      .toThrow(/previous test cases and feature files were kept\. 1 validation error\(s\); first:\n- Scenario "x" \(line 2\): Scenario has no When action/);
  });

  it('lets through runs with test cases and runs with no generatable story', () => {
    expect(() => assertTestCasesGenerated({ testCases: [{} as any], warnings: [], meta: { storyCount: 1 } })).not.toThrow();
    expect(() => assertTestCasesGenerated({ testCases: [], warnings: [], meta: { storyCount: 0 } })).not.toThrow();
  });
});

describe('Agent 02 attempt log', () => {
  const analysis = normalizeAnalysis({
    features: [{
      id: 'F-01', name: 'Login', riskLevel: 'Low',
      userStories: [{ id: 'US-01', title: 'Login', acceptanceCriteria: ['Valid credentials open /inventory.html.'] }],
    }],
  });
  const [feature] = analysis.features;
  const [story] = feature.userStories;

  /** Conventional Gherkin — a setup Given with no Then — is what the model wrote when every scenario was rejected. */
  const CONVENTIONAL = `@positive @ac-1 @smoke
Scenario: Login with valid credentials opens the inventory page
  Given the user is on the login page
  When the user logs in with valid credentials
  Then the URL is /inventory.html`;
  const STRICT = `@positive @ac-1 @smoke
Scenario: Login with valid credentials opens the inventory page
  Given the user is on the login page
  Then the login form is displayed
  When the user logs in with valid credentials
  Then the URL is /inventory.html`;

  it('records each attempt, and repeats the step grammar first in the retry prompt after a grammar error', async () => {
    const sent: ChatMessage[][] = [];
    const replies = [CONVENTIONAL, STRICT];
    const outcome = await generateStoryScenarios({
      feature, story, systemPrompt: 'skill', excludedTypeTags: new Set(['negative', 'edge', 'api', 'performance']),
      openAmbiguities: [], stateTransitions: [], memoryContext: {}, maxRetries: 2,
    }, async (messages) => { sent.push([...messages]); return replies[sent.length - 1]; });

    expect(outcome.userPrompt).toContain(STEP_GRAMMAR_RULES[0]);
    expect(outcome.attemptLog.map((a) => [a.attempt, a.parsedScenarios, a.acceptedTotal])).toEqual([[1, 1, 0], [2, 1, 1]]);
    expect(outcome.attemptLog[0].errors.some((e) => /has no Then expected result/.test(e))).toBe(true);
    expect(outcome.attemptLog[1].errors).toEqual([]);
    expect(sent[1][sent[1].length - 1].content.startsWith('1 issue(s) below break the step grammar')).toBe(true);
  });
});
