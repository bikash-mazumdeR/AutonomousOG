/**
 * @fileoverview Unit tests for the shared automation-readiness rules, their phases, ownership and questions.
 */

import { assessReadiness } from '../../core/readiness/readinessRules';
import {
  READINESS_PHASE, ReadinessContext, ReadinessInput, ReadinessStep,
} from '../../core/readiness/readinessTypes';
import { OWNING_STAGE, owningStageFor } from '../../core/readiness/ownership';
import { questionFor } from '../../core/readiness/questions';

const step = (index: number, action: string, expected: string[], testData = ''): ReadinessStep => ({
  index, action, expected, testData, data: [],
});
const input = (steps: ReadinessStep[], precondition = 'the user is on the sign-in page'): ReadinessInput => ({ precondition, steps });
const review: ReadinessContext = {
  mode: 'UI', baseURL: null, baseUrlEnv: 'AUT_BASE_URL', authStrategy: 'none', phase: READINESS_PHASE.REVIEW,
};
const ruleIds = (tc: ReadinessInput, ctx: ReadinessContext = review) => assessReadiness(tc, ctx).map((item) => item.ruleId);

describe('Automation readiness rules', () => {
  it('accepts concrete, observable steps', () => {
    expect(assessReadiness(input([
      step(1, 'the user is on the sign-in page', ['The sign-in form is displayed']),
      step(2, 'the user enters a PIN and submits', ['The error "Access code is required" is displayed', 'The user remains on /sign-in'], '{{validPin}}'),
      step(3, 'the user reloads the page', ['The error banner background is #FF0000', 'The dashboard page is displayed within 5000 ms']),
    ]), review)).toEqual([]);
  });

  it('asks for exact text, an observable outcome and a visible target for a time limit', () => {
    const tc = input([step(1, 'the user submits the form', ['An error message is displayed', 'The login works properly', 'The results load within 5000 ms'])]);
    expect(ruleIds(tc)).toEqual(['UNQUOTED_TEXT', 'VAGUE_EXPECTED_RESULT', 'TIMING_WITHOUT_TARGET']);
  });

  it('flags observations the user interface cannot show', () => {
    expect(assessReadiness(input([step(2, 'the user logs in', ['The session token is stored in Local Storage'])]), review))
      .toEqual([expect.objectContaining({ kind: 'UNASSERTABLE', ruleId: 'UNASSERTABLE_OBSERVATION', stepIndex: 2 })]);
    expect(ruleIds(input([step(2, 'the user submits the form', ['The form inputs are properly announced to screen reader devices'])]), review))
      .toEqual(['UNASSERTABLE_OBSERVATION']);
  });

  it('accepts a local-storage expectation that names its key, since the storage helpers poll it by key', () => {
    expect(ruleIds(input([step(2, 'the user signs in', ["local storage key 'auth_expires_at' holds a timestamp 30 days in the future"])]), review))
      .toEqual([]);
    // Without a key there is nothing to poll, and any other unsupported subject still blocks the whole line
    expect(ruleIds(input([step(2, 'the user signs in', ['the session is persisted in local storage'])]), review))
      .toEqual(['UNASSERTABLE_OBSERVATION']);
    expect(ruleIds(input([step(2, 'the user signs in', ["local storage key 'k' is set and a confirmation e-mail is sent"])]), review))
      .toEqual(['UNASSERTABLE_OBSERVATION']);
  });

  it('does not ask for text when an element disappears or changes state', () => {
    expect(ruleIds(input([step(3, 'the user edits the username', [
      'The error message is no longer displayed below the form',
      'The password input displays masked characters instead of plain text',
      'The error banner is dismissed',
    ])]), review)).toEqual([]);
  });

  it('asks for data when a step enters a value without giving it', () => {
    expect(ruleIds(input([step(2, 'the user enters a username of 255 characters', ['The error "Username is too long" is displayed'])])))
      .toEqual(['INPUT_WITHOUT_DATA']);
  });

  it('applies review-only and generation-only rules in their phase', () => {
    const unbound: ReadinessStep = { ...step(1, 'the user opens the page', ['The sign-in form is displayed']), data: [{ token: '{{code}}', unresolved: true }] };
    const tc = input([unbound], '');
    expect(ruleIds(tc, review)).toEqual(['PRECONDITION_MISSING']);
    expect(ruleIds(tc, { ...review, phase: READINESS_PHASE.GENERATION, baseURL: 'http://127.0.0.1' })).toEqual(['UNRESOLVED_BINDING']);
    expect(ruleIds(tc, { ...review, phase: READINESS_PHASE.GENERATION })).toEqual(['UNRESOLVED_BINDING', 'AUT_BASE_URL']);
  });

  it('checks API and performance details in both phases', () => {
    const base = input([step(1, 'the client sends the request', ['The response status is 201'])]);
    expect(ruleIds({ ...base, api: { method: 'POST', endpoint: 'https://api.example.test/login', expectedStatusCode: 201 } }, { ...review, mode: 'API' }))
      .toEqual(['API_DETAILS']);
    expect(ruleIds({ ...base, performance: { scenario: 'load', targetEndpoint: '/api/search' } }, { ...review, mode: 'K6' })).toEqual(['K6_SLA']);
  });

  it('routes each gap to the stage that owns the missing information', () => {
    expect(owningStageFor({ kind: 'EXPECTED_RESULT', ruleId: 'UNQUOTED_TEXT', detail: '' })).toBe(OWNING_STAGE.TEST_CASE_REVIEW);
    expect(owningStageFor({ kind: 'DATA', ruleId: 'INPUT_WITHOUT_DATA', detail: '' })).toBe(OWNING_STAGE.TEST_CASE_REVIEW);
    expect(owningStageFor({ kind: 'DATA', ruleId: 'UNRESOLVED_BINDING', detail: '' })).toBe(OWNING_STAGE.TEST_DATA);
    expect(owningStageFor({ kind: 'SLA', detail: '' })).toBe(OWNING_STAGE.REQUIREMENTS);
    expect(owningStageFor({ kind: 'AUT_UNREACHABLE', detail: '' })).toBe(OWNING_STAGE.ENVIRONMENT);
    expect(owningStageFor({ kind: 'LOCATOR', detail: '' })).toBe(OWNING_STAGE.TEST_CASE_REVIEW);
  });

  it('turns every gap into a specific question', () => {
    const [item] = assessReadiness(input([step(1, 'the user submits', ['An error message is displayed'])]), review);
    expect(questionFor(item)).toMatch(/exact text, word for word/);
    expect(questionFor({ kind: 'LOCATOR', detail: 'Element dialog is not present in state start.' })).toMatch(/How can this element be identified/);
  });
});
