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

import { stateManager } from '../core/state-manager/StateManager';
import { memoryEngine } from '../core/project-memory/MemoryEngine';
import { llmClient } from '../core/llm/LLMClient';
import { Logger } from '../core/logger/Logger';
import { syncFeatureFiles } from '../agents/02-test-case-generator/utils';
import { isTestCaseSelected, setTestCaseSelected } from '../core/types';
import { ensureFixturesFileSynced, syncFixturesFileFromTestData } from '../core/state-manager/FixtureSync';

require('dotenv').config();

const logger = new Logger('Agent01UI');
const app = express();
const PORT = parseInt(process.env.UI_PORT || '3000', 10);
const APPROVAL_PORT = parseInt(process.env.APPROVAL_WEBHOOK_PORT || '8081', 10);
const FRAMEWORK_DIR = path.resolve(__dirname, '..');

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
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
  const uploadedFile = (req as any).file as Express.Multer.File | undefined;

  let requirementsArg: string;
  let formatArg: string;

  if (jiraId) {
    requirementsArg = jiraId;
    formatArg       = 'jira';
  } else if (uploadedFile) {
    // Append the real extension so the agent detects the file type correctly
    const ext       = path.extname(uploadedFile.originalname) || '.md';
    const finalPath = uploadedFile.path + ext;
    fs.renameSync(uploadedFile.path, finalPath);
    requirementsArg = finalPath;
    formatArg       = 'file';
  } else {
    return res.status(400).json({ error: 'Provide either a file upload (.md / .txt) or a Jira story ID.' });
  }

  // Use the raw project name as the state-DB key — must be identical to
  // what the agent passes to stateManager.initialize() via --project=<name>
  const projectId = projectName;

  // Initialise shared services with a clean run for the project
  try {
    await stateManager.startNewRun(projectId);
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
      `--format=${formatArg}`],
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
 * Persists user answers to ambiguity questions into the MemoryEngine's
 * resolvedClarifications store. The next agent run reads them automatically
 * via _autoResolveClarifications().
 */
app.post('/api/agent01/clarify', async (req: Request, res: Response) => {
  const { answers } = req.body as {
    answers: Array<{ id: string; question: string; answer: string }>;
  };

  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'answers array is required' });
  }

  try {
    for (const { question, answer } of answers) {
      if (question && answer) {
        await memoryEngine.recordClarification(question.trim(), answer.trim(), '01-requirement-analyzer');
      }
    }
    logger.info('Clarification answers saved', { count: answers.length });
    res.json({ ok: true, saved: answers.length });
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

// ── PUT / POST /api/agent03/testcase (Human Override) ───────────────────────
const updateReviewedTestCaseHandler = async (req: Request, res: Response) => {
  const { key, reviewStatus, name, objective, precondition, testSteps, reviewNotes } = req.body || {};
  if (!key) {
    return res.status(400).json({ error: 'Test case key is required.' });
  }

  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }

    const reviewedOutput = await stateManager.getPipelineArtifact('reviewedTestCases');
    if (!reviewedOutput?.reviewedZephyrExport?.testCases) {
      return res.status(404).json({ error: 'No reviewed test cases artifact found in state.' });
    }

    const allReviewedTCs = reviewedOutput.reviewedZephyrExport.testCases;
    const targetTC = allReviewedTCs.find((tc: any) => tc.key === key);
    if (!targetTC) {
      return res.status(404).json({ error: `Reviewed test case ${key} not found.` });
    }

    if (typeof reviewStatus === 'string' && reviewStatus.trim()) {
      targetTC.reviewStatus = reviewStatus.trim().toUpperCase();
    }
    if (typeof name === 'string' && name.trim()) targetTC.name = name.trim();
    if (typeof objective === 'string') targetTC.objective = objective.trim();
    if (typeof precondition === 'string') targetTC.precondition = precondition.trim();
    if (Array.isArray(reviewNotes)) targetTC.reviewNotes = reviewNotes;
    if (Array.isArray(testSteps)) {
      targetTC.testSteps = testSteps.map((step: any) => ({
        keyword: step.keyword || undefined,
        description: (step.description || '').trim(),
        testData: (step.testData || '').trim(),
        expectedResult: (step.expectedResult || '').trim()
      }));
    }

    // Recompute approved / rejected / rewritten counts
    reviewedOutput.approvedCount = allReviewedTCs.filter((tc: any) => tc.reviewStatus !== 'REJECTED').length;
    reviewedOutput.rejectedCount = allReviewedTCs.filter((tc: any) => tc.reviewStatus === 'REJECTED').length;
    reviewedOutput.rewrittenCount = allReviewedTCs.filter((tc: any) => (tc.rewrittenSteps || 0) > 0).length;

    await stateManager.setPipelineArtifact('reviewedTestCases', reviewedOutput);
    try {
      const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
      syncFeatureFiles(requirements, allReviewedTCs, logger);
    } catch (_) {}
    logger.info(`Reviewed test case ${key} updated via Agent 03 UI override`, { reviewStatus: targetTC.reviewStatus });
    return res.json({ ok: true, testCase: targetTC });
  } catch (err: any) {
    logger.error('Error overriding reviewed test case', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
};

app.put('/api/agent03/testcase', updateReviewedTestCaseHandler);
app.post('/api/agent03/testcase', updateReviewedTestCaseHandler);

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

    const stage = await stateManager.get('stages.04-test-data-generator');
    const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
    const reviewedTestCases = await stateManager.getPipelineArtifact('reviewedTestCases');
    const testData = await stateManager.getPipelineArtifact('testData');

    let flatTestData: Record<string, any> = {};
    if (fs.existsSync(FIXTURES_PATH)) {
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
    const testDataOutput = await stateManager.getPipelineArtifact('testData');
    if (testDataOutput) {
      syncFixturesFileFromTestData(testDataOutput, undefined, FIXTURES_PATH);
      await stateManager.setPipelineArtifact('testData', testDataOutput);
      logger.info('Synchronized fixtures to disk on Agent 04 approval', { fixturesPath: FIXTURES_PATH });
    }
  } catch (err: any) {
    logger.warn('Failed to sync fixtures during Agent 04 approval', { error: err.message });
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
        globalFixtures: testDataOutput.manifest?.globalFixtures,
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
const updateTestDataHandler04 = async (req: Request, res: Response) => {
  const { type, tcKey, inputs, globalFixtures, flatTestData } = req.body || {};

  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }

    const testDataOutput = await stateManager.getPipelineArtifact('testData');
    if (!testDataOutput?.manifest) {
      return res.status(404).json({ error: 'No testData artifact found in state.' });
    }

    const manifest = testDataOutput.manifest;

    let diskFlat: Record<string, any> = {};
    if (fs.existsSync(FIXTURES_PATH)) {
      try {
        diskFlat = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf-8'));
      } catch (_) {}
    }

    if (type === 'full_flat' && flatTestData && typeof flatTestData === 'object') {
      diskFlat = { ...flatTestData };
      if (flatTestData.baseURL) {
        if (!manifest.globalCtx) manifest.globalCtx = {};
        manifest.globalCtx.baseURL = flatTestData.baseURL;
      }
      if (flatTestData.standardUsername && manifest.globalFixtures?.adminCredentials) {
        manifest.globalFixtures.adminCredentials.username = flatTestData.standardUsername;
      }
      if (flatTestData.password && manifest.globalFixtures?.adminCredentials) {
        manifest.globalFixtures.adminCredentials.password = flatTestData.password;
      }
    } else if (type === 'global' && globalFixtures && typeof globalFixtures === 'object') {
      manifest.globalFixtures = { ...manifest.globalFixtures, ...globalFixtures };
      if (globalFixtures.baseURL) diskFlat.baseURL = globalFixtures.baseURL;
      if (globalFixtures.adminCredentials?.username) diskFlat.standardUsername = globalFixtures.adminCredentials.username;
      if (globalFixtures.adminCredentials?.password) diskFlat.password = globalFixtures.adminCredentials.password;
    } else if (tcKey && inputs && typeof inputs === 'object') {
      if (!manifest.perTCData) manifest.perTCData = {};
      if (!manifest.perTCData[tcKey]) manifest.perTCData[tcKey] = { inputs: {} };
      
      const tcEntry = manifest.perTCData[tcKey];
      for (const [key, item] of Object.entries(inputs)) {
        const val = typeof item === 'object' && item !== null && 'value' in item ? (item as any).value : item;
        const cleanKey = key.replace(/^\{\{|\}\}$/g, '');
        const phKey = key.startsWith('{{') ? key : `{{${key}}}`;
        
        tcEntry.inputs[phKey] = {
          placeholder: phKey,
          value: val,
          type: typeof item === 'object' && (item as any).type ? (item as any).type : (typeof val),
          source: 'user_override',
          sensitive: false,
        };

        const flatKey = `${tcKey.replace(/[^a-zA-Z0-9]/g, '')}_${cleanKey}`;
        diskFlat[flatKey] = val;
      }
    } else {
      return res.status(400).json({ error: 'Invalid update payload. Must provide type (full_flat, global, or per-TC inputs).' });
    }

    await stateManager.setPipelineArtifact('testData', testDataOutput);

    const fixturesDir = path.dirname(FIXTURES_PATH);
    if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(FIXTURES_PATH, JSON.stringify(diskFlat, null, 2), 'utf-8');

    logger.info('Test data updated and synced to disk via Agent 04 UI', {
      type: type || 'single_tc',
      tcKey,
      fixturesPath: FIXTURES_PATH,
      keysCount: Object.keys(diskFlat).length
    });

    return res.json({ ok: true, manifest, flatTestData: diskFlat });
  } catch (err: any) {
    logger.error('Error updating test data', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
};

app.put('/api/agent04/data', updateTestDataHandler04);
app.post('/api/agent04/data', updateTestDataHandler04);

// ── Agent 05 (Playwright Script Generator) Routes ───────────────────────────

const SPECS_DIR_05 = path.join(FRAMEWORK_DIR, 'tests', 'specs');
const PAGES_DIR_05 = path.join(FRAMEWORK_DIR, 'tests', 'pages');
const K6_DIR_05 = path.join(FRAMEWORK_DIR, 'tests', 'k6');
const HELPERS_DIR_05 = path.join(FRAMEWORK_DIR, 'tests', 'helpers');

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

    if (!fs.existsSync(FIXTURES_PATH)) {
      try {
        await ensureFixturesFileSynced(stateManager, FIXTURES_PATH);
      } catch (_) {}
    }

    const diskFiles = {
      specFiles: scanDirectoryFiles05(SPECS_DIR_05, ['.spec.ts']),
      pomFiles: scanDirectoryFiles05(PAGES_DIR_05, ['.ts']),
      k6Files: scanDirectoryFiles05(K6_DIR_05, ['.js']),
      helperFiles: scanDirectoryFiles05(HELPERS_DIR_05, ['.ts']),
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

  if (!targetPath.startsWith(FRAMEWORK_DIR) || (!targetPath.includes(path.join('tests', 'specs')) && !targetPath.includes(path.join('tests', 'pages')) && !targetPath.includes(path.join('tests', 'k6')) && !targetPath.includes(path.join('tests', 'helpers')))) {
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

  if (!targetPath.startsWith(FRAMEWORK_DIR) || (!targetPath.includes(path.join('tests', 'specs')) && !targetPath.includes(path.join('tests', 'pages')) && !targetPath.includes(path.join('tests', 'k6')) && !targetPath.includes(path.join('tests', 'helpers')))) {
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
        totalFilesGenerated: scriptsOutput.totalFilesGenerated,
        approvedCount: scriptsOutput.approvedCount,
        excludedCount: scriptsOutput.excludedCount,
        specFiles: (scriptsOutput.specFiles || []).map((f: string) => path.basename(f)),
        pomFiles: (scriptsOutput.pomFiles || []).map((f: string) => path.basename(f)),
        k6Files: (scriptsOutput.k6Files || []).map((f: string) => path.basename(f)),
        featureCount: scriptsOutput.featureCount
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
