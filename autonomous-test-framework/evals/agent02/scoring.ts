'use strict';

/**
 * @fileoverview Scoring for the Agent 02 eval suite. Pure and deterministic: every score is computed from the generated
 * test cases, the analysis they were generated from and the case's labels, never by another LLM.
 */

import {
  concreteClaims, isGroundedClaim, numbersIn,
} from '../../core/requirements/groundedText';

/** One eval case: a frozen Agent 01 analysis and what a correct generation from it must (and must not) contain. */
export interface EvalCase {
  name: string;
  description: string;
  /** Path to the frozen analyzedRequirements JSON, relative to the case file. */
  analysis: string;
  /** Project whose AUT profile names the credentials and secrets, as in production. */
  projectId?: string;
  /** Credential placeholder names, for a case without a project. */
  credentialNames?: string[];
  /** Literal secrets the analysis contains, keyed by placeholder name, for a case without a project. */
  secrets?: Record<string, string>;
  /** Test types excluded for the run, e.g. ["edge"] (the --skip-* options). */
  excludedTypes?: string[];
  expect: {
    /** Placeholder names the test cases must use (extracted test data or credentials). */
    mustUsePlaceholders?: string[];
    /** Terms no test case may contain: out-of-scope features, or behaviour an open ambiguity leaves undecided. */
    forbidden?: string[];
    /** Least number of test cases of a type, e.g. { "API": 1 }. */
    minByType?: Record<string, number>;
  };
}

/** What one case scored. */
export interface CaseScore {
  name: string;
  error?: string;
  testCases: number;
  byType: Record<string, number>;
  criteria: { covered: number; total: number };
  unresolved: string[];
  /** Placeholders used, reused from the analysis or credentials, newly named, and required-but-missing (of `required`). */
  placeholders: { used: string[]; reused: string[]; newNames: string[]; missing: string[]; required: number };
  secretsLeaked: string[];
  ungrounded: string[];
  forbiddenHits: string[];
  excludedTypeLeaks: string[];
  duplicates: string[];
  minByTypeMissed: string[];
  /** Self-correction attempts per story. */
  attempts: number[];
  /** Overlap of test case titles between repeated runs (1 = identical); undefined for a single run. */
  stability?: number;
}

/** Pass bars for the suite. */
export interface Thresholds {
  unresolvedErrors: number;
  criteriaCoverage: number;
  placeholderRecall: number;
  secretsLeaked: number;
  ungroundedClaims: number;
  forbiddenHits: number;
  excludedTypeLeaks: number;
  duplicates: number;
  minByTypeMissed: number;
  stability: number;
}

/** One suite-level metric and whether it met its bar. */
export interface Metric {
  name: string;
  value: number;
  bar: number;
  kind: 'max' | 'min';
  pass: boolean;
  informational?: boolean;
}

/** What a generation produced, as the scorer needs it. */
export interface GenerationResult {
  testCases: any[];
  warnings: string[];
  coverage: { acceptanceCriteria: { covered: number; total: number } };
  attempts: number[];
}

const TYPE_BY_TAG: Readonly<Record<string, string>> = Object.freeze({
  positive: 'Positive', negative: 'Negative', edge: 'Edge', api: 'API', performance: 'Performance',
});
const UNRESOLVED = /Unresolved after \d+ attempt\(s\): /;
const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

const normalize = (text: string): string => String(text || '')
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** The text a test case states: its title, precondition and every step. */
export function testCaseText(tc: any): string {
  return [tc?.name, tc?.precondition, ...(tc?.testSteps || []).flatMap((s: any) => [s?.description, s?.testData, s?.expectedResult])]
    .filter(Boolean).join('\n');
}

/**
 * Whether a concrete claim of a test case is grounded in the analysis (see isGroundedClaim: boundaries one away count).
 * @param {string} claim
 * @param {string} source - Normalised analysis text
 * @param {number[]} sourceNumbers
 * @returns {boolean}
 */
export function isGrounded(claim: string, source: string, sourceNumbers: number[]): boolean {
  return isGroundedClaim(claim, source, sourceNumbers);
}

function termHit(text: string, term: string): boolean {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

/**
 * Names every placeholder the analysis gives a story: its extracted test data values, plus the credential names.
 * @param {any} analysis
 * @param {string[]} credentialNames
 * @returns {Set<string>}
 */
export function knownPlaceholders(analysis: any, credentialNames: string[]): Set<string> {
  const names = (analysis?.features || []).flatMap((f: any) => f?.userStories || [])
    .flatMap((s: any) => (s?.testDataValues || []).map((d: any) => String(d?.name || '')));
  return new Set([...credentialNames, ...names].filter(Boolean));
}

/**
 * Title overlap of two generations: identical titles (ignoring case and punctuation) over all distinct titles.
 * @param {any[]} a
 * @param {any[]} b
 * @returns {number}
 */
export function titleOverlap(a: any[], b: any[]): number {
  const key = (tc: any) => normalize(tc?.name).replace(/[^a-z0-9]+/g, ' ').trim();
  const left = new Set(a.map(key));
  const right = new Set(b.map(key));
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  return [...left].filter((item) => right.has(item)).length / union.size;
}

/**
 * Scores one generation against its case.
 * @param {EvalCase} evalCase
 * @param {GenerationResult} result
 * @param {any} analysis - The frozen analysis the generation was made from
 * @param {{ credentialNames: string[], secretValues: string[] }} environment
 * @returns {CaseScore}
 */
export function scoreCase(
  evalCase: EvalCase,
  result: GenerationResult,
  analysis: any,
  environment: { credentialNames: string[]; secretValues: string[] },
): CaseScore {
  const tcs = result.testCases;
  const texts = tcs.map(testCaseText);
  const all = texts.join('\n');
  const known = knownPlaceholders(analysis, environment.credentialNames);
  const used = [...new Set([...all.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort();
  const byType: Record<string, number> = {};
  tcs.forEach((tc: any) => { byType[tc.type] = (byType[tc.type] || 0) + 1; });
  const source = normalize(JSON.stringify(analysis));
  const sourceNumbers = numbersIn(source);
  const excluded = new Set((evalCase.excludedTypes || []).map((tag) => TYPE_BY_TAG[tag]).filter(Boolean));
  const seenTitles = new Map<string, string>();
  const seenHashes = new Map<string, string>();
  const duplicates: string[] = [];
  tcs.forEach((tc: any) => {
    const title = normalize(tc.name);
    if (seenTitles.has(title)) duplicates.push(`${tc.key} repeats the title of ${seenTitles.get(title)}`);
    else seenTitles.set(title, tc.key);
    if (tc.hash && seenHashes.has(tc.hash)) duplicates.push(`${tc.key} repeats the steps of ${seenHashes.get(tc.hash)}`);
    else if (tc.hash) seenHashes.set(tc.hash, tc.key);
  });
  return {
    name: evalCase.name,
    testCases: tcs.length,
    byType,
    criteria: { ...result.coverage.acceptanceCriteria },
    unresolved: result.warnings.filter((w) => UNRESOLVED.test(w)),
    placeholders: {
      used,
      reused: used.filter((name) => known.has(name)),
      newNames: used.filter((name) => !known.has(name)),
      missing: (evalCase.expect.mustUsePlaceholders || []).filter((name) => !used.includes(name)),
      required: (evalCase.expect.mustUsePlaceholders || []).length,
    },
    secretsLeaked: tcs.filter((tc: any, idx: number) => environment.secretValues.some((v) => v && texts[idx].includes(v))).map((tc: any) => tc.key),
    ungrounded: tcs.flatMap((tc: any, idx: number) => concreteClaims(texts[idx])
      .filter((claim) => !isGrounded(claim, source, sourceNumbers))
      .map((claim) => `${tc.key} states "${claim}", which the analysis does not contain`)),
    forbiddenHits: (evalCase.expect.forbidden || []).flatMap((term) => tcs
      .filter((tc: any, idx: number) => termHit(texts[idx], term))
      .map((tc: any) => `${tc.key} mentions "${term}"`)),
    excludedTypeLeaks: tcs.filter((tc: any) => excluded.has(tc.type)).map((tc: any) => `${tc.key} is ${tc.type}`),
    duplicates,
    minByTypeMissed: Object.entries(evalCase.expect.minByType || {})
      .filter(([type, least]) => (byType[type] || 0) < least)
      .map(([type, least]) => `${byType[type] || 0} ${type} test case(s), expected at least ${least}`),
    attempts: result.attempts,
  };
}

const ratio = (part: number, whole: number) => (whole === 0 ? 1 : part / whole);

/**
 * Suite-level metrics over every case, each compared with its bar. A case that errored fails the suite.
 * @param {CaseScore[]} scores
 * @param {Thresholds} bars
 * @returns {{ metrics: Metric[], passed: boolean }}
 */
export function summarize(scores: CaseScore[], bars: Thresholds): { metrics: Metric[]; passed: boolean } {
  const ok = scores.filter((s) => !s.error);
  const errored = scores.length - ok.length;
  const sum = (pick: (s: CaseScore) => number) => ok.reduce((total, s) => total + pick(s), 0);
  const repeated = ok.filter((s) => s.stability !== undefined);
  const attempts = ok.flatMap((s) => s.attempts);
  const metric = (name: string, value: number, bar: number, kind: 'max' | 'min', informational = false): Metric => ({
    name, value, bar, kind, informational, pass: informational || (errored === 0 && (kind === 'max' ? value <= bar : value >= bar)),
  });
  const metrics = [
    metric('Cases that errored', errored, 0, 'max'),
    metric('Validation errors left after retries', sum((s) => s.unresolved.length), bars.unresolvedErrors, 'max'),
    metric('Acceptance criteria covered', ratio(sum((s) => s.criteria.covered), sum((s) => s.criteria.total)), bars.criteriaCoverage, 'min'),
    metric('Required placeholders used', ratio(sum((s) => s.placeholders.required - s.placeholders.missing.length), sum((s) => s.placeholders.required)), bars.placeholderRecall, 'min'),
    metric('Secrets written out', sum((s) => s.secretsLeaked.length), bars.secretsLeaked, 'max'),
    metric('Ungrounded wording', sum((s) => s.ungrounded.length), bars.ungroundedClaims, 'max'),
    metric('Out-of-scope / undecided behaviour', sum((s) => s.forbiddenHits.length), bars.forbiddenHits, 'max'),
    metric('Excluded types that got through', sum((s) => s.excludedTypeLeaks.length), bars.excludedTypeLeaks, 'max'),
    metric('Duplicate test cases', sum((s) => s.duplicates.length), bars.duplicates, 'max'),
    metric('Type minimums missed', sum((s) => s.minByTypeMissed.length), bars.minByTypeMissed, 'max'),
    metric('New placeholder names', sum((s) => s.placeholders.newNames.length), 0, 'max', true),
    metric('Attempts per story (mean)', attempts.length ? attempts.reduce((a, b) => a + b, 0) / attempts.length : 0, 0, 'max', true),
    metric('Test cases generated', sum((s) => s.testCases), 0, 'max', true),
    ...(repeated.length > 0
      ? [metric('Title stability across runs', repeated.reduce((total, s) => total + (s.stability as number), 0) / repeated.length, bars.stability, 'min')]
      : []),
  ];
  return { metrics, passed: metrics.every((m) => m.pass) };
}
