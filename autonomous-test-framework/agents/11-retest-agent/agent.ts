/**
 * @fileoverview Agent 11 — Re-Test Failed Cases.
 * Re-runs healed/previously-failed tests and produces a delta report
 * comparing first-run vs re-run results. Updates Project Memory with
 * confirmed healing successes.
 * @module RetestAgent
 * @version 1.0.0
 */
import { stateManager, STAGE_STATUS } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { approvalGate } from '../../core/approval-gate/ApprovalGate';
import { Logger } from '../../core/logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { TestRunnerAgent, RUN_MODE } from '../07-test-runner/agent';
import { jiraClient } from '../../mcp/jira/jira-mcp-client';

const STAGE_ID = '11-retest-agent';
const STAGE_NAME = 'Re-Test Failed Cases';

class RetestAgent {
  constructor() { this._logger = new Logger(STAGE_ID); }

  async run(input) {
    const startMs = Date.now();
    this._logger.stage('START', STAGE_ID);

    try {
      await stateManager.markStageRunning(STAGE_ID);

      const healingPatches = input.healingPatches || {};
      const executionResults = input.executionResults || {};
      const reviewedScripts = input.reviewedScripts || {};

      const failedKeys = (executionResults.failedTests || []).map((t) => t.tcKey).filter(Boolean);
      const healedKeys = (healingPatches.healingPatches || [])
        .filter((p) => p.healed).map((p) => p.tcKey).filter(Boolean);
      const targetKeys = healedKeys.length > 0 ? healedKeys : failedKeys;

      this._logger.info('Re-test starting', {
        targetCount: targetKeys.length,
        healedCount: healedKeys.length,
        totalFailed: failedKeys.length,
      });

      if (targetKeys.length === 0) {
        this._logger.info('No tests to re-run — pipeline complete');
        return await this._completeEmpty(startMs);
      }

      // ── Re-run only the target TCs ────────────────────────────────────
      const runner = new TestRunnerAgent();
      const rerunResult = await runner.run({
        reviewedScripts: reviewedScripts?.approvedScripts || reviewedScripts,
        mode: RUN_MODE.FAILED,
        targetTCKeys: targetKeys,
      });

      const retestResults = rerunResult.output;
      const delta = this._buildDelta(executionResults, retestResults, targetKeys);
      const finalPassRate = this._calcFinalPassRate(executionResults, retestResults);

      // ── Update memory and Jira status for verified fixes ───────────────
      await this._updateMemory(retestResults, healingPatches);
      await this._updateJiraStatus(delta);

      // ── Record final cycle in memory ──────────────────────────────────
      await memoryEngine.recordCycle({
        runId: `retest_${Date.now()}`,
        passRate: finalPassRate,
        totalTests: executionResults.summary?.total || 0,
        bugsFound: retestResults.summary?.failed || 0,
        autoHeals: delta.newPasses,
        stages: { '11-retest-agent': 'COMPLETED' },
        keyLearnings: delta.details.filter((d) => d.healed).map((d) => `Healed: ${d.tcKey}`),
      });

      const output = {
        retestId: `retest_${Date.now()}`,
        retestAt: new Date().toISOString(),
        targetKeys,
        healedKeys,
        originalSummary: executionResults.summary,
        retestSummary: retestResults.summary,
        delta,
        finalPassRate,
        message: delta.newPasses > 0
          ? `🎉 ${delta.newPasses} test(s) now passing after auto-heal!`
          : 'No additional tests healed in retest.',
      };

      await stateManager.setPipelineArtifact('retestResults', output);
      await stateManager.markStageCompleted(STAGE_ID, output);

      const durationMs = Date.now() - startMs;
      this._logger.stage('COMPLETE', STAGE_ID, {
        newPasses: delta.newPasses,
        stillFailing: delta.stillFailing,
        finalRate: `${finalPassRate}%`,
        durationMs,
      });

      const warnings = delta.details
        .filter((d) => !d.healed)
        .map((d) => `[STILL FAILING] ${d.tcKey} — manual investigation required`);

      const agentResult = this._buildAgentResult(output, warnings, durationMs);

      const gateResult = await approvalGate.waitForApproval({
        stageId: STAGE_ID,
        stageName: STAGE_NAME,
        nextStageName: 'PIPELINE_COMPLETE',
        summary: {
          'Tests Re-Run': targetKeys.length,
          'Now Passing (New)': delta.newPasses,
          'Still Failing': delta.stillFailing,
          Improvement: `+${delta.improvement}%`,
          'Final Overall Pass Rate': `${finalPassRate}%`,
          'Auto-Heal Success Rate': `${healingPatches.healingRate || 0}%`,
        },
        fullOutput: output,
        warnings,
      });

      agentResult.approvalStatus = gateResult.status;
      agentResult.approvalComment = gateResult.comment;
      return agentResult;
    } catch (error) {
      this._logger.error('Agent 11 failed', { error: error.message });
      await stateManager.markStageFailed(STAGE_ID, error);
      throw error;
    }
  }

  _buildDelta(original, retest, targetKeys) {
    const origFailed = new Set((original.failedTests || []).map((t) => t.tcKey));
    const retestFailed = new Set((retest.failedTests || []).map((t) => t.tcKey));

    const newPasses = targetKeys.filter((k) => origFailed.has(k) && !retestFailed.has(k)).length;
    const stillFailing = targetKeys.filter((k) => retestFailed.has(k)).length;
    const improvement = targetKeys.length > 0
      ? Math.round((newPasses / targetKeys.length) * 100) : 0;

    return {
      totalRetested: targetKeys.length,
      newPasses,
      stillFailing,
      improvement,
      details: targetKeys.map((k) => ({
        tcKey: k,
        before: 'FAILED',
        after: retestFailed.has(k) ? 'FAILED' : 'PASSED',
        healed: !retestFailed.has(k),
      })),
    };
  }

  _calcFinalPassRate(original, retest) {
    const total = original.summary?.total || 0;
    const wasPassed = original.summary?.passed || 0;
    const wasFailed = original.summary?.failed || 0;
    const nowPassed = Math.min(retest.summary?.passed || 0, wasFailed);
    return total > 0 ? Math.round(((wasPassed + nowPassed) / total) * 100) : 0;
  }

  async _updateMemory(retestResults, healingPatches) {
    const retestFailed = new Set((retestResults.failedTests || []).map((t) => t.tcKey));
    for (const patch of (healingPatches.healingPatches || []).filter((p) => p.healed)) {
      if (!retestFailed.has(patch.tcKey) && patch.strategyUsed) {
        await memoryEngine.recordHealingStrategy({
          name: patch.strategyUsed,
          description: patch.description,
          condition: patch.errorPattern,
          action: patch.actionTaken,
          successRate: 1.0,
        });
      }
    }
  }

  async _updateJiraStatus(delta) {
    for (const detail of delta.details) {
      try {
        const knownBug = await memoryEngine.findKnownBugByTcKey(detail.tcKey);
        if (knownBug && knownBug.jiraKey) {
          const issue = await jiraClient.getIssue(knownBug.jiraKey);
          const currentStatus = issue?.fields?.status?.name?.toLowerCase();

          // REQUIREMENT: Only act on bugs with status "Fixed"
          if (currentStatus !== 'fixed') {
            this._logger.info('Skipping Jira update: bug is not in "Fixed" status', {
              jiraKey: knownBug.jiraKey,
              currentStatus,
            });
            continue;
          }

          const transitions = await jiraClient.getTransitions(knownBug.jiraKey);
          let targetTransition = null;

          if (detail.healed) {
            // Case: Test PASSED (Healed/Fixed)
            // Priority 1: Exact match for "Verified as fixed"
            targetTransition = transitions.find((t) => t.name.toLowerCase() === 'verified as fixed');

            // Priority 2: Fallback to "Verified" if "Verified as fixed" isn't available
            if (!targetTransition) {
              targetTransition = transitions.find((t) => t.name.toLowerCase() === 'verified');
            }
          } else {
            // Case: Test STILL FAILING (Re-open)
            // Priority 1: Exact match for "Re-Open" or "Reopen"
            targetTransition = transitions.find((t) => t.name.toLowerCase() === 're-open'
              || t.name.toLowerCase() === 'reopen');
          }

          // STRICT MANDATE: Never transition to "Done"
          if (targetTransition && targetTransition.name.toLowerCase() === 'done') {
            this._logger.warn('Blocked attempt to transition to "Done"', { jiraKey: knownBug.jiraKey });
            targetTransition = null;
          }

          if (targetTransition) {
            await jiraClient.transitionIssue(knownBug.jiraKey, targetTransition.id);
            const statusMsg = detail.healed ? 'verified as fixed' : 're-opened';
            await jiraClient.addComment(knownBug.jiraKey, `🔄 Fix ${statusMsg} by ARIA Autonomous Retest Agent on ${new Date().toLocaleString()}`);
            this._logger.info('Jira bug status updated', { jiraKey: knownBug.jiraKey, transition: targetTransition.name });
          } else {
            this._logger.warn('No suitable transition found for bug in Fixed status', {
              jiraKey: knownBug.jiraKey,
              healed: detail.healed,
              available: transitions.map((t) => t.name),
            });
          }
        }
      } catch (err) {
        this._logger.warn('Failed to update Jira status for bug', { tcKey: detail.tcKey, error: err.message });
      }
    }
  }

  async _completeEmpty(startMs) {
    const output = {
      retestId: `retest_${Date.now()}`,
      retestAt: new Date().toISOString(),
      targetKeys: [],
      healedKeys: [],
      delta: {
        totalRetested: 0, newPasses: 0, stillFailing: 0, improvement: 0, details: [],
      },
      finalPassRate: 100,
      message: 'No failed tests — nothing to re-run.',
    };
    await stateManager.setPipelineArtifact('retestResults', output);
    await stateManager.markStageCompleted(STAGE_ID, output);
    return this._buildAgentResult(output, [], Date.now() - startMs);
  }

  _buildAgentResult(output, warnings, durationMs) {
    return {
      agentId: STAGE_ID,
      stageNumber: '11',
      stageName: STAGE_NAME,
      status: STAGE_STATUS.COMPLETED,
      output,
      clarifications: [],
      warnings,
      memoryUpdate: { finalPassRate: output.finalPassRate, delta: output.delta },
      timestamp: new Date().toISOString(),
      durationMs,
      approvalStatus: 'PENDING',
      approvalComment: '',
    };
  }
}

export { RetestAgent };

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
    const agent = new RetestAgent();
    const healingPatches = await stateManager.getPipelineArtifact('healingPatches');
    let executionResults = await stateManager.getPipelineArtifact('executionResults');
    const reviewedScripts = await stateManager.getPipelineArtifact('reviewedScripts');
    if (!executionResults) {
      try {
        const reportsDir = path.resolve(__dirname, '../../reports/json');
        if (fs.existsSync(reportsDir)) {
          const files = fs.readdirSync(reportsDir)
            .filter((f) => f.startsWith('execution-results-') && f.endsWith('.json'))
            .sort().reverse();
          if (files.length > 0) {
            executionResults = JSON.parse(fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8'));
          }
        }
      } catch {}
    }
    if (!executionResults) { console.error('❌ No execution results. Run Agent 07 first.'); process.exit(1); }
    const result = await agent.run({ healingPatches, executionResults, reviewedScripts });
    console.log(`✅ Agent 11 complete — New Passes: ${result.output.delta.newPasses}, Final Rate: ${result.output.finalPassRate}%`);
    process.exit(result.approvalStatus === 'APPROVED' ? 0 : 1);
  })();
}
