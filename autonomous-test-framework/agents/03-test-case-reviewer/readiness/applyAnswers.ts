'use strict';

/**
 * @fileoverview Applies human answers to Agent 03 clarifications to the test cases they were asked about. Answers are
 * matched by test case key and content hash, so they never land on a regenerated, different test case.
 */

import { CLARIFICATION_STATUS, Clarification, ClarificationStore } from '../../../core/clarifications/ClarificationStore';
import { OWNING_STAGE } from '../../../core/readiness/ownership';
import { QUOTED_TEXT, READINESS_RULE as RULE } from '../../../core/readiness/readinessConstants';

type Applier = (tc: any, answer: string, clarification: Clarification) => boolean;

const STAGE_ID = OWNING_STAGE.TEST_CASE_REVIEW;
const API_ANSWER = /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)\s+(\d{3})\s*$/i;
const K6_ANSWER = /^\s*(load|stress|spike|soak)\s+(\/\S*)\s*$/i;

function stepOf(tc: any, clarification: Clarification): any {
  const index = Number(clarification.context.stepIndex);
  return Number.isInteger(index) && index > 0 ? tc.testSteps?.[index - 1] : undefined;
}

function replaceExpectedLine(step: any, subject: unknown, replacement: string): boolean {
  if (!step || typeof subject !== 'string') return false;
  const lines = String(step.expectedResult || '').split('\n');
  const index = lines.findIndex((line) => line.trim() === subject);
  if (index === -1) return false;
  lines[index] = replacement;
  step.expectedResult = lines.join('\n');
  return true;
}

function setStepField(field: 'expectedResult' | 'testData' | 'description'): Applier {
  return (tc, answer, clarification) => {
    const step = stepOf(tc, clarification);
    if (!step) return false;
    step[field] = answer;
    return true;
  };
}

const replaceLine: Applier = (tc, answer, clarification) => replaceExpectedLine(stepOf(tc, clarification), clarification.context.subject, answer);

const APPLIERS: Readonly<Record<string, Applier>> = Object.freeze({
  [RULE.UNQUOTED_TEXT]: (tc, answer, clarification) => {
    const { subject } = clarification.context;
    return replaceExpectedLine(stepOf(tc, clarification), subject, QUOTED_TEXT.test(answer) ? answer : `${subject} with the text "${answer}"`);
  },
  [RULE.VAGUE_EXPECTED_RESULT]: replaceLine,
  [RULE.TIMING_WITHOUT_TARGET]: replaceLine,
  [RULE.UNASSERTABLE_OBSERVATION]: replaceLine,
  [RULE.REVIEWER_MARKER]: replaceLine,
  [RULE.STEP_WITHOUT_EXPECTED_RESULT]: setStepField('expectedResult'),
  [RULE.INPUT_WITHOUT_DATA]: setStepField('testData'),
  [RULE.REWRITE_MARKER]: setStepField('description'),
  [RULE.NO_EXPECTED_RESULTS]: (tc, answer) => {
    const last = tc.testSteps?.[tc.testSteps.length - 1];
    if (!last) return false;
    last.expectedResult = answer;
    return true;
  },
  [RULE.PRECONDITION_MISSING]: (tc, answer) => {
    tc.precondition = answer;
    return true;
  },
  [RULE.API_DETAILS]: (tc, answer) => {
    const match = answer.match(API_ANSWER);
    if (!match) return false;
    tc.apiDetails = {
      ...(tc.apiDetails || {}), method: match[1].toUpperCase(), endpoint: match[2], expectedStatusCode: Number(match[3]),
    };
    return true;
  },
  [RULE.K6_DETAILS]: (tc, answer) => {
    const match = answer.match(K6_ANSWER);
    if (!match) return false;
    tc.performanceRef = { ...(tc.performanceRef || {}), scenario: match[1].toLowerCase(), targetEndpoint: match[2] };
    return true;
  },
});

/** Answers without a structured target (e.g. how discovery should find an element) are kept as review notes. */
const recordNote: Applier = (tc, answer, clarification) => {
  const step = clarification.context.stepIndex ? ` (step ${clarification.context.stepIndex})` : '';
  const note = `Clarification ${clarification.kind}${step}: ${answer}`;
  if (!(tc.reviewNotes || []).includes(note)) tc.reviewNotes = [...(tc.reviewNotes || []), note];
  return true;
};

/**
 * Applies answered Agent 03 clarifications to matching test cases and marks them applied.
 * @param {any[]} testCases - Test cases under review (updated in place)
 * @param {ClarificationStore} store
 * @returns {string[]} Ids of the clarifications applied
 */
export function applyClarificationAnswers(testCases: any[], store: ClarificationStore): string[] {
  const byKey = new Map(testCases.map((tc) => [tc.key, tc]));
  const applied: string[] = [];
  const answered = store.list({ owningStage: STAGE_ID, statuses: [CLARIFICATION_STATUS.ANSWERED, CLARIFICATION_STATUS.APPLIED] });
  for (const clarification of answered) {
    const tc = clarification.tcKey ? byKey.get(clarification.tcKey) : undefined;
    const sameContent = !clarification.subjectHash || !tc?.hash || clarification.subjectHash === tc.hash;
    if (!tc || !clarification.answer || !sameContent) continue;
    const apply = (clarification.ruleId && APPLIERS[clarification.ruleId]) || recordNote;
    if (!apply(tc, clarification.answer.trim(), clarification)) continue;
    if (clarification.status !== CLARIFICATION_STATUS.APPLIED) store.markApplied(clarification.id);
    applied.push(clarification.id);
  }
  return applied;
}
