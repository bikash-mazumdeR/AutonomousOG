'use strict';

/**
 * @fileoverview Agent 05 — Playwright Script Generator (coordinator).
 *
 * Implements APPROVED Agent 03 test cases as automation that passes only when the application genuinely
 * behaves as approved:
 *  - application facts come only from the AUT profile, Agent 04 data bindings and live DOM discovery;
 *  - the LLM writes test bodies only, as JSON with a step→assertion map;
 *  - every body is validated fail-closed (integrity rules, contract membership, value provenance);
 *  - code renders all files deterministically, and every approved test case ends GENERATED,
 *    NEEDS_CONTEXT, BLOCKED or EXCLUDED — nothing is silently dropped or guessed.
 *
 * @module PlaywrightScriptGeneratorAgent
 * @version 4.0.0
 */

import * as fs from 'fs';
import * as path from 'path';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { llmClient } from '../../core/llm/LLMClient';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import {
  isAutomationApproved, reviewExclusionReason, PlaywrightScriptsArtifact, AutomationTestCaseResult,
} from '../../core/types';
import { ClarificationStore } from '../../core/clarifications/ClarificationStore';
import { loadAutProfile, ResolvedAutProfile } from '../../core/aut/AutProfile';
import {
  FRAMEWORK_ROOT, ProjectPaths, projectPaths, writeActiveProject,
} from '../../core/aut/projectPaths';

import {
  LLM_SETTINGS, NEXT_STAGE, STAGE_ID, STAGE_NAME, STAGE_NUMBER, TC_OUTCOME,
} from './constants';
import { ChatMessage } from './types';
import {
  AutomationTestCase, FixtureAccumulator, buildAutomationTestCase, modeForType,
} from './contracts/automationTestCase';
import { TestOutcome } from './generation/testBodyGenerator';
import { renderTestTitle } from './rendering/specRenderer';
import { removeStaleGeneratedFiles, toRelative, writeManifest } from './output/manifest';
import { UIScriptGenerator } from './sub-agents/ui-script-generator';
import { APIScriptGenerator } from './sub-agents/api-script-generator';
import { K6ScriptGenerator } from './sub-agents/k6-script-generator';
import { FeatureGenerationContext, FeatureGenerationResult } from './sub-agents/shared/featureContext';
import { writeBackClarifications } from './clarifications/writeBack';

interface ApprovedScope {
  approved: any[];
  excluded: any[];
  rawByKey: Map<string, any>;
  warnings: string[];
}

interface SharedGeneration {
  profile: ResolvedAutProfile;
  paths: ProjectPaths;
  sourceReviewId: string | null;
  fixtureValues: Record<string, unknown>;
  priorReviewFindings: Array<{ ruleId: string; message: string }>;
}

const isApproved = (tc: any) => isAutomationApproved(tc);

const PLACEHOLDER = /\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/;

/**
 * Attaches Agent 04's resolved test data to the reviewed test cases, one test case at a time. The Agent 03 review stays
 * the source of truth for status and steps; data is taken from Agent 04 only for the same content (matching hash), so a
 * test case held or edited after Agent 04 ran never discards the data of the others.
 * @param {any[]} reviewed - Agent 03 test cases
 * @param {any[]} enriched - Agent 04 enriched test cases
 * @returns {{ testCases: any[], missingData: string[] }} missingData: approved test cases with placeholders but no usable data
 */
export function attachTestData(reviewed: any[], enriched: any[]): { testCases: any[]; missingData: string[] } {
  const enrichedByKey = new Map(enriched.map((tc) => [tc.key, tc]));
  const missingData: string[] = [];
  const testCases = reviewed.map((tc) => {
    const data = enrichedByKey.get(tc.key);
    const sameContent = data && (!tc.hash || !data.hash || data.hash === tc.hash);
    if (sameContent && data.resolvedData) {
      return { ...tc, resolvedData: data.resolvedData, ...(data.dataManifestId ? { dataManifestId: data.dataManifestId } : {}) };
    }
    if (enriched.length > 0 && isApproved(tc) && PLACEHOLDER.test(JSON.stringify(tc.testSteps || []))) missingData.push(tc.key);
    return tc;
  });
  return { testCases, missingData };
}
const byKey = (a: any, b: any) => String(a.key).localeCompare(String(b.key));

/**
 * @class PlaywrightScriptGeneratorAgent
 */
class PlaywrightScriptGeneratorAgent {
  private _logger: Logger;

  private _ui: UIScriptGenerator;

  private _api: APIScriptGenerator;

  private _k6: K6ScriptGenerator;

  constructor() {
    this._logger = new Logger(STAGE_ID);
    this._ui = new UIScriptGenerator();
    this._api = new APIScriptGenerator();
    this._k6 = new K6ScriptGenerator();
  }

  /**
   * Main execution entrypoint.
   * @param {Object} input - Pipeline artifacts (reviewedTestCases, testData, optional projectId/reviewedScripts/playwrightScripts)
   * @returns {Promise<any>} AgentResult
   */
  async run(input: any): Promise<any> {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);
    try {
      await stateManager.markStageRunning(STAGE_ID);
      llmClient.resetStageFallback(STAGE_ID);

      const projectId = input.projectId || (stateManager as any)._projectId || FRAMEWORK_CONFIG.projectId;
      const profile = loadAutProfile(projectId);
      const paths = projectPaths(projectId);
      const scope = this._resolveScope(input);
      const fixture = new FixtureAccumulator();
      const testCases = scope.approved.map((tc) => buildAutomationTestCase(tc, scope.rawByKey.get(tc.key), fixture));
      const sourceReviewId = input.reviewedTestCases?.reviewId || null;
      const shared: SharedGeneration = {
        profile, paths, sourceReviewId, fixtureValues: fixture.toObject(), priorReviewFindings: await this._priorReviewFindings(input, paths, sourceReviewId),
      };

      this._logger.info('Generating automation for approved test cases', {
        project: paths.slug, approved: testCases.length, excluded: scope.excluded.length, aut: profile.displayName,
      });
      const results = await this._generateFeatures(testCases, shared);
      const output = this._persistOutputs(results, testCases, scope, shared);
      await this._writeBackClarifications(output, testCases);
      writeActiveProject(projectId);

      const usage = llmClient.getStageUsage(STAGE_ID);
      await stateManager.setPipelineArtifact('playwrightScripts', output);
      await stateManager.markStageCompleted(STAGE_ID, output, usage);
      const durationMs = Date.now() - startMs;
      this._logger.stage('COMPLETE', STAGE_ID, { durationMs, ...this._counts(output) });
      return await this._awaitApproval(output, usage, durationMs);
    } catch (error: any) {
      this._logger.error('Agent execution failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  // ── Scope ────────────────────────────────────────────────────────────────

  private _resolveScope(input: any): ApprovedScope {
    const reviewedRaw: any[] = input.reviewedTestCases?.reviewedZephyrExport?.testCases || [];
    const enrichedRaw: any[] = input.testData?.enrichedZephyrExport?.testCases || [];
    const { testCases, missingData } = attachTestData(reviewedRaw, enrichedRaw);
    const warnings = missingData.length > 0
      ? [`Agent 04 test data is missing or outdated for ${missingData.join(', ')}; their data placeholders stay unresolved until Agent 04 is re-run.`]
      : [];
    return {
      approved: testCases.filter(isApproved).sort(byKey),
      excluded: testCases.filter((tc) => !isApproved(tc)).sort(byKey),
      rawByKey: new Map(reviewedRaw.map((tc) => [tc.key, tc])),
      warnings,
    };
  }

  private async _priorReviewFindings(input: any, paths: ProjectPaths, sourceReviewId: string | null): Promise<Array<{ ruleId: string; message: string }>> {
    const previousScripts = input.playwrightScripts ?? await stateManager.getPipelineArtifact('playwrightScripts');
    const review = input.reviewedScripts ?? await stateManager.getPipelineArtifact('reviewedScripts');
    if (!review || !sourceReviewId || previousScripts?.sourceReviewId !== sourceReviewId) return [];
    const root = path.resolve(paths.testsRoot);
    const seen = new Set<string>();
    const findings: Array<{ ruleId: string; message: string }> = [];
    for (const fileReview of review.fileReviews || []) {
      if (!path.resolve(String(fileReview.filePath || '')).startsWith(root)) continue;
      for (const finding of fileReview.findings || []) {
        const key = `${finding.ruleId}|${finding.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ ruleId: String(finding.ruleId), message: String(finding.message) });
      }
    }
    return findings.slice(0, 20);
  }

  // ── Generation ───────────────────────────────────────────────────────────

  private async _generateFeatures(testCases: AutomationTestCase[], shared: SharedGeneration): Promise<FeatureGenerationResult[]> {
    const byFeature = new Map<string, AutomationTestCase[]>();
    testCases.forEach((tc) => byFeature.set(tc.featureId, [...(byFeature.get(tc.featureId) || []), tc]));
    const results: FeatureGenerationResult[] = [];
    for (const [featureId, featureTestCases] of [...byFeature.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const ctx: FeatureGenerationContext = {
        projectSlug: shared.paths.slug,
        featureId,
        sourceReviewId: shared.sourceReviewId,
        profile: shared.profile,
        paths: shared.paths,
        fixtureValues: shared.fixtureValues,
        priorReviewFindings: shared.priorReviewFindings,
        chat: (messages, options) => this._chat(messages, options),
        maxRetries: FRAMEWORK_CONFIG.selfReviewRetries,
        concurrency: Math.max(1, FRAMEWORK_CONFIG.maxThreads),
        headless: FRAMEWORK_CONFIG.playwright.headless,
        logger: this._logger,
      };
      const ofMode = (mode: string) => featureTestCases.filter((tc) => modeForType(tc.type) === mode);
      // eslint-disable-next-line no-await-in-loop -- features share one discovery browser budget; keep sequential
      if (ofMode('UI').length > 0) results.push(await this._ui.generate(ofMode('UI'), ctx));
      // eslint-disable-next-line no-await-in-loop
      if (ofMode('API').length > 0) results.push(await this._api.generate(ofMode('API'), ctx));
      // eslint-disable-next-line no-await-in-loop
      if (ofMode('K6').length > 0) results.push(await this._k6.generate(ofMode('K6'), ctx));
    }
    return results;
  }

  private async _chat(messages: ChatMessage[], options?: { json?: boolean }): Promise<string> {
    const response = await llmClient.chat(STAGE_ID, {
      messages, temperature: LLM_SETTINGS.TEMPERATURE, max_tokens: LLM_SETTINGS.MAX_TOKENS, json: options?.json,
    });
    return response.text || '';
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private _toResult(tc: AutomationTestCase, outcome: TestOutcome | undefined, file: string | undefined): AutomationTestCaseResult {
    if (!outcome) return { tcKey: tc.tcKey, status: TC_OUTCOME.BLOCKED, reason: 'No generation outcome was produced.' };
    const result: AutomationTestCaseResult = { tcKey: tc.tcKey, status: outcome.status };
    if (outcome.status === TC_OUTCOME.GENERATED) {
      result.file = file ? toRelative(FRAMEWORK_ROOT, file) : undefined;
      result.testTitle = renderTestTitle(tc);
      result.stepAssertions = outcome.stepAssertions;
      if (outcome.sharedSetup) result.sharedSetup = outcome.sharedSetup;
      if (outcome.provenance) result.provenance = outcome.provenance;
    }
    if (outcome.status === TC_OUTCOME.NEEDS_CONTEXT) result.missing = outcome.missing;
    if (outcome.status === TC_OUTCOME.BLOCKED) result.reason = (outcome.errors || []).slice(0, 5).join(' | ');
    return result;
  }

  private _persistOutputs(results: FeatureGenerationResult[], testCases: AutomationTestCase[], scope: ApprovedScope, shared: SharedGeneration): PlaywrightScriptsArtifact {
    const { paths } = shared;
    const files = results.flatMap((r) => r.files);
    [paths.specsDir, paths.pagesDir, paths.k6Dir, paths.fixturesDir, paths.pageMapsDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
    fs.writeFileSync(paths.fixtureFile, `${JSON.stringify(shared.fixtureValues, null, 2)}\n`, 'utf-8');
    files.forEach((file) => fs.writeFileSync(file.path, file.content, 'utf-8'));
    const removed = removeStaleGeneratedFiles([paths.specsDir, paths.pagesDir, paths.k6Dir], new Set(files.map((f) => path.resolve(f.path))));

    const outcomes = new Map(results.flatMap((r) => r.outcomes).map((o) => [o.tcKey, o]));
    const fileByTcKey = new Map(results.flatMap((r) => [...r.fileByTcKey.entries()]));
    const testCaseResults: AutomationTestCaseResult[] = [
      ...testCases.map((tc) => this._toResult(tc, outcomes.get(tc.tcKey), fileByTcKey.get(tc.tcKey))),
      ...scope.excluded.map((tc) => ({
        tcKey: String(tc.key), status: TC_OUTCOME.EXCLUDED, reason: reviewExclusionReason(tc),
      })),
    ].sort((a, b) => a.tcKey.localeCompare(b.tcKey));

    const warnings = [
      ...scope.warnings,
      ...(removed.length > 0 ? [`Removed ${removed.length} stale generated file(s): ${removed.map((f) => toRelative(FRAMEWORK_ROOT, f)).join(', ')}`] : []),
      ...testCaseResults.filter((r) => r.status === TC_OUTCOME.BLOCKED).map((r) => `${r.tcKey} BLOCKED: ${r.reason}`),
    ];
    writeManifest(paths.manifestFile, {
      version: 1,
      projectSlug: paths.slug,
      sourceReviewId: shared.sourceReviewId,
      files: files.map((f) => toRelative(FRAMEWORK_ROOT, f.path)),
      testCases: testCaseResults.map(({ tcKey, status, file }) => ({ tcKey, status, file })),
    });

    return {
      projectSlug: paths.slug,
      sourceReviewId: shared.sourceReviewId,
      specFiles: files.filter((f) => f.kind === 'spec').map((f) => f.path),
      pomFiles: files.filter((f) => f.kind === 'pom').map((f) => f.path),
      k6Files: files.filter((f) => f.kind === 'k6').map((f) => f.path),
      pageMapFiles: [...new Set(results.map((r) => r.pageMapFile).filter((f): f is string => !!f && fs.existsSync(f)))],
      testCases: testCaseResults,
      warnings,
    };
  }

  /**
   * Routes NEEDS_CONTEXT gaps back as clarifications to the owning stage and logs why each test case was not generated.
   * @param {PlaywrightScriptsArtifact} output - Annotated in place
   * @param {AutomationTestCase[]} testCases
   */
  private async _writeBackClarifications(output: PlaywrightScriptsArtifact, testCases: AutomationTestCase[]): Promise<void> {
    const { runId } = await stateManager.getFullState();
    output.clarifications = writeBackClarifications(new ClarificationStore(stateManager.getProjectId(), runId), output.testCases, testCases);
    output.testCases
      .filter((result) => result.status === TC_OUTCOME.NEEDS_CONTEXT || result.status === TC_OUTCOME.BLOCKED)
      .forEach((result) => this._logger.warn(`${result.tcKey} ${result.status}: ${result.reason
        || (result.missing || []).map((gap) => `${gap.kind}: ${gap.detail}`).join('; ')}`));
    this._logger.info('Clarifications written back', output.clarifications);
  }

  // ── Approval ─────────────────────────────────────────────────────────────

  private _counts(output: PlaywrightScriptsArtifact): Record<string, number> {
    const count = (status: string) => output.testCases.filter((r) => r.status === status).length;
    return {
      generated: count(TC_OUTCOME.GENERATED),
      needsContext: count(TC_OUTCOME.NEEDS_CONTEXT),
      blocked: count(TC_OUTCOME.BLOCKED),
      excluded: count(TC_OUTCOME.EXCLUDED),
    };
  }

  private async _awaitApproval(output: PlaywrightScriptsArtifact, usage: any, durationMs: number): Promise<any> {
    const counts = this._counts(output);
    const clarifications = output.testCases
      .filter((r) => r.status === TC_OUTCOME.NEEDS_CONTEXT)
      .map((r) => `${r.tcKey} — ${(r.missing || [])
        .map((m) => `${m.kind}: ${m.detail}${m.owningStage ? ` → asked of ${m.owningStage} (${m.clarificationId})` : ''}`).join('; ')}`);
    const agentResult: any = {
      agentId: STAGE_ID,
      stageNumber: STAGE_NUMBER,
      stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED,
      output,
      clarifications,
      warnings: output.warnings,
      durationMs,
      timestamp: new Date().toISOString(),
      approvalStatus: 'PENDING',
      approvalComment: '',
    };
    const gateResult = await approvalGate.waitForApproval({
      stageId: STAGE_ID,
      stageName: STAGE_NAME,
      nextStageName: NEXT_STAGE,
      summary: {
        Project: output.projectSlug,
        'Generated TCs': counts.generated,
        'Needs Context': counts.needsContext,
        Blocked: counts.blocked,
        Excluded: counts.excluded,
        'Clarifications Raised': output.clarifications?.raised ?? 0,
        'Environment Issues': output.clarifications?.environment ?? 0,
        'Spec Files': output.specFiles.length,
        'Page Objects': output.pomFiles.length,
        'K6 Scripts': output.k6Files.length,
        'Page Maps': output.pageMapFiles.length,
      },
      fullOutput: output,
      warnings: output.warnings,
      clarifications,
      usage,
    });
    agentResult.approvalStatus = gateResult.status;
    agentResult.approvalComment = gateResult.comment;
    await memoryEngine.recordApprovalFeedback(STAGE_ID, gateResult.status, gateResult.comment, `Generated: ${counts.generated}, Needs context: ${counts.needsContext}, Blocked: ${counts.blocked}`);
    return agentResult;
  }
}

export { PlaywrightScriptGeneratorAgent };

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

    const reviewedTestCases = await stateManager.getPipelineArtifact('reviewedTestCases');
    if (!reviewedTestCases) {
      console.error('❌ No reviewed test cases found. Run Agents 02–04 first.');
      process.exit(1);
    }
    const result = await new PlaywrightScriptGeneratorAgent().run({
      projectId,
      reviewedTestCases,
      testData: await stateManager.getPipelineArtifact('testData'),
      reviewedScripts: await stateManager.getPipelineArtifact('reviewedScripts'),
      playwrightScripts: await stateManager.getPipelineArtifact('playwrightScripts'),
    });
    const { output } = result;
    const count = (status: string) => output.testCases.filter((r: any) => r.status === status).length;
    console.log(`\n✅ Agent 05 complete — generated ${count('GENERATED')}, needs context ${count('NEEDS_CONTEXT')}, blocked ${count('BLOCKED')}, excluded ${count('EXCLUDED')}.`);
    console.log('👉 Next Step: Run Agent 06 to review the generated scripts:\n   npm run agent:06\n');
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })().catch((err) => {
    console.error('Fatal error in Agent 05 CLI:', err);
    process.exit(1);
  });
}
