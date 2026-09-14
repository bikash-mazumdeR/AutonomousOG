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

const NEGATIVE_WORDS = ['invalid', 'wrong', 'incorrect', 'unknown', 'nonexistent', 'unregistered', 'bad', 'fake'];
const ARBITRARY_WORDS = ['any', 'sample', 'random', 'dummy', 'arbitrary'];
const CASE_WORDS = ['case', 'uppercase', 'lowercase', 'mixedcase'];
const PASSWORD_WORDS = ['password', 'passwd', 'pwd', 'passphrase'];
const SECRET_WORDS = [...PASSWORD_WORDS, 'secret', 'token', 'jwt', 'apikey', 'credential', 'credentials', 'auth', 'bearer', 'oauth'];

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

function hasAny(words: string[], vocabulary: string[]): boolean {
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

/**
 * A placeholder is sensitive when it names a real secret. Deliberately wrong, arbitrary or
 * case-variant credentials are test inputs, not secrets, so they stay in the fixture.
 * @param {string} key - Placeholder name without braces
 * @returns {boolean}
 */
export function isSensitivePlaceholder(key: string): boolean {
  const words = splitPlaceholderWords(key);
  const secret = hasAny(words, SECRET_WORDS) || hasPhrase(words, ['api', 'key']);
  return secret && !hasAny(words, [...NEGATIVE_WORDS, ...ARBITRARY_WORDS, ...CASE_WORDS]);
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
  [['message'], (ctx) => `Aria test message ${ctx.seed}`],
  [['title'], (ctx) => `Aria Test Title ${ctx.seed}`],
  [['desc', 'description'], (ctx) => `Aria test description for TC ${ctx.tcKey}`],
  [['count'], () => '5'],
  [['limit'], () => '10'],
  [['page'], () => '1'],
  [['size'], () => '20'],
  [['role'], (ctx) => (ctx.tcText.toLowerCase().includes('admin') ? 'admin' : 'user')],
  [['status'], () => 'active'],
  [['type'], () => 'standard'],
];

/**
 * Generic fallback for common field names, matched on whole words.
 * @param {string} key - Placeholder name without braces
 * @param {GenericContext} ctx
 * @returns {string|null} Null when no rule applies (the placeholder stays unresolved)
 */
export function deriveGenericValue(key: string, ctx: GenericContext): string | null {
  const words = splitPlaceholderWords(key);
  const rule = GENERIC_RULES.find(([vocabulary]) => hasAny(words, vocabulary));
  return rule ? rule[1](ctx) : null;
}
