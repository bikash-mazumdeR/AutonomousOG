'use strict';

/**
 * @fileoverview Agent 04 constants shared by the value policy, clarifications and test data edits.
 */

/** Agent 04 stage id. */
export const STAGE_ID = '04-test-data-generator';

/** @enum {string} Where a manifest input value came from. */
export const VALUE_SOURCE = Object.freeze({
  CLARIFICATION: 'clarification',
  USER_OVERRIDE: 'user_override',
  REQUIREMENT: 'requirement',
  PROFILE: 'profile',
  ENVIRONMENT: 'environment',
  MEMORY: 'memory',
  GENERATED: 'generated',
  /** Read from an environment variable at runtime; `origin` records which source named the variable. */
  RUNTIME: 'runtime',
  UNRESOLVED: 'unresolved',
} as const);

/** Manifest type of an environment variable reference. */
export const RUNTIME_TYPE = 'runtime-ref';
