/**
 * @fileoverview Unit tests for Agent 05 body normalisation and discovery planner page operations.
 */

import { buildGenerationPayload, unwrapFunctionBody } from '../../agents/05-playwright-script-generator/generation/testBodyGenerator';
import {
  buildPlannerRequest,
  validateNavigationPlan,
} from '../../agents/05-playwright-script-generator/discovery/navigationPlanner';

jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: () => unknown) => fn() }), { virtual: true });

const tc: any = {
  tcKey: 'TC-001',
  title: 'Refresh keeps the form',
  precondition: 'the user is on the start page',
  steps: [
    { index: 1, keyword: 'Given', action: 'the user is on the start page', testData: '', expected: [], data: [] },
    { index: 2, keyword: 'When', action: 'the user refreshes the page', testData: '', expected: ['the form is displayed'], data: [] },
  ],
};

const state: any = {
  name: 'start', urlPath: '/', elements: [{ name: 'submitButton', role: 'button', accessibleName: 'Submit' }],
};

describe('unwrapFunctionBody', () => {
  it('returns the statements of an arrow-function-wrapped body', () => {
    const body = 'async ({ featurePage }) => {\n  await featurePage.openStart();\n  await expect(featurePage.submitButton).toBeVisible();\n}';
    expect(unwrapFunctionBody(body)).toBe('await featurePage.openStart();\nawait expect(featurePage.submitButton).toBeVisible();');
  });

  it('leaves plain statements and unparsable text unchanged', () => {
    const body = 'await featurePage.openStart();\nawait expect(featurePage.submitButton).toBeVisible();';
    expect(unwrapFunctionBody(body)).toBe(body);
    expect(unwrapFunctionBody('await (')).toBe('await (');
  });
});

describe('navigation planner page operations', () => {
  it('accepts page operations without an element', () => {
    const result = validateNavigationPlan({ actions: [{ stepIndex: 2, op: 'reload' }], stopReason: 'COMPLETE' }, state, tc);
    expect(result.errors).toEqual([]);
    expect(result.plan?.actions[0].op).toBe('reload');
  });

  it('rejects page operations that name an element', () => {
    const result = validateNavigationPlan({ actions: [{ stepIndex: 2, op: 'reload', element: 'submitButton' }], stopReason: 'COMPLETE' }, state, tc);
    expect(result.errors).toContain('actions[0].element must be omitted for page operation "reload"');
  });

  it('accepts hover and dblclick on a verified element without a value', () => {
    const result = validateNavigationPlan({
      actions: [{ stepIndex: 2, op: 'hover', element: 'submitButton' }, { stepIndex: 2, op: 'dblclick', element: 'submitButton' }],
      stopReason: 'COMPLETE',
    }, state, tc);
    expect(result.errors).toEqual([]);
    expect(result.plan?.actions.map((a) => a.op)).toEqual(['hover', 'dblclick']);
  });

  it('tells the planner which actions were already executed', () => {
    const request = JSON.parse(buildPlannerRequest(tc, [state], state, 2, [{ stepIndex: 1, element: 'submitButton', op: 'click' }]));
    expect(request.executedActions).toEqual([{ stepIndex: 1, element: 'submitButton', op: 'click' }]);
  });
});

describe('generation payload', () => {
  it('passes applicable flows and verified states for each test case', () => {
    const payload: any = buildGenerationPayload({
      mode: 'UI',
      featureId: 'F-01',
      testCases: [tc],
      systemPrompt: 'contract',
      priorReviewFindings: [],
      maxRetries: 0,
      concurrency: 1,
      renderHarness: () => '',
      flowsByTcKey: new Map([['TC-001', [{
        member: 'startClickSubmitButtonFlow',
        params: ['codeInput'],
        actions: [],
        stepIndexes: [2],
        calls: [{ codeInput: { kind: 'data' as const, key: 'validCode', expression: 'data.validCode' } }],
      }]]]),
      verifiedStatesByTcKey: new Map([['TC-001', { 2: { state: 'dashboard', urlPath: '/dashboard.html' } }]]),
    }, [tc]);
    expect(payload.testCases[0].applicableFlows).toEqual([{ member: 'startClickSubmitButtonFlow', coversSteps: [2], calls: [{ codeInput: 'data.validCode' }] }]);
    expect(payload.testCases[0].verifiedStates).toEqual({ 2: { state: 'dashboard', urlPath: '/dashboard.html' } });
  });
});
