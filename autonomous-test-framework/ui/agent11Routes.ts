'use strict';

/**
 * @fileoverview Agent 11 (Re-Test Failed Cases) UI routes, shared by the dedicated Agent 11 UI
 * server and the combined hub server (ui/agent01-ui-server.ts).
 *
 * Agent 11 does not spawn Playwright itself — it constructs a TestRunnerAgent and calls it in
 * process with `mode: FAILED` and the healed TC keys. That reuse has consequences this console has
 * to contain, because the nested runner behaves exactly as if stage 07 had been re-run:
 *
 *   - it overwrites the `executionResults` artifact with retest-only results, which would otherwise
 *     leave the Agent 07 page showing a two-test run;
 *   - it truncates reports/json/agent07-progress.ndjson, which is also what gives this page a live
 *     grid for free;
 *   - it opens its own stage-07 approval gate, so a retest blocks twice.
 *
 * So `/run` snapshots the original results first and `/restore-results` puts them back, and the page
 * states the double gate up front rather than letting it look like a hang.
 *
 * @module agent11Routes
 */

import { Express, Request, Response } from 'express';
import path from 'path';

import { stateManager } from '../core/state-manager/StateManager';
import { llmClient } from '../core/llm/LLMClient';
import { Logger } from '../core/logger/Logger';
import {
  FRAMEWORK_DIR, LogStream, createAgentRunner, createLogStream, ensureStateReady,
  registerApprovalRoutes, resolveProjectId,
} from './agentServerKit';
import { createProgressTailer, readProgressSnapshot } from './agent07Routes';

const STAGE_ID = '11-retest-agent';
const PREFIX = 'agent11';
const AGENT_PATH = path.join(FRAMEWORK_DIR, 'agents', '11-retest-agent', 'agent.ts');

/**
 * Compact artifact summary for the chat prompt.
 * @param {any} retest
 * @returns {string}
 */
function summarizeRetest(retest: any): string {
  if (!retest) return '(No retest has run yet)';
  return JSON.stringify({
    retestId: retest.retestId,
    targetKeys: retest.targetKeys,
    healedKeys: retest.healedKeys,
    originalSummary: retest.originalSummary,
    retestSummary: retest.retestSummary,
    delta: retest.delta,
    finalPassRate: retest.finalPassRate,
    message: retest.message,
  }, null, 2);
}

/**
 * Mounts every Agent 11 UI route onto an Express app.
 * @param {Express} app
 * @param {Logger} logger
 * @returns {LogStream}
 */
export function registerAgent11Routes(app: Express, logger: Logger): LogStream {
  const logStream = createLogStream();
  const tailer = createProgressTailer(logStream, logger);
  /** The stage-07 results as they stood before the nested runner overwrote them. */
  let originalResults: any = null;

  const runner = createAgentRunner({
    agentPath: AGENT_PATH,
    logStream,
    logger,
    onLine: (line) => {
      if (line.includes('[STAGE:COMPLETE]')) tailer.stop();
      return null;
    },
  });

  // ── GET /api/agent11/state ──────────────────────────────────────────────────
  app.get(`/api/${PREFIX}/state`, async (_req: Request, res: Response) => {
    try {
      await ensureStateReady();
      const stage = await stateManager.get(`stages.${STAGE_ID}`);
      const [healingPatches, executionResults, retestResults] = await Promise.all([
        stateManager.getPipelineArtifact('healingPatches'),
        stateManager.getPipelineArtifact('executionResults'),
        stateManager.getPipelineArtifact('retestResults'),
      ]);

      // Mirrors the agent's own target selection, so the page can show what a run would re-test.
      const failedKeys = (executionResults?.failedTests || [])
        .map((t: any) => t.tcKey).filter(Boolean);
      const healedKeys = (healingPatches?.healingPatches || [])
        .filter((p: any) => p.healed).map((p: any) => p.tcKey).filter(Boolean);

      res.json({
        stage,
        healingPatches,
        executionResults,
        retestResults,
        targetKeys: healedKeys.length > 0 ? healedKeys : failedKeys,
        targetSource: healedKeys.length > 0 ? 'healed' : 'failed',
        progress: readProgressSnapshot(),
        running: runner.isRunning(),
        awaitingApproval: stage?.status === 'COMPLETED' && stage?.approval === 'PENDING',
        canRestoreResults: originalResults !== null,
      });
    } catch (err: any) {
      logger.error('Error fetching Agent 11 state', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/agent11/run ───────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/run`, async (req: Request, res: Response) => {
    const projectId = resolveProjectId(req.body?.projectName as string);

    try {
      await ensureStateReady(projectId);
      // Snapshot before spawning: the nested stage-07 runner replaces this artifact wholesale.
      originalResults = await stateManager.getPipelineArtifact('executionResults');
      await stateManager.markStageRunning(STAGE_ID);
    } catch (err: any) {
      logger.warn('Could not prepare stage 11 run', { error: err.message });
    }

    logger.info('Spawning Agent 11', { project: projectId });
    tailer.start();
    runner.start([`--project=${projectId}`]);
    return res.json({
      ok: true,
      message: 'Agent 11 started',
      project: projectId,
      // Surfaced so the page can say why it is waiting rather than appearing stuck.
      gates: ['07-test-runner', STAGE_ID],
      originalResultsSaved: originalResults !== null,
    });
  });

  // ── GET /api/agent11/logs (SSE: log + progress) ─────────────────────────────
  app.get(`/api/${PREFIX}/logs`, (req: Request, res: Response) => logStream.attach(req, res));

  // ── POST /api/agent11/restore-results ───────────────────────────────────────
  app.post(`/api/${PREFIX}/restore-results`, async (_req: Request, res: Response) => {
    if (!originalResults) {
      return res.status(404).json({ error: 'No pre-retest results were captured in this session.' });
    }
    if (runner.isRunning()) {
      return res.status(409).json({ error: 'The retest is still running. Wait for it to finish first.' });
    }

    try {
      await ensureStateReady();
      await stateManager.setPipelineArtifact('executionResults', originalResults);
      const restored = originalResults.runId;
      originalResults = null;
      logger.info('Restored pre-retest executionResults', { runId: restored });
      return res.json({ ok: true, runId: restored });
    } catch (err: any) {
      logger.error('Could not restore executionResults', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/agent11/chat ──────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/chat`, async (req: Request, res: Response) => {
    const { message, history = [] } = req.body as {
      message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    try {
      const retest = await stateManager.getPipelineArtifact('retestResults');
      const systemPrompt = [
        'You are ARIA, a Senior Test Automation Engineer reviewing an auto-heal verification run.',
        'Answer strictly from the retest output below. If a detail is not present, say so — do NOT invent results.',
        'Note: delta.details[].before is always the literal "FAILED"; it records that the test was failing, it is not a read value.',
        '',
        '=== RETEST OUTPUT ===',
        summarizeRetest(retest),
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
      logger.error('Agent 11 chat failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  registerApprovalRoutes(app, { prefix: PREFIX, stageId: STAGE_ID, logger });
  return logStream;
}
