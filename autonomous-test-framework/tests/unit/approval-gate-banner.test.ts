/**
 * @fileoverview Unit tests for the approval gate's terminal banner guidance.
 */

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

describe('ApprovalGate guidance display', () => {
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
});
