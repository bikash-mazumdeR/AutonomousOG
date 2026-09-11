/**
 * @fileoverview Agent 05 — Playwright Automation Test Script Coordinator.
 * Modular coordinator that partitions test cases and delegates generation
 * to dedicated UI, API, and K6 sub-agents for optimal token efficiency.
 */

import path from 'path';
import fs from 'fs';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';

import { UIScriptGenerator } from './sub-agents/ui-script-generator';
import { APIScriptGenerator } from './sub-agents/api-script-generator';
import { K6ScriptGenerator } from './sub-agents/k6-script-generator';
import { partitionByType } from './sub-agents/shared/generation-utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_ID = '05-playwright-script-generator';
const STAGE_NAME = 'Playwright Script Generator';
const NEXT_STAGE = '06-automation-reviewer';

const SPECS_DIR = path.resolve(__dirname, '../../tests/specs');
const PAGES_DIR = path.resolve(__dirname, '../../tests/pages');
const K6_DIR = path.resolve(__dirname, '../../tests/k6');
const HELPER_DIR = path.resolve(__dirname, '../../tests/helpers');

/**
 * @class PlaywrightScriptGeneratorAgent
 * Coordinator that orchestrates mode-specific sub-agents:
 * - UIScriptGenerator (Page Object Model + UI specs)
 * - APIScriptGenerator (Playwright request fixture specs)
 * - K6ScriptGenerator (K6 performance & load scripts)
 */
class PlaywrightScriptGeneratorAgent {
  private _logger: Logger;
  private _uiGenerator: UIScriptGenerator;
  private _apiGenerator: APIScriptGenerator;
  private _k6Generator: K6ScriptGenerator;

  constructor() {
    this._logger = new Logger(STAGE_ID);
    this._uiGenerator = new UIScriptGenerator();
    this._apiGenerator = new APIScriptGenerator();
    this._k6Generator = new K6ScriptGenerator();
  }

  /**
   * Main execution entrypoint.
   * @param {Object} input - Pipeline artifacts from previous stages
   */
  async run(input: any) {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);

    try {
      const memoryContext = await memoryEngine.getContextForStage(STAGE_ID);
      await stateManager.markStageRunning(STAGE_ID);

      const testCases = (input.testData?.enrichedZephyrExport || input.reviewedTestCases?.reviewedZephyrExport)?.testCases || [];
      const manifest = input.testData?.manifest || null;
      const analysis = input.analyzedRequirements || (await stateManager.getPipelineArtifact('analyzedRequirements')) || {};
      const previousReview = input.reviewedScripts || (await stateManager.getPipelineArtifact('reviewedScripts'));

      let reviewFeedback: any = null;
      if (previousReview) {
        const findings = (previousReview.fileReviews || []).flatMap((fr: any) => fr.findings || []);
        const blockers = previousReview.blockers || findings.filter((f: any) => f.severity === 'BLOCKER').map((f: any) => f.message);
        if (findings.length > 0 || blockers.length > 0 || previousReview.reviewDecision === 'REJECT') {
          reviewFeedback = {
            reviewDecision: previousReview.reviewDecision,
            overallScore: previousReview.overallScore,
            blockers: blockers || [],
            findings: findings || [],
            recommendations: previousReview.recommendations || [],
            fileReviews: previousReview.fileReviews || [],
          };
          this._logger.info('Injecting Agent 06 review feedback into Agent 05 generators', {
            blockersCount: (blockers || []).length,
            findingsCount: findings.length,
          });
        }
      }

      this._ensureDirs();
      this._ensureBasePage();

      const fixturesDataPath = path.resolve(__dirname, '../../tests/fixtures/test-data.json');
      let flatTestData: Record<string, any> = {};
      try {
        if (fs.existsSync(fixturesDataPath)) {
          flatTestData = JSON.parse(fs.readFileSync(fixturesDataPath, 'utf-8'));
        }
      } catch {
        flatTestData = {};
      }

      const healedSelectors = await this._loadHealedSelectors(memoryContext);
      const featureGroups = this._groupByFeature(testCases, analysis);

      const generatedFiles: {
        specFiles: string[];
        k6Files: string[];
        pomFiles: string[];
        helperFiles: string[];
      } = {
        specFiles: [],
        k6Files: [],
        pomFiles: [],
        helperFiles: [],
      };

      for (const [featureId, group] of Object.entries(featureGroups)) {
        // ── Partition TCs by test type into UI, API, and Perf buckets ──
        const { uiTCs, apiTCs, perfTCs } = partitionByType((group as any).testCases);

        this._logger.info(
          `Feature ${featureId}: ${uiTCs.length} UI, ${apiTCs.length} API, ${perfTCs.length} Perf test cases`
        );

        // ── 1. UI TCs → Delegate to UIScriptGenerator (POM + batched UI spec) ──
        if (uiTCs.length > 0) {
          const uiGroup = { ...(group as any), testCases: uiTCs };

          // POM is generated from the full UI TC list so all interactions are represented
          const pomCode = await this._uiGenerator.generatePOM(uiGroup, healedSelectors, reviewFeedback);
          const pomPath = path.join(PAGES_DIR, `${(group as any).className}Page.ts`);
          fs.writeFileSync(pomPath, pomCode, 'utf-8');
          generatedFiles.pomFiles.push(pomPath);

          // UI spec generation is batched
          const specCode = await this._uiGenerator.generateSpec(
            uiTCs,
            {
              featureId: (group as any).featureId,
              featureName: (group as any).featureName,
              className: (group as any).className,
              fileName: (group as any).fileName,
            },
            pomPath,
            `${(group as any).className}Page`,
            pomCode,
            flatTestData,
            manifest,
            reviewFeedback
          );
          const specPath = path.join(SPECS_DIR, `${featureId}-${(group as any).fileName}.spec.ts`);
          fs.writeFileSync(specPath, specCode, 'utf-8');
          generatedFiles.specFiles.push(specPath);
        }

        // ── 2. API TCs → Delegate to APIScriptGenerator (batched API spec, no POM) ──
        if (apiTCs.length > 0) {
          const apiSpecCode = await this._apiGenerator.generateSpec(
            apiTCs,
            {
              featureId: (group as any).featureId,
              featureName: (group as any).featureName,
              className: (group as any).className,
              fileName: (group as any).fileName,
            },
            flatTestData,
            manifest
          );

          if (apiSpecCode) {
            const apiSpecPath = path.join(SPECS_DIR, `${featureId}-${(group as any).fileName}-api.spec.ts`);
            fs.writeFileSync(apiSpecPath, apiSpecCode, 'utf-8');
            generatedFiles.specFiles.push(apiSpecPath);
          }
        }

        // ── 3. Performance TCs → Delegate to K6ScriptGenerator ──
        if (perfTCs.length > 0) {
          const k6Results = await this._k6Generator.generateScripts(
            perfTCs,
            featureId,
            (group as any).featureName,
            flatTestData
          );

          for (const item of k6Results) {
            const k6Path = path.join(K6_DIR, `${featureId}-${item.tcKey.toLowerCase()}-perf.js`);
            fs.writeFileSync(k6Path, item.code, 'utf-8');
            generatedFiles.k6Files.push(k6Path);
          }
        }
      }

      this._generateApiHelper();
      this._generateNetworkCapture();

      const output = {
        ...generatedFiles,
        totalFilesGenerated:
          generatedFiles.specFiles.length + generatedFiles.k6Files.length + generatedFiles.pomFiles.length,
        updatedTestCases: testCases,
        featureCount: Object.keys(featureGroups).length,
        generatedAt: new Date().toISOString(),
      };

      await stateManager.setPipelineArtifact('playwrightScripts', output);
      await stateManager.markStageCompleted(STAGE_ID, output);

      const durationMs = Date.now() - startMs;
      const agentResult = this._buildAgentResult(output, [], durationMs);

      const isReviewRecovery =
        previousReview &&
        (previousReview.reviewDecision === 'REJECT' ||
          (previousReview.failedFiles && previousReview.failedFiles > 0));

      const gateResult = await approvalGate.waitForApproval({
        stageId: STAGE_ID,
        stageName: STAGE_NAME,
        nextStageName: NEXT_STAGE,
        summary: this._buildApprovalSummary(output),
        fullOutput: output,
        isReviewRecovery: !!isReviewRecovery,
      });

      agentResult.approvalStatus = gateResult.status;
      agentResult.approvalComment = gateResult.comment;
      return agentResult;
    } catch (error: any) {
      this._logger.error('Agent execution failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  /**
   * Partitions test cases into groups by feature ID.
   */
  _groupByFeature(testCases: any[], analysis: any) {
    const groups: Record<string, any> = {};
    const featureMap: Record<string, any> = {};
    (analysis.features || []).forEach((f: any) => {
      featureMap[f.id] = f;
    });

    for (const tc of testCases) {
      const fid = tc.traceabilityLinks?.featureId || 'UNKNOWN';
      if (!groups[fid]) {
        const feat = featureMap[fid] || { id: fid, name: `Feature_${fid}` };
        groups[fid] = {
          featureId: feat.id,
          featureName: feat.name,
          className: feat.name.replace(/[^a-zA-Z0-9]/g, ''),
          fileName: feat.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
          testCases: [],
        };
      }
      groups[fid].testCases.push(tc);
    }
    return groups;
  }

  _ensureDirs() {
    [SPECS_DIR, PAGES_DIR, K6_DIR, HELPER_DIR].forEach((d) => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  _ensureBasePage() {
    const basePagePath = path.join(PAGES_DIR, 'BasePage.ts');
    if (!fs.existsSync(basePagePath)) {
      const code = `import { Page } from '@playwright/test';

export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url);
  }

  async click(selector: string): Promise<void> {
    await this.page.locator(selector).click();
  }

  async fill(selector: string, text: string): Promise<void> {
    await this.page.locator(selector).fill(text);
  }
}
`;
      fs.writeFileSync(basePagePath, code, 'utf-8');
    }
  }

  async _loadHealedSelectors(memoryContext: any) {
    return memoryContext?.healedSelectors || {};
  }

  _generateApiHelper() {
    const apiHelperPath = path.join(HELPER_DIR, 'apiHelper.ts');
    if (!fs.existsSync(apiHelperPath)) {
      const code = `import { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * API Helper for common Playwright request operations.
 */
export async function performRequest(
  request: APIRequestContext,
  method: string,
  url: string,
  options: Record<string, any> = {}
): Promise<APIResponse> {
  const response = await (request as any)[method.toLowerCase()](url, options);
  return response;
}
`;
      fs.writeFileSync(apiHelperPath, code, 'utf-8');
    }
  }

  _generateNetworkCapture() {
    const networkCapturePath = path.join(HELPER_DIR, 'networkCapture.ts');
    if (!fs.existsSync(networkCapturePath)) {
      const code = `import { Page, Request } from '@playwright/test';

/**
 * Network capture utility for intercepting UI requests.
 */
export async function captureNetworkRequests(page: Page, urlPattern: string): Promise<Request[]> {
  const requests: Request[] = [];
  page.on('request', (req: Request) => {
    if (req.url().includes(urlPattern)) requests.push(req);
  });
  return requests;
}
`;
      fs.writeFileSync(networkCapturePath, code, 'utf-8');
    }
  }

  _buildApprovalSummary(output: any) {
    return { 'Files Generated': output.totalFilesGenerated };
  }

  _buildAgentResult(output: any, warnings: any[], durationMs: number) {
    return {
      agentId: STAGE_ID,
      stageNumber: '05',
      stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED,
      output,
      warnings,
      durationMs,
      timestamp: new Date().toISOString(),
      approvalStatus: 'PENDING',
    };
  }
}

export { PlaywrightScriptGeneratorAgent };
export const PlaywrightScriptCoordinator = PlaywrightScriptGeneratorAgent;

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

    const agent = new PlaywrightScriptGeneratorAgent();
    const testData = await stateManager.getPipelineArtifact('testData');
    const reviewedTestCases = await stateManager.getPipelineArtifact('reviewedTestCases');
    const analyzedRequirements = await stateManager.getPipelineArtifact('analyzedRequirements');

    if (!testData && !reviewedTestCases) {
      console.error('❌ No test cases or test data found. Run previous agents first.');
      process.exit(1);
    }

    const result = await agent.run({ testData, reviewedTestCases, analyzedRequirements });
    console.log(`\n✅ Agent 05 complete — Generated ${result.output.totalFilesGenerated} files.`);
    const reviewedScripts = await stateManager.getPipelineArtifact('reviewedScripts');
    if (
      reviewedScripts?.reviewDecision === 'REJECT' ||
      (reviewedScripts?.failedFiles && reviewedScripts.failedFiles > 0)
    ) {
      console.log(`\n👉 Issues resolved! Run Agent 06 to review the updated scripts:\n   npm run agent:06\n`);
    } else {
      console.log(`👉 Next Step: Run Agent 06 to review the generated scripts:\n   npm run agent:06\n`);
    }
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })();
}
