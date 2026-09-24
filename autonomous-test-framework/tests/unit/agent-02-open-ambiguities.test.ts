/**
 * @fileoverview Open Agent 01 ambiguities: Agent 02 links them to the test cases covering the ambiguous criterion, and
 * Agent 03 holds those test cases until the question is answered (real SQLite, isolated test project id).
 */

import { stateDb } from '../../core/state-manager/Database';
import { ClarificationStore } from '../../core/clarifications/ClarificationStore';
import { clarificationRequestFor } from '../../agents/01-requirement-analyzer/ambiguities';
import { normalizeAnalysis } from '../../agents/02-test-case-generator/analysis/normalizeAnalysis';
import { ambiguousCriteria, linkOpenAmbiguities } from '../../agents/02-test-case-generator/analysis/ambiguityLinks';
import { holdUnreadyTestCases } from '../../agents/03-test-case-reviewer/readiness/holdReview';

const PROJECT = `test-unit-open-ambiguities-${Date.now()}`;
afterAll(() => {
  stateDb.prepare('DELETE FROM project_clarifications WHERE project_id LIKE ?').run(`${PROJECT}%`);
});

const analysis = (ambiguities: any[]) => ({
  features: [{
    id: 'F-01',
    name: 'Sign-in',
    riskLevel: 'Medium',
    userStories: [
      {
        id: 'US-01',
        title: 'Sign in',
        acceptanceCriteria: [
          '[@functional] Valid credentials open the dashboard.',
          '[@error-handling] A wrong password shows an error message.',
        ],
        businessRules: [],
      },
      { id: 'US-02', title: 'Sign out', acceptanceCriteria: ['[@functional] Signing out returns to the sign-in page.'], businessRules: [] },
    ],
  }],
  ambiguities,
});

const wrongPassword = {
  id: 'AMB-01', featureId: 'F-01', userStoryId: 'US-01', clarificationId: 'clar-1',
  acceptanceCriterion: '[@error-handling] A wrong password shows an error message',
  question: 'What exact error message is shown for a wrong password?', blockingTestGeneration: false,
};

const tc = (key: string, userStoryId: string, requirementRefs: string[]): any => ({
  key, name: `Case ${key}`, type: 'Negative', featureId: 'F-01', userStoryId, requirementRefs, hash: `h-${key}`, selected: true,
  reviewStatus: 'PASSED', precondition: 'the user is on the sign-in page',
  testSteps: [
    { keyword: 'Given', description: 'the user is on the sign-in page', testData: '', expectedResult: 'The sign-in form is displayed' },
    { keyword: 'When', description: 'the user signs in with a wrong password', testData: '', expectedResult: 'An error message is displayed' },
  ],
});

describe('Agent 02 — links open ambiguities to the test cases they leave undecided', () => {
  it('keeps what the ambiguity is about, and drops resolved ones', () => {
    const { openAmbiguities } = normalizeAnalysis(analysis([wrongPassword, { ...wrongPassword, id: 'AMB-02', resolved: true }]));
    expect(openAmbiguities).toEqual([{
      id: 'AMB-01', featureId: 'F-01', userStoryId: 'US-01', clarificationId: 'clar-1', blocking: false,
      question: wrongPassword.question, criterionText: wrongPassword.acceptanceCriterion,
    }]);
  });

  it('says a test case must be checked by hand when the ambiguity has no clarification to hold it on', () => {
    const normalized = normalizeAnalysis(analysis([{ ...wrongPassword, clarificationId: undefined }]));
    const testCases = [tc('TC-002', 'US-01', ['AC-2'])];
    expect(linkOpenAmbiguities(testCases, normalized.features, normalized.openAmbiguities)[0])
      .toMatch(/TC-002 cover it and must be checked by hand — the analysis records no clarification to hold them on/);
  });

  it('matches the criterion Agent 01 quoted, whatever its prefix or punctuation, and only in its own story', () => {
    const normalized = normalizeAnalysis(analysis([wrongPassword, { ...wrongPassword, id: 'AMB-03', acceptanceCriterion: 'A criterion this story does not have' }]));
    const [feature] = normalized.features;
    const [signIn, signOut] = feature.userStories;
    expect([...ambiguousCriteria(feature, signIn, normalized.openAmbiguities).entries()].map(([ac, open]) => [ac, open.map((a) => a.id)]))
      .toEqual([['AC-2', ['AMB-01']]]);
    expect(ambiguousCriteria(feature, signOut, normalized.openAmbiguities).size).toBe(0);
  });

  it('records the open question on each covering test case and reports it once for the gate', () => {
    const normalized = normalizeAnalysis(analysis([wrongPassword]));
    const testCases = [tc('TC-001', 'US-01', ['AC-1']), tc('TC-002', 'US-01', ['AC-2']), tc('TC-003', 'US-01', ['AC-1', 'AC-2']), tc('TC-004', 'US-02', ['AC-1'])];
    const warnings = linkOpenAmbiguities(testCases, normalized.features, normalized.openAmbiguities);
    expect(testCases.map((t) => t.openQuestions?.map((q: any) => q.clarificationId))).toEqual([undefined, ['clar-1'], ['clar-1'], undefined]);
    expect(warnings).toEqual([`[F-01/US-01] AMB-01 is still open and leaves AC-2 undecided; TC-002, TC-003 cover it and are held at review until it is answered: "${wrongPassword.question}"`]);
  });
});

describe('Agent 03 — holds a test case on an open Agent 01 question it depends on', () => {
  it('holds it while the question is open and releases it once answered', () => {
    const store = new ClarificationStore(`${PROJECT}-hold`, 'run-1');
    const [normalizedAmbiguity] = normalizeAnalysis(analysis([wrongPassword])).openAmbiguities;
    const asked = store.raise(clarificationRequestFor({ ...wrongPassword, category: 'ELEMENT_IDENTIFICATION' }, 'fingerprint-1'));
    const covering = { ...tc('TC-002', 'US-01', ['AC-2']), openQuestions: [{ ambiguityId: normalizedAmbiguity.id, question: normalizedAmbiguity.question, clarificationId: asked.id }] };
    const unrelated = tc('TC-001', 'US-01', ['AC-1']);

    const first = holdUnreadyTestCases([covering, unrelated], store);
    expect(covering.reviewStatus).toBe('HELD');
    expect(covering.openClarifications.map((c: any) => c.id)).toContain(asked.id);
    expect(first.held).toContain('TC-002');
    expect(unrelated.openClarifications?.map((c: any) => c.id) || []).not.toContain(asked.id);

    store.answer(asked.id, 'Email or password is incorrect', 'reviewer');
    holdUnreadyTestCases([covering], store);
    expect((covering.openClarifications || []).map((c: any) => c.id)).not.toContain(asked.id);
  });
});
