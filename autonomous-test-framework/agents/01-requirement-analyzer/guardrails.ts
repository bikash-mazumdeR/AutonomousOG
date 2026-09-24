'use strict';

/**
 * @fileoverview Deterministic output guardrails for Agent 01's LLM analysis. The prompt asks the model to keep secrets
 * out and to state only what the document says; these checks enforce both on the parsed analysis instead of trusting it.
 *  - secrets: sensitive test data values are dropped, and every known secret value is replaced by its placeholder
 *    wherever else it appears in the analysis
 *  - grounding: quoted text, URLs and multi-digit numbers in criteria, business rules and endpoints must appear in the
 *    requirement document; any that do not are reported at the approval gate
 */

import {
  KnownSecret, MIN_SECRET_LENGTH, profileSecrets, replaceSecrets,
} from '../../core/aut/knownSecrets';

export { KnownSecret, profileSecrets };

import { concreteClaims, normalizeForMatch as normalize } from '../../core/requirements/groundedText';

export { concreteClaims };

/** Prefix of every grounding warning, so a reused analysis can replace the warnings of an earlier check. */
export const UNGROUNDED_WARNING_PREFIX = 'Ungrounded:';
/** Prefix of every secret-redaction warning. */
export const SECRET_WARNING_PREFIX = 'Secrets:';

/** Test data names that always hold a secret, whatever the model set `sensitive` to. */
const SECRET_NAME = /pass(word|phrase)?|secret|token|api[-_]?key|credential/i;
/** A deliberately wrong value the requirement states for a negative case, which the tests need as written. */
const NEGATIVE_VALUE_NAME = /^(invalid|wrong|incorrect|bad|mismatch(ed)?|different)/i;

/** Whether a test data entry holds a secret: the model said so, or its name says so and it is not a negative value. */
function holdsSecret(data: any): boolean {
  if (data?.sensitive === true) return true;
  const name = String(data?.name || '');
  return SECRET_NAME.test(name) && !NEGATIVE_VALUE_NAME.test(name);
}
const PLACEHOLDER = (name: string) => `{{${name}}}`;

const storiesOf = (report: any): any[] => (report?.features || []).flatMap((f: any) => f?.userStories || []);
const textOf = (item: any): string => String(typeof item === 'string' ? item : item?.description ?? item?.text ?? '');

function replaceAll(text: string, secrets: KnownSecret[]): string {
  return replaceSecrets(text, secrets);
}

function redactDeep(node: any, secrets: KnownSecret[], counter: { replaced: number }): any {
  if (typeof node === 'string') {
    const redacted = replaceAll(node, secrets);
    if (redacted !== node) counter.replaced += 1;
    return redacted;
  }
  if (Array.isArray(node)) return node.map((item) => redactDeep(item, secrets, counter));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, redactDeep(value, secrets, counter)]));
  }
  return node;
}

/**
 * Drops the value of every sensitive test data entry (and marks entries whose name says they hold a secret as
 * sensitive), then replaces those values and the known secrets wherever else they appear in the analysis.
 * @param {any} report - Parsed analysis; its features, rules and ambiguities are replaced by redacted copies
 * @param {KnownSecret[]} knownSecrets - Secrets named by the AUT profile
 * @returns {{ secrets: KnownSecret[], warnings: string[] }} Every secret applied (to redact the requirement text the
 *   same way) and warnings that never contain a secret value
 */
export function redactSecrets(report: any, knownSecrets: KnownSecret[]): { secrets: KnownSecret[]; warnings: string[] } {
  const found: KnownSecret[] = [];
  let dropped = 0;
  for (const story of storiesOf(report)) {
    for (const data of story?.testDataValues || []) {
      if (!data || !holdsSecret(data)) continue;
      data.sensitive = true;
      const value = typeof data.value === 'string' ? data.value : '';
      if (value.length >= MIN_SECRET_LENGTH) found.push({ value, placeholder: PLACEHOLDER(String(data.name)) });
      if ('value' in data) {
        delete data.value;
        dropped += 1;
      }
    }
  }
  // Longest first, so a secret that contains another is replaced whole.
  const secrets = [...knownSecrets, ...found]
    .filter((secret, idx, all) => all.findIndex((other) => other.value === secret.value) === idx)
    .sort((a, b) => b.value.length - a.value.length);
  const counter = { replaced: 0 };
  for (const key of Object.keys(report || {})) report[key] = redactDeep(report[key], secrets, counter);
  const warnings = [
    ...(dropped > 0 ? [`${SECRET_WARNING_PREFIX} removed the value of ${dropped} sensitive test data entr${dropped === 1 ? 'y' : 'ies'}.`] : []),
    ...(counter.replaced > 0 ? [`${SECRET_WARNING_PREFIX} replaced secret values with placeholders in ${counter.replaced} place(s) of the analysis.`] : []),
  ];
  return { secrets, warnings };
}

/**
 * The same redaction applied to the requirement text, so grounding compares like with like.
 * @param {string} text
 * @param {KnownSecret[]} secrets
 * @returns {string}
 */
export function redactText(text: string, secrets: KnownSecret[]): string {
  return replaceAll(String(text || ''), secrets);
}

/**
 * Reports each concrete claim in the analysis that the requirement document does not contain: quoted wording, URLs
 * and numbers in acceptance criteria and business rules, and named integration endpoints.
 * @param {any} report - Analysis (already redacted)
 * @param {string} requirements - Requirement text (redacted the same way)
 * @returns {string[]} Warnings, each starting with UNGROUNDED_WARNING_PREFIX
 */
export function findUngroundedClaims(report: any, requirements: string): string[] {
  const source = normalize(requirements);
  const warnings: string[] = [];
  const check = (location: string, text: string) => {
    concreteClaims(text)
      .filter((claim) => !source.includes(normalize(claim)))
      .forEach((claim) => warnings.push(`${UNGROUNDED_WARNING_PREFIX} ${location} states "${claim}", which the requirement does not contain.`));
  };
  for (const story of storiesOf(report)) {
    (story?.acceptanceCriteria || []).forEach((item: any, idx: number) => check(`${story.id} AC-${idx + 1}`, textOf(item)));
    (story?.businessRules || []).forEach((item: any, idx: number) => check(`${story.id} BR-${idx + 1}`, textOf(item)));
  }
  (report?.businessRules || []).forEach((item: any, idx: number) => check(`${item?.id || `BR-${idx + 1}`}`, textOf(item)));
  (report?.integrationPoints || []).forEach((ip: any) => {
    const endpoint = String(ip?.endpoint || '').trim();
    if (endpoint && !/^n\/?a$/i.test(endpoint) && !source.includes(normalize(endpoint))) {
      warnings.push(`${UNGROUNDED_WARNING_PREFIX} ${ip.id || ip.name} endpoint "${endpoint}" is not named in the requirement.`);
    }
  });
  return warnings;
}
