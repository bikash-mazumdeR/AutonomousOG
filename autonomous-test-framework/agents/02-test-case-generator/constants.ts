/**
 * @fileoverview Shared constants for Agent 02 — Test Case Generator.
 */

import * as path from 'path';

export const STAGE_ID = '02-test-case-generator';
export const STAGE_NAME = 'Test Case Generator';
export const STAGE_NUMBER = '02';
export const NEXT_STAGE = '03-test-case-reviewer';
export const SKILL_PATH = path.resolve(__dirname, '../../skills/test-case-generation.md');
export const LEARNINGS_PATH = path.resolve(__dirname, 'LEARNINGS.md');

/** @enum {string} Test case types — values are consumed verbatim by Agents 03/04/05. */
export const TC_TYPE = Object.freeze({
  POSITIVE: 'Positive',
  NEGATIVE: 'Negative',
  EDGE: 'Edge',
  API: 'API',
  PERFORMANCE: 'Performance',
});

/** @enum {string} Priorities accepted by Agent 03. */
export const PRIORITY = Object.freeze({
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
});

/** @enum {string} Normalised feature risk levels. */
export const RISK_LEVEL = Object.freeze({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
});

export type RiskLevel = keyof typeof RISK_LEVEL;

/** @enum {string} Story testability values from Agent 01. */
export const TESTABILITY = Object.freeze({
  AUTOMATABLE: 'AUTOMATABLE',
  PARTIAL: 'PARTIAL',
  MANUAL_ONLY: 'MANUAL_ONLY',
});

/** Feature-level coverage targets per risk level. Targets never justify invented scenarios. */
export const MIN_TC_BY_RISK: Readonly<Record<RiskLevel, { positive: number; negative: number; edge: number }>> = Object.freeze({
  CRITICAL: { positive: 5, negative: 5, edge: 3 },
  HIGH: { positive: 3, negative: 3, edge: 2 },
  MEDIUM: { positive: 2, negative: 2, edge: 1 },
  LOW: { positive: 1, negative: 1, edge: 0 },
});

/** UI test types the user selects per run; each selected type needs at least MIN_TC_PER_STORY_PER_TYPE per story. */
export const SELECTABLE_UI_TYPE_TAGS: readonly string[] = Object.freeze(['positive', 'negative', 'edge']);

/** Every selected UI type is generated at least this many times per user story. */
export const MIN_TC_PER_STORY_PER_TYPE = 1;

const DEFAULT_MAX_TC_PER_STORY_PER_TYPE = 4;

/**
 * Upper bound of scenarios per type per story (caps output tokens). Override with AGENT02_MAX_TC_PER_TYPE.
 * A story is never capped below its number of acceptance criteria and business rules, so a large story (one per
 * documented user story) can still cover every criterion.
 * @param {number} [requirementCount] - Acceptance criteria + business rules of the story
 * @returns {number}
 */
export function maxTcPerStoryPerType(requirementCount = 0): number {
  const configured = Number(process.env.AGENT02_MAX_TC_PER_TYPE);
  const base = Number.isInteger(configured) && configured >= MIN_TC_PER_STORY_PER_TYPE ? configured : DEFAULT_MAX_TC_PER_STORY_PER_TYPE;
  return Math.max(base, requirementCount);
}

/**
 * App-agnostic wording of a failure outcome. A @positive scenario asserting one of these verifies
 * @negative behaviour — the classic way an LLM smuggles excluded negatives past the type filter.
 * Negated forms ("no error", "without an error") are stripped before matching.
 */
export const FAILURE_OUTCOME_PATTERN = new RegExp(
  '\\b(?:error|errors|invalid|locked[ -]?out|denied|rejected|forbidden|unauthori[sz]ed|fails?|failed|failure'
  + '|is required|are required|do(?:es)? not match|not (?:redirected|allowed|permitted|logged in|authenticated|granted))\\b',
  'i',
);

/** Negated failure phrases that describe a success outcome ("no error message is displayed"). */
export const NEGATED_FAILURE_PHRASE = /\b(?:no|without(?: an?| any)?|not display(?:ing)?(?: an?| any)?)\s+(?:\w+\s+){0,2}?(?:error|errors|failure)s?\b/gi;

/** Output line declaring a criterion that only an excluded type could verify: "# UNCOVERED AC-3: @negative". */
export const UNCOVERED_DECLARATION = /^#\s*UNCOVERED\s+((?:AC|BR)-\d+)\s*:\s*@?([a-z]+)/i;

/** Risk levels whose stories must tag their primary happy path @smoke. */
export const SMOKE_REQUIRED_RISKS: ReadonlySet<string> = new Set([RISK_LEVEL.CRITICAL, RISK_LEVEL.HIGH]);

/** Gherkin type tag → test case type. Exactly one per scenario. */
export const TYPE_TAGS: Readonly<Record<string, string>> = Object.freeze({
  positive: TC_TYPE.POSITIVE,
  negative: TC_TYPE.NEGATIVE,
  edge: TC_TYPE.EDGE,
  api: TC_TYPE.API,
  performance: TC_TYPE.PERFORMANCE,
});

/** Gherkin label tag → stored label (Agent 03 matches the "Smoke" spelling). Order is canonical. */
export const LABEL_TAGS: Readonly<Record<string, string>> = Object.freeze({
  smoke: 'Smoke',
  regression: 'Regression',
  functional: 'Functional',
  ui: 'UI',
  security: 'Security',
  accessibility: 'Accessibility',
  'error-handling': 'Error-Handling',
});

/**
 * Whether an HTTP status is a client error (4xx): an @api scenario asserting one verifies a documented error response,
 * which is @negative behaviour, so it counts toward a story's @negative minimum. It stays a single @api test case.
 * @param {number | undefined} statusCode
 * @returns {boolean}
 */
export function isClientErrorStatus(statusCode: number | undefined): boolean {
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 499;
}

export const K6_SCENARIOS: readonly string[] = Object.freeze(['load', 'stress', 'spike', 'soak']);
export const HTTP_METHODS: readonly string[] = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export const API_INTEGRATION_TYPES: readonly string[] = Object.freeze(['REST_API', 'GRAPHQL']);

/** @enum {string} Prefixes of story-local requirement ids. */
export const REQUIREMENT_REF_PREFIX = Object.freeze({
  AC: 'AC',
  BR: 'BR',
});

/** Structured tag patterns (tags are lower-cased by the parser). */
export const TAG_PATTERN = Object.freeze({
  REQUIREMENT_REF: /^(ac|br)-(\d+)$/,
  INTEGRATION: /^int-[a-z0-9-]+$/,
  METHOD: /^method-([a-z]+)$/,
  STATUS: /^status-(\d{3})$/,
  TC_KEY: /^tc-\d+$/,
});

/** Tags written by the feature-file renderer that carry no generation meaning. */
export const IGNORED_TAGS: ReadonlySet<string> = new Set(['obsolete']);

export const TEST_DATA_LINE = /^with test data\s+"(.*)"$/i;
export const PLACEHOLDER_TOKEN = /\{\{[^{}]*\}\}/g;
export const VALID_PLACEHOLDER = /^\{\{[a-zA-Z][a-zA-Z0-9]*\}\}$/;

/** Agent 03 raises a BLOCKER for names shorter than 10 characters. */
export const TITLE_LENGTH = Object.freeze({ MIN: 10, MAX: 120 });

/** Out-of-scope phrases shorter than this are too generic to match safely. */
export const MIN_OUT_OF_SCOPE_PHRASE_LENGTH = 12;

/** Temperature 0 + a fixed seed keep generation reproducible for identical inputs. */
export const LLM_SETTINGS = Object.freeze({
  TEMPERATURE: 0,
  SEED: 42,
  MAX_TOKENS: 8192,
});

export const MAX_REJECTION_FEEDBACK_IN_PROMPT = 5;

/** Memory improvement rules with this appliesTo value apply to every stage. */
export const ALL_STAGES = 'ALL';

/** CLI/UI skip option → excluded type tag. */
export const SKIP_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  'skip-positive': 'positive',
  'skip-negative': 'negative',
  'skip-edge': 'edge',
  'skip-api': 'api',
  'skip-perf': 'performance',
});
