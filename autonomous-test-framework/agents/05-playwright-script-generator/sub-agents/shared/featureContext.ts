'use strict';

/**
 * @fileoverview Types and helpers shared by the UI, API and K6 sub-agents.
 */

import { ResolvedAutProfile } from '../../../../core/aut/AutProfile';
import { ProjectPaths } from '../../../../core/aut/projectPaths';
import { ChatFn } from '../../types';
import { GenerationMode } from '../../constants';
import { AutomationTestCase } from '../../contracts/automationTestCase';
import { assessReadiness } from '../../../../core/readiness/readinessRules';
import { MissingItem, READINESS_PHASE, ReadinessContext } from '../../../../core/readiness/readinessTypes';
import { TestOutcome } from '../../generation/testBodyGenerator';
import { TraceRecorder } from '../../../../core/llm/stagePromptTrace';

/** Everything a sub-agent needs to generate one feature. */
export interface FeatureGenerationContext {
  projectSlug: string;
  featureId: string;
  /**
   * Requirement-scoped identity of the feature, e.g. "logout-F-01". Names every generated file so a
   * second requirement's F-01 cannot overwrite the first's. featureId stays the human-facing id.
   */
  featureKey: string;
  sourceReviewId: string | null;
  profile: ResolvedAutProfile;
  paths: ProjectPaths;
  fixtureValues: Record<string, unknown>;
  priorReviewFindings: Array<{ ruleId: string; message: string }>;
  chat: ChatFn;
  maxRetries: number;
  concurrency: number;
  headless: boolean;
  /** Sign in before crawling, so states behind the login form can be discovered. */
  authenticate: boolean;
  logger: any;
  /** Records LLM work units and validation attempts for the prompt trace (optional). */
  trace?: TraceRecorder;
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
 * File-name-safe stem. Pass a featureKey, not a bare featureId, for anything written to disk.
 * @param {string} value
 * @returns {string}
 */
export function fileStem(value: string): string {
  return String(value).replace(/[^A-Za-z0-9_-]+/g, '-');
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
    phase: READINESS_PHASE.GENERATION,
    baseURL: profile.baseURL,
    baseUrlEnv: profile.baseUrlEnv,
    authStrategy: profile.auth.strategy,
    apiAuthHeaderEnv: profile.api?.authHeaderEnv,
    thresholdEnv: profile.performance?.thresholdEnv,
    browsers: profile.browsers,
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

/** Reported only when discovery reached the application and verified nothing there. */
export const NO_VERIFIABLE_ELEMENTS = 'Discovery found no verifiable elements in the application.';

/**
 * Why this test case could not be generated.
 *
 * An empty page map almost always has a recorded cause — a navigation timeout, an unreachable host,
 * a step that could not be executed — stored against the test case by discovery. That cause is what
 * gets reported: substituting a generic message made a page-load timeout, a DNS failure and a page
 * that genuinely has nothing to verify indistinguishable, though each calls for a different fix.
 *
 * @param {Map<string, MissingItem[]>} issues - Per test case, as recorded by discovery
 * @param {string} tcKey
 * @returns {MissingItem[]}
 */
export function missingForTestCase(issues: Map<string, MissingItem[]>, tcKey: string): MissingItem[] {
  const recorded = issues.get(tcKey);
  return recorded && recorded.length > 0 ? recorded : [{ kind: 'LOCATOR', detail: NO_VERIFIABLE_ELEMENTS }];
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
