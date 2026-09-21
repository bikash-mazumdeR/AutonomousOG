'use strict';

/**
 * @fileoverview Signs discovery in, so the states behind a login form can be discovered.
 *
 * Discovery can only generate against what it has verified. Everything behind authentication — a
 * dashboard, a user menu, a logout confirmation — is unreachable from the login page, and the
 * navigation planner cannot sign in by itself: credentials are deliberately kept out of test data
 * and fixtures, so the planner has nothing to plan the sign-in with and correctly refuses to invent
 * one. The AUT profile already declares how the application authenticates, in auth.strategy and
 * auth.credentialEnvVars. This performs that sign-in deterministically — no LLM call, no guessed
 * selectors, and no credential written to the page map, the fixtures or the logs.
 *
 * @module AuthBootstrap
 */

import { PageElement, PageState } from './pageMap';

/** Accessible names that submit a sign-in form. */
const SUBMIT_NAME = /\b(sign[\s-]?in|log[\s-]?in|login|continue|submit)\b/i;

/** A credential env var whose name marks it as the secret half of the pair. */
const PASSWORD_KEY = /pass(word|phrase)?$/i;

/** The verified form a sign-in was performed with: element names and the environment variables the values came from. */
export interface SignInForm {
  identifier: string;
  password: string;
  submit: string;
  identifierEnv: string;
  passwordEnv: string;
}

/** Outcome of a sign-in attempt. */
export interface AuthBootstrapResult {
  signedIn: boolean;
  /** Why the sign-in did not happen or did not work; safe to log and to show a human. */
  reason?: string;
  /** Set when signed in: what was used, so the page object can render the same sign-in. */
  form?: SignInForm;
}

/** The minimum a session must expose for the bootstrap to drive a form. */
export interface AuthenticatableSession {
  perform(element: PageElement, op: string, value?: string): Promise<void>;
  settle(afterInteraction?: boolean): Promise<void>;
  currentPath(): string;
}

/** The three verified controls a sign-in is performed with. */
export interface SignInControls {
  identifierField: PageElement;
  passwordField: PageElement;
  submit: PageElement;
}

/**
 * How long, and how, to wait for a sign-in form that the first capture did not hold in full.
 *
 * A client-rendered login page is captured as soon as its first interactive element exists and the DOM has been
 * quiet for a moment; a form whose fields mount a beat later is then a partial capture, not a page without a form.
 * Judging that capture reports "not a sign-in form" for a page that is one — flakily, per test case.
 */
export interface SignInFormWait {
  /** Captures the current state again; the fresh capture replaces the partial one. */
  recapture: () => Promise<PageState>;
  /** Overall time the form is given to mount, typically the navigation budget. */
  budgetMs: number;
  /** Pause between captures. */
  pollMs: number;
}

/**
 * The password field of a verified state.
 * @param {PageState} state
 * @returns {PageElement | undefined}
 */
export function findPasswordField(state: PageState): PageElement | undefined {
  return state.elements.find((element) => element.inputType === 'password');
}

/**
 * The field that carries the account identifier — the text or email input that is not the password.
 * @param {PageState} state
 * @returns {PageElement | undefined}
 */
export function findIdentifierField(state: PageState): PageElement | undefined {
  return state.elements.find((element) => element.tag === 'input'
    && element.inputType !== 'password'
    && ['text', 'email', 'tel', undefined].includes(element.inputType));
}

/**
 * The control that submits the form.
 * @param {PageState} state
 * @returns {PageElement | undefined}
 */
export function findSubmitControl(state: PageState): PageElement | undefined {
  return state.elements.find((element) => (element.role === 'button' || element.tag === 'button')
    && SUBMIT_NAME.test(element.accessibleName || ''));
}

/**
 * The sign-in controls of a state, or undefined while any of the three is missing.
 * @param {PageState} state
 * @returns {SignInControls | undefined}
 */
export function findSignInControls(state: PageState): SignInControls | undefined {
  const identifierField = findIdentifierField(state);
  const passwordField = findPasswordField(state);
  const submit = findSubmitControl(state);
  return identifierField && passwordField && submit ? { identifierField, passwordField, submit } : undefined;
}

/**
 * Waits for a state to hold the whole sign-in form, re-capturing it while it does not and the budget allows.
 * Without a wait, the state is judged as captured.
 * @param {PageState} state - The state as first captured
 * @param {SignInFormWait} [wait]
 * @returns {Promise<{ state: PageState, controls?: SignInControls }>} The last capture and its controls, if complete
 */
export async function awaitSignInForm(state: PageState, wait?: SignInFormWait): Promise<{ state: PageState; controls?: SignInControls }> {
  let current = state;
  let controls = findSignInControls(current);
  if (!wait) return { state: current, controls };
  const deadline = Date.now() + wait.budgetMs;
  while (!controls && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- each capture waits for the previous one; the form mounts once
    await new Promise<void>((resolve) => { setTimeout(resolve, wait.pollMs); });
    // eslint-disable-next-line no-await-in-loop
    current = await wait.recapture();
    controls = findSignInControls(current);
  }
  return { state: current, controls };
}

/**
 * Splits the profile's declared credential env vars into the identifier and the secret.
 * @param {Record<string, string>} credentialEnvVars - Profile binding, e.g. { validEmail: 'APP_EMAIL' }
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ identifier?: string, password?: string, identifierEnv?: string, passwordEnv?: string, missing: string[] }}
 *   The values, the variables they came from, and the variables that are not set
 */
export function resolveCredentials(
  credentialEnvVars: Record<string, string>,
  env: NodeJS.ProcessEnv,
): { identifier?: string; password?: string; identifierEnv?: string; passwordEnv?: string; missing: string[] } {
  const missing: string[] = [];
  let identifier: string | undefined;
  let password: string | undefined;
  let identifierEnv: string | undefined;
  let passwordEnv: string | undefined;
  for (const [key, envName] of Object.entries(credentialEnvVars || {})) {
    const value = env[envName];
    if (!value) {
      missing.push(envName);
      continue;
    }
    if (PASSWORD_KEY.test(key)) [password, passwordEnv] = [value, envName];
    else if (!identifier) [identifier, identifierEnv] = [value, envName];
  }
  return {
    identifier, password, identifierEnv, passwordEnv, missing,
  };
}

/**
 * Signs in on a verified login state, leaving the session authenticated for the rest of discovery.
 *
 * Returns a reason instead of throwing when the state is not a sign-in form or the credentials are
 * not configured: an application without authentication, or one whose entry page is not the login
 * page, is a normal case and must not fail the run.
 *
 * @param {AuthenticatableSession} session
 * @param {PageState} state - The verified state to sign in on
 * @param {Record<string, string>} credentialEnvVars - From the AUT profile
 * @param {NodeJS.ProcessEnv} [env]
 * @param {SignInFormWait} [wait] - Re-captures the state while the form has not finished mounting
 * @returns {Promise<AuthBootstrapResult>}
 */
export async function authenticateSession(
  session: AuthenticatableSession,
  state: PageState,
  credentialEnvVars: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
  wait?: SignInFormWait,
): Promise<AuthBootstrapResult> {
  const { state: captured, controls } = await awaitSignInForm(state, wait);
  if (!controls) {
    const waited = wait ? ` after waiting ${wait.budgetMs} ms for it to render` : '';
    return { signedIn: false, reason: `State "${captured.name}" is not a sign-in form (no identifier, password and submit control${waited}).` };
  }
  const { identifierField, passwordField, submit } = controls;

  const {
    identifier, password, identifierEnv, passwordEnv, missing,
  } = resolveCredentials(credentialEnvVars, env);
  if (missing.length > 0) return { signedIn: false, reason: `Credential environment variable(s) not set: ${missing.join(', ')}.` };
  if (!identifier || !password || !identifierEnv || !passwordEnv) {
    return { signedIn: false, reason: 'The profile must bind one identifier and one password in auth.credentialEnvVars.' };
  }

  const before = session.currentPath();
  await session.perform(identifierField, 'fill', identifier);
  await session.perform(passwordField, 'fill', password);
  await session.perform(submit, 'click');
  await session.settle(true);

  if (session.currentPath() === before) {
    return { signedIn: false, reason: `Sign-in left the browser on ${before}; the credentials may be rejected or the form may need another step.` };
  }
  return {
    signedIn: true,
    form: {
      identifier: identifierField.name, password: passwordField.name, submit: submit.name, identifierEnv, passwordEnv,
    },
  };
}
