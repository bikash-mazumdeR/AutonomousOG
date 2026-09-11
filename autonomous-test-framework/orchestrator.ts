'use strict';

/**
 * @fileoverview ARIA Master Orchestrator.
 * Controls the 11-stage autonomous test pipeline.
 * Enforces approval gates, manages state, and coordinates all agents.
 *
 * @module Orchestrator
 * @version 1.0.0
 */

require('dotenv').config();
require('ts-node').register({ transpileOnly: true });

import path from 'path';
import fs from 'fs';
import chalk from 'chalk';

import { stateManager, STAGE_STATUS, APPROVAL_STATUS } from './core/state-manager/StateManager';
import { stateDb } from './core/state-manager/Database';
import { memoryEngine } from './core/project-memory/MemoryEngine';
import { Logger } from './core/logger/Logger';
import { FRAMEWORK_CONFIG, PIPELINE_STAGES } from './config/framework.config';
import { AgentResult } from './core/types';
import { llmClient } from './core/llm/LLMClient';

// ─── Constants ────────────────────────────────────────────────────────────────

const logger = new Logger('Orchestrator');

const ARIA_BANNER = chalk.cyan(`
╔════════════════════════════════════════════════════════════════════════╗
║                                                                        ║
║   █████╗ ██████╗ ██╗ █████╗     ███████╗██████╗  █████╗ ███╗   ███╗  ║
║  ██╔══██╗██╔══██╗██║██╔══██╗    ██╔════╝██╔══██╗██╔══██╗████╗ ████║  ║
║  ███████║██████╔╝██║███████║    █████╗  ██████╔╝███████║██╔████╔██║  ║
║  ██╔══██║██╔══██╗██║██╔══██║    ██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║  ║
║  ██║  ██║██║  ██║██║██║  ██║    ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║  ║
║  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝   ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝  ║
║                                                                        ║
║  ${chalk.bold('Autonomous Reliability & Intelligence Agent')}  v1.0.0                  ║
║  AI-Driven Autonomous Testing Framework                                ║
╚════════════════════════════════════════════════════════════════════════╝
`);

// ─── Orchestrator Class ───────────────────────────────────────────────────────

/**
 * @class Orchestrator
 * @description Master pipeline controller. Runs agents sequentially,
 * enforces approval gates, and manages the global test pipeline lifecycle.
 */
class Orchestrator {
  private _startedAt: number | null = null;
  private _projectId: string;

  constructor() {
    this._projectId = FRAMEWORK_CONFIG.projectId;
  }

  // ── Entry Point ──────────────────────────────────────────────────────────

  /**
   * Starts the full ARIA pipeline from Stage 01 (or a specified starting stage).
   * @param {any} [options]
   * @returns {Promise<void>}
   */
  async start(options: any = {}) {
    this._startedAt = Date.now();
    console.log(ARIA_BANNER);

    if (options.projectName) {
      this._projectId = options.projectName;
    } else if (options.startFromStage) {
      try {
        stateDb.initialize();
        const latestRun = stateDb.prepare('SELECT project_id FROM runs ORDER BY started_at DESC LIMIT 1').get() as any;
        if (latestRun && latestRun.project_id) {
          this._projectId = latestRun.project_id;
          logger.info(`Auto-detected active project ID "${this._projectId}" from previous run`, { projectId: this._projectId });
        }
      } catch {
        // Fallback to default projectId
      }
    }

    logger.info('Pipeline starting', {
      projectId: this._projectId,
      environment: FRAMEWORK_CONFIG.environment,
      approvalMode: FRAMEWORK_CONFIG.approvalMode,
      stages: PIPELINE_STAGES.length,
    });

    const startFromStage = options.startFromStage
      || process.env.PIPELINE_START_STAGE
      || PIPELINE_STAGES[0].id;

    const startIndex = PIPELINE_STAGES.findIndex((s: any) => s.id === startFromStage);
    if (startIndex === -1) {
      throw new Error(`Unknown start stage: "${startFromStage}"`);
    }

    const isNewRun = Boolean(options.newRun) || (!options.resume && startIndex === 0);

    // ── Initialize core services ───────────────────────────────────────
    if (isNewRun) {
      logger.info('Starting fresh pipeline run', { projectId: this._projectId });
      await stateManager.resetForNewRun(this._projectId);
    } else {
      logger.info('Resuming existing pipeline run', { projectId: this._projectId, startStage: startFromStage });
      await stateManager.initialize(this._projectId);
    }
    await memoryEngine.initialize(this._projectId);

    logger.info('Pipeline initialized', {
      startStage: startFromStage,
      remainingStages: PIPELINE_STAGES.length - startIndex,
    });

    // ── Run pipeline stages ──────────────────────────────
    let previousResult: any = null;

    for (let i = startIndex; i < PIPELINE_STAGES.length; i++) {
      const stageDef: any = PIPELINE_STAGES[i];
      const parallelGroup = stageDef.parallelGroup;

      if (parallelGroup) {
        // Identify all stages in this parallel group
        const groupStages: any[] = [];
        let j = i;
        while (j < PIPELINE_STAGES.length && (PIPELINE_STAGES[j] as any).parallelGroup === parallelGroup) {
          groupStages.push(PIPELINE_STAGES[j]);
          j++;
        }

        logger.info(`\n${'═'.repeat(70)}`);
        logger.info(`Running Parallel Group: ${parallelGroup} (${groupStages.length} stages)`);
        logger.info('═'.repeat(70));

        // Execute stages in parallel
        const results = await Promise.all(groupStages.map((s, idx) => 
          this._executeStage(s, options, i + idx, previousResult)
        ));

        // Handle results (if any stage rejects, we halt)
        const rejection = results.find(r => r && r.approvalStatus === APPROVAL_STATUS.REJECTED);
        if (rejection) {
          const rejectingStage = groupStages[results.indexOf(rejection)];
          logger.warn('Pipeline halted — stage in parallel group rejected', {
            stageId: rejectingStage.id,
            reason:  rejection.approvalComment,
          });
          this._printPipelineHaltBanner(rejectingStage, rejection.approvalComment);
          return;
        }

        // Use the last stage's result as the previousResult for the next group/stage
        previousResult = results[results.length - 1];
        i = j - 1; // Advance main loop counter
      } else {
        // Run single sequential stage
        logger.info(`\n${chalk.blue('═'.repeat(70))}`);
        logger.info(`${chalk.blue.bold('🏁 Stage')} ${chalk.yellow(String(i + 1).padStart(2, '0'))} / ${PIPELINE_STAGES.length} — ${chalk.cyan.bold(stageDef.name)}`);
        logger.info(chalk.blue('═'.repeat(70)));

        previousResult = await this._executeStage(stageDef, options, i, previousResult);

        if (previousResult && previousResult.approvalStatus === APPROVAL_STATUS.REJECTED) {
          // Special handling: Stage 06 rejected with request to re-run Stage 05
          const isRunAgent05Request = stageDef.id === '06-automation-reviewer' && (
            /agent[:\s]*0?5/i.test(previousResult.approvalComment || '') ||
            Boolean(previousResult.approvalComment && previousResult.approvalComment.includes('Run Agent 05'))
          );

          if (isRunAgent05Request) {
            const agent05Index = PIPELINE_STAGES.findIndex((s) => s.id === '05-playwright-script-generator');
            if (agent05Index !== -1) {
              logger.info(`\n${chalk.cyan('🔄 Re-routing pipeline back to Stage 05 (Playwright Script Generator) to resolve review issues...')}`);
              // Cleanly reset Stage 06 and Stage 05 status in StateManager so they can be re-run
              await stateManager.update((state) => {
                if (state.stages['06-automation-reviewer']) {
                  state.stages['06-automation-reviewer'].status = STAGE_STATUS.PENDING;
                  state.stages['06-automation-reviewer'].approval = APPROVAL_STATUS.PENDING;
                  state.stages['06-automation-reviewer'].rejectionReason = previousResult.approvalComment;
                }
                if (state.stages['05-playwright-script-generator']) {
                  state.stages['05-playwright-script-generator'].status = STAGE_STATUS.PENDING;
                  state.stages['05-playwright-script-generator'].approval = APPROVAL_STATUS.PENDING;
                }
                state.globalStatus = 'RUNNING';
                return state;
              });
              i = agent05Index - 1; // So next iteration executes agent05Index
              continue;
            }
          }

          logger.warn('Pipeline halted — stage rejected by human', {
            stageId: stageDef.id,
            reason:  previousResult.approvalComment,
          });
          this._printPipelineHaltBanner(stageDef, previousResult.approvalComment);
          return;
        }
      }
    }

    // ── Pipeline completed ────────────────────────────────────────
    const durationSec = Math.round((Date.now() - (this._startedAt || Date.now())) / 1000);
    await this._recordCompletedCycle(durationSec);
    await this._printCompletionBanner(durationSec);
  }

  /**
   * Encapsulates the execution logic for a single stage.
   * @private
   */
  async _executeStage(stageDef: any, options: any, stageIndex: number, previousResult: any) {
    // ── Check stage preconditions ────────────────────────────────
    const shouldRun = await this._checkPreconditions(stageDef, previousResult);
    if (!shouldRun) {
      logger.warn('Stage skipped — preconditions not met', { stageId: stageDef.id });
      await stateManager.set(`stages.${stageDef.id}.status`, STAGE_STATUS.SKIPPED);
      return null;
    }

    // ── Load and run the agent ───────────────────────────────────
    try {
      // Reset usage before starting to ensure we only track this attempt
      llmClient.resetStageUsage(stageDef.id);
      
      const agentResult = await this._runAgent(stageDef, options, stageIndex);
      
      if (agentResult && agentResult.status === STAGE_STATUS.COMPLETED && agentResult.approvalStatus !== APPROVAL_STATUS.REJECTED) {
        const usage = llmClient.getStageUsage(stageDef.id);
        await stateManager.markStageCompleted(stageDef.id, agentResult.output, usage);
        
        logger.info('Stage completed with usage tracking', { 
          stageId: stageDef.id, 
          tokens: usage.totalTokens,
          cost: `$${usage.estimatedCost}`
        });
      }

      return agentResult;
    } catch (error: any) {
      logger.error('Stage execution failed with unhandled error', {
        stageId:  stageDef.id,
        error:    error.message,
      });

      this._printErrorBanner(stageDef, error);

      // Critical stages halt pipeline on failure
      if (stageDef.critical) {
        logger.fatal('Critical stage failed — halting pipeline', { stageId: stageDef.id });
        throw new Error(`PIPELINE_HALT: Critical stage "${stageDef.id}" failed: ${error.message}`);
      }

      logger.warn('Non-critical stage failed — continuing to next stage', { stageId: stageDef.id });
      return null;
    }
  }

  // ── Agent Execution ──────────────────────────────────────────────────────

  /**
   * Loads and executes a single agent.
   * @private
   */
  async _runAgent(stageDef: any, pipelineOptions: any, stageIndex: number) {
    let agentPath = path.resolve(__dirname, stageDef.agentPath);
    
    // Support .ts if .js doesn't exist (for development)
    if (!fs.existsSync(agentPath) && fs.existsSync(agentPath.replace('.js', '.ts'))) {
      agentPath = agentPath.replace('.js', '.ts');
    }

    if (!fs.existsSync(agentPath)) {
      logger.warn('Agent file not yet implemented — skipping', { stageId: stageDef.id, agentPath });
      await stateManager.set(`stages.${stageDef.id}.status`, STAGE_STATUS.SKIPPED);
      return null;
    }

    // Dynamically load the agent class
    const AgentModule = require(agentPath);
    let AgentClass = AgentModule.default || AgentModule;
    
    // If it's still not the class, search for it
    if (typeof AgentClass !== 'function' || !AgentClass.prototype || !AgentClass.prototype.run) {
      AgentClass = Object.values(AgentModule).find(
        (v) => typeof v === 'function' && v.prototype && v.prototype.run,
      ) as any;
    }

    if (!AgentClass || typeof AgentClass !== 'function') {
      throw new Error(`Agent module at "${agentPath}" does not export a valid class with a run() method`);
    }

    const agent = new AgentClass();

    // Build agent-specific input from pipeline state
    const agentInput = await this._buildAgentInput(stageDef, pipelineOptions);

    logger.stage('DISPATCH', stageDef.id, { agentClass: AgentClass.name });
    const result = await agent.run(agentInput);

    return result;
  }

  /**
   * Builds the input payload for each stage from previous stage outputs.
   * @private
   */
  async _buildAgentInput(stageDef: any, pipelineOptions: any) {
    const state = await stateManager.getFullState();
    const input = { ...pipelineOptions };

    // Map each input artifact from pipeline state
    for (const artifactKey of stageDef.inputs) {
      input[artifactKey] = (state.pipeline as any)[artifactKey];
    }

    // Stage 05 receives reviewedScripts for review issue resolution
    if (stageDef.id === '05-playwright-script-generator') {
      if ((state.pipeline as any).reviewedScripts) {
        input.reviewedScripts = (state.pipeline as any).reviewedScripts;
      }
      if ((state.pipeline as any).analyzedRequirements) {
        input.analyzedRequirements = (state.pipeline as any).analyzedRequirements;
      }
    }

    // Stage 01 always gets requirements from CLI/options
    if (stageDef.id === '01-requirement-analyzer') {
      const rawReq = pipelineOptions.requirements;

      if (rawReq) {
        // Multi-location resolution for requirements file
        const candidates = [
          path.resolve(process.cwd(), rawReq),
          path.resolve(process.cwd(), '..', rawReq),
          path.resolve(process.cwd(), 'requirements', path.basename(rawReq)),
          path.resolve(__dirname, rawReq),
          path.resolve(__dirname, 'requirements', path.basename(rawReq)),
          path.resolve(__dirname, '..', rawReq),
        ];

        let foundPath: string | null = null;
        for (const candidate of candidates) {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            foundPath = candidate;
            break;
          }
        }

        if (foundPath) {
          logger.info('Requirements file resolved — reading contents', { path: foundPath });
          input.requirements = fs.readFileSync(foundPath, 'utf-8');
        } else if (rawReq.endsWith('.md') || rawReq.endsWith('.txt') || rawReq.startsWith('./') || rawReq.startsWith('../')) {
          // The argument looks like a file path, but does not exist on disk
          throw new Error(`Requirements file not found: "${rawReq}". Checked locations:\n  - ${candidates.join('\n  - ')}`);
        } else {
          // User pasted inline requirement text directly
          input.requirements = rawReq;
        }
      } else {
        input.requirements = await this._promptForRequirements();
      }

      input.projectName  = pipelineOptions.projectName  || 'ARIA Test Project';
      input.format       = pipelineOptions.format       || 'text';
    }

    return input;
  }

  /**
   * Prompts the operator for requirements if not provided as CLI argument.
   * @private
   */
  async _promptForRequirements() {
    // Check for requirements file in common locations
    const candidates = [
      './requirements/requirement.md',
      './requirement.md',
      '../requirement.md',
      './requirements.txt',
      './requirements.md',
      './docs/requirements.md',
      './requirements/index.md',
    ];

    for (const candidate of candidates) {
      const resolved = path.resolve(process.cwd(), candidate);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        logger.info('Requirements file auto-detected', { path: resolved });
        return fs.readFileSync(resolved, 'utf-8');
      }
    }

    logger.error('No requirements file found. Pipeline cannot start without requirements.');
    throw new Error('MISSING_REQUIREMENTS: Please provide requirements via --requirements flag or add a requirements.txt file to the project root.');
  }

  // ── Precondition Checks ──────────────────────────────────────────────────

  /**
   * Validates that all required inputs for a stage are available.
   * @private
   */
  async _checkPreconditions(stageDef: any, previousResult: any) {
    if (stageDef.inputs.length === 0) return true;

    const state = await stateManager.getFullState();

    for (const inputKey of stageDef.inputs) {
      if (inputKey === 'requirements') continue; // Special case — provided by user
      if (!(state.pipeline as any)[inputKey]) {
        logger.warn('Precondition not met — missing input artifact', {
          stageId: stageDef.id,
          missingInput: inputKey,
        });
        return false;
      }
    }

    return true;
  }

  // ── Cycle Recording ──────────────────────────────────────────────────────

  /**
   * Records the completed pipeline cycle to memory.
   * @private
   */
  async _recordCompletedCycle(durationSec: number) {
    try {
      const state = await stateManager.getFullState();
      const execResults = state.pipeline.executionResults;

      await memoryEngine.recordCycle({
        runId:       state.runId,
        passRate:    execResults ? (execResults.passRate || 0) : 0,
        totalTests:  execResults ? (execResults.totalTests || 0) : 0,
        bugsFound:   state.pipeline.bugReports ? state.pipeline.bugReports.length : 0,
        autoHeals:   state.pipeline.healingPatches ? state.pipeline.healingPatches.length : 0,
        durationSec,
        stages: Object.fromEntries(
          Object.entries(state.stages).map(([k, v]) => [k, v.status]),
        ),
        keyLearnings: [],
      });

    } catch (error: any) {
      logger.warn('Failed to record cycle to memory', { error: error.message });
    }
  }

  // ── Console Output ───────────────────────────────────────────────────────

  /** @private */
  _printPipelineHaltBanner(stageDef: any, reason: string) {
    const projectFlag = this._projectId ? ` --project=${this._projectId}` : '';
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                   ⏹️  PIPELINE HALTED                                ║
╚══════════════════════════════════════════════════════════════════════╝

  Stage:  ${stageDef.name}
  Reason: ${reason || 'Rejected by human reviewer'}

  To resume from this stage after fixing:
    npm run pipeline:start --${projectFlag} --startFrom=${stageDef.id}

  To view current state:
    npm run pipeline:status
`);
  }

  /** @private */
  _printErrorBanner(stageDef: any, error: any) {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                   ❌  STAGE ERROR                                    ║
╚══════════════════════════════════════════════════════════════════════╝

  Stage: ${stageDef.name}
  Error: ${error.message}
`);
  }

  /** @private */
  async _printCompletionBanner(durationSec: number) {
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    let statusText = `  ✅ All ${PIPELINE_STAGES.length} stages executed successfully`;
    try {
      const state = await stateManager.getFullState();
      const completedStages = Object.values(state.stages).filter((s: any) => s.status === STAGE_STATUS.COMPLETED).length;
      const skippedStages = Object.values(state.stages).filter((s: any) => s.status === STAGE_STATUS.SKIPPED).length;
      if (skippedStages > 0) {
        statusText = `  ⚠️  Completed ${completedStages}/${PIPELINE_STAGES.length} stages (${skippedStages} skipped due to unmet preconditions)`;
      }
    } catch {
      // ignore
    }

    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║              🎉  ARIA PIPELINE COMPLETE  🎉                          ║
╚══════════════════════════════════════════════════════════════════════╝

${statusText}
  ⏱️  Total Duration: ${mins}m ${secs}s
  📊 Reports:  ./reports/html/
  💾 Memory:   ./core/project-memory/memory.json
  📋 State:    ./.state/pipeline-state.json

  Run "npm run report:open" to view the execution report.
`);
  }
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const opts: any = {};

  // CLI arg parser: --key=value or --key value or --flag
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      if (val !== undefined) {
        opts[key] = val;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        opts[key] = args[i + 1];
        i++;
      } else {
        opts[key] = true;
      }
    }
  }

  const orchestrator = new Orchestrator();
  orchestrator.start({
    requirements:     opts.requirements || opts.req,
    projectName:      opts.project      || opts.name || opts.projectName || opts.projectId,
    startFromStage:   opts.startFrom    || opts.stage,
    format:           opts.format       || 'text',
    resume:           Boolean(opts.resume),
    newRun:           Boolean(opts['new-run'] || opts.newRun),
  }).catch((err) => {
    logger.fatal('Orchestrator crashed', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

export {  Orchestrator  };

