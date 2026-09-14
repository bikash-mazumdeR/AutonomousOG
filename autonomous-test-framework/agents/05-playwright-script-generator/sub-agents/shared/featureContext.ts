'use strict';

/**
 * @fileoverview Types and helpers shared by the UI, API and K6 sub-agents.
 */

import { ResolvedAutProfile } from '../../../../core/aut/AutProfile';
import { ProjectPaths } from '../../../../core/aut/projectPaths';
import { ChatFn } from '../../types';
import { GenerationMode } from '../../constants';
import {
  AutomationTestCase, MissingItem, ReadinessContext, assessReadiness,
} from '../../contracts/automationTestCase';
import { TestOutcome } from '../../generation/testBodyGenerator';

/** Everything a sub-agent needs to generate one feature. */
export interface FeatureGenerationContext {
  projectSlug: string;
  featureId: string;
  sourceReviewId: string | null;
  profile: ResolvedAutProfile;
  paths: ProjectPaths;
  fixtureValues: Record<string, unknown>;
  priorReviewFindings: Array<{ ruleId: string; message: string }>;
  chat: ChatFn;
  maxRetries: number;
  concurrency: number;
  headless: boolean;
  logger: any;
}

/** A file to write. */
export interface GeneratedFile {
  path: string;
  content: string;
  kind: 'spec' | 'pom' | 'k6';
}

/** Sub-agent result. */
export interface FeatureGenerationResult {
  outcomes: TestOutcome[];
  files: GeneratedFile[];
  pageMapFile?: string;
  /** Absolute file path containing each GENERATED test. */
  fileByTcKey: Map<string, string>;
}

/**
 * File-name-safe stem for a feature id.
 * @param {string} featureId
 * @returns {string}
 */
export function fileStem(featureId: string): string {
  return String(featureId).replace(/[^A-Za-z0-9_-]+/g, '-');
}

/**
 * Readiness context from the AUT profile.
 * @param {GenerationMode} mode
 * @param {ResolvedAutProfile} profile
 * @returns {ReadinessContext}
 */
export function readinessContext(mode: GenerationMode, profile: ResolvedAutProfile): ReadinessContext {
  return {
    mode,
    baseURL: profile.baseURL,
    baseUrlEnv: profile.baseUrlEnv,
    authStrategy: profile.auth.strategy,
    apiAuthHeaderEnv: profile.api?.authHeaderEnv,
    thresholdEnv: profile.performance?.thresholdEnv,
  };
}

/**
 * NEEDS_CONTEXT outcome.
 * @param {string} tcKey
 * @param {MissingItem[]} missing
 * @returns {TestOutcome}
 */
export function needsContextOutcome(tcKey: string, missing: MissingItem[]): TestOutcome {
  return {
    tcKey, status: 'NEEDS_CONTEXT', missing, attempts: 0,
  };
}

/**
 * Splits test cases into ready ones and NEEDS_CONTEXT outcomes.
 * @param {AutomationTestCase[]} testCases
 * @param {ResolvedAutProfile} profile
 * @param {GenerationMode} mode
 * @returns {{ ready: AutomationTestCase[], notReady: TestOutcome[] }}
 */
export function splitByReadiness(testCases: AutomationTestCase[], profile: ResolvedAutProfile, mode: GenerationMode): { ready: AutomationTestCase[]; notReady: TestOutcome[] } {
  const ctx = readinessContext(mode, profile);
  const ready: AutomationTestCase[] = [];
  const notReady: TestOutcome[] = [];
  for (const tc of testCases) {
    const missing = assessReadiness(tc, ctx);
    if (missing.length === 0) ready.push(tc);
    else notReady.push(needsContextOutcome(tc.tcKey, missing));
  }
  return { ready, notReady };
}
