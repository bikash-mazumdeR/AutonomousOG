'use strict';

/**
 * @fileoverview Agent 07 (Test Runner) UI routes, shared by the dedicated Agent 07 UI server and the
 * combined hub server (ui/agent01-ui-server.ts).
 *
 * Two things make stage 07 different from the earlier stages:
 *   1. It runs for minutes. Playwright's JSON report only lands at the very end, so live progress
 *      comes from AriaProgressReporter, which appends NDJSON that these routes tail and republish as
 *      SSE `progress` events. Because they go through the shared log stream's replay buffer, a
 *      mid-run page refresh rebuilds the grid instead of resetting it.
 *   2. It produces artifacts nothing else serves. `/artifact` streams screenshots, video and traces
 *      from reports/ behind an allowlist, and `/report` mounts the Playwright HTML report.
 *
 * @module agent07Routes
 */

import express, { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { stateManager } from '../core/state-manager/StateManager';
import { llmClient } from '../core/llm/LLMClient';
import { Logger } from '../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../config/framework.config';
import {
  FRAMEWORK_DIR, LogStream, createAgentRunner, createLogStream, ensureStateReady, isInside,
  registerApprovalRoutes, resolveAllowedPath, resolveProjectId,
} from './agentServerKit';

const STAGE_ID = '07-test-runner';
const PREFIX = 'agent07';
const AGENT_PATH = path.join(FRAMEWORK_DIR, 'agents', '07-test-runner', 'agent.ts');

const REPORTS_DIR = path.join(FRAMEWORK_DIR, 'reports');
const HTML_REPORT_DIR = path.join(REPORTS_DIR, 'html');
/** Must match PROGRESS_FILE_PATH in agents/07-test-runner/agent.ts. */
const PROGRESS_FILE = path.join(REPORTS_DIR, 'json', 'agent07-progress.ndjson');

const RUN_MODES = ['FULL', 'SMOKE', 'REGRESSION', 'FAILED'];
const PROGRESS_POLL_MS = 400;

/** Artifact types safe to serve. Anything else is refused rather than guessed at. */
const ARTIFACT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.har': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** Served as a download rather than rendered, so an artifact can never execute on this origin. */
const FORCE_DOWNLOAD = new Set(['.zip']);

/**
 * Tails the reporter's NDJSON file and republishes each event on the log stream.
 *
 * Polling rather than fs.watch: the file is truncated at the start of every run and lives on a
 * Windows filesystem, where watch semantics around truncation are unreliable.
 */
function createProgressTailer(logStream: LogStream, logger: Logger) {
  let timer: NodeJS.Timeout | null = null;
  let offset = 0;
  let residual = '';

  const drain = (): void => {
    try {
      if (!fs.existsSync(PROGRESS_FILE)) return;
      const { size } = fs.statSync(PROGRESS_FILE);
      if (size < offset) { offset = 0; residual = ''; } // truncated by a new run
      if (size === offset) return;

      const fd = fs.openSync(PROGRESS_FILE, 'r');
      const buffer = Buffer.alloc(size - offset);
      fs.readSync(fd, buffer, 0, buffer.length, offset);
      fs.closeSync(fd);
      offset = size;

      const lines = (residual + buffer.toString('utf-8')).split('\n');
      residual = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          logStream.broadcast({ type: 'progress', event: JSON.parse(line) });
        } catch {
          logger.warn('Skipping malformed progress line', { line: line.slice(0, 120) });
        }
      }
    } catch (err: any) {
      logger.warn('Progress tail failed', { error: err.message });
    }
  };

  return {
    start(): void {
      offset = 0;
      residual = '';
      if (timer) clearInterval(timer);
      timer = setInterval(drain, PROGRESS_POLL_MS);
    },
    stop(): void {
      drain(); // final flush so the last events are never lost
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/**
 * Reads the progress file into an array so a fresh page load can rebuild the grid without SSE.
 * @returns {any[]}
 */
function readProgressSnapshot(): any[] {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) return [];
    return fs.readFileSync(PROGRESS_FILE, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Compact artifact summary for the chat prompt.
 * @param {any} results
 * @returns {string}
 */
function summarizeResults(results: any): string {
  if (!results) return '(No test run has completed yet)';
  return JSON.stringify({
    runId: results.runId,
    mode: results.mode,
    summary: results.summary,
    failures: (results.failedTests || []).map((t: any) => ({
      tcKey: t.tcKey, title: t.title, status: t.status, error: t.error?.message?.slice(0, 400),
    })),
    flaky: results.flakyTests || [],
    k6: (results.k6Results || []).map((k: any) => ({
      script: k.scriptName, passed: k.passed, skipped: k.skipped || false, summary: k.summary,
    })),
  }, null, 2);
}

/**
 * Mounts every Agent 07 UI route onto an Express app.
 * @param {Express} app
 * @param {Logger} logger
 * @returns {LogStream}
 */
export function registerAgent07Routes(app: Express, logger: Logger): LogStream {
  const logStream = createLogStream();
  const tailer = createProgressTailer(logStream, logger);
  const runner = createAgentRunner({
    agentPath: AGENT_PATH,
    logStream,
    logger,
    onLine: (line) => {
      // The run is over once the child exits, but the gate keeps the process alive; stop tailing
      // when Playwright itself reports completion so the poller does not spin for the whole gate.
      if (line.includes('[STAGE:COMPLETE]')) tailer.stop();
      return null;
    },
  });

  // ── GET /api/agent07/state ──────────────────────────────────────────────────
  app.get(`/api/${PREFIX}/state`, async (_req: Request, res: Response) => {
    try {
      await ensureStateReady();
      const stage = await stateManager.get(`stages.${STAGE_ID}`);
      const [reviewedScripts, executionResults] = await Promise.all([
        stateManager.getPipelineArtifact('reviewedScripts'),
        stateManager.getPipelineArtifact('executionResults'),
      ]);

      res.json({
        stage,
        reviewedScripts,
        executionResults,
        progress: readProgressSnapshot(),
        running: runner.isRunning(),
        awaitingApproval: stage?.status === 'COMPLETED' && stage?.approval === 'PENDING',
        reportAvailable: fs.existsSync(path.join(HTML_REPORT_DIR, 'index.html')),
        config: {
          workers: FRAMEWORK_CONFIG.playwright.workers,
          retries: FRAMEWORK_CONFIG.playwright.retries,
          timeout: FRAMEWORK_CONFIG.playwright.timeout,
          headless: FRAMEWORK_CONFIG.playwright.headless,
          environment: FRAMEWORK_CONFIG.environment,
        },
      });
    } catch (err: any) {
      logger.error('Error fetching Agent 07 state', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/agent07/run ───────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/run`, async (req: Request, res: Response) => {
    const projectId = resolveProjectId(req.body?.projectName as string);
    const requested = String(req.body?.mode || 'FULL').toUpperCase();
    const mode = RUN_MODES.includes(requested) ? requested : 'FULL';

    try {
      await ensureStateReady(projectId);
      await stateManager.markStageRunning(STAGE_ID);
    } catch (err: any) {
      logger.warn('Could not mark stage 07 running', { error: err.message });
    }

    logger.info('Spawning Agent 07', { project: projectId, mode });
    tailer.start();
    runner.start([`--project=${projectId}`, `--mode=${mode}`]);
    res.json({ ok: true, message: 'Agent 07 started', project: projectId, mode });
  });

  // ── GET /api/agent07/logs (SSE: log + progress, with replay) ────────────────
  app.get(`/api/${PREFIX}/logs`, (req: Request, res: Response) => logStream.attach(req, res));

  // ── GET /api/agent07/artifact ───────────────────────────────────────────────
  app.get(`/api/${PREFIX}/artifact`, (req: Request, res: Response) => {
    const raw = String(req.query.path || '').trim();
    if (!raw) return res.status(400).json({ error: 'path query parameter is required' });

    // Accept both absolute paths (as recorded in executionResults) and framework-relative ones.
    const candidate = path.isAbsolute(raw) ? path.resolve(raw) : resolveAllowedPath(raw, [REPORTS_DIR]);
    if (!candidate || !isInside(REPORTS_DIR, candidate)) {
      return res.status(403).json({ error: 'Access denied. Artifact must be inside reports/.' });
    }
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      // Playwright wipes reports/attachments at the start of every run, so this is expected mid-rerun.
      return res.status(404).json({ error: 'Artifact not found. It may have been cleared by a newer run.' });
    }

    const ext = path.extname(candidate).toLowerCase();
    const contentType = ARTIFACT_TYPES[ext];
    if (!contentType) return res.status(415).json({ error: `Unsupported artifact type: ${ext}` });

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (FORCE_DOWNLOAD.has(ext)) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(candidate)}"`);
    }
    return fs.createReadStream(candidate).pipe(res);
  });

  // ── /api/agent07/report — the Playwright HTML report ────────────────────────
  // express.static rather than a wildcard route: Express 5 / path-to-regexp 8 rejects '/report/*',
  // and the report references its attachments relatively, so it must be served as a directory.
  app.use(`/api/${PREFIX}/report`, express.static(HTML_REPORT_DIR));

  // ── POST /api/agent07/chat ──────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/chat`, async (req: Request, res: Response) => {
    const { message, history = [] } = req.body as {
      message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    try {
      const results = await stateManager.getPipelineArtifact('executionResults');
      const systemPrompt = [
        'You are ARIA, a Senior Test Automation Engineer analysing a Playwright + K6 execution report.',
        'Answer strictly from the execution results below. If a detail is not present, say so — do NOT invent failures.',
        'When asked why a test failed, quote the actual error and suggest a concrete next step.',
        'Note: flaky tests are counted as passed in passRate.',
        '',
        '=== EXECUTION RESULTS ===',
        summarizeResults(results),
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
      logger.error('Agent 07 chat failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  registerApprovalRoutes(app, { prefix: PREFIX, stageId: STAGE_ID, logger });
  return logStream;
}
