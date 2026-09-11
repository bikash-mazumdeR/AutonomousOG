/**
 * @fileoverview Unit tests for Agent 05 Decomposition and Token Optimization.
 * Validates TC partitioning, context pruning, POM summarization, and sub-agent instantiation.
 */

import {
  partitionByType,
  cleanContext,
  summarizePOM,
  filterTestData,
  chunkArray,
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
    getStageUsage: jest.fn().mockReturnValue({
      promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0,
    }),
  },
}));

describe('Agent 05 Decomposition & Token Optimization', () => {
  describe('partitionByType', () => {
    it('correctly splits UI, API, and Performance test cases into distinct buckets', () => {
      const testCases = [
        { key: 'TC-001', type: 'Positive', name: 'Valid Login' },
        { key: 'TC-002', type: 'Negative', name: 'Invalid Password' },
        { key: 'TC-003', type: 'API', name: 'Get User Profile' },
        { key: 'TC-004', type: 'Integration', name: 'Payment Webhook' },
        { key: 'TC-005', type: 'Performance', name: 'Login 500 VUs' },
        { key: 'TC-006', type: 'Stress', name: 'Stress Test Checkout' },
        { key: 'TC-007', type: 'Security', name: 'SQL Injection' },
        { key: 'TC-008', type: 'Accessibility', name: 'WCAG Form Labels' },
        { key: 'TC-009', type: 'Contract', name: 'OpenAPI Spec Validation' },
      ];

      const { uiTCs, apiTCs, perfTCs } = partitionByType(testCases);

      expect(uiTCs.map((t) => t.key)).toEqual(['TC-001', 'TC-002', 'TC-007', 'TC-008']);
      expect(apiTCs.map((t) => t.key)).toEqual(['TC-003', 'TC-004', 'TC-009']);
      expect(perfTCs.map((t) => t.key)).toEqual(['TC-005', 'TC-006']);
    });

    it('defaults unknown test case types to UI bucket so nothing is lost', () => {
      const testCases = [{ key: 'TC-999', type: 'CustomType', name: 'Special Verification' }];
      const { uiTCs, apiTCs, perfTCs } = partitionByType(testCases);

      expect(uiTCs.length).toBe(1);
      expect(apiTCs.length).toBe(0);
      expect(perfTCs.length).toBe(0);
    });
  });

  describe('cleanContext token optimization', () => {
    it('removes bulky analysis objects to prevent token bloat', () => {
      const bloatedContext = {
        group: {
          featureId: 'FEAT-001',
          featureName: 'Auth',
          testCases: [{ key: 'TC-001', name: 'Login' }],
        },
        analysis: {
          hugeDescription: 'A'.repeat(10000),
          unnecessaryMetadata: { x: 1, y: 2 },
        },
        testData: {
          baseURL: 'https://example.com',
          standardUsername: 'user1',
        },
      };

      const cleaned = cleanContext(bloatedContext, { mode: 'UI', isFirstBatch: false });

      expect(cleaned.analysis).toBeUndefined();
      expect(cleaned.group).toBeDefined();
    });

    it('replaces full pomCode with concise summary in non-first batches', () => {
      const fullPomCode = `
        class LoginPage {
          constructor(page) {
            this.usernameInput = this.page.locator('#user-name');
            this.loginButton = this.page.getByTestId('login-btn');
          }
          get errorMessage() { return this.page.locator('.error'); }
          async login(u, p) { await this.loginButton.click(); }
        }
      `;

      const context = {
        pomCode: fullPomCode,
        pomClassName: 'LoginPage',
        group: { testCases: [{ key: 'TC-002' }] },
      };

      const cleaned = cleanContext(context, { mode: 'UI', isFirstBatch: false });

      expect(cleaned.pomCode).toContain('Interface & Method Summary for LoginPage');
      expect(cleaned.pomCode).toContain('usernameInput');
      expect(cleaned.pomCode).toContain('loginButton');
      expect(cleaned.pomCode).toContain('login(u, p)');
      expect(cleaned.pomCode).not.toContain('constructor(page)');
    });
  });

  describe('summarizePOM', () => {
    it('extracts getters, locators, and action methods cleanly', () => {
      const pom = `
        class CartPage {
          get checkoutBtn() { return this.page.getByTestId('checkout'); }
          get items() { return this.page.locator('.cart-item'); }
          async removeItem(id) { await this.page.click(id); }
        }
      `;

      const summary = summarizePOM(pom, 'CartPage');

      expect(summary).toContain('checkoutBtn');
      expect(summary).toContain('items');
      expect(summary).toContain('removeItem(id)');
    });
  });

  describe('filterTestData', () => {
    it('preserves base keys and keys matching relevant test case IDs', () => {
      const bigFixtures = {
        baseURL: 'https://example.com',
        standardUsername: 'user',
        password: 'pwd',
        TC001_specificToken: 'token123',
        TC099_unrelatedData: 'ignore_me',
        someRandomOtherKey: 'random',
      };

      const context = {
        group: {
          testCases: [{ key: 'TC-001' }],
        },
      };

      const filtered = filterTestData(bigFixtures, context, 'UI');

      expect(filtered.baseURL).toBe('https://example.com');
      expect(filtered.standardUsername).toBe('user');
      expect(filtered.password).toBe('pwd');
    });
  });

  describe('chunkArray', () => {
    it('splits items into expected batch sizes', () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      const chunks = chunkArray(items, 5);

      expect(chunks.length).toBe(3);
      expect(chunks[0]).toEqual([1, 2, 3, 4, 5]);
      expect(chunks[1]).toEqual([6, 7, 8, 9, 10]);
      expect(chunks[2]).toEqual([11, 12]);
    });
  });

  describe('Sub-agent & Coordinator Instantiation', () => {
    it('instantiates all sub-agents and coordinator without throwing', () => {
      const uiAgent = new UIScriptGenerator();
      const apiAgent = new APIScriptGenerator();
      const k6Agent = new K6ScriptGenerator();
      const coordinator = new PlaywrightScriptGeneratorAgent();

      expect(uiAgent).toBeDefined();
      expect(apiAgent).toBeDefined();
      expect(k6Agent).toBeDefined();
      expect(coordinator).toBeDefined();
    });

    it('validates API endpoints properly', () => {
      const apiAgent = new APIScriptGenerator();

      expect(apiAgent.validateEndpoints([{ apiDetails: { endpoint: '/api/v1/auth' } }])).toBe(true);
      expect(apiAgent.validateEndpoints([{ apiDetails: { endpoint: 'not specified' } }])).toBe(false);
      expect(apiAgent.validateEndpoints([{ apiDetails: { endpoint: '{{targetendpoint}}' } }])).toBe(false);
      expect(apiAgent.validateEndpoints([])).toBe(false);
    });

    it('validates K6 endpoints properly', () => {
      const k6Agent = new K6ScriptGenerator();

      expect(k6Agent.validateEndpoints([{ performanceRef: { targetEndpoint: 'https://api.test.io/load' } }])).toBe(true);
      expect(k6Agent.validateEndpoints([{ performanceRef: { targetEndpoint: 'undefined' } }])).toBe(false);
      expect(k6Agent.validateEndpoints([])).toBe(false);
    });
  });

  describe('cleanExtractedCode', () => {
    it('strips conversational preambles, apologies, and markdown bullets from test blocks', () => {
      const { cleanExtractedCode } = require('../../agents/05-playwright-script-generator/sub-agents/shared/generation-utils');
      const noisyOutput = `
<thought>Thinking about the tests...</thought>
Wait, let's make sure I don't truncate or hit any syntax errors.
Here are the tests:
\`\`\`typescript
* *TC-028:*
test('TC-011: Valid Login', { annotation: [{ type: 'TC Key', description: 'TC-011' }] }, async ({ featurePage }) => {
  await featurePage.login();
});
\`\`\`
Hope this helps!
`;
      const cleaned = cleanExtractedCode(noisyOutput, true);
      expect(cleaned).not.toContain('Wait, let');
      expect(cleaned).not.toContain('Here are the tests');
      expect(cleaned).not.toContain('* *TC-028:*');
      expect(cleaned).not.toContain('Hope this helps');
      expect(cleaned).toContain("test('TC-011: Valid Login'");
      expect(cleaned.startsWith("test('TC-011: Valid Login'")).toBe(true);
      expect(cleaned.endsWith('});')).toBe(true);
    });
  });
});
