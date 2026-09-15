/**
 * @fileoverview Unit tests for the Agent 05 automation contract and readiness pre-flight.
 */

import {
  FixtureAccumulator,
  buildAutomationTestCase,
  modeForType,
  toEnvVarName,
} from '../../agents/05-playwright-script-generator/contracts/automationTestCase';
import { assessReadiness } from '../../core/readiness/readinessRules';
import { ReadinessContext } from '../../core/readiness/readinessTypes';

const reviewed = {
  key: 'TC-001',
  name: 'Sign in with a valid access code',
  type: 'Positive',
  priority: 'High',
  labels: ['Smoke'],
  featureId: 'F-01',
  userStoryId: 'US-01',
  requirementRefs: ['AC-1'],
  objective: 'Verifies AC-1: Sign in with a valid access code',
  precondition: 'the user is on the sign-in page',
  testSteps: [
    { keyword: 'Given', description: 'the user is on the sign-in page', testData: '', expectedResult: 'The sign-in form is displayed' },
    { keyword: 'When', description: 'the user signs in', testData: '{{validCode}} / {{secretPin}}', expectedResult: 'The dashboard is displayed\nThe greeting "Welcome" is shown' },
  ],
};

const enriched = {
  ...reviewed,
  testSteps: reviewed.testSteps.map((s) => ({ ...s, testData: s.testData.replace('{{validCode}}', 'ABC123') })),
  resolvedData: {
    inputs: {
      '{{validCode}}': { value: 'ABC123', source: 'generated' },
      '{{secretPin}}': { value: '__RUNTIME__', sensitive: true, source: 'runtime' },
    },
  },
};

const uiReady: ReadinessContext = {
  mode: 'UI', baseURL: 'https://app.example.test', baseUrlEnv: 'AUT_BASE_URL', authStrategy: 'form',
};

describe('Agent 05 automation contract', () => {
  it('maps types to generation modes', () => {
    expect(modeForType('Negative')).toBe('UI');
    expect(modeForType('API')).toBe('API');
    expect(modeForType('Performance')).toBe('K6');
  });

  it('derives env var names for secrets', () => {
    expect(toEnvVarName('secretPin')).toBe('ARIA_SECRET_PIN');
  });

  it('keeps placeholders from the reviewed test case and binds them to fixtures or env vars', () => {
    const tc = buildAutomationTestCase(enriched, reviewed, new FixtureAccumulator());
    expect(tc.steps[1].testData).toBe('{{validCode}} / {{secretPin}}');
    expect(tc.steps[1].expected).toEqual(['The dashboard is displayed', 'The greeting "Welcome" is shown']);
    expect(tc.steps[1].data).toEqual([
      { token: '{{validCode}}', fixtureKey: 'validCode' },
      { token: '{{secretPin}}', envVar: 'ARIA_SECRET_PIN' },
    ]);
    expect(assessReadiness(tc, uiReady)).toEqual([]);
  });

  it('assigns per-test fixture keys when the same placeholder has different values', () => {
    const fixture = new FixtureAccumulator();
    expect(fixture.bind('TC-001', 'code', 'A')).toBe('code');
    expect(fixture.bind('TC-002', 'code', 'A')).toBe('code');
    expect(fixture.bind('TC-003', 'code', 'B')).toBe('TC003_code');
    expect(fixture.toObject()).toEqual({ TC003_code: 'B', code: 'A' });
  });

  it('reports unresolved data instead of guessing', () => {
    const tc = buildAutomationTestCase({ ...reviewed }, reviewed, new FixtureAccumulator());
    const missing = assessReadiness(tc, uiReady);
    expect(missing.map((m) => m.kind)).toEqual(['DATA', 'DATA']);
  });

  it('blocks test cases the reviewer marked for clarification', () => {
    const flagged = {
      ...enriched,
      testSteps: [{ ...enriched.testSteps[0], expectedResult: '[REQUIRES CLARIFICATION — expected result not specified]' }],
    };
    const tc = buildAutomationTestCase(flagged, flagged, new FixtureAccumulator());
    expect(assessReadiness(tc, uiReady).some((m) => m.kind === 'EXPECTED_RESULT')).toBe(true);
  });

  it('requires the base URL environment variable for UI automation', () => {
    const tc = buildAutomationTestCase(enriched, reviewed, new FixtureAccumulator());
    expect(assessReadiness(tc, { ...uiReady, baseURL: null })).toMatchObject([
      { kind: 'AUT_UNREACHABLE', detail: 'Environment variable AUT_BASE_URL is not set.' },
    ]);
  });

  it('requires documented, relative API details', () => {
    const api = {
      ...enriched, type: 'API', apiDetails: { method: 'post', endpoint: 'https://api.example.test/login', expectedStatusCode: 200 },
    };
    const tc = buildAutomationTestCase(api, api, new FixtureAccumulator());
    expect(tc.api?.method).toBe('POST');
    expect(assessReadiness(tc, { ...uiReady, mode: 'API' }).map((m) => m.kind)).toContain('ENDPOINT');
  });

  it('requires an SLA or threshold env for performance tests', () => {
    const perf = { ...enriched, type: 'Performance', performanceRef: { scenario: 'load', targetEndpoint: '/api/search' } };
    const tc = buildAutomationTestCase(perf, perf, new FixtureAccumulator());
    expect(assessReadiness(tc, { ...uiReady, mode: 'K6' }).map((m) => m.kind)).toEqual(['SLA']);
    expect(assessReadiness(tc, { ...uiReady, mode: 'K6', thresholdEnv: 'K6_THRESHOLD_P95' })).toEqual([]);
  });
});
