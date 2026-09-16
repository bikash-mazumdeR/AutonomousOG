/**
 * @fileoverview Agent 06 — Automation Code Reviewer.
 * Performs 9-dimension static code review of all Playwright spec files,
 * POM classes, and K6 scripts. Auto-patches safe issues and blocks
 * critical violations before test execution.
 *
 * @module AutomationReviewerAgent
 * @version 1.0.0
 */

import path from 'path';
import fs from 'fs';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import {
  FILE_TYPE, FINDING_SEVERITY, ANALYSIS_RULES, analyzeWithAST,
} from '../../core/automation-reviewer/ReviewRules';
import { FRAMEWORK_ROOT } from '../../core/aut/projectPaths';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { llmClient } from '../../core/llm/LLMClient';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_ID = '06-automation-reviewer';
const STAGE_NAME = 'Automation Code Reviewer';
const NEXT_STAGE = '07-test-runner';

const SKILL_PATH = path.resolve(__dirname, '../../skills/code-review.md');
const LEARNINGS_PATH = path.resolve(__dirname, 'learnings/reviewer-learnings.md');

/** @enum {string} */
const FILE_STATUS = Object.freeze({
  PASSED: 'PASSED',
  PATCHED: 'PATCHED',
  BLOCKED: 'BLOCKED',
});

/** Score deductions per severity */
const SCORE_DEDUCTIONS = Object.freeze({
  BLOCKER: 25,
  MAJOR: 10,
  MINOR: 2,
  INFO: 0,
});

/** LLM review findings are advisory: only deterministic rules may block a file (and so REJECT the review). */
const LLM_MAX_SEVERITY = FINDING_SEVERITY.MAJOR;

/** Agent 05 outcome whose tests are expected in a generated spec. */
const GENERATED_STATUS = 'GENERATED';

// ─── AutomationReviewerAgent ──────────────────────────────────────────────────

/**
 * @class AutomationReviewerAgent
 * @description Performs 9-dimension static code analysis with auto-patching.
 */
class AutomationReviewerAgent {
  constructor() {
    this._logger = new Logger(STAGE_ID);
    this._skill = this._loadSkill();
  }

  // ── Entry Point ──────────────────────────────────────────────────────────

  /**
   * @param {Object} input
   * @param {Object} input.playwrightScripts - Output of Agent 05
   * @returns {Promise<AgentResult>}
   */
  async run(input) {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);

    if (!input.playwrightScripts) {
      throw new Error('playwrightScripts not found. Ensure Agent 05 completed successfully.');
    }

    try {
      const memoryContext = await memoryEngine.getContextForStage(STAGE_ID);
      await stateManager.markStageRunning(STAGE_ID);

      const scripts = input.playwrightScripts;
      const allFiles = [
        ...scripts.specFiles.map((f) => ({ path: f, type: FILE_TYPE.SPEC })),
        ...scripts.pomFiles.map((f) => ({ path: f, type: FILE_TYPE.POM })),
        ...scripts.k6Files.map((f) => ({ path: f, type: FILE_TYPE.K6 })),
      ].filter((f) => fs.existsSync(f.path));

      this._logger.info('Code review starting', {
        totalFiles: allFiles.length,
        specs: scripts.specFiles.length,
        poms: scripts.pomFiles.length,
        k6: scripts.k6Files.length,
      });

      // ── 1. Load known broken selectors from memory ─────────────────────
      const brokenSelectors = await this._loadBrokenSelectors(memoryContext);

      // ── 2. Review each file ────────────────────────────────────────────
      const fileReviews = [];
      const expectedKeysByFile = this._expectedKeysByFile(scripts);
      for (const file of allFiles) {
        const review = await this._reviewFile(file, brokenSelectors, expectedKeysByFile.get(path.resolve(file.path)));
        fileReviews.push(review);
      }

      // ── 3. Calculate overall score ─────────────────────────────────────
      const overallScore = this._calculateOverallScore(fileReviews);

      // ── 4. Make review decision ────────────────────────────────────────
      const reviewDecision = this._makeDecision(overallScore, fileReviews);

      // ── 5. Persist improvement rules to memory ─────────────────────────
      await this._persistImprovementRules(fileReviews);

      // ── 6. Build output ────────────────────────────────────────────────
      const output = this._buildOutput(fileReviews, overallScore, reviewDecision, scripts);

      // ── 7. Persist ─────────────────────────────────────────────────────
      await stateManager.setPipelineArtifact('reviewedScripts', output);
      await stateManager.markStageCompleted(STAGE_ID, output);
      this._saveToDisk(output);

      const durationMs = Date.now() - startMs;
      this._logger.stage('COMPLETE', STAGE_ID, {
        grade: overallScore.grade, decision: reviewDecision, durationMs,
      });

      const warnings = fileReviews.flatMap((fr) => fr.findings
        .filter((f) => f.severity === FINDING_SEVERITY.BLOCKER || f.severity === FINDING_SEVERITY.MAJOR)
        .map((f) => `[${f.severity}][${path.basename(fr.filePath)}] ${f.message}`));

      const agentResult = this._buildAgentResult(output, warnings, durationMs);

      // ── 8. Approval gate ───────────────────────────────────────────────
      const gateResult = await approvalGate.waitForApproval({
        stageId: STAGE_ID,
        stageName: STAGE_NAME,
        nextStageName: NEXT_STAGE,
        summary: this._buildApprovalSummary(output),
        fullOutput: output,
        warnings,
      });

      agentResult.approvalStatus = gateResult.status;
      agentResult.approvalComment = gateResult.comment;

      await memoryEngine.recordApprovalFeedback(
        STAGE_ID,
        gateResult.status,
        gateResult.comment,
        `Grade: ${overallScore.grade}, Blockers: ${overallScore.blockers}`,
      );

      return agentResult;
    } catch (error) {
      this._logger.error('Agent execution failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  // ── File Review ───────────────────────────────────────────────────────────

  /**
   * Performs an AI-driven functional logic review.
   * @private
   */
  async _performLogicReview(file) {
    const source = fs.readFileSync(file.path, 'utf-8');
    const prompt = `
You are a Senior Test Automation Architect. Review the following Playwright test script for LOGICAL and FUNCTIONAL flaws.
Ignore style and formatting (handled by static analysis).
Judge the code only against the Agent 05 contract in your instructions; never suggest changes that break it.

Focus on:
1. Missing essential assertions.
2. Incorrect data mapping.
3. Logical race conditions in test flow.
4. Steps that don't match the objective.

SCRIPT CONTENT:
\`\`\`javascript
${source}
\`\`\`

Return a JSON array of findings. Each finding must have:
{
  "ruleId": "LOGIC-AI",
  "dimension": "FUNCTIONAL_LOGIC",
  "severity": "BLOCKER" | "MAJOR" | "MINOR",
  "message": "Detailed description of the logical flaw",
  "suggestion": "How to fix it"
}
If no flaws found, return [].
Return ONLY the raw JSON array.
`;

    try {
      const response = await llmClient.chat(STAGE_ID, {
        messages: [{ role: 'system', content: this._skill }, { role: 'user', content: prompt }],
        temperature: 0.2,
        json: true,
      });

      let jsonStr = (response.text || '').replace(/```json\n?|\n?```/g, '').trim();
      const firstBracket = jsonStr.indexOf('[');
      if (firstBracket !== -1) {
        jsonStr = jsonStr.slice(firstBracket);
      }
      // Remove trailing comma if any
      jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
      return JSON.parse(jsonStr);
    } catch (error) {
      this._logger.error('AI Logic Review failed', { file: file.fileName, error: error.message });
      return [];
    }
  }

  /**
   * Reviews a single file through all applicable dimensions.
   * @param {Object} file
   * @param {string[]} brokenSelectors
   * @param {string[]} [expectedKeys] - Test case keys Agent 05 generated into this spec
   * @private
   */
  async _reviewFile(file, brokenSelectors, expectedKeys?: string[]) {
    const source = fs.readFileSync(file.path, 'utf-8');
    const lines = source.split('\n');
    let current = source;

    // Run AST-based review
    const { findings, patchedCode } = analyzeWithAST(current, file.type, file.type === FILE_TYPE.SPEC ? expectedKeys : undefined);
    const patches = [];

    if (patchedCode !== current) {
      // Find which rules triggered patches
      const patchableFindings = findings.filter((f) => f.patchable);
      for (const f of patchableFindings) {
        patches.push({
          ruleId: f.ruleId,
          before: `[Auto-patch for: ${f.message}]`,
          applied: true,
        });
      }
      current = patchedCode;
      this._logger.info('Auto-patches applied via AST', {
        file: path.basename(file.path),
        count: patches.length,
      });
    }

    // Check for known broken selectors from memory
    for (const broken of brokenSelectors) {
      if (current.includes(broken)) {
        findings.push({
          ruleId: 'MEM-001',
          dimension: 'LOCATOR_QUALITY',
          severity: FINDING_SEVERITY.MAJOR,
          message: `Known broken selector detected: "${broken}"`,
          suggestion: 'This selector failed in a previous run. Use the healed replacement from memory.',
          patchable: false,
          line: this._findLineByStr(current, broken),
        });
      }
    }

    // Check for logical and functional flaws on spec files
    if (file.type === FILE_TYPE.SPEC) {
      const logicFindings = await this._performLogicReview(file);
      for (const lf of logicFindings) {
        findings.push({
          ruleId: lf.ruleId || 'LOGIC-AI',
          dimension: lf.dimension || 'FUNCTIONAL_LOGIC',
          severity: lf.severity === FINDING_SEVERITY.BLOCKER ? LLM_MAX_SEVERITY : (lf.severity || FINDING_SEVERITY.MAJOR),
          message: lf.message,
          suggestion: lf.suggestion || 'Review and correct test logic.',
          patchable: false,
        });
      }
    }

    // Write patched file back
    if (patches.length > 0) {
      fs.writeFileSync(file.path, current, 'utf-8');
    }

    // Calculate file score
    const score = this._scoreFile(findings);
    const status = findings.some((f) => f.severity === FINDING_SEVERITY.BLOCKER)
      ? FILE_STATUS.BLOCKED
      : patches.length > 0
        ? FILE_STATUS.PATCHED
        : FILE_STATUS.PASSED;

    return {
      filePath: file.path,
      fileName: path.basename(file.path),
      fileType: file.type,
      linesOfCode: lines.length,
      status,
      findings,
      patches,
      qualityScore: score,
    };
  }

  /**
   * Generated test case keys per spec file (absolute path), so completeness is checked against Agent 05's output.
   * @param {Object} scripts - playwrightScripts artifact
   * @returns {Map<string, string[]>}
   * @private
   */
  _expectedKeysByFile(scripts: { testCases?: Array<{ tcKey: string; status: string; file?: string }> }): Map<string, string[]> {
    const keysByFile = new Map<string, string[]>();
    for (const result of scripts.testCases || []) {
      if (result.status !== GENERATED_STATUS || !result.file) continue;
      const file = path.resolve(FRAMEWORK_ROOT, result.file);
      keysByFile.set(file, [...(keysByFile.get(file) || []), result.tcKey]);
    }
    return keysByFile;
  }

  // ── Scoring ───────────────────────────────────────────────────────────────

  /**
   * Scores a single file review.
   * @private
   */
  _scoreFile(findings) {
    const deduction = findings.reduce(
      (sum, f) => sum + (SCORE_DEDUCTIONS[f.severity] || 0),
      0,
    );
    return Math.max(0, 100 - deduction);
  }

  /**
   * Calculates the overall code review score.
   * @private
   */
  _calculateOverallScore(fileReviews) {
    const scores = fileReviews.map((fr) => fr.qualityScore);
    const average = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 100;

    const allFindings = fileReviews.flatMap((fr) => fr.findings);
    const blockers = allFindings.filter((f) => f.severity === FINDING_SEVERITY.BLOCKER).length;
    const majors = allFindings.filter((f) => f.severity === FINDING_SEVERITY.MAJOR).length;
    const minors = allFindings.filter((f) => f.severity === FINDING_SEVERITY.MINOR).length;

    const grade = average >= 90 ? 'A'
      : average >= 75 ? 'B'
        : average >= 60 ? 'C'
          : average >= 40 ? 'D' : 'F';

    return {
      score: average, grade, blockers, majors, minors,
    };
  }

  /**
   * Determines review decision.
   * @private
   */
  _makeDecision(overallScore, fileReviews) {
    if (overallScore.blockers > 0) return 'REJECT';
    if (overallScore.grade === 'D' || overallScore.grade === 'F') return 'REJECT';
    if (overallScore.grade === 'C') return 'APPROVE_WITH_WARNINGS';
    return 'APPROVE';
  }

  // ── Memory Operations ─────────────────────────────────────────────────────

  /**
   * Loads known broken selectors from memory.
   * @private
   */
  async _loadBrokenSelectors(memoryContext) {
    const memory = await memoryEngine.getFullMemory();
    const patterns = memory.globalLearnings?.selectorPatterns || {};
    return Object.values(patterns)
      .filter((p) => p.brokenSelector)
      .map((p) => p.brokenSelector);
  }

  /**
   * Persists recurring code issues as improvement rules for Agent 05.
   * @private
   */
  async _persistImprovementRules(fileReviews) {
    const allFindings = fileReviews.flatMap((fr) => fr.findings);

    const ruleIdCounts = {};
    for (const f of allFindings) {
      ruleIdCounts[f.ruleId] = (ruleIdCounts[f.ruleId] || 0) + 1;
    }

    // Rules recurring 2+ times get written to memory
    for (const [ruleId, count] of Object.entries(ruleIdCounts)) {
      if (count >= 2) {
        const finding = allFindings.find((f) => f.ruleId === ruleId);
        await memoryEngine.addImprovementRule({
          id: `RULE-06-${ruleId}`,
          description: `Agent 05 recurring issue (×${count}): ${finding?.message}`,
          appliesTo: '05-playwright-script-generator',
          action: `FIX_${ruleId}`,
          suggestion: finding?.suggestion,
          addedAt: new Date().toISOString(),
        });
      }
    }

    this._logger.info('Improvement rules persisted for Agent 05', {
      recurringIssues: Object.keys(ruleIdCounts).filter((k) => ruleIdCounts[k] >= 2).length,
    });
  }

  // ── Output Builders ───────────────────────────────────────────────────────

  /**
   * @private
   */
  _buildOutput(fileReviews, overallScore, reviewDecision, scripts) {
    const blockerList = fileReviews.flatMap((fr) => fr.findings
      .filter((f) => f.severity === FINDING_SEVERITY.BLOCKER)
      .map((f) => `[${fr.fileName}:${f.line || '?'}] ${f.message}`));

    return {
      reviewId: `code_review_${Date.now()}`,
      reviewedAt: new Date().toISOString(),
      reviewedBy: 'ARIA-Agent-06',
      totalFiles: fileReviews.length,
      passedFiles: fileReviews.filter((fr) => fr.status === FILE_STATUS.PASSED).length,
      patchedFiles: fileReviews.filter((fr) => fr.status === FILE_STATUS.PATCHED).length,
      failedFiles: fileReviews.filter((fr) => fr.status === FILE_STATUS.BLOCKED).length,
      totalFindings: fileReviews.reduce((s, fr) => s + fr.findings.length, 0),
      fileReviews,
      overallScore,
      reviewDecision,
      blockers: blockerList,
      recommendations: this._buildRecommendations(overallScore, fileReviews),

      // Carry forward scripts metadata for Agent 07
      approvedScripts: {
        specFiles: scripts.specFiles,
        k6Files: scripts.k6Files,
        pomFiles: scripts.pomFiles,
      },
    };
  }

  /** @private */
  _buildRecommendations(score, fileReviews) {
    const recs = [];

    if (score.grade === 'A') recs.push('✅ Excellent code quality. Scripts are ready for execution.');
    if (score.blockers > 0) recs.push(`🔴 ${score.blockers} blocker(s) must be resolved before execution.`);
    if (score.majors > 3) recs.push(`⚠️ ${score.majors} major issues found. Review patched files before approving.`);

    const k6Issues = fileReviews
      .filter((fr) => fr.fileType === FILE_TYPE.K6 && fr.findings.length > 0);
    if (k6Issues.length > 0) {
      recs.push(`⚡ ${k6Issues.length} K6 script(s) have issues. Verify performance thresholds use __ENV.*`);
    }

    const patchedCount = fileReviews.filter((fr) => fr.status === FILE_STATUS.PATCHED).length;
    if (patchedCount > 0) {
      recs.push(`🔧 ${patchedCount} file(s) were auto-patched. Review patches before proceeding.`);
    }

    return recs;
  }

  /** @private */
  _buildApprovalSummary(output) {
    return {
      'Review Decision': output.reviewDecision,
      'Overall Grade': `${output.overallScore.grade} (${output.overallScore.score}/100)`,
      'Total Files Reviewed': output.totalFiles,
      Passed: output.passedFiles,
      'Auto-Patched': output.patchedFiles,
      Blocked: output.failedFiles,
      'Total Findings': output.totalFindings,
      Blockers: output.overallScore.blockers,
      Majors: output.overallScore.majors,
      Minors: output.overallScore.minors,
    };
  }

  /** @private */
  _buildAgentResult(output, warnings, durationMs) {
    return {
      agentId: STAGE_ID,
      stageNumber: '06',
      stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED,
      output,
      clarifications: [],
      warnings,
      memoryUpdate: {
        codeReviewGrade: output.overallScore.grade,
        codeScore: output.overallScore.score,
      },
      timestamp: new Date().toISOString(),
      durationMs,
      approvalStatus: 'PENDING',
      approvalComment: '',
    };
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  /** @private */
  _findLine(source, pattern) {
    if (!pattern) return null;
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) return i + 1;
    }
    return null;
  }

  /** @private */
  _findLineByStr(source, str) {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(str)) return i + 1;
    }
    return null;
  }

  /** @private */
  _saveToDisk(output) {
    const outDir = path.resolve(__dirname, '../../reports/json');
    const outPath = path.join(outDir, `code-review-${Date.now()}.json`);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    this._logger.info('Code review report saved', { path: outPath });
  }

  /** @private */
  _loadSkill() {
    let skill = '';
    try { skill = fs.readFileSync(SKILL_PATH, 'utf-8'); } catch { skill = ''; }
    try {
      if (fs.existsSync(LEARNINGS_PATH)) {
        skill += '\n\n' + fs.readFileSync(LEARNINGS_PATH, 'utf-8');
      }
    } catch {
      // non-blocking
    }
    return skill;
  }
}

// ─── Export & CLI ─────────────────────────────────────────────────────────────

export { AutomationReviewerAgent };

/**
 * Parses `--key=value` / `--key value` / `--flag` CLI arguments.
 * @param {string[]} argv
 * @returns {Record<string, any>}
 */
function parseCliArgs(argv: string[]): Record<string, any> {
  const opts: Record<string, any> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--' || !arg.startsWith('--')) continue;
    const [key, val] = arg.slice(2).split('=');
    if (val !== undefined) {
      opts[key] = val;
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      opts[key] = argv[i + 1];
      i += 1;
    } else {
      opts[key] = true;
    }
  }
  return opts;
}

/**
 * Resolves the project id from `--project`, else the newest real run in the state DB.
 * @param {Record<string, any>} opts
 * @returns {string}
 */
function resolveProjectId(opts: Record<string, any>): string {
  if (opts.project) return opts.project;
  try {
    const { stateDb } = require('../../core/state-manager/Database');
    stateDb.initialize();
    const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get();
    if (latestRun?.project_id) return latestRun.project_id;
  } catch {
    // fall back to configuration
  }
  return FRAMEWORK_CONFIG.projectId;
}

if (require.main === module) {
  (async () => {
    const projectId = resolveProjectId(parseCliArgs(process.argv.slice(2)));

    await stateManager.initialize(projectId);
    await memoryEngine.initialize(projectId);

    const agent = new AutomationReviewerAgent();
    const playwrightScripts = await stateManager.getPipelineArtifact('playwrightScripts');

    if (!playwrightScripts) {
      console.error('❌ No playwright scripts found. Run Agent 05 first.');
      process.exit(1);
    }

    const result = await agent.run({ playwrightScripts });

    // Handle operator choosing RUN AGENT 05 in standalone mode
    if (result.approvalStatus === 'REJECTED' && /agent[:\s]*0?5/i.test(result.approvalComment || '')) {
      console.log(`\n🔄 Re-running Agent 05 (Playwright Script Generator) to resolve review issues...`);
      const { PlaywrightScriptGeneratorAgent } = require('../05-playwright-script-generator/agent');
      const testData = await stateManager.getPipelineArtifact('testData');
      const reviewedTestCases = await stateManager.getPipelineArtifact('reviewedTestCases');
      const analyzedRequirements = await stateManager.getPipelineArtifact('analyzedRequirements');
      const reviewedScripts = await stateManager.getPipelineArtifact('reviewedScripts');
      const agent05 = new PlaywrightScriptGeneratorAgent();
      const agent05Result = await agent05.run({ testData, reviewedTestCases, analyzedRequirements, reviewedScripts });

      if (agent05Result.approvalStatus === 'APPROVED') {
        console.log(`\n🔄 Agent 05 approved! Re-running Agent 06 to review the updated scripts...\n`);
        const updatedScripts = await stateManager.getPipelineArtifact('playwrightScripts');
        const reReviewResult = await agent.run({ playwrightScripts: updatedScripts });
        process.exit(reReviewResult.approvalStatus === 'APPROVED' ? 0 : 1);
        return;
      } else {
        process.exit(1);
        return;
      }
    }

    if (result.output.reviewDecision === 'REJECT') {
      console.log(`\n🛑 Review Decision: REJECT — Blockers detected.`);
      console.log(`👉 Please run Agent 05 to resolve and regenerate the scripts:\n   npm run agent:05\n`);
    } else {
      console.log(`\n✅ Agent 06 complete — Grade: ${result.output.overallScore.grade} | Decision: ${result.output.reviewDecision}`);
    }
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })();
}
