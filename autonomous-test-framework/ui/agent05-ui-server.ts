import express, { Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { stateManager } from '../core/state-manager/StateManager';
import { registerPipelineRoutes } from './pipelineRoutes';
import { registerPromptTraceRoutes } from './promptTraceRoutes';
import { llmClient } from '../core/llm/LLMClient';
import { memoryEngine } from '../core/project-memory/MemoryEngine';
import { Logger } from '../core/logger/Logger';
import { projectPaths, readActiveProjectSlug } from '../core/aut/projectPaths';
import path from 'path';
import fs from 'fs';
import * as http from 'http';

const app = express();
const PORT = parseInt(process.env.AGENT05_UI_PORT || '3004', 10);
const APPROVAL_PORT = parseInt(process.env.APPROVAL_WEBHOOK_PORT || '8081', 10);
const logger = new Logger('Agent05UI');

const FRAMEWORK_DIR = path.resolve(__dirname, '..');
const HELPERS_DIR = path.join(FRAMEWORK_DIR, 'tests', 'helpers');
const ALLOWED_FILE_ROOTS = ['specs', 'pages', 'k6', 'helpers', 'projects'].map((dir) => path.join(FRAMEWORK_DIR, 'tests', dir));

app.use(express.json());
registerPipelineRoutes(app);
registerPromptTraceRoutes(app, ['agent05']);
app.use(express.static(path.join(__dirname, 'static')));

// Redirect root to agent05.html
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'static', 'agent05.html'));
});

// ── File Listing Helper ───────────────────────────────────────────────────────
function scanDirectoryFiles(dir: string, extFilter?: string[]): Array<{ name: string; relativePath: string; size: number; mtime: string }> {
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

/** Generated-test folders of the active project (legacy global folders when no project is active). */
function activeGeneratedDirs() {
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

function isAllowedScriptPath(targetPath: string): boolean {
  return ALLOWED_FILE_ROOTS.some((root) => targetPath === root || targetPath.startsWith(`${root}${path.sep}`));
}

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

// ── GET /api/agent05/state ────────────────────────────────────────────────────
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

    // Live scan disk for generated files of the active project
    const dirs = activeGeneratedDirs();
    const diskFiles = {
      specFiles: scanDirectoryFiles(dirs.specs, ['.spec.ts']),
      pomFiles: scanDirectoryFiles(dirs.pages, ['.ts']),
      k6Files: scanDirectoryFiles(dirs.k6, ['.js']),
      helperFiles: scanDirectoryFiles(HELPERS_DIR, ['.ts']),
      pageMapFiles: dirs.pageMaps ? scanDirectoryFiles(dirs.pageMaps, ['.json']) : [],
    };

    res.json({
      stage,
      requirements,
      reviewedTestCases,
      testData,
      playwrightScripts,
      diskFiles,
      running: !!activeProcess
    });
  } catch (err: any) {
    logger.error('Error fetching Agent 05 state', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent05/run ─────────────────────────────────────────────────────
app.post('/api/agent05/run', async (req: Request, res: Response) => {
  if (activeProcess) {
    logger.info('Killing existing Agent 05 process to start a new run');
    activeProcess.removeAllListeners('close');
    activeProcess.kill('SIGKILL');
    activeProcess = null;
  }

  let projectName = (req.body?.projectName as string || '').trim();
  if (!projectName) {
    try {
      const stateDb = (stateManager as any).getDatabase();
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
    logger.info('Agent 05 process exited', { code });
    activeProcess = null;
    broadcastSSE({ type: 'exit', code });
  });

  res.json({ ok: true, message: 'Agent 05 started' });
});

// ── GET /api/agent05/logs ─────────────────────────────────────────────────────
app.get('/api/agent05/logs', (req: Request, res: Response) => {
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

// ── GET /api/agent05/file (Read Code Content) ─────────────────────────────────
app.get('/api/agent05/file', (req: Request, res: Response) => {
  const relPath = (req.query.path as string || '').trim();
  if (!relPath) {
    return res.status(400).json({ error: 'path query parameter is required' });
  }

  // Prevent directory traversal
  const normalized = path.normalize(relPath).replace(/^[\/\\]+/, '');
  const targetPath = path.resolve(FRAMEWORK_DIR, normalized);

  if (!isAllowedScriptPath(targetPath)) {
    return res.status(403).json({ error: 'Access denied. File must be within the tests/ script folders.' });
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
const saveFileHandler = async (req: Request, res: Response) => {
  const { path: relPath, content } = req.body || {};
  if (!relPath || typeof content !== 'string') {
    return res.status(400).json({ error: 'path and content string are required' });
  }

  const normalized = path.normalize(relPath).replace(/^[\/\\]+/, '');
  const targetPath = path.resolve(FRAMEWORK_DIR, normalized);

  if (!isAllowedScriptPath(targetPath)) {
    return res.status(403).json({ error: 'Access denied. File must be within the tests/ script folders.' });
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

app.put('/api/agent05/file', saveFileHandler);
app.post('/api/agent05/file', saveFileHandler);

// ── POST /api/agent05/approve / reject ────────────────────────────────────────
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
        if (!(stateManager as any)._initialized) {
          try {
            const stateDb = (stateManager as any).getDatabase();
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

app.post('/api/agent05/approve', handleApproval('05-playwright-script-generator', 'approve'));
app.post('/api/agent05/reject',  handleApproval('05-playwright-script-generator', 'reject'));

/**
 * Compact artifact summary for the chat prompt.
 * @param {any} scripts - playwrightScripts artifact
 * @returns {string}
 */
function summarizeScripts(scripts: any): string {
  if (!scripts) return '(No scripts generated yet)';
  const results: any[] = Array.isArray(scripts.testCases) ? scripts.testCases : [];
  const count = (status: string) => results.filter((r) => r.status === status).length;
  return JSON.stringify({
    project: scripts.projectSlug,
    generated: count('GENERATED'),
    needsContext: results.filter((r) => r.status === 'NEEDS_CONTEXT').map((r) => ({ tcKey: r.tcKey, missing: r.missing })),
    blocked: results.filter((r) => r.status === 'BLOCKED').map((r) => ({ tcKey: r.tcKey, reason: r.reason })),
    excluded: count('EXCLUDED'),
    specFiles: (scripts.specFiles || []).map((f: string) => path.basename(f)),
    pomFiles: (scripts.pomFiles || []).map((f: string) => path.basename(f)),
    k6Files: (scripts.k6Files || []).map((f: string) => path.basename(f)),
    warnings: scripts.warnings || [],
  }, null, 2);
}

// ── POST /api/agent05/chat ────────────────────────────────────────────────────
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
      'The user wants to inspect generated Playwright specs, page objects, API specs and K6 scripts, and the per-test-case generation outcomes.',
      'Answer strictly from the playwrightScripts artifact below. If a detail is not present, say so — do NOT invent facts.',
      'Be concise, analytical, and provide code examples when helpful.',
      '',
      '=== SCRIPT GENERATION SUMMARY ===',
      summarizeScripts(scriptsOutput),
      '',
      '=== APPROVED TEST CASES INPUT ===',
      reviewedReport?.approvedCount ? `Approved test cases: ${reviewedReport.approvedCount}` : '(No reviewed cases found)'
    ].join('\n');

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message }
    ];

    const response = await llmClient.chat('05-playwright-script-generator', {
      messages,
      temperature: 0.2,
      max_tokens: 1000,
    });

    res.json({ reply: response.text });
  } catch (err: any) {
    logger.error('Agent 05 chat failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  🤖 ARIA Agent 05 UI Server                  ║`);
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  logger.info(`Agent 05 UI server started`, { port: PORT });
});
