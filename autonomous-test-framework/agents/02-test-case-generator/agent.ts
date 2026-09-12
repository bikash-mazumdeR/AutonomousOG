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
  buildSummary, buildApprovalSummary, buildZephyrExport, buildK6ScenarioIndex, syncFeatureFiles
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

          const positiveTCs    = input.opts?.['skip-positive'] ? [] : generatePositiveTCs(this._counter, feature, story, analysis);
          const negativeTCs    = input.opts?.['skip-negative'] ? [] : generateNegativeTCs(this._counter, feature, story, analysis);
          const edgeTCs        = input.opts?.['skip-edge'] ? [] : generateEdgeTCs(this._counter, feature, story, analysis);
          const apiTCs         = input.opts?.['skip-api'] ? [] : (story.testTypes.includes('API') ? generateAPITCs(this._counter, feature, story, analysis) : []);
          const performanceTCs = input.opts?.['skip-perf'] ? [] : (story.testTypes.includes('PERFORMANCE') ? generatePerformanceTCs(this._counter, feature, story, analysis) : []);

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
      const featureFilePaths = syncFeatureFiles(analysis, improvedTCs, this._logger);

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
        const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
        if (latestRun?.project_id) {
          activeProjectId = latestRun.project_id;
        }
      } catch (_) {}
    }
    activeProjectId = activeProjectId || FRAMEWORK_CONFIG.projectId || 'default';

    await stateManager.initialize(activeProjectId);
    await memoryEngine.initialize(activeProjectId);

    const agent = new TestCaseGeneratorAgent();
    const analyzedRequirements = await stateManager.getPipelineArtifact('analyzedRequirements');

    if (!analyzedRequirements) {
      console.error(`❌ No analyzed requirements found for project "${projectId}". Run Agent 01 first.`);
      process.exit(1);
    }

    const result = await agent.run({ analyzedRequirements, opts });
    console.log(`\n✅ Agent 02 completed — ${result.output.zephyrExport.totalTestCases} test cases generated`);
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })();
}
