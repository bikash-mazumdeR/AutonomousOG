/**
 * @fileoverview A stage whose own review decided REJECT is never approved unseen: auto-approve mode rejects it (and the
 * pipeline halts), and a manual gate says plainly that approving overrides the review — with the stage's own guidance,
 * not the automation code review's "run Agent 05".
 */

jest.mock('p-retry', () => ({ __esModule: true, default: jest.fn(), AbortError: class extends Error {} }), { virtual: true });
jest.mock('../../core/llm/LLMClient', () => ({
  llmClient: {
    chat: jest.fn(), getCallTraces: jest.fn(() => []),
    getStageUsage: jest.fn().mockReturnValue({ promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }),
  },
}));
jest.mock('../../core/project-memory/MemoryEngine', () => ({ memoryEngine: { recordApprovalFeedback: jest.fn() } }));

import { ApprovalGate } from '../../core/approval-gate/ApprovalGate';
import { stateManager } from '../../core/state-manager/StateManager';
import { memoryEngine } from '../../core/project-memory/MemoryEngine';
import { TestCaseReviewerAgent } from '../../agents/03-test-case-reviewer/agent';

const request = (blockers?: string[]) => ({
  stageId: '03-test-case-reviewer', stageName: 'Test Case Reviewer', nextStageName: '04-test-data-generator',
  summary: { 'Review Decision': blockers?.length ? 'REJECT' : 'APPROVE' }, blockers,
});

describe('Approval gate — a stage review that decided REJECT', () => {
  let rejected: jest.SpyInstance;
  let approved: jest.SpyInstance;
  beforeEach(() => {
    rejected = jest.spyOn(stateManager, 'markStageRejected').mockResolvedValue(undefined);
    approved = jest.spyOn(stateManager, 'markStageApproved').mockResolvedValue(undefined);
    (memoryEngine.recordApprovalFeedback as jest.Mock).mockClear();
  });
  afterEach(() => jest.restoreAllMocks());

  it('is rejected, not approved, in auto-approve mode — with its reasons', async () => {
    const gate = new ApprovalGate({ autoApprove: true });
    const reasons = Array.from({ length: 7 }, (_, i) => `[TC-00${i + 1}] Only 1 step(s) found. Minimum is 2.`);
    const result = await gate.waitForApproval(request(reasons));
    expect(result).toMatchObject({ status: 'REJECTED', approved: false });
    expect(result.comment).toMatch(/^AUTO-REJECTED \(CI mode\): the stage's own review decided it must not proceed — \[TC-001\]/);
    expect(result.comment).toMatch(/\(and 2 more\)$/);
    // The orchestrator re-routes an Agent 06 rejection that mentions Agent 05; this one must simply halt.
    expect(result.comment).not.toMatch(/agent[:\s]*0?5/i);
    expect(rejected).toHaveBeenCalledWith('03-test-case-reviewer', result.comment);
    expect(approved).not.toHaveBeenCalled();
    expect(memoryEngine.recordApprovalFeedback).toHaveBeenCalledWith('03-test-case-reviewer', 'REJECTED', result.comment);
  });

  it('is still approved automatically when the review found nothing blocking', async () => {
    const result = await new ApprovalGate({ autoApprove: true }).waitForApproval(request([]));
    expect(result).toMatchObject({ status: 'APPROVED', approved: true });
    expect(rejected).not.toHaveBeenCalled();
  });

  it('says at a manual gate that approving overrides the review, without Agent 06 guidance', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    (new ApprovalGate() as any)._printGateBanner(
      '03-test-case-reviewer', 'Test Case Reviewer', '04-test-data-generator', { 'Review Decision': 'REJECT' }, [], [],
      { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }, false, false, ['[TC-001] Only 1 step(s) found. Minimum is 2.'],
    );
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain("🛑 This stage's own review decided REJECT (1 reason(s)):");
    expect(logged).toContain('[TC-001] Only 1 step(s) found. Minimum is 2.');
    expect(logged).toContain('APPROVED overrides the review; REJECTED — <reason> stops the pipeline.');
    expect(logged).not.toContain('npm run agent:05');
  });
});

describe('Agent 03 — its reasons for REJECT', () => {
  const agent: any = new TestCaseReviewerAgent();

  it('gives a failing grade or an empty suite, never a single rejected test case, and nothing unless it decided REJECT', () => {
    const suite = (...statuses: string[]) => ({ testCases: statuses.map((reviewStatus, i) => ({ key: `TC-00${i + 1}`, reviewStatus })) });
    expect(agent._rejectReasons({ reviewDecision: 'REJECT', qualityScore: { grade: 'D', overall: 52 }, reviewedZephyrExport: suite('PASSED', 'REJECTED') }))
      .toEqual(['Quality grade D (52/100) is below the C needed to proceed']);
    expect(agent._rejectReasons({
      reviewDecision: 'REJECT', qualityScore: { grade: 'B', overall: 80 }, reviewedZephyrExport: suite('REJECTED', 'MANUAL', 'EXCLUDED'), rejectedCount: 1, manualCount: 1,
    })).toEqual(['No test case is left to continue: 1 rejected, 1 kept manual']);
    expect(agent._rejectReasons({ reviewDecision: 'APPROVE_WITH_WARNINGS', qualityScore: { grade: 'C' } })).toEqual([]);
  });

  it('rejects the suite only for a failing grade or when nothing is left, not for one blocked test case', () => {
    const blocker = [{ severity: 'BLOCKER' }];
    const tcs = (...statuses: string[]) => statuses.map((reviewStatus) => ({ reviewStatus }));
    expect(agent._makeReviewDecision({ grade: 'A' }, tcs('PASSED', 'REJECTED'), blocker)).toBe('APPROVE_WITH_WARNINGS');
    expect(agent._makeReviewDecision({ grade: 'A' }, tcs('HELD', 'REJECTED'), blocker)).toBe('APPROVE_WITH_WARNINGS');
    expect(agent._makeReviewDecision({ grade: 'A' }, tcs('REJECTED', 'MANUAL'), blocker)).toBe('REJECT');
    expect(agent._makeReviewDecision({ grade: 'F' }, tcs('PASSED'), [])).toBe('REJECT');
    expect(agent._makeReviewDecision({ grade: 'C' }, tcs('PASSED'), [])).toBe('APPROVE_WITH_WARNINGS');
    expect(agent._makeReviewDecision({ grade: 'A' }, tcs('PASSED'), [])).toBe('APPROVE');
  });
});
