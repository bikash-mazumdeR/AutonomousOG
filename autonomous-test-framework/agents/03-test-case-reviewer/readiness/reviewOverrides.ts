'use strict';

/**
 * @fileoverview Human decisions on a stored Agent 03 review: test case edits and status overrides (which may not approve
 * a test case whose readiness questions are still open) and answers to clarification questions.
 */

import { Clarification, ClarificationStore } from '../../../core/clarifications/ClarificationStore';
import { REVIEW_STATUS } from '../../../core/types';
import { ReviewReadinessContext } from './holdReview';
import { OpenReviewClarification, collectOpenClarifications, refreshReviewReadiness } from './reviewReadiness';

/** Result of a human decision. */
export const DECISION_OUTCOME = Object.freeze({
  UPDATED: 'UPDATED',
  HELD: 'HELD',
  NOT_FOUND: 'NOT_FOUND',
  INVALID: 'INVALID',
} as const);
export type DecisionOutcome = typeof DECISION_OUTCOME[keyof typeof DECISION_OUTCOME];

/** What a human does with a clarification question. */
export const CLARIFY_ACTION = Object.freeze({
  ANSWER: 'ANSWER',
  MARK_MANUAL: 'MARK_MANUAL',
  DISMISS: 'DISMISS',
} as const);

/** Recorded decider when the UI does not name one. */
export const DEFAULT_DECIDER = 'review-ui';

const APPROVING_STATUSES: ReadonlySet<string> = new Set([REVIEW_STATUS.PASSED, REVIEW_STATUS.FLAGGED, REVIEW_STATUS.REWRITTEN]);
const SETTABLE_STATUSES: ReadonlySet<string> = new Set(Object.values(REVIEW_STATUS).filter((status) => status !== REVIEW_STATUS.HELD));
const REJECTED_REASON = 'Test case rejected at review';
const DISMISSED_REASON = 'Dismissed at review';

/** Fields a human may change on a reviewed test case. */
export interface ReviewOverride {
  key?: string;
  reviewStatus?: string;
  name?: string;
  objective?: string;
  precondition?: string;
  testSteps?: any[];
  reviewNotes?: string[];
  decidedBy?: string;
}

/** Outcome of an override; `reviewedOutput` is the updated review to save, present only when UPDATED. */
export interface OverrideResult {
  outcome: DecisionOutcome;
  message?: string;
  reviewedOutput?: any;
  testCase?: any;
  openClarifications?: OpenReviewClarification[];
}

/** A human decision on one clarification. */
export interface ClarifyDecision {
  id?: string;
  action?: string;
  answer?: string;
  reason?: string;
  decidedBy?: string;
}

/** Outcome of a clarification decision. */
export interface ClarifyResult {
  outcome: DecisionOutcome;
  message?: string;
  clarification?: Clarification;
}

function applyFields(tc: any, body: ReviewOverride): void {
  if (typeof body.name === 'string' && body.name.trim()) tc.name = body.name.trim();
  if (typeof body.objective === 'string') tc.objective = body.objective.trim();
  if (typeof body.precondition === 'string') tc.precondition = body.precondition.trim();
  if (Array.isArray(body.reviewNotes)) tc.reviewNotes = body.reviewNotes;
  if (Array.isArray(body.testSteps)) {
    tc.testSteps = body.testSteps.map((step: any) => ({
      keyword: step.keyword || undefined,
      description: String(step.description || '').trim(),
      testData: String(step.testData || '').trim(),
      expectedResult: String(step.expectedResult || '').trim(),
    }));
  }
}

/** A manual or rejected test case leaves no open questions behind. */
function settleOpenQuestions(store: ClarificationStore, tcKey: string, status: string, decidedBy: string): void {
  const open = store.listOpen({ tcKeys: [tcKey] });
  if (status === REVIEW_STATUS.MANUAL) open.forEach((c) => store.markManual(c.id, decidedBy));
  if (status === REVIEW_STATUS.REJECTED) open.forEach((c) => store.dismiss(c.id, REJECTED_REASON, decidedBy));
}

/**
 * Applies a human edit or status override to a copy of the stored review and re-runs the readiness hold. Approving a
 * test case that still has open questions (or was marked manual by a decision) is refused with HELD and nothing changes.
 * @param {any} reviewedOutput - Stored reviewedTestCases artifact (not modified)
 * @param {ReviewOverride} body
 * @param {ClarificationStore} store
 * @param {ReviewReadinessContext} [ctx]
 * @returns {OverrideResult}
 */
export function applyReviewOverride(reviewedOutput: any, body: ReviewOverride, store: ClarificationStore, ctx: ReviewReadinessContext = {}): OverrideResult {
  const status = typeof body.reviewStatus === 'string' ? body.reviewStatus.trim().toUpperCase() : '';
  if (status && !SETTABLE_STATUSES.has(status)) {
    return { outcome: DECISION_OUTCOME.INVALID, message: `Review status "${status}" cannot be set; use one of ${[...SETTABLE_STATUSES].join(', ')}.` };
  }
  const draft = JSON.parse(JSON.stringify(reviewedOutput));
  const tc = (draft?.reviewedZephyrExport?.testCases || []).find((candidate: any) => candidate.key === body.key);
  if (!tc) return { outcome: DECISION_OUTCOME.NOT_FOUND, message: `Reviewed test case ${body.key} not found.` };

  applyFields(tc, body);
  if (status) {
    tc.reviewStatus = status;
    settleOpenQuestions(store, tc.key, status, body.decidedBy?.trim() || DEFAULT_DECIDER);
  }
  refreshReviewReadiness(draft, store, ctx);
  if (APPROVING_STATUSES.has(status) && !APPROVING_STATUSES.has(tc.reviewStatus)) {
    return {
      outcome: DECISION_OUTCOME.HELD,
      message: `${tc.key} cannot be approved while it is ${tc.reviewStatus}: answer its questions, mark it manual or reject it.`,
      testCase: tc,
      openClarifications: collectOpenClarifications([tc]),
    };
  }
  return { outcome: DECISION_OUTCOME.UPDATED, reviewedOutput: draft, testCase: tc };
}

/**
 * Records a human decision on a clarification: an answer, a manual-test decision or a dismissal. A question already
 * answered MAX_ASK_ROUNDS times without clearing the gap needs a decision instead of another answer.
 * @param {ClarificationStore} store
 * @param {ClarifyDecision} decision
 * @returns {ClarifyResult}
 */
export function applyClarificationDecision(store: ClarificationStore, decision: ClarifyDecision): ClarifyResult {
  const existing = decision.id ? store.get(decision.id) : null;
  if (!existing) return { outcome: DECISION_OUTCOME.NOT_FOUND, message: `Clarification ${decision.id ?? ''} not found.` };
  const by = decision.decidedBy?.trim() || DEFAULT_DECIDER;
  const action = String(decision.action || CLARIFY_ACTION.ANSWER).trim().toUpperCase();

  let clarification: Clarification | null;
  if (action === CLARIFY_ACTION.ANSWER) {
    const answer = decision.answer?.trim();
    if (!answer) return { outcome: DECISION_OUTCOME.INVALID, message: 'An answer is required.' };
    if (existing.context.requiresDecision) {
      return { outcome: DECISION_OUTCOME.INVALID, message: 'Earlier answers did not resolve this question: mark the test case manual, dismiss the question or reject the test case.' };
    }
    clarification = store.answer(existing.id, answer, by);
  } else if (action === CLARIFY_ACTION.MARK_MANUAL) {
    clarification = store.markManual(existing.id, by);
  } else if (action === CLARIFY_ACTION.DISMISS) {
    clarification = store.dismiss(existing.id, decision.reason?.trim() || DISMISSED_REASON, by);
  } else {
    return { outcome: DECISION_OUTCOME.INVALID, message: `Unknown action "${action}"; use one of ${Object.values(CLARIFY_ACTION).join(', ')}.` };
  }
  return { outcome: DECISION_OUTCOME.UPDATED, clarification: clarification ?? undefined };
}
