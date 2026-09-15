/**
 * @fileoverview Unit tests for working-directory-independent env loading and AUT base-URL resolution.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FRAMEWORK_ENV_FILE, resolveAutBaseUrl } from '../../core/aut/autBaseUrl';
import { FRAMEWORK_ROOT } from '../../core/aut/projectPaths';

describe('AUT base URL', () => {
  it('reads the .env of the framework root, not of the working directory', () => {
    expect(FRAMEWORK_ENV_FILE).toBe(path.join(FRAMEWORK_ROOT, '.env'));
  });

  it('uses the AUT profile variable first, then AUT_BASE_URL', () => {
    expect(resolveAutBaseUrl('APP_URL', { APP_URL: 'https://app.example.test', AUT_BASE_URL: 'https://other.example.test' })).toBe('https://app.example.test');
    expect(resolveAutBaseUrl('APP_URL', { AUT_BASE_URL: ' https://other.example.test ' })).toBe('https://other.example.test');
  });

  it('fails with guidance instead of falling back to a local default', () => {
    expect(() => resolveAutBaseUrl('APP_URL', {})).toThrow(/set APP_URL or AUT_BASE_URL in .*\.env/);
  });

  it('is what the Playwright config uses, with no default URL', () => {
    const config = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'playwright.config.ts'), 'utf-8');
    expect(config).toContain('loadFrameworkEnv()');
    expect(config).toContain('resolveAutBaseUrl(');
    expect(config).not.toMatch(/localhost:\d+/);
  });
});
