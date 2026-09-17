'use strict';

/**
 * @fileoverview ARIA Agent 01 UI Server
 * Serves the web UI for Agent 01 (Requirement Deep Analyzer).
 * Provides REST/SSE endpoints to run the agent, stream logs,
 * store clarification answers, and proxy approval decisions.
 *
 * @module Agent01UIServer
 * @version 1.0.0
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { ClarificationStore } from '../core/clarifications/ClarificationStore';

import { stateManager } from '../core/state-manager/StateManager';
import { registerPipelineRoutes } from './pipelineRoutes';
import { registerPromptTraceRoutes } from './promptTraceRoutes';
import { memoryEngine } from '../core/project-memory/MemoryEngine';
import { llmClient } from '../core/llm/LLMClient';
import { Logger } from '../core/logger/Logger';
import { syncFeatureFiles } from '../agents/02-test-case-generator/utils';
import { isTestCaseSelected, setTestCaseSelected } from '../core/types';
import { syncFixturesFileFromTestData } from '../core/state-manager/FixtureSync';
import { loadCurrentTestData } from '../core/state-manager/TestDataFreshness';
import { projectPaths, readActiveProjectSlug } from '../core/aut/projectPaths';
import { computeRequirementFingerprint, uploadFileNameFor } from '../core/requirements/requirementFingerprint';
import { registerAgent03ReviewRoutes } from './agent03ReviewRoutes';
import { registerAgent04DataRoutes } from './agent04DataRoutes';
import { registerAgent06Routes } from './agent06Routes';
import { registerAgent07Routes } from './agent07Routes';
import { registerAgent08Routes } from './agent08Routes';
import { registerAgent09Routes } from './agent09Routes';
import { registerAgent10Routes } from './agent10Routes';
import { registerAgent11Routes } from './agent11Routes';
import { isNonAnswer, nonAnswerMessage } from '../core/clarifications/answerQuality';

require('dotenv').config();

const logger = new Logger('Agent01UI');
const app = express();
const PORT = parseInt(process.env.UI_PORT || '3000', 10);
const APPROVAL_PORT = parseInt(process.env.APPROVAL_WEBHOOK_PORT || '8081', 10);
const FRAMEWORK_DIR = path.resolve(__dirname, '..');

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
registerPipelineRoutes(app);
registerPromptTraceRoutes(app);
app.use(express.static(path.join(__dirname, 'static')));

// ── File upload config ────────────────────────────────────────────────────────
const uploadsDir = path.join(FRAMEWORK_DIR, 'requirements', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.md' || ext === '.txt') {
      cb(null, true);
    } else {
      cb(new Error('Only .md and .txt files are accepted.'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── Agent process management ──────────────────────────────────────────────────
let activeProcess: ChildProcess | null = null;
const sseClients: Set<Response> = new Set();

/**
 * What changed between the previously ingested requirement and the one now being processed.
 *
 * Held in memory for the advisory summary: the `requirements` artifact is overwritten as soon as the
 * agent runs, so the previous text has to be captured before spawning. The summary is advice for the
 * human — the fingerprint alone decides whether this is a new version.
 */
let lastRequirementChange: {
  fingerprintBefore: string;
  fingerprintAfter: string;
  previousText: string;
  currentText: string;
  summary?: string;
} | null = null;

/** Broadcasts an SSE event to all connected clients. */
function broadcastSSE(event: Record<string, any>): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch (_) { sseClients.delete(client); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/** Health check */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'ARIA Agent 01 UI', port: PORT });
});

// ── GET /api/agent01/state ────────────────────────────────────────────────────
/**
 * Returns the current state of stage 01 and the analysis report artifact.
 * Used by the frontend to poll for completion.
 */
app.get('/api/agent01/state', async (_req: Request, res: Response) => {
  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }
    
    const stage = await stateManager.get('stages.01-requirement-analyzer');
    const report = await stateManager.getPipelineArtifact('analyzedRequirements');
    res.json({ stage, report, running: !!activeProcess });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/agent01/prompt-trace ─────────────────────────────────────────────
/**
 * Returns what Agent 01's LLM was given on its latest run (system prompt, assembled user prompt, memory
 * inputs), every call it made, and the provider-reported usage behind the token card.
 */
app.get('/api/agent01/prompt-trace', async (_req: Request, res: Response) => {
  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }
    const trace = await stateManager.getPipelineArtifact('agent01PromptTrace');
    if (!trace) return res.status(404).json({ error: 'No prompt trace yet — run the analysis to record one.' });
    res.json(trace);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent01/run ─────────────────────────────────────────────────────
/**
 * Starts Agent 01 as a child process.
 * Accepts either a file upload (multipart) or a Jira story ID (JSON body).
 */
app.post('/api/agent01/run', upload.single('file'), async (req: Request, res: Response) => {
  if (activeProcess) {
    logger.info('Killing existing agent process to start a new run');
    activeProcess.removeAllListeners('close');
    activeProcess.kill('SIGKILL');
    activeProcess = null;
  }

  const projectName = ((req.body?.projectName as string) || 'ARIA Project').trim();
  const jiraId      = ((req.body?.jiraId      as string) || '').trim();
  const reanalyze   = String(req.body?.reanalyze || '') === 'true';
  const uploadedFile = (req as any).file as Express.Multer.File | undefined;

  let requirementsArg: string;
  let formatArg: string;

  if (jiraId) {
    requirementsArg = jiraId;
    formatArg       = 'jira';
  } else if (uploadedFile) {
    formatArg = 'file';

    // Identity comes from content, never from the filename or the upload event, so the same
    // requirement uploaded again under any name is recognised as already processed.
    const content = fs.readFileSync(uploadedFile.path, 'utf-8');
    const fingerprint = computeRequirementFingerprint(content);

    let previous: any = null;
    try {
      await stateManager.initialize(projectName);
      previous = await stateManager.getLatestArtifactForProject('analyzedRequirements');
    } catch (err: any) {
      logger.warn('Could not read the previous analysis; treating this upload as new', { error: err.message });
    }

    const alreadyProcessed = !reanalyze
      && previous?.requirementFingerprint === fingerprint
      && Array.isArray(previous.features) && previous.features.length > 0;

    if (alreadyProcessed) {
      // Nothing may be written: no stored upload, no run, no stage row, no analysis file.
      fs.rmSync(uploadedFile.path, { force: true });
      logger.info('Duplicate requirement upload — no artifacts written', {
        fingerprint: fingerprint.slice(0, 12), project: projectName,
      });
      return res.json({
        ok: true,
        duplicate: true,
        project: projectName,
        requirementFingerprint: fingerprint,
        analysis: previous,
        message: 'This requirement has already been processed — nothing was changed. Use "Re-analyze anyway" to force a fresh ingestion.',
      });
    }

    if (previous?.requirementFingerprint && previous.requirementFingerprint !== fingerprint) {
      // Capture before the agent overwrites the requirements artifact.
      let previousText = '';
      try { previousText = (await stateManager.getPipelineArtifact('requirements')) || ''; } catch { /* advisory only */ }
      lastRequirementChange = {
        fingerprintBefore: previous.requirementFingerprint,
        fingerprintAfter: fingerprint,
        previousText,
        currentText: content,
      };
    } else {
      lastRequirementChange = null;
    }

    // Content-addressed filename: identical content always resolves to the same path, so a repeat
    // upload can never leave a second randomly-named copy behind.
    const ext = (path.extname(uploadedFile.originalname) || '.md').toLowerCase();
    const finalPath = path.join(uploadsDir, uploadFileNameFor(fingerprint, ext));
    if (fs.existsSync(finalPath)) {
      fs.rmSync(uploadedFile.path, { force: true }); // same content by construction — keep the stored copy
    } else {
      fs.renameSync(uploadedFile.path, finalPath);
    }
    requirementsArg = finalPath;
  } else {
    return res.status(400).json({ error: 'Provide either a file upload (.md / .txt) or a Jira story ID.' });
  }

  // Use the raw project name as the state-DB key — must be identical to
  // what the agent passes to stateManager.initialize() via --project=<name>
  const projectId = projectName;

  // Reuse the project's existing run. startNewRun() here (and again in the agent's own CLI) created
  // two runs per upload — one of them an orphan carrying a full set of empty stage rows.
  try {
    await stateManager.initialize(projectId);
    await memoryEngine.initialize(projectId);
    // synchronously mark as running so frontend polling immediately sees RUNNING and doesn't snap to old results
    await stateManager.markStageRunning('01-requirement-analyzer');
  } catch (_) { /* non-fatal — agent will re-init */ }

  // ── Spawn agent process ───────────────────────────────────────────────────
  const agentScript = path.join(FRAMEWORK_DIR, 'agents', '01-requirement-analyzer', 'agent.ts');

  activeProcess = spawn(
    process.execPath,
    ['-r', 'ts-node/register', agentScript,
      `--requirements=${requirementsArg}`,
      `--project=${projectName}`,
      `--format=${formatArg}`,
      ...(reanalyze ? ['--reanalyze'] : [])],
    {
      cwd:   FRAMEWORK_DIR,
      env:   { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'], // stdin left open (never written) so readline doesn't throw
    },
  );

  broadcastSSE({ type: 'status', stage: 'RUNNING', message: `Agent 01 started (${formatArg} mode)` });
  logger.info('Agent 01 spawned', { format: formatArg, project: projectName });

  activeProcess.stdout?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach(line =>
      broadcastSSE({ type: 'log', level: 'info', message: line }),
    );
  });

  activeProcess.stderr?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach(line =>
      broadcastSSE({ type: 'log', level: 'warn', message: line }),
    );
  });

  activeProcess.on('close', async (code) => {
    activeProcess = null;
    if (code === 0) {
      try {
        const report     = await stateManager.getPipelineArtifact('analyzedRequirements');
        const stageState = await stateManager.get('stages.01-requirement-analyzer');
        broadcastSSE({ type: 'complete', report, stageState });
        logger.info('Agent 01 completed successfully');
      } catch {
        broadcastSSE({ type: 'complete', report: null, stageState: null });
      }
    } else {
      broadcastSSE({ type: 'error', message: `Agent process exited with code ${code}` });
      logger.error('Agent 01 process failed', { exitCode: code });
    }
  });

  res.json({ ok: true, format: formatArg, project: projectName });
});

// ── GET /api/agent01/change-summary ──────────────────────────────────────────
/**
 * Advisory description of what changed between the previous requirement and the current one.
 *
 * Purely informational. The content fingerprint alone decides whether an upload is a new version;
 * this only tells the human what moved, and whether it looks material or cosmetic. Deciding with an
 * LLM instead would risk silently swallowing a real requirement change.
 */
app.get('/api/agent01/change-summary', async (_req: Request, res: Response) => {
  if (!lastRequirementChange) {
    return res.json({ available: false, reason: 'No requirement change was detected in this session.' });
  }
  if (lastRequirementChange.summary) {
    return res.json({ available: true, cached: true, ...lastRequirementChange, summary: lastRequirementChange.summary });
  }

  const MAX_CHARS = 12000; // keep the comparison inside a single comfortable request
  try {
    const response = await llmClient.chat('01-requirement-analyzer', {
      messages: [
        {
          role: 'system' as const,
          content: [
            'You compare two versions of a software requirement document.',
            'Reply with at most six short bullet points naming what actually changed: acceptance criteria,',
            'business rules, functional behaviour, or requirements added or removed.',
            'Ignore pure formatting, whitespace and wording that carries the same meaning.',
            'End with one line: "Verdict: MATERIAL" or "Verdict: COSMETIC".',
          ].join(' '),
        },
        {
          role: 'user' as const,
          content: `=== PREVIOUS ===
${lastRequirementChange.previousText.slice(0, MAX_CHARS)}

=== CURRENT ===
${lastRequirementChange.currentText.slice(0, MAX_CHARS)}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 600,
    });
    lastRequirementChange.summary = response.text;
    return res.json({ available: true, cached: false, ...lastRequirementChange });
  } catch (err: any) {
    logger.warn('Change summary failed', { error: err.message });
    // Advisory only — a failure here must never imply the requirement did not change.
    return res.json({
      available: true,
      summary: null,
      error: err.message,
      fingerprintBefore: lastRequirementChange.fingerprintBefore,
      fingerprintAfter: lastRequirementChange.fingerprintAfter,
    });
  }
});

// ── GET /api/agent01/logs ─────────────────────────────────────────────────────
/**
 * Server-Sent Events endpoint — streams agent log output to the browser.
 */
app.get('/api/agent01/logs', (req: Request, res: Response) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
  res.flushHeaders();

  // Keep-alive heartbeat every 20 s
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 20_000);

  sseClients.add(res);
  logger.info('SSE client connected', { total: sseClients.size });

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    logger.info('SSE client disconnected', { total: sseClients.size });
  });
});

// ── POST /api/agent01/clarify ─────────────────────────────────────────────────
/**
 * Records user answers to ambiguity questions (MemoryEngine and the clarification store) and marks those
 * ambiguities resolved in the stored analysis, so the user can proceed without another LLM run. The updated
 * report is returned; a later re-analysis uses the answers automatically.
 */
app.post('/api/agent01/clarify', async (req: Request, res: Response) => {
  const { answers } = req.body as {
    answers: Array<{ id: string; question: string; answer: string }>;
  };

  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'answers array is required' });
  }

  const declined = answers.filter(({ answer }) => answer?.trim() && isNonAnswer(answer));
  if (declined.length > 0) {
    return res.status(400).json({
      error: declined.map(({ answer }) => nonAnswerMessage(answer, 'leave the question unanswered (it stays open) or state the decision, e.g. "Do not verify the colour"')).join(' '),
      declinedIds: declined.map(({ id }) => id),
    });
  }

  try {
    const report = await stateManager.getPipelineArtifact('analyzedRequirements');
    const store = new ClarificationStore(stateManager.getProjectId());
    const ambiguitiesById = new Map<string, any>((report?.ambiguities || []).map((amb: any) => [amb.id, amb]));
    for (const { id, question, answer } of answers) {
      if (!question || !answer?.trim()) continue;
      await memoryEngine.recordClarification(question.trim(), answer.trim(), '01-requirement-analyzer');
      const ambiguity = ambiguitiesById.get(id);
      if (!ambiguity) continue;
      if (ambiguity.clarificationId) store.answer(ambiguity.clarificationId, answer.trim(), 'agent01-ui');
      Object.assign(ambiguity, { resolved: true, resolution: answer.trim() });
    }
    if (report) {
      report.ambiguitiesPending = (report.ambiguities || []).filter((amb: any) => !amb.resolved).length;
      await stateManager.setPipelineArtifact('analyzedRequirements', report);
    }
    logger.info('Clarification answers saved', { count: answers.length, pending: report?.ambiguitiesPending });
    res.json({ ok: true, saved: answers.length, report });
  } catch (err: any) {
    logger.error('Failed to save clarifications', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent01/chat ────────────────────────────────────────────────────
/**
 * ARIA chatbot endpoint. Uses the analysedRequirements report as sole context.
 * The LLM is instructed NOT to hallucinate facts outside the report.
 */
app.post('/api/agent01/chat', async (req: Request, res: Response) => {
  const { message, history = [] } = req.body as {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const report = await stateManager.getPipelineArtifact('analyzedRequirements');
    const rawReqs = await stateManager.getPipelineArtifact('requirements');

    const systemPrompt = [
      'You are ARIA, an AI QA architect. The user wants to verify your understanding of the requirements you just analyzed.',
      'Answer questions accurately based on the structured analysis report and the raw requirements document.',
      'If the user asks a question about the requirements, first check the Analysis Report. If the detail is missing, search the Raw Requirements Document.',
      'If a fact is NOT present in either document, clearly state that — do NOT invent or hallucinate any details.',
      'Be concise and precise. Use bullet points where helpful.',
      '',
      '=== RAW REQUIREMENTS DOCUMENT ===',
      rawReqs ? String(rawReqs) : '(No raw requirements available)',
      '',
      '=== ANALYSIS REPORT ===',
      JSON.stringify(report, null, 2),
    ].join('\n');

    const messages = [
      { role: 'system'    as const, content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user'      as const, content: message.trim() },
    ];

    const response = await llmClient.chat('01-requirement-analyzer', {
      messages,
      temperature: 0.3,
      max_tokens:  1024,
    });

    res.json({ reply: response.text });
  } catch (err: any) {
    logger.error('Chat error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent01/approve  ────────────────────────────────────────────────
// ── POST /api/agent01/reject   ────────────────────────────────────────────────
/**
 * Handles approve / reject decisions.
 * Tries the ApprovalGate webhook on port 8081 first (if the child process is actively waiting).
 * If unreachable (process finished, closed, or crashed), falls back to directly recording
 * the decision in StateManager and MemoryEngine.
 */
function handleApproval(stageId: string, action: 'approve' | 'reject') {
  return async (req: Request, res: Response) => {
    const isApproval = action === 'approve';
    const comment = req.body?.comment || (isApproval ? 'Approved via ARIA UI' : 'Rejected via ARIA UI');
    const body = JSON.stringify({ stageId, comment });
    const options = {
      hostname: 'localhost',
      port:     APPROVAL_PORT,
      path:     `/${action}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout:  2500,
    };

    let responded = false;
    const fallbackDirect = async () => {
      if (responded) return;
      responded = true;
      try {
        if (!(stateManager as any)._initialized) {
          try {
            const stateDb = stateManager.getDatabase();
            const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
            await stateManager.initialize(latestRun?.project_id || 'ARIA Project');
            await memoryEngine.initialize(latestRun?.project_id || 'ARIA Project');
          } catch (_) {
            await stateManager.initialize('ARIA Project');
          }
        }
        if (isApproval) {
          await stateManager.markStageApproved(stageId, comment);
          await memoryEngine.recordApprovalFeedback(stageId, 'APPROVED', comment);
        } else {
          await stateManager.markStageRejected(stageId, comment);
          await memoryEngine.recordApprovalFeedback(stageId, 'REJECTED', comment);
        }
        logger.info(`Stage ${stageId} ${action}d directly via StateManager (webhook not active)`);
        res.json({ ok: true, status: isApproval ? 'APPROVED' : 'REJECTED', direct: true });
      } catch (err: any) {
        logger.error(`Direct state update failed for ${stageId}`, { error: err.message });
        res.status(500).json({ error: err.message });
      }
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => { data += chunk; });
      proxyRes.on('end', () => {
        if (!responded) {
          try {
            const parsed = JSON.parse(data);
            if (proxyRes.statusCode && proxyRes.statusCode >= 400 && parsed.error && parsed.error.includes('mismatch')) {
              logger.warn(`Approval webhook port ${APPROVAL_PORT} active for different stage (${parsed.error}); using direct StateManager fallback for ${stageId}`);
              return fallbackDirect();
            }
            responded = true;
            res.status(proxyRes.statusCode || 200).json(parsed);
          } catch {
            responded = true;
            res.status(proxyRes.statusCode || 200).send(data);
          }
        }
      });
    });

    proxyReq.on('error', (_err) => {
      logger.warn(`Approval webhook port ${APPROVAL_PORT} unreachable for ${stageId}; using direct StateManager fallback`);
      fallbackDirect();
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      logger.warn(`Approval webhook timed out for ${stageId}; using direct StateManager fallback`);
      fallbackDirect();
    });

    proxyReq.write(body);
    proxyReq.end();
  };
}

app.post('/api/agent01/approve', handleApproval('01-requirement-analyzer', 'approve'));
app.post('/api/agent01/reject',  handleApproval('01-requirement-analyzer', 'reject'));

// ── Agent 02 (Test Case Generator) Routes ────────────────────────────────────
let activeAgent02Process: ChildProcess | null = null;
const agent02SseClients: Set<Response> = new Set();

function broadcastAgent02SSE(data: any): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of agent02SseClients) {
    try { client.write(payload); } catch (_) { agent02SseClients.delete(client); }
  }
}

app.get('/api/agent02/state', async (req: Request, res: Response) => {
  try {
    let reqProject = (req.query.projectId as string || '').trim();
    if (!reqProject) {
      try {
        const stateDb = stateManager.getDatabase();
        const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
        if (latestRun?.project_id) reqProject = latestRun.project_id;
      } catch (_) {}
    }
    if (reqProject && (stateManager as any)._projectId !== reqProject) {
      await stateManager.initialize(reqProject);
    } else if (!(stateManager as any)._initialized) {
      await stateManager.initialize(reqProject || 'default');
    }

    const stage01 = await stateManager.get('stages.01-requirement-analyzer');
    const stage = await stateManager.get('stages.02-test-case-generator');
    const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
    const testCases = await stateManager.getPipelineArtifact('testCases');

    // Detect if test cases are out of date compared to latest requirement analysis
    const isOutOfDate = !!(
      stage01?.completedAt && stage?.completedAt &&
      new Date(stage01.completedAt).getTime() > new Date(stage.completedAt).getTime()
    );

    res.json({
      stage,
      requirements,
      testCases,
      isOutOfDate,
      projectName: (stateManager as any)._projectId,
      running: !!activeAgent02Process
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/agent02/prompt-trace ─────────────────────────────────────────────
/**
 * Returns what Agent 02's LLM was given on its latest run (system prompt, per-story user prompts), every call and
 * validation attempt, and the provider-reported usage behind the token card.
 */
app.get('/api/agent02/prompt-trace', async (_req: Request, res: Response) => {
  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }
    const trace = await stateManager.getPipelineArtifact('agent02PromptTrace');
    if (!trace) return res.status(404).json({ error: 'No prompt trace yet — generate test cases to record one.' });
    res.json(trace);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agent02/run', async (req: Request, res: Response) => {
  if (activeAgent02Process) {
    logger.info('Killing existing Agent 02 process to start a new run');
    activeAgent02Process.removeAllListeners('close');
    activeAgent02Process.kill('SIGKILL');
    activeAgent02Process = null;
  }

  let projectName = ((req.body?.projectName as string) || '').trim();
  if (!projectName) {
    try {
      const stateDb = stateManager.getDatabase();
      const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
      if (latestRun?.project_id) projectName = latestRun.project_id;
    } catch (_) {}
  }
  projectName = projectName || 'ARIA Project';

  const skipPositive = req.body?.skipPositive ? '--skip-positive' : '';
  const skipNegative = req.body?.skipNegative ? '--skip-negative' : '';
  const skipEdge = req.body?.skipEdge ? '--skip-edge' : '';
  const skipApi = req.body?.skipApi ? '--skip-api' : '';
  const skipPerf = req.body?.skipPerf ? '--skip-perf' : '';

  try {
    await stateManager.initialize(projectName);
    await memoryEngine.initialize(projectName);
    await stateManager.markStageRunning('02-test-case-generator');
  } catch (_) { /* non-fatal */ }

  const args = [
    '-r', 'ts-node/register',
    path.join(FRAMEWORK_DIR, 'agents', '02-test-case-generator', 'agent.ts'),
    `--project=${projectName}`
  ];

  if (skipPositive) args.push(skipPositive);
  if (skipNegative) args.push(skipNegative);
  if (skipEdge) args.push(skipEdge);
  if (skipApi) args.push(skipApi);
  if (skipPerf) args.push(skipPerf);

  logger.info('Spawning Agent 02', { project: projectName, args: args.join(' ') });
  activeAgent02Process = spawn(process.execPath, args, {
    cwd: FRAMEWORK_DIR,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  activeAgent02Process.stdout?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line: string) =>
      broadcastAgent02SSE({ type: 'log', level: 'info', message: line }),
    );
  });

  activeAgent02Process.stderr?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line: string) =>
      broadcastAgent02SSE({ type: 'log', level: 'error', message: line }),
    );
  });

  activeAgent02Process.on('close', async (code) => {
    activeAgent02Process = null;
    if (code === 0) {
      try {
        const testCases = await stateManager.getPipelineArtifact('testCases');
        const stageState = await stateManager.get('stages.02-test-case-generator');
        broadcastAgent02SSE({ type: 'complete', testCases, stageState });
        logger.info('Agent 02 process completed successfully');
      } catch {
        broadcastAgent02SSE({ type: 'complete', testCases: null, stageState: null });
      }
    } else {
      broadcastAgent02SSE({ type: 'error', message: `Agent process exited with code ${code}` });
      logger.error('Agent 02 process failed', { exitCode: code });
    }
  });

  res.json({ ok: true, project: projectName });
});

app.get('/api/agent02/logs', (req: Request, res: Response) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 20_000);
  agent02SseClients.add(res);

  req.on('close', () => {
    clearInterval(heartbeat);
    agent02SseClients.delete(res);
  });
});

app.post('/api/agent02/chat', async (req: Request, res: Response) => {
  const { message, history = [] } = req.body as {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const report = await stateManager.getPipelineArtifact('testCases');
    const systemPrompt = [
      'You are ARIA, an AI QA architect. The user wants to verify the test cases you just generated.',
      'Answer questions accurately based on the generated test cases report.',
      'If a fact is NOT present in the document, clearly state that — do NOT invent or hallucinate any details.',
      'Be concise and precise. Use bullet points where helpful.',
      '',
      '=== GENERATED TEST CASES REPORT ===',
      JSON.stringify(report, null, 2),
    ].join('\n');

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message.trim() },
    ];

    const response = await llmClient.chat('02-test-case-generator', {
      messages,
      temperature: 0.3,
      max_tokens: 1024,
    });

    res.json({ reply: response.text });
  } catch (err: any) {
    logger.error('Agent 02 Chat error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Advisory Insights Helper ────────────────────────────────────────────────
function computeRequirementMappingInsights(requirements: any, testCasesOutput: any) {
  const allTCs: any[] = testCasesOutput?.zephyrExport?.testCases || testCasesOutput?.testCases || [];
  const isSelected = (tc: any) => isTestCaseSelected(tc);
  const selectedTCs = allTCs.filter(isSelected);
  const unselectedTCs = allTCs.filter((tc: any) => !isSelected(tc));

  const features = requirements?.features || [];
  const pendingRequirements: any[] = [];
  const featureMap = new Map<string, string>();

  for (const f of features) {
    featureMap.set(f.id, f.name);
    for (const s of (f.userStories || [])) {
      const selectedForStory = selectedTCs.filter((tc: any) => {
        const sid = tc.userStoryId;
        return sid === s.id;
      });
      const unselectedForStory = unselectedTCs.filter((tc: any) => {
        const sid = tc.userStoryId;
        return sid === s.id;
      });

      if (selectedForStory.length === 0) {
        const reason = unselectedForStory.length > 0
          ? `All ${unselectedForStory.length} test case(s) (${unselectedForStory.map((t: any) => t.key).join(', ')}) were unselected during Agent 02 stage.`
          : 'No test cases were generated or mapped for this user story in the Requirement Document.';

        pendingRequirements.push({
          storyId: s.id,
          storyTitle: s.title || s.name || s.id,
          featureId: f.id,
          featureName: f.name,
          riskLevel: f.riskLevel || 'MEDIUM',
          reason,
          unselectedKeys: unselectedForStory.map((t: any) => t.key),
          status: 'PENDING_MAPPING',
        });
      } else if (unselectedForStory.length > 0) {
        pendingRequirements.push({
          storyId: s.id,
          storyTitle: s.title || s.name || s.id,
          featureId: f.id,
          featureName: f.name,
          riskLevel: f.riskLevel || 'MEDIUM',
          reason: `Partial mapping: ${selectedForStory.length} active, ${unselectedForStory.length} unselected (${unselectedForStory.map((t: any) => t.key).join(', ')}).`,
          unselectedKeys: unselectedForStory.map((t: any) => t.key),
          status: 'PARTIAL_MAPPING',
        });
      }
    }
  }

  const unselectedTestCases = unselectedTCs.map((tc: any) => ({
    key: tc.key,
    name: tc.name,
    type: tc.type,
    userStoryId: tc.userStoryId || 'US-01',
    featureName: featureMap.get(tc.featureId) || 'General Features',
    reason: 'Excluded by user during Agent 02 approval stage',
  }));

  const summary = unselectedTCs.length > 0
    ? `${unselectedTCs.length} test case(s) were excluded during Agent 02 stage. ${pendingRequirements.length} requirement(s) have pending or partial test coverage. (Informational Advisory — user may still approve or reject).`
    : 'All generated test cases were selected. Full requirement traceability mapped.';

  return {
    unselectedCount: unselectedTCs.length,
    selectedCount: selectedTCs.length,
    totalCount: allTCs.length,
    unselectedTestCases,
    pendingRequirements,
    summary,
  };
}

app.post('/api/agent02/approve', async (req: Request, res: Response) => {
  const uncheckedTestCaseKeys = req.body?.uncheckedTestCaseKeys || [];
  try {
    const testCasesOutput = await stateManager.getPipelineArtifact('testCases');
    if (testCasesOutput?.zephyrExport?.testCases) {
      const allTCs = testCasesOutput.zephyrExport.testCases;
      for (const tc of allTCs) {
        setTestCaseSelected(tc, !uncheckedTestCaseKeys.includes(tc.key));
      }
      const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
      syncFeatureFiles(requirements, allTCs, logger);
      delete testCasesOutput.k6ScenarioIndex; // legacy artifact key — no longer produced or read
      await stateManager.setPipelineArtifact('testCases', testCasesOutput);

      // Always sync reviewedTestCases advisory so Agent 03 screen shows recent data immediately
      const liveInsights = computeRequirementMappingInsights(requirements, testCasesOutput);
      const reviewed = await stateManager.getPipelineArtifact('reviewedTestCases');
      if (reviewed) {
        reviewed.informationalInsights = liveInsights;
        reviewed.unselectedTestCases = liveInsights.unselectedTestCases;
        await stateManager.setPipelineArtifact('reviewedTestCases', reviewed);
      }
    }
  } catch (err: any) {
    logger.warn('Failed to filter obsolete test cases during approval', { error: err.message });
  }

  return handleApproval('02-test-case-generator', 'approve')(req, res);
});

app.post('/api/agent02/reject', handleApproval('02-test-case-generator', 'reject'));

// ── PUT / POST /api/agent02/testcase ──────────────────────────────────────────
const updateTestCaseHandler = async (req: Request, res: Response) => {
  const { key, name, type, labels, objective, precondition, testSteps } = req.body || {};
  if (!key) {
    return res.status(400).json({ error: 'Test case key is required.' });
  }

  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }

    const testCasesOutput = await stateManager.getPipelineArtifact('testCases');
    if (!testCasesOutput?.zephyrExport?.testCases) {
      return res.status(404).json({ error: 'No test cases artifact found in state.' });
    }

    const allTCs = testCasesOutput.zephyrExport.testCases;
    const targetTC = allTCs.find((tc: any) => tc.key === key);
    if (!targetTC) {
      return res.status(404).json({ error: `Test case ${key} not found.` });
    }

    if (typeof name === 'string' && name.trim()) targetTC.name = name.trim();
    if (typeof type === 'string' && type.trim()) targetTC.type = type.trim();
    if (Array.isArray(labels)) {
      targetTC.labels = labels.map((l: any) => String(l).trim()).filter(Boolean);
    }
    if (typeof objective === 'string') targetTC.objective = objective.trim();
    if (typeof precondition === 'string') targetTC.precondition = precondition.trim();
    if (Array.isArray(testSteps)) {
      targetTC.testSteps = testSteps.map((step: any) => ({
        keyword: step.keyword || undefined,
        description: (step.description || '').trim(),
        testData: (step.testData || '').trim(),
        expectedResult: (step.expectedResult || '').trim(),
      }));
    }

    await stateManager.setPipelineArtifact('testCases', testCasesOutput);

    try {
      const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
      if (requirements) {
        syncFeatureFiles(requirements, allTCs, logger);
      }
    } catch (syncErr: any) {
      logger.warn('Failed to resync feature files after test case update', { error: syncErr.message });
    }

    logger.info(`Test case ${key} updated successfully via UI`, { name: targetTC.name });
    return res.json({ ok: true, testCase: targetTC });
  } catch (err: any) {
    logger.error('Error updating test case', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
};

app.put('/api/agent02/testcase', updateTestCaseHandler);
app.post('/api/agent02/testcase', updateTestCaseHandler);

// ── Agent 03 (Test Case Reviewer) Routes ────────────────────────────────────

let activeProcess03: ChildProcess | null = null;
const sseClients03: Set<Response> = new Set();

function broadcastSSE03(data: any) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients03) {
    client.write(payload);
  }
}

// ── GET /api/agent03/state ──────────────────────────────────────────────────
app.get('/api/agent03/state', async (_req: Request, res: Response) => {
  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }

    const stage = await stateManager.get('stages.03-test-case-reviewer');
    const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
    const testCases = await stateManager.getPipelineArtifact('testCases');
    let reviewedTestCases = await stateManager.getPipelineArtifact('reviewedTestCases');

    // Always compute live informational advisory based on current approved test cases from Agent 02
    const informationalInsights = computeRequirementMappingInsights(requirements, testCases);

    if (reviewedTestCases) {
      reviewedTestCases.informationalInsights = informationalInsights;
      reviewedTestCases.unselectedTestCases = informationalInsights.unselectedTestCases;
    }

    res.json({
      stage,
      requirements,
      testCases,
      reviewedTestCases,
      informationalInsights,
      running: !!activeProcess03
    });
  } catch (err: any) {
    logger.error('Error fetching Agent 03 state', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent03/run ───────────────────────────────────────────────────
app.post('/api/agent03/run', async (req: Request, res: Response) => {
  if (activeProcess03) {
    logger.info('Killing existing Agent 03 process to start a new run');
    activeProcess03.removeAllListeners('close');
    activeProcess03.kill('SIGKILL');
    activeProcess03 = null;
  }

  let projectName = (req.body?.projectName as string || '').trim();
  if (!projectName) {
    try {
      const stateDb = stateManager.getDatabase();
      const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
      if (latestRun?.project_id) projectName = latestRun.project_id;
    } catch (_) {}
  }
  projectName = projectName || 'ARIA Project';

  try {
    await stateManager.initialize(projectName);
    await memoryEngine.initialize(projectName);
    await stateManager.markStageRunning('03-test-case-reviewer');
  } catch (_) { /* non-fatal */ }

  const args = [
    '-r', 'ts-node/register',
    path.join(FRAMEWORK_DIR, 'agents', '03-test-case-reviewer', 'agent.ts'),
    `--project=${projectName}`
  ];

  logger.info('Spawning Agent 03', { project: projectName, args: args.join(' ') });
  activeProcess03 = spawn(process.execPath, args, {
    cwd: FRAMEWORK_DIR,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  activeProcess03.stdout?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line: string) => {
      broadcastSSE03({ type: 'log', level: 'info', message: line });
    });
  });

  activeProcess03.stderr?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line: string) => {
      broadcastSSE03({ type: 'log', level: 'error', message: line });
    });
  });

  activeProcess03.on('close', (code: number) => {
    logger.info('Agent 03 process exited', { code });
    activeProcess03 = null;
    broadcastSSE03({ type: 'exit', code });
  });

  res.json({ ok: true, message: 'Agent 03 started' });
});

// ── GET /api/agent03/logs ───────────────────────────────────────────────────
app.get('/api/agent03/logs', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients03.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  req.on('close', () => {
    sseClients03.delete(res);
  });
});

// ── Approvals for Agent 03 ──────────────────────────────────────────────────
app.post('/api/agent03/approve', handleApproval('03-test-case-reviewer', 'approve'));
app.post('/api/agent03/reject',  handleApproval('03-test-case-reviewer', 'reject'));

// ── POST /api/agent03/chat ──────────────────────────────────────────────────
app.post('/api/agent03/chat', async (req: Request, res: Response) => {
  const { message, history = [] } = req.body as {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const reviewedReport = await stateManager.getPipelineArtifact('reviewedTestCases');
    const testCases = await stateManager.getPipelineArtifact('testCases');

    const systemPrompt = [
      'You are ARIA, an AI Test Case Quality Reviewer and QA Architect.',
      'The user wants to verify your review findings, quality score breakdown, coverage matrix, and recommendations.',
      'Answer questions accurately based on the review results artifact and the original test cases.',
      'If a detail is not present in the review report, state that clearly — do NOT invent facts.',
      'Be concise, analytical, and structured in your explanations.',
      '',
      '=== REVIEW REPORT SUMMARY ===',
      reviewedReport ? JSON.stringify({
        qualityScore: reviewedReport.qualityScore,
        decision: reviewedReport.reviewDecision,
        approvedCount: reviewedReport.approvedCount,
        rejectedCount: reviewedReport.rejectedCount,
        rewrittenCount: reviewedReport.rewrittenCount,
        duplicatesRemoved: reviewedReport.duplicatesRemoved,
        recommendations: reviewedReport.recommendations,
        blockers: reviewedReport.blockers,
        annotationsSample: (reviewedReport.reviewAnnotations || []).slice(0, 20)
      }, null, 2) : '(No review report available yet)',
      '',
      '=== INPUT TEST CASES SUMMARY ===',
      testCases?.zephyrExport ? `Total Generated Test Cases: ${testCases.zephyrExport.totalTestCases}` : '(No test cases available)'
    ].join('\n');

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message }
    ];

    const reply = await llmClient.chat(messages, {
      model: process.env.LITELLM_MODEL || 'gemini/gemini-2.5-flash',
      temperature: 0.2,
      maxTokens: 1000
    });

    res.json({ reply });
  } catch (err: any) {
    logger.error('Agent 03 chat failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── /api/agent03/testcase (Human Override) and /api/agent03/clarify ─────────
registerAgent03ReviewRoutes(app, logger);

// ── Agent 04 (Test Data Generator) Routes ───────────────────────────────────

let activeProcess04: ChildProcess | null = null;
const sseClients04: Set<Response> = new Set();
const FIXTURES_PATH = path.join(FRAMEWORK_DIR, 'tests', 'fixtures', 'test-data.json');

function broadcastSSE04(data: any) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients04) {
    client.write(payload);
  }
}

// ── GET /api/agent04/state ──────────────────────────────────────────────────
app.get('/api/agent04/state', async (_req: Request, res: Response) => {
  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }

    const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
    // Stale manifests (another review or an earlier run) are withheld so they cannot be shown or approved
    const { stage, reviewedTestCases, testData, stored, freshness } = await loadCurrentTestData(stateManager);

    let flatTestData: Record<string, any> = {};
    if (testData && fs.existsSync(FIXTURES_PATH)) {
      try {
        flatTestData = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf-8'));
      } catch (_) {}
    }
    if (Object.keys(flatTestData).length === 0 && testData) {
      try {
        flatTestData = syncFixturesFileFromTestData(testData, undefined, FIXTURES_PATH);
      } catch (_) {}
    }

    res.json({
      stage,
      requirements,
      reviewedTestCases,
      testData,
      testDataStale: stored?.manifest && !freshness.current ? freshness.reason : null,
      flatTestData,
      running: !!activeProcess04
    });
  } catch (err: any) {
    logger.error('Error fetching Agent 04 state', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent04/run ───────────────────────────────────────────────────
app.post('/api/agent04/run', async (req: Request, res: Response) => {
  if (activeProcess04) {
    logger.info('Killing existing Agent 04 process to start a new run');
    activeProcess04.removeAllListeners('close');
    activeProcess04.kill('SIGKILL');
    activeProcess04 = null;
  }

  let projectName = (req.body?.projectName as string || '').trim();
  if (!projectName) {
    try {
      const stateDb = stateManager.getDatabase();
      const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
      if (latestRun?.project_id) projectName = latestRun.project_id;
    } catch (_) {}
  }
  projectName = projectName || 'ARIA Project';

  try {
    await stateManager.initialize(projectName);
    await memoryEngine.initialize(projectName);
    await stateManager.markStageRunning('04-test-data-generator');
  } catch (_) { /* non-fatal */ }

  const args = [
    '-r', 'ts-node/register',
    path.join(FRAMEWORK_DIR, 'agents', '04-test-data-generator', 'agent.ts'),
    `--project=${projectName}`
  ];

  logger.info('Spawning Agent 04', { project: projectName, args: args.join(' ') });
  activeProcess04 = spawn(process.execPath, args, {
    cwd: FRAMEWORK_DIR,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  activeProcess04.stdout?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line: string) =>
      broadcastSSE04({ type: 'log', level: 'info', message: line }),
    );
  });

  activeProcess04.stderr?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line: string) =>
      broadcastSSE04({ type: 'log', level: 'error', message: line }),
    );
  });

  activeProcess04.on('close', (code: number) => {
    logger.info('Agent 04 process exited', { code });
    activeProcess04 = null;
    broadcastSSE04({ type: 'exit', code });
  });

  res.json({ ok: true, message: 'Agent 04 started' });
});

// ── GET /api/agent04/logs ───────────────────────────────────────────────────
app.get('/api/agent04/logs', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients04.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  req.on('close', () => {
    sseClients04.delete(res);
  });
});

// ── Approvals for Agent 04 ──────────────────────────────────────────────────
app.post('/api/agent04/approve', async (req: Request, res: Response) => {
  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }
    const { testData, freshness } = await loadCurrentTestData(stateManager);
    if (!testData) {
      return res.status(409).json({ error: `Cannot approve Agent 04: ${freshness.reason} Run Agent 04 first.` });
    }
    // Only sync the fixture — never copy the artifact into the current run (that is how stale data spread)
    syncFixturesFileFromTestData(testData, undefined, FIXTURES_PATH);
    logger.info('Synchronized fixtures to disk on Agent 04 approval', { fixturesPath: FIXTURES_PATH });
  } catch (err: any) {
    logger.error('Agent 04 approval pre-check failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
  return handleApproval('04-test-data-generator', 'approve')(req, res);
});
app.post('/api/agent04/reject',  handleApproval('04-test-data-generator', 'reject'));

// ── POST /api/agent04/chat ──────────────────────────────────────────────────
app.post('/api/agent04/chat', async (req: Request, res: Response) => {
  const { message, history = [] } = req.body as {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const testDataOutput = await stateManager.getPipelineArtifact('testData');
    const reviewedReport = await stateManager.getPipelineArtifact('reviewedTestCases');

    const systemPrompt = [
      'You are ARIA, an AI Test Data Architect and Fixture Engineer.',
      'The user wants to inspect generated test data, boundary test vectors, environment configurations, and Playwright fixture mapping.',
      'Answer questions accurately based on the testData artifact and the reviewed test cases.',
      'If a detail is not present in the manifest, state that clearly — do NOT invent facts.',
      'Be concise, analytical, and structured in your explanations.',
      '',
      '=== TEST DATA MANIFEST SUMMARY ===',
      testDataOutput ? JSON.stringify({
        summary: testDataOutput.summary,
        approvedCount: testDataOutput.manifest?.approvedCount,
        excludedCount: testDataOutput.manifest?.excludedCount,
        resolvedCount: testDataOutput.manifest?.resolvedCount,
        unresolvedCount: testDataOutput.manifest?.unresolvedCount,
        sensitiveRefsCount: testDataOutput.manifest?.sensitiveDataVault?.refs?.length,
        runtimeBindings: testDataOutput.manifest?.runtimeBindings,
        apiPayloadEndpoints: Object.keys(testDataOutput.manifest?.apiPayloadLibrary || {})
      }, null, 2) : '(No test data available yet)',
      '',
      '=== APPROVED TEST CASES INPUT ===',
      reviewedReport?.approvedCount ? `Approved test cases: ${reviewedReport.approvedCount}` : '(No reviewed cases found)'
    ].join('\n');

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message }
    ];

    const reply = await llmClient.chat(messages, {
      model: process.env.LITELLM_MODEL || 'gemini/gemini-2.5-flash',
      temperature: 0.2,
      maxTokens: 1000
    });

    res.json({ reply });
  } catch (err: any) {
    logger.error('Agent 04 chat failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── PUT / POST /api/agent04/data (Human Test Data Override) ─────────────────
registerAgent04DataRoutes(app, logger, FIXTURES_PATH);

// ── Agents 06-11 ────────────────────────────────────────────────────────────
// Registrars rather than inline routes: each owns its own runner, SSE stream and approval proxy,
// so mounting them here costs one line each instead of hundreds of copy-pasted ones.
registerAgent06Routes(app, logger);
registerAgent07Routes(app, logger);
registerAgent08Routes(app, logger);
registerAgent09Routes(app, logger);
registerAgent10Routes(app, logger);
registerAgent11Routes(app, logger);

// ── Agent 05 (Playwright Script Generator) Routes ───────────────────────────

const HELPERS_DIR_05 = path.join(FRAMEWORK_DIR, 'tests', 'helpers');
const ALLOWED_FILE_ROOTS_05 = ['specs', 'pages', 'k6', 'helpers', 'projects'].map((dir) => path.join(FRAMEWORK_DIR, 'tests', dir));

/** Generated-test folders of the active project (legacy global folders when no project is active). */
function activeGeneratedDirs05() {
  const slug = readActiveProjectSlug();
  if (!slug) {
    return {
      specs: path.join(FRAMEWORK_DIR, 'tests', 'specs'), pages: path.join(FRAMEWORK_DIR, 'tests', 'pages'), k6: path.join(FRAMEWORK_DIR, 'tests', 'k6'), pageMaps: null as string | null,
    };
  }
  const paths = projectPaths(slug);
  return {
    specs: paths.specsDir, pages: paths.pagesDir, k6: paths.k6Dir, pageMaps: paths.pageMapsDir,
  };
}

function isAllowedScriptPath05(targetPath: string): boolean {
  return ALLOWED_FILE_ROOTS_05.some((root) => targetPath === root || targetPath.startsWith(`${root}${path.sep}`));
}

function scanDirectoryFiles05(dir: string, extFilter?: string[]) {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => !extFilter || extFilter.some(ext => f.endsWith(ext)))
      .map(f => {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        return {
          name: f,
          relativePath: path.relative(FRAMEWORK_DIR, full).replace(/\\/g, '/'),
          size: st.size,
          mtime: st.mtime.toISOString(),
        };
      });
  } catch {
    return [];
  }
}

let activeProcess05: ChildProcess | null = null;
const sseClients05: Set<Response> = new Set();

function broadcastSSE05(data: any) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients05) {
    client.write(payload);
  }
}

// ── GET /api/agent05/state ──────────────────────────────────────────────────
app.get('/api/agent05/state', async (_req: Request, res: Response) => {
  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }

    const stage = await stateManager.get('stages.05-playwright-script-generator');
    const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
    const reviewedTestCases = await stateManager.getPipelineArtifact('reviewedTestCases');
    const testData = await stateManager.getPipelineArtifact('testData');
    const playwrightScripts = await stateManager.getPipelineArtifact('playwrightScripts');

    const dirs05 = activeGeneratedDirs05();
    const diskFiles = {
      specFiles: scanDirectoryFiles05(dirs05.specs, ['.spec.ts']),
      pomFiles: scanDirectoryFiles05(dirs05.pages, ['.ts']),
      k6Files: scanDirectoryFiles05(dirs05.k6, ['.js']),
      helperFiles: scanDirectoryFiles05(HELPERS_DIR_05, ['.ts']),
      pageMapFiles: dirs05.pageMaps ? scanDirectoryFiles05(dirs05.pageMaps, ['.json']) : [],
    };

    res.json({
      stage,
      requirements,
      reviewedTestCases,
      testData,
      playwrightScripts,
      diskFiles,
      running: !!activeProcess05
    });
  } catch (err: any) {
    logger.error('Error fetching Agent 05 state', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent05/run ───────────────────────────────────────────────────
app.post('/api/agent05/run', async (req: Request, res: Response) => {
  if (activeProcess05) {
    logger.info('Killing existing Agent 05 process to start a new run');
    activeProcess05.removeAllListeners('close');
    activeProcess05.kill('SIGKILL');
    activeProcess05 = null;
  }

  let projectName = (req.body?.projectName as string || '').trim();
  if (!projectName) {
    try {
      const stateDb = stateManager.getDatabase();
      const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
      if (latestRun?.project_id) projectName = latestRun.project_id;
    } catch (_) {}
  }
  projectName = projectName || 'ARIA Project';

  try {
    await stateManager.initialize(projectName);
    await memoryEngine.initialize(projectName);
    await stateManager.markStageRunning('05-playwright-script-generator');
  } catch (_) { /* non-fatal */ }

  const args = [
    '-r', 'ts-node/register',
    path.join(FRAMEWORK_DIR, 'agents', '05-playwright-script-generator', 'agent.ts'),
    `--project=${projectName}`
  ];

  logger.info('Spawning Agent 05', { project: projectName, args: args.join(' ') });
  activeProcess05 = spawn(process.execPath, args, {
    cwd: FRAMEWORK_DIR,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  activeProcess05.stdout?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line: string) =>
      broadcastSSE05({ type: 'log', level: 'info', message: line }),
    );
  });

  activeProcess05.stderr?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line: string) =>
      broadcastSSE05({ type: 'log', level: 'error', message: line }),
    );
  });

  activeProcess05.on('close', (code: number) => {
    logger.info('Agent 05 process exited', { code });
    activeProcess05 = null;
    broadcastSSE05({ type: 'exit', code });
  });

  res.json({ ok: true, message: 'Agent 05 started' });
});

// ── GET /api/agent05/logs ───────────────────────────────────────────────────
app.get('/api/agent05/logs', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients05.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  req.on('close', () => {
    sseClients05.delete(res);
  });
});

// ── GET /api/agent05/file (Read Code Content) ─────────────────────────────────
app.get('/api/agent05/file', (req: Request, res: Response) => {
  const relPath = (req.query.path as string || '').trim();
  if (!relPath) {
    return res.status(400).json({ error: 'path query parameter is required' });
  }

  const normalized = path.normalize(relPath).replace(/^[/\\]+/, '');
  const targetPath = path.resolve(FRAMEWORK_DIR, normalized);

  if (!isAllowedScriptPath05(targetPath)) {
    return res.status(403).json({ error: 'Access denied. File must be within tests/ directory.' });
  }

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return res.status(404).json({ error: `File not found: ${relPath}` });
  }

  try {
    const content = fs.readFileSync(targetPath, 'utf-8');
    const st = fs.statSync(targetPath);
    res.json({
      ok: true,
      path: relPath,
      content,
      size: st.size,
      mtime: st.mtime.toISOString(),
    });
  } catch (err: any) {
    logger.error('Error reading script file', { path: relPath, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── PUT / POST /api/agent05/file (Save Code Content) ─────────────────────────
const saveFileHandler05 = async (req: Request, res: Response) => {
  const { path: relPath, content } = req.body || {};
  if (!relPath || typeof content !== 'string') {
    return res.status(400).json({ error: 'path and content string are required' });
  }

  const normalized = path.normalize(relPath).replace(/^[/\\]+/, '');
  const targetPath = path.resolve(FRAMEWORK_DIR, normalized);

  if (!isAllowedScriptPath05(targetPath)) {
    return res.status(403).json({ error: 'Access denied. File must be within tests/ directory.' });
  }

  try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');

    logger.info('Script/POM file saved via Agent 05 UI', { path: relPath, size: content.length });
    return res.json({ ok: true, path: relPath, size: content.length });
  } catch (err: any) {
    logger.error('Error saving script file', { path: relPath, error: err.message });
    return res.status(500).json({ error: err.message });
  }
};

app.put('/api/agent05/file', saveFileHandler05);
app.post('/api/agent05/file', saveFileHandler05);

// ── Approvals for Agent 05 ──────────────────────────────────────────────────
app.post('/api/agent05/approve', handleApproval('05-playwright-script-generator', 'approve'));
app.post('/api/agent05/reject',  handleApproval('05-playwright-script-generator', 'reject'));

// ── POST /api/agent05/chat ──────────────────────────────────────────────────
app.post('/api/agent05/chat', async (req: Request, res: Response) => {
  const { message, history = [] } = req.body as {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const scriptsOutput = await stateManager.getPipelineArtifact('playwrightScripts');
    const reviewedReport = await stateManager.getPipelineArtifact('reviewedTestCases');

    const systemPrompt = [
      'You are ARIA, a Senior Playwright Test Automation Architect.',
      'The user wants to inspect generated Playwright specs (.spec.ts), Page Object Models (Page.ts), API request fixtures, and K6 scripts.',
      'Answer questions accurately based on the playwrightScripts artifact and framework standards (centralized test-data.json, accessible locators, BasePage inheritance, TLS negotiation details).',
      'If a detail is not present in the generated code or artifact, state that clearly — do NOT invent facts.',
      'Be concise, analytical, and provide code examples when helpful.',
      '',
      '=== SCRIPT GENERATION SUMMARY ===',
      scriptsOutput ? JSON.stringify({
        project: scriptsOutput.projectSlug,
        testCases: (scriptsOutput.testCases || []).map((r: any) => ({ tcKey: r.tcKey, status: r.status, missing: r.missing, reason: r.reason })),
        specFiles: (scriptsOutput.specFiles || []).map((f: string) => path.basename(f)),
        pomFiles: (scriptsOutput.pomFiles || []).map((f: string) => path.basename(f)),
        k6Files: (scriptsOutput.k6Files || []).map((f: string) => path.basename(f)),
        warnings: scriptsOutput.warnings || [],
      }, null, 2) : '(No scripts generated yet)',
      '',
      '=== APPROVED TEST CASES INPUT ===',
      reviewedReport?.approvedCount ? `Approved test cases: ${reviewedReport.approvedCount}` : '(No reviewed cases found)'
    ].join('\n');

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message }
    ];

    const reply = await llmClient.chat(messages, {
      model: process.env.LITELLM_MODEL || 'gemini/gemini-2.5-flash',
      temperature: 0.2,
      maxTokens: 1000
    });

    res.json({ reply });
  } catch (err: any) {
    logger.error('Agent 05 chat failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  🤖 ARIA Agent UI Server                     ║`);
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  logger.info(`Agent UI server started`, { port: PORT });
});

// Also listen on port 3001, 3002, 3003, and 3004 if available
const ALT_PORT = parseInt(process.env.AGENT02_UI_PORT || '3001', 10);
if (ALT_PORT !== PORT) {
  try {
    const altServer = app.listen(ALT_PORT, () => {
      logger.info(`Agent UI also listening on secondary port ${ALT_PORT} (http://localhost:${ALT_PORT}/agent02.html)`);
    });
    altServer.on('error', (err: any) => {
      logger.info(`Secondary port ${ALT_PORT} not bound: ${err.message}`);
    });
  } catch (_) {}
}

const AGENT03_PORT = parseInt(process.env.AGENT03_UI_PORT || '3002', 10);
if (AGENT03_PORT !== PORT && AGENT03_PORT !== ALT_PORT) {
  try {
    const port03Server = app.listen(AGENT03_PORT, () => {
      logger.info(`Agent UI also listening on Agent 03 port ${AGENT03_PORT} (http://localhost:${AGENT03_PORT}/agent03.html)`);
    });
    port03Server.on('error', (err: any) => {
      logger.info(`Agent 03 port ${AGENT03_PORT} not bound: ${err.message}`);
    });
  } catch (_) {}
}

const AGENT04_PORT = parseInt(process.env.AGENT04_UI_PORT || '3003', 10);
if (AGENT04_PORT !== PORT && AGENT04_PORT !== ALT_PORT && AGENT04_PORT !== AGENT03_PORT) {
  try {
    const port04Server = app.listen(AGENT04_PORT, () => {
      logger.info(`Agent UI also listening on Agent 04 port ${AGENT04_PORT} (http://localhost:${AGENT04_PORT}/agent04.html)`);
    });
    port04Server.on('error', (err: any) => {
      logger.info(`Agent 04 port ${AGENT04_PORT} not bound: ${err.message}`);
    });
  } catch (_) {}
}

const AGENT05_PORT = parseInt(process.env.AGENT05_UI_PORT || '3004', 10);
if (AGENT05_PORT !== PORT && AGENT05_PORT !== ALT_PORT && AGENT05_PORT !== AGENT03_PORT && AGENT05_PORT !== AGENT04_PORT) {
  try {
    const port05Server = app.listen(AGENT05_PORT, () => {
      logger.info(`Agent UI also listening on Agent 05 port ${AGENT05_PORT} (http://localhost:${AGENT05_PORT}/agent05.html)`);
    });
    port05Server.on('error', (err: any) => {
      logger.info(`Agent 05 port ${AGENT05_PORT} not bound: ${err.message}`);
    });
  } catch (_) {}
}

/**
 * Binds the combined app to one more agent port, so every page and API is reachable from it.
 * @param {number} port
 * @param {string} label - Page the port is conventionally associated with
 */
function bindAlternatePort(port: number, label: string): void {
  const taken = [PORT, ALT_PORT, AGENT03_PORT, AGENT04_PORT, AGENT05_PORT];
  if (taken.includes(port)) return;
  try {
    const server = app.listen(port, () => {
      logger.info(`Agent UI also listening on port ${port} (http://localhost:${port}/${label})`);
    });
    server.on('error', (err: any) => {
      logger.info(`Port ${port} not bound: ${err.message}`);
    });
  } catch (_) { /* a busy port is not fatal — the primary listener still serves every page */ }
}

bindAlternatePort(parseInt(process.env.AGENT06_UI_PORT || '3005', 10), 'agent06.html');
bindAlternatePort(parseInt(process.env.AGENT07_UI_PORT || '3006', 10), 'agent07.html');
bindAlternatePort(parseInt(process.env.AGENT08_UI_PORT || '3007', 10), 'agent08.html');
bindAlternatePort(parseInt(process.env.AGENT09_UI_PORT || '3008', 10), 'agent09.html');
bindAlternatePort(parseInt(process.env.AGENT10_UI_PORT || '3009', 10), 'agent10.html');
bindAlternatePort(parseInt(process.env.AGENT11_UI_PORT || '3010', 10), 'agent11.html');
