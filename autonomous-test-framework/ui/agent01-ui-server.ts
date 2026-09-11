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
      return res.json({ stage: null, report: null, running: !!activeProcess });
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
 * Proxies approve / reject decisions to the ApprovalGate webhook on port 8080.
 * This avoids a browser CORS issue (UI is on :3000, webhook is on :8080).
 */
function proxyToApprovalGate(action: 'approve' | 'reject') {
  return (req: Request, res: Response) => {
    const body    = JSON.stringify({ stageId: '01-requirement-analyzer', comment: req.body?.comment || '' });
    const options = {
      hostname: 'localhost',
      port:     APPROVAL_PORT,
      path:     `/${action}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => { data += chunk; });
      proxyRes.on('end', () => {
        try { res.status(proxyRes.statusCode || 200).json(JSON.parse(data)); }
        catch { res.status(proxyRes.statusCode || 200).send(data); }
      });
    });

    proxyReq.on('error', (err) => {
      logger.error(`Approval proxy error (${action})`, { error: err.message });
      res.status(502).json({ error: `Could not reach approval gate on port ${APPROVAL_PORT}. Is the agent still running?` });
    });

    proxyReq.write(body);
    proxyReq.end();
  };
}

app.post('/api/agent01/approve', proxyToApprovalGate('approve'));
app.post('/api/agent01/reject',  proxyToApprovalGate('reject'));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  🤖 ARIA Agent 01 UI                         ║`);
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  logger.info(`Agent 01 UI server started`, { port: PORT });
});
