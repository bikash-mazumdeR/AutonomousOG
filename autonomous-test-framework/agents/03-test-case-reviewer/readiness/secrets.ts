'use strict';

/**
 * @fileoverview Keeps secrets out of reviewed test cases. Reviewed test cases are written to feature files, which are
 * committed, and a secret can reach them three ways past Agent 02: a test case generated before Agent 02 rejected
 * secrets, a reviewer's edit, or a clarification answer written into a step. Each secret value is replaced by its
 * placeholder ({{validPassword}}), which the later agents resolve from the environment, so the test is unchanged.
 */

import { KnownSecret, redactValue, secretsIn } from '../../../core/aut/knownSecrets';

/** Fields of a test case that are identifiers, never content, and are left as they are. */
const IDENTITY_FIELDS: ReadonlySet<string> = new Set(['key', 'hash', 'featureId', 'userStoryId']);

/**
 * Replaces every secret value in a test case's content by its placeholder. Updates the test case in place.
 * @param {any} tc
 * @param {KnownSecret[]} secrets
 * @returns {string[]} Placeholders of the secrets that were found — never the values
 */
export function redactTestCaseSecrets(tc: any, secrets: KnownSecret[]): string[] {
  if (!tc || secrets.length === 0) return [];
  const content = Object.fromEntries(Object.entries(tc).filter(([field]) => !IDENTITY_FIELDS.has(field)));
  const found = secretsIn(JSON.stringify(content), secrets);
  if (found.length === 0) return [];
  Object.assign(tc, redactValue(content, secrets).value);
  return found;
}

/**
 * Redacts every test case of a review before it is saved.
 * @param {any[]} testCases
 * @param {KnownSecret[]} secrets
 * @returns {Array<{ tcKey: string, placeholders: string[] }>} The test cases that contained a secret
 */
export function redactReviewSecrets(testCases: any[], secrets: KnownSecret[]): Array<{ tcKey: string; placeholders: string[] }> {
  return (testCases || [])
    .map((tc) => ({ tcKey: String(tc?.key || ''), placeholders: redactTestCaseSecrets(tc, secrets) }))
    .filter((entry) => entry.placeholders.length > 0);
}
