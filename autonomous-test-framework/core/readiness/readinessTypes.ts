'use strict';

/**
 * @fileoverview Shared automation-readiness vocabulary: what automation can be missing, the test case facts the rules
 * inspect, and when (test case review or automation generation) a rule applies. Used by Agent 03 and Agent 05 alike.
 */

import { BrowserTarget } from './browserTargets';

/** Kinds of information automation can be missing. */
export const MISSING_KINDS = Object.freeze([
  'LOCATOR', 'STATE', 'DATA', 'ENDPOINT', 'AUTH', 'EXPECTED_RESULT', 'SLA', 'AUT_UNREACHABLE', 'UNASSERTABLE', 'PRECONDITION', 'BROWSER',
] as const);

export type MissingKind = typeof MISSING_KINDS[number];

/** @enum {string} When a readiness rule applies. */
export const READINESS_PHASE = Object.freeze({
  /** Agent 03 test case review — before test data and automation exist. */
  REVIEW: 'REVIEW',
  /** Agent 05 automation generation. */
  GENERATION: 'GENERATION',
} as const);

export type ReadinessPhase = typeof READINESS_PHASE[keyof typeof READINESS_PHASE];

/** A piece of information required before automation can proceed. */
export interface MissingItem {
  kind: MissingKind;
  detail: string;
  /** Rule that found the gap; routes the question to the stage that owns the answer. */
  ruleId?: string;
  stepIndex?: number;
  /** The exact expected-result line or step action the gap is about (answers replace it). */
  subject?: string;
}

/** Automation mode of a test case. */
export type ReadinessMode = 'UI' | 'API' | 'K6';

/** Environment facts the rules need. */
export interface ReadinessContext {
  mode: ReadinessMode;
  baseURL: string | null;
  baseUrlEnv: string;
  authStrategy: string;
  apiAuthHeaderEnv?: string;
  thresholdEnv?: string;
  /** Browser engines the AUT profile runs; unknown during test case review. */
  browsers?: readonly string[];
  /** Defaults to GENERATION. */
  phase?: ReadinessPhase;
}

/** How a step's data token is supplied at runtime. */
export interface ReadinessBinding {
  token: string;
  fixtureKey?: string;
  envVar?: string;
  unresolved?: boolean;
}

/** One step as the rules see it. */
export interface ReadinessStep {
  index: number;
  action: string;
  expected: string[];
  testData: string;
  data: ReadinessBinding[];
}

/** The test case facts the rules inspect. */
export interface ReadinessInput {
  precondition: string;
  steps: ReadinessStep[];
  api?: {
    method: string;
    endpoint: string;
    expectedStatusCode: number;
    requestBodyUnresolved?: boolean;
  };
  performance?: { scenario: string; targetEndpoint: string; slaText?: string };
  /** Browsers the test case explicitly names. */
  targetBrowsers?: BrowserTarget[];
}
