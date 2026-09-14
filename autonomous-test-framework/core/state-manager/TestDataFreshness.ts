'use strict';

/**
 * @fileoverview Freshness check for the Agent 04 test data artifact.
 * `StateManager.getPipelineArtifact` falls back to the latest older run when the current run has no
 * artifact, so a manifest can belong to a different review or run. This module decides whether a
 * manifest was generated for the reviewed test cases currently in state, so stale data is never
 * shown, edited or approved.
 *
 * @module TestDataFreshness
 */

import { isTestCaseSelected } from '../types';

export const TEST_DATA_STAGE_ID = '04-test-data-generator';

/** Stage statuses meaning Agent 04 produced output in the current run. */
const GENERATED_STATUSES = ['COMPLETED', 'AWAITING', 'APPROVED'];

/** Result of a freshness check. */
export interface TestDataFreshness {
  current: boolean;
  reason: string;
}

/** Test data loaded from state with its freshness verdict. */
export interface LoadedTestData {
  stage: any;
  reviewedTestCases: any;
  /** Stored artifact, possibly stale */
  stored: any;
  /** Stored artifact when current, otherwise null */
  testData: any;
  freshness: TestDataFreshness;
}

/**
 * Keys of the test cases Agent 04 generates data for (not rejected, still selected).
 * @param {any} reviewedTestCases - Agent 03 artifact
 * @returns {string[]}
 */
export function approvedTestCaseKeys(reviewedTestCases: any): string[] {
  const testCases: any[] = reviewedTestCases?.reviewedZephyrExport?.testCases || [];
  return testCases
    .filter((tc) => tc.reviewStatus !== 'REJECTED' && isTestCaseSelected(tc))
    .map((tc) => String(tc.key));
}

function sameKeys(a: string[], b: string[]): boolean {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((key) => left.has(key));
}

/**
 * Decides whether a test data artifact belongs to the current review and pipeline run.
 * @param {any} testData - Agent 04 artifact (`{ manifest }`)
 * @param {any} reviewedTestCases - Agent 03 artifact
 * @param {{status?: string}|null} [stage] - Agent 04 stage record of the current run
 * @returns {TestDataFreshness}
 */
export function assessTestDataFreshness(testData: any, reviewedTestCases: any, stage?: { status?: string } | null): TestDataFreshness {
  const manifest = testData?.manifest;
  if (!manifest) return { current: false, reason: 'Agent 04 has not generated test data yet.' };

  if (stage && !GENERATED_STATUSES.includes(String(stage.status))) {
    return {
      current: false,
      reason: `Agent 04 has no completed run in the current pipeline run (stage status: ${stage.status || 'unknown'}), so test data ${manifest.manifestId} is from an earlier run.`,
    };
  }
  if (!reviewedTestCases) return { current: true, reason: '' };

  const { reviewId } = reviewedTestCases;
  if (manifest.sourceReviewId && reviewId && manifest.sourceReviewId !== reviewId) {
    return { current: false, reason: `Test data ${manifest.manifestId} was generated from review ${manifest.sourceReviewId}, but the current review is ${reviewId}.` };
  }

  const manifestKeys = Object.keys(manifest.perTCData || {});
  const approvedKeys = approvedTestCaseKeys(reviewedTestCases);
  if (!sameKeys(manifestKeys, approvedKeys)) {
    return { current: false, reason: `Test data ${manifest.manifestId} covers ${manifestKeys.length} test case(s), but the current review approves ${approvedKeys.length}.` };
  }
  return { current: true, reason: '' };
}

/**
 * Loads the Agent 04 artifact, its inputs and a freshness verdict from the state manager.
 * @param {any} stateManager - Initialized StateManager
 * @returns {Promise<LoadedTestData>}
 */
export async function loadCurrentTestData(stateManager: any): Promise<LoadedTestData> {
  const stage = await stateManager.get(`stages.${TEST_DATA_STAGE_ID}`);
  const reviewedTestCases = await stateManager.getPipelineArtifact('reviewedTestCases');
  const stored = await stateManager.getPipelineArtifact('testData');
  const freshness = assessTestDataFreshness(stored, reviewedTestCases, stage);
  return { stage, reviewedTestCases, stored, testData: freshness.current ? stored : null, freshness };
}
