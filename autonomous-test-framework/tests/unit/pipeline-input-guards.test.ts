/**
 * @fileoverview Unit tests for the guards that keep bad input from reaching Agent 05: exact-text questions about
 * non-text elements, discovery plans with phantom actions, flows built from them, and declined clarification replies.
 */

import { assessReadiness } from '../../core/readiness/readinessRules';
import { READINESS_PHASE, ReadinessContext } from '../../core/readiness/readinessTypes';
import { validateNavigationPlan } from '../../agents/05-playwright-script-generator/discovery/navigationPlanner';
import { extractFlows, hasRedundantActions } from '../../agents/05-playwright-script-generator/discovery/flowExtractor';
import { PageMap, PageState, TestCaseTrace } from '../../agents/05-playwright-script-generator/discovery/pageMap';
import { AutomationTestCase } from '../../agents/05-playwright-script-generator/contracts/automationTestCase';
import { isNonAnswer } from '../../core/clarifications/answerQuality';
import { stateDb } from '../../core/state-manager/Database';
import { ClarificationStore } from '../../core/clarifications/ClarificationStore';
import { applyClarificationDecision } from '../../agents/03-test-case-reviewer/readiness/reviewOverrides';
import { applyClarificationAnswers } from '../../agents/03-test-case-reviewer/readiness/applyAnswers';

const PROJECT = `test-unit-guards-${Date.now()}`;

afterAll(() => {
  stateDb.prepare('DELETE FROM project_clarifications WHERE project_id LIKE ?').run(`${PROJECT}%`);
});

describe('Readiness: no exact-text question for elements without text', () => {
  const review: ReadinessContext = {
    mode: 'UI', baseURL: null, baseUrlEnv: 'AUT_BASE_URL', authStrategy: 'none', phase: READINESS_PHASE.REVIEW,
  };
  const ruleIds = (line: string) => assessReadiness({
    precondition: 'the user is on the sign-in page',
    steps: [{
      index: 1, action: 'the user submits the form', expected: [line], testData: '', data: [],
    }],
  }, review).map((item) => item.ruleId);

  it.each([
    'an error icon is displayed alongside the error message',
    'The warning image appears next to the title',
    'a loading spinner is shown while the message loads',
  ])('does not ask for the text of "%s"', (line) => {
    expect(ruleIds(line)).not.toContain('UNQUOTED_TEXT');
  });

  it('still asks for the exact text of a message', () => {
    expect(ruleIds('an error message with an icon is displayed')).toContain('UNQUOTED_TEXT');
    expect(ruleIds('the error message is displayed')).toContain('UNQUOTED_TEXT');
  });
});

const signInCase = (tcKey = 'TC-001'): AutomationTestCase => ({
  tcKey,
  title: 'Locked account shows the locked error',
  type: 'Negative',
  priority: 'High',
  labels: [],
  featureId: 'F-01',
  userStoryId: 'US-01',
  requirementRefs: ['AC-1'],
  objective: '',
  precondition: 'the user navigates to the login page',
  steps: [
    {
      index: 1, keyword: 'Given', action: 'the user navigates to the login page', expected: ['the Username field is displayed'], testData: '', data: [],
    },
    {
      index: 2, keyword: 'When', action: 'the user enters "locked_user" in the Username field and clicks Login', expected: ['the error is shown'], testData: '', data: [],
    },
  ],
});

const startState: PageState = {
  name: 'start',
  urlPath: '/',
  entryPath: '/',
  elements: [
    { name: 'usernameInput', strategy: 'testId', args: ['username'], tag: 'input' },
    { name: 'loginButton', strategy: 'role', args: ['button', 'Login'], tag: 'button' },
  ],
} as PageState;

describe('Discovery plans: no phantom actions', () => {
  const plan = (actions: any[]) => validateNavigationPlan({ actions, stopReason: 'COMPLETE' }, startState, signInCase());

  it('rejects an empty literal', () => {
    const { errors } = plan([{ stepIndex: 2, element: 'usernameInput', op: 'fill', value: { literal: '' } }]);
    expect(errors.join('\n')).toMatch(/literal must not be empty/);
  });

  it('rejects a literal attributed to a step that does not contain it', () => {
    const { errors } = plan([{ stepIndex: 1, element: 'usernameInput', op: 'fill', value: { literal: 'locked_user' } }]);
    expect(errors.join('\n')).toMatch(/"locked_user" does not appear in step 1/);
  });

  it('accepts a literal from its own step', () => {
    const { errors, plan: valid } = plan([
      { stepIndex: 2, element: 'usernameInput', op: 'fill', value: { literal: 'locked_user' } },
      { stepIndex: 2, element: 'loginButton', op: 'click' },
    ]);
    expect(errors).toEqual([]);
    expect(valid?.actions).toHaveLength(2);
  });
});

describe('Verified flows: never from mistakes, never "verified by" a test case that cannot call them', () => {
  const map = (traces: TestCaseTrace[]): PageMap => ({
    version: 2, featureId: 'F-01', states: [startState], traces, flows: [],
  } as PageMap);
  const run = (tcKey: string, stepOfFirstFill: number, doubleFill = false): TestCaseTrace => ({
    tcKey,
    runs: [{
      state: 'start',
      reachedState: 'start',
      actions: [
        ...(doubleFill ? [{ stepIndex: stepOfFirstFill, state: 'start', element: 'usernameInput', op: 'fill', value: { literal: '' } }] : []),
        { stepIndex: stepOfFirstFill, state: 'start', element: 'usernameInput', op: 'fill', value: { literal: 'locked_user' } },
        { stepIndex: 2, state: 'start', element: 'loginButton', op: 'click' },
      ],
    }],
    stateAfterStep: { 1: 'start', 2: 'start' },
  } as TestCaseTrace);

  it('detects back-to-back overwriting actions on the same element', () => {
    expect(hasRedundantActions(run('TC-001', 2, true).runs[0])).toBe(true);
    expect(hasRedundantActions(run('TC-001', 2).runs[0])).toBe(false);
  });

  it('builds no flow from runs with redundant actions', () => {
    expect(extractFlows(map([run('TC-001', 2, true), run('TC-002', 2, true)]))).toEqual([]);
  });

  it('counts only test cases the flow applies to', () => {
    const traces = [run('TC-001', 2), run('TC-002', 2), run('TC-003', 1)];
    const cases = [signInCase('TC-001'), signInCase('TC-002'), signInCase('TC-003')];
    // Without the test cases every matching trace counts (backwards compatible)
    expect(extractFlows(map(traces)).map((flow) => flow.usedBy)).toEqual([['TC-001', 'TC-002', 'TC-003']]);
    // TC-003 fills during step 1, whose expected result must be asserted before step 2's click: not a user
    const tcThreeRunOnly = [run('TC-003', 1), { ...run('TC-004', 1), tcKey: 'TC-004' }];
    expect(extractFlows(map(tcThreeRunOnly), [signInCase('TC-003'), signInCase('TC-004')])).toEqual([]);
    expect(extractFlows(map(traces), cases).map((flow) => flow.usedBy)).toEqual([['TC-001', 'TC-002']]);
  });
});

describe('Clarifications: declined replies are not answers', () => {
  it.each(['Skip', 'skip.', 'N/A', 'n/a', 'TBD', "I don't know", '?', '  ', '-'])('treats "%s" as a non-answer', (reply) => {
    expect(isNonAnswer(reply)).toBe(true);
  });

  it.each(['No', 'Yes', 'Epic sadface: Sorry, this user has been locked out.', '#E2453C background-color', 'None of the fields are trimmed'])(
    'accepts "%s" as an answer', (reply) => {
      expect(isNonAnswer(reply)).toBe(false);
    },
  );

  it('refuses to record "Skip" at review and never applies an old declined reply', () => {
    const store = new ClarificationStore(`${PROJECT}-a`);
    const question = store.raise({
      sourceStage: '03-test-case-reviewer', owningStage: '03-test-case-reviewer', kind: 'EXPECTED_RESULT', ruleId: 'UNQUOTED_TEXT',
      tcKey: 'TC-001', stepIndex: 1, subject: 'the error message is displayed', question: 'What is the exact text?', subjectHash: 'h1',
    });
    expect(applyClarificationDecision(store, { id: question.id, action: 'ANSWER', answer: 'Skip' })).toMatchObject({
      outcome: 'INVALID', message: expect.stringMatching(/"Skip" does not answer the question/),
    });
    expect(store.get(question.id)?.status).toBe('OPEN');

    store.answer(question.id, 'N/A', 'legacy-ui');
    const tc = {
      key: 'TC-001', hash: 'h1', testSteps: [{ description: 'submit', testData: '', expectedResult: 'the error message is displayed' }],
    };
    expect(applyClarificationAnswers([tc], store)).toEqual([]);
    expect(tc.testSteps[0].expectedResult).toBe('the error message is displayed');
  });
});
