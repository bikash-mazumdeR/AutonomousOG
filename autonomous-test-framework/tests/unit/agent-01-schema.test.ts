/**
 * @fileoverview Unit tests for Agent 01's output schema check and its place in the correction round.
 */

import { MAX_REPORTED_ISSUES, issuesForPrompt, validateAnalysisSchema } from '../../agents/01-requirement-analyzer/analysisSchema';
import { fixTestDataSourceRefs } from '../../agents/01-requirement-analyzer/analysisQuality';
import { llmClient } from '../../core/llm/LLMClient';
import { RequirementAnalyzerAgent } from '../../agents/01-requirement-analyzer/agent';

jest.mock('../../core/llm/LLMClient', () => ({ llmClient: { chat: jest.fn(), getStageUsage: jest.fn() } }));

const story = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, title: `Story ${id}`, acceptanceCriteria: ['[@functional] The user can sign in'], ...overrides,
});
const valid = () => ({
  features: [{ id: 'F-01', name: 'Login', userStories: [story('US-01', { acceptanceCriteria: ['[@functional] The user can sign in as a@b.test'], testDataValues: [{ name: 'validEmail', value: 'a@b.test', sourceRef: 'AC-1', sensitive: false }] })] }],
  integrationPoints: [{ id: 'IP-01', name: 'Database' }],
  ambiguities: [{ featureId: 'F-01', userStoryId: 'US-01', category: 'TEST_VALUE', question: 'What is the maximum length?', blockingTestGeneration: false }],
});

describe('Agent 01 output schema', () => {
  it('accepts an analysis in the required format, extra fields included', () => {
    expect(validateAnalysisSchema({ ...valid(), totalFeatures: 1, recommendations: ['x'] })).toEqual([]);
  });

  it('reports each violation with its path', () => {
    const raw: any = valid();
    raw.features[0].userStories.push(story('US-02', { acceptanceCriteria: ['The user can sign out (@functional)'] }), story('US-03', { acceptanceCriteria: [] }));
    raw.features[0].userStories[0].testDataValues[0].sourceRef = 'Step 2';
    raw.ambiguities[0].category = 'GUESS';
    delete raw.features[0].name;
    expect(validateAnalysisSchema(raw)).toEqual([
      'Schema: features[0].name is required',
      'Schema: features[0].userStories[0].testDataValues[0].sourceRef must be "AC-n", "BR-n" or "CLARIFICATION"',
      'Schema: features[0].userStories[1].acceptanceCriteria[0] must start with exactly one category prefix such as [@functional]',
      'Schema: features[0].userStories[2].acceptanceCriteria must list at least one acceptance criterion',
      expect.stringMatching(/^Schema: ambiguities\[0\]\.category must be one of REQUIREMENT, /),
    ]);
  });

  it('accepts a test value traced to a clarification answer, and does not look for it in the criteria', () => {
    const raw: any = valid();
    raw.features[0].userStories[0].testDataValues.push({ name: 'adminEmail', value: 'admin@b.test', sourceRef: 'CLARIFICATION', sensitive: false });
    expect(validateAnalysisSchema(raw)).toEqual([]);
    expect(fixTestDataSourceRefs(raw)).toEqual([]);
  });

  it('reports duplicate ids and ambiguities about features or stories the analysis does not have', () => {
    const raw: any = valid();
    raw.features[0].userStories.push(story('US-01'));
    raw.ambiguities.push({ featureId: 'F-09', userStoryId: 'US-07', category: 'REQUIREMENT', question: 'Which one?' });
    expect(validateAnalysisSchema(raw)).toEqual([
      'Schema: user story id "US-01" is used more than once',
      'Schema: ambiguities[1].featureId "F-09" is not a feature of the analysis',
      'Schema: ambiguities[1].userStoryId "US-07" is not a user story of the analysis',
    ]);
  });

  it('reports an empty analysis instead of throwing on anything', () => {
    expect(validateAnalysisSchema({})).toEqual(['Schema: features is required']);
    expect(validateAnalysisSchema(null)).toEqual([expect.stringMatching(/^Schema: analysis /)]);
  });

  it('caps the issues put in one correction prompt', () => {
    const many = Array.from({ length: MAX_REPORTED_ISSUES + 5 }, (_, i) => `Schema: issue ${i}`);
    const listed = issuesForPrompt(many);
    expect(listed).toHaveLength(MAX_REPORTED_ISSUES + 1);
    expect(listed[MAX_REPORTED_ISSUES]).toBe('… and 5 more issue(s) of the same kinds.');
  });
});

describe('Agent 01 schema issues in the correction round', () => {
  const agent: any = new RequirementAnalyzerAgent();
  const chat = llmClient.chat as jest.Mock;
  afterEach(() => chat.mockReset());

  it('sends format violations back once and reports what the correction did not fix', async () => {
    const broken: any = valid();
    broken.features[0].userStories[0].acceptanceCriteria = ['The user can sign in as a@b.test'];
    chat.mockResolvedValueOnce({ text: JSON.stringify(broken), usage: {} }).mockResolvedValueOnce({ text: JSON.stringify(valid()), usage: {} });
    const fixed = await agent._performLLMAnalysis('Login requirement', 'Demo', {});
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][1].messages[3].content).toMatch(/REQUIRED JSON OUTPUT FORMAT:\n1\. Schema: features\[0\]\.userStories\[0\]\.acceptanceCriteria\[0\] must start/);
    expect(fixed.analysisWarnings).toEqual([]);

    chat.mockReset();
    chat.mockResolvedValue({ text: JSON.stringify(broken), usage: {} });
    const unfixed = await agent._performLLMAnalysis('Login requirement', 'Demo', {});
    expect(unfixed.analysisWarnings).toEqual(['Schema: features[0].userStories[0].acceptanceCriteria[0] must start with exactly one category prefix such as [@functional]']);
  });

  it('refuses to save an analysis with no features even after the correction round', async () => {
    chat.mockResolvedValue({ text: JSON.stringify({ features: [], ambiguities: [] }), usage: {} });
    await expect(agent._performLLMAnalysis('Login requirement', 'Demo', {})).rejects.toThrow(/contains no features, even after a correction round.*features must contain at least one feature/);
    expect(chat).toHaveBeenCalledTimes(2);
  });
});

describe('Agent 01 grounding source', () => {
  it('grounds the analysis in the document and in answers to Agent 01 questions, not in answers owned by other stages', () => {
    const agent: any = new RequirementAnalyzerAgent();
    const source = agent._groundingSource('The document', {
      resolvedClarifications: [
        { stageId: '01-requirement-analyzer', question: 'Which URL?', answer: 'https://app.example.test/login' },
        { stageId: '04-test-data-generator', question: 'Which name?', answer: 'Data-stage answer' },
      ],
    });
    expect(source).toContain('https://app.example.test/login');
    expect(source).not.toContain('Data-stage answer');
  });
});
