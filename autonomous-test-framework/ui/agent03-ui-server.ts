import express, { Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { stateManager } from '../core/state-manager/StateManager';
import { llmClient } from '../core/llm/LLMClient';
import { memoryEngine } from '../core/project-memory/MemoryEngine';
import { Logger } from '../core/logger/Logger';
import path from 'path';
import * as http from 'http';
import { syncFeatureFiles } from '../agents/02-test-case-generator/utils';
import { isTestCaseSelected } from '../core/types';

const app = express();
const PORT = parseInt(process.env.AGENT03_UI_PORT || '3002', 10);
const APPROVAL_PORT = parseInt(process.env.APPROVAL_WEBHOOK_PORT || '8081', 10);
const logger = new Logger('Agent03UI');

const FRAMEWORK_DIR = path.resolve(__dirname, '..');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// Redirect root to agent03.html
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'static', 'agent03.html'));
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

// ── GET /api/agent03/state ────────────────────────────────────────────────────
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
      running: !!activeProcess
    });
  } catch (err: any) {
    logger.error('Error fetching Agent 03 state', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent03/run ─────────────────────────────────────────────────────
app.post('/api/agent03/run', async (req: Request, res: Response) => {
  if (activeProcess) {
    logger.info('Killing existing agent process to start a new run');
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
    await stateManager.markStageRunning('03-test-case-reviewer');
  } catch (_) { /* non-fatal */ }

  const args = [
    '-r', 'ts-node/register',
    path.join(FRAMEWORK_DIR, 'agents', '03-test-case-reviewer', 'agent.ts'),
    `--project=${projectName}`
  ];

  logger.info('Spawning Agent 03', { project: projectName, args: args.join(' ') });
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
    logger.info('Agent 03 process exited', { code });
    activeProcess = null;
    broadcastSSE({ type: 'exit', code });
  });

  res.json({ ok: true, message: 'Agent 03 started' });
});

// ── GET /api/agent03/logs ─────────────────────────────────────────────────────
app.get('/api/agent03/logs', (req: Request, res: Response) => {
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

// ── POST /api/agent03/approve / reject ────────────────────────────────────────
function handleApproval(stageId: string, action: 'approve' | 'reject') {
  return async (req: Request, res: Response) => {
    const comment = ((req.body?.comment as string) || `Approved via Agent UI`).trim();
    const isApproval = action === 'approve';
    const body = JSON.stringify({ comment });

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
              logger.warn(`Approval webhook port ${APPROVAL_PORT} active for a different stage (${parsed.error}); using direct StateManager fallback for ${stageId}`);
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

app.post('/api/agent03/approve', handleApproval('03-test-case-reviewer', 'approve'));
app.post('/api/agent03/reject',  handleApproval('03-test-case-reviewer', 'reject'));

// ── POST /api/agent03/chat ────────────────────────────────────────────────────
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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  🤖 ARIA Agent 03 UI Server                  ║`);
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  logger.info(`Agent 03 UI server started`, { port: PORT });
});
