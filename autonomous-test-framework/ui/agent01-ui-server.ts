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

  // Initialise shared services (they share the same SQLite DB with the agent)
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
          responded = true;
          try { res.status(proxyRes.statusCode || 200).json(JSON.parse(data)); }
          catch { res.status(proxyRes.statusCode || 200).send(data); }
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

app.get('/api/agent02/state', async (_req: Request, res: Response) => {
  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }
    const stage = await stateManager.get('stages.02-test-case-generator');
    const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
    const testCases = await stateManager.getPipelineArtifact('testCases');
    res.json({ stage, requirements, testCases, running: !!activeAgent02Process });
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

  const projectName = ((req.body?.projectName as string) || 'ARIA Project').trim();
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

app.post('/api/agent02/approve', async (req: Request, res: Response) => {
  const uncheckedTestCaseKeys = req.body?.uncheckedTestCaseKeys || [];
  try {
    const testCasesOutput = await stateManager.getPipelineArtifact('testCases');
    if (testCasesOutput?.zephyrExport?.testCases) {
      const allTCs = testCasesOutput.zephyrExport.testCases;
      for (const tc of allTCs) {
        if (uncheckedTestCaseKeys.includes(tc.key)) {
          tc.status = 'OBSOLETE';
          tc.isObsolete = true;
        }
      }
      const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
      syncFeatureFiles(requirements, allTCs, logger);
      const k6ScenarioIndex = allTCs
        .filter((tc: any) => tc.type === 'PERFORMANCE' && tc.performanceRef && tc.status !== 'OBSOLETE')
        .map((tc: any) => ({
          tcKey:          tc.key,
          scriptPath:     tc.performanceRef.k6ScriptPath,
          scenario:       tc.performanceRef.scenario,
          targetEndpoint: tc.performanceRef.targetEndpoint,
          featureId:      tc.traceabilityLinks.featureId,
          storyId:        tc.traceabilityLinks.userStoryId,
        }));
      testCasesOutput.k6ScenarioIndex = k6ScenarioIndex;
      await stateManager.setPipelineArtifact('testCases', testCasesOutput);
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
      targetTC.testSteps = testSteps.map((step: any, idx: number) => ({
        index: idx + 1,
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
    const reviewedTestCases = await stateManager.getPipelineArtifact('reviewedTestCases');
    res.json({
      stage,
      requirements,
      testCases,
      reviewedTestCases,
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
      targetTC.testSteps = testSteps.map((step: any, idx: number) => ({
        index: idx + 1,
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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  🤖 ARIA Agent UI Server                     ║`);
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  logger.info(`Agent UI server started`, { port: PORT });
});

// Also listen on port 3001 and 3002 if available
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
