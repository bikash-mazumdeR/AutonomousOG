/**
 * @fileoverview Sign-in bootstrap: drives a verified login form from profile-declared environment variables and
 * reports what it used, so the page object can render the same sign-in. No browser — the session is a fake.
 */

import {
  AuthenticatableSession, authenticateSession, resolveCredentials, signedInStarts,
} from '../../agents/05-playwright-script-generator/discovery/authBootstrap';
import { PageElement, PageState } from '../../agents/05-playwright-script-generator/discovery/pageMap';

const loginState = (): PageState => ({
  name: 'login',
  urlPath: '/login',
  entryPath: '/login',
  elements: [
    {
      name: 'workEmailInput', strategy: 'placeholder', args: ['you@company.com'], tag: 'input', role: 'textbox', inputType: 'email',
    },
    {
      name: 'passwordInput', strategy: 'placeholder', args: ['Enter your password'], tag: 'input', inputType: 'password',
    },
    {
      name: 'signInButton', strategy: 'role', args: ['button', 'Sign in'], tag: 'button', role: 'button', accessibleName: 'Sign in',
    },
  ],
});

/** A session whose path changes once the submit control is clicked. */
function fakeSession(): AuthenticatableSession & { actions: string[] } {
  let pathname = '/login';
  const actions: string[] = [];
  return {
    actions,
    async perform(element: PageElement, op: string, value?: string) {
      actions.push(`${op} ${element.name}${value !== undefined ? ` <${value}>` : ''}`);
      if (op === 'click') pathname = '/';
    },
    async settle() {},
    currentPath: () => pathname,
  };
}

const env = { APP_EMAIL: 'qa@example.test', APP_PASSWORD: 's3cret' };
const credentialEnvVars = { validEmail: 'APP_EMAIL', validPassword: 'APP_PASSWORD' };

describe('Agent 05 sign-in bootstrap', () => {
  it('resolves the identifier and the password with the variables they came from', () => {
    expect(resolveCredentials(credentialEnvVars, env)).toEqual({
      identifier: 'qa@example.test', password: 's3cret', identifierEnv: 'APP_EMAIL', passwordEnv: 'APP_PASSWORD', missing: [],
    });
    expect(resolveCredentials(credentialEnvVars, { APP_EMAIL: 'qa@example.test' }).missing).toEqual(['APP_PASSWORD']);
  });

  it('signs in with the verified form and reports the members and variables it used', async () => {
    const session = fakeSession();
    const result = await authenticateSession(session, loginState(), credentialEnvVars, env);
    expect(result).toEqual({
      signedIn: true,
      form: {
        identifier: 'workEmailInput', password: 'passwordInput', submit: 'signInButton', identifierEnv: 'APP_EMAIL', passwordEnv: 'APP_PASSWORD',
      },
    });
    expect(session.actions).toEqual(['fill workEmailInput <qa@example.test>', 'fill passwordInput <s3cret>', 'click signInButton']);
  });

  it('re-captures a partially mounted form until it is complete, then signs in with the fresh capture', async () => {
    const partial = { ...loginState(), elements: loginState().elements.slice(0, 1) };
    const captures = [partial, loginState()];
    const recapture = jest.fn(async () => captures.shift() || loginState());
    const session = fakeSession();
    const result = await authenticateSession(session, partial, credentialEnvVars, env, { recapture, budgetMs: 2000, pollMs: 1 });
    expect(result.signedIn).toBe(true);
    // The first re-capture is still partial, the second holds the form: no judgement in between.
    expect(recapture).toHaveBeenCalledTimes(2);
    expect(session.actions).toEqual(['fill workEmailInput <qa@example.test>', 'fill passwordInput <s3cret>', 'click signInButton']);
  });

  it('gives up on a form that never completes only once the budget is spent, and says so', async () => {
    const partial = { ...loginState(), elements: loginState().elements.slice(0, 1) };
    const recapture = jest.fn(async () => partial);
    const result = await authenticateSession(fakeSession(), partial, credentialEnvVars, env, { recapture, budgetMs: 30, pollMs: 5 });
    expect(result).toEqual({
      signedIn: false, reason: 'State "login" is not a sign-in form (no identifier, password and submit control after waiting 30 ms for it to render).',
    });
    expect(recapture.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('reports a state without a sign-in form, and missing variables, instead of guessing', async () => {
    const noForm = { ...loginState(), elements: loginState().elements.slice(0, 1) };
    expect(await authenticateSession(fakeSession(), noForm, credentialEnvVars, env)).toEqual({
      signedIn: false, reason: 'State "login" is not a sign-in form (no identifier, password and submit control).',
    });
    expect(await authenticateSession(fakeSession(), loginState(), credentialEnvVars, {})).toEqual({
      signedIn: false, reason: 'Credential environment variable(s) not set: APP_EMAIL, APP_PASSWORD.',
    });
  });
});

describe('signedInStarts', () => {
  const credentials = { validEmail: 'APP_EMAIL', validPassword: 'APP_PASSWORD' };
  const cases = (...preconditions: string[]) => preconditions.map((precondition, i) => ({ tcKey: `TC-00${i + 1}`, precondition }));

  it('signs in test cases behind the login form and leaves the ones on the sign-in form signed out', () => {
    const profileFeature = cases(
      'the user navigates to "https://app.example.test/login"',
      'the user is on the login page at "https://app.example.test/login"',
      'the user is authenticated and on the Dashboard at "https://app.example.test/"',
      'the user has the My Profile modal open',
      'the user is not logged in',
    );
    expect([...signedInStarts(profileFeature, credentials)].sort()).toEqual(['TC-003', 'TC-004']);
  });

  it('signs in a precondition that narrates a sign-out, so the planner can perform it', () => {
    const logoutFeature = cases(
      'the authenticated user is on the Dashboard at https://app.example.test/',
      'the user has completed the logout flow and is on the Login page at https://app.example.test/',
    );
    expect([...signedInStarts(logoutFeature, credentials)].sort()).toEqual(['TC-001', 'TC-002']);
  });

  it('keeps a feature whose preconditions never mention a session signed out', () => {
    expect(signedInStarts(cases('the user navigates to https://app.example.test', 'the user has the modal open'), credentials).size).toBe(0);
  });

  it('never signs in without declared credentials, and signs everything in when --authenticate is passed', () => {
    const feature = cases('the user is authenticated', 'the user is on the login page');
    expect(signedInStarts(feature, {}).size).toBe(0);
    expect([...signedInStarts(feature, {}, true)].sort()).toEqual(['TC-001', 'TC-002']);
  });
});
