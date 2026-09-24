/**
 * @fileoverview Agent 04 — Test Data Generator.
 * Resolves every {{placeholder}} in the approved test cases under an application-agnostic value policy
 * (valuePolicy.ts): values that must match the application come only from human answers, the requirement or the
 * AUT profile; credentials and secrets are environment variable references; only synthetic inputs are generated.
 * Whatever stays unresolved is asked as a clarification. Produces a TestDataManifest consumed by Agents 05 and 07.
 *
 * @module TestDataGeneratorAgent
 * @version 2.0.0
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { isAutomationApproved, reviewExclusionReason } from '../../core/types';
import { buildFlatTestData, syncFixturesFileFromTestData } from '../../core/state-manager/FixtureSync';
import { projectPaths } from '../../core/aut/projectPaths';
import { ClarificationStore } from '../../core/clarifications/ClarificationStore';
import { CREDENTIAL_STORAGE, loadAutProfile } from '../../core/aut/AutProfile';
import { STAGE_ID, VALUE_SOURCE } from './constants';
import { VALUE_CLASS } from './placeholderIntent';
import { ProfileValues, resolvePlaceholder } from './valuePolicy';
import {
  collectEndpoints, bindSecretValues, collectRequirementValues, indexAnswers, indexOverrides, literalRequirementValues,
} from './valueSources';
import {
  EnvironmentIssue, UnresolvedPlaceholder, describeDataClarifications, syncDataClarifications,
} from './dataClarifications';
import { injectResolvedData, isBoundToEnvironment, summarizeInputs } from './testDataEdits';
import { llmClient } from '../../core/llm/LLMClient';
import { buildStagePromptTrace } from '../../core/llm/stagePromptTrace';
import { savePromptTrace } from '../../core/state-manager/promptTraceStore';
import { LATEST_PROJECT_SQL } from '../../core/state-manager/projectResolver';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_NAME = 'Test Data Generator';
const PROMPT_TRACE_FILE = 'test-data-generation-prompt-trace.json';
/** Why this stage has no LLM input to show, displayed by the prompt trace viewer. */
const NO_LLM_REASON = 'Agent 04 resolves every {{placeholder}} with a deterministic value policy: human answers, the requirement text, '
  + 'the AUT profile, environment-variable references for credentials and secrets, and generated synthetic inputs. It makes no LLM call, so a run uses 0 tokens.';
const NEXT_STAGE = '05-playwright-script-generator';

const MEMORY_RULE_ID = 'RULE-04-DATA-PATTERNS';
const PLACEHOLDER_TOKEN = /\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g;
const QUOTED_PLACEHOLDER = /"\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}"/g;
const UNRESOLVED_SUGGESTION = 'Answer the Agent 04 clarification, or set the value (for a credential: the environment variable name) in the Agent 04 UI.';
const VAULT_NOTE = 'Credentials, secrets and other runtime values are environment variable references; their values are never stored.';

// ─── TestDataGeneratorAgent ───────────────────────────────────────────────────

/**
 * @class TestDataGeneratorAgent
 * @description Resolves test data placeholders under the value policy and asks for what it cannot resolve.
 */
class TestDataGeneratorAgent {
  private readonly _logger: Logger;

  constructor() {
    this._logger = new Logger(STAGE_ID);
  }

  // ── Entry Point ──────────────────────────────────────────────────────────

  /**
   * @param {Object} input
   * @param {Object} input.reviewedTestCases    - Output of Agent 03
   * @param {Object} input.analyzedRequirements - Output of Agent 01
   * @param {Object} [input.previousTestData]   - Earlier Agent 04 artifact (UI overrides of unchanged test cases are kept)
   * @returns {Promise<AgentResult>}
   */
  async run(input: any): Promise<any> {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);

    if (!input.reviewedTestCases) {
      throw new Error('reviewedTestCases not found. Ensure Agent 03 completed successfully.');
    }

    try {
      const memoryContext = await memoryEngine.getContextForStage(STAGE_ID);
      await stateManager.markStageRunning(STAGE_ID);

      const store = await this._clarificationStore();
      const output = this._generate(input, memoryContext, store);
      const patternCount = await this._persistPatternsToMemory(output.manifest.perTCData);

      await stateManager.setPipelineArtifact('testData', output);
      await stateManager.markStageCompleted(STAGE_ID, output, llmClient.getStageUsage(STAGE_ID));
      this._saveToDisk(output.manifest, output.enrichedZephyrExport.testCases);

      const { manifest } = output;
      await this._savePromptTrace('COMPLETED', {
        'Placeholders resolved': manifest.resolvedCount, Unresolved: manifest.unresolvedCount, 'Pending clarifications': manifest.pendingClarifications.length,
      });
      const durationMs = Date.now() - startMs;
      this._logger.stage('COMPLETE', STAGE_ID, {
        resolved: manifest.resolvedCount,
        unresolved: manifest.unresolvedCount,
        pendingClarifications: manifest.pendingClarifications.length,
        environmentIssues: manifest.environmentIssues.length,
        durationMs,
      });

      const warnings = manifest.unresolvedPlaceholders.map(
        (u: any) => `[UNRESOLVED] ${u.tcKey} step ${u.stepIndex}: ${u.placeholder} — ${u.reason}`,
      );
      const clarifications = describeDataClarifications({ pending: manifest.pendingClarifications, environment: manifest.environmentIssues });
      const agentResult = this._buildAgentResult(output, warnings, clarifications, durationMs, patternCount);
      return await this._awaitApproval(agentResult, manifest, warnings, clarifications);
    } catch (error: any) {
      this._logger.error('Agent execution failed', { error: error.message });
      await this._savePromptTrace('FAILED', {}, error.message);
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  /**
   * Records that this run made no LLM call (and its outcome) so the UI's token view explains the 0 tokens.
   * @private
   */
  async _savePromptTrace(status: 'COMPLETED' | 'FAILED', overview: Record<string, string | number>, error?: string) {
    await savePromptTrace('agent04PromptTrace', PROMPT_TRACE_FILE, () => buildStagePromptTrace({
      stageId: STAGE_ID, stageName: STAGE_NAME, status, error, projectName: stateManager.getProjectId(), overview,
      llmUsageNotes: [], noLlmReason: NO_LLM_REASON, sharedInputs: [], groups: [], calls: llmClient.getCallTraces([STAGE_ID]), warnings: [],
    }), this._logger);
  }

  /**
   * Waits for the approval gate and records the decision.
   * @private
   */
  async _awaitApproval(agentResult: any, manifest: any, warnings: string[], clarifications: string[]): Promise<any> {
    const gateResult = await approvalGate.waitForApproval({
      stageId: STAGE_ID,
      stageName: STAGE_NAME,
      nextStageName: NEXT_STAGE,
      summary: this._buildApprovalSummary(manifest),
      fullOutput: manifest,
      warnings,
      clarifications,
    });

    agentResult.approvalStatus = gateResult.status;
    agentResult.approvalComment = gateResult.comment;

    await memoryEngine.recordApprovalFeedback(
      STAGE_ID,
      gateResult.status,
      gateResult.comment,
      `Resolved: ${manifest.resolvedCount}, Unresolved: ${manifest.unresolvedCount}, Pending clarifications: ${manifest.pendingClarifications.length}`,
    );
    return agentResult;
  }

  // ── Generation ────────────────────────────────────────────────────────────

  /**
   * Resolves data for the approved test cases, raises clarifications and builds the artifact.
   * @private
   */
  _generate(input: any, memoryContext: any, store: ClarificationStore): any {
    const { reviewedZephyrExport } = input.reviewedTestCases;
    const allTestCases = reviewedZephyrExport?.testCases || [];
    const approved = allTestCases.filter((tc: any) => isAutomationApproved(tc));
    const excluded = allTestCases.filter((tc: any) => !isAutomationApproved(tc));

    this._logger.info('Generating test data for approved test cases', {
      totalReviewed: allTestCases.length,
      approvedForDataGen: approved.length,
      excludedSkipped: excluded.length,
      env: FRAMEWORK_CONFIG.environment,
    });

    const sources = this._buildSources(input, memoryContext, store, approved);
    const resolution = this._resolveAll(approved, sources);
    const clarifications = syncDataClarifications(store, resolution.unresolved, resolution.envIssues, approved.map((tc: any) => tc.key));
    const manifest = this._buildManifest({
      input, sources, resolution, clarifications, approved, excluded, allTestCases,
    });

    return {
      manifest,
      enrichedZephyrExport: {
        ...reviewedZephyrExport,
        testCases: approved.map((tc: any) => injectResolvedData(tc, resolution.perTCData[tc.key])),
      },
      summary: this._buildSummary(manifest),
    };
  }

  /**
   * Everything placeholders may be resolved from, shared by all test cases.
   * @private
   */
  _buildSources(input: any, memoryContext: any, store: ClarificationStore, approved: any[]): any {
    return this._sourcesFrom({
      seedBase: FRAMEWORK_CONFIG.projectId,
      analysis: input.analyzedRequirements || {},
      profile: this._loadProfile(),
      env: process.env,
      answers: store.listResolvedFor(STAGE_ID),
      overrides: indexOverrides(input.previousTestData, approved),
      memory: this._loadMemoryPatterns(memoryContext),
    });
  }

  /**
   * The sources shared by all test cases, from explicit inputs — the one place a run and an evaluation build them.
   * @private
   */
  _sourcesFrom({
    seedBase, analysis, profile, env, answers, overrides, memory,
  }: {
    seedBase: string; analysis: any; profile: ProfileValues | null; env: Record<string, string | undefined>;
    answers: any[]; overrides: any; memory: Record<string, unknown>;
  }): any {
    return {
      seedBase,
      answers: indexAnswers(answers),
      overrides,
      // A value the requirement states that is really a secret is bound to its variable before anything can use it.
      requirementValues: bindSecretValues(collectRequirementValues(analysis), profile, env),
      endpoints: collectEndpoints(analysis),
      profile,
      memory,
      env,
    };
  }

  /**
   * Resolution exactly as the stage performs it — the value policy for every placeholder, the requirement values kept
   * for the fixture and the flat fixture itself — from an explicit profile, environment and answers, without the
   * clarification store, memory, disk or approval gate. Used by the Agent 04 catalogue.
   * @param {{ testCases: any[], analysis: any, profile: ProfileValues | null, env: Record<string, string | undefined>, answers?: any[] }} input
   * @returns {{ perTCData: Record<string, any>, unresolved: any[], envIssues: any[], requirementValues: Record<string, string>, fixture: Record<string, any> }}
   */
  resolveForEval({
    testCases, analysis, profile, env, answers = [],
  }: { testCases: any[]; analysis: any; profile: ProfileValues | null; env: Record<string, string | undefined>; answers?: any[] }) {
    const sources = this._sourcesFrom({
      seedBase: 'catalogue', analysis, profile, env, answers, overrides: new Map(), memory: {},
    });
    const resolution = this._resolveAll(testCases, sources);
    const requirementValues = literalRequirementValues(
      sources.requirementValues,
      Boolean(profile?.credentialsInFixture),
      Object.keys(profile?.credentialEnvVars || {}),
    );
    return {
      ...resolution,
      requirementValues,
      fixture: buildFlatTestData({ requirementValues, perTCData: resolution.perTCData }),
    };
  }

  /** @private */
  _resolveAll(testCases: any[], sources: any): { perTCData: Record<string, any>; unresolved: UnresolvedPlaceholder[]; envIssues: EnvironmentIssue[] } {
    const perTCData: Record<string, any> = {};
    const unresolved: UnresolvedPlaceholder[] = [];
    const envIssues: EnvironmentIssue[] = [];
    for (const tc of testCases) {
      const result = this._resolveTC(tc, sources);
      perTCData[tc.key] = result.data;
      unresolved.push(...result.unresolved);
      envIssues.push(...result.envIssues);
    }
    return { perTCData, unresolved, envIssues };
  }

  /**
   * Resolves all placeholders of a single test case.
   * @private
   */
  _resolveTC(tc: any, sources: any): { data: any; unresolved: UnresolvedPlaceholder[]; envIssues: EnvironmentIssue[] } {
    const ctx = { ...sources, tc, seed: this._makeSeed(`${sources.seedBase}-${tc.key}`) };
    const inputs: Record<string, any> = {};
    const unresolved: UnresolvedPlaceholder[] = [];
    const envIssues: EnvironmentIssue[] = [];

    for (const token of this._extractPlaceholders(tc)) {
      const name = token.slice(2, -2);
      const result = resolvePlaceholder(name, ctx);
      const reason = result.reason ?? '';
      if (result.envIssue) envIssues.push({ ...result.envIssue, tcKey: tc.key });
      if (result.entry) {
        inputs[token] = result.entry;
        continue;
      }
      unresolved.push({
        placeholder: token, name, tcKey: tc.key, stepIndex: this._findPlaceholderStep(tc, token), reason, valueClass: result.valueClass, suggestion: UNRESOLVED_SUGGESTION,
      });
      inputs[token] = {
        value: `{{UNRESOLVED:${name}}}`, type: 'unknown', sensitive: false, source: VALUE_SOURCE.UNRESOLVED, note: reason, valueClass: result.valueClass,
      };
    }

    const apiPayload = tc.type === 'API' && tc.apiDetails?.requestBody ? this._resolveAPIPayload(tc.apiDetails.requestBody, inputs) : null;

    return {
      data: {
        tcKey: tc.key, tcHash: tc.hash || null, type: tc.type, inputs, apiPayload, unresolved: unresolved.map((u) => u.placeholder),
      },
      unresolved,
      envIssues,
    };
  }

  /**
   * Extracts all unique {{placeholder}} tokens from a TC's steps.
   * @private
   */
  _extractPlaceholders(tc: any): string[] {
    const texts = [
      tc.precondition,
      tc.objective,
      ...(tc.testSteps || []).flatMap((s: any) => [s.description, s.testData, s.expectedResult]),
      tc.apiDetails ? JSON.stringify(tc.apiDetails) : '',
    ].filter(Boolean);
    return [...new Set(texts.flatMap((text) => String(text).match(PLACEHOLDER_TOKEN) || []))];
  }

  /**
   * Substitutes resolved literal values into an API request body; runtime and unresolved placeholders stay as tokens.
   * @private
   */
  _resolveAPIPayload(requestBody: any, inputs: Record<string, any>): any {
    try {
      const filled = JSON.stringify(requestBody).replace(QUOTED_PLACEHOLDER, (match: string, name: string) => {
        const entry = inputs[`{{${name}}}`];
        const literal = entry && entry.source !== VALUE_SOURCE.UNRESOLVED && !isBoundToEnvironment(entry);
        return literal ? JSON.stringify(entry.value) : match;
      });
      return JSON.parse(filled);
    } catch {
      return requestBody;
    }
  }

  /**
   * Builds a reusable API payload library from the resolved API test cases.
   * @private
   */
  _buildAPIPayloadLibrary(testCases: any[], perTCData: Record<string, any>): Record<string, any> {
    const library: Record<string, any> = {};
    testCases
      .filter((tc) => tc.type === 'API' && tc.apiDetails)
      .forEach((tc) => {
        const key = `${tc.apiDetails.method} ${tc.apiDetails.endpoint}`;
        if (library[key]) return;
        library[key] = { valid: perTCData[tc.key]?.apiPayload ?? tc.apiDetails.requestBody ?? null };
      });
    return library;
  }

  // ── Manifest Builder ──────────────────────────────────────────────────────

  /**
   * @private
   */
  _buildManifest({
    input, sources, resolution, clarifications, approved, excluded, allTestCases,
  }: any) {
    const totals = summarizeInputs(resolution.perTCData);
    return {
      manifestId: `tdm_${Date.now()}`,
      projectId: FRAMEWORK_CONFIG.projectId,
      /** Agent 03 review this data was generated from — used to detect stale manifests */
      sourceReviewId: input.reviewedTestCases.reviewId || null,
      generatedAt: new Date().toISOString(),
      seed: this._makeSeed(sources.seedBase),
      environment: FRAMEWORK_CONFIG.environment,
      totalTCs: approved.length,
      totalReviewed: allTestCases.length,
      approvedCount: approved.length,
      excludedCount: excluded.length,
      excludedTestCases: excluded.map((tc: any) => ({
        key: tc.key, name: tc.name, type: tc.type, reason: reviewExclusionReason(tc),
      })),
      resolvedCount: totals.resolvedCount,
      unresolvedCount: totals.unresolvedCount,

      /** Non-credential values the requirement states; written to the flat fixture by FixtureSync */
      requirementValues: literalRequirementValues(
        sources.requirementValues,
        Boolean(sources.profile?.credentialsInFixture),
        Object.keys(sources.profile?.credentialEnvVars || {}),
      ),
      runtimeBindings: totals.runtimeBindings,
      environmentConfig: { name: FRAMEWORK_CONFIG.environment, baseUrlEnv: sources.profile?.baseUrlEnv || null },
      perTCData: resolution.perTCData,
      apiPayloadLibrary: this._buildAPIPayloadLibrary(approved, resolution.perTCData),
      sensitiveDataVault: { note: VAULT_NOTE, refs: totals.sensitiveRefs },

      unresolvedPlaceholders: resolution.unresolved,
      pendingClarifications: clarifications.pending,
      environmentIssues: clarifications.environment,
    };
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  /**
   * Clarification store of the current project and run.
   * @private
   */
  async _clarificationStore(): Promise<ClarificationStore> {
    const { runId } = await stateManager.getFullState();
    return new ClarificationStore(stateManager.getProjectId(), runId);
  }

  /**
   * AUT profile settings the value policy uses; null when the project has no usable profile.
   * @private
   */
  _loadProfile(): ProfileValues | null {
    try {
      const profile = loadAutProfile(stateManager.getProjectId());
      return {
        baseUrlEnv: profile.baseUrlEnv,
        credentialEnvVars: profile.auth.credentialEnvVars || {},
        secretsEnvVars: profile.secretsEnvVars || [],
        credentialsInFixture: profile.auth.credentialStorage === CREDENTIAL_STORAGE.FIXTURE,
      };
    } catch (error: any) {
      this._logger.warn('No usable AUT profile; base URL and credential variables will be asked as clarifications', { error: error.message });
      return null;
    }
  }

  /**
   * Synthetic values generated in earlier runs (reused for GENERATABLE placeholders only).
   * @private
   */
  _loadMemoryPatterns(memoryContext: any): Record<string, unknown> {
    const rule = (memoryContext?.improvementRules || []).find((r: any) => r.id === MEMORY_RULE_ID);
    return rule?.data || {};
  }

  /**
   * Stores generated synthetic values for reuse; application values and credentials are never stored.
   * @returns {Promise<number>} Number of patterns stored
   * @private
   */
  async _persistPatternsToMemory(perTCData: Record<string, any>): Promise<number> {
    const patterns: Record<string, unknown> = {};
    for (const tcData of Object.values(perTCData) as any[]) {
      for (const [token, entry] of Object.entries(tcData.inputs) as Array<[string, any]>) {
        if (entry.source === VALUE_SOURCE.GENERATED && entry.valueClass === VALUE_CLASS.GENERATABLE) {
          patterns[token.slice(2, -2)] = entry.value;
        }
      }
    }

    this._logger.info('Persisting synthetic test data patterns to memory', { patternCount: Object.keys(patterns).length });
    await memoryEngine.addImprovementRule({
      id: MEMORY_RULE_ID,
      description: 'Synthetic test data values from this run for reuse',
      appliesTo: STAGE_ID,
      action: 'REUSE_DATA_PATTERNS',
      data: patterns,
      addedAt: new Date().toISOString(),
    });
    return Object.keys(patterns).length;
  }

  // ── Utility Helpers ───────────────────────────────────────────────────────

  /**
   * Creates a deterministic 8-char hex seed from a string.
   * @private
   */
  _makeSeed(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex').slice(0, 8);
  }

  /** @private */
  _findPlaceholderStep(tc: any, ph: string): number {
    return (tc.testSteps || []).findIndex(
      (s: any) => [s.description, s.testData, s.expectedResult].some((f: string | undefined) => f?.includes(ph)),
    ) + 1;
  }

  /** @private */
  _buildSummary(manifest: any) {
    return {
      totalTCs: manifest.totalTCs,
      totalReviewed: manifest.totalReviewed,
      approvedTCs: manifest.approvedCount,
      excludedTCs: manifest.excludedCount,
      resolvedCount: manifest.resolvedCount,
      unresolvedCount: manifest.unresolvedCount,
      sensitiveRefs: manifest.sensitiveDataVault.refs.length,
      apiPayloads: Object.keys(manifest.apiPayloadLibrary).length,
      pendingClarifications: manifest.pendingClarifications.length,
      environmentIssues: manifest.environmentIssues.length,
      environment: manifest.environment,
    };
  }

  /** @private */
  _buildApprovalSummary(manifest: any) {
    return {
      'Approved TCs': manifest.approvedCount,
      'Excluded TCs': manifest.excludedCount,
      'Resolved Placeholders': manifest.resolvedCount,
      Unresolved: manifest.unresolvedCount,
      'Pending Clarifications': manifest.pendingClarifications.length,
      'Environment Issues': manifest.environmentIssues.length,
      'Runtime Bindings (env vars)': manifest.runtimeBindings.length,
      'API Payload Library': `${Object.keys(manifest.apiPayloadLibrary).length} endpoints`,
      Environment: manifest.environment,
    };
  }

  /** @private */
  _buildAgentResult(output: any, warnings: string[], clarifications: string[], durationMs: number, patternCount: number): any {
    return {
      agentId: STAGE_ID,
      stageNumber: '04',
      stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED,
      output,
      clarifications,
      warnings,
      memoryUpdate: {
        testDataPatterns: patternCount,
      },
      timestamp: new Date().toISOString(),
      durationMs,
      approvalStatus: 'PENDING',
      approvalComment: '',
    };
  }

  /** @private */
  _saveToDisk(manifest: any, enrichedTestCases: any[]): void {
    const outDir = path.resolve(__dirname, '../../reports/json');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const ts = Date.now();
    fs.writeFileSync(
      path.join(outDir, `test-data-manifest-${ts}.json`),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(outDir, `enriched-test-cases-${ts}.json`),
      JSON.stringify(enrichedTestCases, null, 2),
      'utf-8',
    );

    // Flat key-value fixture for Playwright, written inside the project's own generated-test root,
    // which is where its specs import it from. syncFixturesFileFromTestData is the single writer of
    // that file and merges, so another requirement's keys survive this run.
    const { fixturesDir, fixtureFile } = projectPaths(stateManager.getProjectId());
    const flatTestData = syncFixturesFileFromTestData(manifest, undefined, fixtureFile);

    this._logger.info('Test data saved to disk (flat fixtures synced)', { outDir, fixturesDir, keysCount: Object.keys(flatTestData).length });
  }
}

// ─── Export & CLI ─────────────────────────────────────────────────────────────

export { TestDataGeneratorAgent };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const opts: any = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') continue;
      if (arg.startsWith('--')) {
        const [key, val] = arg.slice(2).split('=');
        if (val !== undefined) {
          opts[key] = val;
        } else if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
          opts[key] = args[i + 1];
          i++;
        } else {
          opts[key] = true;
        }
      }
    }

    let activeProjectId = opts.project;
    if (!activeProjectId) {
      try {
        const stateDb = stateManager.getDatabase();
        const latestRun = stateDb.prepare(LATEST_PROJECT_SQL).get() as any;
        if (latestRun?.project_id) {
          activeProjectId = latestRun.project_id;
        }
      } catch (_) {}
    }
    activeProjectId = activeProjectId || FRAMEWORK_CONFIG.projectId;

    await stateManager.initialize(activeProjectId);
    await memoryEngine.initialize(activeProjectId);

    const agent = new TestDataGeneratorAgent();
    const reviewedTestCases = await stateManager.getPipelineArtifact('reviewedTestCases');
    const analyzedRequirements = await stateManager.getPipelineArtifact('analyzedRequirements');
    const previousTestData = await stateManager.getPipelineArtifact('testData');

    if (!reviewedTestCases) {
      console.error(`❌ No reviewed test cases found for project "${activeProjectId}". Run Agent 03 first.`);
      process.exit(1);
    }

    const result = await agent.run({ reviewedTestCases, analyzedRequirements, previousTestData });
    const { manifest } = result.output;
    console.log(`\n✅ Agent 04 complete — Resolved: ${manifest.resolvedCount}, Unresolved: ${manifest.unresolvedCount}, Pending clarifications: ${manifest.pendingClarifications.length}`);
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })();
}
