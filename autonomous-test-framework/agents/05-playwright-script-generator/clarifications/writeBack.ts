'use strict';

/**
 * @fileoverview Writes Agent 05's NEEDS_CONTEXT gaps back as clarifications routed to the stage that owns the missing
 * information, so the next run asks upstream instead of failing here again.
 */

import { ClarificationStore } from '../../../core/clarifications/ClarificationStore';
import { OWNING_STAGE, owningStageFor } from '../../../core/readiness/ownership';
import { questionFor } from '../../../core/readiness/questions';
import { MISSING_KINDS, MissingItem, MissingKind } from '../../../core/readiness/readinessTypes';
import { AutomationTestCaseResult } from '../../../core/types';
import { AutomationTestCase } from '../contracts/automationTestCase';
import { STAGE_ID, TC_OUTCOME } from '../constants';

type ResultGap = NonNullable<AutomationTestCaseResult['missing']>[number];

/** What was written back. */
export interface WriteBackSummary {
  /** Distinct questions raised for test cases. */
  raised: number;
  /** Distinct environment issues (one per project). */
  environment: number;
  /** Earlier questions resolved because their gap no longer occurs. */
  resolved: number;
}

const STEP_IN_DETAIL = /\bStep (\d+)\b/;
const UNKNOWN_KIND: MissingKind = 'STATE';

function toMissingItem(gap: ResultGap): MissingItem {
  const kind = ((MISSING_KINDS as readonly string[]).includes(gap.kind) ? gap.kind : UNKNOWN_KIND) as MissingKind;
  const step = gap.detail.match(STEP_IN_DETAIL);
  return {
    kind, detail: gap.detail, ruleId: gap.ruleId, stepIndex: gap.stepIndex ?? (step ? Number(step[1]) : undefined), subject: gap.subject,
  };
}

function raiseGap(store: ClarificationStore, result: AutomationTestCaseResult, gap: ResultGap, tc: AutomationTestCase | undefined) {
  const item = toMissingItem(gap);
  const owningStage = owningStageFor(item);
  const environment = owningStage === OWNING_STAGE.ENVIRONMENT;
  const clarification = store.raise({
    sourceStage: STAGE_ID,
    owningStage,
    kind: item.kind,
    ruleId: item.ruleId,
    tcKey: environment ? undefined : result.tcKey,
    featureId: tc?.featureId,
    requirementRef: tc?.requirementRefs[0],
    stepIndex: environment ? undefined : item.stepIndex,
    // Project-wide questions are kept apart by subject (e.g. one question per missing browser)
    subject: environment ? item.subject : undefined,
    question: questionFor(item),
    context: { detail: item.detail, tcKey: result.tcKey },
  });
  Object.assign(gap, { owningStage, clarificationId: clarification.id });
  return { clarification, environment };
}

/**
 * Raises one clarification per NEEDS_CONTEXT gap (environment gaps once per project), resolves earlier questions whose
 * gap no longer occurs, and annotates each gap with its owning stage and clarification id.
 * @param {ClarificationStore} store
 * @param {AutomationTestCaseResult[]} results - Agent 05 outcomes (annotated in place)
 * @param {AutomationTestCase[]} testCases
 * @returns {WriteBackSummary}
 */
export function writeBackClarifications(store: ClarificationStore, results: AutomationTestCaseResult[], testCases: AutomationTestCase[]): WriteBackSummary {
  const byKey = new Map(testCases.map((tc) => [tc.tcKey, tc]));
  const raised = new Set<string>();
  const environment = new Set<string>();
  let resolved = 0;
  for (const result of results) {
    if (result.status === TC_OUTCOME.GENERATED) {
      resolved += store.resolveMissing({ sourceStage: STAGE_ID, tcKey: result.tcKey, firingKeys: [] });
      continue;
    }
    if (result.status !== TC_OUTCOME.NEEDS_CONTEXT) continue;
    const firingKeys: string[] = [];
    for (const gap of result.missing || []) {
      const outcome = raiseGap(store, result, gap, byKey.get(result.tcKey));
      (outcome.environment ? environment : raised).add(outcome.clarification.id);
      firingKeys.push(outcome.clarification.dedupeKey);
    }
    resolved += store.resolveMissing({ sourceStage: STAGE_ID, tcKey: result.tcKey, firingKeys });
  }
  return { raised: raised.size, environment: environment.size, resolved };
}
