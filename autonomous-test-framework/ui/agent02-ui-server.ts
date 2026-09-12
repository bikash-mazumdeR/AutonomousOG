import express, { Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { stateManager } from '../core/state-manager/StateManager';
import { llmClient } from '../core/llm/LLMClient';
import { memoryEngine } from '../core/project-memory/MemoryEngine';
import { syncFeatureFiles } from '../agents/02-test-case-generator/utils';
import { Logger } from '../core/logger/Logger';
import path from 'path';
import * as http from 'http';

const app = express();
const PORT = parseInt(process.env.AGENT02_UI_PORT || '3001', 10);
const APPROVAL_PORT = parseInt(process.env.APPROVAL_WEBHOOK_PORT || '8081', 10);
const logger = new Logger('Agent02UI');

const FRAMEWORK_DIR = path.resolve(__dirname, '..');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

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

// ── GET /api/agent02/state ────────────────────────────────────────────────────
app.get('/api/agent02/state', async (_req: Request, res: Response) => {
  try {
    if (!(stateManager as any)._initialized) {
      try { await stateManager.initialize(); } catch (_) {}
    }
    
    const stage = await stateManager.get('stages.02-test-case-generator');
    const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
    const testCases = await stateManager.getPipelineArtifact('testCases');
    res.json({ stage, requirements, testCases, running: !!activeProcess });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent02/run ─────────────────────────────────────────────────────
app.post('/api/agent02/run', async (req: Request, res: Response) => {
  if (activeProcess) {
    logger.info('Killing existing agent process to start a new run');
    activeProcess.removeAllListeners('close');
    activeProcess.kill('SIGKILL');
    activeProcess = null;
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
  } catch (_) { /* non-fatal — agent will re-init */ }

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

  activeProcess.on('close', async (code) => {
    activeProcess = null;
    if (code === 0) {
      try {
        const testCases = await stateManager.getPipelineArtifact('testCases');
        const stageState = await stateManager.get('stages.02-test-case-generator');
        broadcastSSE({ type: 'complete', testCases, stageState });
        logger.info('Agent 02 process completed successfully');
      } catch {
        broadcastSSE({ type: 'complete', testCases: null, stageState: null });
      }
    } else {
      broadcastSSE({ type: 'error', message: `Agent process exited with code ${code}` });
      logger.error('Agent 02 process failed', { exitCode: code });
    }
  });

  res.json({ ok: true, project: projectName });
});

// ── GET /api/agent02/logs ─────────────────────────────────────────────────────
app.get('/api/agent02/logs', (req: Request, res: Response) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 20_000);
  sseClients.add(res);
  logger.info('SSE client connected', { total: sseClients.size });

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    logger.info('SSE client disconnected', { total: sseClients.size });
  });
});

// ── POST /api/agent02/chat ────────────────────────────────────────────────────
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
      { role: 'system'    as const, content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user'      as const, content: message.trim() },
    ];

    const response = await llmClient.chat('02-test-case-generator', {
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

// ── POST /api/agent02/approve ─────────────────────────────────────────────────
app.post('/api/agent02/approve', async (req: Request, res: Response) => {
  const uncheckedTestCaseKeys = req.body?.uncheckedTestCaseKeys || [];
  
  try {
    const testCasesOutput = await stateManager.getPipelineArtifact('testCases');
    if (testCasesOutput && testCasesOutput.zephyrExport && testCasesOutput.zephyrExport.testCases) {
      
      const allTCs = testCasesOutput.zephyrExport.testCases;
      
      // Mark unchecked TCs as OBSOLETE
      for (const tc of allTCs) {
        if (uncheckedTestCaseKeys.includes(tc.key)) {
          tc.status = 'OBSOLETE';
          tc.isObsolete = true;
        }
      }
      
      const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
      
      // Resync feature files (will add @obsolete to ignored tests)
      syncFeatureFiles(requirements, allTCs, logger);
      
      // Rewrite k6ScenarioIndex excluding obsolete ones
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
      
      // Save updated artifacts
      await stateManager.setPipelineArtifact('testCases', testCasesOutput);
    }
    
    // Attempt webhook proxy with direct StateManager fallback
    const comment = req.body?.comment || 'Approved via ARIA UI';
    const body = JSON.stringify({ stageId: '02-test-case-generator', comment });
    const options = {
      hostname: 'localhost',
      port:     APPROVAL_PORT,
      path:     `/approve`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout:  2500,
    };

    let responded = false;
    const fallbackDirect = async () => {
      if (responded) return;
      responded = true;
      try {
        await stateManager.markStageApproved('02-test-case-generator', comment);
        await memoryEngine.recordApprovalFeedback('02-test-case-generator', 'APPROVED', comment);
        logger.info('Stage 02-test-case-generator approved directly via StateManager');
        res.json({ ok: true, status: 'APPROVED', direct: true });
      } catch (err: any) {
        logger.error('Failed to mark stage approved directly', { error: err.message });
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

    proxyReq.on('error', (err) => {
      logger.warn(`Approval webhook on port ${APPROVAL_PORT} unreachable (${err.message}); falling back to direct state update`);
      fallbackDirect();
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      logger.warn(`Approval webhook timed out; falling back to direct state update`);
      fallbackDirect();
    });

    proxyReq.write(body);
    proxyReq.end();
  } catch (err: any) {
    logger.error('Error processing approval', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent02/reject ──────────────────────────────────────────────────
app.post('/api/agent02/reject', (req: Request, res: Response) => {
  const comment = req.body?.comment || 'Rejected via ARIA UI';
  const body = JSON.stringify({ stageId: '02-test-case-generator', comment });
  const options = {
    hostname: 'localhost',
    port:     APPROVAL_PORT,
    path:     `/reject`,
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout:  2500,
  };

  let responded = false;
  const fallbackDirect = async () => {
    if (responded) return;
    responded = true;
    try {
      await stateManager.markStageRejected('02-test-case-generator', comment);
      await memoryEngine.recordApprovalFeedback('02-test-case-generator', 'REJECTED', comment);
      logger.info('Stage 02-test-case-generator rejected directly via StateManager');
      res.json({ ok: true, status: 'REJECTED', direct: true });
    } catch (err: any) {
      logger.error('Failed to mark stage rejected directly', { error: err.message });
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

  proxyReq.on('error', (err) => {
    logger.warn(`Rejection webhook on port ${APPROVAL_PORT} unreachable (${err.message}); falling back to direct state update`);
    fallbackDirect();
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    logger.warn(`Rejection webhook timed out; falling back to direct state update`);
    fallbackDirect();
  });

  proxyReq.write(body);
  proxyReq.end();
});

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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  🤖 ARIA Agent 02 UI                         ║`);
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  logger.info(`Agent 02 UI server started`, { port: PORT });
});
