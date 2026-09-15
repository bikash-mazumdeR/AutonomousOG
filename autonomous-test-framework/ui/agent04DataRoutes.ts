'use strict';

/**
 * @fileoverview Agent 04 test data edit route shared by the Agent 04 and main UI servers (PUT/POST /api/agent04/data).
 * Edits go through testDataEdits so they reach the enriched test cases Agent 05 binds from, re-sync the flat fixture
 * and answer the matching Agent 04 clarifications.
 */

import { Express, Request, Response } from 'express';
import { stateManager } from '../core/state-manager/StateManager';
import { ClarificationStore } from '../core/clarifications/ClarificationStore';
import { syncFixturesFileFromTestData } from '../core/state-manager/FixtureSync';
import { loadCurrentTestData } from '../core/state-manager/TestDataFreshness';
import { Logger } from '../core/logger/Logger';
import { CREDENTIAL_STORAGE, loadAutProfile } from '../core/aut/AutProfile';
import {
  EDIT_TYPE, EditOptions, EditOutcome, applyFlatOverride, applyGlobalOverride, applyInputOverride,
} from '../agents/04-test-data-generator/testDataEdits';
import { answerDataClarifications } from '../agents/04-test-data-generator/dataClarifications';

const TEST_DATA_ARTIFACT = 'testData';
const DEFAULT_EDITOR = 'test-data-ui';
const INVALID_PAYLOAD = 'Invalid update payload. Provide type full_flat with flatTestData, type global with globalFixtures (placeholder → value), or tcKey with inputs.';

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function editOptions(): EditOptions {
  try {
    return { credentialsInFixture: loadAutProfile(stateManager.getProjectId()).auth.credentialStorage === CREDENTIAL_STORAGE.FIXTURE };
  } catch (_) {
    return {};
  }
}

function applyEdit(testData: any, body: any, rawTestCases: any[], options: EditOptions): EditOutcome | null {
  if (body.type === EDIT_TYPE.FULL_FLAT && isObject(body.flatTestData)) return applyFlatOverride(testData, body.flatTestData, rawTestCases, options);
  if (body.type === EDIT_TYPE.GLOBAL && isObject(body.globalFixtures)) return applyGlobalOverride(testData, body.globalFixtures, rawTestCases, options);
  if (body.tcKey && isObject(body.inputs)) return applyInputOverride(testData, String(body.tcKey), body.inputs, rawTestCases, options);
  return null;
}

async function answerQuestions(outcome: EditOutcome, answeredBy: string, logger: Logger): Promise<string[]> {
  try {
    const { runId } = await stateManager.getFullState();
    return answerDataClarifications(new ClarificationStore(stateManager.getProjectId(), runId), outcome.changes, answeredBy);
  } catch (err: any) {
    logger.warn('Test data saved, but the matching clarifications could not be answered', { error: err.message });
    return [];
  }
}

function updateTestDataHandler(logger: Logger, fixturesPath: string) {
  return async (req: Request, res: Response) => {
    const body = req.body || {};
    try {
      if (!(stateManager as any)._initialized) {
        try { await stateManager.initialize(); } catch (_) { /* state may already be open in another process */ }
      }
      const { testData, stored, freshness, reviewedTestCases } = await loadCurrentTestData(stateManager);
      if (!testData?.manifest) {
        const error = stored?.manifest ? `Test data is stale: ${freshness.reason} Run Agent 04 first.` : 'No testData artifact found in state.';
        return res.status(stored?.manifest ? 409 : 404).json({ error });
      }
      const outcome = applyEdit(testData, body, reviewedTestCases?.reviewedZephyrExport?.testCases || [], editOptions());
      if (!outcome) return res.status(400).json({ error: INVALID_PAYLOAD });
      if (outcome.errors.length > 0) return res.status(400).json({ error: outcome.errors.join(' '), errors: outcome.errors });

      await stateManager.setPipelineArtifact(TEST_DATA_ARTIFACT, testData);
      const flatTestData = syncFixturesFileFromTestData(testData, undefined, fixturesPath);
      const answeredClarifications = await answerQuestions(outcome, String(body.answeredBy || DEFAULT_EDITOR), logger);
      logger.info('Test data updated via Agent 04 UI', {
        type: body.type || EDIT_TYPE.SINGLE_TC, tcKey: body.tcKey, changes: outcome.changes.length, ignored: outcome.ignored.length, answeredClarifications: answeredClarifications.length,
      });
      return res.json({
        ok: true, manifest: testData.manifest, flatTestData, changes: outcome.changes, ignored: outcome.ignored, answeredClarifications,
      });
    } catch (err: any) {
      logger.error('Error updating test data', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  };
}

/**
 * Mounts the Agent 04 test data edit routes.
 * @param {Express} app
 * @param {Logger} logger
 * @param {string} fixturesPath - Flat fixture file to re-sync after an edit
 */
export function registerAgent04DataRoutes(app: Express, logger: Logger, fixturesPath: string): void {
  const handler = updateTestDataHandler(logger, fixturesPath);
  app.put('/api/agent04/data', handler);
  app.post('/api/agent04/data', handler);
}
