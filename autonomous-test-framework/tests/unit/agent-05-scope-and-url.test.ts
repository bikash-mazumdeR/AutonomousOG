/**
 * @fileoverview Unit tests for per-test-case test data attachment and the "stays on the page" URL rule.
 */

import { attachTestData } from '../../agents/05-playwright-script-generator/agent';
import { verifiedUrlFor } from '../../agents/05-playwright-script-generator/validation/integrityValidator';
import { isNonAnswer } from '../../core/clarifications/answerQuality';

jest.mock('../../core/llm/LLMClient', () => ({ llmClient: { chat: jest.fn(), getStageUsage: jest.fn(), resetStageFallback: jest.fn() } }));

const reviewed = (key: string, reviewStatus = 'PASSED', hash = `h-${key}`) => ({
  key, hash, reviewStatus, selected: true, testSteps: [{ description: 'enter {{validUser}}', testData: '', expectedResult: 'ok' }],
});
const enriched = (key: string, hash = `h-${key}`) => ({ ...reviewed(key, 'PASSED', hash), resolvedData: { inputs: { '{{validUser}}': { value: key } } } });

describe('Agent 05 — Agent 04 test data per test case', () => {
  it('keeps the data of the other test cases when one was held after Agent 04 ran', () => {
    const { testCases, missingData } = attachTestData(
      [reviewed('TC-001'), reviewed('TC-002'), reviewed('TC-003', 'HELD')],
      [enriched('TC-001'), enriched('TC-002'), enriched('TC-003')],
    );
    expect(testCases.map((tc) => tc.resolvedData?.inputs['{{validUser}}'].value)).toEqual(['TC-001', 'TC-002', 'TC-003']);
    expect(testCases[2].reviewStatus).toBe('HELD');
    expect(missingData).toEqual([]);
  });

  it('never uses data for different content and reports approved test cases left without data', () => {
    const { testCases, missingData } = attachTestData(
      [reviewed('TC-001'), reviewed('TC-002'), reviewed('TC-004')],
      [enriched('TC-001'), enriched('TC-002', 'h-regenerated')],
    );
    expect(testCases[0].resolvedData).toBeDefined();
    expect(testCases[1].resolvedData).toBeUndefined();
    expect(missingData).toEqual(['TC-002', 'TC-004']);
  });

  it('reports nothing when Agent 04 has not run', () => {
    expect(attachTestData([reviewed('TC-001')], []).missingData).toEqual([]);
  });
});

describe('Agent 05 — toHaveURL for "stays on the page" steps', () => {
  const ctx = (expected: string[], verifiedStates: Record<number, { state: string; urlPath: string }>) => ({
    mode: 'UI' as const,
    tc: {
      tcKey: 'TC-001',
      steps: [
        { index: 1, keyword: 'Given', action: 'the user opens the sign-in page', expected: ['the form is displayed'], testData: '', data: [] },
        { index: 2, keyword: 'When', action: 'the user submits', expected, testData: '', data: [] },
      ],
    },
    verifiedStates,
  }) as any;
  const stayed = { 1: { state: 'start', urlPath: '/' }, 2: { state: 'start', urlPath: '/' } };

  it('allows the unchanged verified URL when the step says the user remains on the page', () => {
    expect(verifiedUrlFor(ctx(['the error is displayed', 'the user remains on the login page with no redirect to the dashboard page'], stayed), 2)).toBe('/');
  });

  it('refuses it when discovery saw the URL change, and never allows the URL a "no redirect" step names', () => {
    const moved = { 1: { state: 'start', urlPath: '/' }, 2: { state: 'dashboard', urlPath: '/dashboard.html' } };
    expect(verifiedUrlFor(ctx(['the user is not redirected to the dashboard page'], moved), 2)).toBeUndefined();
    expect(verifiedUrlFor(ctx(['the user remains on the login page'], { 2: { state: 'start', urlPath: '/' } }), 2)).toBeUndefined();
  });

  it('keeps the existing rule for steps that name the reached page', () => {
    const moved = { 1: { state: 'start', urlPath: '/' }, 2: { state: 'dashboard', urlPath: '/dashboard.html' } };
    expect(verifiedUrlFor(ctx(['the dashboard page is displayed'], moved), 2)).toBe('/dashboard.html');
  });
});

describe('Clarifications — "marked manual" is a decision, not an answer', () => {
  it.each(['marked manual', 'Mark as manual', 'manual'])('rejects "%s" as an answer', (reply) => {
    expect(isNonAnswer(reply)).toBe(true);
  });
});
