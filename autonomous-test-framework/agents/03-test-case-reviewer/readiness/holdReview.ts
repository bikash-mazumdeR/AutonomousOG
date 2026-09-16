'use strict';

/**
 * @fileoverview Agent 03 automation-readiness gate: holds every test case that cannot be automated without guessing and
 * raises one specific question per gap, answered at the Agent 03 approval gate — instead of approving it and letting
 * Agent 05 discover the gap.
 */

import {
  CLARIFICATION_STATUS, Clarification, ClarificationRequest, ClarificationStore,
} from '../../../core/clarifications/ClarificationStore';
import { assessReadiness } from '../../../core/readiness/readinessRules';
import { OWNING_STAGE, owningStageFor } from '../../../core/readiness/ownership';
import { questionFor } from '../../../core/readiness/questions';
import { READINESS_RULE as RULE, SLA_PATTERN } from '../../../core/readiness/readinessConstants';
import {
  MissingItem, READINESS_PHASE, ReadinessInput, ReadinessMode,
} from '../../../core/readiness/readinessTypes';
import { REVIEW_STATUS } from '../../../core/types';
import { targetedBrowsers } from '../../../core/readiness/browserTargets';

const STAGE_ID = OWNING_STAGE.TEST_CASE_REVIEW;

/** Label added to test cases a human decided to keep manual. */
export const MANUAL_LABEL = 'Manual';

/** Owners whose open questions hold a test case at review; data and environment gaps are asked by their own stages later. */
const HOLDING_OWNERS: ReadonlySet<string> = new Set([OWNING_STAGE.TEST_CASE_REVIEW, OWNING_STAGE.REQUIREMENTS]);

/** Rules Agent 03 evaluates itself; the same question raised by a later stage is superseded by Agent 03's own result. */
const GENERATION_ONLY_RULES: ReadonlySet<string> = new Set([RULE.UNRESOLVED_BINDING, RULE.UNRESOLVED_REQUEST_BODY, RULE.API_AUTH, RULE.AUT_BASE_URL]);
const REVIEW_EVALUATED_RULES: ReadonlySet<string> = new Set(Object.values(RULE).filter((rule) => !GENERATION_ONLY_RULES.has(rule)));

/** Review-phase readiness settings. */
export interface ReviewReadinessContext {
  /** Performance threshold env var from the AUT profile, when the project defines one. */
  thresholdEnv?: string;
}

/** Test cases held or marked manual. */
export interface HoldSummary {
  held: string[];
  manual: string[];
}

function modeFor(tc: any): ReadinessMode {
  if (tc.type === 'API') return 'API';
  return tc.type === 'Performance' ? 'K6' : 'UI';
}

/**
 * Readiness facts of a reviewed test case (steps numbered from 1).
 * @param {any} tc
 * @returns {ReadinessInput}
 */
export function readinessInputFor(tc: any): ReadinessInput {
  const steps = (tc.testSteps || []).map((step: any, idx: number) => ({
    index: idx + 1,
    action: String(step.description || '').trim(),
    expected: String(step.expectedResult || '').split('\n').map((line) => line.trim()).filter(Boolean),
    testData: String(step.testData || '').trim(),
    data: [],
  }));
  const details = tc.apiDetails;
  const ref = tc.performanceRef;
  return {
    precondition: String(tc.precondition || ''),
    steps,
    targetBrowsers: targetedBrowsers([String(tc.name || ''), String(tc.precondition || ''), ...steps.flatMap((step: any) => [step.action, ...step.expected])]),
    api: details ? { method: String(details.method || ''), endpoint: String(details.endpoint || '').trim(), expectedStatusCode: Number(details.expectedStatusCode) } : undefined,
    performance: ref ? {
      scenario: String(ref.scenario || '').toLowerCase(),
      targetEndpoint: String(ref.targetEndpoint || '').trim(),
      slaText: steps.flatMap((step: any) => step.expected).find((line: string) => SLA_PATTERN.test(line)),
    } : undefined,
  };
}

function requestFor(tc: any, item: MissingItem): ClarificationRequest {
  return {
    sourceStage: STAGE_ID,
    owningStage: owningStageFor(item),
    kind: item.kind,
    ruleId: item.ruleId,
    tcKey: tc.key,
    featureId: tc.featureId,
    requirementRef: tc.requirementRefs?.[0],
    stepIndex: item.stepIndex,
    subject: item.subject,
    question: questionFor(item),
    context: { detail: item.detail, subject: item.subject },
    subjectHash: tc.hash,
  };
}

/** Resolves questions later stages raised for rules Agent 03 has just re-evaluated for this test case. */
function resolveSupersededQuestions(store: ClarificationStore, tcKey: string): void {
  const upstream = store.listOpen({ tcKeys: [tcKey] }).filter((c) => c.sourceStage !== STAGE_ID);
  for (const sourceStage of new Set(upstream.map((c) => c.sourceStage))) {
    const stillOpen = upstream.filter((c) => c.sourceStage === sourceStage && !(c.ruleId && REVIEW_EVALUATED_RULES.has(c.ruleId)));
    store.resolveMissing({ sourceStage, tcKey, firingKeys: stillOpen.map((c) => c.dedupeKey) });
  }
}

function applyHold(tc: any, open: Clarification[]): void {
  if (open.length === 0) {
    if (tc.reviewStatus === REVIEW_STATUS.HELD) tc.reviewStatus = tc.reviewStatusBeforeHold || REVIEW_STATUS.PASSED;
    delete tc.reviewStatusBeforeHold;
    delete tc.openClarifications;
    return;
  }
  if (tc.reviewStatus !== REVIEW_STATUS.HELD) tc.reviewStatusBeforeHold = tc.reviewStatus;
  tc.reviewStatus = REVIEW_STATUS.HELD;
  tc.openClarifications = open.map(heldReasonFor);
}

/**
 * Everything a reviewer needs to understand and resolve one hold reason: the question, the rule that found the gap,
 * the step and line it is about, and earlier answers that did not clear it.
 * @param {Clarification} c
 * @returns {object}
 */
export function heldReasonFor(c: Clarification): Record<string, unknown> {
  const stepIndex = Number(c.context.stepIndex);
  return {
    id: c.id,
    kind: c.kind,
    ruleId: c.ruleId,
    question: c.question,
    detail: typeof c.context.detail === 'string' ? c.context.detail : undefined,
    stepIndex: Number.isInteger(stepIndex) && stepIndex > 0 ? stepIndex : undefined,
    subject: typeof c.context.subject === 'string' ? c.context.subject : undefined,
    owningStage: c.owningStage,
    sourceStage: c.sourceStage,
    askRounds: c.askRounds,
    previousAnswer: typeof c.context.previousAnswer === 'string' ? c.context.previousAnswer : undefined,
    requiresDecision: Boolean(c.context.requiresDecision),
  };
}

function markManual(tc: any): void {
  tc.reviewStatus = REVIEW_STATUS.MANUAL;
  tc.labels = [...new Set([...(tc.labels || []), MANUAL_LABEL])];
  delete tc.reviewStatusBeforeHold;
  delete tc.openClarifications;
}

function manualTestCaseKeys(store: ClarificationStore, testCases: any[]): Set<string> {
  const hashByKey = new Map(testCases.map((tc) => [tc.key, tc.hash]));
  return new Set(store.list({ statuses: [CLARIFICATION_STATUS.MANUAL] })
    .filter((c) => c.tcKey && hashByKey.has(c.tcKey) && (!c.subjectHash || !hashByKey.get(c.tcKey) || c.subjectHash === hashByKey.get(c.tcKey)))
    .map((c) => c.tcKey as string));
}

/**
 * Evaluates automation readiness for reviewed test cases: raises a question per gap, holds test cases with open
 * questions (including ones later stages raised), releases answered ones and applies manual decisions.
 * @param {any[]} testCases - Reviewed test cases (updated in place; rejected ones are skipped)
 * @param {ClarificationStore} store
 * @param {ReviewReadinessContext} [ctx]
 * @returns {HoldSummary}
 */
export function holdUnreadyTestCases(testCases: any[], store: ClarificationStore, ctx: ReviewReadinessContext = {}): HoldSummary {
  const summary: HoldSummary = { held: [], manual: [] };
  const manualKeys = manualTestCaseKeys(store, testCases);
  for (const tc of testCases.filter((candidate) => candidate.reviewStatus !== REVIEW_STATUS.REJECTED)) {
    if (manualKeys.has(tc.key)) {
      markManual(tc);
      summary.manual.push(tc.key);
      continue;
    }
    const items = assessReadiness(readinessInputFor(tc), {
      mode: modeFor(tc), baseURL: null, baseUrlEnv: '', authStrategy: 'none', thresholdEnv: ctx.thresholdEnv, phase: READINESS_PHASE.REVIEW,
    });
    const raised = items.map((item) => store.raise(requestFor(tc, item)));
    store.resolveMissing({ sourceStage: STAGE_ID, tcKey: tc.key, firingKeys: raised.map((c) => c.dedupeKey) });
    resolveSupersededQuestions(store, tc.key);
    const open = store.listOpen({ tcKeys: [tc.key] }).filter((c) => HOLDING_OWNERS.has(c.owningStage));
    applyHold(tc, open);
    if (open.length > 0) summary.held.push(tc.key);
  }
  return summary;
}
