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

import { stateManager, STAGE_STATUS, APPROVAL_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { llmClient } from '../../core/llm/LLMClient';
import { TestCase, TestCasesArtifact, GenerationMeta } from '../../core/types';

import {
  STAGE_ID, STAGE_NAME, STAGE_NUMBER, NEXT_STAGE, SKILL_PATH, LEARNINGS_PATH, LLM_SETTINGS, SKIP_OPTIONS, TC_TYPE,
} from './constants';
import { normalizeAnalysis, NormalizedAnalysis, redactNormalizedAnalysis } from './analysis/normalizeAnalysis';
import {
  generateStoryScenarios, ChatMessage, ChatReply, StoryGenerationOutcome,
} from './generation/storyGenerator';
import {
  buildTestCases, buildCoverageWarnings, computeRequirementCoverage, RequirementCoverage,
} from './builders/testCaseBuilder';
import { syncFeatureFiles } from './utils';
import { buildGenerationMeta, describeInputChanges, formatInputChanges } from './generation/generationMeta';
import { filterByActiveTypes, resolveActiveTypeTags } from './prompts/systemPrompt';
import { buildPromptTrace } from './generation/promptTrace';
import { assertTestCasesGenerated } from './generation/emptyResultGuard';
import { linkOpenAmbiguities } from './analysis/ambiguityLinks';
import { LATEST_PROJECT_SQL } from '../../core/state-manager/projectResolver';
import { loadAutProfile } from '../../core/aut/AutProfile';
import { KnownSecret, profileSecrets } from '../../core/aut/knownSecrets';

const PROMPT_TRACE_FILE = 'test-case-generation-prompt-trace.json';

/** Agent input. */
export interface TestCaseGeneratorInput {
  analyzedRequirements: any;
  opts?: Record<string, unknown>;
}

/** The project facts generation depends on; resolved from the AUT profile unless given (the eval suite gives them). */
export interface GenerationEnvironment {
  credentialNames: string[];
  secrets: KnownSecret[];
}

/** What one generation produced. */
export interface GenerationSummary {
  testCases: TestCase[];
  warnings: string[];
  clarifications: string[];
  coverage: RequirementCoverage;
  meta: GenerationMeta;
  /** Inputs changed since the previous generation; null when there is nothing to compare. */
  inputChanges: string[] | null;
}

/** What the prompt trace records about a run, filled in as the run progresses. */
interface TraceContext {
  opts?: Record<string, unknown>;
  memoryContext?: any;
  systemPrompt?: string;
  outcomes?: StoryGenerationOutcome[];
  warnings?: string[];
  testCaseCount?: number;
}

/**
 * Resolves --skip-* options into excluded Gherkin type tags.
 * @param {Record<string, unknown>} [opts]
 * @returns {ReadonlySet<string>}
 */
export function resolveExcludedTypeTags(opts: Record<string, unknown> = {}): ReadonlySet<string> {
  return new Set(Object.entries(SKIP_OPTIONS).filter(([flag]) => Boolean(opts[flag])).map(([, tag]) => tag));
}

function buildApprovalSummary(testCases: TestCase[], generation: GenerationSummary) {
  const { coverage, meta } = generation;
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
    'Feature Files': 'written after approval',
    'Skipped Types': meta.excludedTypes.join(', ') || 'none',
    'Models Used': meta.modelsUsed.join(', ') || 'unknown',
    'Changed Since Last Run': formatInputChanges(generation.inputChanges),
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

    llmClient.clearCallTraces();
    const trace: TraceContext = { opts: input.opts };

    try {
      const memoryContext = await memoryEngine.getContextForStage(STAGE_ID);
      trace.memoryContext = memoryContext;
      await stateManager.markStageRunning(STAGE_ID);
      const previous = (await stateManager.getLatestArtifactForProject('testCases'))?.zephyrExport;

      const generation = await this._generate(input, memoryContext, trace);
      assertTestCasesGenerated(generation);
      generation.inputChanges = describeInputChanges(previous?.generationMeta, generation.meta);
      if (generation.inputChanges?.length === 0 && previous.totalTestCases !== generation.testCases.length) {
        generation.warnings.push(`Inputs are identical to the previous generation but the test case count changed `
          + `(${previous.totalTestCases} → ${generation.testCases.length}) — LLM output drift`);
      }
      const output: TestCasesArtifact = {
        zephyrExport: { totalTestCases: generation.testCases.length, testCases: generation.testCases, generationMeta: generation.meta },
      };

      const usage = llmClient.getStageUsage(STAGE_ID);
      await stateManager.setPipelineArtifact('testCases', output);
      await stateManager.markStageCompleted(STAGE_ID, output, usage);
      this._saveToDisk(output);
      await this._savePromptTrace(trace, 'COMPLETED');

      const durationMs = Date.now() - startMs;
      this._logger.stage('COMPLETE', STAGE_ID, {
        totalTCs: generation.testCases.length, durationMs, modelsUsed: generation.meta.modelsUsed, inputChanges: generation.inputChanges,
      });
      return await this._awaitApproval(output, generation, input.analyzedRequirements, usage, durationMs);
    } catch (error: any) {
      this._logger.error('Agent execution failed', { error: error.message });
      await this._savePromptTrace(trace, 'FAILED', error.message);
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  // ── Generation ───────────────────────────────────────────────────────────

  private async _generate(
    input: TestCaseGeneratorInput,
    memoryContext: any,
    trace: TraceContext,
    environment: GenerationEnvironment = { credentialNames: this._credentialNames(), secrets: this._knownSecrets() },
  ): Promise<GenerationSummary> {
    const normalized = normalizeAnalysis(input.analyzedRequirements);
    const { secrets } = environment;
    const redacted = redactNormalizedAnalysis(normalized, secrets);
    if (redacted > 0) normalized.warnings.push(`Secrets: replaced secret values with placeholders in ${redacted} requirement text(s) before generation`);
    const excludedTypeTags = resolveExcludedTypeTags(input.opts);
    this._logger.info('Starting requirement-grounded generation', {
      features: normalized.features.length,
      stories: normalized.features.reduce((sum, f) => sum + f.userStories.length, 0),
      excludedTypes: [...excludedTypeTags],
      memoryRules: memoryContext.improvementRules?.length || 0,
    });

    const systemPrompt = filterByActiveTypes(this._skill, resolveActiveTypeTags(normalized.features, excludedTypeTags));
    trace.systemPrompt = systemPrompt;
    const outcomes = await this._generateStories(normalized, excludedTypeTags, memoryContext, systemPrompt, environment);
    const testCases = buildTestCases(outcomes);
    const ambiguityWarnings = linkOpenAmbiguities(testCases, normalized.features, normalized.openAmbiguities);
    const meta = buildGenerationMeta({
      analyzedRequirements: input.analyzedRequirements,
      normalized,
      excludedTypeTags,
      systemPrompt: this._skill,
      memoryContext,
      outcomes,
      modelsUsed: llmClient.getStageModels(STAGE_ID),
    });
    const warnings = [
      ...normalized.warnings,
      ...outcomes.flatMap((outcome) => outcome.warnings),
      ...buildCoverageWarnings(normalized.features, testCases, excludedTypeTags),
      ...ambiguityWarnings,
    ];
    Object.assign(trace, { outcomes, warnings, testCaseCount: testCases.length });
    return {
      testCases,
      meta,
      inputChanges: null,
      warnings,
      clarifications: normalized.clarifications,
      coverage: computeRequirementCoverage(normalized.features, testCases),
    };
  }

  private async _generateStories(
    normalized: NormalizedAnalysis,
    excludedTypeTags: ReadonlySet<string>,
    memoryContext: any,
    systemPrompt: string,
    { credentialNames, secrets }: GenerationEnvironment,
  ): Promise<StoryGenerationOutcome[]> {
    const limit = pLimit(Math.max(1, FRAMEWORK_CONFIG.maxThreads));
    const jobs = normalized.features.flatMap((feature) => feature.userStories.map((story) => limit(async () => {
      const storyKey = `${feature.id}/${story.id}`;
      this._logger.info(`Generating scenarios for ${storyKey}`, {
        acceptanceCriteria: story.acceptanceCriteria.length, businessRules: story.businessRules.length,
      });
      let attempt = 0;
      const outcome = await generateStoryScenarios({
        feature,
        story,
        systemPrompt,
        excludedTypeTags,
        openAmbiguities: normalized.openAmbiguities,
        stateTransitions: normalized.stateTransitions,
        memoryContext,
        maxRetries: FRAMEWORK_CONFIG.selfReviewRetries,
        credentialNames,
        secrets,
      }, (messages) => {
        attempt += 1;
        return this._chat(messages, `${storyKey} #${attempt}`);
      });
      this._logger.info(`${feature.id}/${story.id}: ${outcome.scenarios.length} valid scenario(s) in ${outcome.attempts} attempt(s)`);
      return outcome;
    })));
    // Promise.all preserves job order, which keeps TC keys deterministic.
    return Promise.all(jobs);
  }

  /**
   * Placeholder names of the test account's credentials: the keys of the AUT profile's credential bindings, which the
   * later agents resolve from the environment. None when the project has no profile yet.
   */
  private _credentialNames(): string[] {
    try {
      return Object.keys(loadAutProfile(stateManager.getProjectId()).auth?.credentialEnvVars || {});
    } catch (_) {
      return [];
    }
  }

  /**
   * Generation exactly as the stage performs it — normalisation, redaction, per-story LLM generation with validation and
   * self-correction, test case building and coverage — without pipeline state, memory, feature files or the approval
   * gate. Used by the Agent 02 eval suite.
   * @param {any} analyzedRequirements - A stored Agent 01 analysis
   * @param {Record<string, unknown>} opts - Run options, e.g. { 'skip-edge': true }
   * @param {GenerationEnvironment} environment - Credential names and secrets, as the project's AUT profile would give them
   * @returns {Promise<GenerationSummary>}
   */
  async generateForEval(analyzedRequirements: any, opts: Record<string, unknown>, environment: GenerationEnvironment): Promise<GenerationSummary> {
    return this._generate({ analyzedRequirements, opts }, { improvementRules: [], rejectionFeedback: [] }, { opts }, environment);
  }

  /** Secret values the AUT profile names; none when the project has no profile yet. */
  private _knownSecrets(): KnownSecret[] {
    try {
      return profileSecrets(loadAutProfile(stateManager.getProjectId()), process.env);
    } catch (_) {
      return [];
    }
  }

  /** `traceLabel` ("F-01/US-01 #2") attributes the call to its story and attempt in the prompt trace. */
  private async _chat(messages: ChatMessage[], traceLabel: string): Promise<ChatReply> {
    const response = await llmClient.chat(STAGE_ID, {
      messages,
      traceLabel,
      temperature: LLM_SETTINGS.TEMPERATURE,
      seed: LLM_SETTINGS.SEED,
      max_tokens: LLM_SETTINGS.MAX_TOKENS,
    });
    return { text: response.text || '', truncated: Boolean(response.truncated) };
  }

  // ── Approval & Persistence ───────────────────────────────────────────────

  /**
   * Waits at the approval gate, then writes the feature files — only on approval. Feature files are committed, so output
   * a human has not approved must never reach them. They are written from the stored test cases, which include any
   * edits made in the review UI while the gate was open.
   */
  private async _awaitApproval(
    output: TestCasesArtifact,
    generation: GenerationSummary,
    analyzedRequirements: any,
    usage: any,
    durationMs: number,
  ): Promise<any> {
    const { testCases } = output.zephyrExport;
    const agentResult = this._buildAgentResult(output, generation, durationMs);
    const gateResult = await approvalGate.waitForApproval({
      stageId: STAGE_ID,
      stageName: STAGE_NAME,
      nextStageName: NEXT_STAGE,
      summary: buildApprovalSummary(testCases, generation),
      fullOutput: output.zephyrExport,
      warnings: generation.warnings,
      clarifications: generation.clarifications,
      usage,
    });

    agentResult.approvalStatus = gateResult.status;
    agentResult.approvalComment = gateResult.comment;
    if (gateResult.status === APPROVAL_STATUS.APPROVED) {
      const approved = (await stateManager.getPipelineArtifact('testCases'))?.zephyrExport?.testCases || testCases;
      const featureFilePaths = syncFeatureFiles(stateManager.getProjectId(), analyzedRequirements, approved, this._logger);
      this._logger.info('Feature files written after approval', { files: featureFilePaths.length });
    }
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

  /**
   * Persists what the generation LLM was given per story, every call's usage and cost, and each validation attempt,
   * for the UI's "Agent input" view and reports/json. Diagnostic only: a failure here is logged and never fails the stage.
   */
  private async _savePromptTrace(trace: TraceContext, status: 'COMPLETED' | 'FAILED', error?: string): Promise<void> {
    try {
      const report = buildPromptTrace({
        stageId: STAGE_ID,
        status,
        error,
        projectName: stateManager.getProjectId(),
        excludedTypes: [...resolveExcludedTypeTags(trace.opts)].sort(),
        skillPath: path.relative(path.resolve(__dirname, '../..'), SKILL_PATH),
        systemPrompt: trace.systemPrompt ?? this._skill,
        memory: {
          improvementRules: trace.memoryContext?.improvementRules || [],
          rejectionFeedback: trace.memoryContext?.rejectionFeedback || [],
        },
        stories: (trace.outcomes || []).map((outcome) => ({
          key: `${outcome.feature.id}/${outcome.story.id}`,
          title: outcome.story.title,
          acceptanceCriteria: outcome.story.acceptanceCriteria.length,
          businessRules: outcome.story.businessRules.length,
          userPrompt: outcome.userPrompt,
          scenariosAccepted: outcome.scenarios.length,
          attemptLog: outcome.attemptLog,
        })),
        testCaseCount: trace.testCaseCount ?? 0,
        warnings: trace.warnings || [],
        calls: llmClient.getCallTraces([STAGE_ID]),
      });
      await stateManager.setPipelineArtifact('agent02PromptTrace', report);
      const outDir = path.resolve(__dirname, '../../reports/json');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, PROMPT_TRACE_FILE), JSON.stringify(report, null, 2), 'utf-8');
    } catch (traceError: any) {
      this._logger.warn('Could not save the Agent 02 prompt trace', { error: traceError.message });
    }
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
      .prepare(LATEST_PROJECT_SQL)
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
