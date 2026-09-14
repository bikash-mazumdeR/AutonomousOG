/**
 * @fileoverview Unit tests for deterministic page-object and spec rendering.
 */

import { AutomationTestCase } from '../../agents/05-playwright-script-generator/contracts/automationTestCase';
import { PageMap } from '../../agents/05-playwright-script-generator/discovery/pageMap';
import { pageObjectClassName, renderPom } from '../../agents/05-playwright-script-generator/rendering/pomRenderer';
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
