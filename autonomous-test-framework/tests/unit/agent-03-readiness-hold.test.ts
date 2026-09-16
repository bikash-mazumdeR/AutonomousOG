/**
 * @fileoverview Unit tests for the Agent 03 automation-readiness hold, answer application and review refresh
 * (real SQLite, isolated test project ids).
 */

import { stateDb } from '../../core/state-manager/Database';
import { ClarificationStore, MAX_ASK_ROUNDS } from '../../core/clarifications/ClarificationStore';
import { applyClarificationAnswers } from '../../agents/03-test-case-reviewer/readiness/applyAnswers';
import { holdUnreadyTestCases } from '../../agents/03-test-case-reviewer/readiness/holdReview';
import { refreshReviewReadiness } from '../../agents/03-test-case-reviewer/readiness/reviewReadiness';
import { applyClarificationDecision, applyReviewOverride } from '../../agents/03-test-case-reviewer/readiness/reviewOverrides';
import { TestCaseReviewerAgent } from '../../agents/03-test-case-reviewer/agent';
import { carryForwardHumanEdits, reapplyHumanStatuses } from '../../agents/03-test-case-reviewer/readiness/humanEdits';

jest.mock('p-retry', () => ({ __esModule: true, default: jest.fn(), AbortError: class extends Error {} }), { virtual: true });
jest.mock('../../core/llm/LLMClient', () => ({ llmClient: { chat: jest.fn(), getStageUsage: jest.fn() } }));

const PROJECT = `test-unit-agent03-${Date.now()}`;
const givenStep = { keyword: 'Given', description: 'the user is on the sign-in page', testData: '', expectedResult: 'The sign-in form is displayed' };

const testCase = (key: string, overrides: Record<string, unknown> = {}): any => ({
  key,
  hash: `hash-${key}`,
  type: 'Negative',
  featureId: 'F-01',
  requirementRefs: ['AC-3'],
  reviewStatus: 'PASSED',
  selected: true,
  precondition: 'the user is on the sign-in page',
  testSteps: [
    { ...givenStep },
    { keyword: 'When', description: 'the user submits the form with an unknown username', testData: '{{unknownUsername}}', expectedResult: 'An error message is displayed' },
  ],
  ...overrides,
});

afterAll(() => {
  stateDb.prepare('DELETE FROM project_clarifications WHERE project_id LIKE ?').run(`${PROJECT}%`);
});

describe('Agent 03 automation-readiness hold', () => {
  it('holds a test case with a specific question and releases the regenerated test case once the answer applies', () => {
    const store = new ClarificationStore(`${PROJECT}-a`);
    const tc = testCase('TC-001');
    expect(holdUnreadyTestCases([tc], store).held).toEqual(['TC-001']);
    expect(tc.reviewStatus).toBe('HELD');
    expect(tc.openClarifications).toEqual([expect.objectContaining({ kind: 'EXPECTED_RESULT', question: expect.stringMatching(/exact text, word for word/) })]);

    store.answer(tc.openClarifications[0].id, 'Username and password do not match', 'qa-lead');
    const regenerated = testCase('TC-001');
    expect(applyClarificationAnswers([regenerated], store)).toHaveLength(1);
    expect(regenerated.testSteps[1].expectedResult).toBe('An error message is displayed with the text "Username and password do not match"');
    expect(holdUnreadyTestCases([regenerated], store).held).toEqual([]);
    expect(regenerated.reviewStatus).toBe('PASSED');
  });

  it('never applies an answer to a different test case that reuses the key', () => {
    const store = new ClarificationStore(`${PROJECT}-b`);
    const tc = testCase('TC-002');
    holdUnreadyTestCases([tc], store);
    store.answer(tc.openClarifications[0].id, 'Invalid credentials', 'qa-lead');
    const different = testCase('TC-002', { hash: 'hash-other-content' });
    expect(applyClarificationAnswers([different], store)).toEqual([]);
    expect(different.testSteps[1].expectedResult).toBe('An error message is displayed');
  });

  it('applies test data, precondition and API details answers', () => {
    const store = new ClarificationStore(`${PROJECT}-c`);
    const tc = testCase('TC-003', {
      type: 'API',
      precondition: '',
      apiDetails: { method: 'FETCH', endpoint: 'https://api.example.test/login' },
      testSteps: [{ keyword: 'When', description: 'the client enters a long username', testData: '', expectedResult: 'The response status is 400' }],
    });
    holdUnreadyTestCases([tc], store);
    const byRule = Object.fromEntries(store.listOpen({ tcKeys: ['TC-003'] }).map((c) => [c.ruleId, c]));
    expect(Object.keys(byRule).sort()).toEqual(['API_DETAILS', 'INPUT_WITHOUT_DATA', 'PRECONDITION_MISSING']);

    store.answer(byRule.INPUT_WITHOUT_DATA.id, '{{longUsername}}', 'qa-lead');
    store.answer(byRule.PRECONDITION_MISSING.id, 'The API is reachable without authentication', 'qa-lead');
    store.answer(byRule.API_DETAILS.id, 'POST /api/login 400', 'qa-lead');
    expect(applyClarificationAnswers([tc], store)).toHaveLength(3);
    expect(tc).toMatchObject({
      precondition: 'The API is reachable without authentication', apiDetails: { method: 'POST', endpoint: '/api/login', expectedStatusCode: 400 },
    });
    expect(tc.testSteps[0].testData).toBe('{{longUsername}}');
    expect(holdUnreadyTestCases([tc], store).held).toEqual([]);
    expect(tc.reviewStatus).toBe('PASSED');
  });

  it('keeps questions later stages raised open until answered, but supersedes rules it re-evaluates itself', () => {
    const store = new ClarificationStore(`${PROJECT}-d`);
    const tc = testCase('TC-004', {
      testSteps: [{ ...givenStep }, { keyword: 'When', description: 'the user signs in', testData: '{{validUsername}}', expectedResult: 'The dialog "Session expired" is displayed' }],
    });
    const fromAgent05 = { sourceStage: '05-playwright-script-generator', tcKey: 'TC-004', stepIndex: 2 };
    store.raise({ ...fromAgent05, owningStage: '03-test-case-reviewer', kind: 'LOCATOR', question: 'How can the dialog be identified?' });
    store.raise({ ...fromAgent05, owningStage: '03-test-case-reviewer', kind: 'EXPECTED_RESULT', ruleId: 'UNQUOTED_TEXT', question: 'What is the exact text?' });
    store.raise({ ...fromAgent05, owningStage: '04-test-data-generator', kind: 'DATA', ruleId: 'UNRESOLVED_BINDING', question: 'Which value?' });

    holdUnreadyTestCases([tc], store);
    expect(tc.reviewStatus).toBe('HELD');
    expect(tc.openClarifications.map((c: any) => c.kind)).toEqual(['LOCATOR']);
    expect(store.listOpen({ owningStage: '04-test-data-generator' })).toHaveLength(1);
  });

  it('marks a test case manual when a human decides so and refreshes the stored review counts', () => {
    const store = new ClarificationStore(`${PROJECT}-e`);
    const storage = testCase('TC-005', {
      testSteps: [{ ...givenStep }, { keyword: 'When', description: 'the user logs in', testData: '{{validUsername}}', expectedResult: 'The session token is stored in Local Storage' }],
    });
    const review: any = { reviewedZephyrExport: { testCases: [storage, testCase('TC-006', { testSteps: [{ ...givenStep }] })] } };

    refreshReviewReadiness(review, store);
    expect(review).toMatchObject({ heldCount: 1, approvedCount: 1, manualCount: 0 });
    expect(review.openClarifications).toEqual([expect.objectContaining({ tcKey: 'TC-005', kind: 'UNASSERTABLE' })]);

    store.markManual(storage.openClarifications[0].id, 'qa-lead');
    refreshReviewReadiness(review, store);
    expect(storage).toMatchObject({ reviewStatus: 'MANUAL', labels: ['Manual'] });
    expect(review).toMatchObject({
      heldCount: 0, manualCount: 1, approvedCount: 1, openClarifications: [],
    });
  });
});

describe('Agent 03 review never fills gaps with defaults', () => {
  const agent: any = new TestCaseReviewerAgent();

  it('leaves missing preconditions, expected results, steps and API/K6 details for a clarification', () => {
    const tc: any = {
      key: 'TC-009',
      name: 'Long enough test case name',
      objective: 'Verifies AC-1: a useful behaviour',
      priority: 'High',
      labels: ['UI'],
      precondition: '',
      testSteps: [
        { description: 'the user opens the page', testData: '', expectedResult: '' },
        { description: 'go', testData: '', expectedResult: '' },
      ],
    };
    agent._reviewCompleteness(tc);
    agent._reviewStepQuality(tc);
    expect(tc.precondition).toBe('');
    expect(tc.testSteps).toEqual([
      { description: 'the user opens the page', testData: '', expectedResult: '' },
      { description: 'go', testData: '', expectedResult: '' },
    ]);

    const api: any = { key: 'TC-010', apiDetails: { method: 'FETCH', endpoint: '/api/login' } };
    agent._reviewAPITC(api);
    expect(api.apiDetails).toEqual({ method: 'FETCH', endpoint: '/api/login' });

    const perf: any = { key: 'TC-011', performanceRef: { scenario: 'burst', targetEndpoint: '/api/search' } };
    agent._reviewPerformanceTC(perf);
    expect(perf.performanceRef.scenario).toBe('burst');
  });
});

describe('Agent 03 human review decisions', () => {
  const review = (...testCases: any[]): any => ({ reviewedZephyrExport: { testCases } });
  const fixedSteps = [{ ...givenStep }, { keyword: 'When', description: 'the user submits the form', testData: '{{unknownUsername}}', expectedResult: 'The error "Unknown user" is displayed' }];

  it('refuses to approve a held test case and changes nothing, but approves once the edit removes the gap', () => {
    const store = new ClarificationStore(`${PROJECT}-f`);
    const stored = review(testCase('TC-020'));
    refreshReviewReadiness(stored, store);

    const refused = applyReviewOverride(stored, { key: 'TC-020', reviewStatus: 'passed' }, store);
    expect(refused).toMatchObject({ outcome: 'HELD', openClarifications: [expect.objectContaining({ tcKey: 'TC-020' })] });
    expect(refused.reviewedOutput).toBeUndefined();
    expect(stored.reviewedZephyrExport.testCases[0].reviewStatus).toBe('HELD');

    const approved = applyReviewOverride(stored, { key: 'TC-020', reviewStatus: 'PASSED', testSteps: fixedSteps }, store);
    expect(approved.outcome).toBe('UPDATED');
    expect(approved.reviewedOutput).toMatchObject({ approvedCount: 1, heldCount: 0, openClarifications: [] });
  });

  it('rejects statuses that cannot be set and leaves no open questions on a rejected test case', () => {
    const store = new ClarificationStore(`${PROJECT}-g`);
    const stored = review(testCase('TC-021'));
    refreshReviewReadiness(stored, store);
    expect(applyReviewOverride(stored, { key: 'TC-021', reviewStatus: 'HELD' }, store).outcome).toBe('INVALID');
    expect(applyReviewOverride(stored, { key: 'TC-404', reviewStatus: 'PASSED' }, store).outcome).toBe('NOT_FOUND');

    const rejected = applyReviewOverride(stored, { key: 'TC-021', reviewStatus: 'REJECTED' }, store);
    expect(rejected.reviewedOutput).toMatchObject({ rejectedCount: 1, heldCount: 0 });
    expect(store.listOpen({ tcKeys: ['TC-021'] })).toEqual([]);
  });

  it('requires a decision instead of another answer once answers keep failing to clear the gap', () => {
    const store = new ClarificationStore(`${PROJECT}-h`);
    const tc = testCase('TC-022');
    holdUnreadyTestCases([tc], store);
    const { id } = tc.openClarifications[0];
    expect(applyClarificationDecision(store, { id: 'missing', answer: 'x' }).outcome).toBe('NOT_FOUND');
    expect(applyClarificationDecision(store, { id, answer: '  ' }).outcome).toBe('INVALID');

    for (let round = 0; round <= MAX_ASK_ROUNDS; round += 1) {
      store.answer(id, 'not applied', 'qa-lead');
      holdUnreadyTestCases([tc], store);
    }
    expect(applyClarificationDecision(store, { id, answer: 'one more try' })).toMatchObject({ outcome: 'INVALID' });
    expect(applyClarificationDecision(store, { id, action: 'mark_manual' })).toMatchObject({ outcome: 'UPDATED', clarification: { status: 'MANUAL' } });
    holdUnreadyTestCases([tc], store);
    expect(tc.reviewStatus).toBe('MANUAL');
  });
});

describe('Agent 03 held test cases can be understood, fixed and survive a re-run', () => {
  const review = (...testCases: any[]): any => ({ reviewedZephyrExport: { testCases } });
  const fixedSteps = [{ ...givenStep }, { keyword: 'When', description: 'the user submits the form', testData: '{{unknownUsername}}', expectedResult: 'The error "Unknown user" is displayed' }];

  it('explains each hold with the step, the exact line and the finding', () => {
    const store = new ClarificationStore(`${PROJECT}-i`);
    const tc = testCase('TC-030');
    holdUnreadyTestCases([tc], store);
    expect(tc.openClarifications).toEqual([expect.objectContaining({
      stepIndex: 2, subject: 'An error message is displayed', ruleId: expect.any(String), detail: expect.any(String), requiresDecision: false,
    })]);
  });

  it('records human edits and a changed status on the reviewed test case', () => {
    const store = new ClarificationStore(`${PROJECT}-j`);
    const stored = review(testCase('TC-031'));
    refreshReviewReadiness(stored, store);
    const fixed = applyReviewOverride(stored, { key: 'TC-031', testSteps: fixedSteps, labels: ['UI'], decidedBy: 'qa-lead' }, store);
    expect(fixed.outcome).toBe('UPDATED');
    expect(fixed.testCase).toMatchObject({
      reviewStatus: 'PASSED', labels: ['UI'], humanEdit: { baseHash: 'hash-TC-031', fields: ['testSteps', 'labels'], editedBy: 'qa-lead' },
    });
    expect(fixed.testCase.humanEdit.reviewStatus).toBeUndefined();

    const rejected = applyReviewOverride(fixed.reviewedOutput, { key: 'TC-031', reviewStatus: 'REJECTED' }, store);
    expect(rejected.testCase.humanEdit).toMatchObject({ fields: ['testSteps', 'labels'], reviewStatus: 'REJECTED' });
  });

  it('re-runs the review on the fixed steps instead of holding the test case again', () => {
    const store = new ClarificationStore(`${PROJECT}-k`);
    const stored = review(testCase('TC-032'));
    refreshReviewReadiness(stored, store);
    const { reviewedOutput } = applyReviewOverride(stored, { key: 'TC-032', testSteps: fixedSteps }, store);

    const fromAgent02 = [testCase('TC-032'), testCase('TC-033', { testSteps: [{ ...givenStep }] })];
    const { testCases, carried, discarded } = carryForwardHumanEdits(fromAgent02, reviewedOutput);
    expect(carried).toEqual(['TC-032']);
    expect(discarded).toEqual([]);
    expect(testCases[0].testSteps).toEqual(fixedSteps);
    expect(fromAgent02[0].testSteps[1].expectedResult).toBe('An error message is displayed');
    expect(holdUnreadyTestCases(testCases, store).held).toEqual([]);
    expect(testCases[0].reviewStatus).toBe('PASSED');
  });

  it('drops edits made on content Agent 02 has since regenerated, and restores explicit human statuses', () => {
    const previous = review({ ...testCase('TC-034'), testSteps: fixedSteps, humanEdit: { baseHash: 'hash-TC-034', fields: ['testSteps'], reviewStatus: 'FLAGGED' } });
    const regenerated = carryForwardHumanEdits([testCase('TC-034', { hash: 'hash-new' })], previous);
    expect(regenerated).toMatchObject({ carried: [], discarded: ['TC-034'] });
    expect(regenerated.testCases[0].humanEdit).toBeUndefined();

    const same = carryForwardHumanEdits([testCase('TC-034')], previous).testCases;
    same[0].reviewStatus = 'PASSED';
    expect(reapplyHumanStatuses(same)).toEqual(['TC-034']);
    expect(same[0].reviewStatus).toBe('FLAGGED');
  });
});
