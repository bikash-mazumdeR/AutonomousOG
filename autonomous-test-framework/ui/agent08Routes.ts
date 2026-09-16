'use strict';

/**
 * @fileoverview Agent 08 (Bug Reporter) UI routes, shared by the dedicated Agent 08 UI server and
 * the combined hub server (ui/agent01-ui-server.ts).
 *
 * This page works differently from every other stage console, for a specific reason: Agent 08 cannot
 * currently run. `agents/08-bug-reporter/agent.ts:99` calls `this._createMailer()`, which is defined
 * nowhere, so the agent throws a TypeError the moment there is at least one failure — before it ever
 * reaches Jira. Spawning it would only ever produce a failed stage.
 *
 * So the routes below do the stage's work directly:
 *   - `/preview` builds the proposed bugs by calling the agent's own pure helpers, so the content a
 *     human reviews is exactly what the agent would have produced. It performs only reads.
 *   - `/commit` files the reviewed, edited selection through jiraClient.
 *
 * The split also fixes the ordering problem in the agent, which creates Jira issues *before* opening
 * its approval gate: here nothing is written until a human has seen the preview and chosen to
 * commit. It also lets real screenshots be attached, where the agent hardcodes
 * 'fake/path/to/screenshot.png' and silently fails every upload.
 *
 * @module agent08Routes
 */

import { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { stateManager } from '../core/state-manager/StateManager';
import { memoryEngine } from '../core/project-memory/MemoryEngine';
import { llmClient } from '../core/llm/LLMClient';
import { Logger } from '../core/logger/Logger';
import { FRAMEWORK_CONFIG, JIRA_CONFIG } from '../config/framework.config';
import { jiraClient } from '../mcp/jira/jira-mcp-client';
import { BugReporterAgent } from '../agents/08-bug-reporter/agent';
import {
  FRAMEWORK_DIR, LogStream, createLogStream, ensureStateReady, isInside,
  registerApprovalRoutes, resolveAllowedPath, resolveProjectId,
} from './agentServerKit';
import { integrationStatus } from './integrationStatus';

const STAGE_ID = '08-bug-reporter';
const PREFIX = 'agent08';

const REPORTS_DIR = path.join(FRAMEWORK_DIR, 'reports');

/** Severity to Jira priority, mirroring JIRA_PRIORITY in the agent. */
const JIRA_PRIORITY: Record<string, string> = {
  Critical: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low',
};

/** JQL the agent uses to pull open bugs for duplicate matching. */
const OPEN_BUGS_JQL = `project = ${JIRA_CONFIG.projectKey} AND issuetype = Bug AND status != Closed`;

/** Artifact types safe to serve as evidence thumbnails. */
const ARTIFACT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.har': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
};

/** What the preview says will happen to a given failure. */
type Verdict = 'NEW' | 'JIRA_DUP' | 'MEMORY_DUP';

/**
 * Wraps plain text in the Atlassian Document Format envelope Jira v3 requires.
 * @param {string} text
 * @returns {Record<string, any>}
 */
function adf(text: string): Record<string, any> {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: String(text || '') }] }],
  };
}

/**
 * Flattens a test's attachment buckets into one list of framework-relative paths.
 * @param {any} failure - An executionResults.failedTests entry
 * @returns {Array<{kind: string, path: string, name: string}>}
 */
function collectAttachments(failure: any): Array<{ kind: string; path: string; name: string }> {
  const buckets = failure?.attachments || {};
  return Object.keys(buckets).flatMap((kind) => (buckets[kind] || []).map((absolute: string) => ({
    kind,
    path: path.relative(FRAMEWORK_DIR, absolute).split(path.sep).join('/'),
    name: path.basename(absolute),
  })));
}

/**
 * Builds the proposed bug set without writing anything.
 *
 * Uses the agent's own `_buildBugReport` / `_hashBug` so the preview cannot drift from what the
 * pipeline would produce. Both are ordinary methods — only `_logger` and `_skill` are private — and
 * the constructor just builds a logger and reads a skill file, so instantiating is side-effect free.
 *
 * @param {any} results - The executionResults artifact
 * @returns {Promise<any[]>}
 */
async function buildPreview(results: any): Promise<any[]> {
  const agent = new BugReporterAgent() as any;
  const failures = results?.failedTests || [];
  const k6Failures = (results?.k6Results || []).filter((k: any) => k.passed === false);

  // Read-only. With no Jira project configured this returns [], which simply means no JIRA_DUP
  // verdicts — the client is told separately whether Jira is actually reachable.
  const existingIssues = await jiraClient.searchIssues(OPEN_BUGS_JQL);

  const proposals = await Promise.all(failures.map(async (failure: any) => {
    const bug = agent._buildBugReport(failure, results);
    const hash = agent._hashBug(bug);
    const known = await memoryEngine.findKnownBug(hash);
    const existingJira = existingIssues.find((issue: any) => {
      const summary = issue?.fields?.summary || ''; // the agent assumes this exists and throws if not
      return summary.includes(failure.tcKey) || summary.includes(failure.title);
    });

    let verdict: Verdict = 'NEW';
    if (known) verdict = 'MEMORY_DUP';
    else if (existingJira) verdict = 'JIRA_DUP';

    return {
      ...bug,
      hash,
      kind: 'test',
      verdict,
      duplicateOf: known?.jiraKey || existingJira?.key || null,
      occurrences: known?.occurrences || 0,
      // Agent 07 puts a retried-then-failed test in both failedTests and flakyTests, so these are
      // the likeliest false bugs and the reviewer should see that before filing.
      flaky: (failure.retries || 0) > 0,
      retries: failure.retries || 0,
      errorMessage: failure.error?.message || '',
      attachments: collectAttachments(failure),
      selected: verdict === 'NEW',
    };
  }));

  const k6Proposals = k6Failures.map((k6: any) => ({
    title: `[${String(FRAMEWORK_CONFIG.environment).toUpperCase()}][HIGH] Performance — ${k6.scriptName}`,
    severity: 'High',
    labels: ['Performance', 'ARIA-AutoGenerated'],
    description: `K6 Threshold breach in ${k6.scriptName}`,
    environment: FRAMEWORK_CONFIG.environment,
    hash: '',
    kind: 'k6',
    verdict: 'NEW' as Verdict,
    duplicateOf: null,
    occurrences: 0,
    flaky: false,
    retries: 0,
    errorMessage: k6.error || '',
    attachments: [],
    selected: true,
  }));

  return [...proposals, ...k6Proposals];
}

/**
 * Mounts every Agent 08 UI route onto an Express app.
 * @param {Express} app
 * @param {Logger} logger
 * @returns {LogStream}
 */
export function registerAgent08Routes(app: Express, logger: Logger): LogStream {
  const logStream = createLogStream();

  // ── GET /api/agent08/state ──────────────────────────────────────────────────
  app.get(`/api/${PREFIX}/state`, async (_req: Request, res: Response) => {
    try {
      await ensureStateReady();
      const stage = await stateManager.get(`stages.${STAGE_ID}`);
      const [executionResults, bugReports] = await Promise.all([
        stateManager.getPipelineArtifact('executionResults'),
        stateManager.getPipelineArtifact('bugReports'),
      ]);

      res.json({
        stage,
        executionResults,
        bugReports,
        running: false, // this page never spawns the agent; see the module docblock
        awaitingApproval: stage?.status === 'COMPLETED' && stage?.approval === 'PENDING',
        jiraProject: JIRA_CONFIG.projectKey,
        environment: FRAMEWORK_CONFIG.environment,
      });
    } catch (err: any) {
      logger.error('Error fetching Agent 08 state', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/agent08/preview (reads only — nothing is created) ──────────────
  app.get(`/api/${PREFIX}/preview`, async (_req: Request, res: Response) => {
    try {
      await ensureStateReady();
      const results = await stateManager.getPipelineArtifact('executionResults');
      if (!results) {
        return res.status(409).json({ error: 'No executionResults yet. Run Agent 07 first.' });
      }

      const proposals = await buildPreview(results);
      return res.json({
        proposals,
        runId: results.runId,
        summary: results.summary,
        jira: await integrationStatus(false),
      });
    } catch (err: any) {
      logger.error('Agent 08 preview failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/agent08/commit (the only route that writes to Jira) ───────────
  app.post(`/api/${PREFIX}/commit`, async (req: Request, res: Response) => {
    const bugs = Array.isArray(req.body?.bugs) ? req.body.bugs : null;
    if (!bugs || bugs.length === 0) {
      return res.status(400).json({ error: 'bugs must be a non-empty array of reviewed proposals.' });
    }

    const projectId = resolveProjectId(req.body?.projectName as string);
    await ensureStateReady(projectId);

    const results = await stateManager.getPipelineArtifact('executionResults');
    const filed: any[] = [];
    const skipped: any[] = [];
    const warnings: string[] = [];

    for (const bug of bugs) {
      try {
        if (bug.verdict === 'MEMORY_DUP' || bug.action === 'skip') {
          skipped.push({ ...bug, skipped: true, source: 'memory' });
          continue;
        }

        if (bug.verdict === 'JIRA_DUP' && bug.duplicateOf) {
          await jiraClient.addComment(
            bug.duplicateOf,
            `⚠️ Another occurrence detected in Run ID: ${results?.runId}\nError: ${bug.errorMessage || ''}`,
          );
          await memoryEngine.recordKnownBug({
            title: bug.title, hash: bug.hash, jiraKey: bug.duplicateOf, severity: bug.severity,
          });
          filed.push({ ...bug, jiraKey: bug.duplicateOf, updated: true, skipped: false });
          continue;
        }

        const jiraKey = await jiraClient.createIssue({
          project: { key: JIRA_CONFIG.projectKey },
          issuetype: { name: JIRA_CONFIG.issueTypes.bug },
          summary: bug.title,
          description: adf(bug.description),
          priority: { name: JIRA_PRIORITY[bug.severity] || 'Medium' },
          labels: bug.labels,
          environment: adf(JSON.stringify(bug.environment, null, 2)),
        });

        if (!jiraKey) {
          // Every JiraMCPClient method swallows its error and returns a benign value, so a null key
          // is the only signal that the call failed at all.
          warnings.push(`Jira did not return a key for ${bug.tcKey || bug.title} — it was not created.`);
          skipped.push({ ...bug, skipped: true, reason: 'Jira create failed' });
          continue;
        }

        // Real evidence, where the agent hardcodes a placeholder path that never exists.
        for (const attachment of bug.attachments || []) {
          const absolute = resolveAllowedPath(attachment.path || attachment, [REPORTS_DIR]);
          if (!absolute || !fs.existsSync(absolute)) {
            warnings.push(`Attachment missing for ${jiraKey}: ${attachment.path || attachment}`);
            continue;
          }
          const uploaded = await jiraClient.addAttachment(jiraKey, absolute);
          if (!uploaded) warnings.push(`Jira rejected attachment ${path.basename(absolute)} on ${jiraKey}.`);
        }

        await memoryEngine.recordKnownBug({
          title: bug.title, hash: bug.hash, jiraKey, severity: bug.severity,
        });
        filed.push({ ...bug, jiraKey, skipped: false });
      } catch (err: any) {
        warnings.push(`Failed to file ${bug.tcKey || bug.title}: ${err.message}`);
      }
    }

    // Shaped as BugReportOutput so Agent 09 downstream reads it exactly as it would the agent's own.
    const output = {
      reportId: `bug_report_${Date.now()}`,
      reportedAt: new Date().toISOString(),
      totalFailures: bugs.length,
      bugsCreated: filed.filter((b) => b.jiraKey && !b.updated).length,
      bugsUpdated: filed.filter((b) => b.updated).length,
      duplicatesSkipped: skipped.length,
      bugReports: filed,
      skippedDuplicates: skipped,
      environment: FRAMEWORK_CONFIG.environment,
      summary: results?.summary || {},
      filedVia: 'agent08-ui',
    };

    try {
      await stateManager.setPipelineArtifact('bugReports', output);
      await stateManager.markStageCompleted(STAGE_ID, output);
    } catch (err: any) {
      logger.error('Could not persist bugReports', { error: err.message });
      return res.status(500).json({ error: err.message, output });
    }

    logger.info('Agent 08 commit complete', {
      created: output.bugsCreated, updated: output.bugsUpdated, skipped: output.duplicatesSkipped,
    });
    return res.json({ ok: true, output, warnings });
  });

  // ── GET /api/agent08/logs (SSE) ─────────────────────────────────────────────
  app.get(`/api/${PREFIX}/logs`, (req: Request, res: Response) => logStream.attach(req, res));

  // ── GET /api/agent08/status ─────────────────────────────────────────────────
  app.get(`/api/${PREFIX}/status`, async (req: Request, res: Response) => {
    try {
      res.json(await integrationStatus(Boolean(req.query.live)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/agent08/artifact (evidence thumbnails) ─────────────────────────
  app.get(`/api/${PREFIX}/artifact`, (req: Request, res: Response) => {
    const raw = String(req.query.path || '').trim();
    if (!raw) return res.status(400).json({ error: 'path query parameter is required' });

    const candidate = path.isAbsolute(raw) ? path.resolve(raw) : resolveAllowedPath(raw, [REPORTS_DIR]);
    if (!candidate || !isInside(REPORTS_DIR, candidate)) {
      return res.status(403).json({ error: 'Access denied. Artifact must be inside reports/.' });
    }
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      return res.status(404).json({ error: 'Artifact not found. It may have been cleared by a newer run.' });
    }

    const contentType = ARTIFACT_TYPES[path.extname(candidate).toLowerCase()];
    if (!contentType) return res.status(415).json({ error: `Unsupported artifact type: ${path.extname(candidate)}` });

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return fs.createReadStream(candidate).pipe(res);
  });

  // ── POST /api/agent08/chat ──────────────────────────────────────────────────
  app.post(`/api/${PREFIX}/chat`, async (req: Request, res: Response) => {
    const { message, history = [] } = req.body as {
      message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    try {
      const results = await stateManager.getPipelineArtifact('executionResults');
      const bugReports = await stateManager.getPipelineArtifact('bugReports');
      const systemPrompt = [
        'You are ARIA, a Senior QA Engineer triaging test failures into bug reports.',
        'Answer strictly from the data below. If a detail is not present, say so — do NOT invent failures or Jira keys.',
        'Severity is inferred by regex on the error text, first match wins, defaulting to Medium.',
        'A test with retries > 0 appears in both failedTests and flakyTests, so it may be flaky rather than a real defect.',
        '',
        '=== FAILURES ===',
        JSON.stringify((results?.failedTests || []).map((t: any) => ({
          tcKey: t.tcKey, title: t.title, retries: t.retries, error: t.error?.message?.slice(0, 400),
        })), null, 2),
        '',
        '=== ALREADY FILED ===',
        JSON.stringify(bugReports?.bugReports || [], null, 2).slice(0, 4000),
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
      logger.error('Agent 08 chat failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  registerApprovalRoutes(app, { prefix: PREFIX, stageId: STAGE_ID, logger });
  return logStream;
}
