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

  it('accepts goto for a known page state, and rejects unknown, overlay or element-bearing targets', () => {
    const known: any[] = [state, { name: 'dashboard', urlPath: '/dashboard.html', elements: [] }, { name: 'startMenu', urlPath: '/', overlay: { role: 'menu' }, elements: [] }];
    const plan = (action: any) => validateNavigationPlan({ actions: [{ stepIndex: 2, ...action }], stopReason: 'COMPLETE' }, state, tc, known);
    expect(plan({ op: 'goto', state: 'dashboard' }).errors).toEqual([]);
    expect(plan({ op: 'goto', state: 'dashboard' }).plan?.actions[0]).toMatchObject({ op: 'goto', state: 'dashboard' });
    expect(plan({ op: 'goto', state: 'nowhere' }).errors).toEqual([expect.stringContaining('is not a known state (one of start, dashboard)')]);
    expect(plan({ op: 'goto', state: 'startMenu' }).errors).toEqual([expect.stringContaining('is a menu or dialog state')]);
    expect(plan({ op: 'goto', state: 'dashboard', element: 'submitButton' }).errors).toEqual([expect.stringContaining('element must be omitted for "goto"')]);
  });

  it('requires a step that says the user navigates to an address to be performed by a goto', () => {
    const navTc: any = { ...tc, steps: [tc.steps[0], { index: 2, keyword: 'When', action: 'the user navigates to https://app.example/', testData: '', expected: ['the login page is displayed'], data: [] }] };
    const known: any[] = [state, { name: 'dashboard', urlPath: '/dashboard.html', elements: [] }];
    const skipped = validateNavigationPlan({ actions: [], stopReason: 'COMPLETE' }, state, navTc, known, 1);
    expect(skipped.errors).toEqual([expect.stringContaining('step 2 says the user navigates to an address; perform it with "goto"')]);
    const performed = validateNavigationPlan({ actions: [{ stepIndex: 2, op: 'goto', state: 'dashboard' }], stopReason: 'COMPLETE' }, state, navTc, known, 1);
    expect(performed.errors).toEqual([]);
    // Not covered yet (the plan stops before it), or not a navigation ("is on the page at <url>"): no requirement.
    expect(validateNavigationPlan({ actions: [], stopReason: 'NEEDS_NEW_STATE', nextStep: 2 }, state, navTc, known, 1).errors).toEqual([]);
    const givenTc: any = { ...navTc, steps: [{ ...navTc.steps[1], index: 1, action: 'the user is on the login page at https://app.example/' }] };
    expect(validateNavigationPlan({ actions: [], stopReason: 'COMPLETE' }, state, givenTc, known, 1).errors).toEqual([]);
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

describe('LLM JSON responses', () => {
  // eslint-disable-next-line global-require
  const { parseJsonObject } = require('../../agents/05-playwright-script-generator/sub-agents/shared/generation-utils');

  it('takes the corrected object when the model reconsiders after answering', () => {
    const text = 'Plan:\n```json\n{ "actions": [], "stopReason": "COMPLETE", "detail": "a } in a string" }\n```\n\nWait, let me reconsider.\n\n'
      + '```json\n{ "actions": [{ "stepIndex": 1, "element": "bButton", "op": "click" }], "stopReason": "NEEDS_NEW_STATE", "nextStep": 1 }\n```';
    expect(parseJsonObject(text)).toEqual({ actions: [{ stepIndex: 1, element: 'bButton', op: 'click' }], stopReason: 'NEEDS_NEW_STATE', nextStep: 1 });
  });

  it('still reads a bare object, and reports text with no object', () => {
    expect(parseJsonObject('  {"a": "x\\"y{"}  ')).toEqual({ a: 'x"y{' });
    expect(() => parseJsonObject('no json here')).toThrow('no JSON object found');
  });
});
