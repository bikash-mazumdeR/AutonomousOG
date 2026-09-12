/**
 * @fileoverview Agent 03 — Test Case Reviewer.
 * Performs a multi-dimensional quality review of all test cases produced
 * by Agent 02. Detects duplicates, rewrites poor steps, validates coverage,
 * scores quality, and produces an annotated reviewed test case suite.
 *
 * @module TestCaseReviewerAgent
 * @version 1.0.0
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_ID = '03-test-case-reviewer';
const STAGE_NAME = 'Test Case Reviewer';
const NEXT_STAGE = '04-test-data-generator';

/** @enum {string} */
const REVIEW_DIMENSION = Object.freeze({
  COMPLETENESS: 'COMPLETENESS',
  COVERAGE: 'COVERAGE',
  DUPLICATE: 'DUPLICATE',
  STEP_QUALITY: 'STEP_QUALITY',
  DATA: 'DATA',
  API: 'API',
  PERFORMANCE: 'PERFORMANCE',
  TRACEABILITY: 'TRACEABILITY',
});

/** @enum {string} */
const SEVERITY = Object.freeze({
  BLOCKER: 'BLOCKER',
  MAJOR: 'MAJOR',
  MINOR: 'MINOR',
  INFO: 'INFO',
});

/** @enum {string} */
const REVIEW_ACTION = Object.freeze({
  REJECTED: 'REJECTED',
  REWRITTEN: 'REWRITTEN',
  FLAGGED: 'FLAGGED',
  PASSED: 'PASSED',
});

/** @enum {string} */
const COVERAGE_STATUS = Object.freeze({
  ADEQUATE: 'ADEQUATE',
  PARTIAL: 'PARTIAL',
  INSUFFICIENT: 'INSUFFICIENT',
});

/** Scoring weights per dimension (must sum to 1.0) */
const DIMENSION_WEIGHTS = Object.freeze({
  completeness: 0.25,
  coverage: 0.25,
  stepQuality: 0.20,
  traceability: 0.15,
  dataQuality: 0.15,
});

/** Minimum coverage counts by risk level */
const MIN_COVERAGE = Object.freeze({
  CRITICAL: {
    positive: 5, negative: 5, edge: 3, smoke: true,
  },
  HIGH: {
    positive: 3, negative: 3, edge: 2, smoke: true,
  },
  MEDIUM: {
    positive: 2, negative: 2, edge: 1, smoke: false,
  },
  LOW: {
    positive: 1, negative: 1, edge: 0, smoke: false,
  },
});

/** Vague phrases that trigger step rewrites */
const VAGUE_PHRASES = Object.freeze([
  'verify it works', 'check something', 'make sure', 'confirm it',
  'check the page', 'verify the app', 'it should work', 'test the feature',
  'look at the result', 'see if it works', 'check if correct',
]);

/** Valid placeholder pattern */
const PLACEHOLDER_RE = /\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g;

/** Invalid placeholder patterns */
const INVALID_PLACEHOLDER_PATTERNS = [
  { re: /<[a-zA-Z][^>]*>/g, label: 'angle-bracket <var>' },
  { re: /\[[a-zA-Z][^\]]*\]/g, label: 'bracket [var]' },
  { re: /your\s+\w+\s+here/gi, label: 'literal English placeholder' },
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: 'hardcoded email (PII risk)' },
];

const VALID_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const VALID_K6_SCENARIOS = new Set(['load', 'stress', 'spike', 'soak']);

const SKILL_PATH = path.resolve(__dirname, '../../skills/test-case-review.md');

// ─── TestCaseReviewerAgent ────────────────────────────────────────────────────

/**
 * @class TestCaseReviewerAgent
 * @description Multi-dimensional quality reviewer for the test case suite.
 */
class TestCaseReviewerAgent {
  constructor() {
    this._logger = new Logger(STAGE_ID);
    this._annotations = [];
    this._skill = this._loadSkill();
  }

  // ── Entry Point ──────────────────────────────────────────────────────────

  /**
   * @param {Object} input
   * @param {Object} input.testCases           - Output of Agent 02
   * @param {Object} input.analyzedRequirements - Output of Agent 01
   * @returns {Promise<AgentResult>}
   */
  async run(input) {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);
    this._annotations = [];

    if (!input.testCases) {
      throw new Error('testCases artifact not found. Ensure Agent 02 completed successfully.');
    }

    try {
      const memoryContext = await memoryEngine.getContextForStage(STAGE_ID);
      await stateManager.markStageRunning(STAGE_ID);

      const { zephyrExport, k6ScenarioIndex } = input.testCases;
      const analysis = input.analyzedRequirements || {};

      this._logger.info('Review starting', {
        totalTCs: zephyrExport.totalTestCases,
        features: analysis.totalFeatures || 0,
      });

      // ── Phase 1: Duplicate Detection ───────────────────────────────────
      const dedupedTCs = this._removeDuplicates(zephyrExport.testCases);
      this._logger.info('Deduplication complete', {
        original: zephyrExport.testCases.length,
        deduped: dedupedTCs.length,
        removed: zephyrExport.testCases.length - dedupedTCs.length,
      });

      // ── Phase 2: Per-TC Multi-Dimensional Review ───────────────────────
      const reviewedTCs = dedupedTCs.map((tc) => this._reviewSingleTC(tc, analysis));

      // ── Phase 3: Coverage Adequacy Review ─────────────────────────────
      const coverageMatrix = this._buildCoverageMatrix(reviewedTCs, analysis);

      // ── Phase 4: API TC Review ─────────────────────────────────────────
      reviewedTCs.filter((tc) => tc.type === 'API').forEach((tc) => {
        this._reviewAPITC(tc);
      });

      // ── Phase 5: Performance TC Review ────────────────────────────────
      reviewedTCs.filter((tc) => tc.type === 'Performance').forEach((tc) => {
        this._reviewPerformanceTC(tc);
      });

      // ── Phase 6: Traceability Review ──────────────────────────────────
      reviewedTCs.forEach((tc) => this._reviewTraceability(tc, analysis));

      // ── Phase 7: Apply Improvement Rules from Memory ──────────────────
      this._applyMemoryImprovements(reviewedTCs, memoryContext.improvementRules);

      // ── Phase 8: Calculate Quality Score ──────────────────────────────
      const qualityScore = this._calculateQualityScore(reviewedTCs, coverageMatrix);

      // ── Phase 9: Determine Review Decision ────────────────────────────
      const decision = this._makeReviewDecision(qualityScore, this._annotations);

      // ── Phase 10: Extract Improvement Rules for Memory ────────────────
      await this._persistImprovementRules(this._annotations, qualityScore);

      // ── Phase 11: Build Final Output ──────────────────────────────────
      const output = this._buildOutput({
        originalTCs: zephyrExport.testCases,
        reviewedTCs,
        coverageMatrix,
        qualityScore,
        decision,
        k6ScenarioIndex,
        zephyrExport,
      });

      // ── Phase 12: Persist ──────────────────────────────────────────────
      await stateManager.setPipelineArtifact('reviewedTestCases', output);
      await stateManager.markStageCompleted(STAGE_ID, output);
      this._saveToDisk(output);

      const durationMs = Date.now() - startMs;
      this._logger.stage('COMPLETE', STAGE_ID, {
        grade: qualityScore.grade, decision, durationMs,
      });

      // ── Phase 13: Approval Gate ────────────────────────────────────────
      const warnings = this._annotations
        .filter((a) => a.severity === SEVERITY.MAJOR || a.severity === SEVERITY.BLOCKER)
        .map((a) => `[${a.severity}][${a.dimension}] ${a.tcKey}: ${a.finding}`);

      const agentResult = this._buildAgentResult(output, warnings, durationMs);

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
        `Grade: ${qualityScore.grade}, Score: ${qualityScore.overall}`,
      );

      return agentResult;
    } catch (error) {
      this._logger.error('Agent execution failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  // ── Phase 1: Duplicate Detection ─────────────────────────────────────────

  /**
   * Removes duplicate test cases based on hash and name similarity.
   * @private
   */
  _removeDuplicates(testCases) {
    const seen = new Map();
    const seenNames = new Map();
    const unique = [];

    for (const tc of testCases) {
      const nameKey = tc.name.toLowerCase().trim();
      const hashKey = tc.hash;

      if (seen.has(hashKey)) {
        this._addAnnotation(
          tc.key,
          REVIEW_DIMENSION.DUPLICATE,
          SEVERITY.MAJOR,
          `Duplicate hash detected. Matches: ${seen.get(hashKey)}`,
          REVIEW_ACTION.REJECTED,
          'Remove this TC. Keep the first occurrence.',
        );
        continue;
      }

      if (seenNames.has(nameKey)) {
        this._addAnnotation(
          tc.key,
          REVIEW_DIMENSION.DUPLICATE,
          SEVERITY.MAJOR,
          `Duplicate name detected. Matches: ${seenNames.get(nameKey)}`,
          REVIEW_ACTION.REJECTED,
          'Rename to differentiate or remove if truly duplicate.',
        );
        continue;
      }

      seen.set(hashKey, tc.key);
      seenNames.set(nameKey, tc.key);
      unique.push(tc);
    }

    return unique;
  }

  // ── Phase 2: Single TC Review ─────────────────────────────────────────────

  /**
   * Runs all applicable review dimensions on a single test case.
   * @private
   */
  _reviewSingleTC(tc, analysis) {
    const reviewed = {
      ...tc, reviewStatus: 'PASSED', reviewNotes: [], rewrittenSteps: 0,
    };

    this._reviewCompleteness(reviewed);
    this._reviewStepQuality(reviewed);
    this._reviewDataPlaceholders(reviewed);

    return reviewed;
  }

  // ── Dimension 1: Completeness ─────────────────────────────────────────────

  /**
   * @private
   */
  _reviewCompleteness(tc) {
    // Name check
    if (!tc.name || tc.name.trim().length < 10) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.COMPLETENESS,
        SEVERITY.BLOCKER,
        'Test case name is too short or empty.',
        REVIEW_ACTION.REJECTED,
        'Provide a concise, action-oriented name of at least 10 characters.',
      );
      tc.reviewStatus = 'REJECTED';
    }

    // Objective check
    if (!tc.objective || tc.objective.trim().length < 15) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.COMPLETENESS,
        SEVERITY.MAJOR,
        'Objective is missing or too brief.',
        REVIEW_ACTION.FLAGGED,
        'Describe clearly WHAT this test case verifies.',
      );
      if (tc.reviewStatus !== 'REJECTED') tc.reviewStatus = 'FLAGGED';
    }

    // Precondition check
    if (!tc.precondition || tc.precondition.includes('undefined')) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.COMPLETENESS,
        SEVERITY.MINOR,
        'Precondition is missing or contains "undefined".',
        REVIEW_ACTION.REWRITTEN,
        'Specify the system state required before this test begins.',
      );
      tc.precondition = 'Application is running and accessible. User with appropriate role is available.';
      tc.rewrittenSteps = (tc.rewrittenSteps || 0) + 1;
    }

    // Minimum steps check
    if (!tc.testSteps || tc.testSteps.length < 2) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.COMPLETENESS,
        SEVERITY.BLOCKER,
        `Only ${tc.testSteps?.length || 0} step(s) found. Minimum is 2.`,
        REVIEW_ACTION.REJECTED,
        'Add at minimum a setup step and a verification step.',
      );
      tc.reviewStatus = 'REJECTED';
    }

    // Expected result on every step
    if (tc.testSteps) {
      tc.testSteps.forEach((step, idx) => {
        if (!step.expectedResult || step.expectedResult.trim().length < 5) {
          this._addAnnotation(
            tc.key,
            REVIEW_DIMENSION.COMPLETENESS,
            SEVERITY.MAJOR,
            `Step ${idx + 1} has no expected result.`,
            REVIEW_ACTION.REWRITTEN,
            'Every step must have a measurable expected result.',
          );
          tc.testSteps[idx].expectedResult = '[REQUIRES CLARIFICATION — expected result not specified]';
          tc.rewrittenSteps = (tc.rewrittenSteps || 0) + 1;
        }
      });
    }

    // Priority check
    if (!['High', 'Medium', 'Low'].includes(tc.priority)) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.COMPLETENESS,
        SEVERITY.MINOR,
        `Invalid priority value: "${tc.priority}".`,
        REVIEW_ACTION.REWRITTEN,
        'Priority must be High, Medium, or Low.',
      );
      tc.priority = 'Medium';
    }

    // Labels check
    if (!tc.labels || tc.labels.length === 0) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.COMPLETENESS,
        SEVERITY.MINOR,
        'No labels assigned.',
        REVIEW_ACTION.REWRITTEN,
        'Assign at least one label (UI, Functional, API, etc.).',
      );
      tc.labels = ['Functional'];
    }
  }

  // ── Dimension 3: Step Quality ─────────────────────────────────────────────

  /**
   * Scores and rewrites low-quality steps.
   * @private
   */
  _reviewStepQuality(tc) {
    if (!tc.testSteps) return;

    tc.testSteps = tc.testSteps.map((step, idx) => {
      const score = this._scoreStep(step);

      if (score <= 2) {
        const rewritten = this._rewriteStep(step, tc);
        this._addAnnotation(
          tc.key,
          REVIEW_DIMENSION.STEP_QUALITY,
          SEVERITY.MAJOR,
          `Step ${idx + 1} quality score: ${score}/5 — "${step.description.slice(0, 60)}"`,
          REVIEW_ACTION.REWRITTEN,
          `Rewritten as: "${rewritten.description.slice(0, 60)}"`,
        );
        tc.rewrittenSteps = (tc.rewrittenSteps || 0) + 1;
        return { ...rewritten, _rewrittenByReviewer: true };
      }

      if (score === 3) {
        this._addAnnotation(
          tc.key,
          REVIEW_DIMENSION.STEP_QUALITY,
          SEVERITY.MINOR,
          `Step ${idx + 1} quality score: 3/5 — consider improving specificity.`,
          REVIEW_ACTION.FLAGGED,
          'Add specific data values or more precise expected results.',
        );
      }

      return step;
    });
  }

  /**
   * Scores a single step from 1–5.
   * @private
   */
  _scoreStep(step) {
    let score = 5;

    // Deduct for vague description
    if (VAGUE_PHRASES.some((p) => step.description?.toLowerCase().includes(p))) score -= 2;
    // Deduct for short description
    if (!step.description || step.description.length < 15) score -= 2;
    // Deduct for vague or missing expected result
    if (!step.expectedResult || step.expectedResult.length < 10) score -= 2;
    if (VAGUE_PHRASES.some((p) => step.expectedResult?.toLowerCase().includes(p))) score -= 1;
    // Deduct for missing test data when placeholder is expected
    if (step.testData === undefined || step.testData === null) score -= 1;

    return Math.max(1, score);
  }

  /**
   * Rewrites a low-quality step.
   * @private
   */
  _rewriteStep(step, tc) {
    const action = step.description || 'Perform the required action';
    const data = step.testData || '{{testData}}';
    const expected = step.expectedResult || 'Expected outcome is achieved without errors';

    return {
      ...step,
      description: `[REWRITTEN-BY-AGENT-03] ${action.replace(/check if|verify it|make sure/gi, 'Confirm that')}`,
      testData: data || 'N/A',
      expectedResult: expected.length < 10
        ? `Action completes successfully. System response is as designed for: ${tc.objective?.slice(0, 60) || 'this test case'}`
        : expected,
    };
  }

  // ── Dimension 4: Data Placeholder Validation ──────────────────────────────

  /**
   * @private
   */
  _reviewDataPlaceholders(tc) {
    if (!tc.testSteps) return;

    tc.testSteps.forEach((step, idx) => {
      const fieldsToCheck = [step.description, step.testData, step.expectedResult];

      for (const { re, label } of INVALID_PLACEHOLDER_PATTERNS) {
        const allText = fieldsToCheck.filter(Boolean).join(' ');
        if (re.test(allText)) {
          this._addAnnotation(
            tc.key,
            REVIEW_DIMENSION.DATA,
            SEVERITY.MINOR,
            `Step ${idx + 1} uses invalid placeholder format: ${label}`,
            REVIEW_ACTION.FLAGGED,
            'Use {{camelCaseVar}} format. Example: {{validEmail}}, {{authToken}}',
          );
          // Auto-fix: replace angle/bracket patterns with {{}} format
          tc.testSteps[idx].testData = (step.testData || '')
            .replace(/<([a-zA-Z][^>]*)>/g, '{{$1}}')
            .replace(/\[([a-zA-Z][^\]]*)\]/g, '{{$1}}');
          tc.rewrittenSteps = (tc.rewrittenSteps || 0) + 1;
        }
        re.lastIndex = 0;
      }
    });
  }

  // ── Dimension 2: Coverage Matrix ──────────────────────────────────────────

  /**
   * Builds a per-feature coverage matrix.
   * @private
   */
  _buildCoverageMatrix(reviewedTCs, analysis) {
    const features = (analysis.features || []).map((f) => {
      const featureTCs = reviewedTCs.filter((tc) => tc.traceabilityLinks?.featureId === f.id);
      const mins = MIN_COVERAGE[f.riskLevel] || MIN_COVERAGE.MEDIUM;

      const counts = {
        positive: featureTCs.filter((tc) => tc.type === 'Positive').length,
        negative: featureTCs.filter((tc) => tc.type === 'Negative').length,
        edge: featureTCs.filter((tc) => tc.type === 'Edge').length,
        api: featureTCs.filter((tc) => tc.type === 'API').length,
        perf: featureTCs.filter((tc) => tc.type === 'Performance').length,
      };

      const hasSmoke = featureTCs.some((tc) => tc.labels?.includes('Smoke'));

      // Coverage violations
      if (counts.positive < mins.positive) {
        this._addAnnotation(
          `FEATURE-${f.id}`,
          REVIEW_DIMENSION.COVERAGE,
          f.riskLevel === 'CRITICAL' ? SEVERITY.BLOCKER : SEVERITY.MAJOR,
          `Feature "${f.name}" has only ${counts.positive}/${mins.positive} positive TCs`,
          REVIEW_ACTION.FLAGGED,
          `Add ${mins.positive - counts.positive} more positive TCs for this ${f.riskLevel} risk feature`,
        );
      }

      if (counts.negative < mins.negative) {
        this._addAnnotation(
          `FEATURE-${f.id}`,
          REVIEW_DIMENSION.COVERAGE,
          f.riskLevel === 'CRITICAL' ? SEVERITY.BLOCKER : SEVERITY.MAJOR,
          `Feature "${f.name}" has only ${counts.negative}/${mins.negative} negative TCs`,
          REVIEW_ACTION.FLAGGED,
          `Add ${mins.negative - counts.negative} more negative TCs`,
        );
      }

      if (mins.smoke && !hasSmoke) {
        this._addAnnotation(
          `FEATURE-${f.id}`,
          REVIEW_DIMENSION.COVERAGE,
          SEVERITY.MAJOR,
          `Feature "${f.name}" (${f.riskLevel}) has no Smoke-labelled TCs`,
          REVIEW_ACTION.FLAGGED,
          'Mark at least one critical positive TC as Smoke',
        );
      }

      // Score this feature
      const coverageScore = this._scoreCoverage(counts, mins, hasSmoke);

      let status = COVERAGE_STATUS.ADEQUATE;
      if (coverageScore < 60) status = COVERAGE_STATUS.INSUFFICIENT;
      else if (coverageScore < 80) status = COVERAGE_STATUS.PARTIAL;

      return {
        featureId: f.id,
        featureName: f.name,
        riskLevel: f.riskLevel,
        positiveCount: counts.positive,
        negativeCount: counts.negative,
        edgeCount: counts.edge,
        apiCount: counts.api,
        perfCount: counts.perf,
        hasSmoke,
        coverageScore,
        status,
      };
    });

    return { features };
  }

  /**
   * Scores coverage for a feature (0–100).
   * @private
   */
  _scoreCoverage(counts, mins, hasSmoke) {
    const posRatio = Math.min(counts.positive / Math.max(mins.positive, 1), 1);
    const negRatio = Math.min(counts.negative / Math.max(mins.negative, 1), 1);
    const edgeRatio = mins.edge > 0
      ? Math.min(counts.edge / mins.edge, 1)
      : 1;

    // Base coverage ratio across positive, negative, and edge (max 94)
    const baseScore = posRatio * 38 + negRatio * 38 + edgeRatio * 18;

    // Verify multi-type test coverage (API & Performance credit, up to 2 bonus points)
    let typeCredit = 0;
    if (counts.api > 0) typeCredit += 1;
    if (counts.perf > 0) typeCredit += 1;

    let score = Math.min(96, Math.round(baseScore + typeCredit));
    if (mins.smoke && !hasSmoke) score = Math.max(0, score - 10);

    return score;
  }

  // ── Dimension 6: API TC Review ────────────────────────────────────────────

  /**
   * @private
   */
  _reviewAPITC(tc) {
    const api = tc.apiDetails;
    if (!api) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.API,
        SEVERITY.BLOCKER,
        'API test case is missing apiDetails block.',
        REVIEW_ACTION.REJECTED,
        'Populate apiDetails with method, endpoint, headers, and expectedStatusCode.',
      );
      tc.reviewStatus = 'REJECTED';
      return;
    }

    // Method check
    if (!VALID_HTTP_METHODS.has(api.method)) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.API,
        SEVERITY.MAJOR,
        `Invalid HTTP method: "${api.method}"`,
        REVIEW_ACTION.REWRITTEN,
        `Use one of: ${[...VALID_HTTP_METHODS].join(', ')}`,
      );
      api.method = 'GET';
    }

    // Endpoint check
    if (!api.endpoint || api.endpoint === '{{apiEndpoint}}') {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.API,
        SEVERITY.MAJOR,
        'Endpoint is a placeholder — not resolved.',
        REVIEW_ACTION.FLAGGED,
        'Resolve the actual API endpoint path before automation.',
      );
    }

    // Status code check
    if (!api.expectedStatusCode || typeof api.expectedStatusCode !== 'number') {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.API,
        SEVERITY.MAJOR,
        'expectedStatusCode is missing or not a number.',
        REVIEW_ACTION.REWRITTEN,
        'Set the correct HTTP status code (200, 201, 400, 401, etc.).',
      );
      api.expectedStatusCode = 200;
    }

    // Negative TCs must not expect 200
    if (tc.type === 'API' && tc.name.includes('[NEG]') && api.expectedStatusCode === 200) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.API,
        SEVERITY.MAJOR,
        'Negative API TC expects HTTP 200 — this is likely incorrect.',
        REVIEW_ACTION.FLAGGED,
        'Set the correct error code (400, 401, 403, 404, etc.) for this negative scenario.',
      );
    }

    // Auth check
    if (api.authRequired === undefined) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.API,
        SEVERITY.MINOR,
        'authRequired is undefined.',
        REVIEW_ACTION.REWRITTEN,
        'Explicitly set authRequired to true or false.',
      );
      api.authRequired = true;
    }
  }

  // ── Dimension 7: Performance TC Review ───────────────────────────────────

  /**
   * @private
   */
  _reviewPerformanceTC(tc) {
    const ref = tc.performanceRef;
    if (!ref) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.PERFORMANCE,
        SEVERITY.BLOCKER,
        'Performance TC missing performanceRef block.',
        REVIEW_ACTION.REJECTED,
        'Populate performanceRef with k6ScriptPath, scenario, vus, duration, thresholds.',
      );
      tc.reviewStatus = 'REJECTED';
      return;
    }

    // Script path naming convention check
    const scriptPathRe = /^tests\/k6\/F-?\d{1,3}-US-?\d{1,3}-(load|stress|spike|soak)-test\.js$/;
    if (!scriptPathRe.test(ref.k6ScriptPath)) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.PERFORMANCE,
        SEVERITY.MINOR,
        `k6ScriptPath "${ref.k6ScriptPath}" doesn't follow naming convention.`,
        REVIEW_ACTION.FLAGGED,
        'Use: tests/k6/{featureId}-{storyId}-{scenario}-test.js',
      );
    }

    // Scenario check
    if (!VALID_K6_SCENARIOS.has(ref.scenario)) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.PERFORMANCE,
        SEVERITY.MAJOR,
        `Invalid K6 scenario: "${ref.scenario}"`,
        REVIEW_ACTION.REWRITTEN,
        `Use one of: ${[...VALID_K6_SCENARIOS].join(', ')}`,
      );
      ref.scenario = 'load';
    }

    // Thresholds must be 'global'
    if (ref.thresholds !== 'global') {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.PERFORMANCE,
        SEVERITY.MINOR,
        `thresholds is "${ref.thresholds}" — should be "global" per framework config.`,
        REVIEW_ACTION.REWRITTEN,
        'Set thresholds to "global" to use K6_CONFIG values.',
      );
      ref.thresholds = 'global';
    }

    // Target endpoint still a placeholder
    if (!ref.targetEndpoint || ref.targetEndpoint === '{{targetEndpoint}}') {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.PERFORMANCE,
        SEVERITY.MAJOR,
        'targetEndpoint is unresolved placeholder.',
        REVIEW_ACTION.FLAGGED,
        'Resolve actual endpoint before K6 script generation.',
      );
    }
  }

  // ── Dimension 8: Traceability Review ─────────────────────────────────────

  /**
   * @private
   */
  _reviewTraceability(tc, analysis) {
    const links = tc.traceabilityLinks;
    const features = (analysis.features || []);

    if (!links || !links.featureId || !links.userStoryId) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.TRACEABILITY,
        SEVERITY.MAJOR,
        'Missing traceabilityLinks — TC cannot be traced to a requirement.',
        REVIEW_ACTION.FLAGGED,
        'Assign featureId and userStoryId from the requirements analysis.',
      );
      return;
    }

    const featureExists = features.some((f) => f.id === links.featureId);
    if (!featureExists && features.length > 0) {
      this._addAnnotation(
        tc.key,
        REVIEW_DIMENSION.TRACEABILITY,
        SEVERITY.MAJOR,
        `featureId "${links.featureId}" not found in requirements analysis.`,
        REVIEW_ACTION.FLAGGED,
        'Correct the featureId or check if requirement was modified.',
      );
    }
  }

  // ── Phase 7: Memory Improvements ─────────────────────────────────────────

  /**
   * @private
   */
  _applyMemoryImprovements(reviewedTCs, rules) {
    if (!rules || rules.length === 0) return;
    this._logger.info('Applying memory improvement rules', { count: rules.length });

    for (const rule of rules) {
      if (rule.appliesTo !== STAGE_ID && rule.appliesTo !== 'ALL') continue;

      if (rule.action === 'FLAG_MISSING_SMOKE_LABELS') {
        reviewedTCs.forEach((tc) => {
          if (tc.type === 'Positive' && tc.priority === 'High' && !tc.labels?.includes('Smoke')) {
            tc.labels = [...(tc.labels || []), 'Smoke'];
            this._logger.info('Auto-applied Smoke label from memory rule', { tcKey: tc.key });
          }
        });
      }
    }
  }

  // ── Phase 8: Quality Score ────────────────────────────────────────────────

  /**
   * Calculates an overall quality score with dimension breakdown.
   * @private
   */
  _calculateQualityScore(reviewedTCs, coverageMatrix) {
    const total = reviewedTCs.length || 1;

    // Completeness: % of TCs with no BLOCKER completeness findings
    const completenessBlockers = this._annotations.filter(
      (a) => a.dimension === REVIEW_DIMENSION.COMPLETENESS && a.severity === SEVERITY.BLOCKER,
    ).length;
    const completeness = Math.max(0, 100 - (completenessBlockers / total) * 100);

    // Coverage: average of feature coverage scores
    const coverageScores = coverageMatrix.features.map((f) => f.coverageScore);
    const coverage = coverageScores.length > 0
      ? Math.round(coverageScores.reduce((a, b) => a + b, 0) / coverageScores.length)
      : 95;

    // Step Quality: % of TCs with no step quality rewrites
    const rewrittenTCs = reviewedTCs.filter((tc) => tc.rewrittenSteps > 0).length;
    const stepQuality = Math.max(0, 100 - (rewrittenTCs / total) * 80);

    // Traceability: % TCs with valid traceability links
    const orphaned = this._annotations.filter(
      (a) => a.dimension === REVIEW_DIMENSION.TRACEABILITY,
    ).length;
    const traceability = Math.max(0, 100 - (orphaned / total) * 100);

    // Data quality: % TCs without data findings
    const dataFindings = this._annotations.filter(
      (a) => a.dimension === REVIEW_DIMENSION.DATA,
    ).length;
    const dataQuality = Math.max(0, 100 - (dataFindings / total) * 50);

    const overall = Math.round(
      completeness * DIMENSION_WEIGHTS.completeness
      + coverage * DIMENSION_WEIGHTS.coverage
      + stepQuality * DIMENSION_WEIGHTS.stepQuality
      + traceability * DIMENSION_WEIGHTS.traceability
      + dataQuality * DIMENSION_WEIGHTS.dataQuality,
    );

    const grade = overall >= 90 ? 'A'
      : overall >= 75 ? 'B'
        : overall >= 60 ? 'C'
          : overall >= 40 ? 'D'
            : 'F';

    return {
      overall: Math.round(overall),
      completeness: Math.round(completeness),
      coverage: Math.round(coverage),
      stepQuality: Math.round(stepQuality),
      traceability: Math.round(traceability),
      dataQuality: Math.round(dataQuality),
      grade,
    };
  }

  // ── Phase 9: Review Decision ──────────────────────────────────────────────

  /**
   * @private
   */
  _makeReviewDecision(qualityScore, annotations) {
    const hasBlocker = annotations.some((a) => a.severity === SEVERITY.BLOCKER);

    if (hasBlocker) return 'REJECT';
    if (qualityScore.grade === 'D' || qualityScore.grade === 'F') return 'REJECT';
    if (qualityScore.grade === 'C') return 'APPROVE_WITH_WARNINGS';
    return 'APPROVE';
  }

  // ── Improvement Rule Persistence ──────────────────────────────────────────

  /**
   * Extracts recurring patterns and persists as improvement rules for Agent 02.
   * @private
   */
  async _persistImprovementRules(annotations, qualityScore) {
    const missingSmoke = annotations.filter(
      (a) => a.finding.includes('no Smoke-labelled'),
    ).length;

    const missingNegative = annotations.filter(
      (a) => a.finding.includes('negative TCs'),
    ).length;

    if (missingSmoke > 1) {
      await memoryEngine.addImprovementRule({
        id: 'RULE-03-001',
        description: 'Agent 02 frequently misses Smoke labels on High/Critical positive TCs',
        appliesTo: '02-test-case-generator',
        action: 'ADD_SMOKE_LABELS',
        addedAt: new Date().toISOString(),
      });
    }

    if (missingNegative > 2) {
      await memoryEngine.addImprovementRule({
        id: 'RULE-03-002',
        description: 'Agent 02 generating insufficient negative TCs for high-risk features',
        appliesTo: '02-test-case-generator',
        action: 'INCREASE_NEGATIVE_TC_COUNT',
        addedAt: new Date().toISOString(),
      });
    }

    this._logger.info('Improvement rules persisted to memory');
  }

  // ── Output Builders ───────────────────────────────────────────────────────

  /**
   * @private
   */
  _buildOutput({
    originalTCs, reviewedTCs, coverageMatrix, qualityScore, decision, k6ScenarioIndex, zephyrExport,
  }) {
    const approvedTCs = reviewedTCs.filter((tc) => tc.reviewStatus !== 'REJECTED');
    const rejectedTCs = reviewedTCs.filter((tc) => tc.reviewStatus === 'REJECTED');
    const rewrittenTCs = reviewedTCs.filter((tc) => tc.rewrittenSteps > 0);
    const blockers = this._annotations.filter((a) => a.severity === SEVERITY.BLOCKER);

    return {
      reviewId: `tc_review_${Date.now()}`,
      reviewedAt: new Date().toISOString(),
      reviewedBy: 'ARIA-Agent-03',
      originalCount: originalTCs.length,
      approvedCount: approvedTCs.length,
      rejectedCount: rejectedTCs.length,
      rewrittenCount: rewrittenTCs.length,
      duplicatesRemoved: originalTCs.length - reviewedTCs.length,
      reviewDecision: decision,

      reviewedZephyrExport: {
        ...zephyrExport,
        testCases: approvedTCs,
        totalTestCases: approvedTCs.length,
      },

      k6ScenarioIndex,
      reviewAnnotations: this._annotations,
      coverageMatrix,
      qualityScore,

      recommendations: this._buildRecommendations(qualityScore, coverageMatrix, blockers),
      blockers: blockers.map((b) => `[${b.tcKey}] ${b.finding}`),
    };
  }

  /**
   * @private
   */
  _buildRecommendations(qualityScore, coverageMatrix, blockers) {
    const recs = [];

    if (qualityScore.grade === 'A') {
      recs.push('✅ Excellent test case quality. Proceed to test data generation.');
    }
    if (qualityScore.coverage < 70) {
      recs.push('⚠️ Coverage below 70%. Request Agent 02 to generate more negative and edge TCs.');
    }
    if (qualityScore.stepQuality < 75) {
      recs.push('⚠️ Step quality needs improvement. Review rewritten steps before proceeding.');
    }
    if (blockers.length > 0) {
      recs.push(`🔴 ${blockers.length} BLOCKER(s) found. Must be resolved before proceeding.`);
    }
    const insufficientFeatures = coverageMatrix.features.filter(
      (f) => f.status === COVERAGE_STATUS.INSUFFICIENT,
    );
    if (insufficientFeatures.length > 0) {
      recs.push(`⚠️ ${insufficientFeatures.length} feature(s) have insufficient test coverage.`);
    }

    return recs;
  }

  /**
   * @private
   */
  _buildApprovalSummary(output) {
    return {
      'Review Decision': output.reviewDecision,
      'Quality Grade': `${output.qualityScore.grade} (${output.qualityScore.overall}/100)`,
      'Original TCs': output.originalCount,
      'Approved TCs': output.approvedCount,
      'Rejected TCs': output.rejectedCount,
      'Rewritten TCs': output.rewrittenCount,
      'Duplicates Removed': output.duplicatesRemoved,
      'Blockers Found': output.blockers.length,
      'Total Annotations': output.reviewAnnotations.length,
      'Coverage Score': `${output.qualityScore.coverage}/100`,
      'Step Quality Score': `${output.qualityScore.stepQuality}/100`,
    };
  }

  /**
   * @private
   */
  _buildAgentResult(output, warnings, durationMs) {
    return {
      agentId: STAGE_ID,
      stageNumber: '03',
      stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED,
      output,
      clarifications: [],
      warnings,
      memoryUpdate: {
        qualityGrade: output.qualityScore.grade,
        reviewScore: output.qualityScore.overall,
      },
      timestamp: new Date().toISOString(),
      durationMs,
      approvalStatus: 'PENDING',
      approvalComment: '',
    };
  }

  // ── Annotation Helper ─────────────────────────────────────────────────────

  /**
   * @private
   */
  _addAnnotation(tcKey, dimension, severity, finding, action, suggestion) {
    this._annotations.push({
      tcKey, dimension, severity, finding, action, suggestion,
    });
    this._logger.debug(`[${severity}][${dimension}] ${tcKey}: ${finding}`);
  }

  // ── Disk & Skill ──────────────────────────────────────────────────────────

  /**
   * @private
   */
  _saveToDisk(output) {
    const outDir = path.resolve(__dirname, '../../reports/json');
    const outPath = path.join(outDir, `test-case-review-${Date.now()}.json`);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    this._logger.info('Review report saved', { path: outPath });
  }

  /**
   * @private
   */
  _loadSkill() {
    try { return fs.readFileSync(SKILL_PATH, 'utf-8'); } catch { return ''; }
  }
}

// ─── Export & CLI ─────────────────────────────────────────────────────────────

export { TestCaseReviewerAgent };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const opts: any = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') continue;
      if (arg.startsWith('--')) {
        const [key, val] = arg.slice(2).split('=');
        opts[key] = val || args[i + 1];
        if (!val) i++;
      }
    }

    let activeProjectId = opts.project;
    if (!activeProjectId) {
      try {
        const stateDb = stateManager.getDatabase();
        const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
        if (latestRun?.project_id) {
          activeProjectId = latestRun.project_id;
        }
      } catch (_) {}
    }
    activeProjectId = activeProjectId || FRAMEWORK_CONFIG.projectId;

    await stateManager.initialize(activeProjectId);
    await memoryEngine.initialize(activeProjectId);

    const agent = new TestCaseReviewerAgent();
    const testCases = await stateManager.getPipelineArtifact('testCases');
    const analyzedRequirements = await stateManager.getPipelineArtifact('analyzedRequirements');

    if (!testCases) {
      console.error(`❌ No test cases found for project "${activeProjectId}". Run Agent 02 first.`);
      process.exit(1);
    }

    const result = await agent.run({ testCases, analyzedRequirements });
    console.log(`\n✅ Agent 03 complete — Grade: ${result.output.qualityScore.grade} | Decision: ${result.output.reviewDecision}`);
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })();
}
