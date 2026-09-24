/**
 * @fileoverview Secrets never reach the committed fixture: a requirement value that equals a declared secret, or is a
 * placeholder a secret was redacted to, is bound to its environment variable; and the single fixture writer drops any
 * value holding a secret, including one an earlier run wrote.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PolicyContext, ProfileValues, resolvePlaceholder } from '../../agents/04-test-data-generator/valuePolicy';
import { bindSecretValues, collectRequirementValues, literalRequirementValues } from '../../agents/04-test-data-generator/valueSources';
import { writeFixtureFile } from '../../core/state-manager/FixtureSync';

const EMAIL = 'qa.lead@example.test';
const profile: ProfileValues = { credentialEnvVars: { validEmail: 'APP_EMAIL', validPassword: 'APP_PASSWORD' }, secretsEnvVars: ['APP_EMAIL', 'APP_PASSWORD'] };
const env = { APP_EMAIL: EMAIL, APP_PASSWORD: 'Sample#Pass9' };
const tc = { key: 'TC-001', featureId: 'F-01', userStoryId: 'US-01', name: 'Profile shows the email', objective: 'Verifies AC-4' };
const stated = (testDataValues: any[]) => collectRequirementValues({ features: [{ id: 'F-01', userStories: [{ id: 'US-01', testDataValues }] }] });
const context = (requirementValues: any[]): PolicyContext => ({
  tc, seed: 'ab12cd34', answers: new Map(), overrides: new Map(), requirementValues, endpoints: [], profile, memory: {}, env,
});

describe('Agent 04 — requirement values that are secrets', () => {
  const values = () => stated([
    { name: 'userEmail', value: EMAIL, sourceRef: 'AC-4', sensitive: false },
    { name: 'accountEmail', value: '{{validEmail}}', sourceRef: 'AC-4', sensitive: false },
    { name: 'mysteryValue', value: '{{nothingDeclared}}', sourceRef: 'AC-5', sensitive: false },
    { name: 'displayName', value: 'QA Lead', sourceRef: 'AC-6', sensitive: false },
  ]);

  it('binds a value equal to a declared secret, or a redacted placeholder, to its variable — never keeping the value', () => {
    const bound = bindSecretValues(values(), profile, env);
    expect(bound.map(({ name, value, sensitive, envVar }) => ({ name, value, sensitive, envVar }))).toEqual([
      { name: 'userEmail', value: undefined, sensitive: true, envVar: 'APP_EMAIL' },
      { name: 'accountEmail', value: undefined, sensitive: true, envVar: 'APP_EMAIL' },
      { name: 'mysteryValue', value: undefined, sensitive: false, envVar: undefined },
      { name: 'displayName', value: 'QA Lead', sensitive: false, envVar: undefined },
    ]);
  });

  it('resolves such a placeholder to the declared variable, not one guessed from its name', () => {
    const entry = resolvePlaceholder('userEmail', context(bindSecretValues(values(), profile, env)));
    expect(entry.entry).toMatchObject({ source: 'runtime', envVar: 'APP_EMAIL', sensitive: true });
    expect(entry.envIssue).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain(EMAIL);
  });

  it('keeps it out of the fixture values, and leaves a project that stores credentials in the fixture alone', () => {
    expect(literalRequirementValues(bindSecretValues(values(), profile, env))).toEqual({ displayName: 'QA Lead' });
    const inFixture = bindSecretValues(values(), { ...profile, credentialsInFixture: true }, env);
    expect(inFixture.find((v) => v.name === 'userEmail')?.value).toBe(EMAIL);
  });
});

describe('Fixture writer — the last gate', () => {
  const previous = process.env.NEXOLVI_EMAIL;
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-fixture-'));
    process.env.NEXOLVI_EMAIL = EMAIL;
  });
  afterEach(() => {
    process.env.NEXOLVI_EMAIL = previous;
    fs.rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('drops a secret-holding value, including one an earlier run already wrote, and keeps everything else', () => {
    jest.spyOn(console, 'warn').mockImplementation();
    const file = path.join(dir, 'test-data.json');
    fs.writeFileSync(file, JSON.stringify({ userEmail: EMAIL, dashboardUrl: '/dashboard' }));
    const written = writeFixtureFile(file, { profileNote: `Signed in as ${EMAIL}`, updatedName: 'QA Lead' });
    expect(written).toEqual({ dashboardUrl: '/dashboard', updatedName: 'QA Lead' });
    expect(fs.readFileSync(file, 'utf-8')).not.toContain(EMAIL);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/Left 2 value\(s\) holding a secret out of the fixture: userEmail, profileNote/));
  });
});

describe('Agent 04 — a credential the profile declares is always a credential', () => {
  const noValues = (): PolicyContext => ({ ...context([]), env });
  // Project-wide answers are indexed under an empty test case key.
  const answered = (value: string) => new Map([['|validemail', { value, clarificationId: 'clar-1' }]]) as any;

  it('binds a declared credential to its variable even when its name reads as a synthetic value', () => {
    const result = resolvePlaceholder('validEmail', noValues());
    expect(result.valueClass).toBe('RUNTIME');
    expect(result.entry).toMatchObject({ source: 'runtime', envVar: 'APP_EMAIL', sensitive: true });
    expect(JSON.stringify(result)).not.toMatch(/example\.test|aria_test_/);
  });

  it('still generates the same name for a project that declares no such credential', () => {
    expect(resolvePlaceholder('validEmail', { ...noValues(), profile: null }).entry).toMatchObject({ source: 'generated' });
  });

  it('takes a variable name from a human answer, never the typed value', () => {
    expect(resolvePlaceholder('validEmail', { ...noValues(), answers: answered('OTHER_EMAIL') }).entry)
      .toMatchObject({ source: 'runtime', origin: 'clarification', envVar: 'OTHER_EMAIL' });
    const typed = resolvePlaceholder('validEmail', { ...noValues(), answers: answered(EMAIL) });
    expect(JSON.stringify(typed)).not.toContain(EMAIL);
  });

  it('leaves a project that stores credentials in the fixture free to set the value', () => {
    const inFixture = { ...noValues(), profile: { ...profile, credentialsInFixture: true }, answers: answered(EMAIL) };
    expect(resolvePlaceholder('validEmail', inFixture).entry).toMatchObject({ value: EMAIL, source: 'clarification' });
  });

  it('applies the same rule to a value set in the Agent 04 UI', () => {
    const { applyInputOverride } = jest.requireActual('../../agents/04-test-data-generator/testDataEdits');
    const testData = { manifest: { perTCData: { 'TC-001': { tcKey: 'TC-001', inputs: {} } } } };
    const options = { credentialEnvVars: profile.credentialEnvVars };
    expect(applyInputOverride(testData, 'TC-001', { validEmail: EMAIL }, [], options).errors)
      .toEqual([expect.stringMatching(/\{\{validEmail\}\} is a credential or secret: enter the name of the environment variable/)]);
    expect(applyInputOverride(testData, 'TC-001', { validEmail: 'APP_EMAIL' }, [], options).errors).toEqual([]);
  });
});
