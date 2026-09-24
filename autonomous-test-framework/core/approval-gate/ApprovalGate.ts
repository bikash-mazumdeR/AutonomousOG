'use strict';

/**
 * @fileoverview Approval Gate Manager for the ARIA Framework.
 * Enforces mandatory human approval between every pipeline stage.
 * No stage may proceed without explicit human sign-off.
 *
 * @module ApprovalGate
 * @version 1.0.0
 */

import * as readline from 'readline';
import * as http from 'http';
import { stateManager, APPROVAL_STATUS } from '../state-manager/StateManager';
import { memoryEngine } from '../project-memory/MemoryEngine';
import { Logger } from '../logger/Logger';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { ApprovalStatus } from '../types';
import { llmClient } from '../llm/LLMClient';
import { tokenPriceCalculator } from '../llm/TokenPriceCalculator';

// ─── Constants ────────────────────────────────────────────────────────────────

const APPROVE_KEYWORDS  = new Set(['APPROVED', 'APPROVE', 'PROCEED', 'GO', 'YES', 'LGTM', 'Y']);
const REJECT_KEYWORDS   = ['REJECTED', 'REJECT', 'NO', 'DENY', 'N'];
const SHOW_KEYWORDS     = new Set(['SHOW', 'SHOW OUTPUT', 'DETAILS', 'VIEW']);
const HELP_KEYWORDS     = new Set(['HELP', '?', 'COMMANDS']);

const GATE_BANNER = `
╔══════════════════════════════════════════════════════════════════════╗
║           ⏸️  ARIA FRAMEWORK — MANUAL APPROVAL GATE  ⏸️             ║
╚══════════════════════════════════════════════════════════════════════╝`;

const HELP_TEXT = `
  Available commands:
  ─────────────────────────────────────────────────────
  APPROVED / PROCEED / GO / YES / LGTM  → Approve stage, proceed to next
  REJECTED — <reason>                   → Reject stage with reason
  SHOW OUTPUT                           → Display full stage output
  HELP / ?                              → Show this help
  ─────────────────────────────────────────────────────
`;

/** The automation code review, whose REJECT is resolved by re-running Agent 05. */
const CODE_REVIEW_STAGE_ID = '06-automation-reviewer';
/** Blockers quoted in a banner or an auto-rejection comment; the rest are counted. */
const MAX_BLOCKERS_SHOWN = 5;

interface ApprovalGateOptions {
  autoApprove?: boolean;
  timeoutMs?: number;
}

interface ApprovalResult {
  status: ApprovalStatus;
  stageId: string;
  comment: string;
  timestamp: string;
  approved: boolean;
}

// ─── ApprovalGate Class ───────────────────────────────────────────────────────

/**
 * @class ApprovalGate
 * @description Blocks pipeline execution and waits for explicit human approval.
 */
export class ApprovalGate {
  private _autoApprove: boolean;
  private _timeoutMs: number;
  private _logger: Logger;

  /**
   * @param {ApprovalGateOptions} [options]
   */
  constructor(options: ApprovalGateOptions = {}) {
    this._autoApprove = options.autoApprove === true;
    this._timeoutMs   = options.timeoutMs   || 0;
    this._logger      = new Logger('ApprovalGate');
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Presents an approval gate to the human operator.
   * Blocks execution until approval or rejection is received.
   *
   * @param {Object}  params
   * @param {string}  params.stageId         - e.g., '01-requirement-analyzer'
   * @param {string}  params.stageName       - Human-readable name
   * @param {string}  params.nextStageName   - What runs next on approval
   * @param {Object}  params.summary         - Summary of stage output
   * @param {Object}  [params.fullOutput]    - Full output (shown on SHOW command)
   * @param {Array}   [params.warnings]      - Non-blocking warnings
   * @param {Array}   [params.clarifications]- Pending questions
   *
   * @returns {Promise<ApprovalResult>}
   */
  async waitForApproval(params: {
    stageId: string;
    stageName: string;
    nextStageName: string | null;
    summary: any;
    fullOutput?: any;
    warnings?: string[];
    clarifications?: string[];
    usage?: any;
    isReviewRecovery?: boolean;
    /**
     * Reasons the stage's own review decided it must not proceed (e.g. Agent 03's REJECT). In auto-approve mode they
     * reject the stage instead of approving it; at a manual gate they are shown, and approving overrides them.
     */
    blockers?: string[];
  }): Promise<ApprovalResult> {
    const {
      stageId,
      stageName,
      nextStageName,
      summary,
      fullOutput  = {},
      warnings    = [],
      clarifications = [],
      usage: explicitUsage,
      isReviewRecovery: explicitReviewRecovery,
      blockers = [],
    } = params;

    this._logger.info('Approval gate activated', { stageId, stageName });

    // CI / auto-approve mode: a stage whose own review decided REJECT is rejected, never approved unseen.
    if (this._autoApprove && blockers.length > 0) {
      const comment = `AUTO-REJECTED (CI mode): the stage's own review decided it must not proceed — ${blockers.slice(0, MAX_BLOCKERS_SHOWN).join('; ')}`
        + (blockers.length > MAX_BLOCKERS_SHOWN ? ` (and ${blockers.length - MAX_BLOCKERS_SHOWN} more)` : '');
      this._logger.warn('AUTO-APPROVE mode active, but the stage review decided REJECT — rejecting', { stageId, blockers: blockers.length });
      await stateManager.markStageRejected(stageId, comment);
      await memoryEngine.recordApprovalFeedback(stageId, 'REJECTED', comment);
      return this._buildResult(APPROVAL_STATUS.REJECTED, stageId, comment);
    }
    if (this._autoApprove) {
      this._logger.warn('AUTO-APPROVE mode active — skipping human gate', { stageId });
      await stateManager.markStageApproved(stageId, 'AUTO-APPROVED (CI mode)');
      return this._buildResult(APPROVAL_STATUS.APPROVED, stageId, 'AUTO-APPROVED');
    }

    let stageUsage = explicitUsage || llmClient.getStageUsage(stageId);
    if ((!stageUsage || stageUsage.totalTokens === 0) && (stateManager as any)?._initialized) {
      try {
        const storedUsage = await stateManager.get(`stages.${stageId}.usage`);
        if (storedUsage && typeof storedUsage.totalTokens === 'number') {
          stageUsage = storedUsage;
        }
      } catch {
        // Fall back gracefully
      }
    }

    let isReviewRecovery = explicitReviewRecovery === true;
    if (!isReviewRecovery && stageId === '05-playwright-script-generator' && (stateManager as any)?._initialized) {
      try {
        const reviewedScripts = await stateManager.getPipelineArtifact('reviewedScripts');
        const reviewStage = await stateManager.get('stages.06-automation-reviewer');
        if (
          reviewedScripts?.reviewDecision === 'REJECT' ||
          (reviewedScripts?.failedFiles && reviewedScripts.failedFiles > 0) ||
          reviewStage?.status === 'REJECTED' ||
          reviewStage?.approvalStatus === 'REJECTED'
        ) {
          isReviewRecovery = true;
        }
      } catch {
        // Fall back gracefully
      }
    }

    const isReviewReject = summary && typeof summary === 'object' &&
      (summary['Review Decision'] === 'REJECT' || summary['reviewDecision'] === 'REJECT');

    // Only the automation code review (Agent 06) is answered by re-running Agent 05; any other stage's REJECT is its own.
    const isCodeReviewReject = isReviewReject && stageId === CODE_REVIEW_STAGE_ID;
    this._printGateBanner(stageId, stageName, nextStageName, summary, warnings, clarifications, stageUsage, isCodeReviewReject, isReviewRecovery, blockers);

    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
      });

      let server: http.Server;
      const port = (FRAMEWORK_CONFIG as any).approvalWebhookPort || parseInt(process.env.APPROVAL_WEBHOOK_PORT || '8081', 10);

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        rl.close();
        if (server) server.close();
      };

      // ── Webhook Server ───────────────────────────────────────────
      try {
        server = http.createServer((req, res) => {
          if (req.method === 'POST' && (req.url === '/approve' || req.url === '/reject')) {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
              try {
                const data = JSON.parse(body);
                if (data.stageId !== stageId) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'stageId mismatch' }));
                  return;
                }

                const isApproval = req.url === '/approve';
                const comment = data.comment || (isApproval ? 'Approved via Webhook' : 'Rejected via Webhook');
                const status = isApproval ? APPROVAL_STATUS.APPROVED : APPROVAL_STATUS.REJECTED;

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success' }));

                cleanup();
                
                if (isApproval) {
                  await stateManager.markStageApproved(stageId, comment);
                  await memoryEngine.recordApprovalFeedback(stageId, 'APPROVED', comment);
                  this._printApprovalConfirmation(stageName, nextStageName, isReviewRecovery);
                } else {
                  await stateManager.markStageRejected(stageId, comment);
                  await memoryEngine.recordApprovalFeedback(stageId, 'REJECTED', comment);
                  this._printRejectionConfirmation(stageName, comment, stageId);
                }

                this._logger.info(`Stage ${isApproval ? 'approved' : 'rejected'} via webhook`, { stageId, comment });
                resolve(this._buildResult(status as ApprovalStatus, stageId, comment));

              } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
              }
            });
          } else {
            res.writeHead(404);
            res.end();
          }
        });

        server.listen(port, () => {
          this._logger.info(`Approval webhook listener active on port ${port}`);
          console.log(`  🌐 Webhook active: http://localhost:${port}/approve (POST { "stageId": "${stageId}", "comment": "..." })`);
        });

        server.on('error', (err) => {
          this._logger.warn('Webhook server failed to start', { error: err.message });
        });

      } catch (err: any) {
        this._logger.warn('Failed to initialize webhook server', { error: err.message });
      }

      // Optional overall timeout
      let timeoutHandle: NodeJS.Timeout | null = null;
      if (this._timeoutMs > 0) {
        timeoutHandle = setTimeout(async () => {
          cleanup();
          const result = this._buildResult(
            APPROVAL_STATUS.REJECTED as ApprovalStatus,
            stageId,
            `Gate timed out after ${this._timeoutMs}ms`,
          );
          await stateManager.markStageRejected(stageId, 'Approval gate timed out');
          resolve(result);
        }, this._timeoutMs);
      }

      const prompt = () => {
        if (!process.stdin.readable || process.stdin.destroyed || process.stdin.readableEnded) {
          return;
        }
        rl.question('\n  ➤ Your decision: ', async (rawInput) => {
          if (rawInput === null || rawInput === undefined) return;
          const input = (rawInput || '').trim();
          if (!input && !process.stdin.isTTY) {
            return;
          }
          const upperInput = input.toUpperCase();

          // ── HELP ──────────────────────────────────────────────────────
          if (HELP_KEYWORDS.has(upperInput)) {
            if (stageId === CODE_REVIEW_STAGE_ID || isCodeReviewReject) {
              console.log(`
  Available commands (Automation Code Review):
  ─────────────────────────────────────────────────────
  RUN AGENT:05 / AGENT:05  → Reject stage and re-run Agent 05 to resolve code issues
  REJECTED — <reason>      → Reject stage with reason
  APPROVED                 → Override review and approve stage
  SHOW OUTPUT              → Display full stage output & blocker details
  HELP / ?                 → Show this help
  ─────────────────────────────────────────────────────
`);
            } else {
              console.log(HELP_TEXT);
            }
            return prompt();
          }

          // ── SHOW OUTPUT ───────────────────────────────────────────────
          if (SHOW_KEYWORDS.has(upperInput)) {
            console.log('\n  📄 FULL STAGE OUTPUT:\n');
            console.log(JSON.stringify(fullOutput, null, 2));
            console.log('');
            return prompt();
          }

          // ── RUN AGENT:05 (Stage 06 review or explicit re-run request) ─
          const RUN_AGENT05_KEYWORDS = new Set([
            'RUN AGENT:05', 'AGENT:05', 'AGENT 05', 'RUN AGENT 05', 'RE-RUN AGENT:05', 'RE-RUN AGENT 05', '5',
            'RUN AGENT:5', 'AGENT:5', 'AGENT 5', 'RUN AGENT 5', 'RE-RUN AGENT:5', 'RE-RUN AGENT 5',
            'RERUN AGENT:05', 'RERUN AGENT 05', 'RERUN AGENT:5', 'RERUN AGENT 5'
          ]);

          const isRunAgent05 = (stageId === CODE_REVIEW_STAGE_ID || isCodeReviewReject) && (
            RUN_AGENT05_KEYWORDS.has(upperInput) ||
            /^(?:re-?run\s+|run\s+)?agent[:\s]*0?5\b/i.test(input) ||
            upperInput.includes('RUN AGENT 05') ||
            upperInput.includes('RUN AGENT:05') ||
            upperInput.includes('RUN AGENT 5') ||
            upperInput.includes('RE-RUN AGENT 05') ||
            upperInput.includes('AGENT 05') ||
            upperInput.includes('AGENT:05') ||
            upperInput === '5'
          );

          if (isRunAgent05) {
            cleanup();
            const customReason = input
              .replace(/^(?:re-?run\s+|run\s+)?agent[:\s]*0?5\s*[-—:]?\s*/i, '')
              .replace(/^REJECTED?\s*[-—:]?\s*/i, '')
              .trim();
            const reason = customReason
              ? `Review rejected — Run Agent 05 to resolve code issues: ${customReason}`
              : 'Review rejected — Run Agent 05 to resolve code issues';

            await stateManager.markStageRejected(stageId, reason);
            await memoryEngine.recordApprovalFeedback(stageId, 'REJECTED', reason);

            this._printRejectionConfirmation(stageName, reason, stageId);
            this._logger.warn('Stage rejected to run Agent 05', { stageId, reason });

            resolve(this._buildResult(APPROVAL_STATUS.REJECTED as ApprovalStatus, stageId, reason));
            return;
          }

          // ── APPROVED ──────────────────────────────────────────────────
          const isApproval = Array.from(APPROVE_KEYWORDS).some((kw) => upperInput === kw || upperInput.startsWith(kw + ' ') || upperInput.startsWith(kw + '-'));

          if (isApproval) {
            cleanup();

            await stateManager.markStageApproved(stageId, input);
            await memoryEngine.recordApprovalFeedback(stageId, 'APPROVED', input);

            this._printApprovalConfirmation(stageName, nextStageName, isReviewRecovery);
            this._logger.info('Stage approved by human', { stageId, input });

            resolve(this._buildResult(APPROVAL_STATUS.APPROVED as ApprovalStatus, stageId, input));
            return;
          }

          // ── REJECTED ──────────────────────────────────────────────────
          const isRejection = REJECT_KEYWORDS.some((kw) => upperInput.startsWith(kw));

          if (isRejection) {
            cleanup();

            // Extract rejection reason
            const reason = input.replace(/^REJECTED?\s*[-—]?\s*/i, '').trim()
              || (isCodeReviewReject ? 'Review rejected — Run Agent 05 to resolve code issues' : 'No reason provided');

            await stateManager.markStageRejected(stageId, reason);
            await memoryEngine.recordApprovalFeedback(stageId, 'REJECTED', reason);

            this._printRejectionConfirmation(stageName, reason, stageId);
            this._logger.warn('Stage rejected by human', { stageId, reason });

            resolve(this._buildResult(APPROVAL_STATUS.REJECTED as ApprovalStatus, stageId, reason));
            return;
          }

          // ── UNRECOGNIZED ──────────────────────────────────────────────
          console.log(`\n  ⚠️  Unrecognized command: "${input}". Type HELP for options.\n`);
          prompt();
        });
      };

      prompt();
    });
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /** @private */
  private _printGateBanner(
    stageId: string,
    stageName: string,
    nextStageName: string | null,
    summary: any,
    warnings: string[],
    clarifications: string[],
    usageData?: any,
    isReviewReject: boolean = false,
    isReviewRecovery: boolean = false,
    blockers: string[] = [],
  ) {
    console.log(GATE_BANNER);
    console.log(`\n  ✅ Stage Completed: ${stageName}`);
    console.log(`  ⏭️  Next Stage:      ${nextStageName || 'END OF PIPELINE'}`);
    console.log('\n  📊 SUMMARY:');
    console.log('  ─────────────────────────────────────────────────────');

    if (typeof summary === 'object') {
      Object.entries(summary).forEach(([k, v]) => {
        const label = k.replace(/([A-Z])/g, ' $1').trim();
        console.log(`    ${label.padEnd(28)}: ${v}`);
      });
    } else {
      console.log(`    ${summary}`);
    }

    // ── Token Usage ──────────────────────────────────────────────────────────
    const usage = usageData || llmClient.getStageUsage(stageId) || {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
    const costUSD = usage.estimatedCostUSD ?? usage.estimatedCost ?? 0;
    const rate = usage.exchangeRate || tokenPriceCalculator.getExchangeRate();
    const costINR = usage.estimatedCostINR ?? (costUSD * rate);
    console.log('\n  🪙  TOKEN USAGE:');
    console.log('  ─────────────────────────────────────────────────────');
    console.log(`    ${'Prompt Tokens'.padEnd(28)}: ${(usage.promptTokens || 0).toLocaleString()}`);
    console.log(`    ${'Completion Tokens'.padEnd(28)}: ${(usage.completionTokens || 0).toLocaleString()}`);
    console.log(`    ${'Total Tokens'.padEnd(28)}: ${(usage.totalTokens || 0).toLocaleString()}`);
    console.log(`    ${'Estimated Cost'.padEnd(28)}: ₹${costINR.toFixed(2)} INR ($${costUSD.toFixed(6)} USD @ ₹${rate.toFixed(2)}/$)`);

    if (warnings.length > 0) {
      console.log(`\n  ⚠️  WARNINGS (${warnings.length}):`);
      warnings.slice(0, 5).forEach((w) => console.log(`    • ${w}`));
      if (warnings.length > 5) console.log(`    ... and ${warnings.length - 5} more`);
    }

    if (clarifications.length > 0) {
      console.log(`\n  ❓ PENDING CLARIFICATIONS (${clarifications.length}):`);
      clarifications.forEach((c) => console.log(`    • ${c}`));
    }

    if (blockers.length > 0 && !isReviewReject) {
      console.log('\n  ─────────────────────────────────────────────────────');
      console.log(`  🛑 This stage's own review decided REJECT (${blockers.length} reason(s)):`);
      blockers.slice(0, MAX_BLOCKERS_SHOWN).forEach((b) => console.log(`    • ${b}`));
      if (blockers.length > MAX_BLOCKERS_SHOWN) console.log(`    ... and ${blockers.length - MAX_BLOCKERS_SHOWN} more`);
      console.log('  👉 APPROVED overrides the review; REJECTED — <reason> stops the pipeline.');
      console.log('  ─────────────────────────────────────────────────────');
    }

    if (isReviewReject) {
      console.log('\n  ─────────────────────────────────────────────────────');
      console.log('  🛑 Review Decision: REJECT — Code issues or blockers detected!');
      console.log('  👉 Please run Agent 05 to resolve and regenerate the scripts:');
      console.log('     npm run agent:05');
      console.log('  ─────────────────────────────────────────────────────');
      console.log('  Commands: REJECTED — <reason> | RUN AGENT:05 | SHOW OUTPUT | HELP');
      console.log('  ─────────────────────────────────────────────────────');
    } else if (stageId === '05-playwright-script-generator' && isReviewRecovery) {
      console.log('\n  ─────────────────────────────────────────────────────');
      console.log('  ✨ Playwright scripts generated / issues resolved!');
      console.log('  👉 Next Step: Run Agent 06 to review the scripts:');
      console.log('     npm run agent:06');
      console.log('  ─────────────────────────────────────────────────────');
      console.log('  Commands: APPROVED | REJECTED — <reason> | SHOW OUTPUT | HELP');
      console.log('  ─────────────────────────────────────────────────────');
    } else {
      console.log('\n  ─────────────────────────────────────────────────────');
      console.log('  Commands: APPROVED | REJECTED — <reason> | SHOW OUTPUT | HELP');
      console.log('  ─────────────────────────────────────────────────────');
    }
  }

  /** @private */
  private _printApprovalConfirmation(stageName: string, nextStageName: string | null, isReviewRecovery: boolean = false) {
    console.log(`
  ✅ APPROVED — "${stageName}" signed off.
  🚀 Initiating: "${nextStageName || 'Pipeline Complete'}"`);
    if (nextStageName === '06-automation-reviewer' || isReviewRecovery) {
      console.log(`  👉 Next Step: Run Agent 06 to review the updated scripts:
     npm run agent:06`);
    }
    console.log('  ────────────────────────────────────────────────────────\n');
  }

  /** @private */
  private _printRejectionConfirmation(stageName: string, reason: string, stageId?: string) {
    console.log(`
  ❌ REJECTED — "${stageName}" will be re-run.
  📝 Reason: ${reason}
  🔄 Stage reset to PENDING. Re-run when ready.`);
    if (stageId === '06-automation-reviewer') {
      console.log(`  👉 Run Agent 05 to resolve the code issues:
     npm run agent:05`);
    }
    console.log('  ────────────────────────────────────────────────────────\n');
  }

  /** @private */
  private _buildResult(status: ApprovalStatus, stageId: string, comment: string): ApprovalResult {
    return {
      status,
      stageId,
      comment,
      timestamp: new Date().toISOString(),
      approved:  status === (APPROVAL_STATUS.APPROVED as ApprovalStatus),
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const approvalGate = new ApprovalGate({
  autoApprove: process.env.FRAMEWORK_APPROVAL_MODE === 'auto',
});

