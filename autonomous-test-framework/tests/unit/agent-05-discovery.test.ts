/**
 * @fileoverview Live DOM discovery against a local, application-neutral static site (no internet needed).
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import {
  DiscoverySession, candidateLocators, elementBaseName, parseAriaSnapshotHead,
} from '../../agents/05-playwright-script-generator/discovery/domDiscovery';
import { discoverFeature } from '../../agents/05-playwright-script-generator/discovery/discoverFeature';
import { emptyPageMap, mergeState } from '../../agents/05-playwright-script-generator/discovery/pageMap';
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

/** A sign-in form: email, password and a submit control that lands on the dashboard. */
const AUTH_PAGE = `<!doctype html><html><body>
<form onsubmit="event.preventDefault(); location.href = '/dashboard.html';">
  <label for="email">Email</label><input id="email" type="email" />
  <label for="password">Password</label><input id="password" type="password" />
  <button type="submit">Sign in</button>
</form></body></html>`;

/** A sign-in form that lands on an account page showing the signed-in email. */
const ACCOUNT_AUTH_PAGE = `<!doctype html><html><body>
<form onsubmit="event.preventDefault(); location.href = '/account.html';">
  <label for="email">Email</label><input id="email" type="email" />
  <label for="password">Password</label><input id="password" type="password" />
  <button type="submit">Sign in</button>
</form></body></html>`;

/** The account page: the email is a role-less text node, as a user menu or account header shows it. */
const ACCOUNT_PAGE = `<!doctype html><html><body>
<h1>Account</h1>
<div>Signed in as <span>qa@example.test</span></div>
<button type="button">Sign out</button>
</body></html>`;

/**
 * The same sign-in form, mounted by script well after the page is interactive — the way a client-rendered login
 * page appears: a control is there at once, the form a beat later. The delay exceeds the DOM-quiet window, so the
 * entry capture holds a partial page.
 */
const LATE_AUTH_PAGE = `<!doctype html><html><body>
<button type="button">Help</button>
<div id="root"></div>
<script>
  setTimeout(() => {
    document.getElementById('root').innerHTML = '<form><label for="email">Email</label><input id="email" type="email" />'
      + '<label for="password">Password</label><input id="password" type="password" /><button type="submit">Sign in</button></form>';
    document.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); location.href = '/dashboard.html'; });
  }, 1500);
</script></body></html>`;

/**
 * A dashboard with a modal user menu and a confirmation dialog, built the way headless-UI libraries build them:
 * the menu and dialog are nameless containers, their entries are `menuitem`s named by their text, the dialog is
 * titled through `aria-labelledby`, and while the menu is open the rest of the page is `aria-hidden`.
 */
const MENU_PAGE = `<!doctype html><html><body>
<div id="app">
  <nav><button type="button">Blogs</button></nav>
  <h1>Dashboard</h1>
  <button type="button" aria-haspopup="menu" aria-expanded="false" onclick="openMenu()">B</button>
</div>
<div id="menu" role="menu" hidden>
  <div role="menuitem" tabindex="-1" onclick="openDialog()">Logout</div>
  <div role="menuitem" tabindex="-1">Profile</div>
</div>
<div id="dialog" role="alertdialog" aria-labelledby="dialog-title" aria-describedby="dialog-desc" hidden>
  <h2 id="dialog-title">Log out?</h2>
  <p id="dialog-desc">Are you sure you want to log out?</p>
  <button type="button">Cancel</button>
  <button type="button">Log out</button>
</div>
<script>
  function openMenu() { document.getElementById('menu').hidden = false; document.getElementById('app').setAttribute('aria-hidden', 'true'); }
  function openDialog() { document.getElementById('menu').hidden = true; document.getElementById('dialog').hidden = false; }
</script></body></html>`;

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

describe('Agent 05 discovery — accessible names and candidate locators', () => {
  const options = { testIdAttribute: undefined, dynamicIdPatterns: [] };

  it('reads the role and unescaped name of the element a snapshot was taken from', () => {
    expect(parseAriaSnapshotHead('- menuitem "Logout"')).toEqual({ role: 'menuitem', name: 'Logout' });
    expect(parseAriaSnapshotHead('- alertdialog "Log out?":\n  - heading "Log out?" [level=2]')).toEqual({ role: 'alertdialog', name: 'Log out?' });
    expect(parseAriaSnapshotHead('- heading "Dashboard" [level=1]')).toEqual({ role: 'heading', name: 'Dashboard' });
    expect(parseAriaSnapshotHead('- menuitem "Pro\\"file"')).toEqual({ role: 'menuitem', name: 'Pro"file' });
    expect(parseAriaSnapshotHead('- menu:\n  - menuitem "Logout"')).toEqual({ role: 'menu' });
    expect(parseAriaSnapshotHead('- text: Just text')).toBeNull();
    expect(parseAriaSnapshotHead('')).toBeNull();
  });

  it('addresses a container by role alone before its name, and a named element by role and name', () => {
    expect(candidateLocators({ tag: 'div', role: 'alertdialog', name: 'Log out?' }, options))
      .toEqual([{ strategy: 'role', args: ['alertdialog'] }, { strategy: 'role', args: ['alertdialog', 'Log out?'] }]);
    expect(candidateLocators({ tag: 'select', role: 'combobox' }, options)).toEqual([{ strategy: 'role', args: ['combobox'] }]);
    expect(candidateLocators({ tag: 'div', role: 'menu' }, options)).toEqual([{ strategy: 'role', args: ['menu'] }]);
    expect(candidateLocators({ tag: 'div', role: 'menuitem', name: 'Logout', text: 'Logout' }, options))
      .toEqual([{ strategy: 'role', args: ['menuitem', 'Logout'] }, { strategy: 'text', args: ['Logout'] }]);
  });

  it('never builds a role locator for an element outside the accessibility tree', () => {
    expect(candidateLocators({ tag: 'button', role: 'button', name: 'Blogs', text: 'Blogs', id: 'blogs', ariaHidden: true }, options))
      .toEqual([{ strategy: 'text', args: ['Blogs'] }, { strategy: 'id', args: ['blogs'] }]);
  });

  it('names elements by what identifies them, and nameless containers by their role', () => {
    expect(elementBaseName({ tag: 'div', role: 'menuitem', name: 'Logout' })).toBe('logoutMenuItem');
    expect(elementBaseName({ tag: 'div', role: 'alertdialog', name: 'Log out?' })).toBe('logOutDialog');
    expect(elementBaseName({ tag: 'div', role: 'menu' })).toBe('menu');
    expect(elementBaseName({ tag: 'div', role: 'alertdialog' })).toBe('alertdialog');
    expect(elementBaseName({ tag: 'p', role: 'alert', testId: 'error' })).toBe('errorElement');
    expect(elementBaseName({ tag: 'input', inputType: 'password' })).toBe('input');
  });
});

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
      if (req.url?.startsWith('/dashboard')) res.end(DASHBOARD_PAGE);
      else if (req.url?.startsWith('/menu')) res.end(MENU_PAGE);
      else if (req.url?.startsWith('/late-auth')) res.end(LATE_AUTH_PAGE);
      else if (req.url?.startsWith('/account-auth')) res.end(ACCOUNT_AUTH_PAGE);
      else if (req.url?.startsWith('/account')) res.end(ACCOUNT_PAGE);
      else if (req.url?.startsWith('/auth')) res.end(AUTH_PAGE);
      else res.end(START_PAGE);
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
      const state = await session.captureState([], '/', true);
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

  it('captures an open menu and an open dialog as their own states, with their own elements', async () => {
    const session = await DiscoverySession.open({ baseURL, dynamicIdPatterns: [] });
    const map = emptyPageMap('F-05');
    try {
      await session.goto('/menu.html');
      const dashboard = mergeState(map, await session.captureState(map.states, '/menu.html'));
      const onDashboard = Object.fromEntries(dashboard.elements.map((e) => [e.name, e]));
      expect([dashboard.name, dashboard.overlay]).toEqual(['menu', undefined]);
      expect(onDashboard.bButton).toMatchObject({ strategy: 'role', args: ['button', 'B'] });
      expect(onDashboard.blogsButton).toMatchObject({ strategy: 'role', args: ['button', 'Blogs'] });
      expect(onDashboard.menu).toBeUndefined();

      await session.perform(onDashboard.bButton, 'click');
      const menuOpen = mergeState(map, await session.captureState(map.states));
      const withMenu = Object.fromEntries(menuOpen.elements.map((e) => [e.name, e]));
      expect([menuOpen.name, menuOpen.overlay]).toEqual(['menuMenu', { role: 'menu' }]);
      expect(withMenu.menu).toMatchObject({ strategy: 'role', args: ['menu'], role: 'menu' });
      expect(withMenu.logoutMenuItem).toMatchObject({ strategy: 'role', args: ['menuitem', 'Logout'], accessibleName: 'Logout' });
      expect(withMenu.profileMenuItem).toMatchObject({ strategy: 'role', args: ['menuitem', 'Profile'] });
      // The page behind the modal menu is aria-hidden and inert: it belongs to the state underneath, not to this one.
      expect(withMenu.blogsButton).toBeUndefined();
      expect(withMenu.bButton).toBeUndefined();

      await session.perform(withMenu.logoutMenuItem, 'click');
      const dialogOpen = mergeState(map, await session.captureState(map.states));
      const withDialog = Object.fromEntries(dialogOpen.elements.map((e) => [e.name, e]));
      expect([dialogOpen.name, dialogOpen.overlay]).toEqual(['menuLogOutDialog', { role: 'alertdialog', name: 'Log out?' }]);
      expect(withDialog.logOutDialog).toMatchObject({ strategy: 'role', args: ['alertdialog'], accessibleName: 'Log out?' });
      expect(withDialog.logOutHeading).toMatchObject({ strategy: 'role', args: ['heading', 'Log out?'] });
      expect(withDialog.cancelButton).toMatchObject({ strategy: 'role', args: ['button', 'Cancel'] });
      expect(withDialog.logOutButton).toMatchObject({ strategy: 'role', args: ['button', 'Log out'] });

      // Three states at one address, and the entry state keeps its identity and its elements.
      expect(map.states.map((s) => [s.name, s.urlPath, s.entryPath])).toEqual([
        ['menu', '/menu.html', '/menu.html'], ['menuMenu', '/menu.html', undefined], ['menuLogOutDialog', '/menu.html', undefined],
      ]);
      expect(map.states[0].elements.map((e) => e.name)).toContain('blogsButton');
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

  it('records the sign-in it performed so the page object can reach the states behind it', async () => {
    process.env.SAMPLE_EMAIL = 'qa@example.test';
    process.env.SAMPLE_PASSWORD = 's3cret';
    const result = await discoverFeature({
      featureId: 'F-04',
      testCases: [],
      profile: {
        ...profile(),
        testIdAttribute: undefined,
        discovery: { entryPaths: ['/auth.html'], maxDepth: 1, executeTestSteps: false },
        auth: { strategy: 'form', credentialEnvVars: { validEmail: 'SAMPLE_EMAIL', validPassword: 'SAMPLE_PASSWORD' } },
      },
      pageMapFile: path.join(tmp, 'F-04.json'),
      fixtureValues: {},
      plannerSystemPrompt: 'planner',
      chat: jest.fn(),
      logger: console,
      authenticate: true,
    });

    expect(result.pageMap.states.map((s) => s.name)).toEqual(['auth', 'dashboard']);
    expect(result.pageMap.auth).toEqual({
      loginState: 'auth', signedInState: 'dashboard', identifier: 'emailInput', password: 'passwordInput', submit: 'signInButton', identifierEnv: 'SAMPLE_EMAIL', passwordEnv: 'SAMPLE_PASSWORD',
    });
    expect(JSON.stringify(result.pageMap)).not.toContain('s3cret');
  });

  it('waits for a sign-in form that mounts after the entry capture instead of judging the partial page', async () => {
    process.env.SAMPLE_EMAIL = 'qa@example.test';
    process.env.SAMPLE_PASSWORD = 's3cret';
    const warn = jest.fn();
    const result = await discoverFeature({
      featureId: 'F-05',
      testCases: [],
      profile: {
        ...profile(),
        testIdAttribute: undefined,
        discovery: { entryPaths: ['/late-auth.html'], maxDepth: 1, executeTestSteps: false },
        auth: { strategy: 'form', credentialEnvVars: { validEmail: 'SAMPLE_EMAIL', validPassword: 'SAMPLE_PASSWORD' } },
      },
      pageMapFile: path.join(tmp, 'F-05.json'),
      fixtureValues: {},
      plannerSystemPrompt: 'planner',
      chat: jest.fn(),
      logger: { ...console, warn },
      authenticate: true,
    });

    expect(warn).not.toHaveBeenCalled();
    expect(result.pageMap.states.map((s) => s.name)).toEqual(['lateAuth', 'dashboard']);
    expect(result.pageMap.auth).toMatchObject({ loginState: 'lateAuth', signedInState: 'dashboard', identifier: 'emailInput', password: 'passwordInput', submit: 'signInButton' });
    const login = result.pageMap.states.find((s) => s.name === 'lateAuth');
    expect(login?.elements.map((e) => e.name)).toEqual(expect.arrayContaining(['helpButton', 'emailInput', 'passwordInput', 'signInButton']));
  });

  it('establishes a precondition as step 0 and records the actions and the state it led to', async () => {
    const menuCase: AutomationTestCase = {
      ...signInCase('TC-006'),
      precondition: 'the user menu is open',
      steps: [{
        index: 1, keyword: 'When', action: 'the user clicks Logout in the user menu', expected: ['The "Log out?" dialog is displayed'], testData: '', data: [],
      }],
    };
    const plans = [
      { actions: [{ stepIndex: 0, element: 'bButton', op: 'click' }], stopReason: 'NEEDS_NEW_STATE', nextStep: 1 },
      { actions: [{ stepIndex: 1, element: 'logoutMenuItem', op: 'click' }], stopReason: 'COMPLETE' },
    ];
    const chat: ChatFn = jest.fn(async (messages) => {
      // The planner is handed the precondition as step 0.
      const request = JSON.parse(String(messages[messages.length - 1].content));
      expect(request.testCase.steps[0]).toMatchObject({ index: 0, action: 'Precondition: the user menu is open', expected: [] });
      return JSON.stringify(plans.shift());
    });
    const result = await discoverFeature({
      featureId: 'F-07',
      testCases: [menuCase],
      profile: { ...profile(), testIdAttribute: undefined, discovery: { entryPaths: ['/menu.html'], maxDepth: 1, executeTestSteps: true } },
      pageMapFile: path.join(tmp, 'F-07.json'),
      fixtureValues: {},
      plannerSystemPrompt: 'planner',
      chat,
      logger: console,
    });

    expect(result.issues.size).toBe(0);
    expect(result.pageMap.traces).toEqual([{
      tcKey: 'TC-006',
      runs: [
        { state: 'menu', reachedState: 'menuMenu', actions: [{ stepIndex: 0, state: 'menu', element: 'bButton', op: 'click' }] },
        { state: 'menuMenu', reachedState: 'menuLogOutDialog', actions: [{ stepIndex: 1, state: 'menuMenu', element: 'logoutMenuItem', op: 'click' }] },
      ],
      stateAfterStep: { 0: 'menuMenu', 1: 'menuLogOutDialog' },
    }]);
    expect(result.pageMap.flows).toEqual([]);
  });

  it('performs a goto step by requesting the known state\'s address and records its target', async () => {
    const gotoCase: AutomationTestCase = {
      ...signInCase('TC-011'),
      precondition: '',
      steps: [{
        index: 1, keyword: 'When', action: 'the user navigates to the dashboard address', expected: ['The Welcome heading is displayed'], testData: '', data: [],
      }],
    };
    const plans = [{ actions: [{ stepIndex: 1, op: 'goto', state: 'dashboard' }], stopReason: 'COMPLETE' }];
    const chat: ChatFn = jest.fn(async () => JSON.stringify(plans.shift()));
    const result = await discoverFeature({
      featureId: 'F-09',
      testCases: [gotoCase],
      profile: { ...profile(), discovery: { entryPaths: ['/', '/dashboard.html'], maxDepth: 1, executeTestSteps: true } },
      pageMapFile: path.join(tmp, 'F-09.json'),
      fixtureValues: {},
      plannerSystemPrompt: 'planner',
      chat,
      logger: console,
    });

    expect(result.issues.size).toBe(0);
    expect(result.pageMap.traces).toEqual([{
      tcKey: 'TC-011',
      runs: [{ state: 'start', reachedState: 'dashboard', actions: [{ stepIndex: 1, state: 'start', op: 'goto', target: 'dashboard' }] }],
      stateAfterStep: { 1: 'dashboard' },
    }]);
  });

  it('addresses the signed-in account identifier through its environment variable, never its value', async () => {
    process.env.SAMPLE_EMAIL = 'qa@example.test';
    process.env.SAMPLE_PASSWORD = 's3cret';
    const result = await discoverFeature({
      featureId: 'F-08',
      testCases: [],
      profile: {
        ...profile(),
        testIdAttribute: undefined,
        discovery: { entryPaths: ['/account-auth.html'], maxDepth: 1, executeTestSteps: false },
        auth: { strategy: 'form', credentialEnvVars: { validEmail: 'SAMPLE_EMAIL', validPassword: 'SAMPLE_PASSWORD' } },
      },
      pageMapFile: path.join(tmp, 'F-08.json'),
      fixtureValues: {},
      plannerSystemPrompt: 'planner',
      chat: jest.fn(),
      logger: console,
      authenticate: true,
    });

    const account = result.pageMap.states.find((s) => s.name === 'account');
    expect(account?.elements.find((e) => e.name === 'accountIdentifierText')).toMatchObject({
      strategy: 'env', args: ['SAMPLE_EMAIL'], tag: 'span', description: expect.stringContaining('read from SAMPLE_EMAIL at runtime'),
    });
    // The login state shows no identifier, and no page-map text carries the account's email.
    expect(result.pageMap.states.find((s) => s.name === 'accountAuth')?.elements.some((e) => e.strategy === 'env')).toBe(false);
    expect(JSON.stringify(result.pageMap)).not.toContain('qa@example.test');
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
