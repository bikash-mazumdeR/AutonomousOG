'use strict';

/**
 * @fileoverview Centralized Fixture Sync Engine for ARIA framework.
 * Synchronizes test data manifest into flat tests/fixtures/test-data.json
 * to guarantee Playwright tests, UI previews, and agents always have access
 * to centralized, approved test fixtures.
 *
 * @module FixtureSync
 */

import * as fs from 'fs';
import * as path from 'path';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';

export const FIXTURES_DIR = path.resolve(__dirname, '../../tests/fixtures');
export const FIXTURES_PATH = path.join(FIXTURES_DIR, 'test-data.json');

/**
 * Extracts explicit test data from requirement specifications or analysis.
 */
export function extractRequirementData(analysis?: any): Record<string, string> {
  const data: Record<string, string> = {
    baseURL: FRAMEWORK_CONFIG.playwright.baseURL || 'https://www.saucedemo.com/',
    password: 'secret_sauce',
    standardUsername: 'standard_user',
    lockedOutUsername: 'locked_out_user',
    problemUsername: 'problem_user',
    performanceGlitchUsername: 'performance_glitch_user',
    errorUsername: 'error_user',
    visualUsername: 'visual_user',
    errorInvalidCredentials: 'Epic sadface: Username and password do not match any user in this service',
    errorLockedOut: 'Epic sadface: Sorry, this user has been locked out.',
    errorUsernameRequired: 'Epic sadface: Username is required',
    errorPasswordRequired: 'Epic sadface: Password is required',
    usernameMaxLength: '255',
    passwordMaxLength: '512',
  };

  if (analysis && Array.isArray(analysis.features)) {
    for (const f of analysis.features) {
      for (const s of (f.userStories || [])) {
        if (Array.isArray(s.testUserAccounts)) {
          for (const acc of s.testUserAccounts) {
            if (acc.username === 'standard_user') data.standardUsername = acc.username;
            if (acc.username === 'locked_out_user') data.lockedOutUsername = acc.username;
            if (acc.password) data.password = acc.password;
          }
        }
      }
    }
  }

  const reqCandidates = [
    path.resolve(process.cwd(), 'requirement.md'),
    path.resolve(process.cwd(), 'requirements/requirement.md'),
    path.resolve(process.cwd(), '../requirement.md'),
    path.resolve(__dirname, '../../requirement.md'),
    path.resolve(__dirname, '../../requirements/requirement.md'),
  ];

  for (const reqPath of reqCandidates) {
    if (fs.existsSync(reqPath) && fs.statSync(reqPath).isFile()) {
      try {
        const content = fs.readFileSync(reqPath, 'utf-8');
        if (content.includes('standard_user')) data.standardUsername = 'standard_user';
        if (content.includes('locked_out_user')) data.lockedOutUsername = 'locked_out_user';
        if (content.includes('problem_user')) data.problemUsername = 'problem_user';
        if (content.includes('performance_glitch_user')) data.performanceGlitchUsername = 'performance_glitch_user';
        if (content.includes('error_user')) data.errorUsername = 'error_user';
        if (content.includes('visual_user')) data.visualUsername = 'visual_user';
        if (content.includes('secret_sauce')) data.password = 'secret_sauce';

        const urlMatch = content.match(/https?:\/\/[^\s\)\"\'`]+/i);
        if (urlMatch) data.baseURL = urlMatch[0];
        break;
      } catch {
        // ignore
      }
    }
  }

  return data;
}

/**
 * Builds clean, flat key-value JSON format for test-data.json.
 */
export function buildFlatTestData(manifest: any, reqData?: Record<string, any>): Record<string, any> {
  const resolvedReqData = reqData || extractRequirementData();
  const flat: Record<string, any> = {};

  // 1. Baseline requirement values
  flat.baseURL = manifest?.globalCtx?.baseURL || resolvedReqData.baseURL || 'https://www.saucedemo.com/';
  flat.password = manifest?.globalFixtures?.adminCredentials?.password || resolvedReqData.password || 'secret_sauce';
  flat.standardUsername = manifest?.globalFixtures?.adminCredentials?.username || resolvedReqData.standardUsername || 'standard_user';
  flat.lockedOutUsername = resolvedReqData.lockedOutUsername || 'locked_out_user';
  if (resolvedReqData.problemUsername) flat.problemUsername = resolvedReqData.problemUsername;
  if (resolvedReqData.performanceGlitchUsername) flat.performanceGlitchUsername = resolvedReqData.performanceGlitchUsername;
  if (resolvedReqData.errorUsername) flat.errorUsername = resolvedReqData.errorUsername;
  if (resolvedReqData.visualUsername) flat.visualUsername = resolvedReqData.visualUsername;
  if (resolvedReqData.errorInvalidCredentials) flat.errorInvalidCredentials = resolvedReqData.errorInvalidCredentials;
  if (resolvedReqData.errorLockedOut) flat.errorLockedOut = resolvedReqData.errorLockedOut;
  if (resolvedReqData.errorUsernameRequired) flat.errorUsernameRequired = resolvedReqData.errorUsernameRequired;
  if (resolvedReqData.errorPasswordRequired) flat.errorPasswordRequired = resolvedReqData.errorPasswordRequired;

  // 2. Identify and promote shared placeholders to root
  const placeholderCounts = new Map<string, { count: number; value: any }>();
  for (const tcData of Object.values(manifest?.perTCData || {})) {
    const inputs = (tcData as any)?.inputs || {};
    for (const [ph, entry] of Object.entries(inputs)) {
      const rawVal = (entry as any)?.value;
      const cleanPh = ph.replace(/^\{\{|\}\}$/g, '');
      if (!placeholderCounts.has(cleanPh)) {
        placeholderCounts.set(cleanPh, { count: 0, value: rawVal });
      }
      const current = placeholderCounts.get(cleanPh)!;
      current.count++;
    }
  }

  for (const [cleanPh, meta] of placeholderCounts.entries()) {
    if (meta.count > 1) {
      if (!(['validBaseURL', 'baseURL', 'apiBaseURL', 'validPassword', 'password', 'validUsername', 'adminUsername'].includes(cleanPh))) {
        if (!(cleanPh in flat) && meta.value !== undefined) {
          flat[cleanPh] = meta.value;
        }
      }
    }
  }

  // 3. Per-TC unique inputs
  for (const [tcKey, tcData] of Object.entries(manifest?.perTCData || {})) {
    const inputs = (tcData as any)?.inputs || {};
    for (const [ph, entry] of Object.entries(inputs)) {
      const rawVal = (entry as any)?.value;
      const cleanPh = ph.replace(/^\{\{|\}\}$/g, '');

      if (cleanPh in flat || ['validBaseURL', 'baseURL', 'apiBaseURL', 'validPassword', 'password', 'validUsername', 'adminUsername'].includes(cleanPh)) {
        continue;
      }
      if (cleanPh === 'validTestData' && typeof rawVal === 'string' && rawVal.startsWith('aria_valid_')) {
        continue;
      }

      const formattedKey = `${tcKey.replace(/[^a-zA-Z0-9]/g, '')}_${cleanPh}`;
      if (!(formattedKey in flat) && rawVal !== undefined) {
        flat[formattedKey] = rawVal;
      }
    }
  }

  // 4. Constraints
  if (resolvedReqData.usernameMaxLength) flat.usernameMaxLength = resolvedReqData.usernameMaxLength;
  if (resolvedReqData.passwordMaxLength) flat.passwordMaxLength = resolvedReqData.passwordMaxLength;

  // 5. Lightweight boundary primitives
  flat.stringMin = 'A';
  flat.stringUnderMin = '';
  flat.stringLong = 'A'.repeat(1001);
  flat.stringSpecialChars = '#%&<>!@$^*()';
  flat.stringUnicode = '🚀 中文 العربية Ñ';
  flat.stringWhitespace = '   ';
  flat.stringSqlInject = "' OR '1'='1'; DROP TABLE users;--";
  flat.stringXss = "<script>alert('aria-xss-test')</script>";

  flat.numberMin = 0;
  flat.numberMax = 2147483647;
  flat.numberUnderMin = -1;
  flat.numberOverMax = 2147483648;
  flat.numberZero = 0;
  flat.numberNegative = -999;
  flat.numberDecimal = 0.001;
  flat.numberMaxDecimal = 999999999.99;

  return flat;
}

/**
 * Saves flat test data to tests/fixtures/test-data.json
 */
export function syncFixturesFileFromTestData(
  testDataArtifact: any,
  reqData?: Record<string, any>,
  targetPath: string = FIXTURES_PATH
): Record<string, any> {
  const manifest = testDataArtifact?.manifest || testDataArtifact || {};
  const flat = buildFlatTestData(manifest, reqData);

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(targetPath, JSON.stringify(flat, null, 2), 'utf-8');
  return flat;
}

/**
 * Ensures tests/fixtures/test-data.json is present on disk.
 * If missing, attempts to reconstruct from StateManager artifacts.
 */
export async function ensureFixturesFileSynced(
  stateManager: any,
  targetPath: string = FIXTURES_PATH
): Promise<Record<string, any>> {
  if (fs.existsSync(targetPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
      if (existing && Object.keys(existing).length > 0) {
        return existing;
      }
    } catch {
      // Rebuild if invalid JSON
    }
  }

  const testData = await stateManager.getPipelineArtifact('testData');
  const analyzedRequirements = await stateManager.getPipelineArtifact('analyzedRequirements');
  const reqData = extractRequirementData(analyzedRequirements);

  return syncFixturesFileFromTestData(testData, reqData, targetPath);
}
