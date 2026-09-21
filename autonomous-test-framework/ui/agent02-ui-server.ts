import express, { Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { stateManager } from '../core/state-manager/StateManager';
import { registerPipelineRoutes } from './pipelineRoutes';
import { llmClient } from '../core/llm/LLMClient';
import { memoryEngine } from '../core/project-memory/MemoryEngine';
import { syncFeatureFiles } from '../agents/02-test-case-generator/utils';
import { isTestCaseSelected, setTestCaseSelected } from '../core/types';
import { Logger } from '../core/logger/Logger';
import path from 'path';
import * as http from 'http';
import { LATEST_PROJECT_SQL } from '../core/state-manager/projectResolver';

const app = express();
const PORT = parseInt(process.env.AGENT02_UI_PORT || '3001', 10);
const APPROVAL_PORT = parseInt(process.env.APPROVAL_WEBHOOK_PORT || '8081', 10);
const logger = new Logger('Agent02UI');

const FRAMEWORK_DIR = path.resolve(__dirname, '..');

app.use(express.json());
registerPipelineRoutes(app);
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
app.get('/api/agent02/state', async (req: Request, res: Response) => {
  try {
    let reqProject = (req.query.projectId as string || '').trim();
    if (!reqProject) {
      try {
        const stateDb = stateManager.getDatabase();
        const latestRun = stateDb.prepare(LATEST_PROJECT_SQL).get() as any;
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
      running: !!activeProcess
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

// ── POST /api/agent02/run ─────────────────────────────────────────────────────
app.post('/api/agent02/run', async (req: Request, res: Response) => {
  if (activeProcess) {
    logger.info('Killing existing agent process to start a new run');
    activeProcess.removeAllListeners('close');
    activeProcess.kill('SIGKILL');
    activeProcess = null;
  }

  let projectName = ((req.body?.projectName as string) || '').trim();
  if (!projectName) {
    try {
      const stateDb = stateManager.getDatabase();
      const latestRun = stateDb.prepare(LATEST_PROJECT_SQL).get() as any;
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

// ── POST /api/agent02/approve ─────────────────────────────────────────────────
app.post('/api/agent02/approve', async (req: Request, res: Response) => {
  const uncheckedTestCaseKeys = req.body?.uncheckedTestCaseKeys || [];
  
  try {
    const testCasesOutput = await stateManager.getPipelineArtifact('testCases');
    if (testCasesOutput && testCasesOutput.zephyrExport && testCasesOutput.zephyrExport.testCases) {
      
      const allTCs = testCasesOutput.zephyrExport.testCases;
      
      // Explicitly set approved and obsolete flags
      for (const tc of allTCs) {
        setTestCaseSelected(tc, !uncheckedTestCaseKeys.includes(tc.key));
      }
      
      const requirements = await stateManager.getPipelineArtifact('analyzedRequirements');
      
      // Resync feature files (will add @obsolete to ignored tests)
      syncFeatureFiles(stateManager.getProjectId(), requirements, allTCs, logger);
      
      delete testCasesOutput.k6ScenarioIndex; // legacy artifact key — no longer produced or read
      
      
      // Save updated artifacts
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
          try {
            const parsed = JSON.parse(data);
            if (proxyRes.statusCode && proxyRes.statusCode >= 400 && parsed.error && parsed.error.includes('mismatch')) {
              logger.warn(`Approval webhook port ${APPROVAL_PORT} active for a different stage (${parsed.error}); using direct StateManager fallback for 02-test-case-generator`);
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
        try {
          const parsed = JSON.parse(data);
          if (proxyRes.statusCode && proxyRes.statusCode >= 400 && parsed.error && parsed.error.includes('mismatch')) {
            logger.warn(`Rejection webhook port ${APPROVAL_PORT} active for a different stage (${parsed.error}); using direct StateManager fallback for 02-test-case-generator`);
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
        syncFeatureFiles(stateManager.getProjectId(), requirements, allTCs, logger);
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
