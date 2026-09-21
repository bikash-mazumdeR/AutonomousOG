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

/** Outcome of a sign-in attempt. */
export interface AuthBootstrapResult {
  signedIn: boolean;
  /** Why the sign-in did not happen or did not work; safe to log and to show a human. */
  reason?: string;
}

/** The minimum a session must expose for the bootstrap to drive a form. */
export interface AuthenticatableSession {
  perform(element: PageElement, op: string, value?: string): Promise<void>;
  settle(afterInteraction?: boolean): Promise<void>;
  currentPath(): string;
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
 * Splits the profile's declared credential env vars into the identifier and the secret.
 * @param {Record<string, string>} credentialEnvVars - Profile binding, e.g. { validEmail: 'APP_EMAIL' }
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ identifier?: string, password?: string, missing: string[] }}
 */
export function resolveCredentials(
  credentialEnvVars: Record<string, string>,
  env: NodeJS.ProcessEnv,
): { identifier?: string; password?: string; missing: string[] } {
  const missing: string[] = [];
  let identifier: string | undefined;
  let password: string | undefined;
  for (const [key, envName] of Object.entries(credentialEnvVars || {})) {
    const value = env[envName];
    if (!value) {
      missing.push(envName);
      continue;
    }
    if (PASSWORD_KEY.test(key)) password = value;
    else if (!identifier) identifier = value;
  }
  return { identifier, password, missing };
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
 * @returns {Promise<AuthBootstrapResult>}
 */
export async function authenticateSession(
  session: AuthenticatableSession,
  state: PageState,
  credentialEnvVars: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AuthBootstrapResult> {
  const identifierField = findIdentifierField(state);
  const passwordField = findPasswordField(state);
  const submit = findSubmitControl(state);
  if (!identifierField || !passwordField || !submit) {
    return { signedIn: false, reason: `State "${state.name}" is not a sign-in form (no identifier, password and submit control).` };
  }

  const { identifier, password, missing } = resolveCredentials(credentialEnvVars, env);
  if (missing.length > 0) return { signedIn: false, reason: `Credential environment variable(s) not set: ${missing.join(', ')}.` };
  if (!identifier || !password) {
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
  return { signedIn: true };
}
