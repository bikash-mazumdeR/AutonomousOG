/**
 * @fileoverview Unit tests for Agent 01's deterministic analysis quality checks and truncation handling.
 */

import {
  assessAnalysisQuality, checkStoryStructure, detectSourceStories, findDuplicateCriteria, fixTestDataSourceRefs,
} from '../../agents/01-requirement-analyzer/analysisQuality';
import { llmClient } from '../../core/llm/LLMClient';
import { RequirementAnalyzerAgent } from '../../agents/01-requirement-analyzer/agent';

jest.mock('../../core/llm/LLMClient', () => ({ llmClient: { chat: jest.fn(), getStageUsage: jest.fn() } }));

const DOCUMENT = `# Swag Labs Login Page
## 1. User Story
### Story ID: SL-AUTH-001
### Title: User Authentication via Login Page
**As a** user of the Swag Labs application
**I want to** authenticate using my username and password credentials
**So that** I can access the inventory catalog
## 2. Functional Requirements
#### 2.3.1 Successful Authentication
#### 2.3.2 Failed Authentication - Invalid Credentials
#### 2.3.3 Failed Authentication - Locked Out Account`;

const story = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, title: id, acceptanceCriteria: ['[@functional] placeholder criterion'], businessRules: [], testDataValues: [], ...overrides,
});
const reportWith = (...userStories: any[]) => ({ features: [{ id: 'F-01', userStories }] });

describe('Agent 01 — source user stories', () => {
  it('finds explicit story ids and ignores numbered flows', () => {
    expect(detectSourceStories(DOCUMENT)).toEqual([{ id: 'SL-AUTH-001' }]);
  });

  it('falls back to "As a … I want …" narratives when no story id is written', () => {
    const narratives = 'As a shopper\nI want to add items\n\nSome text\n\nAs an admin I want to remove items';
    expect(detectSourceStories(narratives)).toHaveLength(2);
    expect(detectSourceStories('# Login\nUsers log in with a username and password.')).toEqual([]);
  });

  it('flags an analysis that split one documented story into several', () => {
    const split = reportWith(...['US-01', 'US-02', 'US-03', 'US-04', 'US-05'].map((id) => story(id)));
    const issues = checkStoryStructure(split, detectSourceStories(DOCUMENT));
    expect(issues.join('\n')).toMatch(/defines 1 user story \(SL-AUTH-001\) but the analysis has 5/);
    expect(issues.join('\n')).toMatch(/No user story carries "sourceStoryId" for: SL-AUTH-001/);
  });

  it('accepts one story per documented story carrying its source id, and documents without stories', () => {
    expect(checkStoryStructure(reportWith(story('US-01', { sourceStoryId: 'SL-AUTH-001' })), detectSourceStories(DOCUMENT))).toEqual([]);
    expect(checkStoryStructure(reportWith(story('US-01'), story('US-02')), [])).toEqual([]);
    expect(checkStoryStructure(reportWith(story('US-01', { sourceStoryId: 'SL-AUTH-999' })), detectSourceStories(DOCUMENT)).join('\n'))
      .toMatch(/not defined in the document: SL-AUTH-999/);
  });
});

describe('Agent 01 — test data traceability and duplicates', () => {
  it('points sourceRef at the criterion or rule that contains the value', () => {
    const report = reportWith(story('US-01', {
      acceptanceCriteria: ['[@ui] The page works at 375px width.', '[@ui] The page works at 1920px width.'],
      businessRules: ['All accounts use the password shown on the page.'],
      testDataValues: [
        { name: 'mobileViewportWidth', value: '375px', sourceRef: 'AC-2', sensitive: false },
        { name: 'desktopViewportWidth', value: '1920px', sourceRef: 'AC-2', sensitive: false },
        { name: 'password', sourceRef: 'AC-9', sensitive: true },
        { name: 'unknownValue', value: 'ghost_user', sourceRef: 'AC-1', sensitive: false },
      ],
    }));
    const warnings = fixTestDataSourceRefs(report);
    const values = report.features[0].userStories[0].testDataValues;
    expect(values.map((v: any) => v.sourceRef)).toEqual(['AC-1', 'AC-2', 'AC-9', 'AC-1']);
    expect(warnings).toEqual([
      expect.stringMatching(/mobileViewportWidth" referenced AC-2 but "375px" appears in AC-1 — corrected/),
      expect.stringMatching(/"ghost_user" does not appear in any acceptance criterion/),
    ]);
  });

  it('reports criteria repeated within or across stories, ignoring category and punctuation', () => {
    const report = reportWith(
      story('US-01', { acceptanceCriteria: ['[@security] The password field masks all characters.'] }),
      story('US-02', { acceptanceCriteria: ['[@ui] The Password field masks all characters', '[@ui] Something else'] }),
    );
    expect(findDuplicateCriteria(report)).toEqual([expect.stringMatching(/^US-02 AC-1 repeats US-01 AC-1/)]);
  });

  it('combines structural issues and warnings', () => {
    const quality = assessAnalysisQuality(reportWith(story('US-01'), story('US-02')), DOCUMENT);
    expect(quality.issues.length).toBeGreaterThan(0);
    expect(quality.warnings).toEqual([expect.stringMatching(/^US-02 AC-1 repeats US-01 AC-1/)]);
  });
});

describe('Agent 01 — incomplete LLM output is never saved', () => {
  const agent: any = new RequirementAnalyzerAgent();
  const chat = llmClient.chat as jest.Mock;
  const validReport = JSON.stringify({ features: [{ id: 'F-01', userStories: [story('US-01', { sourceStoryId: 'SL-AUTH-001' })] }], ambiguities: [] });

  afterEach(() => chat.mockReset());

  it('refuses a response cut off at the output token limit', async () => {
    chat.mockResolvedValue({ text: '{"features": [', truncated: true, usage: { completionTokens: 4200 } });
    await expect(agent._performLLMAnalysis(DOCUMENT, 'Demo', {})).rejects.toThrow(/cut off at the model's output token limit after 4200 tokens/);
  });

  it('does not auto-close unfinished JSON', () => {
    expect(() => agent._repairAndParseJson('{"features": [{"id": "F-01"')).toThrow();
    expect(agent._repairAndParseJson('```json\n{"a": [1,],}\n```')).toEqual({ a: [1] });
  });

  it('asks once for a corrected story structure and reports what is still wrong', async () => {
    const split = JSON.stringify({ features: [{ id: 'F-01', userStories: [story('US-01'), story('US-02')] }], ambiguities: [] });
    chat.mockResolvedValueOnce({ text: split, usage: {} }).mockResolvedValueOnce({ text: validReport, usage: {} });
    const report = await agent._performLLMAnalysis(DOCUMENT, 'Demo', {});
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][1].messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(chat.mock.calls[1][1].messages[3].content).toMatch(/but the analysis has 2/);
    expect(report).toMatchObject({ totalUserStories: 1, analysisWarnings: [] });

    chat.mockReset();
    chat.mockResolvedValue({ text: split, usage: {} });
    const stillSplit = await agent._performLLMAnalysis(DOCUMENT, 'Demo', {});
    expect(stillSplit.analysisWarnings.join('\n')).toMatch(/^Story structure: The document defines 1 user story/);
  });
});
