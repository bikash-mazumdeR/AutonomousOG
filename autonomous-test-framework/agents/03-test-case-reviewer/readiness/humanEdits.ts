'use strict';

/**
 * @fileoverview Human edits made at the Agent 03 review. They are recorded on the reviewed test case and carried into the
 * next review run, which otherwise starts again from Agent 02's unedited test cases — so a fixed test case would be
 * held again for the gap the human already fixed. Edits are carried only while the Agent 02 content they were made on
 * is unchanged (same hash), so they never land on a regenerated, different test case.
 */

/** Test case fields a human may edit at review. */
export const EDITABLE_FIELDS = Object.freeze(['name', 'objective', 'precondition', 'testSteps', 'labels'] as const);

type EditableField = typeof EDITABLE_FIELDS[number];

/** Record of human changes to one reviewed test case. */
export interface HumanEdit {
  /** Hash of the Agent 02 test case the edit was made on. */
  baseHash?: string;
  /** Fields changed by a human. */
  fields: EditableField[];
  /** Review status a human set explicitly, re-applied after an automated re-review. */
  reviewStatus?: string;
  editedBy: string;
  editedAt: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * Records which fields and status a human changed on a reviewed test case.
 * @param {any} tc - Reviewed test case (updated in place)
 * @param {{ fields: EditableField[], reviewStatus?: string, editedBy: string }} change
 */
export function recordHumanEdit(tc: any, change: { fields: EditableField[]; reviewStatus?: string; editedBy: string }): void {
  if (change.fields.length === 0 && !change.reviewStatus) return;
  const previous: HumanEdit | undefined = tc.humanEdit;
  tc.humanEdit = {
    baseHash: previous?.baseHash ?? tc.hash,
    fields: [...new Set([...(previous?.fields || []), ...change.fields])],
    reviewStatus: change.reviewStatus || previous?.reviewStatus,
    editedBy: change.editedBy,
    editedAt: new Date().toISOString(),
  } as HumanEdit;
}

/**
 * Copies human edits from the previous review onto the test cases about to be reviewed again.
 * @param {any[]} testCases - Agent 02 test cases selected for review (not modified)
 * @param {any} previousReview - Previous reviewedTestCases artifact, if any
 * @returns {{ testCases: any[], carried: string[], discarded: string[] }} copies with edits applied; keys carried and
 *   keys whose edits were dropped because the Agent 02 content changed
 */
export function carryForwardHumanEdits(testCases: any[], previousReview: any): { testCases: any[]; carried: string[]; discarded: string[] } {
  const previousByKey = new Map<string, any>((previousReview?.reviewedZephyrExport?.testCases || []).map((tc: any) => [tc.key, tc]));
  const carried: string[] = [];
  const discarded: string[] = [];
  const result = testCases.map((tc) => {
    const edit: HumanEdit | undefined = previousByKey.get(tc.key)?.humanEdit;
    if (!edit) return tc;
    if (edit.baseHash && tc.hash && edit.baseHash !== tc.hash) {
      discarded.push(tc.key);
      return tc;
    }
    const previous = previousByKey.get(tc.key);
    const next = { ...tc, humanEdit: clone(edit) };
    edit.fields.filter((field) => previous[field] !== undefined).forEach((field) => { next[field] = clone(previous[field]); });
    carried.push(tc.key);
    return next;
  });
  return { testCases: result, carried, discarded };
}

/**
 * Re-applies review statuses a human set explicitly, after the automated review recomputed them. The readiness hold
 * still runs afterwards, so a human status never approves a test case with open questions.
 * @param {any[]} reviewedTestCases - Updated in place
 * @returns {string[]} Keys whose status was restored
 */
export function reapplyHumanStatuses(reviewedTestCases: any[]): string[] {
  return reviewedTestCases
    .filter((tc) => tc.humanEdit?.reviewStatus && tc.reviewStatus !== tc.humanEdit.reviewStatus)
    .map((tc) => {
      tc.reviewStatus = tc.humanEdit.reviewStatus;
      return tc.key;
    });
}
