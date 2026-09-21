/**
 * @fileoverview Unit tests for deterministic page-object and spec rendering.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AutomationTestCase } from '../../agents/05-playwright-script-generator/contracts/automationTestCase';
import { PageMap } from '../../agents/05-playwright-script-generator/discovery/pageMap';
import {
  MEMBER_KIND, RESERVED_MEMBERS, pageObjectClassName, renderPom,
} from '../../agents/05-playwright-script-generator/rendering/pomRenderer';
import { hoistCommonPrefix } from '../../agents/05-playwright-script-generator/rendering/hookHoister';
import {
  importPath, renderK6Script, renderTags, renderUiSpec, slaMilliseconds,
} from '../../agents/05-playwright-script-generator/rendering/specRenderer';
import { analyzeWithAST, FILE_TYPE, FINDING_SEVERITY } from '../../core/automation-reviewer/ReviewRules';

const map: PageMap = {
  version: 1,
  featureId: 'F-01',
  testIdAttribute: 'data-qa',
  states: [
    {
      name: 'start',
      urlPath: '/',
      entryPath: '/',
      elements: [
        { name: 'codeInput', strategy: 'testId', args: ['code'], tag: 'input', role: 'textbox' },
        { name: 'submitButton', strategy: 'role', args: ['button', 'Sign in'], tag: 'button', role: 'button', accessibleName: 'Sign in' },
        { name: 'navigate', strategy: 'label', args: ['Navigate'], tag: 'a', role: 'link' },
      ],
    },
    {
      name: 'dashboard',
      urlPath: '/dashboard.html',
      elements: [
        { name: 'codeInput', strategy: 'id', args: ['search'], tag: 'input' },
        { name: 'welcomeHeading', strategy: 'text', args: ['Welcome'], tag: 'h1', role: 'heading' },
      ],
    },
  ],
};

const tc: AutomationTestCase = {
  tcKey: 'TC-007',
  title: 'Sign in shows the dashboard',
  type: 'Positive',
  priority: 'High',
  labels: ['Smoke', 'UI'],
  featureId: 'F-01',
  userStoryId: 'US-02',
  requirementRefs: ['AC-1', 'BR-2'],
  objective: '',
  precondition: '',
  steps: [],
  performance: { scenario: 'stress', targetEndpoint: '/api/search', slaText: 'p95 response time under 1.5 s' },
};

describe('Agent 05 rendering', () => {
  it('renders a verified page object and a closed-world contract', () => {
    const { code, contract } = renderPom(map, { className: pageObjectClassName('F-01'), basePageImport: '../../../pages/BasePage', projectSlug: 'sample' });
    expect(pageObjectClassName('F-01')).toBe('F01Page');
    expect(code.split('\n')[0]).toContain('@aria-generated');
    expect(code).toContain("get codeInput(): Locator {\n    return this.page.getByTestId(\"code\");");
    expect(code).toContain('this.page.getByRole("button", { name: "Sign in", exact: true })');
    expect(code).toContain('async openStart(): Promise<void>');
    expect(contract.members.map((m) => m.name)).toEqual(['openStart', 'codeInput', 'submitButton', 'startNavigate', 'dashboardCodeInput', 'welcomeHeading']);
    expect(analyzeWithAST(code, FILE_TYPE.POM).findings.filter((f) => f.severity === FINDING_SEVERITY.BLOCKER)).toEqual([]);
  });

  it('renders deterministic, traceable UI specs', () => {
    const params = {
      projectSlug: 'sample', featureId: 'F-01', sourceReviewId: 'review-1', pageObject: 'F01Page', pomImport: '../pages/F01Page', fixtureImport: '../fixtures/test-data.json', envImport: '../../../helpers/env', tests: [{ tc, body: 'await featurePage.openStart();\nawait expect(featurePage.welcomeHeading).toBeVisible();' }],
    };
    const first = renderUiSpec(params);
    expect(renderUiSpec(params)).toBe(first);
    expect(first).toContain('test("[TC-007] Sign in shows the dashboard", {');
    expect(first).toContain('tag: ["@positive", "@smoke", "@ui"]');
    expect(first).toContain('{ type: "Requirements", description: "AC-1, BR-2" }');
    expect(first).not.toContain('requireEnv');
    const findings = analyzeWithAST(first, FILE_TYPE.SPEC, ['TC-007']).findings.filter((f) => f.severity === FINDING_SEVERITY.BLOCKER);
    expect(findings).toEqual([]);
    expect(renderTags(tc)).toEqual(['@positive', '@smoke', '@ui']);
  });

  it('renders environment-driven K6 scripts with the test case SLA', () => {
    const script = renderK6Script({
      projectSlug: 'sample', featureId: 'F-01', sourceReviewId: null, tc, body: "const res = http.get(`${BASE_URL}/api/search`);\ncheck(res, { 'status is 200': (r) => r.status === 200 });", baseUrlEnv: 'AUT_BASE_URL',
    });
    expect(slaMilliseconds(tc.performance?.slaText)).toBe(1500);
    expect(script).toContain('const P95_THRESHOLD_MS = 1500;');
    expect(script).toContain("executor: 'ramping-vus'");
    expect(script).toContain("const BASE_URL = requireEnv(\"AUT_BASE_URL\")");
    expect(script).not.toMatch(/localhost|\|\| 'perf_/);
    expect(analyzeWithAST(script, FILE_TYPE.K6).findings).toEqual([]);
  });

  it('computes relative imports', () => {
    expect(importPath('/root/tests/projects/sample/specs', '/root/tests/projects/sample/pages/F01Page.ts')).toBe('../pages/F01Page');
    expect(importPath('/root/tests/projects/sample/specs', '/root/tests/projects/sample/fixtures/test-data.json')).toBe('../fixtures/test-data.json');
  });
});

describe('Agent 05 verified sign-in in page objects', () => {
  const authMap: PageMap = {
    version: 2,
    featureId: 'F-02',
    states: [
      {
        name: 'login',
        urlPath: '/login',
        entryPath: '/login',
        elements: [
          { name: 'emailInput', strategy: 'label', args: ['Email'], tag: 'input', role: 'textbox', inputType: 'email' },
          { name: 'passwordInput', strategy: 'label', args: ['Password'], tag: 'input', inputType: 'password' },
          { name: 'signInButton', strategy: 'role', args: ['button', 'Sign in'], tag: 'button', role: 'button', accessibleName: 'Sign in' },
        ],
      },
      { name: 'dashboard', urlPath: '/', elements: [{ name: 'dashboardHeading', strategy: 'role', args: ['heading', 'Dashboard'], tag: 'h1', role: 'heading' }] },
    ],
    traces: [],
    flows: [],
    auth: {
      loginState: 'login', signedInState: 'dashboard', identifier: 'emailInput', password: 'passwordInput', submit: 'signInButton', identifierEnv: 'APP_EMAIL', passwordEnv: 'APP_PASSWORD',
    },
  };
  const options = { className: 'LoginPage', basePageImport: '../../../pages/BasePage', projectSlug: 'sample', envHelperImport: '../../../helpers/env' };

  it('renders signIn() from the verified form and opens the signed-in state through it', () => {
    const { code, contract } = renderPom(authMap, options);
    expect(code).toContain("import { requireEnv } from '../../../helpers/env';");
    expect(code).toContain('  async signIn(): Promise<void> {\n    await this.navigate("/login");\n'
      + '    await this.emailInput.fill(requireEnv("APP_EMAIL"));\n    await this.passwordInput.fill(requireEnv("APP_PASSWORD"));\n'
      + '    await this.signInButton.click();\n  }');
    expect(code).toContain('  async openDashboard(): Promise<void> {\n    await this.signIn();\n  }');
    expect(code).not.toContain('process.env');
    expect(analyzeWithAST(code, FILE_TYPE.POM).findings.filter((f) => f.severity === FINDING_SEVERITY.BLOCKER)).toEqual([]);

    const methods = contract.members.filter((member) => member.kind === MEMBER_KIND.METHOD);
    expect(methods.map((member) => [member.name, member.state])).toEqual([['openLogin', 'login'], ['openDashboard', 'dashboard'], ['signIn', 'dashboard']]);
    expect(methods[1].description).toContain('by signing in');
    expect(methods[2].description).toContain('APP_EMAIL, APP_PASSWORD');
    expect(methods[2].description).toContain('never fill the sign-in form');
  });

  it('drops a sign-in whose members are no longer verified, and refuses to render one without the env helper', () => {
    const stale: PageMap = { ...authMap, auth: { ...authMap.auth!, submit: 'vanishedButton' } };
    const { code, contract } = renderPom(stale, options);
    expect(code).not.toContain('async signIn(');
    expect(code).not.toContain('requireEnv');
    expect(contract.members.map((member) => member.name)).not.toContain('openDashboard');
    expect(() => renderPom(authMap, { ...options, envHelperImport: undefined })).toThrow('envHelperImport is required');
  });

  it('keeps direct navigation for a signed-in state that is also an entry state', () => {
    const shared: PageMap = { ...authMap, states: [authMap.states[0], { ...authMap.states[1], entryPath: '/' }] };
    const { code } = renderPom(shared, options);
    expect(code).toContain('  async openDashboard(): Promise<void> {\n    await this.navigate("/");\n  }');
    expect(code).toContain('async signIn(): Promise<void>');
  });
});

describe('Agent 05 verified flows in page objects', () => {
  const flowMap: PageMap = {
    ...map,
    version: 2,
    traces: [],
    flows: [
      {
        id: 'flow-a',
        name: 'startClickSubmitButtonFlow',
        state: 'start',
        usedBy: ['TC-001', 'TC-002'],
        actions: [{ element: 'codeInput', op: 'fill', param: 'codeInput' }, { element: 'submitButton', op: 'click' }],
      },
      {
        id: 'flow-b',
        name: 'dashboardReloadFlow',
        state: 'dashboard',
        usedBy: ['TC-003', 'TC-004'],
        actions: [{ element: 'codeInput', op: 'fill', param: 'codeInput' }, { op: 'reload' }],
      },
      {
        id: 'flow-c',
        name: 'startClickGhostFlow',
        state: 'start',
        usedBy: ['TC-005', 'TC-006'],
        actions: [{ element: 'ghost', op: 'click' }, { element: 'submitButton', op: 'click' }],
      },
    ],
  };
  const { code, contract } = renderPom(flowMap, { className: 'F01Page', basePageImport: '../../../pages/BasePage', projectSlug: 'sample' });

  it('renders flows as action-only methods built from verified members', () => {
    expect(code).toContain('  async startClickSubmitButtonFlow(values: { codeInput: string }): Promise<void> {\n'
      + '    await this.codeInput.fill(values.codeInput);\n    await this.submitButton.click();\n  }');
    expect(code).toContain('  async dashboardReloadFlow(values: { codeInput: string }): Promise<void> {\n'
      + '    await this.dashboardCodeInput.fill(values.codeInput);\n    await this.page.reload();\n  }');
    expect(code).not.toContain('expect(');
    expect(analyzeWithAST(code, FILE_TYPE.POM).findings.filter((f) => f.severity === FINDING_SEVERITY.BLOCKER)).toEqual([]);
  });

  it('exposes flows in the contract and drops flows whose elements are not verified', () => {
    const flows = contract.members.filter((member) => member.kind === MEMBER_KIND.FLOW);
    expect(flows.map((member) => member.name)).toEqual(['startClickSubmitButtonFlow', 'dashboardReloadFlow']);
    expect(flows[0]).toMatchObject({
      flowId: 'flow-a', params: ['codeInput'], actions: [{ member: 'codeInput', op: 'fill' }, { member: 'submitButton', op: 'click' }],
    });
    expect(flows[1].actions).toEqual([{ member: 'dashboardCodeInput', op: 'fill' }, { member: undefined, op: 'reload' }]);
  });

  it('never shadows a BasePage member', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../pages/BasePage.ts'), 'utf-8');
    const members = [...source.matchAll(/^ {2}(?:public |protected |private )?(?:async )?([_A-Za-z][_A-Za-z0-9]*)\s*[(:]/gm)].map((m) => m[1]);
    expect(members.length).toBeGreaterThan(10);
    expect(members.filter((name) => !RESERVED_MEMBERS.has(name))).toEqual([]);
  });
});

describe('Agent 05 shared setup hoisting', () => {
  const open = 'await featurePage.openStart();';
  const formVisible = 'await expect(featurePage.signInForm).toBeVisible();';
  const fill = 'await featurePage.codeInput.fill(data.validCode);';
  const click = 'await featurePage.submitButton.click();';
  const error = "await expect(featurePage.errorBanner).toHaveText('Access code is required');";

  it('moves identical leading statements into the hook and keeps the rest per test', () => {
    const result = hoistCommonPrefix([[open, formVisible, fill, click, error].join('\n'), [open, formVisible, click, error].join('\n')]);
    expect(result.hook).toEqual([open, formVisible]);
    expect(result.bodies).toEqual([[fill, click, error].join('\n'), [click, error].join('\n')]);
  });

  it('keeps at least one assertion in every test body', () => {
    const result = hoistCommonPrefix([[open, formVisible].join('\n'), [open, formVisible, click, error].join('\n')]);
    expect(result.hook).toEqual([open]);
    expect(result.bodies[0]).toBe(formVisible);
  });

  it('hoists nothing for a single test, a leading declaration or a browser-level statement', () => {
    expect(hoistCommonPrefix([[open, error].join('\n')]).hook).toEqual([]);
    const declared = 'const context = await browser.newContext();';
    expect(hoistCommonPrefix([[declared, error].join('\n'), [declared, error].join('\n')]).hook).toEqual([]);
    const browserCall = 'await browser.newContext();';
    expect(hoistCommonPrefix([[browserCall, error].join('\n'), [browserCall, error].join('\n')]).hook).toEqual([]);
  });

  it('renders the hook as beforeEach and the hoisted spec passes the review rules', () => {
    const body = [open, formVisible, click, error].join('\n');
    const tests = ['TC-007', 'TC-008'].map((tcKey) => ({ tc: { ...tc, tcKey }, body }));
    const hoisted = hoistCommonPrefix(tests.map((test) => test.body));
    const spec = renderUiSpec({
      projectSlug: 'sample',
      featureId: 'F-01',
      sourceReviewId: 'review-1',
      pageObject: 'F01Page',
      pomImport: '../pages/F01Page',
      fixtureImport: '../fixtures/test-data.json',
      envImport: '../../../helpers/env',
      hook: hoisted.hook,
      tests: tests.map((test, idx) => ({ tc: test.tc, body: hoisted.bodies[idx] })),
    });
    expect(hoisted.hook).toEqual([open, formVisible, click]);
    expect(spec).toContain(`  test.beforeEach(async ({ page, featurePage, data }) => {\n    ${open}`);
    const blockers = analyzeWithAST(spec, FILE_TYPE.SPEC, ['TC-007', 'TC-008']).findings.filter((f) => f.severity === FINDING_SEVERITY.BLOCKER);
    expect(blockers).toEqual([]);
  });
});
