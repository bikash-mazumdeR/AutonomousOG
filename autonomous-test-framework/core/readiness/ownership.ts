'use strict';

/**
 * @fileoverview Routes every readiness gap to the stage that owns the missing information, so the question is asked
 * where it can be answered instead of where it was noticed.
 */

import { READINESS_RULE as RULE } from './readinessConstants';
import { MissingItem, MissingKind } from './readinessTypes';

/** @enum {string} Stages (or the environment) that can supply missing information. */
export const OWNING_STAGE = Object.freeze({
  REQUIREMENTS: '01-requirement-analyzer',
  TEST_CASE_REVIEW: '03-test-case-reviewer',
  TEST_DATA: '04-test-data-generator',
  ENVIRONMENT: 'ENVIRONMENT',
} as const);

const RULE_OWNERS: Readonly<Record<string, string>> = Object.freeze({
  [RULE.NO_EXPECTED_RESULTS]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.STEP_WITHOUT_EXPECTED_RESULT]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.REVIEWER_MARKER]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.REWRITE_MARKER]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.VAGUE_EXPECTED_RESULT]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.UNQUOTED_TEXT]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.TIMING_WITHOUT_TARGET]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.UNASSERTABLE_OBSERVATION]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.INPUT_WITHOUT_DATA]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.PRECONDITION_MISSING]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.API_DETAILS]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.K6_DETAILS]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.UNRESOLVED_BINDING]: OWNING_STAGE.TEST_DATA,
  [RULE.UNRESOLVED_REQUEST_BODY]: OWNING_STAGE.TEST_DATA,
  [RULE.K6_SLA]: OWNING_STAGE.REQUIREMENTS,
  [RULE.API_AUTH]: OWNING_STAGE.ENVIRONMENT,
  [RULE.AUT_BASE_URL]: OWNING_STAGE.ENVIRONMENT,
  [RULE.CREDENTIAL_ENV_VAR]: OWNING_STAGE.ENVIRONMENT,
  // A browser Playwright cannot run means the test case must be reworded or kept manual
  [RULE.BROWSER_UNSUPPORTED]: OWNING_STAGE.TEST_CASE_REVIEW,
  [RULE.BROWSER_NOT_CONFIGURED]: OWNING_STAGE.ENVIRONMENT,
});

/** Owner by kind, for gaps reported without a rule (discovery and generation NEEDS_CONTEXT). */
const KIND_OWNERS: Readonly<Record<MissingKind, string>> = Object.freeze({
  LOCATOR: OWNING_STAGE.TEST_CASE_REVIEW,
  STATE: OWNING_STAGE.TEST_CASE_REVIEW,
  EXPECTED_RESULT: OWNING_STAGE.TEST_CASE_REVIEW,
  UNASSERTABLE: OWNING_STAGE.TEST_CASE_REVIEW,
  PRECONDITION: OWNING_STAGE.TEST_CASE_REVIEW,
  ENDPOINT: OWNING_STAGE.TEST_CASE_REVIEW,
  DATA: OWNING_STAGE.TEST_DATA,
  SLA: OWNING_STAGE.REQUIREMENTS,
  AUTH: OWNING_STAGE.ENVIRONMENT,
  AUT_UNREACHABLE: OWNING_STAGE.ENVIRONMENT,
  BROWSER: OWNING_STAGE.ENVIRONMENT,
});

/**
 * Stage (or ENVIRONMENT) that owns the answer to a readiness gap.
 * @param {MissingItem} item
 * @returns {string}
 */
export function owningStageFor(item: MissingItem): string {
  return (item.ruleId && RULE_OWNERS[item.ruleId]) || KIND_OWNERS[item.kind] || OWNING_STAGE.TEST_CASE_REVIEW;
}
