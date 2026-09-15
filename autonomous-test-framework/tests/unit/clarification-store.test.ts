/**
 * @fileoverview Unit tests for the project-scoped clarification store (real SQLite, isolated test project ids).
 */

import { stateDb } from '../../core/state-manager/Database';
import {
  CLARIFICATION_STATUS, ClarificationRequest, ClarificationStore, MAX_ASK_ROUNDS,
} from '../../core/clarifications/ClarificationStore';

describe('ClarificationStore', () => {
  const project = `test-unit-clarifications-${Date.now()}`;
  const otherProject = `${project}-other`;
  const request: ClarificationRequest = {
    sourceStage: '05-playwright-script-generator',
    owningStage: '03-test-case-reviewer',
    kind: 'LOCATOR',
    tcKey: 'TC-007',
    stepIndex: 2,
    question: 'How can the dialog be identified?',
  };

  afterAll(() => {
    stateDb.prepare('DELETE FROM project_clarifications WHERE project_id IN (?, ?)').run(project, otherProject);
  });

  it('deduplicates a repeated question within a project and isolates projects', () => {
    const store = new ClarificationStore(project, 'run-1');
    const first = store.raise(request);
    const again = store.raise({ ...request, question: 'How can the dialog be identified on the page?' });
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ status: 'OPEN', askRounds: 1, question: 'How can the dialog be identified on the page?', context: { stepIndex: 2 } });
    expect(new ClarificationStore(otherProject).listOpen()).toEqual([]);
  });

  it('shares answers with the owning stage and requirement-level answers with every stage', () => {
    const store = new ClarificationStore(project);
    const owned = store.raise({ ...request, tcKey: 'TC-010' });
    const requirement = store.raise({
      ...request, owningStage: '01-requirement-analyzer', kind: 'SLA', ruleId: 'K6_SLA', tcKey: 'TC-011',
    });
    store.answer(owned.id, 'The dialog shows the text "Compromised"', 'qa-lead');
    store.answer(requirement.id, 'p95 under 500 ms', 'qa-lead');
    expect(store.listResolvedFor('03-test-case-reviewer').map((c) => c.tcKey)).toEqual(expect.arrayContaining(['TC-010', 'TC-011']));
    expect(store.listResolvedFor('04-test-data-generator').map((c) => c.tcKey)).toEqual(['TC-011']);
  });

  it('reopens an answered question whose gap persists and asks for a decision after the maximum rounds', () => {
    const store = new ClarificationStore(project);
    const persisting = { ...request, tcKey: 'TC-020' };
    let record = store.raise(persisting);
    for (let round = 1; round <= MAX_ASK_ROUNDS; round += 1) {
      store.answer(record.id, `answer ${round}`, 'qa-lead');
      record = store.raise(persisting);
    }
    expect(record).toMatchObject({ status: CLARIFICATION_STATUS.OPEN, askRounds: MAX_ASK_ROUNDS + 1 });
    expect(record.context).toMatchObject({ previousAnswer: `answer ${MAX_ASK_ROUNDS}`, requiresDecision: true });
  });

  it('never reopens a question a human marked manual or dismissed', () => {
    const store = new ClarificationStore(project);
    const manual = store.raise({ ...request, tcKey: 'TC-030' });
    store.markManual(manual.id, 'qa-lead');
    expect(store.raise({ ...request, tcKey: 'TC-030' }).status).toBe(CLARIFICATION_STATUS.MANUAL);
    const dismissed = store.raise({ ...request, tcKey: 'TC-031' });
    store.dismiss(dismissed.id, 'Covered by TC-032', 'qa-lead');
    expect(store.raise({ ...request, tcKey: 'TC-031' }).status).toBe(CLARIFICATION_STATUS.DISMISSED);
  });

  it('resolves open questions whose rule no longer fires and marks questions about changed content stale', () => {
    const store = new ClarificationStore(project);
    const kept = store.raise({ ...request, tcKey: 'TC-040', stepIndex: 1 });
    const gone = store.raise({ ...request, tcKey: 'TC-040', stepIndex: 3 });
    expect(store.resolveMissing({ sourceStage: request.sourceStage, tcKey: 'TC-040', firingKeys: [kept.dedupeKey] })).toBe(1);
    expect(store.get(gone.id)?.status).toBe(CLARIFICATION_STATUS.RESOLVED_BY_CHANGE);
    expect(store.get(kept.id)?.status).toBe(CLARIFICATION_STATUS.OPEN);
    const outdated = store.raise({
      ...request, owningStage: '01-requirement-analyzer', tcKey: 'TC-050', subjectHash: 'fingerprint-old',
    });
    store.markStale({ owningStage: '01-requirement-analyzer', subjectHash: 'fingerprint-new' });
    expect(store.get(outdated.id)?.status).toBe(CLARIFICATION_STATUS.STALE);
  });
});
