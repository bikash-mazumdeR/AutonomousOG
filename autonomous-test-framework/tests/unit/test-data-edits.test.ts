/**
 * @fileoverview Unit tests for Agent 04 test data edits: one source of truth for the manifest and the enriched test
 * cases Agent 05 binds from.
 */

import { FixtureAccumulator, buildAutomationTestCase } from '../../agents/05-playwright-script-generator/contracts/automationTestCase';
import { buildFlatTestData } from '../../core/state-manager/FixtureSync';
import { applyFlatOverride, applyGlobalOverride, applyInputOverride } from '../../agents/04-test-data-generator/testDataEdits';

const KEYS = ['TC-001', 'TC-002'];

const rawTestCase = (key: string): any => ({
  key,
  name: `Search ${key}`,
  type: 'Positive',
  testSteps: [
    { keyword: 'When', description: 'the user searches for {{searchQuery}}', testData: '{{searchQuery}}', expectedResult: 'Results for "{{searchQuery}}" are listed' },
    { keyword: 'And', description: 'the user signs in', testData: '{{validPassword}}', expectedResult: 'The account page is displayed' },
  ],
});
const raw = KEYS.map(rawTestCase);

function testDataFixture(): any {
  const perTCData = Object.fromEntries(KEYS.map((key) => [key, {
    tcKey: key,
    inputs: {
      '{{searchQuery}}': { value: '{{UNRESOLVED:searchQuery}}', type: 'unknown', sensitive: false, source: 'unresolved' },
      '{{validPassword}}': { value: 'LOADED_FROM_ENV_AT_RUNTIME', type: 'runtime-ref', sensitive: true, source: 'runtime', envVar: 'ARIA_VALID_PASSWORD' },
    },
    unresolved: ['{{searchQuery}}'],
  }]));
  return {
    manifest: {
      perTCData,
      resolvedCount: 2,
      unresolvedCount: 2,
      unresolvedPlaceholders: KEYS.map((tcKey) => ({ tcKey, placeholder: '{{searchQuery}}' })),
      sensitiveDataVault: { refs: ['{{validPassword}}'] },
    },
    enrichedZephyrExport: { testCases: KEYS.map((key) => ({ ...rawTestCase(key), resolvedData: perTCData[key] })) },
    summary: { resolvedCount: 2, unresolvedCount: 2 },
  };
}

function contractFor(testData: any, key: string) {
  const fixture = new FixtureAccumulator();
  const enriched = testData.enrichedZephyrExport.testCases.find((tc: any) => tc.key === key);
  const contract = buildAutomationTestCase(enriched, raw.find((tc) => tc.key === key), fixture);
  return { contract, fixture: fixture.toObject() };
}

describe('Agent 04 test data edits', () => {
  it('a test case edit reaches the Agent 05 bindings, the enriched steps and the counts', () => {
    const testData = testDataFixture();
    const outcome = applyInputOverride(testData, 'TC-001', { searchQuery: 'blue mug', validPassword: 'ARIA_VALID_PASSWORD' }, raw);
    expect(outcome).toEqual({ changes: [{ name: 'searchQuery', tcKey: 'TC-001', value: 'blue mug' }], errors: [], ignored: [] });

    const { contract, fixture } = contractFor(testData, 'TC-001');
    expect(contract.steps[0].data).toEqual([{ token: '{{searchQuery}}', fixtureKey: 'searchQuery' }]);
    expect(fixture).toEqual({ searchQuery: 'blue mug' });
    expect(testData.enrichedZephyrExport.testCases[0].testSteps[0].testData).toBe('blue mug');
    expect(testData.manifest).toMatchObject({ unresolvedCount: 1, resolvedCount: 3, unresolvedPlaceholders: [{ tcKey: 'TC-002' }] });
    expect(testData.summary.unresolvedCount).toBe(1);
    expect(contractFor(testData, 'TC-002').contract.steps[0].data).toEqual([{ token: '{{searchQuery}}', unresolved: true }]);
  });

  it('a shared edit reaches every test case using the placeholder; credentials take only a variable name', () => {
    const testData = testDataFixture();
    const refused = applyGlobalOverride(testData, { validPassword: 'hunter2', searchQuery: 'blue mug' }, raw);
    expect(refused.errors).toHaveLength(2);
    expect(testData.manifest.unresolvedCount).toBe(2);

    const outcome = applyGlobalOverride(testData, { validPassword: 'APP_PASSWORD', searchQuery: 'blue mug', unusedName: 'x' }, raw);
    expect(outcome.changes).toEqual([{ name: 'validPassword', envVar: 'APP_PASSWORD' }, { name: 'searchQuery', value: 'blue mug' }]);
    expect(outcome.ignored).toEqual(['unusedName']);
    expect(contractFor(testData, 'TC-002').contract.steps[1].data).toEqual([{ token: '{{validPassword}}', envVar: 'APP_PASSWORD' }]);
    expect(JSON.stringify(buildFlatTestData(testData.manifest))).not.toContain('APP_PASSWORD');
    expect(testData.manifest.runtimeBindings).toEqual([{ placeholder: '{{validPassword}}', envVar: 'APP_PASSWORD' }]);
  });

  it('accepts a credential value when the project stores credentials in the fixture', () => {
    const testData = testDataFixture();
    expect(applyGlobalOverride(testData, { validPassword: 'hunter2' }, raw, { credentialsInFixture: true }).errors).toEqual([]);
    expect(contractFor(testData, 'TC-001').contract.steps[1].data).toEqual([{ token: '{{validPassword}}', fixtureKey: 'validPassword' }]);
  });

  it('an edited flat fixture maps test case keys and root keys, and ignores boundary constants', () => {
    const testData = testDataFixture();
    const flat = { ...buildFlatTestData(testData.manifest), TC002_searchQuery: 'green mug', stringMin: 'B' };
    const outcome = applyFlatOverride(testData, flat, raw);
    expect(outcome.changes).toEqual([{ name: 'searchQuery', tcKey: 'TC-002', value: 'green mug' }]);
    expect(outcome.ignored).toEqual(['stringMin']);

    expect(applyFlatOverride(testData, { searchQuery: 'blue mug' }, raw).changes).toEqual([{ name: 'searchQuery', value: 'blue mug' }]);
    expect(testData.manifest.perTCData['TC-002'].inputs['{{searchQuery}}'].value).toBe('blue mug');
  });
});
