'use strict';

/**
 * @fileoverview Agent 02 — Test Case Generator.
 * Generates requirement-grounded Gherkin scenarios per user story with the LLM, enforces grammar,
 * grounding and coverage with a deterministic validator + self-correction loop, and persists the
 * resulting test cases for Agent 03.
 *
 * @module TestCaseGeneratorAgent
 * @version 3.0.0
 */

import * as path from 'path';
import * as fs from 'fs';
import pLimit from 'p-limit';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { llmClient } from '../../core/llm/LLMClient';
import { TestCase, TestCasesArtifact } from '../../core/types';

import {
  STAGE_ID, STAGE_NAME, STAGE_NUMBER, NEXT_STAGE, SKILL_PATH, LEARNINGS_PATH, LLM_SETTINGS, SKIP_OPTIONS, TC_TYPE,
} from './constants';
import { normalizeAnalysis, NormalizedAnalysis } from './analysis/normalizeAnalysis';
import { generateStoryScenarios, ChatMessage, StoryGenerationOutcome } from './generation/storyGenerator';
import {
  buildTestCases, buildCoverageWarnings, computeRequirementCoverage, RequirementCoverage,
} from './builders/testCaseBuilder';
import { syncFeatureFiles } from './utils';

/** Agent input. */
export interface TestCaseGeneratorInput {
  analyzedRequirements: any;
  opts?: Record<string, unknown>;
}

interface GenerationSummary {
  testCases: TestCase[];
  warnings: string[];
  clarifications: string[];
  coverage: RequirementCoverage;
}

/**
 * Resolves --skip-* options into excluded Gherkin type tags.
 * @param {Record<string, unknown>} [opts]
 * @returns {ReadonlySet<string>}
 */
export function resolveExcludedTypeTags(opts: Record<string, unknown> = {}): ReadonlySet<string> {
  return new Set(Object.entries(SKIP_OPTIONS).filter(([flag]) => Boolean(opts[flag])).map(([, tag]) => tag));
}

function buildApprovalSummary(testCases: TestCase[], coverage: RequirementCoverage, featureFilePaths: string[]) {
  const count = (type: string) => testCases.filter((tc) => tc.type === type).length;
  return {
    'Total Test Cases': testCases.length,
    'Positive TCs': count(TC_TYPE.POSITIVE),
    'Negative TCs': count(TC_TYPE.NEGATIVE),
    'Edge TCs': count(TC_TYPE.EDGE),
    'API TCs': count(TC_TYPE.API),
    'Performance TCs': count(TC_TYPE.PERFORMANCE),
    'Acceptance Criteria Covered': `${coverage.acceptanceCriteria.covered}/${coverage.acceptanceCriteria.total}`,
    'Business Rules Covered': `${coverage.businessRules.covered}/${coverage.businessRules.total}`,
    'Feature Files Synced': featureFilePaths.length,
    Format: 'Gherkin BDD Feature Files',
  };
}

/**
 * @class TestCaseGeneratorAgent
 * @description Orchestrates requirement-grounded test case generation.
 */
export class TestCaseGeneratorAgent {
  private _logger: Logger;

  private _skill: string;

  constructor() {
    this._logger = new Logger(STAGE_ID);
    this._skill = this._loadSkill();
  }

  /**
   * Runs the stage end-to-end, including the human approval gate.
   * @param {TestCaseGeneratorInput} input
   * @returns {Promise<any>} AgentResult
   */
  async run(input: TestCaseGeneratorInput): Promise<any> {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);
    if (!input.analyzedRequirements) {
      throw new Error('analyzedRequirements not provided. Ensure Agent 01 completed successfully.');
    }

    try {
      const memoryContext = await memoryEngine.getContextForStage(STAGE_ID);
      await stateManager.markStageRunning(STAGE_ID);
      llmClient.resetStageFallback(STAGE_ID);

      const generation = await this._generate(input, memoryContext);
      const output: TestCasesArtifact = {
        zephyrExport: { totalTestCases: generation.testCases.length, testCases: generation.testCases },
      };
      const featureFilePaths = syncFeatureFiles(input.analyzedRequirements, generation.testCases, this._logger);

      const usage = llmClient.getStageUsage(STAGE_ID);
      await stateManager.setPipelineArtifact('testCases', output);
      await stateManager.markStageCompleted(STAGE_ID, output, usage);
      this._saveToDisk(output);

      const durationMs = Date.now() - startMs;
      this._logger.stage('COMPLETE', STAGE_ID, { totalTCs: generation.testCases.length, durationMs });
      return await this._awaitApproval(output, generation, featureFilePaths, usage, durationMs);
    } catch (error: any) {
      this._logger.error('Agent execution failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  // ── Generation ───────────────────────────────────────────────────────────

  private async _generate(input: TestCaseGeneratorInput, memoryContext: any): Promise<GenerationSummary> {
    const normalized = normalizeAnalysis(input.analyzedRequirements);
    const excludedTypeTags = resolveExcludedTypeTags(input.opts);
    this._logger.info('Starting requirement-grounded generation', {
      features: normalized.features.length,
      stories: normalized.features.reduce((sum, f) => sum + f.userStories.length, 0),
      excludedTypes: [...excludedTypeTags],
      memoryRules: memoryContext.improvementRules?.length || 0,
    });

    const outcomes = await this._generateStories(normalized, excludedTypeTags, memoryContext);
    const testCases = buildTestCases(outcomes);
    return {
      testCases,
      warnings: [
        ...normalized.warnings,
        ...outcomes.flatMap((outcome) => outcome.warnings),
        ...buildCoverageWarnings(normalized.features, testCases, excludedTypeTags),
      ],
      clarifications: normalized.clarifications,
      coverage: computeRequirementCoverage(normalized.features, testCases),
    };
  }

  private async _generateStories(
    normalized: NormalizedAnalysis,
    excludedTypeTags: ReadonlySet<string>,
    memoryContext: any,
  ): Promise<StoryGenerationOutcome[]> {
    const limit = pLimit(Math.max(1, FRAMEWORK_CONFIG.maxThreads));
    const jobs = normalized.features.flatMap((feature) => feature.userStories.map((story) => limit(async () => {
      this._logger.info(`Generating scenarios for ${feature.id}/${story.id}`, {
        acceptanceCriteria: story.acceptanceCriteria.length, businessRules: story.businessRules.length,
      });
      const outcome = await generateStoryScenarios({
        feature,
        story,
        systemPrompt: this._skill,
        excludedTypeTags,
        openAmbiguities: normalized.openAmbiguities,
        stateTransitions: normalized.stateTransitions,
        memoryContext,
        maxRetries: FRAMEWORK_CONFIG.selfReviewRetries,
      }, (messages) => this._chat(messages));
      this._logger.info(`${feature.id}/${story.id}: ${outcome.scenarios.length} valid scenario(s) in ${outcome.attempts} attempt(s)`);
      return outcome;
    })));
    // Promise.all preserves job order, which keeps TC keys deterministic.
    return Promise.all(jobs);
  }

  private async _chat(messages: ChatMessage[]): Promise<string> {
    const response = await llmClient.chat(STAGE_ID, {
      messages,
      temperature: LLM_SETTINGS.TEMPERATURE,
      max_tokens: LLM_SETTINGS.MAX_TOKENS,
    });
    return response.text || '';
  }

  // ── Approval & Persistence ───────────────────────────────────────────────

  private async _awaitApproval(
    output: TestCasesArtifact,
    generation: GenerationSummary,
    featureFilePaths: string[],
    usage: any,
    durationMs: number,
  ): Promise<any> {
    const { testCases } = output.zephyrExport;
    const agentResult = this._buildAgentResult(output, generation, durationMs);
    const gateResult = await approvalGate.waitForApproval({
      stageId: STAGE_ID,
      stageName: STAGE_NAME,
      nextStageName: NEXT_STAGE,
      summary: buildApprovalSummary(testCases, generation.coverage, featureFilePaths),
      fullOutput: output.zephyrExport,
      warnings: generation.warnings,
      clarifications: generation.clarifications,
      usage,
    });

    agentResult.approvalStatus = gateResult.status;
    agentResult.approvalComment = gateResult.comment;
    await memoryEngine.recordApprovalFeedback(STAGE_ID, gateResult.status, gateResult.comment, `TCs: ${testCases.length}`);
    return agentResult;
  }

  private _buildAgentResult(output: TestCasesArtifact, generation: GenerationSummary, durationMs: number) {
    return {
      agentId: STAGE_ID,
      stageNumber: STAGE_NUMBER,
      stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED,
      output,
      clarifications: generation.clarifications,
      warnings: generation.warnings,
      memoryUpdate: {
        testCaseCount: output.zephyrExport.totalTestCases,
        uncoveredRequirements: generation.coverage.uncovered,
      },
      timestamp: new Date().toISOString(),
      durationMs,
      approvalStatus: 'PENDING',
      approvalComment: '',
    };
  }

  private _saveToDisk(output: TestCasesArtifact): void {
    if (process.env.SAVE_ZEPHYR_DISK_JSON !== 'true') return;
    const outDir = path.resolve(__dirname, '../../reports/json');
    fs.mkdirSync(outDir, { recursive: true });
    const tcPath = path.join(outDir, `test-cases-zephyr-${Date.now()}.json`);
    fs.writeFileSync(tcPath, JSON.stringify(output.zephyrExport, null, 2), 'utf-8');
    this._logger.info('Test cases saved to disk', { tcPath });
  }

  private _loadSkill(): string {
    if (!fs.existsSync(SKILL_PATH)) throw new Error(`Agent 02 skill file not found: ${SKILL_PATH}`);
    const skill = fs.readFileSync(SKILL_PATH, 'utf-8');
    const learnings = fs.existsSync(LEARNINGS_PATH) ? fs.readFileSync(LEARNINGS_PATH, 'utf-8') : '';
    return learnings ? `${skill}\n\n${learnings}` : skill;
  }
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

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

function resolveProjectId(opts: Record<string, any>): string {
  if (opts.project) return opts.project;
  try {
    const latestRun = (stateManager as any).getDatabase()
      .prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1")
      .get() as any;
    if (latestRun?.project_id) return latestRun.project_id;
  } catch (_) { /* fall through to config */ }
  return FRAMEWORK_CONFIG.projectId || 'default';
}

if (require.main === module) {
  (async () => {
    const opts = parseCliArgs(process.argv.slice(2));
    const projectId = resolveProjectId(opts);
    await stateManager.initialize(projectId);
    await memoryEngine.initialize(projectId);

    const analyzedRequirements = await stateManager.getPipelineArtifact('analyzedRequirements');
    if (!analyzedRequirements) {
      console.error(`❌ No analyzed requirements found for project "${projectId}". Run Agent 01 first.`);
      process.exit(1);
    }

    const result = await new TestCaseGeneratorAgent().run({ analyzedRequirements, opts });
    console.log(`\n✅ Agent 02 completed — ${result.output.zephyrExport.totalTestCases} test cases generated`);
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })().catch((err) => {
    console.error('Fatal error in Agent 02 CLI:', err);
    process.exit(1);
  });
}
