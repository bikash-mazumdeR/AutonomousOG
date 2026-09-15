'use strict';

/**
 * @fileoverview Review-level readiness bookkeeping shared by the Agent 03 agent and its UI: counts, the open questions
 * shown at the approval gate, and re-evaluating a stored review after answers or edits.
 */

import { ClarificationStore } from '../../../core/clarifications/ClarificationStore';
import { REVIEW_STATUS, isAutomationApproved, isTestCaseSelected } from '../../../core/types';
import { applyClarificationAnswers } from './applyAnswers';
import { ReviewReadinessContext, holdUnreadyTestCases } from './holdReview';

/** An open question about a reviewed test case. */
export interface OpenReviewClarification {
  id: string;
  tcKey: string;
  kind: string;
  question: string;
  owningStage: string;
  requiresDecision: boolean;
}

/**
 * Open questions of all held test cases.
 * @param {any[]} testCases
 * @returns {OpenReviewClarification[]}
 */
export function collectOpenClarifications(testCases: any[]): OpenReviewClarification[] {
  return testCases.flatMap((tc) => (tc.openClarifications || []).map((c: any) => ({ ...c, tcKey: tc.key })));
}

/**
 * Gate lines for open questions.
 * @param {OpenReviewClarification[]} open
 * @returns {string[]}
 */
export function describeOpenClarifications(open: OpenReviewClarification[]): string[] {
  return (open || []).map((c) => `${c.tcKey} [${c.kind}] ${c.question} (id ${c.id})`
    + `${c.requiresDecision ? ' — answered before without resolving it: mark the test case manual, dismiss or reject' : ''}`);
}

/**
 * Recomputes review counts from the stored test cases.
 * @param {any} reviewedOutput - reviewedTestCases artifact (updated in place)
 */
export function recountReview(reviewedOutput: any): void {
  const all: any[] = reviewedOutput.reviewedZephyrExport.testCases || [];
  const active = all.filter((tc) => isTestCaseSelected(tc) && tc.reviewStatus !== REVIEW_STATUS.EXCLUDED);
  const withStatus = (status: string) => active.filter((tc) => tc.reviewStatus === status).length;
  reviewedOutput.approvedCount = active.filter((tc) => isAutomationApproved(tc)).length;
  reviewedOutput.rejectedCount = withStatus(REVIEW_STATUS.REJECTED);
  reviewedOutput.heldCount = withStatus(REVIEW_STATUS.HELD);
  reviewedOutput.manualCount = withStatus(REVIEW_STATUS.MANUAL);
  reviewedOutput.rewrittenCount = all.filter((tc) => (tc.rewrittenSteps || 0) > 0).length;
  reviewedOutput.openClarifications = collectOpenClarifications(active);
  reviewedOutput.reviewedZephyrExport.totalTestCases = reviewedOutput.approvedCount;
}

/**
 * Re-evaluates a stored review after answers or edits: applies answers, re-runs the readiness hold and recounts.
 * @param {any} reviewedOutput - reviewedTestCases artifact (updated in place)
 * @param {ClarificationStore} store
 * @param {ReviewReadinessContext} [ctx]
 */
export function refreshReviewReadiness(reviewedOutput: any, store: ClarificationStore, ctx: ReviewReadinessContext = {}): void {
  const active = (reviewedOutput?.reviewedZephyrExport?.testCases || [])
    .filter((tc: any) => isTestCaseSelected(tc) && tc.reviewStatus !== REVIEW_STATUS.EXCLUDED);
  applyClarificationAnswers(active, store);
  holdUnreadyTestCases(active, store, ctx);
  recountReview(reviewedOutput);
}
