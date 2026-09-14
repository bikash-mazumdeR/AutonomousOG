/**
 * @fileoverview Unit tests for Agent 05 routing, chunking, JSON parsing, prompt assembly and construction.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  partitionByType,
  chunkArray,
  parseJsonObject,
  loadGenerationPrompt,
  loadDiscoveryPrompt,
} from '../../agents/05-playwright-script-generator/sub-agents/shared/generation-utils';
import { UIScriptGenerator } from '../../agents/05-playwright-script-generator/sub-agents/ui-script-generator';
import { APIScriptGenerator } from '../../agents/05-playwright-script-generator/sub-agents/api-script-generator';
import { K6ScriptGenerator } from '../../agents/05-playwright-script-generator/sub-agents/k6-script-generator';
import { PlaywrightScriptGeneratorAgent } from '../../agents/05-playwright-script-generator/agent';

jest.mock('p-retry', () => ({
  __esModule: true,
  default: jest.fn(),
  AbortError: class extends Error {},
}), { virtual: true });

jest.mock('../../core/llm/LLMClient', () => ({
  llmClient: {
    chat: jest.fn(),
    resetStageFallback: jest.fn(),
    getStageUsage: jest.fn().mockReturnValue({
      promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0,
    }),
  },
}));

describe('Agent 05 routing & helpers', () => {
  it('routes test cases to UI, API and performance generation', () => {
    const { uiTCs, apiTCs, perfTCs } = partitionByType([
      { key: 'TC-001', type: 'Positive' },
      { key: 'TC-002', type: 'Negative' },
      { key: 'TC-003', type: 'API' },
      { key: 'TC-004', type: 'Integration' },
      { key: 'TC-005', type: 'Performance' },
      { key: 'TC-006', type: 'Stress' },
      { key: 'TC-007', type: 'Edge' },
      { key: 'TC-008', type: 'Contract' },
      { key: 'TC-009', type: 'CustomType' },
    ]);
    expect(uiTCs.map((t) => t.key)).toEqual(['TC-001', 'TC-002', 'TC-007', 'TC-009']);
    expect(apiTCs.map((t) => t.key)).toEqual(['TC-003', 'TC-004', 'TC-008']);
    expect(perfTCs.map((t) => t.key)).toEqual(['TC-005', 'TC-006']);
  });

  it('splits items into chunks', () => {
    expect(chunkArray([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunkArray([], 3)).toEqual([]);
  });

  it('parses the JSON object out of an LLM response and rejects prose', () => {
    expect(parseJsonObject('```json\n{ "tests": [] }\n```')).toEqual({ tests: [] });
    expect(() => parseJsonObject('Sorry, I cannot do that.')).toThrow('no JSON object found');
  });

  describe('prompt assembly', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-learnings-'));
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it('combines the shared contract, the mode addendum and generic learnings', () => {
      const prompt = loadGenerationPrompt('UI');
      expect(prompt).toContain('Genuine-pass contract');
      expect(prompt).toContain('Mode UI');
      expect(prompt).toContain('Generic UI Learnings');
      expect(prompt).not.toContain('# Project notes (lower authority');
    });

    it('appends project notes with explicitly lower authority', () => {
      fs.writeFileSync(path.join(tmp, 'agent05-ui.md'), 'The sample app renders its menu lazily.');
      const prompt = loadGenerationPrompt('UI', tmp);
      expect(prompt).toContain('Project notes (lower authority than the approved test case and the page contract)');
      expect(prompt).toContain('The sample app renders its menu lazily.');
      expect(loadDiscoveryPrompt(tmp)).toContain('Discovery Navigation Planner');
    });
  });

  it('instantiates all sub-agents and the coordinator without side effects', () => {
    expect(new UIScriptGenerator()).toBeDefined();
    expect(new APIScriptGenerator()).toBeDefined();
    expect(new K6ScriptGenerator()).toBeDefined();
    expect(new PlaywrightScriptGeneratorAgent()).toBeDefined();
  });
});
