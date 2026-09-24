/**
 * @fileoverview Agent 04 catalogue (evals/agent04): every labelled placeholder gets its correct class, value sources are
 * used in the documented order, and no secret ever reaches the fixture — on planted cases and on the real Nexolvi suites
 * (frozen, secrets redacted). Deterministic, 0 tokens.
 */

import * as fs from 'fs';
import * as path from 'path';
import { policyValueClass } from '../../agents/04-test-data-generator/valuePolicy';
import { TestDataGeneratorAgent } from '../../agents/04-test-data-generator/agent';
import { CATALOGUE_ENV, CATALOGUE_PROFILE, CLASSIFICATION } from '../../evals/agent04/catalogue';

jest.mock('p-retry', () => ({ __esModule: true, default: jest.fn(), AbortError: class extends Error {} }), { virtual: true });
jest.mock('../../core/llm/LLMClient', () => ({ llmClient: { chat: jest.fn(), getStageUsage: jest.fn(), getCallTraces: jest.fn(() => []) } }));

const SECRET_VALUES = Object.values(CATALOGUE_ENV);
const agent: any = new TestDataGeneratorAgent();

const testCase = (key: string, steps: Array<[string, string]>, extra: Record<string, unknown> = {}) => ({
  key, name: `Case ${key}`, objective: 'Verifies AC-1', type: 'Positive', featureId: 'F-01', userStoryId: 'US-01', hash: `h-${key}`,
  testSteps: steps.map(([description, testData]) => ({ keyword: 'When', description, testData, expectedResult: 'The result is displayed' })),
  ...extra,
});
const analysisWith = (testDataValues: any[]) => ({ features: [{ id: 'F-01', userStories: [{ id: 'US-01', testDataValues }] }] });
const answer = (placeholder: string, value: string) => ({
  // Stored as Agent 04 raises it: the bare placeholder name, answered project-wide.
  id: `clar-${placeholder}`, answer: value, ruleId: 'UNRESOLVED_BINDING', context: { placeholder }, answeredAt: '2026-01-01T00:00:00.000Z',
});
const resolve = (testCases: any[], analysis: any, answers: any[] = [], profile: any = CATALOGUE_PROFILE) => agent.resolveForEval({
  testCases, analysis, profile, env: CATALOGUE_ENV, answers,
});
const input = (result: any, tcKey: string, name: string) => result.perTCData[tcKey].inputs[`{{${name}}}`];
const noSecretIn = (value: unknown) => SECRET_VALUES.every((secret) => !JSON.stringify(value).includes(secret));

describe('Agent 04 catalogue — classification', () => {
  it.each(CLASSIFICATION.map((c) => [c.name, c.expected, c.why] as const))('%s → %s (%s)', (name, expected) => {
    expect(policyValueClass(name, CATALOGUE_PROFILE)).toBe(expected);
  });
});

describe('Agent 04 catalogue — value sources in order', () => {
  it('a human answer beats the requirement', () => {
    const result = resolve([testCase('TC-001', [['the user searches', '{{productName}}']])],
      analysisWith([{ name: 'productName', value: 'Blue Mug', sourceRef: 'AC-1' }]), [answer('productName', 'Red Mug')]);
    expect(input(result, 'TC-001', 'productName')).toMatchObject({ value: 'Red Mug', source: 'clarification' });
  });

  it('the requirement beats generation', () => {
    const result = resolve([testCase('TC-001', [['the user enters a wrong password', '{{invalidPassword}}']])],
      analysisWith([{ name: 'invalidPassword', value: 'not-it', sourceRef: 'AC-2' }]));
    expect(input(result, 'TC-001', 'invalidPassword')).toMatchObject({ value: 'not-it', source: 'requirement' });
  });

  it('a declared credential is read from its variable, even when the requirement states it', () => {
    const result = resolve([testCase('TC-001', [['the user signs in', '{{validEmail}}']])],
      analysisWith([{ name: 'validEmail', value: CATALOGUE_ENV.APP_EMAIL, sourceRef: 'AC-1' }]));
    expect(input(result, 'TC-001', 'validEmail')).toMatchObject({ source: 'runtime', envVar: 'APP_EMAIL' });
  });

  it('an application value nobody states is asked, never generated', () => {
    const result = resolve([testCase('TC-001', [['the user opens the product', '{{productId}}']])], analysisWith([]));
    expect(input(result, 'TC-001', 'productId')).toMatchObject({ source: 'unresolved' });
    expect(result.unresolved.map((u: any) => u.name)).toEqual(['productId']);
  });

  it('a made-up input is generated when nothing states it', () => {
    const result = resolve([testCase('TC-001', [['the user repeats a different password', '{{differentPassword}}']])], analysisWith([]));
    expect(input(result, 'TC-001', 'differentPassword')).toMatchObject({ source: 'generated', sensitive: false });
  });
});

describe('Agent 04 catalogue — no secret reaches the fixture', () => {
  it('holds against every way a secret can arrive', () => {
    const testCases = [
      testCase('TC-001', [['the user signs in', '{{validEmail}}'], ['with the password', '{{validPassword}}']]),
      testCase('TC-002', [['the profile shows the email', '{{userEmail}}'], ['the account email is shown', '{{accountEmail}}']]),
      testCase('TC-003', [['the client sends the token', '{{apiToken}}']]),
    ];
    const analysis = analysisWith([
      // the requirement quotes the login email under a name no credential binding covers
      { name: 'userEmail', value: CATALOGUE_ENV.APP_EMAIL, sourceRef: 'AC-4', sensitive: false },
      // a value Agent 01 redacted to a placeholder
      { name: 'accountEmail', value: '{{validEmail}}', sourceRef: 'AC-4', sensitive: false },
    ]);
    // a human typed the real password as the answer for a declared credential
    const result = resolve(testCases, analysis, [answer('validPassword', CATALOGUE_ENV.APP_PASSWORD)]);
    // The typed password is never used as a value: a declared credential takes only a variable name.
    expect(input(result, 'TC-001', 'validPassword')).toMatchObject({ source: 'runtime', envVar: 'APP_PASSWORD' });
    expect(noSecretIn(result.perTCData)).toBe(true);
    expect(noSecretIn(result.fixture)).toBe(true);
    expect(noSecretIn(result.requirementValues)).toBe(true);
    expect(Object.values(result.fixture).some((v) => typeof v === 'string' && v.includes('{{'))).toBe(false);
  });

  const root = path.resolve(__dirname, '../../projects/nexolvi');
  const nexolvi = JSON.parse(fs.readFileSync(path.join(root, 'aut-profile.json'), 'utf-8'));
  const profile = { credentialEnvVars: nexolvi.auth.credentialEnvVars, secretsEnvVars: nexolvi.secretsEnvVars };
  const env = Object.fromEntries(nexolvi.secretsEnvVars.map((name: string, i: number) => [name, `catalogue-secret-${i}-value`]));

  it.each(['login', 'logout', 'profile'])('on the real %s suite: credentials come from the environment, and none reaches the fixture', (feature) => {
    const testCases = JSON.parse(fs.readFileSync(path.join(root, 'evals', 'agent03', feature, 'test-cases.json'), 'utf-8'));
    const analysis = JSON.parse(fs.readFileSync(path.join(root, 'evals', 'agent02', feature, 'analysis.json'), 'utf-8'));
    const result = agent.resolveForEval({ testCases, analysis, profile, env });
    for (const tcData of Object.values(result.perTCData) as any[]) {
      for (const name of Object.keys(profile.credentialEnvVars)) {
        const entry = tcData.inputs[`{{${name}}}`];
        if (entry) expect(entry).toMatchObject({ source: 'runtime', envVar: profile.credentialEnvVars[name] });
      }
    }
    expect(Object.values(env).every((secret) => !JSON.stringify(result.fixture).includes(secret as string))).toBe(true);
    expect(Object.values(result.fixture).some((v) => typeof v === 'string' && v.includes('{{'))).toBe(false);
  });
});

describe('Agent 04 catalogue — safe inputs and real answers only', () => {
  it('probes for SQL injection without a payload that could change data on a shared environment', () => {
    const result = resolve([testCase('TC-001', [['the user searches for a SQL injection string', '{{sqlInjectionInput}}']])], analysisWith([]));
    const value = String(input(result, 'TC-001', 'sqlInjectionInput').value);
    expect(value).toContain("' OR '1'='1'");
    expect(value).not.toMatch(/\b(drop|delete|truncate|update|insert|alter)\b/i);
  });

  it('ignores a stored answer that declines, and asks again', () => {
    const result = resolve([testCase('TC-001', [['the user opens the product', '{{productId}}']])], analysisWith([]), [answer('productId', 'N/A')]);
    expect(input(result, 'TC-001', 'productId')).toMatchObject({ source: 'unresolved' });
  });

  it('refuses a declining value typed in the Agent 04 UI', () => {
    const { applyInputOverride } = jest.requireActual('../../agents/04-test-data-generator/testDataEdits');
    const testData = { manifest: { perTCData: { 'TC-001': { tcKey: 'TC-001', inputs: {} } } } };
    expect(applyInputOverride(testData, 'TC-001', { productId: 'skip' }).errors)
      .toEqual([expect.stringMatching(/"skip" is not a value for \{\{productId\}\}/)]);
    expect(applyInputOverride(testData, 'TC-001', { productId: 'SKU-1001' }).errors).toEqual([]);
  });

  it('writes only what the test cases use: no boundary data or constants nothing reads', () => {
    const result = resolve([testCase('TC-001', [['the user enters a long name', '{{tooLongPassword}}']], { type: 'Edge', name: 'Admin minimum' })], analysisWith([]));
    expect(result.perTCData['TC-001']).not.toHaveProperty('boundaryData');
    // A value one test case uses is keyed by that test case.
    expect(Object.keys(result.fixture)).toEqual(['TC001_tooLongPassword']);
  });
});
