/**
 * @fileoverview Preconditions established by discovery, and the account-identifier locator: a test case's precondition
 * is planned as step 0, the actions that established it are handed to the body generator and enforced by the
 * validator, and the signed-in account's identifier is addressed through its environment variable — never its value.
 */

import { withPreconditionStep } from '../../agents/05-playwright-script-generator/discovery/discoverFeature';
import {
  applicableFlows, extractFlows, preconditionActionsFor,
} from '../../agents/05-playwright-script-generator/discovery/flowExtractor';
import { PageMap, TestCaseTrace, locatorSignature } from '../../agents/05-playwright-script-generator/discovery/pageMap';
import { locatorExpression, renderPom, PageContract } from '../../agents/05-playwright-script-generator/rendering/pomRenderer';
import { renderUiSpec } from '../../agents/05-playwright-script-generator/rendering/specRenderer';
import { GeneratedTest, validateGeneratedTest } from '../../agents/05-playwright-script-generator/validation/integrityValidator';
import { buildGenerationPayload } from '../../agents/05-playwright-script-generator/generation/testBodyGenerator';
import { AutomationTestCase } from '../../agents/05-playwright-script-generator/contracts/automationTestCase';
import { PRECONDITION_STEP_INDEX } from '../../agents/05-playwright-script-generator/constants';

const tc: AutomationTestCase = {
  tcKey: 'TC-006',
  title: 'Login page after logout',
  type: 'Positive',
  priority: 'High',
  labels: [],
  featureId: 'F-01',
  userStoryId: 'US-01',
  requirementRefs: ['AC-6'],
  objective: '',
  precondition: 'the user has completed the logout flow and is on the Login page',
  steps: [
    {
      index: 1, keyword: 'Then', action: 'the login page is displayed', expected: ['The "Welcome" heading is displayed'], testData: '', data: [],
    },
  ],
};

const map: PageMap = {
  version: 2,
  featureId: 'F-01',
  states: [
    { name: 'start', urlPath: '/', elements: [{ name: 'bButton', strategy: 'role', args: ['button', 'B'], tag: 'button', role: 'button', accessibleName: 'B' }] },
    { name: 'startMenu', urlPath: '/', overlay: { role: 'menu' }, elements: [{ name: 'logoutMenuItem', strategy: 'role', args: ['menuitem', 'Logout'], tag: 'div', role: 'menuitem' }] },
    {
      name: 'startLogOutDialog',
      urlPath: '/',
      overlay: { role: 'alertdialog', name: 'Log out?' },
      elements: [{ name: 'logOutButton', strategy: 'role', args: ['button', 'Log out'], tag: 'button', role: 'button' }],
    },
    { name: 'login', urlPath: '/login', entryPath: '/login', elements: [{ name: 'welcomeHeading', strategy: 'role', args: ['heading', 'Welcome'], tag: 'h2', role: 'heading' }] },
  ],
  traces: [],
  flows: [],
};

/** The trace discovery records when the precondition takes three states to establish. */
const trace: TestCaseTrace = {
  tcKey: 'TC-006',
  runs: [
    { state: 'start', reachedState: 'startMenu', actions: [{ stepIndex: 0, state: 'start', element: 'bButton', op: 'click' }] },
    { state: 'startMenu', reachedState: 'startLogOutDialog', actions: [{ stepIndex: 0, state: 'startMenu', element: 'logoutMenuItem', op: 'click' }] },
    { state: 'startLogOutDialog', reachedState: 'login', actions: [{ stepIndex: 0, state: 'startLogOutDialog', element: 'logOutButton', op: 'click' }] },
  ],
  stateAfterStep: { 0: 'login', 1: 'login' },
};

const signatureOf = (args: string[]) => locatorSignature({ strategy: 'role', args });
const memberBySignature = new Map([
  [signatureOf(['button', 'B']), 'bButton'], [signatureOf(['menuitem', 'Logout']), 'logoutMenuItem'],
  [signatureOf(['button', 'Log out']), 'logOutButton'], [signatureOf(['heading', 'Welcome']), 'welcomeHeading'],
]);

describe('Agent 05 preconditions — planned as step 0', () => {
  it('prepends the precondition as step 0 only when the test case has one', () => {
    const planned = withPreconditionStep(tc);
    expect(planned.steps.map((step) => step.index)).toEqual([PRECONDITION_STEP_INDEX, 1]);
    expect(planned.steps[0]).toMatchObject({ keyword: 'Given', action: `Precondition: ${tc.precondition}`, expected: [], data: [] });
    const blank = { ...tc, precondition: '  ' };
    expect(withPreconditionStep(blank)).toBe(blank);
    expect(withPreconditionStep({ ...tc, precondition: '' }).steps.map((step) => step.index)).toEqual([1]);
  });

  it('resolves the actions that established the precondition to page-object members, in order', () => {
    expect(preconditionActionsFor(tc, trace, map, memberBySignature)).toEqual([
      { member: 'bButton', op: 'click' }, { member: 'logoutMenuItem', op: 'click' }, { member: 'logOutButton', op: 'click' },
    ]);
    expect(preconditionActionsFor(tc, undefined, map, memberBySignature)).toEqual([]);
  });

  it('resolves a goto action to the navigation method of its target state, or refuses when there is none', () => {
    const visit: TestCaseTrace = {
      ...trace, runs: [{ state: 'login', reachedState: 'login', actions: [{ stepIndex: 0, state: 'login', op: 'goto', target: 'start' }] }],
    };
    expect(preconditionActionsFor(tc, visit, map, memberBySignature, new Map([['start', 'visitStart']]))).toEqual([{ member: 'visitStart', op: 'goto' }]);
    expect(preconditionActionsFor(tc, visit, map, memberBySignature)).toBeNull();
  });

  it('refuses to render a precondition whose element is no longer verified or whose value is not bound', () => {
    const stale = new Map(memberBySignature);
    stale.delete(signatureOf(['menuitem', 'Logout']));
    expect(preconditionActionsFor(tc, trace, map, stale)).toBeNull();
    const unbound: TestCaseTrace = {
      ...trace,
      runs: [{ state: 'start', reachedState: 'start', actions: [{ stepIndex: 0, state: 'start', element: 'bButton', op: 'fill', value: { binding: '{{x}}' } }] }],
    };
    expect(preconditionActionsFor(tc, unbound, map, memberBySignature)).toBeNull();
  });

  it('never turns precondition runs into flows, nor applies a flow to them', () => {
    const twoActions: TestCaseTrace = {
      tcKey: 'TC-007',
      runs: [{
        state: 'start',
        reachedState: 'startMenu',
        actions: [{ stepIndex: 0, state: 'start', element: 'bButton', op: 'click' }, { stepIndex: 0, state: 'start', element: 'bButton', op: 'click' }],
      }],
      stateAfterStep: { 0: 'startMenu' },
    };
    const withTraces: PageMap = { ...map, traces: [twoActions, { ...twoActions, tcKey: 'TC-008' }] };
    expect(extractFlows(withTraces)).toEqual([]);
    const member = { name: 'startClickBButtonFlow', flowId: 'x', params: [], actions: [{ member: 'bButton', op: 'click' }, { member: 'bButton', op: 'click' }] };
    expect(applicableFlows(tc, twoActions, withTraces, [member])).toEqual([]);
  });

  it('hands the generator the precondition actions and the state they led to', () => {
    const payload: any = buildGenerationPayload({
      mode: 'UI',
      featureId: 'F-01',
      testCases: [tc],
      systemPrompt: '',
      priorReviewFindings: [],
      maxRetries: 0,
      concurrency: 1,
      renderHarness: () => '',
      preconditionActionsByTcKey: new Map([[tc.tcKey, preconditionActionsFor(tc, trace, map, memberBySignature) || []]]),
      verifiedStatesByTcKey: new Map([[tc.tcKey, { 0: { state: 'login', urlPath: '/login' } }]]),
    }, [tc]);
    expect(payload.testCases[0].preconditionActions).toEqual([
      { member: 'bButton', op: 'click' }, { member: 'logoutMenuItem', op: 'click' }, { member: 'logOutButton', op: 'click' },
    ]);
    expect(payload.testCases[0].verifiedStates[0]).toEqual({ state: 'login', urlPath: '/login' });
  });
});

describe('Agent 05 validator — precondition actions and credential values', () => {
  const contract: PageContract = {
    fixture: 'featurePage',
    pageObject: 'LogoutPage',
    states: [{ name: 'start', urlPath: '/' }, { name: 'login', urlPath: '/login' }],
    members: [
      { name: 'openStart', kind: 'method', state: 'start', description: 'sign in' },
      { name: 'bButton', kind: 'locator', state: 'start', description: 'button "B"' },
      { name: 'logoutMenuItem', kind: 'locator', state: 'startMenu', description: 'menuitem "Logout"' },
      { name: 'logOutButton', kind: 'locator', state: 'startLogOutDialog', description: 'button "Log out"' },
      { name: 'welcomeHeading', kind: 'locator', state: 'login', description: 'heading "Welcome"' },
      { name: 'accountIdentifierText', kind: 'locator', state: 'startMenu', description: 'span — the account identifier the session signed in with' },
    ],
  };
  const preconditionActions = preconditionActionsFor(tc, trace, map, memberBySignature) || [];
  const harness = (body: string) => renderUiSpec({
    projectSlug: 'sample', featureId: 'F-01', sourceReviewId: 'r1', pageObject: 'LogoutPage', pomImport: '../pages/LogoutPage', fixtureImport: '../fixtures/test-data.json', envImport: '../../../helpers/env', storageImport: '../../../helpers/storage', tests: [{ tc, body }],
  });
  const assertion = "await expect(featurePage.welcomeHeading).toHaveText('Welcome');";
  const entry = (body: string): GeneratedTest => ({ tcKey: tc.tcKey, status: 'GENERATED', body, stepAssertions: [{ stepIndex: 1, assertions: [assertion] }] });
  const validate = (body: string, secrets?: Array<{ name: string; value: string }>) => validateGeneratedTest(entry(body), {
    mode: 'UI', tc, contract, harness: harness(body), preconditionActions, secrets,
  });
  const logout = 'await featurePage.bButton.click();\nawait featurePage.logoutMenuItem.click();\nawait featurePage.logOutButton.click();';

  it('accepts a goto precondition performed as its navigation method, and rejects it when missing', () => {
    const gotoContract: PageContract = { ...contract, members: [...contract.members, { name: 'visitStart', kind: 'method', state: 'start', description: 'direct' }] };
    const gotoActions = [{ member: 'visitStart', op: 'goto' }];
    const check = (body: string) => validateGeneratedTest(entry(body), { mode: 'UI', tc, contract: gotoContract, harness: harness(body), preconditionActions: gotoActions });
    expect(check(`await featurePage.openStart();\nawait featurePage.visitStart();\n${assertion}`)).toEqual([]);
    expect(check(`await featurePage.openStart();\n${assertion}`)).toEqual([expect.stringContaining('featurePage.visitStart(). The body does not perform them.')]);
  });

  it('accepts a body that performs the precondition actions in order before step 1', () => {
    expect(validate(`await featurePage.openStart();\n${logout}\n${assertion}`)).toEqual([]);
  });

  it('rejects a body that skips, reorders or asserts before the precondition actions', () => {
    expect(validate(`await featurePage.openStart();\n${assertion}`)).toEqual([expect.stringContaining('The body does not perform them.')]);
    const reordered = 'await featurePage.bButton.click();\nawait featurePage.logOutButton.click();\nawait featurePage.logoutMenuItem.click();';
    expect(validate(`await featurePage.openStart();\n${reordered}\n${assertion}`)).toEqual([expect.stringContaining('The body does not perform them.')]);
    expect(validate(`await featurePage.openStart();\n${assertion}\n${logout}`)).toEqual([expect.stringContaining('The body asserts before they are complete.')]);
  });

  it('rejects a body that performs a precondition action with other arguments', () => {
    const withValue = [{ member: 'bButton', op: 'fill', value: { kind: 'literal' as const, value: 'B', expression: '"B"' } }];
    const errors = validateGeneratedTest(entry(`await featurePage.openStart();\nawait featurePage.bButton.fill('C');\n${assertion}`), {
      mode: 'UI', tc, contract, harness: '', preconditionActions: withValue,
    });
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('The body performs them with different arguments.')]));
  });

  it('rejects any literal that carries a credential value, naming the variable and never the value', () => {
    const secrets = [{ name: 'APP_EMAIL', value: 'qa@example.test' }];
    const body = `await featurePage.openStart();\n${logout}\nawait expect(featurePage.accountIdentifierText).toHaveText('qa@example.test');\n${assertion}`;
    const errors = validate(body, secrets);
    expect(errors.some((error) => error.includes('credential environment variable APP_EMAIL'))).toBe(true);
    // Every error is redacted, including the ones that echo a statement of the body.
    expect(errors.join('\n')).not.toContain('qa@example.test');
    expect(errors.join('\n')).toContain("toHaveText('<value of APP_EMAIL>')");
    expect(validate(`await featurePage.openStart();\n${logout}\nawait expect(featurePage.accountIdentifierText).toBeVisible();\n${assertion}`, secrets))
      .toEqual([expect.stringContaining('Assertion is not mapped to any step')]);
  });
});

describe('Agent 05 renderer — account identifier read from the environment', () => {
  const withIdentifier: PageMap = {
    ...map,
    states: [
      ...map.states.slice(0, 1),
      {
        ...map.states[1],
        elements: [
          ...map.states[1].elements,
          { name: 'accountIdentifierText', strategy: 'env', args: ['APP_EMAIL'], tag: 'span', description: 'the account identifier the session signed in with' },
        ],
      },
      ...map.states.slice(2),
    ],
  };
  const options = { className: 'LogoutPage', basePageImport: '../../../pages/BasePage', projectSlug: 'sample', envHelperImport: '../../../helpers/env' };

  it('renders the locator from the variable at runtime and imports the env helper for it', () => {
    expect(locatorExpression({ strategy: 'env', args: ['APP_EMAIL'] })).toBe('this.page.getByText(requireEnv("APP_EMAIL"), { exact: true })');
    const { code, contract, memberBySignature: members } = renderPom(withIdentifier, options);
    expect(code).toContain("import { requireEnv } from '../../../helpers/env';");
    expect(code).toContain('get accountIdentifierText(): Locator {\n    return this.page.getByText(requireEnv("APP_EMAIL"), { exact: true });');
    expect(contract.members.find((member) => member.name === 'accountIdentifierText')).toMatchObject({
      kind: 'locator', state: 'startMenu', description: 'span — the account identifier the session signed in with (state: startMenu)',
    });
    expect(members.get(locatorSignature({ strategy: 'env', args: ['APP_EMAIL'] }))).toBe('accountIdentifierText');
    expect(members.get(signatureOf(['button', 'B']))).toBe('bButton');
  });

  it('renders a direct visit method for every state that is neither an entry state nor an overlay', () => {
    const { code, contract, navigationByState } = renderPom(map, options);
    expect([...navigationByState.entries()]).toEqual([['login', 'openLogin'], ['start', 'visitStart']]);
    expect(code).toContain('  async visitStart(): Promise<void> {\n    await this.navigate("/");\n  }');
    expect(code).not.toContain('visitStartMenu');
    expect(code).not.toContain('visitStartLogOutDialog');
    const visit = contract.members.find((member) => member.name === 'visitStart');
    expect(visit).toMatchObject({ kind: 'method', state: 'start' });
    expect(visit?.description).toContain('Requests the address of the "start" state (/) directly');
    expect(visit?.description).toContain('a redirect to the login page');
  });

  it('refuses to render an environment-backed locator without the env helper', () => {
    expect(() => renderPom(withIdentifier, { ...options, envHelperImport: undefined })).toThrow('envHelperImport is required to render a locator');
    expect(() => renderPom(map, { ...options, envHelperImport: undefined })).not.toThrow();
  });
});
