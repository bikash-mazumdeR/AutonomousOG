/**
 * @fileoverview Agent 03 defect catalogue (evals/agent03): a known-good suite draws no finding, every catalogued defect
 * draws the finding its rule promises, and the real Nexolvi suites draw no test-case finding. Deterministic, 0 tokens.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestCaseReviewerAgent } from '../../agents/03-test-case-reviewer/agent';
import {
  CATALOGUE_SECRET, CLEAN_ANALYSIS, DEFECTS, KNOWN_MISSES, cleanSuite,
} from '../../evals/agent03/catalogue';

jest.mock('p-retry', () => ({ __esModule: true, default: jest.fn(), AbortError: class extends Error {} }), { virtual: true });
jest.mock('../../core/llm/LLMClient', () => ({ llmClient: { chat: jest.fn(), getStageUsage: jest.fn(), getCallTraces: jest.fn(() => []) } }));

const SECRETS = [{ value: CATALOGUE_SECRET, placeholder: '{{validPassword}}' }];
const review = (suite: any[], analysis: any = CLEAN_ANALYSIS) => (new TestCaseReviewerAgent() as any).reviewForEval(suite, analysis, SECRETS);
const describeFinding = (a: any) => `${a.tcKey} ${a.severity} ${a.dimension}: ${a.finding}`;

describe('Agent 03 defect catalogue', () => {
  it('draws no finding at all on the known-good suite, and approves it', () => {
    const result = review(cleanSuite());
    expect(result.annotations.map(describeFinding)).toEqual([]);
    expect(result.decision).toBe('APPROVE');
    expect(result.reviewedTCs.every((tc: any) => tc.reviewStatus === 'PASSED')).toBe(true);
  });

  it.each(DEFECTS.map((d) => [d.id, d] as const))('catches %s', (_id, defect) => {
    const suite = cleanSuite();
    defect.plant(suite);
    const result = review(suite);
    const tcKey = defect.expect.tcKey || defect.tcKey;
    const matching = result.annotations.filter((a: any) => a.tcKey === tcKey
      && a.dimension === defect.expect.dimension && a.severity === defect.expect.severity);
    expect({ defect: defect.description, found: matching.length > 0, all: result.annotations.map(describeFinding) })
      .toMatchObject({ found: true });
    if (defect.expect.status) {
      expect(result.reviewedTCs.find((tc: any) => tc.key === tcKey)?.reviewStatus).toBe(defect.expect.status);
    }
    // One planted defect never takes the whole suite down.
    expect(result.decision).not.toBe('REJECT');
  });

  it('never lets a secret through, even while it reports it', () => {
    const suite = cleanSuite();
    DEFECTS.find((d) => d.id === 'secret-value')!.plant(suite);
    const result = review(suite);
    expect(JSON.stringify(result.reviewedTCs)).not.toContain(CATALOGUE_SECRET);
    expect(JSON.stringify(result.annotations)).not.toContain(CATALOGUE_SECRET);
  });

  it('rejects the suite only when nothing is left to continue', () => {
    const suite = cleanSuite().map((tc) => ({ ...tc, testSteps: tc.testSteps.slice(0, 1) }));
    expect(review(suite).decision).toBe('REJECT');
  });

  it('flags a malformed placeholder without rewriting it, and counts only real rewrites', () => {
    const suite = cleanSuite();
    suite[1].testSteps[1].testData = '[Sign in]';
    const result = review(suite);
    expect(result.annotations.some((a: any) => a.tcKey === 'TC-002' && a.dimension === 'DATA')).toBe(true);
    expect(result.reviewedTCs.find((tc: any) => tc.key === 'TC-002').testSteps[1].testData).toBe('[Sign in]');
    expect(result.reviewedTCs.every((tc: any) => tc.rewrittenSteps === 0)).toBe(true);

    const withSecret = cleanSuite();
    withSecret[1].testSteps[1].testData = CATALOGUE_SECRET;
    expect(review(withSecret).reviewedTCs.find((tc: any) => tc.key === 'TC-002').rewrittenSteps).toBe(1);
  });

  it('lowers the step-quality score for a step finding, and leaves coverage out when there is no analysis', () => {
    const suite = cleanSuite();
    DEFECTS.find((d) => d.id === 'vague-step')!.plant(suite);
    expect(review(suite).qualityScore.stepQuality).toBeLessThan(100);
    expect(review(cleanSuite()).qualityScore.stepQuality).toBe(100);

    const unanalysed = review(cleanSuite(), {});
    expect(unanalysed.qualityScore.coverage).toBeNull();
    expect(unanalysed.qualityScore.grade).toBe('A');
  });

  it('counts an API test case asserting a 4xx as negative coverage, as Agent 02 does', () => {
    const suite = cleanSuite().filter((tc) => tc.key !== 'TC-006');
    suite.push({
      ...suite[0], key: 'TC-009', hash: 'hash-TC-009', name: 'The session API rejects a wrong password', type: 'API', labels: ['Functional'],
      requirementRefs: ['AC-2'], apiDetails: { method: 'POST', endpoint: '/api/session', expectedStatusCode: 401 },
    });
    expect(review(suite).annotations.filter((a: any) => /negative TCs/.test(a.finding))).toEqual([]);
    const created = suite.map((tc) => (tc.key === 'TC-009' ? { ...tc, apiDetails: { ...tc.apiDetails, expectedStatusCode: 201 } } : tc));
    expect(review(created).annotations.filter((a: any) => /negative TCs/.test(a.finding))).toHaveLength(1);
  });

  it('reads a risk level in any spelling', () => {
    const analysis = JSON.parse(JSON.stringify(CLEAN_ANALYSIS));
    analysis.features[0].riskLevel = 'High';
    const suite = cleanSuite();
    DEFECTS.find((d) => d.id === 'no-smoke')!.plant(suite);
    const result = review(suite, analysis);
    expect(result.coverageMatrix.features[0].riskLevel).toBe('HIGH');
    expect(result.annotations.some((a: any) => /no Smoke-labelled/.test(a.finding))).toBe(true);
  });

  it('states what it cannot catch', () => {
    expect(KNOWN_MISSES.length).toBeGreaterThan(0);
  });
});

describe('Agent 03 on the real Nexolvi suites (frozen, secrets redacted)', () => {
  const root = path.resolve(__dirname, '../../projects/nexolvi/evals');
  it.each(['login', 'logout', 'profile'])('%s: no finding on any test case, and not rejected', (feature) => {
    const testCases = JSON.parse(fs.readFileSync(path.join(root, 'agent03', feature, 'test-cases.json'), 'utf-8'));
    const analysis = JSON.parse(fs.readFileSync(path.join(root, 'agent02', feature, 'analysis.json'), 'utf-8'));
    const result = review(testCases, analysis);
    const perTestCase = result.annotations.filter((a: any) => !String(a.tcKey).startsWith('FEATURE-'));
    expect(perTestCase.map(describeFinding)).toEqual([]);
    expect(result.decision).not.toBe('REJECT');
  });
});
