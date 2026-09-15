/**
 * @fileoverview Live DOM discovery against a local, application-neutral static site (no internet needed).
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { DiscoverySession } from '../../agents/05-playwright-script-generator/discovery/domDiscovery';
import { discoverFeature } from '../../agents/05-playwright-script-generator/discovery/discoverFeature';
import { AutomationTestCase } from '../../agents/05-playwright-script-generator/contracts/automationTestCase';
import { ResolvedAutProfile } from '../../core/aut/AutProfile';
import { ChatFn } from '../../agents/05-playwright-script-generator/types';

jest.setTimeout(120000);

const START_PAGE = `<!doctype html><html><head><title>Sample</title></head><body>
<form data-qa="signin-form" onsubmit="event.preventDefault(); const v = document.querySelector('[data-qa=code]').value; if (!v) { const m = document.querySelector('[data-qa=error]'); m.textContent = 'Access code is required'; m.hidden = false; } else { location.href = '/dashboard.html'; }">
  <label for="code">Access code</label>
  <input id="code" data-qa="code" type="text" />
  <button type="submit" data-qa="submit">Sign in</button>
  <button type="button" id="ember12345">Help</button>
  <p data-qa="error" role="alert" hidden></p>
  <span data-qa="dup">A</span><span data-qa="dup">B</span>
</form></body></html>`;

const DASHBOARD_PAGE = '<!doctype html><html><body><h1 data-qa="welcome">Welcome</h1></body></html>';

const signInCase = (tcKey: string): AutomationTestCase => ({
  tcKey,
  title: 'Valid access code opens the dashboard',
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
      index: 2, keyword: 'When', action: 'the user signs in with a valid access code', expected: ['The dashboard is displayed'], testData: '{{validCode}}', data: [{ token: '{{validCode}}', fixtureKey: 'validCode' }],
    },
  ],
});

const signInPlans = () => [
  {
    actions: [
      { stepIndex: 2, element: 'codeInput', op: 'fill', value: { binding: '{{validCode}}' } },
      { stepIndex: 2, element: 'submitButton', op: 'click' },
    ],
    stopReason: 'NEEDS_NEW_STATE',
    nextStep: 3,
  },
  { actions: [], stopReason: 'COMPLETE' },
];

describe('Agent 05 live DOM discovery', () => {
  let server: http.Server;
  let baseURL: string;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-discovery-'));

  const profile = (): ResolvedAutProfile => ({
    projectId: 'sample',
    slug: 'sample',
    displayName: 'Sample',
    baseUrlEnv: 'SAMPLE_BASE_URL',
    baseURL,
    testIdAttribute: 'data-qa',
    browsers: ['chromium'],
    discovery: { entryPaths: ['/'], maxDepth: 2, executeTestSteps: true },
    auth: { strategy: 'none' },
    secretsEnvVars: [],
    couplingGuardTokens: [],
  });

  const discover = (featureId: string, testCases: AutomationTestCase[], plans: unknown[]) => {
    const chat: ChatFn = jest.fn(async () => JSON.stringify(plans.shift()));
    return discoverFeature({
      featureId, testCases, profile: profile(), pageMapFile: path.join(tmp, `${featureId}.json`), fixtureValues: { validCode: 'ABC123' }, plannerSystemPrompt: 'planner', chat, logger: console,
    });
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(req.url?.startsWith('/dashboard') ? DASHBOARD_PAGE : START_PAGE);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps only unique, stable locators in preference order', async () => {
    const session = await DiscoverySession.open({ baseURL, testIdAttribute: 'data-qa', dynamicIdPatterns: [] });
    try {
      await session.goto('/');
      const state = await session.captureState(new Set(), '/', true);
      const byName = Object.fromEntries(state.elements.map((e) => [e.name, e]));
      expect(state.name).toBe('start');
      expect(byName.codeInput).toMatchObject({ strategy: 'testId', args: ['code'] });
      expect(byName.submitButton).toMatchObject({ strategy: 'testId', args: ['submit'] });
      expect(byName.errorElement).toMatchObject({ strategy: 'testId', args: ['error'] });
      expect(byName.helpButton).toMatchObject({ strategy: 'role', args: ['button', 'Help'] });
      expect(state.elements.some((e) => e.args.includes('dup'))).toBe(false);
      expect(state.elements.some((e) => e.args.includes('ember12345'))).toBe(false);
    } finally {
      await session.close();
    }
  });

  it('reaches deeper states by executing planned steps and records the verified actions as a trace', async () => {
    const result = await discover('F-01', [signInCase('TC-001')], signInPlans());

    expect(result.issues.size).toBe(0);
    expect(result.pageMap.states.map((s) => [s.name, s.urlPath, s.entryPath])).toEqual([['start', '/', '/'], ['dashboard', '/dashboard.html', undefined]]);
    expect(result.pageMap.states[1].elements.map((e) => e.name)).toContain('welcomeHeading');
    expect(result.pageMap.version).toBe(2);
    expect(result.pageMap.traces).toEqual([{
      tcKey: 'TC-001',
      runs: [{
        state: 'start',
        reachedState: 'dashboard',
        actions: [
          { stepIndex: 2, state: 'start', element: 'codeInput', op: 'fill', value: { binding: '{{validCode}}' } },
          { stepIndex: 2, state: 'start', element: 'submitButton', op: 'click' },
        ],
      }],
      stateAfterStep: { 1: 'start', 2: 'dashboard' },
    }]);
    expect(result.pageMap.flows).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'F-01.json'), 'utf-8')).states).toHaveLength(2);
  });

  it('turns an action sequence two test cases performed identically into one verified flow', async () => {
    const result = await discover('F-03', [signInCase('TC-001'), signInCase('TC-002')], [...signInPlans(), ...signInPlans()]);

    expect(result.issues.size).toBe(0);
    expect(result.pageMap.flows).toEqual([expect.objectContaining({
      name: 'startClickSubmitButtonFlow',
      state: 'start',
      usedBy: ['TC-001', 'TC-002'],
      actions: [{ element: 'codeInput', op: 'fill', param: 'codeInput' }, { element: 'submitButton', op: 'click' }],
    })]);
  });

  it('reports unreachable applications as NEEDS_CONTEXT instead of guessing', async () => {
    const tc = { tcKey: 'TC-009', steps: [] } as unknown as AutomationTestCase;
    const result = await discoverFeature({
      featureId: 'F-02',
      testCases: [tc],
      profile: {
        projectId: 'sample', slug: 'sample', displayName: 'Sample', baseUrlEnv: 'SAMPLE_BASE_URL', baseURL: null, browsers: ['chromium'], discovery: { entryPaths: ['/'], maxDepth: 1, executeTestSteps: false }, auth: { strategy: 'none' }, secretsEnvVars: [], couplingGuardTokens: [],
      },
      pageMapFile: path.join(tmp, 'F-02.json'),
      fixtureValues: {},
      plannerSystemPrompt: 'planner',
      chat: jest.fn(),
      logger: console,
    });
    expect(result.issues.get('TC-009')).toEqual([{ kind: 'AUT_UNREACHABLE', detail: 'Environment variable SAMPLE_BASE_URL is not set.' }]);
  });
});
