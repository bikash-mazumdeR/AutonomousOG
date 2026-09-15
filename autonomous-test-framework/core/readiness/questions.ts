'use strict';

/**
 * @fileoverview Turns readiness gaps into specific, answerable questions for the human at the owning stage's gate.
 */

import { READINESS_RULE as RULE } from './readinessConstants';
import { MissingItem, MissingKind } from './readinessTypes';

type QuestionTemplate = (item: MissingItem) => string;

const EXACT_OBSERVABLE = 'the exact text in quotes, the URL path, the element state or a numeric limit';

const RULE_QUESTIONS: Readonly<Record<string, QuestionTemplate>> = Object.freeze({
  [RULE.NO_EXPECTED_RESULTS]: () => `Which observable results should this test case verify (${EXACT_OBSERVABLE})?`,
  [RULE.STEP_WITHOUT_EXPECTED_RESULT]: (item) => `${item.detail} What is its observable result (${EXACT_OBSERVABLE})?`,
  [RULE.REVIEWER_MARKER]: (item) => `Step ${item.stepIndex}: what exactly should be observed (${EXACT_OBSERVABLE})?`,
  [RULE.REWRITE_MARKER]: (item) => `Step ${item.stepIndex}: which exact action should the user perform, and what is the observable result?`,
  [RULE.VAGUE_EXPECTED_RESULT]: (item) => `${item.detail} What exactly should be observed (${EXACT_OBSERVABLE})?`,
  [RULE.UNQUOTED_TEXT]: (item) => `${item.detail} What is the exact text, word for word?`,
  [RULE.TIMING_WITHOUT_TARGET]: (item) => `${item.detail} Which page (URL path) or element must appear within the time limit?`,
  [RULE.UNASSERTABLE_OBSERVATION]: (item) => `${item.detail} Can it be reworded as something visible in the application, or should this test case be marked manual?`,
  [RULE.INPUT_WITHOUT_DATA]: (item) => `${item.detail} Which value should be entered (literally, or as a {{placeholder}} with its rule such as a length)?`,
  [RULE.PRECONDITION_MISSING]: () => 'What state must the application and the user be in before this test case starts?',
  [RULE.UNRESOLVED_BINDING]: (item) => `${item.detail} What value should be used?`,
  [RULE.UNRESOLVED_REQUEST_BODY]: (item) => `${item.detail} What request body should be sent?`,
  [RULE.API_DETAILS]: () => 'Which relative endpoint, HTTP method and expected status code does this API test case use?',
  [RULE.API_AUTH]: () => 'Which environment variable holds the API authorization header for this project?',
  [RULE.K6_DETAILS]: () => 'Which load scenario (load, stress, spike or soak) and relative target endpoint does this performance test use?',
  [RULE.K6_SLA]: () => 'Which latency limit (for example "p95 under 500 ms") must this performance test enforce?',
  [RULE.CREDENTIAL_ENV_VAR]: (item) => `${item.detail} Set it in the environment and declare it in the AUT profile (auth.credentialEnvVars).`,
  [RULE.BROWSER_UNSUPPORTED]: (item) => `${item.detail} Reword the test case for a supported browser, or mark it manual.`,
  [RULE.BROWSER_NOT_CONFIGURED]: (item) => `${item.detail} Add the browser to "browsers" in the AUT profile, or reword the test case or mark it manual.`,
  [RULE.AUT_BASE_URL]: (item) => `${item.detail} Which application URL should the automation run against?`,
});

const KIND_QUESTIONS: Readonly<Record<MissingKind, QuestionTemplate>> = Object.freeze({
  LOCATOR: (item) => `${item.detail} How can this element be identified on the page (its visible text, label or role), or should the step be reworded?`,
  STATE: (item) => `${item.detail} Which steps or data reach this state, or should the test case be reworded?`,
  DATA: (item) => `${item.detail} Which value should be used?`,
  ENDPOINT: (item) => `${item.detail} Which relative endpoint should be used?`,
  AUTH: (item) => `${item.detail} How does the automation authenticate?`,
  EXPECTED_RESULT: (item) => `${item.detail} What exactly should be observed (${EXACT_OBSERVABLE})?`,
  SLA: (item) => `${item.detail} Which latency limit applies?`,
  AUT_UNREACHABLE: (item) => `${item.detail} Which application URL should the automation run against?`,
  UNASSERTABLE: (item) => `${item.detail} Can it be reworded as something visible in the application, or should this test case be marked manual?`,
  PRECONDITION: (item) => `${item.detail} What state must the application and the user be in before the test starts?`,
  BROWSER: (item) => `${item.detail} Which configured browser should run it, or should this test case be marked manual?`,
});

/**
 * Specific question that resolves a readiness gap.
 * @param {MissingItem} item
 * @returns {string}
 */
export function questionFor(item: MissingItem): string {
  const template = (item.ruleId && RULE_QUESTIONS[item.ruleId]) || KIND_QUESTIONS[item.kind];
  return template ? template(item) : item.detail;
}
