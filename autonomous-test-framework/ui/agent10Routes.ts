'use strict';

/**
 * @fileoverview Agent 10 (Auto Healer) UI routes, shared by the dedicated Agent 10 UI server and the
 * combined hub server (ui/agent01-ui-server.ts).
 *
 * Agent 10 is the only agent that rewrites source files, and it does so with no approval gate and no
 * backup — `skills/auto-healing.md` says outright that "git history preserves rollback". It also
 * reports its changes badly: `diff` is a bare boolean for the WAIT_ADJUSTMENT, ASSERTION_RELAX and
 * DATA_FIX strategies and absent entirely for SELECTOR_HEAL, so only the LLM path carries real
 * before/after text.
 *
 * Rather than edit the agent, this module supplies both missing halves from the outside:
 *   1. Before spawning, it snapshots the project's specs, pages and k6 trees.
 *   2. Afterwards it diffs the snapshot against the tree, which yields true before/after content for
 *      every changed file regardless of what the agent reported, and makes `/revert` a byte-exact
 *      restore — the only rollback in the framework.
 *
 * Nothing is permanent until the human chooses `/keep`.
 *
 * @module agent10Routes
 */

import { Express, Request, Response } from 'express';
import path from 'path';

import { stateManager } from '../core/state-manager/StateManager';
import { llmClient } from '../core/llm/LLMClient';
import { Logger } from '../core/logger/Logger';
import { projectPaths } from '../core/aut/projectPaths';
import {
  FRAMEWORK_DIR, LogStream, createAgentRunner, createLogStream, ensureStateReady,
  registerApprovalRoutes, resolveProjectId,
} from './agentServerKit';
import {
  Snapshot, diffSnapshot, discardSnapshot, readBothSides, restoreSnapshot, takeSnapshot,
} from './healSnapshot';

const STAGE_ID = '10-auto-healer';
const PREFIX = 'agent10';
const AGENT_PATH = path.join(FRAMEWORK_DIR, 'agents', '10-auto-healer', 'agent.ts');

/**
 * Compact artifact summary for the chat prompt.
 * @param {any} patches
 * @returns {string}
 */
function summarizeHealing(patches: any): string {
  if (!patches) return '(Agent 10 has not run yet)';
  return JSON.stringify({
    healingId: patches.healingId,
    totalFailed: patches.totalFailed,
    healed: patches.healed,
    unhealed: patches.unhealed,
    healingRate: patches.healingRate,
    strategies: patches.strategies,
    patches: (patches.healingPatches || []).map((p: any) => ({
      tcKey: p.tcKey, strategyUsed: p.strategyUsed, errorPattern: p.errorPattern, actionTaken: p.actionTaken,
    })),
    unhealedTests: patches.unhealedTests,
  }, null, 2);
}

/**
 * Mounts every Agent 10 UI route onto an Express app.
 * @param {Express} app
 * @param {Logger} logger
 * @returns {LogStream}
 */
export function registerAgent10Routes(app: Express, logger: Logger): LogStream {
  const logStream = createLogStream();
  let snapshot: Snapshot | null = null;

  const runner = createAgentRunner({ agentPath: AGENT_PATH, logStream, logger });

  // ── GET /api/agent10/state ──────────────────────────────────────────────────
  app.get(`/api/${PREFIX}/state`, async (_req: Request, res: Response) => {
    try {
      await ensureStateReady();
      const stage = await stateManager.get(`stages.${STAGE_ID}`);
      const [executionResults, healingPatches] = await Promise.all([
        stateManager.getPipelineArtifact('executionResults'),
        stateManager.getPipelineArtifact('healingPatches'),
      ]);

      const running = runner.isRunning();
      // Diffing mid-run would show a half-written tree, so only report changes once the agent is done.
      const changes = snapshot && !running ? diffSnapshot(snapshot) : [];

      res.json({
        stage,
        executionResults,
        healingPatches,
        running,
        awaitingApproval: stage?.status === 'COMPLETED' && stage?.approval === 'PENDING',
        snapshot: snapshot
          ? {
            id: snapshot.id, takenAt: snapshot.takenAt, fileCount: snapshot.fileCount,
          }
          : null,
        changes,
      });
    } catch (err: any) {
      logger.error('Error fetching Agent 10 state', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/agent10/run ───────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/run`, async (req: Request, res: Response) => {
    const projectId = resolveProjectId(req.body?.projectName as string);

    if (snapshot) {
      return res.status(409).json({
        error: 'An un-reviewed heal is already pending. Keep or revert it before running again.',
      });
    }

    try {
      await ensureStateReady(projectId);
      await stateManager.markStageRunning(STAGE_ID);
    } catch (err: any) {
      logger.warn('Could not mark stage 10 running', { error: err.message });
    }

    try {
      const paths = projectPaths(projectId);
      snapshot = takeSnapshot([paths.specsDir, paths.pagesDir, paths.k6Dir]);
      logger.info('Snapshotted source before healing', { id: snapshot.id, files: snapshot.fileCount });
    } catch (err: any) {
      // Without a snapshot there is no rollback, and the healer overwrites files in place — so this
      // is the one failure that must stop the run rather than degrade it.
      logger.error('Snapshot failed; refusing to run the healer', { error: err.message });
      return res.status(500).json({ error: `Could not snapshot sources, so the heal was not started: ${err.message}` });
    }

    logger.info('Spawning Agent 10', { project: projectId });
    runner.start([`--project=${projectId}`]);
    return res.json({
      ok: true, message: 'Agent 10 started', project: projectId, snapshotId: snapshot.id,
    });
  });

  // ── GET /api/agent10/logs (SSE) ─────────────────────────────────────────────
  app.get(`/api/${PREFIX}/logs`, (req: Request, res: Response) => logStream.attach(req, res));

  // ── GET /api/agent10/diff ───────────────────────────────────────────────────
  app.get(`/api/${PREFIX}/diff`, (req: Request, res: Response) => {
    const relPath = String(req.query.path || '').trim();
    if (!relPath) return res.status(400).json({ error: 'path query parameter is required' });
    if (!snapshot) return res.status(404).json({ error: 'No snapshot is pending.' });

    const change = diffSnapshot(snapshot).find((c) => c.relPath === relPath);
    if (!change) return res.status(404).json({ error: 'That file did not change in this run.' });

    // relPath is matched against the diff above rather than resolved from user input, so it can only
    // ever name a file the snapshot already knows about.
    return res.json({ relPath, status: change.status, ...readBothSides(snapshot, relPath) });
  });

  // ── POST /api/agent10/keep ──────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/keep`, (_req: Request, res: Response) => {
    if (!snapshot) return res.status(404).json({ error: 'No snapshot is pending.' });

    const kept = diffSnapshot(snapshot).length;
    discardSnapshot(snapshot);
    snapshot = null;
    logger.info('Healing patches kept', { files: kept });
    return res.json({ ok: true, kept });
  });

  // ── POST /api/agent10/revert ────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/revert`, (_req: Request, res: Response) => {
    if (!snapshot) return res.status(404).json({ error: 'No snapshot is pending.' });
    if (runner.isRunning()) {
      return res.status(409).json({ error: 'The healer is still running. Wait for it to finish before reverting.' });
    }

    try {
      const reverted = restoreSnapshot(snapshot);
      discardSnapshot(snapshot);
      snapshot = null;
      logger.info('Healing patches reverted', { files: reverted });
      return res.json({ ok: true, reverted });
    } catch (err: any) {
      logger.error('Revert failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/agent10/chat ──────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/chat`, async (req: Request, res: Response) => {
    const { message, history = [] } = req.body as {
      message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    try {
      const patches = await stateManager.getPipelineArtifact('healingPatches');
      const systemPrompt = [
        'You are ARIA, a Senior Test Automation Engineer reviewing auto-healing patches.',
        'Answer strictly from the healing output below. If a detail is not present, say so — do NOT invent patches.',
        'Note: a RETRY_NETWORK patch reports healed:true but changes no code — it only queues the test for Agent 11.',
        '',
        '=== HEALING OUTPUT ===',
        summarizeHealing(patches),
      ].join('\n');

      const response = await llmClient.chat(STAGE_ID, {
        messages: [
          { role: 'system' as const, content: systemPrompt },
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: message },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      });
      return res.json({ reply: response.text });
    } catch (err: any) {
      logger.error('Agent 10 chat failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  registerApprovalRoutes(app, { prefix: PREFIX, stageId: STAGE_ID, logger });
  return logStream;
}
