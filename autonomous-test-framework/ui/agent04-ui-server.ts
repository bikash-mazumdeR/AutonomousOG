import express, { Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { stateManager } from '../core/state-manager/StateManager';
import { registerPipelineRoutes } from './pipelineRoutes';
import { registerPromptTraceRoutes } from './promptTraceRoutes';
import { ensureFixturesFileSynced, syncFixturesFileFromTestData } from '../core/state-manager/FixtureSync';
import { loadCurrentTestData } from '../core/state-manager/TestDataFreshness';
import { llmClient } from '../core/llm/LLMClient';
import { memoryEngine } from '../core/project-memory/MemoryEngine';
import { Logger } from '../core/logger/Logger';
import { registerAgent04DataRoutes } from './agent04DataRoutes';
import path from 'path';
import fs from 'fs';
import * as http from 'http';

const app = express();
const PORT = parseInt(process.env.AGENT04_UI_PORT || '3003', 10);
const APPROVAL_PORT = parseInt(process.env.APPROVAL_WEBHOOK_PORT || '8081', 10);
const logger = new Logger('Agent04UI');

const FRAMEWORK_DIR = path.resolve(__dirname, '..');
const FIXTURES_PATH = path.join(FRAMEWORK_DIR, 'tests', 'fixtures', 'test-data.json');

app.use(express.json());
registerPipelineRoutes(app);
registerPromptTraceRoutes(app, ['agent04']);
app.use(express.static(path.join(__dirname, 'static')));

// Redirect root to agent04.html
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'static', 'agent04.html'));
});

// ── Agent process management ──────────────────────────────────────────────────
let activeProcess: ChildProcess | null = null;
const sseClients: Set<Response> = new Set();

/** Broadcasts an SSE event to all connected clients. */
function broadcastSSE(data: any) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// ── GET /api/agent04/state ────────────────────────────────────────────────────
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
      running: !!activeProcess
    });
  } catch (err: any) {
    logger.error('Error fetching Agent 04 state', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent04/run ─────────────────────────────────────────────────────
app.post('/api/agent04/run', async (req: Request, res: Response) => {
  if (activeProcess) {
    logger.info('Killing existing Agent 04 process to start a new run');
    activeProcess.removeAllListeners('close');
    activeProcess.kill('SIGKILL');
    activeProcess = null;
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
  activeProcess = spawn(process.execPath, args, {
    cwd: FRAMEWORK_DIR,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  activeProcess.stdout?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line: string) =>
      broadcastSSE({ type: 'log', level: 'info', message: line }),
    );
  });

  activeProcess.stderr?.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line: string) =>
      broadcastSSE({ type: 'log', level: 'error', message: line }),
    );
  });

  activeProcess.on('close', (code: number) => {
    logger.info('Agent 04 process exited', { code });
    activeProcess = null;
    broadcastSSE({ type: 'exit', code });
  });

  res.json({ ok: true, message: 'Agent 04 started' });
});

// ── GET /api/agent04/logs ─────────────────────────────────────────────────────
app.get('/api/agent04/logs', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ── POST /api/agent04/approve / reject ────────────────────────────────────────
function handleApproval(stageId: string, action: 'approve' | 'reject') {
  return async (req: Request, res: Response) => {
    const comment = ((req.body?.comment as string) || `Approved via Agent UI`).trim();
    const isApproval = action === 'approve';
    // The approval gate rejects requests without a matching stageId ("stageId mismatch")
    const body = JSON.stringify({ stageId, comment });

    const options = {
      hostname: 'localhost',
      port: APPROVAL_PORT,
      path: `/${action}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 3000,
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

// ── POST /api/agent04/chat ────────────────────────────────────────────────────
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

// ── PUT / POST /api/agent04/data (Human Test Data Override) ───────────────────
registerAgent04DataRoutes(app, logger, FIXTURES_PATH);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  🤖 ARIA Agent 04 UI Server                  ║`);
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  logger.info(`Agent 04 UI server started`, { port: PORT });
});
