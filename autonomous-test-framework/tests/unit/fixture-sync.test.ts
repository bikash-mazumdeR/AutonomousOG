/**
 * @fileoverview Unit tests for Centralized FixtureSync.
 * Verifies flattening from the Agent 04 manifest only (no hard-coded application data),
 * shared placeholder promotion, secret exclusion and fixture file synchronization.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  buildFlatTestData,
  syncFixturesFileFromTestData,
} from '../../core/state-manager/FixtureSync';

describe('FixtureSync Centralized Test Data Engine', () => {
  const tmpFixturePath = path.resolve(__dirname, '../fixtures/test-data-unit-tmp.json');

  afterAll(() => {
    if (fs.existsSync(tmpFixturePath)) fs.unlinkSync(tmpFixturePath);
  });

  describe('buildFlatTestData', () => {
    const manifest = {
      perTCData: {
        'TC-001': {
          inputs: {
            '{{validUsername}}': { value: 'acme_user', source: 'generated' },
            '{{validPassword}}': { value: 'hunter2', sensitive: true, source: 'generated' },
            '{{searchQuery}}': { value: 'backpack', source: 'generated' },
          },
        },
        'TC-002': {
          inputs: {
            '{{validUsername}}': { value: 'acme_user', source: 'generated' },
            '{{searchQuery}}': { value: 'backpack', source: 'generated' },
            '{{invalidZipCode}}': { value: '99999', source: 'generated' },
            '{{apiToken}}': { value: '__RUNTIME__', source: 'runtime' },
            '{{mystery}}': { value: '{{UNRESOLVED:mystery}}', source: 'unresolved' },
          },
        },
      },
    };

    it('promotes shared placeholders with identical values and keys the rest per test case', () => {
      const flat = buildFlatTestData(manifest);
      expect(flat.validUsername).toBe('acme_user');
      expect(flat.searchQuery).toBe('backpack');
      expect(flat.TC002_invalidZipCode).toBe('99999');
      expect(flat.stringMin).toBe('A');
      expect(flat.numberMax).toBe(2147483647);
    });

    it('never writes sensitive, runtime or unresolved values', () => {
      const flat = buildFlatTestData(manifest);
      const serialized = JSON.stringify(flat);
      expect(serialized).not.toContain('hunter2');
      expect(serialized).not.toContain('__RUNTIME__');
      expect(serialized).not.toContain('UNRESOLVED');
    });

    it('does not invent application data such as a base URL or default credentials', () => {
      const flat = buildFlatTestData({});
      expect(flat.baseURL).toBeUndefined();
      expect(flat.password).toBeUndefined();
      expect(Object.keys(flat).every((key) => key.startsWith('string') || key.startsWith('number'))).toBe(true);
    });

    it('merges explicit caller values first', () => {
      expect(buildFlatTestData(manifest, { validUsername: 'override' }).validUsername).toBe('override');
    });

    it('writes requirement values recorded in the manifest, with explicit values taking precedence', () => {
      const withRequirement = { ...manifest, requirementValues: { validUsername: 'from_requirement', loginPath: '/login' } };
      expect(buildFlatTestData(withRequirement).validUsername).toBe('from_requirement');
      expect(buildFlatTestData(withRequirement).loginPath).toBe('/login');
      expect(buildFlatTestData(withRequirement, { loginPath: '/signin' }).loginPath).toBe('/signin');
    });
  });

  it('writes values answered in clarifications or set in the UI', () => {
    const flat = buildFlatTestData({
      perTCData: {
        'TC-003': {
          inputs: {
            '{{productName}}': { value: 'Blue Mug', source: 'clarification' },
            '{{couponCode}}': { value: 'SPRING', source: 'user_override' },
          },
        },
      },
    });
    expect(flat).toMatchObject({ TC003_productName: 'Blue Mug', TC003_couponCode: 'SPRING' });
  });

  describe('syncFixturesFileFromTestData', () => {
    it('writes valid JSON fixture file to disk', () => {
      const result = syncFixturesFileFromTestData({
        manifest: { perTCData: { 'TC-010': { inputs: { '{{specialInput}}': { value: 'promo_code_100' } } } } },
      }, undefined, tmpFixturePath);

      const parsed = JSON.parse(fs.readFileSync(tmpFixturePath, 'utf-8'));
      expect(parsed.TC010_specialInput).toBe('promo_code_100');
      expect(result.TC010_specialInput).toBe('promo_code_100');
    });
  });
});
