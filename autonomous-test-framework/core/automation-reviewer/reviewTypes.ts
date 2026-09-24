'use strict';

/**
 * @fileoverview Shared types for automation review rules (Agent 05 validation and Agent 06 review).
 */

/** @enum {string} Reviewed file kinds. */
export enum FILE_TYPE {
  SPEC = 'spec',
  POM = 'pom',
  K6 = 'k6',
}

/** The Playwright test object a spec declares tests with. */
export const TEST_OBJECT = 'test';

/** The test object a generated spec's shared signed-in session block declares its tests with (`test.extend` of TEST_OBJECT). */
export const SESSION_TEST_OBJECT = 'sessionTest';

/** Every identifier a spec may declare tests, hooks and describe blocks on. */
export const TEST_OBJECTS: ReadonlySet<string> = new Set([TEST_OBJECT, SESSION_TEST_OBJECT]);

/** @enum {string} Finding severities. */
export enum FINDING_SEVERITY {
  BLOCKER = 'BLOCKER',
  MAJOR = 'MAJOR',
  MINOR = 'MINOR',
  INFO = 'INFO',
}

/** A single review finding. Rules are detect-only, so `patchable` is always false. */
export interface Finding {
  ruleId: string;
  dimension: string;
  severity: FINDING_SEVERITY;
  message: string;
  suggestion: string;
  line?: number;
  patchable: boolean;
}

/** Result of a review. `patchedCode` is kept for backward compatibility and always equals the input. */
export interface ReviewResult {
  findings: Finding[];
  patchedCode: string;
}
