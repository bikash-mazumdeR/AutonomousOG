'use strict';

/**
 * @fileoverview Agent 03 defect catalogue. Agent 03 reviews with deterministic rules and makes no LLM call, so its
 * evaluation costs nothing and runs with the unit suite: a known-good suite must draw no finding, and each catalogued
 * defect — planted alone into that suite — must draw the finding the rule promises. Defects Agent 03 cannot see by
 * design (behaviour, not structure) are listed as KNOWN_MISSES, so the catalogue states its own limits.
 */

/** The analysis the clean suite covers: one HIGH-risk story (smoke required; minimums 3 positive, 3 negative, 2 edge). */
export const CLEAN_ANALYSIS = {
  features: [{
    id: 'F-01',
    name: 'Sign-in',
    riskLevel: 'HIGH',
    userStories: [{
      id: 'US-01',
      title: 'Sign in with email and password',
      acceptanceCriteria: [
        '[@functional] Valid credentials open the dashboard.',
        "[@error-handling] A wrong password shows 'Email or password is incorrect'.",
        '[@functional] The Sign in button is disabled until both fields are filled.',
      ],
      businessRules: ['The password is 8 to 64 characters.'],
    }],
  }],
};

type Step = { keyword: string; description: string; testData: string; expectedResult: string };

const step = (keyword: string, description: string, expectedResult: string, testData = ''): Step => ({
  keyword, description, testData, expectedResult,
});

const onSignInPage = step('Given', 'the user is on the sign-in page', 'The sign-in form is displayed');

/** A well-formed test case of the clean suite. */
function testCase(key: string, type: string, name: string, refs: string[], steps: Step[], extra: Record<string, unknown> = {}): any {
  return {
    key,
    name,
    objective: `Verifies ${refs.join(', ')}: ${name}`,
    precondition: 'the user is on the sign-in page',
    type,
    priority: type === 'Edge' ? 'Medium' : 'High',
    labels: ['Functional'],
    featureId: 'F-01',
    userStoryId: 'US-01',
    requirementRefs: refs,
    testSteps: steps,
    hash: `hash-${key}`,
    selected: true,
    ...extra,
  };
}

/** A suite a careful reviewer would pass without comment. */
export function cleanSuite(): any[] {
  return [
    testCase('TC-001', 'Positive', 'Valid credentials open the dashboard', ['AC-1'], [
      onSignInPage, step('When', 'the user signs in with valid credentials', 'The dashboard is displayed', '{{validEmail}}'),
    ], { labels: ['Smoke', 'Functional'] }),
    testCase('TC-002', 'Positive', 'Sign in button enables once both fields are filled', ['AC-3'], [
      onSignInPage, step('When', 'the user fills in the email and the password fields', 'The Sign in button is enabled', '{{validPassword}}'),
    ]),
    testCase('TC-003', 'Positive', 'An 8-character password is accepted at sign-in', ['BR-1'], [
      onSignInPage, step('When', 'the user signs in with an 8-character password', 'The dashboard is displayed', '{{minLengthPassword}}'),
    ]),
    testCase('TC-004', 'Negative', 'A wrong password shows the credentials error', ['AC-2'], [
      onSignInPage, step('When', 'the user signs in with a wrong password', "The error 'Email or password is incorrect' is displayed", '{{invalidPassword}}'),
    ]),
    testCase('TC-005', 'Negative', 'Sign in stays disabled with only the email filled', ['AC-3'], [
      onSignInPage, step('When', 'the user fills in only the email field', 'The Sign in button stays disabled', '{{validEmail}}'),
    ]),
    testCase('TC-006', 'Negative', 'Sign in stays disabled with only the password filled', ['AC-3'], [
      onSignInPage, step('When', 'the user fills in only the password field', 'The Sign in button stays disabled', '{{validPassword}}'),
    ]),
    testCase('TC-007', 'Edge', 'A 64-character password is accepted at sign-in', ['BR-1'], [
      onSignInPage, step('When', 'the user signs in with a 64-character password', 'The dashboard is displayed', '{{maxLengthPassword}}'),
    ]),
    testCase('TC-008', 'Edge', 'A 65-character password is rejected at sign-in', ['BR-1'], [
      onSignInPage, step('When', 'the user signs in with a 65-character password', "The error 'Email or password is incorrect' is displayed", '{{tooLongPassword}}'),
    ]),
  ];
}

/** A finding a defect must draw. `tcKey` defaults to the test case the defect was planted in. */
export interface ExpectedFinding {
  dimension: string;
  severity: string;
  tcKey?: string;
  /** The planted test case's review status afterwards, when the rule sets one. */
  status?: string;
}

/** One catalogued defect: how to plant it into the clean suite and what Agent 03 must report. */
export interface Defect {
  id: string;
  description: string;
  /** Key of the test case the defect is planted in. */
  tcKey: string;
  plant: (suite: any[]) => void;
  expect: ExpectedFinding;
}

const find = (suite: any[], key: string) => suite.find((tc) => tc.key === key);
export const CATALOGUE_SECRET = 'Catalogue#Pass-2026';

export const DEFECTS: Defect[] = [
  { id: 'short-name', description: 'Name under 10 characters', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').name = 'Sign in'; }, expect: { dimension: 'COMPLETENESS', severity: 'BLOCKER', status: 'REJECTED' } },
  { id: 'missing-objective', description: 'Objective missing', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').objective = ''; }, expect: { dimension: 'COMPLETENESS', severity: 'MAJOR', status: 'FLAGGED' } },
  { id: 'single-step', description: 'Only one step', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').testSteps.splice(1); }, expect: { dimension: 'COMPLETENESS', severity: 'BLOCKER', status: 'REJECTED' } },
  { id: 'no-expected-result', description: 'A step without an expected result', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').testSteps[1].expectedResult = ''; }, expect: { dimension: 'COMPLETENESS', severity: 'MAJOR', status: 'FLAGGED' } },
  { id: 'vague-step', description: 'A vague step ("make sure it works")', tcKey: 'TC-002', plant: (s) => { Object.assign(find(s, 'TC-002').testSteps[1], { description: 'make sure it works', expectedResult: 'it works' }); }, expect: { dimension: 'STEP_QUALITY', severity: 'MAJOR', status: 'FLAGGED' } },
  { id: 'invalid-priority', description: 'Priority outside High/Medium/Low', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').priority = 'Urgent'; }, expect: { dimension: 'COMPLETENESS', severity: 'MINOR' } },
  { id: 'no-labels', description: 'No labels', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').labels = []; }, expect: { dimension: 'COMPLETENESS', severity: 'MINOR' } },
  { id: 'angle-placeholder', description: 'Placeholder written as <var>', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').testSteps[1].testData = '<password>'; }, expect: { dimension: 'DATA', severity: 'MINOR' } },
  { id: 'literal-email', description: 'A literal email address (PII)', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').testSteps[1].testData = 'someone@example.test'; }, expect: { dimension: 'DATA', severity: 'MINOR' } },
  { id: 'secret-value', description: 'A secret value written out', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').testSteps[1].testData = CATALOGUE_SECRET; }, expect: { dimension: 'DATA', severity: 'MAJOR' } },
  { id: 'duplicate-steps', description: 'Same steps as another test case (same hash)', tcKey: 'TC-006', plant: (s) => { find(s, 'TC-006').hash = find(s, 'TC-005').hash; }, expect: { dimension: 'DUPLICATE', severity: 'MAJOR' } },
  { id: 'duplicate-title', description: 'Same title as another test case in the story', tcKey: 'TC-006', plant: (s) => { find(s, 'TC-006').name = find(s, 'TC-005').name; }, expect: { dimension: 'DUPLICATE', severity: 'MAJOR' } },
  { id: 'missing-feature', description: 'No featureId', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').featureId = ''; }, expect: { dimension: 'TRACEABILITY', severity: 'MAJOR' } },
  { id: 'unknown-ref', description: 'A requirement ref the story does not have', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').requirementRefs = ['AC-9']; }, expect: { dimension: 'TRACEABILITY', severity: 'MAJOR' } },
  { id: 'no-refs', description: 'No requirement refs', tcKey: 'TC-002', plant: (s) => { find(s, 'TC-002').requirementRefs = []; }, expect: { dimension: 'TRACEABILITY', severity: 'MINOR' } },
  { id: 'api-no-details', description: 'API test case without apiDetails', tcKey: 'TC-009', plant: (s) => { s.push({ ...find(s, 'TC-001'), key: 'TC-009', hash: 'hash-TC-009', name: 'The session API returns the signed-in user', type: 'API', labels: ['Functional'] }); }, expect: { dimension: 'API', severity: 'BLOCKER', status: 'REJECTED' } },
  { id: 'api-bad-method', description: 'API test case with an invalid HTTP method', tcKey: 'TC-009', plant: (s) => { s.push({ ...find(s, 'TC-001'), key: 'TC-009', hash: 'hash-TC-009', name: 'The session API returns the signed-in user', type: 'API', labels: ['Functional'], apiDetails: { method: 'FETCH', endpoint: '/api/session', expectedStatusCode: 200 } }); }, expect: { dimension: 'API', severity: 'MAJOR' } },
  { id: 'api-no-status', description: 'API test case without an expected status code', tcKey: 'TC-009', plant: (s) => { s.push({ ...find(s, 'TC-001'), key: 'TC-009', hash: 'hash-TC-009', name: 'The session API returns the signed-in user', type: 'API', labels: ['Functional'], apiDetails: { method: 'GET', endpoint: '/api/session' } }); }, expect: { dimension: 'API', severity: 'MAJOR' } },
  { id: 'perf-no-ref', description: 'Performance test case without performanceRef', tcKey: 'TC-009', plant: (s) => { s.push({ ...find(s, 'TC-001'), key: 'TC-009', hash: 'hash-TC-009', name: 'Sign-in holds up under load', type: 'Performance', labels: ['Functional'] }); }, expect: { dimension: 'PERFORMANCE', severity: 'BLOCKER', status: 'REJECTED' } },
  { id: 'perf-bad-scenario', description: 'Performance test case with an unknown K6 scenario', tcKey: 'TC-009', plant: (s) => { s.push({ ...find(s, 'TC-001'), key: 'TC-009', hash: 'hash-TC-009', name: 'Sign-in holds up under load', type: 'Performance', labels: ['Functional'], performanceRef: { scenario: 'burst', targetEndpoint: '/api/session' } }); }, expect: { dimension: 'PERFORMANCE', severity: 'MAJOR' } },
  { id: 'too-few-negatives', description: 'A HIGH-risk feature below its negative minimum', tcKey: 'FEATURE-F-01', plant: (s) => { s.splice(s.findIndex((tc) => tc.key === 'TC-006'), 1); }, expect: { dimension: 'COVERAGE', severity: 'MINOR' } },
  { id: 'no-smoke', description: 'A HIGH-risk feature with no Smoke test case', tcKey: 'FEATURE-F-01', plant: (s) => { find(s, 'TC-001').labels = ['Functional']; }, expect: { dimension: 'COVERAGE', severity: 'MAJOR' } },
];

/** Defects a structural reviewer cannot see; found only by running the tests. Listed so the catalogue states its limits. */
export const KNOWN_MISSES: string[] = [
  'A step that acts on an element an earlier step already removed (clicking Close after the modal closed itself)',
  'An assertion satisfied by a leftover from an earlier step (a success toast from the previous save)',
  'An expected result that contradicts the criterion it is tagged with',
  'Wording or values the requirement never states (checked by Agent 02, not Agent 03)',
];
