/**
 * @fileoverview Unit tests for Centralized FixtureSync.
 * Tests flat test data construction, shared placeholder promotion,
 * requirement data overrides, and fixture file synchronization.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  buildFlatTestData,
  extractRequirementData,
  syncFixturesFileFromTestData,
} from '../../core/state-manager/FixtureSync';

describe('FixtureSync Centralized Test Data Engine', () => {
  const tmpFixturePath = path.resolve(__dirname, '../fixtures/test-data-unit-tmp.json');

  afterAll(() => {
    if (fs.existsSync(tmpFixturePath)) {
      fs.unlinkSync(tmpFixturePath);
    }
  });

  describe('extractRequirementData', () => {
    it('returns default baseline requirement accounts and errors', () => {
      const data = extractRequirementData();
      expect(data.baseURL).toBeDefined();
      expect(data.standardUsername).toBe('standard_user');
      expect(data.password).toBe('secret_sauce');
      expect(data.lockedOutUsername).toBe('locked_out_user');
      expect(data.errorInvalidCredentials).toContain('Epic sadface');
    });

    it('extracts test accounts from analysis features if available', () => {
      const mockAnalysis = {
        features: [
          {
            userStories: [
              {
                testUserAccounts: [
                  { username: 'custom_user', password: 'custom_password' },
                ],
              },
            ],
          },
        ],
      };
      const data = extractRequirementData(mockAnalysis);
      expect(data.baseURL).toBeDefined();
    });
  });

  describe('buildFlatTestData', () => {
    it('builds flat test data with promoted shared variables and per-TC items', () => {
      const mockManifest = {
        globalCtx: { baseURL: 'https://test.saucedemo.com/' },
        globalFixtures: {
          adminCredentials: { username: 'admin_user', password: 'admin_password' },
        },
        perTCData: {
          'TC-001': {
            inputs: {
              '{{validUsername}}': { value: 'standard_user' },
              '{{validPassword}}': { value: 'secret_sauce' },
              '{{customSearchQuery}}': { value: 'backpack' },
            },
          },
          'TC-002': {
            inputs: {
              '{{validUsername}}': { value: 'standard_user' },
              '{{customSearchQuery}}': { value: 'backpack' },
              '{{invalidZipCode}}': { value: '99999' },
            },
          },
        },
      };

      const flat = buildFlatTestData(mockManifest);

      expect(flat.baseURL).toBe('https://test.saucedemo.com/');
      expect(flat.standardUsername).toBe('admin_user');
      expect(flat.password).toBe('admin_password');
      // customSearchQuery used in both TC-001 and TC-002 should be promoted to root
      expect(flat.customSearchQuery).toBe('backpack');
      // invalidZipCode only in TC-002 should be formatted as TC002_invalidZipCode
      expect(flat.TC002_invalidZipCode).toBe('99999');
      // Boundary values should be present
      expect(flat.stringMin).toBe('A');
      expect(flat.numberMax).toBe(2147483647);
    });
  });

  describe('syncFixturesFileFromTestData', () => {
    it('writes valid JSON fixture file to disk', () => {
      const mockTestData = {
        manifest: {
          globalCtx: { baseURL: 'https://www.saucedemo.com/' },
          perTCData: {
            'TC-010': {
              inputs: {
                '{{specialInput}}': { value: 'promo_code_100' },
              },
            },
          },
        },
      };

      const result = syncFixturesFileFromTestData(mockTestData, undefined, tmpFixturePath);
      expect(fs.existsSync(tmpFixturePath)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(tmpFixturePath, 'utf-8'));
      expect(parsed.baseURL).toBe('https://www.saucedemo.com/');
      expect(parsed.TC010_specialInput).toBe('promo_code_100');
      expect(result.TC010_specialInput).toBe('promo_code_100');
    });
  });
});
