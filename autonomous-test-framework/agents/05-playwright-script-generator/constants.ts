'use strict';

/**
 * @fileoverview Shared constants for Agent 05 — Playwright Script Generator.
 * Application-agnostic: no application-specific values may appear here.
 */

import * as path from 'path';

export const STAGE_ID = '05-playwright-script-generator';
export const STAGE_NAME = 'Playwright Script Generator';
export const STAGE_NUMBER = '05';
export const NEXT_STAGE = '06-automation-reviewer';

export const SKILLS_DIR = path.resolve(__dirname, '../../skills');
export const GENERIC_LEARNINGS_DIR = path.resolve(__dirname, 'learnings');

export type GenerationMode = 'UI' | 'API' | 'K6';

export const SKILL_FILES = Object.freeze({
  SHARED: 'automation-scripting.md',
  DISCOVERY: 'automation-discovery.md',
  UI: 'ui-scripting.md',
  API: 'api-scripting.md',
  K6: 'k6-scripting.md',
});

export const GENERIC_LEARNINGS_FILES: Readonly<Record<GenerationMode, string>> = Object.freeze({
  UI: 'ui-learnings.md',
  API: 'api-learnings.md',
  K6: 'k6-learnings.md',
});

export const PROJECT_LEARNINGS_FILES: Readonly<Record<GenerationMode, string>> = Object.freeze({
  UI: 'agent05-ui.md',
  API: 'agent05-api.md',
  K6: 'agent05-k6.md',
});

export const LLM_SETTINGS = Object.freeze({ TEMPERATURE: 0, MAX_TOKENS: 16384 });

/** Maximum approved test cases per generation call. */
export const MAX_TCS_PER_CALL = 6;

/** @enum {string} Per-test-case outcome of Agent 05. */
export const TC_OUTCOME = Object.freeze({
  GENERATED: 'GENERATED',
  NEEDS_CONTEXT: 'NEEDS_CONTEXT',
  BLOCKED: 'BLOCKED',
  EXCLUDED: 'EXCLUDED',
} as const);

export type TcOutcomeStatus = typeof TC_OUTCOME[keyof typeof TC_OUTCOME];

export const MISSING_KINDS = Object.freeze([
  'LOCATOR', 'STATE', 'DATA', 'ENDPOINT', 'AUTH', 'EXPECTED_RESULT', 'SLA', 'AUT_UNREACHABLE',
] as const);

export type MissingKind = typeof MISSING_KINDS[number];

/** Header marker identifying files owned (and regenerated) by Agent 05. */
export const GENERATED_MARKER = '@aria-generated';

/** Fixture / helper identifiers available inside generated test bodies. */
export const PAGE_FIXTURE = 'featurePage';
export const DATA_FIXTURE = 'data';
export const ENV_FUNCTION = 'env';
export const K6_ENV_FUNCTION = 'requireEnv';

/**
 * `page` members a UI test body may use (everything else goes through the page object).
 * Limited to browser/viewport-level controls that have no meaningful page-object equivalent —
 * DOM interaction and content assertions must still go through `featurePage` locators.
 */
export const UI_PAGE_API: ReadonlySet<string> = new Set(['reload', 'goBack', 'goForward', 'keyboard', 'setViewportSize']);

export const API_TYPES: ReadonlySet<string> = new Set(['api', 'integration', 'contract']);
export const PERF_TYPES: ReadonlySet<string> = new Set(['performance', 'load', 'stress', 'spike', 'soak']);
export const K6_SCENARIOS: readonly string[] = Object.freeze(['load', 'stress', 'spike', 'soak']);

export const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
export const REVIEWER_CLARIFICATION_MARKER = /\[REQUIRES CLARIFICATION/i;
export const REVIEWER_REWRITE_MARKER = /\[REWRITTEN-BY-AGENT-03\]/i;
export const SLA_PATTERN = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)\b/i;

/** Generic heuristics for auto-generated ids / attribute values that must not become locators. */
export const DYNAMIC_ID_HEURISTICS: readonly RegExp[] = Object.freeze([
  /\d{4,}/, /[a-f0-9]{10,}/i, /^:r[0-9a-z]*:?$/i, /^(ember|react-|mui-|radix-|headlessui-)/i,
]);

export const DISCOVERY_SETTINGS = Object.freeze({
  NAVIGATION_TIMEOUT_MS: 30000,
  ACTION_TIMEOUT_MS: 10000,
  DOM_QUIET_MS: 400,
  DOM_SETTLE_MAX_MS: 5000,
  MAX_ELEMENTS_PER_STATE: 150,
  MAX_TEXT_LENGTH: 80,
  PLANNER_ATTEMPTS: 2,
});
