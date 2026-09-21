/**
 * @fileoverview Sign-in bootstrap: drives a verified login form from profile-declared environment variables and
 * reports what it used, so the page object can render the same sign-in. No browser — the session is a fake.
 */

import {
  AuthenticatableSession, authenticateSession, resolveCredentials,
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
    expect(recapture.mock.calls.length).toBeGreaterThanOrEqual(2);
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
