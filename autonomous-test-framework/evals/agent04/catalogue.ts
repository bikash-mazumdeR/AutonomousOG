'use strict';

/**
 * @fileoverview Agent 04 catalogue. Agent 04 resolves placeholders with a deterministic value policy and makes no LLM
 * call, so its evaluation costs nothing and runs with the unit suite:
 *  - CLASSIFICATION: placeholder names — the ones Agent 02 really writes, plus deliberate traps — with the class a correct
 *    policy must give them in a project that declares its login credentials;
 *  - the precedence of value sources, and that no secret ever reaches the committed fixture (in the test).
 */

/** The class of a placeholder: where its value may come from. */
export type ExpectedClass = 'RUNTIME' | 'GROUNDED' | 'GENERATABLE';

/** A labelled placeholder name. */
export interface ClassificationCase {
  name: string;
  expected: ExpectedClass;
  why: string;
}

/** Credentials a typical project declares; the classes below assume them, as production would. */
export const CATALOGUE_PROFILE = {
  credentialEnvVars: { validEmail: 'APP_EMAIL', validPassword: 'APP_PASSWORD' },
  secretsEnvVars: ['APP_EMAIL', 'APP_PASSWORD', 'APP_TOKEN'],
};

/** Stand-in secret values for the environment variables above; the test checks none of them reaches the fixture. */
export const CATALOGUE_ENV: Record<string, string> = {
  APP_EMAIL: 'catalogue.user@example.test',
  APP_PASSWORD: 'Catalogue#Pass-2026',
  APP_TOKEN: 'catalogue-token-5f2c9a',
};

const secret = (why: string) => ({ expected: 'RUNTIME' as const, why });
const application = (why: string) => ({ expected: 'GROUNDED' as const, why });
const madeUp = (why: string) => ({ expected: 'GENERATABLE' as const, why });

export const CLASSIFICATION: ClassificationCase[] = [
  // Names Agent 02 wrote for the real Nexolvi suites
  { name: 'validEmail', ...secret('the login email the profile declares; generating one would sign in with no account') },
  { name: 'validPassword', ...secret('the account password') },
  { name: 'newPassword', ...secret('the password a test really sets on the account') },
  { name: 'updatedName', ...application('a value the application must show back; asked, never guessed') },
  { name: 'invalidPassword', ...madeUp('a deliberately wrong password') },
  { name: 'invalidEmail', ...madeUp('a deliberately malformed email') },
  { name: 'differentPassword', ...madeUp('any value that differs from the real password') },
  // Names Agent 02 wrote in the eval runs
  { name: 'mismatchedConfirmPassword', ...madeUp('a confirmation chosen to mismatch') },
  { name: 'shortPassword', ...madeUp('the shortest possible input') },
  { name: 'singleCharEmail', ...madeUp('a one-character input') },
  { name: 'tooLongPassword', ...madeUp('an input over any plausible limit') },
  { name: 'unusedEmail', ...madeUp('a fresh synthetic address') },
  { name: 'newEmail', ...madeUp('a fresh synthetic address') },
  // Values that depend on the application: asked unless the requirement or a human states them
  { name: 'minLengthPassword', ...application('its length is the documented minimum') },
  { name: 'maxLengthPassword', ...application('its length is the documented maximum') },
  { name: 'usernameMaxLength', ...application('the documented limit itself') },
  { name: 'errorMessage', ...application('text the application shows') },
  { name: 'loginErrorMessage', ...application('text the application shows') },
  { name: 'productName', ...application('data that must exist in the application') },
  { name: 'productId', ...application('data that must exist in the application') },
  { name: 'otherUserEmail', ...application('may be a real second account') },
  { name: 'dashboardUrl', ...application('an address of the application') },
  // Real secrets whose names could be mistaken for something else
  { name: 'apiToken', ...secret('an API credential') },
  { name: 'longLivedToken', ...secret('"long" here is not a boundary') },
  { name: 'resetToken', ...secret('a token the application issues') },
  { name: 'confirmPassword', ...secret('the real password, typed twice') },
  { name: 'currentPassword', ...secret('the real password') },
  { name: 'lockedOutUser', ...secret('a real account in a special state') },
  // Deliberate inputs whose names could be mistaken for secrets
  { name: 'invalidUser', ...madeUp('an account that does not exist') },
  { name: 'uppercaseUsername', ...madeUp('a letter-case variant of the stated username') },
  { name: 'wrongOtp', ...madeUp('a deliberately wrong code') },
  { name: 'sqlInjectionInput', ...madeUp('a boundary string') },
  { name: 'xssInput', ...madeUp('a boundary string') },
  { name: 'whitespaceUsername', ...madeUp('a boundary string') },
  { name: 'unicodeName', ...madeUp('a boundary string') },
  { name: 'invalidPhone', ...madeUp('a deliberately malformed phone number') },
  { name: 'validFirstName', ...madeUp('a synthetic personal name') },
  { name: 'randomEmail', ...madeUp('an arbitrary synthetic address') },
];
