'use strict';

/**
 * @fileoverview Pipeline overview route shared by every agent UI server. The shared pipeline bar
 * (ui/static/pipeline-nav.js) reads it to show stage progress and to let users revisit completed stages.
 */

import { Express, Request, Response } from 'express';
import { stateManager } from '../core/state-manager/StateManager';

/**
 * Mounts GET /api/pipeline/stages: status and approval of every stage in the current pipeline run.
 * @param {Express} app
 */
export function registerPipelineRoutes(app: Express): void {
  app.get('/api/pipeline/stages', async (_req: Request, res: Response) => {
    try {
      if (!(stateManager as any)._initialized) {
        try { await stateManager.initialize(); } catch (_) { /* state may already be open in another process */ }
      }
      const state = await stateManager.getFullState();
      const stages = Object.fromEntries(
        Object.entries(state.stages || {}).map(([id, stage]: [string, any]) => [id, { status: stage?.status, approval: stage?.approval }]),
      );
      res.json({ runId: state.runId, stages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
