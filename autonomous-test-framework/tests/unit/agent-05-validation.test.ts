/**
 * @fileoverview Unit tests for the fail-closed Agent 05 body validator and the generation/retry loop.
 */

import { AutomationTestCase } from '../../agents/05-playwright-script-generator/contracts/automationTestCase';
import { PageContract } from '../../agents/05-playwright-script-generator/rendering/pomRenderer';
import { renderUiSpec } from '../../agents/05-playwright-script-generator/rendering/specRenderer';
import {
  GeneratedTest, discoveryProvenance, hexToRgbVariants, validateGeneratedTest,
} from '../../agents/05-playwright-script-generator/validation/integrityValidator';
import { FlowUsage } from '../../agents/05-playwright-script-generator/discovery/flowExtractor';
import { generateTestBodies } from '../../agents/05-playwright-script-generator/generation/testBodyGenerator';
import { ChatFn } from '../../agents/05-playwright-script-generator/types';

const tc: AutomationTestCase = {
  tcKey: 'TC-001',
  title: 'Empty access code shows the required error',
  type: 'Negative',
  priority: 'High',
  labels: ['Error-Handling'],
  featureId: 'F-01',
  userStoryId: 'US-01',
  requirementRefs: ['AC-2'],
  objective: 'Verifies AC-2',
  precondition: 'the user is on the sign-in page',
  steps: [
    {
      index: 1, keyword: 'Given', action: 'the user is on the sign-in page', expected: ['The sign-in form is displayed'], testData: '', data: [],
    },
    {
      index: 2,
      keyword: 'When',
      action: 'the user enters a PIN and submits without an access code',
      expected: ['The error "Access code is required" is displayed', 'The error banner background is #FF0000'],
      testData: '{{validPin}}',
      data: [{ token: '{{validPin}}', fixtureKey: 'validPin' }],
    },
  ],
};

const contract: PageContract = {
  fixture: 'featurePage',
  pageObject: 'F01Page',
  states: [{ name: 'start', urlPath: '/' }],
  members: [
    { name: 'openStart', kind: 'method', state: 'start', description: 'navigate' },
    { name: 'signInForm', kind: 'locator', state: 'start', description: 'form' },
    { name: 'pinInput', kind: 'locator', state: 'start', description: 'input' },
    { name: 'submitButton', kind: 'locator', state: 'start', description: 'button' },
    { name: 'errorBanner', kind: 'locator', state: 'start', description: 'alert' },
  ],
};

const harness = (body: string) => renderUiSpec({
  projectSlug: 'sample', featureId: 'F-01', sourceReviewId: 'r1', pageObject: 'F01Page', pomImport: '../pages/F01Page', fixtureImport: '../fixtures/test-data.json', envImport: '../../../helpers/env', tests: [{ tc, body }],
});

const validBody = [
  'await featurePage.openStart();',
  'await expect(featurePage.signInForm).toBeVisible();',
  'await featurePage.pinInput.fill(data.validPin);',
  'await featurePage.submitButton.click();',
  "await expect(featurePage.errorBanner).toHaveText('Access code is required');",
  "await expect(featurePage.errorBanner).toHaveCSS('background-color', 'rgb(255, 0, 0)');",
].join('\n');

const validEntry: GeneratedTest = {
  tcKey: 'TC-001',
  status: 'GENERATED',
  body: validBody,
  stepAssertions: [
    { stepIndex: 1, assertions: ['await expect(featurePage.signInForm).toBeVisible();'] },
    {
      stepIndex: 2,
      assertions: [
        "await expect(featurePage.errorBanner).toHaveText('Access code is required');",
        "await expect(featurePage.errorBanner).toHaveCSS('background-color', 'rgb(255, 0, 0)');",
      ],
    },
  ],
};

const validate = (entry: GeneratedTest) => validateGeneratedTest(entry, {
  mode: 'UI', tc, contract, harness: entry.body ? harness(entry.body) : '',
});

const withBody = (body: string, stepAssertions = validEntry.stepAssertions): GeneratedTest => ({ ...validEntry, body, stepAssertions });

describe('Agent 05 integrity validator', () => {
  it('accepts a body that implements every expected result with test-case values', () => {
    expect(validate(validEntry)).toEqual([]);
  });

  it('converts hex colours in the test case to computed rgb values', () => {
    expect(hexToRgbVariants('background #FF0000')).toContain('rgb(255, 0, 0)');
  });

  it('rejects expected values that are not in the step expected result', () => {
    const body = validBody.replace("toHaveText('Access code is required')", "toHaveText('Code needed')");
    const assertions = [{ ...validEntry.stepAssertions![0] }, { stepIndex: 2, assertions: validEntry.stepAssertions![1].assertions.map((a) => a.replace("'Access code is required'", "'Code needed'")) }];
    expect(validate(withBody(body, assertions)).join('\n')).toContain('"Code needed" does not appear');
  });

  it('rejects the application-adapted colour when the test case specifies another', () => {
    const body = validBody.replace('rgb(255, 0, 0)', 'rgb(226, 35, 26)');
    const assertions = [validEntry.stepAssertions![0], { stepIndex: 2, assertions: validEntry.stepAssertions![1].assertions.map((a) => a.replace('rgb(255, 0, 0)', 'rgb(226, 35, 26)')) }];
    expect(validate(withBody(body, assertions)).join('\n')).toContain('rgb(226, 35, 26)');
  });

  it('rejects members that are not in the verified page contract', () => {
    expect(validate(withBody(validBody.replace('submitButton.click', 'magicButton.click'))).join('\n')).toContain('featurePage.magicButton is not a member');
  });

  it('rejects conditional assertions', () => {
    const body = validBody.replace("await expect(featurePage.errorBanner).toHaveText('Access code is required');", "if (shown) { await expect(featurePage.errorBanner).toHaveText('Access code is required'); }");
    expect(validate(withBody(body)).join('\n')).toContain('INT-001');
  });

  it('rejects direct page locators and hard-coded test data', () => {
    const errors = validate(withBody(validBody.replace('featurePage.pinInput.fill(data.validPin)', "page.locator('#pin').fill('9999')"))).join('\n');
    expect(errors).toContain('INT-011');
    expect(errors).toContain('Literal "9999" does not appear in the test case');
  });

  it('rejects unbound fixture keys', () => {
    expect(validate(withBody(validBody.replace('data.validPin', 'data.adminPin'))).join('\n')).toContain('data.adminPin is not a fixture key');
  });

  it('requires every expected result to be mapped and every assertion to be listed', () => {
    const errors = validate(withBody(validBody, [validEntry.stepAssertions![0]])).join('\n');
    expect(errors).toContain('Step 2 has 2 expected result(s)');
    expect(errors).toContain('Assertion is not mapped to any step');
  });

  it('accepts a well-formed NEEDS_CONTEXT and rejects an empty one', () => {
    expect(validate({ tcKey: 'TC-001', status: 'NEEDS_CONTEXT', missing: [{ kind: 'LOCATOR', detail: 'No element shows the banner colour.' }] })).toEqual([]);
    expect(validate({ tcKey: 'TC-001', status: 'NEEDS_CONTEXT', missing: [] }).length).toBeGreaterThan(0);
  });
});

describe('Agent 05 generation loop', () => {
  const request = (maxRetries: number) => ({
    mode: 'UI' as const,
    featureId: 'F-01',
    testCases: [tc],
    contract,
    systemPrompt: 'contract',
    priorReviewFindings: [],
    maxRetries,
    concurrency: 1,
    renderHarness: (_tc: AutomationTestCase, body: string) => harness(body),
  });
  const reply = (entry: GeneratedTest) => JSON.stringify({ tests: [entry] });

  it('retries invalid bodies with the validation errors and accepts the corrected one', async () => {
    const invalid = withBody(validBody.replace('submitButton.click', 'magicButton.click'));
    const calls: string[] = [];
    const chat: ChatFn = async (messages) => {
      calls.push(messages[1].content);
      return calls.length === 1 ? reply(invalid) : reply(validEntry);
    };
    const [outcome] = await generateTestBodies(request(2), chat);
    expect(outcome.status).toBe('GENERATED');
    expect(outcome.attempts).toBe(2);
    expect(calls[1]).toContain('featurePage.magicButton is not a member');
  });

  it('blocks a test case that stays invalid and never returns its body', async () => {
    const invalid = withBody(validBody.replace("'Access code is required'", "'Invented text'"));
    const chat = jest.fn(async () => reply(invalid));
    const [outcome] = await generateTestBodies(request(1), chat);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe('BLOCKED');
    expect(outcome.body).toBeUndefined();
    expect(outcome.errors?.join('\n')).toContain('Invented text');
  });

  it('passes through NEEDS_CONTEXT and blocks missing entries', async () => {
    const needs = await generateTestBodies(request(0), async () => reply({ tcKey: 'TC-001', status: 'NEEDS_CONTEXT', missing: [{ kind: 'STATE', detail: 'Dashboard state not discovered.' }] }));
    expect(needs[0].status).toBe('NEEDS_CONTEXT');
    const missing = await generateTestBodies(request(0), async () => 'not json');
    expect(missing[0].status).toBe('BLOCKED');
  });
});

describe('Agent 05 verified flows and discovery-verified values', () => {
  const flowMember = {
    name: 'startClickSubmitButtonFlow',
    kind: 'flow' as const,
    state: 'start',
    description: 'Verified action sequence.',
    flowId: 'flow-a',
    params: ['pinInput'],
    actions: [{ member: 'pinInput', op: 'fill' }, { member: 'submitButton', op: 'click' }],
  };
  const flowContract: PageContract = { ...contract, members: [...contract.members, flowMember] };
  const usage: FlowUsage = {
    member: flowMember.name,
    params: flowMember.params,
    actions: flowMember.actions,
    stepIndexes: [2],
    calls: [{ pinInput: { kind: 'data', key: 'validPin', expression: 'data.validPin' } }],
  };
  const inline = 'await featurePage.pinInput.fill(data.validPin);\nawait featurePage.submitButton.click();';
  const withFlowCall = (call: string) => withBody(validBody.replace(inline, call));
  const validateFlow = (entry: GeneratedTest, flows: FlowUsage[] = [usage]) => validateGeneratedTest(entry, {
    mode: 'UI', tc, contract: flowContract, harness: harness(entry.body as string), flows,
  });

  it('accepts a verified flow called with exactly its arguments', () => {
    expect(validateFlow(withFlowCall('await featurePage.startClickSubmitButtonFlow({ pinInput: data.validPin });'))).toEqual([]);
  });

  it('rejects flows not verified for the test case, wrong arguments and unawaited calls', () => {
    const call = 'await featurePage.startClickSubmitButtonFlow({ pinInput: data.validPin });';
    expect(validateFlow(withFlowCall(call), []).join('\n')).toContain('is not a verified flow for TC-001');
    const extra = 'await featurePage.startClickSubmitButtonFlow({ pinInput: data.validPin, extra: data.validPin });';
    expect(validateFlow(withFlowCall(extra)).join('\n')).toContain('arguments must be exactly ({ pinInput: data.validPin })');
    const unawaited = 'featurePage.startClickSubmitButtonFlow({ pinInput: data.validPin });';
    expect(validateFlow(withFlowCall(unawaited)).join('\n')).toContain('must be awaited');
  });

  it('rejects performing a verified flow action by action', () => {
    expect(validateFlow(validEntry).join('\n')).toContain('call featurePage.startClickSubmitButtonFlow(...) instead');
  });

  const urlTc: AutomationTestCase = {
    ...tc,
    steps: [tc.steps[0], { ...tc.steps[1], expected: ['The dashboard page is displayed within 5000 ms'] }],
  };
  const urlEntry = (assertion: string): GeneratedTest => ({
    tcKey: 'TC-001',
    status: 'GENERATED',
    body: [
      'await featurePage.openStart();',
      'await expect(featurePage.signInForm).toBeVisible();',
      'await featurePage.pinInput.fill(data.validPin);',
      'await featurePage.submitButton.click();',
      assertion,
    ].join('\n'),
    stepAssertions: [
      { stepIndex: 1, assertions: ['await expect(featurePage.signInForm).toBeVisible();'] },
      { stepIndex: 2, assertions: [assertion] },
    ],
  });
  const urlCtx = (entry: GeneratedTest, verifiedStates?: Record<number, { state: string; urlPath: string }>) => ({
    mode: 'UI' as const,
    tc: urlTc,
    contract,
    verifiedStates,
    harness: renderUiSpec({
      projectSlug: 'sample',
      featureId: 'F-01',
      sourceReviewId: 'r1',
      pageObject: 'F01Page',
      pomImport: '../pages/F01Page',
      fixtureImport: '../fixtures/test-data.json',
      envImport: '../../../helpers/env',
      tests: [{ tc: urlTc, body: entry.body as string }],
    }),
  });
  const dashboard = { 2: { state: 'dashboard', urlPath: '/dashboard.html' } };

  it('accepts a URL path verified by discovery when the step names that state, and records its provenance', () => {
    const entry = urlEntry('await expect(page).toHaveURL(/dashboard\\.html/, { timeout: 5000 });');
    expect(validateGeneratedTest(entry, urlCtx(entry, dashboard))).toEqual([]);
    expect(discoveryProvenance(entry, urlCtx(entry, dashboard))).toEqual([{
      stepIndex: 2, assertion: (entry.stepAssertions as any)[1].assertions[0], state: 'dashboard', urlPath: '/dashboard.html',
    }]);
  });

  it('rejects the verified path without discovery, for an unnamed state, or for non-URL assertions', () => {
    const entry = urlEntry('await expect(page).toHaveURL(/dashboard\\.html/);');
    expect(validateGeneratedTest(entry, urlCtx(entry)).join('\n')).toContain('"html" does not appear');
    expect(validateGeneratedTest(entry, urlCtx(entry, { 2: { state: 'accountSettings', urlPath: '/dashboard.html' } })).join('\n')).toContain('does not appear');
    const text = urlEntry("await expect(featurePage.errorBanner).toHaveText('/dashboard.html');");
    expect(validateGeneratedTest(text, urlCtx(text, dashboard)).join('\n')).toContain('does not appear');
  });

  it('allows a timeout only when the step states it', () => {
    const entry = urlEntry('await expect(page).toHaveURL(/dashboard\\.html/, { timeout: 3000 });');
    expect(validateGeneratedTest(entry, urlCtx(entry, dashboard)).join('\n')).toContain('timeout must be a number stated');
  });
});
