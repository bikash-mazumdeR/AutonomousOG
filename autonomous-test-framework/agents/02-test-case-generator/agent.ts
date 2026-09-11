'use strict';

/**
 * @fileoverview Agent 02 — Test Case Generator (Orchestrator Shell).
 * Delegates all generation logic to the generators/ and utils modules.
 *
 * @module TestCaseGeneratorAgent
 * @version 2.0.0
 */

import * as path from 'path';
import * as fs from 'fs';

import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { llmClient } from '../../core/llm/LLMClient';

import {
  STAGE_ID, STAGE_NAME, NEXT_STAGE, SKILL_PATH,
  TC_TYPE, MIN_TC_BY_RISK, PRIORITY,
} from './constants';
import {
  buildSummary, buildApprovalSummary, buildZephyrExport, buildK6ScenarioIndex,
} from './utils';

import { generatePositiveTCs }     from './generators/PositiveGenerator';
import { generateNegativeTCs }     from './generators/NegativeGenerator';
import { generateEdgeTCs }         from './generators/EdgeGenerator';
import { generateAPITCs }           from './generators/ApiGenerator';
import { generatePerformanceTCs }  from './generators/PerformanceGenerator';

// ─── TestCaseGeneratorAgent ───────────────────────────────────────────────────

/**
 * @class TestCaseGeneratorAgent
 * @description Orchestrates comprehensive test case generation from analyzed requirements.
 */
export class TestCaseGeneratorAgent {
  constructor() {
    this._logger    = new Logger(STAGE_ID);
    /** Shared mutable counter passed by-reference to all generators. */
    this._counter   = { value: 1 };
    this._skill     = this._loadSkill();
  }

  // ── Entry Point ──────────────────────────────────────────────────────────

  async run(input) {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);

    if (!input.analyzedRequirements) {
      throw new Error('analyzedRequirements not provided. Ensure Agent 01 completed successfully.');
    }

    try {
      const memoryContext = await memoryEngine.getContextForStage(STAGE_ID);
      this._logger.info('Memory context loaded', {
        rules: memoryContext.improvementRules.length,
        feedback: memoryContext.rejectionFeedback.length,
      });

      await stateManager.markStageRunning(STAGE_ID);

      const analysis = input.analyzedRequirements;
      this._logger.info('Starting test case generation', {
        features:    analysis.totalFeatures,
        userStories: analysis.totalUserStories,
        projectKey:  FRAMEWORK_CONFIG.jira.projectKey,
      });

      // ── Generate all test cases ──────────────────────────────────────────
      const allTestCases = [];
      const warnings     = [];

      for (const feature of analysis.features) {
        this._logger.info(`Generating TCs for feature: ${feature.name}`, {
          featureId: feature.id, risk: feature.riskLevel, stories: feature.userStories.length,
        });

        for (const story of feature.userStories) {
          if (story.testability === 'MANUAL_ONLY') {
            warnings.push(`Story "${story.title}" marked MANUAL_ONLY — skipped`);
            continue;
          }

          const positiveTCs    = generatePositiveTCs(this._counter, feature, story, analysis);
          const negativeTCs    = generateNegativeTCs(this._counter, feature, story, analysis);
          const edgeTCs        = generateEdgeTCs(this._counter, feature, story, analysis);
          const apiTCs         = story.testTypes.includes('API')         ? generateAPITCs(this._counter, feature, story, analysis)         : [];
          const performanceTCs = story.testTypes.includes('PERFORMANCE') ? generatePerformanceTCs(this._counter, feature, story, analysis) : [];

          // Coverage warnings
          const mins = MIN_TC_BY_RISK[feature.riskLevel] || MIN_TC_BY_RISK.MEDIUM;
          if (positiveTCs.length < mins.positive) warnings.push(`[${feature.id}/${story.id}] Only ${positiveTCs.length}/${mins.positive} positive TCs generated`);
          if (negativeTCs.length < mins.negative) warnings.push(`[${feature.id}/${story.id}] Only ${negativeTCs.length}/${mins.negative} negative TCs generated`);

          allTestCases.push(...positiveTCs, ...negativeTCs, ...edgeTCs, ...apiTCs, ...performanceTCs);
        }
      }

      // ── Apply memory improvement rules ───────────────────────────────────
      const improvedTCs     = this._applyImprovementRules(allTestCases, memoryContext.improvementRules);
      const zephyrExport    = buildZephyrExport(analysis, improvedTCs);
      const k6ScenarioIndex = buildK6ScenarioIndex(improvedTCs, analysis);

      // ── Sync BDD Feature Files (1:1 Scenario Mirroring) ───────────────────
      const featureFilePaths = this._syncFeatureFiles(analysis, improvedTCs);

      const output = {
        zephyrExport,
        k6ScenarioIndex,
        featureFilePaths,
        summary:     buildSummary(improvedTCs, analysis),
        generatedAt: new Date().toISOString(),
      };

      const usage = llmClient.getStageUsage(STAGE_ID);
      await stateManager.setPipelineArtifact('testCases', output);
      await stateManager.setPipelineArtifact('featureFilePaths', featureFilePaths);
      await stateManager.markStageCompleted(STAGE_ID, output, usage);
      this._saveToDisk(output);

      const durationMs = Date.now() - startMs;
      this._logger.stage('COMPLETE', STAGE_ID, { totalTCs: zephyrExport.totalTestCases, durationMs });

      const agentResult = this._buildAgentResult(output, warnings, durationMs);

      const gateResult = await approvalGate.waitForApproval({
        stageId:       STAGE_ID,
        stageName:     STAGE_NAME,
        nextStageName: NEXT_STAGE,
        summary:       buildApprovalSummary(output),
        fullOutput:    zephyrExport,
        warnings,
        usage,
      });

      agentResult.approvalStatus  = gateResult.status;
      agentResult.approvalComment = gateResult.comment;

      await memoryEngine.recordApprovalFeedback(
        STAGE_ID, gateResult.status, gateResult.comment,
        `TCs: ${zephyrExport.totalTestCases}`,
      );

      return agentResult;

    } catch (error) {
      this._logger.error('Agent execution failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  // ── Improvement Rules ────────────────────────────────────────────────────

  _applyImprovementRules(testCases, rules) {
    if (!rules || rules.length === 0) return testCases;
    let tcs = [...testCases];

    for (const rule of rules) {
      if (rule.appliesTo !== STAGE_ID && rule.appliesTo !== 'ALL') continue;

      if (rule.action === 'ADD_TIMEOUT_NEGATIVE_TC') {
        const storiesWithTimeout = new Set(
          tcs.filter((tc) => tc.name.includes('expired') || tc.name.includes('timeout'))
            .map((tc) => tc.userStoryId),
        );
        const affectedCount = tcs.filter((tc) => !storiesWithTimeout.has(tc.userStoryId)).length;
        this._logger.info('Improvement rule applied: ADD_TIMEOUT_NEGATIVE_TC', { affectedStories: affectedCount });
      }

      if (rule.action === 'INCREASE_PRIORITY_CRITICAL_API') {
        tcs = tcs.map((tc) =>
          tc.type === TC_TYPE.API && tc.featureId ? { ...tc, priority: PRIORITY.HIGH } : tc,
        );
      }
    }

    return tcs;
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  _buildAgentResult(output, warnings, durationMs) {
    return {
      agentId:        STAGE_ID,
      stageNumber:    '02',
      stageName:      STAGE_NAME,
      status:         STAGE_STATUS.COMPLETED,
      output,
      clarifications: [],
      warnings,
      memoryUpdate:   { testCaseCount: output.zephyrExport.totalTestCases },
      timestamp:      new Date().toISOString(),
      durationMs,
      approvalStatus:  'PENDING',
      approvalComment: '',
    };
  }

  _saveToDisk(output) {
    if (process.env.SAVE_ZEPHYR_DISK_JSON !== 'true') return;
    const outDir = path.resolve(__dirname, '../../reports/json');
    const tcPath = path.join(outDir, `test-cases-zephyr-${Date.now()}.json`);
    const k6Path = path.join(outDir, `k6-scenario-index-${Date.now()}.json`);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(tcPath, JSON.stringify(output.zephyrExport,    null, 2), 'utf-8');
    fs.writeFileSync(k6Path, JSON.stringify(output.k6ScenarioIndex, null, 2), 'utf-8');
    this._logger.info('Test cases saved to disk', { tcPath, k6Path });
  }

  /**
   * Syncs all generated test cases to BDD .feature file(s).
   * Enforces a strict 1:1 parity between test cases and feature Scenarios.
   * @private
   */
  _syncFeatureFiles(analysis: any, testCases: any[]): string[] {
    const featureDir = path.resolve(__dirname, '../../tests/features');
    if (!fs.existsSync(featureDir)) {
      fs.mkdirSync(featureDir, { recursive: true });
    }

    const fallbackStoryId = analysis?.features?.[0]?.userStories?.[0]?.id || 'US-01';
    const storyGroups = new Map<string, any[]>();

    for (const tc of testCases) {
      const storyId = tc.userStoryId || tc.traceabilityLinks?.userStoryId || fallbackStoryId;
      if (!storyGroups.has(storyId)) {
        storyGroups.set(storyId, []);
      }
      storyGroups.get(storyId)!.push(tc);
    }

    const savedPaths: string[] = [];
    let totalScenariosCount = 0;

    for (const [storyId, storyTCs] of storyGroups.entries()) {
      let matchedFeature: any = null;
      let matchedStory: any = null;

      for (const f of (analysis.features || [])) {
        const s = (f.userStories || []).find((st: any) => st.id === storyId);
        if (s) {
          matchedFeature = f;
          matchedStory = s;
          break;
        }
      }

      if (!matchedFeature && analysis.features?.length > 0) {
        matchedFeature = analysis.features[0];
        matchedStory = matchedFeature.userStories?.[0];
      }

      const featureTitle = matchedFeature?.name || matchedStory?.title || 'User Authentication System';
      const role = matchedStory?.role || 'user of the application';
      const goal = matchedStory?.goal || 'authenticate and use the system securely';
      const benefit = matchedStory?.benefit || 'access protected functionality';

      // ── Create Feature Name directory inside features (tests/features/<Feature Name>/) ──
      const featureFolderName = (matchedFeature?.name || 'General Features')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .trim();
      const targetFeatureDir = path.join(featureDir, featureFolderName);
      if (!fs.existsSync(targetFeatureDir)) {
        fs.mkdirSync(targetFeatureDir, { recursive: true });
      }

      let fileName: string | null = null;
      if (Array.isArray(analysis.gherkinFeatures)) {
        const gf = analysis.gherkinFeatures.find((g: any) =>
          g.fileName && (g.fileName.includes(storyId) || g.fileName.toLowerCase().includes(storyId.toLowerCase()))
        );
        if (gf?.fileName) {
          fileName = path.basename(gf.fileName);
        }
      }

      if (!fileName && Array.isArray(analysis.featureFilePaths)) {
        const fp = analysis.featureFilePaths.find((p: string) => path.basename(p).includes(storyId));
        if (fp) {
          fileName = path.basename(fp);
        }
      }

      if (!fileName && fs.existsSync(targetFeatureDir)) {
        const existingFiles = fs.readdirSync(targetFeatureDir).filter((f: string) => f.endsWith('.feature'));
        const matchedExisting = existingFiles.find((f: string) => f.includes(storyId));
        if (matchedExisting) {
          fileName = matchedExisting;
        }
      }

      if (!fileName && fs.existsSync(featureDir)) {
        const existingFiles = fs.readdirSync(featureDir).filter((f: string) => f.endsWith('.feature'));
        const matchedExisting = existingFiles.find((f: string) => f.includes(storyId));
        if (matchedExisting) {
          fileName = matchedExisting;
        } else if (existingFiles.length === 1) {
          fileName = existingFiles[0];
        }
      }

      if (!fileName) {
        const slug = (matchedStory?.title || matchedFeature?.name || 'feature')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        fileName = `${storyId}-${slug}.feature`;
      }

      if (!fileName.endsWith('.feature')) {
        fileName = `${fileName}.feature`;
      }

      // ── Automatically partition test cases into UI, API, and Performance files ──
      const uiTCs = storyTCs.filter((tc: any) =>
        tc.type === TC_TYPE.POSITIVE || tc.type === TC_TYPE.NEGATIVE || tc.type === TC_TYPE.EDGE
      );
      const apiTCs = storyTCs.filter((tc: any) => tc.type === TC_TYPE.API);
      const perfTCs = storyTCs.filter((tc: any) => tc.type === TC_TYPE.PERFORMANCE);

      const baseSlug = fileName.replace(/\.feature$/i, '').replace(/-(api|perf)$/i, '');

      const partitions = [
        { type: 'UI', tcs: uiTCs, suffix: '', titleSuffix: '', bgStep: 'Given the user is on the login page' },
        { type: 'API', tcs: apiTCs, suffix: '-api', titleSuffix: ' — API', bgStep: 'Given the backend API service is available' },
        { type: 'Performance', tcs: perfTCs, suffix: '-perf', titleSuffix: ' — Performance', bgStep: 'Given the application is operational for performance testing' },
      ].filter((p) => p.tcs.length > 0);

      for (const partition of partitions) {
        const partFileName = `${baseSlug}${partition.suffix}.feature`;
        const partFilePath = path.join(targetFeatureDir, partFileName);

        const partFeatureTitle = `${featureTitle}${partition.titleSuffix}`;
        const lines: string[] = [
          `Feature: ${partFeatureTitle}`,
          `  As a ${role},`,
          `  I want to ${goal}`,
          `  So that ${benefit}.`,
          '',
          '  Background:',
          `    ${partition.bgStep}`,
          '',
        ];

        for (const tc of partition.tcs) {
          const tags: string[] = [];
          const typeTag = `@${tc.type.toLowerCase()}`;
          tags.push(typeTag);

          if (Array.isArray(tc.labels)) {
            for (const l of tc.labels) {
              const cleanLabel = `@${String(l).toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
              if (!tags.includes(cleanLabel)) {
                tags.push(cleanLabel);
              }
            }
          }

          const keyTag = `@${tc.key.toLowerCase()}`;
          if (!tags.includes(keyTag)) {
            tags.push(keyTag);
          }

          let scenarioTitle = tc.name || tc.objective || tc.key;
          if (scenarioTitle.includes('—')) {
            scenarioTitle = scenarioTitle.split('—').slice(1).join('—').trim();
          } else if (scenarioTitle.includes(' - ')) {
            scenarioTitle = scenarioTitle.split(' - ').slice(1).join(' - ').trim();
          } else {
            scenarioTitle = scenarioTitle.replace(/^\[.*?\]\s*/g, '').trim();
          }

          lines.push(`  ${tags.join(' ')}`);
          lines.push(`  Scenario: [${tc.key}] ${scenarioTitle}`);

          const steps = tc.testSteps || [];
          if (steps.length === 0) {
            lines.push('    Given the application state is prepared');
            lines.push(`    When the test action for "${tc.key}" is executed`);
            lines.push(`    Then the expected outcome is validated: ${tc.objective || 'Success'}`);
          } else {
            for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
              const step = steps[stepIdx];
              const desc = (step.description || '').trim();
              const data = (step.testData || '').trim();
              const expected = (step.expectedResult || '').trim();

              const isVerification = /^(verify|validate|check|confirm|ensure)/i.test(desc);
              const isNav = /^(navigate|open|given|go to)/i.test(desc);

              if (isVerification) {
                const thenText = expected || desc;
                lines.push(`    Then ${thenText}`);
              } else {
                const keyword = (stepIdx === 0 && isNav) ? 'Given' : 'When';
                lines.push(`    ${keyword} ${desc}`);

                if (data && !/^\((leave blank|none|no token.*)\)$/i.test(data)) {
                  lines.push(`    And with test data "${data}"`);
                }

                if (expected && expected.toLowerCase() !== desc.toLowerCase()) {
                  lines.push(`    Then ${expected}`);
                }
              }
            }
          }

          lines.push('');
        }

        const content = lines.join('\n');
        fs.writeFileSync(partFilePath, content, 'utf-8');
        savedPaths.push(partFilePath);

        const scenarioCount = (content.match(/^\s*Scenario:/gm) || []).length;
        totalScenariosCount += scenarioCount;

        this._logger.info(`Feature file synced: [${partition.type}]`, {
          filePath: partFilePath,
          storyId,
          scenariosCount: scenarioCount,
          expectedTCs: partition.tcs.length,
        });
      }
    }

    if (totalScenariosCount !== testCases.length) {
      this._logger.warn(`Feature file scenario count mismatch: generated ${totalScenariosCount} scenarios for ${testCases.length} test cases`);
    } else {
      this._logger.info(`Feature file sync complete: ${totalScenariosCount}/${testCases.length} scenarios strictly matched.`);
    }

    return savedPaths;
  }

  _loadSkill() {
    let skill = '';
    try { skill = fs.readFileSync(SKILL_PATH, 'utf-8'); } catch {}
    const learningsPath = path.resolve(__dirname, 'LEARNINGS.md');
    if (fs.existsSync(learningsPath)) {
      skill += '\n\n' + fs.readFileSync(learningsPath, 'utf-8');
    }
    return skill;
  }
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const opts: any = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const [key, val] = arg.slice(2).split('=');
        opts[key] = val || args[i + 1];
        if (!val) i++;
      }
    }

    const projectId = opts.project || FRAMEWORK_CONFIG.projectId;
    await stateManager.initialize(projectId);
    await memoryEngine.initialize(projectId);

    const agent = new TestCaseGeneratorAgent();
    const analyzedRequirements = await stateManager.getPipelineArtifact('analyzedRequirements');

    if (!analyzedRequirements) {
      console.error(`❌ No analyzed requirements found for project "${projectId}". Run Agent 01 first.`);
      process.exit(1);
    }

    const result = await agent.run({ analyzedRequirements });
    console.log(`\n✅ Agent 02 completed — ${result.output.zephyrExport.totalTestCases} test cases generated`);
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })();
}
