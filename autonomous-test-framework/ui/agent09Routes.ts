'use strict';

/**
 * @fileoverview Agent 09 (Report Generator & Publisher) UI routes, shared by the dedicated Agent 09
 * UI server and the combined hub server (ui/agent01-ui-server.ts).
 *
 * Stage 09 is the one stage whose approval gate is genuinely load-bearing: the agent builds the
 * report, blocks on the gate, and only emails after an APPROVED verdict. So this page needs no
 * bespoke safety layer like Agents 08 and 10 — it only has to put the generated report in front of a
 * human before they answer the gate.
 *
 * Two details shape the report preview:
 *   1. The HTML is built by interpolating error messages and test titles with no escaping, so it is
 *      only ever rendered inside a sandboxed iframe with scripts disabled.
 *   2. reports/html/ also holds Playwright's own report, which agent07Routes already serves. This
 *      module exposes a filename allowlist rather than mounting the directory, so stage 09 cannot
 *      become a second, unintended way to read stage 07's artifacts.
 *
 * @module agent09Routes
 */

import { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { stateManager } from '../core/state-manager/StateManager';
import { llmClient } from '../core/llm/LLMClient';
import { Logger } from '../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../config/framework.config';
import {
  FRAMEWORK_DIR, LogStream, createAgentRunner, createLogStream, ensureStateReady,
  registerApprovalRoutes, resolveProjectId,
} from './agentServerKit';
import { gmailRecipients, integrationStatus } from './integrationStatus';

const STAGE_ID = '09-report-generator';
const PREFIX = 'agent09';
const AGENT_PATH = path.join(FRAMEWORK_DIR, 'agents', '09-report-generator', 'agent.ts');

const HTML_REPORT_DIR = path.join(FRAMEWORK_DIR, 'reports', 'html');

/** Only Agent 09's own output is servable — never Playwright's index.html sitting beside it. */
const REPORT_FILE_PATTERN = /^(latest|report-\d+)\.html$/;

/**
 * Agent 09 report files, newest first, with latest.html pinned to the top.
 * @returns {string[]} Bare filenames
 */
function listReportFiles(): string[] {
  try {
    return fs.readdirSync(HTML_REPORT_DIR)
      .filter((name) => REPORT_FILE_PATTERN.test(name))
      .sort((a, b) => {
        if (a === 'latest.html') return -1;
        if (b === 'latest.html') return 1;
        return b.localeCompare(a);
      });
  } catch {
    return [];
  }
}

/**
 * Compact artifact summary for the chat prompt.
 * @param {any} published
 * @returns {string}
 */
function summarizeReport(published: any): string {
  if (!published) return '(No report has been generated yet)';
  const json = published.jsonReport || {};
  return JSON.stringify({
    reportId: published.reportId,
    generatedAt: published.generatedAt,
    emailSent: published.emailSent,
    summary: json.summary,
    bugsSummary: json.bugsSummary,
    trend: json.trend,
    frameworkMetrics: json.frameworkMetrics,
    failures: (json.failedTests || []).map((t: any) => ({
      tcKey: t.tcKey, title: t.title, error: t.error?.message?.slice(0, 300),
    })),
  }, null, 2);
}

/**
 * Mounts every Agent 09 UI route onto an Express app.
 * @param {Express} app
 * @param {Logger} logger
 * @returns {LogStream}
 */
export function registerAgent09Routes(app: Express, logger: Logger): LogStream {
  const logStream = createLogStream();
  const runner = createAgentRunner({ agentPath: AGENT_PATH, logStream, logger });

  // ── GET /api/agent09/state ──────────────────────────────────────────────────
  app.get(`/api/${PREFIX}/state`, async (_req: Request, res: Response) => {
    try {
      await ensureStateReady();
      const stage = await stateManager.get(`stages.${STAGE_ID}`);
      const [executionResults, bugReports, publishedReports] = await Promise.all([
        stateManager.getPipelineArtifact('executionResults'),
        stateManager.getPipelineArtifact('bugReports'),
        stateManager.getPipelineArtifact('publishedReports'),
      ]);

      res.json({
        stage,
        executionResults,
        bugReports,
        publishedReports,
        reports: listReportFiles(),
        recipients: gmailRecipients(),
        running: runner.isRunning(),
        awaitingApproval: stage?.status === 'COMPLETED' && stage?.approval === 'PENDING',
        environment: FRAMEWORK_CONFIG.environment,
      });
    } catch (err: any) {
      logger.error('Error fetching Agent 09 state', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/agent09/run ───────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/run`, async (req: Request, res: Response) => {
    const projectId = resolveProjectId(req.body?.projectName as string);

    try {
      await ensureStateReady(projectId);
      await stateManager.markStageRunning(STAGE_ID);
    } catch (err: any) {
      logger.warn('Could not mark stage 09 running', { error: err.message });
    }

    logger.info('Spawning Agent 09', { project: projectId });
    runner.start([`--project=${projectId}`]);
    res.json({ ok: true, message: 'Agent 09 started', project: projectId });
  });

  // ── GET /api/agent09/logs (SSE) ─────────────────────────────────────────────
  app.get(`/api/${PREFIX}/logs`, (req: Request, res: Response) => logStream.attach(req, res));

  // ── GET /api/agent09/report ─────────────────────────────────────────────────
  app.get(`/api/${PREFIX}/report`, (req: Request, res: Response) => {
    const name = String(req.query.file || 'latest.html').trim();
    if (!REPORT_FILE_PATTERN.test(name)) {
      return res.status(403).json({ error: 'Only Agent 09 report files can be served from this route.' });
    }

    const target = path.join(HTML_REPORT_DIR, name);
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: 'Report not found. Run Agent 09 first.' });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The report interpolates error text without escaping, so block every active resource. The
    // iframe sandbox already does this; sending the header too keeps a direct hit on the URL safe.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:;");
    if (req.query.download) {
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    }
    return fs.createReadStream(target).pipe(res);
  });

  // ── GET /api/agent09/status ─────────────────────────────────────────────────
  // `?live=1` adds the SMTP handshake (authenticates, sends nothing) and the Jira identity probe.
  app.get(`/api/${PREFIX}/status`, async (req: Request, res: Response) => {
    try {
      res.json(await integrationStatus(Boolean(req.query.live)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/agent09/chat ──────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/chat`, async (req: Request, res: Response) => {
    const { message, history = [] } = req.body as {
      message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    try {
      const published = await stateManager.getPipelineArtifact('publishedReports');
      const systemPrompt = [
        'You are ARIA, a Senior QA Lead explaining a published test execution report to stakeholders.',
        'Answer strictly from the report below. If a detail is not present, say so — do NOT invent numbers.',
        'Note: flaky tests are counted as passed in passRate, and a null trend delta means there is no previous run to compare against.',
        '',
        '=== PUBLISHED REPORT ===',
        summarizeReport(published),
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
      logger.error('Agent 09 chat failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  registerApprovalRoutes(app, { prefix: PREFIX, stageId: STAGE_ID, logger });
  return logStream;
}
