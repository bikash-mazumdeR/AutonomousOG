/**
 * @fileoverview Unit tests for the Agent 04 value policy and its clarifications (real SQLite, isolated test project ids).
 */

import { stateDb } from '../../core/state-manager/Database';
import { ClarificationStore } from '../../core/clarifications/ClarificationStore';
import { PolicyContext, resolvePlaceholder } from '../../agents/04-test-data-generator/valuePolicy';
import { collectRequirementValues, indexAnswers, literalRequirementValues } from '../../agents/04-test-data-generator/valueSources';
import { answerDataClarifications, syncDataClarifications } from '../../agents/04-test-data-generator/dataClarifications';

const PROJECT = `test-unit-agent04-${Date.now()}`;
const tc = { key: 'TC-001', featureId: 'F-01', userStoryId: 'US-01', name: 'Sign in', objective: 'Verifies AC-1' };

const context = (overrides: Partial<PolicyContext> = {}): PolicyContext => ({
  tc, seed: 'ab12cd34', answers: new Map(), overrides: new Map(), requirementValues: [], endpoints: [], profile: null, memory: {}, env: {}, ...overrides,
});

const answered = (placeholder: string, answer: string): any => ({
  id: `clar_${placeholder}_${answer}`, answer, ruleId: 'UNRESOLVED_BINDING', context: { placeholder }, answeredAt: '2026-01-01T00:00:00.000Z',
});

const storyValues = (testDataValues: any[]) => collectRequirementValues({ features: [{ id: 'F-01', userStories: [{ id: 'US-01', testDataValues }] }] });

afterAll(() => {
  stateDb.prepare('DELETE FROM project_clarifications WHERE project_id LIKE ?').run(`${PROJECT}%`);
});

describe('Agent 04 value policy', () => {
  it('generates only synthetic inputs and leaves application values unresolved, even when memory has one', () => {
    expect(resolvePlaceholder('invalidEmail', context()).entry).toMatchObject({ value: 'notanemail.nodomain', source: 'generated' });
    expect(resolvePlaceholder('wrongPassword', context()).entry).toMatchObject({ source: 'generated', sensitive: false });
    expect(resolvePlaceholder('productName', context({ memory: { productName: 'remembered' } })))
      .toMatchObject({ valueClass: 'GROUNDED', entry: null, reason: expect.stringContaining('{{productName}}') });
    expect(resolvePlaceholder('usernameMaxLength', context()).entry).toBeNull();
    expect(resolvePlaceholder('userRole', context()).entry).toBeNull();
  });

  it('prefers a human answer over the requirement', () => {
    const requirementValues = storyValues([{ name: 'productName', value: 'Blue Mug', sourceRef: 'AC-2' }]);
    expect(resolvePlaceholder('productName', context({ requirementValues })).entry).toMatchObject({ value: 'Blue Mug', source: 'requirement' });
    const answers = indexAnswers([answered('productName', 'Red Mug')]);
    expect(resolvePlaceholder('productName', context({ requirementValues, answers })).entry).toMatchObject({ value: 'Red Mug', source: 'clarification' });
  });

  it('asks instead of picking when the requirement states conflicting values', () => {
    const requirementValues = collectRequirementValues({ features: [
      { id: 'F-02', userStories: [{ id: 'US-02', testDataValues: [{ name: 'productName', value: 'Blue Mug' }] }] },
      { id: 'F-03', userStories: [{ id: 'US-03', testDataValues: [{ name: 'productName', value: 'Red Mug' }] }] },
    ] });
    expect(resolvePlaceholder('productName', context({ requirementValues })).entry).toBeNull();
  });

  it('never stores a credential stated in the requirement: it becomes an environment variable reference', () => {
    const requirementValues = storyValues([{ name: 'validUsername', value: 'acme_user', sourceRef: 'AC-1' }, { name: 'validPassword', sensitive: true, sourceRef: 'AC-1' }]);
    const username = resolvePlaceholder('validUsername', context({ requirementValues }));
    expect(username.entry).toMatchObject({ source: 'runtime', envVar: 'ARIA_VALID_USERNAME', sensitive: true });
    expect(JSON.stringify(username)).not.toContain('acme_user');
    expect(username.envIssue).toEqual({ name: 'validUsername', envVar: 'ARIA_VALID_USERNAME' });

    const profile = { credentialEnvVars: { validPassword: 'APP_PASSWORD' }, secretsEnvVars: [] };
    const password = resolvePlaceholder('validPassword', context({ requirementValues, profile }));
    expect(password.entry).toMatchObject({ envVar: 'APP_PASSWORD' });
    expect(password.envIssue).toBeUndefined();
    expect(resolvePlaceholder('incorrectCaseUsername', context({ requirementValues })).entry).toMatchObject({ value: 'Acme_User', source: 'generated' });
  });

  it('binds a placeholder the AUT profile declares an environment variable for, even when the requirement states its value', () => {
    // A login email classifies as a generatable synthetic input, and requirements state it as a non-sensitive value;
    // the project's declaration is what decides that it is an account credential read from the environment.
    const requirementValues = storyValues([{ name: 'validEmail', value: 'account@example.test', sourceRef: 'AC-8', sensitive: false }]);
    expect(resolvePlaceholder('validEmail', context({ requirementValues })).entry)
      .toMatchObject({ value: 'account@example.test', source: 'requirement' });

    const profile = { credentialEnvVars: { validEmail: 'APP_EMAIL' }, secretsEnvVars: [] };
    const declared = resolvePlaceholder('validEmail', context({ requirementValues, profile }));
    expect(declared.entry).toMatchObject({ source: 'runtime', envVar: 'APP_EMAIL' });
    expect(JSON.stringify(declared)).not.toContain('account@example.test');
    expect(declared.envIssue).toBeUndefined();

    // The flat fixture is a second write path: a value bound to a variable must not also be copied there.
    expect(literalRequirementValues(requirementValues)).toEqual({ validEmail: 'account@example.test' });
    expect(literalRequirementValues(requirementValues, false, Object.keys(profile.credentialEnvVars))).toEqual({});
    expect(literalRequirementValues(requirementValues, true, Object.keys(profile.credentialEnvVars)))
      .toEqual({ validEmail: 'account@example.test' });
  });

  it('stores credentials as fixture values when the AUT profile says so, but still never generates them', () => {
    const profile = { credentialEnvVars: {}, secretsEnvVars: [], credentialsInFixture: true };
    const requirementValues = storyValues([{ name: 'validUsername', value: 'acme_user' }, { name: 'validPassword', sensitive: true }]);
    expect(resolvePlaceholder('validUsername', context({ requirementValues, profile })))
      .toMatchObject({ valueClass: 'GROUNDED', entry: { value: 'acme_user', source: 'requirement', sensitive: false } });
    expect(resolvePlaceholder('validPassword', context({ requirementValues, profile })).entry).toBeNull();
    expect(resolvePlaceholder('validPassword', context({ answers: indexAnswers([answered('validPassword', 'hunter2')]), profile })).entry)
      .toMatchObject({ value: 'hunter2', source: 'clarification', sensitive: false });
    expect(literalRequirementValues(requirementValues, true)).toEqual({ validUsername: 'acme_user' });
    expect(literalRequirementValues(requirementValues)).toEqual({});
  });

  it('binds the base URL from the AUT profile and accepts only variable names as credential answers', () => {
    const profile = { baseUrlEnv: 'APP_BASE_URL', credentialEnvVars: {}, secretsEnvVars: [] };
    expect(resolvePlaceholder('validBaseURL', context({ profile })).entry).toMatchObject({ source: 'runtime', envVar: 'APP_BASE_URL', sensitive: false });
    expect(resolvePlaceholder('validPassword', context({ answers: indexAnswers([answered('validPassword', 'hunter2')]) })).entry).toBeNull();
    expect(resolvePlaceholder('validPassword', context({ answers: indexAnswers([answered('validPassword', 'APP_PASSWORD')]) })).entry)
      .toMatchObject({ envVar: 'APP_PASSWORD', origin: 'clarification' });
    expect(resolvePlaceholder('validPassword', context({ env: { ARIA_VALID_PASSWORD: 'set' } })).entry).toMatchObject({ envVar: 'ARIA_VALID_PASSWORD' });
  });
});

describe('Agent 04 data clarifications', () => {
  const unresolvedItem = (tcKey: string, name = 'productName') => ({
    placeholder: `{{${name}}}`, name, tcKey, stepIndex: 2, reason: 'No value is known.', valueClass: 'GROUNDED' as const, suggestion: '',
  });

  it('asks once per placeholder across test cases and records UI edits as answers', () => {
    const store = new ClarificationStore(`${PROJECT}-a`);
    const first = syncDataClarifications(store, [unresolvedItem('TC-001'), unresolvedItem('TC-002')], [], ['TC-001', 'TC-002']);
    expect(first.pending).toEqual([expect.objectContaining({ placeholder: 'productName', tcKeys: ['TC-001', 'TC-002'] })]);

    expect(answerDataClarifications(store, [{ name: 'productName', tcKey: 'TC-001', value: 'Blue Mug' }], 'qa-lead')).toEqual([]);
    expect(answerDataClarifications(store, [{ name: 'productName', value: 'Blue Mug' }], 'qa-lead')).toEqual([first.pending[0].id]);
    const answers = indexAnswers(store.listResolvedFor('04-test-data-generator'));
    expect(resolvePlaceholder('productName', context({ answers, tc: { ...tc, key: 'TC-002' } })).entry).toMatchObject({ value: 'Blue Mug' });
  });

  it('raises one environment question per missing variable and retires questions once values resolve', () => {
    const store = new ClarificationStore(`${PROJECT}-b`);
    store.raise({
      sourceStage: '05-playwright-script-generator', owningStage: '04-test-data-generator', kind: 'DATA', ruleId: 'UNRESOLVED_BINDING', tcKey: 'TC-001', stepIndex: 2,
      question: 'What value should be used?', context: { detail: 'Step 2: {{productName}} has no resolved value (run or complete Agent 04).' },
    });
    const issues = ['TC-001', 'TC-002'].map((tcKey) => ({ name: 'validPassword', envVar: 'ARIA_VALID_PASSWORD', tcKey }));
    const summary = syncDataClarifications(store, [unresolvedItem('TC-003')], issues, ['TC-001', 'TC-002', 'TC-003']);
    expect(summary.environment).toEqual([expect.objectContaining({ envVar: 'ARIA_VALID_PASSWORD', tcKeys: ['TC-001', 'TC-002'] })]);
    expect(summary.resolved).toBe(1);
    expect(store.listOpen({ sourceStage: '05-playwright-script-generator' })).toEqual([]);

    expect(syncDataClarifications(store, [], [], ['TC-003']).resolved).toBe(2);
    expect(store.listOpen()).toEqual([]);
  });
});
