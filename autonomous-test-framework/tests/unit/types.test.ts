/**
 * @fileoverview Unit tests for the core TypeScript type definitions.
 * Validates type shapes and enum values to prevent silent regressions.
 */

import {
  StageStatus,
  ApprovalStatus,
  AgentResult,
  StageState,
  PipelineArtifacts,
  PipelineState,
} from '../../core/types';

jest.mock('p-retry', () => ({
  __esModule: true,
  default: jest.fn(),
  AbortError: class extends Error {},
}), { virtual: true });

jest.mock('../../core/llm/LLMClient', () => ({
  llmClient: {
    getStageUsage: jest.fn().mockReturnValue({
      promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0,
    }),
  },
}));

describe('Core Types', () => {

  // ── StageStatus ───────────────────────────────────────────────────────────

  describe('StageStatus', () => {
    it('should accept all valid stage status values', () => {
      const validStatuses: StageStatus[] = [
        'PENDING', 'RUNNING', 'COMPLETED', 'AWAITING',
        'APPROVED', 'REJECTED', 'FAILED', 'SKIPPED',
      ];
      expect(validStatuses).toHaveLength(8);
    });
  });

  // ── ApprovalStatus ────────────────────────────────────────────────────────

  describe('ApprovalStatus', () => {
    it('should accept all valid approval values', () => {
      const validApprovals: ApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
      expect(validApprovals).toHaveLength(3);
    });
  });

  // ── AgentResult ───────────────────────────────────────────────────────────

  describe('AgentResult', () => {
    it('should construct a valid agent result object', () => {
      const result: AgentResult = {
        agentId: '01-requirement-analyzer',
        stageNumber: '01',
        stageName: 'Requirement Deep Analyzer',
        status: 'COMPLETED',
        output: { totalFeatures: 5 },
        warnings: [],
        timestamp: new Date().toISOString(),
        durationMs: 1234,
        approvalStatus: 'PENDING',
      };

      expect(result.agentId).toBe('01-requirement-analyzer');
      expect(result.status).toBe('COMPLETED');
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.warnings).toEqual([]);
    });

    it('should allow optional clarifications and memoryUpdate', () => {
      const result: AgentResult = {
        agentId: '02-test-gen',
        stageNumber: '02',
        stageName: 'Test Case Generator',
        status: 'COMPLETED',
        output: {},
        clarifications: [{ question: 'What env?' } as any],
        warnings: ['Low TC count'],
        memoryUpdate: { newRule: 'Add more edge cases' },
        timestamp: new Date().toISOString(),
        durationMs: 500,
        approvalStatus: 'APPROVED',
        approvalComment: 'Looks good',
      };

      expect(result.clarifications).toHaveLength(1);
      expect(result.memoryUpdate).toBeDefined();
      expect(result.approvalComment).toBe('Looks good');
    });
  });

  // ── StageState ────────────────────────────────────────────────────────────

  describe('StageState', () => {
    it('should construct a valid stage state', () => {
      const state: StageState = {
        status: 'RUNNING',
        output: null,
        approval: 'PENDING',
        attempts: 1,
        startedAt: new Date().toISOString(),
      };

      expect(state.status).toBe('RUNNING');
      expect(state.attempts).toBe(1);
      expect(state.completedAt).toBeUndefined();
    });

    it('should allow rejection reason and error', () => {
      const state: StageState = {
        status: 'REJECTED',
        output: {},
        approval: 'REJECTED',
        attempts: 2,
        rejectionReason: 'Insufficient coverage',
        error: { message: 'review failed', code: 'REVIEW_FAILED' } as any,
      };

      expect(state.rejectionReason).toBe('Insufficient coverage');
      expect(state.error).toBeDefined();
    });
  });

  // ── PipelineArtifacts ─────────────────────────────────────────────────────

  describe('PipelineArtifacts', () => {
    it('should define all 11 artifact slots', () => {
      const artifacts: PipelineArtifacts = {
        requirements: {} as any,
        testCases: [] as any,
        reviewedTestCases: [] as any,
        testData: {} as any,
        playwrightScripts: {} as any,
        reviewedScripts: {} as any,
        executionResults: {} as any,
        bugReports: {} as any,
        publishedReports: {} as any,
        healingPatches: [] as any,
        retestResults: {} as any,
      };

      expect(Object.keys(artifacts)).toHaveLength(11);
    });
  });

  // ── PipelineState ─────────────────────────────────────────────────────────

  describe('PipelineState', () => {
    it('should construct a valid pipeline state', () => {
      const state: PipelineState = {
        version: '1.0.0',
        projectId: 'aria-test',
        runId: 'run-001',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentStage: '01-requirement-analyzer',
        globalStatus: 'RUNNING',
        stages: {},
        pipeline: {},
        clarifications: [],
        errors: [],
        warnings: [],
      };

      expect(state.version).toBe('1.0.0');
      expect(state.globalStatus).toBe('RUNNING');
      expect(state.pipeline).toEqual({});
    });
  });

  // ── ApprovalGate Guidance Tests ──────────────────────────────────────────

  describe('ApprovalGate Guidance Display', () => {
    it('should format banner with Agent 05 prompt on Review REJECT', () => {
      const { approvalGate } = require('../../core/approval-gate/ApprovalGate');
      const spy = jest.spyOn(console, 'log').mockImplementation();

      (approvalGate as any)._printGateBanner(
        '06-automation-reviewer',
        'Automation Code Reviewer',
        '07-test-runner',
        {
          'Review Decision': 'REJECT',
          'Overall Grade': 'A (96/100)',
          'Total Files Reviewed': 6,
          'Passed': 5,
          'Blocked': 1,
        },
        ['[BLOCKER][F-01.spec.js] Syntax Error: Unexpected end of input'],
        [],
        { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        true,
        false
      );

      const logged = spy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(logged).toContain('🛑 Review Decision: REJECT — Code issues or blockers detected!');
      expect(logged).toContain('npm run agent:05');
      expect(logged).toContain('RUN AGENT:05');

      spy.mockRestore();
    });

    it('should format normal commands when Review Decision is APPROVE', () => {
      const { approvalGate } = require('../../core/approval-gate/ApprovalGate');
      const spy = jest.spyOn(console, 'log').mockImplementation();

      (approvalGate as any)._printGateBanner(
        '06-automation-reviewer',
        'Automation Code Reviewer',
        '07-test-runner',
        {
          'Review Decision': 'APPROVE',
          'Overall Grade': 'A (100/100)',
        },
        [],
        [],
        { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        false,
        false
      );

      const logged = spy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(logged).not.toContain('🛑 Review Decision: REJECT');
      expect(logged).not.toContain('npm run agent:05');
      expect(logged).toContain('Commands: APPROVED | REJECTED — <reason> | SHOW OUTPUT | HELP');

      spy.mockRestore();
    });

    it('should format Agent 06 review prompt on Agent 05 recovery', () => {
      const { approvalGate } = require('../../core/approval-gate/ApprovalGate');
      const spy = jest.spyOn(console, 'log').mockImplementation();

      (approvalGate as any)._printGateBanner(
        '05-playwright-script-generator',
        'Playwright Script Generator',
        '06-automation-reviewer',
        {
          'Total Files Generated': 6,
        },
        [],
        [],
        { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCost: 0.0001 },
        false,
        true
      );

      const logged = spy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(logged).toContain('✨ Playwright scripts generated / issues resolved!');
      expect(logged).toContain('npm run agent:06');

      spy.mockRestore();
    });

    it('should format banner with RUN AGENT:05 option on Review REJECT', () => {
      const { approvalGate } = require('../../core/approval-gate/ApprovalGate');
      const spy = jest.spyOn(console, 'log').mockImplementation();

      (approvalGate as any)._printGateBanner(
        '06-automation-reviewer',
        'Automation Code Reviewer',
        '07-test-runner',
        { 'Review Decision': 'REJECT' },
        ['[BLOCKER] Issue found'],
        [],
        undefined,
        true,
        false
      );

      const logged = spy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(logged).toContain('RUN AGENT:05');
      expect(logged).toContain('npm run agent:05');
      spy.mockRestore();
    });
  });
});


