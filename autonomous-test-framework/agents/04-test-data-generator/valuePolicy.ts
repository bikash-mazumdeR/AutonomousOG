'use strict';

/**
 * @fileoverview Agent 04 value policy: where the value of a {{placeholder}} may come from, in order —
 *   1. a human answer to an Agent 04 clarification, or an earlier UI override of the unchanged test case
 *   2. the requirement (Agent 01 `testDataValues`)
 *   3. the AUT profile (base URL and credential environment variables)
 *   4. memory and generation — synthetic (GENERATABLE) inputs only
 *   5. otherwise unresolved, and asked.
 * Credentials and secrets are bound to environment variables and never stored as values.
 */

import { isEnvVarName, toEnvVarName } from '../../core/aut/envVarNames';
import { RUNTIME_TYPE, VALUE_SOURCE } from './constants';
import {
  ARBITRARY_WORDS, CASE_WORDS, NEGATIVE_WORDS, RUNTIME_SENTINEL, VALUE_CLASS, ValueClass,
  classifyPlaceholder, deriveGenericValue, resolveByIntent, splitPlaceholderWords,
} from './placeholderIntent';
import {
  AnswerIndex, OverrideIndex, RequirementValue, answerFor, overrideFor, requirementValueFor, statedUsername,
} from './valueSources';

/** A resolved manifest input. */
export interface ValueEntry {
  value: unknown;
  type: string;
  sensitive: boolean;
  source: string;
  note: string;
  valueClass: ValueClass;
  /** Environment variable read at runtime (runtime entries only). */
  envVar?: string;
  /** Which source named the environment variable (runtime entries only). */
  origin?: string;
}

/** AUT profile settings the policy uses. */
export interface ProfileValues {
  baseUrlEnv?: string;
  credentialEnvVars: Record<string, string>;
  secretsEnvVars: string[];
  /** The project stores credentials as fixture values (AUT profile `auth.credentialStorage: "fixture"`). */
  credentialsInFixture?: boolean;
}

/** Everything a placeholder may be resolved from, for one test case. */
export interface PolicyContext {
  tc: any;
  seed: string;
  answers: AnswerIndex;
  overrides: OverrideIndex;
  requirementValues: RequirementValue[];
  endpoints: string[];
  profile: ProfileValues | null;
  memory: Record<string, unknown>;
  /** Only checked for the presence of variables; values are never read. */
  env: Record<string, string | undefined>;
}

/** An environment variable a runtime binding needs but that is neither declared nor set. */
export interface EnvIssue {
  name: string;
  envVar: string;
}

/** Outcome of resolving one placeholder. */
export interface PolicyResult {
  valueClass: ValueClass;
  entry: ValueEntry | null;
  reason?: string;
  envIssue?: EnvIssue;
}

const SYNTHETIC = Object.freeze({
  EMAIL_DOMAIN: 'example.test',
  MALFORMED_EMAIL: 'notanemail.nodomain',
  MALFORMED_PHONE: 'INVALID-PHONE-ABC',
  NEGATIVE_AMOUNT: '-1',
  MALFORMED_JSON: '{ broken json }',
  LONG_STRING_LENGTH: 1001,
  SPECIAL_CHARS: '#%&<>!@$^*()',
  UNICODE: '🚀 中文 العربية Ñ',
  WHITESPACE: '   ',
  SQL_INJECTION: "' OR '1'='1'; DROP TABLE users;--",
  XSS: "<script>alert('aria-xss-test')</script>",
  DAY_MS: 86400000,
  HOUR_SECONDS: 3600,
});

const FIRST_NAMES = Object.freeze(['Priya', 'Amit', 'Sneha', 'Rahul', 'Anjali', 'Vikram', 'Kavya', 'Arjun', 'Meena', 'Suresh']);
const LAST_NAMES = Object.freeze(['Sharma', 'Patel', 'Verma', 'Singh', 'Kumar', 'Gupta', 'Iyer', 'Nair', 'Reddy', 'Joshi']);

const BOUNDARY_GENERATORS: ReadonlyArray<[readonly string[], () => string]> = [
  [['long'], () => 'A'.repeat(SYNTHETIC.LONG_STRING_LENGTH)],
  [['special'], () => SYNTHETIC.SPECIAL_CHARS],
  [['unicode'], () => SYNTHETIC.UNICODE],
  [['whitespace'], () => SYNTHETIC.WHITESPACE],
  [['sql', 'injection'], () => SYNTHETIC.SQL_INJECTION],
  [['xss', 'script'], () => SYNTHETIC.XSS],
];

const UNRESOLVED_REASON: Readonly<Record<ValueClass, (key: string) => string>> = Object.freeze({
  [VALUE_CLASS.RUNTIME]: (key: string) => `{{${key}}} is a credential or secret; tests read it from an environment variable, but none is declared in the AUT profile, named in an answer or set.`,
  [VALUE_CLASS.GROUNDED]: (key: string) => `{{${key}}} must match the application under test, and no answer, requirement value or AUT profile setting provides it.`,
  [VALUE_CLASS.GENERATABLE]: (key: string) => `No synthetic value can be derived for {{${key}}}.`,
});

function includesAny(words: string[], vocabulary: readonly string[]): boolean {
  return words.some((word) => vocabulary.includes(word));
}

/**
 * Best-effort data type of a value.
 * @param {string} key
 * @param {unknown} value
 * @returns {string}
 */
export function inferDataType(key: string, value: unknown): string {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (value === RUNTIME_SENTINEL) return RUNTIME_TYPE;
  if (/email/i.test(key)) return 'email';
  if (/url/i.test(key)) return 'url';
  if (/phone/i.test(key)) return 'phone';
  if (/date/i.test(key)) return 'date';
  if (/amount|price|cost/i.test(key)) return 'currency';
  if (typeof value === 'string' && value.startsWith('{')) return 'json';
  return 'string';
}

function literalEntry(key: string, value: unknown, source: string, valueClass: ValueClass, note: string): ValueEntry {
  return { value, type: inferDataType(key, value), sensitive: false, source, note, valueClass };
}

function runtimeEntry(envVar: string, origin: string, valueClass: ValueClass, note: string, sensitive = true): ValueEntry {
  return { value: RUNTIME_SENTINEL, type: RUNTIME_TYPE, sensitive, source: VALUE_SOURCE.RUNTIME, origin, envVar, note, valueClass };
}

function declaredEnvVar(key: string, profile: ProfileValues | null): string | null {
  if (!profile) return null;
  const declared = Object.entries(profile.credentialEnvVars).find(([name]) => name.toLowerCase() === key.toLowerCase());
  if (declared) return declared[1];
  const conventional = toEnvVarName(key);
  return profile.secretsEnvVars.includes(conventional) ? conventional : null;
}

function fromHuman(key: string, valueClass: ValueClass, ctx: PolicyContext): ValueEntry | null {
  const answer = answerFor(ctx.answers, key, ctx.tc.key);
  if (answer && valueClass !== VALUE_CLASS.RUNTIME) {
    return literalEntry(key, answer.value, VALUE_SOURCE.CLARIFICATION, valueClass, `Answered in clarification ${answer.clarificationId}`);
  }
  if (answer && isEnvVarName(answer.value)) {
    return runtimeEntry(answer.value, VALUE_SOURCE.CLARIFICATION, valueClass, `Environment variable named in clarification ${answer.clarificationId}`);
  }
  const override = overrideFor(ctx.overrides, key, ctx.tc.key);
  if (!override) return null;
  if (valueClass !== VALUE_CLASS.RUNTIME) return { ...override, valueClass };
  return override.envVar ? runtimeEntry(override.envVar, VALUE_SOURCE.USER_OVERRIDE, valueClass, 'Environment variable set in the Agent 04 UI') : null;
}

function boundToEnvironment(key: string, valueClass: ValueClass, ctx: PolicyContext, note: string): PolicyResult {
  const declared = declaredEnvVar(key, ctx.profile);
  const envVar = declared || toEnvVarName(key);
  const envIssue = !declared && ctx.env[envVar] === undefined ? { name: key, envVar } : undefined;
  return { valueClass, entry: runtimeEntry(envVar, VALUE_SOURCE.REQUIREMENT, valueClass, note), envIssue };
}

function fromRequirement(key: string, valueClass: ValueClass, ctx: PolicyContext): PolicyResult | null {
  const stated = requirementValueFor(ctx.requirementValues, key, ctx.tc);
  if (!stated) return null;
  const where = stated.sourceRef || 'the requirement';
  if (valueClass === VALUE_CLASS.RUNTIME || (stated.sensitive && !ctx.profile?.credentialsInFixture)) {
    return boundToEnvironment(key, valueClass, ctx, `Credential stated in ${where}; read from the environment, never stored`);
  }
  if (stated.value === undefined) return null;
  return { valueClass, entry: literalEntry(key, stated.value, VALUE_SOURCE.REQUIREMENT, valueClass, `Copied from ${where}`) };
}

function fromProfile(key: string, valueClass: ValueClass, ctx: PolicyContext): PolicyResult | null {
  const words = splitPlaceholderWords(key);
  if (words.includes('base') && words.includes('url') && ctx.profile?.baseUrlEnv) {
    return { valueClass, entry: runtimeEntry(ctx.profile.baseUrlEnv, VALUE_SOURCE.PROFILE, valueClass, 'Base URL environment variable from the AUT profile', false) };
  }
  if (words.includes('endpoint') && ctx.endpoints.length === 1) {
    return { valueClass, entry: literalEntry(key, ctx.endpoints[0], VALUE_SOURCE.REQUIREMENT, valueClass, 'The only endpoint the requirement documents') };
  }
  if (valueClass !== VALUE_CLASS.RUNTIME) return null;
  const declared = declaredEnvVar(key, ctx.profile);
  if (declared) return { valueClass, entry: runtimeEntry(declared, VALUE_SOURCE.PROFILE, valueClass, 'Environment variable declared in the AUT profile') };
  const conventional = toEnvVarName(key);
  if (ctx.env[conventional] === undefined) return null;
  return { valueClass, entry: runtimeEntry(conventional, VALUE_SOURCE.ENVIRONMENT, valueClass, 'Environment variable is set') };
}

function buildExpiredJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ sub: 'aria_test_user', iat: now - 2 * SYNTHETIC.HOUR_SECONDS, exp: now - SYNTHETIC.HOUR_SECONDS });
  return `${header}.${payload}.ARIA_TEST_INVALID_SIGNATURE`;
}

function negativeValue(words: string[], seed: string): string | null {
  if (words.includes('phone')) return SYNTHETIC.MALFORMED_PHONE;
  if (includesAny(words, ['amount', 'price', 'cost', 'quantity'])) return SYNTHETIC.NEGATIVE_AMOUNT;
  if (includesAny(words, ['payload', 'json', 'body'])) return SYNTHETIC.MALFORMED_JSON;
  if (includesAny(words, ['jwt', 'token'])) return words.includes('expired') ? buildExpiredJwt() : `aria_invalid_token_${seed}`;
  if (words.includes('date')) return new Date(Date.now() - SYNTHETIC.DAY_MS).toISOString().slice(0, 10);
  return null;
}

function syntheticValue(words: string[], seed: string): string | null {
  const negative = includesAny(words, NEGATIVE_WORDS);
  const seedInt = parseInt(seed.slice(0, 8), 16) || 0;
  const first = FIRST_NAMES[seedInt % FIRST_NAMES.length];
  const last = LAST_NAMES[seedInt % LAST_NAMES.length];
  if (words.includes('email')) return negative ? SYNTHETIC.MALFORMED_EMAIL : `aria_test_${seed}@${SYNTHETIC.EMAIL_DOMAIN}`;
  if (words.includes('first')) return first;
  if (words.includes('last')) return last;
  if (words.includes('name')) return `${first} ${last}`;
  return negative ? negativeValue(words, seed) : null;
}

function generateValue(key: string, ctx: PolicyContext): { value: string; note: string } | null {
  const intent = resolveByIntent(key, { seed: ctx.seed, username: statedUsername(ctx.requirementValues) });
  if (intent) return intent;
  const words = splitPlaceholderWords(key);
  if (includesAny(words, CASE_WORDS)) return null;
  const boundary = BOUNDARY_GENERATORS.find(([vocabulary]) => includesAny(words, vocabulary));
  if (boundary) return { value: boundary[1](), note: `Boundary input for ${key}` };
  const synthetic = syntheticValue(words, ctx.seed);
  if (synthetic !== null) return { value: synthetic, note: `Synthetic input for ${key}` };
  const generic = deriveGenericValue(key, { seed: ctx.seed, tcKey: ctx.tc.key, tcText: `${ctx.tc.name || ''} ${ctx.tc.objective || ''}` });
  if (generic !== null && generic !== RUNTIME_SENTINEL) return { value: generic, note: 'Seeded synthetic identifier' };
  if (includesAny(words, NEGATIVE_WORDS)) return { value: `aria_invalid_${ctx.seed}`, note: `Synthetic invalid input for ${key}` };
  return includesAny(words, ARBITRARY_WORDS) ? { value: `aria_sample_${ctx.seed}`, note: `Synthetic sample input for ${key}` } : null;
}

/**
 * A project that stores credentials in the fixture treats them as application values: answered or stated, never
 * generated, and written to the fixture.
 * @param {string} key
 * @param {boolean} [credentialsInFixture]
 * @returns {ValueClass}
 */
export function effectiveValueClass(key: string, credentialsInFixture = false): ValueClass {
  const valueClass = classifyPlaceholder(key);
  return valueClass === VALUE_CLASS.RUNTIME && credentialsInFixture ? VALUE_CLASS.GROUNDED : valueClass;
}

/**
 * Resolves one placeholder under the value policy.
 * @param {string} key - Placeholder name without braces
 * @param {PolicyContext} ctx
 * @returns {PolicyResult} An entry, or no entry with the reason it stays unresolved
 */
export function resolvePlaceholder(key: string, ctx: PolicyContext): PolicyResult {
  const valueClass = effectiveValueClass(key, Boolean(ctx.profile?.credentialsInFixture));
  const human = fromHuman(key, valueClass, ctx);
  if (human) return { valueClass, entry: human };
  const stated = fromRequirement(key, valueClass, ctx) || fromProfile(key, valueClass, ctx);
  if (stated) return stated;
  if (valueClass === VALUE_CLASS.GENERATABLE) {
    if (ctx.memory[key] !== undefined) {
      return { valueClass, entry: literalEntry(key, ctx.memory[key], VALUE_SOURCE.MEMORY, valueClass, 'Reused from a previous run') };
    }
    const generated = generateValue(key, ctx);
    if (generated) return { valueClass, entry: literalEntry(key, generated.value, VALUE_SOURCE.GENERATED, valueClass, generated.note) };
  }
  return { valueClass, entry: null, reason: UNRESOLVED_REASON[valueClass](key) };
}
