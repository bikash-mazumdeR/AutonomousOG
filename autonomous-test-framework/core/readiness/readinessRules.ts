'use strict';

/**
 * @fileoverview Deterministic automation-readiness rules. Agent 03 applies them while reviewing test cases (REVIEW) and
 * Agent 05 before generating automation (GENERATION), so a gap is found — and asked about — upstream, once.
 * Application-agnostic: the rules inspect wording and structure only.
 */

import {
  ABSENCE_OUTCOME, ELEMENT_STATE, HEX_COLOUR, HTTP_METHODS, INPUT_VERBS, K6_SCENARIOS, NON_TEXT_ELEMENT_NOUNS, NUMBER_WITH_UNIT, PLACEHOLDER_TOKEN,
  QUOTED_TEXT, READINESS_RULE as RULE, REVIEWER_CLARIFICATION_MARKER, REVIEWER_REWRITE_MARKER, SUBJECT_QUALIFIER, SUBJECT_VERB, TEXT_NOUNS, TIMING_CLAUSE, UI_TARGET_NOUNS,
  UNSUPPORTED_OBSERVATION, URL_PATH, VAGUE_OUTCOME,
} from './readinessConstants';
import {
  MissingItem, READINESS_PHASE, ReadinessContext, ReadinessInput, ReadinessMode, ReadinessStep,
} from './readinessTypes';
import { SUPPORTED_BROWSER_ENGINES } from './browserTargets';

function isConcrete(text: string): boolean {
  return [QUOTED_TEXT, URL_PATH, PLACEHOLDER_TOKEN, NUMBER_WITH_UNIT, HEX_COLOUR].some((pattern) => pattern.test(text));
}

/**
 * Whether the expected result is about an element that has no text of its own: the last word before the first verb
 * names an icon, image, logo, spinner and the like ("an error icon is displayed alongside the error message").
 */
function aboutNonTextElement(line: string): boolean {
  const verb = line.match(SUBJECT_VERB);
  if (!verb || verb.index === undefined) return false;
  // The head noun comes before any qualifying phrase: "an error message with an icon" is about the message
  const subject = line.slice(0, verb.index).split(SUBJECT_QUALIFIER)[0];
  const words = subject.trim().split(/\s+/);
  return NON_TEXT_ELEMENT_NOUNS.test(words[words.length - 1] || '');
}

function isRelativePath(value: string | undefined): boolean {
  return !!value && value.startsWith('/') && !value.startsWith('//');
}

function expectationItem(step: ReadinessStep, line: string, mode: ReadinessMode): MissingItem | null {
  const at = { stepIndex: step.index, subject: line };
  if (REVIEWER_CLARIFICATION_MARKER.test(line)) {
    return {
      kind: 'EXPECTED_RESULT', ruleId: RULE.REVIEWER_MARKER, ...at, detail: `Step ${step.index}: the reviewer marked the expected result as requiring clarification.`,
    };
  }
  if (UNSUPPORTED_OBSERVATION.test(line)) {
    return {
      kind: 'UNASSERTABLE', ruleId: RULE.UNASSERTABLE_OBSERVATION, ...at, detail: `Step ${step.index}: "${line}" cannot be observed through the user interface.`,
    };
  }
  if (VAGUE_OUTCOME.test(line) && !isConcrete(line)) {
    return {
      kind: 'EXPECTED_RESULT', ruleId: RULE.VAGUE_EXPECTED_RESULT, ...at, detail: `Step ${step.index}: "${line}" does not state an observable result.`,
    };
  }
  // Absence ("no longer displayed") and element states ("masked", "disabled") are asserted without quoting any text
  if (TEXT_NOUNS.test(line) && !isConcrete(line) && !ABSENCE_OUTCOME.test(line) && !ELEMENT_STATE.test(line) && !aboutNonTextElement(line)) {
    return {
      kind: 'EXPECTED_RESULT', ruleId: RULE.UNQUOTED_TEXT, ...at, detail: `Step ${step.index}: "${line}" does not quote the exact text to verify.`,
    };
  }
  if (mode === 'UI' && TIMING_CLAUSE.test(line) && !UI_TARGET_NOUNS.test(line) && !QUOTED_TEXT.test(line) && !URL_PATH.test(line)) {
    return {
      kind: 'EXPECTED_RESULT', ruleId: RULE.TIMING_WITHOUT_TARGET, ...at, detail: `Step ${step.index}: "${line}" sets a time limit without naming what must appear.`,
    };
  }
  return null;
}

function stepItems(step: ReadinessStep, mode: ReadinessMode, generation: boolean, anyExpected: boolean): MissingItem[] {
  const items: MissingItem[] = [];
  const onAction = { stepIndex: step.index, subject: step.action };
  if (REVIEWER_REWRITE_MARKER.test(step.action)) {
    items.push({
      kind: 'EXPECTED_RESULT', ruleId: RULE.REWRITE_MARKER, ...onAction, detail: `Step ${step.index}: the action was rewritten by the reviewer and needs human confirmation.`,
    });
  }
  if (!generation && anyExpected && step.expected.length === 0) {
    items.push({
      kind: 'EXPECTED_RESULT', ruleId: RULE.STEP_WITHOUT_EXPECTED_RESULT, ...onAction, detail: `Step ${step.index}: "${step.action}" has no expected result.`,
    });
  }
  step.expected.forEach((line) => {
    const item = expectationItem(step, line, mode);
    if (item) items.push(item);
  });
  const hasData = step.testData.trim() !== '' || PLACEHOLDER_TOKEN.test(step.action) || QUOTED_TEXT.test(step.action);
  if (INPUT_VERBS.test(step.action) && !hasData) {
    items.push({
      kind: 'DATA', ruleId: RULE.INPUT_WITHOUT_DATA, ...onAction, detail: `Step ${step.index}: "${step.action}" enters a value but the step gives no test data.`,
    });
  }
  if (generation) {
    step.data.filter((binding) => binding.unresolved).forEach((binding) => items.push({
      kind: 'DATA', ruleId: RULE.UNRESOLVED_BINDING, stepIndex: step.index, detail: `Step ${step.index}: ${binding.token} has no resolved value (run or complete Agent 04).`,
    }));
  }
  return items;
}

function apiItems(input: ReadinessInput, ctx: ReadinessContext, generation: boolean): MissingItem[] {
  const { api } = input;
  const items: MissingItem[] = [];
  if (!api || !isRelativePath(api.endpoint) || !HTTP_METHODS.includes(String(api.method).toUpperCase()) || !Number.isInteger(api.expectedStatusCode)) {
    items.push({ kind: 'ENDPOINT', ruleId: RULE.API_DETAILS, detail: 'apiDetails must define a relative endpoint, an HTTP method and an expected status code.' });
  }
  if (generation && api?.requestBodyUnresolved) {
    items.push({ kind: 'DATA', ruleId: RULE.UNRESOLVED_REQUEST_BODY, detail: 'The request body contains unresolved placeholders.' });
  }
  if (generation && ctx.authStrategy === 'apiToken' && !ctx.apiAuthHeaderEnv) {
    items.push({ kind: 'AUTH', ruleId: RULE.API_AUTH, detail: 'The AUT profile uses apiToken auth but api.authHeaderEnv is not configured.' });
  }
  return items;
}

function k6Items(input: ReadinessInput, ctx: ReadinessContext): MissingItem[] {
  const perf = input.performance;
  const items: MissingItem[] = [];
  if (!perf || !K6_SCENARIOS.includes(perf.scenario) || !isRelativePath(perf.targetEndpoint)) {
    items.push({ kind: 'ENDPOINT', ruleId: RULE.K6_DETAILS, detail: 'performanceRef must define a scenario (load|stress|spike|soak) and a relative target endpoint.' });
  }
  if (perf && !perf.slaText && !ctx.thresholdEnv) {
    items.push({ kind: 'SLA', ruleId: RULE.K6_SLA, detail: 'No latency SLA in the test case and no performance.thresholdEnv in the AUT profile.' });
  }
  return items;
}

/** A browser-specific test case must run in exactly the browser it names — never silently in another one. */
function browserItems(input: ReadinessInput, ctx: ReadinessContext): MissingItem[] {
  return (input.targetBrowsers || []).flatMap((target): MissingItem[] => {
    if (!target.engine) {
      return [{
        kind: 'BROWSER', ruleId: RULE.BROWSER_UNSUPPORTED, subject: target.label,
        detail: `The test case targets ${target.label}, which Playwright cannot run from the AUT profile (supported: ${SUPPORTED_BROWSER_ENGINES.join(', ')}).`,
      }];
    }
    if (!ctx.browsers || ctx.browsers.includes(target.engine)) return [];
    return [{
      kind: 'BROWSER', ruleId: RULE.BROWSER_NOT_CONFIGURED, subject: target.label,
      detail: `The test case targets ${target.label}, but the AUT profile only runs ${ctx.browsers.join(', ')}.`,
    }];
  });
}

/**
 * Lists everything that prevents automating a test case without guessing. Review-only rules (precondition) and
 * generation-only rules (environment, resolved data, auth) run only in their phase.
 * @param {ReadinessInput} input
 * @param {ReadinessContext} ctx
 * @returns {MissingItem[]}
 */
export function assessReadiness(input: ReadinessInput, ctx: ReadinessContext): MissingItem[] {
  const generation = (ctx.phase ?? READINESS_PHASE.GENERATION) === READINESS_PHASE.GENERATION;
  const items: MissingItem[] = [];
  const anyExpected = input.steps.some((step) => step.expected.length > 0);
  if (!anyExpected) {
    items.push({ kind: 'EXPECTED_RESULT', ruleId: RULE.NO_EXPECTED_RESULTS, detail: 'The test case has no steps with expected results.' });
  }
  input.steps.forEach((step) => items.push(...stepItems(step, ctx.mode, generation, anyExpected)));
  if (!generation && (!input.precondition?.trim() || /\bundefined\b/.test(input.precondition))) {
    items.push({ kind: 'PRECONDITION', ruleId: RULE.PRECONDITION_MISSING, detail: 'The precondition is missing.' });
  }
  if (generation && !ctx.baseURL) {
    items.push({ kind: 'AUT_UNREACHABLE', ruleId: RULE.AUT_BASE_URL, detail: `Environment variable ${ctx.baseUrlEnv} is not set.` });
  }
  items.push(...browserItems(input, ctx));
  if (ctx.mode === 'API') items.push(...apiItems(input, ctx, generation));
  if (ctx.mode === 'K6') items.push(...k6Items(input, ctx));
  return items;
}
