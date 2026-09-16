'use strict';

/**
 * @fileoverview Agent 06 (Automation Code Reviewer) UI routes, shared by the dedicated Agent 06 UI
 * server and the combined hub server (ui/agent01-ui-server.ts).
 *
 * The review is detect-only: Agent 06 never rewrites a file (every rule is `patchable: false`, so the
 * write-back in its agent is unreachable). The human is the patcher, which is why these routes expose
 * an allowlisted file read/save endpoint — a reviewer opens the flagged file at the reported line,
 * fixes it, and re-runs the review without leaving the page.
 *
 * @module agent06Routes
 */

import { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { stateManager } from '../core/state-manager/StateManager';
import { llmClient } from '../core/llm/LLMClient';
import { Logger } from '../core/logger/Logger';
import {
  FRAMEWORK_DIR, LogStream, createAgentRunner, createLogStream, ensureStateReady,
  registerApprovalRoutes, resolveAllowedPath, resolveProjectId,
} from './agentServerKit';

const STAGE_ID = '06-automation-reviewer';
const PREFIX = 'agent06';
const AGENT_PATH = path.join(FRAMEWORK_DIR, 'agents', '06-automation-reviewer', 'agent.ts');

/** Generated code the reviewer is allowed to open and edit — the same roots Agent 05 exposes. */
const EDITABLE_ROOTS = ['specs', 'pages', 'k6', 'helpers', 'projects']
  .map((dir) => path.join(FRAMEWORK_DIR, 'tests', dir));

/** Findings the LLM raised. They are capped at MAJOR and can never force a REJECT. */
const ADVISORY_RULE_ID = 'LOGIC-AI';

/**
 * Adds a framework-relative path to each file review so the UI can hand it straight to the file
 * endpoint (the agent records absolute paths).
 * @param {any} review - reviewedScripts artifact
 * @returns {any}
 */
function withRelativePaths(review: any): any {
  if (!review?.fileReviews) return review;
  return {
    ...review,
    fileReviews: review.fileReviews.map((file: any) => ({
      ...file,
      relativePath: file.filePath
        ? path.relative(FRAMEWORK_DIR, file.filePath).replace(/\\/g, '/')
        : null,
      // Surfaced so the UI can mark advisory findings apart from blocking ones.
      advisoryCount: (file.findings || []).filter((f: any) => f.ruleId === ADVISORY_RULE_ID).length,
    })),
  };
}

/**
 * Compact artifact summary for the chat prompt.
 * @param {any} review
 * @returns {string}
 */
function summarizeReview(review: any): string {
  if (!review) return '(No code review has been run yet)';
  return JSON.stringify({
    decision: review.reviewDecision,
    score: review.overallScore,
    files: (review.fileReviews || []).map((f: any) => ({
      file: f.fileName,
      type: f.fileType,
      status: f.status,
      score: f.qualityScore,
      findings: (f.findings || []).map((x: any) => ({
        ruleId: x.ruleId, dimension: x.dimension, severity: x.severity, line: x.line ?? null, message: x.message,
      })),
    })),
    blockers: review.blockers || [],
    recommendations: review.recommendations || [],
  }, null, 2);
}

/**
 * Mounts every Agent 06 UI route onto an Express app.
 * @param {Express} app
 * @param {Logger} logger
 * @returns {LogStream} The stream carrying this agent's output, for callers that want to observe it
 */
export function registerAgent06Routes(app: Express, logger: Logger): LogStream {
  const logStream = createLogStream();
  const runner = createAgentRunner({ agentPath: AGENT_PATH, logStream, logger });

  // ── GET /api/agent06/state ──────────────────────────────────────────────────
  app.get(`/api/${PREFIX}/state`, async (_req: Request, res: Response) => {
    try {
      await ensureStateReady();
      const stage = await stateManager.get(`stages.${STAGE_ID}`);
      const [playwrightScripts, reviewedScripts] = await Promise.all([
        stateManager.getPipelineArtifact('playwrightScripts'),
        stateManager.getPipelineArtifact('reviewedScripts'),
      ]);

      res.json({
        stage,
        playwrightScripts,
        reviewedScripts: withRelativePaths(reviewedScripts),
        running: runner.isRunning(),
        // The agent blocks at its approval gate after completing, so it never exits on its own.
        // Completion is COMPLETED-and-not-yet-approved, not process exit.
        awaitingApproval: stage?.status === 'COMPLETED' && stage?.approval === 'PENDING',
      });
    } catch (err: any) {
      logger.error('Error fetching Agent 06 state', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/agent06/run ───────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/run`, async (req: Request, res: Response) => {
    const projectId = resolveProjectId(req.body?.projectName as string);
    try {
      await ensureStateReady(projectId);
      await stateManager.markStageRunning(STAGE_ID);
    } catch (err: any) {
      logger.warn('Could not mark stage 06 running', { error: err.message });
    }

    logger.info('Spawning Agent 06', { project: projectId });
    runner.start([`--project=${projectId}`]);
    res.json({ ok: true, message: 'Agent 06 started', project: projectId });
  });

  // ── GET /api/agent06/logs (SSE, replays buffered output) ────────────────────
  app.get(`/api/${PREFIX}/logs`, (req: Request, res: Response) => logStream.attach(req, res));

  // ── GET /api/agent06/file ───────────────────────────────────────────────────
  app.get(`/api/${PREFIX}/file`, (req: Request, res: Response) => {
    const relPath = String(req.query.path || '').trim();
    const target = resolveAllowedPath(relPath, EDITABLE_ROOTS);
    if (!target) {
      return res.status(relPath ? 403 : 400).json({
        error: relPath ? 'Access denied. File must be within the tests/ folders.' : 'path query parameter is required',
      });
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return res.status(404).json({ error: `File not found: ${relPath}` });
    }
    try {
      const stat = fs.statSync(target);
      return res.json({
        ok: true,
        path: relPath,
        content: fs.readFileSync(target, 'utf-8'),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch (err: any) {
      logger.error('Error reading reviewed file', { path: relPath, error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  // ── PUT|POST /api/agent06/file ──────────────────────────────────────────────
  const saveFile = (req: Request, res: Response) => {
    const { path: relPath, content } = req.body || {};
    if (!relPath || typeof content !== 'string') {
      return res.status(400).json({ error: 'path and content string are required' });
    }
    const target = resolveAllowedPath(relPath, EDITABLE_ROOTS);
    if (!target) {
      return res.status(403).json({ error: 'Access denied. File must be within the tests/ folders.' });
    }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf-8');
      logger.info('Reviewed file saved via Agent 06 UI', { path: relPath, size: content.length });
      return res.json({ ok: true, path: relPath, size: content.length });
    } catch (err: any) {
      logger.error('Error saving reviewed file', { path: relPath, error: err.message });
      return res.status(500).json({ error: err.message });
    }
  };
  app.put(`/api/${PREFIX}/file`, saveFile);
  app.post(`/api/${PREFIX}/file`, saveFile);

  // ── POST /api/agent06/chat ──────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/chat`, async (req: Request, res: Response) => {
    const { message, history = [] } = req.body as {
      message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    try {
      const review = await stateManager.getPipelineArtifact('reviewedScripts');
      const systemPrompt = [
        'You are ARIA, a Senior Test Automation Code Reviewer.',
        'The user is reviewing static-analysis findings on generated Playwright specs, page objects and K6 scripts.',
        'Answer strictly from the review report below. If a detail is not present, say so — do NOT invent findings.',
        'Deterministic rules (ruleId not LOGIC-AI) can block the stage; LOGIC-AI findings are advisory and capped at MAJOR.',
        'Be concise and specific, and show corrected code when it helps.',
        '',
        '=== CODE REVIEW REPORT ===',
        summarizeReview(review),
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
      logger.error('Agent 06 chat failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  registerApprovalRoutes(app, { prefix: PREFIX, stageId: STAGE_ID, logger });
  return logStream;
}
