/**
 * @fileoverview Unit tests for verified flow extraction and per-test-case flow applicability.
 */

import {
  FlowMemberRef, applicableFlows, extractFlows, runSignature, verifiedStatesFor,
} from '../../agents/05-playwright-script-generator/discovery/flowExtractor';
import { PageMap, TestCaseTrace } from '../../agents/05-playwright-script-generator/discovery/pageMap';
import { AutomationTestCase } from '../../agents/05-playwright-script-generator/contracts/automationTestCase';

const baseMap = (traces: TestCaseTrace[]): PageMap => ({
  version: 2,
  featureId: 'F-01',
  states: [
    {
      name: 'start',
      urlPath: '/',
      entryPath: '/',
      elements: [
        { name: 'codeInput', strategy: 'testId', args: ['code'], tag: 'input' },
        { name: 'pinInput', strategy: 'testId', args: ['pin'], tag: 'input' },
        { name: 'submitButton', strategy: 'role', args: ['button', 'Sign in'], tag: 'button' },
      ],
    },
    { name: 'dashboard', urlPath: '/dashboard.html', elements: [{ name: 'welcomeHeading', strategy: 'text', args: ['Welcome'], tag: 'h1' }] },
  ],
  traces,
  flows: [],
});

const signIn = (tcKey: string, code: { binding?: string; literal?: string }, lastOp = 'click'): TestCaseTrace => ({
  tcKey,
  runs: [{
    state: 'start',
    reachedState: 'dashboard',
    actions: [
      { stepIndex: 2, state: 'start', element: 'codeInput', op: 'fill', value: code },
      { stepIndex: 2, state: 'start', element: 'pinInput', op: 'fill', value: { binding: '{{validPin}}' } },
      { stepIndex: 2, state: 'start', element: 'submitButton', op: lastOp },
    ],
  }],
  stateAfterStep: { 1: 'start', 2: 'dashboard' },
});

const testCase = (tcKey: string): AutomationTestCase => ({
  tcKey,
  title: 'Sign in with ABC123 opens the dashboard',
  type: 'Positive',
  priority: 'High',
  labels: [],
  featureId: 'F-01',
  userStoryId: 'US-01',
  requirementRefs: ['AC-1'],
  objective: '',
  precondition: '',
  steps: [
    {
      index: 1, keyword: 'Given', action: 'the user is on the sign-in page', expected: ['The sign-in form is displayed'], testData: '', data: [],
    },
    {
      index: 2,
      keyword: 'When',
      action: 'the user signs in',
      expected: ['The dashboard page is displayed'],
      testData: '{{validCode}} / {{validPin}}',
      data: [{ token: '{{validCode}}', fixtureKey: 'validCode' }, { token: '{{validPin}}', envVar: 'ARIA_VALID_PIN' }],
    },
  ],
});

function withFlows(traces: TestCaseTrace[]): { map: PageMap; members: FlowMemberRef[] } {
  const map = baseMap(traces);
  map.flows = extractFlows(map);
  const members = map.flows.map((flow) => ({
    name: flow.name,
    flowId: flow.id,
    params: flow.actions.filter((action) => action.param).map((action) => action.param as string),
    actions: flow.actions.map((action) => ({ member: action.element, op: action.op })),
  }));
  return { map, members };
}

describe('Agent 05 verified flows', () => {
  it('creates one flow for an action run two test cases performed identically', () => {
    const { map } = withFlows([signIn('TC-001', { binding: '{{validCode}}' }), signIn('TC-002', { literal: 'ABC123' })]);
    expect(map.flows).toEqual([{
      id: expect.any(String),
      name: 'startClickSubmitButtonFlow',
      state: 'start',
      usedBy: ['TC-001', 'TC-002'],
      actions: [
        { element: 'codeInput', op: 'fill', param: 'codeInput' },
        { element: 'pinInput', op: 'fill', param: 'pinInput' },
        { element: 'submitButton', op: 'click' },
      ],
    }]);
    expect(extractFlows(map)).toEqual(map.flows);
  });

  it('creates no flow for a run performed by one test case or differing in an operation', () => {
    expect(withFlows([signIn('TC-001', { binding: '{{validCode}}' })]).map.flows).toEqual([]);
    expect(withFlows([signIn('TC-001', { binding: '{{validCode}}' }), signIn('TC-002', { binding: '{{validCode}}' }, 'dblclick')]).map.flows).toEqual([]);
  });

  it('gives each call the argument expressions bound in that test case', () => {
    const traces = [signIn('TC-001', { binding: '{{validCode}}' }), signIn('TC-002', { literal: 'ABC123' })];
    const { map, members } = withFlows(traces);
    const [bound] = applicableFlows(testCase('TC-001'), traces[0], map, members);
    expect(bound).toMatchObject({ member: 'startClickSubmitButtonFlow', stepIndexes: [2] });
    expect(bound.calls).toEqual([{
      codeInput: { kind: 'data', key: 'validCode', expression: 'data.validCode' },
      pinInput: { kind: 'env', name: 'ARIA_VALID_PIN', expression: "env('ARIA_VALID_PIN')" },
    }]);
    const [literal] = applicableFlows(testCase('TC-002'), traces[1], map, members);
    expect(literal.calls[0].codeInput).toEqual({ kind: 'literal', value: 'ABC123', expression: '"ABC123"' });
  });

  it('does not apply a flow when a step inside it has expected results to assert first', () => {
    const split = signIn('TC-003', { binding: '{{validCode}}' });
    split.runs[0].actions[2].stepIndex = 3;
    const base = testCase('TC-003');
    const tc: AutomationTestCase = {
      ...base,
      steps: [...base.steps, {
        index: 3, keyword: 'When', action: 'the user submits', expected: ['The dashboard page is displayed'], testData: '', data: [],
      }],
    };
    const { map, members } = withFlows([signIn('TC-001', { binding: '{{validCode}}' }), split]);
    expect(map.flows).toHaveLength(1);
    expect(applicableFlows(tc, split, map, members)).toEqual([]);
  });

  it('maps steps to the URL paths of the states discovery verified', () => {
    const trace = signIn('TC-001', { binding: '{{validCode}}' });
    expect(verifiedStatesFor(trace, baseMap([trace]))).toEqual({
      1: { state: 'start', urlPath: '/' },
      2: { state: 'dashboard', urlPath: '/dashboard.html' },
    });
  });

  it('ignores runs that reference elements no longer in the page map', () => {
    const trace = signIn('TC-001', { binding: '{{validCode}}' });
    trace.runs[0].actions[0].element = 'ghostInput';
    expect(runSignature(baseMap([trace]), trace.runs[0])).toBeNull();
  });
});
