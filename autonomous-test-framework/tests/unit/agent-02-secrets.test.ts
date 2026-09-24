/**
 * @fileoverview Unit tests for Agent 02's secret guardrails and for writing feature files only after approval.
 */

import { KnownSecret, replaceSecrets, secretsIn } from '../../core/aut/knownSecrets';
import { normalizeAnalysis, redactNormalizedAnalysis } from '../../agents/02-test-case-generator/analysis/normalizeAnalysis';
import { evaluateApiGate, evaluatePerformanceGate } from '../../agents/02-test-case-generator/analysis/requirementGates';
import { parseGherkinScenarios } from '../../agents/02-test-case-generator/parsers/GherkinToZephyrParser';
import { validateStoryScenarios } from '../../agents/02-test-case-generator/validators/scenarioValidator';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { stateManager } from '../../core/state-manager/StateManager';
import { syncFeatureFiles } from '../../agents/02-test-case-generator/utils';
import { TestCaseGeneratorAgent } from '../../agents/02-test-case-generator/agent';

jest.mock('../../core/llm/LLMClient', () => ({ llmClient: { chat: jest.fn(), getStageUsage: jest.fn(), getStageModels: jest.fn(() => []) } }));
jest.mock('../../core/approval-gate/ApprovalGate', () => ({ approvalGate: { waitForApproval: jest.fn() } }));
jest.mock('../../core/project-memory/MemoryEngine', () => ({ memoryEngine: { recordApprovalFeedback: jest.fn() } }));
jest.mock('../../agents/02-test-case-generator/utils', () => ({ syncFeatureFiles: jest.fn(() => ['features/Login/Login Feature- App.feature']) }));

const PASSWORD = 'Sample#Pass9';
const EMAIL = 'qa.user@example.test';
const secrets: KnownSecret[] = [
  { value: EMAIL, placeholder: '{{validEmail}}' },
  { value: PASSWORD, placeholder: '{{validPassword}}' },
];

const analysis = () => ({
  features: [{
    id: 'F-01',
    name: 'Login',
    riskLevel: 'Low',
    userStories: [{
      id: 'US-01',
      title: 'Sign in',
      acceptanceCriteria: [`[@functional] Signing in as ${EMAIL} / ${PASSWORD} opens the dashboard.`],
      businessRules: [],
      outOfScope: [],
      testDataValues: [
        { name: 'validPassword', value: PASSWORD, sourceRef: 'AC-1', sensitive: false },
        { name: 'productName', value: 'Widget', sourceRef: 'AC-1', sensitive: false },
      ],
    }],
  }],
  ambiguities: [{ id: 'AMB-01', featureId: 'F-01', question: `Does ${PASSWORD} expire?`, blockingTestGeneration: false }],
});

const scenario = (step: string) => `
@positive @ac-1 @functional
Scenario: Signing in with valid credentials opens the dashboard
  Given the user is on the sign-in page
  Then the sign-in form is displayed
  When ${step}
  Then the dashboard is displayed
`;

describe('Agent 02 — secrets', () => {
  it('replaces the longest secret first and reports secrets by placeholder only', () => {
    const nested: KnownSecret[] = [{ value: 'abcd', placeholder: '{{short}}' }, { value: 'abcd-efgh', placeholder: '{{long}}' }];
    expect(replaceSecrets('key abcd-efgh and abcd', nested)).toBe('key {{long}} and {{short}}');
    expect(secretsIn(`as ${EMAIL} with ${PASSWORD}`, secrets)).toEqual(['{{validEmail}}', '{{validPassword}}']);
  });

  it('strips secrets from the stories before they reach the prompt, even from an analysis that predates redaction', () => {
    const normalized = normalizeAnalysis(analysis());
    // The criterion, the ambiguity question and the test data value.
    expect(redactNormalizedAnalysis(normalized, secrets)).toBe(3);
    const [story] = normalized.features[0].userStories;
    expect(story.acceptanceCriteria[0].text).toBe('Signing in as {{validEmail}} / {{validPassword}} opens the dashboard.');
    expect(story.testData).toEqual([
      { name: 'validPassword', sourceRef: 'AC-1', sensitive: false },
      { name: 'productName', value: 'Widget', sourceRef: 'AC-1', sensitive: false },
    ]);
    expect(normalized.openAmbiguities[0].question).toBe('Does {{validPassword}} expire?');
    expect(JSON.stringify(normalized)).not.toContain(PASSWORD);
  });

  it('rejects a scenario that writes out a secret, naming the placeholder and never the value', () => {
    // As in the agent: the stories are redacted before generation, so no message quoting a criterion can carry a secret.
    const normalized = normalizeAnalysis(analysis());
    redactNormalizedAnalysis(normalized, secrets);
    const [feature] = normalized.features;
    const [story] = feature.userStories;
    const ctx = {
      feature, story, apiGate: evaluateApiGate(story), performanceGate: evaluatePerformanceGate(story),
      excludedTypeTags: new Set(['negative', 'edge']), secrets,
    };
    const leaked = validateStoryScenarios(parseGherkinScenarios(scenario(`the user signs in with the password "${PASSWORD}"`)), ctx);
    expect(leaked.scenarios).toEqual([]);
    expect(leaked.errors).toEqual(expect.arrayContaining([expect.stringMatching(/writes out the value of \{\{validPassword\}\} — write \{\{validPassword\}\} instead/)]));
    expect(JSON.stringify(leaked.errors)).not.toContain(PASSWORD);

    const clean = validateStoryScenarios(parseGherkinScenarios(scenario('the user signs in with {{validEmail}} and {{validPassword}}')), ctx);
    expect(clean.errors).toEqual([]);
    expect(clean.scenarios).toHaveLength(1);
  });
});

describe('Agent 02 — feature files are written only after approval', () => {
  const agent: any = new TestCaseGeneratorAgent();
  const waitForApproval = approvalGate.waitForApproval as jest.Mock;
  const sync = syncFeatureFiles as jest.Mock;
  const generated = [{ key: 'TC-001', name: 'Generated' }];
  const edited = [{ key: 'TC-001', name: 'Edited in the review UI' }];
  const output = { zephyrExport: { totalTestCases: 1, testCases: generated, generationMeta: {} } };
  const generation = {
    testCases: generated, warnings: [], clarifications: [],
    coverage: { acceptanceCriteria: { covered: 1, total: 1 }, businessRules: { covered: 0, total: 0 }, uncovered: [] },
    meta: { excludedTypes: [], modelsUsed: [] }, inputChanges: null,
  };

  beforeEach(() => {
    sync.mockClear();
    jest.spyOn(stateManager, 'getPipelineArtifact').mockResolvedValue({ zephyrExport: { testCases: edited } });
    jest.spyOn(stateManager, 'getProjectId').mockReturnValue('sample');
  });
  afterEach(() => jest.restoreAllMocks());

  it('writes nothing while the gate is open, and the stored (possibly edited) test cases once approved', async () => {
    waitForApproval.mockImplementation(async () => {
      expect(sync).not.toHaveBeenCalled();
      return { status: 'APPROVED', comment: '' };
    });
    await agent._awaitApproval(output, generation, { features: [] }, {}, 1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0][2]).toEqual(edited);
    expect(waitForApproval.mock.calls[0][0].summary['Feature Files']).toBe('written after approval');
  });

  it('writes nothing when the test cases are rejected', async () => {
    waitForApproval.mockResolvedValue({ status: 'REJECTED', comment: 'Too many edge cases' });
    await agent._awaitApproval(output, generation, { features: [] }, {}, 1);
    expect(sync).not.toHaveBeenCalled();
  });
});
