/**
 * @fileoverview Unit tests for the Agent 02 eval suite's scorers (deterministic; no LLM).
 */

import {
  EvalCase, Thresholds, isGrounded, knownPlaceholders, scoreCase, summarize, titleOverlap,
} from '../../evals/agent02/scoring';

const bars: Thresholds = {
  unresolvedErrors: 0, criteriaCoverage: 1, placeholderRecall: 1, secretsLeaked: 0, ungroundedClaims: 0, forbiddenHits: 0,
  excludedTypeLeaks: 0, duplicates: 0, minByTypeMissed: 0, stability: 0.6,
};

const analysis = {
  features: [{
    id: 'F-01',
    userStories: [{
      id: 'US-01',
      acceptanceCriteria: ["[@error-handling] A wrong password shows 'Email or password is incorrect'.", '[@functional] The password is 8 to 64 characters.'],
      testDataValues: [{ name: 'invalidPassword', value: 'wrong-pass', sourceRef: 'AC-1', sensitive: false }],
    }],
  }],
};

const evalCase: EvalCase = {
  name: 'sample',
  description: '',
  analysis: 'analysis.json',
  excludedTypes: ['edge'],
  expect: { mustUsePlaceholders: ['validEmail', 'invalidPassword'], forbidden: ['lockout'], minByType: { Negative: 1 } },
};

const tc = (key: string, type: string, name: string, steps: string[], hash = key) => ({
  key, type, name, hash, precondition: '', testSteps: steps.map((description) => ({ description, testData: '', expectedResult: '' })),
});

const result = (testCases: any[], overrides: Record<string, unknown> = {}) => ({
  testCases, warnings: [], coverage: { acceptanceCriteria: { covered: 2, total: 2 } }, attempts: [1], ...overrides,
});

const environment = { credentialNames: ['validEmail'], secretValues: ['Sample#Pass9'] };

describe('Agent 02 eval scoring', () => {
  it('knows the placeholders the analysis and credentials name', () => {
    expect([...knownPlaceholders(analysis, ['validEmail'])]).toEqual(['validEmail', 'invalidPassword']);
  });

  it('grounds a boundary one away from a stated number, but not an invented number or wording', () => {
    const source = "a wrong password shows 'email or password is incorrect'. the password is 8 to 64 characters.";
    const numbers = [8, 64];
    expect(isGrounded('65', source, numbers)).toBe(true);
    expect(isGrounded('7', source, numbers)).toBe(true);
    expect(isGrounded('128', source, numbers)).toBe(false);
    expect(isGrounded('Email or password is incorrect', source, numbers)).toBe(true);
    expect(isGrounded('Too many attempts', source, numbers)).toBe(false);
  });

  it('scores a clean generation as clean', () => {
    const score = scoreCase(evalCase, result([
      tc('TC-001', 'Positive', 'Sign in with valid credentials', ['the user signs in with {{validEmail}}']),
      tc('TC-002', 'Negative', 'Wrong password is rejected', ['the user enters {{invalidPassword}}', "the error 'Email or password is incorrect' is shown"]),
      tc('TC-003', 'Negative', 'A 65-character password is rejected', ['the user enters a password of 65 characters']),
    ]), analysis, environment);
    expect(score.placeholders).toEqual({ used: ['invalidPassword', 'validEmail'], reused: ['invalidPassword', 'validEmail'], newNames: [], missing: [], required: 2 });
    expect([score.ungrounded, score.forbiddenHits, score.secretsLeaked, score.excludedTypeLeaks, score.duplicates, score.minByTypeMissed])
      .toEqual([[], [], [], [], [], []]);
    expect(summarize([score], bars).passed).toBe(true);
  });

  it('catches every kind of failure the suite measures', () => {
    const score = scoreCase(evalCase, result([
      tc('TC-001', 'Positive', 'Sign in with valid credentials', ['the user signs in with password Sample#Pass9 and {{newPassword}}']),
      tc('TC-002', 'Edge', 'Account lockout after failures', ["the error 'Too many attempts' is shown"]),
      tc('TC-003', 'Positive', 'Sign in with valid credentials', ['the user signs in'], 'TC-001'),
    ], { warnings: ['[F-01/US-01] Unresolved after 3 attempt(s): AC-2 is not covered'], coverage: { acceptanceCriteria: { covered: 1, total: 2 } } }), analysis, environment);
    expect(score.unresolved).toHaveLength(1);
    expect(score.placeholders.missing).toEqual(['validEmail', 'invalidPassword']);
    expect(score.placeholders.newNames).toEqual(['newPassword']);
    expect(score.secretsLeaked).toEqual(['TC-001']);
    expect(score.ungrounded).toEqual(['TC-002 states "Too many attempts", which the analysis does not contain']);
    expect(score.forbiddenHits).toEqual(['TC-002 mentions "lockout"']);
    expect(score.excludedTypeLeaks).toEqual(['TC-002 is Edge']);
    expect(score.duplicates).toEqual(['TC-003 repeats the title of TC-001', 'TC-003 repeats the steps of TC-001']);
    expect(score.minByTypeMissed).toEqual(['0 Negative test case(s), expected at least 1']);

    const { metrics, passed } = summarize([score], bars);
    expect(passed).toBe(false);
    expect(metrics.find((m) => m.name === 'Acceptance criteria covered')).toMatchObject({ value: 0.5, pass: false });
    expect(metrics.find((m) => m.name === 'Required placeholders used')).toMatchObject({ value: 0, pass: false });
  });

  it('counts placeholder recall as met when no case requires any, and fails a suite with an errored case', () => {
    const none = scoreCase({ ...evalCase, expect: {} }, result([tc('TC-001', 'Positive', 'Sign in works as documented', ['ok'])]), analysis, environment);
    expect(summarize([none], bars).metrics.find((m) => m.name === 'Required placeholders used')).toMatchObject({ value: 1, pass: true });
    expect(summarize([none, { ...none, name: 'broken', error: 'timeout' }], bars).passed).toBe(false);
  });

  it('measures title overlap between runs', () => {
    expect(titleOverlap([{ name: 'A b' }, { name: 'C' }], [{ name: 'a B.' }, { name: 'c' }])).toBe(1);
    expect(titleOverlap([{ name: 'a' }, { name: 'b' }], [{ name: 'a' }, { name: 'c' }])).toBeCloseTo(1 / 3);
  });
});
