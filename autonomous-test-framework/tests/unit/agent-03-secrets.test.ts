/**
 * @fileoverview Secrets never reach a reviewed test case (and so a committed feature file) or project memory, whether
 * they come from generated output, a reviewer's edit or a clarification answer.
 */

import * as fsPromises from 'fs/promises';
import { KnownSecret, allProjectSecrets, redactValue } from '../../core/aut/knownSecrets';
import { redactReviewSecrets, redactTestCaseSecrets } from '../../agents/03-test-case-reviewer/readiness/secrets';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { TestCaseReviewerAgent } from '../../agents/03-test-case-reviewer/agent';

jest.mock('fs/promises', () => ({ ...jest.requireActual('fs/promises'), writeFile: jest.fn() }));
jest.mock('p-retry', () => ({ __esModule: true, default: jest.fn(), AbortError: class extends Error {} }), { virtual: true });
jest.mock('../../core/llm/LLMClient', () => ({ llmClient: { chat: jest.fn(), getStageUsage: jest.fn(), getCallTraces: jest.fn(() => []) } }));

const PASSWORD = 'Fake#Pass-2026';
const secrets: KnownSecret[] = [{ value: PASSWORD, placeholder: '{{validPassword}}' }];

const testCase = () => ({
  key: 'TC-001',
  hash: 'abc123',
  featureId: 'F-01',
  userStoryId: 'US-01',
  name: 'Sign in with the account password',
  precondition: 'the user is on the sign-in page',
  testSteps: [
    { keyword: 'When', description: 'the user enters the password', testData: PASSWORD, expectedResult: 'The dashboard is displayed' },
  ],
  openClarifications: [{ question: `Is ${PASSWORD} still valid?` }],
});

describe('Secret redaction helpers', () => {
  it('redacts a copy of any value and counts the strings that held a secret', () => {
    const original = { a: [`x ${PASSWORD}`, 'clean'], b: { c: PASSWORD } };
    const { value, replaced } = redactValue(original, secrets);
    expect(value).toEqual({ a: ['x {{validPassword}}', 'clean'], b: { c: '{{validPassword}}' } });
    expect(replaced).toBe(2);
    expect(original.b.c).toBe(PASSWORD);
  });

  it('collects the secrets of every project profile', () => {
    const found = allProjectSecrets({ ...process.env, NEXOLVI_PASSWORD: PASSWORD });
    expect(found).toEqual(expect.arrayContaining([{ value: PASSWORD, placeholder: '{{validPassword}}' }]));
  });
});

describe('Agent 03 — secrets in reviewed test cases', () => {
  it('replaces secrets in the content, keeps identifiers, and reports placeholders only', () => {
    const tc = testCase();
    expect(redactTestCaseSecrets(tc, secrets)).toEqual(['{{validPassword}}']);
    expect(tc.testSteps[0].testData).toBe('{{validPassword}}');
    expect(tc.openClarifications[0].question).toBe('Is {{validPassword}} still valid?');
    expect([tc.key, tc.hash, tc.featureId, tc.userStoryId]).toEqual(['TC-001', 'abc123', 'F-01', 'US-01']);
    expect(JSON.stringify(tc)).not.toContain(PASSWORD);
  });

  it('lists only the test cases that held a secret', () => {
    expect(redactReviewSecrets([testCase(), { ...testCase(), key: 'TC-002', testSteps: [] , openClarifications: [] }], secrets))
      .toEqual([{ tcKey: 'TC-001', placeholders: ['{{validPassword}}'] }]);
  });

  it('annotates each redaction at review so the reviewer sees it', () => {
    const agent: any = new TestCaseReviewerAgent();
    agent._annotations = [];
    jest.spyOn(agent, '_knownSecrets').mockReturnValue(secrets);
    const tcs = [testCase()];
    agent._redactSecrets(tcs);
    expect(JSON.stringify(tcs)).not.toContain(PASSWORD);
    expect(agent._annotations).toEqual([expect.objectContaining({
      tcKey: 'TC-001', dimension: 'DATA', severity: 'MAJOR',
      finding: 'Wrote out the value of {{validPassword}} — replaced by the placeholder, since feature files are committed.',
    })]);
    expect(JSON.stringify(agent._annotations)).not.toContain(PASSWORD);
  });
});

describe('Project memory — no secret is ever written', () => {
  afterEach(() => (fsPromises.writeFile as unknown as jest.Mock).mockReset());

  it('redacts every project secret from memory before writing it', async () => {
    const previous = process.env.NEXOLVI_PASSWORD;
    process.env.NEXOLVI_PASSWORD = PASSWORD;
    const write = fsPromises.writeFile as unknown as jest.Mock;
    write.mockResolvedValue(undefined);
    try {
      await (memoryEngine as any)._writeToStorage({ globalLearnings: { resolvedClarifications: [{ question: 'Which account?', answer: `Password - ${PASSWORD}` }] } });
    } finally {
      process.env.NEXOLVI_PASSWORD = previous;
    }
    const written = String(write.mock.calls[0][1]);
    expect(written).not.toContain(PASSWORD);
    expect(written).toContain('Password - {{validPassword}}');
  });
});
