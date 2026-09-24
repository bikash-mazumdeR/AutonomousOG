'use strict';

/**
 * @fileoverview The secret values a project's AUT profile names, and their placeholders. Shared by every agent that
 * must keep secrets out of what it generates: Agent 01 redacts them from the analysis, Agent 02 rejects scenarios that
 * contain them.
 */

/** A secret value and the placeholder that replaces it, e.g. { value: 's3cret', placeholder: '{{validPassword}}' }. */
export interface KnownSecret {
  value: string;
  placeholder: string;
}

/** Shorter values are too likely to occur by chance to be treated as a secret wherever they appear. */
export const MIN_SECRET_LENGTH = 4;

const PLACEHOLDER = (name: string) => `{{${name}}}`;

/**
 * The secret values the AUT profile names: each credential binding under its own name ({{validPassword}}), and every
 * other listed secret under its environment variable name. Unset variables are skipped.
 * @param {{ auth?: { credentialEnvVars?: Record<string, string> }, secretsEnvVars?: string[] } | undefined} profile
 * @param {NodeJS.ProcessEnv} env
 * @returns {KnownSecret[]}
 */
export function profileSecrets(
  profile: { auth?: { credentialEnvVars?: Record<string, string> }; secretsEnvVars?: string[] } | undefined,
  env: NodeJS.ProcessEnv,
): KnownSecret[] {
  const bindings = Object.entries(profile?.auth?.credentialEnvVars || {});
  const bound = new Map(bindings.map(([key, envName]) => [envName, key]));
  const envNames = [...new Set([...bindings.map(([, envName]) => envName), ...(profile?.secretsEnvVars || [])])];
  return envNames
    .map((envName) => ({ value: String(env[envName] || ''), placeholder: PLACEHOLDER(bound.get(envName) || envName) }))
    .filter((secret) => secret.value.length >= MIN_SECRET_LENGTH);
}

/**
 * Replaces every secret value in a text by its placeholder, longest secret first so one containing another is
 * replaced whole.
 * @param {string} text
 * @param {KnownSecret[]} secrets
 * @returns {string}
 */
export function replaceSecrets(text: string, secrets: KnownSecret[]): string {
  return [...secrets]
    .sort((a, b) => b.value.length - a.value.length)
    .reduce((out, secret) => out.split(secret.value).join(secret.placeholder), String(text ?? ''));
}

/**
 * The secrets a text contains, by placeholder — never by value, so the result is safe to log or show.
 * @param {string} text
 * @param {KnownSecret[]} secrets
 * @returns {string[]} Placeholders of the secrets found, e.g. ['{{validPassword}}']
 */
export function secretsIn(text: string, secrets: KnownSecret[]): string[] {
  return [...new Set(secrets.filter((secret) => secret.value && String(text ?? '').includes(secret.value)).map((secret) => secret.placeholder))];
}
