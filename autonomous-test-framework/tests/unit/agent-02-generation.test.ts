import { normalizeAnalysis, NormalizedStory } from '../../agents/02-test-case-generator/analysis/normalizeAnalysis';
import {
  evaluateApiGate, evaluatePerformanceGate, integrationTag,
} from '../../agents/02-test-case-generator/analysis/requirementGates';
import { parseGherkinScenarios } from '../../agents/02-test-case-generator/parsers/GherkinToZephyrParser';
import { validateStoryScenarios, ScenarioContext } from '../../agents/02-test-case-generator/validators/scenarioValidator';
import {
  buildTestCases, computeRequirementCoverage, priorityFor,
} from '../../agents/02-test-case-generator/builders/testCaseBuilder';
import {
  generateStoryScenarios, ChatMessage, extractUnacceptedBlocks, dropUnfinishedScenario,
} from '../../agents/02-test-case-generator/generation/storyGenerator';
import { buildStoryPrompt } from '../../agents/02-test-case-generator/prompts/storyPrompt';
import { filterByActiveTypes, resolveActiveTypeTags } from '../../agents/02-test-case-generator/prompts/systemPrompt';
import { buildGherkinScenarioText } from '../../agents/02-test-case-generator/utils';
import {
  buildGenerationMeta, describeInputChanges, formatInputChanges,
} from '../../agents/02-test-case-generator/generation/generationMeta';
import { isTestCaseSelected, setTestCaseSelected } from '../../core/types';

const rawAnalysis = (overrides: Record<string, any> = {}) => ({
  features: [{
    id: 'F-01',
    name: 'Login Portal',
    riskLevel: 'High',
    userStories: [{
      id: 'US-01',
      title: 'Standard login',
      role: 'user',
      goal: 'log in',
      benefit: 'shop',
      acceptanceCriteria: [
        '[@functional] Valid credentials redirect to /inventory.html.',
        "[@error-handling] Empty username shows 'Epic sadface: Username is required'.",
      ],
      businessRules: ['Username is case-sensitive.'],
      outOfScope: ['30-minute idle session timeout enforcement'],
      integrationPoints: ['INT-01'],
      testability: 'automatable',
      testTypes: ['UI', 'Api'],
      ...overrides,
    }],
  }],
  integrationPoints: [{ id: 'INT-01', name: 'Session', type: 'DATABASE', endpoint: 'N/A' }],
  ambiguities: [],
});

const VALID_GHERKIN = `
@positive @ac-1 @smoke @functional
Scenario: Login with valid credentials redirects to inventory
  Given the user is on the login page
  Then the login form is displayed
  When the user logs in with valid credentials
  And with test data "{{validUsername}}"
  Then the URL is /inventory.html

@negative @ac-2 @br-1 @error-handling
Scenario: Empty username shows the username required error
  Given the user is on the login page
  Then the login form is displayed
  When the user clicks Login with only a password entered
  And with test data "{{validPassword}}"
  Then the error "Epic sadface: Username is required" is displayed
  And the user remains on the login page
`;

/** The fixture documents no edge behaviour, so the shared context runs with @edge deselected. */
const NO_EDGE = ['edge'];

function contextFor(analysis = rawAnalysis(), excluded: string[] = NO_EDGE): ScenarioContext {
  const { features } = normalizeAnalysis(analysis);
  const [feature] = features;
  const [story] = feature.userStories;
  return {
    feature, story, apiGate: evaluateApiGate(story), performanceGate: evaluatePerformanceGate(story), excludedTypeTags: new Set(excluded),
  };
}

const validate = (gherkin: string, ctx = contextFor()) => validateStoryScenarios(parseGherkinScenarios(gherkin), ctx);

describe('Agent 02 — normalizeAnalysis', () => {
  it('normalises casing, criterion ids/categories and integration references', () => {
    const { features, warnings } = normalizeAnalysis(rawAnalysis());
    const story = features[0].userStories[0];
    expect(warnings).toEqual([]);
    expect(features[0].riskLevel).toBe('HIGH');
    expect(story.testTypes).toEqual(['UI', 'API']);
    expect(story.acceptanceCriteria[1]).toEqual({
      id: 'AC-2', category: 'error-handling', text: "Empty username shows 'Epic sadface: Username is required'.",
    });
    expect(story.businessRules[0].id).toBe('BR-1');
    expect(story.integrationPoints[0]).toMatchObject({ id: 'INT-01', type: 'DATABASE' });
  });

  it('skips MANUAL_ONLY stories and defaults unknown risk to MEDIUM', () => {
    const analysis = rawAnalysis({ testability: 'MANUAL_ONLY' });
    analysis.features[0].riskLevel = 'Severe';
    const result = normalizeAnalysis(analysis);
    expect(result.features).toHaveLength(0);
    expect(result.warnings.join('\n')).toMatch(/MANUAL_ONLY/);
    expect(result.warnings.join('\n')).toMatch(/defaulting to MEDIUM/);
  });

  it('skips features with a blocking unresolved ambiguity and surfaces a clarification', () => {
    const analysis: any = rawAnalysis();
    analysis.ambiguities = [{ id: 'AMB-01', featureId: 'F-01', question: 'Is username trimmed?', blockingTestGeneration: true }];
    const result = normalizeAnalysis(analysis);
    expect(result.features).toHaveLength(0);
    expect(result.clarifications).toEqual(['[F-01] Is username trimmed?']);
  });
});

describe('Agent 02 — requirement gates', () => {
  const storyWith = (overrides: Partial<NormalizedStory>): NormalizedStory => ({ ...contextFor().story, ...overrides });
  const restEndpoint = { id: 'INT-02', name: 'Auth API', type: 'REST_API', endpoint: '/api/login' };

  it('closes the API gate when no concrete endpoint is documented', () => {
    expect(evaluateApiGate(contextFor().story).allowed).toBe(false);
  });

  it('opens the API gate for a linked REST endpoint', () => {
    const gate = evaluateApiGate(storyWith({ integrationPoints: [restEndpoint] }));
    expect(gate.allowed).toBe(true);
    expect(gate.integrationPoints).toEqual([restEndpoint]);
  });

  it('requires a quantitative threshold for the performance gate', () => {
    const base = { testTypes: ['PERFORMANCE'], integrationPoints: [restEndpoint] };
    expect(evaluatePerformanceGate(storyWith(base)).allowed).toBe(false);
    const withSla = storyWith({ ...base, acceptanceCriteria: [{ id: 'AC-1', category: '', text: 'Login responds within 500 ms' }] });
    expect(evaluatePerformanceGate(withSla).allowed).toBe(true);
  });

  it('derives stable integration tags', () => {
    expect(integrationTag('INT-01')).toBe('int-01');
    expect(integrationTag('INT001')).toBe('int-001');
  });
});

describe('Agent 02 — strict Gherkin parser', () => {
  it('parses step blocks with test data and multi-line expectations', () => {
    const { scenarios, errors } = parseGherkinScenarios(`\`\`\`gherkin\n${VALID_GHERKIN}\n\`\`\``);
    expect(errors).toEqual([]);
    expect(scenarios).toHaveLength(2);
    expect(scenarios[1].errors).toEqual([]);
    expect(scenarios[1].tags).toEqual(['negative', 'ac-2', 'br-1', 'error-handling']);
    expect(scenarios[1].steps[1]).toEqual({
      keyword: 'When',
      description: 'the user clicks Login with only a password entered',
      testData: '{{validPassword}}',
      expectedResult: 'the error "Epic sadface: Username is required" is displayed\nthe user remains on the login page',
    });
  });

  it.each([
    ['Scenario Outline', '@positive\nScenario Outline: Outline title here\n  Given a\n  Then b\n  When c\n  Then d', /Outline is not allowed/],
    ['Then without action', '@positive\nScenario: Dangling then here\n  Then b\n  Given a\n  Then b\n  When c\n  Then d', /no preceding Given\/When/],
    ['action without Then', '@positive\nScenario: Missing then here\n  Given a\n  When c\n  Then d', /has no Then expected result/],
    ['And continuing an action', '@positive\nScenario: And action here\n  Given a\n  And b\n  Then c\n  When d\n  Then e', /continues an action/],
    ['unexpected text', '@positive\nScenario: Table rows here\n  Given a\n  | x |\n  Then b\n  When c\n  Then d', /unexpected text/],
  ])('reports %s', (_label, gherkin, pattern) => {
    const { scenarios } = parseGherkinScenarios(gherkin);
    expect(scenarios[0].errors.join('\n')).toMatch(pattern);
  });

  it('strips framework key prefixes from titles', () => {
    const { scenarios } = parseGherkinScenarios('@positive\nScenario: [TC-004] Keyed title here\n  Given a\n  Then b\n  When c\n  Then d');
    expect(scenarios[0].title).toBe('Keyed title here');
  });
});

describe('Agent 02 — scenario validator', () => {
  it('accepts grounded scenarios and resolves type, labels and refs', () => {
    const result = validate(VALID_GHERKIN);
    expect(result.errors).toEqual([]);
    expect(result.scenarios.map((s) => s.type)).toEqual(['Positive', 'Negative']);
    expect(result.scenarios[0].labels).toEqual(['Smoke', 'Functional']);
    expect(result.scenarios[1].requirementRefs).toEqual(['AC-2', 'BR-1']);
  });

  it('flags uncovered acceptance criteria', () => {
    const onlyFirst = VALID_GHERKIN.split('@negative')[0];
    expect(validate(onlyFirst).errors.join('\n')).toMatch(/AC-2 .* is not covered/);
  });

  it.each([
    ['unknown requirement ids', VALID_GHERKIN.replace('@br-1', '@br-9'), /unknown requirement id\(s\) BR-9/],
    ['API scenarios when the gate is closed', VALID_GHERKIN.replace('@negative', '@api'), /@api scenarios are not allowed/],
    ['out-of-scope behaviour', VALID_GHERKIN.replace('the user remains on the login page', 'the 30-minute idle session timeout enforcement applies'), /out-of-scope/],
    ['a missing @smoke on HIGH risk', VALID_GHERKIN.replace(' @smoke', ''), /@smoke/],
    ['duplicate titles', VALID_GHERKIN.replace('Empty username shows the username required error', 'Login with valid credentials redirects to inventory'), /duplicates the title/],
    ['malformed placeholders', VALID_GHERKIN.replace('{{validPassword}}', '{{valid password}}'), /must be camelCase/],
    ['unknown tags', VALID_GHERKIN.replace('@functional', '@happy'), /unknown tag/],
  ])('rejects %s', (_label, gherkin, pattern) => {
    expect(validate(gherkin).errors.join('\n')).toMatch(pattern);
  });

  it('drops excluded types with a warning instead of an error', () => {
    const result = validate(VALID_GHERKIN, contextFor(rawAnalysis(), ['negative', 'edge']));
    expect(result.scenarios).toHaveLength(1);
    expect(result.warnings.join('\n')).toMatch(/@negative scenarios are excluded/);
  });
});

describe('Agent 02 — test case builder & rendering', () => {
  const ctx = contextFor();
  const testCases = buildTestCases([{ feature: ctx.feature, story: ctx.story, scenarios: validate(VALID_GHERKIN).scenarios }]);

  it('assigns sequential keys and the lean test case model', () => {
    expect(testCases.map((tc) => tc.key)).toEqual(['TC-001', 'TC-002']);
    expect(testCases[1]).toMatchObject({
      name: 'Empty username shows the username required error',
      objective: 'Verifies AC-2, BR-1: Empty username shows the username required error',
      precondition: 'the user is on the login page',
      priority: 'High',
      featureId: 'F-01',
      userStoryId: 'US-01',
      requirementRefs: ['AC-2', 'BR-1'],
      selected: true,
    });
    ['folder', 'owner', 'status', 'traceabilityLinks', 'automationStatus', 'createdAt'].forEach((key) => {
      expect(testCases[0]).not.toHaveProperty(key);
    });
  });

  it('lowers edge-case priority by one level', () => {
    expect(priorityFor('Edge', 'CRITICAL')).toBe('Medium');
    expect(priorityFor('Negative', 'LOW')).toBe('Low');
  });

  it('round-trips test cases through Gherkin rendering losslessly', () => {
    const reparsed = parseGherkinScenarios(testCases.map(buildGherkinScenarioText).join('\n\n'));
    expect(reparsed.errors).toEqual([]);
    reparsed.scenarios.forEach((scenario, idx) => {
      expect(scenario.errors).toEqual([]);
      expect(scenario.title).toBe(testCases[idx].name);
      expect(scenario.steps).toEqual(testCases[idx].testSteps);
    });
    expect(reparsed.scenarios[1].tags).toEqual(['negative', 'ac-2', 'br-1', 'error-handling', 'tc-002']);
  });

  it('computes requirement coverage', () => {
    expect(computeRequirementCoverage([ctx.feature], testCases)).toEqual({
      acceptanceCriteria: { covered: 2, total: 2 },
      businessRules: { covered: 1, total: 1 },
      uncovered: [],
    });
  });

  it('marks deselected test cases @obsolete and honours legacy flags', () => {
    const tc: any = { ...testCases[0], status: 'OBSOLETE', isObsolete: true };
    expect(isTestCaseSelected(tc)).toBe(false);
    setTestCaseSelected(tc, true);
    expect(isTestCaseSelected(tc)).toBe(true);
    expect(tc).not.toHaveProperty('isObsolete');
    setTestCaseSelected(tc, false);
    expect(buildGherkinScenarioText(tc)).toContain('@obsolete');
  });
});

describe('Agent 02 — self-correction loop', () => {
  const request = (maxRetries: number) => {
    const { feature, story } = contextFor();
    return {
      feature, story, systemPrompt: 'skill', excludedTypeTags: new Set<string>(NO_EDGE), openAmbiguities: [], stateTransitions: [], memoryContext: {}, maxRetries,
    };
  };

  it('retries with validator errors and keeps the corrected output', async () => {
    const calls: ChatMessage[][] = [];
    const responses = [VALID_GHERKIN.split('@negative')[0], VALID_GHERKIN];
    const outcome = await generateStoryScenarios(request(2), async (messages) => {
      calls.push([...messages]);
      return responses[calls.length - 1];
    });
    expect(outcome.attempts).toBe(2);
    expect(outcome.scenarios).toHaveLength(2);
    expect(calls[1].map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(calls[1][3].content).toMatch(/AC-2 .* is not covered/);
    expect(calls[0][1].content).toMatch(/@api: NOT ALLOWED/);
  });

  it('reports unresolved errors as warnings after retries are exhausted', async () => {
    const outcome = await generateStoryScenarios(request(1), async () => VALID_GHERKIN.split('@negative')[0]);
    expect(outcome.attempts).toBe(2);
    expect(outcome.scenarios).toHaveLength(1);
    expect(outcome.warnings.join('\n')).toMatch(/Unresolved after 2 attempt\(s\): AC-2/);
  });

  const POSITIVE = VALID_GHERKIN.split('@negative')[0];
  const NEGATIVE = `@negative${VALID_GHERKIN.split('@negative')[1]}`;
  const POSITIVE_TITLE = 'Login with valid credentials redirects to inventory';

  const runWith = async (responses: string[], maxRetries = 2) => {
    const calls: ChatMessage[][] = [];
    const outcome = await generateStoryScenarios(request(maxRetries), async (messages) => {
      calls.push([...messages]);
      return responses[Math.min(calls.length, responses.length) - 1];
    });
    return { outcome, calls };
  };

  it('keeps accepted scenarios when a retry returns only the missing scenario', async () => {
    const { outcome, calls } = await runWith([POSITIVE, NEGATIVE]);
    expect(outcome.attempts).toBe(2);
    expect(outcome.scenarios.map((s) => s.type)).toEqual(['Positive', 'Negative']);
    expect(outcome.warnings.join('\n')).not.toMatch(/Unresolved/);
    expect(calls[1][3].content).toMatch(/Return ONLY/);
    expect(calls[1][3].content).toContain(`- ${POSITIVE_TITLE}`);
    expect(calls[1][3].content).not.toMatch(/COMPLETE corrected/);
  });

  it('does not double-count an accepted scenario resent under a new title', async () => {
    const renamed = POSITIVE.replace(POSITIVE_TITLE, 'Valid login lands on the inventory page');
    const { outcome } = await runWith([POSITIVE, `${renamed}\n${NEGATIVE}`]);
    expect(outcome.scenarios).toHaveLength(2);
    expect(outcome.warnings.join('\n')).toMatch(/repeats the steps of a scenario accepted in an earlier attempt/);
  });

  it('replaces an accepted scenario resent with the same title without changing the count', async () => {
    const { outcome } = await runWith([VALID_GHERKIN.replace(' @smoke', ''), POSITIVE]);
    expect(outcome.attempts).toBe(2);
    expect(outcome.scenarios).toHaveLength(2);
    expect(outcome.scenarios[0].labels).toContain('Smoke');
    expect(outcome.warnings.join('\n')).not.toMatch(/Unresolved/);
  });
});

describe('Agent 02 — criterion category formats', () => {
  it('parses a trailing "(@tag)" category the same as a "[@tag]" prefix', () => {
    const { features } = normalizeAnalysis(rawAnalysis({
      acceptanceCriteria: ['Valid credentials redirect to /inventory.html (@functional)', '[@ui] The login button stays enabled'],
    }));
    expect(features[0].userStories[0].acceptanceCriteria).toEqual([
      { id: 'AC-1', category: 'functional', text: 'Valid credentials redirect to /inventory.html' },
      { id: 'AC-2', category: 'ui', text: 'The login button stays enabled' },
    ]);
  });
});

describe('Agent 02 — generation metadata', () => {
  const ctx = contextFor();
  const meta = (overrides: Record<string, unknown> = {}) => ({
    ...buildGenerationMeta({
      analyzedRequirements: { inputFingerprint: 'req-fp' },
      normalized: normalizeAnalysis(rawAnalysis()),
      excludedTypeTags: new Set(['performance', 'api']),
      systemPrompt: 'skill',
      memoryContext: {},
      outcomes: [{ feature: ctx.feature, story: ctx.story, scenarios: [], attempts: 2, warnings: [] }],
      modelsUsed: ['model-a'],
    }),
    ...overrides,
  });

  it('records sorted skip options, models and attempts per story', () => {
    expect(meta()).toMatchObject({
      requirementsFingerprint: 'req-fp', excludedTypes: ['api', 'performance'], storyCount: 1, modelsUsed: ['model-a'], attemptsByStory: { 'F-01/US-01': 2 },
    });
    expect(meta().analysisFingerprint).toBe(meta().analysisFingerprint);
  });

  it('names changed inputs, reports identical inputs and handles missing history', () => {
    expect(formatInputChanges(describeInputChanges(meta(), meta()))).toBe('none — inputs identical');
    const previous = meta({ requirementsFingerprint: 'old-fp', excludedTypes: ['api'], modelsUsed: ['model-b'] });
    expect(describeInputChanges(previous, meta())).toEqual(['requirements', 'skip options', 'LLM model']);
    expect(describeInputChanges(undefined, meta())).toBeNull();
    expect(formatInputChanges(null)).toMatch(/no previous generation/);
  });
});

describe('Agent 02 — test type selection', () => {
  const POSITIVE_ONLY = ['negative', 'edge'];
  const POSITIVE = VALID_GHERKIN.split('@negative')[0];
  const NEGATIVE_BLOCK = `@negative${VALID_GHERKIN.split('@negative')[1]}`;
  const MISLABELLED = `
@positive @ac-2 @error-handling
Scenario: Empty username shows the username required error message
  Given the user is on the login page
  Then the login form is displayed
  When the user clicks Login with only a password entered
  Then the error "Epic sadface: Username is required" is displayed
`;

  it('rejects a @positive scenario that asserts a failure outcome', () => {
    const errors = validate(`${POSITIVE}\n${MISLABELLED}`, contextFor(rawAnalysis(), POSITIVE_ONLY)).errors.join('\n');
    expect(errors).toMatch(/tagged @positive but asserts a failure outcome/);
    expect(errors).toMatch(/@negative is EXCLUDED for this run/);
  });

  it('does not treat negated failure wording as a failure outcome', () => {
    const noError = POSITIVE.replace('Then the URL is /inventory.html', 'Then the URL is /inventory.html\n  And no error message is displayed');
    expect(validate(`${noError}\n# UNCOVERED AC-2: @negative`, contextFor(rawAnalysis(), POSITIVE_ONLY)).errors).toEqual([]);
  });

  it('accepts a declared UNCOVERED criterion that only an excluded type can verify', () => {
    const result = validate(`${POSITIVE}\n# UNCOVERED AC-2: @negative`, contextFor(rawAnalysis(), POSITIVE_ONLY));
    expect(result.errors).toEqual([]);
    expect(result.scenarios.map((s) => s.type)).toEqual(['Positive']);
    expect(result.warnings.join('\n')).toMatch(/AC-2 .* not covered: requires @negative \(excluded for this run\)/);
  });

  it('keeps an undeclared or selected-type declaration as an error with a hint', () => {
    const ctx = contextFor(rawAnalysis(), POSITIVE_ONLY);
    expect(validate(POSITIVE, ctx).errors.join('\n')).toMatch(/AC-2 .* is not covered .*# UNCOVERED AC-2: @<type>/);
    expect(validate(`${POSITIVE}\n# UNCOVERED AC-2: @positive`, ctx).errors.join('\n')).toMatch(/AC-2 .* is not covered/);
  });

  it('requires at least one scenario of every selected type', () => {
    expect(validate(VALID_GHERKIN, contextFor(rawAnalysis(), [])).errors.join('\n')).toMatch(/no @edge scenario/);
    expect(validate(VALID_GHERKIN, contextFor(rawAnalysis(), ['negative'])).errors.join('\n')).toMatch(/no @edge scenario/);
    expect(validate(VALID_GHERKIN).errors.join('\n')).not.toMatch(/no @\w+ scenario/);
  });

  it('caps scenarios per type per story, but never below the story criteria count', () => {
    process.env.AGENT02_MAX_TC_PER_TYPE = '1';
    try {
      const second = POSITIVE.replace('Login with valid credentials redirects to inventory', 'Second valid login lands on the inventory page')
        .replace('the user logs in with valid credentials', 'the user logs in again with valid credentials');
      const oneCriterion = contextFor(rawAnalysis({ acceptanceCriteria: ['[@functional] Valid credentials redirect to /inventory.html.'], businessRules: [] }));
      const capped = validate(`${POSITIVE}\n${second}`, oneCriterion);
      expect(capped.scenarios.map((s) => s.type)).toEqual(['Positive']);
      expect(capped.warnings.join('\n')).toMatch(/exceeds the limit of 1 Positive scenarios per story/);

      expect(validate(`${VALID_GHERKIN}\n${second}`).scenarios.map((s) => s.type)).toEqual(['Positive', 'Negative', 'Positive']);
    } finally {
      delete process.env.AGENT02_MAX_TC_PER_TYPE;
    }
  });

  it('discards the unfinished last scenario of a truncated answer and asks to continue', async () => {
    const { feature, story } = contextFor();
    const calls: ChatMessage[][] = [];
    const cutOff = `${POSITIVE}\n@negative @ac-2\nScenario: Empty username shows the username req`;
    const replies = [{ text: cutOff, truncated: true }, { text: NEGATIVE_BLOCK }];
    const outcome = await generateStoryScenarios({
      feature, story, systemPrompt: 'skill', excludedTypeTags: new Set(NO_EDGE), openAmbiguities: [], stateTransitions: [], memoryContext: {}, maxRetries: 2,
    }, async (messages) => {
      calls.push([...messages]);
      return replies[calls.length - 1];
    });
    expect(dropUnfinishedScenario(cutOff).trim()).toBe(POSITIVE.trim());
    expect(outcome.scenarios.map((s) => s.type)).toEqual(['Positive', 'Negative']);
    expect(calls[1][3].content).toMatch(/^Your previous output was cut off at the output token limit/);
  });

  it('never persists negatives in a positive-only run, even across retries', async () => {
    const { feature, story } = contextFor();
    const calls: ChatMessage[][] = [];
    const responses = [VALID_GHERKIN, `${POSITIVE}\n# UNCOVERED AC-2: @negative`];
    const outcome = await generateStoryScenarios({
      feature, story, systemPrompt: 'skill', excludedTypeTags: new Set(POSITIVE_ONLY), openAmbiguities: [], stateTransitions: [], memoryContext: {}, maxRetries: 2,
    }, async (messages) => {
      calls.push([...messages]);
      return responses[calls.length - 1];
    });
    expect(outcome.attempts).toBe(2);
    expect(outcome.scenarios.map((s) => s.type)).toEqual(['Positive']);
    expect(outcome.warnings.join('\n')).not.toMatch(/Unresolved/);
    expect(calls[0][1].content).toMatch(/Selected types: @positive\n- EXCLUDED for this run: @negative @edge/);
    expect(calls[0][1].content).toMatch(/# UNCOVERED AC-N/);
    expect(calls[1][2].content).not.toContain('Login with valid credentials redirects to inventory');
    expect(calls[1][2].content).not.toContain('@negative');
    expect(calls[1][3].content).toMatch(/EXCLUDED types: @negative @edge/);
    expect(calls[1][3].content).toMatch(/contained 1 @negative scenario\(s\); they were discarded/);
  });
});

describe('Agent 02 — prompt token trimming', () => {
  it('sends only the failing, non-excluded scenario blocks back on retry', () => {
    const text = `\`\`\`gherkin\n${VALID_GHERKIN}\n@edge @ac-1\nScenario: [TC-009] Edge block title here\n  Given a\n  Then b\n# UNCOVERED AC-1: @edge\n\`\`\``;
    const reduced = extractUnacceptedBlocks(text, ['Login with valid credentials redirects to inventory'], new Set(['edge']));
    expect(reduced).toMatch(/^@negative @ac-2 @br-1 @error-handling\nScenario: Empty username/);
    expect(reduced).not.toMatch(/Login with valid credentials|Edge block|UNCOVERED|```/);
  });

  it('strips type-scoped lines and blocks for inactive types', () => {
    const markdown = ['keep', 'api row | <!-- type:api -->', 'neg row <!-- type:negative,edge -->', '<!-- type:edge -->', 'edge block', '<!-- /type -->', 'tail'].join('\n');
    expect(filterByActiveTypes(markdown, new Set(['positive', 'negative']))).toBe('keep\nneg row\ntail');
    expect(filterByActiveTypes(markdown, new Set(['positive']))).toBe('keep\ntail');
  });

  it('activates API/performance guidance only when a story gate is open and the type is selected', () => {
    const { features } = normalizeAnalysis(rawAnalysis());
    expect([...resolveActiveTypeTags(features, new Set(['edge']))]).toEqual(['positive', 'negative']);
  });

  it('applies memory rules scoped to ALL stages', () => {
    const ctx = contextFor();
    const prompt = buildStoryPrompt({
      ...ctx,
      openAmbiguities: [],
      stateTransitions: [],
      memoryContext: { improvementRules: [{ appliesTo: 'ALL', description: 'Quote messages verbatim' }, { appliesTo: '05-x', description: 'Other stage' }] },
    });
    expect(prompt).toContain('- Rule: Quote messages verbatim');
    expect(prompt).not.toContain('Other stage');
  });
});
