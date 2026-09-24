'use strict';

/**
 * @fileoverview Agent 03 review routes shared by the Agent 03 and main UI servers: human test case overrides
 * (PUT/POST /api/agent03/testcase) and clarification decisions (POST /api/agent03/clarify).
 */

import { Express, Request, Response } from 'express';
import { stateManager } from '../core/state-manager/StateManager';
import { ClarificationStore } from '../core/clarifications/ClarificationStore';
import { loadAutProfile } from '../core/aut/AutProfile';
import { profileSecrets } from '../core/aut/knownSecrets';
import { redactReviewSecrets } from '../agents/03-test-case-reviewer/readiness/secrets';
import { Logger } from '../core/logger/Logger';
import { syncFeatureFiles } from '../agents/02-test-case-generator/utils';
import { ReviewReadinessContext } from '../agents/03-test-case-reviewer/readiness/holdReview';
import { refreshReviewReadiness } from '../agents/03-test-case-reviewer/readiness/reviewReadiness';
import {
  DECISION_OUTCOME, DecisionOutcome, applyClarificationDecision, applyReviewOverride,
} from '../agents/03-test-case-reviewer/readiness/reviewOverrides';

const REVIEW_ARTIFACT = 'reviewedTestCases';
const REQUIREMENTS_ARTIFACT = 'analyzedRequirements';

const HTTP_STATUS_FOR: Readonly<Record<DecisionOutcome, number>> = Object.freeze({
  [DECISION_OUTCOME.UPDATED]: 200,
  [DECISION_OUTCOME.HELD]: 409,
  [DECISION_OUTCOME.NOT_FOUND]: 404,
  [DECISION_OUTCOME.INVALID]: 400,
});

interface ReviewSession {
  store: ClarificationStore;
  ctx: ReviewReadinessContext;
  reviewedOutput: any;
}

async function openReviewSession(): Promise<ReviewSession> {
  if (!(stateManager as any)._initialized) {
    try { await stateManager.initialize(); } catch (_) { /* state may already be open in another process */ }
  }
  const { runId } = await stateManager.getFullState();
  const projectId = stateManager.getProjectId();
  let thresholdEnv: string | undefined;
  try {
    thresholdEnv = loadAutProfile(projectId).performance?.thresholdEnv;
  } catch (_) {
    thresholdEnv = undefined;
  }
  return {
    store: new ClarificationStore(projectId, runId),
    ctx: { thresholdEnv },
    reviewedOutput: await stateManager.getPipelineArtifact(REVIEW_ARTIFACT),
  };
}

/** Secret values the project's AUT profile names; none when the project has no profile. */
function knownSecrets() {
  try {
    return profileSecrets(loadAutProfile(stateManager.getProjectId()), process.env);
  } catch (_) {
    return [];
  }
}

async function saveReview(reviewedOutput: any, logger: Logger): Promise<void> {
  // A reviewer's edit or an answer written into a step may carry a secret; the feature files below are committed.
  const redacted = redactReviewSecrets(reviewedOutput.reviewedZephyrExport.testCases, knownSecrets());
  if (redacted.length > 0) {
    logger.warn('Replaced secret values with placeholders before saving the review', {
      testCases: redacted.map((entry) => `${entry.tcKey}: ${entry.placeholders.join(', ')}`),
    });
  }
  await stateManager.setPipelineArtifact(REVIEW_ARTIFACT, reviewedOutput);
  try {
    const requirements = await stateManager.getPipelineArtifact(REQUIREMENTS_ARTIFACT);
    syncFeatureFiles(stateManager.getProjectId(), requirements, reviewedOutput.reviewedZephyrExport.testCases, logger);
  } catch (err: any) {
    logger.warn('Feature file sync failed after review update', { error: err.message });
  }
}

function reviewCounts(reviewedOutput: any): Record<string, unknown> {
  const { approvedCount, rejectedCount, heldCount, manualCount, openClarifications } = reviewedOutput;
  return { approvedCount, rejectedCount, heldCount, manualCount, openClarifications };
}

function hasReview(reviewedOutput: any): boolean {
  return Array.isArray(reviewedOutput?.reviewedZephyrExport?.testCases);
}

function updateTestCaseHandler(logger: Logger) {
  return async (req: Request, res: Response) => {
    const body = req.body || {};
    if (!body.key) return res.status(400).json({ error: 'Test case key is required.' });
    try {
      const { store, ctx, reviewedOutput } = await openReviewSession();
      if (!hasReview(reviewedOutput)) return res.status(404).json({ error: 'No reviewed test cases artifact found in state.' });
      const result = applyReviewOverride(reviewedOutput, body, store, ctx);
      if (result.outcome !== DECISION_OUTCOME.UPDATED) {
        return res.status(HTTP_STATUS_FOR[result.outcome]).json({
          error: result.message, testCase: result.testCase, openClarifications: result.openClarifications,
        });
      }
      await saveReview(result.reviewedOutput, logger);
      logger.info(`Reviewed test case ${body.key} updated via Agent 03 UI override`, { reviewStatus: result.testCase.reviewStatus });
      return res.json({ ok: true, testCase: result.testCase, ...reviewCounts(result.reviewedOutput) });
    } catch (err: any) {
      logger.error('Error overriding reviewed test case', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  };
}

function clarifyHandler(logger: Logger) {
  return async (req: Request, res: Response) => {
    const body = req.body || {};
    try {
      const { store, ctx, reviewedOutput } = await openReviewSession();
      const result = applyClarificationDecision(store, body);
      if (result.outcome !== DECISION_OUTCOME.UPDATED) return res.status(HTTP_STATUS_FOR[result.outcome]).json({ error: result.message });
      if (!hasReview(reviewedOutput)) return res.json({ ok: true, clarification: result.clarification });
      refreshReviewReadiness(reviewedOutput, store, ctx);
      await saveReview(reviewedOutput, logger);
      const testCase = reviewedOutput.reviewedZephyrExport.testCases.find((tc: any) => tc.key === result.clarification?.tcKey);
      logger.info(`Clarification ${body.id} decided via Agent 03 UI`, { action: body.action, tcKey: testCase?.key, reviewStatus: testCase?.reviewStatus });
      return res.json({ ok: true, clarification: result.clarification, testCase, ...reviewCounts(reviewedOutput) });
    } catch (err: any) {
      logger.error('Error recording clarification decision', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  };
}

/**
 * Mounts the Agent 03 review routes.
 * @param {Express} app
 * @param {Logger} logger
 */
export function registerAgent03ReviewRoutes(app: Express, logger: Logger): void {
  const update = updateTestCaseHandler(logger);
  app.put('/api/agent03/testcase', update);
  app.post('/api/agent03/testcase', update);
  app.post('/api/agent03/clarify', clarifyHandler(logger));
}
