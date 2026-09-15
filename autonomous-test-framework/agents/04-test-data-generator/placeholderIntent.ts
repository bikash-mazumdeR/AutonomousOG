'use strict';

/**
 * @fileoverview Word-based placeholder interpretation for Agent 04 (Test Data Generator).
 * Placeholder names are split into words ("invalidUsername" → ["invalid", "username"]) so matching
 * works on whole words — "valid" / "invalid" no longer match "id".
 *
 * Application-agnostic: values are derived only from requirement values passed in by the caller or
 * from the deterministic seed. Nothing application-specific is hard-coded here.
 *
 * @module PlaceholderIntent
 */

/** Runtime-resolved sentinel — actual value loaded from env at execution. */
export const RUNTIME_SENTINEL = 'LOADED_FROM_ENV_AT_RUNTIME';

/** @enum {string} Where a placeholder's value may come from. */
export const VALUE_CLASS = Object.freeze({
  /** Synthetic input that need not exist in the application (wrong credentials, malformed input, boundary strings). */
  GENERATABLE: 'GENERATABLE',
  /** Credential or secret: always an environment variable reference, never a stored value. */
  RUNTIME: 'RUNTIME',
  /** Must match the application (accounts, URLs, messages, limits): only a human answer, the requirement or the AUT profile. */
  GROUNDED: 'GROUNDED',
} as const);
export type ValueClass = typeof VALUE_CLASS[keyof typeof VALUE_CLASS];

export const NEGATIVE_WORDS: readonly string[] = Object.freeze(['invalid', 'wrong', 'incorrect', 'unknown', 'nonexistent', 'unregistered', 'bad', 'fake', 'expired', 'malformed']);
export const ARBITRARY_WORDS: readonly string[] = Object.freeze(['any', 'sample', 'random', 'dummy', 'arbitrary']);
export const CASE_WORDS: readonly string[] = Object.freeze(['case', 'uppercase', 'lowercase', 'mixedcase']);
const PASSWORD_WORDS = ['password', 'passwd', 'pwd', 'passphrase'];
const SECRET_WORDS = [...PASSWORD_WORDS, 'secret', 'token', 'jwt', 'apikey', 'credential', 'credentials', 'auth', 'bearer', 'oauth'];
const EXPECTATION_WORDS = ['message', 'error', 'text', 'title', 'label', 'heading', 'description', 'desc', 'tooltip', 'notification'];
const MEASURE_WORDS = ['length', 'max', 'min', 'maximum', 'minimum', 'count', 'limit', 'size', 'timeout'];
const BOUNDARY_WORDS = ['long', 'special', 'unicode', 'whitespace', 'sql', 'injection', 'xss', 'script'];
const SYNTHETIC_QUALIFIERS = ['valid', 'new', 'random', 'unique', 'synthetic', 'test'];
const SYNTHETIC_CORES: readonly string[][] = [['name'], ['first', 'name'], ['last', 'name'], ['full', 'name'], ['email'], ['email', 'address']];
/** Names ending in these words identify an account ("lockedOutUser", "adminAccount"), which is a credential. */
const ACCOUNT_WORDS = ['user', 'account', 'login'];

/** Requirement values an intent may derive from. */
export interface IntentValues {
  seed: string;
  username?: string;
  password?: string;
}

/** A value resolved from the placeholder's intent. */
export interface IntentResolution {
  value: string;
  note: string;
}

/** Context for generic, non-credential fallbacks. */
export interface GenericContext {
  seed: string;
  tcKey: string;
  tcText: string;
}

type Subject = 'username' | 'password';

/**
 * Splits a placeholder name into lower-case words ("apiBaseURL" → ["api", "base", "url"]).
 * @param {string} key - Placeholder name without braces
 * @returns {string[]}
 */
export function splitPlaceholderWords(key: string): string[] {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function hasAny(words: string[], vocabulary: readonly string[]): boolean {
  return words.some((word) => vocabulary.includes(word));
}

function hasPhrase(words: string[], phrase: string[]): boolean {
  return words.some((_, i) => phrase.every((part, j) => words[i + j] === part));
}

function subjectOf(words: string[]): Subject | null {
  if (words.includes('username') || hasPhrase(words, ['user', 'name'])) return 'username';
  if (hasAny(words, PASSWORD_WORDS)) return 'password';
  return null;
}

function isDeliberateInput(words: string[]): boolean {
  return hasAny(words, NEGATIVE_WORDS) || hasAny(words, ARBITRARY_WORDS) || hasAny(words, CASE_WORDS);
}

/**
 * A placeholder is sensitive when it names a real secret. Deliberately wrong, arbitrary or
 * case-variant credentials are test inputs, not secrets, so they stay in the fixture.
 * @param {string} key - Placeholder name without braces
 * @returns {boolean}
 */
export function isSensitivePlaceholder(key: string): boolean {
  const words = splitPlaceholderWords(key);
  const secret = hasAny(words, SECRET_WORDS) || hasPhrase(words, ['api', 'key']);
  return secret && !isDeliberateInput(words);
}

/**
 * Classifies where a placeholder's value may come from. Expected texts and limits must match the application; real
 * credentials and secrets are runtime references; deliberately wrong, arbitrary, case-variant, boundary and plain
 * synthetic personal inputs (name, email) may be generated. Anything else is grounded, so it is asked, never guessed.
 * @param {string} key - Placeholder name without braces
 * @returns {ValueClass}
 */
export function classifyPlaceholder(key: string): ValueClass {
  const words = splitPlaceholderWords(key);
  const deliberate = isDeliberateInput(words);
  // An account name wins over expectation words: "errorUser" is an account, "userErrorMessage" is a message
  const account = ACCOUNT_WORDS.includes(words[words.length - 1]);
  if (account) return deliberate ? VALUE_CLASS.GENERATABLE : VALUE_CLASS.RUNTIME;
  if (hasAny(words, EXPECTATION_WORDS) || hasAny(words, MEASURE_WORDS)) return VALUE_CLASS.GROUNDED;
  if (subjectOf(words) || hasAny(words, SECRET_WORDS) || hasPhrase(words, ['api', 'key'])) {
    return deliberate ? VALUE_CLASS.GENERATABLE : VALUE_CLASS.RUNTIME;
  }
  if (deliberate || hasAny(words, BOUNDARY_WORDS)) return VALUE_CLASS.GENERATABLE;
  const core = words.filter((word) => !SYNTHETIC_QUALIFIERS.includes(word));
  const synthetic = SYNTHETIC_CORES.some((candidate) => candidate.length === core.length && candidate.every((word, i) => core[i] === word));
  return synthetic ? VALUE_CLASS.GENERATABLE : VALUE_CLASS.GROUNDED;
}

/**
 * Flips the letter case at the start of each alphabetic segment ("acme_user" → "Acme_User").
 * @param {string} value
 * @returns {string|null} The variant, or null when the value has no letters to flip
 */
export function toggleLetterCase(value: string): string | null {
  const variant = value.replace(/(^|[^a-zA-Z])([a-zA-Z])/g, (_match, prefix: string, letter: string) =>
    prefix + (letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase()));
  return variant === value ? null : variant;
}

/**
 * Resolves username/password placeholders from their intent (case variant, negative, arbitrary).
 * @param {string} key - Placeholder name without braces
 * @param {IntentValues} values - Seed plus requirement username/password
 * @returns {IntentResolution|null} Null when the intent is not recognised or has no basis
 */
export function resolveByIntent(key: string, values: IntentValues): IntentResolution | null {
  const words = splitPlaceholderWords(key);
  const subject = subjectOf(words);
  if (!subject) return null;

  if (hasAny(words, CASE_WORDS)) {
    const known = subject === 'username' ? values.username : values.password;
    const variant = known ? toggleLetterCase(known) : null;
    return variant ? { value: variant, note: `Letter-case variant of the requirement ${subject}` } : null;
  }
  if (hasAny(words, NEGATIVE_WORDS)) {
    const value = subject === 'username' ? `aria_unknown_user_${values.seed}` : `Aria_Wrong_${values.seed}!`;
    return { value, note: `Synthetic ${subject} that matches no account` };
  }
  if (hasAny(words, ARBITRARY_WORDS)) {
    const value = subject === 'username' ? `aria_sample_user_${values.seed}` : `Aria_Sample_${values.seed}!`;
    return { value, note: `Synthetic ${subject} for input-handling checks` };
  }
  return null;
}

const GENERIC_RULES: Array<[string[], (ctx: GenericContext) => string]> = [
  [['id'], (ctx) => `aria_id_${ctx.seed}`],
  [['code'], (ctx) => `ARIA_${ctx.seed.toUpperCase().slice(0, 6)}`],
  [['token'], () => RUNTIME_SENTINEL],
];

/**
 * Generic fallback for synthetic identifiers, matched on whole words. Only used for placeholders classified as
 * GENERATABLE; business values (roles, statuses, counts, messages) are never defaulted.
 * @param {string} key - Placeholder name without braces
 * @param {GenericContext} ctx
 * @returns {string|null} Null when no rule applies (the placeholder stays unresolved)
 */
export function deriveGenericValue(key: string, ctx: GenericContext): string | null {
  const words = splitPlaceholderWords(key);
  const rule = GENERIC_RULES.find(([vocabulary]) => hasAny(words, vocabulary));
  return rule ? rule[1](ctx) : null;
}
