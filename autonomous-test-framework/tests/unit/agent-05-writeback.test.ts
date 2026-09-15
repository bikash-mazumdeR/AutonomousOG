/**
 * @fileoverview Unit tests for routing Agent 05 NEEDS_CONTEXT gaps back as clarifications (real SQLite, test project id).
 */

import { stateDb } from '../../core/state-manager/Database';
import { ClarificationStore } from '../../core/clarifications/ClarificationStore';
import { writeBackClarifications } from '../../agents/05-playwright-script-generator/clarifications/writeBack';

describe('Agent 05 clarification write-back', () => {
  const project = `test-unit-writeback-${Date.now()}`;
  const testCase = (tcKey: string) => ({ tcKey, featureId: 'F-01', requirementRefs: ['AC-2'] }) as any;
  const baseUrlGap = { kind: 'AUT_UNREACHABLE', ruleId: 'AUT_BASE_URL', detail: 'Environment variable AUT_BASE_URL is not set.' };

  afterAll(() => {
    stateDb.prepare('DELETE FROM project_clarifications WHERE project_id = ?').run(project);
  });

  it('routes gaps to their owning stage, raises environment issues once and resolves gaps that no longer occur', () => {
    const store = new ClarificationStore(project, 'run-1');
    const results: any[] = [
      {
        tcKey: 'TC-001',
        status: 'NEEDS_CONTEXT',
        missing: [
          { kind: 'LOCATOR', detail: 'Step 2: Element dialog is not present in state start.' },
          { kind: 'DATA', ruleId: 'UNRESOLVED_BINDING', stepIndex: 1, detail: 'Step 1: {{code}} has no resolved value (run or complete Agent 04).' },
          { ...baseUrlGap },
        ],
      },
      { tcKey: 'TC-002', status: 'NEEDS_CONTEXT', missing: [{ ...baseUrlGap }] },
    ];

    expect(writeBackClarifications(store, results, [testCase('TC-001'), testCase('TC-002')])).toEqual({ raised: 2, environment: 1, resolved: 0 });
    expect(results[0].missing.map((gap: any) => gap.owningStage)).toEqual(['03-test-case-reviewer', '04-test-data-generator', 'ENVIRONMENT']);
    expect(results[0].missing.every((gap: any) => gap.clarificationId)).toBe(true);
    expect(store.listOpen({ owningStage: '03-test-case-reviewer' })).toEqual([
      expect.objectContaining({ tcKey: 'TC-001', kind: 'LOCATOR', requirementRef: 'AC-2', context: expect.objectContaining({ stepIndex: 2 }) }),
    ]);
    expect(store.listOpen({ owningStage: 'ENVIRONMENT' })).toHaveLength(1);

    const rerun = writeBackClarifications(store, [{
      tcKey: 'TC-001', status: 'NEEDS_CONTEXT', missing: [{ kind: 'LOCATOR', detail: 'Step 2: Element popup is not present in state start.' }],
    } as any], [testCase('TC-001')]);
    expect(rerun).toEqual({ raised: 1, environment: 0, resolved: 1 });
    expect(store.listOpen({ owningStage: '03-test-case-reviewer' })).toHaveLength(1);
    expect(store.listOpen({ owningStage: '04-test-data-generator' })).toEqual([]);

    expect(writeBackClarifications(store, [{ tcKey: 'TC-001', status: 'GENERATED' } as any], [testCase('TC-001')]).resolved).toBe(1);
    expect(store.listOpen({ tcKeys: ['TC-001'] })).toEqual([]);
  });
});
