/**
 * @fileoverview Unit tests for browser-specific test cases: detection, readiness questions and browser scoping.
 */

import { otherBrowsersPattern, targetedBrowsers } from '../../core/readiness/browserTargets';
import { assessReadiness } from '../../core/readiness/readinessRules';
import { READINESS_PHASE, ReadinessContext } from '../../core/readiness/readinessTypes';
import { FixtureAccumulator, buildAutomationTestCase } from '../../agents/05-playwright-script-generator/contracts/automationTestCase';
import { renderTags } from '../../agents/05-playwright-script-generator/rendering/specRenderer';

const contract = (name: string) => {
  const tc = {
    key: 'TC-022',
    name,
    type: 'Positive',
    labels: ['Regression'],
    featureId: 'F-01',
    precondition: 'the user is on the sign-in page',
    testSteps: [{ keyword: 'When', description: 'the user signs in', testData: '', expectedResult: 'The account page "Welcome" is displayed' }],
  };
  return buildAutomationTestCase(tc, tc, new FixtureAccumulator());
};

const generation = (browsers?: string[]): ReadinessContext => ({
  mode: 'UI', phase: READINESS_PHASE.GENERATION, baseURL: 'https://app.example.test', baseUrlEnv: 'APP_URL', authStrategy: 'none', browsers,
});
const review: ReadinessContext = { ...generation(), phase: READINESS_PHASE.REVIEW };
const ruleIds = (items: Array<{ ruleId?: string }>) => items.map((item) => item.ruleId);

describe('Browser-specific test cases', () => {
  it('recognises the browsers a test case names, but not "edge" in other senses', () => {
    expect(targetedBrowsers(['Successful login in Firefox'])).toEqual([{ label: 'Firefox', engine: 'firefox' }]);
    expect(targetedBrowsers(['the user is on the login page in Safari on a Desktop device']).map((t) => t.engine)).toEqual(['webkit']);
    expect(targetedBrowsers(['Invalid credentials in Chrome'])).toEqual([{ label: 'Chrome', engine: 'chromium' }]);
    expect(targetedBrowsers(['Successful login in Edge'])).toEqual([{ label: 'Microsoft Edge', engine: null }]);
    expect(targetedBrowsers(['Username boundary edge case', 'focus on edge cases'])).toEqual([]);
  });

  it('scopes a test to the browser it names when the AUT profile runs that browser', () => {
    const tc = contract('Successful login in Firefox');
    expect(assessReadiness(tc, generation(['chromium', 'firefox']))).toEqual([]);
    expect(renderTags(tc)).toEqual(['@positive', '@regression', '@browser-firefox']);
    expect(otherBrowsersPattern('chromium').test('[TC-022] Successful login in Firefox @positive @browser-firefox')).toBe(true);
    expect(otherBrowsersPattern('firefox').test('@positive @browser-firefox')).toBe(false);
    expect(otherBrowsersPattern('chromium').test('@positive @regression')).toBe(false);
  });

  it('asks instead of running a browser-specific test in a browser it does not name', () => {
    expect(assessReadiness(contract('Successful login in Firefox'), generation(['chromium'])))
      .toEqual([expect.objectContaining({ kind: 'BROWSER', ruleId: 'BROWSER_NOT_CONFIGURED', subject: 'Firefox' })]);
    expect(ruleIds(assessReadiness(contract('Successful login in Edge'), generation(['chromium'])))).toEqual(['BROWSER_UNSUPPORTED']);
    expect(ruleIds(assessReadiness(contract('Successful login in Edge'), review))).toEqual(['BROWSER_UNSUPPORTED']);
    expect(ruleIds(assessReadiness(contract('Successful login in Firefox'), review))).toEqual([]);
  });
});
