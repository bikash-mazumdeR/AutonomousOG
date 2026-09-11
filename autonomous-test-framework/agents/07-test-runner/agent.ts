/**
 * @fileoverview Agent 07 — Test Runner.
 * Executes all reviewed Playwright spec files and K6 performance scripts
 * in a multi-threaded, state-safe manner. Collects results, attachments,
 * and produces a structured ExecutionReport for downstream agents.
 *
 * @module TestRunnerAgent
 * @version 1.0.0
 */

import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_ID = '07-test-runner';
const STAGE_NAME = 'Test Runner';
const NEXT_STAGE = '08-bug-reporter';

const REPORTS_DIR = path.resolve(__dirname, '../../reports');
const JSON_REPORT_PATH = path.join(REPORTS_DIR, 'json/playwright-results.json');
const HTML_REPORT_DIR = path.join(REPORTS_DIR, 'html');
const ATTACH_DIR = path.join(REPORTS_DIR, 'attachments');

/** @enum {string} */
const TEST_RESULT = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  FLAKY: 'flaky',
});

/** @enum {string} */
const RUN_MODE = Object.freeze({
  FULL: 'FULL', // All specs
  SMOKE: 'SMOKE', // @Smoke tagged only
  REGRESSION: 'REGRESSION', // @Regression tagged only
  FAILED: 'FAILED', // Only previously failed TCs (used by Agent 11)
});

// ─── TestRunnerAgent ──────────────────────────────────────────────────────────

/**
 * @class TestRunnerAgent
 * @description Executes Playwright tests and K6 scripts with full result capture.
 */
class TestRunnerAgent {
  constructor() {
    this._logger = new Logger(STAGE_ID);
    this._startTime = null;
  }

  // ── Entry Point ──────────────────────────────────────────────────────────

  /**
   * @param {Object}  input
   * @param {Object}  input.reviewedScripts   - Agent 06 output
   * @param {Object}  [input.testData]        - Agent 04 output (manifest)
   * @param {string}  [input.mode]            - RUN_MODE (default: FULL)
   * @param {Array}   [input.targetTCKeys]    - Specific TC keys (for FAILED mode)
   * @returns {Promise<AgentResult>}
   */
  async run(input) {
    this._startTime = Date.now();
    this._logger.stage('START', STAGE_ID, { mode: input.mode || RUN_MODE.FULL });

    if (!input.reviewedScripts) {
      throw new Error('reviewedScripts not found. Ensure Agent 06 completed successfully.');
    }

    try {
      await stateManager.markStageRunning(STAGE_ID);
      this._ensureDirs();

      const scripts = input.reviewedScripts.approvedScripts || input.reviewedScripts;
      const mode = input.mode || RUN_MODE.FULL;
      const env = this._buildEnv(input.testData);

      this._logger.info('Execution starting', {
        specFiles: scripts.specFiles?.length || 0,
        k6Files: scripts.k6Files?.length || 0,
        mode,
        workers: FRAMEWORK_CONFIG.playwright.workers,
        headless: FRAMEWORK_CONFIG.playwright.headless,
      });

      // ── 1. Run Playwright tests ────────────────────────────────────────
      const playwrightResult = await this._runPlaywright(scripts, mode, env, input.targetTCKeys);

      // ── 2. Run K6 performance tests ────────────────────────────────────
      const k6Results = [];
      if (scripts.k6Files && scripts.k6Files.length > 0 && mode !== RUN_MODE.FAILED) {
        for (const k6File of scripts.k6Files) {
          const k6Result = await this._runK6Script(k6File, env);
          k6Results.push(k6Result);
        }
      }

      // ── 3. Parse and enrich results ────────────────────────────────────
      const executionResults = this._parseResults(playwrightResult, k6Results);

      // ── 4. Collect attachments index ──────────────────────────────────
      executionResults.attachments = this._collectAttachments();

      // ── 5. Identify flaky tests ────────────────────────────────────────
      executionResults.flakyTests = this._identifyFlakyTests(executionResults);

      // ── 6. Update memory with failures ────────────────────────────────
      await this._updateMemory(executionResults);

      // ── 7. Persist ─────────────────────────────────────────────────────
      await stateManager.setPipelineArtifact('executionResults', executionResults);
      await stateManager.markStageCompleted(STAGE_ID, executionResults);
      this._saveResultsToDisk(executionResults);

      const durationMs = Date.now() - this._startTime;
      this._logger.stage('COMPLETE', STAGE_ID, {
        passed: executionResults.summary.passed,
        failed: executionResults.summary.failed,
        passRate: `${executionResults.summary.passRate}%`,
        durationMs,
      });

      const warnings = this._buildWarnings(executionResults);
      const agentResult = this._buildAgentResult(executionResults, warnings, durationMs);

      // ── 8. Approval gate ───────────────────────────────────────────────
      const gateResult = await approvalGate.waitForApproval({
        stageId: STAGE_ID,
        stageName: STAGE_NAME,
        nextStageName: NEXT_STAGE,
        summary: this._buildApprovalSummary(executionResults),
        fullOutput: executionResults,
        warnings,
      });

      agentResult.approvalStatus = gateResult.status;
      agentResult.approvalComment = gateResult.comment;

      await memoryEngine.recordApprovalFeedback(
        STAGE_ID,
        gateResult.status,
        gateResult.comment,
        `Pass: ${executionResults.summary.passed}, Fail: ${executionResults.summary.failed}`,
      );

      return agentResult;
    } catch (error) {
      this._logger.error('Agent execution failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  // ── Playwright Execution ──────────────────────────────────────────────────

  /**
   * Executes Playwright tests using the CLI.
   * @private
   */
  async _runPlaywright(scripts, mode, env, targetTCKeys) {
    const args = this._buildPlaywrightArgs(mode, targetTCKeys, scripts);
    const cmd = `npx playwright test ${args.join(' ')}`;

    // Delete any stale JSON report before running
    if (fs.existsSync(JSON_REPORT_PATH)) {
      try { fs.unlinkSync(JSON_REPORT_PATH); } catch (e) { /* ignore */ }
    }

    return new Promise((resolve) => {
      const proc = spawn('npx', ['playwright', 'test', ...args], {
        env: { ...process.env, ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: JSON_REPORT_PATH },
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'pipe',
        shell: process.platform === 'win32',
      });

      const stdout = [];
      const stderr = [];

      proc.stdout.on('data', (d) => {
        const line = d.toString();
        stdout.push(line);
        process.stdout.write(line);
      });

      proc.stderr.on('data', (d) => {
        const line = d.toString();
        stderr.push(line);
        process.stderr.write(line);
      });

      proc.on('close', (code) => {
        this._logger.info('Playwright process exited', { code });
        resolve({
          exitCode: code,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
          jsonPath: JSON_REPORT_PATH,
        });
      });

      proc.on('error', (err) => {
        this._logger.warn('Playwright spawn error — may not be installed', { error: err.message });
        resolve({
          exitCode: -1,
          stdout: '',
          stderr: err.message,
          jsonPath: null,
          spawnError: true,
        });
      });
    });
  }

  /**
   * Builds Playwright CLI args based on run mode.
   * @private
   */
  _buildPlaywrightArgs(mode, targetTCKeys, scripts) {
    const args = [
      `--workers=${FRAMEWORK_CONFIG.playwright.workers}`,
      `--retries=${FRAMEWORK_CONFIG.playwright.retries}`,
      `--timeout=${FRAMEWORK_CONFIG.playwright.timeout}`,
    ];

    if (!FRAMEWORK_CONFIG.playwright.headless) args.push('--headed');

    switch (mode) {
      case RUN_MODE.SMOKE:
        args.push('--grep=@Smoke');
        break;
      case RUN_MODE.REGRESSION:
        args.push('--grep=@Regression');
        break;
      case RUN_MODE.FAILED:
        if (targetTCKeys && targetTCKeys.length > 0) {
          // Run only tests matching TC keys
          const pattern = targetTCKeys.join('|');
          args.push(`--grep="${pattern}"`);
        } else {
          args.push('--last-failed');
        }
        break;
      case RUN_MODE.FULL:
      default:
        break;
    }

    return args;
  }

  // ── K6 Execution ──────────────────────────────────────────────────────────

  /**
   * Executes a single K6 script and captures results.
   * @private
   */
  async _runK6Script(k6FilePath, env) {
    const filename = path.basename(k6FilePath);
    const jsonOut = path.join(REPORTS_DIR, 'json', `k6-${filename}-${Date.now()}.json`);

    this._logger.info('Launching K6', { script: filename });

    return new Promise((resolve) => {
      const proc = spawn('k6', ['run', '--out', `json=${jsonOut}`, k6FilePath], {
        env: { ...process.env, ...env },
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'pipe',
        shell: process.platform === 'win32',
      });

      const stdout = [];
      const stderr = [];

      proc.stdout.on('data', (d) => { stdout.push(d.toString()); process.stdout.write(d); });
      proc.stderr.on('data', (d) => { stderr.push(d.toString()); });

      proc.on('close', (code) => {
        const passed = code === 0;
        const summary = this._parseK6Output(stdout.join(''));

        this._logger.info('K6 script completed', { script: filename, passed, code });

        resolve({
          scriptPath: k6FilePath,
          scriptName: filename,
          exitCode: code,
          passed,
          stdout: stdout.join(''),
          jsonOutput: jsonOut,
          summary,
          thresholdsPassed: passed,
        });
      });

      proc.on('error', (err) => {
        this._logger.warn('K6 not found — skipping performance test', { error: err.message });
        resolve({
          scriptPath: k6FilePath,
          scriptName: filename,
          exitCode: -1,
          passed: null,
          skipped: true,
          error: 'K6 not installed or not in PATH',
          summary: null,
        });
      });
    });
  }

  /**
   * Parses K6 stdout for threshold results.
   * @private
   */
  _parseK6Output(stdout) {
    const p95Match = stdout.match(/http_req_duration.*?p\(95\)=([0-9.]+)ms/);
    const failRateMatch = stdout.match(/http_req_failed.*?([0-9.]+)%/);
    const reqCountMatch = stdout.match(/http_reqs.*?(\d+)/);

    return {
      p95ResponseTime: p95Match ? parseFloat(p95Match[1]) : null,
      errorRate: failRateMatch ? parseFloat(failRateMatch[1]) : null,
      totalRequests: reqCountMatch ? parseInt(reqCountMatch[1]) : null,
    };
  }

  // ── Result Parsing ────────────────────────────────────────────────────────

  /**
   * Parses Playwright JSON report + K6 results into unified ExecutionReport.
   * @private
   */
  _parseResults(playwrightResult, k6Results) {
    const pwResults = this._parsePlaywrightJSON(playwrightResult);

    const summary = {
      total: pwResults.total,
      passed: pwResults.passed,
      failed: pwResults.failed,
      skipped: pwResults.skipped,
      flaky: 0,
      passRate: pwResults.total > 0
        ? Math.round((pwResults.passed / pwResults.total) * 100)
        : 0,
      duration: Date.now() - this._startTime,
      environment: FRAMEWORK_CONFIG.environment,
      browser: 'chromium',
      workers: FRAMEWORK_CONFIG.playwright.workers,
      retries: FRAMEWORK_CONFIG.playwright.retries,
    };

    const failedTests = pwResults.tests.filter((t) => t.status === TEST_RESULT.FAILED);

    return {
      runId: `run_${Date.now()}`,
      executedAt: new Date().toISOString(),
      mode: RUN_MODE.FULL,
      summary,
      tests: pwResults.tests,
      failedTests,
      k6Results,
      attachments: {},
      flakyTests: [],
      rawReport: playwrightResult.jsonPath,
    };
  }

  /**
   * Parses the Playwright JSON reporter output file.
   * @private
   */
  _parsePlaywrightJSON(playwrightResult) {
    const empty = {
      total: 0, passed: 0, failed: 0, skipped: 0, tests: [],
    };

    if (playwrightResult.spawnError || !playwrightResult.jsonPath) {
      this._logger.warn('Playwright JSON report not available — using empty results');
      return empty;
    }

    if (!fs.existsSync(playwrightResult.jsonPath)) {
      this._logger.warn('JSON report file not found', { path: playwrightResult.jsonPath });

      // Fall back to parsing stdout for basic counts
      return this._parsePlaywrightStdout(playwrightResult.stdout);
    }

    try {
      const raw = JSON.parse(fs.readFileSync(playwrightResult.jsonPath, 'utf-8'));
      const tests = [];
      let passed = 0; let failed = 0; let
        skipped = 0;

      for (const suite of raw.suites || []) {
        for (const spec of this._flattenSpecs(suite)) {
          for (const result of spec.tests || []) {
            const status = this._normalizeStatus(result.status, result.results);
            const title = spec.title || result.title || '';
            const test = {
              tcKey: this._extractTCKey(title, result.annotations),
              title,
              status,
              duration: result.results?.[0]?.duration || 0,
              retries: (result.results?.length || 1) - 1,
              error: status === TEST_RESULT.FAILED
                ? this._extractError(result.results)
                : null,
              attachments: this._extractAttachments(result.results),
              annotations: result.annotations || [],
              location: spec.file
                ? { file: spec.file, line: spec.line || result.line || 0 }
                : null,
            };

            tests.push(test);
            if (status === TEST_RESULT.PASSED || status === TEST_RESULT.FLAKY) passed++;
            else if (status === TEST_RESULT.FAILED) failed++;
            else if (status === TEST_RESULT.SKIPPED) skipped++;
          }
        }
      }

      return {
        total: tests.length, passed, failed, skipped, tests,
      };
    } catch (err) {
      this._logger.error('Failed to parse Playwright JSON report', { error: err.message });
      return this._parsePlaywrightStdout(playwrightResult.stdout);
    }
  }

  /**
   * Falls back to parsing stdout when JSON report is unavailable.
   * @private
   */
  _parsePlaywrightStdout(stdout) {
    const clean = (stdout || '').replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
    const passMatch = clean.match(/(\d+)\s+passed/);
    const failMatch = clean.match(/(\d+)\s+failed/);
    const skipMatch = clean.match(/(\d+)\s+skipped/);

    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;

    return {
      total: passed + failed + skipped,
      passed,
      failed,
      skipped,
      tests: [],
    };
  }

  /**
   * Flattens nested suite → spec structure.
   * @private
   */
  _flattenSpecs(suite, parentFile?: string) {
    const file = suite.file || parentFile;
    const specs = (suite.specs || []).map((s) => ({ ...s, file: s.file || file }));
    for (const child of suite.suites || []) {
      specs.push(...this._flattenSpecs(child, file));
    }
    return specs;
  }

  /**
   * Normalises Playwright status accounting for retries.
   * @private
   */
  _normalizeStatus(status, results) {
    if (!results || results.length === 0) return status || TEST_RESULT.SKIPPED;
    const statuses = results.map((r) => r.status);
    const lastStatus = statuses[statuses.length - 1];

    if (lastStatus === 'passed' && statuses.some((s) => s === 'failed')) {
      return TEST_RESULT.FLAKY;
    }
    return lastStatus || status;
  }

  /**
   * Extracts TC key from test title or annotations.
   * @private
   */
  _extractTCKey(title, annotations) {
    const annot = (annotations || []).find((a) => a.type === 'TC Key');
    if (annot) return annot.description;

    if (!title || typeof title !== 'string') return null;
    const match = title.match(/TC-\d{3}/);
    return match ? match[0] : null;
  }

  /**
   * Extracts first error from failed test results.
   * @private
   */
  _extractError(results) {
    for (const result of results || []) {
      if (result.status === 'failed' && result.error) {
        return {
          message: result.error.message || 'Unknown error',
          stack: result.error.stack || '',
          location: result.error.location || null,
        };
      }
    }
    return null;
  }

  /**
   * Extracts attachment paths from test results.
   * @private
   */
  _extractAttachments(results) {
    const attachments = { screenshots: [], networkLogs: [], consoleLogs: [] };
    for (const result of results || []) {
      for (const attach of result.attachments || []) {
        if (attach.contentType === 'image/png') attachments.screenshots.push(attach.path);
        else if (attach.name === 'network-log') attachments.networkLogs.push(attach.path);
        else if (attach.name === 'console-log') attachments.consoleLogs.push(attach.path);
      }
    }
    return attachments;
  }

  // ── Attachment Indexing ───────────────────────────────────────────────────

  /**
   * Collects all attachment files from the report directory.
   * @private
   */
  _collectAttachments() {
    const collect = (dir, ext) => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter((f) => f.endsWith(ext))
        .map((f) => path.join(dir, f));
    };

    return {
      screenshots: collect(path.join(ATTACH_DIR, 'screenshots'), '.png'),
      networkLogs: collect(path.join(ATTACH_DIR, 'network-logs'), '.json'),
      consoleLogs: collect(path.join(ATTACH_DIR, 'console-logs'), '.log'),
    };
  }

  // ── Flaky Test Detection ──────────────────────────────────────────────────

  /**
   * Identifies flaky tests and updates memory.
   * @private
   */
  _identifyFlakyTests(executionResults) {
    return (executionResults.tests || [])
      .filter((t) => t.status === TEST_RESULT.FLAKY || t.retries > 0)
      .map((t) => ({
        tcKey: t.tcKey,
        title: t.title,
        retries: t.retries,
        status: t.status,
      }));
  }

  // ── Memory Update ─────────────────────────────────────────────────────────

  /**
   * Updates memory with failure patterns and flaky test tracking.
   * @private
   */
  async _updateMemory(executionResults) {
    const { failedTests, flakyTests } = executionResults;

    // Record failure patterns from error messages
    for (const test of failedTests || []) {
      if (test.error?.message) {
        await memoryEngine.addImprovementRule({
          id: `RULE-07-FAIL-${test.tcKey || Date.now()}`,
          description: `Test failure pattern: ${test.error.message.slice(0, 100)}`,
          appliesTo: '10-auto-healer',
          action: 'ANALYSE_FAILURE',
          tcKey: test.tcKey,
          errorMessage: test.error.message,
          addedAt: new Date().toISOString(),
        });
      }
    }

    // Record flaky tests
    for (const test of flakyTests || []) {
      this._logger.warn('Flaky test detected', { tcKey: test.tcKey, retries: test.retries });
    }

    // Record cycle summary
    await memoryEngine.recordCycle({
      runId: executionResults.runId,
      passRate: executionResults.summary.passRate,
      totalTests: executionResults.summary.total,
      bugsFound: executionResults.summary.failed,
      autoHeals: 0,
      stages: { '07-test-runner': 'COMPLETED' },
      keyLearnings: flakyTests.map((t) => `Flaky: ${t.tcKey}`),
    });
  }

  // ── Environment Builder ───────────────────────────────────────────────────

  /**
   * Builds environment variables for child processes.
   * @private
   */
  _buildEnv(testData) {
    return {
      AUT_BASE_URL: FRAMEWORK_CONFIG.playwright.baseURL,
      AUT_ENVIRONMENT: FRAMEWORK_CONFIG.environment,
      PLAYWRIGHT_HEADLESS: String(FRAMEWORK_CONFIG.playwright.headless),
      K6_VUS: String(FRAMEWORK_CONFIG.k6.vus),
      K6_DURATION: FRAMEWORK_CONFIG.k6.duration,
      K6_THRESHOLD_P95: String(500),
      TEST_AUTH_TOKEN: process.env.TEST_AUTH_TOKEN || '',
    };
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  /** @private */
  _buildWarnings(results) {
    const warnings = [];
    if (results.summary.passRate < 80) {
      warnings.push(`⚠️ Pass rate is ${results.summary.passRate}% — below 80% threshold`);
    }
    if (results.flakyTests.length > 0) {
      warnings.push(`⚠️ ${results.flakyTests.length} flaky test(s) detected`);
    }
    if (results.summary.failed > 0) {
      warnings.push(`❌ ${results.summary.failed} test(s) failed — Bug Reporter will file Jira issues`);
    }
    const k6Failed = results.k6Results.filter((k) => k.passed === false);
    if (k6Failed.length > 0) {
      warnings.push(`⚡ ${k6Failed.length} K6 performance threshold(s) breached`);
    }
    return warnings;
  }

  /** @private */
  _buildApprovalSummary(results) {
    const s = results.summary;
    return {
      'Total Tests': s.total,
      Passed: `${s.passed} (${s.passRate}%)`,
      Failed: s.failed,
      Skipped: s.skipped,
      'Flaky Tests': results.flakyTests.length,
      'K6 Scripts Run': results.k6Results.length,
      'K6 Passed': results.k6Results.filter((k) => k.passed).length,
      Environment: s.environment,
      Browser: s.browser,
      'Workers Used': s.workers,
      'Total Duration': `${Math.round(s.duration / 1000)}s`,
    };
  }

  /** @private */
  _buildAgentResult(output, warnings, durationMs) {
    return {
      agentId: STAGE_ID,
      stageNumber: '07',
      stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED,
      output,
      clarifications: [],
      warnings,
      memoryUpdate: {
        passRate: output.summary.passRate,
        failedCount: output.summary.failed,
      },
      timestamp: new Date().toISOString(),
      durationMs,
      approvalStatus: 'PENDING',
      approvalComment: '',
    };
  }

  /** @private */
  _ensureDirs() {
    [REPORTS_DIR, HTML_REPORT_DIR, path.join(REPORTS_DIR, 'json'),
      path.join(ATTACH_DIR, 'screenshots'),
      path.join(ATTACH_DIR, 'network-logs'),
      path.join(ATTACH_DIR, 'console-logs'),
    ].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
  }

  /** @private */
  _saveResultsToDisk(results) {
    const outPath = path.join(REPORTS_DIR, 'json', `execution-results-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
    this._logger.info('Execution results saved', { path: outPath });
  }
}

export { TestRunnerAgent, RUN_MODE };

if (require.main === module) {
  (async () => {
    let projectId = FRAMEWORK_CONFIG.projectId;
    try {
      const { stateDb } = require('../../core/state-manager/Database');
      stateDb.initialize();
      const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get();
      if (latestRun && latestRun.project_id) {
        projectId = latestRun.project_id;
      }
    } catch {}

    await stateManager.initialize(projectId);
    await memoryEngine.initialize(projectId);

    const agent = new TestRunnerAgent();
    let reviewedScripts = await stateManager.getPipelineArtifact('reviewedScripts');
    let testData = await stateManager.getPipelineArtifact('testData');

    // Disk fallback for reviewedScripts if not present in state
    if (!reviewedScripts) {
      try {
        const reportsDir = path.resolve(__dirname, '../../reports/json');
        if (fs.existsSync(reportsDir)) {
          const reviewFiles = fs.readdirSync(reportsDir)
            .filter((f) => f.startsWith('code-review-') && f.endsWith('.json'))
            .sort().reverse();
          if (reviewFiles.length > 0) {
            reviewedScripts = JSON.parse(fs.readFileSync(path.join(reportsDir, reviewFiles[0]), 'utf-8'));
          }
        }
      } catch {}
    }

    // Disk fallback for testData if not present in state
    if (!testData) {
      try {
        const fixturePath = path.resolve(__dirname, '../../tests/fixtures/test-data.json');
        if (fs.existsSync(fixturePath)) {
          testData = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
        }
      } catch {}
    }

    if (!reviewedScripts) {
      console.error('❌ No reviewed scripts found. Run Agent 06 first.');
      process.exit(1);
    }

    const result = await agent.run({ reviewedScripts, testData });
    console.log(`\n✅ Agent 07 complete — Pass: ${result.output.summary.passed}, Fail: ${result.output.summary.failed}`);
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })();
}
